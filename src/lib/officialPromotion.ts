import {
  executeStudentPromotion,
  previewStudentPromotion,
  type OfficialPromotionEvidence,
  type StudentPromotionAction,
  type StudentPromotionDatabase,
  type StudentPromotionPreviewResult,
  type StudentPromotionRequest,
  type StudentPromotionResult,
  validateStudentPromotionRequest,
} from './studentPromotion.ts';

export type OfficialPromotionDecisionState =
  | 'ready'
  | 'already_applied'
  | 'not_published'
  | 'completion_pending'
  | 'incomplete'
  | 'invalid';

export interface OfficialPromotionDecision {
  source_enrollment_id: number;
  state: OfficialPromotionDecisionState;
  ready: boolean;
  already_applied: boolean;
  required_action: StudentPromotionAction | null;
  blocking_error: string | null;
  code: string | null;
  official_result: OfficialPromotionEvidence | null;
}

interface OfficialPromotionLookupRow {
  request_index: number;
  requested_source_enrollment_id: number;
  source_enrollment_id: number | null;
  source_school_id: number | null;
  student_id: number | null;
  academic_year_id: number | null;
  class_id: number | null;
  section_id: number | null;
  source_status: string | null;
  source_promotion_status: string | null;
  card_id: number | null;
  card_school_id: number | null;
  card_student_id: number | null;
  card_academic_year_id: number | null;
  card_class_id: number | null;
  card_section_id: number | null;
  card_number: string | null;
  card_status: string | null;
  publication_status: string | null;
  publication_revision: number | null;
  published_at: number | null;
  card_data_json: string | null;
  applied_result_card_id: number | null;
  applied_publication_revision: number | null;
  applied_result_card_number: string | null;
  applied_policy_kind: string | null;
  applied_academic_status_code: string | null;
  applied_decision_action: string | null;
}

export interface OfficialPromotionLookupInput {
  sourceEnrollmentId: number;
  action?: StudentPromotionAction | null;
  expectedResultCardId?: number | null;
  expectedPublicationRevision?: number | null;
}

function positiveInteger(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
}

function nonNegativeInteger(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : null;
}

function invalidDecision(
  sourceEnrollmentId: number,
  state: OfficialPromotionDecisionState,
  code: string,
  blockingError: string,
): OfficialPromotionDecision {
  return {
    source_enrollment_id: sourceEnrollmentId,
    state,
    ready: false,
    already_applied: false,
    required_action: null,
    blocking_error: blockingError,
    code,
    official_result: null,
  };
}

function parseSnapshot(value: string | null): Record<string, any> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function requiredAction(
  policyKind: string,
  academicStatusCode: string,
): StudentPromotionAction | null {
  if (academicStatusCode === 'fail') return 'repeated';
  if (academicStatusCode !== 'pass') return null;
  return policyKind === 'terminal' ? 'graduated' : 'promoted';
}

function evidenceFromApplied(row: OfficialPromotionLookupRow): OfficialPromotionEvidence | null {
  const action = row.applied_decision_action;
  const policyKind = row.applied_policy_kind;
  const statusCode = row.applied_academic_status_code;
  if (
    row.applied_result_card_id == null
    || row.applied_publication_revision == null
    || !row.applied_result_card_number
    || (policyKind !== 'terminal' && policyKind !== 'non_terminal')
    || (statusCode !== 'pass' && statusCode !== 'fail')
    || (action !== 'promoted' && action !== 'repeated' && action !== 'graduated')
  ) return null;
  const snapshot = parseSnapshot(row.card_data_json);
  return {
    result_card_id: row.applied_result_card_id,
    result_card_number: row.applied_result_card_number,
    publication_revision: row.applied_publication_revision,
    published_at: Number(row.published_at ?? 0),
    exam_round: typeof snapshot?.exam_round === 'string' ? snapshot.exam_round : null,
    policy_kind: policyKind,
    academic_status_code: statusCode,
    academic_status: typeof snapshot?.summary?.academic_status === 'string'
      ? snapshot.summary.academic_status
      : statusCode === 'pass' ? 'ناجح' : 'راسب',
    required_action: action,
  };
}

function evaluateLookup(
  schoolId: number,
  input: OfficialPromotionLookupInput,
  row: OfficialPromotionLookupRow | undefined,
): OfficialPromotionDecision {
  const sourceId = input.sourceEnrollmentId;
  if (!row?.source_enrollment_id || row.source_school_id !== schoolId) {
    return invalidDecision(sourceId, 'invalid', 'source_not_found', 'تسجيل الطالب المصدر غير موجود في المدرسة المستهدفة');
  }

  if (row.applied_result_card_id != null) {
    const evidence = evidenceFromApplied(row);
    if (!evidence || (input.action && input.action !== evidence.required_action)) {
      return invalidDecision(sourceId, 'invalid', 'official_result_action_mismatch', 'القرار المطلوب لا يطابق قرار النتيجة الرسمية المطبق');
    }
    if (
      input.expectedResultCardId != null
      && (
        input.expectedResultCardId !== evidence.result_card_id
        || input.expectedPublicationRevision !== evidence.publication_revision
      )
    ) {
      return invalidDecision(sourceId, 'invalid', 'official_result_stale', 'مرجع الإعادة لا يطابق النتيجة الرسمية التي طُبق منها القرار');
    }
    return {
      source_enrollment_id: sourceId,
      state: 'already_applied',
      ready: true,
      already_applied: true,
      required_action: evidence.required_action,
      blocking_error: null,
      code: null,
      official_result: evidence,
    };
  }

  if (row.source_status !== 'active' || row.source_promotion_status !== 'pending') {
    return invalidDecision(sourceId, 'invalid', 'lifecycle_conflict', 'تسجيل الطالب مقفل أو منتهٍ ولا يقبل قرارًا جديدًا');
  }
  if (!row.card_id || row.card_status !== 'active' || row.publication_status !== 'published') {
    return invalidDecision(sourceId, 'not_published', 'official_result_not_published', 'لا توجد نتيجة رسمية منشورة لهذا الطالب والسنة');
  }
  if (
    row.card_school_id !== schoolId
    || row.card_student_id !== row.student_id
    || row.card_academic_year_id !== row.academic_year_id
    || row.card_class_id !== row.class_id
    || row.card_section_id !== row.section_id
  ) {
    return invalidDecision(sourceId, 'invalid', 'official_result_invalid', 'النتيجة المنشورة لا تطابق تسجيل الطالب السنوي وموقعه');
  }
  if (!Number.isSafeInteger(row.publication_revision) || Number(row.publication_revision) <= 0 || !row.published_at) {
    return invalidDecision(sourceId, 'invalid', 'official_result_invalid', 'بيانات نشر النتيجة الرسمية غير مكتملة');
  }
  if (
    input.expectedResultCardId != null
    && (
      row.card_id !== input.expectedResultCardId
      || row.publication_revision !== input.expectedPublicationRevision
    )
  ) {
    return invalidDecision(sourceId, 'invalid', 'official_result_stale', 'تغيرت النتيجة الرسمية بعد المعاينة؛ أعد تحميل القرار');
  }

  const snapshot = parseSnapshot(row.card_data_json);
  const policy = snapshot?.academic_policy;
  const summary = snapshot?.summary;
  if (snapshot?.card_mode !== 'complete') {
    return invalidDecision(sourceId, 'incomplete', 'official_result_incomplete', 'كارت النتيجة جزئي ولا يصلح لإقفال التسجيل السنوي');
  }
  if (
    !policy
    || (policy.status !== 'approved' && policy.status !== 'locked')
    || (policy.policy_kind !== 'terminal' && policy.policy_kind !== 'non_terminal')
    || typeof policy.source_reference !== 'string'
    || !policy.source_reference.trim()
    || !summary
  ) {
    return invalidDecision(sourceId, 'invalid', 'official_result_invalid', 'Snapshot النتيجة الرسمية لا يحتوي سياسة سنوية موثقة وصالحة');
  }

  const academicStatusCode = summary.academic_status_code;
  if (academicStatusCode === 'completion') {
    return invalidDecision(sourceId, 'completion_pending', 'official_result_completion_pending', 'الطالب مكمل؛ يجب انتظار نتيجة دور لاحق منشورة قبل الترفيع أو الإعادة');
  }
  if (academicStatusCode === 'incomplete') {
    return invalidDecision(sourceId, 'incomplete', 'official_result_incomplete', 'النتيجة الأكاديمية غير مكتملة ولا تسمح بقرار سنوي نهائي');
  }
  if (academicStatusCode !== 'pass' && academicStatusCode !== 'fail') {
    return invalidDecision(sourceId, 'invalid', 'official_result_invalid', 'حالة النتيجة الأكاديمية الرسمية غير معروفة');
  }

  const action = requiredAction(policy.policy_kind, academicStatusCode);
  if (!action || (input.action && input.action !== action)) {
    return invalidDecision(sourceId, 'invalid', 'official_result_action_mismatch', 'القرار المختار لا يطابق النتيجة الرسمية المنشورة');
  }
  const evidence: OfficialPromotionEvidence = {
    result_card_id: row.card_id,
    result_card_number: String(row.card_number),
    publication_revision: Number(row.publication_revision),
    published_at: Number(row.published_at),
    exam_round: typeof snapshot.exam_round === 'string' ? snapshot.exam_round : null,
    policy_kind: policy.policy_kind,
    academic_status_code: academicStatusCode,
    academic_status: typeof summary.academic_status === 'string'
      ? summary.academic_status
      : academicStatusCode === 'pass' ? 'ناجح' : 'راسب',
    required_action: action,
  };
  return {
    source_enrollment_id: sourceId,
    state: 'ready',
    ready: true,
    already_applied: false,
    required_action: action,
    blocking_error: null,
    code: null,
    official_result: evidence,
  };
}

export async function loadOfficialPromotionDecisions(
  db: StudentPromotionDatabase,
  schoolId: number,
  inputs: OfficialPromotionLookupInput[],
): Promise<OfficialPromotionDecision[]> {
  if (inputs.length === 0) return [];
  const payload = JSON.stringify(inputs.map((input, requestIndex) => ({
    request_index: requestIndex,
    source_enrollment_id: input.sourceEnrollmentId,
  })));
  const response = await db.prepare(`
    WITH requested AS (
      SELECT
        CAST(json_extract(value,'$.request_index') AS INTEGER) AS request_index,
        CAST(json_extract(value,'$.source_enrollment_id') AS INTEGER) AS source_enrollment_id
      FROM json_each(?)
    )
    SELECT
      requested.request_index,
      requested.source_enrollment_id AS requested_source_enrollment_id,
      source.id AS source_enrollment_id,
      source.school_id AS source_school_id,
      source.student_id,
      source.academic_year_id,
      source.class_id,
      source.section_id,
      source.status AS source_status,
      source.promotion_status AS source_promotion_status,
      card.id AS card_id,
      card.school_id AS card_school_id,
      card.student_id AS card_student_id,
      card.academic_year_id AS card_academic_year_id,
      card.class_id AS card_class_id,
      card.section_id AS card_section_id,
      card.card_number,
      card.status AS card_status,
      card.publication_status,
      card.publication_revision,
      card.published_at,
      card.card_data_json,
      applied.result_card_id AS applied_result_card_id,
      applied.result_card_publication_revision AS applied_publication_revision,
      applied.result_card_number AS applied_result_card_number,
      applied.policy_kind AS applied_policy_kind,
      applied.academic_status_code AS applied_academic_status_code,
      applied.decision_action AS applied_decision_action
    FROM requested
    LEFT JOIN student_enrollments source ON source.id=requested.source_enrollment_id
    LEFT JOIN student_promotion_result_decisions applied
      ON applied.source_enrollment_id=source.id
    LEFT JOIN result_cards card ON card.id=COALESCE(
      applied.result_card_id,
      (
        SELECT candidate.id
        FROM result_cards candidate
        WHERE candidate.school_id=source.school_id
          AND candidate.student_id=source.student_id
          AND candidate.academic_year_id=source.academic_year_id
        ORDER BY
          CASE WHEN candidate.status='active' AND candidate.publication_status='published' THEN 0
               WHEN candidate.status='active' THEN 1 ELSE 2 END,
          candidate.published_at DESC,
          candidate.id DESC
        LIMIT 1
      )
    )
    ORDER BY requested.request_index
  `).bind(payload).all<OfficialPromotionLookupRow>();
  const rows = new Map((response.results ?? []).map(row => [Number(row.request_index), row]));
  return inputs.map((input, index) => evaluateLookup(schoolId, input, rows.get(index)));
}

export async function listOfficialPromotionDecisions(
  db: StudentPromotionDatabase,
  schoolId: number,
  rawSourceEnrollmentIds: unknown,
): Promise<{ ok: true; data: OfficialPromotionDecision[] } | { ok: false; error: string }> {
  if (!Array.isArray(rawSourceEnrollmentIds) || rawSourceEnrollmentIds.length === 0 || rawSourceEnrollmentIds.length > 30) {
    return { ok: false, error: 'أرسل من 1 إلى 30 تسجيل طالب للاستعلام عن القرار الرسمي' };
  }
  const ids = rawSourceEnrollmentIds.map(positiveInteger);
  if (ids.some(id => id == null) || new Set(ids).size !== ids.length) {
    return { ok: false, error: 'معرفات تسجيلات الطلاب غير صالحة أو مكررة' };
  }
  return {
    ok: true,
    data: await loadOfficialPromotionDecisions(
      db,
      schoolId,
      (ids as number[]).map(sourceEnrollmentId => ({ sourceEnrollmentId })),
    ),
  };
}

function lookupInput(input: StudentPromotionRequest, action: StudentPromotionAction): OfficialPromotionLookupInput | null {
  const sourceEnrollmentId = positiveInteger(input.source_enrollment_id);
  if (!sourceEnrollmentId) return null;
  const hasExpectedCard = input.official_result_card_id != null;
  const expectedResultCardId = hasExpectedCard ? positiveInteger(input.official_result_card_id) : null;
  const expectedPublicationRevision = hasExpectedCard
    ? nonNegativeInteger(input.official_result_publication_revision)
    : null;
  if (hasExpectedCard && (!expectedResultCardId || expectedPublicationRevision == null)) return null;
  return { sourceEnrollmentId, action, expectedResultCardId, expectedPublicationRevision };
}

export async function previewOfficialStudentPromotion(
  db: StudentPromotionDatabase,
  schoolId: number,
  input: StudentPromotionRequest,
): Promise<StudentPromotionPreviewResult> {
  const base = await previewStudentPromotion(db, schoolId, input);
  if (!base.ok) return base;
  const lookup = lookupInput(input, base.data.action);
  if (!lookup) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_input',
      error: 'مرجع النتيجة الرسمية غير صالح',
      data: { valid: false, blocking_errors: ['مرجع النتيجة الرسمية غير صالح'], warnings: [], target_enrollment_exists: false, already_applied: false },
    };
  }
  const decision = (await loadOfficialPromotionDecisions(db, schoolId, [lookup]))[0];
  if (!decision.ready || !decision.official_result) {
    return {
      ok: false,
      status: 409,
      code: decision.code as any,
      error: decision.blocking_error || 'النتيجة الرسمية لا تسمح بهذا القرار',
      data: { valid: false, blocking_errors: [decision.blocking_error || 'النتيجة الرسمية لا تسمح بهذا القرار'], warnings: [], target_enrollment_exists: base.data.target_enrollment_exists, already_applied: false },
    };
  }
  return { ok: true, data: { ...base.data, official_result: decision.official_result } };
}

export async function executeOfficialStudentPromotion(
  db: StudentPromotionDatabase,
  schoolId: number,
  userId: number,
  input: StudentPromotionRequest,
): Promise<StudentPromotionResult> {
  const validation = validateStudentPromotionRequest(input);
  if (!validation.ok) {
    return { ok: false, status: 400, code: 'invalid_input', error: validation.error };
  }
  const action = validation.value.action;
  const lookup = lookupInput(input, action);
  if (!lookup || lookup.expectedResultCardId == null) {
    return { ok: false, status: 400, code: 'official_result_required', error: 'يجب تنفيذ القرار من معاينة حديثة مرتبطة بالنتيجة الرسمية' };
  }
  const decision = (await loadOfficialPromotionDecisions(db, schoolId, [lookup]))[0];
  if (!decision.ready || !decision.official_result) {
    return { ok: false, status: 409, code: decision.code as any, error: decision.blocking_error || 'النتيجة الرسمية لا تسمح بهذا القرار' };
  }
  try {
    return await executeStudentPromotion(db, schoolId, userId, input, {
      officialResult: decision.official_result,
    });
  } catch (error) {
    const detail = String((error as any)?.message || error || '');
    if (detail.includes('official_result_stale') || detail.includes('UNIQUE constraint failed')) {
      return { ok: false, status: 409, code: 'official_result_stale', error: 'تغيرت النتيجة أو تسجيل الطالب بالتزامن؛ أعد المعاينة' };
    }
    if (detail.includes('official_result_target_conflict')) {
      return { ok: false, status: 409, code: 'target_enrollment_conflict', error: 'ظهر تسجيل لاحق بالتزامن؛ أعد المعاينة' };
    }
    if (detail.includes('official_result_action_mismatch') || detail.includes('official_result_target_invalid')) {
      return { ok: false, status: 409, code: 'official_result_action_mismatch', error: 'القرار أو وجهته لا يطابقان النتيجة الرسمية' };
    }
    throw error;
  }
}
