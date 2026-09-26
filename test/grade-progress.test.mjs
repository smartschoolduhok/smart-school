import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import {createServer} from 'vite';
import {fixture,request,root,snapshot} from './helpers/school-workflow-fixture.mjs';
const vite=await createServer({root,appType:'custom',server:{middlewareMode:true,hmr:false}});
const {default:app}=await vite.ssrLoadModule('/src/worker.ts');after(()=>vite.close());
const req=(f,role,method,path,body)=>request(app,f,role,method,path,body);
function setup(t){const f=fixture(t);f.db.exec(`INSERT INTO grades(school_id,student_subject_id,first_month,notes) SELECT 1,id,80,'INTERNAL PRIVATE NOTE' FROM student_subjects WHERE school_id=1;`);return f;}
const input=(extra={})=>({school_id:1,student_id:101,period:'first_month',...extra});
async function preview(f,role='teacher',extra={}){const r=await req(f,role,'POST','/api/grade-progress/preview',input(extra));assert.equal(r.status,200,JSON.stringify(r));return r.data;}
async function publish(f,role='teacher',extra={}){const p=await preview(f,role,extra);const b={...input(extra),report_key:crypto.randomUUID(),preview_digest:p.preview_digest,confirm_delivered:true};const r=await req(f,role,'POST','/api/grade-progress/publish',b);assert.equal(r.status,201,JSON.stringify(r));return {r,b};}

test('preview is read-only, missing is not zero, teacher scope and roles enforced',async t=>{
 const f=setup(t),before=snapshot(f.db),p=await preview(f);assert.equal(p.snapshot.subjects[0].score,80);assert.deepEqual(snapshot(f.db),before);
 const term=await preview(f,'teacher',{period:'first_term'});assert.equal(term.snapshot.subjects[0].score,null);assert.equal(term.snapshot.missing_count,1);
 assert.equal((await req(f,'teacher','POST','/api/grade-progress/preview',input({student_id:102}))).status,403);
 assert.equal((await req(f,'parent','POST','/api/grade-progress/preview',input())).status,403);
 assert.equal((await req(f,'accountant','GET','/api/grade-progress')).status,403);
 assert.equal((await req(f,'owner','POST','/api/grade-progress/preview',input({school_id:2,student_id:103}))).status,403);
 assert.equal((await req(f,'admin','GET','/api/grade-progress')).status,400);
});
test('publish requires student delivery; linked parent gets immutable safe snapshot and notification',async t=>{
 const f=setup(t),p=await preview(f),before=snapshot(f.db);const b={...input(),report_key:crypto.randomUUID(),preview_digest:p.preview_digest};
 assert.equal((await req(f,'teacher','POST','/api/grade-progress/publish',b)).status,400);assert.deepEqual(snapshot(f.db),before);
 const {r}=await publish(f),feed=await req(f,'parent','GET','/api/grade-progress');assert.equal(feed.data.reports.length,1);
 assert.equal(JSON.stringify(feed).includes('INTERNAL'),false);assert.equal(JSON.stringify(feed).includes('source_json'),false);
 assert.equal((await req(f,'otherParent','GET','/api/grade-progress')).data.reports.length,0);
 assert.equal((await req(f,'foreignParent','GET','/api/grade-progress')).data.reports.length,0);
 for(const path of ['/api/grades','/api/students/101/grades','/api/grades/1/history'])assert.equal((await req(f,'parent','GET',path)).status,403);
 f.db.exec('UPDATE grades SET first_month=40,revision=revision+1');
 assert.equal((await req(f,'parent','GET','/api/grade-progress')).data.reports[0].snapshot.subjects[0].score,80);
 assert.equal((await req(f,'parent','GET','/api/notifications')).data.notifications[0].reference_type,'grade_progress');
 assert.throws(()=>f.db.exec("UPDATE grade_progress_reports SET snapshot_json='{}'"),/immutable/);
 assert.throws(()=>f.db.exec('DELETE FROM grade_progress_audit'),/immutable/);
 assert.equal(r.data.status,'published');assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});
test('stale source, changed settings and atomic revocation cannot publish',async t=>{
 const f=setup(t),p=await preview(f);f.db.exec('UPDATE grades SET first_month=70,revision=revision+1');
 const b={...input(),report_key:crypto.randomUUID(),preview_digest:p.preview_digest,confirm_delivered:true};
 assert.equal((await req(f,'teacher','POST','/api/grade-progress/publish',b)).status,409);
 const fresh=await preview(f);f.d1.beforeWrite=()=>f.db.exec("UPDATE teacher_employee_links SET status='inactive' WHERE teacher_user_id=3");
 const r=await req(f,'teacher','POST','/api/grade-progress/publish',{...b,preview_digest:fresh.preview_digest});assert.equal(r.status,409,JSON.stringify(r));assert.equal(f.db.prepare('SELECT count(*) n FROM grade_progress_reports').get().n,0);
});
test('exact publish retry creates one report; withdrawal hides snapshot and notification without altering grades',async t=>{
 const f=setup(t),{r,b}=await publish(f);const before=snapshot(f.db);
 assert.equal((await req(f,'teacher','POST','/api/grade-progress/publish',b)).status,200);assert.deepEqual(snapshot(f.db),before);
 const path=`/api/grade-progress/${r.data.report_key}/withdraw`;
 assert.equal((await req(f,'parent','POST',path,{revision:1,reason:'x'})).status,403);
 assert.equal((await req(f,'teacher','POST',path,{revision:1,reason:''})).status,400);
 assert.equal((await req(f,'teacher','POST',path,{revision:1,reason:'تصحيح الدرجات'})).status,200);
 assert.equal((await req(f,'parent','GET','/api/grade-progress')).data.reports.length,0);assert.equal((await req(f,'parent','GET','/api/notifications')).data.notifications.length,0);
 assert.deepEqual(snapshot(f.db).grades,before.grades);assert.deepEqual(snapshot(f.db).result_cards,before.result_cards);
 assert.equal(f.db.prepare('SELECT count(*) n FROM grade_progress_audit').get().n,2);
});
test('parent link revocation immediately hides published progress',async t=>{
 const f=setup(t);await publish(f);f.db.exec("UPDATE parent_student_links SET status='inactive' WHERE parent_user_id=8");
 assert.equal((await req(f,'parent','GET','/api/grade-progress')).data.reports.length,0);assert.equal((await req(f,'parent','GET','/api/notifications')).data.notifications.length,0);
});
test('revoked teacher cannot retrieve a report by replaying its publication request',async t=>{
 const f=setup(t),{b}=await publish(f);f.db.exec("UPDATE teacher_employee_links SET status='inactive' WHERE teacher_user_id=3");const before=snapshot(f.db);
 assert.equal((await req(f,'teacher','GET','/api/grade-progress')).data.reports.length,0);
 assert.equal((await req(f,'teacher','POST','/api/grade-progress/publish',b)).status,404);assert.deepEqual(snapshot(f.db),before);
});
test('mid-batch failure rolls back report, audit and notifications',async t=>{
 const f=setup(t),p=await preview(f),before=snapshot(f.db);f.d1.failAt=3;
 assert.equal((await req(f,'teacher','POST','/api/grade-progress/publish',{...input(),report_key:crypto.randomUUID(),preview_digest:p.preview_digest,confirm_delivered:true})).status,503);
 assert.deepEqual(snapshot(f.db),before);
});
