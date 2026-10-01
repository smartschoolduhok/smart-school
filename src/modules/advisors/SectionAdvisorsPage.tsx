import { useEffect, useRef, useState } from 'react';
import { Printer, Save, Users } from 'lucide-react';
import { SystemAdminSchoolSelector } from '../../components/SystemAdminSchoolSelector';
import { useTenantSchool } from '../../hooks/useTenantSchool';
import { useSchoolRequestGuard } from '../../hooks/useSchoolRequestGuard';
import { getAcademicYears, getSectionAdvisors, saveSectionAdvisor } from '../../lib/api';
import type { AcademicYearRecord } from '../../lib/academicYears';
import type { SectionAdvisorPlacement, SectionAdvisorsResponse } from '../../lib/sectionAdvisors';
import { TIMETABLE_DAY_NAMES } from '../../lib/timetable';

type Draft = { employee_id: number | null; attendance_confirmed: boolean; notes: string };
const keyFor = (placement: SectionAdvisorPlacement) => `${placement.class_id}:${placement.section_id ?? 'class'}`;
const draftFor = (placement: SectionAdvisorPlacement): Draft => ({
  employee_id: placement.assignment?.employee_id ?? null,
  attendance_confirmed: placement.assignment?.attendance_confirmed ?? false,
  notes: placement.assignment?.notes ?? '',
});
const sameDraft = (left: Draft, right: Draft) => left.employee_id === right.employee_id && left.attendance_confirmed === right.attendance_confirmed && left.notes === right.notes;
const fieldClass = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm disabled:bg-gray-100';

export function SectionAdvisorsManager({ schoolId, loadYears = getAcademicYears, loadAdvisors = getSectionAdvisors, saveAdvisor = saveSectionAdvisor, onDirtyChange }: {
  schoolId: number | null;
  loadYears?: typeof getAcademicYears;
  loadAdvisors?: typeof getSectionAdvisors;
  saveAdvisor?: typeof saveSectionAdvisor;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const captureSchoolRequest = useSchoolRequestGuard(schoolId);
  const [years, setYears] = useState<AcademicYearRecord[]>([]);
  const [academicYearId, setAcademicYearId] = useState<number | null>(null);
  const [summary, setSummary] = useState<SectionAdvisorsResponse | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loadingYears, setLoadingYears] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [yearsReload, setYearsReload] = useState(0);
  const scope = useRef({ schoolId, academicYearId });
  scope.current = { schoolId, academicYearId };
  const generation = useRef(0);
  const scopedYears = years.filter(year => year.school_id === schoolId);
  const validYearId = scopedYears.some(year => year.id === academicYearId) ? academicYearId : null;
  const currentSummary = summary?.school.id === schoolId && summary?.academic_year.id === validYearId ? summary : null;

  useEffect(() => {
    let active = true;
    const isCurrentSchool = captureSchoolRequest();
    setYears([]); setAcademicYearId(null); setError(''); setSuccess('');
    if (schoolId == null) { setLoadingYears(false); return () => { active = false; }; }
    setLoadingYears(true);
    void (async () => {
      try {
        const response = await loadYears(schoolId);
        if (!active || !isCurrentSchool()) return;
        if (response.error) throw new Error(response.error);
        const nextYears = (response.data || []).filter(year => Number(year.school_id) === schoolId);
        setYears(nextYears);
        setAcademicYearId(nextYears.find(year => Number(year.is_active) === 1)?.id ?? null);
      } catch (failure) {
        if (active && isCurrentSchool()) setError(failure instanceof Error ? failure.message : 'تعذر تحميل السنوات الدراسية.');
      } finally {
        if (active && isCurrentSchool()) setLoadingYears(false);
      }
    })();
    return () => { active = false; };
  }, [schoolId, loadYears, captureSchoolRequest, yearsReload]);

  useEffect(() => {
    const request = ++generation.current;
    const isCurrentSchool = captureSchoolRequest();
    let active = true;
    const isCurrent = () => active && isCurrentSchool() && generation.current === request
      && scope.current.schoolId === schoolId && scope.current.academicYearId === validYearId;
    setSummary(null); setDrafts({}); setSaving(null); setSuccess('');
    if (schoolId == null || validYearId == null) { setLoading(false); return () => { active = false; }; }
    setLoading(true); setError('');
    void (async () => {
      try {
        const response = await loadAdvisors(schoolId, validYearId);
        if (!isCurrent()) return;
        if (response.error) throw new Error(response.error);
        if (!response.data || response.data.school.id !== schoolId || response.data.academic_year.id !== validYearId) {
          throw new Error('تعذر مطابقة بيانات المرشدين مع المدرسة والسنة المختارتين.');
        }
        setSummary(response.data);
      } catch (failure) {
        if (isCurrent()) setError(failure instanceof Error ? failure.message : 'تعذر تحميل المرشدين.');
      } finally {
        if (isCurrent()) setLoading(false);
      }
    })();
    return () => { active = false; generation.current += 1; };
  }, [schoolId, validYearId, reload, loadAdvisors, captureSchoolRequest]);

  function changeDraft(placement: SectionAdvisorPlacement, patch: Partial<Draft>) {
    const key = keyFor(placement);
    setDrafts(previous => ({ ...previous, [key]: { ...(previous[key] || draftFor(placement)), ...patch } }));
    setSuccess('');
  }

  async function save(placement: SectionAdvisorPlacement) {
    if (!currentSummary || schoolId == null || validYearId == null || saving) return;
    const key = keyFor(placement);
    const draft = drafts[key] || draftFor(placement);
    if (draft.employee_id != null && !placement.candidates.some(candidate => candidate.employee_id === draft.employee_id)) {
      setError('اختر مرشداً من المدرسين الذين يدرّسون هذه الشعبة فعلياً.'); return;
    }
    const request = generation.current;
    const isCurrentSchool = captureSchoolRequest();
    const isCurrent = () => isCurrentSchool() && request === generation.current
      && scope.current.schoolId === schoolId && scope.current.academicYearId === validYearId;
    setSaving(key); setError(''); setSuccess('');
    try {
      const response = await saveAdvisor({ school_id: schoolId, academic_year_id: validYearId,
        class_id: placement.class_id, section_id: placement.section_id,
        employee_id: draft.employee_id, attendance_confirmed: draft.employee_id != null && draft.attendance_confirmed,
        notes: draft.employee_id == null ? '' : draft.notes, expected_version: placement.assignment?.version ?? 0 });
      if (!isCurrent()) return;
      if (response.error) throw new Error(`${response.error} يمكنك تحديث القائمة لإعادة تحميل آخر البيانات.`);
      const result = response.data;
      if (!result || result.school_id !== schoolId || result.academic_year_id !== validYearId
        || result.class_id !== placement.class_id || result.section_id !== placement.section_id) {
        throw new Error('تعذر مطابقة نتيجة الحفظ مع الشعبة المختارة. حدّث القائمة للتحقق.');
      }
      setSummary(previous => previous ? { ...previous, placements: previous.placements.map(row => keyFor(row) === key ? { ...row, assignment: result.assignment } : row) } : previous);
      setDrafts(previous => { const next = { ...previous }; delete next[key]; return next; });
      setSuccess(draft.employee_id == null ? 'تم إلغاء تكليف المرشد لهذه الشعبة.' : 'تم حفظ مرشد الشعبة.');
    } catch (failure) {
      if (isCurrent()) setError(failure instanceof Error ? failure.message : 'تعذر حفظ المرشد.');
    } finally {
      if (isCurrent()) setSaving(null);
    }
  }

  const placements = currentSummary?.placements || [];
  const incomplete = placements.filter(row => row.assignment?.employee_id == null || !row.candidates.some(candidate => candidate.employee_id === row.assignment?.employee_id));
  const hasChanges = placements.some(row => drafts[keyFor(row)] && !sameDraft(drafts[keyFor(row)], draftFor(row)));
  useEffect(() => { onDirtyChange?.(hasChanges); }, [hasChanges, onDirtyChange]);
  useEffect(() => {
    if (!hasChanges) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasChanges]);
  const mayDiscardChanges = () => !hasChanges || window.confirm('توجد تعديلات غير محفوظة على المرشدين. هل تريد المتابعة وإلغاء هذه التعديلات؟');
  const canPrint = placements.length > 0 && incomplete.length === 0 && !hasChanges && !saving && !loading && !error;
  const printUrl = `/print/section-advisors?school_id=${schoolId}&academic_year_id=${validYearId}`;

  return <section dir="rtl" className="space-y-5" aria-label="إدارة مرشدي الصفوف">
    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-4">
      <label className="min-w-52 flex-1 text-sm font-medium">السنة الدراسية
        <select aria-label="السنة الدراسية" className={`${fieldClass} mt-2`} value={validYearId ?? ''} disabled={schoolId == null || loadingYears}
          onChange={event => { if (!mayDiscardChanges()) return; setAcademicYearId(event.target.value ? Number(event.target.value) : null); setError(''); setSuccess(''); }}>
          <option value="">{loadingYears ? 'جاري تحميل السنوات...' : 'اختر السنة الدراسية'}</option>
          {scopedYears.map(year => <option key={year.id} value={year.id}>{year.name}</option>)}
        </select>
      </label>
      <button type="button" disabled={!validYearId || loading || !!saving} onClick={() => { if (mayDiscardChanges()) setReload(value => value + 1); }} className="rounded-lg border border-gray-300 px-4 py-2 text-sm disabled:opacity-50">تحديث القائمة</button>
      {canPrint ? <a href={printUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm text-white"><Printer size={16} />طباعة كتاب المرشدين</a>
        : <button type="button" disabled className="inline-flex items-center gap-2 rounded-lg bg-gray-200 px-4 py-2 text-sm text-gray-500"><Printer size={16} />طباعة كتاب المرشدين</button>}
    </div>
    <p className="text-sm leading-7 text-gray-600">اختر لكل شعبة مرشداً من المدرسين الذين لديهم حصص محفوظة فيها. أيام الحصص المعروضة تساعد في المراجعة؛ تأكيد حضور المرشد جميع أيام الدوام يتم بمعرفة الإدارة.</p>
    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {schoolId != null && error && !validYearId && !loadingYears && <button type="button" className="rounded-lg border border-gray-300 px-4 py-2 text-sm" onClick={() => setYearsReload(value => value + 1)}>إعادة تحميل السنوات</button>}
    {success && <p role="status" className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">{success}</p>}
    {schoolId == null && <p role="status" className="text-sm text-gray-600">اختر المدرسة لعرض مرشدي الصفوف.</p>}
    {schoolId != null && !loadingYears && !error && scopedYears.length === 0 && <p role="status" className="text-sm text-gray-600">لا توجد سنوات دراسية لهذه المدرسة. أضف السنة الدراسية أولاً.</p>}
    {loading && <p role="status">جاري تحميل مرشدي الصفوف...</p>}
    {!loading && currentSummary && <>
      {incomplete.length > 0 && <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">توجد {incomplete.length} شعبة تحتاج إلى مرشد مؤهل. أكمل التكليفات حتى يتاح طباعة الكتاب.</p>}
      {hasChanges && <p role="status" className="text-sm text-amber-800">توجد تعديلات غير محفوظة. احفظ كل شعبة معدّلة قبل طباعة الكتاب أو تحديث القائمة.</p>}
      {placements.length === 0 && <p role="status">لا توجد صفوف أو شعب نشطة لهذه المدرسة والسنة.</p>}
      <div className="grid gap-4 xl:grid-cols-2">{placements.map(placement => {
        const key = keyFor(placement);
        const draft = drafts[key] || draftFor(placement);
        const selected = placement.candidates.find(candidate => candidate.employee_id === draft.employee_id);
        const invalid = draft.employee_id != null && !selected;
        const missingDays = currentSummary.school_days.filter(day => !selected?.scheduled_days.includes(day));
        const dirty = !sameDraft(draft, draftFor(placement));
        const title = `${placement.class_name}${placement.section_name ? ` / ${placement.section_name}` : ''}`;
        return <article key={key} aria-label={title} data-testid={`advisor-row-${placement.class_id}-${placement.section_id ?? 0}`} className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
          <div><h2 className="font-bold text-gray-900">{title}</h2>{placement.stage_name && <p className="text-xs text-gray-500">{placement.stage_name}</p>}</div>
          <label className="block text-sm font-medium">مرشد الشعبة
            <select aria-label={`مرشد ${title}`} value={draft.employee_id ?? ''} disabled={saving === key} className={`${fieldClass} mt-1`}
              onChange={event => changeDraft(placement, { employee_id: event.target.value ? Number(event.target.value) : null, attendance_confirmed: false, notes: event.target.value ? draft.notes : '' })}>
              <option value="">بلا مرشد</option>
              {invalid && <option value={draft.employee_id!}>{placement.assignment?.employee_name || 'المرشد السابق'} — يحتاج إلى مراجعة</option>}
              {placement.candidates.map(candidate => <option key={candidate.employee_id} value={candidate.employee_id}>{candidate.employee_name} — {candidate.subjects.join('، ')} ({candidate.section_weekly_periods} حصص)</option>)}
            </select>
          </label>
          {invalid && <p role="alert" className="text-sm text-red-700">المرشد المحفوظ لم يعد ضمن المدرسين الذين لديهم حصص في هذه الشعبة. اختر مرشداً مؤهلاً أو ألغِ التكليف.</p>}
          {placement.candidates.length === 0 && <p className="text-sm text-amber-800">لا يوجد مدرس لديه حصص محفوظة لهذه الشعبة. راجع الجدول الدراسي أولاً.</p>}
          {selected && <div className="space-y-1 rounded-lg bg-gray-50 p-3 text-sm text-gray-700">
            <p>المواد: {selected.subjects.join('، ') || '—'}</p>
            <p>حصص الشعبة: {selected.section_weekly_periods} · إجمالي حصص المدرس: {selected.total_weekly_periods} أسبوعياً</p>
            <p>أيام الحصص: {selected.scheduled_days.map(day => TIMETABLE_DAY_NAMES[day]).join('، ') || 'لا توجد أيام مسجلة'}</p>
            {missingDays.length > 0 && <p className="text-amber-800">لا توجد حصص له في: {missingDays.map(day => TIMETABLE_DAY_NAMES[day]).join('، ')}. يمكن تأكيد حضوره إدارياً أدناه.</p>}
          </div>}
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" aria-label={`تأكيد الدوام ${title}`} className="mt-1" checked={draft.attendance_confirmed} disabled={draft.employee_id == null || invalid || saving === key}
            onChange={event => changeDraft(placement, { attendance_confirmed: event.target.checked })} />أؤكد حضور المرشد جميع أيام دوام المدرسة</label>
          {draft.employee_id != null && !draft.attendance_confirmed && <p className="text-xs text-amber-800">الحضور لجميع الأيام غير مؤكد؛ يبقى التكليف متاحاً مع هذا التنبيه.</p>}
          <label className="block text-sm">ملاحظات إدارية
            <textarea aria-label={`ملاحظات ${title}`} rows={2} maxLength={1000} value={draft.notes} disabled={draft.employee_id == null || saving === key} className={`${fieldClass} mt-1`}
              onChange={event => changeDraft(placement, { notes: event.target.value })} />
          </label>
          <button type="button" onClick={() => void save(placement)} disabled={!!saving || !dirty || invalid} className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm text-white disabled:opacity-50"><Save size={16} />{saving === key ? 'جاري الحفظ...' : `حفظ ${title}`}</button>
        </article>;
      })}</div>
    </>}
  </section>;
}

export default function SectionAdvisorsPage() {
  const schoolScope = useTenantSchool();
  const dirty = useRef(false);
  const selectSchool = (schoolId: number | null) => {
    if (schoolId === schoolScope.schoolId) return;
    if (dirty.current && !window.confirm('توجد تعديلات غير محفوظة على المرشدين. هل تريد تغيير المدرسة وإلغاء هذه التعديلات؟')) return;
    schoolScope.selectSchool(schoolId);
  };
  return <div className="space-y-5">
    <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900"><Users className="text-primary-600" />مرشدو الصفوف</h1>
    <SystemAdminSchoolSelector {...schoolScope} selectSchool={selectSchool} />
    <SectionAdvisorsManager schoolId={schoolScope.schoolId} onDirtyChange={value => { dirty.current = value; }} />
  </div>;
}
