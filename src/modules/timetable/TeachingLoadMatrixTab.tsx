import { useEffect, useMemo, useRef, useState } from 'react';
import { getTeachingLoadMatrix, previewTeachingLoadMatrix, applyTeachingLoadMatrix, previewTeachingLoadCopy } from '../../lib/api';
import {
  type MatrixClass, type MatrixSection, type MatrixSubject, type TeachingLoadMatrixData,
  type MatrixPlan, type MatrixCopyPlan, type MatrixCopyMode, type MatrixDraft,
  matrixClassCards, matrixCells, matrixKey, matrixDraftChanges, applyMatrixRow,
  createMatrixRequestGuard, parseMatrixRequest, MATRIX_LEAVE_MESSAGE, MAX_MATRIX_WEEKLY_PERIODS,
} from '../../lib/teachingLoadMatrix';
import type { AcademicYearRecord } from '../../lib/academicYears';
import type { TimetableTeachingLoad } from '../../lib/timetable';

const field = 'w-full rounded border border-gray-300 bg-white p-2 text-sm';
const button = 'rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm disabled:opacity-40';
const actionLabels = { create: 'إنشاء', update: 'تحديث', deactivate: 'تعطيل', unchanged: 'بلا تغيير', blocked: 'تعارض' };
const withoutTeacher = 'بدون مدرس — يحدد لاحقًا';

export function MatrixPlanSummary({ plan }: { plan: MatrixPlan }) {
  return <div className="space-y-3 text-sm">
    <p>سيتم إنشاء: {plan.counts.create} · تحديث: {plan.counts.update} · تعطيل: {plan.counts.deactivate} · بلا تغيير: {plan.counts.unchanged} · تعارضات: {plan.counts.blocked}</p>
    <p>بدون مدرس بعد الحفظ: {plan.without_teacher_after} · إجمالي الحصص: {plan.total_weekly_periods_before} ← {plan.total_weekly_periods_after}</p>
    <div className="max-h-80 overflow-auto">
      {plan.items.map(item => <div key={matrixKey(item.subject_id, item.section_id)} className="border-t py-2">
        <b>{item.subject_name ?? 'مادة غير متاحة'} / {item.section_name ?? 'الصف بالكامل'}: {actionLabels[item.action]}</b>
        <p>الحصص: {item.old_weekly_periods ?? '—'} ← {item.new_weekly_periods ?? '—'}؛ المدرس: {item.old_employee_name ?? 'بدون مدرس'} ← {item.new_employee_name ?? 'بدون مدرس'}</p>
        {item.locked_entry_count > 0 && <p>حصص مقفلة مرتبطة: {item.locked_entry_count} — تبقى مواقعها وأقفالها كما هي.</p>}
        {item.warnings.map(n => <p key={n.code} className="text-amber-800">{n.message}</p>)}
        {item.blockers.map(n => <p key={n.code} className="text-red-700">{n.message}</p>)}
      </div>)}
    </div>
  </div>;
}

interface Props {
  schoolId: number; academicYearId: number; years: AcademicYearRecord[];
  classes: MatrixClass[]; sections: MatrixSection[]; subjects: MatrixSubject[]; loads: TimetableTeachingLoad[];
  dataVersion: number; onChanged: () => Promise<void>; onDirtyChange: (dirty: boolean) => void;
  onAdvanced: (load?: TimetableTeachingLoad) => void;
}

export function TeachingLoadMatrixTab(props: Props) {
  const { schoolId, academicYearId } = props;
  const [classId, setClassId] = useState<number | null>(null);
  const [data, setData] = useState<TeachingLoadMatrixData | null>(null);
  const [draft, setDraft] = useState<MatrixDraft>({});
  const [rowInputs, setRowInputs] = useState<MatrixDraft>({});
  const [preview, setPreview] = useState<MatrixPlan | null>(null);
  const [copy, setCopy] = useState<MatrixCopyPlan | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [sourceYearId, setSourceYearId] = useState('');
  const [copyMode, setCopyMode] = useState<MatrixCopyMode>('periods_only');
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [reload, setReload] = useState(0);
  const guard = useRef(createMatrixRequestGuard()).current;
  const changes = useMemo(() => data ? matrixDraftChanges(data, draft) : [], [data, draft]);
  // Incomplete edits (e.g. a teacher on a missing cell with no periods) must
  // still prompt on navigation, even though they cannot create a load.
  const dirty = changes.length > 0 || Object.values(draft).some(e => e.periods?.trim() || e.employeeId !== undefined || e.deactivate);
  const dirtyRef = useRef(false); dirtyRef.current = dirty;
  const callbackRef = useRef(props.onDirtyChange); callbackRef.current = props.onDirtyChange;
  useEffect(() => { callbackRef.current(dirty); }, [dirty]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => { window.removeEventListener('beforeunload', beforeUnload); guard.invalidate(); callbackRef.current(false); };
  }, [guard]);

  useEffect(() => {
    guard.invalidate();
    setData(null); setDraft({}); setRowInputs({}); setPreview(null); setCopy(null); setCopyOpen(false);
    setSourceYearId(''); setFilter('all'); setSearch(''); setError(''); setBusy(false);
    if (classId == null) return;
    const current = guard.capture();
    setBusy(true);
    void getTeachingLoadMatrix({ school_id: schoolId, academic_year_id: academicYearId, class_id: classId }).then(response => {
      if (!current()) return;
      setBusy(false);
      if (!response.data || response.error) setError(response.error ?? 'تعذر تحميل المصفوفة.');
      else setData(response.data);
    });
    return () => guard.invalidate();
  }, [schoolId, academicYearId, classId, reload, props.dataVersion, guard]);

  function allowLeave() { return !dirtyRef.current || window.confirm(MATRIX_LEAVE_MESSAGE); }
  function changeDraft(next: MatrixDraft) {
    guard.invalidate(); setBusy(false); setDraft(next); setPreview(null); setCopy(null); setError(''); setSuccess('');
  }
  function reset() {
    if (!allowLeave()) return;
    changeDraft({}); setRowInputs({});
  }
  function body() {
    return { school_id: schoolId, academic_year_id: academicYearId, class_id: classId!,
      expected_revision: data!.timetable_revision, changes };
  }
  async function showPreview() {
    if (!data || busy) return;
    const input = body(); const valid = parseMatrixRequest(input);
    if (!valid.ok) { setError(valid.error); return; }
    guard.invalidate(); const current = guard.capture(); setBusy(true); setError(''); setPreview(null);
    const response = await previewTeachingLoadMatrix(input);
    if (!current()) return;
    setBusy(false);
    if (response.error || !response.data) { setError(response.error ?? 'تعذر عرض المعاينة.'); return; }
    setPreview(response.data);
  }
  async function save() {
    if (!data || !preview?.can_apply || busy) return;
    guard.invalidate(); const current = guard.capture(); setBusy(true); setError('');
    const response = await applyTeachingLoadMatrix({ ...body(), expected_revision: preview.revision, confirm_apply: true });
    if (!current()) return;
    setBusy(false); setPreview(null);
    if (response.error || !response.data?.applied) { setError(response.error ?? 'تعذر حفظ المصفوفة.'); return; }
    const result = response.data;
    setDraft({}); setRowInputs({}); setCopy(null); dirtyRef.current = false; callbackRef.current(false);
    setSuccess(`تم حفظ مصفوفة النصاب بنجاح. تم إنشاء: ${result.counts.create} · تم تحديث: ${result.counts.update} · تم تعطيل: ${result.counts.deactivate} · بلا تغيير: ${result.counts.unchanged} · بدون مدرس: ${result.without_teacher_after}`);
    setReload(v => v + 1);
    await props.onChanged();
  }
  async function copyPreview() {
    if (!classId || !sourceYearId || busy) return;
    guard.invalidate(); const current = guard.capture(); setBusy(true); setError(''); setCopy(null);
    const response = await previewTeachingLoadCopy({ school_id: schoolId, target_academic_year_id: academicYearId,
      source_academic_year_id: Number(sourceYearId), class_id: classId, copy_mode: copyMode });
    if (!current()) return;
    setBusy(false);
    if (response.error || !response.data) { setError(response.error ?? 'تعذر معاينة النسخ.'); return; }
    setCopy(response.data);
  }
  function acceptCopy() {
    if (!copy || !data) return;
    const next: MatrixDraft = { ...draft };
    for (const c of copy.changes) if (c.action === 'upsert')
      next[matrixKey(c.subject_id, c.section_id)] = { periods: String(c.weekly_periods), employeeId: c.employee_id };
    changeDraft(next); setCopyOpen(false);
  }
  const cards = matrixClassCards(props.classes.filter(c => c.school_id === schoolId),
    props.sections.filter(s => s.school_id === schoolId), props.subjects.filter(s => s.school_id === schoolId),
    props.loads.filter(l => l.school_id === schoolId && l.academic_year_id === academicYearId));
  const edits = new Map(changes.map(c => [matrixKey(c.subject_id, c.section_id), c]));
  const columns = data?.sections.length ? data.sections.map(s => ({ id: s.id as number | null, name: s.name })) : [{ id: null, name: 'الصف بالكامل' }];
  const allowed = new Set(data ? matrixCells(data.class.id, data.sections, data.subjects).map(c => matrixKey(c.subject_id, c.section_id)) : []);
  const loadMap = new Map(data?.loads.map(l => [matrixKey(l.subject_id, l.section_id), l]));
  const dirtyRows = new Set(changes.map(c => c.subject_id));
  const rows = data?.subjects.filter(subject => {
    if (!subject.name.includes(search.trim())) return false;
    const cells = columns.filter(s => allowed.has(matrixKey(subject.id, s.id)));
    if (filter === 'changed') return dirtyRows.has(subject.id);
    if (filter === 'missing') return cells.some(s => !loadMap.has(matrixKey(subject.id, s.id)));
    if (filter === 'no-teacher') return cells.some(s => { const l = loadMap.get(matrixKey(subject.id, s.id)); return l && l.employee_id == null; });
    return true;
  });
  function teacherOptions() {
    return <><option value="">{withoutTeacher}</option>{data?.teachers.map(t => <option key={t.id} value={t.id}>{t.full_name}</option>)}</>;
  }

  return <section className="min-w-0 space-y-4" aria-label="مصفوفة نصاب المواد والمدرسين" dir="rtl">
    {error && <div role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-red-800">{error}<button className={button} disabled={busy} onClick={() => { if (allowLeave()) setReload(v => v + 1); }}>إعادة تحميل</button></div>}
    {success && <p role="status" className="rounded bg-emerald-50 p-3 text-emerald-800">{success}</p>}
    {classId == null ? <>
      <div className="flex justify-between"><h2 className="text-lg font-bold">نصاب المواد والمدرسين — الصفوف</h2><button className={button} onClick={() => props.onAdvanced()}>تعديل متقدم</button></div>
      {!cards.length && <p>لا توجد صفوف نشطة.</p>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{cards.map(c => <article key={c.id} className="space-y-2 rounded-xl border bg-white p-5">
        <h3 className="text-lg font-bold">{c.name}</h3>
        <p>{c.summary.section_count ? `${c.summary.section_count} شعب` : 'لا توجد شعب — الصف بالكامل'} · {c.summary.subject_count} مواد</p>
        <p>{c.summary.configured} من {c.summary.expected} نصابًا · {c.summary.missing} ناقص · {c.summary.without_teacher} بدون مدرس</p>
        <p>إجمالي الحصص: {c.summary.weekly_periods} · الاكتمال: {c.summary.completion_percent}%</p>
        <p className="text-sm text-gray-600">{!c.summary.subject_count ? 'لا توجد مواد' : c.summary.missing ? 'أنصبة غير مكتملة' : c.summary.without_teacher ? 'يحتاج تحديد مدرسين' : 'مكتمل'}</p>
        <button className={button} onClick={() => { guard.invalidate(); setData(null); setClassId(c.id); setSuccess(''); }}>فتح مصفوفة النصاب — {c.name}</button>
      </article>)}</div>
    </> : <>
      <button className={button} disabled={busy} onClick={() => { if (allowLeave()) { guard.invalidate(); setClassId(null); } }}>العودة إلى الصفوف</button>
      {busy && <p role="status">جاري المعالجة...</p>}
      {data && <>
        <h2 className="text-xl font-bold">مصفوفة نصاب {data.class.name}</h2>
        <p className="text-sm">القيم المحفوظة: {data.summary.configured}/{data.summary.expected} نصاب · ناقص: {data.summary.missing} · بدون مدرس: {data.summary.without_teacher} · مجموع الحصص: {data.summary.weekly_periods} · الاكتمال: {data.summary.completion_percent}%</p>
        <p className="text-xs text-gray-500">الاكتمال = الأنصبة التي لها مدرس ÷ الخلايا القابلة للتطبيق. ترك الحصص فارغة لا يغير النصاب ولا يعطله.</p>
        <div className="flex flex-wrap gap-2">
          <input className={field + ' md:!w-64'} aria-label="البحث باسم المادة" placeholder="البحث باسم المادة" value={search} onChange={e => setSearch(e.target.value)} />
          <select className={field + ' md:!w-60'} aria-label="تصفية المصفوفة" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">إظهار جميع المواد</option><option value="missing">إظهار الأنصبة الناقصة فقط</option><option value="no-teacher">إظهار بدون مدرس فقط</option><option value="changed">إظهار التغييرات فقط</option></select>
          <button className={button} disabled={busy} onClick={() => { guard.invalidate(); setCopy(null); setCopyOpen(true); }}>نسخ النصاب من سنة سابقة</button>
          <button className={button} disabled={busy || !dirty} onClick={reset}>إلغاء جميع التغييرات غير المحفوظة</button>
          <button className={button + ' !bg-primary-600 text-white'} disabled={busy || changes.length === 0} onClick={() => void showPreview()}>معاينة التغييرات</button>
        </div>
        {dirty && <p role="status" className="text-blue-800">لديك {changes.length} تغييرًا غير محفوظ في {dirtyRows.size} مادة. المدخلات غير المكتملة لا تنشئ نصابًا.</p>}
        <fieldset disabled={busy} className="min-w-0">
          <div className="max-w-full overflow-x-auto rounded-xl border bg-white">
            <table className="w-full min-w-[860px] text-sm"><thead className="bg-gray-50"><tr><th className="sticky right-0 z-10 min-w-40 bg-gray-50 p-3 text-right">المادة</th><th className="min-w-48 p-3">الحصص لجميع الشعب</th><th className="min-w-52 p-3">مدرس لجميع الشعب</th>{columns.map(s => <th key={s.id ?? 'none'} className="min-w-48 p-3">{s.name}</th>)}<th className="p-3">الحالة</th></tr></thead>
            <tbody>{rows?.map(subject => {
              const row = rowInputs[subject.id] ?? {};
              const periods = new Set(columns.filter(s => allowed.has(matrixKey(subject.id, s.id))).map(s => loadMap.get(matrixKey(subject.id, s.id))?.weekly_periods));
              return <tr key={subject.id} className="border-t align-top">
                <th className="sticky right-0 z-10 bg-white p-3 text-right">{subject.name}{subject.section_id != null && <small className="block text-amber-800">خاص بالشعبة {data.sections.find(s => s.id === subject.section_id)?.name ?? 'غير النشطة'}</small>}<button className={button + ' mt-3'} onClick={() => { const next = { ...draft }; for (const s of columns) delete next[matrixKey(subject.id, s.id)]; changeDraft(next); setRowInputs(v => ({ ...v, [subject.id]: {} })); }}>إعادة الصف إلى القيم المحفوظة</button></th>
                <td className="space-y-2 p-3"><input type="number" min="1" max={MAX_MATRIX_WEEKLY_PERIODS} className={field} aria-label={`عدد الحصص لجميع شعب ${subject.name}`} value={row.periods ?? ''} onChange={e => setRowInputs(v => ({ ...v, [subject.id]: { ...row, periods: e.target.value } }))} />
                  {periods.size > 1 && <p className="text-xs">مختلف حسب الشعبة</p>}
                  <button className={button} disabled={!row.periods?.trim()} onClick={() => changeDraft(applyMatrixRow(data, draft, subject.id, { periods: row.periods }))}>تطبيق على جميع الشعب</button><p className="text-xs text-gray-500">تخصيص الحصص حسب الشعبة متاح في كل خلية.</p></td>
                <td className="space-y-2 p-3"><select className={field} aria-label={`مدرس لجميع شعب ${subject.name}`} value={row.employeeId ?? ''} onChange={e => setRowInputs(v => ({ ...v, [subject.id]: { ...row, employeeId: e.target.value ? Number(e.target.value) : null } }))}>{teacherOptions()}</select>
                  <button className={button} onClick={() => changeDraft(applyMatrixRow(data, draft, subject.id, { employeeId: row.employeeId ?? null }))}>تطبيق المدرس على جميع الشعب</button>
                  <button className={button} onClick={() => changeDraft(applyMatrixRow(data, draft, subject.id, { employeeId: null }))}>مسح المدرس من جميع الشعب</button></td>
                {columns.map(section => {
                  const key = matrixKey(subject.id, section.id); const load = loadMap.get(key); const edit = draft[key] ?? {}; const change = edits.get(key);
                  if (!allowed.has(key)) return <td key={key} className="bg-gray-100 p-3 text-gray-400" aria-disabled="true">غير منطبق</td>;
                  const value = edit.periods ?? (load ? String(load.weekly_periods) : '');
                  const teacher = edit.employeeId === undefined ? load?.employee_id ?? null : edit.employeeId;
                  const invalid = value.trim() && (!Number.isInteger(Number(value)) || Number(value) < 1 || Number(value) > MAX_MATRIX_WEEKLY_PERIODS);
                  const conflict = preview?.items.find(i => matrixKey(i.subject_id, i.section_id) === key)?.blockers.length;
                  const tone = invalid || conflict ? 'bg-red-50' : change ? 'bg-blue-50' : !load ? 'bg-gray-50' : teacher == null ? 'bg-amber-50' : 'bg-emerald-50';
                  const update = (patch: MatrixDraft[string]) => changeDraft({ ...draft, [key]: { ...edit, ...patch } });
                  return <td key={key} className={`space-y-2 p-3 ${tone}`}>
                    <select className={field} aria-label={`مدرس ${subject.name} / ${section.name}`} value={teacher ?? ''} onChange={e => update({ employeeId: e.target.value ? Number(e.target.value) : null, deactivate: false })}>{teacher != null && !data.teachers.some(t => t.id === teacher) && <option value={teacher}>مدرس غير متاح — اختر بديلًا</option>}{teacherOptions()}</select>
                    <input className={field} type="number" min="1" max={MAX_MATRIX_WEEKLY_PERIODS} aria-label={`حصص ${subject.name} / ${section.name}`} value={value} onChange={e => update({ periods: e.target.value, deactivate: false })} />
                    <p className="text-xs">{invalid ? 'عدد الحصص غير صالح' : change ? `${actionLabels[change.action === 'upsert' ? load ? 'update' : 'create' : 'deactivate']} غير محفوظ` : !load ? 'لا يوجد نصاب بعد' : teacher == null ? 'بدون مدرس' : 'مكتمل'}{load && ` · #${load.id}`}</p>
                    {load && <div className="flex flex-wrap gap-1"><button className={button} onClick={() => update({ deactivate: !edit.deactivate })}>{edit.deactivate ? 'إلغاء التعطيل' : 'تعطيل هذا النصاب'}</button><button className={button} onClick={() => { if (allowLeave()) props.onAdvanced(load); }}>تعديل متقدم</button></div>}
                  </td>;
                })}
                <td className="p-3">{dirtyRows.has(subject.id) ? 'تعديل غير محفوظ' : 'محفوظ'}</td>
              </tr>;
            })}</tbody></table>
          </div>
        </fieldset>
        {preview && <section className="space-y-3 rounded-xl border bg-white p-4" aria-label="معاينة تغييرات النصاب"><h3 className="font-bold">معاينة التغييرات — لم يتم الحفظ بعد</h3><MatrixPlanSummary plan={preview} />{preview.can_apply && <button className={button + ' !bg-primary-600 text-white'} disabled={busy} onClick={() => void save()}>حفظ جميع الأنصبة</button>}</section>}
      </>}
    </>}
    {copyOpen && <div role="dialog" aria-modal="true" aria-label="نسخ النصاب من سنة سابقة" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><div className="max-h-[90vh] w-full max-w-3xl space-y-4 overflow-auto rounded-xl bg-white p-5">
      <h3 className="font-bold">نسخ النصاب من سنة سابقة — مسودة فقط</h3>
      {error && <p role="alert" className="text-red-700">{error}</p>}
      <select className={field} aria-label="السنة المصدر" value={sourceYearId} disabled={busy} onChange={e => { guard.invalidate(); setCopy(null); setSourceYearId(e.target.value); }}><option value="">اختر السنة المصدر</option>{props.years.filter(y => y.school_id === schoolId && y.id !== academicYearId).map(y => <option key={y.id} value={y.id}>{y.name}</option>)}</select>
      <select className={field} aria-label="طريقة النسخ" value={copyMode} disabled={busy} onChange={e => { guard.invalidate(); setCopy(null); setCopyMode(e.target.value as MatrixCopyMode); }}><option value="periods_only">نسخ عدد الحصص فقط</option><option value="periods_and_teachers">نسخ عدد الحصص والمدرسين</option></select>
      <p className="text-sm">يُنسخ النصاب بحسب معرّفات المواد والشعب، ولا تُنسخ الحصص المجدولة أو الأقفال. الخلايا غير الموجودة في المصدر لا تتغير.</p>
      <button className={button} disabled={busy || !sourceYearId} onClick={() => void copyPreview()}>معاينة النسخ</button>
      {copy && <><MatrixPlanSummary plan={copy.plan} />{copy.warnings.map((n,i) => <p key={i} className="text-amber-800">{n.message}</p>)}{copy.unavailable.map(n => <p key={matrixKey(n.subject_id, n.section_id)} className="text-amber-800">المادة #{n.subject_id}: {n.message}</p>)}<button className={button} disabled={busy} onClick={acceptCopy}>تحميل إلى المسودة — دون حفظ</button></>}
      <button className={button} onClick={() => { guard.invalidate(); setBusy(false); setCopyOpen(false); setCopy(null); }}>إغلاق</button>
    </div></div>}
  </section>;
}
