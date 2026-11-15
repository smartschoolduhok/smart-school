import { useEffect, useState } from 'react';
import { Activity, AlertCircle, CheckCircle2, Database, Loader2, RefreshCw, Send } from 'lucide-react';
import { getSystemErrors, getSystemHealth, sendTestAlert, type SystemErrorGroup, type SystemHealthSummary } from '../../lib/api';
import { toArabicDigits } from '../../lib/arabicDigits';

const PERIODS = [{ days: 1, label: 'آخر يوم' }, { days: 7, label: 'آخر أسبوع' }, { days: 30, label: 'آخر 30 يوم' }];
const formatTime = (seconds: number) => new Date(seconds * 1000).toLocaleString('ar-IQ', { timeZone: 'Asia/Baghdad' });

function Card({ icon, title, value, detail, tone = 'text-gray-900' }: { icon: React.ReactNode; title: string; value: string; detail?: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 text-sm text-gray-500">{icon}<span>{title}</span></div>
      <p className={`mt-2 text-xl font-bold ${tone}`}>{value}</p>
      {detail && <p className="mt-1 text-xs text-gray-500">{detail}</p>}
    </div>
  );
}

export default function SystemHealthPage() {
  const [health, setHealth] = useState<SystemHealthSummary | null>(null);
  const [errors, setErrors] = useState<SystemErrorGroup[] | null>(null);
  const [days, setDays] = useState(7);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [testState, setTestState] = useState<{ busy: boolean; message?: string; ok?: boolean }>({ busy: false });

  async function load(period = days) {
    setLoadError(null);
    const [h, e] = await Promise.all([getSystemHealth(), getSystemErrors(period)]);
    if (h.error || e.error) { setLoadError(h.error || e.error || 'تعذر تحميل صحة النظام'); return; }
    setHealth(h.data ?? null);
    setErrors(e.data ?? []);
  }

  useEffect(() => { void load(days); }, [days]);

  async function testAlert() {
    setTestState({ busy: true });
    const res = await sendTestAlert();
    setTestState(res.error ? { busy: false, ok: false, message: res.error } : { busy: false, ok: true, message: 'وصلت رسالة الاختبار إلى Telegram.' });
  }

  return (
    <div className="space-y-5" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-gray-900"><Activity size={22} /> صحة النظام</h1>
          <p className="text-sm text-gray-500">أخطاء الخادم المسجلة وحالة قاعدة البيانات والتنبيهات.</p>
        </div>
        <button type="button" onClick={() => void load()} className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
          <RefreshCw size={16} /> تحديث
        </button>
      </div>

      {loadError && <p role="alert" className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700"><AlertCircle size={16} />{loadError}</p>}

      {!health && !loadError ? (
        <div className="flex items-center gap-2 p-8 text-gray-500"><Loader2 size={18} className="animate-spin" /> جارٍ التحميل…</div>
      ) : health && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card icon={<Database size={16} />} title="قاعدة البيانات" value="تعمل" tone="text-emerald-700" detail={`زمن الاستجابة ${toArabicDigits(String(health.database.latency_ms))} ms — ${health.environment}`} />
          <Card icon={<Database size={16} />} title="الترحيلات المطبقة" value={toArabicDigits(String(health.migrations?.applied ?? 0))} detail={health.migrations?.last ?? '—'} />
          <Card icon={<AlertCircle size={16} />} title="أخطاء الخادم" value={`${toArabicDigits(String(health.errors_24h))} اليوم`} tone={health.errors_24h ? 'text-red-700' : 'text-gray-900'} detail={`${toArabicDigits(String(health.errors_7d))} خلال 7 أيام`} />
          <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 text-sm text-gray-500"><Send size={16} /><span>تنبيهات Telegram</span></div>
            <p className={`mt-2 text-xl font-bold ${health.telegram_configured ? 'text-emerald-700' : 'text-amber-700'}`}>{health.telegram_configured ? 'مفعّلة' : 'غير مهيأة'}</p>
            <button type="button" onClick={() => void testAlert()} disabled={testState.busy || !health.telegram_configured}
              className="mt-2 flex items-center gap-1 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-50">
              {testState.busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} إرسال رسالة اختبار
            </button>
            {testState.message && <p role={testState.ok ? 'status' : 'alert'} className={`mt-2 text-xs ${testState.ok ? 'text-emerald-700' : 'text-red-700'}`}>{testState.message}</p>}
          </div>
        </div>
      )}

      <section className="rounded-xl border border-gray-100 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 p-4">
          <h2 className="font-semibold text-gray-900">الأخطاء المسجلة</h2>
          <div role="group" aria-label="الفترة" className="flex gap-1">
            {PERIODS.map(period => (
              <button key={period.days} type="button" aria-pressed={days === period.days} onClick={() => setDays(period.days)}
                className={`rounded-lg px-3 py-1.5 text-xs ${days === period.days ? 'bg-primary-600 text-white' : 'bg-gray-50 text-gray-700 hover:bg-gray-100'}`}>{period.label}</button>
            ))}
          </div>
        </div>
        {errors && errors.length === 0 ? (
          <p className="flex items-center gap-2 p-6 text-sm text-emerald-700"><CheckCircle2 size={16} /> ماكو أخطاء خادم مسجلة بهذه الفترة.</p>
        ) : errors && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-4 py-2 text-right font-semibold">المسار</th>
                  <th className="px-4 py-2 text-right font-semibold">الخطأ</th>
                  <th className="px-4 py-2 text-right font-semibold">التكرار</th>
                  <th className="px-4 py-2 text-right font-semibold">المدارس</th>
                  <th className="px-4 py-2 text-right font-semibold">آخر ظهور</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {errors.map(group => (
                  <tr key={group.fingerprint}>
                    <td className="px-4 py-2 align-top"><code dir="ltr" className="text-xs">{group.method} {group.route}</code><span className="mr-2 rounded bg-red-50 px-1.5 text-xs text-red-700">{group.status}</span></td>
                    <td className="max-w-md px-4 py-2 align-top text-xs text-gray-700" dir="ltr">{[group.error_name, group.error_message].filter(Boolean).join(': ') || '—'}</td>
                    <td className="px-4 py-2 align-top">{toArabicDigits(String(group.occurrences))}</td>
                    <td className="px-4 py-2 align-top">{toArabicDigits(String(group.schools))}</td>
                    <td className="px-4 py-2 align-top text-xs text-gray-600">{formatTime(group.last_seen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
