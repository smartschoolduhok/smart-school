// Disposable LOCAL D1 only. No project database ID, auth token or seed is used.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
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
const report={directory:resolve(directory),fresh_migrations:28,upgrade_before:27,upgrade_after:28,unchanged_tables:Object.keys(before.data).length,
 preserved_loads:after.data.timetable_teaching_loads.length,preserved_entries:after.data.timetable_entries.length,preserved_versions:after.data.timetable_schedule_versions.length,
 preserved_locks:after.data.timetable_entries.filter(e=>e.is_locked===1).length,foreign_key_check:after.fk,
 platform_metadata_before:before.platformMetadata,platform_metadata_after:after.platformMetadata,
 reassignment:'NULL -> teacher 1 -> teacher 6 passed on local D1',commands};
writeFileSync(join(directory,'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
