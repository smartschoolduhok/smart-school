# P0 Authentication & API Security

## Scope

This phase hardens authentication and the API boundary without changing school product features or the existing tenant/RBAC policies.

## Confirmed previous weaknesses

- Passwords used one fast SHA-256 digest with the fixed legacy salt `smart-school-salt-2026`.
- JWT signing silently fell back to `default-dev-secret-change-me`.
- JWTs had no unique session identifier and logout stored the complete bearer token in D1.
- The global API middleware parsed authentication opportunistically, so routes without a route-specific guard could remain public.
- CORS returned `Access-Control-Allow-Origin: *`.
- Login had no bounded brute-force protection and exposed a distinct inactive-account response.
- The browser persists the bearer token in `localStorage`, which increases impact if script execution is compromised.

## Password policy and legacy migration

New and reset passwords use the versioned format:

`pbkdf2_sha256$210000$<random-salt>$<derived-key>`

PBKDF2 uses Web Crypto, HMAC-SHA-256, a random 16-byte salt per password, 210,000 iterations, and a 32-byte derived key. Comparisons are performed without early exit.

Existing 64-character legacy SHA-256 hashes remain usable. A successful legacy login verifies with the old email-bound calculation, creates a new PBKDF2 hash immediately, updates `users.password_hash`, and continues the login. Failed or inactive logins never trigger a stored-hash upgrade. User creation and password reset never write the legacy format.

The known hashes in `seed.sql` intentionally remain legacy fixtures so local QA continuously exercises migration. **Never load `seed.sql` into a production database.**

## JWT and session policy

- HS256 signing requires a validated `JWT_SECRET`; there is no fallback.
- Secrets shorter than 32 characters and obvious placeholders are rejected.
- Every session receives a cryptographically random 128-bit `jti`.
- Every session carries the user's integer `auth_version` from D1.
- Session lifetime is eight hours.
- Every authenticated request verifies the signature/expiry, checks `jti` revocation, then reloads the active user, role, status, school, and current `auth_version` from D1.
- Password reset increments `users.auth_version`, so every previously issued JWT for that user fails with 401 immediately. A new password login receives the new version.
- The automatic legacy-to-PBKDF2 upgrade does not increment `auth_version`, so the session created by that successful migration login remains valid.
- Logout stores only `jti`, user ID, and expiry in `revoked_sessions`. Raw bearer tokens are never stored by the new flow.
- Tokens issued before this migration do not contain `jti` or `auth_version` and are intentionally rejected; users must sign in again once.
- Expired revocations are cleaned during login/logout maintenance.

Migration: `migrations/0016_auth_security.sql` adds `users.auth_version`, creates `revoked_sessions` and `login_throttles`, and adds expiry/lookup indexes. Historical migrations and the old `token_blacklist` table are not modified.

## Authenticated-by-default API

All `/api/*` requests require a valid active session unless they match this explicit allowlist:

- `POST /api/auth/login`
- `GET /api/verify/result-card/:token`
- `GET /api/verify/receipt/:token`
- `GET /api/verify/official-book/:token`
- CORS `OPTIONS` preflight requests from allowed origins

`GET /api/auth/me` and `POST /api/auth/logout` are protected. Existing route-level RBAC remains in place as defense in depth.

## CORS policy

- Same-origin requests work without a CORS header.
- Additional browser origins must be listed in the comma-separated `ALLOWED_ORIGINS` environment variable.
- `APP_ENV=development`, `test`, or `local` additionally permits `http://localhost:3000` and `http://127.0.0.1:3000`.
- Unknown/malformed origins receive 403 and no permissive origin header.
- Wildcard origins and credentialed CORS are not used.

Example production configuration:

`ALLOWED_ORIGINS=https://school.example,https://admin.school.example`

## Login throttle policy

Every login is checked against two independent, SHA-256-keyed D1 buckets. The IP is read from `CF-Connecting-IP`, then the first `X-Forwarded-For` value, with a non-identifying fallback.

| Bucket | Subject | Window | Failure limit | Temporary lock |
|---|---|---:|---:|---:|
| Account | Normalized email, independent of IP | 15 minutes | 5 | 15 minutes |
| IP | Client IP, independent of email | 15 minutes | 40 | 15 minutes |

The IP threshold is deliberately higher because staff and students may share one school/NAT address. Rotating IPs cannot reset an account's budget, while rotating account names cannot reset an attacking IP's budget. If either bucket is locked, the response is the same generic 429 and `Retry-After` reports the longest applicable remaining lock without identifying the bucket.

Failure counting is atomic: one SQLite/D1 `INSERT ... ON CONFLICT DO UPDATE` statement increments `login_throttles.failed_attempts` from the database's current row and returns the stored result with `RETURNING`. No count computed by a preceding Worker `SELECT` is written back, so concurrent failures cannot overwrite one another.

A successful login deletes only that normalized account's bucket. It never clears the IP bucket, preventing one successful credential from erasing address-wide abuse history. Expired windows recover automatically, and stale rows are retained for at most 24 hours before cleanup.

Unknown email, incorrect password, and inactive account return the same public 401 message. Nonexistent accounts still perform an expensive PBKDF2 operation to reduce timing differences.

PBKDF2 remains at 210,000 iterations. During review validation on the local Codex host, direct Web Crypto verification averaged 32.2 ms across five samples. Three end-to-end logins through local Wrangler/workerd took 678.9 ms cold and 217.2/210.5 ms warm. These are local development measurements, not Cloudflare production guarantees; final CPU/runtime validation must be performed on a real Cloudflare staging deployment before production.

## Required Cloudflare configuration

Set the signing key as a Cloudflare Pages secret; never put it in `wrangler.jsonc` or source control:

`npx wrangler pages secret put JWT_SECRET`

Set non-secret variables in the Pages environment:

- `ALLOWED_ORIGINS`: approved comma-separated origins
- `APP_ENV=production`

Authentication fails closed with a safe 503 response when the signing secret is missing or unsafe. The secret and internal crypto/database errors are not returned to clients.

## Deferred: HttpOnly cookie session

The frontend still stores `smart_school_token` in `localStorage` and sends a Bearer header. A full migration requires coordinated cookie issuance, CSRF rules, frontend state changes, backward compatibility, and deployment testing. It is intentionally deferred to the immediate next security PR rather than partially implemented here. Until then, strict XSS prevention and short session lifetime remain important.
