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
