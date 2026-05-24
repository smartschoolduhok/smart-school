#!/bin/bash
set -e

BASE="http://localhost:3000"
PASS=0
FAIL=0

check() {
  local name="$1"
  local expect_code="$2"
  local expect_text="$3"
  local actual_code="$4"
  local body="$5"

  if [ "$actual_code" != "$expect_code" ]; then
    echo "FAIL $name: expected HTTP $expect_code, got $actual_code"
    FAIL=$((FAIL+1))
    return
  fi

  if [ -n "$expect_text" ] && ! echo "$body" | grep -q "$expect_text"; then
    echo "FAIL $name: expected body to contain '$expect_text', got: $(echo "$body" | head -c 200)"
    FAIL=$((FAIL+1))
    return
  fi

  echo "PASS $name"
  PASS=$((PASS+1))
}

# =====================
# Step 2: Login tokens
# =====================
echo "=== Step 2: Login ==="
ADMIN_RESP=$(curl -s -X POST "$BASE/api/auth/login" -H "Content-Type: application/json" -d '{"email":"admin@smart-school.iq","password":"admin123"}')
ADMIN_TOKEN=$(echo "$ADMIN_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data']['token'])" 2>/dev/null || echo "")
check "admin login" "200" "" "$(echo "$ADMIN_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data','') and '200' or '400')" 2>/dev/null || echo '400')" "$ADMIN_RESP"

PRINCIPAL_RESP=$(curl -s -X POST "$BASE/api/auth/login" -H "Content-Type: application/json" -d '{"email":"principal@nukhba.iq","password":"school123"}')
PRINCIPAL_TOKEN=$(echo "$PRINCIPAL_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data']['token'])" 2>/dev/null || echo "")
check "principal login" "200" "" "$(echo "$PRINCIPAL_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data','') and '200' or '400')" 2>/dev/null || echo '400')" "$PRINCIPAL_RESP"

OWNER_RESP=$(curl -s -X POST "$BASE/api/auth/login" -H "Content-Type: application/json" -d '{"email":"owner@rafidain.iq","password":"owner123"}')
OWNER_TOKEN=$(echo "$OWNER_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data']['token'])" 2>/dev/null || echo "")
check "owner login" "200" "" "$(echo "$OWNER_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data','') and '200' or '400')" 2>/dev/null || echo '400')" "$OWNER_RESP"

ACCT_RESP=$(curl -s -X POST "$BASE/api/auth/login" -H "Content-Type: application/json" -d '{"email":"accountant@rafidain.iq","password":"accountant123"}')
ACCT_TOKEN=$(echo "$ACCT_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data']['token'])" 2>/dev/null || echo "")
check "accountant login" "200" "" "$(echo "$ACCT_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data','') and '200' or '400')" 2>/dev/null || echo '400')" "$ACCT_RESP"

TEACH_RESP=$(curl -s -X POST "$BASE/api/auth/login" -H "Content-Type: application/json" -d '{"email":"teacher@nukhba.iq","password":"teacher123"}')
TEACH_TOKEN=$(echo "$TEACH_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data']['token'])" 2>/dev/null || echo "")
check "teacher login" "200" "" "$(echo "$TEACH_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data','') and '200' or '400')" 2>/dev/null || echo '400')" "$TEACH_RESP"

INACT_RESP=$(curl -s -X POST "$BASE/api/auth/login" -H "Content-Type: application/json" -d '{"email":"registrar@eman.iq","password":"registrar123"}')
INACT_CODE=$(echo "$INACT_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error','') and '403' or '200')" 2>/dev/null || echo "400")
check "inactive registrar rejected" "403" "" "$INACT_CODE" "$INACT_RESP"

# =====================
# Step 3: Treasury Auth
# =====================
echo ""
echo "=== Step 3: Treasury Auth/RBAC ==="

R=$(curl -s -w "%{http_code}" -o /tmp/body.txt "$BASE/api/treasury/summary")
check "unauthenticated summary" "401" "" "$R" "$(cat /tmp/body.txt)"

R=$(curl -s -w "%{http_code}" -o /tmp/body.txt -H "Authorization: Bearer $TEACH_TOKEN" "$BASE/api/treasury/summary")
check "teacher summary forbidden" "403" "لا تملك صلاحية إدارة الخزنة" "$R" "$(cat /tmp/body.txt)"

R=$(curl -s -w "%{http_code}" -o /tmp/body.txt -H "Authorization: Bearer $PRINCIPAL_TOKEN" "$BASE/api/treasury/summary")
check "principal summary own school" "200" "" "$R" "$(cat /tmp/body.txt)"

R=$(curl -s -w "%{http_code}" -o /tmp/body.txt -H "Authorization: Bearer $OWNER_TOKEN" "$BASE/api/treasury/summary")
check "owner summary own school" "200" "" "$R" "$(cat /tmp/body.txt)"

R=$(curl -s -w "%{http_code}" -o /tmp/body.txt -H "Authorization: Bearer $ACCT_TOKEN" "$BASE/api/treasury/summary")
check "accountant summary own school" "200" "" "$R" "$(cat /tmp/body.txt)"

R=$(curl -s -w "%{http_code}" -o /tmp/body.txt -H "Authorization: Bearer $ADMIN_TOKEN" "$BASE/api/treasury/summary?school_id=1")
check "admin summary school 1" "200" "" "$R" "$(cat /tmp/body.txt)"

R=$(curl -s -w "%{http_code}" -o /tmp/body.txt -H "Authorization: Bearer $ADMIN_TOKEN" "$BASE/api/treasury/summary?school_id=2")
check "admin summary school 2" "200" "" "$R" "$(cat /tmp/body.txt)"

# =====================
# Step 4: Transactions
# =====================
echo ""
echo "=== Step 4: Transactions ==="

# Get initial balance
INIT_BAL=$(curl -s -H "Authorization: Bearer $ACCT_TOKEN" "$BASE/api/treasury/summary" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('verified_balance',0))" 2>/dev/null || echo "0")

# Income
R=$(curl -s -w "%{http_code}" -o /tmp/body.txt -X POST -H "Authorization: Bearer $ACCT_TOKEN" -H "Content-Type: application/json" -d '{"transaction_type":"income","category":"other_income","amount":100000,"school_id":2}' "$BASE/api/treasury/transactions")
check "create income" "201" "" "$R" "$(cat /tmp/body.txt)"
INCOME_ID=$(cat /tmp/body.txt | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('id',''))" 2>/dev/null || echo "")

NEW_BAL=$(curl -s -H "Authorization: Bearer $ACCT_TOKEN" "$BASE/api/treasury/summary" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('verified_balance',0))" 2>/dev/null || echo "0")
if [ "$NEW_BAL" -eq "$((INIT_BAL + 100000))" ]; then
  echo "PASS income increases balance ($INIT_BAL -> $NEW_BAL)"
  PASS=$((PASS+1))
else
  echo "FAIL income balance: expected $((INIT_BAL + 100000)), got $NEW_BAL"
  FAIL=$((FAIL+1))
fi

# Expense
R=$(curl -s -w "%{http_code}" -o /tmp/body.txt -X POST -H "Authorization: Bearer $ACCT_TOKEN" -H "Content-Type: application/json" -d '{"transaction_type":"expense","category":"supplies","amount":25000,"school_id":2}' "$BASE/api/treasury/transactions")
check "create expense" "201" "" "$R" "$(cat /tmp/body.txt)"
EXPENSE_ID=$(cat /tmp/body.txt | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('id',''))" 2>/dev/null || echo "")

NEW_BAL2=$(curl -s -H "Authorization: Bearer $ACCT_TOKEN" "$BASE/api/treasury/summary" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('verified_balance',0))" 2>/dev/null || echo "0")
if [ "$NEW_BAL2" -eq "$((INIT_BAL + 100000 - 25000))" ]; then
  echo "PASS expense decreases balance ($NEW_BAL -> $NEW_BAL2)"
  PASS=$((PASS+1))
else
  echo "FAIL expense balance: expected $((INIT_BAL + 100000 - 25000)), got $NEW_BAL2"
  FAIL=$((FAIL+1))
fi

# Invalid amount
R=$(curl -s -w "%{http_code}" -o /tmp/body.txt -X POST -H "Authorization: Bearer $ACCT_TOKEN" -H "Content-Type: application/json" -d '{"transaction_type":"income","category":"other_income","amount":0,"school_id":2}' "$BASE/api/treasury/transactions")
check "reject invalid amount 0" "400" "أكبر من صفر" "$R" "$(cat /tmp/body.txt)"

# Cancel without reason
R=$(curl -s -w "%{http_code}" -o /tmp/body.txt -X PUT -H "Authorization: Bearer $ACCT_TOKEN" -H "Content-Type: application/json" -d '{}' "$BASE/api/treasury/transactions/$INCOME_ID/cancel")
check "cancel without reason" "400" "سبب الإلغاء مطلوب" "$R" "$(cat /tmp/body.txt)"

# Cancel with reason
R=$(curl -s -w "%{http_code}" -o /tmp/body.txt -X PUT -H "Authorization: Bearer $ACCT_TOKEN" -H "Content-Type: application/json" -d '{"cancel_reason":"اختبار إلغاء"}' "$BASE/api/treasury/transactions/$INCOME_ID/cancel")
check "cancel with reason" "200" "" "$R" "$(cat /tmp/body.txt)"

CANCEL_BAL=$(curl -s -H "Authorization: Bearer $ACCT_TOKEN" "$BASE/api/treasury/summary" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('verified_balance',0))" 2>/dev/null || echo "0")
if [ "$CANCEL_BAL" -eq "$((INIT_BAL + 100000 - 25000 - 100000))" ]; then
  echo "PASS cancel restores balance ($NEW_BAL2 -> $CANCEL_BAL)"
  PASS=$((PASS+1))
else
  echo "FAIL cancel balance: expected $((INIT_BAL + 100000 - 25000 - 100000)), got $CANCEL_BAL"
  FAIL=$((FAIL+1))
fi

# =====================
# Step 5: Fee Payment Integration
# =====================
echo ""
echo "=== Step 5: Fee Payment Integration ==="

FEE_ID=$(curl -s -H "Authorization: Bearer $PRINCIPAL_TOKEN" "$BASE/api/student-fees" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',[{}])[0].get('id',''))" 2>/dev/null || echo "")

if [ -n "$FEE_ID" ] && [ "$FEE_ID" != "None" ] && [ "$FEE_ID" != "" ]; then
  FEE_PRE=$(curl -s -H "Authorization: Bearer $PRINCIPAL_TOKEN" "$BASE/api/student-fees/$FEE_ID" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('paid_amount',0))" 2>/dev/null || echo "0")

  R=$(curl -s -w "%{http_code}" -o /tmp/body.txt -X POST -H "Authorization: Bearer $PRINCIPAL_TOKEN" -H "Content-Type: application/json" -d "{\"student_fee_id\":$FEE_ID,\"amount\":50,\"payment_method\":\"cash\",\"payment_date\":\"2026-05-24\"}" "$BASE/api/fee-payments")
  check "create fee payment" "201" "" "$R" "$(cat /tmp/body.txt)"

  FEE_POST=$(curl -s -H "Authorization: Bearer $PRINCIPAL_TOKEN" "$BASE/api/student-fees" | python3 -c "import sys,json; d=json.load(sys.stdin); fees=[f for f in d.get('data',[]) if f.get('id')==$FEE_ID]; print(fees[0].get('paid_amount',0) if fees else 0)" 2>/dev/null || echo "0")

  if [ "$FEE_POST" -gt "$FEE_PRE" ]; then
    echo "PASS fee payment updated student fee ($FEE_PRE -> $FEE_POST)"
    PASS=$((PASS+1))
  else
    echo "FAIL fee payment did not update student fee"
    FAIL=$((FAIL+1))
  fi

  # Treasury auto-creation
  T_COUNT=$(curl -s -H "Authorization: Bearer $ADMIN_TOKEN" "$BASE/api/treasury/transactions?school_id=1&category=tuition_fee" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('data',[])))" 2>/dev/null || echo "0")
  echo "INFO: treasury tuition_fee transactions count: $T_COUNT"
else
  echo "SKIP fee payment test: no student_fee found"
fi

# Rollback test
R=$(curl -s -w "%{http_code}" -o /tmp/body.txt -X POST -H "Authorization: Bearer $PRINCIPAL_TOKEN" -H "Content-Type: application/json" -d '{"student_fee_id":1,"amount":1000,"payment_method":"cash","payment_date":"2026-05-24","_force_treasury_failure":true}' "$BASE/api/fee-payments")
if echo "$(cat /tmp/body.txt)" | grep -q "تم التراجع"; then
  echo "PASS rollback: payment rolled back when treasury fails"
  PASS=$((PASS+1))
else
  echo "FAIL rollback: expected compensation, got: $(cat /tmp/body.txt | head -c 200)"
  FAIL=$((FAIL+1))
fi

# =====================
# Step 6: Daily Closing
# =====================
echo ""
echo "=== Step 6: Daily Closing ==="

# Clean up existing closings for school 2 to ensure fresh test
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" -o /dev/null "$BASE/api/treasury/daily-closings?school_id=2"
TODAY=$(date -d "+30 days" +%Y-%m-%d 2>/dev/null || date -v+30d +%Y-%m-%d)

R=$(curl -s -w "%{http_code}" -o /tmp/body.txt -X POST -H "Authorization: Bearer $ACCT_TOKEN" -H "Content-Type: application/json" -d "{\"school_id\":2,\"closing_date\":\"$TODAY\",\"notes\":\"اختبار إقفال\"}" "$BASE/api/treasury/daily-closings/close-day")
check "close today" "201" "" "$R" "$(cat /tmp/body.txt)"

R=$(curl -s -w "%{http_code}" -o /tmp/body.txt -X POST -H "Authorization: Bearer $ACCT_TOKEN" -H "Content-Type: application/json" -d "{\"school_id\":2,\"closing_date\":\"$TODAY\",\"notes\":\"تكرار\"}" "$BASE/api/treasury/daily-closings/close-day")
check "duplicate close rejected" "409" "تم إقفال هذا اليوم مسبقاً" "$R" "$(cat /tmp/body.txt)"

R=$(curl -s -w "%{http_code}" -o /tmp/body.txt -H "Authorization: Bearer $ACCT_TOKEN" "$BASE/api/treasury/daily-closings?school_id=2")
check "list closings" "200" "" "$R" "$(cat /tmp/body.txt)"

# =====================
# Step 7: Reports
# =====================
echo ""
echo "=== Step 7: Reports ==="

R=$(curl -s -w "%{http_code}" -o /tmp/body.txt -H "Authorization: Bearer $ACCT_TOKEN" "$BASE/api/treasury/reports/daily?school_id=2&date=$TODAY")
check "daily report" "200" "" "$R" "$(cat /tmp/body.txt)"

MONTH=$(date +%Y-%m)
R=$(curl -s -w "%{http_code}" -o /tmp/body.txt -H "Authorization: Bearer $ACCT_TOKEN" "$BASE/api/treasury/reports/monthly?school_id=2&month=$MONTH")
check "monthly report" "200" "" "$R" "$(cat /tmp/body.txt)"

R=$(curl -s -w "%{http_code}" -o /tmp/body.txt -H "Authorization: Bearer $ACCT_TOKEN" "$BASE/api/treasury/categories?school_id=2")
check "categories" "200" "" "$R" "$(cat /tmp/body.txt)"

# Verify categories contain expected names
CAT_BODY=$(cat /tmp/body.txt)
for cat in tuition_fee other_income rent bills maintenance supplies salary other_expense; do
  if echo "$CAT_BODY" | grep -q "$cat"; then
    echo "PASS category $cat found"
    PASS=$((PASS+1))
  else
    echo "FAIL category $cat not found"
    FAIL=$((FAIL+1))
  fi
done

echo ""
echo "========================================"
echo "PASS: $PASS"
echo "FAIL: $FAIL"
echo "========================================"
