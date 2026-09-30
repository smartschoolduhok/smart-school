import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, GitCompareArrows, LoaderCircle, Lock, RefreshCcw, Sparkles, Unlock, WandSparkles } from 'lucide-react';
import { useSchoolRequestGuard } from '../../hooks/useSchoolRequestGuard';
import type { Class, Section } from '../../types';
import type { TimetableScope } from '../../lib/timetableScope';
import { TimetableScopeSelector } from './TimetableScopeSelector';
import { TimetableLoadDiagnostics } from './TimetableLoadDiagnostics';
import { timetableEntriesForPlacement } from './timetableViewEntries';
import { applyTimetableProposal, prepareTimetableSolver, previewTimetableAdoption } from '../../lib/api';
import { solveTimetableInWorker } from '../../lib/timetableSolverClient';
import { TimetablePreferencesPanel } from './TimetablePreferencesPanel';
import { TIMETABLE_SEARCH_BUDGETS, type TimetableSearchDuration } from '../../lib/timetablePreferences';
import type { TimetableSearchProgress } from '../../lib/timetableSolverPrepared';
import {
  TIMETABLE_DAY_NAMES,
  timetablePlacementKey,
  timetableSubjectColorForSubject,
  type TimetablePlacement,
  type TimetableReadinessSummary,
  type TimetableSlot,
} from '../../lib/timetable';
import type {
  TimetableSolverPenaltyBreakdown,
  TimetableSolverPreview,
  TimetableSolverStatus,
} from '../../lib/timetableSolver';
import {
  computeTimetableProposalDigest,
  type TimetableAdoptionPreview,
  type TimetableSolverProposalWithIntegrity,
} from '../../lib/timetableAdoption';

interface AutomaticTimetableTabProps {
  classes?: Class[];
  sections?: Section[];
  schoolId: number;
  academicYearId: number;
  dataVersion: number;
  readiness: TimetableReadinessSummary | null;
  onAdopted: () => Promise<void>;
}

function SolverMetric({ label, value, tone = 'blue' }: {
  label: string;
  value: number;
  tone?: 'blue' | 'green' | 'amber' | 'red';
}) {
  const colors = {
    blue: 'border-blue-200 bg-blue-50 text-blue-800',
    green: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    amber: 'border-amber-200 bg-amber-50 text-amber-800',
    red: 'border-red-200 bg-red-50 text-red-800',
  };
  return (
    <div className={`rounded-xl border p-3 ${colors[tone]}`}>
      <p className="text-xs font-medium opacity-80">{label}</p>
      <bdi dir="ltr" className="mt-1 block text-xl font-bold [unicode-bidi:isolate]">{value}</bdi>
    </div>
  );
}

const STATUS_PRESENTATION: Record<TimetableSolverStatus, { label: string; classes: string }> = {
  complete: { label: 'اقتراح مكتمل', classes: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
  partial: { label: 'اقتراح جزئي', classes: 'border-amber-200 bg-amber-50 text-amber-900' },
  impossible: { label: 'غير ممكن بالقيود الحالية', classes: 'border-red-200 bg-red-50 text-red-800' },
  fixed_conflict: { label: 'تعارض في الدروس المثبتة', classes: 'border-red-200 bg-red-50 text-red-800' },
};

const PENALTY_LABELS: Record<keyof TimetableSolverPenaltyBreakdown, string> = {
  avoid_slots: 'فترات مفضّل تجنبها',
  outside_preferred_slots: 'خارج الفترات المفضلة',
  teacher_gaps: 'فجوات جدول المدرس',
  first_period_preferences: 'تفضيل تجنب الدرس الأول',
  last_period_preferences: 'تفضيل تجنب الدرس الأخير',
  subject_clustering: 'تفضيل توزيع المادة على أيام مختلفة',
  consecutive_same_subject: 'تكرار متتالٍ للمادة',
  class_daily_imbalance: 'عدم توازن الحمل اليومي',
  early_light_subjects: 'المواد الخفيفة في بداية اليوم',
  consecutive_heavy_subjects: 'تتابع زائد للدروس الثقيلة',
  missed_section_continuity: 'فرص تتابع الشعب غير المتحققة',
  late_science_subjects: 'تفضيل العلوم في بداية اليوم',
  repeated_first_subjects: 'تنويع مادة الدرس الأول',
  daily_subject_doubles: 'تكرار المادة المتتالي عند الضرورة',
};

function placementLabel(placement: TimetablePlacement) {
  return `${placement.class_name}${placement.section_name ? ` / ${placement.section_name}` : ''}`;
}

function slotLabel(slot: TimetableSlot) {
  if (slot.slot_type === 'break') return slot.label || 'استراحة';
  return slot.label || `الدرس ${slot.lesson_number || slot.slot_index}`;
}

function ProposalGrid({ result, schoolId, disabled, onToggleLock }: {
  result: TimetableSolverPreview;
  schoolId: number;
  disabled: boolean;
  onToggleLock: (proposalId: string) => void;
}) {
  const days = useMemo(() => [...result.days].sort((left, right) => (
    left.order_index - right.order_index || left.day_of_week - right.day_of_week
  )), [result.days]);
  const placements = useMemo(() => result.placements, [result.placements]);
  return (
    <div className="space-y-5">
      {days.map((day) => {
        const slots = result.slots
          .filter((slot) => Number(slot.day_of_week) === Number(day.day_of_week))
          .sort((left, right) => left.start_time.localeCompare(right.start_time) || left.slot_index - right.slot_index || left.id - right.id);
        return (
          <section key={day.id} className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <div className="border-b border-gray-200 bg-slate-800 px-4 py-3 text-sm font-bold text-white">
              {TIMETABLE_DAY_NAMES[day.day_of_week] || `اليوم ${day.day_of_week}`}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-max border-collapse text-xs">
                <thead className="bg-gray-50 text-gray-700">
                  <tr>
                    <th className="sticky right-0 z-10 min-w-36 border-b border-l border-gray-200 bg-gray-50 p-3 text-right">الفترة</th>
                    {placements.map((placement) => (
                      <th key={timetablePlacementKey(placement)} className="min-w-44 border-b border-l border-gray-200 p-3 text-center">
                        {placementLabel(placement)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {slots.map((slot) => (
                    <tr key={slot.id} className="align-top">
                      <th className="sticky right-0 z-10 border-b border-l border-gray-200 bg-white p-3 text-right">
                        <span className="block font-bold text-gray-900">{slotLabel(slot)}</span>
                        <bdi dir="ltr" className="mt-1 block text-[11px] font-normal text-gray-500 [unicode-bidi:isolate]">{slot.start_time} – {slot.end_time}</bdi>
                      </th>
                      {slot.slot_type === 'break' ? (
                        <td colSpan={Math.max(1, placements.length)} className="border-b border-gray-200 bg-amber-50 p-3 text-center font-semibold text-amber-800">{slotLabel(slot)}</td>
                      ) : placements.map((placement) => {
                        const entries = timetableEntriesForPlacement(result.entries, slot.id, placement);
                        if (!entries.length) return <td key={timetablePlacementKey(placement)} className="border-b border-l border-gray-200 bg-white p-2" />;
                        return (
                          <td key={timetablePlacementKey(placement)} className="space-y-2 border-b border-l border-gray-200 p-2">
                            {entries.map(entry => { const color = timetableSubjectColorForSubject(schoolId, entry.subject_name); return <div key={entry.proposal_id} data-proposal-entry={entry.proposal_id} className="min-h-20 rounded-lg border-r-4 p-2" style={{ backgroundColor: color.background, borderColor: color.border, color: color.foreground }}>
                              <p className="font-bold">{entry.subject_name}</p>
                              <p className={`mt-1 ${entry.employee_id == null ? 'font-bold' : ''}`}>{entry.employee_name || 'بدون مدرس'}</p>
                              {entry.soft_warnings.length > 0 && <p className="mt-1 text-[10px]">{entry.soft_warnings.map((warning) => warning.message).join('، ')}</p>}
                              <button
                                type="button"
                                disabled={disabled || entry.is_preserved}
                                onClick={() => onToggleLock(entry.proposal_id)}
                                className="mt-2 flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-[10px] font-bold text-gray-900 disabled:opacity-70"
                                aria-label={entry.is_locked === 1 ? 'إلغاء تثبيت الدرس' : 'تثبيت الدرس'}
                              >
                                {entry.is_locked === 1 ? <Lock size={12} /> : <Unlock size={12} />}
                                {entry.is_preserved ? 'محفوظة من الجدول الحالي' : entry.is_locked === 1 ? 'إلغاء التثبيت' : 'تثبيت الدرس'}
                              </button>
                            </div>; })}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  {slots.length === 0 && <tr><td colSpan={Math.max(2, placements.length + 1)} className="p-8 text-center text-gray-500">لا توجد فترات فعالة.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}

export function AutomaticTimetableTab({
  classes = [],
  sections = [],
  schoolId,
  academicYearId,
  dataVersion,
  readiness,
  onAdopted,
}: AutomaticTimetableTabProps) {
  const captureSchoolRequest = useSchoolRequestGuard(schoolId);
  const requestGenerationRef = useRef(0);
  const solverAbortRef = useRef<AbortController | null>(null);
  const scopeRef = useRef({ schoolId, academicYearId, dataVersion });
  scopeRef.current = { schoolId, academicYearId, dataVersion };
  const [result, setResult] = useState<TimetableSolverProposalWithIntegrity | null>(null);
  const fiveDaySpreadExceptions = useMemo(() => {
    if (!result || result.status !== 'complete') return [];
    const activeDays = result.days.filter(day => Number(day.is_active) === 1).map(day => Number(day.day_of_week));
    if (activeDays.length !== 5) return [];
    const byLoad = new Map<number, typeof result.entries>();
    for (const entry of result.entries) {
      const current = byLoad.get(entry.teaching_load_id) || [];
      current.push(entry);
      byLoad.set(entry.teaching_load_id, current);
    }
    return [...byLoad.values()].filter(entries => entries.length === 5
      && new Set(entries.map(entry => entry.day_of_week)).size < 5).map(entries => ({
        label: `${entries[0].class_name}${entries[0].section_name ? ` / ${entries[0].section_name}` : ''} — ${entries[0].subject_name}`,
        missingDays: activeDays.filter(day => !entries.some(entry => entry.day_of_week === day)),
      }));
  }, [result]);
  const [adoptionPreview, setAdoptionPreview] = useState<TimetableAdoptionPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchProgress, setSearchProgress] = useState<TimetableSearchProgress | null>(null);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [linkSectionDays, setLinkSectionDays] = useState(false);
  const [searchDuration, setSearchDuration] = useState<TimetableSearchDuration>('quick');
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [preferencesDirty, setPreferencesDirty] = useState(false);
  const [generationScope, setGenerationScope] = useState<TimetableScope>({ kind: 'school' });
  useEffect(() => { setGenerationScope({ kind: 'school' }); setLinkSectionDays(false); }, [schoolId, academicYearId]);

  useEffect(() => {
    requestGenerationRef.current += 1;
    solverAbortRef.current?.abort();
    solverAbortRef.current = null;
    setResult(null);
    setAdoptionPreview(null);
    setLoading(false);
    setApplying(false);
    setError('');
    setSuccess('');
    return () => { requestGenerationRef.current += 1; solverAbortRef.current?.abort(); solverAbortRef.current = null; };
  }, [academicYearId, dataVersion, schoolId]);

  async function generateProposal(options?: {
    fixed_entries?: Array<{ slot_id: number; teaching_load_id: number }>;
    use_current_locked_entries?: boolean;
    link_same_teacher_section_days?: boolean;
    generation_scope?: TimetableScope;
  }, baseline?: TimetableSolverProposalWithIntegrity) {
    if (savingPreferences || preferencesDirty) return;
    const generation = ++requestGenerationRef.current;
    solverAbortRef.current?.abort();
    const controller = new AbortController();
    solverAbortRef.current = controller;
    const expectedScope = { schoolId, academicYearId, dataVersion };
    const isCurrentSchool = captureSchoolRequest();
    const isCurrent = () => generation === requestGenerationRef.current && isCurrentSchool()
      && scopeRef.current.schoolId === expectedScope.schoolId
      && scopeRef.current.academicYearId === expectedScope.academicYearId
      && scopeRef.current.dataVersion === expectedScope.dataVersion;
    setLoading(true);
    setSearchProgress(null);
    if (!baseline) setResult(null);
    setAdoptionPreview(null);
    setError('');
    setSuccess('');
    const response = await prepareTimetableSolver(schoolId, academicYearId, { generation_scope: generationScope, link_same_teacher_section_days: linkSectionDays, ...options }, controller.signal);
    if (
      generation !== requestGenerationRef.current
      || !isCurrentSchool()
      || scopeRef.current.schoolId !== expectedScope.schoolId
      || scopeRef.current.academicYearId !== expectedScope.academicYearId
      || scopeRef.current.dataVersion !== expectedScope.dataVersion
    ) return;
    if (response.error) {
      setLoading(false);
      solverAbortRef.current = null;
      setError(response.status === 503 && response.error === 'خطأ 503'
        ? 'تعذر إكمال توليد الجدول الآن. حاول مرة أخرى، أو اختر صفًا أو شعبة لتوليد نطاق أصغر.'
        : response.error);
      return;
    }
    if (!response.data || response.data.input?.schoolId !== schoolId || response.data.input?.academicYearId !== academicYearId) {
      setLoading(false); solverAbortRef.current = null;
      setError('تعذر تحميل بيانات الجدول للنطاق المحدد. حدّث الصفحة وأعد المحاولة.');
      return;
    }
    try {
      const baselineIsCurrent = baseline?.timetable_revision === response.data.timetable_revision;
      if (baseline && !baselineIsCurrent) setResult(null);
      const proposal = await solveTimetableInWorker({...response.data, search_duration: searchDuration,
        ...(baseline ? {baseline_revision: baseline.timetable_revision, baseline_entries: baseline.entries.map(({slot_id, teaching_load_id, is_locked}) => ({slot_id, teaching_load_id, is_locked}))} : {}),
      }, {signal: controller.signal,
        onProgress: progress => { if (isCurrent()) setSearchProgress(progress); },
      });
      if (isCurrent()) setResult(proposal);
    } catch (error) {
      if (isCurrent() && !controller.signal.aborted) setError(error instanceof Error ? error.message : 'تعذر إكمال توليد الجدول. أعد المحاولة.');
    } finally {
      if (solverAbortRef.current === controller) solverAbortRef.current = null;
      if (isCurrent()) setLoading(false);
    }
  }

  function cancelGeneration() {
    requestGenerationRef.current += 1;
    solverAbortRef.current?.abort(); solverAbortRef.current = null;
    setLoading(false); setError('');
  }

  async function toggleProposalLock(proposalId: string) {
    if (!result || loading || applying) return;
    const selected = result.entries.find(entry => entry.proposal_id === proposalId);
    if (!selected || selected.is_preserved) return;
    const group = result.entries.filter(entry => entry.slot_id === selected.slot_id && entry.class_id === selected.class_id
      && entry.section_id === selected.section_id && (entry.proposal_id === proposalId
        || entry.parallel_with_load_id === selected.teaching_load_id || selected.parallel_with_load_id === entry.teaching_load_id));
    if (group.some(entry => entry.is_preserved)) return;
    const groupIds = new Set(group.map(entry => entry.proposal_id));
    const nextLock = group.some(entry => entry.is_locked === 1) ? 0 as const : 1 as const;
    const generation = ++requestGenerationRef.current;
    const nextEntries = result.entries.map((entry) => (
      groupIds.has(entry.proposal_id) ? { ...entry, is_locked: nextLock } : entry
    ));
    const digest = await computeTimetableProposalDigest({
      schoolId,
      academicYearId,
      revision: result.timetable_revision,
      entries: nextEntries,
      linkSameTeacherSectionDays: result.link_same_teacher_section_days,
      generationScope: result.generation_scope,
      scopeLoadIds: result.scope_load_ids,
    });
    if (generation !== requestGenerationRef.current) return;
    setResult({ ...result, entries: nextEntries, proposal_digest: digest });
    setAdoptionPreview(null);
    setSuccess('');
  }

  async function reSolveUnlocked() {
    if (!result) return;
    await generateProposal({
      link_same_teacher_section_days: result.link_same_teacher_section_days,
      generation_scope: result.generation_scope,
      fixed_entries: result.entries.filter((entry) => entry.is_locked === 1).map((entry) => ({
        slot_id: entry.slot_id,
        teaching_load_id: entry.teaching_load_id,
      })),
    }, result);
  }

  async function previewAdoption() {
    if (!result) return;
    const generation = ++requestGenerationRef.current;
    setApplying(true);
    setError('');
    setSuccess('');
    const response = await previewTimetableAdoption({
      school_id: schoolId,
      academic_year_id: academicYearId,
      proposal_revision: result.timetable_revision,
      proposal_digest: result.proposal_digest,
      entries: result.entries,
      link_same_teacher_section_days: result.link_same_teacher_section_days,
      generation_scope: result.generation_scope,
      scope_load_ids: result.scope_load_ids,
      scope_token: result.scope_token,
    });
    if (generation !== requestGenerationRef.current) return;
    setApplying(false);
    if (response.error) {
      setAdoptionPreview(null);
      setError(response.error);
      return;
    }
    setAdoptionPreview(response.data || null);
  }

  async function applyProposal() {
    if (!result || !adoptionPreview?.can_apply) return;
    if (!window.confirm('سيصبح هذا المقترح هو الجدول الرسمي للسنة الدراسية.\nسيتم حفظ نسخة من الجدول الحالي قبل الاستبدال.\nهل تريد المتابعة؟')) return;
    const generation = ++requestGenerationRef.current;
    setApplying(true);
    setError('');
    const response = await applyTimetableProposal({
      school_id: schoolId,
      academic_year_id: academicYearId,
      expected_revision: result.timetable_revision,
      proposal_digest: result.proposal_digest,
      entries: result.entries,
      link_same_teacher_section_days: result.link_same_teacher_section_days,
      generation_scope: result.generation_scope,
      scope_load_ids: result.scope_load_ids,
      scope_token: result.scope_token,
      confirm_apply: true,
    });
    if (generation !== requestGenerationRef.current) return;
    setApplying(false);
    if (response.error) {
      setError(response.error);
      setAdoptionPreview(null);
      return;
    }
    setResult(null);
    setAdoptionPreview(null);
    setSuccess('تم اعتماد الجدول بنجاح');
    await onAdopted();
  }

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-indigo-200 bg-gradient-to-l from-indigo-50 to-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold text-indigo-950"><WandSparkles size={22} />التوليد التلقائي</h2>
            <p className="mt-1 max-w-3xl text-sm text-indigo-800">اختر مدرسة أو مرحلة أو صفًا أو شعبة. يكمل النظام أنصبة النطاق مع احترام الدروس المثبتة وتعارضات المدرسين وبقية الشعب.</p>
            <p className="mt-2 max-w-3xl text-sm text-indigo-800">عند اختيار نطاق محدد تبقى جميع الدروس خارجه كما هي. يمكنك إعداد جزء يدويًا، تثبيته من الجدول الأسبوعي، ثم توليد الباقي.</p>
            <p className="mt-2 max-w-3xl text-sm text-indigo-800">يبدأ التوليد بمحاولة توزيع المادة مرة واحدة يوميًا لكل شعبة. إذا تعذّر إكمال الجدول ضمن البحث والقيود، يسمح بدرسين متتاليين للمادة نفسها عند الضرورة فقط، في جميع الصفوف. لا يسمح بتكرارها في درسين منفصلين أو أكثر من مرتين في اليوم.</p>
            <p className="mt-2 max-w-3xl text-sm text-indigo-800">يعطي أولوية لتتابع دروس المدرس للمادة نفسها بين شعب الصف، مثل درس في أ يليه مباشرة درس في ب، مع مراعاة التوفر ومنع التعارض.</p>
            <p className="mt-2 max-w-3xl text-sm text-indigo-800">من أولويات المدرسة يمكنك تفعيل تأخير الأخلاقية والفنية والرياضة والكردية والفرنسية والحاسوب عن أول درسين، وتفريق الدروس الثقيلة خلال اليوم.</p>
            <p className="mt-2 max-w-3xl text-sm text-indigo-800">يمكن تقديم الرياضيات والفيزياء والكيمياء في بداية اليوم، بأولوية أكبر للصفوف المنتهية، مع تنويع مادة الدرس الأول بين الأيام.</p>
            <p className="mt-2 max-w-3xl text-xs text-indigo-800">تظل أوقات توفر المدرسين ومنع التعارض والدروس المثبتة مقدّمة على هذه التفضيلات؛ لذلك قد تبقى استثناءات في الترتيب.</p>
            <p className="mt-2 flex items-center gap-2 text-sm font-semibold text-amber-800"><AlertTriangle size={17} />هذا اقتراح جديد ولن يغيّر الجدول الحالي حتى يتم اعتماده.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {loading && <button type="button" onClick={cancelGeneration} className="rounded-lg border border-indigo-300 bg-white px-4 py-3 font-bold text-indigo-800">إلغاء التوليد</button>}
            <button
              type="button"
              disabled={loading || applying || savingPreferences || preferencesDirty}
              onClick={() => void generateProposal()}
              className="flex items-center gap-2 rounded-lg bg-indigo-700 px-5 py-3 font-bold text-white shadow-sm hover:bg-indigo-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? <LoaderCircle size={19} className="animate-spin" /> : <Sparkles size={19} />}
              {loading ? 'جاري بناء الاقتراح...' : 'إنشاء جدول تلقائي'}
            </button>
            <button
              type="button"
              disabled={loading || applying || savingPreferences || preferencesDirty}
              onClick={() => void generateProposal({ use_current_locked_entries: true })}
              className="flex items-center gap-2 rounded-lg border border-indigo-300 bg-white px-4 py-3 font-bold text-indigo-800 disabled:opacity-50"
            >
              <RefreshCcw size={18} />إعادة تحسين الجدول الحالي
            </button>
          </div>
        </div>
        <div className="mt-4 max-w-xl"><TimetableScopeSelector classes={classes} sections={sections} value={generationScope} disabled={loading || applying || savingPreferences || preferencesDirty} onChange={scope => {
          requestGenerationRef.current += 1; solverAbortRef.current?.abort(); solverAbortRef.current = null; setGenerationScope(scope); setResult(null); setAdoptionPreview(null); setError(''); setSuccess('');
        }} /></div>
        <label className="mt-4 block max-w-xl text-sm font-bold text-indigo-950">
          مدة البحث
          <select aria-label="مدة البحث" value={searchDuration} disabled={loading || applying || savingPreferences} onChange={event => setSearchDuration(event.target.value as TimetableSearchDuration)} className="mt-1 block w-full rounded-lg border border-indigo-200 bg-white p-3 font-normal">
            {(Object.entries(TIMETABLE_SEARCH_BUDGETS) as [TimetableSearchDuration, (typeof TIMETABLE_SEARCH_BUDGETS)[TimetableSearchDuration]][]).map(([key, budget]) => <option key={key} value={key}>{budget.label}</option>)}
          </select>
          <span className="mt-1 block font-normal">البحث الأطول يجرّب توزيعات أكثر، ويحتفظ بأفضل نتيجة يجدها. يمكنك إلغاؤه.</span>
        </label>
        <label className="mt-4 flex max-w-3xl items-start gap-3 rounded-lg border border-indigo-200 bg-white p-4">
          <input type="checkbox" className="mt-1 h-5 w-5 accent-indigo-700" checked={linkSectionDays} disabled={loading || applying || savingPreferences || preferencesDirty} onChange={event => {
            requestGenerationRef.current += 1; setLinkSectionDays(event.target.checked); setResult(null); setAdoptionPreview(null); setError(''); setSuccess('');
          }} />
          <span><span className="block font-bold text-indigo-950">ربط شعب المدرس للمادة نفسها في اليوم نفسه</span>
            <span className="mt-1 block text-sm text-indigo-800">للصف نفسه والمدرس نفسه فقط. عند التفعيل تتطابق أيام المادة بين شعبه، وتبقى أولوية التتابع مثل أ ثم ب مع مراعاة القيود. عند اختلاف النصاب لا يسمح بتكرار المادة إلا بدرسين متتاليين عند الضرورة.</span>
            <span className="mt-1 block text-xs text-indigo-800">إذا منعت الدروس المثبتة أو التوفر إكمال الربط، تظهر التفاصيل للمراجعة. تبقى دروس النطاقات الأخرى محفوظة.</span>
          </span>
        </label>
      </section>

      <TimetablePreferencesPanel key={schoolId} schoolId={schoolId} disabled={loading || applying} onBusy={setSavingPreferences} onDirty={setPreferencesDirty} onSaved={() => {
        requestGenerationRef.current += 1; setResult(null); setAdoptionPreview(null); setSuccess(''); setError('');
      }} />

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h3 className="mb-3 font-bold text-gray-900">ملخص الجاهزية قبل التوليد</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SolverMetric label="السعة الأسبوعية لكل شعبة" value={readiness?.weekly_capacity || 0} />
          <SolverMetric label="الدروس المطلوبة" value={readiness?.total_required_periods || 0} tone="green" />
          <SolverMetric label="أنصبة بلا مدرس" value={readiness?.missing_teacher_count || 0} tone={readiness?.missing_teacher_count ? 'amber' : 'green'} />
          <SolverMetric label="مراجع غير صالحة" value={readiness?.invalid_reference_count || 0} tone={readiness?.invalid_reference_count ? 'red' : 'green'} />
        </div>
        <div className="mt-4"><TimetableLoadDiagnostics readiness={readiness} /></div>
      </section>

      {error && <div role="alert" className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-800"><AlertTriangle size={19} />{error}</div>}
      {loading && <div role="status" aria-live="polite" className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-950">
        <p className="font-bold">{searchProgress ? `المحاولة ${searchProgress.run} من ${searchProgress.total_runs} — نبحث عن أفضل توزيع` : 'جاري تجهيز بيانات التوليد...'}</p>
        {searchProgress && searchProgress.best_required > 0 && <p className="mt-1">أفضل تغطية حتى الآن: {searchProgress.best_scheduled} من {searchProgress.best_required} درس.</p>}
        <p className="mt-1">مدة البحث المختارة: {TIMETABLE_SEARCH_BUDGETS[searchDuration].label}. يمكنك متابعة استخدام الصفحة أو إلغاء التوليد.</p>
      </div>}
      {success && <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800"><CheckCircle2 size={19} />{success}</div>}

      {result && (
        <>
          <section className={`rounded-xl border p-4 ${STATUS_PRESENTATION[result.status].classes}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2"><CheckCircle2 size={21} /><span className="font-bold">{STATUS_PRESENTATION[result.status].label}</span></div>
              <span className="rounded-full border border-current px-3 py-1 text-xs font-bold">معاينة — غير معتمدة</span>
            </div>
          </section>

          {result.fixed_conflicts.length > 0 && (
            <section className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
              <h3 className="font-bold">الدروس المثبتة تمنع إنشاء جدول صالح</h3>
              <ul className="mt-2 list-inside list-disc space-y-1">
                {result.fixed_conflicts.map((conflict, index) => (
                  <li key={`${conflict.code}:${conflict.slot_id}:${conflict.teaching_load_id}:${index}`}>
                    {conflict.message} <bdi dir="ltr">({conflict.code})</bdi>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <SolverMetric label="درجة الجودة المقارنة" value={result.quality_score} tone={result.quality_score >= 80 ? 'green' : result.quality_score >= 60 ? 'amber' : 'red'} />
            <SolverMetric label="المطلوب" value={result.required_periods} />
            <SolverMetric label="المجدول" value={result.scheduled_periods} tone="green" />
            <SolverMetric label="غير المجدول" value={result.unscheduled_periods} tone={result.unscheduled_periods ? 'red' : 'green'} />
            <SolverMetric label="سجلات حالية غير صالحة/تاريخية" value={result.statistics.existing_invalid_entry_count} tone={result.statistics.existing_invalid_entry_count ? 'amber' : 'green'} />
          </div>

          {result.warnings.map((warning, index) => (
            <div key={`${warning}:${index}`} className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><AlertTriangle size={18} className="mt-0.5 shrink-0" />{warning}</div>
          ))}

          {fiveDaySpreadExceptions.length > 0 && <details className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">
            <summary className="cursor-pointer font-bold">تفضيل درس يوميًا لم يتحقق في {fiveDaySpreadExceptions.length} مواد ذات خمسة دروس أسبوعيًا</summary>
            <p className="mt-2">هذه ملاحظة لتحسين التوزيع وليست مخالفة أو مانعًا لاعتماد الجدول. يمكن مراجعة توفر المدرسين والدروس المثبتة عند الرغبة بتحسينها.</p>
            <ul className="mt-2 list-inside list-disc space-y-1">
              {fiveDaySpreadExceptions.map(item => <li key={item.label}>{item.label}: بلا درس في {item.missingDays.map(day => TIMETABLE_DAY_NAMES[day]).join('، ')}</li>)}
            </ul>
          </details>}

          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-bold text-gray-900">تفاصيل درجة الجودة</h3>
              <p className="text-xs text-gray-500">{result.scoring.note}</p>
            </div>
            <p className="mt-2 text-xs text-gray-600">القيم نقاط للتفضيلات غير المتحققة بحسب أهميتها. انخفاضها يعني ترتيبًا أقرب للأولويات ضمن القيود المتاحة.</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {(Object.entries(result.scoring.penalties) as Array<[keyof TimetableSolverPenaltyBreakdown, number]>).map(([key, value]) => (
                <div key={key} data-timetable-penalty={key} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-sm"><span>{PENALTY_LABELS[key]}</span><bdi dir="ltr" className="font-bold [unicode-bidi:isolate]">{value}</bdi></div>
              ))}
            </div>
            {result.scoring.pedagogy && <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm text-blue-900" aria-label="نتيجة تفضيلات ترتيب الدروس">
              <p>دروس خفيفة باقية في أول درسين: <bdi>{result.scoring.pedagogy.early_light_lessons}</bdi> · دروس ثقيلة متتابعة فوق الحد المفضّل: <bdi>{result.scoring.pedagogy.heavy_run_excess}</bdi></p>
              <p>تتابع الشعب لنفس المدرس والمادة والصف: <bdi>{result.scoring.pedagogy.consecutive_section_pairs}</bdi> من <bdi>{result.scoring.pedagogy.possible_section_pairs}</bdi> فرصة.</p>
            </div>}
            <p className="mt-3 text-xs text-gray-500">جولات البحث: {result.statistics.search_runs || 1} — المحاولات: <bdi dir="ltr">{result.statistics.attempts}</bdi> — الرجوعات: <bdi dir="ltr">{result.statistics.backtracks}</bdi> — الزمن: <bdi dir="ltr">{Math.round(result.statistics.elapsed_ms / 1000)} s</bdi></p>
          </section>

          <ProposalGrid result={result} schoolId={schoolId} disabled={loading || applying || savingPreferences || preferencesDirty} onToggleLock={(proposalId) => void toggleProposalLock(proposalId)} />

          {result.status === 'complete' && (
            <section className="rounded-xl border border-indigo-200 bg-white p-4">
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={loading || applying || savingPreferences || preferencesDirty} onClick={() => void reSolveUnlocked()} className="flex items-center gap-2 rounded-lg border border-indigo-300 px-4 py-2 font-bold text-indigo-800 disabled:opacity-50"><RefreshCcw size={18} />إعادة توليد غير المثبت</button>
                <button type="button" disabled={loading || applying || savingPreferences || preferencesDirty} onClick={() => void previewAdoption()} className="flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-2 font-bold text-white disabled:opacity-50"><GitCompareArrows size={18} />مقارنة مع الجدول الحالي / معاينة الاعتماد</button>
              </div>
              <p className="mt-2 text-xs text-gray-500">نسخة البيانات: <bdi dir="ltr">{result.timetable_revision}</bdi> — البصمة: <bdi dir="ltr" className="break-all">{result.proposal_digest}</bdi></p>
            </section>
          )}

          {adoptionPreview && (
            <section className={`rounded-xl border p-4 ${adoptionPreview.can_apply ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'}`}>
              <h3 className="font-bold text-gray-900">مقارنة مع الجدول الحالي</h3>
              <div className="mt-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
                <SolverMetric label="بلا تغيير" value={adoptionPreview.comparison.unchanged} tone="green" />
                <SolverMetric label="منقولة" value={adoptionPreview.comparison.moved} tone="amber" />
                <SolverMetric label="مضافة" value={adoptionPreview.comparison.added} />
                <SolverMetric label="محذوفة" value={adoptionPreview.comparison.removed} tone="red" />
                <SolverMetric label="مثبتة محفوظة" value={adoptionPreview.comparison.locked_preserved} tone="green" />
                <SolverMetric label="حالـية غير صالحة/تاريخية" value={adoptionPreview.current_invalid_entry_count} tone={adoptionPreview.current_invalid_entry_count ? 'amber' : 'green'} />
              </div>
              {adoptionPreview.warnings.map((warning) => <p key={warning} className="mt-2 text-sm text-amber-800">{warning}</p>)}
              {adoptionPreview.blockers.length > 0 && <ul className="mt-3 list-inside list-disc text-sm text-red-800">{adoptionPreview.blockers.map((blocker, index) => <li key={`${blocker.code}:${index}`}>{blocker.message}</li>)}</ul>}
              {adoptionPreview.can_apply && (
                <button type="button" disabled={applying || savingPreferences || preferencesDirty} onClick={() => void applyProposal()} className="mt-4 flex items-center gap-2 rounded-lg bg-emerald-700 px-5 py-3 font-bold text-white disabled:opacity-50">
                  {applying ? <LoaderCircle size={18} className="animate-spin" /> : <CheckCircle2 size={18} />}اعتماد هذا الجدول
                </button>
              )}
            </section>
          )}

          {result.unscheduled.length > 0 && (
            <section className="rounded-xl border border-red-200 bg-red-50 p-4">
              <h3 className="flex items-center gap-2 font-bold text-red-900"><AlertTriangle size={19} />دروس لم يتمكن النظام من جدولتها</h3>
              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                {result.unscheduled.map((item) => (
                  <article key={item.teaching_load_id} className="rounded-lg border border-red-200 bg-white p-3 text-sm">
                    <p className="font-bold text-gray-900">{item.subject_name} — {item.class_name}{item.section_name ? ` / ${item.section_name}` : ''}</p>
                    <p className={`mt-1 ${item.employee_id == null ? 'font-semibold text-amber-800' : 'text-gray-600'}`}>{item.employee_name || 'بدون مدرس'}</p>
                    <p className="mt-1 font-semibold text-red-800">متبقي: <bdi dir="ltr">{item.remaining_count}</bdi></p>
                    <ul className="mt-2 list-inside list-disc text-red-800">{item.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
                  </article>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
