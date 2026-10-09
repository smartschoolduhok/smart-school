import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { AlertTriangle, BookOpen, GraduationCap, LayoutGrid, Lock, Printer, UserRound } from 'lucide-react';
import { useSchoolRequestGuard } from '../../hooks/useSchoolRequestGuard';
import { getTimetableMasterGrid } from '../../lib/api';
import {
  TIMETABLE_DAY_NAMES,
  timetablePlacementKey,
  timetablePrintSlotLabel,
  timetableSubjectColorForSubject,
  timetableSubjectVisualKey,
  type TimetableGridEntry,
  type TimetableMasterGridData,
  type TimetablePlacement,
  type TimetableSlot,
} from '../../lib/timetable';
import { timetableEntriesForPlacement } from './timetableViewEntries';
import './timetablePrint.css';
import {
  buildTimetablePrintSheets,
  buildTimetablePrintWeek,
  filterTimetablePrintPlacements,
  timetablePrintSheetEntries,
  timetablePrintTeacherOptions,
  timetableEntryMatchesPrintTeacher,
  type TimetablePrintGrouping,
  type TimetablePrintTeacherId,
} from '../../lib/timetablePrint';

type ViewMode = 'master' | 'placement' | 'teacher';
type MasterPageSize = 'A4' | 'A3' | 'A2' | 'A1';

interface MasterTimetableTabProps {
  schoolId: number;
  academicYearId: number;
  dataVersion: number;
  onOpenRepair: () => void;
  loadGrid?: typeof getTimetableMasterGrid;
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
  return timetablePrintSlotLabel(slot);
}

function SubjectCell({ entry, extra }: { entry: TimetableGridEntry | null; extra?: ReactNode }) {
  if (!entry) return <span className="text-gray-400">—</span>;
  const hasTeacherCollision = entry.hard_conflicts.some((conflict) => conflict.code === 'teacher_collision');
  const subjectVisualKey = timetableSubjectVisualKey(entry.school_id, entry.subject_name);
  const color = timetableSubjectColorForSubject(entry.school_id, entry.subject_name);
  const style = {
    '--subject-bg': color.background,
    '--subject-border': color.border,
    '--subject-text': color.foreground,
  } as CSSProperties;
  return (
    <div
      className={`timetable-subject-card ${hasTeacherCollision ? 'timetable-subject-card--teacher-conflict' : ''}`}
      style={style}
      data-subject-id={entry.subject_id}
      data-subject-visual-key={subjectVisualKey}
      data-timetable-teacher-conflict={hasTeacherCollision ? 'true' : 'false'}
      title={`${entry.subject_name}\n${entry.employee_name || 'بدون مدرس'}\n${entry.class_name}${entry.section_name ? ` / ${entry.section_name}` : ''}${hasTeacherCollision ? '\nتعارض المدرّس' : ''}`}
    >
      <strong>{entry.subject_name}</strong>
      <span>{entry.employee_name || 'بدون مدرس'}</span>
      {hasTeacherCollision && <span className="timetable-teacher-conflict-label"><AlertTriangle size={11} />تعارض المدرّس</span>}
      {entry.is_locked === 1 && <span className="no-print inline-flex items-center gap-1 text-[10px] font-bold" title="درس مثبت"><Lock size={11} />مثبت</span>}
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

function PrintFooter({ principalName, columnCount }: { principalName: string | null; columnCount: number }) {
  return (
    <tfoot className="timetable-principal-group">
      <tr className="timetable-principal-row"><td colSpan={columnCount}>
        <footer className="timetable-print-footer" aria-label="مدير المدرسة">
          <strong>مدير المدرسة</strong>
          {principalName?.trim() && <span>{principalName.trim()}</span>}
        </footer>
      </td></tr>
    </tfoot>
  );
}

function SubjectLegend({ entries }: { entries: TimetableGridEntry[] }) {
  const subjects = useMemo(() => {
    const seen = new Set<string>();
    return entries.filter((entry) => {
      const subjectVisualKey = timetableSubjectVisualKey(entry.school_id, entry.subject_name);
      if (seen.has(subjectVisualKey)) return false;
      seen.add(subjectVisualKey);
      return true;
    }).sort((a, b) => a.subject_name.localeCompare(b.subject_name, 'ar'));
  }, [entries]);
  if (subjects.length === 0) return null;
  return (
    <section className="timetable-subject-legend no-print" aria-label="دليل ألوان المواد">
      <strong>مفتاح الألوان:</strong>
      {subjects.map((entry) => {
        const subjectVisualKey = timetableSubjectVisualKey(entry.school_id, entry.subject_name);
        const color = timetableSubjectColorForSubject(entry.school_id, entry.subject_name);
        return (
          <span key={subjectVisualKey} style={{ '--legend-color': color.background, '--legend-border': color.border } as CSSProperties}>
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
                      <div className="timetable-teacher-entry-stack">{timetableEntriesForPlacement(data.entries, slot.id, placement).map(entry => <SubjectCell key={entry.id} entry={entry} />)}</div>
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
        <PrintFooter principalName={data.school.principal_name} columnCount={placements.length + 1} />
      </table>
    </div>
  );
}

function WeeklyGrid({ data, placement, teacherId }: { data: TimetableMasterGridData; placement?: TimetablePlacement; teacherId?: TimetablePrintTeacherId }) {
  const week = buildTimetablePrintWeek(data);
  const entriesBySlot = new Map<number, TimetableGridEntry[]>();
  if (teacherId != null) for (const entry of data.entries.filter((entry) => timetableEntryMatchesPrintTeacher(entry, teacherId))) {
    const entries = entriesBySlot.get(Number(entry.slot_id)) || [];
    entries.push(entry);
    entriesBySlot.set(Number(entry.slot_id), entries);
  }
  return (
    <div className="timetable-week-scroll">
      <table className="timetable-week-table">
        <caption className="sr-only">{placement ? 'جدول ' + placementLabel(placement) : 'جدول المدرس المختار'}</caption>
        <thead><tr><th className="timetable-period-axis">الفترة</th>{week.days.map((day) => <th key={day.day_of_week}>{TIMETABLE_DAY_NAMES[day.day_of_week]}</th>)}</tr></thead>
        <tbody>
          {week.rows.map((row) => <tr key={row.index}>
            <th className="timetable-period-axis"><bdi dir="ltr">{row.index}</bdi></th>
            {row.slots.map((slot, dayIndex) => {
              if (!slot) return <td key={week.days[dayIndex].day_of_week} className="timetable-no-period">لا توجد فترة</td>;
              const entries = teacherId != null ? entriesBySlot.get(Number(slot.id)) || [] : placement ? timetableEntriesForPlacement(data.entries, slot.id, placement) : [];
              return <td key={week.days[dayIndex].day_of_week} data-slot-id={slot.id} className={slot.slot_type === 'break' ? 'timetable-week-break' : ''}>
                <span className="timetable-week-slot-label">{slotLabel(slot)}</span>
                <bdi dir="ltr" className="timetable-week-time">{slot.start_time}–{slot.end_time}</bdi>
                {slot.slot_type === 'break' ? <strong className="timetable-break-label">استراحة</strong>
                  : entries.length === 0 ? <span className="timetable-unscheduled">{teacherId != null ? 'متاح' : 'غير مجدولة'}</span>
                    : <div className="timetable-teacher-entry-stack">{entries.map((item) => <SubjectCell key={item.id} entry={item}
                      extra={teacherId != null ? <small>{item.class_name}{item.section_name ? ' / ' + item.section_name : ''}</small> : undefined} />)}</div>}
              </td>;
            })}
          </tr>)}
          {week.rows.length === 0 && <tr><td colSpan={week.days.length + 1} className="timetable-empty">لا توجد فترات فعالة لعرضها.</td></tr>}
        </tbody>
        <PrintFooter principalName={data.school.principal_name} columnCount={week.days.length + 1} />
      </table>
    </div>
  );
}

function masterPageRecommendation(columnCount: number): MasterPageSize {
  if (columnCount <= 3) return 'A4';
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

export function MasterTimetableTab({ schoolId, academicYearId, dataVersion, onOpenRepair, loadGrid = getTimetableMasterGrid }: MasterTimetableTabProps) {
  const captureSchoolRequest = useSchoolRequestGuard(schoolId);
  const requestGenerationRef = useRef(0);
  const [data, setData] = useState<TimetableMasterGridData | null>(null);
  const [mode, setMode] = useState<ViewMode>('master');
  const [placementKey, setPlacementKey] = useState('');
  const [stage, setStage] = useState('');
  const [classId, setClassId] = useState<number | null>(null);
  const [grouping, setGrouping] = useState<TimetablePrintGrouping>('combined');
  const [teacherId, setTeacherId] = useState<TimetablePrintTeacherId | null>(null);
  const [pageSize, setPageSize] = useState<MasterPageSize>('A3');
  const [fitOnePage, setFitOnePage] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const generation = ++requestGenerationRef.current;
    const isCurrentSchool = captureSchoolRequest();
    setData(null);
    setPlacementKey('');
    setStage('');
    setClassId(null);
    setTeacherId(null);
    setLoading(true);
    setError('');
    void loadGrid(schoolId, academicYearId).then((response) => {
      if (generation !== requestGenerationRef.current || !isCurrentSchool()) return;
      setLoading(false);
      if (response.error) return setError(response.error);
      setData(response.data || null);
    });
    return () => { requestGenerationRef.current += 1; };
  }, [academicYearId, captureSchoolRequest, dataVersion, loadGrid, schoolId]);

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

  const placements = useMemo(() => data ? filterTimetablePrintPlacements(data, stage, classId) : [], [data, stage, classId]);
  const stages = useMemo(() => [...new Set(data?.classes.filter((item) => item.status === 'active').map((item) => item.stage) || [])], [data]);
  const filteredClasses = data?.classes.filter((item) => item.status === 'active' && (!stage || item.stage === stage)) || [];
  const sheets = useMemo(() => data ? buildTimetablePrintSheets(data, {mode, grouping, stage, classId, placementKey, teacherId}) : [], [data, mode, grouping, stage, classId, placementKey, teacherId]);
  const teacherOptions = useMemo(() => data ? timetablePrintTeacherOptions(data) : [], [data]);
  const teacherConflictCount = data?.entries.filter((entry) => (
    entry.hard_conflicts.some((conflict) => conflict.code === 'teacher_collision')
  )).length || 0;
  const columnCount = Math.max(0, ...sheets.filter((sheet) => sheet.kind === 'master').map((sheet) => sheet.placements.length));
  const recommendedPageSize = masterPageRecommendation(columnCount);
  const printSize = pageSize;
  const canPrint = data != null && sheets.length > 0;

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
          <p className="font-semibold">توجد <bdi dir="ltr">{data.invalid_entry_count}</bdi> درس تحتاج إصلاح؛ ولن تظهر كخلايا صحيحة في الجدول.</p>
          <button type="button" onClick={onOpenRepair} className="mr-auto rounded-lg bg-red-700 px-3 py-2 text-sm font-bold text-white">العودة إلى شبكة التحرير للإصلاح</button>
        </div>
      )}
      {teacherConflictCount > 0 && (
        <div className="no-print flex items-center gap-3 rounded-xl border border-rose-300 bg-rose-100 p-4 text-rose-950" role="alert">
          <AlertTriangle size={20} />
          <p className="font-bold">تعارض المدرّس ظاهر في <bdi dir="ltr">{teacherConflictCount}</bdi> درس ملوّنة بالوردي المحمر.</p>
        </div>
      )}

      <div className="no-print space-y-4 rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="طريقة عرض الجدول">
          {([
            ['master', 'الجدول الكامل', LayoutGrid],
            ['placement', 'جدول صف / شعبة', GraduationCap],
            ['teacher', 'جدول مدرس', UserRound],
          ] as const).map(([key, label, Icon]) => (
            <button key={key} type="button" role="tab" aria-selected={mode === key} onClick={() => { setMode(key); setPageSize(key === 'master' ? 'A3' : 'A4'); }} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold ${mode === key ? 'border-primary-600 bg-primary-50 text-primary-800' : 'border-gray-200 text-gray-600'}`}>
              <Icon size={17} />{label}
            </button>
          ))}
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          {mode !== 'teacher' && <>
            <label className="text-sm font-semibold text-gray-700">المرحلة
              <select aria-label="مرحلة الطباعة" value={stage} onChange={(event) => { setStage(event.target.value); setClassId(null); setPlacementKey(''); }} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2">
                <option value="">جميع المراحل</option>{stages.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            <label className="text-sm font-semibold text-gray-700">الصف
              <select aria-label="صف الطباعة" value={classId ?? ''} onChange={(event) => { setClassId(event.target.value ? Number(event.target.value) : null); setPlacementKey(''); }} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2">
                <option value="">جميع الصفوف</option>{filteredClasses.map((item) => <option key={item.id} value={item.id}>{item.name} — {item.stage}</option>)}
              </select>
            </label>
          </>}
          {mode === 'master' && <label className="text-sm font-semibold text-gray-700">تقسيم الطباعة
            <select aria-label="تقسيم الطباعة" value={grouping} onChange={(event) => setGrouping(event.target.value as TimetablePrintGrouping)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2">
              <option value="combined">جدول واحد للنطاق المختار</option><option value="stage">كل مرحلة تبدأ بورقة مستقلة</option>
              <option value="class">كل صف يبدأ بورقة مستقلة</option><option value="placement">كل شعبة تبدأ بورقة مستقلة</option>
            </select>
          </label>}
          {mode === 'placement' && (
            <label className="text-sm font-semibold text-gray-700">الصف / الشعبة
              <select aria-label="شعبة الطباعة" value={placementKey} onChange={(event) => setPlacementKey(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2">
                <option value="">اختر الصف أو الشعبة</option>
                {placements.map((placement) => <option key={timetablePlacementKey(placement)} value={timetablePlacementKey(placement)}>{placementLabel(placement)}</option>)}
              </select>
            </label>
          )}
          {mode === 'teacher' && (
            <label className="text-sm font-semibold text-gray-700">المدرس
              <select aria-label="مدرس الطباعة" value={teacherId ?? ''} onChange={(event) => setTeacherId(teacherOptions.find((teacher) => String(teacher.id) === event.target.value)?.id ?? null)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2">
                <option value="">اختر مدرسًا</option>
                {teacherOptions.map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.full_name}</option>)}
              </select>
            </label>
          )}
            <label className="text-sm font-semibold text-gray-700">حجم الورق
              <select aria-label="حجم ورق الطباعة" value={pageSize} onChange={(event) => setPageSize(event.target.value as MasterPageSize)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2">
                <option value="A4">A4 — أفقي</option><option value="A3">A3 — أفقي</option><option value="A2">A2 — أفقي</option><option value="A1">A1 — أفقي</option>
              </select>
            </label>
          <label className="flex items-center gap-2 self-end rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700">
            <input type="checkbox" checked={fitOnePage} onChange={(event) => setFitOnePage(event.target.checked)} />تنسيق مضغوط للطباعة
          </label>
          <button type="button" disabled={!canPrint} onClick={printTimetable} className="flex items-center justify-center gap-2 self-end rounded-lg bg-primary-700 px-4 py-2.5 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">
            <Printer size={18} />طباعة / حفظ PDF
          </button>
        </div>
        {mode === 'master' && (
          <div className="space-y-1 text-sm">
            <p>مجموعات الطباعة: <bdi dir="ltr">{sheets.length}</bdi>. تبدأ كل مجموعة بورقة جديدة.</p>
            <p className={pageSize === recommendedPageSize ? 'text-emerald-700' : 'text-amber-700'}>
              يفضل استخدام <bdi dir="ltr">{recommendedPageSize}</bdi> لهذا الجدول (عدد الأعمدة: <bdi dir="ltr">{columnCount}</bdi>). استخدم المقاس الأكبر إذا أصبحت النصوص ضيقة.
            </p>
            {fitOnePage && <p className="text-gray-600">يقلل التنسيق المضغوط حجم الخلايا، وقد يوزّع المتصفح الجدول على أكثر من ورقة حسب المحتوى وإعدادات الطباعة.</p>}
          </div>
        )}
      </div>

      <style>{`@media print { @page { size: ${PAGE_DIMENSIONS[printSize]}; margin: ${mode === 'master' ? '7mm' : '9mm'}; } }`}</style>
      <div className={`timetable-print-root timetable-print-${mode} ${fitOnePage ? 'timetable-fit-one-page' : ''}`}>
        {sheets.map((sheet) => <section className={`timetable-print-sheet timetable-sheet-${sheet.kind}`} data-print-sheet={sheet.key} key={sheet.key}>
          <PrintHeader data={data} title={sheet.title} />
          {sheet.kind === 'master' ? <MasterGrid data={data} placements={sheet.placements} />
            : <WeeklyGrid data={data} placement={sheet.placements[0]} teacherId={sheet.teacherId} />}
          <SubjectLegend entries={timetablePrintSheetEntries(data.entries, sheet)} />
        </section>)}
        {sheets.length === 0 && <div className="timetable-empty"><BookOpen size={24} />{mode === 'teacher' ? 'اختر مدرسًا لعرض جدوله وطباعته.' : mode === 'placement' ? 'اختر صفًا أو شعبة لعرض جدولها وطباعته.' : 'لا توجد صفوف فعالة ضمن النطاق المختار.'}</div>}
      </div>
    </section>
  );
}
