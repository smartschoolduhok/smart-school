// Exercise the upgrade and production API on disposable workerd D1. No remote mode.
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {getPlatformProxy,unstable_splitSqlQuery} from 'wrangler';
import {createServer} from 'vite';
import {root,migrationFiles,baseFixtureSQL,schoolWorkflowFixtureSQL,request} from '../test/helpers/school-workflow-fixture.mjs';
import {contentSnapshot,digest} from './lib/local-d1-restore.mjs';
const directory=mkdtempSync(join(tmpdir(),'smart-school-workflows-local-')),configPath=join(directory,'wrangler.json'),state=join(directory,'state');
mkdirSync(join(directory,'migrations'));
const name='school-workflows-local-only';
writeFileSync(configPath,JSON.stringify({name,compatibility_date:'2026-04-13',d1_databases:[{binding:'DB',database_name:name,database_id:'00000000-0000-0000-0000-000000000045',migrations_dir:'migrations'}]}));
function migrate(){const args=[join(root,'node_modules/wrangler/bin/wrangler.js'),'d1','migrations','apply',name,'--local','--config',configPath,'--persist-to',state];assert.equal(args.includes('--remote'),false);const env={...process.env,CI:'true',WRANGLER_SEND_METRICS:'false'};for(const key of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy'])delete env[key];const r=spawnSync(process.execPath,args,{cwd:directory,env,encoding:'utf8',timeout:180000,maxBuffer:20000000});assert.equal(r.status,0,r.stdout+r.stderr);}
const open=()=>getPlatformProxy({configPath,persist:{path:join(state,'v3')},remoteBindings:false,envFiles:[]});
console.log('LOCAL workflow artifacts: '+directory);
for(const file of migrationFiles.slice(0,-4))copyFileSync(join(root,'migrations',file),join(directory,'migrations',file));migrate();
let proxy=await open(),before;
try{await proxy.env.DB.batch(unstable_splitSqlQuery(baseFixtureSQL+schoolWorkflowFixtureSQL).map(sql=>proxy.env.DB.prepare(sql)));before=await contentSnapshot(async sql=>(await proxy.env.DB.prepare(sql).all()).results);}finally{await proxy.dispose();}
for(const file of migrationFiles.slice(-4))copyFileSync(join(root,'migrations',file),join(directory,'migrations',file));migrate();
proxy=await open();const vite=await createServer({root,appType:'custom',server:{middlewareMode:true,hmr:false}});
const cases=[];
try{
 const db=proxy.env.DB,after=await contentSnapshot(async sql=>(await db.prepare(sql).all()).results);
 for(const old of before.schema)assert.deepEqual(after.schema.find(item=>item.type===old.type&&item.name===old.name),old,old.name);
 for(const [name,value] of Object.entries(before.tables))if(!['d1_migrations','sqlite_sequence'].includes(name))assert.deepEqual(after.tables[name],value,name);
 assert.equal(Object.keys(after.tables).length,95);assert.equal(after.tables.d1_migrations.count,46);assert.deepEqual(after.foreignKeys,[]);cases.push('upgrade 42→46 preserves every historical application value and type');
 const {default:app}=await vite.ssrLoadModule('/src/worker.ts'),f={d1:db};
 const call=async(role,method,path,body,status)=>{const r=await request(app,f,role,method,path,body);assert.equal(r.status,status,JSON.stringify({path,...r}));return r.data;};
 const count=async table=>(await db.prepare(`SELECT count(*) n FROM ${table}`).first()).n;
 const conversation=await call('parent','POST','/api/communication',{conversation_key:crypto.randomUUID(),student_id:101,academic_year_id:1,parent_user_id:8,staff_user_id:3,title:'LOCAL communication',body:'LOCAL message'},201);
 const thread='/api/communication/'+conversation.conversation_key;
 await call('teacher','POST',thread+'/messages',{message_key:crypto.randomUUID(),revision:conversation.revision,body:'LOCAL reply'},201);
 const detail=await call('parent','GET',thread,undefined,200);assert.equal(detail.messages.length,2);
 await call('parent','POST',thread+'/read',{last_message_id:detail.messages[1].id},200);
 await call('teacher','POST',thread+'/status',{revision:detail.conversation.revision,status:'closed',reason:'LOCAL completed'},200);
 await call('parent','POST',thread+'/messages',{message_key:crypto.randomUUID(),revision:detail.conversation.revision,body:'blocked'},409);cases.push('communication triggers, notifications, read and close');
 await db.prepare('INSERT INTO grades(school_id,student_subject_id,first_month) SELECT school_id,id,82 FROM student_subjects').run();
 const p=await call('teacher','POST','/api/grade-progress/preview',{student_id:101,period:'first_month'},200);
 const publish={student_id:101,period:'first_month',report_key:crypto.randomUUID(),preview_digest:p.preview_digest,confirm_delivered:true};
 const report=await call('teacher','POST','/api/grade-progress/publish',publish,201);assert.equal(report.snapshot.subjects[0].score,82);
 await call('teacher','POST','/api/grade-progress/publish',publish,200);assert.equal(await count('grade_progress_reports'),1);
 await call('parent','GET','/api/grades',undefined,403);
 await call('teacher','POST',`/api/grade-progress/${report.report_key}/withdraw`,{revision:1,reason:'LOCAL correction'},200);
 assert.equal((await call('parent','GET','/api/grade-progress',undefined,200)).reports.length,0);cases.push('progress publish/idempotency/withdraw and parent boundary');
 const ruleBody=process=>({regulation_key:crypto.randomUUID(),academic_year_id:1,class_id:1,process,title:'LOCAL TEST ONLY',jurisdiction:'LOCAL TEST ONLY',source_reference:'LOCAL TEST ONLY',source_url:'https://example.invalid/test',effective_from:'2020-01-01',effective_to:'2099-12-31',rules:{age_reference_date:'2026-09-01',age_rule:'not_applicable',min_age_months:null,max_age_months:null,repeat_rule:'not_applicable',max_previous_repeats:null,acceleration:'allowed',required_documents:[]}});
 async function policy(process){const r=await call('registrar','POST','/api/regulations',ruleBody(process),201);await call('owner','POST',`/api/regulations/${r.regulation_key}/approve`,{revision:1,confirm_source_verified:true,reason:'LOCAL verified synthetic source'},200);}
 async function approve(a){const p=await call('owner','GET',`/api/admissions/${a.application_key}/preview`,undefined,200);assert.equal(p.can_approve,true,JSON.stringify(p));return call('owner','POST',`/api/admissions/${a.application_key}/decision`,{revision:a.revision,decision:'approve',reason:'LOCAL approved',preview_digest:p.preview_digest,confirm_evidence_verified:true},200);}
 await policy('admission');
 const candidate={application_key:crypto.randomUUID(),student_id:null,applicant:{full_name:'LOCAL candidate',student_number:'LOCAL-NEW-1',gender:'male',birth_date:null},academic_year_id:1,class_id:1,section_id:2,process:'admission',facts:{previous_repeats:0,accelerated:false,documents:[]}};
 const a=await approve(await call('registrar','POST','/api/admissions',candidate,201));
 const executed=await call('registrar','POST',`/api/admissions/${a.application_key}/execute`,{revision:a.revision,confirm_execute:true},200);assert.equal(executed.status,'executed');
 const studentCount=await count('students');await call('registrar','POST',`/api/admissions/${a.application_key}/execute`,{revision:a.revision,confirm_execute:true},200);await call('registrar','POST','/api/admissions',candidate,200);assert.equal(await count('students'),studentCount);cases.push('sourced policy, atomic admission, retry after execution');
 await policy('transfer_out');const gradesBefore=(await db.prepare('SELECT * FROM grades ORDER BY id').all()).results;
 const outbound=await approve(await call('registrar','POST','/api/admissions',{application_key:crypto.randomUUID(),student_id:101,academic_year_id:1,class_id:1,section_id:2,process:'transfer_out',external_school:'LOCAL external',document_reference:'LOCAL doc',facts:{previous_repeats:0,accelerated:false,documents:[]}},201));
 await call('registrar','POST',`/api/admissions/${outbound.application_key}/execute`,{revision:outbound.revision,confirm_execute:true},200);
 assert.equal((await db.prepare('SELECT status FROM student_enrollments WHERE student_id=101').first()).status,'transferred');assert.deepEqual((await db.prepare('SELECT * FROM grades ORDER BY id').all()).results,gradesBefore);cases.push('transfer out preserves grade rows');
 // A real workerd batch failure after the writes must roll back all side effects.
 const rollbackBefore=await contentSnapshot(async sql=>(await db.prepare(sql).all()).results);
 f.d1={prepare:sql=>db.prepare(sql),batch:statements=>db.batch([...statements,db.prepare('SELECT * FROM intentional_local_missing_table')])};
 await call('owner','POST','/api/communication',{conversation_key:crypto.randomUUID(),student_id:102,academic_year_id:1,parent_user_id:9,staff_user_id:1,title:'rollback',body:'must not persist'},503);
 assert.deepEqual(await contentSnapshot(async sql=>(await db.prepare(sql).all()).results),rollbackBefore);cases.push('late batch failure rolls back thread/message/audit/notifications');
 assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
 const evidence={local_only:true,migration_count:46,table_count:95,application_table_count:93,historical_application_tables_unchanged:81,baseline_hash:digest(before),cases,foreign_key_check:[]};writeFileSync(join(directory,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));
}finally{await vite.close();await proxy.dispose();}
