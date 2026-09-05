// Generated fixtures in a fresh OS-temp LOCAL D1 only. Never reads a remote
// binding, the project's .env, a user's credentials, or seed.sql.
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {getPlatformProxy} from 'wrangler';
import {loadWeekSetup,buildWeekApplyStatements} from '../src/lib/weekSetupDb.ts';
import {planWeekSetup,periodValues,minuteOfDay,bellTime} from '../src/lib/weekSetup.ts';
import {root,migrationFiles,fixtureSQL,historySQL,example,maximum,assertPreserved} from '../test/helpers/week-setup-fixture.mjs';

const directory=mkdtempSync(join(tmpdir(),'smart-school-phase19c-local-'));
const configPath=join(directory,'wrangler.json'),state=join(directory,'state');
mkdirSync(join(directory,'migrations'));
for(const file of migrationFiles)copyFileSync(join(root,'migrations',file),join(directory,'migrations',file));
writeFileSync(configPath,JSON.stringify({name:'phase19c-local-only',compatibility_date:'2026-04-13',d1_databases:[{binding:'DB',database_name:'phase19c-local-only',database_id:'00000000-0000-0000-0000-000000000019',migrations_dir:'migrations'}]},null,2));
const commands=[];
function run(args){
 assert.ok(!args.includes('--remote'));assert.ok(args.includes('phase19c-local-only'));
 const full=[join(root,'node_modules/wrangler/bin/wrangler.js'),...args,'--local','--config',configPath,'--persist-to',state];commands.push(full);
 const r=spawnSync(process.execPath,full,{cwd:directory,encoding:'utf8',env:{...process.env,CI:'true',WRANGLER_SEND_METRICS:'false'},timeout:180000,maxBuffer:10_000_000});
 writeFileSync(join(directory,`command-${commands.length}.log`),(r.stdout??'')+(r.stderr??''));
 assert.equal(r.status,0,r.stdout+'\n'+r.stderr);return r.stdout;
}
run(['d1','migrations','apply','phase19c-local-only']);console.log('Fresh real migration chain applied locally:',migrationFiles.length);
const generated=join(directory,'generated-local-fixtures.sql');
writeFileSync(generated,fixtureSQL+historySQL+`
INSERT INTO timetable_entries(school_id,academic_year_id,slot_id,teaching_load_id,is_locked,created_by_user_id,updated_by_user_id) VALUES(1,1,1,2,1,1,1);
INSERT INTO timetable_teacher_availability(school_id,academic_year_id,employee_id,slot_id,status) VALUES(1,1,2,1,'preferred');
INSERT INTO timetable_teacher_constraints(school_id,academic_year_id,employee_id,max_periods_per_day,max_working_days,max_consecutive_periods) VALUES(1,1,2,4,3,3);
INSERT INTO academic_years(id,school_id,name,starts_at,ends_at,is_active) VALUES(4,1,'LOCAL selective','2028-09-01','2029-06-01',0),(5,1,'LOCAL maximum','2029-09-01','2030-06-01',0);
`);
run(['d1','execute','phase19c-local-only','--file',generated]);
const proxy=await getPlatformProxy({configPath,persist:{path:join(state,'v3')},remoteBindings:false,envFiles:[]});
const evidence=[];let schemaCount=0;
try{
 const db=proxy.env.DB;
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM d1_migrations').first()).n,28);
 assert.equal((await db.prepare('PRAGMA foreign_keys').first()).foreign_keys,1);
 const schema=(await db.prepare("SELECT name,type FROM sqlite_schema WHERE type IN ('trigger','index') ORDER BY name").all()).results;
 const expected=['trg_timetable_slots_validate_insert','trg_timetable_slots_validate_update','trg_timetable_slots_preserve_entries','trg_timetable_slots_preserve_teacher_availability','trg_timetable_revision_assertions_validate_insert','trg_timetable_schedule_versions_immutable_update','trg_timetable_loads_validate_teacher_reassignment'];
 for(const name of expected)assert.ok(schema.some(s=>s.name===name),name);schemaCount=schema.length;
 const snap=async()=>{
  const tables=(await db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all()).results;
  const rows=await db.batch(tables.map(t=>db.prepare(`SELECT * FROM "${t.name}"`)));
  return Object.fromEntries(tables.map((t,i)=>[t.name,rows[i].results.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))]));
 };
 const initial=await snap();
 const make=async(year,template,targets,mode='fill_empty_days',source=null)=>{
  const c=await loadWeekSetup(db,1,year),input={school_id:1,academic_year_id:year,expected_revision:c.revision,mode,source_day_of_week:source,targets:targets.map(day_of_week=>({day_of_week,activate_day:!c.days.some(d=>d.day_of_week===day_of_week&&d.is_active===1)})),template};
  return {input,plan:await planWeekSetup(c,input)};
 };
 const commit=async(label,year,p)=>{
  assert.equal(p.plan.can_apply,true,JSON.stringify(p.plan.blockers));const batch=buildWeekApplyStatements(db,1,year,p.plan);
  const start=performance.now(),result=await db.batch(batch.statements);
  assert.equal(batch.createsIndex===null?0:result[batch.createsIndex].results.length,p.plan.counts.create);
  assert.equal(batch.updateIndexes.reduce((n,i)=>n+result[i].results.length,0),p.plan.counts.update);
  evidence.push({case:label,counts:p.plan.counts,production_batch_statements:batch.statements.length,layers:p.plan.update_layers.length,local_workerd_batch_ms:+(performance.now()-start).toFixed(2)});
 };
 const selective=await make(4,example(),[0,2,4]);await commit('selective-empty-week',4,selective);
 let saved=await snap();assertPreserved(initial,saved);assert.equal(saved.timetable_slots.filter(s=>s.academic_year_id===4).length,27);
 assert.deepEqual(saved.timetable_slots.filter(s=>s.academic_year_id!==4),initial.timetable_slots);
 const beforeCopy=await snap(),copy=await make(4,example(),[6],'fill_empty_days',0);await commit('copy-source-preserved',4,copy);
 saved=await snap();assert.deepEqual(saved.timetable_slots.filter(s=>s.academic_year_id===4&&s.day_of_week===0),beforeCopy.timetable_slots.filter(s=>s.academic_year_id===4&&s.day_of_week===0));
 const max=await make(5,maximum(),[0,1,2,3,4,5,6]);await commit('seven-by-thirty',5,max);assert.equal((await db.prepare('SELECT COUNT(*) n FROM timetable_slots WHERE academic_year_id=5').first()).n,210);
 const beforeShifts=await snap();
 for(const delta of [1,-1]){
  const c=await loadWeekSetup(db,1,5),template=c.slots.filter(s=>s.day_of_week===0).map(s=>({...periodValues(s),start_time:bellTime(minuteOfDay(s.start_time)+delta),end_time:bellTime(minuteOfDay(s.end_time)+delta)}));
  await commit(delta>0?'safe-later-30-cross-day-layers':'safe-earlier-30-cross-day-layers',5,await make(5,template,[0,1,2,3,4,5,6],'update_matching_keep_extra'));
 }
 const afterShifts=await snap();assertPreserved(beforeShifts,afterShifts);assert.deepEqual(afterShifts.timetable_slots.map(s=>s.id),beforeShifts.timetable_slots.map(s=>s.id));
 const current=await loadWeekSetup(db,1,1),old=periodValues(current.slots[0]);
 const blocked=await make(1,[{...old,start_time:'07:50'}],[0],'update_matching_keep_extra');assert.equal(blocked.plan.can_apply,false);assert.ok(blocked.plan.days[0].blockers.some(b=>b.code==='slot_has_scheduled_entries'));evidence.push({case:'linked-slot-time-rejection',no_write:true});
 const mixed=await make(1,[{...old,label:'Local metadata edit'}],[0,1,3],'update_matching_keep_extra'),beforeMixed=await snap();
 assert.equal(mixed.plan.can_apply,true);const batch=buildWeekApplyStatements(db,1,1,mixed.plan);
 await assert.rejects(db.batch([...batch.statements,db.prepare('SELECT * FROM phase19c_intentional_late_failure')]),/no such table/);
 assert.deepEqual(await snap(),beforeMixed);evidence.push({case:'late-failure-after-cleanup-and-response-query',every_application_table_equal:true,assertions_clean:true});
 await commit('mixed-create-activate-metadata-update-retained',1,mixed);const afterMixed=await snap();assertPreserved(beforeMixed,afterMixed);
 assert.deepEqual(afterMixed.timetable_slots.filter(s=>s.id!==1&&s.id!==6&&s.day_of_week!==3),beforeMixed.timetable_slots.filter(s=>s.id!==1&&s.id!==6&&s.day_of_week!==3));
 assert.deepEqual(afterMixed.timetable_entries,initial.timetable_entries);assert.deepEqual(afterMixed.timetable_teacher_availability,initial.timetable_teacher_availability);assert.deepEqual(afterMixed.timetable_teacher_constraints,initial.timetable_teacher_constraints);assert.deepEqual(afterMixed.timetable_schedule_versions,initial.timetable_schedule_versions);assert.deepEqual(afterMixed.timetable_schedule_version_entries,initial.timetable_schedule_version_entries);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM timetable_revision_assertions').first()).n,0);
 assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
}finally{await proxy.dispose();}
assert.match(run(['d1','migrations','list','phase19c-local-only']),/No migrations to apply/i);
const report={directory,migrations:migrationFiles,foreign_keys:1,foreign_key_check:[],schema_indexes_triggers_verified:schemaCount,production_builders:evidence,commands,remote_d1:false,shared_seed_or_reset:false};
writeFileSync(join(directory,'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
