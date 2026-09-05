import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import {createServer} from 'vite';
import {signJWT} from '../src/lib/jwtSecurity.ts';
import {periodValues,bellTime,minuteOfDay} from '../src/lib/weekSetup.ts';
import {root,weekFixture,request,example,maximum,snapshot,revision,assertPreserved,addAvailability,entry,historySQL} from './helpers/week-setup-fixture.mjs';
const vite=await createServer({root,appType:'custom',server:{middlewareMode:true,hmr:false}});
const {default:app}=await vite.ssrLoadModule('/src/worker.ts');after(()=>vite.close());
const secret='week-local-generated-only-test-secret-over-32-characters';
const tokens=Object.fromEntries(await Promise.all(['owner','admin','teacher','accountant','principal','vice','registrar'].map(async role=>[role,await signJWT({email:role+'@matrix.test',auth_version:1},secret)])));
const prefix='/api/timetable/week-setup';
async function call(f,method,suffix='',input,role='owner') {
 f.d1.resetQueryBudget(49);
 const r=await app.request('http://localhost'+prefix+suffix,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+tokens[role]},body:input===undefined?undefined:JSON.stringify(input)},{DB:f.d1,JWT_SECRET:secret,APP_ENV:'test'});
 return {status:r.status,body:await r.json()};
}
async function prepare(f,input,role='owner') {
 const p=await call(f,'POST','/preview',input,role);assert.equal(p.status,200,JSON.stringify(p));
 return {plan:p.body.data,input:{...input,confirm_apply:true,preview_digest:p.body.data.preview_digest}};
}
const apply=(f,input,role)=>call(f,'POST','/apply',input,role);

for(const role of ['owner','admin','principal','vice','registrar'])test(`${role} can read, preview and explicitly apply authorized school/year`,async t=>{
 const f=weekFixture(t),before=snapshot(f.db);const read=await call(f,'GET','?school_id=1&academic_year_id=1',undefined,role);assert.equal(read.status,200,JSON.stringify(read));assert.equal(read.body.data.summary.length,7);assert.equal(read.body.data.periods.length,7);
 const p=await prepare(f,request(f),role);assert.equal(p.plan.can_apply,true);assert.deepEqual(snapshot(f.db),before);
 const result=await apply(f,p.input,role);assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.body.data.counts.create,9);assert.equal(result.body.data.counts.activated,1);assert.equal(result.body.data.applied,true);assert.ok(result.body.data.revision>p.input.expected_revision);assertPreserved(before,snapshot(f.db));
});
for(const role of ['teacher','accountant'])test(`${role} cannot read/preview/apply week setup`,async t=>{
 const f=weekFixture(t),before=snapshot(f.db);
 for(const [method,suffix,body] of [['GET','?school_id=1&academic_year_id=1'],['POST','/preview',request(f)],['POST','/apply',{...request(f),confirm_apply:true,preview_digest:'a'.repeat(64)}]])assert.equal((await call(f,method,suffix,body,role)).status,403);
 assert.deepEqual(snapshot(f.db),before);
});
test('admin explicit active school; tenant JWT scope fixed; foreign/missing years indistinguishable',async t=>{
 const f=weekFixture(t),before=snapshot(f.db);
 const noSchool=request(f);delete noSchool.school_id;
 assert.equal((await call(f,'POST','/preview',noSchool,'admin')).status,400);
 assert.equal((await call(f,'POST','/preview',noSchool)).status,200);
 assert.equal((await call(f,'POST','/preview',{...request(f),school_id:2})).status,403);
 const foreign=await call(f,'POST','/preview',{...request(f),academic_year_id:3});
 const missing=await call(f,'POST','/preview',{...request(f),academic_year_id:9999});assert.equal(foreign.status,404);assert.deepEqual(foreign,missing);assert.ok(!JSON.stringify(foreign).includes('Secret'));
 for(const query of ['?school_id=1&academic_year_id=1&extra=1','?school_id=1&academic_year_id=1&academic_year_id=2','?school_id=1&academic_year_id=1.0'])assert.equal((await call(f,'GET',query)).status,400);
 f.db.exec("UPDATE schools SET status='archived' WHERE id=2");assert.equal((await call(f,'POST','/preview',{...request(f),school_id:2,academic_year_id:3},'admin')).status,400);
 assertPreserved(before,snapshot(f.db),['schools']);
});
test('unknown destination IDs/fields, source-target collision, oversized payload, malformed confirm reject with no writes',async t=>{
 const f=weekFixture(t),before=snapshot(f.db);
 for(const input of [null,[],{...request(f),slot_ids:[1]},{...request(f),targets:[{day_of_week:3,activate_day:true,id:1}]},{...request(f),source_day_of_week:3},{...request(f),template:[{...example()[0],label:'x'.repeat(33000)}]}]){
  const p=await call(f,'POST','/preview',input);assert.ok([400,413].includes(p.status),JSON.stringify(p));
 }
 const p=await prepare(f,request(f));
 for(const patch of [{confirm_apply:false},{preview_digest:'wrong'},{preview_digest:'f'.repeat(64)},{acknowledge_availability_impact:1}])assert.ok([400,409].includes((await apply(f,{...p.input,...patch})).status));
 assert.deepEqual(snapshot(f.db),before);
});
test('deterministic digest binds scope/request/plan; template/targets/mode edits invalidate it',async t=>{
 const f=weekFixture(t),input=request(f,example(),[3,4]),before=snapshot(f.db);const p=await prepare(f,input);
 const reversed=await prepare(f,{...input,targets:[...input.targets].reverse(),template:[...input.template].reverse()});assert.equal(reversed.plan.preview_digest,p.plan.preview_digest);
 for(const patch of [{targets:[input.targets[0]]},{template:input.template.map((p,i)=>i? p:{...p,label:'edit'})},{mode:'update_matching_keep_extra'}])assert.equal((await apply(f,{...p.input,...patch})).body.code,'week_preview_mismatch');
 assert.deepEqual(snapshot(f.db),before);
});
test('copy retains saved gaps/numbering/inactive source; no source writes or copied slot IDs',async t=>{
 const f=weekFixture(t);f.db.exec('UPDATE timetable_slots SET is_active=0 WHERE id=2');
 const get=await call(f,'GET','?school_id=1&academic_year_id=1'),source=get.body.data.periods.filter(s=>s.day_of_week===0),before=snapshot(f.db);
 const p=await prepare(f,{...request(f,source.map(periodValues),[4,6]),source_day_of_week:0});const result=await apply(f,p.input);assert.equal(result.status,200,JSON.stringify(result));
 const after=snapshot(f.db);assert.deepEqual(after.timetable_slots.filter(s=>s.day_of_week===0),before.timetable_slots.filter(s=>s.day_of_week===0));
 for(const day of [4,6]){const dest=after.timetable_slots.filter(s=>s.school_id===1&&s.academic_year_id===1&&s.day_of_week===day).sort((a,b)=>a.slot_index-b.slot_index);assert.deepEqual(dest.map(periodValues),source.map(periodValues));assert.ok(dest.every(s=>!source.some(o=>s.id===o.id)));}
 assertPreserved(before,after);
});
test('all-skipped and refreshed repeats have true no-change results and zero revision/timestamp churn',async t=>{
 const f=weekFixture(t);const p=await prepare(f,request(f,example(),[0,3]));let r=await apply(f,p.input);assert.equal(r.body.data.counts.skipped,1);assert.equal(r.body.data.counts.create,9);
 const before=snapshot(f.db),next=await prepare(f,request(f,example(),[0,3]));r=await apply(f,next.input);assert.equal(r.status,200);assert.equal(r.body.data.applied,false);assert.equal(r.body.data.no_change,true);assert.equal(r.body.data.counts.skipped,2);assert.deepEqual(snapshot(f.db),before);assert.ok(f.d1.executions.every(e=>!/^\s*(INSERT|UPDATE|DELETE)/i.test(e.sql)));
 const saved=f.db.prepare('SELECT * FROM timetable_slots WHERE school_id=1 AND academic_year_id=1 AND day_of_week=0 ORDER BY slot_index').all().map(periodValues);
 const exact=await prepare(f,request(f,saved,[0],'update_matching_keep_extra'));r=await apply(f,exact.input);assert.equal(r.body.data.counts.unchanged,5);assert.equal(r.body.data.applied,false);assert.deepEqual(snapshot(f.db),before);
});
test('one blocked day rejects the entire group including otherwise-empty activation',async t=>{
 const f=weekFixture(t),before=snapshot(f.db),input=request(f,example(),[0,3],'update_matching_keep_extra'),p=await prepare(f,input);assert.equal(p.plan.can_apply,false);
 assert.equal((await apply(f,p.input)).body.code,'blocked_week_setup');assert.deepEqual(snapshot(f.db),before);
});
test('inactive-only saved day is skipped without activating it or churning timestamps',async t=>{
 const f=weekFixture(t);f.db.exec('UPDATE timetable_slots SET is_active=0 WHERE id=6; UPDATE timetable_days SET is_active=0 WHERE school_id=1 AND academic_year_id=1 AND day_of_week=1');
 const before=snapshot(f.db),p=await prepare(f,{...request(f,example(),[1]),targets:[{day_of_week:1,activate_day:true}]});
 const r=await apply(f,p.input);assert.equal(r.status,200);assert.equal(r.body.data.no_change,true);assert.equal(r.body.data.counts.skipped,1);assert.equal(r.body.data.counts.activated,0);assert.deepEqual(snapshot(f.db),before);
});
test('scheduled lesson identity cannot be converted into a break even with acknowledgement',async t=>{
 const f=weekFixture(t);entry(f.db,2,1,1);const slots=f.db.prepare('SELECT * FROM timetable_slots WHERE school_id=1 AND academic_year_id=1 AND day_of_week=0 ORDER BY slot_index').all().map(periodValues),before=snapshot(f.db);
 slots[0]={...slots[0],slot_type:'break',lesson_number:null};
 const p=await prepare(f,request(f,slots,[0],'update_matching_keep_extra'));assert.ok(p.plan.days[0].blockers.some(n=>n.code==='slot_has_scheduled_entries'));
 assert.equal((await apply(f,{...p.input,acknowledge_availability_impact:true})).status,409);assert.deepEqual(snapshot(f.db),before);
});
test('linked-time acknowledgement cannot bypass scheduled entries; permitted availability remains unchanged',async t=>{
 const f=weekFixture(t);addAvailability(f.db,2,1,'preferred');f.db.exec(historySQL);const before=snapshot(f.db),slot=periodValues(f.db.prepare('SELECT * FROM timetable_slots WHERE id=1').get());
 const p=await prepare(f,request(f,[{...slot,start_time:'07:50'}],[0],'update_matching_keep_extra'));assert.equal(p.plan.requires_availability_acknowledgement,true);
 assert.equal((await apply(f,p.input)).body.code,'availability_acknowledgement_required');assert.deepEqual(snapshot(f.db),before);
 const ok=await apply(f,{...p.input,acknowledge_availability_impact:true});assert.equal(ok.status,200,JSON.stringify(ok));assertPreserved(before,snapshot(f.db));
 entry(f.db,2,1,1);const linkedBefore=snapshot(f.db),blocked=await prepare(f,request(f,[{...slot,start_time:'07:40'}],[0],'update_matching_keep_extra'));assert.equal(blocked.plan.can_apply,false);assert.equal((await apply(f,{...blocked.input,acknowledge_availability_impact:true})).status,409);assert.deepEqual(snapshot(f.db),linkedBefore);
});
test('stale source/target revision is rejected; refreshed same-revision competing writes cannot both succeed',async t=>{
 const f=weekFixture(t),p=await prepare(f,request(f));const other=await prepare(f,request(f,example(),[4]));
 assert.equal((await apply(f,p.input)).status,200);const before=snapshot(f.db);const stale=await apply(f,other.input);assert.equal(stale.status,409);assert.equal(stale.body.code,'stale_week_setup');assert.deepEqual(snapshot(f.db),before);
});
test('race AFTER preflight rejected by first in-batch assertion, no activation/period changes',async t=>{
 const f=weekFixture(t),p=await prepare(f,request(f));let before;
 f.d1.beforeWrite=()=>{f.db.exec("UPDATE timetable_slots SET label='concurrent edit' WHERE id=1");before=snapshot(f.db);};
 const r=await apply(f,p.input);assert.equal(r.status,409,JSON.stringify(r));assert.equal(r.body.code,'stale_week_setup');assert.deepEqual(snapshot(f.db),before);assert.equal(snapshot(f.db).timetable_revision_assertions.length,0);
});
for(const at of [0,2,4])test(`injected batch failure at ${at}: activation, timestamps, revisions and assertion rollback`,async t=>{
 const f=weekFixture(t),p=await prepare(f,request(f)),before=snapshot(f.db);f.d1.failAt=at;
 const r=await apply(f,p.input);assert.equal(r.status,500);assert.deepEqual(snapshot(f.db),before);assert.ok(!JSON.stringify(r).includes('injected'));
});

for(const [label,dayCount,template] of [['one-example',1,example],['five-example',5,example],['seven-maximum',7,maximum]])test(`budget complete HTTP ${label} including auth and every batch member`,async t=>{
 const f=weekFixture(t,true),input=request(f,template(),Array.from({length:dayCount},(_,i)=>i)),p=await prepare(f,input);
 const start=performance.now(),result=await apply(f,p.input,'admin');assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.body.data.counts.create,dayCount*template().length);
 const statements=f.d1.executions,write=statements.filter(s=>/^\s*(INSERT|UPDATE|DELETE)/i.test(s.sql)).length;
 assert.ok(statements.length<50);assert.ok(statements.every(s=>s.parameters<=4));
 t.diagnostic(JSON.stringify({case:label,read:statements.length-write,write,http_statements:statements.length,max_parameters:Math.max(...statements.map(s=>s.parameters)),payload_bytes:Buffer.byteLength(JSON.stringify(p.input)),local_http_ms:+(performance.now()-start).toFixed(2)}));
});
test('budget seven populated 30-period safe chains group cross-day layers and keep <50',async t=>{
 const f=weekFixture(t,true),days=[0,1,2,3,4,5,6],create=await prepare(f,request(f,maximum(),days));assert.equal((await apply(f,create.input)).status,200);
 const updated=maximum().map(s=>({...s,start_time:bellTime(minuteOfDay(s.start_time)+1),end_time:bellTime(minuteOfDay(s.end_time)+1)}));const p=await prepare(f,request(f,updated,days,'update_matching_keep_extra'));assert.equal(p.plan.update_layers.length,30);assert.ok(p.plan.update_layers.every(l=>l.length===7));
 const before=snapshot(f.db),start=performance.now(),r=await apply(f,p.input,'admin');assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.body.data.counts.update,210);assert.ok(f.d1.executions.length<50);assertPreserved(before,snapshot(f.db));
 t.diagnostic(JSON.stringify({case:'seven-populated-30-layers',read:f.d1.executions.filter(s=>/^\s*SELECT/i.test(s.sql)).length,write:f.d1.executions.filter(s=>/^\s*(INSERT|UPDATE|DELETE)/i.test(s.sql)).length,http_statements:f.d1.executions.length,max_parameters:Math.max(...f.d1.executions.map(s=>s.parameters)),payload_bytes:Buffer.byteLength(JSON.stringify(p.input)),local_http_ms:+(performance.now()-start).toFixed(2)}));
});
test('budget mixed create/activation/update/retained/unchanged and separate fill-mode skip are truthful',async t=>{
 const f=weekFixture(t),slot=periodValues(f.db.prepare('SELECT * FROM timetable_slots WHERE id=1').get());const p=await prepare(f,request(f,[{...slot,label:'Edited'}],[0,1,3],'update_matching_keep_extra'));
 const before=snapshot(f.db),r=await apply(f,p.input);assert.equal(r.status,200,JSON.stringify(r));assert.deepEqual(r.body.data.counts,{create:1,update:2,unchanged:0,retained:4,skipped:0,blocked:0,activated:1});assertPreserved(before,snapshot(f.db));
 t.diagnostic(JSON.stringify({case:'mixed-update-create-retained',http_statements:f.d1.executions.length,max_parameters:Math.max(...f.d1.executions.map(s=>s.parameters)),payload_bytes:Buffer.byteLength(JSON.stringify(p.input))}));
});
test('worst supported mix: 30 dependency layers PLUS creation and activation stays at 47 complete statements',async t=>{
 const f=weekFixture(t,true),create=await prepare(f,request(f,maximum(),[0,1,2,3,4,5]));assert.equal((await apply(f,create.input)).status,200);
 const template=maximum().map(s=>({...s,start_time:bellTime(minuteOfDay(s.start_time)+1),end_time:bellTime(minuteOfDay(s.end_time)+1)}));
 const p=await prepare(f,request(f,template,[0,1,2,3,4,5,6],'update_matching_keep_extra')),r=await apply(f,p.input,'admin');assert.equal(r.status,200,JSON.stringify(r));
 assert.equal(f.d1.executions.length,47);assert.equal(r.body.data.counts.update,180);assert.equal(r.body.data.counts.create,30);assert.equal(r.body.data.counts.activated,1);
 t.diagnostic(JSON.stringify({case:'worst-supported-mixed',http_statements:47,read:13,write:34,max_parameters:4,payload_bytes:Buffer.byteLength(JSON.stringify(p.input))}));
});
