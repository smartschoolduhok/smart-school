import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
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
  LOGIN_THROTTLE_POLICY,
  PUBLIC_API_ROUTES,
  createLoginThrottleKey,
  getAllowedCorsOrigins,
  inspectLoginThrottle,
  isCorsOriginAllowed,
  isPublicApiRequest,
  recordLoginFailure,
} from '../src/lib/apiSecurity.ts';

const secureSecret = 'Q7v!2mZ9#pR4xL8cN6sT1wY5kF3hJ0dB';

test('new password hashes use PBKDF2 and verify correctly', async () => {
  const hash = await hashPassword('correct horse battery staple');
  assert.equal(hash.startsWith(PASSWORD_HASH_SCHEME + '$'), true);
  assert.deepEqual(await verifyPassword('correct horse battery staple', hash), {
    valid: true,
    needsUpgrade: false,
    scheme: 'pbkdf2_sha256',
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
    { email: 'admin@example.test', id: 1 },
    secureSecret,
    { nowSeconds: 1_000, expiresInSeconds: 600, jti: 'abcdefghijklmnop' },
  );
  const payload = await verifyJWT(token, secureSecret, 1_001);
  assert.equal(payload?.email, 'admin@example.test');
  assert.equal(payload?.jti, 'abcdefghijklmnop');
  assert.equal(decodeJwtPayloadUnsafe(token)?.exp, 1_600);
});

test('generated JWT identifiers are random per session', async () => {
  const first = decodeJwtPayloadUnsafe(await signJWT({ email: 'admin@example.test' }, secureSecret));
  const second = decodeJwtPayloadUnsafe(await signJWT({ email: 'admin@example.test' }, secureSecret));
  assert.ok(first?.jti);
  assert.ok(second?.jti);
  assert.notEqual(first?.jti, second?.jti);
});

test('expired, tampered, and malformed JWTs are rejected', async () => {
  const token = await signJWT(
    { email: 'admin@example.test' },
    secureSecret,
    { nowSeconds: 1_000, expiresInSeconds: 60, jti: 'abcdefghijklmnop' },
  );
  assert.equal(await verifyJWT(token, secureSecret, 1_060), null);
  assert.equal(await verifyJWT(token.slice(0, -1) + 'x', secureSecret, 1_001), null);
  assert.equal(await verifyJWT('not-a-token', secureSecret, 1_001), null);
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

test('login throttle locks on the configured failed-attempt threshold', () => {
  let record = null;
  let decision;
  for (let attempt = 1; attempt <= LOGIN_THROTTLE_POLICY.maxAttempts; attempt += 1) {
    decision = recordLoginFailure(record, 10_000);
    record = {
      failed_attempts: decision.failedAttempts,
      window_started_at: decision.windowStartedAt,
      locked_until: decision.lockedUntil,
    };
  }
  assert.equal(decision.limited, true);
  assert.equal(decision.retryAfter, LOGIN_THROTTLE_POLICY.lockSeconds);
});

test('expired login throttles recover automatically', () => {
  const record = {
    failed_attempts: LOGIN_THROTTLE_POLICY.maxAttempts,
    window_started_at: 1_000,
    locked_until: 1_100,
  };
  const recovered = inspectLoginThrottle(record, 1_000 + LOGIN_THROTTLE_POLICY.windowSeconds + 1);
  assert.equal(recovered.limited, false);
  assert.equal(recovered.failedAttempts, 0);
});

test('login throttle keys normalize email and include client IP', async () => {
  const first = await createLoginThrottleKey(' Admin@Example.Test ', '192.0.2.1');
  const normalized = await createLoginThrottleKey('admin@example.test', '192.0.2.1');
  const differentIp = await createLoginThrottleKey('admin@example.test', '192.0.2.2');
  assert.equal(first, normalized);
  assert.notEqual(first, differentIp);
});

test('migration and worker store revoked jti values instead of raw JWTs', async () => {
  const migration = await readFile(new URL('../migrations/0016_auth_security.sql', import.meta.url), 'utf8');
  const worker = await readFile(new URL('../src/worker.ts', import.meta.url), 'utf8');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS revoked_sessions/);
  assert.equal(worker.includes('INSERT OR IGNORE INTO revoked_sessions (jti, user_id, expires_at, revoked_at)'), true);
  assert.doesNotMatch(worker, /token_blacklist/);
  assert.doesNotMatch(worker, /default-dev-secret-change-me/);
});
