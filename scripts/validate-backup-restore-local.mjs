// Disposable LOCAL D1 backup/restore drill. Never reads a configured remote DB.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { prepareLocalRestore, contentSnapshot, assertSameContent, digest } from './lib/local-d1-restore.mjs';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { getPlatformProxy } from 'wrangler';
import { assertFinanceSeed } from '../test/helpers/finance-seed-assertions.mjs';
import { migrationFiles, root } from '../test/helpers/finance-fixture.mjs';

const drillRoot = mkdtempSync(join(tmpdir(), 'smart-school-backup-restore-local-'));
const source = environment('source', 'smart-school-backup-source-local');
const restored = environment('restored', 'smart-school-backup-restored-local');
const backupPath = join(drillRoot, 'backup.sql');
const commandLogs = [];

console.log(`LOCAL backup/restore artifacts: ${drillRoot}`);

function environment(directoryName, databaseName) {
  const directory = join(drillRoot, directoryName);
  mkdirSync(directory);
  mkdirSync(join(directory, 'migrations'));
  for (const file of migrationFiles) {
    copyFileSync(join(root, 'migrations', file), join(directory, 'migrations', file));
  }
  copyFileSync(join(root, 'seed.sql'), join(directory, 'seed.sql'));
  const configPath = join(directory, 'wrangler.json');
  writeFileSync(configPath, JSON.stringify({
    name: databaseName,
    compatibility_date: '2026-04-13',
    compatibility_flags: ['nodejs_compat'],
    d1_databases: [{
      binding: 'DB',
      database_name: databaseName,
      database_id: '00000000-0000-0000-0000-000000000031',
      migrations_dir: 'migrations',
    }],
  }));
  return {
    directory,
    databaseName,
    configPath,
    persistPath: join(directory, '.wrangler', 'state', 'v3'),
  };
}

function runLocal(environment, args, label) {
  assert.equal(args.includes('--remote'), false, 'remote D1 is forbidden in this drill');
  assert.ok(args.includes('--local'), 'every D1 command must be local');
  const command = [join(root, 'node_modules/wrangler/bin/wrangler.js'), 'd1', ...args, '--config', environment.configPath];
  const childEnv = { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' };
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete childEnv[key];
  const result = spawnSync(process.execPath, command, {
    cwd: environment.directory,
    encoding: 'utf8',
    windowsHide: true,
    env: childEnv,
    timeout: 180_000,
    maxBuffer: 10_000_000,
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  writeFileSync(join(drillRoot, `${String(commandLogs.length + 1).padStart(2, '0')}-${label}.log`), output);
  commandLogs.push({ label, command: command.map((part) => part === environment.configPath ? '<disposable-config>' : part), exit_code: result.status });
  assert.equal(result.status, 0, `${label}: ${output}`);
}

async function openLocal(environment) {
  return getPlatformProxy({
    configPath: environment.configPath,
    persist: { path: environment.persistPath },
    remoteBindings: false,
    envFiles: [],
  });
}

runLocal(source, ['migrations', 'apply', source.databaseName, '--local'], 'source-migrations');
runLocal(source, ['execute', source.databaseName, '--local', '--file', join(source.directory, 'seed.sql')], 'source-seed');
// Generated fixture only: exercise Unicode, SQL quotes, commas and real newlines.
const fragment = "مدرسة, 'quoted', \"double\"\nnext line; (value), ";
const largeText = fragment.repeat(Math.ceil(360000 / Buffer.byteLength(fragment)));
assert.ok(Buffer.byteLength(largeText) >= 360000 && Buffer.byteLength(largeText) < 361000);
const largeSource = await openLocal(source);
try {
  await largeSource.env.DB.prepare(
    'INSERT INTO import_jobs(school_id,import_type,file_name,status,summary_json,completed_at) VALUES(?,?,?,?,?,?)',
  ).bind(1, 'students', new Uint8Array([0, 39, 44, 255]), 'completed', largeText, 1788000000.25).run();
} finally { await largeSource.dispose(); }
runLocal(source, ['export', source.databaseName, '--local', '--output', backupPath], 'source-export');
assert.ok(readFileSync(backupPath, 'utf8').length > 1_000, 'backup export is unexpectedly empty');
const exportedSql = readFileSync(backupPath, 'utf8');
const plan = prepareLocalRestore(exportedSql);
assert.equal(plan.inserts.length, 1, 'The drill must exercise one oversized bound row');
assert.equal(plan.baseStatementCount, plan.statementCount - 1);
const basePath = join(drillRoot, 'restore-base.sql');
writeFileSync(basePath, plan.baseSql);
runLocal(restored, ['execute', restored.databaseName, '--local', '--file', basePath], 'restore-base-import');

const sourceProxy = await openLocal(source);
const restoredProxy = await openLocal(restored);
try {
  const read = db => async sql => (await db.prepare(sql).all()).results;
  for (const insert of plan.inserts) {
    const result = await restoredProxy.env.DB.prepare(insert.sql).bind(...insert.values).run();
    assert.equal(result.success, true);
    assert.equal(result.meta.changes, 1);
  }
  const before = await contentSnapshot(read(sourceProxy.env.DB));
  const after = await contentSnapshot(read(restoredProxy.env.DB));
  assertSameContent(before, after);
  const baseline = new DatabaseSync(':memory:');
  try {
    baseline.exec(exportedSql);
    assertSameContent(await contentSnapshot(async sql => baseline.prepare(sql).all()), after);
  } finally { baseline.close(); }
  const largeRow = await restoredProxy.env.DB.prepare('SELECT summary_json FROM import_jobs WHERE summary_json = ?').bind(largeText).first();
  assert.ok(largeRow?.summary_json === largeText, 'Large row must round-trip byte-for-byte');
  const finance = await assertFinanceSeed(restoredProxy.env.DB);
  const evidence = {
    local_only: true,
    migration_count: migrationFiles.length,
    table_count: Object.keys(after.tables).length,
    schema_hash: digest(after.schema),
    tables: Object.fromEntries(Object.entries(after.tables).map(([name, t]) => [name, { rows: t.count, hash: t.hash }])),
    oversized_single_row_restored: true,
    large_row_bytes: Buffer.byteLength(largeText),
    large_row_hash: digest(largeText),
    statements_before: plan.statementCount,
    restore_base_statements: plan.baseStatementCount,
    backup_bytes: readFileSync(backupPath).byteLength,
    exact_application_snapshot: true,
    finance,
    commands: commandLogs,
  };
  writeFileSync(join(drillRoot, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
} finally {
  await restoredProxy.dispose();
  await sourceProxy.dispose();
}
