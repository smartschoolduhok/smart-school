import assert from 'node:assert/strict';
import test, {after} from 'node:test';
import {createServer} from 'vite';
import {signJWT} from '../src/lib/jwtSecurity.ts';
import {fixture, root, entry} from './helpers/teaching-load-matrix-fixture.mjs';

const vite = await createServer({root, appType: 'custom', server: {middlewareMode: true, hmr: false}});
const {default: app} = await vite.ssrLoadModule('/src/worker.ts');
after(() => vite.close());
const secret = 'named-teacher-api-test-secret-with-enough-entropy';
const token = await signJWT({id: 1, email: 'owner@matrix.test', auth_version: 1}, secret);
async function call(f, method, path, body) {
  const response = await app.request(`http://localhost${path}`, {method,
    headers: {'Content-Type': 'application/json', Authorization: `Bearer ${token}`},
    body: body === undefined ? undefined : JSON.stringify(body)},
  {DB: f.d1, JWT_SECRET: secret, APP_ENV: 'test'});
  return {status: response.status, body: await response.json()};
}
const input = overrides => ({school_id: 1, academic_year_id: 1, class_id: 1, section_id: 2,
  subject_id: 2, employee_id: null, weekly_periods: 2, teacher_placeholder: '  مدرس الإنكليزي  ', ...overrides});

test('named vacancies create, display in master grid and rename without employee records', async () => {
  const f = fixture();
  const before = f.db.prepare('SELECT COUNT(*) n FROM employees').get().n;
  const created = await call(f, 'POST', '/api/timetable/teaching-loads', input());
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.data.employee_id, null);
  assert.equal(created.body.data.teacher_placeholder, 'مدرس الإنكليزي');
  const id = created.body.data.id;
  entry(f.db, id, 1);
  const loads = await call(f, 'GET', '/api/timetable/teaching-loads?school_id=1&academic_year_id=1');
  assert.equal(loads.status, 200);
  assert.equal(loads.body.data.find(l => l.id === id).employee_name, 'مدرس الإنكليزي');
  const master = await call(f, 'GET', '/api/timetable/master-grid?school_id=1&academic_year_id=1');
  assert.equal(master.status, 200, JSON.stringify(master.body));
  const lesson = master.body.data.entries.find(e => e.teaching_load_id === id);
  assert.equal(lesson.employee_id, null);
  assert.equal(lesson.employee_name, 'مدرس الإنكليزي');
  assert.equal(lesson.teacher_placeholder, 'مدرس الإنكليزي');
  const renamed = await call(f, 'PUT', `/api/timetable/teaching-loads/${id}`, input({teacher_placeholder: 'مدرس اللغة الإنكليزية'}));
  assert.equal(renamed.status, 200, JSON.stringify(renamed.body));
  assert.equal(renamed.body.data.teacher_placeholder, 'مدرس اللغة الإنكليزية');
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM employees').get().n, before);
  f.db.close();
});

test('omitted placeholder survives quota update and selecting an employee clears it', async () => {
  const f = fixture();
  const created = await call(f, 'POST', '/api/timetable/teaching-loads', input());
  const id = created.body.data.id;
  const periodsOnly = input({weekly_periods: 3}); delete periodsOnly.teacher_placeholder;
  const saved = await call(f, 'PUT', `/api/timetable/teaching-loads/${id}`, periodsOnly);
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.data.teacher_placeholder, 'مدرس الإنكليزي');
  const assigned = await call(f, 'PUT', `/api/timetable/teaching-loads/${id}`, input({employee_id: 1}));
  assert.equal(assigned.status, 200, JSON.stringify(assigned.body));
  assert.equal(assigned.body.data.employee_id, 1);
  assert.equal(assigned.body.data.teacher_placeholder, null);
  f.db.close();
});

test('invalid names and foreign-school writes do not create loads', async () => {
  const f = fixture();
  const before = f.db.prepare('SELECT COUNT(*) n FROM timetable_teaching_loads').get().n;
  for (const teacher_placeholder of ['x'.repeat(121), 'teacher\nname', {name: 'teacher'}]) {
    const response = await call(f, 'POST', '/api/timetable/teaching-loads', input({teacher_placeholder}));
    assert.equal(response.status, 400, JSON.stringify(response.body));
  }
  const foreign = await call(f, 'POST', '/api/timetable/teaching-loads', input({school_id: 2, academic_year_id: 3}));
  assert.equal(foreign.status, 403);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM timetable_teaching_loads').get().n, before);
  f.db.close();
});

test('renaming a scheduled vacancy cannot merge it into a colliding teacher resource', async () => {
  const f = fixture();
  f.db.exec("UPDATE timetable_teaching_loads SET teacher_placeholder='مدرس الإنكليزي' WHERE id=1");
  entry(f.db, 1, 1);
  const created = await call(f, 'POST', '/api/timetable/teaching-loads', input({teacher_placeholder: 'مدرس العربي والإسلامية'}));
  const id = created.body.data.id;
  entry(f.db, id, 1);
  const response = await call(f, 'PUT', `/api/timetable/teaching-loads/${id}`, input());
  assert.equal(response.status, 409, JSON.stringify(response.body));
  assert.equal(response.body.code, 'teacher_collision');
  assert.equal(f.db.prepare('SELECT teacher_placeholder FROM timetable_teaching_loads WHERE id=?').get(id).teacher_placeholder, 'مدرس العربي والإسلامية');
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM timetable_entries').get().n, 2);
  f.db.close();
});
