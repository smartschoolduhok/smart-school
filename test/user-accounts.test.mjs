import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';
import { financeFixture, root, snapshot, migrationSQL } from './helpers/finance-fixture.mjs';
import { hashPassword, verifyPassword } from '../src/lib/authSecurity.ts';
import { decodeJwtPayloadUnsafe, signJWT, verifyJWT } from '../src/lib/jwtSecurity.ts';

const vite = await createServer({ root, appType: 'custom', server: { middlewareMode: true, hmr: false } });
const { default: app } = await vite.ssrLoadModule('/src/worker.ts');
after(() => vite.close());
const secret = 'generated-local-user-account-tests-09d4c8f01d7';
const password = 'Existing-local-password-2026';
const newPassword = 'Replacement-local-password-2026';
const passwordHash = await hashPassword(password);
const origin = 'https://accounts.test';

function fixture(t) {
  const f = financeFixture(t);
  f.db.exec(`INSERT INTO users(id,school_id,full_name,email,role_id,status,auth_version) VALUES
    (9,2,'Foreign teacher','foreign@accounts.test',5,'active',1),
    (10,1,'Another owner','other-owner@accounts.test',2,'active',1),
    (11,1,'School-scoped system administrator','scoped-admin@accounts.test',1,'active',1)`);
  f.db.prepare('UPDATE users SET password_hash=?').run(passwordHash);
  return f;
}

async function token(f, id = 1) {
  const user = f.db.prepare('SELECT u.id,u.email,u.school_id,u.auth_version,r.key AS role_key FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=?').get(id);
  return signJWT({ ...user, session_transport: 'bearer' }, secret);
}

async function request(f, path, { method = 'GET', body, rawBody, user = 1, bearer, headers = {}, anonymous = false } = {}) {
  const credentials = anonymous ? {} : { Authorization: `Bearer ${bearer ?? await token(f, user)}` };
  const res = await app.fetch(new Request(origin + path, {
    method,
    headers: { ...credentials, ...(body !== undefined || rawBody !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
  }), { DB: f.d1, JWT_SECRET: secret, APP_ENV: 'staging' });
  const json = await res.json();
  return { res, json, status: res.status, data: json.data };
}

async function login(f, email, suppliedPassword, { cookie = false } = {}) {
  const r = await request(f, '/api/auth/login', {
    method: 'POST', anonymous: true,
    body: { email, password: suppliedPassword, session_mode: cookie ? 'cookie' : 'bearer' },
    headers: cookie ? { Origin: origin, 'Sec-Fetch-Site': 'same-origin' } : {},
  });
  return { ...r, bearer: r.data?.token, cookie: r.res.headers.get('set-cookie')?.split(';')[0], csrf: r.data?.csrf_token };
}

const draft = (patch = {}) => ({ full_name: 'Generated account', email: 'generated@accounts.test', role_key: 'teacher', phone: '07000000000', ...patch });
const current = (f, id = 3) => f.db.prepare('SELECT * FROM users WHERE id=?').get(id);
const auditRows = f => f.db.prepare('SELECT * FROM user_account_audit ORDER BY id').all();
const guardCount = f => f.db.prepare('SELECT COUNT(*) AS n FROM user_account_write_guards').get().n;
const version = (f, id = 3) => current(f, id).account_revision;
const editBody = (f, id = 3, patch = {}) => ({ expected_revision: version(f, id), full_name: 'Edited account', ...patch });
const assertNoSecrets = (data, ...secrets) => {
  const encoded = JSON.stringify(data);
  assert.doesNotMatch(encoded, /password_hash|pbkdf2_sha256|csrf_token|session_transport/);
  for (const value of secrets.filter(Boolean)) assert.equal(encoded.includes(value), false, 'sensitive credential appeared in response or audit');
};

async function create(f, patch = {}, options = {}) {
  const r = await request(f, '/api/users', { method: 'POST', body: draft(patch), ...options });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.data;
}

async function deniedWithoutChanges(f, path, options, statuses = [400, 403, 404]) {
  const before = snapshot(f.db);
  const r = await request(f, path, options);
  assert.ok(statuses.includes(r.status), `expected ${statuses.join('/')} but got ${r.status}: ${JSON.stringify(r.json)}`);
  assert.deepEqual(snapshot(f.db), before);
  return r;
}

test('the account migration preserves every existing school record and initializes existing accounts without forcing password resets', t => {
  const f = financeFixture(t, { through: '0051' });
  const before = snapshot(f.db);
  // Isolate the account upgrade; later feature migrations may add columns to
  // unrelated records without changing any of their existing values.
  f.db.exec(migrationSQL('0052_school_user_accounts.sql'));
  const afterMigration = snapshot(f.db);
  for (const [table, rows] of Object.entries(before)) {
    if (table === 'users') {
      const actual = f.db.prepare('SELECT * FROM users ORDER BY id').all();
      for (const old of rows) {
        const next = actual.find(row => row.id === old.id);
        for (const [key, value] of Object.entries(old)) assert.deepEqual(next[key], value, `users.${key} changed during migration`);
        assert.equal(next.must_change_password, 0);
        assert.equal(next.account_revision, 1);
        assert.equal(next.temporary_password_expires_at, null);
      }
    } else assert.deepEqual(afterMigration[table], rows, `${table} changed during migration`);
  }
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('owner account lists and detail expose safe fields, management permissions and only the same school', async t => {
  const f = fixture(t);
  const r = await request(f, '/api/users');
  assert.equal(r.status, 200);
  assert.ok(r.data.length > 0);
  for (const row of r.data) {
    assert.equal(row.school_id, 1);
    assert.equal(row.account_revision, 1);
    assert.equal(typeof row.can_manage, 'boolean');
    assert.ok(Object.hasOwn(row, 'phone'));
    assert.equal(row.can_manage, !['system_admin', 'school_owner'].includes(row.role_key));
  }
  assertNoSecrets(r.data, passwordHash, password);
  const detail = await request(f, '/api/users/3');
  assert.equal(detail.status, 200);
  assert.equal(detail.data.can_manage, true);
  assertNoSecrets(detail.data, passwordHash);
  await deniedWithoutChanges(f, '/api/users?school_id=2', {}, [403]);
  await deniedWithoutChanges(f, '/api/users/9', {}, [403, 404]);
});

for (const role of ['principal', 'vice_principal', 'teacher', 'accountant', 'registrar', 'parent']) {
  test(`owner creates ${role} with a generated temporary password and a 24-hour expiry`, async t => {
    const f = fixture(t), now = Math.floor(Date.now() / 1000);
    const result = await create(f, { role_key: role });
    assert.equal(result.school_id, 1);
    assert.equal(result.must_change_password, true);
    assert.equal(result.account_revision, 1);
    assert.equal(typeof result.temporary_password, 'string');
    assert.ok(result.temporary_password.length >= 16);
    assert.ok(result.temporary_password_expires_at >= now + 86400 && result.temporary_password_expires_at <= Math.floor(Date.now() / 1000) + 86400);
    const row = current(f, result.id);
    assert.equal(row.must_change_password, 1);
    assert.equal(row.temporary_password_expires_at, result.temporary_password_expires_at);
    assert.equal((await verifyPassword(result.temporary_password, row.password_hash)).valid, true);
    assert.equal(auditRows(f).length, 1);
    assertNoSecrets(auditRows(f), result.temporary_password, row.password_hash);
    assert.equal(guardCount(f), 0);
  });
}

test('teacher creation binds the existing same-school employee atomically without changing timetable data', async t => {
  const f = fixture(t), before = snapshot(f.db);
  const result = await create(f, { employee_id: 1 });
  const link = f.db.prepare('SELECT * FROM teacher_employee_links WHERE teacher_user_id=?').get(result.id);
  assert.equal(link.school_id, 1);
  assert.equal(link.employee_id, 1);
  assert.equal(link.status, 'active');
  const after = snapshot(f.db);
  for (const table of Object.keys(before).filter(name => name.startsWith('timetable_') || name === 'employees')) assert.deepEqual(after[table], before[table]);
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('system administrator can create an account for an explicitly selected active school', async t => {
  const f = fixture(t);
  const result = await create(f, { school_id: 2, role_key: 'registrar' }, { user: 2 });
  assert.equal(result.school_id, 2);
  assert.equal(current(f, result.id).school_id, 2);
  await deniedWithoutChanges(f, `/api/users/${result.id}`, {}, [403, 404]);
});

test('separate account creations receive independently generated temporary credentials', async t => {
  const f = fixture(t);
  const first = await create(f), second = await create(f, { email: 'second@accounts.test' });
  assert.notEqual(first.temporary_password, second.temporary_password);
  assert.notEqual(current(f, first.id).password_hash, current(f, second.id).password_hash);
  assert.equal((await verifyPassword(first.temporary_password, current(f, second.id).password_hash)).valid, false);
});

test('creation rejects foreign, archived, nonteacher and already linked employees without leaving accounts or audit rows', async t => {
  const f = fixture(t);
  f.db.exec("INSERT INTO teacher_employee_links(school_id,teacher_user_id,employee_id,created_by_user_id) VALUES(1,3,2,1)");
  for (const employee_id of [5, 4, 3, 9999, 2, -1, 1.5]) await deniedWithoutChanges(f, '/api/users', { method: 'POST', body: draft({ employee_id }) }, [400, 403, 409]);
  await deniedWithoutChanges(f, '/api/users', { method: 'POST', body: draft({ role_key: 'accountant', employee_id: 1 }) }, [400]);
});

test('owner cannot select a foreign school, protected role, mismatched role identifiers or supplied password', async t => {
  const f = fixture(t);
  for (const patch of [
    { school_id: 2 }, { school_id: null }, { role_key: 'system_admin' }, { role_key: 'school_owner' },
    { role_key: 'teacher', role_id: 1 }, { role_key: 'invented-role' }, { password: 'client-chosen-password' },
  ]) await deniedWithoutChanges(f, '/api/users', { method: 'POST', body: draft(patch) }, [400, 403]);
});

test('normalization rejects duplicate email identities and account writes reject malformed JSON without side effects', async t => {
  const f = fixture(t);
  await deniedWithoutChanges(f, '/api/users', { method: 'POST', body: draft({ email: ' TEACHER@MATRIX.TEST ' }) }, [409]);
  for (const body of [null, [], {}, draft({ email: 'invalid-email' }), draft({ full_name: '' })]) {
    await deniedWithoutChanges(f, '/api/users', { method: 'POST', body }, [400]);
  }
  await deniedWithoutChanges(f, '/api/users', { method: 'POST', rawBody: '{bad json' }, [400]);
});

test('unprivileged and unauthenticated callers cannot manage accounts', async t => {
  const f = fixture(t);
  for (const user of [3, 4, 5, 6, 7, 8]) {
    await deniedWithoutChanges(f, '/api/users', { method: 'POST', user, body: draft() }, [403]);
    await deniedWithoutChanges(f, '/api/users/3', { method: 'PUT', user, body: editBody(f) }, [403]);
    await deniedWithoutChanges(f, '/api/users/3/status', { method: 'PUT', user, body: { expected_revision: 1, status: 'inactive' } }, [403]);
    await deniedWithoutChanges(f, '/api/users/3/reset-password', { method: 'PUT', user, body: { expected_revision: 1 } }, [403]);
  }
  await deniedWithoutChanges(f, '/api/users', { method: 'POST', anonymous: true, body: draft() }, [401]);
});

test('every owner mutation rejects self, another owner, a school-scoped system administrator and foreign accounts', async t => {
  const f = fixture(t);
  for (const id of [1, 2, 9, 10, 11]) {
    for (const [suffix, body] of [
      ['', editBody(f, id)], ['/status', { expected_revision: version(f, id), status: 'inactive' }],
      ['/reset-password', { expected_revision: version(f, id) }],
    ]) await deniedWithoutChanges(f, `/api/users/${id}${suffix}`, { method: 'PUT', body }, [403, 404]);
  }
});

test('system administrator cannot manage its own account through administrative write endpoints', async t => {
  const f = fixture(t);
  for (const [suffix, body] of [
    ['', editBody(f, 2)], ['/status', { expected_revision: 1, status: 'inactive' }], ['/reset-password', { expected_revision: 1 }],
  ]) await deniedWithoutChanges(f, `/api/users/2${suffix}`, { method: 'PUT', user: 2, body }, [403]);
});

test('existing accounts cannot be moved to another school even by the system administrator', async t => {
  const f = fixture(t);
  for (const user of [1, 2]) await deniedWithoutChanges(f, '/api/users/3', { method: 'PUT', user, body: editBody(f, 3, { school_id: 2 }) }, [400, 403]);
});

test('owner edits same-school account and stale revisions cannot overwrite the newer result', async t => {
  const f = fixture(t);
  const r = await request(f, '/api/users/3', { method: 'PUT', body: editBody(f, 3, { phone: '07111111111' }) });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(current(f).full_name, 'Edited account');
  assert.equal(current(f).phone, '07111111111');
  assert.equal(version(f), 2);
  assert.equal(auditRows(f).length, 1);
  for (const [suffix, body] of [
    ['', { expected_revision: 1, full_name: 'Stale name' }], ['/status', { expected_revision: 1, status: 'inactive' }],
    ['/reset-password', { expected_revision: 1 }],
  ]) await deniedWithoutChanges(f, `/api/users/3${suffix}`, { method: 'PUT', body }, [409]);
});

test('revision is mandatory on edits, status and reset and internal authentication fields cannot be mass assigned', async t => {
  const f = fixture(t);
  for (const expected_revision of [undefined, null, 0, -1, 1.5, '1']) {
    for (const [suffix, body] of [['', { full_name: 'Edit' }], ['/status', { status: 'inactive' }], ['/reset-password', {}]]) {
      await deniedWithoutChanges(f, `/api/users/3${suffix}`, { method: 'PUT', body: { ...body, ...(expected_revision === undefined ? {} : { expected_revision }) } }, [400]);
    }
  }
  for (const patch of [{ auth_version: 99 }, { account_revision: 99 }, { password_hash: passwordHash }, { must_change_password: false }, { temporary_password_expires_at: null }]) {
    await deniedWithoutChanges(f, '/api/users/3', { method: 'PUT', body: editBody(f, 3, patch) }, [400]);
  }
});

test('status mutation rejects non-string values instead of coercing arrays or objects', async t => {
  const f = fixture(t);
  for (const status of [['active'], ['inactive'], { status: 'active' }, true, 1, null, 'archived']) {
    await deniedWithoutChanges(f, '/api/users/3/status', { method: 'PUT', body: { expected_revision: 1, status } }, [400]);
  }
});

test('changing role or email revokes all previously issued sessions', async t => {
  const f = fixture(t), oldToken = await token(f, 3);
  let r = await request(f, '/api/users/3', { method: 'PUT', body: editBody(f, 3, { role_key: 'registrar' }) });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal((await request(f, '/api/auth/me', { bearer: oldToken })).status, 401);
  const laterToken = await token(f, 3);
  r = await request(f, '/api/users/3', { method: 'PUT', body: editBody(f, 3, { email: 'renamed@accounts.test' }) });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal((await request(f, '/api/auth/me', { bearer: laterToken })).status, 401);
});

test('disable and re-enable never revive old sessions or employee access links', async t => {
  const f = fixture(t), oldToken = await token(f, 3);
  f.db.exec("INSERT INTO teacher_employee_links(school_id,teacher_user_id,employee_id,created_by_user_id) VALUES(1,3,1,1)");
  for (const status of ['inactive', 'active']) {
    const r = await request(f, '/api/users/3/status', { method: 'PUT', body: { expected_revision: version(f), status } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal((await request(f, '/api/auth/me', { bearer: oldToken })).status, 401);
    assert.equal(f.db.prepare('SELECT status FROM teacher_employee_links WHERE teacher_user_id=3').get().status, 'inactive');
  }
});

for (const [userId, originalRole, linkTable, linkColumn, insert] of [
  [3, 'teacher', 'teacher_employee_links', 'teacher_user_id', 'INSERT INTO teacher_employee_links(school_id,teacher_user_id,employee_id,created_by_user_id) VALUES(1,3,1,1)'],
  [8, 'parent', 'parent_student_links', 'parent_user_id', 'INSERT INTO parent_student_links(school_id,parent_user_id,student_id,created_by_user_id) VALUES(1,8,1,1)'],
]) test(`changing ${originalRole} role deactivates its links and changing back does not revive them`, async t => {
  const f = fixture(t); f.db.exec(insert);
  for (const role_key of ['registrar', originalRole]) {
    const r = await request(f, `/api/users/${userId}`, { method: 'PUT', body: editBody(f, userId, { role_key }) });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(f.db.prepare(`SELECT status FROM ${linkTable} WHERE ${linkColumn}=?`).get(userId).status, 'inactive');
  }
});

test('temporary sessions can use only me, logout and password-change, including direct bearer API requests', async t => {
  const f = fixture(t), created = await create(f);
  const session = await login(f, created.email, created.temporary_password);
  assert.equal(session.status, 200, JSON.stringify(session.json));
  assert.equal(session.data.user.must_change_password, true);
  assert.ok(session.bearer);
  const me = await request(f, '/api/auth/me', { bearer: session.bearer });
  assert.equal(me.status, 200); assert.equal(me.data.must_change_password, true);
  for (const [path, method, body] of [
    ['/api/students', 'GET'], ['/api/roles', 'GET'], ['/api/users', 'GET'], ['/api/employees', 'GET'],
    ['/api/users', 'POST', draft({ email: 'bypass@accounts.test' })], ['/api/auth/change-password', 'GET'],
    ['/api/auth/me', 'POST', {}],
  ]) {
    const r = await deniedWithoutChanges(f, path, { method, body, bearer: session.bearer }, [403]);
    assert.equal(r.json.code, 'password_change_required');
  }
  assert.equal((await request(f, '/api/auth/logout', { method: 'POST', bearer: session.bearer })).status, 200);
  assert.equal((await request(f, '/api/auth/me', { bearer: session.bearer })).status, 401);
});

test('temporary credentials and sessions are incompatible with the old application authentication formats', async t => {
  const f = fixture(t), created = await create(f), row = current(f, created.id);
  // Previous application versions accepted only a raw 64-hex legacy digest or the
  // four-part pbkdf2_sha256 format. A temporary credential must match neither.
  assert.doesNotMatch(row.password_hash, /^[a-f0-9]{64}$/i);
  assert.notEqual(row.password_hash.split('$')[0], 'pbkdf2_sha256');
  assert.equal((await verifyPassword(created.temporary_password, row.password_hash)).valid, true);
  for (const cookie of [false, true]) {
    const session = await login(f, created.email, created.temporary_password, { cookie });
    assert.equal(session.status, 200, JSON.stringify(session.json));
    const signedToken = cookie ? session.cookie.split('=')[1] : session.bearer;
    assert.equal(await verifyJWT(signedToken, secret), null, 'old application signing key must reject a restricted session');
  }
});

test('a restricted token never becomes a full session when the force-change flag is cleared without rotating the account version', async t => {
  const f = fixture(t), created = await create(f), session = await login(f, created.email, created.temporary_password);
  const originalAuthVersion = current(f, created.id).auth_version;
  f.db.prepare('UPDATE users SET must_change_password=0,temporary_password_expires_at=NULL WHERE id=?').run(created.id);
  assert.equal(current(f, created.id).auth_version, originalAuthVersion);
  for (const path of ['/api/auth/me', '/api/students']) {
    await deniedWithoutChanges(f, path, { bearer: session.bearer }, [401]);
  }
});

test('cookie temporary sessions preserve CSRF and same-origin protections on password changes', async t => {
  const f = fixture(t), created = await create(f);
  const session = await login(f, created.email, created.temporary_password, { cookie: true });
  assert.equal(session.status, 200);
  assert.ok(session.cookie); assert.ok(session.csrf); assert.equal(session.bearer, undefined);
  const body = { current_password: created.temporary_password, new_password: newPassword };
  const safeHeaders = { Cookie: session.cookie, Origin: origin, 'Sec-Fetch-Site': 'same-origin' };
  for (const headers of [safeHeaders, { ...safeHeaders, 'X-CSRF-Token': 'forged' }, { ...safeHeaders, Origin: 'https://foreign.test', 'X-CSRF-Token': session.csrf }]) {
    await deniedWithoutChanges(f, '/api/auth/change-password', { method: 'POST', anonymous: true, body, headers }, [403]);
  }
  const blocked = await request(f, '/api/students', { anonymous: true, headers: safeHeaders });
  assert.equal(blocked.status, 403); assert.equal(blocked.json.code, 'password_change_required');
  const result = await request(f, '/api/auth/change-password', { method: 'POST', anonymous: true, body, headers: { ...safeHeaders, 'X-CSRF-Token': session.csrf } });
  assert.equal(result.status, 200, JSON.stringify(result.json));
  assert.match(result.res.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await request(f, '/api/auth/me', { anonymous: true, headers: safeHeaders })).status, 401);
});

test('changing a temporary password clears the restriction, invalidates every existing session and requires fresh login', async t => {
  const f = fixture(t), created = await create(f);
  const first = await login(f, created.email, created.temporary_password);
  const second = await login(f, created.email, created.temporary_password);
  const beforeVersion = current(f, created.id).auth_version;
  const r = await request(f, '/api/auth/change-password', { method: 'POST', bearer: first.bearer, body: { current_password: created.temporary_password, new_password: newPassword } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const row = current(f, created.id);
  assert.equal(row.must_change_password, 0);
  assert.equal(row.temporary_password_expires_at, null);
  assert.ok(row.auth_version > beforeVersion);
  assert.equal((await verifyPassword(newPassword, row.password_hash)).valid, true);
  for (const bearer of [first.bearer, second.bearer]) assert.equal((await request(f, '/api/auth/me', { bearer })).status, 401);
  assert.equal((await login(f, created.email, created.temporary_password)).status, 401);
  const fresh = await login(f, created.email, newPassword);
  assert.equal(fresh.status, 200); assert.equal(fresh.data.user.must_change_password, false);
  assert.equal((await request(f, '/api/auth/me', { bearer: fresh.bearer })).status, 200);
  assertNoSecrets(auditRows(f), created.temporary_password, newPassword, row.password_hash);
});

test('password-change validation rejects wrong current, identical, short, long and malformed new passwords without changing account security state', async t => {
  const f = fixture(t), created = await create(f);
  const s = await login(f, created.email, created.temporary_password);
  for (const body of [
    { current_password: 'wrong-current-password', new_password: newPassword },
    { current_password: created.temporary_password, new_password: created.temporary_password },
    { current_password: created.temporary_password, new_password: 'a'.repeat(11) },
    { current_password: created.temporary_password, new_password: 'a'.repeat(129) },
    { current_password: created.temporary_password, new_password: null }, {}, null,
  ]) {
    const before = { user: current(f, created.id), audit: auditRows(f) };
    const r = await request(f, '/api/auth/change-password', { method: 'POST', bearer: s.bearer, body });
    assert.ok([400, 401, 403, 429].includes(r.status), JSON.stringify(r.json));
    assert.deepEqual({ user: current(f, created.id), audit: auditRows(f) }, before);
    assert.equal(guardCount(f), 0);
  }
});

test('repeated incorrect current passwords are throttled without invalidating the authenticated account', async t => {
  const f = fixture(t), bearer = await token(f, 3), before = current(f);
  let limited = false;
  for (let attempt = 0; attempt < 6; attempt++) {
    const r = await request(f, '/api/auth/change-password', { method: 'POST', bearer, body: { current_password: 'wrong-password', new_password: newPassword } });
    assert.ok([400, 401, 429].includes(r.status), JSON.stringify(r.json));
    if (r.status === 429) {
      limited = true;
      assert.ok(Number(r.res.headers.get('retry-after')) > 0);
      break;
    }
  }
  assert.equal(limited, true, 'password-change attempts should be limited by the fifth failure');
  assert.deepEqual(current(f), before);
  assert.equal(auditRows(f).length, 0);
  assert.equal((await request(f, '/api/auth/me', { bearer })).status, 200);
});

test('reset rotates the temporary secret and expiry and revokes both cookie and bearer sessions', async t => {
  const f = fixture(t), created = await create(f);
  const bearerSession = await login(f, created.email, created.temporary_password);
  const cookieSession = await login(f, created.email, created.temporary_password, { cookie: true });
  const r = await request(f, `/api/users/${created.id}/reset-password`, { method: 'PUT', body: { expected_revision: version(f, created.id) } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.data.must_change_password, true);
  assert.notEqual(r.data.temporary_password, created.temporary_password);
  assert.equal(current(f, created.id).account_revision, 2);
  assert.equal((await request(f, '/api/auth/me', { bearer: bearerSession.bearer })).status, 401);
  assert.equal((await request(f, '/api/auth/me', { anonymous: true, headers: { Cookie: cookieSession.cookie } })).status, 401);
  assert.equal((await login(f, created.email, created.temporary_password)).status, 401);
  assert.equal((await login(f, created.email, r.data.temporary_password)).status, 200);
  assertNoSecrets(auditRows(f), created.temporary_password, r.data.temporary_password);
});

test('expired temporary passwords cannot obtain or continue a usable session', async t => {
  const f = fixture(t), created = await create(f);
  const s = await login(f, created.email, created.temporary_password);
  f.db.prepare('UPDATE users SET temporary_password_expires_at=? WHERE id=?').run(Math.floor(Date.now() / 1000) - 1, created.id);
  const expiredLogin = await login(f, created.email, created.temporary_password);
  assert.ok([401, 403].includes(expiredLogin.status), JSON.stringify(expiredLogin.json));
  const result = await request(f, '/api/auth/change-password', { method: 'POST', bearer: s.bearer, body: { current_password: created.temporary_password, new_password: newPassword } });
  assert.ok([401, 403].includes(result.status), JSON.stringify(result.json));
  assert.equal(current(f, created.id).must_change_password, 1);
});

test('audit history is same-school scoped, contains no credentials and cannot be changed or deleted', async t => {
  const f = fixture(t), created = await create(f);
  const r = await request(f, `/api/users/${created.id}/audit`);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.data.length, 1);
  assertNoSecrets(r.data, created.temporary_password, current(f, created.id).password_hash);
  await deniedWithoutChanges(f, '/api/users/9/audit', {}, [403, 404]);
  for (const user of [3, 4, 5, 6, 7, 8]) await deniedWithoutChanges(f, `/api/users/${created.id}/audit`, { user }, [403]);
  const before = snapshot(f.db);
  assert.throws(() => f.db.exec('UPDATE user_account_audit SET id=id+1000'));
  assert.throws(() => f.db.exec('DELETE FROM user_account_audit'));
  assert.deepEqual(snapshot(f.db), before);
});

test('revoking an invalidated access link is allowed but cannot also change its tenant or resource identity', t => {
  const f = fixture(t);
  f.db.exec('INSERT INTO teacher_employee_links(school_id,teacher_user_id,employee_id,created_by_user_id) VALUES(1,3,1,1)');
  f.db.exec('INSERT INTO parent_student_links(school_id,parent_user_id,student_id,created_by_user_id) VALUES(1,8,1,1)');
  f.db.exec("UPDATE users SET status='inactive' WHERE id IN(3,8)");
  for (const sql of [
    "UPDATE teacher_employee_links SET status='inactive',school_id=2",
    "UPDATE teacher_employee_links SET status='inactive',teacher_user_id=9",
    "UPDATE teacher_employee_links SET status='inactive',employee_id=2",
    "UPDATE parent_student_links SET status='inactive',school_id=2",
    "UPDATE parent_student_links SET status='inactive',parent_user_id=9",
    "UPDATE parent_student_links SET status='inactive',student_id=2",
  ]) {
    const before = snapshot(f.db);
    assert.throws(() => f.db.exec(sql));
    assert.deepEqual(snapshot(f.db), before);
  }
  f.db.exec("UPDATE teacher_employee_links SET status='inactive'; UPDATE parent_student_links SET status='inactive'");
  assert.equal(f.db.prepare('SELECT status FROM teacher_employee_links').get().status, 'inactive');
  assert.equal(f.db.prepare('SELECT status FROM parent_student_links').get().status, 'inactive');
  assert.throws(() => f.db.exec("UPDATE teacher_employee_links SET status='active'"));
  assert.throws(() => f.db.exec("UPDATE parent_student_links SET status='active'"));
});

for (const [name, change] of [
  ['actor lost owner role', "UPDATE users SET role_id=5 WHERE id=1"],
  ['actor was disabled', "UPDATE users SET status='inactive' WHERE id=1"],
  ['actor moved school', 'UPDATE users SET school_id=2 WHERE id=1'],
  ['actor authentication was revoked', 'UPDATE users SET auth_version=auth_version+1 WHERE id=1'],
  ['actor now needs password change', 'UPDATE users SET must_change_password=1 WHERE id=1'],
  ['target became protected', 'UPDATE users SET role_id=2 WHERE id=3'],
  ['target moved school', 'UPDATE users SET school_id=2 WHERE id=3'],
  ['target revision changed', 'UPDATE users SET account_revision=account_revision+1 WHERE id=3'],
]) test(`an atomic guard refuses the mutation when ${name} after preflight`, async t => {
  const f = fixture(t); let concurrentSnapshot;
  f.d1.beforeWrite = () => { f.db.exec(change); concurrentSnapshot = snapshot(f.db); };
  const r = await request(f, '/api/users/3', { method: 'PUT', body: editBody(f) });
  assert.ok([401, 403, 409].includes(r.status), JSON.stringify(r.json));
  assert.ok(concurrentSnapshot, 'race hook must run at the actual write boundary');
  assert.deepEqual(snapshot(f.db), concurrentSnapshot);
});

test('employee invalidation between preflight and account creation rolls back account and audit', async t => {
  const f = fixture(t); let concurrentSnapshot;
  f.d1.beforeWrite = () => { f.db.exec("UPDATE employees SET status='archived' WHERE id=1"); concurrentSnapshot = snapshot(f.db); };
  const r = await request(f, '/api/users', { method: 'POST', body: draft({ employee_id: 1 }) });
  assert.ok([400, 403, 409].includes(r.status), JSON.stringify(r.json));
  assert.deepEqual(snapshot(f.db), concurrentSnapshot);
});

test('password reset during password-change verification prevents the stale password change from winning', async t => {
  const f = fixture(t), bearer = await token(f, 3); let concurrentSnapshot;
  f.d1.beforeWrite = () => {
    f.db.exec('UPDATE users SET auth_version=auth_version+1,account_revision=account_revision+1,must_change_password=1 WHERE id=3');
    concurrentSnapshot = snapshot(f.db);
  };
  const r = await request(f, '/api/auth/change-password', { method: 'POST', bearer, body: { current_password: password, new_password: newPassword } });
  assert.ok([401, 403, 409].includes(r.status), JSON.stringify(r.json));
  assert.ok(concurrentSnapshot);
  assert.deepEqual(snapshot(f.db), concurrentSnapshot);
});

test('owner revocation at the create commit boundary leaves no new account or audit', async t => {
  const f = fixture(t); let concurrentSnapshot;
  f.d1.beforeWrite = () => {
    f.db.exec('UPDATE users SET auth_version=auth_version+1 WHERE id=1');
    concurrentSnapshot = snapshot(f.db);
  };
  const r = await request(f, '/api/users', { method: 'POST', body: draft() });
  assert.ok([401, 403, 409].includes(r.status), JSON.stringify(r.json));
  assert.ok(concurrentSnapshot);
  assert.deepEqual(snapshot(f.db), concurrentSnapshot);
});

test('logout after middleware authentication prevents the in-flight account mutation from committing', async t => {
  const f = fixture(t), bearer = await token(f), session = decodeJwtPayloadUnsafe(bearer);
  let concurrentSnapshot;
  f.d1.beforeWrite = () => {
    f.db.prepare('INSERT INTO revoked_sessions(jti,user_id,expires_at) VALUES(?,?,?)').run(session.jti, 1, session.exp);
    concurrentSnapshot = snapshot(f.db);
  };
  const r = await request(f, '/api/users/3', { method: 'PUT', bearer, body: editBody(f) });
  assert.ok([401, 403, 409].includes(r.status), JSON.stringify(r.json));
  assert.ok(concurrentSnapshot);
  assert.deepEqual(snapshot(f.db), concurrentSnapshot);
});

test('a session expiring between preflight and commit cannot authorize an account mutation', async t => {
  const f = fixture(t), bearer = await token(f), session = decodeJwtPayloadUnsafe(bearer);
  const before = snapshot(f.db);
  let hookRan = false;
  f.d1.beforeWrite = () => {
    hookRan = true;
    // Simulate the database reaching the expiry boundary without a flaky wall-clock sleep.
    f.db.function('unixepoch', () => session.exp + 1);
  };
  const r = await request(f, '/api/users/3', { method: 'PUT', bearer, body: editBody(f) });
  assert.ok([401, 403, 409].includes(r.status), JSON.stringify(r.json));
  assert.equal(hookRan, true);
  assert.deepEqual(snapshot(f.db), before);
});

for (const operation of ['create', 'edit', 'status', 'reset', 'change-password']) {
  test(`${operation} rolls back every account, link, audit and guard write at every batch stage`, async t => {
    async function setup() {
      const f = fixture(t);
      if (operation !== 'create') f.db.exec('INSERT INTO teacher_employee_links(school_id,teacher_user_id,employee_id,created_by_user_id) VALUES(1,3,1,1)');
      const options = operation === 'create' ? { path: '/api/users', method: 'POST', body: draft({ employee_id: 1 }) }
        : operation === 'edit' ? { path: '/api/users/3', method: 'PUT', body: editBody(f, 3, { role_key: 'registrar' }) }
        : operation === 'status' ? { path: '/api/users/3/status', method: 'PUT', body: { expected_revision: 1, status: 'inactive' } }
        : operation === 'reset' ? { path: '/api/users/3/reset-password', method: 'PUT', body: { expected_revision: 1 } }
        : { path: '/api/auth/change-password', method: 'POST', user: 3, body: { current_password: password, new_password: newPassword } };
      return { f, options };
    }
    const successful = await setup();
    const baseline = await request(successful.f, successful.options.path, successful.options);
    assert.ok([200, 201].includes(baseline.status), JSON.stringify(baseline.json));
    const stages = successful.f.d1.batchSizes.at(-1);
    assert.ok(stages >= 4, `expected guarded atomic batch, got ${stages}`);
    for (let stage = 0; stage < stages; stage++) {
      const { f, options } = await setup(), before = snapshot(f.db);
      f.d1.failAt = stage;
      const r = await request(f, options.path, options);
      assert.ok(r.status >= 400, `injected failure at stage ${stage} unexpectedly succeeded`);
      assert.deepEqual(snapshot(f.db), before, `partial state remains after failure at stage ${stage}`);
    }
  });
}
