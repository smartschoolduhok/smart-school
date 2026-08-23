import {
  enabledRawGradeFields,
  normalizeGradeSchemeSettings,
  type GradeSchemeSettings,
  type RawGradeField,
} from './gradeScheme.ts';
import { resultCardAppreciation } from './resultCardPresentation.ts';

export type ResultCardAcademicStatus = 'ناجح' | 'راسب' | 'مكمل';
export type ResultCardOverallStatus = ResultCardAcademicStatus | 'غير مكتمل';
export type ResultCardMode = 'partial' | 'complete';

export interface ResultCardSubject {
  id: number;
  subject_name: string;
  counts_in_average: number;
}

export interface ResultCardGrade {
  subject_id: number;
  subject_name: string;
  first_term_grade: number | null;
  first_month: number | null;
  second_month: number | null;
  mid_year_exam: number | null;
  second_term_grade: number | null;
  third_month: number | null;
  fourth_month: number | null;
  annual_effort: number | null;
  final_exam: number | null;
  final_grade: number | null;
  completion_exam: number | null;
  grade_after_completion: number | null;
  effective_grade: number | null;
  result_status: ResultCardAcademicStatus | null;
  exemption_status: number | null;
}

export interface ResultCardAcademicYear {
  id: number;
  name: string;
}

export interface ResultCardSettings extends GradeSchemeSettings {
  max_grade: number;
  passing_grade: number;
  exemption_grade: number;
  general_exemption_average_grade: number;
  general_exemption_min_subject_grade: number;
}

export interface ResultCardIncompleteSubject {
  subject_id: number;
  subject_name: string;
  missing_fields: string[];
}

export type ResultCardEvaluation =
  | {
      ok: true;
      academicYear: ResultCardAcademicYear;
      grades: ResultCardGrade[];
      card_mode: ResultCardMode;
      required_fields: RawGradeField[];
      incomplete_subjects: ResultCardIncompleteSubject[];
      summary: {
        total_subjects: number;
        pass_count: number;
        completion_count: number;
        fail_count: number;
        exempt_count: number;
        annual_effort_average: number | null;
        min_annual_effort: number | null;
        overall_average: number | null;
        appreciation: string | null;
        general_exemption_eligible: boolean | null;
        overall_result_status: ResultCardOverallStatus;
      };
    }
  | {
      ok: false;
      code: 'no_active_academic_year' | 'no_active_subjects';
    };

const VALID_RESULT_STATUSES: readonly ResultCardAcademicStatus[] = [
  'ناجح',
  'راسب',
  'مكمل',
];

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function blankGrade(subject: ResultCardSubject): ResultCardGrade {
  return {
    subject_id: subject.id,
    subject_name: subject.subject_name,
    first_term_grade: null,
    first_month: null,
    second_month: null,
    mid_year_exam: null,
    second_term_grade: null,
    third_month: null,
    fourth_month: null,
    annual_effort: null,
    final_exam: null,
    final_grade: null,
    completion_exam: null,
    grade_after_completion: null,
    effective_grade: null,
    result_status: null,
    exemption_status: null,
  };
}

function roundedAverage(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function evaluateResultCard(
  activeSubjects: ResultCardSubject[],
  grades: ResultCardGrade[],
  settingsInput: ResultCardSettings,
  academicYear: ResultCardAcademicYear | null,
): ResultCardEvaluation {
  if (!academicYear) {
    return { ok: false, code: 'no_active_academic_year' };
  }

  if (activeSubjects.length === 0) {
    return { ok: false, code: 'no_active_subjects' };
  }

  const scheme = normalizeGradeSchemeSettings(settingsInput);
  const settings: ResultCardSettings = { ...settingsInput, ...scheme };
  const requiredFields = enabledRawGradeFields(settings).filter(
    (field) => field !== 'completion_exam',
  );
  const annualInputFields = requiredFields.filter(
    (field) => field !== 'final_exam',
  );
  const gradesBySubject = new Map(grades.map((grade) => [grade.subject_id, grade]));
  const countedSubjectIds = new Set(
    activeSubjects
      .filter((subject) => subject.counts_in_average === 1)
      .map((subject) => subject.id),
  );
  const orderedGrades = activeSubjects.map(
    (subject) => gradesBySubject.get(subject.id) ?? blankGrade(subject),
  );
  const countedGrades = orderedGrades.filter((grade) => countedSubjectIds.has(grade.subject_id));

  const annualDataComplete = countedGrades.length > 0 && countedGrades.every(
    (grade) =>
      annualInputFields.every((field) => isFiniteNumber(grade[field])) &&
      isFiniteNumber(grade.annual_effort),
  );
  const annualEfforts = annualDataComplete
    ? countedGrades.map((grade) => grade.annual_effort as number)
    : [];
  const annualEffortAverage = annualDataComplete ? roundedAverage(annualEfforts) : null;
  const minAnnualEffort = annualDataComplete ? Math.min(...annualEfforts) : null;
  const generalExemptionEligible = annualDataComplete
    ? annualEffortAverage !== null &&
      annualEffortAverage >= settings.general_exemption_average_grade &&
      minAnnualEffort !== null &&
      minAnnualEffort >= settings.general_exemption_min_subject_grade
    : null;

  // General exemption is a card-level academic decision. It may complete the
  // presentation without mutating the persisted grade row or its individual flag.
  const evaluatedGrades = orderedGrades.map((grade) => {
    if (
      scheme.final_exam_enabled === 1 &&
      generalExemptionEligible === true &&
      !isFiniteNumber(grade.final_exam) &&
      isFiniteNumber(grade.annual_effort)
    ) {
      return {
        ...grade,
        final_grade: grade.final_grade ?? grade.annual_effort,
        effective_grade: grade.effective_grade ?? grade.annual_effort,
        result_status: grade.result_status ?? 'ناجح',
      } as ResultCardGrade;
    }
    return grade;
  });

  const incompleteSubjects = evaluatedGrades.flatMap((grade): ResultCardIncompleteSubject[] => {
    const missingFields: string[] = [];
    if (!gradesBySubject.has(grade.subject_id)) missingFields.push('grade_record');
    for (const field of annualInputFields) {
      if (!isFiniteNumber(grade[field])) missingFields.push(field);
    }
    if (!isFiniteNumber(grade.annual_effort)) missingFields.push('annual_effort');
    if (
      scheme.final_exam_enabled === 1 &&
      grade.exemption_status !== 1 &&
      generalExemptionEligible !== true &&
      !isFiniteNumber(grade.final_exam)
    ) {
      missingFields.push('final_exam');
    }
    if (!isFiniteNumber(grade.final_grade)) missingFields.push('final_grade');
    if (!isFiniteNumber(grade.effective_grade)) missingFields.push('effective_grade');
    if (!grade.result_status || !VALID_RESULT_STATUSES.includes(grade.result_status)) {
      missingFields.push('result_status');
    }
    if (grade.exemption_status !== 0 && grade.exemption_status !== 1) {
      missingFields.push('exemption_status');
    }
    const uniqueMissingFields = [...new Set(missingFields)];
    return uniqueMissingFields.length > 0
      ? [{
          subject_id: grade.subject_id,
          subject_name: grade.subject_name,
          missing_fields: uniqueMissingFields,
        }]
      : [];
  });

  const cardMode: ResultCardMode = incompleteSubjects.length > 0 ? 'partial' : 'complete';
  const hasFailure = evaluatedGrades.some((grade) => grade.result_status === 'راسب');
  const hasCompletion = evaluatedGrades.some((grade) => grade.result_status === 'مكمل');
  const overallResultStatus: ResultCardOverallStatus = cardMode === 'partial'
    ? 'غير مكتمل'
    : hasFailure
      ? 'راسب'
      : hasCompletion
        ? 'مكمل'
        : 'ناجح';
  const countedEvaluatedGrades = evaluatedGrades.filter(
    (grade) => countedSubjectIds.has(grade.subject_id),
  );
  const incompleteCountedSubjectIds = new Set(
    incompleteSubjects
      .filter((subject) => countedSubjectIds.has(subject.subject_id))
      .map((subject) => subject.subject_id),
  );
  const effectiveGrades = countedEvaluatedGrades
    .map((grade) => grade.effective_grade)
    .filter(isFiniteNumber);
  const overallAverage = countedEvaluatedGrades.length > 0 &&
    incompleteCountedSubjectIds.size === 0 &&
    effectiveGrades.length === countedEvaluatedGrades.length
    ? roundedAverage(effectiveGrades)
    : null;

  return {
    ok: true,
    academicYear,
    grades: evaluatedGrades,
    card_mode: cardMode,
    required_fields: requiredFields,
    incomplete_subjects: incompleteSubjects,
    summary: {
      total_subjects: evaluatedGrades.length,
      pass_count: evaluatedGrades.filter((grade) => grade.result_status === 'ناجح').length,
      completion_count: evaluatedGrades.filter((grade) => grade.result_status === 'مكمل').length,
      fail_count: evaluatedGrades.filter((grade) => grade.result_status === 'راسب').length,
      exempt_count: evaluatedGrades.filter((grade) => grade.exemption_status === 1).length,
      annual_effort_average: annualEffortAverage,
      min_annual_effort: minAnnualEffort,
      overall_average: overallAverage,
      appreciation: resultCardAppreciation(overallAverage, settings.max_grade),
      general_exemption_eligible: generalExemptionEligible,
      overall_result_status: overallResultStatus,
    },
  };
}
