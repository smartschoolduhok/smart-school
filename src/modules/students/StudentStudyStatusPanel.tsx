import { useEffect, useRef, useState, type FormEvent } from 'react';
import { getAcademicYears, getClasses } from '../../lib/api';
import { ACADEMIC_MANAGEMENT_ROLES, SCHOOL_MANAGEMENT_ROLES, hasRole } from '../../lib/rbac';
import { getStudentStudyStatus, saveStudentStudyStatus } from '../../lib/studentStudyStatusApi';
import { STUDY_STATUS_LABELS, ageExceptionEvidence, isAgeExceptionApplicable, type StudentStudyStatus, type StudyStatus } from '../../lib/studentStudyStatus';
import type { AcademicYearRecord } from '../../lib/academicYears';
import type { EffectiveStudentRecord, StudentEnrollmentHistoryRecord } from '../../lib/studentEnrollments';
import type { RoleKey } from '../../types';

const field = 'mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm disabled:bg-gray-100';
type Draft = { study_status: StudyStatus; grades_visible: boolean; exception: boolean; reference: string; document_date: string; authority: string; reason: string; class_id: string; change_reason: string; confirmed: boolean };
function draftFrom(value: StudentStudyStatus, classId?: number | null): Draft {
  return { study_status: value.study_status, grades_visible: value.grades_visible, exception: !!value.age_exception,
    reference: value.age_exception?.reference || '', document_date: value.age_exception?.document_date || '', authority: value.age_exception?.authority || '', reason: value.age_exception?.reason || '', class_id: String(value.age_exception?.class_id || classId || ''), change_reason: '', confirmed: false };
}

export default function StudentStudyStatusPanel({ student, schoolId, role, history, onSaved, loadYears = getAcademicYears, loadClasses = getClasses, loadStatus = getStudentStudyStatus, saveStatus = saveStudentStudyStatus }: {
  student: EffectiveStudentRecord; schoolId: number; role?: RoleKey; history: StudentEnrollmentHistoryRecord[]; onSaved?: () => void;
  loadYears?: typeof getAcademicYears; loadClasses?: typeof getClasses; loadStatus?: typeof getStudentStudyStatus; saveStatus?: typeof saveStudentStudyStatus;
}) {
  const authorized = hasRole(role, ACADEMIC_MANAGEMENT_ROLES);
  const canManage = hasRole(role, SCHOOL_MANAGEMENT_ROLES);
  const baseKey = `${schoolId}:${student.id}:${role}`;
  const [catalog, setCatalog] = useState<{ key: string; years: AcademicYearRecord[]; classes: {id: number; name: string}[]; error: string } | null>(null);
  const [year, setYear] = useState<{ key: string; id: number | null }>({ key: '', id: null });
  const yearId = year.key === baseKey ? year.id : null;
  const scopeKey = `${baseKey}:${yearId}`;
  const liveScope = useRef(scopeKey); liveScope.current = scopeKey;
  const [state, setState] = useState<{ key: string; data: StudentStudyStatus | null; error: string; loading: boolean }>({key: '', data: null, error: '', loading: false});
  const [draftState, setDraftState] = useState<{ key: string; draft: Draft; initial: string } | null>(null);
  const [reload, setReload] = useState(0);
  const [catalogReload, setCatalogReload] = useState(0);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [saveError, setSaveError] = useState('');
  const requestNumber = useRef(0);
  const visibleCatalog = catalog?.key === baseKey ? catalog : null;
  const data = state.key === scopeKey ? state.data : null;
  const draft = draftState?.key === scopeKey ? draftState.draft : null;
  const dirty = !!draft && JSON.stringify(draft) !== draftState?.initial;
  const enrollmentClass = history.find(item => item.academic_year_id === yearId)?.class_id ?? (yearId === student.current_academic_year_id ? student.class_id : null);
  const patch = (change: Partial<Draft>) => { setDraftState(previous => previous && previous.key === scopeKey ? {...previous, draft: {...previous.draft, ...change}} : previous); setMessage(''); };

  useEffect(() => {
    let active = true;
    setCatalog(null); setYear({key: baseKey, id: null}); setMessage(''); setSaveError('');
    if (!authorized || student.school_id !== schoolId) return;
    void (async () => {
      try {
        const [years, classes] = await Promise.all([loadYears(schoolId), loadClasses(schoolId)]);
        if (!active) return;
        if (years.error || classes.error || !years.data || !classes.data) throw new Error(years.error || classes.error || 'تعذر تحميل السنوات والصفوف.');
        const schoolYears = years.data.filter(item => item.school_id === schoolId);
        setCatalog({key: baseKey, years: schoolYears, classes: classes.data as {id: number; name: string}[], error: ''});
        setYear({key: baseKey, id: schoolYears.find(item => item.id === student.current_academic_year_id)?.id ?? schoolYears.find(item => item.is_active)?.id ?? null});
      } catch (error) { if (active) setCatalog({key: baseKey, years: [], classes: [], error: error instanceof Error ? error.message : 'تعذر تحميل الاختيارات.'}); }
    })();
    return () => { active = false; };
  }, [baseKey, authorized, schoolId, student.school_id, student.current_academic_year_id, loadYears, loadClasses, catalogReload]);

  useEffect(() => {
    let active = true;
    const sequence = ++requestNumber.current;
    setSaving(false); setMessage(''); setSaveError(''); setDraftState(null);
    setState({key: scopeKey, data: null, error: '', loading: authorized && yearId != null});
    if (!authorized || yearId == null) return;
    void (async () => {
      try {
        const response = await loadStatus(student.id, {school_id: schoolId, academic_year_id: yearId});
        if (!active || liveScope.current !== scopeKey || requestNumber.current !== sequence) return;
        if (response.error || !response.data) throw new Error(response.error || 'تعذر تحميل الوضع الدراسي.');
        if (response.data.student_id !== student.id || response.data.academic_year_id !== yearId) throw new Error('تعذر مطابقة الطالب والسنة الدراسية.');
        const next = draftFrom(response.data, enrollmentClass);
        setState({key: scopeKey, data: response.data, error: '', loading: false});
        setDraftState({key: scopeKey, draft: next, initial: JSON.stringify(next)});
      } catch (error) { if (active && liveScope.current === scopeKey) setState({key: scopeKey, data: null, error: error instanceof Error ? error.message : 'تعذر التحميل.', loading: false}); }
    })();
    return () => { active = false; if (requestNumber.current === sequence) requestNumber.current++; };
  }, [scopeKey, authorized, yearId, schoolId, student.id, loadStatus, reload, enrollmentClass]);

  useEffect(() => {
    if (!dirty) return;
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, [dirty]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canManage || !data || !draft || !yearId || saving) return;
    const evidence = draft.exception ? {reference: draft.reference.trim(), document_date: draft.document_date, authority: draft.authority.trim(), reason: draft.reason.trim(), class_id: Number(draft.class_id)} : null;
    if (!draft.change_reason.trim()) { setSaveError('أدخل سبب التغيير لحفظه في سجل التدقيق.'); return; }
    if (evidence && (!evidence.reference || !evidence.document_date || !evidence.authority || !evidence.reason || !evidence.class_id || !student.birth_date || !['male', 'female'].includes(student.gender))) { setSaveError('أكمل بيانات كتاب الاستثناء والصف وتاريخ ميلاد الطالب وجنسه قبل الحفظ.'); return; }
    const changedEvidence = evidence && (JSON.stringify(evidence) !== JSON.stringify(data.age_exception && ageExceptionEvidence(data.age_exception)) || data.age_exception?.birth_date !== student.birth_date || data.age_exception?.gender !== student.gender);
    if (changedEvidence && !draft.confirmed) { setSaveError('أكد مطابقة كتاب الاستثناء الرسمي للطالب والسنة والصف المحددين.'); return; }
    const captured = scopeKey, sequence = requestNumber.current;
    setSaving(true); setSaveError(''); setMessage('');
    try {
      const response = await saveStatus(student.id, {school_id: schoolId, academic_year_id: yearId, revision: data.revision, study_status: draft.study_status, grades_visible: draft.grades_visible,
        age_exception: evidence, change_reason: draft.change_reason.trim(), ...(changedEvidence ? {confirm_age_exception_verified: true} : {})});
      if (liveScope.current !== captured || sequence !== requestNumber.current) return;
      if (response.error || !response.data) throw new Error(response.error || 'تعذر حفظ الوضع الدراسي.');
      if (response.data.student_id !== student.id || response.data.academic_year_id !== yearId) throw new Error('تعذر مطابقة نتيجة الحفظ. أعد تحميل الحالة الحالية.');
      const next = draftFrom(response.data, enrollmentClass);
      setState({key: scopeKey, data: response.data, error: '', loading: false});
      setDraftState({key: scopeKey, draft: next, initial: JSON.stringify(next)});
      setMessage('تم حفظ إعدادات هذه السنة الدراسية.'); onSaved?.();
    } catch (error) { if (liveScope.current === captured && sequence === requestNumber.current) setSaveError(error instanceof Error ? error.message : 'تعذر الحفظ.'); }
    finally { if (liveScope.current === captured && sequence === requestNumber.current) setSaving(false); }
  }
  const reset = () => { if (!dirty || window.confirm('ستُستبدل التعديلات غير المحفوظة بالحالة المحفوظة. هل تريد المتابعة؟')) setReload(value => value + 1); };
  const ageApplicable = data?.age_exception && isAgeExceptionApplicable(data.age_exception, {class_id: enrollmentClass ?? data.age_exception.class_id, birth_date: student.birth_date, gender: student.gender});
  return <section className="rounded-xl border border-blue-200 bg-white p-5" aria-label="الوضع الدراسي السنوي">
    <h2 className="text-lg font-bold text-gray-900">الوضع الدراسي السنوي</h2>
    <p className="mt-1 text-sm text-gray-600">الانتظام والاستضافة والانتساب تُحدد لكل سنة. عرض الدرجات اختيار مستقل، ويبقى اسم الطالب في قوائم التوزيع.</p>
    {!authorized ? <p className="mt-4 rounded-lg bg-gray-50 p-3 text-sm text-gray-600">تتولى إدارة المدرسة تعديل الوضع الدراسي وعرض الدرجات وتوثيق استثناء العمر.</p> : <>
      <label className="mt-4 block text-sm font-medium">السنة الدراسية للوضع الدراسي<select aria-label="السنة الدراسية للوضع الدراسي" className={field} value={yearId ?? ''} disabled={saving || !visibleCatalog} onChange={event => {
        if (dirty && !window.confirm('هناك تعديلات غير محفوظة. هل تريد تركها والانتقال إلى السنة الأخرى؟')) return;
        setYear({key: baseKey, id: Number(event.target.value) || null});
      }}><option value="">اختر السنة الدراسية</option>{visibleCatalog?.years.map(item => <option key={item.id} value={item.id}>{item.name}{item.is_active ? ' — الحالية' : ''}</option>)}</select></label>
      {visibleCatalog?.error && <p role="alert" className="mt-3 text-red-700">{visibleCatalog.error}<button type="button" className="mr-3 underline" onClick={() => setCatalogReload(value => value + 1)}>إعادة تحميل السنوات والصفوف</button></p>}
      {!visibleCatalog && <p role="status" className="mt-3">جاري تحميل السنوات والصفوف…</p>}
      {state.key === scopeKey && state.loading && <p role="status" className="mt-3">جاري تحميل الوضع الدراسي…</p>}
      {state.key === scopeKey && state.error && <div role="alert" className="mt-3 text-red-700">{state.error}<button type="button" className="mr-3 underline" onClick={reset}>إعادة المحاولة</button></div>}
      {data && draft && <form onSubmit={submit} className="mt-4 space-y-4">
        {!canManage && <p className="text-sm text-gray-600">عرض للقراءة فقط؛ التعديل متاح لإدارة المدرسة.</p>}
        <fieldset disabled={saving || !canManage} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-medium">نوع الدراسة<select className={field} aria-label="نوع الدراسة" value={draft.study_status} onChange={event => patch({study_status: event.target.value as StudyStatus})}>{Object.entries(STUDY_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="flex items-center gap-3 rounded-lg border p-3 text-sm"><input type="checkbox" checked={draft.grades_visible} onChange={event => patch({grades_visible: event.target.checked})}/>إظهار درجات الطالب لهذه السنة</label>
          </div>
          <p className="text-xs text-gray-600">الإخفاء يمنع عرض الدرجات دون حذفها أو إلغاء تسجيل الطالب. تغيير نوع الدراسة لا يغيّر هذا الخيار.</p>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
            <label className="flex items-center gap-3 text-sm font-bold"><input type="checkbox" checked={draft.exception} onChange={event => patch({exception: event.target.checked, confirmed: false})}/>استثناء عمر موثق بكتاب رسمي</label>
            <p className="mt-2 text-xs text-amber-900">للأعمار الأصغر أو الأكبر من الضوابط عند وجود استثناء رسمي. يخص هذا الطالب والسنة والصف فقط، ولا يعدّل الضوابط العامة أو يضمن قبول بقية الشروط.</p>
            {data.age_exception && !ageApplicable && <p role="alert" className="mt-3 text-sm font-bold text-red-700">الاستثناء المحفوظ لا يطابق الصف أو بيانات الميلاد الحالية. راجع الكتاب وأعد توثيقه قبل الاعتماد عليه.</p>}
            {draft.exception && <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="text-sm">الصف المشمول بالاستثناء<select aria-label="الصف المشمول بالاستثناء" required className={field} value={draft.class_id} onChange={event => patch({class_id: event.target.value, confirmed: false})}><option value="">اختر الصف</option>{visibleCatalog?.classes.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              <label className="text-sm">رقم الكتاب / المرجع<input required maxLength={250} className={field} value={draft.reference} onChange={event => patch({reference: event.target.value, confirmed: false})}/></label>
              <label className="text-sm">تاريخ الكتاب<input required type="date" className={field} value={draft.document_date} onChange={event => patch({document_date: event.target.value, confirmed: false})}/></label>
              <label className="text-sm">الجهة المصدرة<input required maxLength={200} className={field} value={draft.authority} onChange={event => patch({authority: event.target.value, confirmed: false})}/></label>
              <label className="text-sm sm:col-span-2">سبب الاستثناء ونطاقه<textarea required maxLength={1000} rows={3} className={field} value={draft.reason} onChange={event => patch({reason: event.target.value, confirmed: false})}/></label>
              <p className="text-xs sm:col-span-2">تُحفظ مطابقة الاستثناء لتاريخ الميلاد ({student.birth_date || 'غير مسجل'}) والجنس الحاليين. يمكن توثيقه قبل التسجيل السنوي بعد اختيار الصف المقصود.</p>
              <label className="flex items-start gap-3 text-sm sm:col-span-2"><input type="checkbox" className="mt-1" checked={draft.confirmed} onChange={event => patch({confirmed: event.target.checked})}/>راجعت الكتاب الرسمي وتحققت من شموله هذا الطالب والسنة والصف المحددين.</label>
            </div>}
            {data.age_exception && !draft.exception && <p className="mt-3 text-sm font-bold text-amber-900">سيُلغى استثناء العمر لهذه السنة عند الحفظ؛ يجب ذكر سبب الإلغاء.</p>}
          </div>
          {canManage && <><label className="block text-sm font-medium">سبب التغيير<input required maxLength={500} className={field} value={draft.change_reason} onChange={event => patch({change_reason: event.target.value})}/></label>
          <div className="flex flex-wrap items-center gap-3"><button type="submit" disabled={!dirty} className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'جاري الحفظ…' : 'حفظ الوضع الدراسي'}</button><button type="button" onClick={reset} className="rounded-lg border px-3 py-2 text-sm">إعادة تحميل الحالة المحفوظة</button><span className="text-xs text-gray-500">المراجعة {data.revision}{dirty ? ' — توجد تعديلات غير محفوظة' : ''}</span></div></>}
        </fieldset>
        {saveError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{saveError} لم تُستبدل تعديلاتك؛ راجع الحالة المحفوظة قبل إعادة المحاولة.</p>}
        {message && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-800">{message}</p>}
      </form>}
    </>}
  </section>;
}
