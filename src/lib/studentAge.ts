import type { AdmissionRules } from './admissionRegulations.ts';
import { ageInMonths, validDate } from './admissionDates.ts';

export interface BirthDateBounds { earliest: string | null; latest: string | null; }
export type AgeStatus = 'within_limits' | 'outside_limits' | 'review' | 'not_applicable' | 'missing_birth_date' | 'invalid_birth_date' | 'future_birth_date';
export const AGE_STATUS_LABELS: Record<AgeStatus, string> = {
  within_limits: 'ضمن حدود العمر الموثقة', outside_limits: 'خارج حدود العمر — للمراجعة',
  review: 'تحتاج مراجعة', not_applicable: 'لا ينطبق شرط العمر',
  missing_birth_date: 'تاريخ الميلاد ناقص', invalid_birth_date: 'تاريخ الميلاد غير صحيح',
  future_birth_date: 'تاريخ الميلاد في المستقبل',
};
export interface AgeCheck { status: AgeStatus; age_months: number | null; reference_date: string | null; issues: string[]; }
export interface AgeInput { birth_date: string | null; gender?: string | null; today: string; }

/** An age comparison only: it never decides enrollment, repeats, acceleration or expulsion. */
export function checkStudentAge(rules: AdmissionRules | null, input: AgeInput): AgeCheck {
  const result = (status: AgeStatus, issues: string[], age: number | null = null): AgeCheck => ({
    status, issues, age_months: age, reference_date: rules?.age_reference_date ?? input.today,
  });
  if (!input.birth_date?.trim()) return result('missing_birth_date', ['أكمل تاريخ الميلاد من وثيقة الطالب']);
  let birth: string;
  try { birth = validDate(input.birth_date); } catch { return result('invalid_birth_date', ['راجع تاريخ الميلاد؛ التاريخ المسجل غير صالح']); }
  if (birth > input.today) return result('future_birth_date', ['تاريخ الميلاد يتجاوز تاريخ المراجعة']);
  if (!rules) return result('review', ['لا توجد لائحة عمر معتمدة وسارية لهذا الصف والسنة'], ageInMonths(birth, input.today));
  const age = ageInMonths(birth, rules.age_reference_date);
  if (age < 0) return result('review', ['تاريخ الميلاد بعد تاريخ احتساب العمر في اللائحة'], age);
  if (rules.age_rule === 'review') return result('review', ['حدود العمر لم تُحسم في اللائحة'], age);
  if (rules.age_rule === 'not_applicable') return result('not_applicable', [], age);
  if (rules.age_rule === 'birth_date') {
    if (input.gender !== 'male' && input.gender !== 'female') return result('review', ['الجنس غير مثبت لاختيار حدود المواليد'], age);
    const bounds = rules.birth_date_bounds?.[input.gender];
    if (!bounds) return result('review', ['حدود المواليد غير مكتملة'], age);
    if (bounds.earliest && birth < bounds.earliest) return result('outside_limits', ['أكبر من الحد: أقدم تاريخ ميلاد مسموح هو ' + bounds.earliest], age);
    if (bounds.latest && birth > bounds.latest) return result('outside_limits', ['أصغر من الحد: أحدث تاريخ ميلاد مسموح هو ' + bounds.latest], age);
  } else {
    if (rules.min_age_months != null && age < rules.min_age_months) return result('outside_limits', ['أصغر من الحد الأدنى عند تاريخ الاحتساب'], age);
    if (rules.max_age_months != null && age > rules.max_age_months) return result('outside_limits', ['أكبر من الحد الأعلى عند تاريخ الاحتساب'], age);
  }
  return result('within_limits', [], age);
}

export function formatAge(months: number | null): string {
  return months == null || months < 0 ? '—' : `${Math.floor(months / 12)} سنة و${months % 12} شهر`;
}
