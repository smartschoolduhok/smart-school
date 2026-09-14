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
}

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
};

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
  for (const key of TEXT_KEYS) {
    if (typeof source[key] === 'string') normalized[key] = source[key].trim();
  }
  normalized.show_english_header = source.show_english_header === undefined
    ? DEFAULT_OFFICIAL_BOOK_LAYOUT.show_english_header
    : source.show_english_header === true || source.show_english_header === 1;
  normalized.show_official_emblem = source.show_official_emblem === true || source.show_official_emblem === 1;
  normalized.official_emblem_url = typeof source.official_emblem_url === 'string'
    ? source.official_emblem_url.trim()
    : '';
  return normalized;
}

export function validateOfficialBookLayout(value: unknown): string | null {
  const source = objectValue(value);
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
