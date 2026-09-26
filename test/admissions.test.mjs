import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import {createServer} from 'vite';
import {fixture,request,root,snapshot} from './helpers/school-workflow-fixture.mjs';
import {ageInMonths,evaluateAdmission,parseAdmissionRules} from '../src/lib/admissionRegulations.ts';
const vite=await createServer({root,appType:'custom',server:{middlewareMode:true,hmr:false}}),{default:app}=await vite.ssrLoadModule('/src/worker.ts');after(()=>vite.close());
const req=(f,role,method,path,body)=>request(app,f,role,method,path,body);
const rules=()=>({age_reference_date:'2026-09-01',age_rule:'not_applicable',min_age_months:null,max_age_months:null,repeat_rule:'not_applicable',max_previous_repeats:null,acceleration:'prohibited',required_documents:['هوية الطالب']});
const facts=()=>({previous_repeats:0,accelerated:false,documents:['هوية الطالب']});
const policy=(process='admission')=>({school_id:1,regulation_key:crypto.randomUUID(),academic_year_id:1,class_id:1,process,title:'TEST POLICY — not statutory advice',jurisdiction:'TEST ONLY',source_reference:'TEST 1',source_url:'https://example.test/policy',effective_from:'2020-01-01',effective_to:'2099-12-31',rules:rules()});
async function regulation(f,process='admission',approve=true,override={}){const r=await req(f,'registrar','POST','/api/regulations',{...policy(process),...override});assert.equal(r.status,201,JSON.stringify(r));if(!approve)return r.data;const a=await req(f,'owner','POST',`/api/regulations/${r.data.regulation_key}/approve`,{revision:1,confirm_source_verified:true,reason:'TEST source reviewed'});assert.equal(a.status,200,JSON.stringify(a));return a.data;}
function applicationInput(extra={}){return {school_id:1,application_key:crypto.randomUUID(),student_id:null,applicant:{full_name:'Test Candidate',student_number:'NEW-'+crypto.randomUUID().slice(0,8),gender:'male',birth_date:'2020-01-01'},academic_year_id:1,class_id:1,section_id:2,process:'admission',facts:facts(),...extra};}
async function create(f,extra={}){const b=applicationInput(extra),r=await req(f,'registrar','POST','/api/admissions',b);assert.equal(r.status,201,JSON.stringify(r));return {b,a:r.data,path:`/api/admissions/${r.data.application_key}`};}
async function inspect(f,c){const p=await req(f,'registrar','GET',c.path+'/preview');assert.equal(p.status,200,JSON.stringify(p));return p.data;}
async function approve(f,c){const p=await inspect(f,c);assert.equal(p.can_approve,true,JSON.stringify(p));const r=await req(f,'owner','POST',c.path+'/decision',{revision:c.a.revision,decision:'approve',reason:'TEST evidence reviewed',preview_digest:p.preview_digest,confirm_evidence_verified:true});assert.equal(r.status,200,JSON.stringify(r));c.a=r.data;return p;}

test('age boundaries, leap days, repeats, acceleration and absent documents fail closed',()=>{
 assert.equal(ageInMonths('2020-09-01','2026-09-01'),72);assert.equal(ageInMonths('2020-09-02','2026-09-01'),71);assert.equal(ageInMonths('2020-02-29','2026-02-28'),71);
 assert.throws(()=>parseAdmissionRules({...rules(),age_reference_date:'2026-02-30'}));
 const r=parseAdmissionRules({...rules(),age_rule:'bounded',min_age_months:72,max_age_months:84,repeat_rule:'bounded',max_previous_repeats:1});
 const f={birth_date:'2020-09-01',...facts()};assert.equal(evaluateAdmission(r,f).decision,'eligible');
 assert.equal(evaluateAdmission(r,{...f,birth_date:'2020-09-02'}).decision,'ineligible');
 assert.equal(evaluateAdmission(r,{...f,previous_repeats:2}).decision,'ineligible');assert.equal(evaluateAdmission(r,{...f,accelerated:true}).decision,'ineligible');
 assert.equal(evaluateAdmission(r,{...f,birth_date:null}).decision,'review');assert.equal(evaluateAdmission(r,{...f,documents:[]}).decision,'review');assert.equal(evaluateAdmission(null,f).decision,'review');
});
test('regulations require tenant-valid scope, source attestation and management approval',async t=>{
 const f=fixture(t),r=await regulation(f,'admission',false);
 assert.equal((await req(f,'teacher','GET','/api/regulations')).status,403);assert.equal((await req(f,'parent','GET','/api/regulations')).status,403);
 assert.equal((await req(f,'owner','POST','/api/regulations',{...policy(),class_id:3})).status,409);
 const path=`/api/regulations/${r.regulation_key}/approve`;
 assert.equal((await req(f,'registrar','POST',path,{revision:1,confirm_source_verified:true,reason:'x'})).status,403);
 assert.equal((await req(f,'owner','POST',path,{revision:1,reason:'x'})).status,400);
 assert.equal((await req(f,'owner','POST',path,{revision:1,confirm_source_verified:true,reason:'verified'})).status,200);
 assert.throws(()=>f.db.exec("UPDATE admission_regulations SET rules_json='{}'"),/immutable/);assert.throws(()=>f.db.exec('DELETE FROM admission_regulation_audit'),/immutable/);
});
test('new approved regulation atomically retires its predecessor and keeps both versions',async t=>{
 const f=fixture(t),a=await regulation(f),b=await regulation(f);assert.equal(a.version,1);assert.equal(b.version,2);
 assert.deepEqual(f.db.prepare('SELECT status FROM admission_regulations ORDER BY version').all().map(r=>r.status),['retired','approved']);
 const before=snapshot(f.db),draft=await regulation(f,'admission',false);f.d1.failAt=2;
 const r=await req(f,'owner','POST',`/api/regulations/${draft.regulation_key}/approve`,{revision:1,confirm_source_verified:true,reason:'TEST failure'});assert.equal(r.status,503);
 assert.equal(f.db.prepare("SELECT version FROM admission_regulations WHERE status='approved'").get().version,2);
});
test('absence of a current source or missing evidence prevents approval and registration',async t=>{
 const f=fixture(t),c=await create(f),p=await inspect(f,c);assert.equal(p.eligibility.decision,'review');assert.equal(p.can_approve,false);
 assert.equal((await req(f,'owner','POST',c.path+'/decision',{revision:1,decision:'approve',reason:'test',preview_digest:p.preview_digest,confirm_evidence_verified:true})).status,409);
 assert.equal(f.db.prepare("SELECT count(*) n FROM students WHERE student_number=?").get(c.b.applicant.student_number).n,0);
 await regulation(f);const missing=await create(f,{facts:{...facts(),documents:[]}});assert.equal((await inspect(f,missing)).can_approve,false);
});
test('new admission executes once with a permanent identity/enrollment and immutable history',async t=>{
 const f=fixture(t);
 assert.equal((await req(f,'registrar','POST','/api/regulations',{...policy(),source_url:'not a valid url'})).status,400);await regulation(f);const c=await create(f),before=snapshot(f.db);await approve(f,c);
 const r=await req(f,'registrar','POST',c.path+'/execute',{revision:c.a.revision,confirm_execute:true});assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.data.status,'executed');assert.ok(r.data.student_id);
 assert.equal(f.db.prepare('SELECT count(*) n FROM student_enrollments WHERE student_id=?').get(r.data.student_id).n,1);
 const complete=snapshot(f.db);assert.equal((await req(f,'registrar','POST','/api/admissions',c.b)).status,200);assert.deepEqual(snapshot(f.db),complete);assert.equal((await req(f,'registrar','POST',c.path+'/execute',{revision:c.a.revision,confirm_execute:true})).status,200);assert.deepEqual(snapshot(f.db),complete);
 for(const table of ['grades','result_cards','treasury_transactions','fee_payments'])assert.deepEqual(complete[table],before[table],table);
 assert.throws(()=>f.db.exec('DELETE FROM admission_application_audit'),/immutable/);assert.throws(()=>f.db.exec("UPDATE admission_applications SET facts_json='{}',revision=revision+1,action_reason='x'"),/history/);assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});
test('outgoing transfer preserves grades and finance while closing enrollment and deactivating assignments',async t=>{
 const f=fixture(t);f.db.exec('INSERT INTO grades(school_id,student_subject_id,first_month) SELECT school_id,id,85 FROM student_subjects');
 await regulation(f,'transfer_out');const c=await create(f,{student_id:101,applicant:null,process:'transfer_out',external_school:'TEST external school',document_reference:'TEST transfer document'});await approve(f,c);const before=snapshot(f.db);
 const r=await req(f,'registrar','POST',c.path+'/execute',{revision:c.a.revision,confirm_execute:true});assert.equal(r.status,200,JSON.stringify(r));
 assert.equal(f.db.prepare('SELECT status FROM student_enrollments WHERE student_id=101').get().status,'transferred');assert.equal(f.db.prepare('SELECT is_active FROM student_subjects WHERE student_id=101').get().is_active,0);
 assert.deepEqual(snapshot(f.db).grades,before.grades);assert.equal(f.db.prepare('SELECT school_id FROM students WHERE id=101').get().school_id,1);
 const foreignBefore=before.students.find(s=>s.id===103);assert.deepEqual(snapshot(f.db).students.find(s=>s.id===103),foreignBefore);
});
test('incoming transfer requires a document and records external origin without cross-school identity moves',async t=>{
 const f=fixture(t);await regulation(f,'transfer_in');
 assert.equal((await req(f,'registrar','POST','/api/admissions',applicationInput({process:'transfer_in'}))).status,400);
 const c=await create(f,{process:'transfer_in',external_school:'TEST origin',document_reference:'TEST incoming'});await approve(f,c);
 assert.equal((await req(f,'registrar','POST',c.path+'/execute',{revision:c.a.revision,confirm_execute:true})).status,200);
 assert.equal((await req(f,'registrar','POST','/api/admissions',applicationInput({student_id:103,applicant:null}))).status,409);
});
test('capacity and source drift after approval require review before execution',async t=>{
 const f=fixture(t);await regulation(f);const c=await create(f);await approve(f,c);f.db.exec('UPDATE sections SET capacity=1 WHERE id=2');const before=snapshot(f.db);
 const r=await req(f,'registrar','POST',c.path+'/execute',{revision:c.a.revision,confirm_execute:true});assert.equal(r.status,409);assert.deepEqual(snapshot(f.db),before);
 const reopen=await req(f,'owner','POST',c.path+'/decision',{revision:c.a.revision,decision:'reopen',reason:'راجع السعة'});assert.equal(reopen.status,200);assert.equal(reopen.data.status,'submitted');
});
test('execution rechecks eligibility inside transaction and rolls back a mid-batch failure',async t=>{
 const f=fixture(t);await regulation(f);const c=await create(f);await approve(f,c);f.d1.beforeWrite=()=>f.db.exec('UPDATE sections SET capacity=1 WHERE id=2');
 assert.equal((await req(f,'registrar','POST',c.path+'/execute',{revision:c.a.revision,confirm_execute:true})).status,409);
 assert.equal(f.db.prepare('SELECT count(*) n FROM students WHERE student_number=?').get(c.b.applicant.student_number).n,0);
 f.db.exec('UPDATE sections SET capacity=30 WHERE id=2');const before=snapshot(f.db);f.d1.failAt=3;
 assert.equal((await req(f,'registrar','POST',c.path+'/execute',{revision:c.a.revision,confirm_execute:true})).status,503);assert.deepEqual(snapshot(f.db),before);
});
test('facts can be corrected before approval, and rejection/cancellation preserve the request',async t=>{
 const f=fixture(t);await regulation(f);const c=await create(f,{facts:{...facts(),documents:[]}});
 const update=await req(f,'registrar','PUT',c.path+'/facts',{revision:1,facts:facts(),reason:'استكمال المستندات'});assert.equal(update.status,200);c.a=update.data;
 assert.equal((await inspect(f,c)).can_approve,true);
 assert.equal((await req(f,'owner','POST',c.path+'/decision',{revision:1,decision:'reject',reason:'stale'})).status,409);
 assert.equal((await req(f,'owner','POST',c.path+'/decision',{revision:c.a.revision,decision:'reject',reason:'رفض موثق'})).status,200);
 assert.equal(f.db.prepare('SELECT count(*) n FROM admission_applications').get().n,1);assert.equal(f.db.prepare('SELECT count(*) n FROM admission_application_audit').get().n,3);
});
test('parents, teachers and accountants cannot inspect admission details or execute decisions',async t=>{
 const f=fixture(t),c=await create(f);
 for(const role of ['parent','teacher','accountant','foreignParent']){
  assert.equal((await req(f,role,'GET','/api/admissions')).status,403);assert.equal((await req(f,role,'GET',c.path+'/preview')).status,403);assert.equal((await req(f,role,'GET',c.path+'/audit')).status,403);
 }
 assert.equal((await req(f,'owner','GET','/api/admissions?school_id=2')).status,403);
 assert.equal((await req(f,'admin','GET','/api/admissions')).status,400);
});

test('retiring an approved source is management-only and invalidates pending execution',async t=>{
 const f=fixture(t),r=await regulation(f),c=await create(f);await approve(f,c);const path=`/api/regulations/${r.regulation_key}/retire`;
 assert.equal((await req(f,'registrar','POST',path,{revision:r.revision,reason:'TEST retire'})).status,403);
 assert.equal((await req(f,'owner','POST',path,{revision:r.revision,reason:''})).status,400);
 assert.equal((await req(f,'owner','POST',path,{revision:r.revision,reason:'TEST source revoked'})).status,200);
 const before=snapshot(f.db);assert.equal((await req(f,'registrar','POST',c.path+'/execute',{revision:c.a.revision,confirm_execute:true})).status,409);assert.deepEqual(snapshot(f.db),before);
});
