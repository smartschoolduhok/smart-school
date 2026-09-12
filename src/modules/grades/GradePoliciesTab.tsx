import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, FileClock, LockKeyhole, PlusCircle, RotateCcw, Save, ShieldCheck } from 'lucide-react';
import {
  amendGradePolicy,
  createGradePolicy,
  getAcademicYears,
  getClasses,
  getGradePolicies,
  getGradePolicyHistory,
  getStudents,
  previewStudentGradePolicy,
  transitionGradePolicy,
  updateGradePolicy,
} from '../../lib/api';
import type { AcademicGradePolicy } from '../../lib/gradePolicy';
import { toArabicDigits } from '../../lib/arabicDigits';
import { useSchoolRequestGuard } from '../../hooks/useSchoolRequestGuard';

type PolicyRow = AcademicGradePolicy & Record<string, any>;

const EMPTY_POLICY: AcademicGradePolicy = {
  policy_kind: 'non_terminal',
  pass_mark: 50,
  decision_points: 0,
  decision_allocation_mode: 'optimal',
  decision_points_outcome_only: 1,
  max_completion_subjects: 3,
  exemption_enabled: 1,
  individual_exemption_grade: 90,
  general_exemption_average_grade: 85,
  general_exemption_min_subject_grade: 75,
  ministerial_entry_mode: 'none',
  ministerial_max_failed_subjects: 0,
  minimum_monthly_exams_per_term: 1,
  fraction_rounding_mode: 'ceil',
  source_reference: '',
  notes: '',
};

const POLICY_FIELDS = [
  'policy_kind', 'pass_mark', 'decision_points', 'decision_allocation_mode',
  'decision_points_outcome_only', 'max_completion_subjects', 'exemption_enabled',
  'individual_exemption_grade', 'general_exemption_average_grade',
  'general_exemption_min_subject_grade', 'ministerial_entry_mode',
  'ministerial_max_failed_subjects', 'minimum_monthly_exams_per_term',
  'fraction_rounding_mode', 'source_reference', 'notes',
] as const;

function editablePolicy(row: PolicyRow | null): AcademicGradePolicy {
  if (!row) return { ...EMPTY_POLICY };
  return Object.fromEntries(POLICY_FIELDS.map(field => [field, row[field]])) as unknown as AcademicGradePolicy;
}

function policyStatus(status: string | undefined) {
  if (status === 'locked') return { label: 'مقفلة', cls: 'bg-slate-100 text-slate-700' };
  if (status === 'approved') return { label: 'معتمدة', cls: 'bg-emerald-100 text-emerald-700' };
  return { label: 'مسودة', cls: 'bg-amber-100 text-amber-700' };
}

const READINESS_LABELS: Record<string, string> = {
  no_active_year: 'لا توجد سنة فعالة', no_active_classes: 'لا توجد صفوف فعالة',
  not_configured: 'لم تبدأ التهيئة', partial: 'تهيئة جزئية',
  drafts_pending: 'مسودات بانتظار الاعتماد',
  amendments_pending: 'السياسات الرسمية فعالة وتوجد تعديلات مسودة',
  healthy: 'جاهزة',
};
const ACADEMIC_LABELS: Record<string, string> = { pass: 'ناجح', completion: 'مكمل', fail: 'راسب', incomplete: 'غير مكتمل' };
const MINISTERIAL_LABELS: Record<string, string> = { not_applicable: 'غير مطبق', eligible: 'مؤهل للدخول الوزاري', not_eligible: 'غير مؤهل للدخول الوزاري', comprehensive: 'دخول شامل', pending: 'بانتظار اكتمال الدرجات' };

export function GradePoliciesTab({ schoolId }: { schoolId: number | null }) {
  const captureSchoolRequest = useSchoolRequestGuard(schoolId);
  const [years, setYears] = useState<any[]>([]);
  const [classes, setClasses] = useState<any[]>([]);
  const [policies, setPolicies] = useState<PolicyRow[]>([]);
  const [yearId, setYearId] = useState('');
  const [classId, setClassId] = useState('');
  const [form, setForm] = useState<AcademicGradePolicy>({ ...EMPTY_POLICY });
  const [readiness, setReadiness] = useState<any>(null);
  const [students, setStudents] = useState<any[]>([]);
  const [studentId, setStudentId] = useState('');
  const [preview, setPreview] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const selected = useMemo(
    () => policies.find(policy => Number(policy.class_id) === Number(classId)) || null,
    [policies, classId],
  );
  const selectedStatus = policyStatus(selected?.status);
  const canEdit = !selected || selected.status === 'draft';
  const hasUnsavedChanges = selected
    ? POLICY_FIELDS.some(field => String(form[field] ?? '') !== String(selected[field] ?? ''))
    : true;

  useEffect(() => {
    setYears([]); setClasses([]); setPolicies([]); setReadiness(null);
    setYearId(''); setClassId(''); setStudents([]); setStudentId(''); setPreview(null); setHistory([]);
    if (schoolId == null) return;
    const isCurrent = captureSchoolRequest();
    void Promise.all([getAcademicYears(schoolId), getClasses(schoolId)]).then(([yearRes, classRes]) => {
      if (!isCurrent()) return;
      const nextYears = yearRes.data || [];
      setYears(nextYears);
      setClasses((classRes.data || []).filter((item: any) => item.status !== 'archived'));
      const active = nextYears.find((year: any) => year.is_active === 1) || nextYears[0];
      if (active) setYearId(String(active.id));
    });
  }, [schoolId]);

  useEffect(() => {
    setPolicies([]); setReadiness(null); setClassId(''); setPreview(null); setHistory([]);
    if (schoolId == null || !yearId) return;
    const isCurrent = captureSchoolRequest();
    void getGradePolicies({ school_id: schoolId, academic_year_id: Number(yearId) }).then(res => {
      if (!isCurrent()) return;
      if (res.error) setMessage({ type: 'error', text: res.error });
      else {
        setPolicies((res.data || []) as PolicyRow[]);
        setReadiness(res.meta?.readiness || null);
      }
    });
  }, [schoolId, yearId]);

  useEffect(() => {
    setForm(editablePolicy(selected));
    setPreview(null); setHistory([]); setStudentId(''); setStudents([]);
    if (schoolId == null || !classId) return;
    const isCurrent = captureSchoolRequest();
    void getStudents(schoolId, Number(classId), null).then(res => {
      if (isCurrent()) setStudents(res.data || []);
    });
  }, [schoolId, classId, selected?.id, selected?.revision]);

  function setField<K extends keyof AcademicGradePolicy>(key: K, value: AcademicGradePolicy[K]) {
    setForm(current => ({ ...current, [key]: value }));
  }

  function applyTemplate(kind: 'terminal' | 'non_terminal') {
    if (kind === 'terminal') {
      setForm(current => ({
        ...current,
        policy_kind: 'terminal', exemption_enabled: 0,
        decision_points: 10, max_completion_subjects: 3,
        ministerial_entry_mode: 'pass_or_completion', ministerial_max_failed_subjects: 3,
        minimum_monthly_exams_per_term: 1,
      }));
    } else {
      setForm(current => ({
        ...current,
        policy_kind: 'non_terminal', exemption_enabled: 1,
        decision_points: 5, max_completion_subjects: 3,
        ministerial_entry_mode: 'none', ministerial_max_failed_subjects: 0,
        minimum_monthly_exams_per_term: 1,
      }));
    }
  }

  async function reload(selectId?: number) {
    if (schoolId == null || !yearId) return;
    const res = await getGradePolicies({ school_id: schoolId, academic_year_id: Number(yearId) });
    if (res.data) {
      setPolicies(res.data as PolicyRow[]);
      setReadiness(res.meta?.readiness || null);
      if (selectId) setClassId(String((res.data as PolicyRow[]).find(item => item.id === selectId)?.class_id || classId));
    }
  }

  async function save() {
    if (schoolId == null || !yearId || !classId) return;
    setBusy(true); setMessage(null);
    const payload = {
      ...form,
      school_id: schoolId,
      academic_year_id: Number(yearId),
      class_id: Number(classId),
      revision: selected?.revision,
      change_reason: selected ? 'تحديث مسودة السياسة السنوية' : 'إنشاء مسودة السياسة السنوية',
    };
    const res = selected
      ? await updateGradePolicy(Number(selected.id), payload)
      : await createGradePolicy(payload);
    setBusy(false);
    if (res.error) return setMessage({ type: 'error', text: res.error });
    await reload(Number(res.data?.id));
    setMessage({ type: 'success', text: 'حُفظت المسودة. لا تؤثر في النتائج قبل الاعتماد.' });
  }

  async function transition(action: 'approve' | 'lock') {
    if (!selected || schoolId == null) return;
    const verb = action === 'approve' ? 'اعتماد' : 'قفل';
    if (!window.confirm(`${verb} السياسة بالإصدار ${selected.version}؟`)) return;
    setBusy(true); setMessage(null);
    const res = await transitionGradePolicy(Number(selected.id), action, {
      school_id: schoolId,
      revision: selected.revision,
      change_reason: `${verb} السياسة السنوية`,
    });
    setBusy(false);
    if (res.error) return setMessage({ type: 'error', text: res.error });
    await reload(Number(res.data?.id));
    setMessage({ type: 'success', text: action === 'approve' ? 'اعتمدت السياسة وأصبحت فعالة.' : 'قُفلت السياسة وحُفظت كسجل رسمي.' });
  }

  async function amend() {
    if (!selected || schoolId == null) return;
    if (!window.confirm('إنشاء مسودة تعديل جديدة مع حفظ الإصدار الحالي في السجل؟')) return;
    setBusy(true); setMessage(null);
    const res = await amendGradePolicy(Number(selected.id), {
      school_id: schoolId,
      revision: selected.revision,
      change_reason: 'تعديل لاحق على القرار السنوي',
    });
    setBusy(false);
    if (res.error) return setMessage({ type: 'error', text: res.error });
    await reload(Number(res.data?.id));
    setMessage({ type: 'success', text: 'أُنشئ إصدار جديد كمسودة؛ الإصدار السابق محفوظ.' });
  }

  async function showHistory() {
    if (!selected) return;
    const res = await getGradePolicyHistory(Number(selected.id));
    if (res.error) setMessage({ type: 'error', text: res.error });
    else setHistory(res.data || []);
  }

  async function runPreview() {
    if (schoolId == null || !yearId || !classId || !studentId) return;
    setBusy(true); setMessage(null);
    const res = await previewStudentGradePolicy({
      school_id: schoolId,
      academic_year_id: Number(yearId),
      class_id: Number(classId),
      student_id: Number(studentId),
      policy: form,
    });
    setBusy(false);
    if (res.error) return setMessage({ type: 'error', text: res.error });
    setPreview(res.data || null);
  }

  if (schoolId == null) return <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">اختر المدرسة أولًا.</div>;

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
        <div className="flex items-center gap-2 font-bold"><ShieldCheck size={18} />السياسة السنوية هي مصدر القرار الرسمي</div>
        <p className="mt-1 text-xs leading-6">أنشئ سياسة لكل صف وسنة. المسودة للمعاينة فقط، والمعتمدة تُستخدم في الدرجات والكروت والتحليلات. لا تُعدّل الدرجات الخام.</p>
      </div>

      <div className="grid gap-3 rounded-xl border border-gray-200 bg-white p-4 md:grid-cols-2">
        <label className="text-sm font-medium text-gray-700">السنة الدراسية
          <select value={yearId} onChange={event => setYearId(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2">
            <option value="">اختر السنة</option>
            {years.map(year => <option key={year.id} value={year.id}>{year.name}{year.is_active === 1 ? ' — الحالية' : ''}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium text-gray-700">الصف
          <select value={classId} onChange={event => setClassId(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2">
            <option value="">اختر الصف</option>
            {classes.map(item => {
              const policy = policies.find(row => Number(row.class_id) === Number(item.id));
              return <option key={item.id} value={item.id}>{item.name}{policy ? ` — ${policyStatus(policy.status).label}` : ' — غير مهيأ'}</option>;
            })}
          </select>
        </label>
        {readiness && <div className="md:col-span-2 text-xs text-gray-600">الجاهزية: {toArabicDigits(readiness.approved_classes || 0)} معتمد من {toArabicDigits(readiness.active_classes || 0)} صف — الحالة: {READINESS_LABELS[readiness.status] || readiness.status}</div>}
      </div>

      {classId && (
        <div className="space-y-5 rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-bold text-gray-900">{classes.find(item => String(item.id) === classId)?.name}</h3>
              <p className="text-xs text-gray-500">{selected ? `الإصدار ${toArabicDigits(selected.version ?? 1)} — المراجعة ${toArabicDigits(selected.revision ?? 0)}` : 'سياسة جديدة'}</p>
            </div>
            {selected && <span className={`rounded-full px-3 py-1 text-xs font-bold ${selectedStatus.cls}`}>{selectedStatus.label}</span>}
          </div>

          {canEdit && (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => applyTemplate('terminal')} className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-medium hover:bg-gray-50">قالب صف منتهٍ</button>
              <button type="button" onClick={() => applyTemplate('non_terminal')} className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-medium hover:bg-gray-50">قالب صف غير منتهٍ</button>
              <span className="self-center text-xs text-amber-700">القوالب نقطة بداية فقط؛ راجع قرار الوزارة ثم سجل مرجعه.</span>
            </div>
          )}

          <fieldset disabled={!canEdit || busy} className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 disabled:opacity-70">
            <label className="text-sm">نوع الصف<select value={form.policy_kind} onChange={e => {
              const terminal = e.target.value === 'terminal';
              setForm(current => ({ ...current, policy_kind: e.target.value as any, exemption_enabled: terminal ? 0 : current.exemption_enabled, ministerial_entry_mode: terminal ? 'pass_or_completion' : 'none', ministerial_max_failed_subjects: terminal ? current.ministerial_max_failed_subjects : 0 }));
            }} className="mt-1 w-full rounded-lg border px-3 py-2"><option value="terminal">منتهٍ / وزاري</option><option value="non_terminal">غير منتهٍ</option></select></label>
            <NumberField label="درجة النجاح" value={form.pass_mark} onChange={value => setField('pass_mark', value)} />
            <NumberField label="رصيد درجات القرار" value={form.decision_points} onChange={value => setField('decision_points', value)} />
            <label className="text-sm">توزيع درجات القرار<select value={form.decision_allocation_mode} onChange={e => setField('decision_allocation_mode', e.target.value as any)} className="mt-1 w-full rounded-lg border px-3 py-2"><option value="optimal">آلي: إنقاذ أكبر عدد</option><option value="manual">يدوي موثّق</option></select></label>
            <NumberField label="أقصى مواد الإكمال" value={form.max_completion_subjects} onChange={value => setField('max_completion_subjects', value)} integer />
            <label className="text-sm">الامتحانات الشهرية الدنيا<select value={form.minimum_monthly_exams_per_term} onChange={e => setField('minimum_monthly_exams_per_term', Number(e.target.value))} className="mt-1 w-full rounded-lg border px-3 py-2"><option value="1">امتحان واحد</option><option value="2">امتحانان</option></select></label>
            <label className="text-sm">معالجة الكسور<select value={form.fraction_rounding_mode} onChange={e => setField('fraction_rounding_mode', e.target.value as any)} className="mt-1 w-full rounded-lg border px-3 py-2"><option value="ceil">رفع الكسر</option><option value="nearest">لأقرب عدد</option><option value="none">بدون تقريب</option></select></label>
            <label className="flex items-center gap-2 rounded-lg border p-3 text-sm"><input type="checkbox" checked={form.decision_points_outcome_only === 1 || form.decision_points_outcome_only === true} onChange={e => setField('decision_points_outcome_only', e.target.checked ? 1 : 0)} />استخدم القرار فقط لتغيير النتيجة</label>

            {form.policy_kind === 'terminal' ? <>
              <label className="text-sm">قاعدة الدخول الوزاري<select value={form.ministerial_entry_mode} onChange={e => setField('ministerial_entry_mode', e.target.value as any)} className="mt-1 w-full rounded-lg border px-3 py-2"><option value="all_continuing">دخول شامل</option><option value="pass_only">الناجح فقط</option><option value="pass_or_completion">ناجح أو مكمل ضمن الحد</option><option value="none">غير مطبق</option></select></label>
              <NumberField label="أقصى مواد للدخول الوزاري" value={form.ministerial_max_failed_subjects} onChange={value => setField('ministerial_max_failed_subjects', value)} integer />
            </> : <>
              <label className="flex items-center gap-2 rounded-lg border p-3 text-sm"><input type="checkbox" checked={form.exemption_enabled === 1 || form.exemption_enabled === true} onChange={e => setField('exemption_enabled', e.target.checked ? 1 : 0)} />تفعيل الإعفاء</label>
              <NumberField label="درجة الإعفاء الفردي" value={form.individual_exemption_grade} onChange={value => setField('individual_exemption_grade', value)} />
              <NumberField label="معدل الإعفاء العام" value={form.general_exemption_average_grade} onChange={value => setField('general_exemption_average_grade', value)} />
              <NumberField label="أدنى مادة للإعفاء العام" value={form.general_exemption_min_subject_grade} onChange={value => setField('general_exemption_min_subject_grade', value)} />
            </>}
            <label className="text-sm md:col-span-2 lg:col-span-3">مرجع القرار الوزاري / الإداري
              <input value={form.source_reference || ''} onChange={e => setField('source_reference', e.target.value)} maxLength={500} placeholder="رقم الكتاب، تاريخه أو رابط المرجع" className="mt-1 w-full rounded-lg border px-3 py-2" />
            </label>
            <label className="text-sm md:col-span-2 lg:col-span-3">ملاحظات
              <textarea value={form.notes || ''} onChange={e => setField('notes', e.target.value)} maxLength={2000} rows={3} className="mt-1 w-full rounded-lg border px-3 py-2" />
            </label>
          </fieldset>

          <div className="flex flex-wrap gap-2 border-t pt-4">
            {canEdit && <button type="button" onClick={save} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"><Save size={17} />حفظ المسودة</button>}
            {selected?.status === 'draft' && <button type="button" onClick={() => transition('approve')} disabled={busy || hasUnsavedChanges || !String(form.source_reference || '').trim()} title={hasUnsavedChanges ? 'احفظ التغييرات أولًا' : undefined} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"><CheckCircle2 size={17} />اعتماد</button>}
            {selected?.status === 'approved' && <button type="button" onClick={() => transition('lock')} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-slate-700 px-4 py-2 text-sm font-bold text-white"><LockKeyhole size={17} />قفل الإصدار</button>}
            {selected && ['approved', 'locked'].includes(String(selected.status)) && <button type="button" onClick={amend} disabled={busy} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-bold"><RotateCcw size={17} />إنشاء تعديل</button>}
            {selected && <button type="button" onClick={showHistory} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm"><FileClock size={17} />السجل</button>}
          </div>
          {selected?.status === 'draft' && hasUnsavedChanges && <p className="text-xs text-amber-700">احفظ المسودة أولًا قبل الاعتماد، حتى تكون المعاينة والقرار متطابقين.</p>}

          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
            <h4 className="font-bold">معاينة آمنة قبل الاعتماد</h4>
            <div className="mt-3 flex flex-wrap gap-2">
              <select value={studentId} onChange={e => setStudentId(e.target.value)} className="min-w-64 rounded-lg border px-3 py-2 text-sm"><option value="">اختر طالبًا من الصف</option>{students.map(student => <option key={student.id} value={student.id}>{student.full_name}</option>)}</select>
              <button type="button" onClick={runPreview} disabled={busy || !studentId} className="inline-flex items-center gap-2 rounded-lg border border-primary-300 bg-white px-4 py-2 text-sm font-bold text-primary-700 disabled:opacity-50"><PlusCircle size={17} />حساب المعاينة</button>
            </div>
            {preview?.outcome && <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4"><Metric label="النتيجة" value={ACADEMIC_LABELS[preview.outcome.academic_status] || preview.outcome.academic_status} /><Metric label="الدخول الوزاري" value={MINISTERIAL_LABELS[preview.outcome.ministerial_eligibility] || preview.outcome.ministerial_eligibility} /><Metric label="مواد الإكمال" value={preview.outcome.adjusted_failed_subjects} /><Metric label="درجات القرار المستخدمة" value={preview.outcome.decision_points_used} /></div>}
          </div>

          {history.length > 0 && <div className="rounded-xl border border-gray-200 p-4"><h4 className="mb-3 font-bold">سجل السياسة</h4><div className="space-y-2">{history.map(item => <div key={item.id} className="rounded-lg bg-gray-50 px-3 py-2 text-xs"><span className="font-bold">{item.action}</span> — {item.changed_by_name || 'النظام'} — {item.change_reason || 'بدون ملاحظة'}</div>)}</div></div>}
          {message && <div className={`rounded-lg p-3 text-sm ${message.type === 'success' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>{message.text}</div>}
        </div>
      )}
    </div>
  );
}

function NumberField({ label, value, onChange, integer = false }: { label: string; value: number; onChange: (value: number) => void; integer?: boolean }) {
  return <label className="text-sm">{label}<input type="number" min="0" max="100" step={integer ? '1' : '0.01'} value={value} onChange={event => onChange(Number(event.target.value))} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>;
}

function Metric({ label, value }: { label: string; value: unknown }) {
  return <div className="rounded-lg border bg-white p-3"><div className="text-xs text-gray-500">{label}</div><div className="mt-1 font-bold">{toArabicDigits(String(value ?? '—'))}</div></div>;
}
