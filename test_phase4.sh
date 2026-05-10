#!/bin/bash
set -e
API="http://localhost:3000"
TOKEN=$(curl -s -X POST "$API/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@smart-school.iq","password":"admin123"}' | \
  python3 -c "import sys,json; print(json.load(sys.stdin)['data']['token'])")

echo "Token obtained: ${TOKEN:0:30}..."

run_case() {
  local name=$1
  local score=$2
  local completion=$3
  local expect_gac=$4
  local expect_eff=$5
  local expect_status=$6
  local expect_exempt=$7

  # Build JSON payload
  if [ "$completion" = "null" ]; then
    payload=$(cat <<EOF
{"first_month":$score,"second_month":$score,"third_month":$score,"fourth_month":$score,"mid_year_exam":$score,"final_exam":$score,"completion_exam":null}
EOF
)
  else
    payload=$(cat <<EOF
{"first_month":$score,"second_month":$score,"third_month":$score,"fourth_month":$score,"mid_year_exam":$score,"final_exam":$score,"completion_exam":$completion}
EOF
)
  fi

  # Update grade ID 1
  resp=$(curl -s -X PUT "$API/api/grades/1" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d "$payload")

  # Extract calculated fields
  gac=$(echo "$resp" | python3 -c "import sys,json; d=json.load(sys.stdin)['data']; print(d.get('grade_after_completion') if d.get('grade_after_completion') is not None else 'null')")
  eff=$(echo "$resp" | python3 -c "import sys,json; d=json.load(sys.stdin)['data']; print(d.get('effective_grade') if d.get('effective_grade') is not None else 'null')")
  sts=$(echo "$resp" | python3 -c "import sys,json; d=json.load(sys.stdin)['data']; print(d.get('result_status') or 'null')")
  exm=$(echo "$resp" | python3 -c "import sys,json; d=json.load(sys.stdin)['data']; print(d.get('exemption_status') if d.get('exemption_status') is not None else 'null')")
  fg=$(echo "$resp" | python3 -c "import sys,json; d=json.load(sys.stdin)['data']; print(d.get('final_grade') if d.get('final_grade') is not None else 'null')")

  echo ""
  echo "=== $name ==="
  echo "Inputs: all=$score, completion=$completion"
  echo "final_grade=$fg, grade_after_completion=$gac, effective_grade=$eff, result_status=$sts, exemption_status=$exm"

  ok=1
  if [ "$gac" != "$expect_gac" ]; then echo "FAIL grade_after_completion: expected $expect_gac, got $gac"; ok=0; fi
  if [ "$eff" != "$expect_eff" ]; then echo "FAIL effective_grade: expected $expect_eff, got $eff"; ok=0; fi
  if [ "$sts" != "$expect_status" ]; then echo "FAIL result_status: expected $expect_status, got $sts"; ok=0; fi
  if [ "$exm" != "$expect_exempt" ]; then echo "FAIL exemption_status: expected $expect_exempt, got $exm"; ok=0; fi
  if [ "$ok" = "1" ]; then echo "PASS"; fi
}

# Settings: passing=50, exemption=90
# Case A: final=80>=50, ignore completion, status=ناجح, exempt=0
run_case "CaseA" 80 95 "null" 80 "ناجح" 0

# Case B: final=45<50, no completion, status=مكمل, exempt=0
run_case "CaseB" 45 "null" "null" 45 "مكمل" 0

# Case C: final=45<50, completion=60, effective=60>=50, status=ناجح, exempt=0
run_case "CaseC" 45 60 "60" 60 "ناجح" 0

# Case D: final=45<50, completion=48, effective=48<50, status=راسب, exempt=0
run_case "CaseD" 45 48 "48" 48 "راسب" 0

# Case E: final=92>=50, no completion, status=ناجح, exempt=1 (92>=90)
run_case "CaseE" 92 "null" "null" 92 "ناجح" 1

# Reset grade to nulls
reset_payload='{"first_month":null,"second_month":null,"third_month":null,"fourth_month":null,"mid_year_exam":null,"final_exam":null,"completion_exam":null}'
curl -s -X PUT "$API/api/grades/1" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "$reset_payload" > /dev/null
echo ""
echo "Grade reset to nulls."
