import assert from 'node:assert/strict';
import test, {after} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {createServer} from 'vite';
import {fixture, request, root} from './helpers/school-workflow-fixture.mjs';
import {LocalD1, migrationFiles, migrationSQL} from './helpers/teaching-load-matrix-fixture.mjs';
import {businessDate} from '../src/lib/businessTime.ts';
import {
  effectiveModules, isReadOnlySafeRequest, moduleForApiPath, moduleForNavPath, normalizeOverrides,
  parseSubscriptionUpdate, subscriptionAccessState, SCHOOL_MODULES, SCHOOL_MODULE_KEYS,
} from '../src/lib/schoolSubscriptions.ts';

const vite = await createServer({root,appType:'custom',server:{middlewareMode:true,hmr:false}});
const {default:app} = await vite.ssrLoadModule('/src/worker.ts');
const {loadSchoolAccess} = await vite.ssrLoadModule('/src/lib/schoolSubscriptionsDb.ts');
after(()=>vite.close());
const api=(f,role,method,path,body)=>request(app,f,role,method,path,body);
const day=offset=>{const d=new Date(`${businessDate()}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+offset);return d.toISOString().slice(0,10);};
const subscription=(f,school=1)=>f.db.prepare('SELECT * FROM school_subscriptions WHERE school_id=?').get(school);
async function save(f,patch,school=1) {
  const current=subscription(f,school);
  return api(f,'admin','PUT',`/api/schools/${school}/subscription`,{plan_key:'full',status:'active',starts_on:null,ends_on:null,grace_days:14,max_students:null,notes:null,overrides:{},expected_revision:current.revision,...patch});
}

test('validity dates map to active, grace and read-only around the end date',()=>{
  const sub={status:'active',ends_on:'2026-06-30',grace_days:14};
  assert.deepEqual(subscriptionAccessState(sub,'2026-06-30'),{state:'active',days_left:0,read_only_from:'2026-07-15'});
  assert.equal(subscriptionAccessState(sub,'2026-07-01').state,'grace');
  assert.equal(subscriptionAccessState(sub,'2026-07-14').state,'grace');
  assert.equal(subscriptionAccessState(sub,'2026-07-15').state,'read_only');
  assert.equal(subscriptionAccessState({...sub,grace_days:0},'2026-07-01').state,'read_only');
  assert.equal(subscriptionAccessState({...sub,ends_on:null},'2099-01-01').state,'active');
  assert.equal(subscriptionAccessState({...sub,status:'suspended',ends_on:null},'2026-01-01').state,'read_only');
});

test('plans build up from basic to full and overrides add or remove single modules',()=>{
  assert.deepEqual(effectiveModules('basic'),['grades','official_documents']);
  assert.ok(effectiveModules('standard').includes('timetable')&&!effectiveModules('standard').includes('finance'));
  assert.deepEqual(effectiveModules('full'),[...SCHOOL_MODULE_KEYS]);
  assert.deepEqual(effectiveModules('basic',{finance:true,grades:false}),['official_documents','finance']);
  assert.deepEqual(normalizeOverrides('basic',{grades:true,finance:true,timetable:false}),{finance:true});
});

test('every gated API prefix and navigation path belongs to exactly one module',()=>{
  const prefixes=SCHOOL_MODULE_KEYS.flatMap(key=>SCHOOL_MODULES[key].apiPrefixes),paths=SCHOOL_MODULE_KEYS.flatMap(key=>SCHOOL_MODULES[key].navPaths);
  assert.equal(new Set(prefixes).size,prefixes.length);assert.equal(new Set(paths).size,paths.length);
  assert.equal(moduleForApiPath('/api/timetable/grid'),'timetable');
  assert.equal(moduleForApiPath('/api/students'),null);
  assert.equal(moduleForApiPath('/api/employees'),null,'teachers stay available to every plan');
  assert.equal(moduleForApiPath('/api/salaries'),'staff_payroll');
  assert.equal(moduleForNavPath('/fees'),'finance');
});

test('read-only schools may read, preview, print and manage their session only',()=>{
  for (const [method,path] of [['GET','/api/students'],['POST','/api/auth/logout'],['POST','/api/result-cards/preview-student/101'],['POST','/api/subjects/bulk-preview'],['POST','/api/official-books/4/print'],['POST','/api/notifications/abc/read']]) assert.equal(isReadOnlySafeRequest(method,path),true,path);
  for (const [method,path] of [['POST','/api/students'],['PUT','/api/grades/1'],['DELETE','/api/classes/1'],['POST','/api/result-cards/generate-student/101']]) assert.equal(isReadOnlySafeRequest(method,path),false,path);
});

test('update validation rejects bad plans, dates, limits and unknown modules',()=>{
  const ok={plan_key:'basic',status:'active',ends_on:'2027-06-30',expected_revision:1};
  assert.equal(parseSubscriptionUpdate(ok).grace_days,14);
  for (const bad of [{plan_key:'gold'},{status:'expired'},{ends_on:'2027-02-30'},{starts_on:'2027-07-01'},{grace_days:91},{max_students:0},{overrides:{chess:true}},{overrides:{grades:'yes'}},{expected_revision:0}]) {
    assert.throws(()=>parseSubscriptionUpdate({...ok,...bad}),JSON.stringify(bad));
  }
});

test('migration gives every existing and new school a full, open-ended subscription',async t=>{
  const f=fixture(t);
  assert.deepEqual(f.db.prepare('SELECT school_id,plan_key,status,ends_on,max_students FROM school_subscriptions ORDER BY school_id').all().map(r=>({...r})),
    [{school_id:1,plan_key:'full',status:'active',ends_on:null,max_students:null},{school_id:2,plan_key:'full',status:'active',ends_on:null,max_students:null}]);
  f.db.exec("INSERT INTO schools(id,name,school_type,city,status) VALUES(7,'New','خاص','Duhok','active')");
  assert.equal(subscription(f,7).plan_key,'full');
  const me=await api(f,'owner','GET','/api/auth/me');
  assert.equal(me.status,200);assert.equal(me.data.subscription.state,'active');assert.deepEqual(me.data.subscription.modules,[...SCHOOL_MODULE_KEYS]);
  assert.equal((await api(f,'admin','GET','/api/auth/me')).data.subscription,null);
});

test('code deployed before migration 0061 leaves schools unrestricted',async()=>{
  const db=new DatabaseSync(':memory:');
  for (const file of migrationFiles.filter(file=>file<'0061')) db.exec(migrationSQL(file));
  db.exec("INSERT INTO schools(id,name,school_type,city,status) VALUES(1,'A','خاص','Duhok','active')");
  assert.equal(await loadSchoolAccess(new LocalD1(db),1),null);
  db.close();
});

test('a basic plan closes other modules for school users while the admin keeps full access',async t=>{
  const f=fixture(t);
  const saved=await save(f,{plan_key:'basic'});
  assert.equal(saved.status,200,JSON.stringify(saved));assert.deepEqual(saved.data.modules,['grades','official_documents']);
  const closed=await api(f,'owner','GET','/api/timetable/days?school_id=1&academic_year_id=1');
  assert.equal(closed.status,403);assert.equal(closed.code,'module_disabled');
  assert.equal((await api(f,'parent','GET','/api/student-finance/101')).code,'module_disabled');
  assert.equal((await api(f,'owner','GET','/api/grades?school_id=1')).status,200);
  assert.equal((await api(f,'owner','GET','/api/students?school_id=1')).status,200);
  assert.equal((await api(f,'admin','GET','/api/timetable/days?school_id=1&academic_year_id=1')).status,200);
  assert.equal((await api(f,'foreignParent','GET','/api/auth/me')).data.subscription.plan_key,'full','another school is untouched');
  const opened=await save(f,{plan_key:'basic',overrides:{timetable:true}});
  assert.equal(opened.status,200);assert.deepEqual(opened.data.overrides,{timetable:true});
  assert.equal((await api(f,'owner','GET','/api/timetable/days?school_id=1&academic_year_id=1')).status,200);
});

test('grace keeps writing open with a warning; after grace or suspension the school is read-only',async t=>{
  const f=fixture(t);
  assert.equal((await save(f,{ends_on:day(-3),grace_days:14})).status,200);
  const grace=await api(f,'owner','GET','/api/auth/me');assert.equal(grace.data.subscription.state,'grace');assert.equal(grace.data.subscription.days_left,12);
  assert.equal((await api(f,'owner','POST','/api/classes',{school_id:1,name:'Grace class',stage:'ابتدائي'})).status,201);
  assert.equal((await save(f,{ends_on:day(-15),grace_days:14})).status,200);
  const blocked=await api(f,'owner','POST','/api/classes',{school_id:1,name:'Late class',stage:'ابتدائي'});
  assert.equal(blocked.status,403);assert.equal(blocked.code,'subscription_read_only');
  assert.equal((await api(f,'owner','GET','/api/classes?school_id=1')).status,200);
  assert.equal((await api(f,'owner','POST','/api/auth/logout')).status,200);
  assert.equal((await api(f,'admin','POST','/api/classes',{school_id:1,name:'Admin class',stage:'ابتدائي'})).status,201,'the system admin can still fix data');
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM classes WHERE name='Late class'").get().n,0);
  assert.equal((await save(f,{status:'suspended',ends_on:null})).status,200);
  assert.equal((await api(f,'teacher','POST','/api/classes',{school_id:1,name:'Suspended',stage:'ابتدائي'})).code,'subscription_read_only');
});

test('only the system admin edits subscriptions, with stale-edit protection and an audit trail',async t=>{
  const f=fixture(t);
  assert.equal((await api(f,'owner','GET','/api/schools/1/subscription')).status,403);
  assert.equal((await api(f,'owner','PUT','/api/schools/1/subscription',{plan_key:'full',status:'active',expected_revision:1})).status,403);
  assert.equal((await save(f,{plan_key:'standard',notes:'Paid until June'})).status,200);
  const stale=await api(f,'admin','PUT','/api/schools/1/subscription',{plan_key:'basic',status:'active',expected_revision:1});
  assert.equal(stale.status,409);assert.equal(stale.code,'subscription_stale');
  assert.equal(subscription(f).plan_key,'standard');
  const details=await api(f,'admin','GET','/api/schools/1/subscription');
  assert.equal(details.data.subscription.revision,2);assert.equal(details.data.audit.length,1);
  assert.equal(JSON.parse(details.data.audit[0].after_json).plan_key,'standard');
  assert.equal(details.data.active_students,2);
  assert.equal((await api(f,'admin','PUT','/api/schools/1/subscription',{plan_key:'gold',status:'active',expected_revision:2})).status,400);
  assert.equal((await api(f,'admin','GET','/api/schools/99/subscription')).status,404);
  assert.throws(()=>f.db.exec('UPDATE school_subscription_audit SET after_json=\'{}\''),/immutable/);
});

test('the active-student cap blocks new and reactivated students in that school only',async t=>{
  const f=fixture(t);
  assert.equal((await save(f,{max_students:2})).status,200);
  const area=Number(f.db.prepare("INSERT INTO residential_areas(school_id,name,name_key) VALUES(1,'Cap area','cap area')").run().lastInsertRowid);
  const blocked=await api(f,'owner','POST','/api/students',{school_id:1,student_number:'CAP-1',full_name:'Over cap',gender:'male',class_id:1,section_id:2,residential_area_id:area,guardian_phone:'07700000000'});
  assert.equal(blocked.status,409,JSON.stringify(blocked));assert.equal(blocked.code,'school_student_limit_reached');
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM students WHERE student_number='CAP-1'").get().n,0);
  f.db.exec("UPDATE students SET status='inactive' WHERE id=102");
  f.db.exec("INSERT INTO students(school_id,student_number,full_name,gender,status) VALUES(1,'CAP-2','Takes the freed seat','male','active')");
  assert.throws(()=>f.db.exec("UPDATE students SET status='active' WHERE id=102"),/school_student_limit_reached/);
  f.db.exec("INSERT INTO students(school_id,student_number,full_name,gender,status) VALUES(1,'CAP-3','Inactive rows are not counted','male','inactive')");
  f.db.exec("INSERT INTO students(school_id,student_number,full_name,gender,status) VALUES(2,'CAP-4','Other school','male','active')");
});
