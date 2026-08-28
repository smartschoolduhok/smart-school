import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  activateAcademicYearAtomically,
  createInactiveAcademicYear,
  updateAcademicYearDetails,
  validateAcademicYearInput,
} from '../src/lib/academicYears.ts';
import { hasRole, SETTINGS_MANAGEMENT_ROLES } from '../src/lib/rbac.ts';
import { resolveRequiredWriteSchoolId, resolveTenantSchoolId } from '../src/lib/tenantSchool.ts';

const testDir = dirname(fileURLToPath(import.meta.url));
const rootDir = join(testDir, '..');
const initialSchema = readFileSync(join(rootDir, 'migrations', '0001_initial_schema.sql'), 'utf8');
const academicSchema = readFileSync(join(rootDir, 'migrations', '0002_phase2_academic_tables.sql'), 'utf8');
const integrityMigration = readFileSync(join(rootDir, 'migrations', '0017_academic_year_integrity.sql'), 'utf8');
const enrollmentMigration = readFileSync(join(rootDir, 'migrations', '0020_student_enrollments.sql'), 'utf8');
const workerSource = readFileSync(join(rootDir, 'src', 'worker.ts'), 'utf8');
const academicTabSource = readFileSync(join(rootDir, 'src', 'modules', 'settings', 'AcademicTab.tsx'), 'utf8');
const settingsPageSource = readFileSync(join(rootDir, 'src', 'modules', 'settings', 'SettingsPage.tsx'), 'utf8');

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

  run() {
    return this.owner.database.prepare(this.sql).run(...this.params);
  }
}

class LocalD1Adapter {
  constructor(database) {
    this.database = database;
    this.batchCalls = 0;
    this.failAtBatchStatement = null;
    this.failAfterBatchStatement = null;
  }

  prepare(sql) {
    return new LocalPreparedStatement(this, sql);
  }

  batch(statements) {
    this.batchCalls += 1;
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map((statement, index) => {
        if (this.failAtBatchStatement === index) throw new Error('simulated batch failure');
        const result = statement.run();
        if (this.failAfterBatchStatement === index) throw new Error('simulated batch failure');
        return result;
      });
      this.database.exec('COMMIT');
      return results;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}

function createDatabase({ applyIntegrity = true } = {}) {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  database.exec(initialSchema);
  database.exec(academicSchema);
  database.exec(`
    INSERT INTO schools (id, name, school_type, city, status) VALUES
      (1, 'School A', 'خاص', 'دهوك', 'active'),
      (2, 'School B', 'خاص', 'دهوك', 'active');
  `);
  if (applyIntegrity) database.exec(integrityMigration);
  database.exec(enrollmentMigration);
  return database;
}

function insertYear(database, { schoolId = 1, name, start, end, active = 0 }) {
  return Number(database.prepare(`
    INSERT INTO academic_years (school_id, name, starts_at, ends_at, is_active)
    VALUES (?, ?, ?, ?, ?)
    RETURNING id
  `).get(schoolId, name, start, end, active).id);
}

function insertId(database, sql, ...params) {
  return Number(database.prepare(`${sql} RETURNING id`).get(...params).id);
}

function insertClass(database, schoolId, name) {
  return insertId(database, `
    INSERT INTO classes (school_id, name, stage, status)
    VALUES (?, ?, 'primary', 'active')
  `, schoolId, name);
}

function insertSection(database, schoolId, classId, name) {
  return insertId(database, `
    INSERT INTO sections (school_id, class_id, name, status)
    VALUES (?, ?, ?, 'active')
  `, schoolId, classId, name);
}

function insertStudent(database, {
  schoolId = 1,
  studentNumber,
  classId,
  sectionId,
  updatedAt,
}) {
  return insertId(database, `
    INSERT INTO students (
      school_id, student_number, full_name, gender, class_id, section_id, status, updated_at
    ) VALUES (?, ?, ?, 'male', ?, ?, 'active', ?)
  `, schoolId, studentNumber, `Student ${studentNumber}`, classId, sectionId, updatedAt);
}

function insertEnrollment(database, {
  schoolId = 1,
  studentId,
  academicYearId,
  classId,
  sectionId,
  status = 'active',
  promotionStatus = 'pending',
  completedAt = null,
  notes = null,
}) {
  return insertId(database, `
    INSERT INTO student_enrollments (
      school_id, student_id, academic_year_id, class_id, section_id,
      status, promotion_status, completed_at, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, schoolId, studentId, academicYearId, classId, sectionId,
  status, promotionStatus, completedAt, notes);
}

function createRolloverFixture() {
  const database = createDatabase();
  const adapter = new LocalD1Adapter(database);
  const oldYear = insertYear(database, {
    name: '2026-2027', start: '2026-09-01', end: '2027-06-30', active: 1,
  });
  const targetYear = insertYear(database, {
    name: '2027-2028', start: '2027-09-01', end: '2028-06-30', active: 0,
  });
  const schoolBYear = insertYear(database, {
    schoolId: 2, name: '2027-2028', start: '2027-09-01', end: '2028-06-30', active: 1,
  });
  const oldClass = insertClass(database, 1, 'Old Class');
  const targetClass = insertClass(database, 1, 'Target Class');
  const schoolBClass = insertClass(database, 2, 'School B Class');
  const oldSection = insertSection(database, 1, oldClass, 'Old Section');
  const targetSection = insertSection(database, 1, targetClass, 'Target Section');
  const schoolBSection = insertSection(database, 2, schoolBClass, 'School B Section');
  const targetStudent = insertStudent(database, {
    studentNumber: 'A-1', classId: oldClass, sectionId: oldSection, updatedAt: 10,
  });
  const missingEnrollmentStudent = insertStudent(database, {
    studentNumber: 'A-2', classId: oldClass, sectionId: oldSection, updatedAt: 20,
  });
  const alreadySynchronizedStudent = insertStudent(database, {
    studentNumber: 'A-3', classId: targetClass, sectionId: targetSection, updatedAt: 30,
  });
  const schoolBStudent = insertStudent(database, {
    schoolId: 2,
    studentNumber: 'B-1',
    classId: schoolBClass,
    sectionId: schoolBSection,
    updatedAt: 40,
  });

  const previousEnrollment = insertEnrollment(database, {
    studentId: targetStudent,
    academicYearId: oldYear,
    classId: oldClass,
    sectionId: oldSection,
    status: 'completed',
    promotionStatus: 'promoted',
    completedAt: 100,
    notes: 'historical placement',
  });
  insertEnrollment(database, {
    studentId: missingEnrollmentStudent,
    academicYearId: oldYear,
    classId: oldClass,
    sectionId: oldSection,
  });
  const targetEnrollment = insertEnrollment(database, {
    studentId: targetStudent,
    academicYearId: targetYear,
    classId: targetClass,
    sectionId: targetSection,
    status: 'transferred',
    promotionStatus: 'repeated',
    completedAt: 200,
    notes: 'preserve lifecycle',
  });
  insertEnrollment(database, {
    studentId: alreadySynchronizedStudent,
    academicYearId: targetYear,
    classId: targetClass,
    sectionId: targetSection,
  });
  const schoolBEnrollment = insertEnrollment(database, {
    schoolId: 2,
    studentId: schoolBStudent,
    academicYearId: schoolBYear,
    classId: schoolBClass,
    sectionId: schoolBSection,
  });

  return {
    database,
    adapter,
    ids: {
      oldYear,
      targetYear,
      schoolBYear,
      oldClass,
      targetClass,
      schoolBClass,
      oldSection,
      targetSection,
      schoolBSection,
      targetStudent,
      missingEnrollmentStudent,
      alreadySynchronizedStudent,
      schoolBStudent,
      previousEnrollment,
      targetEnrollment,
      schoolBEnrollment,
    },
  };
}

test('valid academic-year input is trimmed and normalized', () => {
  assert.deepEqual(validateAcademicYearInput({
    name: '  2026-2027  ',
    starts_at: '2026-09-01',
    ends_at: '2027-06-30',
  }), {
    ok: true,
    value: { name: '2026-2027', starts_at: '2026-09-01', ends_at: '2027-06-30' },
  });
});

test('invalid or reversed date ranges are rejected', () => {
  for (const input of [
    { name: '2026-2027', starts_at: '2026-02-30', ends_at: '2027-06-30' },
    { name: '2026-2027', starts_at: 'not-a-date', ends_at: '2027-06-30' },
    { name: '2026-2027', starts_at: '2027-06-30', ends_at: '2026-09-01' },
    { name: '2026-2027', starts_at: '2026-09-01', ends_at: '2026-09-01' },
  ]) assert.equal(validateAcademicYearInput(input).ok, false);
});

test('academic-year management uses only school-management roles', () => {
  for (const role of ['system_admin', 'school_owner', 'principal', 'vice_principal']) {
    assert.equal(hasRole(role, SETTINGS_MANAGEMENT_ROLES), true);
  }
  for (const role of ['teacher', 'accountant', 'registrar', 'parent']) {
    assert.equal(hasRole(role, SETTINGS_MANAGEMENT_ROLES), false);
  }
});

test('tenant users are fixed to their school and system admins require an explicit target', () => {
  assert.equal(resolveTenantSchoolId('school_owner', 1, 2), 1);
  assert.deepEqual(resolveRequiredWriteSchoolId('school_owner', 1, 2), { ok: false, status: 403 });
  assert.deepEqual(resolveRequiredWriteSchoolId('system_admin', null, null), { ok: false, status: 400 });
  assert.deepEqual(resolveRequiredWriteSchoolId('system_admin', null, 2), { ok: true, schoolId: 2 });
});

test('migration keeps the newest legacy active year and creates the partial unique index', () => {
  const database = createDatabase({ applyIntegrity: false });
  const oldId = insertYear(database, { name: '2024-2025', start: '2024-09-01', end: '2025-06-30', active: 1 });
  const newestId = insertYear(database, { name: '2025-2026', start: '2025-09-01', end: '2026-06-30', active: 1 });
  database.exec(integrityMigration);

  const active = database.prepare('SELECT id FROM academic_years WHERE school_id = 1 AND is_active = 1').all();
  assert.deepEqual(active.map(row => Number(row.id)), [newestId]);
  assert.equal(Number(database.prepare('SELECT is_active FROM academic_years WHERE id = ?').get(oldId).is_active), 0);
  const index = database.prepare("SELECT sql FROM sqlite_schema WHERE type = 'index' AND name = 'idx_academic_years_one_active_per_school'").get();
  assert.match(index.sql, /UNIQUE INDEX[\s\S]*WHERE is_active = 1/i);
  assert.throws(() => insertYear(database, { name: '2026-2027', start: '2026-09-01', end: '2027-06-30', active: 1 }), /UNIQUE constraint failed/);
  database.close();
});

test('same-school duplicate names are rejected while another school may use the same name', () => {
  const database = createDatabase();
  insertYear(database, { name: '2026-2027', start: '2026-09-01', end: '2027-06-30' });
  assert.throws(() => insertYear(database, { name: ' 2026-2027 ', start: '2026-09-01', end: '2027-06-30' }), /duplicate academic year name/);
  assert.doesNotThrow(() => insertYear(database, { schoolId: 2, name: '2026-2027', start: '2026-09-01', end: '2027-06-30' }));
  database.close();
});

test('valid creation creates an inactive academic year by default', async () => {
  const database = createDatabase();
  const adapter = new LocalD1Adapter(database);
  const created = await createInactiveAcademicYear(adapter, 1, {
    name: '2026-2027', starts_at: '2026-09-01', ends_at: '2027-06-30',
  });
  assert.equal(created.school_id, 1);
  assert.equal(created.is_active, 0);
  database.close();
});

test('editing changes details without changing school_id or is_active', async () => {
  const database = createDatabase();
  const adapter = new LocalD1Adapter(database);
  const id = insertYear(database, { name: '2026', start: '2026-09-01', end: '2027-06-30', active: 1 });
  const updated = await updateAcademicYearDetails(adapter, id, 1, {
    name: '2026-2027', starts_at: '2026-08-25', ends_at: '2027-06-25',
  });
  assert.equal(updated.school_id, 1);
  assert.equal(updated.is_active, 1);
  assert.equal(updated.name, '2026-2027');
  database.close();
});

test('activation atomically deactivates the previous year and leaves exactly one active', async () => {
  const database = createDatabase();
  const adapter = new LocalD1Adapter(database);
  const firstId = insertYear(database, { name: '2025-2026', start: '2025-09-01', end: '2026-06-30', active: 1 });
  const secondId = insertYear(database, { name: '2026-2027', start: '2026-09-01', end: '2027-06-30' });
  const result = await activateAcademicYearAtomically(adapter, secondId, 1);

  assert.equal(result.ok, true);
  assert.equal(result.year.id, secondId);
  assert.equal(Number(database.prepare('SELECT is_active FROM academic_years WHERE id = ?').get(firstId).is_active), 0);
  assert.equal(Number(database.prepare('SELECT COUNT(*) AS count FROM academic_years WHERE school_id = 1 AND is_active = 1').get().count), 1);
  assert.equal(adapter.batchCalls, 1);
  database.close();
});

test('activating an already-active year is idempotent', async () => {
  const database = createDatabase();
  const adapter = new LocalD1Adapter(database);
  const id = insertYear(database, { name: '2026-2027', start: '2026-09-01', end: '2027-06-30', active: 1 });
  const result = await activateAcademicYearAtomically(adapter, id, 1);
  assert.equal(result.ok, true);
  assert.equal(Number(database.prepare('SELECT COUNT(*) AS count FROM academic_years WHERE school_id = 1 AND is_active = 1').get().count), 1);
  database.close();
});

test('a year from school A cannot be activated in school B context', async () => {
  const database = createDatabase();
  const adapter = new LocalD1Adapter(database);
  const id = insertYear(database, { name: '2026-2027', start: '2026-09-01', end: '2027-06-30' });
  assert.deepEqual(await activateAcademicYearAtomically(adapter, id, 2), { ok: false, code: 'wrong_school' });
  assert.equal(adapter.batchCalls, 0);
  database.close();
});

test('activation rollback keeps the previous active year when the batch fails', async () => {
  const database = createDatabase();
  const adapter = new LocalD1Adapter(database);
  const firstId = insertYear(database, { name: '2025-2026', start: '2025-09-01', end: '2026-06-30', active: 1 });
  const secondId = insertYear(database, { name: '2026-2027', start: '2026-09-01', end: '2027-06-30' });
  adapter.failAtBatchStatement = 1;
  await assert.rejects(() => activateAcademicYearAtomically(adapter, secondId, 1), /simulated batch failure/);
  assert.equal(Number(database.prepare('SELECT is_active FROM academic_years WHERE id = ?').get(firstId).is_active), 1);
  assert.equal(Number(database.prepare('SELECT is_active FROM academic_years WHERE id = ?').get(secondId).is_active), 0);
  database.close();
});

test('activating a new year mirrors its enrollment placement and keeps one active year', async () => {
  const { database, adapter, ids } = createRolloverFixture();

  const result = await activateAcademicYearAtomically(adapter, ids.targetYear, 1);
  const student = database.prepare(`
    SELECT class_id, section_id FROM students WHERE id = ?
  `).get(ids.targetStudent);

  assert.equal(result.ok, true);
  assert.deepEqual({ ...student }, { class_id: ids.targetClass, section_id: ids.targetSection });
  assert.equal(Number(database.prepare(`
    SELECT COUNT(*) AS count
    FROM academic_years
    WHERE school_id = 1 AND is_active = 1
  `).get().count), 1);
  assert.equal(Number(database.prepare('SELECT is_active FROM academic_years WHERE id = ?').get(ids.oldYear).is_active), 0);
  assert.equal(Number(database.prepare('SELECT is_active FROM academic_years WHERE id = ?').get(ids.targetYear).is_active), 1);
  assert.equal(adapter.batchCalls, 1);
  database.close();
});

test('activation clears legacy placement when no target-year enrollment exists and creates nothing', async () => {
  const { database, adapter, ids } = createRolloverFixture();
  const enrollmentCountBefore = Number(database.prepare(`
    SELECT COUNT(*) AS count FROM student_enrollments
  `).get().count);

  await activateAcademicYearAtomically(adapter, ids.targetYear, 1);

  const student = database.prepare(`
    SELECT class_id, section_id FROM students WHERE id = ?
  `).get(ids.missingEnrollmentStudent);
  const targetEnrollmentCount = Number(database.prepare(`
    SELECT COUNT(*) AS count
    FROM student_enrollments
    WHERE school_id = 1 AND student_id = ? AND academic_year_id = ?
  `).get(ids.missingEnrollmentStudent, ids.targetYear).count);
  const enrollmentCountAfter = Number(database.prepare(`
    SELECT COUNT(*) AS count FROM student_enrollments
  `).get().count);

  assert.deepEqual({ ...student }, { class_id: null, section_id: null });
  assert.equal(targetEnrollmentCount, 0);
  assert.equal(enrollmentCountAfter, enrollmentCountBefore);
  database.close();
});

test('activation preserves previous and target enrollment history and lifecycle fields', async () => {
  const { database, adapter, ids } = createRolloverFixture();
  const previousBefore = database.prepare(`
    SELECT * FROM student_enrollments WHERE id = ?
  `).get(ids.previousEnrollment);
  const targetBefore = database.prepare(`
    SELECT * FROM student_enrollments WHERE id = ?
  `).get(ids.targetEnrollment);

  await activateAcademicYearAtomically(adapter, ids.targetYear, 1);

  assert.deepEqual(database.prepare(`
    SELECT * FROM student_enrollments WHERE id = ?
  `).get(ids.previousEnrollment), previousBefore);
  assert.deepEqual(database.prepare(`
    SELECT * FROM student_enrollments WHERE id = ?
  `).get(ids.targetEnrollment), targetBefore);
  assert.equal(targetBefore.status, 'transferred');
  assert.equal(targetBefore.promotion_status, 'repeated');
  assert.equal(Number(targetBefore.completed_at), 200);
  database.close();
});

test('activation is tenant-scoped and another school enrollment cannot influence the mirror', async () => {
  const { database, adapter, ids } = createRolloverFixture();
  const schoolBStudentBefore = database.prepare(`
    SELECT * FROM students WHERE id = ?
  `).get(ids.schoolBStudent);
  const schoolBEnrollmentBefore = database.prepare(`
    SELECT * FROM student_enrollments WHERE id = ?
  `).get(ids.schoolBEnrollment);

  await activateAcademicYearAtomically(adapter, ids.targetYear, 1);

  assert.deepEqual(database.prepare(`
    SELECT * FROM students WHERE id = ?
  `).get(ids.schoolBStudent), schoolBStudentBefore);
  assert.deepEqual(database.prepare(`
    SELECT * FROM student_enrollments WHERE id = ?
  `).get(ids.schoolBEnrollment), schoolBEnrollmentBefore);
  assert.equal(Number(database.prepare(`
    SELECT is_active FROM academic_years WHERE id = ?
  `).get(ids.schoolBYear).is_active), 1);
  assert.deepEqual({ ...database.prepare(`
    SELECT class_id, section_id FROM students WHERE id = ?
  `).get(ids.missingEnrollmentStudent) }, { class_id: null, section_id: null });
  database.close();
});

test('target enrollment with no section mirrors its class and a null section', async () => {
  const { database, adapter, ids } = createRolloverFixture();
  const studentId = insertStudent(database, {
    studentNumber: 'A-4',
    classId: ids.oldClass,
    sectionId: ids.oldSection,
    updatedAt: 50,
  });
  insertEnrollment(database, {
    studentId,
    academicYearId: ids.targetYear,
    classId: ids.targetClass,
    sectionId: null,
  });

  await activateAcademicYearAtomically(adapter, ids.targetYear, 1);

  assert.deepEqual({ ...database.prepare(`
    SELECT class_id, section_id FROM students WHERE id = ?
  `).get(studentId) }, { class_id: ids.targetClass, section_id: null });
  database.close();
});

test('re-activating the active year repairs legacy placement drift without duplicate enrollments', async () => {
  const { database, adapter, ids } = createRolloverFixture();
  await activateAcademicYearAtomically(adapter, ids.targetYear, 1);
  database.prepare(`
    UPDATE students SET class_id = ?, section_id = ?, updated_at = 5 WHERE id = ?
  `).run(ids.oldClass, ids.oldSection, ids.targetStudent);
  const enrollmentCountBefore = Number(database.prepare(`
    SELECT COUNT(*) AS count FROM student_enrollments
  `).get().count);

  await activateAcademicYearAtomically(adapter, ids.targetYear, 1);

  assert.deepEqual({ ...database.prepare(`
    SELECT class_id, section_id FROM students WHERE id = ?
  `).get(ids.targetStudent) }, {
    class_id: ids.targetClass,
    section_id: ids.targetSection,
  });
  assert.equal(Number(database.prepare(`
    SELECT COUNT(*) AS count FROM student_enrollments
  `).get().count), enrollmentCountBefore);
  assert.equal(Number(database.prepare(`
    SELECT COUNT(*) AS count
    FROM academic_years
    WHERE school_id = 1 AND is_active = 1
  `).get().count), 1);
  database.close();
});

test('activation updates student timestamps only when legacy placement changes', async () => {
  const { database, adapter, ids } = createRolloverFixture();

  await activateAcademicYearAtomically(adapter, ids.targetYear, 1);

  const changed = database.prepare(`
    SELECT updated_at FROM students WHERE id = ?
  `).get(ids.targetStudent);
  const unchanged = database.prepare(`
    SELECT updated_at FROM students WHERE id = ?
  `).get(ids.alreadySynchronizedStudent);
  assert.ok(Number(changed.updated_at) > 10);
  assert.equal(Number(unchanged.updated_at), 30);
  database.close();
});

test('mirror synchronization failure rolls back year flags and all student placement changes', async () => {
  const { database, adapter, ids } = createRolloverFixture();
  const yearsBefore = database.prepare(`
    SELECT id, is_active FROM academic_years WHERE school_id = 1 ORDER BY id
  `).all();
  const studentsBefore = database.prepare(`
    SELECT id, class_id, section_id, updated_at FROM students WHERE school_id = 1 ORDER BY id
  `).all();
  adapter.failAfterBatchStatement = 2;

  await assert.rejects(
    () => activateAcademicYearAtomically(adapter, ids.targetYear, 1),
    /simulated batch failure/,
  );

  assert.deepEqual(database.prepare(`
    SELECT id, is_active FROM academic_years WHERE school_id = 1 ORDER BY id
  `).all(), yearsBefore);
  assert.deepEqual(database.prepare(`
    SELECT id, class_id, section_id, updated_at FROM students WHERE school_id = 1 ORDER BY id
  `).all(), studentsBefore);
  assert.equal(Number(database.prepare('SELECT is_active FROM academic_years WHERE id = ?').get(ids.oldYear).is_active), 1);
  assert.equal(Number(database.prepare('SELECT is_active FROM academic_years WHERE id = ?').get(ids.targetYear).is_active), 0);
  database.close();
});

test('list endpoint requires a resolved school and filters every row by school_id', () => {
  const route = workerSource.slice(workerSource.indexOf("app.get('/api/academic-years'"), workerSource.indexOf("app.post('/api/academic-years'"));
  assert.match(route, /resolvedSchoolId == null/);
  assert.match(route, /WHERE school_id = \?/);
  assert.match(route, /bind\(resolvedSchoolId\)/);
  assert.doesNotMatch(route, /scope === 'all'/);
});

test('create, edit, and activate endpoints enforce school-management roles', () => {
  for (const marker of [
    "app.post('/api/academic-years'",
    "app.put('/api/academic-years/:id'",
    "app.put('/api/academic-years/:id/activate'",
  ]) {
    const route = workerSource.slice(workerSource.indexOf(marker), workerSource.indexOf(marker) + 400);
    assert.match(route, /requireRoles\(SETTINGS_MANAGEMENT_ROLES\)/, marker);
  }
});

test('mutations require an active target school and editing cannot set school_id or is_active', () => {
  const routes = workerSource.slice(workerSource.indexOf("app.post('/api/academic-years'"), workerSource.indexOf('// API ROUTES: Dashboard Stats'));
  assert.match(routes, /resolveActiveWriteSchool\(db, user, body\.school_id\)/);
  assert.match(routes, /existing\.school_id !== targetSchool\.schoolId/);
  assert.match(routes, /hasOwnProperty\.call\(body, 'is_active'\)/);
  const updateHelper = readFileSync(join(rootDir, 'src', 'lib', 'academicYears.ts'), 'utf8');
  assert.match(updateHelper, /WHERE id = \? AND school_id = \?/);
  assert.doesNotMatch(updateHelper, /SET school_id/);
});

test('the existing Result Card flow still resolves the active school year', () => {
  const lookup = workerSource.slice(workerSource.indexOf('async function loadResultCardEvaluation'), workerSource.indexOf('async function createResultCard'));
  assert.match(lookup, /FROM academic_years/);
  assert.match(lookup, /WHERE school_id = \? AND is_active = 1/);
  assert.match(lookup, /ORDER BY id DESC\s+LIMIT 1/);
});

test('Academic Settings uses real API data, exposes management actions, and has no hardcoded year', () => {
  assert.match(academicTabSource, /getAcademicYears\(schoolId\)/);
  assert.match(academicTabSource, /لا توجد سنة دراسية فعالة/);
  assert.match(academicTabSource, /إضافة سنة دراسية/);
  assert.match(academicTabSource, /سيتم إيقاف السنة الدراسية الحالية وتفعيل السنة المحددة/);
  assert.doesNotMatch(academicTabSource, /2025-2026/);
  assert.doesNotMatch(workerSource, /app\.delete\('\/api\/academic-years/);
});

test('Academic Settings receives the current tenant school name explicitly', () => {
  assert.match(academicTabSource, /schoolName: string \| null/);
  assert.match(academicTabSource, /\{schoolName \|\| 'المدرسة المحددة'\}/);
  assert.doesNotMatch(academicTabSource, /data\?\.school\?\.name/);
  assert.match(settingsPageSource, /schoolScope\.schools\.find\(school => school\.id === effectiveSchoolId\)\?\.name/);
  assert.match(settingsPageSource, /: user\?\.school_name \|\| null/);
  assert.match(settingsPageSource, /<AcademicTab[\s\S]*?schoolName=\{selectedSchoolName\}/);
});
