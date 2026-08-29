import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  archiveStudentWithoutEnrollmentMutation,
  buildStudentPlacementUpdatePlan,
  createStudentWithEnrollmentBridge,
  getStudentWithEffectivePlacement,
  listStudentEnrollmentHistory,
  listStudentsWithEffectivePlacement,
  loadCurrentStudentEnrollmentContext,
  persistStudentImportWithEnrollmentBridge,
  updateStudentIdentityOnly,
  updateStudentPlacementAtomically,
} from '../src/lib/studentEnrollments.ts';
import {
  findStudentDuplicate,
  syncStudentImportState,
} from '../src/lib/studentImport.ts';
import { validateStudentReligion } from '../src/lib/studentReligion.ts';

const testDir = dirname(fileURLToPath(import.meta.url));
const rootDir = join(testDir, '..');
const initialSchema = readFileSync(join(rootDir, 'migrations', '0001_initial_schema.sql'), 'utf8');
const academicSchema = readFileSync(join(rootDir, 'migrations', '0002_phase2_academic_tables.sql'), 'utf8');
const academicYearIntegrity = readFileSync(join(rootDir, 'migrations', '0017_academic_year_integrity.sql'), 'utf8');
const enrollmentMigration = readFileSync(join(rootDir, 'migrations', '0020_student_enrollments.sql'), 'utf8');
const religionMigration = readFileSync(join(rootDir, 'migrations', '0021_student_religion.sql'), 'utf8');
const workerSource = readFileSync(join(rootDir, 'src', 'worker.ts'), 'utf8');

class LocalPreparedStatement {
  constructor(owner, sql, params = []) {
    this.owner = owner;
    this.sql = sql;
    this.params = params;
  }

  bind(...params) {
    return new LocalPreparedStatement(this.owner, this.sql, params);
  }

  first() {
    return this.owner.database.prepare(this.sql).get(...this.params) || null;
  }

  all() {
    return { results: this.owner.database.prepare(this.sql).all(...this.params) };
  }

  run() {
    const result = this.owner.database.prepare(this.sql).run(...this.params);
    return {
      success: true,
      meta: {
        changes: Number(result.changes),
        last_row_id: Number(result.lastInsertRowid),
      },
    };
  }
}

class LocalD1Adapter {
  constructor(database) {
    this.database = database;
    this.batchCalls = 0;
    this.failAtBatchStatement = null;
  }

  prepare(sql) {
    return new LocalPreparedStatement(this, sql);
  }

  batch(statements) {
    this.batchCalls += 1;
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map((statement, index) => {
        if (this.failAtBatchStatement === index) throw new Error('simulated enrollment batch failure');
        return statement.run();
      });
      this.database.exec('COMMIT');
      return results;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}

function insertId(database, sql, ...params) {
  return Number(database.prepare(`${sql} RETURNING id`).get(...params).id);
}

function createFixture() {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  database.exec(initialSchema);
  database.exec(academicSchema);
  database.exec(academicYearIntegrity);
  database.exec(enrollmentMigration);
  database.exec(religionMigration);
  database.exec(`
    INSERT INTO schools (id, name, school_type, city, status) VALUES
      (1, 'School A', 'private', 'Duhok', 'active'),
      (2, 'School B', 'private', 'Duhok', 'active');
  `);

  const yearA = insertId(database, `
    INSERT INTO academic_years (school_id, name, starts_at, ends_at, is_active)
    VALUES (1, '2026-2027', '2026-09-01', '2027-06-30', 1)
  `);
  const previousYearA = insertId(database, `
    INSERT INTO academic_years (school_id, name, starts_at, ends_at, is_active)
    VALUES (1, '2025-2026', '2025-09-01', '2026-06-30', 0)
  `);
  const yearB = insertId(database, `
    INSERT INTO academic_years (school_id, name, starts_at, ends_at, is_active)
    VALUES (2, '2026-2027', '2026-09-01', '2027-06-30', 1)
  `);

  const classA = insertId(database, `
    INSERT INTO classes (school_id, name, stage, status)
    VALUES (1, 'Class A1', 'primary', 'active')
  `);
  const classA2 = insertId(database, `
    INSERT INTO classes (school_id, name, stage, status)
    VALUES (1, 'Class A2', 'primary', 'active')
  `);
  const classB = insertId(database, `
    INSERT INTO classes (school_id, name, stage, status)
    VALUES (2, 'Class B1', 'primary', 'active')
  `);
  const sectionA = insertId(database, `
    INSERT INTO sections (school_id, class_id, name, status)
    VALUES (1, ?, 'Section A1', 'active')
  `, classA);
  const sectionA2 = insertId(database, `
    INSERT INTO sections (school_id, class_id, name, status)
    VALUES (1, ?, 'Section A2', 'active')
  `, classA2);
  const sectionB = insertId(database, `
    INSERT INTO sections (school_id, class_id, name, status)
    VALUES (2, ?, 'Section B1', 'active')
  `, classB);
  const userA = insertId(database, `
    INSERT INTO users (school_id, full_name, email, role_id, status)
    VALUES (1, 'Owner A', 'owner-a@example.test', 2, 'active')
  `);

  return {
    database,
    adapter: new LocalD1Adapter(database),
    ids: {
      yearA,
      previousYearA,
      yearB,
      classA,
      classA2,
      classB,
      sectionA,
      sectionA2,
      sectionB,
      userA,
    },
  };
}

function insertStudent(database, ids, overrides = {}) {
  return insertId(database, `
    INSERT INTO students (
      school_id, student_number, full_name, gender, class_id, section_id, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `,
  overrides.school_id ?? 1,
  overrides.student_number ?? `S-${crypto.randomUUID()}`,
  overrides.full_name ?? 'Bridge Student',
  overrides.gender ?? 'male',
  Object.hasOwn(overrides, 'class_id') ? overrides.class_id : ids.classA,
  Object.hasOwn(overrides, 'section_id') ? overrides.section_id : ids.sectionA,
  overrides.status ?? 'active');
}

function insertEnrollment(database, ids, studentId, overrides = {}) {
  return insertId(database, `
    INSERT INTO student_enrollments (
      school_id, student_id, academic_year_id, class_id, section_id,
      status, promotion_status, created_by_user_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `,
  overrides.school_id ?? 1,
  studentId,
  overrides.academic_year_id ?? ids.yearA,
  overrides.class_id ?? ids.classA,
  Object.hasOwn(overrides, 'section_id') ? overrides.section_id : ids.sectionA,
  overrides.status ?? 'active',
  overrides.promotion_status ?? 'pending',
  ids.userA);
}

function studentValues(ids, overrides = {}) {
  return {
    school_id: overrides.school_id ?? 1,
    student_number: overrides.student_number ?? `NEW-${crypto.randomUUID()}`,
    full_name: overrides.full_name ?? 'New Student',
    father_name: overrides.father_name ?? null,
    mother_name: overrides.mother_name ?? null,
    gender: overrides.gender ?? 'male',
    religion: Object.hasOwn(overrides, 'religion') ? overrides.religion : null,
    birth_date: overrides.birth_date ?? null,
    phone: overrides.phone ?? null,
    guardian_name: overrides.guardian_name ?? null,
    guardian_phone: overrides.guardian_phone ?? null,
    address: overrides.address ?? null,
    class_id: Object.hasOwn(overrides, 'class_id') ? overrides.class_id : ids.classA,
    section_id: Object.hasOwn(overrides, 'section_id') ? overrides.section_id : ids.sectionA,
    status: overrides.status ?? 'active',
    photo_url: overrides.photo_url ?? null,
    notes: overrides.notes ?? null,
  };
}

function valuesFromStudent(database, studentId, overrides = {}) {
  const student = database.prepare(`
    SELECT school_id, student_number, full_name, father_name, mother_name, gender,
           religion, birth_date, phone, guardian_name, guardian_phone, address, class_id,
           section_id, status, photo_url, notes
    FROM students WHERE id = ?
  `).get(studentId);
  return { ...student, ...overrides };
}

test('active year with enrollment returns enrollment placement and additive metadata', async () => {
  const { database, adapter, ids } = createFixture();
  const studentId = insertStudent(database, ids);
  const enrollmentId = insertEnrollment(database, ids, studentId, {
    class_id: ids.classA2,
    section_id: ids.sectionA2,
  });

  const student = await getStudentWithEffectivePlacement(adapter, studentId);
  assert.equal(student.class_id, ids.classA2);
  assert.equal(student.section_id, ids.sectionA2);
  assert.equal(student.class_name, 'Class A2');
  assert.equal(student.section_name, 'Section A2');
  assert.equal(student.current_enrollment_id, enrollmentId);
  assert.equal(student.current_academic_year_id, ids.yearA);
  assert.equal(student.current_academic_year_name, '2026-2027');
  assert.equal(student.current_enrollment_status, 'active');
  assert.equal(student.current_promotion_status, 'pending');
  database.close();
});

test('active year without enrollment returns null placement instead of stale legacy placement', async () => {
  const { database, adapter, ids } = createFixture();
  const studentId = insertStudent(database, ids);
  const student = await getStudentWithEffectivePlacement(adapter, studentId);
  assert.equal(student.class_id, null);
  assert.equal(student.section_id, null);
  assert.equal(student.class_name, null);
  assert.equal(student.section_name, null);
  assert.equal(student.current_enrollment_id, null);
  assert.equal(student.current_academic_year_id, ids.yearA);
  database.close();
});

test('school without an active year temporarily falls back to legacy placement', async () => {
  const { database, adapter, ids } = createFixture();
  const studentId = insertStudent(database, ids);
  database.prepare('UPDATE academic_years SET is_active = 0 WHERE school_id = 1').run();
  const student = await getStudentWithEffectivePlacement(adapter, studentId);
  assert.equal(student.class_id, ids.classA);
  assert.equal(student.section_id, ids.sectionA);
  assert.equal(student.class_name, 'Class A1');
  assert.equal(student.current_academic_year_id, null);
  database.close();
});

test('enrollment history is ordered by newest academic year first', async () => {
  const { database, adapter, ids } = createFixture();
  const studentId = insertStudent(database, ids);
  insertEnrollment(database, ids, studentId, { academic_year_id: ids.previousYearA });
  insertEnrollment(database, ids, studentId, {
    academic_year_id: ids.yearA,
    class_id: ids.classA2,
    section_id: ids.sectionA2,
  });
  const history = await listStudentEnrollmentHistory(adapter, 1, studentId);
  assert.deepEqual(history.map((row) => row.academic_year_name), ['2026-2027', '2025-2026']);
  assert.deepEqual(history.map((row) => row.class_name), ['Class A2', 'Class A1']);
  database.close();
});

test('history is school-scoped and the route requires explicit system-admin targeting', async () => {
  const { database, adapter, ids } = createFixture();
  const studentId = insertStudent(database, ids);
  insertEnrollment(database, ids, studentId);
  assert.deepEqual(await listStudentEnrollmentHistory(adapter, 2, studentId), []);

  const marker = "app.get('/api/students/:id/enrollments'";
  const route = workerSource.slice(workerSource.indexOf(marker), workerSource.indexOf(marker) + 2200);
  assert.match(route, /requireSameSchoolOrAdmin\(\)/);
  assert.match(route, /requireRoles\(ACADEMIC_ACCESS_ROLES\)/);
  assert.match(route, /resolvedSchoolId == null/);
  assert.match(route, /student\.school_id !== resolvedSchoolId/);
  assert.match(route, /سجل طالب في مدرسة أخرى/);
  database.close();
});

test('class and section filters use effective enrollment placement', async () => {
  const { database, adapter, ids } = createFixture();
  const studentId = insertStudent(database, ids);
  insertEnrollment(database, ids, studentId, {
    class_id: ids.classA2,
    section_id: ids.sectionA2,
  });
  assert.deepEqual((await listStudentsWithEffectivePlacement(adapter, { schoolId: 1, classId: ids.classA })).map(row => row.id), []);
  assert.deepEqual((await listStudentsWithEffectivePlacement(adapter, { schoolId: 1, classId: ids.classA2 })).map(row => row.id), [studentId]);
  assert.deepEqual((await listStudentsWithEffectivePlacement(adapter, { schoolId: 1, sectionId: ids.sectionA2 })).map(row => row.id), [studentId]);
  database.close();
});

test('creating a student without class succeeds without creating enrollment', async () => {
  const { database, adapter, ids } = createFixture();
  const creation = await createStudentWithEnrollmentBridge(adapter, studentValues(ids, {
    class_id: null,
    section_id: null,
  }), ids.userA);
  assert.equal(creation.ok, true);
  assert.equal(creation.student.class_id, null);
  assert.equal(Number(database.prepare('SELECT COUNT(*) AS count FROM student_enrollments').get().count), 0);
  database.close();
});

test('creating a placed student atomically creates matching active-year enrollment', async () => {
  const { database, adapter, ids } = createFixture();
  const creation = await createStudentWithEnrollmentBridge(adapter, studentValues(ids), ids.userA);
  assert.equal(creation.ok, true);
  const enrollment = database.prepare('SELECT * FROM student_enrollments WHERE student_id = ?').get(creation.student.id);
  assert.equal(Number(enrollment.academic_year_id), ids.yearA);
  assert.equal(Number(enrollment.class_id), ids.classA);
  assert.equal(Number(enrollment.section_id), ids.sectionA);
  assert.equal(enrollment.status, 'active');
  assert.equal(enrollment.promotion_status, 'pending');
  assert.equal(Number(enrollment.created_by_user_id), ids.userA);
  assert.equal(Number(creation.student.class_id), Number(enrollment.class_id));
  assert.equal(Number(creation.student.section_id), Number(enrollment.section_id));
  assert.equal(adapter.batchCalls, 1);
  database.close();
});

test('creating a placed student without active year fails without partial student', async () => {
  const { database, adapter, ids } = createFixture();
  database.prepare('UPDATE academic_years SET is_active = 0 WHERE school_id = 1').run();
  const creation = await createStudentWithEnrollmentBridge(adapter, studentValues(ids), ids.userA);
  assert.deepEqual(creation, { ok: false, code: 'active_year_required' });
  assert.equal(Number(database.prepare('SELECT COUNT(*) AS count FROM students').get().count), 0);
  assert.equal(Number(database.prepare('SELECT COUNT(*) AS count FROM student_enrollments').get().count), 0);
  database.close();
});

test('invalid section aborts placed-student creation without partial rows', async () => {
  const { database, adapter, ids } = createFixture();
  await assert.rejects(
    () => createStudentWithEnrollmentBridge(adapter, studentValues(ids, {
      class_id: ids.classA,
      section_id: ids.sectionA2,
    }), ids.userA),
    /section placement mismatch/,
  );
  assert.equal(Number(database.prepare('SELECT COUNT(*) AS count FROM students').get().count), 0);
  assert.equal(Number(database.prepare('SELECT COUNT(*) AS count FROM student_enrollments').get().count), 0);
  database.close();
});

test('identity-only student update leaves enrollment byte-for-byte unchanged', async () => {
  const { database, adapter, ids } = createFixture();
  const studentId = insertStudent(database, ids);
  const enrollmentId = insertEnrollment(database, ids, studentId);
  const before = database.prepare('SELECT * FROM student_enrollments WHERE id = ?').get(enrollmentId);
  const context = await loadCurrentStudentEnrollmentContext(adapter, 1, studentId);
  const plan = buildStudentPlacementUpdatePlan(
    { class_id: ids.classA, section_id: ids.sectionA },
    context,
    { hasClassId: false, hasSectionId: false, class_id: null, section_id: null },
  );
  assert.equal(plan.kind, 'identity_only');
  await updateStudentIdentityOnly(adapter, studentId, valuesFromStudent(database, studentId, {
    full_name: 'Updated Identity',
  }));
  assert.equal(database.prepare('SELECT full_name FROM students WHERE id = ?').get(studentId).full_name, 'Updated Identity');
  assert.deepEqual(database.prepare('SELECT * FROM student_enrollments WHERE id = ?').get(enrollmentId), before);
  database.close();
});

test('student religion migration keeps existing records null and restricts stored values', () => {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  database.exec(initialSchema);
  database.exec(academicSchema);
  database.exec("INSERT INTO schools (id, name, school_type, city, status) VALUES (1, 'School A', 'private', 'Duhok', 'active')");
  const studentId = insertId(database, `
    INSERT INTO students (school_id, student_number, full_name, gender, status)
    VALUES (1, 'REL-LEGACY', 'Legacy Religion Student', 'male', 'active')
  `);
  database.exec(religionMigration);

  assert.equal(database.prepare('SELECT religion FROM students WHERE id = ?').get(studentId).religion, null);
  assert.throws(
    () => database.prepare("UPDATE students SET religion = 'unsupported' WHERE id = ?").run(studentId),
    /CHECK constraint failed/,
  );
  assert.equal(database.prepare('SELECT religion FROM students WHERE id = ?').get(studentId).religion, null);
  database.close();
});

test('student creation persists each supported personal religion value', async () => {
  const { database, adapter, ids } = createFixture();
  for (const religion of ['muslim', 'christian', 'other']) {
    const creation = await createStudentWithEnrollmentBridge(adapter, studentValues(ids, {
      student_number: `REL-${religion}`,
      religion,
      class_id: null,
      section_id: null,
    }), ids.userA);
    assert.equal(creation.ok, true);
    assert.equal(creation.student.religion, religion);
    assert.equal(database.prepare('SELECT religion FROM students WHERE id = ?').get(creation.student.id).religion, religion);
  }
  database.close();
});

test('religion identity updates and clearing do not mutate enrollment placement', async () => {
  const { database, adapter, ids } = createFixture();
  const studentId = insertStudent(database, ids);
  const enrollmentId = insertEnrollment(database, ids, studentId);
  const beforeEnrollment = database.prepare('SELECT * FROM student_enrollments WHERE id = ?').get(enrollmentId);

  await updateStudentIdentityOnly(adapter, studentId, valuesFromStudent(database, studentId, { religion: 'christian' }));
  assert.equal(database.prepare('SELECT religion FROM students WHERE id = ?').get(studentId).religion, 'christian');
  assert.deepEqual(database.prepare('SELECT * FROM student_enrollments WHERE id = ?').get(enrollmentId), beforeEnrollment);

  await updateStudentIdentityOnly(adapter, studentId, valuesFromStudent(database, studentId, { religion: null }));
  assert.equal(database.prepare('SELECT religion FROM students WHERE id = ?').get(studentId).religion, null);
  assert.deepEqual(database.prepare('SELECT * FROM student_enrollments WHERE id = ?').get(enrollmentId), beforeEnrollment);
  database.close();
});

test('finalized enrollment still permits a religion-only identity update', async () => {
  const { database, adapter, ids } = createFixture();
  const studentId = insertStudent(database, ids);
  const enrollmentId = insertEnrollment(database, ids, studentId, {
    status: 'completed',
    promotion_status: 'promoted',
  });
  database.prepare('UPDATE student_enrollments SET completed_at = 123456 WHERE id = ?').run(enrollmentId);
  const beforeEnrollment = database.prepare('SELECT * FROM student_enrollments WHERE id = ?').get(enrollmentId);
  const context = await loadCurrentStudentEnrollmentContext(adapter, 1, studentId);
  const plan = buildStudentPlacementUpdatePlan(
    { class_id: ids.classA, section_id: ids.sectionA },
    context,
    { hasClassId: false, hasSectionId: false, class_id: null, section_id: null },
  );
  assert.equal(plan.kind, 'identity_only');

  await updateStudentIdentityOnly(adapter, studentId, valuesFromStudent(database, studentId, { religion: 'muslim' }));
  assert.equal(database.prepare('SELECT religion FROM students WHERE id = ?').get(studentId).religion, 'muslim');
  assert.deepEqual(database.prepare('SELECT * FROM student_enrollments WHERE id = ?').get(enrollmentId), beforeEnrollment);
  database.close();
});

test('Student API validates religion and keeps it outside placement and subject semantics', () => {
  const createRoute = workerSource.slice(
    workerSource.indexOf("app.post('/api/students'"),
    workerSource.indexOf("app.put('/api/students/:id'"),
  );
  const updateRoute = workerSource.slice(
    workerSource.indexOf("app.put('/api/students/:id'"),
    workerSource.indexOf("app.put('/api/students/:id/archive'"),
  );
  assert.match(createRoute, /validateStudentReligion\(religion\)/);
  assert.match(updateRoute, /validateStudentReligion\(body\.religion\)/);
  assert.match(createRoute, /قيمة الديانة غير صالحة/);
  assert.match(updateRoute, /قيمة الديانة غير صالحة/);
  assert.doesNotMatch(`${createRoute}\n${updateRoute}`, /student_subjects|subject_id|academic_year_id/);
  assert.deepEqual(validateStudentReligion(null), { ok: true, value: null });
  for (const religion of ['muslim', 'christian', 'other']) {
    assert.deepEqual(validateStudentReligion(religion), { ok: true, value: religion });
  }
  assert.deepEqual(validateStudentReligion('none'), { ok: false, value: null });
  assert.deepEqual(validateStudentReligion('free text'), { ok: false, value: null });
});

test('placement update synchronizes current enrollment and legacy mirror atomically', async () => {
  const { database, adapter, ids } = createFixture();
  const studentId = insertStudent(database, ids);
  insertEnrollment(database, ids, studentId);
  const context = await loadCurrentStudentEnrollmentContext(adapter, 1, studentId);
  const plan = buildStudentPlacementUpdatePlan(
    { class_id: ids.classA, section_id: ids.sectionA },
    context,
    { hasClassId: true, hasSectionId: true, class_id: ids.classA2, section_id: ids.sectionA2 },
  );
  assert.equal(plan.kind, 'write');
  await updateStudentPlacementAtomically(adapter, studentId, valuesFromStudent(database, studentId), plan, ids.userA);
  const student = database.prepare('SELECT class_id, section_id FROM students WHERE id = ?').get(studentId);
  const enrollment = database.prepare('SELECT class_id, section_id, updated_by_user_id FROM student_enrollments WHERE student_id = ?').get(studentId);
  assert.deepEqual([Number(student.class_id), Number(student.section_id)], [ids.classA2, ids.sectionA2]);
  assert.deepEqual([Number(enrollment.class_id), Number(enrollment.section_id)], [ids.classA2, ids.sectionA2]);
  assert.equal(Number(enrollment.updated_by_user_id), ids.userA);
  database.close();
});

test('an unplaced student receives a new active-year enrollment when class is assigned', async () => {
  const { database, adapter, ids } = createFixture();
  const studentId = insertStudent(database, ids, { class_id: null, section_id: null });
  const context = await loadCurrentStudentEnrollmentContext(adapter, 1, studentId);
  const plan = buildStudentPlacementUpdatePlan(
    { class_id: null, section_id: null },
    context,
    { hasClassId: true, hasSectionId: true, class_id: ids.classA2, section_id: ids.sectionA2 },
  );
  assert.equal(plan.kind, 'write');
  assert.equal(plan.enrollment, null);
  await updateStudentPlacementAtomically(adapter, studentId, valuesFromStudent(database, studentId), plan, ids.userA);
  const enrollment = database.prepare('SELECT * FROM student_enrollments WHERE student_id = ?').get(studentId);
  assert.equal(Number(enrollment.academic_year_id), ids.yearA);
  assert.equal(Number(enrollment.class_id), ids.classA2);
  assert.equal(Number(database.prepare('SELECT class_id FROM students WHERE id = ?').get(studentId).class_id), ids.classA2);
  database.close();
});

test('generic student update cannot clear an existing active-year enrollment', async () => {
  const { database, adapter, ids } = createFixture();
  const studentId = insertStudent(database, ids);
  insertEnrollment(database, ids, studentId);
  const context = await loadCurrentStudentEnrollmentContext(adapter, 1, studentId);
  const plan = buildStudentPlacementUpdatePlan(
    { class_id: ids.classA, section_id: ids.sectionA },
    context,
    { hasClassId: true, hasSectionId: true, class_id: null, section_id: null },
  );
  assert.deepEqual(plan, { kind: 'reject', code: 'cannot_clear_enrollment' });
  assert.equal(Number(database.prepare('SELECT class_id FROM students WHERE id = ?').get(studentId).class_id), ids.classA);
  assert.equal(Number(database.prepare('SELECT class_id FROM student_enrollments WHERE student_id = ?').get(studentId).class_id), ids.classA);
  database.close();
});

test('a section cannot be assigned without a class when no current enrollment exists', async () => {
  const { database, adapter, ids } = createFixture();
  const studentId = insertStudent(database, ids, { class_id: null, section_id: null });
  const context = await loadCurrentStudentEnrollmentContext(adapter, 1, studentId);
  const plan = buildStudentPlacementUpdatePlan(
    { class_id: null, section_id: null },
    context,
    { hasClassId: false, hasSectionId: true, class_id: null, section_id: ids.sectionA },
  );
  assert.deepEqual(plan, { kind: 'reject', code: 'class_required' });
  database.close();
});

test('placement change without active academic year is rejected', async () => {
  const { database, adapter, ids } = createFixture();
  const studentId = insertStudent(database, ids);
  database.prepare('UPDATE academic_years SET is_active = 0 WHERE school_id = 1').run();
  const context = await loadCurrentStudentEnrollmentContext(adapter, 1, studentId);
  const plan = buildStudentPlacementUpdatePlan(
    { class_id: ids.classA, section_id: ids.sectionA },
    context,
    { hasClassId: true, hasSectionId: true, class_id: ids.classA2, section_id: ids.sectionA2 },
  );
  assert.deepEqual(plan, { kind: 'reject', code: 'active_year_required' });
  database.close();
});

test('cross-school class and section writes fail without partial student updates', async () => {
  const { database, adapter, ids } = createFixture();
  const studentId = insertStudent(database, ids);
  insertEnrollment(database, ids, studentId);
  const context = await loadCurrentStudentEnrollmentContext(adapter, 1, studentId);
  const original = database.prepare('SELECT full_name, class_id, section_id FROM students WHERE id = ?').get(studentId);

  const crossSchoolClassPlan = buildStudentPlacementUpdatePlan(
    { class_id: ids.classA, section_id: ids.sectionA },
    context,
    { hasClassId: true, hasSectionId: true, class_id: ids.classB, section_id: ids.sectionB },
  );
  await assert.rejects(
    () => updateStudentPlacementAtomically(adapter, studentId, valuesFromStudent(database, studentId, {
      full_name: 'Must Roll Back',
    }), crossSchoolClassPlan, ids.userA),
    /class school mismatch/,
  );
  assert.deepEqual(database.prepare('SELECT full_name, class_id, section_id FROM students WHERE id = ?').get(studentId), original);

  const crossSchoolSectionPlan = buildStudentPlacementUpdatePlan(
    { class_id: ids.classA, section_id: ids.sectionA },
    context,
    { hasClassId: true, hasSectionId: true, class_id: ids.classA, section_id: ids.sectionB },
  );
  await assert.rejects(
    () => updateStudentPlacementAtomically(adapter, studentId, valuesFromStudent(database, studentId, {
      full_name: 'Must Also Roll Back',
    }), crossSchoolSectionPlan, ids.userA),
    /section placement mismatch/,
  );
  assert.deepEqual(database.prepare('SELECT full_name, class_id, section_id FROM students WHERE id = ?').get(studentId), original);
  database.close();
});

test('activating a different year without enrollment hides old legacy placement', async () => {
  const { database, adapter, ids } = createFixture();
  const studentId = insertStudent(database, ids);
  insertEnrollment(database, ids, studentId);
  const nextYearId = insertId(database, `
    INSERT INTO academic_years (school_id, name, starts_at, ends_at, is_active)
    VALUES (1, '2027-2028', '2027-09-01', '2028-06-30', 0)
  `);
  database.exec('BEGIN');
  database.prepare('UPDATE academic_years SET is_active = 0 WHERE school_id = 1').run();
  database.prepare('UPDATE academic_years SET is_active = 1 WHERE id = ?').run(nextYearId);
  database.exec('COMMIT');

  const student = await getStudentWithEffectivePlacement(adapter, studentId);
  assert.equal(student.current_academic_year_id, nextYearId);
  assert.equal(student.current_enrollment_id, null);
  assert.equal(student.class_id, null);
  assert.equal(student.section_id, null);
  assert.equal(Number(database.prepare('SELECT class_id FROM students WHERE id = ?').get(studentId).class_id), ids.classA);
  database.close();
});

test('archiving a student does not delete or rewrite enrollment lifecycle', async () => {
  const { database, adapter, ids } = createFixture();
  const studentId = insertStudent(database, ids);
  const enrollmentId = insertEnrollment(database, ids, studentId, {
    status: 'transferred',
    promotion_status: 'not_applicable',
  });
  const before = database.prepare('SELECT * FROM student_enrollments WHERE id = ?').get(enrollmentId);
  await archiveStudentWithoutEnrollmentMutation(adapter, studentId, 1);
  assert.equal(database.prepare('SELECT status FROM students WHERE id = ?').get(studentId).status, 'archived');
  assert.deepEqual(database.prepare('SELECT * FROM student_enrollments WHERE id = ?').get(enrollmentId), before);
  database.close();
});

test('a failed enrollment batch cannot leave partially created or updated student data', async () => {
  const { database, adapter, ids } = createFixture();
  adapter.failAtBatchStatement = 1;
  await assert.rejects(
    () => createStudentWithEnrollmentBridge(adapter, studentValues(ids, {
      student_number: 'ATOMIC-CREATE',
    }), ids.userA),
    /simulated enrollment batch failure/,
  );
  assert.equal(Number(database.prepare("SELECT COUNT(*) AS count FROM students WHERE student_number = 'ATOMIC-CREATE'").get().count), 0);

  adapter.failAtBatchStatement = null;
  const studentId = insertStudent(database, ids, { full_name: 'Original Name' });
  insertEnrollment(database, ids, studentId);
  const context = await loadCurrentStudentEnrollmentContext(adapter, 1, studentId);
  const plan = buildStudentPlacementUpdatePlan(
    { class_id: ids.classA, section_id: ids.sectionA },
    context,
    { hasClassId: true, hasSectionId: true, class_id: ids.classA2, section_id: ids.sectionA2 },
  );
  adapter.failAtBatchStatement = 1;
  await assert.rejects(
    () => updateStudentPlacementAtomically(adapter, studentId, valuesFromStudent(database, studentId, {
      full_name: 'Partially Updated Name',
    }), plan, ids.userA),
    /simulated enrollment batch failure/,
  );
  const student = database.prepare('SELECT full_name, class_id, section_id FROM students WHERE id = ?').get(studentId);
  assert.deepEqual({ ...student }, { full_name: 'Original Name', class_id: ids.classA, section_id: ids.sectionA });
  database.close();
});

test('Smart Excel creates a placed student with matching active-year enrollment and effective placement', async () => {
  const { database, adapter, ids } = createFixture();
  const result = await persistStudentImportWithEnrollmentBridge(adapter, {
    existingStudent: null,
    student: studentValues(ids, { student_number: 'EXCEL-CREATE' }),
    placement: {
      hasClassId: false,
      hasSectionId: false,
      class_id: ids.classA,
      section_id: ids.sectionA,
    },
    userId: ids.userA,
  });
  assert.equal(result.ok, true);
  assert.equal(result.action, 'created');
  const enrollment = database.prepare('SELECT * FROM student_enrollments WHERE student_id = ?').get(result.student.id);
  const legacy = database.prepare('SELECT class_id, section_id FROM students WHERE id = ?').get(result.student.id);
  assert.deepEqual([Number(legacy.class_id), Number(legacy.section_id)], [ids.classA, ids.sectionA]);
  assert.deepEqual([Number(enrollment.class_id), Number(enrollment.section_id)], [ids.classA, ids.sectionA]);
  assert.equal(Number(enrollment.created_by_user_id), ids.userA);
  assert.deepEqual([result.student.class_id, result.student.section_id], [ids.classA, ids.sectionA]);
  database.close();
});

test('Smart Excel enrollment failure rolls back the student create', async () => {
  const { database, adapter, ids } = createFixture();
  adapter.failAtBatchStatement = 1;
  await assert.rejects(
    () => persistStudentImportWithEnrollmentBridge(adapter, {
      existingStudent: null,
      student: studentValues(ids, { student_number: 'EXCEL-ROLLBACK' }),
      placement: {
        hasClassId: false,
        hasSectionId: false,
        class_id: ids.classA,
        section_id: ids.sectionA,
      },
      userId: ids.userA,
    }),
    /simulated enrollment batch failure/,
  );
  assert.equal(Number(database.prepare("SELECT COUNT(*) AS count FROM students WHERE student_number = 'EXCEL-ROLLBACK'").get().count), 0);
  assert.equal(Number(database.prepare('SELECT COUNT(*) AS count FROM student_enrollments').get().count), 0);
  database.close();
});

test('Smart Excel placement update synchronizes enrollment and legacy mirror', async () => {
  const { database, adapter, ids } = createFixture();
  const studentId = insertStudent(database, ids);
  insertEnrollment(database, ids, studentId);
  const existingStudent = await getStudentWithEffectivePlacement(adapter, studentId);
  const result = await persistStudentImportWithEnrollmentBridge(adapter, {
    existingStudent,
    student: valuesFromStudent(database, studentId, {
      class_id: ids.classA2,
      section_id: ids.sectionA2,
    }),
    placement: {
      hasClassId: true,
      hasSectionId: true,
      class_id: ids.classA2,
      section_id: ids.sectionA2,
    },
    userId: ids.userA,
  });
  assert.equal(result.ok, true);
  assert.equal(result.action, 'updated');
  const legacy = database.prepare('SELECT class_id, section_id FROM students WHERE id = ?').get(studentId);
  const enrollment = database.prepare('SELECT class_id, section_id FROM student_enrollments WHERE student_id = ?').get(studentId);
  assert.deepEqual([Number(legacy.class_id), Number(legacy.section_id)], [ids.classA2, ids.sectionA2]);
  assert.deepEqual([Number(enrollment.class_id), Number(enrollment.section_id)], [ids.classA2, ids.sectionA2]);
  assert.deepEqual([result.student.class_id, result.student.section_id], [ids.classA2, ids.sectionA2]);
  database.close();
});

test('Smart Excel creates the active-year enrollment when an existing student first receives placement', async () => {
  const { database, adapter, ids } = createFixture();
  const studentId = insertStudent(database, ids, { class_id: ids.classA, section_id: ids.sectionA });
  const existingStudent = await getStudentWithEffectivePlacement(adapter, studentId);
  assert.deepEqual([existingStudent.class_id, existingStudent.section_id], [null, null]);
  const result = await persistStudentImportWithEnrollmentBridge(adapter, {
    existingStudent,
    student: valuesFromStudent(database, studentId, {
      class_id: ids.classA2,
      section_id: ids.sectionA2,
    }),
    placement: {
      hasClassId: true,
      hasSectionId: true,
      class_id: ids.classA2,
      section_id: ids.sectionA2,
    },
    userId: ids.userA,
  });
  assert.equal(result.ok, true);
  const enrollment = database.prepare('SELECT class_id, section_id FROM student_enrollments WHERE student_id = ?').get(studentId);
  assert.deepEqual([Number(enrollment.class_id), Number(enrollment.section_id)], [ids.classA2, ids.sectionA2]);
  assert.deepEqual([result.student.class_id, result.student.section_id], [ids.classA2, ids.sectionA2]);
  database.close();
});

test('Smart Excel identity-only update preserves enrollment and does not copy stale legacy placement', async () => {
  const { database, adapter, ids } = createFixture();
  const studentId = insertStudent(database, ids, { class_id: ids.classA, section_id: ids.sectionA });
  const enrollmentId = insertEnrollment(database, ids, studentId, {
    class_id: ids.classA2,
    section_id: ids.sectionA2,
  });
  const beforeEnrollment = database.prepare('SELECT * FROM student_enrollments WHERE id = ?').get(enrollmentId);
  const existingStudent = await getStudentWithEffectivePlacement(adapter, studentId);
  const result = await persistStudentImportWithEnrollmentBridge(adapter, {
    existingStudent,
    student: valuesFromStudent(database, studentId, { full_name: 'Excel Identity Update' }),
    placement: {
      hasClassId: false,
      hasSectionId: false,
      class_id: ids.classA,
      section_id: ids.sectionA,
    },
    userId: ids.userA,
  });
  assert.equal(result.ok, true);
  assert.equal(database.prepare('SELECT full_name FROM students WHERE id = ?').get(studentId).full_name, 'Excel Identity Update');
  assert.deepEqual(database.prepare('SELECT * FROM student_enrollments WHERE id = ?').get(enrollmentId), beforeEnrollment);
  const legacy = database.prepare('SELECT class_id, section_id FROM students WHERE id = ?').get(studentId);
  assert.deepEqual([Number(legacy.class_id), Number(legacy.section_id)], [ids.classA, ids.sectionA]);
  assert.deepEqual([result.student.class_id, result.student.section_id], [ids.classA2, ids.sectionA2]);
  database.close();
});

test('Smart Excel duplicate matching ignores stale legacy placement when the active year has no enrollment', async () => {
  const { database, adapter, ids } = createFixture();
  const studentId = insertStudent(database, ids, {
    student_number: 'EXCEL-STALE',
    full_name: 'Excel Stale Placement',
    class_id: ids.classA,
    section_id: ids.sectionA,
  });
  const students = await listStudentsWithEffectivePlacement(adapter, { schoolId: 1 });
  assert.equal(students[0].id, studentId);
  assert.deepEqual([students[0].class_id, students[0].section_id], [null, null]);
  assert.equal(findStudentDuplicate({
    studentNumber: null,
    fullName: 'Excel Stale Placement',
    classId: ids.classA,
    sectionId: ids.sectionA,
  }, students).kind, 'none');
  assert.equal(findStudentDuplicate({
    studentNumber: null,
    fullName: 'Excel Stale Placement',
    classId: null,
    sectionId: null,
  }, students).kind, 'match');
  database.close();
});

test('Smart Excel placement-changing update without an active year fails without partial changes', async () => {
  const { database, adapter, ids } = createFixture();
  const studentId = insertStudent(database, ids, { full_name: 'Before Excel Update' });
  database.prepare('UPDATE academic_years SET is_active = 0 WHERE school_id = 1').run();
  const existingStudent = await getStudentWithEffectivePlacement(adapter, studentId);
  const result = await persistStudentImportWithEnrollmentBridge(adapter, {
    existingStudent,
    student: valuesFromStudent(database, studentId, {
      full_name: 'Must Not Persist',
      class_id: ids.classA2,
      section_id: ids.sectionA2,
    }),
    placement: {
      hasClassId: true,
      hasSectionId: true,
      class_id: ids.classA2,
      section_id: ids.sectionA2,
    },
    userId: ids.userA,
  });
  assert.deepEqual(result, { ok: false, code: 'active_year_required' });
  const student = database.prepare('SELECT full_name, class_id, section_id FROM students WHERE id = ?').get(studentId);
  assert.deepEqual({ ...student }, {
    full_name: 'Before Excel Update',
    class_id: ids.classA,
    section_id: ids.sectionA,
  });
  database.close();
});

test('Smart Excel invalid cross-school section fails atomically', async () => {
  const { database, adapter, ids } = createFixture();
  const studentId = insertStudent(database, ids, { full_name: 'Before Invalid Placement' });
  insertEnrollment(database, ids, studentId);
  const existingStudent = await getStudentWithEffectivePlacement(adapter, studentId);
  await assert.rejects(
    () => persistStudentImportWithEnrollmentBridge(adapter, {
      existingStudent,
      student: valuesFromStudent(database, studentId, {
        full_name: 'Must Roll Back',
        class_id: ids.classA,
        section_id: ids.sectionB,
      }),
      placement: {
        hasClassId: true,
        hasSectionId: true,
        class_id: ids.classA,
        section_id: ids.sectionB,
      },
      userId: ids.userA,
    }),
    /section placement mismatch/,
  );
  const student = database.prepare('SELECT full_name, class_id, section_id FROM students WHERE id = ?').get(studentId);
  assert.deepEqual({ ...student }, {
    full_name: 'Before Invalid Placement',
    class_id: ids.classA,
    section_id: ids.sectionA,
  });
  const enrollment = database.prepare('SELECT class_id, section_id FROM student_enrollments WHERE student_id = ?').get(studentId);
  assert.deepEqual([Number(enrollment.class_id), Number(enrollment.section_id)], [ids.classA, ids.sectionA]);
  database.close();
});

test('Smart Excel in-memory state exposes each persisted effective placement to subsequent rows', async () => {
  const { database, adapter, ids } = createFixture();
  const students = [];
  const studentMap = new Map();
  const creation = await persistStudentImportWithEnrollmentBridge(adapter, {
    existingStudent: null,
    student: studentValues(ids, {
      student_number: 'EXCEL-MAP',
      full_name: 'Excel Map Student',
    }),
    placement: {
      hasClassId: false,
      hasSectionId: false,
      class_id: ids.classA,
      section_id: ids.sectionA,
    },
    userId: ids.userA,
  });
  assert.equal(creation.ok, true);
  syncStudentImportState(students, studentMap, creation.student);
  const nextRowMatch = findStudentDuplicate({
    studentNumber: 'EXCEL-MAP',
    fullName: 'Excel Map Student',
    classId: ids.classA,
    sectionId: ids.sectionA,
  }, students);
  assert.equal(nextRowMatch.kind, 'match');

  const update = await persistStudentImportWithEnrollmentBridge(adapter, {
    existingStudent: nextRowMatch.student,
    student: valuesFromStudent(database, creation.student.id, {
      class_id: ids.classA2,
      section_id: ids.sectionA2,
    }),
    placement: {
      hasClassId: true,
      hasSectionId: true,
      class_id: ids.classA2,
      section_id: ids.sectionA2,
    },
    userId: ids.userA,
  });
  assert.equal(update.ok, true);
  syncStudentImportState(students, studentMap, update.student);
  assert.equal(students.length, 1);
  assert.deepEqual([studentMap.get('EXCEL-MAP').class_id, studentMap.get('EXCEL-MAP').section_id], [ids.classA2, ids.sectionA2]);
  database.close();
});

test('worker bridge uses effective reads, validates placement before writes and exposes no enrollment mutations', () => {
  const studentRoutes = workerSource.slice(
    workerSource.indexOf("app.get('/api/students'"),
    workerSource.indexOf('// API ROUTES: Subjects'),
  );
  assert.match(studentRoutes, /listStudentsWithEffectivePlacement/);
  assert.match(studentRoutes, /getStudentWithEffectivePlacement/);
  assert.match(studentRoutes, /createStudentWithEnrollmentBridge/);
  assert.match(studentRoutes, /buildStudentPlacementUpdatePlan/);
  assert.match(studentRoutes, /validateStudentPlacement[\s\S]*updateStudentPlacementAtomically/);
  assert.match(studentRoutes, /archiveStudentWithoutEnrollmentMutation/);
  assert.doesNotMatch(workerSource, /app\.(post|put|delete)\('\/api\/students\/:id\/enrollments/);

  const helperSource = readFileSync(join(rootDir, 'src', 'lib', 'studentEnrollments.ts'), 'utf8');
  assert.match(helperSource, /db\.batch\(\[/);
  assert.match(helperSource, /WHERE student\.school_id = \? AND student\.student_number = \?/);
  assert.doesNotMatch(helperSource, /MAX\s*\(\s*id\s*\)\s*\+\s*1/i);
});
