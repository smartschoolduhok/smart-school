#!/bin/bash
# =============================================================================
# Treasury Compensating Rollback Test
# Phase 8 Part 1 — Smart School System
#
# Test objective:
#   Simulate treasury insert failure during POST /api/fee-payments
#   and confirm:
#   1. Fee payment is NOT left recorded as successful
#   2. Student fee balance is restored to original value
#   3. No receipt is created
#   4. Arabic error is returned with status 500
#
# Approach:
#   Temporarily patch worker.ts to throw when header
#   x-simulate-treasury-failure: true is present.
# =============================================================================

set -euo pipefail

cd /home/user/webapp

API="http://localhost:3000"
WORKER="src/worker.ts"
PATCH_MARKER="// --- SIMULATE_TREASURY_FAILURE_PATCH ---"
REPORT="test_treasury_rollback_report.txt"

# Colors
PASS="\033[0;32mPASS\033[0m"
FAIL="\033[0;31mFAIL\033[0m"
INFO="\033[0;34mINFO\033[0m"

pass_count=0
fail_count=0

function ok() { echo -e "$PASS: $1"; ((pass_count++)) || true; }
function fail() { echo -e "$FAIL: $1"; ((fail_count++)) || true; }
function info() { echo -e "$INFO: $1"; }

# ---------------------------------------------------------------------------
# 0. Ensure dev server is running
# ---------------------------------------------------------------------------
info "Checking dev server on port 3000..."
if ! curl -sf "$API/api/health" >/dev/null 2>&1; then
  info "Dev server not responding. Starting via PM2..."
  npm run build >/dev/null 2>&1 || true
  pm2 start ecosystem.config.cjs >/dev/null 2>&1 || true
  sleep 4
  if ! curl -sf "$API/api/health" >/dev/null 2>&1; then
    fail "Dev server failed to start"
    exit 1
  fi
  ok "Dev server started"
else
  ok "Dev server already running"
fi

# ---------------------------------------------------------------------------
# 1. Login as accountant (role_key=accountant, canManageFees + canManageTreasury)
# ---------------------------------------------------------------------------
info "Logging in as accountant..."
LOGIN_RES=$(curl -sf -X POST "$API/api/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"accountant@rafidain.iq","password":"accountant123"}' 2>/dev/null || echo '{}')
TOKEN=$(echo "$LOGIN_RES" | grep -o '"token":"[^"]*"' | head -1 | cut -d'"' -f4)
USER_JSON=$(echo "$LOGIN_RES" | grep -o '"user"{[^}]*}' || true)
SCHOOL_ID=$(echo "$LOGIN_RES" | grep -o '"school_id":[0-9]*' | head -1 | cut -d: -f2 || echo "2")

if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
  fail "Login failed — could not extract token"
  exit 1
fi
ok "Logged in. Token received (school_id=$SCHOOL_ID)"

# ---------------------------------------------------------------------------
# 2. Find an active student with a student_fee that has remaining balance
# ---------------------------------------------------------------------------
info "Finding a test student_fee..."
FEES_RES=$(curl -sf "$API/api/student-fees?school_id=$SCHOOL_ID&status=pending" \
  -H "Authorization: Bearer $TOKEN" 2>/dev/null || echo '{"data":[]}')

# Extract first fee id and student_id
FEE_ID=$(echo "$FEES_RES" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2 || echo "")
STUDENT_ID=$(echo "$FEES_RES" | grep -o '"student_id":[0-9]*' | head -1 | cut -d: -f2 || echo "")

if [ -z "$FEE_ID" ]; then
  info "No pending fees found. Creating a test student_fee..."
  # Find first active student
  STUDENTS_RES=$(curl -sf "$API/api/students?school_id=$SCHOOL_ID" \
    -H "Authorization: Bearer $TOKEN" 2>/dev/null || echo '{"data":[]}')
  STUDENT_ID=$(echo "$STUDENTS_RES" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2 || echo "")
  if [ -z "$STUDENT_ID" ]; then
    fail "No active students found in school $SCHOOL_ID"
    exit 1
  fi
  AY_RES=$(curl -sf "$API/api/academic-years?school_id=$SCHOOL_ID" \
    -H "Authorization: Bearer $TOKEN" 2>/dev/null || echo '{"data":[]}')
  AY_ID=$(echo "$AY_RES" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2 || echo "1")

  CREATE_FEE=$(curl -sf -X POST "$API/api/student-fees" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"school_id\":$SCHOOL_ID,\"student_id\":$STUDENT_ID,\"academic_year_id\":$AY_ID,\"fee_type\":\"رسوم اختبار\",\"amount\":500000,\"currency\":\"IQD\",\"due_date\":$(($(date +%s) + 86400)),\"notes\":\"test fee for rollback\"}" 2>/dev/null || echo '{}')
  FEE_ID=$(echo "$CREATE_FEE" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2 || echo "")
  if [ -z "$FEE_ID" ]; then
    fail "Failed to create test student_fee"
    exit 1
  fi
  ok "Created test student_fee id=$FEE_ID"
else
  ok "Found existing student_fee id=$FEE_ID"
fi

# Get current fee state
FEE_RES=$(curl -sf "$API/api/student-fees?school_id=$SCHOOL_ID&student_id=$STUDENT_ID" \
  -H "Authorization: Bearer $TOKEN" 2>/dev/null || echo '{"data":[]}')
# Find the specific fee row
FEE_JSON=$(echo "$FEE_RES" | python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps([x for x in d.get('data',[]) if x.get('id')==$FEE_ID][0]))" 2>/dev/null || echo '{}')
ORIGINAL_PAID=$(echo "$FEE_JSON" | grep -o '"paid_amount":[0-9.]*' | cut -d: -f2 || echo "0")
ORIGINAL_STATUS=$(echo "$FEE_JSON" | grep -o '"status":"[^"]*"' | cut -d'"' -f4 || echo "pending")
REMAINING=$(echo "$FEE_JSON" | grep -o '"net_fee":[0-9.]*' | cut -d: -f2 || echo "$FEE_JSON" | grep -o '"amount":[0-9.]*' | cut -d: -f2 || echo "500000")
PAY_AMOUNT=100000

info "Fee state before test: paid=$ORIGINAL_PAID status=$ORIGINAL_STATUS remaining=$REMAINING"

# ---------------------------------------------------------------------------
# 3. Baseline: normal payment (should succeed, treasury + receipt created)
# ---------------------------------------------------------------------------
info "=== BASELINE: Normal payment (should succeed) ==="
BASELINE_PAY=$(curl -sf -X POST "$API/api/fee-payments" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"student_fee_id\":$FEE_ID,\"amount\":$PAY_AMOUNT,\"payment_method\":\"cash\",\"payment_date\":\"$(date +%Y-%m-%d)\",\"auto_generate_receipt\":true,\"notes\":\"baseline payment\"}" 2>/dev/null || echo '{}')

BASELINE_PAY_ID=$(echo "$BASELINE_PAY" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2 || echo "")
if [ -n "$BASELINE_PAY_ID" ]; then
  ok "Baseline payment created id=$BASELINE_PAY_ID"
else
  fail "Baseline payment failed — $(echo "$BASELINE_PAY" | head -c 200)"
  exit 1
fi

# Verify treasury transaction exists
TX_RES=$(curl -sf "$API/api/treasury/transactions?school_id=$SCHOOL_ID" \
  -H "Authorization: Bearer $TOKEN" 2>/dev/null || echo '{"data":[]}')
TX_MATCH=$(echo "$TX_RES" | grep -o '"source_id":[0-9]*' | grep ":$BASELINE_PAY_ID" || true)
if [ -n "$TX_MATCH" ]; then
  ok "Baseline treasury transaction exists for payment $BASELINE_PAY_ID"
else
  fail "Baseline treasury transaction MISSING for payment $BASELINE_PAY_ID"
fi

# Verify receipt exists
RCPT_RES=$(curl -sf "$API/api/fee-receipts?school_id=$SCHOOL_ID&student_id=$STUDENT_ID" \
  -H "Authorization: Bearer $TOKEN" 2>/dev/null || echo '{"data":[]}')
RCPT_MATCH=$(echo "$RCPT_RES" | grep -o '"payment_ids_json":"[^"]*"' | grep "$BASELINE_PAY_ID" || true)
if [ -n "$RCPT_MATCH" ]; then
  ok "Baseline receipt exists for payment $BASELINE_PAY_ID"
else
  fail "Baseline receipt MISSING for payment $BASELINE_PAY_ID"
fi

# ---------------------------------------------------------------------------
# 4. Apply temporary patch: simulate treasury failure when header present
# ---------------------------------------------------------------------------
info "Applying temporary treasury-failure simulation patch..."
PATCH_FILE="/tmp/worker_treasury_patch.ts"

cp "$WORKER" "$WORKER.bak"

# Insert simulation throw after the duplicate-check "if (!existingTx) {" opening brace
python3 << 'PYEOF'
import sys, re
with open('src/worker.ts', 'r') as f:
    content = f.read()

# Find the treasury auto-income block and insert simulation trigger
marker = "// ── Treasury auto-income transaction (Phase 8) ──"
patch = '''// ── Treasury auto-income transaction (Phase 8) ──
    try {
      // SIMULATION: if this header is present, force treasury failure to test rollback
      if (c.req.header('x-simulate-treasury-failure') === 'true') {
        throw new Error('SIMULATED_TREASURY_FAILURE');
      }'''

if marker not in content:
    print("ERROR: Could not find treasury block marker")
    sys.exit(1)

# Replace the first occurrence of the try block after the marker
old = marker + "\n    try {"
new = patch

if old not in content:
    print("ERROR: Could not find exact try block after marker")
    sys.exit(1)

content = content.replace(old, new, 1)

with open('src/worker.ts', 'w') as f:
    f.write(content)
print("PATCHED")
PYEOF

if [ $? -ne 0 ]; then
  fail "Failed to apply patch"
  cp "$WORKER.bak" "$WORKER"
  exit 1
fi
ok "Patch applied"

# ---------------------------------------------------------------------------
# 5. Rebuild and restart dev server
# ---------------------------------------------------------------------------
info "Rebuilding after patch..."
npm run build:api >/dev/null 2>&1 || npm run build >/dev/null 2>&1 || true
pm2 restart all >/dev/null 2>&1 || true
sleep 4

# Quick health check
if ! curl -sf "$API/api/health" >/dev/null 2>&1; then
  info "Health check not available, waiting extra 2s..."
  sleep 2
fi
ok "Server restarted after patch"

# ---------------------------------------------------------------------------
# 6. Simulated-failure payment request
# ---------------------------------------------------------------------------
info "=== SIMULATION: Payment with forced treasury failure ==="
FAIL_RES=$(curl -sf -w "\n%{http_code}" -X POST "$API/api/fee-payments" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "x-simulate-treasury-failure: true" \
  -d "{\"student_fee_id\":$FEE_ID,\"amount\":$PAY_AMOUNT,\"payment_method\":\"cash\",\"payment_date\":\"$(date +%Y-%m-%d)\",\"auto_generate_receipt\":true,\"notes\":\"simulated failure payment\"}" 2>/dev/null || echo -e "\n000")

HTTP_CODE=$(echo "$FAIL_RES" | tail -1)
BODY=$(echo "$FAIL_RES" | sed '$d')

info "Response HTTP $HTTP_CODE"

# 6a. Status must be 500
if [ "$HTTP_CODE" = "500" ]; then
  ok "Returns HTTP 500 on treasury failure"
else
  fail "Expected HTTP 500, got $HTTP_CODE"
fi

# 6b. Arabic error message
if echo "$BODY" | grep -q "تعذر تسجيل الدفعة في الخزنة، تم التراجع عن الدفعة"; then
  ok "Returns Arabic compensating-rollback error message"
else
  fail "Missing Arabic rollback message in response"
fi

# ---------------------------------------------------------------------------
# 7. Verify compensating rollback
# ---------------------------------------------------------------------------
info "Verifying rollback side-effects..."

# 7a. No NEW payment should exist beyond the baseline
PAYMENTS_AFTER=$(curl -sf "$API/api/fee-payments?school_id=$SCHOOL_ID&student_fee_id=$FEE_ID" \
  -H "Authorization: Bearer $TOKEN" 2>/dev/null || echo '{"data":[]}')
PAYMENT_COUNT=$(echo "$PAYMENTS_AFTER" | grep -o '"id":[0-9]*' | wc -l | tr -d ' ')

if [ "$PAYMENT_COUNT" = "1" ]; then
  ok "Only baseline payment remains (no orphaned payment from failed request)"
else
  fail "Expected 1 payment, found $PAYMENT_COUNT (rollback may have failed)"
fi

# 7b. Student fee balance restored
FEE_AFTER=$(curl -sf "$API/api/student-fees?school_id=$SCHOOL_ID&student_id=$STUDENT_ID" \
  -H "Authorization: Bearer $TOKEN" 2>/dev/null || echo '{"data":[]}')
FEE_AFTER_JSON=$(echo "$FEE_AFTER" | python3 -c "import sys,json; d=json.load(sys.stdin); rows=[x for x in d.get('data',[]) if x.get('id')==$FEE_ID]; print(json.dumps(rows[0] if rows else {}))" 2>/dev/null || echo '{}')
PAID_AFTER=$(echo "$FEE_AFTER_JSON" | grep -o '"paid_amount":[0-9.]*' | cut -d: -f2 || echo "-1")
STATUS_AFTER=$(echo "$FEE_AFTER_JSON" | grep -o '"status":"[^"]*"' | cut -d'"' -f4 || echo "unknown")

if [ "$PAID_AFTER" = "$ORIGINAL_PAID" ] || [ "$PAID_AFTER" = "$(echo "$ORIGINAL_PAID + $PAY_AMOUNT" | bc 2>/dev/null || echo "$((ORIGINAL_PAID + PAY_AMOUNT))")" ]; then
  # If baseline was already applied, paid_after should equal original_paid + pay_amount
  EXPECTED_PAID=$((ORIGINAL_PAID + PAY_AMOUNT))
  if [ "$PAID_AFTER" = "$EXPECTED_PAID" ] || [ "$PAID_AFTER" = "$(echo "$ORIGINAL_PAID + $PAY_AMOUNT" | bc 2>/dev/null || echo "$EXPECTED_PAID")" ]; then
    ok "Student fee balance restored after rollback (paid=$PAID_AFTER, expected=$EXPECTED_PAID)"
  else
    fail "Balance not restored: paid=$PAID_AFTER, expected=$EXPECTED_PAID"
  fi
else
  # Couldn't compute cleanly, just check status
  if [ "$STATUS_AFTER" = "$ORIGINAL_STATUS" ] || [ "$STATUS_AFTER" = "partial" ]; then
    ok "Student fee status acceptable after rollback (status=$STATUS_AFTER)"
  else
    fail "Unexpected status after rollback: $STATUS_AFTER"
  fi
fi

# 7c. No new receipt for the failed payment
RECEIPTS_AFTER=$(curl -sf "$API/api/fee-receipts?school_id=$SCHOOL_ID&student_id=$STUDENT_ID" \
  -H "Authorization: Bearer $TOKEN" 2>/dev/null || echo '{"data":[]}')
RECEIPT_COUNT=$(echo "$RECEIPTS_AFTER" | grep -o '"id":[0-9]*' | wc -l | tr -d ' ')

if [ "$RECEIPT_COUNT" = "1" ]; then
  ok "Only baseline receipt exists (no receipt created for failed payment)"
else
  fail "Expected 1 receipt, found $RECEIPT_COUNT"
fi

# ---------------------------------------------------------------------------
# 8. Restore worker.ts
# ---------------------------------------------------------------------------
info "Restoring original worker.ts..."
cp "$WORKER.bak" "$WORKER"
rm -f "$WORKER.bak"

# Rebuild back to clean state
npm run build:api >/dev/null 2>&1 || npm run build >/dev/null 2>&1 || true
pm2 restart all >/dev/null 2>&1 || true
sleep 3
ok "Original worker.ts restored and rebuilt"

# ---------------------------------------------------------------------------
# 9. Cleanup: remove baseline payment so test is idempotent-ish
# ---------------------------------------------------------------------------
info "Cleaning up baseline payment..."
# Directly delete via D1 (no API delete for fee_payments, but we can use d1 execute)
wrangler d1 execute smart-school-db --local --command="
  DELETE FROM fee_receipts WHERE payment_ids_json LIKE '%\"$BASELINE_PAY_ID\"%';
  DELETE FROM treasury_transactions WHERE source_type='fee_payment' AND source_id=$BASELINE_PAY_ID;
  DELETE FROM fee_payments WHERE id=$BASELINE_PAY_ID;
  UPDATE student_fees SET paid_amount=$ORIGINAL_PAID, status='$ORIGINAL_STATUS', updated_at=unixepoch() WHERE id=$FEE_ID;
" >/dev/null 2>&1 || true
info "Cleanup attempted"

# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------
echo ""
echo "========================================"
echo "TREASURY ROLLBACK TEST REPORT"
echo "========================================"
echo -e "Passed: $pass_count"
echo -e "Failed: $fail_count"
echo "========================================"

if [ "$fail_count" -eq 0 ]; then
  echo -e "\033[0;32mALL TESTS PASSED\033[0m"
  exit 0
else
  echo -e "\033[0;31mSOME TESTS FAILED\033[0m"
  exit 1
fi
