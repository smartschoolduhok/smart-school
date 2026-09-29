import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseMatrixRequest, parseMatrixCopyRequest, matrixCells, matrixClassCards, matrixKey,
  matrixDraftChanges, applyMatrixRow, planTeachingLoadMatrix, planTeachingLoadCopy, createMatrixRequestGuard,
  matrixLoadTeacherState, matrixCellPresentation, isMatrixTeacherEligible, summarizeMatrix, matrixCellLoads, matrixSectionTotals,
} from '../src/lib/teachingLoadMatrix.ts';
import { loadTeachingLoadMatrix, publicTeachingLoadMatrix, buildMatrixApplyStatements } from '../src/lib/teachingLoadMatrixDb.ts';
import { fixture, entry, revision, snapshot, addConstraints, addAvailability, migrationSQL, invalidateAssignedTeacher } from './helpers/teaching-load-matrix-fixture.mjs';

const scope={school_id:1,academic_year_id:1,class_id:1};
const up=(subject_id=1,section_id=1,employee_id=1,weekly_periods=4)=>({subject_id,section_id,employee_id,weekly_periods,action:'upsert'});
const context=f=>loadTeachingLoadMatrix(f.d1,1,1,1);
const body=changes=>({...scope,expected_revision:0,changes});
const sqlChange=(db,employee)=>db.prepare('UPDATE timetable_teaching_loads SET employee_id=?, updated_by_user_id=1 WHERE id=1').run(employee);

test('genuine full schema: class cards sorted, expected cells respect section applicability and archives',async()=>{
 const f=fixture(); const c=await context(f); const data=publicTeachingLoadMatrix(c);
 assert.equal(data.teachers.length,3); assert.ok(data.teachers.every(t=>t.role==='teacher'&&t.status==='active'));
 assert.deepEqual(matrixCells(1,c.sections,c.subjects),[{subject_id:1,section_id:1},{subject_id:1,section_id:2},{subject_id:2,section_id:1},{subject_id:2,section_id:2},{subject_id:3,section_id:1}]);
 assert.equal(data.summary.expected,5); assert.equal(data.summary.configured,2); assert.equal(data.summary.missing,3); assert.equal(data.summary.without_teacher,1);
 assert.equal(data.summary.weekly_periods,8); assert.equal(data.summary.completion_percent,20);
 const cards=matrixClassCards(f.db.prepare('SELECT * FROM classes WHERE school_id=1').all(),f.db.prepare('SELECT * FROM sections WHERE school_id=1').all(),f.db.prepare('SELECT * FROM subjects WHERE school_id=1').all(),c.loads);
 assert.deepEqual(cards.map(c=>c.id),[2,1]); assert.equal(cards[0].summary.expected,1);
 const whole=await loadTeachingLoadMatrix(f.d1,1,1,2); assert.deepEqual(matrixCells(2,whole.sections,whole.subjects),[{subject_id:4,section_id:null}]);
});
test('draft preserves heterogeneous periods; explicit apply-all, individual override and clear teacher never deactivate',async()=>{
 const f=fixture(); f.db.exec('UPDATE timetable_teaching_loads SET weekly_periods=5 WHERE id=2');
 const d=publicTeachingLoadMatrix(await context(f));
 assert.deepEqual(matrixDraftChanges(d,{}),[]);
 let draft=applyMatrixRow(d,{},1,{periods:'3'}); draft=applyMatrixRow(d,draft,1,{employeeId:1});
 assert.equal(matrixDraftChanges(d,draft).length,2);
 draft['1:2']={periods:'2',employeeId:2};
 assert.deepEqual(matrixDraftChanges(d,draft),[up(1,1,1,3),up(1,2,2,2)]);
 draft=applyMatrixRow(d,draft,1,{employeeId:null});
 assert.ok(matrixDraftChanges(d,draft).every(c=>c.action==='upsert'&&c.employee_id===null));
 assert.equal(Object.keys(applyMatrixRow(d,{},3,{periods:'2'})).length,1);
});
test('blank existing/missing cells and omissions are no-op; explicit deactivation only',async()=>{
 const d=publicTeachingLoadMatrix(await context(fixture()));
 assert.deepEqual(matrixDraftChanges(d,{'1:1':{periods:''},'2:1':{periods:''},'2:2':{employeeId:1}}),[]);
 assert.deepEqual(matrixDraftChanges(d,{'1:1':{deactivate:true}}),[{subject_id:1,section_id:1,action:'deactivate'}]);
});
test('inactive-only cells are excluded while absent cells remain missing and active history wins',async()=>{
 const f=fixture();f.db.exec("UPDATE timetable_teaching_loads SET status='inactive' WHERE id=2");
 const c=await context(f),data=publicTeachingLoadMatrix(c);
 assert.equal(data.summary.excluded,1);assert.equal(data.summary.expected,4);assert.equal(data.summary.configured,1);assert.equal(data.summary.missing,3);
 assert.equal(data.summary.weekly_periods,4);assert.equal(matrixCellPresentation(data.loads.find(l=>l.id===2),2,c.teachers,1).state,'excluded');
 const active=c.loads.find(l=>l.id===1),history={...active,id:999,status:'inactive'};
 for(const rows of [[active,history],[history,active]]){
  assert.equal(matrixCellLoads(rows).get('1:1').id,1);
  const summary=summarizeMatrix(1,c.sections,c.subjects,rows);assert.equal(summary.excluded,0);assert.equal(summary.configured,1);
 }
 const recentlyExcluded={...active,status:'inactive',weekly_periods:3,updated_at:200},olderHistory={...history,updated_at:100};
 assert.equal(matrixCellLoads([recentlyExcluded,olderHistory]).get('1:1').weekly_periods,3);
 assert.equal(matrixCellLoads([olderHistory,recentlyExcluded]).get('1:1').weekly_periods,3);
});
test('projected summary retains prior exclusions and explicit inclusion restores required denominator',async()=>{
 const f=fixture();f.db.exec("UPDATE timetable_teaching_loads SET status='inactive' WHERE id=2");const c=await context(f);
 const other=planTeachingLoadMatrix(c,[up(1,1,1)]);assert.equal(other.summary_after.excluded,1);assert.equal(other.summary_after.expected,4);assert.equal(other.summary_after.completion_percent,25);
 const bothExcluded=planTeachingLoadMatrix(c,[{subject_id:1,section_id:1,action:'deactivate'}]);assert.equal(bothExcluded.summary_after.excluded,2);assert.equal(bothExcluded.summary_after.expected,3);assert.equal(bothExcluded.summary_after.weekly_periods,0);
 const included=planTeachingLoadMatrix(c,[up(1,2,2,3)]);assert.equal(included.counts.create,1);assert.equal(included.summary_after.excluded,0);assert.equal(included.summary_after.expected,5);assert.equal(included.summary_after.weekly_periods,7);
 const only=summarizeMatrix(1,[c.sections[1]],[c.subjects[0]],c.loads);assert.equal(only.expected,0);assert.equal(only.excluded,1);assert.equal(only.missing,0);assert.equal(only.completion_percent,100);
});
test('section totals use saved capacity and only valid active draft periods, independently per section',async()=>{
 const f=fixture();f.db.exec("UPDATE timetable_teaching_loads SET status='inactive' WHERE id=2");const data=publicTeachingLoadMatrix(await context(f));
 assert.equal(data.weekly_capacity,6);
 const saved=matrixSectionTotals(data);assert.deepEqual(saved.map(s=>[s.id,s.weekly_periods,s.weekly_capacity,s.excluded,s.missing]),[[1,4,6,0,2],[2,0,6,1,1]]);
 const edited=matrixSectionTotals(data,{'1:1':{periods:'7'},'1:2':{include:true,periods:'3',employeeId:2},'2:1':{periods:'0'},'2:2':{periods:'2'}});
 assert.deepEqual(edited.map(s=>[s.weekly_periods,s.difference,s.excluded,s.invalid_periods]),[[7,-1,0,1],[5,1,0,0]]);
 const excluded=matrixSectionTotals(data,{'1:1':{deactivate:true},'1:2':{include:true,periods:''}});assert.equal(excluded[0].weekly_periods,0);assert.equal(excluded[0].excluded,1);assert.equal(excluded[1].excluded,0);assert.equal(excluded[1].missing,2);
 assert.equal(matrixSectionTotals({...data,weekly_capacity:9})[0].difference,5);
});
test('bulk row edits preserve explicit exclusions until the user includes that section',async()=>{
 const f=fixture();f.db.exec("UPDATE timetable_teaching_loads SET status='inactive' WHERE id=2");const data=publicTeachingLoadMatrix(await context(f));
 const applied=applyMatrixRow(data,{},1,{periods:'3',employeeId:1});assert.equal(applied['1:2'],undefined);assert.deepEqual(matrixDraftChanges(data,applied),[up(1,1,1,3)]);
 const excluded={'1:1':{deactivate:true}};assert.deepEqual(applyMatrixRow(data,excluded,1,{periods:'6'}),excluded);
 const included=applyMatrixRow(data,{'1:2':{include:true,periods:'4',employeeId:2}},1,{periods:'2'});assert.deepEqual(matrixDraftChanges(data,included),[up(1,1,null,2),up(1,2,2,2)]);
});
const invalids=[
 null,[],{}, {...body([up()]),extra:1},body([]),body(Array.from({length:501},(_,i)=>up(i+1))),
 body([up(),up()]),body([{...up(),school_id:2}]),body([{...up(),action:'delete'}]),
 body([{...up(),weekly_periods:0}]),body([{...up(),weekly_periods:1.5}]),body([{...up(),weekly_periods:101}]),
 body([{...up(),employee_id:'1'}]),body([{...up(),section_id:undefined}]),body([{...up(),subject_id:-1}]),
 {...body([up()]),expected_revision:'1'}, {...body([up()]),school_id:null},
];
for(const [i,input] of invalids.entries()) test(`strict payload rejects adversarial case ${i+1}`,()=>assert.equal(parseMatrixRequest(input).ok,false));
test('apply requires confirmation; copy rejects unknown/same/foreign-shaped payloads',()=>{
 assert.equal(parseMatrixRequest(body([up()]),true).ok,false);
 assert.equal(parseMatrixRequest({...body([up()]),confirm_apply:true},true).ok,true);
 const copy={school_id:1,target_academic_year_id:1,source_academic_year_id:2,class_id:1,copy_mode:'periods_only'};
 assert.equal(parseMatrixCopyRequest(copy).ok,true);
 for(const bad of [{...copy,copy_mode:'all'},{...copy,source_academic_year_id:1},{...copy,extra:1}])assert.equal(parseMatrixCopyRequest(bad).ok,false);
});
test('deterministic mixed create/update/no-op/deactivate and inactive history preservation',async()=>{
 const f=fixture(); f.db.exec("INSERT INTO timetable_teaching_loads(school_id,academic_year_id,class_id,section_id,subject_id,weekly_periods,status) VALUES(1,1,1,1,2,2,'inactive')");
 const c=await context(f); const changes=[up(2,1,null,2),up(1,2,2),up(1,1,1),{subject_id:3,section_id:1,action:'deactivate'}];
 const p=planTeachingLoadMatrix(c,changes); assert.deepEqual(p,planTeachingLoadMatrix(c,[...changes].reverse()));
 assert.deepEqual(p.counts,{create:1,update:1,unchanged:1,deactivate:1,blocked:0});
 await f.d1.batch(buildMatrixApplyStatements(f.d1,scope,p,1));
 assert.equal(f.db.prepare("SELECT COUNT(*) n FROM timetable_teaching_loads WHERE subject_id=2 AND academic_year_id=1").get().n,2);
 const created=f.db.prepare("SELECT * FROM timetable_teaching_loads WHERE subject_id=2 AND academic_year_id=1 AND status='active'").get();
 assert.equal(created.created_by_user_id,1); assert.equal(created.updated_by_user_id,1);
 assert.equal(f.db.prepare('SELECT updated_by_user_id FROM timetable_teaching_loads WHERE id=1').get().updated_by_user_id,1);
 assert.equal(f.db.prepare('SELECT status FROM timetable_teaching_loads WHERE subject_id=3 AND section_id=1').get().status,'inactive');
});

test('excluding an unconfigured subject persists only its inactive marker and can be included later',async()=>{
 const f=fixture(),c=await context(f),before=snapshot(f.db),change={subject_id:2,section_id:1,action:'deactivate'};
 assert.deepEqual(matrixDraftChanges(publicTeachingLoadMatrix(c),{'2:1':{deactivate:true}}),[change]);
 const p=planTeachingLoadMatrix(c,[change]);assert.equal(p.can_apply,true);assert.equal(p.counts.deactivate,1);
 assert.equal(p.summary_after.excluded,1);assert.equal(p.summary_after.missing,2);
 await f.d1.batch(buildMatrixApplyStatements(f.d1,scope,p,1));
 const saved=await context(f),marker=saved.loads.find(l=>l.subject_id===2&&l.section_id===1);
 assert.equal(marker.status,'inactive');assert.equal(marker.employee_id,null);assert.equal(marker.weekly_periods,1);
 assert.deepEqual(saved.loads.filter(l=>l.id!==marker.id),c.loads);
 for(const table of ['subjects','student_subjects','grades'])assert.deepEqual(snapshot(f.db)[table],before[table]);
 assert.equal(planTeachingLoadMatrix(saved,[change]).counts.unchanged,1);
 const include=planTeachingLoadMatrix(saved,[up(2,1,2,2)]);await f.d1.batch(buildMatrixApplyStatements(f.d1,scope,include,1));
 const included=publicTeachingLoadMatrix(await context(f));assert.equal(included.summary.excluded,0);
 assert.equal(included.loads.find(l=>l.subject_id===2&&l.status==='active').weekly_periods,2);
});

for(const disabledSubject of [1,2])for(const scheduled of [false,true])test(`parallel subject ${disabledSubject} exclusion preserves the other load and schedule (${scheduled})`,async()=>{
 const f=fixture();f.db.exec(`UPDATE timetable_teaching_loads SET employee_id=1 WHERE id=1;
 INSERT INTO timetable_teaching_loads(id,school_id,academic_year_id,class_id,section_id,subject_id,employee_id,weekly_periods,status,parallel_with_load_id)
 VALUES(20,1,1,1,1,2,2,4,'active',1)`);
 if(scheduled) {entry(f.db,1,1,1);entry(f.db,20,1,1);entry(f.db,1,2);entry(f.db,20,2);}
 const allBefore=snapshot(f.db);
 const c=await context(f),data=publicTeachingLoadMatrix(c),survivorId=disabledSubject===1?20:1;
 assert.equal(matrixSectionTotals(data).find(s=>s.id===1).weekly_periods,4);
 const draft={[`${disabledSubject}:1`]:{deactivate:true}};
 assert.equal(matrixSectionTotals(data,draft).find(s=>s.id===1).weekly_periods,4);
 const p=planTeachingLoadMatrix(c,matrixDraftChanges(data,draft));assert.equal(p.can_apply,true);
 assert.equal(p.items[0].removed_entry_count,scheduled?2:0);
 assert.equal(p.total_weekly_periods_before,8);assert.equal(p.total_weekly_periods_after,8);
 const before=c.loads.find(l=>l.id===survivorId);await f.d1.batch(buildMatrixApplyStatements(f.d1,scope,p,1));
 const after=(await context(f)).loads.find(l=>l.id===survivorId);
 assert.equal(after.status,'active');assert.equal(after.employee_id,before.employee_id);assert.equal(after.weekly_periods,before.weekly_periods);
 assert.equal(after.parallel_with_load_id,null);
 assert.equal((await context(f)).loads.find(l=>l.subject_id===disabledSubject&&l.section_id===1).status,'inactive');
 const allAfter=snapshot(f.db);
 assert.deepEqual(allAfter.timetable_entries,allBefore.timetable_entries.filter(e=>e.teaching_load_id===survivorId));
 if(scheduled){const archive=JSON.parse(allAfter.timetable_week_archives[0].snapshot_json);
  assert.equal(archive.entries.length,2);assert.ok(archive.entries.every(e=>e.teaching_load_id!==survivorId));
  assert.deepEqual(archive.entries.sort((a,b)=>a.id-b.id),JSON.parse(JSON.stringify(allBefore.timetable_entries.filter(e=>e.teaching_load_id!==survivorId).sort((a,b)=>a.id-b.id))));}
 assert.equal(allAfter.timetable_locked_entry_overrides.length,0);
 for(const table of ['subjects','student_subjects','grades','lesson_attendance_sessions'])assert.deepEqual(allAfter[table],allBefore[table]);
 assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('scheduled paired exclusion rolls back its archive, deleted entries, unlink and status on late failure',async()=>{
 const f=fixture();f.db.exec(`UPDATE timetable_teaching_loads SET employee_id=1 WHERE id=1;
 INSERT INTO timetable_teaching_loads(id,school_id,academic_year_id,class_id,section_id,subject_id,employee_id,weekly_periods,status,parallel_with_load_id)
 VALUES(20,1,1,1,1,2,2,4,'active',1)`);entry(f.db,1,1,1);entry(f.db,20,1,1);
 const p=planTeachingLoadMatrix(await context(f),[{subject_id:1,section_id:1,action:'deactivate'}]),before=snapshot(f.db);
 const statements=buildMatrixApplyStatements(f.d1,scope,p,1);f.d1.failAt=statements.length-1;
 await assert.rejects(f.d1.batch(statements),/injected/);assert.deepEqual(snapshot(f.db),before);
});

test('matrix can exclude a paired load and explicitly reassign its teacher to the survivor atomically',async()=>{
 const f=fixture();f.db.exec(`UPDATE timetable_teaching_loads SET employee_id=1 WHERE id=1;
 INSERT INTO timetable_teaching_loads(id,school_id,academic_year_id,class_id,section_id,subject_id,employee_id,weekly_periods,status,parallel_with_load_id)
 VALUES(20,1,1,1,1,2,2,4,'active',1)`);entry(f.db,1,1,1);entry(f.db,20,1,1);
 const p=planTeachingLoadMatrix(await context(f),[up(1,1,2),{subject_id:2,section_id:1,action:'deactivate'}]);
 assert.equal(p.can_apply,true);await f.d1.batch(buildMatrixApplyStatements(f.d1,scope,p,1));
 const current=await context(f);assert.equal(current.loads.find(l=>l.id===1).employee_id,2);assert.equal(current.loads.find(l=>l.id===20).status,'inactive');
 assert.equal(current.entries.length,1);assert.equal(current.entries[0].teaching_load_id,1);assert.equal(current.entries[0].is_locked,1);
});

test('matrix rejects assigning the companion teacher to either side of a pair',async()=>{
 const f=fixture();f.db.exec(`UPDATE timetable_teaching_loads SET employee_id=1 WHERE id=1;
 INSERT INTO timetable_teaching_loads(id,school_id,academic_year_id,class_id,section_id,subject_id,employee_id,weekly_periods,status,parallel_with_load_id)
 VALUES(20,1,1,1,1,2,2,4,'active',1)`);
 for(const change of [up(1,1,2),up(2,1,1)])assert.equal(planTeachingLoadMatrix(await context(f),[change]).can_apply,false);
});
for(const change of [up(5,1),up(999,1),up(1,3),up(1,null),up(3,2),up(6,1),up(1,4),up(1,1,3),up(1,1,4),up(1,1,5),up(1,1,7)])
 test(`canonical invalid reference blocked ${JSON.stringify(change)}`,async()=>{
  const f=fixture(); const before=snapshot(f.db); const p=planTeachingLoadMatrix(await context(f),[change]);
  assert.equal(p.can_apply,false); assert.equal(p.counts.blocked,1); assert.deepEqual(snapshot(f.db),before);
 });
test('schedule deactivation and period reduction are blockers including inactive/historical entries',async()=>{
 const f=fixture();entry(f.db,1,1);entry(f.db,1,2);
 f.db.exec('UPDATE timetable_slots SET is_active=0 WHERE id=2');
 for(const c of [{subject_id:1,section_id:1,action:'deactivate'},up(1,1,null,1)]){
  const p=planTeachingLoadMatrix(await context(f),[c]);assert.equal(p.can_apply,false);
 }
 assert.equal(planTeachingLoadMatrix(await context(f),[up(1,1,null,5)]).can_apply,true);
});

for(const [label,initial,final] of [['NULL to teacher',null,1],['teacher A to B',1,2],['teacher to NULL',1,null],['same teacher',1,1]])
 test(`SQL safe ${label} preserves entries/locks and revises successful changes`,()=>{
  const f=fixture();sqlChange(f.db,initial);entry(f.db,1,1,1);entry(f.db,1,2);
  const old=f.db.prepare('SELECT * FROM timetable_entries ORDER BY id').all();const rev=revision(f.db);
  sqlChange(f.db,final);
  assert.equal(f.db.prepare('SELECT employee_id FROM timetable_teaching_loads WHERE id=1').get().employee_id,final);
  assert.deepEqual(f.db.prepare('SELECT * FROM timetable_entries ORDER BY id').all(),old);
  if(initial!==final)assert.ok(revision(f.db)>rev);
 });
for(const employee of [3,4,5,7,999])test(`DB rejects invalid/archived/nonteacher/foreign teacher ${employee}`,()=>{
 const f=fixture();entry(f.db,1,1);const before=snapshot(f.db);
 assert.throws(()=>sqlChange(f.db,employee));assert.deepEqual(snapshot(f.db),before);
});
const violations=[
 ['collision',f=>{entry(f.db,3,1);},6,/teacher collision/],
 ['unavailable',f=>addAvailability(f.db,1,1,'unavailable'),1,/teacher unavailable/],
 ['daily',f=>{entry(f.db,1,2);addConstraints(f.db,1,{max_periods_per_day:1});},1,/max periods per day/],
 ['working days',f=>{entry(f.db,1,6);entry(f.db,3,7);addConstraints(f.db,6,{max_working_days:2});},6,/max working days/],
 ['consecutive aggregated across loads',f=>{entry(f.db,3,2);addConstraints(f.db,6,{max_consecutive_periods:1});},6,/max consecutive/],
];
for(const [label,setup,teacher,pattern] of violations)test(`DB + combined planner reject ${label}; complete rollback`,async()=>{
 const f=fixture();entry(f.db,1,1);setup(f);
 const before=snapshot(f.db);const p=planTeachingLoadMatrix(await context(f),[up(1,1,teacher)]);
 assert.equal(p.can_apply,false,JSON.stringify(p));assert.throws(()=>sqlChange(f.db,teacher),pattern);assert.deepEqual(snapshot(f.db),before);
});
test('working-days aggregated full schedule even when every existing day has multiple entries',async()=>{
 const f=fixture();entry(f.db,1,1);entry(f.db,1,2);entry(f.db,1,6);entry(f.db,3,7);
 addConstraints(f.db,6,{max_working_days:2});
 assert.equal(planTeachingLoadMatrix(await context(f),[up(1,1,6)]).can_apply,false);assert.throws(()=>sqlChange(f.db,6),/working days/);
});
test('breaks and empty lessons reset consecutive count; inactive slots do not consume capacity',()=>{
 const f=fixture();entry(f.db,1,1);entry(f.db,1,3);entry(f.db,1,5);
 addConstraints(f.db,1,{max_consecutive_periods:1,max_periods_per_day:3});
 sqlChange(f.db,1); // gap then break
 sqlChange(f.db,null);
 f.db.exec('UPDATE timetable_slots SET is_active=0 WHERE id=3');
 f.db.exec('UPDATE timetable_teacher_constraints SET max_periods_per_day=2');
 sqlChange(f.db,1);
});
test('same-teacher edit does not introduce reassignment failure on legacy-invalid schedule',()=>{
 const f=fixture();sqlChange(f.db,1);entry(f.db,1,1);addAvailability(f.db,1,1,'unavailable');sqlChange(f.db,1);
});
test('preferred/avoid remain warnings, locked teacher changes explicitly disclosed including NULL',async()=>{
 const f=fixture();entry(f.db,1,1,1);addAvailability(f.db,1,1,'avoid');
 const p=planTeachingLoadMatrix(await context(f),[up()]);assert.equal(p.can_apply,true);assert.ok(p.items[0].warnings.length>=2);
 sqlChange(f.db,1);
 const clear=planTeachingLoadMatrix(await context(f),[up(1,1,null)]);assert.ok(clear.items[0].warnings.some(w=>w.code==='locked_lessons_teacher_change'));
});
for(const field of ['class_id=2','section_id=2','subject_id=2','school_id=2','academic_year_id=2','weekly_periods=1'])
 test(`DB retains academic/period guard: ${field}`,()=>{
  const f=fixture();entry(f.db,1,1);entry(f.db,1,2);const before=snapshot(f.db);
  assert.throws(()=>f.db.exec(`UPDATE timetable_teaching_loads SET ${field} WHERE id=1`));assert.deepEqual(snapshot(f.db),before);
 });
test('combined two changes collision is blocked despite each being valid alone',async()=>{
 const f=fixture();entry(f.db,1,1);entry(f.db,2,1);const c=await context(f);
 assert.equal(planTeachingLoadMatrix(c,[up(1,1,1)]).can_apply,true);
 assert.equal(planTeachingLoadMatrix(c,[up(1,2,1)]).can_apply,true);
 const p=planTeachingLoadMatrix(c,[up(1,1,1),up(1,2,1)]);
 assert.equal(p.can_apply,false);assert.equal(p.counts.blocked,2);
});
test('coupled swap uses atomic two passes and preserves unaffected data, IDs, locks and versions',async()=>{
 const f=fixture();sqlChange(f.db,1);entry(f.db,1,1,1);entry(f.db,2,1);
 const before=snapshot(f.db);const p=planTeachingLoadMatrix(await context(f),[up(1,1,2),up(1,2,1)]);
 assert.equal(p.can_apply,true);await f.d1.batch(buildMatrixApplyStatements(f.d1,scope,p,1));
 const after=snapshot(f.db);assert.equal(after.timetable_teaching_loads.find(l=>l.id===1).employee_id,2);
 assert.equal(after.timetable_teaching_loads.find(l=>l.id===2).employee_id,1);
 assert.deepEqual(after.timetable_entries,before.timetable_entries);
 assert.deepEqual(after.timetable_teaching_loads.filter(l=>l.id>2),before.timetable_teaching_loads.filter(l=>l.id>2));
 assert.deepEqual(after.timetable_schedule_versions,before.timetable_schedule_versions);
 assert.equal(after.timetable_revision_assertions.length,0);
});
for(const kind of ['create','swap'])test(`injected middle ${kind} failure rolls back all rows/audit/revision/temporary NULL`,async()=>{
 const f=fixture(); if(kind==='swap'){sqlChange(f.db,1);entry(f.db,1,1,1);entry(f.db,2,1);}
 const before=snapshot(f.db);const changes=kind==='swap'?[up(1,1,2),up(1,2,1)]:[up(2,1),up(2,2)];
 const plan=planTeachingLoadMatrix(await context(f),changes);f.d1.failAt=kind==='swap'?3:2;
 await assert.rejects(f.d1.batch(buildMatrixApplyStatements(f.d1,scope,plan,1)),/injected/);
 assert.deepEqual(snapshot(f.db),before);
});
test('atomic revision race and stale solver assertions reject with zero writes',async()=>{
 const f=fixture();const p=planTeachingLoadMatrix(await context(f),[up()]);
 f.d1.beforeWrite=()=>f.db.exec('UPDATE timetable_teaching_loads SET weekly_periods=5 WHERE id=2');
 await assert.rejects(f.d1.batch(buildMatrixApplyStatements(f.d1,scope,p,1)),/stale_timetable_proposal/);
 assert.equal(f.db.prepare('SELECT employee_id FROM timetable_teaching_loads WHERE id=1').get().employee_id,null);
 const fresh=planTeachingLoadMatrix(await context(f),[up()]);await f.d1.batch(buildMatrixApplyStatements(f.d1,scope,fresh,1));
 assert.throws(()=>f.db.prepare('INSERT INTO timetable_revision_assertions(token,school_id,academic_year_id,expected_revision) VALUES(?,1,1,?)').run('old-proposal',fresh.revision),/stale_timetable_proposal/);
});
test('maximum 500 teacher changes use six statements with five bound parameters',async()=>{
 const f=fixture();
 for(let i=0;i<500;i++){
  f.db.prepare("INSERT INTO subjects(id,school_id,class_id,name,status) VALUES(?,1,2,?,'active')").run(100+i,'Bulk '+i);
  f.db.prepare("INSERT INTO timetable_teaching_loads(school_id,academic_year_id,class_id,section_id,subject_id,employee_id,weekly_periods,status) VALUES(1,1,2,NULL,?,1,1,'active')").run(100+i);
 }
 const changes=Array.from({length:500},(_,i)=>up(100+i,null,2,1));
 assert.equal(parseMatrixRequest({...body(changes),class_id:2}).ok,true);
 const plan=planTeachingLoadMatrix(await loadTeachingLoadMatrix(f.d1,1,1,2),changes);
 const statements=buildMatrixApplyStatements(f.d1,{...scope,class_id:2},plan,1);
 assert.equal(statements.length,6);assert.ok(statements.every(s=>s.args.length<=5));
 await f.d1.batch(statements);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM timetable_teaching_loads WHERE school_id=1 AND academic_year_id=1 AND class_id=2 AND employee_id=2').get().n,500);
});
test('copy is canonical, periods-only retains target teacher/new NULL, omissions unchanged, invalid teacher warned',async()=>{
 const f=fixture();const c=await context(f);const source=f.db.prepare('SELECT * FROM timetable_teaching_loads WHERE school_id=1 AND academic_year_id=2').all();
 let p=planTeachingLoadCopy(c,source,'periods_only');
 assert.equal(p.changes[0].employee_id,null);assert.equal(p.changes[1].employee_id,null);assert.equal(p.plan.counts.create,1);
 const targetTeachers=planTeachingLoadCopy(c,[{...source[0],section_id:2}],'periods_only');assert.equal(targetTeachers.changes[0].employee_id,2);
 p=planTeachingLoadCopy(c,source,'periods_and_teachers');assert.equal(p.changes[0].employee_id,1);assert.equal(p.changes[1].employee_id,2);
 p=planTeachingLoadCopy(c,[{...source[0],employee_id:4}],'periods_and_teachers');assert.equal(p.changes[0].employee_id,null);assert.equal(p.warnings[0].code,'source_teacher_removed');
 p=planTeachingLoadCopy(c,[{...source[0],subject_id:6},{...source[0],section_id:4}],'periods_only');assert.equal(p.changes.length,0);assert.equal(p.unavailable.length,2);
 p=planTeachingLoadCopy(c,[{...source[0],weekly_periods:4,employee_id:null}],'periods_only');assert.equal(p.plan.counts.unchanged,1);
 assert.ok(p.plan.items.every(i=>i.action!=='deactivate'));
});
test('ABA, draft edits, copy and apply responses are invalidated by monotonic request generation',()=>{
 const guard=createMatrixRequestGuard();const schoolA=guard.capture();guard.invalidate();const schoolB=guard.capture();guard.invalidate();const secondA=guard.capture();
 assert.equal(schoolA(),false);assert.equal(schoolB(),false);assert.equal(secondA(),true);
 guard.invalidate();assert.equal(secondA(),false);
});
test('populated 0026 upgrade is data-preserving, FK clean and keeps immutable versions and locks',()=>{
 const f=fixture({upgrade:false});entry(f.db,1,1,1);addAvailability(f.db,1,2,'avoid');addConstraints(f.db,1,{max_periods_per_day:4});
 f.db.exec("INSERT INTO timetable_schedule_versions(id,version_key,school_id,academic_year_id,source,previous_revision,created_by_user_id,old_entry_count,new_entry_count,locked_entry_count,proposal_digest) VALUES(1,'local-version',1,1,'automatic_adoption',0,1,1,1,1,'local'); INSERT INTO timetable_schedule_version_entries(version_id,school_id,academic_year_id,slot_id,teaching_load_id,is_locked) VALUES(1,1,1,1,1,1)");
 const before=snapshot(f.db);const indexes=f.db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='index' ORDER BY name").all();
 f.db.exec(migrationSQL('0027_timetable_safe_teacher_reassignment.sql'));
 assert.deepEqual(snapshot(f.db),before);assert.deepEqual(f.db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='index' ORDER BY name").all(),indexes);
 assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
 assert.ok(f.db.prepare("SELECT name FROM sqlite_schema WHERE name='trg_timetable_loads_validate_teacher_reassignment'").get());
 assert.throws(()=>f.db.exec("UPDATE timetable_schedule_version_entries SET is_locked=0"),/immutable/);
});

test('query guard counts actual executions, including reused statements inside one batch',async()=>{
 const f=fixture();const before=snapshot(f.db);const statement=f.d1.prepare('SELECT 1');f.d1.resetQueryBudget(50);
 await assert.rejects(f.d1.batch(Array.from({length:51},()=>statement)),/query budget exceeded/);
 assert.equal(f.d1.executions.length,50);assert.deepEqual(snapshot(f.db),before);
});

for(const kind of ['archived','nonteacher','other-school','missing'])test(`domain ${kind} reference remains configured, invalid/red, not NULL or complete`,async()=>{
 const f=fixture();invalidateAssignedTeacher(f.db,kind);const before=snapshot(f.db);const c=await context(f);const data=publicTeachingLoadMatrix(c);
 const load=data.loads.find(l=>l.id===2);assert.equal(matrixLoadTeacherState(load),'invalid_teacher');
 assert.deepEqual(matrixCellPresentation(load,2,c.teachers,1),{state:'invalid_teacher',tone:'bg-red-50',label:'مدرس غير متاح — اختر بديلًا'});
 assert.equal(matrixCellPresentation(data.loads.find(l=>l.id===1),null,c.teachers,1).state,'without_teacher');
 assert.equal(matrixCellPresentation(undefined,null,c.teachers,1).state,'missing');
 const p=planTeachingLoadMatrix(c,[up(1,2,1)]);assert.equal(p.summary_after.invalid_teacher,0);assert.equal(p.summary_after.without_teacher,1);assert.equal(p.summary_after.completion_percent,20);
 assert.equal(p.summary_after.weekly_periods,8);assert.equal(p.summary_after.configured,2);
 assert.deepEqual(snapshot(f.db),before);
});

test('eligibility is fail-closed for missing metadata/inactive/foreign/nonteacher; repair presentation turns valid',()=>{
 for(const teacher of [undefined,{}, {school_id:1,status:'inactive',role:'teacher'},{school_id:2,status:'active',role:'teacher'},{school_id:1,status:'active',role:'staff'}])assert.equal(isMatrixTeacherEligible(teacher,1),false);
 const teacher={id:1,school_id:1,status:'active',role:'teacher',full_name:'A'};
 assert.equal(isMatrixTeacherEligible(teacher,1),true);
 assert.equal(matrixCellPresentation({employee_id:999},1,[teacher],1).tone,'bg-emerald-50');
});
