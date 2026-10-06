import type { Hono } from 'hono';
import type { Bindings, Variables } from '../worker';
import { SCHOOL_MANAGEMENT_ROLES, hasRole } from './rbac';
import { boundedText, ensure, positiveId, workflowBody, workflowSchool, WorkflowError, type WorkflowContext } from './schoolWorkflow';
import { parseRegisterData, registerDefinition, validRegisterDate, SchoolRegisterValidationError,
  type SchoolRegisterEntry, type SchoolRegisterHistory } from './schoolRegisters';

type RegisterEnv = { Bindings: Bindings; Variables: Variables };
type EntryRow = Omit<SchoolRegisterEntry, 'data'> & { data_json: string; employee_id: number | null };
type HistoryRow = {
  id: number; entry_id: number; actor_user_id: number; actor_name: string;
  action: SchoolRegisterHistory['action']; version: number; before_json: string | null; after_json: string; changed_at: number;
};
type Scope = { school: number; year: number; key: string };
type CountRow = { total: number };
type TotalsRow = { active_total: number | null; voided_total: number | null };
const scopeKeys = ['school_id', 'academic_year_id', 'register_key'];

function resultRows<T>(result: { success: boolean; results?: T[] } | undefined): T[] {
  ensure(result?.success && Array.isArray(result.results), 'register_unavailable', 'تعذر قراءة نتيجة عملية السجل', 503);
  return result.results;
}

function dto(row: EntryRow): SchoolRegisterEntry {
  return { id: row.id, school_id: row.school_id, academic_year_id: row.academic_year_id, register_key: row.register_key,
    entry_date: row.entry_date, title: row.title, data: JSON.parse(row.data_json), status: row.status,
    version: row.version, created_at: row.created_at, updated_at: row.updated_at, void_reason: row.void_reason };
}
async function response(c: WorkflowContext, operation: () => Promise<Response>): Promise<Response> {
  try {
    ensure(hasRole(c.get('user')?.role_key, SCHOOL_MANAGEMENT_ROLES), 'forbidden', 'السجلات متاحة لإدارة المدرسة فقط', 403);
    return await operation();
  } catch (error) {
    if (error instanceof SchoolRegisterValidationError) return c.json({ error: error.message, code: 'invalid_register_data' }, 400);
    if (error instanceof WorkflowError) return c.json({ error: error.message, code: error.code }, error.status);
    const detail = String((error as Error)?.message || error);
    if (/school_register_(scope|void_content)_conflict/.test(detail)) {
      return c.json({ error: 'تغيرت البيانات أو الصلاحيات؛ أعد تحميل السجل قبل المحاولة', code: 'register_conflict' }, 409);
    }
    console.error('[school-registers]', c.env.APP_ENV === 'test' ? detail : 'operation_failed');
    return c.json({ error: 'تعذر إكمال عملية السجل', code: 'register_unavailable' }, 503);
  }
}
async function scope(c: WorkflowContext, body?: Record<string, unknown>): Promise<Scope> {
  const requested = body || c.req.query();
  // Require explicit scope even for management users: an old tab must not save
  // into a newly selected school/year implicitly.
  const requestedSchool = positiveId(requested.school_id);
  const school = await workflowSchool(c, requestedSchool, SCHOOL_MANAGEMENT_ROLES);
  const year = positiveId(requested.academic_year_id);
  const key = registerDefinition(requested.register_key).key;
  for (const name of scopeKeys) {
    const query = c.req.query(name);
    if (body && query !== undefined) ensure(String(body[name]) === query, 'register_scope_mismatch', 'نطاق الطلب لا يطابق السجل المختار');
  }
  ensure(await c.env.DB.prepare('SELECT id FROM academic_years WHERE id=? AND school_id=?').bind(year, school).first(),
    'register_year_not_found', 'السنة الدراسية غير موجودة في المدرسة', 404);
  return { school, year, key };
}
function pagination(c: WorkflowContext) {
  const page = c.req.query('page') === undefined ? 1 : positiveId(c.req.query('page'));
  const pageSize = c.req.query('page_size') === undefined ? 25 : positiveId(c.req.query('page_size'));
  ensure(page <= 1_000_000 && pageSize <= 100, 'invalid_register_pagination', 'حدود صفحات السجل غير صالحة');
  return { page, pageSize, offset: (page - 1) * pageSize };
}
async function stored(c: WorkflowContext, s: Scope, id: number): Promise<EntryRow> {
  const row = await c.env.DB.prepare('SELECT * FROM school_register_entries WHERE id=? AND school_id=? AND academic_year_id=? AND register_key=?')
    .bind(id, s.school, s.year, s.key).first<EntryRow>();
  ensure(row, 'register_entry_not_found', 'القيد غير موجود في السجل المختار', 404);
  return row;
}
function version(value: unknown): number {
  ensure(typeof value === 'number' && Number.isSafeInteger(value) && value > 0, 'invalid_register_version', 'إصدار القيد غير صالح');
  return value;
}
async function entryInput(c: WorkflowContext, s: Scope, body: Record<string, unknown>) {
  ensure(validRegisterDate(body.entry_date), 'invalid_register_date', 'تاريخ القيد غير صالح');
  const title = boundedText(body.title, 200);
  const data = parseRegisterData(s.key, body.data);
  const employee = typeof data.employee_id === 'number' ? data.employee_id : null;
  if (employee != null) {
    ensure(await c.env.DB.prepare('SELECT id FROM employees WHERE id=? AND school_id=?').bind(employee, s.school).first(),
      'register_employee_not_found', 'المدرس غير موجود في المدرسة المختارة', 404);
  }
  return { date: body.entry_date, title, data: JSON.stringify(data), employee };
}

export function registerSchoolRegisterRoutes(app: Hono<RegisterEnv>): void {
  app.get('/api/school-registers', c => response(c, async () => {
    const s = await scope(c), { page, pageSize, offset } = pagination(c);
    const status = c.req.query('status') || 'active';
    ensure(['active', 'voided', 'all'].includes(status), 'invalid_register_status', 'حالة القيد غير صالحة');
    const search = (c.req.query('search') || '').trim();
    ensure(search.length <= 200, 'invalid_register_search', 'نص البحث طويل جدًا');
    const binds: (string | number)[] = [s.school, s.year, s.key];
    let filter = 'school_id=? AND academic_year_id=? AND register_key=?';
    if (status !== 'all') { filter += ' AND status=?'; binds.push(status); }
    if (search) {
      filter += " AND (title LIKE ? ESCAPE '\\' OR data_json LIKE ? ESCAPE '\\')";
      const escaped = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
      binds.push(escaped, escaped);
    }
    const results = await c.env.DB.batch<EntryRow | CountRow | TotalsRow>([
      c.env.DB.prepare(`SELECT * FROM school_register_entries WHERE ${filter} ORDER BY entry_date DESC,id DESC LIMIT ? OFFSET ?`).bind(...binds, pageSize, offset),
      c.env.DB.prepare(`SELECT count(*) AS total FROM school_register_entries WHERE ${filter}`).bind(...binds),
      c.env.DB.prepare("SELECT sum(status='active') AS active_total,sum(status='voided') AS voided_total FROM school_register_entries WHERE school_id=? AND academic_year_id=? AND register_key=?")
        .bind(s.school, s.year, s.key),
    ]);
    const entries = (resultRows(results[0]) as EntryRow[]).map(dto);
    const count = resultRows(results[1])[0], totals = resultRows(results[2])[0];
    ensure(count && 'total' in count && totals && 'active_total' in totals, 'register_unavailable', 'تعذر قراءة عدادات السجل', 503);
    return c.json({ data: { entries, total: Number(count.total), page, page_size: pageSize,
      active_total: Number(totals.active_total || 0), voided_total: Number(totals.voided_total || 0) } });
  }));

  app.post('/api/school-registers', c => response(c, async () => {
    const body = await workflowBody(c, [...scopeKeys, 'entry_date', 'title', 'data']);
    const s = await scope(c, body), input = await entryInput(c, s, body), actor = c.get('user').id;
    const result = await c.env.DB.batch<EntryRow>([c.env.DB.prepare(`INSERT INTO school_register_entries
      (school_id,academic_year_id,register_key,entry_date,title,data_json,employee_id,created_by_user_id,updated_by_user_id)
      VALUES(?,?,?,?,?,?,?,?,?) RETURNING *`).bind(s.school, s.year, s.key, input.date, input.title, input.data, input.employee, actor, actor)]);
    const created = resultRows(result[0])[0];
    ensure(created, 'register_unavailable', 'تعذر قراءة القيد المحفوظ', 503);
    return c.json({ data: dto(created) }, 201);
  }));

  app.put('/api/school-registers/:id', c => response(c, async () => {
    const body = await workflowBody(c, [...scopeKeys, 'entry_date', 'title', 'data', 'version']);
    const s = await scope(c, body), id = positiveId(c.req.param('id')), expected = version(body.version);
    const current = await stored(c, s, id);
    ensure(current.status === 'active' && current.version === expected, 'register_conflict', 'تغير القيد أو تمت أرشفته؛ أعد تحميله قبل الحفظ', 409);
    const input = await entryInput(c, s, body);
    // Version and scope are checked again inside the mutating statement. The
    // trigger validates actor/year/employee and appends history atomically.
    const result = await c.env.DB.batch<EntryRow>([c.env.DB.prepare(`UPDATE school_register_entries SET
      entry_date=?,title=?,data_json=?,employee_id=?,version=version+1,updated_by_user_id=?,updated_at=unixepoch()
      WHERE id=? AND school_id=? AND academic_year_id=? AND register_key=? AND version=? AND status='active' RETURNING *`)
      .bind(input.date, input.title, input.data, input.employee, c.get('user').id, id, s.school, s.year, s.key, expected)]);
    const updated = resultRows(result[0])[0];
    ensure(updated, 'register_conflict', 'تغير القيد؛ أعد تحميله قبل الحفظ', 409);
    return c.json({ data: dto(updated) });
  }));

  app.post('/api/school-registers/:id/void', c => response(c, async () => {
    const body = await workflowBody(c, [...scopeKeys, 'version', 'reason']);
    const s = await scope(c, body), id = positiveId(c.req.param('id')), expected = version(body.version);
    const reason = boundedText(body.reason, 1000), current = await stored(c, s, id);
    ensure(current.status === 'active' && current.version === expected, 'register_conflict', 'تغير القيد أو تمت أرشفته؛ أعد تحميله', 409);
    const result = await c.env.DB.batch<EntryRow>([c.env.DB.prepare(`UPDATE school_register_entries SET
      status='voided',void_reason=?,version=version+1,updated_by_user_id=?,updated_at=unixepoch()
      WHERE id=? AND school_id=? AND academic_year_id=? AND register_key=? AND version=? AND status='active' RETURNING *`)
      .bind(reason, c.get('user').id, id, s.school, s.year, s.key, expected)]);
    const archived = resultRows(result[0])[0];
    ensure(archived, 'register_conflict', 'تغير القيد؛ أعد تحميله قبل الأرشفة', 409);
    return c.json({ data: dto(archived) });
  }));

  app.get('/api/school-registers/:id/history', c => response(c, async () => {
    const s = await scope(c), id = positiveId(c.req.param('id')), { page, pageSize, offset } = pagination(c);
    await stored(c, s, id);
    const result = await c.env.DB.batch<HistoryRow | CountRow>([
      c.env.DB.prepare(`SELECT h.*,u.full_name AS actor_name FROM school_register_history h
        JOIN school_register_entries e ON e.id=h.entry_id JOIN users u ON u.id=h.actor_user_id
        WHERE e.id=? AND e.school_id=? AND e.academic_year_id=? AND e.register_key=? ORDER BY h.version DESC LIMIT ? OFFSET ?`)
        .bind(id, s.school, s.year, s.key, pageSize, offset),
      c.env.DB.prepare('SELECT count(*) AS total FROM school_register_history WHERE entry_id=?').bind(id),
    ]);
    const history: SchoolRegisterHistory[] = (resultRows(result[0]) as HistoryRow[]).map(row => ({
      id: row.id, entry_id: row.entry_id, actor_user_id: row.actor_user_id, actor_name: row.actor_name,
      action: row.action, version: row.version, changed_at: row.changed_at,
      before: row.before_json == null ? null : JSON.parse(row.before_json), after: JSON.parse(row.after_json),
    }));
    const count = resultRows(result[1])[0];
    ensure(count && 'total' in count, 'register_unavailable', 'تعذر قراءة عداد التغييرات', 503);
    return c.json({ data: { history, total: Number(count.total), page, page_size: pageSize } });
  }));
}
