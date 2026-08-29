import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  RELIGIOUS_SUBJECT_BULK_ERROR,
  RELIGIOUS_SUBJECT_HAS_GRADES_CODE,
  RELIGIOUS_TRACK_HEADER_ALIASES,
  countSubjectReligiousConversionConflicts,
  deactivateStudentSubjectAssignments,
  findActiveReligiousAssignment,
  hasRecordedReligiousSubjectGrades,
  importedStudentSubjectWillBeActive,
  isReligiousTrack,
  normalizeExcelReligiousTrack,
  preflightImportedReligiousAssignments,
  religiousTrackLabel,
  unwrapStudentSubjectImportRow,
  validateReligiousTrack,
} from '../src/lib/religiousSubjects.ts';

const testDir = dirname(fileURLToPath(import.meta.url));
const rootDir = join(testDir, '..');
const migration = (name) => readFileSync(join(rootDir, 'migrations', name), 'utf8');
const worker = readFileSync(join(rootDir, 'src', 'worker.ts'), 'utf8');
const subjectsPage = readFileSync(join(rootDir, 'src', 'modules', 'subjects', 'SubjectsPage.tsx'), 'utf8');
const studentSubjectsPage = readFileSync(join(rootDir, 'src', 'modules', 'studentSubjects', 'StudentSubjectsPage.tsx'), 'utf8');
const studentProfilePage = readFileSync(join(rootDir, 'src', 'modules', 'students', 'StudentProfilePage.tsx'), 'utf8');
const importExportPage = readFileSync(join(rootDir, 'src', 'modules', 'importExport', 'ImportExportPage.tsx'), 'utf8');
const api = readFileSync(join(rootDir, 'src', 'lib', 'api.ts'), 'utf8');

function routeBlock(start, end) {
  const startIndex = worker.indexOf(start);
  const endIndex = worker.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0 && endIndex > startIndex, `${start} route must exist`);
  return worker.slice(startIndex, endIndex);
}

class LocalStatement {
  constructor(database, sql, values = []) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }

  bind(...values) {
    return new LocalStatement(this.database, this.sql, values);
  }

  async first() {
    return this.database.prepare(this.sql).get(...this.values) || null;
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
  }
}

class LocalDatabase {
  constructor(database) {
    this.database = database;
  }

  prepare(sql) {
    return new LocalStatement(this.database, sql);
  }

  async batch(statements) {
    this.database.exec('BEGIN');
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

function insertId(database, sql, ...values) {
  return Number(database.prepare(`${sql} RETURNING id`).get(...values).id);
}

function createFixture() {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  database.exec(migration('0001_initial_schema.sql'));
  database.exec(migration('0002_phase2_academic_tables.sql'));
  database.exec(migration('0003_student_subjects.sql'));
  database.exec(migration('0004_phase4_grades.sql'));
  database.exec(migration('0018_flexible_grade_scheme.sql'));
  database.exec(migration('0021_student_religion.sql'));
  database.exec(`
    INSERT INTO schools (id, name, school_type, city, status) VALUES
      (1, 'School A', 'private', 'Duhok', 'active'),
      (2, 'School B', 'private', 'Duhok', 'active');
    INSERT INTO users (id, school_id, full_name, email, role_id, status)
      VALUES (1, 1, 'Manager A', 'manager-a@example.test', 2, 'active');
    INSERT INTO classes (id, school_id, name, stage, status) VALUES
      (1, 1, 'Class A1', 'primary', 'active'),
      (2, 1, 'Class A2', 'primary', 'active'),
      (3, 2, 'Class B1', 'primary', 'active');
    INSERT INTO sections (id, school_id, class_id, name, status) VALUES
      (1, 1, 1, 'A', 'active'),
      (2, 1, 1, 'B', 'active'),
      (3, 2, 3, 'A', 'active');
    INSERT INTO students (id, school_id, student_number, full_name, gender, religion, class_id, section_id, status) VALUES
      (1, 1, 'A-001', 'Student A1', 'male', 'muslim', 1, 1, 'active'),
      (2, 1, 'A-002', 'Student A2', 'female', 'christian', 1, 2, 'active'),
      (3, 2, 'B-001', 'Student B1', 'male', NULL, 3, 3, 'active');
    INSERT INTO subjects (id, school_id, class_id, section_id, name, subject_type, status) VALUES
      (1, 1, 1, NULL, 'Mathematics', 'أساسية', 'active'),
      (2, 1, 1, NULL, 'Science', 'اختيارية', 'active'),
      (3, 1, 1, NULL, 'Islamic Education', 'أساسية', 'active'),
      (4, 1, 1, NULL, 'Christian Education', 'اختيارية', 'active'),
      (5, 1, 1, NULL, 'Other Religion', 'أساسية', 'active'),
      (6, 2, 3, NULL, 'School B Religion', 'أساسية', 'active'),
      (7, 1, 2, NULL, 'Wrong Class Religion', 'أساسية', 'active'),
      (8, 1, 1, 1, 'Section A Religion', 'أساسية', 'active'),
      (9, 1, 1, 2, 'Section B Religion', 'أساسية', 'active');
  `);
  database.exec(migration('0022_subject_religious_track.sql'));
  database.exec(`
    UPDATE subjects SET religious_track = 'islamic' WHERE id IN (3, 8);
    UPDATE subjects SET religious_track = 'christian' WHERE id IN (4, 9);
    UPDATE subjects SET religious_track = 'other' WHERE id IN (5, 6, 7);
  `);
  return { database, db: new LocalDatabase(database) };
}

function assign(database, studentId, subjectId, active = 1) {
  const subject = database.prepare('SELECT school_id, class_id, section_id FROM subjects WHERE id = ?').get(subjectId);
  return insertId(database, `
    INSERT INTO student_subjects (
      school_id, student_id, subject_id, class_id, section_id, is_active,
      assigned_by_user_id, assigned_at
    ) VALUES (?, ?, ?, ?, ?, ?, 1, unixepoch())
  `, subject.school_id, studentId, subjectId, subject.class_id, subject.section_id, active);
}

test('migration adds nullable constrained religious_track without backfilling existing subjects', () => {
  const { database } = createFixture();
  assert.equal(database.prepare('SELECT religious_track FROM subjects WHERE id = 1').get().religious_track, null);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM subjects WHERE religious_track IS NULL").get().count, 2);
  assert.throws(() => database.exec("UPDATE subjects SET religious_track = 'unsupported' WHERE id = 1"), /CHECK constraint failed/);
  database.close();
});

test('migration accepts islamic, christian, other, and null while subject_type remains independent', () => {
  const { database } = createFixture();
  database.exec("UPDATE subjects SET subject_type = 'اختيارية', religious_track = 'islamic' WHERE id = 1");
  assert.deepEqual({ ...database.prepare('SELECT subject_type, religious_track FROM subjects WHERE id = 1').get() }, {
    subject_type: 'اختيارية',
    religious_track: 'islamic',
  });
  for (const value of ['christian', 'other', null]) {
    database.prepare('UPDATE subjects SET religious_track = ? WHERE id = 1').run(value);
    assert.equal(database.prepare('SELECT religious_track FROM subjects WHERE id = 1').get().religious_track, value);
  }
  database.close();
});

test('migration creates lookup index and all three assignment-integrity triggers', () => {
  const { database } = createFixture();
  const names = database.prepare("SELECT name FROM sqlite_schema WHERE type IN ('index', 'trigger')").all().map((row) => row.name);
  assert.ok(names.includes('idx_subjects_school_class_religious_track'));
  assert.ok(names.includes('trg_student_subjects_one_religious_insert'));
  assert.ok(names.includes('trg_student_subjects_one_religious_update'));
  assert.ok(names.includes('trg_subjects_religious_track_assignment_conflict'));
  database.close();
});

test('ordinary subjects coexist and one religious subject can coexist with them', () => {
  const { database } = createFixture();
  assign(database, 1, 1);
  assign(database, 1, 2);
  assign(database, 1, 3);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM student_subjects WHERE student_id = 1 AND is_active = 1').get().count, 3);
  database.close();
});

test('direct insert of a second active religious assignment is rejected by the database', () => {
  const { database } = createFixture();
  assign(database, 1, 3);
  assert.throws(() => assign(database, 1, 4), /student already has an active religious subject/);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM student_subjects WHERE student_id = 1 AND is_active = 1').get().count, 1);
  database.close();
});

test('reactivation and active subject_id changes cannot bypass the religious invariant', () => {
  const { database } = createFixture();
  const islamic = assign(database, 1, 3);
  const christian = assign(database, 1, 4, 0);
  const ordinary = assign(database, 1, 1);
  assert.throws(() => database.prepare('UPDATE student_subjects SET is_active = 1 WHERE id = ?').run(christian), /active religious subject/);
  assert.throws(() => database.prepare('UPDATE student_subjects SET subject_id = 4 WHERE id = ?').run(ordinary), /active religious subject/);
  assert.equal(database.prepare('SELECT is_active FROM student_subjects WHERE id = ?').get(christian).is_active, 0);
  assert.equal(database.prepare('SELECT subject_id FROM student_subjects WHERE id = ?').get(ordinary).subject_id, 1);
  assert.equal(database.prepare('SELECT is_active FROM student_subjects WHERE id = ?').get(islamic).is_active, 1);
  database.close();
});

test('converting a normal assigned subject to religious is rejected when students have another religious subject', async () => {
  const { database, db } = createFixture();
  assign(database, 1, 1);
  assign(database, 1, 3);
  assert.equal(await countSubjectReligiousConversionConflicts(db, 1, 1), 1);
  assert.throws(() => database.exec("UPDATE subjects SET religious_track = 'christian' WHERE id = 1"), /conversion conflicts/);
  assert.equal(database.prepare('SELECT religious_track FROM subjects WHERE id = 1').get().religious_track, null);
  database.close();
});

test('religious metadata can be added safely when no conflict and cleared without mutating assignments', () => {
  const { database } = createFixture();
  const assignmentId = assign(database, 2, 1);
  database.exec("UPDATE subjects SET religious_track = 'other' WHERE id = 1");
  assert.equal(database.prepare('SELECT religious_track FROM subjects WHERE id = 1').get().religious_track, 'other');
  database.exec('UPDATE subjects SET religious_track = NULL WHERE id = 1');
  assert.equal(database.prepare('SELECT religious_track FROM subjects WHERE id = 1').get().religious_track, null);
  assert.equal(database.prepare('SELECT is_active FROM student_subjects WHERE id = ?').get(assignmentId).is_active, 1);
  database.close();
});

test('domain validation and Arabic labels are canonical and personal religion is not consulted', () => {
  assert.deepEqual(validateReligiousTrack('islamic'), { ok: true, value: 'islamic' });
  assert.deepEqual(validateReligiousTrack('christian'), { ok: true, value: 'christian' });
  assert.deepEqual(validateReligiousTrack('other'), { ok: true, value: 'other' });
  assert.deepEqual(validateReligiousTrack(null), { ok: true, value: null });
  assert.deepEqual(validateReligiousTrack('muslim'), { ok: false, value: null });
  assert.equal(isReligiousTrack('islamic'), true);
  assert.equal(religiousTrackLabel('islamic'), 'إسلامية');
  assert.equal(religiousTrackLabel('christian'), 'مسيحية');
  assert.equal(religiousTrackLabel('other'), 'أخرى');
  assert.equal(religiousTrackLabel(null), 'ليست مادة ديانة');
});

test('active religious assignment helper returns only explicit active student_subject data', async () => {
  const { database, db } = createFixture();
  assign(database, 1, 1);
  const assignmentId = assign(database, 1, 3);
  assert.deepEqual({ ...await findActiveReligiousAssignment(db, 1, 1) }, {
    assignment_id: assignmentId,
    subject_id: 3,
    subject_name: 'Islamic Education',
    religious_track: 'islamic',
  });
  database.close();
});

test('blank grade row needs no confirmation but raw grades, notes, and grade logs do', async () => {
  const { database, db } = createFixture();
  const assignmentId = assign(database, 1, 3);
  const gradeId = insertId(database, 'INSERT INTO grades (school_id, student_subject_id) VALUES (1, ?)', assignmentId);
  assert.equal(await hasRecordedReligiousSubjectGrades(db, 1, assignmentId), false);
  database.prepare('UPDATE grades SET first_month = 80 WHERE id = ?').run(gradeId);
  assert.equal(await hasRecordedReligiousSubjectGrades(db, 1, assignmentId), true);
  database.prepare("UPDATE grades SET first_month = NULL, notes = 'Academic note' WHERE id = ?").run(gradeId);
  assert.equal(await hasRecordedReligiousSubjectGrades(db, 1, assignmentId), true);
  database.prepare('UPDATE grades SET notes = NULL WHERE id = ?').run(gradeId);
  database.prepare("INSERT INTO grade_change_logs (school_id, grade_id, field_name, new_value) VALUES (1, ?, 'first_month', '80')").run(gradeId);
  assert.equal(await hasRecordedReligiousSubjectGrades(db, 1, assignmentId), true);
  database.close();
});

test('Excel confirm preflight unwraps real nested preview rows and rejects two religious subjects before persistence', async () => {
  const { database, db } = createFixture();
  const rows = [
    { row_index: 2, data: { student_id: 1, subject_id: 3, is_active: true } },
    { row_index: 3, data: { student_id: 1, subject_id: 4, is_active: 1 } },
  ];
  assert.deepEqual(unwrapStudentSubjectImportRow(rows[0]), rows[0].data);
  const result = await preflightImportedReligiousAssignments(db, 1, rows);
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM student_subjects').get().count, 0);
  database.close();
});

test('Excel confirm preflight permits one religious plus ordinary and keeps same-subject duplicates for existing semantics', async () => {
  const { database, db } = createFixture();
  const mixed = await preflightImportedReligiousAssignments(db, 1, [
    { row_index: 2, data: { student_id: 1, subject_id: 3, is_active: 'true' } },
    { row_index: 3, data: { student_id: 1, subject_id: 1, is_active: '1' } },
  ]);
  assert.equal(mixed.ok, true);
  assert.deepEqual(mixed.religious_rows, [{ student_id: 1, subject_id: 3 }]);

  const duplicate = await preflightImportedReligiousAssignments(db, 1, [
    { row_index: 2, data: { student_id: 1, subject_id: 3, is_active: true } },
    { row_index: 3, data: { student_id: 1, subject_id: 3, is_active: true } },
  ]);
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.religious_rows.length, 2);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM student_subjects').get().count, 0);
  database.close();
});

test('Excel confirm preflight supports direct rows and normalizes boolean, numeric, and string inactive values', async () => {
  const { database, db } = createFixture();
  for (const value of [false, 0, '0', 'false', 'no', 'لا', 'غير مفعل']) {
    assert.equal(importedStudentSubjectWillBeActive(value), false);
  }
  for (const value of [true, 1, '1', 'true', 'yes', null, undefined, 'unknown']) {
    assert.equal(importedStudentSubjectWillBeActive(value), true);
  }
  const directConflict = await preflightImportedReligiousAssignments(db, 1, [
    { student_id: 1, subject_id: 3, is_active: 'yes' },
    { student_id: 1, subject_id: 4, is_active: true },
  ]);
  assert.equal(directConflict.ok, false);
  assert.equal(directConflict.status, 409);
  database.close();
});

test('generic deactivate keeps ordinary grade behavior and permits religious assignments without meaningful grades', async () => {
  const { database, db } = createFixture();
  const ordinaryAssignment = assign(database, 1, 1);
  const ordinaryGrade = insertId(database, 'INSERT INTO grades (school_id, student_subject_id, first_month) VALUES (1, ?, 88)', ordinaryAssignment);
  const ordinaryResult = await deactivateStudentSubjectAssignments(db, 1, [ordinaryAssignment]);
  assert.deepEqual(ordinaryResult, { ok: true, affected: 1 });
  assert.equal(database.prepare('SELECT is_active FROM student_subjects WHERE id = ?').get(ordinaryAssignment).is_active, 0);
  assert.equal(database.prepare('SELECT first_month FROM grades WHERE id = ?').get(ordinaryGrade).first_month, 88);

  const religiousWithoutGrade = assign(database, 2, 4);
  const noGradeResult = await deactivateStudentSubjectAssignments(db, 1, [religiousWithoutGrade]);
  assert.deepEqual(noGradeResult, { ok: true, affected: 1 });

  const religiousWithBlankGrade = assign(database, 1, 3);
  const blankGrade = insertId(database, 'INSERT INTO grades (school_id, student_subject_id) VALUES (1, ?)', religiousWithBlankGrade);
  const blankResult = await deactivateStudentSubjectAssignments(db, 1, [religiousWithBlankGrade]);
  assert.deepEqual(blankResult, { ok: true, affected: 1 });
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM grades WHERE id = ?').get(blankGrade).count, 1);
  database.close();
});

test('religious assignment with a raw grade is guarded and leaves assignment and grade untouched', async () => {
  const { database, db } = createFixture();
  const assignmentId = assign(database, 1, 3);
  const gradeId = insertId(database, 'INSERT INTO grades (school_id, student_subject_id, first_month) VALUES (1, ?, 91)', assignmentId);
  const result = await deactivateStudentSubjectAssignments(db, 1, [assignmentId]);
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.equal(result.code, RELIGIOUS_SUBJECT_HAS_GRADES_CODE);
  assert.equal(database.prepare('SELECT is_active FROM student_subjects WHERE id = ?').get(assignmentId).is_active, 1);
  assert.equal(database.prepare('SELECT first_month FROM grades WHERE id = ?').get(gradeId).first_month, 91);
  database.close();
});

test('religious assignment with academic notes is guarded and preserves the grade row', async () => {
  const { database, db } = createFixture();
  const assignmentId = assign(database, 1, 3);
  const gradeId = insertId(database, "INSERT INTO grades (school_id, student_subject_id, notes) VALUES (1, ?, 'Keep this note')", assignmentId);
  const result = await deactivateStudentSubjectAssignments(db, 1, [assignmentId]);
  assert.equal(result.ok, false);
  assert.equal(result.code, RELIGIOUS_SUBJECT_HAS_GRADES_CODE);
  assert.equal(database.prepare('SELECT is_active FROM student_subjects WHERE id = ?').get(assignmentId).is_active, 1);
  assert.equal(database.prepare('SELECT notes FROM grades WHERE id = ?').get(gradeId).notes, 'Keep this note');
  database.close();
});

test('religious assignment with a grade change log is guarded and preserves both grade and log', async () => {
  const { database, db } = createFixture();
  const assignmentId = assign(database, 1, 3);
  const gradeId = insertId(database, 'INSERT INTO grades (school_id, student_subject_id) VALUES (1, ?)', assignmentId);
  const logId = insertId(database, "INSERT INTO grade_change_logs (school_id, grade_id, field_name, new_value) VALUES (1, ?, 'first_month', '75')", gradeId);
  const result = await deactivateStudentSubjectAssignments(db, 1, [assignmentId]);
  assert.equal(result.ok, false);
  assert.equal(result.code, RELIGIOUS_SUBJECT_HAS_GRADES_CODE);
  assert.equal(database.prepare('SELECT is_active FROM student_subjects WHERE id = ?').get(assignmentId).is_active, 1);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM grades WHERE id = ?').get(gradeId).count, 1);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM grade_change_logs WHERE id = ?').get(logId).count, 1);
  database.close();
});

test('bulk deactivate preflights every assignment and writes nothing when one religious grade conflict exists', async () => {
  const { database, db } = createFixture();
  const ordinaryAssignment = assign(database, 1, 1);
  const religiousAssignment = assign(database, 1, 3);
  insertId(database, 'INSERT INTO grades (school_id, student_subject_id, first_month) VALUES (1, ?, 77)', religiousAssignment);
  const result = await deactivateStudentSubjectAssignments(db, 1, [ordinaryAssignment, religiousAssignment]);
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.equal(database.prepare('SELECT is_active FROM student_subjects WHERE id = ?').get(ordinaryAssignment).is_active, 1);
  assert.equal(database.prepare('SELECT is_active FROM student_subjects WHERE id = ?').get(religiousAssignment).is_active, 1);
  database.close();
});

test('safe bulk deactivate succeeds in one batch after all assignments pass preflight', async () => {
  const { database, db } = createFixture();
  const ordinaryAssignment = assign(database, 1, 1);
  const religiousAssignment = assign(database, 1, 3);
  const result = await deactivateStudentSubjectAssignments(db, 1, [ordinaryAssignment, religiousAssignment]);
  assert.deepEqual(result, { ok: true, affected: 2 });
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM student_subjects WHERE id IN (?, ?) AND is_active = 1').get(ordinaryAssignment, religiousAssignment).count, 0);
  database.close();
});

test('subject APIs validate religious_track and preflight conversion conflicts', () => {
  const createRoute = routeBlock("app.post('/api/subjects'", "app.put('/api/subjects/reorder'");
  const updateRoute = routeBlock("app.put('/api/subjects/:id'", "app.put('/api/subjects/:id/archive'");
  assert.match(createRoute, /validateReligiousTrack\(religious_track\)/);
  assert.match(createRoute, /نوع مادة الديانة غير صالح/);
  assert.match(updateRoute, /hasOwnProperty\.call\(body, 'religious_track'\)/);
  assert.match(updateRoute, /countSubjectReligiousConversionConflicts/);
  assert.match(updateRoute, /conflicting_students_count/);
  assert.match(updateRoute, /}, 409\)/);
});

test('class and section bulk routes reject religious subjects while ordinary assignment loops remain', () => {
  const classRoute = routeBlock("app.post('/api/student-subjects/assign-class'", "app.post('/api/student-subjects/assign-section'");
  const sectionRoute = routeBlock("app.post('/api/student-subjects/assign-section'", "app.post('/api/student-subjects/assign-students'");
  for (const route of [classRoute, sectionRoute]) {
    assert.match(route, /religious_track/);
    assert.ok(route.includes('RELIGIOUS_SUBJECT_BULK_ERROR'));
    assert.match(route, /INSERT INTO student_subjects/);
  }
  assert.equal(RELIGIOUS_SUBJECT_BULK_ERROR, 'مواد الديانة يجب تعيينها لطلاب محددين، وليس للصف أو الشعبة بالكامل.');
});

test('assign-students preflights all students and permits at most one religious subject before writes', () => {
  const route = routeBlock("app.post('/api/student-subjects/assign-students'", "app.post('/api/student-subjects/assign-one'");
  assert.match(route, /requestedReligiousSubjects\.length > 1/);
  assert.match(route, /validateStudentSubjectAssignment/);
  assert.match(route, /findActiveReligiousAssignment/);
  assert.ok(route.indexOf('requestedReligiousSubjects.length > 1') < route.indexOf('INSERT INTO student_subjects'));
  assert.match(route, /}, 409\)/);
});

test('assign-one and reactivate preflight a conflicting active religious assignment', () => {
  const one = routeBlock("app.post('/api/student-subjects/assign-one'", "app.put('/api/student-subjects/:id/reactivate'");
  const reactivate = routeBlock("app.put('/api/student-subjects/:id/reactivate'", "app.put('/api/student-subjects/:id/deactivate'");
  assert.match(one, /su\?\.religious_track/);
  assert.match(one, /findActiveReligiousAssignment/);
  assert.match(reactivate, /row\.religious_track/);
  assert.match(reactivate, /findActiveReligiousAssignment/);
});

test('dedicated GET uses effective placement and filters candidates by tenant, active status, class, and section', () => {
  const route = routeBlock("app.get('/api/students/:id/religious-subject'", 'type ReligiousSubjectSelection');
  assert.match(route, /requireRoles\(ACADEMIC_ACCESS_ROLES\)/);
  assert.match(route, /getStudentWithEffectivePlacement/);
  assert.match(route, /student\.school_id !== schoolId/);
  assert.match(route, /status = 'active'/);
  assert.match(route, /religious_track IS NOT NULL/);
  assert.match(route, /class_id = \?/);
  assert.match(route, /section_id IS NULL OR section_id = \?/);
});

test('dedicated PUT validates tenant and placement and switches atomically without deleting history', () => {
  const route = routeBlock("app.put('/api/students/:id/religious-subject'", "app.post('/api/student-subjects/assign-class'");
  assert.match(route, /requireRoles\(ACADEMIC_MANAGEMENT_ROLES\)/);
  assert.match(route, /resolveActiveWriteSchool/);
  assert.match(route, /requestedSubject\.school_id !== targetSchool\.schoolId/);
  assert.match(route, /requestedSubject\.religious_track == null/);
  assert.match(route, /requestedSubject\.class_id !== student\.class_id/);
  assert.match(route, /requestedSubject\.section_id !== student\.section_id/);
  assert.match(route, /UPDATE student_subjects[\s\S]*is_active = 0/);
  assert.match(route, /INSERT INTO student_subjects/);
  assert.match(route, /await db\.batch\(statements\)/);
  assert.doesNotMatch(route, /DELETE FROM student_subjects|DELETE FROM grades|UPDATE students SET[\s\S]*religion/);
});

test('dedicated PUT is idempotent and grade confirmation preserves rows and logs', () => {
  const route = routeBlock("app.put('/api/students/:id/religious-subject'", "app.post('/api/student-subjects/assign-class'");
  assert.match(route, /currentAssignment\?\.subject_id === requestedSubjectId/);
  assert.match(route, /!currentAssignment && requestedSubjectId == null/);
  assert.match(route, /already_applied: true/);
  assert.ok(route.includes('hasRecordedReligiousSubjectGrades'));
  assert.ok(route.includes(RELIGIOUS_SUBJECT_HAS_GRADES_CODE));
  assert.match(route, /confirm_existing_grades !== true/);
  assert.doesNotMatch(route, /DELETE FROM grades|DELETE FROM grade_change_logs|INSERT INTO grades/);
});

test('generic single and bulk deactivate routes delegate to the guarded all-before-write workflow', () => {
  const single = routeBlock("app.put('/api/student-subjects/:id/deactivate'", "app.post('/api/student-subjects/bulk-deactivate'");
  const bulk = routeBlock("app.post('/api/student-subjects/bulk-deactivate'", '// Phase 4: Grades & Academic Calculations');
  for (const route of [single, bulk]) {
    assert.match(route, /deactivateStudentSubjectAssignments/);
    assert.match(route, /code: result\.code/);
    assert.doesNotMatch(route, /UPDATE student_subjects/);
  }
  assert.match(studentSubjectsPage, /RELIGIOUS_SUBJECT_HAS_GRADES_CODE/);
  assert.match(studentSubjectsPage, /استخدم «مادة الديانة الدراسية» من ملف الطالب/);
});

test('personal student religion never drives or changes academic religious assignment', () => {
  const routes = routeBlock("app.get('/api/students/:id/religious-subject'", "app.post('/api/student-subjects/assign-class'");
  assert.doesNotMatch(routes, /student\.religion|religion === ['"]muslim|religion === ['"]christian/);
  assert.doesNotMatch(routes, /UPDATE students/);
});

test('Excel religious-track aliases are conservative and Arabic/English values round-trip', () => {
  assert.deepEqual([...RELIGIOUS_TRACK_HEADER_ALIASES], [
    'نوع مادة الديانة',
    'مسار الديانة',
    'religious_track',
    'religious track',
    'religious education track',
  ]);
  assert.ok(!RELIGIOUS_TRACK_HEADER_ALIASES.includes('الدين'));
  for (const [value, expected] of [
    ['إسلامية', 'islamic'], ['اسلامية', 'islamic'], ['islamic', 'islamic'],
    ['مسيحية', 'christian'], ['christian', 'christian'],
    ['أخرى', 'other'], ['اخرى', 'other'], ['other', 'other'],
  ]) assert.deepEqual(normalizeExcelReligiousTrack(value), { ok: true, value: expected });
  assert.deepEqual(normalizeExcelReligiousTrack(''), { ok: true, value: null });
  assert.deepEqual(normalizeExcelReligiousTrack('unknown'), { ok: false, value: null });
});

test('Smart Excel subject preview and confirm revalidate unknown values and preserve unmapped tracks', () => {
  const preview = routeBlock("app.post('/api/import-export/:type/preview'", "app.post('/api/import-export/:type/confirm'");
  const confirm = routeBlock("app.post('/api/import-export/:type/confirm'", "app.get('/api/import-export/:type/export'");
  assert.match(preview, /normalizeExcelReligiousTrack/);
  assert.match(preview, /نوع مادة الديانة غير معروف/);
  assert.match(confirm, /validateReligiousTrack\(d\.religious_track\)/);
  assert.match(confirm, /importedFields\.has\('religious_track'\)[\s\S]*existingSubj\.religious_track/);
  assert.match(confirm, /countSubjectReligiousConversionConflicts/);
});

test('Smart Excel student-subject preview and confirm reject religious conflicts without replacement', () => {
  const preview = routeBlock("app.post('/api/import-export/:type/preview'", "app.post('/api/import-export/:type/confirm'");
  const confirm = routeBlock("app.post('/api/import-export/:type/confirm'", "app.get('/api/import-export/:type/export'");
  assert.match(preview, /plannedReligiousStudentSubjects/);
  assert.match(preview, /findActiveReligiousAssignment/);
  assert.match(confirm, /preflightImportedReligiousAssignments/);
  assert.match(confirm, /religiousPreflight\.religious_rows/);
  assert.ok(confirm.indexOf('preflightImportedReligiousAssignments') < confirm.indexOf('INSERT INTO student_subjects'));
  assert.doesNotMatch(confirm, /religious[\s\S]*UPDATE student_subjects SET is_active = 0/);
});

test('subject export and template include the Arabic religious track and round-trip labels', () => {
  assert.match(importExportPage, /key: 'religious_track', label: 'نوع مادة الديانة'/);
  assert.match(importExportPage, /RELIGIOUS_TRACK_HEADER_ALIASES/);
  assert.match(importExportPage, /type === 'subjects' && k === 'religious_track'/);
  assert.match(importExportPage, /religiousTrackLabel/);
  const exportRoute = routeBlock("app.get('/api/import-export/:type/export'", 'app.get(\'/api/import-export/jobs\'');
  assert.match(exportRoute, /s\.religious_track/);
});

test('subjects UI keeps subject_type and religious_track independent and badges religious subjects only', () => {
  assert.match(subjectsPage, /نوع مادة الديانة/);
  assert.match(subjectsPage, /ليست مادة ديانة/);
  assert.match(subjectsPage, /religiousTrackLabel\(s\.religious_track\)/);
  assert.match(subjectsPage, /subject_type: form\.subject_type/);
  assert.match(subjectsPage, /religious_track: form\.religious_track \|\| null/);
  assert.match(subjectsPage, /مواد عادية/);
  assert.match(subjectsPage, /مواد دينية/);
});

test('bulk assignment UI hides religious subjects for class/section while explicit student modes retain them', () => {
  assert.match(studentSubjectsPage, /mode === 'class' \|\| mode === 'section'/);
  assert.match(studentSubjectsPage, /subject\.religious_track == null/);
  assert.match(studentSubjectsPage, /religiousTrackLabel/);
});

test('Student Profile distinguishes personal religion and academic religious subject with safe empty state', () => {
  assert.match(studentProfilePage, /الديانة الشخصية/);
  assert.match(studentProfilePage, /مادة الديانة الدراسية/);
  assert.match(studentProfilePage, /لا يدرس مادة ديانة/);
  assert.match(studentProfilePage, /تعيين أكاديمي مستقل عن الديانة الشخصية/);
  assert.match(studentProfilePage, /getStudentReligiousSubject/);
  assert.match(studentProfilePage, /captureSchoolRequest/);
});

test('Student Profile grade-history confirmation uses an in-app modal and retries only after explicit approval', () => {
  assert.match(studentProfilePage, /RELIGIOUS_SUBJECT_HAS_GRADES_CODE/);
  assert.match(studentProfilePage, /ستبقى محفوظة في السجل ولن تُحذف/);
  assert.match(studentProfilePage, /saveReligiousSubject\(true\)/);
  assert.doesNotMatch(studentProfilePage, /window\.confirm|\bconfirm\(/);
  assert.match(api, /confirm_existing_grades: confirmExistingGrades/);
});

test('new APIs preserve explicit target school and existing academic RBAC roles', () => {
  assert.match(api, /school_id: schoolId/);
  const getRoute = routeBlock("app.get('/api/students/:id/religious-subject'", 'type ReligiousSubjectSelection');
  const putRoute = routeBlock("app.put('/api/students/:id/religious-subject'", "app.post('/api/student-subjects/assign-class'");
  assert.match(getRoute, /scope !== 'single' \|\| schoolId == null/);
  assert.match(putRoute, /resolveActiveWriteSchool/);
  assert.match(putRoute, /student\.school_id !== targetSchool\.schoolId/);
});
