export const TIMETABLE_PREFERENCE_LABELS = {
  early_light_subjects: 'تأخير المواد الخفيفة عن أول درسين',
  section_continuity: 'تتابع المدرس بين شعب الصف للمادة نفسها',
  early_science: 'تقديم الرياضيات والفيزياء والكيمياء',
  teacher_gaps: 'تقليل فراغات المدرسين',
  teacher_preferences: 'الفترات المفضلة للمدرس',
  heavy_balance: 'تفريق الدروس الثقيلة',
  first_subject_variety: 'تنويع مادة الدرس الأول',
  subject_spread: 'توزيع المادة على أيام مختلفة',
  daily_balance: 'توازن عدد الدروس بين الأيام',
} as const;

export type TimetablePreferenceKey = keyof typeof TIMETABLE_PREFERENCE_LABELS;
export type TimetablePreferences = Record<TimetablePreferenceKey, number>;
export const DEFAULT_TIMETABLE_PREFERENCES: Readonly<TimetablePreferences> = Object.freeze({
  early_light_subjects: 1, section_continuity: 1, early_science: 1, teacher_gaps: 1,
  teacher_preferences: 1, heavy_balance: 1, first_subject_variety: 1, subject_spread: 1, daily_balance: 1,
});

/** Strict on writes; absent saved preferences retain the existing scoring model. */
export function parseTimetablePreferences(value: unknown): TimetablePreferences | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const keys = Object.keys(DEFAULT_TIMETABLE_PREFERENCES) as TimetablePreferenceKey[];
  if (Object.keys(input).length !== keys.length || Object.keys(input).some(key => !keys.includes(key as TimetablePreferenceKey))) return null;
  for (const key of keys) {
    const max = key === 'early_light_subjects' ? 1 : 2;
    if (typeof input[key] !== 'number' || !Number.isInteger(input[key]) || Number(input[key]) < 0 || Number(input[key]) > max) return null;
  }
  return Object.fromEntries(keys.map(key => [key, input[key]])) as TimetablePreferences;
}

export function storedTimetablePreferences(json: string | null | undefined): TimetablePreferences {
  if (json == null) return {...DEFAULT_TIMETABLE_PREFERENCES};
  const parsed = parseTimetablePreferences(JSON.parse(json));
  if (!parsed) throw new Error('Invalid saved timetable preferences');
  return parsed;
}

export interface TimetableSchoolPreferences {
  school_id: number;
  revision: number;
  preferences: TimetablePreferences;
}

export type TimetableSearchDuration = 'quick' | 'extended' | 'deep';
export const TIMETABLE_SEARCH_BUDGETS = {
  quick: {label: 'سريع — حتى ٩٠ ثانية', timeBudgetMs: 90_000, maxRuns: 8},
  extended: {label: 'موسّع — حتى ٥ دقائق', timeBudgetMs: 300_000, maxRuns: 50},
  deep: {label: 'عميق — حتى ١٥ دقيقة', timeBudgetMs: 900_000, maxRuns: 1000},
} as const;

export function timetableSearchBudget(duration?: TimetableSearchDuration) {
  return TIMETABLE_SEARCH_BUDGETS[duration || 'quick'] || TIMETABLE_SEARCH_BUDGETS.quick;
}
