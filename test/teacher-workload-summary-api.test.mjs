import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import {createServer} from 'vite';
import {signJWT} from '../src/lib/jwtSecurity.ts';
import {root,fixture as makeFixture,entry,snapshot,addAvailability,addConstraints} from './helpers/teaching-load-matrix-fixture.mjs';

const vite=await createServer({root,appType:'custom',server:{middlewareMode:true,hmr:false}});
const {default:app}=await vite.ssrLoadModule('/src/worker.ts');
after(()=>vite.close());
const secret='teacher-workload-summary-test-secret-at-least-32-characters';
const tokens=Object.fromEntries(await Promise.all([
  ['owner',1,'owner'],['admin',2,'admin'],['teacher',3,'teacher'],['accountant',4,'accountant'],
  ['principal',5,'principal'],['vice',6,'vice'],['registrar',7,'registrar'],
].map(async([key,id,email])=>[key,await signJWT({id,email:`${email}@matrix.test`,auth_version:1},secret)])));
const path='/api/timetable/teacher-workload-summary?school_id=1&academic_year_id=1';
function fixture(t){const value=makeFixture();t.after(()=>value.db.close());return value;}
async function call(f,{role='owner',url=path,method='GET',body}={}) {
  const response=await app.request('http://localhost'+url,{method,headers:{Authorization:`Bearer ${tokens[role]}`,'Content-Type':'application/json'},
    body:body===undefined?undefined:JSON.stringify(body)},{DB:f.d1,JWT_SECRET:secret,APP_ENV:'test'});
  return {status:response.status,body:await response.json()};
}
const counts = data => Object.fromEntries(data.teachers.map(row=>[row.employee_id,row.weekly_periods]));

test('summary counts saved lessons rather than assigned demand and reads configured school document settings without mutations',async t=>{
  const f=fixture(t);entry(f.db,2,1);entry(f.db,2,2);
  f.db.exec(`UPDATE schools SET name='Example school',name_en='Example English',province='Duhok',principal_name='School principal',logo_url='/logo.svg' WHERE id=1;
    INSERT INTO school_settings(school_id,official_book_header_text,official_book_footer_text,use_arabic_indic_digits,official_book_layout_settings_json)
    VALUES(1,'Custom header','Custom footer',0,'{"country_ar":"Custom country","show_english_header":false}');`);
  const before=snapshot(f.db),r=await call(f);
  assert.equal(r.status,200,JSON.stringify(r));
  assert.deepEqual(counts(r.body.data),{1:0,2:2,6:0});
  assert.deepEqual(r.body.data.teachers.find(row=>row.employee_id===2).breakdown,[{
    class_id:1,class_name:'Class A',section_id:2,section_name:'B',subject_id:1,subject_name:'Math',weekly_periods:2,
  }]);
  assert.deepEqual(r.body.data.teachers.find(row=>row.employee_id===1).breakdown,[]);
  assert.equal(r.body.data.total_weekly_periods,2);
  assert.deepEqual(r.body.data.school,{id:1,name:'Example school',name_en:'Example English',province:'Duhok',principal_name:'School principal',logo_url:'/logo.svg'});
  assert.deepEqual(r.body.data.academic_year,{id:1,name:'2026-2027'});
  const settings=r.body.data.document_settings;
  assert.equal(settings.header_text,'Custom header');assert.equal(settings.footer_text,'Custom footer');
  assert.equal(settings.use_arabic_indic_digits,false);assert.equal(settings.official_book_layout.country_ar,'Custom country');
  assert.equal(settings.official_book_layout.show_english_header,false);
  assert.deepEqual(snapshot(f.db),before);
});

test('missing school settings use response defaults without inserting a row or inventing official document identifiers',async t=>{
  const f=fixture(t),before=snapshot(f.db),r=await call(f);
  assert.equal(r.status,200);assert.equal(r.body.data.total_weekly_periods,0);
  assert.equal(r.body.data.document_settings.header_text,'');assert.equal(r.body.data.document_settings.footer_text,'');
  assert.equal(r.body.data.document_settings.use_arabic_indic_digits,true);
  assert.equal(r.body.data.school.principal_name,null);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM school_settings').get().n,0);
  assert.deepEqual(snapshot(f.db),before);
  for(const key of ['document_number','verification_token','qr_code']) assert.equal(Object.hasOwn(r.body.data,key),false);
});

test('later availability and daily-limit changes do not remove saved lessons from teacher workload',async t=>{
  const f=fixture(t);entry(f.db,2,1);entry(f.db,2,2);
  addAvailability(f.db,2,1,'unavailable');addConstraints(f.db,2,{max_periods_per_day:1});
  const before=snapshot(f.db),r=await call(f);
  assert.equal(r.status,200);assert.equal(counts(r.body.data)[2],2);
  assert.equal(r.body.data.total_weekly_periods,2);assert.deepEqual(snapshot(f.db),before);
});

test('archived references, inactive loads and hidden slots or days exclude only their own saved lessons',async t=>{
  for(const [name,sql] of [
    ['section',"UPDATE sections SET status='archived' WHERE id=2"],
    ['subject',"UPDATE subjects SET status='archived' WHERE id=1"],
    ['load',"UPDATE timetable_teaching_loads SET status='inactive' WHERE id=2"],
    ['slot','UPDATE timetable_slots SET is_active=0 WHERE id=1'],
    ['day','UPDATE timetable_days SET is_active=0 WHERE school_id=1 AND academic_year_id=1 AND day_of_week=0'],
    ['teacher',"UPDATE employees SET status='archived' WHERE id=2"],
  ]) await t.test(name,async child=>{
    const f=fixture(child);entry(f.db,2,1);entry(f.db,3,6);f.db.exec(sql);
    const before=snapshot(f.db),r=await call(f);
    assert.equal(r.status,200);assert.equal(counts(r.body.data)[2]??0,0);assert.equal(counts(r.body.data)[6],1);
    for(const teacher of r.body.data.teachers) assert.equal(teacher.breakdown.reduce((total,row)=>total+row.weekly_periods,0),teacher.weekly_periods);
    assert.equal(r.body.data.total_weekly_periods,1);assert.deepEqual(snapshot(f.db),before);
  });
});

test('parallel subject pair counts once for each distinct teacher even at the same time',async t=>{
  const f=fixture(t);f.db.exec('UPDATE timetable_teaching_loads SET employee_id=1 WHERE id=1');
  const paired=await call(f,{method:'POST',url:'/api/timetable/teaching-loads',body:{school_id:1,academic_year_id:1,class_id:1,section_id:1,subject_id:2,employee_id:2,weekly_periods:4,parallel_with_load_id:1}});
  assert.equal(paired.status,201,JSON.stringify(paired));
  const scheduled=await call(f,{method:'POST',url:'/api/timetable/entries',body:{school_id:1,academic_year_id:1,slot_id:1,teaching_load_id:1}});
  assert.equal(scheduled.status,201,JSON.stringify(scheduled));
  const before=snapshot(f.db),r=await call(f);
  assert.equal(r.status,200);assert.deepEqual(counts(r.body.data),{1:1,2:1,6:0});assert.equal(r.body.data.total_weekly_periods,2);
  assert.deepEqual(snapshot(f.db),before);
});

test('same-name teachers remain separate and school/year scope does not leak other entries or labels',async t=>{
  const f=fixture(t);f.db.exec("UPDATE employees SET full_name='Shared name' WHERE id IN(1,2)");
  entry(f.db,2,1);
  f.db.exec('INSERT INTO timetable_entries(school_id,academic_year_id,teaching_load_id,slot_id) VALUES(1,2,4,8),(2,3,6,9)');
  const r=await call(f);assert.equal(r.status,200);
  assert.deepEqual(counts(r.body.data),{1:0,2:1,6:0});assert.equal(r.body.data.teachers.filter(row=>row.employee_name==='Shared name').length,2);
  assert.doesNotMatch(JSON.stringify(r.body),/Secret/);
  const prior=await call(f,{url:'/api/timetable/teacher-workload-summary?school_id=1&academic_year_id=2'});
  assert.equal(prior.status,200);assert.deepEqual(counts(prior.body.data),{1:1,2:0,6:0});
});

test('summary enforces academic roles, explicit administrator targeting and academic-year tenant ownership',async t=>{
  const f=fixture(t),before=snapshot(f.db);
  for(const role of ['owner','admin','principal','vice','registrar']) assert.equal((await call(f,{role})).status,200,role);
  for(const role of ['teacher','accountant']) assert.equal((await call(f,{role})).status,403,role);
  assert.equal((await call(f,{role:'admin',url:'/api/timetable/teacher-workload-summary?academic_year_id=1'})).status,400);
  assert.equal((await call(f,{url:'/api/timetable/teacher-workload-summary?school_id=2&academic_year_id=3'})).status,403);
  assert.equal((await call(f,{role:'admin',url:'/api/timetable/teacher-workload-summary?school_id=1&academic_year_id=3'})).status,403);
  for(const year of ['',0,-1,'bad','1.5']) assert.equal((await call(f,{url:`/api/timetable/teacher-workload-summary?school_id=1&academic_year_id=${year}`})).status,400);
  assert.deepEqual(snapshot(f.db),before);
});
