import {
  executeBulkStudentPromotion,
  previewBulkStudentPromotion,
  type BulkStudentPromotionExecutionResult,
  type BulkStudentPromotionPreviewResult,
  type BulkStudentPromotionRequest,
  type BulkStudentPromotionRowRequest,
} from './studentBulkPromotion.ts';
import {
  loadOfficialPromotionDecisions,
  type OfficialPromotionDecision,
  type OfficialPromotionLookupInput,
} from './officialPromotion.ts';
import type { StudentPromotionAction, StudentPromotionDatabase } from './studentPromotion.ts';

function positiveInteger(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
}

function nonNegativeInteger(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : null;
}

async function officialDecisionMap(
  db: StudentPromotionDatabase,
  schoolId: number,
  input: BulkStudentPromotionRequest,
  requireExpected: boolean,
): Promise<{ ok: true; value: Map<number, OfficialPromotionDecision> } | { ok: false; error: string }> {
  if (!Array.isArray(input.rows)) return { ok: false, error: 'صفوف الترفيع الجماعي غير صالحة' };
  const lookups: OfficialPromotionLookupInput[] = [];
  for (const raw of input.rows) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, error: 'أحد صفوف الترفيع الجماعي غير صالح' };
    }
    const row = raw as BulkStudentPromotionRowRequest;
    if (row.action === 'skipped') continue;
    const sourceEnrollmentId = positiveInteger(row.source_enrollment_id);
    if (!sourceEnrollmentId) return { ok: false, error: 'معرف تسجيل المصدر مطلوب لكل طالب' };
    const action = row.action as StudentPromotionAction;
    const expectedResultCardId = row.official_result_card_id == null
      ? null
      : positiveInteger(row.official_result_card_id);
    const expectedPublicationRevision = row.official_result_publication_revision == null
      ? null
      : nonNegativeInteger(row.official_result_publication_revision);
    if (requireExpected && (!expectedResultCardId || expectedPublicationRevision == null)) {
      return { ok: false, error: 'يجب تنفيذ الدفعة من معاينة حديثة مرتبطة بنتيجة كل طالب' };
    }
    if (
      row.official_result_card_id != null
      && (!expectedResultCardId || expectedPublicationRevision == null)
    ) {
      return { ok: false, error: 'مرجع النتيجة الرسمية في أحد الصفوف غير صالح' };
    }
    lookups.push({
      sourceEnrollmentId,
      action,
      expectedResultCardId,
      expectedPublicationRevision,
    });
  }
  const decisions = await loadOfficialPromotionDecisions(db, schoolId, lookups);
  return { ok: true, value: new Map(decisions.map(decision => [decision.source_enrollment_id, decision])) };
}

export async function previewOfficialBulkStudentPromotion(
  db: StudentPromotionDatabase,
  schoolId: number,
  input: BulkStudentPromotionRequest,
): Promise<BulkStudentPromotionPreviewResult> {
  const decisions = await officialDecisionMap(db, schoolId, input, false);
  if (!decisions.ok) return { ok: false, status: 400, code: 'invalid_input', error: decisions.error };
  return previewBulkStudentPromotion(db, schoolId, input, decisions.value);
}

export async function executeOfficialBulkStudentPromotion(
  db: StudentPromotionDatabase,
  schoolId: number,
  userId: number,
  input: BulkStudentPromotionRequest,
): Promise<BulkStudentPromotionExecutionResult> {
  const decisions = await officialDecisionMap(db, schoolId, input, true);
  if (!decisions.ok) return { ok: false, status: 400, code: 'invalid_input', error: decisions.error };
  return executeBulkStudentPromotion(db, schoolId, userId, input, decisions.value);
}
