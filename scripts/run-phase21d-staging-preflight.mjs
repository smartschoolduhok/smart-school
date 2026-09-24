// Read-only, explicitly scoped Phase 21D STAGING snapshot.
import assert from 'node:assert/strict';
import { readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { contentSnapshot, digest } from './lib/local-d1-restore.mjs';
import { stagingClient } from './lib/phase20d2-staging-client.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [evidenceArgument, confirmation] = process.argv.slice(2);
assert.equal(confirmation, '--confirm-staging');
assert.ok(evidenceArgument, 'Evidence path is required');
const evidencePath = resolve(evidenceArgument);
assert.ok(relative(root, evidencePath).startsWith('..'), 'Evidence must be outside the repository');
const migrationName = '0041_homework.sql';
const commands = [];
const client = stagingClient(root);
function run(args, label) {
  const result = spawnSync(process.execPath, [join(root, 'node_modules/wrangler/bin/wrangler.js'), ...args, '--config', join(root, 'wrangler.jsonc')], {
    cwd: root, encoding: 'utf8', windowsHide: true, timeout: 180000, maxBuffer: 40000000,
    env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' },
  });
  commands.push({ label, exit_code: result.status });
  assert.equal(result.status, 0, `${label}: ${result.stderr || result.stdout}`);
  return `${result.stdout || ''}${result.stderr || ''}`;
}
function reads(queries, label) {
  for (const sql of queries) assert.match(sql, /^(?:SELECT\b|PRAGMA (?:table_xinfo|foreign_key_check)\b)/u);
  writeFileSync(join(dirname(evidencePath), `${label}.sql`), queries.join(';\n') + ';\n');
  const response = client.query(queries.join(';\n') + ';');
  assert.equal(response.status, 200, JSON.stringify(response.payload.errors));
  assert.equal(response.payload.success, true, JSON.stringify(response.payload.errors));
  const result = response.payload.result;
  commands.push({ label, read_only: true, query_count: queries.length });
  assert.equal(result.length, queries.length, `${label}: result count mismatch`);
  for (const entry of result) {
    assert.equal(entry.success, true);
    assert.equal(entry.meta.changed_db, false);
    assert.equal(Number(entry.meta.rows_written || 0), 0);
  }
  return result.map(entry => entry.results);
}
const migrationFiles = readdirSync(join(root, 'migrations')).filter(name => /^\d{4}_.+\.sql$/u.test(name)).sort();
assert.equal(migrationFiles.length, 42);
assert.equal(migrationFiles.at(-1), migrationName);
const schemaSql = 'SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name';
const [history, schema, foreignKeys] = reads([
  'SELECT id,name,applied_at FROM d1_migrations ORDER BY id', schemaSql, 'PRAGMA foreign_key_check',
], 'preflight-schema');
assert.equal(history.length, 41);
assert.equal(new Set(history.map(row => row.name)).size, 41);
assert.deepEqual(history.map(row => row.name), migrationFiles.slice(0, -1));
assert.equal(history.at(-1).name, '0040_staff_attendance.sql');
assert.deepEqual(foreignKeys, []);
const pendingOutput = run(['d1', 'migrations', 'list', client.target, '--remote'], 'pending-migrations');
const pending = [...new Set(pendingOutput.match(/\d{4}_[\w-]+\.sql/gu) || [])];
assert.deepEqual(pending, [migrationName]);
const quote = value => `"${value.replaceAll('"', '""')}"`;
const tables = schema.filter(row => row.type === 'table' && !row.name.startsWith('_cf_') && !row.name.startsWith('sqlite_stat'));
const columnQueries = tables.map(table => `PRAGMA table_xinfo(${quote(table.name)})`);
const columnResults = reads(columnQueries, 'preflight-columns');
const rowQueries = tables.map((table, index) => {
  const fields = columnResults[index].filter(column => column.hidden !== 1).map(column => column.name);
  return 'SELECT ' + fields.flatMap((field, fieldIndex) => [
    `typeof(${quote(field)}) AS t${fieldIndex}`,
    `CASE typeof(${quote(field)}) WHEN 'null' THEN NULL WHEN 'integer' THEN CAST(${quote(field)} AS TEXT) WHEN 'real' THEN printf('%!.17g',${quote(field)}) ELSE hex(${quote(field)}) END AS v${fieldIndex}`,
  ]).join(',') + ' FROM ' + quote(table.name);
});
const rowResults = reads(rowQueries, 'preflight-typed-rows');
const cache = new Map([[schemaSql, schema], ['PRAGMA foreign_key_check', foreignKeys]]);
columnQueries.forEach((query, index) => cache.set(query, columnResults[index]));
rowQueries.forEach((query, index) => cache.set(query, rowResults[index]));
const snapshot = await contentSnapshot(async sql => { assert.ok(cache.has(sql), 'Uncaptured snapshot query'); return cache.get(sql); });
const readinessNames = schema.filter(row => row.type === 'view' && row.name.endsWith('_readiness')).map(row => row.name).sort();
assert.deepEqual(readinessNames, [
  'academic_grade_policy_readiness', 'finance_fee_readiness', 'finance_payroll_readiness',
  'finance_payroll_school_readiness', 'finance_treasury_readiness',
  'result_card_publication_readiness', 'student_promotion_result_readiness',
]);
const readinessRows = reads(readinessNames.map(name => `SELECT * FROM ${quote(name)}`), 'preflight-readiness');
const readiness = Object.fromEntries(readinessNames.map((name, index) => [name, readinessRows[index]]));
const evidence = {
  staging_only: true, read_only: true, account_id: client.accountId,
  target: client.target, target_id: client.id, captured_at: new Date().toISOString(),
  migration_files: migrationFiles, migration_history: history, pending,
  foreign_key_check: foreignKeys, readiness,
  table_count: Object.keys(snapshot.tables).length,
  application_table_count: tables.filter(table => table.name !== 'd1_migrations' && !table.name.startsWith('sqlite_')).length,
  snapshot, snapshot_hash: digest(snapshot), command_summary: commands,
};
assert.equal(evidence.table_count, 78);
assert.equal(evidence.application_table_count, 76);
writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
console.log(JSON.stringify({
  evidence_path: evidencePath, account_id: client.accountId, migration_count: history.length,
  pending, tables: evidence.table_count, application_tables: evidence.application_table_count,
  foreign_key_violations: 0, snapshot_hash: evidence.snapshot_hash, readiness,
}));
