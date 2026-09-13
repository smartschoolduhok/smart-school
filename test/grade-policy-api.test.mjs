import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';

import { signJWT } from '../src/lib/jwtSecurity.ts';
import { fixture, root } from './helpers/teaching-load-matrix-fixture.mjs';

const vite = await createServer({ root, appType: 'custom', server: { middlewareMode: true, hmr: false } });
const { default: app } = await vite.ssrLoadModule('/src/worker.ts');
after(() => vite.close());

const secret = 'generated-grade-policy-api-test-secret-only';
const tokens = {
  owner: await signJWT({ email: 'owner@matrix.test', auth_version: 1 }, secret),
  teacher: await signJWT({ email: 'teacher@matrix.test', auth_version: 1 }, secret),
  admin: await signJWT({ email: 'admin@matrix.test', auth_version: 1 }, secret),
};

function gradeFixture(t) {
  const f = fixture();
  t.after(() => f.db.close());
  f.db.exec(`
    INSERT INTO grade_settings(school_id,updated_by_user_id) VALUES(1,1);
    UPDATE classes SET name='الثالث المتوسط',stage='متوسط' WHERE id=1;
    UPDATE classes SET name='الرابع العلمي',stage='إعدادي' WHERE id=2;
    INSERT INTO subjects(id,school_id,class_id,section_id,name,status,order_index,counts_in_average)
    VALUES(7,1,1,NULL,'Physics','active',4,1),(8,1,2,NULL,'Chemistry','active',2,1);
    INSERT INTO students(id,school_id,student_number,full_name,gender,status,class_id,section_id)
    VALUES(1,1,'T-1','Terminal Student','ذكر','active',1,1),
          (2,1,'N-1','Non-terminal Student','أنثى','active',2,NULL);
    INSERT INTO student_enrollments(
      school_id,student_id,academic_year_id,class_id,section_id,status,created_by_user_id,updated_by_user_id
    ) VALUES(1,1,1,1,1,'active',1,1),(1,2,1,2,NULL,'active',1,1);
    INSERT INTO student_subjects(id,school_id,student_id,subject_id,class_id,section_id,is_active,assigned_by_user_id)
    VALUES(101,1,1,1,1,1,1,1),(102,1,1,2,1,1,1,1),(103,1,1,3,1,1,1,1),(104,1,1,7,1,1,1,1),
          (105,1,2,4,2,NULL,1,1),(106,1,2,8,2,NULL,1,1);
    INSERT INTO grades(
      id,school_id,student_subject_id,first_month,second_month,mid_year_exam,third_month,fourth_month,
      final_exam,is_active,updated_by_user_id
    ) VALUES
      (101,1,101,44,NULL,44,44,NULL,NULL,1,1),
      (102,1,102,35,NULL,35,35,NULL,NULL,1,1),
      (103,1,103,29,NULL,29,29,NULL,NULL,1,1),
      (104,1,104,46,NULL,46,46,NULL,NULL,1,1),
      (105,1,105,90,NULL,90,90,NULL,NULL,1,1),
      (106,1,106,80,NULL,80,80,NULL,NULL,1,1);
  `);
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

const terminalDraft = {
  school_id: 1,
  academic_year_id: 1,
  class_id: 1,
  policy_kind: 'terminal',
  pass_mark: 50,
  decision_points: 10,
  decision_allocation_mode: 'optimal',
  decision_points_outcome_only: 1,
  max_completion_subjects: 3,
  exemption_enabled: 0,
  individual_exemption_grade: 90,
  general_exemption_average_grade: 85,
  general_exemption_min_subject_grade: 75,
  ministerial_entry_mode: 'pass_or_completion',
  ministerial_max_failed_subjects: 3,
  minimum_monthly_exams_per_term: 1,
  fraction_rounding_mode: 'ceil',
  source_reference: 'وزارة التربية / ضوابط 2026-2027 التجريبية',
};

const nonTerminalDraft = {
  ...terminalDraft,
  class_id: 2,
  policy_kind: 'non_terminal',
  decision_points: 5,
  exemption_enabled: 1,
  ministerial_entry_mode: 'none',
  ministerial_max_failed_subjects: 0,
};

test('policy lifecycle is tenant-scoped, revision-guarded, logged, locked and amendable', async t => {
  const f = gradeFixture(t);
  assert.equal((await api(f, 'teacher', 'POST', '/api/grade-policies', terminalDraft)).status, 403);

  const created = await api(f, 'owner', 'POST', '/api/grade-policies', {
    ...terminalDraft,
    source_reference: '',
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.data.status, 'draft');
  assert.equal(created.body.data.version, 1);

  const duplicate = await api(f, 'owner', 'POST', '/api/grade-policies', terminalDraft);
  assert.equal(duplicate.status, 409);

  const missingReferenceApproval = await api(f, 'owner', 'POST', `/api/grade-policies/${created.body.data.id}/approve`, {
    school_id: 1,
    revision: created.body.data.revision,
  });
  assert.equal(missingReferenceApproval.status, 400);

  const updated = await api(f, 'owner', 'PUT', `/api/grade-policies/${created.body.data.id}`, {
    school_id: 1,
    revision: created.body.data.revision,
    notes: 'ضوابط دخول سنوية',
    source_reference: terminalDraft.source_reference,
    change_reason: 'استكمال التوثيق',
  });
  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  assert.equal(updated.body.data.revision, 1);

  const stale = await api(f, 'owner', 'PUT', `/api/grade-policies/${created.body.data.id}`, {
    school_id: 1,
    revision: 0,
    notes: 'stale',
  });
  assert.equal(stale.status, 409);

  const approved = await api(f, 'owner', 'POST', `/api/grade-policies/${created.body.data.id}/approve`, {
    school_id: 1,
    revision: updated.body.data.revision,
    change_reason: 'اعتماد القرار',
  });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.data.status, 'approved');

  const locked = await api(f, 'owner', 'POST', `/api/grade-policies/${created.body.data.id}/lock`, {
    school_id: 1,
    revision: approved.body.data.revision,
    change_reason: 'قفل النتائج',
  });
  assert.equal(locked.status, 200, JSON.stringify(locked.body));
  assert.equal(locked.body.data.status, 'locked');

  const deniedEdit = await api(f, 'owner', 'PUT', `/api/grade-policies/${created.body.data.id}`, {
    school_id: 1,
    revision: locked.body.data.revision,
    decision_points: 20,
  });
  assert.equal(deniedEdit.status, 409);

  const amended = await api(f, 'owner', 'POST', `/api/grade-policies/${created.body.data.id}/amend`, {
    school_id: 1,
    revision: locked.body.data.revision,
    decision_points: 5,
    change_reason: 'كتاب وزاري لاحق',
  });
  assert.equal(amended.status, 201, JSON.stringify(amended.body));
  assert.equal(amended.body.data.version, 2);
  assert.equal(amended.body.data.status, 'draft');
  assert.equal(amended.body.data.decision_points, 5);
  assert.equal(f.db.prepare('SELECT is_current FROM academic_grade_policies WHERE id=?').get(created.body.data.id).is_current, 0);

  const outcomeDuringDraft = await api(f, 'owner', 'GET', '/api/academic-outcomes/students/1?academic_year_id=1');
  assert.equal(outcomeDuringDraft.status, 200, JSON.stringify(outcomeDuringDraft.body));
  assert.equal(outcomeDuringDraft.body.data.policy.id, created.body.data.id);
  assert.equal(outcomeDuringDraft.body.data.policy.status, 'locked');

  const history = await api(f, 'owner', 'GET', `/api/grade-policies/${created.body.data.id}/history`);
  assert.equal(history.status, 200);
  assert.deepEqual(history.body.data.map(row => row.action), ['created', 'amended', 'locked', 'approved', 'updated', 'created']);
  assert.equal(history.body.data[0].policy_version, 2);

  const approvedAmendment = await api(f, 'owner', 'POST', `/api/grade-policies/${amended.body.data.id}/approve`, {
    school_id: 1,
    revision: amended.body.data.revision,
    change_reason: 'اعتماد الكتاب الوزاري اللاحق',
  });
  assert.equal(approvedAmendment.status, 200, JSON.stringify(approvedAmendment.body));
  const outcomeAfterApproval = await api(f, 'owner', 'GET', '/api/academic-outcomes/students/1?academic_year_id=1');
  assert.equal(outcomeAfterApproval.status, 200, JSON.stringify(outcomeAfterApproval.body));
  assert.equal(outcomeAfterApproval.body.data.policy.id, amended.body.data.id);
  assert.equal(outcomeAfterApproval.body.data.policy.version, 2);
});

test('approved policies drive terminal allocation, exemption and student-level analytics', async t => {
  const f = gradeFixture(t);
  const terminal = await api(f, 'owner', 'POST', '/api/grade-policies', terminalDraft);
  const terminalApproved = await api(f, 'owner', 'POST', `/api/grade-policies/${terminal.body.data.id}/approve`, {
    school_id: 1,
    revision: terminal.body.data.revision,
  });
  assert.equal(terminalApproved.status, 200, JSON.stringify(terminalApproved.body));

  const nonTerminal = await api(f, 'owner', 'POST', '/api/grade-policies', nonTerminalDraft);
  const nonTerminalApproved = await api(f, 'owner', 'POST', `/api/grade-policies/${nonTerminal.body.data.id}/approve`, {
    school_id: 1,
    revision: nonTerminal.body.data.revision,
  });
  assert.equal(nonTerminalApproved.status, 200, JSON.stringify(nonTerminalApproved.body));

  const terminalOutcome = await api(f, 'owner', 'GET', '/api/academic-outcomes/students/1?academic_year_id=1');
  assert.equal(terminalOutcome.status, 200, JSON.stringify(terminalOutcome.body));
  assert.equal(terminalOutcome.body.data.outcome.academic_status, 'completion');
  assert.equal(terminalOutcome.body.data.outcome.ministerial_eligibility, 'eligible');
  assert.equal(terminalOutcome.body.data.outcome.decision_points_used, 10);
  assert.deepEqual(
    terminalOutcome.body.data.outcome.subjects.map(row => [row.source_grade, row.decision_points, row.adjusted_grade]),
    [[44, 6, 50], [35, 0, 35], [29, 0, 29], [46, 4, 50]],
  );

  const studentGrades = await api(f, 'owner', 'GET', '/api/students/1/grades');
  assert.equal(studentGrades.status, 200, JSON.stringify(studentGrades.body));
  assert.equal(studentGrades.body.data.settings.minimum_monthly_exams_per_term, 1);
  assert.equal(studentGrades.body.data.academic_policy.id, terminal.body.data.id);
  assert.equal(studentGrades.body.data.academic_outcome.outcome.decision_points_used, 10);

  const cardPreview = await api(f, 'owner', 'POST', '/api/result-cards/preview-student/1', { school_id: 1 });
  assert.equal(cardPreview.status, 200, JSON.stringify(cardPreview.body));
  const cardData = cardPreview.body.data.card.card_data_parsed;
  assert.equal(cardData.schema_version, 5);
  assert.equal(cardData.academic_policy.id, terminal.body.data.id);
  assert.equal(cardData.summary.academic_status, 'مكمل');
  assert.equal(cardData.summary.ministerial_eligibility, 'مؤهل للدخول الوزاري');
  assert.equal(cardData.summary.decision_points_used, 10);
  assert.deepEqual(cardData.subjects.map(row => row.decision_points), [6, 0, 0, 4]);

  const exemptOutcome = await api(f, 'owner', 'GET', '/api/academic-outcomes/students/2?academic_year_id=1');
  assert.equal(exemptOutcome.status, 200, JSON.stringify(exemptOutcome.body));
  assert.equal(exemptOutcome.body.data.outcome.exemption_status, 'general');
  assert.equal(exemptOutcome.body.data.outcome.academic_status, 'pass');

  const summary = await api(f, 'owner', 'GET', '/api/academic-outcomes/summary?school_id=1&academic_year_id=1');
  assert.equal(summary.status, 200, JSON.stringify(summary.body));
  assert.equal(summary.body.data.evaluated_students, 2);
  assert.equal(summary.body.data.pass_count, 1);
  assert.equal(summary.body.data.completion_count, 1);
  assert.equal(summary.body.data.general_exemption_count, 1);
  assert.equal(summary.body.data.ministerial_eligible_count, 1);
  assert.deepEqual(summary.body.data.missing_policy_class_ids, []);
});

test('draft policies are visible but never affect official student outcomes', async t => {
  const f = gradeFixture(t);
  const created = await api(f, 'owner', 'POST', '/api/grade-policies', terminalDraft);
  assert.equal(created.status, 201);
  const list = await api(f, 'teacher', 'GET', '/api/grade-policies?school_id=1&academic_year_id=1');
  assert.equal(list.status, 200);
  assert.equal(list.body.data[0].status, 'draft');
  const outcome = await api(f, 'owner', 'GET', '/api/academic-outcomes/students/1?academic_year_id=1');
  assert.equal(outcome.status, 409);
  assert.equal(outcome.body.code, 'grade_policy_missing');
});

test('manual decision allocations are validated, versioned and preserved without rewriting raw grades', async t => {
  const f = gradeFixture(t);
  const created = await api(f, 'owner', 'POST', '/api/grade-policies', {
    ...terminalDraft,
    decision_allocation_mode: 'manual',
  });
  const approved = await api(f, 'owner', 'POST', `/api/grade-policies/${created.body.data.id}/approve`, {
    school_id: 1,
    revision: created.body.data.revision,
  });
  assert.equal(approved.status, 200);

  const invalidPartial = await api(f, 'owner', 'PUT', `/api/grade-policies/${created.body.data.id}/students/1/decision-points`, {
    school_id: 1,
    expected_version: 0,
    allocations: { 1: 1 },
    reason: 'قرار ناقص',
  });
  assert.equal(invalidPartial.status, 400, JSON.stringify(invalidPartial.body));

  const first = await api(f, 'owner', 'PUT', `/api/grade-policies/${created.body.data.id}/students/1/decision-points`, {
    school_id: 1,
    expected_version: 0,
    allocations: { 1: 6, 7: 4 },
    reason: 'تطبيق عشر درجات وفق الكتاب',
  });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.data.decision_set.version, 1);
  assert.equal(first.body.data.outcome.decision_points_used, 10);
  assert.equal(first.body.data.outcome.ministerial_eligibility, 'eligible');

  const stale = await api(f, 'owner', 'PUT', `/api/grade-policies/${created.body.data.id}/students/1/decision-points`, {
    school_id: 1,
    expected_version: 0,
    allocations: { 1: 6 },
    reason: 'طلب متزامن قديم',
  });
  assert.equal(stale.status, 409);

  const second = await api(f, 'owner', 'PUT', `/api/grade-policies/${created.body.data.id}/students/1/decision-points`, {
    school_id: 1,
    expected_version: 1,
    allocations: { 1: 6 },
    reason: 'تعديل موثق للتوزيع',
  });
  assert.equal(second.status, 200, JSON.stringify(second.body));
  assert.equal(second.body.data.decision_set.version, 2);
  const cardPreview = await api(f, 'owner', 'POST', '/api/result-cards/preview-student/1', { school_id: 1 });
  assert.equal(cardPreview.status, 200, JSON.stringify(cardPreview.body));
  assert.equal(cardPreview.body.data.card.card_data_parsed.decision_point_record.version, 2);
  assert.equal(cardPreview.body.data.card.card_data_parsed.summary.decision_points_used, 6);
  const history = await api(f, 'owner', 'GET', `/api/grade-policies/${created.body.data.id}/students/1/decision-points`);
  assert.equal(history.status, 200);
  assert.deepEqual(history.body.data.map(row => [row.version, row.is_current]), [[2, 1], [1, 0]]);
  assert.throws(() => f.db.prepare('DELETE FROM academic_grade_decision_sets WHERE version=1').run(), /grade_decision_history_preserved/);
  assert.deepEqual(
    { ...f.db.prepare('SELECT first_month,second_month,third_month,fourth_month FROM grades WHERE id=101').get() },
    { first_month: 44, second_month: null, third_month: 44, fourth_month: null },
  );
});
