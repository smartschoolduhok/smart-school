import { calculateGrades, type GradeCalculationSettings, type RawGradeValues } from './gradeCalculations';
import {
  evaluateStudentAcademicPolicy,
  type AcademicGradePolicy,
  type AcademicSubjectGradeInput,
  type GradePolicyEvaluationOptions,
  type StudentAcademicPolicyOutcome,
} from './gradePolicy';

export interface StudentAcademicPolicyContext {
  student_id: number;
  student_name: string;
  student_number: string;
  school_id: number;
  academic_year_id: number;
  academic_year_name: string;
  class_id: number;
  class_name: string;
  section_id: number | null;
  section_name: string | null;
}

export interface StudentAcademicPolicyResult {
  context: StudentAcademicPolicyContext;
  policy: AcademicGradePolicy & Record<string, unknown>;
  outcome: StudentAcademicPolicyOutcome;
  decision_set: Record<string, any> | null;
}

interface PolicyGradeRow extends RawGradeValues {
  grade_id: number | null;
  student_id: number;
  class_id: number;
  subject_id: number;
  subject_name: string;
  order_index: number;
  counts_in_average: number;
  first_term_average?: number | null;
  second_term_average?: number | null;
  annual_effort?: number | null;
  final_grade?: number | null;
  grade_after_completion?: number | null;
  effective_grade?: number | null;
  result_status?: string | null;
  exemption_status?: number | null;
}

export function normalizeAcademicGradePolicyRow<T extends Record<string, any>>(
  row: T,
): T & AcademicGradePolicy {
  return {
    ...row,
    id: Number(row.id),
    school_id: Number(row.school_id),
    academic_year_id: Number(row.academic_year_id),
    class_id: Number(row.class_id),
    version: Number(row.version),
    pass_mark: Number(row.pass_mark),
    decision_points: Number(row.decision_points),
    max_completion_subjects: Number(row.max_completion_subjects),
    individual_exemption_grade: Number(row.individual_exemption_grade),
    general_exemption_average_grade: Number(row.general_exemption_average_grade),
    general_exemption_min_subject_grade: Number(row.general_exemption_min_subject_grade),
    ministerial_max_failed_subjects: Number(row.ministerial_max_failed_subjects),
    minimum_monthly_exams_per_term: Number(row.minimum_monthly_exams_per_term),
  } as T & AcademicGradePolicy;
}

export function gradeCalculationSettingsForPolicy(
  baseSettings: GradeCalculationSettings & Record<string, any>,
  policy: AcademicGradePolicy | null | undefined,
): GradeCalculationSettings & Record<string, any> {
  if (!policy) return baseSettings;
  return {
    ...baseSettings,
    passing_grade: policy.pass_mark,
    exemption_grade: policy.individual_exemption_grade,
    general_exemption_average_grade: policy.general_exemption_average_grade,
    general_exemption_min_subject_grade: policy.general_exemption_min_subject_grade,
    exemption_enabled: policy.policy_kind === 'non_terminal'
      && (policy.exemption_enabled === 1 || policy.exemption_enabled === true),
    minimum_monthly_exams_per_term: policy.minimum_monthly_exams_per_term,
  };
}

export function calculatePolicyGradeRow(
  row: PolicyGradeRow,
  settings: GradeCalculationSettings & Record<string, any>,
): PolicyGradeRow {
  const calculated = calculateGrades(row, settings);
  return { ...row, ...calculated };
}

export async function loadCurrentAcademicGradePolicies(
  db: D1Database,
  schoolId: number,
  academicYearId: number,
  options: { includeDraft?: boolean; classId?: number | null } = {},
): Promise<Array<AcademicGradePolicy & Record<string, any>>> {
  const conditions = ['policy.school_id=?', 'policy.academic_year_id=?'];
  const params: any[] = [schoolId, academicYearId];
  if (options.includeDraft) {
    conditions.push('policy.is_current=1');
  } else {
    // A pending amendment must never suspend the last approved decision. The
    // newest approved/locked version remains authoritative until its successor
    // is explicitly approved.
    conditions.push("policy.status IN ('approved','locked')");
    conditions.push(`NOT EXISTS(
      SELECT 1 FROM academic_grade_policies newer
      WHERE newer.school_id=policy.school_id
        AND newer.academic_year_id=policy.academic_year_id
        AND newer.class_id=policy.class_id
        AND newer.status IN ('approved','locked')
        AND newer.version>policy.version
    )`);
  }
  if (options.classId != null) {
    conditions.push('policy.class_id=?');
    params.push(options.classId);
  }
  const rows = await db.prepare(`
    SELECT policy.*, class.name AS class_name, class.stage AS class_stage,
           year.name AS academic_year_name
    FROM academic_grade_policies policy
    JOIN classes class ON class.id=policy.class_id AND class.school_id=policy.school_id
    JOIN academic_years year ON year.id=policy.academic_year_id AND year.school_id=policy.school_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY class.order_index, class.id
  `).bind(...params).all<Record<string, any>>();
  return (rows.results || []).map(normalizeAcademicGradePolicyRow);
}

export async function resolveAcademicYearId(
  db: D1Database,
  schoolId: number,
  requestedAcademicYearId?: number | null,
): Promise<number | null> {
  if (requestedAcademicYearId != null) {
    const year = await db.prepare(
      'SELECT id FROM academic_years WHERE id=? AND school_id=?',
    ).bind(requestedAcademicYearId, schoolId).first<{ id: number }>();
    return year ? Number(year.id) : null;
  }
  const active = await db.prepare(`
    SELECT id FROM academic_years
    WHERE school_id=? AND is_active=1
    ORDER BY id DESC LIMIT 1
  `).bind(schoolId).first<{ id: number }>();
  return active ? Number(active.id) : null;
}

async function loadContexts(
  db: D1Database,
  schoolId: number,
  academicYearId: number,
  studentId?: number | null,
  classId?: number | null,
  sectionId?: number | null,
): Promise<StudentAcademicPolicyContext[]> {
  const conditions = [
    'enrollment.school_id=?',
    'enrollment.academic_year_id=?',
    "enrollment.status IN ('active','completed')",
    "student.status='active'",
  ];
  const params: any[] = [schoolId, academicYearId];
  if (studentId != null) { conditions.push('student.id=?'); params.push(studentId); }
  if (classId != null) { conditions.push('enrollment.class_id=?'); params.push(classId); }
  if (sectionId != null) { conditions.push('enrollment.section_id=?'); params.push(sectionId); }
  const rows = await db.prepare(`
    SELECT student.id AS student_id, student.full_name AS student_name,
           student.student_number, student.school_id,
           enrollment.academic_year_id, year.name AS academic_year_name,
           enrollment.class_id, class.name AS class_name,
           enrollment.section_id, section.name AS section_name
    FROM student_enrollments enrollment
    JOIN students student
      ON student.id=enrollment.student_id AND student.school_id=enrollment.school_id
    JOIN academic_years year
      ON year.id=enrollment.academic_year_id AND year.school_id=enrollment.school_id
    JOIN classes class
      ON class.id=enrollment.class_id AND class.school_id=enrollment.school_id
    LEFT JOIN sections section
      ON section.id=enrollment.section_id AND section.school_id=enrollment.school_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY class.order_index, class.id, section.name, student.full_name, student.id
  `).bind(...params).all<StudentAcademicPolicyContext>();
  return rows.results || [];
}

async function loadPolicyGradeRows(
  db: D1Database,
  schoolId: number,
  contexts: StudentAcademicPolicyContext[],
): Promise<PolicyGradeRow[]> {
  if (contexts.length === 0) return [];
  const rows = await db.prepare(`
    SELECT grade.id AS grade_id, assignment.student_id, assignment.class_id,
           subject.id AS subject_id, subject.name AS subject_name,
           subject.order_index, subject.counts_in_average,
           grade.first_term_grade, grade.first_month, grade.second_month,
           grade.second_term_grade, grade.third_month, grade.fourth_month,
           grade.mid_year_exam, grade.final_exam, grade.completion_exam,
           grade.first_term_average, grade.second_term_average,
           grade.annual_effort, grade.final_grade, grade.grade_after_completion,
           grade.effective_grade, grade.result_status, grade.exemption_status
    FROM student_subjects assignment
    JOIN subjects subject
      ON subject.id=assignment.subject_id AND subject.school_id=assignment.school_id
     AND subject.status='active'
    LEFT JOIN grades grade
      ON grade.student_subject_id=assignment.id AND grade.school_id=assignment.school_id
     AND grade.is_active=1
    WHERE assignment.school_id=? AND assignment.is_active=1
    ORDER BY assignment.student_id, subject.order_index, subject.id
  `).bind(schoolId).all<PolicyGradeRow>();
  const classesByStudent = new Map(contexts.map(context => [context.student_id, context.class_id]));
  return (rows.results || []).filter(row => {
    const contextClass = classesByStudent.get(Number(row.student_id));
    return contextClass != null && Number(row.class_id) === contextClass;
  });
}

async function loadCurrentDecisionSets(
  db: D1Database,
  schoolId: number,
  academicYearId: number,
): Promise<Map<string, Record<string, any>>> {
  const rows = await db.prepare(`
    SELECT decision_set.*
    FROM academic_grade_decision_sets decision_set
    JOIN academic_grade_policies policy
      ON policy.id=decision_set.policy_id AND policy.school_id=decision_set.school_id
    WHERE decision_set.school_id=? AND policy.academic_year_id=?
      AND decision_set.is_current=1
  `).bind(schoolId, academicYearId).all<Record<string, any>>();
  return new Map((rows.results || []).map(row => [
    `${Number(row.policy_id)}:${Number(row.student_id)}`,
    { ...row, allocations: JSON.parse(String(row.allocations_json || '{}')) },
  ]));
}

export async function loadAcademicPolicyOutcomes(
  db: D1Database,
  baseSettings: GradeCalculationSettings & Record<string, any>,
  params: {
    schoolId: number;
    academicYearId: number;
    studentId?: number | null;
    classId?: number | null;
    sectionId?: number | null;
    policyOverride?: AcademicGradePolicy | null;
    evaluationOptions?: GradePolicyEvaluationOptions;
  },
): Promise<{
  outcomes: StudentAcademicPolicyResult[];
  missing_policy_class_ids: number[];
}> {
  const contexts = await loadContexts(
    db,
    params.schoolId,
    params.academicYearId,
    params.studentId,
    params.classId,
    params.sectionId,
  );
  const storedPolicies = params.policyOverride
    ? []
    : await loadCurrentAcademicGradePolicies(db, params.schoolId, params.academicYearId);
  const policies = new Map(storedPolicies.map(policy => [Number(policy.class_id), policy]));
  if (params.policyOverride && params.classId != null) policies.set(params.classId, params.policyOverride as any);
  const rows = await loadPolicyGradeRows(db, params.schoolId, contexts);
  const decisionSets = params.policyOverride
    ? new Map<string, Record<string, any>>()
    : await loadCurrentDecisionSets(db, params.schoolId, params.academicYearId);
  const rowsByStudent = new Map<number, PolicyGradeRow[]>();
  for (const row of rows) {
    const studentRows = rowsByStudent.get(Number(row.student_id)) || [];
    studentRows.push(row);
    rowsByStudent.set(Number(row.student_id), studentRows);
  }
  const missingPolicyClassIds = new Set<number>();
  const outcomes: StudentAcademicPolicyResult[] = [];
  for (const context of contexts) {
    const policy = policies.get(context.class_id);
    if (!policy) { missingPolicyClassIds.add(context.class_id); continue; }
    const settings = gradeCalculationSettingsForPolicy(baseSettings, policy);
    const subjectRows = (rowsByStudent.get(context.student_id) || []).map(row => (
      calculatePolicyGradeRow(row, settings)
    ));
    const inputs: AcademicSubjectGradeInput[] = subjectRows.map(row => ({
      subject_id: Number(row.subject_id),
      subject_name: row.subject_name,
      order_index: Number(row.order_index || 0),
      counts_in_average: Number(row.counts_in_average ?? 1),
      annual_effort: row.annual_effort == null ? null : Number(row.annual_effort),
      final_grade: row.final_grade == null ? null : Number(row.final_grade),
      effective_grade: row.effective_grade == null ? null : Number(row.effective_grade),
    }));
    const decisionSet = decisionSets.get(`${Number(policy.id)}:${context.student_id}`) || null;
    const evaluationOptions = params.evaluationOptions || (
      policy.decision_allocation_mode === 'manual' && decisionSet
        ? { manual_allocations: decisionSet.allocations }
        : undefined
    );
    outcomes.push({
      context,
      policy,
      outcome: evaluateStudentAcademicPolicy(policy, inputs, evaluationOptions),
      decision_set: decisionSet,
    });
  }
  return { outcomes, missing_policy_class_ids: [...missingPolicyClassIds].sort((a, b) => a - b) };
}
