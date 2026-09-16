import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  Eye,
  EyeOff,
  Loader2,
  RefreshCw,
  Save,
  Send,
  UserRoundCheck,
  Users,
} from 'lucide-react';
import { SystemAdminSchoolSelector } from '../../components/SystemAdminSchoolSelector';
import { useAuth } from '../../hooks/useAuth';
import { useSchoolRequestGuard } from '../../hooks/useSchoolRequestGuard';
import { useTenantSchool } from '../../hooks/useTenantSchool';
import {
  getAttendanceLesson,
  getAttendanceLessons,
  getParentAttendance,
  saveAttendanceLesson,
} from '../../lib/api';
import {
  ATTENDANCE_STATUSES,
  ATTENDANCE_STATUS_LABELS,
  defaultAttendanceDate,
  type AttendanceLessonDetail,
  type AttendanceLessonSummary,
  type AttendanceStatus,
  type AttendanceStudentRecord,
  type ParentAttendanceFeed,
} from '../../lib/attendance';
import { ATTENDANCE_MANAGEMENT_ROLES, hasRole } from '../../lib/rbac';

const STATUS_COLORS: Record<AttendanceStatus, string> = {
  present: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  absent: 'border-rose-200 bg-rose-50 text-rose-800',
  excused: 'border-sky-200 bg-sky-50 text-sky-800',
  late: 'border-amber-200 bg-amber-50 text-amber-800',
  left_early: 'border-orange-200 bg-orange-50 text-orange-800',
  school_activity: 'border-violet-200 bg-violet-50 text-violet-800',
};

function shiftDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function arabicDate(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  return date.toLocaleDateString('ar-IQ', {
    timeZone: 'UTC',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function StatusBadge({ status }: { status: AttendanceStatus }) {
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${STATUS_COLORS[status]}`}>
      {ATTENDANCE_STATUS_LABELS[status]}
    </span>
  );
}

function Message({ type, children }: { type: 'error' | 'success' | 'info'; children: React.ReactNode }) {
  const style = type === 'error'
    ? 'border-red-200 bg-red-50 text-red-800'
    : type === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : 'border-blue-200 bg-blue-50 text-blue-800';
  return <div className={`rounded-xl border px-4 py-3 text-sm ${style}`} role={type === 'error' ? 'alert' : 'status'}>{children}</div>;
}

function LessonStatus({ lesson }: { lesson: AttendanceLessonSummary }) {
  if (lesson.session_status === 'confirmed') {
    return <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-800">معتمد</span>;
  }
  if (lesson.session_status === 'draft') {
    return <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800">مسودة</span>;
  }
  return <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-bold text-gray-600">لم يُسجّل</span>;
}

function LessonCard({
  lesson,
  selected,
  onClick,
}: {
  lesson: AttendanceLessonSummary;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-2xl border p-4 text-right transition ${selected ? 'border-primary-400 bg-primary-50 shadow-sm' : 'border-gray-200 bg-white hover:border-primary-200 hover:bg-gray-50'}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-bold text-gray-900">{lesson.subject_name}</p>
          <p className="mt-1 text-sm text-gray-600">{lesson.class_name}{lesson.section_name ? ` / ${lesson.section_name}` : ''}</p>
        </div>
        <LessonStatus lesson={lesson} />
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-gray-500">
        <span className="flex items-center gap-1"><Clock3 size={14} />{lesson.start_time}–{lesson.end_time}</span>
        <span className="flex items-center gap-1"><UserRoundCheck size={14} />{lesson.teacher_name || 'بدون مدرس'}</span>
        <span className="flex items-center gap-1"><Users size={14} />{lesson.roster_count} طالب</span>
      </div>
      {lesson.session_status && (
        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
          <span className="rounded-lg bg-emerald-50 px-2 py-1 text-emerald-700">حاضر {lesson.present_count}</span>
          <span className="rounded-lg bg-rose-50 px-2 py-1 text-rose-700">غائب {lesson.absent_count}</span>
          <span className="rounded-lg bg-amber-50 px-2 py-1 text-amber-700">متأخر {lesson.late_count}</span>
        </div>
      )}
    </button>
  );
}

function StudentAttendanceRow({
  record,
  disabled,
  onChange,
}: {
  record: AttendanceStudentRecord;
  disabled: boolean;
  onChange: (value: AttendanceStudentRecord) => void;
}) {
  function update(changes: Partial<AttendanceStudentRecord>) {
    const next = { ...record, ...changes };
    if (changes.status && changes.status !== 'late') next.late_minutes = 0;
    if (changes.status === 'late' && next.late_minutes <= 0) next.late_minutes = 1;
    onChange(next);
  }

  return (
    <article className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-bold text-gray-900">{record.student_name}</h3>
          <bdi dir="ltr" className="mt-1 block text-xs text-gray-500 [unicode-bidi:isolate]">{record.student_number}</bdi>
        </div>
        <StatusBadge status={record.status} />
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_150px]">
        <label className="text-xs font-semibold text-gray-600">
          الحالة
          <select
            value={record.status}
            disabled={disabled}
            onChange={(event) => update({ status: event.target.value as AttendanceStatus })}
            className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 disabled:bg-gray-100"
          >
            {ATTENDANCE_STATUSES.map((status) => <option key={status} value={status}>{ATTENDANCE_STATUS_LABELS[status]}</option>)}
          </select>
        </label>
        <label className="text-xs font-semibold text-gray-600">
          دقائق التأخير
          <input
            type="number"
            min={1}
            max={240}
            value={record.status === 'late' ? record.late_minutes : ''}
            disabled={disabled || record.status !== 'late'}
            onChange={(event) => update({ late_minutes: Math.min(240, Math.max(1, Number(event.target.value) || 1)) })}
            className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm disabled:bg-gray-100"
          />
        </label>
      </div>

      <label className="mt-3 block text-xs font-semibold text-gray-600">
        الملاحظة
        <textarea
          rows={2}
          maxLength={1000}
          value={record.note || ''}
          disabled={disabled}
          onChange={(event) => update({ note: event.target.value || null })}
          placeholder="مثال: وصل بعد بداية الحصة بعشر دقائق"
          className="mt-1 block w-full resize-y rounded-lg border border-gray-300 px-3 py-2.5 text-sm disabled:bg-gray-100"
        />
      </label>

      <label className={`mt-3 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold ${record.note_visibility === 'parent' ? 'border-blue-200 bg-blue-50 text-blue-800' : 'border-gray-200 bg-gray-50 text-gray-600'}`}>
        <input
          type="checkbox"
          checked={record.note_visibility === 'parent'}
          disabled={disabled}
          onChange={(event) => update({ note_visibility: event.target.checked ? 'parent' : 'staff' })}
        />
        {record.note_visibility === 'parent' ? <Eye size={15} /> : <EyeOff size={15} />}
        {record.note_visibility === 'parent' ? 'تظهر الملاحظة لولي الأمر' : 'ملاحظة داخلية للمدرسة'}
      </label>
    </article>
  );
}

function StaffAttendance() {
  const { user } = useAuth();
  const schoolScope = useTenantSchool();
  const { schoolId } = schoolScope;
  const captureSchoolRequest = useSchoolRequestGuard(schoolId);
  const [date, setDate] = useState(defaultAttendanceDate());
  const [lessons, setLessons] = useState<AttendanceLessonSummary[]>([]);
  const [selectedEntryId, setSelectedEntryId] = useState<number | null>(null);
  const [detail, setDetail] = useState<AttendanceLessonDetail | null>(null);
  const [records, setRecords] = useState<AttendanceStudentRecord[]>([]);
  const [changeReason, setChangeReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const generationRef = useRef(0);
  const currentScopeRef = useRef({ schoolId, date, selectedEntryId });
  currentScopeRef.current = { schoolId, date, selectedEntryId };
  const canManage = hasRole(user?.role_key, ATTENDANCE_MANAGEMENT_ROLES);

  const loadLessons = useCallback(async () => {
    generationRef.current += 1;
    const generation = generationRef.current;
    setLessons([]);
    setSelectedEntryId(null);
    setDetail(null);
    setRecords([]);
    setChangeReason('');
    setError('');
    setSuccess('');
    setSaving(false);
    setDetailLoading(false);
    if (schoolId == null) {
      setLoading(false);
      return;
    }
    const isCurrentSchool = captureSchoolRequest();
    setLoading(true);
    const response = await getAttendanceLessons(schoolId, date);
    if (generation !== generationRef.current || !isCurrentSchool()) return;
    if (response.error) setError(response.error);
    else setLessons(response.data || []);
    setLoading(false);
  }, [captureSchoolRequest, date, schoolId]);

  useEffect(() => { void loadLessons(); }, [loadLessons]);

  async function openLesson(entryId: number) {
    if (schoolId == null) return;
    const expected = { schoolId, date, entryId };
    currentScopeRef.current = { schoolId, date, selectedEntryId: entryId };
    setSelectedEntryId(entryId);
    setDetail(null);
    setRecords([]);
    setChangeReason('');
    setError('');
    setSuccess('');
    setDetailLoading(true);
    const response = await getAttendanceLesson(schoolId, entryId, date);
    const current = currentScopeRef.current;
    if (current.schoolId !== expected.schoolId || current.date !== expected.date || current.selectedEntryId !== expected.entryId) return;
    if (response.error) setError(response.error);
    else if (response.data) {
      setDetail(response.data);
      setRecords(response.data.records);
    }
    setDetailLoading(false);
  }

  function updateRecord(value: AttendanceStudentRecord) {
    setRecords((current) => current.map((record) => record.student_id === value.student_id ? value : record));
    setSuccess('');
  }

  function markAllPresent() {
    setRecords((current) => current.map((record) => ({ ...record, status: 'present', late_minutes: 0 })));
    setSuccess('');
  }

  async function save(action: 'draft' | 'confirm') {
    if (!detail || schoolId == null || saving) return;
    const correcting = detail.lesson.session_status === 'confirmed';
    if (correcting && !changeReason.trim()) {
      setError('اكتب سبب التصحيح قبل حفظ سجل معتمد.');
      return;
    }
    if (action === 'confirm' && !correcting && !window.confirm('بعد الاعتماد سيظهر السجل لولي الأمر ولن يستطيع المدرس تعديله. هل تريد المتابعة؟')) return;
    const expected = { schoolId, date, entryId: detail.lesson.timetable_entry_id };
    setSaving(true);
    setError('');
    setSuccess('');
    const response = await saveAttendanceLesson(detail.lesson.timetable_entry_id, {
      school_id: schoolId,
      session_date: date,
      expected_revision: detail.lesson.revision,
      action,
      change_reason: correcting ? changeReason.trim() : null,
      records: records.map((record) => ({
        student_id: record.student_id,
        status: record.status,
        late_minutes: record.status === 'late' ? record.late_minutes : 0,
        note: record.note,
        note_visibility: record.note_visibility,
      })),
    });
    const current = currentScopeRef.current;
    if (current.schoolId !== expected.schoolId || current.date !== expected.date || current.selectedEntryId !== expected.entryId) return;
    if (response.error) setError(response.error);
    else if (response.data) {
      setDetail(response.data);
      setRecords(response.data.records);
      setChangeReason('');
      setSuccess(action === 'confirm' ? (correcting ? 'تم حفظ التصحيح وتوثيق سببه.' : 'تم اعتماد الحضور وأصبح ظاهرًا لولي الأمر.') : 'تم حفظ المسودة.');
      const listResponse = await getAttendanceLessons(schoolId, date);
      const latest = currentScopeRef.current;
      if (latest.schoolId === expected.schoolId && latest.date === expected.date && !listResponse.error) setLessons(listResponse.data || []);
    }
    setSaving(false);
  }

  const confirmed = detail?.lesson.session_status === 'confirmed';
  const editable = !!detail && (!confirmed || (canManage && detail.permissions.can_correct_confirmed));
  const counts = useMemo(() => ({
    present: records.filter((record) => record.status === 'present').length,
    absent: records.filter((record) => record.status === 'absent').length,
    late: records.filter((record) => record.status === 'late').length,
    excused: records.filter((record) => record.status === 'excused').length,
  }), [records]);

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-50 text-primary-700"><ClipboardCheck size={23} /></div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">حضور الحصص</h1>
            <p className="text-sm text-gray-500">الحصص مأخوذة من الجدول الرسمي، والغياب لا يظهر لولي الأمر قبل الاعتماد.</p>
          </div>
        </div>
        <button type="button" onClick={() => void loadLessons()} disabled={loading} className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> تحديث
        </button>
      </div>

      <SystemAdminSchoolSelector {...schoolScope} />

      <section className="rounded-2xl border border-gray-200 bg-white p-4">
        <label className="block max-w-sm text-sm font-semibold text-gray-700">
          تاريخ الدوام
          <input type="date" value={date} max={defaultAttendanceDate()} onChange={(event) => setDate(event.target.value)} className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2" />
        </label>
        <p className="mt-2 text-sm text-gray-500">{arabicDate(date)}</p>
      </section>

      {error && <Message type="error">{error}</Message>}
      {success && <Message type="success">{success}</Message>}

      {schoolId == null ? (
        <Message type="info">اختر مدرسة لعرض حصصها.</Message>
      ) : loading ? (
        <div className="flex min-h-40 items-center justify-center gap-2 text-gray-500"><Loader2 className="animate-spin" /> جاري تحميل الحصص...</div>
      ) : lessons.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-10 text-center">
          <CalendarDays className="mx-auto mb-3 text-gray-300" size={38} />
          <p className="font-semibold text-gray-700">لا توجد حصص مجدولة لك في هذا اليوم.</p>
          <p className="mt-1 text-sm text-gray-500">تحقق من الجدول الدراسي وربط حساب المدرس بسجل الموظف.</p>
        </section>
      ) : (
        <div className="grid items-start gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
          <aside className="space-y-3 xl:sticky xl:top-4">
            {lessons.map((lesson) => (
              <LessonCard key={lesson.timetable_entry_id} lesson={lesson} selected={selectedEntryId === lesson.timetable_entry_id} onClick={() => void openLesson(lesson.timetable_entry_id)} />
            ))}
          </aside>

          <section className="min-w-0 rounded-2xl border border-gray-200 bg-gray-50 p-3 sm:p-5">
            {detailLoading ? (
              <div className="flex min-h-56 items-center justify-center gap-2 text-gray-500"><Loader2 className="animate-spin" /> جاري تحميل قائمة الطلاب...</div>
            ) : !detail ? (
              <div className="flex min-h-56 flex-col items-center justify-center text-center text-gray-500">
                <ClipboardCheck size={40} className="mb-3 text-gray-300" />
                <p className="font-semibold">اختر حصة لفتح سجلها.</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-xl border border-gray-200 bg-white p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-bold text-gray-900">{detail.lesson.subject_name}</h2>
                      <p className="mt-1 text-sm text-gray-600">{detail.lesson.class_name}{detail.lesson.section_name ? ` / ${detail.lesson.section_name}` : ''} · {detail.lesson.start_time}–{detail.lesson.end_time}</p>
                      <p className="mt-1 text-xs text-gray-500">المدرس: {detail.lesson.teacher_name || 'غير محدد'}</p>
                    </div>
                    <LessonStatus lesson={detail.lesson} />
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <div className="rounded-lg bg-emerald-50 p-2 text-center text-sm font-bold text-emerald-800">حاضر {counts.present}</div>
                    <div className="rounded-lg bg-rose-50 p-2 text-center text-sm font-bold text-rose-800">غائب {counts.absent}</div>
                    <div className="rounded-lg bg-amber-50 p-2 text-center text-sm font-bold text-amber-800">متأخر {counts.late}</div>
                    <div className="rounded-lg bg-sky-50 p-2 text-center text-sm font-bold text-sky-800">بعذر {counts.excused}</div>
                  </div>
                </div>

                {confirmed && !editable && <Message type="info">هذا السجل معتمد وللقراءة فقط. التصحيح متاح للإدارة مع توثيق السبب.</Message>}
                {confirmed && editable && (
                  <label className="block rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">
                    سبب تصحيح السجل المعتمد
                    <textarea value={changeReason} onChange={(event) => setChangeReason(event.target.value)} maxLength={500} rows={2} placeholder="اكتب سببًا واضحًا يظهر في سجل التدقيق" className="mt-2 block w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-gray-900" />
                  </label>
                )}

                {editable && !confirmed && (
                  <button type="button" onClick={markAllPresent} className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800 hover:bg-emerald-100">
                    <CheckCircle2 size={17} /> تعيين الجميع حاضرًا
                  </button>
                )}

                <div className="grid gap-3 lg:grid-cols-2">
                  {records.map((record) => <StudentAttendanceRow key={record.student_id} record={record} disabled={!editable || saving} onChange={updateRecord} />)}
                </div>

                {records.length === 0 && <Message type="info">لا يوجد طلاب فعالون ضمن هذه الحصة.</Message>}

                {editable && records.length > 0 && (
                  <div className="sticky bottom-3 flex flex-wrap justify-end gap-2 rounded-xl border border-gray-200 bg-white/95 p-3 shadow-lg backdrop-blur">
                    {!confirmed && (
                      <button type="button" disabled={saving} onClick={() => void save('draft')} className="flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                        {saving ? <Loader2 size={17} className="animate-spin" /> : <Save size={17} />} حفظ مسودة
                      </button>
                    )}
                    <button type="button" disabled={saving} onClick={() => void save('confirm')} className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-primary-700 disabled:opacity-50">
                      {saving ? <Loader2 size={17} className="animate-spin" /> : <Send size={17} />} {confirmed ? 'حفظ التصحيح' : 'اعتماد وإظهار لولي الأمر'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function ParentAttendance() {
  const today = defaultAttendanceDate();
  const [from, setFrom] = useState(shiftDate(today, -30));
  const [to, setTo] = useState(today);
  const [feed, setFeed] = useState<ParentAttendanceFeed | null>(null);
  const [selectedStudentId, setSelectedStudentId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const generationRef = useRef(0);

  const load = useCallback(async () => {
    const generation = ++generationRef.current;
    setLoading(true);
    setError('');
    const response = await getParentAttendance(from, to);
    if (generation !== generationRef.current) return;
    if (response.error) setError(response.error);
    else if (response.data) {
      setFeed(response.data);
      setSelectedStudentId((current) => response.data?.students.some((student) => student.id === current) ? current : response.data?.students[0]?.id || null);
    }
    setLoading(false);
  }, [from, to]);

  useEffect(() => { void load(); }, [load]);
  const records = useMemo(() => (feed?.records || []).filter((record) => selectedStudentId == null || record.student_id === selectedStudentId), [feed, selectedStudentId]);
  const summary = useMemo(() => ({
    absent: records.filter((record) => record.status === 'absent').length,
    excused: records.filter((record) => record.status === 'excused').length,
    late: records.filter((record) => record.status === 'late').length,
    present: records.filter((record) => record.status === 'present').length,
  }), [records]);

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-50 text-primary-700"><ClipboardCheck size={23} /></div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">حضور أبنائي</h1>
          <p className="text-sm text-gray-500">تظهر هنا سجلات الحصص التي اعتمدتها المدرسة فقط.</p>
        </div>
      </div>

      <section className="grid gap-3 rounded-2xl border border-gray-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto]">
        <label className="text-sm font-semibold text-gray-700">من<input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2" /></label>
        <label className="text-sm font-semibold text-gray-700">إلى<input type="date" value={to} min={from} max={today} onChange={(event) => setTo(event.target.value)} className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2" /></label>
        <button type="button" onClick={() => void load()} disabled={loading} className="flex items-center justify-center gap-2 self-end rounded-lg border border-gray-300 px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> تحديث</button>
      </section>

      {error && <Message type="error">{error}</Message>}
      {loading ? (
        <div className="flex min-h-48 items-center justify-center gap-2 text-gray-500"><Loader2 className="animate-spin" /> جاري تحميل الحضور...</div>
      ) : !feed || feed.students.length === 0 ? (
        <Message type="info">لا يوجد طالب مرتبط بهذا الحساب. راجع إدارة المدرسة لإضافة الربط الصحيح.</Message>
      ) : (
        <>
          {feed.students.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {feed.students.map((student) => <button key={student.id} type="button" onClick={() => setSelectedStudentId(student.id)} className={`rounded-full px-4 py-2 text-sm font-bold ${selectedStudentId === student.id ? 'bg-primary-600 text-white' : 'border border-gray-300 bg-white text-gray-700'}`}>{student.full_name}</button>)}
            </div>
          )}
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-center"><p className="text-xs text-emerald-700">حاضر</p><p className="mt-1 text-2xl font-bold text-emerald-900">{summary.present}</p></div>
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-center"><p className="text-xs text-rose-700">غائب</p><p className="mt-1 text-2xl font-bold text-rose-900">{summary.absent}</p></div>
            <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-center"><p className="text-xs text-sky-700">بعذر</p><p className="mt-1 text-2xl font-bold text-sky-900">{summary.excused}</p></div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-center"><p className="text-xs text-amber-700">متأخر</p><p className="mt-1 text-2xl font-bold text-amber-900">{summary.late}</p></div>
          </section>

          {records.length === 0 ? (
            <section className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-10 text-center"><CheckCircle2 className="mx-auto mb-3 text-emerald-400" size={38} /><p className="font-semibold text-gray-700">لا توجد سجلات معتمدة ضمن هذه الفترة.</p></section>
          ) : (
            <div className="space-y-3">
              {records.map((record) => (
                <article key={record.id} className="rounded-2xl border border-gray-200 bg-white p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="font-bold text-gray-900">{record.subject_name}</h2>
                      <p className="mt-1 text-sm text-gray-600">{record.class_name}{record.section_name ? ` / ${record.section_name}` : ''}</p>
                      <p className="mt-1 text-xs text-gray-500">{arabicDate(record.session_date)} · {record.start_time}–{record.end_time} · {record.teacher_name || 'المدرسة'}</p>
                    </div>
                    <StatusBadge status={record.status} />
                  </div>
                  {record.status === 'late' && <p className="mt-3 rounded-lg bg-amber-50 p-2 text-sm text-amber-900">التأخير: {record.late_minutes} دقيقة</p>}
                  {record.note && <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm leading-6 text-blue-900"><span className="font-bold">ملاحظة المدرسة: </span>{record.note}</div>}
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function AttendancePage() {
  const { user } = useAuth();
  if (user?.role_key === 'parent') return <ParentAttendance />;
  return <StaffAttendance />;
}
