import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  analyzeWorksheet,
  classifyWorksheet,
  detectHeaderRow,
  detectHeaderRowAt,
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
  assert.deepEqual(sheetRowsToRecords(rows, 1), [{ _excel_row_number: 3, 'رمز خاص': '7', 'اسم خاص': 'طالب تجريبي' }]);
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
