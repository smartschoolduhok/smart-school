// Read-only STAGING preflight. Every D1 query is asserted non-mutating.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { contentSnapshot, digest } from './lib/local-d1-restore.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [backupArgument, evidenceArgument, confirmation] = process.argv.slice(2);
assert.equal(confirmation, '--confirm-staging', 'Explicit --confirm-staging is required');
assert.ok(backupArgument && evidenceArgument, 'Backup and evidence paths are required');
const backupPath = resolve(backupArgument);
const evidencePath = resolve(evidenceArgument);
assert.ok(isAbsolute(backupPath) && existsSync(backupPath), 'Backup does not exist');
assert.ok(!backupPath.toLowerCase().startsWith(`${root.toLowerCase()}\\`), 'Backup must be outside the repository');
assert.ok(!evidencePath.toLowerCase().startsWith(`${root.toLowerCase()}\\`), 'Evidence must be outside the repository');

const target = 'smart-school-staging-db';
const targetId = '1bdb9c3d-08d6-4023-9cbc-64369d53198a';
const migrationName = '0034_result_card_publication.sql';
const wranglerPath = join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const commands = [];

function runWrangler(args, label) {
  assert.ok(args.includes('--remote'), `${label} must explicitly target remote STAGING`);
  assert.equal(args.includes('--local'), false, `${label} cannot target Local D1`);
  const startedAt = Date.now();
  const result = spawnSync(process.execPath, [wranglerPath, ...args], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 90_000,
    maxBuffer: 20_000_000,
    env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' },
  });
  commands.push({ label, exit_code: result.status, duration_ms: Date.now() - startedAt });
  assert.equal(result.status, 0, `${label}: ${result.stderr || result.stdout}`);
  return result.stdout;
}

async function readRemote(sql) {
  assert.match(sql.trim(), /^(?:SELECT|PRAGMA|WITH)\b/iu, 'Only read-only SQL is allowed');
  const output = runWrangler(
    ['d1', 'execute', target, '--remote', '--json', '--command', sql],
    `read-${createHash('sha256').update(sql).digest('hex').slice(0, 12)}`,
  );
  const parsed = JSON.parse(output);
  assert.ok(parsed.every(entry => entry.success === true), 'Remote D1 query failed');
  assert.ok(parsed.every(entry => entry.meta?.changed_db === false), 'Read-only query changed STAGING');
  assert.ok(parsed.every(entry => Number(entry.meta?.rows_written || 0) === 0), 'Read-only query wrote rows');
  return parsed.flatMap(entry => entry.results || []);
}

const migrationFiles = readdirSync(join(root, 'migrations'))
  .filter(name => /^\d{4}_.+\.sql$/u.test(name))
  .sort();
assert.equal(migrationFiles.at(-1), migrationName, '0034 must be the only newest repository migration');
const history = await readRemote('SELECT id,name,applied_at FROM d1_migrations ORDER BY id');
assert.deepEqual(history.map(row => row.name), migrationFiles.slice(0, -1), 'Remote migration history/order mismatch');
assert.equal(new Set(history.map(row => row.name)).size, history.length, 'Duplicate remote migration name');
const pendingOutput = runWrangler(['d1', 'migrations', 'list', target, '--remote'], 'migration-list');
assert.ok(pendingOutput.includes(migrationName), '0034 is not reported pending');
assert.equal(pendingOutput.includes('No migrations to apply'), false, 'Expected 0034 to be pending');

const snapshot = await contentSnapshot(readRemote);
assert.equal(snapshot.foreignKeys.length, 0, 'foreign_key_check failed');
const readinessNames = snapshot.schema
  .filter(row => row.type === 'view' && row.name.endsWith('_readiness'))
  .map(row => row.name)
  .sort();
assert.deepEqual(readinessNames, [
  'academic_grade_policy_readiness',
  'finance_fee_readiness',
  'finance_payroll_readiness',
  'finance_payroll_school_readiness',
  'finance_treasury_readiness',
]);
const readiness = {};
for (const name of readinessNames) {
  const rows = await readRemote(`SELECT * FROM "${name}"`);
  readiness[name] = rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}
for (const [name, rows] of Object.entries(readiness)) {
  if (name.startsWith('finance_')) assert.ok(rows.every(row => Number(row.healthy) === 1), `${name} is unhealthy`);
}
assert.ok(readiness.academic_grade_policy_readiness.every(row => row.status === 'not_configured'), 'Unexpected academic readiness');

const backup = readFileSync(backupPath);
const evidence = {
  staging_only: true,
  read_only: true,
  target,
  target_id: targetId,
  captured_at: new Date().toISOString(),
  backup: {
    path: backupPath,
    bytes: backup.byteLength,
    sha256: createHash('sha256').update(backup).digest('hex').toUpperCase(),
  },
  migration_files: migrationFiles,
  migration_history: history,
  pending: [migrationName],
  foreign_key_check: snapshot.foreignKeys,
  readiness,
  table_count: Object.keys(snapshot.tables).length,
  snapshot,
  snapshot_hash: digest(snapshot),
  command_summary: commands,
};
writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
console.log(JSON.stringify({
  evidence_path: evidencePath,
  migration_count: history.length,
  pending: evidence.pending,
  foreign_key_violations: snapshot.foreignKeys.length,
  readiness: Object.fromEntries(Object.entries(readiness).map(([name, rows]) => [name, rows.length])),
  table_count: evidence.table_count,
  snapshot_hash: evidence.snapshot_hash,
  command_count: commands.length,
}));
