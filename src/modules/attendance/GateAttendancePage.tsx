import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Clock3,
  CreditCard,
  DoorOpen,
  Loader2,
  LogIn,
  LogOut,
  Printer,
  RefreshCw,
  Save,
  ScanLine,
  Search,
  Settings,
  ShieldOff,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { SystemAdminSchoolSelector } from '../../components/SystemAdminSchoolSelector';
import { useSchoolRequestGuard } from '../../hooks/useSchoolRequestGuard';
import { useTenantSchool } from '../../hooks/useTenantSchool';
import {
  createManualStudentGateEvent,
  getGateAttendanceSettings,
  getStudentGateCards,
  getStudentGateEvents,
  getStudents,
  issueStudentGateCard,
  revokeStudentGateCard,
  saveGateAttendanceSettings,
  scanStudentGateCard,
  voidStudentGateEvent,
} from '../../lib/api';
import {
  GATE_DIRECTION_LABELS,
  GATE_STATUS_LABELS,
  reconcileIssuedGateCard,
  type GateAttendanceSettings,
  type GateAttendanceSettingsInput,
  type GateDirection,
  type StudentGateCard,
  type StudentGateEvent,
} from '../../lib/gateAttendance';
import { defaultAttendanceDate } from '../../lib/attendance';

type Tab = 'scanner' | 'events' | 'cards' | 'settings';

const DEFAULT_SETTINGS: GateAttendanceSettingsInput = {
  school_id: 0,
  school_start_time: '08:00',
  late_grace_minutes: 10,
  school_end_time: '14:00',
  early_exit_grace_minutes: 0,
  duplicate_window_seconds: 60,
  parent_notifications_enabled: true,
};

const STATUS_COLORS: Record<string, string> = {
  on_time: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  late: 'border-amber-200 bg-amber-50 text-amber-800',
  normal: 'border-blue-200 bg-blue-50 text-blue-800',
  early_exit: 'border-orange-200 bg-orange-50 text-orange-800',
};

function formatTime(seconds: number): string {
  return new Date(seconds * 1000).toLocaleTimeString('ar-IQ', {
    timeZone: 'Asia/Baghdad',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function baghdadDateTimeInput(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Baghdad',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}T${byType.hour}:${byType.minute}`;
}

function baghdadDateTimeEpoch(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return Number.NaN;
  // Iraq has used UTC+03:00 year-round throughout the allowed 30-day edit window.
  return Math.floor(Date.parse(`${value}:00+03:00`) / 1000);
}

function Message({ type, children }: { type: 'error' | 'success' | 'info'; children: React.ReactNode }) {
  const style = type === 'error'
    ? 'border-red-200 bg-red-50 text-red-800'
    : type === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : 'border-blue-200 bg-blue-50 text-blue-800';
  return <div role={type === 'error' ? 'alert' : 'status'} className={`rounded-xl border px-4 py-3 text-sm ${style}`}>{children}</div>;
}

function EventStatus({ event }: { event: StudentGateEvent }) {
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${STATUS_COLORS[event.attendance_status] || 'border-gray-200 bg-gray-50 text-gray-700'}`}>
      {GATE_STATUS_LABELS[event.attendance_status]}
      {event.attendance_status === 'late' ? ` · ${event.late_minutes} دقيقة` : ''}
    </span>
  );
}

function StudentIdentity({ item }: { item: { student_name: string; student_number: string; class_name: string | null; section_name: string | null } }) {
  return (
    <div className="min-w-0">
      <p className="truncate font-bold text-gray-900">{item.student_name}</p>
      <p className="mt-0.5 truncate text-xs text-gray-500">
        <bdi dir="ltr" className="[unicode-bidi:isolate]">{item.student_number}</bdi>
        {item.class_name ? ` · ${item.class_name}${item.section_name ? ` / ${item.section_name}` : ''}` : ''}
      </p>
    </div>
  );
}

export default function GateAttendancePage() {
  const schoolScope = useTenantSchool();
  const { schoolId } = schoolScope;
  const captureSchoolRequest = useSchoolRequestGuard(schoolId);
  const [tab, setTab] = useState<Tab>('scanner');
  const [date, setDate] = useState(defaultAttendanceDate());
  const [settings, setSettings] = useState<GateAttendanceSettingsInput>(DEFAULT_SETTINGS);
  const [events, setEvents] = useState<StudentGateEvent[]>([]);
  const [cards, setCards] = useState<StudentGateCard[]>([]);
  const [students, setStudents] = useState<Array<Record<string, any>>>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [direction, setDirection] = useState<GateDirection>('entry');
  const [gateLabel, setGateLabel] = useState('البوابة الرئيسية');
  const [cardPayload, setCardPayload] = useState('');
  const [scanResult, setScanResult] = useState<StudentGateEvent | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [studentQuery, setStudentQuery] = useState('');
  const [selectedStudentId, setSelectedStudentId] = useState<number | null>(null);
  const [issuedCard, setIssuedCard] = useState<StudentGateCard | null>(null);
  const [showRevoked, setShowRevoked] = useState(false);

  const [manualStudentId, setManualStudentId] = useState<number | null>(null);
  const [manualDirection, setManualDirection] = useState<GateDirection>('entry');
  const [manualTime, setManualTime] = useState(baghdadDateTimeInput());
  const [manualReason, setManualReason] = useState('');
  const [manualNote, setManualNote] = useState('');

  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const cameraFrameRef = useRef<number | null>(null);
  const [cameraActive, setCameraActive] = useState(false);

  const stopCamera = useCallback(() => {
    if (cameraFrameRef.current != null) cancelAnimationFrame(cameraFrameRef.current);
    cameraFrameRef.current = null;
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraActive(false);
  }, []);

  const loadEvents = useCallback(async () => {
    if (schoolId == null) return;
    const valid = captureSchoolRequest();
    const response = await getStudentGateEvents(schoolId, date);
    if (!valid()) return;
    if (response.error) setError(response.error);
    else setEvents(response.data || []);
  }, [captureSchoolRequest, date, schoolId]);

  const loadCards = useCallback(async () => {
    if (schoolId == null) return;
    const valid = captureSchoolRequest();
    const response = await getStudentGateCards(schoolId, '', showRevoked ? 'all' : 'active');
    if (!valid()) return;
    if (response.error) setError(response.error);
    else {
      const refreshedCards = response.data || [];
      setCards(refreshedCards);
      setIssuedCard((current) => reconcileIssuedGateCard(current, refreshedCards));
    }
  }, [captureSchoolRequest, schoolId, showRevoked]);

  const loadAll = useCallback(async () => {
    if (schoolId == null) return;
    const valid = captureSchoolRequest();
    setLoading(true);
    setError('');
    const [settingsResponse, eventsResponse, cardsResponse, studentsResponse] = await Promise.all([
      getGateAttendanceSettings(schoolId),
      getStudentGateEvents(schoolId, date),
      getStudentGateCards(schoolId, '', showRevoked ? 'all' : 'active'),
      getStudents(schoolId),
    ]);
    if (!valid()) return;
    const failure = settingsResponse.error || eventsResponse.error || cardsResponse.error || studentsResponse.error;
    if (failure) setError(failure);
    if (settingsResponse.data) {
      const row: GateAttendanceSettings = settingsResponse.data;
      setSettings({
        school_id: schoolId,
        school_start_time: row.school_start_time,
        late_grace_minutes: row.late_grace_minutes,
        school_end_time: row.school_end_time,
        early_exit_grace_minutes: row.early_exit_grace_minutes,
        duplicate_window_seconds: row.duplicate_window_seconds,
        parent_notifications_enabled: row.parent_notifications_enabled,
      });
    }
    setEvents(eventsResponse.data || []);
    const refreshedCards = cardsResponse.data || [];
    setCards(refreshedCards);
    setIssuedCard((current) => reconcileIssuedGateCard(current, refreshedCards));
    setStudents((studentsResponse.data || []).filter((student: Record<string, any>) => student.status === 'active'));
    setLoading(false);
  }, [captureSchoolRequest, date, schoolId, showRevoked]);

  useEffect(() => {
    setLoading(false);
    setSaving(false);
    setSettings({ ...DEFAULT_SETTINGS, school_id: schoolId || 0 });
    setEvents([]);
    setCards([]);
    setStudents([]);
    setScanResult(null);
    setIssuedCard(null);
    setError('');
    setSuccess('');
    stopCamera();
    if (schoolId != null) void loadAll();
  }, [schoolId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (schoolId != null) void loadEvents();
  }, [date]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (schoolId != null) void loadCards();
  }, [showRevoked]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => stopCamera(), [stopCamera]);

  const filteredStudents = useMemo(() => {
    const query = studentQuery.trim().toLocaleLowerCase('ar');
    if (!query) return students.slice(0, 20);
    return students.filter((student) => (
      String(student.full_name || '').toLocaleLowerCase('ar').includes(query)
      || String(student.student_number || '').toLocaleLowerCase('ar').includes(query)
    )).slice(0, 30);
  }, [studentQuery, students]);

  const counts = useMemo(() => ({
    total: events.filter((event) => event.record_status === 'active').length,
    entry: events.filter((event) => event.record_status === 'active' && event.event_type === 'entry').length,
    exit: events.filter((event) => event.record_status === 'active' && event.event_type === 'exit').length,
    late: events.filter((event) => event.record_status === 'active' && event.attendance_status === 'late').length,
  }), [events]);

  const submitScan = useCallback(async (payload?: string) => {
    const value = (payload ?? cardPayload).trim();
    if (schoolId == null || saving || !value) return;
    const valid = captureSchoolRequest();
    setSaving(true);
    setError('');
    setSuccess('');
    const response = await scanStudentGateCard({
      school_id: schoolId,
      card_payload: value,
      direction,
      gate_label: gateLabel.trim() || null,
    });
    if (!valid()) return;
    if (response.error) {
      setError(response.error);
      setScanResult(null);
    } else if (response.data) {
      setScanResult(response.data);
      setSuccess(`تم تسجيل ${GATE_DIRECTION_LABELS[response.data.event_type]} ${response.data.student_name}.`);
      setCardPayload('');
      await loadEvents();
    }
    setSaving(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [cardPayload, captureSchoolRequest, direction, gateLabel, loadEvents, saving, schoolId]);

  async function startCamera() {
    setError('');
    const Detector = (window as any).BarcodeDetector;
    if (!Detector || !navigator.mediaDevices?.getUserMedia) {
      setError('هذا المتصفح لا يدعم مسح QR بالكاميرا. استخدم قارئ USB أو اكتب رمز البطاقة.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      cameraStreamRef.current = stream;
      if (!videoRef.current) return;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setCameraActive(true);
      const detector = new Detector({ formats: ['qr_code'] });
      const detect = async () => {
        if (!cameraStreamRef.current || !videoRef.current) return;
        try {
          const values = await detector.detect(videoRef.current);
          const raw = String(values?.[0]?.rawValue || '').trim();
          if (raw) {
            stopCamera();
            setCardPayload(raw);
            await submitScan(raw);
            return;
          }
        } catch {
          // Some browsers throw while the first camera frames are still empty.
        }
        cameraFrameRef.current = requestAnimationFrame(() => void detect());
      };
      cameraFrameRef.current = requestAnimationFrame(() => void detect());
    } catch {
      stopCamera();
      setError('تعذر فتح الكاميرا. تحقق من إذن الكاميرا أو استخدم قارئ USB.');
    }
  }

  async function issueCard() {
    if (schoolId == null || selectedStudentId == null || saving) return;
    const valid = captureSchoolRequest();
    setSaving(true);
    setError('');
    setSuccess('');
    const response = await issueStudentGateCard(schoolId, selectedStudentId);
    if (!valid()) return;
    if (response.error) setError(response.error);
    else if (response.data) {
      setIssuedCard(response.data);
      setSuccess('تم إصدار البطاقة. اطبعها أو احفظها الآن ثم سلّمها للطالب.');
      await loadCards();
    }
    setSaving(false);
  }

  async function revokeCard(card: StudentGateCard) {
    if (schoolId == null || saving) return;
    const reason = window.prompt(`اكتب سبب إلغاء بطاقة ${card.student_name}:`, 'البطاقة مفقودة');
    if (!reason?.trim()) return;
    const valid = captureSchoolRequest();
    setSaving(true);
    setError('');
    const response = await revokeStudentGateCard(card.id, schoolId, reason.trim());
    if (!valid()) return;
    if (response.error) setError(response.error);
    else {
      if (issuedCard?.id === card.id) setIssuedCard(null);
      setSuccess('أُلغيت البطاقة ولن تُقبل في أي مسح لاحق.');
      await loadCards();
    }
    setSaving(false);
  }

  async function saveSettings() {
    if (schoolId == null || saving) return;
    const valid = captureSchoolRequest();
    setSaving(true);
    setError('');
    const response = await saveGateAttendanceSettings({ ...settings, school_id: schoolId });
    if (!valid()) return;
    if (response.error) setError(response.error);
    else if (response.data) {
      setSettings({ ...response.data, school_id: schoolId });
      setSuccess('تم حفظ أوقات الدوام ومنع التكرار وإعداد الإشعارات.');
    }
    setSaving(false);
  }

  async function saveManualEvent() {
    if (schoolId == null || manualStudentId == null || saving || !manualReason.trim()) return;
    const occurredAt = baghdadDateTimeEpoch(manualTime);
    if (!Number.isFinite(occurredAt)) {
      setError('وقت التسجيل اليدوي غير صالح.');
      return;
    }
    const valid = captureSchoolRequest();
    setSaving(true);
    setError('');
    const response = await createManualStudentGateEvent({
      school_id: schoolId,
      student_id: manualStudentId,
      direction: manualDirection,
      occurred_at: occurredAt,
      gate_label: gateLabel.trim() || null,
      note: manualNote.trim() || null,
      reason: manualReason.trim(),
    });
    if (!valid()) return;
    if (response.error) setError(response.error);
    else if (response.data) {
      setScanResult(response.data);
      setManualReason('');
      setManualNote('');
      setSuccess('تم التسجيل اليدوي مع حفظ السبب في سجل التدقيق.');
      await loadEvents();
    }
    setSaving(false);
  }

  async function voidEvent(event: StudentGateEvent) {
    if (schoolId == null || saving || event.record_status !== 'active') return;
    const reason = window.prompt(`سبب إبطال حركة ${event.student_name}:`);
    if (!reason?.trim()) return;
    const valid = captureSchoolRequest();
    setSaving(true);
    setError('');
    const response = await voidStudentGateEvent(event.id, schoolId, reason.trim());
    if (!valid()) return;
    if (response.error) setError(response.error);
    else {
      setSuccess('أُبطلت الحركة مع الاحتفاظ بها وبسبب الإبطال في سجل التدقيق.');
      await loadEvents();
    }
    setSaving(false);
  }

  const tabs: Array<{ key: Tab; label: string; icon: React.ReactNode }> = [
    { key: 'scanner', label: 'المسح والتسجيل', icon: <ScanLine size={17} /> },
    { key: 'events', label: 'السجل اليومي', icon: <Clock3 size={17} /> },
    { key: 'cards', label: 'بطاقات الطلاب', icon: <CreditCard size={17} /> },
    { key: 'settings', label: 'الإعدادات', icon: <Settings size={17} /> },
  ];

  return (
    <div className="min-w-0 space-y-5" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-50 text-primary-700"><DoorOpen size={23} /></div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">حضور بوابة المدرسة</h1>
            <p className="text-sm text-gray-500">مسح بطاقة الطالب، الدخول والخروج، التأخير، وإشعار ولي الأمر المرتبط.</p>
          </div>
        </div>
        <button type="button" onClick={() => void loadAll()} disabled={loading || schoolId == null} className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> تحديث
        </button>
      </div>

      <div className="print:hidden"><SystemAdminSchoolSelector {...schoolScope} /></div>

      <nav className="flex max-w-full gap-2 overflow-x-auto rounded-xl border border-gray-200 bg-white p-2 print:hidden" aria-label="أقسام حضور البوابة">
        {tabs.map((item) => (
          <button key={item.key} type="button" onClick={() => { setTab(item.key); setError(''); setSuccess(''); }} className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold ${tab === item.key ? 'bg-primary-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
            {item.icon}{item.label}
          </button>
        ))}
      </nav>

      {error && <div className="print:hidden"><Message type="error">{error}</Message></div>}
      {success && <div className="print:hidden"><Message type="success">{success}</Message></div>}
      {schoolId == null ? <Message type="info">اختر مدرسة نشطة للبدء.</Message> : loading ? (
        <div className="flex min-h-52 items-center justify-center gap-2 text-gray-500"><Loader2 className="animate-spin" /> جاري تحميل بيانات البوابة...</div>
      ) : null}

      {schoolId != null && !loading && tab === 'scanner' && (
        <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.8fr)]">
          <section className="min-w-0 space-y-4 rounded-2xl border border-gray-200 bg-white p-4 sm:p-6">
            <div className="grid grid-cols-2 gap-2">
              {(['entry', 'exit'] as GateDirection[]).map((value) => (
                <button key={value} type="button" onClick={() => setDirection(value)} className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-3 font-bold ${direction === value ? (value === 'entry' ? 'border-emerald-400 bg-emerald-50 text-emerald-800' : 'border-blue-400 bg-blue-50 text-blue-800') : 'border-gray-200 text-gray-600'}`}>
                  {value === 'entry' ? <LogIn size={20} /> : <LogOut size={20} />}{GATE_DIRECTION_LABELS[value]}
                </button>
              ))}
            </div>

            <label className="block text-sm font-semibold text-gray-700">
              اسم البوابة أو جهاز المسح
              <input value={gateLabel} maxLength={100} onChange={(event) => setGateLabel(event.target.value)} className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2.5" />
            </label>

            <form onSubmit={(event) => { event.preventDefault(); void submitScan(); }} className="space-y-3">
              <label className="block text-sm font-semibold text-gray-700">
                رمز بطاقة الطالب
                <input
                  ref={inputRef}
                  autoFocus
                  value={cardPayload}
                  onChange={(event) => setCardPayload(event.target.value)}
                  placeholder="وجّه قارئ USB إلى البطاقة أو امسحها بالكاميرا"
                  autoComplete="off"
                  className="mt-1 block w-full rounded-xl border-2 border-primary-200 px-4 py-3 font-mono text-sm focus:border-primary-500 focus:outline-none"
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <button type="submit" disabled={saving || !cardPayload.trim()} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-3 font-bold text-white hover:bg-primary-700 disabled:opacity-50">
                  {saving ? <Loader2 className="animate-spin" size={18} /> : <ScanLine size={18} />} تسجيل {GATE_DIRECTION_LABELS[direction]}
                </button>
                <button type="button" onClick={cameraActive ? stopCamera : () => void startCamera()} className="flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-3 font-bold text-gray-700 hover:bg-gray-50">
                  {cameraActive ? <X size={18} /> : <Camera size={18} />}{cameraActive ? 'إيقاف الكاميرا' : 'مسح بالكاميرا'}
                </button>
              </div>
            </form>

            <div className={cameraActive ? 'block' : 'hidden'}>
              <video ref={videoRef} muted playsInline className="aspect-video w-full rounded-xl bg-gray-950 object-cover" aria-label="معاينة كاميرا مسح QR" />
              <p className="mt-2 text-center text-xs text-gray-500">ضع QR داخل الصورة؛ سيُسجل تلقائيًا مرة واحدة.</p>
            </div>

            {scanResult && (
              <article className="rounded-2xl border border-emerald-300 bg-emerald-50 p-4" aria-live="polite">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3"><CheckCircle2 className="shrink-0 text-emerald-600" /><StudentIdentity item={scanResult} /></div>
                  <EventStatus event={scanResult} />
                </div>
                <p className="mt-3 text-sm text-emerald-900">{GATE_DIRECTION_LABELS[scanResult.event_type]} الساعة {formatTime(scanResult.occurred_at)}</p>
              </article>
            )}
          </section>

          <aside className="min-w-0 space-y-4">
            <section className="grid grid-cols-2 gap-2 rounded-2xl border border-gray-200 bg-white p-4">
              <div className="rounded-xl bg-gray-50 p-3 text-center"><p className="text-2xl font-black text-gray-900">{counts.total}</p><p className="text-xs text-gray-500">الحركات</p></div>
              <div className="rounded-xl bg-amber-50 p-3 text-center"><p className="text-2xl font-black text-amber-800">{counts.late}</p><p className="text-xs text-amber-700">المتأخرون</p></div>
              <div className="rounded-xl bg-emerald-50 p-3 text-center"><p className="text-2xl font-black text-emerald-800">{counts.entry}</p><p className="text-xs text-emerald-700">دخول</p></div>
              <div className="rounded-xl bg-blue-50 p-3 text-center"><p className="text-2xl font-black text-blue-800">{counts.exit}</p><p className="text-xs text-blue-700">خروج</p></div>
            </section>

            <details className="rounded-2xl border border-gray-200 bg-white p-4">
              <summary className="cursor-pointer font-bold text-gray-900">تسجيل يدوي بسبب موثق</summary>
              <div className="mt-4 space-y-3">
                <select value={manualStudentId ?? ''} onChange={(event) => setManualStudentId(event.target.value ? Number(event.target.value) : null)} className="block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm">
                  <option value="">اختر الطالب</option>
                  {students.map((student) => <option key={student.id} value={student.id}>{student.full_name} — {student.student_number}</option>)}
                </select>
                <div className="grid grid-cols-2 gap-2">
                  <select value={manualDirection} onChange={(event) => setManualDirection(event.target.value as GateDirection)} className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm">
                    <option value="entry">دخول</option><option value="exit">خروج</option>
                  </select>
                  <input type="datetime-local" value={manualTime} max={baghdadDateTimeInput()} onChange={(event) => setManualTime(event.target.value)} className="min-w-0 rounded-lg border border-gray-300 px-2 py-2.5 text-sm" />
                </div>
                <textarea value={manualReason} onChange={(event) => setManualReason(event.target.value)} maxLength={500} rows={2} placeholder="سبب التسجيل اليدوي (إلزامي)" className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                <textarea value={manualNote} onChange={(event) => setManualNote(event.target.value)} maxLength={500} rows={2} placeholder="ملاحظة داخلية اختيارية" className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                <button type="button" onClick={() => void saveManualEvent()} disabled={saving || manualStudentId == null || !manualReason.trim()} className="flex w-full items-center justify-center gap-2 rounded-lg bg-gray-900 px-3 py-2.5 text-sm font-bold text-white disabled:opacity-50"><Save size={16} /> حفظ التسجيل اليدوي</button>
              </div>
            </details>
          </aside>
        </div>
      )}

      {schoolId != null && !loading && tab === 'events' && (
        <section className="min-w-0 space-y-4 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <label className="text-sm font-semibold text-gray-700">تاريخ السجل<input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="mt-1 block rounded-lg border border-gray-300 px-3 py-2" /></label>
            <div className="flex flex-wrap gap-2 text-xs font-bold"><span className="rounded-full bg-gray-100 px-3 py-1.5">الكل {counts.total}</span><span className="rounded-full bg-emerald-100 px-3 py-1.5 text-emerald-800">دخول {counts.entry}</span><span className="rounded-full bg-blue-100 px-3 py-1.5 text-blue-800">خروج {counts.exit}</span><span className="rounded-full bg-amber-100 px-3 py-1.5 text-amber-800">تأخير {counts.late}</span></div>
          </div>
          {events.length === 0 ? <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-10 text-center text-gray-500"><Users className="mx-auto mb-2 text-gray-300" />لا توجد حركات في هذا التاريخ.</div> : (
            <div className="grid min-w-0 gap-3 lg:grid-cols-2">
              {events.map((event) => (
                <article key={event.id} className={`min-w-0 rounded-xl border p-4 ${event.record_status === 'voided' ? 'border-gray-200 bg-gray-50 opacity-70' : 'border-gray-200 bg-white'}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3"><StudentIdentity item={event} /><EventStatus event={event} /></div>
                  <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-gray-500"><span className="font-bold text-gray-700">{GATE_DIRECTION_LABELS[event.event_type]}</span><span>{formatTime(event.occurred_at)}</span><span>{event.source === 'manual' ? 'تسجيل يدوي' : 'بطاقة QR'}</span>{event.gate_label && <span>{event.gate_label}</span>}</div>
                  {event.record_status === 'voided' ? <p className="mt-3 rounded-lg bg-gray-200 px-3 py-2 text-xs font-semibold text-gray-700">مبطلة: {event.void_reason}</p> : (
                    <button type="button" onClick={() => void voidEvent(event)} disabled={saving} className="mt-3 flex items-center gap-1.5 text-xs font-bold text-red-700 hover:text-red-900"><ShieldOff size={15} /> إبطال بسبب موثق</button>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {schoolId != null && !loading && tab === 'cards' && (
        <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(320px,1.1fr)]">
          <section className="min-w-0 space-y-4 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5 print:hidden">
            <div className="flex items-center gap-2"><UserPlus className="text-primary-600" /><h2 className="font-bold text-gray-900">إصدار بطاقة طالب</h2></div>
            <label className="relative block"><Search size={17} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" /><input value={studentQuery} onChange={(event) => setStudentQuery(event.target.value)} placeholder="ابحث بالاسم أو الرقم الطلابي" className="w-full rounded-lg border border-gray-300 py-2.5 pl-3 pr-10 text-sm" /></label>
            <div className="max-h-72 space-y-2 overflow-y-auto">
              {filteredStudents.map((student) => (
                <button key={student.id} type="button" onClick={() => setSelectedStudentId(Number(student.id))} className={`w-full rounded-lg border p-3 text-right ${selectedStudentId === Number(student.id) ? 'border-primary-400 bg-primary-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                  <p className="font-bold text-gray-900">{student.full_name}</p><p className="mt-1 text-xs text-gray-500">{student.student_number} · {student.class_name || '—'}{student.section_name ? ` / ${student.section_name}` : ''}</p>
                </button>
              ))}
            </div>
            <button type="button" onClick={() => void issueCard()} disabled={saving || selectedStudentId == null} className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-3 font-bold text-white disabled:opacity-50"><CreditCard size={18} /> إصدار بطاقة QR</button>
            <Message type="info">لا يمكن إصدار بطاقتين فعالتين للطالب. عند فقدان البطاقة ألغِ القديمة أولًا ثم أصدر بديلة.</Message>
          </section>

          <section className="min-w-0 space-y-4">
            {issuedCard ? (
              <article className={`gate-student-card mx-auto w-full max-w-[86mm] overflow-hidden rounded-2xl border-2 bg-white shadow-lg print:shadow-none ${issuedCard.status === 'active' ? 'border-blue-950' : 'border-red-800'}`} dir="rtl">
                <div className={`px-4 py-3 text-center text-white ${issuedCard.status === 'active' ? 'bg-blue-950' : 'bg-red-800'}`}><p className="text-xs font-semibold text-white/80">نظام المدرسة الذكي</p><h2 className="mt-1 text-lg font-black">بطاقة حضور الطالب</h2></div>
                <div className="grid grid-cols-[1fr_112px] items-center gap-3 p-4">
                  <div className="min-w-0"><p className="text-xs text-gray-500">اسم الطالب</p><p className="mt-1 font-black text-gray-900">{issuedCard.student_name}</p><p className="mt-3 text-xs text-gray-500">الرقم الطلابي</p><bdi dir="ltr" className="mt-1 block font-bold text-gray-800 [unicode-bidi:isolate]">{issuedCard.student_number}</bdi><p className="mt-3 text-sm font-semibold text-gray-700">{issuedCard.class_name || '—'}{issuedCard.section_name ? ` / ${issuedCard.section_name}` : ''}</p></div>
                  <div className="rounded-xl border border-gray-200 bg-white p-2"><QRCodeSVG value={issuedCard.qr_value} size={96} level="H" className="h-auto w-full" /></div>
                </div>
                {issuedCard.status === 'active' ? (
                  <p className="border-t border-gray-200 px-4 py-2 text-center text-[10px] text-gray-500">تُستخدم هذه البطاقة لتسجيل الدخول والخروج فقط. عند فقدانها أبلغ إدارة المدرسة فورًا.</p>
                ) : (
                  <p className="border-t border-red-200 bg-red-50 px-4 py-2 text-center text-xs font-black text-red-800">بطاقة ملغاة — غير صالحة للمسح أو الطباعة</p>
                )}
                {issuedCard.status === 'active' && <button type="button" onClick={() => window.print()} className="m-3 flex w-[calc(100%-1.5rem)] items-center justify-center gap-2 rounded-lg bg-gray-900 px-3 py-2 text-sm font-bold text-white print:hidden"><Printer size={16} /> طباعة البطاقة</button>}
              </article>
            ) : <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-10 text-center text-gray-500 print:hidden"><CreditCard className="mx-auto mb-2 text-gray-300" size={38} />أصدر بطاقة أو اختر بطاقة من القائمة لمعاينتها.</div>}

            <div className="space-y-3 print:hidden">
              <label className="flex items-center gap-2 text-sm font-semibold text-gray-700"><input type="checkbox" checked={showRevoked} onChange={(event) => setShowRevoked(event.target.checked)} /> عرض البطاقات الملغاة</label>
              {cards.map((card) => (
                <article key={card.id} className={`flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-xl border p-3 ${card.status === 'active' ? 'border-gray-200 bg-white' : 'border-gray-200 bg-gray-50 opacity-70'}`}>
                  <button type="button" onClick={() => setIssuedCard(card)} className="min-w-0 flex-1 text-right"><StudentIdentity item={card} /><p className={`mt-1 text-xs font-bold ${card.status === 'active' ? 'text-emerald-700' : 'text-red-700'}`}>{card.status === 'active' ? 'فعالة' : `ملغاة: ${card.revocation_reason || '—'}`}</p></button>
                  {card.status === 'active' && <button type="button" onClick={() => void revokeCard(card)} disabled={saving} className="flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700"><ShieldOff size={15} /> إلغاء</button>}
                </article>
              ))}
            </div>
          </section>
        </div>
      )}

      {schoolId != null && !loading && tab === 'settings' && (
        <section className="mx-auto max-w-3xl space-y-5 rounded-2xl border border-gray-200 bg-white p-4 sm:p-6">
          <div><h2 className="text-lg font-bold text-gray-900">إعدادات دوام البوابة</h2><p className="mt-1 text-sm text-gray-500">تُحفظ أوقات الدوام Snapshot داخل كل حركة حتى لا تتغير السجلات القديمة عند تعديل الإعدادات.</p></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-semibold text-gray-700">بداية الدوام<input type="time" value={settings.school_start_time} onChange={(event) => setSettings((current) => ({ ...current, school_start_time: event.target.value }))} className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2.5" /></label>
            <label className="text-sm font-semibold text-gray-700">سماح التأخير بالدقائق<input type="number" min={0} max={120} value={settings.late_grace_minutes} onChange={(event) => setSettings((current) => ({ ...current, late_grace_minutes: Number(event.target.value) }))} className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2.5" /></label>
            <label className="text-sm font-semibold text-gray-700">نهاية الدوام<input type="time" value={settings.school_end_time} onChange={(event) => setSettings((current) => ({ ...current, school_end_time: event.target.value }))} className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2.5" /></label>
            <label className="text-sm font-semibold text-gray-700">سماح الخروج المبكر بالدقائق<input type="number" min={0} max={120} value={settings.early_exit_grace_minutes} onChange={(event) => setSettings((current) => ({ ...current, early_exit_grace_minutes: Number(event.target.value) }))} className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2.5" /></label>
            <label className="text-sm font-semibold text-gray-700">منع تكرار المسح بالثواني<input type="number" min={5} max={300} value={settings.duplicate_window_seconds} onChange={(event) => setSettings((current) => ({ ...current, duplicate_window_seconds: Number(event.target.value) }))} className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2.5" /></label>
          </div>
          <label className={`flex items-start gap-3 rounded-xl border p-4 ${settings.parent_notifications_enabled ? 'border-blue-200 bg-blue-50' : 'border-gray-200 bg-gray-50'}`}><input type="checkbox" checked={settings.parent_notifications_enabled} onChange={(event) => setSettings((current) => ({ ...current, parent_notifications_enabled: event.target.checked }))} className="mt-1" /><span><strong className="block text-sm text-gray-900">إشعار ولي الأمر عند الدخول والخروج</strong><span className="mt-1 block text-xs text-gray-600">يرسل النظام الإشعار إلى الحساب المرتبط بالطالب فقط، دون كشف الملاحظات الداخلية.</span></span></label>
          <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><AlertTriangle className="mt-0.5 shrink-0" size={18} /><p>تعديل الأوقات يؤثر في الحركات الجديدة فقط. السجلات السابقة تحتفظ بالأوقات التي كانت معتمدة عند تسجيلها.</p></div>
          <button type="button" onClick={() => void saveSettings()} disabled={saving} className="flex items-center gap-2 rounded-lg bg-primary-600 px-5 py-3 font-bold text-white disabled:opacity-50">{saving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />} حفظ الإعدادات</button>
        </section>
      )}
    </div>
  );
}
