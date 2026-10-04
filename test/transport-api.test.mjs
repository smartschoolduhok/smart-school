import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import test, { after } from 'node:test';
import { createServer } from 'vite';
import { signJWT } from '../src/lib/jwtSecurity.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const migration = (name) => readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8');
const secret = 'transport-local-test-only-secret-with-adequate-entropy';
const vite = await createServer({ root, appType: 'custom', server: { middlewareMode: true, hmr: false } });
const { default: app } = await vite.ssrLoadModule('/src/worker.ts');
after(() => vite.close());

class Statement {
  constructor(db, sql, values = []) { this.db = db; this.sql = sql; this.values = values; }
  bind(...values) { return new Statement(this.db, this.sql, values); }
  async first() { return this.db.prepare(this.sql).get(...this.values) ?? null; }
  async all() { return { results: this.db.prepare(this.sql).all(...this.values), success: true }; }
  async run() {
    const result = this.db.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
  }
}
class LocalD1 {
  constructor(db) { this.db = db; }
  prepare(sql) { return new Statement(this.db, sql); }
  async batch(statements) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.db.exec('COMMIT');
      return results;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
}

async function fixture(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec('PRAGMA foreign_keys = ON');
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(file => file.endsWith('.sql')).sort()) db.exec(migration(file));
  db.exec(`
    INSERT INTO schools(id,name,school_type,city,status) VALUES (1,'مدرسة الاختبار','خاص','دهوك','active'),(2,'مدرسة ثانية','خاص','دهوك','active');
    INSERT INTO academic_years(id,school_id,name,starts_at,ends_at,is_active) VALUES
      (1,1,'2026-2027','2026-09-01','2027-06-30',1),(2,1,'2025-2026','2025-09-01','2026-06-30',0),(3,2,'2026-2027','2026-09-01','2027-06-30',1);
    INSERT INTO classes(id,school_id,name,stage,status) VALUES (1,1,'الأول','ابتدائي','active'),(2,2,'الأول','ابتدائي','active');
    INSERT INTO users(id,school_id,full_name,email,role_id,status,auth_version) VALUES
      (1,1,'مدير','owner@transport.test',2,'active',1),(2,NULL,'مسؤول','admin@transport.test',1,'active',1),
      (3,1,'مدرس','teacher@transport.test',5,'active',1),(4,1,'مسجل','registrar@transport.test',7,'active',1),
      (5,1,'ولي أمر','parent@transport.test',8,'active',1),(6,1,'محاسب','accountant@transport.test',6,'active',1);
    INSERT INTO residential_areas(id,school_id,name,name_key) VALUES (1,1,'الأندلس','الاندلس'),(2,2,'الزهور','الزهور');
    INSERT INTO transport_lines(id,school_id,name,name_key,driver_name,driver_phone) VALUES
      (1,1,'خط أحمد','خط احمد','أحمد','07701234567'),(2,1,'خط علي','خط علي','علي','07709876543'),(3,2,'خط مدرسة ثانية','خط مدرسة ثانية','خالد',NULL);
    INSERT INTO students(id,school_id,student_number,full_name,gender,class_id,status,guardian_phone,address,residential_area_id,
      transport_to_school,transport_from_school,transport_to_school_line_id) VALUES
      (1,1,'S1','أحمد الطالب','male',1,'active','07700000001','شارع أول',1,'school','family',1),
      (2,1,'S2','مريم الطالبة','female',1,'active','07700000002','شارع ثان',1,'private','school',NULL),
      (3,1,'S3','طالب سنة سابقة','male',1,'active',NULL,NULL,NULL,'unspecified','unspecified',NULL),
      (4,1,'S4','طالب مؤرشف','male',1,'archived',NULL,NULL,NULL,'unspecified','unspecified',NULL),
      (5,2,'S5','طالب مدرسة ثانية','male',2,'active',NULL,NULL,2,'school','family',3),
      (6,1,'S6','طالب منسحب','male',1,'active',NULL,NULL,NULL,'unspecified','unspecified',NULL),
      (7,1,'S7','طالب غير مسجل','male',1,'active',NULL,NULL,NULL,'unspecified','unspecified',NULL);
    UPDATE students SET transport_from_school_line_id=2,private_driver_name='سائق خاص',private_driver_phone='07701112222' WHERE id=2;
    INSERT INTO student_enrollments(school_id,student_id,academic_year_id,class_id,status) VALUES
      (1,1,1,1,'active'),(1,2,1,1,'active'),(1,3,2,1,'active'),(1,4,1,1,'active'),(2,5,3,2,'active'),(1,6,1,1,'withdrawn');
  `);
  const tokens = {};
  for (const role of ['owner', 'admin', 'teacher', 'registrar', 'parent', 'accountant']) {
    tokens[role] = await signJWT({ id: { owner: 1, admin: 2, teacher: 3, registrar: 4, parent: 5, accountant: 6 }[role], email: `${role}@transport.test`, auth_version: 1 }, secret);
  }
  return { db, tokens, env: { DB: new LocalD1(db), JWT_SECRET: secret, APP_ENV: 'test' } };
}

async function request(f, method, path, body, role = 'owner') {
  const response = await app.request(`http://localhost${path}`, { method,
    headers: { Authorization: `Bearer ${f.tokens[role]}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, f.env);
  return { status: response.status, body: await response.json() };
}
function succeeds(result, status = 200) { assert.equal(result.status, status, JSON.stringify(result.body)); return result.body.data; }

test('area and line CRUD is normalized, tenant scoped, and immediately reflected in profiles', async (t) => {
  const f = await fixture(t);
  const area = succeeds(await request(f, 'POST', '/api/transport/areas', { school_id: 1, name: '  حي   النور ' }), 201);
  assert.equal(area.name, 'حي النور');
  assert.equal((await request(f, 'POST', '/api/transport/areas', { school_id: 1, name: 'حي الـنُور' })).status, 409);
  const areas = succeeds(await request(f, 'GET', '/api/transport/areas?school_id=1'));
  assert.ok(areas.every((row) => row.school_id === 1));
  succeeds(await request(f, 'PUT', '/api/transport/areas/1', { school_id: 1, name: 'الأندلس الجديدة' }));
  const line = succeeds(await request(f, 'POST', '/api/transport/lines', { school_id: 1, name: 'خط سالم', driver_name: 'سالم', driver_phone: '07700123456' }), 201);
  assert.equal(line.driver_name, 'سالم');
  succeeds(await request(f, 'PUT', '/api/transport/lines/1', { school_id: 1, name: 'خط أحمد الجديد', driver_name: 'أحمد', driver_phone: '07700000009' }));
  const profile = succeeds(await request(f, 'GET', '/api/students/1'));
  assert.equal(profile.residential_area_name, 'الأندلس الجديدة');
  assert.equal(profile.transport_to_school_line_name, 'خط أحمد الجديد');
});

test('roster includes only this school active students with active current-year enrollment', async (t) => {
  const f = await fixture(t);
  const roster = succeeds(await request(f, 'GET', '/api/transport/roster?school_id=1'));
  assert.equal(roster.academic_year.id, 1);
  assert.equal(roster.school_name, 'مدرسة الاختبار');
  assert.deepEqual(roster.students.map((row) => row.id).sort(), [1, 2]);
  assert.equal(roster.students.find((row) => row.id === 2).private_driver_name, 'سائق خاص');
  f.db.exec('UPDATE academic_years SET is_active=0 WHERE school_id=1');
  const legacy = succeeds(await request(f, 'GET', '/api/transport/roster?school_id=1'));
  assert.equal(legacy.academic_year, null);
  assert.ok(legacy.students.some((row) => row.id === 7));
  assert.ok(legacy.students.every((row) => row.id !== 4 && row.id !== 5));
});

test('private outbound and family return save independently, clearing stale school line', async (t) => {
  const f = await fixture(t);
  succeeds(await request(f, 'PUT', '/api/students/1', { school_id: 1, transport_to_school: 'private',
    transport_from_school: 'family', private_driver_name: 'السائق الخاص', private_driver_phone: '07701112222',
    pickup_landmark: 'قرب الجامع', guardian_phone_secondary: '07703334444' }));
  const profile = succeeds(await request(f, 'GET', '/api/students/1'));
  assert.equal(profile.transport_to_school, 'private');
  assert.equal(profile.transport_to_school_line_id, null);
  assert.equal(profile.transport_from_school, 'family');
  assert.equal(profile.private_driver_name, 'السائق الخاص');
  assert.equal(profile.pickup_landmark, 'قرب الجامع');
  assert.equal(profile.guardian_phone_secondary, '07703334444');
  succeeds(await request(f, 'PUT', '/api/students/1', { school_id: 1, full_name: 'أحمد بعد التعديل' }));
  const after = succeeds(await request(f, 'GET', '/api/students/1'));
  assert.equal(after.transport_to_school, 'private');
  assert.equal(after.residential_area_id, 1);
  assert.equal(after.private_driver_phone, '07701112222');
});

test('new manual students require residence and guardian phone, legacy updates remain editable', async (t) => {
  const f = await fixture(t);
  const body = { school_id: 1, student_number: 'NEW', full_name: 'طالب جديد', gender: 'male', class_id: 1 };
  assert.equal((await request(f, 'POST', '/api/students', body)).status, 400);
  assert.equal((await request(f, 'POST', '/api/students', { ...body, residential_area_id: 1, guardian_phone: '  ' })).status, 400);
  const created = succeeds(await request(f, 'POST', '/api/students', { ...body, residential_area_id: 1,
    guardian_phone: '07709998888', transport_to_school: 'private', transport_from_school: 'family' }), 201);
  const profile = succeeds(await request(f, 'GET', `/api/students/${created.id}`));
  assert.equal(profile.transport_to_school, 'private');
  assert.equal(profile.transport_from_school, 'family');
  succeeds(await request(f, 'PUT', '/api/students/7', { school_id: 1, full_name: 'تصحيح اسم طالب قديم' }));
  succeeds(await request(f, 'PUT', '/api/students/4', { school_id: 1, guardian_phone: '07708888888', residential_area_id: 1, transport_to_school: 'family' }));
  assert.equal(f.db.prepare('SELECT status FROM students WHERE id=4').get().status, 'archived');
});

test('batch line assignment affects only requested direction and preserves private return details', async (t) => {
  const f = await fixture(t);
  succeeds(await request(f, 'PUT', '/api/transport/assign', { school_id: 1, student_ids: [1, 2], line_id: 2, direction: 'to_school' }));
  const rows = f.db.prepare('SELECT id,transport_to_school,transport_to_school_line_id,transport_from_school,transport_from_school_line_id FROM students WHERE id IN (1,2) ORDER BY id').all();
  assert.ok(rows.every((row) => row.transport_to_school === 'school' && row.transport_to_school_line_id === 2));
  assert.equal(rows[0].transport_from_school, 'family');
  assert.equal(rows[1].transport_from_school_line_id, 2);
  succeeds(await request(f, 'PUT', '/api/transport/assign', { school_id: 1, student_ids: [1], line_id: 1, direction: 'both' }));
  const row = f.db.prepare('SELECT transport_to_school_line_id,transport_from_school_line_id FROM students WHERE id=1').get();
  assert.equal(row.transport_to_school_line_id, 1);
  assert.equal(row.transport_from_school_line_id, 1);
});

test('mixed unauthorized or ineligible batch is rejected without partial assignment', async (t) => {
  const f = await fixture(t);
  for (const student_ids of [[1, 5], [1, 3], [1, 6], [1, 4], [1, 999]]) {
    const result = await request(f, 'PUT', '/api/transport/assign', { school_id: 1, student_ids, line_id: 2, direction: 'both' });
    assert.ok(result.status >= 400 && result.status < 500, JSON.stringify(result));
    assert.equal(f.db.prepare('SELECT transport_to_school_line_id FROM students WHERE id=1').get().transport_to_school_line_id, 1);
  }
  const huge = await request(f, 'PUT', '/api/transport/assign', { school_id: 1, student_ids: Array.from({ length: 101 }, (_, i) => i + 1), line_id: 2, direction: 'both' });
  assert.equal(huge.status, 400);
});

test('foreign areas/lines and invalid modes cannot enter a student record', async (t) => {
  const f = await fixture(t);
  for (const change of [{ residential_area_id: 2 }, { transport_to_school_line_id: 3 },
    { transport_to_school: 'teleport' }, { transport_to_school: null }, { residential_area_id: true }]) {
    const result = await request(f, 'PUT', '/api/students/1', { school_id: 1, ...change });
    assert.ok(result.status >= 400 && result.status < 500, JSON.stringify(result));
  }
  assert.equal(f.db.prepare('SELECT residential_area_id FROM students WHERE id=1').get().residential_area_id, 1);
  assert.throws(() => f.db.exec('UPDATE students SET residential_area_id=2 WHERE id=1'), /transport_area_school_mismatch/);
  assert.throws(() => f.db.exec('UPDATE students SET transport_to_school_line_id=3 WHERE id=1'), /transport_to_line_school_mismatch/);
});

test('the maximum 100-student assignment succeeds without exceeding per-statement bind limits', async (t) => {
  const f = await fixture(t);
  const ids = [];
  for (let id = 100; id < 200; id++) {
    f.db.prepare("INSERT INTO students(id,school_id,student_number,full_name,gender,status) VALUES (?,1,?,?,'male','active')").run(id, `B${id}`, `طالب ${id}`);
    f.db.prepare("INSERT INTO student_enrollments(school_id,student_id,academic_year_id,class_id,status) VALUES (1,?,1,1,'active')").run(id);
    ids.push(id);
  }
  const result = succeeds(await request(f, 'PUT', '/api/transport/assign', { school_id: 1, student_ids: ids, line_id: 1, direction: 'both' }));
  assert.equal(result.updated, 100);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM students WHERE id>=100 AND transport_to_school_line_id=1 AND transport_from_school_line_id=1').get().count, 100);
});

test('roster and writes enforce both roles and school targeting', async (t) => {
  const f = await fixture(t);
  for (const role of ['teacher', 'accountant', 'parent']) {
    assert.equal((await request(f, 'GET', '/api/transport/roster?school_id=1', undefined, role)).status, 403);
    assert.equal((await request(f, 'POST', '/api/transport/areas', { school_id: 1, name: 'حي ممنوع' }, role)).status, 403);
  }
  succeeds(await request(f, 'GET', '/api/transport/roster?school_id=1', undefined, 'registrar'));
  assert.equal((await request(f, 'GET', '/api/transport/roster?school_id=2')).status, 403);
  assert.equal((await request(f, 'PUT', '/api/transport/lines/3', { school_id: 1, name: 'خط آخر' })).status >= 400, true);
  const admin = succeeds(await request(f, 'GET', '/api/transport/roster?school_id=2', undefined, 'admin'));
  assert.deepEqual(admin.students.map((row) => row.id), [5]);
  const missingTarget = await request(f, 'GET', '/api/transport/roster', undefined, 'admin');
  assert.ok(missingTarget.status >= 400 && missingTarget.status < 500);
});
