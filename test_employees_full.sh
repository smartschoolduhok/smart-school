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
    echo "FAIL $name: expected body to contain '$expect_text', got: $(echo "$body" | head -c 300)"
    FAIL=$((FAIL+1))
    return
  fi

  echo "PASS $name"
  PASS=$((PASS+1))
}

# =====================
# Step 1: Login tokens
# =====================
echo "=== Step 1: Login ==="
ADMIN_RESP=$(curl -s -X POST "$BASE/api/auth/login" -H "Content-Type: application/json" -d '{"email":"admin@smart-school.iq","password":"admin123"}')
ADMIN_TOKEN=$(echo "$ADMIN_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data']['token'])" 2>/dev/null || echo "")
check "admin login" "200" "" "$(echo "$ADMIN_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data','') and '200' or '400')" 2>/dev/null || echo '400')" "$ADMIN_RESP"

PRINCIPAL_RESP=$(curl -s -X POST "$BASE/api/auth/login" -H "Content-Type: application/json" -d '{"email":"principal@nukhba.iq","password":"school123"}')
PRINCIPAL_TOKEN=$(echo "$PRINCIPAL_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data']['token'])" 2>/dev/null || echo "")
check "principal login" "200" "" "$(echo "$PRINCIPAL_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data','') and '200' or '400')" 2>/dev/null || echo '400')" "$PRINCIPAL_RESP"

ACCT_RESP=$(curl -s -X POST "$BASE/api/auth/login" -H "Content-Type: application/json" -d '{"email":"accountant@rafidain.iq","password":"accountant123"}')
ACCT_TOKEN=$(echo "$ACCT_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data']['token'])" 2>/dev/null || echo "")
check "accountant login" "200" "" "$(echo "$ACCT_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data','') and '200' or '400')" 2>/dev/null || echo '400')" "$ACCT_RESP"

TEACH_RESP=$(curl -s -X POST "$BASE/api/auth/login" -H "Content-Type: application/json" -d '{"email":"teacher@nukhba.iq","password":"teacher123"}')
TEACH_TOKEN=$(echo "$TEACH_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data']['token'])" 2>/dev/null || echo "")
check "teacher login" "200" "" "$(echo "$TEACH_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data','') and '200' or '400')" 2>/dev/null || echo '400')" "$TEACH_RESP"

# Get school_id for principal (nukhba=1) and accountant (rafidain=2)
PRINCIPAL_SCHOOL=$(echo "$PRINCIPAL_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('user',{}).get('school_id',''))" 2>/dev/null || echo "1")
ACCT_SCHOOL=$(echo "$ACCT_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('user',{}).get('school_id',''))" 2>/dev/null || echo "2")

echo "Principal school_id: $PRINCIPAL_SCHOOL, Accountant school_id: $ACCT_SCHOOL"
# Use ACCT_SCHOOL for all salary/employee tests since accountant operates there
TEST_SCHOOL=$ACCT_SCHOOL

# =====================
# Step 2: Auth/RBAC
# =====================
echo ""
echo "=== Step 2: Auth/RBAC ==="

# Unauthenticated
R=$(curl -s -w "%{http_code}" -o /tmp/body.txt "$BASE/api/employees")
check "unauthenticated employees list" "401" "" "$R" "$(cat /tmp/body.txt)"

# Teacher forbidden
R=$(curl -s -w "%{http_code}" -o /tmp/body.txt -H "Authorization: Bearer $TEACH_TOKEN" "$BASE/api/employees")
check "teacher employees list forbidden" "403" "لا تملك صلاحية" "$R" "$(cat /tmp/body.txt)"

# Accountant read-only
R=$(curl -s -w "%{http_code}" -o /tmp/body.txt -H "Authorization: Bearer $ACCT_TOKEN" "$BASE/api/employees")
check "accountant employees list allowed" "200" "" "$R" "$(cat /tmp/body.txt)"

# Accountant cannot create
R=$(curl -s -w "%{http_code}" -o /tmp/body.txt -X POST -H "Authorization: Bearer $ACCT_TOKEN" -H "Content-Type: application/json" -d "{\"full_name\":\"Test Employee\",\"employee_number\":\"TEST001\",\"job_title\":\"مدرس\",\"salary_amount\":500000,\"school_id\":$ACCT_SCHOOL}" "$BASE/api/employees")
check "accountant create employee forbidden" "403" "لا تملك صلاحية" "$R" "$(cat /tmp/body.txt)"

# Principal can create
R=$(curl -s -w "%{http_code}" -o /tmp/body.txt -X POST -H "Authorization: Bearer $PRINCIPAL_TOKEN" -H "Content-Type: application/json" -d "{\"full_name\":\"Test Employee\",\"employee_number\":\"TEST001\",\"job_title\":\"مدرس\",\"salary_amount\":500000,\"school_id\":$PRINCIPAL_SCHOOL}" "$BASE/api/employees")
check "principal create employee" "201" "" "$R" "$(cat /tmp/body.txt)"
EMP_ID=$(cat /tmp/body.txt | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('id',''))" 2>/dev/null || echo "")

# =====================
# Step 3: Employee CRUD
# =====================
echo ""
echo "=== Step 3: Employee CRUD ==="

# Create with negative salary blocked
R=$(curl -s -w "%{http_code}" -o /tmp/body.txt -X POST -H "Authorization: Bearer $PRINCIPAL_TOKEN" -H "Content-Type: application/json" -d "{\"full_name\":\"Bad Employee\",\"employee_number\":\"BAD001\",\"job_title\":\"مدرس\",\"salary_amount\":-100,\"school_id\":$PRINCIPAL_SCHOOL}" "$BASE/api/employees")
check "reject negative salary" "400" "صفر أو أكبر" "$R" "$(cat /tmp/body.txt)"

# Get single employee
R=$(curl -s -w "%{http_code}" -o /tmp/body.txt -H "Authorization: Bearer $PRINCIPAL_TOKEN" "$BASE/api/employees/$EMP_ID")
check "get single employee" "200" "TEST001" "$R" "$(cat /tmp/body.txt)"

# Update employee
R=$(curl -s -w "%{http_code}" -o /tmp/body.txt -X PUT -H "Authorization: Bearer $PRINCIPAL_TOKEN" -H "Content-Type: application/json" -d "{\"full_name\":\"Updated Employee\",\"salary_amount\":600000}" "$BASE/api/employees/$EMP_ID")
check "update employee" "200" "" "$R" "$(cat /tmp/body.txt)"

# Update with negative salary blocked
R=$(curl -s -w "%{http_code}" -o /tmp/body.txt -X PUT -H "Authorization: Bearer $PRINCIPAL_TOKEN" -H "Content-Type: application/json" -d "{\"salary_amount\":-50}" "$BASE/api/employees/$EMP_ID")
check "reject update negative salary" "400" "صفر أو أكبر" "$R" "$(cat /tmp/body.txt)"

# Archive employee
R=$(curl -s -w "%{http_code}" -o /tmp/body.txt -X PUT -H "Authorization: Bearer $PRINCIPAL_TOKEN" "$BASE/api/employees/$EMP_ID/archive")
check "archive employee" "200" "" "$R" "$(cat /tmp/body.txt)"

# Verify archived
ARCHIVED_STATUS=$(curl -s -H "Authorization: Bearer $PRINCIPAL_TOKEN" "$BASE/api/employees/$EMP_ID" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('status',''))" 2>/dev/null || echo "")
if [ "$ARCHIVED_STATUS" = "archived" ]; then
  echo "PASS verify archived status"
  PASS=$((PASS+1))
else
  echo "FAIL verify archived status: got '$ARCHIVED_STATUS'"
  FAIL=$((FAIL+1))
fi

# Accountant cannot archive
R=$(curl -s -w "%{http_code}" -o /tmp/body.txt -X PUT -H "Authorization: Bearer $ACCT_TOKEN" "$BASE/api/employees/$EMP_ID/archive")
check "accountant archive forbidden" "403" "لا تملك صلاحية" "$R" "$(cat /tmp/body.txt)"

# =====================
# Step 4: Salary Generation
# =====================
echo ""
echo "=== Step 4: Salary Generation ==="

# Create active employee for salary tests (in principal's school so principal can create)
R=$(curl -s -w "%{http_code}" -o /tmp/body.txt -X POST -H "Authorization: Bearer $PRINCIPAL_TOKEN" -H "Content-Type: application/json" -d "{\"full_name\":\"Salary Test Employee\",\"employee_number\":\"SAL001\",\"job_title\":\"محاسب\",\"salary_amount\":750000,\"school_id\":$PRINCIPAL_SCHOOL}" "$BASE/api/employees")
check "create active employee for salary" "201" "" "$R" "$(cat /tmp/body.txt)"
ACTIVE_EMP_ID=$(cat /tmp/body.txt | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('id',''))" 2>/dev/null || echo "")

# Generate salary for active employee (principal can manage salaries)
R=$(curl -s -w "%{http_code}" -o /tmp/body.txt -X POST -H "Authorization: Bearer $PRINCIPAL_TOKEN" -H "Content-Type: application/json" -d "{\"employee_id\":$ACTIVE_EMP_ID,\"month\":5,\"year\":2026,\"base_salary\":750000,\"bonus_amount\":50000,\"deduction_amount\":25000}" "$BASE/api/salaries/generate")
check "generate salary for active employee" "201" "" "$R" "$(cat /tmp/body.txt)"
SALARY_ID=$(cat /tmp/body.txt | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('id',''))" 2>/dev/null || echo "")

# Verify net_salary formula
NET_SAL=$(cat /tmp/body.txt | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('net_salary',''))" 2>/dev/null || echo "")
if [ "$NET_SAL" = "775000" ]; then
  echo "PASS net_salary formula: 750000 + 50000 - 25000 = $NET_SAL"
  PASS=$((PASS+1))
else
  echo "FAIL net_salary formula: expected 775000, got $NET_SAL"
  FAIL=$((FAIL+1))
fi

# Duplicate generation blocked
R=$(curl -s -w "%{http_code}" -o /tmp/body.txt -X POST -H "Authorization: Bearer $PRINCIPAL_TOKEN" -H "Content-Type: application/json" -d "{\"employee_id\":$ACTIVE_EMP_ID,\"month\":5,\"year\":2026,\"base_salary\":750000,\"bonus_amount\":0,\"deduction_amount\":0}" "$BASE/api/salaries/generate")
check "duplicate salary generation blocked" "409" "يوجد راتب مسجل لهذا الموظف في هذا الشهر" "$R" "$(cat /tmp/body.txt)"

# Deduction > base + bonus blocked
R=$(curl -s -w "%{http_code}" -o /tmp/body.txt -X POST -H "Authorization: Bearer $PRINCIPAL_TOKEN" -H "Content-Type: application/json" -d "{\"employee_id\":$ACTIVE_EMP_ID,\"month\":6,\"year\":2026,\"base_salary\":100000,\"bonus_amount\":0,\"deduction_amount\":200000}" "$BASE/api/salaries/generate")
check "deduction greater than base+bonus blocked" "400" "مبلغ الاستقطاع أكبر من الراتب والمكافأة" "$R" "$(cat /tmp/body.txt)"

# Generate-all should skip archived employee, create for active
R=$(curl -s -w "%{http_code}" -o /tmp/body.txt -X POST -H "Authorization: Bearer $PRINCIPAL_TOKEN" -H "Content-Type: application/json" -d "{\"school_id\":$PRINCIPAL_SCHOOL,\"month\":6,\"year\":2026,\"bonus_amount\":0,\"deduction_amount\":0}" "$BASE/api/salaries/generate-all")
check "generate-all salaries" "200" "" "$R" "$(cat /tmp/body.txt)"

# Check generate-all skipped archived and has reason
GEN_ALL_BODY=$(cat /tmp/body.txt)
if echo "$GEN_ALL_BODY" | grep -q "skipped"; then
  echo "PASS generate-all has skipped list"
  PASS=$((PASS+1))
else
  echo "FAIL generate-all missing skipped list"
  FAIL=$((FAIL+1))
fi

# Get salaries list
R=$(curl -s -w "%{http_code}" -o /tmp/body.txt -H "Authorization: Bearer $PRINCIPAL_TOKEN" "$BASE/api/salaries?school_id=$PRINCIPAL_SCHOOL")
check "list salaries" "200" "" "$R" "$(cat /tmp/body.txt)"

# Get single salary
R=$(curl -s -w "%{http_code}" -o /tmp/body.txt -H "Authorization: Bearer $PRINCIPAL_TOKEN" "$BASE/api/salaries/$SALARY_ID")
check "get single salary" "200" "" "$R" "$(cat /tmp/body.txt)"

# =====================
# Step 5: Salary Payment + Treasury Integration
# =====================
echo ""
echo "=== Step 5: Salary Payment + Treasury Integration ==="

# Get initial treasury balance for principal's school (PRINCIPAL_SCHOOL)
INIT_BAL=$(curl -s -H "Authorization: Bearer $ADMIN_TOKEN" "$BASE/api/treasury/summary?school_id=$PRINCIPAL_SCHOOL" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('verified_balance',0))" 2>/dev/null || echo "0")

# Ensure there is enough balance to pay salary (add income if needed)
if [ "$INIT_BAL" -lt "1000000" ]; then
  curl -s -o /dev/null -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d "{\"transaction_type\":\"income\",\"category\":\"other_income\",\"amount\":2000000,\"school_id\":$PRINCIPAL_SCHOOL,\"description\":\"Test income for salary\"}" "$BASE/api/treasury/transactions"
  INIT_BAL=$(curl -s -H "Authorization: Bearer $ADMIN_TOKEN" "$BASE/api/treasury/summary?school_id=$PRINCIPAL_SCHOOL" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('verified_balance',0))" 2>/dev/null || echo "0")
fi
echo "Initial treasury balance: $INIT_BAL"

# Pay salary
R=$(curl -s -w "%{http_code}" -o /tmp/body.txt -X PUT -H "Authorization: Bearer $PRINCIPAL_TOKEN" -H "Content-Type: application/json" -d "{\"payment_method\":\"cash\"}" "$BASE/api/salaries/$SALARY_ID/pay")
check "pay salary" "200" "" "$R" "$(cat /tmp/body.txt)"

# Verify salary is marked paid
PAID_STATUS=$(curl -s -H "Authorization: Bearer $PRINCIPAL_TOKEN" "$BASE/api/salaries/$SALARY_ID" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('status',''))" 2>/dev/null || echo "")
PAID_TREASURY_ID=$(curl -s -H "Authorization: Bearer $PRINCIPAL_TOKEN" "$BASE/api/salaries/$SALARY_ID" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('treasury_transaction_id',''))" 2>/dev/null || echo "")
if [ "$PAID_STATUS" = "paid" ] && [ -n "$PAID_TREASURY_ID" ] && [ "$PAID_TREASURY_ID" != "None" ]; then
  echo "PASS salary marked paid with treasury_transaction_id=$PAID_TREASURY_ID"
  PASS=$((PASS+1))
else
  echo "FAIL salary not paid correctly: status=$PAID_STATUS treasury_id=$PAID_TREASURY_ID"
  FAIL=$((FAIL+1))
fi

# Verify treasury balance decreased
NEW_BAL=$(curl -s -H "Authorization: Bearer $ADMIN_TOKEN" "$BASE/api/treasury/summary?school_id=$PRINCIPAL_SCHOOL" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('verified_balance',0))" 2>/dev/null || echo "0")
EXPECTED_BAL=$((INIT_BAL - 775000))
if [ "$NEW_BAL" -eq "$EXPECTED_BAL" ]; then
  echo "PASS treasury balance decreased ($INIT_BAL -> $NEW_BAL)"
  PASS=$((PASS+1))
else
  echo "FAIL treasury balance: expected $EXPECTED_BAL, got $NEW_BAL"
  FAIL=$((FAIL+1))
fi

# Duplicate payment blocked
R=$(curl -s -w "%{http_code}" -o /tmp/body.txt -X PUT -H "Authorization: Bearer $PRINCIPAL_TOKEN" -H "Content-Type: application/json" -d "{\"payment_method\":\"cash\"}" "$BASE/api/salaries/$SALARY_ID/pay")
check "duplicate salary payment blocked" "409" "تم دفع هذا الراتب مسبقاً" "$R" "$(cat /tmp/body.txt)"

# Verify treasury transaction linkage via salary record (already confirmed paid with treasury_transaction_id)
if [ -n "$PAID_TREASURY_ID" ] && [ "$PAID_TREASURY_ID" != "None" ]; then
  echo "PASS treasury transaction linked to salary"
  PASS=$((PASS+1))
else
  echo "FAIL treasury transaction not linked to salary"
  FAIL=$((FAIL+1))
fi

# =====================
# Step 6: Cancel Salary
# =====================
echo ""
echo "=== Step 6: Cancel Salary ==="

# Cancel paid salary (requires cancel_reason)
R=$(curl -s -w "%{http_code}" -o /tmp/body.txt -X PUT -H "Authorization: Bearer $PRINCIPAL_TOKEN" -H "Content-Type: application/json" -d "{\"cancel_reason\":\"خطأ في الحساب\"}" "$BASE/api/salaries/$SALARY_ID/cancel")
check "cancel paid salary" "200" "" "$R" "$(cat /tmp/body.txt)"

# Verify salary is cancelled
CAN_STATUS=$(curl -s -H "Authorization: Bearer $PRINCIPAL_TOKEN" "$BASE/api/salaries/$SALARY_ID" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('status',''))" 2>/dev/null || echo "")
if [ "$CAN_STATUS" = "cancelled" ]; then
  echo "PASS salary status is cancelled"
  PASS=$((PASS+1))
else
  echo "FAIL cancel status: expected cancelled, got $CAN_STATUS"
  FAIL=$((FAIL+1))
fi

# Verify treasury balance restored after cancel
RESTORED_BAL=$(curl -s -H "Authorization: Bearer $ADMIN_TOKEN" "$BASE/api/treasury/summary?school_id=$PRINCIPAL_SCHOOL" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('verified_balance',0))" 2>/dev/null || echo "0")
if [ "$RESTORED_BAL" -eq "$INIT_BAL" ]; then
  echo "PASS treasury balance restored after cancel ($NEW_BAL -> $RESTORED_BAL)"
  PASS=$((PASS+1))
else
  echo "FAIL cancel balance restore: expected $INIT_BAL, got $RESTORED_BAL"
  FAIL=$((FAIL+1))
fi

# Cancel already cancelled salary
R=$(curl -s -w "%{http_code}" -o /tmp/body.txt -X PUT -H "Authorization: Bearer $PRINCIPAL_TOKEN" -H "Content-Type: application/json" -d "{\"cancel_reason\":\"تكرار\"}" "$BASE/api/salaries/$SALARY_ID/cancel")
check "cancel already-cancelled salary blocked" "409" "هذا الراتب ملغى مسبقاً" "$R" "$(cat /tmp/body.txt)"

# Create another salary to test cancel without treasury reversal
R=$(curl -s -w "%{http_code}" -o /tmp/body.txt -X POST -H "Authorization: Bearer $PRINCIPAL_TOKEN" -H "Content-Type: application/json" -d "{\"employee_id\":$ACTIVE_EMP_ID,\"month\":7,\"year\":2026,\"base_salary\":500000,\"bonus_amount\":0,\"deduction_amount\":0}" "$BASE/api/salaries/generate")
check "generate unpaid salary for cancel test" "201" "" "$R" "$(cat /tmp/body.txt)"
UNPAID_SAL_ID=$(cat /tmp/body.txt | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('id',''))" 2>/dev/null || echo "")

# Cancel unpaid salary
R=$(curl -s -w "%{http_code}" -o /tmp/body.txt -X PUT -H "Authorization: Bearer $PRINCIPAL_TOKEN" -H "Content-Type: application/json" -d "{\"cancel_reason\":\"موظف في إجازة\"}" "$BASE/api/salaries/$UNPAID_SAL_ID/cancel")
check "cancel unpaid salary" "200" "" "$R" "$(cat /tmp/body.txt)"

# Generate another fresh unpaid salary to test cancel without reason
R=$(curl -s -w "%{http_code}" -o /tmp/body.txt -X POST -H "Authorization: Bearer $PRINCIPAL_TOKEN" -H "Content-Type: application/json" -d "{\"employee_id\":$ACTIVE_EMP_ID,\"month\":8,\"year\":2026,\"base_salary\":500000,\"bonus_amount\":0,\"deduction_amount\":0}" "$BASE/api/salaries/generate")
check "generate another unpaid salary" "201" "" "$R" "$(cat /tmp/body.txt)"
FRESH_SAL_ID=$(cat /tmp/body.txt | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('id',''))" 2>/dev/null || echo "")

# Cancel without reason
R=$(curl -s -w "%{http_code}" -o /tmp/body.txt -X PUT -H "Authorization: Bearer $PRINCIPAL_TOKEN" -H "Content-Type: application/json" -d "{}" "$BASE/api/salaries/$FRESH_SAL_ID/cancel")
check "cancel without reason blocked" "400" "سبب الإلغاء مطلوب" "$R" "$(cat /tmp/body.txt)"

# =====================
# Step 7: Salary Reports
# =====================
echo ""
echo "=== Step 7: Salary Reports ==="

R=$(curl -s -w "%{http_code}" -o /tmp/body.txt -H "Authorization: Bearer $PRINCIPAL_TOKEN" "$BASE/api/salaries/reports/monthly?school_id=$PRINCIPAL_SCHOOL&month=5&year=2026")
check "monthly salary report" "200" "" "$R" "$(cat /tmp/body.txt)"

# =====================
# Step 8: Archived Employee Skipped in Generation
# =====================
echo ""
echo "=== Step 8: Archived Employee Skipped ==="

# Verify archived employee is NOT in active employees list for salary generation
ARCHIVED_IN_LIST=$(curl -s -H "Authorization: Bearer $PRINCIPAL_TOKEN" "$BASE/api/employees?school_id=$PRINCIPAL_SCHOOL&status=active" | python3 -c "import sys,json; d=json.load(sys.stdin); ids=[str(e.get('id')) for e in d.get('data',[])]; print('$EMP_ID' in ids)" 2>/dev/null || echo "False")
if [ "$ARCHIVED_IN_LIST" = "False" ]; then
  echo "PASS archived employee not in active list"
  PASS=$((PASS+1))
else
  echo "FAIL archived employee still in active list"
  FAIL=$((FAIL+1))
fi

echo ""
echo "========================================"
echo "PASS: $PASS"
echo "FAIL: $FAIL"
echo "========================================"
