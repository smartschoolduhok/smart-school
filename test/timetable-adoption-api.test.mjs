import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import test, { after } from 'node:test';
import { createServer } from 'vite';
import { signJWT } from '../src/lib/jwtSecurity.ts';
import { computeTimetableProposalDigest } from '../src/lib/timetableAdoption.ts';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const migration = (name) => readFileSync(join(rootDir, 'migrations', name), 'utf8');
const secret = 'timetable-adoption-api-secret-with-adequate-entropy-18a6';
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
  for (const name of [
    '0001_initial_schema.sql', '0002_phase2_academic_tables.sql', '0010_employees.sql',
    '0016_auth_security.sql', '0023_timetable_foundation.sql',
    '0024_teacher_timetable_constraints.sql', '0025_timetable_entries.sql',
    '0026_timetable_adoption_locking.sql',
  ]) database.exec(migration(name));
  database.exec(`
    INSERT INTO schools (id, name, school_type, city, status) VALUES
      (1, 'School A', 'خاص', 'Duhok', 'active'),
      (2, 'School B', 'خاص', 'Duhok', 'active');
    INSERT INTO academic_years (id, school_id, name, starts_at, ends_at, is_active) VALUES
      (1, 1, '2026-2027', '2026-09-01', '2027-06-30', 1),
      (2, 2, '2026-2027', '2026-09-01', '2027-06-30', 1),
      (3, 1, '2027-2028', '2027-09-01', '2028-06-30', 0);
    INSERT INTO classes (id, school_id, name, stage, order_index, status) VALUES
      (1, 1, 'Class A', 'ابتدائي', 1, 'active'),
      (2, 1, 'Class B', 'ابتدائي', 2, 'active'),
      (3, 2, 'Other Class', 'ابتدائي', 1, 'active');
    INSERT INTO subjects (id, school_id, class_id, name, status) VALUES
      (1, 1, 1, 'Math', 'active'),
      (2, 1, 2, 'Arabic', 'active'),
      (3, 2, 3, 'Science', 'active');
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
    INSERT INTO timetable_days (id, school_id, academic_year_id, day_of_week, is_active, order_index) VALUES
      (1,1,1,0,1,0), (2,1,1,1,1,1), (3,2,2,0,1,0), (4,1,3,0,1,0);
    INSERT INTO timetable_slots
      (id, school_id, academic_year_id, day_of_week, slot_index, slot_type, lesson_number, label, start_time, end_time, is_active)
    VALUES
      (1,1,1,0,1,'lesson',1,'First','08:00','08:40',1),
      (2,1,1,0,2,'lesson',2,'Second','08:40','09:20',1),
      (3,1,1,1,1,'lesson',1,'First','08:00','08:40',1),
      (4,1,1,1,2,'lesson',2,'Second','08:40','09:20',1),
      (5,2,2,0,1,'lesson',1,'First','08:00','08:40',1),
      (6,1,3,0,1,'lesson',1,'First','08:00','08:40',1);
    INSERT INTO timetable_teaching_loads
      (id, school_id, academic_year_id, class_id, subject_id, employee_id, weekly_periods, status)
    VALUES
      (1,1,1,1,1,1,2,'active'),
      (2,1,1,2,2,2,2,'active'),
      (3,2,2,3,3,3,1,'active'),
      (4,1,3,1,1,1,1,'active');
    INSERT INTO timetable_entries (id, school_id, academic_year_id, slot_id, teaching_load_id, created_by_user_id, updated_by_user_id) VALUES
      (10,2,2,5,3,1,1),
      (11,1,3,6,4,1,1);
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

async function call(context, token, method, path, body) {
  return app.request(`http://localhost${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body == null ? undefined : JSON.stringify(body),
  }, context.env);
}

async function generate(context, token = context.tokens.owner, overrides = {}) {
  const response = await call(context, token, 'POST', '/api/timetable/solver/preview', { school_id: 1, academic_year_id: 1, ...overrides });
  assert.equal(response.status, 200);
  return (await response.json()).data;
}

function proposalEntries(proposal) {
  return proposal.entries.map(({ slot_id, teaching_load_id, is_locked }) => ({ slot_id, teaching_load_id, is_locked }));
}

function adoptionBody(proposal, overrides = {}) {
  return {
    generation_scope: proposal.generation_scope,
    scope_load_ids: proposal.scope_load_ids,
    scope_token: proposal.scope_token,
    school_id: 1,
    academic_year_id: 1,
    expected_revision: proposal.timetable_revision,
    proposal_digest: proposal.proposal_digest,
    entries: proposalEntries(proposal),
    confirm_apply: true,
    ...overrides,
  };
}

async function adoptionPreview(context, proposal, overrides = {}) {
  return call(context, context.tokens.owner, 'POST', '/api/timetable/solver/adoption-preview', {
    generation_scope: proposal.generation_scope,
    scope_load_ids: proposal.scope_load_ids,
    scope_token: proposal.scope_token,
    school_id: 1,
    academic_year_id: 1,
    proposal_revision: proposal.timetable_revision,
    proposal_digest: proposal.proposal_digest,
    entries: proposalEntries(proposal),
    ...overrides,
  });
}

function officialRows(database, schoolId = 1, yearId = 1) {
  return database.prepare('SELECT slot_id, teaching_load_id, is_locked, created_by_user_id, updated_by_user_id FROM timetable_entries WHERE school_id = ? AND academic_year_id = ? ORDER BY teaching_load_id, slot_id').all(schoolId, yearId);
}

function seedCurrent(context, locked = false) {
  context.database.prepare('INSERT INTO timetable_entries (school_id, academic_year_id, slot_id, teaching_load_id, is_locked, created_by_user_id, updated_by_user_id) VALUES (1,1,1,1,?,1,1)').run(locked ? 1 : 0);
  context.database.prepare('INSERT INTO timetable_entries (school_id, academic_year_id, slot_id, teaching_load_id, is_locked, created_by_user_id, updated_by_user_id) VALUES (1,1,2,2,0,1,1)').run();
}

function createHistoricalVersion(context, entries, versionKey = 'qa-historical-version') {
  const result = context.database.prepare(`
    INSERT INTO timetable_schedule_versions (
      version_key, school_id, academic_year_id, source, previous_revision,
      created_by_user_id, old_entry_count, new_entry_count, locked_entry_count, proposal_digest
    ) VALUES (?,1,1,'automatic_adoption',0,1,?,?,?,?)
  `).run(
    versionKey,
    entries.length,
    entries.length,
    entries.filter((entry) => entry.is_locked === 1).length,
    'qa-historical-digest',
  );
  const versionId = Number(result.lastInsertRowid);
  const insertEntry = context.database.prepare(`
    INSERT INTO timetable_schedule_version_entries (
      version_id, school_id, academic_year_id, slot_id, teaching_load_id, is_locked
    ) VALUES (?,1,1,?,?,?)
  `);
  for (const entry of entries) {
    insertEntry.run(versionId, entry.slot_id, entry.teaching_load_id, entry.is_locked);
  }
  return context.database.prepare('SELECT * FROM timetable_schedule_versions WHERE id = ?').get(versionId);
}

async function previewHistoricalRestore(context, versionId) {
  const response = await call(context, context.tokens.owner, 'POST', `/api/timetable/versions/${versionId}/restore-preview`, {
    school_id: 1,
    academic_year_id: 1,
  });
  assert.equal(response.status, 200);
  return (await response.json()).data;
}

async function applyHistoricalRestore(context, versionId, preview) {
  return call(context, context.tokens.owner, 'POST', `/api/timetable/versions/${versionId}/restore`, {
    school_id: 1,
    academic_year_id: 1,
    expected_revision: preview.revision,
    proposal_digest: preview.proposal_digest,
    confirm_restore: true,
  });
}

test('solver proposal includes authoritative revision and SHA-256 digest', async () => {
  const context = await fixture();
  const proposal = await generate(context);
  assert.equal(typeof proposal.timetable_revision, 'number');
  assert.match(proposal.proposal_digest, /^[a-f0-9]{64}$/);
  assert.equal(proposal.status, 'complete');
});

test('default generation and explicit preview locks always preserve official locked entries', async () => {
  const context = await fixture(); seedCurrent(context, true);
  for (const overrides of [{}, { use_current_locked_entries: false }, { fixed_entries: [{ slot_id: 4, teaching_load_id: 2 }] }]) {
    const proposal = await generate(context, context.tokens.owner, overrides);
    assert.ok(proposal.entries.some(entry => entry.slot_id === 1 && entry.teaching_load_id === 1 && entry.is_locked === 1 && entry.is_preserved));
    assert.equal((await (await adoptionPreview(context, proposal)).json()).data.can_apply, true);
  }
});

for (const scope of [{ kind: 'section', class_id: 1, section_id: 21 }, { kind: 'class', class_id: 1 }, { kind: 'stage', stage: 'ابتدائي' }]) {
  test(`targeted ${scope.kind} generation keeps outside rows byte-identical and respects shared teachers`, async () => {
    const context = await fixture();
    context.database.exec(`
      UPDATE classes SET stage = 'متوسط' WHERE id = 2;
      INSERT INTO sections (id, school_id, class_id, name, status) VALUES (21,1,1,'A','active'), (22,1,1,'B','active');
      UPDATE timetable_teaching_loads SET section_id = 21 WHERE id = 1;
      INSERT INTO timetable_teaching_loads (id,school_id,academic_year_id,class_id,section_id,subject_id,employee_id,weekly_periods,status)
        VALUES (5,1,1,1,22,1,2,2,'active');
      UPDATE timetable_teaching_loads SET employee_id = 1 WHERE id = 2;
      INSERT INTO timetable_entries (id,school_id,academic_year_id,slot_id,teaching_load_id,is_locked,created_at,updated_at)
        VALUES (30,1,1,2,2,0,100,101);
    `);
    const outside = context.database.prepare('SELECT * FROM timetable_entries WHERE id = 30').get();
    const loadBefore = context.database.prepare('SELECT * FROM timetable_teaching_loads ORDER BY id').all();
    const otherSchoolBefore = officialRows(context.database, 2, 2);
    const otherYearBefore = officialRows(context.database, 1, 3);
    const proposal = await generate(context, context.tokens.owner, { generation_scope: scope });
    assert.equal(proposal.status, 'complete');
    assert.equal(proposal.entries.filter(entry => entry.teaching_load_id === 1).length, 2);
    assert.equal(proposal.entries.filter(entry => entry.teaching_load_id === 5).length, scope.kind === 'section' ? 0 : 2);
    assert.ok(proposal.entries.filter(entry => entry.employee_id === 1 && entry.teaching_load_id !== 2).every(entry => entry.slot_id !== 2));
    const preserved = proposal.entries.find(entry => entry.teaching_load_id === 2);
    assert.equal(preserved.is_locked, 0); assert.equal(preserved.is_preserved, true);
    const preview = (await (await adoptionPreview(context, proposal)).json()).data;
    assert.equal(preview.can_apply, true);
    assert.equal(preview.weekly_demand.current_demand_complete, false);
    const response = await call(context, context.tokens.owner, 'POST', '/api/timetable/solver/apply', adoptionBody(proposal));
    assert.equal(response.status, 200, JSON.stringify(await response.json()));
    assert.deepEqual(context.database.prepare('SELECT * FROM timetable_entries WHERE id = 30').get(), outside);
    assert.deepEqual(context.database.prepare('SELECT * FROM timetable_teaching_loads ORDER BY id').all(), loadBefore);
    assert.deepEqual(officialRows(context.database, 2, 2), otherSchoolBefore);
    assert.deepEqual(officialRows(context.database, 1, 3), otherYearBefore);
  });
}

test('scope and outside occupancy tampering are rejected even with a recomputed proposal digest', async () => {
  const context = await fixture(); seedCurrent(context);
  const proposal = await generate(context, context.tokens.owner, { generation_scope: { kind: 'class', class_id: 1 } });
  const changedScope = await adoptionPreview(context, proposal, { generation_scope: { kind: 'class', class_id: 2 } });
  assert.equal(changedScope.status,409);
  assert.equal((await changedScope.json()).code,'stale_timetable_scope');
  const entries = proposalEntries(proposal).filter(entry => entry.teaching_load_id !== 2);
  const digest = await computeTimetableProposalDigest({ schoolId: 1, academicYearId: 1, revision: proposal.timetable_revision, entries, generationScope: proposal.generation_scope, scopeLoadIds: proposal.scope_load_ids });
  const before = officialRows(context.database);
  const body = adoptionBody(proposal, { entries, proposal_digest: digest });
  const response = await call(context, context.tokens.owner, 'POST', '/api/timetable/solver/apply', body);
  assert.equal(response.status, 400);
  assert.ok((await response.json()).data.blockers.some(issue => issue.code === 'outside_scope_not_preserved'));
  assert.deepEqual(officialRows(context.database), before);
});

test('targeted adoption rechecks stale revision after an outside manual edit', async () => {
  const context = await fixture(); seedCurrent(context);
  const proposal = await generate(context, context.tokens.owner, { generation_scope: { kind: 'class', class_id: 1 } });
  context.database.exec('UPDATE timetable_entries SET is_locked = 1 WHERE teaching_load_id = 2');
  const before = officialRows(context.database);
  const response = await call(context, context.tokens.owner, 'POST', '/api/timetable/solver/apply', adoptionBody(proposal));
  assert.equal(response.status, 409); assert.deepEqual(officialRows(context.database), before);
});

test('stage membership is frozen at generation even when a complete outside class later enters it', async () => {
  const context = await fixture(); seedCurrent(context);
  context.database.exec("UPDATE classes SET stage='متوسط' WHERE id=2; UPDATE timetable_teaching_loads SET weekly_periods=1 WHERE id=2;");
  const proposal = await generate(context,context.tokens.owner,{generation_scope:{kind:'stage',stage:'ابتدائي'}});
  assert.deepEqual(proposal.scope_load_ids,[1]);
  assert.match(proposal.scope_token,/^[a-f0-9]{64}$/);
  assert.ok(proposal.entries.find(entry=>entry.teaching_load_id===2).is_preserved);
  const revision=currentRevision(context),before=context.database.prepare('SELECT * FROM timetable_entries ORDER BY id').all();
  context.database.exec("UPDATE classes SET stage='ابتدائي' WHERE id=2");
  assert.equal(currentRevision(context),revision);
  const preview=await adoptionPreview(context,proposal);
  assert.equal(preview.status,409); assert.equal((await preview.json()).code,'stale_timetable_scope');
  const apply=await call(context,context.tokens.owner,'POST','/api/timetable/solver/apply',adoptionBody(proposal));
  assert.equal(apply.status,409); assert.equal((await apply.json()).code,'stale_timetable_scope');
  // A client can recompute the public entry digest, but cannot rewrite the server's scope proof.
  const changedIds=[1,2];
  const changedDigest=await computeTimetableProposalDigest({schoolId:1,academicYearId:1,revision,entries:proposalEntries(proposal),
    generationScope:proposal.generation_scope,scopeLoadIds:changedIds});
  const forged=await call(context,context.tokens.owner,'POST','/api/timetable/solver/apply',adoptionBody(proposal,{
    scope_load_ids:changedIds,proposal_digest:changedDigest,
  }));
  assert.equal(forged.status,409); assert.equal((await forged.json()).code,'stale_timetable_scope');
  assert.deepEqual(context.database.prepare('SELECT * FROM timetable_entries ORDER BY id').all(),before);
  assert.equal(context.database.prepare('SELECT COUNT(*) count FROM timetable_schedule_versions').get().count,0);
});

test('targeted adoption requires original membership and its proof independently of presentation metadata',async()=>{
  const context=await fixture(); seedCurrent(context);
  const proposal=await generate(context,context.tokens.owner,{generation_scope:{kind:'class',class_id:1}});
  const before=officialRows(context.database);
  for(const overrides of [{scope_load_ids:undefined},{scope_token:undefined},{scope_load_ids:[]},{scope_load_ids:[1,1]}]) {
    const response=await call(context,context.tokens.owner,'POST','/api/timetable/solver/apply',adoptionBody(proposal,overrides));
    assert.equal(response.status,400);
  }
  const invalidProof=await call(context,context.tokens.owner,'POST','/api/timetable/solver/apply',adoptionBody(proposal,{scope_token:'0'.repeat(64)}));
  assert.equal(invalidProof.status,409);
  const presentationInjected=await call(context,context.tokens.owner,'POST','/api/timetable/solver/apply',adoptionBody(proposal,{
    entries:proposalEntries(proposal).map(entry=>({...entry,is_preserved:false})),
  }));
  assert.equal(presentationInjected.status,400);
  assert.deepEqual(officialRows(context.database),before);
  // Client-side proposal lock edits remain valid with the unmodified scope proof.
  const entries=proposalEntries(proposal).map(entry=>entry.teaching_load_id===1?{...entry,is_locked:1}:entry);
  const digest=await computeTimetableProposalDigest({schoolId:1,academicYearId:1,revision:proposal.timetable_revision,entries,
    generationScope:proposal.generation_scope,scopeLoadIds:proposal.scope_load_ids});
  const changed=await adoptionPreview(context,proposal,{entries,proposal_digest:digest});
  assert.equal(changed.status,200);assert.equal((await changed.json()).data.can_apply,true);
});

test('targeted generation retains outside occupancy in teacher availability and working-day capacity', async () => {
  const context = await fixture();
  context.database.exec(`
    UPDATE timetable_teaching_loads SET employee_id = 1 WHERE id = 2;
    INSERT INTO timetable_entries (school_id,academic_year_id,slot_id,teaching_load_id) VALUES (1,1,2,2);
    INSERT INTO timetable_teacher_constraints (school_id,academic_year_id,employee_id,max_working_days,max_periods_per_day)
      VALUES (1,1,1,1,2);
    INSERT INTO timetable_teacher_availability (school_id,academic_year_id,employee_id,slot_id,status) VALUES (1,1,1,3,'unavailable');
  `);
  const proposal = await generate(context, context.tokens.owner, { generation_scope: { kind: 'class', class_id: 1 } });
  assert.notEqual(proposal.status, 'complete');
  assert.ok(proposal.entries.some(entry => entry.slot_id === 2 && entry.teaching_load_id === 2));
  assert.ok(proposal.entries.every(entry => entry.day_of_week === 0 && entry.slot_id !== 3));
  const preview = (await (await adoptionPreview(context, proposal)).json()).data;
  assert.equal(preview.can_apply, false);
  assert.ok(preview.blockers.some(issue => issue.code === 'incomplete_weekly_demand'));
});

test('saved schedule diagnostics reveal excess working days even with multiple lessons per occupied day', async () => {
  const context = await fixture();
  context.database.exec(`
    UPDATE timetable_teaching_loads SET weekly_periods = 4 WHERE id = 1;
    INSERT INTO timetable_entries (school_id,academic_year_id,slot_id,teaching_load_id) VALUES (1,1,1,1),(1,1,2,1),(1,1,3,1),(1,1,4,1);
    INSERT INTO timetable_teacher_constraints (school_id,academic_year_id,employee_id,max_working_days) VALUES (1,1,1,1);
  `);
  const gridResponse = await call(context,context.tokens.owner,'GET','/api/timetable/grid?school_id=1&academic_year_id=1&class_id=1');
  const grid = (await gridResponse.json()).data;
  assert.equal(grid.entries.length,4);
  assert.ok(grid.entries.every(entry=>entry.hard_conflicts.some(issue=>issue.code==='teacher_max_working_days')));
  const masterResponse = await call(context,context.tokens.owner,'GET','/api/timetable/master-grid?school_id=1&academic_year_id=1');
  const master = (await masterResponse.json()).data;
  assert.equal(master.invalid_entry_count,4);
});

test('bulk section pinning leaves sibling sections unlocked', async () => {
  const context = await fixture();
  context.database.exec(`
    INSERT INTO sections (id,school_id,class_id,name,status) VALUES (21,1,1,'A','active'),(22,1,1,'B','active');
    UPDATE timetable_teaching_loads SET section_id=21 WHERE id=1;
    INSERT INTO timetable_teaching_loads (id,school_id,academic_year_id,class_id,section_id,subject_id,employee_id,weekly_periods,status)
      VALUES (5,1,1,1,22,1,2,2,'active');
    INSERT INTO timetable_entries (school_id,academic_year_id,slot_id,teaching_load_id) VALUES (1,1,1,1),(1,1,1,5);
  `);
  const response = await call(context, context.tokens.owner, 'PUT', '/api/timetable/entries/lock-scope', {
    school_id: 1, academic_year_id: 1, expected_revision: currentRevision(context), scope: {kind:'section',class_id:1,section_id:21}, is_locked:1,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(officialRows(context.database).map(entry => [entry.teaching_load_id,entry.is_locked]), [[1,1],[5,0]]);
});

function currentRevision(context) {
  return context.database.prepare('SELECT revision FROM timetable_revisions WHERE school_id = 1 AND academic_year_id = 1').get().revision;
}

test('bulk locks scope by class and stage, preserves other school/year and removes temporary unlock permissions', async () => {
  const context = await fixture(); seedCurrent(context);
  const otherSchool = officialRows(context.database, 2, 2), otherYear = officialRows(context.database, 1, 3);
  const change = (scope, locked, revision = currentRevision(context)) => call(context, context.tokens.owner, 'PUT', '/api/timetable/entries/lock-scope', {
    school_id: 1, academic_year_id: 1, expected_revision: revision, scope, is_locked: locked,
  });
  assert.equal((await change({ kind: 'class', class_id: 1 }, 1)).status, 200);
  assert.deepEqual(officialRows(context.database).map(entry => entry.is_locked), [1, 0]);
  assert.equal((await change({ kind: 'stage', stage: 'ابتدائي' }, 1)).status, 200);
  assert.deepEqual(officialRows(context.database).map(entry => entry.is_locked), [1, 1]);
  assert.equal((await change({ kind: 'stage', stage: 'ابتدائي' }, 0)).status, 200);
  assert.deepEqual(officialRows(context.database).map(entry => entry.is_locked), [0, 0]);
  assert.equal(context.database.prepare('SELECT COUNT(*) count FROM timetable_locked_entry_overrides').get().count, 0);
  assert.equal(context.database.prepare('SELECT COUNT(*) count FROM timetable_revision_assertions').get().count, 0);
  assert.deepEqual(officialRows(context.database, 2, 2), otherSchool); assert.deepEqual(officialRows(context.database, 1, 3), otherYear);
  const before = officialRows(context.database);
  assert.equal((await change({ kind: 'stage', stage: 'ابتدائي' }, 1, 0)).status, 409);
  assert.deepEqual(officialRows(context.database), before);
});

test('bulk lock failure rolls every row and revision back atomically', async () => {
  const context = await fixture(); seedCurrent(context);
  context.database.exec(`CREATE TRIGGER qa_fail_bulk_lock BEFORE UPDATE OF is_locked ON timetable_entries
    WHEN NEW.teaching_load_id = 2 BEGIN SELECT RAISE(ABORT, 'qa simulated failure'); END;`);
  const before = officialRows(context.database), revision = currentRevision(context);
  const response = await call(context, context.tokens.owner, 'PUT', '/api/timetable/entries/lock-scope', {
    school_id: 1, academic_year_id: 1, expected_revision: revision, scope: { kind: 'school' }, is_locked: 1,
  });
  assert.equal(response.status, 500); assert.deepEqual(officialRows(context.database), before);
  assert.equal(currentRevision(context), revision);
  assert.equal(context.database.prepare('SELECT COUNT(*) count FROM timetable_revision_assertions').get().count, 0);
});

test('scope mutations reject other tenants, unprivileged roles and wrong class-section combinations', async () => {
  const context = await fixture(); seedCurrent(context);
  const body = { school_id: 1, academic_year_id: 1, expected_revision: currentRevision(context), scope: { kind: 'class', class_id: 1 }, is_locked: 1 };
  assert.equal((await call(context, context.tokens.teacher, 'PUT', '/api/timetable/entries/lock-scope', body)).status, 403);
  assert.equal((await call(context, context.tokens.owner, 'PUT', '/api/timetable/entries/lock-scope', { ...body, school_id: 2 })).status, 403);
  assert.equal((await call(context, context.tokens.owner, 'PUT', '/api/timetable/entries/lock-scope', { ...body, scope: { kind: 'class', class_id: 3 } })).status, 400);
  assert.equal((await call(context, context.tokens.owner, 'POST', '/api/timetable/solver/preview', { school_id: 1, academic_year_id: 1,
    generation_scope: { kind: 'section', class_id: 1, section_id: 999 } })).status, 400);
});

for (const operation of ['apply', 'lock-scope']) {
  test(`${operation} atomically rejects changed stage membership even when legacy revision did not change`, async () => {
    const context = await fixture(); seedCurrent(context);
    context.database.exec("UPDATE classes SET stage = 'متوسط' WHERE id = 2");
    const scope = {kind:'stage',stage:'ابتدائي'};
    const proposal = await generate(context, context.tokens.owner, {generation_scope:scope});
    const before = context.database.prepare('SELECT * FROM timetable_entries ORDER BY id').all();
    const revision = currentRevision(context), originalBatch = context.d1.batch.bind(context.d1);
    context.d1.batch = async statements => {
      context.database.exec("UPDATE classes SET stage = 'متوسط' WHERE id = 1");
      assert.equal(currentRevision(context), revision, 'this metadata change is outside legacy revision triggers');
      return originalBatch(statements);
    };
    const response = operation === 'apply'
      ? await call(context, context.tokens.owner, 'POST', '/api/timetable/solver/apply', adoptionBody(proposal))
      : await call(context, context.tokens.owner, 'PUT', '/api/timetable/entries/lock-scope', {
        school_id:1,academic_year_id:1,expected_revision:revision,scope,is_locked:1,
      });
    assert.equal(response.status,409);
    assert.equal((await response.json()).code,'stale_timetable_proposal');
    assert.deepEqual(context.database.prepare('SELECT * FROM timetable_entries ORDER BY id').all(),before);
    assert.equal(context.database.prepare('SELECT COUNT(*) count FROM timetable_revision_assertions').get().count,0);
    assert.equal(context.database.prepare('SELECT COUNT(*) count FROM timetable_schedule_versions').get().count,0);
  });
}

test('adoption preview performs zero writes and returns comparison', async () => {
  const context = await fixture(); seedCurrent(context);
  const proposal = await generate(context);
  const before = JSON.stringify(officialRows(context.database));
  const versionCount = context.database.prepare('SELECT COUNT(*) count FROM timetable_schedule_versions').get().count;
  context.d1.prepareCount = 0;
  const response = await adoptionPreview(context, proposal);
  assert.equal(response.status, 200);
  const data = (await response.json()).data;
  assert.equal(data.can_apply, true);
  assert.equal(typeof data.comparison.moved, 'number');
  assert.equal(JSON.stringify(officialRows(context.database)), before);
  assert.equal(context.database.prepare('SELECT COUNT(*) count FROM timetable_schedule_versions').get().count, versionCount);
  console.log(`TIMETABLE_QUERY_BENCHMARK adoption_preview=${context.d1.prepareCount}`);
  assert.ok(context.d1.prepareCount <= 14);
});

test('adoption preview rejects unknown top-level fields', async () => {
  const context = await fixture(); const proposal = await generate(context);
  const response = await adoptionPreview(context, proposal, { unexpected: true });
  assert.equal(response.status, 400);
});

test('adoption preview rejects unknown proposal entry fields', async () => {
  const context = await fixture(); const proposal = await generate(context);
  const entries = proposalEntries(proposal); entries[0].unknown = true;
  const response = await call(context, context.tokens.owner, 'POST', '/api/timetable/solver/adoption-preview', {
    school_id: 1, academic_year_id: 1, proposal_revision: proposal.timetable_revision,
    proposal_digest: proposal.proposal_digest, entries,
  });
  assert.equal(response.status, 400);
});

test('server recomputes and rejects a forged proposal digest', async () => {
  const context = await fixture(); const proposal = await generate(context);
  const response = await adoptionPreview(context, proposal, { proposal_digest: '0'.repeat(64) });
  assert.equal(response.status, 200);
  const data = (await response.json()).data;
  assert.equal(data.can_apply, false);
  assert.ok(data.blockers.some((item) => item.code === 'proposal_digest_mismatch'));
});

test('partial proposal cannot pass adoption preview', async () => {
  const context = await fixture(); const proposal = await generate(context);
  const entries = proposalEntries(proposal).slice(0, -1);
  const response = await call(context, context.tokens.owner, 'POST', '/api/timetable/solver/adoption-preview', {
    school_id: 1, academic_year_id: 1, proposal_revision: proposal.timetable_revision,
    proposal_digest: proposal.proposal_digest, entries,
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.can_apply, false);
});

test('partial proposal cannot be adopted even with its correctly recomputed digest', async () => {
  const context = await fixture(); const proposal = await generate(context);
  const entries = proposalEntries(proposal).slice(0, -1);
  const previewResponse = await call(context, context.tokens.owner, 'POST', '/api/timetable/solver/adoption-preview', {
    school_id: 1, academic_year_id: 1, proposal_revision: proposal.timetable_revision,
    proposal_digest: proposal.proposal_digest, entries,
  });
  const preview = (await previewResponse.json()).data;
  const response = await call(context, context.tokens.owner, 'POST', '/api/timetable/solver/apply', {
    school_id: 1, academic_year_id: 1, expected_revision: proposal.timetable_revision,
    proposal_digest: preview.proposal_digest, entries, confirm_apply: true,
  });
  assert.equal(response.status, 400);
  assert.equal(officialRows(context.database).length, 0);
});

test('automatic adoption still requires every current persisted lock to be preserved', async () => {
  const context = await fixture();
  seedCurrent(context, true);
  const before = officialRows(context.database);
  const proposal = await generate(context, context.tokens.owner, { use_current_locked_entries: false });
  proposal.entries = proposal.entries.map(entry => ({ ...entry, is_locked: 0 }));
  proposal.proposal_digest = await computeTimetableProposalDigest({ schoolId: 1, academicYearId: 1,
    revision: proposal.timetable_revision, entries: proposalEntries(proposal), generationScope: proposal.generation_scope });
  const previewResponse = await adoptionPreview(context, proposal);
  const preview = (await previewResponse.json()).data;
  assert.equal(preview.can_apply, false);
  assert.ok(preview.blockers.some((blocker) => blocker.code === 'locked_entry_not_preserved'));
  const applyResponse = await call(context, context.tokens.owner, 'POST', '/api/timetable/solver/apply', adoptionBody(proposal));
  assert.equal(applyResponse.status, 400);
  assert.deepEqual(officialRows(context.database), before);
});

test('apply requires an explicit confirmation marker', async () => {
  const context = await fixture(); const proposal = await generate(context);
  const response = await call(context, context.tokens.owner, 'POST', '/api/timetable/solver/apply', { ...adoptionBody(proposal), confirm_apply: false });
  assert.equal(response.status, 400);
  assert.equal(officialRows(context.database).length, 0);
});

test('complete proposal atomically becomes the canonical official timetable', async () => {
  const context = await fixture(); seedCurrent(context);
  const proposal = await generate(context);
  context.d1.prepareCount = 0;
  const response = await call(context, context.tokens.owner, 'POST', '/api/timetable/solver/apply', adoptionBody(proposal));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.data.applied, true);
  const expected = proposalEntries(proposal)
    .map((row) => [row.slot_id, row.teaching_load_id, row.is_locked])
    .sort((left, right) => left[1] - right[1] || left[0] - right[0]);
  assert.deepEqual(officialRows(context.database).map((row) => [row.slot_id, row.teaching_load_id, row.is_locked]), expected);
  console.log(`TIMETABLE_QUERY_BENCHMARK adoption_apply=${context.d1.prepareCount}`);
  assert.ok(context.d1.prepareCount <= 24);
});

test('apply snapshots the exact previous timetable before replacement', async () => {
  const context = await fixture(); seedCurrent(context, true);
  const old = officialRows(context.database);
  const proposal = await generate(context, context.tokens.owner, { use_current_locked_entries: true });
  const response = await call(context, context.tokens.owner, 'POST', '/api/timetable/solver/apply', adoptionBody(proposal));
  assert.equal(response.status, 200);
  const version = context.database.prepare("SELECT * FROM timetable_schedule_versions WHERE source = 'automatic_adoption'").get();
  assert.equal(version.old_entry_count, old.length);
  const snapshot = context.database.prepare('SELECT slot_id, teaching_load_id, is_locked FROM timetable_schedule_version_entries WHERE version_id = ? ORDER BY teaching_load_id, slot_id').all(version.id);
  assert.deepEqual(snapshot.map((row) => ({ ...row })), old.map(({ slot_id, teaching_load_id, is_locked }) => ({ slot_id, teaching_load_id, is_locked })));
});

test('adopted entries and audit metadata record the authenticated user', async () => {
  const context = await fixture(); const proposal = await generate(context);
  assert.equal((await call(context, context.tokens.owner, 'POST', '/api/timetable/solver/apply', adoptionBody(proposal))).status, 200);
  assert.ok(officialRows(context.database).every((row) => row.created_by_user_id === 1 && row.updated_by_user_id === 1));
  assert.equal(context.database.prepare('SELECT created_by_user_id FROM timetable_schedule_versions').get().created_by_user_id, 1);
});

test('adoption leaves other school and other academic year untouched', async () => {
  const context = await fixture();
  const otherSchool = officialRows(context.database, 2, 2);
  const otherYear = officialRows(context.database, 1, 3);
  const proposal = await generate(context);
  assert.equal((await call(context, context.tokens.owner, 'POST', '/api/timetable/solver/apply', adoptionBody(proposal))).status, 200);
  assert.deepEqual(officialRows(context.database, 2, 2), otherSchool);
  assert.deepEqual(officialRows(context.database, 1, 3), otherYear);
});

for (const [label, mutate] of [
  ['manual entry', (c) => c.database.prepare('INSERT INTO timetable_entries (school_id, academic_year_id, slot_id, teaching_load_id) VALUES (1,1,1,1)').run()],
  ['teacher availability', (c) => c.database.prepare("INSERT INTO timetable_teacher_availability (school_id, academic_year_id, employee_id, slot_id, status) VALUES (1,1,1,1,'preferred')").run()],
  ['teaching load', (c) => c.database.prepare('UPDATE timetable_teaching_loads SET weekly_periods = 1 WHERE id = 1').run()],
  ['slot', (c) => c.database.prepare("UPDATE timetable_slots SET label = 'Changed' WHERE id = 1").run()],
  ['day', (c) => c.database.prepare('UPDATE timetable_days SET order_index = 5 WHERE id = 1').run()],
]) test(`${label} change makes an earlier proposal stale with zero adoption writes`, async () => {
  const context = await fixture(); const proposal = await generate(context);
  mutate(context);
  const before = officialRows(context.database);
  const response = await call(context, context.tokens.owner, 'POST', '/api/timetable/solver/apply', adoptionBody(proposal));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'stale_timetable_proposal');
  assert.deepEqual(officialRows(context.database), before);
  assert.equal(context.database.prepare('SELECT COUNT(*) count FROM timetable_schedule_versions').get().count, 0);
});

test('lock change makes an earlier proposal stale', async () => {
  const context = await fixture(); seedCurrent(context);
  const proposal = await generate(context);
  const id = context.database.prepare('SELECT id FROM timetable_entries WHERE school_id = 1 AND academic_year_id = 1 LIMIT 1').get().id;
  const lock = await call(context, context.tokens.owner, 'PUT', `/api/timetable/entries/${id}/lock`, { school_id: 1, academic_year_id: 1, is_locked: 1 });
  assert.equal(lock.status, 200);
  assert.equal((await call(context, context.tokens.owner, 'POST', '/api/timetable/solver/apply', adoptionBody(proposal))).status, 409);
});

test('two tabs applying the same revision allow only the first write', async () => {
  const context = await fixture(); const proposal = await generate(context);
  const first = await call(context, context.tokens.owner, 'POST', '/api/timetable/solver/apply', adoptionBody(proposal));
  const second = await call(context, context.tokens.owner, 'POST', '/api/timetable/solver/apply', adoptionBody(proposal));
  assert.equal(first.status, 200);
  assert.equal(second.status, 409);
  assert.equal(context.database.prepare('SELECT COUNT(*) count FROM timetable_schedule_versions').get().count, 1);
});

test('injected middle insertion failure rolls back entries, snapshot and revision', async () => {
  const context = await fixture(); seedCurrent(context);
  const proposal = await generate(context, context.tokens.owner, { use_current_locked_entries: false });
  const beforeEntries = officialRows(context.database);
  const beforeRevision = context.database.prepare('SELECT revision FROM timetable_revisions WHERE school_id = 1 AND academic_year_id = 1').get().revision;
  const failingSlot = proposal.entries[0].slot_id;
  context.database.exec(`CREATE TRIGGER qa_fail_adoption BEFORE INSERT ON timetable_entries WHEN NEW.school_id = 1 AND NEW.academic_year_id = 1 AND NEW.slot_id = ${Number(failingSlot)} BEGIN SELECT RAISE(ABORT, 'qa injected failure'); END;`);
  const response = await call(context, context.tokens.owner, 'POST', '/api/timetable/solver/apply', adoptionBody(proposal));
  assert.equal(response.status, 500);
  assert.deepEqual(officialRows(context.database), beforeEntries);
  assert.equal(context.database.prepare('SELECT COUNT(*) count FROM timetable_schedule_versions').get().count, 0);
  assert.equal(context.database.prepare('SELECT revision FROM timetable_revisions WHERE school_id = 1 AND academic_year_id = 1').get().revision, beforeRevision);
});

test('lock endpoint persists lock and explicit unlock atomically', async () => {
  const context = await fixture(); seedCurrent(context);
  const id = context.database.prepare('SELECT id FROM timetable_entries WHERE school_id = 1 AND academic_year_id = 1 ORDER BY id LIMIT 1').get().id;
  assert.equal((await call(context, context.tokens.owner, 'PUT', `/api/timetable/entries/${id}/lock`, { school_id: 1, academic_year_id: 1, is_locked: 1 })).status, 200);
  assert.equal(context.database.prepare('SELECT is_locked FROM timetable_entries WHERE id = ?').get(id).is_locked, 1);
  assert.equal((await call(context, context.tokens.owner, 'PUT', `/api/timetable/entries/${id}/lock`, { school_id: 1, academic_year_id: 1, is_locked: 0 })).status, 200);
  assert.equal(context.database.prepare('SELECT is_locked FROM timetable_entries WHERE id = ?').get(id).is_locked, 0);
  assert.equal(context.database.prepare('SELECT COUNT(*) count FROM timetable_locked_entry_overrides').get().count, 0);
});

test('locked move requires backend confirmation and confirmed move unlocks', async () => {
  const context = await fixture(); seedCurrent(context, true);
  const id = context.database.prepare('SELECT id FROM timetable_entries WHERE school_id = 1 AND academic_year_id = 1 AND is_locked = 1').get().id;
  const body = { school_id: 1, academic_year_id: 1, slot_id: 3 };
  assert.equal((await call(context, context.tokens.owner, 'PUT', `/api/timetable/entries/${id}`, body)).status, 409);
  assert.equal((await call(context, context.tokens.owner, 'PUT', `/api/timetable/entries/${id}`, { ...body, confirm_unlock_locked_entry: true })).status, 200);
  assert.deepEqual({ ...context.database.prepare('SELECT slot_id, is_locked FROM timetable_entries WHERE id = ?').get(id) }, { slot_id: 3, is_locked: 0 });
});

test('locked delete requires backend confirmation and confirmed delete is scoped', async () => {
  const context = await fixture(); seedCurrent(context, true);
  const id = context.database.prepare('SELECT id FROM timetable_entries WHERE school_id = 1 AND academic_year_id = 1 AND is_locked = 1').get().id;
  assert.equal((await call(context, context.tokens.owner, 'DELETE', `/api/timetable/entries/${id}`, { school_id: 1, academic_year_id: 1 })).status, 409);
  assert.equal((await call(context, context.tokens.owner, 'DELETE', `/api/timetable/entries/${id}`, { school_id: 1, academic_year_id: 1, confirm_unlock_locked_entry: true })).status, 200);
  assert.equal(context.database.prepare('SELECT COUNT(*) count FROM timetable_entries WHERE id = ?').get(id).count, 0);
});

test('tenant owner cannot preview, apply or read versions across schools', async () => {
  const context = await fixture(); const proposal = await generate(context);
  const preview = await adoptionPreview(context, proposal, { school_id: 2, academic_year_id: 2 });
  const apply = await call(context, context.tokens.owner, 'POST', '/api/timetable/solver/apply', { ...adoptionBody(proposal), school_id: 2, academic_year_id: 2 });
  const versions = await call(context, context.tokens.owner, 'GET', '/api/timetable/versions?school_id=2&academic_year_id=2');
  assert.deepEqual([preview.status, apply.status, versions.status], [403, 403, 403]);
});

test('system admin requires explicit target school for timetable writes', async () => {
  const context = await fixture();
  const response = await call(context, context.tokens.admin, 'POST', '/api/timetable/solver/preview', { academic_year_id: 1 });
  assert.equal(response.status, 400);
});

test('teacher and accountant remain forbidden from adoption and versions', async () => {
  for (const role of ['teacher', 'accountant']) {
    const context = await fixture();
    assert.equal((await call(context, context.tokens[role], 'POST', '/api/timetable/solver/preview', { school_id: 1, academic_year_id: 1 })).status, 403);
    assert.equal((await call(context, context.tokens[role], 'GET', '/api/timetable/versions?school_id=1&academic_year_id=1')).status, 403);
  }
});

test('principal retains timetable proposal management access', async () => {
  const context = await fixture();
  assert.equal((await call(context, context.tokens.principal, 'POST', '/api/timetable/solver/preview', { school_id: 1, academic_year_id: 1 })).status, 200);
});

test('version listing query count is constant as history grows', async () => {
  async function measured(extraVersions) {
    const context = await fixture();
    for (let index = 0; index < extraVersions; index += 1) context.database.prepare("INSERT INTO timetable_schedule_versions (version_key, school_id, academic_year_id, source, previous_revision, created_by_user_id, old_entry_count, new_entry_count, locked_entry_count, proposal_digest) VALUES (?,1,1,'automatic_adoption',0,1,0,0,0,'digest')").run(`v-${index}`);
    context.d1.prepareCount = 0;
    assert.equal((await call(context, context.tokens.owner, 'GET', '/api/timetable/versions?school_id=1&academic_year_id=1')).status, 200);
    return context.d1.prepareCount;
  }
  const emptyCount = await measured(0);
  const populatedCount = await measured(30);
  console.log(`TIMETABLE_QUERY_BENCHMARK versions_empty=${emptyCount} versions_30=${populatedCount}`);
  assert.equal(emptyCount, populatedCount);
});

async function adoptedFixture() {
  const context = await fixture(); seedCurrent(context);
  const proposal = await generate(context);
  const response = await call(context, context.tokens.owner, 'POST', '/api/timetable/solver/apply', adoptionBody(proposal));
  assert.equal(response.status, 200);
  const version = context.database.prepare('SELECT * FROM timetable_schedule_versions ORDER BY id DESC LIMIT 1').get();
  return { context, proposal, version };
}

test('version detail endpoint returns immutable snapshot entries', async () => {
  const { context, version } = await adoptedFixture();
  const response = await call(context, context.tokens.owner, 'GET', `/api/timetable/versions/${version.id}?school_id=1&academic_year_id=1`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.entries.length, 2);
});

test('restore preview allows structurally valid history below current demand without writes', async () => {
  const { context, version } = await adoptedFixture();
  const before = officialRows(context.database);
  const response = await call(context, context.tokens.owner, 'POST', `/api/timetable/versions/${version.id}/restore-preview`, { school_id: 1, academic_year_id: 1 });
  assert.equal(response.status, 200);
  const data = (await response.json()).data;
  assert.equal(data.can_apply, true);
  assert.equal(data.restorable_entry_count, 2);
  assert.equal(data.invalid_historical_entry_count, 0);
  assert.equal(data.weekly_demand.current_demand_complete, false);
  assert.equal(data.weekly_demand.missing_periods, 2);
  assert.ok(data.warnings.includes('هذا الإصدار لا يغطي جميع الأنصبة الأسبوعية الحالية.'));
  assert.deepEqual(officialRows(context.database), before);
});

test('exact structurally valid incomplete history restores without inventing missing periods', async () => {
  const { context, version } = await adoptedFixture();
  const historical = context.database.prepare(`
    SELECT slot_id, teaching_load_id, is_locked
    FROM timetable_schedule_version_entries
    WHERE version_id = ? ORDER BY teaching_load_id, slot_id
  `).all(version.id).map((entry) => ({ ...entry }));
  const preview = await previewHistoricalRestore(context, version.id);
  const response = await applyHistoricalRestore(context, version.id, preview);
  assert.equal(response.status, 200);
  assert.deepEqual(
    officialRows(context.database).map(({ slot_id, teaching_load_id, is_locked }) => ({ slot_id, teaching_load_id, is_locked })),
    historical,
  );
});

test('confirmed restore replaces current locks with the historical snapshot lock state', async () => {
  const context = await fixture();
  seedCurrent(context, true);
  const currentBefore = officialRows(context.database);
  const historicalEntries = [
    { slot_id: 2, teaching_load_id: 1, is_locked: 1 },
    { slot_id: 4, teaching_load_id: 1, is_locked: 0 },
    { slot_id: 1, teaching_load_id: 2, is_locked: 0 },
    { slot_id: 3, teaching_load_id: 2, is_locked: 1 },
  ];
  const version = createHistoricalVersion(context, historicalEntries);
  const preview = await previewHistoricalRestore(context, version.id);
  assert.equal(preview.can_apply, true);
  assert.ok(!preview.blockers.some((blocker) => blocker.code === 'locked_entry_not_preserved'));
  const response = await applyHistoricalRestore(context, version.id, preview);
  assert.equal(response.status, 200);
  assert.deepEqual(
    officialRows(context.database).map(({ slot_id, teaching_load_id, is_locked }) => ({ slot_id, teaching_load_id, is_locked })),
    historicalEntries.sort((left, right) => left.teaching_load_id - right.teaching_load_id || left.slot_id - right.slot_id),
  );
  const currentSnapshot = context.database.prepare("SELECT * FROM timetable_schedule_versions WHERE source = 'manual_restore' ORDER BY id DESC LIMIT 1").get();
  const snapshottedEntries = context.database.prepare(`
    SELECT slot_id, teaching_load_id, is_locked
    FROM timetable_schedule_version_entries
    WHERE version_id = ? ORDER BY teaching_load_id, slot_id
  `).all(currentSnapshot.id).map((entry) => ({ ...entry }));
  assert.deepEqual(
    snapshottedEntries,
    currentBefore.map(({ slot_id, teaching_load_id, is_locked }) => ({ slot_id, teaching_load_id, is_locked })),
  );
});

test('valid complete historical version restores and snapshots current schedule', async () => {
  const context = await fixture();
  let first = await generate(context);
  assert.equal((await call(context, context.tokens.owner, 'POST', '/api/timetable/solver/apply', adoptionBody(first))).status, 200);
  context.database.prepare('UPDATE timetable_entries SET is_locked = 1 WHERE id = (SELECT id FROM timetable_entries WHERE school_id = 1 AND academic_year_id = 1 LIMIT 1)').run();
  const second = await generate(context, context.tokens.owner, { use_current_locked_entries: true });
  assert.equal((await call(context, context.tokens.owner, 'POST', '/api/timetable/solver/apply', adoptionBody(second))).status, 200);
  const version = context.database.prepare("SELECT * FROM timetable_schedule_versions WHERE source = 'automatic_adoption' ORDER BY id DESC LIMIT 1").get();
  const previewResponse = await call(context, context.tokens.owner, 'POST', `/api/timetable/versions/${version.id}/restore-preview`, { school_id: 1, academic_year_id: 1 });
  assert.equal(previewResponse.status, 200);
  const preview = (await previewResponse.json()).data;
  assert.equal(preview.can_apply, true);
  const restore = await call(context, context.tokens.owner, 'POST', `/api/timetable/versions/${version.id}/restore`, {
    school_id: 1, academic_year_id: 1, expected_revision: preview.revision,
    proposal_digest: preview.proposal_digest, confirm_restore: true,
  });
  assert.equal(restore.status, 200);
  const restoreVersion = context.database.prepare("SELECT * FROM timetable_schedule_versions WHERE source = 'manual_restore' ORDER BY id DESC LIMIT 1").get();
  assert.equal(restoreVersion.restored_from_version_id, version.id);
  assert.equal(restoreVersion.old_entry_count, 4);
});

test('stale restore is rejected before replacing the current timetable', async () => {
  const context = await fixture(); const proposal = await generate(context);
  assert.equal((await call(context, context.tokens.owner, 'POST', '/api/timetable/solver/apply', adoptionBody(proposal))).status, 200);
  const version = context.database.prepare('SELECT * FROM timetable_schedule_versions ORDER BY id DESC LIMIT 1').get();
  const preview = await call(context, context.tokens.owner, 'POST', `/api/timetable/versions/${version.id}/restore-preview`, { school_id: 1, academic_year_id: 1 });
  const data = (await preview.json()).data;
  context.database.prepare("UPDATE timetable_slots SET label = 'Changed later' WHERE id = 1").run();
  const response = await call(context, context.tokens.owner, 'POST', `/api/timetable/versions/${version.id}/restore`, { school_id: 1, academic_year_id: 1, expected_revision: data.revision, proposal_digest: data.proposal_digest, confirm_restore: true });
  assert.equal(response.status, 409);
});

test('injected restore insertion failure rolls back current schedule and restore snapshot', async () => {
  const context = await fixture();
  const first = await generate(context);
  assert.equal((await call(context, context.tokens.owner, 'POST', '/api/timetable/solver/apply', adoptionBody(first))).status, 200);
  const second = await generate(context);
  assert.equal((await call(context, context.tokens.owner, 'POST', '/api/timetable/solver/apply', adoptionBody(second))).status, 200);
  const version = context.database.prepare("SELECT * FROM timetable_schedule_versions WHERE old_entry_count = 4 ORDER BY id DESC LIMIT 1").get();
  const previewResponse = await call(context, context.tokens.owner, 'POST', `/api/timetable/versions/${version.id}/restore-preview`, { school_id: 1, academic_year_id: 1 });
  const preview = (await previewResponse.json()).data;
  assert.equal(preview.can_apply, true);
  const beforeEntries = officialRows(context.database);
  const beforeVersions = context.database.prepare('SELECT COUNT(*) count FROM timetable_schedule_versions').get().count;
  const beforeRevision = context.database.prepare('SELECT revision FROM timetable_revisions WHERE school_id = 1 AND academic_year_id = 1').get().revision;
  const failSlot = version == null ? 1 : context.database.prepare('SELECT slot_id FROM timetable_schedule_version_entries WHERE version_id = ? ORDER BY id LIMIT 1').get(version.id).slot_id;
  context.database.exec(`CREATE TRIGGER qa_fail_restore BEFORE INSERT ON timetable_entries WHEN NEW.school_id = 1 AND NEW.academic_year_id = 1 AND NEW.slot_id = ${Number(failSlot)} BEGIN SELECT RAISE(ABORT, 'qa injected restore failure'); END;`);
  const response = await call(context, context.tokens.owner, 'POST', `/api/timetable/versions/${version.id}/restore`, {
    school_id: 1, academic_year_id: 1, expected_revision: preview.revision,
    proposal_digest: preview.proposal_digest, confirm_restore: true,
  });
  assert.equal(response.status, 500);
  assert.deepEqual(officialRows(context.database), beforeEntries);
  assert.equal(context.database.prepare('SELECT COUNT(*) count FROM timetable_schedule_versions').get().count, beforeVersions);
  assert.equal(context.database.prepare('SELECT revision FROM timetable_revisions WHERE school_id = 1 AND academic_year_id = 1').get().revision, beforeRevision);
});

for (const [label, configure, entries, expectedCode] of [
  [
    'weekly-period excess',
    () => {},
    [
      { slot_id: 1, teaching_load_id: 1, is_locked: 0 },
      { slot_id: 2, teaching_load_id: 1, is_locked: 0 },
      { slot_id: 3, teaching_load_id: 1, is_locked: 0 },
    ],
    'weekly_periods_exceeded',
  ],
  [
    'hard class collision',
    (context) => context.database.exec(`
      INSERT INTO subjects (id, school_id, class_id, name, status) VALUES (4,1,1,'Science A','active');
      INSERT INTO timetable_teaching_loads
        (id, school_id, academic_year_id, class_id, subject_id, employee_id, weekly_periods, status)
      VALUES (5,1,1,1,4,2,1,'active');
    `),
    [
      { slot_id: 1, teaching_load_id: 1, is_locked: 0 },
      { slot_id: 1, teaching_load_id: 5, is_locked: 0 },
    ],
    'class_section_collision',
  ],
  [
    'teacher collision',
    (context) => context.database.prepare('UPDATE timetable_teaching_loads SET employee_id = 1 WHERE id = 2').run(),
    [
      { slot_id: 1, teaching_load_id: 1, is_locked: 0 },
      { slot_id: 1, teaching_load_id: 2, is_locked: 0 },
    ],
    'teacher_collision',
  ],
  [
    'unavailable teacher',
    (context) => context.database.prepare(`
      INSERT INTO timetable_teacher_availability
        (school_id, academic_year_id, employee_id, slot_id, status)
      VALUES (1,1,1,1,'unavailable')
    `).run(),
    [{ slot_id: 1, teaching_load_id: 1, is_locked: 0 }],
    'teacher_unavailable',
  ],
  [
    'inactive slot',
    (context) => context.database.prepare('UPDATE timetable_slots SET is_active = 0 WHERE id = 1').run(),
    [{ slot_id: 1, teaching_load_id: 1, is_locked: 0 }],
    'inactive_slot',
  ],
  [
    'invalid teaching load',
    (context) => context.database.prepare("UPDATE timetable_teaching_loads SET status = 'inactive' WHERE id = 1").run(),
    [{ slot_id: 1, teaching_load_id: 1, is_locked: 0 }],
    'invalid_teaching_load',
  ],
]) test(`restore rejects ${label}`, async () => {
  const context = await fixture();
  configure(context);
  const version = createHistoricalVersion(context, entries);
  const preview = await previewHistoricalRestore(context, version.id);
  assert.equal(preview.can_apply, false);
  assert.ok(preview.blockers.some((blocker) => blocker.code === expectedCode), expectedCode);
});

test('one invalid historical entry rejects the whole restore without subset writes', async () => {
  const context = await fixture();
  seedCurrent(context);
  const version = createHistoricalVersion(context, [
    { slot_id: 1, teaching_load_id: 1, is_locked: 0 },
    { slot_id: 2, teaching_load_id: 2, is_locked: 1 },
  ]);
  context.database.prepare('UPDATE timetable_slots SET is_active = 0 WHERE id = 1').run();
  const before = officialRows(context.database);
  const preview = await previewHistoricalRestore(context, version.id);
  assert.equal(preview.can_apply, false);
  assert.equal(preview.invalid_historical_entry_count, 1);
  assert.equal(preview.restorable_entry_count, 1);
  const response = await applyHistoricalRestore(context, version.id, preview);
  assert.equal(response.status, 400);
  assert.deepEqual(officialRows(context.database), before);
  assert.equal(context.database.prepare("SELECT COUNT(*) count FROM timetable_schedule_versions WHERE source = 'manual_restore'").get().count, 0);
});

test('restore with a now-invalid historical teaching load is rejected', async () => {
  const context = await fixture();
  const version = createHistoricalVersion(context, [
    { slot_id: 1, teaching_load_id: 1, is_locked: 0 },
  ], 'qa-now-invalid-load');
  context.database.prepare("UPDATE timetable_teaching_loads SET status = 'inactive' WHERE id = 1").run();
  const response = await call(context, context.tokens.owner, 'POST', `/api/timetable/versions/${version.id}/restore-preview`, { school_id: 1, academic_year_id: 1 });
  assert.equal(response.status, 200);
  const preview = (await response.json()).data;
  assert.equal(preview.can_apply, false);
  assert.ok(preview.blockers.some((blocker) => blocker.code === 'invalid_teaching_load'));
});

test('cross-school and cross-year version access is rejected', async () => {
  const { context, version } = await adoptedFixture();
  const crossSchool = await call(context, context.tokens.admin, 'GET', `/api/timetable/versions/${version.id}?school_id=2&academic_year_id=2`);
  const crossYear = await call(context, context.tokens.owner, 'GET', `/api/timetable/versions/${version.id}?school_id=1&academic_year_id=3`);
  assert.equal(crossSchool.status, 403);
  assert.equal(crossYear.status, 400);
});

test('current official locked entries are supplied as fixed re-solve input', async () => {
  const context = await fixture(); seedCurrent(context, true);
  const locked = context.database.prepare('SELECT slot_id, teaching_load_id FROM timetable_entries WHERE school_id = 1 AND academic_year_id = 1 AND is_locked = 1').get();
  const proposal = await generate(context, context.tokens.owner, { use_current_locked_entries: true });
  assert.ok(proposal.entries.some((entry) => entry.slot_id === locked.slot_id && entry.teaching_load_id === locked.teaching_load_id && entry.is_locked === 1));
});
