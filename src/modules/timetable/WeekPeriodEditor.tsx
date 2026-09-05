import { bellTime, minuteOfDay } from '../../lib/weekSetup';
import type { DraftPeriod } from './weekDraft';

const inputClass = 'w-full min-w-0 rounded border border-gray-300 bg-white px-2 py-2 text-sm';
export function WeekPeriodEditor({rows, onChange}: {rows: DraftPeriod[]; onChange: (rows: DraftPeriod[]) => void}) {
  const edit = (i: number, patch: Partial<DraftPeriod>) => onChange(rows.map((p, index) => index === i ? {...p, ...patch} : p));
  return <div className="space-y-3" aria-label="فترات القالب القابلة للتعديل">
    {rows.map((p, i) => {
      let duration = ''; try { duration = String(minuteOfDay(p.end_time) - minuteOfDay(p.start_time)); } catch { /* Incomplete local input stays editable. */ }
      return <fieldset key={i} className={`min-w-0 rounded-lg border p-3 ${p.is_active === 0 ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-gray-50'}`}>
        <legend className="px-1 text-sm font-bold">الفترة {i + 1}{p.is_active === 0 ? ' — غير نشطة' : ''}</legend>
        <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
          <label className="text-xs">الترتيب<input aria-label={`ترتيب الفترة ${i + 1}`} className={inputClass} type="number" min="1" value={p.slot_index} onChange={e => edit(i, {slot_index: e.target.value})}/></label>
          <label className="text-xs">النوع<select aria-label={`نوع الفترة ${i + 1}`} className={inputClass} value={p.slot_type} onChange={e => edit(i, {slot_type: e.target.value as DraftPeriod['slot_type'], lesson_number: e.target.value === 'break' ? '' : p.lesson_number})}><option value="lesson">حصة</option><option value="break">استراحة</option></select></label>
          <label className="text-xs">رقم الحصة<input aria-label={`رقم حصة الفترة ${i + 1}`} className={inputClass} type="number" min="1" disabled={p.slot_type === 'break'} value={p.lesson_number} onChange={e => edit(i, {lesson_number: e.target.value})}/></label>
          <label className="text-xs">الاسم<input aria-label={`اسم الفترة ${i + 1}`} className={inputClass} value={p.label} maxLength={120} onChange={e => edit(i, {label: e.target.value})}/></label>
          <label className="text-xs">البداية<input aria-label={`بداية الفترة ${i + 1}`} className={inputClass} dir="ltr" type="time" value={p.start_time} onChange={e => edit(i, {start_time: e.target.value})}/></label>
          <label className="text-xs">النهاية<input aria-label={`نهاية الفترة ${i + 1}`} className={inputClass} dir="ltr" type="time" value={p.end_time} onChange={e => edit(i, {end_time: e.target.value})}/></label>
          <label className="text-xs">المدة (دقيقة)<input aria-label={`مدة الفترة ${i + 1}`} className={inputClass} type="number" min="1" value={duration} onChange={e => {
            try { edit(i, {end_time: bellTime(minuteOfDay(p.start_time) + Number(e.target.value))}); } catch { edit(i, {end_time: ''}); }
          }}/></label>
          <div className="flex flex-wrap items-center gap-2"><label className="flex items-center gap-1 text-xs"><input aria-label={`نشاط الفترة ${i + 1}`} type="checkbox" checked={p.is_active === 1} onChange={e => edit(i, {is_active: e.target.checked ? 1 : 0})}/>نشطة</label><button type="button" className="rounded px-2 py-2 text-sm text-red-700" aria-label={`إزالة الفترة ${i + 1}`} onClick={() => onChange(rows.filter((_, index) => index !== i))}>إزالة</button></div>
        </div>
      </fieldset>;
    })}
    <button type="button" disabled={rows.length >= 30} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50" onClick={() => onChange([...rows, {
      slot_index: String(Math.max(0, ...rows.map(p => Number(p.slot_index) || 0)) + 1), slot_type: 'lesson',
      lesson_number: String(Math.max(0, ...rows.map(p => Number(p.lesson_number) || 0)) + 1), label: 'حصة جديدة',
      start_time: rows[rows.length - 1]?.end_time || '08:00', end_time: '', is_active: 1,
    }])}>إضافة فترة إلى المسودة</button>
  </div>;
}
