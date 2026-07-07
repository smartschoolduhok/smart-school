#!/bin/bash
set -e

BASE="http://localhost:3000"
ADMIN_EMAIL="admin@smart-school.iq"
ADMIN_PASS="admin123"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASS=0
FAIL=0

# Unique suffix to avoid duplicate email collisions across runs
SUFFIX="$(date +%s%N)"

test_pass() {
  echo -e "  ${GREEN}✓ PASS${NC}: $1"
  PASS=$((PASS+1))
}

test_fail() {
  echo -e "  ${RED}✗ FAIL${NC}: $1"
  echo "    Response: $2"
  FAIL=$((FAIL+1))
}

# Get admin token
TOKEN=$(curl -s -X POST "$BASE/api/auth/login" -H "Content-Type: application/json" -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASS\"}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('token',''))" 2>/dev/null || echo "")

if [ -z "$TOKEN" ]; then
  echo -e "${RED}Failed to get admin token. Aborting.${NC}"
  exit 1
fi

echo "=================================="
echo "QA TEST SUITE - Clean Migration DB"
echo "=================================="

# 1. User CRUD: Create
CREATE_USER=$(curl -s -X POST "$BASE/api/users" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d "{\"full_name\":\"Test User\",\"email\":\"testuser_${SUFFIX}@example.iq\",\"password\":\"testpass123\",\"role_id\":5,\"school_id\":1,\"phone\":\"07701234567\"}")
USER_ID=$(echo "$CREATE_USER" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('id',''))" 2>/dev/null || echo "")
if [ -n "$USER_ID" ] && [ "$USER_ID" != "null" ] && [ "$USER_ID" != "" ]; then
  test_pass "User CRUD: Create user (id=$USER_ID)"
else
  test_fail "User CRUD: Create user" "$CREATE_USER"
fi

# 2. User CRUD: Read list
USER_LIST=$(curl -s "$BASE/api/users" -H "Authorization: Bearer $TOKEN")
USER_COUNT=$(echo "$USER_LIST" | python3 -c "import sys,json; d=json.load(sys.stdin); data=d.get('data',[]); print(len(data) if isinstance(data,list) else 0)" 2>/dev/null || echo "0")
if [ "$USER_COUNT" -gt 0 ]; then
  test_pass "User CRUD: Read user list (count=$USER_COUNT)"
else
  test_fail "User CRUD: Read user list" "$USER_LIST"
fi

# 3. User CRUD: Update (include school_id to satisfy API validation)
if [ -n "$USER_ID" ] && [ "$USER_ID" != "null" ]; then
  UPDATE_USER=$(curl -s -X PUT "$BASE/api/users/$USER_ID" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"full_name":"Updated Test User","phone":"07709998877","school_id":1}')
  UPDATED_NAME=$(echo "$UPDATE_USER" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('full_name',''))" 2>/dev/null || echo "")
  if [ "$UPDATED_NAME" = "Updated Test User" ]; then
    test_pass "User CRUD: Update user"
  else
    test_fail "User CRUD: Update user" "$UPDATE_USER"
  fi
else
  test_fail "User CRUD: Update user" "No user ID from create"
fi

# 4. New user login (principal)
PRINCIPAL_LOGIN=$(curl -s -X POST "$BASE/api/auth/login" -H "Content-Type: application/json" -d '{"email":"principal@nukhba.iq","password":"school123"}')
PRINCIPAL_TOKEN=$(echo "$PRINCIPAL_LOGIN" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('token',''))" 2>/dev/null || echo "")
if [ -n "$PRINCIPAL_TOKEN" ]; then
  test_pass "New user login (principal)"
else
  test_fail "New user login (principal)" "$PRINCIPAL_LOGIN"
fi

# 5. Duplicate email blocked
DUP_EMAIL=$(curl -s -X POST "$BASE/api/users" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"full_name":"Duplicate","email":"admin@smart-school.iq","password":"dup123","role_id":5,"school_id":1}')
DUP_ERR=$(echo "$DUP_EMAIL" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error',''))" 2>/dev/null || echo "")
if echo "$DUP_ERR" | grep -qi "مستخدم مسبقاً\|duplicate\|exists\|email"; then
  test_pass "Duplicate email blocked"
else
  test_fail "Duplicate email blocked" "$DUP_EMAIL"
fi

# 6. School role without school_id blocked
SCHOOL_ROLE=$(curl -s -X POST "$BASE/api/users" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"full_name":"No School","email":"noschool@example.iq","password":"test123","role_id":3}')
SCHOOL_ERR=$(echo "$SCHOOL_ROLE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error',''))" 2>/dev/null || echo "")
if echo "$SCHOOL_ERR" | grep -qi "school_id\|required\|مدرسة\|مطلوب"; then
  test_pass "School role without school_id blocked"
else
  test_fail "School role without school_id blocked" "$SCHOOL_ROLE"
fi

# 7. Reset password
RESET_USER=$(curl -s -X POST "$BASE/api/users" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d "{\"full_name\":\"Reset Pass User\",\"email\":\"resetpass_${SUFFIX}@example.iq\",\"password\":\"oldpass123\",\"role_id\":5,\"school_id\":1}")
RESET_ID=$(echo "$RESET_USER" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('id',''))" 2>/dev/null || echo "")
if [ -n "$RESET_ID" ] && [ "$RESET_ID" != "null" ] && [ "$RESET_ID" != "" ]; then
  RESET_RES=$(curl -s -X PUT "$BASE/api/users/$RESET_ID/reset-password" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"password":"newpass123"}')
  RESET_OK=$(echo "$RESET_RES" | python3 -c "import sys,json; d=json.load(sys.stdin); data=d.get('data',{}); print('ok' if data.get('success') or 'message' in d else 'fail')" 2>/dev/null || echo "fail")
  if [ "$RESET_OK" = "ok" ]; then
    test_pass "Reset password"
  else
    test_fail "Reset password" "$RESET_RES"
  fi
else
  test_fail "Reset password" "Failed to create user for reset test: $RESET_USER"
fi

# 8. Deactivate/reactivate user
DEAC_USER=$(curl -s -X POST "$BASE/api/users" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d "{\"full_name\":\"Deactivate User\",\"email\":\"deac_${SUFFIX}@example.iq\",\"password\":\"deac123\",\"role_id\":5,\"school_id\":1}")
DEAC_ID=$(echo "$DEAC_USER" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('id',''))" 2>/dev/null || echo "")
if [ -n "$DEAC_ID" ] && [ "$DEAC_ID" != "null" ] && [ "$DEAC_ID" != "" ]; then
  DEAC_RES=$(curl -s -X PUT "$BASE/api/users/$DEAC_ID/status" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"status":"inactive"}')
  DEAC_STATUS=$(echo "$DEAC_RES" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('status',''))" 2>/dev/null || echo "")
  if [ "$DEAC_STATUS" = "inactive" ]; then
    REAC_RES=$(curl -s -X PUT "$BASE/api/users/$DEAC_ID/status" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"status":"active"}')
    REAC_STATUS=$(echo "$REAC_RES" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('status',''))" 2>/dev/null || echo "")
    if [ "$REAC_STATUS" = "active" ]; then
      test_pass "Deactivate/reactivate user"
    else
      test_fail "Reactivate user" "$REAC_RES"
    fi
  else
    test_fail "Deactivate user" "$DEAC_RES"
  fi
else
  test_fail "Deactivate/reactivate user" "Failed to create user: $DEAC_USER"
fi

# 9. RBAC: Principal can list users in same school
PRINCIPAL_USERS=$(curl -s "$BASE/api/users?school_id=1" -H "Authorization: Bearer $PRINCIPAL_TOKEN" 2>/dev/null || echo "")
PU_COUNT=$(echo "$PRINCIPAL_USERS" | python3 -c "import sys,json; d=json.load(sys.stdin); data=d.get('data',[]); print(len(data) if isinstance(data,list) else 0)" 2>/dev/null || echo "0")
if [ "$PU_COUNT" -gt 0 ]; then
  test_pass "RBAC: Principal list users in school"
else
  test_fail "RBAC: Principal list users in school" "$PRINCIPAL_USERS"
fi

# 10. RBAC: Principal cannot create school (admin only)
PRINCIPAL_SCHOOL=$(curl -s -X POST "$BASE/api/schools" -H "Content-Type: application/json" -H "Authorization: Bearer $PRINCIPAL_TOKEN" -d '{"name":"Hack School","school_type":"خاص","city":"test"}' 2>/dev/null || echo "")
PS_ERR=$(echo "$PRINCIPAL_SCHOOL" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error',''))" 2>/dev/null || echo "")
if echo "$PS_ERR" | grep -qi "admin\|غير مسموح\|forbidden\|unauthorized\|administrator"; then
  test_pass "RBAC: Principal blocked from creating school"
else
  test_fail "RBAC: Principal blocked from creating school" "$PRINCIPAL_SCHOOL"
fi

# 11. School regression: List schools
SCHOOLS=$(curl -s "$BASE/api/schools" -H "Authorization: Bearer $TOKEN")
S_COUNT=$(echo "$SCHOOLS" | python3 -c "import sys,json; d=json.load(sys.stdin); data=d.get('data',[]); print(len(data) if isinstance(data,list) else 0)" 2>/dev/null || echo "0")
if [ "$S_COUNT" -ge 2 ]; then
  test_pass "School regression: List schools (count=$S_COUNT)"
else
  test_fail "School regression: List schools" "$SCHOOLS"
fi

# 12. School regression: Get school details with profile columns
SCHOOL_DETAIL=$(curl -s "$BASE/api/schools/1" -H "Authorization: Bearer $TOKEN")
HAS_KEY=$(echo "$SCHOOL_DETAIL" | python3 -c "import sys,json; d=json.load(sys.stdin); print('name_en' in d.get('data',{}))" 2>/dev/null || echo "false")
if [ "$HAS_KEY" = "True" ]; then
  test_pass "School regression: School detail includes profile columns"
else
  test_fail "School regression: School detail includes profile columns" "$SCHOOL_DETAIL"
fi

# 13. Dashboard regression: Dashboard data
DASH=$(curl -s "$BASE/api/dashboard/stats" -H "Authorization: Bearer $TOKEN" 2>/dev/null || echo "")
DASH_OK=$(echo "$DASH" | python3 -c "import sys,json; d=json.load(sys.stdin); print('ok' if any(k in d for k in ['stats','schools','users','data']) else 'fail')" 2>/dev/null || echo "fail")
if [ "$DASH_OK" = "ok" ]; then
  test_pass "Dashboard regression: Dashboard data"
else
  test_fail "Dashboard regression: Dashboard data" "$DASH"
fi

# 14. Roles read-only: List roles
ROLES=$(curl -s "$BASE/api/roles" -H "Authorization: Bearer $TOKEN")
R_COUNT=$(echo "$ROLES" | python3 -c "import sys,json; d=json.load(sys.stdin); data=d.get('data',[]); print(len(data) if isinstance(data,list) else 0)" 2>/dev/null || echo "0")
if [ "$R_COUNT" -ge 8 ]; then
  test_pass "Roles read-only: List roles (count=$R_COUNT)"
else
  test_fail "Roles read-only: List roles" "$ROLES"
fi

# Summary
echo ""
echo "=================================="
echo "QA TEST SUMMARY"
echo "=================================="
echo -e "${GREEN}PASS: $PASS${NC}"
echo -e "${RED}FAIL: $FAIL${NC}"
if [ "$FAIL" -eq 0 ]; then
  echo -e "${GREEN}All QA tests passed!${NC}"
  exit 0
else
  echo -e "${RED}Some QA tests failed.${NC}"
  exit 1
fi
