// Offline evidence tools. No cloud identity lookup, remote binding, upload or deletion.
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { contentSnapshot, digest, orderRestoreTables, prepareLocalRestore, sqlStatements, assertSameContent } from './local-d1-restore.mjs';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export class BackupValidationError extends Error {}
const check = (condition, message) => { if (!condition) throw new BackupValidationError(message); };
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);

export function timestamp(value) {
  check(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value), 'Use an ISO UTC timestamp with milliseconds');
  const time = Date.parse(value);
  check(Number.isFinite(time) && new Date(time).toISOString() === value, 'Invalid timestamp');
  return time;
}

export function validateTarget(target) {
  check(isObject(target), 'Target is required');
  check(['local', 'staging', 'production'].includes(target.environment), 'Invalid target environment');
  check(typeof target.account_id === 'string' && /^[a-f0-9]{32}$/.test(target.account_id), 'Invalid account ID');
  check(uuid(target.database_id), 'Invalid database ID');
  check(typeof target.database_name === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(target.database_name), 'Invalid database name');
  check(Object.keys(target).sort().join(',') === 'account_id,database_id,database_name,environment', 'Unexpected target fields');
  return target;
}

function sameTarget(actual, expected) {
  validateTarget(actual); validateTarget(expected);
  for (const key of Object.keys(expected)) check(actual[key] === expected[key], 'Backup target mismatch');
}

// Resolve symlinks and reject every Git checkout, including other worktrees.
export function externalPath(path, { output = false } = {}) {
  check(typeof path === 'string' && path.length > 0, 'A file path is required');
  const absolute = resolve(path);
  if (output) check(!existsSync(absolute) && !lstatExists(absolute), 'Output already exists');
  const real = output ? resolve(realpathSync(dirname(absolute)), basename(absolute)) : realpathSync(absolute);
  for (let parent = output ? dirname(real) : (statSync(real).isDirectory() ? real : dirname(real));;) {
    check(!existsSync(resolve(parent, '.git')), 'Backup evidence must stay outside Git');
    const next = dirname(parent); if (next === parent) break; parent = next;
  }
  if (!output) check(statSync(real).isFile(), 'Expected a regular evidence file');
  return real;
}

function lstatExists(path) { try { lstatSync(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
export const readEvidence = path => JSON.parse(readFileSync(externalPath(path), 'utf8'));
export function writeEvidence(path, value) { writeFileSync(externalPath(path, { output: true }), JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }

function validateSql(sql) {
  const statements = sqlStatements(sql);
  check(statements.length > 0, 'Empty SQL export');
  for (const statement of statements) {
    const words = statement.tokens.slice(0, 3).map(token => token.text.toUpperCase());
    const pragma = statement.tokens.map(token => token.text.toUpperCase()).join('');
    check((words[0] === 'CREATE' && ['TABLE', 'INDEX', 'TRIGGER', 'VIEW'].includes(words[1])) ||
      (words[0] === 'CREATE' && words[1] === 'UNIQUE' && words[2] === 'INDEX') ||
      (words[0] === 'INSERT' && words[1] === 'INTO') ||
      pragma === 'DELETEFROMSQLITE_SEQUENCE;' ||
      pragma === 'PRAGMADEFER_FOREIGN_KEYS=TRUE;', 'Unsupported SQL export statement');
  }
}

export function summarizeSnapshot(snapshot) {
  check(snapshot.foreignKeys.length === 0, 'Foreign key violations');
  return {
    schema_sha256: digest(snapshot.schema),
    tables: Object.fromEntries(Object.entries(snapshot.tables).map(([name, table]) => [name, {
      rows: table.count, columns_sha256: digest(table.columns), content_sha256: table.hash,
    }])),
    foreign_key_violations: 0,
  };
}

async function inspectSql(bytes) {
  const sql = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  validateSql(sql);
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  try {
    db.exec(orderRestoreTables(sql));
    const snapshot = await contentSnapshot(async query => db.prepare(query).all());
    const migrations = db.prepare('SELECT name FROM d1_migrations ORDER BY id').all().map(row => row.name);
    check(migrations.length > 0 && new Set(migrations).size === migrations.length, 'Missing or duplicate migrations');
    check(migrations.every(name => typeof name === 'string' && /^\d{4}_[a-zA-Z0-9_]+\.sql$/.test(name)), 'Invalid migration name');
    return { sql, snapshot, migrations, summary: summarizeSnapshot(snapshot) };
  } finally { db.close(); }
}

export function validateManifest(manifest, target) {
  check(isObject(manifest) && manifest.version === 1, 'Unsupported backup manifest');
  sameTarget(manifest.target, target);
  timestamp(manifest.captured_at);
  check(typeof manifest.code_sha === 'string' && /^[a-f0-9]{40}$/.test(manifest.code_sha), 'Invalid code SHA');
  check(['daily', 'manual', 'pre_migration'].includes(manifest.kind), 'Invalid backup kind');
  check(Number.isSafeInteger(manifest.bytes) && manifest.bytes > 0 && hash(manifest.sha256), 'Invalid backup fingerprint');
  check(manifest.identity_source === 'operator_supplied' && manifest.r2_included === false, 'Invalid manifest scope');
  check(Array.isArray(manifest.migrations) && manifest.migrations.length > 0 && new Set(manifest.migrations).size === manifest.migrations.length, 'Invalid migration history');
  check(manifest.migrations.every(name => typeof name === 'string' && /^\d{4}_[a-zA-Z0-9_]+\.sql$/.test(name)), 'Invalid migration name');
  check(isObject(manifest.snapshot) && hash(manifest.snapshot.schema_sha256) && manifest.snapshot.foreign_key_violations === 0, 'Invalid snapshot');
  check(isObject(manifest.snapshot.tables) && Object.keys(manifest.snapshot.tables).length > 0, 'Missing tables');
  for (const table of Object.values(manifest.snapshot.tables)) check(isObject(table) && Number.isSafeInteger(table.rows) && table.rows >= 0 && hash(table.columns_sha256) && hash(table.content_sha256), 'Invalid table evidence');
  return manifest;
}

export async function createManifest({ backupPath, target, capturedAt, codeSha, kind }) {
  validateTarget(target); timestamp(capturedAt);
  const bytes = readFileSync(externalPath(backupPath));
  const inspected = await inspectSql(bytes);
  const manifest = { version: 1, target, captured_at: capturedAt, code_sha: codeSha, kind,
    identity_source: 'operator_supplied', r2_included: false, bytes: bytes.length, sha256: sha256(bytes),
    migrations: inspected.migrations, snapshot: inspected.summary };
  return validateManifest(manifest, target);
}

export async function verifyBackup({ backupPath, manifest, target, restore, now = new Date().toISOString() }) {
  validateManifest(manifest, target);
  check(timestamp(now) >= timestamp(manifest.captured_at), 'Backup capture is in the future');
  const bytes = readFileSync(externalPath(backupPath));
  check(bytes.length === manifest.bytes && sha256(bytes) === manifest.sha256, 'Backup fingerprint mismatch');
  const inspected = await inspectSql(bytes);
  check(JSON.stringify(inspected.migrations) === JSON.stringify(manifest.migrations), 'Migration history mismatch');
  check(digest(inspected.summary) === digest(manifest.snapshot), 'Backup snapshot mismatch');
  const restored = await restore(prepareLocalRestore(inspected.sql));
  assertSameContent(inspected.snapshot, restored);
  return { version: 1, target, verified_at: now, captured_at: manifest.captured_at,
    manifest_sha256: digest(manifest), backup_sha256: manifest.sha256, bytes: manifest.bytes,
    exact_restore: true, engine: 'local-workerd-d1', foreign_key_violations: 0, remote_access: false, r2_verified: false };
}

function validateCatalog(manifests, target, now) {
  validateTarget(target); const time = timestamp(now);
  const seen = new Set();
  for (const manifest of manifests) {
    validateManifest(manifest, target);
    check(timestamp(manifest.captured_at) <= time, 'Backup capture is in the future');
    const id = digest(manifest); check(!seen.has(id), 'Duplicate manifest'); seen.add(id);
  }
  return [...manifests].sort((a, b) => b.captured_at.localeCompare(a.captured_at));
}

export function backupStatus({ manifests, receipts, target, now, maxBackupHours = 24, maxRestoreDays = 31 }) {
  check(Number.isFinite(maxBackupHours) && maxBackupHours > 0 && Number.isFinite(maxRestoreDays) && maxRestoreDays > 0, 'Invalid freshness thresholds');
  const catalog = validateCatalog(manifests, target, now);
  const valid = receipts.map(receipt => {
    check(isObject(receipt) && receipt.version === 1, 'Invalid restore receipt'); sameTarget(receipt.target, target);
    check(receipt.exact_restore === true && receipt.engine === 'local-workerd-d1' && receipt.remote_access === false && receipt.r2_verified === false && receipt.foreign_key_violations === 0, 'Restore did not pass');
    check(timestamp(receipt.verified_at) <= timestamp(now) && timestamp(receipt.verified_at) >= timestamp(receipt.captured_at), 'Invalid restore time');
    const manifest = catalog.find(item => digest(item) === receipt.manifest_sha256);
    check(manifest && manifest.sha256 === receipt.backup_sha256 && manifest.bytes === receipt.bytes && manifest.captured_at === receipt.captured_at, 'Restore receipt has no matching manifest');
    return receipt;
  }).sort((a, b) => b.verified_at.localeCompare(a.verified_at));
  const backupAge = catalog.length ? (timestamp(now) - timestamp(catalog[0].captured_at)) / 3600000 : null;
  const restoreAge = valid.length ? (timestamp(now) - timestamp(valid[0].verified_at)) / 86400000 : null;
  const backupFresh = backupAge !== null && backupAge <= maxBackupHours;
  const restoreFresh = restoreAge !== null && restoreAge <= maxRestoreDays;
  return { version: 1, target, checked_at: now, backup_fresh: backupFresh, restore_fresh: restoreFresh,
    healthy: backupFresh && restoreFresh, backup_age_hours: backupAge, restore_age_days: restoreAge,
    max_backup_hours: maxBackupHours, max_restore_days: maxRestoreDays,
    evidence_only: true, files_rechecked: false, scheduled_backup_enabled: false, r2_verified: false };
}

export function retentionPlan({ manifests, target, now, daily = 7, weekly = 4 }) {
  check(Number.isSafeInteger(daily) && daily >= 1 && Number.isSafeInteger(weekly) && weekly >= 1, 'Retention counts must be positive integers');
  const catalog = validateCatalog(manifests, target, now);
  const days = new Set(), weeks = new Set();
  const entries = catalog.map(manifest => {
    const day = manifest.captured_at.slice(0, 10), date = new Date(manifest.captured_at);
    date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
    const week = date.toISOString().slice(0, 10), reasons = [];
    if (!days.has(day) && days.size < daily) { days.add(day); reasons.push('daily'); }
    if (!weeks.has(week) && weeks.size < weekly) { weeks.add(week); reasons.push('weekly'); }
    if (manifest.kind === 'pre_migration') reasons.push('pre_migration_hold');
    return { manifest_sha256: digest(manifest), backup_sha256: manifest.sha256, captured_at: manifest.captured_at,
      action: reasons.length ? 'keep' : 'review_candidate', reasons };
  });
  return { version: 1, target, planned_at: now, dry_run: true, deletion_supported: false, daily, weekly, entries };
}
