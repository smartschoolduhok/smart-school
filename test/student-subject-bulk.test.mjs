import assert from 'node:assert/strict';
import test, {after} from 'node:test';
import {createServer} from 'vite';
import {fixture, request, root} from './helpers/school-workflow-fixture.mjs';

const vite = await createServer({root,appType:'custom',server:{middlewareMode:true,hmr:false}});
const {default:app} = await vite.ssrLoadModule('/src/worker.ts');
after(()=>vite.close());
const api=(f,method,path,body)=>request(app,f,'owner',method,path,body);
const assignments=f=>f.db.prepare('SELECT school_id,student_id,subject_id,class_id,section_id,is_active FROM student_subjects ORDER BY id').all();
const grades=f=>f.db.prepare('SELECT school_id,student_subject_id FROM grades ORDER BY id').all();
const inserts=(f,table)=>f.d1.executions.filter(e=>new RegExp(`INSERT INTO ${table}\\b`).test(e.sql)).length;

// 40 extra students and 15 extra subjects in class 1 / section B (id 2).
function largeClass(f) {
  const student=f.db.prepare("INSERT INTO students(id,school_id,student_number,full_name,gender,class_id,section_id,status) VALUES(?,1,?,?,'male',1,2,'active')");
  const enrol=f.db.prepare("INSERT INTO student_enrollments(school_id,student_id,academic_year_id,class_id,section_id,status,promotion_status,created_by_user_id) VALUES(1,?,1,1,2,'active','pending',1)");
  for (let id=200;id<240;id++) {student.run(id,'S'+id,'Bulk '+id);enrol.run(id);}
  const subject=f.db.prepare("INSERT INTO subjects(id,school_id,class_id,section_id,name,status,order_index) VALUES(?,1,1,NULL,?,'active',?)");
  const ids=[];for (let id=10;id<25;id++) {subject.run(id,'Bulk subject '+id,id);ids.push(id);}
  return ids;
}

test('class assignment inserts every missing pair with one statement per subject and skips existing ones',async t=>{
  const f=fixture(t);f.d1.executions=[];
  const r=await api(f,'POST','/api/student-subjects/assign-class',{school_id:1,class_id:1,subject_ids:[1,2]});
  assert.equal(r.status,200,JSON.stringify(r));
  assert.deepEqual(r.data,{inserted_count:2,skipped_count:2});
  assert.equal(inserts(f,'student_subjects'),2);
  assert.deepEqual(f.d1.batchSizes.at(-1),2);
  const rows=assignments(f).filter(row=>row.school_id===1);
  for (const [student,subject] of [[101,1],[101,2],[102,1],[102,2]]) assert.equal(rows.filter(row=>row.student_id===student&&row.subject_id===subject&&row.is_active===1).length,1);
  assert.ok(rows.filter(row=>row.subject_id===2&&row.student_id===101).every(row=>row.class_id===1&&row.section_id===2));
  const again=await api(f,'POST','/api/student-subjects/assign-class',{school_id:1,class_id:1,subject_ids:[1,2]});
  assert.deepEqual(again.data,{inserted_count:0,skipped_count:4});
});

test('a 42-student class with 17 subjects fits well inside the D1 per-request query budget',async t=>{
  const f=fixture(t),subjects=[1,2,...largeClass(f)];
  f.d1.resetQueryBudget(50);
  const r=await api(f,'POST','/api/student-subjects/assign-section',{school_id:1,section_id:2,subject_ids:subjects});
  assert.equal(r.status,200,JSON.stringify(r));
  assert.equal(r.data.inserted_count+r.data.skipped_count,42*17);
  assert.equal(r.data.inserted_count,42*17-2);
  assert.ok(f.d1.executions.length<50,`used ${f.d1.executions.length} queries`);
});

test('a failure in the middle of a bulk assignment rolls back every row',async t=>{
  const f=fixture(t),subjects=largeClass(f),before=assignments(f);
  f.d1.failAt=3;
  const r=await api(f,'POST','/api/student-subjects/assign-class',{school_id:1,class_id:1,subject_ids:subjects});
  assert.equal(r.status,500);
  assert.equal(r.detail,undefined);
  assert.deepEqual(assignments(f),before);
});

test('chosen-student assignment rejects a foreign student before writing anything',async t=>{
  const f=fixture(t),before=assignments(f);
  const r=await api(f,'POST','/api/student-subjects/assign-students',{school_id:1,student_ids:[101,102,103],subject_ids:[2]});
  assert.equal(r.status,403);
  assert.deepEqual(assignments(f),before);
  const foreignSubject=await api(f,'POST','/api/student-subjects/assign-students',{school_id:1,student_ids:[101],subject_ids:[2,5]});
  assert.equal(foreignSubject.status,403);
  assert.deepEqual(assignments(f),before);
});

test('chosen-student assignment uses effective placement and skips subjects for another section',async t=>{
  const f=fixture(t);
  const r=await api(f,'POST','/api/student-subjects/assign-students',{school_id:1,student_ids:[101,102,101],subject_ids:[2,3]});
  assert.equal(r.status,200,JSON.stringify(r));
  assert.deepEqual(r.data,{inserted_count:1,skipped_count:3});
  const added=assignments(f).filter(row=>row.student_id===101&&row.subject_id===2);
  assert.deepEqual(added.map(row=>[row.class_id,row.section_id]),[[1,2]]);
  assert.equal(assignments(f).filter(row=>row.subject_id===3).length,0,'section A subject is never given to section B students');
});

test('section grade initialization is one batch, idempotent and all-or-nothing',async t=>{
  const f=fixture(t),subjects=largeClass(f);
  assert.equal((await api(f,'POST','/api/student-subjects/assign-section',{school_id:1,section_id:2,subject_ids:subjects})).status,200);
  f.db.exec('DELETE FROM grades');
  f.d1.failAt=2;
  const failed=await api(f,'POST','/api/grades/initialize-section',{school_id:1,section_id:2,subject_ids:subjects});
  assert.equal(failed.status,500);
  assert.deepEqual(grades(f),[]);
  f.d1.failAt=null;f.d1.executions=[];
  const ok=await api(f,'POST','/api/grades/initialize-section',{school_id:1,section_id:2,subject_ids:subjects});
  assert.equal(ok.status,200,JSON.stringify(ok));
  assert.equal(ok.data.created,42*15);
  assert.equal(inserts(f,'grades'),15);
  const again=await api(f,'POST','/api/grades/initialize-section',{school_id:1,section_id:2,subject_ids:subjects});
  assert.deepEqual(again.data,{created:0,skipped:42*15});
});
