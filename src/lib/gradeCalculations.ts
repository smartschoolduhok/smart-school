export interface RawGradeValues {
  first_month?: number | null;
  second_month?: number | null;
  third_month?: number | null;
  fourth_month?: number | null;
  mid_year_exam?: number | null;
  final_exam?: number | null;
  completion_exam?: number | null;
}

export interface GradeCalculationSettings {
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

function average(values: Array<number | null | undefined>): number | null {
  const valid = values.filter(value => value !== null && value !== undefined && !Number.isNaN(value)) as number[];
  if (!valid.length) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

export function calculateGrades(
  grade: RawGradeValues,
  settings: GradeCalculationSettings,
): CalculatedGradeValues {
  const firstTermAverage = roundGrade(average([grade.first_month, grade.second_month]));
  const secondTermAverage = roundGrade(average([grade.third_month, grade.fourth_month]));
  const annualEffort = roundGrade(average([firstTermAverage, grade.mid_year_exam, secondTermAverage]));
  const finalGrade = roundGrade(average([annualEffort, grade.final_exam]));

  let gradeAfterCompletion: number | null = null;
  let effectiveGrade: number | null = null;
  let resultStatus: string | null = null;
  let exemptionStatus = 0;

  if (finalGrade !== null) {
    if (finalGrade >= settings.passing_grade) {
      effectiveGrade = finalGrade;
      resultStatus = 'ناجح';
    } else if (grade.completion_exam != null) {
      gradeAfterCompletion = Math.max(finalGrade, grade.completion_exam);
      effectiveGrade = gradeAfterCompletion;
      resultStatus = effectiveGrade >= settings.passing_grade ? 'ناجح' : 'راسب';
    } else {
      effectiveGrade = finalGrade;
      resultStatus = 'مكمل';
    }

    if (annualEffort !== null && annualEffort >= settings.exemption_grade) exemptionStatus = 1;
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
