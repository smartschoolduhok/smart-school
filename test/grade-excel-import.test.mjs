import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { analyzeWorksheet, analysisRowsToRecords, gradeMappingFromAnalysis, RAW_GRADE_FIELDS } from '../src/lib/excelImport.ts';
import { buildGradeImportPlan, discoverGradeSpecialMarkers } from '../src/lib/gradeImport.ts';

const subjectNames = [
  'الاسلامية', 'العربية', 'الانكليزية', 'الاجتماعيات', 'الرياضيات', 'الحاسوب',
  'الفيزياء', 'الكيمياء', 'الاحياء', 'الاخلاقية', 'الرياضة', 'الفنية', 'الفرنسية',
];

const gradeHeaders = [
  'القيد', 'اسم الطالب', 'درجة الفصل الاول', 'السعي الثاني', 'درجة نصف السنة',
  'درجة الفصل الثاني', 'السعي الرابع', 'درجة امتحان نهاية السنة', 'السعي السنوي', 'الدرجة النهائية', 'القرار',
];

const gradeMapping = {
  student_number: 'column:0',
  full_name: 'column:1',
  first_month: 'column:2',
  second_month: 'column:3',
  mid_year_exam: 'column:4',
  third_month: 'column:5',
  fourth_month: 'column:6',
  final_exam: 'column:7',
  annual_effort: 'column:8',
  final_grade: 'column:9',
  result_status: 'column:10',
};

function studentRows(count = 26) {
  return Array.from({ length: count }, (_, index) => [
    `5/${String(index + 1).padStart(3, '0')}`,
    `طالب ${index + 1}`,
    70 + (index % 10),
    72 + (index % 10),
    75,
    78,
    80,
    82,
    79,
    80,
    'ناجح',
  ]);
}

function baseContext({ studentCount = 2, includeAssignments = true, grades = [] } = {}) {
  const students = Array.from({ length: studentCount }, (_, index) => ({
    id: index + 1,
    school_id: 1,
    student_number: `5/${String(index + 1).padStart(3, '0')}`,
    full_name: `طالب ${index + 1}`,
    class_id: 10,
    section_id: 20,
  }));
  const subjects = subjectNames.map((name, index) => ({
    id: 100 + index,
    school_id: 1,
    name,
    class_id: 10,
    section_id: null,
    status: 'active',
  }));
  const assignments = includeAssignments
    ? students.flatMap(student => subjects.map(subject => ({
        id: student.id * 1000 + subject.id,
        school_id: 1,
        student_id: student.id,
        subject_id: subject.id,
        class_id: 10,
        section_id: 20,
        is_active: 1,
      })))
    : [];
  return {
    schoolId: 1,
    settings: { max_grade: 100, passing_grade: 50, exemption_grade: 90 },
    students,
    subjects,
    assignments,
    grades,
    classes: [
      { id: 10, school_id: 1, name: 'الاول المتوسط', status: 'active' },
      { id: 99, school_id: 2, name: 'صف مدرسة أخرى', status: 'active' },
    ],
    sections: [
      { id: 20, school_id: 1, class_id: 10, name: 'أ', status: 'active' },
      { id: 98, school_id: 2, class_id: 99, name: 'ب', status: 'active' },
    ],
  };
}

function payloadSheet(subject, rows, mapping = gradeMapping, extra = {}) {
  return {
    sheet_name: subject.name,
    subject_id: subject.id,
    subject_name: subject.name,
    mapping,
    rows,
    ...extra,
  };
}

test('recognizes all 13 Iraqi subject sheets and excludes report/control sheets', () => {
  const subjects = subjectNames.map((name, index) => ({ id: 100 + index, name, status: 'active' }));
  for (const subject of subjects) {
    const analysis = analyzeWorksheet(subject.name, [gradeHeaders, ...studentRows(6)], { subjects });
    assert.equal(analysis.category, 'grade_sheet', subject.name);
    assert.equal(analysis.subjectInference.subjectId, subject.id, subject.name);
    assert.ok(analysis.subjectInference.confidence >= 0.9, subject.name);
  }
  for (const reportName of ['ملخص', 'النتيجة النهائية', 'نصف السنة', 'القرار', 'كنترول', 'تجييك قابل للمسح']) {
    const analysis = analyzeWorksheet(reportName, [['الاسم', 'المعدل'], ['طالب 1', 80]], { subjects });
    assert.equal(analysis.category, 'summary', reportName);
  }
});

test('maps Iraqi raw grade headers deterministically and ignores calculated outcomes', () => {
  const analysis = analyzeWorksheet('الرياضيات', [gradeHeaders, ...studentRows(8)]);
  const inferred = Object.fromEntries(analysis.gradeFieldInferences.map(item => [item.field, item]));
  assert.equal(inferred.first_month.source.columnIndex, 2);
  assert.equal(inferred.second_month.source.columnIndex, 3);
  assert.equal(inferred.third_month.source.columnIndex, 5);
  assert.notEqual(inferred.second_month.source.columnIndex, 5, 'درجة الفصل الثاني must never map to second_month');
  assert.equal(inferred.mid_year_exam.source.columnIndex, 4);
  assert.equal(inferred.final_exam.source.columnIndex, 7);
  assert.equal(inferred.annual_effort.kind, 'ignored_calculated');
  assert.equal(inferred.final_grade.kind, 'ignored_calculated');
  assert.equal(inferred.result_status.kind, 'ignored_calculated');
});

test('final suggested mapping assigns English Second Term only to third_month', async () => {
  const headers = ['Student ID', 'Student Name', 'First Term', 'Mid Year', 'Second Term', 'Final Exam'];
  const rows = Array.from({ length: 8 }, (_, index) => [`ID/${index + 1}`, `Student ${index + 1}`, 70, 75, 78, 82]);
  const analysis = analyzeWorksheet('Sheet1', [headers, ...rows]);
  const genericAutoMapping = {
    student_number: 'column:0',
    full_name: 'column:1',
    first_month: 'column:2',
    mid_year_exam: 'column:3',
    third_month: 'column:4',
    final_exam: 'column:5',
  };
  const mapping = gradeMappingFromAnalysis(analysis, genericAutoMapping);

  assert.equal(mapping.first_month, 'column:2');
  assert.equal(mapping.mid_year_exam, 'column:3');
  assert.equal(mapping.third_month, 'column:4');
  assert.equal(mapping.final_exam, 'column:5');
  assert.notEqual(mapping.second_month, 'column:4');
  const mappedRawColumns = RAW_GRADE_FIELDS.map(field => mapping[field]).filter(Boolean);
  assert.equal(new Set(mappedRawColumns).size, mappedRawColumns.length, 'automatic raw mappings must use unique source columns');

  const pageSource = await readFile(new URL('../src/modules/importExport/ImportExportPage.tsx', import.meta.url), 'utf8');
  const secondMonthAliases = pageSource.match(/second_month:\s*\[([^\]]+)\]/)?.[1] || '';
  const thirdMonthAliases = pageSource.match(/third_month:\s*\[([^\]]+)\]/)?.[1] || '';
  assert.doesNotMatch(secondMonthAliases, /second term/i);
  assert.match(secondMonthAliases, /second month/i);
  assert.match(secondMonthAliases, /second effort/i);
  assert.match(thirdMonthAliases, /second term/i);
});

test('strong semantic raw claims evict hostile generic mappings for the same column', () => {
  const headers = ['Student ID', 'Student Name', 'Second Term'];
  const rows = Array.from({ length: 8 }, (_, index) => [`ID/${index + 1}`, `Student ${index + 1}`, 78]);
  const analysis = analyzeWorksheet('Sheet1', [headers, ...rows]);
  const mapping = gradeMappingFromAnalysis(analysis, { second_month: 'column:2' });

  assert.equal(mapping.third_month, 'column:2');
  assert.equal(mapping.second_month, undefined);
  const mappedRawColumns = RAW_GRADE_FIELDS.map(field => mapping[field]).filter(Boolean);
  assert.equal(new Set(mappedRawColumns).size, mappedRawColumns.length);
});

test('supports the real Iraqi layout with header row 3, 11 columns, 26 students, and five raw mappings', () => {
  const subject = { id: 104, name: 'الرياضيات', status: 'active' };
  const realHeaders = ['ت', 'القيد', 'اسم الطالب', 'الشعبة', 'درجة الفصل الاول', 'درجة نصف السنة', 'درجة الفصل الثاني', 'درجة امتحان نهاية السنة', 'درجة الاكمال', 'السعي السنوي', 'النتيجة'];
  const realRows = Array.from({ length: 26 }, (_, index) => [index + 1, `5/${String(index + 1).padStart(3, '0')}`, `طالب ${index + 1}`, index < 13 ? 'أ' : 'ب', 70, 75, 78, 82, '', 79, 'ناجح']);
  const rows = [
    ['مدرسة الاختبار'],
    ['درجات الصف الاول المتوسط'],
    realHeaders,
    ...realRows,
  ];
  const analysis = analyzeWorksheet('الرياضيات', rows, { subjects: [subject] });
  const inferred = Object.fromEntries(analysis.gradeFieldInferences.map(item => [item.field, item]));
  assert.equal(analysis.headerRowNumber, 3);
  assert.equal(analysis.columns.length, 11);
  assert.equal(analysis.rowCount, 26);
  assert.equal(analysis.subjectInference.subjectId, 104);
  assert.equal(inferred.first_month.source.columnIndex, 4);
  assert.equal(inferred.mid_year_exam.source.columnIndex, 5);
  assert.equal(inferred.third_month.source.columnIndex, 6);
  assert.equal(inferred.final_exam.source.columnIndex, 7);
  assert.equal(inferred.completion_exam.source.columnIndex, 8);
});

test('plans a real-scale 13-sheet by 26-student workbook without report rows', () => {
  const context = baseContext({ studentCount: 26 });
  const grade_sheets = context.subjects.map(subject => {
    const analysis = analyzeWorksheet(subject.name, [gradeHeaders, ...studentRows()], { subjects: context.subjects });
    return payloadSheet(subject, analysisRowsToRecords([gradeHeaders, ...studentRows()], analysis));
  });
  const plan = buildGradeImportPlan({ grade_sheets }, context);
  assert.equal(plan.errors.length, 0);
  assert.equal(plan.summary.sheets_selected, 13);
  assert.equal(plan.summary.matched_students, 26);
  assert.equal(plan.summary.valid_grade_rows, 338);
  assert.equal(plan.summary.new_grade_rows, 338);
  assert.ok(plan.warnings.some(item => item.field === 'annual_effort'));
});

test('defaults to updating an existing grade and preserves mapped blank cells', () => {
  const context = baseContext({ studentCount: 1 });
  const assignment = context.assignments[0];
  context.grades = [{
    id: 900,
    school_id: 1,
    student_subject_id: assignment.id,
    first_month: 66,
    second_month: 60,
    third_month: null,
    fourth_month: null,
    mid_year_exam: null,
    final_exam: null,
    completion_exam: null,
    notes: null,
  }];
  const subject = context.subjects[0];
  const rows = [{ _excel_row_number: 7, 'column:0': '5/001', 'column:2': '', 'column:3': 88 }];
  const plan = buildGradeImportPlan({ grade_sheets: [payloadSheet(subject, rows, { student_number: 'column:0', first_month: 'column:2', second_month: 'column:3' })] }, context);
  assert.equal(plan.mode, 'update_existing');
  assert.equal(plan.errors.length, 0);
  assert.equal(plan.records[0].action, 'update');
  assert.equal(plan.records[0].values.first_month, 66);
  assert.equal(plan.records[0].values.second_month, 88);
  assert.deepEqual(plan.records[0].changed_fields, ['second_month']);

  const sheet = payloadSheet(subject, rows, { student_number: 'column:0', first_month: 'column:2', second_month: 'column:3' });
  const skipPlan = buildGradeImportPlan({ mode: 'skip_existing', grade_sheets: [sheet] }, context);
  assert.equal(skipPlan.records.length, 0);
  assert.equal(skipPlan.duplicates.length, 1);
  const errorPlan = buildGradeImportPlan({ mode: 'error_on_existing', grade_sheets: [sheet] }, context);
  assert.equal(errorPlan.records.length, 0);
  assert.ok(errorPlan.errors.some(item => item.field === 'grade'));
});

test('clears blank mapped values only after explicit opt-in', () => {
  const context = baseContext({ studentCount: 1 });
  const assignment = context.assignments[0];
  context.grades = [{ id: 901, school_id: 1, student_subject_id: assignment.id, first_month: 66, second_month: null, third_month: null, fourth_month: null, mid_year_exam: null, final_exam: null, completion_exam: null, notes: null }];
  const subject = context.subjects[0];
  const rows = [{ _excel_row_number: 3, 'column:0': '5/001', 'column:2': '' }];
  const plan = buildGradeImportPlan({ clear_empty_fields: true, grade_sheets: [payloadSheet(subject, rows, { student_number: 'column:0', first_month: 'column:2' })] }, context);
  assert.equal(plan.errors.length, 0);
  assert.equal(plan.records[0].values.first_month, null);
  assert.deepEqual(plan.records[0].changed_fields, ['first_month']);
});

test('supports strict and auto assignment modes without silently assigning in strict mode', () => {
  const context = baseContext({ studentCount: 1, includeAssignments: false });
  const subject = context.subjects[0];
  const sheet = payloadSheet(subject, [{ _excel_row_number: 2, 'column:0': '5/001', 'column:2': 80 }], { student_number: 'column:0', first_month: 'column:2' });
  const strictPlan = buildGradeImportPlan({ grade_sheets: [sheet] }, context);
  assert.equal(strictPlan.records.length, 0);
  assert.ok(strictPlan.errors.some(item => item.field === 'assignment'));

  const autoPlan = buildGradeImportPlan({ assignment_mode: 'auto_assign_missing_subjects', grade_sheets: [sheet] }, context);
  assert.equal(autoPlan.errors.length, 0);
  assert.equal(autoPlan.records[0].assignment_action, 'create');
  assert.equal(autoPlan.summary.assignment_creates, 1);
});

test('reactivates an existing inactive assignment only in explicit auto-assignment mode', () => {
  const context = baseContext({ studentCount: 1 });
  context.assignments[0].is_active = 0;
  const subject = context.subjects[0];
  const sheet = payloadSheet(subject, [{ _excel_row_number: 2, 'column:0': '5/001', 'column:2': 80 }], { student_number: 'column:0', first_month: 'column:2' });
  const strictPlan = buildGradeImportPlan({ grade_sheets: [sheet] }, context);
  assert.ok(strictPlan.errors.some(item => item.message.includes('غير نشط')));
  const autoPlan = buildGradeImportPlan({ assignment_mode: 'auto_assign_missing_subjects', grade_sheets: [sheet] }, context);
  assert.equal(autoPlan.errors.length, 0);
  assert.equal(autoPlan.records[0].assignment_action, 'reactivate');
  assert.equal(autoPlan.summary.assignment_reactivations, 1);
});

test('rejects a stale assignment whose placement no longer matches the student', () => {
  const context = baseContext({ studentCount: 1 });
  context.assignments[0].section_id = 777;
  const subject = context.subjects[0];
  const sheet = payloadSheet(subject, [{ _excel_row_number: 8, 'column:0': '5/001', 'column:2': 80 }], { student_number: 'column:0', first_month: 'column:2' });
  const plan = buildGradeImportPlan({ assignment_mode: 'auto_assign_missing_subjects', grade_sheets: [sheet] }, context);
  assert.equal(plan.records.length, 0);
  assert.ok(plan.errors.some(item => item.field === 'assignment' && item.message.includes('لا يطابق')));
});

test('matches unique names with mixed A/B placement and never lets one section override all rows', () => {
  const context = baseContext({ studentCount: 2 });
  context.sections.push({ id: 21, school_id: 1, class_id: 10, name: 'ب', status: 'active' });
  context.students[0].section_id = 20;
  context.students[1].section_id = 21;
  context.assignments.forEach(assignment => {
    assignment.section_id = assignment.student_id === 1 ? 20 : 21;
  });
  const subject = context.subjects[0];
  const sheet = payloadSheet(subject, [
    { _excel_row_number: 5, 'column:1': 'طالب 1', 'column:3': 'أ', 'column:2': 70 },
    { _excel_row_number: 6, 'column:1': 'طالب 2', 'column:3': 'ب', 'column:2': 80 },
  ], { full_name: 'column:1', section_name: 'column:3', first_month: 'column:2' });
  const plan = buildGradeImportPlan({ grade_sheets: [sheet] }, context);
  assert.equal(plan.errors.length, 0);
  assert.deepEqual(plan.records.map(record => record.section_id), [20, 21]);
});

test('normalizes subject names conservatively, requires override for ambiguity, and rejects missing subjects', () => {
  const context = baseContext({ studentCount: 1 });
  const arabic = context.subjects.find(subject => subject.name === 'العربية');
  const analyzedVariant = analyzeWorksheet('اللغة العربية', [gradeHeaders, ...studentRows(6)], { subjects: context.subjects });
  assert.equal(analyzedVariant.subjectInference.subjectId, arabic.id);
  const row = [{ _excel_row_number: 2, 'column:0': '5/001', 'column:2': 80 }];
  const normalizedSheet = payloadSheet(arabic, row, { student_number: 'column:0', first_month: 'column:2' }, { subject_id: null, subject_name: 'اللغة العربية', sheet_name: 'اللغة العربية' });
  const normalizedPlan = buildGradeImportPlan({ grade_sheets: [normalizedSheet] }, context);
  assert.equal(normalizedPlan.errors.length, 0);
  assert.equal(normalizedPlan.records[0].subject_id, arabic.id);

  const duplicateSubject = { ...arabic, id: 999 };
  const ambiguousPlan = buildGradeImportPlan({ grade_sheets: [normalizedSheet] }, { ...context, subjects: [...context.subjects, duplicateSubject] });
  assert.ok(ambiguousPlan.errors.some(item => item.message.includes('عدة مواد')));
  const overridePlan = buildGradeImportPlan({ grade_sheets: [{ ...normalizedSheet, subject_id: arabic.id }] }, { ...context, subjects: [...context.subjects, duplicateSubject] });
  assert.equal(overridePlan.errors.length, 0);

  const missingPlan = buildGradeImportPlan({ grade_sheets: [{ ...normalizedSheet, subject_name: 'مادة غير موجودة', sheet_name: 'مادة غير موجودة' }] }, context);
  assert.ok(missingPlan.errors.some(item => item.message.includes('غير موجودة')));
});

test('rejects unexpected grade text and treats rows without raw grade instructions as no-op', () => {
  const context = baseContext({ studentCount: 1 });
  const subject = context.subjects[0];
  const textPlan = buildGradeImportPlan({ grade_sheets: [payloadSheet(subject, [{ _excel_row_number: 2, 'column:0': '5/001', 'column:2': 'غائب' }], { student_number: 'column:0', first_month: 'column:2' })] }, context);
  assert.ok(textPlan.errors.some(item => item.field === 'first_month'));
  assert.equal(textPlan.records.length, 0);

  const blankPlan = buildGradeImportPlan({ grade_sheets: [payloadSheet(subject, [{ _excel_row_number: 3, 'column:0': '5/001', 'column:2': '' }], { student_number: 'column:0', first_month: 'column:2' }, { special_values: { 'غ م': 'not_applicable' } })] }, context);
  assert.equal(blankPlan.errors.length, 0);
  assert.equal(blankPlan.records.length, 0);
  assert.equal(blankPlan.not_applicable.length, 0);
  assert.equal(blankPlan.summary.noop_rows, 1);
});

test('discovers grade text markers without assigning a meaning to them', () => {
  const markers = discoverGradeSpecialMarkers([
    { 'column:2': 'غ م', 'column:3': 'N/A' },
    { 'column:2': ' غ م ', 'column:3': 80 },
    { 'column:2': '', 'column:3': '#N/A' },
  ], { first_month: 'column:2', mid_year_exam: 'column:3' });

  assert.deepEqual(markers.map(marker => [marker.value, marker.count]), [['غ م', 2], ['N/A', 1]]);
  assert.deepEqual(markers[0].fields, ['first_month']);
  assert.deepEqual(markers[1].fields, ['mid_year_exam']);
});

test('explicit Not Applicable markers create no grade or assignment writes', () => {
  const context = baseContext({ includeAssignments: false });
  const subject = context.subjects[0];
  const sheet = payloadSheet(subject, [
    { _excel_row_number: 7, 'column:0': '5/001', 'column:2': 'غ م', 'column:3': '' },
  ], { student_number: 'column:0', first_month: 'column:2', mid_year_exam: 'column:3' }, {
    special_values: { 'غ م': 'not_applicable' },
  });
  const plan = buildGradeImportPlan({ assignment_mode: 'auto_assign_missing_subjects', grade_sources: [sheet] }, context);

  assert.equal(plan.errors.length, 0);
  assert.equal(plan.records.length, 0, 'Not Applicable rows must never reach grade/assignment writers');
  assert.equal(plan.not_applicable.length, 1);
  assert.equal(plan.not_applicable[0].student_id, 1);
  assert.equal(plan.not_applicable[0].subject_id, subject.id);
  assert.deepEqual(plan.not_applicable[0].markers, [{ field: 'first_month', value: 'غ م' }]);
  assert.equal(plan.summary.not_applicable_rows, 1);
  assert.equal(plan.summary.assignment_creates, 0);
  assert.equal(plan.summary.assignment_reactivations, 0);
  assert.equal(plan.summary.new_grade_rows, 0);
  assert.equal(plan.sources[0].not_applicable_rows, 1);
});

test('Not Applicable never reactivates an inactive student-subject assignment', () => {
  const context = baseContext();
  const subject = context.subjects[0];
  context.assignments = context.assignments.map(assignment => assignment.student_id === 1 && assignment.subject_id === subject.id
    ? { ...assignment, is_active: 0 }
    : assignment);
  const sheet = payloadSheet(subject, [
    { _excel_row_number: 8, 'column:0': '5/001', 'column:2': 'N/A' },
  ], { student_number: 'column:0', first_month: 'column:2' }, {
    special_values: { 'N/A': 'not_applicable' },
  });
  const plan = buildGradeImportPlan({ assignment_mode: 'auto_assign_missing_subjects', grade_sources: [sheet] }, context);

  assert.equal(plan.errors.length, 0);
  assert.equal(plan.records.length, 0);
  assert.equal(plan.not_applicable.length, 1);
  assert.equal(plan.summary.assignment_reactivations, 0);
});

test('Not Applicable combined with a numeric raw grade is a fatal conflict', () => {
  const context = baseContext();
  const subject = context.subjects[0];
  const sheet = payloadSheet(subject, [
    { _excel_row_number: 9, 'column:0': '5/001', 'column:2': 'غ م', 'column:3': 80 },
  ], { student_number: 'column:0', first_month: 'column:2', mid_year_exam: 'column:3' }, {
    special_values: { 'غ م': 'not_applicable' },
  });
  const plan = buildGradeImportPlan({ grade_sources: [sheet] }, context);

  assert.equal(plan.records.length, 0);
  assert.equal(plan.not_applicable.length, 0);
  assert.ok(plan.errors.some(item => item.field === 'special_value_conflict'));
});

test('different Arabic and English markers are interpreted independently', () => {
  const context = baseContext({ includeAssignments: false });
  const subject = context.subjects[0];
  const rows = [
    { _excel_row_number: 10, 'column:0': '5/001', 'column:2': 'غ م' },
    { _excel_row_number: 11, 'column:0': '5/002', 'column:2': 'N/A' },
  ];
  const partiallyMapped = payloadSheet(subject, rows, { student_number: 'column:0', first_month: 'column:2' }, {
    special_values: { 'غ م': 'not_applicable' },
  });
  const partialPlan = buildGradeImportPlan({ assignment_mode: 'auto_assign_missing_subjects', grade_sources: [partiallyMapped] }, context);
  assert.equal(partialPlan.not_applicable.length, 1);
  assert.ok(partialPlan.errors.some(item => item.message.includes('N/A')));

  const fullyMapped = { ...partiallyMapped, special_values: { 'غ م': 'not_applicable', 'N/A': 'not_applicable' } };
  const fullPlan = buildGradeImportPlan({ assignment_mode: 'auto_assign_missing_subjects', grade_sources: [fullyMapped] }, context);
  assert.equal(fullPlan.errors.length, 0);
  assert.equal(fullPlan.not_applicable.length, 2);
  assert.equal(fullPlan.records.length, 0);
  assert.deepEqual(fullPlan.not_applicable.map(record => record.markers[0].value), ['غ م', 'N/A']);
});

test('ordinary numeric grade imports remain unchanged with special-value support', () => {
  const context = baseContext();
  const subject = context.subjects[0];
  const sheet = payloadSheet(subject, [
    { _excel_row_number: 12, 'column:0': '5/001', 'column:2': 81 },
  ], { student_number: 'column:0', first_month: 'column:2' }, {
    special_values: { 'غ م': 'not_applicable' },
  });
  const plan = buildGradeImportPlan({ grade_sources: [sheet] }, context);

  assert.equal(plan.errors.length, 0);
  assert.equal(plan.not_applicable.length, 0);
  assert.equal(plan.records.length, 1);
  assert.equal(plan.records[0].values.first_month, 81);
});

test('rejects ambiguous student names, cross-school placement, invalid grades, and incompatible subjects', () => {
  const context = baseContext({ studentCount: 2 });
  context.students[1].full_name = context.students[0].full_name;
  const subject = context.subjects[0];
  const ambiguous = payloadSheet(subject, [{ _excel_row_number: 4, 'column:1': 'طالب 1', 'column:2': 80 }], { full_name: 'column:1', first_month: 'column:2' });
  const ambiguousPlan = buildGradeImportPlan({ grade_sheets: [ambiguous] }, context);
  assert.ok(ambiguousPlan.errors.some(item => item.message.includes('أكثر من طالب')));

  const crossSchool = payloadSheet(subject, [{ _excel_row_number: 9, 'column:0': '5/001', 'column:2': 80 }], { student_number: 'column:0', first_month: 'column:2' }, { class_id: 99 });
  const crossSchoolPlan = buildGradeImportPlan({ grade_sheets: [crossSchool] }, context);
  assert.ok(crossSchoolPlan.errors.some(item => item.field === 'class_id'));

  const invalidGrade = payloadSheet(subject, [{ _excel_row_number: 10, 'column:0': '5/001', 'column:2': 120 }], { student_number: 'column:0', first_month: 'column:2' });
  const invalidGradePlan = buildGradeImportPlan({ grade_sheets: [invalidGrade] }, context);
  assert.ok(invalidGradePlan.errors.some(item => item.field === 'first_month'));

  const foreignStudent = { ...context.students[0], id: 77, school_id: 2, student_number: 'OTHER/1' };
  const foreignStudentPlan = buildGradeImportPlan({ grade_sheets: [payloadSheet(subject, [{ _excel_row_number: 11, 'column:0': 'OTHER/1', 'column:2': 80 }], { student_number: 'column:0', first_month: 'column:2' })] }, { ...context, students: [...context.students, foreignStudent] });
  assert.ok(foreignStudentPlan.errors.some(item => item.field === 'student' && item.message.includes('غير موجود')));

  const foreignSubject = { ...subject, id: 778, school_id: 2 };
  const foreignSubjectPlan = buildGradeImportPlan({ grade_sheets: [payloadSheet(foreignSubject, [{ _excel_row_number: 12, 'column:0': '5/001', 'column:2': 80 }], { student_number: 'column:0', first_month: 'column:2' })] }, { ...context, subjects: [...context.subjects, foreignSubject] });
  assert.ok(foreignSubjectPlan.errors.some(item => item.field === 'subject' && item.message.includes('غير موجودة')));

  const incompatibleSubject = { ...context.subjects[1], class_id: 777 };
  const incompatiblePlan = buildGradeImportPlan({ grade_sheets: [payloadSheet(incompatibleSubject, [{ _excel_row_number: 2, 'column:0': '5/001', 'column:2': 70 }], { student_number: 'column:0', first_month: 'column:2' })] }, { ...context, subjects: context.subjects.map(item => item.id === incompatibleSubject.id ? incompatibleSubject : item) });
  assert.ok(incompatiblePlan.errors.some(item => item.message.includes('لا تتوافق')));
});

test('allows the same subject in multiple sources and detects conflicts only by student plus subject', () => {
  const context = baseContext({ studentCount: 1 });
  const subject = context.subjects[0];
  const first = payloadSheet(subject, [{ _excel_row_number: 12, 'column:0': '5/001', 'column:2': 70 }], { student_number: 'column:0', first_month: 'column:2' });
  const second = payloadSheet(subject, [{ _excel_row_number: 23, 'column:0': '5/001', 'column:2': 80 }], { student_number: 'column:0', first_month: 'column:2' }, { sheet_name: `${subject.name} نسخة` });
  const plan = buildGradeImportPlan({ grade_sheets: [first, second] }, context);
  assert.ok(!plan.errors.some(item => item.field === 'subject'));
  assert.ok(plan.errors.some(item => item.field === 'conflict' && item.label.includes('Excel row 23')));
});

test('deduplicates identical student-subject rows and rejects differing values', () => {
  const context = baseContext({ studentCount: 1 });
  const subject = context.subjects[0];
  const base = { _excel_row_number: 2, 'column:0': '5/001', 'column:2': 75 };
  const identical = buildGradeImportPlan({ grade_sheets: [payloadSheet(subject, [base, { ...base, _excel_row_number: 3 }], { student_number: 'column:0', first_month: 'column:2' })] }, context);
  assert.equal(identical.records.length, 1);
  assert.equal(identical.duplicates.length, 1);

  const conflicting = buildGradeImportPlan({ grade_sheets: [payloadSheet(subject, [base, { ...base, _excel_row_number: 4, 'column:2': 76 }], { student_number: 'column:0', first_month: 'column:2' })] }, context);
  assert.equal(conflicting.records.length, 1);
  assert.ok(conflicting.errors.some(item => item.field === 'conflict'));
});

test('calculated Excel values are warning-only and never become authoritative grade values', () => {
  const context = baseContext({ studentCount: 1 });
  const subject = context.subjects[0];
  const sheet = payloadSheet(subject, [{ _excel_row_number: 2, 'column:0': '5/001', 'column:2': 80, 'column:8': 999, 'column:9': 'راسب' }], gradeMapping);
  const plan = buildGradeImportPlan({ grade_sheets: [sheet] }, context);
  assert.equal(plan.errors.length, 0);
  assert.equal(plan.records[0].values.first_month, 80);
  assert.equal(plan.records[0].calculated.annual_effort, 80);
  assert.notEqual(plan.records[0].calculated.annual_effort, 999);
  assert.ok(plan.warnings.some(item => item.field === 'annual_effort'));
  assert.ok(plan.warnings.some(item => item.field === 'result_status'));

  const calculatedAsRaw = payloadSheet(subject, [{ _excel_row_number: 3, 'column:0': '5/001', 'column:8': 999 }], { student_number: 'column:0', first_month: 'column:8' }, {
    column_headers: { 'column:0': 'القيد', 'column:8': 'السعي السنوي' },
  });
  const rejected = buildGradeImportPlan({ grade_sheets: [calculatedAsRaw] }, context);
  assert.equal(rejected.records.length, 0);
  assert.ok(rejected.errors.some(item => item.field === 'first_month' && item.message.includes('عمود محسوب')));
});

test('calculated headers never compete with or auto-map to raw grade fields', () => {
  const calculatedHeaders = [
    'القيد', 'اسم الطالب', 'معدل الفصل الاول', 'معدل الفصل الثاني', 'السعي السنوي',
    'الدرجة النهائية', 'النتيجة', 'المعدل', 'القرار',
  ];
  const calculatedRows = Array.from({ length: 8 }, (_, index) => [
    `5/${String(index + 1).padStart(3, '0')}`, `طالب ${index + 1}`, 75, 78, 77, 80, 'ناجح', 80, 'ناجح',
  ]);
  const analysis = analyzeWorksheet('تقرير', [calculatedHeaders, ...calculatedRows]);
  const inferred = Object.fromEntries(analysis.gradeFieldInferences.map(item => [item.field, item]));
  const calculatedKeys = new Set(analysis.gradeFieldInferences
    .filter(item => item.kind === 'ignored_calculated' && item.source.type === 'column')
    .map(item => item.source.columnKey));
  const hostileAutoMapping = {
    first_month: 'column:2',
    third_month: 'column:3',
    fourth_month: 'column:4',
    final_exam: 'column:5',
  };
  const mapping = gradeMappingFromAnalysis(analysis, hostileAutoMapping);

  assert.notEqual(inferred.first_month.source.columnIndex, 2);
  assert.notEqual(inferred.third_month.source.columnIndex, 3);
  for (const field of RAW_GRADE_FIELDS) assert.ok(!calculatedKeys.has(mapping[field]), `${field} mapped to a calculated column`);
  assert.equal(inferred.first_term_average.kind, 'ignored_calculated');
  assert.equal(inferred.second_term_average.kind, 'ignored_calculated');
  assert.equal(inferred.annual_effort.kind, 'ignored_calculated');
  assert.equal(inferred.final_grade.kind, 'ignored_calculated');
  assert.equal(inferred.result_status.kind, 'ignored_calculated');

  const mixedHeaders = ['القيد', 'اسم الطالب', 'درجة الفصل الثاني', 'معدل الفصل الثاني'];
  const mixed = analyzeWorksheet('Sheet1', [mixedHeaders, ...Array.from({ length: 8 }, (_, index) => [`5/${index + 1}`, `طالب ${index + 1}`, 74, 77])]);
  const mixedMapping = gradeMappingFromAnalysis(mixed, { third_month: 'column:3' });
  const mixedInferred = Object.fromEntries(mixed.gradeFieldInferences.map(item => [item.field, item]));
  assert.equal(mixedMapping.third_month, 'column:2');
  assert.equal(mixedInferred.second_term_average.source.columnIndex, 3);
  assert.equal(mixedInferred.second_term_average.kind, 'ignored_calculated');
});

test('grade analysis is position independent and not fitted to the golden workbook dimensions', () => {
  const englishHeaders = ['Unrelated', 'Final Exam', 'Student Name', 'Student ID', 'Mid Year', 'First Term', 'Second Term'];
  const makeEnglishRows = count => Array.from({ length: count }, (_, index) => [
    `note-${index}`, 80, `Student ${index + 1}`, `ID/${index + 1}`, 75, 70, 78,
  ]);
  const rowsAtSeven = [
    ['School title'], [], ['Academic year 2026'], [], [''], ['Prepared report'],
    englishHeaders,
    ...makeEnglishRows(20),
  ];
  const analysis = analyzeWorksheet('Sheet1', rowsAtSeven);
  const inferred = Object.fromEntries(analysis.gradeFieldInferences.map(item => [item.field, item]));
  assert.equal(analysis.headerRowNumber, 7);
  assert.equal(analysis.category, 'grade_sheet');
  assert.equal(inferred.full_name.source.columnIndex, 2);
  assert.equal(inferred.student_number.source.columnIndex, 3);
  assert.equal(inferred.first_month.source.columnIndex, 5);
  assert.equal(inferred.mid_year_exam.source.columnIndex, 4);
  assert.equal(inferred.final_exam.source.columnIndex, 1);
  assert.equal(inferred.third_month.source.columnIndex, 6);
  assert.notEqual(inferred.second_month.source.columnIndex, 6);
  assert.equal(analysis.subjectInference.subjectId, null);
  assert.ok(analysis.subjectInference.confidence < 0.85, 'generic sheet subject must require correction');

  const fiveStudents = analyzeWorksheet('Data', [englishHeaders, ...makeEnglishRows(5)]);
  const manyStudents = analyzeWorksheet('Term Results', [englishHeaders, ...makeEnglishRows(150)]);
  assert.equal(fiveStudents.rowCount, 5);
  assert.equal(manyStudents.rowCount, 150);
  assert.equal(fiveStudents.category, 'grade_sheet');
  assert.equal(manyStudents.category, 'grade_sheet');

  const partial = analyzeWorksheet('Marks', [
    ['Student ID', 'Student Name', 'Final Exam'],
    ...Array.from({ length: 7 }, (_, index) => [`ID/${index + 1}`, `Student ${index + 1}`, 65]),
  ]);
  assert.equal(partial.category, 'grade_sheet');
  assert.equal(Object.fromEntries(partial.gradeFieldInferences.map(item => [item.field, item])).final_exam.source.columnIndex, 2);

  const ambiguous = analyzeWorksheet('Data', [['Name', 'Value'], ['Only Student', 80]]);
  assert.notEqual(ambiguous.category, 'grade_sheet', 'one ambiguous value must not be guessed as a grade table');
});

test('subjects outside the optional Iraqi hint list resolve from actual school subjects and metadata', () => {
  const customSubject = { id: 700, name: 'الاقتصاد المتقدم', status: 'active' };
  const headers = ['Student ID', 'Student Name', 'First Term', 'Mid Year', 'Final Exam'];
  const rows = [
    ['المادة: الاقتصاد المتقدم'],
    ['صف دراسي'],
    headers,
    ...Array.from({ length: 6 }, (_, index) => [`ID/${index + 1}`, `Student ${index + 1}`, 70, 75, 80]),
  ];
  const analysis = analyzeWorksheet('Data', rows, { subjects: [customSubject] });
  assert.equal(analysis.category, 'grade_sheet');
  assert.equal(analysis.subjectInference.subjectId, customSubject.id);
  assert.equal(analysis.subjectInference.source.type, 'metadata-cell');
});

test('one generic source resolves multiple subjects per row without treating them as duplicates', () => {
  const context = baseContext({ studentCount: 1 });
  const physics = context.subjects.find(subject => subject.name === 'الفيزياء');
  const chemistry = context.subjects.find(subject => subject.name === 'الكيمياء');
  const biology = context.subjects.find(subject => subject.name === 'الاحياء');
  const source = {
    source_id: 'Sheet1:region:1',
    sheet_name: 'Sheet1',
    region_id: '1',
    subject_source: 'column',
    mapping: { student_number: 'column:0', subject_name: 'column:1', first_month: 'column:2' },
    rows: [
      { _excel_row_number: 2, 'column:0': '5/001', 'column:1': 'الفيزياء', 'column:2': 80 },
      { _excel_row_number: 3, 'column:0': '5/001', 'column:1': 'مادة الكيمياء', 'column:2': 70 },
      { _excel_row_number: 4, 'column:0': '5/001', 'column:1': 'الاحياء', 'column:2': 90 },
    ],
  };
  const plan = buildGradeImportPlan({ grade_sources: [source] }, context);
  assert.equal(plan.errors.length, 0);
  assert.deepEqual(new Set(plan.records.map(record => record.subject_id)), new Set([physics.id, chemistry.id, biology.id]));
  assert.equal(plan.records.length, 3);

  const missing = buildGradeImportPlan({ grade_sources: [{ ...source, rows: [{ _excel_row_number: 5, 'column:0': '5/001', 'column:1': 'مادة غير موجودة', 'column:2': 70 }] }] }, context);
  assert.ok(missing.errors.some(item => item.field === 'subject' && item.message.includes('غير موجودة')));

  const duplicatePhysics = { ...physics, id: 999 };
  const ambiguous = buildGradeImportPlan({ grade_sources: [{ ...source, rows: [source.rows[0]] }] }, { ...context, subjects: [...context.subjects, duplicatePhysics] });
  assert.ok(ambiguous.errors.some(item => item.field === 'subject' && item.message.includes('عدة مواد')));

  const fixedOverride = buildGradeImportPlan({ grade_sources: [{
    ...source,
    source_id: 'Sheet1:fixed',
    subject_source: 'fixed',
    subject_id: chemistry.id,
    rows: [source.rows[0]],
  }] }, context);
  assert.equal(fixedOverride.errors.length, 0);
  assert.equal(fixedOverride.records[0].subject_id, chemistry.id);

  const economics = { id: 777, school_id: 1, name: 'الاقتصاد', class_id: 10, section_id: null, status: 'active' };
  const economicsAssignment = { id: 1777, school_id: 1, student_id: 1, subject_id: economics.id, class_id: 10, section_id: 20, is_active: 1 };
  const outsideHints = buildGradeImportPlan({ grade_sources: [{
    ...source,
    source_id: 'Sheet1:economics',
    rows: [{ _excel_row_number: 8, 'column:0': '5/001', 'column:1': 'درجات الاقتصاد', 'column:2': 88 }],
  }] }, { ...context, subjects: [...context.subjects, economics], assignments: [...context.assignments, economicsAssignment] });
  assert.equal(outsideHints.errors.length, 0);
  assert.equal(outsideHints.records[0].subject_id, economics.id);
});

test('multiple logical sources may share one worksheet name and retain region identity', () => {
  const context = baseContext({ studentCount: 2 });
  const subject = context.subjects[0];
  const common = {
    sheet_name: 'الدرجات',
    subject_source: 'fixed',
    subject_id: subject.id,
    subject_name: subject.name,
    mapping: { student_number: 'column:0', first_month: 'column:1' },
  };
  const sources = [
    { ...common, source_id: 'grades:region:a', region_id: 'A', row_start: 2, row_end: 20, rows: [{ _excel_row_number: 3, 'column:0': '5/001', 'column:1': 70 }] },
    { ...common, source_id: 'grades:region:b', region_id: 'B', row_start: 25, row_end: 45, rows: [{ _excel_row_number: 26, 'column:0': '5/002', 'column:1': 80 }] },
  ];
  const plan = buildGradeImportPlan({ grade_sources: sources }, context);
  assert.equal(plan.errors.length, 0);
  assert.equal(plan.records.length, 2);
  assert.equal(plan.sources.length, 2);
  assert.equal(plan.summary.sources_selected, 2);
  assert.equal(plan.summary.sheets_selected, 1);
  assert.deepEqual(plan.records.map(record => record.region_id), ['A', 'B']);

  const identical = buildGradeImportPlan({ grade_sources: [sources[0], { ...sources[1], rows: [{ _excel_row_number: 26, 'column:0': '5/001', 'column:1': 70 }] }] }, context);
  assert.equal(identical.records.length, 1);
  assert.equal(identical.duplicates.length, 1);
  const conflict = buildGradeImportPlan({ grade_sources: [sources[0], { ...sources[1], rows: [{ _excel_row_number: 26, 'column:0': '5/001', 'column:1': 71 }] }] }, context);
  assert.ok(conflict.errors.some(item => item.field === 'conflict' && item.region === 'B'));
});

test('grade preview remains write-free and confirm uses one transactional D1 batch', async () => {
  const worker = await readFile(new URL('../src/worker.ts', import.meta.url), 'utf8');
  const previewStart = worker.indexOf("app.post('/api/import-export/:type/preview'");
  const confirmStart = worker.indexOf("app.post('/api/import-export/:type/confirm'");
  const previewPrefix = worker.slice(previewStart, confirmStart);
  assert.match(previewPrefix, /if \(type === 'grades'\)[\s\S]*loadGradeImportContext[\s\S]*buildGradeImportPlan[\s\S]*return c\.json/);
  assert.doesNotMatch(worker.slice(worker.indexOf('async function loadGradeImportContext'), worker.indexOf('function gradeImportPreviewData')), /\.run\(\)/);
  const atomicWriter = worker.slice(worker.indexOf('async function executeGradeImportPlan'), previewStart);
  assert.match(atomicWriter, /const results = await db\.batch\(statements\)/);
  assert.match(atomicWriter, /const assignmentCreates = plan\.records\.filter/);
  assert.match(atomicWriter, /const gradeCreates = plan\.records\.filter/);
  assert.doesNotMatch(atomicWriter, /await db\.prepare[\s\S]*\.run\(\)/);
  assert.ok(atomicWriter.indexOf("INSERT INTO import_jobs") < atomicWriter.indexOf('db.batch(statements)'), 'job write must be part of the same batch');
  assert.match(worker, /const requestedSources = Array\.isArray\(body\?\.grade_sources\)/);
  assert.match(worker, /candidate\.special_values/);
  assert.match(worker, /special_values: specialValues/);
  assert.match(worker, /seenSourceIds/);
  assert.doesNotMatch(worker, /seenNames\.has\(sheetName\)/);
});
