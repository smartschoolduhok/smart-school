import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import {createServer} from 'vite';
import {signJWT} from '../src/lib/jwtSecurity.ts';
import {root,fixture as makeFixture,entry,snapshot,addAvailability,addConstraints} from './helpers/teaching-load-matrix-fixture.mjs';

const vite=await createServer({root,appType:'custom',server:{middlewareMode:true,hmr:false}});
const {default:app}=await vite.ssrLoadModule('/src/worker.ts');after(()=>vite.close());
const secret='section-advisors-test-secret-at-least-32-characters';
const tokens=Object.fromEntries(await Promise.all([['owner',1,'owner'],['admin',2,'admin'],['teacher',3,'teacher'],['accountant',4,'accountant'],['principal',5,'principal'],['vice',6,'vice'],['registrar',7,'registrar']].map(async([key,id,email])=>[key,await signJWT({id,email:`${email}@matrix.test`,auth_version:1},secret)])));
const path='/api/section-advisors?school_id=1&academic_year_id=1';
function fixture(t){const f=makeFixture();t.after(()=>f.db.close());return f;}
const draft=patch=>({school_id:1,academic_year_id:1,class_id:1,section_id:2,employee_id:2,attendance_confirmed:false,notes:'',expected_version:0,...patch});
async function call(f,{role='owner',url=path,method='GET',body}={}){
  const response=await app.request('http://localhost'+url,{method,headers:{Authorization:`Bearer ${tokens[role]}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)},{DB:f.d1,JWT_SECRET:secret,APP_ENV:'test'});
  return {status:response.status,body:await response.json()};
}
const save=(f,body=draft(),role='owner')=>call(f,{url:'/api/section-advisors',method:'PUT',body,role});
const section=(r,id=2)=>r.body.data.placements.find(p=>p.section_id===id);
function unchangedExcept(before,after,tables=['section_advisors']){for(const[name,rows]of Object.entries(before))if(!tables.includes(name))assert.deepEqual(after[name],rows,name);}

test('GET is read-only, shows every active placement and counts only actual saved lessons',async t=>{
  const f=fixture(t);entry(f.db,2,1);entry(f.db,2,2);entry(f.db,3,6);
  f.db.exec(`UPDATE schools SET name='School current',name_en='School English',province='Duhok',principal_name='Current principal',logo_url='/logo.svg' WHERE id=1;
    INSERT INTO school_settings(school_id,official_book_header_text,official_book_footer_text,use_arabic_indic_digits,official_book_layout_settings_json)
    VALUES(1,'Header','Footer',0,'{"country_ar":"Configured country","show_english_header":false}');`);
  const before=snapshot(f.db),r=await call(f);assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.body.data.placements.length,3);assert.deepEqual(r.body.data.school_days,[0,1,2]);
  assert.deepEqual(section(r).candidates,[{employee_id:2,employee_name:'Teacher B',subjects:['Math'],section_weekly_periods:2,total_weekly_periods:2,scheduled_days:[0]}]);assert.deepEqual(section(r,1).candidates,[]);
  assert.equal(section(r,null).class_id,2);assert.equal(section(r,null).candidates[0].employee_id,6);assert.equal(section(r).assignment,null);
  assert.equal(r.body.data.school.principal_name,'Current principal');assert.equal(r.body.data.document_settings.official_book_layout.country_ar,'Configured country');assert.equal(r.body.data.document_settings.use_arabic_indic_digits,false);assert.equal(r.body.data.document_settings.header_text,'Header');assert.equal(r.body.data.document_settings.footer_text,'Footer');assert.deepEqual(snapshot(f.db),before);
});

test('save persists selected candidate with unknown attendance; confirmation is explicit and updates use CAS',async t=>{
  const f=fixture(t);entry(f.db,2,1);const before=snapshot(f.db),r=await save(f,draft({notes:' note '}));assert.equal(r.status,200,JSON.stringify(r));
  assert.deepEqual(r.body.data,{school_id:1,academic_year_id:1,class_id:1,section_id:2,assignment:{employee_id:2,employee_name:'Teacher B',attendance_confirmed:false,notes:'note',version:1}});
  const stored=f.db.prepare('SELECT * FROM section_advisors').get();assert.equal(stored.created_by_user_id,1);assert.equal(stored.updated_by_user_id,1);
  const confirmed=await save(f,draft({expected_version:1,attendance_confirmed:true}), 'principal');assert.equal(confirmed.status,200);assert.equal(confirmed.body.data.assignment.version,2);assert.equal(confirmed.body.data.assignment.attendance_confirmed,true);
  assert.equal(f.db.prepare('SELECT updated_by_user_id FROM section_advisors').get().updated_by_user_id,5);unchangedExcept(before,snapshot(f.db));
  const now=snapshot(f.db),stale=await save(f);assert.equal(stale.status,409);assert.equal(stale.body.code,'stale_section_advisor');assert.deepEqual(snapshot(f.db),now);
});

test('clear retains the version and cannot be overwritten by an old untouched form',async t=>{
  const f=fixture(t);entry(f.db,2,1);assert.equal((await save(f)).status,200);
  const cleared=await save(f,draft({expected_version:1,employee_id:null,attendance_confirmed:true,notes:'old'}));assert.equal(cleared.status,200);assert.deepEqual(cleared.body.data.assignment,{employee_id:null,employee_name:null,attendance_confirmed:false,notes:'',version:2});
  assert.deepEqual(section(await call(f)).assignment,cleared.body.data.assignment);assert.equal((await save(f)).status,409);assert.equal((await save(f,draft({expected_version:2}))).body.data.assignment.version,3);
});

test('a cleared adviser is a section-history reference and moving that section returns a useful conflict',async t=>{
  const f=fixture(t);f.db.exec("INSERT INTO sections(id,school_id,class_id,name,status) VALUES(50,1,1,'New','active')");
  assert.equal((await save(f,draft({section_id:50,employee_id:null}))).status,200);
  const before=snapshot(f.db),r=await call(f,{url:'/api/sections/50',method:'PUT',body:{school_id:1,class_id:2,name:'New',capacity:30,status:'active'}});
  assert.equal(r.status,409,JSON.stringify(r));assert.equal(r.body.code,'section_has_references');assert.deepEqual(snapshot(f.db),before);
});

test('saved candidate stays available despite changed slot availability or working-day limits; schedule is not attendance proof',async t=>{
  const f=fixture(t);entry(f.db,2,1);entry(f.db,2,6);entry(f.db,2,7);addAvailability(f.db,2,1,'unavailable');addConstraints(f.db,2,{max_working_days:1});
  const r=await call(f);assert.deepEqual(section(r).candidates[0].scheduled_days,[0,1,2]);assert.equal(section(r).assignment,null);assert.equal((await save(f)).body.data.assignment.attendance_confirmed,false);
});

test('GET retains invalid assigned teacher; later save requires a current candidate or clear',async t=>{
  const f=fixture(t);entry(f.db,2,1);assert.equal((await save(f)).status,200);f.db.exec("UPDATE employees SET status='archived' WHERE id=2");
  const r=await call(f);assert.equal(section(r).assignment.employee_name,'Teacher B');assert.equal(section(r).assignment.employee_id,2);assert.deepEqual(section(r).candidates,[]);
  assert.equal((await save(f,draft({expected_version:1}))).body.code,'advisor_not_teaching_placement');assert.equal((await save(f,draft({expected_version:1,employee_id:null}))).status,200);
});

test('saved lessons in another year/placement or school, planned-only loads and inactive teachers cannot be assigned',async t=>{
  for(const body of [draft(),draft({employee_id:1}),draft({employee_id:3}),draft({employee_id:4}),draft({employee_id:5}),draft({employee_id:6}),draft({employee_id:999}),draft({section_id:1})])await t.test(JSON.stringify(body),async child=>{
    const f=fixture(child);f.db.exec('INSERT INTO timetable_entries(school_id,academic_year_id,teaching_load_id,slot_id) VALUES(1,2,4,8),(2,3,6,9)');entry(f.db,3,6);
    const before=snapshot(f.db),r=await save(f,body);assert.equal(r.status,400,JSON.stringify(r));assert.deepEqual(snapshot(f.db),before);
  });
});

test('inactive references and hidden lessons exclude current eligibility and preserve assignment history',async t=>{
  for(const [name,sql]of [['subject',"UPDATE subjects SET status='archived' WHERE id=1"],['load',"UPDATE timetable_teaching_loads SET status='inactive' WHERE id=2"],['slot','UPDATE timetable_slots SET is_active=0 WHERE id=1'],['day','UPDATE timetable_days SET is_active=0 WHERE school_id=1 AND academic_year_id=1 AND day_of_week=0']])await t.test(name,async child=>{
    const f=fixture(child);entry(f.db,2,1);assert.equal((await save(f)).status,200);f.db.exec(sql);const r=await call(f);assert.equal(section(r).assignment.employee_id,2);assert.deepEqual(section(r).candidates,[]);assert.equal((await save(f,draft({expected_version:1}))).status,400);
  });
});

test('parallel lessons each qualify their own teacher; class without sections supports its saved teacher',async t=>{
  const f=fixture(t);f.db.exec('UPDATE timetable_teaching_loads SET employee_id=1 WHERE id=1');
  const paired=await call(f,{method:'POST',url:'/api/timetable/teaching-loads',body:{school_id:1,academic_year_id:1,class_id:1,section_id:1,subject_id:2,employee_id:2,weekly_periods:4,parallel_with_load_id:1}});assert.equal(paired.status,201);
  assert.equal((await call(f,{method:'POST',url:'/api/timetable/entries',body:{school_id:1,academic_year_id:1,slot_id:1,teaching_load_id:1}})).status,201);
  const r=await call(f);assert.deepEqual(section(r,1).candidates.map(c=>c.employee_id),[1,2]);assert.equal((await save(f,draft({section_id:1,employee_id:2}))).status,200);
  entry(f.db,3,6);assert.equal((await save(f,draft({class_id:2,section_id:null,employee_id:6}))).status,200);
});

test('tenant/year targeting, all role boundaries, invalid payloads and no initial school-settings writes',async t=>{
  const f=fixture(t);entry(f.db,2,1);const before=snapshot(f.db);
  for(const role of ['owner','admin','principal','vice','registrar'])assert.equal((await call(f,{role})).status,200,role);
  for(const role of ['teacher','accountant']){assert.equal((await call(f,{role})).status,403);assert.equal((await save(f,draft(),role)).status,403);}
  assert.equal((await call(f,{role:'admin',url:'/api/section-advisors?academic_year_id=1'})).status,400);
  assert.equal((await call(f,{url:'/api/section-advisors?school_id=2&academic_year_id=3'})).status,403);
  assert.equal((await call(f,{role:'admin',url:'/api/section-advisors?school_id=1&academic_year_id=3'})).status,403);
  for(const year of ['',0,-1,'bad','1.5'])assert.equal((await call(f,{url:`/api/section-advisors?school_id=1&academic_year_id=${year}`})).status,400);
  for(const patch of [{school_id:2,academic_year_id:3},{academic_year_id:3},{class_id:3,section_id:3},{class_id:1,section_id:null},{class_id:1,section_id:3},{notes:'x'.repeat(1001)},{employee_id:'2'},{expected_version:undefined}]){const r=await save(f,draft(patch));assert.ok([400,403].includes(r.status),JSON.stringify(r));}
  assert.equal(f.db.prepare('SELECT count(*) n FROM school_settings').get().n,0);assert.deepEqual(snapshot(f.db),before);
  for(const role of ['admin','vice','registrar']){const version=f.db.prepare('SELECT version FROM section_advisors').get()?.version??0;assert.equal((await save(f,draft({expected_version:version}),role)).status,200);}
});

test('conditional write rejects a candidate lost or assignment changed after initial read',async t=>{
  for(const [name,change]of [['lesson removed',f=>f.db.exec('DELETE FROM timetable_entries')],['teacher archived',f=>f.db.exec("UPDATE employees SET status='archived' WHERE id=2")],['section archived',f=>f.db.exec("UPDATE sections SET status='archived' WHERE id=2")],['competing assignment',f=>f.db.exec('INSERT INTO section_advisors(school_id,academic_year_id,class_id,section_id,employee_id,created_by_user_id,updated_by_user_id) VALUES(1,1,1,2,2,1,1)')]])await t.test(name,async child=>{
    const f=fixture(child);entry(f.db,2,1);const original=f.d1.record.bind(f.d1);let changed=false;
    f.d1.record=statement=>{if(!changed && /WITH desired AS/.test(statement.sql)){changed=true;change(f);}original(statement);};
    const r=await save(f);assert.equal(r.status,409,JSON.stringify(r));assert.equal(r.body.code,'stale_section_advisor');assert.ok(changed);
    assert.equal(f.db.prepare('SELECT count(*) n FROM section_advisors').get().n,name==='competing assignment'?1:0);
  });
});

test('another school gets its own candidate, metadata and assignment without affecting the first school',async t=>{
  const f=fixture(t);entry(f.db,2,1);assert.equal((await save(f)).status,200);
  f.db.exec('INSERT INTO timetable_entries(school_id,academic_year_id,teaching_load_id,slot_id) VALUES(2,3,6,9)');const before=snapshot(f.db);
  const r=await save(f,draft({school_id:2,academic_year_id:3,class_id:3,section_id:3,employee_id:5}),'admin');assert.equal(r.status,200,JSON.stringify(r));
  const foreign=await call(f,{role:'admin',url:'/api/section-advisors?school_id=2&academic_year_id=3'});assert.equal(foreign.body.data.school.id,2);assert.equal(foreign.body.data.placements.length,1);assert.equal(foreign.body.data.placements[0].assignment.employee_name,'Secret Teacher');assert.doesNotMatch(JSON.stringify(await call(f)),/Secret/);
  assert.deepEqual(snapshot(f.db).section_advisors.filter(a=>a.school_id===1),before.section_advisors);unchangedExcept(before,snapshot(f.db));
});
