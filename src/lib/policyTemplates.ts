import type { AdmissionRules } from './admissionRegulations';

export interface RegulationTemplate {
  id: string; version: number; title: string; class_label: string; school_year: string;
  jurisdiction: string; source_reference: string; source_url: string; source_date: string;
  applicability: string; notes: string; rules: AdmissionRules;
}

// Visually transcribed from the Ministry's original circular, not a news summary.
// These are oldest permitted birth years, NOT an exact required birth year.
const secondaryRows = [
  ['intermediate-1', 'الأول المتوسط', 2011, 2009],
  ['intermediate-2', 'الثاني المتوسط', 2010, 2008],
  ['intermediate-3', 'الثالث المتوسط', 2009, 2007],
  ['preparatory-4', 'الرابع الإعدادي', 2006, 2004],
  ['preparatory-5', 'الخامس الإعدادي', 2005, 2003],
  ['preparatory-6', 'السادس الإعدادي', 2004, 2002],
] as const;
export const REGULATION_TEMPLATES: readonly RegulationTemplate[] = secondaryRows.map(([id, label, male, female]) => ({
  id: `iq-morning-2026-27-${id}`, version: 1, title: `أعمار ${label} — صباحي 2026–2027`,
  class_label: label, school_year: '2026-2027', jurisdiction: 'وزارة التربية العراقية — التعليم الثانوي / المدارس الصباحية',
  source_reference: 'كتاب أعمار الطلبة في المدارس الصباحية بتاريخ 2026/06/08 — الفقرة الخاصة بالصف؛ الأصل المنشور 32202',
  source_url: 'https://t.me/Educationiq/32202', source_date: '2026-06-08',
  applicability: 'القبول والاستمرار في المرحلة الثانوية الصباحية الخاضعة للكتاب، بعد التحقق من انطباقه على المدرسة.',
  notes: 'هذه حدود العمر فقط. يلزم فحص الترك أو الرسوب لسنتين في الصف واستثناء سنة عدم الرسوب. لا يحدد هذا الكتاب حدًا أدنى للعمر أو جميع مستندات القبول والتسريع.',
  rules: {
    age_reference_date: '2026-12-31', age_rule: 'birth_date', min_age_months: null, max_age_months: null,
    birth_date_bounds: { male: { earliest: `${male}-01-01`, latest: null }, female: { earliest: `${female}-01-01`, latest: null } },
    age_scope: 'continuing', age_notes: 'المقارنة حسب سنة الميلاد الواردة في الكتاب. 31/12 تاريخ عرض العمر فقط؛ لا يحول حد المواليد إلى سن تقريبي. تحقق منفصل من الرسوب/الترك والاستثناءات.',
    repeat_rule: 'review', max_previous_repeats: null, acceleration: 'review', required_documents: [],
  },
}));

export function matchesTemplateYear(name: string, year: string): boolean {
  const normalized = name.replace(/[٠-٩۰-۹]/g, digit => {
    const n = '٠١٢٣٤٥٦٧٨٩'.indexOf(digit);
    return String(n >= 0 ? n : '۰۱۲۳۴۵۶۷۸۹'.indexOf(digit));
  });
  return (normalized.match(/\d{4}/g) ?? []).slice(0, 2).join('-') === year;
}

export function copyRegulationTemplate(id: string): RegulationTemplate | null {
  const template = REGULATION_TEMPLATES.find(item => item.id === id);
  return template ? JSON.parse(JSON.stringify(template)) as RegulationTemplate : null;
}
