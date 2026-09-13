export type PublishedAcademicStatus = 'pass' | 'completion' | 'fail' | 'incomplete';
export type PublishedExemptionStatus = 'not_applicable' | 'none' | 'individual' | 'general';
export type PublishedMinisterialStatus =
  | 'not_applicable'
  | 'eligible'
  | 'not_eligible'
  | 'comprehensive'
  | 'pending';
export type PublishedTransitionAction = 'promoted' | 'repeated' | 'graduated';

export interface PublishedAcademicOutcomeRow {
  id: number;
  student_id: number;
  student_name_snapshot: string;
  student_number: string | null;
  class_id: number;
  class_name_snapshot: string;
  section_id: number | null;
  section_name_snapshot: string | null;
  academic_year_id: number;
  academic_year_snapshot: string;
  card_number: string;
  publication_revision: number;
  published_at: number;
  card_data_json: string;
}

export interface PublishedTransitionRow {
  result_card_id: number;
  decision_action: PublishedTransitionAction;
  created_at: number;
}

export interface PublishedStudentOutcome {
  result_card_id: number;
  result_card_number: string;
  publication_revision: number;
  published_at: number;
  student_id: number;
  student_name: string;
  student_number: string | null;
  class_id: number;
  class_name: string;
  section_id: number | null;
  section_name: string | null;
  academic_year_id: number;
  academic_year: string;
  exam_round: string | null;
  academic_status: PublishedAcademicStatus;
  academic_status_label: string;
  exemption_status: PublishedExemptionStatus;
  exemption_status_label: string;
  ministerial_eligibility: PublishedMinisterialStatus;
  ministerial_eligibility_label: string;
  ministerial_reason: string | null;
  adjusted_failed_subjects: number;
  decision_points_used: number;
  completion_subject_names: string[];
  failed_subject_names: string[];
  exempt_subject_names: string[];
  policy_version: number | null;
  transition_action: PublishedTransitionAction | null;
  transition_action_label: string;
}

export interface PublishedAcademicOutcomeSummary {
  published_students: number;
  pass_count: number;
  completion_count: number;
  fail_count: number;
  incomplete_count: number;
  general_exemption_count: number;
  individual_exemption_count: number;
  ministerial_eligible_count: number;
  ministerial_comprehensive_count: number;
  ministerial_not_eligible_count: number;
  ministerial_pending_count: number;
  ministerial_not_applicable_count: number;
  promoted_count: number;
  repeated_count: number;
  graduated_count: number;
  awaiting_transition_count: number;
  students: PublishedStudentOutcome[];
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function parseSnapshot(value: string): Record<string, any> {
  try {
    return record(JSON.parse(value));
  } catch {
    return {};
  }
}

function finiteNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim())
    : [];
}

function academicStatus(summary: Record<string, any>): PublishedAcademicStatus {
  const raw = String(summary.academic_status_code || summary.academic_status || summary.overall_result_status || '');
  if (raw === 'pass' || raw === 'ناجح') return 'pass';
  if (raw === 'completion' || raw === 'مكمل') return 'completion';
  if (raw === 'fail' || raw === 'راسب') return 'fail';
  return 'incomplete';
}

function exemptionStatus(summary: Record<string, any>): PublishedExemptionStatus {
  const raw = String(summary.exemption_status || 'none');
  return raw === 'general' || raw === 'individual' || raw === 'not_applicable'
    ? raw
    : 'none';
}

function ministerialStatus(summary: Record<string, any>): PublishedMinisterialStatus {
  const raw = String(summary.ministerial_eligibility_code || 'not_applicable');
  return raw === 'eligible' || raw === 'not_eligible' || raw === 'comprehensive' || raw === 'pending'
    ? raw
    : 'not_applicable';
}

export function publishedAcademicStatusLabel(value: PublishedAcademicStatus): string {
  return ({ pass: 'ناجح', completion: 'مكمل', fail: 'راسب', incomplete: 'غير مكتمل' })[value];
}

export function publishedExemptionStatusLabel(value: PublishedExemptionStatus): string {
  return ({
    not_applicable: 'غير مطبق',
    none: 'لا يوجد',
    individual: 'إعفاء فردي',
    general: 'إعفاء عام',
  })[value];
}

export function publishedMinisterialStatusLabel(value: PublishedMinisterialStatus): string {
  return ({
    not_applicable: 'غير مطبق',
    eligible: 'مؤهل للدخول الوزاري',
    not_eligible: 'غير مؤهل للدخول الوزاري',
    comprehensive: 'دخول شامل',
    pending: 'بانتظار اكتمال الدرجات',
  })[value];
}

export function publishedTransitionActionLabel(
  value: PublishedTransitionAction | null,
  status?: PublishedAcademicStatus,
): string {
  if (!value) {
    return status === 'pass' || status === 'fail'
      ? 'بانتظار القرار النهائي'
      : 'غير قابل للترحيل حاليًا';
  }
  return ({ promoted: 'مترفع', repeated: 'معيد', graduated: 'متخرج' })[value];
}

export function summarizePublishedAcademicOutcomes(
  rows: PublishedAcademicOutcomeRow[],
  transitionRows: PublishedTransitionRow[],
): PublishedAcademicOutcomeSummary {
  const transitions = new Map(transitionRows.map(row => [Number(row.result_card_id), row]));
  const seen = new Set<string>();
  const students = rows.flatMap((row): PublishedStudentOutcome[] => {
    const key = `${row.student_id}:${row.academic_year_id}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const snapshot = parseSnapshot(row.card_data_json);
    const summary = record(snapshot.summary);
    const policy = record(snapshot.academic_policy);
    const status = academicStatus(summary);
    const exemption = exemptionStatus(summary);
    const ministerial = ministerialStatus(summary);
    const transition = transitions.get(Number(row.id))?.decision_action ?? null;
    return [{
      result_card_id: Number(row.id),
      result_card_number: String(row.card_number),
      publication_revision: Number(row.publication_revision),
      published_at: Number(row.published_at),
      student_id: Number(row.student_id),
      student_name: String(row.student_name_snapshot),
      student_number: row.student_number == null ? null : String(row.student_number),
      class_id: Number(row.class_id),
      class_name: String(row.class_name_snapshot),
      section_id: row.section_id == null ? null : Number(row.section_id),
      section_name: row.section_name_snapshot == null ? null : String(row.section_name_snapshot),
      academic_year_id: Number(row.academic_year_id),
      academic_year: String(row.academic_year_snapshot),
      exam_round: typeof snapshot.exam_round === 'string' ? snapshot.exam_round : null,
      academic_status: status,
      academic_status_label: publishedAcademicStatusLabel(status),
      exemption_status: exemption,
      exemption_status_label: publishedExemptionStatusLabel(exemption),
      ministerial_eligibility: ministerial,
      ministerial_eligibility_label: publishedMinisterialStatusLabel(ministerial),
      ministerial_reason: typeof summary.ministerial_reason === 'string' ? summary.ministerial_reason : null,
      adjusted_failed_subjects: finiteNumber(summary.adjusted_failed_subjects),
      decision_points_used: finiteNumber(summary.decision_points_used),
      completion_subject_names: stringList(summary.completion_subject_names),
      failed_subject_names: stringList(summary.failed_subject_names),
      exempt_subject_names: stringList(summary.exempt_subject_names),
      policy_version: policy.version != null && Number.isSafeInteger(Number(policy.version))
        ? Number(policy.version)
        : null,
      transition_action: transition,
      transition_action_label: publishedTransitionActionLabel(transition, status),
    }];
  });
  const count = <K extends keyof PublishedStudentOutcome>(field: K, value: PublishedStudentOutcome[K]) => (
    students.filter(student => student[field] === value).length
  );
  return {
    published_students: students.length,
    pass_count: count('academic_status', 'pass'),
    completion_count: count('academic_status', 'completion'),
    fail_count: count('academic_status', 'fail'),
    incomplete_count: count('academic_status', 'incomplete'),
    general_exemption_count: count('exemption_status', 'general'),
    individual_exemption_count: count('exemption_status', 'individual'),
    ministerial_eligible_count: count('ministerial_eligibility', 'eligible'),
    ministerial_comprehensive_count: count('ministerial_eligibility', 'comprehensive'),
    ministerial_not_eligible_count: count('ministerial_eligibility', 'not_eligible'),
    ministerial_pending_count: count('ministerial_eligibility', 'pending'),
    ministerial_not_applicable_count: count('ministerial_eligibility', 'not_applicable'),
    promoted_count: count('transition_action', 'promoted'),
    repeated_count: count('transition_action', 'repeated'),
    graduated_count: count('transition_action', 'graduated'),
    awaiting_transition_count: students.filter(student => (
      (student.academic_status === 'pass' || student.academic_status === 'fail')
      && student.transition_action === null
    )).length,
    students,
  };
}
