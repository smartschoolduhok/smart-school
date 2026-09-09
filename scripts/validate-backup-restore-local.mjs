// Disposable LOCAL D1 backup/restore drill. Never reads a configured remote DB.
import assert from 'node:assert/strict';
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

async function applicationSnapshot(db) {
  const tables = (await db.prepare(`
    SELECT name FROM sqlite_schema
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'
    ORDER BY name
  `).all()).results;
  const snapshot = {};
  for (const { name } of tables) {
    snapshot[name] = (await db.prepare(`SELECT * FROM "${name}"`).all()).results
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  }
  return snapshot;
}

runLocal(source, ['migrations', 'apply', source.databaseName, '--local'], 'source-migrations');
runLocal(source, ['execute', source.databaseName, '--local', '--file', join(source.directory, 'seed.sql')], 'source-seed');
runLocal(source, ['export', source.databaseName, '--local', '--output', backupPath], 'source-export');
assert.ok(readFileSync(backupPath, 'utf8').length > 1_000, 'backup export is unexpectedly empty');
runLocal(restored, ['execute', restored.databaseName, '--local', '--file', backupPath], 'restore-import');

const sourceProxy = await openLocal(source);
const restoredProxy = await openLocal(restored);
try {
  const before = await applicationSnapshot(sourceProxy.env.DB);
  const after = await applicationSnapshot(restoredProxy.env.DB);
  assert.deepEqual(after, before, 'restored application tables must exactly match the source export');
  const finance = await assertFinanceSeed(restoredProxy.env.DB);
  const evidence = {
    local_only: true,
    migration_count: migrationFiles.length,
    table_count: Object.keys(after).length,
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
