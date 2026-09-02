import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { AlertTriangle, BookOpen, GraduationCap, LayoutGrid, Printer, UserRound } from 'lucide-react';
import { useSchoolRequestGuard } from '../../hooks/useSchoolRequestGuard';
import { getTimetableMasterGrid } from '../../lib/api';
import {
  TIMETABLE_DAY_NAMES,
  buildTimetableMasterPlacements,
  timetableEntryForPlacement,
  timetablePlacementKey,
  timetableSubjectColor,
  type TimetableGridEntry,
  type TimetableMasterGridData,
  type TimetablePlacement,
  type TimetableSlot,
} from '../../lib/timetable';
import './timetablePrint.css';

type ViewMode = 'master' | 'placement' | 'teacher';
type MasterPageSize = 'A3' | 'A2' | 'A1';

interface MasterTimetableTabProps {
  schoolId: number;
  academicYearId: number;
  dataVersion: number;
  onOpenRepair: () => void;
}

function YearValue({ value }: { value: string }) {
  return <bdi dir="ltr" className="inline-block [unicode-bidi:isolate]">{value}</bdi>;
}

function placementLabel(placement: TimetablePlacement) {
  return placement.section_name
    ? `${placement.class_name} / ${placement.section_name}`
    : placement.class_name;
}

function slotLabel(slot: TimetableSlot) {
  return slot.lesson_number == null ? slot.label : `${slot.label} — الحصة ${slot.lesson_number}`;
}

function SubjectCell({ entry, extra }: { entry: TimetableGridEntry | null; extra?: ReactNode }) {
  if (!entry) return <span className="text-gray-400">—</span>;
  const color = timetableSubjectColor(entry.subject_id);
  const style = {
    '--subject-bg': color.background,
    '--subject-border': color.border,
    '--subject-text': color.foreground,
  } as CSSProperties;
  return (
    <div
      className="timetable-subject-card"
      style={style}
      data-subject-id={entry.subject_id}
      title={`${entry.subject_name}\n${entry.employee_name || 'بدون مدرس'}\n${entry.class_name}${entry.section_name ? ` / ${entry.section_name}` : ''}`}
    >
      <strong>{entry.subject_name}</strong>
      <span>{entry.employee_name || 'بدون مدرس'}</span>
      {extra}
    </div>
  );
}

function PrintHeader({ data, title }: { data: TimetableMasterGridData; title: string }) {
  return (
    <header className="timetable-print-header">
      <div className="timetable-print-school">
        {data.school.logo_url && <img src={data.school.logo_url} alt={`شعار ${data.school.name}`} />}
        <div>
          <p>{data.school.name}</p>
          <h2>{title}</h2>
        </div>
      </div>
      <p className="timetable-print-year">السنة الدراسية <YearValue value={data.academic_year.name} /></p>
    </header>
  );
}

function SubjectLegend({ entries }: { entries: TimetableGridEntry[] }) {
  const subjects = useMemo(() => {
    const seen = new Set<number>();
    return entries.filter((entry) => {
      if (seen.has(Number(entry.subject_id))) return false;
      seen.add(Number(entry.subject_id));
      return true;
    }).sort((a, b) => a.subject_name.localeCompare(b.subject_name, 'ar'));
  }, [entries]);
  if (subjects.length === 0) return null;
  return (
    <section className="timetable-subject-legend" aria-label="دليل ألوان المواد">
      <strong>مفتاح الألوان:</strong>
      {subjects.map((entry) => {
        const color = timetableSubjectColor(entry.subject_id);
        return (
          <span key={entry.subject_id} style={{ '--legend-color': color.background, '--legend-border': color.border } as CSSProperties}>
            <i aria-hidden="true" />{entry.subject_name}
          </span>
        );
      })}
    </section>
  );
}

function MasterGrid({ data, placements }: { data: TimetableMasterGridData; placements: TimetablePlacement[] }) {
  return (
    <div className="timetable-master-scroll" tabIndex={0} aria-label="الجدول الكامل القابل للتمرير">
      <table className="timetable-master-table" style={{ minWidth: `${Math.max(920, 150 + placements.length * 145)}px` }}>
        <caption className="sr-only">الجدول الدراسي الكامل لجميع الصفوف والشعب</caption>
        <thead>
          <tr>
            <th className="timetable-sticky-axis">الفترة</th>
            {placements.map((placement) => <th key={timetablePlacementKey(placement)}>{placementLabel(placement)}</th>)}
          </tr>
        </thead>
        <tbody>
          {data.days.map((day) => {
            const daySlots = data.slots.filter((slot) => Number(slot.day_of_week) === Number(day.day_of_week));
            return [
              <tr key={`day:${day.id}`} className="timetable-day-row"><th colSpan={Math.max(1, placements.length + 1)}>{TIMETABLE_DAY_NAMES[day.day_of_week]}</th></tr>,
              ...daySlots.map((slot) => slot.slot_type === 'break' ? (
                <tr key={slot.id} className="timetable-break-row">
                  <td colSpan={Math.max(1, placements.length + 1)}>
                    <strong>{slot.label}</strong> <YearValue value={`${slot.start_time}–${slot.end_time}`} />
                  </td>
                </tr>
              ) : (
                <tr key={slot.id}>
                  <th className="timetable-sticky-axis">
                    <span>{slotLabel(slot)}</span>
                    <YearValue value={`${slot.start_time}–${slot.end_time}`} />
                  </th>
                  {placements.map((placement) => (
                    <td key={timetablePlacementKey(placement)}>
                      <SubjectCell entry={timetableEntryForPlacement(data.entries, slot.id, placement)} />
                    </td>
                  ))}
                </tr>
              )),
            ];
          })}
          {data.days.length === 0 && (
            <tr><td colSpan={Math.max(1, placements.length + 1)} className="timetable-empty">لا توجد أيام دوام فعالة لهذه السنة.</td></tr>
          )}
          {data.days.length > 0 && data.slots.length === 0 && (
            <tr><td colSpan={Math.max(1, placements.length + 1)} className="timetable-empty">لا توجد فترات فعالة لعرضها في الجدول.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function PlacementGrid({ data, placement }: { data: TimetableMasterGridData; placement: TimetablePlacement }) {
  return (
    <table className="timetable-focused-table">
      <caption className="sr-only">جدول {placementLabel(placement)}</caption>
      <thead><tr><th>الفترة</th><th>المادة والمدرس</th></tr></thead>
      <tbody>
        {data.days.flatMap((day) => {
          const daySlots = data.slots.filter((slot) => Number(slot.day_of_week) === Number(day.day_of_week));
          return [
            <tr key={`day:${day.id}`} className="timetable-day-row"><th colSpan={2}>{TIMETABLE_DAY_NAMES[day.day_of_week]}</th></tr>,
            ...daySlots.map((slot) => slot.slot_type === 'break' ? (
              <tr key={slot.id} className="timetable-break-row"><td colSpan={2}><strong>{slot.label}</strong> <YearValue value={`${slot.start_time}–${slot.end_time}`} /></td></tr>
            ) : (
              <tr key={slot.id}>
                <th><span>{slotLabel(slot)}</span><YearValue value={`${slot.start_time}–${slot.end_time}`} /></th>
                <td><SubjectCell entry={timetableEntryForPlacement(data.entries, slot.id, placement)} /></td>
              </tr>
            )),
          ];
        })}
        {data.slots.length === 0 && <tr><td colSpan={2} className="timetable-empty">لا توجد فترات فعالة لعرضها.</td></tr>}
      </tbody>
    </table>
  );
}

function TeacherGrid({ data, teacherId }: { data: TimetableMasterGridData; teacherId: number }) {
  const entries = data.entries.filter((entry) => Number(entry.employee_id) === teacherId);
  const entryBySlot = new Map(entries.map((entry) => [Number(entry.slot_id), entry]));
  return (
    <table className="timetable-focused-table">
      <caption className="sr-only">جدول المدرس المختار</caption>
      <thead><tr><th>الفترة</th><th>المادة والصف</th></tr></thead>
      <tbody>
        {data.days.flatMap((day) => {
          const daySlots = data.slots.filter((slot) => Number(slot.day_of_week) === Number(day.day_of_week));
          return [
            <tr key={`day:${day.id}`} className="timetable-day-row"><th colSpan={2}>{TIMETABLE_DAY_NAMES[day.day_of_week]}</th></tr>,
            ...daySlots.map((slot) => slot.slot_type === 'break' ? (
              <tr key={slot.id} className="timetable-break-row"><td colSpan={2}><strong>{slot.label}</strong> <YearValue value={`${slot.start_time}–${slot.end_time}`} /></td></tr>
            ) : (
              <tr key={slot.id}>
                <th><span>{slotLabel(slot)}</span><YearValue value={`${slot.start_time}–${slot.end_time}`} /></th>
                <td><SubjectCell entry={entryBySlot.get(Number(slot.id)) || null} extra={entryBySlot.has(Number(slot.id)) ? <small>{entryBySlot.get(Number(slot.id))!.class_name}{entryBySlot.get(Number(slot.id))!.section_name ? ` / ${entryBySlot.get(Number(slot.id))!.section_name}` : ''}</small> : undefined} /></td>
              </tr>
            )),
          ];
        })}
        {data.slots.length === 0 && <tr><td colSpan={2} className="timetable-empty">لا توجد فترات فعالة لعرضها.</td></tr>}
      </tbody>
    </table>
  );
}

function masterPageRecommendation(columnCount: number): MasterPageSize {
  if (columnCount <= 8) return 'A3';
  if (columnCount <= 15) return 'A2';
  return 'A1';
}

const PAGE_DIMENSIONS: Record<MasterPageSize | 'A4', string> = {
  A4: '297mm 210mm',
  A3: '420mm 297mm',
  A2: '594mm 420mm',
  A1: '841mm 594mm',
};

export function MasterTimetableTab({ schoolId, academicYearId, dataVersion, onOpenRepair }: MasterTimetableTabProps) {
  const captureSchoolRequest = useSchoolRequestGuard(schoolId);
  const requestGenerationRef = useRef(0);
  const [data, setData] = useState<TimetableMasterGridData | null>(null);
  const [mode, setMode] = useState<ViewMode>('master');
  const [placementKey, setPlacementKey] = useState('');
  const [teacherId, setTeacherId] = useState<number | null>(null);
  const [pageSize, setPageSize] = useState<MasterPageSize>('A3');
  const [fitOnePage, setFitOnePage] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const generation = ++requestGenerationRef.current;
    const isCurrentSchool = captureSchoolRequest();
    setData(null);
    setPlacementKey('');
    setTeacherId(null);
    setLoading(true);
    setError('');
    void getTimetableMasterGrid(schoolId, academicYearId).then((response) => {
      if (generation !== requestGenerationRef.current || !isCurrentSchool()) return;
      setLoading(false);
      if (response.error) return setError(response.error);
      setData(response.data || null);
    });
    return () => { requestGenerationRef.current += 1; };
  }, [academicYearId, captureSchoolRequest, dataVersion, schoolId]);

  useEffect(() => {
    const startPrint = () => document.body.classList.add('timetable-print-mode');
    const finishPrint = () => document.body.classList.remove('timetable-print-mode');
    window.addEventListener('beforeprint', startPrint);
    window.addEventListener('afterprint', finishPrint);
    return () => {
      window.removeEventListener('beforeprint', startPrint);
      window.removeEventListener('afterprint', finishPrint);
      finishPrint();
    };
  }, []);

  const placements = useMemo(() => data ? buildTimetableMasterPlacements(data.classes, data.sections) : [], [data]);
  const selectedPlacement = placements.find((placement) => timetablePlacementKey(placement) === placementKey) || null;
  const selectedTeacher = data?.teachers.find((teacher) => Number(teacher.id) === teacherId) || null;
  const selectedEntries = mode === 'teacher' && teacherId != null
    ? data?.entries.filter((entry) => Number(entry.employee_id) === teacherId) || []
    : mode === 'placement' && selectedPlacement
      ? data?.entries.filter((entry) => Number(entry.class_id) === selectedPlacement.class_id && (entry.section_id == null || Number(entry.section_id) === Number(selectedPlacement.section_id))) || []
      : data?.entries || [];
  const recommendedPageSize = masterPageRecommendation(placements.length);
  const printSize = mode === 'master' ? pageSize : 'A4';
  const canPrint = data != null && (mode === 'master' || (mode === 'placement' && selectedPlacement != null) || (mode === 'teacher' && selectedTeacher != null));
  const title = mode === 'placement' && selectedPlacement
    ? `جدول ${placementLabel(selectedPlacement)}`
    : mode === 'teacher' && selectedTeacher
      ? `جدول المدرس: ${selectedTeacher.full_name}`
      : 'الجدول الدراسي الأسبوعي';

  function printTimetable() {
    if (!canPrint) return;
    document.body.classList.add('timetable-print-mode');
    window.print();
  }

  if (loading) return <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-gray-500">جاري تحميل الجدول الكامل...</div>;
  if (error) return <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-red-800">{error}</div>;
  if (!data) return <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-gray-500">تعذر تحميل بيانات الجدول.</div>;

  return (
    <section className="space-y-4" dir="rtl">
      {data.invalid_entry_count > 0 && (
        <div className="no-print flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-red-900" role="alert">
          <AlertTriangle size={20} />
          <p className="font-semibold">توجد <bdi dir="ltr">{data.invalid_entry_count}</bdi> حصة تحتاج إصلاح؛ ولن تظهر كخلايا صحيحة في الجدول.</p>
          <button type="button" onClick={onOpenRepair} className="mr-auto rounded-lg bg-red-700 px-3 py-2 text-sm font-bold text-white">العودة إلى شبكة التحرير للإصلاح</button>
        </div>
      )}

      <div className="no-print space-y-4 rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="طريقة عرض الجدول">
          {([
            ['master', 'الجدول الكامل', LayoutGrid],
            ['placement', 'جدول صف / شعبة', GraduationCap],
            ['teacher', 'جدول مدرس', UserRound],
          ] as const).map(([key, label, Icon]) => (
            <button key={key} type="button" role="tab" aria-selected={mode === key} onClick={() => setMode(key)} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold ${mode === key ? 'border-primary-600 bg-primary-50 text-primary-800' : 'border-gray-200 text-gray-600'}`}>
              <Icon size={17} />{label}
            </button>
          ))}
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          {mode === 'placement' && (
            <label className="text-sm font-semibold text-gray-700">الصف / الشعبة
              <select value={placementKey} onChange={(event) => setPlacementKey(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2">
                <option value="">اختر الصف أو الشعبة</option>
                {placements.map((placement) => <option key={timetablePlacementKey(placement)} value={timetablePlacementKey(placement)}>{placementLabel(placement)}</option>)}
              </select>
            </label>
          )}
          {mode === 'teacher' && (
            <label className="text-sm font-semibold text-gray-700">المدرس
              <select value={teacherId ?? ''} onChange={(event) => setTeacherId(event.target.value ? Number(event.target.value) : null)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2">
                <option value="">اختر مدرسًا</option>
                {data.teachers.map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.full_name}</option>)}
              </select>
            </label>
          )}
          {mode === 'master' && (
            <label className="text-sm font-semibold text-gray-700">حجم ورق الجدول الكامل
              <select value={pageSize} onChange={(event) => setPageSize(event.target.value as MasterPageSize)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2">
                <option value="A3">A3 — أفقي</option><option value="A2">A2 — أفقي</option><option value="A1">A1 — أفقي</option>
              </select>
            </label>
          )}
          <label className="flex items-center gap-2 self-end rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700">
            <input type="checkbox" checked={fitOnePage} onChange={(event) => setFitOnePage(event.target.checked)} />ملاءمة مضغوطة لورقة واحدة
          </label>
          <button type="button" disabled={!canPrint} onClick={printTimetable} className="flex items-center justify-center gap-2 self-end rounded-lg bg-primary-700 px-4 py-2.5 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">
            <Printer size={18} />طباعة / حفظ PDF
          </button>
        </div>
        {mode === 'master' && (
          <p className={`text-sm ${pageSize === recommendedPageSize ? 'text-emerald-700' : 'text-amber-700'}`}>
            يفضل استخدام <bdi dir="ltr">{recommendedPageSize}</bdi> لهذا الجدول (عدد الأعمدة: <bdi dir="ltr">{placements.length}</bdi>). استخدم المقاس الأكبر إذا أصبحت النصوص ضيقة.
          </p>
        )}
      </div>

      <style>{`@media print { @page { size: ${PAGE_DIMENSIONS[printSize]}; margin: ${mode === 'master' ? '7mm' : '9mm'}; } }`}</style>
      <div className={`timetable-print-root timetable-print-${mode} ${fitOnePage ? 'timetable-fit-one-page' : ''}`}>
        <PrintHeader data={data} title={title} />
        {mode === 'master' && (placements.length > 0
          ? <MasterGrid data={data} placements={placements} />
          : <div className="timetable-empty"><BookOpen size={24} />لا توجد صفوف فعالة لعرض الجدول.</div>)}
        {mode === 'placement' && (selectedPlacement
          ? <PlacementGrid data={data} placement={selectedPlacement} />
          : <div className="timetable-empty">اختر صفًا أو شعبة لعرض جدولها وطباعته.</div>)}
        {mode === 'teacher' && (selectedTeacher
          ? <TeacherGrid data={data} teacherId={selectedTeacher.id} />
          : <div className="timetable-empty">اختر مدرسًا لعرض جدوله وطباعته.</div>)}
        <SubjectLegend entries={selectedEntries} />
      </div>
    </section>
  );
}
