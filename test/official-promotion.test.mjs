import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test, { after } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'vite';

import { signJWT } from '../src/lib/jwtSecurity.ts';
import { fixture, fixtureSQL, root } from './helpers/teaching-load-matrix-fixture.mjs';

const vite = await createServer({ root, appType: 'custom', server: { middlewareMode: true, hmr: false } });
const { default: app } = await vite.ssrLoadModule('/src/worker.ts');
after(() => vite.close());

const secret = 'official-promotion-test-secret-2026-long';
const tokens = {
  owner: await signJWT({ email: 'owner@matrix.test', auth_version: 1 }, secret),
  teacher: await signJWT({ email: 'teacher@matrix.test', auth_version: 1 }, secret),
  admin: await signJWT({ email: 'admin@matrix.test', auth_version: 1 }, secret),
};

async function api(f, role, method, path, body) {
  const response = await app.request(`http://localhost${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens[role]}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, { DB: f.d1, JWT_SECRET: secret, APP_ENV: 'test' });
  return { status: response.status, body: await response.json() };
}

function snapshot(policyKind, academicStatusCode) {
  const labels = { pass: 'ناجح', fail: 'راسب', completion: 'مكمل', incomplete: 'غير مكتمل' };
  return {
    schema_version: 5,
    card_mode: academicStatusCode === 'incomplete' ? 'partial' : 'complete',
    exam_round: 'الدور الأول',
    academic_policy: {
      id: 501,
      version: 1,
      status: 'approved',
      policy_kind: policyKind,
      source_reference: 'قرار وزارة التربية التجريبي 2026-2027',
    },
    summary: {
      academic_status_code: academicStatusCode,
      academic_status: labels[academicStatusCode],
      overall_result_status: labels[academicStatusCode],
    },
    subjects: [],
  };
}

function setupOutcome(t, { policyKind = 'non_terminal', academicStatusCode = 'pass', publicationStatus = 'published', schoolId = 1 } = {}) {
  const f = fixture();
  t.after(() => f.db.close());
  f.db.exec(`
    INSERT INTO academic_years(id,school_id,name,starts_at,ends_at,is_active)
    VALUES(4,1,'2027-2028','2027-09-01','2028-06-01',0);
    INSERT INTO students(id,school_id,student_number,full_name,gender,status,class_id,section_id)
    VALUES(10,1,'PROMO-OFFICIAL-10','Official Student','ذكر','active',1,1);
    INSERT INTO student_enrollments(
      id,school_id,student_id,academic_year_id,class_id,section_id,status,promotion_status,
      created_by_user_id,updated_by_user_id
    ) VALUES(10,1,10,1,1,1,'active','pending',1,1);
  `);
  f.db.prepare(`
    INSERT INTO result_cards(
      id,school_id,student_id,class_id,section_id,academic_year_id,
      card_number,verification_token,verification_hash,student_name_snapshot,
      class_name_snapshot,section_name_snapshot,school_name_snapshot,academic_year_snapshot,
      general_exemption_status,overall_result_status,card_data_json,generated_by_user_id,
      generated_at,status,publication_status,publication_revision,published_at,published_by_user_id
    ) VALUES(10,1,10,1,1,1,'RC-OFFICIAL-10','official-token-10','hash','Official Student',
      'Class A','A','A','2026-2027',0,?,?,1,1789297000,'active',?,1,1789297100,1)
  `).run(snapshot(policyKind, academicStatusCode).summary.academic_status, JSON.stringify(snapshot(policyKind, academicStatusCode)), publicationStatus);
  return { f, schoolId };
}

function promotedBody(overrides = {}) {
  return {
    school_id: 1,
    source_enrollment_id: 10,
    action: 'promoted',
    target_academic_year_id: 4,
    target_class_id: 2,
    target_section_id: null,
    official_result_card_id: 10,
    official_result_publication_revision: 1,
    ...overrides,
  };
}

test('0035 is additive and preserves every value in all pre-existing application tables', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  const migrations = readdirSync(join(root, 'migrations')).filter(name => name.endsWith('.sql')).sort();
  for (const name of migrations.filter(name => name < '0035_official_result_promotion.sql')) {
    db.exec(readFileSync(join(root, 'migrations', name), 'utf8'));
  }
  db.exec(fixtureSQL);
  const oldTables = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => row.name);
  const before = Object.fromEntries(oldTables.map(name => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]));
  db.exec(readFileSync(join(root, 'migrations/0035_official_result_promotion.sql'), 'utf8'));
  const after = Object.fromEntries(oldTables.map(name => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]));
  assert.deepEqual(after, before);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(db.prepare('SELECT status FROM student_promotion_result_readiness WHERE school_id=1').get().status, 'healthy');
  db.close();
});

test('official decision endpoint derives the action and rejects unauthorized roles and tenant drift', async t => {
  const { f } = setupOutcome(t, { policyKind: 'non_terminal', academicStatusCode: 'pass' });
  const body = { school_id: 1, source_enrollment_ids: [10] };
  assert.equal((await api(f, 'teacher', 'POST', '/api/student-enrollments/promotion/official-decisions', body)).status, 403);
  const wrongTenant = await api(f, 'admin', 'POST', '/api/student-enrollments/promotion/official-decisions', { school_id: 2, source_enrollment_ids: [10] });
  assert.equal(wrongTenant.status, 200);
  assert.equal(wrongTenant.body.data[0].ready, false);
  const result = await api(f, 'owner', 'POST', '/api/student-enrollments/promotion/official-decisions', body);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.data[0].required_action, 'promoted');
  assert.equal(result.body.data[0].official_result.result_card_number, 'RC-OFFICIAL-10');
});

test('published non-terminal pass authorizes one atomic promotion and pins immutable evidence', async t => {
  const { f } = setupOutcome(t, { policyKind: 'non_terminal', academicStatusCode: 'pass' });
  const preview = await api(f, 'owner', 'POST', '/api/student-enrollments/promotion/preview', promotedBody());
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  assert.equal(preview.body.data.official_result.required_action, 'promoted');

  const executed = await api(f, 'owner', 'POST', '/api/student-enrollments/promotion', promotedBody());
  assert.equal(executed.status, 200, JSON.stringify(executed.body));
  assert.equal(executed.body.data.already_applied, false);
  assert.deepEqual(
    { ...f.db.prepare('SELECT status,promotion_status FROM student_enrollments WHERE id=10').get() },
    { status: 'completed', promotion_status: 'promoted' },
  );
  assert.deepEqual(
    { ...f.db.prepare('SELECT academic_year_id,class_id,section_id,status FROM student_enrollments WHERE student_id=10 AND academic_year_id=4').get() },
    { academic_year_id: 4, class_id: 2, section_id: null, status: 'active' },
  );
  assert.deepEqual(
    { ...f.db.prepare('SELECT result_card_id,result_card_publication_revision,decision_action FROM student_promotion_result_decisions').get() },
    { result_card_id: 10, result_card_publication_revision: 1, decision_action: 'promoted' },
  );
  assert.throws(() => f.db.exec("UPDATE student_promotion_result_decisions SET decision_action='repeated'"), /immutable/);
  assert.throws(() => f.db.exec('DELETE FROM student_promotion_result_decisions'), /immutable/);
  assert.throws(() => f.db.exec("UPDATE result_cards SET card_number='RC-TAMPERED' WHERE id=10"), /official_result_evidence_immutable/);
  assert.equal(f.db.prepare('SELECT status FROM student_promotion_result_readiness WHERE school_id=1').get().status, 'healthy');

  const retry = await api(f, 'owner', 'POST', '/api/student-enrollments/promotion', promotedBody());
  assert.equal(retry.status, 200, JSON.stringify(retry.body));
  assert.equal(retry.body.data.already_applied, true);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM student_promotion_result_decisions').get().count, 1);

  const wrongRetry = await api(f, 'owner', 'POST', '/api/student-enrollments/promotion', promotedBody({
    official_result_card_id: 999,
  }));
  assert.equal(wrongRetry.status, 409, JSON.stringify(wrongRetry.body));
  assert.equal(wrongRetry.body.code, 'official_result_stale');

  const withdrawal = await api(f, 'owner', 'PUT', '/api/result-cards/10/withdraw', {
    school_id: 1,
    expected_revision: 1,
    reason: 'محاولة سحب بعد اعتماد القرار',
  });
  assert.equal(withdrawal.status, 409);
  assert.equal(withdrawal.body.code, 'official_result_already_applied');

  f.db.exec('DELETE FROM student_enrollments WHERE student_id=10 AND academic_year_id=4');
  assert.equal(
    f.db.prepare('SELECT status FROM student_promotion_result_readiness WHERE school_id=1').get().status,
    'inconsistent',
  );
});

test('terminal pass graduates, fail repeats, and mismatched manual actions fail closed', async t => {
  await t.test('terminal pass', async t2 => {
    const { f } = setupOutcome(t2, { policyKind: 'terminal', academicStatusCode: 'pass' });
    const decision = await api(f, 'owner', 'POST', '/api/student-enrollments/promotion/official-decisions', { school_id: 1, source_enrollment_ids: [10] });
    assert.equal(decision.body.data[0].required_action, 'graduated');
    const wrong = await api(f, 'owner', 'POST', '/api/student-enrollments/promotion/preview', promotedBody());
    assert.equal(wrong.status, 409);
    assert.equal(wrong.body.code, 'official_result_action_mismatch');
    const graduated = await api(f, 'owner', 'POST', '/api/student-enrollments/promotion', {
      school_id: 1,
      source_enrollment_id: 10,
      action: 'graduated',
      official_result_card_id: 10,
      official_result_publication_revision: 1,
    });
    assert.equal(graduated.status, 200, JSON.stringify(graduated.body));
    assert.equal(f.db.prepare('SELECT promotion_status FROM student_enrollments WHERE id=10').get().promotion_status, 'graduated');
  });

  await t.test('fail', async t2 => {
    const { f } = setupOutcome(t2, { policyKind: 'non_terminal', academicStatusCode: 'fail' });
    const repeated = await api(f, 'owner', 'POST', '/api/student-enrollments/promotion', promotedBody({
      action: 'repeated',
      target_class_id: 1,
      target_section_id: 1,
    }));
    assert.equal(repeated.status, 200, JSON.stringify(repeated.body));
    assert.equal(f.db.prepare('SELECT promotion_status FROM student_enrollments WHERE id=10').get().promotion_status, 'repeated');
  });
});

test('draft, completion, incomplete, undocumented and stale results cannot finalize enrollment', async t => {
  const scenarios = [
    { name: 'draft', values: { publicationStatus: 'draft' }, code: 'official_result_not_published' },
    { name: 'completion', values: { academicStatusCode: 'completion' }, code: 'official_result_completion_pending' },
    { name: 'incomplete', values: { academicStatusCode: 'incomplete' }, code: 'official_result_incomplete' },
  ];
  for (const scenario of scenarios) {
    await t.test(scenario.name, async t2 => {
      const { f } = setupOutcome(t2, scenario.values);
      const response = await api(f, 'owner', 'POST', '/api/student-enrollments/promotion/preview', promotedBody());
      assert.equal(response.status, 409);
      assert.equal(response.body.code, scenario.code);
      assert.equal(f.db.prepare('SELECT status FROM student_enrollments WHERE id=10').get().status, 'active');
    });
  }

  await t.test('stale revision', async t2 => {
    const { f } = setupOutcome(t2);
    const response = await api(f, 'owner', 'POST', '/api/student-enrollments/promotion', promotedBody({
      official_result_publication_revision: 0,
    }));
    assert.equal(response.status, 409);
    assert.equal(response.body.code, 'official_result_stale');
    assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM student_promotion_result_decisions').get().count, 0);
  });
});

test('database trigger blocks any direct transition without a pinned published result', t => {
  const { f } = setupOutcome(t);
  assert.throws(() => f.db.exec("UPDATE student_enrollments SET status='completed',promotion_status='promoted' WHERE id=10"), /official_result_required/);
  assert.deepEqual(
    { ...f.db.prepare('SELECT status,promotion_status FROM student_enrollments WHERE id=10').get() },
    { status: 'active', promotion_status: 'pending' },
  );
});

test('single execution rolls back its decision if a later enrollment appears after preview', async t => {
  const { f } = setupOutcome(t);
  const preview = await api(f, 'owner', 'POST', '/api/student-enrollments/promotion/preview', promotedBody());
  assert.equal(preview.status, 200, JSON.stringify(preview.body));

  f.d1.beforeWrite = () => {
    f.db.exec(`
      INSERT INTO student_enrollments(
        id,school_id,student_id,academic_year_id,class_id,section_id,status,promotion_status,
        created_by_user_id,updated_by_user_id
      ) VALUES(12,1,10,4,2,NULL,'active','pending',1,1)
    `);
  };
  const executed = await api(f, 'owner', 'POST', '/api/student-enrollments/promotion', promotedBody());
  assert.equal(executed.status, 409, JSON.stringify(executed.body));
  assert.equal(executed.body.code, 'target_enrollment_conflict');
  assert.deepEqual(
    { ...f.db.prepare('SELECT status,promotion_status FROM student_enrollments WHERE id=10').get() },
    { status: 'active', promotion_status: 'pending' },
  );
  assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM student_promotion_result_decisions').get().count, 0);
});

test('malformed official execution fails as invalid input before any result lookup', async t => {
  const { f } = setupOutcome(t);
  const response = await api(f, 'owner', 'POST', '/api/student-enrollments/promotion', promotedBody({ action: 'manual-pass' }));
  assert.equal(response.status, 400, JSON.stringify(response.body));
  assert.equal(response.body.code, 'invalid_input');
  assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM student_promotion_result_decisions').get().count, 0);
});

test('bulk execution rolls back all students when one result changes after preview', async t => {
  const { f } = setupOutcome(t);
  f.db.exec(`
    INSERT INTO students(id,school_id,student_number,full_name,gender,status,class_id,section_id)
    VALUES(11,1,'PROMO-OFFICIAL-11','Second Official Student','ذكر','active',1,1);
    INSERT INTO student_enrollments(id,school_id,student_id,academic_year_id,class_id,section_id,status,promotion_status,created_by_user_id,updated_by_user_id)
    VALUES(11,1,11,1,1,1,'active','pending',1,1);
  `);
  f.db.prepare(`
    INSERT INTO result_cards(
      id,school_id,student_id,class_id,section_id,academic_year_id,card_number,
      verification_token,verification_hash,student_name_snapshot,card_data_json,
      generated_by_user_id,generated_at,status,publication_status,publication_revision,
      published_at,published_by_user_id
    ) VALUES(11,1,11,1,1,1,'RC-OFFICIAL-11','official-token-11','hash','Second',?,1,1789297000,'active','published',1,1789297100,1)
  `).run(JSON.stringify(snapshot('non_terminal', 'fail')));

  const rows = [
    { source_enrollment_id: 10, action: 'promoted', target_class_id: 2, target_section_id: null, official_result_card_id: 10, official_result_publication_revision: 1 },
    { source_enrollment_id: 11, action: 'repeated', target_class_id: 1, target_section_id: 1, official_result_card_id: 11, official_result_publication_revision: 1 },
  ];
  const body = {
    school_id: 1,
    source_academic_year_id: 1,
    source_class_id: 1,
    source_section_id: 1,
    target_academic_year_id: 4,
    rows,
  };
  const preview = await api(f, 'owner', 'POST', '/api/student-enrollments/promotion/bulk-preview', body);
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  assert.equal(preview.body.data.valid, true);

  f.d1.beforeWrite = () => {
    f.db.exec("UPDATE result_cards SET publication_status='withdrawn',publication_revision=2,status='cancelled',withdrawn_at=1789297200,withdrawn_by_user_id=1,withdrawal_reason='تصحيح متزامن قبل امتلاك الدفعة' WHERE id=11");
  };
  const executed = await api(f, 'owner', 'POST', '/api/student-enrollments/promotion/bulk', body);
  assert.equal(executed.status, 409);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS count FROM student_enrollments WHERE id IN (10,11) AND status='completed'").get().count, 0);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM student_promotion_result_decisions').get().count, 0);
});

test('promotion UI exposes official evidence and removes arbitrary outcome buttons', () => {
  const single = readFileSync(join(root, 'src/modules/studentPromotion/StudentPromotionPage.tsx'), 'utf8');
  const bulk = readFileSync(join(root, 'src/modules/studentPromotion/BulkStudentPromotionPanel.tsx'), 'utf8');
  assert.match(single, /القرار المستخرج من النتيجة الرسمية/);
  assert.match(single, /لا يمكن تغيير نوع القرار يدويًا/);
  assert.match(single, /official_result\.result_card_number/);
  assert.doesNotMatch(single, /\(\['promoted', 'repeated', 'graduated'\]/);
  assert.match(bulk, /استعادة كل القرارات الرسمية الجاهزة/);
  assert.match(bulk, /النتيجة الرسمية/);
  assert.doesNotMatch(bulk, /تعيين الكل مترفعين|تعيين الكل معيدين/);
});
