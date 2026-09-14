import { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useTenantSchool } from '../../hooks/useTenantSchool';
import { useSchoolRequestGuard } from '../../hooks/useSchoolRequestGuard';
import { SystemAdminSchoolSelector } from '../../components/SystemAdminSchoolSelector';
import {
  getOfficialBookTemplates, createOfficialBookTemplate, updateOfficialBookTemplate,
  getOfficialBooks, createOfficialBook, cancelOfficialBook,
  verifyOfficialBook, getStudents, getEmployees
} from '../../lib/api';
import {
  FileText, Printer, CheckCircle, AlertCircle,
  Loader2, XCircle, Eye, Archive, BookOpen, CheckSquare, Sparkles
} from 'lucide-react';
import type { RoleKey } from '../../types';
import type { OfficialBookTemplateField } from '../../lib/officialBookTemplates';
import { officialBookTemplateDefaults } from '../../lib/officialBookTemplates';
import {
  OfficialBookDocument,
  type OfficialBookDocumentRecord,
} from '../../components/officialBooks/OfficialBookDocument';
import {
  OFFICIAL_BOOK_ACCESS_ROLES,
  OFFICIAL_BOOK_VIEW_ROLES,
  SCHOOL_MANAGEMENT_ROLES,
  hasRole,
} from '../../lib/rbac';

/* ─── Helpers ─── */
function canManageTemplates(roleKey?: RoleKey): boolean {
  return hasRole(roleKey, SCHOOL_MANAGEMENT_ROLES);
}
function canManageBooks(roleKey?: RoleKey): boolean {
  return hasRole(roleKey, OFFICIAL_BOOK_ACCESS_ROLES);
}
function canViewBooks(roleKey?: RoleKey): boolean {
  return hasRole(roleKey, OFFICIAL_BOOK_VIEW_ROLES);
}

function statusBadge(status: string | null) {
  if (!status) return <span className="text-gray-400">—</span>;
  const cls =
    status === 'active' ? 'bg-emerald-100 text-emerald-700' :
    status === 'cancelled' ? 'bg-red-100 text-red-700' :
    'bg-gray-100 text-gray-700';
  const label =
    status === 'active' ? 'فعّال' :
    status === 'cancelled' ? 'ملغى' :
    status;
  return <span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${cls}`}>{label}</span>;
}

/* ─── Types ─── */
type TabKey = 'templates' | 'generate' | 'list' | 'verify';

interface TemplateRecord {
  id?: number;
  preset_key?: string;
  source?: 'builtin' | 'school';
  category?: string;
  title: string;
  description?: string;
  body_text: string;
  paper_size: string;
  requires_student: number | boolean;
  requires_employee: number | boolean;
  status: string;
  fields?: OfficialBookTemplateField[];
}

interface BookRecord extends OfficialBookDocumentRecord {
  school_id: number;
  paper_size: string;
  student_name?: string;
  employee_name?: string;
  created_by_name?: string;
  printed_at?: number | null;
}

interface StudentOption { id: number; full_name: string; student_number: string; }
interface EmployeeOption { id: number; full_name: string; job_title: string; }

const SYSTEM_BOOK_FIELDS = new Set([
  'school_name', 'principal_name', 'student_name', 'student_number', 'class_name',
  'section_name', 'academic_year', 'employee_name', 'employee_position', 'date',
  'document_number',
]);

function inferredCustomFields(bodyText: string): OfficialBookTemplateField[] {
  const keys = Array.from(new Set(
    Array.from(bodyText.matchAll(/\{\{([a-z][a-z0-9_]*)\}\}/gi), match => match[1]),
  )).filter(key => !SYSTEM_BOOK_FIELDS.has(key));
  return keys.map(key => ({
    key,
    label: key.replace(/_/g, ' '),
    type: 'text' as const,
    required: true,
    max_length: 2_000,
  }));
}

const TAB_CONFIG: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: 'templates', label: 'القوالب', icon: <BookOpen size={18} /> },
  { key: 'generate', label: 'إنشاء كتاب رسمي', icon: <FileText size={18} /> },
  { key: 'list', label: 'الكتب المنشأة', icon: <BookOpen size={18} /> },
  { key: 'verify', label: 'التحقق من كتاب', icon: <CheckSquare size={18} /> },
];

/* ═══════════════════════════════════════
   Main Page
   ═══════════════════════════════════════ */
export default function OfficialBooksPage() {
  const { user } = useAuth();
  const schoolScope = useTenantSchool();
  const { schoolId } = schoolScope;
  const [activeTab, setActiveTab] = useState<TabKey>('list');

  if (!canViewBooks(user?.role_key)) {
    return (
      <div className="p-8 text-center" dir="rtl">
        <AlertCircle className="mx-auto text-red-500 mb-3" size={48} />
        <h2 className="text-xl font-bold text-red-700">غير مسموح</h2>
        <p className="text-gray-600 mt-2">لا تملك صلاحية الوصول إلى الكتب الرسمية</p>
      </div>
    );
  }

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-primary-50 rounded-lg flex items-center justify-center">
          <FileText size={20} className="text-primary-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">الكتب الرسمية</h1>
          <p className="text-sm text-gray-500">إنشاء وإدارة الكتب الرسمية والقوالب</p>
        </div>
      </div>

      <SystemAdminSchoolSelector {...schoolScope} />

      {/* Tabs */}
      <div className="flex gap-2 border-b border-gray-200 pb-1 overflow-x-auto">
        {TAB_CONFIG.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-t-lg text-sm font-medium whitespace-nowrap transition-colors ${
              activeTab === tab.key
                ? 'bg-primary-50 text-primary-700 border-b-2 border-primary-600'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'templates' && <TemplatesTab user={user} schoolId={schoolId} />}
      {activeTab === 'generate' && <GenerateTab user={user} schoolId={schoolId} />}
      {activeTab === 'list' && <ListTab user={user} schoolId={schoolId} />}
      {activeTab === 'verify' && <VerifyTab />}
    </div>
  );
}

/* ═══════════════════════════════════════
   Templates Tab
   ═══════════════════════════════════════ */
function TemplatesTab({ user, schoolId }: { user: any; schoolId: number | null }) {
  const captureSchoolRequest = useSchoolRequestGuard(schoolId);
  const [templates, setTemplates] = useState<TemplateRecord[]>([]);
  const [presets, setPresets] = useState<TemplateRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState({
    title: '', body_text: '', paper_size: 'A4', requires_student: false, requires_employee: false
  });

  const fetchTemplates = async () => {
    if (schoolId == null) { setTemplates([]); setLoading(false); return; }
    const isCurrent = captureSchoolRequest();
    setLoading(true);
    try {
      const res = await getOfficialBookTemplates(schoolId);
      if (!isCurrent()) return;
      if (res.error) throw new Error(res.error);
      setTemplates((res.data || []) as TemplateRecord[]);
      setPresets((res.meta?.presets || []) as TemplateRecord[]);
    } catch (e: any) {
      if (!isCurrent()) return;
      setError(e?.message || 'فشل في جلب القوالب');
    } finally { if (isCurrent()) setLoading(false); }
  };

  useEffect(() => {
    setTemplates([]);
    setPresets([]);
    setShowForm(false);
    setEditingId(null);
    setFormData({ title: '', body_text: '', paper_size: 'A4', requires_student: false, requires_employee: false });
    setError('');
    setLoading(false);
    void fetchTemplates();
  }, [schoolId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (schoolId == null) return;
    const isCurrent = captureSchoolRequest();
    try {
      let result;
      if (editingId) {
        result = await updateOfficialBookTemplate(editingId, formData, schoolId);
      } else {
        result = await createOfficialBookTemplate(formData, schoolId);
      }
      if (!isCurrent()) return;
      if (result.error) {
        setError(result.error);
        return;
      }
      setShowForm(false);
      setEditingId(null);
      setFormData({ title: '', body_text: '', paper_size: 'A4', requires_student: false, requires_employee: false });
      await fetchTemplates();
    } catch (e: any) {
      if (!isCurrent()) return;
      alert(e?.error || 'فشل في حفظ القالب');
    }
  };

  const startEdit = (t: TemplateRecord) => {
    if (t.id == null) return;
    setEditingId(t.id);
    setFormData({
      title: t.title, body_text: t.body_text, paper_size: t.paper_size || 'A4',
      requires_student: !!t.requires_student, requires_employee: !!t.requires_employee
    });
    setShowForm(true);
  };

  const archiveTemplate = async (id: number) => {
    if (schoolId == null) return;
    if (!confirm('هل أنت متأكد من أرشفة هذا القالب؟')) return;
    const isCurrent = captureSchoolRequest();
    try {
      const result = await updateOfficialBookTemplate(id, { status: 'archived' }, schoolId);
      if (!isCurrent()) return;
      if (result.error) {
        setError(result.error);
        return;
      }
      await fetchTemplates();
    } catch (e: any) {
      if (!isCurrent()) return;
      alert(e?.error || 'فشل في أرشفة القالب');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-bold">قوالب الكتب الرسمية</h3>
        {canManageTemplates(user?.role_key) && schoolId != null && (
          <button
            onClick={() => { setShowForm(true); setEditingId(null); setFormData({ title: '', body_text: '', paper_size: 'A4', requires_student: false, requires_employee: false }); }}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-700"
          >
            + قالب جديد
          </button>
        )}
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white p-4 rounded-lg border border-gray-200 space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">عنوان القالب</label>
            <input type="text" required value={formData.title} onChange={e => setFormData({ ...formData, title: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">نص الكتاب (يدعم المتغيرات)</label>
            <textarea required rows={6} value={formData.body_text} onChange={e => setFormData({ ...formData, body_text: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm font-mono" placeholder="{{school_name}} ... {{student_name}} ... {{date}}" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <select value={formData.paper_size} onChange={e => setFormData({ ...formData, paper_size: e.target.value })} className="px-3 py-2 border rounded-lg text-sm">
              <option value="A4">A4</option>
              <option value="A5">A5</option>
              <option value="Letter">Letter</option>
            </select>
            <div className="flex gap-4 items-center">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={formData.requires_student} onChange={e => setFormData({ ...formData, requires_student: e.target.checked })} />
                يتطلب طالب
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={formData.requires_employee} onChange={e => setFormData({ ...formData, requires_employee: e.target.checked })} />
                يتطلب موظف
              </label>
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-700">{editingId ? 'تحديث' : 'إنشاء'}</button>
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm">إلغاء</button>
          </div>
        </form>
      )}

      {loading ? <div className="text-center py-8"><Loader2 className="animate-spin mx-auto" /></div> :
       error ? <div className="text-red-600 text-center py-8">{error}</div> :
       <div className="space-y-6">
         <section>
           <div className="mb-3 flex items-center gap-2">
             <Sparkles size={18} className="text-amber-600" />
             <h4 className="font-bold text-gray-900">قوالب عراقية جاهزة</h4>
             <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">{presets.length}</span>
           </div>
           <p className="mb-3 text-xs leading-relaxed text-gray-500">
             صيغ إرشادية قابلة للتعديل قبل الإصدار؛ راجع الجهة والغرض والأسماء حسب تعليمات مديريتك.
           </p>
           {presets.length === 0 ? (
             <div className="rounded-lg border border-dashed border-gray-300 py-6 text-center text-sm text-gray-500">تعذر تحميل القوالب الجاهزة</div>
           ) : (
             <div className="grid gap-3 md:grid-cols-2">
               {presets.map(t => (
                 <article key={t.preset_key} className="rounded-xl border border-amber-200 bg-gradient-to-br from-white to-amber-50/60 p-4">
                   <div className="flex items-start gap-3">
                     <span className="mt-0.5 rounded-lg bg-amber-100 p-2 text-amber-700"><FileText size={17} /></span>
                     <div>
                       <h5 className="font-bold text-gray-900">{t.title}</h5>
                       <p className="mt-1 text-xs leading-relaxed text-gray-600">{t.description}</p>
                       <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                         <span className="rounded bg-white px-2 py-1 text-gray-600">A4</span>
                         {!!t.requires_student && <span className="rounded bg-blue-50 px-2 py-1 text-blue-700">يرتبط بطالب</span>}
                         {!!t.requires_employee && <span className="rounded bg-violet-50 px-2 py-1 text-violet-700">يرتبط بموظف</span>}
                       </div>
                     </div>
                   </div>
                 </article>
               ))}
             </div>
           )}
         </section>

         <section>
           <h4 className="mb-3 font-bold text-gray-900">قوالب المدرسة الخاصة</h4>
           {templates.length === 0 ? <div className="rounded-lg border border-dashed border-gray-300 py-6 text-center text-sm text-gray-500">لا توجد قوالب خاصة بعد</div> :
           <div className="grid gap-3">
         {templates.map(t => (
           <div key={t.id} className="bg-white p-4 rounded-lg border border-gray-200 flex justify-between items-start">
             <div className="space-y-1">
               <div className="font-bold text-gray-900">{t.title}</div>
               <div className="text-sm text-gray-500">{t.paper_size} | {t.requires_student ? 'يتطلب طالب' : ''} {t.requires_employee ? 'يتطلب موظف' : ''}</div>
               <div className="text-sm text-gray-600 line-clamp-2">{t.body_text}</div>
               <div>{statusBadge(t.status)}</div>
             </div>
             {canManageTemplates(user?.role_key) && schoolId != null && t.status !== 'archived' && (
               <div className="flex gap-2">
                 <button onClick={() => startEdit(t)} className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg"><Eye size={16} /></button>
                 <button onClick={() => t.id != null && archiveTemplate(t.id)} className="p-2 text-amber-600 hover:bg-amber-50 rounded-lg"><Archive size={16} /></button>
               </div>
             )}
           </div>
         ))}
       </div>}
         </section>
       </div>}
    </div>
  );
}

/* ═══════════════════════════════════════
   Generate Tab
   ═══════════════════════════════════════ */
function GenerateTab({ user, schoolId }: { user: any; schoolId: number | null }) {
  const captureSchoolRequest = useSchoolRequestGuard(schoolId);
  const [templates, setTemplates] = useState<TemplateRecord[]>([]);
  const [presets, setPresets] = useState<TemplateRecord[]>([]);
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [selectedStudent, setSelectedStudent] = useState<number | ''>('');
  const [selectedEmployee, setSelectedEmployee] = useState<number | ''>('');
  const [titleDraft, setTitleDraft] = useState('');
  const [bodyDraft, setBodyDraft] = useState('');
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [generated, setGenerated] = useState<any>(null);

  useEffect(() => {
    setTemplates([]);
    setPresets([]);
    setStudents([]);
    setEmployees([]);
    setSelectedTemplate('');
    setSelectedStudent('');
    setSelectedEmployee('');
    setTitleDraft('');
    setBodyDraft('');
    setFieldValues({});
    setError('');
    setGenerated(null);
    setLoading(false);
    if (schoolId == null) {
      setTemplates([]);
      setStudents([]);
      setEmployees([]);
      return;
    }
    const isCurrent = captureSchoolRequest();
    void Promise.all([
      getOfficialBookTemplates(schoolId),
      getStudents(schoolId),
      getEmployees(schoolId),
    ]).then(([templateResult, studentResult, employeeResult]) => {
      if (!isCurrent()) return;
      if (templateResult.error || studentResult.error || employeeResult.error) {
        setError(templateResult.error || studentResult.error || employeeResult.error || 'فشل تحميل بيانات الكتب الرسمية');
        return;
      }
      setTemplates(((templateResult.data || []) as TemplateRecord[])
        .filter((t) => t.status === 'active')
        .map((t) => ({ ...t, source: 'school' })));
      setPresets((templateResult.meta?.presets || []) as TemplateRecord[]);
      setStudents((studentResult.data || []).map((s: any) => ({ id: s.id, full_name: s.full_name, student_number: s.student_number })));
      setEmployees((employeeResult.data || []).map((e: any) => ({ id: e.id, full_name: e.full_name, job_title: e.job_title })));
    });
  }, [schoolId]);

  const allTemplates = [...presets, ...templates];
  const optionKey = (item: TemplateRecord) => item.source === 'builtin'
    ? `preset:${item.preset_key}`
    : `school:${item.id}`;
  const template = allTemplates.find((item) => optionKey(item) === selectedTemplate);
  const activeFields = template?.fields || (template ? inferredCustomFields(bodyDraft) : []);

  const handleTemplateChange = (value: string) => {
    const nextTemplate = allTemplates.find((item) => optionKey(item) === value);
    setSelectedTemplate(value);
    setSelectedStudent('');
    setSelectedEmployee('');
    setGenerated(null);
    setError('');
    setTitleDraft(nextTemplate?.title || '');
    setBodyDraft(nextTemplate?.body_text || '');
    const nextFields = nextTemplate?.fields || (nextTemplate ? inferredCustomFields(nextTemplate.body_text) : []);
    setFieldValues(nextFields.length > 0
      ? officialBookTemplateDefaults({ fields: nextFields })
      : {});
  };

  const handleGenerate = async () => {
    if (schoolId == null) return;
    if (!selectedTemplate) return;
    if (!template) return;
    const isCurrent = captureSchoolRequest();

    setError('');
    for (const field of activeFields) {
      if (field.required && !(fieldValues[field.key] || '').trim()) {
        setError(`الحقل «${field.label}» مطلوب`);
        return;
      }
    }
    const data: any = {
      title: titleDraft,
      body_text: bodyDraft,
      field_values: fieldValues,
    };
    if (template.source === 'builtin') data.preset_key = template.preset_key;
    else data.template_id = template.id;
    if (template.requires_student) {
      if (!selectedStudent) { setError('هذا القالب يتطلب اختيار طالب'); return; }
      data.student_id = Number(selectedStudent);
    }
    if (template.requires_employee) {
      if (!selectedEmployee) { setError('هذا القالب يتطلب اختيار موظف'); return; }
      data.employee_id = Number(selectedEmployee);
    }

    setLoading(true);
    try {
      const res = await createOfficialBook(data, schoolId);
      if (!isCurrent()) return;
      if (res.error) {
        setError(res.error);
        return;
      }
      setGenerated(res.data);
    } catch (e: any) {
      if (!isCurrent()) return;
      setError(e?.error || 'فشل في إنشاء الكتاب');
    } finally { if (isCurrent()) setLoading(false); }
  };

  if (!canManageBooks(user?.role_key)) {
    return <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">لديك صلاحية عرض الكتب فقط، ولا تملك صلاحية إصدار كتاب جديد.</div>;
  }

  return (
    <div className="max-w-4xl space-y-4">
      <h3 className="text-lg font-bold">إنشاء كتاب رسمي</h3>

      <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-5">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">اختر القالب</label>
          <select value={selectedTemplate} onChange={e => handleTemplateChange(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm">
            <option value="">-- اختر قالب --</option>
            <optgroup label="قوالب عراقية جاهزة">
              {presets.map(t => <option key={t.preset_key} value={optionKey(t)}>{t.title}</option>)}
            </optgroup>
            {templates.length > 0 && (
              <optgroup label="قوالب المدرسة">
                {templates.map(t => <option key={t.id} value={optionKey(t)}>{t.title}</option>)}
              </optgroup>
            )}
          </select>
          {template?.description && <p className="mt-2 text-xs leading-relaxed text-gray-500">{template.description}</p>}
        </div>

        {template?.requires_student && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">اختر الطالب</label>
            <select value={selectedStudent} onChange={e => setSelectedStudent(Number(e.target.value) || '')} className="w-full px-3 py-2 border rounded-lg text-sm">
              <option value="">-- اختر طالب --</option>
              {students.map(s => <option key={s.id} value={s.id}>{s.full_name} ({s.student_number})</option>)}
            </select>
          </div>
        )}

        {template?.requires_employee && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">اختر الموظف</label>
            <select value={selectedEmployee} onChange={e => setSelectedEmployee(Number(e.target.value) || '')} className="w-full px-3 py-2 border rounded-lg text-sm">
              <option value="">-- اختر موظف --</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.full_name} — {e.job_title}</option>)}
            </select>
          </div>
        )}

        {template && activeFields.length > 0 && (
          <fieldset className="rounded-xl border border-blue-100 bg-blue-50/40 p-4">
            <legend className="px-2 text-sm font-bold text-blue-900">بيانات الكتاب المتغيرة</legend>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {activeFields.map(field => (
                <label key={field.key} className={field.type === 'textarea' ? 'md:col-span-2' : ''}>
                  <span className="mb-1 block text-sm font-medium text-gray-700">
                    {field.label}{field.required && <span className="mr-1 text-red-600">*</span>}
                  </span>
                  {field.type === 'textarea' ? (
                    <textarea
                      rows={4}
                      value={fieldValues[field.key] || ''}
                      onChange={event => setFieldValues(prev => ({ ...prev, [field.key]: event.target.value }))}
                      maxLength={field.max_length}
                      placeholder={field.placeholder}
                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                    />
                  ) : (
                    <input
                      type="text"
                      value={fieldValues[field.key] || ''}
                      onChange={event => setFieldValues(prev => ({ ...prev, [field.key]: event.target.value }))}
                      maxLength={field.max_length}
                      placeholder={field.placeholder}
                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                    />
                  )}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {template && (
          <details className="rounded-xl border border-gray-200" open={template.source === 'school'}>
            <summary className="cursor-pointer px-4 py-3 text-sm font-bold text-gray-700">مراجعة النص وتعديله قبل الإصدار</summary>
            <div className="space-y-3 border-t border-gray-200 p-4">
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">عنوان الكتاب</span>
                <input type="text" value={titleDraft} onChange={event => setTitleDraft(event.target.value)} maxLength={180} className="w-full rounded-lg border px-3 py-2 text-sm" />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">نص الكتاب</span>
                <textarea dir="rtl" rows={13} value={bodyDraft} onChange={event => setBodyDraft(event.target.value)} maxLength={12_000} className="w-full rounded-lg border px-3 py-2 text-sm leading-relaxed" />
              </label>
              <p className="text-xs leading-relaxed text-gray-500">
                اترك المتغيرات بين الأقواس كما هي ليملأها النظام، مثل {'{{student_name}}'} و{'{{academic_year}}'}. التعديل يخص هذا الإصدار ولا يغيّر أصل القالب الجاهز.
              </p>
            </div>
          </details>
        )}

        {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <button
          onClick={handleGenerate}
          disabled={loading || !selectedTemplate}
          className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-700 disabled:opacity-50 flex items-center gap-2"
        >
          {loading ? <Loader2 className="animate-spin" size={16} /> : <FileText size={16} />}
          إنشاء الكتاب
        </button>
      </div>

      {generated && (
        <div className="bg-emerald-50 p-4 rounded-lg border border-emerald-200">
          <div className="flex items-center gap-2 text-emerald-700 font-bold mb-2">
            <CheckCircle size={20} />
            تم إنشاء الكتاب بنجاح
          </div>
          <div className="text-sm text-emerald-800 space-y-1">
            <div>رقم الكتاب: {generated.document_number}</div>
            <div className="break-all">رمز التحقق: {generated.verification_token}</div>
          </div>
          <a href={`/print/official-book/${generated.id}`} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800">
            <Printer size={16} /> معاينة A4 والطباعة
          </a>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════
   List Tab
   ═══════════════════════════════════════ */
function ListTab({ user, schoolId }: { user: any; schoolId: number | null }) {
  const captureSchoolRequest = useSchoolRequestGuard(schoolId);
  const [books, setBooks] = useState<BookRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewBook, setPreviewBook] = useState<BookRecord | null>(null);

  const fetchBooks = async () => {
    if (schoolId == null) { setBooks([]); setLoading(false); return; }
    const isCurrent = captureSchoolRequest();
    setLoading(true);
    try {
      const res = await getOfficialBooks(schoolId);
      if (!isCurrent()) return;
      if (res.error) throw new Error(res.error);
      setBooks((res.data || []) as BookRecord[]);
    } catch (e: any) { alert(e?.message || 'فشل في جلب الكتب الرسمية'); }
    finally { if (isCurrent()) setLoading(false); }
  };

  useEffect(() => {
    setBooks([]);
    setPreviewBook(null);
    setLoading(false);
    void fetchBooks();
  }, [schoolId]);

  const handleCancel = async (id: number) => {
    if (schoolId == null) return;
    if (!confirm('هل أنت متأكد من إلغاء هذا الكتاب؟')) return;
    const isCurrent = captureSchoolRequest();
    try {
      const result = await cancelOfficialBook(id, schoolId);
      if (!isCurrent()) return;
      if (result.error) {
        alert(result.error);
        return;
      }
      await fetchBooks();
    } catch (e) { alert('فشل في الإلغاء'); }
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold">الكتب الرسمية المنشأة</h3>

      {loading ? <div className="text-center py-8"><Loader2 className="animate-spin mx-auto" /></div> :
       books.length === 0 ? <div className="text-gray-500 text-center py-8">لا توجد كتب منشأة</div> :
       <div className="grid gap-3">
         {books.map(b => (
           <div key={b.id} className="bg-white p-4 rounded-lg border border-gray-200 flex justify-between items-start">
             <div className="space-y-1">
               <div className="font-bold text-gray-900">{b.title}</div>
               <div className="text-sm text-gray-500">{b.document_number} | {b.paper_size}</div>
               {(b.student_name || b.employee_name) && (
                 <div className="text-sm text-gray-600">{b.student_name || b.employee_name}</div>
               )}
               <div className="flex gap-2 items-center">
                 {statusBadge(b.status)}
                 {b.printed_at && <span className="px-2 py-0.5 rounded-md text-xs font-semibold bg-blue-100 text-blue-700">مطبوع</span>}
               </div>
             </div>
             <div className="flex gap-2">
               <button onClick={() => { setPreviewBook(b); }} className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg" title="معاينة"><Eye size={16} /></button>
               {canManageBooks(user?.role_key) && schoolId != null && b.status === 'active' && (
                 <>
                   <a href={`/print/official-book/${b.id}`} className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg inline-flex items-center" title="معاينة A4 والطباعة"><Printer size={16} /></a>
                   <button onClick={() => handleCancel(b.id)} className="p-2 text-red-600 hover:bg-red-50 rounded-lg" title="إلغاء"><XCircle size={16} /></button>
                 </>
               )}
             </div>
           </div>
         ))}
       </div>}

      {/* Preview Modal */}
      {previewBook && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-4 border-b flex justify-between items-center">
              <h3 className="font-bold">معاينة الكتاب</h3>
              <button onClick={() => setPreviewBook(null)} className="p-1 hover:bg-gray-100 rounded"><XCircle size={20} /></button>
            </div>
            <div className="bg-gray-100 p-4 md:p-8">
              <div className="mx-auto max-w-[210mm] bg-white p-8 shadow-sm">
                <OfficialBookDocument
                  book={previewBook}
                  verificationUrl={`${window.location.origin}/verify/official-book/${previewBook.verification_token}`}
                />
              </div>
            </div>
            <div className="p-4 border-t flex gap-2 print:hidden">
              <a href={`/print/official-book/${previewBook.id}`} className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-700 flex items-center gap-2">
                <Printer size={16} /> فتح معاينة A4 والطباعة
              </a>
              <button onClick={() => setPreviewBook(null)} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm">إغلاق</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════
   Verify Tab
   ═══════════════════════════════════════ */
function VerifyTab() {
  const [token, setToken] = useState('');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleVerify = async () => {
    if (!token.trim()) return;
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const res = await verifyOfficialBook(token.trim());
      setResult(res.data);
    } catch (e: any) {
      setError(e?.data?.message || e?.error || 'فشل في التحقق');
    } finally { setLoading(false); }
  };

  return (
    <div className="space-y-4 max-w-xl">
      <h3 className="text-lg font-bold">التحقق من كتاب رسمي</h3>
      <div className="bg-white p-4 rounded-lg border border-gray-200 space-y-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">رمز التحقق</label>
          <input type="text" value={token} onChange={e => setToken(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="أدخل رمز التحقق..." />
        </div>
        <button onClick={handleVerify} disabled={loading} className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-700 disabled:opacity-50 flex items-center gap-2">
          {loading ? <Loader2 className="animate-spin" size={16} /> : <CheckSquare size={16} />}
          تحقق
        </button>
      </div>

      {result && (
        <div className={`p-4 rounded-lg border ${result.valid ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
          <div className={`flex items-center gap-2 font-bold mb-2 ${result.valid ? 'text-emerald-700' : 'text-red-700'}`}>
            {result.valid ? <CheckCircle size={20} /> : <AlertCircle size={20} />}
            {result.valid ? 'الكتاب صالح' : 'الكتاب غير صالح'}
          </div>
          {result.valid && (
            <div className="text-sm space-y-1">
              <div><span className="font-medium">العنوان:</span> {result.title}</div>
              <div><span className="font-medium">رقم الكتاب:</span> {result.document_number}</div>
              <div><span className="font-medium">المدرسة:</span> {result.school_name}</div>
              {result.student_name && <div><span className="font-medium">الطالب:</span> {result.student_name}</div>}
              {result.employee_name && <div><span className="font-medium">الموظف:</span> {result.employee_name}</div>}
              <div><span className="font-medium">الحالة:</span> {result.status === 'active' ? 'فعّال' : result.status}</div>
              {result.cancelled_warning && <div className="text-red-600 font-bold">{result.cancelled_warning}</div>}
              {result.verification_note && <div className="text-xs text-gray-500 mt-2">{result.verification_note}</div>}
            </div>
          )}
        </div>
      )}

      {error && <div className="text-red-600 text-sm">{error}</div>}
    </div>
  );
}
