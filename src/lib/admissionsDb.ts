import type {Hono} from 'hono';
import type {Bindings,Variables} from '../worker';
import {ACADEMIC_MANAGEMENT_ROLES,SCHOOL_MANAGEMENT_ROLES} from './rbac';
import {ADMISSION_PROCESSES,baghdadDate,evaluateAdmission,parseAdmissionRules,validDate} from './admissionRegulations';
import {parseAdmissionFacts} from './admissions';
import {sha256Hex} from './homework';
import {boundedText,ensure,positiveId,uuid,workflowBody,workflowResponse,workflowSchool,type WorkflowContext as C} from './schoolWorkflow';
type Row=Record<string,any>;
function dto(r:Row){return {application_key:r.application_key,student_id:r.student_id,applicant:r.applicant_json?JSON.parse(r.applicant_json):null,student_name:r.student_name||(r.applicant_json?JSON.parse(r.applicant_json).full_name:''),academic_year_id:r.academic_year_id,class_id:r.class_id,section_id:r.section_id,process:r.process,external_school:r.external_school,document_reference:r.document_reference,facts:JSON.parse(r.facts_json),status:r.status,revision:r.revision};}
async function application(c:C,school:number,key:string){const r=await c.env.DB.prepare('SELECT a.*,s.full_name AS student_name FROM admission_applications a LEFT JOIN students s ON s.id=a.student_id AND s.school_id=a.school_id WHERE a.school_id=? AND a.application_key=?').bind(school,key).first<Row>();ensure(r,'application_not_found','الطلب غير موجود',404);return r;}
function contextQuery(school:number,key:string){
 const sql=`SELECT json_object('application_id',a.id,'school_id',a.school_id,'student_id',a.student_id,'year_id',a.academic_year_id,'class_id',a.class_id,'section_id',a.section_id,'process',a.process,'applicant',json(a.applicant_json),'facts',json(a.facts_json),'external_school',a.external_school,'document_reference',a.document_reference,
 'student',json((SELECT json_object('id',s.id,'name',s.full_name,'birth_date',s.birth_date,'status',s.status,'class_id',s.class_id,'section_id',s.section_id) FROM students s WHERE s.id=a.student_id AND s.school_id=a.school_id)),
 'enrollment',json((SELECT json_object('id',e.id,'class_id',e.class_id,'section_id',e.section_id,'status',e.status,'promotion_status',e.promotion_status,'completed_at',e.completed_at) FROM student_enrollments e WHERE e.student_id=a.student_id AND e.school_id=a.school_id AND e.academic_year_id=a.academic_year_id)),
 'year_active',(SELECT is_active FROM academic_years WHERE id=a.academic_year_id AND school_id=a.school_id),
 'class_active',(SELECT status='active' FROM classes WHERE id=a.class_id AND school_id=a.school_id),
 'sections_count',(SELECT count(*) FROM sections WHERE class_id=a.class_id AND school_id=a.school_id AND status='active'),
 'section',json((SELECT json_object('id',sec.id,'status',sec.status,'capacity',sec.capacity,'class_id',sec.class_id) FROM sections sec WHERE sec.id=a.section_id AND sec.school_id=a.school_id)),
 'occupancy',(SELECT count(*) FROM student_enrollments e WHERE e.school_id=a.school_id AND e.academic_year_id=a.academic_year_id AND e.class_id=a.class_id AND e.section_id IS a.section_id AND e.status='active'),
 'incompatible_assignments',(SELECT count(*) FROM student_subjects ss WHERE ss.school_id=a.school_id AND ss.student_id=a.student_id AND ss.is_active=1 AND (ss.class_id<>a.class_id OR ss.section_id IS NOT a.section_id)),
 'official_decision',(SELECT count(*) FROM student_promotion_result_decisions d JOIN student_enrollments e ON e.id=d.source_enrollment_id WHERE e.school_id=a.school_id AND e.student_id=a.student_id AND e.academic_year_id=a.academic_year_id),
 'number_in_use',CASE WHEN a.student_id IS NULL THEN (SELECT count(*) FROM students s WHERE s.school_id=a.school_id AND s.student_number=json_extract(a.applicant_json,'$.student_number')) ELSE 0 END,
 'regulation',json((SELECT json_object('id',r.id,'regulation_key',r.regulation_key,'version',r.version,'title',r.title,'jurisdiction',r.jurisdiction,'source_reference',r.source_reference,'source_url',r.source_url,'rules',json(r.rules_json),'effective_from',r.effective_from,'effective_to',r.effective_to)
 FROM admission_regulations r WHERE r.school_id=a.school_id AND r.academic_year_id=a.academic_year_id AND r.class_id=a.class_id AND r.process=a.process AND r.status='approved' AND r.effective_from<=? AND r.effective_to>=?)),
 'business_date',?) AS source FROM admission_applications a WHERE a.school_id=? AND a.application_key=?`;
 const today=baghdadDate();return {sql,args:[today,today,today,school,key]};
}
async function inspect(c:C,school:number,key:string){
 const q=contextQuery(school,key),row=await c.env.DB.prepare(q.sql).bind(...q.args).first<{source:string}>();ensure(row,'application_not_found','الطلب غير موجود',404);
 const source=JSON.parse(row.source),rules=source.regulation?parseAdmissionRules(source.regulation.rules):null;
 const facts=parseAdmissionFacts(source.facts),eligibility=evaluateAdmission(rules,{birth_date:source.student?.birth_date??source.applicant?.birth_date??null,...facts}),issues:string[]=[];
 if(source.year_active!==1)issues.push('السنة الدراسية غير فعالة');
 if(source.class_active!==1)issues.push('الصف غير فعال');
 if(source.section_id!=null&&(!source.section||source.section.status!=='active'||source.section.class_id!==source.class_id))issues.push('الشعبة غير متاحة');
 if(source.sections_count>0&&source.section_id==null)issues.push('يجب تحديد شعبة فعالة');
 if(source.student_id!=null&&(!source.student||source.student.status!=='active'))issues.push('ملف الطالب غير فعال');
 if(source.process==='transfer_out'){
  const e=source.enrollment;
  if(!e||e.status!=='active'||e.promotion_status!=='pending'||e.class_id!==source.class_id||e.section_id!==source.section_id)issues.push('النقل الصادر يحتاج تسجيلًا فعالًا غير محسوم في الصف والشعبة المحددين');
  if(source.official_decision>0)issues.push('يوجد قرار انتقال رسمي لا يمكن تغييره بهذا المسار');
 }else{
  if(source.enrollment)issues.push('يوجد تسجيل محفوظ للطالب في هذه السنة؛ لا يُستبدل من طلب القبول');
  if(source.number_in_use>0)issues.push('رقم الطالب مستخدم؛ اختر ملفه الموجود');
  if(source.incompatible_assignments>0)issues.push('توجد مواد فعالة في موضع آخر؛ راجع التسجيل والمواد قبل القبول');
  if(source.section&&Number(source.section.capacity)>0&&source.occupancy>=Number(source.section.capacity))issues.push('الشعبة ممتلئة');
 }
 const digest=await sha256Hex(new TextEncoder().encode(row.source));
 return {q,source,sourceJson:row.source,data:{eligibility,operational_issues:issues,can_approve:eligibility.decision==='eligible'&&issues.length===0,preview_digest:digest,regulation:source.regulation?{title:source.regulation.title,version:source.regulation.version,source_reference:source.regulation.source_reference,source_url:source.regulation.source_url}:null}};
}
function actorSql(management:boolean){return `EXISTS(SELECT 1 FROM users actor JOIN roles role ON role.id=actor.role_id WHERE actor.id=? AND actor.status='active' AND (role.key='system_admin' OR (actor.school_id=? AND role.key IN ('school_owner','principal','vice_principal'${management?'':",'registrar'"}))))`;}
function guard(c:C,school:number,r:Row,token:string,management:boolean,inspection?:Awaited<ReturnType<typeof inspect>>){
 return c.env.DB.prepare(`INSERT INTO workflow_write_guards(token,valid) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM admission_applications WHERE id=? AND revision=? AND status=?) AND ${actorSql(management)} ${inspection?`AND (${inspection.q.sql})=?`:''} THEN 1 ELSE 0 END`)
 .bind(token,r.id,r.revision,r.status,c.get('user').id,school,...(inspection?[...inspection.q.args,inspection.sourceJson]:[]));
}
export function registerAdmissionsRoutes(app:Hono<{Bindings:Bindings;Variables:Variables}>){
 const route=(method:string,path:string,fn:(c:C)=>Promise<Response>)=>app.on(method,`/api/admissions${path}`,c=>workflowResponse(c,()=>fn(c)));
 route('GET','',async c=>{const school=await workflowSchool(c,c.req.query('school_id'),ACADEMIC_MANAGEMENT_ROLES),before=c.req.query('before')?positiveId(c.req.query('before')):Number.MAX_SAFE_INTEGER;const rows=await c.env.DB.prepare('SELECT a.*,s.full_name AS student_name FROM admission_applications a LEFT JOIN students s ON s.id=a.student_id AND s.school_id=a.school_id WHERE a.school_id=? AND a.id<? ORDER BY a.id DESC LIMIT 101').bind(school,before).all<Row>();return c.json({data:{applications:(rows.results||[]).slice(0,100).map(dto),next_cursor:(rows.results||[]).length>100?rows.results![99].id:null}});});
 route('POST','',async c=>{
  const b=await workflowBody(c,['school_id','application_key','student_id','applicant','academic_year_id','class_id','section_id','process','external_school','document_reference','facts']);
  const school=await workflowSchool(c,b.school_id,ACADEMIC_MANAGEMENT_ROLES),u=c.get('user'),key=uuid(b.application_key),student=b.student_id==null?null:positiveId(b.student_id),year=positiveId(b.academic_year_id),classId=positiveId(b.class_id),section=b.section_id==null?null:positiveId(b.section_id);
  ensure(Object.prototype.hasOwnProperty.call(ADMISSION_PROCESSES,b.process),'invalid_process','نوع الطلب غير صالح');const facts=JSON.stringify(parseAdmissionFacts(b.facts));let applicant:string|null=null;
  if(student==null){ensure(b.process!=='transfer_out','student_required','النقل الصادر يحتاج طالبًا مسجلًا');const p=b.applicant;ensure(p&&typeof p==='object'&&!Array.isArray(p)&&Object.keys(p).every(k=>['full_name','student_number','gender','birth_date'].includes(k)),'applicant_required','أدخل بيانات الطالب');ensure(p.gender==='male'||p.gender==='female','invalid_gender','الجنس غير صالح');applicant=JSON.stringify({full_name:boundedText(p.full_name,200),student_number:boundedText(p.student_number,50),gender:p.gender,birth_date:p.birth_date==null?null:validDate(p.birth_date)});}
  else ensure(b.applicant==null,'invalid_applicant','استخدم ملف الطالب الموجود أو متقدمًا جديدًا');
  const external=b.process==='admission'?null:boundedText(b.external_school,200),reference=b.process==='admission'?null:boundedText(b.document_reference,250);
  const existing=await c.env.DB.prepare('SELECT * FROM admission_applications WHERE application_key=? AND school_id=?').bind(key,school).first<Row>();
  if(existing){ensure(existing.created_by_user_id===u.id&&(existing.student_id===student||(student==null&&existing.status==='executed'&&existing.applicant_json!=null))&&existing.applicant_json===applicant&&existing.academic_year_id===year&&existing.class_id===classId&&existing.section_id===section&&existing.process===b.process&&existing.external_school===external&&existing.document_reference===reference&&existing.facts_json===facts,'idempotency_conflict','المعرف مستخدم لطلب آخر',409);return c.json({data:dto(existing)});}
  const r=await c.env.DB.prepare(`INSERT INTO admission_applications(application_key,school_id,student_id,applicant_json,academic_year_id,class_id,section_id,process,external_school,document_reference,facts_json,created_by_user_id,updated_by_user_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING *`)
   .bind(key,school,student,applicant,year,classId,section,b.process,external,reference,facts,u.id,u.id).first<Row>();return c.json({data:dto(r!)},201);
 });
 route('GET','/:key/preview',async c=>{const school=await workflowSchool(c,c.req.query('school_id'),ACADEMIC_MANAGEMENT_ROLES);return c.json({data:(await inspect(c,school,uuid(c.req.param('key')))).data});});
 route('GET','/:key/audit',async c=>{const school=await workflowSchool(c,c.req.query('school_id'),ACADEMIC_MANAGEMENT_ROLES),r=await application(c,school,uuid(c.req.param('key')));const rows=await c.env.DB.prepare('SELECT old_status,new_status,revision,reason,facts_json,approval_snapshot,created_at FROM admission_application_audit WHERE application_id=? ORDER BY id').bind(r.id).all();return c.json({data:rows.results||[]});});
 route('PUT','/:key/facts',async c=>{
  const b=await workflowBody(c,['school_id','revision','facts','reason']),school=await workflowSchool(c,b.school_id,ACADEMIC_MANAGEMENT_ROLES),r=await application(c,school,uuid(c.req.param('key'))),revision=positiveId(b.revision),facts=JSON.stringify(parseAdmissionFacts(b.facts)),reason=boundedText(b.reason,500);
  ensure(r.status==='submitted'&&r.revision===revision,'application_stale','تغير الطلب؛ أعد تحميله',409);const token=crypto.randomUUID();await c.env.DB.batch([guard(c,school,r,token,false),c.env.DB.prepare('UPDATE admission_applications SET facts_json=?,revision=revision+1,updated_by_user_id=?,action_reason=?,updated_at=unixepoch() WHERE id=?').bind(facts,c.get('user').id,reason,r.id),c.env.DB.prepare('DELETE FROM workflow_write_guards WHERE token=?').bind(token)]);return c.json({data:dto(await application(c,school,r.application_key))});
 });
 route('POST','/:key/decision',async c=>{
  const b=await workflowBody(c,['school_id','revision','decision','reason','preview_digest','confirm_evidence_verified']),school=await workflowSchool(c,b.school_id,SCHOOL_MANAGEMENT_ROLES),r=await application(c,school,uuid(c.req.param('key'))),revision=positiveId(b.revision),reason=boundedText(b.reason,500),u=c.get('user');
  ensure(['approve','reject','cancel','reopen'].includes(b.decision),'invalid_decision','القرار غير صالح');ensure(r.revision===revision,'application_stale','تغير الطلب؛ أعد تحميله',409);
  const next=({approve:'approved',reject:'rejected',cancel:'cancelled',reopen:'submitted'} as Record<string,string>)[b.decision];
  ensure((r.status==='submitted'&&['approve','reject','cancel'].includes(b.decision))||(r.status==='approved'&&['cancel','reopen'].includes(b.decision)),'invalid_transition','لا يمكن تطبيق هذا القرار على حالة الطلب',409);
  const inspection=b.decision==='approve'?await inspect(c,school,r.application_key):undefined;
  if(inspection){ensure(b.confirm_evidence_verified===true,'evidence_required','أكد مراجعة المستندات والبيانات');ensure(inspection.data.can_approve,'admission_blocked','الطلب يحتاج معالجة الشروط قبل الاعتماد',409);ensure(inspection.data.preview_digest===b.preview_digest,'preview_stale','تغير تقييم الطلب؛ أعد المعاينة',409);}
  const token=crypto.randomUUID();await c.env.DB.batch([guard(c,school,r,token,true,inspection),
   c.env.DB.prepare('UPDATE admission_applications SET status=?,revision=revision+1,regulation_id=?,approved_digest=?,approval_snapshot=?,updated_by_user_id=?,action_reason=?,updated_at=unixepoch() WHERE id=?')
    .bind(next,inspection?.source.regulation.id??null,inspection?.data.preview_digest??null,inspection?.sourceJson??null,u.id,reason,r.id),
   c.env.DB.prepare('DELETE FROM workflow_write_guards WHERE token=?').bind(token)]);
  return c.json({data:dto(await application(c,school,r.application_key))});
 });
 route('POST','/:key/execute',async c=>{
  const b=await workflowBody(c,['school_id','revision','confirm_execute']),school=await workflowSchool(c,b.school_id,ACADEMIC_MANAGEMENT_ROLES),r=await application(c,school,uuid(c.req.param('key'))),u=c.get('user');
  ensure(b.confirm_execute===true,'confirmation_required','أكد تنفيذ التسجيل أو النقل');if(r.status==='executed')return c.json({data:dto(r)});
  ensure(r.status==='approved'&&r.revision===positiveId(b.revision),'application_stale','يجب اعتماد الطلب قبل التنفيذ',409);
  const p=await inspect(c,school,r.application_key);ensure(p.data.can_approve&&p.data.preview_digest===r.approved_digest,'admission_approval_stale','تغيرت اللوائح أو بيانات الطلب أو سعة الشعبة؛ أعد الطلب للمراجعة',409);
  const token=crypto.randomUUID(),db=c.env.DB,statements=[guard(c,school,r,token,false,p)];
  let studentSQL='?',studentArgs:unknown[]=[r.student_id];
  if(r.student_id==null){const a=JSON.parse(r.applicant_json);statements.push(db.prepare("INSERT INTO students(school_id,student_number,full_name,gender,birth_date,class_id,section_id,status) VALUES(?,?,?,?,?,?,?,'active')").bind(school,a.student_number,a.full_name,a.gender,a.birth_date,r.class_id,r.section_id));studentSQL='(SELECT id FROM students WHERE school_id=? AND student_number=?)';studentArgs=[school,a.student_number];}
  if(r.process==='transfer_out'){
   statements.push(db.prepare("UPDATE student_enrollments SET status='transferred',promotion_status='not_applicable',completed_at=unixepoch(),updated_by_user_id=? WHERE id=? AND school_id=? AND status='active' AND promotion_status='pending'").bind(u.id,p.source.enrollment.id,school));
   statements.push(db.prepare('UPDATE student_subjects SET is_active=0 WHERE student_id=? AND school_id=? AND is_active=1').bind(r.student_id,school));
  }else{
   statements.push(db.prepare(`INSERT INTO student_enrollments(school_id,student_id,academic_year_id,class_id,section_id,status,promotion_status,created_by_user_id,updated_by_user_id) VALUES(?,${studentSQL},?,?,?,'active','pending',?,?)`).bind(school,...studentArgs,r.academic_year_id,r.class_id,r.section_id,u.id,u.id));
   statements.push(db.prepare(`UPDATE students SET class_id=?,section_id=?,updated_at=unixepoch() WHERE id=${studentSQL} AND school_id=?`).bind(r.class_id,r.section_id,...studentArgs,school));
  }
  statements.push(db.prepare(`UPDATE admission_applications SET student_id=${studentSQL},status='executed',revision=revision+1,updated_by_user_id=?,action_reason='تنفيذ الطلب المعتمد',updated_at=unixepoch() WHERE id=?`).bind(...studentArgs,u.id,r.id));
  statements.push(db.prepare('DELETE FROM workflow_write_guards WHERE token=?').bind(token));
  await db.batch(statements);return c.json({data:dto(await application(c,school,r.application_key))});
 });
}
