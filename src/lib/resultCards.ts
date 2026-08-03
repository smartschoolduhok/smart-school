export type ResultCardOverallStatus = 'ناجح' | 'راسب' | 'مكمل';

export interface ResultCardSubject {
  id: number;
  subject_name: string;
}

export interface ResultCardGrade {
  subject_id: number;
  subject_name: string;
  annual_effort: number | null;
  final_exam: number | null;
  final_grade: number | null;
  completion_exam: number | null;
  grade_after_completion: number | null;
  effective_grade: number | null;
  result_status: ResultCardOverallStatus | null;
  exemption_status: number | null;
  first_month: number | null;
  second_month: number | null;
  third_month: number | null;
  fourth_month: number | null;
  mid_year_exam: number | null;
}

export interface ResultCardAcademicYear {
  id: number;
  name: string;
}

export interface ResultCardSettings {
  passing_grade: number;
  exemption_grade: number;
  general_exemption_average_grade: number;
  general_exemption_min_subject_grade: number;
}

export type ResultCardEvaluation =
  | {
      ok: true;
      academicYear: ResultCardAcademicYear;
      grades: ResultCardGrade[];
      summary: {
        total_subjects: number;
        annual_effort_average: number;
        min_annual_effort: number;
        general_exemption_eligible: boolean;
        overall_result_status: ResultCardOverallStatus;
      };
    }
  | {
      ok: false;
      code:
        | 'no_active_academic_year'
        | 'no_active_subjects'
        | 'missing_grade_records'
        | 'incomplete_grades';
      subjects?: string[];
    };

const REQUIRED_NUMERIC_GRADE_FIELDS: Array<keyof ResultCardGrade> = [
  'first_month',
  'second_month',
  'third_month',
  'fourth_month',
  'mid_year_exam',
  'annual_effort',
  'final_grade',
  'effective_grade',
];

const VALID_RESULT_STATUSES: readonly ResultCardOverallStatus[] = [
  'ناجح',
  'راسب',
  'مكمل',
];

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function evaluateResultCard(
  activeSubjects: ResultCardSubject[],
  grades: ResultCardGrade[],
  settings: ResultCardSettings,
  academicYear: ResultCardAcademicYear | null,
): ResultCardEvaluation {
  if (!academicYear) {
    return { ok: false, code: 'no_active_academic_year' };
  }

  if (activeSubjects.length === 0) {
    return { ok: false, code: 'no_active_subjects' };
  }

  const gradesBySubject = new Map(grades.map((grade) => [grade.subject_id, grade]));
  const missingSubjects = activeSubjects.filter((subject) => !gradesBySubject.has(subject.id));
  if (missingSubjects.length > 0) {
    return {
      ok: false,
      code: 'missing_grade_records',
      subjects: missingSubjects.map((subject) => subject.subject_name),
    };
  }

  const incompleteSubjects = grades.filter((grade) => {
    const hasAllRequiredNumbers = REQUIRED_NUMERIC_GRADE_FIELDS.every((field) =>
      isFiniteNumber(grade[field]),
    );
    const hasValidStatus =
      grade.result_status !== null && VALID_RESULT_STATUSES.includes(grade.result_status);
    const hasExemptionStatus =
      grade.exemption_status === 0 || grade.exemption_status === 1;
    return !hasAllRequiredNumbers || !hasValidStatus || !hasExemptionStatus;
  });

  if (incompleteSubjects.length > 0) {
    return {
      ok: false,
      code: 'incomplete_grades',
      subjects: incompleteSubjects.map((grade) => grade.subject_name),
    };
  }

  const annualEfforts = grades.map((grade) => grade.annual_effort as number);
  const annualEffortAverage = Math.round(
    annualEfforts.reduce((sum, grade) => sum + grade, 0) / annualEfforts.length,
  );
  const minAnnualEffort = Math.min(...annualEfforts);
  const generalExemptionEligible =
    annualEffortAverage >= settings.general_exemption_average_grade &&
    minAnnualEffort >= settings.general_exemption_min_subject_grade;

  const subjectsMissingRequiredFinalExam = grades.filter(
    (grade) =>
      !isFiniteNumber(grade.final_exam) &&
      grade.exemption_status !== 1 &&
      !generalExemptionEligible,
  );
  if (subjectsMissingRequiredFinalExam.length > 0) {
    return {
      ok: false,
      code: 'incomplete_grades',
      subjects: subjectsMissingRequiredFinalExam.map((grade) => grade.subject_name),
    };
  }

  const hasFailure = grades.some((grade) => grade.result_status === 'راسب');
  const hasIncomplete = grades.some((grade) => grade.result_status === 'مكمل');
  const overallResultStatus: ResultCardOverallStatus = hasFailure
    ? 'راسب'
    : hasIncomplete
      ? 'مكمل'
      : 'ناجح';

  return {
    ok: true,
    academicYear,
    grades,
    summary: {
      total_subjects: grades.length,
      annual_effort_average: annualEffortAverage,
      min_annual_effort: minAnnualEffort,
      general_exemption_eligible: generalExemptionEligible,
      overall_result_status: overallResultStatus,
    },
  };
}
