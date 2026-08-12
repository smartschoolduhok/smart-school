import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  analyzeWorksheet,
  classifyWorksheet,
  confidenceLevel,
  detectHeaderRow,
  detectHeaderRowAt,
  fieldSourceIdentity,
  matchSectionByName,
  normalizeSectionName,
  sheetRowsToRecords,
} from '../src/lib/excelImport.ts';
import {
  buildGeneratedStudentNumber,
  findStudentDuplicate,
  studentDuplicateAction,
  validateStudentImportPlacement,
} from '../src/lib/studentImport.ts';

const arabicHeaders = ['رقم الطالب', 'اسم الطالب', 'الصف', 'الشعبة'];

test('detects headers on Excel rows 1, 2, and 3', () => {
  assert.equal(detectHeaderRow([arabicHeaders, ['1', 'طالب تجريبي']]).headerRowNumber, 1);
  assert.equal(detectHeaderRow([['قائمة طلاب'], arabicHeaders, ['1', 'طالب تجريبي']]).headerRowNumber, 2);
  assert.equal(detectHeaderRow([['مدرسة تجريبية'], ['قائمة الطلاب'], arabicHeaders, ['1', 'طالب تجريبي']]).headerRowNumber, 3);
});

test('scans title rows and finds an Arabic header within the first 20 non-empty rows', () => {
  const rows = Array.from({ length: 12 }, (_, index) => [`عنوان ${index + 1}`]);
  rows.push(arabicHeaders, ['1', 'طالب تجريبي', 'الأول', 'أ']);
  const result = detectHeaderRow(rows);
  assert.equal(result.headerRowNumber, 13);
  assert.equal(result.confidence, 'high');
});

test('manual header override recalculates columns and Excel row numbers', () => {
  const rows = [['عنوان'], ['رمز خاص', 'اسم خاص'], ['7', 'طالب تجريبي']];
  const detection = detectHeaderRowAt(rows, 1);
  assert.deepEqual(detection.columnNames, ['رمز خاص', 'اسم خاص']);
  assert.deepEqual(sheetRowsToRecords(rows, 1), [{ _excel_row_number: 3, 'column:0': '7', 'column:1': 'طالب تجريبي' }]);
});

test('classifies student, grade, summary, and unknown worksheets using name and content', () => {
  assert.equal(classifyWorksheet('إدخال الأسماء', [arabicHeaders]), 'students');
  assert.equal(classifyWorksheet('الرياضيات', [['اسم الطالب', 'نصف السنة', 'النهائي']]), 'grade_sheet');
  assert.equal(classifyWorksheet('النتيجة النهائية', [['الاسم', 'المعدل']]), 'summary');
  assert.equal(classifyWorksheet('ملاحظات', [['الوصف', 'القيمة']]), 'unknown');
});

test('analyzes every worksheet without assuming the first row is the header', () => {
  const analysis = analyzeWorksheet('Students', [['Student roster'], ['Student Number', 'Student Name', 'Class', 'Section']]);
  assert.equal(analysis.category, 'students');
  assert.equal(analysis.headerRowNumber, 2);
});

test('detects the real-world student table while preserving a meaningful blank-header column', () => {
  const rows = [
    ['اسماء الطلاب', '', 'الصف الاول المتوسط', ''],
    ['ت', 'اسم الطالب', '', 'القيد'],
    [1, 'طالب تجريبي 1', 'ا', '5/001'],
    [2, 'طالب تجريبي 2', 'ب', '5/002'],
  ];
  const analysis = analyzeWorksheet('ادخال الاسماء', rows, { fileName: 'طلاب.xlsx' });
  const table = analysis.tables[0];
  const inference = Object.fromEntries(table.fieldInferences.map(item => [item.field, item]));

  assert.equal(analysis.category, 'students');
  assert.equal(analysis.headerRowNumber, 2);
  assert.deepEqual(table.region, {
    startRow: 1,
    endRow: 3,
    startColumn: 0,
    endColumn: 3,
    dataStartRow: 2,
    rowCount: 2,
    confidence: 0.88,
  });
  assert.equal(table.columns[2].key, 'column:2');
  assert.equal(table.columns[2].headerText, null);
  assert.equal(table.columns[2].displayName, 'عمود C (بدون عنوان)');
  assert.equal(inference.full_name.source.columnIndex, 1);
  assert.equal(inference.student_number.source.columnIndex, 3);
  assert.equal(inference.section_name.source.columnIndex, 2);
  assert.ok(inference.section_name.confidence >= 0.9);
  assert.equal(inference.class_name.source.type, 'metadata-cell');
  assert.equal(inference.class_name.source.value, 'الاول المتوسط');
  assert.ok(inference.student_number.alternatives.find(candidate => candidate.source.type === 'column' && candidate.source.columnIndex === 0).confidence < 0.4);
});

test('infers student fields from content when no reliable header exists', () => {
  const analysis = analyzeWorksheet('بيانات', [
    ['طالب تجريبي 1', '5/001', 'ا'],
    ['طالب تجريبي 2', '5/002', 'ب'],
  ]);
  const inference = Object.fromEntries(analysis.tables[0].fieldInferences.map(item => [item.field, item]));
  assert.equal(analysis.headerRowIndex, null);
  assert.equal(analysis.category, 'students');
  assert.equal(inference.full_name.source.columnIndex, 0);
  assert.ok(inference.full_name.confidence >= 0.7);
  assert.equal(inference.student_number.source.columnIndex, 1);
  assert.ok(inference.student_number.confidence >= 0.6);
  assert.equal(inference.section_name.source.columnIndex, 2);
  assert.ok(inference.section_name.confidence >= 0.9);
});

test('semantic inference follows reordered columns instead of fixed positions', () => {
  const analysis = analyzeWorksheet('Students', [
    ['القيد', 'الشعبة', 'الاسم'],
    ['5/001', 'ا', 'طالب تجريبي 1'],
    ['5/002', 'ب', 'طالب تجريبي 2'],
  ]);
  const inference = Object.fromEntries(analysis.tables[0].fieldInferences.map(item => [item.field, item]));
  assert.equal(inference.student_number.source.columnIndex, 0);
  assert.equal(inference.section_name.source.columnIndex, 1);
  assert.equal(inference.full_name.source.columnIndex, 2);
});

test('supports English student headers', () => {
  const analysis = analyzeWorksheet('Students', [
    ['Student ID', 'Student Name', 'Section'],
    ['S-101', 'Test Student One', 'A'],
    ['S-102', 'Test Student Two', 'B'],
  ]);
  const inference = Object.fromEntries(analysis.tables[0].fieldInferences.map(item => [item.field, item]));
  assert.equal(inference.student_number.source.columnIndex, 0);
  assert.equal(inference.full_name.source.columnIndex, 1);
  assert.equal(inference.section_name.source.columnIndex, 2);
});

test('does not hallucinate a section when the sheet has none', () => {
  const analysis = analyzeWorksheet('Students', [
    ['اسم الطالب', 'القيد'],
    ['طالب تجريبي 1', '5/001'],
    ['طالب تجريبي 2', '5/002'],
  ]);
  const section = analysis.tables[0].fieldInferences.find(item => item.field === 'section_name');
  assert.ok(section.confidence < 0.7);
});

test('recognizes repeated numeric section categories without treating them as a row sequence', () => {
  const analysis = analyzeWorksheet('Students', [
    ['الاسم', ''],
    ['طالب تجريبي 1', 1],
    ['طالب تجريبي 2', 1],
    ['طالب تجريبي 3', 2],
    ['طالب تجريبي 4', 2],
  ]);
  const section = analysis.tables[0].fieldInferences.find(item => item.field === 'section_name');
  assert.equal(section.source.columnIndex, 1);
  assert.ok(section.confidence >= 0.7);
});

test('penalizes row sequences and profiles grade-like numeric columns without importing grades', () => {
  const analysis = analyzeWorksheet('درجات', [
    ['الاسم', 'رقم', 'نصف السنة'],
    ['طالب تجريبي 1', 1, 85],
    ['طالب تجريبي 2', 2, 90],
  ]);
  const table = analysis.tables[0];
  const number = table.fieldInferences.find(item => item.field === 'student_number');
  const section = table.fieldInferences.find(item => item.field === 'section_name');
  assert.equal(analysis.category, 'grade_sheet');
  assert.equal(table.columns[1].sequentialIntegerRatio, 1);
  assert.equal(table.columns[2].numericRatio, 1);
  assert.ok(number.confidence < 0.7);
  assert.ok(section.confidence < 0.7);
});

test('stops the dominant table before a separated trailing summary', () => {
  const analysis = analyzeWorksheet('Students', [
    ['قائمة الطلاب'],
    ['القيد', 'اسم الطالب', 'الشعبة'],
    ['5/001', 'طالب تجريبي 1', 'ا'],
    ['5/002', 'طالب تجريبي 2', 'ب'],
    [],
    ['المجموع', 2],
  ]);
  assert.equal(analysis.tables[0].region.startRow, 1);
  assert.equal(analysis.tables[0].region.endRow, 3);
  assert.equal(analysis.tables[0].region.rowCount, 2);
});

test('uses explicit confidence bands', () => {
  assert.equal(confidenceLevel(0.9), 'high');
  assert.equal(confidenceLevel(0.7), 'medium');
  assert.equal(confidenceLevel(0.699), 'low');
});

test('field sources have stable serializable identities for user overrides and future profiles', () => {
  const sources = [
    { type: 'column', columnIndex: 2, columnKey: 'column:2' },
    { type: 'metadata-cell', row: 0, column: 2, value: 'الاول المتوسط' },
    { type: 'sheet-name', value: 'الاول المتوسط' },
    { type: 'file-name', value: 'طلاب الاول' },
    { type: 'constant', value: 'الاول المتوسط' },
    { type: 'system-selection', id: 7 },
    { type: 'ignore' },
  ];
  assert.deepEqual(sources.map(fieldSourceIdentity), [
    'column:2',
    'metadata:0:2',
    'sheet-name',
    'file-name',
    'constant',
    'system-selection',
    'ignore',
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(sources)), sources);
});

test('normalizes common Arabic and Latin section spellings', () => {
  assert.equal(normalizeSectionName('الشعبة أ'), 'ا');
  assert.equal(normalizeSectionName('Section A'), 'ا');
  assert.equal(normalizeSectionName('1'), 'ا');
  assert.equal(matchSectionByName('شعبة ب', [{ id: 1, name: 'B' }])?.id, 1);
});

test('generated optional student numbers are deterministic and scoped by school and placement', async () => {
  const first = await buildGeneratedStudentNumber(1, 'طالب تجريبي', 10, 20);
  assert.match(first, /^AUTO-[0-9A-F]{24}$/);
  assert.equal(first, await buildGeneratedStudentNumber(1, 'طالب تجريبي', 10, 20));
  assert.notEqual(first, await buildGeneratedStudentNumber(2, 'طالب تجريبي', 10, 20));
});

test('detects duplicates by number or by normalized name and placement', () => {
  const students = [{ id: 1, student_number: 'S-1', full_name: 'طالب تجريبي', class_id: 10, section_id: 20 }];
  assert.equal(findStudentDuplicate({ studentNumber: 'S-1', fullName: 'اسم آخر', classId: 10, sectionId: 20 }, students).kind, 'match');
  assert.equal(findStudentDuplicate({ studentNumber: null, fullName: '  طالب   تجريبي ', classId: 10, sectionId: 20 }, students).kind, 'match');
});

test('rejects ambiguous name-only duplicates', () => {
  const students = [1, 2].map(id => ({ id, student_number: `S-${id}`, full_name: 'طالب تجريبي', class_id: 10, section_id: 20 }));
  assert.equal(findStudentDuplicate({ studentNumber: null, fullName: 'طالب تجريبي', classId: 10, sectionId: 20 }, students).kind, 'ambiguous');
});

test('duplicate modes remain explicit and safe', () => {
  assert.equal(studentDuplicateAction('skip_existing', true), 'skip');
  assert.equal(studentDuplicateAction('update_existing', true), 'update');
  assert.equal(studentDuplicateAction('error_on_existing', true), 'error');
  assert.equal(studentDuplicateAction('update_existing', false), 'insert');
});

test('placement validation rejects cross-school class and section records', () => {
  const foreignClass = validateStudentImportPlacement(1, 10, null, { id: 10, school_id: 2, name: 'الأول', status: 'active' }, null);
  assert.deepEqual(foreignClass, { ok: false, status: 403, error: 'الصف المحدد ينتمي إلى مدرسة أخرى' });
  const foreignSection = validateStudentImportPlacement(
    1,
    10,
    20,
    { id: 10, school_id: 1, name: 'الأول', status: 'active' },
    { id: 20, school_id: 2, class_id: 10, name: 'أ', status: 'active' },
  );
  assert.equal(foreignSection.ok, false);
  assert.equal(foreignSection.status, 403);
});

test('placement validation rejects archived records and a section from the wrong class', () => {
  const archived = validateStudentImportPlacement(1, 10, null, { id: 10, school_id: 1, name: 'الأول', status: 'archived' }, null);
  assert.equal(archived.ok, false);
  const mismatch = validateStudentImportPlacement(
    1,
    10,
    20,
    { id: 10, school_id: 1, name: 'الأول', status: 'active' },
    { id: 20, school_id: 1, class_id: 11, name: 'أ', status: 'active' },
  );
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.status, 400);
});

test('student preview performs no database write and confirm keeps tenant-scoped writes', async () => {
  const source = await readFile(new URL('../src/worker.ts', import.meta.url), 'utf8');
  const preview = source.slice(source.indexOf("app.post('/api/import-export/:type/preview'"), source.indexOf("app.post('/api/import-export/:type/confirm'"));
  assert.doesNotMatch(preview, /\b(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+)?(?:students|import_jobs)\b/i);
  const confirm = source.slice(source.indexOf("app.post('/api/import-export/:type/confirm'"), source.indexOf("app.get('/api/import-export/:type/export'"));
  assert.match(confirm, /UPDATE students[\s\S]*WHERE id = \? AND school_id = \?/);
  assert.match(confirm, /INSERT INTO students \(school_id,/);
});
