// Genuine disposable local D1/R2; never uses configured databases or remote bindings.
import assert from 'node:assert/strict';
import {copyFileSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createServer} from 'vite';
import {getPlatformProxy,unstable_splitSqlQuery} from 'wrangler';
import {fixtureSQL,migrationFiles,root} from '../test/helpers/teaching-load-matrix-fixture.mjs';
import {signJWT} from '../src/lib/jwtSecurity.ts';
import {deactivateStudentSubjectAssignments,RELIGIOUS_SUBJECT_HAS_GRADES_CODE} from '../src/lib/religiousSubjects.ts';
import {contentSnapshot} from './lib/local-d1-restore.mjs';

const directory=mkdtempSync(join(tmpdir(),'smart-school-employee-records-local-'));
const configPath=join(directory,'wrangler.json'),state=join(directory,'state');
mkdirSync(join(directory,'migrations'));
writeFileSync(configPath,JSON.stringify({name:'employee-records-local-only',compatibility_date:'2026-04-13',
  d1_databases:[{binding:'DB',database_name:'employee-records-local-only',database_id:'00000000-0000-0000-0000-000000000054',migrations_dir:'migrations'}],
  r2_buckets:[{binding:'HOMEWORK_FILES',bucket_name:'employee-photos-local-only'}],
}));
const migrate=()=>{
  const env={...process.env,CI:'true',WRANGLER_SEND_METRICS:'false'};
  for(const key of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy'])delete env[key];
  const result=spawnSync(process.execPath,[join(root,'node_modules/wrangler/bin/wrangler.js'),'d1','migrations','apply','employee-records-local-only','--local','--config',configPath,'--persist-to',state],{cwd:directory,env,windowsHide:true,encoding:'utf8',timeout:180000,maxBuffer:20000000});
  assert.equal(result.status,0,(result.stdout+result.stderr).slice(-12000));
};
const open=()=>getPlatformProxy({configPath,persist:{path:join(state,'v3')},remoteBindings:false,envFiles:[]});
const snapshot=db=>contentSnapshot(async sql=>(await db.prepare(sql).all()).results);
console.log('LOCAL employee-record artifacts: '+directory);
for(const file of migrationFiles.filter(file=>file.slice(0,4)<='0053'))copyFileSync(join(root,'migrations',file),join(directory,'migrations',file));
migrate();
let proxy=await open(),before;
try {
  await proxy.env.DB.batch(unstable_splitSqlQuery(fixtureSQL+`
    UPDATE employees SET hire_date='2020-09-01',salary_amount=900000 WHERE id=2;
    INSERT INTO employee_salaries(school_id,employee_id,month,year,base_salary,bonus_amount,deduction_amount,net_salary) VALUES(1,2,9,2026,800000,20000,5000,815000);
  `).map(sql=>proxy.env.DB.prepare(sql)));
  before=await snapshot(proxy.env.DB);
} finally {await proxy.dispose();}
copyFileSync(join(root,'migrations','0054_employee_records.sql'),join(directory,'migrations','0054_employee_records.sql'));
migrate();proxy=await open();
const vite=await createServer({root,appType:'custom',server:{middlewareMode:true,hmr:false}});
const checks=[];
try {
  const db=proxy.env.DB,after=await snapshot(db);
  for(const [name,previous] of Object.entries(before.tables)) {
    if(['employees','d1_migrations','sqlite_sequence'].includes(name))continue;
    assert.deepEqual(after.tables[name],previous,name+' preserved by additive migration');
  }
  const migratedEmployee=await db.prepare('SELECT hire_date,commencement_date,photo_object_key FROM employees WHERE id=2').first();
  assert.deepEqual(migratedEmployee,{hire_date:'2020-09-01',commencement_date:null,photo_object_key:null});
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);checks.push('populated migration preserves existing tables and service dates');
  const {default:app}=await vite.ssrLoadModule('/src/worker.ts');
  const secret='local-employee-records-validation-secret-2026';
  const tokens=Object.fromEntries(await Promise.all([['owner',1],['accountant',4],['teacher',3]].map(async([role,id])=>[role,await signJWT({id,email:`${role}@matrix.test`,auth_version:1},secret)])));
  const request=(path,{role='owner',method='GET',body,bytes,database=db}={})=>app.request('http://localhost'+path,{method,headers:{Authorization:`Bearer ${tokens[role]}`,...(body instanceof FormData?{}:{'Content-Type':bytes?'image/png':'application/json'})},body:bytes??(body instanceof FormData?body:body===undefined?undefined:JSON.stringify(body))},{...proxy.env,DB:database,JWT_SECRET:secret,APP_ENV:'test'});
  const json=async(path,options)=>{const response=await request(path,options);return {status:response.status,body:await response.json()};};
  const create=await json('/api/employees',{method:'POST',body:{school_id:1,full_name:'LOCAL موظف سجل الكادر',employee_number:'LOCAL-054',role:'teacher',hire_date:'2026-09-01',commencement_date:'2026-09-10',salary_amount:1200000,qualifications:[{degree:'بكالوريوس',is_primary:true},{degree:'ماجستير',is_primary:false}]}});
  assert.equal(create.status,201,JSON.stringify(create));const id=create.body.data.id;
  assert.equal((await db.prepare('SELECT count(*) n FROM employee_qualifications WHERE employee_id=?').bind(id).first()).n,2);
  const photo=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8L8AAAAASUVORK5CYII=','base64'));
  assert.equal((await request(`/api/employees/${id}/photo?school_id=1`,{method:'POST',bytes:photo})).status,200);
  const stored=await request(`/api/employees/${id}/photo?school_id=1`);assert.equal(stored.status,200);assert.deepEqual(new Uint8Array(await stored.arrayBuffer()),photo);
  assert.equal((await request(`/api/employees/${id}/photo?school_id=1`,{role:'accountant'})).status,403);
  assert.equal((await request(`/api/employees/${id}/photo?school_id=2`)).status,403);
  checks.push('atomic employee plus qualifications, genuine private R2 upload/download and access denial');
  const homework=await json('/api/homework',{method:'POST',body:{school_id:1,teaching_load_id:2,title:'LOCAL mixed bucket worksheet',instructions:'LOCAL attachment verification',assigned_date:'2026-09-22'}});
  assert.equal(homework.status,201,JSON.stringify(homework));
  const attachmentForm=()=>{const form=new FormData();form.set('school_id','1');form.set('revision',String(homework.body.data.revision));form.set('file',new File(['%PDF-'],'local-worksheet.pdf',{type:'application/pdf'}));return form;};
  const attachmentPath=`/api/homework/${homework.body.data.homework_key}/attachments`;
  const attachment=await json(attachmentPath,{method:'POST',body:attachmentForm()});assert.equal(attachment.status,201,JSON.stringify(attachment));
  assert.equal((await proxy.env.HOMEWORK_FILES.list({prefix:'homework/'})).objects.length,1);
  assert.equal((await proxy.env.HOMEWORK_FILES.list({prefix:`schools/1/employees/${id}/`})).objects.length,1);
  assert.equal((await request(`/api/employees/${id}/photo?school_id=1`,{role:'teacher'})).status,403);
  await proxy.env.HOMEWORK_FILES.put('homework/local-untracked',new TextEncoder().encode('%PDF-'));
  const beforeOrphan=await snapshot(db),orphan=await json(attachmentPath,{method:'POST',body:attachmentForm()});
  assert.equal(orphan.status,503,JSON.stringify(orphan));assert.equal(orphan.body.code,'homework_storage_reconciliation_failed');assert.deepEqual(await snapshot(db),beforeOrphan);
  await proxy.env.HOMEWORK_FILES.delete('homework/local-untracked');
  checks.push('shared R2 employee photo permits homework upload while protected photos and orphan homework checks remain enforced');
  const oldSalary=(await db.prepare('SELECT * FROM employee_salaries').all()).results;
  const changed=await json('/api/employees/2',{method:'PUT',body:{school_id:1,salary_amount:1500000}});assert.equal(changed.status,200);
  assert.deepEqual((await db.prepare('SELECT * FROM employee_salaries').all()).results,oldSalary);
  const employeePath=`/api/employees/${id}`,qualifications=[{degree:'بكالوريوس',is_primary:true},{degree:'ماجستير',is_primary:false}];
  assert.equal((await json(employeePath,{method:'PUT',body:{school_id:1,qualifications:[]}})).status,200);
  assert.equal((await db.prepare('SELECT count(*) n FROM employee_qualifications WHERE employee_id=?').bind(id).first()).n,0);
  assert.equal((await json(employeePath,{method:'PUT',body:{school_id:1,qualifications}})).status,200);
  assert.equal((await db.prepare('SELECT count(*) n FROM employee_qualifications WHERE employee_id=?').bind(id).first()).n,2);
  // Inject a real D1 write after the handler reads its snapshot, before its batch.
  // Compare every table with the winner's state, including audit and sequence rows.
  for(const concurrentChange of [
    async()=>db.prepare('UPDATE employees SET salary_amount=?,notes=? WHERE id=?').bind(1330000,'LOCAL latest concurrent edit',id).run(),
    async()=>db.batch([db.prepare('DELETE FROM employee_qualifications WHERE employee_id=?').bind(id),db.prepare('INSERT INTO employee_qualifications(school_id,employee_id,degree,is_primary) VALUES(1,?,?,1)').bind(id,'LOCAL latest qualification')]),
  ]) {
    let winningSnapshot;
    const racingDatabase={prepare:sql=>db.prepare(sql),batch:async statements=>{await concurrentChange();winningSnapshot=await snapshot(db);return db.batch(statements);}};
    const stale=await json(employeePath,{method:'PUT',body:{school_id:1,notes:'LOCAL stale edit',qualifications},database:racingDatabase});
    assert.equal(stale.status,409,JSON.stringify(stale));assert.deepEqual(await snapshot(db),winningSnapshot);
  }
  checks.push('qualification clear/refill and concurrent field or qualification conflicts preserve the winner without audit or child writes');
  // Exercise the real spreadsheet mapping -> preview -> confirmation path.
  await db.prepare("UPDATE employees SET phone='07500000000',email='local-import@example.test',gender='male',address='LOCAL preserved address',job_title='LOCAL preserved job',salary_type='daily',status='inactive' WHERE id=?").bind(id).run();
  const employeeBeforeImport=await db.prepare('SELECT * FROM employees WHERE id=?').bind(id).first();
  const qualificationsBeforeImport=(await db.prepare('SELECT * FROM employee_qualifications WHERE employee_id=? ORDER BY id').bind(id).all()).results;
  const previewImport=body=>json('/api/import-export/employees/preview',{method:'POST',body:{school_id:1,mode:'update_existing',...body}});
  const confirmImport=(rows,database=db)=>json('/api/import-export/employees/confirm',{method:'POST',body:{school_id:1,mode:'update_existing',rows},database});
  const beforePreview=await snapshot(db);
  const mappedPreview=await previewImport({mapping:{full_name:'Local name',employee_number:'Local number'},rows:[{'Local name':'LOCAL corrected employee name','Local number':'LOCAL-054'}]});
  assert.equal(mappedPreview.status,200,JSON.stringify(mappedPreview));assert.deepEqual(mappedPreview.body.data.errors,[]);
  assert.deepEqual(mappedPreview.body.data.valid[0].data.imported_fields.sort(),['employee_number','full_name']);
  assert.deepEqual(await snapshot(db),beforePreview,'employee preview is read only');
  const mappedImport=await confirmImport(mappedPreview.body.data.valid);
  assert.equal(mappedImport.status,200,JSON.stringify(mappedImport));assert.equal(mappedImport.body.data.updated_count,1);assert.equal(mappedImport.body.data.error_count,0);
  const employeeAfterImport=await db.prepare('SELECT * FROM employees WHERE id=?').bind(id).first();
  assert.deepEqual({...employeeAfterImport,updated_at:employeeBeforeImport.updated_at},{...employeeBeforeImport,full_name:'LOCAL corrected employee name'});
  assert.deepEqual((await db.prepare('SELECT * FROM employee_qualifications WHERE employee_id=? ORDER BY id').bind(id).all()).results,qualificationsBeforeImport);
  assert.deepEqual((await db.prepare('SELECT * FROM employee_salaries').all()).results,oldSalary);
  checks.push('mapped employee preview and import preserve all omitted columns, qualifications and historical salaries');
  for(const [name,concurrentChange] of [
    ['employee',async()=>db.prepare('UPDATE employees SET salary_amount=?,notes=? WHERE id=?').bind(1770000,'LOCAL winning import race',id).run()],
    ['qualifications',async()=>db.batch([db.prepare('DELETE FROM employee_qualifications WHERE employee_id=?').bind(id),db.prepare('INSERT INTO employee_qualifications(school_id,employee_id,degree,is_primary) VALUES(1,?,?,1)').bind(id,'LOCAL winning import qualification')])],
  ]) {
    const preview=await previewImport({rows:[{full_name:employeeAfterImport.full_name,employee_number:'LOCAL-054',notes:'LOCAL stale import',qualifications}]});
    assert.equal(preview.status,200,JSON.stringify(preview));assert.deepEqual(preview.body.data.errors,[]);
    let winningSnapshot,batches=0;
    const racingDatabase={prepare:sql=>db.prepare(sql),batch:async statements=>{
      assert.equal(++batches,1,'one guarded employee import batch');
      await concurrentChange();winningSnapshot=await snapshot(db);return db.batch(statements);
    }};
    const stale=await confirmImport(preview.body.data.valid,racingDatabase);
    assert.equal(stale.status,200,JSON.stringify(stale));assert.equal(stale.body.data.updated_count,0);assert.equal(stale.body.data.imported_count,0);assert.equal(stale.body.data.error_count,1);
    assert.match(stale.body.data.row_errors[0].message,/تغيرت بيانات الموظف/);assert.equal(batches,1);
    const afterRace=await snapshot(db);
    for(const [table,rows] of Object.entries(winningSnapshot.tables)) {
      // The rejected row is still recorded in its import job; no employee,
      // qualification, audit or sequence write may survive the failed CAS.
      if(table!=='import_jobs')assert.deepEqual(afterRace.tables[table],rows,`${name} import race preserves ${table}`);
    }
    const job=await db.prepare('SELECT updated_rows,imported_rows,error_rows FROM import_jobs WHERE id=?').bind(stale.body.data.job_id).first();
    assert.deepEqual(job,{updated_rows:0,imported_rows:0,error_rows:1});
  }
  checks.push('employee import CAS rejects real concurrent employee and qualification writes without stale audit or child writes');
  // The shared deactivation helper must reject the whole mixed set when a
  // zero grade arrives after its preflight, using workerd D1 transaction results.
  await db.batch(unstable_splitSqlQuery(`
    INSERT INTO students(id,school_id,student_number,full_name,gender,class_id,section_id) VALUES(8001,1,'LOCAL-REL-8001','LOCAL deactivation fixture','male',1,1);
    INSERT INTO subjects(id,school_id,class_id,name,religious_track) VALUES(8001,1,1,'LOCAL religious fixture','islamic'),(8002,1,1,'LOCAL ordinary fixture',NULL);
    INSERT INTO student_subjects(id,school_id,student_id,subject_id,class_id,section_id,assigned_by_user_id,notes) VALUES(8001,1,8001,8001,1,1,1,'LOCAL religion note'),(8002,1,8001,8002,1,1,1,'LOCAL ordinary note');
    INSERT INTO grades(id,school_id,student_subject_id) VALUES(8001,1,8001);
  `).map(sql=>db.prepare(sql)));
  let gradeWinner,gradeRaceBatches=0;
  const racingGradesDatabase={prepare:sql=>db.prepare(sql),batch:async statements=>{
    assert.equal(++gradeRaceBatches,1);await db.prepare('UPDATE grades SET first_month=0 WHERE id=8001').run();gradeWinner=await snapshot(db);return db.batch(statements);
  }};
  const rejectedDeactivation=await deactivateStudentSubjectAssignments(racingGradesDatabase,1,[8002,8001],{notes:'LOCAL stale deactivation'});
  assert.equal(rejectedDeactivation.ok,false);assert.equal(rejectedDeactivation.status,409);assert.equal(rejectedDeactivation.code,RELIGIOUS_SUBJECT_HAS_GRADES_CODE);assert.equal(rejectedDeactivation.meta.assignment_id,8001);assert.equal(gradeRaceBatches,1);
  assert.deepEqual(await snapshot(db),gradeWinner,'mixed deactivation preserves all rows after the winning grade');
  await db.prepare('UPDATE grades SET first_month=NULL WHERE id=8001').run();
  const deactivated=await deactivateStudentSubjectAssignments(db,1,[8002,8001],{notes:'LOCAL accepted deactivation'});
  assert.deepEqual(deactivated,{ok:true,affected:2});
  const deactivatedRows=(await db.prepare('SELECT is_active,removed_at,notes FROM student_subjects WHERE id IN (8001,8002)').all()).results;
  assert.equal(deactivatedRows.length,2);for(const row of deactivatedRows){assert.equal(row.is_active,0);assert.ok(row.removed_at>0);assert.equal(row.notes,'LOCAL accepted deactivation');}
  checks.push('genuine D1 atomically rejects a mixed deactivation after a concurrent zero grade and reports successful affected counts');
  const readBefore=await snapshot(db);
  for(const path of [`/api/employees/${id}/profile?school_id=1&academic_year_id=1`,'/api/staff-register?school_id=1','/api/salary-receipts?school_id=1&month=9&year=2026&status=all']) {
    const read=await json(path);assert.equal(read.status,200,JSON.stringify(read));
  }
  assert.deepEqual(await snapshot(db),readBefore);checks.push('profile/register/receipt reads leave all tables unchanged and historical salary remains intact');
  assert.equal((await request(`/api/employees/${id}/photo?school_id=1`,{method:'DELETE'})).status,200);
  assert.equal((await request(`/api/employees/${id}/photo?school_id=1`)).status,404);
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
  checks.push('private photo removal and final foreign keys');
  const evidence={passed:true,checks,local_only:true,migrations:(await db.prepare('SELECT count(*) n FROM d1_migrations').first()).n};
  writeFileSync(join(directory,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));
} finally {await vite.close();await proxy.dispose();}
