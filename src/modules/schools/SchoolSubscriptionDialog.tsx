import { useEffect, useState } from 'react';
import { AlertCircle, Loader2, Save, X } from 'lucide-react';
import { getSchoolSubscription, saveSchoolSubscription, type SchoolSubscriptionDetails } from '../../lib/api';
import { toArabicDigits } from '../../lib/arabicDigits';
import { effectiveModules, type ModuleOverrides, type SchoolModuleKey, type SubscriptionPlanKey } from '../../lib/schoolSubscriptions';

type Form = {
  plan_key: SubscriptionPlanKey;
  status: 'active' | 'suspended';
  starts_on: string;
  ends_on: string;
  grace_days: string;
  max_students: string;
  notes: string;
  overrides: ModuleOverrides;
};

const STATE_LABELS = { active: 'فعّال', grace: 'ضمن المهلة', read_only: 'اطلاع فقط' } as const;
const STATE_TONES = { active: 'bg-emerald-50 text-emerald-700', grace: 'bg-amber-50 text-amber-800', read_only: 'bg-red-50 text-red-700' } as const;
const input = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500';

function formFrom(details: SchoolSubscriptionDetails): Form {
  const sub = details.subscription;
  return {
    plan_key: sub?.plan_key ?? 'full',
    status: sub?.status ?? 'active',
    starts_on: sub?.starts_on ?? '',
    ends_on: sub?.ends_on ?? '',
    grace_days: String(sub?.grace_days ?? 14),
    max_students: sub?.max_students == null ? '' : String(sub.max_students),
    notes: sub?.notes ?? '',
    overrides: details.overrides,
  };
}

export default function SchoolSubscriptionDialog({ school, onClose }: { school: { id: number; name: string }; onClose: () => void }) {
  const [details, setDetails] = useState<SchoolSubscriptionDetails | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function load() {
    setError(null);
    const res = await getSchoolSubscription(school.id);
    if (res.error || !res.data) { setError(res.error || 'تعذر تحميل الاشتراك'); return; }
    setDetails(res.data);
    setForm(formFrom(res.data));
  }

  useEffect(() => { void load(); }, [school.id]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const enabled = form ? effectiveModules(form.plan_key, form.overrides) : [];
  const planModules = form && details ? details.catalog.plans.find(plan => plan.key === form.plan_key)?.modules ?? [] : [];

  function toggleModule(key: SchoolModuleKey, on: boolean) {
    setForm(current => {
      if (!current) return current;
      const overrides = { ...current.overrides };
      if (planModules.includes(key) === on) delete overrides[key]; else overrides[key] = on;
      return { ...current, overrides };
    });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!form || !details) return;
    setSaving(true); setError(null); setSaved(false);
    const res = await saveSchoolSubscription(school.id, {
      plan_key: form.plan_key,
      status: form.status,
      starts_on: form.starts_on || null,
      ends_on: form.ends_on || null,
      grace_days: form.grace_days === '' ? 14 : Number(form.grace_days),
      max_students: form.max_students === '' ? null : Number(form.max_students),
      notes: form.notes.trim() || null,
      overrides: form.overrides,
      expected_revision: details.subscription?.revision ?? 1,
    });
    setSaving(false);
    if (res.error || !res.data) {
      // A stale save reloads the latest version first, then explains why.
      if (res.code === 'subscription_stale') await load();
      setError(res.error || 'تعذر حفظ الاشتراك');
      return;
    }
    setDetails(res.data);
    setForm(formFrom(res.data));
    setSaved(true);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="subscription-title" className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-100 p-4 sm:p-6">
          <h2 id="subscription-title" className="text-lg font-bold text-gray-900">اشتراك {school.name}</h2>
          <button type="button" onClick={onClose} aria-label="إغلاق" className="rounded-lg p-2 hover:bg-gray-100"><X size={20} className="text-gray-500" /></button>
        </div>

        {!form || !details ? (
          <div className="flex items-center justify-center gap-2 p-10 text-gray-500">
            {error ? <p role="alert" className="text-red-700">{error}</p> : <><Loader2 size={18} className="animate-spin" /> جارٍ التحميل…</>}
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-5 p-4 sm:p-6">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className={`rounded-full px-2.5 py-1 font-medium ${STATE_TONES[details.access.state]}`}>{STATE_LABELS[details.access.state]}</span>
              {details.access.days_left != null && details.access.state !== 'read_only' && (
                <span className="text-gray-600">{details.access.state === 'grace' ? 'باقي على الاطلاع فقط' : 'باقي على الانتهاء'}: {toArabicDigits(String(details.access.days_left))} يوم</span>
              )}
              <span className="text-gray-600">الطلاب النشطون: {toArabicDigits(String(details.active_students))}{details.subscription?.max_students ? ` من ${toArabicDigits(String(details.subscription.max_students))}` : ''}</span>
            </div>

            {error && <p role="alert" className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700"><AlertCircle size={16} />{error}</p>}
            {saved && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">تم حفظ الاشتراك.</p>}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="space-y-1 text-sm font-medium text-gray-700">الباقة
                <select className={input} value={form.plan_key} onChange={e => setForm({ ...form, plan_key: e.target.value as SubscriptionPlanKey, overrides: {} })}>
                  {details.catalog.plans.map(plan => <option key={plan.key} value={plan.key}>{plan.label}</option>)}
                </select>
              </label>
              <label className="space-y-1 text-sm font-medium text-gray-700">الحالة
                <select className={input} value={form.status} onChange={e => setForm({ ...form, status: e.target.value as Form['status'] })}>
                  <option value="active">فعّال</option>
                  <option value="suspended">موقوف (اطلاع فقط)</option>
                </select>
              </label>
              <label className="space-y-1 text-sm font-medium text-gray-700">تاريخ البداية
                <input type="date" className={input} value={form.starts_on} onChange={e => setForm({ ...form, starts_on: e.target.value })} />
              </label>
              <label className="space-y-1 text-sm font-medium text-gray-700">تاريخ الانتهاء <span className="font-normal text-gray-500">(فارغ = بدون انتهاء)</span>
                <input type="date" className={input} value={form.ends_on} onChange={e => setForm({ ...form, ends_on: e.target.value })} />
              </label>
              <label className="space-y-1 text-sm font-medium text-gray-700">أيام المهلة بعد الانتهاء
                <input type="number" min={0} max={90} inputMode="numeric" className={input} value={form.grace_days} onChange={e => setForm({ ...form, grace_days: e.target.value })} />
              </label>
              <label className="space-y-1 text-sm font-medium text-gray-700">الحد الأقصى للطلاب النشطين <span className="font-normal text-gray-500">(فارغ = بدون حد)</span>
                <input type="number" min={1} inputMode="numeric" className={input} value={form.max_students} onChange={e => setForm({ ...form, max_students: e.target.value })} />
              </label>
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-gray-700">الوحدات المفعّلة</legend>
              <p className="text-xs text-gray-500">الطلاب والصفوف والمواد والموظفون والمستخدمون والإعدادات متاحة في كل الباقات.</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {details.catalog.modules.map(module => {
                  const on = enabled.includes(module.key);
                  const exception = form.overrides[module.key] !== undefined;
                  return (
                    <label key={module.key} className="flex items-center gap-2 rounded-lg border border-gray-100 px-3 py-2 text-sm">
                      <input type="checkbox" checked={on} onChange={e => toggleModule(module.key, e.target.checked)} />
                      <span className="flex-1">{module.label}</span>
                      {exception && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-800">استثناء</span>}
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <label className="block space-y-1 text-sm font-medium text-gray-700">ملاحظات
              <textarea className={input} rows={2} maxLength={1000} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
            </label>

            {details.audit.length > 0 && (
              <details className="text-sm text-gray-600">
                <summary className="cursor-pointer font-medium text-gray-700">سجل التعديلات</summary>
                <ul className="mt-2 space-y-1">
                  {details.audit.map(entry => {
                    const after = JSON.parse(entry.after_json) as { plan_key: SubscriptionPlanKey; ends_on: string | null; status: string };
                    const plan = details.catalog.plans.find(p => p.key === after.plan_key)?.label ?? after.plan_key;
                    return (
                      <li key={entry.id}>
                        {new Date(entry.created_at * 1000).toLocaleDateString('ar-IQ')} — {entry.actor_name ?? '—'}: {plan}، {after.status === 'suspended' ? 'موقوف' : 'فعّال'}، {after.ends_on ? `ينتهي ${after.ends_on}` : 'بدون انتهاء'}
                      </li>
                    );
                  })}
                </ul>
              </details>
            )}

            <div className="flex items-center justify-end gap-3 border-t border-gray-100 pt-4">
              <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">إغلاق</button>
              <button type="submit" disabled={saving} className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                <span>حفظ الاشتراك</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
