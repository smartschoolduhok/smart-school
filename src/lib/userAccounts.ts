import type { Context, Hono } from 'hono';
import type { Bindings, Variables } from '../worker';
import type { RoleKey } from '../types';
import { hashPassword, hashTemporaryPassword, verifyPassword } from './authSecurity';

type Env = { Bindings: Bindings; Variables: Variables };
type Ctx = Context<Env>;
type Value = string | number | null;
type Body = Record<string, unknown>;
type Predicate = { sql: string; args: Value[] };
interface Account {
  id: number; school_id: number | null; full_name: string; email: string; phone: string | null;
  role_id: number; role_key: RoleKey; status: 'active' | 'inactive'; account_revision: number;
  must_change_password: number; temporary_password_expires_at: number | null;
}
export const OWNER_ACCOUNT_ROLES: readonly RoleKey[] = ['principal', 'vice_principal', 'teacher', 'accountant', 'registrar', 'parent'];
const ALL_ROLES: readonly RoleKey[] = ['system_admin', 'school_owner', ...OWNER_ACCOUNT_ROLES];
export const TEMPORARY_PASSWORD_TTL_SECONDS = 24 * 60 * 60;

class AccountError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404 | 409, readonly code?: string) { super(message); }
}
export function canManageAccount(actor: { id: number; role_key: RoleKey; school_id: number | null }, target: Pick<Account, 'id' | 'role_key' | 'school_id'>): boolean {
  return actor.id !== target.id && (actor.role_key === 'system_admin'
    || (actor.role_key === 'school_owner' && actor.school_id !== null && actor.school_id === target.school_id && OWNER_ACCOUNT_ROLES.includes(target.role_key)));
}
export function generateTemporaryPassword(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(24)), byte => byte.toString(16).padStart(2, '0')).join('');
}
function id(value: unknown, label = 'المعرّف'): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new AccountError(`${label} غير صالح`, 400);
  return value;
}
function text(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new AccountError(`${label} غير صالح`, 400);
  return value.trim();
}
async function body(c: Ctx, allowed: readonly string[]): Promise<Body> {
  let input: unknown;
  try { input = await c.req.json(); } catch { throw new AccountError('طلب غير صالح', 400); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AccountError('طلب غير صالح', 400);
  const result = input as Body;
  if (Object.keys(result).some(key => !allowed.includes(key))) throw new AccountError('يتضمن الطلب حقولًا غير مسموحة', 400);
  return result;
}
function requireManager(c: Ctx): void {
  if (!['system_admin', 'school_owner'].includes(c.get('user').role_key)) throw new AccountError('غير مسموح بإدارة الحسابات', 403);
}
function sameScope(c: Ctx, schoolId: number | null, input: Body): void {
  const query = c.req.query('school_id');
  if ((input.school_id !== undefined && input.school_id !== schoolId) || (query !== undefined && Number(query) !== schoolId)) {
    throw new AccountError('لا يمكن نقل الحساب أو إدارة مدرسة أخرى', 403);
  }
}
async function target(c: Ctx): Promise<Account> {
  requireManager(c);
  const targetId = id(Number(c.req.param('id')));
  const row = await c.env.DB.prepare(`SELECT u.id,u.school_id,u.full_name,u.email,u.phone,u.role_id,u.status,
    u.account_revision,u.must_change_password,u.temporary_password_expires_at,r.key AS role_key
    FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=?`).bind(targetId).first<Account>();
  if (!row) throw new AccountError('المستخدم غير موجود', 404);
  if (!canManageAccount(c.get('user'), row)) throw new AccountError('غير مسموح بإدارة هذا الحساب', 403);
  return row;
}
async function role(c: Ctx, input: Body, fallback?: Account): Promise<{ id: number; key: RoleKey }> {
  let result: { id: number; key: RoleKey } | null;
  if (input.role_id !== undefined) {
    result = await c.env.DB.prepare('SELECT id,key FROM roles WHERE id=?').bind(id(input.role_id, 'الدور')).first();
    if (input.role_key !== undefined && result?.key !== input.role_key) throw new AccountError('الدور المحدد غير متطابق', 400);
  } else if (input.role_key !== undefined) {
    if (typeof input.role_key !== 'string') throw new AccountError('الدور غير صالح', 400);
    result = await c.env.DB.prepare('SELECT id,key FROM roles WHERE key=?').bind(input.role_key).first();
  } else result = fallback ? { id: fallback.role_id, key: fallback.role_key } : null;
  if (!result || !ALL_ROLES.includes(result.key)) throw new AccountError('الدور غير صالح', 400);
  if (c.get('user').role_key === 'school_owner' && !OWNER_ACCOUNT_ROLES.includes(result.key)) throw new AccountError('غير مسموح بتعيين هذا الدور', 403);
  return result;
}
function profile(input: Body, fallback?: Account) {
  const fullName = text(input.full_name ?? fallback?.full_name, 'الاسم', 200);
  const email = text(input.email ?? fallback?.email, 'البريد الإلكتروني', 320).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AccountError('البريد الإلكتروني غير صحيح', 400);
  const phone = input.phone === undefined ? fallback?.phone ?? null : input.phone === null || input.phone === '' ? null : text(input.phone, 'الهاتف', 40);
  return { fullName, email, phone };
}
function actorGuard(c: Ctx, allowForcedChange = false): Predicate {
  const actor = c.get('user');
  const session = c.get('session');
  return { sql: `EXISTS(SELECT 1 FROM users a JOIN roles ar ON ar.id=a.role_id WHERE a.id=? AND a.auth_version=?
    AND a.status='active' AND ar.key=? AND a.school_id IS ? ${allowForcedChange ? '' : 'AND a.must_change_password=0'})
    AND ?>unixepoch() AND NOT EXISTS(SELECT 1 FROM revoked_sessions WHERE jti=? AND expires_at>unixepoch())`,
    args: [actor.id, session.auth_version, actor.role_key, actor.school_id, session.exp, session.jti] };
}
function existingGuard(c: Ctx, row: Account, expected: unknown): Predicate {
  const revision = id(expected, 'نسخة الحساب');
  if (revision !== row.account_revision) throw new AccountError('تغير الحساب؛ حدّث القائمة قبل المحاولة مجددًا', 409, 'account_stale');
  const actor = actorGuard(c);
  return { sql: `${actor.sql} AND EXISTS(SELECT 1 FROM users t JOIN roles r ON r.id=t.role_id WHERE t.id=?
    AND t.account_revision=? AND t.school_id IS ? AND r.key=? AND t.id<>?)
    ${row.school_id === null ? '' : "AND EXISTS(SELECT 1 FROM schools WHERE id=? AND status='active')"}`,
    args: [...actor.args, row.id, revision, row.school_id, row.role_key, c.get('user').id, ...(row.school_id === null ? [] : [row.school_id])] };
}
function metadata(row: Account) {
  return JSON.stringify({ school_id: row.school_id, role_key: row.role_key, status: row.status, account_revision: row.account_revision, must_change_password: Boolean(row.must_change_password) });
}
function audit(c: Ctx, operationId: string, action: string, fields: string[], before: Account | null, email: string) {
  return c.env.DB.prepare(`INSERT INTO user_account_audit(operation_id,school_id,actor_user_id,target_user_id,action,changed_fields_json,before_json,after_json)
    SELECT ?,u.school_id,?,u.id,?,?,?,json_object('school_id',u.school_id,'role_key',r.key,'status',u.status,
      'account_revision',u.account_revision,'must_change_password',u.must_change_password)
    FROM users u JOIN roles r ON r.id=u.role_id WHERE u.email=?`)
    .bind(operationId, c.get('user').id, action, JSON.stringify(fields), before ? metadata(before) : null, email);
}
async function atomic(c: Ctx, operationId: string, guard: Predicate, statements: D1PreparedStatement[]) {
  try {
    return await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO user_account_write_guards(operation_id,valid) VALUES(?,iif(${guard.sql},1,0))`).bind(operationId, ...guard.args),
      ...statements,
      c.env.DB.prepare('DELETE FROM user_account_write_guards WHERE operation_id=?').bind(operationId),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (/CHECK constraint failed: valid|user_account_write_guards/i.test(message)) {
      throw new AccountError('تغير الحساب أو صلاحياته أو الربط؛ حدّث القائمة قبل المحاولة مجددًا', 409, 'account_stale');
    }
    if (/UNIQUE constraint failed: users/i.test(message)) {
      throw new AccountError('البريد الإلكتروني مستخدم مسبقًا', 409, 'email_in_use');
    }
    if (/UNIQUE constraint failed: teacher_employee_links/i.test(message)) {
      throw new AccountError('الموظف مرتبط بحساب آخر', 409, 'link_conflict');
    }
    throw error;
  }
}
function route(handler: (c: Ctx) => Promise<Response>) {
  return async (c: Ctx) => {
    try { return await handler(c); }
    catch (error) {
      if (error instanceof AccountError) return c.json({ error: error.message, code: error.code }, error.status);
      return c.json({ error: 'تعذر إكمال عملية الحساب؛ لم يُحفظ التغيير' }, 500);
    }
  };
}
function revokeLinks(c: Ctx, row: Account): D1PreparedStatement[] {
  return [
    c.env.DB.prepare("UPDATE teacher_employee_links SET status='inactive',updated_at=unixepoch() WHERE teacher_user_id=? AND status='active'").bind(row.id),
    c.env.DB.prepare("UPDATE parent_student_links SET status='inactive',updated_at=unixepoch() WHERE parent_user_id=? AND status='active'").bind(row.id),
  ];
}

export function registerUserAccountRoutes(app: Hono<Env>): void {
  app.post('/api/users', route(async c => {
    requireManager(c);
    const input = await body(c, ['full_name', 'email', 'phone', 'role_id', 'role_key', 'school_id', 'employee_id']);
    const selected = await role(c, input), details = profile(input), actor = c.get('user');
    const schoolId = actor.role_key === 'school_owner' ? id(actor.school_id, 'المدرسة')
      : selected.key === 'system_admin' ? null : id(input.school_id, 'المدرسة');
    sameScope(c, schoolId, input);
    const duplicate = await c.env.DB.prepare('SELECT id FROM users WHERE LOWER(TRIM(email))=?').bind(details.email).first();
    if (duplicate) throw new AccountError('البريد الإلكتروني مستخدم مسبقًا', 409, 'email_in_use');
    const employeeId = input.employee_id === undefined ? null : id(input.employee_id, 'الموظف');
    if (employeeId !== null && selected.key !== 'teacher') throw new AccountError('ربط الموظف متاح لحساب المدرس فقط', 400);
    const guard = actorGuard(c);
    guard.sql += ' AND EXISTS(SELECT 1 FROM roles WHERE id=? AND key=?)'; guard.args.push(selected.id, selected.key);
    if (schoolId !== null) { guard.sql += " AND EXISTS(SELECT 1 FROM schools WHERE id=? AND status='active')"; guard.args.push(schoolId); }
    if (employeeId !== null) {
      guard.sql += " AND EXISTS(SELECT 1 FROM employees WHERE id=? AND school_id=? AND role='teacher' AND status='active') AND NOT EXISTS(SELECT 1 FROM teacher_employee_links WHERE school_id=? AND employee_id=?)";
      guard.args.push(employeeId, schoolId, schoolId, employeeId);
    }
    const temporaryPassword = generateTemporaryPassword(), expires = Math.floor(Date.now() / 1000) + TEMPORARY_PASSWORD_TTL_SECONDS;
    const passwordHash = await hashTemporaryPassword(temporaryPassword), operationId = crypto.randomUUID();
    const statements = [c.env.DB.prepare(`INSERT INTO users(school_id,full_name,email,password_hash,role_id,phone,status,
      must_change_password,temporary_password_expires_at,account_revision,created_at,updated_at)
      VALUES(?,?,?,?,?,?,'active',1,?,1,unixepoch(),unixepoch()) RETURNING id`)
      .bind(schoolId, details.fullName, details.email, passwordHash, selected.id, details.phone, expires)];
    if (employeeId !== null) statements.push(c.env.DB.prepare(`INSERT INTO teacher_employee_links(school_id,teacher_user_id,employee_id,status,created_by_user_id)
      SELECT ?,id,?,'active',? FROM users WHERE email=?`).bind(schoolId, employeeId, actor.id, details.email));
    statements.push(audit(c, operationId, 'create', ['account', ...(employeeId === null ? [] : ['teacher_employee_link'])], null, details.email));
    const results = await atomic(c, operationId, guard, statements);
    const createdId = results[1].results?.[0]?.id;
    return c.json({ data: { id: createdId, full_name: details.fullName, email: details.email, role_id: selected.id, role_key: selected.key,
      school_id: schoolId, status: 'active', account_revision: 1, must_change_password: true,
      temporary_password: temporaryPassword, temporary_password_expires_at: expires } }, 201);
  }));

  app.put('/api/users/:id', route(async c => {
    const row = await target(c), input = await body(c, ['full_name', 'email', 'phone', 'role_id', 'role_key', 'school_id', 'expected_revision']);
    sameScope(c, row.school_id, input);
    const selected = await role(c, input, row), details = profile(input, row);
    if ((selected.key === 'system_admin') !== (row.school_id === null)) throw new AccountError('لا يمكن تغيير نطاق الحساب؛ أنشئ حسابًا منفصلًا للدور الجديد', 400);
    const guard = existingGuard(c, row, input.expected_revision);
    guard.sql += ' AND EXISTS(SELECT 1 FROM roles WHERE id=? AND key=?)'; guard.args.push(selected.id, selected.key);
    const duplicate = await c.env.DB.prepare('SELECT id FROM users WHERE LOWER(TRIM(email))=? AND id<>?').bind(details.email, row.id).first();
    if (duplicate) throw new AccountError('البريد الإلكتروني مستخدم مسبقًا', 409, 'email_in_use');
    const operationId = crypto.randomUUID();
    await atomic(c, operationId, guard, [
      ...(selected.key !== row.role_key ? revokeLinks(c, row) : []),
      c.env.DB.prepare(`UPDATE users SET full_name=?,email=?,phone=?,role_id=?,account_revision=account_revision+1,
        auth_version=auth_version+1,updated_at=unixepoch() WHERE id=?`).bind(details.fullName, details.email, details.phone, selected.id, row.id),
      audit(c, operationId, 'update', Object.keys(input).filter(key => !['expected_revision', 'school_id'].includes(key)), row, details.email),
    ]);
    return c.json({ data: { id: row.id, full_name: details.fullName, email: details.email, phone: details.phone,
      role_id: selected.id, role_key: selected.key, school_id: row.school_id, account_revision: row.account_revision + 1 } });
  }));

  app.put('/api/users/:id/status', route(async c => {
    const row = await target(c), input = await body(c, ['status', 'expected_revision']); sameScope(c, row.school_id, input);
    if (typeof input.status !== 'string' || !['active', 'inactive'].includes(input.status)) throw new AccountError('حالة الحساب غير صالحة', 400);
    const guard = existingGuard(c, row, input.expected_revision), operationId = crypto.randomUUID();
    await atomic(c, operationId, guard, [
      ...(input.status !== row.status ? revokeLinks(c, row) : []),
      c.env.DB.prepare('UPDATE users SET status=?,account_revision=account_revision+1,auth_version=auth_version+1,updated_at=unixepoch() WHERE id=?').bind(input.status, row.id),
      audit(c, operationId, 'status', ['status', ...(input.status !== row.status ? ['access_links'] : [])], row, row.email),
    ]);
    return c.json({ data: { id: row.id, status: input.status, account_revision: row.account_revision + 1 } });
  }));

  app.put('/api/users/:id/reset-password', route(async c => {
    const row = await target(c), input = await body(c, ['expected_revision']); sameScope(c, row.school_id, input);
    const guard = existingGuard(c, row, input.expected_revision), operationId = crypto.randomUUID();
    const temporaryPassword = generateTemporaryPassword(), expires = Math.floor(Date.now() / 1000) + TEMPORARY_PASSWORD_TTL_SECONDS;
    const passwordHash = await hashTemporaryPassword(temporaryPassword);
    await atomic(c, operationId, guard, [
      c.env.DB.prepare(`UPDATE users SET password_hash=?,must_change_password=1,temporary_password_expires_at=?,
        auth_version=auth_version+1,account_revision=account_revision+1,updated_at=unixepoch() WHERE id=?`).bind(passwordHash, expires, row.id),
      audit(c, operationId, 'reset_password', ['credentials'], row, row.email),
    ]);
    return c.json({ data: { id: row.id, account_revision: row.account_revision + 1, must_change_password: true,
      temporary_password: temporaryPassword, temporary_password_expires_at: expires } });
  }));

  app.get('/api/users/:id/audit', route(async c => {
    requireManager(c);
    const userId = id(Number(c.req.param('id'))), actor = c.get('user');
    const row = await c.env.DB.prepare('SELECT school_id FROM users WHERE id=?').bind(userId).first<{ school_id: number | null }>();
    if (!row) throw new AccountError('المستخدم غير موجود', 404);
    if (actor.role_key !== 'system_admin' && (row.school_id === null || actor.school_id !== row.school_id)) throw new AccountError('غير مسموح', 403);
    sameScope(c, row.school_id, {});
    const cursor = c.req.query('before_id') === undefined ? Number.MAX_SAFE_INTEGER : id(Number(c.req.query('before_id')));
    const result = await c.env.DB.prepare(`SELECT id,school_id,actor_user_id,target_user_id,action,changed_fields_json,before_json,after_json,created_at
      FROM user_account_audit WHERE target_user_id=? AND school_id IS ? AND id<? ORDER BY id DESC LIMIT 100`).bind(userId, row.school_id, cursor).all();
    return c.json({ data: result.results || [] });
  }));
}

export async function updateOwnPassword(c: Ctx, input: Body): Promise<void> {
  if (Object.keys(input).some(key => !['current_password', 'new_password'].includes(key))) throw new AccountError('يتضمن الطلب حقولًا غير مسموحة', 400);
  if (typeof input.current_password !== 'string' || input.current_password.length < 1 || input.current_password.length > 1024
      || typeof input.new_password !== 'string' || input.new_password.length < 12 || input.new_password.length > 128
      || input.new_password.trim().length < 12 || input.new_password === input.current_password) {
    throw new AccountError('اختر كلمة مرور جديدة من 12 إلى 128 حرفًا تختلف عن الحالية', 400);
  }
  const actor = c.get('user');
  const row = await c.env.DB.prepare('SELECT password_hash,must_change_password,temporary_password_expires_at FROM users WHERE id=?').bind(actor.id)
    .first<{ password_hash: string; must_change_password: number; temporary_password_expires_at: number | null }>();
  if (!row || !await verifyPassword(input.current_password, row.password_hash, actor.email).then(result => result.valid)) throw new AccountError('كلمة المرور الحالية غير صحيحة', 400);
  const passwordHash = await hashPassword(input.new_password), guard = actorGuard(c, true), operationId = crypto.randomUUID();
  guard.sql += ' AND EXISTS(SELECT 1 FROM users WHERE id=? AND password_hash=? AND (must_change_password=0 OR temporary_password_expires_at>unixepoch()))';
  guard.args.push(actor.id, row.password_hash);
  await atomic(c, operationId, guard, [
    c.env.DB.prepare(`UPDATE users SET password_hash=?,must_change_password=0,temporary_password_expires_at=NULL,
      auth_version=auth_version+1,account_revision=account_revision+1,updated_at=unixepoch() WHERE id=?`).bind(passwordHash, actor.id),
    audit(c, operationId, 'change_password', ['credentials'], null, actor.email),
  ]);
}

export function accountErrorResponse(c: Ctx, error: unknown): Response {
  if (error instanceof AccountError) return c.json({ error: error.message, code: error.code }, error.status);
  return c.json({ error: 'تعذر تغيير كلمة المرور' }, 500);
}
