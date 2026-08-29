import {
  enabledRawGradeFields,
  normalizeGradeSchemeSettings,
  type GradeSchemeSettings,
  type RawGradeField,
} from './gradeScheme.ts';
import {
  isResultCardNumericColumnKey,
  resultCardAppreciation,
  type ResultCardColumnAverages,
  type ResultCardColumnDescriptor,
  type ResultCardNumericColumnKey,
} from './resultCardPresentation.ts';

export type ResultCardAcademicStatus = 'ناجح' | 'راسب' | 'مكمل';
export type ResultCardOverallStatus = ResultCardAcademicStatus | 'غير مكتمل';
export type ResultCardMode = 'partial' | 'complete';

export interface ResultCardSubject {
  id: number;
  subject_name: string;
  appears_in_report_card: number;
  counts_in_average: number;
}

export interface ResultCardSubjectPartitions {
  applicableSubjects: ResultCardSubject[];
  displaySubjects: ResultCardSubject[];
  countedSubjects: ResultCardSubject[];
}

export interface ResultCardGrade {
  subject_id: number;
  subject_name: string;
  first_term_grade: number | null;
  first_month: number | null;
  second_month: number | null;
  first_term_average: number | null;
  mid_year_exam: number | null;
  second_term_grade: number | null;
  third_month: number | null;
  fourth_month: number | null;
  second_term_average: number | null;
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
      counted_grades: ResultCardGrade[];
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
    first_term_average: null,
    mid_year_exam: null,
    second_term_grade: null,
    third_month: null,
    fourth_month: null,
    second_term_average: null,
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

/**
 * The caller supplies the canonical applicable set (active assignments joined
 * to active, same-school subjects). Display and aggregate flags are intentionally
 * independent and are partitioned once here for every Result Card calculation.
 */
export function partitionResultCardSubjects(
  applicableSubjects: ResultCardSubject[],
): ResultCardSubjectPartitions {
  return {
    applicableSubjects,
    displaySubjects: applicableSubjects.filter(
      (subject) => subject.appears_in_report_card === 1,
    ),
    countedSubjects: applicableSubjects.filter(
      (subject) => subject.counts_in_average === 1,
    ),
  };
}

function expectsResultCardColumn(
  grade: ResultCardGrade | undefined,
  key: ResultCardNumericColumnKey,
  settings: ResultCardSettings,
  generalExemptionEligible: boolean | null,
): boolean {
  if (key === 'final_exam') {
    return !grade || (
      grade.exemption_status !== 1 && generalExemptionEligible !== true
    );
  }
  if (key === 'completion_exam') {
    return !!grade &&
      settings.completion_exam_enabled === 1 &&
      isFiniteNumber(grade.final_grade) &&
      grade.final_grade < settings.passing_grade;
  }
  return true;
}

export function calculateResultCardColumnAverages(
  activeSubjects: ResultCardSubject[],
  grades: ResultCardGrade[],
  settingsInput: ResultCardSettings,
  visibleColumns: readonly ResultCardColumnDescriptor[],
  generalExemptionEligible: boolean | null,
): ResultCardColumnAverages {
  const settings: ResultCardSettings = {
    ...settingsInput,
    ...normalizeGradeSchemeSettings(settingsInput),
  };
  const countedSubjectIds = activeSubjects
    .filter((subject) => subject.counts_in_average === 1)
    .map((subject) => subject.id);
  const gradesBySubject = new Map(grades.map((grade) => [grade.subject_id, grade]));
  const averages: ResultCardColumnAverages = {};

  for (const column of visibleColumns) {
    if (!isResultCardNumericColumnKey(column.key)) continue;
    const key = column.key;
    if (countedSubjectIds.length === 0) {
      averages[key] = null;
      continue;
    }

    const expectedGrades = countedSubjectIds
      .map((subjectId) => gradesBySubject.get(subjectId))
      .filter((grade) => expectsResultCardColumn(
        grade,
        key,
        settings,
        generalExemptionEligible,
      ));
    if (expectedGrades.length === 0 || expectedGrades.some((grade) =>
      !grade || !isFiniteNumber(grade[key])
    )) {
      averages[key] = null;
      continue;
    }
    averages[key] = roundedAverage(
      expectedGrades.map((grade) => grade?.[key] as number),
    );
  }

  return averages;
}

export function evaluateResultCard(
  applicableSubjects: ResultCardSubject[],
  grades: ResultCardGrade[],
  settingsInput: ResultCardSettings,
  academicYear: ResultCardAcademicYear | null,
): ResultCardEvaluation {
  if (!academicYear) {
    return { ok: false, code: 'no_active_academic_year' };
  }

  if (applicableSubjects.length === 0) {
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
  const { displaySubjects, countedSubjects } = partitionResultCardSubjects(
    applicableSubjects,
  );
  // Preserve the pre-applicability behavior: an official card requires at
  // least one visible subject row. Hidden counted subjects may affect an
  // otherwise visible card, but must never produce an empty "successful" card.
  if (displaySubjects.length === 0) {
    return { ok: false, code: 'no_active_subjects' };
  }
  const countedSubjectIds = new Set(countedSubjects.map((subject) => subject.id));
  const orderedGrades = applicableSubjects.map(
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

  const incompleteForGrades = (
    targetGrades: ResultCardGrade[],
  ): ResultCardIncompleteSubject[] => targetGrades.flatMap((grade): ResultCardIncompleteSubject[] => {
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

  const displaySubjectIds = new Set(displaySubjects.map((subject) => subject.id));
  const displayGrades = evaluatedGrades.filter(
    (grade) => displaySubjectIds.has(grade.subject_id),
  );
  const countedEvaluatedGrades = evaluatedGrades.filter(
    (grade) => countedSubjectIds.has(grade.subject_id),
  );
  const incompleteSubjects = incompleteForGrades(displayGrades);
  const incompleteCountedSubjects = incompleteForGrades(countedEvaluatedGrades);

  const cardMode: ResultCardMode = incompleteSubjects.length > 0 ? 'partial' : 'complete';
  const hasFailure = displayGrades.some((grade) => grade.result_status === 'راسب');
  const hasCompletion = displayGrades.some((grade) => grade.result_status === 'مكمل');
  const overallResultStatus: ResultCardOverallStatus = cardMode === 'partial'
    ? 'غير مكتمل'
    : hasFailure
      ? 'راسب'
      : hasCompletion
        ? 'مكمل'
        : 'ناجح';
  const effectiveGrades = countedEvaluatedGrades
    .map((grade) => grade.effective_grade)
    .filter(isFiniteNumber);
  const overallAverage = countedEvaluatedGrades.length > 0 &&
    incompleteCountedSubjects.length === 0 &&
    effectiveGrades.length === countedEvaluatedGrades.length
    ? roundedAverage(effectiveGrades)
    : null;

  return {
    ok: true,
    academicYear,
    grades: displayGrades,
    counted_grades: countedEvaluatedGrades,
    card_mode: cardMode,
    required_fields: requiredFields,
    incomplete_subjects: incompleteSubjects,
    summary: {
      total_subjects: displayGrades.length,
      pass_count: displayGrades.filter((grade) => grade.result_status === 'ناجح').length,
      completion_count: displayGrades.filter((grade) => grade.result_status === 'مكمل').length,
      fail_count: displayGrades.filter((grade) => grade.result_status === 'راسب').length,
      exempt_count: displayGrades.filter((grade) => grade.exemption_status === 1).length,
      annual_effort_average: annualEffortAverage,
      min_annual_effort: minAnnualEffort,
      overall_average: overallAverage,
      appreciation: resultCardAppreciation(overallAverage, settings.max_grade),
      general_exemption_eligible: generalExemptionEligible,
      overall_result_status: overallResultStatus,
    },
  };
}
