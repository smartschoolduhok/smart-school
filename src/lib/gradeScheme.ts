export const GRADE_TERM_INPUT_MODES = ['monthly', 'direct', 'disabled'] as const;

export type GradeTermInputMode = typeof GRADE_TERM_INPUT_MODES[number];
export type GradeEnabledFlag = 0 | 1;

export interface GradeSchemeSettings {
  first_term_input_mode: GradeTermInputMode;
  second_term_input_mode: GradeTermInputMode;
  mid_year_exam_enabled: GradeEnabledFlag;
  final_exam_enabled: GradeEnabledFlag;
  completion_exam_enabled: GradeEnabledFlag;
}

export const DEFAULT_GRADE_SCHEME_SETTINGS: GradeSchemeSettings = {
  first_term_input_mode: 'monthly',
  second_term_input_mode: 'monthly',
  mid_year_exam_enabled: 1,
  final_exam_enabled: 1,
  completion_exam_enabled: 1,
};

export const RAW_GRADE_FIELDS = [
  'first_term_grade',
  'first_month',
  'second_month',
  'mid_year_exam',
  'second_term_grade',
  'third_month',
  'fourth_month',
  'final_exam',
  'completion_exam',
] as const;

export type RawGradeField = typeof RAW_GRADE_FIELDS[number];

export const RAW_GRADE_FIELD_LABELS: Record<RawGradeField, string> = {
  first_term_grade: 'درجة الفصل الأول',
  first_month: 'الشهر الأول',
  second_month: 'الشهر الثاني',
  mid_year_exam: 'امتحان نصف السنة',
  second_term_grade: 'درجة الفصل الثاني',
  third_month: 'الشهر الثالث',
  fourth_month: 'الشهر الرابع',
  final_exam: 'امتحان نهاية السنة',
  completion_exam: 'امتحان الإكمال',
};

export type GradeSchemeSettingsInput = Partial<Record<keyof GradeSchemeSettings, unknown>> | null | undefined;

function normalizeMode(value: unknown, fallback: GradeTermInputMode): GradeTermInputMode {
  return GRADE_TERM_INPUT_MODES.includes(value as GradeTermInputMode)
    ? value as GradeTermInputMode
    : fallback;
}

function normalizeFlag(value: unknown, fallback: GradeEnabledFlag): GradeEnabledFlag {
  if (value === 0 || value === '0' || value === false) return 0;
  if (value === 1 || value === '1' || value === true) return 1;
  return fallback;
}

export function normalizeGradeSchemeSettings(input: GradeSchemeSettingsInput): GradeSchemeSettings {
  return {
    first_term_input_mode: normalizeMode(input?.first_term_input_mode, DEFAULT_GRADE_SCHEME_SETTINGS.first_term_input_mode),
    second_term_input_mode: normalizeMode(input?.second_term_input_mode, DEFAULT_GRADE_SCHEME_SETTINGS.second_term_input_mode),
    mid_year_exam_enabled: normalizeFlag(input?.mid_year_exam_enabled, DEFAULT_GRADE_SCHEME_SETTINGS.mid_year_exam_enabled),
    final_exam_enabled: normalizeFlag(input?.final_exam_enabled, DEFAULT_GRADE_SCHEME_SETTINGS.final_exam_enabled),
    completion_exam_enabled: normalizeFlag(input?.completion_exam_enabled, DEFAULT_GRADE_SCHEME_SETTINGS.completion_exam_enabled),
  };
}

export function validateGradeSchemeSettings(input: GradeSchemeSettingsInput): string | null {
  for (const key of ['first_term_input_mode', 'second_term_input_mode'] as const) {
    if (input?.[key] !== undefined && !GRADE_TERM_INPUT_MODES.includes(input[key] as GradeTermInputMode)) {
      return `${key} يجب أن يكون monthly أو direct أو disabled`;
    }
  }
  for (const key of ['mid_year_exam_enabled', 'final_exam_enabled', 'completion_exam_enabled'] as const) {
    const value = input?.[key];
    if (value !== undefined && value !== 0 && value !== 1) {
      return `${key} يجب أن يكون 0 أو 1`;
    }
  }
  return null;
}

export function enabledRawGradeFields(input: GradeSchemeSettingsInput): RawGradeField[] {
  const settings = normalizeGradeSchemeSettings(input);
  const fields: RawGradeField[] = [];
  if (settings.first_term_input_mode === 'monthly') fields.push('first_month', 'second_month');
  if (settings.first_term_input_mode === 'direct') fields.push('first_term_grade');
  if (settings.mid_year_exam_enabled) fields.push('mid_year_exam');
  if (settings.second_term_input_mode === 'monthly') fields.push('third_month', 'fourth_month');
  if (settings.second_term_input_mode === 'direct') fields.push('second_term_grade');
  if (settings.final_exam_enabled) fields.push('final_exam');
  if (settings.completion_exam_enabled) fields.push('completion_exam');
  return fields;
}

export function requestedRawGradeFields(payload: Record<string, unknown>): RawGradeField[] {
  return RAW_GRADE_FIELDS.filter(field => payload[field] !== undefined);
}

export function disabledRawGradeFields(
  payload: Record<string, unknown>,
  input: GradeSchemeSettingsInput,
): RawGradeField[] {
  const enabled = new Set(enabledRawGradeFields(input));
  return requestedRawGradeFields(payload).filter(field => !enabled.has(field));
}

export interface GradeColumnDescriptor {
  key: RawGradeField | 'first_term_average' | 'second_term_average';
  label: string;
  editable: boolean;
}

export function gradeInputColumns(input: GradeSchemeSettingsInput): GradeColumnDescriptor[] {
  const settings = normalizeGradeSchemeSettings(input);
  const columns: GradeColumnDescriptor[] = [];
  if (settings.first_term_input_mode === 'monthly') {
    columns.push(
      { key: 'first_month', label: RAW_GRADE_FIELD_LABELS.first_month, editable: true },
      { key: 'second_month', label: RAW_GRADE_FIELD_LABELS.second_month, editable: true },
      { key: 'first_term_average', label: 'معدل الفصل الأول', editable: false },
    );
  } else if (settings.first_term_input_mode === 'direct') {
    columns.push({ key: 'first_term_grade', label: RAW_GRADE_FIELD_LABELS.first_term_grade, editable: true });
  }
  if (settings.mid_year_exam_enabled) {
    columns.push({ key: 'mid_year_exam', label: RAW_GRADE_FIELD_LABELS.mid_year_exam, editable: true });
  }
  if (settings.second_term_input_mode === 'monthly') {
    columns.push(
      { key: 'third_month', label: RAW_GRADE_FIELD_LABELS.third_month, editable: true },
      { key: 'fourth_month', label: RAW_GRADE_FIELD_LABELS.fourth_month, editable: true },
      { key: 'second_term_average', label: 'معدل الفصل الثاني', editable: false },
    );
  } else if (settings.second_term_input_mode === 'direct') {
    columns.push({ key: 'second_term_grade', label: RAW_GRADE_FIELD_LABELS.second_term_grade, editable: true });
  }
  if (settings.final_exam_enabled) {
    columns.push({ key: 'final_exam', label: RAW_GRADE_FIELD_LABELS.final_exam, editable: true });
  }
  if (settings.completion_exam_enabled) {
    columns.push({ key: 'completion_exam', label: RAW_GRADE_FIELD_LABELS.completion_exam, editable: true });
  }
  return columns;
}

export function gradeSchemeSummary(input: GradeSchemeSettingsInput): string {
  const settings = normalizeGradeSchemeSettings(input);
  const termLabel = (term: 'الأول' | 'الثاني', mode: GradeTermInputMode) => {
    if (mode === 'monthly') return `الفصل ${term}: شهريان`;
    if (mode === 'direct') return `الفصل ${term}: درجة مباشرة`;
    return `الفصل ${term}: معطّل`;
  };
  return [
    termLabel('الأول', settings.first_term_input_mode),
    settings.mid_year_exam_enabled ? 'نصف السنة: مفعّل' : 'نصف السنة: معطّل',
    termLabel('الثاني', settings.second_term_input_mode),
    settings.final_exam_enabled ? 'نهاية السنة: مفعّل' : 'نهاية السنة: معطّل',
    settings.completion_exam_enabled ? 'الإكمال: مفعّل' : 'الإكمال: معطّل',
  ].join(' • ');
}
