import type {Hono} from 'hono';
import type {Bindings,Variables} from '../worker';
import {ACADEMIC_MANAGEMENT_ROLES,SCHOOL_MANAGEMENT_ROLES} from './rbac';
import {ADMISSION_PROCESSES,baghdadDate,parseAdmissionRules,validDate} from './admissionRegulations';
import {boundedText,ensure,positiveId,uuid,workflowBody,workflowResponse,workflowSchool,type WorkflowContext as C} from './schoolWorkflow';
type Row=Record<string,any>;
export function regulationDto(r:Row){return {regulation_key:r.regulation_key,academic_year_id:r.academic_year_id,class_id:r.class_id,process:r.process,version:r.version,title:r.title,jurisdiction:r.jurisdiction,source_reference:r.source_reference,source_url:r.source_url,effective_from:r.effective_from,effective_to:r.effective_to,rules:JSON.parse(r.rules_json),status:r.status,revision:r.revision};}
export function registerAdmissionRegulationRoutes(app:Hono<{Bindings:Bindings;Variables:Variables}>){
 const route=(method:string,path:string,fn:(c:C)=>Promise<Response>)=>app.on(method,`/api/regulations${path}`,c=>workflowResponse(c,()=>fn(c)));
 route('GET','',async c=>{const school=await workflowSchool(c,c.req.query('school_id'),ACADEMIC_MANAGEMENT_ROLES);const rows=await c.env.DB.prepare('SELECT * FROM admission_regulations WHERE school_id=? ORDER BY id DESC LIMIT 200').bind(school).all<Row>();return c.json({data:(rows.results||[]).map(regulationDto)});});
 route('POST','',async c=>{
  const b=await workflowBody(c,['school_id','regulation_key','academic_year_id','class_id','process','title','jurisdiction','source_reference','source_url','effective_from','effective_to','rules']);
  const school=await workflowSchool(c,b.school_id,ACADEMIC_MANAGEMENT_ROLES),u=c.get('user'),key=uuid(b.regulation_key),year=positiveId(b.academic_year_id),classId=positiveId(b.class_id);
  ensure(Object.prototype.hasOwnProperty.call(ADMISSION_PROCESSES,b.process),'invalid_process','نوع الطلب غير صالح');
  const title=boundedText(b.title,200),jurisdiction=boundedText(b.jurisdiction,120),source=boundedText(b.source_reference,250),url=boundedText(b.source_url,1000),from=validDate(b.effective_from),to=validDate(b.effective_to),rules=JSON.stringify(parseAdmissionRules(b.rules));
  let parsed:URL;try{parsed=new URL(url);}catch{ensure(false,'invalid_source','أدخل رابطًا موثقًا للمصدر');}ensure(['https:','http:'].includes(parsed.protocol)&&!parsed.username&&!parsed.password,'invalid_source','أدخل رابطًا موثقًا للمصدر');ensure(to>=from,'invalid_range','نهاية السريان تسبق البداية');
  const old=await c.env.DB.prepare('SELECT * FROM admission_regulations WHERE regulation_key=? AND school_id=?').bind(key,school).first<Row>();
  if(old){ensure(old.created_by_user_id===u.id&&old.academic_year_id===year&&old.class_id===classId&&old.process===b.process&&old.title===title&&old.jurisdiction===jurisdiction&&old.source_reference===source&&old.source_url===url&&old.effective_from===from&&old.effective_to===to&&old.rules_json===rules,'idempotency_conflict','المعرف مستخدم لطلب مختلف',409);return c.json({data:regulationDto(old)});}
  const r=await c.env.DB.prepare(`INSERT INTO admission_regulations(regulation_key,school_id,academic_year_id,class_id,process,version,title,jurisdiction,source_reference,source_url,effective_from,effective_to,rules_json,created_by_user_id,updated_by_user_id)
   SELECT ?,?,?,?,?,coalesce(max(version),0)+1,?,?,?,?,?,?,?,?,? FROM admission_regulations WHERE school_id=? AND academic_year_id=? AND class_id=? AND process=? RETURNING *`)
   .bind(key,school,year,classId,b.process,title,jurisdiction,source,url,from,to,rules,u.id,u.id,school,year,classId,b.process).first<Row>();return c.json({data:regulationDto(r!)},201);
 });
 route('POST','/:key/approve',async c=>{
  const b=await workflowBody(c,['school_id','revision','confirm_source_verified','reason']),school=await workflowSchool(c,b.school_id,SCHOOL_MANAGEMENT_ROLES),u=c.get('user'),key=uuid(c.req.param('key'));
  ensure(b.confirm_source_verified===true,'source_verification_required','يجب تأكيد مراجعة المصدر الرسمي وشروطه');const revision=positiveId(b.revision),reason=boundedText(b.reason,500),today=baghdadDate();
  const r=await c.env.DB.prepare("SELECT * FROM admission_regulations WHERE regulation_key=? AND school_id=? AND status='draft' AND revision=?").bind(key,school,revision).first<Row>();ensure(r,'regulation_stale','اللائحة غير متاحة للاعتماد',409);ensure(r.effective_from<=today&&r.effective_to>=today,'regulation_not_effective','اللائحة خارج فترة السريان');
  const token=crypto.randomUUID();await c.env.DB.batch([
   c.env.DB.prepare(`INSERT INTO workflow_write_guards(token,valid) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM admission_regulations WHERE id=? AND status='draft' AND revision=?) AND EXISTS(SELECT 1 FROM users actor JOIN roles r ON r.id=actor.role_id WHERE actor.id=? AND actor.status='active' AND (r.key='system_admin' OR (actor.school_id=? AND r.key IN ('school_owner','principal','vice_principal')))) THEN 1 ELSE 0 END`).bind(token,r.id,revision,u.id,school),
   c.env.DB.prepare("UPDATE admission_regulations SET status='retired',revision=revision+1,updated_by_user_id=?,change_reason=? WHERE school_id=? AND academic_year_id=? AND class_id=? AND process=? AND status='approved'").bind(u.id,'استبدلت بلائحة أحدث: '+reason,school,r.academic_year_id,r.class_id,r.process),
   c.env.DB.prepare("UPDATE admission_regulations SET status='approved',revision=revision+1,updated_by_user_id=?,change_reason=? WHERE id=?").bind(u.id,reason,r.id),
   c.env.DB.prepare('DELETE FROM workflow_write_guards WHERE token=?').bind(token)
  ]);return c.json({data:regulationDto({...r,status:'approved',revision:revision+1})});
 });
 route('POST','/:key/retire',async c=>{
  const b=await workflowBody(c,['school_id','revision','reason']),school=await workflowSchool(c,b.school_id,SCHOOL_MANAGEMENT_ROLES),u=c.get('user'),key=uuid(c.req.param('key')),revision=positiveId(b.revision),reason=boundedText(b.reason,500);
  const changed=await c.env.DB.prepare(`UPDATE admission_regulations SET status='retired',revision=revision+1,updated_by_user_id=?,change_reason=?
   WHERE regulation_key=? AND school_id=? AND status='approved' AND revision=?
   AND EXISTS(SELECT 1 FROM users actor JOIN roles r ON r.id=actor.role_id WHERE actor.id=? AND actor.status='active' AND (r.key='system_admin' OR (actor.school_id=? AND r.key IN ('school_owner','principal','vice_principal')))) RETURNING *`)
   .bind(u.id,reason,key,school,revision,u.id,school).first<Row>();
  ensure(changed,'regulation_stale','تغيرت اللائحة أو الصلاحيات؛ أعد التحميل',409);return c.json({data:regulationDto(changed)});
 });
 route('GET','/:key/audit',async c=>{const school=await workflowSchool(c,c.req.query('school_id'),ACADEMIC_MANAGEMENT_ROLES);const r=await c.env.DB.prepare('SELECT a.action,a.reason,a.created_at FROM admission_regulation_audit a JOIN admission_regulations r ON r.id=a.regulation_id WHERE r.regulation_key=? AND r.school_id=? ORDER BY a.id').bind(uuid(c.req.param('key')),school).all();return c.json({data:r.results||[]});});
}
