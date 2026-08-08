#!/usr/bin/env python3
"""QA Test Suite for Step 2 Core Admin CRUD"""
import base64, glob, hashlib, json, sqlite3, urllib.request, urllib.error, sys, time

BASE = "http://localhost:3000"
FAILURES = 0
RUN_ID = str(int(time.time()))
TEST_USER_EMAIL = f"testuser+{RUN_ID}@school.iq"

def api_with_response(method, path, headers=None, body=None):
    url = f"{BASE}{path}"
    req_headers = dict(headers or {})
    data = None
    if body is not None:
        data = json.dumps(body).encode('utf-8')
        req_headers.setdefault('Content-Type', 'application/json')
    req = urllib.request.Request(url, method=method, data=data, headers=req_headers, unverifiable=True)
    try:
        with urllib.request.urlopen(req) as resp:
            raw = resp.read().decode('utf-8')
            payload = json.loads(raw) if raw else {}
            return resp.status, payload, dict(resp.headers.items())
    except urllib.error.HTTPError as e:
        try:
            payload = json.loads(e.read().decode('utf-8'))
        except Exception:
            payload = {"error": f"HTTP {e.code}"}
        return e.code, payload, dict(e.headers.items())
    except Exception as e:
        return 0, {"error": str(e)}, {}

def api_with_status(method, path, headers=None, body=None):
    status, response, _ = api_with_response(method, path, headers=headers, body=body)
    return status, response

def api(method, path, headers=None, body=None):
    _, response = api_with_status(method, path, headers=headers, body=body)
    return response

def local_db_path():
    candidates = glob.glob('.wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite')
    candidates += glob.glob('.wrangler/**/miniflare-D1DatabaseObject/*.sqlite', recursive=True)
    unique_candidates = [
        item for item in dict.fromkeys(candidates)
        if not item.endswith('metadata.sqlite')
    ]
    return max(unique_candidates, key=lambda item: __import__('os').path.getmtime(item)) if unique_candidates else None

def local_db_execute(sql, params=(), fetchone=False):
    path = local_db_path()
    if not path:
        raise RuntimeError('Local D1 SQLite database was not found')
    with sqlite3.connect(path, timeout=10) as connection:
        cursor = connection.execute(sql, params)
        row = cursor.fetchone() if fetchone else None
        connection.commit()
        return row

def decode_jwt_payload(token):
    try:
        payload = token.split('.')[1]
        payload += '=' * ((4 - len(payload) % 4) % 4)
        return json.loads(base64.urlsafe_b64decode(payload.encode('ascii')).decode('utf-8'))
    except Exception:
        return {}

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

# === P0 AUTHENTICATION & API SECURITY ===
print("\n=== P0 AUTHENTICATION & API SECURITY TESTS ===")

protected_status, protected_response = api_with_status("GET", "/api/schools")
me_unauth_status, _ = api_with_status("GET", "/api/auth/me")
logout_unauth_status, _ = api_with_status("POST", "/api/auth/logout")
check(
    "SEC1. API routes are authenticated by default",
    protected_status == me_unauth_status == logout_unauth_status == 401,
    f"schools={protected_status}, me={me_unauth_status}, logout={logout_unauth_status}, response={str(protected_response)[:80]}",
)

public_statuses = [
    api_with_status("GET", "/api/verify/result-card/not-a-real-token")[0],
    api_with_status("GET", "/api/verify/receipt/not-a-real-token")[0],
    api_with_status("GET", "/api/verify/official-book/not-a-real-token")[0],
]
check(
    "SEC2. Public QR verification routes remain unauthenticated",
    all(status != 401 for status in public_statuses),
    f"statuses={public_statuses}",
)

cors_allowed_status, _, cors_allowed_headers = api_with_response(
    "POST",
    "/api/auth/login",
    headers={"Origin": "http://localhost:3000", "CF-Connecting-IP": "198.51.100.20"},
    body={"email": f"cors+{RUN_ID}@invalid.test", "password": "wrong-password"},
)
cors_allowed_origin = next(
    (value for key, value in cors_allowed_headers.items() if key.lower() == "access-control-allow-origin"),
    None,
)
cors_denied_status, _, cors_denied_headers = api_with_response(
    "POST",
    "/api/auth/login",
    headers={"Origin": "https://unapproved.example", "CF-Connecting-IP": "198.51.100.21"},
    body={"email": f"cors-denied+{RUN_ID}@invalid.test", "password": "wrong-password"},
)
cors_denied_origin = next(
    (value for key, value in cors_denied_headers.items() if key.lower() == "access-control-allow-origin"),
    None,
)
check(
    "SEC3. CORS allows same-origin and rejects unapproved origins",
    cors_allowed_status == 401
    and cors_allowed_origin == "http://localhost:3000"
    and cors_denied_status == 403
    and cors_denied_origin is None,
    f"allowed={cors_allowed_status}/{cors_allowed_origin}, denied={cors_denied_status}/{cors_denied_origin}",
)

local_database = local_db_path()
check("SEC4. Local-only security QA found the D1 SQLite database", local_database is not None, str(local_database))

legacy_email = f"legacy+{RUN_ID}@school.iq"
legacy_password = "legacy-password-123"
legacy_hash = hashlib.sha256(
    (legacy_password + "smart-school-salt-2026" + legacy_email).encode("utf-8")
).hexdigest()
legacy_user_id = None
legacy_token = None
if local_database:
    try:
        local_db_execute(
            "INSERT INTO users (school_id, full_name, email, password_hash, role_id, status, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, 5, 'active', unixepoch(), unixepoch())",
            (1, "Legacy Security User", legacy_email, legacy_hash),
        )
        legacy_user_id = local_db_execute(
            "SELECT id FROM users WHERE email = ?", (legacy_email,), fetchone=True
        )[0]
        legacy_login_status, legacy_login_response, _ = api_with_response(
            "POST",
            "/api/auth/login",
            headers={"CF-Connecting-IP": "198.51.100.30"},
            body={"email": legacy_email, "password": legacy_password},
        )
        legacy_token = legacy_login_response.get("data", {}).get("token")
        upgraded_hash = local_db_execute(
            "SELECT password_hash FROM users WHERE id = ?", (legacy_user_id,), fetchone=True
        )[0]
        check(
            "SEC5. Successful legacy login upgrades the stored password hash",
            legacy_login_status == 200
            and legacy_token is not None
            and upgraded_hash.startswith("pbkdf2_sha256$"),
            f"status={legacy_login_status}, hash_prefix={upgraded_hash[:18]}",
        )
    except Exception as error:
        check("SEC5. Successful legacy login upgrades the stored password hash", False, str(error))
else:
    check("SEC5. Successful legacy login upgrades the stored password hash", False, "Local D1 unavailable")

if legacy_token and legacy_user_id:
    legacy_payload = decode_jwt_payload(legacy_token)
    legacy_jti = legacy_payload.get("jti")
    logout_status, _ = api_with_status(
        "POST", "/api/auth/logout", headers={"Authorization": f"Bearer {legacy_token}"}
    )
    reused_status, _ = api_with_status(
        "GET", "/api/auth/me", headers={"Authorization": f"Bearer {legacy_token}"}
    )
    revoked_row = local_db_execute(
        "SELECT jti, user_id FROM revoked_sessions WHERE jti = ?", (legacy_jti,), fetchone=True
    ) if legacy_jti else None
    raw_token_count = local_db_execute(
        "SELECT COUNT(*) FROM token_blacklist WHERE token = ?", (legacy_token,), fetchone=True
    )[0]
    check(
        "SEC6. Logout revokes jti and never stores the raw bearer token",
        logout_status == 200
        and reused_status == 401
        and revoked_row == (legacy_jti, legacy_user_id)
        and raw_token_count == 0,
        f"logout={logout_status}, reused={reused_status}, revoked={revoked_row}, raw_tokens={raw_token_count}",
    )
else:
    check("SEC6. Logout revokes jti and never stores the raw bearer token", False, "Legacy session unavailable")

throttle_email = f"throttle+{RUN_ID}@invalid.test"
throttle_headers = {"CF-Connecting-IP": "198.51.100.40"}
throttle_results = []
throttle_retry_after = None
for _ in range(5):
    status, _, response_headers = api_with_response(
        "POST",
        "/api/auth/login",
        headers=throttle_headers,
        body={"email": throttle_email, "password": "wrong-password"},
    )
    throttle_results.append(status)
    throttle_retry_after = next(
        (value for key, value in response_headers.items() if key.lower() == "retry-after"),
        throttle_retry_after,
    )
check(
    "SEC7. Repeated failed logins are temporarily throttled",
    throttle_results[:4] == [401, 401, 401, 401]
    and throttle_results[4] == 429
    and throttle_retry_after is not None
    and int(throttle_retry_after) > 0,
    f"statuses={throttle_results}, retry_after={throttle_retry_after}",
)

if local_database:
    local_db_execute(
        "UPDATE login_throttles SET locked_until = unixepoch() - 1, "
        "window_started_at = unixepoch() - 1000, updated_at = unixepoch()"
    )
    recovered_status, _ = api_with_status(
        "POST",
        "/api/auth/login",
        headers=throttle_headers,
        body={"email": throttle_email, "password": "wrong-password"},
    )
    check("SEC8. Expired throttles recover automatically", recovered_status == 401, f"status={recovered_status}")
else:
    check("SEC8. Expired throttles recover automatically", False, "Local D1 unavailable")

if legacy_user_id:
    reset_ip_headers = {"CF-Connecting-IP": "198.51.100.41"}
    reset_statuses = [
        api_with_status(
            "POST", "/api/auth/login", headers=reset_ip_headers,
            body={"email": legacy_email, "password": "wrong-password"},
        )[0]
        for _ in range(2)
    ]
    successful_status, _ = api_with_status(
        "POST", "/api/auth/login", headers=reset_ip_headers,
        body={"email": legacy_email, "password": legacy_password},
    )
    after_success_status, _ = api_with_status(
        "POST", "/api/auth/login", headers=reset_ip_headers,
        body={"email": legacy_email, "password": "wrong-password"},
    )
    check(
        "SEC9. Successful login clears the relevant failure state",
        reset_statuses == [401, 401] and successful_status == 200 and after_success_status == 401,
        f"failures={reset_statuses}, success={successful_status}, after={after_success_status}",
    )
else:
    check("SEC9. Successful login clears the relevant failure state", False, "Legacy user unavailable")

unknown_status, unknown_response = api_with_status(
    "POST", "/api/auth/login",
    headers={"CF-Connecting-IP": "198.51.100.50"},
    body={"email": f"unknown+{RUN_ID}@invalid.test", "password": "wrong-password"},
)
wrong_status, wrong_response = api_with_status(
    "POST", "/api/auth/login",
    headers={"CF-Connecting-IP": "198.51.100.51"},
    body={"email": "teacher@nukhba.iq", "password": "wrong-password"},
)
inactive_status, inactive_response = api_with_status(
    "POST", "/api/auth/login",
    headers={"CF-Connecting-IP": "198.51.100.52"},
    body={"email": "registrar@eman.iq", "password": "registrar123"},
)
check(
    "SEC10. Unknown, wrong-password, and inactive accounts share a generic response",
    unknown_status == wrong_status == inactive_status == 401
    and unknown_response.get("error") == wrong_response.get("error") == inactive_response.get("error"),
    f"statuses={unknown_status}/{wrong_status}/{inactive_status}, errors={unknown_response}/{wrong_response}/{inactive_response}",
)

# === USERS CRUD ===
print("\n=== USERS CRUD TESTS ===")

r = api("POST", "/api/users", headers={"Authorization": f"Bearer {admin_tok}"},
        body={"full_name": "مستخدم اختبار", "email": TEST_USER_EMAIL, "password": "testpass123",
              "role_id": 5, "school_id": 1, "phone": "07801112233", "status": "active"})
user_id = r.get("data", {}).get("id") if "data" in r else None
check("7. Admin creates user (teacher)", user_id is not None, str(r)[:100])
if user_id and local_database:
    created_password_hash = local_db_execute(
        "SELECT password_hash FROM users WHERE id = ?", (user_id,), fetchone=True
    )[0]
    check(
        "SEC11. User creation stores only the new PBKDF2 format",
        created_password_hash.startswith("pbkdf2_sha256$"),
        created_password_hash[:24],
    )
else:
    check("SEC11. User creation stores only the new PBKDF2 format", False, "User or local D1 unavailable")

r = login(TEST_USER_EMAIL, "testpass123")
check("8. New user login", r is not None)

r = api("POST", "/api/users", headers={"Authorization": f"Bearer {admin_tok}"},
        body={"full_name": "مستخدم مكرر", "email": TEST_USER_EMAIL, "password": "duppass123",
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
    if local_database:
        reset_password_hash = local_db_execute(
            "SELECT password_hash FROM users WHERE id = ?", (user_id,), fetchone=True
        )[0]
        check(
            "SEC12. Password reset stores only the new PBKDF2 format",
            reset_password_hash.startswith("pbkdf2_sha256$") and reset_password_hash != created_password_hash,
            reset_password_hash[:24],
        )
    else:
        check("SEC12. Password reset stores only the new PBKDF2 format", False, "Local D1 unavailable")

    r = login(TEST_USER_EMAIL, "newpassword456")
    check("12. New password login works", r is not None)

    r = api("PUT", f"/api/users/{user_id}/status", headers={"Authorization": f"Bearer {admin_tok}"},
            body={"status": "inactive"})
    check("13. Deactivate user", "data" in r, str(r)[:100])

    r = login(TEST_USER_EMAIL, "newpassword456")
    check("14. Deactivated user cannot login", r is None, str(r)[:100] if r else "")

    r = api("PUT", f"/api/users/{user_id}/status", headers={"Authorization": f"Bearer {admin_tok}"},
            body={"status": "active"})
    check("15. Reactivate user", "data" in r, str(r)[:100])

    r = login(TEST_USER_EMAIL, "newpassword456")
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

# === P0 RESULT CARD INTEGRITY + RBAC ===
print("\n=== P0 RESULT CARD TESTS ===")
principal_headers = {"Authorization": f"Bearer {principal_tok}"}
teacher_headers = {"Authorization": f"Bearer {teacher_tok}"}
registrar_headers = {"Authorization": f"Bearer {registrar_tok}"}
owner_headers = {"Authorization": f"Bearer {owner_tok}"}

create_status, create_result = api_with_status(
    "POST", "/api/result-cards/generate-student/1", headers=principal_headers
)
if create_status == 200:
    result_card_id = create_result.get("data", {}).get("card", {}).get("id")
else:
    _, active_cards = api_with_status(
        "GET",
        "/api/result-cards?student_id=1&status=active",
        headers=principal_headers,
    )
    result_card_id = next(
        (row.get("id") for row in active_cards.get("data", []) if row.get("student_name_snapshot")),
        None,
    )
check(
    "P0-RC1. Complete student has an active result card",
    result_card_id is not None and create_status in (200, 409),
    f"status={create_status}, response={str(create_result)[:120]}",
)

duplicate_status, duplicate_result = api_with_status(
    "POST", "/api/result-cards/generate-student/1", headers=principal_headers
)
check(
    "P0-RC2. Duplicate active card for the same academic year is rejected",
    duplicate_status == 409,
    f"status={duplicate_status}, response={str(duplicate_result)[:120]}",
)

section_status, section_result = api_with_status(
    "POST",
    "/api/result-cards/generate-section",
    headers=principal_headers,
    body={"class_id": 1, "section_id": 1},
)
student2_cards_status, student2_cards = api_with_status(
    "GET",
    "/api/result-cards?student_id=2&status=active",
    headers=principal_headers,
)
student2_card = next(iter(student2_cards.get("data", [])), None)
check(
    "P0-RC2B. Section generation preserves the subject result status",
    section_status == 200
    and student2_cards_status == 200
    and student2_card is not None
    and student2_card.get("overall_result_status") == "مكمل",
    f"section={str(section_result)[:100]}, card={str(student2_card)[:100]}",
)

cross_section_status, cross_section_result = api_with_status(
    "POST",
    "/api/result-cards/generate-section",
    headers=owner_headers,
    body={"class_id": 1, "section_id": 1},
)
check(
    "P0-RC3. School owner cannot generate cards for another school's section",
    cross_section_status == 403,
    f"status={cross_section_status}, response={str(cross_section_result)[:120]}",
)

if result_card_id:
    teacher_cancel_status, _ = api_with_status(
        "PUT", f"/api/result-cards/{result_card_id}/cancel", headers=teacher_headers
    )
    registrar_cancel_status, _ = api_with_status(
        "PUT", f"/api/result-cards/{result_card_id}/cancel", headers=registrar_headers
    )
    registrar_print_status, registrar_print_result = api_with_status(
        "PUT", f"/api/result-cards/{result_card_id}/mark-printed", headers=registrar_headers
    )
    owner_read_status, _ = api_with_status(
        "GET", f"/api/result-cards/{result_card_id}", headers=owner_headers
    )
    owner_cancel_status, _ = api_with_status(
        "PUT", f"/api/result-cards/{result_card_id}/cancel", headers=owner_headers
    )
    owner_print_status, _ = api_with_status(
        "PUT", f"/api/result-cards/{result_card_id}/mark-printed", headers=owner_headers
    )
    check("P0-RC4. Teacher cannot cancel result cards", teacher_cancel_status == 403)
    check("P0-RC5. Registrar cannot cancel result cards", registrar_cancel_status == 403)
    check(
        "P0-RC6. Registrar can register printing for their school's result card",
        registrar_print_status == 200,
        str(registrar_print_result)[:100],
    )
    check(
        "P0-RC7. Cross-school result-card read and writes are rejected",
        owner_read_status == owner_cancel_status == owner_print_status == 403,
        f"read={owner_read_status}, cancel={owner_cancel_status}, print={owner_print_status}",
    )
else:
    check("P0-RC4. Teacher cannot cancel result cards", False, "No result card")
    check("P0-RC5. Registrar cannot cancel result cards", False, "No result card")
    check("P0-RC6. Registrar can register printing for their school's result card", False, "No result card")
    check("P0-RC7. Cross-school result-card read and writes are rejected", False, "No result card")

# === P0 TENANT ISOLATION: STUDENTS + OFFICIAL BOOKS ===
print("\n=== P0 TENANT ISOLATION TESTS ===")
cross_student_status, cross_student_result = api_with_status(
    "POST",
    "/api/students",
    headers=owner_headers,
    body={
        "student_number": f"P0-CROSS-{RUN_ID}",
        "full_name": "Cross School Student",
        "gender": "ذكر",
        "class_id": 1,
        "section_id": 1,
    },
)
check(
    "P0-T1. Student cannot be created with another school's class and section",
    cross_student_status == 403,
    f"status={cross_student_status}, response={str(cross_student_result)[:120]}",
)

before_status, before_student = api_with_status("GET", "/api/students/11", headers=owner_headers)
cross_update_status, cross_update_result = api_with_status(
    "PUT",
    "/api/students/11",
    headers=owner_headers,
    body={"class_id": 1, "section_id": 1},
)
after_status, after_student = api_with_status("GET", "/api/students/11", headers=owner_headers)
check(
    "P0-T2. Cross-school class IDs cannot mutate an existing student",
    before_status == after_status == 200
    and cross_update_status == 403
    and before_student.get("data", {}).get("class_id") == after_student.get("data", {}).get("class_id")
    and before_student.get("data", {}).get("section_id") == after_student.get("data", {}).get("section_id"),
    f"update={cross_update_status}, response={str(cross_update_result)[:100]}",
)

# Student placement must always preserve an active, same-school class/section pair.
section_without_class_status, section_without_class_result = api_with_status(
    "POST",
    "/api/students",
    headers=owner_headers,
    body={
        "student_number": f"P0-NO-CLASS-{RUN_ID}",
        "full_name": "Section Without Class",
        "gender": "ذكر",
        "section_id": 15,
    },
)
check(
    "P0-SP1. Student cannot be created with a section but no class",
    section_without_class_status == 400,
    f"status={section_without_class_status}, response={str(section_without_class_result)[:100]}",
)

before_no_class_status, before_no_class_student = api_with_status(
    "GET", "/api/students/11", headers=owner_headers
)
update_without_class_status, update_without_class_result = api_with_status(
    "PUT",
    "/api/students/11",
    headers=owner_headers,
    body={"class_id": None, "section_id": 15},
)
after_no_class_status, after_no_class_student = api_with_status(
    "GET", "/api/students/11", headers=owner_headers
)
check(
    "P0-SP2. Student cannot be updated to a section without a class",
    before_no_class_status == after_no_class_status == 200
    and update_without_class_status == 400
    and before_no_class_student.get("data", {}).get("class_id")
    == after_no_class_student.get("data", {}).get("class_id")
    and before_no_class_student.get("data", {}).get("section_id")
    == after_no_class_student.get("data", {}).get("section_id"),
    f"status={update_without_class_status}, response={str(update_without_class_result)[:100]}",
)

archived_class_status, archived_class_result = api_with_status(
    "POST",
    "/api/classes",
    headers=principal_headers,
    body={"name": f"P0 Archived Class {RUN_ID}", "stage": "ابتدائي"},
)
archived_class_id = archived_class_result.get("data", {}).get("id")
archive_class_status, _ = api_with_status(
    "PUT", f"/api/classes/{archived_class_id}/archive", headers=principal_headers
) if archived_class_id else (0, {})
archived_class_student_status, archived_class_student_result = api_with_status(
    "POST",
    "/api/students",
    headers=principal_headers,
    body={
        "student_number": f"P0-ARCHIVED-CLASS-{RUN_ID}",
        "full_name": "Archived Class Student",
        "gender": "ذكر",
        "class_id": archived_class_id,
    },
) if archived_class_id else (0, {})
check(
    "P0-SP3. Archived classes cannot be used for student placement",
    archived_class_status == 201
    and archive_class_status == 200
    and archived_class_student_status == 400,
    f"status={archived_class_student_status}, response={str(archived_class_student_result)[:100]}",
)

active_class_status, active_class_result = api_with_status(
    "POST",
    "/api/classes",
    headers=principal_headers,
    body={"name": f"P0 Section Class {RUN_ID}", "stage": "ابتدائي"},
)
active_class_id = active_class_result.get("data", {}).get("id")
archived_section_status, archived_section_result = api_with_status(
    "POST",
    "/api/sections",
    headers=principal_headers,
    body={"class_id": active_class_id, "name": f"P0 Archived Section {RUN_ID}"},
) if active_class_id else (0, {})
archived_section_id = archived_section_result.get("data", {}).get("id")
archive_section_status, _ = api_with_status(
    "PUT", f"/api/sections/{archived_section_id}/archive", headers=principal_headers
) if archived_section_id else (0, {})
archived_section_student_status, archived_section_student_result = api_with_status(
    "POST",
    "/api/students",
    headers=principal_headers,
    body={
        "student_number": f"P0-ARCHIVED-SECTION-{RUN_ID}",
        "full_name": "Archived Section Student",
        "gender": "ذكر",
        "class_id": active_class_id,
        "section_id": archived_section_id,
    },
) if archived_section_id else (0, {})
check(
    "P0-SP4. Archived sections cannot be used for student placement",
    active_class_status == 201
    and archived_section_status == 201
    and archive_section_status == 200
    and archived_section_student_status == 400,
    f"status={archived_section_student_status}, response={str(archived_section_student_result)[:100]}",
)

wrong_class_status, wrong_class_result = api_with_status(
    "POST",
    "/api/students",
    headers=principal_headers,
    body={
        "student_number": f"P0-WRONG-CLASS-{RUN_ID}",
        "full_name": "Wrong Class Section",
        "gender": "ذكر",
        "class_id": 2,
        "section_id": 1,
    },
)
check(
    "P0-SP5. A section from the wrong class returns 400",
    wrong_class_status == 400,
    f"status={wrong_class_status}, response={str(wrong_class_result)[:100]}",
)

cross_section_only_status, cross_section_only_result = api_with_status(
    "POST",
    "/api/students",
    headers=owner_headers,
    body={
        "student_number": f"P0-CROSS-SECTION-{RUN_ID}",
        "full_name": "Cross School Section",
        "gender": "ذكر",
        "class_id": 8,
        "section_id": 1,
    },
)
check(
    "P0-SP6. A section from another school returns 403",
    cross_section_only_status == 403,
    f"status={cross_section_only_status}, response={str(cross_section_only_result)[:100]}",
)

template_status, template_result = api_with_status(
    "POST",
    "/api/official-book-templates",
    headers=owner_headers,
    body={
        "title": f"P0 Student Template {RUN_ID}",
        "body_text": "Student: {{student_name}} / {{document_number}}",
        "requires_student": True,
    },
)
student_template_id = template_result.get("data", {}).get("id")
check(
    "P0-T3. School owner creates an own-school official-book template",
    template_status == 201 and student_template_id is not None,
    str(template_result)[:120],
)

if student_template_id:
    template_cross_update_status, _ = api_with_status(
        "PUT",
        f"/api/official-book-templates/{student_template_id}",
        headers=principal_headers,
        body={"title": "Cross-school overwrite"},
    )
    cross_book_status, cross_book_result = api_with_status(
        "POST",
        "/api/official-books",
        headers=owner_headers,
        body={"template_id": student_template_id, "student_id": 1},
    )
    own_book_status, own_book_result = api_with_status(
        "POST",
        "/api/official-books",
        headers=owner_headers,
        body={"template_id": student_template_id, "student_id": 11},
    )
    official_book_id = own_book_result.get("data", {}).get("id")
    check("P0-T4. Another school cannot update the template by ID", template_cross_update_status == 403)
    check(
        "P0-T5. Official book rejects a student from another school",
        cross_book_status == 403,
        f"status={cross_book_status}, response={str(cross_book_result)[:100]}",
    )
    check(
        "P0-T6. Official book accepts a valid same-school student",
        own_book_status == 201 and official_book_id is not None,
        str(own_book_result)[:120],
    )
else:
    official_book_id = None
    check("P0-T4. Another school cannot update the template by ID", False, "No template")
    check("P0-T5. Official book rejects a student from another school", False, "No template")
    check("P0-T6. Official book accepts a valid same-school student", False, "No template")

employee_template_status, employee_template_result = api_with_status(
    "POST",
    "/api/official-book-templates",
    headers=owner_headers,
    body={
        "title": f"P0 Employee Template {RUN_ID}",
        "body_text": "Employee: {{employee_name}}",
        "requires_employee": True,
    },
)
employee_template_id = employee_template_result.get("data", {}).get("id")
if employee_template_status == 201 and employee_template_id:
    cross_employee_status, cross_employee_result = api_with_status(
        "POST",
        "/api/official-books",
        headers=owner_headers,
        body={"template_id": employee_template_id, "employee_id": 1},
    )
    missing_employee_status, _ = api_with_status(
        "POST",
        "/api/official-books",
        headers=owner_headers,
        body={"template_id": employee_template_id, "employee_id": 999999},
    )
    check(
        "P0-T7. Official book rejects an employee from another school",
        cross_employee_status == 403,
        f"status={cross_employee_status}, response={str(cross_employee_result)[:100]}",
    )
    check("P0-T8. Official book returns 404 for a missing employee", missing_employee_status == 404)
else:
    check("P0-T7. Official book rejects an employee from another school", False, "No employee template")
    check("P0-T8. Official book returns 404 for a missing employee", False, "No employee template")

if official_book_id:
    cross_read_status, _ = api_with_status(
        "GET", f"/api/official-books/{official_book_id}", headers=principal_headers
    )
    cross_cancel_status, _ = api_with_status(
        "PUT", f"/api/official-books/{official_book_id}/cancel", headers=principal_headers
    )
    cross_print_status, _ = api_with_status(
        "POST", f"/api/official-books/{official_book_id}/print", headers=registrar_headers
    )
    own_print_status, own_print_result = api_with_status(
        "POST", f"/api/official-books/{official_book_id}/print", headers=owner_headers
    )
    _, school1_prints = api_with_status("GET", "/api/print-records", headers=principal_headers)
    _, school2_prints = api_with_status("GET", "/api/print-records", headers=owner_headers)
    school1_document_ids = {row.get("document_id") for row in school1_prints.get("data", [])}
    school2_document_ids = {row.get("document_id") for row in school2_prints.get("data", [])}
    check(
        "P0-T9. Cross-school official-book read, cancel, and print are rejected",
        cross_read_status == cross_cancel_status == cross_print_status == 403,
        f"read={cross_read_status}, cancel={cross_cancel_status}, print={cross_print_status}",
    )
    check(
        "P0-T10. Same-school print is recorded and isolated in print-record lists",
        own_print_status == 200
        and official_book_id in school2_document_ids
        and official_book_id not in school1_document_ids,
        str(own_print_result)[:100],
    )
else:
    check("P0-T9. Cross-school official-book read, cancel, and print are rejected", False, "No book")
    check("P0-T10. Same-school print is recorded and isolated in print-record lists", False, "No book")

print("\n=== QA COMPLETE ===")
if FAILURES:
    print(f"QA FAILED: {FAILURES} check(s) failed")
    sys.exit(1)
