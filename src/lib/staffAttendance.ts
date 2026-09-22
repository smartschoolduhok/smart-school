import { BUSINESS_TIME_ZONE, businessDate } from './businessTime.ts';

export const STAFF_ATTENDANCE_CARD_PREFIX = 'SSE1';

export type StaffAttendanceDirection = 'entry' | 'exit';
export type StaffAttendanceStatus = 'on_time' | 'late' | 'normal' | 'early_exit';
export type StaffAttendanceSource = 'card' | 'manual';

export const STAFF_ATTENDANCE_DIRECTION_LABELS: Record<StaffAttendanceDirection, string> = {
  entry: 'دخول',
  exit: 'خروج',
};

export const STAFF_ATTENDANCE_STATUS_LABELS: Record<StaffAttendanceStatus, string> = {
  on_time: 'حضور في الوقت',
  late: 'متأخر',
  normal: 'خروج اعتيادي',
  early_exit: 'خروج مبكر',
};

export interface StaffAttendanceSettings {
  school_id: number;
  work_start_time: string;
  late_grace_minutes: number;
  work_end_time: string;
  early_exit_grace_minutes: number;
  duplicate_window_seconds: number;
  updated_at: number | null;
}

export type StaffAttendanceSettingsInput = Omit<StaffAttendanceSettings, 'updated_at'>;

export interface StaffAttendanceEmployee {
  id: number;
  full_name: string;
  employee_number: string | null;
  role: string;
  job_title: string | null;
}

export interface EmployeeAttendanceCard {
  id: number;
  public_id: string;
  school_id: number;
  employee_id: number;
  employee_name: string;
  employee_number: string | null;
  employee_role: string;
  job_title: string | null;
  status: 'active' | 'revoked';
  issued_at: number;
  revoked_at: number | null;
  revocation_reason: string | null;
  qr_value: string;
}

export interface EmployeeAttendanceEvent {
  id: number;
  event_key: string;
  school_id: number;
  employee_id: number;
  academic_year_id: number;
  employee_name: string;
  employee_number: string | null;
  employee_role: string;
  job_title: string | null;
  event_type: StaffAttendanceDirection;
  occurred_at: number;
  attendance_date: string;
  attendance_status: StaffAttendanceStatus;
  attendance_status_label: string;
  late_minutes: number;
  source: StaffAttendanceSource;
  gate_label: string | null;
  note: string | null;
  manual_reason: string | null;
  record_status: 'active' | 'voided';
  void_reason: string | null;
}

export type EmployeeAttendanceDayState = 'no_record' | 'inside' | 'complete' | 'incomplete' | 'exception';

export interface EmployeeAttendanceSummary {
  employee_id: number;
  employee_name: string;
  employee_number: string | null;
  employee_role: string;
  job_title: string | null;
  attendance_date: string;
  first_entry_at: number | null;
  last_exit_at: number | null;
  entry_count: number;
  exit_count: number;
  late_entries: number;
  early_exits: number;
  late_minutes: number;
  day_state: EmployeeAttendanceDayState;
}

export interface MyStaffAttendanceFeed {
  range: { from: string; to: string };
  employee: StaffAttendanceEmployee;
  events: EmployeeAttendanceEvent[];
}

export function reconcileEmployeeAttendanceCard(
  current: EmployeeAttendanceCard | null,
  refreshedCards: EmployeeAttendanceCard[],
): EmployeeAttendanceCard | null {
  if (current == null) return null;
  return refreshedCards.find((card) => card.id === current.id) || null;
}

export class StaffAttendanceError extends Error {
  readonly code: string;
  readonly status: 400 | 403 | 404 | 409 | 500;

  constructor(
    code: string,
    status: 400 | 403 | 404 | 409 | 500 = 400,
    message?: string,
  ) {
    super(message || staffAttendanceErrorMessage(code));
    this.code = code;
    this.status = status;
  }
}

export function requireStaffAttendance(
  condition: unknown,
  code: string,
  status: 400 | 403 | 404 | 409 | 500 = 400,
  message?: string,
): asserts condition {
  if (!condition) throw new StaffAttendanceError(code, status, message);
}

function exactObject(value: unknown, allowed: readonly string[], code: string): Record<string, unknown> {
  requireStaffAttendance(value && typeof value === 'object' && !Array.isArray(value), code);
  const raw = value as Record<string, unknown>;
  const keys = new Set(allowed);
  requireStaffAttendance(Object.keys(raw).every((key) => keys.has(key)), code);
  return raw;
}

function positiveInteger(value: unknown, code: string): number {
  const parsed = Number(value);
  requireStaffAttendance(Number.isSafeInteger(parsed) && parsed > 0, code);
  return parsed;
}

function integerInRange(value: unknown, minimum: number, maximum: number, code: string): number {
  const parsed = Number(value);
  requireStaffAttendance(Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum, code);
  return parsed;
}

function optionalText(value: unknown, maximum: number, code: string): string | null {
  if (value == null || value === '') return null;
  requireStaffAttendance(typeof value === 'string', code);
  const normalized = value.trim();
  if (!normalized) return null;
  requireStaffAttendance(normalized.length <= maximum, code);
  return normalized;
}

function requiredText(value: unknown, maximum: number, code: string): string {
  const normalized = optionalText(value, maximum, code);
  requireStaffAttendance(normalized != null, code);
  return normalized;
}

function validClock(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) return false;
  const [hours, minutes] = value.split(':').map(Number);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

function clockMinutes(value: string): number {
  requireStaffAttendance(validClock(value), 'invalid_staff_attendance_time');
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

export function staffBusinessClock(value: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: BUSINESS_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.hour}:${byType.minute}`;
}

export function calculateStaffAttendanceStatus(
  direction: StaffAttendanceDirection,
  clock: string,
  settings: Pick<StaffAttendanceSettingsInput, 'work_start_time' | 'late_grace_minutes' | 'work_end_time' | 'early_exit_grace_minutes'>,
): { status: StaffAttendanceStatus; lateMinutes: number } {
  const current = clockMinutes(clock);
  const start = clockMinutes(settings.work_start_time);
  const end = clockMinutes(settings.work_end_time);
  if (direction === 'entry') {
    const lateMinutes = Math.max(0, current - start);
    return current > start + settings.late_grace_minutes
      ? { status: 'late', lateMinutes }
      : { status: 'on_time', lateMinutes: 0 };
  }
  return current < end - settings.early_exit_grace_minutes
    ? { status: 'early_exit', lateMinutes: 0 }
    : { status: 'normal', lateMinutes: 0 };
}

export function parseStaffAttendanceDate(value: unknown): string {
  requireStaffAttendance(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), 'invalid_staff_attendance_date');
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  requireStaffAttendance(
    date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day,
    'invalid_staff_attendance_date',
  );
  return value;
}

export function validateStaffAttendanceRange(fromValue: unknown, toValue: unknown): { from: string; to: string } {
  const to = toValue == null || toValue === '' ? businessDate() : parseStaffAttendanceDate(toValue);
  const fallback = new Date(`${to}T00:00:00.000Z`);
  fallback.setUTCDate(fallback.getUTCDate() - 30);
  const from = fromValue == null || fromValue === ''
    ? fallback.toISOString().slice(0, 10)
    : parseStaffAttendanceDate(fromValue);
  requireStaffAttendance(from <= to, 'invalid_staff_attendance_range');
  const days = Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
  requireStaffAttendance(days <= 366, 'staff_attendance_range_too_large');
  return { from, to };
}

export function parseStaffAttendanceSettingsInput(value: unknown): StaffAttendanceSettingsInput {
  const raw = exactObject(value, [
    'school_id', 'work_start_time', 'late_grace_minutes', 'work_end_time',
    'early_exit_grace_minutes', 'duplicate_window_seconds',
  ], 'invalid_staff_attendance_settings');
  requireStaffAttendance(validClock(raw.work_start_time) && validClock(raw.work_end_time), 'invalid_staff_attendance_time');
  requireStaffAttendance(clockMinutes(raw.work_end_time) > clockMinutes(raw.work_start_time), 'invalid_staff_attendance_time');
  return {
    school_id: positiveInteger(raw.school_id, 'invalid_staff_attendance_school'),
    work_start_time: raw.work_start_time,
    late_grace_minutes: integerInRange(raw.late_grace_minutes, 0, 120, 'invalid_staff_attendance_grace'),
    work_end_time: raw.work_end_time,
    early_exit_grace_minutes: integerInRange(raw.early_exit_grace_minutes, 0, 120, 'invalid_staff_attendance_grace'),
    duplicate_window_seconds: integerInRange(raw.duplicate_window_seconds, 5, 300, 'invalid_staff_attendance_duplicate_window'),
  };
}

export function parseEmployeeAttendanceCardIssueInput(value: unknown): { school_id: number; employee_id: number } {
  const raw = exactObject(value, ['school_id', 'employee_id'], 'invalid_staff_attendance_card_request');
  return {
    school_id: positiveInteger(raw.school_id, 'invalid_staff_attendance_school'),
    employee_id: positiveInteger(raw.employee_id, 'invalid_staff_attendance_employee'),
  };
}

export function parseEmployeeAttendanceCardRevokeInput(value: unknown): { school_id: number; reason: string } {
  const raw = exactObject(value, ['school_id', 'reason'], 'invalid_staff_attendance_card_request');
  return {
    school_id: positiveInteger(raw.school_id, 'invalid_staff_attendance_school'),
    reason: requiredText(raw.reason, 500, 'staff_attendance_card_revoke_reason_required'),
  };
}

export function parseStaffAttendanceScanInput(value: unknown): {
  school_id: number;
  card_payload: string;
  direction: StaffAttendanceDirection;
  gate_label: string | null;
} {
  const raw = exactObject(value, ['school_id', 'card_payload', 'direction', 'gate_label'], 'invalid_staff_attendance_scan');
  requireStaffAttendance(raw.direction === 'entry' || raw.direction === 'exit', 'invalid_staff_attendance_direction');
  return {
    school_id: positiveInteger(raw.school_id, 'invalid_staff_attendance_school'),
    card_payload: requiredText(raw.card_payload, 200, 'invalid_staff_attendance_card'),
    direction: raw.direction,
    gate_label: optionalText(raw.gate_label, 100, 'invalid_staff_attendance_gate_label'),
  };
}

export function parseManualStaffAttendanceEventInput(value: unknown): {
  school_id: number;
  employee_id: number;
  direction: StaffAttendanceDirection;
  occurred_at: number;
  gate_label: string | null;
  note: string | null;
  reason: string;
} {
  const raw = exactObject(value, [
    'school_id', 'employee_id', 'direction', 'occurred_at', 'gate_label', 'note', 'reason',
  ], 'invalid_staff_attendance_manual_event');
  requireStaffAttendance(raw.direction === 'entry' || raw.direction === 'exit', 'invalid_staff_attendance_direction');
  return {
    school_id: positiveInteger(raw.school_id, 'invalid_staff_attendance_school'),
    employee_id: positiveInteger(raw.employee_id, 'invalid_staff_attendance_employee'),
    direction: raw.direction,
    occurred_at: positiveInteger(raw.occurred_at, 'invalid_staff_attendance_occurred_at'),
    gate_label: optionalText(raw.gate_label, 100, 'invalid_staff_attendance_gate_label'),
    note: optionalText(raw.note, 500, 'invalid_staff_attendance_note'),
    reason: requiredText(raw.reason, 500, 'staff_attendance_manual_reason_required'),
  };
}

export function parseStaffAttendanceEventVoidInput(value: unknown): { school_id: number; reason: string } {
  const raw = exactObject(value, ['school_id', 'reason'], 'invalid_staff_attendance_void');
  return {
    school_id: positiveInteger(raw.school_id, 'invalid_staff_attendance_school'),
    reason: requiredText(raw.reason, 500, 'staff_attendance_void_reason_required'),
  };
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeBase64Url(value: string): Uint8Array {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + padding);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function staffAttendanceHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

function signingMessage(publicId: string): Uint8Array {
  return new TextEncoder().encode(`smart-school:employee-attendance-card:v1:${publicId}`);
}

function cryptoBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

export async function createEmployeeAttendanceCardPayload(publicId: string, secret: string): Promise<string> {
  requireStaffAttendance(/^[0-9a-f-]{32,64}$/i.test(publicId), 'invalid_staff_attendance_card');
  const signature = await crypto.subtle.sign(
    'HMAC',
    await staffAttendanceHmacKey(secret),
    cryptoBuffer(signingMessage(publicId)),
  );
  return `${STAFF_ATTENDANCE_CARD_PREFIX}.${publicId}.${encodeBase64Url(new Uint8Array(signature))}`;
}

export async function verifyEmployeeAttendanceCardPayload(payload: string, secret: string): Promise<string | null> {
  try {
    const [prefix, publicId, signaturePart, extra] = payload.trim().split('.');
    if (prefix !== STAFF_ATTENDANCE_CARD_PREFIX || extra != null || !/^[0-9a-f-]{32,64}$/i.test(publicId)) return null;
    const signature = decodeBase64Url(signaturePart);
    if (signature.length !== 32 || encodeBase64Url(signature) !== signaturePart) return null;
    const valid = await crypto.subtle.verify(
      'HMAC',
      await staffAttendanceHmacKey(secret),
      signature.buffer.slice(signature.byteOffset, signature.byteOffset + signature.byteLength) as ArrayBuffer,
      cryptoBuffer(signingMessage(publicId)),
    );
    return valid ? publicId : null;
  } catch {
    return null;
  }
}

const ERROR_MESSAGES: Record<string, string> = {
  staff_attendance_forbidden: 'غير مسموح: لا تملك صلاحية إدارة حضور الموظفين',
  staff_attendance_report_forbidden: 'غير مسموح: لا تملك صلاحية الاطلاع على حضور الموظفين',
  staff_attendance_self_only: 'السجل الشخصي متاح للمدرس المرتبط بملف موظف فعال فقط',
  staff_attendance_target_required: 'يجب تحديد مدرسة فعالة',
  invalid_staff_attendance_request: 'بيانات حضور الموظفين غير صالحة',
  invalid_staff_attendance_school: 'المدرسة المحددة غير صالحة',
  invalid_staff_attendance_employee: 'الموظف المحدد غير صالح أو غير نشط',
  invalid_staff_attendance_date: 'تاريخ الحضور غير صالح',
  invalid_staff_attendance_range: 'نطاق التاريخ غير صالح',
  staff_attendance_range_too_large: 'نطاق العرض يجب ألا يتجاوز سنة واحدة',
  invalid_staff_attendance_settings: 'إعدادات دوام الموظفين غير صالحة',
  invalid_staff_attendance_time: 'وقت بداية أو نهاية دوام الموظفين غير صالح',
  invalid_staff_attendance_grace: 'مدة السماح غير صالحة',
  invalid_staff_attendance_duplicate_window: 'نافذة منع التكرار يجب أن تكون بين 5 و300 ثانية',
  invalid_staff_attendance_card_request: 'طلب بطاقة الموظف غير صالح',
  invalid_staff_attendance_card: 'بطاقة الموظف غير صالحة أو مزوّرة أو ملغاة',
  staff_attendance_card_exists: 'للموظف بطاقة فعالة؛ ألغها أولًا إذا كانت مفقودة',
  staff_attendance_card_not_found: 'بطاقة الموظف غير موجودة',
  staff_attendance_card_revoke_reason_required: 'سبب إلغاء البطاقة مطلوب',
  invalid_staff_attendance_scan: 'بيانات المسح غير صالحة',
  invalid_staff_attendance_direction: 'اختر دخولًا أو خروجًا',
  invalid_staff_attendance_gate_label: 'اسم البوابة غير صالح',
  staff_attendance_scan_duplicate: 'لم يُسجل المسح لأنه مكرر خلال المهلة المحددة',
  invalid_staff_attendance_manual_event: 'بيانات التسجيل اليدوي غير صالحة',
  invalid_staff_attendance_occurred_at: 'وقت الحضور غير صالح',
  staff_attendance_manual_time_out_of_range: 'التسجيل اليدوي يجب أن يكون خلال آخر 30 يومًا ولا يجوز أن يكون في المستقبل',
  invalid_staff_attendance_note: 'ملاحظة الحضور غير صالحة',
  staff_attendance_manual_reason_required: 'سبب التسجيل اليدوي مطلوب',
  invalid_staff_attendance_void: 'طلب إبطال حركة الحضور غير صالح',
  staff_attendance_void_reason_required: 'سبب إبطال الحركة مطلوب',
  staff_attendance_event_not_found: 'حركة حضور الموظف غير موجودة',
  staff_attendance_event_already_voided: 'حركة حضور الموظف مبطلة مسبقًا',
  staff_attendance_failed: 'تعذر تنفيذ عملية حضور الموظفين',
};

export function staffAttendanceDatabaseError(error: unknown): StaffAttendanceError {
  if (error instanceof StaffAttendanceError) return error;
  const detail = String((error as { message?: unknown })?.message || error || '');
  if (/UNIQUE constraint failed: employee_attendance_cards\.school_id, employee_attendance_cards\.employee_id/i.test(detail)) {
    return new StaffAttendanceError('staff_attendance_card_exists', 409);
  }
  if (/staff attendance scan duplicate/i.test(detail)) {
    return new StaffAttendanceError('staff_attendance_scan_duplicate', 409);
  }
  if (/CHECK constraint failed: valid = 1|UNIQUE constraint failed: employee_attendance_write_guards/i.test(detail)) {
    return new StaffAttendanceError('staff_attendance_event_already_voided', 409);
  }
  if (/staff attendance card invalid/i.test(detail)) {
    return new StaffAttendanceError('invalid_staff_attendance_card', 409);
  }
  if (/staff attendance employee invalid/i.test(detail)) {
    return new StaffAttendanceError('invalid_staff_attendance_employee', 409);
  }
  if (/staff attendance actor invalid/i.test(detail)) {
    return new StaffAttendanceError('staff_attendance_forbidden', 403);
  }
  return new StaffAttendanceError('staff_attendance_failed', 500);
}

export function staffAttendanceErrorMessage(code: string): string {
  return ERROR_MESSAGES[code] || ERROR_MESSAGES.staff_attendance_failed;
}
