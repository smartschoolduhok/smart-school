import type { Context, Hono } from 'hono';
import type { Bindings, Variables } from '../worker';
import { businessDate } from './businessTime';
import { getValidatedJwtSecret } from './jwtSecurity';
import {
  STAFF_ATTENDANCE_MANAGEMENT_ROLES,
  STAFF_ATTENDANCE_REPORT_ROLES,
  hasRole,
} from './rbac';
import {
  STAFF_ATTENDANCE_STATUS_LABELS,
  StaffAttendanceError,
  calculateStaffAttendanceStatus,
  createEmployeeAttendanceCardPayload,
  parseEmployeeAttendanceCardIssueInput,
  parseEmployeeAttendanceCardRevokeInput,
  parseManualStaffAttendanceEventInput,
  parseStaffAttendanceDate,
  parseStaffAttendanceEventVoidInput,
  parseStaffAttendanceScanInput,
  parseStaffAttendanceSettingsInput,
  requireStaffAttendance,
  staffAttendanceDatabaseError,
  staffAttendanceErrorMessage,
  staffBusinessClock,
  validateStaffAttendanceRange,
  verifyEmployeeAttendanceCardPayload,
  type EmployeeAttendanceCard,
  type EmployeeAttendanceEvent,
  type EmployeeAttendanceSummary,
  type MyStaffAttendanceFeed,
  type StaffAttendanceDirection,
  type StaffAttendanceEmployee,
  type StaffAttendanceSettings,
} from './staffAttendance';
import type { RoleKey } from '../types';

type StaffAttendanceEnv = { Bindings: Bindings; Variables: Variables };
type C = Context<StaffAttendanceEnv>;
type Row = Record<string, any>;

const DEFAULT_SETTINGS = {
  work_start_time: '08:00',
  late_grace_minutes: 10,
  work_end_time: '14:00',
  early_exit_grace_minutes: 0,
  duplicate_window_seconds: 60,
} as const;

async function requestBody(c: C): Promise<unknown> {
  const text = await c.req.text();
  requireStaffAttendance(text.length <= 64_000, 'invalid_staff_attendance_request');
  try {
    return JSON.parse(text);
  } catch {
    throw new StaffAttendanceError('invalid_staff_attendance_request');
  }
}

function positiveId(value: unknown, code: string): number {
  const parsed = Number(value);
  requireStaffAttendance(Number.isSafeInteger(parsed) && parsed > 0, code);
  return parsed;
}

async function resolveSchool(
  c: C,
  supplied: unknown,
  allowedRoles: readonly RoleKey[],
  forbiddenCode: string,
): Promise<number> {
  const user = c.get('user');
  requireStaffAttendance(user && hasRole(user.role_key, allowedRoles), forbiddenCode, 403);
  const requested = supplied == null || supplied === ''
    ? null
    : positiveId(supplied, 'invalid_staff_attendance_school');
  let schoolId: number;
  if (user.role_key === 'system_admin') {
    requireStaffAttendance(requested != null, 'staff_attendance_target_required');
    schoolId = requested;
  } else {
    requireStaffAttendance(user.school_id != null, forbiddenCode, 403);
    requireStaffAttendance(requested == null || requested === user.school_id, forbiddenCode, 403);
    schoolId = user.school_id;
  }
  const school = await c.env.DB.prepare("SELECT id FROM schools WHERE id = ? AND status = 'active'")
    .bind(schoolId).first<Row>();
  requireStaffAttendance(school, 'staff_attendance_target_required');
  return schoolId;
}

async function resolveManagementSchool(c: C, supplied: unknown): Promise<number> {
  return resolveSchool(c, supplied, STAFF_ATTENDANCE_MANAGEMENT_ROLES, 'staff_attendance_forbidden');
}

async function resolveReportSchool(c: C, supplied: unknown): Promise<number> {
  return resolveSchool(c, supplied, STAFF_ATTENDANCE_REPORT_ROLES, 'staff_attendance_report_forbidden');
}

function settingsFromRow(schoolId: number, row: Row | null): StaffAttendanceSettings {
  return {
    school_id: schoolId,
    work_start_time: String(row?.work_start_time || DEFAULT_SETTINGS.work_start_time),
    late_grace_minutes: Number(row?.late_grace_minutes ?? DEFAULT_SETTINGS.late_grace_minutes),
    work_end_time: String(row?.work_end_time || DEFAULT_SETTINGS.work_end_time),
    early_exit_grace_minutes: Number(row?.early_exit_grace_minutes ?? DEFAULT_SETTINGS.early_exit_grace_minutes),
    duplicate_window_seconds: Number(row?.duplicate_window_seconds ?? DEFAULT_SETTINGS.duplicate_window_seconds),
    updated_at: row?.updated_at == null ? null : Number(row.updated_at),
  };
}

async function loadSettings(db: D1Database, schoolId: number): Promise<StaffAttendanceSettings> {
  const row = await db.prepare('SELECT * FROM staff_attendance_settings WHERE school_id = ?')
    .bind(schoolId).first<Row>();
  return settingsFromRow(schoolId, row);
}

async function loadEmployeeContext(db: D1Database, schoolId: number, employeeId: number): Promise<Row | null> {
  return db.prepare(`
    SELECT employee.id AS employee_id, employee.full_name AS employee_name,
           employee.employee_number, employee.role AS employee_role,
           employee.job_title, employee.hire_date,
           year.id AS academic_year_id, year.starts_at, year.ends_at
    FROM employees employee
    JOIN academic_years year
      ON year.school_id = employee.school_id AND year.is_active = 1
    WHERE employee.id = ? AND employee.school_id = ? AND employee.status = 'active'
    ORDER BY year.starts_at DESC, year.id DESC
    LIMIT 1
  `).bind(employeeId, schoolId).first<Row>();
}

const CARD_SELECT = `
  SELECT card.id, card.public_id, card.school_id, card.employee_id, card.status,
         card.issued_at, card.revoked_at, card.revocation_reason,
         employee.full_name AS employee_name, employee.employee_number,
         employee.role AS employee_role, employee.job_title
  FROM employee_attendance_cards card
  JOIN employees employee
    ON employee.id = card.employee_id AND employee.school_id = card.school_id
`;

async function publicCard(row: Row, secret: string): Promise<EmployeeAttendanceCard> {
  return {
    id: Number(row.id),
    public_id: String(row.public_id),
    school_id: Number(row.school_id),
    employee_id: Number(row.employee_id),
    employee_name: String(row.employee_name),
    employee_number: row.employee_number == null ? null : String(row.employee_number),
    employee_role: String(row.employee_role),
    job_title: row.job_title == null ? null : String(row.job_title),
    status: row.status === 'revoked' ? 'revoked' : 'active',
    issued_at: Number(row.issued_at),
    revoked_at: row.revoked_at == null ? null : Number(row.revoked_at),
    revocation_reason: row.revocation_reason == null ? null : String(row.revocation_reason),
    qr_value: await createEmployeeAttendanceCardPayload(String(row.public_id), secret),
  };
}

async function loadCard(db: D1Database, schoolId: number, cardId: number): Promise<Row | null> {
  return db.prepare(`${CARD_SELECT} WHERE card.school_id = ? AND card.id = ?`)
    .bind(schoolId, cardId).first<Row>();
}

const EVENT_SELECT = `
  SELECT event.id, event.event_key, event.school_id, event.employee_id,
         event.academic_year_id, event.employee_name_snapshot AS employee_name,
         event.employee_number_snapshot AS employee_number,
         event.employee_role_snapshot AS employee_role,
         event.job_title_snapshot AS job_title,
         event.event_type, event.occurred_at, event.attendance_date,
         event.attendance_status, event.late_minutes, event.source,
         event.gate_label, event.note, event.manual_reason,
         event.record_status, event.void_reason
  FROM employee_attendance_events event
`;

function publicEvent(row: Row, includeInternal = true): EmployeeAttendanceEvent {
  return {
    id: Number(row.id),
    event_key: String(row.event_key),
    school_id: Number(row.school_id),
    employee_id: Number(row.employee_id),
    academic_year_id: Number(row.academic_year_id),
    employee_name: String(row.employee_name),
    employee_number: row.employee_number == null ? null : String(row.employee_number),
    employee_role: String(row.employee_role),
    job_title: row.job_title == null ? null : String(row.job_title),
    event_type: row.event_type === 'exit' ? 'exit' : 'entry',
    occurred_at: Number(row.occurred_at),
    attendance_date: String(row.attendance_date),
    attendance_status: row.attendance_status,
    attendance_status_label: STAFF_ATTENDANCE_STATUS_LABELS[row.attendance_status as keyof typeof STAFF_ATTENDANCE_STATUS_LABELS],
    late_minutes: Number(row.late_minutes || 0),
    source: row.source === 'manual' ? 'manual' : 'card',
    gate_label: row.gate_label == null ? null : String(row.gate_label),
    note: includeInternal && row.note != null ? String(row.note) : null,
    manual_reason: includeInternal && row.manual_reason != null ? String(row.manual_reason) : null,
    record_status: row.record_status === 'voided' ? 'voided' : 'active',
    void_reason: includeInternal && row.void_reason != null ? String(row.void_reason) : null,
  };
}

async function loadEventByKey(
  db: D1Database,
  schoolId: number,
  eventKey: string,
  includeInternal = true,
): Promise<EmployeeAttendanceEvent | null> {
  const row = await db.prepare(`${EVENT_SELECT} WHERE event.school_id = ? AND event.event_key = ?`)
    .bind(schoolId, eventKey).first<Row>();
  return row ? publicEvent(row, includeInternal) : null;
}

async function persistEvent(c: C, input: {
  schoolId: number;
  employee: Row;
  cardId: number | null;
  direction: StaffAttendanceDirection;
  occurredAt: number;
  source: 'card' | 'manual';
  gateLabel: string | null;
  note: string | null;
  manualReason: string | null;
}): Promise<EmployeeAttendanceEvent> {
  const settings = await loadSettings(c.env.DB, input.schoolId);
  const at = new Date(input.occurredAt * 1000);
  const attendanceDate = businessDate(at);
  requireStaffAttendance(
    attendanceDate >= String(input.employee.starts_at)
      && attendanceDate <= String(input.employee.ends_at)
      && (input.employee.hire_date == null || attendanceDate >= String(input.employee.hire_date)),
    'invalid_staff_attendance_employee',
    409,
  );
  const clock = staffBusinessClock(at);
  const calculated = calculateStaffAttendanceStatus(input.direction, clock, settings);
  const eventKey = crypto.randomUUID();
  const user = c.get('user');
  await c.env.DB.prepare(`
    INSERT INTO employee_attendance_events (
      event_key, school_id, employee_id, academic_year_id,
      employee_name_snapshot, employee_number_snapshot, employee_role_snapshot, job_title_snapshot,
      card_id, event_type, occurred_at, attendance_date, attendance_status, late_minutes,
      work_start_snapshot, late_grace_minutes_snapshot,
      work_end_snapshot, early_exit_grace_minutes_snapshot,
      source, gate_label, note, manual_reason,
      recorded_by_user_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    eventKey,
    input.schoolId,
    input.employee.employee_id,
    input.employee.academic_year_id,
    input.employee.employee_name,
    input.employee.employee_number,
    input.employee.employee_role,
    input.employee.job_title,
    input.cardId,
    input.direction,
    input.occurredAt,
    attendanceDate,
    calculated.status,
    calculated.lateMinutes,
    settings.work_start_time,
    settings.late_grace_minutes,
    settings.work_end_time,
    settings.early_exit_grace_minutes,
    input.source,
    input.gateLabel,
    input.note,
    input.manualReason,
    user.id,
  ).run();
  const event = await loadEventByKey(c.env.DB, input.schoolId, eventKey);
  requireStaffAttendance(event, 'staff_attendance_failed', 500);
  return event;
}

function summaryFromRow(row: Row, date: string): EmployeeAttendanceSummary {
  const entryCount = Number(row.entry_count || 0);
  const exitCount = Number(row.exit_count || 0);
  const lateEntries = Number(row.late_entries || 0);
  const earlyExits = Number(row.early_exits || 0);
  const day_state = entryCount === 0 && exitCount === 0
    ? 'no_record'
    : entryCount > 0 && exitCount === 0
      ? 'inside'
      : entryCount === 0 && exitCount > 0
        ? 'incomplete'
        : lateEntries > 0 || earlyExits > 0
          ? 'exception'
          : 'complete';
  return {
    employee_id: Number(row.employee_id),
    employee_name: String(row.employee_name),
    employee_number: row.employee_number == null ? null : String(row.employee_number),
    employee_role: String(row.employee_role),
    job_title: row.job_title == null ? null : String(row.job_title),
    attendance_date: date,
    first_entry_at: row.first_entry_at == null ? null : Number(row.first_entry_at),
    last_exit_at: row.last_exit_at == null ? null : Number(row.last_exit_at),
    entry_count: entryCount,
    exit_count: exitCount,
    late_entries: lateEntries,
    early_exits: earlyExits,
    late_minutes: Number(row.late_minutes || 0),
    day_state,
  };
}

export function registerStaffAttendanceRoutes(app: Hono<StaffAttendanceEnv>): void {
  const route = (
    method: string,
    path: string,
    allowedRoles: readonly RoleKey[],
    forbiddenCode: string,
    handler: (c: C) => Promise<Response>,
  ) => app.on(method, `/api/staff-attendance/${path}`, async (c) => {
    try {
      const user = c.get('user');
      requireStaffAttendance(user && hasRole(user.role_key, allowedRoles), forbiddenCode, 403);
      return await handler(c);
    } catch (error) {
      const safe = staffAttendanceDatabaseError(error);
      if (safe.status === 500) console.error('[staff-attendance] operation failed', {
        code: safe.code,
        ...(c.env.APP_ENV === 'test' ? { detail: String((error as { message?: unknown })?.message || error) } : {}),
      });
      return c.json({ error: safe.message || staffAttendanceErrorMessage(safe.code), code: safe.code }, safe.status);
    }
  });

  const managementRoute = (method: string, path: string, handler: (c: C) => Promise<Response>) => route(
    method,
    path,
    STAFF_ATTENDANCE_MANAGEMENT_ROLES,
    'staff_attendance_forbidden',
    handler,
  );
  const reportRoute = (method: string, path: string, handler: (c: C) => Promise<Response>) => route(
    method,
    path,
    STAFF_ATTENDANCE_REPORT_ROLES,
    'staff_attendance_report_forbidden',
    handler,
  );

  managementRoute('GET', 'settings', async (c) => {
    const schoolId = await resolveManagementSchool(c, c.req.query('school_id'));
    return c.json({ data: await loadSettings(c.env.DB, schoolId) });
  });

  managementRoute('PUT', 'settings', async (c) => {
    const input = parseStaffAttendanceSettingsInput(await requestBody(c));
    const schoolId = await resolveManagementSchool(c, input.school_id);
    const user = c.get('user');
    await c.env.DB.prepare(`
      INSERT INTO staff_attendance_settings (
        school_id, work_start_time, late_grace_minutes, work_end_time,
        early_exit_grace_minutes, duplicate_window_seconds, updated_by_user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(school_id) DO UPDATE SET
        work_start_time = excluded.work_start_time,
        late_grace_minutes = excluded.late_grace_minutes,
        work_end_time = excluded.work_end_time,
        early_exit_grace_minutes = excluded.early_exit_grace_minutes,
        duplicate_window_seconds = excluded.duplicate_window_seconds,
        updated_by_user_id = excluded.updated_by_user_id,
        updated_at = unixepoch()
    `).bind(
      schoolId,
      input.work_start_time,
      input.late_grace_minutes,
      input.work_end_time,
      input.early_exit_grace_minutes,
      input.duplicate_window_seconds,
      user.id,
    ).run();
    return c.json({ data: await loadSettings(c.env.DB, schoolId) });
  });

  managementRoute('GET', 'employees', async (c) => {
    const schoolId = await resolveManagementSchool(c, c.req.query('school_id'));
    const query = String(c.req.query('query') || '').trim();
    requireStaffAttendance(query.length <= 100, 'invalid_staff_attendance_employee');
    const querySql = query
      ? 'AND (full_name LIKE ? OR employee_number LIKE ? OR job_title LIKE ?)'
      : '';
    const binds: unknown[] = [schoolId];
    if (query) binds.push(`%${query}%`, `%${query}%`, `%${query}%`);
    const result = await c.env.DB.prepare(`
      SELECT id, full_name, employee_number, role, job_title
      FROM employees
      WHERE school_id = ? AND status = 'active' ${querySql}
      ORDER BY full_name, id
      LIMIT 100
    `).bind(...binds).all<Row>();
    const data: StaffAttendanceEmployee[] = (result.results || []).map((row) => ({
      id: Number(row.id),
      full_name: String(row.full_name),
      employee_number: row.employee_number == null ? null : String(row.employee_number),
      role: String(row.role),
      job_title: row.job_title == null ? null : String(row.job_title),
    }));
    return c.json({ data });
  });

  managementRoute('GET', 'cards', async (c) => {
    const schoolId = await resolveManagementSchool(c, c.req.query('school_id'));
    const query = String(c.req.query('query') || '').trim();
    requireStaffAttendance(query.length <= 100, 'invalid_staff_attendance_card_request');
    const status = c.req.query('status') || 'active';
    requireStaffAttendance(
      status === 'active' || status === 'revoked' || status === 'all',
      'invalid_staff_attendance_card_request',
    );
    const statusSql = status === 'all' ? '' : 'AND card.status = ?';
    const querySql = query
      ? 'AND (employee.full_name LIKE ? OR employee.employee_number LIKE ? OR employee.job_title LIKE ?)'
      : '';
    const binds: unknown[] = [schoolId];
    if (status !== 'all') binds.push(status);
    if (query) binds.push(`%${query}%`, `%${query}%`, `%${query}%`);
    const result = await c.env.DB.prepare(`
      ${CARD_SELECT}
      WHERE card.school_id = ? ${statusSql} ${querySql}
      ORDER BY card.status, card.issued_at DESC, card.id DESC
      LIMIT 100
    `).bind(...binds).all<Row>();
    const secret = getValidatedJwtSecret(c.env.JWT_SECRET);
    const cards = await Promise.all((result.results || []).map((row) => publicCard(row, secret)));
    return c.json({ data: cards });
  });

  managementRoute('POST', 'cards', async (c) => {
    const input = parseEmployeeAttendanceCardIssueInput(await requestBody(c));
    const schoolId = await resolveManagementSchool(c, input.school_id);
    const employee = await loadEmployeeContext(c.env.DB, schoolId, input.employee_id);
    requireStaffAttendance(employee, 'invalid_staff_attendance_employee', 409);
    const publicId = crypto.randomUUID();
    const user = c.get('user');
    const created = await c.env.DB.prepare(`
      INSERT INTO employee_attendance_cards (public_id, school_id, employee_id, issued_by_user_id)
      VALUES (?, ?, ?, ?)
      RETURNING id
    `).bind(publicId, schoolId, input.employee_id, user.id).first<{ id: number }>();
    requireStaffAttendance(created, 'staff_attendance_failed', 500);
    const row = await loadCard(c.env.DB, schoolId, Number(created.id));
    requireStaffAttendance(row, 'staff_attendance_failed', 500);
    return c.json({ data: await publicCard(row, getValidatedJwtSecret(c.env.JWT_SECRET)) }, 201);
  });

  managementRoute('POST', 'cards/:id/revoke', async (c) => {
    const cardId = positiveId(c.req.param('id'), 'staff_attendance_card_not_found');
    const input = parseEmployeeAttendanceCardRevokeInput(await requestBody(c));
    const schoolId = await resolveManagementSchool(c, input.school_id);
    const user = c.get('user');
    const changed = await c.env.DB.prepare(`
      UPDATE employee_attendance_cards
      SET status = 'revoked', revoked_by_user_id = ?, revoked_at = unixepoch(),
          revocation_reason = ?, updated_at = unixepoch()
      WHERE id = ? AND school_id = ? AND status = 'active'
      RETURNING id
    `).bind(user.id, input.reason, cardId, schoolId).first<{ id: number }>();
    if (!changed) {
      const existing = await c.env.DB.prepare(
        'SELECT status FROM employee_attendance_cards WHERE id = ? AND school_id = ?',
      ).bind(cardId, schoolId).first<{ status: string }>();
      requireStaffAttendance(existing, 'staff_attendance_card_not_found', 404);
      throw new StaffAttendanceError(
        'invalid_staff_attendance_card',
        409,
        'بطاقة الموظف ملغاة مسبقًا',
      );
    }
    const row = await loadCard(c.env.DB, schoolId, cardId);
    requireStaffAttendance(row, 'staff_attendance_failed', 500);
    return c.json({ data: await publicCard(row, getValidatedJwtSecret(c.env.JWT_SECRET)) });
  });

  managementRoute('POST', 'scan', async (c) => {
    const input = parseStaffAttendanceScanInput(await requestBody(c));
    const schoolId = await resolveManagementSchool(c, input.school_id);
    const publicId = await verifyEmployeeAttendanceCardPayload(
      input.card_payload,
      getValidatedJwtSecret(c.env.JWT_SECRET),
    );
    requireStaffAttendance(publicId, 'invalid_staff_attendance_card', 409);
    const card = await c.env.DB.prepare(`
      SELECT id, employee_id
      FROM employee_attendance_cards
      WHERE public_id = ? AND school_id = ? AND status = 'active'
    `).bind(publicId, schoolId).first<Row>();
    requireStaffAttendance(card, 'invalid_staff_attendance_card', 409);
    const employee = await loadEmployeeContext(c.env.DB, schoolId, Number(card.employee_id));
    requireStaffAttendance(employee, 'invalid_staff_attendance_employee', 409);
    const event = await persistEvent(c, {
      schoolId,
      employee,
      cardId: Number(card.id),
      direction: input.direction,
      occurredAt: Math.floor(Date.now() / 1000),
      source: 'card',
      gateLabel: input.gate_label,
      note: null,
      manualReason: null,
    });
    return c.json({ data: event }, 201);
  });

  managementRoute('POST', 'manual', async (c) => {
    const input = parseManualStaffAttendanceEventInput(await requestBody(c));
    const schoolId = await resolveManagementSchool(c, input.school_id);
    const now = Math.floor(Date.now() / 1000);
    requireStaffAttendance(
      input.occurred_at <= now + 60 && input.occurred_at >= now - 30 * 86_400,
      'staff_attendance_manual_time_out_of_range',
    );
    const employee = await loadEmployeeContext(c.env.DB, schoolId, input.employee_id);
    requireStaffAttendance(employee, 'invalid_staff_attendance_employee', 409);
    const event = await persistEvent(c, {
      schoolId,
      employee,
      cardId: null,
      direction: input.direction,
      occurredAt: input.occurred_at,
      source: 'manual',
      gateLabel: input.gate_label,
      note: input.note,
      manualReason: input.reason,
    });
    return c.json({ data: event }, 201);
  });

  reportRoute('GET', 'events', async (c) => {
    const schoolId = await resolveReportSchool(c, c.req.query('school_id'));
    const date = c.req.query('date')
      ? parseStaffAttendanceDate(c.req.query('date'))
      : businessDate();
    const requestedEmployee = c.req.query('employee_id');
    const employeeId = requestedEmployee ? positiveId(requestedEmployee, 'invalid_staff_attendance_employee') : null;
    const employeeSql = employeeId == null ? '' : 'AND event.employee_id = ?';
    const binds: unknown[] = [schoolId, date];
    if (employeeId != null) binds.push(employeeId);
    const result = await c.env.DB.prepare(`
      ${EVENT_SELECT}
      WHERE event.school_id = ? AND event.attendance_date = ? ${employeeSql}
      ORDER BY event.occurred_at DESC, event.id DESC
      LIMIT 1000
    `).bind(...binds).all<Row>();
    const includeInternal = hasRole(c.get('user').role_key, STAFF_ATTENDANCE_MANAGEMENT_ROLES);
    return c.json({ data: (result.results || []).map((row) => publicEvent(row, includeInternal)) });
  });

  reportRoute('GET', 'summary', async (c) => {
    const schoolId = await resolveReportSchool(c, c.req.query('school_id'));
    const date = c.req.query('date')
      ? parseStaffAttendanceDate(c.req.query('date'))
      : businessDate();
    const result = await c.env.DB.prepare(`
      SELECT employee.id AS employee_id, employee.full_name AS employee_name,
             employee.employee_number, employee.role AS employee_role, employee.job_title,
             min(CASE WHEN event.event_type = 'entry' THEN event.occurred_at END) AS first_entry_at,
             max(CASE WHEN event.event_type = 'exit' THEN event.occurred_at END) AS last_exit_at,
             sum(CASE WHEN event.event_type = 'entry' THEN 1 ELSE 0 END) AS entry_count,
             sum(CASE WHEN event.event_type = 'exit' THEN 1 ELSE 0 END) AS exit_count,
             sum(CASE WHEN event.attendance_status = 'late' THEN 1 ELSE 0 END) AS late_entries,
             sum(CASE WHEN event.attendance_status = 'early_exit' THEN 1 ELSE 0 END) AS early_exits,
             sum(CASE WHEN event.attendance_status = 'late' THEN event.late_minutes ELSE 0 END) AS late_minutes
      FROM employees employee
      LEFT JOIN employee_attendance_events event
        ON event.school_id = employee.school_id
       AND event.employee_id = employee.id
       AND event.attendance_date = ?
       AND event.record_status = 'active'
      WHERE employee.school_id = ? AND employee.status = 'active'
        AND (employee.hire_date IS NULL OR employee.hire_date <= ?)
      GROUP BY employee.id, employee.full_name, employee.employee_number, employee.role, employee.job_title
      ORDER BY employee.full_name, employee.id
    `).bind(date, schoolId, date).all<Row>();
    return c.json({ data: (result.results || []).map((row) => summaryFromRow(row, date)) });
  });

  managementRoute('POST', 'events/:id/void', async (c) => {
    const eventId = positiveId(c.req.param('id'), 'staff_attendance_event_not_found');
    const input = parseStaffAttendanceEventVoidInput(await requestBody(c));
    const schoolId = await resolveManagementSchool(c, input.school_id);
    const existing = await c.env.DB.prepare(`
      SELECT id, event_key, record_status
      FROM employee_attendance_events
      WHERE id = ? AND school_id = ?
    `).bind(eventId, schoolId).first<Row>();
    requireStaffAttendance(existing, 'staff_attendance_event_not_found', 404);
    requireStaffAttendance(
      existing.record_status === 'active',
      'staff_attendance_event_already_voided',
      409,
    );
    const user = c.get('user');
    const now = Math.floor(Date.now() / 1000);
    const guard = crypto.randomUUID();
    await c.env.DB.batch([
      c.env.DB.prepare(`
        INSERT INTO employee_attendance_write_guards (token, valid)
        VALUES (?, EXISTS(
          SELECT 1 FROM employee_attendance_events
          WHERE id = ? AND school_id = ? AND event_key = ? AND record_status = 'active'
        ))
      `).bind(guard, eventId, schoolId, existing.event_key),
      c.env.DB.prepare(`
        UPDATE employee_attendance_events
        SET record_status = 'voided', voided_by_user_id = ?, voided_at = ?,
            void_reason = ?, updated_at = ?
        WHERE id = ? AND school_id = ? AND event_key = ? AND record_status = 'active'
      `).bind(user.id, now, input.reason, now, eventId, schoolId, existing.event_key),
      c.env.DB.prepare('DELETE FROM employee_attendance_write_guards WHERE token = ?').bind(guard),
    ]);
    const event = await loadEventByKey(c.env.DB, schoolId, String(existing.event_key));
    requireStaffAttendance(event, 'staff_attendance_failed', 500);
    return c.json({ data: event });
  });

  app.get('/api/staff-attendance/self', async (c) => {
    try {
      const user = c.get('user');
      requireStaffAttendance(
        user?.role_key === 'teacher' && user.school_id != null,
        'staff_attendance_self_only',
        403,
      );
      const range = validateStaffAttendanceRange(c.req.query('from'), c.req.query('to'));
      const employee = await c.env.DB.prepare(`
        SELECT employee.id, employee.full_name, employee.employee_number,
               employee.role, employee.job_title
        FROM teacher_employee_links link
        JOIN employees employee
          ON employee.id = link.employee_id
         AND employee.school_id = link.school_id
         AND employee.status = 'active'
         AND employee.role = 'teacher'
        WHERE link.school_id = ? AND link.teacher_user_id = ? AND link.status = 'active'
        LIMIT 1
      `).bind(user.school_id, user.id).first<Row>();
      requireStaffAttendance(employee, 'staff_attendance_self_only', 403);
      const result = await c.env.DB.prepare(`
        ${EVENT_SELECT}
        WHERE event.school_id = ? AND event.employee_id = ?
          AND event.attendance_date BETWEEN ? AND ?
          AND event.record_status = 'active'
        ORDER BY event.occurred_at DESC, event.id DESC
        LIMIT 1000
      `).bind(user.school_id, employee.id, range.from, range.to).all<Row>();
      const data: MyStaffAttendanceFeed = {
        range,
        employee: {
          id: Number(employee.id),
          full_name: String(employee.full_name),
          employee_number: employee.employee_number == null ? null : String(employee.employee_number),
          role: String(employee.role),
          job_title: employee.job_title == null ? null : String(employee.job_title),
        },
        events: (result.results || []).map((row) => publicEvent(row, false)),
      };
      return c.json({ data });
    } catch (error) {
      const safe = staffAttendanceDatabaseError(error);
      return c.json({ error: safe.message || staffAttendanceErrorMessage(safe.code), code: safe.code }, safe.status);
    }
  });
}
