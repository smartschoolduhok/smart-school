import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  CalendarDays,
  Download,
  FileText,
  NotebookPen,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  Undo2,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useTenantSchool } from '../../hooks/useTenantSchool';
import {
  createHomeworkDraft,
  createHomeworkReplacement,
  downloadHomeworkAttachment,
  getHomework,
  getHomeworkScopes,
  getParentHomework,
  publishHomework,
  removeHomeworkAttachment,
  updateHomeworkDraft,
  uploadHomeworkAttachment,
  withdrawHomework,
} from '../../lib/api';
import {
  HOMEWORK_MAX_FILE_BYTES,
  type HomeworkRecord,
  type HomeworkScope,
  type HomeworkStatus,
  type ParentHomeworkItem,
} from '../../lib/homework';
import { HOMEWORK_AUTHOR_ROLES, hasRole } from '../../lib/rbac';

type EditorMode = 'create' | 'edit' | 'replacement';
type ParentTimingFilter = 'all' | 'upcoming' | 'overdue' | 'undated';

interface EditorState {
  mode: EditorMode;
  source: HomeworkRecord | null;
}

interface HomeworkFormState {
  teaching_load_id: string;
  title: string;
  instructions: string;
  assigned_date: string;
  due_at: string;
}

const STATUS_LABELS: Record<HomeworkStatus, string> = {
  draft: 'مسودة',
  published: 'منشور',
  withdrawn: 'مسحوب',
};

const STATUS_STYLES: Record<HomeworkStatus, string> = {
  draft: 'bg-amber-50 text-amber-800 ring-amber-200',
  published: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  withdrawn: 'bg-gray-100 text-gray-700 ring-gray-200',
};

function businessDate(): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Baghdad',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const byType = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function emptyForm(): HomeworkFormState {
  return {
    teaching_load_id: '',
    title: '',
    instructions: '',
    assigned_date: businessDate(),
    due_at: '',
  };
}

function inputDateTime(epoch: number | null): string {
  if (epoch == null) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Baghdad',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(epoch * 1000));
  const byType = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}T${byType.hour}:${byType.minute}`;
}

function outputDueAt(value: string): number | null {
  if (!value) return null;
  return Math.floor(Date.parse(`${value}:00+03:00`) / 1000);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('ar-IQ', {
    timeZone: 'Asia/Baghdad',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(`${value}T12:00:00+03:00`));
}

function formatDateTime(value: number | null): string {
  if (value == null) return 'بلا موعد محدد';
  return new Intl.DateTimeFormat('ar-IQ', {
    timeZone: 'Asia/Baghdad',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value * 1000));
}

function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function EmptyState({ parent = false }: { parent?: boolean }) {
  return (
    <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-5 py-12 text-center">
      <NotebookPen className="mx-auto mb-3 text-gray-300" size={44} />
      <h2 className="font-bold text-gray-900">
        {parent ? 'لا توجد واجبات منشورة لأبنائك حاليًا' : 'لا توجد واجبات ضمن هذا العرض'}
      </h2>
      <p className="mt-1 text-sm text-gray-500">
        {parent ? 'ستظهر الواجبات هنا فور نشرها للطلاب المرتبطين بحسابك.' : 'غيّر المرشح أو أنشئ مسودة واجب جديدة.'}
      </p>
    </div>
  );
}

function AttachmentButton({
  attachment,
  onDownload,
  onRemove,
}: {
  attachment: Pick<HomeworkRecord['attachments'][number], 'original_name' | 'size_bytes'> & {
    status?: HomeworkRecord['attachments'][number]['status'];
  };
  onDownload?: () => void;
  onRemove?: () => void;
}) {
  const cleanupPending = attachment.status === 'removal_pending';
  return (
    <div className={`flex min-w-0 items-center gap-2 rounded-lg border px-3 py-2 ${cleanupPending ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-gray-50'}`}>
      <FileText size={17} className={`shrink-0 ${cleanupPending ? 'text-amber-700' : 'text-primary-600'}`} />
      {onDownload ? (
        <button type="button" onClick={onDownload} className="min-w-0 flex-1 truncate text-right text-sm font-medium text-primary-700 hover:underline">
          {attachment.original_name}
        </button>
      ) : (
        <span className="min-w-0 flex-1 truncate text-right text-sm font-medium text-gray-700">{attachment.original_name}</span>
      )}
      {cleanupPending && <span className="shrink-0 text-xs font-semibold text-amber-800">بانتظار تنظيف التخزين</span>}
      <span className="shrink-0 text-xs text-gray-500">{Math.ceil(attachment.size_bytes / 1024)} ك.ب</span>
      {onDownload && (
        <button type="button" onClick={onDownload} className="shrink-0 rounded p-1 text-gray-500 hover:bg-white hover:text-primary-700" aria-label="تنزيل المرفق">
          <Download size={16} />
        </button>
      )}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className={`shrink-0 rounded p-1 ${cleanupPending ? 'text-amber-700 hover:bg-amber-100' : 'text-red-500 hover:bg-red-50'}`}
          aria-label={cleanupPending ? 'إعادة محاولة تنظيف المرفق' : 'إزالة المرفق'}
        >
          {cleanupPending ? <RefreshCw size={16} /> : <Trash2 size={16} />}
        </button>
      )}
    </div>
  );
}

export default function HomeworkPage() {
  const { user } = useAuth();
  const {
    isSystemAdmin,
    schoolId,
    schools,
    schoolsLoading,
    schoolsError,
    selectSchool,
  } = useTenantSchool();
  const isParent = user?.role_key === 'parent';
  const isRegistrar = user?.role_key === 'registrar';
  const canAuthor = hasRole(user?.role_key, HOMEWORK_AUTHOR_ROLES);
  const [homework, setHomework] = useState<HomeworkRecord[]>([]);
  const [parentHomework, setParentHomework] = useState<ParentHomeworkItem[]>([]);
  const [parentStudentId, setParentStudentId] = useState<number | 'all'>('all');
  const [parentTimingFilter, setParentTimingFilter] = useState<ParentTimingFilter>('all');
  const [scopes, setScopes] = useState<HomeworkScope[]>([]);
  const [statusFilter, setStatusFilter] = useState<HomeworkStatus | 'all'>('all');
  const [scopeFilter, setScopeFilter] = useState<number | 'all'>('all');
  const [assignedDateFilter, setAssignedDateFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [form, setForm] = useState<HomeworkFormState>(emptyForm);

  const loadData = useCallback(async () => {
    setError('');
    setLoading(true);
    if (isParent) {
      const response = await getParentHomework();
      if (response.error) setError(response.error);
      else setParentHomework(response.data?.homework || []);
      setLoading(false);
      return;
    }
    if (schoolId == null) {
      setHomework([]);
      setScopes([]);
      setLoading(false);
      return;
    }
    const [homeworkResponse, scopeResponse] = await Promise.all([
      getHomework(schoolId, statusFilter, {
        teachingLoadId: scopeFilter === 'all' ? null : scopeFilter,
        assignedDate: assignedDateFilter,
      }),
      getHomeworkScopes(schoolId),
    ]);
    if (homeworkResponse.error || scopeResponse.error) {
      setError(homeworkResponse.error || scopeResponse.error || 'تعذر تحميل الواجبات');
    } else {
      setHomework(homeworkResponse.data || []);
      setScopes(scopeResponse.data?.loads || []);
    }
    setLoading(false);
  }, [assignedDateFilter, isParent, schoolId, scopeFilter, statusFilter]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    setEditor(null);
    setForm(emptyForm());
    setNotice('');
    setScopeFilter('all');
    setAssignedDateFilter('');
  }, [schoolId]);

  const scopeById = useMemo(
    () => new Map(scopes.map(scope => [scope.id, scope])),
    [scopes],
  );

  const parentStudents = useMemo(() => {
    const byId = new Map<number, ParentHomeworkItem['students'][number]>();
    for (const item of parentHomework) {
      for (const student of item.students) byId.set(student.id, student);
    }
    return [...byId.values()].sort((left, right) => left.full_name.localeCompare(right.full_name, 'ar'));
  }, [parentHomework]);

  const visibleParentHomework = useMemo(() => {
    const now = Math.floor(Date.now() / 1000);
    return parentHomework.filter(item => {
      if (parentStudentId !== 'all' && !item.students.some(student => student.id === parentStudentId)) return false;
      if (parentTimingFilter === 'upcoming') return item.due_at != null && item.due_at >= now;
      if (parentTimingFilter === 'overdue') return item.due_at != null && item.due_at < now;
      if (parentTimingFilter === 'undated') return item.due_at == null;
      return true;
    });
  }, [parentHomework, parentStudentId, parentTimingFilter]);

  function openCreate(): void {
    setEditor({ mode: 'create', source: null });
    setForm({ ...emptyForm(), teaching_load_id: scopes.length === 1 ? String(scopes[0].id) : '' });
    setError('');
    setNotice('');
  }

  function openEdit(item: HomeworkRecord): void {
    setEditor({ mode: 'edit', source: item });
    setForm({
      teaching_load_id: String(item.teaching_load_id),
      title: item.title,
      instructions: item.instructions,
      assigned_date: item.assigned_date,
      due_at: inputDateTime(item.due_at),
    });
    setError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openReplacement(item: HomeworkRecord): void {
    setEditor({ mode: 'replacement', source: item });
    setForm({
      teaching_load_id: String(item.teaching_load_id),
      title: `${item.title} — نسخة مصححة`,
      instructions: item.instructions,
      assigned_date: businessDate(),
      due_at: '',
    });
    setError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function submitEditor(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!editor || schoolId == null) return;
    const dueAt = outputDueAt(form.due_at);
    if (form.due_at && (dueAt == null || !Number.isFinite(dueAt))) {
      setError('موعد التسليم غير صالح.');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    const common = {
      school_id: schoolId,
      title: form.title,
      instructions: form.instructions,
      assigned_date: form.assigned_date,
      due_at: dueAt,
    };
    const response = editor.mode === 'edit' && editor.source
      ? await updateHomeworkDraft(editor.source.homework_key, {
          ...common,
          revision: editor.source.revision,
        })
      : editor.mode === 'replacement' && editor.source
        ? await createHomeworkReplacement(editor.source.homework_key, common)
        : await createHomeworkDraft({
            ...common,
            teaching_load_id: Number(form.teaching_load_id),
          });
    setSaving(false);
    if (response.error) {
      setError(response.error);
      return;
    }
    setNotice(editor.mode === 'edit' ? 'حُفظت تعديلات المسودة.' : 'حُفظ الواجب كمسودة.');
    setEditor(null);
    setForm(emptyForm());
    await loadData();
  }

  async function runAction(key: string, action: () => Promise<{ error?: string }>, success: string): Promise<void> {
    setBusyKey(key);
    setError('');
    setNotice('');
    const response = await action();
    setBusyKey(null);
    if (response.error) {
      setError(response.error);
      return;
    }
    setNotice(success);
    await loadData();
  }

  async function publish(item: HomeworkRecord): Promise<void> {
    if (schoolId == null || !window.confirm('هل تريد نشر الواجب الآن؟ ستُثبّت قائمة الطلاب والمرفقات ولن يعود المحتوى قابلًا للتعديل.')) return;
    await runAction(
      item.homework_key,
      () => publishHomework(item.homework_key, schoolId, item.revision),
      'نُشر الواجب وأُرسلت إشعارات أولياء الأمور المرتبطين.',
    );
  }

  async function withdraw(item: HomeworkRecord): Promise<void> {
    if (schoolId == null) return;
    const reason = window.prompt('اكتب سبب سحب الواجب (إلزامي):')?.trim();
    if (!reason) return;
    await runAction(
      item.homework_key,
      () => withdrawHomework(item.homework_key, schoolId, item.revision, reason),
      'سُحب الواجب مع الاحتفاظ بالسجل التاريخي.',
    );
  }

  async function upload(item: HomeworkRecord, file: File | undefined): Promise<void> {
    if (!file || schoolId == null) return;
    if (file.size > HOMEWORK_MAX_FILE_BYTES) {
      setError('حجم الملف يتجاوز 5 ميغابايت.');
      return;
    }
    await runAction(
      item.homework_key,
      () => uploadHomeworkAttachment(item.homework_key, schoolId, item.revision, file),
      'أُضيف المرفق إلى المسودة.',
    );
  }

  async function removeAttachment(
    item: HomeworkRecord,
    attachment: HomeworkRecord['attachments'][number],
  ): Promise<void> {
    if (schoolId == null) return;
    const cleanupPending = attachment.status === 'removal_pending';
    const confirmation = cleanupPending
      ? 'إعادة محاولة تنظيف هذا المرفق من التخزين؟'
      : 'إزالة هذا المرفق من المسودة؟';
    if (!window.confirm(confirmation)) return;
    const actionKey = `${item.homework_key}:${attachment.attachment_key}`;
    setBusyKey(actionKey);
    setError('');
    setNotice('');
    const response = await removeHomeworkAttachment(
      item.homework_key,
      attachment.attachment_key,
      schoolId,
      item.revision,
    );
    setBusyKey(null);
    await loadData();
    if (response.error) {
      setError(response.error);
      return;
    }
    setNotice(cleanupPending ? 'اكتمل تنظيف المرفق من التخزين.' : 'أُزيل المرفق من المسودة.');
  }

  async function download(attachmentKey: string, attachmentName: string): Promise<void> {
    setBusyKey(attachmentKey);
    setError('');
    const response = await downloadHomeworkAttachment(attachmentKey, isParent ? null : schoolId);
    setBusyKey(null);
    if (response.error || !response.data) {
      setError(response.error || 'تعذر تنزيل المرفق');
      return;
    }
    saveBlob(response.data, response.fileName || attachmentName);
  }

  if (isParent) {
    return (
      <main dir="rtl" className="min-w-0 space-y-5">
        <header className="flex min-w-0 flex-col gap-3 rounded-2xl bg-gradient-to-l from-primary-700 to-primary-600 p-5 text-white shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <NotebookPen size={24} />
              <h1 className="text-xl font-bold">واجبات أبنائي</h1>
            </div>
            <p className="mt-1 text-sm text-primary-100">الواجبات المنشورة للطلاب المرتبطين بحسابك حاليًا.</p>
          </div>
          <button type="button" onClick={() => void loadData()} className="inline-flex items-center justify-center gap-2 rounded-lg bg-white/15 px-3 py-2 text-sm font-medium hover:bg-white/25">
            <RefreshCw size={16} /> تحديث
          </button>
        </header>
        {error && <ErrorMessage message={error} />}
        {!loading && parentHomework.length > 0 && (
          <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm" aria-label="مرشحات واجبات الأبناء">
            <div className="flex min-w-0 flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setParentStudentId('all')}
                className={`rounded-full px-3 py-1.5 text-sm font-medium ${parentStudentId === 'all' ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
              >
                كل الأبناء
              </button>
              {parentStudents.map(student => (
                <button
                  key={student.id}
                  type="button"
                  onClick={() => setParentStudentId(student.id)}
                  className={`max-w-full truncate rounded-full px-3 py-1.5 text-sm font-medium ${parentStudentId === student.id ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                >
                  {student.full_name}
                </button>
              ))}
            </div>
            <div className="flex min-w-0 flex-wrap gap-2 border-t border-gray-100 pt-3">
              {([
                ['all', 'كل المواعيد'],
                ['upcoming', 'القادمة'],
                ['overdue', 'المتأخرة'],
                ['undated', 'بلا موعد'],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setParentTimingFilter(value)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${parentTimingFilter === value ? 'bg-primary-50 text-primary-800 ring-1 ring-primary-200' : 'text-gray-600 hover:bg-gray-50'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </section>
        )}
        {loading ? <LoadingState /> : parentHomework.length === 0 ? <EmptyState parent /> : visibleParentHomework.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-5 py-10 text-center text-sm text-gray-600">
            لا توجد واجبات تطابق الابن والموعد المحددين.
          </div>
        ) : (
          <div className="grid min-w-0 gap-4 lg:grid-cols-2">
            {visibleParentHomework.map(item => (
              <article key={item.homework_key} className="min-w-0 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-primary-700">{item.subject_name} · {item.class_name}{item.section_name ? ` / ${item.section_name}` : ''}</p>
                    <h2 className="mt-1 break-words text-lg font-bold text-gray-900">{item.title}</h2>
                  </div>
                  <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">منشور</span>
                </div>
                <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7 text-gray-700">{item.instructions}</p>
                <div className="mt-4 grid gap-2 text-sm text-gray-600 sm:grid-cols-2">
                  <span className="flex items-center gap-2"><CalendarDays size={16} /> تاريخ التكليف: {formatDate(item.assigned_date)}</span>
                  <span className="flex items-center gap-2"><CalendarDays size={16} /> التسليم: {formatDateTime(item.due_at)}</span>
                  <span className="flex items-center gap-2"><BookOpen size={16} /> المدرس: {item.teacher_name}</span>
                  <span className="flex items-center gap-2"><Users size={16} /> {item.students.map(student => student.full_name).join('، ')}</span>
                </div>
                {item.attachments.length > 0 && (
                  <div className="mt-4 space-y-2 border-t border-gray-100 pt-4">
                    <h3 className="text-sm font-bold text-gray-800">المرفقات</h3>
                    {item.attachments.map(attachment => (
                      <AttachmentButton
                        key={attachment.attachment_key}
                        attachment={attachment}
                        onDownload={() => void download(attachment.attachment_key, attachment.original_name)}
                      />
                    ))}
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </main>
    );
  }

  return (
    <main dir="rtl" className="min-w-0 space-y-5">
      <header className="rounded-2xl bg-gradient-to-l from-primary-700 to-primary-600 p-5 text-white shadow-sm">
        <div className="flex min-w-0 flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <NotebookPen size={25} />
              <h1 className="text-xl font-bold">الواجبات المنزلية</h1>
            </div>
            <p className="mt-1 text-sm text-primary-100">مسودات مرتبطة بالتكليفات الفعلية، ونشر ثابت لأولياء الأمور.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void loadData()} className="inline-flex items-center gap-2 rounded-lg bg-white/15 px-3 py-2 text-sm font-medium hover:bg-white/25">
              <RefreshCw size={16} /> تحديث
            </button>
            {canAuthor && schoolId != null && (
              <button type="button" onClick={openCreate} className="inline-flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-bold text-primary-700 hover:bg-primary-50">
                <Plus size={17} /> واجب جديد
              </button>
            )}
          </div>
        </div>
      </header>

      {isSystemAdmin && (
        <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <label className="mb-2 block text-sm font-bold text-gray-800" htmlFor="homework-school">المدرسة المستهدفة</label>
          <select
            id="homework-school"
            value={schoolId ?? ''}
            onChange={event => selectSchool(event.target.value ? Number(event.target.value) : null)}
            disabled={schoolsLoading}
            className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-primary-500 sm:max-w-md"
          >
            <option value="">اختر مدرسة</option>
            {schools.map(school => <option key={school.id} value={school.id}>{school.name}</option>)}
          </select>
          {schoolsError && <p className="mt-2 text-sm text-red-600">{schoolsError}</p>}
        </section>
      )}

      {isRegistrar && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          <strong>للقراءة فقط:</strong> يمكنك مراجعة الواجبات المنشورة والمسودات، ولا يمكنك إنشاؤها أو تعديلها أو نشرها.
        </div>
      )}

      {error && <ErrorMessage message={error} />}
      {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">{notice}</div>}

      {editor && schoolId != null && (
        <section className="rounded-2xl border border-primary-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="font-bold text-gray-900">
                {editor.mode === 'create' ? 'واجب جديد' : editor.mode === 'edit' ? 'تعديل المسودة' : 'إنشاء نسخة مصححة'}
              </h2>
              {editor.mode === 'replacement' && <p className="mt-1 text-xs text-gray-500">سترتبط هذه المسودة بالواجب المسحوب دون تغيير سجله التاريخي.</p>}
            </div>
            <button type="button" onClick={() => setEditor(null)} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100" aria-label="إغلاق النموذج"><X size={18} /></button>
          </div>
          <form onSubmit={event => void submitEditor(event)} className="grid min-w-0 gap-4 md:grid-cols-2">
            <label className="min-w-0 text-sm font-medium text-gray-700">
              التكليف التدريسي
              <select
                required
                value={form.teaching_load_id}
                onChange={event => setForm(current => ({ ...current, teaching_load_id: event.target.value }))}
                disabled={editor.mode !== 'create'}
                className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2.5 outline-none focus:border-primary-500 disabled:bg-gray-100"
              >
                <option value="">اختر الصف والشعبة والمادة</option>
                {scopes.map(scope => (
                  <option key={scope.id} value={scope.id}>
                    {scope.class_name}{scope.section_name ? ` / ${scope.section_name}` : ''} — {scope.subject_name} — {scope.teacher_name}
                  </option>
                ))}
                {editor.source && !scopeById.has(editor.source.teaching_load_id) && (
                  <option value={editor.source.teaching_load_id}>{editor.source.class_name} — {editor.source.subject_name}</option>
                )}
              </select>
            </label>
            <label className="min-w-0 text-sm font-medium text-gray-700">
              عنوان الواجب
              <input required maxLength={200} value={form.title} onChange={event => setForm(current => ({ ...current, title: event.target.value }))} className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2.5 outline-none focus:border-primary-500" />
            </label>
            <label className="min-w-0 text-sm font-medium text-gray-700 md:col-span-2">
              التعليمات
              <textarea required maxLength={5000} rows={5} value={form.instructions} onChange={event => setForm(current => ({ ...current, instructions: event.target.value }))} className="mt-1.5 w-full resize-y rounded-lg border border-gray-300 px-3 py-2.5 leading-7 outline-none focus:border-primary-500" />
            </label>
            <label className="text-sm font-medium text-gray-700">
              تاريخ التكليف
              <input required type="date" value={form.assigned_date} onChange={event => setForm(current => ({ ...current, assigned_date: event.target.value }))} className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2.5 outline-none focus:border-primary-500" />
            </label>
            <label className="text-sm font-medium text-gray-700">
              موعد التسليم (اختياري)
              <input type="datetime-local" value={form.due_at} onChange={event => setForm(current => ({ ...current, due_at: event.target.value }))} className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2.5 outline-none focus:border-primary-500" />
            </label>
            <div className="flex flex-wrap justify-end gap-2 md:col-span-2">
              <button type="button" onClick={() => setEditor(null)} className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">إلغاء</button>
              <button disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-primary-700 disabled:opacity-60">
                <NotebookPen size={17} /> {saving ? 'جاري الحفظ...' : 'حفظ كمسودة'}
              </button>
            </div>
          </form>
        </section>
      )}

      {schoolId == null ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center text-sm text-gray-600">اختر مدرسة لعرض الواجبات.</div>
      ) : (
        <>
          <section className="flex min-w-0 flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="font-bold text-gray-900">سجل الواجبات</h2>
              <p className="text-xs text-gray-500">المحتوى المنشور ثابت؛ التصحيح يتم بنسخة مرتبطة بعد السحب.</p>
            </div>
            <div className="grid min-w-0 gap-2 sm:grid-cols-3 lg:w-auto">
              <label className="min-w-0 text-xs font-medium text-gray-600">
                الحالة
                <select value={statusFilter} onChange={event => setStatusFilter(event.target.value as HomeworkStatus | 'all')} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 outline-none focus:border-primary-500">
                  <option value="all">كل الحالات</option>
                  <option value="draft">المسودات</option>
                  <option value="published">المنشورة</option>
                  <option value="withdrawn">المسحوبة</option>
                </select>
              </label>
              <label className="min-w-0 text-xs font-medium text-gray-600">
                الصف والشعبة والمادة
                <select
                  value={scopeFilter}
                  onChange={event => setScopeFilter(event.target.value === 'all' ? 'all' : Number(event.target.value))}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 outline-none focus:border-primary-500"
                >
                  <option value="all">كل الصفوف والمواد</option>
                  {scopes.map(scope => (
                    <option key={scope.id} value={scope.id}>
                      {scope.class_name}{scope.section_name ? ` / ${scope.section_name}` : ''} — {scope.subject_name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="min-w-0 text-xs font-medium text-gray-600">
                تاريخ التكليف
                <input
                  type="date"
                  value={assignedDateFilter}
                  onChange={event => setAssignedDateFilter(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 outline-none focus:border-primary-500"
                />
              </label>
            </div>
          </section>

          {loading ? <LoadingState /> : homework.length === 0 ? <EmptyState /> : (
            <div className="grid min-w-0 gap-5 xl:grid-cols-2">
              {homework.map(item => {
                const itemBusy = busyKey === item.homework_key || busyKey?.startsWith(`${item.homework_key}:`);
                const activeAttachmentCount = item.attachments.filter(attachment => attachment.status === 'active').length;
                const hasPendingCleanup = item.attachments.some(attachment => attachment.status === 'removal_pending');
                return (
                  <article key={item.homework_key} className="min-w-0 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-primary-700">{item.academic_year_name} · {item.subject_name}</p>
                        <h3 className="mt-1 break-words text-lg font-bold text-gray-900">{item.title}</h3>
                        <p className="mt-1 text-xs text-gray-500">{item.class_name}{item.section_name ? ` / ${item.section_name}` : ''} · {item.teacher_name}</p>
                      </div>
                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${STATUS_STYLES[item.status]}`}>{STATUS_LABELS[item.status]}</span>
                    </div>
                    <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7 text-gray-700">{item.instructions}</p>
                    <div className="mt-4 grid gap-2 rounded-xl bg-gray-50 p-3 text-xs text-gray-600 sm:grid-cols-2">
                      <span className="flex items-center gap-2"><CalendarDays size={15} /> التكليف: {formatDate(item.assigned_date)}</span>
                      <span className="flex items-center gap-2"><CalendarDays size={15} /> التسليم: {formatDateTime(item.due_at)}</span>
                      {item.status !== 'draft' && <span className="flex items-center gap-2"><Users size={15} /> الجمهور المثبّت: {item.audience.length} طالب</span>}
                      {item.replaces_homework_key && <span className="flex items-center gap-2"><Undo2 size={15} /> نسخة مصححة مرتبطة</span>}
                    </div>
                    {item.withdrawal_reason && (
                      <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">سبب السحب: {item.withdrawal_reason}</div>
                    )}

                    <div className="mt-4 space-y-2 border-t border-gray-100 pt-4">
                      <div className="flex items-center justify-between gap-2">
                        <h4 className="text-sm font-bold text-gray-800">المرفقات الفعالة ({activeAttachmentCount}/5)</h4>
                        {canAuthor && item.status === 'draft' && (
                          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-primary-200 px-2.5 py-1.5 text-xs font-semibold text-primary-700 hover:bg-primary-50">
                            <Paperclip size={15} /> إضافة مرفق
                            <input
                              type="file"
                              className="hidden"
                              accept="image/jpeg,image/png,image/webp,application/pdf"
                              disabled={itemBusy || activeAttachmentCount >= 5}
                              onChange={event => {
                                const file = event.target.files?.[0];
                                event.target.value = '';
                                void upload(item, file);
                              }}
                            />
                          </label>
                        )}
                      </div>
                      {item.status === 'draft' && <p className="text-xs text-gray-500">JPEG أو PNG أو WebP أو PDF — حتى 5 م.ب للملف و20 م.ب إجمالًا.</p>}
                      {item.attachments.map(attachment => (
                        <AttachmentButton
                          key={attachment.attachment_key}
                          attachment={attachment}
                          onDownload={attachment.status === 'active'
                            ? () => void download(attachment.attachment_key, attachment.original_name)
                            : undefined}
                          onRemove={canAuthor && item.status === 'draft'
                            ? () => void removeAttachment(item, attachment)
                            : undefined}
                        />
                      ))}
                    </div>

                    {canAuthor && (
                      <div className="mt-4 flex flex-wrap gap-2 border-t border-gray-100 pt-4">
                        {item.status === 'draft' && (
                          <>
                            <button type="button" disabled={itemBusy} onClick={() => openEdit(item)} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"><Pencil size={15} /> تعديل</button>
                            <button
                              type="button"
                              disabled={itemBusy || hasPendingCleanup}
                              title={hasPendingCleanup ? 'أكمل تنظيف المرفق المعلّق قبل النشر' : undefined}
                              onClick={() => void publish(item)}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                            >
                              <Send size={15} /> نشر الواجب
                            </button>
                          </>
                        )}
                        {item.status === 'published' && (
                          <button type="button" disabled={itemBusy} onClick={() => void withdraw(item)} className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"><Undo2 size={15} /> سحب الواجب</button>
                        )}
                        {item.status === 'withdrawn' && (
                          <button type="button" disabled={itemBusy} onClick={() => openReplacement(item)} className="inline-flex items-center gap-1.5 rounded-lg border border-primary-200 px-3 py-2 text-xs font-semibold text-primary-700 hover:bg-primary-50 disabled:opacity-50"><Plus size={15} /> إنشاء نسخة مصححة</button>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}
    </main>
  );
}

function LoadingState() {
  return (
    <div className="flex min-h-44 items-center justify-center rounded-2xl border border-gray-200 bg-white" role="status">
      <RefreshCw className="animate-spin text-primary-600" size={24} />
      <span className="mr-2 text-sm text-gray-600">جاري تحميل الواجبات...</span>
    </div>
  );
}

function ErrorMessage({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
      <AlertCircle className="mt-0.5 shrink-0" size={18} />
      <span className="break-words">{message}</span>
    </div>
  );
}
