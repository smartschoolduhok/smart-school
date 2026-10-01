// Exercise only disposable local workerd D1. No configured or remote database is used.
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createServer } from 'vite';
import { getPlatformProxy, unstable_splitSqlQuery } from 'wrangler';
import { fixtureSQL, migrationFiles, root } from '../test/helpers/teaching-load-matrix-fixture.mjs';
import { hashPassword, verifyPassword } from '../src/lib/authSecurity.ts';
import { signJWT, verifyJWT } from '../src/lib/jwtSecurity.ts';
import { contentSnapshot, digest, sqlStatements, sqlTokens } from './lib/local-d1-restore.mjs';

const directory = mkdtempSync(join(tmpdir(), 'smart-school-user-accounts-local-'));
const configPath = join(directory, 'wrangler.json');
const state = join(directory, 'state');
const databaseName = 'user-accounts-local-only';
const accountMigration = '0052_school_user_accounts.sql';
const oldMigrations = migrationFiles.filter(name => name.slice(0, 4) <= '0051');
assert.ok(migrationFiles.includes(accountMigration), 'account migration must exist');
mkdirSync(join(directory, 'migrations'));
writeFileSync(configPath, JSON.stringify({
  name: databaseName,
  compatibility_date: '2026-04-13',
  d1_databases: [{ binding: 'DB', database_name: databaseName, database_id: '00000000-0000-0000-0000-000000000052', migrations_dir: 'migrations' }],
}));

function migrate() {
  const args = [join(root, 'node_modules/wrangler/bin/wrangler.js'), 'd1', 'migrations', 'apply', databaseName, '--local', '--config', configPath, '--persist-to', state];
  assert.equal(args.includes('--remote'), false);
  const env = { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' };
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete env[key];
  const result = spawnSync(process.execPath, args, { cwd: directory, env, encoding: 'utf8', timeout: 180000, maxBuffer: 20000000 });
  assert.equal(result.status, 0, (result.stdout + result.stderr).slice(-12000));
}
const open = () => getPlatformProxy({ configPath, persist: { path: join(state, 'v3') }, remoteBindings: false, envFiles: [] });
const snapshot = db => contentSnapshot(async sql => (await db.prepare(sql).all()).results);
const cases = [];
console.log('LOCAL user-account artifacts: ' + directory);

for (const file of oldMigrations) copyFileSync(join(root, 'migrations', file), join(directory, 'migrations', file));
migrate();
let proxy = await open();
let before;
try {
  const seed = fixtureSQL + `
    INSERT INTO users(id,school_id,full_name,email,role_id,status,auth_version) VALUES
      (9,2,'LOCAL foreign teacher','foreign@accounts-local.test',5,'active',1),
      (10,1,'LOCAL other owner','other-owner@accounts-local.test',2,'active',1);
    INSERT INTO teacher_employee_links(school_id,teacher_user_id,employee_id,status,created_by_user_id)
      VALUES(1,3,2,'active',1);
  `;
  await proxy.env.DB.batch(unstable_splitSqlQuery(seed).map(sql => proxy.env.DB.prepare(sql)));
  await proxy.env.DB.prepare('UPDATE users SET password_hash=?').bind(await hashPassword('LOCAL existing password 2026')).run();
  before = await snapshot(proxy.env.DB);
} finally {
  await proxy.dispose();
}

copyFileSync(join(root, 'migrations', accountMigration), join(directory, 'migrations', accountMigration));
migrate();
proxy = await open();
const vite = await createServer({ root, appType: 'custom', server: { middlewareMode: true, hmr: false } });
try {
  const db = proxy.env.DB, after = await snapshot(db);
  const migration = readFileSync(join(root, 'migrations', accountMigration), 'utf8');
  const addedColumns = [
    'must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1))',
    'temporary_password_expires_at INTEGER',
    'account_revision INTEGER NOT NULL DEFAULT 1 CHECK (account_revision > 0)',
  ];
  const replacedTriggers = new Set(['trg_teacher_employee_links_validate_update', 'trg_parent_student_links_validate_update']);
  for (const old of before.schema) {
    const actual = after.schema.find(item => item.type === old.type && item.name === old.name);
    if (old.type === 'table' && old.name === 'users') {
      for (const declaration of addedColumns) assert.ok(migration.includes(`ALTER TABLE users ADD COLUMN ${declaration};`));
      const expected = [...old.sql.slice(0, -1), ...addedColumns.flatMap(column => [['symbol', ','], ...sqlTokens(column).map(token => [token.kind, token.text])]), old.sql.at(-1)];
      assert.deepEqual(actual, { ...old, sql: expected }, 'only the declared lifecycle columns may alter the users schema');
    } else if (old.type === 'trigger' && replacedTriggers.has(old.name)) {
      const declaration = sqlStatements(migration).find(statement => statement.tokens[0]?.text === 'CREATE' && statement.tokens[1]?.text === 'TRIGGER' && statement.tokens.some(token => token.text === old.name));
      assert.ok(declaration, 'replacement trigger must appear in the migration');
      const expected = sqlTokens(migration.slice(declaration.start, declaration.end).trim().replace(/;$/, '')).map(token => [token.kind, token.text]);
      assert.deepEqual(actual, { ...old, sql: expected }, old.name);
    } else assert.deepEqual(actual, old, old.name);
  }
  for (const [name, old] of Object.entries(before.tables)) {
    if (['d1_migrations', 'sqlite_sequence'].includes(name)) continue;
    const actual = after.tables[name];
    if (name === 'users') {
      assert.deepEqual(actual.columns.slice(-3), [
        { cid: old.columns.length, name: 'must_change_password', type: 'INTEGER', notnull: 1, dflt_value: '0', pk: 0, hidden: 0 },
        { cid: old.columns.length + 1, name: 'temporary_password_expires_at', type: 'INTEGER', notnull: 0, dflt_value: null, pk: 0, hidden: 0 },
        { cid: old.columns.length + 2, name: 'account_revision', type: 'INTEGER', notnull: 1, dflt_value: '1', pk: 0, hidden: 0 },
      ]);
      const content = actual.content.map(encoded => {
        const row = JSON.parse(encoded);
        assert.deepEqual(row.splice(-3), [['integer', '0'], ['null', null], ['integer', '1']]);
        return JSON.stringify(row);
      }).sort();
      assert.deepEqual({ ...actual, columns: actual.columns.slice(0, -3), content, hash: digest(content) }, old, 'all previous user values and SQLite storage types must survive');
    } else assert.deepEqual(actual, old, name);
  }
  assert.equal(after.tables.d1_migrations.count, oldMigrations.length + 1);
  assert.equal(after.tables.user_account_audit.count, 0);
  assert.equal(after.tables.user_account_write_guards.count, 0);
  assert.deepEqual(after.foreignKeys, []);
  cases.push('0051 to 0052 preserves every historical column value/type and changes only declared prior schema objects');

  const { default: app } = await vite.ssrLoadModule('/src/worker.ts');
  const secret = 'generated-local-workerd-user-accounts-secret-2026';
  const owner = await signJWT({ id: 1, email: 'owner@matrix.test', auth_version: 1, session_transport: 'bearer' }, secret);
  const teacher = await signJWT({ id: 3, email: 'teacher@matrix.test', auth_version: 1, session_transport: 'bearer' }, secret);
  const origin = 'https://accounts.local.test';
  const apiEvidence = [];
  async function call(label, method, path, input, status, { bearer = owner, cookie, csrf, anonymous = false, database = db } = {}) {
    const headers = { 'Content-Type': 'application/json', ...(anonymous ? {} : cookie ? { Cookie: cookie } : { Authorization: `Bearer ${bearer}` }) };
    if (cookie) Object.assign(headers, { Origin: origin, 'Sec-Fetch-Site': 'same-origin', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) });
    const response = await app.request(origin + path, { method, headers, ...(input === undefined ? {} : { body: JSON.stringify(input) }) }, { DB: database, JWT_SECRET: secret, APP_ENV: 'staging' });
    const body = await response.json();
    assert.equal(response.status, status, JSON.stringify({ label, status: response.status, error: body.error, code: body.code }));
    apiEvidence.push({ case: label, status: response.status });
    return { data: body.data, body, response };
  }
  const row = id => db.prepare('SELECT * FROM users WHERE id=?').bind(id).first();
  const lifecycleSnapshot = async () => {
    const tables = ['users', 'teacher_employee_links', 'parent_student_links', 'user_account_audit', 'user_account_write_guards'];
    return Object.fromEntries(await Promise.all(tables.map(async name => [name, (await db.prepare(`SELECT * FROM ${name} ORDER BY 1`).all()).results])));
  };
  const createBody = { full_name: 'LOCAL generated teacher', email: 'generated@accounts-local.test', role_key: 'teacher', employee_id: 1 };
  const created = (await call('owner creates linked teacher', 'POST', '/api/users', createBody, 201)).data;
  assert.equal(created.school_id, 1);
  assert.equal(created.account_revision, 1);
  assert.equal(created.must_change_password, true);
  assert.ok(created.temporary_password_expires_at >= Math.floor(Date.now() / 1000) + 86390);
  const stored = await row(created.id);
  assert.equal((await verifyPassword(created.temporary_password, stored.password_hash)).valid, true);
  assert.notEqual(stored.password_hash.split('$')[0], 'pbkdf2_sha256', 'old deployments must not accept temporary hashes');
  assert.equal((await db.prepare('SELECT employee_id FROM teacher_employee_links WHERE teacher_user_id=?').bind(created.id).first()).employee_id, 1);
  const beforeDenied = await lifecycleSnapshot();
  await call('owner cannot create protected role', 'POST', '/api/users', { ...createBody, email: 'protected@accounts-local.test', role_key: 'system_admin' }, 403);
  await call('owner cannot create in another school', 'POST', '/api/users', { ...createBody, email: 'foreign-create@accounts-local.test', school_id: 2 }, 403);
  await call('owner cannot read foreign account', 'GET', '/api/users/9', undefined, 403);
  await call('owner cannot reset another owner', 'PUT', '/api/users/10/reset-password', { expected_revision: 1 }, 403);
  await call('teacher cannot create accounts', 'POST', '/api/users', { ...createBody, email: 'teacher-create@accounts-local.test' }, 403, { bearer: teacher });
  assert.deepEqual(await lifecycleSnapshot(), beforeDenied);
  cases.push('owner creation, authoritative employee binding, protected roles and tenant isolation on workerd D1');

  const temporary = (await call('temporary bearer login', 'POST', '/api/auth/login', { email: created.email, password: created.temporary_password, session_mode: 'bearer' }, 200, { anonymous: true })).data;
  assert.equal(await verifyJWT(temporary.token, secret), null, 'old application key must reject restricted tokens');
  assert.equal((await call('forced password gate', 'GET', '/api/students', undefined, 403, { bearer: temporary.token })).body.code, 'password_change_required');
  await call('temporary account can inspect own session', 'GET', '/api/auth/me', undefined, 200, { bearer: temporary.token });
  const cookieLogin = await call('temporary browser login', 'POST', '/api/auth/login', { email: created.email, password: created.temporary_password, session_mode: 'cookie' }, 200, { anonymous: true });
  const cookie = cookieLogin.response.headers.get('set-cookie').split(';')[0], csrf = cookieLogin.data.csrf_token;
  const permanentPassword = 'LOCAL changed password 2026';
  await call('password change requires CSRF', 'POST', '/api/auth/change-password', { current_password: created.temporary_password, new_password: permanentPassword }, 403, { cookie });
  const changed = await call('change temporary password', 'POST', '/api/auth/change-password', { current_password: created.temporary_password, new_password: permanentPassword }, 200, { cookie, csrf });
  assert.match(changed.response.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await row(created.id)).must_change_password, 0);
  assert.equal((await row(created.id)).temporary_password_expires_at, null);
  await call('change revokes earlier restricted bearer', 'GET', '/api/auth/me', undefined, 401, { bearer: temporary.token });
  const permanent = (await call('fresh permanent login', 'POST', '/api/auth/login', { email: created.email, password: permanentPassword, session_mode: 'bearer' }, 200, { anonymous: true })).data;
  assert.ok(await verifyJWT(permanent.token, secret));
  cases.push('cookie and bearer forced change, CSRF, old-version rejection and post-change session revocation');

  const accountPath = `/api/users/${created.id}`;
  await call('change teacher role', 'PUT', accountPath, { expected_revision: 2, role_key: 'registrar' }, 200);
  assert.equal((await db.prepare('SELECT status FROM teacher_employee_links WHERE teacher_user_id=?').bind(created.id).first()).status, 'inactive');
  await call('role change revokes permanent bearer', 'GET', '/api/auth/me', undefined, 401, { bearer: permanent.token });
  await call('change role back', 'PUT', accountPath, { expected_revision: 3, role_key: 'teacher' }, 200);
  assert.equal((await db.prepare('SELECT status FROM teacher_employee_links WHERE teacher_user_id=?').bind(created.id).first()).status, 'inactive');
  const beforeStale = await lifecycleSnapshot();
  await call('stale reset rejected', 'PUT', accountPath + '/reset-password', { expected_revision: 1 }, 409);
  assert.deepEqual(await lifecycleSnapshot(), beforeStale);
  const reset = (await call('reset generates a new temporary credential', 'PUT', accountPath + '/reset-password', { expected_revision: 4 }, 200)).data;
  assert.notEqual(reset.temporary_password, created.temporary_password);
  assert.equal((await row(created.id)).account_revision, 5);
  assert.equal((await row(created.id)).must_change_password, 1);
  const resetSession = (await call('new temporary credential works', 'POST', '/api/auth/login', { email: created.email, password: reset.temporary_password, session_mode: 'bearer' }, 200, { anonymous: true })).data;
  await call('disable temporary account', 'PUT', accountPath + '/status', { expected_revision: 5, status: 'inactive' }, 200);
  await call('disabled temporary token rejected', 'GET', '/api/auth/me', undefined, 401, { bearer: resetSession.token });
  await call('reenable account', 'PUT', accountPath + '/status', { expected_revision: 6, status: 'active' }, 200);
  await call('reenabling does not revive old token', 'GET', '/api/auth/me', undefined, 401, { bearer: resetSession.token });
  cases.push('optimistic revisions, reset rotation, role and status revocation with no link resurrection');

  const audit = (await call('owner reads scoped audit', 'GET', accountPath + '/audit', undefined, 200)).data;
  assert.equal(audit.length, 7);
  const serializedAudit = JSON.stringify(audit);
  assert.doesNotMatch(serializedAudit, /password_hash|pbkdf2_sha256/);
  for (const value of [created.temporary_password, reset.temporary_password, permanentPassword, temporary.token]) assert.equal(serializedAudit.includes(value), false);
  await call('foreign audit denied', 'GET', '/api/users/9/audit', undefined, 403);
  await assert.rejects(() => db.prepare('UPDATE user_account_audit SET id=id+100000 WHERE target_user_id=?').bind(created.id).run(), /immutable/);
  await assert.rejects(() => db.prepare('DELETE FROM user_account_audit WHERE target_user_id=?').bind(created.id).run(), /immutable/);
  cases.push('scoped immutable audit contains no credentials');

  const beforeFailure = await lifecycleSnapshot();
  const failingDatabase = {
    prepare: sql => db.prepare(sql),
    batch: statements => db.batch([...statements, db.prepare('SELECT * FROM intentional_local_account_failure')]),
  };
  await call('late real-D1 batch failure rolls back creation', 'POST', '/api/users', { full_name: 'LOCAL rollback account', email: 'rollback@accounts-local.test', role_key: 'registrar' }, 500, { database: failingDatabase });
  assert.deepEqual(await lifecycleSnapshot(), beforeFailure);
  cases.push('workerd D1 rolls back account, audit and guard after a late native batch failure');

  const final = await snapshot(db);
  const changedTables = new Set(['users', 'teacher_employee_links', 'user_account_audit', 'revoked_sessions', 'login_throttles', 'sqlite_sequence']);
  for (const [name, previous] of Object.entries(after.tables)) {
    if (!changedTables.has(name)) assert.deepEqual(final.tables[name], previous, `API scenarios unexpectedly changed ${name}`);
  }
  const oldForeign = before.tables.users.content.filter(encoded => JSON.parse(encoded)[1]?.[1] === '2');
  const finalForeign = final.tables.users.content.filter(encoded => JSON.parse(encoded)[1]?.[1] === '2').map(encoded => JSON.stringify(JSON.parse(encoded).slice(0, -3)));
  assert.deepEqual(finalForeign, oldForeign, 'foreign-school accounts remain byte-and-type identical');
  assert.equal((await db.prepare('PRAGMA foreign_keys').first()).foreign_keys, 1);
  assert.deepEqual(final.foreignKeys, []);
  assert.equal(final.tables.user_account_write_guards.count, 0);
  cases.push('foreign school, academic/finance/timetable tables, foreign keys and write guards remain clean');
  const evidence = {
    local_only: true,
    database_engine: 'Cloudflare workerd D1',
    migration: accountMigration,
    migration_count: after.tables.d1_migrations.count,
    baseline_fingerprint: digest(before),
    upgraded_fingerprint: digest(after),
    typed_historical_values_preserved: true,
    schema_changes_limited_to_migration: true,
    api_requests: apiEvidence.length,
    cases,
    api_evidence: apiEvidence,
    foreign_key_check: [],
    guards_remaining: 0,
  };
  writeFileSync(join(directory, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await vite.close();
  await proxy.dispose();
}
