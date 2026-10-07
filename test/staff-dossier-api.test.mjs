import assert from 'node:assert/strict';
import test, {after} from 'node:test';
import {createServer} from 'vite';
import {signJWT} from '../src/lib/jwtSecurity.ts';
import {emptyStaffDossier} from '../src/lib/staffDossier.ts';
import {root,financeFixture,snapshot} from './helpers/finance-fixture.mjs';
const vite=await createServer({root,appType:'custom',server:{middlewareMode:true,hmr:false}});
const {default:app}=await vite.ssrLoadModule('/src/worker.ts'); after(()=>vite.close());
const secret='staff-dossier-test-secret-at-least-32-characters';
const tokens=Object.fromEntries(await Promise.all(['owner','admin','teacher','accountant','principal','vice','registrar','parent'].map(async (key,index)=>[key,await signJWT({id:index+1,email:`${key}@matrix.test`,auth_version:1},secret)])));
async function call(f,{employee=1,school=1,role='owner',method='GET',body,raw,path}={}) {
  const response=await app.request('http://localhost'+(path||`/api/employees/${employee}/dossier${method==='GET'&&school!=null?'?school_id='+school:''}`),{method,headers:{Authorization:`Bearer ${tokens[role]}`,'Content-Type':'application/json'},body:raw??(body===undefined?undefined:JSON.stringify(body))},{DB:f.d1,JWT_SECRET:secret,APP_ENV:'test'});
  return {status:response.status,body:await response.json(),headers:response.headers};
}
const save=(f,data=emptyStaffDossier(),version=0,extra={})=>call(f,{method:'PUT',body:{school_id:1,version,data},...extra});

test('dossier read is empty without writes; core fields remain in their original source',async t=>{
  const f=financeFixture(t),before=snapshot(f.db),r=await call(f);
  assert.equal(r.status,200);assert.equal(r.body.data.version,0);assert.deepEqual(r.body.data.data,emptyStaffDossier());assert.equal(r.headers.get('cache-control'),'no-store');
  assert.deepEqual(snapshot(f.db),before);assert.equal('salary_amount' in r.body.data.data,false);assert.equal('full_name' in r.body.data.data,false);
});
test('management roles only, explicit tenant and employee scope, and private school logo',async t=>{
  const f=financeFixture(t); f.db.exec("UPDATE schools SET logo_url='/own-logo.svg' WHERE id=1");
  for(const role of ['owner','admin','principal','vice'])assert.equal((await call(f,{role})).status,200);
  for(const role of ['teacher','accountant','registrar','parent']) {assert.equal((await call(f,{role})).status,403);assert.equal((await save(f,emptyStaffDossier(),0,{role})).status,403);}
  assert.equal((await call(f,{school:2})).status,403);assert.equal((await call(f,{employee:5})).status,404);
  assert.equal((await call(f,{role:'admin',school:null})).status,400);assert.equal((await call(f,{school:'1e0'})).status,400);
  assert.equal((await call(f)).body.data.logo_url,'/own-logo.svg');
  assert.equal((await call(f,{role:'admin',school:2,employee:5})).body.data.logo_url,null);
});
test('save and read nullable fields and all histories with actor audit; stale updates fail atomically',async t=>{
  const f=financeFixture(t),data=emptyStaffDossier();data.mother_name='اسم تجريبي';data.birth_date='1990-02-28';data.blood_group='AB+';
  for(const kind of Object.keys(data.history))data.history[kind]=[{title:'عنوان '+kind,date:null,reference:'1/أ',notes:'ملاحظات'}];
  let r=await save(f,data);assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.body.data.version,1);
  assert.deepEqual((await call(f)).body.data.data,data);
  const audit=f.db.prepare('SELECT * FROM staff_dossier_audit').get();assert.equal(audit.actor_user_id,1);assert.equal(audit.before_json,null);assert.deepEqual(JSON.parse(audit.after_json),data);
  const before=snapshot(f.db);assert.equal((await save(f,{...data,mother_name:'تعديل متعارض'},0)).status,409);assert.deepEqual(snapshot(f.db),before);
  r=await save(f,{...data,mother_name:null},1);assert.equal(r.status,200);assert.equal(r.body.data.data.mother_name,null);assert.equal(r.body.data.version,2);
  assert.equal((await save(f,data,1)).status,409);assert.throws(()=>f.db.exec('DELETE FROM staff_dossier_audit'),/immutable/);assert.throws(()=>f.db.exec("UPDATE staff_dossier_audit SET after_json='{}'"),/immutable/);
});
test('validation rejects impossible dates, invalid enum/year/text/list/unknown fields with no partial save',async t=>{
  const f=financeFixture(t),base=emptyStaffDossier(),before=snapshot(f.db);
  for(const patch of [{birth_date:'2026-02-30'},{birth_date:'2026'},{blood_group:'UNKNOWN'},{mother_name:'x'.repeat(201)},{full_name:'overwrite core'}, {marital_status:'unknown'}, {qualifications:[{qualification_key:'a'.repeat(64),department:null,graduation_year:2020.5}]}, {history:{...base.history,courses:Array.from({length:51},()=>({title:'x',date:null,reference:null,notes:null}))}}, {history:{...base.history,courses:[{title:' ',date:null,reference:null,notes:null}]}}]) {
    assert.equal((await save(f,{...base,...patch})).status,400,JSON.stringify(patch));
  }
  assert.equal((await call(f,{method:'PUT',raw:'{"bad":"'+ 'x'.repeat(190000)+'"}'})).status,413);
  assert.deepEqual(snapshot(f.db),before);
});
test('audit failure rolls back dossier; last-moment concurrent edit wins without stale audit',async t=>{
  const f=financeFixture(t),data=emptyStaffDossier();assert.equal((await save(f,data)).status,200);
  const before=snapshot(f.db);f.db.exec("CREATE TRIGGER test_audit_failure BEFORE INSERT ON staff_dossier_audit BEGIN SELECT RAISE(ABORT,'test failure'); END;");
  assert.equal((await save(f,{...data,notes:'not committed'},1)).status,500);assert.deepEqual(snapshot(f.db),before);
  f.db.exec('DROP TRIGGER test_audit_failure');
  f.d1.beforeWrite=()=>f.db.prepare('UPDATE staff_dossiers SET data_json=?,version=version+1 WHERE employee_id=1').run(JSON.stringify({...data,notes:'newer'}));
  assert.equal((await save(f,{...data,notes:'stale'},1)).status,409);assert.equal((await call(f)).body.data.data.notes,'newer');assert.equal(f.db.prepare('SELECT count(*) n FROM staff_dossier_audit').get().n,2);
});
test('degree supplements survive employee qualification replacement and flag changed degrees without dropping them',async t=>{
  const f=financeFixture(t),q={degree:'بكالوريوس',institution:'جامعة الاختبار',college:'العلوم',general_specialization:'علوم',specific_specialization:'فيزياء',graduation_date:null,is_primary:true};
  const update=patch=>call(f,{path:'/api/employees/1',method:'PUT',body:{school_id:1,qualifications:[{...q,...patch}]}});
  assert.equal((await update({})).status,200);
  let read=(await call(f)).body.data;const oldId=read.qualification_links[0].qualification_id,key=read.qualification_links[0].qualification_key;
  const data={...read.data,qualifications:[{qualification_key:key,department:'الفيزياء',graduation_year:2023}]};assert.equal((await save(f,data)).status,200);
  assert.equal((await update({})).status,200);read=(await call(f)).body.data;
  assert.notEqual(read.qualification_links[0].qualification_id,oldId);assert.equal(read.qualification_links[0].qualification_key,key);assert.equal(read.data.qualifications[0].graduation_year,2023);
  assert.equal((await save(f,{...read.data,notes:'after replacement'},read.version)).status,200);
  assert.equal((await update({degree:'ماجستير'})).status,200);read=(await call(f)).body.data;assert.notEqual(read.qualification_links[0].qualification_key,key);assert.equal(read.data.qualifications[0].qualification_key,key);
  assert.equal((await save(f,read.data,read.version)).status,200,'unresolved supplements remain explicitly available');
  assert.equal((await save(f,{...read.data,qualifications:[{qualification_key:'f'.repeat(64),department:'forged',graduation_year:null}]},read.version+1)).status,400);
});
test('full graduation date stays authoritative and no separate year is invented',async t=>{
  const f=financeFixture(t); f.db.exec("INSERT INTO employee_qualifications(school_id,employee_id,degree,graduation_date,is_primary) VALUES(1,1,'دبلوم','2020-06-10',1)");
  const read=(await call(f)).body.data,key=read.qualification_links[0].qualification_key;
  assert.equal((await save(f,{...read.data,qualifications:[{qualification_key:key,department:'علوم',graduation_year:2020}]})).status,400);
  assert.equal((await save(f,{...read.data,qualifications:[{qualification_key:key,department:'علوم',graduation_year:null}]})).status,200);
});
test('qualification deletion or in-place edit immediately before CAS rejects the whole write and audit',async t=>{
  const f=financeFixture(t);f.db.exec("INSERT INTO employee_qualifications(id,school_id,employee_id,degree,is_primary) VALUES(999,1,1,'بكالوريوس',1)");
  let read=(await call(f)).body.data;
  const data={...read.data,qualifications:[{qualification_key:read.qualification_links[0].qualification_key,department:'الفيزياء',graduation_year:2023}]};
  f.d1.beforeWrite=()=>f.db.exec('DELETE FROM employee_qualifications WHERE id=999');
  assert.equal((await save(f,data)).status,409);assert.equal(f.db.prepare('SELECT count(*) n FROM staff_dossiers').get().n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM staff_dossier_audit').get().n,0);
  f.db.exec("INSERT INTO employee_qualifications(id,school_id,employee_id,degree,is_primary) VALUES(999,1,1,'بكالوريوس',1)");
  assert.equal((await save(f,data)).status,200);read=(await call(f)).body.data;
  f.d1.beforeWrite=()=>f.db.exec("UPDATE employee_qualifications SET degree='ماجستير' WHERE id=999");
  assert.equal((await save(f,{...read.data,notes:'stale'},read.version)).status,409);assert.equal((await call(f)).body.data.data.notes,null);assert.equal(f.db.prepare('SELECT count(*) n FROM staff_dossier_audit').get().n,1);
});
