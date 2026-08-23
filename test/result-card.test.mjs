import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { displayGradeStatus, displayIndividualExemptionDetail } from '../src/lib/gradePresentation.ts';
import {
  formatExemptionStatus,
  formatUnixSecondsDate,
  shouldRegisterResultCardPrint,
  unixSecondsToDate,
} from '../src/lib/resultCardPrint.ts';
import {
  buildResultCardColumns,
  DEFAULT_RESULT_CARD_DISPLAY_SETTINGS,
  LEGACY_RESULT_CARD_COLUMNS,
  normalizeResultCardDisplaySettings,
  snapshotResultCardColumns,
} from '../src/lib/resultCardPresentation.ts';
import { evaluateResultCard } from '../src/lib/resultCards.ts';

const academicYear = { id: 1, name: '2026-2027' };
const monthlySettings = {
  max_grade: 100,
  passing_grade: 50,
  exemption_grade: 95,
  general_exemption_average_grade: 95,
  general_exemption_min_subject_grade: 90,
  first_term_input_mode: 'monthly',
  second_term_input_mode: 'monthly',
  mid_year_exam_enabled: 1,
  final_exam_enabled: 1,
  completion_exam_enabled: 1,
};
const directSettings = {
  ...monthlySettings,
  first_term_input_mode: 'direct',
  second_term_input_mode: 'direct',
};

function subject(id, subject_name = `Subject ${id}`) {
  return { id, subject_name };
}

function monthlyGrade(subject_id, overrides = {}) {
  return {
    subject_id,
    subject_name: `Subject ${subject_id}`,
    first_term_grade: null,
    first_month: 90,
    second_month: 90,
    mid_year_exam: 90,
    second_term_grade: null,
    third_month: 90,
    fourth_month: 90,
    annual_effort: 90,
    final_exam: 80,
    final_grade: 85,
    completion_exam: null,
    grade_after_completion: null,
    effective_grade: 85,
    result_status: 'ناجح',
    exemption_status: 0,
    ...overrides,
  };
}

function directGrade(subject_id, overrides = {}) {
  return monthlyGrade(subject_id, {
    first_term_grade: 90,
    first_month: null,
    second_month: null,
    second_term_grade: 90,
    third_month: null,
    fourth_month: null,
    ...overrides,
  });
}

test('partial card accepts missing enabled fields without hard failure', () => {
  const result = evaluateResultCard(
    [subject(1)],
    [monthlyGrade(1, { second_month: null, annual_effort: null, final_grade: null, effective_grade: null, result_status: null })],
    monthlySettings,
    academicYear,
  );
  assert.equal(result.ok, true);
  assert.equal(result.card_mode, 'partial');
  assert.equal(result.summary.overall_result_status, 'غير مكتمل');
  assert.ok(result.incomplete_subjects[0].missing_fields.includes('second_month'));
});

test('active subject without a grade record becomes a partial blank row', () => {
  const result = evaluateResultCard([subject(1), subject(2, 'Missing')], [monthlyGrade(1)], monthlySettings, academicYear);
  assert.equal(result.ok, true);
  assert.equal(result.card_mode, 'partial');
  assert.equal(result.grades.length, 2);
  assert.equal(result.grades[1].subject_name, 'Missing');
  assert.ok(result.incomplete_subjects[0].missing_fields.includes('grade_record'));
});

test('monthly scheme can produce a complete card', () => {
  const result = evaluateResultCard([subject(1), subject(2)], [monthlyGrade(1), monthlyGrade(2)], monthlySettings, academicYear);
  assert.equal(result.ok, true);
  assert.equal(result.card_mode, 'complete');
  assert.equal(result.summary.overall_result_status, 'ناجح');
  assert.equal(result.summary.overall_average, 85);
});

test('direct scheme can produce a complete card without monthly values', () => {
  const result = evaluateResultCard([subject(1)], [directGrade(1)], directSettings, academicYear);
  assert.equal(result.ok, true);
  assert.equal(result.card_mode, 'complete');
  assert.deepEqual(result.required_fields, [
    'first_term_grade',
    'mid_year_exam',
    'second_term_grade',
    'final_exam',
  ]);
});

test('disabled fields are neither required nor visible', () => {
  const scheme = {
    ...directSettings,
    second_term_input_mode: 'disabled',
    mid_year_exam_enabled: 0,
    final_exam_enabled: 0,
    completion_exam_enabled: 0,
  };
  const result = evaluateResultCard(
    [subject(1)],
    [directGrade(1, {
      mid_year_exam: null,
      second_term_grade: null,
      final_exam: null,
      annual_effort: 90,
      final_grade: 90,
      effective_grade: 90,
    })],
    scheme,
    academicYear,
  );
  const columns = buildResultCardColumns(scheme, DEFAULT_RESULT_CARD_DISPLAY_SETTINGS).map((column) => column.key);
  assert.equal(result.ok, true);
  assert.equal(result.card_mode, 'complete');
  assert.deepEqual(result.required_fields, ['first_term_grade']);
  assert.ok(!columns.includes('mid_year_exam'));
  assert.ok(!columns.includes('second_term_grade'));
  assert.ok(!columns.includes('final_exam'));
  assert.ok(!columns.includes('completion_exam'));
});

test('missing final exam is partial for a non-exempt student', () => {
  const result = evaluateResultCard(
    [subject(1)],
    [monthlyGrade(1, { final_exam: null, final_grade: null, effective_grade: null, result_status: null })],
    monthlySettings,
    academicYear,
  );
  assert.equal(result.ok, true);
  assert.equal(result.card_mode, 'partial');
  assert.ok(result.incomplete_subjects[0].missing_fields.includes('final_exam'));
});

test('individual exemption completes the subject and presents معفو without changing overall status', () => {
  const result = evaluateResultCard(
    [subject(1)],
    [monthlyGrade(1, {
      annual_effort: 96,
      final_exam: null,
      final_grade: 96,
      effective_grade: 96,
      result_status: 'ناجح',
      exemption_status: 1,
    })],
    monthlySettings,
    academicYear,
  );
  assert.equal(result.ok, true);
  assert.equal(result.card_mode, 'complete');
  assert.equal(displayGradeStatus(result.grades[0].result_status, result.grades[0].exemption_status), 'معفو');
  assert.equal(displayIndividualExemptionDetail(result.grades[0].exemption_status), 'فردي');
  assert.equal(result.summary.overall_result_status, 'ناجح');
});

test('general exemption is evaluated only with sufficient annual data', () => {
  const settings = {
    ...monthlySettings,
    general_exemption_average_grade: 85,
    general_exemption_min_subject_grade: 75,
  };
  const result = evaluateResultCard(
    [subject(1), subject(2)],
    [
      monthlyGrade(1, { annual_effort: 90, final_exam: null, final_grade: null, effective_grade: null, result_status: null }),
      monthlyGrade(2, { annual_effort: 80, final_exam: null, final_grade: null, effective_grade: null, result_status: null }),
    ],
    settings,
    academicYear,
  );
  assert.equal(result.ok, true);
  assert.equal(result.card_mode, 'complete');
  assert.equal(result.summary.general_exemption_eligible, true);
  assert.equal(result.summary.overall_result_status, 'ناجح');
  assert.equal(result.grades[1].exemption_status, 0);
});

test('insufficient annual data does not invent a general exemption', () => {
  const result = evaluateResultCard(
    [subject(1)],
    [monthlyGrade(1, { first_month: null, annual_effort: null, final_grade: null, effective_grade: null, result_status: null })],
    monthlySettings,
    academicYear,
  );
  assert.equal(result.ok, true);
  assert.equal(result.summary.general_exemption_eligible, null);
  assert.equal(result.summary.overall_result_status, 'غير مكتمل');
});

test('supplementary exam remains optional until entered and preserves مكمل', () => {
  const result = evaluateResultCard(
    [subject(1)],
    [monthlyGrade(1, { final_grade: 40, effective_grade: 40, result_status: 'مكمل', completion_exam: null })],
    monthlySettings,
    academicYear,
  );
  assert.equal(result.ok, true);
  assert.equal(result.card_mode, 'complete');
  assert.equal(result.summary.overall_result_status, 'مكمل');
});

test('failure takes priority over supplementary status on a complete card', () => {
  const result = evaluateResultCard(
    [subject(1), subject(2)],
    [
      monthlyGrade(1, { final_grade: 40, effective_grade: 40, result_status: 'مكمل' }),
      monthlyGrade(2, { final_grade: 30, completion_exam: 35, grade_after_completion: 35, effective_grade: 35, result_status: 'راسب' }),
    ],
    monthlySettings,
    academicYear,
  );
  assert.equal(result.ok, true);
  assert.equal(result.summary.overall_result_status, 'راسب');
});

test('evaluation preserves the supplied canonical subject order', () => {
  const result = evaluateResultCard(
    [subject(2, 'Second'), subject(1, 'First')],
    [monthlyGrade(1), monthlyGrade(2)],
    monthlySettings,
    academicYear,
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.grades.map((grade) => grade.subject_id), [2, 1]);
});

test('generation still requires an active academic year and at least one visible subject', () => {
  assert.deepEqual(evaluateResultCard([subject(1)], [monthlyGrade(1)], monthlySettings, null), {
    ok: false,
    code: 'no_active_academic_year',
  });
  assert.deepEqual(evaluateResultCard([], [], monthlySettings, academicYear), {
    ok: false,
    code: 'no_active_subjects',
  });
});

test('display options deterministically hide and show card columns', () => {
  const hidden = buildResultCardColumns(directSettings, {
    show_annual_effort: false,
    show_final_grade: false,
    show_effective_grade: false,
    show_subject_status: false,
    show_exemption_detail: false,
    show_completion_exam: false,
  }).map((column) => column.key);
  assert.deepEqual(hidden, ['subject_name', 'first_term_grade', 'mid_year_exam', 'second_term_grade', 'final_exam']);
  const normalized = normalizeResultCardDisplaySettings({ show_qr_code: 0, show_phone: 1 });
  assert.equal(normalized.show_qr_code, false);
  assert.equal(normalized.show_phone, true);
});

test('old snapshots keep the legacy safe column shape', () => {
  assert.deepEqual(snapshotResultCardColumns(undefined), [...LEGACY_RESULT_CARD_COLUMNS]);
  assert.deepEqual(snapshotResultCardColumns([{ key: 'unknown' }]), [...LEGACY_RESULT_CARD_COLUMNS]);
});

test('snapshot builder freezes order, branding, note, display settings and verification identity', async () => {
  const worker = await readFile(new URL('../src/worker.ts', import.meta.url), 'utf8');
  const start = worker.indexOf('async function buildResultCardSnapshot');
  const end = worker.indexOf('async function createResultCardForStudent', start);
  const builder = worker.slice(start, end);
  assert.match(builder, /schema_version: 2/);
  assert.match(builder, /visible_columns: buildResultCardColumns\(settings, displaySettings\)/);
  assert.match(builder, /subjects: evaluation\.grades/);
  assert.match(builder, /decision_note: options\.decisionNote/);
  assert.match(builder, /phone: student\.school_phone/);
  assert.match(builder, /result_card_display_settings: displaySettings/);
  assert.match(builder, /verification: identity\.token/);
  assert.match(builder, /card_number: identity\.cardNumber/);
});

test('issued snapshots are immutable and saved with partial or complete metadata', async () => {
  const worker = await readFile(new URL('../src/worker.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(worker, /UPDATE result_cards SET card_data_json/);
  assert.match(worker, /overall_result_status, card_data_json[\s\S]*?JSON\.stringify\(cardData\)/);
  assert.match(worker, /card_mode: evaluation\.card_mode/);
  assert.match(worker, /overall_result_status: snapshot\.evaluation\.summary\.overall_result_status/);
});

test('live preview is read-only while issue stores the frozen snapshot', async () => {
  const worker = await readFile(new URL('../src/worker.ts', import.meta.url), 'utf8');
  const previewStart = worker.indexOf("'/api/result-cards/preview-student/:student_id'");
  const previewEnd = worker.indexOf("'/api/result-cards/generate-student/:student_id'", previewStart);
  const previewRoute = worker.slice(previewStart, previewEnd);
  assert.match(previewRoute, /buildResultCardSnapshot/);
  assert.doesNotMatch(previewRoute, /INSERT INTO result_cards/);
  assert.doesNotMatch(previewRoute, /\.run\(\)/);
  assert.match(worker, /INSERT INTO result_cards[\s\S]*?JSON\.stringify\(cardData\)/);
});

test('system admin targeting and cross-school checks cover preview, issue, list and view', async () => {
  const worker = await readFile(new URL('../src/worker.ts', import.meta.url), 'utf8');
  const resultCardsStart = worker.indexOf('// GET /api/result-cards');
  const resultCardsEnd = worker.indexOf('// Phase 7:', resultCardsStart);
  const routes = worker.slice(resultCardsStart, resultCardsEnd);
  assert.match(routes, /يجب تحديد المدرسة المستهدفة لعرض كارتات النتائج/);
  assert.match(routes, /يجب تحديد المدرسة المستهدفة لعرض كارت النتيجة/);
  assert.match(routes, /WHERE rc\.school_id = \?/);
  assert.match(routes, /row\.school_id !== resolvedSchoolId/);
  assert.match(routes, /لا يمكنك معاينة طالب من مدرسة أخرى/);
  assert.match(routes, /لا يمكنك إنشاء كارت لطالب من مدرسة أخرى/);
});

test('preview, saved view and print share the same snapshot-driven document', async () => {
  const [page, printPage, component] = await Promise.all([
    readFile(new URL('../src/modules/resultCards/ResultCardsPage.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/modules/print/PrintResultCardPage.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/resultCards/ResultCardDocument.tsx', import.meta.url), 'utf8'),
  ]);
  assert.match(page, /<ResultCardDocument/);
  assert.match(page, /previewStudentResultCard/);
  assert.match(page, /decision_note: decisionNote/);
  assert.match(printPage, /<ResultCardDocument/);
  assert.match(printPage, /data=\{card\.card_data_parsed\}/);
  assert.match(component, /displayGradeStatus\(row\.result_status, row\.exemption_status\)/);
  assert.match(component, /displayIndividualExemptionDetail\(row\.exemption_status\)/);
  assert.doesNotMatch(component, /QR مخفي/);
  assert.match(component, /QRCodeSVG/);
  assert.match(component, /data\?\.decision_note/);
});

test('public verification remains summary-only and uses safe snapshot metadata', async () => {
  const [worker, verificationPage] = await Promise.all([
    readFile(new URL('../src/worker.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/modules/verification/ResultCardVerificationPage.tsx', import.meta.url), 'utf8'),
  ]);
  const routeStart = worker.indexOf("app.get('/api/verify/result-card/:token'");
  const routeEnd = worker.indexOf('// Phase 7:', routeStart);
  const route = worker.slice(routeStart, routeEnd);
  assert.match(route, /card_mode: cardData\?\.card_mode/);
  assert.match(route, /decision_note: displaySettings\.show_notes_decisions/);
  assert.doesNotMatch(route, /subjects:/);
  assert.doesNotMatch(verificationPage, /subject_name/);
});

test('display settings migration is scoped to one snapshot-preference column', async () => {
  const migration = await readFile(new URL('../migrations/0019_result_card_display_settings.sql', import.meta.url), 'utf8');
  assert.match(migration, /ALTER TABLE school_settings ADD COLUMN result_card_display_settings_json TEXT/);
  assert.equal((migration.match(/ALTER TABLE/g) || []).length, 1);
  assert.doesNotMatch(migration, /UPDATE|DELETE|INSERT/i);
});

test('formats exemptions, Unix seconds, and print eligibility safely', () => {
  assert.equal(formatExemptionStatus(1, 'individual'), 'فردي');
  assert.equal(formatExemptionStatus(1, 'general'), 'معفى عام');
  assert.equal(formatExemptionStatus(0, 'individual'), '—');
  assert.equal(unixSecondsToDate(1)?.getTime(), 1000);
  assert.equal(formatUnixSecondsDate('invalid'), '-');
  assert.equal(shouldRegisterResultCardPrint('cancelled', true), false);
  assert.equal(shouldRegisterResultCardPrint('active', true), true);
});
