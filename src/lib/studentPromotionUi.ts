import type {
  StudentPromotionAction,
  StudentPromotionRequest,
} from './studentPromotion';

export interface StudentPromotionSelection {
  schoolId: number | null;
  sourceEnrollmentId: number | null;
  action: StudentPromotionAction | null;
  targetAcademicYearId: number | null;
  targetClassId: number | null;
  targetSectionId: number | null;
}

export function promotionSelectionFingerprint(selection: StudentPromotionSelection): string {
  return JSON.stringify([
    selection.schoolId,
    selection.sourceEnrollmentId,
    selection.action,
    selection.targetAcademicYearId,
    selection.targetClassId,
    selection.targetSectionId,
  ]);
}

export function isPromotionPreviewCurrent(
  previewFingerprint: string | null,
  selection: StudentPromotionSelection,
): boolean {
  return previewFingerprint != null
    && previewFingerprint === promotionSelectionFingerprint(selection);
}

export function buildStudentPromotionRequest(
  selection: StudentPromotionSelection,
): (StudentPromotionRequest & { school_id: number }) | null {
  if (
    selection.schoolId == null
    || selection.sourceEnrollmentId == null
    || selection.action == null
  ) {
    return null;
  }

  if (selection.action === 'graduated') {
    return {
      school_id: selection.schoolId,
      source_enrollment_id: selection.sourceEnrollmentId,
      action: selection.action,
    };
  }

  if (selection.targetAcademicYearId == null || selection.targetClassId == null) return null;
  return {
    school_id: selection.schoolId,
    source_enrollment_id: selection.sourceEnrollmentId,
    action: selection.action,
    target_academic_year_id: selection.targetAcademicYearId,
    target_class_id: selection.targetClassId,
    target_section_id: selection.targetSectionId,
  };
}
