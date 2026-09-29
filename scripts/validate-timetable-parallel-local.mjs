// Disposable generated fixtures, real local workerd D1, authenticated handlers.
// Never uses remote bindings, project env files, seed.sql, or a shared database.
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {getPlatformProxy} from 'wrangler';
import {createServer} from 'vite';
import {signJWT} from '../src/lib/jwtSecurity.ts';
import {solvePreparedTimetable} from '../src/lib/timetableSolverPrepared.ts';
import {root,migrationFiles,fixtureSQL} from '../test/helpers/teaching-load-matrix-fixture.mjs';

const directory=mkdtempSync(join(tmpdir(),'smart-school-parallel-local-'));
const configPath=join(directory,'wrangler.json'),state=join(directory,'state'),database='parallel-local-only';
mkdirSync(join(directory,'migrations'));
for(const file of migrationFiles)copyFileSync(join(root,'migrations',file),join(directory,'migrations',file));
writeFileSync(configPath,JSON.stringify({name:database,compatibility_date:'2026-09-29',d1_databases:[{binding:'DB',database_name:database,database_id:'00000000-0000-0000-0000-000000000049',migrations_dir:'migrations'}]},null,2));
function run(args){
 assert.ok(!args.includes('--remote'));assert.ok(args.includes(database));
 const r=spawnSync(process.execPath,[join(root,'node_modules/wrangler/bin/wrangler.js'),...args,'--local','--config',configPath,'--persist-to',state],{cwd:directory,encoding:'utf8',env:{...process.env,CI:'true',WRANGLER_SEND_METRICS:'false'},timeout:180000,maxBuffer:10_000_000});
 assert.equal(r.status,0,r.stdout+'\n'+r.stderr);return r.stdout;
}
run(['d1','migrations','apply',database]);console.log('Applied real local migrations:',migrationFiles.length);
const generated=join(directory,'generated-fixtures.sql');writeFileSync(generated,fixtureSQL+'UPDATE timetable_teaching_loads SET employee_id=1 WHERE id=1;');
run(['d1','execute',database,'--file',generated]);
const proxy=await getPlatformProxy({configPath,persist:{path:join(state,'v3')},remoteBindings:false,envFiles:[]});
const vite=await createServer({root,appType:'custom',server:{middlewareMode:true,hmr:false}}),evidence=[];
try{
 const db=proxy.env.DB,{default:app}=await vite.ssrLoadModule('/src/worker.ts');
 assert.equal((await db.prepare('PRAGMA foreign_keys').first()).foreign_keys,1);
 const secret='generated-local-parallel-test-secret-not-used-remotely',token=await signJWT({id:1,email:'owner@matrix.test',auth_version:1},secret);
 let failNextBatch=false,beforeNextWrite=null;
 const wrap=(real,sql)=>({real,sql,bind(...args){return wrap(real.bind(...args),sql);},first:(...a)=>real.first(...a),all:(...a)=>real.all(...a),run:(...a)=>real.run(...a)});
 const guarded={prepare:sql=>wrap(db.prepare(sql),sql),async batch(statements){const real=statements.map(s=>s.real);if(beforeNextWrite&&statements.some(s=>/^\s*(INSERT|UPDATE|DELETE)/i.test(s.sql))){const callback=beforeNextWrite;beforeNextWrite=null;await callback();}if(failNextBatch&&statements.some(s=>/^\s*(INSERT|UPDATE|DELETE)/i.test(s.sql))){failNextBatch=false;real.push(db.prepare('SELECT * FROM intentional_parallel_late_failure'));}return db.batch(real);}};
 const call=async(method,path,input)=>{const response=await app.request('http://localhost/api/timetable/'+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(input)},{DB:guarded,JWT_SECRET:secret,APP_ENV:'test'});return {status:response.status,body:await response.json()};};
 const scope={school_id:1,academic_year_id:1},pairBody={...scope,class_id:1,section_id:1,subject_id:2,employee_id:2,weekly_periods:4,parallel_with_load_id:1};
 const rows=async()=> (await db.prepare('SELECT * FROM timetable_entries WHERE school_id=1 AND academic_year_id=1 ORDER BY teaching_load_id').all()).results;
 const snapshot=async()=>{const tables=(await db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all()).results;const pairs=[];for(const {name} of tables)pairs.push([name,(await db.prepare(`SELECT * FROM "${name}"`).all()).results.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))]);return Object.fromEntries(pairs);};
 const revision=async()=>Number((await db.prepare('SELECT revision FROM timetable_revisions WHERE school_id=1 AND academic_year_id=1').first()).revision);
 let r=await call('POST','entries',{...scope,slot_id:1,teaching_load_id:1});assert.equal(r.status,201,JSON.stringify(r));const id=r.body.data.id;
 await db.prepare('UPDATE timetable_entries SET created_by_user_id=NULL WHERE id=?').bind(id).run();
 r=await call('POST','teaching-loads',pairBody);assert.equal(r.status,201,JSON.stringify(r));const companion=r.body.data.id;
 assert.equal((await rows()).length,2);assert.equal((await rows()).find(e=>e.id===id).created_by_user_id,null);
 evidence.push({case:'link-existing-primary-with-null-author',entries:2,companion});
 r=await call('PUT',`entries/${id}`,{...scope,slot_id:2});assert.equal(r.status,200,JSON.stringify(r));assert.ok((await rows()).every(e=>e.slot_id===2));
 let before=await snapshot();failNextBatch=true;r=await call('PUT',`entries/${id}`,{...scope,slot_id:3});assert.equal(r.status,500,JSON.stringify(r));assert.equal(failNextBatch,false);assert.deepEqual(await snapshot(),before);
 evidence.push({case:'pair-move-and-late-failure',atomic_rollback:true});
 r=await call('PUT',`entries/${id}/lock`,{...scope,is_locked:1});assert.equal(r.status,200);assert.ok((await rows()).every(e=>e.is_locked===1));
 before=await snapshot();r=await call('DELETE','teaching-loads/1',scope);assert.equal(r.status,409);assert.equal(r.body.data.locked_count,1);assert.deepEqual(await snapshot(),before);
 const survivor=(await rows()).find(e=>e.teaching_load_id===companion),confirmed={...scope,confirm_deactivate_scheduled:true,expected_revision:r.body.data.revision};
 failNextBatch=true;r=await call('DELETE','teaching-loads/1',confirmed);assert.equal(r.status,409,JSON.stringify(r));assert.deepEqual(await snapshot(),before);
 r=await call('DELETE','teaching-loads/1',confirmed);assert.equal(r.status,200,JSON.stringify(r));assert.deepEqual(await rows(),[survivor]);
 const saved=await snapshot(),archive=JSON.parse(saved.timetable_week_archives[0].snapshot_json);
 assert.deepEqual(archive.entries,before.timetable_entries.filter(e=>e.teaching_load_id===1));assert.equal(saved.timetable_teaching_loads.find(l=>l.id===companion).parallel_with_load_id,null);
 for(const table of Object.keys(before))if(!['timetable_entries','timetable_teaching_loads','timetable_revisions','timetable_week_archives'].includes(table))assert.deepEqual(saved[table],before[table],table);
 await assert.rejects(db.prepare('UPDATE timetable_week_archives SET source_revision=0').run(),/immutable/);
 evidence.push({case:'confirmed-locked-primary-exclusion',survivor_unchanged:true,archived_entries:1,late_failure_rolled_back:true,archive_immutable:true});
 // Recreate the primary as the companion: test removing the linked child too.
 r=await call('POST','teaching-loads',{...pairBody,subject_id:1,employee_id:1,parallel_with_load_id:companion});assert.equal(r.status,201,JSON.stringify(r));const second=r.body.data.id;
 const secondEntry=(await rows()).find(e=>e.teaching_load_id===second),relinkedSurvivor=(await rows()).find(e=>e.teaching_load_id===companion);
 await db.prepare(`INSERT INTO lesson_attendance_sessions(school_id,academic_year_id,timetable_entry_id,session_date,day_of_week,slot_id,teaching_load_id,teacher_employee_id,class_id,section_id,subject_id,lesson_number,start_time_snapshot,end_time_snapshot,teacher_name_snapshot,class_name_snapshot,section_name_snapshot,subject_name_snapshot,status,created_by_user_id,updated_by_user_id)
 SELECT e.school_id,e.academic_year_id,e.id,'2026-09-06',s.day_of_week,s.id,l.id,l.employee_id,l.class_id,l.section_id,l.subject_id,s.lesson_number,s.start_time,s.end_time,'Teacher','Class','A','Subject','draft',1,1 FROM timetable_entries e JOIN timetable_slots s ON s.id=e.slot_id JOIN timetable_teaching_loads l ON l.id=e.teaching_load_id WHERE e.id=?`).bind(secondEntry.id).run();
 before=await snapshot();r=await call('DELETE',`teaching-loads/${second}`,{...scope,confirm_deactivate_scheduled:true,expected_revision:await revision()});assert.equal(r.status,409);assert.equal(r.body.code,'pending_attendance_drafts');assert.deepEqual(await snapshot(),before);
 await db.prepare("UPDATE lesson_attendance_sessions SET status='confirmed',confirmed_at=unixepoch(),confirmed_by_user_id=1").run();
 const attendance=(await snapshot()).lesson_attendance_sessions;
 r=await call('DELETE',`teaching-loads/${second}`,{...scope,confirm_deactivate_scheduled:true,expected_revision:await revision()});assert.equal(r.status,200,JSON.stringify(r));assert.deepEqual(await rows(),[relinkedSurvivor]);assert.deepEqual((await snapshot()).lesson_attendance_sessions,attendance);
 evidence.push({case:'companion-exclusion-attendance',draft_blocked:true,confirmed_history_preserved:true,survivor_unchanged:true});
 // A separate generated year exercises browser preparation and the new atomic
 // dormant-reference guard against genuine workerd D1, including numbered binds.
 await db.batch([
  db.prepare("INSERT INTO academic_years(id,school_id,name,starts_at,ends_at,is_active) VALUES(99,1,'Generated guard year','2030-09-01','2031-06-01',0)"),
  db.prepare('INSERT INTO timetable_days(school_id,academic_year_id,day_of_week,is_active,order_index) VALUES(1,99,0,1,0)'),
  db.prepare("INSERT INTO timetable_slots(id,school_id,academic_year_id,day_of_week,slot_index,slot_type,lesson_number,label,start_time,end_time,is_active) VALUES(99,1,99,0,1,'lesson',1,'Generated','08:00','08:40',1)"),
  db.prepare("UPDATE sections SET status='active' WHERE id=4"),
  db.prepare("INSERT INTO timetable_teaching_loads(id,school_id,academic_year_id,class_id,section_id,subject_id,employee_id,weekly_periods,status) VALUES(990,1,99,1,1,1,1,1,'active'),(991,1,99,1,4,1,1,1,'active')"),
  db.prepare("UPDATE sections SET status='archived' WHERE id=4"),
 ]);
 r=await call('POST','solver/prepare',{school_id:1,academic_year_id:99});assert.equal(r.status,200,JSON.stringify(r));
 const proposal=await solvePreparedTimetable(r.body.data);assert.equal(proposal.status,'complete');assert.equal(proposal.required_periods,1);
 const applyBody={school_id:1,academic_year_id:99,expected_revision:proposal.timetable_revision,
  proposal_digest:proposal.proposal_digest,generation_scope:proposal.generation_scope,confirm_apply:true,
  entries:proposal.entries.map(({slot_id,teaching_load_id,is_locked})=>({slot_id,teaching_load_id,is_locked}))};
 before=await snapshot();
 beforeNextWrite=()=>db.prepare("UPDATE sections SET status='active' WHERE id=4").run();
 r=await call('POST','solver/apply',applyBody);assert.equal(r.status,409,JSON.stringify(r));assert.equal(r.body.code,'stale_timetable_proposal');
 const afterRace=await snapshot();
 for(const table of ['timetable_entries','timetable_schedule_versions','timetable_schedule_version_entries','timetable_revisions','timetable_revision_assertions'])assert.deepEqual(afterRace[table],before[table],table);
 await db.prepare("UPDATE sections SET status='archived' WHERE id=4").run();
 r=await call('POST','solver/apply',applyBody);assert.equal(r.status,200,JSON.stringify(r));
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM timetable_entries WHERE school_id=1 AND academic_year_id=99').first()).n,1);
 assert.equal((await db.prepare("SELECT status FROM timetable_teaching_loads WHERE id=991").first()).status,'active');
 evidence.push({case:'prepared-browser-proposal-dormant-guard',real_d1_numbered_parameters:true,restoration_race_blocked:true,archive_rollback:true,unchanged_metadata_applies:true});
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM timetable_revision_assertions').first()).n,0);assert.equal((await db.prepare('SELECT COUNT(*) n FROM timetable_locked_entry_overrides').first()).n,0);assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
}finally{await vite.close();await proxy.dispose();}
const report={directory,migrations:migrationFiles.length,remote_d1:false,foreign_key_check:[],evidence};writeFileSync(join(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
