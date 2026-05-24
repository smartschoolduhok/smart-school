#!/usr/bin/env bash
# ============================================
# Phase 8 Treasury API Integration Test
# Covers: access control, balance changes, cancel, close day, duplicate blocking
# ============================================
set -uo pipefail

BASE_URL="http://localhost:3000"
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

# Step 1: Health check
if ! curl -sf "$BASE_URL/" &>/dev/null; then
  echo -e "${YELLOW}WARN${NC}: Server not responding on $BASE_URL"
  exit 1
fi

# Step 2: Login as accountant
TOKEN_RES=$(curl -s -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"accountant@rafidain.iq","password":"accountant123"}')
ACC_TOKEN=$(echo "$TOKEN_RES" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('token',''))" 2>/dev/null || echo '')
ACC_SCHOOL=$(echo "$TOKEN_RES" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('user',{}).get('school_id','2'))" 2>/dev/null || echo '2')

assert "Accountant login succeeded" [ -n "$ACC_TOKEN" ]
if [ -z "$ACC_TOKEN" ]; then
  echo -e "${RED}CRITICAL${NC}: Cannot login as accountant"
  exit 1
fi

# Step 3: Login as teacher
TEACHER_RES=$(curl -s -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"teacher1@rafidain.iq","password":"teacher123"}')
TEACHER_TOKEN=$(echo "$TEACHER_RES" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('token',''))" 2>/dev/null || echo '')

if [ -z "$TEACHER_TOKEN" ]; then
  echo -e "${YELLOW}WARN${NC}: Teacher login failed (no teacher account?), trying fallback..."
  # Try any teacher-like account
  USERS_RES=$(curl -s "$BASE_URL/api/users?school_id=$ACC_SCHOOL" -H "Authorization: Bearer $ACC_TOKEN" 2>/dev/null || echo '{"data":[]}')
  TEACHER_EMAIL=$(echo "$USERS_RES" | python3 -c "import sys,json; d=json.load(sys.stdin); users=d.get('data',[]); t=[u for u in users if u.get('role_key')=='teacher']; print(t[0].get('email','') if t else '')" 2>/dev/null || echo '')
  if [ -n "$TEACHER_EMAIL" ]; then
    TEACHER_RES=$(curl -s -X POST "$BASE_URL/api/auth/login" \
      -H "Content-Type: application/json" \
      -d "{\"email\":\"$TEACHER_EMAIL\",\"password\":\"teacher123\"}")
    TEACHER_TOKEN=$(echo "$TEACHER_RES" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('token',''))" 2>/dev/null || echo '')
  fi
fi

# Step 4: Accountant GET /api/treasury/summary → 200
SUMMARY_RES=$(curl -s -w "\n%{http_code}" "$BASE_URL/api/treasury/summary?school_id=$ACC_SCHOOL" \
  -H "Authorization: Bearer $ACC_TOKEN")
SUMMARY_STATUS=$(echo "$SUMMARY_RES" | tail -1)
assert "Accountant GET /api/treasury/summary returns 200" [ "$SUMMARY_STATUS" = "200" ]

# Step 5: Teacher GET /api/treasury/summary → 403 (if teacher token available)
if [ -n "$TEACHER_TOKEN" ]; then
  TEACHER_SUMMARY=$(curl -s -w "\n%{http_code}" "$BASE_URL/api/treasury/summary?school_id=$ACC_SCHOOL" \
    -H "Authorization: Bearer $TEACHER_TOKEN")
  TEACHER_STATUS=$(echo "$TEACHER_SUMMARY" | tail -1)
  assert "Teacher GET /api/treasury/summary returns 403" [ "$TEACHER_STATUS" = "403" ]
else
  echo -e "${YELLOW}SKIP${NC}: No teacher token available for 403 test"
fi

# Step 6: Create income transaction → balance increases
BEFORE_BALANCE=$(echo "$SUMMARY_RES" | sed '$d' | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('cached_balance',0))" 2>/dev/null || echo '0')
INCOME_RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/treasury/transactions" \
  -H "Authorization: Bearer $ACC_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"school_id\":$ACC_SCHOOL,\"transaction_type\":\"income\",\"category\":\"test_income\",\"amount\":50000,\"currency\":\"IQD\",\"description\":\"API test income\"}")
INCOME_STATUS=$(echo "$INCOME_RES" | tail -1)
INCOME_BODY=$(echo "$INCOME_RES" | sed '$d')
INCOME_ID=$(echo "$INCOME_BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('id',''))" 2>/dev/null || echo '')
assert "POST income transaction returns 201" [ "$INCOME_STATUS" = "201" ]
assert "Income transaction has id" [ -n "$INCOME_ID" ]

# Step 7: Verify balance increased
SUMMARY2=$(curl -s "$BASE_URL/api/treasury/summary?school_id=$ACC_SCHOOL" \
  -H "Authorization: Bearer $ACC_TOKEN")
AFTER_BALANCE=$(echo "$SUMMARY2" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('cached_balance',0))" 2>/dev/null || echo '0')
assert "Balance increased after income (before=$BEFORE_BALANCE after=$AFTER_BALANCE)" [ "$AFTER_BALANCE" -gt "$BEFORE_BALANCE" ]

# Step 8: Create expense transaction → balance decreases
EXPENSE_RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/treasury/transactions" \
  -H "Authorization: Bearer $ACC_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"school_id\":$ACC_SCHOOL,\"transaction_type\":\"expense\",\"category\":\"test_expense\",\"amount\":20000,\"currency\":\"IQD\",\"description\":\"API test expense\"}")
EXPENSE_STATUS=$(echo "$EXPENSE_RES" | tail -1)
EXPENSE_BODY=$(echo "$EXPENSE_RES" | sed '$d')
EXPENSE_ID=$(echo "$EXPENSE_BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('id',''))" 2>/dev/null || echo '')
assert "POST expense transaction returns 201" [ "$EXPENSE_STATUS" = "201" ]
assert "Expense transaction has id" [ -n "$EXPENSE_ID" ]

# Step 9: Verify balance decreased after expense
SUMMARY3=$(curl -s "$BASE_URL/api/treasury/summary?school_id=$ACC_SCHOOL" \
  -H "Authorization: Bearer $ACC_TOKEN")
AFTER_EXPENSE_BALANCE=$(echo "$SUMMARY3" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('cached_balance',0))" 2>/dev/null || echo '0')
assert "Balance decreased after expense (after_income=$AFTER_BALANCE after_expense=$AFTER_EXPENSE_BALANCE)" [ "$AFTER_EXPENSE_BALANCE" -lt "$AFTER_BALANCE" ]

# Step 10: Cancel income transaction with reason → status cancelled and balance restored
CANCEL_RES=$(curl -s -w "\n%{http_code}" -X PUT "$BASE_URL/api/treasury/transactions/$INCOME_ID/cancel" \
  -H "Authorization: Bearer $ACC_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reason":"API test cancellation"}')
CANCEL_STATUS=$(echo "$CANCEL_RES" | tail -1)
CANCEL_BODY=$(echo "$CANCEL_RES" | sed '$d')
CANCEL_MSG=$(echo "$CANCEL_BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('status',''))" 2>/dev/null || echo '')
assert "Cancel income returns 200" [ "$CANCEL_STATUS" = "200" ]
assert "Cancelled transaction status is 'cancelled'" [ "$CANCEL_MSG" = "cancelled" ]

# Step 11: Verify balance restored after cancel
SUMMARY4=$(curl -s "$BASE_URL/api/treasury/summary?school_id=$ACC_SCHOOL" \
  -H "Authorization: Bearer $ACC_TOKEN")
AFTER_CANCEL_BALANCE=$(echo "$SUMMARY4" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('cached_balance',0))" 2>/dev/null || echo '0')
assert "Balance restored after cancel (expense_balance=$AFTER_EXPENSE_BALANCE cancel_balance=$AFTER_CANCEL_BALANCE)" [ "$AFTER_CANCEL_BALANCE" -eq "$AFTER_EXPENSE_BALANCE" ]

# Step 12: Close day → success
TODAY=$(date +%Y-%m-%d)
CLOSE_RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/treasury/daily-closings/close-day" \
  -H "Authorization: Bearer $ACC_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"school_id\":$ACC_SCHOOL,\"closing_date\":\"$TODAY\",\"notes\":\"API test close day\"}")
CLOSE_STATUS=$(echo "$CLOSE_RES" | tail -1)
CLOSE_BODY=$(echo "$CLOSE_RES" | sed '$d')
CLOSE_ID=$(echo "$CLOSE_BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('id',''))" 2>/dev/null || echo '')
assert "Close day returns 201 or 200" [ "$CLOSE_STATUS" = "201" ] || [ "$CLOSE_STATUS" = "200" ]

# Step 13: Duplicate close day → blocked
CLOSE_DUP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/treasury/daily-closings/close-day" \
  -H "Authorization: Bearer $ACC_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"school_id\":$ACC_SCHOOL,\"closing_date\":\"$TODAY\",\"notes\":\"duplicate\"}")
CLOSE_DUP_STATUS=$(echo "$CLOSE_DUP" | tail -1)
assert "Duplicate close day returns 409 or 400 or 422" [ "$CLOSE_DUP_STATUS" = "409" ] || [ "$CLOSE_DUP_STATUS" = "400" ] || [ "$CLOSE_DUP_STATUS" = "422" ]

# Summary
echo ""
echo "========================================"
echo "Treasury API Tests passed: $pass_count"
echo "Treasury API Tests failed: $fail_count"
echo "========================================"

if [ "$fail_count" -gt 0 ]; then
  exit 1
fi
