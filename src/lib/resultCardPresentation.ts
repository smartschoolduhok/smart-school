import {
  normalizeGradeSchemeSettings,
  RAW_GRADE_FIELD_LABELS,
  type GradeSchemeSettingsInput,
  type RawGradeField,
} from './gradeScheme.ts';

export const RESULT_CARD_DISPLAY_SETTING_KEYS = [
  'show_school_logo',
  'show_school_subtitle',
  'show_phone',
  'show_address',
  'show_email_website',
  'show_class_section_in_header',
  'show_student_number',
  'show_exam_number',
  'show_gender',
  'show_exam_round',
  'show_overall_average',
  'show_appreciation',
  'show_subject_status',
  'show_exemption_detail',
  'show_first_term_inputs',
  'show_first_term_average',
  'show_mid_year_exam',
  'show_second_term_inputs',
  'show_second_term_average',
  'show_final_exam',
  'show_annual_effort',
  'show_final_grade',
  'show_effective_grade',
  'show_completion_exam',
  'show_qr_code',
  'show_verification_code_text',
  'show_notes_decisions',
  'show_signatures_block',
  'show_school_stamp_placeholder',
] as const;

export type ResultCardDisplaySettingKey = typeof RESULT_CARD_DISPLAY_SETTING_KEYS[number];
export type ResultCardDisplaySettings = Record<ResultCardDisplaySettingKey, boolean>;

export const DEFAULT_RESULT_CARD_DISPLAY_SETTINGS: ResultCardDisplaySettings = {
  show_school_logo: true,
  show_school_subtitle: true,
  show_phone: true,
  show_address: true,
  show_email_website: true,
  show_class_section_in_header: true,
  show_student_number: true,
  show_exam_number: false,
  show_gender: true,
  show_exam_round: true,
  show_overall_average: true,
  show_appreciation: false,
  show_subject_status: true,
  show_exemption_detail: false,
  show_first_term_inputs: true,
  show_first_term_average: false,
  show_mid_year_exam: true,
  show_second_term_inputs: true,
  show_second_term_average: false,
  show_final_exam: true,
  show_annual_effort: true,
  show_final_grade: false,
  show_effective_grade: false,
  show_completion_exam: false,
  show_qr_code: true,
  show_verification_code_text: true,
  show_notes_decisions: true,
  show_signatures_block: true,
  show_school_stamp_placeholder: true,
};

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (value === true || value === 1 || value === '1') return true;
  if (value === false || value === 0 || value === '0') return false;
  return fallback;
}

export function validateResultCardDisplaySettings(input: unknown): string | null {
  if (input === undefined || input === null) return null;
  if (typeof input !== 'object' || Array.isArray(input)) {
    return 'إعدادات عرض كارت النتيجة غير صالحة';
  }
  const record = input as Record<string, unknown>;
  for (const key of RESULT_CARD_DISPLAY_SETTING_KEYS) {
    const value = record[key];
    if (
      value !== undefined &&
      value !== true && value !== false &&
      value !== 0 && value !== 1 &&
      value !== '0' && value !== '1'
    ) {
      return `قيمة إعداد العرض ${key} يجب أن تكون منطقية`;
    }
  }
  return null;
}

export function normalizeResultCardDisplaySettings(input: unknown): ResultCardDisplaySettings {
  const record = input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  return Object.fromEntries(
    RESULT_CARD_DISPLAY_SETTING_KEYS.map((key) => [
      key,
      normalizeBoolean(record[key], DEFAULT_RESULT_CARD_DISPLAY_SETTINGS[key]),
    ]),
  ) as ResultCardDisplaySettings;
}

export function parseResultCardDisplaySettings(value: unknown): ResultCardDisplaySettings {
  if (typeof value !== 'string') return normalizeResultCardDisplaySettings(value);
  try {
    return normalizeResultCardDisplaySettings(JSON.parse(value));
  } catch {
    return { ...DEFAULT_RESULT_CARD_DISPLAY_SETTINGS };
  }
}

export function normalizeResultCardGender(value: unknown): 'ذكر' | 'أنثى' | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'ذكر' || normalized === 'male' || normalized === 'm') return 'ذكر';
  if (normalized === 'أنثى' || normalized === 'female' || normalized === 'f') return 'أنثى';
  return null;
}

export type ResultCardColumnKey =
  | 'subject_name'
  | RawGradeField
  | 'first_term_average'
  | 'second_term_average'
  | 'annual_effort'
  | 'final_grade'
  | 'effective_grade'
  | 'result_status'
  | 'exemption_detail';

export interface ResultCardColumnDescriptor {
  key: ResultCardColumnKey;
  label: string;
}

export const RESULT_CARD_NUMERIC_COLUMN_KEYS = [
  'first_term_grade',
  'first_month',
  'second_month',
  'first_term_average',
  'mid_year_exam',
  'second_term_grade',
  'third_month',
  'fourth_month',
  'second_term_average',
  'annual_effort',
  'final_exam',
  'completion_exam',
  'final_grade',
  'effective_grade',
] as const satisfies readonly ResultCardColumnKey[];

export type ResultCardNumericColumnKey = typeof RESULT_CARD_NUMERIC_COLUMN_KEYS[number];
export type ResultCardColumnAverages = Partial<Record<ResultCardNumericColumnKey, number | null>>;

const RESULT_CARD_NUMERIC_COLUMN_KEY_SET = new Set<ResultCardColumnKey>(
  RESULT_CARD_NUMERIC_COLUMN_KEYS,
);

export function isResultCardNumericColumnKey(
  key: ResultCardColumnKey,
): key is ResultCardNumericColumnKey {
  return RESULT_CARD_NUMERIC_COLUMN_KEY_SET.has(key);
}

const RESULT_CARD_DERIVED_COLUMN_LABELS: Record<Exclude<ResultCardColumnKey, RawGradeField>, string> = {
  subject_name: 'المادة',
  first_term_average: 'سعي الفصل الأول',
  second_term_average: 'سعي الفصل الثاني',
  annual_effort: 'السعي السنوي',
  final_grade: 'الدرجة النهائية',
  effective_grade: 'الدرجة الفعّالة',
  result_status: 'الحالة',
  exemption_detail: 'الإعفاء',
};

export const LEGACY_RESULT_CARD_COLUMNS: readonly ResultCardColumnDescriptor[] = [
  { key: 'subject_name', label: 'المادة' },
  { key: 'annual_effort', label: 'السعي السنوي' },
  { key: 'final_exam', label: 'النهائي' },
  { key: 'effective_grade', label: 'الدرجة الفعّالة' },
  { key: 'result_status', label: 'الحالة' },
  { key: 'exemption_detail', label: 'الإعفاء' },
];

export function buildResultCardColumns(
  schemeInput: GradeSchemeSettingsInput,
  displayInput: unknown,
): ResultCardColumnDescriptor[] {
  const scheme = normalizeGradeSchemeSettings(schemeInput);
  const display = normalizeResultCardDisplaySettings(displayInput);
  const columns: ResultCardColumnDescriptor[] = [
    { key: 'subject_name', label: RESULT_CARD_DERIVED_COLUMN_LABELS.subject_name },
  ];
  if (display.show_first_term_inputs) {
    if (scheme.first_term_input_mode === 'monthly') {
      columns.push(
        { key: 'first_month', label: RAW_GRADE_FIELD_LABELS.first_month },
        { key: 'second_month', label: RAW_GRADE_FIELD_LABELS.second_month },
      );
    } else if (scheme.first_term_input_mode === 'direct') {
      columns.push({ key: 'first_term_grade', label: RAW_GRADE_FIELD_LABELS.first_term_grade });
    }
  }
  if (display.show_first_term_average && scheme.first_term_input_mode !== 'disabled') {
    columns.push({ key: 'first_term_average', label: RESULT_CARD_DERIVED_COLUMN_LABELS.first_term_average });
  }
  if (display.show_mid_year_exam && scheme.mid_year_exam_enabled === 1) {
    columns.push({ key: 'mid_year_exam', label: RAW_GRADE_FIELD_LABELS.mid_year_exam });
  }
  if (display.show_second_term_inputs) {
    if (scheme.second_term_input_mode === 'monthly') {
      columns.push(
        { key: 'third_month', label: RAW_GRADE_FIELD_LABELS.third_month },
        { key: 'fourth_month', label: RAW_GRADE_FIELD_LABELS.fourth_month },
      );
    } else if (scheme.second_term_input_mode === 'direct') {
      columns.push({ key: 'second_term_grade', label: RAW_GRADE_FIELD_LABELS.second_term_grade });
    }
  }
  if (display.show_second_term_average && scheme.second_term_input_mode !== 'disabled') {
    columns.push({ key: 'second_term_average', label: RESULT_CARD_DERIVED_COLUMN_LABELS.second_term_average });
  }
  if (display.show_annual_effort) {
    columns.push({ key: 'annual_effort', label: RESULT_CARD_DERIVED_COLUMN_LABELS.annual_effort });
  }
  if (display.show_final_exam && scheme.final_exam_enabled === 1) {
    columns.push({ key: 'final_exam', label: RAW_GRADE_FIELD_LABELS.final_exam });
  }
  if (display.show_completion_exam && scheme.completion_exam_enabled === 1) {
    columns.push({ key: 'completion_exam', label: RAW_GRADE_FIELD_LABELS.completion_exam });
  }
  if (display.show_final_grade) {
    columns.push({ key: 'final_grade', label: RESULT_CARD_DERIVED_COLUMN_LABELS.final_grade });
  }
  if (display.show_effective_grade) {
    columns.push({ key: 'effective_grade', label: RESULT_CARD_DERIVED_COLUMN_LABELS.effective_grade });
  }
  if (display.show_subject_status) {
    columns.push({ key: 'result_status', label: RESULT_CARD_DERIVED_COLUMN_LABELS.result_status });
  }
  if (display.show_exemption_detail) {
    columns.push({ key: 'exemption_detail', label: RESULT_CARD_DERIVED_COLUMN_LABELS.exemption_detail });
  }
  return columns;
}

const RESULT_CARD_COLUMN_KEYS = new Set<ResultCardColumnKey>([
  'subject_name',
  'first_term_grade',
  'first_month',
  'second_month',
  'first_term_average',
  'mid_year_exam',
  'second_term_grade',
  'third_month',
  'fourth_month',
  'second_term_average',
  'final_exam',
  'completion_exam',
  'annual_effort',
  'final_grade',
  'effective_grade',
  'result_status',
  'exemption_detail',
]);

export function snapshotResultCardColumns(input: unknown): ResultCardColumnDescriptor[] {
  if (!Array.isArray(input)) return [...LEGACY_RESULT_CARD_COLUMNS];
  const columns = input.flatMap((value): ResultCardColumnDescriptor[] => {
    if (!value || typeof value !== 'object') return [];
    const record = value as Record<string, unknown>;
    if (!RESULT_CARD_COLUMN_KEYS.has(record.key as ResultCardColumnKey)) return [];
    const key = record.key as ResultCardColumnKey;
    const fallbackLabel = key in RAW_GRADE_FIELD_LABELS
      ? RAW_GRADE_FIELD_LABELS[key as RawGradeField]
      : RESULT_CARD_DERIVED_COLUMN_LABELS[key as Exclude<ResultCardColumnKey, RawGradeField>];
    return [{ key, label: typeof record.label === 'string' && record.label.trim() ? record.label : fallbackLabel }];
  });
  return columns.length > 0 ? columns : [...LEGACY_RESULT_CARD_COLUMNS];
}

export function snapshotResultCardColumnAverages(
  input: unknown,
  columns: readonly ResultCardColumnDescriptor[],
): ResultCardColumnAverages | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  const averages: ResultCardColumnAverages = {};
  for (const column of columns) {
    if (!isResultCardNumericColumnKey(column.key)) continue;
    const value = record[column.key];
    averages[column.key] = typeof value === 'number' && Number.isFinite(value)
      ? value
      : null;
  }
  return averages;
}

export function resultCardAppreciation(average: number | null, maxGrade: number): string | null {
  if (average === null || !Number.isFinite(average) || !Number.isFinite(maxGrade) || maxGrade <= 0) return null;
  const percentage = (average / maxGrade) * 100;
  if (percentage >= 90) return 'ممتاز';
  if (percentage >= 80) return 'جيد جداً';
  if (percentage >= 70) return 'جيد';
  if (percentage >= 60) return 'متوسط';
  if (percentage >= 50) return 'مقبول';
  return 'ضعيف';
}

export const RESULT_CARD_DECISION_NOTE_MAX_LENGTH = 1000;

export function normalizeResultCardDecisionNote(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, RESULT_CARD_DECISION_NOTE_MAX_LENGTH) : null;
}

export function validateResultCardDecisionNote(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return 'ملاحظة أو قرار الكارت يجب أن يكون نصاً';
  if (value.trim().length > RESULT_CARD_DECISION_NOTE_MAX_LENGTH) {
    return `ملاحظة أو قرار الكارت يجب ألا يتجاوز ${RESULT_CARD_DECISION_NOTE_MAX_LENGTH} حرف`;
  }
  return null;
}
