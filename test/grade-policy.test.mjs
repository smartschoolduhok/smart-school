import assert from 'node:assert/strict';
import test from 'node:test';

import {
  academicStatusLabel,
  evaluateStudentAcademicPolicy,
  ministerialEligibilityLabel,
  validateAcademicGradePolicy,
} from '../src/lib/gradePolicy.ts';

const terminalPolicy = {
  policy_kind: 'terminal',
  pass_mark: 50,
  decision_points: 10,
  decision_allocation_mode: 'optimal',
  decision_points_outcome_only: 1,
  max_completion_subjects: 3,
  exemption_enabled: 0,
  individual_exemption_grade: 90,
  general_exemption_average_grade: 85,
  general_exemption_min_subject_grade: 75,
  ministerial_entry_mode: 'pass_or_completion',
  ministerial_max_failed_subjects: 3,
  minimum_monthly_exams_per_term: 1,
  fraction_rounding_mode: 'ceil',
};

const nonTerminalPolicy = {
  ...terminalPolicy,
  policy_kind: 'non_terminal',
  decision_points: 5,
  exemption_enabled: 1,
  ministerial_entry_mode: 'none',
  ministerial_max_failed_subjects: 0,
};

function subject(subject_id, grade, annual_effort = grade, order_index = subject_id) {
  return {
    subject_id,
    subject_name: `Subject ${subject_id}`,
    annual_effort,
    final_grade: grade,
    effective_grade: grade,
    counts_in_average: 1,
    order_index,
  };
}

test('terminal policy optimally distributes the shared ten-point pool from the agreed example', () => {
  const outcome = evaluateStudentAcademicPolicy(terminalPolicy, [
    subject(1, 44),
    subject(2, 35),
    subject(3, 29),
    subject(4, 46),
  ]);

  assert.equal(outcome.complete, true);
  assert.equal(outcome.raw_failed_subjects, 4);
  assert.equal(outcome.adjusted_failed_subjects, 2);
  assert.equal(outcome.decision_points_used, 10);
  assert.equal(outcome.decision_points_remaining, 0);
  assert.equal(outcome.academic_status, 'completion');
  assert.equal(outcome.ministerial_eligibility, 'eligible');
  assert.deepEqual(outcome.subjects.map(row => [row.subject_id, row.decision_points, row.adjusted_grade]), [
    [1, 6, 50],
    [2, 0, 35],
    [3, 0, 29],
    [4, 4, 50],
  ]);
});

test('optimal distribution maximizes rescued subjects and has stable tie-breaking', () => {
  const outcome = evaluateStudentAcademicPolicy(terminalPolicy, [
    subject(7, 45, 45, 2),
    subject(8, 45, 45, 1),
    subject(9, 49, 49, 3),
  ]);
  assert.deepEqual(outcome.subjects.map(row => [row.subject_id, row.decision_points]), [
    [7, 0],
    [8, 5],
    [9, 1],
  ]);
  assert.equal(outcome.adjusted_failed_subjects, 1);
  assert.equal(outcome.academic_status, 'completion');
  assert.equal(outcome.decision_points_remaining, 4);
});

test('a four-subject terminal failure remains not eligible when the pool cannot rescue a subject', () => {
  const outcome = evaluateStudentAcademicPolicy(terminalPolicy, [
    subject(1, 39), subject(2, 38), subject(3, 37), subject(4, 36),
  ]);
  assert.equal(outcome.decision_points_used, 0);
  assert.equal(outcome.adjusted_failed_subjects, 4);
  assert.equal(outcome.academic_status, 'fail');
  assert.equal(outcome.ministerial_eligibility, 'not_eligible');
});

test('comprehensive entry changes eligibility without rewriting marks or academic status', () => {
  const outcome = evaluateStudentAcademicPolicy({
    ...terminalPolicy,
    decision_points: 0,
    ministerial_entry_mode: 'all_continuing',
  }, [subject(1, 20), subject(2, 25), subject(3, 30), subject(4, 35)]);
  assert.equal(outcome.academic_status, 'fail');
  assert.equal(outcome.ministerial_eligibility, 'comprehensive');
  assert.ok(outcome.subjects.every(row => row.decision_points === 0));
});

test('terminal policies never grant individual or general exemption', () => {
  const outcome = evaluateStudentAcademicPolicy(terminalPolicy, [subject(1, 99), subject(2, 98)]);
  assert.equal(outcome.exemption_status, 'not_applicable');
  assert.equal(outcome.general_exemption_eligible, false);
  assert.deepEqual(outcome.subjects.map(row => row.status), ['pass', 'pass']);
  assert.equal(validateAcademicGradePolicy({ ...terminalPolicy, exemption_enabled: 1 }), 'لا يمكن تفعيل الإعفاء للصفوف المنتهية');
});

test('non-terminal general exemption is applied before requiring final grades', () => {
  const outcome = evaluateStudentAcademicPolicy(nonTerminalPolicy, [
    subject(1, null, 90),
    subject(2, null, 80),
  ]);
  assert.equal(outcome.complete, true);
  assert.equal(outcome.general_exemption_eligible, true);
  assert.equal(outcome.exemption_status, 'general');
  assert.equal(outcome.academic_status, 'pass');
  assert.deepEqual(outcome.subjects.map(row => row.status), ['exempt_general', 'exempt_general']);
});

test('non-terminal individual exemption applies per subject and remaining subjects need finals', () => {
  const outcome = evaluateStudentAcademicPolicy(nonTerminalPolicy, [
    subject(1, null, 95),
    subject(2, 65, 70),
  ]);
  assert.equal(outcome.complete, true);
  assert.equal(outcome.exemption_status, 'individual');
  assert.equal(outcome.academic_status, 'pass');
  assert.deepEqual(outcome.subjects.map(row => row.status), ['exempt_individual', 'pass']);
});

test('non-terminal success requires every subject to pass after the decision pool', () => {
  const completion = evaluateStudentAcademicPolicy(nonTerminalPolicy, [
    subject(1, 48, 70), subject(2, 40, 70), subject(3, 38, 70), subject(4, 80, 80),
  ]);
  assert.equal(completion.adjusted_failed_subjects, 2);
  assert.equal(completion.academic_status, 'completion');
  assert.equal(completion.ministerial_eligibility, 'not_applicable');

  const failed = evaluateStudentAcademicPolicy({ ...nonTerminalPolicy, max_completion_subjects: 1 }, [
    subject(1, 48, 70), subject(2, 40, 70), subject(3, 38, 70), subject(4, 80, 80),
  ]);
  assert.equal(failed.academic_status, 'fail');
});

test('manual outcome-only allocations are audited by strict pool and subject rules', () => {
  const policy = { ...terminalPolicy, decision_allocation_mode: 'manual' };
  const inputs = [subject(1, 44), subject(2, 46)];
  const outcome = evaluateStudentAcademicPolicy(policy, inputs, { manual_allocations: { 1: 6, 2: 4 } });
  assert.equal(outcome.academic_status, 'pass');
  assert.throws(
    () => evaluateStudentAcademicPolicy(policy, inputs, { manual_allocations: { 1: 5 } }),
    /تغير درجات القرار/,
  );
  assert.throws(
    () => evaluateStudentAcademicPolicy(policy, inputs, { manual_allocations: { 1: 6, 2: 5 } }),
    /غير صالح|يتجاوز/,
  );
});

test('incomplete annual effort keeps terminal eligibility pending except comprehensive entry', () => {
  const outcome = evaluateStudentAcademicPolicy(terminalPolicy, [subject(1, null, null)]);
  assert.equal(outcome.complete, false);
  assert.equal(outcome.academic_status, 'incomplete');
  assert.equal(outcome.ministerial_eligibility, 'pending');
});

test('Arabic presentation labels remain separate for academic and ministerial decisions', () => {
  assert.equal(academicStatusLabel('completion'), 'مكمل');
  assert.equal(ministerialEligibilityLabel('eligible'), 'مؤهل للدخول الوزاري');
  assert.equal(ministerialEligibilityLabel('comprehensive'), 'دخول شامل');
});
