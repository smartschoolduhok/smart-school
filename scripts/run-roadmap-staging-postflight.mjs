// Read-only Phases 21E–22B post-migration evidence; run before QA fixtures.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { stagingClient } from './lib/phase20d2-staging-client.mjs';
import { contentSnapshot, digest } from './lib/local-d1-restore.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [mode, baselineArgument, evidenceArgument, confirmation] = process.argv.slice(2);
assert.equal(mode, 'migration', 'QA requires a separate school-scoped fixture comparison');
assert.equal(confirmation, '--confirm-staging');
const baselinePath = resolve(baselineArgument), evidencePath = resolve(evidenceArgument);
for (const path of [baselinePath, evidencePath]) assert.ok(relative(root, path).startsWith('..'));
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
const client = stagingClient(root);
assert.equal(client.accountId, '8d30029482b5722704371f03169c5ca1');
function read(queries) {
  for (const sql of queries) assert.match(sql, /^(?:SELECT\b|PRAGMA (?:table_xinfo|foreign_key_check)\b)/u);
  const response = client.query(queries.join(';\n') + ';');
  assert.equal(response.status, 200, JSON.stringify(response.payload.errors));
  assert.equal(response.payload.success, true);
  assert.equal(response.payload.result.length, queries.length);
  assert.ok(response.payload.result.every(result => result.success && result.meta.changed_db === false && Number(result.meta.rows_written || 0) === 0));
  return response.payload.result.map(result => result.results);
}
const schemaSql = 'SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name';
const [schema, fk, history] = read([schemaSql, 'PRAGMA foreign_key_check', 'SELECT id,name,applied_at FROM d1_migrations ORDER BY id']);
assert.deepEqual(fk, []);
assert.equal(history.length, 46);
assert.equal(new Set(history.map(row => row.name)).size, 46);
for (const name of ['0042_parent_communication.sql', '0043_grade_progress_reports.sql', '0044_admission_regulations.sql', '0045_admissions_transfers.sql']) assert.equal(history.filter(row => row.name === name).length, 1);
assert.equal(history.at(-1).name, '0045_admissions_transfers.sql');
const quote = value => `"${value.replaceAll('"', '""')}"`;
const tables = schema.filter(row => row.type === 'table' && !row.name.startsWith('_cf_') && !row.name.startsWith('sqlite_stat'));
const columnQueries = tables.map(table => `PRAGMA table_xinfo(${quote(table.name)})`), columns = read(columnQueries);
const rowQueries = tables.map((table, index) => 'SELECT ' + columns[index].filter(column => column.hidden !== 1).map(column => column.name).flatMap((field, fieldIndex) => [
  `typeof(${quote(field)}) AS t${fieldIndex}`,
  `CASE typeof(${quote(field)}) WHEN 'null' THEN NULL WHEN 'integer' THEN CAST(${quote(field)} AS TEXT) WHEN 'real' THEN printf('%!.17g',${quote(field)}) ELSE hex(${quote(field)}) END AS v${fieldIndex}`,
]).join(',') + ' FROM ' + quote(table.name));
const rows = read(rowQueries), cache = new Map([[schemaSql, schema], ['PRAGMA foreign_key_check', fk]]);
columnQueries.forEach((query, index) => cache.set(query, columns[index]));
rowQueries.forEach((query, index) => cache.set(query, rows[index]));
const snapshot = await contentSnapshot(async sql => { assert.ok(cache.has(sql)); return cache.get(sql); });
assert.equal(Object.keys(snapshot.tables).length, 95);
assert.equal(tables.filter(table => table.name !== 'd1_migrations' && !table.name.startsWith('sqlite_')).length, 93);
for (const oldObject of baseline.snapshot.schema) {
  assert.deepEqual(snapshot.schema.find(item => item.type === oldObject.type && item.name === oldObject.name), oldObject, `Historical schema changed: ${oldObject.name}`);
}
assert.deepEqual(history.slice(0, baseline.migration_history.length), baseline.migration_history, 'Historical migration records changed');
for (const [name, table] of Object.entries(snapshot.tables)) {
  if (!(name in baseline.snapshot.tables)) assert.equal(table.count, 0, `New table must be empty before QA: ${name}`);
}
const comparisons = {};
for (const [name, before] of Object.entries(baseline.snapshot.tables)) {
  if (name === 'd1_migrations' || name.startsWith('sqlite_')) continue;
  const after = snapshot.tables[name];
  assert.ok(after, name);
  assert.deepEqual(after.columns, before.columns, `${name} columns`);
  assert.equal(after.count, before.count, `${name} count`);
  assert.deepEqual(after.content, before.content, `${name} values`);
  comparisons[name] = { before_count: before.count, after_count: after.count, before_hash: before.hash, after_hash: after.hash, historical_rows_unchanged: true };
}
for (const name of ['parent_conversations','parent_messages','grade_progress_reports','admission_regulations','admission_applications']) assert.ok(snapshot.tables[name], `Missing ${name}`);
const readinessNames = schema.filter(row => row.type === 'view' && row.name.endsWith('_readiness')).map(row => row.name).sort();
assert.deepEqual(readinessNames, Object.keys(baseline.readiness).sort());
const readinessRows = read(readinessNames.map(name => `SELECT * FROM ${quote(name)}`));
const readiness = Object.fromEntries(readinessNames.map((name, index) => [name, readinessRows[index]]));
assert.deepEqual(readiness, baseline.readiness, 'Historical readiness changed');
const pending = spawnSync(process.execPath, [join(root,'node_modules/wrangler/bin/wrangler.js'),'d1','migrations','list',client.target,'--remote','--config',join(root,'wrangler.jsonc')], {
  cwd: root, encoding: 'utf8', windowsHide: true, timeout: 90000,
  env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' },
});
assert.equal(pending.status, 0);
assert.match(`${pending.stdout}${pending.stderr}`, /No migrations to apply/u);
const evidence = {
  mode, staging_only: true, read_only: true, account_id: client.accountId,
  target: client.target, target_id: client.id, captured_at: new Date().toISOString(),
  migration_history: history, pending: [], foreign_key_check: fk, readiness,
  table_count: Object.keys(snapshot.tables).length, application_table_count: 93,
  comparisons, snapshot, snapshot_hash: digest(snapshot),
};
writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
console.log(JSON.stringify({ mode, evidence_path: evidencePath, migrations: history.length, pending: [], tables: evidence.table_count, application_tables: 93, historical_tables_unchanged: Object.keys(comparisons).length, foreign_key_violations: 0, snapshot_hash: evidence.snapshot_hash }));
