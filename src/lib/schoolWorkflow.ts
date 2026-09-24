import type { Context } from 'hono';
import type { Bindings, Variables } from '../worker';
import type { RoleKey } from '../types';

export type WorkflowContext = Context<{ Bindings: Bindings; Variables: Variables }>;
export class WorkflowError extends Error {
  readonly code: string;
  readonly status: 400 | 403 | 404 | 409 | 429 | 503;
  constructor(code: string, message: string, status: 400 | 403 | 404 | 409 | 429 | 503 = 400) { super(message); this.code = code; this.status = status; }
}
export function ensure(value: unknown, code: string, message: string, status: WorkflowError['status'] = 400): asserts value {
  if (!value) throw new WorkflowError(code, message, status);
}
export function positiveId(value: unknown): number {
  ensure((typeof value === 'number' || typeof value === 'string') && String(value).trim() !== '', 'invalid_id', 'المعرف غير صالح');
  const id = Number(value);
  ensure(Number.isSafeInteger(id) && id > 0, 'invalid_id', 'المعرف غير صالح');
  return id;
}
export function uuid(value: unknown): string {
  ensure(typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value), 'invalid_key', 'معرف العملية غير صالح');
  return value.toLowerCase();
}
export function boundedText(value: unknown, max: number): string {
  ensure(typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max, 'invalid_text', `النص مطلوب وبحد أقصى ${max} حرفًا`);
  return value.trim();
}
export async function workflowBody(c: WorkflowContext, keys: string[]): Promise<Record<string, any>> {
  const text = await c.req.text();
  ensure(text.length <= 32_000, 'request_too_large', 'الطلب كبير جدًا');
  let value: any;
  try { value = JSON.parse(text); } catch { throw new WorkflowError('invalid_json', 'صيغة الطلب غير صالحة'); }
  ensure(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key)), 'invalid_request', 'الطلب يحتوي حقولًا غير صالحة');
  return value;
}
export async function workflowSchool(c: WorkflowContext, requested: unknown, roles: readonly RoleKey[]): Promise<number> {
  const user = c.get('user');
  ensure(user && roles.includes(user.role_key), 'forbidden', 'غير مسموح بالوصول', 403);
  const schoolId = requested == null || requested === '' ? user.school_id : positiveId(requested);
  ensure(schoolId != null, 'school_required', 'اختر المدرسة أولًا');
  ensure(user.role_key === 'system_admin' || user.school_id === schoolId, 'forbidden', 'غير مسموح بالوصول', 403);
  ensure(await c.env.DB.prepare("SELECT id FROM schools WHERE id=? AND status='active'").bind(schoolId).first(), 'school_inactive', 'المدرسة غير متاحة', 403);
  return schoolId;
}
export async function workflowResponse(c: WorkflowContext, operation: () => Promise<Response>): Promise<Response> {
  try { return await operation(); } catch (error) {
    if (error instanceof WorkflowError) return c.json({ error: error.message, code: error.code }, error.status);
    const detail = String((error as Error)?.message || error);
    if (/communication_|workflow_write_guard|grade_progress_|admission_|regulation_/i.test(detail)) {
      return c.json({ error: 'تغيرت البيانات أو الصلاحيات؛ أعد التحميل وحاول مجددًا', code: 'workflow_conflict' }, 409);
    }
    console.error('[school-workflow]', c.env.APP_ENV === 'test' ? detail : 'operation_failed');
    return c.json({ error: 'تعذر إكمال العملية', code: 'workflow_unavailable' }, 503);
  }
}
