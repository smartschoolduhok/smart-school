import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, LoaderCircle, Sparkles, WandSparkles } from 'lucide-react';
import { useSchoolRequestGuard } from '../../hooks/useSchoolRequestGuard';
import { previewAutomaticTimetable } from '../../lib/api';
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
  TimetableSolverProposalEntry,
  TimetableSolverStatus,
} from '../../lib/timetableSolver';

interface AutomaticTimetableTabProps {
  schoolId: number;
  academicYearId: number;
  dataVersion: number;
  readiness: TimetableReadinessSummary | null;
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
};

const PENALTY_LABELS: Record<keyof TimetableSolverPenaltyBreakdown, string> = {
  avoid_slots: 'فترات مفضّل تجنبها',
  outside_preferred_slots: 'خارج الفترات المفضلة',
  teacher_gaps: 'فجوات جدول المدرس',
  first_period_preferences: 'تفضيل تجنب الحصة الأولى',
  last_period_preferences: 'تفضيل تجنب الحصة الأخيرة',
  subject_clustering: 'تجميع المادة في يوم واحد',
  consecutive_same_subject: 'تكرار متتالٍ للمادة',
  class_daily_imbalance: 'عدم توازن الحمل اليومي',
};

function proposalEntryForPlacement(
  entries: TimetableSolverProposalEntry[],
  slotId: number,
  placement: TimetablePlacement,
) {
  const candidates = entries.filter((entry) => (
    Number(entry.slot_id) === Number(slotId)
    && Number(entry.class_id) === Number(placement.class_id)
    && (entry.section_id == null || Number(entry.section_id) === Number(placement.section_id))
  ));
  return candidates.find((entry) => (
    placement.section_id != null && Number(entry.section_id) === Number(placement.section_id)
  )) || candidates.find((entry) => entry.section_id == null) || null;
}

function placementLabel(placement: TimetablePlacement) {
  return `${placement.class_name}${placement.section_name ? ` / ${placement.section_name}` : ''}`;
}

function slotLabel(slot: TimetableSlot) {
  if (slot.slot_type === 'break') return slot.label || 'استراحة';
  return slot.label || `الحصة ${slot.lesson_number || slot.slot_index}`;
}

function ProposalGrid({ result, schoolId }: { result: TimetableSolverPreview; schoolId: number }) {
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
                        const entry = proposalEntryForPlacement(result.entries, slot.id, placement);
                        if (!entry) return <td key={timetablePlacementKey(placement)} className="border-b border-l border-gray-200 bg-white p-2" />;
                        const color = timetableSubjectColorForSubject(schoolId, entry.subject_name);
                        return (
                          <td key={timetablePlacementKey(placement)} className="border-b border-l border-gray-200 p-2">
                            <div className="min-h-20 rounded-lg border-r-4 p-2" style={{ backgroundColor: color.background, borderColor: color.border, color: color.foreground }}>
                              <p className="font-bold">{entry.subject_name}</p>
                              <p className={`mt-1 ${entry.employee_id == null ? 'font-bold text-amber-800' : 'opacity-80'}`}>{entry.employee_name || 'بدون مدرس'}</p>
                              {entry.soft_warnings.length > 0 && <p className="mt-1 text-[10px] opacity-75">{entry.soft_warnings.map((warning) => warning.message).join('، ')}</p>}
                            </div>
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
  schoolId,
  academicYearId,
  dataVersion,
  readiness,
}: AutomaticTimetableTabProps) {
  const captureSchoolRequest = useSchoolRequestGuard(schoolId);
  const requestGenerationRef = useRef(0);
  const scopeRef = useRef({ schoolId, academicYearId, dataVersion });
  scopeRef.current = { schoolId, academicYearId, dataVersion };
  const [result, setResult] = useState<TimetableSolverPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    requestGenerationRef.current += 1;
    setResult(null);
    setLoading(false);
    setError('');
    return () => { requestGenerationRef.current += 1; };
  }, [academicYearId, dataVersion, schoolId]);

  async function generateProposal() {
    const generation = ++requestGenerationRef.current;
    const expectedScope = { schoolId, academicYearId, dataVersion };
    const isCurrentSchool = captureSchoolRequest();
    setLoading(true);
    setResult(null);
    setError('');
    const response = await previewAutomaticTimetable(schoolId, academicYearId);
    if (
      generation !== requestGenerationRef.current
      || !isCurrentSchool()
      || scopeRef.current.schoolId !== expectedScope.schoolId
      || scopeRef.current.academicYearId !== expectedScope.academicYearId
      || scopeRef.current.dataVersion !== expectedScope.dataVersion
    ) return;
    setLoading(false);
    if (response.error) {
      setError(response.error);
      return;
    }
    setResult(response.data || null);
  }

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-indigo-200 bg-gradient-to-l from-indigo-50 to-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold text-indigo-950"><WandSparkles size={22} />التوليد التلقائي</h2>
            <p className="mt-1 max-w-3xl text-sm text-indigo-800">يحلل النظام السعة والأنصبة وتوفر المدرسين وقيودهم، ثم ينشئ اقتراحًا حتميًا للمدرسة كاملة.</p>
            <p className="mt-2 flex items-center gap-2 text-sm font-semibold text-amber-800"><AlertTriangle size={17} />هذا اقتراح جديد ولن يغيّر الجدول الحالي حتى يتم اعتماده.</p>
          </div>
          <button
            type="button"
            disabled={loading}
            onClick={() => void generateProposal()}
            className="flex items-center gap-2 rounded-lg bg-indigo-700 px-5 py-3 font-bold text-white shadow-sm hover:bg-indigo-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? <LoaderCircle size={19} className="animate-spin" /> : <Sparkles size={19} />}
            {loading ? 'جاري بناء الاقتراح...' : 'إنشاء جدول تلقائي'}
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h3 className="mb-3 font-bold text-gray-900">ملخص الجاهزية قبل التوليد</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SolverMetric label="السعة الأسبوعية لكل شعبة" value={readiness?.weekly_capacity || 0} />
          <SolverMetric label="الحصص المطلوبة" value={readiness?.total_required_periods || 0} tone="green" />
          <SolverMetric label="أنصبة بلا مدرس" value={readiness?.missing_teacher_count || 0} tone={readiness?.missing_teacher_count ? 'amber' : 'green'} />
          <SolverMetric label="مراجع غير صالحة" value={readiness?.invalid_reference_count || 0} tone={readiness?.invalid_reference_count ? 'red' : 'green'} />
        </div>
      </section>

      {error && <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-800"><AlertTriangle size={19} />{error}</div>}

      {result && (
        <>
          <section className={`rounded-xl border p-4 ${STATUS_PRESENTATION[result.status].classes}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2"><CheckCircle2 size={21} /><span className="font-bold">{STATUS_PRESENTATION[result.status].label}</span></div>
              <span className="rounded-full border border-current px-3 py-1 text-xs font-bold">معاينة — غير معتمدة</span>
            </div>
          </section>

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

          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-bold text-gray-900">تفاصيل درجة الجودة</h3>
              <p className="text-xs text-gray-500">{result.scoring.note}</p>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {(Object.entries(result.scoring.penalties) as Array<[keyof TimetableSolverPenaltyBreakdown, number]>).map(([key, value]) => (
                <div key={key} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-sm"><span>{PENALTY_LABELS[key]}</span><bdi dir="ltr" className="font-bold [unicode-bidi:isolate]">{value}</bdi></div>
              ))}
            </div>
            <p className="mt-3 text-xs text-gray-500">المحاولات: <bdi dir="ltr">{result.statistics.attempts}</bdi> — الرجوعات: <bdi dir="ltr">{result.statistics.backtracks}</bdi> — الزمن: <bdi dir="ltr">{result.statistics.elapsed_ms} ms</bdi></p>
          </section>

          <ProposalGrid result={result} schoolId={schoolId} />

          {result.unscheduled.length > 0 && (
            <section className="rounded-xl border border-red-200 bg-red-50 p-4">
              <h3 className="flex items-center gap-2 font-bold text-red-900"><AlertTriangle size={19} />حصص لم يتمكن النظام من جدولتها</h3>
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
