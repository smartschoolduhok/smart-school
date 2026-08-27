import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const testDir = dirname(fileURLToPath(import.meta.url));
const rootDir = join(testDir, '..');
const initialSchema = readFileSync(join(rootDir, 'migrations', '0001_initial_schema.sql'), 'utf8');
const academicSchema = readFileSync(join(rootDir, 'migrations', '0002_phase2_academic_tables.sql'), 'utf8');
const academicYearIntegrity = readFileSync(join(rootDir, 'migrations', '0017_academic_year_integrity.sql'), 'utf8');
const enrollmentMigration = readFileSync(join(rootDir, 'migrations', '0020_student_enrollments.sql'), 'utf8');

function insertId(database, sql, ...params) {
  return Number(database.prepare(`${sql} RETURNING id`).get(...params).id);
}

function createLegacyFixture({ applyEnrollment = true } = {}) {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  database.exec(initialSchema);
  database.exec(academicSchema);
  database.exec(academicYearIntegrity);

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
  const otherClassA = insertId(database, `
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
  const otherClassSectionA = insertId(database, `
    INSERT INTO sections (school_id, class_id, name, status)
    VALUES (1, ?, 'Section A2', 'active')
  `, otherClassA);
  const sectionB = insertId(database, `
    INSERT INTO sections (school_id, class_id, name, status)
    VALUES (2, ?, 'Section B1', 'active')
  `, classB);

  const legacyStudent = insertId(database, `
    INSERT INTO students (
      school_id, student_number, full_name, gender, class_id, section_id, status
    ) VALUES (1, 'A-001', 'Legacy Student', 'male', ?, ?, 'active')
  `, classA, sectionA);
  const noClassStudent = insertId(database, `
    INSERT INTO students (school_id, student_number, full_name, gender, status)
    VALUES (1, 'A-002', 'No Class Student', 'female', 'active')
  `);
  const manualStudent = insertId(database, `
    INSERT INTO students (school_id, student_number, full_name, gender, status)
    VALUES (1, 'A-003', 'Manual Student', 'male', 'active')
  `);
  const studentB = insertId(database, `
    INSERT INTO students (school_id, student_number, full_name, gender, status)
    VALUES (2, 'B-001', 'School B Student', 'female', 'active')
  `);

  const ids = {
    yearA,
    previousYearA,
    yearB,
    classA,
    otherClassA,
    classB,
    sectionA,
    otherClassSectionA,
    sectionB,
    legacyStudent,
    noClassStudent,
    manualStudent,
    studentB,
  };
  if (applyEnrollment) database.exec(enrollmentMigration);
  return { database, ids };
}

function insertEnrollment(database, {
  schoolId = 1,
  studentId,
  academicYearId,
  classId,
  sectionId = null,
}) {
  return insertId(database, `
    INSERT INTO student_enrollments (
      school_id, student_id, academic_year_id, class_id, section_id
    ) VALUES (?, ?, ?, ?, ?)
  `, schoolId, studentId, academicYearId, classId, sectionId);
}

test('migration creates the exact enrollment foundation, lifecycle checks, indexes and triggers', () => {
  const { database } = createLegacyFixture();
  const table = database.prepare(`
    SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'student_enrollments'
  `).get();
  assert.ok(table);
  for (const column of [
    'school_id',
    'student_id',
    'academic_year_id',
    'class_id',
    'section_id',
    'status',
    'promotion_status',
    'enrolled_at',
    'completed_at',
    'notes',
    'created_by_user_id',
    'updated_by_user_id',
    'created_at',
    'updated_at',
  ]) assert.match(table.sql, new RegExp(`\\b${column}\\b`));
  assert.match(table.sql, /status[\s\S]*?CHECK \(status IN \('active', 'completed', 'transferred', 'withdrawn', 'cancelled'\)\)/);
  assert.match(table.sql, /promotion_status[\s\S]*?CHECK \(promotion_status IN \('pending', 'promoted', 'repeated', 'graduated', 'not_applicable'\)\)/);
  assert.match(table.sql, /UNIQUE \(school_id, student_id, academic_year_id\)/);

  const foreignKeys = database.prepare('PRAGMA foreign_key_list(student_enrollments)').all();
  assert.equal(foreignKeys.length, 7);
  assert.deepEqual(
    Object.fromEntries(foreignKeys.map((foreignKey) => [foreignKey.from, {
      table: foreignKey.table,
      onDelete: foreignKey.on_delete,
    }])),
    {
      updated_by_user_id: { table: 'users', onDelete: 'SET NULL' },
      created_by_user_id: { table: 'users', onDelete: 'SET NULL' },
      section_id: { table: 'sections', onDelete: 'RESTRICT' },
      class_id: { table: 'classes', onDelete: 'RESTRICT' },
      academic_year_id: { table: 'academic_years', onDelete: 'RESTRICT' },
      student_id: { table: 'students', onDelete: 'CASCADE' },
      school_id: { table: 'schools', onDelete: 'CASCADE' },
    },
  );

  const indexes = new Set(database.prepare(`
    SELECT name FROM sqlite_schema
    WHERE type = 'index' AND tbl_name = 'student_enrollments'
  `).all().map((row) => row.name));
  for (const index of [
    'idx_student_enrollments_student_id',
    'idx_student_enrollments_academic_year_id',
    'idx_student_enrollments_school_year',
    'idx_student_enrollments_class_id',
    'idx_student_enrollments_section_id',
    'idx_student_enrollments_status',
  ]) assert.ok(indexes.has(index), index);
  assert.equal(indexes.has('idx_student_enrollments_school_id'), false);

  const triggers = new Set(database.prepare(`
    SELECT name FROM sqlite_schema
    WHERE type = 'trigger' AND tbl_name = 'student_enrollments'
  `).all().map((row) => row.name));
  assert.deepEqual(triggers, new Set([
    'trg_student_enrollments_validate_insert',
    'trg_student_enrollments_validate_update',
  ]));
  database.close();
});

test('one student/year enrollment succeeds and a duplicate in the same school fails', () => {
  const { database, ids } = createLegacyFixture();
  insertEnrollment(database, {
    studentId: ids.manualStudent,
    academicYearId: ids.yearA,
    classId: ids.classA,
    sectionId: ids.sectionA,
  });
  assert.throws(() => insertEnrollment(database, {
    studentId: ids.manualStudent,
    academicYearId: ids.yearA,
    classId: ids.otherClassA,
    sectionId: ids.otherClassSectionA,
  }), /UNIQUE constraint failed/);
  database.close();
});

test('the same student can enroll in a different academic year', () => {
  const { database, ids } = createLegacyFixture();
  insertEnrollment(database, {
    studentId: ids.manualStudent,
    academicYearId: ids.yearA,
    classId: ids.classA,
  });
  assert.doesNotThrow(() => insertEnrollment(database, {
    studentId: ids.manualStudent,
    academicYearId: ids.previousYearA,
    classId: ids.otherClassA,
  }));
  assert.equal(Number(database.prepare(`
    SELECT COUNT(*) AS count FROM student_enrollments WHERE student_id = ?
  `).get(ids.manualStudent).count), 2);
  database.close();
});

test('a school A student cannot use a school B academic year or class', () => {
  const { database, ids } = createLegacyFixture();
  assert.throws(() => insertEnrollment(database, {
    schoolId: 2,
    studentId: ids.manualStudent,
    academicYearId: ids.yearB,
    classId: ids.classB,
  }), /student school mismatch/);
  assert.throws(() => insertEnrollment(database, {
    studentId: ids.manualStudent,
    academicYearId: ids.yearB,
    classId: ids.classA,
  }), /academic year school mismatch/);
  assert.throws(() => insertEnrollment(database, {
    studentId: ids.manualStudent,
    academicYearId: ids.yearA,
    classId: ids.classB,
  }), /class school mismatch/);
  database.close();
});

test('a section must belong to the selected school and selected class', () => {
  const { database, ids } = createLegacyFixture();
  assert.throws(() => insertEnrollment(database, {
    studentId: ids.manualStudent,
    academicYearId: ids.yearA,
    classId: ids.classA,
    sectionId: ids.sectionB,
  }), /section placement mismatch/);
  assert.throws(() => insertEnrollment(database, {
    studentId: ids.manualStudent,
    academicYearId: ids.yearA,
    classId: ids.classA,
    sectionId: ids.otherClassSectionA,
  }), /section placement mismatch/);
  database.close();
});

test('section_id may be null', () => {
  const { database, ids } = createLegacyFixture();
  assert.doesNotThrow(() => insertEnrollment(database, {
    studentId: ids.manualStudent,
    academicYearId: ids.yearA,
    classId: ids.classA,
    sectionId: null,
  }));
  database.close();
});

test('relationship updates cannot introduce cross-school or cross-class placement', () => {
  const { database, ids } = createLegacyFixture();
  const enrollmentId = insertEnrollment(database, {
    studentId: ids.manualStudent,
    academicYearId: ids.yearA,
    classId: ids.classA,
    sectionId: ids.sectionA,
  });
  assert.throws(() => database.prepare(`
    UPDATE student_enrollments SET student_id = ? WHERE id = ?
  `).run(ids.studentB, enrollmentId), /student school mismatch/);
  assert.throws(() => database.prepare(`
    UPDATE student_enrollments SET academic_year_id = ? WHERE id = ?
  `).run(ids.yearB, enrollmentId), /academic year school mismatch/);
  assert.throws(() => database.prepare(`
    UPDATE student_enrollments SET class_id = ?, section_id = NULL WHERE id = ?
  `).run(ids.classB, enrollmentId), /class school mismatch/);
  assert.throws(() => database.prepare(`
    UPDATE student_enrollments SET section_id = ? WHERE id = ?
  `).run(ids.otherClassSectionA, enrollmentId), /section placement mismatch/);
  assert.equal(Number(database.prepare(`
    SELECT school_id FROM student_enrollments WHERE id = ?
  `).get(enrollmentId).school_id), 1);
  database.close();
});

test('enrollment and promotion lifecycle values remain separate canonical domains', () => {
  const { database, ids } = createLegacyFixture();
  const enrollmentId = insertEnrollment(database, {
    studentId: ids.manualStudent,
    academicYearId: ids.yearA,
    classId: ids.classA,
  });
  for (const status of ['active', 'completed', 'transferred', 'withdrawn', 'cancelled']) {
    assert.doesNotThrow(() => database.prepare(`
      UPDATE student_enrollments SET status = ? WHERE id = ?
    `).run(status, enrollmentId));
  }
  for (const promotionStatus of ['pending', 'promoted', 'repeated', 'graduated', 'not_applicable']) {
    assert.doesNotThrow(() => database.prepare(`
      UPDATE student_enrollments SET promotion_status = ? WHERE id = ?
    `).run(promotionStatus, enrollmentId));
  }
  assert.throws(() => database.prepare(`
    UPDATE student_enrollments SET status = 'ناجح' WHERE id = ?
  `).run(enrollmentId), /CHECK constraint failed/);
  assert.throws(() => database.prepare(`
    UPDATE student_enrollments SET promotion_status = 'passed' WHERE id = ?
  `).run(enrollmentId), /CHECK constraint failed/);
  database.close();
});

test('legacy backfill creates only the active-year enrollment for a placed student', () => {
  const { database, ids } = createLegacyFixture();
  const enrollment = database.prepare(`
    SELECT * FROM student_enrollments WHERE student_id = ?
  `).get(ids.legacyStudent);
  assert.equal(Number(enrollment.school_id), 1);
  assert.equal(Number(enrollment.academic_year_id), ids.yearA);
  assert.equal(Number(enrollment.class_id), ids.classA);
  assert.equal(Number(enrollment.section_id), ids.sectionA);
  assert.equal(enrollment.status, 'active');
  assert.equal(enrollment.promotion_status, 'pending');
  assert.equal(enrollment.created_by_user_id, null);
  assert.equal(Number(database.prepare(`
    SELECT COUNT(*) AS count
    FROM student_enrollments
    WHERE student_id = ? AND academic_year_id = ?
  `).get(ids.legacyStudent, ids.previousYearA).count), 0);
  database.close();
});

test('legacy student without a class is not backfilled', () => {
  const { database, ids } = createLegacyFixture();
  assert.equal(Number(database.prepare(`
    SELECT COUNT(*) AS count FROM student_enrollments WHERE student_id = ?
  `).get(ids.noClassStudent).count), 0);
  database.close();
});

test('legacy student is not backfilled when the school has no active academic year', () => {
  const { database, ids } = createLegacyFixture({ applyEnrollment: false });
  database.prepare('UPDATE academic_years SET is_active = 0 WHERE school_id = 1').run();
  database.exec(enrollmentMigration);
  assert.equal(Number(database.prepare(`
    SELECT COUNT(*) AS count FROM student_enrollments WHERE student_id = ?
  `).get(ids.legacyStudent).count), 0);
  database.close();
});

test('migration backfill does not modify legacy students, classes or sections', () => {
  const { database } = createLegacyFixture({ applyEnrollment: false });
  const before = Object.fromEntries(['students', 'classes', 'sections'].map((table) => [
    table,
    database.prepare(`SELECT * FROM ${table} ORDER BY id`).all(),
  ]));
  database.exec(enrollmentMigration);
  const after = Object.fromEntries(['students', 'classes', 'sections'].map((table) => [
    table,
    database.prepare(`SELECT * FROM ${table} ORDER BY id`).all(),
  ]));
  assert.deepEqual(after, before);
  database.close();
});

test('migration stays database-only and does not cut application modules over to enrollments', () => {
  for (const path of [
    'src/worker.ts',
    'src/modules/students/StudentsPage.tsx',
    'src/modules/grades/GradesPage.tsx',
    'src/modules/studentSubjects/StudentSubjectsPage.tsx',
    'src/modules/resultCards/ResultCardsPage.tsx',
  ]) {
    const source = readFileSync(join(rootDir, path), 'utf8');
    assert.doesNotMatch(source, /student_enrollments/);
  }
});
