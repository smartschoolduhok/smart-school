import type {Hono} from 'hono';
import type {Bindings,Variables} from '../worker';
import {GRADE_MANAGEMENT_ROLES,GRADE_VIEW_ROLES,SCHOOL_MANAGEMENT_ROLES,hasRole} from './rbac';
import {teacherAssignmentAccessSql} from './resourceAccess';
import {RAW_GRADE_FIELDS} from './gradeScheme';
import {PROGRESS_PERIODS,progressSnapshot,progressPeriodEnabled,type ProgressPeriod} from './gradeProgress';
import {sha256Hex} from './homework';
import {boundedText,ensure,positiveId,uuid,workflowBody,workflowSchool,workflowResponse,type WorkflowContext as C} from './schoolWorkflow';
type Row=Record<string,any>;
function sourceQuery(c:C,school:number,student:number) {
 const u=c.get('user');
 const teacher=u.role_key==='teacher'?teacherAssignmentAccessSql('ss').replace('?', '(SELECT actor FROM request)'):'1=1';
 const fields=RAW_GRADE_FIELDS.map(f=>`'${f}',g.${f}`).join(',');
 const sql=`WITH request AS (SELECT ? AS school,? AS student,? AS actor)
 SELECT json_object('student_id',s.id,'student_name',s.full_name,'student_number',s.student_number,'year_id',y.id,'year_name',y.name,'enrollment_id',e.id,'class_id',e.class_id,'section_id',e.section_id,'class_name',cl.name,'section_name',sec.name,
 'settings',json(coalesce((SELECT json_object('max_grade',max_grade,'first_term_input_mode',first_term_input_mode,'second_term_input_mode',second_term_input_mode,'mid_year_exam_enabled',mid_year_exam_enabled) FROM grade_settings WHERE school_id=s.school_id),'{}')),
 'minimum_monthly',coalesce((SELECT minimum_monthly_exams_per_term FROM academic_grade_policies WHERE school_id=s.school_id AND academic_year_id=y.id AND class_id=e.class_id AND status IN ('approved','locked') ORDER BY version DESC LIMIT 1),2),
 'grades',json((SELECT json_group_array(json(value)) FROM (SELECT json_object('id',g.id,'revision',g.revision,'assignment_id',ss.id,'subject_id',subject.id,'subject_name',subject.name,${fields}) value
 FROM student_subjects ss JOIN subjects subject ON subject.id=ss.subject_id AND subject.school_id=ss.school_id AND subject.status='active'
 LEFT JOIN grades g ON g.student_subject_id=ss.id AND g.school_id=ss.school_id AND g.is_active=1
 WHERE ss.school_id=s.school_id AND ss.student_id=s.id AND ss.class_id=e.class_id AND ss.section_id IS e.section_id AND ss.is_active=1
 AND subject.appears_in_report_card=1 AND ${teacher} ORDER BY subject.order_index,subject.id)))
 ) AS source
 FROM students s JOIN student_enrollments e ON e.school_id=s.school_id AND e.student_id=s.id AND e.status='active'
 JOIN academic_years y ON y.id=e.academic_year_id AND y.school_id=s.school_id AND y.is_active=1
 JOIN classes cl ON cl.id=e.class_id AND cl.school_id=s.school_id AND cl.status='active'
 LEFT JOIN sections sec ON sec.id=e.section_id AND sec.school_id=s.school_id AND sec.status='active'
 WHERE s.id=(SELECT student FROM request) AND s.school_id=(SELECT school FROM request) AND s.status='active'
 AND EXISTS(SELECT 1 FROM users actor JOIN roles r ON r.id=actor.role_id WHERE actor.id=(SELECT actor FROM request) AND actor.status='active'
 AND (r.key='system_admin' OR (actor.school_id=s.school_id AND r.key IN ('school_owner','principal','vice_principal','registrar','teacher'))))`;
 return {sql,args:[school,student,u.id]};
}
async function preview(c:C,school:number,b:Row) {
 const student=positiveId(b.student_id);ensure(typeof b.period==='string' && Object.prototype.hasOwnProperty.call(PROGRESS_PERIODS,b.period),'invalid_period','اختر فترة صحيحة');
 const period=b.period as ProgressPeriod,q=sourceQuery(c,school,student);
 const row=await c.env.DB.prepare(q.sql).bind(...q.args).first<{source:string}>();
 ensure(row,'student_unavailable','لا يوجد تسجيل فعال للطالب',404);
 const source=JSON.parse(row.source);ensure(source.grades.length>0,'grades_unavailable','لا توجد مواد ضمن صلاحيتك',403);
 ensure(source.grades.length<=100,'too_many_subjects','عدد المواد يتجاوز حد التقرير');
 ensure(progressPeriodEnabled(source,period),'period_disabled','هذه الفترة غير مفعلة في نظام الدرجات');
 const snapshot=progressSnapshot(source,period),digest=await sha256Hex(new TextEncoder().encode(JSON.stringify({period,source:row.source})));
 return {student,period,q,source,sourceJson:row.source,snapshot,digest};
}
function reportDto(r:Row){return {report_key:r.report_key,status:r.status,revision:Number(r.revision),created_at:Number(r.created_at),snapshot:JSON.parse(r.snapshot_json)};}
function reportAccess(c:C){const u=c.get('user');return u.role_key==='parent'?{sql:"r.status='published' AND EXISTS(SELECT 1 FROM parent_student_links l WHERE l.school_id=r.school_id AND l.student_id=r.student_id AND l.parent_user_id=? AND l.status='active')",args:[u.id]}:u.role_key==='teacher'?{sql:`r.created_by_user_id=? AND NOT EXISTS(SELECT 1 FROM json_each(r.source_json,'$.grades') j WHERE NOT EXISTS(SELECT 1 FROM student_subjects ss WHERE ss.id=json_extract(j.value,'$.assignment_id') AND ss.student_id=r.student_id AND ss.subject_id=json_extract(j.value,'$.subject_id') AND ss.school_id=r.school_id AND ${teacherAssignmentAccessSql('ss')}))`,args:[u.id,u.id]}:{sql:'1=1',args:[]};}
export function registerGradeProgressRoutes(app:Hono<{Bindings:Bindings;Variables:Variables}>) {
 const route=(method:string,path:string,fn:(c:C)=>Promise<Response>)=>app.on(method,`/api/grade-progress${path}`,c=>workflowResponse(c,()=>fn(c)));
 route('GET','',async c=>{
  const school=await workflowSchool(c,c.req.query('school_id'),GRADE_VIEW_ROLES),access=reportAccess(c);
  const before=c.req.query('before')?positiveId(c.req.query('before')):Number.MAX_SAFE_INTEGER;
  const rows=await c.env.DB.prepare(`SELECT r.* FROM grade_progress_reports r WHERE r.school_id=? AND r.id<? AND ${access.sql} ORDER BY r.id DESC LIMIT 51`).bind(school,before,...access.args).all<Row>();
  return c.json({data:{reports:(rows.results||[]).slice(0,50).map(reportDto),next_cursor:(rows.results||[]).length>50?rows.results![49].id:null}});
 });
 route('POST','/preview',async c=>{
  const b=await workflowBody(c,['school_id','student_id','period']);const school=await workflowSchool(c,b.school_id,GRADE_MANAGEMENT_ROLES),p=await preview(c,school,b);
  return c.json({data:{snapshot:p.snapshot,preview_digest:p.digest}});
 });
 route('POST','/publish',async c=>{
  const b=await workflowBody(c,['school_id','student_id','period','report_key','preview_digest','confirm_delivered']);
  const school=await workflowSchool(c,b.school_id,GRADE_MANAGEMENT_ROLES),u=c.get('user'),key=uuid(b.report_key);
  ensure(b.confirm_delivered===true,'delivery_required','أكد تسليم المتابعة للطالب قبل النشر');
  const existing=await c.env.DB.prepare('SELECT * FROM grade_progress_reports WHERE report_key=? AND school_id=?').bind(key,school).first<Row>();
  if(existing){
   const access=reportAccess(c);
   const visible=await c.env.DB.prepare(`SELECT r.id FROM grade_progress_reports r WHERE r.id=? AND r.school_id=? AND ${access.sql}`).bind(existing.id,school,...access.args).first();
   ensure(visible,'report_not_found','التقرير غير متاح',404);
   ensure(existing.created_by_user_id===u.id && existing.student_id===Number(b.student_id) && existing.period===b.period && existing.source_digest===b.preview_digest,'idempotency_conflict','معرف مستخدم لطلب مختلف',409);return c.json({data:reportDto(existing)});
  }
  const p=await preview(c,school,b);ensure(p.digest===b.preview_digest,'preview_stale','تغيرت الدرجات أو الإعدادات؛ أعد المعاينة',409);
  const token=crypto.randomUUID();
  await c.env.DB.batch([
   c.env.DB.prepare(`INSERT INTO workflow_write_guards(token,valid) SELECT ?,CASE WHEN (${p.q.sql})=? THEN 1 ELSE 0 END`).bind(token,...p.q.args,p.sourceJson),
   c.env.DB.prepare(`INSERT INTO grade_progress_reports(report_key,school_id,student_id,academic_year_id,period,snapshot_json,source_json,source_digest,delivered_to_student,created_by_user_id,updated_by_user_id) VALUES(?,?,?,?,?,?,?,?,1,?,?)`).bind(key,school,p.student,p.source.year_id,p.period,JSON.stringify(p.snapshot),p.sourceJson,p.digest,u.id,u.id),
   c.env.DB.prepare(`INSERT INTO school_notifications(notification_key,school_id,student_id,notification_type,title,body,reference_type,reference_key,created_by_user_id) VALUES(?,?,?,'grade_progress','متابعة دراسية جديدة','نشرت المدرسة متابعة دراسية للطالب','grade_progress',?,?)`).bind(key,school,p.student,key,u.id),
   c.env.DB.prepare(`INSERT INTO notification_recipients(notification_key,school_id,user_id) SELECT ?,l.school_id,l.parent_user_id FROM parent_student_links l JOIN users u ON u.id=l.parent_user_id AND u.school_id=l.school_id AND u.status='active' WHERE l.school_id=? AND l.student_id=? AND l.status='active'`).bind(key,school,p.student),
   c.env.DB.prepare('DELETE FROM workflow_write_guards WHERE token=?').bind(token)
  ]);
  const result=await c.env.DB.prepare('SELECT * FROM grade_progress_reports WHERE report_key=?').bind(key).first<Row>();return c.json({data:reportDto(result!)},201);
 });
 route('POST','/:key/withdraw',async c=>{
  const b=await workflowBody(c,['school_id','revision','reason']),school=await workflowSchool(c,b.school_id,GRADE_MANAGEMENT_ROLES),u=c.get('user'),access=reportAccess(c);
  const key=uuid(c.req.param('key')),reason=boundedText(b.reason,500),revision=positiveId(b.revision);
  const r=await c.env.DB.prepare(`SELECT r.id FROM grade_progress_reports r WHERE r.school_id=? AND r.report_key=? AND ${access.sql}`).bind(school,key,...access.args).first<Row>();ensure(r,'report_not_found','التقرير غير متاح',404);
  const changed=await c.env.DB.prepare(`UPDATE grade_progress_reports AS r SET status='withdrawn',revision=revision+1,withdrawal_reason=?,updated_by_user_id=? WHERE r.id=? AND r.revision=? AND r.status='published' AND ${access.sql} RETURNING *`).bind(reason,u.id,r.id,revision,...access.args).first<Row>();
  ensure(changed,'report_stale','التقرير تغير أو سُحب مسبقًا',409);return c.json({data:reportDto(changed)});
 });
}
