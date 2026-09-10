import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'vite';
import { signJWT } from '../src/lib/jwtSecurity.ts';
import {
  LocalD1,
  fixtureSQL,
  migrationFiles,
  migrationSQL,
  root,
} from './helpers/teaching-load-matrix-fixture.mjs';

const vite = await createServer({ root, appType: 'custom', server: { middlewareMode: true, hmr: false } });
const { default: app } = await vite.ssrLoadModule('/src/worker.ts');
after(() => vite.close());

const secret = 'generated-local-resource-access-secret-only';
const tokens = Object.fromEntries(await Promise.all([
  ['owner', 'owner@matrix.test'],
  ['teacher', 'teacher@matrix.test'],
  ['accountant', 'accountant@matrix.test'],
  ['parent', 'parent@matrix.test'],
].map(async ([key, email]) => [key, await signJWT({ email, auth_version: 1 }, secret)])));

function createFixture(t) {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys=ON');
  t.after(() => database.close());
  for (const file of migrationFiles) database.exec(migrationSQL(file));
  database.exec(fixtureSQL);
  database.exec(`
    INSERT INTO users(id,school_id,full_name,email,role_id,status,auth_version)
    VALUES(8,1,'Parent','parent@matrix.test',8,'active',1);
    INSERT INTO students(id,school_id,student_number,full_name,gender,status,class_id,section_id)
    VALUES
      (1,1,'S-1','Student One','ذكر','active',1,1),
      (2,1,'S-2','Student Two','أنثى','active',1,2),
      (3,2,'SECRET','Foreign Student','ذكر','active',3,3);
    INSERT INTO school_settings(school_id) VALUES(1),(2);
    INSERT INTO grade_settings(school_id,updated_by_user_id) VALUES(1,1),(2,2);
    INSERT INTO student_subjects(id,school_id,student_id,subject_id,class_id,section_id,assigned_by_user_id)
    VALUES
      (1,1,1,1,1,1,1),
      (2,1,2,1,1,2,1),
      (3,2,3,5,3,3,2);
    INSERT INTO grades(id,school_id,student_subject_id,first_month,is_active,updated_by_user_id)
    VALUES(1,1,1,50,1,1),(2,1,2,60,1,1),(3,2,3,70,1,2);
    UPDATE timetable_teaching_loads SET employee_id=1 WHERE id=1;
  `);
  return { database, d1: new LocalD1(database) };
}

async function api(fixture, role, method, path, body) {
  const response = await app.request(`http://localhost${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokens[role]}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, { DB: fixture.d1, JWT_SECRET: secret, APP_ENV: 'test' });
  return { status: response.status, body: await response.json() };
}

test('parent access fails closed and broad academic routes stay unavailable', async t => {
  const fixture = createFixture(t);
  assert.deepEqual((await api(fixture, 'parent', 'GET', '/api/students?school_id=1')).body.data, []);
  assert.deepEqual((await api(fixture, 'parent', 'GET', '/api/grades?school_id=1')).body.data, []);
  for (const path of [
    '/api/students/1',
    '/api/students/1/subjects',
    '/api/students/1/grades',
    '/api/students/1/enrollments?school_id=1',
  ]) assert.equal((await api(fixture, 'parent', 'GET', path)).status, 403, path);
  for (const path of [
    '/api/subjects?school_id=1',
    '/api/student-subjects?school_id=1',
    '/api/analytics/overview?school_id=1',
  ]) assert.equal((await api(fixture, 'parent', 'GET', path)).status, 403, path);
});

test('an explicit parent link exposes only that child and can be revoked', async t => {
  const fixture = createFixture(t);
  const created = await api(fixture, 'owner', 'POST', '/api/access-links/parents', {
    school_id: 1,
    parent_user_id: 8,
    student_id: 1,
    relationship: 'الأب',
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));

  const students = await api(fixture, 'parent', 'GET', '/api/students?school_id=1');
  assert.deepEqual(students.body.data.map(row => row.id), [1]);
  const grades = await api(fixture, 'parent', 'GET', '/api/grades?school_id=1');
  assert.deepEqual(grades.body.data.map(row => row.id), [1]);
  assert.equal((await api(fixture, 'parent', 'GET', '/api/students/1')).status, 200);
  assert.equal((await api(fixture, 'parent', 'GET', '/api/students/1/subjects')).status, 200);
  assert.equal((await api(fixture, 'parent', 'GET', '/api/students/1/grades')).status, 200);
  assert.equal((await api(fixture, 'parent', 'GET', '/api/students/2')).status, 403);

  const revoked = await api(
    fixture,
    'owner',
    'DELETE',
    `/api/access-links/parents/${created.body.data.id}?school_id=1`,
  );
  assert.equal(revoked.status, 200);
  assert.equal((await api(fixture, 'parent', 'GET', '/api/students/1')).status, 403);
});

test('teacher reads and writes only grades covered by the linked active teaching load', async t => {
  const fixture = createFixture(t);
  assert.deepEqual((await api(fixture, 'teacher', 'GET', '/api/students?school_id=1')).body.data, []);
  assert.equal((await api(fixture, 'teacher', 'PUT', '/api/grades/1', { school_id: 1, first_month: 77 })).status, 403);

  const linked = await api(fixture, 'owner', 'POST', '/api/access-links/teachers', {
    school_id: 1,
    teacher_user_id: 3,
    employee_id: 1,
  });
  assert.equal(linked.status, 201, JSON.stringify(linked.body));

  const students = await api(fixture, 'teacher', 'GET', '/api/students?school_id=1');
  assert.deepEqual(students.body.data.map(row => row.id), [1]);
  const grades = await api(fixture, 'teacher', 'GET', '/api/grades?school_id=1');
  assert.deepEqual(grades.body.data.map(row => row.id), [1]);
  assert.equal((await api(fixture, 'teacher', 'GET', '/api/students/2/grades')).status, 403);

  const allowed = await api(fixture, 'teacher', 'PUT', '/api/grades/1', { school_id: 1, first_month: 77 });
  assert.equal(allowed.status, 200, JSON.stringify(allowed.body));
  const denied = await api(fixture, 'teacher', 'PUT', '/api/grades/2', { school_id: 1, first_month: 88 });
  assert.equal(denied.status, 403);
  assert.equal(fixture.database.prepare('SELECT first_month FROM grades WHERE id=1').get().first_month, 77);
  assert.equal(fixture.database.prepare('SELECT first_month FROM grades WHERE id=2').get().first_month, 60);

  const analytics = await api(fixture, 'teacher', 'GET', '/api/analytics/overview?school_id=1');
  assert.equal(analytics.status, 200);
  assert.equal(analytics.body.data.total, 1);
});

test('link management is tenant-scoped, role-validated and hidden from non-management roles', async t => {
  const fixture = createFixture(t);
  assert.equal((await api(fixture, 'teacher', 'GET', '/api/access-links?school_id=1')).status, 403);
  assert.equal((await api(fixture, 'parent', 'POST', '/api/access-links/parents', {
    school_id: 1, parent_user_id: 8, student_id: 1,
  })).status, 403);
  const foreign = await api(fixture, 'owner', 'POST', '/api/access-links/parents', {
    school_id: 1, parent_user_id: 8, student_id: 3,
  });
  assert.equal(foreign.status, 400);
  const wrongRole = await api(fixture, 'owner', 'POST', '/api/access-links/teachers', {
    school_id: 1, teacher_user_id: 3, employee_id: 3,
  });
  assert.equal(wrongRole.status, 400);
});

test('a grade and its audit log commit together or both roll back', async t => {
  const fixture = createFixture(t);
  fixture.d1.failAt = 1;
  const failed = await api(fixture, 'owner', 'PUT', '/api/grades/1', {
    school_id: 1,
    first_month: 91,
    change_reason: 'اختبار التراجع',
  });
  assert.equal(failed.status, 500);
  assert.deepEqual(
    { ...fixture.database.prepare('SELECT first_month, revision FROM grades WHERE id=1').get() },
    { first_month: 50, revision: 0 },
  );
  assert.equal(fixture.database.prepare('SELECT COUNT(*) AS count FROM grade_change_logs').get().count, 0);

  fixture.d1.failAt = null;
  const saved = await api(fixture, 'owner', 'PUT', '/api/grades/1', {
    school_id: 1,
    first_month: 91,
    change_reason: 'تصحيح',
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.data.revision, 1);
  assert.deepEqual(
    { ...fixture.database.prepare('SELECT old_value, new_value, change_reason FROM grade_change_logs WHERE grade_id=1').get() },
    { old_value: '50', new_value: '91', change_reason: 'تصحيح' },
  );
});

test('optimistic grade revision rejects a concurrent overwrite without a false audit row', async t => {
  const fixture = createFixture(t);
  fixture.d1.beforeWrite = () => {
    fixture.database.exec('UPDATE grades SET first_month=51, revision=revision+1 WHERE id=1');
  };
  const stale = await api(fixture, 'owner', 'PUT', '/api/grades/1', {
    school_id: 1,
    first_month: 92,
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'grade_write_stale');
  assert.deepEqual(
    { ...fixture.database.prepare('SELECT first_month, revision FROM grades WHERE id=1').get() },
    { first_month: 51, revision: 1 },
  );
  assert.equal(fixture.database.prepare('SELECT COUNT(*) AS count FROM grade_change_logs').get().count, 0);
});

test('bulk grade entry is atomic across every grade and detects a stale row', async t => {
  const fixture = createFixture(t);
  fixture.d1.failAt = 3;
  const failed = await api(fixture, 'owner', 'POST', '/api/grades/bulk-entry', {
    school_id: 1,
    entries: [
      { grade_id: 1, first_month: 80 },
      { grade_id: 2, first_month: 81 },
    ],
  });
  assert.equal(failed.status, 500);
  assert.deepEqual(
    fixture.database.prepare('SELECT id, first_month, revision FROM grades WHERE id IN (1,2) ORDER BY id').all().map(row => ({ ...row })),
    [{ id: 1, first_month: 50, revision: 0 }, { id: 2, first_month: 60, revision: 0 }],
  );
  assert.equal(fixture.database.prepare('SELECT COUNT(*) AS count FROM grade_change_logs').get().count, 0);

  fixture.d1.failAt = null;
  fixture.d1.beforeWrite = () => {
    fixture.database.exec('UPDATE grades SET first_month=61, revision=revision+1 WHERE id=2');
  };
  const stale = await api(fixture, 'owner', 'POST', '/api/grades/bulk-entry', {
    school_id: 1,
    entries: [
      { grade_id: 1, first_month: 80 },
      { grade_id: 2, first_month: 81 },
    ],
  });
  assert.equal(stale.status, 409);
  assert.deepEqual(
    fixture.database.prepare('SELECT id, first_month, revision FROM grades WHERE id IN (1,2) ORDER BY id').all().map(row => ({ ...row })),
    [{ id: 1, first_month: 50, revision: 0 }, { id: 2, first_month: 61, revision: 1 }],
  );
  assert.equal(fixture.database.prepare('SELECT COUNT(*) AS count FROM grade_change_logs').get().count, 0);
});

async function linkTeacher(fixture) {
  const response = await api(fixture, 'owner', 'POST', '/api/access-links/teachers', {
    school_id: 1, teacher_user_id: 3, employee_id: 1,
  });
  assert.equal(response.status, 201);
}
function secondSubject(fixture) {
  fixture.database.exec(`
    UPDATE subjects SET religious_track='islamic' WHERE id=2;
    INSERT INTO student_subjects(id,school_id,student_id,subject_id,class_id,section_id,assigned_by_user_id)
    VALUES(4,1,1,2,1,1,1);
    INSERT INTO grades(id,school_id,student_subject_id,first_month,is_active,updated_by_user_id)
    VALUES(4,1,4,95,1,1);
  `);
}

test('student grade and subject endpoints restrict a teacher to the assigned subject', async t => {
  const f = createFixture(t); secondSubject(f); await linkTeacher(f);
  const grades = await api(f, 'teacher', 'GET', '/api/students/1/grades');
  assert.equal(grades.status, 200);
  assert.deepEqual(grades.body.data.grades.map(g=>g.id), [1]);
  const subjects = await api(f, 'teacher', 'GET', '/api/students/1/subjects');
  assert.equal(subjects.status, 200);
  assert.deepEqual(subjects.body.data.map(s=>s.subject_id), [1]);
  assert.ok(!JSON.stringify(subjects.body).includes('islamic'));
  const assignments = await api(f, 'teacher', 'GET', '/api/student-subjects?school_id=1&student_id=1');
  assert.equal(assignments.status, 200);
  assert.deepEqual(assignments.body.data.map(s=>s.subject_id), [1]);
  assert.ok(!JSON.stringify(assignments.body).includes('islamic'));
  const summary = await api(f, 'teacher', 'GET', '/api/analytics/student-summary/1');
  assert.equal(summary.status, 200);
  assert.deepEqual(summary.body.data.subjects.map(s=>s.subject_id), [1]);
  await api(f, 'owner', 'POST', '/api/access-links/parents', {school_id:1,parent_user_id:8,student_id:1});
  for (const role of ['parent','owner']) {
    assert.deepEqual((await api(f,role,'GET','/api/students/1/grades')).body.data.grades.map(g=>g.id), [1,4]);
    assert.deepEqual((await api(f,role,'GET','/api/students/1/subjects')).body.data.map(s=>s.subject_id), [1,2]);
  }
});

for (const [name,sql] of [
  ['archived employee', "UPDATE employees SET status='archived' WHERE id=1"],
  ['employee no longer teacher', "UPDATE employees SET role='staff' WHERE id=1"],
  ['employee moved school', 'UPDATE employees SET school_id=2 WHERE id=1'],
  ['missing employee', 'PRAGMA foreign_keys=OFF; DELETE FROM employees WHERE id=1; PRAGMA foreign_keys=ON;'],
  ['inactive link', "UPDATE teacher_employee_links SET status='inactive' WHERE teacher_user_id=3"],
  ['inactive load', "UPDATE timetable_teaching_loads SET status='inactive' WHERE id=1"],
  ['inactive academic year', 'UPDATE academic_years SET is_active=0 WHERE id=1'],
]) test(`teacher access is revoked immediately: ${name}`, async t => {
  const f=createFixture(t); await linkTeacher(f);
  assert.equal((await api(f,'teacher','GET','/api/students/1/grades')).status,200);
  f.database.exec(sql);
  for (const path of ['/api/students/1','/api/students/1/grades','/api/students/1/subjects','/api/grades/1/history','/api/analytics/student-summary/1'])
    assert.equal((await api(f,'teacher','GET',path)).status,403,path);
  for (const path of ['/api/students?school_id=1','/api/grades?school_id=1','/api/student-subjects?school_id=1'])
    assert.deepEqual((await api(f,'teacher','GET',path)).body.data,[],path);
  assert.equal((await api(f,'teacher','GET','/api/analytics/overview?school_id=1')).body.data.total,0);
  assert.equal((await api(f,'teacher','PUT','/api/grades/1',{school_id:1,first_month:90})).status,403);
});

for (const bulk of [false,true]) test(`archived grade rejects ${bulk?'bulk':'single'} writes without any field or audit change`, async t=>{
  const f=createFixture(t);f.database.exec('UPDATE grades SET is_active=0 WHERE id=2');
  const snapshot=()=>JSON.stringify({grades:f.database.prepare('SELECT * FROM grades ORDER BY id').all(),audit:f.database.prepare('SELECT * FROM grade_change_logs').all()});
  const before=snapshot();
  const response=await api(f,'owner',bulk?'POST':'PUT',bulk?'/api/grades/bulk-entry':'/api/grades/2',bulk?{school_id:1,entries:[{grade_id:1,first_month:80},{grade_id:2,first_month:81}]}:{school_id:1,first_month:81,notes:'must not change'});
  assert.equal(response.status,403);assert.equal(snapshot(),before);
});

for (const bulk of [false,true]) test(`archival during ${bulk?'bulk':'single'} grade request cannot create a false audit`,async t=>{
  const f=createFixture(t);f.d1.beforeWrite=()=>f.database.exec('UPDATE grades SET is_active=0 WHERE id=1');
  const response=await api(f,'owner',bulk?'POST':'PUT',bulk?'/api/grades/bulk-entry':'/api/grades/1',bulk?{school_id:1,entries:[{grade_id:2,first_month:85},{grade_id:1,first_month:90}]}:{school_id:1,first_month:90});
  assert.equal(response.status,409);
  assert.equal(f.database.prepare('SELECT first_month FROM grades WHERE id=1').get().first_month,50);
  assert.equal(f.database.prepare('SELECT first_month FROM grades WHERE id=2').get().first_month,60);
  assert.equal(f.database.prepare('SELECT COUNT(*) n FROM grade_change_logs').get().n,0);
});

test('accountant has a minimal finance directory and finance routes, never academic analysis',async t=>{
  const f=createFixture(t);
  const directory=await api(f,'accountant','GET','/api/students?school_id=1');assert.equal(directory.status,200);
  assert.deepEqual(Object.keys(directory.body.data[0]).sort(),['id','school_id','student_number','full_name','class_id','section_id','class_name','section_name','status'].sort());
  for(const path of ['/api/students/1','/api/students/1/grades','/api/students/1/subjects','/api/grades?school_id=1','/api/analytics/student-summary/1','/api/analytics/overview?school_id=1'])
    assert.equal((await api(f,'accountant','GET',path)).status,403,path);
  for(const path of ['/api/dashboard/stats?school_id=1','/api/student-fees?school_id=1','/api/treasury/summary?school_id=1','/api/employees?school_id=1','/api/salaries?school_id=1'])
    assert.equal((await api(f,'accountant','GET',path)).status,200,path);
});
