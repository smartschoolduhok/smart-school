import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';
import { signJWT } from '../src/lib/jwtSecurity.ts';
import {
  root,
  financeFixture,
  feeDraft,
  migrationSQL,
  paymentDraft,
  snapshot,
} from './helpers/finance-fixture.mjs';

const vite = await createServer({ root, appType: 'custom', server: { middlewareMode: true, hmr: false } });
const { default: app } = await vite.ssrLoadModule('/src/worker.ts');
after(() => vite.close());

const secret = 'generated-local-treasury-payroll-secret-no-remote-usage';
const tokens = Object.fromEntries(await Promise.all(
  ['owner', 'admin', 'teacher', 'accountant', 'principal', 'vice', 'registrar', 'parent']
    .map(async (role) => [role, await signJWT({ email: `${role}@matrix.test`, auth_version: 1 }, secret)]),
));

function businessDate(offsetDays = 0) {
  const date = new Date(Date.now() + offsetDays * 86_400_000);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Baghdad', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

async function call(fixture, method, path, input, role = 'owner') {
  const response = await app.request(`http://localhost/api/${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(role ? { Authorization: `Bearer ${tokens[role]}` } : {}),
    },
    body: input === undefined ? undefined : JSON.stringify(input),
  }, { DB: fixture.d1, JWT_SECRET: secret, APP_ENV: 'test' });
  return { status: response.status, body: await response.json() };
}

function manualDraft(patch = {}) {
  return {
    school_id: 1,
    transaction_type: 'income',
    category: 'other_income',
    amount: 100_000,
    currency: 'IQD',
    description: 'Generated local transaction',
    business_date: businessDate(),
    client_request_id: `treasury-${crypto.randomUUID()}`,
    ...patch,
  };
}

async function generateSalary(fixture, patch = {}) {
  const response = await call(fixture, 'POST', 'salaries/generate', {
    school_id: 1,
    employee_id: 1,
    month: 9,
    year: 2026,
    base_salary: 100_000,
    bonus_amount: 0,
    deduction_amount: 0,
    ...patch,
  });
  assert.equal(response.status, 201, JSON.stringify(response));
  return response.body.data.id;
}

test('0031 preserves legacy salary facts, classifies drift, and backfills Iraq business dates', (t) => {
  const fixture = financeFixture(t, { through: '0030' });
  fixture.db.exec(`
    INSERT INTO employee_salaries
      (id, school_id, employee_id, month, year, base_salary, net_salary, status,
       paid_at, paid_by_user_id, created_by_user_id)
    VALUES (10, 1, 1, 8, 2026, 90000, 90000, 'paid', 1788000000, 1, 1);
    INSERT INTO treasury_transactions
      (id, school_id, transaction_type, category, amount, currency, source_type,
       source_id, status, created_by, created_at)
    VALUES (10, 1, 'income', 'other_income', 5000, 'IQD', NULL, NULL, 'active', 1, 0);
  `);
  const before = fixture.db.prepare('SELECT * FROM employee_salaries WHERE id = 10').get();
  fixture.db.exec(migrationSQL('0031_treasury_payroll_integrity.sql'));
  const after = fixture.db.prepare('SELECT * FROM employee_salaries WHERE id = 10').get();
  assert.deepEqual(after, before);
  assert.equal(fixture.db.prepare('SELECT healthy FROM finance_payroll_readiness WHERE salary_id = 10').get().healthy, 0);
  assert.equal(fixture.db.prepare('SELECT business_date FROM treasury_transactions WHERE id = 10').get().business_date, '1970-01-01');
  const columns = fixture.db.prepare('PRAGMA table_info(treasury_transactions)').all().map((row) => row.name);
  assert.ok(columns.includes('business_date'));
  assert.ok(columns.includes('client_request_id'));
  assert.ok(columns.includes('request_fingerprint'));
});

test('manual transaction is exactly-once and updates the cached balance from the ledger', async (t) => {
  const fixture = financeFixture(t);
  const draft = manualDraft();
  const first = await call(fixture, 'POST', 'treasury/transactions', draft);
  const retry = await call(fixture, 'POST', 'treasury/transactions', draft);
  const changed = await call(fixture, 'POST', 'treasury/transactions', { ...draft, amount: 100_001 });
  assert.equal(first.status, 201, JSON.stringify(first));
  assert.equal(retry.status, 200, JSON.stringify(retry));
  assert.equal(retry.body.data.id, first.body.data.id);
  assert.equal(retry.body.data.replayed, true);
  assert.equal(changed.status, 409);
  assert.equal(changed.body.code, 'finance_idempotency_conflict');
  assert.equal(fixture.db.prepare("SELECT COUNT(*) AS n FROM treasury_transactions WHERE source_type = 'manual'").get().n, 1);
  assert.equal(fixture.db.prepare('SELECT current_balance FROM treasury_accounts WHERE school_id = 1').get().current_balance, 100_000);
});

test('manual validation rejects malformed, fractional, foreign-currency, and mismatched-category money', async (t) => {
  const fixture = financeFixture(t);
  const before = snapshot(fixture.db);
  const cases = [
    { amount: '100abc' },
    { amount: 1.5 },
    { currency: 'USD' },
    { transaction_type: 'expense', category: 'other_income' },
    { business_date: '2026-02-31' },
  ];
  for (const patch of cases) {
    const response = await call(fixture, 'POST', 'treasury/transactions', manualDraft(patch));
    assert.equal(response.status, 400, JSON.stringify(response));
  }
  assert.deepEqual(snapshot(fixture.db), before);
});

test('manual cache failure aborts the ledger insert and every financial effect', async (t) => {
  const fixture = financeFixture(t);
  fixture.db.exec("CREATE TRIGGER local_fail_treasury_cache BEFORE INSERT ON treasury_accounts BEGIN SELECT RAISE(ABORT, 'injected treasury cache failure'); END;");
  const before = snapshot(fixture.db);
  const response = await call(fixture, 'POST', 'treasury/transactions', manualDraft());
  assert.equal(response.status, 500, JSON.stringify(response));
  assert.deepEqual(snapshot(fixture.db), before);
});

test('salary payment is atomic and leaves the salary unpaid when cache posting fails', async (t) => {
  const fixture = financeFixture(t);
  const salaryId = await generateSalary(fixture);
  fixture.db.exec("CREATE TRIGGER local_fail_salary_cache BEFORE INSERT ON treasury_accounts BEGIN SELECT RAISE(ABORT, 'injected salary cache failure'); END;");
  const before = snapshot(fixture.db);
  const failed = await call(fixture, 'PUT', `salaries/${salaryId}/pay`, { school_id: 1, paid_at: businessDate() });
  assert.equal(failed.status, 500, JSON.stringify(failed));
  assert.deepEqual(snapshot(fixture.db), before);
  assert.equal(fixture.db.prepare('SELECT status FROM employee_salaries WHERE id = ?').get(salaryId).status, 'unpaid');
  assert.equal(fixture.db.prepare("SELECT COUNT(*) AS n FROM treasury_transactions WHERE source_type = 'salary_payment'").get().n, 0);
});

test('salary payment and treasury cancellation synchronize once under concurrent cancellation', async (t) => {
  const fixture = financeFixture(t);
  const salaryId = await generateSalary(fixture);
  const paid = await call(fixture, 'PUT', `salaries/${salaryId}/pay`, { school_id: 1, paid_at: businessDate() });
  assert.equal(paid.status, 200, JSON.stringify(paid));
  const txId = paid.body.data.treasury_transaction_id;
  assert.equal(fixture.db.prepare('SELECT status FROM employee_salaries WHERE id = ?').get(salaryId).status, 'paid');
  assert.equal(fixture.db.prepare('SELECT current_balance FROM treasury_accounts WHERE school_id = 1').get().current_balance, -100_000);
  assert.equal(fixture.db.prepare('SELECT healthy FROM finance_payroll_readiness WHERE salary_id = ?').get(salaryId).healthy, 1);

  const results = await Promise.all([
    call(fixture, 'PUT', `treasury/transactions/${txId}/cancel`, { school_id: 1, cancel_reason: 'Generated correction A' }),
    call(fixture, 'PUT', `treasury/transactions/${txId}/cancel`, { school_id: 1, cancel_reason: 'Generated correction B' }),
  ]);
  assert.equal(results.filter((result) => result.status === 200).length, 1, JSON.stringify(results));
  assert.equal(results.filter((result) => result.status === 409).length, 1, JSON.stringify(results));
  assert.equal(fixture.db.prepare('SELECT status FROM employee_salaries WHERE id = ?').get(salaryId).status, 'cancelled');
  assert.equal(fixture.db.prepare('SELECT current_balance FROM treasury_accounts WHERE school_id = 1').get().current_balance, 0);
  assert.equal(fixture.db.prepare('SELECT healthy FROM finance_payroll_readiness WHERE salary_id = ?').get(salaryId).healthy, 1);
});

test('salary cancellation cache failure rolls back both salary and ledger state', async (t) => {
  const fixture = financeFixture(t);
  const salaryId = await generateSalary(fixture);
  const paid = await call(fixture, 'PUT', `salaries/${salaryId}/pay`, { school_id: 1, paid_at: businessDate() });
  assert.equal(paid.status, 200, JSON.stringify(paid));
  fixture.db.exec("CREATE TRIGGER local_fail_salary_cancel_cache BEFORE UPDATE ON treasury_accounts BEGIN SELECT RAISE(ABORT, 'injected salary cancel cache failure'); END;");
  const before = snapshot(fixture.db);
  const failed = await call(fixture, 'PUT', `salaries/${salaryId}/cancel`, { school_id: 1, cancel_reason: 'Generated rollback check' });
  assert.equal(failed.status, 500, JSON.stringify(failed));
  assert.deepEqual(snapshot(fixture.db), before);
  assert.equal(fixture.db.prepare('SELECT status FROM employee_salaries WHERE id = ?').get(salaryId).status, 'paid');
  assert.equal(fixture.db.prepare('SELECT status FROM treasury_transactions WHERE id = ?').get(paid.body.data.treasury_transaction_id).status, 'active');
});

test('first daily closing includes prior ledger balance and freezes the closed period', async (t) => {
  const fixture = financeFixture(t);
  const prior = await call(fixture, 'POST', 'treasury/transactions', manualDraft({ business_date: businessDate(-1), amount: 100_000 }));
  const todayExpense = await call(fixture, 'POST', 'treasury/transactions', manualDraft({
    transaction_type: 'expense', category: 'bills', amount: 25_000,
  }));
  assert.equal(prior.status, 201);
  assert.equal(todayExpense.status, 201);
  const closed = await call(fixture, 'POST', 'treasury/daily-closings/close-day', {
    school_id: 1, closing_date: businessDate(), notes: 'Generated closing',
  });
  assert.equal(closed.status, 201, JSON.stringify(closed));
  assert.equal(closed.body.data.opening_balance, 100_000);
  assert.equal(closed.body.data.total_income, 0);
  assert.equal(closed.body.data.total_expense, 25_000);
  assert.equal(closed.body.data.closing_balance, 75_000);
  assert.equal(closed.body.data.transaction_count, 1);

  const late = await call(fixture, 'POST', 'treasury/transactions', manualDraft());
  const cancelOld = await call(fixture, 'PUT', `treasury/transactions/${prior.body.data.id}/cancel`, {
    school_id: 1, cancel_reason: 'Late change',
  });
  assert.equal(late.status, 409, JSON.stringify(late));
  assert.equal(late.body.code, 'treasury_day_closed');
  assert.equal(cancelOld.status, 409, JSON.stringify(cancelOld));
  assert.equal(cancelOld.body.code, 'treasury_day_closed');
  assert.equal(fixture.db.prepare('SELECT current_balance FROM treasury_accounts WHERE school_id = 1').get().current_balance, 75_000);
});

test('daily closing blocks later salary and fee postings for the closed period', async (t) => {
  const fixture = financeFixture(t);
  const salaryId = await generateSalary(fixture);
  const closed = await call(fixture, 'POST', 'treasury/daily-closings/close-day', {
    school_id: 1, closing_date: businessDate(),
  });
  assert.equal(closed.status, 201, JSON.stringify(closed));
  const salaryPay = await call(fixture, 'PUT', `salaries/${salaryId}/pay`, { school_id: 1, paid_at: businessDate() });
  assert.equal(salaryPay.status, 409, JSON.stringify(salaryPay));
  assert.equal(salaryPay.body.code, 'treasury_day_closed');
  assert.equal(fixture.db.prepare('SELECT status FROM employee_salaries WHERE id = ?').get(salaryId).status, 'unpaid');

  const fee = await call(fixture, 'POST', 'student-fees', feeDraft());
  assert.equal(fee.status, 201, JSON.stringify(fee));
  const payment = await call(fixture, 'POST', 'fee-payments', paymentDraft(fee.body.data.id, {
    amount: 10_000,
    payment_date: Math.floor(Date.now() / 1000),
  }));
  assert.equal(payment.status, 409, JSON.stringify(payment));
  assert.equal(payment.body.code, 'treasury_day_closed');
  assert.equal(fixture.db.prepare('SELECT paid_amount FROM student_fees WHERE id = ?').get(fee.body.data.id).paid_amount, 0);
  assert.equal(fixture.db.prepare('SELECT COUNT(*) AS n FROM fee_payments').get().n, 0);
});

test('daily and monthly reports use Baghdad business dates and expose matching shapes', async (t) => {
  const fixture = financeFixture(t);
  await call(fixture, 'POST', 'treasury/transactions', manualDraft({ business_date: businessDate(-1), amount: 80_000 }));
  await call(fixture, 'POST', 'treasury/transactions', manualDraft({
    transaction_type: 'expense', category: 'bills', amount: 30_000,
  }));
  const daily = await call(fixture, 'GET', `treasury/reports/daily?school_id=1&date=${businessDate()}`);
  assert.equal(daily.status, 200, JSON.stringify(daily));
  assert.equal(daily.body.data.business_timezone, 'Asia/Baghdad');
  assert.deepEqual(daily.body.data.summary, { total_income: 0, total_expense: 30_000, net: -30_000, transaction_count: 1 });
  assert.deepEqual(daily.body.data.by_category[0], { category: 'bills', transaction_type: 'expense', total: 30_000, count: 1 });

  const month = businessDate().slice(0, 7);
  const monthly = await call(fixture, 'GET', `treasury/reports/monthly?school_id=1&month=${month}`);
  assert.equal(monthly.status, 200, JSON.stringify(monthly));
  assert.equal(monthly.body.data.month_key, month);
  assert.equal(monthly.body.data.summary.total_income, 80_000);
  assert.equal(monthly.body.data.summary.total_expense, 30_000);
  assert.equal(monthly.body.data.summary.net, 50_000);
  assert.ok(monthly.body.data.daily_breakdown.every((row) => typeof row.day === 'string' && typeof row.net === 'number'));

  const filtered = await call(fixture, 'GET', `treasury/transactions?school_id=1&from=${businessDate()}&to=${businessDate()}`);
  assert.equal(filtered.status, 200, JSON.stringify(filtered));
  assert.equal(filtered.body.data.length, 1);
  assert.equal(filtered.body.data[0].business_date, businessDate());
});

test('treasury and payroll routes retain role, tenant, and category isolation', async (t) => {
  const fixture = financeFixture(t);
  fixture.db.exec("INSERT INTO treasury_categories(school_id,type,name,name_ar,is_system) VALUES(2,'income','foreign_private','Foreign private',0)");
  for (const role of ['teacher', 'registrar', 'parent']) {
    assert.equal((await call(fixture, 'GET', 'treasury/summary?school_id=1', undefined, role)).status, 403, role);
    assert.equal((await call(fixture, 'POST', 'salaries/generate', {
      school_id: 1, employee_id: 1, month: 9, year: 2026,
    }, role)).status, 403, role);
  }
  assert.equal((await call(fixture, 'GET', 'treasury/summary?school_id=2')).status, 403);
  assert.equal((await call(fixture, 'GET', 'treasury/categories', undefined, 'admin')).status, 400);
  assert.equal((await call(fixture, 'GET', 'salaries', undefined, 'admin')).status, 400);
  assert.equal((await call(fixture, 'GET', 'salaries/reports/monthly', undefined, 'admin')).status, 400);
  const categories = await call(fixture, 'GET', 'treasury/categories?school_id=1');
  assert.equal(categories.status, 200, JSON.stringify(categories));
  assert.ok(!categories.body.data.some((category) => category.name === 'foreign_private'));

  const before = snapshot(fixture.db);
  const fractional = await call(fixture, 'POST', 'salaries/generate', {
    school_id: 1, employee_id: 1, month: 9, year: 2026,
    base_salary: 100_000.5, bonus_amount: 0, deduction_amount: 0,
  });
  assert.equal(fractional.status, 400, JSON.stringify(fractional));
  assert.deepEqual(snapshot(fixture.db), before);
});
