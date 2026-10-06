/** The index names come from the supplied school register index. Proposed
 * fields are editable starting points, not claims about official templates. */
export type RegisterField = {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'date' | 'time' | 'number';
  required?: boolean;
};
export type SchoolRegisterDefinition = {
  key: string;
  number: number;
  title: string;
  description: string;
  category: string;
  templateStatus: 'proposed' | 'photo';
  fields: RegisterField[];
  relatedPath?: string;
  referenceUrl?: string;
  referenceNote?: string;
};
export type RegisterExtraField = { label: string; value: string };
export type EvaluationVisit = { date: string | null; scores: (number | null)[] };
export type TeacherEvaluation = { visits: EvaluationVisit[] };
export type SchoolRegisterEntry = {
  id: number;
  school_id: number;
  academic_year_id: number;
  register_key: string;
  entry_date: string;
  title: string;
  data: Record<string, unknown>;
  status: 'active' | 'voided';
  version: number;
  created_at: number;
  updated_at: number;
  void_reason: string | null;
};
export type SchoolRegisterHistory = {
  id: number;
  entry_id: number;
  action: 'created' | 'updated' | 'voided';
  version: number;
  actor_user_id: number;
  actor_name: string;
  changed_at: number;
  before: SchoolRegisterEntry | null;
  after: SchoolRegisterEntry;
};

const text = (key: string, label: string): RegisterField => ({ key, label, type: 'text' });
const notes = (key = 'notes', label = 'ملاحظات'): RegisterField => ({ key, label, type: 'textarea' });
const date = (key: string, label: string): RegisterField => ({ key, label, type: 'date' });
const time = (key: string, label: string): RegisterField => ({ key, label, type: 'time' });
const generic = () => [text('reference_number', 'الرقم المرجعي'), notes('details', 'تفاصيل القيد'), notes()];
const documentFields = () => [text('reference_number', 'رقم الكتاب'), date('document_date', 'تاريخ الكتاب'), text('sender', 'الجهة المرسلة'), text('recipient', 'الجهة المستلمة'), notes('subject', 'موضوع الكتاب'), notes('action', 'الإجراء'), notes()];
const proposed = (number: number, key: string, title: string, category: string, fields: RegisterField[], relatedPath?: string): SchoolRegisterDefinition => ({
  number, key, title, category, fields, relatedPath, templateStatus: 'proposed',
  description: 'قالب أولي مقترح؛ تُراجع حقوله مع المدرسة ويمكن إضافة حقول مخصصة لكل قيد.',
});

export const SCHOOL_REGISTERS: SchoolRegisterDefinition[] = [
  { ...proposed(1, 'ikal', 'الايكال', 'الإدارة', [text('delegator', 'المُوكِّل'), text('delegate', 'المكلَّف بالإدارة'), notes('reason', 'سبب الإيكال'), date('start_date', 'من تاريخ'), time('start_time', 'من وقت'), date('end_date', 'إلى تاريخ'), time('end_time', 'إلى وقت'), notes('duties', 'المهام المكلف بها'), notes()]), description: 'قالب مقترح لتوثيق تكليف إدارة المدرسة أثناء غياب المدير؛ يُراجع مع نموذج المدرسة قبل اعتماده.', referenceUrl: 'https://www.almoalm.com/2022/11/blog-post_9.html?hl=ar' },
  proposed(2, 'school-orders', 'الأوامر المدرسية', 'الإدارة', [text('order_number', 'رقم الأمر'), text('responsible_person', 'المكلف'), notes('subject', 'موضوع الأمر'), notes('action', 'الإجراء'), notes()]),
  proposed(3, 'incoming-student-documents', 'وارد الوثائق المدرسية', 'الطلبة', [text('reference_number', 'رقم الوثيقة'), text('student_name', 'اسم الطالب'), text('source_school', 'المدرسة المرسلة'), text('grade', 'الصف'), notes()]),
  proposed(4, 'outgoing-student-documents', 'صادر الوثائق المدرسية', 'الطلبة', [text('reference_number', 'رقم الوثيقة'), text('student_name', 'اسم الطالب'), text('destination_school', 'المدرسة المستلمة'), text('grade', 'الصف'), notes()]),
  proposed(5, 'supervisor-visits', 'زيارة المشرفين التربويين الاختصاصيين', 'الإشراف والتقويم', [text('supervisor_name', 'اسم المشرف'), text('specialization', 'الاختصاص'), text('teacher_name', 'اسم المدرس'), notes('observations', 'الملاحظات'), notes('recommendations', 'التوصيات'), notes()]),
  { ...proposed(6, 'supervisor-recommendations', 'متابعة تنفيذ توصيات السادة المشرفين', 'الإشراف والتقويم', [text('supervisor_name', 'اسم المشرف'), date('visit_date', 'تاريخ الزيارة'), notes('recommendation', 'التوصية'), text('responsible_person', 'المسؤول عن التنفيذ'), text('recipients', 'أسماء المبلغين بالتوصيات'), notes('acknowledgments', 'إثبات التبليغ'), date('due_date', 'موعد المتابعة'), notes('follow_up', 'ما تم تنفيذه'), notes()]), referenceUrl: 'https://www.almoalm.com/2022/11/blog-post_13.html', referenceNote: 'مرجع متداول للمقارنة؛ يُراجع القالب مع المدرسة قبل اعتماده.' },
  proposed(7, 'teaching-plans', 'متابعة الخطط اليومية والسنوية للمدرسين', 'الإشراف والتقويم', [text('teacher_name', 'اسم المدرس'), text('subject', 'المادة'), text('plan_type', 'نوع الخطة'), notes('observations', 'الملاحظات'), notes('follow_up', 'المتابعة'), notes()]),
  { ...proposed(8, 'teacher-evaluation', 'سجل التقويم', 'الإشراف والتقويم', [
    { key: 'employee_id', label: 'المدرس المرتبط بسجل الموظفين', type: 'number', required: true },
    text('teacher_name', 'اسم المدرس'), text('specialization', 'الاختصاص'), text('qualification', 'المؤهل'),
    { key: 'teaching_years', label: 'عدد سنوات الخدمة', type: 'number' }, notes(),
  ], '/employees'), templateStatus: 'photo', description: 'بنية مستندة إلى الصورة: أربعة أعمدة للزيارات وعشرون معيارًا بدرجات من 1 إلى 5. صياغة المعايير مختصرة للمراجعة؛ الخانات غير المقيمة تبقى فارغة.' },
  proposed(9, 'teacher-leaves', 'إجازات المدرسين', 'الملاك', [text('teacher_name', 'اسم المدرس'), text('leave_type', 'نوع الإجازة'), date('start_date', 'تاريخ البداية'), date('end_date', 'تاريخ النهاية'), text('approval_reference', 'مرجع الموافقة'), notes()]),
  proposed(10, 'outgoing-official-books', 'الصادر (الكتب الرسمية)', 'المراسلات', documentFields(), '/official-books'),
  proposed(11, 'incoming-official-books', 'الوارد (الكتب الرسمية)', 'المراسلات', documentFields(), '/official-books'),
  proposed(12, 'official-book-notifications', 'تبليغات الكتب الرسمية', 'المراسلات', [text('reference_number', 'رقم الكتاب'), date('document_date', 'تاريخ الكتاب'), text('recipient', 'اسم المبلغ'), date('notification_date', 'تاريخ التبليغ'), text('acknowledgment', 'إثبات التبليغ'), notes()]),
  proposed(13, 'student-statistical-register', 'قيد الطلبة (السجل الإحصائي)', 'الطلبة', [text('student_name', 'اسم الطالب'), text('student_number', 'رقم الطالب'), text('grade', 'الصف'), text('section', 'الشعبة'), text('study_status', 'حالة القيد'), notes()], '/students'),
  proposed(14, 'exchange-visits', 'تبادل الزيارات', 'الإشراف والتقويم', [text('visitor', 'الزائر'), text('host', 'المضيف'), text('subject', 'المادة'), text('grade', 'الصف'), notes('observations', 'الملاحظات'), notes('recommendations', 'التوصيات')]),
  proposed(15, 'inspection-visits', 'الزيارات التفتيشية', 'الإشراف والتقويم', [text('visitor', 'اسم المفتش'), text('authority', 'الجهة'), notes('purpose', 'غرض الزيارة'), notes('observations', 'الملاحظات'), notes('action', 'الإجراء')]),
  proposed(16, 'school-activities', 'الأنشطة المدرسية', 'الأنشطة والجودة', [text('activity_type', 'نوع النشاط'), text('coordinator', 'المشرف'), text('participants', 'المشاركون'), text('location', 'المكان'), notes('outcome', 'النتائج'), notes()]),
  proposed(17, 'daily-management', 'الأداء اليومي للإدارة', 'الإدارة', [notes('tasks', 'الأعمال اليومية'), text('responsible_person', 'المسؤول'), notes('completed', 'ما تم إنجازه'), notes('follow_up', 'المتابعة'), notes()]),
  proposed(18, 'student-violations', 'مخالفات الطلبة', 'الطلبة', [text('student_name', 'اسم الطالب'), text('grade', 'الصف والشعبة'), notes('incident', 'وصف الواقعة'), notes('action', 'الإجراء'), notes('follow_up', 'المتابعة'), notes()]),
  proposed(19, 'school-visitors', 'زائرو المدرسة', 'الإدارة', [text('visitor', 'اسم الزائر'), text('organization', 'الجهة'), notes('purpose', 'الغرض من الزيارة'), time('arrival_time', 'وقت الدخول'), time('departure_time', 'وقت المغادرة'), notes()]),
  proposed(20, 'student-early-departures', 'خروج الطلبة أثناء الدوام الرسمي', 'الطلبة', [text('student_name', 'اسم الطالب'), text('grade', 'الصف والشعبة'), time('departure_time', 'وقت الخروج'), text('authorized_person', 'الشخص المستلم'), text('approved_by', 'الموافق على الخروج'), notes('reason', 'السبب'), notes()], '/gate-attendance'),
  proposed(21, 'meetings', 'سجل الاجتماعات', 'الإدارة', [text('meeting_number', 'رقم الاجتماع'), text('location', 'مكان الاجتماع'), text('chairperson', 'رئيس الاجتماع'), text('attendees', 'الحضور'), notes('agenda', 'جدول الأعمال'), notes('decisions', 'القرارات'), date('next_follow_up_date', 'تاريخ المتابعة القادمة'), notes('follow_up', 'المتابعة')]),
  proposed(22, 'human-rights', 'سجل حقوق الإنسان', 'الأنشطة والجودة', [text('activity_type', 'النشاط أو الموضوع'), text('responsible_person', 'المسؤول'), notes('details', 'التفاصيل'), notes('action', 'الإجراء'), notes()]),
  proposed(23, 'quality', 'سجل الجودة', 'الأنشطة والجودة', [text('indicator', 'المؤشر'), text('responsible_person', 'المسؤول'), notes('evidence', 'الشواهد'), notes('improvement', 'التحسين المقترح'), notes('follow_up', 'المتابعة')]),
  proposed(24, 'decisions', 'سجل القرارات', 'الإدارة', [text('decision_number', 'رقم القرار'), text('authority', 'جهة الإصدار'), notes('decision', 'نص القرار'), text('responsible_person', 'المكلف بالتنفيذ'), notes('follow_up', 'المتابعة')]),
  proposed(25, 'health-coordinator', 'سجل المنسق الصحي', 'الأنشطة والجودة', [text('coordinator', 'المنسق الصحي'), text('activity_type', 'الموضوع أو النشاط'), notes('observations', 'الملاحظات'), notes('action', 'الإجراء والمتابعة'), notes()]),
  { ...proposed(26, 'control-register', 'سجل السيطرة', 'الإدارة', generic()), description: 'الاسم مثبت في فهرس المدرسة؛ لا يفترض القالب غرضًا محددًا للسجل. يلزم تخصيص الحقول من نموذج المدرسة.' },
  { ...proposed(27, 'development-plan', 'سجل الخطة التطويرية', 'الأنشطة والجودة', [text('domain', 'المجال'), text('standard', 'المعيار'), text('goal', 'هدف التحسين'), notes('activities', 'الإجراءات والأنشطة'), date('start_date', 'تاريخ البدء'), date('due_date', 'موعد الإنجاز'), text('responsible_person', 'المسؤول'), notes('resources', 'الموارد'), notes('verification', 'التحقق'), notes('effectiveness', 'قياس الفاعلية'), notes('indicator', 'مؤشر الإنجاز'), notes('follow_up', 'المتابعة')]), referenceUrl: 'https://www.scribd.com/document/1070921648/المدرسة-المطورة-تربوي', referenceNote: 'نموذج متداول غير رسمي؛ حقول مقترحة قابلة للمراجعة مع المدرسة.' },
  proposed(28, 'academic-level-follow-up', 'متابعة المستويات العلمية', 'الإشراف والتقويم', [text('grade', 'الصف والشعبة'), text('subject', 'المادة'), text('teacher_name', 'المدرس'), notes('assessment', 'المستوى المرصود'), notes('support_plan', 'خطة الدعم'), notes('follow_up', 'نتائج المتابعة')]),
  proposed(29, 'student-admissions', 'قبول الطلبة', 'الطلبة', [text('student_name', 'اسم الطالب'), text('grade', 'الصف المطلوب'), text('guardian_name', 'اسم ولي الأمر'), text('phone', 'رقم الموبايل'), text('admission_status', 'حالة الطلب'), notes()], '/admissions'),
];

/** Concise reviewable wording derived from the photographed 6 + 8 + 6 rubric;
 * these labels do not claim to be a verbatim official transcription. */
export const EVALUATION_CRITERIA_NOTE = 'صياغات مختصرة مقترحة للمراجعة، مستندة إلى مجالات النموذج المصور.';
export const EVALUATION_CRITERIA: { key: string; domain: string; label: string }[] = [
  ['knowledge-1', 'المجال المعرفي', 'معرفة الموضوعات التي يدرسها'],
  ['knowledge-2', 'المجال المعرفي', 'فهم متطلبات المنهج الدراسي'],
  ['knowledge-3', 'المجال المعرفي', 'معرفة كيفية عرض موضوع الدرس للطلاب'],
  ['knowledge-4', 'المجال المعرفي', 'فهم كيفية تعلم الطلاب وتطورهم'],
  ['knowledge-5', 'المجال المعرفي', 'معرفة طرائق التدريس الحديثة'],
  ['knowledge-6', 'المجال المعرفي', 'معرفة أساليب التقييم والاختبار'],
  ['skills-1', 'المجال المهاري', 'شرح الموضوع بوضوح وإلهام الطلاب'],
  ['skills-2', 'المجال المهاري', 'التخطيط للأنشطة التعليمية'],
  ['skills-3', 'المجال المهاري', 'التواصل والتفاعل الفعال مع الطلاب'],
  ['skills-4', 'المجال المهاري', 'تحفيز الطلاب على التعلم'],
  ['skills-5', 'المجال المهاري', 'إدارة الصف الدراسي'],
  ['skills-6', 'المجال المهاري', 'إشراك الطلاب وتنمية مهاراتهم بطرائق حديثة'],
  ['skills-7', 'المجال المهاري', 'تقييم أداء الطلاب والاستفادة من نتائجه'],
  ['skills-8', 'المجال المهاري', 'تمكين التعلم الفعال مع مراعاة الفروق الفردية'],
  ['values-1', 'القيم والاتجاهات', 'الالتزام بالتعليم وتنمية الطلبة'],
  ['values-2', 'القيم والاتجاهات', 'الالتزام بالقيم المهنية والمواطنة والأخلاق'],
  ['values-3', 'القيم والاتجاهات', 'العلاقات الإيجابية مع الطلاب والزملاء والأسر'],
  ['values-4', 'القيم والاتجاهات', 'المشاركة في الأنشطة المدرسية'],
  ['values-5', 'القيم والاتجاهات', 'تطوير الأداء والمهارات المهنية'],
  ['values-6', 'القيم والاتجاهات', 'دعم ذوي الاحتياجات الخاصة واحترام قدراتهم'],
].map(([key, domain, label]) => ({ key, domain, label }));

export class SchoolRegisterValidationError extends Error {}
function valid(condition: unknown, message: string): asserts condition {
  if (!condition) throw new SchoolRegisterValidationError(message);
}
export function registerDefinition(key: unknown): SchoolRegisterDefinition {
  const definition = SCHOOL_REGISTERS.find(item => item.key === key);
  valid(definition, 'نوع السجل غير صالح');
  return definition;
}
function object(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}
export function validRegisterDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
export function parseRegisterData(registerKey: string, input: unknown): Record<string, unknown> {
  const definition = registerDefinition(registerKey);
  valid(object(input), 'بيانات القيد غير صالحة');
  const allowed = new Set([...definition.fields.map(field => field.key), 'extra_fields', ...(registerKey === 'teacher-evaluation' ? ['evaluation'] : [])]);
  valid(Object.keys(input).every(key => allowed.has(key)), 'أضف الحقول المخصصة عبر قائمة الحقول الإضافية');
  const output: Record<string, unknown> = {};
  for (const field of definition.fields) {
    const value = input[field.key];
    const empty = value == null || value === '';
    valid(!field.required || !empty, `الحقل مطلوب: ${field.label}`);
    if (empty) continue;
    if (field.type === 'number') {
      valid(typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1_000_000_000, `قيمة عددية غير صالحة: ${field.label}`);
      if (field.key === 'employee_id') valid(Number.isSafeInteger(value) && value > 0, 'معرف المدرس غير صالح');
      output[field.key] = value;
    } else {
      valid(typeof value === 'string' && value.length <= (field.type === 'textarea' ? 4000 : 500), `نص غير صالح أو طويل: ${field.label}`);
      if (field.type === 'date') valid(validRegisterDate(value), `تاريخ غير صالح: ${field.label}`);
      if (field.type === 'time') valid(/^([01]\d|2[0-3]):[0-5]\d$/.test(value), `وقت غير صالح: ${field.label}`);
      output[field.key] = value.trim();
    }
  }
  // Optional dates can be completed later, but a fully specified period must
  // not end before it starts. Different dates still allow overnight duties.
  if (typeof output.start_date === 'string') {
    for (const endKey of ['end_date', 'due_date']) {
      if (typeof output[endKey] === 'string') valid(output[endKey] >= output.start_date, 'تاريخ النهاية أو الإنجاز يجب ألا يسبق تاريخ البداية');
    }
    if (output.start_date === output.end_date && typeof output.start_time === 'string' && typeof output.end_time === 'string') {
      valid(output.end_time >= output.start_time, 'وقت النهاية يجب ألا يسبق وقت البداية في اليوم نفسه');
    }
  }
  if (input.extra_fields !== undefined) {
    valid(Array.isArray(input.extra_fields) && input.extra_fields.length <= 20, 'يسمح بعشرين حقلًا إضافيًا كحد أقصى');
    output.extra_fields = input.extra_fields.map(item => {
      valid(object(item) && Object.keys(item).every(key => key === 'label' || key === 'value'), 'الحقل الإضافي غير صالح');
      valid(typeof item.label === 'string' && item.label.trim().length > 0 && item.label.trim().length <= 120, 'عنوان الحقل الإضافي مطلوب وبحد أقصى 120 حرفًا');
      valid(typeof item.value === 'string' && item.value.length <= 2000, 'قيمة الحقل الإضافي نص وبحد أقصى 2000 حرف');
      return { label: item.label.trim(), value: item.value.trim() };
    });
  }
  if (registerKey === 'teacher-evaluation') {
    const evaluation = input.evaluation;
    valid(object(evaluation) && Object.keys(evaluation).every(key => key === 'visits'), 'بيانات التقويم غير صالحة');
    valid(Array.isArray(evaluation.visits) && evaluation.visits.length === 4, 'التقويم يتطلب أربعة أعمدة للزيارات');
    output.evaluation = { visits: evaluation.visits.map(visit => {
      valid(object(visit) && Object.keys(visit).every(key => key === 'date' || key === 'scores'), 'بيانات الزيارة غير صالحة');
      valid(visit.date === null || visit.date === '' || validRegisterDate(visit.date), 'تاريخ الزيارة غير صالح');
      valid(Array.isArray(visit.scores) && visit.scores.length === 20, 'كل زيارة تتطلب عشرين خانة تقويم');
      valid(visit.scores.every(score => score === null || (typeof score === 'number' && Number.isInteger(score) && score >= 1 && score <= 5)), 'درجة التقويم عدد صحيح من 1 إلى 5 أو خانة فارغة');
      return { date: visit.date || null, scores: [...visit.scores] };
    }) };
  }
  valid(JSON.stringify(output).length <= 24_000, 'بيانات القيد كبيرة جدًا');
  return output;
}
