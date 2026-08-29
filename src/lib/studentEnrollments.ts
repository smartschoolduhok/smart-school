import type { StudentReligion } from './studentReligion.ts';

export interface StudentEnrollmentPreparedStatement {
  bind(...values: unknown[]): StudentEnrollmentPreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results?: T[] }>;
  run(): Promise<StudentEnrollmentMutationResult>;
}

export interface StudentEnrollmentMutationResult {
  meta?: { changes?: number };
}

export interface StudentEnrollmentDatabase {
  prepare(query: string): StudentEnrollmentPreparedStatement;
  batch(statements: StudentEnrollmentPreparedStatement[]): Promise<StudentEnrollmentMutationResult[]>;
}

export interface ActiveAcademicYear {
  id: number;
  school_id: number;
  name: string;
  starts_at: string;
  ends_at: string;
}

export interface CurrentStudentEnrollment {
  id: number;
  school_id: number;
  student_id: number;
  academic_year_id: number;
  class_id: number;
  section_id: number | null;
  status: string;
  promotion_status: string;
}

export interface StudentEnrollmentContext {
  activeAcademicYear: ActiveAcademicYear | null;
  enrollment: CurrentStudentEnrollment | null;
}

export interface StudentLegacyPlacement {
  class_id: number | null;
  section_id: number | null;
}

export interface EffectiveStudentPlacement extends StudentLegacyPlacement {
  current_enrollment_id: number | null;
  current_academic_year_id: number | null;
  current_academic_year_name: string | null;
  current_enrollment_status: string | null;
  current_promotion_status: string | null;
}

export interface EffectiveStudentRecord extends EffectiveStudentPlacement {
  id: number;
  school_id: number;
  student_number: string;
  full_name: string;
  father_name: string | null;
  mother_name: string | null;
  gender: string;
  religion: StudentReligion | null;
  birth_date: string | null;
  phone: string | null;
  guardian_name: string | null;
  guardian_phone: string | null;
  address: string | null;
  status: string;
  photo_url: string | null;
  notes: string | null;
  created_at: number;
  updated_at: number;
  class_name: string | null;
  section_name: string | null;
}

export interface StudentEnrollmentHistoryRecord {
  id: number;
  academic_year_id: number;
  academic_year_name: string;
  starts_at: string;
  ends_at: string;
  class_id: number;
  class_name: string;
  section_id: number | null;
  section_name: string | null;
  status: string;
  promotion_status: string;
  enrolled_at: number | null;
  completed_at: number | null;
  notes: string | null;
  created_at: number;
  updated_at: number;
}

export interface StudentWriteValues extends StudentLegacyPlacement {
  school_id: number;
  student_number: string;
  full_name: string;
  father_name: string | null;
  mother_name: string | null;
  gender: string;
  religion: StudentReligion | null;
  birth_date: string | null;
  phone: string | null;
  guardian_name: string | null;
  guardian_phone: string | null;
  address: string | null;
  status: string;
  photo_url: string | null;
  notes: string | null;
}

export interface PersistedStudentSummary extends StudentLegacyPlacement {
  id: number;
  school_id: number;
  student_number: string;
  full_name: string;
  religion: StudentReligion | null;
  status: string;
}

export interface StudentPlacementUpdateInput {
  hasClassId: boolean;
  hasSectionId: boolean;
  class_id: number | null;
  section_id: number | null;
}

export type StudentPlacementUpdatePlan =
  | { kind: 'identity_only'; effectivePlacement: EffectiveStudentPlacement }
  | {
      kind: 'reject';
      code: 'active_year_required' | 'cannot_clear_enrollment' | 'class_required' | 'finalized_enrollment';
    }
  | {
      kind: 'write';
      activeAcademicYear: ActiveAcademicYear;
      enrollment: CurrentStudentEnrollment | null;
      class_id: number;
      section_id: number | null;
    };

export type StudentCreationResult =
  | { ok: true; student: PersistedStudentSummary }
  | { ok: false; code: 'active_year_required' };

export interface StudentImportBridgeInput {
  existingStudent: Pick<EffectiveStudentRecord, 'id' | 'class_id' | 'section_id'> | null;
  student: StudentWriteValues;
  placement: StudentPlacementUpdateInput;
  userId: number;
}

export type StudentImportBridgeResult =
  | { ok: true; action: 'created' | 'updated'; student: EffectiveStudentRecord }
  | {
      ok: false;
      code: 'active_year_required' | 'cannot_clear_enrollment' | 'class_required' | 'finalized_enrollment';
    };

export const FINALIZED_ENROLLMENT_PLACEMENT_ERROR = 'لا يمكن تعديل صف أو شعبة تسجيل دراسي تم إقفاله/ترفيعه';

export class FinalizedEnrollmentPlacementError extends Error {
  constructor() {
    super(FINALIZED_ENROLLMENT_PLACEMENT_ERROR);
    this.name = 'FinalizedEnrollmentPlacementError';
  }
}

const EFFECTIVE_CLASS_ID_SQL = `
  CASE WHEN active_year.id IS NULL THEN student.class_id ELSE current_enrollment.class_id END
`;
const EFFECTIVE_SECTION_ID_SQL = `
  CASE WHEN active_year.id IS NULL THEN student.section_id ELSE current_enrollment.section_id END
`;

const EFFECTIVE_STUDENT_SELECT = `
  SELECT
    student.id,
    student.school_id,
    student.student_number,
    student.full_name,
    student.father_name,
    student.mother_name,
    student.gender,
    student.religion,
    student.birth_date,
    student.phone,
    student.guardian_name,
    student.guardian_phone,
    student.address,
    ${EFFECTIVE_CLASS_ID_SQL} AS class_id,
    ${EFFECTIVE_SECTION_ID_SQL} AS section_id,
    student.status,
    student.photo_url,
    student.notes,
    student.created_at,
    student.updated_at,
    class.name AS class_name,
    section.name AS section_name,
    current_enrollment.id AS current_enrollment_id,
    active_year.id AS current_academic_year_id,
    active_year.name AS current_academic_year_name,
    current_enrollment.status AS current_enrollment_status,
    current_enrollment.promotion_status AS current_promotion_status
  FROM students AS student
  LEFT JOIN academic_years AS active_year
    ON active_year.school_id = student.school_id
   AND active_year.is_active = 1
  LEFT JOIN student_enrollments AS current_enrollment
    ON current_enrollment.school_id = student.school_id
   AND current_enrollment.student_id = student.id
   AND current_enrollment.academic_year_id = active_year.id
  LEFT JOIN classes AS class
    ON class.id = ${EFFECTIVE_CLASS_ID_SQL}
   AND class.school_id = student.school_id
  LEFT JOIN sections AS section
    ON section.id = ${EFFECTIVE_SECTION_ID_SQL}
   AND section.school_id = student.school_id
`;

function studentInsertStatement(
  db: StudentEnrollmentDatabase,
  student: StudentWriteValues,
  returning: boolean,
): StudentEnrollmentPreparedStatement {
  return db.prepare(`
    INSERT INTO students (
      school_id, student_number, full_name, father_name, mother_name,
      gender, religion, birth_date, phone, guardian_name, guardian_phone,
      address, class_id, section_id, status, photo_url, notes,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())
    ${returning ? 'RETURNING id, school_id, student_number, full_name, religion, class_id, section_id, status' : ''}
  `).bind(
    student.school_id,
    student.student_number,
    student.full_name,
    student.father_name,
    student.mother_name,
    student.gender,
    student.religion,
    student.birth_date,
    student.phone,
    student.guardian_name,
    student.guardian_phone,
    student.address,
    student.class_id,
    student.section_id,
    student.status,
    student.photo_url,
    student.notes,
  );
}

function studentUpdateStatement(
  db: StudentEnrollmentDatabase,
  studentId: number,
  student: StudentWriteValues,
  includePlacement: boolean,
  requiredMutableEnrollment: CurrentStudentEnrollment | null = null,
): StudentEnrollmentPreparedStatement {
  const placementSql = includePlacement ? 'class_id = ?, section_id = ?,' : '';
  const values: unknown[] = [
    student.student_number,
    student.full_name,
    student.father_name,
    student.mother_name,
    student.gender,
    student.religion,
    student.birth_date,
    student.phone,
    student.guardian_name,
    student.guardian_phone,
    student.address,
  ];
  if (includePlacement) values.push(student.class_id, student.section_id);
  values.push(
    student.photo_url,
    student.notes,
    student.status,
    studentId,
    student.school_id,
  );
  if (requiredMutableEnrollment) {
    values.push(
      requiredMutableEnrollment.id,
      student.school_id,
      studentId,
      requiredMutableEnrollment.academic_year_id,
    );
  }

  const mutableEnrollmentGuard = requiredMutableEnrollment
    ? `AND EXISTS (
        SELECT 1 FROM student_enrollments AS mutable_enrollment
        WHERE mutable_enrollment.id = ?
          AND mutable_enrollment.school_id = ?
          AND mutable_enrollment.student_id = ?
          AND mutable_enrollment.academic_year_id = ?
          AND mutable_enrollment.status = 'active'
          AND mutable_enrollment.promotion_status = 'pending'
      )`
    : '';

  return db.prepare(`
    UPDATE students SET
      student_number = ?, full_name = ?, father_name = ?, mother_name = ?,
      gender = ?, religion = ?, birth_date = ?, phone = ?, guardian_name = ?, guardian_phone = ?,
      address = ?, ${placementSql} photo_url = ?, notes = ?, status = ?,
      updated_at = unixepoch()
    WHERE id = ? AND school_id = ?
      ${mutableEnrollmentGuard}
  `).bind(...values);
}

export async function resolveActiveAcademicYear(
  db: StudentEnrollmentDatabase,
  schoolId: number,
): Promise<ActiveAcademicYear | null> {
  return db.prepare(`
    SELECT id, school_id, name, starts_at, ends_at
    FROM academic_years
    WHERE school_id = ? AND is_active = 1
    ORDER BY id DESC
    LIMIT 1
  `).bind(schoolId).first<ActiveAcademicYear>();
}

export async function loadCurrentStudentEnrollmentContext(
  db: StudentEnrollmentDatabase,
  schoolId: number,
  studentId: number,
): Promise<StudentEnrollmentContext> {
  const activeAcademicYear = await resolveActiveAcademicYear(db, schoolId);
  if (!activeAcademicYear) return { activeAcademicYear: null, enrollment: null };

  const enrollment = await db.prepare(`
    SELECT id, school_id, student_id, academic_year_id, class_id, section_id,
           status, promotion_status
    FROM student_enrollments
    WHERE school_id = ? AND student_id = ? AND academic_year_id = ?
  `).bind(schoolId, studentId, activeAcademicYear.id).first<CurrentStudentEnrollment>();
  return { activeAcademicYear, enrollment };
}

export function resolveEffectiveCurrentPlacement(
  legacyPlacement: StudentLegacyPlacement,
  context: StudentEnrollmentContext,
): EffectiveStudentPlacement {
  if (!context.activeAcademicYear) {
    return {
      class_id: legacyPlacement.class_id,
      section_id: legacyPlacement.section_id,
      current_enrollment_id: null,
      current_academic_year_id: null,
      current_academic_year_name: null,
      current_enrollment_status: null,
      current_promotion_status: null,
    };
  }

  return {
    class_id: context.enrollment?.class_id ?? null,
    section_id: context.enrollment?.section_id ?? null,
    current_enrollment_id: context.enrollment?.id ?? null,
    current_academic_year_id: context.activeAcademicYear.id,
    current_academic_year_name: context.activeAcademicYear.name,
    current_enrollment_status: context.enrollment?.status ?? null,
    current_promotion_status: context.enrollment?.promotion_status ?? null,
  };
}

export function buildStudentPlacementUpdatePlan(
  legacyPlacement: StudentLegacyPlacement,
  context: StudentEnrollmentContext,
  input: StudentPlacementUpdateInput,
): StudentPlacementUpdatePlan {
  const effectivePlacement = resolveEffectiveCurrentPlacement(legacyPlacement, context);
  const requestedClassId = input.hasClassId ? input.class_id : effectivePlacement.class_id;
  const requestedSectionId = input.hasSectionId ? input.section_id : effectivePlacement.section_id;
  const placementChanged = (input.hasClassId || input.hasSectionId)
    && (requestedClassId !== effectivePlacement.class_id || requestedSectionId !== effectivePlacement.section_id);

  if (!placementChanged) return { kind: 'identity_only', effectivePlacement };
  if (!context.activeAcademicYear) return { kind: 'reject', code: 'active_year_required' };
  if (
    context.enrollment
    && (context.enrollment.status !== 'active' || context.enrollment.promotion_status !== 'pending')
  ) {
    return { kind: 'reject', code: 'finalized_enrollment' };
  }
  if (context.enrollment && requestedClassId == null) {
    return { kind: 'reject', code: 'cannot_clear_enrollment' };
  }
  if (requestedClassId == null) {
    return { kind: 'reject', code: 'class_required' };
  }

  return {
    kind: 'write',
    activeAcademicYear: context.activeAcademicYear,
    enrollment: context.enrollment,
    class_id: requestedClassId,
    section_id: requestedSectionId,
  };
}

export async function listStudentsWithEffectivePlacement(
  db: StudentEnrollmentDatabase,
  filters: {
    schoolId?: number | null;
    classId?: string | number | null;
    sectionId?: string | number | null;
  },
): Promise<EffectiveStudentRecord[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (filters.schoolId != null) {
    conditions.push('student.school_id = ?');
    values.push(filters.schoolId);
  }
  if (filters.classId != null && filters.classId !== '') {
    conditions.push(`${EFFECTIVE_CLASS_ID_SQL} = ?`);
    values.push(filters.classId);
  }
  if (filters.sectionId != null && filters.sectionId !== '') {
    conditions.push(`${EFFECTIVE_SECTION_ID_SQL} = ?`);
    values.push(filters.sectionId);
  }

  const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const response = await db.prepare(`
    ${EFFECTIVE_STUDENT_SELECT}
    ${whereSql}
    ORDER BY ${EFFECTIVE_CLASS_ID_SQL}, ${EFFECTIVE_SECTION_ID_SQL}, student.full_name
  `).bind(...values).all<EffectiveStudentRecord>();
  return response.results ?? [];
}

export async function getStudentWithEffectivePlacement(
  db: StudentEnrollmentDatabase,
  studentId: number,
): Promise<EffectiveStudentRecord | null> {
  return db.prepare(`
    ${EFFECTIVE_STUDENT_SELECT}
    WHERE student.id = ?
  `).bind(studentId).first<EffectiveStudentRecord>();
}

export async function listStudentEnrollmentHistory(
  db: StudentEnrollmentDatabase,
  schoolId: number,
  studentId: number,
): Promise<StudentEnrollmentHistoryRecord[]> {
  const response = await db.prepare(`
    SELECT
      enrollment.id,
      enrollment.academic_year_id,
      academic_year.name AS academic_year_name,
      academic_year.starts_at,
      academic_year.ends_at,
      enrollment.class_id,
      class.name AS class_name,
      enrollment.section_id,
      section.name AS section_name,
      enrollment.status,
      enrollment.promotion_status,
      enrollment.enrolled_at,
      enrollment.completed_at,
      enrollment.notes,
      enrollment.created_at,
      enrollment.updated_at
    FROM student_enrollments AS enrollment
    INNER JOIN academic_years AS academic_year
      ON academic_year.id = enrollment.academic_year_id
     AND academic_year.school_id = enrollment.school_id
    INNER JOIN classes AS class
      ON class.id = enrollment.class_id
     AND class.school_id = enrollment.school_id
    LEFT JOIN sections AS section
      ON section.id = enrollment.section_id
     AND section.school_id = enrollment.school_id
     AND section.class_id = enrollment.class_id
    WHERE enrollment.school_id = ? AND enrollment.student_id = ?
    ORDER BY academic_year.starts_at DESC, academic_year.ends_at DESC,
             academic_year.id DESC, enrollment.id DESC
  `).bind(schoolId, studentId).all<StudentEnrollmentHistoryRecord>();
  return response.results ?? [];
}

export async function createStudentWithEnrollmentBridge(
  db: StudentEnrollmentDatabase,
  student: StudentWriteValues,
  createdByUserId: number,
): Promise<StudentCreationResult> {
  if (student.class_id == null) {
    const created = await studentInsertStatement(db, student, true).first<PersistedStudentSummary>();
    if (!created) throw new Error('Student creation did not persist');
    return { ok: true, student: created };
  }

  const activeAcademicYear = await resolveActiveAcademicYear(db, student.school_id);
  if (!activeAcademicYear) return { ok: false, code: 'active_year_required' };

  await db.batch([
    studentInsertStatement(db, student, false),
    db.prepare(`
      INSERT INTO student_enrollments (
        school_id, student_id, academic_year_id, class_id, section_id,
        status, promotion_status, created_by_user_id
      )
      SELECT student.school_id, student.id, ?, student.class_id, student.section_id,
             'active', 'pending', ?
      FROM students AS student
      WHERE student.school_id = ? AND student.student_number = ?
    `).bind(
      activeAcademicYear.id,
      createdByUserId,
      student.school_id,
      student.student_number,
    ),
  ]);

  const created = await db.prepare(`
    SELECT id, school_id, student_number, full_name, religion, class_id, section_id, status
    FROM students
    WHERE school_id = ? AND student_number = ?
  `).bind(student.school_id, student.student_number).first<PersistedStudentSummary>();
  if (!created) throw new Error('Atomic student creation did not persist');
  return { ok: true, student: created };
}

export async function updateStudentIdentityOnly(
  db: StudentEnrollmentDatabase,
  studentId: number,
  student: StudentWriteValues,
): Promise<void> {
  await studentUpdateStatement(db, studentId, student, false).run();
}

export async function updateStudentPlacementAtomically(
  db: StudentEnrollmentDatabase,
  studentId: number,
  student: StudentWriteValues,
  plan: Extract<StudentPlacementUpdatePlan, { kind: 'write' }>,
  updatedByUserId: number,
): Promise<void> {
  const synchronizedStudent = {
    ...student,
    class_id: plan.class_id,
    section_id: plan.section_id,
  };
  const enrollmentStatement = plan.enrollment
    ? db.prepare(`
        UPDATE student_enrollments
        SET class_id = ?, section_id = ?, updated_by_user_id = ?
        WHERE id = ? AND school_id = ? AND student_id = ? AND academic_year_id = ?
          AND status = 'active' AND promotion_status = 'pending'
      `).bind(
        plan.class_id,
        plan.section_id,
        updatedByUserId,
        plan.enrollment.id,
        student.school_id,
        studentId,
        plan.activeAcademicYear.id,
      )
    : db.prepare(`
        INSERT INTO student_enrollments (
          school_id, student_id, academic_year_id, class_id, section_id,
          status, promotion_status, created_by_user_id, updated_by_user_id
        )
        SELECT student.school_id, student.id, ?, student.class_id, student.section_id,
               'active', 'pending', ?, ?
        FROM students AS student
        WHERE student.id = ? AND student.school_id = ?
      `).bind(
        plan.activeAcademicYear.id,
        updatedByUserId,
        updatedByUserId,
        studentId,
        student.school_id,
      );

  const results = plan.enrollment
    ? await db.batch([
        enrollmentStatement,
        studentUpdateStatement(db, studentId, synchronizedStudent, true, plan.enrollment),
      ])
    : await db.batch([
        studentUpdateStatement(db, studentId, synchronizedStudent, true),
        enrollmentStatement,
      ]);

  if (plan.enrollment && results[0]?.meta?.changes === 0) {
    const context = await loadCurrentStudentEnrollmentContext(db, student.school_id, studentId);
    if (
      context.enrollment
      && (context.enrollment.status !== 'active' || context.enrollment.promotion_status !== 'pending')
    ) {
      throw new FinalizedEnrollmentPlacementError();
    }
    throw new Error('Atomic student enrollment placement update did not persist');
  }

  const persistedStudent = await db.prepare(
    'SELECT class_id, section_id FROM students WHERE id = ? AND school_id = ?',
  ).bind(studentId, student.school_id).first<StudentLegacyPlacement>();
  const persistedContext = await loadCurrentStudentEnrollmentContext(db, student.school_id, studentId);
  if (
    !persistedStudent
    || persistedStudent.class_id !== plan.class_id
    || persistedStudent.section_id !== plan.section_id
    || persistedContext.enrollment?.class_id !== plan.class_id
    || persistedContext.enrollment?.section_id !== plan.section_id
  ) {
    if (
      persistedContext.enrollment
      && (
        persistedContext.enrollment.status !== 'active'
        || persistedContext.enrollment.promotion_status !== 'pending'
      )
    ) {
      throw new FinalizedEnrollmentPlacementError();
    }
    throw new Error('Atomic student placement synchronization did not persist');
  }
}

export async function persistStudentImportWithEnrollmentBridge(
  db: StudentEnrollmentDatabase,
  input: StudentImportBridgeInput,
): Promise<StudentImportBridgeResult> {
  if (!input.existingStudent) {
    const creation = await createStudentWithEnrollmentBridge(db, input.student, input.userId);
    if (!creation.ok) return creation;
    const created = await getStudentWithEffectivePlacement(db, creation.student.id);
    if (!created) throw new Error('Imported student creation did not persist');
    return { ok: true, action: 'created', student: created };
  }

  const enrollmentContext = await loadCurrentStudentEnrollmentContext(
    db,
    input.student.school_id,
    input.existingStudent.id,
  );
  const placementPlan = buildStudentPlacementUpdatePlan(
    {
      class_id: input.existingStudent.class_id,
      section_id: input.existingStudent.section_id,
    },
    enrollmentContext,
    input.placement,
  );
  if (placementPlan.kind === 'reject') {
    return { ok: false, code: placementPlan.code };
  }

  if (placementPlan.kind === 'write') {
    await updateStudentPlacementAtomically(
      db,
      input.existingStudent.id,
      input.student,
      placementPlan,
      input.userId,
    );
  } else {
    await updateStudentIdentityOnly(db, input.existingStudent.id, input.student);
  }

  const updated = await getStudentWithEffectivePlacement(db, input.existingStudent.id);
  if (!updated) throw new Error('Imported student update did not persist');
  return { ok: true, action: 'updated', student: updated };
}

export async function archiveStudentWithoutEnrollmentMutation(
  db: StudentEnrollmentDatabase,
  studentId: number,
  schoolId: number,
): Promise<void> {
  await db.prepare(`
    UPDATE students
    SET status = 'archived', updated_at = unixepoch()
    WHERE id = ? AND school_id = ?
  `).bind(studentId, schoolId).run();
}
