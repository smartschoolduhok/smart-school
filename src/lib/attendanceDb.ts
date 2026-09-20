import type { Context, Hono } from 'hono';
import type { Bindings, Variables } from '../worker';
import {
  ATTENDANCE_MANAGEMENT_ROLES,
  ATTENDANCE_STAFF_ROLES,
  hasRole,
} from './rbac';
import {
  ATTENDANCE_STATUS_LABELS,
  AttendanceError,
  attendanceDatabaseError,
  attendanceDayOfWeek,
  attendanceErrorMessage,
  parseAttendanceDate,
  parseAttendanceSaveRequest,
  requireAttendance,
  validateAttendanceRange,
  type AttendanceLessonDetail,
  type AttendanceLessonSummary,
  type AttendanceRecordInput,
  type AttendanceStudentRecord,
  type ParentAttendanceFeed,
  type ParentAttendanceRecord,
} from './attendance';
import { businessDate } from './businessTime';

type AttendanceEnv = { Bindings: Bindings; Variables: Variables };
type C = Context<AttendanceEnv>;
type Row = Record<string, any>;

interface LessonContext extends Row {
  timetable_entry_id: number;
  school_id: number;
  academic_year_id: number;
  academic_year_name: string;
  starts_at: string;
  ends_at: string;
  academic_year_active: number;
  slot_id: number;
  day_of_week: number;
  lesson_number: number | null;
  start_time: string;
  end_time: string;
  teaching_load_id: number;
  class_id: number;
  class_name: string;
  section_id: number | null;
  section_name: string | null;
  subject_id: number;
  subject_name: string;
  teacher_employee_id: number | null;
  teacher_name: string | null;
}

function positiveId(value: unknown, code: string): number {
  const parsed = Number(value);
  requireAttendance(Number.isInteger(parsed) && parsed > 0, code);
  return parsed;
}

async function requestBody(c: C): Promise<unknown> {
  const text = await c.req.text();
  requireAttendance(text.length <= 512_000, 'invalid_attendance_request');
  try {
    return JSON.parse(text);
  } catch {
    throw new AttendanceError('invalid_attendance_request');
  }
}

async function resolveSchool(c: C, supplied: unknown): Promise<number> {
  const user = c.get('user');
  requireAttendance(user && hasRole(user.role_key, ATTENDANCE_STAFF_ROLES), 'attendance_forbidden', 403);
  const requested = supplied == null || supplied === '' ? null : positiveId(supplied, 'invalid_attendance_school');
  let schoolId: number;
  if (user.role_key === 'system_admin') {
    requireAttendance(requested != null, 'attendance_target_required');
    schoolId = requested;
  } else {
    requireAttendance(user.school_id != null, 'attendance_forbidden', 403);
    requireAttendance(requested == null || requested === user.school_id, 'attendance_forbidden', 403);
    schoolId = user.school_id;
  }
  const school = await c.env.DB.prepare("SELECT id FROM schools WHERE id = ? AND status = 'active'")
    .bind(schoolId).first<Row>();
  requireAttendance(school, 'attendance_target_required');
  return schoolId;
}

async function loadLessonContext(db: D1Database, entryId: number): Promise<LessonContext | null> {
  return db.prepare(`
    SELECT entry.id AS timetable_entry_id, entry.school_id, entry.academic_year_id,
           year.name AS academic_year_name, year.starts_at, year.ends_at,
           year.is_active AS academic_year_active,
           slot.id AS slot_id, slot.day_of_week, slot.lesson_number,
           slot.start_time, slot.end_time,
           load.id AS teaching_load_id, load.class_id, class.name AS class_name,
           load.section_id, section.name AS section_name,
           load.subject_id, subject.name AS subject_name,
           load.employee_id AS teacher_employee_id, employee.full_name AS teacher_name
    FROM timetable_entries entry
    JOIN academic_years year
      ON year.id = entry.academic_year_id AND year.school_id = entry.school_id
    JOIN timetable_slots slot
      ON slot.id = entry.slot_id
     AND slot.school_id = entry.school_id
     AND slot.academic_year_id = entry.academic_year_id
    JOIN timetable_days day
      ON day.school_id = slot.school_id
     AND day.academic_year_id = slot.academic_year_id
     AND day.day_of_week = slot.day_of_week
    JOIN timetable_teaching_loads load
      ON load.id = entry.teaching_load_id
     AND load.school_id = entry.school_id
     AND load.academic_year_id = entry.academic_year_id
    JOIN classes class ON class.id = load.class_id AND class.school_id = load.school_id
    LEFT JOIN sections section ON section.id = load.section_id AND section.school_id = load.school_id
    JOIN subjects subject ON subject.id = load.subject_id AND subject.school_id = load.school_id
    LEFT JOIN employees employee ON employee.id = load.employee_id AND employee.school_id = load.school_id
    WHERE entry.id = ?
      AND slot.slot_type = 'lesson' AND slot.is_active = 1 AND day.is_active = 1
      AND load.status = 'active'
  `).bind(entryId).first<LessonContext>();
}

function validateLessonDate(context: LessonContext, sessionDate: string, rejectFuture = false): void {
  requireAttendance(Number(context.academic_year_active) === 1, 'attendance_lesson_outside_year', 409);
  requireAttendance(sessionDate >= context.starts_at && sessionDate <= context.ends_at, 'attendance_lesson_outside_year', 400);
  requireAttendance(attendanceDayOfWeek(sessionDate) === Number(context.day_of_week), 'attendance_lesson_wrong_day', 400);
  if (rejectFuture) requireAttendance(sessionDate <= businessDate(), 'future_attendance_date', 400);
}

async function linkedTeacherEmployeeId(db: D1Database, schoolId: number, userId: number): Promise<number | null> {
  const row = await db.prepare(`
    SELECT link.employee_id
    FROM teacher_employee_links link
    JOIN employees employee
      ON employee.id = link.employee_id
     AND employee.school_id = link.school_id
     AND employee.status = 'active'
     AND employee.role = 'teacher'
    WHERE link.school_id = ? AND link.teacher_user_id = ? AND link.status = 'active'
  `).bind(schoolId, userId).first<{ employee_id: number }>();
  return row ? Number(row.employee_id) : null;
}

async function assertLessonAccess(c: C, context: LessonContext): Promise<void> {
  const user = c.get('user');
  requireAttendance(user && (user.role_key === 'system_admin' || user.school_id === context.school_id), 'attendance_lesson_forbidden', 403);
  if (user.role_key !== 'teacher') return;
  const employeeId = await linkedTeacherEmployeeId(c.env.DB, context.school_id, user.id);
  requireAttendance(employeeId != null, 'attendance_teacher_unlinked', 403);
  requireAttendance(context.teacher_employee_id != null && Number(context.teacher_employee_id) === employeeId, 'attendance_lesson_forbidden', 403);
}

async function loadSession(
  db: D1Database,
  schoolId: number,
  entryId: number,
  sessionDate: string,
): Promise<Row | null> {
  return db.prepare(`
    SELECT * FROM lesson_attendance_sessions
    WHERE school_id = ? AND timetable_entry_id = ? AND session_date = ?
  `).bind(schoolId, entryId, sessionDate).first<Row>();
}

async function loadCurrentRoster(db: D1Database, context: LessonContext): Promise<Row[]> {
  const result = await db.prepare(`
    SELECT DISTINCT student.id AS student_id, student.full_name AS student_name,
           student.student_number
    FROM student_enrollments enrollment
    JOIN students student
      ON student.id = enrollment.student_id
     AND student.school_id = enrollment.school_id
     AND student.status = 'active'
    WHERE enrollment.school_id = ?
      AND enrollment.academic_year_id = ?
      AND enrollment.class_id = ?
      AND (? IS NULL OR enrollment.section_id = ?)
      AND enrollment.status = 'active'
      AND (
        NOT EXISTS (
          SELECT 1 FROM student_subjects any_assignment
          WHERE any_assignment.school_id = enrollment.school_id
            AND any_assignment.student_id = enrollment.student_id
            AND any_assignment.is_active = 1
        )
        OR EXISTS (
          SELECT 1 FROM student_subjects subject_assignment
          WHERE subject_assignment.school_id = enrollment.school_id
            AND subject_assignment.student_id = enrollment.student_id
            AND subject_assignment.subject_id = ?
            AND subject_assignment.is_active = 1
        )
      )
    ORDER BY student.full_name, student.id
  `).bind(
    context.school_id,
    context.academic_year_id,
    context.class_id,
    context.section_id,
    context.section_id,
    context.subject_id,
  ).all<Row>();
  return result.results || [];
}

async function loadPersistedRecords(db: D1Database, sessionId: number): Promise<Row[]> {
  const result = await db.prepare(`
    SELECT id, student_id, student_name_snapshot AS student_name,
           student_number_snapshot AS student_number, status, late_minutes,
           note, note_visibility, revision
    FROM lesson_attendance_records
    WHERE session_id = ?
    ORDER BY student_name_snapshot, student_id
  `).bind(sessionId).all<Row>();
  return result.results || [];
}

function publicRecord(row: Row | undefined, student: Row): AttendanceStudentRecord {
  return {
    id: row ? Number(row.id) : null,
    student_id: Number(student.student_id),
    student_name: String(student.student_name),
    student_number: String(student.student_number),
    status: row?.status || 'present',
    late_minutes: Number(row?.late_minutes || 0),
    note: row?.note == null ? null : String(row.note),
    note_visibility: row?.note_visibility === 'parent' ? 'parent' : 'staff',
    revision: Number(row?.revision || 0),
  };
}

function countStatuses(records: Array<Pick<AttendanceRecordInput, 'status'>>): Pick<
  AttendanceLessonSummary,
  'present_count' | 'absent_count' | 'late_count' | 'excused_count' | 'left_early_count' | 'activity_count'
> {
  return {
    present_count: records.filter((record) => record.status === 'present').length,
    absent_count: records.filter((record) => record.status === 'absent').length,
    late_count: records.filter((record) => record.status === 'late').length,
    excused_count: records.filter((record) => record.status === 'excused').length,
    left_early_count: records.filter((record) => record.status === 'left_early').length,
    activity_count: records.filter((record) => record.status === 'school_activity').length,
  };
}

async function buildLessonDetail(c: C, context: LessonContext, sessionDate: string): Promise<AttendanceLessonDetail> {
  const session = await loadSession(c.env.DB, context.school_id, context.timetable_entry_id, sessionDate);
  const persisted = session ? await loadPersistedRecords(c.env.DB, Number(session.id)) : [];
  const currentRoster = !session || session.status === 'draft' ? await loadCurrentRoster(c.env.DB, context) : [];
  const byStudent = new Map(persisted.map((record) => [Number(record.student_id), record]));
  const records = session?.status === 'confirmed'
    ? persisted.map((record) => publicRecord(record, record))
    : currentRoster.map((student) => publicRecord(byStudent.get(Number(student.student_id)), student));
  const user = c.get('user');
  const management = hasRole(user.role_key, ATTENDANCE_MANAGEMENT_ROLES);
  const counts = countStatuses(persisted.map((record) => ({ status: record.status })));
  return {
    lesson: {
      timetable_entry_id: context.timetable_entry_id,
      academic_year_id: context.academic_year_id,
      academic_year_name: context.academic_year_name,
      session_date: sessionDate,
      day_of_week: context.day_of_week,
      lesson_number: context.lesson_number,
      start_time: context.start_time,
      end_time: context.end_time,
      class_id: context.class_id,
      class_name: context.class_name,
      section_id: context.section_id,
      section_name: context.section_name,
      subject_id: context.subject_id,
      subject_name: context.subject_name,
      teacher_employee_id: context.teacher_employee_id,
      teacher_name: context.teacher_name,
      session_id: session ? Number(session.id) : null,
      session_status: session?.status || null,
      revision: Number(session?.revision || 0),
      roster_count: records.length,
      recorded_count: persisted.length,
      ...counts,
    },
    records,
    permissions: {
      can_edit_draft: !session || session.status === 'draft',
      can_correct_confirmed: session?.status === 'confirmed' && management,
    },
  };
}

function sameStudentSet(records: AttendanceRecordInput[], roster: Row[]): boolean {
  if (records.length !== roster.length) return false;
  const ids = new Set(roster.map((student) => Number(student.student_id)));
  return records.every((record) => ids.has(record.student_id));
}

export function registerAttendanceRoutes(app: Hono<AttendanceEnv>): void {
  const staffRoute = (method: string, path: string, handler: (c: C) => Promise<Response>) => app.on(
    method,
    `/api/attendance/${path}`,
    async (c) => {
      try {
        const user = c.get('user');
        requireAttendance(user && hasRole(user.role_key, ATTENDANCE_STAFF_ROLES), 'attendance_forbidden', 403);
        return await handler(c);
      } catch (error) {
        const safe = attendanceDatabaseError(error);
        if (safe.status === 500) console.error('[attendance] operation failed', { code: safe.code });
        return c.json({ error: safe.message || attendanceErrorMessage(safe.code), code: safe.code }, safe.status);
      }
    },
  );

  staffRoute('GET', 'lessons', async (c) => {
    const sessionDate = parseAttendanceDate(c.req.query('date'));
    const schoolId = await resolveSchool(c, c.req.query('school_id'));
    const user = c.get('user');
    const teacherFilter = user.role_key === 'teacher'
      ? `AND EXISTS (
          SELECT 1
          FROM teacher_employee_links teacher_link
          JOIN employees linked_employee
            ON linked_employee.id = teacher_link.employee_id
           AND linked_employee.school_id = teacher_link.school_id
           AND linked_employee.status = 'active'
           AND linked_employee.role = 'teacher'
          WHERE teacher_link.school_id = entry.school_id
            AND teacher_link.teacher_user_id = ?
            AND teacher_link.status = 'active'
            AND teacher_link.employee_id = load.employee_id
        )`
      : '';
    const binds: unknown[] = [
      sessionDate,
      sessionDate,
      schoolId,
      sessionDate,
      attendanceDayOfWeek(sessionDate),
    ];
    if (user.role_key === 'teacher') binds.push(user.id);
    const result = await c.env.DB.prepare(`
      SELECT entry.id AS timetable_entry_id, entry.academic_year_id,
             year.name AS academic_year_name, ? AS session_date,
             slot.day_of_week, slot.lesson_number, slot.start_time, slot.end_time,
             load.class_id, class.name AS class_name,
             load.section_id, section.name AS section_name,
             load.subject_id, subject.name AS subject_name,
             load.employee_id AS teacher_employee_id, employee.full_name AS teacher_name,
             session.id AS session_id, session.status AS session_status,
             COALESCE(session.revision, 0) AS revision,
             (
               SELECT COUNT(DISTINCT enrollment.student_id)
               FROM student_enrollments enrollment
               JOIN students roster_student
                 ON roster_student.id = enrollment.student_id
                AND roster_student.school_id = enrollment.school_id
                AND roster_student.status = 'active'
               WHERE enrollment.school_id = entry.school_id
                 AND enrollment.academic_year_id = entry.academic_year_id
                 AND enrollment.class_id = load.class_id
                 AND (load.section_id IS NULL OR enrollment.section_id = load.section_id)
                 AND enrollment.status = 'active'
                 AND (
                   NOT EXISTS (
                     SELECT 1 FROM student_subjects any_assignment
                     WHERE any_assignment.school_id = enrollment.school_id
                       AND any_assignment.student_id = enrollment.student_id
                       AND any_assignment.is_active = 1
                   )
                   OR EXISTS (
                     SELECT 1 FROM student_subjects subject_assignment
                     WHERE subject_assignment.school_id = enrollment.school_id
                       AND subject_assignment.student_id = enrollment.student_id
                       AND subject_assignment.subject_id = load.subject_id
                       AND subject_assignment.is_active = 1
                   )
                 )
             ) AS roster_count,
             COUNT(record.id) AS recorded_count,
             SUM(CASE WHEN record.status = 'present' THEN 1 ELSE 0 END) AS present_count,
             SUM(CASE WHEN record.status = 'absent' THEN 1 ELSE 0 END) AS absent_count,
             SUM(CASE WHEN record.status = 'late' THEN 1 ELSE 0 END) AS late_count,
             SUM(CASE WHEN record.status = 'excused' THEN 1 ELSE 0 END) AS excused_count,
             SUM(CASE WHEN record.status = 'left_early' THEN 1 ELSE 0 END) AS left_early_count,
             SUM(CASE WHEN record.status = 'school_activity' THEN 1 ELSE 0 END) AS activity_count
      FROM timetable_entries entry
      JOIN academic_years year
        ON year.id = entry.academic_year_id
       AND year.school_id = entry.school_id
       AND year.is_active = 1
      JOIN timetable_slots slot
        ON slot.id = entry.slot_id
       AND slot.school_id = entry.school_id
       AND slot.academic_year_id = entry.academic_year_id
       AND slot.slot_type = 'lesson'
       AND slot.is_active = 1
      JOIN timetable_days day
        ON day.school_id = slot.school_id
       AND day.academic_year_id = slot.academic_year_id
       AND day.day_of_week = slot.day_of_week
       AND day.is_active = 1
      JOIN timetable_teaching_loads load
        ON load.id = entry.teaching_load_id
       AND load.school_id = entry.school_id
       AND load.academic_year_id = entry.academic_year_id
       AND load.status = 'active'
      JOIN classes class ON class.id = load.class_id AND class.school_id = load.school_id
      LEFT JOIN sections section ON section.id = load.section_id AND section.school_id = load.school_id
      JOIN subjects subject ON subject.id = load.subject_id AND subject.school_id = load.school_id
      LEFT JOIN employees employee ON employee.id = load.employee_id AND employee.school_id = load.school_id
      LEFT JOIN lesson_attendance_sessions session
        ON session.school_id = entry.school_id
       AND session.timetable_entry_id = entry.id
       AND session.session_date = ?
      LEFT JOIN lesson_attendance_records record ON record.session_id = session.id
      WHERE entry.school_id = ?
        AND ? BETWEEN year.starts_at AND year.ends_at
        AND slot.day_of_week = ?
        ${teacherFilter}
      GROUP BY entry.id, session.id
      ORDER BY slot.start_time, slot.slot_index, class.order_index, class.id, section.id, subject.order_index, subject.id
    `).bind(...binds).all<Row>();
    const data = (result.results || []).map((row): AttendanceLessonSummary => ({
      timetable_entry_id: Number(row.timetable_entry_id),
      academic_year_id: Number(row.academic_year_id),
      academic_year_name: String(row.academic_year_name),
      session_date: String(row.session_date),
      day_of_week: Number(row.day_of_week),
      lesson_number: row.lesson_number == null ? null : Number(row.lesson_number),
      start_time: String(row.start_time),
      end_time: String(row.end_time),
      class_id: Number(row.class_id),
      class_name: String(row.class_name),
      section_id: row.section_id == null ? null : Number(row.section_id),
      section_name: row.section_name == null ? null : String(row.section_name),
      subject_id: Number(row.subject_id),
      subject_name: String(row.subject_name),
      teacher_employee_id: row.teacher_employee_id == null ? null : Number(row.teacher_employee_id),
      teacher_name: row.teacher_name == null ? null : String(row.teacher_name),
      session_id: row.session_id == null ? null : Number(row.session_id),
      session_status: row.session_status === 'draft' || row.session_status === 'confirmed' ? row.session_status : null,
      revision: Number(row.revision || 0),
      roster_count: Number(row.roster_count || 0),
      recorded_count: Number(row.recorded_count || 0),
      present_count: Number(row.present_count || 0),
      absent_count: Number(row.absent_count || 0),
      late_count: Number(row.late_count || 0),
      excused_count: Number(row.excused_count || 0),
      left_early_count: Number(row.left_early_count || 0),
      activity_count: Number(row.activity_count || 0),
    }));
    return c.json({ data });
  });

  staffRoute('GET', 'lessons/:entryId', async (c) => {
    const schoolId = await resolveSchool(c, c.req.query('school_id'));
    const entryId = positiveId(c.req.param('entryId'), 'attendance_lesson_not_found');
    const sessionDate = parseAttendanceDate(c.req.query('date'));
    const context = await loadLessonContext(c.env.DB, entryId);
    requireAttendance(context, 'attendance_lesson_not_found', 404);
    requireAttendance(context.school_id === schoolId, 'attendance_lesson_forbidden', 403);
    validateLessonDate(context, sessionDate);
    await assertLessonAccess(c, context);
    return c.json({ data: await buildLessonDetail(c, context, sessionDate) });
  });

  staffRoute('PUT', 'lessons/:entryId', async (c) => {
    const input = parseAttendanceSaveRequest(await requestBody(c));
    const schoolId = await resolveSchool(c, input.school_id);
    const entryId = positiveId(c.req.param('entryId'), 'attendance_lesson_not_found');
    const context = await loadLessonContext(c.env.DB, entryId);
    requireAttendance(context, 'attendance_lesson_not_found', 404);
    requireAttendance(context.school_id === schoolId, 'attendance_lesson_forbidden', 403);
    validateLessonDate(context, input.session_date, true);
    await assertLessonAccess(c, context);

    const user = c.get('user');
    const management = hasRole(user.role_key, ATTENDANCE_MANAGEMENT_ROLES);
    const existingSession = await loadSession(c.env.DB, schoolId, entryId, input.session_date);
    if (existingSession?.status === 'confirmed') {
      requireAttendance(management, 'attendance_already_confirmed', 409);
      requireAttendance(input.action === 'confirm', 'attendance_already_confirmed', 409);
      requireAttendance(input.change_reason, 'attendance_correction_reason_required', 400);
    }

    const roster = existingSession?.status === 'confirmed'
      ? await loadPersistedRecords(c.env.DB, Number(existingSession.id))
      : await loadCurrentRoster(c.env.DB, context);
    requireAttendance(roster.length > 0, 'attendance_empty_roster', 409);
    requireAttendance(sameStudentSet(input.records, roster), 'attendance_roster_changed', 409);

    const token = crypto.randomUUID();
    const recordsJson = JSON.stringify(input.records);
    const desiredStatus = input.action === 'confirm' ? 'confirmed' : 'draft';
    const statements: D1PreparedStatement[] = [
      c.env.DB.prepare(`
        INSERT INTO lesson_attendance_sessions (
          school_id, academic_year_id, timetable_entry_id, session_date, day_of_week,
          slot_id, teaching_load_id, teacher_employee_id, class_id, section_id,
          subject_id, lesson_number, start_time_snapshot, end_time_snapshot,
          teacher_name_snapshot, class_name_snapshot, section_name_snapshot,
          subject_name_snapshot, status, created_by_user_id, updated_by_user_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)
        ON CONFLICT(school_id, timetable_entry_id, session_date) DO NOTHING
      `).bind(
        schoolId,
        context.academic_year_id,
        entryId,
        input.session_date,
        context.day_of_week,
        context.slot_id,
        context.teaching_load_id,
        context.teacher_employee_id,
        context.class_id,
        context.section_id,
        context.subject_id,
        context.lesson_number,
        context.start_time,
        context.end_time,
        context.teacher_name,
        context.class_name,
        context.section_name,
        context.subject_name,
        user.id,
        user.id,
      ),
      c.env.DB.prepare(`
        INSERT INTO lesson_attendance_write_guards(token, valid)
        VALUES (?, CASE WHEN EXISTS (
          WITH session_scope AS (
            SELECT * FROM lesson_attendance_sessions
            WHERE school_id = ? AND timetable_entry_id = ? AND session_date = ?
          ),
          current_roster AS (
            SELECT DISTINCT enrollment.student_id
            FROM session_scope session
            JOIN student_enrollments enrollment
              ON enrollment.school_id = session.school_id
             AND enrollment.academic_year_id = session.academic_year_id
             AND enrollment.class_id = session.class_id
             AND (session.section_id IS NULL OR enrollment.section_id = session.section_id)
             AND enrollment.status = 'active'
            JOIN students roster_student
              ON roster_student.id = enrollment.student_id
             AND roster_student.school_id = enrollment.school_id
             AND roster_student.status = 'active'
            WHERE NOT EXISTS (
              SELECT 1 FROM student_subjects any_assignment
              WHERE any_assignment.school_id = enrollment.school_id
                AND any_assignment.student_id = enrollment.student_id
                AND any_assignment.is_active = 1
            ) OR EXISTS (
              SELECT 1 FROM student_subjects subject_assignment
              WHERE subject_assignment.school_id = enrollment.school_id
                AND subject_assignment.student_id = enrollment.student_id
                AND subject_assignment.subject_id = session.subject_id
                AND subject_assignment.is_active = 1
            )
          ),
          frozen_roster AS (
            SELECT record.student_id
            FROM session_scope session
            JOIN lesson_attendance_records record ON record.session_id = session.id
          )
          SELECT 1 FROM session_scope session
          WHERE session.revision = ?
            AND (
              (
                session.status = 'confirmed'
                AND ? = 1
                AND (SELECT COUNT(*) FROM frozen_roster) = json_array_length(?)
                AND NOT EXISTS (
                  SELECT 1 FROM frozen_roster frozen
                  WHERE frozen.student_id NOT IN (
                    SELECT CAST(json_extract(value, '$.student_id') AS INTEGER) FROM json_each(?)
                  )
                )
              )
              OR (
                session.status = 'draft'
                AND EXISTS (
                  SELECT 1
                  FROM timetable_entries entry
                  JOIN timetable_slots slot
                    ON slot.id = entry.slot_id
                   AND slot.school_id = entry.school_id
                   AND slot.academic_year_id = entry.academic_year_id
                  JOIN timetable_days day
                    ON day.school_id = slot.school_id
                   AND day.academic_year_id = slot.academic_year_id
                   AND day.day_of_week = slot.day_of_week
                  JOIN timetable_teaching_loads load
                    ON load.id = entry.teaching_load_id
                   AND load.school_id = entry.school_id
                   AND load.academic_year_id = entry.academic_year_id
                  JOIN academic_years year
                    ON year.id = entry.academic_year_id
                   AND year.school_id = entry.school_id
                  WHERE entry.id = session.timetable_entry_id
                    AND entry.school_id = session.school_id
                    AND entry.academic_year_id = session.academic_year_id
                    AND slot.id = session.slot_id
                    AND load.id = session.teaching_load_id
                    AND load.class_id = session.class_id
                    AND load.section_id IS session.section_id
                    AND load.subject_id = session.subject_id
                    AND load.employee_id IS session.teacher_employee_id
                    AND slot.slot_type = 'lesson'
                    AND slot.is_active = 1
                    AND day.is_active = 1
                    AND year.is_active = 1
                    AND CAST(strftime('%w', session.session_date) AS INTEGER) = slot.day_of_week
                    AND session.session_date BETWEEN year.starts_at AND year.ends_at
                )
                AND (
                  ? = 0
                  OR EXISTS (
                    SELECT 1
                    FROM teacher_employee_links teacher_link
                    JOIN employees linked_employee
                      ON linked_employee.id = teacher_link.employee_id
                     AND linked_employee.school_id = teacher_link.school_id
                     AND linked_employee.status = 'active'
                     AND linked_employee.role = 'teacher'
                    WHERE teacher_link.school_id = session.school_id
                      AND teacher_link.teacher_user_id = ?
                      AND teacher_link.employee_id = session.teacher_employee_id
                      AND teacher_link.status = 'active'
                  )
                )
                AND (SELECT COUNT(*) FROM current_roster) = json_array_length(?)
                AND NOT EXISTS (
                  SELECT 1 FROM current_roster roster
                  WHERE roster.student_id NOT IN (
                    SELECT CAST(json_extract(value, '$.student_id') AS INTEGER) FROM json_each(?)
                  )
                )
              )
            )
        ) THEN 1 ELSE 0 END)
      `).bind(
        token,
        schoolId,
        entryId,
        input.session_date,
        input.expected_revision,
        management ? 1 : 0,
        recordsJson,
        recordsJson,
        user.role_key === 'teacher' ? 1 : 0,
        user.id,
        recordsJson,
        recordsJson,
      ),
    ];
    if (existingSession?.status !== 'confirmed') {
      statements.push(c.env.DB.prepare(`
        DELETE FROM lesson_attendance_records
        WHERE session_id = (
          SELECT id FROM lesson_attendance_sessions
          WHERE school_id = ? AND timetable_entry_id = ? AND session_date = ?
        )
          AND student_id NOT IN (
            SELECT CAST(json_extract(value, '$.student_id') AS INTEGER) FROM json_each(?)
          )
      `).bind(schoolId, entryId, input.session_date, recordsJson));
    }
    statements.push(
      c.env.DB.prepare(`
        INSERT INTO lesson_attendance_records (
          school_id, session_id, student_id, student_name_snapshot,
          student_number_snapshot, status, late_minutes, note, note_visibility,
          last_change_reason, created_by_user_id, updated_by_user_id
        )
        SELECT session.school_id, session.id, student.id, student.full_name,
               student.student_number,
               json_extract(payload.value, '$.status'),
               CAST(json_extract(payload.value, '$.late_minutes') AS INTEGER),
               json_extract(payload.value, '$.note'),
               json_extract(payload.value, '$.note_visibility'),
               ?, ?, ?
        FROM json_each(?) payload
        JOIN students student
          ON student.id = CAST(json_extract(payload.value, '$.student_id') AS INTEGER)
         AND student.school_id = ?
         AND student.status = 'active'
        JOIN lesson_attendance_sessions session
          ON session.school_id = student.school_id
         AND session.timetable_entry_id = ?
         AND session.session_date = ?
        WHERE 1 = 1
        ON CONFLICT(session_id, student_id) DO UPDATE SET
          status = excluded.status,
          late_minutes = excluded.late_minutes,
          note = excluded.note,
          note_visibility = excluded.note_visibility,
          revision = lesson_attendance_records.revision + 1,
          last_change_reason = excluded.last_change_reason,
          updated_by_user_id = excluded.updated_by_user_id,
          updated_at = unixepoch()
      `).bind(
        input.change_reason,
        user.id,
        user.id,
        recordsJson,
        schoolId,
        entryId,
        input.session_date,
      ),
      c.env.DB.prepare(`
        UPDATE lesson_attendance_sessions SET
          status = ?,
          confirmed_at = CASE WHEN ? = 'confirmed' THEN COALESCE(confirmed_at, unixepoch()) ELSE NULL END,
          confirmed_by_user_id = CASE WHEN ? = 'confirmed' THEN COALESCE(confirmed_by_user_id, ?) ELSE NULL END,
          revision = revision + 1,
          updated_by_user_id = ?,
          updated_at = unixepoch()
        WHERE school_id = ? AND timetable_entry_id = ? AND session_date = ?
          AND EXISTS (SELECT 1 FROM lesson_attendance_write_guards WHERE token = ?)
      `).bind(
        desiredStatus,
        desiredStatus,
        desiredStatus,
        user.id,
        user.id,
        schoolId,
        entryId,
        input.session_date,
        token,
      ),
      c.env.DB.prepare('DELETE FROM lesson_attendance_write_guards WHERE token = ?').bind(token),
    );
    await c.env.DB.batch(statements);
    return c.json({
      data: await buildLessonDetail(c, context, input.session_date),
      message: input.action === 'confirm' ? 'تم اعتماد حضور الحصة' : 'تم حفظ مسودة الحضور',
    });
  });

  app.get('/api/attendance/parent', async (c) => {
    try {
      const user = c.get('user');
      requireAttendance(user?.role_key === 'parent' && user.school_id != null, 'attendance_parent_only', 403);
      const range = validateAttendanceRange(c.req.query('from'), c.req.query('to'));
      const [studentsResult, recordsResult] = await Promise.all([
        c.env.DB.prepare(`
          SELECT student.id, student.full_name, student.student_number
          FROM parent_student_links link
          JOIN students student
            ON student.id = link.student_id
           AND student.school_id = link.school_id
           AND student.status = 'active'
          WHERE link.school_id = ? AND link.parent_user_id = ? AND link.status = 'active'
          ORDER BY student.full_name, student.id
        `).bind(user.school_id, user.id).all<Row>(),
        c.env.DB.prepare(`
          SELECT record.id, record.student_id,
                 record.student_name_snapshot AS student_name,
                 record.student_number_snapshot AS student_number,
                 session.session_date, record.status, record.late_minutes,
                 CASE WHEN record.note_visibility = 'parent' THEN record.note ELSE NULL END AS note,
                 session.subject_name_snapshot AS subject_name,
                 session.class_name_snapshot AS class_name,
                 session.section_name_snapshot AS section_name,
                 session.teacher_name_snapshot AS teacher_name,
                 session.lesson_number, session.start_time_snapshot AS start_time,
                 session.end_time_snapshot AS end_time, session.confirmed_at
          FROM parent_student_links link
          JOIN lesson_attendance_records record
            ON record.school_id = link.school_id AND record.student_id = link.student_id
          JOIN lesson_attendance_sessions session
            ON session.id = record.session_id
           AND session.school_id = record.school_id
           AND session.status = 'confirmed'
          WHERE link.school_id = ?
            AND link.parent_user_id = ?
            AND link.status = 'active'
            AND session.session_date BETWEEN ? AND ?
          ORDER BY session.session_date DESC, session.start_time_snapshot DESC,
                   record.student_name_snapshot, record.id DESC
        `).bind(user.school_id, user.id, range.from, range.to).all<Row>(),
      ]);
      const records = (recordsResult.results || []).map((row): ParentAttendanceRecord => ({
        id: Number(row.id),
        student_id: Number(row.student_id),
        student_name: String(row.student_name),
        student_number: String(row.student_number),
        session_date: String(row.session_date),
        status: row.status,
        status_label: ATTENDANCE_STATUS_LABELS[row.status as keyof typeof ATTENDANCE_STATUS_LABELS],
        late_minutes: Number(row.late_minutes || 0),
        note: row.note == null ? null : String(row.note),
        subject_name: String(row.subject_name),
        class_name: String(row.class_name),
        section_name: row.section_name == null ? null : String(row.section_name),
        teacher_name: row.teacher_name == null ? null : String(row.teacher_name),
        lesson_number: row.lesson_number == null ? null : Number(row.lesson_number),
        start_time: String(row.start_time),
        end_time: String(row.end_time),
        confirmed_at: Number(row.confirmed_at),
      }));
      const data: ParentAttendanceFeed = {
        range,
        students: (studentsResult.results || []).map((row) => ({
          id: Number(row.id),
          full_name: String(row.full_name),
          student_number: String(row.student_number),
        })),
        records,
      };
      return c.json({ data });
    } catch (error) {
      const safe = attendanceDatabaseError(error);
      if (safe.status === 500) console.error('[parent-attendance] operation failed', { code: safe.code });
      return c.json({ error: safe.message || attendanceErrorMessage(safe.code), code: safe.code }, safe.status);
    }
  });
}
