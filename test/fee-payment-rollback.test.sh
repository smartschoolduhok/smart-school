#!/usr/bin/env bash
# ============================================
# Phase 8 Part 1: Treasury Rollback Test Script
# Simulates treasury insert failure during fee-payment POST
# Validates compensating rollback behavior
# ============================================
set -uo pipefail

BASE_URL="http://localhost:3000"
DB_FILE=$(ls -t /home/user/webapp/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite 2>/dev/null | head -1)
if [ -z "$DB_FILE" ]; then
  DB_FILE="/home/user/webapp/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/9ba2b04bf514d9facfd57ed57d849e77241a7adc99d1c1545d06688b43d84248.sqlite"
fi

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

fail_count=0
pass_count=0

function assert() {
  local msg="$1"
  shift
  if "$@"; then
    echo -e "${GREEN}PASS${NC}: $msg"
    ((pass_count++)) || true
  else
    echo -e "${RED}FAIL${NC}: $msg"
    ((fail_count++)) || true
  fi
}

# Step 1: Check server
if ! curl -sf "$BASE_URL/" &>/dev/null; then
  echo -e "${YELLOW}WARN${NC}: Server not responding on $BASE_URL"
  exit 1
fi

# Step 2: Login as accountant@rafidain.iq (password accountant123)
TOKEN_RESPONSE=$(curl -s -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"accountant@rafidain.iq","password":"accountant123"}')
TOKEN=$(echo "$TOKEN_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('token',''))" 2>/dev/null || echo '')

if [ -z "$TOKEN" ]; then
  echo -e "${YELLOW}WARN${NC}: Accountant login failed, trying owner..."
  TOKEN_RESPONSE=$(curl -s -X POST "$BASE_URL/api/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"email":"owner@rafidain.iq","password":"owner123"}')
  TOKEN=$(echo "$TOKEN_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('token',''))" 2>/dev/null || echo '')
fi

assert "Login succeeded (token received)" [ -n "$TOKEN" ]

if [ -z "$TOKEN" ]; then
  echo -e "${RED}CRITICAL${NC}: Cannot login. Response: $TOKEN_RESPONSE"
  exit 1
fi

# Step 3: Get a pending fee or create one
FEES_RESPONSE=$(curl -s "$BASE_URL/api/student-fees?status=pending" \
  -H "Authorization: Bearer $TOKEN" 2>/dev/null || echo '{"data":[]}')
STUDENT_FEE_ID=$(echo "$FEES_RESPONSE" | python3 -c "
import sys,json
d=json.load(sys.stdin)
fees=d.get('data', [])
print(fees[0].get('id','') if fees else '')
" 2>/dev/null || echo '')

if [ -z "$STUDENT_FEE_ID" ]; then
  echo -e "${YELLOW}WARN${NC}: No pending fees found. Creating a test fee first..."
  STUDENTS_RESPONSE=$(curl -s "$BASE_URL/api/students?school_id=2" \
    -H "Authorization: Bearer $TOKEN" 2>/dev/null || echo '{"data":[]}')
  STUDENT_ID=$(echo "$STUDENTS_RESPONSE" | python3 -c "
import sys,json
d=json.load(sys.stdin)
students=d.get('data', [])
print(students[0].get('id','') if students else '')
" 2>/dev/null || echo '')
  assert "Got a student for test fee creation" [ -n "$STUDENT_ID" ]

  if [ -n "$STUDENT_ID" ]; then
    CREATE_FEE=$(curl -s -X POST "$BASE_URL/api/student-fees" \
      -H "Authorization: Bearer $TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"school_id\":2,\"student_id\":$STUDENT_ID,\"fee_type\":\"test-fee-rollback\",\"amount\":100,\"currency\":\"IQD\",\"due_date\":null,\"notes\":\"test\"}")
    STUDENT_FEE_ID=$(echo "$CREATE_FEE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('id',''))" 2>/dev/null || echo '')
  fi
fi

assert "Got a student_fee_id to test with" [ -n "$STUDENT_FEE_ID" ]

if [ -z "$STUDENT_FEE_ID" ]; then
  echo -e "${RED}CRITICAL${NC}: Cannot proceed without a student_fee_id."
  exit 1
fi

# Step 4: Capture pre-test fee state
ORIGINAL_PAID=''
ORIGINAL_STATUS=''
if [ -f "$DB_FILE" ]; then
  ROW=$(sqlite3 "$DB_FILE" "SELECT printf('%.0f',paid_amount), status FROM student_fees WHERE id=$STUDENT_FEE_ID;" 2>/dev/null || echo '')
  ORIGINAL_PAID=$(echo "$ROW" | cut -d'|' -f1)
  ORIGINAL_STATUS=$(echo "$ROW" | cut -d'|' -f2)
  echo "Pre-test state: paid_amount=$ORIGINAL_PAID status=$ORIGINAL_STATUS"
fi

# Step 5: POST fee-payment with _force_treasury_failure=true
PAYMENT_RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST "$BASE_URL/api/fee-payments" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"student_fee_id\":$STUDENT_FEE_ID,\"amount\":10,\"payment_method\":\"cash\",\"payment_date\":$(date +%s),\"_force_treasury_failure\":true}")

BODY=$(echo "$PAYMENT_RESPONSE" | sed -n '1,/HTTP_STATUS:/p' | sed '$d')
STATUS=$(echo "$PAYMENT_RESPONSE" | grep 'HTTP_STATUS:' | sed 's/HTTP_STATUS://')

assert "HTTP status is 500" [ "$STATUS" = "500" ]
assert "Response contains Arabic error message" grep -q 'تعذر تسجيل الدفعة في الخزنة' <<< "$BODY"
assert "Response contains 'تم التراجع'" grep -q 'تم التراجع' <<< "$BODY"

# Step 6: Verify fee payment was NOT recorded
PAYMENTS_RESPONSE=$(curl -s "$BASE_URL/api/fee-payments?student_fee_id=$STUDENT_FEE_ID" \
  -H "Authorization: Bearer $TOKEN" 2>/dev/null || echo '{"data":[]}')
PAYMENT_COUNT=$(echo "$PAYMENTS_RESPONSE" | python3 -c "
import sys,json
d=json.load(sys.stdin)
print(len(d.get('data', [])))
" 2>/dev/null || echo '0')

assert "No fee payment recorded after rollback" [ "$PAYMENT_COUNT" -eq 0 ]

# Step 7: Verify student fee balance restored
if [ -f "$DB_FILE" ] && [ -n "$ORIGINAL_PAID" ]; then
  ROW_AFTER=$(sqlite3 "$DB_FILE" "SELECT printf('%.0f',paid_amount), status FROM student_fees WHERE id=$STUDENT_FEE_ID;" 2>/dev/null || echo '')
  PAID_AFTER=$(echo "$ROW_AFTER" | cut -d'|' -f1)
  STATUS_AFTER=$(echo "$ROW_AFTER" | cut -d'|' -f2)
  assert "Student fee paid_amount restored to original ($ORIGINAL_PAID)" [ "$PAID_AFTER" = "$ORIGINAL_PAID" ]
  assert "Student fee status restored to original ($ORIGINAL_STATUS)" [ "$STATUS_AFTER" = "$ORIGINAL_STATUS" ]
fi

# Step 8: Verify no receipt created
if [ -f "$DB_FILE" ]; then
  RECEIPT_COUNT=$(sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM fee_receipts WHERE student_fee_id=$STUDENT_FEE_ID AND status='active';" 2>/dev/null || echo '0')
  assert "No receipt created for this fee" [ "$RECEIPT_COUNT" -eq 0 ]
fi

# Summary
echo ""
echo "========================================"
echo "Tests passed: $pass_count"
echo "Tests failed: $fail_count"
echo "========================================"

if [ "$fail_count" -gt 0 ]; then
  exit 1
fi
