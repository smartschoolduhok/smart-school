// Disposable genuine LOCAL D1 validation for Phase 20D.2. This runner copies
// migrations into a temporary config and cannot address a remote database.
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createServer } from 'vite';
import { getPlatformProxy } from 'wrangler';
import { signJWT } from '../src/lib/jwtSecurity.ts';
import { fixtureSQL, migrationFiles, root } from '../test/helpers/teaching-load-matrix-fixture.mjs';

const workRoot = mkdtempSync(join(tmpdir(), 'smart-school-official-promotion-local-'));
const migrationsDir = join(workRoot, 'migrations');
const stateDir = join(workRoot, 'state');
const xdgConfigHome = join(workRoot, 'xdg-config');
mkdirSync(migrationsDir);
mkdirSync(xdgConfigHome);
for (const file of migrationFiles) copyFileSync(join(root, 'migrations', file), join(migrationsDir, file));

const databaseName = 'official-promotion-local-only';
const configPath = join(workRoot, 'wrangler.json');
writeFileSync(configPath, JSON.stringify({
  name: databaseName,
  compatibility_date: '2026-04-13',
  compatibility_flags: ['nodejs_compat'],
  d1_databases: [{
    binding: 'DB',
    database_name: databaseName,
    database_id: '00000000-0000-0000-0000-000000000035',
    migrations_dir: 'migrations',
  }],
}, null, 2));

const commandEvidence = [];
function runLocal(args, label) {
  assert.equal(args.includes('--remote'), false);
  const command = [
    join(root, 'node_modules/wrangler/bin/wrangler.js'),
    'd1', ...args, databaseName, '--local', '--config', configPath, '--persist-to', stateDir,
  ];
  const result = spawnSync(process.execPath, command, {
    cwd: workRoot,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 180_000,
    maxBuffer: 10_000_000,
    env: {
      ...process.env,
      CI: 'true',
      WRANGLER_SEND_METRICS: 'false',
      XDG_CONFIG_HOME: xdgConfigHome,
    },
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  writeFileSync(join(workRoot, `${label}.log`), output);
  commandEvidence.push({ label, status: result.status, signal: result.signal ?? null });
  assert.equal(result.status, 0, `${label} failed: ${output}`);
}

runLocal(['migrations', 'apply'], '01-migrations');
const fixturesPath = join(workRoot, 'fixtures.sql');
writeFileSync(fixturesPath, fixtureSQL + `
INSERT INTO academic_years(id,school_id,name,starts_at,ends_at,is_active)
VALUES(4,1,'2027-2028','2027-09-01','2028-06-01',0);
INSERT INTO students(id,school_id,student_number,full_name,gender,status,class_id,section_id) VALUES
 (10,1,'LOCAL-PASS','Local Passed Student','ذكر','active',1,1),
 (11,1,'LOCAL-FAIL','Local Failed Student','ذكر','active',1,1),
 (12,1,'LOCAL-GRAD','Local Graduate Student','أنثى','active',1,1),
 (13,1,'LOCAL-COMP','Local Completion Student','أنثى','active',1,1);
INSERT INTO student_enrollments(
 id,school_id,student_id,academic_year_id,class_id,section_id,status,promotion_status,
 created_by_user_id,updated_by_user_id
) VALUES
 (10,1,10,1,1,1,'active','pending',1,1),
 (11,1,11,1,1,1,'active','pending',1,1),
 (12,1,12,1,1,1,'active','pending',1,1),
 (13,1,13,1,1,1,'active','pending',1,1);
`);
runLocal(['execute', '--file', fixturesPath], '02-fixtures');

const proxy = await getPlatformProxy({
  configPath,
  persist: { path: join(stateDir, 'v3') },
  remoteBindings: false,
  envFiles: [],
});
const vite = await createServer({ root, appType: 'custom', server: { middlewareMode: true, hmr: false } });

function snapshot(policyKind, academicStatusCode) {
  const labels = { pass: 'ناجح', fail: 'راسب', completion: 'مكمل' };
  return {
    schema_version: 5,
    card_mode: 'complete',
    exam_round: 'الدور الأول',
    academic_policy: {
      id: 501,
      version: 1,
      status: 'approved',
      policy_kind: policyKind,
      source_reference: 'قرار QA محلي فقط',
    },
    summary: {
      academic_status_code: academicStatusCode,
      academic_status: labels[academicStatusCode],
      overall_result_status: labels[academicStatusCode],
    },
    subjects: [],
  };
}

async function addCard(id, studentId, policyKind, statusCode) {
  const card = snapshot(policyKind, statusCode);
  await proxy.env.DB.prepare(`
    INSERT INTO result_cards(
      id,school_id,student_id,class_id,section_id,academic_year_id,
      card_number,verification_token,verification_hash,student_name_snapshot,
      class_name_snapshot,section_name_snapshot,school_name_snapshot,academic_year_snapshot,
      general_exemption_status,overall_result_status,card_data_json,generated_by_user_id,
      generated_at,status,publication_status,publication_revision,published_at,published_by_user_id
    ) VALUES(?,1,?,1,1,1,?,?,?,?,?,?,?,?,0,?,?,1,1789297000,'active','published',1,1789297100,1)
  `).bind(
    id,
    studentId,
    `RC-LOCAL-${id}`,
    `local-token-${id}`,
    `local-hash-${id}`,
    `Local Student ${id}`,
    'Class A',
    'A',
    'A',
    '2026-2027',
    card.summary.academic_status,
    JSON.stringify(card),
  ).run();
}

try {
  await addCard(10, 10, 'non_terminal', 'pass');
  await addCard(11, 11, 'non_terminal', 'fail');
  await addCard(12, 12, 'terminal', 'pass');
  await addCard(13, 13, 'terminal', 'completion');

  const { default: app } = await vite.ssrLoadModule('/src/worker.ts');
  const secret = 'official-promotion-genuine-local-d1-secret';
  const token = await signJWT({ email: 'owner@matrix.test', auth_version: 1 }, secret);
  async function api(path, body) {
    const response = await app.request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    }, { DB: proxy.env.DB, JWT_SECRET: secret, APP_ENV: 'test' });
    return { status: response.status, body: await response.json() };
  }

  const decisionResponse = await api('/api/student-enrollments/promotion/official-decisions', {
    school_id: 1,
    source_enrollment_ids: [10, 11, 12, 13],
  });
  assert.equal(decisionResponse.status, 200, JSON.stringify(decisionResponse.body));
  assert.deepEqual(
    decisionResponse.body.data.map(row => [row.state, row.required_action]),
    [['ready', 'promoted'], ['ready', 'repeated'], ['ready', 'graduated'], ['completion_pending', null]],
  );

  const inputs = [
    { source_enrollment_id: 10, action: 'promoted', target_academic_year_id: 4, target_class_id: 2, target_section_id: null },
    { source_enrollment_id: 11, action: 'repeated', target_academic_year_id: 4, target_class_id: 1, target_section_id: 1 },
    { source_enrollment_id: 12, action: 'graduated' },
  ];
  for (let index = 0; index < inputs.length; index++) {
    const cardId = 10 + index;
    const input = { ...inputs[index], school_id: 1, official_result_card_id: cardId, official_result_publication_revision: 1 };
    const preview = await api('/api/student-enrollments/promotion/preview', input);
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    const execution = await api('/api/student-enrollments/promotion', input);
    assert.equal(execution.status, 200, JSON.stringify(execution.body));
    assert.equal(execution.body.data.already_applied, false);
  }

  const pending = await api('/api/student-enrollments/promotion', {
    school_id: 1,
    source_enrollment_id: 13,
    action: 'graduated',
    official_result_card_id: 13,
    official_result_publication_revision: 1,
  });
  assert.equal(pending.status, 409, JSON.stringify(pending.body));
  assert.equal(pending.body.code, 'official_result_completion_pending');

  assert.deepEqual(
    (await proxy.env.DB.prepare('SELECT id,status,promotion_status FROM student_enrollments WHERE id BETWEEN 10 AND 13 ORDER BY id').all()).results,
    [
      { id: 10, status: 'completed', promotion_status: 'promoted' },
      { id: 11, status: 'completed', promotion_status: 'repeated' },
      { id: 12, status: 'completed', promotion_status: 'graduated' },
      { id: 13, status: 'active', promotion_status: 'pending' },
    ],
  );
  assert.equal((await proxy.env.DB.prepare('SELECT COUNT(*) AS count FROM student_promotion_result_decisions').first()).count, 3);
  assert.equal((await proxy.env.DB.prepare('SELECT status FROM student_promotion_result_readiness WHERE school_id=1').first()).status, 'healthy');
  assert.deepEqual((await proxy.env.DB.prepare('PRAGMA foreign_key_check').all()).results, []);
  assert.equal((await proxy.env.DB.prepare('SELECT COUNT(*) AS count FROM d1_migrations').first()).count, migrationFiles.length);

  const evidence = {
    local_only: true,
    migrations: migrationFiles.length,
    checks: 12,
    derived_actions: ['promoted', 'repeated', 'graduated'],
    completion_blocked: true,
    exact_result_revisions_pinned: true,
    decision_rows: 3,
    readiness: 'healthy',
    foreign_keys: 'clean',
    commands: commandEvidence,
    artifacts: workRoot,
  };
  writeFileSync(join(workRoot, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await vite.close();
  await proxy.dispose();
}
