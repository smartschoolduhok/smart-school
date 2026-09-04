import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BookOpenCheck,
  CalendarDays,
  CheckCircle2,
  Clock3,
  History,
  LayoutGrid,
  Pencil,
  Plus,
  Save,
  Sparkles,
  Trash2,
  UserRoundCheck,
  X,
} from 'lucide-react';
import { SystemAdminSchoolSelector } from '../../components/SystemAdminSchoolSelector';
import { useSchoolRequestGuard } from '../../hooks/useSchoolRequestGuard';
import { useTenantSchool } from '../../hooks/useTenantSchool';
import {
  createTimetableSlot,
  createTimetableTeachingLoad,
  deactivateTimetableTeachingLoad,
  deleteTimetableSlot,
  getAcademicYears,
  getClasses,
  getEmployees,
  getSections,
  getSubjects,
  getTimetableDays,
  getTimetableReadiness,
  getTimetableSlots,
  getTimetableTeachingLoads,
  saveTimetableDay,
  updateTimetableSlot,
  updateTimetableTeachingLoad,
} from '../../lib/api';
import type { AcademicYearRecord } from '../../lib/academicYears';
import {
  calculateWeeklyCapacity,
  TIMETABLE_DAY_NAMES,
  type TimetableDay,
  type TimetableReadinessSummary,
  type TimetableSlot,
  type TimetableTeachingLoad,
} from '../../lib/timetable';
import type { Class, Section } from '../../types';
import { TeacherAvailabilityTab } from './TeacherAvailabilityTab';
import { AutomaticTimetableTab } from './AutomaticTimetableTab';
import { MasterTimetableTab } from './MasterTimetableTab';
import { TimetableGridTab } from './TimetableGridTab';
import { TimetableVersionsTab } from './TimetableVersionsTab';

type TabKey = 'grid' | 'master' | 'automatic' | 'versions' | 'week' | 'loads' | 'availability' | 'readiness';

interface SubjectOption {
  id: number;
  school_id: number;
  class_id: number;
  section_id: number | null;
  name: string;
  status: string;
}

interface EmployeeOption {
  id: number;
  school_id: number;
  full_name: string;
  role: string;
  job_title?: string | null;
  status: string;
}

interface SlotForm {
  id: number | null;
  day_of_week: number;
  slot_index: string;
  slot_type: 'lesson' | 'break';
  lesson_number: string;
  label: string;
  start_time: string;
  end_time: string;
  is_active: 0 | 1;
}

interface LoadForm {
  id: number | null;
  class_id: string;
  section_id: string;
  subject_id: string;
  employee_id: string;
  weekly_periods: string;
}

const EMPTY_SLOT: SlotForm = {
  id: null,
  day_of_week: 0,
  slot_index: '1',
  slot_type: 'lesson',
  lesson_number: '1',
  label: 'الحصة الأولى',
  start_time: '08:00',
  end_time: '08:40',
  is_active: 1,
};

const EMPTY_LOAD: LoadForm = {
  id: null,
  class_id: '',
  section_id: '',
  subject_id: '',
  employee_id: '',
  weekly_periods: '',
};

function YearValue({ value }: { value: string }) {
  return <bdi dir="ltr" className="inline-block [unicode-bidi:isolate]">{value}</bdi>;
}

function Metric({ label, value, tone = 'blue' }: { label: string; value: number; tone?: 'blue' | 'green' | 'amber' | 'red' }) {
  const colors = {
    blue: 'border-blue-200 bg-blue-50 text-blue-800',
    green: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    amber: 'border-amber-200 bg-amber-50 text-amber-800',
    red: 'border-red-200 bg-red-50 text-red-800',
  };
  return (
    <div className={`rounded-xl border p-4 ${colors[tone]}`}>
      <p className="text-xs font-medium opacity-80">{label}</p>
      <bdi dir="ltr" className="mt-1 block text-2xl font-bold [unicode-bidi:isolate]">{value}</bdi>
    </div>
  );
}

function readinessLabel(status: string) {
  if (status === 'empty_week') return 'لا توجد سعة أسبوعية';
  if (status === 'over_capacity') return 'تجاوز السعة';
  if (status === 'exact') return 'مكتمل';
  return 'حصص غير موزعة';
}

export default function TimetablePage() {
  const schoolScope = useTenantSchool();
  const { schoolId } = schoolScope;
  const captureSchoolRequest = useSchoolRequestGuard(schoolId);
  const requestGenerationRef = useRef(0);
  const [tab, setTab] = useState<TabKey>('grid');
  const [years, setYears] = useState<AcademicYearRecord[]>([]);
  const [academicYearId, setAcademicYearId] = useState<number | null>(null);
  const [classes, setClasses] = useState<Class[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [subjects, setSubjects] = useState<SubjectOption[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [days, setDays] = useState<TimetableDay[]>([]);
  const [slots, setSlots] = useState<TimetableSlot[]>([]);
  const [loads, setLoads] = useState<TimetableTeachingLoad[]>([]);
  const [readiness, setReadiness] = useState<TimetableReadinessSummary | null>(null);
  const [yearDataVersion, setYearDataVersion] = useState(0);
  const [selectedClassId, setSelectedClassId] = useState<number | null>(null);
  const [selectedSectionId, setSelectedSectionId] = useState<number | null>(null);
  const [slotForm, setSlotForm] = useState<SlotForm | null>(null);
  const [loadForm, setLoadForm] = useState<LoadForm>(EMPTY_LOAD);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const currentScopeRef = useRef({ schoolId, academicYearId });
  currentScopeRef.current = { schoolId, academicYearId };

  function scopeIsCurrent(expectedSchoolId: number, expectedAcademicYearId: number) {
    return currentScopeRef.current.schoolId === expectedSchoolId
      && currentScopeRef.current.academicYearId === expectedAcademicYearId;
  }

  useEffect(() => {
    requestGenerationRef.current += 1;
    setYears([]);
    setAcademicYearId(null);
    setClasses([]);
    setSections([]);
    setSubjects([]);
    setEmployees([]);
    setDays([]);
    setSlots([]);
    setLoads([]);
    setReadiness(null);
    setYearDataVersion((value) => value + 1);
    setSelectedClassId(null);
    setSelectedSectionId(null);
    setSlotForm(null);
    setLoadForm(EMPTY_LOAD);
    setSaving(false);
    setError('');
    setSuccess('');
    if (schoolId == null) {
      setLoading(false);
      return;
    }

    const isCurrentSchool = captureSchoolRequest();
    setLoading(true);
    void Promise.all([
      getAcademicYears(schoolId),
      getClasses(schoolId),
      getSections(schoolId),
      getSubjects(schoolId),
      getEmployees(schoolId),
    ]).then(([yearResponse, classResponse, sectionResponse, subjectResponse, employeeResponse]) => {
      if (!isCurrentSchool()) return;
      const loadError = yearResponse.error || classResponse.error || sectionResponse.error || subjectResponse.error || employeeResponse.error;
      if (loadError) {
        setError(loadError);
        setLoading(false);
        return;
      }
      const scopedYears = (yearResponse.data || []).filter((year) => Number(year.school_id) === schoolId);
      setYears(scopedYears);
      setAcademicYearId(scopedYears.find((year) => Number(year.is_active) === 1)?.id ?? null);
      setClasses(((classResponse.data || []) as Class[]).filter((item) => Number(item.school_id) === schoolId && item.status === 'active'));
      setSections(((sectionResponse.data || []) as Section[]).filter((item) => Number(item.school_id) === schoolId && item.status === 'active'));
      setSubjects(((subjectResponse.data || []) as SubjectOption[]).filter((item) => Number(item.school_id) === schoolId));
      setEmployees(((employeeResponse.data || []) as EmployeeOption[]).filter((item) => Number(item.school_id) === schoolId));
      setLoading(false);
    });
  }, [captureSchoolRequest, schoolId]);

  const reloadYearData = useCallback(async () => {
    if (schoolId == null || academicYearId == null) return;
    const requestGeneration = ++requestGenerationRef.current;
    const isCurrentSchool = captureSchoolRequest();
    setLoading(true);
    setError('');
    const responses = await Promise.all([
      getTimetableDays(schoolId, academicYearId),
      getTimetableSlots(schoolId, academicYearId),
      getTimetableTeachingLoads(schoolId, academicYearId),
      getTimetableReadiness(schoolId, academicYearId),
    ]);
    if (requestGeneration !== requestGenerationRef.current || !isCurrentSchool()) return;
    const loadError = responses.find((response) => response.error)?.error;
    if (loadError) {
      setError(loadError);
      setLoading(false);
      return;
    }
    setDays(responses[0].data || []);
    setSlots(responses[1].data || []);
    setLoads(responses[2].data || []);
    setReadiness(responses[3].data || null);
    setYearDataVersion((value) => value + 1);
    setLoading(false);
  }, [academicYearId, captureSchoolRequest, schoolId]);

  useEffect(() => {
    requestGenerationRef.current += 1;
    setDays([]);
    setSlots([]);
    setLoads([]);
    setReadiness(null);
    setYearDataVersion((value) => value + 1);
    setSelectedClassId(null);
    setSelectedSectionId(null);
    setSlotForm(null);
    setLoadForm(EMPTY_LOAD);
    setSaving(false);
    if (academicYearId != null) void reloadYearData();
  }, [academicYearId, reloadYearData]);

  const activeSections = useMemo(
    () => sections.filter((section) => selectedClassId != null && Number(section.class_id) === selectedClassId),
    [sections, selectedClassId],
  );
  const applicableSubjects = useMemo(() => subjects.filter((subject) => (
    subject.status === 'active'
    && selectedClassId != null
    && Number(subject.class_id) === selectedClassId
    && (subject.section_id == null || Number(subject.section_id) === selectedSectionId)
  )), [selectedClassId, selectedSectionId, subjects]);
  const filteredLoads = useMemo(() => loads.filter((load) => (
    load.status === 'active'
    && (selectedClassId == null || Number(load.class_id) === selectedClassId)
    && (selectedSectionId == null || Number(load.section_id) === selectedSectionId)
  )), [loads, selectedClassId, selectedSectionId]);
  const teacherCandidates = useMemo(() => employees.filter((employee) => (
    employee.status === 'active'
    && employee.role === 'teacher'
  )), [employees]);
  const weekMetrics = calculateWeeklyCapacity(days, slots);

  async function handleDayChange(dayOfWeek: number, changes: Partial<{ is_active: 0 | 1; order_index: number }>) {
    if (schoolId == null || academicYearId == null) return;
    const requestSchoolId = schoolId;
    const requestAcademicYearId = academicYearId;
    const existing = days.find((day) => day.day_of_week === dayOfWeek);
    setSaving(true);
    const response = await saveTimetableDay({
      school_id: schoolId,
      academic_year_id: academicYearId,
      day_of_week: dayOfWeek,
      is_active: changes.is_active ?? existing?.is_active ?? 0,
      order_index: changes.order_index ?? existing?.order_index ?? dayOfWeek,
    });
    if (!scopeIsCurrent(requestSchoolId, requestAcademicYearId)) return;
    setSaving(false);
    if (response.error) return setError(response.error);
    setSuccess('تم حفظ إعداد يوم الدوام');
    await reloadYearData();
  }

  function beginSlot(dayOfWeek: number, slot?: TimetableSlot) {
    const daySlots = slots.filter((item) => item.day_of_week === dayOfWeek);
    setSlotForm(slot ? {
      id: slot.id,
      day_of_week: slot.day_of_week,
      slot_index: String(slot.slot_index),
      slot_type: slot.slot_type,
      lesson_number: slot.lesson_number == null ? '' : String(slot.lesson_number),
      label: slot.label,
      start_time: slot.start_time,
      end_time: slot.end_time,
      is_active: slot.is_active,
    } : {
      ...EMPTY_SLOT,
      day_of_week: dayOfWeek,
      slot_index: String(daySlots.length + 1),
      lesson_number: String(daySlots.filter((item) => item.slot_type === 'lesson').length + 1),
    });
  }

  async function submitSlot(event: React.FormEvent) {
    event.preventDefault();
    if (schoolId == null || academicYearId == null || slotForm == null) return;
    const requestSchoolId = schoolId;
    const requestAcademicYearId = academicYearId;
    setSaving(true);
    const payload = {
      school_id: schoolId,
      academic_year_id: academicYearId,
      day_of_week: slotForm.day_of_week,
      slot_index: Number(slotForm.slot_index),
      slot_type: slotForm.slot_type,
      lesson_number: slotForm.slot_type === 'lesson' ? Number(slotForm.lesson_number) : null,
      label: slotForm.label,
      start_time: slotForm.start_time,
      end_time: slotForm.end_time,
      is_active: slotForm.is_active,
    };
    const response = slotForm.id == null
      ? await createTimetableSlot(payload)
      : await updateTimetableSlot(slotForm.id, payload);
    if (!scopeIsCurrent(requestSchoolId, requestAcademicYearId)) return;
    setSaving(false);
    if (response.error) return setError(response.error);
    setSlotForm(null);
    setSuccess('تم حفظ فترة الجدول');
    await reloadYearData();
  }

  async function removeSlot(slot: TimetableSlot) {
    if (schoolId == null || academicYearId == null || !window.confirm('هل تريد حذف هذه الفترة؟')) return;
    const requestSchoolId = schoolId;
    const requestAcademicYearId = academicYearId;
    const response = await deleteTimetableSlot(slot.id, schoolId, academicYearId);
    if (!scopeIsCurrent(requestSchoolId, requestAcademicYearId)) return;
    if (response.error) return setError(response.error);
    setSlotForm(null);
    setSuccess('تم حذف الفترة');
    await reloadYearData();
  }

  function beginLoad(load?: TimetableTeachingLoad) {
    if (load) {
      setSelectedClassId(load.class_id);
      setSelectedSectionId(load.section_id);
      setLoadForm({
        id: load.id,
        class_id: String(load.class_id),
        section_id: load.section_id == null ? '' : String(load.section_id),
        subject_id: String(load.subject_id),
        employee_id: load.employee_id == null ? '' : String(load.employee_id),
        weekly_periods: String(load.weekly_periods),
      });
    } else {
      setLoadForm({
        ...EMPTY_LOAD,
        class_id: selectedClassId == null ? '' : String(selectedClassId),
        section_id: selectedSectionId == null ? '' : String(selectedSectionId),
      });
    }
  }

  async function submitLoad(event: React.FormEvent) {
    event.preventDefault();
    if (schoolId == null || academicYearId == null) return;
    const requestSchoolId = schoolId;
    const requestAcademicYearId = academicYearId;
    const payload = {
      school_id: schoolId,
      academic_year_id: academicYearId,
      class_id: Number(loadForm.class_id),
      section_id: loadForm.section_id ? Number(loadForm.section_id) : null,
      subject_id: Number(loadForm.subject_id),
      employee_id: loadForm.employee_id ? Number(loadForm.employee_id) : null,
      weekly_periods: Number(loadForm.weekly_periods),
    };
    setSaving(true);
    const response = loadForm.id == null
      ? await createTimetableTeachingLoad(payload)
      : await updateTimetableTeachingLoad(loadForm.id, payload);
    if (!scopeIsCurrent(requestSchoolId, requestAcademicYearId)) return;
    setSaving(false);
    if (response.error) return setError(response.error);
    setLoadForm({ ...EMPTY_LOAD, class_id: loadForm.class_id, section_id: loadForm.section_id });
    setSuccess('تم حفظ نصاب المادة');
    await reloadYearData();
  }

  async function removeLoad(load: TimetableTeachingLoad) {
    if (schoolId == null || academicYearId == null || !window.confirm('سيتم تعطيل هذا النصاب مع الاحتفاظ بسجله. هل تريد المتابعة؟')) return;
    const requestSchoolId = schoolId;
    const requestAcademicYearId = academicYearId;
    const response = await deactivateTimetableTeachingLoad(load.id, schoolId, academicYearId);
    if (!scopeIsCurrent(requestSchoolId, requestAcademicYearId)) return;
    if (response.error) return setError(response.error);
    setLoadForm(EMPTY_LOAD);
    setSuccess('تم تعطيل النصاب');
    await reloadYearData();
  }

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
            <CalendarDays className="text-primary-600" /> الجدول الدراسي
          </h1>
          <p className="mt-1 text-sm text-gray-500">إعداد الأسبوع وأنصبة المواد والتحقق من جاهزية البيانات قبل بناء الجدول.</p>
        </div>
      </div>

      <SystemAdminSchoolSelector {...schoolScope} />

      {error && <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"><AlertTriangle size={18} />{error}<button className="mr-auto" onClick={() => setError('')}><X size={16} /></button></div>}
      {success && <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"><CheckCircle2 size={18} />{success}<button className="mr-auto" onClick={() => setSuccess('')}><X size={16} /></button></div>}

      {schoolId == null ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center text-gray-500">اختر مدرسة نشطة للبدء.</div>
      ) : (
        <>
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <label htmlFor="timetable-academic-year" className="mb-2 block text-sm font-semibold text-gray-700">السنة الدراسية</label>
            <select
              id="timetable-academic-year"
              value={academicYearId ?? ''}
              onChange={(event) => setAcademicYearId(event.target.value ? Number(event.target.value) : null)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 md:w-80"
            >
              <option value="">اختر سنة دراسية</option>
              {years.map((year) => <option key={year.id} value={year.id}>{year.name}{Number(year.is_active) === 1 ? ' — الحالية' : ''}</option>)}
            </select>
            {academicYearId != null && <p className="mt-2 text-xs text-gray-500">السنة المحددة: <YearValue value={years.find((year) => year.id === academicYearId)?.name || ''} /></p>}
          </div>

          {academicYearId == null ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-center text-amber-800">اختر سنة دراسية لعرض إعدادات الجدول.</div>
          ) : (
            <>
              <div className="flex flex-wrap gap-2 border-b border-gray-200">
                {([
                  ['grid', 'الجدول الأسبوعي', CalendarDays],
                  ['master', 'الجدول الكامل', LayoutGrid],
                  ['automatic', 'التوليد التلقائي', Sparkles],
                  ['versions', 'إصدارات الجدول', History],
                  ['week', 'إعداد الأسبوع', Clock3],
                  ['loads', 'نصاب المواد والمدرسين', BookOpenCheck],
                  ['availability', 'توفر المدرسين والقيود', UserRoundCheck],
                  ['readiness', 'التحقق من الجاهزية', CheckCircle2],
                ] as const).map(([key, label, Icon]) => (
                  <button key={key} onClick={() => setTab(key)} className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold ${tab === key ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
                    <Icon size={18} />{label}
                  </button>
                ))}
              </div>

              {loading && <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-gray-500">جاري تحميل إعدادات الجدول...</div>}

              {!loading && tab === 'week' && (
                <div className="space-y-5">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Metric label="أيام الدوام" value={weekMetrics.teachingDays} />
                    <Metric label="إجمالي الحصص الأسبوعية" value={weekMetrics.lessonSlots} tone="green" />
                    <Metric label="فترات الاستراحة" value={weekMetrics.breakSlots} tone="amber" />
                  </div>
                  {TIMETABLE_DAY_NAMES.map((name, dayOfWeek) => {
                    const day = days.find((item) => item.day_of_week === dayOfWeek);
                    const daySlots = slots.filter((item) => item.day_of_week === dayOfWeek);
                    const active = Number(day?.is_active || 0) === 1;
                    return (
                      <section key={name} className={`rounded-xl border bg-white ${active ? 'border-primary-200' : 'border-gray-200'}`}>
                        <div className="flex flex-wrap items-center gap-4 border-b border-gray-100 p-4">
                          <label className="flex items-center gap-3 font-bold text-gray-900">
                            <input type="checkbox" checked={active} disabled={saving} onChange={(event) => void handleDayChange(dayOfWeek, { is_active: event.target.checked ? 1 : 0 })} className="h-4 w-4" />
                            {name}
                          </label>
                          <label className="mr-auto flex items-center gap-2 text-sm text-gray-600">الترتيب
                            <input type="number" min="0" value={day?.order_index ?? dayOfWeek} onChange={(event) => void handleDayChange(dayOfWeek, { order_index: Number(event.target.value) })} className="w-20 rounded-lg border border-gray-300 px-2 py-1" />
                          </label>
                          {active && <button onClick={() => beginSlot(dayOfWeek)} className="flex items-center gap-1 rounded-lg bg-primary-600 px-3 py-2 text-sm font-semibold text-white"><Plus size={16} />إضافة فترة</button>}
                        </div>
                        {active && (
                          <div className="overflow-x-auto p-4">
                            {daySlots.length === 0 ? <p className="py-4 text-center text-sm text-amber-700">لا توجد حصص أو استراحات لهذا اليوم.</p> : (
                              <table className="w-full min-w-[620px] text-sm">
                                <thead><tr className="border-b text-right text-gray-500"><th className="p-2">الترتيب</th><th className="p-2">النوع</th><th className="p-2">الاسم</th><th className="p-2">الوقت</th><th className="p-2">إجراء</th></tr></thead>
                                <tbody>{daySlots.map((slot) => <tr key={slot.id} className="border-b last:border-0"><td className="p-2"><bdi dir="ltr">{slot.slot_index}</bdi></td><td className="p-2">{slot.slot_type === 'lesson' ? `الحصة ${slot.lesson_number}` : 'استراحة'}</td><td className="p-2 font-medium">{slot.label}</td><td className="p-2"><bdi dir="ltr">{slot.start_time} – {slot.end_time}</bdi></td><td className="flex gap-1 p-2"><button onClick={() => beginSlot(dayOfWeek, slot)} className="rounded p-2 text-blue-700 hover:bg-blue-50" aria-label="تعديل الفترة"><Pencil size={16} /></button><button onClick={() => void removeSlot(slot)} className="rounded p-2 text-red-700 hover:bg-red-50" aria-label="حذف الفترة"><Trash2 size={16} /></button></td></tr>)}</tbody>
                              </table>
                            )}
                          </div>
                        )}
                      </section>
                    );
                  })}
                </div>
              )}

              {tab === 'grid' && schoolId != null && academicYearId != null && (
                <TimetableGridTab
                  schoolId={schoolId}
                  academicYearId={academicYearId}
                  classes={classes}
                  sections={sections}
                  onChanged={reloadYearData}
                />
              )}

              {!loading && tab === 'master' && schoolId != null && academicYearId != null && (
                <MasterTimetableTab
                  schoolId={schoolId}
                  academicYearId={academicYearId}
                  dataVersion={yearDataVersion}
                  onOpenRepair={() => setTab('grid')}
                />
              )}

              {!loading && tab === 'automatic' && schoolId != null && academicYearId != null && (
                <AutomaticTimetableTab
                  schoolId={schoolId}
                  academicYearId={academicYearId}
                  dataVersion={yearDataVersion}
                  readiness={readiness}
                  onAdopted={reloadYearData}
                />
              )}

              {!loading && tab === 'versions' && schoolId != null && academicYearId != null && (
                <TimetableVersionsTab
                  schoolId={schoolId}
                  academicYearId={academicYearId}
                  dataVersion={yearDataVersion}
                  onRestored={reloadYearData}
                />
              )}

              {!loading && tab === 'loads' && (
                <div className="space-y-5">
                  <div className="grid gap-4 rounded-xl border border-gray-200 bg-white p-4 md:grid-cols-2">
                    <label className="text-sm font-medium text-gray-700">الصف
                      <select value={selectedClassId ?? ''} onChange={(event) => { const classId = event.target.value ? Number(event.target.value) : null; setSelectedClassId(classId); setSelectedSectionId(null); setLoadForm({ ...EMPTY_LOAD, class_id: classId == null ? '' : String(classId) }); }} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"><option value="">كل الصفوف</option>{classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
                    </label>
                    <label className="text-sm font-medium text-gray-700">الشعبة
                      <select value={selectedSectionId ?? ''} onChange={(event) => { const sectionId = event.target.value ? Number(event.target.value) : null; setSelectedSectionId(sectionId); setLoadForm({ ...EMPTY_LOAD, class_id: selectedClassId == null ? '' : String(selectedClassId), section_id: sectionId == null ? '' : String(sectionId) }); }} disabled={selectedClassId == null || activeSections.length === 0} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 disabled:bg-gray-100"><option value="">{activeSections.length ? 'كل الشعب' : 'لا توجد شعب'}</option>{activeSections.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
                    </label>
                  </div>

                  <form onSubmit={submitLoad} className="grid gap-3 rounded-xl border border-gray-200 bg-white p-4 md:grid-cols-6">
                    <select required value={loadForm.class_id} onChange={(event) => { setSelectedClassId(Number(event.target.value)); setLoadForm({ ...loadForm, class_id: event.target.value, section_id: '', subject_id: '' }); }} className="rounded-lg border border-gray-300 px-3 py-2"><option value="">الصف</option>{classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
                    <select required={activeSections.length > 0} value={loadForm.section_id} onChange={(event) => { setSelectedSectionId(event.target.value ? Number(event.target.value) : null); setLoadForm({ ...loadForm, section_id: event.target.value, subject_id: '' }); }} disabled={!loadForm.class_id || activeSections.length === 0} className="rounded-lg border border-gray-300 px-3 py-2 disabled:bg-gray-100"><option value="">{activeSections.length ? 'الشعبة' : 'بلا شعبة'}</option>{activeSections.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
                    <select required value={loadForm.subject_id} onChange={(event) => setLoadForm({ ...loadForm, subject_id: event.target.value })} className="rounded-lg border border-gray-300 px-3 py-2"><option value="">المادة</option>{applicableSubjects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
                    <select value={loadForm.employee_id} onChange={(event) => setLoadForm({ ...loadForm, employee_id: event.target.value })} className="rounded-lg border border-gray-300 px-3 py-2"><option value="">مدرس غير محدد</option>{teacherCandidates.map((item) => <option key={item.id} value={item.id}>{item.full_name}{item.job_title ? ` — ${item.job_title}` : ''}</option>)}</select>
                    <input required type="number" min="1" value={loadForm.weekly_periods} onChange={(event) => setLoadForm({ ...loadForm, weekly_periods: event.target.value })} placeholder="عدد الحصص" className="rounded-lg border border-gray-300 px-3 py-2" />
                    <div className="flex gap-2"><button disabled={saving} className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-primary-600 px-3 py-2 font-semibold text-white disabled:opacity-50"><Save size={16} />{loadForm.id == null ? 'إضافة' : 'حفظ'}</button>{loadForm.id != null && <button type="button" onClick={() => beginLoad()} className="rounded-lg border border-gray-300 p-2"><X size={18} /></button>}</div>
                  </form>

                  <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
                    <table className="w-full min-w-[760px] text-sm"><thead className="bg-gray-50"><tr className="text-right text-gray-600"><th className="p-3">المادة</th><th className="p-3">الصف</th><th className="p-3">الشعبة</th><th className="p-3">عدد الحصص الأسبوعية</th><th className="p-3">المدرس</th><th className="p-3">إجراء</th></tr></thead><tbody>{filteredLoads.length === 0 ? <tr><td colSpan={6} className="p-8 text-center text-gray-500">لا توجد أنصبة مطابقة.</td></tr> : filteredLoads.map((load) => <tr key={load.id} className="border-t"><td className="p-3 font-medium">{load.subject_name}</td><td className="p-3">{load.class_name}</td><td className="p-3">{load.section_name || '—'}</td><td className="p-3"><bdi dir="ltr">{load.weekly_periods}</bdi></td><td className={`p-3 ${load.employee_id == null ? 'font-semibold text-amber-700' : ''}`}>{load.employee_name || 'مدرس غير محدد'}</td><td className="flex gap-1 p-3"><button onClick={() => beginLoad(load)} className="rounded p-2 text-blue-700 hover:bg-blue-50"><Pencil size={16} /></button><button onClick={() => void removeLoad(load)} className="rounded p-2 text-red-700 hover:bg-red-50"><Trash2 size={16} /></button></td></tr>)}</tbody></table>
                  </div>

                  <div className="rounded-xl border border-gray-200 bg-white p-4">
                    <h2 className="mb-3 flex items-center gap-2 font-bold"><UserRoundCheck size={18} />إجمالي نصاب المدرس</h2>
                    {readiness?.teacher_workloads.length ? <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{readiness.teacher_workloads.map((teacher) => <div key={teacher.employee_id} className="rounded-lg border border-gray-200 p-3"><p className="font-semibold">{teacher.employee_name}</p><p className="mt-1 text-sm text-gray-600"><bdi dir="ltr">{teacher.total_weekly_periods}</bdi> حصة أسبوعية عبر <bdi dir="ltr">{teacher.assignment_count}</bdi> تكليف</p></div>)}</div> : <p className="text-sm text-gray-500">لا توجد تكليفات لمدرسين بعد.</p>}
                  </div>
                </div>
              )}

              {!loading && tab === 'availability' && (
                <TeacherAvailabilityTab
                  key={`${schoolId}:${academicYearId}`}
                  schoolId={schoolId}
                  academicYearId={academicYearId}
                  teachers={teacherCandidates}
                  dataVersion={yearDataVersion}
                />
              )}

              {!loading && tab === 'readiness' && readiness && (
                <div className="space-y-5">
                  <div className={`flex items-center gap-3 rounded-xl border p-4 ${readiness.schedule_ready ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
                    {readiness.schedule_ready ? <CheckCircle2 /> : <AlertTriangle />}
                    <div><p className="font-bold">{readiness.schedule_ready ? 'الجدول مكتمل وجاهز' : 'توجد عناصر تحتاج إلى مراجعة'}</p><p className="text-sm">يجب توزيع كل الحصص المطلوبة ومعالجة المراجع والتعارضات الصلبة. تفضيلات المدرسين تبقى تحذيرات غير مانعة.</p></div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-9"><Metric label="السعة الأسبوعية" value={readiness.weekly_capacity} /><Metric label="الحصص المطلوبة" value={readiness.total_required_periods} tone="green" /><Metric label="الحصص المجدولة" value={readiness.total_scheduled_periods} tone="blue" /><Metric label="الحصص المتبقية" value={readiness.total_unscheduled_periods} tone={readiness.total_unscheduled_periods ? 'amber' : 'green'} /><Metric label="التكليفات الفعالة" value={readiness.total_assignments} tone="amber" /><Metric label="مدرس غير محدد" value={readiness.missing_teacher_count} tone={readiness.missing_teacher_count ? 'red' : 'green'} /><Metric label="مراجع غير صالحة" value={readiness.invalid_reference_count} tone={readiness.invalid_reference_count ? 'red' : 'green'} /><Metric label="تعارضات صلبة" value={readiness.hard_constraint_violation_count} tone={readiness.hard_constraint_violation_count ? 'red' : 'green'} /><Metric label="مشكلات سعة المدرسين" value={readiness.teacher_feasibility_issues.length} tone={readiness.teacher_feasibility_issues.length ? 'red' : 'green'} /></div>
                  {readiness.teacher_feasibility_issues.map((issue) => <div key={`${issue.employee_id}:${issue.code}`} className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-800"><AlertTriangle size={18} />{issue.message}</div>)}
                  <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white"><table className="w-full min-w-[920px] text-sm"><thead className="bg-gray-50"><tr className="text-right text-gray-600"><th className="p-3">الصف / الشعبة</th><th className="p-3">السعة</th><th className="p-3">المطلوب</th><th className="p-3">المجدول</th><th className="p-3">المتبقي</th><th className="p-3">الفرق</th><th className="p-3">الحالة</th><th className="p-3">ملاحظات</th></tr></thead><tbody>{readiness.placements.map((placement) => <tr key={`${placement.class_id}:${placement.section_id ?? 'none'}`} className="border-t"><td className="p-3 font-medium">{placement.class_name}{placement.section_name ? ` / ${placement.section_name}` : ''}</td><td className="p-3"><bdi dir="ltr">{placement.available_capacity}</bdi></td><td className="p-3"><bdi dir="ltr">{placement.required_periods}</bdi></td><td className="p-3"><bdi dir="ltr">{placement.scheduled_periods}</bdi></td><td className={`p-3 font-bold ${placement.remaining_periods ? 'text-amber-700' : 'text-emerald-700'}`}><bdi dir="ltr">{placement.remaining_periods}</bdi></td><td className={`p-3 font-bold ${placement.difference < 0 ? 'text-red-700' : 'text-gray-800'}`}><bdi dir="ltr">{placement.difference}</bdi></td><td className={`p-3 font-semibold ${placement.status === 'over_capacity' || placement.status === 'empty_week' ? 'text-red-700' : placement.status === 'unallocated' ? 'text-amber-700' : 'text-emerald-700'}`}>{readinessLabel(placement.status)}</td><td className="p-3 text-xs text-gray-600">{placement.missing_subjects.length > 0 && <p>مواد بلا نصاب: {placement.missing_subjects.map((item) => item.name).join('، ')}</p>}{placement.missing_teacher_load_ids.length > 0 && <p className="text-amber-700">تكليفات بلا مدرس: {placement.missing_teacher_load_ids.length}</p>}{placement.invalid_load_ids.length > 0 && <p className="text-red-700">مراجع غير صالحة: {placement.invalid_load_ids.length}</p>}{placement.missing_subjects.length === 0 && placement.missing_teacher_load_ids.length === 0 && placement.invalid_load_ids.length === 0 && '—'}</td></tr>)}</tbody></table></div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {slotForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="تحرير فترة الجدول">
          <form onSubmit={submitSlot} className="w-full max-w-xl space-y-4 rounded-xl bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between"><h2 className="font-bold">{slotForm.id == null ? 'إضافة فترة' : 'تعديل الفترة'} — {TIMETABLE_DAY_NAMES[slotForm.day_of_week]}</h2><button type="button" onClick={() => setSlotForm(null)}><X /></button></div>
            <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">النوع<select value={slotForm.slot_type} onChange={(event) => setSlotForm({ ...slotForm, slot_type: event.target.value as 'lesson' | 'break', lesson_number: event.target.value === 'break' ? '' : slotForm.lesson_number })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"><option value="lesson">حصة</option><option value="break">استراحة</option></select></label><label className="text-sm">الترتيب<input required type="number" min="1" value={slotForm.slot_index} onChange={(event) => setSlotForm({ ...slotForm, slot_index: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" /></label><label className="text-sm">رقم الحصة<input required={slotForm.slot_type === 'lesson'} disabled={slotForm.slot_type === 'break'} type="number" min="1" value={slotForm.lesson_number} onChange={(event) => setSlotForm({ ...slotForm, lesson_number: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 disabled:bg-gray-100" /></label><label className="text-sm">الاسم<input required value={slotForm.label} onChange={(event) => setSlotForm({ ...slotForm, label: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" /></label><label className="text-sm">وقت البداية<input required type="time" value={slotForm.start_time} onChange={(event) => setSlotForm({ ...slotForm, start_time: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" dir="ltr" /></label><label className="text-sm">وقت النهاية<input required type="time" value={slotForm.end_time} onChange={(event) => setSlotForm({ ...slotForm, end_time: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" dir="ltr" /></label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={slotForm.is_active === 1} onChange={(event) => setSlotForm({ ...slotForm, is_active: event.target.checked ? 1 : 0 })} />الفترة فعالة</label></div>
            <button disabled={saving} className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 font-semibold text-white disabled:opacity-50"><Save size={18} />حفظ الفترة</button>
          </form>
        </div>
      )}
    </div>
  );
}
