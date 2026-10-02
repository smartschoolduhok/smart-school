import assert from 'node:assert/strict';
import test, {after} from 'node:test';
import {createServer} from 'vite';
import {fixture, request, root, secret} from './helpers/school-workflow-fixture.mjs';
import {studentGradesAreVisible} from '../src/lib/studentGradeVisibility.ts';

const vite = await createServer({root,appType:'custom',server:{middlewareMode:true,hmr:false}});
const {default:app} = await vite.ssrLoadModule('/src/worker.ts');
after(()=>vite.close());
const api=(f,role,method,path,body)=>request(app,f,role,method,path,body);
function setup(t) {
  const f=fixture(t);
  f.db.exec(`INSERT INTO grades(school_id,student_subject_id,first_month,second_month,third_month,fourth_month,mid_year_exam,final_exam,annual_effort,final_grade,effective_grade,notes)
    SELECT school_id,id,81,82,83,84,85,86,83,85,85,'STORED SECRET GRADE NOTE' FROM student_subjects;`);
  return f;
}
function hide(f, student=101, year=1, school=1) {
  f.db.prepare(`INSERT INTO student_study_status(school_id,student_id,academic_year_id,grades_visible,updated_by_user_id,change_reason) VALUES(?,?,?,0,?,'Visibility test')`).run(school,student,year,school===1?1:2);
}
function show(f,student=101,year=1) {f.db.prepare("UPDATE student_study_status SET grades_visible=1,revision=revision+1,change_reason='Show again' WHERE student_id=? AND academic_year_id=?").run(student,year);}
const gradeRows=f=>f.db.prepare('SELECT * FROM grades ORDER BY id').all();
const snapshot={schema_version:5,card_mode:'complete',academic_policy:{id:91,version:1,status:'approved',policy_kind:'non_terminal',source_reference:'Test official policy'},summary:{academic_status_code:'pass',academic_status:'ناجح',overall_result_status:'ناجح'},subjects:[{subject_id:1,subject_name:'Private Mathematics',effective_grade:87}],visible_columns:[]};
async function card(f,year=1,token='visibility-card') {
  const r=f.db.prepare(`INSERT INTO result_cards(school_id,student_id,class_id,section_id,academic_year_id,card_number,verification_token,verification_hash,student_name_snapshot,card_data_json,generated_by_user_id,status,publication_status,publication_revision) VALUES(1,101,1,2,?,?,?,?,?,?,1,'active','draft',0)`).run(year,token,token,'hash','Student A',JSON.stringify(snapshot));
  const id=Number(r.lastInsertRowid);
  const published=await api(f,'owner','PUT',`/api/result-cards/${id}/publish`,{school_id:1,expected_revision:0});
  assert.equal(published.status,200,JSON.stringify(published));return id;
}
async function verify(f,token) {const r=await app.request(`http://localhost/api/verify/result-card/${token}`,{}, {DB:f.d1,JWT_SECRET:secret,APP_ENV:'test'});return {status:r.status,...await r.json()};}

test('hidden annual grades disappear from reads/export but student stays in roster and original values return',async t=>{
  const f=setup(t),before=gradeRows(f); hide(f);
  const own=await api(f,'owner','GET','/api/students/101/grades');
  assert.equal(own.status,200);assert.equal(own.data.grades_visible,false);assert.deepEqual(own.data.grades,[]);assert.equal(own.data.student_name,'Student A');
  const list=await api(f,'owner','GET','/api/grades?school_id=1');assert.equal(list.status,200);assert.ok(list.data.every(row=>row.student_id!==101));
  assert.ok((await api(f,'owner','GET','/api/students?school_id=1')).data.some(row=>row.id===101));
  const exported=await api(f,'owner','GET','/api/import-export/grades/export?school_id=1');assert.equal(exported.status,200);assert.ok(exported.data.rows.every(row=>row.student_number!=='S101'));
  assert.deepEqual(gradeRows(f),before);
  show(f);const again=await api(f,'owner','GET','/api/students/101/grades');assert.equal(again.data.grades_visible,true);assert.equal(again.data.grades[0].first_month,81);assert.deepEqual(gradeRows(f),before);
});

test('visibility uses explicit saved years and current live year without crossing schools or requiring enrollment',async t=>{
  const f=setup(t);hide(f,101,2);
  assert.equal(await studentGradesAreVisible(f.d1,1,101),true);
  assert.equal(await studentGradesAreVisible(f.d1,1,101,2),false);
  const grade=f.db.prepare('SELECT g.id FROM grades g JOIN student_subjects ss ON ss.id=g.student_subject_id WHERE ss.student_id=101').get();
  assert.equal((await api(f,'owner','GET',`/api/grades/${grade.id}/history`)).status,403,'yearless audit values protect hidden historic years');
  assert.equal(await studentGradesAreVisible(f.d1,1,102,2),true);
  assert.equal(await studentGradesAreVisible(f.d1,2,103,3),true);
  hide(f);f.db.exec("UPDATE student_enrollments SET status='cancelled' WHERE student_id=101");
  assert.equal(await studentGradesAreVisible(f.d1,1,101),false);
});

test('hidden grades reject direct, bulk, history, initialization and card generation without modifying data',async t=>{
  const f=setup(t);hide(f);const before=gradeRows(f),grade=before.find(r=>r.school_id===1);
  for (const [method,path,body] of [
    ['PUT',`/api/grades/${grade.id}`,{school_id:1,first_month:99}],
    ['POST','/api/grades/bulk-entry',{school_id:1,entries:[{grade_id:grade.id,first_month:99}]}],
    ['GET',`/api/grades/${grade.id}/history`],
    ['GET','/api/analytics/student-summary/101'],
    ['GET','/api/academic-outcomes/students/101?academic_year_id=1'],
    ['POST','/api/grades/initialize-student/101',{school_id:1}],
    ['POST','/api/result-cards/preview-student/101',{school_id:1}],
    ['POST','/api/result-cards/generate-student/101',{school_id:1}],
  ]) {const r=await api(f,'owner',method,path,body);assert.equal(r.status,403,JSON.stringify(r));assert.equal(r.code,'student_grades_hidden');}
  assert.deepEqual(gradeRows(f),before);
});

test('section initialization and generation skip hidden students without manufacturing zero grades',async t=>{
  const f=setup(t);hide(f);f.db.exec('DELETE FROM grades');
  const initialized=await api(f,'owner','POST','/api/grades/initialize-section',{school_id:1,section_id:2,subject_ids:[1,2]});
  assert.equal(initialized.status,200,JSON.stringify(initialized));
  assert.equal(f.db.prepare('SELECT count(*) n FROM grades g JOIN student_subjects ss ON ss.id=g.student_subject_id WHERE ss.student_id=101').get().n,0);
  const generated=await api(f,'owner','POST','/api/result-cards/generate-section',{school_id:1,class_id:1,section_id:2});
  assert.equal(generated.status,200,JSON.stringify(generated));assert.ok(generated.data.skipped.some(row=>row.student_id===101&&row.code==='student_grades_hidden'));
});

test('published and draft snapshots hide from saved, parent, public and analytics reads but another year remains visible',async t=>{
  const f=setup(t),current=await card(f),old=await card(f,2,'past-visibility-card');
  const before=f.db.prepare('SELECT * FROM result_cards ORDER BY id').all();hide(f);
  assert.equal((await api(f,'owner','GET',`/api/result-cards/${current}?school_id=1`)).status,403);
  assert.equal((await api(f,'owner','GET',`/api/result-cards/${old}?school_id=1`)).status,200);
  const cards=await api(f,'owner','GET','/api/result-cards?school_id=1');assert.deepEqual(cards.data.map(r=>r.id),[old]);
  const parent=await api(f,'parent','GET','/api/parent/students/101/result-cards');assert.deepEqual(parent.data.cards.map(r=>r.id),[old]);
  assert.equal((await verify(f,'visibility-card')).status,404);assert.equal((await verify(f,'past-visibility-card')).valid,true);
  const analytics=await api(f,'owner','GET','/api/academic-outcomes/summary?school_id=1&academic_year_id=1');assert.equal(analytics.status,200,JSON.stringify(analytics));assert.doesNotMatch(JSON.stringify(analytics),/Private Mathematics/);
  assert.deepEqual(f.db.prepare('SELECT * FROM result_cards ORDER BY id').all(),before);
  show(f);assert.equal((await verify(f,'visibility-card')).valid,true);
});

test('progress reports and idempotent publish retries honor visibility while retaining immutable snapshots',async t=>{
  const f=setup(t),input={school_id:1,student_id:101,period:'first_month'};
  const preview=await api(f,'teacher','POST','/api/grade-progress/preview',input);assert.equal(preview.status,200);
  const body={...input,report_key:crypto.randomUUID(),preview_digest:preview.data.preview_digest,confirm_delivered:true};
  const published=await api(f,'teacher','POST','/api/grade-progress/publish',body);assert.equal(published.status,201);
  const before=f.db.prepare('SELECT * FROM grade_progress_reports').all();hide(f);
  for(const role of ['owner','teacher','parent']) assert.deepEqual((await api(f,role,'GET','/api/grade-progress')).data.reports,[]);
  assert.equal((await api(f,'parent','GET','/api/notifications')).data.notifications.length,0);
  assert.equal((await api(f,'teacher','POST','/api/grade-progress/publish',body)).status,404);
  assert.equal((await api(f,'teacher','POST','/api/grade-progress/preview',input)).status,404);
  assert.deepEqual(f.db.prepare('SELECT * FROM grade_progress_reports').all(),before);
  show(f);assert.equal((await api(f,'parent','GET','/api/grade-progress')).data.reports[0].snapshot.subjects[0].score,81);
});

test('a concurrent hide between grade read and save rolls back grade changes and audit rows',async t=>{
  const f=setup(t),before=gradeRows(f),grade=before.find(r=>r.school_id===1);
  f.d1.beforeWrite=()=>hide(f);
  const r=await api(f,'owner','PUT',`/api/grades/${grade.id}`,{school_id:1,first_month:99});
  assert.equal(r.status,409,JSON.stringify(r));assert.deepEqual(gradeRows(f),before);assert.equal(f.db.prepare('SELECT count(*) n FROM grade_change_logs').get().n,0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM workflow_write_guards').get().n,0);
});

test('grade imports reject hidden rows and historic import summaries redact hidden student values',async t=>{
  const f=setup(t);hide(f);
  const body={school_id:1,grade_sources:[{source_id:'grades',sheet_name:'grades',rows:[{number:'S101',grade:95}],mapping:{student_number:'number',first_month:'grade'},subject_id:1,class_id:1,section_id:2}]};
  const preview=await api(f,'owner','POST','/api/import-export/grades/preview',body);
  assert.equal(preview.status,200,JSON.stringify(preview));assert.equal(preview.data.valid.length,0);assert.match(JSON.stringify(preview.data.errors),/مخفية/);
  const summary=JSON.stringify({valid:[{student_id:101,values:{first_month:97},existing_values:{first_month:81}},{student_id:102,values:{first_month:67}}],sources:[{source_id:'private',zero_patterns:[{field:'first_month',zero_count:1,numeric_count:1,zero_percentage:100}],discovered_markers:[{value:'0',count:1}]}]});
  const job=f.db.prepare("INSERT INTO import_jobs(school_id,import_type,file_name,mode,status,total_rows,valid_rows,error_rows,imported_rows,skipped_rows,updated_rows,summary_json,created_by_user_id) VALUES(1,'grades','test.xlsx','update_existing','completed',2,2,0,0,0,2,?,1)").run(summary);
  const saved=f.db.prepare('SELECT summary_json FROM import_jobs WHERE id=?').get(Number(job.lastInsertRowid)).summary_json;
  const fetched=await api(f,'owner','GET',`/api/import-export/jobs/${job.lastInsertRowid}?school_id=1`);assert.equal(fetched.status,200);assert.deepEqual(JSON.parse(fetched.data.summary_json).valid.map(r=>r.student_id),[102]);
  assert.doesNotMatch(fetched.data.summary_json,/zero_patterns|zero_percentage|discovered_markers/);
  assert.equal(f.db.prepare('SELECT summary_json FROM import_jobs WHERE id=?').get(Number(job.lastInsertRowid)).summary_json,saved);
  show(f);hide(f,101,2);
  const legacy=await api(f,'owner','GET',`/api/import-export/jobs/${job.lastInsertRowid}?school_id=1`);assert.deepEqual(JSON.parse(legacy.data.summary_json).valid.map(r=>r.student_id),[102]);
  f.db.prepare('UPDATE import_jobs SET summary_json=? WHERE id=?').run(JSON.stringify({...JSON.parse(summary),visibility_scope_version:1,academic_year_id:1}),Number(job.lastInsertRowid));
  const scoped=await api(f,'owner','GET',`/api/import-export/jobs/${job.lastInsertRowid}?school_id=1`);assert.deepEqual(JSON.parse(scoped.data.summary_json).valid.map(r=>r.student_id),[101,102]);
});

test('legacy cards without a year cannot reveal a hidden historical year',async t=>{
  const f=setup(t);await card(f,null,'legacy-card');hide(f,101,2);
  assert.equal((await verify(f,'legacy-card')).status,404);
  assert.equal((await api(f,'owner','GET','/api/result-cards?school_id=1')).data.length,0);
});

test('grade maximum validation retains integrity without exposing the hidden maximum or count',async t=>{
  const f=setup(t);hide(f);
  const response=await api(f,'owner','PUT','/api/grade-settings',{school_id:1,max_grade:70,passing_grade:35,exemption_grade:65,general_exemption_average_grade:60,general_exemption_min_subject_grade:55});
  assert.equal(response.status,400,JSON.stringify(response));assert.equal(response.meta,undefined);
  assert.match(response.error,/درجات محفوظة/);
});

test('a different year cannot reveal yearless live grades through policy outcomes',async t=>{
  const f=setup(t);
  f.db.exec("INSERT INTO student_enrollments(school_id,student_id,academic_year_id,class_id,section_id,status,promotion_status,created_by_user_id) VALUES(1,101,2,1,2,'active','pending',1)");
  hide(f);
  assert.equal((await api(f,'owner','GET','/api/academic-outcomes/students/101?academic_year_id=2')).status,403);
  const summary=await api(f,'owner','GET','/api/academic-outcomes/summary?school_id=1&academic_year_id=2');assert.equal(summary.status,200);
  assert.equal(summary.data.live.students.length,0);
});
