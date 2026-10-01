import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, LogOut } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { changePassword } from '../../lib/api';
import { clearAuthentication } from '../../lib/authStorage';

export default function ChangePasswordPage() {
  const { user } = useAuth();
  return user ? <PasswordForm key={`${user.id}:${user.school_id}:${user.role_key}`} /> : null;
}

function PasswordForm() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending.current) return;
    setError('');
    if (!currentPassword) { setError('أدخل كلمة المرور الحالية أو المؤقتة.'); return; }
    if (newPassword.length < 12 || newPassword.length > 128) { setError('يجب أن تكون كلمة المرور الجديدة بين 12 و128 حرفًا.'); return; }
    if (newPassword === currentPassword) { setError('اختر كلمة مرور مختلفة عن كلمة المرور الحالية.'); return; }
    if (newPassword !== confirmation) { setError('تأكيد كلمة المرور لا يطابق كلمة المرور الجديدة.'); return; }
    pending.current = true; setBusy(true);
    try {
      const result = await changePassword({ current_password: currentPassword, new_password: newPassword });
      if (!alive.current) return;
      if (result.error) { setError(result.error); return; }
      setCurrentPassword(''); setNewPassword(''); setConfirmation('');
      clearAuthentication();
      navigate('/login', { replace: true });
    } finally { if (alive.current) { pending.current = false; setBusy(false); } }
  }

  async function leave() {
    if (pending.current) return;
    pending.current = true; setBusy(true);
    try { await logout(); } finally { if (alive.current) { pending.current = false; setBusy(false); } }
  }

  const inputClass = 'mt-2 w-full rounded-lg border border-gray-300 px-3 py-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500';
  return <main dir="rtl" className="flex min-h-screen items-center justify-center bg-body-bg p-4">
    <div className="w-full max-w-md space-y-5 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-8">
      <div className="flex items-center gap-3"><div className="rounded-xl bg-primary-50 p-3 text-primary-700"><Lock size={24} /></div><h1 className="text-xl font-bold">تغيير كلمة المرور</h1></div>
      <p className="break-words text-sm text-gray-600">{user?.full_name}، {user?.must_change_password ? 'غيّر كلمة المرور المؤقتة لإكمال الدخول إلى حسابك.' : 'يمكنك تعيين كلمة مرور جديدة لحسابك.'}</p>
      <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-800">اختر كلمة مرور من 12 إلى 128 حرفًا. بعد نجاح التغيير ستُنهى جميع جلسات حسابك، وستسجل الدخول مجددًا بالكلمة الجديدة.</p>
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <form aria-label="تغيير كلمة المرور" onSubmit={submit} className="space-y-5">
        <fieldset disabled={busy} className="space-y-4">
          <label className="block text-sm font-medium">كلمة المرور الحالية أو المؤقتة<input aria-label="كلمة المرور الحالية أو المؤقتة" required type="password" autoComplete="current-password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} dir="ltr" className={inputClass} /></label>
          <label className="block text-sm font-medium">كلمة المرور الجديدة<input aria-label="كلمة المرور الجديدة" required type="password" autoComplete="new-password" minLength={12} maxLength={128} value={newPassword} onChange={event => setNewPassword(event.target.value)} dir="ltr" className={inputClass} /></label>
          <label className="block text-sm font-medium">تأكيد كلمة المرور الجديدة<input aria-label="تأكيد كلمة المرور الجديدة" required type="password" autoComplete="new-password" minLength={12} maxLength={128} value={confirmation} onChange={event => setConfirmation(event.target.value)} dir="ltr" className={inputClass} /></label>
        </fieldset>
        <button type="submit" disabled={busy} className="w-full rounded-lg bg-primary-600 px-4 py-3 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">{busy ? 'جاري التنفيذ...' : 'حفظ كلمة المرور وتسجيل الدخول مجددًا'}</button>
      </form>
      <button type="button" disabled={busy} onClick={() => void leave()} className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"><LogOut size={16} />تسجيل الخروج</button>
    </div>
  </main>;
}
