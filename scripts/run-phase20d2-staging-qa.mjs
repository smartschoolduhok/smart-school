// Explicit STAGING-only synthetic fixtures. Never seeds, resets, or deletes rows.
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword } from '../src/lib/authSecurity.ts';
import { stagingClient } from './lib/phase20d2-staging-client.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [mode, previewArgument, directoryArgument, confirmation] = process.argv.slice(2);
assert.ok(['setup','verify','cleanup'].includes(mode));
assert.equal(confirmation, '--confirm-staging');
const preview = new URL(previewArgument), directory = resolve(directoryArgument);
assert.equal(preview.protocol, 'https:');
assert.match(preview.hostname, /^[a-f0-9]{8}\.smart-school-staging\.pages\.dev$/u);
assert.ok(relative(root, directory).startsWith('..'));
const target = 'smart-school-staging-db', targetId = '1bdb9c3d-08d6-4023-9cbc-64369d53198a';
const config = JSON.parse(readFileSync(join(root,'wrangler.jsonc'),'utf8'));
assert.equal(config.name,'smart-school-staging');
assert.deepEqual(config.d1_databases,[{binding:'DB',database_name:target,database_id:targetId}]);
const contextPath = join(directory,'qa-private-context.json');
const reportPath = join(directory,'phase20d2-authenticated-qa.json');
const client = stagingClient(root);
const q = value => "'" + String(value).replaceAll("'","''") + "'";
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
let ctx = existsSync(contextPath) ? JSON.parse(readFileSync(contextPath,'utf8')) : null;
let report = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath,'utf8')) : { staging_only:true, preview:preview.href, checks:[], commands:[] };
function save() {
  if(ctx) writeFileSync(contextPath,JSON.stringify(ctx,null,2));
  writeFileSync(reportPath,JSON.stringify(report,null,2));
}
function d1(sql, expectedError = null) {
  assert.ok(!/\b(?:DELETE|DROP|TRUNCATE|VACUUM|REPLACE|ALTER|CREATE)\b/iu.test(sql),'Destructive/schema SQL forbidden');
  const label = `qa-${mode}-${report.commands.length+1}`;
  const sqlPath = join(directory, label+'.sql');
  writeFileSync(sqlPath,sql);
  const result = client.query(sql);
  report.commands.push({label,http_status:result.status,success:result.payload.success,expected_rejection:expectedError?.source ?? null});
  if(expectedError) {
    assert.equal(result.payload.success,false,'Expected database rejection');
    assert.match(JSON.stringify(result.payload),expectedError);
    return [];
  }
  assert.equal(result.status,200,`${label} failed: ${JSON.stringify(result.payload.errors)}`);
  assert.equal(result.payload.success,true,`${label} failed: ${JSON.stringify(result.payload.errors)}`);
  const parsed = result.payload.result;
  assert.ok(parsed.every(r=>r.success));
  if(/^\s*(?:SELECT|PRAGMA)\b/u.test(sql) && !/\b(?:INSERT|UPDATE)\b/u.test(sql)) {
    assert.ok(parsed.every(r=>r.meta.changed_db===false && Number(r.meta.rows_written||0)===0));
  }
  return parsed.flatMap(r=>r.results||[]);
}
async function api(path,{method='POST',body,token=ctx?.ownerToken,status=200,code}={}) {
  const response = await fetch(new URL(path,preview),{
    method,redirect:'error',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},
    body:body===undefined?undefined:JSON.stringify(body),
  });
  const payload = await response.json();
  assert.equal(response.status,status,`${method} ${path}: ${response.status} ${payload.code || payload.error}`);
  if(code) assert.equal(payload.code,code);
  return payload;
}
function check(name,data={}) { report.checks.push({name,pass:true,...data}); save(); console.log('PASS '+name); }
const scenarios = [
  ['promote','non_terminal','pass'], ['graduate','terminal','pass'], ['repeat','non_terminal','fail'],
  ['completion','non_terminal','completion'], ['incomplete','non_terminal','incomplete'],
  ['draft','non_terminal','pass'], ['withdrawn','non_terminal','pass'],
  ['bulk_pass','non_terminal','pass'], ['bulk_stale','non_terminal','fail'], ['ui_ready','non_terminal','pass'],
];
function cardSnapshot(key,kind,outcome) {
  const label = {pass:'ناجح',fail:'راسب',completion:'مكمل',incomplete:'غير مكتمل'}[outcome];
  return {schema_version:5,card_mode:outcome==='incomplete'?'partial':'complete',exam_round:'الدور الأول',
    academic_policy:{id:0,version:1,status:'approved',policy_kind:kind,source_reference:`${ctx.marker} QA ONLY synthetic policy`},
    summary:{academic_status_code:outcome,academic_status:label,overall_result_status:label},subjects:[],qa_marker:ctx.marker,qa_scenario:key};
}
function input(key,overrides={}) {
  const row=ctx.rows[key], action=key==='graduate'?'graduated':key==='repeat'||key==='bulk_stale'?'repeated':'promoted';
  return {school_id:ctx.schoolId,source_enrollment_id:row.enrollmentId,action,
    ...(action==='graduated'?{}:{target_academic_year_id:ctx.targetYearId,target_class_id:action==='repeated'?ctx.sourceClassId:ctx.targetClassId,target_section_id:action==='repeated'?ctx.sourceSectionId:ctx.targetSectionId}),
    official_result_card_id:row.cardId,official_result_publication_revision:1,...overrides};
}
function state() {
  const ids=Object.values(ctx.rows).map(r=>r.studentId).join(',');
  return d1(`SELECT 'enrollment' AS kind,id,school_id,student_id,academic_year_id,class_id,section_id,status,promotion_status,completed_at,updated_by_user_id FROM student_enrollments WHERE student_id IN (${ids}) ORDER BY id; SELECT * FROM student_promotion_result_decisions WHERE source_enrollment_id IN (SELECT id FROM student_enrollments WHERE student_id IN (${ids})) ORDER BY id;`);
}

try {
  if(mode==='setup') {
    assert.equal(ctx,null,'Refusing to create duplicate QA fixtures');
    const migration=d1("SELECT id,name FROM d1_migrations ORDER BY id; PRAGMA foreign_key_check;");
    assert.equal(migration.length,36); assert.equal(migration.at(-1).name,'0035_official_result_promotion.sql');
    const schools=d1("SELECT s.id AS school_id,y.id AS year_id,y.starts_at FROM schools s JOIN academic_years y ON y.school_id=s.id AND y.is_active=1 WHERE s.status='active' ORDER BY s.id;");
    assert.ok(schools.length>=2);
    ctx={marker:`PH20D2-${randomBytes(5).toString('hex')}`,schoolId:schools[0].school_id,sourceYearId:schools[0].year_id,otherSchoolId:schools[1].school_id,rows:{}};
    report.marker=ctx.marker; save();
    const future=d1(`SELECT id,name,starts_at,is_active FROM academic_years WHERE school_id=${ctx.schoolId} AND is_active=0 AND starts_at>${q(schools[0].starts_at)} ORDER BY starts_at,id;`);
    if(future.length) {ctx.targetYearId=future[0].id;report.future_year={...future[0],created:false};}
    else {
      const year=Math.max(new Date().getUTCFullYear()+2,Number(schools[0].starts_at.slice(0,4))+2);
      const row=d1(`INSERT INTO academic_years(school_id,name,starts_at,ends_at,is_active) VALUES(${ctx.schoolId},${q(ctx.marker+' FUTURE INACTIVE')},'${year}-09-01','${year+1}-06-30',0) RETURNING id,name,starts_at,is_active;`)[0];
      ctx.targetYearId=row.id;report.future_year={...row,created:true};
    }
    ctx.password=randomBytes(24).toString('base64url');
    ctx.ownerEmail=`${ctx.marker.toLowerCase()}.owner@example.test`;ctx.otherEmail=`${ctx.marker.toLowerCase()}.other@example.test`;save();
    const passwordHash=await hashPassword(ctx.password);
    const users=d1(`INSERT INTO users(school_id,full_name,email,password_hash,role_id,status,auth_version) VALUES
      (${ctx.schoolId},${q(ctx.marker+' Owner')},${q(ctx.ownerEmail)},${q(passwordHash)},(SELECT id FROM roles WHERE key='school_owner'),'active',1),
      (${ctx.otherSchoolId},${q(ctx.marker+' Other owner')},${q(ctx.otherEmail)},${q(passwordHash)},(SELECT id FROM roles WHERE key='school_owner'),'active',1) RETURNING id,email;`);
    ctx.ownerId=users.find(r=>r.email===ctx.ownerEmail).id;ctx.otherId=users.find(r=>r.email===ctx.otherEmail).id;save();
    const classes=d1(`INSERT INTO classes(school_id,name,stage,order_index,status) VALUES(${ctx.schoolId},${q(ctx.marker+' Source')},'QA',971,'active'),(${ctx.schoolId},${q(ctx.marker+' Target')},'QA',972,'active') RETURNING id,name;`);
    ctx.sourceClassId=classes.find(r=>r.name.endsWith('Source')).id;ctx.targetClassId=classes.find(r=>r.name.endsWith('Target')).id;save();
    const sections=d1(`INSERT INTO sections(school_id,class_id,name,capacity,status) VALUES(${ctx.schoolId},${ctx.sourceClassId},${q(ctx.marker+' Source section')},30,'active'),(${ctx.schoolId},${ctx.targetClassId},${q(ctx.marker+' Target section')},30,'active') RETURNING id,class_id;`);
    ctx.sourceSectionId=sections.find(r=>r.class_id===ctx.sourceClassId).id;ctx.targetSectionId=sections.find(r=>r.class_id===ctx.targetClassId).id;save();
    const students=d1(`INSERT INTO students(school_id,student_number,full_name,gender,class_id,section_id,status,notes) VALUES ${scenarios.map(([key])=>`(${ctx.schoolId},${q(ctx.marker+'-'+key)},${q(ctx.marker+' '+key)},'ذكر',${ctx.sourceClassId},${ctx.sourceSectionId},'active',${q(ctx.marker)})`).join(',')} RETURNING id,student_number;`);
    for(const [key] of scenarios)ctx.rows[key]={studentId:students.find(r=>r.student_number===ctx.marker+'-'+key).id}; save();
    const enrollments=d1(`INSERT INTO student_enrollments(school_id,student_id,academic_year_id,class_id,section_id,status,promotion_status,created_by_user_id,updated_by_user_id) VALUES ${scenarios.map(([key])=>`(${ctx.schoolId},${ctx.rows[key].studentId},${ctx.sourceYearId},${ctx.sourceClassId},${ctx.sourceSectionId},'active','pending',${ctx.ownerId},${ctx.ownerId})`).join(',')} RETURNING id,student_id;`);
    for(const row of Object.values(ctx.rows))row.enrollmentId=enrollments.find(r=>r.student_id===row.studentId).id;save();
    const cards=d1(`INSERT INTO result_cards(school_id,student_id,class_id,section_id,academic_year_id,card_number,verification_token,verification_hash,student_name_snapshot,class_name_snapshot,section_name_snapshot,school_name_snapshot,academic_year_snapshot,general_exemption_status,overall_result_status,card_data_json,generated_by_user_id,generated_at,status,publication_status,publication_revision,published_at,published_by_user_id) VALUES ${scenarios.map(([key,kind,outcome])=>{
      const snapshot=cardSnapshot(key,kind,outcome);return `(${ctx.schoolId},${ctx.rows[key].studentId},${ctx.sourceClassId},${ctx.sourceSectionId},${ctx.sourceYearId},${q(ctx.marker+'-'+key)},${q(randomBytes(24).toString('hex'))},${q(randomBytes(32).toString('hex'))},${q(ctx.marker+' '+key)},${q(ctx.marker+' Source')},${q(ctx.marker+' Source section')},'QA ONLY',${q(String(ctx.sourceYearId))},0,${q(snapshot.summary.academic_status)},${q(JSON.stringify(snapshot))},${ctx.ownerId},unixepoch(),'active',${q(key==='incomplete'?'published':'draft')},${key==='incomplete'?1:0},${key==='incomplete'?'unixepoch()':'NULL'},${key==='incomplete'?ctx.ownerId:'NULL'})`;
    }).join(',')} RETURNING id,student_id;`);
    for(const row of Object.values(ctx.rows))row.cardId=cards.find(r=>r.student_id===row.studentId).id;save();
    ctx.ownerToken=(await api('/api/auth/login',{token:null,body:{email:ctx.ownerEmail,password:ctx.password}})).data.token;
    ctx.otherToken=(await api('/api/auth/login',{token:null,body:{email:ctx.otherEmail,password:ctx.password}})).data.token;save();
    for(const [key] of scenarios)if(!['draft','incomplete'].includes(key))await api(`/api/result-cards/${ctx.rows[key].cardId}/publish`,{method:'PUT',body:{school_id:ctx.schoolId,expected_revision:0,note:ctx.marker+' synthetic QA only'}});
    await api(`/api/result-cards/${ctx.rows.withdrawn.cardId}/withdraw`,{method:'PUT',body:{school_id:ctx.schoolId,expected_revision:1,reason:ctx.marker+' withdrawn fixture'}});
    report.identifiers={school_id:ctx.schoolId,source_year_id:ctx.sourceYearId,target_year_id:ctx.targetYearId,source_class_id:ctx.sourceClassId,target_class_id:ctx.targetClassId,rows:ctx.rows};
    check('synthetic fixtures and authenticated preview login',{student_count:scenarios.length});
  }
  if(mode==='verify') {
    assert.ok(ctx?.ownerToken);
    const decisions=(await api('/api/student-enrollments/promotion/official-decisions',{body:{school_id:ctx.schoolId,source_enrollment_ids:scenarios.map(([key])=>ctx.rows[key].enrollmentId)}})).data;
    for(const [key,action] of [['promote','promoted'],['graduate','graduated'],['repeat','repeated']]) {
      assert.equal(decisions.find(r=>r.source_enrollment_id===ctx.rows[key].enrollmentId).required_action,action);
      await api('/api/student-enrollments/promotion/preview',{body:input(key)});
      const result=await api('/api/student-enrollments/promotion',{body:input(key)});assert.equal(result.data.already_applied,false);
      const rows=d1(`SELECT status,promotion_status,completed_at FROM student_enrollments WHERE id=${ctx.rows[key].enrollmentId}; SELECT * FROM student_promotion_result_decisions WHERE source_enrollment_id=${ctx.rows[key].enrollmentId}; SELECT id,academic_year_id,class_id,section_id FROM student_enrollments WHERE student_id=${ctx.rows[key].studentId} AND academic_year_id=${ctx.targetYearId};`);
      assert.equal(rows[0].status,'completed');assert.equal(rows[0].promotion_status,action);assert.ok(rows[0].completed_at>0);
      assert.equal(rows[1].result_card_id,ctx.rows[key].cardId);assert.equal(rows[1].result_card_publication_revision,1);
      assert.equal(rows.length,action==='graduated'?2:3);
      if(action==='repeated')assert.equal(rows[2].class_id,ctx.sourceClassId);
      check('derived '+action,{source_enrollment_id:ctx.rows[key].enrollmentId,result_card_id:ctx.rows[key].cardId,publication_revision:1,target_count:action==='graduated'?0:1});
    }
    const beforeRetry=state();const retried=await api('/api/student-enrollments/promotion',{body:input('promote')});assert.equal(retried.data.already_applied,true);assert.deepEqual(state(),beforeRetry);check('identical retry is idempotent');
    for(const key of ['completion','incomplete','draft','withdrawn']) {
      const before=state();await api('/api/student-enrollments/promotion/preview',{body:input(key),status:409});await api('/api/student-enrollments/promotion',{body:input(key),status:409});assert.deepEqual(state(),before);check(key+' blocked without writes');
    }
    for(const [name,body,token,status] of [
      ['wrong manual action',input('ui_ready',{action:'repeated',target_class_id:ctx.sourceClassId,target_section_id:ctx.sourceSectionId}),ctx.ownerToken,409],
      ['stale publication revision',input('ui_ready',{official_result_publication_revision:0}),ctx.ownerToken,409],
      ['cross school access',input('ui_ready'),ctx.otherToken,403],
    ]) {const before=state();await api('/api/student-enrollments/promotion',{body,token,status});assert.deepEqual(state(),before);check(name+' fails closed');}
    const beforeWithdrawal=d1(`SELECT * FROM result_card_publication_logs WHERE result_card_id=${ctx.rows.promote.cardId} ORDER BY id; SELECT id,status,publication_status,publication_revision FROM result_cards WHERE id=${ctx.rows.promote.cardId};`);
    await api(`/api/result-cards/${ctx.rows.promote.cardId}/withdraw`,{method:'PUT',body:{school_id:ctx.schoolId,expected_revision:1,reason:ctx.marker+' expected rejection'},status:409,code:'official_result_already_applied'});
    assert.deepEqual(d1(`SELECT * FROM result_card_publication_logs WHERE result_card_id=${ctx.rows.promote.cardId} ORDER BY id; SELECT id,status,publication_status,publication_revision FROM result_cards WHERE id=${ctx.rows.promote.cardId};`),beforeWithdrawal);check('used result withdrawal rejected with audit rollback');
    const bulkBody={school_id:ctx.schoolId,source_academic_year_id:ctx.sourceYearId,source_class_id:ctx.sourceClassId,source_section_id:ctx.sourceSectionId,target_academic_year_id:ctx.targetYearId,rows:['bulk_pass','bulk_stale'].map(key=>{const {school_id,target_academic_year_id,...row}=input(key);return row;})};
    assert.equal((await api('/api/student-enrollments/promotion/bulk-preview',{body:bulkBody})).data.valid,true);
    await api(`/api/result-cards/${ctx.rows.bulk_stale.cardId}/withdraw`,{method:'PUT',body:{school_id:ctx.schoolId,expected_revision:1,reason:ctx.marker+' stale after bulk preview'}});
    const beforeBulk=state();await api('/api/student-enrollments/promotion/bulk',{body:bulkBody,status:409});assert.deepEqual(state(),beforeBulk);check('one stale result rejects entire bulk with zero source/target/decision changes',{state_hash:digest(beforeBulk)});
    const beforeTriggers=state();
    d1(`UPDATE student_enrollments SET status='completed',promotion_status='promoted' WHERE id=${ctx.rows.ui_ready.enrollmentId};`,/official_result_required/);
    d1(`UPDATE student_promotion_result_decisions SET result_card_number=result_card_number WHERE source_enrollment_id=${ctx.rows.promote.enrollmentId};`,/official_result_decision_immutable/);
    d1(`UPDATE student_enrollments SET status='active' WHERE id=${ctx.rows.promote.enrollmentId};`,/official_result_decision_immutable/);
    d1(`UPDATE result_cards SET card_data_json=card_data_json WHERE id=${ctx.rows.promote.cardId};`,/official_result_evidence_immutable/);
    d1(`UPDATE result_card_publication_logs SET reason=reason WHERE result_card_id=${ctx.rows.promote.cardId};`,/result_card_publication_log_immutable/);
    assert.deepEqual(state(),beforeTriggers);check('database transition guard and immutable decision/source/card/audit');
    const readiness=d1('SELECT * FROM student_promotion_result_readiness ORDER BY school_id; PRAGMA foreign_key_check;');assert.ok(readiness.every(r=>r.status==='healthy'));
    check('promotion readiness healthy and FK clean');report.functional_pass=true;save();
  }
  if(mode==='cleanup') {
    assert.ok(ctx?.marker);
    const ids=Object.values(ctx.rows).map(r=>r.studentId).join(',');
    const used=d1(`SELECT result_card_id FROM student_promotion_result_decisions WHERE source_enrollment_id IN (SELECT id FROM student_enrollments WHERE student_id IN (${ids}));`).map(r=>r.result_card_id);
    const cards=d1(`SELECT id,publication_status,publication_revision FROM result_cards WHERE student_id IN (${ids}) ORDER BY id;`);
    for(const card of cards)if(card.publication_status==='published'&&!used.includes(card.id))await api(`/api/result-cards/${card.id}/withdraw`,{method:'PUT',body:{school_id:ctx.schoolId,expected_revision:card.publication_revision,reason:ctx.marker+' soft cleanup'}});
    // Completed decisions and their source/target enrollment trail are retained.
    // Archived student/class/section and an inactive future year isolate the trail.
    d1(`UPDATE student_enrollments SET status='cancelled',updated_at=unixepoch() WHERE student_id IN (${ids}) AND status='active' AND id NOT IN (SELECT source_enrollment_id FROM student_promotion_result_decisions) AND academic_year_id=${ctx.sourceYearId}; UPDATE students SET status='archived',updated_at=unixepoch() WHERE id IN (${ids}) AND notes=${q(ctx.marker)}; UPDATE sections SET status='archived',updated_at=unixepoch() WHERE id IN (${ctx.sourceSectionId},${ctx.targetSectionId}) AND name LIKE ${q(ctx.marker+'%')}; UPDATE classes SET status='archived',updated_at=unixepoch() WHERE id IN (${ctx.sourceClassId},${ctx.targetClassId}) AND name LIKE ${q(ctx.marker+'%')}; UPDATE users SET status='inactive',auth_version=auth_version+1,updated_at=unixepoch() WHERE id IN (${ctx.ownerId},${ctx.otherId}) AND full_name LIKE ${q(ctx.marker+'%')};`);
    const final=d1(`SELECT COUNT(*) AS active_qa_students FROM students WHERE notes=${q(ctx.marker)} AND status='active'; SELECT COUNT(*) AS active_qa_users FROM users WHERE full_name LIKE ${q(ctx.marker+'%')} AND status='active'; SELECT id,is_active FROM academic_years WHERE id=${ctx.targetYearId}; SELECT * FROM student_promotion_result_readiness ORDER BY school_id; SELECT * FROM result_card_publication_readiness ORDER BY school_id; PRAGMA foreign_key_check;`);
    assert.equal(final[0].active_qa_students,0);assert.equal(final[1].active_qa_users,0);assert.equal(final[2].is_active,0);assert.ok(final.slice(3).every(r=>r.status==='healthy'));
    report.cleanup={pass:true,active_qa_students:0,active_qa_users:0,future_year_inactive:true,immutable_decisions_preserved:used.length,target_enrollments_retained_in_inactive_year_with_archived_student_class_section:true,final_checks:final};
    ctx.ownerToken=null;ctx.otherToken=null;ctx.password=null;save();check('soft cleanup and preserved immutable official trail');
  }
} catch(error) {report.failure={mode,message:error.message,at:new Date().toISOString()};save();throw error;}
console.log(JSON.stringify({mode,marker:ctx?.marker,checks:report.checks.length,evidence_path:reportPath,functional_pass:report.functional_pass??false,cleanup_pass:report.cleanup?.pass??false}));
