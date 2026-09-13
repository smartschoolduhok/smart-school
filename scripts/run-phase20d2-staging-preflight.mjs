// Read-only, explicitly scoped STAGING snapshot. Full row evidence stays outside Git.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { contentSnapshot, digest } from './lib/local-d1-restore.mjs';
import { stagingClient } from './lib/phase20d2-staging-client.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [backupArgument, evidenceArgument, confirmation] = process.argv.slice(2);
assert.equal(confirmation, '--confirm-staging');
assert.ok(backupArgument && evidenceArgument);
const backupPath = resolve(backupArgument), evidencePath = resolve(evidenceArgument);
for (const path of [backupPath, evidencePath]) assert.ok(relative(root, path).startsWith('..'), 'Evidence must be outside the repository');
const config = JSON.parse(readFileSync(join(root, 'wrangler.jsonc'), 'utf8'));
const target = 'smart-school-staging-db', targetId = '1bdb9c3d-08d6-4023-9cbc-64369d53198a';
assert.equal(config.name, 'smart-school-staging');
assert.deepEqual(config.d1_databases, [{ binding: 'DB', database_name: target, database_id: targetId }]);
const migrationName = '0035_official_result_promotion.sql';
const commands = [];
const client = stagingClient(root);
function run(args, label) {
  const result = spawnSync(process.execPath, [join(root, 'node_modules/wrangler/bin/wrangler.js'), ...args, '--config', join(root, 'wrangler.jsonc')], {
    cwd: root, encoding: 'utf8', windowsHide: true, timeout: 180000, maxBuffer: 40000000,
    env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' },
  });
  commands.push({ label, exit_code: result.status });
  assert.equal(result.status, 0, `${label}: ${result.stderr || result.stdout}`);
  return result.stdout;
}
function reads(queries, label) {
  for (const sql of queries) assert.match(sql, /^(?:SELECT\b|PRAGMA (?:table_xinfo|foreign_key_check)\b)/u);
  const path = join(dirname(evidencePath), `${label}.sql`);
  writeFileSync(path, queries.join(';\n') + ';\n');
  const response = client.query(queries.join(';\n') + ';');
  assert.equal(response.status,200,JSON.stringify(response.payload.errors));
  assert.equal(response.payload.success,true,JSON.stringify(response.payload.errors));
  const result = response.payload.result;
  commands.push({label,read_only:true,query_count:queries.length});
  assert.equal(result.length, queries.length, `${label}: result count mismatch`);
  for (const entry of result) {
    assert.equal(entry.success, true);
    assert.equal(entry.meta.changed_db, false);
    assert.equal(Number(entry.meta.rows_written || 0), 0);
  }
  return result.map(entry => entry.results);
}
const migrationFiles = readdirSync(join(root, 'migrations')).filter(n => /^\d{4}_.+\.sql$/u.test(n)).sort();
assert.equal(migrationFiles.length, 36);
assert.equal(migrationFiles.at(-1), migrationName);
const schemaSql = 'SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name';
const [history, schema, foreignKeys] = reads(['SELECT id,name,applied_at FROM d1_migrations ORDER BY id', schemaSql, 'PRAGMA foreign_key_check'], 'preflight-schema');
assert.equal(history.length, 35);
assert.equal(new Set(history.map(r => r.name)).size, 35);
assert.deepEqual(history.map(r => r.name), migrationFiles.slice(0, -1));
assert.equal(history.at(-1).name, '0034_result_card_publication.sql');
assert.deepEqual(foreignKeys, []);
const pendingOutput = run(['d1', 'migrations', 'list', target, '--remote'], 'pending-migrations');
const pending = [...new Set(pendingOutput.match(/\d{4}_[\w-]+\.sql/gu) || [])];
assert.deepEqual(pending, [migrationName]);
const quote = s => '"' + s.replaceAll('"', '""') + '"';
const tables = schema.filter(r => r.type === 'table' && !r.name.startsWith('_cf_') && !r.name.startsWith('sqlite_stat'));
const columnQueries = tables.map(t => `PRAGMA table_xinfo(${quote(t.name)})`);
const columnResults = reads(columnQueries, 'preflight-columns');
const rowQueries = tables.map((t, i) => {
  const fields = columnResults[i].filter(c => c.hidden !== 1).map(c => c.name);
  return 'SELECT ' + fields.flatMap((c,j) => [
    `typeof(${quote(c)}) AS t${j}`,
    `CASE typeof(${quote(c)}) WHEN 'null' THEN NULL WHEN 'integer' THEN CAST(${quote(c)} AS TEXT) WHEN 'real' THEN printf('%!.17g',${quote(c)}) ELSE hex(${quote(c)}) END AS v${j}`,
  ]).join(',') + ' FROM ' + quote(t.name);
});
const rowResults = reads(rowQueries, 'preflight-typed-rows');
const cache = new Map([[schemaSql, schema], ['PRAGMA foreign_key_check', foreignKeys]]);
columnQueries.forEach((q,i) => cache.set(q,columnResults[i]));
rowQueries.forEach((q,i) => cache.set(q,rowResults[i]));
const snapshot = await contentSnapshot(async sql => { assert.ok(cache.has(sql), 'Uncaptured snapshot query'); return cache.get(sql); });
const readinessNames = schema.filter(r => r.type === 'view' && r.name.endsWith('_readiness')).map(r => r.name).sort();
assert.deepEqual(readinessNames, ['academic_grade_policy_readiness','finance_fee_readiness','finance_payroll_readiness','finance_payroll_school_readiness','finance_treasury_readiness','result_card_publication_readiness']);
const readinessRows = reads(readinessNames.map(n => `SELECT * FROM ${quote(n)}`), 'preflight-readiness');
const readiness = Object.fromEntries(readinessNames.map((n,i) => [n,readinessRows[i]]));
for (const [name,rows] of Object.entries(readiness)) {
  if (name.startsWith('finance_')) assert.ok(rows.every(r => Number(r.healthy) === 1), `${name} unhealthy`);
  else if (name === 'academic_grade_policy_readiness') assert.ok(rows.every(r => ['healthy','not_configured'].includes(r.status)), `${name} unhealthy`);
  else assert.ok(rows.every(r => r.status === 'healthy'), `${name} unhealthy`);
}
const backup = readFileSync(backupPath);
const evidence = {
  staging_only: true, read_only: true, target, target_id: targetId, captured_at: new Date().toISOString(),
  backup: { path: backupPath, bytes: backup.byteLength, sha256: createHash('sha256').update(backup).digest('hex').toUpperCase() },
  migration_files: migrationFiles, migration_history: history, pending, foreign_key_check: foreignKeys,
  readiness, table_count: Object.keys(snapshot.tables).length,
  application_table_count: tables.filter(t => t.name !== 'd1_migrations' && !t.name.startsWith('sqlite_')).length,
  snapshot, snapshot_hash: digest(snapshot), command_summary: commands,
};
writeFileSync(evidencePath, JSON.stringify(evidence,null,2));
console.log(JSON.stringify({ evidence_path: evidencePath, migration_count: history.length, pending, application_tables: evidence.application_table_count, foreign_key_violations: 0, snapshot_hash: evidence.snapshot_hash, readiness }));
