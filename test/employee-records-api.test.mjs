import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import {createServer} from 'vite';
import {signJWT} from '../src/lib/jwtSecurity.ts';
import {root,financeFixture,migrationSQL,snapshot} from './helpers/finance-fixture.mjs';
import {entry} from './helpers/teaching-load-matrix-fixture.mjs';

const vite=await createServer({root,appType:'custom',server:{middlewareMode:true,hmr:false}});
const {default:app}=await vite.ssrLoadModule('/src/worker.ts');after(()=>vite.close());
const secret='employee-records-test-secret-at-least-32-characters';
const tokens=Object.fromEntries(await Promise.all(['owner','admin','teacher','accountant','principal','vice','registrar','parent'].map(async(key,index)=>[key,await signJWT({id:index+1,email:`${key}@matrix.test`,auth_version:1},secret)])));
async function call(f,{path='/api/employees?school_id=1',method='GET',body,role='owner',raw,mime='image/png'}={}){
  const response=await app.request('http://localhost'+path,{method,headers:{Authorization:`Bearer ${tokens[role]}`,'Content-Type':raw!==undefined?mime:'application/json'},body:raw!==undefined?raw:body===undefined?undefined:JSON.stringify(body)},{DB:f.d1,JWT_SECRET:secret,APP_ENV:'test',HOMEWORK_FILES:f.store});
  return {status:response.status,headers:response.headers,body:response.headers.get('Content-Type')?.includes('application/json')?await response.json():new Uint8Array(await response.arrayBuffer())};
}
const qualification=(patch={})=>({degree:'بكالوريوس',general_specialization:'فيزياء',specific_specialization:'كهرباء',institution:'جامعة دهوك',college:'العلوم',graduation_date:'2020-06-30',is_primary:true,...patch});
const draft=(patch={})=>({school_id:1,full_name:'موظف تجريبي',employee_number:'EMP-NEW',phone:'01234',email:'staff@example.test',address:'عنوان سري',gender:'male',role:'teacher',employee_type:'teacher',salary_type:'monthly',salary_amount:750000,hire_date:'2025-09-01',commencement_date:'2025-09-10',notes:'ملاحظات خاصة',qualifications:[qualification(),qualification({degree:'ماجستير',is_primary:false})],...patch});
const save=(f,body=draft())=>call(f,{path:'/api/employees',method:'POST',body});
const profile=(f,id=2,role='owner',year='1')=>call(f,{path:`/api/employees/${id}/profile?school_id=1${year?'&academic_year_id='+year:''}`,role});
const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5v8AAAAASUVORK5CYII=','base64'));
function store(f){const objects=new Map();f.store={async put(key,bytes,options){objects.set(key,{bytes:new Uint8Array(bytes),options});},async get(key){const object=objects.get(key);return object?{arrayBuffer:async()=>object.bytes.buffer}:null;},async delete(key){objects.delete(key);}};return objects;}

test('0054 preserves existing appointment dates and salaries without backfilling commencement or photographs',t=>{
  const f=financeFixture(t,{through:'0053'});f.db.exec("UPDATE employees SET hire_date='2020-01-01',salary_amount=500000 WHERE id=1");
  const before=snapshot(f.db);f.db.exec(migrationSQL('0054_employee_records.sql'));const after=snapshot(f.db);
  for(const [table,rows]of Object.entries(before)){if(table==='employees')continue;assert.deepEqual(after[table],rows,table);}
  const row=f.db.prepare('SELECT * FROM employees WHERE id=1').get();assert.equal(row.hire_date,'2020-01-01');assert.equal(row.commencement_date,null);assert.equal(row.photo_object_key,null);assert.equal(row.salary_amount,500000);
});

test('create saves full fields and multiple qualifications in one transaction with immutable actor audit',async t=>{
  const f=financeFixture(t);const r=await save(f);assert.equal(r.status,201,JSON.stringify(r));const id=r.body.data.id;
  const row=f.db.prepare('SELECT * FROM employees WHERE id=?').get(id);assert.equal(row.commencement_date,'2025-09-10');assert.equal(row.hire_date,'2025-09-01');assert.equal(row.address,'عنوان سري');
  const qualifications=f.db.prepare('SELECT * FROM employee_qualifications WHERE employee_id=? ORDER BY id').all(id);assert.equal(qualifications.length,2);assert.ok(qualifications.every(q=>q.employee_id===id&&q.school_id===1));assert.equal(qualifications.filter(q=>q.is_primary===1).length,1);
  const audit=f.db.prepare('SELECT * FROM employee_record_audit').get();assert.equal(audit.employee_id,id);assert.equal(audit.actor_user_id,1);assert.equal(audit.action,'created');assert.equal(JSON.parse(audit.after_json).qualifications.length,2);
  assert.throws(()=>f.db.exec("UPDATE employee_record_audit SET action='updated'"),/immutable/);assert.throws(()=>f.db.exec('DELETE FROM employee_record_audit'),/immutable/);
  const next=await save(f,draft({full_name:'الثاني',qualifications:[]}));assert.equal(next.status,201);assert.notEqual(next.body.data.id,id);assert.equal(f.db.prepare('SELECT employee_id FROM employee_record_audit ORDER BY id DESC LIMIT 1').get().employee_id,next.body.data.id);
});

test('invalid fields, dates and primary selections fail without any partial record; batch failure rolls back all writes',async t=>{
  const f=financeFixture(t),before=snapshot(f.db);
  for(const patch of [{full_name:'   '},{hire_date:'2026-02-31'},{commencement_date:'2026-13-10'},{salary_amount:1.25},{salary_amount:'1e3'},{salary_amount:true},{gender:'unknown'},{employee_type:'bad'},{email:'invalid'},{qualifications:[qualification({is_primary:false})]},{qualifications:[qualification(),qualification()]},{qualifications:[qualification({graduation_date:'2026-02-30'})]}])assert.equal((await save(f,draft(patch))).status,400,JSON.stringify(patch));
  assert.deepEqual(snapshot(f.db),before);f.d1.failAt=2;assert.equal((await save(f)).status,500);assert.deepEqual(snapshot(f.db),before);
});

test('update clears nullable fields, preserves saved salary history and atomically replaces qualifications',async t=>{
  const f=financeFixture(t),created=await save(f),id=created.body.data.id;
  assert.equal((await call(f,{path:'/api/salaries/generate',method:'POST',body:{school_id:1,employee_id:id,month:9,year:2026}})).status,201);
  const salary=f.db.prepare('SELECT * FROM employee_salaries').all(),body={school_id:1,salary_amount:950000,address:'',hire_date:null,commencement_date:'',qualifications:[qualification({degree:'دكتوراه'})]};
  assert.equal((await call(f,{path:`/api/employees/${id}`,method:'PUT',body})).status,200);
  const details=await profile(f,id);assert.equal(details.status,200,JSON.stringify(details));assert.equal(details.body.data.employee.salary_amount,950000);assert.equal(details.body.data.employee.address,null);assert.equal(details.body.data.employee.hire_date,null);assert.equal(details.body.data.employee.commencement_date,null);assert.equal(details.body.data.qualifications[0].degree,'دكتوراه');assert.deepEqual(f.db.prepare('SELECT * FROM employee_salaries').all(),salary);
  const before=snapshot(f.db);f.d1.failAt=3;assert.equal((await call(f,{path:`/api/employees/${id}`,method:'PUT',body:{...body,salary_amount:123}})).status,500);assert.deepEqual(snapshot(f.db),before);
});

test('concurrent field or qualification writes reject stale employee updates without child writes or misleading audit',async t=>{
  const f=financeFixture(t),created=await save(f),id=created.body.data.id,path=`/api/employees/${id}`;
  const originalQualifications=f.db.prepare('SELECT * FROM employee_qualifications WHERE employee_id=? ORDER BY id').all(id);
  f.d1.beforeWrite=()=>f.db.prepare('UPDATE employees SET salary_amount=?,notes=? WHERE id=?').run(880000,'التعديل الأحدث',id);
  const conflict=await call(f,{path,method:'PUT',body:{school_id:1,notes:'التعديل القديم',qualifications:[]}});
  assert.equal(conflict.status,409);assert.equal(f.db.prepare('SELECT salary_amount FROM employees WHERE id=?').get(id).salary_amount,880000);assert.equal(f.db.prepare('SELECT notes FROM employees WHERE id=?').get(id).notes,'التعديل الأحدث');
  assert.deepEqual(f.db.prepare('SELECT * FROM employee_qualifications WHERE employee_id=? ORDER BY id').all(id),originalQualifications);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM employee_record_audit').get().n,1);
  let concurrentSnapshot;
  f.d1.beforeWrite=()=>{
    f.db.prepare('DELETE FROM employee_qualifications WHERE employee_id=?').run(id);
    f.db.prepare("INSERT INTO employee_qualifications(school_id,employee_id,degree,is_primary) VALUES(1,?,'الدراسة الأحدث',1)").run(id);
    concurrentSnapshot=snapshot(f.db);
  };
  assert.equal((await call(f,{path,method:'PUT',body:{school_id:1,address:'عنوان قديم',qualifications:[qualification()]}})).status,409);assert.deepEqual(snapshot(f.db),concurrentSnapshot);
  assert.equal((await call(f,{path,method:'PUT',body:{school_id:1,qualifications:[]}})).status,200);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM employee_qualifications WHERE employee_id=?').get(id).n,0);
  assert.equal((await call(f,{path,method:'PUT',body:{school_id:1,qualifications:[qualification(),qualification({degree:'ماجستير',is_primary:false})]}})).status,200);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM employee_qualifications WHERE employee_id=?').get(id).n,2);
  // An ordinary fields-only update must also preserve the full child collection.
  assert.equal((await call(f,{path,method:'PUT',body:{school_id:1,address:'عنوان محدث'}})).status,200);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM employee_qualifications WHERE employee_id=?').get(id).n,2);
  const auditCount=f.db.prepare('SELECT COUNT(*) n FROM employee_record_audit').get().n;
  f.d1.beforeWrite=()=>f.db.prepare("UPDATE employees SET status='archived' WHERE id=?").run(id);
  assert.equal((await call(f,{path:path+'/archive',method:'PUT',body:{school_id:1}})).status,200);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM employee_record_audit').get().n,auditCount);
});

test('management roles read full records; accountants receive payroll fields only; academic and parent roles denied',async t=>{
  const f=financeFixture(t),created=await save(f),id=created.body.data.id;
  for(const role of ['owner','admin','principal','vice']){const r=await profile(f,id,role);assert.equal(r.status,200,role+JSON.stringify(r));assert.equal(r.body.data.employee.address,'عنوان سري');assert.equal(r.body.data.qualifications.length,2);assert.equal(r.body.data.can_manage,true);}
  for(const path of [`/api/employees/${id}/profile?school_id=1`,`/api/employees/${id}?school_id=1`,'/api/employees?school_id=1','/api/staff-register?school_id=1']){
    const r=await call(f,{path,role:'accountant'});assert.equal(r.status,200);assert.doesNotMatch(JSON.stringify(r.body),/عنوان سري|ملاحظات خاصة|بكالوريوس|staff@example.test|01234|photo_object_key|photo_content_type/);
  }
  const accountant=await profile(f,id,'accountant');assert.equal(accountant.body.data.can_view_private,false);assert.equal(accountant.body.data.can_manage,false);assert.deepEqual(accountant.body.data.teaching_assignments,[]);assert.deepEqual(accountant.body.data.academic_years,[]);
  for(const role of ['teacher','registrar','parent'])for(const path of [`/api/employees/${id}/profile?school_id=1`,'/api/employees?school_id=1','/api/staff-register?school_id=1','/api/salary-receipts?school_id=1&month=9&year=2026'])assert.equal((await call(f,{path,role})).status,403,role+path);
  for(const role of ['accountant','teacher','registrar','parent'])assert.equal((await call(f,{path:`/api/employees/${id}`,method:'PUT',body:{school_id:1,notes:'changed'},role})).status,403);
});

test('employee, school, year and photo scopes are validated and every read leaves all tables unchanged',async t=>{
  const f=financeFixture(t);store(f);const before=snapshot(f.db);
  for(const path of ['/api/employees/5/profile?school_id=1','/api/employees/5?school_id=1','/api/employees/5/photo?school_id=1'])assert.equal((await call(f,{path})).status,404);
  for(const path of ['/api/employees?school_id=2','/api/staff-register?school_id=2','/api/salary-receipts?school_id=2&month=9&year=2026'])assert.equal((await call(f,{path})).status,403);
  for(const path of ['/api/employees','/api/staff-register','/api/employees/1/profile','/api/salary-receipts?month=9&year=2026'])assert.equal((await call(f,{path,role:'admin'})).status,400);
  for(const invalid of ['1x','1.2','0','-1'])assert.equal((await call(f,{path:'/api/staff-register?school_id='+invalid,role:'admin'})).status,400);
  assert.equal((await profile(f,2,'owner','3')).status,403);assert.equal((await profile(f,2,'owner','bogus')).status,400);
  for(const path of ['/api/employees/2/profile?school_id=1','/api/staff-register?school_id=1','/api/salary-receipts?school_id=1&month=9&year=2026'])assert.equal((await call(f,{path})).status,200);
  assert.deepEqual(snapshot(f.db),before);
});

test('teacher profile derives saved lesson counts and adviser history for the selected year without rewriting academics',async t=>{
  const f=financeFixture(t);entry(f.db,2,1);entry(f.db,2,2);
  f.db.exec("INSERT INTO section_advisors(school_id,academic_year_id,class_id,section_id,employee_id,created_by_user_id,updated_by_user_id) VALUES(1,1,1,2,2,1,1)");
  const before=snapshot(f.db),r=await profile(f);assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.body.data.total_saved_weekly_periods,2);assert.equal(r.body.data.teaching_assignments[0].subject_name,'Math');assert.equal(r.body.data.teaching_assignments[0].planned_weekly_periods,4);assert.equal(r.body.data.advisory_assignments[0].section_name,'B');
  const previous=await profile(f,2,'owner','2');assert.equal(previous.body.data.total_saved_weekly_periods,0);assert.equal(previous.body.data.teaching_assignments[0].subject_name,'Arabic');assert.deepEqual(previous.body.data.advisory_assignments,[]);assert.deepEqual(snapshot(f.db),before);
  f.db.exec("UPDATE employees SET status='archived' WHERE id=2");assert.equal((await profile(f)).body.data.total_saved_weekly_periods,2);
});

test('register filters all staff roles and explicit archives and uses current school document settings without creating defaults',async t=>{
  const f=financeFixture(t);const created=await save(f);const id=created.body.data.id;
  f.db.exec("INSERT INTO school_settings(school_id,use_arabic_indic_digits,date_format,official_book_header_text) VALUES(1,0,'yyyy-MM-dd','ترويسة المدرسة')");
  let r=await call(f,{path:'/api/staff-register?school_id=1'});assert.equal(r.body.data.employees.length,6);assert.equal(r.body.data.document_settings.date_format,'yyyy-MM-dd');assert.equal(r.body.data.document_settings.currency,'IQD');assert.equal(r.body.data.document_settings.use_arabic_indic_digits,false);assert.equal(r.body.data.employees.find(e=>e.id===id).primary_qualification.degree,'بكالوريوس');
  r=await call(f,{path:'/api/staff-register?school_id=1&status=archived'});assert.deepEqual(r.body.data.employees.map(e=>e.id),[4]);
  r=await call(f,{path:'/api/staff-register?school_id=1&q=EMP-NEW&role=teacher&status=all'});assert.deepEqual(r.body.data.employees.map(e=>e.id),[id]);
  const foreign=await call(f,{path:'/api/staff-register?school_id=2',role:'admin'});assert.equal(foreign.body.data.school.name,'Secret School');assert.deepEqual(foreign.body.data.employees.map(e=>e.id),[5]);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM school_settings WHERE school_id=2').get().n,0);
});

test('salary receipt reads persisted amounts including archived staff, excludes cancelled totals and reports missing months explicitly',async t=>{
  const f=financeFixture(t);
  for(const [employee_id,base_salary,bonus_amount,deduction_amount]of [[1,100000,10000,5000],[2,200000,0,2000],[6,300000,0,0]])assert.equal((await call(f,{path:'/api/salaries/generate',method:'POST',body:{school_id:1,employee_id,month:9,year:2026,base_salary,bonus_amount,deduction_amount}})).status,201);
  const cancelled=f.db.prepare('SELECT id FROM employee_salaries WHERE employee_id=6').get().id;
  assert.equal((await call(f,{path:`/api/salaries/${cancelled}/cancel`,method:'PUT',body:{school_id:1,cancel_reason:'اختبار الإلغاء'}})).status,200);
  f.db.exec("UPDATE employees SET status='archived',salary_amount=999999 WHERE id=1");
  const before=snapshot(f.db),r=await call(f,{path:'/api/salary-receipts?school_id=1&month=9&year=2026&status=all',role:'accountant'});assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.body.data.rows.length,3);assert.equal(r.body.data.rows.find(s=>s.employee_id===1).base_salary,100000);assert.equal(r.body.data.rows.find(s=>s.employee_id===1).employee_status,'archived');assert.equal(r.body.data.totals.net_salary,303000);assert.equal(r.body.data.totals.payable_count,2);assert.deepEqual(r.body.data.status_counts,{unpaid:2,paid:0,cancelled:1});assert.equal(r.body.data.missing_employee_count,2);
  const none=await call(f,{path:'/api/salary-receipts?school_id=1&month=8&year=2026'});assert.equal(none.body.data.period_record_count,0);assert.deepEqual(none.body.data.rows,[]);assert.equal(none.body.data.missing_employee_count,4);
  const filtered=await call(f,{path:'/api/salary-receipts?school_id=1&month=9&year=2026&status=cancelled'});assert.equal(filtered.body.data.rows.length,1);assert.equal(filtered.body.data.totals.net_salary,0);assert.deepEqual(snapshot(f.db),before);
});

test('photo upload checks actual bytes and size, protects tenant reads, audits replacement and removes deleted objects',async t=>{
  const f=financeFixture(t),objects=store(f),path='/api/employees/2/photo?school_id=1';
  for(const [raw,mime]of [[new TextEncoder().encode('<svg>bad</svg>'),'image/png'],[png,'image/jpeg'],[new Uint8Array(2*1024*1024+1),'image/png']])assert.equal((await call(f,{path,method:'POST',raw,mime})).status,400);
  assert.equal(objects.size,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM employee_record_audit').get().n,0);
  const r=await call(f,{path,method:'POST',raw:png});assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.body.data.has_photo,true);assert.equal(objects.size,1);assert.match([...objects.keys()][0],/^schools\/1\/employees\/2\//);
  const fetched=await call(f,{path});assert.equal(fetched.status,200);assert.deepEqual(fetched.body,png);assert.equal(fetched.headers.get('Cache-Control'),'private, no-store');assert.equal(fetched.headers.get('X-Content-Type-Options'),'nosniff');
  assert.equal((await call(f,{path,role:'accountant'})).status,403);assert.equal((await call(f,{path:'/api/employees/2/photo?school_id=2',role:'admin'})).status,404);assert.doesNotMatch(JSON.stringify((await profile(f)).body),/photo_object_key|photo_content_type|schools\/1\/employees/);
  const second=await call(f,{path,method:'POST',raw:png});assert.equal(second.status,200);assert.ok(second.body.data.photo_updated_at>r.body.data.photo_updated_at);assert.equal(objects.size,1);
  const before=snapshot(f.db);f.d1.failAt=1;assert.equal((await call(f,{path,method:'POST',raw:png})).status,500);assert.equal(objects.size,1);assert.deepEqual(snapshot(f.db),before);f.d1.failAt=null;
  assert.equal((await call(f,{path,method:'DELETE'})).status,200);assert.equal(objects.size,0);assert.equal((await call(f,{path})).status,404);assert.deepEqual(f.db.prepare('SELECT action FROM employee_record_audit ORDER BY id').all().map(a=>a.action),['photo_uploaded','photo_uploaded','photo_deleted']);
});

test('paid receipt uses persisted payment business date and amount after employee archive and salary changes without posting again',async t=>{
  const f=financeFixture(t),paidDate='2026-09-15';
  const funding=await call(f,{path:'/api/treasury/transactions',method:'POST',body:{school_id:1,transaction_type:'income',category:'other_income',amount:1000000,currency:'IQD',description:'تمويل محلي للاختبار',business_date:paidDate,client_request_id:crypto.randomUUID()}});assert.equal(funding.status,201,JSON.stringify(funding));
  const salary=await call(f,{path:'/api/salaries/generate',method:'POST',body:{school_id:1,employee_id:2,month:9,year:2026,base_salary:750000,bonus_amount:30000,deduction_amount:10000}});assert.equal(salary.status,201);
  const paid=await call(f,{path:`/api/salaries/${salary.body.data.id}/pay`,method:'PUT',body:{school_id:1,paid_at:paidDate},role:'accountant'});assert.equal(paid.status,200,JSON.stringify(paid));
  const cancelled=await call(f,{path:'/api/salaries/generate',method:'POST',body:{school_id:1,employee_id:1,month:9,year:2026,base_salary:100000}});assert.equal(cancelled.status,201);
  assert.equal((await call(f,{path:`/api/salaries/${cancelled.body.data.id}/cancel`,method:'PUT',body:{school_id:1,cancel_reason:'راتب ملغى ضمن الكشف'}})).status,200);
  f.db.exec("UPDATE employees SET salary_amount=990000,status='archived' WHERE id=2");
  const before=snapshot(f.db),r=await call(f,{path:'/api/salary-receipts?school_id=1&month=9&year=2026&status=paid'});assert.equal(r.status,200);assert.equal(r.body.data.rows.length,1);assert.equal(r.body.data.rows[0].payment_business_date,paidDate);assert.equal(r.body.data.rows[0].base_salary,750000);assert.equal(r.body.data.rows[0].net_salary,770000);assert.equal(r.body.data.rows[0].employee_status,'archived');assert.equal(r.body.data.totals.net_salary,770000);assert.deepEqual(r.body.data.status_counts,{unpaid:0,paid:1,cancelled:1});
  const all=await call(f,{path:'/api/salary-receipts?school_id=1&month=9&year=2026&status=all'});assert.equal(all.body.data.rows.length,2);assert.equal(all.body.data.totals.net_salary,770000);assert.equal(all.body.data.totals.payable_count,1);
  const unpaid=await call(f,{path:'/api/salary-receipts?school_id=1&month=9&year=2026'});assert.equal(unpaid.body.data.rows.length,0);assert.equal(unpaid.body.data.period_record_count,2);assert.equal((await profile(f)).body.data.salary_history[0].payment_business_date,paidDate);assert.deepEqual(snapshot(f.db),before);
});
