import { useEffect, useId, useRef, useState } from 'react';
import { Archive, Eye, LoaderCircle, X } from 'lucide-react';
import { useSchoolRequestGuard } from '../../hooks/useSchoolRequestGuard';
import { getWeekArchive, getWeekArchives } from '../../lib/api';
import { TIMETABLE_DAY_NAMES, type TimetableTeachingLoad } from '../../lib/timetable';
import type { WeekArchiveDetail, WeekArchiveSummary } from '../../lib/weekSetup';

interface WeekArchivesPanelProps {
  schoolId: number;
  academicYearId: number;
  dataVersion: number;
}

function formatTimestamp(value: number) {
  return new Date(Number(value) * 1000).toLocaleString('ar-IQ');
}

function loadGroup(load: TimetableTeachingLoad | undefined) {
  if (!load) return 'بيانات الصف غير متاحة';
  return `${load.class_name || `صف رقم ${load.class_id}`}${load.section_id === null ? '' : ` — ${load.section_name || `شعبة رقم ${load.section_id}`}`}`;
}

export function WeekArchivesPanel({ schoolId, academicYearId, dataVersion }: WeekArchivesPanelProps) {
  const captureSchoolRequest = useSchoolRequestGuard(schoolId);
  const generationRef = useRef(0);
  const detailRequestRef = useRef(0);
  const activeButtonRef = useRef<HTMLButtonElement | null>(null);
  const detailsHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const panelId = useId();
  const [archives, setArchives] = useState<WeekArchiveSummary[]>([]);
  const [details, setDetails] = useState<WeekArchiveDetail | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const generation = ++generationRef.current;
    const isCurrentSchool = captureSchoolRequest();
    detailRequestRef.current += 1;
    setArchives([]);
    setDetails(null);
    setSelectedId(null);
    setDetailLoading(false);
    setDetailError('');
    setError('');
    setLoading(true);
    void getWeekArchives({ school_id: schoolId, academic_year_id: academicYearId }).then((response) => {
      if (generation !== generationRef.current || !isCurrentSchool()) return;
      setLoading(false);
      if (response.error) return setError(response.error);
      setArchives(response.data || []);
    });
    return () => { generationRef.current += 1; detailRequestRef.current += 1; };
  }, [academicYearId, captureSchoolRequest, dataVersion, reload, schoolId]);

  useEffect(() => { if (details) detailsHeadingRef.current?.focus(); }, [details]);

  async function viewArchive(id: number, button: HTMLButtonElement) {
    const generation = generationRef.current;
    const request = ++detailRequestRef.current;
    const isCurrentSchool = captureSchoolRequest();
    activeButtonRef.current = button;
    setSelectedId(id);
    setDetails(null);
    setDetailError('');
    setDetailLoading(true);
    const response = await getWeekArchive(id, { school_id: schoolId, academic_year_id: academicYearId });
    if (generation !== generationRef.current || request !== detailRequestRef.current || !isCurrentSchool()) return;
    setDetailLoading(false);
    if (response.error) return setDetailError(response.error);
    setDetails(response.data || null);
  }

  function closeDetails() {
    detailRequestRef.current += 1;
    setDetails(null);
    setSelectedId(null);
    setDetailLoading(false);
    setDetailError('');
    activeButtonRef.current?.focus();
  }

  const loads = new Map(details?.snapshot.loads.map(load => [load.id, load]));
  const days = details ? [...details.day_numbers].sort((a, b) => {
    const dayA = details.snapshot.days.find(day => day.day_of_week === a);
    const dayB = details.snapshot.days.find(day => day.day_of_week === b);
    return (dayA?.order_index ?? a) - (dayB?.order_index ?? b) || a - b;
  }) : [];

  return (
    <section className="space-y-4 border-t border-slate-200 pt-5" aria-label="أرشيف الجداول المستبدلة" dir="rtl">
      <div>
        <h2 className="flex items-center gap-2 font-bold text-slate-900"><Archive size={20} aria-hidden="true" />أرشيف الجداول المستبدلة</h2>
        <p className="mt-1 text-sm text-slate-600">نسخ للعرض من إعدادات الأيام ودروسها قبل الاستبدال. الجدول الجديد هو المعروض في «الجدول الحالي».</p>
      </div>
      {loading && <p role="status" className="flex items-center gap-2 p-4 text-slate-600"><LoaderCircle size={18} className="animate-spin" aria-hidden="true" />جاري تحميل الأرشيف...</p>}
      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800"><p>{error}</p><button type="button" onClick={() => setReload(value => value + 1)} className="mt-2 rounded-lg border border-red-300 px-3 py-2">إعادة تحميل الأرشيف</button></div>}
      {!loading && !error && archives.length === 0 && <p className="rounded-xl border border-dashed p-5 text-center text-slate-500">لا توجد جداول مستبدلة مؤرشفة بعد.</p>}
      {!loading && archives.length > 0 && <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[640px] text-right text-sm">
          <caption className="sr-only">الجداول المؤرشفة قبل استبدال إعدادات الأيام</caption>
          <thead className="bg-slate-50 text-slate-600"><tr><th scope="col" className="p-3">تاريخ الأرشفة</th><th scope="col" className="p-3">الأيام المستبدلة</th><th scope="col" className="p-3">الفترات</th><th scope="col" className="p-3">الدروس الموزعة</th><th scope="col" className="p-3">التفاصيل</th></tr></thead>
          <tbody>{archives.map(archive => <tr key={archive.id} className="border-t border-slate-200">
            <td className="p-3">{formatTimestamp(archive.created_at)}</td>
            <td className="p-3">{archive.day_numbers.map(day => TIMETABLE_DAY_NAMES[day]).join('، ')}</td>
            <td className="p-3"><bdi>{archive.period_count}</bdi></td>
            <td className="p-3"><bdi>{archive.entry_count}</bdi></td>
            <td className="p-3"><button type="button" aria-label={`عرض أرشيف الجدول رقم ${archive.id}`} aria-expanded={selectedId === archive.id} aria-controls={panelId} onClick={event => void viewArchive(archive.id, event.currentTarget)} className="flex items-center gap-1 rounded-lg border px-3 py-2 text-blue-700"><Eye size={16} aria-hidden="true" />عرض الأرشيف</button></td>
          </tr>)}</tbody>
        </table>
      </div>}
      <div id={panelId}>
        {selectedId !== null && <section className="space-y-3 rounded-xl border border-blue-200 bg-blue-50/40 p-4" aria-label={`تفاصيل أرشيف الجدول رقم ${selectedId}`}>
          <div className="flex items-start justify-between gap-3">
            <h3 ref={detailsHeadingRef} tabIndex={-1} className="font-bold text-slate-900">الجدول السابق قبل الاستبدال</h3>
            <button type="button" onClick={closeDetails} className="flex shrink-0 items-center gap-1 rounded-lg border bg-white px-3 py-2 text-sm"><X size={16} aria-hidden="true" />إغلاق الأرشيف</button>
          </div>
          {detailLoading && <p role="status">جاري تحميل تفاصيل الأرشيف...</p>}
          {detailError && <p role="alert" className="text-red-800">{detailError}</p>}
          {details && <>
            <p className="text-sm text-slate-600">أُرشف في {formatTimestamp(details.created_at)}. هذه نسخة محفوظة للعرض.</p>
            {days.map(dayNumber => {
              const day = details.snapshot.days.find(item => item.day_of_week === dayNumber);
              const slots = details.snapshot.slots.filter(slot => slot.day_of_week === dayNumber).sort((a, b) => a.slot_index - b.slot_index);
              return <section key={dayNumber} className="rounded-lg border border-slate-200 bg-white p-3" aria-label={`الجدول المؤرشف ليوم ${TIMETABLE_DAY_NAMES[dayNumber]}`}>
                <h4 className="mb-3 font-bold">{TIMETABLE_DAY_NAMES[dayNumber]} <span className="text-xs font-normal text-slate-500">{day?.is_active === 1 ? 'يوم نشط' : 'يوم غير نشط'}</span></h4>
                {slots.length === 0 ? <p className="text-sm text-slate-500">لا توجد فترات محفوظة لهذا اليوم.</p> : <ol className="space-y-2">
                  {slots.map(slot => {
                    const entries = details.snapshot.entries.filter(entry => entry.slot_id === slot.id);
                    return <li key={slot.id} className={`rounded-lg border p-3 ${slot.slot_type === 'break' ? 'border-amber-100 bg-amber-50' : 'border-slate-200'}`}>
                      <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><span className="font-bold">{slot.label} <span className="font-normal text-slate-500">({slot.slot_type === 'break' ? 'استراحة' : `الدرس ${slot.lesson_number}`}){slot.is_active === 0 && ' — غير نشط'}</span></span><bdi dir="ltr">{slot.start_time} – {slot.end_time}</bdi></div>
                      {entries.length > 0 ? <ul className="mt-2 grid gap-2 md:grid-cols-2">{entries.map(entry => {
                        const load = loads.get(entry.teaching_load_id);
                        return <li key={entry.id} className="rounded border border-slate-100 bg-slate-50 p-2 text-sm"><p className="font-bold">{load?.subject_name || `مادة نصاب رقم ${entry.teaching_load_id}`}</p><p>{loadGroup(load)}</p><p className="text-slate-600">{load?.employee_name || 'المدرس غير محدد'}{entry.is_locked === 1 && ' · درس مثبت'}</p></li>;
                      })}</ul> : slot.slot_type === 'lesson' && <p className="mt-2 text-sm text-slate-500">لا توجد مادة موزعة في هذا الدرس.</p>}
                    </li>;
                  })}
                </ol>}
              </section>;
            })}
          </>}
        </section>}
      </div>
    </section>
  );
}
