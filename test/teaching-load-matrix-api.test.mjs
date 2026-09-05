import assert from 'node:assert/strict';
import test, {after} from 'node:test';
import { createServer } from 'vite';
import { signJWT } from '../src/lib/jwtSecurity.ts';
import { fixture,root,entry,snapshot,revision,addAvailability,addConstraints } from './helpers/teaching-load-matrix-fixture.mjs';
import { loadTeachingLoadMatrix,loadMatrixCopySource,buildMatrixApplyStatements,publicTeachingLoadMatrix } from '../src/lib/teachingLoadMatrixDb.ts';
import { planTeachingLoadMatrix,planTeachingLoadCopy } from '../src/lib/teachingLoadMatrix.ts';

const vite=await createServer({root,appType:'custom',server:{middlewareMode:true,hmr:false}});
const {default:app}=await vite.ssrLoadModule('/src/worker.ts');
after(()=>vite.close());
const secret='matrix-api-local-only-testing-secret-more-than-32-characters';
const tokens=Object.fromEntries(await Promise.all(['owner','admin','teacher','accountant','principal','vice','registrar'].map(async r=>[r,await signJWT({email:r+'@matrix.test',auth_version:1},secret)])));
const prefix='/api/timetable/teaching-load-matrix';
const up=(subject_id=1,section_id=1,employee_id=1,weekly_periods=4)=>({subject_id,section_id,employee_id,weekly_periods,action:'upsert'});
const body=(f,changes=[up()])=>({school_id:1,academic_year_id:1,class_id:1,expected_revision:revision(f.db),changes});
async function call(f,method,path,input,role='owner'){
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
 const measure=async(fn)=>{f.d1.sql=[];const start=performance.now();const result=await fn();return {result,queries:f.d1.sql.length,ms:+(performance.now()-start).toFixed(2)};};
 const load=await measure(()=>loadTeachingLoadMatrix(f.d1,1,1,10));assert.equal(load.queries,12);
 const changes=Array.from({length:subjectCount},(_,i)=>Array.from({length:sectionCount},(_,s)=>up(100+i,100+s,1,3))).flat();
 const preview=await measure(async()=>planTeachingLoadMatrix(await loadTeachingLoadMatrix(f.d1,1,1,10),changes));assert.equal(preview.queries,12);
 const copy=await measure(async()=>planTeachingLoadCopy(await loadTeachingLoadMatrix(f.d1,1,1,10),await loadMatrixCopySource(f.d1,1,2,10),'periods_only'));assert.equal(copy.queries,14);
 const httpRead=await measure(()=>call(f,'GET',prefix+'?school_id=1&academic_year_id=1&class_id=10'));
 const httpPreview=await measure(()=>call(f,'POST',prefix+'/preview',{...body(f,changes),class_id:10}));
 const httpCopy=await measure(()=>call(f,'POST',prefix+'/copy-preview',{school_id:1,target_academic_year_id:1,source_academic_year_id:2,class_id:10,copy_mode:'periods_only'}));
 for(const operation of [httpRead,httpPreview,httpCopy])assert.equal(operation.result.status,200);
 assert.equal(httpRead.queries,14);assert.equal(httpPreview.queries,15);assert.equal(httpCopy.queries,17);
 const start=performance.now();const statements=buildMatrixApplyStatements(f.d1,{school_id:1,academic_year_id:1,class_id:10},preview.result,1);await f.d1.batch(statements);
 assert.equal(statements.length,subjectCount*sectionCount+4);
 t.diagnostic(JSON.stringify({size:[subjectCount,sectionCount],load_queries:load.queries,preview_queries:preview.queries,copy_queries:copy.queries,
 http_queries:[httpRead.queries,httpPreview.queries,httpCopy.queries],http_ms:[httpRead.ms,httpPreview.ms,httpCopy.ms],
 apply_statements:statements.length,load_ms:load.ms,preview_ms:preview.ms,copy_ms:copy.ms,apply_ms:+(performance.now()-start).toFixed(2),load_bytes:Buffer.byteLength(JSON.stringify(publicTeachingLoadMatrix(load.result))),preview_bytes:Buffer.byteLength(JSON.stringify(preview.result)),copy_bytes:Buffer.byteLength(JSON.stringify(copy.result))}));
});
