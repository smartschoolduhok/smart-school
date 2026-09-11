// LOCAL-only rehearsal for a full D1 export. This script has no remote mode,
// does not read repository bindings or env files, and never logs row content.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
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
import {
  assertSameContent,
  contentSnapshot,
  digest,
  prepareLocalRestore,
} from './lib/local-d1-restore.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [backupArgument, evidenceArgument, afterExportArgument] = process.argv.slice(2);
assert.ok(backupArgument, 'Usage: node scripts/validate-staging-0032-local.mjs <backup.sql> [evidence.json]');
const backupPath = resolve(backupArgument);
const evidencePath = evidenceArgument
  ? resolve(evidenceArgument)
  : join(dirname(backupPath), 'phase20b-local-rehearsal-evidence.json');
assert.ok(isAbsolute(backupPath) && existsSync(backupPath), 'Backup file does not exist');
assert.ok(!backupPath.toLowerCase().startsWith(`${root.toLowerCase()}\\`), 'Backup must be outside the repository');
assert.ok(!evidencePath.toLowerCase().startsWith(`${root.toLowerCase()}\\`), 'Evidence must be outside the repository');
const afterExportPath = afterExportArgument ? resolve(afterExportArgument) : null;
if (afterExportPath) {
  assert.ok(isAbsolute(afterExportPath) && existsSync(afterExportPath), 'Post-migration export does not exist');
  assert.ok(!afterExportPath.toLowerCase().startsWith(`${root.toLowerCase()}\\`), 'Post-migration export must be outside the repository');
}

const migrationName = '0032_fee_installments_receipt_snapshots.sql';
const migrationPath = join(root, 'migrations', migrationName);
const wranglerPath = join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const workRoot = mkdtempSync(join(tmpdir(), 'smart-school-phase20b-staging-local-'));
const migrationsDirectory = join(workRoot, 'migrations');
const statePath = join(workRoot, '.wrangler', 'state', 'v3');
const configPath = join(workRoot, 'wrangler.json');
const basePath = join(workRoot, 'restore-base.sql');
const databaseName = 'smart-school-phase20b-rehearsal-local-only';
mkdirSync(migrationsDirectory);
copyFileSync(migrationPath, join(migrationsDirectory, migrationName));
writeFileSync(configPath, JSON.stringify({
  name: databaseName,
  compatibility_date: '2026-04-13',
  compatibility_flags: ['nodejs_compat'],
  d1_databases: [{
    binding: 'DB',
    database_name: databaseName,
    database_id: '00000000-0000-0000-0000-000000000032',
    migrations_dir: migrationsDirectory,
  }],
}));

function runLocal(args, label) {
  assert.equal(args.includes('--remote'), false, 'Remote D1 is forbidden');
  const command = [wranglerPath, 'd1', ...args, '--local', '--config', configPath];
  const childEnv = { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' };
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) {
    delete childEnv[key];
  }
  const result = spawnSync(process.execPath, command, {
    cwd: workRoot,
    encoding: 'utf8',
    env: childEnv,
    windowsHide: true,
    timeout: 180_000,
    maxBuffer: 10_000_000,
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  writeFileSync(join(workRoot, `${label}.log`), output);
  assert.equal(result.status, 0, `${label}: ${output}`);
  return { label, exit_code: result.status };
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
async function typedRows(db, table, columns, where = '') {
  const projection = columns.flatMap((column, index) => [
    `typeof(${quote(column)}) AS t${index}`,
    `CASE typeof(${quote(column)}) WHEN 'null' THEN NULL WHEN 'integer' THEN CAST(${quote(column)} AS TEXT) WHEN 'real' THEN printf('%!.17g',${quote(column)}) ELSE hex(${quote(column)}) END AS v${index}`,
  ]).join(',');
  const rows = (await db.prepare(`SELECT ${projection} FROM ${quote(table)} ${where}`).all()).results;
  return rows.map(row => JSON.stringify(columns.map((_, index) => [row[`t${index}`], row[`v${index}`]]))).sort();
}

async function legacySnapshot(db) {
  const tables = (await db.prepare(
    "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE '_cf_%' ORDER BY name",
  ).all()).results.map(row => row.name);
  const snapshot = {};
  for (const table of tables) {
    const columns = (await db.prepare(`PRAGMA table_xinfo(${quote(table)})`).all()).results
      .filter(column => column.hidden !== 1)
      .map(column => column.name);
    const content = await typedRows(db, table, columns, table === 'sqlite_sequence' ? "WHERE name!='d1_migrations'" : '');
    snapshot[table] = { columns, count: content.length, hash: digest(content), content };
  }
  return snapshot;
}

async function assertLegacyUnchanged(before, db) {
  const currentTables = new Set((await db.prepare(
    "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE '_cf_%'",
  ).all()).results.map(row => row.name));
  for (const [table, expected] of Object.entries(before)) {
    assert.ok(currentTables.has(table), `Old table disappeared: ${table}`);
    const currentColumns = (await db.prepare(`PRAGMA table_xinfo(${quote(table)})`).all()).results
      .filter(column => column.hidden !== 1)
      .map(column => column.name);
    for (const column of expected.columns) assert.ok(currentColumns.includes(column), `Old column disappeared: ${table}.${column}`);
    if (table === 'd1_migrations') {
      const oldRows = (await db.prepare('SELECT id,name,applied_at FROM d1_migrations WHERE id<=32 ORDER BY id').all()).results;
      const oldContent = oldRows.map(row => JSON.stringify([
        ['integer', String(row.id)],
        ['text', Buffer.from(row.name).toString('hex').toUpperCase()],
        ['text', Buffer.from(row.applied_at).toString('hex').toUpperCase()],
      ])).sort();
      assert.deepEqual(oldContent, expected.content, 'Existing migration history changed');
      continue;
    }
    const content = await typedRows(db, table, expected.columns, table === 'sqlite_sequence' ? "WHERE name!='d1_migrations'" : '');
    assert.equal(content.length, expected.count, `Old row count changed: ${table}`);
    assert.equal(digest(content), expected.hash, `Old content hash changed: ${table}`);
    assert.deepEqual(content, expected.content, `Old values changed: ${table}`);
  }
}

function typedSqliteRows(db, table, columns, where = '') {
  const projection = columns.flatMap((column, index) => [
    `typeof(${quote(column)}) AS t${index}`,
    `CASE typeof(${quote(column)}) WHEN 'null' THEN NULL WHEN 'integer' THEN CAST(${quote(column)} AS TEXT) WHEN 'real' THEN printf('%!.17g',${quote(column)}) ELSE hex(${quote(column)}) END AS v${index}`,
  ]).join(',');
  const rows = db.prepare(`SELECT ${projection} FROM ${quote(table)} ${where}`).all();
  return rows.map(row => JSON.stringify(columns.map((_, index) => [row[`t${index}`], row[`v${index}`]]))).sort();
}

function compareHistoricalExports(beforeSql, afterSql) {
  const beforeDb = new DatabaseSync(':memory:');
  const afterDb = new DatabaseSync(':memory:');
  try {
    beforeDb.exec(beforeSql);
    afterDb.exec(afterSql);
    const oldTables = beforeDb.prepare(
      "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE '_cf_%' ORDER BY name",
    ).all().map(row => row.name);
    const afterTables = new Set(afterDb.prepare(
      "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE '_cf_%'",
    ).all().map(row => row.name));
    for (const table of oldTables) {
      assert.ok(afterTables.has(table), `Post-migration export lost old table: ${table}`);
      const columns = beforeDb.prepare(`PRAGMA table_xinfo(${quote(table)})`).all()
        .filter(column => column.hidden !== 1)
        .map(column => column.name);
      const where = table === 'd1_migrations'
        ? 'WHERE id<=32'
        : table === 'sqlite_sequence' ? "WHERE name!='d1_migrations'" : '';
      assert.deepEqual(
        typedSqliteRows(afterDb, table, columns, where),
        typedSqliteRows(beforeDb, table, columns, where),
        `Post-migration export changed historical values: ${table}`,
      );
    }
    assert.equal(afterDb.prepare('SELECT COUNT(*) AS count FROM d1_migrations').get().count, 33);
    assert.equal(afterDb.prepare('SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1').get().name, migrationName);
    return { old_tables_compared: oldTables.length, old_table_rows_and_values_equal: true };
  } finally {
    afterDb.close();
    beforeDb.close();
  }
}

const backup = readFileSync(backupPath);
const backupSha256 = createHash('sha256').update(backup).digest('hex').toUpperCase();
const exportedSql = backup.toString('utf8');
const restorePlan = prepareLocalRestore(exportedSql);
writeFileSync(basePath, restorePlan.baseSql);
const commands = [runLocal(['execute', databaseName, '--file', basePath], '01-restore-base')];

let proxy = await openLocal();
let before;
try {
  for (const insert of restorePlan.inserts) {
    const result = await proxy.env.DB.prepare(insert.sql).bind(...insert.values).run();
    assert.equal(result.success, true);
    assert.equal(result.meta.changes, 1);
  }
  const read = sql => proxy.env.DB.prepare(sql).all().then(result => result.results);
  const localRestore = await contentSnapshot(read);
  const baseline = new DatabaseSync(':memory:');
  try {
    baseline.exec(exportedSql);
    assertSameContent(await contentSnapshot(async sql => baseline.prepare(sql).all()), localRestore);
  } finally {
    baseline.close();
  }
  before = await legacySnapshot(proxy.env.DB);
  assert.equal(localRestore.foreignKeys.length, 0, 'Restored backup has foreign-key violations');
} finally {
  await proxy.dispose();
}

commands.push(runLocal(['migrations', 'apply', databaseName], '02-apply-0032'));
proxy = await openLocal();
try {
  await assertLegacyUnchanged(before, proxy.env.DB);
  const history = (await proxy.env.DB.prepare('SELECT id,name FROM d1_migrations ORDER BY id').all()).results;
  assert.equal(history.length, 33);
  assert.deepEqual(history.at(-1), { id: 33, name: migrationName });
  assert.equal(await proxy.env.DB.prepare("SELECT seq FROM sqlite_sequence WHERE name='d1_migrations'").first('seq'), 33);

  const expectedTables = ['fee_installment_plans', 'fee_installment_items'];
  const expectedIndexes = [
    'idx_fee_installment_plans_active',
    'idx_fee_installment_plans_school_fee',
    'idx_fee_installment_items_plan',
    'idx_fee_receipts_replacement',
  ];
  const expectedTriggers = [
    'trg_fee_installment_plans_insert',
    'trg_fee_installment_items_insert',
    'trg_fee_installment_plans_update',
    'trg_fee_installment_plans_activate',
    'trg_fee_installment_plans_preserve_history',
    'trg_fee_installment_items_immutable',
    'trg_fee_installment_items_preserve_history',
    'trg_student_fees_preserve_installment_plan',
    'trg_student_fees_guard_installment_total',
    'trg_fee_receipts_snapshot_extension_insert',
    'trg_fee_receipts_snapshot_extension_immutable',
  ];
  const schemaCount = async (type, names) => (await proxy.env.DB.prepare(
    `SELECT COUNT(*) AS count FROM sqlite_schema WHERE type=? AND name IN (${names.map(() => '?').join(',')})`,
  ).bind(type, ...names).first('count'));
  assert.equal(await schemaCount('table', expectedTables), expectedTables.length);
  assert.equal(await schemaCount('index', expectedIndexes), expectedIndexes.length);
  assert.equal(await schemaCount('trigger', expectedTriggers), expectedTriggers.length);
  const receiptColumns = [
    'receipt_schema_version',
    'student_number_snapshot',
    'currency_snapshot',
    'received_by_snapshot',
    'financial_summary_snapshot_json',
    'installment_plan_snapshot_json',
    'replaces_receipt_id',
  ];
  const receiptColumnCount = await proxy.env.DB.prepare(
    `SELECT COUNT(*) AS count FROM pragma_table_info('fee_receipts') WHERE name IN (${receiptColumns.map(() => '?').join(',')})`,
  ).bind(...receiptColumns).first('count');
  assert.equal(receiptColumnCount, receiptColumns.length);
  assert.equal(await proxy.env.DB.prepare('SELECT COUNT(*) FROM fee_installment_plans').first('COUNT(*)'), 0);
  assert.equal(await proxy.env.DB.prepare('SELECT COUNT(*) FROM fee_installment_items').first('COUNT(*)'), 0);
  assert.equal(await proxy.env.DB.prepare('SELECT COUNT(*) FROM fee_receipts WHERE receipt_schema_version!=1').first('COUNT(*)'), 0);
  assert.equal((await proxy.env.DB.prepare('PRAGMA foreign_key_check').all()).results.length, 0);
  const readiness = {
    fee_unhealthy: await proxy.env.DB.prepare('SELECT COUNT(*) FROM finance_fee_readiness WHERE healthy!=1').first('COUNT(*)'),
    treasury_unhealthy: await proxy.env.DB.prepare('SELECT COUNT(*) FROM finance_treasury_readiness WHERE healthy!=1').first('COUNT(*)'),
    payroll_unhealthy: await proxy.env.DB.prepare('SELECT COUNT(*) FROM finance_payroll_readiness WHERE healthy!=1').first('COUNT(*)'),
    payroll_school_unhealthy: await proxy.env.DB.prepare('SELECT COUNT(*) FROM finance_payroll_school_readiness WHERE healthy!=1').first('COUNT(*)'),
  };
  assert.deepEqual(readiness, { fee_unhealthy: 0, treasury_unhealthy: 0, payroll_unhealthy: 0, payroll_school_unhealthy: 0 });

  let postMigrationExport = null;
  if (afterExportPath) {
    const afterExport = readFileSync(afterExportPath);
    postMigrationExport = {
      path: afterExportPath,
      bytes: afterExport.byteLength,
      sha256: createHash('sha256').update(afterExport).digest('hex').toUpperCase(),
      ...compareHistoricalExports(exportedSql, afterExport.toString('utf8')),
    };
  }
  const evidence = {
    local_only: true,
    backup_path: backupPath,
    backup_bytes: backup.byteLength,
    backup_sha256: backupSha256,
    work_root: workRoot,
    restored_statement_count: restorePlan.statementCount,
    restore_base_statement_count: restorePlan.baseStatementCount,
    bound_oversized_rows: restorePlan.inserts.map(insert => ({ bytes: insert.bytes, parameter_count: insert.values.length })),
    old_tables_compared: Object.keys(before).length,
    old_table_rows_and_values_equal: true,
    migration_count_after: history.length,
    migration_last: history.at(-1).name,
    new_tables: expectedTables.length,
    new_indexes: expectedIndexes.length,
    new_triggers: expectedTriggers.length,
    new_receipt_columns: receiptColumns.length,
    new_plan_rows: 0,
    foreign_key_violations: 0,
    readiness,
    post_migration_export: postMigrationExport,
    commands,
  };
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
} finally {
  await proxy.dispose();
}
