import type { Hono } from 'hono';
import type { Bindings, Variables } from '../worker';
import { ACADEMIC_MANAGEMENT_ROLES } from './rbac';
import { baghdadDate, parseAdmissionRules, validDate, type AdmissionRules } from './admissionRegulations';
import { checkStudentAge, type AgeCheck } from './studentAge';
import { ensure, positiveId, workflowResponse, workflowSchool } from './schoolWorkflow';
import type { StudentAgeException } from './studentStudyStatus';
import { isAgeExceptionApplicable } from './studentStudyStatus';

interface AgeRow {
  enrollment_id: number; student_id: number; student_number: string; full_name: string;
  birth_date: string | null; gender: string; class_id: number; class_name: string;
  section_id: number | null; section_name: string | null; promotion_status: string;
  regulation_key: string | null; regulation_version: number | null; regulation_title: string | null;
  source_reference: string | null; source_url: string | null; rules_json: string | null;
  age_exception_json: string | null;
}
export interface StudentAgeReviewRow extends Omit<AgeRow, 'rules_json' | 'age_exception_json'> {
  age_check: AgeCheck; context_notes: string[]; age_rules: AdmissionRules | null; age_exception: StudentAgeException | null;
}
export interface StudentAgeReviewPage {
  rows: StudentAgeReviewRow[]; next_cursor: number | null; review_date: string;
  academic_year_id: number; page_size: number;
}

export function registerStudentAgeRoutes(app: Hono<{ Bindings: Bindings; Variables: Variables }>) {
  app.get('/api/student-age-review', c => workflowResponse(c, async () => {
    const school = await workflowSchool(c, c.req.query('school_id'), ACADEMIC_MANAGEMENT_ROLES);
    const year = positiveId(c.req.query('academic_year_id'));
    ensure(await c.env.DB.prepare('SELECT id FROM academic_years WHERE id=? AND school_id=?').bind(year, school).first(), 'year_not_found', 'السنة غير موجودة في المدرسة', 404);
    const classId = c.req.query('class_id') ? positiveId(c.req.query('class_id')) : null;
    const sectionId = c.req.query('section_id') ? positiveId(c.req.query('section_id')) : null;
    if (classId) ensure(await c.env.DB.prepare('SELECT id FROM classes WHERE id=? AND school_id=?').bind(classId, school).first(), 'class_not_found', 'الصف غير موجود في المدرسة', 404);
    if (sectionId) ensure(await c.env.DB.prepare('SELECT id FROM sections WHERE id=? AND school_id=? AND (? IS NULL OR class_id=?)').bind(sectionId, school, classId, classId).first(), 'section_not_found', 'الشعبة لا تتبع النطاق المختار', 404);
    const cursor = c.req.query('after') ? positiveId(c.req.query('after')) : 0;
    const today = baghdadDate();
    const reviewDate = c.req.query('review_date') ? validDate(c.req.query('review_date')) : today;
    ensure(reviewDate <= today, 'future_review', 'تاريخ المراجعة لا يتجاوز اليوم');
    const limit = 100;
    const result = await c.env.DB.prepare(`
      SELECT e.id AS enrollment_id,s.id AS student_id,s.student_number,s.full_name,s.birth_date,s.gender,
        e.class_id,cl.name AS class_name,e.section_id,sec.name AS section_name,e.promotion_status,
        r.regulation_key,r.version AS regulation_version,r.title AS regulation_title,r.source_reference,r.source_url,r.rules_json,ss.age_exception_json
      FROM student_enrollments e
      JOIN students s ON s.id=e.student_id AND s.school_id=e.school_id
      JOIN classes cl ON cl.id=e.class_id AND cl.school_id=e.school_id
      LEFT JOIN sections sec ON sec.id=e.section_id AND sec.school_id=e.school_id AND sec.class_id=e.class_id
      LEFT JOIN student_study_status ss ON ss.school_id=e.school_id AND ss.student_id=e.student_id AND ss.academic_year_id=e.academic_year_id
      LEFT JOIN admission_regulations r ON r.school_id=e.school_id AND r.academic_year_id=e.academic_year_id
        AND r.class_id=e.class_id AND r.process='admission' AND r.status='approved'
        AND r.effective_from<=? AND r.effective_to>=?
      WHERE e.school_id=? AND e.academic_year_id=? AND e.status='active' AND s.status='active'
        AND e.id>? AND (? IS NULL OR e.class_id=?) AND (? IS NULL OR e.section_id=?)
      ORDER BY e.id LIMIT ?
    `).bind(reviewDate, reviewDate, school, year, cursor, classId, classId, sectionId, sectionId, limit + 1).all<AgeRow>();
    const rows = (result.results ?? []).slice(0, limit).map((row): StudentAgeReviewRow => {
      const { rules_json, age_exception_json, ...record } = row;
      const exception: StudentAgeException | null = age_exception_json ? JSON.parse(age_exception_json) : null;
      let rules: AdmissionRules | null = null;
      const notes: string[] = [];
      if (rules_json) {
        try { rules = parseAdmissionRules(JSON.parse(rules_json)); }
        catch { notes.push('اللائحة المحفوظة غير قابلة للتقييم؛ راجع إصدارها'); }
      }
      const age = checkStudentAge(rules, { birth_date: row.birth_date, gender: row.gender, today: reviewDate, class_id: row.class_id, age_exception: exception });
      if (exception && !isAgeExceptionApplicable(exception, { ...row, today: reviewDate })) notes.push(exception.document_date > reviewDate
        ? 'كتاب استثناء العمر مؤرخ بعد تاريخ المراجعة المختار؛ لا يطبق على هذه المقارنة'
        : 'استثناء العمر المحفوظ لا يطابق الصف أو بيانات الميلاد الحالية؛ راجع الكتاب وأعد توثيقه');
      if (rules && rules.age_scope !== 'continuing') {
        notes.push('اللائحة خاصة بالقبول أو لم يحدد نطاقها؛ المقارنة إرشادية ولا تثبت مخالفة طالب مستمر');
        if (age.status === 'within_limits' || age.status === 'outside_limits' || age.status === 'documented_exception') {
          age.issues.push(...notes); age.status = 'review';
        }
      }
      if (rules?.age_notes) notes.push(rules.age_notes);
      if (row.promotion_status === 'repeated') notes.push('القيد السنوي معلّم بالإعادة؛ تحقق من تسلسل الرسوب/الترك والكتب الاستثنائية قبل اتخاذ قرار');
      if (rules?.repeat_rule === 'review') notes.push('حالة الرسوب/الترك واستثناءاتها تحتاج مراجعة مستقلة');
      if (rules?.acceleration === 'review') notes.push('لا يستنتج التقرير وجود تسريع معتمد من صغر العمر');
      return { ...record, age_check: age, context_notes: notes, age_rules: rules, age_exception: exception };
    });
    return c.json({ data: { rows, next_cursor: (result.results ?? []).length > limit ? rows[rows.length - 1].enrollment_id : null, review_date: reviewDate, academic_year_id: year, page_size: limit } satisfies StudentAgeReviewPage });
  }));
}
