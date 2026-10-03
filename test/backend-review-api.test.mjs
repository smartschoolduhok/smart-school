import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import {createServer} from 'vite';
import {signJWT} from '../src/lib/jwtSecurity.ts';
import {workflowBody} from '../src/lib/schoolWorkflow.ts';
import {deactivateStudentSubjectAssignments,RELIGIOUS_SUBJECT_HAS_GRADES_CODE} from '../src/lib/religiousSubjects.ts';
import {financeFixture,root,snapshot} from './helpers/finance-fixture.mjs';

const vite=await createServer({root,appType:'custom',server:{middlewareMode:true,hmr:false}});
const {default:app}=await vite.ssrLoadModule('/src/worker.ts');after(()=>vite.close());
const secret='backend-audit-test-secret-at-least-32-characters';
const token=await signJWT({id:1,email:'owner@matrix.test',auth_version:1},secret);
async function imported(f,action,rows,mode='update_existing'){
 const response=await app.request(`http://localhost/api/import-export/student-subjects/${action}`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({school_id:1,mode,rows})},{DB:f.d1,JWT_SECRET:secret,APP_ENV:'test'});
 return {status:response.status,body:await response.json()};
}
function assignmentFixture(t,active){
 const f=financeFixture(t);
 f.db.exec('INSERT INTO student_enrollments(school_id,student_id,academic_year_id,class_id,section_id,created_by_user_id,updated_by_user_id) VALUES(1,1,1,1,1,1,1),(1,2,1,1,2,1,1)');
 f.db.prepare('INSERT INTO student_subjects(id,school_id,student_id,subject_id,class_id,section_id,is_active,assigned_by_user_id,removed_at,notes) VALUES(1,1,1,1,1,1,?,1,?,?)').run(active,active?null:123,'previous');
 f.db.exec('INSERT INTO grades(school_id,student_subject_id,first_month,updated_by_user_id) VALUES(1,1,87,1)');
 return f;
}

test('spreadsheet preview preserves explicit false and zero active flags',async t=>{
 const f=financeFixture(t),before=snapshot(f.db);
 for(const is_active of [false,0,'0','false','لا']){
  const r=await imported(f,'preview',[{student_number:'FIN-001',subject_name:'Math',is_active}]);
  assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.body.data.errors.length,0,JSON.stringify(r));
  assert.equal(r.body.data.valid[0].data.is_active,false,JSON.stringify(is_active));
 }
 assert.deepEqual(snapshot(f.db),before);
});

test('confirmation preserves inactive new or existing assignments for every supported false representation',async t=>{
 for(const is_active of [false,0,'0','false','لا'])await t.test(String(is_active),async sub=>{
  const f=assignmentFixture(sub,0),grade=f.db.prepare('SELECT * FROM grades').all();
  const r=await imported(f,'confirm',[{student_id:1,subject_id:1,is_active,notes:'changed'}]);assert.equal(r.status,200);assert.equal(r.body.data.error_count,0,JSON.stringify(r));
  assert.equal(f.db.prepare('SELECT is_active FROM student_subjects WHERE id=1').get().is_active,0);
  const next=await imported(f,'confirm',[{student_id:2,subject_id:2,is_active}]);assert.equal(next.body.data.imported_count,1,JSON.stringify(next));assert.equal(f.db.prepare('SELECT is_active FROM student_subjects WHERE student_id=2 AND subject_id=2').get().is_active,0);
  assert.deepEqual(f.db.prepare('SELECT * FROM grades').all(),grade);
 });
});

test('ordinary assignment deactivation and reactivation round trip state, notes and removal timestamp without changing grades',async t=>{
 const f=assignmentFixture(t,1),grade=f.db.prepare('SELECT * FROM grades').all();
 const removed=await imported(f,'confirm',[{student_id:1,subject_id:1,is_active:false,notes:'inactive note'}]);assert.equal(removed.body.data.error_count,0);
 let row=f.db.prepare('SELECT * FROM student_subjects WHERE id=1').get();assert.equal(row.is_active,0);assert.ok(row.removed_at>0);assert.equal(row.notes,'inactive note');
 const restored=await imported(f,'confirm',[{student_id:1,subject_id:1,is_active:true,notes:'restored note'}]);assert.equal(restored.body.data.error_count,0);
 row=f.db.prepare('SELECT * FROM student_subjects WHERE id=1').get();assert.equal(row.is_active,1);assert.equal(row.removed_at,null);assert.equal(row.notes,'restored note');assert.deepEqual(f.db.prepare('SELECT * FROM grades').all(),grade);
});

test('spreadsheet inactive flags cannot bypass the religious subject saved-grade safeguard',async t=>{
 const f=assignmentFixture(t,1);f.db.exec("UPDATE subjects SET religious_track='islamic' WHERE id=1");
 const before=f.db.prepare('SELECT * FROM student_subjects').all(),grades=f.db.prepare('SELECT * FROM grades').all();
 const r=await imported(f,'confirm',[{student_id:1,subject_id:1,is_active:false,notes:'must not replace'}]);
 assert.equal(r.body.data.error_count,1,JSON.stringify(r));assert.match(r.body.data.row_errors[0].message,/درجات محفوظة/);assert.deepEqual(f.db.prepare('SELECT * FROM student_subjects').all(),before);assert.deepEqual(f.db.prepare('SELECT * FROM grades').all(),grades);
});

test('import deactivation rejects grades, notes, history or religious classification saved after preflight',async t=>{
 const races={
  zero_grade:f=>f.db.exec('UPDATE grades SET first_month=0 WHERE student_subject_id=1'),
  academic_note:f=>f.db.exec("UPDATE grades SET notes='concurrent academic note' WHERE student_subject_id=1"),
  grade_history:f=>f.db.exec("INSERT INTO grade_change_logs(school_id,grade_id,field_name,new_value) SELECT 1,id,'first_month','87' FROM grades WHERE student_subject_id=1"),
  religious_conversion:f=>f.db.exec("UPDATE subjects SET religious_track='islamic' WHERE id=1; UPDATE grades SET first_month=87 WHERE student_subject_id=1"),
 };
 for(const [name,race] of Object.entries(races))await t.test(name,async sub=>{
  const f=assignmentFixture(sub,1);f.db.exec('UPDATE grades SET first_month=NULL WHERE student_subject_id=1');
  if(name!=='religious_conversion')f.db.exec("UPDATE subjects SET religious_track='islamic' WHERE id=1");
  const assignments=f.db.prepare('SELECT * FROM student_subjects ORDER BY id').all();let preservedGrades,preservedHistory;
  f.d1.beforeWrite=()=>{race(f);preservedGrades=f.db.prepare('SELECT * FROM grades ORDER BY id').all();preservedHistory=f.db.prepare('SELECT * FROM grade_change_logs ORDER BY id').all();};
  const result=await imported(f,'confirm',[{student_id:1,subject_id:1,is_active:false,notes:'must not replace'}]);
  assert.equal(result.body.data.error_count,1,JSON.stringify(result));assert.equal(result.body.data.updated_count,0);assert.match(result.body.data.row_errors[0].message,/درجات محفوظة/);
  assert.deepEqual(f.db.prepare('SELECT * FROM student_subjects ORDER BY id').all(),assignments);
  assert.deepEqual(f.db.prepare('SELECT * FROM grades ORDER BY id').all(),preservedGrades);
  assert.deepEqual(f.db.prepare('SELECT * FROM grade_change_logs ORDER BY id').all(),preservedHistory);
 });
});

test('concurrent religious grade rejects a whole mixed bulk deactivation without changing ordinary assignment notes',async t=>{
 const f=assignmentFixture(t,1);f.db.exec("UPDATE grades SET first_month=NULL WHERE student_subject_id=1; UPDATE subjects SET religious_track='islamic' WHERE id=1; INSERT INTO student_subjects(id,school_id,student_id,subject_id,class_id,section_id,is_active,assigned_by_user_id,notes) VALUES(2,1,1,2,1,1,1,1,'ordinary note')");
 const assignments=f.db.prepare('SELECT * FROM student_subjects ORDER BY id').all();
 f.d1.beforeWrite=()=>f.db.exec('UPDATE grades SET first_month=88 WHERE student_subject_id=1');
 const result=await deactivateStudentSubjectAssignments(f.d1,1,[2,1],{notes:'must not replace'});
 assert.equal(result.ok,false);assert.equal(result.status,409);assert.equal(result.code,RELIGIOUS_SUBJECT_HAS_GRADES_CODE);assert.equal(result.meta.assignment_id,1);
 assert.deepEqual(f.db.prepare('SELECT * FROM student_subjects ORDER BY id').all(),assignments);
 assert.equal(f.db.prepare('SELECT first_month FROM grades WHERE student_subject_id=1').get().first_month,88);
});

test('workflow body limit stops and cancels oversized streaming input before consuming the complete body',async()=>{
 let pulls=0,cancelled=false;
 const stream=new ReadableStream({pull(controller){pulls++;if(pulls>200){controller.close();return;}controller.enqueue(new Uint8Array(16384).fill(32));},cancel(){cancelled=true;}});
 const raw=new Request('http://localhost/api/communication',{method:'POST',body:stream,duplex:'half'});
 const context={req:{raw,text:()=>raw.text()}};
 await assert.rejects(()=>workflowBody(context,[]),error=>error.code==='request_too_large');
 assert.ok(pulls<20,`consumed ${pulls} chunks before enforcing size limit`);assert.equal(cancelled,true);
});

test('subject spreadsheet preview and confirmation preserve false reporting and average flags',async t=>{
 const f=financeFixture(t);
 for(const value of [false,0]){
  const response=await app.request('http://localhost/api/import-export/subjects/preview',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({school_id:1,mode:'update_existing',rows:[{subject_name:'Math',class_name:'Class A',counts_in_average:value,appears_in_report_card:value}]})},{DB:f.d1,JWT_SECRET:secret,APP_ENV:'test'});
  const preview=await response.json();assert.equal(response.status,200);assert.equal(preview.data.errors.length,0,JSON.stringify(preview));assert.equal(preview.data.valid[0].data.counts_in_average,false);assert.equal(preview.data.valid[0].data.appears_in_report_card,false);
  const confirmed=await app.request('http://localhost/api/import-export/subjects/confirm',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({school_id:1,mode:'update_existing',rows:preview.data.valid})},{DB:f.d1,JWT_SECRET:secret,APP_ENV:'test'});
  const result=await confirmed.json();assert.equal(result.data.updated_count,1,JSON.stringify(result));
  const subject=f.db.prepare('SELECT counts_in_average,appears_in_report_card FROM subjects WHERE id=1').get();assert.equal(subject.counts_in_average,0);assert.equal(subject.appears_in_report_card,0);
 }
});

test('dashboard counts only active users in the selected school',async t=>{
 const f=financeFixture(t);
 f.db.exec("INSERT INTO users(id,school_id,full_name,email,role_id,status) VALUES(20,1,'Inactive','inactive@audit.test',5,'inactive'),(21,2,'Foreign','foreign@audit.test',5,'active')");
 const response=await app.request('http://localhost/api/dashboard/stats?school_id=1',{headers:{Authorization:`Bearer ${token}`}},{DB:f.d1,JWT_SECRET:secret,APP_ENV:'test'});
 const r=await response.json();assert.equal(response.status,200,JSON.stringify(r));assert.equal(r.data.active_users,7);assert.equal(r.data.total_users,8);
});

test('bounded workflow parsing preserves Arabic text split across UTF-8 chunks and accepts valid small requests',async()=>{
 const value={title:'تقرير متابعة الطالب',body:'ملاحظات دراسية'},encoded=new TextEncoder().encode(JSON.stringify(value));let offset=0;
 const stream=new ReadableStream({pull(controller){if(offset===encoded.length){controller.close();return;}controller.enqueue(encoded.slice(offset,offset+1));offset++;}});
 const raw=new Request('http://localhost/api/communication',{method:'POST',body:stream,duplex:'half'});
 assert.deepEqual(await workflowBody({req:{raw,text:()=>raw.text()}},['title','body']),value);
 const overLimit=new Request('http://localhost/api/communication',{method:'POST',headers:{'Content-Length':'200000'},body:'{}'});
 await assert.rejects(()=>workflowBody({req:{raw:overLimit,text:()=>overLimit.text()}},[]),error=>error.code==='request_too_large');
});
