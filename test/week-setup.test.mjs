import assert from 'node:assert/strict';
import test from 'node:test';
import {generateWeekTemplate,validateWeekTemplate,parseWeekRequest,minuteOfDay,bellTime,recalculateWeekTimes,periodValues,planWeekSetup,publicWeekSnapshot,canonicalWeekJSON,summarizeWeekDay} from '../src/lib/weekSetup.ts';
import {loadWeekSetup,buildWeekApplyStatements,readWeekJson} from '../src/lib/weekSetupDb.ts';
import {weekFixture,example,maximum,request,snapshot,revision,assertPreserved,entry,addConstraints,addAvailability,historySQL} from './helpers/week-setup-fixture.mjs';
import {capacityEvidenceSQL,workingDaysEvidenceSQL,reviewLessons,evidenceRequest,reviewCapacity,unrelatedEvidenceSQL} from './helpers/week-setup-fixture.mjs';

test('review capacity 0 -> 2 demand 4: safe incremental setup is allowed with AFTER shortage',async t=>{
 const f=weekFixture(t);f.db.exec(capacityEvidenceSQL());const c=await loadWeekSetup(f.d1,1,40);
 const p=await planWeekSetup(c,evidenceRequest(c,reviewLessons(2)));
 t.diagnostic(JSON.stringify({can_apply:p.can_apply,warnings:p.warnings,blockers:p.blockers}));
 assert.equal(p.can_apply,true);assert.ok(p.warnings.some(n=>n.code==='existing_teacher_load_exceeds_availability'));
 assert.ok(!p.warnings.some(n=>n.code==='existing_teacher_no_available_slots'));
});
test('review actual days 1 -> 2 limit 1: multi-entry days must block activation',async t=>{
 const f=weekFixture(t);f.db.exec(workingDaysEvidenceSQL());const c=await loadWeekSetup(f.d1,1,41);
 const p=await planWeekSetup(c,evidenceRequest(c,reviewLessons(),1));
 t.diagnostic(JSON.stringify({can_apply:p.can_apply,warnings:p.warnings,blockers:p.blockers}));
 assert.equal(p.can_apply,false);assert.ok(p.blockers.some(n=>n.code==='teacher_max_working_days'));
});

for(const [beforeCapacity,afterCapacity,day] of [[2,3,0],[0,4,0],[0,2,1]])
test(`review capacity ${beforeCapacity} -> ${afterCapacity} day ${day}: AFTER evidence and preserved demand`,async t=>{
 const f=weekFixture(t);f.db.exec(capacityEvidenceSQL(beforeCapacity));const c=await loadWeekSetup(f.d1,1,40),before=snapshot(f.db);
 assert.equal(reviewCapacity(c).hard_weekly_capacity,beforeCapacity);
 const p=await planWeekSetup(c,evidenceRequest(c,reviewLessons(afterCapacity),day));assert.equal(p.can_apply,true);
 const warning=p.warnings.find(n=>n.evidence?.dimension==='capacity_deficit');
 if(afterCapacity<4)assert.deepEqual(warning.evidence,{dimension:'capacity_deficit',actual:4,limit:afterCapacity,excess:4-afterCapacity});
 else assert.equal(warning,undefined,'resolved shortage must not remain as an obsolete warning');
 await f.d1.batch(buildWeekApplyStatements(f.d1,1,40,p).statements);const after=snapshot(f.db);assertPreserved(before,after);
 const summary=reviewCapacity(await loadWeekSetup(f.d1,1,40));assert.equal(summary.hard_weekly_capacity,afterCapacity);assert.equal(summary.assigned_weekly_periods,4);assert.equal(summary.feasible,afterCapacity>=4);
 assert.deepEqual(after.timetable_slots.filter(s=>s.academic_year_id!==40||s.day_of_week!==day),before.timetable_slots.filter(s=>s.academic_year_id!==40||s.day_of_week!==day));
});
test('review unchanged shortage: harmless metadata save retains truthful warning, not a readiness claim',async t=>{
 const f=weekFixture(t);f.db.exec(capacityEvidenceSQL(2));const c=await loadWeekSetup(f.d1,1,40),before=snapshot(f.db);
 const p=await planWeekSetup(c,evidenceRequest(c,reviewLessons(2).map((s,i)=>({...s,label:'Label '+i}))));
 assert.equal(p.can_apply,true);assert.deepEqual(p.warnings[0].evidence,{dimension:'capacity_deficit',actual:4,limit:2,excess:2});
 await f.d1.batch(buildWeekApplyStatements(f.d1,1,40,p).statements);assertPreserved(before,snapshot(f.db));
 assert.equal(reviewCapacity(await loadWeekSetup(f.d1,1,40)).feasible,false);
});
for(const limit of [1,2])test(`review actual days 2 -> 3 limit ${limit}: new OR worsened aggregate rejected`,async t=>{
 const f=weekFixture(t);f.db.exec(workingDaysEvidenceSQL({limit,activeDays:2,occupiedDays:3}));const c=await loadWeekSetup(f.d1,1,41),before=snapshot(f.db);
 const p=await planWeekSetup(c,evidenceRequest(c,reviewLessons(),2));assert.equal(p.can_apply,false);
 const issue=p.blockers.find(n=>n.code==='teacher_max_working_days');assert.deepEqual(issue.evidence,{dimension:'working_days',actual:3,limit,excess:3-limit});
 assert.throws(()=>buildWeekApplyStatements(f.d1,1,41,p),e=>e.code==='blocked_week_setup');assert.deepEqual(snapshot(f.db),before);
});
for(const limit of [1,2])test(`review same-day multiple lessons and harmless edit with limit ${limit}`,async t=>{
 const f=weekFixture(t);f.db.exec(workingDaysEvidenceSQL({limit,activeDays:2}));const c=await loadWeekSetup(f.d1,1,41);
 const p=await planWeekSetup(c,evidenceRequest(c,reviewLessons().map(s=>({...s,label:'Harmless'})),0));assert.equal(p.can_apply,true);
 const warning=p.warnings.find(n=>n.code==='existing_teacher_max_working_days');
 if(limit===1)assert.deepEqual(warning.evidence,{dimension:'working_days',actual:2,limit:1,excess:1});
 else assert.equal(warning,undefined,'four lessons across two days must not count as four days');
});
test('review safe activation respects same-teacher multi-class occupancy and excludes inactive periods',async t=>{
 const f=weekFixture(t);f.db.exec(workingDaysEvidenceSQL());f.db.exec('UPDATE timetable_slots SET is_active=0 WHERE academic_year_id=41 AND day_of_week=1');
 const c=await loadWeekSetup(f.d1,1,41),p=await planWeekSetup(c,evidenceRequest(c,reviewLessons().map(s=>({...s,is_active:0})),1));
 assert.equal(p.can_apply,true);assert.ok(![...p.warnings,...p.blockers].some(n=>n.code.includes('working_days')));
 assert.ok(p.warnings.some(n=>n.code==='existing_inactive_slot'),'inactive-period repair remains visible');
});
test('review scope: unrelated teacher violation remains visible; foreign school/year cannot contaminate safe activation',async t=>{
 const f=weekFixture(t);f.db.exec(workingDaysEvidenceSQL({limit:3,activeDays:2,occupiedDays:3})+unrelatedEvidenceSQL);
 const c=await loadWeekSetup(f.d1,1,41),before=snapshot(f.db),p=await planWeekSetup(c,evidenceRequest(c,reviewLessons(),2));
 assert.ok(c.loads.every(l=>l.school_id===1&&l.academic_year_id===41));assert.equal(p.can_apply,true);assert.equal(p.blockers.length,0);
 assert.equal(p.warnings.length,1);assert.equal(p.warnings[0].employee_id,2);assert.deepEqual(p.warnings[0].evidence,{dimension:'working_days',actual:2,limit:1,excess:1});
 await f.d1.batch(buildWeekApplyStatements(f.d1,1,41,p).statements);assertPreserved(before,snapshot(f.db),['timetable_days','timetable_revisions']);
});

test('generator: exact labelled example, separate numbering and integer-minute totals',()=>{
 const p=example();assert.deepEqual(p.map(p=>[p.start_time,p.end_time]),[['13:00','13:35'],['13:35','14:10'],['14:10','14:25'],['14:25','15:00'],['15:00','15:35'],['15:35','15:45'],['15:45','16:20'],['16:20','16:55'],['16:55','17:30']]);
 assert.deepEqual(p.filter(p=>p.slot_type==='lesson').map(p=>p.lesson_number),[1,2,3,4,5,6,7]);assert.deepEqual(p.filter(p=>p.slot_type==='break').map(p=>p.lesson_number),[null,null]);
 const s=summarizeWeekDay(0,p);assert.equal(s.teaching_minutes,245);assert.equal(s.break_minutes,25);assert.equal(s.elapsed_minutes,270);assert.equal(s.last_end,'17:30');
 assert.deepEqual(p.map(p=>p.slot_index),[1,2,3,4,5,6,7,8,9]);assert.ok(p.every(p=>p.is_active===1));
});
test('no-break day, labelled multiple breaks and maximum size',()=>{
 assert.equal(maximum().length,30);
 const p=generateWeekTemplate({start_time:'07:00',lesson_count:3,lesson_minutes:25,breaks:[{after_lesson:1,minutes:5,label:'Short'},{after_lesson:2,minutes:10}]});
 assert.equal(p[3].label,'استراحة 2');assert.equal(p.at(-1).end_time,'08:30');
});
test('manual different durations and valid gaps are preserved until explicit recalculation',()=>{
 const p=[{...example()[0],start_time:'08:00',end_time:'08:25'},{...example()[1],start_time:'09:00',end_time:'09:45',is_active:0}];
 assert.deepEqual(validateWeekTemplate(p),p);const q=recalculateWeekTimes(p,'10:00');assert.equal(q[0].end_time,'10:25');assert.equal(q[1].start_time,'10:25');assert.equal(q[1].end_time,'11:10');assert.equal(p[1].start_time,'09:00');
});
for(const bad of [0,-1,1.5,NaN,Infinity,'7'])test(`reject invalid generator count/duration ${String(bad)}`,()=>{
 assert.throws(()=>generateWeekTemplate({start_time:'08:00',lesson_count:bad,lesson_minutes:40,breaks:[]}));
 assert.throws(()=>generateWeekTemplate({start_time:'08:00',lesson_count:3,lesson_minutes:bad,breaks:[]}));
});
test('break rules and midnight/time boundaries fail explicitly',()=>{
 for(const after_lesson of [0,3,4,-1,1.5])assert.throws(()=>generateWeekTemplate({start_time:'08:00',lesson_count:3,lesson_minutes:40,breaks:[{after_lesson,minutes:5}]}));
 assert.throws(()=>generateWeekTemplate({start_time:'08:00',lesson_count:3,lesson_minutes:40,breaks:[{after_lesson:1,minutes:5},{after_lesson:1,minutes:10}]}));
 assert.throws(()=>generateWeekTemplate({start_time:'23:00',lesson_count:2,lesson_minutes:40,breaks:[]}));
 for(const time of ['24:00','8:00','08:60','-1:30','08:00:00',' 08:00','12:00Z'])assert.throws(()=>minuteOfDay(time));
 assert.throws(()=>bellTime(1440));assert.throws(()=>bellTime(1.5));assert.equal(bellTime(1439),'23:59');
});
test('strict period labels, identity, activation, overlaps including inactive, count and types',()=>{
 for(const patch of [{slot_index:0},{slot_index:1.1},{label:''},{label:'  '},{label:'x'.repeat(121)},{label:'line\nline'},{is_active:true},{is_active:2},{lesson_number:null},{slot_type:'break'},{start_time:'13:35'},{end_time:'12:00'},{destination_id:42}])assert.throws(()=>validateWeekTemplate([{...example()[0],...patch}]));
 assert.throws(()=>validateWeekTemplate([]));assert.throws(()=>validateWeekTemplate([...maximum(),example()[0]]));
 assert.throws(()=>validateWeekTemplate([example()[0],{...example()[1],slot_index:1}]));
 assert.throws(()=>validateWeekTemplate([example()[0],{...example()[1],lesson_number:1}]));
 assert.throws(()=>validateWeekTemplate([example()[0],{...example()[1],start_time:'13:05',is_active:0}]));
 assert.throws(()=>validateWeekTemplate([{...example()[2]}]));
 assert.throws(()=>validateWeekTemplate([example()[0],{...example()[2],slot_type:['break']}]));
});
test('strict request unknown/unsafe IDs, targets, source exclusion, confirmation and deterministic canonical JSON',()=>{
 const base={school_id:1,academic_year_id:1,expected_revision:0,mode:'fill_empty_days',source_day_of_week:null,targets:[{day_of_week:1,activate_day:false}],template:example()};
 for(const patch of [{school_id:1.5},{school_id:0},{school_id:Number.MAX_SAFE_INTEGER+1},{academic_year_id:'1'},{expected_revision:-1},{source_day_of_week:undefined},{mode:'replace'},{targets:[]},{targets:[{day_of_week:7,activate_day:true}]},{targets:[{day_of_week:1,activate_day:1}]},{targets:[base.targets[0],base.targets[0]]},{source_day_of_week:1},{target_slot_ids:[1]}])assert.throws(()=>parseWeekRequest({...base,...patch}));
 for(const raw of [null,[],1,'x'])assert.throws(()=>parseWeekRequest(raw));
 assert.throws(()=>parseWeekRequest({...base,mode:['fill_empty_days']}));
 for(const patch of [{confirm_apply:false},{preview_digest:'x'},{acknowledge_availability_impact:1}])assert.throws(()=>parseWeekRequest({...base,confirm_apply:true,preview_digest:'a'.repeat(64),...patch},true));
 assert.equal(canonicalWeekJSON({b:1,a:{z:2,x:3}}),canonicalWeekJSON({a:{x:3,z:2},b:1}));
});
test('streamed body rejects oversized payload and invalid JSON before parsing',async()=>{
 await assert.rejects(readWeekJson(new Request('http://local',{method:'POST',body:'x'.repeat(32769)})),e=>e.status===413);
 await assert.rejects(readWeekJson(new Request('http://local',{method:'POST',body:'{'})),e=>e.code==='invalid_week_setup');
});

test('consistent snapshot/read-only preview never initializes revisions or days',async t=>{
 const f=weekFixture(t);f.db.exec("INSERT INTO academic_years(id,school_id,name,starts_at,ends_at,is_active) VALUES(4,1,'Fresh','2028-09-01','2029-06-01',0)");
 const before=snapshot(f.db),c=await loadWeekSetup(f.d1,1,4);assert.equal(c.revision,0);
 const p=await planWeekSetup(c,{...request(f),academic_year_id:4,expected_revision:0});assert.equal(p.can_apply,true);assert.deepEqual(snapshot(f.db),before);
 const pub=publicWeekSnapshot(c);assert.equal(pub.summary.length,7);assert.ok(pub.summary.every(d=>d.empty&&!d.is_active));
});
test('Sunday-Wednesday selected; Thursday exact rows unchanged; arbitrary subset independent of later source edits',async t=>{
 const f=weekFixture(t,true);const c=await loadWeekSetup(f.d1,1,1);
 const p=await planWeekSetup(c,request(f,example(),[0,1,2,3]));assert.equal(p.can_apply,true);
 await f.d1.batch(buildWeekApplyStatements(f.d1,1,1,p).statements);
 const before=snapshot(f.db);
 const q=await planWeekSetup(await loadWeekSetup(f.d1,1,1),request(f,[example()[0]],[4,6]));await f.d1.batch(buildWeekApplyStatements(f.d1,1,1,q).statements);
 const after=snapshot(f.db);assertPreserved(before,after);
 assert.deepEqual(after.timetable_slots.filter(s=>s.day_of_week!==4&&s.day_of_week!==6),before.timetable_slots);
 assert.equal(after.timetable_slots.filter(s=>s.school_id===1&&s.academic_year_id===1&&s.day_of_week===4).length,1);
 assert.equal(after.timetable_slots.filter(s=>s.day_of_week===5).length,0);
 const copyReq={...request(f,example(),[5]),source_day_of_week:0};const copy=await planWeekSetup(await loadWeekSetup(f.d1,1,1),copyReq);await f.d1.batch(buildWeekApplyStatements(f.d1,1,1,copy).statements);
 const dest=snapshot(f.db).timetable_slots.filter(s=>s.school_id===1&&s.academic_year_id===1&&s.day_of_week===5);
 f.db.exec("UPDATE timetable_slots SET label='source-only' WHERE school_id=1 AND academic_year_id=1 AND day_of_week=0 AND slot_index=1");
 assert.deepEqual(snapshot(f.db).timetable_slots.filter(s=>s.school_id===1&&s.academic_year_id===1&&s.day_of_week===5),dest);
 await assert.rejects(planWeekSetup(await loadWeekSetup(f.d1,1,1),copyReq),e=>e.code==='stale_week_setup');
});
test('explicit activation; saved day order/ID preserved; skipped inactive-only day never activated',async t=>{
 const f=weekFixture(t);f.db.exec('UPDATE timetable_slots SET is_active=0 WHERE id=6; UPDATE timetable_days SET is_active=0,order_index=10 WHERE school_id=1 AND academic_year_id=1 AND day_of_week=1');
 const c=await loadWeekSetup(f.d1,1,1),before=snapshot(f.db);
 const p=await planWeekSetup(c,{...request(f,example(),[1,3]),targets:[{day_of_week:1,activate_day:true},{day_of_week:3,activate_day:false}]});
 assert.equal(p.can_apply,false);assert.equal(p.days[0].action,'skipped_existing');assert.equal(p.days[0].activate_day,false);assert.equal(p.days[1].blockers[0].code,'activation_required');assert.deepEqual(snapshot(f.db),before);
 assert.equal(publicWeekSnapshot(c).summary.at(-1).day_of_week,1);
});
test('matching preserves ID, extras and inactive state; exact rows are genuine no-ops',async t=>{
 const f=weekFixture(t),c=await loadWeekSetup(f.d1,1,1),template=c.slots.filter(s=>s.day_of_week===0).map(periodValues);
 const p=await planWeekSetup(c,request(f,template.slice(0,2),[0],'update_matching_keep_extra'));assert.equal(p.no_change,true);assert.equal(p.counts.unchanged,2);assert.equal(p.counts.retained,3);
 const changed=template.slice(0,2).map(s=>({...s,label:s.label+' edited'}));const plan=await planWeekSetup(c,request(f,changed,[0],'update_matching_keep_extra'));
 const before=snapshot(f.db);await f.d1.batch(buildWeekApplyStatements(f.d1,1,1,plan).statements);const after=snapshot(f.db);
 assertPreserved(before,after);assert.deepEqual(after.timetable_slots.filter(s=>s.id!==1&&s.id!==2),before.timetable_slots.filter(s=>s.id!==1&&s.id!==2));
 assert.deepEqual(after.timetable_slots.map(s=>s.id).sort(),before.timetable_slots.map(s=>s.id).sort());
});
test('retained extras overlap, incompatible identity and active differences block before write',async t=>{
 const f=weekFixture(t),c=await loadWeekSetup(f.d1,1,1),old=periodValues(c.slots[0]);
 for(const patch of [{end_time:'09:00'},{lesson_number:8},{is_active:0},{slot_type:'break',lesson_number:null}]){
  const p=await planWeekSetup(c,request(f,[{...old,...patch},periodValues(c.slots[1])],[0],'update_matching_keep_extra'));assert.equal(p.can_apply,false);
 }
 const retainedConflict=await planWeekSetup(c,request(f,[{...periodValues(c.slots[1]),end_time:'09:40'}],[0],'update_matching_keep_extra'));
 assert.ok(retainedConflict.days[0].blockers.some(n=>n.code==='period_overlap'));
});
for(const shift of [-20,20])test(`safe ${shift<0?'earlier':'later'} chain updates deterministic layers and preserves IDs`,async t=>{
 const f=weekFixture(t),c=await loadWeekSetup(f.d1,1,1),old=c.slots.filter(s=>s.day_of_week===0);
 const p=await planWeekSetup(c,request(f,old.map(s=>({...periodValues(s),start_time:bellTime(minuteOfDay(s.start_time)+shift),end_time:bellTime(minuteOfDay(s.end_time)+shift)})),[0],'update_matching_keep_extra'));
 assert.equal(p.can_apply,true);assert.deepEqual(p.update_layers.flat(),old.map(s=>s.id)[shift<0?'slice':'reverse']());
 await f.d1.batch(buildWeekApplyStatements(f.d1,1,1,p).statements);assert.equal(f.db.prepare('SELECT start_time FROM timetable_slots WHERE id=1').get().start_time,shift<0?'07:40':'08:20');
});
test('cyclic identity-preserving time swap blocked during preview, no parking/deletion',async t=>{
 const f=weekFixture(t),c=await loadWeekSetup(f.d1,1,1),before=snapshot(f.db);const p=c.slots.filter(s=>s.day_of_week===0).map(periodValues);
 const a=p[0],b=p[1];p[0]={...a,start_time:b.start_time,end_time:b.end_time};p[1]={...b,start_time:a.start_time,end_time:a.end_time};
 const plan=await planWeekSetup(c,request(f,p,[0],'update_matching_keep_extra'));assert.equal(plan.can_apply,false);assert.ok(plan.blockers.some(b=>b.code==='unsupported_update_order'));assert.deepEqual(snapshot(f.db),before);
});
test('scheduled/locked links reject time edits; metadata allowed, immutable history/overrides preserved',async t=>{
 const f=weekFixture(t);entry(f.db,2,1,1);addAvailability(f.db,2,1,'preferred');f.db.exec(historySQL);
 const c=await loadWeekSetup(f.d1,1,1),p=c.slots.filter(s=>s.day_of_week===0).map(periodValues),before=snapshot(f.db);
 const bad=await planWeekSetup(c,request(f,[{...p[0],start_time:'07:50'}],[0],'update_matching_keep_extra'));assert.equal(bad.can_apply,false);assert.ok(bad.days[0].blockers.some(n=>n.code==='slot_has_scheduled_entries'));
 assert.deepEqual(bad.days[0].impact,{scheduled_entries:1,locked_entries:1,availability_overrides:1,historical_references:1});
 const good=await planWeekSetup(c,request(f,[{...p[0],label:'New label'}],[0],'update_matching_keep_extra'));assert.equal(good.can_apply,true);await f.d1.batch(buildWeekApplyStatements(f.d1,1,1,good).statements);assertPreserved(before,snapshot(f.db));
});
test('availability-linked time edits retain same ID and expose acknowledgement/history without changing links',async t=>{
 const f=weekFixture(t);addAvailability(f.db,2,1,'avoid');f.db.exec(historySQL);const c=await loadWeekSetup(f.d1,1,1),before=snapshot(f.db);
 const plan=await planWeekSetup(c,request(f,[{...periodValues(c.slots[0]),start_time:'07:50'}],[0],'update_matching_keep_extra'));
 assert.equal(plan.can_apply,true);assert.equal(plan.requires_availability_acknowledgement,true);assert.ok(plan.days[0].warnings.some(n=>n.code==='history_kept'));
 await f.d1.batch(buildWeekApplyStatements(f.d1,1,1,plan).statements);assertPreserved(before,snapshot(f.db));
});
test('moving a break cannot introduce consecutive violation; pre-existing unrelated repair remains visible',async t=>{
 const f=weekFixture(t);entry(f.db,2,3);entry(f.db,2,5);addConstraints(f.db,2,{max_consecutive_periods:1});
 entry(f.db,3,6); f.db.exec("UPDATE employees SET status='archived' WHERE id=6"); // An unrelated canonical repair item.
 const c=await loadWeekSetup(f.d1,1,1),before=snapshot(f.db),p=c.slots.filter(s=>s.day_of_week===0).map(periodValues);
 p[3]={...p[3],start_time:'11:00',end_time:'11:10'};
 const plan=await planWeekSetup(c,request(f,p,[0],'update_matching_keep_extra'));assert.equal(plan.can_apply,false);assert.ok(plan.blockers.some(b=>b.code==='teacher_max_consecutive_periods'));assert.ok(plan.warnings.some(w=>w.code==='existing_invalid_teaching_load'));assert.deepEqual(snapshot(f.db),before);
 assert.equal(plan.days[0].impact.scheduled_entries,2,'break change includes references on the affected day');
});
test('activation worsening an existing per-entry daily conflict is rejected, not hidden by same generic code',async t=>{
 const f=weekFixture(t);entry(f.db,2,1);entry(f.db,2,2);entry(f.db,2,3);addConstraints(f.db,2,{max_periods_per_day:1});
 f.db.exec('UPDATE timetable_days SET is_active=0 WHERE school_id=1 AND academic_year_id=1 AND day_of_week=0');
 const c=await loadWeekSetup(f.d1,1,1),p=c.slots.filter(s=>s.day_of_week===0).map(periodValues);
 const plan=await planWeekSetup(c,{...request(f,p,[0],'update_matching_keep_extra'),targets:[{day_of_week:0,activate_day:true}]});assert.equal(plan.can_apply,false);assert.ok(plan.blockers.some(b=>b.code==='teacher_max_periods_per_day'));
});
