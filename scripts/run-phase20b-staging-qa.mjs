// Explicit STAGING-only functional QA. Records are retained as inactive,
// archived, cancelled or superseded evidence; no SQL DELETE is issued.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { hashPassword } from '../src/lib/authSecurity.ts';

const target = 'smart-school-staging-db';
const targetId = '1bdb9c3d-08d6-4023-9cbc-64369d53198a';
const [previewArgument, evidenceArgument, confirmation] = process.argv.slice(2);
assert.equal(confirmation, '--confirm-staging', 'Explicit --confirm-staging is required');
const preview = new URL(previewArgument);
assert.equal(preview.protocol, 'https:');
assert.ok(preview.hostname.endsWith('.smart-school-staging.pages.dev'), 'Only the staging Pages Preview is allowed');
assert.ok(evidenceArgument, 'An evidence JSON path outside the repository is required');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = resolve(evidenceArgument);
assert.ok(!evidencePath.toLowerCase().startsWith(`${root.toLowerCase()}\\`), 'Evidence must remain outside the repository');
const wranglerPath = resolve(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const marker = `PH20B-${Date.now()}-${randomBytes(4).toString('hex')}`;
const markerLower = marker.toLowerCase();
const accountantEmail = `phase20b.accountant.${markerLower}@example.test`;
const parentEmail = `phase20b.parent.${markerLower}@example.test`;
const studentNumber = `P20B-${Date.now()}`;
const privateSentinel = `PRIVATE-${marker}`;
const password = randomBytes(24).toString('base64url');
const passwordHash = await hashPassword(password);
const sqlText = value => `'${String(value).replaceAll("'", "''")}'`;
const commandEvidence = [];

function d1(sql, mode) {
  assert.ok(mode === 'read' || mode === 'write');
  assert.ok(!/\b(?:DELETE|DROP|TRUNCATE|VACUUM|REPLACE)\b/iu.test(sql), 'Destructive SQL is forbidden');
  if (mode === 'read') assert.match(sql.trim(), /^(?:SELECT|PRAGMA)\b/iu);
  const startedAt = Date.now();
  const result = spawnSync(process.execPath, [
    wranglerPath, 'd1', 'execute', target, '--remote', '--command', sql, '--json',
  ], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 60_000,
    maxBuffer: 2_000_000,
    env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' },
  });
  commandEvidence.push({ mode, exit_code: result.status, duration_ms: Date.now() - startedAt });
  assert.equal(result.status, 0, `D1 ${mode} failed: ${result.stderr || result.stdout}`);
  const parsed = JSON.parse(result.stdout);
  assert.ok(parsed.every(entry => entry.success === true), `D1 ${mode} was not successful`);
  if (mode === 'read') {
    assert.ok(parsed.every(entry => entry.meta?.changed_db === false && Number(entry.meta?.rows_written || 0) === 0));
  }
  return parsed.flatMap(entry => entry.results || []);
}

async function api(path, { method = 'GET', token, body, expected = 200 } = {}) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(new URL(path, preview), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { /* status assertion below */ }
  assert.equal(response.status, expected, `${method} ${path}: ${response.status} ${payload?.code || payload?.error || 'invalid response'}`);
  return payload;
}

let accountantId = null;
let parentId = null;
let studentId = null;
let parentLinkId = null;
let feeId = null;
let paymentId = null;
let firstReceiptId = null;
let replacementReceiptId = null;
let firstPlanId = null;
let replacementPlanId = null;
let accountantToken = null;
let parentToken = null;
let functionalPass = false;
let cleanupPass = false;
const baseline = d1(
  "SELECT s.id AS school_id,y.id AS academic_year_id,c.id AS class_id,se.id AS section_id,(SELECT current_balance FROM treasury_accounts WHERE school_id=s.id) AS treasury_balance,(SELECT COUNT(*) FROM treasury_transactions WHERE school_id=s.id) AS treasury_transactions,(SELECT MAX(closing_date) FROM treasury_closings WHERE school_id=s.id) AS latest_closing_date FROM schools s JOIN academic_years y ON y.school_id=s.id AND y.is_active=1 JOIN classes c ON c.school_id=s.id AND c.status='active' JOIN sections se ON se.school_id=s.id AND se.class_id=c.id AND se.status='active' JOIN finance_treasury_readiness tr ON tr.school_id=s.id AND tr.healthy=1 JOIN finance_payroll_school_readiness pr ON pr.school_id=s.id AND pr.healthy=1 WHERE s.id=1 AND s.status='active' ORDER BY y.id,c.id,se.id LIMIT 1",
  'read',
)[0];
assert.ok(baseline, 'No safe STAGING QA context is available');
assert.equal(baseline.school_id, 1);
const today = new Date().toISOString().slice(0, 10);
assert.ok(!baseline.latest_closing_date || baseline.latest_closing_date < today, 'Current STAGING business date is closed');

try {
  d1(`INSERT INTO users(school_id,full_name,email,password_hash,role_id,status,auth_version,created_at,updated_at) VALUES(1,${sqlText(`${marker} Accountant`)},${sqlText(accountantEmail)},${sqlText(passwordHash)},(SELECT id FROM roles WHERE key='accountant'),'active',1,unixepoch(),unixepoch())`, 'write');
  d1(`INSERT INTO users(school_id,full_name,email,password_hash,role_id,status,auth_version,created_at,updated_at) VALUES(1,${sqlText(`${marker} Parent`)},${sqlText(parentEmail)},${sqlText(passwordHash)},(SELECT id FROM roles WHERE key='parent'),'active',1,unixepoch(),unixepoch())`, 'write');
  d1(`INSERT INTO students(school_id,student_number,full_name,gender,class_id,section_id,status,notes,created_at,updated_at) VALUES(1,${sqlText(studentNumber)},${sqlText(`${marker} Student`)},${sqlText('ذكر')},${Number(baseline.class_id)},${Number(baseline.section_id)},'active',${sqlText(privateSentinel)},unixepoch(),unixepoch())`, 'write');
  const setup = d1(`SELECT (SELECT id FROM users WHERE email=${sqlText(accountantEmail)}) AS accountant_id,(SELECT id FROM users WHERE email=${sqlText(parentEmail)}) AS parent_id,(SELECT id FROM students WHERE school_id=1 AND student_number=${sqlText(studentNumber)}) AS student_id`, 'read')[0];
  accountantId = Number(setup.accountant_id);
  parentId = Number(setup.parent_id);
  studentId = Number(setup.student_id);
  assert.ok(accountantId > 0 && parentId > 0 && studentId > 0);

  const accountantLogin = await api('/api/auth/login', { method: 'POST', body: { email: accountantEmail, password } });
  const parentLogin = await api('/api/auth/login', { method: 'POST', body: { email: parentEmail, password } });
  accountantToken = accountantLogin.data.token;
  parentToken = parentLogin.data.token;
  assert.equal(accountantLogin.data.user.role_key, 'accountant');
  assert.equal(parentLogin.data.user.role_key, 'parent');

  const fee = (await api('/api/student-fees', {
    method: 'POST', token: accountantToken, expected: 201,
    body: {
      school_id: 1,
      student_id: studentId,
      academic_year_id: Number(baseline.academic_year_id),
      fee_type: `${marker} Tuition`,
      amount: 100000,
      currency: 'IQD',
      due_date: Math.floor(Date.now() / 1000) + 90 * 86400,
      notes: privateSentinel,
      discount_type: 'none',
      discount_value: 0,
    },
  })).data;
  feeId = Number(fee.id);
  assert.equal(fee.finance_revision, 0);

  const firstPlan = (await api(`/api/student-fees/${feeId}/installment-plan`, {
    method: 'PUT', token: accountantToken,
    body: {
      school_id: 1,
      expected_fee_revision: 0,
      notes: privateSentinel,
      items: [
        { label: 'QA first', amount: 50000, due_date: today },
        { label: 'QA second', amount: 25000, due_date: '2026-12-15' },
        { label: 'QA third', amount: 25000, due_date: '2027-03-15' },
      ],
    },
  })).data.plan;
  firstPlanId = Number(firstPlan.id);

  const payment = (await api('/api/fee-payments', {
    method: 'POST', token: accountantToken, expected: 201,
    body: {
      school_id: 1,
      student_fee_id: feeId,
      amount: 60000,
      payment_method: 'cash',
      payment_date: Math.floor(Date.now() / 1000),
      notes: privateSentinel,
      client_request_id: randomUUID(),
      auto_generate_receipt: false,
    },
  })).data;
  paymentId = Number(payment.id);
  const allocatedPlan = (await api(`/api/student-fees/${feeId}/installment-plan?school_id=1`, { token: accountantToken })).data;
  assert.deepEqual(allocatedPlan.plan.items.map(item => [item.paid_amount, item.remaining_amount, item.status]), [
    [50000, 0, 'paid'], [10000, 15000, 'partial'], [0, 25000, 'upcoming'],
  ]);

  const firstReceipt = (await api('/api/fee-receipts/generate', {
    method: 'POST', token: accountantToken,
    body: { school_id: 1, student_id: studentId, payment_ids: [paymentId] },
  })).data.receipt;
  firstReceiptId = Number(firstReceipt.id);
  assert.equal(firstReceipt.receipt_schema_version, 2);
  assert.equal(firstReceipt.currency_snapshot, 'IQD');
  assert.equal(JSON.parse(firstReceipt.installment_plan_snapshot_json)[0].items[1].status, 'partial');
  await api(`/api/fee-receipts/${firstReceiptId}/cancel`, {
    method: 'PUT', token: accountantToken,
    body: { school_id: 1, cancel_reason: `${marker} replacement` },
  });
  const replacementReceipt = (await api('/api/fee-receipts/generate', {
    method: 'POST', token: accountantToken,
    body: { school_id: 1, student_id: studentId, payment_ids: [paymentId] },
  })).data.receipt;
  replacementReceiptId = Number(replacementReceipt.id);
  assert.equal(replacementReceipt.replaces_receipt_id, firstReceiptId);
  const verificationToken = replacementReceipt.verification_token;
  const publicVerification = await api(`/api/verify/receipt/${verificationToken}`);
  assert.equal(publicVerification.valid, true);
  assert.equal(publicVerification.status, 'active');
  assert.equal(publicVerification.currency, 'IQD');
  for (const field of ['payments', 'class_name', 'section_name']) assert.equal(Object.hasOwn(publicVerification, field), false);

  await api(`/api/parent/students/${studentId}/finance`, { token: parentToken, expected: 404 });
  d1(`INSERT INTO parent_student_links(school_id,parent_user_id,student_id,relationship,status,created_by_user_id,created_at,updated_at) VALUES(1,${parentId},${studentId},'QA','active',${accountantId},unixepoch(),unixepoch())`, 'write');
  parentLinkId = Number(d1(`SELECT id FROM parent_student_links WHERE school_id=1 AND parent_user_id=${parentId} AND student_id=${studentId}`, 'read')[0].id);
  const parentFinance = (await api(`/api/parent/students/${studentId}/finance`, { token: parentToken })).data;
  assert.equal(parentFinance.totals.original_fee, 100000);
  assert.equal(parentFinance.totals.paid_amount, 60000);
  assert.equal(parentFinance.totals.remaining_amount, 40000);
  assert.ok(!JSON.stringify(parentFinance).includes(privateSentinel));
  const parentReceipt = (await api(`/api/parent/fee-receipts/${replacementReceiptId}`, { token: parentToken })).data;
  assert.equal(parentReceipt.receipt_schema_version, 2);
  assert.ok(!JSON.stringify(parentReceipt).includes(privateSentinel));

  const replacementPlan = (await api(`/api/student-fees/${feeId}/installment-plan`, {
    method: 'PUT', token: accountantToken,
    body: {
      school_id: 1,
      expected_fee_revision: Number(allocatedPlan.fee.finance_revision),
      items: [
        { label: 'QA replacement first', amount: 40000, due_date: today },
        { label: 'QA replacement second', amount: 60000, due_date: '2027-02-15' },
      ],
    },
  })).data.plan;
  replacementPlanId = Number(replacementPlan.id);
  assert.notEqual(replacementPlanId, firstPlanId);
  await api(`/api/student-fees/${feeId}/installment-plan`, {
    method: 'DELETE', token: accountantToken,
    body: { school_id: 1, expected_plan_id: replacementPlanId },
  });
  assert.equal((await api(`/api/student-fees/${feeId}/installment-plan?school_id=1`, { token: accountantToken })).data.plan, null);

  d1(`UPDATE parent_student_links SET status='inactive',updated_at=unixepoch() WHERE id=${parentLinkId} AND status='active'`, 'write');
  await api(`/api/parent/students/${studentId}/finance`, { token: parentToken, expected: 404 });
  await api(`/api/parent/fee-receipts/${replacementReceiptId}`, { token: parentToken, expected: 404 });
  await api(`/api/fee-receipts/${replacementReceiptId}/cancel`, {
    method: 'PUT', token: accountantToken,
    body: { school_id: 1, cancel_reason: `${marker} QA complete` },
  });
  const cancelledVerification = await api(`/api/verify/receipt/${verificationToken}`);
  assert.equal(cancelledVerification.cancelled, true);
  assert.equal(cancelledVerification.status, 'cancelled');
  await api(`/api/fee-payments/${paymentId}/cancel`, {
    method: 'PUT', token: accountantToken,
    body: { school_id: 1, cancel_reason: `${marker} QA complete` },
  });
  const finalAccount = (await api(`/api/student-finance/${studentId}?school_id=1`, { token: accountantToken })).data;
  const finalFee = finalAccount.fees.find(row => Number(row.id) === feeId);
  assert.deepEqual([finalFee.paid_amount, finalFee.remaining_amount, finalFee.status], [0, 100000, 'pending']);
  functionalPass = true;
} finally {
  const ids = d1(`SELECT (SELECT id FROM users WHERE email=${sqlText(accountantEmail)}) AS accountant_id,(SELECT id FROM users WHERE email=${sqlText(parentEmail)}) AS parent_id,(SELECT id FROM students WHERE school_id=1 AND student_number=${sqlText(studentNumber)}) AS student_id`, 'read')[0];
  accountantId ||= Number(ids?.accountant_id || 0) || null;
  parentId ||= Number(ids?.parent_id || 0) || null;
  studentId ||= Number(ids?.student_id || 0) || null;
  if (studentId) {
    d1(`UPDATE parent_student_links SET status='inactive',updated_at=unixepoch() WHERE school_id=1 AND student_id=${studentId} AND status='active'`, 'write');
    if (accountantId) {
      d1(`UPDATE fee_receipts SET status='cancelled',cancelled_at=unixepoch(),cancelled_by_user_id=${accountantId},cancel_reason=${sqlText(`${marker} cleanup`)},updated_at=unixepoch() WHERE school_id=1 AND student_id=${studentId} AND status='active'`, 'write');
      d1(`UPDATE fee_payments SET status='cancelled',cancelled_at=unixepoch(),cancelled_by_user_id=${accountantId},cancel_reason=${sqlText(`${marker} cleanup`)} WHERE school_id=1 AND student_id=${studentId} AND status='active'`, 'write');
      d1(`UPDATE fee_installment_plans SET status='cancelled',deactivated_at=unixepoch(),deactivated_by_user_id=${accountantId},updated_at=unixepoch() WHERE school_id=1 AND student_fee_id IN (SELECT id FROM student_fees WHERE student_id=${studentId} AND school_id=1) AND status='active'`, 'write');
    }
    d1(`UPDATE students SET status='archived',updated_at=unixepoch() WHERE id=${studentId} AND school_id=1 AND student_number=${sqlText(studentNumber)}`, 'write');
  }
  d1(`UPDATE users SET status='inactive',auth_version=auth_version+1,updated_at=unixepoch() WHERE email IN (${sqlText(accountantEmail)},${sqlText(parentEmail)}) AND status='active'`, 'write');

  if (studentId && accountantId && parentId) {
    const cleanup = d1(`SELECT (SELECT COUNT(*) FROM users WHERE id IN (${accountantId},${parentId}) AND status='inactive') AS inactive_users,(SELECT COUNT(*) FROM students WHERE id=${studentId} AND status='archived') AS archived_students,(SELECT COUNT(*) FROM parent_student_links WHERE school_id=1 AND parent_user_id=${parentId} AND student_id=${studentId} AND status='inactive') AS inactive_parent_links,(SELECT COUNT(*) FROM student_fees WHERE school_id=1 AND student_id=${studentId}) AS fees,(SELECT COUNT(*) FROM student_fees WHERE school_id=1 AND student_id=${studentId} AND paid_amount=0 AND status='pending') AS clean_fees,(SELECT COUNT(*) FROM fee_payments WHERE school_id=1 AND student_id=${studentId}) AS payments,(SELECT COUNT(*) FROM fee_payments WHERE school_id=1 AND student_id=${studentId} AND status='cancelled') AS cancelled_payments,(SELECT COUNT(*) FROM fee_receipts WHERE school_id=1 AND student_id=${studentId}) AS receipts,(SELECT COUNT(*) FROM fee_receipts WHERE school_id=1 AND student_id=${studentId} AND status='cancelled' AND receipt_schema_version=2) AS cancelled_v2_receipts,(SELECT COUNT(*) FROM fee_installment_plans WHERE school_id=1 AND student_fee_id IN (SELECT id FROM student_fees WHERE student_id=${studentId} AND school_id=1)) AS plans,(SELECT COUNT(*) FROM fee_installment_plans WHERE school_id=1 AND student_fee_id IN (SELECT id FROM student_fees WHERE student_id=${studentId} AND school_id=1) AND status IN ('superseded','cancelled')) AS inactive_plans,(SELECT COUNT(*) FROM treasury_transactions WHERE school_id=1 AND source_type='fee_payment' AND source_id IN (SELECT id FROM fee_payments WHERE student_id=${studentId} AND school_id=1) AND status='cancelled') AS cancelled_treasury,(SELECT current_balance FROM treasury_accounts WHERE school_id=1) AS treasury_balance,(SELECT COUNT(*) FROM finance_fee_readiness WHERE school_id=1 AND healthy!=1) AS fee_unhealthy,(SELECT COUNT(*) FROM finance_treasury_readiness WHERE school_id=1 AND healthy!=1) AS treasury_unhealthy,(SELECT COUNT(*) FROM pragma_foreign_key_check) AS foreign_key_violations`, 'read')[0];
    assert.deepEqual(
      [cleanup.inactive_users, cleanup.archived_students, cleanup.inactive_parent_links, cleanup.fees, cleanup.clean_fees, cleanup.payments, cleanup.cancelled_payments, cleanup.receipts, cleanup.cancelled_v2_receipts, cleanup.plans, cleanup.inactive_plans, cleanup.cancelled_treasury, cleanup.treasury_balance, cleanup.fee_unhealthy, cleanup.treasury_unhealthy, cleanup.foreign_key_violations],
      [2, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 1, baseline.treasury_balance, 0, 0, 0],
    );
    cleanupPass = true;
  }
}

assert.equal(functionalPass, true, 'Functional QA did not finish');
assert.equal(cleanupPass, true, 'QA soft cleanup did not finish');
const identifiers = d1(`SELECT (SELECT id FROM users WHERE email=${sqlText(accountantEmail)}) AS accountant_user_id,(SELECT id FROM users WHERE email=${sqlText(parentEmail)}) AS parent_user_id,(SELECT id FROM students WHERE school_id=1 AND student_number=${sqlText(studentNumber)}) AS student_id,(SELECT id FROM parent_student_links WHERE school_id=1 AND parent_user_id=${parentId} AND student_id=${studentId}) AS parent_link_id,(SELECT id FROM student_fees WHERE school_id=1 AND student_id=${studentId}) AS fee_id`, 'read')[0];
const evidence = {
  staging_only: true,
  target,
  target_id: targetId,
  preview_origin: preview.origin,
  marker,
  functional_qa: {
    plan_create: true,
    partial_allocation: true,
    plan_replace: true,
    plan_soft_disable_via_api: true,
    receipt_issue_cancel_reissue: true,
    public_qr_active_and_cancelled: true,
    parent_read_only_and_sanitized: true,
    parent_revocation_immediate: true,
  },
  identifiers: {
    ...identifiers,
    payment_id: paymentId,
    first_receipt_id: firstReceiptId,
    replacement_receipt_id: replacementReceiptId,
    first_plan_id: firstPlanId,
    replacement_plan_id: replacementPlanId,
  },
  cleanup: {
    users_inactive: true,
    student_archived: true,
    parent_link_inactive: true,
    plans_retained_inactive: true,
    receipts_retained_cancelled: true,
    payment_retained_cancelled: true,
    treasury_effect_reversed_once: true,
    baseline_treasury_balance_restored: true,
    no_sql_delete: true,
  },
  command_summary: commandEvidence,
};
writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence));
