import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';
import { fixture, request, root, snapshot } from './helpers/school-workflow-fixture.mjs';
import { checkStudentAge } from '../src/lib/studentAge.ts';
import { evaluateAdmission } from '../src/lib/admissionRegulations.ts';
import { isAgeExceptionApplicable } from '../src/lib/studentStudyStatus.ts';

const vite=await createServer({root,appType:'custom',server:{middlewareMode:true,hmr:false}});
const {default:app}=await vite.ssrLoadModule('/src/worker.ts');
after(()=>vite.close());
const req=(f,role,method,path,body)=>request(app,f,role,method,path,body);
const path='/api/students/101/study-status?academic_year_id=1';
const evidence=()=>({reference:'TEST exception 1',document_date:'2026-01-01',authority:'TEST issuing authority',reason:'TEST individual exception only',class_id:1});
const body=(extra={})=>({academic_year_id:1,revision:0,study_status:'regular',grades_visible:true,age_exception:null,change_reason:'TEST annual setting',...extra});
const rules=()=>({age_reference_date:'2026-09-01',age_rule:'bounded',min_age_months:120,max_age_months:240,repeat_rule:'not_applicable',max_previous_repeats:null,acceleration:'prohibited',required_documents:[]});
const facts=()=>({birth_date:'2020-01-01',gender:'male',today:'2026-10-02',class_id:1,previous_repeats:0,accelerated:false,documents:[]});
const exception=()=>({...evidence(),birth_date:'2020-01-01',gender:'male',verified_by_user_id:1,verified_at:1780000000});
async function saveException(f){
  f.db.exec("UPDATE students SET birth_date='2020-01-01' WHERE id=101");
  const saved=await req(f,'owner','PUT',path,body({age_exception:evidence(),confirm_age_exception_verified:true}));
  assert.equal(saved.status,200,JSON.stringify(saved));return saved.data;
}
async function regulation(f,process='admission',overrides={}){
  const input={school_id:1,regulation_key:crypto.randomUUID(),academic_year_id:1,class_id:1,process,title:'TEST source',jurisdiction:'TEST',source_reference:'TEST ONLY',source_url:'https://example.test/source',effective_from:'2020-01-01',effective_to:'2099-12-31',rules:rules(),...overrides};
  const created=await req(f,'registrar','POST','/api/regulations',input);assert.equal(created.status,201,JSON.stringify(created));
  assert.equal((await req(f,'owner','POST',`/api/regulations/${input.regulation_key}/approve`,{revision:1,confirm_source_verified:true,reason:'TEST review'})).status,200);return input;
}
async function outgoing(f){
  const input={school_id:1,application_key:crypto.randomUUID(),student_id:101,applicant:null,academic_year_id:1,class_id:1,section_id:2,process:'transfer_out',external_school:'TEST destination',document_reference:'TEST transfer',facts:{previous_repeats:0,accelerated:false,documents:[]}};
  const created=await req(f,'registrar','POST','/api/admissions',input);assert.equal(created.status,201,JSON.stringify(created));return '/api/admissions/'+input.application_key;
}

test('annual settings default without writes; hosted/affiliated and visibility remain independent across years',async t=>{
  const f=fixture(t),before=snapshot(f.db);
  const initial=await req(f,'registrar','GET',path);assert.equal(initial.status,200);assert.equal(initial.data.revision,0);assert.equal(initial.data.study_status,'regular');assert.equal(initial.data.grades_visible,true);assert.deepEqual(snapshot(f.db),before);
  const saved=await req(f,'owner','PUT',path,body({study_status:'hosted',grades_visible:false}));assert.equal(saved.status,200,JSON.stringify(saved));assert.equal(saved.data.revision,1);
  const otherYear=await req(f,'owner','GET','/api/students/101/study-status?academic_year_id=2');assert.equal(otherYear.data.study_status,'regular');assert.equal(otherYear.data.grades_visible,true);
  assert.equal((await req(f,'owner','PUT',path,body({revision:1,study_status:'affiliated',grades_visible:true}))).status,200);
  const after=snapshot(f.db);for(const table of ['students','student_enrollments','grades','result_cards','student_subjects'])assert.deepEqual(after[table],before[table],table);
  const audit=f.db.prepare('SELECT * FROM student_study_status_audit ORDER BY id').all();assert.equal(audit.length,2);assert.equal(JSON.parse(audit[1].before_json).study_status,'hosted');assert.equal(JSON.parse(audit[1].after_json).study_status,'affiliated');
  assert.throws(()=>f.db.exec('DELETE FROM student_study_status_audit'),/immutable/);assert.throws(()=>f.db.exec('DELETE FROM student_study_status'),/immutable/);
});
test('annual reads/writes enforce roles, tenants, school-year scope and strict payloads',async t=>{
  const f=fixture(t),before=snapshot(f.db);
  for(const role of ['teacher','parent','accountant','foreignParent']){
    assert.equal((await req(f,role,'GET',path)).status,403);assert.equal((await req(f,role,'GET','/api/student-study-status?academic_year_id=1')).status,403);
    assert.equal((await req(f,role,'PUT',path,body())).status,403);
  }
  assert.equal((await req(f,'registrar','PUT',path,body())).status,403);
  assert.equal((await req(f,'owner','GET','/api/students/103/study-status?academic_year_id=1')).status,404);
  assert.equal((await req(f,'owner','GET','/api/student-study-status?academic_year_id=3')).status,404);
  assert.equal((await req(f,'admin','GET',path)).status,400);
  assert.equal((await req(f,'owner','PUT',path,body({academic_year_id:2}))).status,400);
  for(const extra of [{grades_visible:0},{study_status:'guest'},{revision:-1},{change_reason:''},{age_exception:{...evidence(),document_date:'2099-01-01'}}])assert.equal((await req(f,'owner','PUT',path,body(extra))).status,400);
  assert.deepEqual(snapshot(f.db),before);
});
test('stale saves, role/identity drift and batch failure cannot leave partial annual settings or audit',async t=>{
  const f=fixture(t);assert.equal((await req(f,'owner','PUT',path,body())).status,200);
  const saved=snapshot(f.db);assert.equal((await req(f,'owner','PUT',path,body({study_status:'hosted'}))).status,409);assert.deepEqual(snapshot(f.db),saved);
  f.d1.beforeWrite=()=>f.db.exec("UPDATE students SET birth_date='2009-01-01' WHERE id=101");
  assert.equal((await req(f,'owner','PUT',path,body({revision:1,study_status:'hosted'}))).status,409);assert.deepEqual(f.db.prepare('SELECT * FROM student_study_status').all(),saved.student_study_status);
  f.d1.failAt=2;const before=snapshot(f.db);assert.equal((await req(f,'owner','PUT',path,body({revision:1,study_status:'hosted'}))).status,503);assert.deepEqual(snapshot(f.db),before);
});
test('a management role revoked immediately before commit cannot change annual settings',async t=>{
  const f=fixture(t);assert.equal((await req(f,'owner','PUT',path,body())).status,200);
  const before=f.db.prepare('SELECT * FROM student_study_status').all();
  f.d1.beforeWrite=()=>f.db.exec('UPDATE users SET role_id=6 WHERE id=1');
  assert.equal((await req(f,'owner','PUT',path,body({revision:1,study_status:'hosted'}))).status,409);
  assert.deepEqual(f.db.prepare('SELECT * FROM student_study_status').all(),before);assert.equal(f.db.prepare('SELECT count(*) n FROM student_study_status_audit').get().n,1);
});
test('documented exception is scoped to persisted birth, gender, class and annual record; explicit reverification renews it',async t=>{
  const f=fixture(t);f.db.exec("UPDATE students SET birth_date='2020-01-01' WHERE id=101");
  assert.equal((await req(f,'owner','PUT',path,body({age_exception:evidence()}))).status,400);
  const first=await saveException(f);assert.equal(first.age_exception.birth_date,'2020-01-01');assert.equal(first.age_exception.gender,'male');assert.equal(first.age_exception.verified_by_user_id,1);
  f.db.exec("UPDATE students SET birth_date='2021-01-01' WHERE id=101");
  const keep=await req(f,'owner','PUT',path,body({revision:1,study_status:'hosted',age_exception:evidence()}));assert.equal(keep.status,200);assert.equal(keep.data.age_exception.birth_date,'2020-01-01');assert.equal(isAgeExceptionApplicable(keep.data.age_exception,{class_id:1,birth_date:'2021-01-01',gender:'male'}),false);
  const renew=await req(f,'owner','PUT',path,body({revision:2,age_exception:evidence(),confirm_age_exception_verified:true}));assert.equal(renew.status,200);assert.equal(renew.data.age_exception.birth_date,'2021-01-01');
  assert.equal((await req(f,'owner','GET','/api/students/101/study-status?academic_year_id=2')).data.age_exception,null);
  assert.equal((await req(f,'owner','PUT',path,body({revision:3,age_exception:{...evidence(),class_id:3},confirm_age_exception_verified:true}))).status,404);
});
test('exceptions never accept missing, impossible or future identity birth dates',async t=>{
  const f=fixture(t);
  for(const date of [null,'2019-02-29','2099-01-01']){
    f.db.prepare('UPDATE students SET birth_date=? WHERE id=101').run(date);const before=snapshot(f.db);
    assert.equal((await req(f,'owner','PUT',path,body({age_exception:evidence(),confirm_age_exception_verified:true}))).status,400);assert.deepEqual(snapshot(f.db),before);
  }
});
test('only numerical age bounds are relaxed; no source, bad DOB, repeats, acceleration or documents stay unresolved',()=>{
  const input={...facts(),age_exception:exception()};assert.equal(checkStudentAge(rules(),input).status,'documented_exception');assert.equal(evaluateAdmission(rules(),input).decision,'eligible');
  const old={...input,birth_date:'1980-01-01',age_exception:{...exception(),birth_date:'1980-01-01'}};assert.equal(evaluateAdmission(rules(),old).decision,'eligible');
  for(const extra of [{class_id:2},{gender:'female'},{birth_date:'2019-01-01'}])assert.equal(evaluateAdmission(rules(),{...input,...extra}).decision,'ineligible');
  assert.equal(evaluateAdmission(null,input).decision,'review');
  for(const birth_date of [null,'2019-02-29','2099-01-01'])assert.equal(evaluateAdmission(rules(),{...input,birth_date,age_exception:{...exception(),birth_date}}).decision,'review');
  assert.equal(evaluateAdmission({...rules(),repeat_rule:'bounded',max_previous_repeats:0},{...input,previous_repeats:1}).decision,'ineligible');
  assert.equal(evaluateAdmission(rules(),{...input,accelerated:true}).decision,'ineligible');
  assert.equal(evaluateAdmission({...rules(),required_documents:['official identity']},input).decision,'review');
  assert.equal(evaluateAdmission({...rules(),age_rule:'review'},input).decision,'review');
  assert.equal(checkStudentAge(rules(),{...input,today:'2025-12-31'}).status,'outside_limits');
});
test('annual roster includes hidden students, uses selected annual placement, and reads never mutate',async t=>{
  const f=fixture(t);assert.equal((await req(f,'owner','PUT',path,body({study_status:'hosted',grades_visible:false}))).status,200);
  f.db.exec('UPDATE students SET class_id=2,section_id=NULL WHERE id=101');const before=snapshot(f.db);
  const list=await req(f,'registrar','GET','/api/student-study-status?academic_year_id=1');assert.equal(list.status,200,JSON.stringify(list));assert.equal(list.data.roster.length,2);
  const row=list.data.roster.find(row=>row.student_id===101);assert.equal(row.study_status,'hosted');assert.equal(row.grades_visible,false);assert.equal(row.class_id,1);assert.equal(row.section_id,2);
  assert.deepEqual(snapshot(f.db),before);assert.equal((await req(f,'owner','GET','/api/student-study-status?academic_year_id=2')).data.roster.length,0);
});
test('documented younger and older students can complete new admission from an unplaced identity',async t=>{
  const f=fixture(t);await regulation(f);
  for(const birth_date of ['2020-01-01','1980-01-01']){
    const identity=await req(f,'owner','POST','/api/students',{school_id:1,student_number:crypto.randomUUID(),full_name:'TEST exceptional age',gender:'male',birth_date,class_id:null,section_id:null});
    assert.equal(identity.status,201,JSON.stringify(identity));const student=identity.data.id;
    assert.equal(f.db.prepare('SELECT count(*) n FROM student_enrollments WHERE student_id=?').get(student).n,0);
    assert.equal((await req(f,'owner','PUT',`/api/students/${student}/study-status?academic_year_id=1`,body({age_exception:evidence(),confirm_age_exception_verified:true}))).status,200);
    const key=crypto.randomUUID(),prefix='/api/admissions/'+key;
    const created=await req(f,'registrar','POST','/api/admissions',{school_id:1,application_key:key,student_id:student,applicant:null,academic_year_id:1,class_id:1,section_id:2,process:'admission',facts:{previous_repeats:0,accelerated:false,documents:[]}});assert.equal(created.status,201,JSON.stringify(created));
    const preview=await req(f,'registrar','GET',prefix+'/preview');assert.equal(preview.data.can_approve,true,JSON.stringify(preview));
    const approved=await req(f,'owner','POST',prefix+'/decision',{revision:1,decision:'approve',reason:'TEST verified exception',preview_digest:preview.data.preview_digest,confirm_evidence_verified:true});assert.equal(approved.status,200,JSON.stringify(approved));
    const executed=await req(f,'registrar','POST',prefix+'/execute',{revision:approved.data.revision,confirm_execute:true});assert.equal(executed.status,200,JSON.stringify(executed));
    assert.equal(f.db.prepare('SELECT count(*) n FROM student_enrollments WHERE student_id=? AND academic_year_id=1').get(student).n,1);
  }
});
test('age review displays approved annual exception and detects identity or placement drift',async t=>{
  const f=fixture(t);await regulation(f,'admission',{rules:{...rules(),age_scope:'continuing'}});await saveException(f);
  const review=()=>req(f,'registrar','GET','/api/student-age-review?academic_year_id=1');
  assert.equal((await review()).data.rows.find(row=>row.student_id===101).age_check.status,'documented_exception');
  const past=await req(f,'registrar','GET','/api/student-age-review?academic_year_id=1&review_date=2025-12-31');
  const pastRow=past.data.rows.find(row=>row.student_id===101);assert.equal(pastRow.age_check.status,'outside_limits');assert.match(pastRow.context_notes.join(' '),/بعد تاريخ المراجعة/);
  f.db.exec("UPDATE students SET gender='female' WHERE id=101");
  const drifted=(await review()).data.rows.find(row=>row.student_id===101);assert.equal(drifted.age_check.status,'outside_limits');assert.match(drifted.context_notes.join(' '),/لا يطابق/);
});
test('admission preview/approve/execute honors annual exception and invalidates approval after revocation',async t=>{
  const f=fixture(t);await regulation(f,'transfer_out');const saved=await saveException(f),out=await outgoing(f);
  const preview=await req(f,'registrar','GET',out+'/preview');assert.equal(preview.data.can_approve,true,JSON.stringify(preview));
  const approved=await req(f,'owner','POST',out+'/decision',{revision:1,decision:'approve',reason:'TEST evidence reviewed',preview_digest:preview.data.preview_digest,confirm_evidence_verified:true});assert.equal(approved.status,200);
  assert.equal((await req(f,'owner','PUT',path,body({revision:saved.revision}))).status,200);const before=snapshot(f.db);
  assert.equal((await req(f,'registrar','POST',out+'/execute',{revision:approved.data.revision,confirm_execute:true})).status,409);assert.deepEqual(snapshot(f.db),before);
});
test('transaction guard catches an exception removal racing admission approval',async t=>{
  const f=fixture(t);await regulation(f,'transfer_out');await saveException(f);const out=await outgoing(f),preview=await req(f,'registrar','GET',out+'/preview');
  f.d1.beforeWrite=()=>f.db.exec("UPDATE student_study_status SET age_exception_json=NULL,revision=revision+1,change_reason='TEST race' WHERE student_id=101");
  assert.equal((await req(f,'owner','POST',out+'/decision',{revision:1,decision:'approve',reason:'TEST',preview_digest:preview.data.preview_digest,confirm_evidence_verified:true})).status,409);
  assert.equal(f.db.prepare('SELECT status FROM admission_applications').get().status,'submitted');
});
test('a concurrent hide aborts official graduation without changing the published result or enrollment',async t=>{
  const f=fixture(t),source=f.db.prepare('SELECT id FROM student_enrollments WHERE student_id=101 AND academic_year_id=1').get().id;
  const card={schema_version:5,card_mode:'complete',exam_round:'TEST',academic_policy:{id:501,version:1,status:'approved',policy_kind:'terminal',source_reference:'TEST'},summary:{academic_status_code:'pass',academic_status:'ناجح',overall_result_status:'ناجح'},subjects:[]};
  f.db.prepare(`INSERT INTO result_cards(id,school_id,student_id,class_id,section_id,academic_year_id,card_number,verification_token,verification_hash,student_name_snapshot,class_name_snapshot,section_name_snapshot,school_name_snapshot,academic_year_snapshot,general_exemption_status,overall_result_status,card_data_json,generated_by_user_id,generated_at,status,publication_status,publication_revision,published_at,published_by_user_id)
    VALUES(100,1,101,1,2,1,'TEST-100','test100','hash','Student A','Class A','B','A','2026-2027',0,'ناجح',?,1,1789297000,'active','published',1,1789297100,1)`).run(JSON.stringify(card));
  assert.equal((await req(f,'owner','PUT',path,body())).status,200);
  const before=snapshot(f.db),input={school_id:1,source_enrollment_id:source,action:'graduated',official_result_card_id:100,official_result_publication_revision:1};
  assert.equal((await req(f,'owner','POST','/api/student-enrollments/promotion/preview',input)).status,200);
  f.d1.beforeWrite=()=>f.db.exec("UPDATE student_study_status SET grades_visible=0,revision=revision+1,change_reason='TEST concurrent hide' WHERE student_id=101 AND academic_year_id=1");
  const result=await req(f,'owner','POST','/api/student-enrollments/promotion',input);assert.equal(result.status,409,JSON.stringify(result));assert.equal(result.code,'official_result_stale');
  const after=snapshot(f.db);for(const table of ['student_enrollments','student_promotion_result_decisions','result_cards','grades'])assert.deepEqual(after[table],before[table],table);
});
