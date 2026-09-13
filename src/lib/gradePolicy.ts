export type GradePolicyKind = 'terminal' | 'non_terminal';
export type GradePolicyStatus = 'draft' | 'approved' | 'locked';
export type DecisionAllocationMode = 'optimal' | 'manual';
export type FractionRoundingMode = 'nearest' | 'ceil' | 'none';
export type MinisterialEntryMode =
  | 'none'
  | 'all_continuing'
  | 'pass_only'
  | 'pass_or_completion';

export type AcademicStatus = 'pass' | 'completion' | 'fail' | 'incomplete';
export type MinisterialEligibility =
  | 'not_applicable'
  | 'eligible'
  | 'not_eligible'
  | 'comprehensive'
  | 'pending';
export type SubjectAcademicStatus =
  | 'pass'
  | 'fail'
  | 'exempt_individual'
  | 'exempt_general'
  | 'incomplete';

export interface AcademicGradePolicy {
  id?: number;
  school_id?: number;
  academic_year_id?: number;
  class_id?: number;
  version?: number;
  status?: GradePolicyStatus;
  policy_kind: GradePolicyKind;
  pass_mark: number;
  decision_points: number;
  decision_allocation_mode: DecisionAllocationMode;
  decision_points_outcome_only: number | boolean;
  max_completion_subjects: number;
  exemption_enabled: number | boolean;
  individual_exemption_grade: number;
  general_exemption_average_grade: number;
  general_exemption_min_subject_grade: number;
  ministerial_entry_mode: MinisterialEntryMode;
  ministerial_max_failed_subjects: number;
  minimum_monthly_exams_per_term: number;
  fraction_rounding_mode: FractionRoundingMode;
  source_reference?: string | null;
  notes?: string | null;
}

export interface AcademicSubjectGradeInput {
  subject_id: number;
  subject_name: string;
  annual_effort: number | null;
  final_grade: number | null;
  effective_grade: number | null;
  counts_in_average?: number | boolean;
  order_index?: number;
}

export interface AcademicSubjectOutcome {
  subject_id: number;
  subject_name: string;
  source_grade: number | null;
  decision_points: number;
  adjusted_grade: number | null;
  deficit_to_pass: number | null;
  status: SubjectAcademicStatus;
}

export interface StudentAcademicPolicyOutcome {
  complete: boolean;
  policy_kind: GradePolicyKind;
  academic_status: AcademicStatus;
  ministerial_eligibility: MinisterialEligibility;
  ministerial_reason: string;
  exemption_status: 'not_applicable' | 'none' | 'individual' | 'general';
  general_exemption_eligible: boolean;
  annual_effort_average: number | null;
  minimum_annual_effort: number | null;
  raw_failed_subjects: number;
  adjusted_failed_subjects: number;
  decision_points_available: number;
  decision_points_used: number;
  decision_points_remaining: number;
  subjects: AcademicSubjectOutcome[];
}

export interface GradePolicyEvaluationOptions {
  manual_allocations?: Record<number, number>;
}

const EPSILON = 1e-9;

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function roundStable(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

function truthyFlag(value: number | boolean | undefined): boolean {
  return value === true || value === 1;
}

function roundedAverage(values: number[], mode: FractionRoundingMode): number | null {
  if (values.length === 0) return null;
  const value = values.reduce((sum, item) => sum + item, 0) / values.length;
  if (mode === 'ceil') return Math.ceil(value);
  if (mode === 'nearest') return Math.round(value);
  return roundStable(value);
}

export function validateAcademicGradePolicy(
  input: AcademicGradePolicy,
): string | null {
  if (!['terminal', 'non_terminal'].includes(input.policy_kind)) {
    return 'نوع سياسة الدرجات غير صالح';
  }
  if (!finiteNumber(input.pass_mark) || input.pass_mark <= 0 || input.pass_mark > 100) {
    return 'درجة النجاح يجب أن تكون أكبر من صفر ولا تتجاوز 100';
  }
  if (!finiteNumber(input.decision_points) || input.decision_points < 0 || input.decision_points > 100) {
    return 'رصيد درجات القرار يجب أن يكون بين 0 و100';
  }
  if (!Number.isInteger(input.max_completion_subjects) || input.max_completion_subjects < 0 || input.max_completion_subjects > 30) {
    return 'عدد مواد الإكمال يجب أن يكون عدداً صحيحاً بين 0 و30';
  }
  if (!['optimal', 'manual'].includes(input.decision_allocation_mode)) {
    return 'طريقة توزيع درجات القرار غير صالحة';
  }
  if (![1, 2].includes(input.minimum_monthly_exams_per_term)) {
    return 'الحد الأدنى للامتحانات الشهرية يجب أن يكون 1 أو 2';
  }
  if (!['nearest', 'ceil', 'none'].includes(input.fraction_rounding_mode)) {
    return 'طريقة معالجة الكسور غير صالحة';
  }
  if (!['none', 'all_continuing', 'pass_only', 'pass_or_completion'].includes(input.ministerial_entry_mode)) {
    return 'نوع الدخول الوزاري غير صالح';
  }
  if (!Number.isInteger(input.ministerial_max_failed_subjects) || input.ministerial_max_failed_subjects < 0 || input.ministerial_max_failed_subjects > 30) {
    return 'عدد مواد الدخول الوزاري يجب أن يكون عدداً صحيحاً بين 0 و30';
  }

  if (input.policy_kind === 'terminal') {
    if (truthyFlag(input.exemption_enabled)) return 'لا يمكن تفعيل الإعفاء للصفوف المنتهية';
  } else if (input.ministerial_entry_mode !== 'none' || input.ministerial_max_failed_subjects !== 0) {
    return 'الدخول الوزاري يطبق على الصفوف المنتهية فقط';
  }

  if (truthyFlag(input.exemption_enabled)) {
    if (!finiteNumber(input.individual_exemption_grade) || input.individual_exemption_grade < input.pass_mark || input.individual_exemption_grade > 100) {
      return 'درجة الإعفاء الفردي يجب أن تكون بين درجة النجاح و100';
    }
    if (!finiteNumber(input.general_exemption_average_grade) || input.general_exemption_average_grade < input.pass_mark || input.general_exemption_average_grade > 100) {
      return 'متوسط الإعفاء العام يجب أن يكون بين درجة النجاح و100';
    }
    if (!finiteNumber(input.general_exemption_min_subject_grade)
      || input.general_exemption_min_subject_grade < input.pass_mark
      || input.general_exemption_min_subject_grade > input.general_exemption_average_grade) {
      return 'أدنى مادة للإعفاء العام يجب أن تكون بين درجة النجاح ومتوسط الإعفاء العام';
    }
  }
  return null;
}

function sourceGradeForPolicy(
  policy: AcademicGradePolicy,
  subject: AcademicSubjectGradeInput,
): number | null {
  if (policy.policy_kind === 'terminal') return subject.annual_effort;
  if (finiteNumber(subject.effective_grade)) return subject.effective_grade;
  return subject.final_grade;
}

function optimalAllocations(
  subjects: Array<{ subject: AcademicSubjectGradeInput; source: number; deficit: number }>,
  available: number,
): Map<number, number> {
  const allocations = new Map<number, number>();
  let remaining = available;
  const candidates = [...subjects].sort((left, right) => (
    left.deficit - right.deficit
    || Number(left.subject.order_index ?? 0) - Number(right.subject.order_index ?? 0)
    || left.subject.subject_id - right.subject.subject_id
  ));
  for (const candidate of candidates) {
    if (candidate.deficit <= remaining + EPSILON) {
      allocations.set(candidate.subject.subject_id, candidate.deficit);
      remaining = roundStable(remaining - candidate.deficit);
    }
  }
  return allocations;
}

function manualAllocations(
  policy: AcademicGradePolicy,
  subjects: Array<{ subject: AcademicSubjectGradeInput; source: number; deficit: number }>,
  requested: Record<number, number>,
): Map<number, number> {
  const candidates = new Map(subjects.map(item => [item.subject.subject_id, item]));
  const allocations = new Map<number, number>();
  let total = 0;
  for (const [rawSubjectId, rawPoints] of Object.entries(requested)) {
    const subjectId = Number(rawSubjectId);
    const points = Number(rawPoints);
    const candidate = candidates.get(subjectId);
    if (!candidate || !finiteNumber(points) || points < 0 || points > candidate.deficit + EPSILON) {
      throw new Error('توزيع درجات القرار اليدوي غير صالح');
    }
    if (truthyFlag(policy.decision_points_outcome_only) && points > EPSILON && Math.abs(points - candidate.deficit) > EPSILON) {
      throw new Error('يجب أن تغير درجات القرار اليدوية حالة المادة أو تتركها دون تغيير');
    }
    if (points > EPSILON) allocations.set(subjectId, roundStable(points));
    total += points;
  }
  if (total > policy.decision_points + EPSILON) {
    throw new Error('مجموع درجات القرار اليدوية يتجاوز الرصيد المتاح');
  }
  return allocations;
}

function ministerialDecision(
  policy: AcademicGradePolicy,
  complete: boolean,
  adjustedFailedSubjects: number,
): { eligibility: MinisterialEligibility; reason: string } {
  if (policy.policy_kind !== 'terminal' || policy.ministerial_entry_mode === 'none') {
    return { eligibility: 'not_applicable', reason: 'الدخول الوزاري غير مطبق على هذه السياسة' };
  }
  if (policy.ministerial_entry_mode === 'all_continuing') {
    return { eligibility: 'comprehensive', reason: 'دخول شامل للطلبة المستمرين وفق السياسة المعتمدة' };
  }
  if (!complete) {
    return { eligibility: 'pending', reason: 'لا يمكن حسم الدخول قبل اكتمال درجات السعي' };
  }
  if (policy.ministerial_entry_mode === 'pass_only') {
    return adjustedFailedSubjects === 0
      ? { eligibility: 'eligible', reason: 'ناجح في جميع مواد السعي' }
      : { eligibility: 'not_eligible', reason: 'السياسة تسمح بدخول الناجحين في جميع المواد فقط' };
  }
  return adjustedFailedSubjects <= policy.ministerial_max_failed_subjects
    ? {
        eligibility: 'eligible',
        reason: adjustedFailedSubjects === 0
          ? 'ناجح في جميع مواد السعي'
          : `مكمل في ${adjustedFailedSubjects} مادة ضمن الحد المسموح`,
      }
    : {
        eligibility: 'not_eligible',
        reason: `عدد مواد الإكمال ${adjustedFailedSubjects} يتجاوز الحد المسموح ${policy.ministerial_max_failed_subjects}`,
      };
}

export function evaluateStudentAcademicPolicy(
  policy: AcademicGradePolicy,
  subjectInputs: AcademicSubjectGradeInput[],
  options: GradePolicyEvaluationOptions = {},
): StudentAcademicPolicyOutcome {
  const validationError = validateAcademicGradePolicy(policy);
  if (validationError) throw new Error(validationError);

  const subjects = [...subjectInputs];
  const exemptionSubjects = subjects.filter(subject => (
    subject.counts_in_average !== 0 && subject.counts_in_average !== false
  ));
  const annualEfforts = exemptionSubjects.map(subject => subject.annual_effort).filter(finiteNumber);
  const annualEffortsComplete = exemptionSubjects.length > 0
    && annualEfforts.length === exemptionSubjects.length;
  const annualEffortAverage = annualEffortsComplete
    ? roundedAverage(annualEfforts, policy.fraction_rounding_mode)
    : null;
  const minimumAnnualEffort = annualEffortsComplete ? Math.min(...annualEfforts) : null;
  const exemptionEnabled = policy.policy_kind === 'non_terminal' && truthyFlag(policy.exemption_enabled);
  const generalExemptionEligible = exemptionEnabled
    && annualEffortsComplete
    && annualEffortAverage !== null
    && annualEffortAverage >= policy.general_exemption_average_grade
    && minimumAnnualEffort !== null
    && minimumAnnualEffort >= policy.general_exemption_min_subject_grade;

  const preDecision = subjects.map(subject => {
    const individualExempt = exemptionEnabled
      && finiteNumber(subject.annual_effort)
      && subject.annual_effort >= policy.individual_exemption_grade;
    const source = generalExemptionEligible || individualExempt
      ? subject.annual_effort
      : sourceGradeForPolicy(policy, subject);
    return { subject, source, individualExempt };
  });
  const complete = subjects.length > 0 && preDecision.every(item => finiteNumber(item.source));
  const failedCandidates = preDecision
    .filter((item): item is typeof item & { source: number } => (
      finiteNumber(item.source)
      && !generalExemptionEligible
      && !item.individualExempt
      && item.source < policy.pass_mark
    ))
    .map(item => ({
      subject: item.subject,
      source: item.source,
      deficit: roundStable(policy.pass_mark - item.source),
    }));
  const allocations = policy.decision_allocation_mode === 'manual'
    ? manualAllocations(policy, failedCandidates, options.manual_allocations || {})
    : optimalAllocations(failedCandidates, policy.decision_points);

  const outcomeSubjects: AcademicSubjectOutcome[] = preDecision.map(item => {
    const points = allocations.get(item.subject.subject_id) || 0;
    const adjusted = finiteNumber(item.source) ? roundStable(item.source + points) : null;
    const deficit = finiteNumber(item.source) && item.source < policy.pass_mark
      ? roundStable(policy.pass_mark - item.source)
      : 0;
    let status: SubjectAcademicStatus;
    if (!finiteNumber(item.source)) status = 'incomplete';
    else if (generalExemptionEligible) status = 'exempt_general';
    else if (item.individualExempt) status = 'exempt_individual';
    else status = adjusted !== null && adjusted >= policy.pass_mark ? 'pass' : 'fail';
    return {
      subject_id: item.subject.subject_id,
      subject_name: item.subject.subject_name,
      source_grade: item.source,
      decision_points: points,
      adjusted_grade: adjusted,
      deficit_to_pass: deficit,
      status,
    };
  });

  const rawFailedSubjects = failedCandidates.length;
  const adjustedFailedSubjects = outcomeSubjects.filter(subject => subject.status === 'fail').length;
  const decisionPointsUsed = roundStable([...allocations.values()].reduce((sum, value) => sum + value, 0));
  const academicStatus: AcademicStatus = !complete
    ? 'incomplete'
    : adjustedFailedSubjects === 0
      ? 'pass'
      : adjustedFailedSubjects <= policy.max_completion_subjects
        ? 'completion'
        : 'fail';
  const ministerial = ministerialDecision(policy, complete, adjustedFailedSubjects);
  const individualExemptionUsed = outcomeSubjects.some(subject => subject.status === 'exempt_individual');

  return {
    complete,
    policy_kind: policy.policy_kind,
    academic_status: academicStatus,
    ministerial_eligibility: ministerial.eligibility,
    ministerial_reason: ministerial.reason,
    exemption_status: policy.policy_kind === 'terminal'
      ? 'not_applicable'
      : generalExemptionEligible
        ? 'general'
        : individualExemptionUsed
          ? 'individual'
          : 'none',
    general_exemption_eligible: generalExemptionEligible,
    annual_effort_average: annualEffortAverage,
    minimum_annual_effort: minimumAnnualEffort,
    raw_failed_subjects: rawFailedSubjects,
    adjusted_failed_subjects: adjustedFailedSubjects,
    decision_points_available: policy.decision_points,
    decision_points_used: decisionPointsUsed,
    decision_points_remaining: roundStable(policy.decision_points - decisionPointsUsed),
    subjects: outcomeSubjects,
  };
}

export function academicStatusLabel(status: AcademicStatus): string {
  return ({ pass: 'ناجح', completion: 'مكمل', fail: 'راسب', incomplete: 'غير مكتمل' })[status];
}

export function ministerialEligibilityLabel(status: MinisterialEligibility): string {
  return ({
    not_applicable: 'غير مطبق',
    eligible: 'مؤهل للدخول الوزاري',
    not_eligible: 'غير مؤهل للدخول الوزاري',
    comprehensive: 'دخول شامل',
    pending: 'بانتظار اكتمال الدرجات',
  })[status];
}
