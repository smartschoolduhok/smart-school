import assert from 'node:assert/strict';
import { pbkdf2Sync } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  PBKDF2_DERIVED_KEY_BYTES,
  PBKDF2_ITERATIONS,
  PBKDF2_SALT_BYTES,
  PASSWORD_HASH_SCHEME,
  createLegacyPasswordHash,
  hashPassword,
  isLegacyPasswordHash,
  verifyPassword,
} from '../src/lib/authSecurity.ts';
import {
  AuthConfigurationError,
  decodeJwtPayloadUnsafe,
  getValidatedJwtSecret,
  signJWT,
  verifyJWT,
} from '../src/lib/jwtSecurity.ts';
import {
  LOGIN_THROTTLE_POLICIES,
  PUBLIC_API_ROUTES,
  createLoginThrottleKey,
  getAllowedCorsOrigins,
  inspectLoginThrottle,
  isCorsOriginAllowed,
  isPublicApiRequest,
} from '../src/lib/apiSecurity.ts';

const secureSecret = 'Q7v!2mZ9#pR4xL8cN6sT1wY5kF3hJ0dB';

test('new password hashes use PBKDF2-SHA256 with 100000 iterations and verify correctly', async () => {
  const hash = await hashPassword('correct horse battery staple');
  const [scheme, iterations, encodedSalt, encodedKey] = hash.split('$');
  assert.equal(scheme, PASSWORD_HASH_SCHEME);
  assert.equal(Number(iterations), 100_000);
  assert.equal(Number(iterations), PBKDF2_ITERATIONS);
  assert.equal(Buffer.from(encodedSalt, 'base64url').length, PBKDF2_SALT_BYTES);
  assert.equal(Buffer.from(encodedKey, 'base64url').length, PBKDF2_DERIVED_KEY_BYTES);
  assert.deepEqual(await verifyPassword('correct horse battery staple', hash), {
    valid: true,
    needsUpgrade: false,
    scheme: 'pbkdf2_sha256',
  });
});

test('independently generated PBKDF2-SHA256 hashes remain verifiable', async () => {
  const password = 'independent-password';
  const salt = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
  const derivedKey = pbkdf2Sync(
    password,
    salt,
    PBKDF2_ITERATIONS,
    PBKDF2_DERIVED_KEY_BYTES,
    'sha256',
  );
  const hash = [
    PASSWORD_HASH_SCHEME,
    PBKDF2_ITERATIONS,
    salt.toString('base64url'),
    derivedKey.toString('base64url'),
  ].join('$');

  assert.deepEqual(await verifyPassword(password, hash), {
    valid: true,
    needsUpgrade: false,
    scheme: 'pbkdf2_sha256',
  });
});

test('PBKDF2 hashes above the Cloudflare runtime maximum fail safely', async () => {
  const unsupportedHash = [
    PASSWORD_HASH_SCHEME,
    PBKDF2_ITERATIONS + 1,
    Buffer.alloc(PBKDF2_SALT_BYTES, 1).toString('base64url'),
    Buffer.alloc(PBKDF2_DERIVED_KEY_BYTES, 2).toString('base64url'),
  ].join('$');

  await assert.doesNotReject(async () => {
    assert.deepEqual(await verifyPassword('password', unsupportedHash), {
      valid: false,
      needsUpgrade: false,
      scheme: 'unknown',
    });
  });
});

test('wrong passwords are rejected', async () => {
  const hash = await hashPassword('right-password');
  assert.equal((await verifyPassword('wrong-password', hash)).valid, false);
});

test('identical passwords receive different random salts', async () => {
  const first = await hashPassword('same-password');
  const second = await hashPassword('same-password');
  assert.notEqual(first, second);
  assert.notEqual(first.split('$')[2], second.split('$')[2]);
});

test('legacy SHA-256 hashes remain verifiable and require upgrade', async () => {
  const email = 'legacy@example.test';
  const hash = await createLegacyPasswordHash('legacy-password', email);
  assert.equal(isLegacyPasswordHash(hash), true);
  assert.deepEqual(await verifyPassword('legacy-password', hash, email), {
    valid: true,
    needsUpgrade: true,
    scheme: 'legacy_sha256',
  });
  assert.equal((await verifyPassword('wrong-password', hash, email)).valid, false);
});

test('missing and unsafe JWT secrets fail closed', () => {
  for (const secret of [undefined, '', 'short', 'default-dev-secret-change-me', 'your-secret-key-placeholder']) {
    assert.throws(() => getValidatedJwtSecret(secret), AuthConfigurationError);
  }
});

test('valid JWTs include a jti and are accepted', async () => {
  const token = await signJWT(
    { email: 'admin@example.test', id: 1, auth_version: 1 },
    secureSecret,
    { nowSeconds: 1_000, expiresInSeconds: 600, jti: 'abcdefghijklmnop' },
  );
  const payload = await verifyJWT(token, secureSecret, 1_001);
  assert.equal(payload?.email, 'admin@example.test');
  assert.equal(payload?.auth_version, 1);
  assert.equal(payload?.jti, 'abcdefghijklmnop');
  assert.equal(decodeJwtPayloadUnsafe(token)?.exp, 1_600);
});

test('generated JWT identifiers are random per session', async () => {
  const first = decodeJwtPayloadUnsafe(await signJWT({ email: 'admin@example.test', auth_version: 1 }, secureSecret));
  const second = decodeJwtPayloadUnsafe(await signJWT({ email: 'admin@example.test', auth_version: 1 }, secureSecret));
  assert.ok(first?.jti);
  assert.ok(second?.jti);
  assert.notEqual(first?.jti, second?.jti);
});

test('expired, tampered, and malformed JWTs are rejected', async () => {
  const token = await signJWT(
    { email: 'admin@example.test', auth_version: 1 },
    secureSecret,
    { nowSeconds: 1_000, expiresInSeconds: 60, jti: 'abcdefghijklmnop' },
  );
  assert.equal(await verifyJWT(token, secureSecret, 1_060), null);
  assert.equal(await verifyJWT(token.slice(0, -1) + 'x', secureSecret, 1_001), null);
  assert.equal(await verifyJWT('not-a-token', secureSecret, 1_001), null);
});

test('JWTs without a valid authentication version are rejected', async () => {
  const missingVersion = await signJWT(
    { email: 'admin@example.test' },
    secureSecret,
    { nowSeconds: 1_000, expiresInSeconds: 60, jti: 'abcdefghijklmnop' },
  );
  const invalidVersion = await signJWT(
    { email: 'admin@example.test', auth_version: 0 },
    secureSecret,
    { nowSeconds: 1_000, expiresInSeconds: 60, jti: 'ponmlkjihgfedcba' },
  );
  assert.equal(await verifyJWT(missingVersion, secureSecret, 1_001), null);
  assert.equal(await verifyJWT(invalidVersion, secureSecret, 1_001), null);
});

test('the public API allowlist contains only login and QR verification routes', () => {
  assert.deepEqual(PUBLIC_API_ROUTES, [
    'POST /api/auth/login',
    'GET /api/verify/result-card/:token',
    'GET /api/verify/receipt/:token',
    'GET /api/verify/official-book/:token',
  ]);
  assert.equal(isPublicApiRequest('POST', '/api/auth/login'), true);
  assert.equal(isPublicApiRequest('GET', '/api/verify/result-card/token'), true);
  assert.equal(isPublicApiRequest('GET', '/api/verify/receipt/token'), true);
  assert.equal(isPublicApiRequest('GET', '/api/verify/official-book/token'), true);
  assert.equal(isPublicApiRequest('OPTIONS', '/api/students'), true);
});

test('representative business and session routes are protected by default', () => {
  for (const route of ['/api/schools', '/api/students', '/api/auth/me', '/api/auth/logout']) {
    assert.equal(isPublicApiRequest('GET', route), false);
    assert.equal(isPublicApiRequest('POST', route), false);
  }
});

test('CORS permits configured and explicit local-development origins', () => {
  const production = getAllowedCorsOrigins('https://school.example,https://admin.example', 'production');
  assert.equal(isCorsOriginAllowed('https://school.example', 'https://api.example/api/auth/login', production), true);
  const local = getAllowedCorsOrigins(undefined, 'development');
  assert.equal(isCorsOriginAllowed('http://localhost:3000', 'https://api.example/api/auth/login', local), true);
});

test('same-origin requests work without wildcard CORS', () => {
  const allowed = getAllowedCorsOrigins(undefined, 'production');
  assert.equal(isCorsOriginAllowed(undefined, 'https://school.example/api/students', allowed), true);
  assert.equal(isCorsOriginAllowed('https://school.example', 'https://school.example/api/students', allowed), true);
});

test('unapproved and malformed CORS origins are rejected', () => {
  const allowed = getAllowedCorsOrigins('https://school.example', 'production');
  assert.equal(isCorsOriginAllowed('https://evil.example', 'https://school.example/api/students', allowed), false);
  assert.equal(isCorsOriginAllowed('not-an-origin', 'https://school.example/api/students', allowed), false);
});

test('account and IP throttle policies use independent failure budgets', () => {
  assert.deepEqual(LOGIN_THROTTLE_POLICIES.account, {
    maxAttempts: 5,
    windowSeconds: 900,
    lockSeconds: 900,
    retentionSeconds: 86_400,
  });
  assert.equal(LOGIN_THROTTLE_POLICIES.ip.maxAttempts, 40);
  assert.equal(LOGIN_THROTTLE_POLICIES.ip.windowSeconds, 900);
  assert.ok(LOGIN_THROTTLE_POLICIES.ip.maxAttempts > LOGIN_THROTTLE_POLICIES.account.maxAttempts);
});

test('expired login throttles recover automatically', () => {
  const record = {
    failed_attempts: LOGIN_THROTTLE_POLICIES.account.maxAttempts,
    window_started_at: 1_000,
    locked_until: 1_100,
  };
  const recovered = inspectLoginThrottle(
    record,
    1_000 + LOGIN_THROTTLE_POLICIES.account.windowSeconds + 1,
    LOGIN_THROTTLE_POLICIES.account,
  );
  assert.equal(recovered.limited, false);
  assert.equal(recovered.failedAttempts, 0);
});

test('account buckets cannot be bypassed by rotating IP addresses', async () => {
  const keys = await Promise.all(
    ['192.0.2.1', '192.0.2.2', '192.0.2.3'].map(() => (
      createLoginThrottleKey('account', ' Admin@Example.Test ')
    )),
  );
  assert.equal(new Set(keys).size, 1);
  assert.equal(keys[0], await createLoginThrottleKey('account', 'admin@example.test'));
});

test('IP buckets aggregate failures across different account names', async () => {
  const keys = await Promise.all(
    ['first@example.test', 'second@example.test', 'third@example.test'].map(() => (
      createLoginThrottleKey('ip', '192.0.2.50')
    )),
  );
  assert.equal(new Set(keys).size, 1);
  assert.notEqual(keys[0], await createLoginThrottleKey('ip', '192.0.2.51'));
  assert.notEqual(keys[0], await createLoginThrottleKey('account', '192.0.2.50'));
});

test('failure recording uses a database-current atomic UPSERT', async () => {
  const worker = await readFile(new URL('../src/worker.ts', import.meta.url), 'utf8');
  assert.match(worker, /ON CONFLICT\(subject_hash\) DO UPDATE SET/);
  assert.match(worker, /login_throttles\.failed_attempts \+ 1/);
  assert.match(worker, /RETURNING failed_attempts, window_started_at, locked_until/);
  assert.doesNotMatch(worker, /recordLoginFailure/);
});

test('migration and worker store revoked jti values instead of raw JWTs', async () => {
  const migration = await readFile(new URL('../migrations/0016_auth_security.sql', import.meta.url), 'utf8');
  const worker = await readFile(new URL('../src/worker.ts', import.meta.url), 'utf8');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS revoked_sessions/);
  assert.match(migration, /ALTER TABLE users ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 1/);
  assert.match(migration, /bucket_type\s+TEXT NOT NULL/);
  assert.equal(worker.includes('INSERT OR IGNORE INTO revoked_sessions (jti, user_id, expires_at, revoked_at)'), true);
  assert.match(worker, /payload\.auth_version !== authenticated\.authVersion/);
  assert.match(worker, /auth_version = auth_version \+ 1/);
  assert.doesNotMatch(worker, /token_blacklist/);
  assert.doesNotMatch(worker, /default-dev-secret-change-me/);
});
