import { useEffect, useRef, useState } from 'react';
import { getTimetablePreferences, saveTimetablePreferences } from '../../lib/api';
import { DEFAULT_TIMETABLE_PREFERENCES, TIMETABLE_PREFERENCE_LABELS,
  type TimetablePreferenceKey, type TimetablePreferences, type TimetableSchoolPreferences } from '../../lib/timetablePreferences';

export function TimetablePreferencesPanel({schoolId, disabled, onSaved, onBusy, onDirty}: {
  schoolId: number; disabled: boolean; onSaved: () => void;
  onBusy: (busy: boolean) => void; onDirty: (dirty: boolean) => void;
}) {
  const [saved, setSaved] = useState<TimetableSchoolPreferences | null>(null);
  const [draft, setDraft] = useState<TimetablePreferences>({...DEFAULT_TIMETABLE_PREFERENCES});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [reload, setReload] = useState(0);
  const request = useRef(0);
  const dirty = saved != null && JSON.stringify(draft) !== JSON.stringify(saved.preferences);
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => {
    const token = ++request.current;
    setSaved(null); setBusy(false); setError(''); setMessage('');
    void getTimetablePreferences(schoolId).then(response => {
      if (request.current !== token) return;
      if (response.data?.school_id === schoolId) { setSaved(response.data); setDraft(response.data.preferences); }
      else setError(response.error || 'تعذر تحميل أولويات المدرسة');
    });
    return () => { request.current += 1; onBusy(false); onDirty(false); };
  }, [schoolId, reload, onBusy, onDirty]);

  async function save() {
    if (!saved || busy || disabled) return;
    const token = ++request.current;
    setBusy(true); onBusy(true); setError(''); setMessage('');
    try {
      const response = await saveTimetablePreferences(schoolId, saved.revision, draft);
      if (request.current !== token) return;
      if (response.data?.school_id === schoolId) {
        setSaved(response.data); setDraft(response.data.preferences); setMessage('حُفظت أولويات هذه المدرسة'); onSaved();
      } else setError(response.error || 'تعذر حفظ أولويات المدرسة');
    } finally { if (request.current === token) { setBusy(false); onBusy(false); } }
  }

  return <details className="rounded-xl border border-gray-200 bg-white p-4">
    <summary className="cursor-pointer font-bold text-gray-900">أولويات التوزيع لهذه المدرسة</summary>
    <p className="mt-2 text-sm text-gray-600">اكتمال النصاب ومنع التعارض وتوفر المدرسين والتثبيت شروط إلزامية. قلّل أو زد أهمية التفضيلات التالية بحسب احتياجات المدرسة.</p>
    <p className="mt-1 text-sm text-gray-600">عند تساوي التغطية نفضّل أقل تكرار للمادة يوميًا، ثم أقل مواد خفيفة في البداية إذا فعّلت هذا التفضيل، ثم مجموع بقية الأولويات.</p>
    {error && <div role="alert" className="mt-3 text-sm text-red-800">{error} <button type="button" disabled={busy || disabled} className="underline" onClick={() => setReload(value => value + 1)}>تحديث الإعدادات</button></div>}
    {!saved && !error && <p role="status" className="mt-3 text-sm text-gray-600">جاري تحميل أولويات المدرسة…</p>}
    {saved && <>
      <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {(Object.keys(TIMETABLE_PREFERENCE_LABELS) as TimetablePreferenceKey[]).map(key => <label key={key} className="text-sm text-gray-800">
          <span className="mb-1 block font-medium">{TIMETABLE_PREFERENCE_LABELS[key]}</span>
          <select aria-label={TIMETABLE_PREFERENCE_LABELS[key]} disabled={busy || disabled} value={draft[key]}
            onChange={event => { setDraft(value => ({...value, [key]: Number(event.target.value)})); setMessage(''); }}
            className="w-full rounded-lg border border-gray-300 p-2">
            <option value={0}>متوقف</option><option value={1}>{key === 'early_light_subjects' ? 'مفعّل' : 'عادي'}</option>
            {key !== 'early_light_subjects' && <option value={2}>عالي</option>}
          </select>
        </label>)}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" disabled={busy || disabled || !dirty} onClick={() => void save()} className="rounded-lg bg-indigo-700 px-4 py-2 font-bold text-white disabled:opacity-50">{busy ? 'جاري الحفظ…' : 'حفظ أولويات المدرسة'}</button>
        <button type="button" disabled={busy || disabled} onClick={() => {setDraft({...DEFAULT_TIMETABLE_PREFERENCES}); setMessage('');}} className="rounded-lg border border-gray-300 px-4 py-2 text-gray-800">القيم الافتراضية</button>
        {dirty && <span className="text-sm text-amber-800">احفظ الأولويات قبل بدء التوليد.</span>}
        {message && <span role="status" className="text-sm text-green-800">{message}</span>}
      </div>
    </>}
  </details>;
}
