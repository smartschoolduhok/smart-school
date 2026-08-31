import type {
  BulkStudentPromotionAction,
  BulkStudentPromotionRequest,
} from './studentBulkPromotion';

export interface BulkPromotionUiRow {
  sourceEnrollmentId: number;
  action: BulkStudentPromotionAction;
  targetClassId: number | null;
  targetSectionId: number | null;
}

export interface BulkPromotionUiSelection {
  schoolId: number | null;
  sourceAcademicYearId: number | null;
  sourceClassId: number | null;
  sourceSectionId: number | null;
  targetAcademicYearId: number | null;
  rows: BulkPromotionUiRow[];
}

export function bulkPromotionSelectionFingerprint(selection: BulkPromotionUiSelection): string {
  return JSON.stringify({
    school_id: selection.schoolId,
    source_academic_year_id: selection.sourceAcademicYearId,
    source_class_id: selection.sourceClassId,
    source_section_id: selection.sourceSectionId,
    target_academic_year_id: selection.targetAcademicYearId,
    rows: selection.rows.map((row) => ({
      source_enrollment_id: row.sourceEnrollmentId,
      action: row.action,
      target_class_id: row.targetClassId,
      target_section_id: row.targetSectionId,
    })),
  });
}

export function buildBulkPromotionRequest(
  selection: BulkPromotionUiSelection,
): (BulkStudentPromotionRequest & { school_id: number }) | null {
  if (
    selection.schoolId == null
    || selection.sourceAcademicYearId == null
    || selection.sourceClassId == null
    || selection.rows.length === 0
  ) {
    return null;
  }

  const needsTargetYear = selection.rows.some((row) => (
    row.action === 'promoted' || row.action === 'repeated'
  ));
  if (needsTargetYear && selection.targetAcademicYearId == null) return null;

  return {
    school_id: selection.schoolId,
    source_academic_year_id: selection.sourceAcademicYearId,
    source_class_id: selection.sourceClassId,
    source_section_id: selection.sourceSectionId,
    target_academic_year_id: needsTargetYear ? selection.targetAcademicYearId : null,
    rows: selection.rows.map((row) => ({
      source_enrollment_id: row.sourceEnrollmentId,
      action: row.action,
      ...(row.action === 'promoted' || row.action === 'repeated'
        ? {
            target_class_id: row.targetClassId,
            target_section_id: row.targetSectionId,
          }
        : {}),
    })),
  };
}

export function isBulkPromotionPreviewCurrent(
  previewFingerprint: string | null,
  selection: BulkPromotionUiSelection,
): boolean {
  return previewFingerprint != null
    && previewFingerprint === bulkPromotionSelectionFingerprint(selection);
}
