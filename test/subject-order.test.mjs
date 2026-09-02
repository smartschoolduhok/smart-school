import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { hasRole, ACADEMIC_MANAGEMENT_ROLES } from '../src/lib/rbac.ts';
import { resolveRequiredWriteSchoolId } from '../src/lib/tenantSchool.ts';
import {
  buildAtomicSubjectOrderUpdateSql,
  buildCanonicalSubjectOrder,
  mergeReturnedSubjectOrder,
  moveOrderedItem,
  validateSubjectOrder,
} from '../src/lib/subjectOrdering.ts';

const testDir = dirname(fileURLToPath(import.meta.url));
const rootDir = join(testDir, '..');
const worker = readFileSync(join(rootDir, 'src', 'worker.ts'), 'utf8');
const subjectsPage = readFileSync(join(rootDir, 'src', 'modules', 'subjects', 'SubjectsPage.tsx'), 'utf8');
const api = readFileSync(join(rootDir, 'src', 'lib', 'api.ts'), 'utf8');

function routeBlock(start, end) {
  const startIndex = worker.indexOf(start);
  const endIndex = worker.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0 && endIndex > startIndex, `${start} route must exist`);
  return worker.slice(startIndex, endIndex);
}

function subject(id, schoolId = 1, classId = 10, status = 'active') {
  return { id, school_id: schoolId, class_id: classId, status };
}

function localSubjectDatabase() {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE subjects (
      id INTEGER PRIMARY KEY,
      school_id INTEGER NOT NULL,
      class_id INTEGER NOT NULL,
      order_index INTEGER NOT NULL,
      status TEXT NOT NULL,
      updated_at INTEGER
    );
    INSERT INTO subjects (id, school_id, class_id, order_index, status) VALUES
      (1, 1, 10, 8, 'active'),
      (2, 1, 10, 8, 'active'),
      (3, 1, 10, 2, 'active'),
      (4, 1, 10, 99, 'archived'),
      (5, 2, 10, 7, 'active'),
      (6, 1, 20, 6, 'active');
  `);
  return database;
}

test('reorder endpoint and role policy use ACADEMIC_MANAGEMENT_ROLES', () => {
  for (const role of ['system_admin', 'school_owner', 'principal', 'vice_principal', 'registrar']) {
    assert.equal(hasRole(role, ACADEMIC_MANAGEMENT_ROLES), true, role);
  }
  assert.equal(hasRole('teacher', ACADEMIC_MANAGEMENT_ROLES), false);
  const route = routeBlock("app.put('/api/subjects/reorder'", "app.put('/api/subjects/:id'");
  assert.match(route, /requireRoles\(ACADEMIC_MANAGEMENT_ROLES\)/);
});

test('system administrators must provide an explicit target school', () => {
  assert.deepEqual(resolveRequiredWriteSchoolId('system_admin', null, null), { ok: false, status: 400 });
  assert.deepEqual(resolveRequiredWriteSchoolId('system_admin', null, 1), { ok: true, schoolId: 1 });
  const route = routeBlock("app.put('/api/subjects/reorder'", "app.put('/api/subjects/:id'");
  assert.match(route, /resolveActiveWriteSchool\(db, user, body\.school_id\)/);
});

test('tenant-bound reorder requests remain fixed to the authenticated school', () => {
  assert.deepEqual(resolveRequiredWriteSchoolId('school_owner', 1, undefined), { ok: true, schoolId: 1 });
  assert.deepEqual(resolveRequiredWriteSchoolId('principal', 1, 2), { ok: false, status: 403 });
});

test('cross-school subject IDs are rejected', () => {
  assert.deepEqual(validateSubjectOrder([1, 2], [subject(1), subject(2, 2)], [1], 1, 10), {
    ok: false,
    code: 'cross_school',
  });
});

test('subjects from another class are rejected', () => {
  assert.deepEqual(validateSubjectOrder([1, 2], [subject(1), subject(2, 1, 20)], [1], 1, 10), {
    ok: false,
    code: 'wrong_class',
  });
});

test('duplicate and non-integer IDs are rejected', () => {
  assert.deepEqual(validateSubjectOrder([1, 1], [subject(1)], [1], 1, 10), { ok: false, code: 'duplicate_id' });
  assert.deepEqual(validateSubjectOrder([1, '2'], [subject(1)], [1], 1, 10), { ok: false, code: 'invalid_id' });
});

test('partial active-subject lists are rejected', () => {
  assert.deepEqual(validateSubjectOrder([2, 1], [subject(1), subject(2)], [1, 2, 3], 1, 10), {
    ok: false,
    code: 'partial_list',
  });
});

test('a complete valid list receives deterministic sequential order', () => {
  const records = [subject(1), subject(2), subject(3)];
  assert.deepEqual(validateSubjectOrder([3, 1, 2], records, [1, 2, 3], 1, 10), {
    ok: true,
    orderedIds: [3, 1, 2],
  });
  assert.deepEqual(buildCanonicalSubjectOrder([3, 1, 2]), [
    { id: 3, order_index: 1 },
    { id: 1, order_index: 2 },
    { id: 2, order_index: 3 },
  ]);
});

test('one atomic UPDATE persists 1..N and leaves inactive or foreign subjects unchanged', () => {
  const database = localSubjectDatabase();
  const result = database.prepare(buildAtomicSubjectOrderUpdateSql([3, 1, 2]))
    .run(1, 10, 1, 10, 3, 1, 10);
  assert.equal(result.changes, 3);
  const ordered = database.prepare(`SELECT id, order_index FROM subjects WHERE school_id = 1 AND class_id = 10 ORDER BY id`)
    .all()
    .map((row) => ({ ...row }));
  assert.deepEqual(ordered, [
    { id: 1, order_index: 2 },
    { id: 2, order_index: 3 },
    { id: 3, order_index: 1 },
    { id: 4, order_index: 99 },
  ]);
  assert.equal(database.prepare('SELECT order_index FROM subjects WHERE id = 5').get().order_index, 7);
});

test('exact-set guard performs zero partial writes when active subjects change', () => {
  const database = localSubjectDatabase();
  const before = database.prepare(`SELECT id, order_index FROM subjects WHERE school_id = 1 AND class_id = 10 ORDER BY id`).all();
  const result = database.prepare(buildAtomicSubjectOrderUpdateSql([3, 1]))
    .run(1, 10, 1, 10, 2, 1, 10);
  assert.equal(result.changes, 0);
  assert.deepEqual(database.prepare(`SELECT id, order_index FROM subjects WHERE school_id = 1 AND class_id = 10 ORDER BY id`).all(), before);
});

test('GET subjects uses order_index with subject id as the tie-breaker', () => {
  const route = routeBlock("app.get('/api/subjects'", "app.post('/api/subjects'");
  assert.match(route, /ORDER BY c\.order_index, sb\.order_index, sb\.id/);
});

test('student subject and grade lists use canonical subject order', () => {
  const activeSubjects = routeBlock("app.get('/api/students/:id/subjects'", "app.post('/api/student-subjects/assign-class'");
  const grades = routeBlock("app.get('/api/students/:id/grades'", "app.post('/api/grades/initialize-student/:student_id'");
  assert.match(activeSubjects, /ORDER BY su\.order_index, su\.id/);
  assert.match(grades, /ORDER BY s\.order_index, s\.id/);
  assert.doesNotMatch(grades, /ORDER BY s\.name/);
});

test('generic section-grade retrieval orders students deterministically then subjects canonically', () => {
  const route = routeBlock("app.get('/api/grades'", "app.get('/api/students/:id/grades'");
  assert.match(route, /ORDER BY st\.full_name, st\.id, s\.order_index, s\.id/);
  assert.doesNotMatch(route, /ORDER BY st\.full_name, s\.name/);
});

test('visible student analytics and subject blocker ties use canonical subject order', () => {
  const summary = routeBlock("app.get('/api/analytics/student-summary/:student_id'", '// Phase 6: Result Cards');
  assert.match(summary, /ORDER BY su\.order_index, su\.id/);
  assert.match(worker, /ORDER BY blocker_count DESC, su\.order_index, su\.id/);
});

test('current Result Card generation snapshots grades in canonical subject order', () => {
  const loaderStart = worker.indexOf('async function loadResultCardEvaluation');
  const loaderEnd = worker.indexOf('function resultCardEvaluationFailure', loaderStart);
  const loader = worker.slice(loaderStart, loaderEnd);
  assert.equal((loader.match(/ORDER BY su\.order_index, su\.id/g) || []).length, 2);

  const snapshotStart = worker.indexOf('async function buildResultCardSnapshot');
  const snapshotEnd = worker.indexOf('async function createResultCardForStudent', snapshotStart);
  const snapshot = worker.slice(snapshotStart, snapshotEnd);
  const createStart = snapshotEnd;
  const createEnd = worker.indexOf("// GET /api/result-cards", createStart);
  const create = worker.slice(createStart, createEnd);
  assert.match(snapshot, /subjects: evaluation\.grades/);
  assert.match(create, /JSON\.stringify\(cardData\)/);
});

test('previously issued Result Card snapshots are never mass-reordered', () => {
  assert.doesNotMatch(worker, /UPDATE result_cards SET card_data_json/);
  const readRoute = routeBlock("'/api/result-cards/:id'", "'/api/result-cards/generate-student/:student_id'");
  assert.match(readRoute, /JSON\.parse\(row\.card_data_json\)/);
});

test('Subjects UI exposes reorder controls only behind academic management permission and a school', () => {
  assert.match(subjectsPage, /canManage = hasRole\(user\?\.role_key, ACADEMIC_MANAGEMENT_ROLES\)/);
  assert.match(subjectsPage, /canManageSelectedSchool = canManage && schoolId != null/);
  assert.match(subjectsPage, /\{canManageSelectedSchool && \([\s\S]*?ترتيب المواد/);
  assert.match(subjectsPage, /classOrder\.get\(a\.class_id\)[\s\S]*?a\.order_index - b\.order_index[\s\S]*?a\.id - b\.id/);
  assert.doesNotMatch(subjectsPage, /form\.order_index/);
});

test('Subjects UI submits one complete reorder request and patches local state without reload', () => {
  const handlerStart = subjectsPage.indexOf('async function saveSubjectOrder');
  const handlerEnd = subjectsPage.indexOf('const sectionsForClass', handlerStart);
  const handler = subjectsPage.slice(handlerStart, handlerEnd);
  assert.equal((handler.match(/reorderSubjects\(/g) || []).length, 1);
  assert.match(handler, /orderedSubjects\.map\(\(subject\) => subject\.id\)/);
  assert.match(handler, /mergeReturnedSubjectOrder\(current, returned\)/);
  assert.doesNotMatch(handler, /loadData\(/);

  const moved = moveOrderedItem([{ id: 1 }, { id: 2 }, { id: 3 }], 3, 1);
  assert.deepEqual(moved.map((item) => item.id), [3, 1, 2]);
  const merged = mergeReturnedSubjectOrder([{ id: 1, name: 'A', order_index: 9 }], [{ id: 1, order_index: 1 }]);
  assert.deepEqual(merged, [{ id: 1, name: 'A', order_index: 1 }]);
});

test('new subjects append to the active class order while explicit import ordering remains supported', () => {
  const route = routeBlock("app.post('/api/subjects'", "app.put('/api/subjects/reorder'");
  assert.match(route, /COALESCE\(MAX\(order_index\), 0\) \+ 1/);
  assert.match(route, /explicitOrderIndex/);
  assert.doesNotMatch(subjectsPage, /order_index: Number\(form\.order_index\)/);
});

test('normal subject edits preserve order and class moves append unless an explicit order is supplied', () => {
  const route = routeBlock("app.put('/api/subjects/:id'", "app.put('/api/subjects/:id/archive'");
  assert.match(route, /SELECT school_id, class_id, order_index, status, religious_track FROM subjects/);
  assert.match(route, /let nextOrderIndex = explicitOrderIndex \?\? existing\.order_index/);
  assert.match(route, /nextClassId !== existing\.class_id/);
  assert.match(route, /COALESCE\(MAX\(order_index\), 0\) \+ 1 AS next_order_index/);
});

test('Excel subject import and export retain explicit order_index compatibility', () => {
  assert.match(worker, /d\.order_index \|\| 0/);
  assert.match(worker, /s\.order_index, s\.status/);
  assert.match(worker, /ORDER BY c\.order_index, c\.id, s\.order_index, s\.id/);
  assert.match(subjectsPage, /order_index: number/);
  assert.match(api, /ordered_subject_ids: orderedSubjectIds/);
});
