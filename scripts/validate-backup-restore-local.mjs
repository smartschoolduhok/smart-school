// Disposable LOCAL D1 backup/restore drill. Never reads a configured remote DB.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { prepareLocalRestore, contentSnapshot, assertSameContent, digest, orderRestoreTables, sqlStatements } from './lib/local-d1-restore.mjs';
import { createManifest, verifyBackup } from './lib/backup-verification.mjs';
import { restoreLocalD1 } from './lib/backup-local-d1.mjs';
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
let transportFixture;

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
      database_id: '00000000-0000-0000-0000-000000000032',
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
  const fee = await largeSource.env.DB.prepare("SELECT id,school_id,net_fee,finance_revision FROM student_fees WHERE currency='IQD' AND net_fee>0 ORDER BY id LIMIT 1").first();
  const creator = await largeSource.env.DB.prepare("SELECT id FROM users WHERE school_id=? AND status='active' ORDER BY id LIMIT 1").bind(fee.school_id).first();
  const planRow = await largeSource.env.DB.prepare("INSERT INTO fee_installment_plans(plan_key,school_id,student_fee_id,fee_revision_snapshot,status,notes,created_by_user_id) VALUES(?,?,?,?,'draft',?,?) RETURNING id")
    .bind('backup-restore-plan-0032',fee.school_id,fee.id,fee.finance_revision,'Generated restore plan',creator.id).first();
  const firstAmount=Math.floor(fee.net_fee/2),secondAmount=fee.net_fee-firstAmount,firstBasis=Number((BigInt(firstAmount)*10000n)/BigInt(fee.net_fee));
  await largeSource.env.DB.batch([
    largeSource.env.DB.prepare("INSERT INTO fee_installment_items(plan_id,school_id,sequence_no,label,amount,percentage_basis_points,due_date) VALUES(?,?,?,?,?,?,?)").bind(planRow.id,fee.school_id,1,'Generated first',firstAmount,firstBasis,'2026-09-01'),
    largeSource.env.DB.prepare("INSERT INTO fee_installment_items(plan_id,school_id,sequence_no,label,amount,percentage_basis_points,due_date) VALUES(?,?,?,?,?,?,?)").bind(planRow.id,fee.school_id,2,'Generated second',secondAmount,10000-firstBasis,'2027-01-01'),
    largeSource.env.DB.prepare("UPDATE fee_installment_plans SET status='active',updated_at=unixepoch() WHERE id=? AND status='draft'").bind(planRow.id),
  ]);
  await largeSource.env.DB.prepare(
    'INSERT INTO import_jobs(school_id,import_type,file_name,status,summary_json,completed_at) VALUES(?,?,?,?,?,?)',
  ).bind(1, 'students', new Uint8Array([0, 39, 44, 255]), 'completed', largeText, 1788000000.25).run();
  // Exercise adviser history independently of today's eligibility: one teacher
  // is now archived and a second placement has a cleared, versioned assignment.
  const adviserClass = await largeSource.env.DB.prepare("INSERT INTO classes(school_id,name,stage,status) VALUES(1,'Generated adviser restore class','ابتدائي','active') RETURNING id").first();
  const clearedClass = await largeSource.env.DB.prepare("INSERT INTO classes(school_id,name,stage,status) VALUES(1,'Generated cleared adviser class','ابتدائي','active') RETURNING id").first();
  const archivedTeacher = await largeSource.env.DB.prepare("INSERT INTO employees(school_id,full_name,role,status) VALUES(1,'Generated historical adviser','teacher','archived') RETURNING id").first();
  const adviserYear = await largeSource.env.DB.prepare('SELECT id FROM academic_years WHERE school_id=1 ORDER BY id LIMIT 1').first();
  const adviserCreator = await largeSource.env.DB.prepare("SELECT id FROM users WHERE school_id=1 AND status='active' ORDER BY id LIMIT 1").first();
  await largeSource.env.DB.batch([
    largeSource.env.DB.prepare(`INSERT INTO section_advisors(school_id,academic_year_id,class_id,employee_id,attendance_confirmed,notes,version,created_by_user_id,updated_by_user_id)
      VALUES(1,?,?,?,1,'Generated historic assignment',4,?,?)`).bind(adviserYear.id,adviserClass.id,archivedTeacher.id,adviserCreator.id,adviserCreator.id),
    largeSource.env.DB.prepare(`INSERT INTO section_advisors(school_id,academic_year_id,class_id,employee_id,version,created_by_user_id,updated_by_user_id)
      VALUES(1,?,?,NULL,5,?,?)`).bind(adviserYear.id,clearedClass.id,adviserCreator.id,adviserCreator.id),
  ]);
  // Transport parents were added after students. Populated references exercise
  // export order, deferred FK checks, chunk restoration and the generic verifier.
  const transportStudent = await largeSource.env.DB.prepare('SELECT id FROM students WHERE school_id=1 ORDER BY id LIMIT 1').first();
  assert.ok(transportStudent, 'seed must include a student for transport restore');
  const area = await largeSource.env.DB.prepare('INSERT INTO residential_areas(school_id,name,name_key) VALUES(1,?,?) RETURNING id')
    .bind("حي النقل, 'محلي'", 'local-transport-area').first();
  const line = await largeSource.env.DB.prepare('INSERT INTO transport_lines(school_id,name,name_key,driver_name,driver_phone) VALUES(1,?,?,?,?) RETURNING id')
    .bind('خط النقل المحلي', 'local-transport-line', 'سائق تجريبي', '07700000001').first();
  transportFixture = { student_id: transportStudent.id, residential_area_id: area.id, pickup_landmark: 'قرب المدرسة\nالباب الثاني',
    guardian_phone_secondary: '07700000002', transport_to_school: 'school', transport_from_school: 'school',
    transport_to_school_line_id: line.id, transport_from_school_line_id: line.id };
  await largeSource.env.DB.prepare(`UPDATE students SET residential_area_id=?,pickup_landmark=?,guardian_phone_secondary=?,
    transport_to_school='school',transport_from_school='school',transport_to_school_line_id=?,transport_from_school_line_id=? WHERE id=?`)
    .bind(area.id, transportFixture.pickup_landmark, transportFixture.guardian_phone_secondary, line.id, line.id, transportStudent.id).run();
  assert.deepEqual((await largeSource.env.DB.prepare('PRAGMA foreign_key_check').all()).results, []);
} finally { await largeSource.dispose(); }
runLocal(source, ['export', source.databaseName, '--local', '--output', backupPath], 'source-export');
assert.ok(readFileSync(backupPath, 'utf8').length > 1_000, 'backup export is unexpectedly empty');
const exportedSql = readFileSync(backupPath, 'utf8');
const plan = prepareLocalRestore(exportedSql);
assert.equal(plan.inserts.length, 1, 'The drill must exercise one oversized bound row');
assert.equal(plan.baseStatementCount, plan.statementCount - 1);
const basePaths = plan.baseChunks.map((chunk, index) => {
  const path = join(drillRoot, `restore-base-${String(index + 1).padStart(2, '0')}.sql`);
  writeFileSync(path, chunk);
  return path;
});
const sourceProxy = await openLocal(source);
const restoredProxy = await openLocal(restored);
try {
  const read = db => async sql => (await db.prepare(sql).all()).results;
  // Restore the parsed chunk files in one genuine D1 transaction: newer parent
  // rows can appear in a later chunk than their historical child table. Each
  // prepared statement stays below the SQL-size limit, while FK checks remain
  // enabled and deferred until all chunks and oversized bound rows are present.
  const rowsAndSchema = [], triggers = [];
  for (const path of basePaths) {
    const chunk = readFileSync(path, 'utf8');
    for (const statement of sqlStatements(chunk)) {
      const [first, second] = statement.tokens.map(token => token.text.toUpperCase());
      const destination = first === 'CREATE' && second === 'TRIGGER' ? triggers : rowsAndSchema;
      destination.push(chunk.slice(statement.start, statement.end));
    }
  }
  assert.equal((await restoredProxy.env.DB.prepare('PRAGMA foreign_keys').first()).foreign_keys, 1);
  const results = await restoredProxy.env.DB.batch([
    restoredProxy.env.DB.prepare('PRAGMA defer_foreign_keys=TRUE'),
    ...rowsAndSchema.map(sql => restoredProxy.env.DB.prepare(sql)),
    ...plan.inserts.map(insert => restoredProxy.env.DB.prepare(insert.sql).bind(...insert.values)),
    // Restoring historical rows must not rerun present-day business guards.
    ...triggers.map(sql => restoredProxy.env.DB.prepare(sql)),
  ]);
  assert.ok(results.every(result => result.success));
  for (const result of results.slice(1 + rowsAndSchema.length, 1 + rowsAndSchema.length + plan.inserts.length)) assert.equal(result.meta.changes, 1);
  const before = await contentSnapshot(read(sourceProxy.env.DB));
  const after = await contentSnapshot(read(restoredProxy.env.DB));
  assertSameContent(before, after);
  const baseline = new DatabaseSync(':memory:');
  try {
    // Create all referenced tables before rows, and defer forward row references
    // until the entire SQLite baseline has been restored.
    baseline.exec('BEGIN;\nPRAGMA defer_foreign_keys=TRUE;\n' + orderRestoreTables(exportedSql) + '\nCOMMIT;');
    assertSameContent(await contentSnapshot(async sql => baseline.prepare(sql).all()), after);
  } finally { baseline.close(); }
  const largeRow = await restoredProxy.env.DB.prepare('SELECT summary_json FROM import_jobs WHERE summary_json = ?').bind(largeText).first();
  assert.ok(largeRow?.summary_json === largeText, 'Large row must round-trip byte-for-byte');
  const finance = await assertFinanceSeed(restoredProxy.env.DB);
  assert.equal(after.tables.section_advisors.count, 2);
  const adviserHistory = (await restoredProxy.env.DB.prepare('SELECT employee_id,attendance_confirmed,notes,version FROM section_advisors ORDER BY id').all()).results;
  assert.equal(adviserHistory[0].version,4);assert.equal(adviserHistory[0].attendance_confirmed,1);
  assert.deepEqual(adviserHistory[1],{employee_id:null,attendance_confirmed:0,notes:'',version:5});
  const restoredTransport = await restoredProxy.env.DB.prepare(`SELECT id AS student_id,residential_area_id,pickup_landmark,guardian_phone_secondary,
    transport_to_school,transport_from_school,transport_to_school_line_id,transport_from_school_line_id FROM students WHERE id=?`)
    .bind(transportFixture.student_id).first();
  assert.deepEqual(restoredTransport, transportFixture);
  assert.equal(after.tables.residential_areas.count, 1);
  assert.equal(after.tables.transport_lines.count, 1);
  assert.deepEqual(after.foreignKeys, []);
  const evidence = {
    local_only: true,
    migration_count: migrationFiles.length,
    table_count: Object.keys(after.tables).length,
    schema_hash: digest(after.schema),
    tables: Object.fromEntries(Object.entries(after.tables).map(([name, t]) => [name, { rows: t.count, hash: t.hash }])),
    oversized_single_row_restored: true,
    installment_plan_rows_restored: after.tables.fee_installment_plans.count === 1 && after.tables.fee_installment_items.count === 2,
    historical_and_cleared_advisors_restored: true,
    populated_transport_and_references_restored: true,
    large_row_bytes: Buffer.byteLength(largeText),
    large_row_hash: digest(largeText),
    statements_before: plan.statementCount,
    restore_base_statements: plan.baseStatementCount,
    restore_base_chunks: plan.baseChunks.length,
    restore_chunks_atomic_with_deferred_foreign_keys: true,
    backup_bytes: readFileSync(backupPath).byteLength,
    exact_application_snapshot: true,
    finance,
    commands: commandLogs,
  };
  // Exercise the operator's generic verifier against the entire current schema.
  const target = { environment: 'local', account_id: '0'.repeat(32),
    database_id: '00000000-0000-0000-0000-000000000032', database_name: source.databaseName };
  const manifest = await createManifest({ backupPath, target, capturedAt: new Date().toISOString(), codeSha: '0'.repeat(40), kind: 'manual' });
  const receipt = await verifyBackup({ backupPath, manifest, target,
    restore: plan => restoreLocalD1(plan, join(drillRoot, 'verification-local.json')) });
  assert.equal(receipt.exact_restore, true);
  evidence.generic_verifier_exact_restore = receipt.exact_restore;
  writeFileSync(join(drillRoot, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
} finally {
  await restoredProxy.dispose();
  await sourceProxy.dispose();
}
