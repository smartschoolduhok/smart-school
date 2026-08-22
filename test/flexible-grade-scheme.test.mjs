import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { calculateGrades } from '../src/lib/gradeCalculations.ts';
import { RECALCULATE_SCHOOL_GRADES_SQL } from '../src/lib/gradeRecalculationSql.ts';
import {
  DEFAULT_GRADE_SCHEME_SETTINGS,
  disabledRawGradeFields,
  enabledRawGradeFields,
  gradeInputColumns,
  normalizeGradeSchemeSettings,
  validateGradeSchemeSettings,
} from '../src/lib/gradeScheme.ts';
import { analyzeWorksheet, gradeMappingFromAnalysis } from '../src/lib/excelImport.ts';
import { buildGradeImportPlan } from '../src/lib/gradeImport.ts';
import { createPerKeyTaskQueue, mergeUpdatedRow } from '../src/lib/perKeyTaskQueue.ts';
import { hasRole, SCHOOL_MANAGEMENT_ROLES } from '../src/lib/rbac.ts';

const thresholds = { max_grade: 100, passing_grade: 50, exemption_grade: 90 };

const rawGradeColumns = [
  'first_term_grade', 'first_month', 'second_month', 'second_term_grade',
  'third_month', 'fourth_month', 'mid_year_exam', 'final_exam', 'completion_exam',
];
const derivedGradeColumns = [
  'first_term_average', 'second_term_average', 'annual_effort', 'final_grade',
  'grade_after_completion', 'effective_grade', 'result_status', 'exemption_status',
];

function createRecalculationDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE grade_settings (
      school_id INTEGER PRIMARY KEY,
      max_grade REAL NOT NULL,
      passing_grade REAL NOT NULL,
      exemption_grade REAL NOT NULL,
      first_term_input_mode TEXT NOT NULL,
      second_term_input_mode TEXT NOT NULL,
      mid_year_exam_enabled INTEGER NOT NULL,
      final_exam_enabled INTEGER NOT NULL,
      completion_exam_enabled INTEGER NOT NULL
    );
    CREATE TABLE grades (
      id INTEGER PRIMARY KEY,
      school_id INTEGER NOT NULL,
      first_term_grade REAL,
      first_month REAL,
      second_month REAL,
      second_term_grade REAL,
      third_month REAL,
      fourth_month REAL,
      mid_year_exam REAL,
      final_exam REAL,
      completion_exam REAL,
      first_term_average REAL,
      second_term_average REAL,
      annual_effort REAL,
      final_grade REAL,
      grade_after_completion REAL,
      effective_grade REAL,
      result_status TEXT,
      exemption_status INTEGER DEFAULT 0,
      notes TEXT,
      is_active INTEGER NOT NULL DEFAULT 1
    );
  `);
  return db;
}

function replaceSettings(db, overrides = {}) {
  const settings = {
    school_id: 1,
    max_grade: 100,
    passing_grade: 50,
    exemption_grade: 90,
    first_term_input_mode: 'monthly',
    second_term_input_mode: 'monthly',
    mid_year_exam_enabled: 1,
    final_exam_enabled: 1,
    completion_exam_enabled: 1,
    ...overrides,
  };
  const columns = Object.keys(settings);
  db.prepare(`INSERT OR REPLACE INTO grade_settings (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`)
    .run(...columns.map(column => settings[column]));
  return settings;
}

function insertGrade(db, overrides = {}) {
  const row = {
    id: 1,
    school_id: 1,
    first_term_grade: null,
    first_month: null,
    second_month: null,
    second_term_grade: null,
    third_month: null,
    fourth_month: null,
    mid_year_exam: null,
    final_exam: null,
    completion_exam: null,
    first_term_average: 999,
    second_term_average: 999,
    annual_effort: 999,
    final_grade: 999,
    grade_after_completion: 999,
    effective_grade: 999,
    result_status: 'قديم',
    exemption_status: 1,
    notes: 'ملاحظة تدقيق محفوظة',
    is_active: 1,
    ...overrides,
  };
  const columns = Object.keys(row);
  db.prepare(`INSERT INTO grades (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`)
    .run(...columns.map(column => row[column]));
  return row;
}

function recalculateSchool(db, schoolId = 1) {
  return db.prepare(RECALCULATE_SCHOOL_GRADES_SQL).run(schoolId, schoolId);
}

function readGrade(db, id = 1) {
  return db.prepare('SELECT * FROM grades WHERE id = ?').get(id);
}

function assertRawGradeValuesUnchanged(before, after) {
  for (const field of rawGradeColumns) assert.equal(after[field], before[field], field);
  assert.equal(after.notes, before.notes);
}

function assertSqlMatchesCalculator(row, settings) {
  const expected = calculateGrades(
    Object.fromEntries(rawGradeColumns.map(field => [field, row[field]])),
    settings,
  );
  for (const field of derivedGradeColumns) assert.equal(row[field], expected[field], field);
}

test('legacy settings normalize to the unchanged monthly/exam scheme', () => {
  assert.deepEqual(normalizeGradeSchemeSettings(thresholds), DEFAULT_GRADE_SCHEME_SETTINGS);
  assert.deepEqual(enabledRawGradeFields(thresholds), [
    'first_month', 'second_month', 'mid_year_exam', 'third_month', 'fourth_month', 'final_exam', 'completion_exam',
  ]);
});

test('monthly scheme requires both months and every enabled annual component', () => {
  const complete = calculateGrades({
    first_month: 70, second_month: 80, mid_year_exam: 80,
    third_month: 90, fourth_month: 100, final_exam: 60,
  }, thresholds);
  assert.equal(complete.first_term_average, 75);
  assert.equal(complete.second_term_average, 95);
  assert.equal(complete.annual_effort, 83);
  assert.equal(complete.final_grade, 72);
  assert.equal(complete.result_status, 'ناجح');

  const partial = calculateGrades({
    first_month: 70, second_month: null, mid_year_exam: 80,
    third_month: 90, fourth_month: 100, final_exam: 60,
  }, thresholds);
  assert.equal(partial.first_term_average, null);
  assert.equal(partial.annual_effort, null);
  assert.equal(partial.final_grade, null);
  assert.equal(partial.result_status, null);
});

test('canonical term outputs cover complete monthly, direct and disabled inputs exactly', () => {
  assert.equal(calculateGrades({ first_month: 80, second_month: 90 }, {
    ...thresholds, second_term_input_mode: 'disabled', mid_year_exam_enabled: 0, final_exam_enabled: 0,
  }).first_term_average, 85);
  assert.equal(calculateGrades({ first_term_grade: 87 }, {
    ...thresholds, first_term_input_mode: 'direct', second_term_input_mode: 'disabled', mid_year_exam_enabled: 0, final_exam_enabled: 0,
  }).first_term_average, 87);
  const disabled = calculateGrades({ first_term_grade: 99, first_month: 80, second_month: 90 }, {
    ...thresholds, first_term_input_mode: 'disabled', second_term_input_mode: 'disabled', mid_year_exam_enabled: 0, final_exam_enabled: 0,
  });
  assert.equal(disabled.first_term_average, null);
  assert.equal(disabled.annual_effort, null);
  assert.notEqual(disabled.first_term_average, 0);
});

test('direct and mixed schemes use only their selected inputs', () => {
  const direct = calculateGrades({ first_term_grade: 70, mid_year_exam: 80, second_term_grade: 90, final_exam: 60 }, {
    ...thresholds,
    first_term_input_mode: 'direct',
    second_term_input_mode: 'direct',
  });
  assert.equal(direct.first_term_average, 70);
  assert.equal(direct.second_term_average, 90);
  assert.equal(direct.annual_effort, 80);
  assert.equal(direct.final_grade, 70);

  const mixed = calculateGrades({ first_month: 70, second_month: 80, second_term_grade: 85, final_exam: 70 }, {
    ...thresholds,
    second_term_input_mode: 'direct',
    mid_year_exam_enabled: 0,
  });
  assert.equal(mixed.first_term_average, 75);
  assert.equal(mixed.second_term_average, 85);
  assert.equal(mixed.annual_effort, 80);
});

test('disabled components are excluded rather than treated as zero or missing', () => {
  const result = calculateGrades({ first_term_grade: 80 }, {
    ...thresholds,
    first_term_input_mode: 'direct',
    second_term_input_mode: 'disabled',
    mid_year_exam_enabled: 0,
    final_exam_enabled: 0,
    completion_exam_enabled: 0,
  });
  assert.equal(result.annual_effort, 80);
  assert.equal(result.final_grade, 80);
  assert.equal(result.effective_grade, 80);
  assert.equal(result.result_status, 'ناجح');
});

test('disabled final exam never grants exemption and annual effort becomes final grade', () => {
  const result = calculateGrades({ first_term_grade: 95 }, {
    ...thresholds,
    first_term_input_mode: 'direct',
    second_term_input_mode: 'disabled',
    mid_year_exam_enabled: 0,
    final_exam_enabled: 0,
    completion_exam_enabled: 0,
  });
  assert.equal(result.annual_effort, 95);
  assert.equal(result.exemption_status, 0);
  assert.equal(result.final_grade, 95);
  assert.equal(result.effective_grade, 95);
  assert.equal(result.result_status, 'ناجح');
});

test('set-based recalculation clears stale derived values when direct input is missing', () => {
  const db = createRecalculationDatabase();
  const settings = replaceSettings(db, {
    first_term_input_mode: 'direct',
    second_term_input_mode: 'disabled',
    mid_year_exam_enabled: 0,
    final_exam_enabled: 0,
    completion_exam_enabled: 0,
  });
  const before = insertGrade(db, { first_month: 80, second_month: 90 });

  const result = recalculateSchool(db);
  const after = readGrade(db);

  assert.equal(result.changes, 1);
  for (const field of derivedGradeColumns.slice(0, -1)) assert.equal(after[field], null, field);
  assert.equal(after.exemption_status, 0);
  assertRawGradeValuesUnchanged(before, after);
  assertSqlMatchesCalculator(after, settings);
  db.close();
});

test('set-based recalculation uses preserved hidden direct values after a scheme switch', () => {
  const db = createRecalculationDatabase();
  const settings = replaceSettings(db, {
    first_term_input_mode: 'direct',
    second_term_input_mode: 'disabled',
    mid_year_exam_enabled: 0,
    final_exam_enabled: 0,
    completion_exam_enabled: 0,
  });
  const before = insertGrade(db, {
    first_term_grade: 88,
    first_month: 10,
    second_month: 20,
  });

  recalculateSchool(db);
  const after = readGrade(db);

  assert.equal(after.first_term_average, 88);
  assert.equal(after.annual_effort, 88);
  assert.equal(after.final_grade, 88);
  assert.equal(after.exemption_status, 0);
  assertRawGradeValuesUnchanged(before, after);
  assertSqlMatchesCalculator(after, settings);
  db.close();
});

test('disabling second term preserves its raw months and recalculates enabled components only', () => {
  const db = createRecalculationDatabase();
  const settings = replaceSettings(db, {
    second_term_input_mode: 'disabled',
    final_exam_enabled: 0,
    completion_exam_enabled: 0,
  });
  const before = insertGrade(db, {
    first_month: 80,
    second_month: 90,
    mid_year_exam: 70,
    third_month: 20,
    fourth_month: 30,
  });

  recalculateSchool(db);
  const after = readGrade(db);

  assert.equal(after.first_term_average, 85);
  assert.equal(after.second_term_average, null);
  assert.equal(after.annual_effort, 78);
  assert.equal(after.final_grade, 78);
  assert.equal(after.third_month, 20);
  assert.equal(after.fourth_month, 30);
  assertRawGradeValuesUnchanged(before, after);
  assertSqlMatchesCalculator(after, settings);
  db.close();
});

test('changing the passing threshold immediately updates the stored result status', () => {
  const db = createRecalculationDatabase();
  const baseScheme = {
    first_term_input_mode: 'direct',
    second_term_input_mode: 'disabled',
    mid_year_exam_enabled: 0,
    final_exam_enabled: 0,
    completion_exam_enabled: 0,
  };
  insertGrade(db, { first_term_grade: 55 });

  let settings = replaceSettings(db, { ...baseScheme, passing_grade: 60 });
  recalculateSchool(db);
  let after = readGrade(db);
  assert.equal(after.result_status, 'راسب');
  assertSqlMatchesCalculator(after, settings);

  settings = replaceSettings(db, { ...baseScheme, passing_grade: 50 });
  recalculateSchool(db);
  after = readGrade(db);
  assert.equal(after.result_status, 'ناجح');
  assertSqlMatchesCalculator(after, settings);
  db.close();
});

test('changing the exemption threshold immediately updates exemption, final and status', () => {
  const db = createRecalculationDatabase();
  const baseScheme = {
    first_term_input_mode: 'direct',
    second_term_input_mode: 'disabled',
    mid_year_exam_enabled: 0,
    final_exam_enabled: 1,
    completion_exam_enabled: 0,
    passing_grade: 70,
  };
  const before = insertGrade(db, { first_term_grade: 90, final_exam: 30 });

  let settings = replaceSettings(db, { ...baseScheme, exemption_grade: 95 });
  recalculateSchool(db);
  let after = readGrade(db);
  assert.equal(after.exemption_status, 0);
  assert.equal(after.final_grade, 60);
  assert.equal(after.result_status, 'راسب');
  assertSqlMatchesCalculator(after, settings);

  settings = replaceSettings(db, { ...baseScheme, exemption_grade: 85 });
  recalculateSchool(db);
  after = readGrade(db);
  assert.equal(after.exemption_status, 1);
  assert.equal(after.final_grade, 90);
  assert.equal(after.result_status, 'ناجح');
  assertRawGradeValuesUnchanged(before, after);
  assertSqlMatchesCalculator(after, settings);
  db.close();
});

test('set-based recalculation is tenant-scoped and ignores inactive grades', () => {
  const db = createRecalculationDatabase();
  replaceSettings(db, {
    first_term_input_mode: 'direct', second_term_input_mode: 'disabled',
    mid_year_exam_enabled: 0, final_exam_enabled: 0, completion_exam_enabled: 0,
  });
  replaceSettings(db, {
    school_id: 2, first_term_input_mode: 'direct', second_term_input_mode: 'disabled',
    mid_year_exam_enabled: 0, final_exam_enabled: 0, completion_exam_enabled: 0,
  });
  insertGrade(db, { id: 1, school_id: 1, first_term_grade: 80 });
  insertGrade(db, { id: 2, school_id: 1, first_term_grade: 70, is_active: 0 });
  insertGrade(db, { id: 3, school_id: 2, first_term_grade: 60 });

  const result = recalculateSchool(db, 1);

  assert.equal(result.changes, 1);
  assert.equal(readGrade(db, 1).effective_grade, 80);
  assert.equal(readGrade(db, 2).effective_grade, 999);
  assert.equal(readGrade(db, 3).effective_grade, 999);
  db.close();
});

test('enabled final exam remains incomplete until entered for a non-exempt student', () => {
  const result = calculateGrades({ first_term_grade: 70, second_term_grade: 80 }, {
    ...thresholds,
    first_term_input_mode: 'direct', second_term_input_mode: 'direct', mid_year_exam_enabled: 0,
  });
  assert.equal(result.annual_effort, 75);
  assert.equal(result.final_grade, null);
  assert.equal(result.effective_grade, null);
  assert.equal(result.result_status, null);
});

test('exemption is explicit and permits an absent enabled final exam', () => {
  const result = calculateGrades({ first_term_grade: 92, second_term_grade: 90 }, {
    ...thresholds,
    first_term_input_mode: 'direct', second_term_input_mode: 'direct', mid_year_exam_enabled: 0,
  });
  assert.equal(result.annual_effort, 91);
  assert.equal(result.exemption_status, 1);
  assert.equal(result.final_grade, 91);
  assert.equal(result.effective_grade, 91);
  assert.equal(result.result_status, 'ناجح');
});

test('completion behavior distinguishes pending, disabled, passing and failing completion', () => {
  const inputs = { first_term_grade: 40, second_term_grade: 40, final_exam: 40 };
  const scheme = { ...thresholds, first_term_input_mode: 'direct', second_term_input_mode: 'direct', mid_year_exam_enabled: 0 };
  assert.equal(calculateGrades(inputs, scheme).result_status, 'مكمل');
  assert.equal(calculateGrades(inputs, { ...scheme, completion_exam_enabled: 0 }).result_status, 'راسب');
  assert.equal(calculateGrades({ ...inputs, completion_exam: 60 }, scheme).result_status, 'ناجح');
  assert.equal(calculateGrades({ ...inputs, completion_exam: 45 }, scheme).result_status, 'راسب');
});

test('verified direct-entry calculations remain unchanged for normal, zero-final and completion saves', () => {
  const scheme = {
    ...thresholds,
    first_term_input_mode: 'direct',
    second_term_input_mode: 'direct',
    mid_year_exam_enabled: 1,
    final_exam_enabled: 1,
    completion_exam_enabled: 1,
  };
  const annualInputs = { first_term_grade: 80, mid_year_exam: 93, second_term_grade: 70 };

  const normal = calculateGrades({ ...annualInputs, final_exam: 60 }, scheme);
  assert.equal(normal.annual_effort, 81);
  assert.equal(normal.final_grade, 71);
  assert.equal(normal.effective_grade, 71);
  assert.equal(normal.result_status, 'ناجح');

  const zeroFinal = calculateGrades({ ...annualInputs, final_exam: 0 }, scheme);
  assert.equal(zeroFinal.annual_effort, 81);
  assert.equal(zeroFinal.final_grade, 41);
  assert.equal(zeroFinal.effective_grade, 41);
  assert.equal(zeroFinal.result_status, 'مكمل');

  const completion = calculateGrades({ ...annualInputs, final_exam: 0, completion_exam: 60 }, scheme);
  assert.equal(completion.grade_after_completion, 60);
  assert.equal(completion.effective_grade, 60);
  assert.equal(completion.result_status, 'ناجح');
});

test('per-grade save queue serializes one row while different rows remain independent', async () => {
  const queue = createPerKeyTaskQueue();
  const events = [];
  let releaseFirst;
  let rows = [{ id: 1, value: 0 }, { id: 2, value: 0 }];

  const first = queue.enqueue(1, async () => {
    events.push('row-1:first:start');
    await new Promise(resolve => { releaseFirst = resolve; });
    rows = mergeUpdatedRow(rows, { id: 1, value: 1 });
    events.push('row-1:first:end');
  });
  await Promise.resolve();

  const second = queue.enqueue(1, async () => {
    events.push('row-1:second:start');
    rows = mergeUpdatedRow(rows, { id: 1, value: 2 });
    events.push('row-1:second:end');
  });
  const otherRow = queue.enqueue(2, async () => {
    events.push('row-2:start');
    rows = mergeUpdatedRow(rows, { id: 2, value: 9 });
    events.push('row-2:end');
  });

  await otherRow;
  assert.equal(rows.find(row => row.id === 2).value, 9);
  assert.equal(events.includes('row-1:second:start'), false);
  assert.equal(queue.hasPending(1), true);

  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(events.filter(event => event.startsWith('row-1')), [
    'row-1:first:start', 'row-1:first:end', 'row-1:second:start', 'row-1:second:end',
  ]);
  assert.equal(rows.find(row => row.id === 1).value, 2);
  assert.equal(queue.hasPending(1), false);
});

test('grade response merging updates one row and preserves joined display fields', () => {
  const original = [
    { id: 1, subject_name: 'الرياضيات', annual_effort: 70, result_status: 'مكمل' },
    { id: 2, subject_name: 'العربية', annual_effort: 80, result_status: 'ناجح' },
  ];
  const merged = mergeUpdatedRow(original, {
    id: 1,
    annual_effort: 85,
    result_status: 'ناجح',
  });

  assert.equal(merged[0].subject_name, 'الرياضيات');
  assert.equal(merged[0].annual_effort, 85);
  assert.equal(merged[0].result_status, 'ناجح');
  assert.equal(merged[1], original[1]);
  assert.equal(original[0].annual_effort, 70);
});

test('scheme validation and descriptors expose only editable enabled raw fields', () => {
  assert.equal(validateGradeSchemeSettings({ first_term_input_mode: 'quarterly' }), 'first_term_input_mode يجب أن يكون monthly أو direct أو disabled');
  assert.equal(validateGradeSchemeSettings({ final_exam_enabled: 2 }), 'final_exam_enabled يجب أن يكون 0 أو 1');
  assert.equal(validateGradeSchemeSettings({ final_exam_enabled: true }), 'final_exam_enabled يجب أن يكون 0 أو 1');
  assert.equal(validateGradeSchemeSettings({ first_term_input_mode: 'direct', final_exam_enabled: 0 }), null);
  const columns = gradeInputColumns({
    first_term_input_mode: 'direct', second_term_input_mode: 'disabled',
    mid_year_exam_enabled: 0, final_exam_enabled: 0, completion_exam_enabled: 1,
  });
  assert.deepEqual(columns.map(column => column.key), ['first_term_grade', 'completion_exam']);
  assert.ok(columns.every(column => column.editable));
});

test('disabled raw grade writes are identified without clearing hidden values', () => {
  const scheme = {
    first_term_input_mode: 'direct', second_term_input_mode: 'disabled',
    mid_year_exam_enabled: 0, final_exam_enabled: 1, completion_exam_enabled: 0,
  };
  assert.deepEqual(disabledRawGradeFields({ first_month: 70, first_term_grade: 80, completion_exam: null }, scheme), [
    'first_month', 'completion_exam',
  ]);
  assert.deepEqual(disabledRawGradeFields({ first_term_grade: 80, final_exam: 70 }, scheme), []);
});

test('Smart Excel maps direct term headers to direct fields and month headers to month fields', () => {
  const headers = ['Student ID', 'Student Name', 'First Term', 'First Month', 'Second Term', 'Third Month', 'Final Exam'];
  const rows = Array.from({ length: 8 }, (_, index) => [`ID/${index}`, `Student ${index}`, 70, 71, 80, 81, 82]);
  const analysis = analyzeWorksheet('Grades', [headers, ...rows]);
  const mapping = gradeMappingFromAnalysis(analysis);
  assert.equal(mapping.first_term_grade, 'column:2');
  assert.equal(mapping.first_month, 'column:3');
  assert.equal(mapping.second_term_grade, 'column:4');
  assert.equal(mapping.third_month, 'column:5');
  assert.equal(mapping.final_exam, 'column:6');
});

test('Smart Excel keeps the exact Arabic direct-term and numbered month meanings distinct', () => {
  const headers = ['رقم الطالب', 'اسم الطالب', 'درجة الفصل الأول', 'الشهر 1', 'درجة الفصل الثاني', 'الشهر 3'];
  const rows = Array.from({ length: 8 }, (_, index) => [`ID/${index}`, `طالب ${index}`, 70, 71, 80, 81]);
  const mapping = gradeMappingFromAnalysis(analyzeWorksheet('درجات', [headers, ...rows]));
  assert.equal(mapping.first_term_grade, 'column:2');
  assert.equal(mapping.first_month, 'column:3');
  assert.equal(mapping.second_term_grade, 'column:4');
  assert.equal(mapping.third_month, 'column:5');
});

test('Smart Excel preview rejects a mapped field disabled by the school scheme', () => {
  const context = {
    schoolId: 1,
    settings: { ...thresholds, first_term_input_mode: 'direct' },
    students: [{ id: 1, school_id: 1, student_number: '1', full_name: 'طالب', class_id: 10, section_id: 20 }],
    subjects: [{ id: 100, school_id: 1, name: 'رياضيات', class_id: 10, section_id: null, status: 'active' }],
    assignments: [{ id: 500, school_id: 1, student_id: 1, subject_id: 100, class_id: 10, section_id: 20, is_active: 1 }],
    grades: [],
    classes: [{ id: 10, school_id: 1, name: 'الأول', status: 'active' }],
    sections: [{ id: 20, school_id: 1, class_id: 10, name: 'أ', status: 'active' }],
  };
  const plan = buildGradeImportPlan({ grade_sources: [{
    source_id: 'sheet:1', sheet_name: 'رياضيات', subject_source: 'fixed', subject_id: 100,
    mapping: { student_number: 'column:0', first_month: 'column:1' },
    rows: [{ _excel_row_number: 2, 'column:0': '1', 'column:1': 75 }],
  }] }, context);
  assert.ok(plan.errors.some(issue => issue.field === 'first_month' && issue.message.includes('غير مفعّل')));
  assert.equal(plan.records.length, 0);
});

test('migration adds nullable direct inputs and constrained legacy-default settings without backfill', async () => {
  const migration = await readFile(new URL('../migrations/0018_flexible_grade_scheme.sql', import.meta.url), 'utf8');
  assert.match(migration, /ALTER TABLE grades ADD COLUMN first_term_grade REAL/);
  assert.match(migration, /ALTER TABLE grades ADD COLUMN second_term_grade REAL/);
  assert.match(migration, /first_term_input_mode TEXT NOT NULL DEFAULT 'monthly'[\s\S]*?CHECK \(first_term_input_mode IN \('monthly', 'direct', 'disabled'\)\)/);
  assert.match(migration, /second_term_input_mode TEXT NOT NULL DEFAULT 'monthly'/);
  for (const field of ['mid_year_exam_enabled', 'final_exam_enabled', 'completion_exam_enabled']) {
    assert.match(migration, new RegExp(`${field} INTEGER NOT NULL DEFAULT 1`));
  }
  assert.doesNotMatch(migration, /\bUPDATE\b/i);
});

test('backend routes keep school-management RBAC, tenancy and centralized disabled-field validation', async () => {
  for (const role of ['system_admin', 'school_owner', 'principal', 'vice_principal']) {
    assert.equal(hasRole(role, SCHOOL_MANAGEMENT_ROLES), true, role);
  }
  for (const role of ['teacher', 'registrar', 'accountant']) assert.equal(hasRole(role, SCHOOL_MANAGEMENT_ROLES), false, role);
  const worker = await readFile(new URL('../src/worker.ts', import.meta.url), 'utf8');
  assert.match(worker, /app\.put\('\/api\/grade-settings',[\s\S]*?requireRoles\(SCHOOL_MANAGEMENT_ROLES\)/);
  assert.match(worker, /resolveActiveWriteSchool\(db, user, school_id\)/);
  assert.match(worker, /db\.batch\(\[settingsStatement, recalculationStatement\]\)/);
  assert.match(worker, /meta: \{ recalculated_grades: recalculatedGrades \}/);
  assert.match(worker, /disabledRawGradeFields\(payload, settings\)/);
  assert.match(worker, /const auditFields: Array<RawGradeField \| 'notes'> = \[\.\.\.RAW_GRADE_FIELDS, 'notes'\]/);
});

test('single-grade PUT recalculates and returns the complete tenant-scoped row with auditing', async () => {
  const worker = await readFile(new URL('../src/worker.ts', import.meta.url), 'utf8');
  const routeStart = worker.indexOf("app.put('/api/grades/:id'");
  const routeEnd = worker.indexOf("app.post('/api/grades/bulk-entry'", routeStart);
  const route = worker.slice(routeStart, routeEnd);

  assert.ok(routeStart >= 0 && routeEnd > routeStart);
  assert.match(route, /requireRoles\(GRADE_MANAGEMENT_ROLES\)/);
  assert.match(route, /resolveActiveWriteSchool\(db, user, body\.school_id\)/);
  assert.match(route, /gradeRow\.school_id !== targetSchool\.schoolId/);
  assert.match(route, /buildRawGradeUpdates\(body, settings\)/);
  assert.match(route, /calculateGrades\(calcInput, settings\)/);
  for (const field of [
    'first_term_average', 'second_term_average', 'annual_effort', 'final_grade',
    'grade_after_completion', 'effective_grade', 'result_status', 'exemption_status',
  ]) {
    assert.match(route, new RegExp(`updates\\.${field} = derived\\.${field}`), field);
  }
  assert.match(route, /INSERT INTO grade_change_logs/);
  assert.match(route, /SELECT \* FROM grades WHERE id = \? AND school_id = \?/);
  assert.match(route, /return c\.json\(\{ data: updated \}\)/);
});

test('student-grade autosave patches the returned row without a full-list refetch', async () => {
  const page = await readFile(new URL('../src/modules/grades/GradesPage.tsx', import.meta.url), 'utf8');
  const handlerStart = page.indexOf('async function handleSaveGrade');
  const handlerEnd = page.indexOf('function fieldNameArabic', handlerStart);
  const handler = page.slice(handlerStart, handlerEnd);

  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart);
  assert.match(handler, /gradeSaveQueue\.enqueue\(grade\.id/);
  assert.match(handler, /updateGrade\(grade\.id, payload, schoolId\)/);
  assert.match(handler, /setGrades\(\(current\) => mergeUpdatedRow\(current, updated\)\)/);
  assert.doesNotMatch(handler, /loadStudentGrades/);
  assert.doesNotMatch(handler, /type: 'success'/);
});

test('grade-settings reads always require exactly one authorized school scope', async () => {
  const worker = await readFile(new URL('../src/worker.ts', import.meta.url), 'utf8');
  const routeStart = worker.indexOf("app.get('/api/grade-settings'");
  const routeEnd = worker.indexOf("app.put('/api/grade-settings'", routeStart);
  const route = worker.slice(routeStart, routeEnd);

  assert.ok(routeStart >= 0 && routeEnd > routeStart);
  assert.match(route, /scope !== 'single' \|\| !resolvedSchoolId/);
  assert.match(route, /يجب تحديد المدرسة المستهدفة لعرض إعدادات الدرجات/);
  assert.match(route, /SELECT \* FROM grade_settings WHERE school_id = \?/);
  assert.doesNotMatch(route, /SELECT \* FROM grade_settings ORDER BY school_id/);
});

test('grade-settings recalculation stays one tenant-scoped set-based statement', () => {
  assert.equal((RECALCULATE_SCHOOL_GRADES_SQL.match(/UPDATE grades AS g/g) || []).length, 1);
  assert.match(RECALCULATE_SCHOOL_GRADES_SQL, /WHERE g\.school_id = \? AND g\.is_active = 1/);
  assert.match(RECALCULATE_SCHOOL_GRADES_SQL, /g\.id = calculated\.id AND g\.school_id = \? AND g\.is_active = 1/);
  assert.doesNotMatch(RECALCULATE_SCHOOL_GRADES_SQL, /\bDELETE\b|first_month\s*=|notes\s*=/i);
});

test('student and section grade UIs share scheme-driven descriptors', async () => {
  const page = await readFile(new URL('../src/modules/grades/GradesPage.tsx', import.meta.url), 'utf8');
  assert.match(page, /const inputColumns = useMemo\(\(\) => settings \? gradeInputColumns\(settings\)/);
  assert.match(page, /const editableFields = useMemo\(\(\) => settings \? gradeInputColumns\(settings\)\.filter/);
  assert.match(page, /نظام إدخال الدرجات/);
  assert.match(page, /gradeSchemeSummary\(form\)/);
});
