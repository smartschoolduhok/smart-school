// Isolated Local D1 rehearsal for the Phase 21D STAGING export. No remote mode exists.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { getPlatformProxy } from 'wrangler';
import { contentSnapshot, digest, prepareLocalRestore } from './lib/local-d1-restore.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [backupArgument, preflightArgument, evidenceArgument] = process.argv.slice(2);
assert.ok(backupArgument && preflightArgument && evidenceArgument, 'Backup, preflight, and evidence paths are required');
const backupPath = resolve(backupArgument), preflightPath = resolve(preflightArgument), evidencePath = resolve(evidenceArgument);
for (const path of [backupPath, preflightPath]) assert.ok(isAbsolute(path) && existsSync(path), `Missing input: ${path}`);
for (const path of [backupPath, preflightPath, evidencePath]) assert.ok(!path.toLowerCase().startsWith(`${root.toLowerCase()}\\`), 'Artifacts must remain outside the repository');
const migrationName = '0041_homework.sql';
const workRoot = mkdtempSync(join(tmpdir(), 'smart-school-phase21d-staging-local-'));
const migrationsDirectory = join(workRoot, 'migrations');
const persistRoot = join(workRoot, '.wrangler', 'state');
const statePath = join(persistRoot, 'v3');
const configPath = join(workRoot, 'wrangler.json');
const databaseName = 'smart-school-phase21d-rehearsal-local-only';
const wranglerPath = join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
mkdirSync(migrationsDirectory);
copyFileSync(join(root, 'migrations', migrationName), join(migrationsDirectory, migrationName));
writeFileSync(configPath, JSON.stringify({
  name: databaseName, compatibility_date: '2026-04-13', compatibility_flags: ['nodejs_compat'],
  d1_databases: [{ binding: 'DB', database_name: databaseName, database_id: '00000000-0000-0000-0000-000000000041', migrations_dir: migrationsDirectory }],
}));
const commandSummary = [];
function runLocal(args, label) {
  assert.equal(args.includes('--remote'), false, 'Remote D1 is forbidden');
  const result = spawnSync(process.execPath, [wranglerPath, 'd1', ...args, '--local', '--persist-to', persistRoot, '--config', configPath], {
    cwd: workRoot, encoding: 'utf8', windowsHide: true, timeout: 180000, maxBuffer: 40000000,
    env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' },
  });
  commandSummary.push({ label, exit_code: result.status });
  assert.equal(result.status, 0, `${label}: ${result.stderr || result.stdout}`);
  return `${result.stdout || ''}${result.stderr || ''}`;
}
async function openLocal() {
  return getPlatformProxy({ configPath, persist: { path: statePath }, remoteBindings: false, envFiles: [] });
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
assert.deepEqual(preflight.pending, [migrationName]);
const restorePlan = prepareLocalRestore(backup.toString('utf8'));
let local = await openLocal();
await local.env.DB.prepare('SELECT 1').all();
await local.dispose();
const d1StateDirectory = join(statePath, 'd1', 'miniflare-D1DatabaseObject');
const sqliteFiles = readdirSync(d1StateDirectory).filter(name => name.endsWith('.sqlite') && name !== 'metadata.sqlite');
assert.equal(sqliteFiles.length, 1, 'Expected exactly one isolated Local D1 file');
const localDatabasePath = join(d1StateDirectory, sqliteFiles[0]);
const sqlite = new DatabaseSync(localDatabasePath);
try {
  sqlite.exec(restorePlan.baseSql);
  for (const insert of restorePlan.inserts) sqlite.prepare(insert.sql).run(...insert.values);
  commandSummary.push({ label: 'restore-base', exit_code: 0, local_d1_sqlite: true, chunks_verified: restorePlan.baseChunks.length });
} finally { sqlite.close(); }
local = await openLocal();
let sequenceBefore;
try {
  const restored = await contentSnapshot(async sql => (await local.env.DB.prepare(sql).all()).results);
  assert.equal(digest(restored), preflight.snapshot_hash, 'Restored Local D1 differs from read-only STAGING snapshot');
  assert.deepEqual(restored, preflight.snapshot, 'Restored Local D1 values/types are not equivalent');
  sequenceBefore = (await local.env.DB.prepare('SELECT name,seq FROM sqlite_sequence ORDER BY name').all()).results;
} finally { await local.dispose(); }
runLocal(['migrations', 'apply', databaseName], 'apply-0041');
const pendingOutput = runLocal(['migrations', 'list', databaseName], 'list-after-0041');
assert.ok(pendingOutput.includes('No migrations to apply'), 'Local 0041 remains pending');
local = await openLocal();
let after, history, readiness, sequenceAfter;
try {
  after = await contentSnapshot(async sql => (await local.env.DB.prepare(sql).all()).results);
  const historical = await historicalProjection(local.env.DB, preflight.snapshot);
  for (const [name, before] of Object.entries(preflight.snapshot.tables)) {
    const projected = historical[name];
    if (name === 'd1_migrations') {
      assert.equal(projected.count, before.count + 1);
      assertMultisetContains(projected.content, before.content, name);
    } else if (name !== 'sqlite_sequence') {
      assert.equal(projected.count, before.count, `Historical row count changed: ${name}`);
      assert.equal(projected.hash, before.hash, `Historical values changed: ${name}`);
      assert.deepEqual(projected.content, before.content, `Historical content changed: ${name}`);
    }
  }
  history = (await local.env.DB.prepare('SELECT id,name,applied_at FROM d1_migrations ORDER BY id').all()).results;
  assert.equal(history.length, 42);
  assert.equal(new Set(history.map(row => row.name)).size, 42);
  assert.equal(history.filter(row => row.name === migrationName).length, 1);
  assert.equal(history.at(-1).name, migrationName);
  sequenceAfter = (await local.env.DB.prepare('SELECT name,seq FROM sqlite_sequence ORDER BY name').all()).results;
  assert.deepEqual(sequenceAfter.filter(row => row.name !== 'd1_migrations'), sequenceBefore.filter(row => row.name !== 'd1_migrations'));
  assert.equal(after.foreignKeys.length, 0);
  assert.equal(Object.keys(after.tables).length, 83);
  for (const name of ['homework_assignments','homework_attachments','homework_audience','homework_audit','homework_write_guards']) assert.ok(after.tables[name], `Missing ${name}`);
  readiness = {};
  for (const name of Object.keys(preflight.readiness)) readiness[name] = (await local.env.DB.prepare(`SELECT * FROM ${quote(name)}`).all()).results;
  assert.deepEqual(readiness, preflight.readiness, 'Historical readiness changed');
} finally { await local.dispose(); }
const evidence = {
  local_only: true, backup_path: backupPath, backup_bytes: backup.byteLength, backup_sha256: backupHash,
  preflight_evidence: preflightPath, work_root: workRoot, restored_statement_count: restorePlan.statementCount,
  restore_base_statement_count: restorePlan.baseStatementCount, restore_chunk_count: restorePlan.baseChunks.length,
  bound_oversized_rows: restorePlan.inserts.map(insert => ({ parameter_count: insert.values.length, bound_bytes: insert.bytes })),
  exact_remote_restore_equality: true, historical_tables_compared: Object.keys(preflight.snapshot.tables).length,
  historical_columns_types_and_values_unchanged: true,
  migration_history_count: history.length, migration_once_and_last: true, pending_after: [],
  table_count: Object.keys(after.tables).length, application_table_count: Object.keys(after.tables).filter(name => name !== 'd1_migrations' && !name.startsWith('sqlite_')).length,
  foreign_key_check: after.foreignKeys, readiness, command_summary: commandSummary,
};
assert.equal(evidence.application_table_count, 81);
writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence));
