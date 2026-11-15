import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createManifest, retentionPlan } from '../scripts/lib/backup-verification.mjs';
import { restoreLocalD1 } from '../scripts/lib/backup-local-d1.mjs';
import { STATUS_FILE, dailyFolderName, failureAlertText, loadCatalog, runDailyBackup, selectPrunable } from '../scripts/lib/daily-backup.mjs';

const target = { environment: 'local', account_id: '0'.repeat(32), database_id: '00000000-0000-0000-0000-000000000001', database_name: 'synthetic-daily-test' };
const sql = `PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY,name TEXT NOT NULL);
INSERT INTO d1_migrations VALUES(1,'0000_initial.sql');
CREATE TABLE parents(id INTEGER PRIMARY KEY);
INSERT INTO parents VALUES(7);
CREATE TABLE children(id INTEGER PRIMARY KEY,parent_id INTEGER REFERENCES parents(id),name TEXT);
INSERT INTO children VALUES(1,7,'اسم تجريبي');`;
const newRoot = () => mkdtempSync(join(tmpdir(), 'school-daily-backup-test-'));
const writeExport = ({ output }) => writeFileSync(output, sql, { mode: 0o600 });

test('folder names sort by UTC capture time and carry the daily prefix', () => {
  assert.equal(dailyFolderName('2026-11-15T23:05:09.123Z'), 'daily-20261115-230509');
});

test('a daily run exports, writes a manifest, proves a local restore and records its status', { timeout: 120000 }, async () => {
  const root = newRoot();
  const result = await runDailyBackup({ root, target, codeSha: 'a'.repeat(40), exportDatabase: writeExport, restore: restoreLocalD1 });
  assert.equal(result.ok, true, JSON.stringify(result));
  const folder = join(root, result.folder);
  for (const file of ['target.json', 'manifest.json', 'receipt.json', 'retention-plan.json', 'synthetic-daily-test-daily.sql']) assert.ok(existsSync(join(folder, file)), file);
  const manifest = JSON.parse(readFileSync(join(folder, 'manifest.json'), 'utf8'));
  assert.equal(manifest.kind, 'daily');
  assert.equal(JSON.parse(readFileSync(join(folder, 'receipt.json'), 'utf8')).exact_restore, true);
  assert.deepEqual(JSON.parse(readFileSync(join(root, STATUS_FILE), 'utf8')).ok, true);
  assert.deepEqual(result.pruned, []);
});

test('a failed export removes the partial folder, records the step and never echoes the raw error', async () => {
  const root = newRoot();
  const result = await runDailyBackup({ root, target, codeSha: 'a'.repeat(40), restore: restoreLocalD1,
    exportDatabase: () => { throw new Error('INSERT INTO children VALUES(1,7,\'private\')'); } });
  assert.equal(result.ok, false); assert.equal(result.step, 'export'); assert.equal(result.reason, 'internal error');
  assert.deepEqual(readdirSync(root), [STATUS_FILE]);
  assert.doesNotMatch(readFileSync(join(root, STATUS_FILE), 'utf8'), /private/);
  const text = failureAlertText(result, 'staging');
  assert.match(text, /staging/); assert.match(text, /export/); assert.doesNotMatch(text, /private/);
});

test('pruning removes only old daily-job folders and never pre-migration, manual or today\'s backups', async () => {
  const root = newRoot(), source = join(root, 'source.sql'); writeFileSync(source, sql);
  const base = await createManifest({ backupPath: source, target, capturedAt: '2026-11-15T00:00:00.000Z', codeSha: 'a'.repeat(40), kind: 'daily' });
  const place = (name, capturedAt, kind = 'daily') => {
    const folder = join(root, name); mkdirSync(folder);
    writeFileSync(join(folder, 'manifest.json'), JSON.stringify({ ...base, captured_at: capturedAt, kind }));
    writeFileSync(join(folder, 'receipt.json'), '{}');
    return folder;
  };
  const days = Array.from({ length: 40 }, (_, i) => new Date(Date.parse('2026-11-15T01:00:00.000Z') - i * 86400000).toISOString());
  const daily = days.map(day => place(dailyFolderName(day), day));
  const preMigration = place('pre-0050-20261010-000000', '2026-10-10T00:00:00.000Z', 'pre_migration');
  const manual = place('manual-20261011', '2026-10-11T00:00:00.000Z', 'manual');
  const oldDailyNamedManual = place('daily-manual-copy', '2026-10-12T00:00:00.000Z', 'manual');
  const sameDaySecond = place(dailyFolderName('2026-11-15T00:30:00.000Z'), '2026-11-15T00:30:00.000Z');
  mkdirSync(join(root, 'unrelated-folder'));

  const catalog = loadCatalog(root, target);
  assert.equal(catalog.length, 44);
  const plan = retentionPlan({ manifests: catalog.map(entry => entry.manifest), target, now: '2026-11-15T02:00:00.000Z' });
  const prunable = selectPrunable(catalog, plan, daily[0]);
  for (const kept of [daily[0], daily[6], preMigration, manual, oldDailyNamedManual]) assert.ok(!prunable.includes(kept), kept);
  assert.ok(prunable.includes(daily[39]));
  assert.ok(prunable.includes(sameDaySecond), 'a second backup on the same day is not a daily keeper');
  assert.ok(prunable.length >= 25 && prunable.length <= 34, String(prunable.length));
  assert.deepEqual(loadCatalog(root, { ...target, database_name: 'another-db' }), []);
});
