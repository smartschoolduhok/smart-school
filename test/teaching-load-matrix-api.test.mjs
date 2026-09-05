import assert from 'node:assert/strict';
import test, {after} from 'node:test';
import { createServer } from 'vite';
import { signJWT } from '../src/lib/jwtSecurity.ts';
import { fixture,root,entry,snapshot,revision,addAvailability,addConstraints,benchmarkMatrix,invalidateAssignedTeacher } from './helpers/teaching-load-matrix-fixture.mjs';
import { loadTeachingLoadMatrix,loadMatrixCopySource,buildMatrixApplyStatements,publicTeachingLoadMatrix } from '../src/lib/teachingLoadMatrixDb.ts';
import { planTeachingLoadMatrix,planTeachingLoadCopy,matrixClassCards } from '../src/lib/teachingLoadMatrix.ts';

const vite=await createServer({root,appType:'custom',server:{middlewareMode:true,hmr:false}});
const {default:app}=await vite.ssrLoadModule('/src/worker.ts');
after(()=>vite.close());
const secret='matrix-api-local-only-testing-secret-more-than-32-characters';
const tokens=Object.fromEntries(await Promise.all(['owner','admin','teacher','accountant','principal','vice','registrar'].map(async r=>[r,await signJWT({email:r+'@matrix.test',auth_version:1},secret)])));
const prefix='/api/timetable/teaching-load-matrix';
const up=(subject_id=1,section_id=1,employee_id=1,weekly_periods=4)=>({subject_id,section_id,employee_id,weekly_periods,action:'upsert'});
const body=(f,changes=[up()])=>({school_id:1,academic_year_id:1,class_id:1,expected_revision:revision(f.db),changes});
async function call(f,method,path,input,role='owner'){
 f.d1.resetQueryBudget(50); // Count each executed statement, including batch members and auth reads.
 const r=await app.request('http://localhost'+path,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+tokens[role]},body:input===undefined?undefined:JSON.stringify(input)},{DB:f.d1,JWT_SECRET:secret,APP_ENV:'test'});
 return {status:r.status,body:await r.json()};
}
test('genuine schema GET/readiness work; preview deterministic and read-only; copy is read-only',async()=>{
 const f=fixture();const before=snapshot(f.db);
 const read=await call(f,'GET',prefix+'?school_id=1&academic_year_id=1&class_id=1');assert.equal(read.status,200);assert.equal(read.body.data.summary.expected,5);
 assert.equal((await call(f,'GET','/api/timetable/readiness?school_id=1&academic_year_id=1')).status,200);
 const p=await call(f,'POST',prefix+'/preview',body(f,[up(2,1),up()]));assert.equal(p.status,200);assert.equal(p.body.data.can_apply,true);
 const p2=await call(f,'POST',prefix+'/preview',body(f,[up(),up(2,1)]));assert.deepEqual(p2.body,p.body);
 const copy=await call(f,'POST',prefix+'/copy-preview',{school_id:1,target_academic_year_id:1,source_academic_year_id:2,class_id:1,copy_mode:'periods_only'});
 assert.equal(copy.status,200);assert.equal(copy.body.data.changes.length,2);
 assert.deepEqual(snapshot(f.db),before);
});

for(const populated of [false,true])test(`complete HTTP 500 ${populated?'teacher updates':'creates'} uses Free-tier budget with headroom`,async(t)=>{
 const f=fixture();const changes=benchmarkMatrix(f.db,50,10,populated);const before=snapshot(f.db);
 const input={...body(f,changes),class_id:10,confirm_apply:true};
 const start=performance.now();const result=await call(f,'POST',prefix+'/apply',input,'admin');
 assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.body.data.counts[populated?'update':'create'],500);
 assert.equal(f.d1.executions.length,populated?21:20);assert.ok(f.d1.executions.every(s=>s.parameters<=5));
 const after=snapshot(f.db);const affected=after.timetable_teaching_loads.filter(l=>l.class_id===10);
 assert.equal(affected.length,500);assert.ok(affected.every(l=>l.employee_id===(populated?2:1)&&l.updated_by_user_id===2));
 if(populated) assert.deepEqual(affected.map(l=>l.id),before.timetable_teaching_loads.filter(l=>l.class_id===10).map(l=>l.id));
 else assert.ok(affected.every(l=>l.created_by_user_id===2));
 assert.deepEqual(after.timetable_teaching_loads.filter(l=>l.class_id!==10),before.timetable_teaching_loads.filter(l=>l.class_id!==10));
 t.diagnostic(JSON.stringify({changes:500,kind:populated?'updates':'creates',http_queries:f.d1.executions.length,batch_statements:f.d1.batchSizes.at(-1),max_parameters:Math.max(...f.d1.executions.map(s=>s.parameters)),http_ms:+(performance.now()-start).toFixed(2),payload_bytes:Buffer.byteLength(JSON.stringify(input))}));
});

test('mixed creates/updates/deactivation/unchanged plus coupled swap: late failure rolls back every effect',async(t)=>{
 const f=fixture();f.db.exec('UPDATE timetable_teaching_loads SET employee_id=1 WHERE id=1');entry(f.db,1,1,1);entry(f.db,2,1);
 f.db.exec("INSERT INTO timetable_teaching_loads(id,school_id,academic_year_id,class_id,section_id,subject_id,employee_id,weekly_periods,status) VALUES(20,1,1,1,1,3,NULL,2,'active')");
 f.db.exec("INSERT INTO timetable_teaching_loads(id,school_id,academic_year_id,class_id,section_id,subject_id,employee_id,weekly_periods,status) VALUES(21,1,1,1,2,2,6,2,'active')");
 const input={...body(f,[up(1,1,2),up(1,2,1),up(2,1,null,3),up(2,2,6,2),{subject_id:3,section_id:1,action:'deactivate'}]),confirm_apply:true};
 const before=snapshot(f.db);
 // Failure at response SELECT, AFTER clear/create/update/deactivate/audit/revision/cleanup.
 f.d1.failAt=7;const fail=await call(f,'POST',prefix+'/apply',input);assert.equal(fail.status,500);assert.deepEqual(snapshot(f.db),before);
 f.d1.failAt=null;const ok=await call(f,'POST',prefix+'/apply',input);assert.equal(ok.status,200,JSON.stringify(ok));
 assert.deepEqual(ok.body.data.counts,{create:1,update:2,deactivate:1,unchanged:1,blocked:0});
 assert.equal(f.d1.executions.length,23);assert.equal(f.d1.batchSizes.at(-1),8);
 const after=snapshot(f.db);assert.equal(after.timetable_teaching_loads.find(l=>l.id===1).employee_id,2);assert.equal(after.timetable_teaching_loads.find(l=>l.id===2).employee_id,1);
 assert.equal(after.timetable_teaching_loads.find(l=>l.id===20).status,'inactive');assert.deepEqual(after.timetable_teaching_loads.find(l=>l.id===21),before.timetable_teaching_loads.find(l=>l.id===21));
 assert.deepEqual(after.timetable_entries,before.timetable_entries);assert.ok(ok.body.data.revision>input.expected_revision);
 assert.deepEqual(after.timetable_teaching_loads.filter(l=>l.class_id!==1||l.academic_year_id!==1),before.timetable_teaching_loads.filter(l=>l.class_id!==1||l.academic_year_id!==1));
 t.diagnostic('Mixed + unchanged + coupled swap: HTTP 23 queries, 8 batch statements, max 5 parameters. Late rollback verified.');
});

for(const kind of ['archived','nonteacher','other-school','missing'])test(`HTTP ${kind} teacher: cards/matrix/preview agree, no writes or leaked names, explicit repair only`,async()=>{
 const f=fixture();invalidateAssignedTeacher(f.db,kind);const before=snapshot(f.db);
 const matrix=await call(f,'GET',prefix+'?school_id=1&academic_year_id=1&class_id=1');assert.equal(matrix.status,200);
 const list=await call(f,'GET','/api/timetable/teaching-loads?school_id=1&academic_year_id=1');assert.equal(list.status,200);
 const cards=matrixClassCards(f.db.prepare('SELECT * FROM classes WHERE school_id=1').all(),f.db.prepare('SELECT * FROM sections WHERE school_id=1').all(),f.db.prepare('SELECT * FROM subjects WHERE school_id=1').all(),list.body.data);
 assert.deepEqual(cards.find(c=>c.id===1).summary,matrix.body.data.summary);
 const summary=matrix.body.data.summary;assert.equal(summary.invalid_teacher,1);assert.equal(summary.without_teacher,1);assert.equal(summary.configured,2);assert.equal(summary.missing,3);assert.equal(summary.weekly_periods,8);assert.equal(summary.completion_percent,0);
 assert.equal(matrix.body.data.loads.find(l=>l.id===2).employee_id,2);assert.ok(!JSON.stringify([matrix,list]).includes('Secret'));
 const unchanged=await call(f,'POST',prefix+'/preview',body(f,[up(1,1,null)]));assert.equal(unchanged.body.data.invalid_teacher_after,1);assert.deepEqual(unchanged.body.data.summary_after,summary);
 const input=body(f,[up(1,2,1)]);const preview=await call(f,'POST',prefix+'/preview',input);
 assert.equal(preview.body.data.can_apply,true);assert.equal(preview.body.data.invalid_teacher_after,0);assert.equal(preview.body.data.summary_after.completion_percent,20);
 assert.equal(preview.body.data.total_weekly_periods_after,8);assert.deepEqual(snapshot(f.db),before);
 const repaired=await call(f,'POST',prefix+'/apply',{...input,confirm_apply:true});assert.equal(repaired.status,200,JSON.stringify(repaired));
 const read=await call(f,'GET',prefix+'?school_id=1&academic_year_id=1&class_id=1');assert.deepEqual(read.body.data.summary,preview.body.data.summary_after);
 assert.equal(read.body.data.loads.find(l=>l.id===2).employee_id,1);assert.equal(read.body.data.summary.configured,2);
});
for(const role of ['owner','admin','principal','vice','registrar'])test(`RBAC allows ${role} scoped matrix read/preview/apply`,async()=>{
 const f=fixture();const input={...body(f),confirm_apply:true};
 assert.equal((await call(f,'GET',prefix+'?school_id=1&academic_year_id=1&class_id=1',undefined,role)).status,200);
 const result=await call(f,'POST',prefix+'/apply',input,role);
 assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.body.data.applied,true);
});
for(const role of ['teacher','accountant'])test(`RBAC forbids ${role} on every matrix endpoint`,async()=>{
 const f=fixture();const before=snapshot(f.db);
 for(const [method,path,input] of [['GET',prefix+'?school_id=1&academic_year_id=1&class_id=1'],['POST',prefix+'/preview',body(f)],['POST',prefix+'/apply',{...body(f),confirm_apply:true}],['POST',prefix+'/copy-preview',{}]])
  assert.equal((await call(f,method,path,input,role)).status,403);
 assert.deepEqual(snapshot(f.db),before);
});
test('admin requires explicit school; tenant cannot override JWT school; inactive school blocked',async()=>{
 const f=fixture();const input=body(f);delete input.school_id;
 assert.equal((await call(f,'GET',prefix+'?academic_year_id=1&class_id=1',undefined,'admin')).status,400);
 assert.equal((await call(f,'POST',prefix+'/preview',input,'admin')).status,400);
 assert.equal((await call(f,'POST',prefix+'/preview',input,'owner')).status,200);
 assert.equal((await call(f,'POST',prefix+'/preview',{...input,school_id:2})).status,403);
 f.db.exec("UPDATE schools SET status='archived' WHERE id=1");
 assert.equal((await call(f,'POST',prefix+'/apply',{...body(f),confirm_apply:true},'admin')).status,400);
});
for(const dimension of ['class_id','academic_year_id'])test(`foreign vs missing ${dimension} indistinguishable, no foreign names`,async()=>{
 const f=fixture();const input=body(f);
 const foreign=await call(f,'POST',prefix+'/preview',{...input,[dimension]:3});
 const missing=await call(f,'POST',prefix+'/preview',{...input,[dimension]:99999});
 assert.equal(foreign.status,404);assert.deepEqual(foreign,missing);assert.ok(!JSON.stringify(foreign).includes('Secret'));
});
test('foreign/missing subject/section/teacher references use identical scoped results; mixed apply rejected fully',async()=>{
 const f=fixture();const before=snapshot(f.db);
 for(const [key,foreign] of [['subject_id',5],['section_id',3],['employee_id',5]]){
  const a=await call(f,'POST',prefix+'/preview',body(f,[{...up(),[key]:foreign}]));
  const b=await call(f,'POST',prefix+'/preview',body(f,[{...up(),[key]:99999}]));
  assert.equal(a.body.data.can_apply,false);assert.deepEqual(a.body.data.items[0].blockers,b.body.data.items[0].blockers);
  assert.ok(!JSON.stringify(a).includes('Secret'));
 }
 const r=await call(f,'POST',prefix+'/apply',{...body(f,[up(),up(5,2)]),confirm_apply:true});
 assert.equal(r.status,409);assert.deepEqual(snapshot(f.db),before);
});
test('foreign/missing copy source generic404; identical years invalid',async()=>{
 const f=fixture();const b={school_id:1,target_academic_year_id:1,source_academic_year_id:3,class_id:1,copy_mode:'periods_only'};
 const a=await call(f,'POST',prefix+'/copy-preview',b);
 assert.equal(a.status,404);assert.deepEqual(a,await call(f,'POST',prefix+'/copy-preview',{...b,source_academic_year_id:999}));
 assert.equal((await call(f,'POST',prefix+'/copy-preview',{...b,source_academic_year_id:1})).status,400);
});
test('apply revalidates, explicit confirmation, truthful create/update/deactivate and stale replay prevention',async()=>{
 const f=fixture();const input=body(f,[up(),up(2,1,null,2),{subject_id:1,section_id:2,action:'deactivate'}]);
 const before=snapshot(f.db);assert.equal((await call(f,'POST',prefix+'/apply',input)).status,400);assert.deepEqual(snapshot(f.db),before);
 const r=await call(f,'POST',prefix+'/apply',{...input,confirm_apply:true});assert.equal(r.status,200);
 assert.deepEqual(r.body.data.counts,{create:1,update:1,deactivate:1,unchanged:0,blocked:0});
 const after=snapshot(f.db);
 const stale=await call(f,'POST',prefix+'/apply',{...input,confirm_apply:true});
 assert.equal(stale.status,409);assert.equal(stale.body.code,'stale_teaching_load_matrix');assert.deepEqual(snapshot(f.db),after);
});
test('all-unchanged apply consumes revision, cannot replay same tab revision',async()=>{
 const f=fixture();const input={...body(f,[up(1,1,null)]),confirm_apply:true};
 const a=await call(f,'POST',prefix+'/apply',input);assert.equal(a.status,200);assert.equal(a.body.data.counts.unchanged,1);
 assert.equal((await call(f,'POST',prefix+'/apply',input)).body.code,'stale_teaching_load_matrix');
});
test('race between canonical read and atomic apply rejects via in-batch assertion',async()=>{
 const f=fixture();const input={...body(f),confirm_apply:true};
 f.d1.beforeWrite=()=>f.db.exec('UPDATE timetable_teaching_loads SET weekly_periods=5 WHERE id=2');
 const r=await call(f,'POST',prefix+'/apply',input);
 assert.equal(r.status,409);assert.equal(r.body.code,'stale_teaching_load_matrix');assert.equal(f.db.prepare('SELECT employee_id FROM timetable_teaching_loads WHERE id=1').get().employee_id,null);
});
test('HTTP bulk coupled swap and rollback of an injected middle failure',async()=>{
 const f=fixture();f.db.exec('UPDATE timetable_teaching_loads SET employee_id=1 WHERE id=1');entry(f.db,1,1,1);entry(f.db,2,1);
 const input={...body(f,[up(1,1,2),up(1,2,1)]),confirm_apply:true};const before=snapshot(f.db);
 f.d1.failAt=3;const bad=await call(f,'POST',prefix+'/apply',input);assert.equal(bad.status,500);assert.ok(!JSON.stringify(bad).includes('injected'));assert.deepEqual(snapshot(f.db),before);
 f.d1.failAt=null;const good=await call(f,'POST',prefix+'/apply',input);assert.equal(good.status,200);assert.equal(good.body.data.counts.update,2);
 assert.deepEqual(snapshot(f.db).timetable_entries,before.timetable_entries);
});
for(const [label,setup,teacher,code] of [
 ['collision',f=>entry(f.db,3,1),6,'teacher_collision'],
 ['unavailability',f=>addAvailability(f.db,1,1,'unavailable'),1,'teacher_unavailable'],
 ['daily',f=>{entry(f.db,1,2);addConstraints(f.db,1,{max_periods_per_day:1});},1,'teacher_max_periods_per_day'],
 ['working days',f=>{entry(f.db,1,6);addConstraints(f.db,1,{max_working_days:1});},1,'teacher_max_working_days'],
 ['consecutive',f=>{entry(f.db,1,2);addConstraints(f.db,1,{max_consecutive_periods:1});},1,'teacher_max_consecutive_periods'],
])test(`individual API and bulk reject unsafe ${label} with clear errors`,async()=>{
 const f=fixture();entry(f.db,1,1);setup(f);const before=snapshot(f.db);
 const r=await call(f,'PUT','/api/timetable/teaching-loads/1',{school_id:1,academic_year_id:1,class_id:1,section_id:1,subject_id:1,employee_id:teacher,weekly_periods:4});
 assert.equal(r.status,409);assert.equal(r.body.code,code);assert.ok(!r.body.error.includes('timetable'));
 const bulk=await call(f,'POST',prefix+'/apply',{...body(f,[up(1,1,teacher)]),confirm_apply:true});
 assert.equal(bulk.status,409);assert.equal(bulk.body.data.can_apply,false);assert.deepEqual(snapshot(f.db),before);
});
test('individual API supports safe NULL to teacher, teacher swap, no-op and deliberate unassignment',async()=>{
 const f=fixture();entry(f.db,1,1,1);const rows=snapshot(f.db).timetable_entries;
 for(const employee_id of [1,2,2,null]){
  const r=await call(f,'PUT','/api/timetable/teaching-loads/1',{school_id:1,academic_year_id:1,class_id:1,section_id:1,subject_id:1,employee_id,weekly_periods:4});
  assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.body.data.employee_id,employee_id);assert.equal(r.body.data.updated_by_user_id,1);
 }
 assert.deepEqual(snapshot(f.db).timetable_entries,rows);
});
for(const [subjectCount,sectionCount] of [[3,2],[12,4],[20,8]])test(`bounded-query benchmark ${subjectCount} x ${sectionCount}`,async(t)=>{
 const f=fixture();
 f.db.exec("INSERT INTO classes(id,school_id,name,stage,order_index,status) VALUES(10,1,'Benchmark','ابتدائي',10,'active')");
 for(let s=0;s<sectionCount;s++)f.db.prepare("INSERT INTO sections(id,school_id,class_id,name,status) VALUES(?,1,10,?,'active')").run(100+s,'Section '+s);
 for(let i=0;i<subjectCount;i++){
  f.db.prepare("INSERT INTO subjects(id,school_id,class_id,name,status,order_index) VALUES(?,1,10,?,'active',?)").run(100+i,'Subject '+i,i);
  for(let s=0;s<sectionCount;s++)f.db.prepare("INSERT INTO timetable_teaching_loads(school_id,academic_year_id,class_id,section_id,subject_id,employee_id,weekly_periods,status) VALUES(1,2,10,?,?,1,3,'active')").run(100+s,100+i);
 }
 const measure=async(fn)=>{f.d1.resetQueryBudget(50);const start=performance.now();const result=await fn();return {result,queries:f.d1.executions.length,ms:+(performance.now()-start).toFixed(2)};};
 const load=await measure(()=>loadTeachingLoadMatrix(f.d1,1,1,10));assert.equal(load.queries,12);
 const changes=Array.from({length:subjectCount},(_,i)=>Array.from({length:sectionCount},(_,s)=>up(100+i,100+s,1,3))).flat();
 const preview=await measure(async()=>planTeachingLoadMatrix(await loadTeachingLoadMatrix(f.d1,1,1,10),changes));assert.equal(preview.queries,12);
 const copy=await measure(async()=>planTeachingLoadCopy(await loadTeachingLoadMatrix(f.d1,1,1,10),await loadMatrixCopySource(f.d1,1,2,10),'periods_only'));assert.equal(copy.queries,14);
 const httpRead=await measure(()=>call(f,'GET',prefix+'?school_id=1&academic_year_id=1&class_id=10'));
 const httpPreview=await measure(()=>call(f,'POST',prefix+'/preview',{...body(f,changes),class_id:10}));
 const httpCopy=await measure(()=>call(f,'POST',prefix+'/copy-preview',{school_id:1,target_academic_year_id:1,source_academic_year_id:2,class_id:10,copy_mode:'periods_only'}));
 for(const operation of [httpRead,httpPreview,httpCopy])assert.equal(operation.result.status,200);
 assert.equal(httpRead.queries,14);assert.equal(httpPreview.queries,15);assert.equal(httpCopy.queries,17);
 const statements=buildMatrixApplyStatements(f.d1,{school_id:1,academic_year_id:1,class_id:10},preview.result,1);
 assert.equal(statements.length,5);
 const httpApply=await measure(()=>call(f,'POST',prefix+'/apply',{...body(f,changes),class_id:10,confirm_apply:true}));
 assert.equal(httpApply.result.status,200,JSON.stringify(httpApply.result));assert.equal(httpApply.queries,20);
 assert.equal(httpApply.result.body.data.counts.create,subjectCount*sectionCount);
 t.diagnostic(JSON.stringify({size:[subjectCount,sectionCount],load_queries:load.queries,preview_queries:preview.queries,copy_queries:copy.queries,
 http_queries:[httpRead.queries,httpPreview.queries,httpCopy.queries],http_ms:[httpRead.ms,httpPreview.ms,httpCopy.ms],
 apply_statements:statements.length,http_apply_queries:httpApply.queries,max_parameters:Math.max(...f.d1.executions.map(s=>s.parameters)),load_ms:load.ms,preview_ms:preview.ms,copy_ms:copy.ms,apply_ms:httpApply.ms,load_bytes:Buffer.byteLength(JSON.stringify(publicTeachingLoadMatrix(load.result))),preview_bytes:Buffer.byteLength(JSON.stringify(preview.result)),copy_bytes:Buffer.byteLength(JSON.stringify(copy.result))}));
});
