import { useEffect, useRef, useState, type FormEvent } from 'react';
import { deleteTeacherWorkloadExtra, saveTeacherWorkloadExtra } from '../../lib/api';
import type { TeacherWorkloadExtra } from '../../lib/teacherWorkloadExtras';
import type { TeacherWorkloadSummary } from '../../lib/teacherWorkloadSummary';

export function TeacherWorkloadExtrasEditor({ summary, onChanged, onBusyChange, save = saveTeacherWorkloadExtra, remove = deleteTeacherWorkloadExtra }: {
  summary: TeacherWorkloadSummary; onChanged: () => void; onBusyChange: (busy: boolean) => void;
  save?: typeof saveTeacherWorkloadExtra; remove?: typeof deleteTeacherWorkloadExtra;
}) {
  const [editing, setEditing] = useState<TeacherWorkloadExtra | null>(null);
  const [teacherId, setTeacherId] = useState('');
  const [subject, setSubject] = useState('');
  const [periods, setPeriods] = useState('1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const scope = { school_id: summary.school.id, academic_year_id: summary.academic_year.id };
  const teachers = summary.teachers.filter(t => t.employee_id != null);
  const rows = teachers.flatMap(t => (t.extras || []).map(extra => ({ extra, name: t.employee_name })));
  function reset() { setEditing(null); setTeacherId(''); setSubject(''); setPeriods('1'); setError(''); }
  async function mutate(action: () => ReturnType<typeof saveTeacherWorkloadExtra>) {
    if (busy) return;
    setBusy(true); onBusyChange(true); setError('');
    try {
      const response = await action();
      if (!active.current) return;
      if (response.error || !response.data) throw new Error(response.error || 'تعذر حفظ النصاب');
      reset(); onChanged();
    } catch (failure) { if (active.current) setError(failure instanceof Error ? failure.message : 'تعذر حفظ النصاب'); }
    finally { if (active.current) { setBusy(false); onBusyChange(false); } }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    const count = Number(periods), employee = Number(teacherId);
    if (!teachers.some(t => t.employee_id === employee) || !subject.trim() || !Number.isSafeInteger(count) || count < 1 || count > 60) {
      setError('اختر المدرس والمادة وعددًا صحيحًا من ١ إلى ٦٠.'); return;
    }
    void mutate(() => save({ ...scope, employee_id: employee, subject_name: subject, weekly_periods: count, expected_version: editing?.version || 0 }, editing?.id));
  }
  return <details className="mt-4 rounded-lg border bg-white p-3">
    <summary className="cursor-pointer font-semibold">إدارة إضافات النصاب</summary>
    <p className="my-2">تُحتسب هذه الحصص ضمن نصاب المدرس، ولا تظهر في عرض جدول الحصص.</p>
    {error && <p role="alert" className="text-red-700">{error} <button type="button" disabled={busy} onClick={onChanged} className="underline">تحديث الكشف</button></p>}
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <label>المدرس<select aria-label="مدرس النصاب الإضافي" required disabled={busy || !!editing} value={teacherId} onChange={e => setTeacherId(e.target.value)} className="block rounded border p-2">
        <option value="">اختر المدرس</option>{teachers.map(t => <option key={t.employee_id} value={t.employee_id!}>{t.employee_name}</option>)}
      </select></label>
      <label>المادة<input aria-label="مادة النصاب الإضافي" required maxLength={120} disabled={busy} value={subject} onChange={e => setSubject(e.target.value)} className="block rounded border p-2" /></label>
      <label>الحصص الأسبوعية<input aria-label="حصص النصاب الإضافي" required type="number" min={1} max={60} step={1} disabled={busy} value={periods} onChange={e => setPeriods(e.target.value)} className="block w-28 rounded border p-2" /></label>
      <button type="submit" disabled={busy} className="rounded bg-primary-600 px-3 py-2 text-white">{busy ? 'جارٍ الحفظ...' : editing ? 'حفظ التعديل' : 'إضافة نصاب'}</button>
      {editing && <button type="button" disabled={busy} onClick={reset}>إلغاء التعديل</button>}
    </form>
    <ul className="mt-3 space-y-2">{rows.map(({ extra, name }) => <li key={extra.id} className="flex flex-wrap items-center gap-3 border-t pt-2">
      <span>{name} — {extra.subject_name}: {extra.weekly_periods} حصة أسبوعيًا</span>
      <button type="button" disabled={busy} onClick={() => { setEditing(extra); setTeacherId(String(extra.employee_id)); setSubject(extra.subject_name); setPeriods(String(extra.weekly_periods)); setError(''); }}>تعديل</button>
      <button type="button" disabled={busy} className="text-red-700" onClick={() => { void mutate(() => remove(extra.id, { ...scope, expected_version: extra.version })); }}>حذف</button>
    </li>)}</ul>
  </details>;
}
