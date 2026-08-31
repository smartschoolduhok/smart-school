import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, RotateCcw, Save, UserRoundCheck } from 'lucide-react';
import {
  clearTeacherTimetableAvailabilityOverride,
  getTeacherTimetableAvailability,
  resetTeacherTimetableAvailability,
  saveTeacherTimetableAvailabilityDay,
  saveTeacherTimetableAvailabilityOverride,
  saveTeacherTimetableConstraints,
} from '../../lib/api';
import {
  TIMETABLE_DAY_NAMES,
  type TeacherAvailabilityPresentationStatus,
  type TimetableTeacherAvailabilityMatrix,
  type TimetableTeacherConstraints,
} from '../../lib/timetable';

interface TeacherOption {
  id: number;
  full_name: string;
  job_title?: string | null;
}

interface TeacherAvailabilityTabProps {
  schoolId: number;
  academicYearId: number;
  teachers: TeacherOption[];
  dataVersion: number;
}

interface ConstraintForm {
  max_periods_per_day: string;
  max_consecutive_periods: string;
  max_working_days: string;
  prefer_compact_schedule: boolean;
  avoid_first_period: boolean;
  avoid_last_period: boolean;
}

const EMPTY_CONSTRAINTS: ConstraintForm = {
  max_periods_per_day: '',
  max_consecutive_periods: '',
  max_working_days: '',
  prefer_compact_schedule: false,
  avoid_first_period: false,
  avoid_last_period: false,
};

const AVAILABILITY_LABELS: Record<TeacherAvailabilityPresentationStatus, string> = {
  available: 'متاح',
  unavailable: 'غير متاح',
  preferred: 'مفضل',
  avoid: 'يفضل تجنبه',
};

function constraintsToForm(constraints: TimetableTeacherConstraints): ConstraintForm {
  return {
    max_periods_per_day: constraints.max_periods_per_day == null ? '' : String(constraints.max_periods_per_day),
    max_consecutive_periods: constraints.max_consecutive_periods == null ? '' : String(constraints.max_consecutive_periods),
    max_working_days: constraints.max_working_days == null ? '' : String(constraints.max_working_days),
    prefer_compact_schedule: Number(constraints.prefer_compact_schedule) === 1,
    avoid_first_period: Number(constraints.avoid_first_period) === 1,
    avoid_last_period: Number(constraints.avoid_last_period) === 1,
  };
}

function SummaryMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
      <p className="text-xs text-gray-500">{label}</p>
      <bdi dir="ltr" className="mt-1 block text-xl font-bold text-gray-900 [unicode-bidi:isolate]">{value}</bdi>
    </div>
  );
}

export function TeacherAvailabilityTab({
  schoolId,
  academicYearId,
  teachers,
  dataVersion,
}: TeacherAvailabilityTabProps) {
  const [selectedTeacherId, setSelectedTeacherId] = useState<number | null>(null);
  const [matrix, setMatrix] = useState<TimetableTeacherAvailabilityMatrix | null>(null);
  const [constraintForm, setConstraintForm] = useState<ConstraintForm>(EMPTY_CONSTRAINTS);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const requestGenerationRef = useRef(0);
  const currentScopeRef = useRef({ schoolId, academicYearId, selectedTeacherId });
  currentScopeRef.current = { schoolId, academicYearId, selectedTeacherId };

  const scopeIsCurrent = useCallback((expectedSchoolId: number, expectedYearId: number, expectedTeacherId: number) => (
    currentScopeRef.current.schoolId === expectedSchoolId
    && currentScopeRef.current.academicYearId === expectedYearId
    && currentScopeRef.current.selectedTeacherId === expectedTeacherId
  ), []);

  const loadTeacherData = useCallback(async (teacherId: number) => {
    const requestSchoolId = schoolId;
    const requestYearId = academicYearId;
    const requestGeneration = ++requestGenerationRef.current;
    setLoading(true);
    setError('');
    const response = await getTeacherTimetableAvailability(requestSchoolId, requestYearId, teacherId);
    if (requestGeneration !== requestGenerationRef.current
      || !scopeIsCurrent(requestSchoolId, requestYearId, teacherId)) return;
    setLoading(false);
    if (response.error || !response.data) {
      setMatrix(null);
      setConstraintForm(EMPTY_CONSTRAINTS);
      setError(response.error || 'تعذر تحميل توفر المدرس');
      return;
    }
    setMatrix(response.data);
    setConstraintForm(constraintsToForm(response.data.constraints));
  }, [academicYearId, schoolId, scopeIsCurrent]);

  useEffect(() => {
    requestGenerationRef.current += 1;
    setSelectedTeacherId(null);
    setMatrix(null);
    setConstraintForm(EMPTY_CONSTRAINTS);
    setLoading(false);
    setSaving(false);
    setError('');
    setSuccess('');
  }, [academicYearId, schoolId]);

  useEffect(() => {
    requestGenerationRef.current += 1;
    setMatrix(null);
    setConstraintForm(EMPTY_CONSTRAINTS);
    setSaving(false);
    setError('');
    setSuccess('');
    if (selectedTeacherId == null) {
      setLoading(false);
      return;
    }
    void loadTeacherData(selectedTeacherId);
  }, [dataVersion, loadTeacherData, selectedTeacherId]);

  async function updateSlot(slotId: number, status: TeacherAvailabilityPresentationStatus) {
    if (selectedTeacherId == null) return;
    const requestSchoolId = schoolId;
    const requestYearId = academicYearId;
    const requestTeacherId = selectedTeacherId;
    setSaving(true);
    setError('');
    const response = status === 'available'
      ? await clearTeacherTimetableAvailabilityOverride(schoolId, academicYearId, selectedTeacherId, slotId)
      : await saveTeacherTimetableAvailabilityOverride({
        school_id: schoolId,
        academic_year_id: academicYearId,
        employee_id: selectedTeacherId,
        slot_id: slotId,
        status,
      });
    if (!scopeIsCurrent(requestSchoolId, requestYearId, requestTeacherId)) return;
    setSaving(false);
    if (response.error) return setError(response.error);
    setSuccess('تم تحديث توفر المدرس');
    await loadTeacherData(requestTeacherId);
  }

  async function updateDay(dayOfWeek: number, status: 'unavailable' | null) {
    if (selectedTeacherId == null) return;
    const requestSchoolId = schoolId;
    const requestYearId = academicYearId;
    const requestTeacherId = selectedTeacherId;
    setSaving(true);
    setError('');
    const response = await saveTeacherTimetableAvailabilityDay({
      school_id: schoolId,
      academic_year_id: academicYearId,
      employee_id: selectedTeacherId,
      day_of_week: dayOfWeek,
      status,
    });
    if (!scopeIsCurrent(requestSchoolId, requestYearId, requestTeacherId)) return;
    setSaving(false);
    if (response.error) return setError(response.error);
    setSuccess(status === null ? 'أعيد اليوم إلى التوفر الافتراضي' : 'تم جعل حصص اليوم غير متاحة');
    await loadTeacherData(requestTeacherId);
  }

  async function resetAvailability() {
    if (selectedTeacherId == null || !window.confirm('سيتم حذف جميع استثناءات توفر هذا المدرس وإعادتها إلى متاح. هل تريد المتابعة؟')) return;
    const requestSchoolId = schoolId;
    const requestYearId = academicYearId;
    const requestTeacherId = selectedTeacherId;
    setSaving(true);
    const response = await resetTeacherTimetableAvailability(schoolId, academicYearId, selectedTeacherId);
    if (!scopeIsCurrent(requestSchoolId, requestYearId, requestTeacherId)) return;
    setSaving(false);
    if (response.error) return setError(response.error);
    setSuccess('تمت إعادة ضبط توفر المدرس');
    await loadTeacherData(requestTeacherId);
  }

  async function submitConstraints(event: React.FormEvent) {
    event.preventDefault();
    if (selectedTeacherId == null) return;
    const requestSchoolId = schoolId;
    const requestYearId = academicYearId;
    const requestTeacherId = selectedTeacherId;
    setSaving(true);
    setError('');
    const response = await saveTeacherTimetableConstraints({
      school_id: schoolId,
      academic_year_id: academicYearId,
      employee_id: selectedTeacherId,
      max_periods_per_day: constraintForm.max_periods_per_day ? Number(constraintForm.max_periods_per_day) : null,
      max_consecutive_periods: constraintForm.max_consecutive_periods ? Number(constraintForm.max_consecutive_periods) : null,
      max_working_days: constraintForm.max_working_days ? Number(constraintForm.max_working_days) : null,
      prefer_compact_schedule: constraintForm.prefer_compact_schedule ? 1 : 0,
      avoid_first_period: constraintForm.avoid_first_period ? 1 : 0,
      avoid_last_period: constraintForm.avoid_last_period ? 1 : 0,
    });
    if (!scopeIsCurrent(requestSchoolId, requestYearId, requestTeacherId)) return;
    setSaving(false);
    if (response.error) return setError(response.error);
    setSuccess('تم حفظ قيود المدرس');
    await loadTeacherData(requestTeacherId);
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <label htmlFor="timetable-availability-teacher" className="mb-2 block text-sm font-semibold text-gray-700">المدرس</label>
        <select
          id="timetable-availability-teacher"
          value={selectedTeacherId ?? ''}
          onChange={(event) => setSelectedTeacherId(event.target.value ? Number(event.target.value) : null)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2.5 md:w-96"
        >
          <option value="">اختر مدرسًا</option>
          {teachers.map((teacher) => (
            <option key={teacher.id} value={teacher.id}>{teacher.full_name}{teacher.job_title ? ` — ${teacher.job_title}` : ''}</option>
          ))}
        </select>
      </div>

      {error && <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"><AlertTriangle size={18} />{error}</div>}
      {success && <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"><CheckCircle2 size={18} />{success}</div>}
      {selectedTeacherId == null && <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-gray-500">اختر مدرسًا لعرض مصفوفة التوفر والقيود.</div>}
      {loading && <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-gray-500">جاري تحميل توفر المدرس...</div>}

      {!loading && matrix && (
        <>
          <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 font-bold text-gray-900"><UserRoundCheck size={18} />مصفوفة التوفر الأسبوعية</h2>
                <p className="mt-1 text-xs text-gray-500">عدم وجود استثناء يعني أن الحصة متاحة. الاستراحات غير قابلة للتعديل.</p>
              </div>
              <button type="button" disabled={saving} onClick={() => void resetAvailability()} className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 disabled:opacity-50"><RotateCcw size={16} />إعادة ضبط التوفر</button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead><tr className="border-b bg-gray-50 text-right text-gray-600"><th className="p-3">اليوم</th><th className="p-3">الفترات</th><th className="p-3">إجراءات سريعة</th></tr></thead>
                <tbody>{matrix.days.map((day) => (
                  <tr key={day.id} className="border-b align-top last:border-0">
                    <td className="p-3 font-bold">{TIMETABLE_DAY_NAMES[day.day_of_week]}{Number(day.is_active) !== 1 && <span className="mr-2 rounded bg-gray-100 px-2 py-1 text-xs font-normal text-gray-500">اليوم معطل</span>}</td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-2">
                        {day.slots.length === 0 && <span className="text-gray-400">لا توجد فترات</span>}
                        {day.slots.map((slot) => slot.slot_type === 'break' ? (
                          <div key={slot.id} className="min-w-40 rounded-lg border border-dashed border-amber-300 bg-amber-50 p-2 text-amber-800">
                            <p className="font-semibold">{slot.label}</p><p className="text-xs">استراحة — غير قابلة للتعديل</p>
                          </div>
                        ) : (
                          <label key={slot.id} className={`min-w-44 rounded-lg border p-2 ${slot.effectively_schedulable ? 'border-gray-200' : 'border-gray-200 bg-gray-50'}`}>
                            <span className="mb-1 block font-semibold">{slot.label}</span>
                            <select
                              value={slot.presentation_status}
                              disabled={saving}
                              onChange={(event) => void updateSlot(slot.id, event.target.value as TeacherAvailabilityPresentationStatus)}
                              className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-xs disabled:opacity-50"
                            >
                              {Object.entries(AVAILABILITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                            </select>
                            {(Number(day.is_active) !== 1 || Number(slot.is_active) !== 1) && <span className="mt-1 block text-[11px] text-gray-500">محفوظ، لكنه لا يدخل في السعة الحالية</span>}
                          </label>
                        ))}
                      </div>
                    </td>
                    <td className="p-3"><div className="flex min-w-44 flex-col gap-2"><button type="button" disabled={saving} onClick={() => void updateDay(day.day_of_week, null)} className="rounded-lg border border-emerald-300 px-3 py-2 text-xs font-semibold text-emerald-700 disabled:opacity-50">جعل اليوم متاحاً</button><button type="button" disabled={saving} onClick={() => void updateDay(day.day_of_week, 'unavailable')} className="rounded-lg border border-red-300 px-3 py-2 text-xs font-semibold text-red-700 disabled:opacity-50">جعل اليوم غير متاح</button></div></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </section>

          <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="font-bold text-gray-900">ملخص توفر المدرس</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <SummaryMetric label="النصاب الأسبوعي المسند" value={matrix.summary.assigned_weekly_periods} />
              <SummaryMetric label="السعة المتاحة" value={matrix.summary.effective_available_slots} />
              <SummaryMetric label="السعة القصوى بعد القيود" value={matrix.summary.hard_weekly_capacity} />
              <div className={`rounded-xl border p-3 ${matrix.summary.feasible ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'}`}><p className="text-xs">الحالة</p><p className="mt-1 text-xl font-bold">{matrix.summary.feasible ? 'ممكن' : 'غير ممكن'}</p></div>
            </div>
            {matrix.summary.blockers.map((blocker) => <div key={blocker.code} className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-800"><AlertTriangle size={18} />{blocker.message}</div>)}
            <p className="text-xs text-gray-500">الفترات المفضلة: <bdi dir="ltr">{matrix.summary.preferred_slots}</bdi> — الفترات التي يفضل تجنبها: <bdi dir="ltr">{matrix.summary.avoid_slots}</bdi></p>
          </section>

          <form onSubmit={submitConstraints} className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
            <div><h2 className="font-bold text-gray-900">قيود المدرس</h2><p className="mt-1 text-xs text-gray-500">ترك الحد فارغًا يعني عدم وجود حد خاص بالمدرس. حد الحصص المتتالية محفوظ للمحرك المستقبلي ولا يثبت قابلية الحل الكاملة في هذه المرحلة.</p></div>
            <div className="grid gap-3 md:grid-cols-3">
              <label className="text-sm font-medium text-gray-700">الحد الأقصى للحصص يومياً<input type="number" min="1" value={constraintForm.max_periods_per_day} onChange={(event) => setConstraintForm({ ...constraintForm, max_periods_per_day: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" /></label>
              <label className="text-sm font-medium text-gray-700">الحد الأقصى للحصص المتتالية<input type="number" min="1" value={constraintForm.max_consecutive_periods} onChange={(event) => setConstraintForm({ ...constraintForm, max_consecutive_periods: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" /></label>
              <label className="text-sm font-medium text-gray-700">الحد الأقصى لأيام العمل أسبوعياً<input type="number" min="1" max="7" value={constraintForm.max_working_days} onChange={(event) => setConstraintForm({ ...constraintForm, max_working_days: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" /></label>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={constraintForm.prefer_compact_schedule} onChange={(event) => setConstraintForm({ ...constraintForm, prefer_compact_schedule: event.target.checked })} />يفضل تجميع الحصص</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={constraintForm.avoid_first_period} onChange={(event) => setConstraintForm({ ...constraintForm, avoid_first_period: event.target.checked })} />يفضل تجنب الحصة الأولى</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={constraintForm.avoid_last_period} onChange={(event) => setConstraintForm({ ...constraintForm, avoid_last_period: event.target.checked })} />يفضل تجنب الحصة الأخيرة</label>
            </div>
            <button disabled={saving} className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 font-semibold text-white disabled:opacity-50"><Save size={18} />حفظ قيود المدرس</button>
          </form>
        </>
      )}
    </div>
  );
}
