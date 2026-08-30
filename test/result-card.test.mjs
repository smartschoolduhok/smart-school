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
  normalizeResultCardGender,
  normalizeResultCardDisplaySettings,
  parseResultCardDisplaySettings,
  RESULT_CARD_DISPLAY_SETTING_KEYS,
  snapshotResultCardColumnAverages,
  snapshotResultCardColumns,
} from '../src/lib/resultCardPresentation.ts';
import {
  calculateResultCardColumnAverages,
  evaluateResultCard,
} from '../src/lib/resultCards.ts';
import {
  calculateSinglePagePrintScale,
  PRINT_FIT_SAFETY_FACTOR,
} from '../src/lib/printFit.ts';

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
const fullDisplaySettings = {
  ...DEFAULT_RESULT_CARD_DISPLAY_SETTINGS,
  show_completion_exam: true,
  show_final_grade: true,
  show_effective_grade: true,
  show_exemption_detail: true,
};

test('Result Card gender presentation normalizes known values and hides unsafe values', async () => {
  for (const value of ['ذكر', 'male', 'MALE', 'M', ' m ']) {
    assert.equal(normalizeResultCardGender(value), 'ذكر');
  }
  for (const value of ['أنثى', 'female', 'FEMALE', 'F', ' f ']) {
    assert.equal(normalizeResultCardGender(value), 'أنثى');
  }
  for (const value of [null, undefined, '', '  ', 'unknown', 'غير معروف', 'other', 1]) {
    assert.equal(normalizeResultCardGender(value), null);
  }

  const component = await readFile(
    new URL('../src/components/resultCards/ResultCardDocument.tsx', import.meta.url),
    'utf8',
  );
  assert.match(component, /const studentGender = normalizeResultCardGender\(student\.gender\)/);
  assert.match(component, /displaySettings\.show_gender && studentGender/);
  assert.match(component, /optionalStudentInfoItems\.push\(\{ label: 'الجنس', value: studentGender \}\)/);
  assert.doesNotMatch(component, /label: 'الجنس', value: student\.gender/);
});

function subject(id, subject_name = `Subject ${id}`, counts_in_average = 1, appears_in_report_card = 1) {
  return { id, subject_name, counts_in_average, appears_in_report_card };
}

function monthlyGrade(subject_id, overrides = {}) {
  return {
    subject_id,
    subject_name: `Subject ${subject_id}`,
    first_term_grade: null,
    first_month: 90,
    second_month: 90,
    first_term_average: 90,
    mid_year_exam: 90,
    second_term_grade: null,
    third_month: 90,
    fourth_month: 90,
    second_term_average: 90,
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

function columnAveragesFor({
  subjects,
  grades,
  settings = monthlySettings,
  display = DEFAULT_RESULT_CARD_DISPLAY_SETTINGS,
}) {
  const evaluation = evaluateResultCard(subjects, grades, settings, academicYear);
  assert.equal(evaluation.ok, true);
  const columns = buildResultCardColumns(settings, display);
  return {
    evaluation,
    columns,
    averages: calculateResultCardColumnAverages(
      subjects,
      evaluation.counted_grades,
      settings,
      columns,
      evaluation.summary.general_exemption_eligible,
    ),
  };
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

test('visible non-average subject remains on the card and in display counts', () => {
  const result = evaluateResultCard(
    [subject(1), subject(2, 'Activity', 0)],
    [monthlyGrade(1), monthlyGrade(2, { result_status: 'مكمل' })],
    monthlySettings,
    academicYear,
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.grades.map((grade) => grade.subject_id), [1, 2]);
  assert.equal(result.summary.total_subjects, 2);
  assert.equal(result.summary.completion_count, 1);
});

test('visible non-average subject does not alter annual-effort aggregates', () => {
  const result = evaluateResultCard(
    [subject(1), subject(2, 'Activity', 0)],
    [monthlyGrade(1, { annual_effort: 90 }), monthlyGrade(2, { annual_effort: 10 })],
    monthlySettings,
    academicYear,
  );
  assert.equal(result.ok, true);
  assert.equal(result.summary.annual_effort_average, 90);
  assert.equal(result.summary.min_annual_effort, 90);
});

test('visible non-average subject does not alter overall average', () => {
  const result = evaluateResultCard(
    [subject(1), subject(2, 'Activity', 0)],
    [
      monthlyGrade(1, { effective_grade: 85 }),
      monthlyGrade(2, {
        first_month: null,
        annual_effort: null,
        final_grade: null,
        effective_grade: null,
        result_status: null,
      }),
    ],
    monthlySettings,
    academicYear,
  );
  assert.equal(result.ok, true);
  assert.equal(result.card_mode, 'partial');
  assert.equal(result.summary.overall_average, 85);
});

test('visible non-average subject does not block general exemption minimum', () => {
  const settings = {
    ...monthlySettings,
    general_exemption_average_grade: 85,
    general_exemption_min_subject_grade: 80,
  };
  const result = evaluateResultCard(
    [subject(1), subject(2, 'Activity', 0)],
    [
      monthlyGrade(1, { annual_effort: 90 }),
      monthlyGrade(2, { annual_effort: 10 }),
    ],
    settings,
    academicYear,
  );
  assert.equal(result.ok, true);
  assert.equal(result.summary.general_exemption_eligible, true);
  assert.equal(result.summary.min_annual_effort, 90);
});

test('counted subject changes every academic aggregate', () => {
  const settings = {
    ...monthlySettings,
    general_exemption_average_grade: 80,
    general_exemption_min_subject_grade: 75,
  };
  const result = evaluateResultCard(
    [subject(1), subject(2)],
    [
      monthlyGrade(1, { annual_effort: 90, effective_grade: 85 }),
      monthlyGrade(2, { annual_effort: 70, effective_grade: 65 }),
    ],
    settings,
    academicYear,
  );
  assert.equal(result.ok, true);
  assert.equal(result.summary.annual_effort_average, 80);
  assert.equal(result.summary.min_annual_effort, 70);
  assert.equal(result.summary.overall_average, 75);
  assert.equal(result.summary.general_exemption_eligible, false);
});

test('zero counted subjects produce no academic aggregate or exemption result', () => {
  const result = evaluateResultCard(
    [subject(1, 'Activity', 0), subject(2, 'Conduct', 0)],
    [monthlyGrade(1), monthlyGrade(2)],
    monthlySettings,
    academicYear,
  );
  assert.equal(result.ok, true);
  assert.equal(result.card_mode, 'complete');
  assert.equal(result.summary.annual_effort_average, null);
  assert.equal(result.summary.min_annual_effort, null);
  assert.equal(result.summary.overall_average, null);
  assert.equal(result.summary.general_exemption_eligible, null);
});

test('average participation does not change canonical subject ordering', () => {
  const result = evaluateResultCard(
    [subject(2, 'Visible first', 0), subject(1, 'Counted second', 1)],
    [monthlyGrade(1), monthlyGrade(2)],
    monthlySettings,
    academicYear,
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.grades.map((grade) => grade.subject_id), [2, 1]);
});

test('explicit assignments alone determine religious Result Card applicability', () => {
  const islamic = subject(10, 'التربية الإسلامية');
  const christian = subject(11, 'التربية المسيحية');
  const ordinary = subject(12, 'الرياضيات');
  const cases = [
    { religion: 'muslim', applicable: [ordinary, islamic], expected: [12, 10] },
    { religion: 'christian', applicable: [ordinary, christian], expected: [12, 11] },
    { religion: 'muslim', applicable: [ordinary], expected: [12] },
    { religion: null, applicable: [ordinary, islamic], expected: [12, 10] },
    { religion: 'muslim', applicable: [ordinary, christian], expected: [12, 11] },
  ];

  for (const scenario of cases) {
    const result = evaluateResultCard(
      scenario.applicable,
      scenario.applicable.map((item) => monthlyGrade(item.id)),
      monthlySettings,
      academicYear,
    );
    assert.equal(result.ok, true, String(scenario.religion));
    assert.deepEqual(result.grades.map((grade) => grade.subject_id), scenario.expected);
    assert.equal(result.card_mode, 'complete');
    assert.equal(result.incomplete_subjects.length, 0);
  }
});

test('two class religious subjects do not make the unassigned track applicable or incomplete', () => {
  const assignedIslamic = subject(20, 'الإسلامية');
  const result = evaluateResultCard(
    [subject(22, 'الرياضيات'), assignedIslamic],
    [monthlyGrade(22), monthlyGrade(20)],
    monthlySettings,
    academicYear,
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.grades.map((grade) => grade.subject_id), [22, 20]);
  assert.ok(!result.grades.some((grade) => grade.subject_name === 'المسيحية'));
  assert.equal(result.card_mode, 'complete');
});

test('display and counted flags are independent for rows, status and aggregates', () => {
  const result = evaluateResultCard(
    [
      subject(1, 'Visible counted', 1, 1),
      subject(2, 'Visible not counted', 0, 1),
      subject(3, 'Hidden counted', 1, 0),
      subject(4, 'Hidden not counted', 0, 0),
    ],
    [
      monthlyGrade(1, { annual_effort: 90, effective_grade: 90 }),
      monthlyGrade(2, { annual_effort: 10, effective_grade: 10, result_status: 'مكمل' }),
      monthlyGrade(3, { annual_effort: 70, effective_grade: 70, result_status: 'راسب' }),
      monthlyGrade(4, { annual_effort: 1, effective_grade: 1, result_status: 'راسب' }),
    ],
    monthlySettings,
    academicYear,
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.grades.map((grade) => grade.subject_id), [1, 2]);
  assert.deepEqual(result.counted_grades.map((grade) => grade.subject_id), [1, 3]);
  assert.equal(result.summary.total_subjects, 2);
  assert.equal(result.summary.completion_count, 1);
  assert.equal(result.summary.fail_count, 0);
  assert.equal(result.summary.overall_result_status, 'مكمل');
  assert.equal(result.summary.annual_effort_average, 80);
  assert.equal(result.summary.min_annual_effort, 70);
  assert.equal(result.summary.overall_average, 80);
});

test('missing hidden counted subject nulls aggregates without making the card partial', () => {
  const result = evaluateResultCard(
    [subject(1), subject(2, 'Hidden counted', 1, 0)],
    [monthlyGrade(1)],
    monthlySettings,
    academicYear,
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.grades.map((grade) => grade.subject_id), [1]);
  assert.equal(result.card_mode, 'complete');
  assert.equal(result.incomplete_subjects.length, 0);
  assert.equal(result.summary.annual_effort_average, null);
  assert.equal(result.summary.overall_average, null);
  assert.equal(result.summary.general_exemption_eligible, null);
});

test('missing visible subject still makes the card partial even when it is non-counted', () => {
  const result = evaluateResultCard(
    [subject(1), subject(2, 'Visible missing activity', 0, 1)],
    [monthlyGrade(1)],
    monthlySettings,
    academicYear,
  );
  assert.equal(result.ok, true);
  assert.equal(result.card_mode, 'partial');
  assert.equal(result.incomplete_subjects[0].subject_id, 2);
  assert.equal(result.summary.overall_average, 85);
});

test('hidden counted subject participates in general exemption while hidden non-counted does not', () => {
  const settings = {
    ...monthlySettings,
    general_exemption_average_grade: 85,
    general_exemption_min_subject_grade: 75,
  };
  const blocked = evaluateResultCard(
    [subject(1), subject(2, 'Hidden counted', 1, 0), subject(3, 'Hidden ignored', 0, 0)],
    [
      monthlyGrade(1, { annual_effort: 95 }),
      monthlyGrade(2, { annual_effort: 70 }),
      monthlyGrade(3, { annual_effort: 1 }),
    ],
    settings,
    academicYear,
  );
  assert.equal(blocked.ok, true);
  assert.equal(blocked.summary.annual_effort_average, 83);
  assert.equal(blocked.summary.min_annual_effort, 70);
  assert.equal(blocked.summary.general_exemption_eligible, false);
});

test('column averages include hidden counted values, reject missing counted values and exclude visible non-counted', () => {
  const subjects = [
    subject(1, 'Visible counted', 1, 1),
    subject(2, 'Hidden counted', 1, 0),
    subject(3, 'Visible ignored', 0, 1),
  ];
  const grades = [
    directGrade(1, { first_term_grade: 80 }),
    directGrade(2, { first_term_grade: 100 }),
    directGrade(3, { first_term_grade: 10 }),
  ];
  const complete = columnAveragesFor({ subjects, grades, settings: directSettings });
  assert.equal(complete.averages.first_term_grade, 90);
  assert.deepEqual(complete.evaluation.grades.map((grade) => grade.subject_id), [1, 3]);

  const missing = columnAveragesFor({
    subjects,
    grades: grades.map((grade) => grade.subject_id === 2
      ? { ...grade, first_term_grade: null }
      : grade),
    settings: directSettings,
  });
  assert.equal(missing.averages.first_term_grade, null);
});

test('non-average subjects are excluded from every direct-term card column average', () => {
  const counted = directGrade(1, {
    first_term_grade: 80,
    mid_year_exam: 82,
    second_term_grade: 84,
    annual_effort: 82,
    final_exam: 86,
    final_grade: 84,
    effective_grade: 84,
  });
  const excluded = directGrade(2, {
    first_term_grade: 10,
    mid_year_exam: 10,
    second_term_grade: 10,
    annual_effort: 10,
    final_exam: 10,
    final_grade: 10,
    effective_grade: 10,
    result_status: 'راسب',
  });
  const { evaluation, averages } = columnAveragesFor({
    subjects: [subject(1), subject(2, 'رياضة', 0)],
    grades: [counted, excluded],
    settings: directSettings,
    display: fullDisplaySettings,
  });

  assert.deepEqual(evaluation.grades.map((grade) => grade.subject_id), [1, 2]);
  assert.equal(averages.first_term_grade, 80);
  assert.equal(averages.mid_year_exam, 82);
  assert.equal(averages.second_term_grade, 84);
  assert.equal(averages.annual_effort, 82);
  assert.equal(averages.final_exam, 86);
  assert.equal(averages.final_grade, 84);
  assert.equal(averages.effective_grade, 84);
});

test('missing counted value nulls only its specific visible column average', () => {
  const { averages } = columnAveragesFor({
    subjects: [subject(1), subject(2)],
    grades: [
      directGrade(1, { first_term_grade: 80, mid_year_exam: 70 }),
      directGrade(2, { first_term_grade: 90, mid_year_exam: null }),
    ],
    settings: directSettings,
  });

  assert.equal(averages.first_term_grade, 85);
  assert.equal(averages.mid_year_exam, null);
  assert.equal(averages.second_term_grade, 90);
  assert.equal(averages.annual_effort, 90);
});

test('complete counted monthly values produce rounded per-column averages', () => {
  const { averages } = columnAveragesFor({
    subjects: [subject(1), subject(2)],
    grades: [
      monthlyGrade(1, {
        first_month: 80,
        second_month: 82,
        mid_year_exam: 84,
        third_month: 86,
        fourth_month: 88,
        annual_effort: 84,
        final_exam: 90,
        final_grade: 87,
        effective_grade: 87,
      }),
      monthlyGrade(2, {
        first_month: 90,
        second_month: 92,
        mid_year_exam: 94,
        third_month: 96,
        fourth_month: 98,
        annual_effort: 94,
        final_exam: 100,
        final_grade: 97,
        effective_grade: 97,
      }),
    ],
    display: fullDisplaySettings,
  });

  assert.deepEqual(averages, {
    first_month: 85,
    second_month: 87,
    mid_year_exam: 89,
    third_month: 91,
    fourth_month: 93,
    annual_effort: 89,
    final_exam: 95,
    completion_exam: null,
    final_grade: 92,
    effective_grade: 92,
  });
});

test('direct-term card averages use direct fields instead of hidden monthly fields', () => {
  const { columns, averages } = columnAveragesFor({
    subjects: [subject(1), subject(2)],
    grades: [
      directGrade(1, { first_term_grade: 80, mid_year_exam: 70, second_term_grade: 90 }),
      directGrade(2, { first_term_grade: 85, mid_year_exam: 80, second_term_grade: 95 }),
    ],
    settings: directSettings,
  });

  assert.deepEqual(columns.map((column) => column.key), [
    'subject_name',
    'first_term_grade',
    'mid_year_exam',
    'second_term_grade',
    'annual_effort',
    'final_exam',
    'result_status',
  ]);
  assert.equal(averages.first_term_grade, 83);
  assert.equal(averages.mid_year_exam, 75);
  assert.equal(averages.second_term_grade, 93);
  assert.ok(!Object.hasOwn(averages, 'first_month'));
  assert.ok(!Object.hasOwn(averages, 'third_month'));
});

test('zero counted subjects produce nulls for all visible numeric column averages', () => {
  const { averages } = columnAveragesFor({
    subjects: [subject(1, 'رياضة', 0), subject(2, 'نشاط', 0)],
    grades: [monthlyGrade(1), monthlyGrade(2)],
  });

  assert.ok(Object.keys(averages).length > 0);
  assert.ok(Object.values(averages).every((value) => value === null));
});

test('column averages contain visible numeric columns only', () => {
  const { columns, averages } = columnAveragesFor({
    subjects: [subject(1)],
    grades: [monthlyGrade(1, { annual_effort: 88 })],
    display: {
      ...DEFAULT_RESULT_CARD_DISPLAY_SETTINGS,
      show_first_term_inputs: false,
      show_mid_year_exam: false,
      show_second_term_inputs: false,
      show_final_exam: false,
      show_annual_effort: true,
      show_subject_status: true,
      show_exemption_detail: true,
    },
  });

  assert.deepEqual(columns.map((column) => column.key), [
    'subject_name',
    'annual_effort',
    'result_status',
    'exemption_detail',
  ]);
  assert.deepEqual(averages, { annual_effort: 88 });
  assert.ok(!Object.hasOwn(averages, 'final_exam'));
  assert.ok(!Object.hasOwn(averages, 'result_status'));
  assert.ok(!Object.hasOwn(averages, 'exemption_detail'));
});

test('completion-exam display and average are controlled independently', () => {
  const subjects = [subject(1), subject(2)];
  const grades = [
    directGrade(1, { final_grade: 40, completion_exam: 60, effective_grade: 60 }),
    directGrade(2, { final_grade: 30, completion_exam: 70, effective_grade: 70 }),
  ];
  const hidden = columnAveragesFor({ subjects, grades, settings: directSettings });
  const shown = columnAveragesFor({
    subjects,
    grades,
    settings: directSettings,
    display: { ...DEFAULT_RESULT_CARD_DISPLAY_SETTINGS, show_completion_exam: true },
  });

  assert.ok(!hidden.columns.some((column) => column.key === 'completion_exam'));
  assert.ok(!Object.hasOwn(hidden.averages, 'completion_exam'));
  assert.ok(shown.columns.some((column) => column.key === 'completion_exam'));
  assert.equal(shown.averages.completion_exam, 65);
});

test('calculating column averages does not mutate Result Card evaluation or calculations', () => {
  const subjects = [subject(1), subject(2, 'رياضة', 0)];
  const grades = [monthlyGrade(1), monthlyGrade(2)];
  const evaluation = evaluateResultCard(subjects, grades, monthlySettings, academicYear);
  assert.equal(evaluation.ok, true);
  const before = structuredClone(evaluation);
  calculateResultCardColumnAverages(
    subjects,
    evaluation.counted_grades,
    monthlySettings,
    buildResultCardColumns(monthlySettings, DEFAULT_RESULT_CARD_DISPLAY_SETTINGS),
    evaluation.summary.general_exemption_eligible,
  );
  assert.deepEqual(evaluation, before);
});

test('generation still requires an active academic year and at least one applicable subject', () => {
  assert.deepEqual(evaluateResultCard([subject(1)], [monthlyGrade(1)], monthlySettings, null), {
    ok: false,
    code: 'no_active_academic_year',
  });
  assert.deepEqual(evaluateResultCard([], [], monthlySettings, academicYear), {
    ok: false,
    code: 'no_active_subjects',
  });
  assert.deepEqual(evaluateResultCard([
    subject(1, 'Hidden counted', 1, 0),
  ], [monthlyGrade(1)], monthlySettings, academicYear), {
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

test('clean Result Card defaults show academic inputs and hide optional technical details', () => {
  assert.equal(DEFAULT_RESULT_CARD_DISPLAY_SETTINGS.show_first_term_inputs, true);
  assert.equal(DEFAULT_RESULT_CARD_DISPLAY_SETTINGS.show_first_term_average, false);
  assert.equal(DEFAULT_RESULT_CARD_DISPLAY_SETTINGS.show_mid_year_exam, true);
  assert.equal(DEFAULT_RESULT_CARD_DISPLAY_SETTINGS.show_second_term_inputs, true);
  assert.equal(DEFAULT_RESULT_CARD_DISPLAY_SETTINGS.show_second_term_average, false);
  assert.equal(DEFAULT_RESULT_CARD_DISPLAY_SETTINGS.show_annual_effort, true);
  assert.equal(DEFAULT_RESULT_CARD_DISPLAY_SETTINGS.show_final_exam, true);
  assert.equal(DEFAULT_RESULT_CARD_DISPLAY_SETTINGS.show_subject_status, true);
  assert.equal(DEFAULT_RESULT_CARD_DISPLAY_SETTINGS.show_completion_exam, false);
  assert.equal(DEFAULT_RESULT_CARD_DISPLAY_SETTINGS.show_final_grade, false);
  assert.equal(DEFAULT_RESULT_CARD_DISPLAY_SETTINGS.show_effective_grade, false);
  assert.equal(DEFAULT_RESULT_CARD_DISPLAY_SETTINGS.show_exemption_detail, false);
  assert.deepEqual(
    buildResultCardColumns(directSettings, null).map((column) => column.key),
    [
      'subject_name',
      'first_term_grade',
      'mid_year_exam',
      'second_term_grade',
      'annual_effort',
      'final_exam',
      'result_status',
    ],
  );
});

test('saved custom display settings override the new defaults without being rewritten', () => {
  const stored = JSON.stringify({
    ...DEFAULT_RESULT_CARD_DISPLAY_SETTINGS,
    show_completion_exam: true,
    show_final_grade: true,
    show_effective_grade: true,
    show_exemption_detail: true,
    show_first_term_inputs: false,
  });
  const parsed = parseResultCardDisplaySettings(stored);
  assert.equal(parsed.show_completion_exam, true);
  assert.equal(parsed.show_final_grade, true);
  assert.equal(parsed.show_effective_grade, true);
  assert.equal(parsed.show_exemption_detail, true);
  assert.equal(parsed.show_first_term_inputs, false);
});

test('raw academic columns are independently optional presentation settings', () => {
  const columns = buildResultCardColumns(monthlySettings, {
    show_first_term_inputs: false,
    show_mid_year_exam: false,
    show_second_term_inputs: false,
    show_final_exam: true,
    show_completion_exam: false,
    show_annual_effort: true,
    show_final_grade: false,
    show_effective_grade: false,
    show_subject_status: true,
    show_exemption_detail: false,
  }).map((column) => column.key);
  assert.deepEqual(columns, [
    'subject_name',
    'annual_effort',
    'final_exam',
    'result_status',
  ]);
  assert.deepEqual(
    evaluateResultCard([subject(1)], [monthlyGrade(1)], monthlySettings, academicYear).required_fields,
    ['first_month', 'second_month', 'mid_year_exam', 'third_month', 'fourth_month', 'final_exam'],
  );
});

test('term input presentation follows monthly, direct and disabled scheme modes', () => {
  const shownDirect = buildResultCardColumns(directSettings, {
    show_first_term_inputs: true,
    show_mid_year_exam: false,
    show_second_term_inputs: true,
    show_final_exam: false,
    show_completion_exam: false,
    show_annual_effort: false,
    show_final_grade: false,
    show_effective_grade: false,
    show_subject_status: false,
    show_exemption_detail: false,
  }).map((column) => column.key);
  assert.deepEqual(shownDirect, ['subject_name', 'first_term_grade', 'second_term_grade']);

  const hiddenDisabled = buildResultCardColumns({
    ...directSettings,
    first_term_input_mode: 'disabled',
    second_term_input_mode: 'disabled',
  }, {
    show_first_term_inputs: true,
    show_mid_year_exam: false,
    show_second_term_inputs: true,
    show_final_exam: false,
    show_completion_exam: false,
    show_annual_effort: false,
    show_final_grade: false,
    show_effective_grade: false,
    show_subject_status: false,
    show_exemption_detail: false,
  }).map((column) => column.key);
  assert.deepEqual(hiddenDisabled, ['subject_name']);
});

test('term effort columns are independently optional and follow the academic column order', () => {
  const averagesOnly = buildResultCardColumns(monthlySettings, {
    ...DEFAULT_RESULT_CARD_DISPLAY_SETTINGS,
    show_first_term_inputs: false,
    show_first_term_average: true,
    show_second_term_inputs: false,
    show_second_term_average: true,
  });
  assert.deepEqual(
    averagesOnly.map((column) => [column.key, column.label]),
    [
      ['subject_name', 'المادة'],
      ['first_term_average', 'سعي الفصل الأول'],
      ['mid_year_exam', 'امتحان نصف السنة'],
      ['second_term_average', 'سعي الفصل الثاني'],
      ['annual_effort', 'السعي السنوي'],
      ['final_exam', 'امتحان نهاية السنة'],
      ['result_status', 'الحالة'],
    ],
  );

  assert.deepEqual(
    buildResultCardColumns(monthlySettings, {
      ...DEFAULT_RESULT_CARD_DISPLAY_SETTINGS,
      show_first_term_average: true,
      show_second_term_average: true,
    }).map((column) => column.key),
    [
      'subject_name',
      'first_month',
      'second_month',
      'first_term_average',
      'mid_year_exam',
      'third_month',
      'fourth_month',
      'second_term_average',
      'annual_effort',
      'final_exam',
      'result_status',
    ],
  );
});

test('direct term effort columns reuse stored calculated fields without exposing monthly inputs', () => {
  assert.deepEqual(
    buildResultCardColumns(directSettings, {
      ...DEFAULT_RESULT_CARD_DISPLAY_SETTINGS,
      show_first_term_inputs: false,
      show_first_term_average: true,
      show_second_term_inputs: false,
      show_second_term_average: true,
    }).map((column) => column.key),
    [
      'subject_name',
      'first_term_average',
      'mid_year_exam',
      'second_term_average',
      'annual_effort',
      'final_exam',
      'result_status',
    ],
  );
});

test('disabled terms suppress their effort columns even when display flags are enabled', () => {
  assert.deepEqual(
    buildResultCardColumns({
      ...directSettings,
      first_term_input_mode: 'disabled',
      second_term_input_mode: 'disabled',
      mid_year_exam_enabled: 0,
      final_exam_enabled: 0,
    }, {
      ...DEFAULT_RESULT_CARD_DISPLAY_SETTINGS,
      show_first_term_inputs: false,
      show_first_term_average: true,
      show_mid_year_exam: false,
      show_second_term_inputs: false,
      show_second_term_average: true,
      show_annual_effort: false,
      show_final_exam: false,
      show_subject_status: false,
    }).map((column) => column.key),
    ['subject_name'],
  );
});

test('term effort bottom averages honor participation, missing values and zero counted subjects', () => {
  const display = {
    ...DEFAULT_RESULT_CARD_DISPLAY_SETTINGS,
    show_first_term_inputs: false,
    show_first_term_average: true,
    show_mid_year_exam: false,
    show_second_term_inputs: false,
    show_second_term_average: true,
    show_annual_effort: false,
    show_final_exam: false,
    show_subject_status: false,
  };
  const complete = columnAveragesFor({
    subjects: [subject(1), subject(2), subject(3, 'نشاط', 0)],
    grades: [
      monthlyGrade(1, { first_term_average: 80, second_term_average: 70 }),
      monthlyGrade(2, { first_term_average: 91, second_term_average: 80 }),
      monthlyGrade(3, { first_term_average: 1, second_term_average: 1 }),
    ],
    display,
  });
  assert.deepEqual(complete.averages, {
    first_term_average: 86,
    second_term_average: 75,
  });

  const missing = columnAveragesFor({
    subjects: [subject(1), subject(2)],
    grades: [
      monthlyGrade(1, { first_term_average: 80, second_term_average: 70 }),
      monthlyGrade(2, { first_term_average: null, second_term_average: 80 }),
    ],
    display,
  });
  assert.deepEqual(missing.averages, {
    first_term_average: null,
    second_term_average: 75,
  });

  const none = columnAveragesFor({
    subjects: [subject(1, 'نشاط', 0)],
    grades: [monthlyGrade(1)],
    display,
  });
  assert.deepEqual(none.averages, {
    first_term_average: null,
    second_term_average: null,
  });
});

test('raw and calculated term-column settings expose their independent defaults in Document Settings', async () => {
  for (const key of [
    'show_first_term_inputs',
    'show_mid_year_exam',
    'show_second_term_inputs',
    'show_final_exam',
  ]) {
    assert.ok(RESULT_CARD_DISPLAY_SETTING_KEYS.includes(key));
    assert.equal(DEFAULT_RESULT_CARD_DISPLAY_SETTINGS[key], true);
  }
  for (const key of ['show_first_term_average', 'show_second_term_average']) {
    assert.ok(RESULT_CARD_DISPLAY_SETTING_KEYS.includes(key));
    assert.equal(DEFAULT_RESULT_CARD_DISPLAY_SETTINGS[key], false);
  }
  const documentTab = await readFile(new URL('../src/modules/settings/DocumentTab.tsx', import.meta.url), 'utf8');
  assert.match(documentTab, /show_first_term_inputs/);
  assert.match(documentTab, /show_mid_year_exam/);
  assert.match(documentTab, /show_second_term_inputs/);
  assert.match(documentTab, /show_final_exam/);
  assert.match(documentTab, /show_first_term_average[^\n]*سعي الفصل الأول/);
  assert.match(documentTab, /show_second_term_average[^\n]*سعي الفصل الثاني/);
});

test('old snapshots keep the legacy safe column shape', () => {
  assert.deepEqual(snapshotResultCardColumns(undefined), [...LEGACY_RESULT_CARD_COLUMNS]);
  assert.deepEqual(snapshotResultCardColumns([{ key: 'unknown' }]), [...LEGACY_RESULT_CARD_COLUMNS]);
  assert.ok(!LEGACY_RESULT_CARD_COLUMNS.some((column) =>
    column.key === 'first_term_average' || column.key === 'second_term_average'
  ));
});

test('saved snapshots freeze term effort columns and averages for later reprints', () => {
  const storedColumns = [
    { key: 'subject_name', label: 'المادة' },
    { key: 'first_term_average', label: 'سعي الفصل الأول' },
    { key: 'second_term_average', label: 'سعي الفصل الثاني' },
  ];
  const storedAverages = {
    first_term_average: 86,
    second_term_average: 75,
  };
  const reprintColumns = snapshotResultCardColumns(storedColumns);
  const reprintAverages = snapshotResultCardColumnAverages(storedAverages, reprintColumns);

  storedColumns[1].label = 'changed';
  storedAverages.first_term_average = 1;
  assert.deepEqual(reprintColumns, [
    { key: 'subject_name', label: 'المادة' },
    { key: 'first_term_average', label: 'سعي الفصل الأول' },
    { key: 'second_term_average', label: 'سعي الفصل الثاني' },
  ]);
  assert.deepEqual(reprintAverages, {
    first_term_average: 86,
    second_term_average: 75,
  });
});

test('snapshot column averages are immutable and old snapshots remain safe', () => {
  const columns = buildResultCardColumns(directSettings, DEFAULT_RESULT_CARD_DISPLAY_SETTINGS);
  assert.equal(snapshotResultCardColumnAverages(undefined, columns), null);

  const stored = {
    first_term_grade: 85,
    mid_year_exam: 80,
    second_term_grade: 87,
    annual_effort: 84,
    final_exam: 86,
    result_status: 99,
  };
  const parsed = snapshotResultCardColumnAverages(stored, columns);
  stored.first_term_grade = 1;
  assert.deepEqual(parsed, {
    first_term_grade: 85,
    mid_year_exam: 80,
    second_term_grade: 87,
    annual_effort: 84,
    final_exam: 86,
  });
});

test('Result Card document renders one aligned print-safe average row from the snapshot only', async () => {
  const component = await readFile(
    new URL('../src/components/resultCards/ResultCardDocument.tsx', import.meta.url),
    'utf8',
  );
  assert.match(component, /snapshotResultCardColumnAverages\(\s*data\?\.column_averages,\s*columns/);
  assert.match(component, /columnAverages &&/);
  assert.match(component, /column\.key === 'subject_name'[\s\S]*?\? 'المعدل'/);
  assert.match(component, /isResultCardNumericColumnKey\(column\.key\)/);
  assert.match(component, /: '—'/);
  assert.match(component, /result-card-last-subject-row/);
  assert.match(component, /result-card-average-row border-t-2 border-slate-700 bg-slate-100 font-black/);
  assert.doesNotMatch(component, /calculateResultCardColumnAverages/);
});

test('Result Card presentation uses a compact optional-field layout and balanced official footer', async () => {
  const component = await readFile(
    new URL('../src/components/resultCards/ResultCardDocument.tsx', import.meta.url),
    'utf8',
  );

  assert.match(component, /const logoUrl = displaySettings\.show_school_logo/);
  assert.doesNotMatch(component, /absolute right-5 top-4/);
  assert.match(component, /grid-cols-\[6rem_1fr_6rem\]/);
  assert.match(component, /studentIdentityItems: StudentInfoItem\[\]/);
  assert.match(component, /academicPlacementItems: StudentInfoItem\[\]/);
  assert.match(component, /optionalStudentInfoItems: StudentInfoItem\[\]/);
  assert.match(component, /student\.student_number !== null[\s\S]*?student\.student_number !== ''/);
  assert.match(component, /card\.status !== 'preview' && card\.card_number\)[\s\S]*?studentIdentityItems\.push\(\{ label: 'رقم الكارت'/);
  assert.doesNotMatch(component, /معاينة مباشرة غير محفوظة/);
  assert.doesNotMatch(component, /معاينة غير محفوظة/);
  assert.match(component, /card\.status === 'cancelled'[\s\S]*?كارت ملغى — غير صالح للاستخدام الرسمي/);
  assert.match(component, /className\) academicPlacementItems\.push\(\{ label: 'الصف'/);
  assert.match(component, /sectionName\) academicPlacementItems\.push\(\{ label: 'الشعبة'/);
  assert.equal((component.match(/label: 'الصف'/g) || []).length, 1);
  assert.equal((component.match(/label: 'الشعبة'/g) || []).length, 1);
  assert.doesNotMatch(component, /العام الدراسي:/);
  assert.doesNotMatch(component, /show_class_section_in_header/);
  assert.doesNotMatch(component, /show_exam_round/);
  assert.doesNotMatch(component, /label: 'الدور'/);
  assert.doesNotMatch(component, /كارت جزئي — بعض البيانات الأكاديمية غير مكتملة/);
  assert.match(component, /const isPartial = data\?\.card_mode === 'partial'/);
  assert.match(component, /const overallStatus = isPartial[\s\S]*?\? 'غير مكتمل'/);
  assert.match(component, /aria-label=\{`السنة الدراسية \$\{academicYear\}`\}/);
  assert.match(component, /dir="ltr"[\s\S]*?\{String\(academicYear\)\}/);
  assert.match(component, /result-card-table w-full table-fixed/);
  assert.match(component, /result-card-subject-column/);
  assert.match(component, /summary\.overall_average !== null[\s\S]*?summary\.overall_average !== undefined/);
  assert.match(component, /generalExemption[\s\S]*?\? \{ label: 'الإعفاء العام'/);
  assert.match(component, /const showDecisionNote = displaySettings\.show_notes_decisions && note\.length > 0/);
  assert.match(component, /result-card-summary grid gap-3 \$\{showDecisionNote \? 'sm:grid-cols-2' : ''\}/);
  assert.match(component, /\{showDecisionNote && \([\s\S]*?result-card-note-body/);
  assert.doesNotMatch(component, /لا توجد ملاحظات أو قرارات مسجلة/);
  assert.match(component, /grid grid-cols-3 items-end gap-3/);
  assert.match(component, /<QRCodeSVG value=\{verificationUrl\} size=\{100\} level="M"/);
  assert.match(component, /يُنشأ رمز QR عند إصدار الكارت/);
});

test('single-page print fit keeps small content at natural size and never enlarges it', () => {
  assert.equal(calculateSinglePagePrintScale({
    availableWidth: 800,
    availableHeight: 1000,
    contentWidth: 700,
    contentHeight: 900,
  }), 1);
  assert.equal(calculateSinglePagePrintScale({
    availableWidth: 800,
    availableHeight: 1000,
    contentWidth: 400,
    contentHeight: 500,
  }), 1);
});

test('single-page print fit reduces slightly tall content with a rounding safety margin', () => {
  const scale = calculateSinglePagePrintScale({
    availableWidth: 800,
    availableHeight: 1000,
    contentWidth: 800,
    contentHeight: 1010,
  });
  const rawHeightRatio = 1000 / 1010;
  assert.ok(scale < 1);
  assert.ok(scale < rawHeightRatio);
  assert.ok(scale * 1010 <= 1000 * PRINT_FIT_SAFETY_FACTOR);
});

test('single-page print fit scales very tall content completely inside the available height', () => {
  const scale = calculateSinglePagePrintScale({
    availableWidth: 800,
    availableHeight: 1000,
    contentWidth: 800,
    contentHeight: 3000,
  });
  assert.ok(scale > 0 && scale < 1);
  assert.ok(scale * 3000 <= 1000 * PRINT_FIT_SAFETY_FACTOR);
  assert.ok(scale * 800 <= 800);
});

test('single-page print fit includes width overflow in the limiting ratio', () => {
  const scale = calculateSinglePagePrintScale({
    availableWidth: 800,
    availableHeight: 1000,
    contentWidth: 1000,
    contentHeight: 500,
  });
  assert.ok(scale < 0.8);
  assert.ok(scale * 1000 <= 800 * PRINT_FIT_SAFETY_FACTOR);
  assert.ok(scale * 500 <= 1000);
});

test('Result Card print route measures rendered content inside one explicit A4 content box', async () => {
  const [printPage, printFit, printLayout, printStyles] = await Promise.all([
    readFile(new URL('../src/modules/print/PrintResultCardPage.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/print/ResultCardPrintFit.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/print/PrintLayout.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/print/printStyles.ts', import.meta.url), 'utf8'),
  ]);

  assert.match(printPage, /className="result-card-print-sheet"/);
  assert.match(printPage, /<ResultCardPrintFit ref=\{printFitRef\}>/);
  assert.match(printPage, /onBeforePrint:[\s\S]*?printFitRef\.current\?\.fit\(\)/);
  assert.match(printFit, /content\.scrollWidth/);
  assert.match(printFit, /content\.scrollHeight/);
  assert.match(printFit, /window\.addEventListener\('beforeprint', handleBeforePrint\)/);
  assert.match(printFit, /document\.fonts\?\.ready/);
  assert.match(printFit, /querySelectorAll\('img'\)/);
  assert.match(printFit, /new ResizeObserver/);
  assert.match(printLayout, /className="print-preview-bg"/);
  assert.doesNotMatch(printLayout, /className="print-preview-bg no-print"/);
  assert.match(printLayout, /className="print-controls flex/);
  assert.match(printStyles, /\.print-controls \{ display: none !important; \}/);
  assert.match(printStyles, /@page \{ size: A4; margin: 1\.5cm; \}/);
  assert.match(printStyles, /\.result-card-print-sheet \.result-card-print-viewport \{[\s\S]*?height: 267mm;[\s\S]*?overflow: hidden;/);
  assert.match(printStyles, /\.result-card-print-sheet \.result-card-print-fit \{[\s\S]*?position: absolute;[\s\S]*?transform: scale\(var\(--result-card-print-scale\)\);[\s\S]*?transform-origin: top right;/);
  assert.match(printStyles, /\.print-a4\.result-card-print-sheet \{[\s\S]*?width: 180mm !important;[\s\S]*?height: 267mm !important;[\s\S]*?max-height: 267mm !important;[\s\S]*?padding: 0 !important;/);
  assert.doesNotMatch(printStyles, /\.print-a4\.result-card-print-sheet \{[\s\S]*?width: 210mm !important;/);
  assert.match(printStyles, /\.result-card-print-sheet \.result-card-document \{[\s\S]*?min-height: 0 !important;/);
  assert.match(printStyles, /\.result-card-print-sheet \.result-card-table thead \{[\s\S]*?display: table-header-group;/);
  assert.match(printStyles, /\.result-card-print-sheet \.result-card-table tr \{[\s\S]*?break-inside: avoid;[\s\S]*?page-break-inside: avoid;/);
  assert.match(printStyles, /\.result-card-print-sheet \.result-card-last-subject-row \{[\s\S]*?break-after: avoid-page;[\s\S]*?page-break-after: avoid;/);
  assert.match(printStyles, /\.result-card-print-sheet \.result-card-average-row \{[\s\S]*?break-before: avoid-page;[\s\S]*?page-break-before: avoid;/);
  assert.match(printStyles, /\.result-card-print-sheet \.result-card-footer \{[\s\S]*?margin-top: 0 !important;/);
});

test('Subjects settings clearly expose independent card visibility and average controls', async () => {
  const subjectsPage = await readFile(
    new URL('../src/modules/subjects/SubjectsPage.tsx', import.meta.url),
    'utf8',
  );
  assert.match(subjectsPage, /يظهر في كارت النتيجة/);
  assert.match(subjectsPage, /يدخل في حساب المعدل/);
  assert.match(subjectsPage, /خيارا العرض في الكارت والدخول في المعدل مستقلان/);
  assert.match(subjectsPage, /checked=\{form\.counts_in_average\}/);
  assert.match(subjectsPage, /checked=\{form\.appears_in_report_card\}/);
});

test('snapshot builder freezes order, branding, note, display settings and verification identity', async () => {
  const worker = await readFile(new URL('../src/worker.ts', import.meta.url), 'utf8');
  const start = worker.indexOf('async function buildResultCardSnapshot');
  const end = worker.indexOf('async function createResultCardForStudent', start);
  const builder = worker.slice(start, end);
  assert.match(builder, /schema_version: 4/);
  assert.match(builder, /const visibleColumns = buildResultCardColumns\(settings, displaySettings\)/);
  assert.match(builder, /const columnAverages = calculateResultCardColumnAverages\(/);
  assert.match(builder, /visible_columns: visibleColumns/);
  assert.match(builder, /column_averages: columnAverages/);
  assert.match(builder, /subjects: evaluation\.grades/);
  assert.match(builder, /display_subject_ids: evaluation\.grades\.map/);
  assert.match(builder, /counted_subject_ids: evaluation\.counted_grades\.map/);
  assert.match(builder, /decision_note: options\.decisionNote/);
  assert.match(builder, /phone: student\.school_phone/);
  assert.match(builder, /result_card_display_settings: displaySettings/);
  assert.match(builder, /verification: identity\.token/);
  assert.match(builder, /card_number: identity\.cardNumber/);
  assert.match(worker, /SELECT su\.id, su\.name AS subject_name, su\.appears_in_report_card,/);
  assert.doesNotMatch(worker.slice(worker.indexOf('async function loadResultCardEvaluation'), worker.indexOf('function resultCardEvaluationFailure')), /su\.appears_in_report_card = 1/);
  assert.match(worker, /g\.first_term_average/);
  assert.match(worker, /g\.second_term_average/);
});

test('new Result Cards use effective enrollment placement without changing issued snapshots', async () => {
  const worker = await readFile(new URL('../src/worker.ts', import.meta.url), 'utf8');
  const studentLoader = worker.slice(
    worker.indexOf('async function loadResultCardStudent'),
    worker.indexOf('async function loadResultCardEvaluation'),
  );
  assert.match(studentLoader, /getStudentWithEffectivePlacement\(db, studentId\)/);
  assert.doesNotMatch(studentLoader, /FROM students/);
  assert.match(studentLoader, /student\.class_id/);
  assert.match(studentLoader, /student\.section_id/);

  const snapshotBuilder = worker.slice(
    worker.indexOf('async function buildResultCardSnapshot'),
    worker.indexOf('async function createResultCardForStudent'),
  );
  assert.match(snapshotBuilder, /if \(student\.class_id == null\)/);
  assert.match(snapshotBuilder, /لا يوجد تسجيل دراسي فعال للطالب في السنة الدراسية الحالية/);
  assert.match(snapshotBuilder, /code: 'invalid_student_placement'/);

  const sectionGenerator = worker.slice(
    worker.indexOf("'/api/result-cards/generate-section'"),
    worker.indexOf('// PUT /api/result-cards/:id/mark-printed', worker.indexOf("'/api/result-cards/generate-section'")),
  );
  assert.match(sectionGenerator, /listStudentsWithEffectivePlacement\(db, \{/);
  assert.doesNotMatch(sectionGenerator, /FROM students[\s\S]*class_id = \?[\s\S]*section_id = \?/);

  const issuedReader = worker.slice(
    worker.indexOf("'/api/result-cards/:id'"),
    worker.indexOf("'/api/result-cards/preview-student/:student_id'"),
  );
  assert.match(issuedReader, /JSON\.parse\(row\.card_data_json\)/);
  assert.doesNotMatch(issuedReader, /loadResultCardEvaluation|buildResultCardSnapshot/);
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
