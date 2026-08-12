export type ExcelCell = string | number | boolean | null | undefined;
export type WorksheetRows = ExcelCell[][];
export type WorksheetCategory = 'students' | 'grade_sheet' | 'summary' | 'unknown';

export interface HeaderDetection {
  headerRowIndex: number;
  headerRowNumber: number;
  columnNames: string[];
  score: number;
  confidence: 'high' | 'medium' | 'low';
}

export interface WorksheetAnalysis extends HeaderDetection {
  name: string;
  category: WorksheetCategory;
  rowCount: number;
}

const STUDENT_HEADER_ALIASES = [
  'الاسم', 'اسم الطالب', 'اسم الطالبة', 'الطالب', 'القيد', 'رقم الطالب', 'الرقم',
  'الشعبة', 'الصف', 'المرحلة', 'student', 'student name', 'name', 'student number',
  'student no', 'student id', 'section', 'class',
];

const STUDENT_NAME_ALIASES = [
  'الاسم', 'اسم الطالب', 'اسم الطالبة', 'الطالب', 'student', 'student name', 'name',
];

const GRADE_HEADER_ALIASES = [
  'الفصل الأول', 'الفصل الاول', 'نصف السنة', 'الفصل الثاني', 'السعي', 'النهاية',
  'النهائي', 'الدرجة', 'المعدل', 'final', 'mid year', 'mid-year', 'exam', 'grade',
];

const STUDENT_SHEET_ALIASES = [
  'ادخال الاسماء', 'إدخال الأسماء', 'الاسماء', 'الأسماء', 'الطلاب', 'اسماء الطلاب',
  'أسماء الطلاب', 'students', 'student names',
];

const SUMMARY_SHEET_ALIASES = [
  'ملخص', 'النتيجة النهائية', 'نصف السنة', 'القرار', 'كنترول', 'تدقيق', 'نتيجة',
  'summary', 'control', 'report', 'result', 'final result',
];

const SUBJECT_SHEET_ALIASES = [
  'فيزياء', 'الفيزياء', 'كيمياء', 'الكيمياء', 'احياء', 'أحياء', 'الاحياء', 'العربية',
  'عربي', 'الانكليزية', 'الإنكليزية', 'انكليزي', 'رياضيات', 'الرياضيات', 'علوم',
  'العلوم', 'اجتماعيات', 'الاجتماعيات', 'حاسوب', 'الحاسوب', 'اسلامية', 'الإسلامية',
  'physics', 'chemistry', 'biology', 'arabic', 'english', 'mathematics', 'math', 'science',
];

export function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[\u064b-\u065f\u0670]/g, '')
    .replace(/ـ/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[_\-–—/\\()[\]{}:؛،,.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizedAliases(values: string[]): string[] {
  return values.map(normalizeHeader);
}

const NORMALIZED_STUDENT_HEADERS = normalizedAliases(STUDENT_HEADER_ALIASES);
const NORMALIZED_STUDENT_NAMES = normalizedAliases(STUDENT_NAME_ALIASES);
const NORMALIZED_GRADE_HEADERS = normalizedAliases(GRADE_HEADER_ALIASES);
const NORMALIZED_STUDENT_SHEETS = normalizedAliases(STUDENT_SHEET_ALIASES);
const NORMALIZED_SUMMARY_SHEETS = normalizedAliases(SUMMARY_SHEET_ALIASES);
const NORMALIZED_SUBJECT_SHEETS = normalizedAliases(SUBJECT_SHEET_ALIASES);

function aliasMatch(value: string, aliases: string[]): boolean {
  return aliases.some(alias => value === alias || (alias.length > 3 && value.includes(alias)));
}

function scoreHeaderRow(row: ExcelCell[]): number {
  const values = row.map(normalizeHeader).filter(Boolean);
  if (values.length === 0) return -1;

  let score = Math.min(values.length, 8) * 0.25;
  let recognized = 0;
  for (const value of values) {
    if (aliasMatch(value, NORMALIZED_STUDENT_HEADERS)) {
      score += aliasMatch(value, NORMALIZED_STUDENT_NAMES) ? 4 : 3;
      recognized += 1;
    }
    if (aliasMatch(value, NORMALIZED_GRADE_HEADERS)) {
      score += 2.5;
      recognized += 1;
    }
  }
  if (recognized >= 2) score += 2;
  if (values.length === 1) score -= 1;
  return score;
}

export function extractHeaders(row: ExcelCell[]): string[] {
  const counts = new Map<string, number>();
  return row.map(cell => {
    const header = String(cell ?? '').trim();
    if (!header) return '';
    const count = (counts.get(header) || 0) + 1;
    counts.set(header, count);
    return count === 1 ? header : `${header} (${count})`;
  });
}

export function detectHeaderRow(rows: WorksheetRows, maxNonEmptyRows = 20): HeaderDetection {
  let bestIndex = 0;
  let bestScore = -1;
  let nonEmptyRows = 0;

  for (let index = 0; index < rows.length && nonEmptyRows < maxNonEmptyRows; index += 1) {
    const row = rows[index] || [];
    if (!row.some(cell => normalizeHeader(cell))) continue;
    nonEmptyRows += 1;
    const score = scoreHeaderRow(row);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  const columnNames = extractHeaders(rows[bestIndex] || []).filter(Boolean);
  return {
    headerRowIndex: bestIndex,
    headerRowNumber: bestIndex + 1,
    columnNames,
    score: Math.max(0, Number(bestScore.toFixed(2))),
    confidence: bestScore >= 9 ? 'high' : bestScore >= 5 ? 'medium' : 'low',
  };
}

export function detectHeaderRowAt(rows: WorksheetRows, headerRowIndex: number): HeaderDetection {
  const boundedIndex = Math.max(0, Math.min(Math.trunc(headerRowIndex), Math.max(0, rows.length - 1)));
  const score = Math.max(0, scoreHeaderRow(rows[boundedIndex] || []));
  return {
    headerRowIndex: boundedIndex,
    headerRowNumber: boundedIndex + 1,
    columnNames: extractHeaders(rows[boundedIndex] || []).filter(Boolean),
    score: Number(score.toFixed(2)),
    confidence: score >= 9 ? 'high' : score >= 5 ? 'medium' : 'low',
  };
}

export function classifyWorksheet(
  name: string,
  rows: WorksheetRows,
  detection = detectHeaderRow(rows),
): WorksheetCategory {
  const normalizedName = normalizeHeader(name);
  const headers = detection.columnNames.map(normalizeHeader).filter(Boolean);
  const studentSignals = headers.filter(header => aliasMatch(header, NORMALIZED_STUDENT_HEADERS)).length;
  const studentNameSignals = headers.filter(header => aliasMatch(header, NORMALIZED_STUDENT_NAMES)).length;
  const gradeSignals = headers.filter(header => aliasMatch(header, NORMALIZED_GRADE_HEADERS)).length;

  if (aliasMatch(normalizedName, NORMALIZED_SUMMARY_SHEETS)) return 'summary';
  if (gradeSignals >= 2 || (gradeSignals >= 1 && aliasMatch(normalizedName, NORMALIZED_SUBJECT_SHEETS))) {
    return 'grade_sheet';
  }
  if (studentNameSignals >= 1 && studentSignals >= 2) return 'students';
  if (aliasMatch(normalizedName, NORMALIZED_STUDENT_SHEETS) && studentNameSignals >= 1) return 'students';
  if (aliasMatch(normalizedName, NORMALIZED_SUBJECT_SHEETS)) return 'grade_sheet';
  return 'unknown';
}

export function analyzeWorksheet(name: string, rows: WorksheetRows): WorksheetAnalysis {
  const detection = detectHeaderRow(rows);
  return {
    ...detection,
    name,
    category: classifyWorksheet(name, rows, detection),
    rowCount: Math.max(0, rows.length - detection.headerRowIndex - 1),
  };
}

export interface SheetRecord extends Record<string, unknown> {
  _excel_row_number: number;
}

export function sheetRowsToRecords(rows: WorksheetRows, headerRowIndex: number): SheetRecord[] {
  const headersWithGaps = extractHeaders(rows[headerRowIndex] || []);
  return rows.slice(headerRowIndex + 1).map((row, offset) => {
    const record: SheetRecord = { _excel_row_number: headerRowIndex + offset + 2 };
    headersWithGaps.forEach((header, columnIndex) => {
      if (header) record[header] = row?.[columnIndex] ?? '';
    });
    return record;
  });
}

export function buildMappedRows(
  records: SheetRecord[],
  mapping: Record<string, string>,
): Array<Record<string, unknown>> {
  return records.map(record => {
    const mapped: Record<string, unknown> = { excel_row_number: record._excel_row_number };
    for (const [field, column] of Object.entries(mapping)) {
      if (column) mapped[field] = record[column] ?? null;
    }
    return mapped;
  });
}

export function normalizeSectionName(value: unknown): string {
  const normalized = normalizeHeader(value)
    .replace(/^(الشعبه|شعبه|section)\s*/u, '')
    .replace(/\s+/g, '');
  const simpleSections: Record<string, string> = {
    a: 'ا', '1': 'ا', ا: 'ا',
    b: 'ب', '2': 'ب', ب: 'ب',
    c: 'ج', '3': 'ج', ج: 'ج',
    d: 'د', '4': 'د', د: 'د',
  };
  return simpleSections[normalized] || normalized;
}

export function matchSectionByName<T extends { name: unknown }>(value: unknown, sections: T[]): T | null {
  const normalized = normalizeSectionName(value);
  if (!normalized) return null;
  return sections.find(section => normalizeSectionName(section.name) === normalized) || null;
}
