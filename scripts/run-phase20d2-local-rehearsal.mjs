// Isolated Local D1 rehearsal for a real STAGING export. No remote mode exists.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { getPlatformProxy } from 'wrangler';

import { contentSnapshot, digest, prepareLocalRestore } from './lib/local-d1-restore.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [backupArgument, preflightArgument, evidenceArgument] = process.argv.slice(2);
assert.ok(backupArgument && preflightArgument && evidenceArgument, 'Backup, preflight, and evidence paths are required');
const backupPath = resolve(backupArgument);
const preflightPath = resolve(preflightArgument);
const evidencePath = resolve(evidenceArgument);
for (const path of [backupPath, preflightPath]) assert.ok(isAbsolute(path) && existsSync(path), `Missing input: ${path}`);
for (const path of [backupPath, preflightPath, evidencePath]) {
  assert.ok(!path.toLowerCase().startsWith(`${root.toLowerCase()}\\`), 'All artifacts must remain outside the repository');
}

const migrationName = '0035_official_result_promotion.sql';
const workRoot = mkdtempSync(join(tmpdir(), 'smart-school-phase20d2-staging-local-'));
const migrationsDirectory = join(workRoot, 'migrations');
const statePath = join(workRoot, '.wrangler', 'state', 'v3');
const configPath = join(workRoot, 'wrangler.json');
const basePath = join(workRoot, 'restore-base.sql');
const databaseName = 'smart-school-phase20d2-rehearsal-local-only';
const wranglerPath = join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
mkdirSync(migrationsDirectory);
copyFileSync(join(root, 'migrations', migrationName), join(migrationsDirectory, migrationName));
writeFileSync(configPath, JSON.stringify({
  name: databaseName,
  compatibility_date: '2026-04-13',
  compatibility_flags: ['nodejs_compat'],
  d1_databases: [{
    binding: 'DB',
    database_name: databaseName,
    database_id: '00000000-0000-0000-0000-000000000035',
    migrations_dir: migrationsDirectory,
  }],
}));

const commandSummary = [];
function runLocal(args, label) {
  assert.equal(args.includes('--remote'), false, 'Remote D1 is forbidden');
  const result = spawnSync(process.execPath, [wranglerPath, 'd1', ...args, '--local', '--config', configPath], {
    cwd: workRoot,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 180_000,
    maxBuffer: 20_000_000,
    env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' },
  });
  commandSummary.push({ label, exit_code: result.status });
  assert.equal(result.status, 0, `${label}: ${result.stderr || result.stdout}`);
  return `${result.stdout || ''}${result.stderr || ''}`;
}

async function openLocal() {
  return getPlatformProxy({
    configPath,
    persist: { path: statePath },
    remoteBindings: false,
    envFiles: [],
  });
}

const quote = value => `"${value.replaceAll('"', '""')}"`;
async function historicalProjection(db, baseline) {
  const tables = {};
  for (const [name, table] of Object.entries(baseline.tables)) {
    const fields = table.columns.filter(column => column.hidden !== 1).map(column => column.name);
    const sql = 'SELECT ' + fields.flatMap((field, index) => [
      `typeof(${quote(field)}) AS t${index}`,
      `CASE typeof(${quote(field)}) WHEN 'null' THEN NULL WHEN 'integer' THEN CAST(${quote(field)} AS TEXT) WHEN 'real' THEN printf('%!.17g',${quote(field)}) ELSE hex(${quote(field)}) END AS v${index}`,
    ]).join(',') + ` FROM ${quote(name)}`;
    const rows = (await db.prepare(sql).all()).results;
    const content = rows.map(row => JSON.stringify(fields.map((_, index) => [row[`t${index}`], row[`v${index}`]]))).sort();
    tables[name] = { count: content.length, hash: digest(content), content };
  }
  return tables;
}

function assertMultisetContains(allRows, expectedRows, name) {
  const counts = new Map();
  for (const row of allRows) counts.set(row, (counts.get(row) || 0) + 1);
  for (const row of expectedRows) {
    const count = counts.get(row) || 0;
    assert.ok(count > 0, `Historical row changed or disappeared: ${name}`);
    counts.set(row, count - 1);
  }
}

const backup = readFileSync(backupPath);
const preflight = JSON.parse(readFileSync(preflightPath, 'utf8'));
const backupHash = createHash('sha256').update(backup).digest('hex').toUpperCase();
assert.equal(backup.byteLength, preflight.backup.bytes, 'Backup size differs from preflight');
assert.equal(backupHash, preflight.backup.sha256, 'Backup hash differs from preflight');
assert.deepEqual(preflight.pending, [migrationName]);

const restorePlan = prepareLocalRestore(backup.toString('utf8'));
writeFileSync(basePath, restorePlan.baseSql);
runLocal(['execute', databaseName, '--file', basePath], 'restore-base');
let local = await openLocal();
let sequenceBefore;
try {
  for (const insert of restorePlan.inserts) {
    const result = await local.env.DB.prepare(insert.sql).bind(...insert.values).run();
    assert.equal(result.success, true);
    assert.equal(result.meta.changes, 1);
  }
  const restored = await contentSnapshot(async sql => (await local.env.DB.prepare(sql).all()).results);
  assert.equal(digest(restored), preflight.snapshot_hash, 'Restored Local D1 differs from read-only STAGING snapshot');
  assert.deepEqual(restored, preflight.snapshot, 'Restored Local D1 values are not byte-for-byte equivalent');
  sequenceBefore = (await local.env.DB.prepare('SELECT name,seq FROM sqlite_sequence ORDER BY name').all()).results;
} finally {
  await local.dispose();
}

runLocal(['migrations', 'apply', databaseName], 'apply-0035');
const pendingOutput = runLocal(['migrations', 'list', databaseName], 'list-after-0035');
assert.ok(pendingOutput.includes('No migrations to apply'), 'Local 0035 remains pending');

local = await openLocal();
let after;
let historical;
let history;
let readiness;
let publicationCounts;
let sequenceAfter;
try {
  after = await contentSnapshot(async sql => (await local.env.DB.prepare(sql).all()).results);
  historical = await historicalProjection(local.env.DB, preflight.snapshot);
  for (const [name, before] of Object.entries(preflight.snapshot.tables)) {
    const projected = historical[name];
    if (name === 'd1_migrations') {
      assert.equal(projected.count, before.count + 1, 'Expected one new migration history row');
      assertMultisetContains(projected.content, before.content, name);
    } else if (name === 'sqlite_sequence') {
      // Wrangler records migration 36 in d1_migrations, so that one internal
      // counter must advance. Application-table counters must not move.
      continue;
    } else {
      assert.equal(projected.count, before.count, `Historical row count changed: ${name}`);
      assert.equal(projected.hash, before.hash, `Historical values changed: ${name}`);
      assert.deepEqual(projected.content, before.content, `Historical content changed: ${name}`);
    }
  }
  history = (await local.env.DB.prepare('SELECT id,name,applied_at FROM d1_migrations ORDER BY id').all()).results;
  assert.equal(history.length, 36);
  assert.equal(history.filter(row => row.name === migrationName).length, 1);
  assert.equal(history.at(-1).name, migrationName);
  sequenceAfter = (await local.env.DB.prepare('SELECT name,seq FROM sqlite_sequence ORDER BY name').all()).results;
  assert.deepEqual(
    sequenceAfter.filter(row => row.name !== 'd1_migrations'),
    sequenceBefore.filter(row => row.name !== 'd1_migrations'),
    'An application sqlite_sequence counter changed',
  );
  assert.equal(sequenceBefore.find(row => row.name === 'd1_migrations').seq, 35);
  assert.equal(sequenceAfter.find(row => row.name === 'd1_migrations').seq, 36);
  assert.equal(after.foreignKeys.length, 0, 'Local foreign_key_check failed');
  readiness = {
    student_promotion_result_readiness: (await local.env.DB.prepare('SELECT * FROM student_promotion_result_readiness ORDER BY school_id').all()).results,
    result_card_publication_readiness: (await local.env.DB.prepare('SELECT * FROM result_card_publication_readiness ORDER BY school_id').all()).results,
    academic_grade_policy_readiness: (await local.env.DB.prepare('SELECT * FROM academic_grade_policy_readiness ORDER BY school_id').all()).results,
    finance_fee_readiness: (await local.env.DB.prepare('SELECT * FROM finance_fee_readiness ORDER BY school_id').all()).results,
    finance_payroll_readiness: (await local.env.DB.prepare('SELECT * FROM finance_payroll_readiness ORDER BY school_id').all()).results,
    finance_payroll_school_readiness: (await local.env.DB.prepare('SELECT * FROM finance_payroll_school_readiness ORDER BY school_id').all()).results,
    finance_treasury_readiness: (await local.env.DB.prepare('SELECT * FROM finance_treasury_readiness ORDER BY school_id').all()).results,
  };
  assert.ok(readiness.student_promotion_result_readiness.every(row => row.status === 'healthy'));
  assert.ok(readiness.result_card_publication_readiness.every(row => row.status === 'healthy'));
  assert.ok(readiness.academic_grade_policy_readiness.every(row => row.status === 'not_configured'));
  for (const [name, rows] of Object.entries(readiness)) {
    if (name.startsWith('finance_')) assert.ok(rows.every(row => Number(row.healthy) === 1), `${name} is unhealthy`);
  }
  publicationCounts = (await local.env.DB.prepare('SELECT publication_status,COUNT(*) AS count FROM result_cards GROUP BY publication_status ORDER BY publication_status').all()).results;
  assert.equal((await local.env.DB.prepare('SELECT COUNT(*) AS count FROM student_promotion_result_decisions').first()).count, 0);
  assert.equal((await local.env.DB.prepare('SELECT COUNT(*) AS count FROM result_card_publication_write_assertions').first()).count, 0);
} finally {
  await local.dispose();
}

const evidence = {
  local_only: true,
  backup_path: backupPath,
  backup_bytes: backup.byteLength,
  backup_sha256: backupHash,
  preflight_evidence: preflightPath,
  work_root: workRoot,
  restored_statement_count: restorePlan.statementCount,
  restore_base_statement_count: restorePlan.baseStatementCount,
  bound_oversized_rows: restorePlan.inserts.map(insert => ({ parameter_count: insert.values.length, bound_bytes: insert.bytes })),
  exact_remote_restore_equality: true,
  historical_tables_compared: Object.keys(preflight.snapshot.tables).length,
  historical_columns_and_values_unchanged: true,
  sqlite_sequence_change: { table: 'd1_migrations', before: 35, after: 36 },
  migration_history_count: history.length,
  migration_once_and_last: true,
  pending_after: [],
  foreign_key_check: after.foreignKeys,
  publication_counts_unchanged: publicationCounts,
  readiness,
  command_summary: commandSummary,
};
writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence));
