import assert from 'node:assert/strict';
import test, {after} from 'node:test';
import {createServer} from 'vite';
import {signJWT} from '../src/lib/jwtSecurity.ts';
import {employeeSpreadsheetQualifications,employeeQualificationCells,employeeSpreadsheetDate,employeeSpreadsheetMappedDates} from '../src/lib/employeeSpreadsheet.ts';
import * as XLSX from 'xlsx';
import {financeFixture,root} from './helpers/finance-fixture.mjs';

const vite=await createServer({root,appType:'custom',server:{middlewareMode:true,hmr:false}});
const {default:app}=await vite.ssrLoadModule('/src/worker.ts');
after(()=>vite.close());
const secret='employee-import-test-secret-over-thirty-two-characters';
const tokens=Object.fromEntries(await Promise.all([['owner',1],['registrar',7],['accountant',4]].map(async([role,id])=>[role,await signJWT({id,email:`${role}@matrix.test`,auth_version:1},secret)])));
async function call(f,{action='confirm',role='owner',body,school=1,mode='update_existing'}={}) {
  const response=await app.request(`http://localhost/api/import-export/employees/${action}${action==='export'?`?school_id=${school}`:''}`,{
    method:action==='export'?'GET':'POST',headers:{Authorization:`Bearer ${tokens[role]}`,'Content-Type':'application/json'},
    body:action==='export'?undefined:JSON.stringify({school_id:school,mode,rows:Array.isArray(body)?body:[body]}),
  },{DB:f.d1,JWT_SECRET:secret,APP_ENV:'test'});
  return {status:response.status,body:await response.json()};
}
const qualifications=[{degree:'بكالوريوس',general_specialization:'الفيزياء',specific_specialization:'البصريات',institution:'جامعة الموصل',college:'كلية العلوم',graduation_date:'2012-06-20',is_primary:true},
  {degree:'ماجستير',general_specialization:'الفيزياء',specific_specialization:'الليزر',institution:'جامعة دهوك',college:'كلية العلوم',graduation_date:'2017-07-12',is_primary:false}];
const draft=()=>({full_name:'موظف تجربة الاستيراد',employee_number:'STAFF-008',role:'مدرس',salary_amount:900000,employee_type:'teacher',salary_type:'monthly',hire_date:'2018-09-01',commencement_date:'2018-09-10',address:'عنوان تجريبي',...employeeQualificationCells(qualifications)});

test('multiple qualifications round trip as editable columns without losing primary selection or date',()=>{
  assert.deepEqual(employeeSpreadsheetQualifications(employeeQualificationCells(qualifications),v=>String(v)),qualifications);
  assert.equal(employeeSpreadsheetQualifications({full_name:'old row'},v=>String(v)),undefined);
  assert.throws(()=>employeeSpreadsheetQualifications({...employeeQualificationCells(qualifications),qualification_2_is_primary:'نعم'},v=>String(v)),/أساسياً/);
  assert.throws(()=>employeeSpreadsheetQualifications({qualification_1_degree:'degree',qualification_1_graduation_date:'2026-02-30'},v=>String(v)),/التاريخ/);
});

test('preview, atomic import and export preserve separate service dates and every qualification',async t=>{
  const f=financeFixture(t);
  const preview=await call(f,{action:'preview',body:draft()});
  assert.equal(preview.status,200,JSON.stringify(preview));assert.equal(preview.body.data.errors.length,0);
  assert.deepEqual(preview.body.data.valid[0].data.qualifications,qualifications);
  for (const [key,value] of Object.entries(employeeQualificationCells(qualifications))) assert.equal(preview.body.data.valid[0].data[key],value,`preview cell ${key}`);
  const result=await call(f,{body:preview.body.data.valid[0].data});
  assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.body.data.imported_count,1,JSON.stringify(result));
  const employee=f.db.prepare('SELECT * FROM employees WHERE employee_number=?').get('STAFF-008');
  assert.equal(employee.role,'teacher');assert.equal(employee.hire_date,'2018-09-01');assert.equal(employee.commencement_date,'2018-09-10');
  assert.equal(f.db.prepare('SELECT count(*) n FROM employee_qualifications WHERE employee_id=?').get(employee.id).n,2);
  assert.equal(f.db.prepare('SELECT count(*) n FROM employee_record_audit WHERE employee_id=?').get(employee.id).n,1);
  const exported=await call(f,{action:'export'});
  const row=exported.body.data.rows.find(r=>r.employee_number==='STAFF-008');
  assert.deepEqual(employeeSpreadsheetQualifications(row,v=>String(v)),qualifications);
  assert.equal(row.commencement_date,'2018-09-10');assert.equal(row.photo_object_key,undefined);
});

test('old spreadsheets preserve new fields and saved monthly salaries when current salary changes',async t=>{
  const f=financeFixture(t);assert.equal((await call(f,{body:draft()})).body.data.imported_count,1);
  const employee=f.db.prepare('SELECT id FROM employees WHERE employee_number=?').get('STAFF-008');
  f.db.prepare('INSERT INTO employee_salaries(school_id,employee_id,month,year,base_salary,net_salary) VALUES(1,?,9,2026,900000,900000)').run(employee.id);
  const before=f.db.prepare('SELECT * FROM employee_salaries WHERE employee_id=?').all(employee.id);
  const update=await call(f,{body:{full_name:draft().full_name,salary_amount:1100000}});
  assert.equal(update.body.data.updated_count,1,JSON.stringify(update));
  const row=f.db.prepare('SELECT * FROM employees WHERE id=?').get(employee.id);
  assert.equal(row.employee_number,'STAFF-008');assert.equal(row.commencement_date,'2018-09-10');assert.equal(row.role,'teacher');
  assert.equal(row.salary_amount,1100000);assert.deepEqual(f.db.prepare('SELECT * FROM employee_salaries WHERE employee_id=?').all(employee.id),before);
  assert.equal(f.db.prepare('SELECT count(*) n FROM employee_qualifications WHERE employee_id=?').get(employee.id).n,2);
});

test('qualification persistence failure rolls back employee and audit inserts together',async t=>{
  const f=financeFixture(t);
  f.db.exec("CREATE TRIGGER fail_qualification BEFORE INSERT ON employee_qualifications BEGIN SELECT RAISE(ABORT,'injected qualification failure'); END");
  const result=await call(f,{body:draft()});
  assert.equal(result.body.data.error_count,1,JSON.stringify(result));assert.equal(result.body.data.imported_count,0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM employees WHERE employee_number=?').get('STAFF-008').n,0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM employee_record_audit').get().n,0);
});

test('employee export and import deny nonmanagement and other school scopes',async t=>{
  const f=financeFixture(t);
  for(const role of ['registrar','accountant'])for(const action of ['preview','confirm','export']) {
    assert.equal((await call(f,{role,action,body:draft()})).status,403,role+' '+action);
  }
  for(const action of ['preview','confirm','export'])assert.equal((await call(f,{action,school:2,body:draft()})).status,403);
});

test('Excel employee dates support both workbook calendars and reject imaginary or invalid dates',()=>{
  assert.equal(employeeSpreadsheetDate(1),'1900-01-01');
  assert.equal(employeeSpreadsheetDate(59),'1900-02-28');
  assert.equal(employeeSpreadsheetDate(61),'1900-03-01');
  assert.equal(employeeSpreadsheetDate(44927.5),'2023-01-01');
  assert.equal(employeeSpreadsheetDate(0,true),'1904-01-01');
  for(const value of [60,60.5,-1,0,Infinity,'2026-02-30','not a date']) assert.throws(()=>employeeSpreadsheetDate(value),/تاريخ|التاريخ/);
  for(const date1904 of [false,true]) {
    const workbook=XLSX.utils.book_new();
    workbook.Workbook={WBProps:{date1904}};
    const serial=date1904?43465:44927;
    XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([['appointed','started','graduated','number'],[serial,serial+2,serial-1,serial]]),'staff');
    const parsed=XLSX.read(XLSX.write(workbook,{type:'buffer',bookType:'xlsx'}),{type:'buffer'});
    const [row]=XLSX.utils.sheet_to_json(parsed.Sheets.staff);
    const normalized=employeeSpreadsheetMappedDates(row,{hire_date:'appointed',commencement_date:'started',qualification_1_graduation_date:'graduated',employee_number:'number'},!!parsed.Workbook.WBProps.date1904);
    assert.deepEqual(normalized,{appointed:'2023-01-01',started:'2023-01-03',graduated:'2022-12-31',number:serial});
    assert.equal(row.appointed,serial,'source workbook remains unchanged');
  }
});

test('preview and direct confirmation normalize serial service and qualification dates without dropping invalid dates',async t=>{
  const f=financeFixture(t);
  const body={...draft(),hire_date:44927,commencement_date:44929,qualification_1_graduation_date:43466};
  const preview=await call(f,{action:'preview',body});
  assert.equal(preview.body.data.errors.length,0,JSON.stringify(preview));
  assert.equal(preview.body.data.valid[0].data.hire_date,'2023-01-01');
  assert.equal(preview.body.data.valid[0].data.commencement_date,'2023-01-03');
  assert.equal(preview.body.data.valid[0].data.qualification_1_graduation_date,'2019-01-01');
  const confirmed=await call(f,{body});
  assert.equal(confirmed.body.data.imported_count,1,JSON.stringify(confirmed));
  const saved=f.db.prepare('SELECT hire_date,commencement_date FROM employees WHERE employee_number=?').get('STAFF-008');
  assert.equal(saved.hire_date,'2023-01-01');assert.equal(saved.commencement_date,'2023-01-03');
  for(const field of ['hire_date','commencement_date','qualification_1_graduation_date']) {
    const invalid={...body,[field]:60};
    assert.ok((await call(f,{action:'preview',body:invalid})).body.data.errors.length>0);
    assert.equal((await call(f,{body:invalid})).body.data.error_count,1);
    assert.deepEqual(f.db.prepare('SELECT hire_date,commencement_date FROM employees WHERE employee_number=?').get('STAFF-008'),saved);
  }
});

test('employee number updates the same employee after a name correction and preserves unmapped qualifications',async t=>{
  const f=financeFixture(t);
  assert.equal((await call(f,{body:draft()})).body.data.imported_count,1);
  const before=f.db.prepare('SELECT id FROM employees WHERE employee_number=?').get('STAFF-008');
  const renamed={full_name:'اسم مصحح للموظف',employee_number:'STAFF-008',salary_amount:900000};
  const preview=await call(f,{action:'preview',body:renamed});
  assert.equal(preview.body.data.errors.length,0,JSON.stringify(preview));
  const result=await call(f,{body:preview.body.data.valid[0].data});
  assert.equal(result.body.data.updated_count,1,JSON.stringify(result));assert.equal(result.body.data.imported_count,0);
  const rows=f.db.prepare('SELECT id,full_name FROM employees WHERE employee_number=?').all('STAFF-008');
  assert.equal(rows.length,1);assert.equal(rows[0].id,before.id);assert.equal(rows[0].full_name,renamed.full_name);
  assert.equal(f.db.prepare('SELECT count(*) n FROM employee_qualifications WHERE employee_id=?').get(before.id).n,2);
});

test('ambiguous, conflicting and archived employee identifiers are rejected in preview and confirmation',async t=>{
  const f=financeFixture(t);
  for(const body of [{...draft(),email:'first@example.test'},{...draft(),full_name:'موظف آخر',employee_number:'STAFF-009',email:'second@example.test'}]) {
    assert.equal((await call(f,{body})).body.data.imported_count,1);
  }
  const original=f.db.prepare('SELECT * FROM employees ORDER BY id').all();
  for(const body of [
    {full_name:'اسم جديد',employee_number:'STAFF-008',email:'second@example.test'},
    {full_name:'اسم جديد',employee_number:'UNKNOWN',email:'first@example.test'},
    {full_name:draft().full_name,employee_number:'UNKNOWN'},
  ]) {
    assert.ok((await call(f,{action:'preview',body})).body.data.errors.length>0);
    assert.equal((await call(f,{body})).body.data.error_count,1);
  }
  assert.deepEqual(f.db.prepare('SELECT * FROM employees ORDER BY id').all(),original);
  f.db.prepare("UPDATE employees SET employee_number='STAFF-008' WHERE employee_number='STAFF-009'").run();
  const ambiguous={full_name:'اسم جديد',employee_number:'STAFF-008'};
  assert.ok((await call(f,{action:'preview',body:ambiguous})).body.data.errors.length>0);
  assert.equal((await call(f,{body:ambiguous})).body.data.error_count,1);
  f.db.prepare("UPDATE employees SET employee_number='STAFF-009' WHERE email='second@example.test'").run();
  f.db.prepare("UPDATE employees SET status='archived' WHERE email='first@example.test'").run();
  for(const body of [{full_name:'اسم جديد',employee_number:'STAFF-008'},{full_name:'اسم جديد',email:'first@example.test'},{full_name:draft().full_name}]) {
    assert.ok((await call(f,{action:'preview',body})).body.data.errors.length>0);
    assert.equal((await call(f,{body})).body.data.error_count,1);
  }
  assert.equal(f.db.prepare("SELECT status FROM employees WHERE email='first@example.test'").get().status,'archived');
  assert.equal(f.db.prepare('SELECT count(*) n FROM employees').get().n,original.length);
});
