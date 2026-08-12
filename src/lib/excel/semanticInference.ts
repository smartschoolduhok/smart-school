import {
  columnIndexToLetter,
  columnKey,
  extractClassValue,
  isCommonSectionValue,
  normalizeHeader,
} from './normalizers.ts';
import type {
  ColumnProfile,
  DataRegion,
  ExcelCell,
  FieldCandidate,
  FieldInference,
  MetadataCandidate,
  StudentSemanticField,
  WorksheetCategory,
  WorksheetRows,
} from './types.ts';

const FIELD_HEADER_ALIASES: Record<StudentSemanticField, string[]> = {
  full_name: ['الاسم', 'اسم الطالب', 'اسم الطالبه', 'الطالب', 'student name', 'student', 'name'],
  student_number: ['القيد', 'رقم الطالب', 'student number', 'student no', 'student id', 'registration number', 'الرقم'],
  section_name: ['الشعبه', 'section', 'group'],
  class_name: ['الصف', 'المرحله', 'class', 'grade'],
  gender: ['الجنس', 'النوع', 'gender', 'sex'],
  phone: ['الهاتف', 'رقم الهاتف', 'الموبايل', 'phone', 'mobile', 'telephone'],
};

const GRADE_HEADERS = ['الفصل الاول', 'نصف السنه', 'الفصل الثاني', 'السعي', 'النهايه', 'النهائي', 'الدرجه', 'المعدل', 'final', 'mid year', 'exam', 'grade'];
const SUMMARY_NAMES = ['ملخص', 'النتيجه النهائيه', 'القرار', 'كنترول', 'تدقيق', 'summary', 'control', 'report', 'result'];
const STUDENT_NAMES = ['ادخال الاسماء', 'الاسماء', 'الطلاب', 'اسماء الطلاب', 'students', 'student names'];
const SUBJECT_NAMES = ['فيزياء', 'كيمياء', 'احياء', 'العربيه', 'انكليزي', 'رياضيات', 'علوم', 'اجتماعيات', 'حاسوب', 'اسلاميه', 'physics', 'chemistry', 'biology', 'arabic', 'english', 'mathematics', 'math', 'science'];

function clamp(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(3))));
}

function ratio(count: number, total: number): number {
  return total > 0 ? count / total : 0;
}

function isNumeric(value: ExcelCell): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  return typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value.trim());
}

function isInteger(value: ExcelCell): boolean {
  return isNumeric(value) && Number.isInteger(Number(value));
}

function isStructuredIdentifier(value: ExcelCell): boolean {
  const text = String(value ?? '').trim();
  if (!text || /^\d+$/.test(text)) return false;
  return /^(?=.*\d)[\p{L}\d]+(?:[\/-][\p{L}\d]+)+$/u.test(text);
}

function isGenderValue(value: ExcelCell): boolean {
  return ['ذكر', 'انثى', 'male', 'female', 'm', 'f'].includes(normalizeHeader(value));
}

function isPhoneValue(value: ExcelCell): boolean {
  const digits = String(value ?? '').replace(/[^0-9]/g, '');
  return digits.length >= 10 && digits.length <= 15;
}

function hasArabicLetters(value: ExcelCell): boolean {
  return /[\u0600-\u06ff]/u.test(String(value ?? ''));
}

function sequentialRatio(values: ExcelCell[]): number {
  const integers = values.filter(isInteger).map(Number);
  if (integers.length < 2) return 0;
  let sequentialPairs = 0;
  for (let index = 1; index < integers.length; index += 1) {
    if (integers[index] === integers[index - 1] + 1) sequentialPairs += 1;
  }
  return ratio(sequentialPairs, integers.length - 1);
}

export function profileColumns(
  rows: WorksheetRows,
  region: DataRegion,
  headerRowIndex: number | null,
): ColumnProfile[] {
  const profiles: ColumnProfile[] = [];
  for (let columnIndex = region.startColumn; columnIndex <= region.endColumn; columnIndex += 1) {
    const values = rows
      .slice(region.dataStartRow, region.endRow + 1)
      .map(row => row?.[columnIndex])
      .filter(value => String(value ?? '').trim() !== '');
    const normalizedValues = values.map(value => normalizeHeader(value));
    const uniqueCount = new Set(normalizedValues).size;
    const textValues = values.filter(value => typeof value === 'string' && !isNumeric(value));
    const wordCounts = textValues.map(value => normalizeHeader(value).split(/\s+/u).filter(Boolean).length);
    const headerValue = headerRowIndex == null ? null : rows[headerRowIndex]?.[columnIndex];
    const headerText = String(headerValue ?? '').trim() || null;
    const letter = columnIndexToLetter(columnIndex);
    const nonEmptyCount = values.length;

    profiles.push({
      key: columnKey(columnIndex),
      columnIndex,
      columnLetter: letter,
      displayName: headerText || `عمود ${letter} (بدون عنوان)`,
      headerText,
      sampleValues: values.slice(0, 8),
      nonEmptyCount,
      uniqueCount,
      numericRatio: ratio(values.filter(isNumeric).length, nonEmptyCount),
      textRatio: ratio(textValues.length, nonEmptyCount),
      integerRatio: ratio(values.filter(isInteger).length, nonEmptyCount),
      sequentialIntegerRatio: sequentialRatio(values),
      structuredIdRatio: ratio(values.filter(isStructuredIdentifier).length, nonEmptyCount),
      sectionValueRatio: ratio(values.filter(isCommonSectionValue).length, nonEmptyCount),
      genderValueRatio: ratio(values.filter(isGenderValue).length, nonEmptyCount),
      phoneValueRatio: ratio(values.filter(isPhoneValue).length, nonEmptyCount),
      classValueRatio: ratio(values.filter(value => Boolean(extractClassValue(value))).length, nonEmptyCount),
      arabicTextRatio: ratio(textValues.filter(hasArabicLetters).length, textValues.length),
      averageWordCount: wordCounts.length ? wordCounts.reduce((sum, count) => sum + count, 0) / wordCounts.length : 0,
      shortCategoryRatio: ratio(values.filter(value => {
        const normalized = normalizeHeader(value);
        return normalized.length <= 8 && normalized.split(/\s+/u).length <= 2;
      }).length, nonEmptyCount),
    });
  }
  return profiles;
}

function headerConfidence(field: StudentSemanticField, headerText: string | null): { score: number; reason?: string } {
  const normalized = normalizeHeader(headerText);
  if (!normalized) return { score: 0 };
  const aliases = FIELD_HEADER_ALIASES[field].map(normalizeHeader);
  const exact = aliases.some(alias => normalized === alias);
  if (exact) return { score: field === 'student_number' && normalized === 'الرقم' ? 0.32 : 0.58, reason: `عنوان العمود يشير إلى ${field}` };
  const partial = aliases.some(alias => normalized.length > 3 && alias.length > 3 && (normalized.includes(alias) || alias.includes(normalized)));
  return partial ? { score: 0.42, reason: `عنوان العمود قريب من ${field}` } : { score: 0 };
}

function candidateForColumn(field: StudentSemanticField, profile: ColumnProfile): FieldCandidate {
  const header = headerConfidence(field, profile.headerText);
  const reasons: string[] = header.reason ? [header.reason] : [];
  const uniqueness = ratio(profile.uniqueCount, profile.nonEmptyCount);
  let score = header.score;

  if (field === 'full_name') {
    const usefulWordShape = profile.averageWordCount >= 2 && profile.averageWordCount <= 6 ? 1 : 0;
    score += profile.textRatio * 0.2 + usefulWordShape * 0.2 + uniqueness * 0.15 + profile.arabicTextRatio * 0.15;
    if (profile.shortCategoryRatio < 0.6) score += 0.12;
    score -= profile.numericRatio * 0.55;
    if (usefulWordShape) reasons.push('القيم نصية وتتكون غالباً من 2–6 كلمات');
    if (uniqueness >= 0.75) reasons.push('القيم عالية التفرّد');
  } else if (field === 'student_number') {
    score += profile.structuredIdRatio * 0.48 + uniqueness * 0.18 + profile.integerRatio * 0.08;
    score -= profile.sequentialIntegerRatio * 0.62;
    if (profile.structuredIdRatio >= 0.6) reasons.push('القيم تتبع نمط معرّف منظم مثل 5/001 أو S-101');
    if (profile.sequentialIntegerRatio >= 0.8) reasons.push('عقوبة: القيم تبدو تسلسلاً صفياً بسيطاً');
  } else if (field === 'section_name') {
    score += profile.sectionValueRatio * 0.68;
    if (profile.nonEmptyCount > 0 && profile.uniqueCount <= 6) score += 0.14;
    score += profile.shortCategoryRatio * 0.08;
    score -= profile.sequentialIntegerRatio * (uniqueness >= 0.8 ? 0.78 : 0.18);
    if (profile.sectionValueRatio >= 0.7) reasons.push('القيم تطابق أنماط الشعب الشائعة وتتكرر كفئات قصيرة');
    if (profile.sequentialIntegerRatio >= 0.8 && uniqueness >= 0.8) reasons.push('عقوبة: القيم تبدو تسلسلاً صفياً بسيطاً');
  } else if (field === 'class_name') {
    score += profile.classValueRatio * 0.48;
    if (profile.nonEmptyCount > 0 && profile.uniqueCount <= 4) score += 0.12;
    if (profile.classValueRatio >= 0.6) reasons.push('القيم تشبه أسماء صفوف دراسية');
  } else if (field === 'gender') {
    score += profile.genderValueRatio * 0.72;
    if (profile.nonEmptyCount > 0 && profile.uniqueCount <= 4) score += 0.1;
    if (profile.genderValueRatio >= 0.7) reasons.push('القيم تطابق قيم الجنس المعروفة');
  } else if (field === 'phone') {
    score += profile.phoneValueRatio * 0.72 + uniqueness * 0.08;
    if (profile.phoneValueRatio >= 0.7) reasons.push('القيم تشبه أرقام هاتف');
  }

  return {
    source: { type: 'column', columnIndex: profile.columnIndex, columnKey: profile.key },
    confidence: clamp(score),
    reasons,
  };
}

function metadataCandidatesForField(
  field: StudentSemanticField,
  metadata: MetadataCandidate[],
): FieldCandidate[] {
  if (field !== 'class_name' && field !== 'section_name') return [];
  return metadata
    .filter(candidate => candidate.field === field)
    .map(candidate => ({ source: candidate.source, confidence: candidate.confidence, reasons: candidate.reasons }));
}

export function inferStudentFields(
  profiles: ColumnProfile[],
  metadata: MetadataCandidate[],
): FieldInference[] {
  const fields = Object.keys(FIELD_HEADER_ALIASES) as StudentSemanticField[];
  return fields.map(field => {
    const alternatives = [
      ...profiles.map(profile => candidateForColumn(field, profile)),
      ...metadataCandidatesForField(field, metadata),
    ].sort((left, right) => right.confidence - left.confidence);
    const best = alternatives[0] || { source: { type: 'ignore' as const }, confidence: 0, reasons: ['لم يُعثر على مصدر مناسب'] };
    return { field, ...best, alternatives: alternatives.slice(1, 5) };
  });
}

function containsAlias(value: string, aliases: string[]): boolean {
  const normalized = normalizeHeader(value);
  return aliases.map(normalizeHeader).some(alias => normalized === alias || (alias.length > 3 && normalized.includes(alias)));
}

export function classifyFromAnalysis(
  sheetName: string,
  profiles: ColumnProfile[],
  inferences: FieldInference[],
): { category: WorksheetCategory; confidence: number } {
  if (containsAlias(sheetName, SUMMARY_NAMES)) return { category: 'summary', confidence: 0.95 };

  const gradeHeaderCount = profiles.filter(profile => GRADE_HEADERS.some(alias => normalizeHeader(profile.headerText).includes(normalizeHeader(alias)))).length;
  const strongGradeHeaderCount = profiles.filter(profile => GRADE_HEADERS.some(alias => {
    const normalizedAlias = normalizeHeader(alias);
    return normalizedAlias !== 'grade' && normalizeHeader(profile.headerText).includes(normalizedAlias);
  })).length;
  const gradeNumericSignal = Math.max(0, ...profiles.map(profile => profile.numericRatio));
  if (gradeHeaderCount >= 2 || (strongGradeHeaderCount >= 1 && gradeNumericSignal >= 0.7) || (containsAlias(sheetName, SUBJECT_NAMES) && gradeHeaderCount >= 1)) {
    return { category: 'grade_sheet', confidence: clamp(0.65 + gradeHeaderCount * 0.1 + gradeNumericSignal * 0.1) };
  }

  const nameInference = inferences.find(inference => inference.field === 'full_name')?.confidence || 0;
  const identityInference = Math.max(
    inferences.find(inference => inference.field === 'student_number')?.confidence || 0,
    inferences.find(inference => inference.field === 'section_name')?.confidence || 0,
  );
  const nameSignal = containsAlias(sheetName, STUDENT_NAMES) ? 0.2 : 0;
  const studentConfidence = clamp(nameInference * 0.68 + identityInference * 0.2 + nameSignal);
  if (studentConfidence >= 0.58) return { category: 'students', confidence: studentConfidence };

  if (containsAlias(sheetName, SUBJECT_NAMES) && gradeNumericSignal >= 0.5) {
    return { category: 'grade_sheet', confidence: 0.7 };
  }
  return { category: 'unknown', confidence: clamp(Math.max(nameInference, gradeNumericSignal) * 0.45) };
}

export function gradeHeaderSignal(value: unknown): boolean {
  const normalized = normalizeHeader(value);
  return GRADE_HEADERS.some(alias => normalized.includes(normalizeHeader(alias)));
}

export function studentHeaderSignal(value: unknown): number {
  const normalized = normalizeHeader(value);
  if (!normalized) return 0;
  let best = 0;
  for (const [field, aliases] of Object.entries(FIELD_HEADER_ALIASES)) {
    for (const aliasValue of aliases) {
      const alias = normalizeHeader(aliasValue);
      if (normalized === alias) best = Math.max(best, field === 'full_name' ? 4 : 3);
      else if (alias.length > 3 && normalized.includes(alias)) best = Math.max(best, field === 'full_name' ? 3 : 2);
    }
  }
  return best;
}
