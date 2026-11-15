// Daily D1 backup: export -> manifest -> local restore proof -> retention prune.
// Run by a Windows scheduled task (scripts/register-daily-backup-task.ps1).
// All private files stay under --root, which must be outside Git.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { externalPath, readEvidence } from './lib/backup-verification.mjs';
import { failureAlertText, runDailyBackup } from './lib/daily-backup.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));
const { values } = parseArgs({ options: { root: { type: 'string' }, target: { type: 'string' }, daily: { type: 'string', default: '7' },
  weekly: { type: 'string', default: '4' }, 'no-prune': { type: 'boolean', default: false } }, strict: true });
if (!values.root || !values.target) { console.error('Usage: run-daily-backup.mjs --root DIR --target FILE [--daily 7] [--weekly 4] [--no-prune]'); process.exit(1); }

// The root itself must exist and sit outside any Git checkout; probing a new
// child path runs the same checks the evidence writers use.
const root = dirname(externalPath(join(values.root, '.daily-backup-root-check'), { output: true }));
const target = readEvidence(values.target);
const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' });
const codeSha = git.status === 0 ? git.stdout.trim() : '0'.repeat(40);

function exportDatabase({ target, output }) {
  const wrangler = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
  // Output is discarded: it contains a signed download link for the export.
  const run = spawnSync(process.execPath, [wrangler, 'd1', 'export', target.database_name, '--remote', '--output', output],
    { cwd: repo, stdio: 'ignore', timeout: 15 * 60 * 1000, env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: target.account_id, CI: '1' } });
  if (run.status !== 0 || !existsSync(output)) throw new Error('wrangler export failed');
}

async function notify(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return false;
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chat, text }) });
    return response.ok;
  } catch { return false; }
}

const { restoreLocalD1 } = await import('./lib/backup-local-d1.mjs');
const result = await runDailyBackup({ root, target, codeSha, exportDatabase, restore: restoreLocalD1,
  daily: Number(values.daily), weekly: Number(values.weekly), prune: !values['no-prune'] });
console.log(JSON.stringify(result));
if (!result.ok) {
  await notify(failureAlertText(result, target.environment));
  process.exitCode = 1;
}
