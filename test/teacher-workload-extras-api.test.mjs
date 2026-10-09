import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import {createServer} from 'vite';
import {signJWT} from '../src/lib/jwtSecurity.ts';
import {root,fixture as makeFixture,entry,snapshot,revision} from './helpers/teaching-load-matrix-fixture.mjs';
const vite=await createServer({root,appType:'custom',server:{middlewareMode:true,hmr:false}});
const {default:app}=await vite.ssrLoadModule('/src/worker.ts');
after(()=>vite.close());
const secret='workload-extras-tests-secret-at-least-thirty-two-characters';
const tokens=Object.fromEntries(await Promise.all([['owner',1],['admin',2],['teacher',3],['accountant',4],['principal',5],['vice',6],['registrar',7]].map(async([role,id])=>[role,await signJWT({id,email:`${role}@matrix.test`,auth_version:1},secret)])));
const base='/api/teacher-workload-extras';
const input={school_id:1,academic_year_id:1,employee_id:2,subject_name:'التربية المسيحية',weekly_periods:5,expected_version:0};
function fixture(t){const f=makeFixture();t.after(()=>f.db.close());return f;}
async function call(f,{role='owner',method='POST',url=base,body=input}={}){
 const r=await app.request('http://localhost'+url,{method,headers:{Authorization:`Bearer ${tokens[role]}`,'Content-Type':'application/json'},body:method==='GET'?undefined:JSON.stringify(body)},{DB:f.d1,JWT_SECRET:secret,APP_ENV:'test'});
 return {status:r.status,body:await r.json()};
}
const others=f=>{const s=snapshot(f.db);delete s.teacher_workload_extras;return s;};

test('CRUD versions and audit actors; report supplements never change timetable, attendance, revision or any other table',async t=>{
 const f=fixture(t);entry(f.db,2,1);const before=others(f),rev=revision(f.db);
 let r=await call(f);assert.equal(r.status,201,JSON.stringify(r));let extra=r.body.data;
 assert.equal(extra.version,1);assert.equal(extra.created_by_user_id,1);assert.equal(extra.updated_by_user_id,1);
 r=await call(f,{method:'GET',url:base+'?school_id=1&academic_year_id=1'});assert.equal(r.body.data.length,1);
 r=await call(f,{method:'GET',url:'/api/timetable/teacher-workload-summary?school_id=1&academic_year_id=1'});
 const teacher=r.body.data.teachers.find(t=>t.employee_id===2);assert.equal(teacher.weekly_periods,1);assert.equal(teacher.extra_weekly_periods,5);assert.equal(teacher.report_weekly_periods,6);assert.equal(teacher.breakdown.length,1);assert.equal(teacher.extras[0].id,extra.id);
 r=await call(f,{role:'principal',method:'PUT',url:base+'/'+extra.id,body:{...input,weekly_periods:4,expected_version:1}});assert.equal(r.status,200);assert.equal(r.body.data.version,2);assert.equal(r.body.data.updated_by_user_id,5);
 r=await call(f,{method:'PUT',url:base+'/'+extra.id,body:{...input,expected_version:1}});assert.equal(r.status,409);
 r=await call(f,{method:'DELETE',url:base+'/'+extra.id,body:{school_id:1,academic_year_id:1,expected_version:2}});assert.equal(r.status,200);assert.equal(r.body.data.version,3);assert.ok(r.body.data.deleted_at);
 r=await call(f,{method:'GET',url:base+'?school_id=1&academic_year_id=1'});assert.deepEqual(r.body.data,[]);
 assert.equal(revision(f.db),rev);assert.deepEqual(others(f),before);
});

test('academic permissions and strict tenant/year/active-real-teacher boundaries protect reads and writes',async t=>{
 const f=fixture(t),before=snapshot(f.db);
 for(const role of ['teacher','accountant'])for(const method of ['GET','POST','PUT','DELETE'])assert.equal((await call(f,{role,method,url:method==='GET'?base+'?school_id=1&academic_year_id=1':method==='POST'?base:base+'/1'})).status,403);
 for(const body of [{...input,school_id:2,academic_year_id:3},{...input,academic_year_id:3}])assert.equal((await call(f,{body})).status,403);
 for(const employee_id of [3,4,5,7,999,null,900000001])assert.equal((await call(f,{body:{...input,employee_id}})).status,400);
 for(const patch of [{weekly_periods:0},{weekly_periods:1.5},{weekly_periods:61},{weekly_periods:'5'},{subject_name:' '},{subject_name:'bad\u0000'},{subject_name:'x'.repeat(121)},{academic_year_id:0},{expected_version:1},{extra:'unknown'}])assert.equal((await call(f,{body:{...input,...patch}})).status,400);
 assert.equal((await call(f,{role:'admin',method:'GET',url:base+'?academic_year_id=1'})).status,400);
 assert.deepEqual(snapshot(f.db),before);
 for(const role of ['owner','admin','principal','vice','registrar'])assert.equal((await call(f,{role,body:{...input,subject_name:role}})).status,201);
});

test('duplicates conflict; real concurrent edits and teacher archival between check and write cannot overwrite',async t=>{
 const f=fixture(t),r=await call(f),id=r.body.data.id;
 assert.equal((await call(f)).status,409);
 const prepare=f.d1.prepare.bind(f.d1);let inject=()=>f.db.prepare('UPDATE teacher_workload_extras SET weekly_periods=6,version=version+1 WHERE id=?').run(id);
 f.d1.prepare=sql=>{const stmt=prepare(sql);if(/UPDATE teacher_workload_extras SET/.test(sql)&&inject){const fn=inject;inject=null;fn();}return stmt;};
 let edit=await call(f,{method:'PUT',url:base+'/'+id,body:{...input,weekly_periods:9,expected_version:1}});assert.equal(edit.status,409);assert.equal(f.db.prepare('SELECT weekly_periods FROM teacher_workload_extras WHERE id=?').get(id).weekly_periods,6);
 inject=()=>f.db.exec("UPDATE employees SET status='archived' WHERE id=2");
 edit=await call(f,{method:'PUT',url:base+'/'+id,body:{...input,weekly_periods:9,expected_version:2}});assert.equal(edit.status,409);assert.equal(f.db.prepare('SELECT weekly_periods FROM teacher_workload_extras WHERE id=?').get(id).weekly_periods,6);
 const summary=await call(f,{method:'GET',url:'/api/timetable/teacher-workload-summary?school_id=1&academic_year_id=1'});assert.equal(summary.body.data.total_extra_weekly_periods,0);
});

test('schema rejects cross-tenant references, fractional counts and revision/identity changes; inactive history remains restorable',t=>{
 const f=fixture(t),sql='INSERT INTO teacher_workload_extras(school_id,academic_year_id,employee_id,subject_name,weekly_periods) VALUES(?,?,?,?,?)';
 for(const args of [[1,3,2,'x',5],[1,1,5,'x',5],[1,1,2,'x',1.5],[1,1,2,'x',0]])assert.throws(()=>f.db.prepare(sql).run(...args));
 f.db.prepare(sql).run(1,1,2,'x',5);
 assert.throws(()=>f.db.exec('UPDATE teacher_workload_extras SET weekly_periods=7'));
 assert.throws(()=>f.db.exec('UPDATE teacher_workload_extras SET employee_id=1,version=2'));
 f.db.exec("UPDATE employees SET status='archived' WHERE id=2");
 assert.doesNotThrow(()=>f.db.prepare(sql).run(1,1,2,'restored historical subject',5));
});


test('backup restore retains updated and deleted historical extras with original versions and actors',t=>{
 const f=fixture(t),restore=fixture(t);
 f.db.exec(`INSERT INTO teacher_workload_extras(school_id,academic_year_id,employee_id,subject_name,weekly_periods,created_by_user_id,updated_by_user_id) VALUES(1,1,2,'kept',5,1,1),(1,1,2,'deleted',3,1,1);
 UPDATE teacher_workload_extras SET weekly_periods=6,version=2,updated_by_user_id=5 WHERE subject_name='kept';
 UPDATE teacher_workload_extras SET deleted_at=unixepoch(),version=2,updated_by_user_id=5 WHERE subject_name='deleted';
 UPDATE employees SET status='archived' WHERE id=2;`);
 const rows=f.db.prepare('SELECT * FROM teacher_workload_extras ORDER BY id').all();
 restore.db.exec("UPDATE employees SET status='archived' WHERE id=2");
 for(const row of rows){const keys=Object.keys(row);restore.db.prepare(`INSERT INTO teacher_workload_extras(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...keys.map(k=>row[k]));}
 assert.deepEqual(restore.db.prepare('SELECT * FROM teacher_workload_extras ORDER BY id').all(),rows);
 assert.deepEqual(restore.db.prepare('PRAGMA foreign_key_check').all(),[]);
});
