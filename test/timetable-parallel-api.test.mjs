import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import {createServer} from 'vite';
import {signJWT} from '../src/lib/jwtSecurity.ts';
import {root,weekFixture,snapshot,revision} from './helpers/week-setup-fixture.mjs';

const vite=await createServer({root,appType:'custom',server:{middlewareMode:true,hmr:false}});
const {default:app}=await vite.ssrLoadModule('/src/worker.ts');after(()=>vite.close());
const secret='parallel-lessons-generated-test-secret-over-32-characters';
const token=await signJWT({id:1,email:'owner@matrix.test',auth_version:1},secret);
async function call(f,method,path,input){
 const response=await app.request('http://localhost/api/timetable/'+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:input===undefined?undefined:JSON.stringify(input)},{DB:f.d1,JWT_SECRET:secret,APP_ENV:'test'});
 return {status:response.status,body:await response.json()};
}
const scope={school_id:1,academic_year_id:1};
const pairBody={...scope,class_id:1,section_id:1,subject_id:2,employee_id:2,weekly_periods:4,parallel_with_load_id:1};
function fixture(t){const f=weekFixture(t);f.db.exec('UPDATE timetable_teaching_loads SET employee_id=1 WHERE id=1');return f;}
async function pair(f){const r=await call(f,'POST','teaching-loads',pairBody);assert.equal(r.status,201,JSON.stringify(r));return r.body.data.id;}
async function schedule(f,load=1,slot=1){const r=await call(f,'POST','entries',{...scope,slot_id:slot,teaching_load_id:load});assert.equal(r.status,201,JSON.stringify(r));return r.body.data.id;}
const entries=f=>f.db.prepare('SELECT * FROM timetable_entries WHERE school_id=1 AND academic_year_id=1 ORDER BY teaching_load_id').all();

test('parallel create, move, lock, confirmed unlock-move and delete act atomically on both lessons',async t=>{
 const f=fixture(t),companion=await pair(f),id=await schedule(f);let rows=entries(f);assert.deepEqual(rows.map(e=>e.teaching_load_id),[1,companion]);
 const ids=rows.map(e=>e.id),other=rows.find(e=>e.teaching_load_id===companion).id;
 let r=await call(f,'PUT',`entries/${other}`,{...scope,slot_id:2});assert.equal(r.status,200,JSON.stringify(r));assert.ok(entries(f).every(e=>e.slot_id===2));assert.deepEqual(entries(f).map(e=>e.id),ids);
 r=await call(f,'PUT',`entries/${id}/lock`,{...scope,is_locked:1});assert.equal(r.status,200);assert.ok(entries(f).every(e=>e.is_locked===1));
 const before=snapshot(f.db);r=await call(f,'PUT',`entries/${other}`,{...scope,slot_id:3});assert.equal(r.status,409);assert.deepEqual(snapshot(f.db),before);
 r=await call(f,'PUT',`entries/${other}`,{...scope,slot_id:3,confirm_unlock_locked_entry:true});assert.equal(r.status,200,JSON.stringify(r));assert.ok(entries(f).every(e=>e.slot_id===3&&e.is_locked===0));
 r=await call(f,'DELETE',`entries/${id}`,scope);assert.equal(r.status,200,JSON.stringify(r));assert.equal(entries(f).length,0);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM timetable_revision_assertions').get().n,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM timetable_locked_entry_overrides').get().n,0);
});

test('parallel pair swaps with a single lesson and accepts either member as a drop target',async t=>{
 const f=fixture(t),companion=await pair(f),pairId=await schedule(f);
 const created=await call(f,'POST','teaching-loads',{...scope,class_id:1,section_id:1,subject_id:3,employee_id:6,weekly_periods:1});assert.equal(created.status,201);
 const singleId=await schedule(f,created.body.data.id,2);
 let r=await call(f,'PUT',`entries/${pairId}/drop`,{...scope,source_slot_id:1,target_slot_id:2,target_entry_id:singleId,expected_revision:revision(f.db)});
 assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.body.data.operation,'swap');assert.equal(r.body.data.entries.length,3);
 let rows=entries(f);assert.equal(rows.find(e=>e.id===singleId).slot_id,1);assert.ok(rows.filter(e=>e.id!==singleId).every(e=>e.slot_id===2));
 const target=rows.find(e=>e.teaching_load_id===companion).id;
 r=await call(f,'PUT',`entries/${singleId}/drop`,{...scope,source_slot_id:1,target_slot_id:2,target_entry_id:target,expected_revision:revision(f.db)});
 assert.equal(r.status,200,JSON.stringify(r));rows=entries(f);assert.equal(rows.find(e=>e.id===singleId).slot_id,2);assert.ok(rows.filter(e=>e.id!==singleId).every(e=>e.slot_id===1));
});

test('the companion teacher constraints and a late D1 batch failure reject the entire pair move',async t=>{
 const f=fixture(t);await pair(f);const id=await schedule(f);
 f.db.exec("INSERT INTO timetable_teacher_availability(school_id,academic_year_id,employee_id,slot_id,status) VALUES(1,1,2,3,'unavailable')");
 const before=snapshot(f.db);let r=await call(f,'PUT',`entries/${id}`,{...scope,slot_id:3});assert.equal(r.status,409,JSON.stringify(r));assert.equal(r.body.code,'teacher_unavailable');assert.deepEqual(snapshot(f.db),before);
 f.d1.failAt=2;r=await call(f,'PUT',`entries/${id}`,{...scope,slot_id:2});assert.equal(r.status,500);assert.deepEqual(snapshot(f.db),before);
});

test('linking a companion to an already scheduled primary copies both lessons into the primary positions',async t=>{
 const f=fixture(t),id=await schedule(f);const before=f.db.prepare('SELECT * FROM timetable_entries WHERE id=?').get(id);
 const companion=await pair(f),rows=entries(f);assert.equal(rows.length,2);assert.deepEqual(rows.map(e=>e.slot_id),[1,1]);assert.equal(rows.find(e=>e.teaching_load_id===1).id,id);
 assert.equal(rows.find(e=>e.teaching_load_id===1).created_at,before.created_at);assert.equal(rows.find(e=>e.teaching_load_id===companion).slot_id,1);
 const update=await call(f,'PUT',`teaching-loads/${companion}`,{...pairBody,parallel_with_load_id:undefined});assert.equal(update.status,200,JSON.stringify(update));assert.equal(update.body.data.parallel_with_load_id,1);
});

test('failed companion schedule synchronization rolls back the new load and every primary placement',async t=>{
 const f=fixture(t);await schedule(f);f.db.exec("INSERT INTO timetable_teacher_availability(school_id,academic_year_id,employee_id,slot_id,status) VALUES(1,1,2,1,'unavailable')");
 const before=snapshot(f.db),r=await call(f,'POST','teaching-loads',pairBody);assert.equal(r.status,409,JSON.stringify(r));assert.equal(r.body.code,'teacher_unavailable');assert.deepEqual(snapshot(f.db),before);
});

for(const disablePrimary of [false,true])test(`deactivate ${disablePrimary?'primary':'companion'} affects only that load and unlinks survivor`,async t=>{
 const f=fixture(t),companion=await pair(f),id=disablePrimary?1:companion,survivor=disablePrimary?companion:1;
 const old=f.db.prepare('SELECT * FROM timetable_teaching_loads WHERE id=?').get(survivor);
 const r=await call(f,'DELETE',`teaching-loads/${id}`,scope);assert.equal(r.status,200,JSON.stringify(r));
 const current=f.db.prepare('SELECT * FROM timetable_teaching_loads WHERE id=?').get(survivor);
 assert.equal(current.status,'active');assert.equal(current.parallel_with_load_id,null);assert.equal(current.employee_id,old.employee_id);assert.equal(current.weekly_periods,old.weekly_periods);
 assert.equal(f.db.prepare('SELECT status FROM timetable_teaching_loads WHERE id=?').get(id).status,'inactive');
 assert.equal(f.db.prepare('SELECT status FROM subjects WHERE id=2').get().status,'active');
});

test('a linked load with saved lessons requires explicit archive confirmation and cannot silently unlink',async t=>{
 const f=fixture(t),companion=await pair(f);await schedule(f);const before=snapshot(f.db);
 for(const id of [1,companion]){const r=await call(f,'DELETE',`teaching-loads/${id}`,scope);assert.equal(r.status,409);assert.equal(r.body.code,'parallel_load_deactivation_confirmation_required');assert.equal(r.body.data.scheduled_count,1);assert.deepEqual(snapshot(f.db),before);}
 const r=await call(f,'PUT',`teaching-loads/${companion}`,{...pairBody,parallel_with_load_id:null});assert.equal(r.status,409);assert.deepEqual(snapshot(f.db),before);
});

test('parallel relation rejects same teacher, unequal demand, foreign scope, chains and second companions',async t=>{
 const f=fixture(t),before=snapshot(f.db);
 for(const patch of [{employee_id:1},{weekly_periods:3},{parallel_with_load_id:2},{parallel_with_load_id:4},{parallel_with_load_id:6},{parallel_with_load_id:999}]){
  const r=await call(f,'POST','teaching-loads',{...pairBody,...patch});assert.equal(r.status,409,JSON.stringify(r));assert.deepEqual(snapshot(f.db),before);
 }
 const companion=await pair(f),paired=snapshot(f.db);
 const duplicate=await call(f,'POST','teaching-loads',{...pairBody,subject_id:3,employee_id:6});assert.equal(duplicate.status,409);assert.deepEqual(snapshot(f.db),paired);
 const chain=await call(f,'PUT','teaching-loads/1',{...pairBody,subject_id:1,employee_id:1,parallel_with_load_id:companion});assert.equal(chain.status,409);assert.deepEqual(snapshot(f.db),paired);
});

test('database permits only declared parallel group collisions and retains canonical scope and teacher constraints',async t=>{
 const f=fixture(t),companion=await pair(f);await schedule(f);
 f.db.exec("INSERT INTO timetable_teaching_loads(id,school_id,academic_year_id,class_id,section_id,subject_id,employee_id,weekly_periods,status) VALUES(50,1,1,1,1,3,6,1,'active')");
 assert.throws(()=>f.db.exec('INSERT INTO timetable_entries(school_id,academic_year_id,slot_id,teaching_load_id) VALUES(1,1,1,50)'),/group collision/);
 assert.throws(()=>f.db.exec(`UPDATE timetable_teaching_loads SET weekly_periods=2 WHERE id=${companion}`),/parallel/);
 assert.throws(()=>f.db.exec(`UPDATE timetable_teaching_loads SET employee_id=1 WHERE id=${companion}`),/parallel/);
 assert.throws(()=>f.db.exec(`UPDATE timetable_teaching_loads SET parallel_with_load_id=${companion} WHERE id=1`),/parallel/);
 assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});

for(const primary of [false,true])test(`confirmed scheduled ${primary?'primary':'companion'} deactivation archives only selected lessons and preserves locked survivor`,async t=>{
 const f=fixture(t),companion=await pair(f),entry=await schedule(f),id=primary?1:companion,survivor=primary?companion:1;
 await call(f,'PUT',`entries/${entry}/lock`,{...scope,is_locked:1});
 const before=snapshot(f.db),oldSurvivor=entries(f).find(e=>e.teaching_load_id===survivor);
 const ask=await call(f,'DELETE',`teaching-loads/${id}`,scope);assert.equal(ask.status,409);assert.deepEqual(ask.body.data,{scheduled_count:1,locked_count:1,revision:revision(f.db)});assert.deepEqual(snapshot(f.db),before);
 const confirmed={...scope,confirm_deactivate_scheduled:true,expected_revision:ask.body.data.revision};
 const stale=await call(f,'DELETE',`teaching-loads/${id}`,{...confirmed,expected_revision:confirmed.expected_revision-1});assert.equal(stale.status,409);assert.deepEqual(snapshot(f.db),before);
 f.d1.failAt=4;const failure=await call(f,'DELETE',`teaching-loads/${id}`,confirmed);assert.equal(failure.status,409);assert.deepEqual(snapshot(f.db),before);f.d1.failAt=null;
 const saved=await call(f,'DELETE',`teaching-loads/${id}`,confirmed);assert.equal(saved.status,200,JSON.stringify(saved));assert.equal(saved.body.data.archived_entry_count,1);
 assert.deepEqual(entries(f),[oldSurvivor]);const after=snapshot(f.db),archive=JSON.parse(after.timetable_week_archives[0].snapshot_json);
 assert.deepEqual(archive.entries.map(e=>({...e})),before.timetable_entries.filter(e=>e.teaching_load_id===id).map(e=>({...e})));
 assert.deepEqual(archive.loads.map(l=>l.id).sort((a,b)=>a-b),[1,companion]);
 const peer=after.timetable_teaching_loads.find(l=>l.id===survivor),old=before.timetable_teaching_loads.find(l=>l.id===survivor);
 assert.equal(peer.status,'active');assert.equal(peer.parallel_with_load_id,null);assert.equal(peer.employee_id,old.employee_id);assert.equal(peer.weekly_periods,old.weekly_periods);
 for(const table of Object.keys(before))if(!['timetable_entries','timetable_teaching_loads','timetable_revisions','timetable_week_archives'].includes(table))assert.deepEqual(after[table],before[table],table);
});

function attendance(f,id,status='draft') {
 f.db.prepare(`INSERT INTO lesson_attendance_sessions
 (school_id,academic_year_id,timetable_entry_id,session_date,day_of_week,slot_id,teaching_load_id,teacher_employee_id,class_id,section_id,subject_id,lesson_number,
 start_time_snapshot,end_time_snapshot,teacher_name_snapshot,class_name_snapshot,section_name_snapshot,subject_name_snapshot,status,confirmed_at,confirmed_by_user_id,created_by_user_id,updated_by_user_id)
 SELECT e.school_id,e.academic_year_id,e.id,'2026-09-06',s.day_of_week,s.id,l.id,l.employee_id,l.class_id,l.section_id,l.subject_id,s.lesson_number,
 s.start_time,s.end_time,'Teacher','Class','A','Subject',?2,CASE WHEN ?2='confirmed' THEN unixepoch() END,CASE WHEN ?2='confirmed' THEN 1 END,1,1
 FROM timetable_entries e JOIN timetable_slots s ON s.id=e.slot_id JOIN timetable_teaching_loads l ON l.id=e.teaching_load_id WHERE e.id=?1`).run(id,status);
}
for(const race of [false,true])test(`draft attendance ${race?'created at write boundary':'already saved'} blocks scheduled exclusion with no partial archive`,async t=>{
 const f=fixture(t);await pair(f);const id=await schedule(f),input={...scope,confirm_deactivate_scheduled:true,expected_revision:revision(f.db)};
 let before;if(race)f.d1.beforeWrite=()=>{attendance(f,id);before=snapshot(f.db);};else{attendance(f,id);before=snapshot(f.db);}
 const r=await call(f,'DELETE','teaching-loads/1',input);assert.equal(r.status,409,JSON.stringify(r));assert.equal(r.body.code,'pending_attendance_drafts');assert.deepEqual(snapshot(f.db),before);
});
test('confirmed attendance retains historical selected lesson snapshot after exclusion',async t=>{
 const f=fixture(t);await pair(f);const id=await schedule(f);attendance(f,id,'confirmed');const old=snapshot(f.db).lesson_attendance_sessions;
 const r=await call(f,'DELETE','teaching-loads/1',{...scope,confirm_deactivate_scheduled:true,expected_revision:revision(f.db)});assert.equal(r.status,200,JSON.stringify(r));assert.deepEqual(snapshot(f.db).lesson_attendance_sessions,old);
});
test('link rejects unequal saved schedule counts instead of dropping the extra companion lesson',async t=>{
 const f=fixture(t);await schedule(f);const created=await call(f,'POST','teaching-loads',{...pairBody,parallel_with_load_id:null});assert.equal(created.status,201);const id=created.body.data.id;
 await schedule(f,id,2);await schedule(f,id,3);const before=snapshot(f.db);
 const r=await call(f,'PUT',`teaching-loads/${id}`,pairBody);assert.equal(r.status,409);assert.equal(r.body.code,'parallel_schedule_count_mismatch');assert.deepEqual(snapshot(f.db),before);
});
test('link and move retain historical NULL authors while newly created companion uses the actor',async t=>{
 const f=fixture(t),id=await schedule(f);f.db.prepare('UPDATE timetable_entries SET created_by_user_id=NULL WHERE id=?').run(id);
 const companion=await pair(f);let rows=entries(f);assert.equal(rows.find(e=>e.id===id).created_by_user_id,null);assert.equal(rows.find(e=>e.teaching_load_id===companion).created_by_user_id,1);
 const r=await call(f,'PUT',`entries/${id}`,{...scope,slot_id:2});assert.equal(r.status,200,JSON.stringify(r));assert.equal(entries(f).find(e=>e.id===id).created_by_user_id,null);
});
test('paired unlock repairs a saved lesson after its teacher was archived without revalidating placement',async t=>{
 const f=fixture(t);await pair(f);const id=await schedule(f);await call(f,'PUT',`entries/${id}/lock`,{...scope,is_locked:1});
 f.db.exec("UPDATE employees SET status='archived' WHERE id=2");const before=entries(f);
 const r=await call(f,'PUT',`entries/${id}/lock`,{...scope,is_locked:0});assert.equal(r.status,200,JSON.stringify(r));
 assert.ok(entries(f).every(e=>e.is_locked===0));assert.deepEqual(entries(f).map(e=>[e.id,e.slot_id,e.created_at]),before.map(e=>[e.id,e.slot_id,e.created_at]));
});

test('paired creation uses SQLite allocation despite another school inserting a load at the write boundary',async t=>{
 const f=fixture(t);await schedule(f);
 f.d1.beforeWrite=()=>{f.db.exec("INSERT INTO subjects(id,school_id,class_id,section_id,name,status) VALUES(70,2,3,3,'Other new subject','active'); INSERT INTO timetable_teaching_loads(school_id,academic_year_id,class_id,section_id,subject_id,employee_id,weekly_periods,status) VALUES(2,3,3,3,70,5,2,'active')");};
 const companion=await pair(f);assert.deepEqual(entries(f).map(e=>e.teaching_load_id),[1,companion]);
 const foreign=f.db.prepare('SELECT id FROM timetable_teaching_loads WHERE subject_id=70').get();assert.notEqual(foreign.id,companion);assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});
