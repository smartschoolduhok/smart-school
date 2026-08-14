import type { FieldSource } from './types.ts';

const ARABIC_DIACRITICS = /[\u064b-\u065f\u0670]/g;
const EXCEL_ERROR_TOKENS = new Set([
  '#NAME?',
  '#N/A',
  '#VALUE!',
  '#REF!',
  '#DIV/0!',
  '#NUM!',
  '#NULL!',
]);

export function isExcelErrorValue(value: unknown): boolean {
  return EXCEL_ERROR_TOKENS.has(String(value ?? '').trim().toUpperCase());
}

export function normalizeHeader(value: unknown): string {
  if (isExcelErrorValue(value)) return '';
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(ARABIC_DIACRITICS, '')
    .replace(/ـ/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[_\-–—/\\()[\]{}:؛،,.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

export function normalizeSubjectName(value: unknown): string {
  return normalizeHeader(value)
    .replace(/^(?:ماده|درجات)\s+/u, '')
    .replace(/^(?:اللغه|لغه)\s+/u, '')
    .replace(/^ال/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isCommonSectionValue(value: unknown): boolean {
  const normalized = normalizeSectionName(value);
  return ['ا', 'ب', 'ج', 'د'].includes(normalized);
}

export function columnIndexToLetter(columnIndex: number): string {
  let current = Math.max(0, Math.trunc(columnIndex)) + 1;
  let result = '';
  while (current > 0) {
    const remainder = (current - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    current = Math.floor((current - 1) / 26);
  }
  return result;
}

export function columnKey(columnIndex: number): string {
  return `column:${Math.max(0, Math.trunc(columnIndex))}`;
}

export function confidenceLevel(confidence: number): 'high' | 'medium' | 'low' {
  if (confidence >= 0.9) return 'high';
  if (confidence >= 0.7) return 'medium';
  return 'low';
}

export function fieldSourceIdentity(source: FieldSource | undefined): string {
  if (!source) return 'ignore';
  if (source.type === 'column') return source.columnKey;
  if (source.type === 'metadata-cell') return `metadata:${source.row}:${source.column}`;
  return source.type;
}

export function extractClassValue(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  const normalized = normalizeHeader(raw);
  if (!normalized) return null;
  const arabicMatch = normalized.match(/(?:الصف\s+)?((?:ال)?(?:اول|ثاني|ثالث|رابع|خامس|سادس)(?:\s+(?:ال)?(?:ابتدائي|متوسط|اعدادي|ثانوي))?)/u);
  if (arabicMatch) return arabicMatch[1].replace(/^ال/u, 'ال');
  const englishMatch = normalized.match(/(?:class|grade)\s*([0-9]{1,2}|[a-z]+)/i);
  return englishMatch ? `Grade ${englishMatch[1]}` : null;
}

export function extractSectionValue(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  const normalized = normalizeHeader(raw);
  const explicit = normalized.match(/(?:الشعبه|شعبه|section)\s*([ابجدa-d1-4])/u);
  if (explicit) return normalizeSectionName(explicit[1]);
  const suffix = normalized.match(/(?:\s|^)(?:-|–)?\s*([ابجدa-d1-4])$/u);
  if (suffix && /(?:متوسط|ابتدائي|اعدادي|ثانوي|class|grade)/u.test(normalized)) {
    return normalizeSectionName(suffix[1]);
  }
  return null;
}

export function matchSectionByName<T extends { name: unknown }>(value: unknown, sections: T[]): T | null {
  const normalized = normalizeSectionName(value);
  if (!normalized) return null;
  return sections.find(section => normalizeSectionName(section.name) === normalized) || null;
}
