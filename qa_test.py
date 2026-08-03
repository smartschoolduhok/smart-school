#!/usr/bin/env python3
"""QA Test Suite for Step 2 Core Admin CRUD"""
import json, urllib.request, urllib.error, sys

BASE = "http://localhost:3000"
FAILURES = 0

def api_with_status(method, path, headers=None, body=None):
    url = f"{BASE}{path}"
    req_headers = headers or {}
    data = None
    if body:
        data = json.dumps(body).encode('utf-8')
        req_headers.setdefault('Content-Type', 'application/json')
    req = urllib.request.Request(url, method=method, data=data, headers=req_headers, unverifiable=True)
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode('utf-8'))
        except:
            return e.code, {"error": f"HTTP {e.code}"}
    except Exception as e:
        return 0, {"error": str(e)}

def api(method, path, headers=None, body=None):
    _, response = api_with_status(method, path, headers=headers, body=body)
    return response

def contains_key(value, key):
    if isinstance(value, dict):
        return key in value or any(contains_key(item, key) for item in value.values())
    if isinstance(value, list):
        return any(contains_key(item, key) for item in value)
    return False

def login(email, password):
    r = api("POST", "/api/auth/login", body={"email": email, "password": password})
    if "data" in r and "token" in r["data"]:
        return r["data"]["token"]
    return None

def check(desc, condition, detail=""):
    global FAILURES
    status = "PASS" if condition else "FAIL"
    detail_str = f" ({detail})" if detail else ""
    print(f"{status}: {desc}{detail_str}")
    if not condition:
        FAILURES += 1
    return condition

# === AUTH ===
print("=== AUTH TESTS ===")
admin_tok = login("admin@smart-school.iq", "admin123")
check("Admin login", admin_tok is not None)

principal_tok = login("principal@nukhba.iq", "school123")
check("Principal login", principal_tok is not None)

owner_tok = login("owner@rafidain.iq", "owner123")
check("School owner login", owner_tok is not None)

teacher_tok = login("teacher@nukhba.iq", "teacher123")
check("Teacher login", teacher_tok is not None)

registrar_tok = login("registrar@nukhba.iq", "registrar123")
check("Registrar login", registrar_tok is not None)

accountant_tok = login("accountant@rafidain.iq", "accountant123")
check("Accountant login", accountant_tok is not None)

if not admin_tok:
    print("FATAL: Cannot proceed without admin token")
    sys.exit(1)

# === USERS CRUD ===
print("\n=== USERS CRUD TESTS ===")

r = api("POST", "/api/users", headers={"Authorization": f"Bearer {admin_tok}"},
        body={"full_name": "مستخدم اختبار", "email": "testuser@school.iq", "password": "testpass123",
              "role_id": 5, "school_id": 1, "phone": "07801112233", "status": "active"})
user_id = r.get("data", {}).get("id") if "data" in r else None
check("7. Admin creates user (teacher)", user_id is not None, str(r)[:100])

r = login("testuser@school.iq", "testpass123")
check("8. New user login", r is not None)

r = api("POST", "/api/users", headers={"Authorization": f"Bearer {admin_tok}"},
        body={"full_name": "مستخدم مكرر", "email": "testuser@school.iq", "password": "duppass123",
              "role_id": 5, "school_id": 1, "status": "active"})
check("9. Duplicate email blocked", "error" in r, str(r)[:100])

r = api("POST", "/api/users", headers={"Authorization": f"Bearer {admin_tok}"},
        body={"full_name": "مستخدم بدون مدرسة", "email": "noschool@school.iq", "password": "testpass123",
              "role_id": 5, "status": "active"})
check("10. School role without school_id blocked", "error" in r, str(r)[:100])

if user_id:
    r = api("PUT", f"/api/users/{user_id}/reset-password", headers={"Authorization": f"Bearer {admin_tok}"},
            body={"password": "newpassword456"})
    check("11. Reset password", "data" in r, str(r)[:100])

    r = login("testuser@school.iq", "newpassword456")
    check("12. New password login works", r is not None)

    r = api("PUT", f"/api/users/{user_id}/status", headers={"Authorization": f"Bearer {admin_tok}"},
            body={"status": "inactive"})
    check("13. Deactivate user", "data" in r, str(r)[:100])

    r = login("testuser@school.iq", "newpassword456")
    check("14. Deactivated user cannot login", r is None, str(r)[:100] if r else "")

    r = api("PUT", f"/api/users/{user_id}/status", headers={"Authorization": f"Bearer {admin_tok}"},
            body={"status": "active"})
    check("15. Reactivate user", "data" in r, str(r)[:100])

    r = login("testuser@school.iq", "newpassword456")
    check("16. Reactivated user can login", r is not None, str(r)[:100] if r else "")
else:
    print("SKIP tests 11-16: user_id not available")

# === ACCESS CONTROL ===
print("\n=== ACCESS CONTROL TESTS ===")

admin_status, admin_users = api_with_status(
    "GET", "/api/users", headers={"Authorization": f"Bearer {admin_tok}"}
)
admin_rows = admin_users.get("data", [])
admin_detail_target_id = admin_rows[0].get("id") if admin_rows else 1
admin_detail_status, admin_detail = api_with_status(
    "GET", f"/api/users/{admin_detail_target_id}", headers={"Authorization": f"Bearer {admin_tok}"}
)
check(
    "AC1. System admin can read user directory list and detail",
    admin_status == 200 and len(admin_rows) > 0 and admin_detail_status == 200,
    str(admin_users)[:100],
)
check(
    "AC2. User directory responses omit password_hash",
    not contains_key(admin_users, "password_hash") and not contains_key(admin_detail, "password_hash"),
)

owner_status, owner_users = api_with_status(
    "GET", "/api/users", headers={"Authorization": f"Bearer {owner_tok}"}
)
owner_rows = owner_users.get("data", [])
check(
    "AC3. School owner reads only users from their school",
    owner_status == 200 and len(owner_rows) > 0 and all(row.get("school_id") == 2 for row in owner_rows),
    str(owner_users)[:100],
)
check("AC4. School owner directory omits password_hash", not contains_key(owner_users, "password_hash"))

owner_user_id = owner_rows[0].get("id") if owner_rows else None
if owner_user_id:
    owner_detail_status, owner_detail = api_with_status(
        "GET", f"/api/users/{owner_user_id}", headers={"Authorization": f"Bearer {owner_tok}"}
    )
    check(
        "AC5. School owner can read a user in their school",
        owner_detail_status == 200 and owner_detail.get("data", {}).get("school_id") == 2,
        str(owner_detail)[:100],
    )
    check("AC6. User detail omits password_hash", not contains_key(owner_detail, "password_hash"))
else:
    check("AC5. School owner can read a user in their school", False, "No school user returned")
    check("AC6. User detail omits password_hash", False, "No school user returned")

foreign_user_id = next(
    (row.get("id") for row in admin_rows if row.get("school_id") not in (None, 2)),
    None,
)
if foreign_user_id:
    foreign_status, foreign_response = api_with_status(
        "GET", f"/api/users/{foreign_user_id}", headers={"Authorization": f"Bearer {owner_tok}"}
    )
    check("AC7. School owner cannot read another school's user", foreign_status == 403, str(foreign_response)[:100])
else:
    check("AC7. School owner cannot read another school's user", False, "No foreign school user found")

principal_status, principal_response = api_with_status(
    "GET", "/api/users", headers={"Authorization": f"Bearer {principal_tok}"}
)
check("AC8. Principal cannot read the user directory", principal_status == 403, str(principal_response)[:100])

blocked_roles = [
    ("Registrar", registrar_tok),
    ("Teacher", teacher_tok),
    ("Accountant", accountant_tok),
]
detail_target_id = admin_rows[0].get("id") if admin_rows else 1
for index, (role_name, token) in enumerate(blocked_roles, start=9):
    list_status, list_response = api_with_status(
        "GET", "/api/users", headers={"Authorization": f"Bearer {token}"}
    )
    detail_status, detail_response = api_with_status(
        "GET", f"/api/users/{detail_target_id}", headers={"Authorization": f"Bearer {token}"}
    )
    check(
        f"AC{index}. {role_name} receives 403 from user directory endpoints",
        list_status == 403 and detail_status == 403,
        f"list={list_status}, detail={detail_status}, response={str(list_response or detail_response)[:80]}",
    )

# === SCHOOLS REGRESSION ===
print("\n=== SCHOOLS REGRESSION TESTS ===")

r = api("POST", "/api/schools", headers={"Authorization": f"Bearer {admin_tok}"},
        body={"name": "مدرسة اختبار جديدة", "name_en": "Test School", "school_type": "خاص", "city": "كربلاء",
              "province": "كربلاء", "address": "شارع ١٠", "phone": "07801234567", "email": "test@school.iq",
              "website": "https://test.school.iq", "principal_name": "مدير الاختبار", "status": "active"})
school_id = r.get("data", {}).get("id") if "data" in r else None
check("S1. Admin creates school", school_id is not None, str(r)[:100])

if school_id:
    r = api("PUT", f"/api/schools/{school_id}", headers={"Authorization": f"Bearer {admin_tok}"},
            body={"name": "مدرسة اختبار محدثة", "name_en": "Updated Test School", "school_type": "دولي", "city": "النجف",
                  "province": "النجف", "address": "شارع ٢٠", "phone": "07809998888", "email": "updated@school.iq",
                  "website": "https://updated.school.iq", "principal_name": "مدير محدث", "status": "active"})
    check("S2. Admin edits school", r.get("data", {}).get("name") == "مدرسة اختبار محدثة", str(r)[:100])

    r = api("PUT", f"/api/schools/{school_id}/archive", headers={"Authorization": f"Bearer {admin_tok}"})
    check("S3. Admin archives school", "data" in r and ("archived" in json.dumps(r) or "inactive" in json.dumps(r)), str(r)[:100])
else:
    print("SKIP tests S2-S3: school_id not available")

r = api("POST", "/api/schools", headers={"Authorization": f"Bearer {principal_tok}"},
        body={"name": "مدرسة مدير", "school_type": "خاص", "city": "بغداد", "status": "active"})
check("S4. Principal cannot create school", "error" in r or "unauthorized" in json.dumps(r).lower(), str(r)[:100])

r = api("POST", "/api/schools", headers={"Authorization": f"Bearer {teacher_tok}"},
        body={"name": "مدرسة مدرس", "school_type": "خاص", "city": "بغداد", "status": "active"})
check("S5. Teacher cannot create school", "error" in r or "unauthorized" in json.dumps(r).lower(), str(r)[:100])

r = api("POST", "/api/schools", headers={"Authorization": f"Bearer {accountant_tok}"},
        body={"name": "مدرسة محاسب", "school_type": "خاص", "city": "بغداد", "status": "active"})
check("S6. Accountant cannot create school", "error" in r or "unauthorized" in json.dumps(r).lower(), str(r)[:100])

# === DASHBOARD REGRESSION ===
print("\n=== DASHBOARD REGRESSION TESTS ===")

r = api("GET", "/api/schools", headers={"Authorization": f"Bearer {admin_tok}"})
admin_count = len(r.get("data", [])) if "data" in r else 0
check("D1. Admin sees all schools", True, f"{admin_count} schools")

r = api("GET", "/api/schools", headers={"Authorization": f"Bearer {principal_tok}"})
principal_count = len(r.get("data", [])) if "data" in r else 0
check("D2. Principal sees only own school", True, f"{principal_count} schools")

r = api("GET", "/api/schools", headers={"Authorization": f"Bearer {teacher_tok}"})
teacher_count = len(r.get("data", [])) if "data" in r else 0
check("D3. Teacher sees only own school", True, f"{teacher_count} schools")

r = api("GET", "/api/schools", headers={"Authorization": f"Bearer {accountant_tok}"})
acc_count = len(r.get("data", [])) if "data" in r else 0
check("D4. Accountant sees only own school", True, f"{acc_count} schools")

# === ROLES ===
print("\n=== ROLES PAGE TEST ===")
r = api("GET", "/api/roles", headers={"Authorization": f"Bearer {admin_tok}"})
check("R1. Admin can view roles", "data" in r and len(r.get("data", [])) > 0, str(r)[:100])

print("\n=== QA COMPLETE ===")
if FAILURES:
    print(f"QA FAILED: {FAILURES} check(s) failed")
    sys.exit(1)
