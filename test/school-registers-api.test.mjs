import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';
import { fixture as baseFixture, root } from './helpers/teaching-load-matrix-fixture.mjs';
import { signJWT } from '../src/lib/jwtSecurity.ts';

const secret = 'school-registers-local-tests-only-adequate-secret';
const vite = await createServer({ root, appType: 'custom', server: { middlewareMode: true, hmr: false } });
const { default: app } = await vite.ssrLoadModule('/src/worker.ts');
after(() => vite.close());
const roleIds = { owner: 1, admin: 2, teacher: 3, accountant: 4, principal: 5, vice: 6, registrar: 7, parent: 8 };
const tokens = Object.fromEntries(await Promise.all(Object.entries(roleIds).map(async ([role, id]) => [role, await signJWT({ id, email: role === 'parent' ? 'register-parent@test.local' : `${role}@matrix.test`, auth_version: 1 }, secret)])));
function fixture(t) {
  const f = baseFixture(); t.after(() => f.db.close());
  f.db.exec("INSERT INTO users(id,school_id,full_name,email,role_id,status,auth_version) VALUES(8,1,'Parent','register-parent@test.local',8,'active',1)");
  return f;
}
async function request(f, method, path, body, role = 'owner') {
  const response = await app.request(`http://localhost${path}`, { method,
    headers: { Authorization: `Bearer ${tokens[role]}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, { DB: f.d1, JWT_SECRET: secret, APP_ENV: 'test' });
  return { status: response.status, body: await response.json() };
}
function succeeds(result, status = 200) { assert.equal(result.status, status, JSON.stringify(result.body)); return result.body.data; }
const scope = { school_id: 1, academic_year_id: 1, register_key: 'meetings' };
const query = (overrides = {}) => new URLSearchParams({ ...scope, ...overrides }).toString();
const entry = (overrides = {}) => ({ ...scope, entry_date: '2026-10-06', title: 'اجتماع الهيئة التدريسية', data: { agenda: 'متابعة التعلم', extra_fields: [{ label: 'المكان', value: 'المكتبة' }] }, ...overrides });
const create = async (f, overrides = {}) => succeeds(await request(f, 'POST', '/api/school-registers', entry(overrides)), 201);
const evaluation = () => ({ employee_id: 1, evaluation: { visits: Array.from({ length: 4 }, () => ({ date: null, scores: Array(20).fill(null) })) } });

test('create, edit, history and archive retain exact scoped snapshots', async t => {
  const f = fixture(t), created = await create(f);
  assert.equal(created.version, 1); assert.equal(created.status, 'active');
  assert.deepEqual(created.data.extra_fields, [{ label: 'المكان', value: 'المكتبة' }]);
  const changed = succeeds(await request(f, 'PUT', `/api/school-registers/${created.id}`, entry({ version: 1, title: 'عنوان مصحح' })));
  assert.equal(changed.version, 2);
  const archived = succeeds(await request(f, 'POST', `/api/school-registers/${created.id}/void`, { ...scope, version: 2, reason: 'قيد مكرر' }));
  assert.equal(archived.status, 'voided'); assert.equal(archived.void_reason, 'قيد مكرر'); assert.equal(archived.version, 3);
  assert.deepEqual(archived.data, changed.data);
  const history = succeeds(await request(f, 'GET', `/api/school-registers/${created.id}/history?${query()}`));
  assert.equal(history.total, 3);
  assert.deepEqual(history.history.map(row => row.action), ['voided', 'updated', 'created']);
  assert.deepEqual(history.history[0].before, changed); assert.deepEqual(history.history[0].after, archived);
  assert.equal(history.history[2].before, null); assert.deepEqual(history.history[2].after, created);
  const active = succeeds(await request(f, 'GET', `/api/school-registers?${query()}`));
  assert.equal(active.total, 0); assert.equal(active.voided_total, 1);
  assert.equal(succeeds(await request(f, 'GET', `/api/school-registers?${query({ status: 'voided' })}`)).total, 1);
  assert.equal((await request(f, 'PUT', `/api/school-registers/${created.id}`, entry({ version: 3 }))).status, 409);
  assert.throws(() => f.db.prepare('DELETE FROM school_register_entries WHERE id=?').run(created.id), /immutable/);
  assert.throws(() => f.db.exec('UPDATE school_register_history SET version=9'), /immutable/);
  assert.throws(() => f.db.exec('DELETE FROM school_register_history'), /immutable/);
});

test('pagination, literal searches, counts and archived years are isolated', async t => {
  const f = fixture(t);
  await create(f, { title: 'عنوان 100%_خاص' });
  await create(f, { title: 'آخر', entry_date: '2026-10-07' });
  await create(f, { title: 'سنة سابقة', academic_year_id: 2 });
  await create(f, { register_key: 'decisions', data: {}, title: 'قرار' });
  const first = succeeds(await request(f, 'GET', `/api/school-registers?${query({ page_size: 1 })}`));
  assert.equal(first.total, 2); assert.equal(first.active_total, 2); assert.equal(first.entries.length, 1); assert.equal(first.entries[0].title, 'آخر');
  const second = succeeds(await request(f, 'GET', `/api/school-registers?${query({ page_size: 1, page: 2 })}`));
  assert.equal(second.entries[0].title, 'عنوان 100%_خاص');
  assert.equal(succeeds(await request(f, 'GET', `/api/school-registers?${query({ search: '%_' })}`)).total, 1);
  assert.equal(succeeds(await request(f, 'GET', `/api/school-registers?${query({ search: 'المكتبة' })}`)).total, 2);
  assert.equal(succeeds(await request(f, 'GET', `/api/school-registers?${query({ academic_year_id: 2 })}`)).total, 1);
});

test('every endpoint enforces management roles, school, year and register scope', async t => {
  const f = fixture(t), created = await create(f);
  for (const role of ['teacher', 'accountant', 'registrar', 'parent']) {
    for (const [method, path, body] of [
      ['GET', `/api/school-registers?${query()}`],
      ['POST', '/api/school-registers', entry()],
      ['PUT', `/api/school-registers/${created.id}`, entry({ version: 1 })],
      ['POST', `/api/school-registers/${created.id}/void`, { ...scope, version: 1, reason: 'test' }],
      ['GET', `/api/school-registers/${created.id}/history?${query()}`],
    ]) assert.equal((await request(f, method, path, body, role)).status, 403, `${role} ${method} ${path}`);
  }
  for (const role of ['principal', 'vice', 'admin']) succeeds(await request(f, 'GET', `/api/school-registers?${query()}`, undefined, role));
  assert.equal((await request(f, 'GET', `/api/school-registers?${query({ school_id: 2, academic_year_id: 3 })}`)).status, 403);
  assert.equal((await request(f, 'GET', `/api/school-registers?${query({ academic_year_id: 3 })}`)).status, 404);
  assert.equal((await request(f, 'GET', `/api/school-registers/${created.id}/history?${query({ academic_year_id: 2 })}`)).status, 404);
  assert.equal((await request(f, 'PUT', `/api/school-registers/${created.id}`, entry({ version: 1, register_key: 'decisions', data: {} }))).status, 404);
  assert.equal((await request(f, 'GET', '/api/school-registers', undefined, 'admin')).status, 400);
  const foreign = succeeds(await request(f, 'POST', '/api/school-registers', entry({ school_id: 2, academic_year_id: 3 }), 'admin'), 201);
  assert.equal((await request(f, 'GET', `/api/school-registers/${foreign.id}/history?${query()}`)).status, 404);
  assert.equal((await request(f, 'POST', `/api/school-registers?${query({ academic_year_id: 2 })}`, entry())).status, 400);
});

test('validation rejects invalid scope, dates, evaluation values and foreign employees without writes', async t => {
  const f = fixture(t);
  for (const overrides of [
    { school_id: true }, { academic_year_id: false }, { register_key: 'unregistered' },
    { entry_date: '2026-02-30' }, { title: '' }, { data: { unknown: 1 } },
    { data: { extra_fields: Array.from({ length: 21 }, () => ({ label: 'x', value: '' })) } },
    { register_key: 'teacher-leaves', data: { start_date: '2026-10-10', end_date: '2026-10-05' } },
    { register_key: 'ikal', data: { start_date: '2026-10-06', end_date: '2026-10-06', start_time: '14:00', end_time: '09:00' } },
    { register_key: 'development-plan', data: { start_date: '2026-10-10', due_date: '2026-10-05' } },
  ]) assert.equal((await request(f, 'POST', '/api/school-registers', entry(overrides))).status, 400);
  for (const employee_id of [5, 999]) assert.equal((await request(f, 'POST', '/api/school-registers', entry({ register_key: 'teacher-evaluation', data: { ...evaluation(), employee_id } }))).status, 404);
  const invalid = evaluation(); invalid.evaluation.visits[0].scores[0] = 0;
  assert.equal((await request(f, 'POST', '/api/school-registers', entry({ register_key: 'teacher-evaluation', data: invalid }))).status, 400);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM school_register_entries').get().n, 0);
  const valid = evaluation(); valid.evaluation.visits[0].scores[0] = 5;
  const row = await create(f, { register_key: 'teacher-evaluation', data: valid });
  assert.equal(row.data.evaluation.visits[0].scores[0], 5); assert.equal(row.data.evaluation.visits[0].scores[1], null);
  for (const value of [{ page: '0' }, { page_size: '101' }, { status: 'deleted' }]) assert.equal((await request(f, 'GET', `/api/school-registers?${query(value)}`)).status, 400);
  assert.equal((await request(f, 'POST', `/api/school-registers/${row.id}/void`, { ...scope, register_key: 'teacher-evaluation', version: 1, reason: '' })).status, 400);
});

test('optimistic update prevents stale writes including a concurrent change at commit time', async t => {
  const f = fixture(t), row = await create(f);
  succeeds(await request(f, 'PUT', `/api/school-registers/${row.id}`, entry({ version: 1, title: 'التعديل الأول' })));
  assert.equal((await request(f, 'PUT', `/api/school-registers/${row.id}`, entry({ version: 1 }))).status, 409);
  assert.equal((await request(f, 'POST', `/api/school-registers/${row.id}/void`, { ...scope, version: 1, reason: 'قديم' })).status, 409);
  f.d1.beforeWrite = () => f.db.prepare("UPDATE school_register_entries SET title='تعديل متزامن',version=version+1 WHERE id=?").run(row.id);
  assert.equal((await request(f, 'PUT', `/api/school-registers/${row.id}`, entry({ version: 2, title: 'سيضيع لولا الحماية' }))).status, 409);
  assert.equal(f.db.prepare('SELECT title FROM school_register_entries WHERE id=?').get(row.id).title, 'تعديل متزامن');
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM school_register_history WHERE entry_id=?').get(row.id).n, 3);
});

test('audit failure rolls back entry changes and permission changes are checked inside writes', async t => {
  const f = fixture(t), row = await create(f);
  f.db.exec("CREATE TRIGGER reject_test_audit BEFORE INSERT ON school_register_history BEGIN SELECT RAISE(ABORT,'test_audit_failure'); END;");
  assert.equal((await request(f, 'PUT', `/api/school-registers/${row.id}`, entry({ version: 1, title: 'لا يحفظ' }))).status, 503);
  assert.equal((await request(f, 'POST', '/api/school-registers', entry())).status, 503);
  assert.equal(f.db.prepare('SELECT version FROM school_register_entries WHERE id=?').get(row.id).version, 1);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM school_register_entries').get().n, 1);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM school_register_history').get().n, 1);
  f.db.exec('DROP TRIGGER reject_test_audit');
  f.d1.beforeWrite = () => f.db.exec('UPDATE users SET role_id=5 WHERE id=1');
  assert.equal((await request(f, 'PUT', `/api/school-registers/${row.id}`, entry({ version: 1 }))).status, 409);
  assert.equal(f.db.prepare('SELECT version FROM school_register_entries WHERE id=?').get(row.id).version, 1);
});

test('database constraints defend school scope, employee links, permanent history and archive content', async t => {
  const f = fixture(t), row = await create(f);
  const insert = f.db.prepare(`INSERT INTO school_register_entries
    (school_id,academic_year_id,register_key,entry_date,title,data_json,employee_id,created_by_user_id,updated_by_user_id)
    VALUES(?,?,?,'2026-10-06','اختبار',?,?,1,1)`);
  assert.throws(() => insert.run(1, 3, 'meetings', '{}', null), /school_register_scope_conflict/);
  assert.throws(() => insert.run(1, 1, 'teacher-evaluation', '{"employee_id":5}', 5), /school_register_scope_conflict/);
  assert.throws(() => insert.run(1, 1, 'teacher-evaluation', '{}', 1), /CHECK/);
  assert.throws(() => insert.run(1, 1, 'teacher-evaluation', '{"employee_id":2}', 1), /CHECK/);
  assert.throws(() => f.db.prepare('UPDATE school_register_entries SET academic_year_id=2,version=version+1 WHERE id=?').run(row.id), /school_register_scope_conflict/);
  assert.throws(() => f.db.prepare("UPDATE school_register_entries SET status='voided',void_reason='سبب',title='تعديل خفي',version=version+1 WHERE id=?").run(row.id), /school_register_void_content_conflict/);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM school_register_history').get().n, 1);
  assert.equal(f.db.prepare('SELECT status FROM school_register_entries WHERE id=?').get(row.id).status, 'active');
});
