import type { Hono } from 'hono';
import type { Bindings, Variables } from '../worker';
import { ACADEMIC_MANAGEMENT_ROLES, SCHOOL_MANAGEMENT_ROLES } from './rbac';
import { validateStudentBirthDate } from './admissionDates';
import { ageExceptionEvidence, defaultStudentStudyStatus, parseStudentAgeExceptionInput, STUDY_STATUS_LABELS,
  type StudentAgeException, type StudentStudyStatus, type StudentStudyRosterRow } from './studentStudyStatus';
import { boundedText, ensure, positiveId, workflowBody, workflowResponse, workflowSchool,
  type WorkflowContext } from './schoolWorkflow';

type Row = Record<string, any>;
function dto(row: Row): StudentStudyStatus {
  return { student_id: row.student_id, academic_year_id: row.academic_year_id,
    study_status: row.study_status, grades_visible: row.grades_visible === 1,
    age_exception: row.age_exception_json ? JSON.parse(row.age_exception_json) : null,
    revision: row.revision, updated_at: row.updated_at };
}
async function yearScope(c: WorkflowContext, school: number, year: number) {
  const result = await c.env.DB.prepare('SELECT id,name,is_active FROM academic_years WHERE id=? AND school_id=?').bind(year, school).first<{id:number;name:string;is_active:number}>();
  ensure(result, 'year_not_found', 'السنة غير موجودة في المدرسة', 404);
  return result;
}
async function studentScope(c: WorkflowContext, school: number, student: number) {
  const result = await c.env.DB.prepare('SELECT id,birth_date,gender FROM students WHERE id=? AND school_id=?').bind(student, school).first<Row>();
  ensure(result, 'student_not_found', 'الطالب غير موجود في المدرسة', 404);
  return result;
}
async function stored(c: WorkflowContext, school: number, student: number, year: number) {
  return c.env.DB.prepare('SELECT * FROM student_study_status WHERE school_id=? AND student_id=? AND academic_year_id=?').bind(school, student, year).first<Row>();
}
export function registerStudentStudyStatusRoutes(app: Hono<{ Bindings: Bindings; Variables: Variables }>) {
  app.get('/api/student-study-status', c => workflowResponse(c, async () => {
    const school = await workflowSchool(c, c.req.query('school_id'), ACADEMIC_MANAGEMENT_ROLES);
    const year = positiveId(c.req.query('academic_year_id')), academicYear = await yearScope(c, school, year);
    const [settings, enrolled, schoolRecord] = await Promise.all([
      c.env.DB.prepare('SELECT * FROM student_study_status WHERE school_id=? AND academic_year_id=? ORDER BY student_id').bind(school, year).all<Row>(),
      c.env.DB.prepare(`SELECT s.id AS student_id,s.student_number,s.full_name,e.class_id,cl.name AS class_name,
        e.section_id,sec.name AS section_name,COALESCE(ss.study_status,'regular') AS study_status,COALESCE(ss.grades_visible,1) AS grades_visible
        FROM student_enrollments e JOIN students s ON s.id=e.student_id AND s.school_id=e.school_id
        JOIN classes cl ON cl.id=e.class_id AND cl.school_id=e.school_id
        LEFT JOIN sections sec ON sec.id=e.section_id AND sec.school_id=e.school_id AND sec.class_id=e.class_id
        LEFT JOIN student_study_status ss ON ss.school_id=e.school_id AND ss.student_id=e.student_id AND ss.academic_year_id=e.academic_year_id
        WHERE e.school_id=? AND e.academic_year_id=? AND e.status='active' AND s.status='active'
        ORDER BY cl.order_index,cl.id,sec.name,s.full_name,s.id`).bind(school, year).all<Row>(),
      c.env.DB.prepare('SELECT id,name FROM schools WHERE id=?').bind(school).first(),
    ]);
    return c.json({ data: { rows: (settings.results || []).map(dto),
      roster: (enrolled.results || []).map(row => ({ ...row, grades_visible: row.grades_visible === 1 } as StudentStudyRosterRow)),
      school: schoolRecord, academic_year: academicYear } });
  }));
  app.get('/api/students/:id/study-status', c => workflowResponse(c, async () => {
    const school = await workflowSchool(c, c.req.query('school_id'), ACADEMIC_MANAGEMENT_ROLES);
    const student = positiveId(c.req.param('id')), year = positiveId(c.req.query('academic_year_id'));
    await Promise.all([yearScope(c, school, year), studentScope(c, school, student)]);
    const row = await stored(c, school, student, year);
    return c.json({ data: row ? dto(row) : defaultStudentStudyStatus(student, year) });
  }));
  app.put('/api/students/:id/study-status', c => workflowResponse(c, async () => {
    const body = await workflowBody(c, ['school_id','academic_year_id','revision','study_status','grades_visible','age_exception','change_reason','confirm_age_exception_verified']);
    const school = await workflowSchool(c, body.school_id ?? c.req.query('school_id'), SCHOOL_MANAGEMENT_ROLES);
    const student = positiveId(c.req.param('id')), year = positiveId(body.academic_year_id ?? c.req.query('academic_year_id'));
    if (c.req.query('academic_year_id')) ensure(positiveId(c.req.query('academic_year_id')) === year, 'year_mismatch', 'السنة في الطلب لا تطابق السنة المختارة');
    if (c.req.query('school_id')) ensure(positiveId(c.req.query('school_id')) === school, 'school_mismatch', 'المدرسة في الطلب لا تطابق المدرسة المختارة');
    const [, identity] = await Promise.all([yearScope(c, school, year), studentScope(c, school, student)]);
    ensure(typeof body.revision === 'number' && Number.isSafeInteger(body.revision) && body.revision >= 0, 'invalid_revision', 'إصدار البيانات غير صالح');
    ensure(typeof body.study_status === 'string' && Object.prototype.hasOwnProperty.call(STUDY_STATUS_LABELS, body.study_status), 'invalid_study_status', 'حالة الدراسة غير صالحة');
    ensure(typeof body.grades_visible === 'boolean', 'invalid_grade_visibility', 'حدد ظهور درجات الطالب');
    const reason = boundedText(body.change_reason, 500), evidence = parseStudentAgeExceptionInput(body.age_exception);
    const previous = await stored(c, school, student, year);
    ensure((previous?.revision ?? 0) === body.revision, 'study_status_stale', 'تغيرت البيانات؛ أعد تحميلها قبل الحفظ', 409);
    const oldException: StudentAgeException | null = previous?.age_exception_json ? JSON.parse(previous.age_exception_json) : null;
    let exception: StudentAgeException | null = null;
    if (evidence) {
      const unchanged = oldException && JSON.stringify(ageExceptionEvidence(oldException)) === JSON.stringify(evidence);
      if (unchanged && body.confirm_age_exception_verified !== true) exception = oldException;
      else {
        ensure(body.confirm_age_exception_verified === true, 'age_exception_evidence_required', 'أكد مراجعة كتاب استثناء العمر ونطاقه للسنة والصف المختارين');
        const birth = validateStudentBirthDate(identity.birth_date);
        ensure(birth.ok && birth.value, 'age_exception_birth_required', 'يلزم تاريخ ميلاد حقيقي ومثبت قبل توثيق استثناء العمر');
        ensure(identity.gender === 'male' || identity.gender === 'female', 'age_exception_gender_required', 'أكمل جنس الطالب قبل توثيق استثناء العمر');
        exception = { ...evidence, birth_date: birth.value, gender: identity.gender,
          verified_by_user_id: c.get('user').id, verified_at: Math.floor(Date.now() / 1000) };
      }
      ensure(await c.env.DB.prepare("SELECT id FROM classes WHERE id=? AND school_id=? AND status='active'").bind(evidence.class_id, school).first(), 'class_not_found', 'صف الاستثناء غير متاح في المدرسة', 404);
    }
    const actor = c.get('user').id, token = crypto.randomUUID(), db = c.env.DB;
    // Recheck identity, row revision and the actor within the write transaction.
    const guard = db.prepare(`INSERT INTO workflow_write_guards(token,valid)
      SELECT ?,CASE WHEN COALESCE((SELECT revision FROM student_study_status WHERE school_id=? AND student_id=? AND academic_year_id=?),0)=?
      AND EXISTS(SELECT 1 FROM students WHERE id=? AND school_id=? AND birth_date IS ? AND gender IS ?)
      AND EXISTS(SELECT 1 FROM academic_years WHERE id=? AND school_id=?)
      AND EXISTS(SELECT 1 FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=? AND u.status='active' AND (r.key='system_admin' OR (u.school_id=? AND r.key IN ('school_owner','principal','vice_principal'))))
      ${evidence ? "AND EXISTS(SELECT 1 FROM classes WHERE id=? AND school_id=? AND status='active')" : ''}
      THEN 1 ELSE 0 END`).bind(token,school,student,year,body.revision,student,school,identity.birth_date,identity.gender,year,school,actor,school,...(evidence ? [evidence.class_id,school] : []));
    const serialized = exception ? JSON.stringify(exception) : null;
    const mutation = previous
      ? db.prepare(`UPDATE student_study_status SET study_status=?,grades_visible=?,age_exception_json=?,revision=revision+1,updated_by_user_id=?,change_reason=?,updated_at=unixepoch() WHERE id=? AND revision=?`)
        .bind(body.study_status, body.grades_visible ? 1 : 0, serialized, actor, reason, previous.id, body.revision)
      : db.prepare(`INSERT INTO student_study_status(school_id,student_id,academic_year_id,study_status,grades_visible,age_exception_json,updated_by_user_id,change_reason) VALUES(?,?,?,?,?,?,?,?)`)
        .bind(school,student,year,body.study_status,body.grades_visible ? 1 : 0,serialized,actor,reason);
    await db.batch([guard, mutation, db.prepare('DELETE FROM workflow_write_guards WHERE token=?').bind(token)]);
    return c.json({ data: dto((await stored(c, school, student, year))!) });
  }));
}
