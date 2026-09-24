export const HOMEWORK_MAX_ATTACHMENTS = 5;
export const HOMEWORK_MAX_FILE_BYTES = 5 * 1024 * 1024;
export const HOMEWORK_MAX_TOTAL_BYTES = 20 * 1024 * 1024;
export const HOMEWORK_STORAGE_MAX_BYTES = 1_000_000_000;
export const HOMEWORK_ACCEPTED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;

export type HomeworkMimeType = (typeof HOMEWORK_ACCEPTED_MIME_TYPES)[number];
export type HomeworkStatus = 'draft' | 'published' | 'withdrawn';

export interface HomeworkObjectBody {
  body?: ReadableStream<Uint8Array> | null;
  httpMetadata?: { contentType?: string; contentDisposition?: string } | null;
  arrayBuffer?: () => Promise<ArrayBuffer>;
}

export interface HomeworkObjectStore {
  put(
    key: string,
    value: Uint8Array | ArrayBuffer | ReadableStream<Uint8Array>,
    options?: {
      httpMetadata?: { contentType?: string; contentDisposition?: string };
      customMetadata?: Record<string, string>;
    },
  ): Promise<unknown>;
  get(key: string): Promise<HomeworkObjectBody | null>;
  delete(key: string): Promise<unknown>;
  list(options?: {
    cursor?: string;
    limit?: number;
    include?: Array<'httpMetadata' | 'customMetadata'>;
  }): Promise<{
    objects: Array<{
      key: string;
      size: number;
      customMetadata?: Record<string, string>;
    }>;
    truncated: boolean;
    cursor?: string;
  }>;
}

export interface HomeworkScope {
  id: number;
  school_id: number;
  academic_year_id: number;
  academic_year_name: string;
  class_id: number;
  class_name: string;
  section_id: number | null;
  section_name: string | null;
  subject_id: number;
  subject_name: string;
  teacher_employee_id: number;
  teacher_name: string;
}

export interface HomeworkAttachment {
  attachment_key: string;
  original_name: string;
  mime_type: HomeworkMimeType;
  size_bytes: number;
  sha256: string;
  status: 'upload_pending' | 'active' | 'removal_pending' | 'removed';
  created_at: number;
}

export interface ParentHomeworkAttachment {
  attachment_key: string;
  original_name: string;
  mime_type: HomeworkMimeType;
  size_bytes: number;
}

export interface HomeworkAudienceStudent {
  student_id: number;
  student_name: string;
  student_number: string;
}

export interface HomeworkRecord {
  homework_key: string;
  school_id: number;
  academic_year_id: number;
  academic_year_name: string;
  teaching_load_id: number;
  class_id: number;
  class_name: string;
  section_id: number | null;
  section_name: string | null;
  subject_id: number;
  subject_name: string;
  teacher_employee_id: number;
  teacher_name: string;
  title: string;
  instructions: string;
  assigned_date: string;
  due_at: number | null;
  status: HomeworkStatus;
  revision: number;
  replaces_homework_key: string | null;
  created_by_user_id: number;
  published_at: number | null;
  withdrawn_at: number | null;
  withdrawal_reason: string | null;
  created_at: number;
  updated_at: number;
  attachments: HomeworkAttachment[];
  audience: HomeworkAudienceStudent[];
}

export interface ParentHomeworkItem {
  homework_key: string;
  class_name: string;
  section_name: string | null;
  subject_name: string;
  teacher_name: string;
  title: string;
  instructions: string;
  assigned_date: string;
  due_at: number | null;
  attachments: ParentHomeworkAttachment[];
  students: Array<{ id: number; full_name: string; student_number: string }>;
}

export interface ParentHomeworkFeed {
  homework: ParentHomeworkItem[];
}

export interface HomeworkDraftInput {
  school_id: number;
  teaching_load_id: number;
  title: string;
  instructions: string;
  assigned_date: string;
  due_at: number | null;
}

export interface HomeworkEditInput {
  school_id: number;
  revision: number;
  title: string;
  instructions: string;
  assigned_date: string;
  due_at: number | null;
}

export interface HomeworkReplacementInput {
  school_id: number;
  title: string;
  instructions: string;
  assigned_date: string;
  due_at: number | null;
}

export type HomeworkErrorStatus = 400 | 403 | 404 | 409 | 413 | 500 | 503 | 507;

export class HomeworkError extends Error {
  readonly code: string;
  readonly status: HomeworkErrorStatus;

  constructor(code: string, status: HomeworkErrorStatus = 400, message?: string) {
    super(message || homeworkErrorMessage(code));
    this.code = code;
    this.status = status;
  }
}

export function requireHomework(
  condition: unknown,
  code: string,
  status: HomeworkErrorStatus = 400,
  message?: string,
): asserts condition {
  if (!condition) throw new HomeworkError(code, status, message);
}

export function homeworkErrorMessage(code: string): string {
  const messages: Record<string, string> = {
    homework_forbidden: 'غير مسموح بالوصول إلى الواجبات المنزلية',
    homework_target_required: 'يجب اختيار مدرسة فعالة',
    invalid_homework_request: 'بيانات الواجب غير صالحة',
    invalid_homework_school: 'المدرسة غير صالحة',
    invalid_homework_load: 'التكليف التدريسي غير صالح أو غير متاح',
    invalid_homework_date: 'تاريخ الواجب غير صالح',
    invalid_homework_due_at: 'موعد التسليم غير صالح',
    homework_not_found: 'الواجب غير موجود',
    homework_stale: 'تغيّر الواجب أو نُفذت العملية مسبقًا؛ حدّث الصفحة وحاول مجددًا',
    homework_draft_required: 'هذه العملية متاحة للمسودة فقط',
    homework_published_required: 'هذه العملية متاحة للواجب المنشور فقط',
    homework_withdrawn_required: 'يجب سحب الواجب قبل إنشاء نسخة مصححة',
    homework_audience_empty: 'لا يوجد طلاب مؤهلون لنشر هذا الواجب',
    homework_replacement_exists: 'توجد نسخة مصححة مرتبطة بهذا الواجب بالفعل',
    homework_withdraw_reason_required: 'سبب سحب الواجب إلزامي',
    homework_files_unavailable: 'خدمة مرفقات الواجبات غير مهيأة في هذه البيئة',
    homework_attachment_not_found: 'المرفق غير موجود',
    homework_attachment_required: 'اختر ملفًا لإرفاقه',
    homework_attachment_too_large: 'حجم الملف يتجاوز 5 ميغابايت',
    homework_attachment_limit: 'الحد الأقصى خمسة مرفقات فعالة للواجب',
    homework_attachment_total_limit: 'إجمالي المرفقات يتجاوز 20 ميغابايت',
    homework_attachment_cleanup_pending: 'تعذر تنظيف المرفق من التخزين؛ أعد محاولة الإزالة قبل نشر الواجب',
    homework_storage_quota_exceeded: 'بلغ مخزن مرفقات الواجبات في بيئة الاختبار سقف التخزين المسموح',
    homework_storage_reconciliation_failed: 'تعذر إثبات تطابق مخزن المرفقات مع بياناته الوصفية؛ أُوقف الرفع احترازيًا',
    invalid_homework_attachment_type: 'نوع الملف غير مدعوم',
    invalid_homework_attachment_signature: 'محتوى الملف لا يطابق نوعه المعلن',
    invalid_homework_attachment_name: 'اسم الملف غير صالح',
    homework_failed: 'تعذر إكمال عملية الواجب',
  };
  return messages[code] || messages.homework_failed;
}

function exactObject(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  requireHomework(value != null && typeof value === 'object' && !Array.isArray(value), 'invalid_homework_request');
  const raw = value as Record<string, unknown>;
  const allowedKeys = new Set(allowed);
  requireHomework(Object.keys(raw).every(key => allowedKeys.has(key)), 'invalid_homework_request');
  return raw;
}

function positiveInteger(value: unknown, code: string): number {
  const parsed = Number(value);
  requireHomework(Number.isSafeInteger(parsed) && parsed > 0, code);
  return parsed;
}

function nonNegativeInteger(value: unknown, code = 'invalid_homework_request'): number {
  const parsed = Number(value);
  requireHomework(Number.isSafeInteger(parsed) && parsed >= 0, code);
  return parsed;
}

function requiredText(value: unknown, maximum: number): string {
  requireHomework(typeof value === 'string', 'invalid_homework_request');
  const normalized = value.trim();
  requireHomework(normalized.length >= 1 && normalized.length <= maximum, 'invalid_homework_request');
  return normalized;
}

function optionalEpoch(value: unknown): number | null {
  if (value == null || value === '') return null;
  return positiveInteger(value, 'invalid_homework_due_at');
}

export function parseHomeworkDate(value: unknown): string {
  requireHomework(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), 'invalid_homework_date');
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  requireHomework(
    parsed.getUTCFullYear() === year && parsed.getUTCMonth() + 1 === month && parsed.getUTCDate() === day,
    'invalid_homework_date',
  );
  return value;
}

function validateDueAt(assignedDate: string, dueAt: number | null): void {
  if (dueAt == null) return;
  const assignedStart = Math.floor(Date.parse(`${assignedDate}T00:00:00+03:00`) / 1000);
  requireHomework(Number.isFinite(assignedStart) && dueAt >= assignedStart, 'invalid_homework_due_at');
}

export function parseHomeworkDraftInput(value: unknown): HomeworkDraftInput {
  const raw = exactObject(value, [
    'school_id', 'teaching_load_id', 'title', 'instructions', 'assigned_date', 'due_at',
  ]);
  const assignedDate = parseHomeworkDate(raw.assigned_date);
  const dueAt = optionalEpoch(raw.due_at);
  validateDueAt(assignedDate, dueAt);
  return {
    school_id: positiveInteger(raw.school_id, 'invalid_homework_school'),
    teaching_load_id: positiveInteger(raw.teaching_load_id, 'invalid_homework_load'),
    title: requiredText(raw.title, 200),
    instructions: requiredText(raw.instructions, 5000),
    assigned_date: assignedDate,
    due_at: dueAt,
  };
}

export function parseHomeworkEditInput(value: unknown): HomeworkEditInput {
  const raw = exactObject(value, [
    'school_id', 'revision', 'title', 'instructions', 'assigned_date', 'due_at',
  ]);
  const assignedDate = parseHomeworkDate(raw.assigned_date);
  const dueAt = optionalEpoch(raw.due_at);
  validateDueAt(assignedDate, dueAt);
  return {
    school_id: positiveInteger(raw.school_id, 'invalid_homework_school'),
    revision: nonNegativeInteger(raw.revision),
    title: requiredText(raw.title, 200),
    instructions: requiredText(raw.instructions, 5000),
    assigned_date: assignedDate,
    due_at: dueAt,
  };
}

export function parseHomeworkRevisionInput(value: unknown): { school_id: number; revision: number } {
  const raw = exactObject(value, ['school_id', 'revision']);
  return {
    school_id: positiveInteger(raw.school_id, 'invalid_homework_school'),
    revision: nonNegativeInteger(raw.revision),
  };
}

export function parseHomeworkWithdrawInput(value: unknown): { school_id: number; revision: number; reason: string } {
  const raw = exactObject(value, ['school_id', 'revision', 'reason']);
  return {
    school_id: positiveInteger(raw.school_id, 'invalid_homework_school'),
    revision: nonNegativeInteger(raw.revision),
    reason: requiredText(raw.reason, 500),
  };
}

export function parseHomeworkReplacementInput(value: unknown): HomeworkReplacementInput {
  const raw = exactObject(value, ['school_id', 'title', 'instructions', 'assigned_date', 'due_at']);
  const assignedDate = parseHomeworkDate(raw.assigned_date);
  const dueAt = optionalEpoch(raw.due_at);
  validateDueAt(assignedDate, dueAt);
  return {
    school_id: positiveInteger(raw.school_id, 'invalid_homework_school'),
    title: requiredText(raw.title, 200),
    instructions: requiredText(raw.instructions, 5000),
    assigned_date: assignedDate,
    due_at: dueAt,
  };
}

export function parseHomeworkAttachmentFormFields(
  schoolId: FormDataEntryValue | null,
  revision: FormDataEntryValue | null,
): { school_id: number; revision: number } {
  requireHomework(typeof schoolId === 'string' && typeof revision === 'string', 'invalid_homework_request');
  return {
    school_id: positiveInteger(schoolId, 'invalid_homework_school'),
    revision: nonNegativeInteger(revision),
  };
}

export function sanitizeHomeworkFileName(value: string): string {
  const normalized = value
    .normalize('NFKC')
    .replace(/[\\/\u0000-\u001f\u007f]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  requireHomework(normalized.length >= 1 && normalized.length <= 255, 'invalid_homework_attachment_name');
  return normalized;
}

export function isHomeworkMimeType(value: string): value is HomeworkMimeType {
  return (HOMEWORK_ACCEPTED_MIME_TYPES as readonly string[]).includes(value);
}

function matches(bytes: Uint8Array, expected: readonly number[], offset = 0): boolean {
  return expected.every((value, index) => bytes[offset + index] === value);
}

export function validateHomeworkAttachmentBytes(mimeType: string, bytes: Uint8Array): boolean {
  if (mimeType === 'image/jpeg') return bytes.length >= 3 && matches(bytes, [0xff, 0xd8, 0xff]);
  if (mimeType === 'image/png') {
    return bytes.length >= 8 && matches(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  }
  if (mimeType === 'image/webp') {
    return bytes.length >= 12
      && matches(bytes, [0x52, 0x49, 0x46, 0x46])
      && matches(bytes, [0x57, 0x45, 0x42, 0x50], 8);
  }
  if (mimeType === 'application/pdf') {
    return bytes.length >= 5 && matches(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]);
  }
  return false;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const input = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', input));
  return [...digest].map(value => value.toString(16).padStart(2, '0')).join('');
}

export function homeworkDatabaseError(error: unknown): HomeworkError {
  if (error instanceof HomeworkError) return error;
  const detail = String((error as { message?: unknown })?.message || error);
  const mappings: Array<[string, string, HomeworkErrorStatus]> = [
    ['homework storage quota exceeded', 'homework_storage_quota_exceeded', 507],
    ['homework attachment cleanup pending', 'homework_attachment_cleanup_pending', 409],
    ['homework attachment limit exceeded', 'homework_attachment_limit', 409],
    ['homework attachment total exceeded', 'homework_attachment_total_limit', 409],
    ['homework attachment draft required', 'homework_draft_required', 409],
    ['homework attachment actor invalid', 'homework_forbidden', 403],
    ['homework teacher forbidden', 'homework_forbidden', 403],
    ['homework actor invalid', 'homework_forbidden', 403],
    ['homework load invalid', 'invalid_homework_load', 409],
    ['homework date invalid', 'invalid_homework_date', 400],
    ['homework write guard missing', 'homework_stale', 409],
    ['homework audience write guard missing', 'homework_stale', 409],
    ['homework audience invalid', 'homework_stale', 409],
    ['homework transition actor mismatch', 'homework_stale', 409],
    ['homework replacement invalid', 'homework_withdrawn_required', 409],
    ['homework published immutable', 'homework_published_required', 409],
    ['homework transition invalid', 'homework_stale', 409],
    ['homework revision invalid', 'homework_stale', 409],
    ['UNIQUE constraint failed: homework_assignments.replaces_homework_id', 'homework_replacement_exists', 409],
    ['CHECK constraint failed: valid = 1', 'homework_stale', 409],
    ['UNIQUE constraint failed', 'homework_stale', 409],
  ];
  for (const [needle, code, status] of mappings) {
    if (detail.includes(needle)) return new HomeworkError(code, status);
  }
  return new HomeworkError('homework_failed', 500);
}
