import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import { fileURLToPath } from 'node:url';
import { backupStatus, createManifest, externalPath, readEvidence, retentionPlan, sha256, verifyBackup, writeEvidence } from '../scripts/lib/backup-verification.mjs';
import { digest, prepareLocalRestore, sqlStatements } from '../scripts/lib/local-d1-restore.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const target = { environment: 'local', account_id: '0'.repeat(32), database_id: '00000000-0000-0000-0000-000000000001', database_name: 'synthetic-backup-test' };
const now = '2026-10-01T12:00:00.000Z';
const capturedAt = '2026-10-01T00:00:00.000Z';
const sql = `PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY,name TEXT NOT NULL);
INSERT INTO d1_migrations VALUES(1,'0000_initial.sql');
CREATE TABLE children(id INTEGER PRIMARY KEY,parent_id INTEGER REFERENCES parents(id),n,v);
INSERT INTO children VALUES(1,7,NULL,X'0027ff');
INSERT INTO children VALUES(2,7,1788000000.25,'Private synthetic name');
INSERT INTO children VALUES(3,7,9223372036854775807,'quotes '' and ; newline
اختبار');
CREATE TABLE parents(id INTEGER PRIMARY KEY AUTOINCREMENT);
INSERT INTO parents VALUES(7);
DELETE FROM sqlite_sequence;
INSERT INTO sqlite_sequence VALUES('parents',7);
CREATE TABLE import_jobs(id INTEGER PRIMARY KEY,summary_json TEXT);
CREATE UNIQUE INDEX child_parent ON children(parent_id,id);
CREATE VIEW child_view AS SELECT * FROM children;
CREATE TRIGGER child_trigger AFTER INSERT ON parents BEGIN INSERT INTO children VALUES(99,new.id,1,'new'); END;`;

async function fixture(extra = '') {
  const directory = mkdtempSync(join(tmpdir(), 'school-backup-verification-test-'));
  const backupPath = join(directory, 'backup.sql'); writeFileSync(backupPath, sql + extra, { mode: 0o600 });
  const manifest = await createManifest({ backupPath, target, capturedAt, codeSha: 'a'.repeat(40), kind: 'daily' });
  return { directory, backupPath, manifest };
}

const receiptFor = (manifest, verifiedAt = now) => ({ version: 1, target, verified_at: verifiedAt, captured_at: manifest.captured_at,
  manifest_sha256: digest(manifest), backup_sha256: manifest.sha256, bytes: manifest.bytes, exact_restore: true,
  engine: 'local-workerd-d1', foreign_key_violations: 0, remote_access: false, r2_verified: false });

function cli(args) {
  return spawnSync(process.execPath, ['scripts/backup-tools.mjs', ...args], { cwd: root, encoding: 'utf8', windowsHide: true,
    timeout: 90000, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: 'true',
      CLOUDFLARE_INCLUDE_PROCESS_ENV: 'true', CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'true', CLOUDFLARE_CF_FETCH_ENABLED: 'true' } });
}

test('manifest records export integrity without names, SQL, or implied cloud authentication', async () => {
  const { manifest, backupPath } = await fixture();
  assert.equal(manifest.sha256, sha256(readFileSync(backupPath)));
  assert.deepEqual(manifest.migrations, ['0000_initial.sql']);
  assert.equal(manifest.snapshot.tables.children.rows, 3);
  assert.equal(manifest.identity_source, 'operator_supplied');
  assert.equal(manifest.r2_included, false);
  assert.doesNotMatch(JSON.stringify(manifest), /Private synthetic name|9223372036854775807|CREATE TABLE/);
});

test('verify CLI restores typed rows, large snapshots, FK, triggers, views and indexes to local D1', { timeout: 120000 }, async () => {
  const large = "اختبار ' ; \n".repeat(24000);
  const snapshot = JSON.stringify({ notes: "سجل تجريبي ' ; \n".repeat(7000), extra_fields: [{ label: 'حقل', value: 'قيمة' }] });
  const literal = value => "'" + value.replaceAll("'", "''") + "'";
  const extra = `
INSERT INTO import_jobs VALUES(1,${literal(large)});
CREATE TABLE school_register_entries(id INTEGER PRIMARY KEY,data_json TEXT NOT NULL,status TEXT,version INTEGER);
CREATE TABLE school_register_history(id INTEGER PRIMARY KEY,entry_id INTEGER REFERENCES school_register_entries(id),before_json TEXT,after_json TEXT);
CREATE TABLE staff_dossiers(employee_id INTEGER PRIMARY KEY,data_json TEXT NOT NULL,version INTEGER);
CREATE TABLE staff_dossier_audit(id INTEGER PRIMARY KEY,employee_id INTEGER REFERENCES staff_dossiers(employee_id),before_json TEXT,after_json TEXT);
INSERT INTO school_register_entries VALUES(1,${literal(snapshot)},'voided',2);
INSERT INTO school_register_history VALUES(1,1,NULL,${literal(snapshot)});
INSERT INTO staff_dossiers VALUES(1,${literal(snapshot)},2);
INSERT INTO staff_dossier_audit VALUES(1,1,${literal(snapshot)},${literal(snapshot)});
CREATE TRIGGER school_register_entries_created AFTER INSERT ON school_register_entries BEGIN INSERT INTO school_register_history VALUES(99,new.id,NULL,new.data_json); END;
CREATE TRIGGER staff_dossiers_created AFTER INSERT ON staff_dossiers BEGIN INSERT INTO staff_dossier_audit VALUES(99,new.employee_id,NULL,new.data_json); END;
CREATE TRIGGER school_register_history_no_delete BEFORE DELETE ON school_register_history BEGIN SELECT RAISE(ABORT,'immutable'); END;
CREATE TRIGGER staff_dossier_audit_no_update BEFORE UPDATE ON staff_dossier_audit BEGIN SELECT RAISE(ABORT,'immutable'); END;`;
  const { directory, backupPath, manifest } = await fixture(extra);
  assert.ok(manifest.bytes > 360000);
  const plan = prepareLocalRestore(readFileSync(backupPath, 'utf8'));
  assert.equal(plan.inserts.length, 5);
  for (const table of ['school_register_entries', 'school_register_history', 'staff_dossiers', 'staff_dossier_audit']) {
    assert.equal(manifest.snapshot.tables[table].rows, 1);
    const insertion = plan.inserts.find(insert => insert.sql.startsWith(`INSERT INTO "${table}"`));
    assert.ok(insertion, `${table} must use bound inserts beyond the SQL byte limit`);
    assert.ok(insertion.values.includes(snapshot), `${table} JSON must remain exact`);
  }
  const targetPath = join(directory, 'target.json'), manifestPath = join(directory, 'manifest.json');
  writeEvidence(targetPath, target); writeEvidence(manifestPath, manifest);
  const output = join(directory, 'receipt.json'), config = join(directory, 'local.json');
  // Broken adjacent secret files must not be read by the local verifier.
  mkdirSync(join(directory, '.dev.vars')); mkdirSync(join(directory, '.env'));
  const result = cli(['verify', '--backup', backupPath, '--manifest', manifestPath, '--target', targetPath, '--local-config', config, '--output', output]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const receipt = readEvidence(output);
  assert.equal(receipt.exact_restore, true); assert.equal(receipt.engine, 'local-workerd-d1');
  assert.equal(receipt.backup_sha256, manifest.sha256);
  assert.equal(receipt.manifest_sha256, digest(manifest));
  assert.equal(receipt.foreign_key_violations, 0); assert.equal(receipt.remote_access, false);
  assert.doesNotMatch(result.stdout + result.stderr, /Private synthetic name|اختبار|Using secrets/);
  assert.deepEqual(readdirSync(directory).sort(), ['.dev.vars', '.env', 'backup.sql', 'local.json', 'local.json.empty.env', 'manifest.json', 'receipt.json', 'target.json']);
});

test('oversized restore inserts remain disallowed for unrelated financial tables', () => {
  const unrelated = "CREATE TABLE payments(id INTEGER PRIMARY KEY,details TEXT); INSERT INTO payments VALUES(1,'" + 'x'.repeat(100001) + "');";
  assert.throws(() => prepareLocalRestore(unrelated), /Unsupported oversized table/);
});

test('corruption is rejected before invoking any restore', async () => {
  const { backupPath, manifest } = await fixture();
  writeFileSync(backupPath, readFileSync(backupPath, 'utf8').replace('parents VALUES(7)', 'parents VALUES(8)'));
  let called = false;
  await assert.rejects(verifyBackup({ backupPath, manifest, target, now, restore: () => { called = true; } }), /fingerprint mismatch/);
  assert.equal(called, false);
});

test('historical large timetable archives restore before later attendance guards are installed', { timeout: 120000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'school-backup-archive-guard-test-'));
  const migration = readFileSync(join(root, 'migrations/0048_timetable_week_archives.sql'), 'utf8');
  const statements = sqlStatements(migration), firstEnd = statements[0].end;
  const archived = JSON.stringify({ days: [], slots: [], availability: [], loads: [],
    entries: [{ id: 10, school_id: 1, academic_year_id: 1, synthetic_padding: 'x'.repeat(110000) }] });
  const exportSql = `CREATE TABLE schools(id INTEGER PRIMARY KEY);
CREATE TABLE academic_years(id INTEGER PRIMARY KEY,school_id INTEGER);
CREATE TABLE lesson_attendance_sessions(school_id INTEGER,academic_year_id INTEGER,status TEXT,timetable_entry_id INTEGER);
CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY,name TEXT);
INSERT INTO d1_migrations VALUES(1,'0048_timetable_week_archives.sql');
${migration.slice(0, firstEnd)}
INSERT INTO schools VALUES(1);
INSERT INTO academic_years VALUES(1,1);
INSERT INTO timetable_week_archives(archive_key,school_id,academic_year_id,source_revision,snapshot_json,created_at) VALUES('synthetic',1,1,1,'${archived}',1700000000);
INSERT INTO lesson_attendance_sessions VALUES(1,1,'draft',10);
${migration.slice(firstEnd)}`;
  const backupPath = join(directory, 'backup.sql'); writeFileSync(backupPath, exportSql, { mode: 0o600 });
  const manifest = await createManifest({ backupPath, target, capturedAt, codeSha: 'a'.repeat(40), kind: 'manual' });
  const targetPath = join(directory, 'target.json'), manifestPath = join(directory, 'manifest.json');
  writeEvidence(targetPath, target); writeEvidence(manifestPath, manifest);
  const output = join(directory, 'receipt.json');
  const result = cli(['verify', '--backup', backupPath, '--manifest', manifestPath, '--target', targetPath,
    '--local-config', join(directory, 'local.json'), '--output', output]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(readEvidence(output).exact_restore, true);
});

test('expected environment and database identity cannot be substituted', async () => {
  const { backupPath, manifest } = await fixture();
  for (const changed of [{ environment: 'production' }, { database_id: '00000000-0000-0000-0000-000000000002' }, { account_id: '1'.repeat(32) }, { database_name: 'different' }]) {
    await assert.rejects(verifyBackup({ backupPath, manifest, target: { ...target, ...changed }, now, restore: () => assert.fail('must not restore') }), /target mismatch/);
  }
});

test('manifest snapshot, migration history and SQLite foreign keys are verified', async () => {
  const { backupPath, manifest } = await fixture();
  const changed = structuredClone(manifest); changed.snapshot.tables.children.rows++;
  await assert.rejects(verifyBackup({ backupPath, manifest: changed, target, now, restore: () => assert.fail() }), /snapshot mismatch/);
  await assert.rejects(verifyBackup({ backupPath, manifest: { ...manifest, migrations: ['0001_unrelated.sql'] }, target, now, restore: () => assert.fail() }), /Migration history mismatch/);
  await assert.rejects(fixture('\nINSERT INTO children VALUES(4,99,1,1);'), /Foreign key violations/);
  await assert.rejects(fixture("\nINSERT INTO d1_migrations VALUES(2,'0000_initial.sql');"), /duplicate migrations/);
});

test('unsupported SQL cannot attach or write another database', async () => {
  await assert.rejects(fixture("\nATTACH DATABASE 'other.sqlite' AS extra;"), /Unsupported SQL/);
  await assert.rejects(fixture('\nPRAGMA writable_schema=ON;'), /Unsupported SQL/);
  await assert.rejects(fixture('\nVACUUM INTO \'other.sqlite\';'), /Unsupported SQL/);
  await assert.rejects(fixture('\nDELETE FROM parents;'), /Unsupported SQL/);
});

test('all evidence stays outside Git, including symlinked checkout paths', async () => {
  assert.throws(() => externalPath(join(root, 'package.json')), /outside Git/);
  const directory = mkdtempSync(join(tmpdir(), 'school-backup-path-test-')), repo = join(directory, 'checkout');
  mkdirSync(repo); writeFileSync(join(repo, '.git'), 'gitdir: elsewhere'); writeFileSync(join(repo, 'private.json'), '{}');
  const link = join(directory, 'alias'); symlinkSync(repo, link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => externalPath(join(link, 'private.json')), /outside Git/);
  assert.throws(() => externalPath(join(link, 'new.json'), { output: true }), /outside Git/);
  const output = join(directory, 'evidence.json'); writeEvidence(output, { preserved: true });
  assert.throws(() => writeEvidence(output, { preserved: false }), /already exists/);
  assert.deepEqual(readEvidence(output), { preserved: true });
});

test('an output directly under the filesystem root keeps its complete basename', () => {
  const output = join(parse(tmpdir()).root, 'backup-verification-root-path-only-' + process.pid + '.json');
  assert.equal(externalPath(output, { output: true }), output);
});

test('freshness distinguishes capture age from a recent restore of an old backup', async () => {
  const { manifest } = await fixture();
  let result = backupStatus({ manifests: [manifest], receipts: [receiptFor(manifest)], target, now });
  assert.equal(result.healthy, true); assert.equal(result.scheduled_backup_enabled, false); assert.equal(result.files_rechecked, false);
  const old = { ...manifest, captured_at: '2026-08-01T00:00:00.000Z' };
  result = backupStatus({ manifests: [old], receipts: [receiptFor(old)], target, now });
  assert.equal(result.backup_fresh, false); assert.equal(result.restore_fresh, true); assert.equal(result.healthy, false);
  const staleRestore = receiptFor(old, '2026-08-02T00:00:00.000Z');
  result = backupStatus({ manifests: [old, manifest], receipts: [staleRestore], target, now });
  assert.equal(result.backup_fresh, true); assert.equal(result.restore_fresh, false);
  result = backupStatus({ manifests: [], receipts: [], target, now });
  assert.equal(result.healthy, false); assert.equal(result.backup_age_hours, null);
});

test('future dates, duplicate manifests and mismatched restore receipts fail closed', async () => {
  const { manifest } = await fixture();
  assert.throws(() => backupStatus({ manifests: [{ ...manifest, captured_at: '2026-10-02T00:00:00.000Z' }], receipts: [], target, now }), /future/);
  assert.throws(() => backupStatus({ manifests: [manifest, manifest], receipts: [], target, now }), /Duplicate/);
  const wrong = { ...receiptFor(manifest), backup_sha256: '1'.repeat(64) };
  assert.throws(() => backupStatus({ manifests: [manifest], receipts: [wrong], target, now }), /matching manifest/);
  assert.throws(() => backupStatus({ manifests: [manifest], receipts: [receiptFor(manifest, '2026-10-02T00:00:00.000Z')], target, now }), /Invalid restore time/);
  assert.throws(() => backupStatus({ manifests: [manifest], receipts: [], target, now, maxBackupHours: NaN }), /threshold/);
});

test('retention selects newest UTC days/weeks and always preserves pre-migration holds without deletion', async () => {
  const { manifest, directory } = await fixture();
  const manifests = Array.from({ length: 40 }, (_, i) => ({ ...manifest, captured_at: new Date(Date.parse(capturedAt) - i * 86400000).toISOString() }));
  manifests[39].kind = 'pre_migration';
  const before = readdirSync(directory);
  const result = retentionPlan({ manifests, target, now });
  assert.equal(result.dry_run, true); assert.equal(result.deletion_supported, false);
  assert.equal(result.entries.filter(entry => entry.reasons.includes('daily')).length, 7);
  assert.equal(result.entries.filter(entry => entry.reasons.includes('weekly')).length, 4);
  assert.equal(result.entries[39].action, 'keep'); assert.ok(result.entries[39].reasons.includes('pre_migration_hold'));
  assert.ok(result.entries.some(entry => entry.action === 'review_candidate'));
  assert.deepEqual(readdirSync(directory), before);
  assert.throws(() => retentionPlan({ manifests, target, now, daily: 0 }), /positive/);
});

test('CLI manifest/status/retention enforce the contract and use attention exit code', async () => {
  const { directory, backupPath, manifest } = await fixture();
  const targetPath = join(directory, 'target.json'), manifestPath = join(directory, 'manifest.json'); writeEvidence(targetPath, target);
  let result = cli(['manifest', '--backup', backupPath, '--target', targetPath, '--captured-at', capturedAt, '--code-sha', 'a'.repeat(40), '--kind', 'daily', '--output', manifestPath]);
  assert.equal(result.status, 0, result.stderr); assert.deepEqual(readEvidence(manifestPath), manifest);
  const statusPath = join(directory, 'status.json');
  result = cli(['status', '--manifest', manifestPath, '--target', targetPath, '--now', now, '--output', statusPath]);
  assert.equal(result.status, 2); assert.equal(readEvidence(statusPath).restore_fresh, false);
  result = cli(['retention', '--manifest', manifestPath, '--target', targetPath, '--now', now, '--output', join(directory, 'retention.json')]);
  assert.equal(result.status, 0, result.stderr);
  result = cli(['retention', '--manifest', manifestPath, '--target', targetPath, '--delete', '--output', join(directory, 'bad.json')]);
  assert.equal(result.status, 1); assert.ok(!readdirSync(directory).includes('bad.json'));
  result = cli(['manifest', '--backup', backupPath, '--target', targetPath, '--captured-at', capturedAt, '--code-sha', 'a'.repeat(40), '--kind', 'daily', '--output', manifestPath]);
  assert.equal(result.status, 1); assert.deepEqual(readEvidence(manifestPath), manifest);
});
