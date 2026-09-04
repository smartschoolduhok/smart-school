import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import test, { after } from 'node:test';
import { createServer } from 'vite';
import { signJWT } from '../src/lib/jwtSecurity.ts';

const testDir = dirname(fileURLToPath(import.meta.url));
const rootDir = join(testDir, '..');
const migration = (name) => readFileSync(join(rootDir, 'migrations', name), 'utf8');
const subjectsPage = readFileSync(join(rootDir, 'src', 'modules', 'subjects', 'SubjectsPage.tsx'), 'utf8');
const apiSource = readFileSync(join(rootDir, 'src', 'lib', 'api.ts'), 'utf8');
const workerSource = readFileSync(join(rootDir, 'src', 'worker.ts'), 'utf8');
const secret = 'subject-management-phase-19a-test-secret';
const vite = await createServer({ root: rootDir, appType: 'custom', server: { middlewareMode: true } });
const { default: app } = await vite.ssrLoadModule('/src/worker.ts');
const {
  MAX_BULK_SUBJECT_CLASSES,
  buildBulkSubjectPlan,
  normalizeBulkSubjectName,
  validateBulkSubjectPayload,
} = await vite.ssrLoadModule('/src/lib/subjectBulk.ts');
after(async () => vite.close());

class LocalStatement {
  constructor(database, sql, values = []) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }
  bind(...values) { return new LocalStatement(this.database, this.sql, values); }
  async first() { return this.database.prepare(this.sql).get(...this.values) || null; }
  async all() { return { results: this.database.prepare(this.sql).all(...this.values), success: true, meta: {} }; }
  async run() {
    if (/\bRETURNING\b/i.test(this.sql)) {
      const results = this.database.prepare(this.sql).all(...this.values);
      const changes = Number(this.database.prepare('SELECT changes() AS count').get().count);
      return {
        success: true,
        results,
        meta: { changes, last_row_id: results.length ? Number(results.at(-1).id) : 0 },
      };
    }
    const result = this.database.prepare(this.sql).run(...this.values);
    return { success: true, results: [], meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid) } };
  }
}

class LocalD1 {
  constructor(database) { this.database = database; }
  prepare(sql) { return new LocalStatement(this.database, sql); }
  async batch(statements) {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec('COMMIT');
      return results;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}

async function createFixture() {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  for (const name of [
    '0001_initial_schema.sql',
    '0002_phase2_academic_tables.sql',
    '0003_student_subjects.sql',
    '0016_auth_security.sql',
    '0022_subject_religious_track.sql',
  ]) database.exec(migration(name));
  database.exec(`
    INSERT INTO schools (id, name, school_type, city, status) VALUES
      (1, 'School A', 'خاص', 'Duhok', 'active'),
      (2, 'School B', 'خاص', 'Duhok', 'active');
    INSERT INTO classes (id, school_id, name, stage, order_index, status) VALUES
      (1, 1, 'الأول', 'ابتدائي', 1, 'active'),
      (2, 1, 'الثاني', 'ابتدائي', 2, 'active'),
      (3, 1, 'الثالث', 'ابتدائي', 3, 'active'),
      (4, 1, 'المؤرشف', 'ابتدائي', 4, 'archived'),
      (5, 2, 'مدرسة أخرى', 'ابتدائي', 1, 'active');
    INSERT INTO users (id, school_id, full_name, email, role_id, status, auth_version) VALUES
      (1, 1, 'Owner A', 'owner-a@example.test', 2, 'active', 1),
      (2, NULL, 'System Admin', 'admin@example.test', 1, 'active', 1),
      (3, 1, 'Teacher A', 'teacher-a@example.test', 5, 'active', 1);
  `);
  const tokens = {
    owner: await signJWT({ email: 'owner-a@example.test', auth_version: 1 }, secret),
    admin: await signJWT({ email: 'admin@example.test', auth_version: 1 }, secret),
    teacher: await signJWT({ email: 'teacher-a@example.test', auth_version: 1 }, secret),
  };
  return { database, env: { DB: new LocalD1(database), JWT_SECRET: secret, APP_ENV: 'test' }, tokens };
}

async function request(fixture, token, endpoint, body) {
  return app.request(`http://localhost${endpoint}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, fixture.env);
}

function payload(overrides = {}) {
  return {
    school_id: 1,
    class_ids: [1, 2, 3],
    name: 'اللغة العربية',
    subject_type: 'أساسية',
    religious_track: null,
    counts_in_average: true,
    appears_in_report_card: true,
    passing_grade: 50,
    exemption_grade: 25,
    ...overrides,
  };
}

function subjectCount(database) {
  return Number(database.prepare('SELECT COUNT(*) AS count FROM subjects').get().count);
}

test('bulk name normalization trims and collapses whitespace without aggressive Arabic rewriting', () => {
  assert.equal(normalizeBulkSubjectName('  اللغة   العربية  '), 'اللغة العربية');
  assert.equal(normalizeBulkSubjectName('  English   Language '), 'english language');
  assert.notEqual(normalizeBulkSubjectName('التربية الاسلامية'), normalizeBulkSubjectName('التربية الإسلامية'));
});

test('bulk payload rejects empty, malformed, duplicate and oversized class lists', () => {
  assert.equal(validateBulkSubjectPayload(payload({ class_ids: [] })).code, 'invalid_classes');
  assert.equal(validateBulkSubjectPayload(payload({ class_ids: [1, '2'] })).code, 'invalid_classes');
  assert.equal(validateBulkSubjectPayload(payload({ class_ids: [1, 1] })).code, 'duplicate_class');
  assert.equal(
    validateBulkSubjectPayload(payload({ class_ids: Array.from({ length: MAX_BULK_SUBJECT_CLASSES + 1 }, (_, index) => index + 1) })).code,
    'too_many_classes',
  );
});

test('bulk payload rejects empty names, unsupported fields and invalid subject metadata', () => {
  assert.equal(validateBulkSubjectPayload(payload({ name: '   ' })).code, 'invalid_name');
  assert.equal(validateBulkSubjectPayload({ ...payload(), section_id: 1 }).code, 'unknown_field');
  assert.equal(validateBulkSubjectPayload(payload({ subject_type: 'ثانوية' })).code, 'invalid_type');
  assert.equal(validateBulkSubjectPayload(payload({ religious_track: 'invalid' })).code, 'invalid_religious_track');
  assert.equal(validateBulkSubjectPayload(payload({ passing_grade: 101 })).code, 'invalid_grade');
});

test('final bulk validation requires explicit true confirmation', () => {
  assert.equal(validateBulkSubjectPayload(payload(), { requireConfirmation: true }).code, 'confirmation_required');
  assert.equal(validateBulkSubjectPayload({ ...payload(), confirm_create: false }, { requireConfirmation: true }).code, 'confirmation_required');
  assert.equal(validateBulkSubjectPayload({ ...payload(), confirm_create: true }, { requireConfirmation: true }).ok, true);
});

test('pure planner classifies create, active duplicate, missing, inactive and cross-school safely', () => {
  const plan = buildBulkSubjectPlan(
    [1, 2, 3, 4, 5],
    1,
    normalizeBulkSubjectName('English'),
    [
      { id: 1, school_id: 1, name: 'One', status: 'active', order_index: 1 },
      { id: 2, school_id: 1, name: 'Two', status: 'active', order_index: 2 },
      { id: 4, school_id: 1, name: 'Four', status: 'archived', order_index: 4 },
      { id: 5, school_id: 2, name: 'Secret', status: 'active', order_index: 1 },
    ],
    [{ id: 9, class_id: 2, name: ' english ', status: 'active' }],
  );
  assert.deepEqual(plan.items.map((item) => item.status), ['create', 'already_exists', 'invalid', 'invalid', 'invalid']);
  assert.equal(plan.items[4].class_name, null);
  assert.equal(plan.can_create, false);
});

test('bulk preview classifies three valid classes and performs zero writes', async () => {
  const fixture = await createFixture();
  const response = await request(fixture, fixture.tokens.owner, '/api/subjects/bulk-preview', payload());
  assert.equal(response.status, 200);
  const result = (await response.json()).data;
  assert.equal(result.counts.create, 3);
  assert.equal(result.can_create, true);
  assert.equal(subjectCount(fixture.database), 0);
});

test('bulk create inserts one canonical all-sections subject in each of three classes', async () => {
  const fixture = await createFixture();
  const response = await request(fixture, fixture.tokens.owner, '/api/subjects/bulk', { ...payload(), confirm_create: true });
  assert.equal(response.status, 201);
  assert.equal(subjectCount(fixture.database), 3);
  assert.deepEqual(fixture.database.prepare('SELECT DISTINCT section_id FROM subjects').all().map((row) => row.section_id), [null]);
});

test('one active duplicate is skipped while two missing class subjects are created', async () => {
  const fixture = await createFixture();
  fixture.database.prepare("INSERT INTO subjects (school_id, class_id, name, status) VALUES (1, 2, 'اللغة العربية', 'active')").run();
  const response = await request(fixture, fixture.tokens.owner, '/api/subjects/bulk', { ...payload(), confirm_create: true });
  const result = (await response.json()).data;
  assert.equal(response.status, 201);
  assert.equal(result.counts.created, 2);
  assert.equal(result.counts.already_exists, 1);
  assert.equal(subjectCount(fixture.database), 3);
});

test('trimmed and repeated-whitespace duplicate names are skipped', async () => {
  const fixture = await createFixture();
  fixture.database.prepare("INSERT INTO subjects (school_id, class_id, name, status) VALUES (1, 1, '  اللغة   العربية ', 'active')").run();
  const response = await request(fixture, fixture.tokens.owner, '/api/subjects/bulk', {
    ...payload({ class_ids: [1], name: ' اللغة العربية ' }), confirm_create: true,
  });
  assert.equal(response.status, 200);
  assert.equal(subjectCount(fixture.database), 1);
});

test('English duplicate names are compared case-insensitively', async () => {
  const fixture = await createFixture();
  fixture.database.prepare("INSERT INTO subjects (school_id, class_id, name, status) VALUES (1, 1, 'ENGLISH', 'active')").run();
  const response = await request(fixture, fixture.tokens.owner, '/api/subjects/bulk', {
    ...payload({ class_ids: [1], name: 'english' }), confirm_create: true,
  });
  assert.equal(response.status, 200);
  assert.equal(subjectCount(fixture.database), 1);
});

test('all-active-duplicate submission succeeds with zero new rows', async () => {
  const fixture = await createFixture();
  for (const classId of [1, 2, 3]) fixture.database.prepare("INSERT INTO subjects (school_id, class_id, name, status) VALUES (1, ?, 'اللغة العربية', 'active')").run(classId);
  const response = await request(fixture, fixture.tokens.owner, '/api/subjects/bulk', { ...payload(), confirm_create: true });
  const result = (await response.json()).data;
  assert.equal(response.status, 200);
  assert.deepEqual(result.counts, { selected: 3, created: 0, already_exists: 3 });
  assert.equal(subjectCount(fixture.database), 3);
});

for (const [label, classIds, expectedStatus] of [
  ['inactive class', [1, 4], 400],
  ['nonexistent class', [1, 999], 404],
  ['cross-school class', [5], 403],
  ['mixed valid and cross-school classes', [1, 5], 403],
]) {
  test(`${label} rejects the whole write with zero inserts`, async () => {
    const fixture = await createFixture();
    const response = await request(fixture, fixture.tokens.owner, '/api/subjects/bulk', {
      ...payload({ class_ids: classIds }), confirm_create: true,
    });
    assert.equal(response.status, expectedStatus);
    assert.equal(subjectCount(fixture.database), 0);
  });
}

test('system administrator must supply an explicit active target school', async () => {
  const fixture = await createFixture();
  const response = await request(fixture, fixture.tokens.admin, '/api/subjects/bulk', {
    ...payload({ school_id: undefined }), confirm_create: true,
  });
  assert.equal(response.status, 400);
  assert.equal(subjectCount(fixture.database), 0);
});

test('tenant-bound management user cannot target another school', async () => {
  const fixture = await createFixture();
  const response = await request(fixture, fixture.tokens.owner, '/api/subjects/bulk', {
    ...payload({ school_id: 2, class_ids: [5] }), confirm_create: true,
  });
  assert.equal(response.status, 403);
  assert.equal(subjectCount(fixture.database), 0);
});

test('non-management teacher cannot preview or create subjects', async () => {
  const fixture = await createFixture();
  for (const endpoint of ['/api/subjects/bulk-preview', '/api/subjects/bulk']) {
    const response = await request(fixture, fixture.tokens.teacher, endpoint, {
      ...payload(), ...(endpoint.endsWith('/bulk') ? { confirm_create: true } : {}),
    });
    assert.equal(response.status, 403);
  }
  assert.equal(subjectCount(fixture.database), 0);
});

test('bulk metadata is copied exactly to each created subject', async () => {
  const fixture = await createFixture();
  const input = payload({
    class_ids: [1, 2],
    name: 'التربية الإسلامية',
    religious_track: 'islamic',
    counts_in_average: false,
    appears_in_report_card: false,
    passing_grade: 44,
    exemption_grade: 33,
  });
  const response = await request(fixture, fixture.tokens.owner, '/api/subjects/bulk', { ...input, confirm_create: true });
  assert.equal(response.status, 201);
  const rows = fixture.database.prepare(`
    SELECT religious_track, counts_in_average, appears_in_report_card, passing_grade, exemption_grade, section_id
    FROM subjects ORDER BY class_id
  `).all();
  assert.equal(rows.length, 2);
  for (const row of rows) assert.deepEqual({ ...row }, {
    religious_track: 'islamic', counts_in_average: 0, appears_in_report_card: 0,
    passing_grade: 44, exemption_grade: 33, section_id: null,
  });
});

test('each class receives its own next active order index', async () => {
  const fixture = await createFixture();
  fixture.database.exec(`
    INSERT INTO subjects (school_id, class_id, name, order_index, status) VALUES
      (1, 1, 'Old 1', 2, 'active'),
      (1, 1, 'Archived high', 99, 'archived'),
      (1, 2, 'Old 2', 7, 'active');
  `);
  const response = await request(fixture, fixture.tokens.owner, '/api/subjects/bulk', {
    ...payload({ class_ids: [1, 2, 3], name: 'New' }), confirm_create: true,
  });
  assert.equal(response.status, 201);
  assert.deepEqual(
    fixture.database.prepare("SELECT class_id, order_index FROM subjects WHERE name = 'New' ORDER BY class_id").all().map((row) => ({ ...row })),
    [{ class_id: 1, order_index: 3 }, { class_id: 2, order_index: 8 }, { class_id: 3, order_index: 1 }],
  );
});

test('an archived same-name subject does not block a new active subject', async () => {
  const fixture = await createFixture();
  fixture.database.prepare("INSERT INTO subjects (school_id, class_id, name, status) VALUES (1, 1, 'اللغة العربية', 'archived')").run();
  const response = await request(fixture, fixture.tokens.owner, '/api/subjects/bulk', {
    ...payload({ class_ids: [1] }), confirm_create: true,
  });
  assert.equal(response.status, 201);
  assert.equal(fixture.database.prepare("SELECT COUNT(*) AS count FROM subjects WHERE class_id = 1 AND status = 'active'").get().count, 1);
  assert.equal(subjectCount(fixture.database), 2);
});

test('final create independently rechecks duplicates introduced after preview', async () => {
  const fixture = await createFixture();
  const input = payload({ class_ids: [1] });
  const preview = await request(fixture, fixture.tokens.owner, '/api/subjects/bulk-preview', input);
  assert.equal((await preview.json()).data.counts.create, 1);
  fixture.database.prepare("INSERT INTO subjects (school_id, class_id, name, status) VALUES (1, 1, 'اللغة العربية', 'active')").run();
  const create = await request(fixture, fixture.tokens.owner, '/api/subjects/bulk', { ...input, confirm_create: true });
  assert.equal(create.status, 200);
  assert.equal((await create.json()).data.counts.already_exists, 1);
  assert.equal(subjectCount(fixture.database), 1);
});

test('final create rejects a class that became inactive after preview with zero inserts', async () => {
  const fixture = await createFixture();
  const input = payload({ class_ids: [1, 2] });
  const preview = await request(fixture, fixture.tokens.owner, '/api/subjects/bulk-preview', input);
  assert.equal(preview.status, 200);
  fixture.database.prepare("UPDATE classes SET status = 'archived' WHERE id = 2").run();
  const create = await request(fixture, fixture.tokens.owner, '/api/subjects/bulk', { ...input, confirm_create: true });
  assert.equal(create.status, 400);
  assert.equal(subjectCount(fixture.database), 0);
});

test('repeated confirmed submission creates no second active equivalent', async () => {
  const fixture = await createFixture();
  const input = { ...payload({ class_ids: [1] }), confirm_create: true };
  assert.equal((await request(fixture, fixture.tokens.owner, '/api/subjects/bulk', input)).status, 201);
  const repeated = await request(fixture, fixture.tokens.owner, '/api/subjects/bulk', input);
  assert.equal(repeated.status, 200);
  assert.equal((await repeated.json()).data.counts.already_exists, 1);
  assert.equal(subjectCount(fixture.database), 1);
});

test('bulk subject creation never creates student assignments or grades', async () => {
  const fixture = await createFixture();
  const response = await request(fixture, fixture.tokens.owner, '/api/subjects/bulk', {
    ...payload({ class_ids: [1], religious_track: 'christian' }), confirm_create: true,
  });
  assert.equal(response.status, 201);
  assert.equal(fixture.database.prepare('SELECT COUNT(*) AS count FROM student_subjects').get().count, 0);
  assert.equal(fixture.database.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'grades'").get(), undefined);
});

test('existing individual create, edit and archive endpoints remain operational', async () => {
  const fixture = await createFixture();
  const headers = { Authorization: `Bearer ${fixture.tokens.owner}`, 'Content-Type': 'application/json' };
  const create = await app.request('http://localhost/api/subjects', {
    method: 'POST', headers, body: JSON.stringify({ ...payload({ class_ids: undefined }), class_id: 1 }),
  }, fixture.env);
  assert.equal(create.status, 201);
  const id = (await create.json()).data.id;
  const update = await app.request(`http://localhost/api/subjects/${id}`, {
    method: 'PUT', headers, body: JSON.stringify({ ...payload({ class_ids: undefined, name: 'العربية' }), class_id: 1, status: 'active' }),
  }, fixture.env);
  assert.equal(update.status, 200);
  const archive = await app.request(`http://localhost/api/subjects/${id}/archive`, {
    method: 'PUT', headers, body: JSON.stringify({ school_id: 1 }),
  }, fixture.env);
  assert.equal(archive.status, 200);
  assert.equal(fixture.database.prepare('SELECT status FROM subjects WHERE id = ?').get(id).status, 'archived');
});

test('bulk endpoints use bounded queries and one D1 batch insert without N+1 writes', () => {
  const routeStart = workerSource.indexOf("app.post('/api/subjects/bulk'");
  const routeEnd = workerSource.indexOf("app.post('/api/subjects'", routeStart);
  const route = workerSource.slice(routeStart, routeEnd);
  assert.match(route, /loadBulkSubjectPlan/);
  assert.equal((route.match(/db\.batch/g) || []).length, 1);
  assert.match(route, /MAX\(subject_order\.order_index\)/);
  assert.match(route, /section_id IS NULL/);
});

test('typed API client exposes preview and confirmed-create helpers', () => {
  assert.match(apiSource, /export interface BulkSubjectRequest/);
  assert.match(apiSource, /export function previewBulkSubjects/);
  assert.match(apiSource, /export function createBulkSubjects/);
  assert.match(apiSource, /confirm_create: true/);
});

test('Subjects default UX renders active class cards instead of a global table', () => {
  assert.match(subjectsPage, /visibleClasses\.map\(\(classRecord\)/);
  assert.match(subjectsPage, /aria-label="الصفوف الدراسية"/);
  assert.match(subjectsPage, /!selectedClass[\s\S]*visibleClasses/);
  assert.match(subjectsPage, /classSubjects\.filter\(\(subject\) => subject\.status === 'active'\)/);
});

test('class subview scopes subjects and offers a visible back action', () => {
  assert.match(subjectsPage, /list = list\.filter\(\(s\) => s\.class_id === selectedClassId\)/);
  assert.match(subjectsPage, /مواد \{selectedClass\.name\}/);
  assert.match(subjectsPage, />العودة إلى الصفوف</);
  assert.match(subjectsPage, /function leaveClass\(\)/);
});

test('bulk modal renders active class checkboxes, select-all, clear-all and preview classifications', () => {
  assert.match(subjectsPage, /activeClasses\.map\(\(classRecord\)/);
  assert.match(subjectsPage, />تحديد الكل</);
  assert.match(subjectsPage, />إلغاء تحديد الكل</);
  assert.match(subjectsPage, /سيتم الإنشاء/);
  assert.match(subjectsPage, /موجود مسبقًا — تخطي/);
  assert.match(subjectsPage, /previewBulkSubjects\(payload\)/);
});

test('bulk success feedback includes created and skipped counts and refreshes data', () => {
  const start = subjectsPage.indexOf('async function handleBulkConfirm');
  const end = subjectsPage.indexOf('return (', start);
  const handler = subjectsPage.slice(start, end);
  assert.match(handler, /response\.data\.counts\.created/);
  assert.match(handler, /response\.data\.counts\.already_exists/);
  assert.match(handler, /setBulkSuccess/);
  assert.match(handler, /await loadData\(\)/);
});

test('individual creation from a selected class is pre-bound and cannot change class', () => {
  assert.match(subjectsPage, /class_id: selectedClassId/);
  assert.match(subjectsPage, /disabled=\{modalMode === 'create' && selectedClassId != null\}/);
  assert.match(subjectsPage, /إضافة مادة لهذا الصف/);
});
