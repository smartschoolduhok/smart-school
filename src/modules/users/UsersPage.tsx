import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Plus, Search, Loader2, Pencil, Lock, X, Copy, RefreshCw } from 'lucide-react';
import { getUsers, getSchools, getRoles, createUser, updateUser, updateUserStatus, resetUserPassword, type TemporaryUserPassword } from '../../lib/api';
import { useAuth } from '../../hooks/useAuth';
import type { AuthUser, UserWithSchoolAndRole } from '../../types';

const SCHOOL_ROLES = ['principal', 'vice_principal', 'teacher', 'accountant', 'registrar', 'parent'];
const ROLE_LABELS: Record<string, string> = {
  system_admin: 'مدير النظام', school_owner: 'مالك المدرسة', principal: 'مدير المدرسة',
  vice_principal: 'نائب المدير', teacher: 'معلم', accountant: 'محاسب', registrar: 'مسجل', parent: 'ولي أمر',
};
interface RoleOption { id: number; key: string; name: string }
interface SchoolOption { id: number; name: string }
interface AccountForm { full_name: string; email: string; role_key: string; school_id: string; phone: string }
const emptyForm: AccountForm = { full_name: '', email: '', role_key: '', school_id: '', phone: '' };
const fieldClass = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500';
const actionClass = 'rounded-lg border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50';
const primaryClass = 'rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50';

function AccountDialog({ title, children, busy, onClose }: { title: string; children: ReactNode; busy: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  const pending = useRef(busy);
  close.current = onClose;
  pending.current = busy;
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pending.current) close.current();
      if (event.key !== 'Tab') return;
      const controls = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]') || [])].filter(element => !element.closest('fieldset:disabled'));
      const first = controls[0], last = controls[controls.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handleKey);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', handleKey); if (previousFocus?.isConnected) previousFocus.focus(); };
  }, []);
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3" dir="rtl">
    <div ref={dialog} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} className="max-h-[90dvh] w-full max-w-xl overflow-y-auto rounded-xl bg-white shadow-xl focus:outline-none">
      <div className="flex items-center justify-between gap-3 border-b p-4"><h2 className="text-lg font-bold">{title}</h2><button type="button" aria-label="إغلاق النافذة" disabled={busy} onClick={onClose} className="rounded-lg p-2 hover:bg-gray-100 disabled:opacity-50"><X size={20} /></button></div>
      <div className="p-4">{children}</div>
    </div>
  </div>;
}

// Remount the whole account workspace when its authenticated scope changes.
export default function UsersPage() {
  const { user } = useAuth();
  return user ? <UserAccounts key={`${user.id}:${user.school_id}:${user.role_key}`} actor={user} /> : null;
}

function UserAccounts({ actor }: { actor: AuthUser }) {
  const [users, setUsers] = useState<UserWithSchoolAndRole[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [schools, setSchools] = useState<SchoolOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<AccountForm>(emptyForm);
  const [editing, setEditing] = useState<UserWithSchoolAndRole | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formStale, setFormStale] = useState(false);
  const [resetTarget, setResetTarget] = useState<UserWithSchoolAndRole | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetStale, setResetStale] = useState(false);
  const [secret, setSecret] = useState<(TemporaryUserPassword & { name: string }) | null>(null);
  const [copyMessage, setCopyMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const alive = useRef(true);
  const listGeneration = useRef(0);
  const isAdmin = actor.role_key === 'system_admin';
  const canManage = isAdmin || (actor.role_key === 'school_owner' && actor.school_id != null);
  const schoolId = isAdmin ? null : actor.school_id;

  const reloadUsers = useCallback(async () => {
    const generation = ++listGeneration.current;
    setLoading(true);
    const result = await getUsers(schoolId);
    if (!alive.current || generation !== listGeneration.current) return;
    if (result.error) setError(result.error);
    else { setUsers((result.data || []) as UserWithSchoolAndRole[]); setError(null); }
    setLoading(false);
  }, [schoolId]);

  useEffect(() => {
    alive.current = true;
    void reloadUsers();
    if (canManage) {
      void Promise.all([getRoles(), isAdmin ? getSchools() : Promise.resolve({ data: [] })]).then(([roleResult, schoolResult]) => {
        if (!alive.current) return;
        const schoolError = 'error' in schoolResult ? schoolResult.error : undefined;
        if (roleResult.error || schoolError) setError(roleResult.error || String(schoolError));
        setRoles((roleResult.data || []).filter(role => isAdmin || SCHOOL_ROLES.includes(role.key)) as RoleOption[]);
        setSchools((schoolResult.data || []) as SchoolOption[]);
      });
    }
    return () => { alive.current = false; listGeneration.current++; };
  }, [reloadUsers, canManage, isAdmin]);

  const mayManage = (target: UserWithSchoolAndRole) => canManage && target.can_manage === true && target.id !== actor.id
    && Number.isInteger(target.account_revision) && (target.account_revision ?? -1) >= 0
    && (isAdmin || (target.school_id === actor.school_id && SCHOOL_ROLES.includes(target.role_key || '')));
  const beginWrite = () => { if (busyRef.current) return false; busyRef.current = true; setBusy(true); return true; };
  const endWrite = () => { if (alive.current) { busyRef.current = false; setBusy(false); } };
  const rememberSecret = (data: TemporaryUserPassword, name: string) => { setCopyMessage(''); setSecret({ ...data, name }); };

  function openCreate() { if (busyRef.current) return; setEditing(null); setForm(emptyForm); setFormError(null); setFormStale(false); setFormOpen(true); }
  function openEdit(target: UserWithSchoolAndRole) {
    if (!mayManage(target) || busyRef.current) return;
    setEditing(target); setForm({ full_name: target.full_name, email: target.email, role_key: target.role_key || '', school_id: target.school_id == null ? '' : String(target.school_id), phone: target.phone || '' });
    setFormError(null); setFormStale(false); setFormOpen(true);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canManage || formStale || (editing && !mayManage(editing)) || !beginWrite()) return;
    setFormError(null);
    const payload = { full_name: form.full_name.trim(), email: form.email.trim(), role_key: form.role_key, phone: form.phone.trim() };
    try {
      const result = editing
        ? await updateUser(editing.id, { ...payload, expected_revision: editing.account_revision! })
        : await createUser({ ...payload, ...(isAdmin ? { school_id: form.role_key === 'system_admin' ? null : Number(form.school_id) } : {}) });
      if (!alive.current) return;
      if (result.error) { setFormError(result.error); setFormStale(result.status === 409 && result.code === 'account_stale'); return; }
      setFormOpen(false);
      if (!editing) {
        const issued = result.data as TemporaryUserPassword | undefined;
        if (issued?.temporary_password) rememberSecret(issued, payload.full_name);
        else setError('أُنشئ الحساب، لكن لم تصل كلمة المرور المؤقتة. حدّث القائمة وأعد تعيينها.');
      }
      void reloadUsers();
    } finally { endWrite(); }
  }

  async function handleStatus(target: UserWithSchoolAndRole) {
    if (!mayManage(target) || busyRef.current) return;
    const next = target.status === 'active' ? 'inactive' : 'active';
    if (!window.confirm(`هل تريد ${next === 'active' ? 'تفعيل' : 'تعطيل'} حساب ${target.full_name}؟ ستُنهى جلساته الحالية.`) || !beginWrite()) return;
    try {
      const result = await updateUserStatus(target.id, next, target.account_revision!);
      if (!alive.current) return;
      if (result.error) setError(result.status === 409 ? `${result.error} حدّث القائمة وراجع الحساب قبل المحاولة مجددًا.` : result.error);
      else void reloadUsers();
    } finally { endWrite(); }
  }

  async function handleReset(event: React.FormEvent) {
    event.preventDefault();
    if (!resetTarget || resetStale || !mayManage(resetTarget) || !beginWrite()) return;
    setResetError(null);
    try {
      const result = await resetUserPassword(resetTarget.id, resetTarget.account_revision!);
      if (!alive.current) return;
      if (result.error) { setResetError(result.error); setResetStale(result.status === 409 && result.code === 'account_stale'); return; }
      if (result.data?.temporary_password) { rememberSecret(result.data, resetTarget.full_name); setResetTarget(null); void reloadUsers(); }
      else setResetError('لم تصل كلمة المرور المؤقتة. حدّث القائمة قبل محاولة إعادة التعيين مجددًا.');
    } finally { endWrite(); }
  }

  async function copySecret() {
    if (!secret) return;
    try { await navigator.clipboard.writeText(secret.temporary_password); if (alive.current) setCopyMessage('تم نسخ كلمة المرور. شاركها مع صاحب الحساب بطريقة خاصة.'); }
    catch { if (alive.current) setCopyMessage('تعذر النسخ التلقائي؛ يمكنك تحديد كلمة المرور ونسخها يدويًا.'); }
  }

  const query = search.trim().toLocaleLowerCase();
  const filtered = users.filter(target => [target.full_name, target.email, ROLE_LABELS[target.role_key || '']].some(value => (value || '').toLocaleLowerCase().includes(query)));
  const selectableRoles = roles.filter(role => !editing || (editing.school_id == null ? role.key === 'system_admin' : role.key !== 'system_admin'));
  const closeForm = () => { if (!busyRef.current) setFormOpen(false); };
  const staleNotice = <div className="space-y-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900"><p>تغيّر الحساب بعد فتحه. احتفظنا بالمدخلات للمراجعة. حدّث القائمة ثم أغلق النافذة وافتح الحساب مجددًا قبل الحفظ.</p><button type="button" className={actionClass} disabled={loading || busy} onClick={() => void reloadUsers()}>تحديث القائمة</button></div>;

  return <div className="min-w-0 space-y-5" dir="rtl">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-bold text-gray-900">المستخدمون</h1><p className="mt-1 text-sm text-gray-500">{isAdmin ? 'إدارة حسابات النظام والمدارس' : 'حسابات المدرسة وصلاحيات الدخول'}</p></div>{canManage && <button type="button" onClick={openCreate} disabled={busy || loading || roles.length === 0} className={`${primaryClass} flex items-center gap-2`}><Plus size={18} />إضافة مستخدم</button>}</div>
    <div className="flex flex-wrap gap-3"><label className="relative min-w-0 flex-1"><span className="sr-only">بحث في المستخدمين</span><Search size={18} className="absolute right-3 top-2.5 text-gray-400" /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="بحث في المستخدمين..." className={`${fieldClass} pr-10`} /></label><button type="button" className={`${actionClass} flex items-center gap-2`} onClick={() => void reloadUsers()} disabled={loading || busy}><RefreshCw size={16} />تحديث القائمة</button></div>
    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {loading ? <div role="status" className="flex items-center justify-center gap-2 p-10 text-gray-500"><Loader2 className="animate-spin" size={22} />جاري تحميل المستخدمين...</div> : <div className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {filtered.map(target => <article key={target.id} aria-label={`حساب ${target.full_name}`} className="min-w-0 space-y-3 rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex items-start justify-between gap-2"><h2 className="break-words font-bold text-gray-900">{target.full_name}</h2><span className={`shrink-0 rounded-full px-2 py-1 text-xs ${target.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>{target.status === 'active' ? 'نشط' : 'غير نشط'}</span></div>
        <p className="break-all text-sm text-gray-600" dir="ltr">{target.email}</p><p className="text-sm text-primary-700">{target.role_name || ROLE_LABELS[target.role_key || ''] || '—'}</p>
        {isAdmin && <p className="break-words text-sm text-gray-500">{target.school_name || (target.school_id ? `مدرسة #${target.school_id}` : 'إدارة النظام')}</p>}
        {target.must_change_password && <p className="text-sm text-amber-800">يتطلب تغيير كلمة المرور عند الدخول{target.temporary_password_expires_at && target.temporary_password_expires_at * 1000 < Date.now() ? ' — انتهت صلاحية كلمة المرور المؤقتة' : ''}</p>}
        {mayManage(target) ? <div className="flex flex-wrap gap-2 border-t pt-3"><button type="button" disabled={busy} onClick={() => openEdit(target)} className={`${actionClass} flex items-center gap-1`}><Pencil size={14} />تعديل</button><button type="button" disabled={busy} onClick={() => { setResetTarget(target); setResetError(null); setResetStale(false); }} className={`${actionClass} flex items-center gap-1`}><Lock size={14} />إعادة تعيين كلمة المرور</button><button type="button" disabled={busy} onClick={() => void handleStatus(target)} className={actionClass}>{target.status === 'active' ? 'تعطيل' : 'تفعيل'}</button></div> : canManage && <p className="border-t pt-3 text-xs text-gray-500">{target.id === actor.id ? 'حسابك الحالي — إدارة الحسابات هنا للمستخدمين الآخرين' : 'هذا الحساب خارج صلاحيات الإدارة المتاحة لك'}</p>}
      </article>)}
      {!filtered.length && <p className="p-8 text-center text-sm text-gray-500">{search ? 'لا توجد نتائج للبحث' : 'لا يوجد مستخدمون'}</p>}
    </div>}

    {formOpen && <AccountDialog title={editing ? 'تعديل مستخدم' : 'إضافة مستخدم'} busy={busy} onClose={closeForm}>
      <form aria-label={editing ? 'تعديل مستخدم' : 'إضافة مستخدم'} onSubmit={handleSubmit} className="space-y-4">
        {formError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{formError}</p>}{formStale && staleNotice}
        <fieldset disabled={busy} className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="space-y-1 text-sm">الاسم الكامل<input aria-label="الاسم الكامل" required maxLength={200} value={form.full_name} onChange={event => setForm(previous => ({ ...previous, full_name: event.target.value }))} className={fieldClass} autoComplete="name" /></label>
          <label className="space-y-1 text-sm">البريد الإلكتروني<input aria-label="البريد الإلكتروني" required type="email" maxLength={254} value={form.email} onChange={event => setForm(previous => ({ ...previous, email: event.target.value }))} className={fieldClass} dir="ltr" autoComplete="email" /></label>
          <label className="space-y-1 text-sm">الدور<select aria-label="الدور" required value={form.role_key} onChange={event => setForm(previous => ({ ...previous, role_key: event.target.value }))} className={fieldClass}><option value="">اختر الدور</option>{selectableRoles.map(role => <option key={role.id} value={role.key}>{role.name || ROLE_LABELS[role.key]}</option>)}</select></label>
          <label className="space-y-1 text-sm">رقم الهاتف<input aria-label="رقم الهاتف" type="tel" maxLength={40} value={form.phone} onChange={event => setForm(previous => ({ ...previous, phone: event.target.value }))} className={fieldClass} dir="ltr" autoComplete="tel" /></label>
          {isAdmin && !editing && form.role_key !== 'system_admin' && <label className="space-y-1 text-sm sm:col-span-2">المدرسة<select aria-label="المدرسة" required value={form.school_id} onChange={event => setForm(previous => ({ ...previous, school_id: event.target.value }))} className={fieldClass}><option value="">اختر المدرسة</option>{schools.map(school => <option key={school.id} value={school.id}>{school.name}</option>)}</select></label>}
        </fieldset>
        {editing ? <p className="text-sm text-gray-500">مدرسة الحساب ثابتة. لتغيير كلمة المرور استخدم إجراء إعادة التعيين.</p> : <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-800">سيولّد النظام كلمة مرور مؤقتة تظهر مرة واحدة وتصلح لمدة 24 ساعة. يجب تغييرها عند أول دخول.</p>}
        <div className="flex flex-wrap justify-end gap-2"><button type="button" className={actionClass} disabled={busy} onClick={closeForm}>إلغاء</button><button type="submit" disabled={busy || formStale} className={primaryClass}>{busy ? 'جاري الحفظ...' : editing ? 'حفظ التعديلات' : 'إنشاء الحساب'}</button></div>
      </form>
    </AccountDialog>}

    {resetTarget && <AccountDialog title="إعادة تعيين كلمة المرور" busy={busy} onClose={() => { if (!busyRef.current) setResetTarget(null); }}>
      <form aria-label="تأكيد إعادة تعيين كلمة المرور" onSubmit={handleReset} className="space-y-4"><p className="break-words text-sm">سيُعاد تعيين كلمة المرور لحساب <strong>{resetTarget.full_name}</strong> وتُنهى جلساته الحالية. تظهر كلمة المرور الجديدة مرة واحدة، وتصلح لمدة 24 ساعة، ويجب تغييرها عند الدخول.</p>{resetError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{resetError}</p>}{resetStale && staleNotice}<div className="flex flex-wrap justify-end gap-2"><button type="button" disabled={busy} onClick={() => setResetTarget(null)} className={actionClass}>إلغاء</button><button type="submit" disabled={busy || resetStale} className={primaryClass}>{busy ? 'جاري إعادة التعيين...' : 'تأكيد إعادة التعيين'}</button></div></form>
    </AccountDialog>}

    {secret && <AccountDialog title="كلمة المرور المؤقتة" busy={false} onClose={() => { setSecret(null); setCopyMessage(''); }}>
      <div className="space-y-4"><p className="break-words text-sm">حساب <strong>{secret.name}</strong>. انسخ كلمة المرور وسلّمها لصاحب الحساب بطريقة خاصة؛ لن تظهر مرة أخرى بعد إغلاق هذه النافذة.</p><label className="block space-y-2 text-sm">كلمة المرور المؤقتة<input aria-label="كلمة المرور المؤقتة" readOnly value={secret.temporary_password} autoComplete="off" spellCheck={false} dir="ltr" className={`${fieldClass} font-mono`} onFocus={event => event.target.select()} /></label><p className="text-sm text-amber-800">صالحة لمدة 24 ساعة، حتى {new Date(secret.temporary_password_expires_at * 1000).toLocaleString('ar-IQ')}. يجب تغييرها عند أول دخول.</p><p aria-live="polite" className="text-sm text-gray-600">{copyMessage}</p><div className="flex flex-wrap gap-2"><button type="button" onClick={() => void copySecret()} className={`${primaryClass} flex items-center gap-2`}><Copy size={16} />نسخ كلمة المرور</button><button type="button" className={actionClass} onClick={() => { setSecret(null); setCopyMessage(''); }}>تم، إغلاق</button></div></div>
    </AccountDialog>}
  </div>;
}
