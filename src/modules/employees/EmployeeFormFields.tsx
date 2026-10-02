import { Plus, Trash2 } from 'lucide-react';

export const employeeTypeLabels: Record<string, string> = {
  teacher: 'مدرس', administrator: 'إداري', accountant: 'محاسب', registrar: 'مسجل',
  principal: 'مدير المدرسة', worker: 'عامل', driver: 'سائق', other: 'أخرى',
};
export const salaryTypeLabels: Record<string, string> = {
  monthly: 'شهري', hourly: 'بالساعة', daily: 'يومي', weekly: 'أسبوعي', contract: 'بالعقد', other: 'أخرى',
};

export interface QualificationDraft {
  degree: string;
  general_specialization: string;
  specific_specialization: string;
  institution: string;
  college: string;
  graduation_date: string;
  is_primary: boolean;
}

export interface EmployeeDraft {
  full_name: string;
  employee_number: string;
  phone: string;
  email: string;
  address: string;
  gender: string;
  role: string;
  job_title: string;
  employee_type: string;
  salary_type: string;
  salary_amount: string | number;
  hire_date: string;
  commencement_date: string;
  notes: string;
  qualifications: QualificationDraft[];
}

export function emptyEmployeeDraft(): EmployeeDraft {
  return {
    full_name: '', employee_number: '', phone: '', email: '', address: '', gender: '',
    role: 'staff', job_title: '', employee_type: 'other', salary_type: 'monthly', salary_amount: '',
    hire_date: '', commencement_date: '', notes: '', qualifications: [],
  };
}

export function employeeDraftFrom(record: Record<string, unknown>): EmployeeDraft {
  const draft = emptyEmployeeDraft();
  for (const key of Object.keys(draft) as (keyof EmployeeDraft)[]) {
    if (key === 'qualifications') continue;
    if (record[key] !== undefined && record[key] !== null) (draft as unknown as Record<string, unknown>)[key] = record[key];
  }
  draft.qualifications = Array.isArray(record.qualifications) ? record.qualifications.map(q => ({
    degree: q.degree || '', general_specialization: q.general_specialization || '',
    specific_specialization: q.specific_specialization || '', institution: q.institution || '', college: q.college || '',
    graduation_date: q.graduation_date || '', is_primary: Boolean(q.is_primary),
  })) : [];
  return draft;
}

export function validateEmployeeDraft(draft: EmployeeDraft): string | null {
  if (!draft.full_name.trim()) return 'اسم الموظف مطلوب';
  const salary = Number(draft.salary_amount);
  if (!Number.isSafeInteger(salary) || salary < 0) return 'أدخل راتباً صحيحاً غير سالب بالدينار العراقي';
  if (draft.qualifications.length > 12) return 'يمكن تسجيل 12 مؤهلاً كحد أقصى';
  if (draft.qualifications.some(q => !q.degree.trim())) return 'أدخل اسم الشهادة لكل مؤهل أو احذف المؤهل الفارغ';
  if (draft.qualifications.length && draft.qualifications.filter(q => q.is_primary).length !== 1) return 'اختر مؤهلاً واحداً ليظهر في سجل الكادر';
  for (const value of [draft.hire_date, draft.commencement_date, ...draft.qualifications.map(q => q.graduation_date)]) {
    if (!value) continue;
    const date = new Date(`${value}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) < 1900 || Number(value.slice(0, 4)) > 2200 || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return 'أدخل تاريخاً صالحاً بين 1900 و2200';
  }
  return null;
}

export function employeeDraftPayload(draft: EmployeeDraft) {
  return { ...draft, full_name: draft.full_name.trim(), salary_amount: Number(draft.salary_amount), gender: draft.gender || null };
}

const fieldClass = 'mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:bg-gray-100';

export function EmployeeFormFields({ value, onChange, disabled = false }: {
  value: EmployeeDraft;
  onChange: (value: EmployeeDraft) => void;
  disabled?: boolean;
}) {
  const change = (key: keyof EmployeeDraft, next: string) => onChange({ ...value, [key]: next });
  const textField = (key: keyof EmployeeDraft, label: string, type = 'text', required = false, maxLength = 250) => (
    <label className="block text-sm font-medium text-gray-700" key={key}>{label}{required && <span className="text-red-500"> *</span>}
      <input name={key} className={fieldClass} type={type} required={required} maxLength={maxLength} min={type === 'date' ? '1900-01-01' : undefined} max={type === 'date' ? '2200-12-31' : undefined}
        value={String(value[key] ?? '')} onChange={e => change(key, e.target.value)} />
    </label>
  );
  const qualificationFields: [keyof QualificationDraft, string, string?][] = [
    ['degree', 'الشهادة'], ['general_specialization', 'الاختصاص العام'], ['specific_specialization', 'الاختصاص الدقيق'],
    ['institution', 'الجامعة أو المعهد'], ['college', 'الكلية أو القسم'], ['graduation_date', 'تاريخ التخرج', 'date'],
  ];
  return <fieldset disabled={disabled} className="space-y-5">
    <div className="grid gap-4 sm:grid-cols-2">
      {textField('full_name', 'الاسم الكامل', 'text', true, 200)}
      {textField('employee_number', 'رقم الموظف', 'text', false, 80)}
      {textField('phone', 'الهاتف', 'tel', false, 60)}
      {textField('email', 'البريد الإلكتروني', 'email', false, 254)}
      {textField('address', 'العنوان', 'text', false, 1000)}
      <label className="block text-sm font-medium text-gray-700">الجنس
        <select name="gender" className={fieldClass} value={value.gender} onChange={e => change('gender', e.target.value)}>
          <option value="">غير مسجل</option><option value="male">ذكر</option><option value="female">أنثى</option><option value="other">آخر</option>
        </select>
      </label>
      {textField('job_title', 'المسمى الوظيفي', 'text', false, 200)}
      <label className="block text-sm font-medium text-gray-700">الدور الوظيفي
        <select name="role" className={fieldClass} value={value.role} onChange={e => change('role', e.target.value)}>
          <option value="staff">موظف</option><option value="manager">مدير قسم</option><option value="supervisor">مشرف</option><option value="teacher">مدرس</option>
          {!['staff', 'manager', 'supervisor', 'teacher'].includes(value.role) && <option value={value.role}>{value.role}</option>}
        </select>
      </label>
      <label className="block text-sm font-medium text-gray-700">نوع الموظف
        <select name="employee_type" className={fieldClass} value={value.employee_type} onChange={e => change('employee_type', e.target.value)}>
          {Object.entries(employeeTypeLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </label>
      <label className="block text-sm font-medium text-gray-700">نوع الراتب
        <select name="salary_type" className={fieldClass} value={value.salary_type} onChange={e => change('salary_type', e.target.value)}>
          {Object.entries(salaryTypeLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </label>
      {textField('hire_date', 'تاريخ التعيين', 'date')}
      {textField('commencement_date', 'تاريخ المباشرة', 'date')}
      <label className="block text-sm font-medium text-gray-700">الراتب الأساسي الحالي (IQD)
        <input name="salary_amount" className={fieldClass} type="number" min={0} step={1} value={value.salary_amount} onChange={e => change('salary_amount', e.target.value)} />
      </label>
    </div>
    <p className="text-xs text-gray-500">تاريخ التعيين مستقل عن تاريخ المباشرة. تعديل الراتب الحالي يُستخدم للتوليد المقبل؛ تبقى الرواتب الشهرية المحفوظة كما هي.</p>
    <section className="space-y-3 border-t border-gray-100 pt-4" aria-label="المؤهلات الدراسية">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold text-gray-900">المؤهلات الدراسية</h3>
        <button type="button" className="flex items-center gap-1 rounded-lg border border-primary-200 px-3 py-2 text-sm text-primary-700 disabled:opacity-50"
          disabled={disabled || value.qualifications.length >= 12}
          onClick={() => onChange({ ...value, qualifications: [...value.qualifications, { degree: '', general_specialization: '', specific_specialization: '', institution: '', college: '', graduation_date: '', is_primary: value.qualifications.length === 0 }] })}>
          <Plus size={16} /> إضافة مؤهل
        </button>
      </div>
      {value.qualifications.length === 0 && <p className="text-sm text-gray-500">لا توجد مؤهلات مسجلة. يمكن إضافة أكثر من شهادة.</p>}
      {value.qualifications.map((qualification, index) => <fieldset key={index} className="rounded-xl border border-gray-200 bg-gray-50 p-4" data-testid={`qualification-${index}`}>
        <legend className="px-2 text-sm font-medium">المؤهل {index + 1}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {qualificationFields.map(([key, label, type]) => <label key={key} className="text-sm text-gray-700">{label}
            <input className={fieldClass} name={`qualifications.${index}.${key}`} type={type || 'text'} required={key === 'degree'} maxLength={key === 'degree' ? 200 : 250} min={type === 'date' ? '1900-01-01' : undefined} max={type === 'date' ? '2200-12-31' : undefined}
              value={String(qualification[key] ?? '')} onChange={e => onChange({ ...value, qualifications: value.qualifications.map((q, i) => i === index ? { ...q, [key]: e.target.value } : q) })} />
          </label>)}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-sm"><input type="radio" name="primary_qualification" checked={qualification.is_primary}
            onChange={() => onChange({ ...value, qualifications: value.qualifications.map((q, i) => ({ ...q, is_primary: i === index })) })} /> يظهر في سجل الكادر</label>
          <button type="button" className="flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-red-600" aria-label={`حذف المؤهل ${index + 1}`}
            onClick={() => {
              const remaining = value.qualifications.filter((_, i) => i !== index);
              if (qualification.is_primary && remaining.length) remaining[0] = { ...remaining[0], is_primary: true };
              onChange({ ...value, qualifications: remaining });
            }}><Trash2 size={15} /> حذف المؤهل</button>
        </div>
      </fieldset>)}
    </section>
    <label className="block text-sm font-medium text-gray-700">ملاحظات إدارية
      <textarea name="notes" className={fieldClass} rows={3} maxLength={4000} value={value.notes} onChange={e => change('notes', e.target.value)} />
    </label>
  </fieldset>;
}
