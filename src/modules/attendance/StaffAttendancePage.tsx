import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Clock3,
  CreditCard,
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
  UserCheck,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { SystemAdminSchoolSelector } from '../../components/SystemAdminSchoolSelector';
import { useAuth } from '../../hooks/useAuth';
import { useSchoolRequestGuard } from '../../hooks/useSchoolRequestGuard';
import { useTenantSchool } from '../../hooks/useTenantSchool';
import {
  createManualEmployeeAttendanceEvent,
  getEmployeeAttendanceCards,
  getEmployeeAttendanceEvents,
  getEmployeeAttendanceSummary,
  getMyStaffAttendance,
  getStaffAttendanceEmployees,
  getStaffAttendanceSettings,
  issueEmployeeAttendanceCard,
  revokeEmployeeAttendanceCard,
  saveStaffAttendanceSettings,
  scanEmployeeAttendanceCard,
  voidEmployeeAttendanceEvent,
} from '../../lib/api';
import { defaultAttendanceDate } from '../../lib/attendance';
import {
  STAFF_ATTENDANCE_MANAGEMENT_ROLES,
  STAFF_ATTENDANCE_REPORT_ROLES,
  hasRole,
} from '../../lib/rbac';
import {
  STAFF_ATTENDANCE_DIRECTION_LABELS,
  STAFF_ATTENDANCE_STATUS_LABELS,
  reconcileEmployeeAttendanceCard,
  type EmployeeAttendanceCard,
  type EmployeeAttendanceEvent,
  type EmployeeAttendanceSummary,
  type MyStaffAttendanceFeed,
  type StaffAttendanceDirection,
  type StaffAttendanceEmployee,
  type StaffAttendanceSettings,
  type StaffAttendanceSettingsInput,
} from '../../lib/staffAttendance';

type Tab = 'scanner' | 'report' | 'cards' | 'settings' | 'self';

const DEFAULT_SETTINGS: StaffAttendanceSettingsInput = {
  school_id: 0,
  work_start_time: '08:00',
  late_grace_minutes: 10,
  work_end_time: '14:00',
  early_exit_grace_minutes: 0,
  duplicate_window_seconds: 60,
};

const ROLE_LABELS: Record<string, string> = {
  teacher: 'مدرس',
  accountant: 'محاسب',
  staff: 'موظف',
  principal: 'مدير',
  vice_principal: 'معاون مدير',
  registrar: 'مسؤول تسجيل',
};

const DAY_STATE_LABELS: Record<string, string> = {
  no_record: 'لا توجد حركة',
  inside: 'دخل ولم يسجل الخروج',
  complete: 'مكتمل',
  incomplete: 'سجل خروجًا بلا دخول',
  exception: 'تأخير أو خروج مبكر',
};

const DAY_STATE_STYLES: Record<string, string> = {
  no_record: 'border-gray-200 bg-gray-50 text-gray-700',
  inside: 'border-blue-200 bg-blue-50 text-blue-800',
  complete: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  incomplete: 'border-red-200 bg-red-50 text-red-800',
  exception: 'border-amber-200 bg-amber-50 text-amber-800',
};

const STATUS_STYLES: Record<string, string> = {
  on_time: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  late: 'border-amber-200 bg-amber-50 text-amber-800',
  normal: 'border-blue-200 bg-blue-50 text-blue-800',
  early_exit: 'border-orange-200 bg-orange-50 text-orange-800',
};

function formatTime(seconds: number | null): string {
  if (seconds == null) return '—';
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
  return Math.floor(Date.parse(`${value}:00+03:00`) / 1000);
}

function defaultRange(): { from: string; to: string } {
  const to = defaultAttendanceDate();
  const fromDate = new Date(`${to}T00:00:00Z`);
  fromDate.setUTCDate(fromDate.getUTCDate() - 30);
  return { from: fromDate.toISOString().slice(0, 10), to };
}

function Message({ type, children }: { type: 'error' | 'success' | 'info'; children: React.ReactNode }) {
  const style = type === 'error'
    ? 'border-red-200 bg-red-50 text-red-800'
    : type === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : 'border-blue-200 bg-blue-50 text-blue-800';
  return <div role={type === 'error' ? 'alert' : 'status'} className={`rounded-xl border px-4 py-3 text-sm ${style}`}>{children}</div>;
}

function EmployeeIdentity({ item }: { item: { employee_name?: string; full_name?: string; employee_number: string | null; employee_role?: string; role?: string; job_title: string | null } }) {
  const role = item.employee_role || item.role || 'staff';
  return (
    <div className="min-w-0">
      <p className="truncate font-bold text-gray-900">{item.employee_name || item.full_name}</p>
      <p className="mt-0.5 truncate text-xs text-gray-500">
        {item.employee_number ? <bdi dir="ltr" className="[unicode-bidi:isolate]">{item.employee_number}</bdi> : 'بلا رقم وظيفي'}
        {' · '}{item.job_title || ROLE_LABELS[role] || role}
      </p>
    </div>
  );
}

function EventStatus({ event }: { event: EmployeeAttendanceEvent }) {
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${STATUS_STYLES[event.attendance_status] || 'border-gray-200 bg-gray-50 text-gray-700'}`}>
      {STAFF_ATTENDANCE_STATUS_LABELS[event.attendance_status]}
      {event.attendance_status === 'late' ? ` · ${event.late_minutes} دقيقة` : ''}
    </span>
  );
}

export default function StaffAttendancePage() {
  const { user } = useAuth();
  const schoolScope = useTenantSchool();
  const { schoolId } = schoolScope;
  const captureSchoolRequest = useSchoolRequestGuard(schoolId);
  const canManage = hasRole(user?.role_key, STAFF_ATTENDANCE_MANAGEMENT_ROLES);
  const canReport = hasRole(user?.role_key, STAFF_ATTENDANCE_REPORT_ROLES);
  const isTeacher = user?.role_key === 'teacher';
  const [tab, setTab] = useState<Tab>(isTeacher ? 'self' : canManage ? 'scanner' : 'report');
  const [date, setDate] = useState(defaultAttendanceDate());
  const [range, setRange] = useState(defaultRange());
  const [settings, setSettings] = useState<StaffAttendanceSettingsInput>(DEFAULT_SETTINGS);
  const [employees, setEmployees] = useState<StaffAttendanceEmployee[]>([]);
  const [events, setEvents] = useState<EmployeeAttendanceEvent[]>([]);
  const [summary, setSummary] = useState<EmployeeAttendanceSummary[]>([]);
  const [cards, setCards] = useState<EmployeeAttendanceCard[]>([]);
  const [selfFeed, setSelfFeed] = useState<MyStaffAttendanceFeed | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [direction, setDirection] = useState<StaffAttendanceDirection>('entry');
  const [gateLabel, setGateLabel] = useState('البوابة الرئيسية');
  const [cardPayload, setCardPayload] = useState('');
  const [scanResult, setScanResult] = useState<EmployeeAttendanceEvent | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [employeeQuery, setEmployeeQuery] = useState('');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<number | null>(null);
  const [issuedCard, setIssuedCard] = useState<EmployeeAttendanceCard | null>(null);
  const [showRevoked, setShowRevoked] = useState(false);

  const [manualEmployeeId, setManualEmployeeId] = useState<number | null>(null);
  const [manualDirection, setManualDirection] = useState<StaffAttendanceDirection>('entry');
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

  const loadReport = useCallback(async () => {
    if (schoolId == null || !canReport) return;
    const valid = captureSchoolRequest();
    const [eventsResponse, summaryResponse] = await Promise.all([
      getEmployeeAttendanceEvents(schoolId, date),
      getEmployeeAttendanceSummary(schoolId, date),
    ]);
    if (!valid()) return;
    const failure = eventsResponse.error || summaryResponse.error;
    if (failure) setError(failure);
    setEvents(eventsResponse.data || []);
    setSummary(summaryResponse.data || []);
  }, [canReport, captureSchoolRequest, date, schoolId]);

  const loadCards = useCallback(async () => {
    if (schoolId == null || !canManage) return;
    const valid = captureSchoolRequest();
    const response = await getEmployeeAttendanceCards(schoolId, '', showRevoked ? 'all' : 'active');
    if (!valid()) return;
    if (response.error) setError(response.error);
    else {
      const refreshed = response.data || [];
      setCards(refreshed);
      setIssuedCard((current) => reconcileEmployeeAttendanceCard(current, refreshed));
    }
  }, [canManage, captureSchoolRequest, schoolId, showRevoked]);

  const loadSelf = useCallback(async () => {
    if (!isTeacher) return;
    const response = await getMyStaffAttendance(range.from, range.to);
    if (response.error) setError(response.error);
    else setSelfFeed(response.data || null);
  }, [isTeacher, range.from, range.to]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError('');
    if (isTeacher) {
      await loadSelf();
      setLoading(false);
      return;
    }
    if (schoolId == null) {
      setLoading(false);
      return;
    }
    const valid = captureSchoolRequest();
    if (canManage) {
      const [settingsResponse, employeesResponse, cardsResponse, eventsResponse, summaryResponse] = await Promise.all([
        getStaffAttendanceSettings(schoolId),
        getStaffAttendanceEmployees(schoolId),
        getEmployeeAttendanceCards(schoolId, '', showRevoked ? 'all' : 'active'),
        getEmployeeAttendanceEvents(schoolId, date),
        getEmployeeAttendanceSummary(schoolId, date),
      ]);
      if (!valid()) return;
      const failure = settingsResponse.error || employeesResponse.error || cardsResponse.error || eventsResponse.error || summaryResponse.error;
      if (failure) setError(failure);
      if (settingsResponse.data) {
        const row: StaffAttendanceSettings = settingsResponse.data;
        setSettings({
          school_id: schoolId,
          work_start_time: row.work_start_time,
          late_grace_minutes: row.late_grace_minutes,
          work_end_time: row.work_end_time,
          early_exit_grace_minutes: row.early_exit_grace_minutes,
          duplicate_window_seconds: row.duplicate_window_seconds,
        });
      }
      setEmployees(employeesResponse.data || []);
      const refreshed = cardsResponse.data || [];
      setCards(refreshed);
      setIssuedCard((current) => reconcileEmployeeAttendanceCard(current, refreshed));
      setEvents(eventsResponse.data || []);
      setSummary(summaryResponse.data || []);
    } else if (canReport) {
      await loadReport();
    }
    setLoading(false);
  }, [canManage, canReport, captureSchoolRequest, date, isTeacher, loadReport, loadSelf, schoolId, showRevoked]);

  useEffect(() => {
    setSettings({ ...DEFAULT_SETTINGS, school_id: schoolId || 0 });
    setEmployees([]);
    setEvents([]);
    setSummary([]);
    setCards([]);
    setIssuedCard(null);
    setSelectedEmployeeId(null);
    setManualEmployeeId(null);
    setEmployeeQuery('');
    setCardPayload('');
    setManualReason('');
    setManualNote('');
    setSaving(false);
    setScanResult(null);
    setSelfFeed(null);
    setError('');
    setSuccess('');
    stopCamera();
    void loadAll();
  }, [schoolId, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isTeacher && schoolId != null && canReport) void loadReport();
  }, [date]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (canManage && schoolId != null) void loadCards();
  }, [showRevoked]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => stopCamera(), [stopCamera]);

  const filteredEmployees = useMemo(() => {
    const query = employeeQuery.trim().toLocaleLowerCase('ar');
    if (!query) return employees.slice(0, 30);
    return employees.filter((employee) => (
      employee.full_name.toLocaleLowerCase('ar').includes(query)
      || String(employee.employee_number || '').toLocaleLowerCase('ar').includes(query)
      || String(employee.job_title || '').toLocaleLowerCase('ar').includes(query)
    )).slice(0, 50);
  }, [employeeQuery, employees]);

  const counts = useMemo(() => ({
    active: events.filter((event) => event.record_status === 'active').length,
    entry: events.filter((event) => event.record_status === 'active' && event.event_type === 'entry').length,
    exit: events.filter((event) => event.record_status === 'active' && event.event_type === 'exit').length,
    exceptions: events.filter((event) => event.record_status === 'active' && ['late', 'early_exit'].includes(event.attendance_status)).length,
  }), [events]);

  const submitScan = useCallback(async (payload?: string) => {
    const value = (payload ?? cardPayload).trim();
    if (schoolId == null || saving || !value || !canManage) return;
    const valid = captureSchoolRequest();
    setSaving(true);
    setError('');
    setSuccess('');
    const response = await scanEmployeeAttendanceCard({
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
      setSuccess(`تم تسجيل ${STAFF_ATTENDANCE_DIRECTION_LABELS[response.data.event_type]} ${response.data.employee_name}.`);
      setCardPayload('');
      await loadReport();
    }
    setSaving(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [canManage, captureSchoolRequest, cardPayload, direction, gateLabel, loadReport, saving, schoolId]);

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
    if (schoolId == null || selectedEmployeeId == null || saving || !canManage) return;
    const valid = captureSchoolRequest();
    setSaving(true);
    setError('');
    setSuccess('');
    const response = await issueEmployeeAttendanceCard(schoolId, selectedEmployeeId);
    if (!valid()) return;
    if (response.error) setError(response.error);
    else if (response.data) {
      setIssuedCard(response.data);
      setSuccess('تم إصدار بطاقة الموظف. اطبعها أو احفظها الآن.');
      await loadCards();
    }
    setSaving(false);
  }

  async function revokeCard(card: EmployeeAttendanceCard) {
    if (schoolId == null || saving || !canManage) return;
    const reason = window.prompt(`اكتب سبب إلغاء بطاقة ${card.employee_name}:`, 'البطاقة مفقودة');
    if (!reason?.trim()) return;
    const valid = captureSchoolRequest();
    setSaving(true);
    setError('');
    const response = await revokeEmployeeAttendanceCard(card.id, schoolId, reason.trim());
    if (!valid()) return;
    if (response.error) setError(response.error);
    else {
      setSuccess('أُلغيت البطاقة وبقي سجلها التاريخي محفوظًا.');
      await loadCards();
    }
    setSaving(false);
  }

  async function saveManualEvent() {
    if (schoolId == null || manualEmployeeId == null || saving || !manualReason.trim() || !canManage) return;
    const occurredAt = baghdadDateTimeEpoch(manualTime);
    if (!Number.isFinite(occurredAt)) {
      setError('وقت التسجيل اليدوي غير صالح.');
      return;
    }
    const valid = captureSchoolRequest();
    setSaving(true);
    setError('');
    const response = await createManualEmployeeAttendanceEvent({
      school_id: schoolId,
      employee_id: manualEmployeeId,
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
      await loadReport();
    }
    setSaving(false);
  }

  async function voidEvent(event: EmployeeAttendanceEvent) {
    if (schoolId == null || saving || event.record_status !== 'active' || !canManage) return;
    const reason = window.prompt(`سبب إبطال حركة ${event.employee_name}:`);
    if (!reason?.trim()) return;
    const valid = captureSchoolRequest();
    setSaving(true);
    setError('');
    const response = await voidEmployeeAttendanceEvent(event.id, schoolId, reason.trim());
    if (!valid()) return;
    if (response.error) setError(response.error);
    else {
      setSuccess('أُبطلت الحركة مع الاحتفاظ بها وسبب الإبطال في سجل التدقيق.');
      await loadReport();
    }
    setSaving(false);
  }

  async function saveSettings() {
    if (schoolId == null || saving || !canManage) return;
    const valid = captureSchoolRequest();
    setSaving(true);
    setError('');
    const response = await saveStaffAttendanceSettings({ ...settings, school_id: schoolId });
    if (!valid()) return;
    if (response.error) setError(response.error);
    else if (response.data) {
      setSettings({ ...response.data, school_id: schoolId });
      setSuccess('تم حفظ أوقات دوام الموظفين ونافذة منع التكرار.');
    }
    setSaving(false);
  }

  const tabs: Array<{ key: Tab; label: string; icon: React.ReactNode }> = isTeacher
    ? [{ key: 'self', label: 'سجل حضوري', icon: <UserCheck size={17} /> }]
    : [
        ...(canManage ? [
          { key: 'scanner' as Tab, label: 'المسح والتسجيل', icon: <ScanLine size={17} /> },
        ] : []),
        { key: 'report', label: 'التقرير اليومي', icon: <Clock3 size={17} /> },
        ...(canManage ? [
          { key: 'cards' as Tab, label: 'بطاقات الموظفين', icon: <CreditCard size={17} /> },
          { key: 'settings' as Tab, label: 'الإعدادات', icon: <Settings size={17} /> },
        ] : []),
      ];

  return (
    <div className="min-w-0 space-y-5" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-50 text-primary-700"><UserCheck size={23} /></div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">حضور الموظفين والأساتذة</h1>
            <p className="text-sm text-gray-500">بطاقة موظف مستقلة، دخول وخروج موثق، وتقارير لا تختلط بحضور الطلاب.</p>
          </div>
        </div>
        <button type="button" onClick={() => void loadAll()} disabled={loading || (!isTeacher && schoolId == null)} className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> تحديث
        </button>
      </div>

      {!isTeacher && <div className="print:hidden"><SystemAdminSchoolSelector {...schoolScope} /></div>}

      <nav className="flex max-w-full gap-2 overflow-x-auto rounded-xl border border-gray-200 bg-white p-2 print:hidden" aria-label="أقسام حضور الموظفين">
        {tabs.map((item) => (
          <button key={item.key} type="button" onClick={() => { if (item.key !== 'scanner') stopCamera(); setTab(item.key); setError(''); setSuccess(''); }} className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold ${tab === item.key ? 'bg-primary-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
            {item.icon}{item.label}
          </button>
        ))}
      </nav>

      {error && <div className="print:hidden"><Message type="error">{error}</Message></div>}
      {success && <div className="print:hidden"><Message type="success">{success}</Message></div>}
      {!isTeacher && schoolId == null ? <Message type="info">اختر مدرسة نشطة للبدء.</Message> : loading ? (
        <div className="flex min-h-52 items-center justify-center gap-2 text-gray-500"><Loader2 className="animate-spin" /> جاري تحميل حضور الموظفين...</div>
      ) : null}

      {!loading && isTeacher && tab === 'self' && (
        <section className="min-w-0 space-y-4 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="grid grid-cols-2 gap-2">
              <label className="text-sm font-semibold text-gray-700">من<input type="date" value={range.from} onChange={(event) => setRange((current) => ({ ...current, from: event.target.value }))} className="mt-1 block min-w-0 rounded-lg border border-gray-300 px-3 py-2" /></label>
              <label className="text-sm font-semibold text-gray-700">إلى<input type="date" value={range.to} onChange={(event) => setRange((current) => ({ ...current, to: event.target.value }))} className="mt-1 block min-w-0 rounded-lg border border-gray-300 px-3 py-2" /></label>
            </div>
            <button type="button" onClick={() => void loadSelf()} className="rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-bold text-white">عرض السجل</button>
          </div>
          {selfFeed && <EmployeeIdentity item={{ employee_name: selfFeed.employee.full_name, employee_number: selfFeed.employee.employee_number, employee_role: selfFeed.employee.role, job_title: selfFeed.employee.job_title }} />}
          {selfFeed?.events.length ? (
            <div className="grid min-w-0 gap-3 lg:grid-cols-2">
              {selfFeed.events.map((event) => (
                <article key={event.id} className="min-w-0 rounded-xl border border-gray-200 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3"><span className="font-bold text-gray-900">{STAFF_ATTENDANCE_DIRECTION_LABELS[event.event_type]} · {formatTime(event.occurred_at)}</span><EventStatus event={event} /></div>
                  <p className="mt-2 text-xs text-gray-500">{event.attendance_date}{event.gate_label ? ` · ${event.gate_label}` : ''}</p>
                </article>
              ))}
            </div>
          ) : <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-10 text-center text-gray-500">لا توجد حركات مؤكدة ضمن النطاق المحدد.</div>}
        </section>
      )}

      {!loading && canManage && schoolId != null && tab === 'scanner' && (
        <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.8fr)]">
          <section className="min-w-0 space-y-4 rounded-2xl border border-gray-200 bg-white p-4 sm:p-6">
            <div className="grid grid-cols-2 gap-2">
              {(['entry', 'exit'] as StaffAttendanceDirection[]).map((value) => (
                <button key={value} type="button" onClick={() => setDirection(value)} className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-3 font-bold ${direction === value ? (value === 'entry' ? 'border-emerald-400 bg-emerald-50 text-emerald-800' : 'border-blue-400 bg-blue-50 text-blue-800') : 'border-gray-200 text-gray-600'}`}>
                  {value === 'entry' ? <LogIn size={20} /> : <LogOut size={20} />}{STAFF_ATTENDANCE_DIRECTION_LABELS[value]}
                </button>
              ))}
            </div>
            <label className="block text-sm font-semibold text-gray-700">اسم البوابة أو جهاز المسح<input value={gateLabel} maxLength={100} onChange={(event) => setGateLabel(event.target.value)} className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2.5" /></label>
            <form onSubmit={(event) => { event.preventDefault(); void submitScan(); }} className="space-y-3">
              <label className="block text-sm font-semibold text-gray-700">رمز بطاقة الموظف<input ref={inputRef} autoFocus value={cardPayload} onChange={(event) => setCardPayload(event.target.value)} placeholder="وجّه قارئ USB إلى البطاقة أو امسحها بالكاميرا" autoComplete="off" className="mt-1 block w-full rounded-xl border-2 border-primary-200 px-4 py-3 font-mono text-sm focus:border-primary-500 focus:outline-none" /></label>
              <div className="flex flex-wrap gap-2">
                <button type="submit" disabled={saving || !cardPayload.trim()} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-3 font-bold text-white disabled:opacity-50">{saving ? <Loader2 className="animate-spin" size={18} /> : <ScanLine size={18} />} تسجيل {STAFF_ATTENDANCE_DIRECTION_LABELS[direction]}</button>
                <button type="button" onClick={cameraActive ? stopCamera : () => void startCamera()} className="flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-3 font-bold text-gray-700 hover:bg-gray-50">{cameraActive ? <X size={18} /> : <Camera size={18} />}{cameraActive ? 'إيقاف الكاميرا' : 'مسح بالكاميرا'}</button>
              </div>
            </form>
            <div className={cameraActive ? 'block' : 'hidden'}><video ref={videoRef} muted playsInline className="aspect-video w-full rounded-xl bg-gray-950 object-cover" aria-label="معاينة كاميرا مسح QR" /><p className="mt-2 text-center text-xs text-gray-500">ضع QR داخل الصورة؛ سيُسجل تلقائيًا مرة واحدة.</p></div>
            {scanResult && (
              <article className="rounded-2xl border border-emerald-300 bg-emerald-50 p-4" aria-live="polite">
                <div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-center gap-3"><CheckCircle2 className="shrink-0 text-emerald-600" /><EmployeeIdentity item={scanResult} /></div><EventStatus event={scanResult} /></div>
                <p className="mt-3 text-sm text-emerald-900">{STAFF_ATTENDANCE_DIRECTION_LABELS[scanResult.event_type]} الساعة {formatTime(scanResult.occurred_at)}</p>
              </article>
            )}
          </section>

          <aside className="min-w-0 space-y-4">
            <section className="grid grid-cols-2 gap-2 rounded-2xl border border-gray-200 bg-white p-4">
              <div className="rounded-xl bg-gray-50 p-3 text-center"><p className="text-2xl font-black text-gray-900">{counts.active}</p><p className="text-xs text-gray-500">الحركات</p></div>
              <div className="rounded-xl bg-amber-50 p-3 text-center"><p className="text-2xl font-black text-amber-800">{counts.exceptions}</p><p className="text-xs text-amber-700">استثناءات</p></div>
              <div className="rounded-xl bg-emerald-50 p-3 text-center"><p className="text-2xl font-black text-emerald-800">{counts.entry}</p><p className="text-xs text-emerald-700">دخول</p></div>
              <div className="rounded-xl bg-blue-50 p-3 text-center"><p className="text-2xl font-black text-blue-800">{counts.exit}</p><p className="text-xs text-blue-700">خروج</p></div>
            </section>
            <details className="rounded-2xl border border-gray-200 bg-white p-4">
              <summary className="cursor-pointer font-bold text-gray-900">تسجيل يدوي بسبب موثق</summary>
              <div className="mt-4 space-y-3">
                <select value={manualEmployeeId ?? ''} onChange={(event) => setManualEmployeeId(event.target.value ? Number(event.target.value) : null)} className="block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm"><option value="">اختر الموظف</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.full_name} — {employee.employee_number || employee.job_title || ROLE_LABELS[employee.role] || employee.role}</option>)}</select>
                <div className="grid grid-cols-2 gap-2"><select value={manualDirection} onChange={(event) => setManualDirection(event.target.value as StaffAttendanceDirection)} className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm"><option value="entry">دخول</option><option value="exit">خروج</option></select><input type="datetime-local" value={manualTime} max={baghdadDateTimeInput()} onChange={(event) => setManualTime(event.target.value)} className="min-w-0 rounded-lg border border-gray-300 px-2 py-2.5 text-sm" /></div>
                <textarea value={manualReason} onChange={(event) => setManualReason(event.target.value)} maxLength={500} rows={2} placeholder="سبب التسجيل اليدوي (إلزامي)" className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                <textarea value={manualNote} onChange={(event) => setManualNote(event.target.value)} maxLength={500} rows={2} placeholder="ملاحظة داخلية اختيارية" className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                <button type="button" onClick={() => void saveManualEvent()} disabled={saving || manualEmployeeId == null || !manualReason.trim()} className="flex w-full items-center justify-center gap-2 rounded-lg bg-gray-900 px-3 py-2.5 text-sm font-bold text-white disabled:opacity-50"><Save size={16} /> حفظ التسجيل اليدوي</button>
              </div>
            </details>
          </aside>
        </div>
      )}

      {!loading && canReport && schoolId != null && tab === 'report' && (
        <section className="min-w-0 space-y-5 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
          <div className="flex flex-wrap items-end justify-between gap-3"><label className="text-sm font-semibold text-gray-700">تاريخ التقرير<input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="mt-1 block rounded-lg border border-gray-300 px-3 py-2" /></label><div className="flex flex-wrap gap-2 text-xs font-bold"><span className="rounded-full bg-gray-100 px-3 py-1.5">الحركات {counts.active}</span><span className="rounded-full bg-amber-100 px-3 py-1.5 text-amber-800">الاستثناءات {counts.exceptions}</span></div></div>
          <div className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {summary.map((row) => (
              <article key={row.employee_id} className="min-w-0 rounded-xl border border-gray-200 p-4">
                <div className="flex min-w-0 items-start justify-between gap-2"><EmployeeIdentity item={row} /><span className={`shrink-0 rounded-full border px-2 py-1 text-[11px] font-bold ${DAY_STATE_STYLES[row.day_state]}`}>{DAY_STATE_LABELS[row.day_state]}</span></div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs"><div className="rounded-lg bg-emerald-50 p-2"><span className="text-emerald-700">أول دخول</span><strong className="mt-1 block text-emerald-950">{formatTime(row.first_entry_at)}</strong></div><div className="rounded-lg bg-blue-50 p-2"><span className="text-blue-700">آخر خروج</span><strong className="mt-1 block text-blue-950">{formatTime(row.last_exit_at)}</strong></div></div>
                {(row.late_entries > 0 || row.early_exits > 0) && <p className="mt-2 text-xs font-semibold text-amber-800">تأخير: {row.late_entries} ({row.late_minutes} دقيقة) · خروج مبكر: {row.early_exits}</p>}
              </article>
            ))}
          </div>
          <div className="border-t border-gray-200 pt-4"><h2 className="mb-3 font-bold text-gray-900">الحركات التفصيلية</h2>{events.length === 0 ? <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-10 text-center text-gray-500"><Users className="mx-auto mb-2 text-gray-300" />لا توجد حركات في هذا التاريخ.</div> : <div className="grid min-w-0 gap-3 lg:grid-cols-2">{events.map((event) => <article key={event.id} className={`min-w-0 rounded-xl border p-4 ${event.record_status === 'voided' ? 'border-gray-200 bg-gray-50 opacity-70' : 'border-gray-200 bg-white'}`}><div className="flex flex-wrap items-start justify-between gap-3"><EmployeeIdentity item={event} /><EventStatus event={event} /></div><div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-gray-500"><span className="font-bold text-gray-700">{STAFF_ATTENDANCE_DIRECTION_LABELS[event.event_type]}</span><span>{formatTime(event.occurred_at)}</span><span>{event.source === 'manual' ? 'تسجيل يدوي' : 'بطاقة QR'}</span>{event.gate_label && <span>{event.gate_label}</span>}</div>{canManage && event.manual_reason && <p className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-900"><strong>سبب الإدخال اليدوي:</strong> {event.manual_reason}</p>}{event.record_status === 'voided' ? <p className="mt-3 rounded-lg bg-gray-200 px-3 py-2 text-xs font-semibold text-gray-700">مبطلة{event.void_reason ? `: ${event.void_reason}` : ''}</p> : canManage ? <button type="button" onClick={() => void voidEvent(event)} disabled={saving} className="mt-3 flex items-center gap-1.5 text-xs font-bold text-red-700 hover:text-red-900"><ShieldOff size={15} /> إبطال بسبب موثق</button> : null}</article>)}</div>}</div>
          <Message type="info">التقرير للمتابعة والمراجعة فقط؛ لا ينشئ خصمًا أو راتبًا تلقائيًا.</Message>
        </section>
      )}

      {!loading && canManage && schoolId != null && tab === 'cards' && (
        <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(320px,1.1fr)]">
          <section className="min-w-0 space-y-4 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5 print:hidden">
            <div className="flex items-center gap-2"><UserPlus className="text-primary-600" /><h2 className="font-bold text-gray-900">إصدار بطاقة موظف</h2></div>
            <label className="relative block"><Search size={17} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" /><input value={employeeQuery} onChange={(event) => setEmployeeQuery(event.target.value)} placeholder="ابحث بالاسم أو الرقم الوظيفي" className="w-full rounded-lg border border-gray-300 py-2.5 pl-3 pr-10 text-sm" /></label>
            <div className="max-h-72 space-y-2 overflow-y-auto">{filteredEmployees.map((employee) => <button key={employee.id} type="button" onClick={() => setSelectedEmployeeId(employee.id)} className={`w-full rounded-lg border p-3 text-right ${selectedEmployeeId === employee.id ? 'border-primary-400 bg-primary-50' : 'border-gray-200 hover:bg-gray-50'}`}><EmployeeIdentity item={employee} /></button>)}</div>
            <button type="button" onClick={() => void issueCard()} disabled={saving || selectedEmployeeId == null} className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-3 font-bold text-white disabled:opacity-50"><CreditCard size={18} /> إصدار بطاقة QR</button>
            <Message type="info">للموظف بطاقة فعالة واحدة فقط. عند فقدانها ألغِ القديمة أولًا ثم أصدر بديلة.</Message>
          </section>
          <section className="min-w-0 space-y-4">
            {issuedCard ? <article className={`staff-attendance-card mx-auto w-full max-w-[86mm] overflow-hidden rounded-2xl border-2 bg-white shadow-lg print:shadow-none ${issuedCard.status === 'active' ? 'border-slate-950' : 'border-red-800'}`} dir="rtl"><div className={`px-4 py-3 text-center text-white ${issuedCard.status === 'active' ? 'bg-slate-950' : 'bg-red-800'}`}><p className="text-xs font-semibold text-white/80">نظام المدرسة الذكي</p><h2 className="mt-1 text-lg font-black">بطاقة حضور الموظف</h2></div><div className="grid grid-cols-[1fr_112px] items-center gap-3 p-4"><div className="min-w-0"><p className="text-xs text-gray-500">اسم الموظف</p><p className="mt-1 font-black text-gray-900">{issuedCard.employee_name}</p><p className="mt-3 text-xs text-gray-500">الرقم الوظيفي</p><bdi dir="ltr" className="mt-1 block font-bold text-gray-800 [unicode-bidi:isolate]">{issuedCard.employee_number || '—'}</bdi><p className="mt-3 text-sm font-semibold text-gray-700">{issuedCard.job_title || ROLE_LABELS[issuedCard.employee_role] || issuedCard.employee_role}</p></div><div className="rounded-xl border border-gray-200 bg-white p-2"><QRCodeSVG value={issuedCard.qr_value} size={96} level="H" className="h-auto w-full" /></div></div>{issuedCard.status === 'active' ? <p className="border-t border-gray-200 px-4 py-2 text-center text-[10px] text-gray-500">تُستخدم لتسجيل دخول الموظف وخروجه فقط. عند فقدانها أبلغ الإدارة فورًا.</p> : <p className="border-t border-red-200 bg-red-50 px-4 py-2 text-center text-xs font-black text-red-800">بطاقة ملغاة — غير صالحة للمسح أو الطباعة</p>}{issuedCard.status === 'active' && <button type="button" onClick={() => window.print()} className="m-3 flex w-[calc(100%-1.5rem)] items-center justify-center gap-2 rounded-lg bg-gray-900 px-3 py-2 text-sm font-bold text-white print:hidden"><Printer size={16} /> طباعة البطاقة</button>}</article> : <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-10 text-center text-gray-500 print:hidden"><CreditCard className="mx-auto mb-2 text-gray-300" size={38} />أصدر بطاقة أو اختر بطاقة من القائمة لمعاينتها.</div>}
            <div className="space-y-3 print:hidden"><label className="flex items-center gap-2 text-sm font-semibold text-gray-700"><input type="checkbox" checked={showRevoked} onChange={(event) => setShowRevoked(event.target.checked)} /> عرض البطاقات الملغاة</label>{cards.map((card) => <article key={card.id} className={`flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-xl border p-3 ${card.status === 'active' ? 'border-gray-200 bg-white' : 'border-gray-200 bg-gray-50 opacity-70'}`}><button type="button" onClick={() => setIssuedCard(card)} className="min-w-0 flex-1 text-right"><EmployeeIdentity item={card} /><p className={`mt-1 text-xs font-bold ${card.status === 'active' ? 'text-emerald-700' : 'text-red-700'}`}>{card.status === 'active' ? 'فعالة' : `ملغاة: ${card.revocation_reason || '—'}`}</p></button>{card.status === 'active' && <button type="button" onClick={() => void revokeCard(card)} disabled={saving} className="flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700"><ShieldOff size={15} /> إلغاء</button>}</article>)}</div>
          </section>
        </div>
      )}

      {!loading && canManage && schoolId != null && tab === 'settings' && (
        <section className="mx-auto max-w-3xl space-y-5 rounded-2xl border border-gray-200 bg-white p-4 sm:p-6">
          <div><h2 className="text-lg font-bold text-gray-900">إعدادات دوام الموظفين</h2><p className="mt-1 text-sm text-gray-500">منفصلة عن أوقات بوابة الطلاب، وتُحفظ Snapshot داخل كل حركة.</p></div>
          <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-semibold text-gray-700">بداية الدوام<input type="time" value={settings.work_start_time} onChange={(event) => setSettings((current) => ({ ...current, work_start_time: event.target.value }))} className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2.5" /></label><label className="text-sm font-semibold text-gray-700">سماح التأخير بالدقائق<input type="number" min={0} max={120} value={settings.late_grace_minutes} onChange={(event) => setSettings((current) => ({ ...current, late_grace_minutes: Number(event.target.value) }))} className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2.5" /></label><label className="text-sm font-semibold text-gray-700">نهاية الدوام<input type="time" value={settings.work_end_time} onChange={(event) => setSettings((current) => ({ ...current, work_end_time: event.target.value }))} className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2.5" /></label><label className="text-sm font-semibold text-gray-700">سماح الخروج المبكر بالدقائق<input type="number" min={0} max={120} value={settings.early_exit_grace_minutes} onChange={(event) => setSettings((current) => ({ ...current, early_exit_grace_minutes: Number(event.target.value) }))} className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2.5" /></label><label className="text-sm font-semibold text-gray-700">منع تكرار المسح بالثواني<input type="number" min={5} max={300} value={settings.duplicate_window_seconds} onChange={(event) => setSettings((current) => ({ ...current, duplicate_window_seconds: Number(event.target.value) }))} className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2.5" /></label></div>
          <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><AlertTriangle className="mt-0.5 shrink-0" size={18} /><p>تعديل الأوقات يؤثر في الحركات الجديدة فقط. لا يحذف أو يعيد تصنيف السجلات التاريخية، ولا ينشئ خصومات راتب تلقائيًا.</p></div>
          <button type="button" onClick={() => void saveSettings()} disabled={saving} className="flex items-center gap-2 rounded-lg bg-primary-600 px-5 py-3 font-bold text-white disabled:opacity-50">{saving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />} حفظ الإعدادات</button>
        </section>
      )}
    </div>
  );
}
