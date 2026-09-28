import { useEffect, useRef, useState } from 'react';
import { getWeekSetup, previewWeekSetup, applyWeekSetup } from '../../lib/api';
import { TIMETABLE_DAY_NAMES, type TimetableSlot } from '../../lib/timetable';
import { generateWeekTemplate, minuteOfDay, periodValues, recalculateWeekTimes, summarizeWeekDay, WEEK_LEAVE_MESSAGE,
  type WeekMode, type WeekPlan, type WeekRequest, type WeekSnapshot } from '../../lib/weekSetup';
import { compilePeriods, draftPeriodValues, editablePeriods, WeekDraftFence, type DraftPeriod } from './weekDraft';
import { WeekPeriodEditor } from './WeekPeriodEditor';

const services = {load: getWeekSetup, preview: previewWeekSetup, apply: applyWeekSetup};
const inputClass = 'w-full min-w-0 rounded-lg border border-gray-300 bg-white px-3 py-2';
const buttonClass = 'rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-50';
const primaryClass = 'rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50';
const blankGenerator = () => ({start: '08:00', count: '6', minutes: '40', desired: '', breaks: [] as Array<{after: string; minutes: string; label: string}>});
function savedGenerator(periods: TimetableSlot[]) {
  const active = periods.filter(p => p.is_active === 1);
  const source = (active.length ? active : periods).sort((a, b) => a.slot_index - b.slot_index);
  if (!source.length) return blankGenerator();
  const lesson = source.find(p => p.slot_type === 'lesson');
  let lessons = 0;
  const breaks = source.flatMap(p => {
    if (p.slot_type === 'lesson') { lessons++; return []; }
    return lessons > 0 ? [{after: String(lessons), minutes: String(minuteOfDay(p.end_time) - minuteOfDay(p.start_time)), label: p.label}] : [];
  });
  return {start: source[0].start_time, count: String(lessons || 6), minutes: lesson ? String(minuteOfDay(lesson.end_time) - minuteOfDay(lesson.start_time)) : '40',
    desired: '', breaks: breaks.filter(b => Number(b.after) < lessons)};
}
const names = {create: 'إضافة', update: 'تحديث', unchanged: 'مطابقة دون تغيير', retained: 'محفوظة دون تعديل'};

interface Props {
  schoolId: number; academicYearId: number; dataVersion: number;
  onDirtyChange: (dirty: boolean) => void; onChanged: () => Promise<void> | void;
  onEditSlot: (day: number, slot?: TimetableSlot) => void;
  onDeleteSlot: (slot: TimetableSlot) => Promise<void> | void;
  onDayChange: (day: number, patch: {is_active?: 0 | 1; order_index?: number}) => Promise<void> | void;
  saving?: boolean; api?: typeof services;
}

export function WeekSetupTab({schoolId, academicYearId, dataVersion, onDirtyChange, onChanged, onEditSlot, onDeleteSlot, onDayChange, saving = false, api = services}: Props) {
  const [snapshot, setSnapshot] = useState<WeekSnapshot | null>(null);
  const [open, setOpen] = useState(false), [expanded, setExpanded] = useState<number | null>(null);
  const [generator, setGenerator] = useState(blankGenerator);
  const [rows, setRows] = useState<DraftPeriod[]>([]);
  const [source, setSource] = useState<number | null>(null), [draftRevision, setDraftRevision] = useState(0);
  const [profileDay, setProfileDay] = useState<number | null>(null);
  const [savedDay, setSavedDay] = useState(''), [loadedDay, setLoadedDay] = useState<number | null>(null);
  const [targets, setTargets] = useState<WeekRequest['targets']>([]);
  const [mode, setMode] = useState<WeekMode>('fill_empty_days');
  const [preview, setPreview] = useState<WeekPlan | null>(null), [previewInput, setPreviewInput] = useState<WeekRequest | null>(null);
  const [ack, setAck] = useState(false), [dirty, setDirty] = useState(false);
  const [replaceAck, setReplaceAck] = useState(false);
  const [busy, setBusy] = useState<'load' | 'preview' | 'apply' | null>(null);
  const [error, setError] = useState(''), [success, setSuccess] = useState('');
  const fence = useRef(new WeekDraftFence()).current;
  const currentScope = `${schoolId}:${academicYearId}`; fence.setScope(currentScope);
  const scopeLoaded = useRef(''), openRef = useRef(open), dirtyRef = useRef(dirty);
  openRef.current = open; dirtyRef.current = dirty;
  const dialog = useRef<HTMLDivElement>(null), opener = useRef<HTMLElement | null>(null);
  const reportDirty = useRef(onDirtyChange); reportDirty.current = onDirtyChange;

  function markDirty(value: boolean) { dirtyRef.current = value; setDirty(value); reportDirty.current(value); }
  function edit() { fence.invalidate(); markDirty(true); setPreview(null); setPreviewInput(null); setAck(false); setReplaceAck(false); setError(''); setSuccess(''); setBusy(null); }
  async function load() {
    const current = fence.capture(); setBusy('load'); setError('');
    try {
      const response = await api.load({school_id: schoolId, academic_year_id: academicYearId});
      if (!current()) return;
      setBusy(null);
      if (response.error || !response.data) { setError(response.error || 'تعذر تحميل الأسبوع.'); return; }
      setSnapshot(response.data);
    } catch { if (current()) { setBusy(null); setError('تعذر تحميل الأسبوع. حاول مجددًا.'); } }
  }
  useEffect(() => {
    // A data refresh must not silently rebase a copied, already edited source.
    if (scopeLoaded.current === currentScope && openRef.current) return;
    if (scopeLoaded.current !== currentScope) {
      scopeLoaded.current = currentScope; setSnapshot(null); setOpen(false); openRef.current = false;
      setExpanded(null); setProfileDay(null); setPreview(null); setRows([]); setSuccess(''); markDirty(false);
    }
    void load();
  }, [schoolId, academicYearId, dataVersion]);
  useEffect(() => () => { fence.invalidate(); reportDirty.current(false); }, [fence]);
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => { if (dirtyRef.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', leave); return () => window.removeEventListener('beforeunload', leave);
  }, []);
  useEffect(() => { if (open) dialog.current?.focus(); }, [open]);

  function allowLeave() { return !dirtyRef.current || window.confirm(WEEK_LEAVE_MESSAGE); }
  function close() {
    if (!allowLeave()) return;
    fence.invalidate(); markDirty(false); setOpen(false); openRef.current = false; setPreview(null); setPreviewInput(null); setBusy(null); setError('');
    opener.current?.focus();
  }
  function begin(day: number | null) {
    if (!snapshot || !allowLeave()) return;
    fence.invalidate(); opener.current = document.activeElement as HTMLElement;
    const periods = snapshot.periods.filter(p => p.day_of_week === day);
    setSource(day); setProfileDay(null); setDraftRevision(snapshot.revision); setTargets([]); setMode('fill_empty_days'); setGenerator(savedGenerator(periods));
    setRows(editablePeriods(periods.map(periodValues))); setLoadedDay(day);
    setSavedDay(String(snapshot.summary.find(d => !d.empty)?.day_of_week ?? ''));
    setPreview(null); setPreviewInput(null); setAck(false); setReplaceAck(false); setError(''); setSuccess(''); setBusy(null); setExpanded(null);
    markDirty(day !== null); setOpen(true); openRef.current = true;
  }
  function loadSavedDay(day: number, configureDay = false, preserveTargets = false) {
    if (!snapshot || !allowLeave()) return;
    fence.invalidate(); if (!openRef.current) opener.current = document.activeElement as HTMLElement;
    const periods = snapshot.periods.filter(p => p.day_of_week === day).sort((a, b) => a.slot_index - b.slot_index);
    setGenerator(savedGenerator(periods)); setSavedDay(String(day)); setLoadedDay(periods.length ? day : null);
    setSource(null); setProfileDay(configureDay ? day : null); setDraftRevision(snapshot.revision); setMode(configureDay ? 'configure_day' : 'update_matching_keep_extra');
    if (!preserveTargets) setTargets([{day_of_week: day, activate_day: false}]);
    setRows(editablePeriods(periods.map(periodValues)));
    setPreview(null); setPreviewInput(null); setAck(false); setReplaceAck(false); setError(''); setSuccess(''); setBusy(null); setExpanded(null);
    markDirty(false); setOpen(true); openRef.current = true;
  }
  function generate() {
    if (rows.length && !window.confirm('سيتم استبدال فترات المسودة وتعديلاتها بالتوليد الجديد. هل تريد المتابعة؟')) return;
    try {
      const generated = generateWeekTemplate({start_time: generator.start, lesson_count: Number(generator.count), lesson_minutes: Number(generator.minutes), desired_end_time: generator.desired,
        breaks: generator.breaks.filter(b => profileDay === null || Number(b.after) < Number(generator.count)).map(b => ({after_lesson: Number(b.after), minutes: Number(b.minutes), label: b.label}))});
      edit(); setRows(editablePeriods(generated));
    } catch (e) { setError(e instanceof Error ? e.message : 'تحقق من بيانات التوليد.'); }
  }
  async function requestPreview() {
    let input: WeekRequest;
    try { input = {school_id: schoolId, academic_year_id: academicYearId, expected_revision: draftRevision, mode, source_day_of_week: source, targets, template: compilePeriods(rows)}; }
    catch (e) { setError(e instanceof Error ? e.message : 'تحقق من الفترات.'); return; }
    const current = fence.capture(); setBusy('preview'); setError(''); setPreview(null); setPreviewInput(null); setAck(false); setReplaceAck(false);
    try {
      const response = await api.preview(input);
      if (!current()) return;
      setBusy(null);
      if (response.error || !response.data) { setError(response.error || 'تعذرت المعاينة.'); return; }
      setPreview(response.data); setPreviewInput(input);
    } catch { if (current()) { setBusy(null); setError('تعذرت المعاينة. حاول مجددًا.'); } }
  }
  async function confirm() {
    if (!preview?.can_apply || !previewInput || busy || (preview.requires_availability_acknowledgement && !ack) || ((preview.replacement?.old_periods ?? 0) > 0 && !replaceAck)) return;
    const current = fence.capture(); setBusy('apply'); setError('');
    try {
      const response = await api.apply({...previewInput, confirm_apply: true, preview_digest: preview.preview_digest, acknowledge_availability_impact: ack,
        ...((preview.replacement?.old_periods ?? 0) > 0 ? {confirm_replace: replaceAck} : {})});
      if (!current()) return;
      setBusy(null);
      if (response.error || !response.data) { setPreview(null); setPreviewInput(null); setError(response.error || 'تعذر الحفظ. أعد المعاينة.'); return; }
      const result = response.data;
      setSuccess(result.applied
        ? `تم الحفظ: إضافة ${result.counts.create}، تحديث ${result.counts.update}، تخطي ${result.counts.skipped} يوم، تفعيل ${result.counts.activated} يوم.`
        : `لا تغيير محفوظ: تخطي ${result.counts.skipped} يوم، ${result.counts.unchanged} فترة مطابقة.`);
      markDirty(false); setOpen(false); openRef.current = false; setRows([]); setPreview(null); setPreviewInput(null);
      opener.current?.focus();
      // The save has committed. A refresh failure must never be reported as a
      // failed save (or claim that nothing was written).
      void load();
      Promise.resolve(onChanged()).catch(() => { /* Parent owns refresh errors. */ });
    } catch { if (current()) { setBusy(null); setPreview(null); setPreviewInput(null); setError('تعذر تأكيد نتيجة الحفظ. أعد تحميل الأسبوع قبل أي محاولة أخرى.'); } }
  }
  function customize(day: number) {
    if (!allowLeave()) return;
    fence.invalidate(); markDirty(false); setOpen(false); openRef.current = false; setPreview(null); setBusy(null);
    setExpanded(expanded === day ? null : day);
  }
  let summary: ReturnType<typeof summarizeWeekDay> | null = null, difference: number | null = null;
  try { summary = summarizeWeekDay(0, compilePeriods(rows)); if (generator.desired && summary.last_end) difference = minuteOfDay(summary.last_end) - minuteOfDay(generator.desired); } catch { /* Errors are shown on generation/preview; unfinished fields remain local. */ }

  return <div className="min-w-0 space-y-4" dir="rtl">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-bold text-gray-900">أيام الأسبوع وفترات الجرس</h2><p className="text-sm text-gray-500">عدد دروس مستقل لكل يوم: يمكن جعل يوم أو يومين أو ثلاثة أيام 7 دروس، وباقي الأيام 6 أو أي عدد آخر.</p><p className="text-sm text-gray-500">للجدول المحفوظ استخدم «تعديل الدروس والاستراحات» لتعديل الأوقات والمدد وعدد الدروس مع تحميل مواضع الاستراحات الأصلية. للأيام الفارغة: ولّد الدروس وحدد الأيام المطلوبة.</p></div>
      <button className={primaryClass} disabled={!snapshot || busy === 'load'} onClick={() => begin(null)}>إعداد سريع للدروس والاستراحات</button></div>
    {success && <p role="status" className="rounded-lg border border-green-200 bg-green-50 p-3 text-green-800">{success}</p>}
    {!open && error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">{error}</p>}
    {busy === 'load' && <p role="status">جاري تحميل الأسبوع…</p>}
    <button className={buttonClass} disabled={busy === 'load'} onClick={() => { if (!allowLeave()) return; fence.invalidate(); setOpen(false); openRef.current = false; markDirty(false); setPreview(null); void load(); }}>إعادة تحميل الأسبوع</button>
    <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {snapshot?.summary.map(day => <section key={day.day_of_week} aria-label={`ملخص ${TIMETABLE_DAY_NAMES[day.day_of_week]}`} className={`min-w-0 rounded-xl border bg-white p-4 ${day.is_active ? 'border-primary-200' : 'border-gray-200'}`}>
        <div className="flex items-center justify-between gap-2"><h3 className="font-bold">{TIMETABLE_DAY_NAMES[day.day_of_week]}</h3><span className={`rounded px-2 py-1 text-xs ${day.is_active ? 'bg-green-50 text-green-800' : 'bg-gray-100 text-gray-600'}`}>{day.is_active ? 'يوم نشط' : 'يوم غير نشط'}</span></div>
        <p className="mt-2 text-sm">دروس نشطة: {day.lessons} · استراحات نشطة: {day.breaks}</p>
        {day.inactive > 0 && <p className="text-sm text-amber-800">فترات محفوظة غير نشطة: {day.inactive}</p>}
        <p className="my-2 text-xs text-gray-600">{day.empty ? 'فارغ — لا توجد فترات محفوظة' : `غير فارغ — ${day.saved_periods} فترة محفوظة`}</p>
        <p className="text-xs">أول بداية محفوظة: <bdi dir="ltr">{day.first_start || '—'}</bdi> · آخر نهاية محفوظة: <bdi dir="ltr">{day.last_end || '—'}</bdi></p>
        <div className="mt-3 flex flex-wrap gap-2"><button className={primaryClass} disabled={busy === 'load'} onClick={() => loadSavedDay(day.day_of_week, true)}>تعديل الدروس والاستراحات</button><button className={buttonClass} disabled={day.empty || busy === 'load'} onClick={() => begin(day.day_of_week)}>نسخ فترات هذا اليوم إلى…</button><button className={buttonClass} aria-expanded={expanded === day.day_of_week} onClick={() => customize(day.day_of_week)}>تخصيص اليوم</button></div>
        {expanded === day.day_of_week && <div className="mt-3 space-y-3 border-t pt-3">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={day.is_active} disabled={saving} onChange={e => void onDayChange(day.day_of_week, {is_active: e.target.checked ? 1 : 0})}/>تفعيل {TIMETABLE_DAY_NAMES[day.day_of_week]}</label>
          <label className="flex items-center gap-2 text-sm">ترتيب اليوم<input aria-label={`ترتيب ${TIMETABLE_DAY_NAMES[day.day_of_week]}`} className="w-20 rounded border p-2" type="number" min="0" disabled={saving} value={day.order_index} onChange={e => void onDayChange(day.day_of_week, {order_index: Number(e.target.value)})}/></label>
          {day.is_active && <button className={buttonClass} onClick={() => onEditSlot(day.day_of_week)}>إضافة فترة</button>}
          {snapshot.periods.filter(p => p.day_of_week === day.day_of_week).map(slot => <div key={slot.id} className="rounded border p-2 text-sm"><p>{slot.slot_index}. {slot.label} {slot.is_active === 0 && ' — غير نشطة'}</p><bdi dir="ltr">{slot.start_time} – {slot.end_time}</bdi><div className="mt-1 flex gap-2"><button className={buttonClass} onClick={() => onEditSlot(day.day_of_week, slot)}>تعديل الفترة</button><button className={buttonClass} onClick={() => void onDeleteSlot(slot)}>حذف الفترة</button></div></div>)}
        </div>}
      </section>)}
    </div>

    {open && snapshot && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-2 sm:p-4">
      <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="week-editor-title" className="max-h-[94dvh] w-full min-w-0 max-w-6xl overflow-y-auto rounded-xl bg-white p-3 shadow-xl outline-none sm:p-6" onKeyDown={e => {
        if (e.key === 'Escape') { e.preventDefault(); close(); }
        if (e.key === 'Tab') {
          const items = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]') || []);
          const first = items[0], last = items[items.length - 1];
          if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last?.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
        }
      }}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h2 id="week-editor-title" className="text-lg font-bold">{profileDay !== null ? `تعديل دروس واستراحات ${TIMETABLE_DAY_NAMES[profileDay]}` : source === null ? 'إعداد سريع للدروس والاستراحات' : `نسخ فترات ${TIMETABLE_DAY_NAMES[source]} إلى أيام محددة`}</h2><button className={buttonClass} onClick={close}>إغلاق المسودة</button></div>
        <p className="mb-4 text-sm text-gray-600">مسودة محلية فقط — لا تُحفظ الفترات إلا بعد المعاينة وتأكيد الحفظ. الأوقات بصيغة 24 ساعة.</p>
        {profileDay !== null && <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">هذا التعديل يخص يوم {TIMETABLE_DAY_NAMES[profileDay]} فقط. أدخل عدد الدروس والبداية والمدة ثم ولّد الفترات. {mode === 'replace_selected_days' ? 'سيُؤرشف جدول هذا اليوم ويُستبدل وفق المعاينة، بما في ذلك الدروس التي تُحذف عند تقليل العدد.' : 'عند التقليل ستظهر الفترات الزائدة كغير نشطة في المعاينة مع الاحتفاظ بسجلاتها. إذا كانت الفترات المحذوفة مشغولة أو مثبتة، اختر استبدال الجدول وأرشفة القديم.'} الاستراحات الواقعة بعد آخر درس تُستبعد من اليوم النشط.</p>}
        {error && <p role="alert" className="mb-3 rounded bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        <fieldset disabled={busy === 'apply'} className="min-w-0 space-y-5 disabled:opacity-60">
          {profileDay === null && snapshot.summary.some(d => !d.empty) && <section className="space-y-2 rounded-lg border border-blue-200 bg-blue-50 p-3">
            <label className="block text-sm font-bold">تحميل يوم محفوظ للتعديل<select aria-label="اليوم المحفوظ للتعديل" className={inputClass} value={savedDay} onChange={e => setSavedDay(e.target.value)}>{snapshot.summary.filter(d => !d.empty).map(d => <option key={d.day_of_week} value={d.day_of_week}>{TIMETABLE_DAY_NAMES[d.day_of_week]}</option>)}</select></label>
            <p className="text-sm text-blue-900">يحمّل أوقات اليوم ومواضع استراحاته الأصلية بدل المسودة. يمكنك بعدها تعديل المدد وتحديد أيام إضافية للتطبيق.</p>
            <button className={buttonClass} disabled={savedDay === ''} onClick={() => loadSavedDay(Number(savedDay))}>تحميل اليوم المحفوظ بدل المسودة</button>
          </section>}
          {loadedDay !== null && <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">تم تحميل إعدادات {TIMETABLE_DAY_NAMES[loadedDay]} المحفوظة مع مواضع الاستراحات الأصلية. لمعاينة اليوم كما هو اضغط «معاينة التغييرات». بعد تعديل مدة الدرس أو الاستراحة اضغط «توليد الفترات» لتحديث المسودة.</p>}
          <section className="space-y-3 rounded-xl bg-gray-50 p-3">
            <div className="grid min-w-0 grid-cols-2 gap-3 md:grid-cols-4">
              <label className="text-sm">بداية الدوام<input aria-label="بداية الدوام" type="time" dir="ltr" className={inputClass} value={generator.start} onChange={e => { edit(); setGenerator({...generator, start: e.target.value}); }}/></label>
              <label className="text-sm">عدد الدروس<input aria-label="عدد الدروس" type="number" min="1" max="30" className={inputClass} value={generator.count} onChange={e => { edit(); setGenerator({...generator, count: e.target.value}); }}/></label>
              <label className="text-sm">المدة الافتراضية (دقيقة)<input aria-label="المدة الافتراضية للدرس" type="number" min="1" className={inputClass} value={generator.minutes} onChange={e => { edit(); setGenerator({...generator, minutes: e.target.value}); }}/></label>
              <label className="text-sm">نهاية مرغوبة (اختياري)<input aria-label="النهاية المرغوبة" type="time" dir="ltr" className={inputClass} value={generator.desired} onChange={e => { edit(); setGenerator({...generator, desired: e.target.value}); }}/></label>
            </div>
            {generator.breaks.map((rule, i) => <div key={i} className="grid min-w-0 grid-cols-2 items-end gap-2 sm:grid-cols-4">
              <label className="text-xs">بعد الدرس<input aria-label={`موضع الاستراحة ${i + 1}`} type="number" min="1" className={inputClass} value={rule.after} onChange={e => { edit(); setGenerator({...generator, breaks: generator.breaks.map((b, j) => j === i ? {...b, after: e.target.value} : b)}); }}/></label>
              <label className="text-xs">مدة الاستراحة<input aria-label={`مدة الاستراحة ${i + 1}`} type="number" min="1" className={inputClass} value={rule.minutes} onChange={e => { edit(); setGenerator({...generator, breaks: generator.breaks.map((b, j) => j === i ? {...b, minutes: e.target.value} : b)}); }}/></label>
              <label className="text-xs">اسم اختياري<input aria-label={`اسم الاستراحة ${i + 1}`} className={inputClass} value={rule.label} onChange={e => { edit(); setGenerator({...generator, breaks: generator.breaks.map((b, j) => j === i ? {...b, label: e.target.value} : b)}); }}/></label>
              <button className={buttonClass} onClick={() => { edit(); setGenerator({...generator, breaks: generator.breaks.filter((_, j) => j !== i)}); }}>إزالة قاعدة الاستراحة {i + 1}</button>
            </div>)}
            <div className="flex flex-wrap gap-2"><button className={buttonClass} onClick={() => { edit(); setGenerator({...generator, breaks: [...generator.breaks, {after: '', minutes: '', label: ''}]}); }}>إضافة قاعدة استراحة</button>
              <button className={buttonClass} onClick={() => { if ((dirtyRef.current || loadedDay !== null) && !window.confirm('سيستبدل المثال إعدادات التوليد الحالية ويضع الاستراحتين بعد الدرسين 2 و4. هل تريد المتابعة؟')) return; edit(); setLoadedDay(null); setGenerator({start: '13:00', count: '7', minutes: '35', desired: '', breaks: [{after: '2', minutes: '15', label: ''}, {after: '4', minutes: '10', label: ''}]}); }}>تحميل مثال فقط: 7 دروس و2 استراحة</button>
              <button className={primaryClass} onClick={generate}>توليد الفترات</button></div>
            <p className="text-xs text-gray-600">المثال للتجربة ويضع الاستراحات بعد الدرسين 2 و4؛ لتعديل جدول المدرسة ابدأ بتحميل يوم محفوظ.</p>
          </section>
          <WeekPeriodEditor rows={rows} onChange={next => { edit(); setRows(next); }}/>
          {rows.length > 0 && <button className={buttonClass} onClick={() => {
            try { const next = recalculateWeekTimes(draftPeriodValues(rows), generator.start); edit(); setRows(editablePeriods(next)); }
            catch (e) { setError(e instanceof Error ? e.message : 'صحح الفترات.'); }
          }}>إعادة حساب الأوقات التالية من بداية الدوام (إزالة الفجوات)</button>}
          {summary && <p role="status" className="rounded bg-blue-50 p-3 text-sm text-blue-900">دقائق الدروس: {summary.teaching_minutes} · الاستراحات: {summary.break_minutes} · المدة الكلية: {summary.elapsed_minutes} · النهاية المحسوبة: <bdi dir="ltr">{summary.last_end}</bdi>{difference !== null && ` · الفرق عن النهاية المرغوبة: ${difference} دقيقة (دون تغيير المدد)`}</p>}
          <label className="block text-sm font-bold">طريقة التطبيق<select aria-label="طريقة التطبيق" className={inputClass} value={mode} onChange={e => { edit(); setMode(e.target.value as WeekMode); }}>{profileDay === null ? <><option value="fill_empty_days">تعبئة الأيام الفارغة فقط</option><option value="update_matching_keep_extra">تحديث الفترات المتطابقة مع إبقاء الباقي</option></> : <option value="configure_day">تعديل هذا اليوم مع إبقاء الفترات غير النشطة</option>}<option value="replace_selected_days">استبدال جدول الأيام المحددة وأرشفة القديم</option></select></label>
          {mode === 'replace_selected_days' && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">سيُحفظ جدول الأيام المحددة السابق في الأرشيف، ثم تُطبق الدروس والاستراحات الموجودة في المسودة. تنتقل المواد والمدرسون والتثبيت وإعدادات التوفر حسب رقم الدرس داخل اليوم نفسه. إذا حُذف رقم درس، تبقى بياناته في الأرشيف وتُزال من الجدول الحالي. راجع الأثر في المعاينة قبل التأكيد.</p>}
          <section aria-label="الأيام المستهدفة" className="space-y-3"><h3 className="font-bold">{profileDay !== null ? 'اليوم المحدد للتعديل' : 'اختر الأيام المستهدفة فقط'}</h3>{profileDay === null && <div className="flex flex-wrap gap-2"><button className={buttonClass} onClick={() => { edit(); setTargets(snapshot.summary.filter(d => d.is_active && d.day_of_week !== source).map(d => ({day_of_week: d.day_of_week, activate_day: false}))); }}>تحديد أيام الدوام</button><button className={buttonClass} onClick={() => { edit(); setTargets([]); }}>إلغاء التحديد</button></div>}
            <div className="grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-4">{snapshot.summary.map(day => {
              const chosen = targets.find(t => t.day_of_week === day.day_of_week), isSource = day.day_of_week === source;
              return <div key={day.day_of_week} className={`rounded-lg border p-3 ${chosen ? 'border-primary-400 bg-primary-50' : 'border-gray-200'}`}><label className="flex min-h-12 cursor-pointer items-start gap-2"><input aria-label={`استهداف ${TIMETABLE_DAY_NAMES[day.day_of_week]}`} type="checkbox" disabled={isSource || profileDay !== null} checked={!!chosen} onChange={e => { edit(); setTargets(e.target.checked ? [...targets, {day_of_week: day.day_of_week, activate_day: false}] : targets.filter(t => t.day_of_week !== day.day_of_week)); }}/><span className="text-sm"><strong>{TIMETABLE_DAY_NAMES[day.day_of_week]}{isSource && ' (المصدر)'}</strong><span className="block text-xs">{day.is_active ? 'نشط' : 'غير نشط'} · {day.saved_periods} فترة محفوظة · {day.empty ? 'فارغ' : 'غير فارغ'}</span></span></label>
                {chosen && !day.is_active && <label className="mt-2 flex items-start gap-2 text-sm text-amber-900"><input aria-label={`تفعيل ${TIMETABLE_DAY_NAMES[day.day_of_week]} ضمن الحفظ`} type="checkbox" checked={chosen.activate_day} onChange={e => { edit(); setTargets(targets.map(t => t.day_of_week === day.day_of_week ? {...t, activate_day: e.target.checked} : t)); }}/>تفعيل هذا اليوم ضمن الحفظ</label>}</div>;
            })}</div>
          </section>
          <button className={primaryClass} disabled={!rows.length || !targets.length || busy === 'preview'} onClick={() => void requestPreview()}>{busy === 'preview' ? 'جاري المعاينة…' : 'معاينة التغييرات'}</button>
          {preview && <section aria-label="خطة إعداد الأسبوع" className="space-y-3 rounded-xl border border-blue-200 p-3">
            <h3 className="font-bold">النتيجة الكاملة بعد التطبيق</h3><p className="text-sm">إضافة {preview.counts.create} · تحديث {preview.counts.update} · مطابقة {preview.counts.unchanged} · إبقاء {preview.counts.retained} · أيام متخطاة {preview.counts.skipped} · أيام محجوبة {preview.counts.blocked} · تفعيل أيام {preview.counts.activated}</p>
            {preview.replacement && <div aria-label="أثر استبدال الجدول" className="space-y-1 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              <p>الفترات القديمة المؤرشفة: {preview.replacement.old_periods} · الفترات الجديدة: {preview.counts.create}</p>
              <p>الدروس المجدولة المؤرشفة: {preview.replacement.archived_entries} · المنقولة للجدول الجديد: {preview.replacement.carried_entries} · المُزالة من الجدول الحالي: {preview.replacement.removed_entries} · الدروس المثبتة المتأثرة: {preview.replacement.locked_entries}</p>
              <p>إعدادات التوفر المؤرشفة: {preview.replacement.archived_availability} · المنقولة: {preview.replacement.carried_availability} · المُزالة من الجدول الحالي: {preview.replacement.removed_availability}</p>
            </div>}
            {[...preview.blockers, ...preview.warnings].map((notice, i) => <p key={i} className={`text-sm ${i < preview.blockers.length ? 'text-red-800' : 'text-amber-800'}`}>{notice.message}</p>)}
            {preview.days.map(day => <section key={day.day_of_week} className="min-w-0 rounded border p-3"><h4 className="font-bold">{TIMETABLE_DAY_NAMES[day.day_of_week]} — {day.action === 'skipped_existing' ? 'متخطى؛ لن يتغير' : day.action === 'blocked' ? 'محجوب' : 'قابل للتطبيق'}</h4>
              <p className="text-sm">تفعيل اليوم: {day.activate_day ? 'نعم، ضمن الحفظ' : 'لا تغيير'}</p>
              <p className="text-xs">قبل: عدد الدروس {day.before.lessons} / عدد الاستراحات {day.before.breaks}، <bdi dir="ltr">{day.before.active_first_start || '—'}–{day.before.active_last_end || '—'}</bdi> · بعد: عدد الدروس {day.after.lessons} / عدد الاستراحات {day.after.breaks}، <bdi dir="ltr">{day.after.active_first_start || '—'}–{day.after.active_last_end || '—'}</bdi></p>
              <p className="text-xs">دقائق الدروس النشطة بعد الحفظ: {day.after.active_teaching_minutes} · الاستراحات النشطة: {day.after.active_break_minutes}</p>
              <p className="my-2 text-xs">مراجع الفترات المتأثرة: دروس مجدولة {day.impact.scheduled_entries} · مثبتة {day.impact.locked_entries} · إعدادات توفر {day.impact.availability_overrides} · مراجع تاريخية {day.impact.historical_references}</p>
              {[...day.blockers, ...day.warnings].map((n, i) => <p key={i} className="mb-1 text-sm text-amber-900">{n.message}</p>)}
              {day.blockers.some(n => n.code === 'incompatible_period_identity' || n.code === 'slot_has_scheduled_entries') && <div className="my-2 flex flex-wrap gap-2">
                <button className={primaryClass} onClick={() => { edit(); setMode('replace_selected_days'); }}>استبدال جدول الأيام المحددة وأرشفة القديم</button>
                <button className={buttonClass} onClick={() => loadSavedDay(day.day_of_week, profileDay !== null, true)}>تحميل إعدادات {TIMETABLE_DAY_NAMES[day.day_of_week]} المحفوظة بدل المسودة</button>
              </div>}
              <ul className="grid gap-1 sm:grid-cols-2">{[...day.changes].sort((a, b) => a.after.slot_index - b.after.slot_index).map(change => <li key={change.after.slot_index} className="min-w-0 break-words rounded bg-gray-50 p-2 text-xs">{change.after.slot_index}. {change.after.label} · {change.after.slot_type === 'lesson' ? `درس ${change.after.lesson_number}` : 'استراحة'} · <bdi dir="ltr">{change.after.start_time}–{change.after.end_time}</bdi> · {change.after.is_active ? 'نشطة' : 'غير نشطة'} · {names[change.action]}</li>)}</ul>
            </section>)}
            {preview.requires_availability_acknowledgement && <label className="flex items-start gap-2 rounded bg-amber-50 p-3 text-sm"><input aria-label="الإقرار بأثر تغيير أوقات التوفر" type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)}/>أقر بأن إعدادات توفر المدرسين تبقى مرتبطة بمعرفات الفترات نفسها بعد تغيير الوقت. هذا الإقرار لا يتجاوز أي قيد إلزامي.</label>}
            {(preview.replacement?.old_periods ?? 0) > 0 && <label className="flex items-start gap-2 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"><input aria-label="تأكيد استبدال الجدول وأرشفة القديم" type="checkbox" checked={replaceAck} onChange={e => setReplaceAck(e.target.checked)}/>أوافق على أرشفة جدول الأيام المحددة واستبداله، ونقل الدروس وإعدادات التوفر حسب رقم الدرس، وإزالة بيانات أرقام الدروس المحذوفة من الجدول الحالي وفق المعاينة.</label>}
            <button className={primaryClass} disabled={!preview.can_apply || busy !== null || (preview.requires_availability_acknowledgement && !ack) || ((preview.replacement?.old_periods ?? 0) > 0 && !replaceAck)} onClick={() => void confirm()}>تأكيد الحفظ</button>
            {busy === 'apply' && <p role="status">جاري تأكيد الحفظ…</p>}
          </section>}
        </fieldset>
      </div>
    </div>}
  </div>;
}
