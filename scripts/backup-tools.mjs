import { parseArgs } from 'node:util';
import { BackupValidationError, backupStatus, createManifest, externalPath, readEvidence, retentionPlan, verifyBackup, writeEvidence } from './lib/backup-verification.mjs';

const usage = `Offline backup tools (Node 24):
  manifest --backup FILE --target FILE --captured-at ISO_UTC --code-sha SHA --kind daily|manual|pre_migration --output FILE
  verify --backup FILE --manifest FILE --target FILE --local-config NEW_FILE --output FILE
  status --manifest FILE [--manifest FILE] --receipt FILE [--receipt FILE] --target FILE [--now ISO_UTC] [--max-backup-hours 24] [--max-restore-days 31] --output FILE
  retention --manifest FILE [--manifest FILE] --target FILE [--now ISO_UTC] [--daily 7] [--weekly 4] --output FILE
All evidence paths must be outside Git. Outputs and local config must be new files.
Status inspects recorded evidence offline; retention never deletes files.`;

try {
  const [command, ...args] = process.argv.slice(2);
  if (command === '--help' || command === 'help') { console.log(usage); }
  else {
    const options = { target: { type: 'string' }, output: { type: 'string' } };
    const commandOptions = {
      manifest: ['backup', 'captured-at', 'code-sha', 'kind'],
      verify: ['backup', 'manifest', 'local-config'],
      status: ['manifest', 'receipt', 'now', 'max-backup-hours', 'max-restore-days'],
      retention: ['manifest', 'now', 'daily', 'weekly'],
    };
    if (!commandOptions[command]) throw new Error('Unknown command; use --help');
    for (const name of commandOptions[command]) options[name] = { type: 'string', multiple: ['status', 'retention'].includes(command) && ['manifest', 'receipt'].includes(name) };
    const { values } = parseArgs({ args, options, strict: true, allowPositionals: false });
    const target = readEvidence(values.target);
    externalPath(values.output, { output: true });
    let report;
    if (command === 'manifest') report = await createManifest({ backupPath: values.backup, target, capturedAt: values['captured-at'], codeSha: values['code-sha'], kind: values.kind });
    if (command === 'verify') {
      externalPath(values['local-config'], { output: true });
      const { restoreLocalD1 } = await import('./lib/backup-local-d1.mjs');
      report = await verifyBackup({ backupPath: values.backup, manifest: readEvidence(values.manifest), target,
        restore: plan => restoreLocalD1(plan, values['local-config']) });
    }
    if (command === 'status' || command === 'retention') {
      const manifests = (values.manifest || []).map(readEvidence), now = values.now || new Date().toISOString();
      report = command === 'status'
        ? backupStatus({ manifests, receipts: (values.receipt || []).map(readEvidence), target, now,
          maxBackupHours: Number(values['max-backup-hours'] || 24), maxRestoreDays: Number(values['max-restore-days'] || 31) })
        : retentionPlan({ manifests, target, now, daily: Number(values.daily || 7), weekly: Number(values.weekly || 4) });
    }
    writeEvidence(values.output, report);
    console.log(JSON.stringify({ command, result: command === 'status' && !report.healthy ? 'needs_attention' : 'pass', output: values.output, remote_access: false }));
    if (command === 'status' && !report.healthy) process.exitCode = 2;
  }
} catch (error) {
  // SQLite/runtime errors may contain private SQL or rows. Never echo them.
  const reason = error instanceof BackupValidationError ? error.message : 'Check paths, manifest, fingerprint, target and SQL restore compatibility';
  console.error(`Backup operation failed: ${reason}. No successful evidence was written. Use --help for the contract.`);
  process.exitCode = 1;
}
