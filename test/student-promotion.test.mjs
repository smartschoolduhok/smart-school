import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  FINALIZED_ENROLLMENT_PLACEMENT_ERROR,
  buildStudentPlacementUpdatePlan,
  loadCurrentStudentEnrollmentContext,
  persistStudentImportWithEnrollmentBridge,
  updateStudentIdentityOnly,
  updateStudentPlacementAtomically,
} from '../src/lib/studentEnrollments.ts';
import {
  executeStudentPromotion,
  validateStudentPromotionRequest,
} from '../src/lib/studentPromotion.ts';

const testDir = dirname(fileURLToPath(import.meta.url));
const rootDir = join(testDir, '..');
const initialSchema = readFileSync(join(rootDir, 'migrations', '0001_initial_schema.sql'), 'utf8');
const academicSchema = readFileSync(join(rootDir, 'migrations', '0002_phase2_academic_tables.sql'), 'utf8');
const academicYearIntegrity = readFileSync(join(rootDir, 'migrations', '0017_academic_year_integrity.sql'), 'utf8');
const enrollmentMigration = readFileSync(join(rootDir, 'migrations', '0020_student_enrollments.sql'), 'utf8');
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

  run() {
    if (this.owner.beforeRun) this.owner.beforeRun(this);
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
    this.beforeRun = null;
  }

  prepare(sql) {
    return new LocalPreparedStatement(this, sql);
  }

  batch(statements) {
    this.batchCalls += 1;
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map((statement, index) => {
        if (this.failAtBatchStatement === index) throw new Error('simulated promotion target insert failure');
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
  database.exec(`
    INSERT INTO schools (id, name, school_type, city, status) VALUES
      (1, 'School A', 'private', 'Duhok', 'active'),
      (2, 'School B', 'private', 'Duhok', 'active');
  `);

  const pastA = insertId(database, `
    INSERT INTO academic_years (school_id, name, starts_at, ends_at, is_active)
    VALUES (1, '2025-2026', '2025-09-01', '2026-06-30', 0)
  `);
  // Insert the future year before the source year so chronology cannot accidentally rely on IDs.
  const futureA = insertId(database, `
    INSERT INTO academic_years (school_id, name, starts_at, ends_at, is_active)
    VALUES (1, '2027-2028', '2027-09-01', '2028-06-30', 0)
  `);
  const sourceA = insertId(database, `
    INSERT INTO academic_years (school_id, name, starts_at, ends_at, is_active)
    VALUES (1, '2026-2027', '2026-09-01', '2027-06-30', 1)
  `);
  const laterA = insertId(database, `
    INSERT INTO academic_years (school_id, name, starts_at, ends_at, is_active)
    VALUES (1, '2028-2029', '2028-09-01', '2029-06-30', 0)
  `);
  const sourceB = insertId(database, `
    INSERT INTO academic_years (school_id, name, starts_at, ends_at, is_active)
    VALUES (2, '2026-2027', '2026-09-01', '2027-06-30', 1)
  `);
  const futureB = insertId(database, `
    INSERT INTO academic_years (school_id, name, starts_at, ends_at, is_active)
    VALUES (2, '2027-2028', '2027-09-01', '2028-06-30', 0)
  `);

  const classA1 = insertId(database, `
    INSERT INTO classes (school_id, name, stage, status)
    VALUES (1, 'Class A1', 'primary', 'active')
  `);
  const classA2 = insertId(database, `
    INSERT INTO classes (school_id, name, stage, status)
    VALUES (1, 'Class A2', 'primary', 'active')
  `);
  const classA3 = insertId(database, `
    INSERT INTO classes (school_id, name, stage, status)
    VALUES (1, 'Class A3', 'primary', 'active')
  `);
  const classB1 = insertId(database, `
    INSERT INTO classes (school_id, name, stage, status)
    VALUES (2, 'Class B1', 'primary', 'active')
  `);
  const sectionA1 = insertId(database, `
    INSERT INTO sections (school_id, class_id, name, status)
    VALUES (1, ?, 'Section A1', 'active')
  `, classA1);
  const sectionA2 = insertId(database, `
    INSERT INTO sections (school_id, class_id, name, status)
    VALUES (1, ?, 'Section A2', 'active')
  `, classA2);
  const sectionA3 = insertId(database, `
    INSERT INTO sections (school_id, class_id, name, status)
    VALUES (1, ?, 'Section A3', 'active')
  `, classA3);
  const sectionB1 = insertId(database, `
    INSERT INTO sections (school_id, class_id, name, status)
    VALUES (2, ?, 'Section B1', 'active')
  `, classB1);
  const userA = insertId(database, `
    INSERT INTO users (school_id, full_name, email, role_id, status)
    VALUES (1, 'Owner A', 'promotion-owner-a@example.test', 2, 'active')
  `);

  return {
    database,
    adapter: new LocalD1Adapter(database),
    ids: {
      pastA,
      futureA,
      sourceA,
      laterA,
      sourceB,
      futureB,
      classA1,
      classA2,
      classA3,
      classB1,
      sectionA1,
      sectionA2,
      sectionA3,
      sectionB1,
      userA,
    },
  };
}

function insertStudent(database, ids, overrides = {}) {
  return insertId(database, `
    INSERT INTO students (
      school_id, student_number, full_name, gender, class_id, section_id, status
    ) VALUES (?, ?, ?, 'male', ?, ?, ?)
  `,
  overrides.school_id ?? 1,
  overrides.student_number ?? `PROMO-${crypto.randomUUID()}`,
  overrides.full_name ?? 'Promotion Student',
  Object.hasOwn(overrides, 'class_id') ? overrides.class_id : ids.classA1,
  Object.hasOwn(overrides, 'section_id') ? overrides.section_id : ids.sectionA1,
  overrides.status ?? 'active');
}

function insertEnrollment(database, ids, studentId, overrides = {}) {
  return insertId(database, `
    INSERT INTO student_enrollments (
      school_id, student_id, academic_year_id, class_id, section_id,
      status, promotion_status, created_by_user_id, updated_by_user_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  overrides.school_id ?? 1,
  studentId,
  overrides.academic_year_id ?? ids.sourceA,
  overrides.class_id ?? ids.classA1,
  Object.hasOwn(overrides, 'section_id') ? overrides.section_id : ids.sectionA1,
  overrides.status ?? 'active',
  overrides.promotion_status ?? 'pending',
  ids.userA,
  ids.userA);
}

function createPromotionSource(fixture, overrides = {}) {
  const studentId = insertStudent(fixture.database, fixture.ids, overrides.student ?? {});
  const sourceEnrollmentId = insertEnrollment(
    fixture.database,
    fixture.ids,
    studentId,
    overrides.enrollment ?? {},
  );
  return { studentId, sourceEnrollmentId };
}

function promotionRequest(ids, sourceEnrollmentId, overrides = {}) {
  return {
    source_enrollment_id: sourceEnrollmentId,
    action: 'promoted',
    target_academic_year_id: ids.futureA,
    target_class_id: ids.classA2,
    target_section_id: ids.sectionA2,
    ...overrides,
  };
}

function row(database, sql, ...params) {
  return database.prepare(sql).get(...params);
}

async function expectFailure(promise, status, code) {
  const result = await promise;
  assert.equal(result.ok, false);
  assert.equal(result.status, status);
  assert.equal(result.code, code);
  return result;
}

function studentValues(database, studentId, overrides = {}) {
  const student = row(database, `
    SELECT school_id, student_number, full_name, father_name, mother_name, gender,
           birth_date, phone, guardian_name, guardian_phone, address, class_id,
           section_id, status, photo_url, notes
    FROM students WHERE id = ?
  `, studentId);
  return { ...student, ...overrides };
}

test('promoted finalizes source and creates an explicit active pending target enrollment', async () => {
  const fixture = createFixture();
  const { studentId, sourceEnrollmentId } = createPromotionSource(fixture);
  const beforeLegacy = row(fixture.database, 'SELECT class_id, section_id FROM students WHERE id = ?', studentId);

  const result = await executeStudentPromotion(
    fixture.adapter,
    1,
    fixture.ids.userA,
    promotionRequest(fixture.ids, sourceEnrollmentId),
  );
  assert.equal(result.ok, true);
  assert.equal(result.data.action, 'promoted');
  assert.equal(result.data.already_applied, false);

  const source = row(fixture.database, 'SELECT * FROM student_enrollments WHERE id = ?', sourceEnrollmentId);
  const target = row(fixture.database, 'SELECT * FROM student_enrollments WHERE id = ?', result.data.target_enrollment_id);
  assert.equal(source.status, 'completed');
  assert.equal(source.promotion_status, 'promoted');
  assert.ok(Number(source.completed_at) > 0);
  assert.equal(Number(source.updated_by_user_id), fixture.ids.userA);
  assert.equal(Number(target.academic_year_id), fixture.ids.futureA);
  assert.equal(Number(target.class_id), fixture.ids.classA2);
  assert.equal(Number(target.section_id), fixture.ids.sectionA2);
  assert.equal(target.status, 'active');
  assert.equal(target.promotion_status, 'pending');
  assert.equal(Number(target.created_by_user_id), fixture.ids.userA);
  assert.equal(Number(target.updated_by_user_id), fixture.ids.userA);
  assert.deepEqual(row(fixture.database, 'SELECT class_id, section_id FROM students WHERE id = ?', studentId), beforeLegacy);
  fixture.database.close();
});

test('repeated requires and stores the explicitly supplied target placement without inference', async () => {
  const fixture = createFixture();
  const { sourceEnrollmentId } = createPromotionSource(fixture);
  const result = await executeStudentPromotion(fixture.adapter, 1, fixture.ids.userA, promotionRequest(
    fixture.ids,
    sourceEnrollmentId,
    { action: 'repeated', target_class_id: fixture.ids.classA3, target_section_id: null },
  ));
  assert.equal(result.ok, true);
  const source = row(fixture.database, 'SELECT status, promotion_status FROM student_enrollments WHERE id = ?', sourceEnrollmentId);
  const target = row(fixture.database, 'SELECT class_id, section_id, status, promotion_status FROM student_enrollments WHERE id = ?', result.data.target_enrollment_id);
  assert.equal(source.status, 'completed');
  assert.equal(source.promotion_status, 'repeated');
  assert.equal(Number(target.class_id), fixture.ids.classA3);
  assert.equal(target.section_id, null);
  assert.equal(target.status, 'active');
  assert.equal(target.promotion_status, 'pending');
  fixture.database.close();
});

test('graduated finalizes source without creating a target enrollment', async () => {
  const fixture = createFixture();
  const { studentId, sourceEnrollmentId } = createPromotionSource(fixture);
  const result = await executeStudentPromotion(fixture.adapter, 1, fixture.ids.userA, {
    source_enrollment_id: sourceEnrollmentId,
    action: 'graduated',
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.target_enrollment_id, null);
  assert.equal(result.data.target_academic_year_id, null);
  const source = row(fixture.database, 'SELECT status, promotion_status, completed_at FROM student_enrollments WHERE id = ?', sourceEnrollmentId);
  assert.equal(source.status, 'completed');
  assert.equal(source.promotion_status, 'graduated');
  assert.ok(Number(source.completed_at) > 0);
  assert.equal(Number(row(fixture.database, 'SELECT COUNT(*) AS count FROM student_enrollments WHERE student_id = ?', studentId).count), 1);
  fixture.database.close();
});

test('unknown promotion actions are rejected as invalid input', async () => {
  const validation = validateStudentPromotionRequest({ source_enrollment_id: 1, action: 'not_applicable' });
  assert.equal(validation.ok, false);
});

test('graduated rejects all target placement fields even when null', async () => {
  const validation = validateStudentPromotionRequest({
    source_enrollment_id: 1,
    action: 'graduated',
    target_section_id: null,
  });
  assert.equal(validation.ok, false);
});

test('promoted and repeated require an explicit target class', async () => {
  for (const action of ['promoted', 'repeated']) {
    const validation = validateStudentPromotionRequest({
      source_enrollment_id: 1,
      action,
      target_academic_year_id: 2,
    });
    assert.equal(validation.ok, false, action);
  }
});

test('source enrollment must belong to the current active academic year', async () => {
  const fixture = createFixture();
  const { sourceEnrollmentId } = createPromotionSource(fixture, {
    enrollment: { academic_year_id: fixture.ids.pastA },
  });
  await expectFailure(
    executeStudentPromotion(fixture.adapter, 1, fixture.ids.userA, promotionRequest(fixture.ids, sourceEnrollmentId)),
    409,
    'source_not_current_year',
  );
  fixture.database.close();
});

test('missing source enrollment returns 404', async () => {
  const fixture = createFixture();
  await expectFailure(
    executeStudentPromotion(fixture.adapter, 1, fixture.ids.userA, promotionRequest(fixture.ids, 99999)),
    404,
    'source_not_found',
  );
  fixture.database.close();
});

for (const status of ['transferred', 'withdrawn', 'cancelled', 'completed']) {
  test(`${status} source enrollment cannot transition through the promotion endpoint`, async () => {
    const fixture = createFixture();
    const { sourceEnrollmentId } = createPromotionSource(fixture, {
      enrollment: { status },
    });
    await expectFailure(
      executeStudentPromotion(fixture.adapter, 1, fixture.ids.userA, promotionRequest(fixture.ids, sourceEnrollmentId)),
      409,
      'lifecycle_conflict',
    );
    fixture.database.close();
  });
}

test('a non-pending source promotion status is rejected unless it is an exact retry', async () => {
  const fixture = createFixture();
  const { sourceEnrollmentId } = createPromotionSource(fixture, {
    enrollment: { promotion_status: 'repeated' },
  });
  await expectFailure(
    executeStudentPromotion(fixture.adapter, 1, fixture.ids.userA, promotionRequest(fixture.ids, sourceEnrollmentId)),
    409,
    'lifecycle_conflict',
  );
  fixture.database.close();
});

test('inactive students cannot be promoted', async () => {
  const fixture = createFixture();
  const { sourceEnrollmentId } = createPromotionSource(fixture, { student: { status: 'archived' } });
  await expectFailure(
    executeStudentPromotion(fixture.adapter, 1, fixture.ids.userA, promotionRequest(fixture.ids, sourceEnrollmentId)),
    409,
    'student_inactive',
  );
  fixture.database.close();
});

test('target academic year must belong to the same school', async () => {
  const fixture = createFixture();
  const { sourceEnrollmentId } = createPromotionSource(fixture);
  await expectFailure(executeStudentPromotion(fixture.adapter, 1, fixture.ids.userA, promotionRequest(
    fixture.ids,
    sourceEnrollmentId,
    { target_academic_year_id: fixture.ids.futureB },
  )), 403, 'wrong_school');
  fixture.database.close();
});

test('target academic year must be inactive', async () => {
  const fixture = createFixture();
  fixture.database.exec('DROP INDEX idx_academic_years_one_active_per_school');
  fixture.database.prepare('UPDATE academic_years SET is_active = 1 WHERE id = ?').run(fixture.ids.futureA);
  const { sourceEnrollmentId } = createPromotionSource(fixture);
  await expectFailure(
    executeStudentPromotion(fixture.adapter, 1, fixture.ids.userA, promotionRequest(fixture.ids, sourceEnrollmentId)),
    409,
    'target_year_active',
  );
  fixture.database.close();
});

test('target academic year must differ from source year', async () => {
  const fixture = createFixture();
  const { sourceEnrollmentId } = createPromotionSource(fixture);
  await expectFailure(executeStudentPromotion(fixture.adapter, 1, fixture.ids.userA, promotionRequest(
    fixture.ids,
    sourceEnrollmentId,
    { target_academic_year_id: fixture.ids.sourceA },
  )), 400, 'invalid_input');
  fixture.database.close();
});

test('target academic year must be chronologically later by starts_at', async () => {
  const fixture = createFixture();
  const { sourceEnrollmentId } = createPromotionSource(fixture);
  await expectFailure(executeStudentPromotion(fixture.adapter, 1, fixture.ids.userA, promotionRequest(
    fixture.ids,
    sourceEnrollmentId,
    { target_academic_year_id: fixture.ids.pastA },
  )), 400, 'target_year_not_later');
  fixture.database.close();
});

test('chronology uses starts_at even when the future year ID is lower than the source ID', async () => {
  const fixture = createFixture();
  assert.ok(fixture.ids.futureA < fixture.ids.sourceA);
  const { sourceEnrollmentId } = createPromotionSource(fixture);
  const result = await executeStudentPromotion(
    fixture.adapter,
    1,
    fixture.ids.userA,
    promotionRequest(fixture.ids, sourceEnrollmentId),
  );
  assert.equal(result.ok, true);
  fixture.database.close();
});

test('missing target academic year returns 404', async () => {
  const fixture = createFixture();
  const { sourceEnrollmentId } = createPromotionSource(fixture);
  await expectFailure(executeStudentPromotion(fixture.adapter, 1, fixture.ids.userA, promotionRequest(
    fixture.ids,
    sourceEnrollmentId,
    { target_academic_year_id: 99999 },
  )), 404, 'target_year_not_found');
  fixture.database.close();
});

test('target class must belong to the same school', async () => {
  const fixture = createFixture();
  const { sourceEnrollmentId } = createPromotionSource(fixture);
  await expectFailure(executeStudentPromotion(fixture.adapter, 1, fixture.ids.userA, promotionRequest(
    fixture.ids,
    sourceEnrollmentId,
    { target_class_id: fixture.ids.classB1, target_section_id: null },
  )), 403, 'wrong_school');
  fixture.database.close();
});

test('missing target class returns 404', async () => {
  const fixture = createFixture();
  const { sourceEnrollmentId } = createPromotionSource(fixture);
  await expectFailure(executeStudentPromotion(fixture.adapter, 1, fixture.ids.userA, promotionRequest(
    fixture.ids,
    sourceEnrollmentId,
    { target_class_id: 99999, target_section_id: null },
  )), 404, 'target_class_not_found');
  fixture.database.close();
});

test('target section must belong to the same school', async () => {
  const fixture = createFixture();
  const { sourceEnrollmentId } = createPromotionSource(fixture);
  await expectFailure(executeStudentPromotion(fixture.adapter, 1, fixture.ids.userA, promotionRequest(
    fixture.ids,
    sourceEnrollmentId,
    { target_section_id: fixture.ids.sectionB1 },
  )), 403, 'wrong_school');
  fixture.database.close();
});

test('target section must belong to the explicitly selected target class', async () => {
  const fixture = createFixture();
  const { sourceEnrollmentId } = createPromotionSource(fixture);
  await expectFailure(executeStudentPromotion(fixture.adapter, 1, fixture.ids.userA, promotionRequest(
    fixture.ids,
    sourceEnrollmentId,
    { target_class_id: fixture.ids.classA2, target_section_id: fixture.ids.sectionA3 },
  )), 400, 'target_section_mismatch');
  fixture.database.close();
});

test('missing target section returns 404', async () => {
  const fixture = createFixture();
  const { sourceEnrollmentId } = createPromotionSource(fixture);
  await expectFailure(executeStudentPromotion(fixture.adapter, 1, fixture.ids.userA, promotionRequest(
    fixture.ids,
    sourceEnrollmentId,
    { target_section_id: 99999 },
  )), 404, 'target_section_not_found');
  fixture.database.close();
});

test('cross-tenant source enrollment is rejected without mutation', async () => {
  const fixture = createFixture();
  const studentId = insertStudent(fixture.database, fixture.ids, {
    school_id: 2,
    class_id: fixture.ids.classB1,
    section_id: fixture.ids.sectionB1,
  });
  const sourceEnrollmentId = insertEnrollment(fixture.database, fixture.ids, studentId, {
    school_id: 2,
    academic_year_id: fixture.ids.sourceB,
    class_id: fixture.ids.classB1,
    section_id: fixture.ids.sectionB1,
  });
  await expectFailure(
    executeStudentPromotion(fixture.adapter, 1, fixture.ids.userA, promotionRequest(fixture.ids, sourceEnrollmentId)),
    403,
    'wrong_school',
  );
  assert.equal(row(fixture.database, 'SELECT status FROM student_enrollments WHERE id = ?', sourceEnrollmentId).status, 'active');
  fixture.database.close();
});

test('an existing conflicting target enrollment returns 409 and is not overwritten', async () => {
  const fixture = createFixture();
  const { studentId, sourceEnrollmentId } = createPromotionSource(fixture);
  const conflictingId = insertEnrollment(fixture.database, fixture.ids, studentId, {
    academic_year_id: fixture.ids.futureA,
    class_id: fixture.ids.classA3,
    section_id: fixture.ids.sectionA3,
  });
  await expectFailure(
    executeStudentPromotion(fixture.adapter, 1, fixture.ids.userA, promotionRequest(fixture.ids, sourceEnrollmentId)),
    409,
    'target_enrollment_conflict',
  );
  const conflict = row(fixture.database, 'SELECT class_id, section_id FROM student_enrollments WHERE id = ?', conflictingId);
  assert.equal(Number(conflict.class_id), fixture.ids.classA3);
  assert.equal(Number(conflict.section_id), fixture.ids.sectionA3);
  fixture.database.close();
});

for (const action of ['promoted', 'repeated']) {
  test(`exact ${action} retry is idempotent and does not rewrite source completion time`, async () => {
    const fixture = createFixture();
    const { sourceEnrollmentId } = createPromotionSource(fixture);
    const request = promotionRequest(fixture.ids, sourceEnrollmentId, { action });
    const first = await executeStudentPromotion(fixture.adapter, 1, fixture.ids.userA, request);
    assert.equal(first.ok, true);
    fixture.database.prepare('UPDATE student_enrollments SET completed_at = 123 WHERE id = ?').run(sourceEnrollmentId);
    const targetCreatedAt = Number(row(fixture.database, 'SELECT created_at FROM student_enrollments WHERE id = ?', first.data.target_enrollment_id).created_at);

    const retry = await executeStudentPromotion(fixture.adapter, 1, fixture.ids.userA, request);
    assert.equal(retry.ok, true);
    assert.equal(retry.data.already_applied, true);
    assert.equal(retry.data.target_enrollment_id, first.data.target_enrollment_id);
    assert.equal(Number(row(fixture.database, 'SELECT completed_at FROM student_enrollments WHERE id = ?', sourceEnrollmentId).completed_at), 123);
    assert.equal(Number(row(fixture.database, 'SELECT created_at FROM student_enrollments WHERE id = ?', first.data.target_enrollment_id).created_at), targetCreatedAt);
    fixture.database.close();
  });
}

test('exact graduated retry is idempotent and does not rewrite completion time', async () => {
  const fixture = createFixture();
  const { sourceEnrollmentId } = createPromotionSource(fixture);
  const request = { source_enrollment_id: sourceEnrollmentId, action: 'graduated' };
  const first = await executeStudentPromotion(fixture.adapter, 1, fixture.ids.userA, request);
  assert.equal(first.ok, true);
  fixture.database.prepare('UPDATE student_enrollments SET completed_at = 321 WHERE id = ?').run(sourceEnrollmentId);
  const retry = await executeStudentPromotion(fixture.adapter, 1, fixture.ids.userA, request);
  assert.equal(retry.ok, true);
  assert.equal(retry.data.already_applied, true);
  assert.equal(Number(row(fixture.database, 'SELECT completed_at FROM student_enrollments WHERE id = ?', sourceEnrollmentId).completed_at), 321);
  fixture.database.close();
});

test('graduated conflicts with an existing later-year enrollment', async () => {
  const fixture = createFixture();
  const { studentId, sourceEnrollmentId } = createPromotionSource(fixture);
  insertEnrollment(fixture.database, fixture.ids, studentId, {
    academic_year_id: fixture.ids.futureA,
    class_id: fixture.ids.classA2,
    section_id: fixture.ids.sectionA2,
  });
  await expectFailure(
    executeStudentPromotion(fixture.adapter, 1, fixture.ids.userA, {
      source_enrollment_id: sourceEnrollmentId,
      action: 'graduated',
    }),
    409,
    'target_enrollment_conflict',
  );
  fixture.database.close();
});

test('graduation guarded write cannot finalize source when a later enrollment appears concurrently', async () => {
  const fixture = createFixture();
  const { studentId, sourceEnrollmentId } = createPromotionSource(fixture);
  fixture.adapter.beforeRun = (statement) => {
    if (!statement.sql.includes("promotion_status = 'graduated'")) return;
    fixture.adapter.beforeRun = null;
    insertEnrollment(fixture.database, fixture.ids, studentId, {
      academic_year_id: fixture.ids.futureA,
      class_id: fixture.ids.classA2,
      section_id: fixture.ids.sectionA2,
    });
  };

  await expectFailure(
    executeStudentPromotion(fixture.adapter, 1, fixture.ids.userA, {
      source_enrollment_id: sourceEnrollmentId,
      action: 'graduated',
    }),
    409,
    'target_enrollment_conflict',
  );
  const source = row(fixture.database, 'SELECT status, promotion_status, completed_at FROM student_enrollments WHERE id = ?', sourceEnrollmentId);
  assert.equal(source.status, 'active');
  assert.equal(source.promotion_status, 'pending');
  assert.equal(source.completed_at, null);
  fixture.database.close();
});

test('target insert failure rolls back source finalization atomically', async () => {
  const fixture = createFixture();
  const { sourceEnrollmentId } = createPromotionSource(fixture);
  fixture.adapter.failAtBatchStatement = 1;
  await assert.rejects(
    executeStudentPromotion(fixture.adapter, 1, fixture.ids.userA, promotionRequest(fixture.ids, sourceEnrollmentId)),
    /simulated promotion target insert failure/,
  );
  const source = row(fixture.database, 'SELECT status, promotion_status, completed_at FROM student_enrollments WHERE id = ?', sourceEnrollmentId);
  assert.equal(source.status, 'active');
  assert.equal(source.promotion_status, 'pending');
  assert.equal(source.completed_at, null);
  assert.equal(Number(row(fixture.database, 'SELECT COUNT(*) AS count FROM student_enrollments WHERE academic_year_id = ?', fixture.ids.futureA).count), 0);
  fixture.database.close();
});

test('promotion leaves prior historical enrollment unchanged', async () => {
  const fixture = createFixture();
  const { studentId, sourceEnrollmentId } = createPromotionSource(fixture);
  const historicalId = insertEnrollment(fixture.database, fixture.ids, studentId, {
    academic_year_id: fixture.ids.pastA,
    status: 'completed',
    promotion_status: 'promoted',
  });
  const historicalBefore = row(fixture.database, 'SELECT * FROM student_enrollments WHERE id = ?', historicalId);
  const result = await executeStudentPromotion(
    fixture.adapter,
    1,
    fixture.ids.userA,
    promotionRequest(fixture.ids, sourceEnrollmentId),
  );
  assert.equal(result.ok, true);
  assert.deepEqual(row(fixture.database, 'SELECT * FROM student_enrollments WHERE id = ?', historicalId), historicalBefore);
  fixture.database.close();
});

test('generic Student placement planning rejects a finalized current enrollment', async () => {
  const fixture = createFixture();
  const { studentId, sourceEnrollmentId } = createPromotionSource(fixture);
  fixture.database.prepare(`
    UPDATE student_enrollments SET status = 'completed', promotion_status = 'promoted' WHERE id = ?
  `).run(sourceEnrollmentId);
  const context = await loadCurrentStudentEnrollmentContext(fixture.adapter, 1, studentId);
  const plan = buildStudentPlacementUpdatePlan(
    { class_id: fixture.ids.classA1, section_id: fixture.ids.sectionA1 },
    context,
    { hasClassId: true, hasSectionId: true, class_id: fixture.ids.classA2, section_id: fixture.ids.sectionA2 },
  );
  assert.deepEqual(plan, { kind: 'reject', code: 'finalized_enrollment' });
  assert.equal(FINALIZED_ENROLLMENT_PLACEMENT_ERROR, 'لا يمكن تعديل صف أو شعبة تسجيل دراسي تم إقفاله/ترفيعه');
  fixture.database.close();
});

test('a concurrent finalization after planning cannot partially update legacy placement', async () => {
  const fixture = createFixture();
  const { studentId, sourceEnrollmentId } = createPromotionSource(fixture);
  const context = await loadCurrentStudentEnrollmentContext(fixture.adapter, 1, studentId);
  const plan = buildStudentPlacementUpdatePlan(
    { class_id: fixture.ids.classA1, section_id: fixture.ids.sectionA1 },
    context,
    { hasClassId: true, hasSectionId: true, class_id: fixture.ids.classA2, section_id: fixture.ids.sectionA2 },
  );
  assert.equal(plan.kind, 'write');
  fixture.database.prepare(`
    UPDATE student_enrollments SET status = 'completed', promotion_status = 'promoted' WHERE id = ?
  `).run(sourceEnrollmentId);

  await assert.rejects(
    updateStudentPlacementAtomically(
      fixture.adapter,
      studentId,
      studentValues(fixture.database, studentId),
      plan,
      fixture.ids.userA,
    ),
    new RegExp(FINALIZED_ENROLLMENT_PLACEMENT_ERROR),
  );
  const student = row(fixture.database, 'SELECT class_id, section_id FROM students WHERE id = ?', studentId);
  const enrollment = row(fixture.database, 'SELECT class_id, section_id FROM student_enrollments WHERE id = ?', sourceEnrollmentId);
  assert.equal(Number(student.class_id), fixture.ids.classA1);
  assert.equal(Number(student.section_id), fixture.ids.sectionA1);
  assert.equal(Number(enrollment.class_id), fixture.ids.classA1);
  assert.equal(Number(enrollment.section_id), fixture.ids.sectionA1);
  fixture.database.close();
});

test('Smart Excel placement update rejects the same finalized enrollment through the shared bridge', async () => {
  const fixture = createFixture();
  const { studentId, sourceEnrollmentId } = createPromotionSource(fixture);
  fixture.database.prepare(`
    UPDATE student_enrollments SET status = 'completed', promotion_status = 'repeated' WHERE id = ?
  `).run(sourceEnrollmentId);
  const result = await persistStudentImportWithEnrollmentBridge(fixture.adapter, {
    existingStudent: { id: studentId, class_id: fixture.ids.classA1, section_id: fixture.ids.sectionA1 },
    student: studentValues(fixture.database, studentId, {
      class_id: fixture.ids.classA2,
      section_id: fixture.ids.sectionA2,
    }),
    placement: {
      hasClassId: true,
      hasSectionId: true,
      class_id: fixture.ids.classA2,
      section_id: fixture.ids.sectionA2,
    },
    userId: fixture.ids.userA,
  });
  assert.deepEqual(result, { ok: false, code: 'finalized_enrollment' });
  fixture.database.close();
});

test('identity-only Student edit remains allowed after enrollment finalization', async () => {
  const fixture = createFixture();
  const { studentId, sourceEnrollmentId } = createPromotionSource(fixture);
  fixture.database.prepare(`
    UPDATE student_enrollments SET status = 'completed', promotion_status = 'promoted' WHERE id = ?
  `).run(sourceEnrollmentId);
  const context = await loadCurrentStudentEnrollmentContext(fixture.adapter, 1, studentId);
  const plan = buildStudentPlacementUpdatePlan(
    { class_id: fixture.ids.classA1, section_id: fixture.ids.sectionA1 },
    context,
    { hasClassId: false, hasSectionId: false, class_id: null, section_id: null },
  );
  assert.equal(plan.kind, 'identity_only');
  await updateStudentIdentityOnly(
    fixture.adapter,
    studentId,
    studentValues(fixture.database, studentId, { phone: '0750-identity-edit' }),
  );
  assert.equal(row(fixture.database, 'SELECT phone FROM students WHERE id = ?', studentId).phone, '0750-identity-edit');
  fixture.database.close();
});

test('identity-only Smart Excel update remains allowed after enrollment finalization', async () => {
  const fixture = createFixture();
  const { studentId, sourceEnrollmentId } = createPromotionSource(fixture);
  fixture.database.prepare(`
    UPDATE student_enrollments SET status = 'completed', promotion_status = 'promoted' WHERE id = ?
  `).run(sourceEnrollmentId);
  const result = await persistStudentImportWithEnrollmentBridge(fixture.adapter, {
    existingStudent: { id: studentId, class_id: fixture.ids.classA1, section_id: fixture.ids.sectionA1 },
    student: studentValues(fixture.database, studentId, { full_name: 'Corrected Student Name' }),
    placement: { hasClassId: false, hasSectionId: false, class_id: null, section_id: null },
    userId: fixture.ids.userA,
  });
  assert.equal(result.ok, true);
  assert.equal(result.action, 'updated');
  assert.equal(row(fixture.database, 'SELECT full_name FROM students WHERE id = ?', studentId).full_name, 'Corrected Student Name');
  fixture.database.close();
});

test('target enrollment uniqueness remains enforced by the database', () => {
  const fixture = createFixture();
  const { studentId } = createPromotionSource(fixture);
  insertEnrollment(fixture.database, fixture.ids, studentId, {
    academic_year_id: fixture.ids.futureA,
    class_id: fixture.ids.classA2,
    section_id: fixture.ids.sectionA2,
  });
  assert.throws(() => insertEnrollment(fixture.database, fixture.ids, studentId, {
    academic_year_id: fixture.ids.futureA,
    class_id: fixture.ids.classA3,
    section_id: fixture.ids.sectionA3,
  }), /UNIQUE constraint failed/);
  fixture.database.close();
});

test('promotion API is management-only and resolves an explicit tenant target before execution', () => {
  const route = workerSource.slice(
    workerSource.indexOf("app.post('/api/student-enrollments/promotion'"),
    workerSource.indexOf("app.post('/api/students'"),
  );
  assert.match(route, /requireSameSchoolOrAdmin\(\), requireRoles\(ACADEMIC_MANAGEMENT_ROLES\)/);
  assert.match(route, /resolveActiveWriteSchool\(db, user, body\.school_id\)/);
  assert.match(route, /executeStudentPromotion\(db, targetSchool\.schoolId, user\.id, body\)/);
  assert.doesNotMatch(route, /students\.(?:class_id|section_id)|UPDATE students/);
});
