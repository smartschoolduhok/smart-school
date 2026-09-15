export const OFFICIAL_BOOK_TITLE_MAX_LENGTH = 180;
export const OFFICIAL_BOOK_BODY_MAX_LENGTH = 12_000;
export const OFFICIAL_BOOK_FIELD_MAX_LENGTH = 2_000;

export type OfficialBookTemplateCategory = 'student' | 'verification' | 'committee' | 'administrative';
export type OfficialBookFieldType = 'text' | 'textarea';

export interface OfficialBookTemplateField {
  key: string;
  label: string;
  type: OfficialBookFieldType;
  required?: boolean;
  default_value?: string;
  placeholder?: string;
  max_length?: number;
}

export interface BuiltInOfficialBookTemplate {
  preset_key: string;
  source: 'builtin';
  category: OfficialBookTemplateCategory;
  title: string;
  description: string;
  body_text: string;
  paper_size: 'A4';
  requires_student: boolean;
  requires_employee: boolean;
  fields: OfficialBookTemplateField[];
}

const STUDENT_FIELDS: OfficialBookTemplateField[] = [
  {
    key: 'recipient',
    label: 'الجهة المخاطَبة',
    type: 'text',
    required: true,
    placeholder: 'مثال: المديرية العامة لتربية نينوى / قسم ...',
    max_length: 250,
  },
  {
    key: 'purpose',
    label: 'الغرض من الكتاب',
    type: 'text',
    required: true,
    placeholder: 'مثال: التقديم إلى ...',
    max_length: 300,
  },
];

const COMMITTEE_FIELDS: OfficialBookTemplateField[] = [
  {
    key: 'reference_basis',
    label: 'السند أو الأمر السابق',
    type: 'text',
    required: true,
    default_value: 'مقتضيات المصلحة العامة وتنظيم العمل المدرسي',
    max_length: 500,
  },
  {
    key: 'committee_members',
    label: 'أعضاء اللجنة بالترتيب',
    type: 'textarea',
    required: true,
    placeholder: '١. الاسم — رئيسًا\n٢. الاسم — عضوًا\n٣. الاسم — عضوًا',
    max_length: 2_000,
  },
  {
    key: 'committee_duties',
    label: 'مهام اللجنة',
    type: 'textarea',
    required: true,
    max_length: 2_000,
  },
  {
    key: 'copies',
    label: 'نسخ الكتاب',
    type: 'textarea',
    required: true,
    default_value: 'السادة أعضاء اللجنة / للعمل بموجبه\nالإدارة / للحفظ',
    max_length: 1_000,
  },
];

function committeeTemplate(
  presetKey: string,
  title: string,
  description: string,
  committeeName: string,
  duties: string,
): BuiltInOfficialBookTemplate {
  return {
    preset_key: presetKey,
    source: 'builtin',
    category: 'committee',
    title,
    description,
    paper_size: 'A4',
    requires_student: false,
    requires_employee: false,
    body_text: `م / ${title}

استنادًا إلى {{reference_basis}}، تقرر تشكيل ${committeeName} في {{school_name}} من السادة المدرجة أسماؤهم أدناه:

{{committee_members}}

مهام اللجنة:
{{committee_duties}}

يُعمل بهذا الأمر من تاريخ صدوره، وعلى أعضاء اللجنة تنفيذ المهام المبيّنة أعلاه ورفع محضر بنتائج أعمالها إلى إدارة المدرسة.

مع التقدير.

نسخة منه إلى:
{{copies}}`,
    fields: COMMITTEE_FIELDS.map((field) => (
      field.key === 'committee_duties' ? { ...field, default_value: duties } : { ...field }
    )),
  };
}

export const BUILT_IN_OFFICIAL_BOOK_TEMPLATES: BuiltInOfficialBookTemplate[] = [
  {
    preset_key: 'student-attendance-confirmation',
    source: 'builtin',
    category: 'student',
    title: 'تأييد استمرار طالب بالدوام',
    description: 'تأييد مدرسي يثبت تسجيل الطالب واستمراره بالدوام حتى تاريخ الإصدار.',
    paper_size: 'A4',
    requires_student: true,
    requires_employee: false,
    body_text: `إلى / {{recipient}}
م / تأييد استمرار بالدوام

تحية طيبة...

نؤيد لكم أن {{student_name}}، ذو الرقم المدرسي ({{student_number}})، من طلبة الصف {{class_name}} / الشعبة {{section_name}} في مدرستنا للعام الدراسي {{academic_year}}، ومستمر بالدوام لغاية تاريخ إصدار هذا الكتاب.

وقد أعطي هذا التأييد بناءً على طلب ذي العلاقة لغرض {{purpose}}.

مع التقدير.`,
    fields: STUDENT_FIELDS.map((field) => ({ ...field })),
  },
  {
    preset_key: 'student-status-confirmation',
    source: 'builtin',
    category: 'student',
    title: 'تأييد طالب (واقع حال)',
    description: 'كتاب واقع حال مختصر يثبت الصف والشعبة والسنة الدراسية.',
    paper_size: 'A4',
    requires_student: true,
    requires_employee: false,
    body_text: `إلى / {{recipient}}
م / تأييد (واقع حال)

تحية طيبة...

نؤيد أن الاسم المبين أدناه مسجل في سجلات {{school_name}} ضمن العام الدراسي {{academic_year}}:

الاسم: {{student_name}}
الرقم المدرسي: {{student_number}}
الصف والشعبة: {{class_name}} / {{section_name}}

صدر هذا الكتاب لغرض {{purpose}}، بناءً على المعلومات المدرسية المتاحة بتاريخ {{date}}.

مع التقدير.`,
    fields: STUDENT_FIELDS.map((field) => ({ ...field })),
  },
  {
    preset_key: 'student-acceptance-no-objection',
    source: 'builtin',
    category: 'student',
    title: 'عدم ممانعة من قبول طالب',
    description: 'صيغة قبول أولي لطالب غير مسجل بعد، مع طلب وثيقته وبطاقته المدرسية.',
    paper_size: 'A4',
    requires_student: false,
    requires_employee: false,
    body_text: `إلى / {{recipient_school}}
م / عدم ممانعة من قبول طالب

تحية طيبة...

لا مانع لدينا من قبول الطالب/الطالبة {{student_name}} في الصف {{target_class}} للعام الدراسي {{academic_year}}، شريطة استكمال متطلبات القبول والنقل الأصولية وتوفر الطاقة الاستيعابية.

يرجى التفضل بتزويدنا بـ{{requested_documents}}، مع بيان آخر صف دراسي ونتيجة الطالب/الطالبة.

مع التقدير.`,
    fields: [
      { key: 'recipient_school', label: 'المدرسة المخاطَبة', type: 'text', required: true, max_length: 300 },
      { key: 'student_name', label: 'اسم الطالب/الطالبة', type: 'text', required: true, max_length: 250 },
      { key: 'target_class', label: 'الصف المطلوب', type: 'text', required: true, max_length: 150 },
      {
        key: 'requested_documents',
        label: 'المستندات المطلوبة',
        type: 'text',
        required: true,
        default_value: 'الوثيقة المدرسية والبطاقة المدرسية',
        max_length: 500,
      },
    ],
  },
  {
    preset_key: 'student-transfer-documents',
    source: 'builtin',
    category: 'student',
    title: 'طلب نقل وتزويد بوثائق طالب',
    description: 'طلب نقل طالب مسجل وتزويد المدرسة بوثيقته وبطاقته المدرسية.',
    paper_size: 'A4',
    requires_student: true,
    requires_employee: false,
    body_text: `إلى / إدارة {{recipient_school}}
م / نقل طالب وتزويد بالوثائق

تحية طيبة...

يرجى التفضل بالموافقة على نقل الطالب/الطالبة {{student_name}}، الرقم المدرسي ({{student_number}})، من الصف {{class_name}} / الشعبة {{section_name}} إلى مدرستكم للعام الدراسي {{academic_year}}، وذلك بسبب {{transfer_reason}}.

ونرجو تزويد الجهة المختصة بـ{{requested_documents}} بعد إكمال الإجراءات الأصولية.

مع التقدير.`,
    fields: [
      { key: 'recipient_school', label: 'المدرسة المخاطَبة', type: 'text', required: true, max_length: 300 },
      { key: 'transfer_reason', label: 'سبب النقل', type: 'text', required: true, max_length: 500 },
      {
        key: 'requested_documents',
        label: 'المستندات المطلوبة',
        type: 'text',
        required: true,
        default_value: 'الوثيقة المدرسية والبطاقة المدرسية',
        max_length: 500,
      },
    ],
  },
  {
    preset_key: 'school-document-authenticity',
    source: 'builtin',
    category: 'verification',
    title: 'جواب صحة صدور وثيقة مدرسية',
    description: 'رد على كتاب تحقق من صحة وثيقة طالب مسجل في المدرسة.',
    paper_size: 'A4',
    requires_student: true,
    requires_employee: false,
    body_text: `إلى / {{recipient}}
م / صحة صدور وثيقة مدرسية

تحية طيبة...

إشارة إلى كتابكم المرقم ({{incoming_book_number}}) والمؤرخ في {{incoming_book_date}}، نؤيد صحة صدور {{document_description}} الخاصة بالطالب/الطالبة {{student_name}}، الرقم المدرسي ({{student_number}})، بعد مطابقتها مع السجلات المدرسية المتاحة لدينا.

يرجى التفضل بالاطلاع، مع التقدير.`,
    fields: [
      { key: 'recipient', label: 'الجهة المخاطَبة', type: 'text', required: true, max_length: 300 },
      { key: 'incoming_book_number', label: 'رقم الكتاب الوارد', type: 'text', required: true, max_length: 120 },
      { key: 'incoming_book_date', label: 'تاريخ الكتاب الوارد', type: 'text', required: true, placeholder: 'يوم/شهر/سنة', max_length: 100 },
      {
        key: 'document_description',
        label: 'وصف الوثيقة',
        type: 'text',
        required: true,
        default_value: 'الوثيقة المدرسية المرفقة',
        max_length: 500,
      },
    ],
  },
  committeeTemplate(
    'committee-general',
    'تشكيل لجنة مدرسية',
    'أمر مدرسي عام لتشكيل لجنة وتحديد أعضائها ومهامها ونسخ التبليغ.',
    'لجنة مدرسية',
    'تُكتب مهام اللجنة هنا بحسب الغرض من تشكيلها.',
  ),
  committeeTemplate(
    'committee-examinations',
    'تشكيل اللجنة الامتحانية',
    'أمر مدرسي لتشكيل اللجنة الامتحانية وتحديد مسؤولياتها.',
    'اللجنة الامتحانية',
    'تنظيم الأعمال الامتحانية وحفظ الأسئلة والسجلات، ومتابعة القاعات والدفاتر، وتوثيق النتائج وفق التعليمات النافذة.',
  ),
  committeeTemplate(
    'committee-audit',
    'تشكيل لجنة تدقيقية',
    'أمر مدرسي لتشكيل لجنة تدقيق السجلات أو النتائج أو الوثائق.',
    'لجنة تدقيقية',
    'تدقيق السجلات والوثائق المحددة، ومطابقة البيانات، وتثبيت الملاحظات بمحضر أصولي ورفعه إلى إدارة المدرسة.',
  ),
  committeeTemplate(
    'committee-inventory',
    'تشكيل لجنة جرد الأثاث والموجودات',
    'أمر مدرسي لجرد الأثاث والموجودات وتوثيق حالتها.',
    'لجنة جرد الأثاث والموجودات',
    'جرد الأثاث والموجودات فعليًا، ومطابقتها مع السجلات، وتحديد حالتها، وتنظيم محضر بالنواقص أو الزيادات والتوصيات.',
  ),
  {
    preset_key: 'employee-assignment-order',
    source: 'builtin',
    category: 'administrative',
    title: 'أمر مدرسي بتكليف موظف',
    description: 'أمر تكليف لموظف مسجل مع تحديد المهمة والمدة والمرجعية.',
    paper_size: 'A4',
    requires_student: false,
    requires_employee: true,
    body_text: `م / أمر مدرسي بالتكليف

استنادًا إلى {{reference_basis}}، تقرر تكليف السيد/السيدة {{employee_name}}، بصفة {{employee_position}}، بالمهام الآتية:

{{assignment_duties}}

مدة التكليف: {{assignment_period}}

يُعمل بهذا الأمر من تاريخ صدوره، وعلى الجهات ذات العلاقة تنفيذ ما ورد فيه.

مع التقدير.

نسخة منه إلى:
{{copies}}`,
    fields: [
      { ...COMMITTEE_FIELDS[0] },
      { key: 'assignment_duties', label: 'مهام التكليف', type: 'textarea', required: true, max_length: 2_000 },
      { key: 'assignment_period', label: 'مدة التكليف', type: 'text', required: true, placeholder: 'مثال: من ... إلى ...', max_length: 300 },
      { ...COMMITTEE_FIELDS[3] },
    ],
  },
];

export const OFFICIAL_BOOK_SYSTEM_PLACEHOLDERS = [
  'school_name',
  'principal_name',
  'student_name',
  'student_number',
  'class_name',
  'section_name',
  'academic_year',
  'employee_name',
  'employee_position',
  'date',
  'document_number',
] as const;

export function findBuiltInOfficialBookTemplate(presetKey: unknown): BuiltInOfficialBookTemplate | null {
  if (typeof presetKey !== 'string') return null;
  return BUILT_IN_OFFICIAL_BOOK_TEMPLATES.find((template) => template.preset_key === presetKey) || null;
}

export function officialBookTemplateDefaults(template: Pick<BuiltInOfficialBookTemplate, 'fields'>): Record<string, string> {
  return Object.fromEntries(template.fields.map((field) => [field.key, field.default_value || '']));
}

export function validateOfficialBookFieldValues(
  template: Pick<BuiltInOfficialBookTemplate, 'fields'>,
  rawValues: unknown,
): { values: Record<string, string>; error: string | null } {
  const source = rawValues && typeof rawValues === 'object' && !Array.isArray(rawValues)
    ? rawValues as Record<string, unknown>
    : {};
  const values: Record<string, string> = {};

  for (const field of template.fields) {
    const rawValue = source[field.key] ?? field.default_value ?? '';
    const value = typeof rawValue === 'string' ? rawValue.trim() : '';
    const maxLength = field.max_length || OFFICIAL_BOOK_FIELD_MAX_LENGTH;
    if (field.required && !value) {
      return { values: {}, error: `الحقل «${field.label}» مطلوب` };
    }
    if (value.length > maxLength) {
      return { values: {}, error: `الحقل «${field.label}» يتجاوز الحد المسموح (${maxLength})` };
    }
    values[field.key] = value;
  }

  return { values, error: null };
}

export function validateOfficialBookAdHocFieldValues(
  rawValues: unknown,
): { values: Record<string, string>; error: string | null } {
  if (rawValues === undefined || rawValues === null) return { values: {}, error: null };
  if (typeof rawValues !== 'object' || Array.isArray(rawValues)) {
    return { values: {}, error: 'حقول الكتاب الإضافية غير صالحة' };
  }
  const entries = Object.entries(rawValues as Record<string, unknown>);
  if (entries.length > 40) return { values: {}, error: 'عدد حقول الكتاب الإضافية أكبر من المسموح' };

  const values: Record<string, string> = {};
  for (const [key, rawValue] of entries) {
    if (!/^[a-z][a-z0-9_]*$/i.test(key)) {
      return { values: {}, error: `اسم الحقل «${key}» غير صالح` };
    }
    if (typeof rawValue !== 'string') {
      return { values: {}, error: `قيمة الحقل «${key}» يجب أن تكون نصًا` };
    }
    const value = rawValue.trim();
    if (value.length > OFFICIAL_BOOK_FIELD_MAX_LENGTH) {
      return { values: {}, error: `الحقل «${key}» يتجاوز الحد المسموح` };
    }
    values[key] = value;
  }
  return { values, error: null };
}

export function renderOfficialBookText(
  source: string,
  values: Record<string, string | number | null | undefined>,
): { text: string; unresolved: string[] } {
  const text = source.replace(/\{\{([a-z][a-z0-9_]*)\}\}/gi, (match, key: string) => {
    const value = values[key];
    return value === null || value === undefined ? match : String(value);
  });
  const unresolved = Array.from(new Set(
    Array.from(text.matchAll(/\{\{([a-z][a-z0-9_]*)\}\}/gi), (match) => match[1]),
  ));
  return { text, unresolved };
}

export function validateOfficialBookDraft(title: unknown, bodyText: unknown): string | null {
  if (typeof title !== 'string' || !title.trim()) return 'عنوان الكتاب مطلوب';
  if (title.trim().length > OFFICIAL_BOOK_TITLE_MAX_LENGTH) {
    return `عنوان الكتاب يتجاوز الحد المسموح (${OFFICIAL_BOOK_TITLE_MAX_LENGTH})`;
  }
  if (typeof bodyText !== 'string' || !bodyText.trim()) return 'نص الكتاب مطلوب';
  if (bodyText.trim().length > OFFICIAL_BOOK_BODY_MAX_LENGTH) {
    return `نص الكتاب يتجاوز الحد المسموح (${OFFICIAL_BOOK_BODY_MAX_LENGTH})`;
  }
  return null;
}
