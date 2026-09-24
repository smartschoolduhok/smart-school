import { communicationNotificationAccessSql } from './parentCommunicationDb';
import type { Context, Hono } from 'hono';
import type { Bindings, Variables } from '../worker';
import { businessDate } from './businessTime';
import { getValidatedJwtSecret } from './jwtSecurity';
import {
  GATE_ATTENDANCE_MANAGEMENT_ROLES,
  hasRole,
} from './rbac';
import {
  GATE_DIRECTION_LABELS,
  GATE_STATUS_LABELS,
  GateAttendanceError,
  businessClock,
  calculateGateStatus,
  createGateCardPayload,
  gateAttendanceDatabaseError,
  gateAttendanceErrorMessage,
  parseGateCardIssueInput,
  parseGateCardRevokeInput,
  parseGateDate,
  parseGateEventVoidInput,
  parseGateScanInput,
  parseGateSettingsInput,
  parseManualGateEventInput,
  requireGateAttendance,
  validateGateRange,
  verifyGateCardPayload,
  type GateAttendanceSettings,
  type GateAttendanceSettingsInput,
  type GateDirection,
  type NotificationFeed,
  type ParentGateAttendanceFeed,
  type StudentGateCard,
  type StudentGateEvent,
} from './gateAttendance';

type GateEnv = { Bindings: Bindings; Variables: Variables };
type C = Context<GateEnv>;
type Row = Record<string, any>;

const DEFAULT_SETTINGS = {
  school_start_time: '08:00',
  late_grace_minutes: 10,
  school_end_time: '14:00',
  early_exit_grace_minutes: 0,
  duplicate_window_seconds: 60,
  parent_notifications_enabled: true,
} as const;

async function requestBody(c: C): Promise<unknown> {
  const text = await c.req.text();
  requireGateAttendance(text.length <= 64_000, 'invalid_gate_request');
  try {
    return JSON.parse(text);
  } catch {
    throw new GateAttendanceError('invalid_gate_request');
  }
}

function positiveId(value: unknown, code: string): number {
  const parsed = Number(value);
  requireGateAttendance(Number.isSafeInteger(parsed) && parsed > 0, code);
  return parsed;
}

async function resolveManagementSchool(c: C, supplied: unknown): Promise<number> {
  const user = c.get('user');
  requireGateAttendance(user && hasRole(user.role_key, GATE_ATTENDANCE_MANAGEMENT_ROLES), 'gate_forbidden', 403);
  const requested = supplied == null || supplied === '' ? null : positiveId(supplied, 'invalid_gate_school');
  let schoolId: number;
  if (user.role_key === 'system_admin') {
    requireGateAttendance(requested != null, 'gate_target_required');
    schoolId = requested;
  } else {
    requireGateAttendance(user.school_id != null, 'gate_forbidden', 403);
    requireGateAttendance(requested == null || requested === user.school_id, 'gate_forbidden', 403);
    schoolId = user.school_id;
  }
  const school = await c.env.DB.prepare("SELECT id FROM schools WHERE id = ? AND status = 'active'")
    .bind(schoolId).first<Row>();
  requireGateAttendance(school, 'gate_target_required');
  return schoolId;
}

function settingsFromRow(schoolId: number, row: Row | null): GateAttendanceSettings {
  return {
    school_id: schoolId,
    school_start_time: String(row?.school_start_time || DEFAULT_SETTINGS.school_start_time),
    late_grace_minutes: Number(row?.late_grace_minutes ?? DEFAULT_SETTINGS.late_grace_minutes),
    school_end_time: String(row?.school_end_time || DEFAULT_SETTINGS.school_end_time),
    early_exit_grace_minutes: Number(row?.early_exit_grace_minutes ?? DEFAULT_SETTINGS.early_exit_grace_minutes),
    duplicate_window_seconds: Number(row?.duplicate_window_seconds ?? DEFAULT_SETTINGS.duplicate_window_seconds),
    parent_notifications_enabled: row == null
      ? DEFAULT_SETTINGS.parent_notifications_enabled
      : Number(row.parent_notifications_enabled) === 1,
    updated_at: row?.updated_at == null ? null : Number(row.updated_at),
  };
}

async function loadSettings(db: D1Database, schoolId: number): Promise<GateAttendanceSettings> {
  const row = await db.prepare('SELECT * FROM gate_attendance_settings WHERE school_id = ?')
    .bind(schoolId).first<Row>();
  return settingsFromRow(schoolId, row);
}

async function loadStudentContext(db: D1Database, schoolId: number, studentId: number): Promise<Row | null> {
  return db.prepare(`
    SELECT student.id AS student_id, student.full_name AS student_name,
           student.student_number, enrollment.academic_year_id,
           year.starts_at, year.ends_at,
           enrollment.class_id, class.name AS class_name,
           enrollment.section_id, section.name AS section_name
    FROM students student
    JOIN student_enrollments enrollment
      ON enrollment.student_id = student.id
     AND enrollment.school_id = student.school_id
     AND enrollment.status = 'active'
    JOIN academic_years year
      ON year.id = enrollment.academic_year_id
     AND year.school_id = enrollment.school_id
     AND year.is_active = 1
    JOIN classes class
      ON class.id = enrollment.class_id
     AND class.school_id = enrollment.school_id
     AND class.status = 'active'
    LEFT JOIN sections section
      ON section.id = enrollment.section_id
     AND section.school_id = enrollment.school_id
     AND section.class_id = enrollment.class_id
     AND section.status = 'active'
    WHERE student.id = ? AND student.school_id = ? AND student.status = 'active'
    ORDER BY year.starts_at DESC, enrollment.id DESC
    LIMIT 1
  `).bind(studentId, schoolId).first<Row>();
}

const CARD_SELECT = `
  SELECT card.id, card.public_id, card.school_id, card.student_id, card.status,
         card.issued_at, card.revoked_at, card.revocation_reason,
         student.full_name AS student_name, student.student_number,
         class.name AS class_name, section.name AS section_name
  FROM student_gate_cards card
  JOIN students student ON student.id = card.student_id AND student.school_id = card.school_id
  LEFT JOIN student_enrollments enrollment
    ON enrollment.id = (
      SELECT candidate.id
      FROM student_enrollments candidate
      JOIN academic_years active_year
        ON active_year.id = candidate.academic_year_id
       AND active_year.school_id = candidate.school_id
       AND active_year.is_active = 1
      WHERE candidate.school_id = card.school_id
        AND candidate.student_id = card.student_id
        AND candidate.status = 'active'
      ORDER BY active_year.starts_at DESC, candidate.id DESC
      LIMIT 1
    )
  LEFT JOIN classes class ON class.id = enrollment.class_id AND class.school_id = enrollment.school_id
  LEFT JOIN sections section ON section.id = enrollment.section_id AND section.school_id = enrollment.school_id
`;

async function publicCard(row: Row, secret: string): Promise<StudentGateCard> {
  return {
    id: Number(row.id),
    public_id: String(row.public_id),
    school_id: Number(row.school_id),
    student_id: Number(row.student_id),
    student_name: String(row.student_name),
    student_number: String(row.student_number),
    class_name: row.class_name == null ? null : String(row.class_name),
    section_name: row.section_name == null ? null : String(row.section_name),
    status: row.status === 'revoked' ? 'revoked' : 'active',
    issued_at: Number(row.issued_at),
    revoked_at: row.revoked_at == null ? null : Number(row.revoked_at),
    revocation_reason: row.revocation_reason == null ? null : String(row.revocation_reason),
    qr_value: await createGateCardPayload(String(row.public_id), secret),
  };
}

async function loadCard(db: D1Database, schoolId: number, cardId: number): Promise<Row | null> {
  return db.prepare(`${CARD_SELECT} WHERE card.school_id = ? AND card.id = ?`)
    .bind(schoolId, cardId).first<Row>();
}

const EVENT_SELECT = `
  SELECT event.id, event.event_key, event.school_id, event.student_id,
         event.student_name_snapshot AS student_name,
         event.student_number_snapshot AS student_number,
         event.class_name_snapshot AS class_name,
         event.section_name_snapshot AS section_name,
         event.event_type, event.occurred_at, event.attendance_date,
         event.attendance_status, event.late_minutes, event.source,
         event.gate_label, event.note, event.record_status, event.void_reason
  FROM student_gate_events event
`;

function publicEvent(row: Row, includeInternalNote = true): StudentGateEvent {
  return {
    id: Number(row.id),
    event_key: String(row.event_key),
    school_id: Number(row.school_id),
    student_id: Number(row.student_id),
    student_name: String(row.student_name),
    student_number: String(row.student_number),
    class_name: row.class_name == null ? null : String(row.class_name),
    section_name: row.section_name == null ? null : String(row.section_name),
    event_type: row.event_type === 'exit' ? 'exit' : 'entry',
    occurred_at: Number(row.occurred_at),
    attendance_date: String(row.attendance_date),
    attendance_status: row.attendance_status,
    attendance_status_label: GATE_STATUS_LABELS[row.attendance_status as keyof typeof GATE_STATUS_LABELS],
    late_minutes: Number(row.late_minutes || 0),
    source: row.source === 'manual' ? 'manual' : 'card',
    gate_label: row.gate_label == null ? null : String(row.gate_label),
    note: includeInternalNote && row.note != null ? String(row.note) : null,
    record_status: row.record_status === 'voided' ? 'voided' : 'active',
    void_reason: includeInternalNote && row.void_reason != null ? String(row.void_reason) : null,
  };
}

async function loadEventByKey(db: D1Database, schoolId: number, eventKey: string): Promise<StudentGateEvent | null> {
  const row = await db.prepare(`${EVENT_SELECT} WHERE event.school_id = ? AND event.event_key = ?`)
    .bind(schoolId, eventKey).first<Row>();
  return row ? publicEvent(row) : null;
}

function notificationCopy(student: Row, direction: GateDirection, clock: string, status: string, lateMinutes: number) {
  const title = direction === 'entry' ? 'دخول الطالب إلى المدرسة' : 'خروج الطالب من المدرسة';
  const timing = status === 'late'
    ? ` متأخرًا ${lateMinutes} دقيقة`
    : status === 'early_exit'
      ? ' قبل نهاية الدوام'
      : '';
  return {
    title,
    body: `${student.student_name}: ${GATE_DIRECTION_LABELS[direction]} الساعة ${clock}${timing}.`,
  };
}

async function persistEvent(c: C, input: {
  schoolId: number;
  student: Row;
  cardId: number | null;
  direction: GateDirection;
  occurredAt: number;
  source: 'card' | 'manual';
  gateLabel: string | null;
  note: string | null;
  manualReason: string | null;
}): Promise<StudentGateEvent> {
  const settings = await loadSettings(c.env.DB, input.schoolId);
  const at = new Date(input.occurredAt * 1000);
  const attendanceDate = businessDate(at);
  requireGateAttendance(
    attendanceDate >= String(input.student.starts_at) && attendanceDate <= String(input.student.ends_at),
    'invalid_gate_student',
    409,
  );
  const clock = businessClock(at);
  const calculated = calculateGateStatus(input.direction, clock, settings);
  const eventKey = crypto.randomUUID();
  const notificationKey = crypto.randomUUID();
  const user = c.get('user');
  const copy = notificationCopy(input.student, input.direction, clock, calculated.status, calculated.lateMinutes);

  const statements = [
    c.env.DB.prepare(`
      INSERT INTO student_gate_events (
        event_key, school_id, student_id, academic_year_id, class_id, section_id,
        student_name_snapshot, student_number_snapshot, class_name_snapshot, section_name_snapshot,
        card_id, event_type, occurred_at, attendance_date, attendance_status, late_minutes,
        school_start_snapshot, school_end_snapshot, source, gate_label, note, manual_reason,
        recorded_by_user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      eventKey,
      input.schoolId,
      input.student.student_id,
      input.student.academic_year_id,
      input.student.class_id,
      input.student.section_id,
      input.student.student_name,
      input.student.student_number,
      input.student.class_name,
      input.student.section_name,
      input.cardId,
      input.direction,
      input.occurredAt,
      attendanceDate,
      calculated.status,
      calculated.lateMinutes,
      settings.school_start_time,
      settings.school_end_time,
      input.source,
      input.gateLabel,
      input.note,
      input.manualReason,
      user.id,
    ),
  ];

  if (settings.parent_notifications_enabled) {
    statements.push(
      c.env.DB.prepare(`
        INSERT INTO school_notifications (
          notification_key, school_id, notification_type, title, body, student_id,
          reference_type, reference_key, created_by_user_id
        ) VALUES (?, ?, ?, ?, ?, ?, 'student_gate_event', ?, ?)
      `).bind(
        notificationKey,
        input.schoolId,
        input.direction === 'entry' ? 'student_gate_entry' : 'student_gate_exit',
        copy.title,
        copy.body,
        input.student.student_id,
        eventKey,
        user.id,
      ),
      c.env.DB.prepare(`
        INSERT INTO notification_recipients (school_id, notification_key, user_id)
        SELECT link.school_id, ?, link.parent_user_id
        FROM parent_student_links link
        JOIN users parent
          ON parent.id = link.parent_user_id
         AND parent.school_id = link.school_id
         AND parent.status = 'active'
        JOIN roles role ON role.id = parent.role_id AND role.key = 'parent'
        WHERE link.school_id = ? AND link.student_id = ? AND link.status = 'active'
      `).bind(notificationKey, input.schoolId, input.student.student_id),
    );
  }

  await c.env.DB.batch(statements);
  const event = await loadEventByKey(c.env.DB, input.schoolId, eventKey);
  requireGateAttendance(event, 'gate_failed', 500);
  return event;
}

export function registerGateAttendanceRoutes(app: Hono<GateEnv>): void {
  const staffRoute = (method: string, path: string, handler: (c: C) => Promise<Response>) => app.on(
    method,
    `/api/gate-attendance/${path}`,
    async (c) => {
      try {
        const user = c.get('user');
        requireGateAttendance(user && hasRole(user.role_key, GATE_ATTENDANCE_MANAGEMENT_ROLES), 'gate_forbidden', 403);
        return await handler(c);
      } catch (error) {
        const safe = gateAttendanceDatabaseError(error);
        if (safe.status === 500) console.error('[gate-attendance] operation failed', {
          code: safe.code,
          ...(c.env.APP_ENV === 'test' ? { detail: String((error as { message?: unknown })?.message || error) } : {}),
        });
        return c.json({ error: safe.message || gateAttendanceErrorMessage(safe.code), code: safe.code }, safe.status);
      }
    },
  );

  staffRoute('GET', 'settings', async (c) => {
    const schoolId = await resolveManagementSchool(c, c.req.query('school_id'));
    return c.json({ data: await loadSettings(c.env.DB, schoolId) });
  });

  staffRoute('PUT', 'settings', async (c) => {
    const input = parseGateSettingsInput(await requestBody(c));
    const schoolId = await resolveManagementSchool(c, input.school_id);
    const user = c.get('user');
    await c.env.DB.prepare(`
      INSERT INTO gate_attendance_settings (
        school_id, school_start_time, late_grace_minutes, school_end_time,
        early_exit_grace_minutes, duplicate_window_seconds,
        parent_notifications_enabled, updated_by_user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(school_id) DO UPDATE SET
        school_start_time = excluded.school_start_time,
        late_grace_minutes = excluded.late_grace_minutes,
        school_end_time = excluded.school_end_time,
        early_exit_grace_minutes = excluded.early_exit_grace_minutes,
        duplicate_window_seconds = excluded.duplicate_window_seconds,
        parent_notifications_enabled = excluded.parent_notifications_enabled,
        updated_by_user_id = excluded.updated_by_user_id,
        updated_at = unixepoch()
    `).bind(
      schoolId,
      input.school_start_time,
      input.late_grace_minutes,
      input.school_end_time,
      input.early_exit_grace_minutes,
      input.duplicate_window_seconds,
      input.parent_notifications_enabled ? 1 : 0,
      user.id,
    ).run();
    return c.json({ data: await loadSettings(c.env.DB, schoolId) });
  });

  staffRoute('GET', 'cards', async (c) => {
    const schoolId = await resolveManagementSchool(c, c.req.query('school_id'));
    const query = String(c.req.query('query') || '').trim();
    requireGateAttendance(query.length <= 100, 'invalid_gate_card_request');
    const status = c.req.query('status') || 'active';
    requireGateAttendance(status === 'active' || status === 'revoked' || status === 'all', 'invalid_gate_card_request');
    const statusSql = status === 'all' ? '' : 'AND card.status = ?';
    const querySql = query ? 'AND (student.full_name LIKE ? OR student.student_number LIKE ?)' : '';
    const binds: unknown[] = [schoolId];
    if (status !== 'all') binds.push(status);
    if (query) binds.push(`%${query}%`, `%${query}%`);
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

  staffRoute('POST', 'cards', async (c) => {
    const input = parseGateCardIssueInput(await requestBody(c));
    const schoolId = await resolveManagementSchool(c, input.school_id);
    const student = await loadStudentContext(c.env.DB, schoolId, input.student_id);
    requireGateAttendance(student, 'invalid_gate_student', 409);
    const publicId = crypto.randomUUID();
    const user = c.get('user');
    const created = await c.env.DB.prepare(`
      INSERT INTO student_gate_cards (public_id, school_id, student_id, issued_by_user_id)
      VALUES (?, ?, ?, ?)
      RETURNING id
    `).bind(publicId, schoolId, input.student_id, user.id).first<{ id: number }>();
    requireGateAttendance(created, 'gate_failed', 500);
    const row = await loadCard(c.env.DB, schoolId, Number(created.id));
    requireGateAttendance(row, 'gate_failed', 500);
    return c.json({ data: await publicCard(row, getValidatedJwtSecret(c.env.JWT_SECRET)) }, 201);
  });

  staffRoute('POST', 'cards/:id/revoke', async (c) => {
    const cardId = positiveId(c.req.param('id'), 'gate_card_not_found');
    const input = parseGateCardRevokeInput(await requestBody(c));
    const schoolId = await resolveManagementSchool(c, input.school_id);
    const user = c.get('user');
    const changed = await c.env.DB.prepare(`
      UPDATE student_gate_cards
      SET status = 'revoked', revoked_by_user_id = ?, revoked_at = unixepoch(),
          revocation_reason = ?, updated_at = unixepoch()
      WHERE id = ? AND school_id = ? AND status = 'active'
      RETURNING id
    `).bind(user.id, input.reason, cardId, schoolId).first<{ id: number }>();
    if (!changed) {
      const existing = await c.env.DB.prepare('SELECT status FROM student_gate_cards WHERE id = ? AND school_id = ?')
        .bind(cardId, schoolId).first<{ status: string }>();
      requireGateAttendance(existing, 'gate_card_not_found', 404);
      throw new GateAttendanceError('invalid_gate_card', 409, 'البطاقة ملغاة مسبقًا');
    }
    const row = await loadCard(c.env.DB, schoolId, cardId);
    requireGateAttendance(row, 'gate_failed', 500);
    return c.json({ data: await publicCard(row, getValidatedJwtSecret(c.env.JWT_SECRET)) });
  });

  staffRoute('POST', 'scan', async (c) => {
    const input = parseGateScanInput(await requestBody(c));
    const schoolId = await resolveManagementSchool(c, input.school_id);
    const secret = getValidatedJwtSecret(c.env.JWT_SECRET);
    const publicId = await verifyGateCardPayload(input.card_payload, secret);
    requireGateAttendance(publicId, 'invalid_gate_card', 409);
    const card = await c.env.DB.prepare(`
      SELECT id, student_id FROM student_gate_cards
      WHERE public_id = ? AND school_id = ? AND status = 'active'
    `).bind(publicId, schoolId).first<Row>();
    requireGateAttendance(card, 'invalid_gate_card', 409);
    const student = await loadStudentContext(c.env.DB, schoolId, Number(card.student_id));
    requireGateAttendance(student, 'invalid_gate_student', 409);
    const event = await persistEvent(c, {
      schoolId,
      student,
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

  staffRoute('POST', 'manual', async (c) => {
    const input = parseManualGateEventInput(await requestBody(c));
    const schoolId = await resolveManagementSchool(c, input.school_id);
    const now = Math.floor(Date.now() / 1000);
    requireGateAttendance(
      input.occurred_at <= now + 60 && input.occurred_at >= now - 30 * 86_400,
      'gate_manual_time_out_of_range',
    );
    const student = await loadStudentContext(c.env.DB, schoolId, input.student_id);
    requireGateAttendance(student, 'invalid_gate_student', 409);
    const event = await persistEvent(c, {
      schoolId,
      student,
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

  staffRoute('GET', 'events', async (c) => {
    const schoolId = await resolveManagementSchool(c, c.req.query('school_id'));
    const date = c.req.query('date') ? parseGateDate(c.req.query('date')) : businessDate();
    const result = await c.env.DB.prepare(`
      ${EVENT_SELECT}
      WHERE event.school_id = ? AND event.attendance_date = ?
      ORDER BY event.occurred_at DESC, event.id DESC
      LIMIT 500
    `).bind(schoolId, date).all<Row>();
    return c.json({ data: (result.results || []).map((row) => publicEvent(row)) });
  });

  staffRoute('POST', 'events/:id/void', async (c) => {
    const eventId = positiveId(c.req.param('id'), 'gate_event_not_found');
    const input = parseGateEventVoidInput(await requestBody(c));
    const schoolId = await resolveManagementSchool(c, input.school_id);
    const existing = await c.env.DB.prepare(`
      SELECT id, event_key, record_status FROM student_gate_events WHERE id = ? AND school_id = ?
    `).bind(eventId, schoolId).first<Row>();
    requireGateAttendance(existing, 'gate_event_not_found', 404);
    requireGateAttendance(existing.record_status === 'active', 'gate_event_already_voided', 409);
    const user = c.get('user');
    const now = Math.floor(Date.now() / 1000);
    const guard = crypto.randomUUID();
    await c.env.DB.batch([
      c.env.DB.prepare(`
        INSERT INTO gate_attendance_write_guards (token, valid)
        VALUES (?, EXISTS(
          SELECT 1 FROM student_gate_events
          WHERE id = ? AND school_id = ? AND event_key = ? AND record_status = 'active'
        ))
      `).bind(guard, eventId, schoolId, existing.event_key),
      c.env.DB.prepare(`
        UPDATE student_gate_events
        SET record_status = 'voided', voided_by_user_id = ?, voided_at = ?,
            void_reason = ?, updated_at = ?
        WHERE id = ? AND school_id = ? AND event_key = ? AND record_status = 'active'
      `).bind(user.id, now, input.reason, now, eventId, schoolId, existing.event_key),
      c.env.DB.prepare(`
        UPDATE school_notifications
        SET status = 'withdrawn', withdrawn_at = ?
        WHERE school_id = ? AND reference_type = 'student_gate_event'
          AND reference_key = ? AND status = 'active'
      `).bind(now, schoolId, existing.event_key),
      c.env.DB.prepare('DELETE FROM gate_attendance_write_guards WHERE token = ?').bind(guard),
    ]);
    const event = await loadEventByKey(c.env.DB, schoolId, String(existing.event_key));
    requireGateAttendance(event, 'gate_failed', 500);
    return c.json({ data: event });
  });

  app.get('/api/gate-attendance/parent', async (c) => {
    try {
      const user = c.get('user');
      requireGateAttendance(user?.role_key === 'parent' && user.school_id != null, 'gate_parent_only', 403);
      const range = validateGateRange(c.req.query('from'), c.req.query('to'));
      const studentsResult = await c.env.DB.prepare(`
        SELECT student.id, student.full_name, student.student_number
        FROM parent_student_links link
        JOIN students student
          ON student.id = link.student_id
         AND student.school_id = link.school_id
         AND student.status = 'active'
        WHERE link.school_id = ? AND link.parent_user_id = ? AND link.status = 'active'
        ORDER BY student.full_name, student.id
      `).bind(user.school_id, user.id).all<Row>();
      const eventsResult = await c.env.DB.prepare(`
        ${EVENT_SELECT}
        JOIN parent_student_links link
          ON link.school_id = event.school_id
         AND link.student_id = event.student_id
         AND link.parent_user_id = ?
         AND link.status = 'active'
        WHERE event.school_id = ?
          AND event.attendance_date BETWEEN ? AND ?
          AND event.record_status = 'active'
        ORDER BY event.occurred_at DESC, event.id DESC
        LIMIT 1000
      `).bind(user.id, user.school_id, range.from, range.to).all<Row>();
      const data: ParentGateAttendanceFeed = {
        range,
        students: (studentsResult.results || []).map((row) => ({
          id: Number(row.id),
          full_name: String(row.full_name),
          student_number: String(row.student_number),
        })),
        events: (eventsResult.results || []).map((row) => publicEvent(row, false)),
      };
      return c.json({ data });
    } catch (error) {
      const safe = gateAttendanceDatabaseError(error);
      return c.json({ error: safe.message || gateAttendanceErrorMessage(safe.code), code: safe.code }, safe.status);
    }
  });

  app.get('/api/notifications', async (c) => {
    try {
      const user = c.get('user');
      requireGateAttendance(user, 'gate_forbidden', 403);
      const limit = Math.min(50, Math.max(1, Number(c.req.query('limit')) || 20));
      const [feed, unread] = await Promise.all([
        c.env.DB.prepare(`
          SELECT notification.notification_key, notification.notification_type,
                 notification.title, notification.body, notification.student_id,
                 notification.reference_type, notification.reference_key,
                 notification.created_at, recipient.read_at
          FROM notification_recipients recipient
          JOIN school_notifications notification
            ON notification.notification_key = recipient.notification_key
           AND notification.school_id = recipient.school_id
           AND notification.status = 'active'
            AND ${communicationNotificationAccessSql}
          WHERE recipient.user_id = ? AND recipient.school_id = ?
            AND (
              notification.student_id IS NULL
              OR EXISTS (
                SELECT 1 FROM users target
                JOIN roles target_role ON target_role.id = target.role_id
                WHERE target.id = recipient.user_id AND target_role.key <> 'parent'
              )
              OR EXISTS (
                SELECT 1 FROM parent_student_links current_link
                WHERE current_link.school_id = recipient.school_id
                  AND current_link.parent_user_id = recipient.user_id
                  AND current_link.student_id = notification.student_id
                  AND current_link.status = 'active'
              )
            )
          ORDER BY notification.created_at DESC, notification.notification_key DESC
          LIMIT ?
        `).bind(user.id, user.school_id, limit).all<Row>(),
        c.env.DB.prepare(`
          SELECT COUNT(*) AS count
          FROM notification_recipients recipient
          JOIN school_notifications notification
            ON notification.notification_key = recipient.notification_key
           AND notification.school_id = recipient.school_id
           AND notification.status = 'active'
            AND ${communicationNotificationAccessSql}
          WHERE recipient.user_id = ? AND recipient.school_id = ? AND recipient.read_at IS NULL
            AND (
              notification.student_id IS NULL
              OR EXISTS (
                SELECT 1 FROM users target
                JOIN roles target_role ON target_role.id = target.role_id
                WHERE target.id = recipient.user_id AND target_role.key <> 'parent'
              )
              OR EXISTS (
                SELECT 1 FROM parent_student_links current_link
                WHERE current_link.school_id = recipient.school_id
                  AND current_link.parent_user_id = recipient.user_id
                  AND current_link.student_id = notification.student_id
                  AND current_link.status = 'active'
              )
            )
        `).bind(user.id, user.school_id).first<{ count: number }>(),
      ]);
      const data: NotificationFeed = {
        unread_count: Number(unread?.count || 0),
        notifications: (feed.results || []).map((row) => ({
          notification_key: String(row.notification_key),
          notification_type: String(row.notification_type),
          title: String(row.title),
          body: String(row.body),
          student_id: row.student_id == null ? null : Number(row.student_id),
          reference_type: row.reference_type == null ? null : String(row.reference_type),
          reference_key: row.reference_key == null ? null : String(row.reference_key),
          created_at: Number(row.created_at),
          read_at: row.read_at == null ? null : Number(row.read_at),
        })),
      };
      return c.json({ data });
    } catch (error) {
      const safe = gateAttendanceDatabaseError(error);
      return c.json({ error: safe.message || gateAttendanceErrorMessage(safe.code), code: safe.code }, safe.status);
    }
  });

  app.post('/api/notifications/:key/read', async (c) => {
    try {
      const user = c.get('user');
      requireGateAttendance(user, 'gate_forbidden', 403);
      const key = c.req.param('key');
      requireGateAttendance(/^[0-9a-f-]{32,64}$/i.test(key), 'notification_not_found', 404);
      const changed = await c.env.DB.prepare(`
        UPDATE notification_recipients
        SET read_at = coalesce(read_at, unixepoch())
        WHERE notification_key = ? AND user_id = ? AND school_id = ?
          AND EXISTS (
            SELECT 1
            FROM school_notifications notification
            WHERE notification.notification_key = notification_recipients.notification_key
              AND notification.school_id = notification_recipients.school_id
              AND notification.status = 'active'
              AND ${communicationNotificationAccessSql.replace(/recipient\.user_id/g, 'notification_recipients.user_id')}
              AND (
                notification.student_id IS NULL
                OR EXISTS (
                  SELECT 1 FROM users target
                  JOIN roles target_role ON target_role.id = target.role_id
                  WHERE target.id = notification_recipients.user_id AND target_role.key <> 'parent'
                )
                OR EXISTS (
                  SELECT 1 FROM parent_student_links current_link
                  WHERE current_link.school_id = notification_recipients.school_id
                    AND current_link.parent_user_id = notification_recipients.user_id
                    AND current_link.student_id = notification.student_id
                    AND current_link.status = 'active'
                )
              )
          )
        RETURNING notification_key, read_at
      `).bind(key, user.id, user.school_id).first<Row>();
      requireGateAttendance(changed, 'notification_not_found', 404);
      return c.json({ data: { notification_key: String(changed.notification_key), read_at: Number(changed.read_at) } });
    } catch (error) {
      const safe = gateAttendanceDatabaseError(error);
      return c.json({ error: safe.message || gateAttendanceErrorMessage(safe.code), code: safe.code }, safe.status);
    }
  });
}
