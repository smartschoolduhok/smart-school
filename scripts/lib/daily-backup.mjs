import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { BackupValidationError, createManifest, readEvidence, retentionPlan, validateTarget, verifyBackup, writeEvidence } from './backup-verification.mjs';
import { digest } from './local-d1-restore.mjs';

// Only folders this job creates are ever pruned. Manual and pre-migration
// backups live in differently named folders and are never touched.
export const DAILY_PREFIX = 'daily-';
export const STATUS_FILE = 'daily-backup-status.json';

export function dailyFolderName(capturedAt) {
  const iso = new Date(capturedAt).toISOString();
  return DAILY_PREFIX + iso.slice(0, 10).replaceAll('-', '') + '-' + iso.slice(11, 19).replaceAll(':', '');
}

// Every subfolder holding a manifest and a restore receipt for this target.
// Anything unreadable or for another database is skipped, not deleted.
export function loadCatalog(root, target) {
  const entries = [];
  for (const name of readdirSync(root, { withFileTypes: true })) {
    if (!name.isDirectory()) continue;
    const folder = join(root, name.name), manifestPath = join(folder, 'manifest.json'), receiptPath = join(folder, 'receipt.json');
    if (!existsSync(manifestPath) || !existsSync(receiptPath)) continue;
    try {
      const manifest = readEvidence(manifestPath);
      if (JSON.stringify(manifest.target) !== JSON.stringify(target)) continue;
      entries.push({ folder, manifest });
    } catch { /* not a usable backup folder */ }
  }
  return entries;
}

// A folder is removed only when the retention plan marks it review_candidate,
// it was created by this job, its manifest says daily, and it is not today's.
export function selectPrunable(catalog, plan, keepFolder) {
  const bySha = new Map(plan.entries.map(entry => [entry.manifest_sha256, entry]));
  return catalog.filter(({ folder, manifest }) => folder !== keepFolder
    && basename(folder).startsWith(DAILY_PREFIX) && manifest.kind === 'daily'
    && bySha.get(digest(manifest))?.action === 'review_candidate').map(entry => entry.folder);
}

export async function runDailyBackup({ root, target, codeSha, exportDatabase, restore, now = () => new Date().toISOString(), daily = 7, weekly = 4, prune = true }) {
  validateTarget(target);
  const capturedAt = now(), folder = join(root, dailyFolderName(capturedAt));
  const backupPath = join(folder, `${target.database_name}-daily.sql`);
  let step = 'prepare';
  try {
    mkdirSync(folder);
    writeEvidence(join(folder, 'target.json'), target);
    step = 'export'; await exportDatabase({ target, output: backupPath });
    step = 'manifest';
    const manifest = await createManifest({ backupPath, target, capturedAt, codeSha, kind: 'daily' });
    writeEvidence(join(folder, 'manifest.json'), manifest);
    step = 'verify';
    const receipt = await verifyBackup({ backupPath, manifest, target, restore: plan => restore(plan, join(folder, 'verification-local.json')), now: now() });
    writeEvidence(join(folder, 'receipt.json'), receipt);
    step = 'retention';
    const catalog = loadCatalog(root, target);
    const plan = retentionPlan({ manifests: catalog.map(entry => entry.manifest), target, now: now(), daily, weekly });
    writeEvidence(join(folder, 'retention-plan.json'), plan);
    const pruned = prune ? selectPrunable(catalog, plan, folder) : [];
    for (const old of pruned) rmSync(old, { recursive: true, force: true });
    const result = { ok: true, finished_at: now(), folder: basename(folder), bytes: manifest.bytes, sha256: manifest.sha256,
      migrations: manifest.migrations.length, pruned: pruned.map(path => basename(path)), kept: catalog.length - pruned.length };
    writeStatus(root, result);
    return result;
  } catch (error) {
    // An incomplete export is private data with no evidence; do not leave it behind.
    if (step !== 'retention') rmSync(folder, { recursive: true, force: true });
    const reason = error instanceof BackupValidationError ? error.message : 'internal error';
    const result = { ok: false, finished_at: now(), step, reason, folder: basename(folder) };
    writeStatus(root, result);
    return result;
  }
}

function writeStatus(root, result) {
  writeFileSync(join(root, STATUS_FILE), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
}

export function failureAlertText(result, environment) {
  return [`⚠️ Smart School: فشل النسخ الاحتياطي اليومي (${environment})`, `الخطوة: ${result.step}`, `السبب: ${result.reason}`, `المجلد: ${result.folder}`].join('\n');
}
