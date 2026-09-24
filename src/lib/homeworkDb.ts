import type { Context, Hono } from 'hono';
import type { Bindings, Variables } from '../worker';
import {
  HOMEWORK_AUTHOR_ROLES,
  HOMEWORK_STAFF_VIEW_ROLES,
  hasRole,
} from './rbac';
import {
  HOMEWORK_MAX_FILE_BYTES,
  HOMEWORK_STORAGE_MAX_BYTES,
  HomeworkError,
  homeworkDatabaseError,
  homeworkErrorMessage,
  isHomeworkMimeType,
  parseHomeworkDate,
  parseHomeworkAttachmentFormFields,
  parseHomeworkDraftInput,
  parseHomeworkEditInput,
  parseHomeworkReplacementInput,
  parseHomeworkRevisionInput,
  parseHomeworkWithdrawInput,
  requireHomework,
  sanitizeHomeworkFileName,
  sha256Hex,
  validateHomeworkAttachmentBytes,
  type HomeworkAttachment,
  type HomeworkAudienceStudent,
  type HomeworkObjectBody,
  type HomeworkRecord,
  type HomeworkScope,
  type ParentHomeworkAttachment,
  type ParentHomeworkFeed,
  type ParentHomeworkItem,
} from './homework';

type HomeworkEnv = { Bindings: Bindings; Variables: Variables };
type C = Context<HomeworkEnv>;
type Row = Record<string, any>;

const HOMEWORK_SELECT = `
  SELECT homework.id, homework.homework_key, homework.school_id,
         homework.academic_year_id,
         homework.academic_year_name_snapshot AS academic_year_name,
         homework.teaching_load_id, homework.class_id,
         homework.class_name_snapshot AS class_name,
         homework.section_id, homework.section_name_snapshot AS section_name,
         homework.subject_id, homework.subject_name_snapshot AS subject_name,
         homework.teacher_employee_id, homework.teacher_name_snapshot AS teacher_name,
         homework.title, homework.instructions, homework.assigned_date,
         homework.due_at, homework.status, homework.revision,
         replacement_source.homework_key AS replaces_homework_key,
         homework.created_by_user_id, homework.published_at,
         homework.withdrawn_at, homework.withdrawal_reason,
         homework.created_at, homework.updated_at
  FROM homework_assignments homework
  LEFT JOIN homework_assignments replacement_source
    ON replacement_source.id = homework.replaces_homework_id
`;

async function requestBody(c: C): Promise<unknown> {
  const text = await c.req.text();
  requireHomework(text.length <= 64_000, 'invalid_homework_request');
  try {
    return JSON.parse(text);
  } catch {
    throw new HomeworkError('invalid_homework_request');
  }
}

function positiveId(value: unknown, code: string): number {
  const parsed = Number(value);
  requireHomework(Number.isSafeInteger(parsed) && parsed > 0, code);
  return parsed;
}

function routeParam(c: C, name: string): string {
  const value = c.req.param(name);
  requireHomework(typeof value === 'string' && value.length > 0, 'homework_not_found', 404);
  return value;
}

async function resolveStaffSchool(c: C, supplied: unknown): Promise<number> {
  const user = c.get('user');
  requireHomework(user && hasRole(user.role_key, HOMEWORK_STAFF_VIEW_ROLES), 'homework_forbidden', 403);
  const requested = supplied == null || supplied === ''
    ? null
    : positiveId(supplied, 'invalid_homework_school');
  let schoolId: number;
  if (user.role_key === 'system_admin') {
    requireHomework(requested != null, 'homework_target_required');
    schoolId = requested;
  } else {
    requireHomework(user.school_id != null, 'homework_forbidden', 403);
    requireHomework(requested == null || requested === user.school_id, 'homework_forbidden', 403);
    schoolId = user.school_id;
  }
  const school = await c.env.DB.prepare("SELECT id FROM schools WHERE id = ? AND status = 'active'")
    .bind(schoolId).first<Row>();
  requireHomework(school, 'homework_target_required');
  return schoolId;
}

async function linkedTeacherEmployeeId(db: D1Database, schoolId: number, userId: number): Promise<number | null> {
  const row = await db.prepare(`
    SELECT link.employee_id
    FROM teacher_employee_links link
    JOIN employees employee
      ON employee.id = link.employee_id AND employee.school_id = link.school_id
     AND employee.status = 'active' AND employee.role = 'teacher'
    WHERE link.school_id = ? AND link.teacher_user_id = ? AND link.status = 'active'
  `).bind(schoolId, userId).first<{ employee_id: number }>();
  return row ? Number(row.employee_id) : null;
}

async function assertLoadAccess(c: C, load: Row): Promise<void> {
  const user = c.get('user');
  requireHomework(user && hasRole(user.role_key, HOMEWORK_AUTHOR_ROLES), 'homework_forbidden', 403);
  if (user.role_key !== 'teacher') return;
  const employeeId = await linkedTeacherEmployeeId(c.env.DB, Number(load.school_id), user.id);
  requireHomework(employeeId != null && employeeId === Number(load.teacher_employee_id), 'homework_forbidden', 403);
}

async function assertHomeworkReadAccess(c: C, homework: Row): Promise<void> {
  const user = c.get('user');
  requireHomework(user && hasRole(user.role_key, HOMEWORK_STAFF_VIEW_ROLES), 'homework_forbidden', 403);
  requireHomework(user.role_key === 'system_admin' || user.school_id === Number(homework.school_id), 'homework_forbidden', 403);
  if (user.role_key !== 'teacher') return;
  const [employeeId, activeLoad] = await Promise.all([
    linkedTeacherEmployeeId(c.env.DB, Number(homework.school_id), user.id),
    loadTeachingLoad(c.env.DB, Number(homework.school_id), Number(homework.teaching_load_id)),
  ]);
  requireHomework(
    employeeId != null
      && employeeId === Number(homework.teacher_employee_id)
      && activeLoad != null
      && homeworkMatchesActiveLoad(homework, activeLoad)
      && Number(homework.created_by_user_id) === user.id,
    'homework_forbidden',
    403,
  );
}

async function assertHomeworkMutationAccess(c: C, homework: Row): Promise<void> {
  const user = c.get('user');
  requireHomework(user && hasRole(user.role_key, HOMEWORK_AUTHOR_ROLES), 'homework_forbidden', 403);
  await assertHomeworkReadAccess(c, homework);
}

async function loadTeachingLoad(db: D1Database, schoolId: number, loadId: number): Promise<Row | null> {
  return db.prepare(`
    SELECT load.id, load.school_id, load.academic_year_id,
           year.name AS academic_year_name, year.starts_at, year.ends_at,
           load.class_id, class.name AS class_name,
           load.section_id, section.name AS section_name,
           load.subject_id, subject.name AS subject_name,
           load.employee_id AS teacher_employee_id, employee.full_name AS teacher_name
    FROM timetable_teaching_loads load
    JOIN academic_years year
      ON year.id = load.academic_year_id AND year.school_id = load.school_id AND year.is_active = 1
    JOIN classes class
      ON class.id = load.class_id AND class.school_id = load.school_id AND class.status = 'active'
    LEFT JOIN sections section
      ON section.id = load.section_id AND section.school_id = load.school_id
     AND section.class_id = load.class_id AND section.status = 'active'
    JOIN subjects subject
      ON subject.id = load.subject_id AND subject.school_id = load.school_id
     AND subject.class_id = load.class_id
     AND (subject.section_id IS NULL OR subject.section_id = load.section_id)
     AND subject.status = 'active'
    JOIN employees employee
      ON employee.id = load.employee_id AND employee.school_id = load.school_id
     AND employee.status = 'active' AND employee.role = 'teacher'
    WHERE load.id = ? AND load.school_id = ? AND load.status = 'active'
      AND (load.section_id IS NULL OR section.id IS NOT NULL)
      AND (
        load.section_id IS NOT NULL
        OR NOT EXISTS (
          SELECT 1 FROM sections class_section
          WHERE class_section.school_id = load.school_id
            AND class_section.class_id = load.class_id
            AND class_section.status = 'active'
        )
      )
  `).bind(loadId, schoolId).first<Row>();
}

function homeworkMatchesActiveLoad(homework: Row, load: Row): boolean {
  return Number(load.school_id) === Number(homework.school_id)
    && Number(load.academic_year_id) === Number(homework.academic_year_id)
    && Number(load.id) === Number(homework.teaching_load_id)
    && Number(load.class_id) === Number(homework.class_id)
    && (load.section_id == null ? null : Number(load.section_id))
      === (homework.section_id == null ? null : Number(homework.section_id))
    && Number(load.subject_id) === Number(homework.subject_id)
    && Number(load.teacher_employee_id) === Number(homework.teacher_employee_id);
}

async function loadHomeworkRow(db: D1Database, schoolId: number, key: string): Promise<Row | null> {
  return db.prepare(`${HOMEWORK_SELECT} WHERE homework.school_id = ? AND homework.homework_key = ?`)
    .bind(schoolId, key).first<Row>();
}

function publicAttachment(row: Row): HomeworkAttachment {
  return {
    attachment_key: String(row.attachment_key),
    original_name: String(row.original_name),
    mime_type: row.mime_type,
    size_bytes: Number(row.size_bytes),
    sha256: String(row.sha256),
    status: row.status === 'upload_pending'
      ? 'upload_pending'
      : row.status === 'removed'
      ? 'removed'
      : row.status === 'removal_pending'
        ? 'removal_pending'
        : 'active',
    created_at: Number(row.created_at),
  };
}

function publicParentAttachment(row: Row): ParentHomeworkAttachment {
  return {
    attachment_key: String(row.attachment_key),
    original_name: String(row.original_name),
    mime_type: row.mime_type,
    size_bytes: Number(row.size_bytes),
  };
}

function publicParentHomework(
  row: Row,
  attachments: ParentHomeworkAttachment[],
  students: ParentHomeworkItem['students'],
): ParentHomeworkItem {
  return {
    homework_key: String(row.homework_key),
    class_name: String(row.class_name),
    section_name: row.section_name == null ? null : String(row.section_name),
    subject_name: String(row.subject_name),
    teacher_name: String(row.teacher_name),
    title: String(row.title),
    instructions: String(row.instructions),
    assigned_date: String(row.assigned_date),
    due_at: row.due_at == null ? null : Number(row.due_at),
    attachments,
    students,
  };
}

function publicHomework(
  row: Row,
  attachments: HomeworkAttachment[] = [],
  audience: HomeworkAudienceStudent[] = [],
): HomeworkRecord {
  return {
    homework_key: String(row.homework_key),
    school_id: Number(row.school_id),
    academic_year_id: Number(row.academic_year_id),
    academic_year_name: String(row.academic_year_name),
    teaching_load_id: Number(row.teaching_load_id),
    class_id: Number(row.class_id),
    class_name: String(row.class_name),
    section_id: row.section_id == null ? null : Number(row.section_id),
    section_name: row.section_name == null ? null : String(row.section_name),
    subject_id: Number(row.subject_id),
    subject_name: String(row.subject_name),
    teacher_employee_id: Number(row.teacher_employee_id),
    teacher_name: String(row.teacher_name),
    title: String(row.title),
    instructions: String(row.instructions),
    assigned_date: String(row.assigned_date),
    due_at: row.due_at == null ? null : Number(row.due_at),
    status: row.status,
    revision: Number(row.revision),
    replaces_homework_key: row.replaces_homework_key == null ? null : String(row.replaces_homework_key),
    created_by_user_id: Number(row.created_by_user_id),
    published_at: row.published_at == null ? null : Number(row.published_at),
    withdrawn_at: row.withdrawn_at == null ? null : Number(row.withdrawn_at),
    withdrawal_reason: row.withdrawal_reason == null ? null : String(row.withdrawal_reason),
    created_at: Number(row.created_at),
    updated_at: Number(row.updated_at),
    attachments,
    audience,
  };
}

async function hydrateHomeworkRows(db: D1Database, rows: Row[]): Promise<HomeworkRecord[]> {
  if (rows.length === 0) return [];
  const ids = rows.map(row => Number(row.id));
  const placeholders = ids.map(() => '?').join(',');
  const [attachmentResult, audienceResult] = await Promise.all([
    db.prepare(`
      SELECT homework_id, attachment_key, original_name, mime_type,
             size_bytes, sha256, status, created_at
      FROM homework_attachments
      WHERE homework_id IN (${placeholders}) AND status IN ('upload_pending', 'active', 'removal_pending')
      ORDER BY id
    `).bind(...ids).all<Row>(),
    db.prepare(`
      SELECT homework_id, student_id, student_name_snapshot AS student_name,
             student_number_snapshot AS student_number
      FROM homework_audience
      WHERE homework_id IN (${placeholders})
      ORDER BY student_name_snapshot, student_id
    `).bind(...ids).all<Row>(),
  ]);
  const attachments = new Map<number, HomeworkAttachment[]>();
  for (const row of attachmentResult.results || []) {
    const list = attachments.get(Number(row.homework_id)) || [];
    list.push(publicAttachment(row));
    attachments.set(Number(row.homework_id), list);
  }
  const audience = new Map<number, HomeworkAudienceStudent[]>();
  for (const row of audienceResult.results || []) {
    const list = audience.get(Number(row.homework_id)) || [];
    list.push({
      student_id: Number(row.student_id),
      student_name: String(row.student_name),
      student_number: String(row.student_number),
    });
    audience.set(Number(row.homework_id), list);
  }
  return rows.map(row => publicHomework(
    row,
    attachments.get(Number(row.id)) || [],
    audience.get(Number(row.id)) || [],
  ));
}

async function hydrateParentHomeworkRows(
  db: D1Database,
  rows: Row[],
  parentUserId: number,
): Promise<ParentHomeworkItem[]> {
  if (rows.length === 0) return [];
  const ids = rows.map(row => Number(row.id));
  const placeholders = ids.map(() => '?').join(',');
  const [studentResult, attachmentResult] = await Promise.all([
    db.prepare(`
      SELECT audience.homework_id, student.id, student.full_name, student.student_number
      FROM homework_audience audience
      JOIN parent_student_links link
        ON link.school_id = audience.school_id AND link.student_id = audience.student_id
       AND link.parent_user_id = ? AND link.status = 'active'
      JOIN students student
        ON student.id = audience.student_id AND student.school_id = audience.school_id
       AND student.status = 'active'
      WHERE audience.homework_id IN (${placeholders})
      ORDER BY student.full_name, student.id
    `).bind(parentUserId, ...ids).all<Row>(),
    db.prepare(`
      SELECT attachment.homework_id, attachment.attachment_key,
             attachment.original_name, attachment.mime_type, attachment.size_bytes
      FROM homework_attachments attachment
      WHERE attachment.homework_id IN (${placeholders}) AND attachment.status = 'active'
      ORDER BY attachment.id
    `).bind(...ids).all<Row>(),
  ]);
  const students = new Map<number, ParentHomeworkItem['students']>();
  for (const row of studentResult.results || []) {
    const list = students.get(Number(row.homework_id)) || [];
    list.push({ id: Number(row.id), full_name: String(row.full_name), student_number: String(row.student_number) });
    students.set(Number(row.homework_id), list);
  }
  const attachments = new Map<number, ParentHomeworkAttachment[]>();
  for (const row of attachmentResult.results || []) {
    const list = attachments.get(Number(row.homework_id)) || [];
    list.push(publicParentAttachment(row));
    attachments.set(Number(row.homework_id), list);
  }
  return rows.map(row => publicParentHomework(
    row,
    attachments.get(Number(row.id)) || [],
    students.get(Number(row.id)) || [],
  ));
}

async function loadHomeworkDetail(db: D1Database, schoolId: number, key: string): Promise<HomeworkRecord | null> {
  const row = await loadHomeworkRow(db, schoolId, key);
  if (!row) return null;
  return (await hydrateHomeworkRows(db, [row]))[0] || null;
}

async function eligibleAudience(db: D1Database, homework: Row): Promise<Row[]> {
  const result = await db.prepare(`
    SELECT DISTINCT student.id AS student_id, student.full_name AS student_name,
           student.student_number
    FROM student_enrollments enrollment
    JOIN students student
      ON student.id = enrollment.student_id AND student.school_id = enrollment.school_id
     AND student.status = 'active'
    WHERE enrollment.school_id = ?
      AND enrollment.academic_year_id = ?
      AND enrollment.class_id = ?
      AND enrollment.section_id IS ?
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
    homework.school_id,
    homework.academic_year_id,
    homework.class_id,
    homework.section_id,
    homework.subject_id,
  ).all<Row>();
  return result.results || [];
}

function resultChanges(result: { meta?: any } | undefined): number {
  return Number(result?.meta?.changes || 0);
}

function safeContentDisposition(fileName: string): string {
  return `attachment; filename="homework-file"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

function storedBody(object: HomeworkObjectBody): BodyInit | null {
  if (object.body) return object.body as BodyInit;
  return null;
}

async function reconcileHomeworkStorage(db: D1Database, store: NonNullable<Bindings['HOMEWORK_FILES']>): Promise<void> {
  const metadataResult = await db.prepare(`
    SELECT attachment_key, object_key, size_bytes, sha256, status
    FROM homework_attachments
    WHERE status != 'removed'
  `).all<Row>();
  const metadata = new Map<string, Row>();
  let reservedBytes = 0;
  for (const row of metadataResult.results || []) {
    const objectKey = String(row.object_key);
    requireHomework(!metadata.has(objectKey), 'homework_storage_reconciliation_failed', 503);
    metadata.set(objectKey, row);
    reservedBytes += Number(row.size_bytes);
    requireHomework(Number.isSafeInteger(reservedBytes) && reservedBytes <= HOMEWORK_STORAGE_MAX_BYTES, 'homework_storage_quota_exceeded', 507);
  }

  const seen = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  let storedBytes = 0;
  do {
    let page;
    try {
      page = await store.list({ cursor, limit: 1000, include: ['customMetadata'] });
    } catch {
      throw new HomeworkError('homework_storage_reconciliation_failed', 503);
    }
    requireHomework(page && Array.isArray(page.objects), 'homework_storage_reconciliation_failed', 503);
    for (const object of page.objects) {
      const objectKey = String(object.key);
      const row = metadata.get(objectKey);
      requireHomework(row && !seen.has(objectKey), 'homework_storage_reconciliation_failed', 503);
      requireHomework(Number(object.size) === Number(row.size_bytes), 'homework_storage_reconciliation_failed', 503);
      requireHomework(
        object.customMetadata?.attachment_key === String(row.attachment_key)
          && object.customMetadata?.sha256 === String(row.sha256)
          && object.customMetadata?.size_bytes === String(row.size_bytes),
        'homework_storage_reconciliation_failed',
        503,
      );
      seen.add(objectKey);
      storedBytes += Number(object.size);
      requireHomework(Number.isSafeInteger(storedBytes) && storedBytes <= HOMEWORK_STORAGE_MAX_BYTES, 'homework_storage_quota_exceeded', 507);
    }
    if (!page.truncated) {
      cursor = undefined;
      break;
    }
    requireHomework(typeof page.cursor === 'string' && page.cursor.length > 0 && !cursors.has(page.cursor), 'homework_storage_reconciliation_failed', 503);
    cursors.add(page.cursor);
    cursor = page.cursor;
  } while (cursor);

  for (const [objectKey, row] of metadata) {
    requireHomework(row.status !== 'active' || seen.has(objectKey), 'homework_storage_reconciliation_failed', 503);
  }
}

async function compensatePendingUpload(
  db: D1Database,
  store: NonNullable<Bindings['HOMEWORK_FILES']>,
  attachmentKey: string,
  objectKey: string,
  actorId: number,
): Promise<boolean> {
  try {
    await store.delete(objectKey);
    const result = await db.prepare(`
      UPDATE homework_attachments
      SET status = 'removed', removed_by_user_id = ?, removed_at = unixepoch()
      WHERE attachment_key = ? AND object_key = ? AND status = 'upload_pending'
    `).bind(actorId, attachmentKey, objectKey).run();
    return resultChanges(result) === 1;
  } catch {
    console.error('[homework] pending upload compensation failed', { attachmentKey, objectKey });
    return false;
  }
}

export function registerHomeworkRoutes(app: Hono<HomeworkEnv>): void {
  const route = (
    method: string,
    path: string,
    handler: (c: C) => Promise<Response>,
  ) => app.on(method, `/api/homework${path}`, async c => {
    try {
      return await handler(c);
    } catch (error) {
      const safe = homeworkDatabaseError(error);
      if (safe.status === 500) {
        console.error('[homework] operation failed', {
          code: safe.code,
          ...(c.env.APP_ENV === 'test'
            ? { detail: String((error as { message?: unknown })?.message || error) }
            : {}),
        });
      }
      return c.json({ error: safe.message || homeworkErrorMessage(safe.code), code: safe.code }, safe.status);
    }
  });

  route('GET', '/scopes', async c => {
    const schoolId = await resolveStaffSchool(c, c.req.query('school_id'));
    const user = c.get('user');
    const teacherSql = user.role_key === 'teacher'
      ? `AND EXISTS (
          SELECT 1 FROM teacher_employee_links link
          WHERE link.school_id = load.school_id AND link.teacher_user_id = ?
            AND link.employee_id = load.employee_id AND link.status = 'active'
        )`
      : '';
    const binds: unknown[] = [schoolId];
    if (user.role_key === 'teacher') binds.push(user.id);
    const result = await c.env.DB.prepare(`
      SELECT load.id, load.school_id, load.academic_year_id,
             year.name AS academic_year_name,
             load.class_id, class.name AS class_name,
             load.section_id, section.name AS section_name,
             load.subject_id, subject.name AS subject_name,
             load.employee_id AS teacher_employee_id, employee.full_name AS teacher_name
      FROM timetable_teaching_loads load
      JOIN academic_years year
        ON year.id = load.academic_year_id AND year.school_id = load.school_id AND year.is_active = 1
      JOIN classes class
        ON class.id = load.class_id AND class.school_id = load.school_id AND class.status = 'active'
      LEFT JOIN sections section
        ON section.id = load.section_id AND section.school_id = load.school_id
       AND section.class_id = load.class_id AND section.status = 'active'
      JOIN subjects subject
        ON subject.id = load.subject_id AND subject.school_id = load.school_id
       AND subject.class_id = load.class_id
       AND (subject.section_id IS NULL OR subject.section_id = load.section_id)
       AND subject.status = 'active'
      JOIN employees employee
        ON employee.id = load.employee_id AND employee.school_id = load.school_id
       AND employee.status = 'active' AND employee.role = 'teacher'
      WHERE load.school_id = ? AND load.status = 'active'
        AND (load.section_id IS NULL OR section.id IS NOT NULL)
        AND (
          load.section_id IS NOT NULL
          OR NOT EXISTS (
            SELECT 1 FROM sections class_section
            WHERE class_section.school_id = load.school_id
              AND class_section.class_id = load.class_id
              AND class_section.status = 'active'
          )
        )
        ${teacherSql}
      ORDER BY load.id
    `).bind(...binds).all<Row>();
    const loads: HomeworkScope[] = (result.results || []).map(row => ({
      id: Number(row.id),
      school_id: Number(row.school_id),
      academic_year_id: Number(row.academic_year_id),
      academic_year_name: String(row.academic_year_name),
      class_id: Number(row.class_id),
      class_name: String(row.class_name),
      section_id: row.section_id == null ? null : Number(row.section_id),
      section_name: row.section_name == null ? null : String(row.section_name),
      subject_id: Number(row.subject_id),
      subject_name: String(row.subject_name),
      teacher_employee_id: Number(row.teacher_employee_id),
      teacher_name: String(row.teacher_name),
    }));
    return c.json({ data: { loads } });
  });

  route('GET', '/parent', async c => {
    const user = c.get('user');
    requireHomework(user?.role_key === 'parent' && user.school_id != null, 'homework_forbidden', 403);
    const rowsResult = await c.env.DB.prepare(`
      ${HOMEWORK_SELECT}
      WHERE homework.school_id = ? AND homework.status = 'published'
        AND EXISTS (
          SELECT 1
          FROM homework_audience audience
          JOIN parent_student_links link
            ON link.school_id = audience.school_id AND link.student_id = audience.student_id
           AND link.parent_user_id = ? AND link.status = 'active'
          WHERE audience.homework_id = homework.id
        )
      ORDER BY homework.assigned_date DESC, homework.published_at DESC, homework.id DESC
      LIMIT 50
    `).bind(user.school_id, user.id).all<Row>();
    const rows = rowsResult.results || [];
    const homework = await hydrateParentHomeworkRows(c.env.DB, rows, user.id);
    return c.json({ data: { homework } satisfies ParentHomeworkFeed });
  });

  route('GET', '/attachments/:attachmentKey', async c => {
    const key = routeParam(c, 'attachmentKey');
    requireHomework(/^[0-9a-f-]{32,64}$/i.test(key), 'homework_attachment_not_found', 404);
    const row = await c.env.DB.prepare(`
      SELECT attachment.*, homework.homework_key, homework.status AS homework_status,
             homework.academic_year_id, homework.teaching_load_id,
             homework.class_id, homework.section_id, homework.subject_id,
             homework.teacher_employee_id,
             homework.created_by_user_id
      FROM homework_attachments attachment
      JOIN homework_assignments homework
        ON homework.id = attachment.homework_id AND homework.school_id = attachment.school_id
      WHERE attachment.attachment_key = ? AND attachment.status = 'active'
    `).bind(key).first<Row>();
    requireHomework(row, 'homework_attachment_not_found', 404);
    const user = c.get('user');
    if (user?.role_key === 'parent') {
      requireHomework(user.school_id === Number(row.school_id) && row.homework_status === 'published', 'homework_attachment_not_found', 404);
      const visible = await c.env.DB.prepare(`
        SELECT 1 AS allowed
        FROM homework_audience audience
        JOIN parent_student_links link
          ON link.school_id = audience.school_id AND link.student_id = audience.student_id
         AND link.parent_user_id = ? AND link.status = 'active'
        WHERE audience.homework_id = ? AND audience.school_id = ?
        LIMIT 1
      `).bind(user.id, row.homework_id, row.school_id).first<Row>();
      requireHomework(visible, 'homework_attachment_not_found', 404);
    } else {
      const schoolId = await resolveStaffSchool(c, c.req.query('school_id'));
      requireHomework(schoolId === Number(row.school_id), 'homework_attachment_not_found', 404);
      await assertHomeworkReadAccess(c, row);
    }
    requireHomework(c.env.HOMEWORK_FILES, 'homework_files_unavailable', 503);
    const object = await c.env.HOMEWORK_FILES.get(String(row.object_key));
    requireHomework(object, 'homework_attachment_not_found', 404);
    let body = storedBody(object);
    if (!body && object.arrayBuffer) body = await object.arrayBuffer();
    requireHomework(body, 'homework_attachment_not_found', 404);
    return new Response(body, {
      headers: {
        'Content-Type': String(row.mime_type),
        'Content-Length': String(row.size_bytes),
        'Content-Disposition': safeContentDisposition(String(row.original_name)),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  });

  route('GET', '', async c => {
    const schoolId = await resolveStaffSchool(c, c.req.query('school_id'));
    const user = c.get('user');
    const status = c.req.query('status') || 'all';
    requireHomework(['all', 'draft', 'published', 'withdrawn'].includes(status), 'invalid_homework_request');
    const clauses = ['homework.school_id = ?'];
    const binds: unknown[] = [schoolId];
    if (status !== 'all') {
      clauses.push('homework.status = ?');
      binds.push(status);
    }
    const teachingLoadFilter = c.req.query('teaching_load_id');
    if (teachingLoadFilter) {
      clauses.push('homework.teaching_load_id = ?');
      binds.push(positiveId(teachingLoadFilter, 'invalid_homework_load'));
    }
    const assignedDateFilter = c.req.query('assigned_date');
    if (assignedDateFilter) {
      clauses.push('homework.assigned_date = ?');
      binds.push(parseHomeworkDate(assignedDateFilter));
    }
    if (user.role_key === 'teacher') {
      clauses.push(`homework.created_by_user_id = ? AND EXISTS (
        SELECT 1 FROM teacher_employee_links link
        WHERE link.school_id = homework.school_id AND link.teacher_user_id = ?
          AND link.employee_id = homework.teacher_employee_id AND link.status = 'active'
      ) AND EXISTS (
        SELECT 1
        FROM timetable_teaching_loads active_load
        JOIN academic_years active_year
          ON active_year.id = active_load.academic_year_id
         AND active_year.school_id = active_load.school_id AND active_year.is_active = 1
        JOIN classes active_class
          ON active_class.id = active_load.class_id
         AND active_class.school_id = active_load.school_id AND active_class.status = 'active'
        LEFT JOIN sections active_section
          ON active_section.id = active_load.section_id
         AND active_section.school_id = active_load.school_id
         AND active_section.class_id = active_load.class_id AND active_section.status = 'active'
        JOIN subjects active_subject
          ON active_subject.id = active_load.subject_id
         AND active_subject.school_id = active_load.school_id
         AND active_subject.class_id = active_load.class_id
         AND (active_subject.section_id IS NULL OR active_subject.section_id = active_load.section_id)
         AND active_subject.status = 'active'
        JOIN employees active_teacher
          ON active_teacher.id = active_load.employee_id
         AND active_teacher.school_id = active_load.school_id
         AND active_teacher.status = 'active' AND active_teacher.role = 'teacher'
        WHERE active_load.id = homework.teaching_load_id
          AND active_load.school_id = homework.school_id
          AND active_load.academic_year_id = homework.academic_year_id
          AND active_load.class_id = homework.class_id
          AND active_load.section_id IS homework.section_id
          AND active_load.subject_id = homework.subject_id
          AND active_load.employee_id = homework.teacher_employee_id
          AND active_load.status = 'active'
          AND (active_load.section_id IS NULL OR active_section.id IS NOT NULL)
          AND (
            active_load.section_id IS NOT NULL
            OR NOT EXISTS (
              SELECT 1 FROM sections active_class_section
              WHERE active_class_section.school_id = active_load.school_id
                AND active_class_section.class_id = active_load.class_id
                AND active_class_section.status = 'active'
            )
          )
      )`);
      binds.push(user.id, user.id);
    }
    const result = await c.env.DB.prepare(`
      ${HOMEWORK_SELECT}
      WHERE ${clauses.join(' AND ')}
      ORDER BY homework.assigned_date DESC, homework.id DESC
      LIMIT 50
    `).bind(...binds).all<Row>();
    return c.json({ data: await hydrateHomeworkRows(c.env.DB, result.results || []) });
  });

  route('POST', '', async c => {
    const input = parseHomeworkDraftInput(await requestBody(c));
    const schoolId = await resolveStaffSchool(c, input.school_id);
    const user = c.get('user');
    requireHomework(hasRole(user.role_key, HOMEWORK_AUTHOR_ROLES), 'homework_forbidden', 403);
    const load = await loadTeachingLoad(c.env.DB, schoolId, input.teaching_load_id);
    requireHomework(load, 'invalid_homework_load', 409);
    await assertLoadAccess(c, load);
    requireHomework(input.assigned_date >= load.starts_at && input.assigned_date <= load.ends_at, 'invalid_homework_date');
    const homeworkKey = crypto.randomUUID();
    await c.env.DB.prepare(`
      INSERT INTO homework_assignments (
        homework_key, school_id, academic_year_id, teaching_load_id,
        class_id, section_id, subject_id, teacher_employee_id,
        academic_year_name_snapshot, class_name_snapshot, section_name_snapshot,
        subject_name_snapshot, teacher_name_snapshot,
        title, instructions, assigned_date, due_at,
        created_by_user_id, updated_by_user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      homeworkKey, schoolId, load.academic_year_id, load.id,
      load.class_id, load.section_id, load.subject_id, load.teacher_employee_id,
      load.academic_year_name, load.class_name, load.section_name,
      load.subject_name, load.teacher_name,
      input.title, input.instructions, input.assigned_date, input.due_at,
      user.id, user.id,
    ).run();
    const homework = await loadHomeworkDetail(c.env.DB, schoolId, homeworkKey);
    requireHomework(homework, 'homework_failed', 500);
    return c.json({ data: homework }, 201);
  });

  route('POST', '/:key/attachments', async c => {
    const contentLength = Number(c.req.header('content-length') || 0);
    requireHomework(!Number.isFinite(contentLength) || contentLength <= HOMEWORK_MAX_FILE_BYTES + 128_000, 'homework_attachment_too_large', 413);
    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      throw new HomeworkError('invalid_homework_request');
    }
    const input = parseHomeworkAttachmentFormFields(form.get('school_id'), form.get('revision'));
    const schoolId = await resolveStaffSchool(c, input.school_id);
    const row = await loadHomeworkRow(c.env.DB, schoolId, routeParam(c, 'key'));
    requireHomework(row, 'homework_not_found', 404);
    await assertHomeworkMutationAccess(c, row);
    requireHomework(row.status === 'draft', 'homework_draft_required', 409);
    requireHomework(Number(row.revision) === input.revision, 'homework_stale', 409);
    const entry = form.get('file');
    requireHomework(entry != null && typeof entry !== 'string' && typeof entry.arrayBuffer === 'function', 'homework_attachment_required');
    const file = entry as File;
    requireHomework(file.size > 0 && file.size <= HOMEWORK_MAX_FILE_BYTES, 'homework_attachment_too_large', 413);
    requireHomework(isHomeworkMimeType(file.type), 'invalid_homework_attachment_type');
    const name = sanitizeHomeworkFileName(file.name);
    const bytes = new Uint8Array(await file.arrayBuffer());
    requireHomework(bytes.byteLength === file.size, 'invalid_homework_request');
    requireHomework(validateHomeworkAttachmentBytes(file.type, bytes), 'invalid_homework_attachment_signature');
    requireHomework(c.env.HOMEWORK_FILES, 'homework_files_unavailable', 503);
    await reconcileHomeworkStorage(c.env.DB, c.env.HOMEWORK_FILES);
    const attachmentKey = crypto.randomUUID();
    const objectKey = `homework/${schoolId}/${row.homework_key}/${attachmentKey}`;
    const sha256 = await sha256Hex(bytes);
    const user = c.get('user');
    const reserved = await c.env.DB.prepare(`
      INSERT INTO homework_attachments (
        attachment_key, school_id, homework_id, object_key,
        original_name, mime_type, size_bytes, sha256, status, created_by_user_id
      )
      SELECT ?, ?, homework.id, ?, ?, ?, ?, ?, 'upload_pending', ?
      FROM homework_assignments homework
      WHERE homework.id = ? AND homework.school_id = ?
        AND homework.status = 'draft' AND homework.revision = ?
      RETURNING attachment_key
    `).bind(
      attachmentKey, schoolId, objectKey, name, file.type,
      bytes.byteLength, sha256, user.id,
      row.id, schoolId, input.revision,
    ).first<Row>();
    requireHomework(reserved, 'homework_stale', 409);
    try {
      await c.env.HOMEWORK_FILES.put(objectKey, bytes, {
        httpMetadata: {
          contentType: file.type,
          contentDisposition: safeContentDisposition(name),
        },
        customMetadata: {
          attachment_key: attachmentKey,
          sha256,
          size_bytes: String(bytes.byteLength),
        },
      });
      const created = await c.env.DB.prepare(`
        UPDATE homework_attachments
        SET status = 'active'
        WHERE attachment_key = ? AND object_key = ? AND school_id = ?
          AND homework_id = ? AND status = 'upload_pending'
        RETURNING attachment_key, original_name, mime_type, size_bytes, sha256, status, created_at
      `).bind(attachmentKey, objectKey, schoolId, row.id).first<Row>();
      requireHomework(created, 'homework_attachment_cleanup_pending', 503);
      return c.json({ data: publicAttachment(created) }, 201);
    } catch (error) {
      const compensated = await compensatePendingUpload(c.env.DB, c.env.HOMEWORK_FILES, attachmentKey, objectKey, user.id);
      requireHomework(compensated, 'homework_attachment_cleanup_pending', 503);
      throw error;
    }
  });

  route('POST', '/:key/attachments/:attachmentKey/remove', async c => {
    const input = parseHomeworkRevisionInput(await requestBody(c));
    const schoolId = await resolveStaffSchool(c, input.school_id);
    const homework = await loadHomeworkRow(c.env.DB, schoolId, routeParam(c, 'key'));
    requireHomework(homework, 'homework_not_found', 404);
    await assertHomeworkMutationAccess(c, homework);
    requireHomework(homework.status === 'draft', 'homework_draft_required', 409);
    requireHomework(Number(homework.revision) === input.revision, 'homework_stale', 409);
    requireHomework(c.env.HOMEWORK_FILES, 'homework_files_unavailable', 503);
    const user = c.get('user');
    const attachmentKey = routeParam(c, 'attachmentKey');
    let pending = await c.env.DB.prepare(`
      UPDATE homework_attachments
      SET status = 'removal_pending', removed_by_user_id = ?, removed_at = unixepoch()
      WHERE homework_id = ? AND school_id = ? AND attachment_key = ? AND status = 'active'
      RETURNING object_key, attachment_key, original_name, mime_type, size_bytes, sha256, status, created_at
    `).bind(user.id, homework.id, schoolId, attachmentKey).first<Row>();
    if (!pending) {
      pending = await c.env.DB.prepare(`
        SELECT object_key, attachment_key, original_name, mime_type,
               size_bytes, sha256, status, created_at
        FROM homework_attachments
        WHERE homework_id = ? AND school_id = ? AND attachment_key = ?
          AND status IN ('upload_pending', 'removal_pending')
      `).bind(homework.id, schoolId, attachmentKey).first<Row>();
    }
    requireHomework(pending, 'homework_attachment_not_found', 404);
    try {
      await c.env.HOMEWORK_FILES.delete(String(pending.object_key));
    } catch {
      console.error('[homework] attachment object cleanup pending', { attachmentKey });
      throw new HomeworkError('homework_attachment_cleanup_pending', 503);
    }
    const removed = await c.env.DB.prepare(`
      UPDATE homework_attachments
      SET status = 'removed',
          removed_by_user_id = coalesce(removed_by_user_id, ?),
          removed_at = coalesce(removed_at, unixepoch())
      WHERE homework_id = ? AND school_id = ? AND attachment_key = ?
        AND status IN ('upload_pending', 'removal_pending')
      RETURNING attachment_key, original_name, mime_type, size_bytes, sha256, status, created_at
    `).bind(user.id, homework.id, schoolId, attachmentKey).first<Row>();
    requireHomework(removed, 'homework_attachment_cleanup_pending', 503);
    return c.json({ data: publicAttachment(removed) });
  });

  route('POST', '/:key/publish', async c => {
    const input = parseHomeworkRevisionInput(await requestBody(c));
    const schoolId = await resolveStaffSchool(c, input.school_id);
    const row = await loadHomeworkRow(c.env.DB, schoolId, routeParam(c, 'key'));
    requireHomework(row, 'homework_not_found', 404);
    await assertHomeworkMutationAccess(c, row);
    requireHomework(row.status === 'draft' && Number(row.revision) === input.revision, 'homework_stale', 409);
    const activeLoad = await loadTeachingLoad(c.env.DB, schoolId, Number(row.teaching_load_id));
    requireHomework(activeLoad && homeworkMatchesActiveLoad(row, activeLoad), 'invalid_homework_load', 409);
    requireHomework(
      row.assigned_date >= activeLoad.starts_at && row.assigned_date <= activeLoad.ends_at,
      'invalid_homework_date',
    );
    const pendingAttachment = await c.env.DB.prepare(`
      SELECT 1 AS pending
      FROM homework_attachments
      WHERE homework_id = ? AND school_id = ? AND status IN ('upload_pending', 'removal_pending')
      LIMIT 1
    `).bind(row.id, schoolId).first<Row>();
    requireHomework(!pendingAttachment, 'homework_attachment_cleanup_pending', 409);
    const roster = await eligibleAudience(c.env.DB, row);
    requireHomework(roster.length > 0, 'homework_audience_empty', 409);
    const audience = roster.map(student => ({
      student_id: Number(student.student_id),
      student_name: String(student.student_name),
      student_number: String(student.student_number),
      notification_key: crypto.randomUUID(),
    }));
    const token = crypto.randomUUID();
    const audienceValidationToken = `${token}:audience`;
    const user = c.get('user');
    const results = await c.env.DB.batch([
      c.env.DB.prepare(`
        INSERT INTO homework_write_guards(token, valid)
        SELECT ?, 1
        WHERE EXISTS (
          SELECT 1
          FROM homework_assignments guarded_homework
          JOIN timetable_teaching_loads guarded_load
            ON guarded_load.id = guarded_homework.teaching_load_id
           AND guarded_load.school_id = guarded_homework.school_id
           AND guarded_load.academic_year_id = guarded_homework.academic_year_id
           AND guarded_load.class_id = guarded_homework.class_id
           AND guarded_load.section_id IS guarded_homework.section_id
           AND guarded_load.subject_id = guarded_homework.subject_id
           AND guarded_load.employee_id = guarded_homework.teacher_employee_id
           AND guarded_load.status = 'active'
          JOIN schools guarded_school
            ON guarded_school.id = guarded_load.school_id AND guarded_school.status = 'active'
          JOIN academic_years guarded_year
            ON guarded_year.id = guarded_load.academic_year_id
           AND guarded_year.school_id = guarded_load.school_id AND guarded_year.is_active = 1
          JOIN classes guarded_class
            ON guarded_class.id = guarded_load.class_id
           AND guarded_class.school_id = guarded_load.school_id AND guarded_class.status = 'active'
          LEFT JOIN sections guarded_section
            ON guarded_section.id = guarded_load.section_id
           AND guarded_section.school_id = guarded_load.school_id
           AND guarded_section.class_id = guarded_load.class_id AND guarded_section.status = 'active'
          JOIN subjects guarded_subject
            ON guarded_subject.id = guarded_load.subject_id
           AND guarded_subject.school_id = guarded_load.school_id
           AND guarded_subject.class_id = guarded_load.class_id
           AND (guarded_subject.section_id IS NULL OR guarded_subject.section_id = guarded_load.section_id)
           AND guarded_subject.status = 'active'
          JOIN employees guarded_teacher
            ON guarded_teacher.id = guarded_load.employee_id
           AND guarded_teacher.school_id = guarded_load.school_id
           AND guarded_teacher.status = 'active' AND guarded_teacher.role = 'teacher'
          WHERE guarded_homework.id = ? AND guarded_homework.school_id = ?
            AND guarded_homework.status = 'draft' AND guarded_homework.revision = ?
            AND (guarded_load.section_id IS NULL OR guarded_section.id IS NOT NULL)
            AND (
              guarded_load.section_id IS NOT NULL
              OR NOT EXISTS (
                SELECT 1 FROM sections guarded_class_section
                WHERE guarded_class_section.school_id = guarded_load.school_id
                  AND guarded_class_section.class_id = guarded_load.class_id
                  AND guarded_class_section.status = 'active'
              )
            )
            AND guarded_homework.assigned_date BETWEEN guarded_year.starts_at AND guarded_year.ends_at
            AND NOT EXISTS (
              SELECT 1 FROM homework_attachments pending_attachment
              WHERE pending_attachment.homework_id = guarded_homework.id
                AND pending_attachment.status IN ('upload_pending', 'removal_pending')
            )
        )
      `).bind(token, row.id, schoolId, input.revision),
      c.env.DB.prepare(`
        UPDATE homework_assignments
        SET status = 'published', revision = revision + 1,
            published_by_user_id = ?, published_at = unixepoch(),
            updated_by_user_id = ?, updated_at = unixepoch()
        WHERE id = ? AND school_id = ? AND status = 'draft' AND revision = ?
          AND EXISTS (SELECT 1 FROM homework_write_guards WHERE token = ? AND valid = 1)
      `).bind(user.id, user.id, row.id, schoolId, input.revision, token),
      c.env.DB.prepare(`
        INSERT INTO homework_audience (
          school_id, homework_id, student_id,
          student_name_snapshot, student_number_snapshot, notification_key
        )
        SELECT ?, ?,
               CAST(json_extract(item.value, '$.student_id') AS INTEGER),
               json_extract(item.value, '$.student_name'),
               json_extract(item.value, '$.student_number'),
               json_extract(item.value, '$.notification_key')
        FROM json_each(?) item
        WHERE EXISTS (SELECT 1 FROM homework_write_guards WHERE token = ? AND valid = 1)
      `).bind(schoolId, row.id, JSON.stringify(audience), token),
      c.env.DB.prepare(`
        INSERT INTO homework_write_guards(token, valid)
        SELECT ?, CASE WHEN
          (
            SELECT COUNT(*)
            FROM student_enrollments enrollment
            JOIN students student
              ON student.id = enrollment.student_id AND student.school_id = enrollment.school_id
             AND student.status = 'active'
            WHERE enrollment.school_id = ?
              AND enrollment.academic_year_id = ?
              AND enrollment.class_id = ?
              AND enrollment.section_id IS ?
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
          ) = ?
          AND (SELECT COUNT(*) FROM homework_audience WHERE homework_id = ?) = ?
          THEN 1 ELSE 0 END
        WHERE EXISTS (SELECT 1 FROM homework_write_guards WHERE token = ? AND valid = 1)
      `).bind(
        audienceValidationToken,
        row.school_id, row.academic_year_id, row.class_id, row.section_id, row.subject_id,
        audience.length, row.id, audience.length, token,
      ),
      c.env.DB.prepare(`
        INSERT INTO school_notifications (
          notification_key, school_id, notification_type, title, body,
          student_id, reference_type, reference_key, status, created_by_user_id
        )
        SELECT audience.notification_key, homework.school_id, 'homework_published',
               substr('واجب منزلي جديد: ' || homework.subject_name_snapshot, 1, 200),
               substr(audience.student_name_snapshot || ': ' || homework.title, 1, 1000),
               audience.student_id, 'homework', homework.homework_key, 'active', ?
        FROM homework_audience audience
        JOIN homework_assignments homework ON homework.id = audience.homework_id
        WHERE audience.homework_id = ?
          AND EXISTS (SELECT 1 FROM homework_write_guards WHERE token = ? AND valid = 1)
      `).bind(user.id, row.id, audienceValidationToken),
      c.env.DB.prepare(`
        INSERT INTO notification_recipients (school_id, notification_key, user_id)
        SELECT audience.school_id, audience.notification_key, link.parent_user_id
        FROM homework_audience audience
        JOIN parent_student_links link
          ON link.school_id = audience.school_id AND link.student_id = audience.student_id
         AND link.status = 'active'
        JOIN users parent
          ON parent.id = link.parent_user_id AND parent.school_id = link.school_id
         AND parent.status = 'active'
        JOIN roles role ON role.id = parent.role_id AND role.key = 'parent'
        WHERE audience.homework_id = ?
          AND EXISTS (SELECT 1 FROM homework_write_guards WHERE token = ? AND valid = 1)
      `).bind(row.id, audienceValidationToken),
      c.env.DB.prepare('DELETE FROM homework_write_guards WHERE token IN (?, ?)').bind(token, audienceValidationToken),
    ]);
    requireHomework(resultChanges(results[0]) === 1 && resultChanges(results[1]) === 1, 'homework_stale', 409);
    const homework = await loadHomeworkDetail(c.env.DB, schoolId, String(row.homework_key));
    requireHomework(homework, 'homework_failed', 500);
    return c.json({ data: homework });
  });

  route('POST', '/:key/withdraw', async c => {
    const input = parseHomeworkWithdrawInput(await requestBody(c));
    const schoolId = await resolveStaffSchool(c, input.school_id);
    const row = await loadHomeworkRow(c.env.DB, schoolId, routeParam(c, 'key'));
    requireHomework(row, 'homework_not_found', 404);
    await assertHomeworkMutationAccess(c, row);
    requireHomework(row.status === 'published' && Number(row.revision) === input.revision, 'homework_stale', 409);
    const token = crypto.randomUUID();
    const user = c.get('user');
    const results = await c.env.DB.batch([
      c.env.DB.prepare(`
        INSERT INTO homework_write_guards(token, valid)
        SELECT ?, 1 WHERE EXISTS (
          SELECT 1 FROM homework_assignments
          WHERE id = ? AND school_id = ? AND status = 'published' AND revision = ?
        )
      `).bind(token, row.id, schoolId, input.revision),
      c.env.DB.prepare(`
        UPDATE homework_assignments
        SET status = 'withdrawn', revision = revision + 1,
            withdrawn_by_user_id = ?, withdrawn_at = unixepoch(),
            withdrawal_reason = ?, updated_by_user_id = ?, updated_at = unixepoch()
        WHERE id = ? AND school_id = ? AND status = 'published' AND revision = ?
          AND EXISTS (SELECT 1 FROM homework_write_guards WHERE token = ? AND valid = 1)
      `).bind(user.id, input.reason, user.id, row.id, schoolId, input.revision, token),
      c.env.DB.prepare(`
        UPDATE school_notifications
        SET status = 'withdrawn', withdrawn_at = unixepoch()
        WHERE school_id = ? AND reference_type = 'homework' AND reference_key = ?
          AND status = 'active'
          AND EXISTS (SELECT 1 FROM homework_write_guards WHERE token = ? AND valid = 1)
      `).bind(schoolId, row.homework_key, token),
      c.env.DB.prepare('DELETE FROM homework_write_guards WHERE token = ?').bind(token),
    ]);
    requireHomework(resultChanges(results[0]) === 1 && resultChanges(results[1]) === 1, 'homework_stale', 409);
    const homework = await loadHomeworkDetail(c.env.DB, schoolId, String(row.homework_key));
    requireHomework(homework, 'homework_failed', 500);
    return c.json({ data: homework });
  });

  route('POST', '/:key/replacement', async c => {
    const input = parseHomeworkReplacementInput(await requestBody(c));
    const schoolId = await resolveStaffSchool(c, input.school_id);
    const original = await loadHomeworkRow(c.env.DB, schoolId, routeParam(c, 'key'));
    requireHomework(original, 'homework_not_found', 404);
    await assertHomeworkMutationAccess(c, original);
    requireHomework(original.status === 'withdrawn', 'homework_withdrawn_required', 409);
    const load = await loadTeachingLoad(c.env.DB, schoolId, Number(original.teaching_load_id));
    requireHomework(load, 'invalid_homework_load', 409);
    requireHomework(homeworkMatchesActiveLoad(original, load), 'invalid_homework_load', 409);
    requireHomework(input.assigned_date >= load.starts_at && input.assigned_date <= load.ends_at, 'invalid_homework_date');
    const user = c.get('user');
    const homeworkKey = crypto.randomUUID();
    await c.env.DB.prepare(`
      INSERT INTO homework_assignments (
        homework_key, school_id, academic_year_id, teaching_load_id,
        class_id, section_id, subject_id, teacher_employee_id,
        academic_year_name_snapshot, class_name_snapshot, section_name_snapshot,
        subject_name_snapshot, teacher_name_snapshot,
        title, instructions, assigned_date, due_at, replaces_homework_id,
        created_by_user_id, updated_by_user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      homeworkKey, schoolId, load.academic_year_id, load.id,
      load.class_id, load.section_id, load.subject_id, load.teacher_employee_id,
      load.academic_year_name, load.class_name, load.section_name,
      load.subject_name, load.teacher_name,
      input.title, input.instructions, input.assigned_date, input.due_at, original.id,
      user.id, user.id,
    ).run();
    const homework = await loadHomeworkDetail(c.env.DB, schoolId, homeworkKey);
    requireHomework(homework, 'homework_failed', 500);
    return c.json({ data: homework }, 201);
  });

  route('PATCH', '/:key', async c => {
    const input = parseHomeworkEditInput(await requestBody(c));
    const schoolId = await resolveStaffSchool(c, input.school_id);
    const row = await loadHomeworkRow(c.env.DB, schoolId, routeParam(c, 'key'));
    requireHomework(row, 'homework_not_found', 404);
    await assertHomeworkMutationAccess(c, row);
    const user = c.get('user');
    const changed = await c.env.DB.prepare(`
      UPDATE homework_assignments
      SET title = ?, instructions = ?, assigned_date = ?, due_at = ?,
          revision = revision + 1, updated_by_user_id = ?, updated_at = unixepoch()
      WHERE id = ? AND school_id = ? AND status = 'draft' AND revision = ?
      RETURNING id
    `).bind(
      input.title, input.instructions, input.assigned_date, input.due_at,
      user.id, row.id, schoolId, input.revision,
    ).first<Row>();
    requireHomework(changed, 'homework_stale', 409);
    const homework = await loadHomeworkDetail(c.env.DB, schoolId, String(row.homework_key));
    requireHomework(homework, 'homework_failed', 500);
    return c.json({ data: homework });
  });

  route('GET', '/:key', async c => {
    const user = c.get('user');
    if (user?.role_key === 'parent') {
      requireHomework(user.school_id != null, 'homework_forbidden', 403);
      const row = await c.env.DB.prepare(`
        ${HOMEWORK_SELECT}
        WHERE homework.school_id = ? AND homework.homework_key = ? AND homework.status = 'published'
          AND EXISTS (
            SELECT 1 FROM homework_audience audience
            JOIN parent_student_links link
              ON link.school_id = audience.school_id AND link.student_id = audience.student_id
             AND link.parent_user_id = ? AND link.status = 'active'
            WHERE audience.homework_id = homework.id
          )
      `).bind(user.school_id, routeParam(c, 'key'), user.id).first<Row>();
      requireHomework(row, 'homework_not_found', 404);
      const homework = (await hydrateParentHomeworkRows(c.env.DB, [row], user.id))[0];
      requireHomework(homework, 'homework_not_found', 404);
      return c.json({ data: homework });
    }
    const schoolId = await resolveStaffSchool(c, c.req.query('school_id'));
    const key = routeParam(c, 'key');
    const row = await loadHomeworkRow(c.env.DB, schoolId, key);
    requireHomework(row, 'homework_not_found', 404);
    await assertHomeworkReadAccess(c, row);
    const homework = await loadHomeworkDetail(c.env.DB, schoolId, key);
    requireHomework(homework, 'homework_not_found', 404);
    return c.json({ data: homework });
  });
}
