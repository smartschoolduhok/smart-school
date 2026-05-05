#!/usr/bin/env bash
# ===========================================
# Manual API Tests - Phase 2 Security
# ===========================================
set -e

BASE="http://localhost:3000"

echo "=== Smart School API Security Tests ==="
echo ""

# ---- Admin Scenario ----
echo "--- ADMIN (admin@smart-school.iq) ---"
ADMIN_EMAIL="admin@smart-school.iq"

echo "[Admin] Dashboard stats (all schools)..."
curl -s -H "x-user-email: $ADMIN_EMAIL" "$BASE/api/dashboard/stats" | jq .

echo ""
echo "[Admin] Users without school_id filter (should see all)..."
curl -s -H "x-user-email: $ADMIN_EMAIL" "$BASE/api/users" | jq '.data | length'

echo ""
echo "[Admin] Users with ?school_id=1 (should filter to school 1)..."
curl -s -H "x-user-email: $ADMIN_EMAIL" "$BASE/api/users?school_id=1" | jq '.data | length'

echo ""
echo "[Admin] Classes without filter (should see all)..."
curl -s -H "x-user-email: $ADMIN_EMAIL" "$BASE/api/classes" | jq '.data | length'

echo ""
echo "[Admin] Classes with ?school_id=1 (should filter to school 1)..."
curl -s -H "x-user-email: $ADMIN_EMAIL" "$BASE/api/classes?school_id=1" | jq '.data | length'

echo ""
echo "[Admin] Students without filter..."
curl -s -H "x-user-email: $ADMIN_EMAIL" "$BASE/api/students" | jq '.data | length'

echo ""
echo "[Admin] Subjects without filter..."
curl -s -H "x-user-email: $ADMIN_EMAIL" "$BASE/api/subjects" | jq '.data | length'

echo ""
echo "[Admin] Sections without filter..."
curl -s -H "x-user-email: $ADMIN_EMAIL" "$BASE/api/sections" | jq '.data | length'

echo ""
# ---- Principal Scenario ----
echo "--- PRINCIPAL (principal@nukhba.iq, school_id=1) ---"
PRINCIPAL_EMAIL="principal@nukhba.iq"

echo ""
echo "[Principal] Dashboard stats (should be scoped to school 1)..."
curl -s -H "x-user-email: $PRINCIPAL_EMAIL" "$BASE/api/dashboard/stats" | jq .

echo ""
echo "[Principal] Users without school_id (should auto-scope to school 1)..."
curl -s -H "x-user-email: $PRINCIPAL_EMAIL" "$BASE/api/users" | jq '.data | length'

echo ""
echo "[Principal] Users with matching ?school_id=1 (should succeed)..."
curl -s -H "x-user-email: $PRINCIPAL_EMAIL" "$BASE/api/users?school_id=1" | jq '.data | length'

echo ""
echo "[Principal] Users with mismatched ?school_id=999 (should return 403)..."
curl -s -w "\nHTTP_STATUS:%{http_code}\n" -H "x-user-email: $PRINCIPAL_EMAIL" "$BASE/api/users?school_id=999" | tail -n 3

echo ""
echo "[Principal] Classes without filter (should auto-scope to school 1)..."
curl -s -H "x-user-email: $PRINCIPAL_EMAIL" "$BASE/api/classes" | jq '.data | length'

echo ""
echo "[Principal] Classes with mismatched ?school_id=999 (should return 403)..."
curl -s -w "\nHTTP_STATUS:%{http_code}\n" -H "x-user-email: $PRINCIPAL_EMAIL" "$BASE/api/classes?school_id=999" | tail -n 3

echo ""
echo "[Principal] Students without filter..."
curl -s -H "x-user-email: $PRINCIPAL_EMAIL" "$BASE/api/students" | jq '.data | length'

echo ""
echo "[Principal] Subjects without filter..."
curl -s -H "x-user-email: $PRINCIPAL_EMAIL" "$BASE/api/subjects" | jq '.data | length'

echo ""
echo "[Principal] Sections without filter..."
curl -s -H "x-user-email: $PRINCIPAL_EMAIL" "$BASE/api/sections" | jq '.data | length'

echo ""
echo "[Principal] Attempt to create class for school 999 (should return 403)..."
curl -s -w "\nHTTP_STATUS:%{http_code}\n" -H "x-user-email: $PRINCIPAL_EMAIL" -H "Content-Type: application/json" \
  -X POST -d '{"school_id":999,"name":"Hacked Class","stage":"ابتدائي"}' \
  "$BASE/api/classes" | tail -n 3

echo ""
echo "[Principal] Attempt to archive class in school 999 (should return 403)..."
curl -s -w "\nHTTP_STATUS:%{http_code}\n" -H "x-user-email: $PRINCIPAL_EMAIL" \
  -X PUT "$BASE/api/classes/1/archive" | tail -n 3

echo ""
echo "[Principal] Attempt to update student in school 999 (should return 403)..."
curl -s -w "\nHTTP_STATUS:%{http_code}\n" -H "x-user-email: $PRINCIPAL_EMAIL" -H "Content-Type: application/json" \
  -X PUT -d '{"full_name":"Hacked"}' \
  "$BASE/api/students/1" | tail -n 3

echo ""
# ---- Unauthenticated / Missing Header ----
echo "--- UNAUTHENTICATED ---"
echo "[No header] Classes (allowed but no school scope)..."
curl -s "$BASE/api/classes" | jq '.data | length'

echo ""
echo "=== Tests Complete ==="
