// Disposable LOCAL D1 only. No project database ID, auth token or seed is used.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { getPlatformProxy } from 'wrangler';
import { loadTeachingLoadMatrix, buildMatrixApplyStatements } from '../src/lib/teachingLoadMatrixDb.ts';
import { planTeachingLoadMatrix } from '../src/lib/teachingLoadMatrix.ts';
import { root, migrationFiles, fixtureSQL, snapshot } from '../test/helpers/teaching-load-matrix-fixture.mjs';

const directory=mkdtempSync(join(tmpdir(),'smart-school-phase19b-local-'));
const wrangler=join(root,'node_modules/wrangler/bin/wrangler.js');
const commands=[];
function config(name,files){
 const path=join(directory,name); mkdirSync(path);mkdirSync(join(path,'migrations'));
 for(const file of files)copyFileSync(join(root,'migrations',file),join(path,'migrations',file));
 const configPath=join(path,'wrangler.json');
 writeFileSync(configPath,JSON.stringify({name:'phase19b-local-only',compatibility_date:'2026-04-13',d1_databases:[{binding:'DB',database_name:'phase19b-local-only',database_id:'00000000-0000-0000-0000-000000000019',migrations_dir:'migrations'}]},null,2));
 return {path,configPath,state:join(path,'state')};
}
function run(c,args){
 assert.ok(!args.includes('--remote'));
 const full=[wrangler,...args,'--local','--config',c.configPath,'--persist-to',c.state];
 commands.push([process.execPath,...full]);
 const result=spawnSync(process.execPath,full,{cwd:c.path,encoding:'utf8',env:{...process.env,CI:'true',WRANGLER_SEND_METRICS:'false'},timeout:180000,maxBuffer:10_000_000});
 writeFileSync(join(c.path,`command-${commands.length}.log`),(result.stdout??'')+(result.stderr??''));
 if(result.status!==0)throw new Error(`Local Wrangler failed: ${result.stdout}\n${result.stderr}`);
 return result.stdout;
}
function sqliteFile(dir){
 for(const d of readdirSync(dir,{withFileTypes:true})){
  const path=join(dir,d.name);
  if(d.isDirectory()){const child=sqliteFile(path);if(child)return child;}
  else if(d.name.endsWith('.sqlite')){
   const check=new DatabaseSync(path,{readOnly:true});
   const target=check.prepare("SELECT 1 FROM sqlite_schema WHERE name='d1_migrations'").get();
   check.close();if(target)return path;
  }
 }
}
function inspect(c){
 const db=new DatabaseSync(sqliteFile(c.state));
 const data=snapshot(db);delete data.d1_migrations;
 // workerd's internal commit counter is not application data and necessarily
 // advances for schema migrations. Preserve/report it separately.
 const platformMetadata=data._cf_METADATA; delete data._cf_METADATA;
 const fk=db.prepare('PRAGMA foreign_key_check').all();
 const schema=db.prepare("SELECT name,type,sql FROM sqlite_schema WHERE type IN ('index','trigger') ORDER BY name").all();
 const count=db.prepare('SELECT COUNT(*) n FROM d1_migrations').get().n;
 db.close();return {data,fk,schema,count,platformMetadata};
}
const fresh=config('fresh',migrationFiles);
run(fresh,['d1','migrations','apply','phase19b-local-only']);
console.log('Fresh local chain applied:',inspect(fresh).count);
assert.equal(inspect(fresh).count,28);assert.deepEqual(inspect(fresh).fk,[]);

const upgrade=config('upgrade',migrationFiles.filter(f=>!f.startsWith('0027')));
run(upgrade,['d1','migrations','apply','phase19b-local-only']);
const fixturePath=join(upgrade.path,'disposable-fixtures.sql');
writeFileSync(fixturePath,fixtureSQL+`
INSERT INTO timetable_entries(school_id,academic_year_id,slot_id,teaching_load_id,is_locked,created_by_user_id,updated_by_user_id) VALUES(1,1,1,1,1,1,1),(1,1,2,2,0,1,1);
INSERT INTO timetable_teacher_availability(school_id,academic_year_id,employee_id,slot_id,status) VALUES(1,1,1,1,'preferred');
INSERT INTO timetable_teacher_constraints(school_id,academic_year_id,employee_id,max_periods_per_day,max_working_days,max_consecutive_periods) VALUES(1,1,1,4,3,3);
INSERT INTO timetable_schedule_versions(id,version_key,school_id,academic_year_id,source,previous_revision,created_by_user_id,old_entry_count,new_entry_count,locked_entry_count,proposal_digest) VALUES(1,'local-upgrade',1,1,'automatic_adoption',0,1,2,2,1,'local-only');
INSERT INTO timetable_schedule_version_entries(version_id,school_id,academic_year_id,slot_id,teaching_load_id,is_locked) VALUES(1,1,1,1,1,1),(1,1,1,2,2,0);
`);
run(upgrade,['d1','execute','phase19b-local-only','--file',fixturePath]);
const before=inspect(upgrade);assert.equal(before.count,27);
copyFileSync(join(root,'migrations','0027_timetable_safe_teacher_reassignment.sql'),join(upgrade.path,'migrations','0027_timetable_safe_teacher_reassignment.sql'));
run(upgrade,['d1','migrations','apply','phase19b-local-only']);
const after=inspect(upgrade);
assert.equal(after.count,28);assert.deepEqual(after.data,before.data);assert.deepEqual(after.fk,[]);
assert.deepEqual(after.schema.filter(s=>s.type==='index'),before.schema.filter(s=>s.type==='index'));
for(const name of ['trg_timetable_loads_preserve_entries','trg_timetable_loads_validate_teacher_reassignment'])assert.ok(after.schema.some(s=>s.name===name));
// Exercise both originally blocked transitions on actual local workerd/D1.
run(upgrade,['d1','execute','phase19b-local-only','--command','UPDATE timetable_teaching_loads SET employee_id=1 WHERE id=1']);
run(upgrade,['d1','execute','phase19b-local-only','--command','UPDATE timetable_teaching_loads SET employee_id=6 WHERE id=1']);
const reassigned=inspect(upgrade);
assert.equal(reassigned.data.timetable_teaching_loads.find(l=>l.id===1).employee_id,6);
assert.deepEqual(reassigned.data.timetable_entries,before.data.timetable_entries);
assert.deepEqual(reassigned.data.timetable_schedule_version_entries,before.data.timetable_schedule_version_entries);
const pending=run(upgrade,['d1','migrations','list','phase19b-local-only']);
assert.match(pending,/No migrations to apply/i);
run(upgrade,['d1','execute','phase19b-local-only','--command','PRAGMA foreign_key_check']);

// Execute the production statement builder through Wrangler's LOCAL workerd
// D1 binding: bound JSON, UPDATE FROM, per-row triggers and batch rollback.
const proxy=await getPlatformProxy({configPath:upgrade.configPath,persist:{path:join(upgrade.state,'v3')},remoteBindings:false,envFiles:[]});
const setBased={};
try {
 const db=proxy.env.DB;
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM d1_migrations').first()).n,28);
 const liveSnapshot=async()=>{
  const {results:tables}=await db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all();
  const rows=await db.batch(tables.map(t=>db.prepare(`SELECT * FROM "${t.name}"`)));
  return Object.fromEntries(tables.map((t,i)=>[t.name,rows[i].results.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))]));
 };
 await db.batch([
  db.prepare("INSERT INTO timetable_teaching_loads(id,school_id,academic_year_id,class_id,section_id,subject_id,employee_id,weekly_periods,status) VALUES(20,1,1,1,1,3,NULL,2,'active')"),
  db.prepare("INSERT INTO timetable_teaching_loads(id,school_id,academic_year_id,class_id,section_id,subject_id,employee_id,weekly_periods,status) VALUES(21,1,1,1,2,2,6,2,'active')"),
 ]);
 const scope={school_id:1,academic_year_id:1,class_id:1};
 const changes=[
  {subject_id:1,section_id:1,action:'upsert',employee_id:2,weekly_periods:4},
  {subject_id:1,section_id:2,action:'upsert',employee_id:6,weekly_periods:4},
  {subject_id:2,section_id:1,action:'upsert',employee_id:null,weekly_periods:3},
  {subject_id:2,section_id:2,action:'upsert',employee_id:6,weekly_periods:2},
  {subject_id:3,section_id:1,action:'deactivate'},
 ];
 const beforeApply=await liveSnapshot();
 const plan=planTeachingLoadMatrix(await loadTeachingLoadMatrix(db,1,1,1),changes);assert.equal(plan.can_apply,true);
 const statements=buildMatrixApplyStatements(db,scope,plan,1);assert.equal(statements.length,8);
 await assert.rejects(db.batch([...statements,db.prepare('SELECT * FROM phase19b_injected_missing_table')]),/no such table/);
 assert.deepEqual(await liveSnapshot(),beforeApply);
 await db.batch(statements);
 const saved=await liveSnapshot();
 assert.equal(saved.timetable_teaching_loads.find(l=>l.id===1).employee_id,2);
 assert.equal(saved.timetable_teaching_loads.find(l=>l.id===2).employee_id,6);
 assert.equal(saved.timetable_teaching_loads.find(l=>l.id===20).status,'inactive');
 assert.deepEqual(saved.timetable_teaching_loads.find(l=>l.id===21),beforeApply.timetable_teaching_loads.find(l=>l.id===21));
 for(const name of Object.keys(saved).filter(n=>!['timetable_teaching_loads','timetable_revisions'].includes(n)))assert.deepEqual(saved[name],beforeApply[name],name);
 setBased.mixed={statements:8,counts:plan.counts,late_failure_rollback:true,coupled_swap:true,entries_locks_versions_preserved:true};

 const subjects=Array.from({length:500},(_,i)=>({id:100+i,name:'Local bulk '+i}));
 await db.prepare("INSERT INTO subjects(id,school_id,class_id,name,status) SELECT json_extract(value,'$.id'),1,2,json_extract(value,'$.name'),'active' FROM json_each(?)").bind(JSON.stringify(subjects)).run();
 const maxChanges=subjects.map(s=>({subject_id:s.id,section_id:null,action:'upsert',employee_id:1,weekly_periods:3}));
 for(const kind of ['creates','teacher_updates']){
  const p=planTeachingLoadMatrix(await loadTeachingLoadMatrix(db,1,1,2),maxChanges);assert.equal(p.can_apply,true);
  const batch=buildMatrixApplyStatements(db,{...scope,class_id:2},p,1);assert.equal(batch.length,kind==='creates'?5:6);
  const start=performance.now();await db.batch(batch);
  const rows=await db.prepare('SELECT id,employee_id,weekly_periods,updated_by_user_id FROM timetable_teaching_loads WHERE class_id=2 AND school_id=1 AND academic_year_id=1 AND subject_id>=100 ORDER BY id').all();
  assert.equal(rows.results.length,500);assert.ok(rows.results.every(l=>l.employee_id===(kind==='creates'?1:2)&&l.weekly_periods===3&&l.updated_by_user_id===1));
  if(kind==='creates')setBased.ids=rows.results.map(l=>l.id);else assert.deepEqual(rows.results.map(l=>l.id),setBased.ids);
  setBased[kind]={changes:500,statements:batch.length,ms:+(performance.now()-start).toFixed(2)};
  maxChanges.forEach(c=>{c.employee_id=2;});
 }
 delete setBased.ids;
 assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
 setBased.foreign_key_check=[];
} finally {await proxy.dispose();}
const report={directory:resolve(directory),fresh_migrations:28,upgrade_before:27,upgrade_after:28,unchanged_tables:Object.keys(before.data).length,
 preserved_loads:after.data.timetable_teaching_loads.length,preserved_entries:after.data.timetable_entries.length,preserved_versions:after.data.timetable_schedule_versions.length,
 preserved_locks:after.data.timetable_entries.filter(e=>e.is_locked===1).length,foreign_key_check:after.fk,
 platform_metadata_before:before.platformMetadata,platform_metadata_after:after.platformMetadata,
 reassignment:'NULL -> teacher 1 -> teacher 6 passed on local D1',set_based_local_D1:setBased,commands};
writeFileSync(join(directory,'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
