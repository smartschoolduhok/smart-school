import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../hooks/useAuth';
import {
  getOfficialBookTemplates, createOfficialBookTemplate, updateOfficialBookTemplate,
  getOfficialBooks, createOfficialBook, cancelOfficialBook, printOfficialBook,
  verifyOfficialBook, getStudents, getEmployees
} from '../../lib/api';
import { toArabicDigits } from '../../lib/arabicDigits';
import {
  FileText, Printer, Search, User, Briefcase, CheckCircle, AlertCircle,
  Loader2, QrCode, XCircle, Eye, Archive, BookOpen, CheckSquare, Globe
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';

/* ─── Helpers ─── */
function canManageTemplates(roleKey?: string): boolean {
  return ['system_admin', 'school_owner', 'principal'].includes(roleKey || '');
}
function canManageBooks(roleKey?: string): boolean {
  return ['system_admin', 'school_owner', 'principal', 'vice_principal', 'registrar'].includes(roleKey || '');
}
function canViewBooks(roleKey?: string): boolean {
  return ['system_admin', 'school_owner', 'principal', 'vice_principal', 'registrar', 'teacher'].includes(roleKey || '');
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
  id: number;
  title: string;
  body_text: string;
  paper_size: string;
  requires_student: number;
  requires_employee: number;
  status: string;
}

interface BookRecord {
  id: number;
  document_number: string;
  title: string;
  body_text: string;
  paper_size: string;
  status: string;
  student_name?: string;
  employee_name?: string;
  created_by_name?: string;
  created_at: string;
  verification_token: string;
  printed_at?: number | null;
  settings_snapshot_json?: string;
  school_name_snapshot?: string;
}

interface StudentOption { id: number; full_name: string; student_number: string; }
interface EmployeeOption { id: number; full_name: string; job_title: string; }

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
      {activeTab === 'templates' && <TemplatesTab user={user} />}
      {activeTab === 'generate' && <GenerateTab user={user} />}
      {activeTab === 'list' && <ListTab user={user} />}
      {activeTab === 'verify' && <VerifyTab />}
    </div>
  );
}

/* ═══════════════════════════════════════
   Templates Tab
   ═══════════════════════════════════════ */
function TemplatesTab({ user }: { user: any }) {
  const [templates, setTemplates] = useState<TemplateRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState({
    title: '', body_text: '', paper_size: 'A4', requires_student: false, requires_employee: false
  });

  const fetchTemplates = async () => {
    setLoading(true);
    try {
      const res = await getOfficialBookTemplates(user?.school_id || null);
      setTemplates((res.data || []) as TemplateRecord[]);
    } catch (e: any) {
      setError(e?.message || 'فشل في جلب القوالب');
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchTemplates(); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingId) {
        await updateOfficialBookTemplate(editingId, formData, user?.school_id || null);
      } else {
        await createOfficialBookTemplate(formData, user?.school_id || null);
      }
      setShowForm(false);
      setEditingId(null);
      setFormData({ title: '', body_text: '', paper_size: 'A4', requires_student: false, requires_employee: false });
      await fetchTemplates();
    } catch (e: any) {
      alert(e?.error || 'فشل في حفظ القالب');
    }
  };

  const startEdit = (t: TemplateRecord) => {
    setEditingId(t.id);
    setFormData({
      title: t.title, body_text: t.body_text, paper_size: t.paper_size || 'A4',
      requires_student: !!t.requires_student, requires_employee: !!t.requires_employee
    });
    setShowForm(true);
  };

  const archiveTemplate = async (id: number) => {
    if (!confirm('هل أنت متأكد من أرشفة هذا القالب؟')) return;
    try {
      await updateOfficialBookTemplate(id, { status: 'archived' }, user?.school_id || null);
      await fetchTemplates();
    } catch (e: any) {
      alert(e?.error || 'فشل في أرشفة القالب');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-bold">قوالب الكتب الرسمية</h3>
        {canManageTemplates(user?.role_key) && (
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
       templates.length === 0 ? <div className="text-gray-500 text-center py-8">لا توجد قوالب</div> :
       <div className="grid gap-3">
         {templates.map(t => (
           <div key={t.id} className="bg-white p-4 rounded-lg border border-gray-200 flex justify-between items-start">
             <div className="space-y-1">
               <div className="font-bold text-gray-900">{t.title}</div>
               <div className="text-sm text-gray-500">{t.paper_size} | {t.requires_student ? 'يتطلب طالب' : ''} {t.requires_employee ? 'يتطلب موظف' : ''}</div>
               <div className="text-sm text-gray-600 line-clamp-2">{t.body_text}</div>
               <div>{statusBadge(t.status)}</div>
             </div>
             {canManageTemplates(user?.role_key) && t.status !== 'archived' && (
               <div className="flex gap-2">
                 <button onClick={() => startEdit(t)} className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg"><Eye size={16} /></button>
                 <button onClick={() => archiveTemplate(t.id)} className="p-2 text-amber-600 hover:bg-amber-50 rounded-lg"><Archive size={16} /></button>
               </div>
             )}
           </div>
         ))}
       </div>}
    </div>
  );
}

/* ═══════════════════════════════════════
   Generate Tab
   ═══════════════════════════════════════ */
function GenerateTab({ user }: { user: any }) {
  const [templates, setTemplates] = useState<TemplateRecord[]>([]);
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<number | ''>('');
  const [selectedStudent, setSelectedStudent] = useState<number | ''>('');
  const [selectedEmployee, setSelectedEmployee] = useState<number | ''>('');
  const [generated, setGenerated] = useState<any>(null);

  useEffect(() => {
    getOfficialBookTemplates(user?.school_id || null).then(r => setTemplates(((r.data || []) as TemplateRecord[]).filter((t: TemplateRecord) => t.status === 'active')));
    getStudents(user?.school_id || null).then(r => setStudents((r.data || []).map((s: any) => ({ id: s.id, full_name: s.full_name, student_number: s.student_number }))));
    getEmployees(user?.school_id || null).then(r => setEmployees((r.data || []).map((e: any) => ({ id: e.id, full_name: e.full_name, job_title: e.job_title }))));
  }, []);

  const handleGenerate = async () => {
    if (!selectedTemplate) return;
    const template = templates.find(t => t.id === Number(selectedTemplate));
    if (!template) return;

    const data: any = { template_id: Number(selectedTemplate) };
    if (template.requires_student) {
      if (!selectedStudent) { alert('هذا القالب يتطلب اختيار طالب'); return; }
      data.student_id = Number(selectedStudent);
    }
    if (template.requires_employee) {
      if (!selectedEmployee) { alert('هذا القالب يتطلب اختيار موظف'); return; }
      data.employee_id = Number(selectedEmployee);
    }

    setLoading(true);
    try {
      const res = await createOfficialBook(data, user?.school_id || null);
      setGenerated(res.data);
    } catch (e: any) {
      alert(e?.error || 'فشل في إنشاء الكتاب');
    } finally { setLoading(false); }
  };

  const template = templates.find(t => t.id === Number(selectedTemplate));

  return (
    <div className="space-y-4 max-w-2xl">
      <h3 className="text-lg font-bold">إنشاء كتاب رسمي</h3>

      <div className="bg-white p-4 rounded-lg border border-gray-200 space-y-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">اختر القالب</label>
          <select value={selectedTemplate} onChange={e => setSelectedTemplate(Number(e.target.value) || '')} className="w-full px-3 py-2 border rounded-lg text-sm">
            <option value="">-- اختر قالب --</option>
            {templates.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
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
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════
   List Tab
   ═══════════════════════════════════════ */
function ListTab({ user }: { user: any }) {
  const [books, setBooks] = useState<BookRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewBook, setPreviewBook] = useState<BookRecord | null>(null);
  const printRef = useRef<HTMLDivElement>(null);

  const fetchBooks = async () => {
    setLoading(true);
    try {
      const res = await getOfficialBooks(user?.school_id || null);
      setBooks((res.data || []) as BookRecord[]);
    } catch (e) { /* ignore */ }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchBooks(); }, []);

  const handlePrint = async (book: BookRecord) => {
    try {
      await printOfficialBook(book.id, user?.school_id || null);
      setPreviewBook(book);
      setTimeout(() => window.print(), 300);
    } catch (e) { alert('فشل في تسجيل الطباعة'); }
  };

  const handleCancel = async (id: number) => {
    if (!confirm('هل أنت متأكد من إلغاء هذا الكتاب؟')) return;
    try {
      await cancelOfficialBook(id, user?.school_id || null);
      await fetchBooks();
    } catch (e) { alert('فشل في الإلغاء'); }
  };

  const getPreviewUrl = (token: string) => {
    const base = window.location.origin;
    return `${base}/verify/official-book/${token}`;
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
               {canManageBooks(user?.role_key) && b.status === 'active' && (
                 <>
                   <button onClick={() => handlePrint(b)} className="p-2 text-primary-600 hover:bg-primary-50 rounded-lg" title="طباعة / حفظ PDF"><Printer size={16} /></button>
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
            <div ref={printRef} className="p-8 space-y-6 print:p-0">
              <PrintPreview book={previewBook} />
            </div>
            <div className="p-4 border-t flex gap-2 print:hidden">
              <button onClick={() => window.print()} className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-700 flex items-center gap-2">
                <Printer size={16} /> طباعة / حفظ PDF
              </button>
              <button onClick={() => setPreviewBook(null)} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm">إغلاق</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Print Preview Component ─── */
function PrintPreview({ book }: { book: BookRecord }) {
  const settings = book.settings_snapshot_json ? JSON.parse(book.settings_snapshot_json) : {};
  const useLogo = settings.use_logo && settings.logo_url;
  const useStamp = settings.use_stamp && settings.stamp_url;

  return (
    <div className={`mx-auto bg-white p-8 border print:border-0 ${book.paper_size === 'A5' ? 'max-w-md' : book.paper_size === 'Letter' ? 'max-w-2xl' : 'max-w-3xl'}`}>
      {/* Header */}
      <div className="text-center border-b pb-4 mb-4">
        {useLogo && <img src={settings.logo_url} alt="logo" className="h-16 mx-auto mb-2" />}
        <div className="font-bold text-xl">{settings.school_name || book.school_name_snapshot || 'المدرسة'}</div>
        {settings.principal_name && <div className="text-sm text-gray-600">المدير: {settings.principal_name}</div>}
        {settings.official_book_header_text && <div className="text-sm mt-2">{settings.official_book_header_text}</div>}
      </div>

      {/* Body */}
      <div className="py-4 text-lg leading-relaxed whitespace-pre-wrap">
        {book.body_text}
      </div>

      {/* Footer */}
      <div className="border-t pt-4 mt-4 text-center">
        {settings.official_book_footer_text && <div className="text-sm mb-2">{settings.official_book_footer_text}</div>}
        <div className="text-sm text-gray-500">رقم الكتاب: {book.document_number}</div>
        <div className="text-sm text-gray-500">تاريخ الإنشاء: {new Date(book.created_at).toLocaleDateString('ar-IQ')}</div>
        {useStamp && <img src={settings.stamp_url} alt="stamp" className="h-16 mx-auto mt-2" />}
        {settings.verification_note && <div className="text-xs text-gray-400 mt-2">{settings.verification_note}</div>}
        <div className="mt-4 flex justify-center">
          <QRCodeSVG value={getPreviewUrl(book.verification_token)} size={80} />
        </div>
      </div>
    </div>
  );
}

function getPreviewUrl(token: string) {
  const base = window.location.origin;
  return `${base}/verify/official-book/${token}`;
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
