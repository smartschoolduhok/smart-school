import type { Context, Hono } from 'hono';
import type { Bindings, Variables } from '../worker';
import { SCHOOL_MANAGEMENT_ROLES, hasRole } from './rbac';
import { dossierId, emptyStaffDossier, StaffDossierError, validateStaffDossierRequest, type StaffDossierData, type StaffDossierResponse, type DossierQualificationLink } from './staffDossier';
type Env = { Bindings: Bindings; Variables: Variables };
type C = Context<Env>;
type DossierRow = { data_json: string; version: number; updated_at: number };
const MAX_BODY_BYTES = 180_000;
async function readBody(request: Request): Promise<unknown> {
  if (!request.body) throw new StaffDossierError('بيانات السجل مطلوبة');
  const reader = request.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
  try { while (true) { const part = await reader.read(); if (part.done) break; length += part.value.byteLength;
    if (length > MAX_BODY_BYTES) { await reader.cancel(); throw new StaffDossierError('حجم السجل يتجاوز الحد المسموح', 413); } chunks.push(part.value); } }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new StaffDossierError('بيانات السجل غير صالحة'); }
}
async function scope(c: C, supplied: unknown) {
  const user = c.get('user');
  if (!user || !hasRole(user.role_key, SCHOOL_MANAGEMENT_ROLES)) throw new StaffDossierError('سجل جماعة المدرسين متاح لإدارة المدرسة فقط', 403);
  const schoolId = dossierId(supplied), employeeId = dossierId(c.req.param('id'));
  if (user.role_key !== 'system_admin' && user.school_id !== schoolId) throw new StaffDossierError('لا تملك صلاحية هذه المدرسة', 403);
  const employee = await c.env.DB.prepare("SELECT e.id,s.name AS school_name,s.logo_url FROM employees e JOIN schools s ON s.id=e.school_id WHERE e.id=? AND e.school_id=? AND s.status='active'").bind(employeeId, schoolId).first<{ id: number; school_name: string; logo_url: string | null }>();
  if (!employee) throw new StaffDossierError('الموظف غير موجود في المدرسة المحددة', 404);
  return { schoolId, employeeId, userId: user.id, schoolName: employee.school_name, logoUrl: employee.logo_url };
}
const QUALIFICATION_COLUMNS = 'id,degree,general_specialization,specific_specialization,institution,college,graduation_date';
async function qualificationState(db: D1Database, schoolId: number, employeeId: number) {
  const rows = await db.prepare('SELECT id,degree,general_specialization,specific_specialization,institution,college,graduation_date FROM employee_qualifications WHERE school_id=? AND employee_id=? ORDER BY id').bind(schoolId, employeeId).all<Record<string, string | number | null>>();
  const snapshot = JSON.stringify((rows.results || []).map(q => QUALIFICATION_COLUMNS.split(',').map(key => q[key])));
  const links: DossierQualificationLink[] = await Promise.all((rows.results || []).map(async q => {
    // Core replacement changes IDs. Hash immutable content, never copy degree data into the supplementary record.
    const values = ['degree','general_specialization','specific_specialization','institution','college','graduation_date'].map(key => String(q[key] || '').trim().normalize('NFC'));
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(values)));
    return { qualification_id: Number(q.id), qualification_key: Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join(''), has_graduation_date: !!q.graduation_date };
  }));
  return { links, snapshot };
}
function response(row: DossierRow | null, schoolId: number, employeeId: number, schoolName: string, logoUrl: string | null, links: DossierQualificationLink[]): StaffDossierResponse {
  return { school_id: schoolId, employee_id: employeeId, school_name: schoolName, logo_url: logoUrl, qualification_links: links, version: row?.version || 0, updated_at: row?.updated_at || null,
    data: row ? JSON.parse(row.data_json) as StaffDossierData : emptyStaffDossier() };
}
function failure(c: C, error: unknown) {
  if (error instanceof StaffDossierError) return c.json({ error: error.message }, error.status);
  const message = error instanceof Error ? error.message : '';
  if (message.includes('staff_dossier_forbidden') || message.includes('staff_dossier_invalid_scope')) return c.json({ error: 'تعذر التحقق من صلاحية المدرسة أو الموظف' }, 403);
  return c.json({ error: 'تعذر حفظ أو قراءة سجل جماعة المدرسين' }, 500);
}
export function registerStaffDossierRoutes(app: Hono<Env>): void {
  app.get('/api/employees/:id/dossier', async c => {
    c.header('Cache-Control', 'no-store');
    try { const s = await scope(c, c.req.query('school_id'));
      const row = await c.env.DB.prepare('SELECT data_json,version,updated_at FROM staff_dossiers WHERE school_id=? AND employee_id=?').bind(s.schoolId, s.employeeId).first<DossierRow>();
      const { links } = await qualificationState(c.env.DB, s.schoolId, s.employeeId);
      return c.json({ data: response(row, s.schoolId, s.employeeId, s.schoolName, s.logoUrl, links) });
    } catch (error) { return failure(c, error); }
  });
  app.put('/api/employees/:id/dossier', async c => {
    c.header('Cache-Control', 'no-store');
    try {
      if (!hasRole(c.get('user')?.role_key, SCHOOL_MANAGEMENT_ROLES)) throw new StaffDossierError('غير مسموح', 403);
      const input = validateStaffDossierRequest(await readBody(c.req.raw));
      const s = await scope(c, input.school_id);
      const { links, snapshot } = await qualificationState(c.env.DB, s.schoolId, s.employeeId);
      const existing = await c.env.DB.prepare('SELECT data_json,version,updated_at FROM staff_dossiers WHERE school_id=? AND employee_id=?').bind(s.schoolId, s.employeeId).first<DossierRow>();
      const oldKeys = new Set(existing ? (JSON.parse(existing.data_json) as StaffDossierData).qualifications.map(q => q.qualification_key) : []);
      for (const q of input.data.qualifications) {
        const matches = links.filter(link => link.qualification_key === q.qualification_key);
        if (!matches.length && !oldKeys.has(q.qualification_key)) throw new StaffDossierError('المؤهل غير مرتبط بهذا الموظف');
        if (matches.length > 1) throw new StaffDossierError('هناك مؤهلان متطابقان؛ راجع المؤهلات قبل إضافة تفاصيل لهما');
        if (matches[0]?.has_graduation_date && q.graduation_year !== null) throw new StaffDossierError('سنة التخرج تؤخذ من تاريخ التخرج المسجل في ملف الموظف');
      }
      const json = JSON.stringify(input.data);
      if (new TextEncoder().encode(json).byteLength > MAX_BODY_BYTES) throw new StaffDossierError('حجم السجل يتجاوز الحد المسموح', 413);
      // The CAS predicate and trigger audit are part of the same SQLite statement/transaction.
      // Include current core qualifications in the same predicate: metadata cannot become stale between validation and persistence.
      const qualificationGuard = `(SELECT json_group_array(json_array(${QUALIFICATION_COLUMNS})) FROM (SELECT ${QUALIFICATION_COLUMNS} FROM employee_qualifications WHERE school_id=? AND employee_id=? ORDER BY id))=?`;
      const sql = input.version === 0
        ? `INSERT INTO staff_dossiers(employee_id,school_id,data_json,version,updated_by_user_id) SELECT ?,?,?,1,? WHERE ${qualificationGuard} ON CONFLICT(employee_id) DO NOTHING RETURNING data_json,version,updated_at`
        : `UPDATE staff_dossiers SET data_json=?,version=version+1,updated_by_user_id=?,updated_at=unixepoch() WHERE school_id=? AND employee_id=? AND version=? AND ${qualificationGuard} RETURNING data_json,version,updated_at`;
      const args = [...(input.version === 0 ? [s.employeeId, s.schoolId, json, s.userId] : [json, s.userId, s.schoolId, s.employeeId, input.version]), s.schoolId, s.employeeId, snapshot];
      const result = await c.env.DB.batch([c.env.DB.prepare(sql).bind(...args)]);
      const row = result[0].results?.[0] as DossierRow | undefined;
      if (!row) throw new StaffDossierError('تم تعديل السجل أو المؤهلات في جلسة أخرى؛ أعد تحميله قبل الحفظ', 409);
      return c.json({ data: response(row, s.schoolId, s.employeeId, s.schoolName, s.logoUrl, links) });
    } catch (error) { return failure(c, error); }
  });
}
