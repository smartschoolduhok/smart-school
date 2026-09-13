import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { hashPassword } from '../src/lib/authSecurity.ts';

const target = 'smart-school-staging-db';
const targetId = '1bdb9c3d-08d6-4023-9cbc-64369d53198a';
const [previewArgument, evidenceArgument, confirmation] = process.argv.slice(2);
assert.equal(confirmation, '--confirm-staging', 'Explicit --confirm-staging is required');
const preview = new URL(previewArgument);
assert.equal(preview.protocol, 'https:');
assert.ok(
  preview.hostname.endsWith('.smart-school-staging.pages.dev'),
  'Only a staging Pages Preview is allowed',
);
assert.ok(evidenceArgument, 'An evidence JSON path outside the repository is required');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = resolve(evidenceArgument);
assert.ok(
  !evidencePath.toLowerCase().startsWith(`${root.toLowerCase()}\\`),
  'Evidence must remain outside the repository',
);
const wranglerPath = resolve(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const marker = `PH20D-${Date.now()}-${randomBytes(4).toString('hex')}`;
const markerLower = marker.toLowerCase();
const password = randomBytes(24).toString('base64url');
const passwordHash = await hashPassword(password);
const emails = {
  owner: `phase20d.owner.${markerLower}@example.test`,
  teacher: `phase20d.teacher.${markerLower}@example.test`,
  linkedParent: `phase20d.linked-parent.${markerLower}@example.test`,
  otherParent: `phase20d.other-parent.${markerLower}@example.test`,
  otherOwner: `phase20d.other-owner.${markerLower}@example.test`,
};
const sqlText = value => `'${String(value).replaceAll("'", "''")}'`;
const commandEvidence = [];

function executeD1(sql) {
  return spawnSync(process.execPath, [
    wranglerPath,
    'd1',
    'execute',
    target,
    '--remote',
    '--command',
    sql,
    '--json',
  ], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 90_000,
    maxBuffer: 10_000_000,
    env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' },
  });
}

function d1(sql, mode) {
  assert.ok(mode === 'read' || mode === 'write');
  assert.ok(
    !/\b(?:DELETE|DROP|TRUNCATE|VACUUM|REPLACE|ALTER)\b/iu.test(sql),
    'Destructive SQL is forbidden',
  );
  if (mode === 'read') assert.match(sql.trim(), /^(?:SELECT|PRAGMA|WITH)\b/iu);
  if (mode === 'write') assert.match(sql.trim(), /^(?:INSERT|UPDATE)\b/iu);
  const startedAt = Date.now();
  const result = executeD1(sql);
  commandEvidence.push({ mode, exit_code: result.status, duration_ms: Date.now() - startedAt });
  assert.equal(result.status, 0, `D1 ${mode} failed: ${result.stderr || result.stdout}`);
  const parsed = JSON.parse(result.stdout);
  assert.ok(parsed.every(entry => entry.success === true), `D1 ${mode} was not successful`);
  if (mode === 'read') {
    assert.ok(parsed.every(
      entry => entry.meta?.changed_db === false && Number(entry.meta?.rows_written || 0) === 0,
    ));
  }
  return parsed.flatMap(entry => entry.results || []);
}

function d1ExpectedFailure(sql, expectedPattern) {
  assert.match(sql.trim(), /^UPDATE\b/iu);
  assert.ok(
    !/\b(?:DELETE|DROP|TRUNCATE|VACUUM|REPLACE|ALTER)\b/iu.test(sql),
    'Destructive SQL is forbidden',
  );
  const startedAt = Date.now();
  const result = executeD1(sql);
  commandEvidence.push({
    mode: 'expected_write_rejection',
    exit_code: result.status,
    duration_ms: Date.now() - startedAt,
  });
  assert.notEqual(result.status, 0, 'The immutable audit-log UPDATE unexpectedly succeeded');
  assert.match(`${result.stderr}\n${result.stdout}`, expectedPattern);
}

async function request(path, { method = 'GET', token, body } = {}) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(new URL(path, preview), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { /* asserted by callers */ }
  return { status: response.status, payload };
}

async function api(path, { method = 'GET', token, body, expected = 200 } = {}) {
  const result = await request(path, { method, token, body });
  assert.equal(
    result.status,
    expected,
    `${method} ${path}: ${result.status} ${result.payload?.code || result.payload?.error || 'invalid response'}`,
  );
  return result.payload;
}

let context = null;
let identifiers = null;
let ownerToken = null;
let cardId = null;
let qa = {};
let functionalPass = false;
let cleanupPass = false;
let failure = null;
let auditBefore = null;
let auditAfter = null;

try {
  context = d1(`
    SELECT school.id AS school_id, year.id AS academic_year_id,
           (SELECT other.id FROM schools other
            WHERE other.id!=school.id AND other.status='active'
            ORDER BY other.id LIMIT 1) AS other_school_id
    FROM schools school
    JOIN academic_years year ON year.school_id=school.id AND year.is_active=1
    JOIN grade_settings settings ON settings.school_id=school.id
    JOIN finance_fee_readiness fee ON fee.school_id=school.id AND fee.healthy=1
    JOIN finance_treasury_readiness treasury ON treasury.school_id=school.id AND treasury.healthy=1
    JOIN finance_payroll_school_readiness payroll ON payroll.school_id=school.id AND payroll.healthy=1
    JOIN result_card_publication_readiness publication
      ON publication.school_id=school.id AND publication.status='healthy'
    WHERE school.status='active'
    ORDER BY school.id LIMIT 1
  `, 'read')[0];
  assert.ok(
    context?.school_id && context?.academic_year_id && context?.other_school_id,
    'No isolated STAGING QA context is available',
  );
  const schoolId = Number(context.school_id);
  const yearId = Number(context.academic_year_id);
  const otherSchoolId = Number(context.other_school_id);
  const className = `${marker} Publication`;
  const sectionName = `${marker} Section`;
  const studentNumber = `${marker}-STUDENT`;

  const readinessBefore = {
    academic: d1('SELECT * FROM academic_grade_policy_readiness ORDER BY school_id', 'read'),
    fee: d1('SELECT * FROM finance_fee_readiness ORDER BY school_id', 'read'),
    payroll: d1('SELECT * FROM finance_payroll_readiness ORDER BY school_id', 'read'),
    payrollSchool: d1('SELECT * FROM finance_payroll_school_readiness ORDER BY school_id', 'read'),
    treasury: d1('SELECT * FROM finance_treasury_readiness ORDER BY school_id', 'read'),
  };

  d1(`
    INSERT INTO users(
      school_id,full_name,email,password_hash,role_id,status,auth_version,created_at,updated_at
    ) VALUES
      (${schoolId},${sqlText(`${marker} Owner`)},${sqlText(emails.owner)},${sqlText(passwordHash)},(SELECT id FROM roles WHERE key='school_owner'),'active',1,unixepoch(),unixepoch()),
      (${schoolId},${sqlText(`${marker} Teacher`)},${sqlText(emails.teacher)},${sqlText(passwordHash)},(SELECT id FROM roles WHERE key='teacher'),'active',1,unixepoch(),unixepoch()),
      (${schoolId},${sqlText(`${marker} Linked Parent`)},${sqlText(emails.linkedParent)},${sqlText(passwordHash)},(SELECT id FROM roles WHERE key='parent'),'active',1,unixepoch(),unixepoch()),
      (${schoolId},${sqlText(`${marker} Other Parent`)},${sqlText(emails.otherParent)},${sqlText(passwordHash)},(SELECT id FROM roles WHERE key='parent'),'active',1,unixepoch(),unixepoch()),
      (${otherSchoolId},${sqlText(`${marker} Other Owner`)},${sqlText(emails.otherOwner)},${sqlText(passwordHash)},(SELECT id FROM roles WHERE key='school_owner'),'active',1,unixepoch(),unixepoch());
    INSERT INTO classes(school_id,name,stage,order_index,status,created_at,updated_at)
    VALUES(${schoolId},${sqlText(className)},'QA',951,'active',unixepoch(),unixepoch())
  `, 'write');

  const users = d1(`
    SELECT id,email FROM users
    WHERE email IN (${Object.values(emails).map(sqlText).join(',')}) ORDER BY id
  `, 'read');
  const userByEmail = Object.fromEntries(users.map(row => [row.email, Number(row.id)]));
  const classId = Number(d1(`
    SELECT id FROM classes WHERE school_id=${schoolId} AND name=${sqlText(className)}
  `, 'read')[0]?.id);
  assert.equal(users.length, 5);
  assert.ok(classId > 0);

  d1(`
    INSERT INTO sections(school_id,class_id,name,capacity,status,created_at,updated_at)
    VALUES(${schoolId},${classId},${sqlText(sectionName)},5,'active',unixepoch(),unixepoch());
    INSERT INTO subjects(
      school_id,class_id,section_id,name,subject_type,counts_in_average,
      appears_in_report_card,passing_grade,exemption_grade,order_index,status,created_at,updated_at
    ) VALUES
      (${schoolId},${classId},NULL,${sqlText(`${marker} Subject 1`)},'أساسية',1,1,50,90,1,'active',unixepoch(),unixepoch()),
      (${schoolId},${classId},NULL,${sqlText(`${marker} Subject 2`)},'أساسية',1,1,50,90,2,'active',unixepoch(),unixepoch())
  `, 'write');

  const sectionId = Number(d1(`
    SELECT id FROM sections WHERE school_id=${schoolId} AND name=${sqlText(sectionName)}
  `, 'read')[0]?.id);
  const subjectRows = d1(`
    SELECT id FROM subjects WHERE school_id=${schoolId} AND class_id=${classId}
      AND name LIKE ${sqlText(`${marker}%`)} ORDER BY order_index,id
  `, 'read');
  assert.ok(sectionId > 0);
  assert.equal(subjectRows.length, 2);

  d1(`
    INSERT INTO students(
      school_id,student_number,full_name,gender,class_id,section_id,status,notes,created_at,updated_at
    ) VALUES(
      ${schoolId},${sqlText(studentNumber)},${sqlText(`${marker} Student`)},'ذكر',
      ${classId},${sectionId},'active',${sqlText(marker)},unixepoch(),unixepoch()
    )
  `, 'write');
  const studentId = Number(d1(`
    SELECT id FROM students WHERE school_id=${schoolId} AND student_number=${sqlText(studentNumber)}
  `, 'read')[0]?.id);
  assert.ok(studentId > 0);

  d1(`
    INSERT INTO student_enrollments(
      school_id,student_id,academic_year_id,class_id,section_id,status,promotion_status,
      created_by_user_id,updated_by_user_id,created_at,updated_at
    ) VALUES(
      ${schoolId},${studentId},${yearId},${classId},${sectionId},'active','pending',
      ${userByEmail[emails.owner]},${userByEmail[emails.owner]},unixepoch(),unixepoch()
    );
    INSERT INTO student_subjects(
      school_id,student_id,subject_id,class_id,section_id,is_active,
      assigned_by_user_id,notes,created_at,updated_at
    ) VALUES
      (${schoolId},${studentId},${Number(subjectRows[0].id)},${classId},${sectionId},1,${userByEmail[emails.owner]},${sqlText(marker)},unixepoch(),unixepoch()),
      (${schoolId},${studentId},${Number(subjectRows[1].id)},${classId},${sectionId},1,${userByEmail[emails.owner]},${sqlText(marker)},unixepoch(),unixepoch());
    INSERT INTO parent_student_links(
      school_id,parent_user_id,student_id,relationship,status,created_by_user_id,created_at,updated_at
    ) VALUES(
      ${schoolId},${userByEmail[emails.linkedParent]},${studentId},'QA','active',
      ${userByEmail[emails.owner]},unixepoch(),unixepoch()
    )
  `, 'write');

  const assignments = d1(`
    SELECT assignment.id
    FROM student_subjects assignment
    JOIN subjects subject ON subject.id=assignment.subject_id
    WHERE assignment.school_id=${schoolId} AND assignment.student_id=${studentId}
    ORDER BY subject.order_index,subject.id
  `, 'read');
  assert.equal(assignments.length, 2);
  d1(`
    INSERT INTO grades(
      school_id,student_subject_id,first_month,second_month,mid_year_exam,
      third_month,fourth_month,final_exam,completion_exam,is_active,
      updated_by_user_id,notes,first_term_grade,second_term_grade
    ) VALUES
      (${schoolId},${Number(assignments[0].id)},70,NULL,70,70,NULL,70,NULL,1,${userByEmail[emails.owner]},${sqlText(marker)},70,70),
      (${schoolId},${Number(assignments[1].id)},80,NULL,80,80,NULL,80,NULL,1,${userByEmail[emails.owner]},${sqlText(marker)},80,80)
  `, 'write');

  identifiers = {
    school_id: schoolId,
    academic_year_id: yearId,
    other_school_id: otherSchoolId,
    class_id: classId,
    section_id: sectionId,
    student_id: studentId,
    subject_ids: subjectRows.map(row => Number(row.id)),
    user_ids: userByEmail,
  };

  const loginPairs = await Promise.all(Object.entries(emails).map(async ([key, email]) => [
    key,
    await api('/api/auth/login', { method: 'POST', body: { email, password } }),
  ]));
  const logins = Object.fromEntries(loginPairs);
  ownerToken = logins.owner.data.token;
  const teacherToken = logins.teacher.data.token;
  const linkedParentToken = logins.linkedParent.data.token;
  const otherParentToken = logins.otherParent.data.token;
  const otherOwnerToken = logins.otherOwner.data.token;
  assert.deepEqual(
    [
      logins.owner.data.user.role_key,
      logins.teacher.data.user.role_key,
      logins.linkedParent.data.user.role_key,
      logins.otherParent.data.user.role_key,
      logins.otherOwner.data.user.role_key,
    ],
    ['school_owner', 'teacher', 'parent', 'parent', 'school_owner'],
  );

  const policyBody = {
    school_id: schoolId,
    academic_year_id: yearId,
    class_id: classId,
    policy_kind: 'terminal',
    pass_mark: 50,
    decision_points: 0,
    decision_allocation_mode: 'optimal',
    decision_points_outcome_only: 1,
    max_completion_subjects: 2,
    exemption_enabled: 0,
    individual_exemption_grade: 90,
    general_exemption_average_grade: 85,
    general_exemption_min_subject_grade: 75,
    ministerial_entry_mode: 'pass_or_completion',
    ministerial_max_failed_subjects: 2,
    minimum_monthly_exams_per_term: 1,
    fraction_rounding_mode: 'ceil',
    source_reference: `${marker} documented annual policy`,
    notes: marker,
  };
  await api('/api/grade-policies', {
    method: 'POST', token: teacherToken, body: policyBody, expected: 403,
  });
  const draftPolicy = await api('/api/grade-policies', {
    method: 'POST', token: ownerToken, body: policyBody, expected: 201,
  });
  const approvedPolicy = await api(`/api/grade-policies/${draftPolicy.data.id}/approve`, {
    method: 'POST',
    token: ownerToken,
    body: {
      school_id: schoolId,
      revision: draftPolicy.data.revision,
      change_reason: `${marker} approve for publication QA`,
    },
  });
  identifiers.policy_id = Number(approvedPolicy.data.id);

  const generated = await api(`/api/result-cards/generate-student/${studentId}`, {
    method: 'POST', token: ownerToken, body: { school_id: schoolId },
  });
  cardId = Number(generated.data.card.id);
  assert.ok(cardId > 0);
  identifiers.result_card_id = cardId;
  const initialCard = d1(`
    SELECT id,status,publication_status,publication_revision,verification_token,card_data_json
    FROM result_cards WHERE id=${cardId} AND school_id=${schoolId}
  `, 'read')[0];
  assert.deepEqual(
    [initialCard.status, initialCard.publication_status, Number(initialCard.publication_revision)],
    ['active', 'draft', 0],
  );
  const verificationToken = String(initialCard.verification_token);
  const originalSnapshot = JSON.parse(String(initialCard.card_data_json));
  assert.equal(originalSnapshot.card_mode, 'complete');
  assert.ok(['approved', 'locked'].includes(originalSnapshot.academic_policy?.status));
  assert.ok(String(originalSnapshot.academic_policy?.source_reference || '').trim());
  qa.new_result_card_begins_as_draft = true;

  const draftParent = await api(`/api/parent/students/${studentId}/result-cards`, {
    token: linkedParentToken,
  });
  assert.deepEqual(draftParent.data.cards, []);
  const draftPublic = await api(`/api/verify/result-card/${encodeURIComponent(verificationToken)}`, {
    expected: 404,
  });
  assert.deepEqual([draftPublic.valid, draftPublic.unpublished], [false, true]);
  await api(`/api/result-cards/${cardId}/mark-printed`, {
    method: 'PUT', token: ownerToken, body: { school_id: schoolId }, expected: 400,
  });
  qa.draft_invisible_and_official_print_blocked = true;

  const incompleteSnapshot = { ...originalSnapshot, card_mode: 'partial' };
  d1(`
    UPDATE result_cards SET card_data_json=${sqlText(JSON.stringify(incompleteSnapshot))},updated_at=unixepoch()
    WHERE id=${cardId} AND school_id=${schoolId} AND publication_status='draft'
  `, 'write');
  const incompletePublish = await api(`/api/result-cards/${cardId}/publish`, {
    method: 'PUT',
    token: ownerToken,
    body: { school_id: schoolId, expected_revision: 0 },
    expected: 409,
  });
  assert.equal(incompletePublish.code, 'result_card_incomplete');
  qa.incomplete_result_publication_rejected = true;

  const undocumentedSnapshot = {
    ...originalSnapshot,
    academic_policy: {
      ...(originalSnapshot.academic_policy || {}),
      status: 'draft',
      source_reference: '',
    },
  };
  d1(`
    UPDATE result_cards SET card_data_json=${sqlText(JSON.stringify(undocumentedSnapshot))},updated_at=unixepoch()
    WHERE id=${cardId} AND school_id=${schoolId} AND publication_status='draft'
  `, 'write');
  const undocumentedPublish = await api(`/api/result-cards/${cardId}/publish`, {
    method: 'PUT',
    token: ownerToken,
    body: { school_id: schoolId, expected_revision: 0 },
    expected: 409,
  });
  assert.equal(undocumentedPublish.code, 'result_card_policy_required');
  qa.undocumented_or_unapproved_policy_publication_rejected = true;

  d1(`
    UPDATE result_cards SET card_data_json=${sqlText(JSON.stringify(originalSnapshot))},updated_at=unixepoch()
    WHERE id=${cardId} AND school_id=${schoolId} AND publication_status='draft'
  `, 'write');
  await api(`/api/result-cards/${cardId}/publish`, {
    method: 'PUT', token: teacherToken,
    body: { school_id: schoolId, expected_revision: 0 }, expected: 403,
  });

  const concurrentPublication = await Promise.all([
    request(`/api/result-cards/${cardId}/publish`, {
      method: 'PUT', token: ownerToken,
      body: { school_id: schoolId, expected_revision: 0, note: `${marker} concurrent A` },
    }),
    request(`/api/result-cards/${cardId}/publish`, {
      method: 'PUT', token: ownerToken,
      body: { school_id: schoolId, expected_revision: 0, note: `${marker} concurrent B` },
    }),
  ]);
  assert.deepEqual(
    concurrentPublication.map(result => result.status).sort((a, b) => a - b),
    [200, 409],
  );
  const rejectedPublication = concurrentPublication.find(result => result.status === 409);
  assert.ok([
    'result_card_publication_stale',
    'result_card_publication_invalid_transition',
  ].includes(rejectedPublication.payload?.code));
  const publishedCard = d1(`
    SELECT status,publication_status,publication_revision,published_at,published_by_user_id
    FROM result_cards WHERE id=${cardId}
  `, 'read')[0];
  assert.deepEqual(
    [publishedCard.status, publishedCard.publication_status, Number(publishedCard.publication_revision)],
    ['active', 'published', 1],
  );
  assert.ok(Number(publishedCard.published_at) > 0);
  assert.equal(Number(publishedCard.published_by_user_id), userByEmail[emails.owner]);
  assert.equal(Number(d1(`
    SELECT COUNT(*) AS count FROM result_card_publication_logs
    WHERE result_card_id=${cardId} AND action='published'
  `, 'read')[0].count), 1);
  qa.valid_complete_result_publishes_once_under_concurrency = true;

  const linkedPublished = await api(`/api/parent/students/${studentId}/result-cards`, {
    token: linkedParentToken,
  });
  assert.equal(linkedPublished.data.cards.length, 1);
  assert.equal(Number(linkedPublished.data.cards[0].id), cardId);
  assert.equal('card_data_json' in linkedPublished.data.cards[0], false);
  await api(`/api/parent/students/${studentId}/result-cards`, {
    token: otherParentToken, expected: 404,
  });
  await api(`/api/parent/students/${studentId}/result-cards`, {
    token: teacherToken, expected: 403,
  });
  await api(`/api/result-cards/${cardId}?school_id=${otherSchoolId}`, {
    token: otherOwnerToken, expected: 403,
  });
  qa.linked_parent_only_and_tenant_role_restrictions = true;

  const publishedPublic = await api(`/api/verify/result-card/${encodeURIComponent(verificationToken)}`);
  assert.equal(publishedPublic.valid, true);
  assert.equal(publishedPublic.card_mode, 'complete');
  assert.equal('card_data_json' in publishedPublic, false);
  await api(`/api/result-cards/${cardId}/mark-printed`, {
    method: 'PUT', token: ownerToken, body: { school_id: schoolId },
  });
  const printed = d1(`SELECT printed_at FROM result_cards WHERE id=${cardId}`, 'read')[0];
  assert.ok(Number(printed.printed_at) > 0);
  qa.public_verification_and_official_print_after_publication = true;

  const directCancel = await api(`/api/result-cards/${cardId}/cancel`, {
    method: 'PUT', token: ownerToken, body: { school_id: schoolId }, expected: 409,
  });
  assert.equal(directCancel.code, 'published_result_card_requires_withdrawal');
  await api(`/api/result-cards/${cardId}/withdraw`, {
    method: 'PUT', token: ownerToken,
    body: { school_id: schoolId, expected_revision: 1, reason: '' }, expected: 400,
  });
  const staleWithdrawal = await api(`/api/result-cards/${cardId}/withdraw`, {
    method: 'PUT', token: ownerToken,
    body: { school_id: schoolId, expected_revision: 0, reason: `${marker} stale` },
    expected: 409,
  });
  assert.equal(staleWithdrawal.code, 'result_card_publication_stale');
  const withdrawalReason = `${marker} isolated QA withdrawal`;
  const withdrawn = await api(`/api/result-cards/${cardId}/withdraw`, {
    method: 'PUT', token: ownerToken,
    body: { school_id: schoolId, expected_revision: 1, reason: withdrawalReason },
  });
  assert.deepEqual(
    [withdrawn.data.status, withdrawn.data.publication_status, withdrawn.data.publication_revision],
    ['cancelled', 'withdrawn', 2],
  );
  assert.equal(withdrawn.data.withdrawal_reason, withdrawalReason);
  qa.withdrawal_reason_required_stale_guard_and_direct_cancel_rejected = true;

  const linkedWithdrawn = await api(`/api/parent/students/${studentId}/result-cards`, {
    token: linkedParentToken,
  });
  assert.deepEqual(linkedWithdrawn.data.cards, []);
  const withdrawnPublic = await api(`/api/verify/result-card/${encodeURIComponent(verificationToken)}`);
  assert.deepEqual(
    [withdrawnPublic.valid, withdrawnPublic.cancelled, withdrawnPublic.withdrawn],
    [false, true, true],
  );
  await api(`/api/result-cards/${cardId}/mark-printed`, {
    method: 'PUT', token: ownerToken, body: { school_id: schoolId }, expected: 400,
  });
  qa.withdrawal_immediately_revokes_parent_public_and_print_visibility = true;

  auditBefore = d1(`
    SELECT id,action,previous_status,new_status,previous_revision,new_revision,reason,actor_user_id,created_at
    FROM result_card_publication_logs WHERE result_card_id=${cardId} ORDER BY id
  `, 'read');
  assert.deepEqual(auditBefore.map(row => row.action), ['published', 'withdrawn']);
  assert.deepEqual(auditBefore.map(row => [Number(row.previous_revision), Number(row.new_revision)]), [[0, 1], [1, 2]]);
  assert.equal(auditBefore[1].reason, withdrawalReason);
  d1ExpectedFailure(`
    UPDATE result_card_publication_logs SET reason=${sqlText(`${marker} forbidden mutation`)}
    WHERE id=${Number(auditBefore[0].id)}
  `, /result_card_publication_log_immutable/iu);
  auditAfter = d1(`
    SELECT id,action,previous_status,new_status,previous_revision,new_revision,reason,actor_user_id,created_at
    FROM result_card_publication_logs WHERE result_card_id=${cardId} ORDER BY id
  `, 'read');
  assert.deepEqual(auditAfter, auditBefore);
  assert.equal(Number(d1(`
    SELECT COUNT(*) AS count FROM result_card_publication_write_assertions
    WHERE result_card_id=${cardId}
  `, 'read')[0].count), 0);
  qa.audit_logs_immutable_and_no_duplicate_transitions = true;

  identifiers.readiness_before = readinessBefore;
  functionalPass = Object.values(qa).every(Boolean);
} catch (error) {
  failure = error;
} finally {
  const schoolId = Number(context?.school_id || 0);
  if (schoolId > 0) {
    if (cardId && ownerToken) {
      const card = d1(`
        SELECT publication_status,publication_revision FROM result_cards WHERE id=${cardId}
      `, 'read')[0];
      if (card?.publication_status === 'published') {
        try {
          await api(`/api/result-cards/${cardId}/withdraw`, {
            method: 'PUT',
            token: ownerToken,
            body: {
              school_id: schoolId,
              expected_revision: Number(card.publication_revision),
              reason: `${marker} safety cleanup after QA interruption`,
            },
          });
        } catch (cleanupError) {
          failure ||= cleanupError;
        }
      }
    }
    try {
      d1(`
        UPDATE grades SET is_active=0,updated_at=unixepoch()
        WHERE school_id=${schoolId} AND student_subject_id IN (
          SELECT assignment.id FROM student_subjects assignment
          JOIN students student ON student.id=assignment.student_id
          WHERE assignment.school_id=${schoolId}
            AND student.student_number LIKE ${sqlText(`${marker}%`)}
        );
        UPDATE student_subjects SET is_active=0,removed_at=unixepoch(),updated_at=unixepoch()
        WHERE school_id=${schoolId} AND student_id IN (
          SELECT id FROM students WHERE school_id=${schoolId}
            AND student_number LIKE ${sqlText(`${marker}%`)}
        );
        UPDATE student_enrollments SET status='cancelled',completed_at=unixepoch(),updated_at=unixepoch()
        WHERE school_id=${schoolId} AND student_id IN (
          SELECT id FROM students WHERE school_id=${schoolId}
            AND student_number LIKE ${sqlText(`${marker}%`)}
        );
        UPDATE parent_student_links SET status='inactive',updated_at=unixepoch()
        WHERE school_id=${schoolId} AND student_id IN (
          SELECT id FROM students WHERE school_id=${schoolId}
            AND student_number LIKE ${sqlText(`${marker}%`)}
        );
        UPDATE students SET status='archived',updated_at=unixepoch()
        WHERE school_id=${schoolId} AND student_number LIKE ${sqlText(`${marker}%`)};
        UPDATE subjects SET status='archived',updated_at=unixepoch()
        WHERE school_id=${schoolId} AND name LIKE ${sqlText(`${marker}%`)};
        UPDATE sections SET status='archived',updated_at=unixepoch()
        WHERE school_id=${schoolId} AND name LIKE ${sqlText(`${marker}%`)};
        UPDATE classes SET status='archived',updated_at=unixepoch()
        WHERE school_id=${schoolId} AND name LIKE ${sqlText(`${marker}%`)};
        UPDATE users SET status='inactive',auth_version=auth_version+1,updated_at=unixepoch()
        WHERE email IN (${Object.values(emails).map(sqlText).join(',')})
      `, 'write');

      if (functionalPass) {
        const cleanup = d1(`
          SELECT
            (SELECT COUNT(*) FROM users
             WHERE email IN (${Object.values(emails).map(sqlText).join(',')}) AND status='inactive') AS inactive_users,
            (SELECT COUNT(*) FROM students WHERE school_id=${schoolId}
             AND student_number LIKE ${sqlText(`${marker}%`)} AND status='archived') AS archived_students,
            (SELECT COUNT(*) FROM classes WHERE school_id=${schoolId}
             AND name LIKE ${sqlText(`${marker}%`)} AND status='archived') AS archived_classes,
            (SELECT COUNT(*) FROM sections WHERE school_id=${schoolId}
             AND name LIKE ${sqlText(`${marker}%`)} AND status='archived') AS archived_sections,
            (SELECT COUNT(*) FROM subjects WHERE school_id=${schoolId}
             AND name LIKE ${sqlText(`${marker}%`)} AND status='archived') AS archived_subjects,
            (SELECT COUNT(*) FROM student_enrollments WHERE school_id=${schoolId}
             AND student_id IN (SELECT id FROM students WHERE school_id=${schoolId}
               AND student_number LIKE ${sqlText(`${marker}%`)}) AND status='cancelled') AS cancelled_enrollments,
            (SELECT COUNT(*) FROM student_subjects WHERE school_id=${schoolId}
             AND student_id IN (SELECT id FROM students WHERE school_id=${schoolId}
               AND student_number LIKE ${sqlText(`${marker}%`)}) AND is_active=0) AS inactive_assignments,
            (SELECT COUNT(*) FROM grades WHERE school_id=${schoolId}
             AND student_subject_id IN (SELECT assignment.id FROM student_subjects assignment
               JOIN students student ON student.id=assignment.student_id
               WHERE assignment.school_id=${schoolId}
                 AND student.student_number LIKE ${sqlText(`${marker}%`)}) AND is_active=0) AS inactive_grades,
            (SELECT COUNT(*) FROM parent_student_links link JOIN students student ON student.id=link.student_id
             WHERE link.school_id=${schoolId} AND student.student_number LIKE ${sqlText(`${marker}%`)}
               AND link.status='inactive') AS inactive_parent_links,
            (SELECT COUNT(*) FROM result_cards WHERE id=${cardId}
             AND status='cancelled' AND publication_status='withdrawn' AND publication_revision=2) AS withdrawn_cards,
            (SELECT COUNT(*) FROM result_card_publication_logs
             WHERE result_card_id=${cardId}) AS retained_audit_logs,
            (SELECT COUNT(*) FROM result_card_publication_write_assertions
             WHERE result_card_id=${cardId}) AS pending_assertions,
            (SELECT COUNT(*) FROM pragma_foreign_key_check) AS foreign_key_violations
        `, 'read')[0];
        assert.deepEqual(
          [
            cleanup.inactive_users,
            cleanup.archived_students,
            cleanup.archived_classes,
            cleanup.archived_sections,
            cleanup.archived_subjects,
            cleanup.cancelled_enrollments,
            cleanup.inactive_assignments,
            cleanup.inactive_grades,
            cleanup.inactive_parent_links,
            cleanup.withdrawn_cards,
            cleanup.retained_audit_logs,
            cleanup.pending_assertions,
            cleanup.foreign_key_violations,
          ],
          [5, 1, 1, 1, 2, 1, 2, 2, 1, 1, 2, 0, 0],
        );
        cleanupPass = true;
      }
    } catch (cleanupError) {
      failure ||= cleanupError;
    }
  }
}

if (failure) throw failure;
assert.equal(functionalPass, true, 'Functional QA did not finish');
assert.equal(cleanupPass, true, 'QA soft cleanup did not finish');

const finalChecks = {
  migrations: d1(`
    SELECT id,name,applied_at FROM d1_migrations ORDER BY id
  `, 'read'),
  foreignKeys: d1('PRAGMA foreign_key_check', 'read'),
  publication: d1(`
    SELECT * FROM result_card_publication_readiness ORDER BY school_id
  `, 'read'),
  academic: d1(`
    SELECT * FROM academic_grade_policy_readiness ORDER BY school_id
  `, 'read'),
  fee: d1('SELECT * FROM finance_fee_readiness ORDER BY school_id', 'read'),
  payroll: d1('SELECT * FROM finance_payroll_readiness ORDER BY school_id', 'read'),
  payrollSchool: d1('SELECT * FROM finance_payroll_school_readiness ORDER BY school_id', 'read'),
  treasury: d1('SELECT * FROM finance_treasury_readiness ORDER BY school_id', 'read'),
};
assert.equal(finalChecks.migrations.length, 35);
assert.equal(finalChecks.migrations.at(-1).name, '0034_result_card_publication.sql');
assert.equal(
  finalChecks.migrations.filter(row => row.name === '0034_result_card_publication.sql').length,
  1,
);
assert.deepEqual(finalChecks.foreignKeys, []);
assert.ok(finalChecks.publication.every(row => row.status === 'healthy'));
assert.deepEqual(finalChecks.academic, identifiers.readiness_before.academic);
assert.deepEqual(finalChecks.fee, identifiers.readiness_before.fee);
assert.deepEqual(finalChecks.payroll, identifiers.readiness_before.payroll);
assert.deepEqual(finalChecks.payrollSchool, identifiers.readiness_before.payrollSchool);
assert.deepEqual(finalChecks.treasury, identifiers.readiness_before.treasury);

const evidence = {
  staging_only: true,
  target,
  target_id: targetId,
  preview_origin: preview.origin,
  marker,
  qa,
  identifiers: {
    school_id: identifiers.school_id,
    academic_year_id: identifiers.academic_year_id,
    other_school_id: identifiers.other_school_id,
    class_id: identifiers.class_id,
    section_id: identifiers.section_id,
    student_id: identifiers.student_id,
    subject_ids: identifiers.subject_ids,
    result_card_id: identifiers.result_card_id,
    policy_id: identifiers.policy_id,
  },
  publication_audit_log: auditAfter,
  cleanup: {
    users_inactive: true,
    student_class_section_subjects_archived: true,
    enrollment_cancelled: true,
    assignments_and_grades_inactive: true,
    parent_link_inactive: true,
    result_card_retained_withdrawn: true,
    immutable_publication_logs_retained: true,
    no_direct_sql_delete: true,
    no_destructive_cleanup: true,
  },
  final_checks: finalChecks,
  command_summary: commandEvidence,
};
writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence));
