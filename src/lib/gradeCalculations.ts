import {
  normalizeGradeSchemeSettings,
  type GradeSchemeSettings,
} from './gradeScheme.ts';

export interface RawGradeValues {
  first_term_grade?: number | null;
  first_month?: number | null;
  second_month?: number | null;
  second_term_grade?: number | null;
  third_month?: number | null;
  fourth_month?: number | null;
  mid_year_exam?: number | null;
  final_exam?: number | null;
  completion_exam?: number | null;
}

export interface GradeCalculationSettings extends Partial<GradeSchemeSettings> {
  passing_grade: number;
  exemption_grade: number;
  max_grade: number;
  general_exemption_average_grade?: number;
  general_exemption_min_subject_grade?: number;
}

export interface CalculatedGradeValues {
  first_term_average: number | null;
  second_term_average: number | null;
  annual_effort: number | null;
  final_grade: number | null;
  grade_after_completion: number | null;
  effective_grade: number | null;
  result_status: string | null;
  exemption_status: number;
}

function roundGrade(value: number | null | undefined): number | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return Math.round(value);
}

function completeAverage(values: Array<number | null | undefined>): number | null {
  if (!values.length || values.some(value => value === null || value === undefined || Number.isNaN(value))) return null;
  return (values as number[]).reduce((sum, value) => sum + value, 0) / values.length;
}

export function calculateGrades(
  grade: RawGradeValues,
  settings: GradeCalculationSettings,
): CalculatedGradeValues {
  const scheme = normalizeGradeSchemeSettings(settings);
  const firstTermAverage = scheme.first_term_input_mode === 'monthly'
    ? roundGrade(completeAverage([grade.first_month, grade.second_month]))
    : scheme.first_term_input_mode === 'direct'
      ? roundGrade(grade.first_term_grade)
      : null;
  const secondTermAverage = scheme.second_term_input_mode === 'monthly'
    ? roundGrade(completeAverage([grade.third_month, grade.fourth_month]))
    : scheme.second_term_input_mode === 'direct'
      ? roundGrade(grade.second_term_grade)
      : null;
  const annualComponents: Array<number | null | undefined> = [];
  if (scheme.first_term_input_mode !== 'disabled') annualComponents.push(firstTermAverage);
  if (scheme.mid_year_exam_enabled) annualComponents.push(grade.mid_year_exam);
  if (scheme.second_term_input_mode !== 'disabled') annualComponents.push(secondTermAverage);
  const annualEffort = roundGrade(completeAverage(annualComponents));

  let gradeAfterCompletion: number | null = null;
  let effectiveGrade: number | null = null;
  let resultStatus: string | null = null;
  let exemptionStatus = 0;

  exemptionStatus = scheme.final_exam_enabled && annualEffort !== null && annualEffort >= settings.exemption_grade ? 1 : 0;
  const finalGrade = annualEffort === null
    ? null
    : exemptionStatus === 1 || !scheme.final_exam_enabled
      ? annualEffort
      : roundGrade(completeAverage([annualEffort, grade.final_exam]));

  if (finalGrade !== null) {
    if (exemptionStatus === 1 || finalGrade >= settings.passing_grade) {
      effectiveGrade = finalGrade;
      resultStatus = 'ناجح';
    } else if (!scheme.completion_exam_enabled) {
      effectiveGrade = finalGrade;
      resultStatus = 'راسب';
    } else if (grade.completion_exam == null || Number.isNaN(grade.completion_exam)) {
      effectiveGrade = finalGrade;
      resultStatus = 'مكمل';
    } else {
      gradeAfterCompletion = Math.max(finalGrade, grade.completion_exam);
      effectiveGrade = gradeAfterCompletion;
      resultStatus = effectiveGrade >= settings.passing_grade ? 'ناجح' : 'راسب';
    }
  }

  return {
    first_term_average: firstTermAverage,
    second_term_average: secondTermAverage,
    annual_effort: annualEffort,
    final_grade: finalGrade,
    grade_after_completion: gradeAfterCompletion,
    effective_grade: effectiveGrade,
    result_status: resultStatus,
    exemption_status: exemptionStatus,
  };
}
