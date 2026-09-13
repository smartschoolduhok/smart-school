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
assert.ok(preview.hostname.endsWith('.smart-school-staging.pages.dev'), 'Only a staging Pages Preview is allowed');
assert.ok(evidenceArgument, 'An evidence JSON path outside the repository is required');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = resolve(evidenceArgument);
assert.ok(!evidencePath.toLowerCase().startsWith(`${root.toLowerCase()}\\`), 'Evidence must remain outside the repository');
const wranglerPath = resolve(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const marker = `PH20C-${Date.now()}-${randomBytes(4).toString('hex')}`;
const markerLower = marker.toLowerCase();
const password = randomBytes(24).toString('base64url');
const passwordHash = await hashPassword(password);
const emails = {
  owner: `phase20c.owner.${markerLower}@example.test`,
  teacher: `phase20c.teacher.${markerLower}@example.test`,
  parent: `phase20c.parent.${markerLower}@example.test`,
  otherOwner: `phase20c.other-owner.${markerLower}@example.test`,
};
const sqlText = value => `'${String(value).replaceAll("'", "''")}'`;
const commandEvidence = [];

function d1(sql, mode) {
  assert.ok(mode === 'read' || mode === 'write');
  assert.ok(!/\b(?:DELETE|DROP|TRUNCATE|VACUUM|REPLACE|ALTER)\b/iu.test(sql), 'Destructive SQL is forbidden');
  if (mode === 'read') assert.match(sql.trim(), /^(?:SELECT|PRAGMA|WITH)\b/iu);
  if (mode === 'write') assert.match(sql.trim(), /^(?:INSERT|UPDATE)\b/iu);
  const startedAt = Date.now();
  const result = spawnSync(process.execPath, [
    wranglerPath, 'd1', 'execute', target, '--remote', '--command', sql, '--json',
  ], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 90_000,
    maxBuffer: 10_000_000,
    env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' },
  });
  commandEvidence.push({ mode, exit_code: result.status, duration_ms: Date.now() - startedAt });
  assert.equal(result.status, 0, `D1 ${mode} failed: ${result.stderr || result.stdout}`);
  const parsed = JSON.parse(result.stdout);
  assert.ok(parsed.every(entry => entry.success === true), `D1 ${mode} was not successful`);
  if (mode === 'read') {
    assert.ok(parsed.every(entry => entry.meta?.changed_db === false && Number(entry.meta?.rows_written || 0) === 0));
  }
  return parsed.flatMap(entry => entry.results || []);
}

async function api(path, { method = 'GET', token, body, expected = 200 } = {}) {
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
  try { payload = text ? JSON.parse(text) : null; } catch { /* asserted below */ }
  assert.equal(
    response.status,
    expected,
    `${method} ${path}: ${response.status} ${payload?.code || payload?.error || 'invalid response'}`,
  );
  return payload;
}

const names = {
  terminalClass: `${marker} Terminal`,
  comprehensiveClass: `${marker} Comprehensive`,
  nonTerminalClass: `${marker} Non-terminal`,
  manualClass: `${marker} Manual`,
};
const studentNumbers = {
  terminalExample: `${marker}-T-EXAMPLE`,
  terminalPass: `${marker}-T-PASS`,
  terminalFail: `${marker}-T-FAIL`,
  comprehensive: `${marker}-COMP`,
  generalExemption: `${marker}-GENERAL`,
  individualExemption: `${marker}-INDIVIDUAL`,
  manual: `${marker}-MANUAL`,
};

let context = null;
let identifiers = null;
let ownerToken = null;
let teacherToken = null;
let parentToken = null;
let otherOwnerToken = null;
let firstCardId = null;
let manualCardId = null;
let functionalPass = false;
let cleanupPass = false;
let failure = null;
const qa = {};

try {
  context = d1(`
    SELECT school.id AS school_id, year.id AS academic_year_id,
           (SELECT other.id FROM schools other WHERE other.id!=school.id AND other.status='active' ORDER BY other.id LIMIT 1) AS other_school_id
    FROM schools school
    JOIN academic_years year ON year.school_id=school.id AND year.is_active=1
    JOIN grade_settings settings ON settings.school_id=school.id
    JOIN finance_fee_readiness fee ON fee.school_id=school.id AND fee.healthy=1
    JOIN finance_treasury_readiness treasury ON treasury.school_id=school.id AND treasury.healthy=1
    JOIN finance_payroll_school_readiness payroll ON payroll.school_id=school.id AND payroll.healthy=1
    WHERE school.status='active'
    ORDER BY school.id LIMIT 1
  `, 'read')[0];
  assert.ok(context?.school_id && context?.academic_year_id && context?.other_school_id, 'No isolated STAGING QA context is available');
  const schoolId = Number(context.school_id);
  const yearId = Number(context.academic_year_id);
  const otherSchoolId = Number(context.other_school_id);

  d1(`
    INSERT INTO users(school_id,full_name,email,password_hash,role_id,status,auth_version,created_at,updated_at) VALUES
      (${schoolId},${sqlText(`${marker} Owner`)},${sqlText(emails.owner)},${sqlText(passwordHash)},(SELECT id FROM roles WHERE key='school_owner'),'active',1,unixepoch(),unixepoch()),
      (${schoolId},${sqlText(`${marker} Teacher`)},${sqlText(emails.teacher)},${sqlText(passwordHash)},(SELECT id FROM roles WHERE key='teacher'),'active',1,unixepoch(),unixepoch()),
      (${schoolId},${sqlText(`${marker} Parent`)},${sqlText(emails.parent)},${sqlText(passwordHash)},(SELECT id FROM roles WHERE key='parent'),'active',1,unixepoch(),unixepoch()),
      (${otherSchoolId},${sqlText(`${marker} Other Owner`)},${sqlText(emails.otherOwner)},${sqlText(passwordHash)},(SELECT id FROM roles WHERE key='school_owner'),'active',1,unixepoch(),unixepoch());
    INSERT INTO classes(school_id,name,stage,order_index,status,created_at,updated_at) VALUES
      (${schoolId},${sqlText(names.terminalClass)},'QA',901,'active',unixepoch(),unixepoch()),
      (${schoolId},${sqlText(names.comprehensiveClass)},'QA',902,'active',unixepoch(),unixepoch()),
      (${schoolId},${sqlText(names.nonTerminalClass)},'QA',903,'active',unixepoch(),unixepoch()),
      (${schoolId},${sqlText(names.manualClass)},'QA',904,'active',unixepoch(),unixepoch())
  `, 'write');

  const classRows = d1(`SELECT id,name FROM classes WHERE school_id=${schoolId} AND name LIKE ${sqlText(`${marker}%`)} ORDER BY id`, 'read');
  const classByName = Object.fromEntries(classRows.map(row => [row.name, Number(row.id)]));
  const userRows = d1(`SELECT id,email FROM users WHERE email IN (${Object.values(emails).map(sqlText).join(',')}) ORDER BY id`, 'read');
  const userByEmail = Object.fromEntries(userRows.map(row => [row.email, Number(row.id)]));
  assert.equal(classRows.length, 4);
  assert.equal(userRows.length, 4);

  const classDefinitions = [
    [names.terminalClass, 4],
    [names.comprehensiveClass, 4],
    [names.nonTerminalClass, 2],
    [names.manualClass, 2],
  ];
  const sectionSql = [];
  const subjectSql = [];
  for (const [className, subjectCount] of classDefinitions) {
    const classId = classByName[className];
    sectionSql.push(`(${schoolId},${classId},${sqlText(`${marker} Section ${className}`)},30,'active',unixepoch(),unixepoch())`);
    for (let index = 1; index <= subjectCount; index += 1) {
      subjectSql.push(`(${schoolId},${classId},NULL,${sqlText(`${marker} ${className} Subject ${index}`)},'أساسية',1,1,50,90,${index},'active',unixepoch(),unixepoch())`);
    }
  }
  const studentDefinitions = [
    ['terminalExample', names.terminalClass],
    ['terminalPass', names.terminalClass],
    ['terminalFail', names.terminalClass],
    ['comprehensive', names.comprehensiveClass],
    ['generalExemption', names.nonTerminalClass],
    ['individualExemption', names.nonTerminalClass],
    ['manual', names.manualClass],
  ];
  d1(`
    INSERT INTO sections(school_id,class_id,name,capacity,status,created_at,updated_at) VALUES ${sectionSql.join(',')};
    INSERT INTO subjects(school_id,class_id,section_id,name,subject_type,counts_in_average,appears_in_report_card,passing_grade,exemption_grade,order_index,status,created_at,updated_at) VALUES ${subjectSql.join(',')};
    INSERT INTO students(school_id,student_number,full_name,gender,class_id,section_id,status,notes,created_at,updated_at) VALUES
      ${studentDefinitions.map(([key, className]) => `(${schoolId},${sqlText(studentNumbers[key])},${sqlText(`${marker} ${key}`)},'ذكر',${classByName[className]},(SELECT id FROM sections WHERE school_id=${schoolId} AND class_id=${classByName[className]} AND name LIKE ${sqlText(`${marker}%`)} LIMIT 1),'active',${sqlText(marker)},unixepoch(),unixepoch())`).join(',')}
  `, 'write');

  const sectionRows = d1(`SELECT id,class_id FROM sections WHERE school_id=${schoolId} AND name LIKE ${sqlText(`${marker}%`)} ORDER BY id`, 'read');
  const sectionByClass = Object.fromEntries(sectionRows.map(row => [Number(row.class_id), Number(row.id)]));
  const subjectRows = d1(`SELECT id,class_id,order_index FROM subjects WHERE school_id=${schoolId} AND name LIKE ${sqlText(`${marker}%`)} ORDER BY class_id,order_index,id`, 'read');
  const subjectsByClass = Map.groupBy(subjectRows, row => Number(row.class_id));
  const studentRows = d1(`SELECT id,student_number,class_id FROM students WHERE school_id=${schoolId} AND student_number LIKE ${sqlText(`${marker}%`)} ORDER BY id`, 'read');
  const studentByNumber = Object.fromEntries(studentRows.map(row => [row.student_number, Number(row.id)]));
  assert.equal(sectionRows.length, 4);
  assert.equal(subjectRows.length, 12);
  assert.equal(studentRows.length, 7);

  const enrollmentValues = [];
  const assignmentValues = [];
  for (const student of studentRows) {
    const studentId = Number(student.id);
    const classId = Number(student.class_id);
    const sectionId = sectionByClass[classId];
    enrollmentValues.push(`(${schoolId},${studentId},${yearId},${classId},${sectionId},'active','pending',${userByEmail[emails.owner]},${userByEmail[emails.owner]},unixepoch(),unixepoch())`);
    for (const subject of subjectsByClass.get(classId) || []) {
      assignmentValues.push(`(${schoolId},${studentId},${Number(subject.id)},${classId},${sectionId},1,${userByEmail[emails.owner]},${sqlText(marker)},unixepoch(),unixepoch())`);
    }
  }
  d1(`
    INSERT INTO student_enrollments(school_id,student_id,academic_year_id,class_id,section_id,status,promotion_status,created_by_user_id,updated_by_user_id,created_at,updated_at) VALUES ${enrollmentValues.join(',')};
    INSERT INTO student_subjects(school_id,student_id,subject_id,class_id,section_id,is_active,assigned_by_user_id,notes,created_at,updated_at) VALUES ${assignmentValues.join(',')};
    INSERT INTO parent_student_links(school_id,parent_user_id,student_id,relationship,status,created_by_user_id,created_at,updated_at) VALUES(${schoolId},${userByEmail[emails.parent]},${studentByNumber[studentNumbers.generalExemption]},'QA','active',${userByEmail[emails.owner]},unixepoch(),unixepoch())
  `, 'write');

  const assignmentRows = d1(`
    SELECT assignment.id,assignment.student_id,assignment.subject_id,subject.order_index
    FROM student_subjects assignment
    JOIN subjects subject ON subject.id=assignment.subject_id
    JOIN students student ON student.id=assignment.student_id
    WHERE assignment.school_id=${schoolId} AND student.student_number LIKE ${sqlText(`${marker}%`)}
    ORDER BY assignment.student_id,subject.order_index,subject.id
  `, 'read');
  const gradePlans = new Map([
    [studentNumbers.terminalExample, [[44, null], [35, null], [29, null], [46, null]]],
    [studentNumbers.terminalPass, [[60, null], [65, null], [70, null], [75, null]]],
    [studentNumbers.terminalFail, [[30, null], [31, null], [32, null], [33, null]]],
    [studentNumbers.comprehensive, [[20, null], [25, null], [30, null], [35, null]]],
    [studentNumbers.generalExemption, [[90, null], [80, null]]],
    [studentNumbers.individualExemption, [[95, null], [70, 60]]],
    [studentNumbers.manual, [[44, null], [46, null]]],
  ]);
  const studentNumberById = Object.fromEntries(studentRows.map(row => [Number(row.id), row.student_number]));
  const assignmentGroups = Map.groupBy(assignmentRows, row => Number(row.student_id));
  const gradeValues = [];
  for (const [studentId, rows] of assignmentGroups.entries()) {
    const plan = gradePlans.get(studentNumberById[studentId]);
    assert.equal(rows.length, plan.length);
    rows.forEach((row, index) => {
      const [annual, finalExam] = plan[index];
      gradeValues.push(`(${schoolId},${Number(row.id)},${annual},NULL,${annual},${annual},NULL,${finalExam == null ? 'NULL' : finalExam},NULL,1,${userByEmail[emails.owner]},${sqlText(marker)},${annual},${annual})`);
    });
  }
  d1(`INSERT INTO grades(school_id,student_subject_id,first_month,second_month,mid_year_exam,third_month,fourth_month,final_exam,completion_exam,is_active,updated_by_user_id,notes,first_term_grade,second_term_grade) VALUES ${gradeValues.join(',')}`, 'write');

  identifiers = {
    school_id: schoolId,
    academic_year_id: yearId,
    other_school_id: otherSchoolId,
    owner_user_id: userByEmail[emails.owner],
    teacher_user_id: userByEmail[emails.teacher],
    parent_user_id: userByEmail[emails.parent],
    other_owner_user_id: userByEmail[emails.otherOwner],
    classes: classByName,
    students: studentByNumber,
    subjects: Object.fromEntries([...subjectsByClass.entries()].map(([classId, rows]) => [classId, rows.map(row => Number(row.id))])),
  };

  const logins = await Promise.all(Object.entries(emails).map(async ([key, email]) => [key, await api('/api/auth/login', {
    method: 'POST', body: { email, password },
  })]));
  const loginByRole = Object.fromEntries(logins);
  ownerToken = loginByRole.owner.data.token;
  teacherToken = loginByRole.teacher.data.token;
  parentToken = loginByRole.parent.data.token;
  otherOwnerToken = loginByRole.otherOwner.data.token;
  assert.equal(loginByRole.owner.data.user.role_key, 'school_owner');
  assert.equal(loginByRole.teacher.data.user.role_key, 'teacher');
  assert.equal(loginByRole.parent.data.user.role_key, 'parent');

  const terminalClassId = classByName[names.terminalClass];
  const terminalExampleId = studentByNumber[studentNumbers.terminalExample];
  const terminalPolicy = {
    school_id: schoolId,
    academic_year_id: yearId,
    class_id: terminalClassId,
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
    source_reference: `${marker} terminal decision`,
    notes: marker,
  };
  await api('/api/grade-policies', { method: 'POST', token: teacherToken, body: terminalPolicy, expected: 403 });
  const terminalDraft = await api('/api/grade-policies', { method: 'POST', token: ownerToken, body: terminalPolicy, expected: 201 });
  await api(`/api/academic-outcomes/students/${terminalExampleId}?academic_year_id=${yearId}`, { token: ownerToken, expected: 409 });
  const draftPreview = await api('/api/grade-policies/preview-student', {
    method: 'POST', token: ownerToken,
    body: { ...terminalPolicy, student_id: terminalExampleId, policy: terminalPolicy },
  });
  assert.equal(draftPreview.data.outcome.decision_points_used, 10);
  assert.equal(draftPreview.data.outcome.academic_status, 'completion');
  const teacherDraftList = await api(`/api/grade-policies?school_id=${schoolId}&academic_year_id=${yearId}`, { token: teacherToken });
  assert.ok(teacherDraftList.data.some(row => Number(row.id) === Number(terminalDraft.data.id) && row.status === 'draft'));
  qa.draft_has_no_official_effect = true;

  const terminalApproved = await api(`/api/grade-policies/${terminalDraft.data.id}/approve`, {
    method: 'POST', token: ownerToken,
    body: { school_id: schoolId, revision: terminalDraft.data.revision, change_reason: `${marker} approve v1` },
  });
  const terminalOutcomeV1 = await api(`/api/academic-outcomes/students/${terminalExampleId}?academic_year_id=${yearId}`, { token: ownerToken });
  assert.equal(terminalOutcomeV1.data.outcome.academic_status, 'completion');
  assert.equal(terminalOutcomeV1.data.outcome.ministerial_eligibility, 'eligible');
  assert.equal(terminalOutcomeV1.data.outcome.decision_points_used, 10);
  assert.deepEqual(terminalOutcomeV1.data.outcome.subjects.map(row => [row.source_grade, row.decision_points, row.adjusted_grade]), [
    [44, 6, 50], [35, 0, 35], [29, 0, 29], [46, 4, 50],
  ]);
  const passOutcome = await api(`/api/academic-outcomes/students/${studentByNumber[studentNumbers.terminalPass]}?academic_year_id=${yearId}`, { token: ownerToken });
  const failOutcome = await api(`/api/academic-outcomes/students/${studentByNumber[studentNumbers.terminalFail]}?academic_year_id=${yearId}`, { token: ownerToken });
  assert.deepEqual([passOutcome.data.outcome.academic_status, passOutcome.data.outcome.ministerial_eligibility], ['pass', 'eligible']);
  assert.deepEqual([failOutcome.data.outcome.academic_status, failOutcome.data.outcome.ministerial_eligibility], ['fail', 'not_eligible']);
  qa.terminal_44_35_29_46_and_ministerial_threshold = true;

  const firstCard = await api(`/api/result-cards/generate-student/${terminalExampleId}`, {
    method: 'POST', token: ownerToken, body: { school_id: schoolId },
  });
  firstCardId = Number(firstCard.data.card.id);
  assert.equal(firstCard.data.card.card_data_parsed.schema_version, 5);
  assert.equal(Number(firstCard.data.card.card_data_parsed.academic_policy.id), Number(terminalApproved.data.id));
  assert.equal(firstCard.data.card.card_data_parsed.summary.decision_points_used, 10);

  const amendment = await api(`/api/grade-policies/${terminalApproved.data.id}/amend`, {
    method: 'POST', token: ownerToken,
    body: { school_id: schoolId, revision: terminalApproved.data.revision, decision_points: 5, change_reason: `${marker} draft amendment` },
    expected: 201,
  });
  const duringDraft = await api(`/api/academic-outcomes/students/${terminalExampleId}?academic_year_id=${yearId}`, { token: ownerToken });
  assert.equal(Number(duringDraft.data.policy.id), Number(terminalApproved.data.id));
  assert.equal(duringDraft.data.outcome.decision_points_used, 10);
  qa.approved_policy_effective_during_draft_amendment = true;
  const amendmentApproved = await api(`/api/grade-policies/${amendment.data.id}/approve`, {
    method: 'POST', token: ownerToken,
    body: { school_id: schoolId, revision: amendment.data.revision, change_reason: `${marker} approve v2` },
  });
  const afterApproval = await api(`/api/academic-outcomes/students/${terminalExampleId}?academic_year_id=${yearId}`, { token: ownerToken });
  assert.equal(Number(afterApproval.data.policy.id), Number(amendmentApproved.data.id));
  assert.equal(afterApproval.data.policy.version, 2);
  assert.equal(afterApproval.data.outcome.decision_points_used, 4);
  assert.equal(afterApproval.data.outcome.adjusted_failed_subjects, 3);
  const persistedCard = await api(`/api/result-cards/${firstCardId}?school_id=${schoolId}`, { token: ownerToken });
  assert.equal(Number(persistedCard.data.card_data_parsed.academic_policy.id), Number(terminalApproved.data.id));
  assert.equal(persistedCard.data.card_data_parsed.academic_policy.version, 1);
  assert.equal(persistedCard.data.card_data_parsed.summary.decision_points_used, 10);
  qa.new_version_only_after_approval_and_result_card_snapshot = true;

  const comprehensivePolicy = { ...terminalPolicy, class_id: classByName[names.comprehensiveClass], decision_points: 0, ministerial_entry_mode: 'all_continuing', ministerial_max_failed_subjects: 0, source_reference: `${marker} comprehensive` };
  const comprehensiveDraft = await api('/api/grade-policies', { method: 'POST', token: ownerToken, body: comprehensivePolicy, expected: 201 });
  await api(`/api/grade-policies/${comprehensiveDraft.data.id}/approve`, { method: 'POST', token: ownerToken, body: { school_id: schoolId, revision: comprehensiveDraft.data.revision } });
  const comprehensiveOutcome = await api(`/api/academic-outcomes/students/${studentByNumber[studentNumbers.comprehensive]}?academic_year_id=${yearId}`, { token: ownerToken });
  assert.deepEqual([comprehensiveOutcome.data.outcome.academic_status, comprehensiveOutcome.data.outcome.ministerial_eligibility], ['fail', 'comprehensive']);
  qa.comprehensive_entry = true;

  const nonTerminalPolicy = { ...terminalPolicy, class_id: classByName[names.nonTerminalClass], policy_kind: 'non_terminal', decision_points: 5, exemption_enabled: 1, ministerial_entry_mode: 'none', ministerial_max_failed_subjects: 0, source_reference: `${marker} non-terminal` };
  const nonTerminalDraft = await api('/api/grade-policies', { method: 'POST', token: ownerToken, body: nonTerminalPolicy, expected: 201 });
  await api(`/api/grade-policies/${nonTerminalDraft.data.id}/approve`, { method: 'POST', token: ownerToken, body: { school_id: schoolId, revision: nonTerminalDraft.data.revision } });
  const generalOutcome = await api(`/api/academic-outcomes/students/${studentByNumber[studentNumbers.generalExemption]}?academic_year_id=${yearId}`, { token: ownerToken });
  const individualOutcome = await api(`/api/academic-outcomes/students/${studentByNumber[studentNumbers.individualExemption]}?academic_year_id=${yearId}`, { token: ownerToken });
  assert.deepEqual([generalOutcome.data.outcome.academic_status, generalOutcome.data.outcome.exemption_status], ['pass', 'general']);
  assert.deepEqual([individualOutcome.data.outcome.academic_status, individualOutcome.data.outcome.exemption_status], ['pass', 'individual']);
  qa.non_terminal_individual_and_general_exemption = true;

  const manualClassId = classByName[names.manualClass];
  const manualStudentId = studentByNumber[studentNumbers.manual];
  const manualSubjectIds = identifiers.subjects[manualClassId];
  const manualRawBefore = d1(`SELECT grade.first_month,grade.mid_year_exam,grade.third_month,grade.final_exam FROM grades grade JOIN student_subjects assignment ON assignment.id=grade.student_subject_id WHERE assignment.student_id=${manualStudentId} ORDER BY assignment.subject_id`, 'read');
  const manualPolicy = { ...terminalPolicy, class_id: manualClassId, decision_allocation_mode: 'manual', max_completion_subjects: 1, ministerial_max_failed_subjects: 1, source_reference: `${marker} manual` };
  const manualDraft = await api('/api/grade-policies', { method: 'POST', token: ownerToken, body: manualPolicy, expected: 201 });
  const manualApproved = await api(`/api/grade-policies/${manualDraft.data.id}/approve`, { method: 'POST', token: ownerToken, body: { school_id: schoolId, revision: manualDraft.data.revision } });
  await api(`/api/grade-policies/${manualApproved.data.id}/students/${manualStudentId}/decision-points`, {
    method: 'PUT', token: ownerToken, expected: 400,
    body: { school_id: schoolId, expected_version: 0, allocations: { [manualSubjectIds[0]]: 1 }, reason: `${marker} invalid partial` },
  });
  await api(`/api/grade-policies/${manualApproved.data.id}/students/${manualStudentId}/decision-points`, {
    method: 'PUT', token: ownerToken, expected: 400,
    body: { school_id: schoolId, expected_version: 0, allocations: { [manualSubjectIds[0]]: 6, [manualSubjectIds[1]]: 4 }, reason: '' },
  });
  const manualV1Reason = `${marker} manual v1 reason`;
  const manualV1 = await api(`/api/grade-policies/${manualApproved.data.id}/students/${manualStudentId}/decision-points`, {
    method: 'PUT', token: ownerToken,
    body: { school_id: schoolId, expected_version: 0, allocations: { [manualSubjectIds[0]]: 6, [manualSubjectIds[1]]: 4 }, reason: manualV1Reason },
  });
  assert.equal(manualV1.data.decision_set.version, 1);
  assert.equal(manualV1.data.outcome.academic_status, 'pass');
  await api(`/api/grade-policies/${manualApproved.data.id}/students/${manualStudentId}/decision-points`, {
    method: 'PUT', token: ownerToken, expected: 409,
    body: { school_id: schoolId, expected_version: 0, allocations: { [manualSubjectIds[0]]: 6 }, reason: `${marker} stale` },
  });
  const manualV2Reason = `${marker} manual v2 reason`;
  const manualV2 = await api(`/api/grade-policies/${manualApproved.data.id}/students/${manualStudentId}/decision-points`, {
    method: 'PUT', token: ownerToken,
    body: { school_id: schoolId, expected_version: 1, allocations: { [manualSubjectIds[0]]: 6 }, reason: manualV2Reason },
  });
  assert.equal(manualV2.data.decision_set.version, 2);
  assert.equal(manualV2.data.outcome.academic_status, 'completion');
  const decisionHistory = await api(`/api/grade-policies/${manualApproved.data.id}/students/${manualStudentId}/decision-points`, { token: ownerToken });
  assert.deepEqual(decisionHistory.data.map(row => [row.version, row.is_current, row.reason]), [[2, 1, manualV2Reason], [1, 0, manualV1Reason]]);
  const manualRawAfter = d1(`SELECT grade.first_month,grade.mid_year_exam,grade.third_month,grade.final_exam FROM grades grade JOIN student_subjects assignment ON assignment.id=grade.student_subject_id WHERE assignment.student_id=${manualStudentId} ORDER BY assignment.subject_id`, 'read');
  assert.deepEqual(manualRawAfter, manualRawBefore);
  const manualCard = await api(`/api/result-cards/generate-student/${manualStudentId}`, { method: 'POST', token: ownerToken, body: { school_id: schoolId } });
  manualCardId = Number(manualCard.data.card.id);
  assert.equal(manualCard.data.card.card_data_parsed.decision_point_record.version, 2);
  assert.equal(manualCard.data.card.card_data_parsed.decision_point_record.reason, manualV2Reason);
  qa.manual_validation_version_history_reason_and_raw_grade_preservation = true;

  const summary = await api(`/api/academic-outcomes/summary?school_id=${schoolId}&academic_year_id=${yearId}&class_id=${terminalClassId}`, { token: ownerToken });
  assert.equal(summary.data.evaluated_students, 3);
  assert.deepEqual([summary.data.pass_count, summary.data.completion_count, summary.data.fail_count], [1, 1, 1]);
  assert.equal(new Set(summary.data.students.map(row => Number(row.student_id))).size, 3);
  assert.deepEqual(summary.data.missing_policy_class_ids, []);
  qa.pass_completion_fail_and_student_level_analytics = true;

  await api('/api/grade-policies', { method: 'POST', token: parentToken, body: terminalPolicy, expected: 403 });
  await api(`/api/grade-policies/${manualApproved.data.id}/students/${manualStudentId}/decision-points`, { method: 'PUT', token: teacherToken, body: { school_id: schoolId, expected_version: 2, allocations: {}, reason: marker }, expected: 403 });
  await api(`/api/academic-outcomes/students/${studentByNumber[studentNumbers.generalExemption]}?academic_year_id=${yearId}`, { token: parentToken });
  await api(`/api/academic-outcomes/students/${terminalExampleId}?academic_year_id=${yearId}`, { token: parentToken, expected: 403 });
  await api(`/api/academic-outcomes/summary?school_id=${schoolId}&academic_year_id=${yearId}`, { token: parentToken, expected: 403 });
  await api(`/api/grade-policies?school_id=${schoolId}&academic_year_id=${yearId}`, { token: otherOwnerToken, expected: 403 });
  await api(`/api/academic-outcomes/students/${terminalExampleId}?academic_year_id=${yearId}`, { token: otherOwnerToken, expected: 403 });
  await api(`/api/grade-policies/${manualApproved.data.id}/history`, { token: otherOwnerToken, expected: 403 });
  qa.tenant_and_role_restrictions = true;

  functionalPass = Object.values(qa).every(Boolean);
} catch (error) {
  failure = error;
} finally {
  const schoolId = Number(context?.school_id || 0);
  if (schoolId > 0) {
    d1(`
      UPDATE result_cards SET status='cancelled',updated_at=unixepoch()
      WHERE school_id=${schoolId} AND student_id IN (SELECT id FROM students WHERE school_id=${schoolId} AND student_number LIKE ${sqlText(`${marker}%`)});
      UPDATE academic_grade_decision_sets SET is_current=0
      WHERE school_id=${schoolId} AND student_id IN (SELECT id FROM students WHERE school_id=${schoolId} AND student_number LIKE ${sqlText(`${marker}%`)}) AND is_current=1;
      UPDATE grades SET is_active=0,updated_at=unixepoch()
      WHERE school_id=${schoolId} AND student_subject_id IN (SELECT assignment.id FROM student_subjects assignment JOIN students student ON student.id=assignment.student_id WHERE assignment.school_id=${schoolId} AND student.student_number LIKE ${sqlText(`${marker}%`)});
      UPDATE student_subjects SET is_active=0,removed_at=unixepoch(),updated_at=unixepoch()
      WHERE school_id=${schoolId} AND student_id IN (SELECT id FROM students WHERE school_id=${schoolId} AND student_number LIKE ${sqlText(`${marker}%`)});
      UPDATE student_enrollments SET status='cancelled',completed_at=unixepoch(),updated_at=unixepoch()
      WHERE school_id=${schoolId} AND student_id IN (SELECT id FROM students WHERE school_id=${schoolId} AND student_number LIKE ${sqlText(`${marker}%`)});
      UPDATE parent_student_links SET status='inactive',updated_at=unixepoch()
      WHERE school_id=${schoolId} AND student_id IN (SELECT id FROM students WHERE school_id=${schoolId} AND student_number LIKE ${sqlText(`${marker}%`)});
      UPDATE students SET status='archived',updated_at=unixepoch() WHERE school_id=${schoolId} AND student_number LIKE ${sqlText(`${marker}%`)};
      UPDATE subjects SET status='archived',updated_at=unixepoch() WHERE school_id=${schoolId} AND name LIKE ${sqlText(`${marker}%`)};
      UPDATE sections SET status='archived',updated_at=unixepoch() WHERE school_id=${schoolId} AND name LIKE ${sqlText(`${marker}%`)};
      UPDATE classes SET status='archived',updated_at=unixepoch() WHERE school_id=${schoolId} AND name LIKE ${sqlText(`${marker}%`)};
      UPDATE users SET status='inactive',auth_version=auth_version+1,updated_at=unixepoch() WHERE email IN (${Object.values(emails).map(sqlText).join(',')})
    `, 'write');
    const cleanup = d1(`
      SELECT
        (SELECT COUNT(*) FROM users WHERE email IN (${Object.values(emails).map(sqlText).join(',')}) AND status='inactive') AS inactive_users,
        (SELECT COUNT(*) FROM students WHERE school_id=${schoolId} AND student_number LIKE ${sqlText(`${marker}%`)} AND status='archived') AS archived_students,
        (SELECT COUNT(*) FROM classes WHERE school_id=${schoolId} AND name LIKE ${sqlText(`${marker}%`)} AND status='archived') AS archived_classes,
        (SELECT COUNT(*) FROM sections WHERE school_id=${schoolId} AND name LIKE ${sqlText(`${marker}%`)} AND status='archived') AS archived_sections,
        (SELECT COUNT(*) FROM subjects WHERE school_id=${schoolId} AND name LIKE ${sqlText(`${marker}%`)} AND status='archived') AS archived_subjects,
        (SELECT COUNT(*) FROM student_enrollments WHERE school_id=${schoolId} AND student_id IN (SELECT id FROM students WHERE school_id=${schoolId} AND student_number LIKE ${sqlText(`${marker}%`)}) AND status='cancelled') AS cancelled_enrollments,
        (SELECT COUNT(*) FROM student_subjects WHERE school_id=${schoolId} AND student_id IN (SELECT id FROM students WHERE school_id=${schoolId} AND student_number LIKE ${sqlText(`${marker}%`)}) AND is_active=0) AS inactive_assignments,
        (SELECT COUNT(*) FROM grades WHERE school_id=${schoolId} AND student_subject_id IN (SELECT assignment.id FROM student_subjects assignment JOIN students student ON student.id=assignment.student_id WHERE assignment.school_id=${schoolId} AND student.student_number LIKE ${sqlText(`${marker}%`)}) AND is_active=0) AS inactive_grades,
        (SELECT COUNT(*) FROM academic_grade_policies policy JOIN classes class ON class.id=policy.class_id WHERE policy.school_id=${schoolId} AND class.name LIKE ${sqlText(`${marker}%`)}) AS retained_policies,
        (SELECT COUNT(*) FROM academic_grade_decision_sets decision_set JOIN students student ON student.id=decision_set.student_id WHERE decision_set.school_id=${schoolId} AND student.student_number LIKE ${sqlText(`${marker}%`)}) AS retained_decision_sets,
        (SELECT COUNT(*) FROM academic_grade_decision_sets decision_set JOIN students student ON student.id=decision_set.student_id WHERE decision_set.school_id=${schoolId} AND student.student_number LIKE ${sqlText(`${marker}%`)} AND decision_set.is_current=1) AS current_decision_sets,
        (SELECT COUNT(*) FROM result_cards card JOIN students student ON student.id=card.student_id WHERE card.school_id=${schoolId} AND student.student_number LIKE ${sqlText(`${marker}%`)}) AS retained_cards,
        (SELECT COUNT(*) FROM result_cards card JOIN students student ON student.id=card.student_id WHERE card.school_id=${schoolId} AND student.student_number LIKE ${sqlText(`${marker}%`)} AND card.status='cancelled') AS cancelled_cards,
        (SELECT COUNT(*) FROM parent_student_links link JOIN students student ON student.id=link.student_id WHERE link.school_id=${schoolId} AND student.student_number LIKE ${sqlText(`${marker}%`)} AND link.status='inactive') AS inactive_parent_links,
        (SELECT COUNT(*) FROM pragma_foreign_key_check) AS foreign_key_violations,
        (SELECT COUNT(*) FROM finance_fee_readiness WHERE healthy!=1) AS fee_unhealthy,
        (SELECT COUNT(*) FROM finance_treasury_readiness WHERE healthy!=1) AS treasury_unhealthy,
        (SELECT COUNT(*) FROM finance_payroll_readiness WHERE healthy!=1) AS payroll_unhealthy,
        (SELECT COUNT(*) FROM finance_payroll_school_readiness WHERE healthy!=1) AS payroll_school_unhealthy
    `, 'read')[0];
    assert.deepEqual(
      [cleanup.inactive_users, cleanup.archived_students, cleanup.archived_classes, cleanup.archived_sections, cleanup.archived_subjects, cleanup.cancelled_enrollments, cleanup.inactive_assignments, cleanup.inactive_grades, cleanup.current_decision_sets, cleanup.inactive_parent_links, cleanup.foreign_key_violations, cleanup.fee_unhealthy, cleanup.treasury_unhealthy, cleanup.payroll_unhealthy, cleanup.payroll_school_unhealthy],
      [4, 7, 4, 4, 12, 7, 22, 22, 0, 1, 0, 0, 0, 0, 0],
    );
    assert.ok(cleanup.retained_policies >= 0 && cleanup.retained_policies <= 5);
    assert.ok(cleanup.retained_decision_sets >= 0 && cleanup.retained_decision_sets <= 2);
    assert.equal(cleanup.retained_cards, cleanup.cancelled_cards);
    cleanupPass = true;
  }
}

if (failure) throw failure;
assert.equal(functionalPass, true, 'Functional QA did not finish');
assert.equal(cleanupPass, true, 'QA soft cleanup did not finish');
const finalReadiness = d1(`
  SELECT school_id,academic_year_id,active_classes,configured_classes,approved_classes,pending_draft_classes,status
  FROM academic_grade_policy_readiness ORDER BY school_id
`, 'read');
const evidence = {
  staging_only: true,
  target,
  target_id: targetId,
  preview_origin: preview.origin,
  marker,
  qa,
  identifiers: {
    ...identifiers,
    first_result_card_id: firstCardId,
    manual_result_card_id: manualCardId,
  },
  cleanup: {
    users_inactive: true,
    students_archived: true,
    classes_sections_subjects_archived: true,
    enrollments_cancelled: true,
    assignments_and_grades_inactive: true,
    parent_link_inactive: true,
    decision_sets_retained_inactive: true,
    policies_and_logs_retained: true,
    result_cards_retained_cancelled: true,
    no_sql_delete: true,
    foreign_key_clean: true,
    finance_readiness_healthy: true,
  },
  final_academic_readiness: finalReadiness,
  command_summary: commandEvidence,
};
writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence));
