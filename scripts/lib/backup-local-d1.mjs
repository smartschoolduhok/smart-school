import { getPlatformProxy } from 'wrangler';
import { writeFileSync } from 'node:fs';
import { contentSnapshot, sqlStatements } from './local-d1-restore.mjs';
import { externalPath, writeEvidence } from './backup-verification.mjs';

// A caller supplies a new config path in its private evidence directory.
// The actual rows live only in disposable local workerd state.
export async function restoreLocalD1(plan, configPath) {
  externalPath(configPath, { output: true });
  const emptyEnvPath = externalPath(configPath + '.empty.env', { output: true });
  writeFileSync(emptyEnvPath, '', { flag: 'wx', mode: 0o600 });
  writeEvidence(configPath, {
    name: 'backup-verification-local', compatibility_date: '2026-09-08',
    d1_databases: [{ binding: 'DB', database_name: 'backup-verification-local',
      database_id: '00000000-0000-0000-0000-000000000001' }],
  });
  // A nonempty explicit envFiles list prevents Wrangler's implicit .dev.vars read.
  // Also disable opt-in process-env bindings for this short-lived local operation.
  const environmentKeys = ['CLOUDFLARE_INCLUDE_PROCESS_ENV', 'CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV', 'CLOUDFLARE_CF_FETCH_ENABLED'];
  const previousEnvironment = environmentKeys.map(key => process.env[key]);
  for (const key of environmentKeys) process.env[key] = 'false';
  let proxy;
  try {
    proxy = await getPlatformProxy({ configPath, persist: false, remoteBindings: false, envFiles: [emptyEnvPath] });
    // One transaction defers child/parent checks until every exported row exists.
    // No migrations are applied and no target binding is read from the repository.
    const rowsAndSchema = [], triggers = [];
    for (const statement of sqlStatements(plan.baseSql)) {
      const [first, second] = statement.tokens.map(token => token.text.toUpperCase());
      const destination = first === 'CREATE' && second === 'TRIGGER' ? triggers : rowsAndSchema;
      destination.push(plan.baseSql.slice(statement.start, statement.end));
    }
    await proxy.env.DB.batch([
      proxy.env.DB.prepare('PRAGMA defer_foreign_keys=TRUE'),
      ...rowsAndSchema.map(sql => proxy.env.DB.prepare(sql)),
      ...plan.inserts.map(insert => proxy.env.DB.prepare(insert.sql).bind(...insert.values)),
      // Historical rows must not rerun today's business guards or audit writes.
      // Keep the original trigger creation order after all restored rows.
      ...triggers.map(sql => proxy.env.DB.prepare(sql)),
    ]);
    return await contentSnapshot(async sql => (await proxy.env.DB.prepare(sql).all()).results);
  } finally {
    try { await proxy?.dispose(); }
    finally {
      environmentKeys.forEach((key, index) => {
        if (previousEnvironment[index] === undefined) delete process.env[key];
        else process.env[key] = previousEnvironment[index];
      });
    }
  }
}
