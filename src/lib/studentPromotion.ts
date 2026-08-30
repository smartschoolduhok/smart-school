export interface StudentPromotionPreparedStatement {
  bind(...values: unknown[]): StudentPromotionPreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  run(): Promise<StudentPromotionMutationResult>;
}

export interface StudentPromotionMutationResult {
  meta?: { changes?: number };
}

export interface StudentPromotionDatabase {
  prepare(query: string): StudentPromotionPreparedStatement;
  batch(statements: StudentPromotionPreparedStatement[]): Promise<StudentPromotionMutationResult[]>;
}

export type StudentPromotionAction = 'promoted' | 'repeated' | 'graduated';

export interface StudentPromotionRequest {
  source_enrollment_id?: unknown;
  action?: unknown;
  target_academic_year_id?: unknown;
  target_class_id?: unknown;
  target_section_id?: unknown;
}

interface ValidatedPromotionRequest {
  sourceEnrollmentId: number;
  action: StudentPromotionAction;
  targetAcademicYearId: number | null;
  targetClassId: number | null;
  targetSectionId: number | null;
}

interface SourceEnrollmentRecord {
  id: number;
  school_id: number;
  student_id: number;
  academic_year_id: number;
  class_id: number;
  section_id: number | null;
  status: string;
  promotion_status: string;
  completed_at: number | null;
  updated_by_user_id: number | null;
  student_school_id: number;
  student_status: string;
  source_year_school_id: number;
  source_year_starts_at: string;
  source_year_is_active: 0 | 1;
  student_number: string;
  student_full_name: string;
  school_name: string;
  source_year_name: string;
  source_class_name: string;
  source_section_name: string | null;
}

interface AcademicYearRecord {
  id: number;
  school_id: number;
  name: string;
  starts_at: string;
  is_active: 0 | 1;
}

interface SchoolEntityRecord {
  id: number;
  school_id: number;
  name: string;
}

interface SectionRecord extends SchoolEntityRecord {
  class_id: number;
}

interface TargetEnrollmentRecord {
  id: number;
  school_id: number;
  student_id: number;
  academic_year_id: number;
  class_id: number;
  section_id: number | null;
  status: string;
  promotion_status: string;
}

export interface StudentPromotionData {
  student_id: number;
  source_enrollment_id: number;
  source_academic_year_id: number;
  action: StudentPromotionAction;
  target_enrollment_id: number | null;
  target_academic_year_id: number | null;
  already_applied: boolean;
}

export interface StudentPromotionPreviewData {
  valid: true;
  blocking_errors: [];
  warnings: string[];
  student: {
    id: number;
    student_number: string;
    full_name: string;
  };
  school: {
    id: number;
    name: string;
  };
  source: {
    enrollment_id: number;
    academic_year_id: number;
    academic_year_name: string;
    class_id: number;
    class_name: string;
    section_id: number | null;
    section_name: string | null;
    status: string;
    promotion_status: string;
  };
  action: StudentPromotionAction;
  target: {
    academic_year_id: number;
    academic_year_name: string;
    class_id: number;
    class_name: string;
    section_id: number | null;
    section_name: string | null;
    existing_enrollment_id: number | null;
  } | null;
  target_enrollment_exists: boolean;
  already_applied: boolean;
}

export interface InvalidStudentPromotionPreviewData {
  valid: false;
  blocking_errors: string[];
  warnings: [];
  target_enrollment_exists: boolean | null;
  already_applied: false;
}

export type StudentPromotionResult =
  | { ok: true; data: StudentPromotionData }
  | {
      ok: false;
      status: 400 | 403 | 404 | 409;
      code:
        | 'invalid_input'
        | 'wrong_school'
        | 'source_not_found'
        | 'source_not_current_year'
        | 'student_inactive'
        | 'lifecycle_conflict'
        | 'target_year_not_found'
        | 'target_year_active'
        | 'target_year_not_later'
        | 'target_class_not_found'
        | 'target_section_not_found'
        | 'target_section_mismatch'
        | 'target_enrollment_conflict';
      error: string;
    };

type StudentPromotionFailure = Extract<StudentPromotionResult, { ok: false }>;
type StudentPromotionInspectionFailure = StudentPromotionFailure & {
  targetEnrollmentExists?: boolean | null;
};

export type StudentPromotionPreviewResult =
  | { ok: true; data: StudentPromotionPreviewData }
  | (StudentPromotionFailure & { data: InvalidStudentPromotionPreviewData });

interface StudentPromotionInspection {
  request: ValidatedPromotionRequest;
  source: SourceEnrollmentRecord;
  targetYear: AcademicYearRecord | null;
  targetClass: SchoolEntityRecord | null;
  targetSection: SectionRecord | null;
  existingTarget: TargetEnrollmentRecord | null;
  alreadyApplied: boolean;
}

function failure(
  status: 400 | 403 | 404 | 409,
  code: Extract<StudentPromotionResult, { ok: false }>['code'],
  error: string,
): StudentPromotionFailure {
  return { ok: false, status, code, error };
}

function toPositiveInteger(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function createTransitionClaimSentinel(): number {
  const words = new Uint32Array(2);
  crypto.getRandomValues(words);
  const positiveSafeInteger = ((words[0] & 0x000fffff) * 0x100000000) + words[1] + 1;
  return -positiveSafeInteger;
}

function hasNormalCompletionTimestamp(source: SourceEnrollmentRecord): boolean {
  return Number.isInteger(source.completed_at) && Number(source.completed_at) > 0;
}

function hasOwn(input: StudentPromotionRequest, key: keyof StudentPromotionRequest): boolean {
  return Object.prototype.hasOwnProperty.call(input, key);
}

export function validateStudentPromotionRequest(
  input: StudentPromotionRequest,
): { ok: true; value: ValidatedPromotionRequest } | { ok: false; error: string } {
  const sourceEnrollmentId = toPositiveInteger(input.source_enrollment_id);
  if (!sourceEnrollmentId) return { ok: false, error: 'معرف تسجيل الطالب المصدر مطلوب ويجب أن يكون صالحًا' };

  const action = input.action;
  if (action !== 'promoted' && action !== 'repeated' && action !== 'graduated') {
    return { ok: false, error: 'إجراء الانتقال السنوي غير صالح' };
  }

  if (action === 'graduated') {
    if (
      hasOwn(input, 'target_academic_year_id')
      || hasOwn(input, 'target_class_id')
      || hasOwn(input, 'target_section_id')
    ) {
      return { ok: false, error: 'إجراء التخرج لا يقبل سنة أو صفًا أو شعبة مستهدفة' };
    }
    return {
      ok: true,
      value: {
        sourceEnrollmentId,
        action,
        targetAcademicYearId: null,
        targetClassId: null,
        targetSectionId: null,
      },
    };
  }

  const targetAcademicYearId = toPositiveInteger(input.target_academic_year_id);
  const targetClassId = toPositiveInteger(input.target_class_id);
  if (!targetAcademicYearId) return { ok: false, error: 'السنة الدراسية المستهدفة مطلوبة' };
  if (!targetClassId) return { ok: false, error: 'الصف المستهدف مطلوب ويجب تحديده صراحةً' };

  let targetSectionId: number | null = null;
  if (input.target_section_id != null && input.target_section_id !== '') {
    targetSectionId = toPositiveInteger(input.target_section_id);
    if (!targetSectionId) return { ok: false, error: 'الشعبة المستهدفة غير صالحة' };
  }

  return {
    ok: true,
    value: {
      sourceEnrollmentId,
      action,
      targetAcademicYearId,
      targetClassId,
      targetSectionId,
    },
  };
}

async function loadSourceEnrollment(
  db: StudentPromotionDatabase,
  sourceEnrollmentId: number,
): Promise<SourceEnrollmentRecord | null> {
  return db.prepare(`
    SELECT
      source.id,
      source.school_id,
      source.student_id,
      source.academic_year_id,
      source.class_id,
      source.section_id,
      source.status,
      source.promotion_status,
      source.completed_at,
      source.updated_by_user_id,
      student.school_id AS student_school_id,
      student.status AS student_status,
      source_year.school_id AS source_year_school_id,
      source_year.starts_at AS source_year_starts_at,
      source_year.is_active AS source_year_is_active,
      student.student_number,
      student.full_name AS student_full_name,
      school.name AS school_name,
      source_year.name AS source_year_name,
      source_class.name AS source_class_name,
      source_section.name AS source_section_name
    FROM student_enrollments AS source
    INNER JOIN students AS student ON student.id = source.student_id
    INNER JOIN academic_years AS source_year ON source_year.id = source.academic_year_id
    INNER JOIN schools AS school
      ON school.id = source.school_id
     AND school.id = student.school_id
     AND school.id = source_year.school_id
    INNER JOIN classes AS source_class
      ON source_class.id = source.class_id
     AND source_class.school_id = source.school_id
    LEFT JOIN sections AS source_section
      ON source_section.id = source.section_id
     AND source_section.school_id = source.school_id
     AND source_section.class_id = source.class_id
    WHERE source.id = ?
  `).bind(sourceEnrollmentId).first<SourceEnrollmentRecord>();
}

async function loadTargetEnrollment(
  db: StudentPromotionDatabase,
  schoolId: number,
  studentId: number,
  targetAcademicYearId: number,
): Promise<TargetEnrollmentRecord | null> {
  return db.prepare(`
    SELECT id, school_id, student_id, academic_year_id, class_id, section_id,
           status, promotion_status
    FROM student_enrollments
    WHERE school_id = ? AND student_id = ? AND academic_year_id = ?
  `).bind(schoolId, studentId, targetAcademicYearId).first<TargetEnrollmentRecord>();
}

async function hasLaterEnrollment(
  db: StudentPromotionDatabase,
  source: SourceEnrollmentRecord,
): Promise<boolean> {
  const row = await db.prepare(`
    SELECT COUNT(*) AS count
    FROM student_enrollments AS enrollment
    INNER JOIN academic_years AS academic_year
      ON academic_year.id = enrollment.academic_year_id
     AND academic_year.school_id = enrollment.school_id
    WHERE enrollment.school_id = ?
      AND enrollment.student_id = ?
      AND academic_year.starts_at > ?
  `).bind(
    source.school_id,
    source.student_id,
    source.source_year_starts_at,
  ).first<{ count: number }>();
  return Number(row?.count ?? 0) > 0;
}

function exactTargetMatches(
  source: SourceEnrollmentRecord,
  target: TargetEnrollmentRecord | null,
  request: ValidatedPromotionRequest,
): target is TargetEnrollmentRecord {
  return source.status === 'completed'
    && source.promotion_status === request.action
    && hasNormalCompletionTimestamp(source)
    && target != null
    && target.academic_year_id === request.targetAcademicYearId
    && target.class_id === request.targetClassId
    && target.section_id === request.targetSectionId
    && target.status === 'active'
    && target.promotion_status === 'pending';
}

function successData(
  source: SourceEnrollmentRecord,
  action: StudentPromotionAction,
  target: TargetEnrollmentRecord | null,
  alreadyApplied: boolean,
): StudentPromotionResult {
  return {
    ok: true,
    data: {
      student_id: source.student_id,
      source_enrollment_id: source.id,
      source_academic_year_id: source.academic_year_id,
      action,
      target_enrollment_id: target?.id ?? null,
      target_academic_year_id: target?.academic_year_id ?? null,
      already_applied: alreadyApplied,
    },
  };
}

function sourceLifecycleConflict(source: SourceEnrollmentRecord): StudentPromotionFailure {
  if (source.status !== 'active' || source.promotion_status !== 'pending') {
    return failure(409, 'lifecycle_conflict', 'تم إقفال أو إنهاء تسجيل الطالب مسبقًا بإجراء مختلف');
  }
  return failure(409, 'lifecycle_conflict', 'تعذر تطبيق الانتقال بسبب تغير حالة تسجيل الطالب');
}

async function inspectStudentPromotion(
  db: StudentPromotionDatabase,
  schoolId: number,
  input: StudentPromotionRequest,
): Promise<{ ok: true; value: StudentPromotionInspection } | StudentPromotionInspectionFailure> {
  const validation = validateStudentPromotionRequest(input);
  if (!validation.ok) return failure(400, 'invalid_input', validation.error);
  const request = validation.value;

  const source = await loadSourceEnrollment(db, request.sourceEnrollmentId);
  if (!source) return failure(404, 'source_not_found', 'تسجيل الطالب المصدر غير موجود');
  if (
    source.school_id !== schoolId
    || source.student_school_id !== schoolId
    || source.source_year_school_id !== schoolId
  ) {
    return failure(403, 'wrong_school', 'غير مسموح: تسجيل الطالب لا ينتمي إلى المدرسة المستهدفة');
  }
  if (source.source_year_is_active !== 1) {
    return failure(409, 'source_not_current_year', 'لا يمكن تطبيق الانتقال على تسجيل سنة دراسية غير فعالة');
  }
  if (source.student_status !== 'active') {
    return failure(409, 'student_inactive', 'لا يمكن تطبيق الانتقال على طالب غير فعال');
  }

  if (request.action === 'graduated') {
    const laterEnrollmentExists = await hasLaterEnrollment(db, source);
    if (source.status === 'completed' && source.promotion_status === 'graduated') {
      if (laterEnrollmentExists) {
        return {
          ...failure(409, 'target_enrollment_conflict', 'يوجد تسجيل لاحق يتعارض مع قرار التخرج'),
          targetEnrollmentExists: null,
        };
      }
      return {
        ok: true,
        value: {
          request,
          source,
          targetYear: null,
          targetClass: null,
          targetSection: null,
          existingTarget: null,
          alreadyApplied: true,
        },
      };
    }
    if (source.status !== 'active' || source.promotion_status !== 'pending') {
      return sourceLifecycleConflict(source);
    }
    if (laterEnrollmentExists) {
      return {
        ...failure(409, 'target_enrollment_conflict', 'يوجد تسجيل لاحق يتعارض مع قرار التخرج'),
        targetEnrollmentExists: null,
      };
    }
    return {
      ok: true,
      value: {
        request,
        source,
        targetYear: null,
        targetClass: null,
        targetSection: null,
        existingTarget: null,
        alreadyApplied: false,
      },
    };
  }

  const targetAcademicYearId = request.targetAcademicYearId as number;
  const targetClassId = request.targetClassId as number;
  if (targetAcademicYearId === source.academic_year_id) {
    return failure(400, 'invalid_input', 'يجب أن تختلف السنة الدراسية المستهدفة عن سنة المصدر');
  }

  const targetYear = await db.prepare(`
    SELECT id, school_id, name, starts_at, is_active
    FROM academic_years
    WHERE id = ?
  `).bind(targetAcademicYearId).first<AcademicYearRecord>();
  if (!targetYear) return failure(404, 'target_year_not_found', 'السنة الدراسية المستهدفة غير موجودة');
  if (targetYear.school_id !== schoolId) {
    return failure(403, 'wrong_school', 'غير مسموح: السنة الدراسية المستهدفة لا تنتمي إلى المدرسة');
  }
  if (targetYear.is_active !== 0) {
    return failure(409, 'target_year_active', 'يجب أن تكون السنة الدراسية المستهدفة غير فعالة أثناء إعداد الانتقال');
  }
  if (targetYear.starts_at <= source.source_year_starts_at) {
    return failure(400, 'target_year_not_later', 'يجب أن تبدأ السنة الدراسية المستهدفة بعد سنة المصدر');
  }

  const targetClass = await db.prepare('SELECT id, school_id, name FROM classes WHERE id = ?')
    .bind(targetClassId)
    .first<SchoolEntityRecord>();
  if (!targetClass) return failure(404, 'target_class_not_found', 'الصف المستهدف غير موجود');
  if (targetClass.school_id !== schoolId) {
    return failure(403, 'wrong_school', 'غير مسموح: الصف المستهدف لا ينتمي إلى المدرسة');
  }

  let targetSection: SectionRecord | null = null;
  if (request.targetSectionId != null) {
    targetSection = await db.prepare('SELECT id, school_id, class_id, name FROM sections WHERE id = ?')
      .bind(request.targetSectionId)
      .first<SectionRecord>();
    if (!targetSection) return failure(404, 'target_section_not_found', 'الشعبة المستهدفة غير موجودة');
    if (targetSection.school_id !== schoolId) {
      return failure(403, 'wrong_school', 'غير مسموح: الشعبة المستهدفة لا تنتمي إلى المدرسة');
    }
    if (targetSection.class_id !== targetClassId) {
      return failure(400, 'target_section_mismatch', 'الشعبة المستهدفة لا تتبع الصف المستهدف');
    }
  }

  const existingTarget = await loadTargetEnrollment(
    db,
    schoolId,
    source.student_id,
    targetAcademicYearId,
  );
  if (exactTargetMatches(source, existingTarget, request)) {
    return {
      ok: true,
      value: {
        request,
        source,
        targetYear,
        targetClass,
        targetSection,
        existingTarget,
        alreadyApplied: true,
      },
    };
  }
  if (source.status === 'completed' && source.promotion_status === request.action) {
    return {
      ...failure(409, 'target_enrollment_conflict', 'تسجيل السنة المستهدفة مفقود أو لا يطابق قرار الانتقال المطبق'),
      targetEnrollmentExists: existingTarget != null,
    };
  }
  if (source.status !== 'active' || source.promotion_status !== 'pending') {
    return sourceLifecycleConflict(source);
  }
  if (existingTarget) {
    return {
      ...failure(409, 'target_enrollment_conflict', 'يوجد تسجيل للطالب في السنة المستهدفة ببيانات مختلفة'),
      targetEnrollmentExists: true,
    };
  }
  if (await hasLaterEnrollment(db, source)) {
    return {
      ...failure(409, 'target_enrollment_conflict', 'يوجد تسجيل لاحق للطالب يتعارض مع الانتقال المطلوب'),
      targetEnrollmentExists: false,
    };
  }

  return {
    ok: true,
    value: {
      request,
      source,
      targetYear,
      targetClass,
      targetSection,
      existingTarget,
      alreadyApplied: false,
    },
  };
}

export async function previewStudentPromotion(
  db: StudentPromotionDatabase,
  schoolId: number,
  input: StudentPromotionRequest,
): Promise<StudentPromotionPreviewResult> {
  const inspection = await inspectStudentPromotion(db, schoolId, input);
  if (!inspection.ok) {
    return {
      ...inspection,
      data: {
        valid: false,
        blocking_errors: [inspection.error],
        warnings: [],
        target_enrollment_exists: inspection.targetEnrollmentExists
          ?? (inspection.code === 'target_enrollment_conflict' ? null : false),
        already_applied: false,
      },
    };
  }

  const {
    request,
    source,
    targetYear,
    targetClass,
    targetSection,
    existingTarget,
    alreadyApplied,
  } = inspection.value;
  return {
    ok: true,
    data: {
      valid: true,
      blocking_errors: [],
      warnings: alreadyApplied ? ['تم تطبيق القرار نفسه مسبقًا؛ التنفيذ التالي سيكون آمنًا ومتكررًا.'] : [],
      student: {
        id: source.student_id,
        student_number: source.student_number,
        full_name: source.student_full_name,
      },
      school: {
        id: source.school_id,
        name: source.school_name,
      },
      source: {
        enrollment_id: source.id,
        academic_year_id: source.academic_year_id,
        academic_year_name: source.source_year_name,
        class_id: source.class_id,
        class_name: source.source_class_name,
        section_id: source.section_id,
        section_name: source.source_section_name,
        status: source.status,
        promotion_status: source.promotion_status,
      },
      action: request.action,
      target: targetYear && targetClass ? {
        academic_year_id: targetYear.id,
        academic_year_name: targetYear.name,
        class_id: targetClass.id,
        class_name: targetClass.name,
        section_id: targetSection?.id ?? null,
        section_name: targetSection?.name ?? null,
        existing_enrollment_id: existingTarget?.id ?? null,
      } : null,
      target_enrollment_exists: existingTarget != null,
      already_applied: alreadyApplied,
    },
  };
}

function buildTransitionBatch(
  db: StudentPromotionDatabase,
  source: SourceEnrollmentRecord,
  request: ValidatedPromotionRequest,
  userId: number,
  claimSentinel: number,
): StudentPromotionPreparedStatement[] {
  const targetAcademicYearId = request.targetAcademicYearId as number;
  const targetClassId = request.targetClassId as number;
  const targetSectionId = request.targetSectionId;

  const finalizeSource = db.prepare(`
    UPDATE student_enrollments AS source
    SET status = 'completed',
        promotion_status = ?,
        completed_at = ?,
        updated_by_user_id = ?
    WHERE source.id = ?
      AND source.school_id = ?
      AND source.academic_year_id = ?
      AND source.status = 'active'
      AND source.promotion_status = 'pending'
      AND EXISTS (
        SELECT 1 FROM students AS student
        WHERE student.id = source.student_id
          AND student.school_id = source.school_id
          AND student.status = 'active'
      )
      AND EXISTS (
        SELECT 1
        FROM academic_years AS source_year
        INNER JOIN academic_years AS target_year
          ON target_year.id = ?
         AND target_year.school_id = source_year.school_id
         AND target_year.is_active = 0
         AND target_year.starts_at > source_year.starts_at
        WHERE source_year.id = source.academic_year_id
          AND source_year.school_id = source.school_id
          AND source_year.is_active = 1
      )
      AND EXISTS (
        SELECT 1 FROM classes AS target_class
        WHERE target_class.id = ? AND target_class.school_id = source.school_id
      )
      AND (
        ? IS NULL
        OR EXISTS (
          SELECT 1 FROM sections AS target_section
          WHERE target_section.id = ?
            AND target_section.school_id = source.school_id
            AND target_section.class_id = ?
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM student_enrollments AS later_enrollment
        INNER JOIN academic_years AS later_year
          ON later_year.id = later_enrollment.academic_year_id
         AND later_year.school_id = later_enrollment.school_id
        INNER JOIN academic_years AS source_year
          ON source_year.id = source.academic_year_id
         AND source_year.school_id = source.school_id
        WHERE later_enrollment.school_id = source.school_id
          AND later_enrollment.student_id = source.student_id
          AND later_year.starts_at > source_year.starts_at
      )
  `).bind(
    request.action,
    claimSentinel,
    userId,
    source.id,
    source.school_id,
    source.academic_year_id,
    targetAcademicYearId,
    targetClassId,
    targetSectionId,
    targetSectionId,
    targetClassId,
  );

  const createTarget = db.prepare(`
    INSERT INTO student_enrollments (
      school_id, student_id, academic_year_id, class_id, section_id,
      status, promotion_status, created_by_user_id, updated_by_user_id
    )
    SELECT
      source.school_id,
      source.student_id,
      ?,
      ?,
      ?,
      'active',
      'pending',
      ?,
      ?
    FROM student_enrollments AS source
    INNER JOIN students AS student
      ON student.id = source.student_id
     AND student.school_id = source.school_id
     AND student.status = 'active'
    INNER JOIN academic_years AS source_year
      ON source_year.id = source.academic_year_id
     AND source_year.school_id = source.school_id
     AND source_year.is_active = 1
    INNER JOIN academic_years AS target_year
      ON target_year.id = ?
     AND target_year.school_id = source.school_id
     AND target_year.is_active = 0
     AND target_year.starts_at > source_year.starts_at
    INNER JOIN classes AS target_class
      ON target_class.id = ?
     AND target_class.school_id = source.school_id
    WHERE source.id = ?
      AND source.school_id = ?
      AND source.academic_year_id = ?
      AND source.status = 'completed'
      AND source.promotion_status = ?
      AND source.completed_at = ?
      AND (
        ? IS NULL
        OR EXISTS (
          SELECT 1 FROM sections AS target_section
          WHERE target_section.id = ?
            AND target_section.school_id = source.school_id
            AND target_section.class_id = ?
        )
      )
  `).bind(
    targetAcademicYearId,
    targetClassId,
    targetSectionId,
    userId,
    userId,
    targetAcademicYearId,
    targetClassId,
    source.id,
    source.school_id,
    source.academic_year_id,
    request.action,
    claimSentinel,
    targetSectionId,
    targetSectionId,
    targetClassId,
  );

  const normalizeSource = db.prepare(`
    UPDATE student_enrollments
    SET completed_at = unixepoch()
    WHERE id = ?
      AND school_id = ?
      AND academic_year_id = ?
      AND status = 'completed'
      AND promotion_status = ?
      AND completed_at = ?
  `).bind(
    source.id,
    source.school_id,
    source.academic_year_id,
    request.action,
    claimSentinel,
  );

  return [finalizeSource, createTarget, normalizeSource];
}

export async function executeStudentPromotion(
  db: StudentPromotionDatabase,
  schoolId: number,
  userId: number,
  input: StudentPromotionRequest,
): Promise<StudentPromotionResult> {
  // Rebuild the transition from fresh database state on every execution.
  // A successful preview is intentionally never trusted as authorization to write.
  const inspection = await inspectStudentPromotion(db, schoolId, input);
  if (!inspection.ok) return inspection;
  const { request, source, existingTarget, alreadyApplied } = inspection.value;

  if (alreadyApplied) {
    return successData(source, request.action, existingTarget, true);
  }

  if (request.action === 'graduated') {
    const mutation = await db.prepare(`
      UPDATE student_enrollments AS source
      SET status = 'completed',
          promotion_status = 'graduated',
          completed_at = unixepoch(),
          updated_by_user_id = ?
      WHERE source.id = ?
        AND source.school_id = ?
        AND source.academic_year_id = ?
        AND source.status = 'active'
        AND source.promotion_status = 'pending'
        AND EXISTS (
          SELECT 1 FROM students AS student
          WHERE student.id = source.student_id
            AND student.school_id = source.school_id
            AND student.status = 'active'
        )
        AND EXISTS (
          SELECT 1 FROM academic_years AS source_year
          WHERE source_year.id = source.academic_year_id
            AND source_year.school_id = source.school_id
            AND source_year.is_active = 1
        )
        AND NOT EXISTS (
          SELECT 1
          FROM student_enrollments AS later_enrollment
          INNER JOIN academic_years AS later_year
            ON later_year.id = later_enrollment.academic_year_id
           AND later_year.school_id = later_enrollment.school_id
          INNER JOIN academic_years AS source_year
            ON source_year.id = source.academic_year_id
           AND source_year.school_id = source.school_id
          WHERE later_enrollment.school_id = source.school_id
            AND later_enrollment.student_id = source.student_id
            AND later_year.starts_at > source_year.starts_at
        )
    `).bind(userId, source.id, schoolId, source.academic_year_id).run();

    const finalized = await loadSourceEnrollment(db, source.id);
    if (finalized) {
      const concurrentTargetExists = await hasLaterEnrollment(db, finalized);
      if (
        finalized.status === 'completed'
        && finalized.promotion_status === 'graduated'
        && !concurrentTargetExists
      ) {
        return successData(finalized, request.action, null, mutation.meta?.changes === 0);
      }
      if (concurrentTargetExists) {
        return failure(409, 'target_enrollment_conflict', 'يوجد تسجيل لاحق يتعارض مع قرار التخرج');
      }
    }
    return sourceLifecycleConflict(finalized ?? source);
  }

  const targetAcademicYearId = request.targetAcademicYearId as number;

  const claimSentinel = createTransitionClaimSentinel();
  let batchResults: StudentPromotionMutationResult[];
  try {
    batchResults = await db.batch(buildTransitionBatch(db, source, request, userId, claimSentinel));
  } catch (error) {
    const concurrentSource = await loadSourceEnrollment(db, source.id);
    const concurrentTarget = await loadTargetEnrollment(
      db,
      schoolId,
      source.student_id,
      targetAcademicYearId,
    );
    const concurrentLaterEnrollment = concurrentSource
      ? await hasLaterEnrollment(db, concurrentSource)
      : false;
    if (concurrentSource && exactTargetMatches(concurrentSource, concurrentTarget, request)) {
      return successData(concurrentSource, request.action, concurrentTarget, true);
    }
    if (
      concurrentTarget
      || concurrentLaterEnrollment
      || (concurrentSource && (
        concurrentSource.status !== 'active'
        || concurrentSource.promotion_status !== 'pending'
      ))
    ) {
      return failure(409, 'target_enrollment_conflict', 'تغير تسجيل الطالب بالتزامن مع تنفيذ الانتقال');
    }
    throw error;
  }

  const finalizedSource = await loadSourceEnrollment(db, source.id);
  const createdTarget = await loadTargetEnrollment(
    db,
    schoolId,
    source.student_id,
    targetAcademicYearId,
  );
  if (
    !finalizedSource
    || finalizedSource.completed_at === claimSentinel
    || !exactTargetMatches(finalizedSource, createdTarget, request)
  ) {
    return failure(409, 'target_enrollment_conflict', 'لم تُمتلك عملية الانتقال أو تغير تسجيل الطالب بالتزامن');
  }

  const claimChanges = batchResults[0]?.meta?.changes;
  const insertChanges = batchResults[1]?.meta?.changes;
  const normalizeChanges = batchResults[2]?.meta?.changes;
  if (claimChanges === 0) {
    return successData(finalizedSource, request.action, createdTarget, true);
  }
  if (insertChanges === 0 || normalizeChanges === 0) {
    return failure(409, 'lifecycle_conflict', 'لم تكتمل عملية الانتقال السنوي بالحالة المتوقعة');
  }
  return successData(finalizedSource, request.action, createdTarget, false);
}
