import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateResultCard } from '../src/lib/resultCards.ts';

const settings = {
  passing_grade: 50,
  exemption_grade: 90,
  general_exemption_average_grade: 85,
  general_exemption_min_subject_grade: 75,
};

const academicYear = { id: 1, name: '2025-2026' };

function subject(id, subject_name = `Subject ${id}`) {
  return { id, subject_name };
}

function grade(subject_id, result_status = 'ناجح', overrides = {}) {
  return {
    subject_id,
    subject_name: `Subject ${subject_id}`,
    first_month: 90,
    second_month: 90,
    third_month: 90,
    fourth_month: 90,
    mid_year_exam: 90,
    annual_effort: 90,
    final_exam: 90,
    final_grade: 90,
    completion_exam: null,
    grade_after_completion: null,
    effective_grade: 90,
    result_status,
    exemption_status: 1,
    ...overrides,
  };
}

test('evaluates a complete passing student and general exemption', () => {
  const result = evaluateResultCard(
    [subject(1), subject(2)],
    [grade(1), grade(2)],
    settings,
    academicYear,
  );
  assert.equal(result.ok, true);
  assert.equal(result.summary.overall_result_status, 'ناجح');
  assert.equal(result.summary.general_exemption_eligible, true);
});

test('failure takes priority over an incomplete subject', () => {
  const result = evaluateResultCard(
    [subject(1), subject(2)],
    [grade(1, 'مكمل'), grade(2, 'راسب', { effective_grade: 40, exemption_status: 0 })],
    settings,
    academicYear,
  );
  assert.equal(result.ok, true);
  assert.equal(result.summary.overall_result_status, 'راسب');
});

test('evaluates an incomplete student when no subject failed', () => {
  const result = evaluateResultCard(
    [subject(1), subject(2)],
    [grade(1), grade(2, 'مكمل', { effective_grade: 40, exemption_status: 0 })],
    settings,
    academicYear,
  );
  assert.equal(result.ok, true);
  assert.equal(result.summary.overall_result_status, 'مكمل');
});

test('rejects an active subject without a grade record', () => {
  const result = evaluateResultCard(
    [subject(1), subject(2, 'Missing subject')],
    [grade(1)],
    settings,
    academicYear,
  );
  assert.deepEqual(result, {
    ok: false,
    code: 'missing_grade_records',
    subjects: ['Missing subject'],
  });
});

test('rejects a partially entered grade even if derived status exists', () => {
  const result = evaluateResultCard(
    [subject(1)],
    [grade(1, 'ناجح', { fourth_month: null })],
    settings,
    academicYear,
  );
  assert.deepEqual(result, {
    ok: false,
    code: 'incomplete_grades',
    subjects: ['Subject 1'],
  });
});

test('rejects generation without an active academic year', () => {
  const result = evaluateResultCard([subject(1)], [grade(1)], settings, null);
  assert.deepEqual(result, { ok: false, code: 'no_active_academic_year' });
});
