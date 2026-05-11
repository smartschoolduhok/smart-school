#!/usr/bin/env bash
set -uo pipefail

BASE="http://localhost:3000"

# ── 1. Login ─────────────────────────────────────────────────────────
echo "=== 1. LOGIN ==="
LOGIN=$(curl -s -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@smart-school.iq","password":"admin123"}')
TOKEN=$(echo "$LOGIN" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
echo "Token acquired: ${TOKEN:0:40}..."

if [ -z "$TOKEN" ]; then
  echo "ERROR: Token extraction failed"
  exit 1
fi

AUTH="Authorization: Bearer $TOKEN"

# ── 2. Phase 4 Regression: initialize grades for student_id=2 ─────
echo ""
echo "=== 2. INITIALIZE GRADES ==="
INIT=$(curl -s -X POST "$BASE/api/grades/initialize-student/2" -H "$AUTH" -H "Content-Type: application/json" -d '{}')
echo "Initialize response: $INIT"

# ── 3. Load student grades to find a grade_id ──────────────────────
echo ""
echo "=== 3. LOAD STUDENT 2 GRADES ==="
GRADES=$(curl -s "$BASE/api/students/2/grades" -H "$AUTH")
GRADE_ID=$(echo "$GRADES" | sed -n 's/.*"id":\([0-9]*\).*/\1/p' | head -1)
SCHOOL_ID=$(echo "$GRADES" | sed -n 's/.*"school_id":\([0-9]*\).*/\1/p' | head -1)
echo "First grade_id=$GRADE_ID, school_id=$SCHOOL_ID"

if [ -z "$GRADE_ID" ]; then
  echo "ERROR: No grade_id found for student 2. Grades response: ${GRADES:0:200}"
  exit 1
fi

# ── 4. Grade Settings GET ───────────────────────────────────────────
echo ""
echo "=== 4. GRADE SETTINGS GET ==="
GS=$(curl -s "$BASE/api/grade-settings?school_id=$SCHOOL_ID" -H "$AUTH")
echo "$GS"

# ── 5. Test Cases A-E ───────────────────────────────────────────────
echo ""
echo "=== 5. TEST CASES A-E ==="

test_case() {
  local name=$1; local fm=$2; local sm=$3; local tm=$4; local fourth=$5; local mid=$6; local final=$7; local comp=$8
  local payload
  if [ -z "$comp" ]; then
    payload="{\"first_month\":$fm,\"second_month\":$sm,\"third_month\":$tm,\"fourth_month\":$fourth,\"mid_year_exam\":$mid,\"final_exam\":$final}"
  else
    payload="{\"first_month\":$fm,\"second_month\":$sm,\"third_month\":$tm,\"fourth_month\":$fourth,\"mid_year_exam\":$mid,\"final_exam\":$final,\"completion_exam\":$comp}"
  fi
  local res
  res=$(curl -s -X PUT "$BASE/api/grades/$GRADE_ID" -H "$AUTH" -H "Content-Type: application/json" -d "$payload")
  echo "--- $name ---"
  echo "Response: $res"
  echo ""
}

# A: final=80, no completion
test_case "A_final80_noComp" 70 80 75 85 80 80 ""
# B: final=45, no completion
test_case "B_final45_noComp" 40 45 42 48 45 45 ""
# C: final=45, completion=60
test_case "C_final45_comp60" 40 45 42 48 45 45 60
# D: final=45, completion=48
test_case "D_final45_comp48" 40 45 42 48 45 45 48
# E: final=92, no completion
test_case "E_final92_noComp" 90 92 91 93 92 92 ""

# ── 6. Grade History ─────────────────────────────────────────────────
echo ""
echo "=== 6. GRADE HISTORY ==="
HIST=$(curl -s "$BASE/api/grades/$GRADE_ID/history" -H "$AUTH")
echo "$HIST" | head -c 800
echo ""

# ── 7. Grade Settings PUT (update + validation) ─────────────────────
echo ""
echo "=== 7. GRADE SETTINGS PUT ==="
PUT_RES=$(curl -s -X PUT "$BASE/api/grade-settings?school_id=$SCHOOL_ID" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"passing_grade":50,"exemption_grade":90,"max_grade":100,"general_exemption_average_grade":85,"general_exemption_min_subject_grade":75}')
echo "Valid update: $PUT_RES"

# Invalid: min > avg
INVALID=$(curl -s -X PUT "$BASE/api/grade-settings?school_id=$SCHOOL_ID" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"passing_grade":50,"exemption_grade":90,"max_grade":100,"general_exemption_average_grade":75,"general_exemption_min_subject_grade":85}')
echo "Invalid update (min>avg): $INVALID"

# ── 8. Analytics endpoints ────────────────────────────────────────────
echo ""
echo "=== 8. ANALYTICS ENDPOINTS ==="
for ep in overview by-class by-section by-subject students-close-to-passing students-close-to-exemption exemption-blockers; do
  echo "--- GET /api/analytics/$ep ---"
  RESP=$(curl -s "$BASE/api/analytics/$ep?school_id=$SCHOOL_ID" -H "$AUTH")
  echo "${RESP:0:700}"
  echo ""
done

# student-summary for student 2
echo "--- GET /api/analytics/student-summary/2 ---"
SUMM=$(curl -s "$BASE/api/analytics/student-summary/2?school_id=$SCHOOL_ID" -H "$AUTH")
echo "${SUMM:0:800}"
echo ""

# ── 9. Auth tests ─────────────────────────────────────────────────────
echo ""
echo "=== 9. AUTH/SECURITY ==="
# No token
NOAUTH=$(curl -s -w "\nHTTP:%{http_code}" "$BASE/api/analytics/overview?school_id=$SCHOOL_ID")
echo "No token: $NOAUTH"

# Principal login
PLOGIN=$(curl -s -X POST "$BASE/api/auth/login" -H "Content-Type: application/json" -d '{"email":"principal@nukhba.iq","password":"school123"}')
PTOKEN=$(echo "$PLOGIN" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
PAUTH="Authorization: Bearer $PTOKEN"
echo "Principal token acquired: ${PTOKEN:0:30}..."

# Principal own school
POWN=$(curl -s -w "\nHTTP:%{http_code}" "$BASE/api/analytics/overview?school_id=1" -H "$PAUTH")
echo "Principal own school: ${POWN:0:250}"

# Principal other school
POTHER=$(curl -s -w "\nHTTP:%{http_code}" "$BASE/api/analytics/overview?school_id=2" -H "$PAUTH")
echo "Principal other school: $POTHER"

# Admin filter by school_id=2
ADMIN_OTHER=$(curl -s -w "\nHTTP:%{http_code}" "$BASE/api/analytics/overview?school_id=2" -H "$AUTH")
echo "Admin school_id=2: ${ADMIN_OTHER:0:250}"

echo ""
echo "=== ALL TESTS COMPLETE ==="
