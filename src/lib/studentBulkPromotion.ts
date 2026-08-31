import {
  createTransitionClaimSentinel,
  inspectStudentPromotions,
  type SourceEnrollmentRecord,
  type StudentPromotionAction,
  type StudentPromotionDatabase,
  type StudentPromotionInspection,
  type StudentPromotionInspectionResult,
  type StudentPromotionPreviewData,
  type StudentPromotionRequest,
} from './studentPromotion.ts';

// One Iraqi classroom-sized cohort: this matches the project's default section capacity.
// The implementation sends JSON bind values and at most six fixed D1 statements, so
// the bound stays well below D1's per-query parameter and per-invocation query limits.
export const MAX_BULK_PROMOTION_ROWS = 30;

export type BulkStudentPromotionAction = StudentPromotionAction | 'skipped';

export interface BulkStudentPromotionRequest {
  source_academic_year_id?: unknown;
  source_class_id?: unknown;
  source_section_id?: unknown;
  target_academic_year_id?: unknown;
  rows?: unknown;
}

export interface BulkStudentPromotionRowRequest {
  source_enrollment_id?: unknown;
  action?: unknown;
  target_class_id?: unknown;
  target_section_id?: unknown;
  target_academic_year_id?: unknown;
}

interface ValidatedBulkRow {
  sourceEnrollmentId: number;
  action: BulkStudentPromotionAction;
  targetClassId: number | null;
  targetSectionId: number | null;
}

interface ValidatedBulkRequest {
  sourceAcademicYearId: number;
  sourceClassId: number;
  sourceSectionId: number | null;
  targetAcademicYearId: number | null;
  rows: ValidatedBulkRow[];
}

export interface BulkStudentPromotionPreviewRow {
  source_enrollment_id: number;
  action: BulkStudentPromotionAction;
  state: 'valid' | 'invalid' | 'skipped';
  valid: boolean;
  skipped: boolean;
  blocking_errors: string[];
  warnings: string[];
  student: StudentPromotionPreviewData['student'] | null;
  source: StudentPromotionPreviewData['source'] | null;
  target: StudentPromotionPreviewData['target'];
  target_enrollment_exists: boolean | null;
  already_applied: boolean;
}

export interface BulkStudentPromotionSummary {
  total: number;
  selected: number;
  valid: number;
  invalid: number;
  skipped: number;
  already_applied: number;
  promoted: number;
  repeated: number;
  graduated: number;
}

export interface BulkStudentPromotionPreviewData {
  valid: boolean;
  atomic: true;
  max_rows: number;
  rows: BulkStudentPromotionPreviewRow[];
  summary: BulkStudentPromotionSummary;
}

export interface BulkStudentPromotionExecutionRow {
  source_enrollment_id: number;
  student_id: number | null;
  action: BulkStudentPromotionAction;
  status: 'executed' | 'already_applied' | 'skipped';
  target_enrollment_id: number | null;
  target_academic_year_id: number | null;
}

export interface BulkStudentPromotionExecutionData {
  atomic: true;
  rows: BulkStudentPromotionExecutionRow[];
  summary: BulkStudentPromotionSummary & { executed: number };
}

type BulkFailureCode = 'invalid_input' | 'bulk_invalid' | 'bulk_conflict';

export type BulkStudentPromotionPreviewResult =
  | { ok: true; data: BulkStudentPromotionPreviewData }
  | { ok: false; status: 400; code: 'invalid_input'; error: string };

export type BulkStudentPromotionExecutionResult =
  | { ok: true; data: BulkStudentPromotionExecutionData }
  | {
      ok: false;
      status: 400 | 409;
      code: BulkFailureCode;
      error: string;
      data?: BulkStudentPromotionPreviewData;
    };

interface BulkPlan {
  request: ValidatedBulkRequest;
  preview: BulkStudentPromotionPreviewData;
  inspections: Array<StudentPromotionInspection | null>;
}

function toPositiveInteger(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function validateBulkRequest(
  input: BulkStudentPromotionRequest,
): { ok: true; value: ValidatedBulkRequest } | { ok: false; error: string } {
  const sourceAcademicYearId = toPositiveInteger(input.source_academic_year_id);
  const sourceClassId = toPositiveInteger(input.source_class_id);
  if (!sourceAcademicYearId) return { ok: false, error: 'السنة الدراسية المصدر مطلوبة' };
  if (!sourceClassId) return { ok: false, error: 'الصف المصدر مطلوب' };

  let sourceSectionId: number | null = null;
  if (input.source_section_id != null && input.source_section_id !== '') {
    sourceSectionId = toPositiveInteger(input.source_section_id);
    if (!sourceSectionId) return { ok: false, error: 'الشعبة المصدر غير صالحة' };
  }
  if (!Array.isArray(input.rows) || input.rows.length === 0) {
    return { ok: false, error: 'يجب إرسال صف طالب واحد على الأقل للمعاينة الجماعية' };
  }
  if (input.rows.length > MAX_BULK_PROMOTION_ROWS) {
    return {
      ok: false,
      error: `الحد الأقصى للدفعة الواحدة هو ${MAX_BULK_PROMOTION_ROWS} طالبًا`,
    };
  }

  const rows: ValidatedBulkRow[] = [];
  const seenSourceIds = new Set<number>();
  let needsTargetYear = false;
  for (const value of input.rows) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, error: 'أحد صفوف الترفيع الجماعي غير صالح' };
    }
    const row = value as BulkStudentPromotionRowRequest;
    const sourceEnrollmentId = toPositiveInteger(row.source_enrollment_id);
    if (!sourceEnrollmentId) return { ok: false, error: 'معرف تسجيل المصدر مطلوب لكل طالب' };
    if (seenSourceIds.has(sourceEnrollmentId)) {
      return { ok: false, error: 'لا يمكن تكرار تسجيل المصدر نفسه داخل الدفعة' };
    }
    seenSourceIds.add(sourceEnrollmentId);
    const action = row.action;
    if (action !== 'promoted' && action !== 'repeated' && action !== 'graduated' && action !== 'skipped') {
      return { ok: false, error: 'قرار أحد الطلاب غير صالح' };
    }
    if (hasOwn(row as object, 'target_academic_year_id')) {
      return { ok: false, error: 'السنة المستهدفة تُحدد مرة واحدة للعملية الجماعية ولا تُرسل داخل الصف' };
    }
    if (action === 'graduated' || action === 'skipped') {
      if (hasOwn(row as object, 'target_class_id') || hasOwn(row as object, 'target_section_id')) {
        return { ok: false, error: 'قرار التخرج أو التخطي لا يقبل صفًا أو شعبة مستهدفة' };
      }
      rows.push({ sourceEnrollmentId, action, targetClassId: null, targetSectionId: null });
      continue;
    }
    needsTargetYear = true;
    const targetClassId = toPositiveInteger(row.target_class_id);
    if (!targetClassId) return { ok: false, error: 'الصف المستهدف مطلوب لكل طالب مترفع أو معيد' };
    let targetSectionId: number | null = null;
    if (row.target_section_id != null && row.target_section_id !== '') {
      targetSectionId = toPositiveInteger(row.target_section_id);
      if (!targetSectionId) return { ok: false, error: 'الشعبة المستهدفة غير صالحة' };
    }
    rows.push({ sourceEnrollmentId, action, targetClassId, targetSectionId });
  }

  let targetAcademicYearId: number | null = null;
  if (input.target_academic_year_id != null && input.target_academic_year_id !== '') {
    targetAcademicYearId = toPositiveInteger(input.target_academic_year_id);
    if (!targetAcademicYearId) return { ok: false, error: 'السنة الدراسية المستهدفة غير صالحة' };
  }
  if (needsTargetYear && targetAcademicYearId == null) {
    return { ok: false, error: 'السنة الدراسية المستهدفة مطلوبة للترفيع أو إعادة السنة' };
  }
  if (!needsTargetYear && targetAcademicYearId != null) {
    return { ok: false, error: 'لا تُرسل سنة مستهدفة عندما تقتصر الدفعة على التخرج أو التخطي' };
  }

  return {
    ok: true,
    value: { sourceAcademicYearId, sourceClassId, sourceSectionId, targetAcademicYearId, rows },
  };
}

function individualRequest(row: ValidatedBulkRow, targetAcademicYearId: number | null): StudentPromotionRequest {
  if (row.action === 'skipped') {
    return { source_enrollment_id: row.sourceEnrollmentId, action: 'graduated' };
  }
  if (row.action === 'graduated') {
    return { source_enrollment_id: row.sourceEnrollmentId, action: row.action };
  }
  return {
    source_enrollment_id: row.sourceEnrollmentId,
    action: row.action,
    target_academic_year_id: targetAcademicYearId,
    target_class_id: row.targetClassId,
    target_section_id: row.targetSectionId,
  };
}

function sourceMatchesScope(source: SourceEnrollmentRecord, request: ValidatedBulkRequest): boolean {
  return source.source_year_is_active === 1
    && source.academic_year_id === request.sourceAcademicYearId
    && source.class_id === request.sourceClassId
    && (request.sourceSectionId == null || source.section_id === request.sourceSectionId);
}

function safeSourcePreview(source: SourceEnrollmentRecord | undefined): BulkStudentPromotionPreviewRow['source'] {
  if (!source) return null;
  return {
    enrollment_id: source.id,
    academic_year_id: source.academic_year_id,
    academic_year_name: source.source_year_name,
    class_id: source.class_id,
    class_name: source.source_class_name,
    section_id: source.section_id,
    section_name: source.source_section_name,
    status: source.status,
    promotion_status: source.promotion_status,
  };
}

function studentPreview(source: SourceEnrollmentRecord | undefined): BulkStudentPromotionPreviewRow['student'] {
  if (!source) return null;
  return { id: source.student_id, student_number: source.student_number, full_name: source.student_full_name };
}

function validPreviewRow(inspection: StudentPromotionInspection): BulkStudentPromotionPreviewRow {
  const { source, request, targetYear, targetClass, targetSection, existingTarget, alreadyApplied } = inspection;
  return {
    source_enrollment_id: source.id,
    action: request.action,
    state: 'valid',
    valid: true,
    skipped: false,
    blocking_errors: [],
    warnings: alreadyApplied ? ['مطبق مسبقًا — لن يُنشأ تسجيل مكرر.'] : [],
    student: studentPreview(source),
    source: safeSourcePreview(source),
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
  };
}

function invalidPreviewRow(
  row: ValidatedBulkRow,
  error: string,
  source?: SourceEnrollmentRecord,
): BulkStudentPromotionPreviewRow {
  return {
    source_enrollment_id: row.sourceEnrollmentId,
    action: row.action,
    state: 'invalid',
    valid: false,
    skipped: false,
    blocking_errors: [error],
    warnings: [],
    student: studentPreview(source),
    source: safeSourcePreview(source),
    target: null,
    target_enrollment_exists: null,
    already_applied: false,
  };
}

function skippedPreviewRow(row: ValidatedBulkRow, source: SourceEnrollmentRecord): BulkStudentPromotionPreviewRow {
  return {
    source_enrollment_id: row.sourceEnrollmentId,
    action: 'skipped',
    state: 'skipped',
    valid: true,
    skipped: true,
    blocking_errors: [],
    warnings: ['متخطى — لن تُكتب أي بيانات لهذا الطالب.'],
    student: studentPreview(source),
    source: safeSourcePreview(source),
    target: null,
    target_enrollment_exists: false,
    already_applied: false,
  };
}

function summarize(rows: BulkStudentPromotionPreviewRow[]): BulkStudentPromotionSummary {
  return {
    total: rows.length,
    selected: rows.filter((row) => !row.skipped).length,
    valid: rows.filter((row) => row.state === 'valid').length,
    invalid: rows.filter((row) => row.state === 'invalid').length,
    skipped: rows.filter((row) => row.state === 'skipped').length,
    already_applied: rows.filter((row) => row.already_applied).length,
    promoted: rows.filter((row) => row.action === 'promoted').length,
    repeated: rows.filter((row) => row.action === 'repeated').length,
    graduated: rows.filter((row) => row.action === 'graduated').length,
  };
}

async function buildBulkPlan(
  db: StudentPromotionDatabase,
  schoolId: number,
  input: BulkStudentPromotionRequest,
): Promise<{ ok: true; value: BulkPlan } | { ok: false; error: string }> {
  const validation = validateBulkRequest(input);
  if (!validation.ok) return validation;
  const request = validation.value;
  const inspectionResults = await inspectStudentPromotions(
    db,
    schoolId,
    request.rows.map((row) => individualRequest(row, request.targetAcademicYearId)),
  );
  const inspections: Array<StudentPromotionInspection | null> = [];
  const previewRows = request.rows.map((row, index): BulkStudentPromotionPreviewRow => {
    const inspection = inspectionResults[index] as StudentPromotionInspectionResult;
    const source = inspection.ok ? inspection.value.source : inspection.source;
    if (!source || source.school_id !== schoolId) {
      inspections.push(null);
      return invalidPreviewRow(row, inspection.ok ? 'تسجيل الطالب المصدر غير صالح' : inspection.error);
    }
    if (!sourceMatchesScope(source, request)) {
      inspections.push(null);
      return invalidPreviewRow(row, 'تسجيل الطالب لا يطابق السنة أو الصف أو الشعبة المصدر المحددة', source);
    }
    if (row.action === 'skipped') {
      inspections.push(null);
      return skippedPreviewRow(row, source);
    }
    if (!inspection.ok) {
      inspections.push(null);
      return invalidPreviewRow(row, inspection.error, source);
    }
    inspections.push(inspection.value);
    return validPreviewRow(inspection.value);
  });
  const summary = summarize(previewRows);
  return {
    ok: true,
    value: {
      request,
      inspections,
      preview: {
        valid: summary.invalid === 0,
        atomic: true,
        max_rows: MAX_BULK_PROMOTION_ROWS,
        rows: previewRows,
        summary,
      },
    },
  };
}

export async function previewBulkStudentPromotion(
  db: StudentPromotionDatabase,
  schoolId: number,
  input: BulkStudentPromotionRequest,
): Promise<BulkStudentPromotionPreviewResult> {
  const plan = await buildBulkPlan(db, schoolId, input);
  if (!plan.ok) return { ok: false, status: 400, code: 'invalid_input', error: plan.error };
  return { ok: true, data: plan.value.preview };
}

function bulkMutationPayload(inspections: StudentPromotionInspection[]): string {
  return JSON.stringify(inspections.map((inspection) => ({
    source_enrollment_id: inspection.source.id,
    action: inspection.request.action,
    target_academic_year_id: inspection.request.targetAcademicYearId,
    target_class_id: inspection.request.targetClassId,
    target_section_id: inspection.request.targetSectionId,
    claim_sentinel: createTransitionClaimSentinel(),
  })));
}

function bulkIdempotentPayload(inspections: StudentPromotionInspection[]): string {
  return JSON.stringify(inspections.map((inspection) => ({
    source_enrollment_id: inspection.source.id,
    action: inspection.request.action,
    target_academic_year_id: inspection.request.targetAcademicYearId,
    target_class_id: inspection.request.targetClassId,
    target_section_id: inspection.request.targetSectionId,
  })));
}

function buildAtomicBulkStatements(
  db: StudentPromotionDatabase,
  schoolId: number,
  userId: number,
  request: ValidatedBulkRequest,
  inspections: StudentPromotionInspection[],
  alreadyAppliedInspections: StudentPromotionInspection[],
) {
  // D1Database.batch() is one transaction. The assertion INSERTs intentionally
  // violate the enrollment status CHECK if a concurrent change prevents an exact
  // idempotent match, source claim, or target creation, rolling back every statement.
  const payload = bulkMutationPayload(inspections);
  const assertionSource = inspections[0].source;
  const statements = [];
  if (alreadyAppliedInspections.length > 0) {
    const idempotentPayload = bulkIdempotentPayload(alreadyAppliedInspections);
    statements.push(db.prepare(`
      INSERT INTO student_enrollments (
        school_id, student_id, academic_year_id, class_id, section_id, status, promotion_status
      )
      SELECT ?, ?, ?, ?, ?, '__bulk_assertion_failure__', 'pending'
      WHERE EXISTS (
        SELECT 1
        FROM json_each(?) AS p
        LEFT JOIN student_enrollments AS source
          ON source.id = CAST(json_extract(p.value, '$.source_enrollment_id') AS INTEGER)
        LEFT JOIN academic_years AS source_year
          ON source_year.id = source.academic_year_id
         AND source_year.school_id = source.school_id
        WHERE source.id IS NULL
           OR source.school_id <> ?
           OR source.academic_year_id <> ?
           OR source.class_id <> ?
           OR (? IS NOT NULL AND source.section_id IS NOT ?)
           OR source.status <> 'completed'
           OR source.promotion_status <> json_extract(p.value, '$.action')
           OR source.completed_at IS NULL
           OR source.completed_at <= 0
           OR source_year.is_active <> 1
           OR NOT EXISTS (
             SELECT 1 FROM students AS student
             WHERE student.id = source.student_id
               AND student.school_id = source.school_id
               AND student.status = 'active'
           )
           OR (
             json_extract(p.value, '$.action') = 'graduated'
             AND EXISTS (
               SELECT 1
               FROM student_enrollments AS later_enrollment
               INNER JOIN academic_years AS later_year
                 ON later_year.id = later_enrollment.academic_year_id
                AND later_year.school_id = later_enrollment.school_id
               WHERE later_enrollment.school_id = source.school_id
                 AND later_enrollment.student_id = source.student_id
                 AND later_year.starts_at > source_year.starts_at
             )
           )
           OR (
             json_extract(p.value, '$.action') IN ('promoted', 'repeated')
             AND (
               NOT EXISTS (
                 SELECT 1 FROM academic_years AS target_year
                 WHERE target_year.id = CAST(json_extract(p.value, '$.target_academic_year_id') AS INTEGER)
                   AND target_year.school_id = source.school_id
                   AND target_year.is_active = 0
                   AND target_year.starts_at > source_year.starts_at
               )
               OR NOT EXISTS (
                 SELECT 1 FROM classes AS target_class
                 WHERE target_class.id = CAST(json_extract(p.value, '$.target_class_id') AS INTEGER)
                   AND target_class.school_id = source.school_id
                   AND target_class.status = 'active'
               )
               OR (
                 json_extract(p.value, '$.target_section_id') IS NULL
                 AND EXISTS (
                   SELECT 1 FROM sections AS active_section
                   WHERE active_section.school_id = source.school_id
                     AND active_section.class_id = CAST(json_extract(p.value, '$.target_class_id') AS INTEGER)
                     AND active_section.status = 'active'
                 )
               )
               OR (
                 json_extract(p.value, '$.target_section_id') IS NOT NULL
                 AND NOT EXISTS (
                   SELECT 1 FROM sections AS target_section
                   WHERE target_section.id = CAST(json_extract(p.value, '$.target_section_id') AS INTEGER)
                     AND target_section.school_id = source.school_id
                     AND target_section.class_id = CAST(json_extract(p.value, '$.target_class_id') AS INTEGER)
                     AND target_section.status = 'active'
                 )
               )
               OR NOT EXISTS (
                 SELECT 1 FROM student_enrollments AS target
                 WHERE target.school_id = source.school_id
                   AND target.student_id = source.student_id
                   AND target.academic_year_id = CAST(json_extract(p.value, '$.target_academic_year_id') AS INTEGER)
                   AND target.class_id = CAST(json_extract(p.value, '$.target_class_id') AS INTEGER)
                   AND target.section_id IS CAST(json_extract(p.value, '$.target_section_id') AS INTEGER)
                   AND target.status = 'active'
                   AND target.promotion_status = 'pending'
               )
             )
           )
      )
    `).bind(
      assertionSource.school_id,
      assertionSource.student_id,
      assertionSource.academic_year_id,
      assertionSource.class_id,
      assertionSource.section_id,
      idempotentPayload,
      schoolId,
      request.sourceAcademicYearId,
      request.sourceClassId,
      request.sourceSectionId,
      request.sourceSectionId,
    ));
  }
  const claimSources = db.prepare(`
    UPDATE student_enrollments AS source
    SET status = 'completed',
        promotion_status = json_extract(p.value, '$.action'),
        completed_at = CAST(json_extract(p.value, '$.claim_sentinel') AS INTEGER),
        updated_by_user_id = ?
    FROM json_each(?) AS p
    WHERE source.id = CAST(json_extract(p.value, '$.source_enrollment_id') AS INTEGER)
      AND source.school_id = ?
      AND source.academic_year_id = ?
      AND source.class_id = ?
      AND (? IS NULL OR source.section_id = ?)
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
      AND (
        json_extract(p.value, '$.action') = 'graduated'
        OR (
          EXISTS (
            SELECT 1
            FROM academic_years AS target_year
            INNER JOIN academic_years AS source_year
              ON source_year.id = source.academic_year_id
             AND source_year.school_id = source.school_id
            WHERE target_year.id = CAST(json_extract(p.value, '$.target_academic_year_id') AS INTEGER)
              AND target_year.school_id = source.school_id
              AND target_year.is_active = 0
              AND target_year.starts_at > source_year.starts_at
          )
          AND EXISTS (
            SELECT 1 FROM classes AS target_class
            WHERE target_class.id = CAST(json_extract(p.value, '$.target_class_id') AS INTEGER)
              AND target_class.school_id = source.school_id
              AND target_class.status = 'active'
          )
          AND (
            (
              json_extract(p.value, '$.target_section_id') IS NULL
              AND NOT EXISTS (
                SELECT 1 FROM sections AS active_section
                WHERE active_section.school_id = source.school_id
                  AND active_section.class_id = CAST(json_extract(p.value, '$.target_class_id') AS INTEGER)
                  AND active_section.status = 'active'
              )
            )
            OR EXISTS (
              SELECT 1 FROM sections AS target_section
              WHERE target_section.id = CAST(json_extract(p.value, '$.target_section_id') AS INTEGER)
                AND target_section.school_id = source.school_id
                AND target_section.class_id = CAST(json_extract(p.value, '$.target_class_id') AS INTEGER)
                AND target_section.status = 'active'
            )
          )
        )
      )
  `).bind(
    userId,
    payload,
    schoolId,
    request.sourceAcademicYearId,
    request.sourceClassId,
    request.sourceSectionId,
    request.sourceSectionId,
  );

  const assertClaims = db.prepare(`
    INSERT INTO student_enrollments (
      school_id, student_id, academic_year_id, class_id, section_id, status, promotion_status
    )
    SELECT ?, ?, ?, ?, ?, '__bulk_assertion_failure__', 'pending'
    WHERE EXISTS (
      SELECT 1
      FROM json_each(?) AS p
      LEFT JOIN student_enrollments AS source
        ON source.id = CAST(json_extract(p.value, '$.source_enrollment_id') AS INTEGER)
      WHERE source.id IS NULL
         OR source.status <> 'completed'
         OR source.promotion_status <> json_extract(p.value, '$.action')
         OR source.completed_at <> CAST(json_extract(p.value, '$.claim_sentinel') AS INTEGER)
    )
  `).bind(
    assertionSource.school_id,
    assertionSource.student_id,
    assertionSource.academic_year_id,
    assertionSource.class_id,
    assertionSource.section_id,
    payload,
  );

  const createTargets = db.prepare(`
    INSERT INTO student_enrollments (
      school_id, student_id, academic_year_id, class_id, section_id,
      status, promotion_status, created_by_user_id, updated_by_user_id
    )
    SELECT
      source.school_id,
      source.student_id,
      CAST(json_extract(p.value, '$.target_academic_year_id') AS INTEGER),
      CAST(json_extract(p.value, '$.target_class_id') AS INTEGER),
      CAST(json_extract(p.value, '$.target_section_id') AS INTEGER),
      'active',
      'pending',
      ?,
      ?
    FROM json_each(?) AS p
    INNER JOIN student_enrollments AS source
      ON source.id = CAST(json_extract(p.value, '$.source_enrollment_id') AS INTEGER)
     AND source.status = 'completed'
     AND source.promotion_status = json_extract(p.value, '$.action')
     AND source.completed_at = CAST(json_extract(p.value, '$.claim_sentinel') AS INTEGER)
    WHERE json_extract(p.value, '$.action') IN ('promoted', 'repeated')
  `).bind(userId, userId, payload);

  const assertTargets = db.prepare(`
    INSERT INTO student_enrollments (
      school_id, student_id, academic_year_id, class_id, section_id, status, promotion_status
    )
    SELECT ?, ?, ?, ?, ?, '__bulk_assertion_failure__', 'pending'
    WHERE EXISTS (
      SELECT 1
      FROM json_each(?) AS p
      INNER JOIN student_enrollments AS source
        ON source.id = CAST(json_extract(p.value, '$.source_enrollment_id') AS INTEGER)
      WHERE json_extract(p.value, '$.action') IN ('promoted', 'repeated')
        AND NOT EXISTS (
          SELECT 1 FROM student_enrollments AS target
          WHERE target.school_id = source.school_id
            AND target.student_id = source.student_id
            AND target.academic_year_id = CAST(json_extract(p.value, '$.target_academic_year_id') AS INTEGER)
            AND target.class_id = CAST(json_extract(p.value, '$.target_class_id') AS INTEGER)
            AND target.section_id IS CAST(json_extract(p.value, '$.target_section_id') AS INTEGER)
            AND target.status = 'active'
            AND target.promotion_status = 'pending'
        )
    )
  `).bind(
    assertionSource.school_id,
    assertionSource.student_id,
    assertionSource.academic_year_id,
    assertionSource.class_id,
    assertionSource.section_id,
    payload,
  );

  const normalizeSources = db.prepare(`
    UPDATE student_enrollments AS source
    SET completed_at = unixepoch()
    FROM json_each(?) AS p
    WHERE source.id = CAST(json_extract(p.value, '$.source_enrollment_id') AS INTEGER)
      AND source.status = 'completed'
      AND source.promotion_status = json_extract(p.value, '$.action')
      AND source.completed_at = CAST(json_extract(p.value, '$.claim_sentinel') AS INTEGER)
  `).bind(payload);
  statements.push(claimSources, assertClaims, createTargets, assertTargets, normalizeSources);
  return statements;
}

export async function executeBulkStudentPromotion(
  db: StudentPromotionDatabase,
  schoolId: number,
  userId: number,
  input: BulkStudentPromotionRequest,
): Promise<BulkStudentPromotionExecutionResult> {
  const planResult = await buildBulkPlan(db, schoolId, input);
  if (!planResult.ok) {
    return { ok: false, status: 400, code: 'invalid_input', error: planResult.error };
  }
  const plan = planResult.value;
  if (plan.preview.summary.selected === 0) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_input',
      error: 'يجب تحديد قرار لطالب واحد على الأقل قبل تنفيذ الدفعة',
    };
  }
  if (!plan.preview.valid) {
    return {
      ok: false,
      status: 409,
      code: 'bulk_invalid',
      error: 'تحتوي خطة الترفيع الجماعي على طلاب يحتاجون إلى مراجعة',
      data: plan.preview,
    };
  }
  const pendingInspections = plan.inspections.filter(
    (inspection): inspection is StudentPromotionInspection => inspection != null && !inspection.alreadyApplied,
  );
  const alreadyAppliedInspections = plan.inspections.filter(
    (inspection): inspection is StudentPromotionInspection => inspection != null && inspection.alreadyApplied,
  );
  if (pendingInspections.length > 0) {
    try {
      await db.batch(buildAtomicBulkStatements(
        db,
        schoolId,
        userId,
        plan.request,
        pendingInspections,
        alreadyAppliedInspections,
      ));
    } catch {
      return {
        ok: false,
        status: 409,
        code: 'bulk_conflict',
        error: 'تغيرت بيانات طالب أو هدف أثناء التنفيذ؛ أُلغيت الدفعة كاملة ولم تُعتمد كتابة جزئية',
      };
    }
  }

  const refreshed = await buildBulkPlan(db, schoolId, input);
  if (!refreshed.ok || !refreshed.value.preview.valid) {
    return {
      ok: false,
      status: 409,
      code: 'bulk_conflict',
      error: 'تعذر التحقق من النتيجة النهائية للدفعة الجماعية',
    };
  }
  const executionRows: BulkStudentPromotionExecutionRow[] = refreshed.value.preview.rows.map((row, index) => ({
    source_enrollment_id: row.source_enrollment_id,
    student_id: row.student?.id ?? null,
    action: row.action,
    status: row.skipped
      ? 'skipped'
      : plan.preview.rows[index].already_applied ? 'already_applied' : 'executed',
    target_enrollment_id: row.target?.existing_enrollment_id ?? null,
    target_academic_year_id: row.target?.academic_year_id ?? null,
  }));
  const summary = refreshed.value.preview.summary;
  const executed = executionRows.filter((row) => row.status === 'executed').length;
  const alreadyApplied = executionRows.filter((row) => row.status === 'already_applied').length;
  return {
    ok: true,
    data: {
      atomic: true,
      rows: executionRows,
      summary: {
        ...summary,
        already_applied: alreadyApplied,
        executed,
      },
    },
  };
}
