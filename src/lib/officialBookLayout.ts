export interface OfficialBookLayoutSettings {
  version: 2;
  country_ar: string;
  ministry_ar: string;
  directorate_ar: string;
  department_ar: string;
  country_en: string;
  ministry_en: string;
  directorate_en: string;
  department_en: string;
  show_english_header: boolean;
  show_official_emblem: boolean;
  official_emblem_url: string;
  header_mode: 'structured' | 'custom';
  custom_header_ar: string;
  custom_header_en: string;
  show_verification_qr: boolean;
  show_verification_number: boolean;
  show_verification_note: boolean;
}

export const OFFICIAL_BOOK_CUSTOM_HEADER_MAX_LENGTH = 1_000;
export const OFFICIAL_BOOK_CUSTOM_HEADER_MAX_LINES = 10;

export const DEFAULT_OFFICIAL_BOOK_LAYOUT: OfficialBookLayoutSettings = {
  version: 2,
  country_ar: 'جمهورية العراق',
  ministry_ar: 'وزارة التربية',
  directorate_ar: '',
  department_ar: '',
  country_en: 'Republic of Iraq',
  ministry_en: 'Ministry of Education',
  directorate_en: '',
  department_en: '',
  show_english_header: true,
  show_official_emblem: false,
  official_emblem_url: '',
  header_mode: 'structured',
  custom_header_ar: '',
  custom_header_en: '',
  show_verification_qr: true,
  show_verification_number: true,
  show_verification_note: true,
};

export function officialBookDate(value: string | number): Date {
  if (typeof value === 'number') return new Date(value < 10_000_000_000 ? value * 1_000 : value);
  if (/^\d+$/.test(value)) {
    const numeric = Number(value);
    return new Date(numeric < 10_000_000_000 ? numeric * 1_000 : numeric);
  }
  return new Date(value);
}

export function formatOfficialBookDate(value: string | number, locale = 'ar-IQ'): string {
  const date = officialBookDate(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString(locale);
}

const TEXT_KEYS = [
  'country_ar',
  'ministry_ar',
  'directorate_ar',
  'department_ar',
  'country_en',
  'ministry_en',
  'directorate_en',
  'department_en',
] as const;

const CUSTOM_TEXT_KEYS = ['custom_header_ar', 'custom_header_en'] as const;
const BOOLEAN_KEYS = [
  'show_english_header', 'show_official_emblem',
  'show_verification_qr', 'show_verification_number', 'show_verification_note',
] as const;

function objectValue(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  }
  return typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function normalizeOfficialBookLayout(value: unknown): OfficialBookLayoutSettings {
  const source = objectValue(value);
  const normalized: OfficialBookLayoutSettings = { ...DEFAULT_OFFICIAL_BOOK_LAYOUT };
  for (const key of [...TEXT_KEYS, ...CUSTOM_TEXT_KEYS]) {
    if (typeof source[key] === 'string') normalized[key] = source[key].trim();
  }
  normalized.header_mode = source.header_mode === 'custom' ? 'custom' : 'structured';
  for (const key of BOOLEAN_KEYS) {
    normalized[key] = source[key] === undefined
      ? DEFAULT_OFFICIAL_BOOK_LAYOUT[key]
      : source[key] === true || source[key] === 1;
  }
  normalized.official_emblem_url = typeof source.official_emblem_url === 'string'
    ? source.official_emblem_url.trim()
    : '';
  return normalized;
}

export function validateOfficialBookLayout(value: unknown): string | null {
  const source = objectValue(value);
  if (source.header_mode !== undefined && source.header_mode !== 'structured' && source.header_mode !== 'custom') {
    return 'اختر ترويسة بالحقول أو ترويسة بنص مخصص';
  }
  for (const key of BOOLEAN_KEYS) {
    if (source[key] !== undefined && ![true, false, 0, 1].includes(source[key] as boolean | number)) {
      return 'خيارات عرض الترويسة والتذييل غير صالحة';
    }
  }
  for (const key of CUSTOM_TEXT_KEYS) {
    if (source[key] !== undefined && typeof source[key] !== 'string') {
      return 'الترويسة المخصصة يجب أن تكون نصًا';
    }
    if (typeof source[key] === 'string') {
      const text = source[key].trim();
      if (text.length > OFFICIAL_BOOK_CUSTOM_HEADER_MAX_LENGTH) return 'الترويسة المخصصة تتجاوز 1000 حرف';
      if (text.split(/\r\n|\r|\n/).length > OFFICIAL_BOOK_CUSTOM_HEADER_MAX_LINES) return 'الترويسة المخصصة تتجاوز 10 أسطر';
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) return 'الترويسة المخصصة تحتوي على محارف غير صالحة';
    }
  }
  for (const key of TEXT_KEYS) {
    if (source[key] !== undefined && typeof source[key] !== 'string') {
      return 'حقول الترويسة الرسمية يجب أن تكون نصوصًا';
    }
    if (typeof source[key] === 'string' && source[key].trim().length > 250) {
      return 'أحد أسطر الترويسة الرسمية يتجاوز 250 حرفًا';
    }
  }

  if (source.official_emblem_url !== undefined && typeof source.official_emblem_url !== 'string') {
    return 'رابط شعار الجمهورية غير صالح';
  }
  const url = typeof source.official_emblem_url === 'string' ? source.official_emblem_url.trim() : '';
  if (url.length > 2_000) return 'رابط شعار الجمهورية طويل جدًا';
  if (url && !/^https:\/\//i.test(url) && !url.startsWith('/')) {
    return 'يجب أن يكون رابط شعار الجمهورية HTTPS أو مسارًا داخليًا';
  }
  if ((source.show_official_emblem === true || source.show_official_emblem === 1) && !url) {
    return 'أضف رابط شعار الجمهورية قبل تفعيل عرضه';
  }
  return null;
}

export function resolvedOfficialBookLayout(
  value: unknown,
  school: { name?: string | null; name_en?: string | null; province?: string | null },
): OfficialBookLayoutSettings & { school_name_ar: string; school_name_en: string } {
  const layout = normalizeOfficialBookLayout(value);
  return {
    ...layout,
    directorate_ar: layout.directorate_ar || (school.province ? `المديرية العامة لتربية ${school.province}` : ''),
    school_name_ar: school.name || 'المدرسة',
    school_name_en: school.name_en || '',
  };
}
