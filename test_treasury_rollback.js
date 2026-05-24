#!/usr/bin/env node
/**
 * Treasury Compensating Rollback Test
 * Phase 8 Part 1 — Smart School System
 *
 * Test objective:
 *   Simulate treasury insert failure during POST /api/fee-payments
 *   and confirm:
 *   1. Fee payment is NOT left recorded as successful
 *   2. Student fee balance is restored to original value
 *   3. No receipt is created
 *   4. Arabic error is returned with status 500
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const WORKER = path.join(__dirname, 'src', 'worker.ts');
const API = 'http://localhost:3000';
const PATCH_MARKER = '/* TEST_TREASURY_FAILURE_SIMULATION */';

let passCount = 0;
let failCount = 0;

function ok(msg) { console.log(`\x1b[32mPASS\x1b[0m: ${msg}`); passCount++; }
function fail(msg) { console.log(`\x1b[31mFAIL\x1b[0m: ${msg}`); failCount++; }
function info(msg) { console.log(`\x1b[34mINFO\x1b[0m: ${msg}`); }

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let body = {};
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  return { status: res.status, body, text };
}

async function main() {
  info('=== Treasury Compensating Rollback Test ===');

  // 0. Ensure server running
  info('Checking dev server...');
  try {
    await fetch(`${API}/api/health`);
    ok('Dev server is running');
  } catch {
    info('Starting dev server via PM2...');
    try {
      execSync('npm run build:api', { cwd: __dirname, stdio: 'ignore' });
    } catch {}
    try {
      execSync('pm2 restart all', { cwd: __dirname, stdio: 'ignore' });
    } catch {}
    await new Promise(r => setTimeout(r, 5000));
    try {
      await fetch(`${API}/api/health`);
      ok('Dev server started');
    } catch {
      fail('Dev server failed to start');
      process.exit(1);
    }
  }

  // 1. Login as accountant
  info('Logging in as accountant...');
  const loginRes = await fetchJson(`${API}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'accountant@rafidain.iq', password: 'accountant123' }),
  });
  if (loginRes.status !== 200 || !loginRes.body?.token) {
    fail('Login failed: ' + JSON.stringify(loginRes.body).slice(0,200));
    process.exit(1);
  }
  const TOKEN = loginRes.body.token;
  const USER = loginRes.body.user || {};
  const SCHOOL_ID = USER.school_id || 2;
  ok(`Logged in (school_id=${SCHOOL_ID})`);

  // 2. Find or create a student_fee with remaining balance
  info('Finding test student_fee...');
  const feesRes = await fetchJson(`${API}/api/student-fees?school_id=${SCHOOL_ID}&status=pending`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const fees = feesRes.body?.data || [];
  let FEE_ID, STUDENT_ID;
  if (fees.length > 0) {
    FEE_ID = fees[0].id;
    STUDENT_ID = fees[0].student_id;
    ok(`Using existing fee id=${FEE_ID}`);
  } else {
    // Need to create a student_fee; first find a student
    const studentsRes = await fetchJson(`${API}/api/students?school_id=${SCHOOL_ID}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    const students = studentsRes.body?.data || [];
    if (students.length === 0) { fail('No students available'); process.exit(1); }
    STUDENT_ID = students[0].id;
    const ayRes = await fetchJson(`${API}/api/academic-years?school_id=${SCHOOL_ID}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    const ay = (ayRes.body?.data || [])[0];
    const createFee = await fetchJson(`${API}/api/student-fees`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        school_id: SCHOOL_ID,
        student_id: STUDENT_ID,
        academic_year_id: ay?.id || 1,
        fee_type: 'رسوم اختبار rollback',
        amount: 500000,
        currency: 'IQD',
        due_date: Math.floor(Date.now()/1000) + 86400,
        notes: 'test fee for rollback',
      }),
    });
    if (!createFee.body?.data?.id) {
      fail('Failed to create test fee: ' + JSON.stringify(createFee.body).slice(0,200));
      process.exit(1);
    }
    FEE_ID = createFee.body.data.id;
    ok(`Created test fee id=${FEE_ID}`);
  }

  // Get baseline fee state
  const feeRes = await fetchJson(`${API}/api/student-fees?school_id=${SCHOOL_ID}&student_id=${STUDENT_ID}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const feeRow = (feeRes.body?.data || []).find(f => f.id === FEE_ID);
  const ORIGINAL_PAID = feeRow?.paid_amount || 0;
  const ORIGINAL_STATUS = feeRow?.status || 'pending';
  const TARGET_AMOUNT = feeRow?.net_fee || feeRow?.amount || 500000;
  const PAY_AMOUNT = 100000;
  info(`Baseline: paid=${ORIGINAL_PAID}, status=${ORIGINAL_STATUS}, target=${TARGET_AMOUNT}`);

  // 3. Baseline normal payment (should succeed)
  info('=== BASELINE: Normal payment ===');
  const baselineRes = await fetchJson(`${API}/api/fee-payments`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      student_fee_id: FEE_ID,
      amount: PAY_AMOUNT,
      payment_method: 'cash',
      payment_date: new Date().toISOString().split('T')[0],
      auto_generate_receipt: true,
      notes: 'baseline payment',
    }),
  });
  if (baselineRes.status !== 201 || !baselineRes.body?.data?.id) {
    fail('Baseline payment failed: ' + JSON.stringify(baselineRes.body).slice(0,200));
    process.exit(1);
  }
  const BASELINE_PAY_ID = baselineRes.body.data.id;
  ok(`Baseline payment created id=${BASELINE_PAY_ID}`);

  // Verify treasury transaction exists
  const txRes = await fetchJson(`${API}/api/treasury/transactions?school_id=${SCHOOL_ID}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const txs = txRes.body?.data || [];
  const baselineTx = txs.find(t => t.source_type === 'fee_payment' && t.source_id === BASELINE_PAY_ID);
  if (baselineTx) { ok('Baseline treasury transaction exists'); } else { fail('Baseline treasury transaction MISSING'); }

  // Verify receipt exists
  const rcptRes = await fetchJson(`${API}/api/fee-receipts?school_id=${SCHOOL_ID}&student_id=${STUDENT_ID}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const rcpts = rcptRes.body?.data || [];
  const baselineRcpt = rcpts.find(r => {
    try { const ids = JSON.parse(r.payment_ids_json || '[]'); return ids.includes(BASELINE_PAY_ID); } catch { return false; }
  });
  if (baselineRcpt) { ok('Baseline receipt exists'); } else { fail('Baseline receipt MISSING'); }

  // 4. Patch worker.ts to simulate failure
  info('Patching worker.ts to simulate treasury failure...');
  const originalSrc = fs.readFileSync(WORKER, 'utf-8');

  // Find the treasury auto-income block and inject simulation
  const searchStr = `    // ── Treasury auto-income transaction (Phase 8) ──\n    try {\n      // Check for duplicate treasury transaction`;
  if (!originalSrc.includes(searchStr)) {
    fail('Could not find treasury block marker in worker.ts');
    process.exit(1);
  }

  const patchStr = `    // ── Treasury auto-income transaction (Phase 8) ──\n    try {\n      // SIMULATION: force failure when header present\n      if (c.req.header('x-simulate-treasury-failure') === 'true') {\n        throw new Error('SIMULATED_TREASURY_FAILURE');\n      }\n      // Check for duplicate treasury transaction`;
  const patchedSrc = originalSrc.replace(searchStr, patchStr);
  if (patchedSrc === originalSrc) {
    fail('Patch did not apply (replace returned same string)');
    process.exit(1);
  }
  fs.writeFileSync(WORKER, patchedSrc, 'utf-8');
  ok('Patch applied');

  // 5. Rebuild and restart
  info('Rebuilding and restarting dev server...');
  try { execSync('npm run build:api', { cwd: __dirname, stdio: 'ignore' }); } catch {}
  try { execSync('pm2 restart all', { cwd: __dirname, stdio: 'ignore' }); } catch {}
  await new Promise(r => setTimeout(r, 4000));
  ok('Server restarted after patch');

  // 6. Simulated failure payment
  info('=== SIMULATION: Forced treasury failure ===');
  const failRes = await fetchJson(`${API}/api/fee-payments`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      'x-simulate-treasury-failure': 'true',
    },
    body: JSON.stringify({
      student_fee_id: FEE_ID,
      amount: PAY_AMOUNT,
      payment_method: 'cash',
      payment_date: new Date().toISOString().split('T')[0],
      auto_generate_receipt: true,
      notes: 'simulated failure payment',
    }),
  });

  if (failRes.status === 500) { ok('Returns HTTP 500'); } else { fail(`Expected HTTP 500, got ${failRes.status}`); }

  const bodyStr = JSON.stringify(failRes.body);
  if (bodyStr.includes('تعذر تسجيل الدفعة في الخزنة، تم التراجع عن الدفعة')) {
    ok('Returns Arabic rollback error message');
  } else {
    fail('Missing Arabic rollback error: ' + bodyStr.slice(0,200));
  }

  // 7. Verify rollback effects
  info('Verifying rollback side-effects...');

  // 7a. Only baseline payment remains
  const paymentsAfter = await fetchJson(`${API}/api/fee-payments?school_id=${SCHOOL_ID}&student_fee_id=${FEE_ID}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const payments = paymentsAfter.body?.data || [];
  if (payments.length === 1 && payments[0].id === BASELINE_PAY_ID) {
    ok('Only baseline payment remains (no orphaned payment)');
  } else {
    fail(`Expected 1 payment (baseline), found ${payments.length}`);
  }

  // 7b. Student fee balance restored
  const feeAfterRes = await fetchJson(`${API}/api/student-fees?school_id=${SCHOOL_ID}&student_id=${STUDENT_ID}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const feeAfter = (feeAfterRes.body?.data || []).find(f => f.id === FEE_ID);
  const expectedPaid = ORIGINAL_PAID + PAY_AMOUNT; // baseline added PAY_AMOUNT
  const paidAfter = feeAfter?.paid_amount ?? -999;
  if (paidAfter === expectedPaid) {
    ok(`Student fee balance correct after rollback (paid=${paidAfter}, expected=${expectedPaid})`);
  } else {
    fail(`Balance mismatch: paid=${paidAfter}, expected=${expectedPaid}`);
  }

  // 7c. No new receipt
  const rcptAfter = await fetchJson(`${API}/api/fee-receipts?school_id=${SCHOOL_ID}&student_id=${STUDENT_ID}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const rcptList = rcptAfter.body?.data || [];
  if (rcptList.length === 1) {
    ok('Only baseline receipt exists (no receipt for failed payment)');
  } else {
    fail(`Expected 1 receipt, found ${rcptList.length}`);
  }

  // 8. Restore worker.ts
  info('Restoring original worker.ts...');
  fs.writeFileSync(WORKER, originalSrc, 'utf-8');
  try { execSync('npm run build:api', { cwd: __dirname, stdio: 'ignore' }); } catch {}
  try { execSync('pm2 restart all', { cwd: __dirname, stdio: 'ignore' }); } catch {}
  await new Promise(r => setTimeout(r, 3000));
  ok('Original worker.ts restored and rebuilt');

  // 9. Cleanup baseline payment via D1 direct SQL
  info('Cleaning up baseline data via D1...');
  try {
    execSync(`npx wrangler d1 execute smart-school-db --local --command="
      DELETE FROM fee_receipts WHERE payment_ids_json LIKE '%\\\"${BASELINE_PAY_ID}\\\"%';
      DELETE FROM treasury_transactions WHERE source_type='fee_payment' AND source_id=${BASELINE_PAY_ID};
      DELETE FROM fee_payments WHERE id=${BASELINE_PAY_ID};
      UPDATE student_fees SET paid_amount=${ORIGINAL_PAID}, status='${ORIGINAL_STATUS}', updated_at=unixepoch() WHERE id=${FEE_ID};
    "`, { cwd: __dirname, stdio: 'ignore' });
  } catch (e) {
    info('Cleanup via wrangler d1 execute failed (non-fatal): ' + e.message);
  }

  // 10. Report
  console.log('');
  console.log('========================================');
  console.log('TREASURY ROLLBACK TEST REPORT');
  console.log('========================================');
  console.log(`Passed: ${passCount}`);
  console.log(`Failed: ${failCount}`);
  console.log('========================================');
  if (failCount === 0) {
    console.log('\x1b[32mALL TESTS PASSED\x1b[0m');
    process.exit(0);
  } else {
    console.log('\x1b[31mSOME TESTS FAILED\x1b[0m');
    process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
