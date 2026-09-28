import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';
import { fixture, request, root, snapshot } from './helpers/school-workflow-fixture.mjs';
import { parseAdmissionRules, evaluateAdmission } from '../src/lib/admissionRegulations.ts';
import { checkStudentAge, formatAge } from '../src/lib/studentAge.ts';
import { REGULATION_TEMPLATES, copyRegulationTemplate, matchesTemplateYear } from '../src/lib/policyTemplates.ts';

const vite = await createServer({ root, appType: 'custom', server: { middlewareMode: true, hmr: false } });
const { default: app } = await vite.ssrLoadModule('/src/worker.ts');
after(() => vite.close());
const call = (f, role = 'owner', query = '') => request(app, f, role, 'GET', '/api/student-age-review?academic_year_id=1' + query);
const rules = () => copyRegulationTemplate(REGULATION_TEMPLATES[0].id).rules;
const check = (birth_date, gender = 'male', rule = rules()) => checkStudentAge(rule, { birth_date, gender, today: '2026-09-27' });
async function savePolicy(f, overrides = {}, approve = true) {
  const body = { school_id: 1, regulation_key: crypto.randomUUID(), academic_year_id: 1, class_id: 1, process: 'admission', title: 'TEST age source', jurisdiction: 'TEST ONLY', source_reference: 'TEST ONLY', source_url: 'https://example.test/age', effective_from: '2020-01-01', effective_to: '2099-12-31', rules: rules(), ...overrides };
  const draft = await request(app, f, 'registrar', 'POST', '/api/regulations', body);
  assert.equal(draft.status, 201, JSON.stringify(draft));
  if (approve) assert.equal((await request(app, f, 'owner', 'POST', `/api/regulations/${body.regulation_key}/approve`, { revision: 1, confirm_source_verified: true, reason: 'TEST verified' })).status, 200);
  return body;
}

test('official oldest birth years are inclusive, gender specific and do not invent younger limits', () => {
  assert.deepEqual(REGULATION_TEMPLATES.map(t => [t.rules.birth_date_bounds.male.earliest, t.rules.birth_date_bounds.female.earliest]), [['2011-01-01','2009-01-01'],['2010-01-01','2008-01-01'],['2009-01-01','2007-01-01'],['2006-01-01','2004-01-01'],['2005-01-01','2003-01-01'],['2004-01-01','2002-01-01']]);
  for (const template of REGULATION_TEMPLATES) {
    const rule = parseAdmissionRules(template.rules);
    for (const gender of ['male', 'female']) {
      const earliest = rule.birth_date_bounds[gender].earliest;
      assert.equal(check(earliest, gender, rule).status, 'within_limits');
      assert.equal(check(`${Number(earliest.slice(0,4)) - 1}-12-31`, gender, rule).status, 'outside_limits');
      assert.equal(rule.birth_date_bounds[gender].latest, null);
    }
  }
  assert.equal(check('2010-12-31', 'male').status, 'outside_limits');
  assert.equal(check('2010-12-31', 'female').status, 'within_limits');
  assert.equal(check('2011-01-01', null).status, 'review');
});

test('missing, impossible, future and leap birthdays are distinguished before policy comparison', () => {
  assert.equal(check(null).status, 'missing_birth_date');
  assert.equal(check('2011-02-29').status, 'invalid_birth_date');
  assert.equal(check('2026-09-28').status, 'future_birth_date');
  assert.equal(check('2012-02-29').status, 'within_limits');
  assert.equal(check('2011-01-01', 'male', null).status, 'review');
  assert.equal(check('2011-01-01', 'male', null).age_months, 188);
  assert.equal(check('2011-01-01', 'male', null).reference_date, '2026-09-27');
  const bounded = { ...rules(), age_rule: 'bounded', age_reference_date: '2026-09-01', min_age_months: 72, max_age_months: 84 };
  assert.equal(check('2020-09-01', 'male', bounded).status, 'within_limits');
  assert.equal(check('2020-09-02', 'male', bounded).status, 'outside_limits');
  assert.equal(check('2019-08-01', 'male', bounded).status, 'outside_limits');
  assert.equal(formatAge(179), '14 سنة و11 شهر');
});

test('malformed bounds fail validation, existing rules remain valid and template copies stay independent', () => {
  for (const bounds of [null, {male:{earliest:null,latest:null},female:{earliest:'2009-01-01',latest:null}}, {male:{earliest:'2012-01-01',latest:'2011-01-01'},female:{earliest:'2009-01-01',latest:null}}]) assert.throws(() => parseAdmissionRules({...rules(),birth_date_bounds:bounds}));
  assert.throws(() => parseAdmissionRules({...rules(),age_scope:'everywhere'}));
  const old = {age_reference_date:'2026-09-01',age_rule:'review',min_age_months:null,max_age_months:null,repeat_rule:'review',max_previous_repeats:null,acceleration:'review',required_documents:[]};
  assert.deepEqual(parseAdmissionRules(old), old);
  const copy = copyRegulationTemplate(REGULATION_TEMPLATES[0].id);
  copy.rules.birth_date_bounds.male.earliest = '1900-01-01';
  assert.equal(rules().birth_date_bounds.male.earliest, '2011-01-01');
  assert.equal(matchesTemplateYear('السنة ٢٠٢٦ / ٢٠٢٧', '2026-2027'), true);
  assert.equal(matchesTemplateYear('2025-2026', '2026-2027'), false);
  assert.equal(matchesTemplateYear('2026', '2026-2027'), false);
});

test('admission evaluation uses the same birth-year limits and retains evidence review', () => {
  const facts = { birth_date:'2010-12-31', today:'2026-09-27', previous_repeats:0, accelerated:false, documents:[] };
  assert.equal(evaluateAdmission(rules(), {...facts,gender:'male'}).decision,'ineligible');
  assert.equal(evaluateAdmission(rules(), {...facts,gender:'female'}).decision,'review');
  const resolved = {...rules(),repeat_rule:'not_applicable'};
  assert.equal(evaluateAdmission(resolved,{...facts,gender:'female'}).decision,'eligible');
  assert.equal(evaluateAdmission(resolved,{...facts,gender:null}).decision,'review');
});

test('review uses annual placement, current school policy, and performs no database writes', async t => {
  const f = fixture(t); await savePolicy(f);
  f.db.exec("UPDATE students SET birth_date='2010-12-31' WHERE school_id=1; UPDATE students SET class_id=2,section_id=NULL WHERE id=101");
  const before = snapshot(f.db), response = await call(f);
  assert.equal(response.status, 200, JSON.stringify(response));
  assert.deepEqual(response.data.rows.map(r => [r.student_id,r.class_id,r.age_check.status]), [[101,1,'outside_limits'],[102,1,'within_limits']]);
  assert.equal(response.data.next_cursor,null);
  assert.equal(response.data.rows[0].regulation_version,1);
  assert.match(response.data.rows[0].context_notes.join(' '),/الرسوب/);
  assert.deepEqual(snapshot(f.db),before);
  // A school customization creates a new immutable version and changes only this school's comparison.
  await savePolicy(f,{rules:{...rules(),birth_date_bounds:{...rules().birth_date_bounds,male:{earliest:'2010-01-01',latest:null}}}});
  assert.equal((await call(f)).data.rows[0].age_check.status,'within_limits');
  assert.deepEqual(f.db.prepare('SELECT version,status FROM admission_regulations ORDER BY version').all().map(r=>[r.version,r.status]),[[1,'retired'],[2,'approved']]);
});

test('unapproved, expired and entry-only rules cannot label an existing student noncompliant', async t => {
  const f=fixture(t); f.db.exec("UPDATE students SET birth_date='2000-01-01' WHERE school_id=1");
  await savePolicy(f,{},false);
  assert.equal((await call(f)).data.rows[0].age_check.status,'review');
  await savePolicy(f,{effective_from:'2026-06-08'});
  assert.equal((await call(f,'owner','&review_date=2026-01-01')).data.rows[0].age_check.status,'review');
  await savePolicy(f,{rules:{...rules(),age_scope:'entry_only'}});
  assert.equal((await call(f)).data.rows[0].age_check.status,'review');
  f.db.exec("UPDATE students SET birth_date=NULL WHERE id=101; UPDATE students SET birth_date='2010-02-30' WHERE id=102");
  assert.deepEqual((await call(f)).data.rows.map(r=>r.age_check.status),['missing_birth_date','invalid_birth_date']);
});

test('age review restricts roles, tenant/year/class/section scopes and invalid request dates', async t => {
  const f=fixture(t);
  for(const role of ['parent','teacher','accountant','foreignParent'])assert.equal((await call(f,role)).status,403);
  assert.equal((await call(f,'owner','&school_id=2')).status,403);
  assert.equal((await call(f,'owner','&class_id=3')).status,404);
  assert.equal((await call(f,'owner','&class_id=2&section_id=2')).status,404);
  assert.equal((await call(f,'owner','&review_date=2026-02-30')).status,400);
  assert.equal((await call(f,'owner','&review_date=2999-01-01')).status,400);
  assert.equal((await call(f,'owner','&after=-1')).status,400);
  assert.equal((await request(app,f,'owner','GET','/api/student-age-review?academic_year_id=3')).status,404);
  assert.equal((await call(f,'admin')).status,400);
  assert.equal((await call(f,'registrar')).status,200);
  const foreign=await request(app,f,'admin','GET','/api/student-age-review?school_id=2&academic_year_id=3');
  assert.deepEqual(foreign.data.rows.map(r=>r.student_id),[103]);
});

test('cursor pagination covers every active annual enrollment once and excludes other years', async t => {
  const f=fixture(t);
  for(let id=200;id<303;id++) {
    f.db.prepare("INSERT INTO students(id,school_id,student_number,full_name,gender,class_id,section_id,status) VALUES(?,1,?,?,'male',1,2,'active')").run(id,'AGE-'+id,'Age fixture '+id);
    f.db.prepare("INSERT INTO student_enrollments(school_id,student_id,academic_year_id,class_id,section_id,status,promotion_status,created_by_user_id) VALUES(1,?,1,1,2,'active','pending',1)").run(id);
  }
  f.db.prepare("INSERT INTO student_enrollments(school_id,student_id,academic_year_id,class_id,section_id,status,promotion_status,created_by_user_id) VALUES(1,101,2,1,2,'completed','promoted',1)").run();
  const first=(await call(f)).data, second=(await call(f,'owner','&after='+first.next_cursor)).data;
  assert.equal(first.rows.length,100); assert.equal(second.rows.length,5); assert.equal(second.next_cursor,null);
  assert.equal(new Set([...first.rows,...second.rows].map(r=>r.student_id)).size,105);
});
