export const STUDENT_RELIGION_VALUES = ['muslim', 'christian', 'other'] as const;

export type StudentReligion = typeof STUDENT_RELIGION_VALUES[number];

export const STUDENT_RELIGION_HEADER_ALIASES = ['الديانة', 'الدين', 'religion', 'faith'] as const;

export type StudentReligionValidation =
  | { ok: true; value: StudentReligion | null }
  | { ok: false; value: null };

export function validateStudentReligion(value: unknown): StudentReligionValidation {
  if (value == null || value === '') return { ok: true, value: null };
  if (typeof value === 'string' && STUDENT_RELIGION_VALUES.includes(value as StudentReligion)) {
    return { ok: true, value: value as StudentReligion };
  }
  return { ok: false, value: null };
}

export function normalizeExcelStudentReligion(value: unknown): StudentReligionValidation {
  if (value == null || String(value).trim() === '') return { ok: true, value: null };
  const normalized = String(value)
    .trim()
    .toLowerCase()
    .replace(/[إأآ]/gu, 'ا')
    .replace(/ى/gu, 'ي');
  if (normalized === 'مسلم' || normalized === 'muslim') return { ok: true, value: 'muslim' };
  if (normalized === 'مسيحي' || normalized === 'christian') return { ok: true, value: 'christian' };
  if (normalized === 'اخري' || normalized === 'other') return { ok: true, value: 'other' };
  return { ok: false, value: null };
}

export function studentReligionLabel(value: unknown): string | null {
  if (value === 'muslim') return 'مسلم';
  if (value === 'christian') return 'مسيحي';
  if (value === 'other') return 'أخرى';
  return null;
}
