import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { calculateGrades } from '../src/lib/gradeCalculations.ts';
import {
  displayGradeStatus,
  displayIndividualExemptionDetail,
} from '../src/lib/gradePresentation.ts';
import { evaluateResultCard } from '../src/lib/resultCards.ts';

const thresholds = { max_grade: 100, passing_grade: 50, exemption_grade: 90 };

test('grade presentation maps only an individual exemption to معفو', () => {
  assert.equal(displayGradeStatus('ناجح', 1), 'معفو');
  assert.equal(displayGradeStatus('ناجح', 0), 'ناجح');
  assert.equal(displayGradeStatus('مكمل', 0), 'مكمل');
  assert.equal(displayGradeStatus('راسب', 0), 'راسب');
  assert.equal(displayGradeStatus(null, 0), null);
});

test('individual exemption detail is فردي and non-exempt detail is an em dash', () => {
  assert.equal(displayGradeStatus('ناجح', 1), 'معفو');
  assert.equal(displayIndividualExemptionDetail(1), 'فردي');
  assert.equal(displayIndividualExemptionDetail(0), '—');
  assert.equal(displayIndividualExemptionDetail(null), '—');
});

test('individual exemption keeps internal passing semantics while presenting معفو', () => {
  const calculated = calculateGrades(
    { first_term_grade: 95, mid_year_exam: 100, second_term_grade: 95, final_exam: null },
    { ...thresholds, first_term_input_mode: 'direct', second_term_input_mode: 'direct' },
  );

  assert.equal(calculated.annual_effort, 97);
  assert.equal(calculated.exemption_status, 1);
  assert.equal(calculated.result_status, 'ناجح');
  assert.equal(displayGradeStatus(calculated.result_status, calculated.exemption_status), 'معفو');
});

test('disabled final exam prevents exemption and continues presenting ناجح', () => {
  const calculated = calculateGrades(
    { first_term_grade: 95, mid_year_exam: 100, second_term_grade: 95, final_exam: null },
    {
      ...thresholds,
      first_term_input_mode: 'direct',
      second_term_input_mode: 'direct',
      final_exam_enabled: 0,
    },
  );

  assert.equal(calculated.exemption_status, 0);
  assert.equal(calculated.result_status, 'ناجح');
  assert.equal(displayGradeStatus(calculated.result_status, calculated.exemption_status), 'ناجح');
});

test('student, section and history grade statuses use the shared presentation helper', async () => {
  const page = await readFile(new URL('../src/modules/grades/GradesPage.tsx', import.meta.url), 'utf8');
  const calls = page.match(/displayGradeStatus\(g\.result_status, g\.exemption_status\)/g) || [];

  assert.equal(calls.length, 3);
  assert.match(page, /statusBadge\(displayGradeStatus\(g\.result_status, g\.exemption_status\)\)/);
  assert.doesNotMatch(page, /\{g\.result_status \|\| '—'\}/);
});

test('result-card subject preview derives status from snapshot result and exemption fields', async () => {
  const page = await readFile(new URL('../src/modules/resultCards/ResultCardsPage.tsx', import.meta.url), 'utf8');
  const subjectTable = page.slice(page.indexOf('{/* Subjects Table */}'), page.indexOf('{/* Summary */}'));
  assert.match(page, /resultStatusBadge\(displayGradeStatus\(s\.result_status, s\.exemption_status\)\)/);
  assert.match(subjectTable, /displayIndividualExemptionDetail\(s\.exemption_status\)/);
  assert.doesNotMatch(subjectTable, /معفى/);
});

test('result-card print derives subject status while public verification exposes no subject rows', async () => {
  const [printPage, verificationPage] = await Promise.all([
    readFile(new URL('../src/modules/print/PrintResultCardPage.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/modules/verification/ResultCardVerificationPage.tsx', import.meta.url), 'utf8'),
  ]);

  assert.match(printPage, /render: \(r\) => displayGradeStatus\(r\.result_status, r\.exemption_status\) \?\? '-'/);
  assert.match(printPage, /render: \(r\) => displayIndividualExemptionDetail\(r\.exemption_status\)/);
  assert.doesNotMatch(verificationPage, /subjects\??:/);
  assert.doesNotMatch(verificationPage, /subject_name/);
});

test('overall result-card status remains academic and is never converted to معفو', async () => {
  const exemptGrade = {
    subject_id: 1,
    subject_name: 'الرياضيات',
    first_month: 95,
    second_month: 95,
    third_month: 95,
    fourth_month: 95,
    mid_year_exam: 100,
    annual_effort: 97,
    final_exam: null,
    final_grade: 97,
    completion_exam: null,
    grade_after_completion: null,
    effective_grade: 97,
    result_status: 'ناجح',
    exemption_status: 1,
  };
  const evaluation = evaluateResultCard(
    [{ id: 1, subject_name: 'الرياضيات' }],
    [exemptGrade],
    {
      passing_grade: 50,
      exemption_grade: 90,
      general_exemption_average_grade: 85,
      general_exemption_min_subject_grade: 75,
    },
    { id: 1, name: '2026-2027' },
  );

  assert.equal(evaluation.ok, true);
  assert.equal(evaluation.ok && evaluation.summary.overall_result_status, 'ناجح');

  const page = await readFile(new URL('../src/modules/resultCards/ResultCardsPage.tsx', import.meta.url), 'utf8');
  assert.match(page, /resultStatusBadge\(card\.overall_result_status\)/);
  assert.doesNotMatch(page, /displayGradeStatus\(card\.overall_result_status/);
});

test('analytics presents exemptions separately without changing pass and exempt counters', async () => {
  const [analyticsPage, worker] = await Promise.all([
    readFile(new URL('../src/modules/analytics/AnalyticsPage.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/worker.ts', import.meta.url), 'utf8'),
  ]);

  assert.match(analyticsPage, /displayGradeStatus\(sub\.result_status, sub\.exemption_status\)/);
  assert.match(worker, /results\.filter\(\(r: any\) => r\.result_status === 'ناجح'\)\.length/);
  assert.match(worker, /results\.filter\(\(r: any\) => r\.exemption_status === 1\)\.length/);
});
