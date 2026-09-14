import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'vite';

import { signJWT } from '../src/lib/jwtSecurity.ts';
import { fixture, fixtureSQL, root } from './helpers/teaching-load-matrix-fixture.mjs';

const vite = await createServer({ root, appType: 'custom', server: { middlewareMode: true, hmr: false } });
const { default: app } = await vite.ssrLoadModule('/src/worker.ts');
after(() => vite.close());

const secret = 'generated-result-publication-test-secret';
const tokens = {
  owner: await signJWT({ email: 'owner@matrix.test', auth_version: 1 }, secret),
  teacher: await signJWT({ email: 'teacher@matrix.test', auth_version: 1 }, secret),
  parent: await signJWT({ email: 'parent@matrix.test', auth_version: 1 }, secret),
  otherParent: await signJWT({ email: 'other-parent@matrix.test', auth_version: 1 }, secret),
};

const publishedSnapshot = {
  schema_version: 5,
  card_mode: 'complete',
  exam_round: 'الدور الأول',
  decision_note: 'قرار موثق',
  academic_policy: {
    id: 91,
    version: 1,
    status: 'approved',
    policy_kind: 'terminal',
    source_reference: 'وزارة التربية / قرار 2026-2027',
  },
  summary: {
    academic_status_code: 'completion',
    academic_status: 'مكمل',
    overall_result_status: 'مكمل',
    ministerial_eligibility: 'مؤهل للدخول الوزاري',
    exemption_status: 'none',
  },
  visible_columns: [{ key: 'effective_grade', label: 'الدرجة النهائية' }],
  subjects: [{
    subject_id: 1,
    subject_name: 'الرياضيات',
    policy_source_grade: 44,
    decision_points: 6,
    adjusted_grade: 50,
    academic_status: 'pass',
  }],
  decision_point_record: { id: 12, reason: 'internal audit detail', created_by_user_id: 1 },
  generated_by: 1,
};

function publicationFixture(t) {
  const f = fixture();
  t.after(() => f.db.close());
  f.db.exec(`
    INSERT INTO users(id,school_id,full_name,email,role_id,status,auth_version)
    VALUES(8,1,'Parent','parent@matrix.test',8,'active',1),
          (9,1,'Other Parent','other-parent@matrix.test',8,'active',1);
    INSERT INTO students(id,school_id,student_number,full_name,gender,status,class_id,section_id)
    VALUES(1,1,'ST-1','Published Child','ذكر','active',1,1),
          (2,2,'ST-2','Other School Child','أنثى','active',3,3);
    INSERT INTO student_enrollments(
      school_id,student_id,academic_year_id,class_id,section_id,status,created_by_user_id
    ) VALUES(1,1,1,1,1,'active',1),(2,2,3,3,3,'active',2);
    INSERT INTO parent_student_links(school_id,parent_user_id,student_id,status,created_by_user_id)
    VALUES(1,8,1,'active',1);
  `);
  f.db.prepare(`
    INSERT INTO result_cards(
      id,school_id,student_id,class_id,section_id,academic_year_id,
      card_number,verification_token,verification_hash,student_name_snapshot,
      class_name_snapshot,section_name_snapshot,school_name_snapshot,academic_year_snapshot,
      general_exemption_status,overall_result_status,card_data_json,generated_by_user_id,
      generated_at,status,publication_status,publication_revision
    ) VALUES(1,1,1,1,1,1,'RC-1','draft-token','hash','Published Child',
      'Class A','A','A','2026-2027',0,'مكمل',?,1,1789240000,'active','draft',0)
  `).run(JSON.stringify(publishedSnapshot));
  f.db.prepare(`
    INSERT INTO result_cards(
      id,school_id,student_id,class_id,section_id,academic_year_id,
      card_number,verification_token,verification_hash,student_name_snapshot,
      class_name_snapshot,section_name_snapshot,school_name_snapshot,academic_year_snapshot,
      general_exemption_status,overall_result_status,card_data_json,generated_by_user_id,
      generated_at,status,publication_status,publication_revision
    ) VALUES(2,2,2,3,3,3,'RC-2','other-token','hash','Other School Child',
      'Secret Class','Secret Section','Secret School','Other',0,'ناجح',?,2,1789240000,'active','draft',0)
  `).run(JSON.stringify({ ...publishedSnapshot, summary: { ...publishedSnapshot.summary, academic_status: 'ناجح' } }));
  return f;
}

async function api(f, role, method, path, body) {
  const response = await app.request(`http://localhost${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokens[role]}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, { DB: f.d1, JWT_SECRET: secret, APP_ENV: 'test' });
  return { status: response.status, body: await response.json() };
}

async function publicApi(f, path) {
  const response = await app.request(`http://localhost${path}`, {}, {
    DB: f.d1,
    JWT_SECRET: secret,
    APP_ENV: 'test',
  });
  return { status: response.status, body: await response.json() };
}

test('0034 preserves old card values and backfills historical publication state', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  const migrations = readdirSync(join(root, 'migrations')).filter(name => name.endsWith('.sql')).sort();
  for (const name of migrations.filter(name => !name.startsWith('0034_'))) {
    db.exec(readFileSync(join(root, 'migrations', name), 'utf8'));
  }
  db.exec(fixtureSQL);
  db.exec(`
    INSERT INTO students(id,school_id,student_number,full_name,gender,status,class_id,section_id)
    VALUES(1,1,'H-1','Historical','ذكر','active',1,1);
    INSERT INTO result_cards(
      id,school_id,student_id,class_id,section_id,academic_year_id,
      card_number,verification_token,verification_hash,student_name_snapshot,
      card_data_json,generated_by_user_id,generated_at,status,updated_at
    ) VALUES
      (1,1,1,1,1,1,'H-A','legacy-active','hash','Historical','{}',1,100,'active',110),
      (2,1,1,1,1,2,'H-C','legacy-cancelled','hash','Historical','{}',1,80,'cancelled',90);
  `);
  const oldColumns = db.prepare('PRAGMA table_info(result_cards)').all().map(row => row.name);
  const before = db.prepare(`SELECT ${oldColumns.map(name => `"${name}"`).join(',')} FROM result_cards ORDER BY id`).all();
  db.exec(readFileSync(join(root, 'migrations/0034_result_card_publication.sql'), 'utf8'));
  const after = db.prepare(`SELECT ${oldColumns.map(name => `"${name}"`).join(',')} FROM result_cards ORDER BY id`).all();
  assert.deepEqual(after, before);
  assert.deepEqual(
    db.prepare('SELECT id,publication_status,publication_revision,published_at,withdrawn_at FROM result_cards ORDER BY id').all().map(row => ({ ...row })),
    [
      { id: 1, publication_status: 'published', publication_revision: 1, published_at: 100, withdrawn_at: null },
      { id: 2, publication_status: 'withdrawn', publication_revision: 1, published_at: 80, withdrawn_at: 90 },
    ],
  );
  assert.equal(db.prepare('SELECT status FROM result_card_publication_readiness WHERE school_id=1').get().status, 'healthy');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  db.close();
});

test('issued card QR verifies before parent delivery and delivery remains management-only and revision-guarded', async t => {
  const f = publicationFixture(t);
  const draftVerification = await publicApi(f, '/api/verify/result-card/draft-token');
  assert.equal(draftVerification.status, 200);
  assert.equal(draftVerification.body.valid, true);

  const parentBeforeDelivery = await api(f, 'parent', 'GET', '/api/parent/students/1/result-cards');
  assert.equal(parentBeforeDelivery.status, 200);
  assert.equal(parentBeforeDelivery.body.data.cards.length, 0);

  const printedBeforeDelivery = await api(f, 'owner', 'PUT', '/api/result-cards/1/mark-printed', {
    school_id: 1,
  });
  assert.equal(printedBeforeDelivery.status, 200, JSON.stringify(printedBeforeDelivery.body));
  assert.ok(f.db.prepare('SELECT printed_at FROM result_cards WHERE id=1').get().printed_at > 0);

  assert.equal((await api(f, 'teacher', 'PUT', '/api/result-cards/1/publish', {
    school_id: 1,
    expected_revision: 0,
  })).status, 403);
  assert.equal((await api(f, 'owner', 'PUT', '/api/result-cards/2/publish', {
    school_id: 1,
    expected_revision: 0,
  })).status, 403);

  const published = await api(f, 'owner', 'PUT', '/api/result-cards/1/publish', {
    school_id: 1,
    expected_revision: 0,
    note: 'اعتماد لجنة النتائج',
  });
  assert.equal(published.status, 200, JSON.stringify(published.body));
  assert.equal(published.body.data.publication_status, 'published');
  assert.equal(published.body.data.publication_revision, 1);
  assert.deepEqual(
    { ...f.db.prepare('SELECT action,previous_status,new_status,previous_revision,new_revision,reason FROM result_card_publication_logs').get() },
    {
      action: 'published',
      previous_status: 'draft',
      new_status: 'published',
      previous_revision: 0,
      new_revision: 1,
      reason: 'اعتماد لجنة النتائج',
    },
  );

  const repeated = await api(f, 'owner', 'PUT', '/api/result-cards/1/publish', {
    school_id: 1,
    expected_revision: 0,
  });
  assert.equal(repeated.status, 409);
  assert.equal(f.db.prepare('SELECT COUNT(*) count FROM result_card_publication_logs').get().count, 1);

  const verified = await publicApi(f, '/api/verify/result-card/draft-token');
  assert.equal(verified.status, 200);
  assert.equal(verified.body.valid, true);
});

test('parent sees only published linked-child snapshots and no internal audit identity', async t => {
  const f = publicationFixture(t);
  await api(f, 'owner', 'PUT', '/api/result-cards/1/publish', {
    school_id: 1,
    expected_revision: 0,
  });

  const visible = await api(f, 'parent', 'GET', '/api/parent/students/1/result-cards');
  assert.equal(visible.status, 200, JSON.stringify(visible.body));
  assert.equal(visible.body.data.cards.length, 1);
  assert.equal(visible.body.data.cards[0].card.summary.academic_status, 'مكمل');
  assert.equal(visible.body.data.cards[0].card.subjects[0].decision_points, 6);
  assert.equal(visible.body.data.cards[0].card.academic_policy.source_reference, 'وزارة التربية / قرار 2026-2027');
  assert.deepEqual(Object.keys(visible.body.data.cards[0].card.subjects[0]).sort(), [
    'academic_status', 'adjusted_grade', 'decision_points', 'effective_grade',
    'exemption_status', 'final_grade', 'policy_source_grade', 'result_status', 'subject_name',
  ]);
  assert.deepEqual(Object.keys(visible.body.data.cards[0].card.summary).sort(), [
    'academic_status', 'completion_count', 'completion_subject_names', 'decision_points_used',
    'exempt_count', 'exempt_subject_names', 'exemption_status', 'fail_count',
    'failed_subject_names', 'ministerial_eligibility', 'ministerial_eligibility_code',
    'ministerial_reason', 'overall_result_status',
  ]);
  assert.equal(JSON.stringify(visible.body).includes('internal audit detail'), false);
  assert.equal(JSON.stringify(visible.body).includes('created_by_user_id'), false);
  assert.equal(JSON.stringify(visible.body).includes('verification_hash'), false);
  assert.equal(JSON.stringify(visible.body).includes('subject_id'), false);
  assert.equal(JSON.stringify(visible.body).includes('decision_note'), false);

  assert.equal((await api(f, 'otherParent', 'GET', '/api/parent/students/1/result-cards')).status, 404);
  f.db.exec("UPDATE parent_student_links SET status='inactive' WHERE parent_user_id=8 AND student_id=1");
  assert.equal((await api(f, 'parent', 'GET', '/api/parent/students/1/result-cards')).status, 404);
});

test('withdrawal requires a reason, cancels atomically and immediately revokes visibility', async t => {
  const f = publicationFixture(t);
  await api(f, 'owner', 'PUT', '/api/result-cards/1/publish', {
    school_id: 1,
    expected_revision: 0,
  });

  const directCancel = await api(f, 'owner', 'PUT', '/api/result-cards/1/cancel', { school_id: 1 });
  assert.equal(directCancel.status, 409);
  assert.equal(directCancel.body.code, 'published_result_card_requires_withdrawal');
  assert.equal((await api(f, 'owner', 'PUT', '/api/result-cards/1/withdraw', {
    school_id: 1,
    expected_revision: 1,
    reason: '',
  })).status, 400);

  const withdrawn = await api(f, 'owner', 'PUT', '/api/result-cards/1/withdraw', {
    school_id: 1,
    expected_revision: 1,
    reason: 'تصحيح درجة مثبت بمحضر اللجنة',
  });
  assert.equal(withdrawn.status, 200, JSON.stringify(withdrawn.body));
  assert.deepEqual(
    { ...f.db.prepare('SELECT status,publication_status,publication_revision,withdrawal_reason FROM result_cards WHERE id=1').get() },
    {
      status: 'cancelled',
      publication_status: 'withdrawn',
      publication_revision: 2,
      withdrawal_reason: 'تصحيح درجة مثبت بمحضر اللجنة',
    },
  );
  assert.deepEqual(
    f.db.prepare('SELECT action,new_revision FROM result_card_publication_logs ORDER BY id').all().map(row => ({ ...row })),
    [{ action: 'published', new_revision: 1 }, { action: 'withdrawn', new_revision: 2 }],
  );
  const parent = await api(f, 'parent', 'GET', '/api/parent/students/1/result-cards');
  assert.equal(parent.status, 200);
  assert.equal(parent.body.data.cards.length, 0);
  const verification = await publicApi(f, '/api/verify/result-card/draft-token');
  assert.equal(verification.status, 200);
  assert.equal(verification.body.valid, false);
  assert.equal(verification.body.withdrawn, true);
  assert.throws(() => f.db.exec("UPDATE result_card_publication_logs SET reason='tampered'"), /immutable/);
  assert.throws(() => f.db.exec('DELETE FROM result_card_publication_logs'), /immutable/);
});

test('incomplete or undocumented snapshots fail closed and draft cancellation remains separate', async t => {
  const f = publicationFixture(t);
  f.db.prepare('UPDATE result_cards SET card_data_json=? WHERE id=1').run(JSON.stringify({
    ...publishedSnapshot,
    card_mode: 'partial',
  }));
  const incomplete = await api(f, 'owner', 'PUT', '/api/result-cards/1/publish', {
    school_id: 1,
    expected_revision: 0,
  });
  assert.equal(incomplete.status, 409);
  assert.equal(incomplete.body.code, 'result_card_incomplete');

  f.db.prepare('UPDATE result_cards SET card_data_json=? WHERE id=1').run(JSON.stringify({
    ...publishedSnapshot,
    card_mode: 'complete',
    academic_policy: null,
  }));
  const undocumented = await api(f, 'owner', 'PUT', '/api/result-cards/1/publish', {
    school_id: 1,
    expected_revision: 0,
  });
  assert.equal(undocumented.status, 409);
  assert.equal(undocumented.body.code, 'result_card_policy_required');

  const cancelled = await api(f, 'owner', 'PUT', '/api/result-cards/1/cancel', { school_id: 1 });
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
  assert.equal(f.db.prepare('SELECT status,publication_status FROM result_cards WHERE id=1').get().status, 'cancelled');
  assert.equal(f.db.prepare('SELECT status,publication_status FROM result_cards WHERE id=1').get().publication_status, 'draft');
});

test('result publication UI separates review, publish, withdrawal and parent read-only display', () => {
  const management = readFileSync(join(root, 'src/modules/resultCards/ResultCardsPage.tsx'), 'utf8');
  const parent = readFileSync(join(root, 'src/modules/students/ParentResultsSection.tsx'), 'utf8');
  const profile = readFileSync(join(root, 'src/modules/students/StudentProfilePage.tsx'), 'utf8');
  const print = readFileSync(join(root, 'src/modules/print/PrintResultCardPage.tsx'), 'utf8');
  assert.match(management, /الإرسال لولي الأمر/);
  assert.match(management, /handlePublish\(c\)/);
  assert.match(management, /handleWithdraw\(c\)/);
  assert.match(management, /سبب سحب النتيجة من حساب ولي الأمر/);
  assert.match(management, /إرسال لولي الأمر/);
  assert.match(parent, /النتائج المرسلة من المدرسة/);
  assert.match(parent, /الكارت المطبوع للطالب لا يظهر هنا/);
  assert.match(parent, /getParentStudentResultCards\(studentId\)/);
  assert.match(profile, /<ParentResultsSection studentId=\{student\.id\} \/>/);
  assert.match(print, /isResultCardPrintable\(loaded\.status, loaded\.publication_status\)/);
  assert.match(print, /card\?\.status === 'active'/);
  assert.match(print, /shouldRegisterResultCardPrint/);
});
