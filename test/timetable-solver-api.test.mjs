import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import test, { after } from 'node:test';
import { createServer } from 'vite';
import { signJWT } from '../src/lib/jwtSecurity.ts';
import { migrationFiles, migrationSQL } from './helpers/teaching-load-matrix-fixture.mjs';
import { solvePreparedTimetable } from '../src/lib/timetableSolverPrepared.ts';
import { computeTimetableProposalDigest } from '../src/lib/timetableAdoption.ts';
import { DEFAULT_TIMETABLE_PREFERENCES } from '../src/lib/timetablePreferences.ts';

const testDir = dirname(fileURLToPath(import.meta.url));
const rootDir = join(testDir, '..');
const migration = (name) => readFileSync(join(rootDir, 'migrations', name), 'utf8');
const secret = 'timetable-solver-api-secret-with-adequate-entropy-18a5';
const vite = await createServer({ root: rootDir, appType: 'custom', server: { middlewareMode: true } });
const { default: app } = await vite.ssrLoadModule('/src/worker.ts');
after(async () => vite.close());

class LocalStatement {
  constructor(database, sql, values = []) { this.database = database; this.sql = sql; this.values = values; }
  bind(...values) { return new LocalStatement(this.database, this.sql, values); }
  async first() { return this.database.prepare(this.sql).get(...this.values) || null; }
  async all() { return { results: this.database.prepare(this.sql).all(...this.values), success: true, meta: {} }; }
  async run() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { success: true, results: [], meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid) } };
  }
}

class LocalD1 {
  constructor(database) { this.database = database; this.prepareCount = 0; this.sqlLog = []; }
  prepare(sql) { this.prepareCount += 1; this.sqlLog.push(sql); return new LocalStatement(this.database, sql); }
  async batch(statements) {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec('COMMIT');
      return results;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}

async function fixture() {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  for (const name of migrationFiles) database.exec(migrationSQL(name));
  database.exec(`
    INSERT INTO schools (id, name, school_type, city, status) VALUES
      (1, 'School A', 'خاص', 'Duhok', 'active'),
      (2, 'School B', 'خاص', 'Duhok', 'active');
    INSERT INTO academic_years (id, school_id, name, starts_at, ends_at, is_active) VALUES
      (1, 1, '2026-2027', '2026-09-01', '2027-06-30', 1),
      (2, 2, '2026-2027', '2026-09-01', '2027-06-30', 1);
    INSERT INTO classes (id, school_id, name, stage, order_index, status) VALUES
      (1, 1, 'Class A', 'ابتدائي', 1, 'active'),
      (2, 1, 'Class B', 'ابتدائي', 2, 'active'),
      (3, 2, 'Other School Class', 'ابتدائي', 1, 'active');
    INSERT INTO subjects (id, school_id, class_id, section_id, name, status) VALUES
      (1, 1, 1, NULL, 'Math', 'active'),
      (2, 1, 2, NULL, 'Arabic', 'active'),
      (3, 2, 3, NULL, 'Science', 'active');
    INSERT INTO employees (id, school_id, full_name, role, status) VALUES
      (1, 1, 'Teacher A', 'teacher', 'active'),
      (2, 1, 'Teacher B', 'teacher', 'active'),
      (3, 2, 'Other Teacher', 'teacher', 'active');
    INSERT INTO users (id, school_id, full_name, email, role_id, status, auth_version) VALUES
      (1, 1, 'Owner A', 'owner@example.test', 2, 'active', 1),
      (2, NULL, 'System Admin', 'admin@example.test', 1, 'active', 1),
      (3, 1, 'Teacher User', 'teacher@example.test', 5, 'active', 1),
      (4, 1, 'Accountant User', 'accountant@example.test', 6, 'active', 1),
      (5, 1, 'Principal User', 'principal@example.test', 3, 'active', 1);
    INSERT INTO timetable_days (school_id, academic_year_id, day_of_week, is_active, order_index) VALUES
      (1, 1, 0, 1, 0), (1, 1, 1, 1, 1),
      (2, 2, 0, 1, 0);
    INSERT INTO timetable_slots
      (id, school_id, academic_year_id, day_of_week, slot_index, slot_type, lesson_number, label, start_time, end_time, is_active)
    VALUES
      (1, 1, 1, 0, 1, 'lesson', 1, 'First', '08:00', '08:40', 1),
      (2, 1, 1, 0, 2, 'lesson', 2, 'Second', '08:40', '09:20', 1),
      (3, 1, 1, 1, 1, 'lesson', 1, 'First', '08:00', '08:40', 1),
      (4, 1, 1, 1, 2, 'lesson', 2, 'Second', '08:40', '09:20', 1),
      (5, 2, 2, 0, 1, 'lesson', 1, 'First', '08:00', '08:40', 1);
    INSERT INTO timetable_teaching_loads
      (id, school_id, academic_year_id, class_id, section_id, subject_id, employee_id, weekly_periods, status)
    VALUES
      (1, 1, 1, 1, NULL, 1, 1, 2, 'active'),
      (2, 1, 1, 2, NULL, 2, 2, 2, 'active'),
      (3, 2, 2, 3, NULL, 3, 3, 1, 'active');
  `);
  const tokens = {
    owner: await signJWT({ id: 1, email: 'owner@example.test', auth_version: 1 }, secret),
    admin: await signJWT({ id: 2, email: 'admin@example.test', auth_version: 1 }, secret),
    teacher: await signJWT({ id: 3, email: 'teacher@example.test', auth_version: 1 }, secret),
    accountant: await signJWT({ id: 4, email: 'accountant@example.test', auth_version: 1 }, secret),
    principal: await signJWT({ id: 5, email: 'principal@example.test', auth_version: 1 }, secret),
  };
  const d1 = new LocalD1(database);
  return { database, d1, env: { DB: d1, JWT_SECRET: secret, APP_ENV: 'test' }, tokens };
}

async function api(context, token, body) {
  return app.request('http://localhost/api/timetable/solver/preview', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, context.env);
}

function tableCounts(database) {
  return Object.fromEntries(['timetable_days', 'timetable_slots', 'timetable_teaching_loads', 'timetable_teacher_availability', 'timetable_teacher_constraints', 'timetable_entries']
    .map((table) => [table, Number(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count)]));
}

test('solver preview endpoint returns a complete school proposal and performs no writes', async () => {
  const context = await fixture();
  const before = tableCounts(context.database);
  context.d1.prepareCount = 0;
  context.d1.sqlLog = [];
  const response = await api(context, context.tokens.owner, { school_id: 1, academic_year_id: 1 });
  assert.equal(response.status, 200);
  const data = (await response.json()).data;
  assert.equal(data.status, 'complete');
  assert.equal(data.required_periods, 4);
  assert.equal(data.scheduled_periods, 4);
  assert.deepEqual(tableCounts(context.database), before);
  assert.equal(context.d1.sqlLog.some((sql) => /^\s*(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|REPLACE)\b/i.test(sql)), false);
  assert.equal(Object.hasOwn(data.statistics, 'source_query_count'), false);
  const solverSourceQueryCount = context.d1.sqlLog.filter((sql) => /FROM\s+(?:timetable_days|timetable_slots|timetable_teaching_loads|timetable_entries|timetable_teacher_availability|timetable_teacher_constraints|classes\s+class)\b/i.test(sql)).length;
  assert.equal(solverSourceQueryCount, 7);
  assert.equal(context.d1.prepareCount, 13, `expected 7 solver-source, 1 revision, 2 scope-validation, and 2 authentication queries and 1 school-preferences query; got ${context.d1.prepareCount}`);
});

test('system admin requires an explicit active target school', async () => {
  const context = await fixture();
  const missing = await api(context, context.tokens.admin, { academic_year_id: 1 });
  assert.equal(missing.status, 400);
  const explicit = await api(context, context.tokens.admin, { school_id: 1, academic_year_id: 1 });
  assert.equal(explicit.status, 200);
  assert.equal((await explicit.json()).data.required_periods, 4);
});

test('tenant role is locked to its JWT school', async () => {
  const context = await fixture();
  const response = await api(context, context.tokens.owner, { school_id: 2, academic_year_id: 2 });
  assert.equal(response.status, 403);
});

test('teacher and accountant cannot generate a school-wide proposal', async () => {
  const context = await fixture();
  assert.equal((await api(context, context.tokens.teacher, { school_id: 1, academic_year_id: 1 })).status, 403);
  assert.equal((await api(context, context.tokens.accountant, { school_id: 1, academic_year_id: 1 })).status, 403);
});

test('principal retains existing academic timetable management access', async () => {
  const context = await fixture();
  assert.equal((await api(context, context.tokens.principal, { school_id: 1, academic_year_id: 1 })).status, 200);
});

test('academic year cannot cross the selected school scope', async () => {
  const context = await fixture();
  assert.equal((await api(context, context.tokens.admin, { school_id: 1, academic_year_id: 2 })).status, 403);
});

test('query count remains constant as teaching-load row count grows', async () => {
  const base = await fixture();
  base.d1.prepareCount = 0;
  assert.equal((await api(base, base.tokens.owner, { school_id: 1, academic_year_id: 1 })).status, 200);
  const baseCount = base.d1.prepareCount;

  const larger = await fixture();
  for (let id = 10; id < 20; id += 1) {
    larger.database.prepare("INSERT INTO classes (id, school_id, name, stage, order_index, status) VALUES (?, 1, ?, 'ابتدائي', ?, 'active')").run(id, `Class ${id}`, id);
    larger.database.prepare("INSERT INTO subjects (id, school_id, class_id, name, status) VALUES (?, 1, ?, ?, 'active')").run(id, id, `Subject ${id}`);
    larger.database.prepare("INSERT INTO timetable_teaching_loads (id, school_id, academic_year_id, class_id, subject_id, employee_id, weekly_periods, status) VALUES (?, 1, 1, ?, ?, NULL, 1, 'active')").run(id, id, id);
  }
  larger.d1.prepareCount = 0;
  assert.equal((await api(larger, larger.tokens.owner, { school_id: 1, academic_year_id: 1 })).status, 200);
  assert.equal(larger.d1.prepareCount, baseCount);
  assert.equal(baseCount, 13);
});

test('existing valid and later-invalid entries are reported separately without blocking proposal generation', async () => {
  const context = await fixture();
  context.database.prepare('INSERT INTO timetable_entries (school_id, academic_year_id, slot_id, teaching_load_id) VALUES (1, 1, 1, 1)').run();
  context.database.prepare('UPDATE timetable_slots SET is_active = 0 WHERE id = 1').run();
  const response = await api(context, context.tokens.owner, { school_id: 1, academic_year_id: 1 });
  assert.equal(response.status, 200);
  const data = (await response.json()).data;
  assert.equal(data.statistics.current_valid_entry_count, 0);
  assert.equal(data.statistics.existing_invalid_entry_count, 1);
  assert.ok(data.scheduled_periods > 0);
  assert.equal(context.database.prepare('SELECT COUNT(*) AS count FROM timetable_entries').get().count, 1);
});

test('invalid archived-teacher demand is exposed and never proposed', async () => {
  const context = await fixture();
  context.database.prepare("UPDATE employees SET status = 'archived' WHERE id = 1").run();
  const response = await api(context, context.tokens.owner, { school_id: 1, academic_year_id: 1 });
  assert.equal(response.status, 200);
  const data = (await response.json()).data;
  assert.equal(data.status, 'impossible');
  assert.equal(data.readiness.invalid_load_count, 1);
  assert.equal(data.entries.some((entry) => entry.teaching_load_id === 1), false);
  assert.ok(data.unscheduled.some((item) => item.teaching_load_id === 1 && item.reason_codes.includes('invalid_teaching_load')));
});

async function prepare(context, token, body) {
  return app.request('http://localhost/api/timetable/solver/prepare', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, context.env);
}

async function preferencesRequest(context, token, schoolId, preferences, revision = 0) {
  return app.request(`http://localhost/api/timetable/preferences?school_id=${schoolId}`, {
    method: preferences ? 'PUT' : 'GET',
    headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
    ...(preferences ? {body: JSON.stringify({school_id: schoolId, preferences, expected_revision: revision})} : {}),
  }, context.env);
}

test('school priorities are isolated, authorized, persisted and supplied by the server during preparation', async () => {
  const context = await fixture();
  const before = tableCounts(context.database);
  const defaults = await preferencesRequest(context, context.tokens.owner, 1);
  assert.equal(defaults.status, 200);
  assert.deepEqual((await defaults.json()).data, {school_id: 1, revision: 0, preferences: DEFAULT_TIMETABLE_PREFERENCES});
  const schoolA = {...DEFAULT_TIMETABLE_PREFERENCES, teacher_gaps: 2};
  const schoolB = {...DEFAULT_TIMETABLE_PREFERENCES, teacher_gaps: 0, early_science: 0};
  assert.equal((await preferencesRequest(context, context.tokens.owner, 2, schoolB)).status, 403);
  assert.equal((await preferencesRequest(context, context.tokens.teacher, 1, schoolA)).status, 403);
  assert.equal((await preferencesRequest(context, context.tokens.accountant, 1)).status, 403);
  assert.equal((await preferencesRequest(context, context.tokens.owner, 1, schoolA)).status, 200);
  assert.equal((await preferencesRequest(context, context.tokens.admin, 2, schoolB)).status, 200);
  for (const [school, year, expected] of [[1, 1, schoolA], [2, 2, schoolB]]) {
    const response = await prepare(context, context.tokens.admin, {school_id: school, academic_year_id: year});
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).data.input.preferences, expected);
  }
  assert.deepEqual(tableCounts(context.database), before);
});

test('priority updates reject stale writes and invalidate prior proposals in this school only', async () => {
  const context = await fixture();
  const prepared = (await (await prepare(context, context.tokens.owner, {school_id: 1, academic_year_id: 1})).json()).data;
  const proposal = await solvePreparedTimetable(prepared);
  const otherBefore = context.database.prepare('SELECT revision FROM timetable_revisions WHERE school_id=2 AND academic_year_id=2').get().revision;
  const prefs = {...DEFAULT_TIMETABLE_PREFERENCES, section_continuity: 2};
  const saved = await preferencesRequest(context, context.tokens.owner, 1, prefs);
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).data.revision, 1);
  assert.equal((await adoptionPreview(context, proposal)).status, 409);
  assert.equal((await preferencesRequest(context, context.tokens.owner, 1, DEFAULT_TIMETABLE_PREFERENCES, 0)).status, 409);
  assert.equal(context.database.prepare('SELECT revision FROM timetable_revisions WHERE school_id=2 AND academic_year_id=2').get().revision, otherBefore);
  assert.deepEqual((await (await preferencesRequest(context, context.tokens.owner, 1)).json()).data.preferences, prefs);
});

test('priority input cannot replace hard constraints or accept malformed levels', async () => {
  const context = await fixture();
  for (const preferences of [
    {...DEFAULT_TIMETABLE_PREFERENCES, teacher_gaps: -1}, {...DEFAULT_TIMETABLE_PREFERENCES, teacher_gaps: 0.5},
    {...DEFAULT_TIMETABLE_PREFERENCES, teacher_gaps: '2'}, {...DEFAULT_TIMETABLE_PREFERENCES, early_light_subjects: 2},
    {...DEFAULT_TIMETABLE_PREFERENCES, daily_subject_doubles: 0}, {}, [],
  ]) assert.equal((await preferencesRequest(context, context.tokens.owner, 1, preferences)).status, 400);
  assert.equal(context.database.prepare('SELECT count(*) AS count FROM timetable_school_preferences').get().count, 0);
});

async function adoptionPreview(context, data) {
  return app.request('http://localhost/api/timetable/solver/adoption-preview', {
    method: 'POST', headers: { Authorization: `Bearer ${context.tokens.owner}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({school_id: 1, academic_year_id: 1, proposal_revision: data.timetable_revision,
      proposal_digest: data.proposal_digest, generation_scope: data.generation_scope,
      scope_load_ids: data.scope_load_ids, scope_token: data.scope_token,
      link_same_teacher_section_days: data.link_same_teacher_section_days,
      entries: data.entries.map(({slot_id, teaching_load_id, is_locked}) => ({slot_id, teaching_load_id, is_locked}))}),
  }, context.env);
}

test('browser preparation is read-only and a locally generated proposal passes authoritative adoption validation', async () => {
  const context = await fixture();
  const before = tableCounts(context.database);
  context.d1.sqlLog = [];
  const response = await prepare(context, context.tokens.owner, {school_id: 1, academic_year_id: 1});
  assert.equal(response.status, 200);
  const prepared = (await response.json()).data;
  assert.equal(prepared.input.schoolId, 1);
  assert.equal(prepared.input.academicYearId, 1);
  assert.deepEqual(prepared.input.loads.map(load => load.id), [1, 2]);
  assert.equal(Object.hasOwn(prepared, 'entries'), false, 'server prepares inputs without running search');
  assert.equal(context.d1.sqlLog.some(sql => /^\s*(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|REPLACE)\b/i.test(sql)), false);
  const proposal = await solvePreparedTimetable(prepared);
  assert.equal(proposal.status, 'complete');
  const verified = await adoptionPreview(context, proposal);
  assert.equal(verified.status, 200);
  assert.equal((await verified.json()).data.can_apply, true);
  assert.deepEqual(tableCounts(context.database), before);
});

test('browser preparation enforces school, year, management roles and the closed request schema', async () => {
  const context = await fixture();
  for (const role of ['teacher', 'accountant']) {
    assert.equal((await prepare(context, context.tokens[role], {school_id: 1, academic_year_id: 1})).status, 403);
  }
  assert.equal((await prepare(context, context.tokens.owner, {school_id: 2, academic_year_id: 2})).status, 403);
  assert.equal((await prepare(context, context.tokens.admin, {school_id: 1, academic_year_id: 2})).status, 403);
  assert.equal((await prepare(context, context.tokens.admin, {academic_year_id: 1})).status, 400);
  assert.equal((await prepare(context, context.tokens.owner, {school_id: 1, academic_year_id: 1, loads: []})).status, 400);
  assert.equal((await prepare(context, context.tokens.principal, {school_id: 1, academic_year_id: 1})).status, 200);
});

test('scoped browser generation preserves outside lessons and scope proof remains server-issued', async () => {
  const context = await fixture();
  context.database.prepare('INSERT INTO timetable_entries (school_id, academic_year_id, slot_id, teaching_load_id) VALUES (1, 1, 1, 2)').run();
  const response = await prepare(context, context.tokens.owner, {school_id: 1, academic_year_id: 1, generation_scope: {kind: 'class', class_id: 1}});
  assert.equal(response.status, 200);
  const prepared = (await response.json()).data;
  assert.deepEqual(prepared.scope_load_ids, [1]);
  assert.equal(typeof prepared.scope_token, 'string');
  assert.deepEqual(prepared.input.fixedEntries, [{slot_id: 1, teaching_load_id: 2, is_locked: 0}]);
  const proposal = await solvePreparedTimetable(prepared);
  assert.ok(proposal.entries.some(entry => entry.teaching_load_id === 2 && entry.slot_id === 1 && entry.is_preserved));
  assert.equal((await (await adoptionPreview(context, proposal)).json()).data.can_apply, true);
  const forgedToken = proposal.scope_token.slice(0, -1) + (proposal.scope_token.endsWith('0') ? '1' : '0');
  const tampered = await adoptionPreview(context, {...proposal, scope_token: forgedToken});
  assert.equal(tampered.status, 409);
});

test('a browser proposal cannot bypass server validation by recomputing its digest', async () => {
  const context = await fixture();
  const prepared = (await (await prepare(context, context.tokens.owner, {school_id: 1, academic_year_id: 1})).json()).data;
  const proposal = await solvePreparedTimetable(prepared);
  // A valid digest is integrity metadata, not permission to schedule foreign or conflicting loads.
  proposal.entries[0] = {...proposal.entries[0], teaching_load_id: 3};
  proposal.proposal_digest = await computeTimetableProposalDigest({schoolId: 1, academicYearId: 1,
    revision: proposal.timetable_revision, entries: proposal.entries, generationScope: proposal.generation_scope});
  const response = await adoptionPreview(context, proposal);
  assert.equal(response.status, 200);
  const result = (await response.json()).data;
  assert.equal(result.can_apply, false);
  assert.ok(result.blockers.some(blocker => blocker.code === 'invalid_teaching_load'));
});

function seedLinkedSections(context) {
  context.database.exec(`
    INSERT INTO sections (id, school_id, class_id, name, status)
      VALUES (21,1,1,'A','active'), (22,1,1,'B','active');
    UPDATE timetable_teaching_loads SET section_id = 21, weekly_periods = 1 WHERE id = 1;
    INSERT INTO timetable_teaching_loads
      (id,school_id,academic_year_id,class_id,section_id,subject_id,employee_id,weekly_periods,status)
      VALUES (4,1,1,1,22,1,1,1,'active');
  `);
}

function assertLinkedProposal(context, proposal) {
  assert.equal(proposal.status, 'complete');
  assert.equal(proposal.link_same_teacher_section_days, true);
  const entries = proposal.entries.filter(entry => [1, 4].includes(entry.teaching_load_id));
  assert.equal(entries.length, 2);
  const slots = entries.map(entry => context.database.prepare('SELECT day_of_week FROM timetable_slots WHERE id = ?').get(entry.slot_id));
  assert.equal(slots[0].day_of_week, slots[1].day_of_week);
  assert.notEqual(entries[0].slot_id, entries[1].slot_id, 'the shared teacher cannot teach both sections simultaneously');
}

test('same-teacher day linking survives browser preparation, local solving, digest and server validation', async () => {
  const context = await fixture(); seedLinkedSections(context);
  const before = tableCounts(context.database);
  const response = await prepare(context, context.tokens.owner, {
    school_id: 1, academic_year_id: 1, link_same_teacher_section_days: true,
  });
  assert.equal(response.status, 200);
  const prepared = (await response.json()).data;
  assert.equal(prepared.input.linkSameTeacherSectionDays, true);
  const proposal = await solvePreparedTimetable(prepared);
  assertLinkedProposal(context, proposal);
  assert.equal(proposal.proposal_digest, await computeTimetableProposalDigest({
    schoolId: 1, academicYearId: 1, revision: proposal.timetable_revision,
    entries: proposal.entries, linkSameTeacherSectionDays: true,
  }));
  const adoption = await adoptionPreview(context, proposal);
  assert.equal(adoption.status, 200);
  assert.equal((await adoption.json()).data.can_apply, true);
  assert.deepEqual(tableCounts(context.database), before);
});

test('server preview carries the same-teacher day-link flag in its verifiable digest', async () => {
  const context = await fixture(); seedLinkedSections(context);
  const response = await api(context, context.tokens.owner, {
    school_id: 1, academic_year_id: 1, link_same_teacher_section_days: true,
  });
  assert.equal(response.status, 200);
  const proposal = (await response.json()).data;
  assertLinkedProposal(context, proposal);
  const adoption = await adoptionPreview(context, proposal);
  assert.equal(adoption.status, 200);
  assert.equal((await adoption.json()).data.can_apply, true);
});

test('same-teacher day linking defaults off and an explicit false preserves the legacy proposal digest', async () => {
  const context = await fixture();
  const implicit = await prepare(context, context.tokens.owner, {school_id: 1, academic_year_id: 1});
  assert.equal(implicit.status, 200);
  assert.notEqual((await implicit.json()).data.input.linkSameTeacherSectionDays, true);
  const explicit = await prepare(context, context.tokens.owner, {
    school_id: 1, academic_year_id: 1, link_same_teacher_section_days: false,
  });
  assert.equal(explicit.status, 200);
  const prepared = (await explicit.json()).data;
  assert.equal(prepared.input.linkSameTeacherSectionDays, false);
  const proposal = await solvePreparedTimetable(prepared);
  assert.notEqual(proposal.link_same_teacher_section_days, true);
  const input = {schoolId: 1, academicYearId: 1, revision: proposal.timetable_revision, entries: proposal.entries};
  const legacyDigest = await computeTimetableProposalDigest(input);
  assert.equal(proposal.proposal_digest, legacyDigest);
  assert.equal(await computeTimetableProposalDigest({...input, linkSameTeacherSectionDays: false}), legacyDigest);
  assert.notEqual(await computeTimetableProposalDigest({...input, linkSameTeacherSectionDays: true}), legacyDigest);
});

test('generation endpoints reject non-boolean same-teacher day-link values', async () => {
  const context = await fixture();
  for (const value of [null, 0, 1, 'true', 'false', [], {}]) {
    const body = {school_id: 1, academic_year_id: 1, link_same_teacher_section_days: value};
    assert.equal((await prepare(context, context.tokens.owner, body)).status, 400, JSON.stringify(value));
    assert.equal((await api(context, context.tokens.owner, body)).status, 400, JSON.stringify(value));
  }
});

test('linked section generation follows the preserved outside section day without moving its lesson', async () => {
  const context = await fixture(); seedLinkedSections(context);
  context.database.exec('INSERT INTO timetable_entries (school_id, academic_year_id, slot_id, teaching_load_id) VALUES (1,1,3,4)');
  const before = context.database.prepare('SELECT * FROM timetable_entries ORDER BY id').all();
  const response = await prepare(context, context.tokens.owner, {
    school_id: 1, academic_year_id: 1, link_same_teacher_section_days: true,
    generation_scope: {kind: 'section', class_id: 1, section_id: 21},
  });
  assert.equal(response.status, 200);
  const proposal = await solvePreparedTimetable((await response.json()).data);
  assertLinkedProposal(context, proposal);
  assert.deepEqual(proposal.scope_load_ids, [1]);
  assert.ok(proposal.entries.some(entry => entry.teaching_load_id === 4 && entry.slot_id === 3 && entry.is_preserved));
  assert.equal(proposal.entries.find(entry => entry.teaching_load_id === 1).slot_id, 4);
  const adoption = await adoptionPreview(context, proposal);
  assert.equal(adoption.status, 200);
  assert.equal((await adoption.json()).data.can_apply, true);
  assert.deepEqual(context.database.prepare('SELECT * FROM timetable_entries ORDER BY id').all(), before);
});

test('browser day linking ignores a dormant archived section load with no current lessons', async () => {
  const context = await fixture(); seedLinkedSections(context);
  context.database.exec(`
    INSERT INTO sections (id, school_id, class_id, name, status) VALUES (23,1,1,'Archived C','active');
    INSERT INTO timetable_teaching_loads
      (id,school_id,academic_year_id,class_id,section_id,subject_id,employee_id,weekly_periods,status)
      VALUES (5,1,1,1,23,1,1,1,'active');
    UPDATE sections SET status = 'archived' WHERE id = 23;
  `);
  const dormantBefore = context.database.prepare('SELECT * FROM timetable_teaching_loads WHERE id = 5').get();
  const response = await prepare(context, context.tokens.owner, {
    school_id: 1, academic_year_id: 1, link_same_teacher_section_days: true,
  });
  assert.equal(response.status, 200);
  const proposal = await solvePreparedTimetable((await response.json()).data);
  assertLinkedProposal(context, proposal);
  assert.equal(proposal.entries.some(entry => entry.teaching_load_id === 5), false);
  const adoption = await adoptionPreview(context, proposal);
  assert.equal(adoption.status, 200);
  const validation = (await adoption.json()).data;
  assert.equal(validation.can_apply, true, JSON.stringify(validation.blockers));
  assert.deepEqual(context.database.prepare('SELECT * FROM timetable_teaching_loads WHERE id = 5').get(), dormantBefore);
});

test('browser scoped linking preserves unrelated outside section groups on different days', async () => {
  const context = await fixture(); seedLinkedSections(context);
  context.database.exec(`
    INSERT INTO sections (id, school_id, class_id, name, status)
      VALUES (31,1,2,'Outside A','active'), (32,1,2,'Outside B','active');
    UPDATE timetable_teaching_loads SET section_id = 31, weekly_periods = 1 WHERE id = 2;
    INSERT INTO timetable_teaching_loads
      (id,school_id,academic_year_id,class_id,section_id,subject_id,employee_id,weekly_periods,status)
      VALUES (5,1,1,2,32,2,2,1,'active');
    INSERT INTO timetable_entries (id,school_id,academic_year_id,slot_id,teaching_load_id,is_locked,created_at,updated_at)
      VALUES (30,1,1,1,2,0,100,101), (31,1,1,3,5,1,200,201);
  `);
  const outside = context.database.prepare('SELECT * FROM timetable_entries ORDER BY id').all();
  const response = await prepare(context, context.tokens.owner, {
    school_id: 1, academic_year_id: 1, link_same_teacher_section_days: true,
    generation_scope: {kind: 'class', class_id: 1},
  });
  assert.equal(response.status, 200);
  const proposal = await solvePreparedTimetable((await response.json()).data);
  assertLinkedProposal(context, proposal);
  assert.deepEqual(proposal.scope_load_ids, [1, 4]);
  for (const row of outside) {
    assert.ok(proposal.entries.some(entry => entry.teaching_load_id === row.teaching_load_id
      && entry.slot_id === row.slot_id && entry.is_locked === row.is_locked && entry.is_preserved));
  }
  const adoption = await adoptionPreview(context, proposal);
  assert.equal(adoption.status, 200);
  const validation = (await adoption.json()).data;
  assert.equal(validation.can_apply, true, JSON.stringify(validation.blockers));
  assert.deepEqual(context.database.prepare('SELECT * FROM timetable_entries ORDER BY id').all(), outside);
});
