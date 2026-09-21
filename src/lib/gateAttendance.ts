import { BUSINESS_TIME_ZONE, businessDate } from './businessTime.ts';

export const GATE_CARD_PREFIX = 'SSG1';

export type GateDirection = 'entry' | 'exit';
export type GateAttendanceStatus = 'on_time' | 'late' | 'normal' | 'early_exit';
export type GateEventSource = 'card' | 'manual';

export const GATE_DIRECTION_LABELS: Record<GateDirection, string> = {
  entry: 'دخول',
  exit: 'خروج',
};

export const GATE_STATUS_LABELS: Record<GateAttendanceStatus, string> = {
  on_time: 'حضور في الوقت',
  late: 'متأخر',
  normal: 'خروج اعتيادي',
  early_exit: 'خروج مبكر',
};

export interface GateAttendanceSettings {
  school_id: number;
  school_start_time: string;
  late_grace_minutes: number;
  school_end_time: string;
  early_exit_grace_minutes: number;
  duplicate_window_seconds: number;
  parent_notifications_enabled: boolean;
  updated_at: number | null;
}

export interface GateAttendanceSettingsInput {
  school_id: number;
  school_start_time: string;
  late_grace_minutes: number;
  school_end_time: string;
  early_exit_grace_minutes: number;
  duplicate_window_seconds: number;
  parent_notifications_enabled: boolean;
}

export interface StudentGateCard {
  id: number;
  public_id: string;
  school_id: number;
  student_id: number;
  student_name: string;
  student_number: string;
  class_name: string | null;
  section_name: string | null;
  status: 'active' | 'revoked';
  issued_at: number;
  revoked_at: number | null;
  revocation_reason: string | null;
  qr_value: string;
}

export interface StudentGateEvent {
  id: number;
  event_key: string;
  school_id: number;
  student_id: number;
  student_name: string;
  student_number: string;
  class_name: string | null;
  section_name: string | null;
  event_type: GateDirection;
  occurred_at: number;
  attendance_date: string;
  attendance_status: GateAttendanceStatus;
  attendance_status_label: string;
  late_minutes: number;
  source: GateEventSource;
  gate_label: string | null;
  note: string | null;
  record_status: 'active' | 'voided';
  void_reason: string | null;
}

export interface ParentGateAttendanceFeed {
  range: { from: string; to: string };
  students: Array<{ id: number; full_name: string; student_number: string }>;
  events: StudentGateEvent[];
}

export interface AppNotification {
  notification_key: string;
  notification_type: string;
  title: string;
  body: string;
  student_id: number | null;
  reference_type: string | null;
  reference_key: string | null;
  created_at: number;
  read_at: number | null;
}

export interface NotificationFeed {
  unread_count: number;
  notifications: AppNotification[];
}

export class GateAttendanceError extends Error {
  readonly code: string;
  readonly status: 400 | 403 | 404 | 409 | 500;

  constructor(
    code: string,
    status: 400 | 403 | 404 | 409 | 500 = 400,
    message?: string,
  ) {
    super(message || gateAttendanceErrorMessage(code));
    this.code = code;
    this.status = status;
  }
}

export function requireGateAttendance(
  condition: unknown,
  code: string,
  status: 400 | 403 | 404 | 409 | 500 = 400,
  message?: string,
): asserts condition {
  if (!condition) throw new GateAttendanceError(code, status, message);
}

function positiveInteger(value: unknown, code: string): number {
  const parsed = Number(value);
  requireGateAttendance(Number.isSafeInteger(parsed) && parsed > 0, code);
  return parsed;
}

function integerInRange(value: unknown, minimum: number, maximum: number, code: string): number {
  const parsed = Number(value);
  requireGateAttendance(Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum, code);
  return parsed;
}

function optionalText(value: unknown, maximum: number, code: string): string | null {
  if (value == null || value === '') return null;
  requireGateAttendance(typeof value === 'string', code);
  const normalized = value.trim();
  if (!normalized) return null;
  requireGateAttendance(normalized.length <= maximum, code);
  return normalized;
}

function requiredText(value: unknown, maximum: number, code: string): string {
  const normalized = optionalText(value, maximum, code);
  requireGateAttendance(normalized != null, code);
  return normalized;
}

function exactObject(value: unknown, allowed: readonly string[], code: string): Record<string, unknown> {
  requireGateAttendance(value && typeof value === 'object' && !Array.isArray(value), code);
  const raw = value as Record<string, unknown>;
  const keys = new Set(allowed);
  requireGateAttendance(Object.keys(raw).every((key) => keys.has(key)), code);
  return raw;
}

export function parseGateDate(value: unknown): string {
  requireGateAttendance(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), 'invalid_gate_date');
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  requireGateAttendance(
    date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day,
    'invalid_gate_date',
  );
  return value;
}

export function validateGateRange(fromValue: unknown, toValue: unknown): { from: string; to: string } {
  const to = toValue == null || toValue === '' ? businessDate() : parseGateDate(toValue);
  const fallback = new Date(`${to}T00:00:00.000Z`);
  fallback.setUTCDate(fallback.getUTCDate() - 30);
  const from = fromValue == null || fromValue === '' ? fallback.toISOString().slice(0, 10) : parseGateDate(fromValue);
  requireGateAttendance(from <= to, 'invalid_gate_range');
  const days = Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
  requireGateAttendance(days <= 366, 'gate_range_too_large');
  return { from, to };
}

function validClock(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) return false;
  const [hours, minutes] = value.split(':').map(Number);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

export function clockMinutes(value: string): number {
  requireGateAttendance(validClock(value), 'invalid_gate_time');
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

export function businessClock(value: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: BUSINESS_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.hour}:${byType.minute}`;
}

export function calculateGateStatus(
  direction: GateDirection,
  clock: string,
  settings: Pick<GateAttendanceSettingsInput, 'school_start_time' | 'late_grace_minutes' | 'school_end_time' | 'early_exit_grace_minutes'>,
): { status: GateAttendanceStatus; lateMinutes: number } {
  const current = clockMinutes(clock);
  const start = clockMinutes(settings.school_start_time);
  const end = clockMinutes(settings.school_end_time);
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

export function parseGateSettingsInput(value: unknown): GateAttendanceSettingsInput {
  const raw = exactObject(value, [
    'school_id',
    'school_start_time',
    'late_grace_minutes',
    'school_end_time',
    'early_exit_grace_minutes',
    'duplicate_window_seconds',
    'parent_notifications_enabled',
  ], 'invalid_gate_settings');
  requireGateAttendance(validClock(raw.school_start_time) && validClock(raw.school_end_time), 'invalid_gate_time');
  requireGateAttendance(clockMinutes(raw.school_end_time) > clockMinutes(raw.school_start_time), 'invalid_gate_time');
  requireGateAttendance(typeof raw.parent_notifications_enabled === 'boolean', 'invalid_gate_notifications');
  return {
    school_id: positiveInteger(raw.school_id, 'invalid_gate_school'),
    school_start_time: raw.school_start_time,
    late_grace_minutes: integerInRange(raw.late_grace_minutes, 0, 120, 'invalid_gate_grace'),
    school_end_time: raw.school_end_time,
    early_exit_grace_minutes: integerInRange(raw.early_exit_grace_minutes, 0, 120, 'invalid_gate_grace'),
    duplicate_window_seconds: integerInRange(raw.duplicate_window_seconds, 5, 300, 'invalid_gate_duplicate_window'),
    parent_notifications_enabled: raw.parent_notifications_enabled,
  };
}

export function parseGateCardIssueInput(value: unknown): { school_id: number; student_id: number } {
  const raw = exactObject(value, ['school_id', 'student_id'], 'invalid_gate_card_request');
  return {
    school_id: positiveInteger(raw.school_id, 'invalid_gate_school'),
    student_id: positiveInteger(raw.student_id, 'invalid_gate_student'),
  };
}

export function parseGateCardRevokeInput(value: unknown): { school_id: number; reason: string } {
  const raw = exactObject(value, ['school_id', 'reason'], 'invalid_gate_card_request');
  return {
    school_id: positiveInteger(raw.school_id, 'invalid_gate_school'),
    reason: requiredText(raw.reason, 500, 'gate_card_revoke_reason_required'),
  };
}

export function parseGateScanInput(value: unknown): {
  school_id: number;
  card_payload: string;
  direction: GateDirection;
  gate_label: string | null;
} {
  const raw = exactObject(value, ['school_id', 'card_payload', 'direction', 'gate_label'], 'invalid_gate_scan');
  requireGateAttendance(raw.direction === 'entry' || raw.direction === 'exit', 'invalid_gate_direction');
  return {
    school_id: positiveInteger(raw.school_id, 'invalid_gate_school'),
    card_payload: requiredText(raw.card_payload, 200, 'invalid_gate_card'),
    direction: raw.direction,
    gate_label: optionalText(raw.gate_label, 100, 'invalid_gate_label'),
  };
}

export function parseManualGateEventInput(value: unknown): {
  school_id: number;
  student_id: number;
  direction: GateDirection;
  occurred_at: number;
  gate_label: string | null;
  note: string | null;
  reason: string;
} {
  const raw = exactObject(value, [
    'school_id', 'student_id', 'direction', 'occurred_at', 'gate_label', 'note', 'reason',
  ], 'invalid_gate_manual_event');
  requireGateAttendance(raw.direction === 'entry' || raw.direction === 'exit', 'invalid_gate_direction');
  return {
    school_id: positiveInteger(raw.school_id, 'invalid_gate_school'),
    student_id: positiveInteger(raw.student_id, 'invalid_gate_student'),
    direction: raw.direction,
    occurred_at: positiveInteger(raw.occurred_at, 'invalid_gate_occurred_at'),
    gate_label: optionalText(raw.gate_label, 100, 'invalid_gate_label'),
    note: optionalText(raw.note, 500, 'invalid_gate_note'),
    reason: requiredText(raw.reason, 500, 'gate_manual_reason_required'),
  };
}

export function parseGateEventVoidInput(value: unknown): { school_id: number; reason: string } {
  const raw = exactObject(value, ['school_id', 'reason'], 'invalid_gate_void');
  return {
    school_id: positiveInteger(raw.school_id, 'invalid_gate_school'),
    reason: requiredText(raw.reason, 500, 'gate_void_reason_required'),
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

async function gateHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

function gateSigningMessage(publicId: string): Uint8Array {
  return new TextEncoder().encode(`smart-school:student-gate-card:v1:${publicId}`);
}

function cryptoBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

export async function createGateCardPayload(publicId: string, secret: string): Promise<string> {
  requireGateAttendance(/^[0-9a-f-]{32,64}$/i.test(publicId), 'invalid_gate_card');
  const signature = await crypto.subtle.sign('HMAC', await gateHmacKey(secret), cryptoBuffer(gateSigningMessage(publicId)));
  return `${GATE_CARD_PREFIX}.${publicId}.${encodeBase64Url(new Uint8Array(signature))}`;
}

export async function verifyGateCardPayload(payload: string, secret: string): Promise<string | null> {
  try {
    const [prefix, publicId, signaturePart, extra] = payload.trim().split('.');
    if (prefix !== GATE_CARD_PREFIX || extra != null || !/^[0-9a-f-]{32,64}$/i.test(publicId)) return null;
    const signature = decodeBase64Url(signaturePart);
    if (signature.length !== 32 || encodeBase64Url(signature) !== signaturePart) return null;
    const valid = await crypto.subtle.verify(
      'HMAC',
      await gateHmacKey(secret),
      signature.buffer.slice(signature.byteOffset, signature.byteOffset + signature.byteLength) as ArrayBuffer,
      cryptoBuffer(gateSigningMessage(publicId)),
    );
    return valid ? publicId : null;
  } catch {
    return null;
  }
}

const ERROR_MESSAGES: Record<string, string> = {
  gate_forbidden: 'غير مسموح: لا تملك صلاحية إدارة حضور البوابة',
  gate_parent_only: 'هذا المسار مخصص لولي الأمر',
  gate_target_required: 'يجب تحديد مدرسة فعالة',
  invalid_gate_request: 'بيانات حضور البوابة غير صالحة',
  invalid_gate_school: 'المدرسة المحددة غير صالحة',
  invalid_gate_student: 'الطالب المحدد غير صالح أو غير مسجل في السنة النشطة',
  invalid_gate_date: 'تاريخ الحضور غير صالح',
  invalid_gate_range: 'نطاق التاريخ غير صالح',
  gate_range_too_large: 'نطاق العرض يجب ألا يتجاوز سنة واحدة',
  invalid_gate_settings: 'إعدادات دوام البوابة غير صالحة',
  invalid_gate_time: 'وقت بداية أو نهاية الدوام غير صالح',
  invalid_gate_grace: 'مدة السماح غير صالحة',
  invalid_gate_duplicate_window: 'نافذة منع التكرار يجب أن تكون بين 5 و300 ثانية',
  invalid_gate_notifications: 'إعداد إشعارات ولي الأمر غير صالح',
  invalid_gate_card_request: 'طلب بطاقة الطالب غير صالح',
  invalid_gate_card: 'بطاقة الطالب غير صالحة أو مزوّرة أو ملغاة',
  gate_card_exists: 'للطالب بطاقة فعالة؛ ألغها أولًا إذا كانت مفقودة',
  gate_card_not_found: 'بطاقة الطالب غير موجودة',
  gate_card_revoke_reason_required: 'سبب إلغاء البطاقة مطلوب',
  invalid_gate_scan: 'بيانات المسح غير صالحة',
  invalid_gate_direction: 'اختر دخولًا أو خروجًا',
  invalid_gate_label: 'اسم البوابة غير صالح',
  gate_scan_duplicate: 'لم يُسجل المسح لأنه مكرر خلال المهلة المحددة',
  invalid_gate_manual_event: 'بيانات التسجيل اليدوي غير صالحة',
  invalid_gate_occurred_at: 'وقت الحضور غير صالح',
  gate_manual_time_out_of_range: 'التسجيل اليدوي يجب أن يكون خلال آخر 30 يومًا ولا يجوز أن يكون في المستقبل',
  invalid_gate_note: 'ملاحظة البوابة غير صالحة',
  gate_manual_reason_required: 'سبب التسجيل اليدوي مطلوب',
  invalid_gate_void: 'طلب إبطال حركة البوابة غير صالح',
  gate_void_reason_required: 'سبب إبطال الحركة مطلوب',
  gate_event_not_found: 'حركة البوابة غير موجودة',
  gate_event_already_voided: 'حركة البوابة مبطلة مسبقًا',
  notification_not_found: 'الإشعار غير موجود أو غير موجه لهذا الحساب',
  gate_failed: 'تعذر تنفيذ عملية حضور البوابة',
};

export function gateAttendanceDatabaseError(error: unknown): GateAttendanceError {
  if (error instanceof GateAttendanceError) return error;
  const detail = String((error as { message?: unknown })?.message || error || '');
  if (/UNIQUE constraint failed: student_gate_cards\.school_id, student_gate_cards\.student_id/i.test(detail)) {
    return new GateAttendanceError('gate_card_exists', 409);
  }
  if (/gate scan duplicate/i.test(detail)) return new GateAttendanceError('gate_scan_duplicate', 409);
  if (/CHECK constraint failed: valid = 1|UNIQUE constraint failed: gate_attendance_write_guards/i.test(detail)) {
    return new GateAttendanceError('gate_event_already_voided', 409);
  }
  if (/gate card invalid/i.test(detail)) return new GateAttendanceError('invalid_gate_card', 409);
  if (/gate event student invalid|gate card student invalid/i.test(detail)) {
    return new GateAttendanceError('invalid_gate_student', 409);
  }
  if (/gate actor invalid|notification (actor|recipient|parent link|scope) invalid/i.test(detail)) {
    return new GateAttendanceError('gate_forbidden', 403);
  }
  return new GateAttendanceError('gate_failed', 500);
}

export function gateAttendanceErrorMessage(code: string): string {
  return ERROR_MESSAGES[code] || ERROR_MESSAGES.gate_failed;
}
