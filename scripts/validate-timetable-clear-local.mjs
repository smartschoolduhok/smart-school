// Disposable fixtures on real local workerd D1. No remote database or user session.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { getPlatformProxy } from 'wrangler';
import { createServer } from 'vite';
import { signJWT } from '../src/lib/jwtSecurity.ts';
import { root, migrationFiles, fixtureSQL } from '../test/helpers/teaching-load-matrix-fixture.mjs';

const directory = mkdtempSync(join(tmpdir(), 'smart-school-clear-local-'));
const configPath = join(directory, 'wrangler.json'), state = join(directory, 'state'), database = 'clear-local-only';
mkdirSync(join(directory, 'migrations'));
const upgrade = '0050_timetable_clear_archive.sql';
for (const file of migrationFiles.filter(f => f !== upgrade)) copyFileSync(join(root, 'migrations', file), join(directory, 'migrations', file));
writeFileSync(configPath, JSON.stringify({ name: database, compatibility_date: '2026-09-29', d1_databases: [{binding: 'DB', database_name: database, database_id: '00000000-0000-0000-0000-000000000050', migrations_dir: 'migrations'}] }));
function run(args) {
  assert.ok(!args.includes('--remote'));
  const r = spawnSync(process.execPath, [join(root, 'node_modules/wrangler/bin/wrangler.js'), ...args, '--local', '--config', configPath, '--persist-to', state], {
    cwd: directory, encoding: 'utf8', env: {...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false'}, timeout: 180000, maxBuffer: 10_000_000,
  });
  assert.equal(r.status, 0, r.stdout + '\n' + r.stderr);
}
run(['d1', 'migrations', 'apply', database]);
const generated = join(directory, 'generated-fixtures.sql');
writeFileSync(generated, fixtureSQL + `
  UPDATE timetable_teaching_loads SET employee_id=1 WHERE id=1;
  INSERT INTO timetable_entries(school_id,academic_year_id,slot_id,teaching_load_id,is_locked) VALUES(1,1,1,1,1),(1,1,2,2,0),(1,2,8,4,0),(2,3,9,6,0);
  INSERT INTO timetable_schedule_versions(id,version_key,school_id,academic_year_id,source,previous_revision,old_entry_count,new_entry_count,locked_entry_count,proposal_digest,restored_from_version_id) VALUES
    (40,'old',1,1,'automatic_adoption',1,1,1,1,'digest',NULL),(41,'restore',1,1,'manual_restore',2,1,1,1,'digest',40);
  INSERT INTO timetable_schedule_version_entries(version_id,original_entry_id,school_id,academic_year_id,slot_id,teaching_load_id,is_locked) VALUES(40,123,1,1,1,1,1);
`);
run(['d1', 'execute', database, '--file', generated]);
copyFileSync(join(root, 'migrations', upgrade), join(directory, 'migrations', upgrade));
run(['d1', 'migrations', 'apply', database]);
console.log('Applied populated archive upgrade on real local D1');
const proxy = await getPlatformProxy({configPath, persist: {path: join(state, 'v3')}, remoteBindings: false, envFiles: []});
const vite = await createServer({root, appType: 'custom', server: {middlewareMode: true, hmr: false}});
const evidence = [];
try {
  const db = proxy.env.DB, {default: app} = await vite.ssrLoadModule('/src/worker.ts');
  const secret = 'generated-local-clear-test-secret-never-used-remotely';
  const token = await signJWT({id: 1, email: 'owner@matrix.test', auth_version: 1}, secret);
  let failNextBatch = false, beforeNextWrite = null;
  const wrap = (real, sql) => ({real, sql, bind(...args) {return wrap(real.bind(...args), sql);}, first: (...a) => real.first(...a), all: (...a) => real.all(...a), run: (...a) => real.run(...a)});
  const guarded = {prepare: sql => wrap(db.prepare(sql), sql), async batch(statements) {
    const real = statements.map(s => s.real);
    if (beforeNextWrite) {const callback = beforeNextWrite; beforeNextWrite = null; await callback();}
    if (failNextBatch) {failNextBatch = false; real.push(db.prepare('SELECT * FROM intentional_clear_late_failure'));}
    return db.batch(real);
  }};
  const scope = {school_id: 1, academic_year_id: 1};
  const call = async (path, input = scope) => {
    const r = await app.request('http://localhost/api/timetable/' + path, {method: 'POST', headers: {Authorization: 'Bearer ' + token, 'Content-Type': 'application/json'}, body: JSON.stringify(input)}, {DB: guarded, JWT_SECRET: secret, APP_ENV: 'test'});
    return {status: r.status, body: await r.json()};
  };
  const snapshot = async () => {
    const tables = (await db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all()).results;
    const pairs = [];
    for (const {name} of tables) pairs.push([name, (await db.prepare(`SELECT * FROM "${name}"`).all()).results.sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))]);
    return Object.fromEntries(pairs);
  };
  const before = await snapshot();
  assert.equal(before.timetable_schedule_versions.length, 2);
  assert.equal(before.timetable_schedule_versions.find(v => v.id === 41).restored_from_version_id, 40);
  assert.equal(before.timetable_schedule_version_entries[0].original_entry_id, 123);
  await assert.rejects(db.prepare('DELETE FROM timetable_schedule_versions WHERE id=41').run(), /immutable/);
  await assert.rejects(db.prepare('UPDATE timetable_schedule_version_entries SET is_locked=0').run(), /immutable/);
  evidence.push('populated migration retains archive IDs, restore links and immutability');
  let preview = await call('clear-preview');
  assert.equal(preview.status, 200); assert.equal(preview.body.data.entry_count, 2); assert.equal(preview.body.data.locked_entry_count, 1);
  assert.deepEqual(await snapshot(), before);
  let body = {...scope, expected_revision: preview.body.data.revision, confirm_clear: true};
  failNextBatch = true;
  assert.equal((await call('clear', body)).status, 500);
  assert.deepEqual(await snapshot(), before);
  evidence.push('late failure rolls back every archive, entry, lock override and revision');
  beforeNextWrite = () => db.prepare('INSERT INTO timetable_entries(school_id,academic_year_id,slot_id,teaching_load_id) VALUES(1,1,3,1)').run();
  const stale = await call('clear', body);
  assert.equal(stale.status, 409); assert.equal(stale.body.code, 'stale_timetable_proposal');
  preview = await call('clear-preview'); body = {...scope, expected_revision: preview.body.data.revision, confirm_clear: true};
  const current = await snapshot();
  const clear = await call('clear', body);
  assert.equal(clear.status, 200, JSON.stringify(clear));
  const version = clear.body.data.previous_version;
  assert.equal(version.id, 42); assert.equal(version.source, 'manual_clear'); assert.equal(version.old_entry_count, 3);
  const cleared = await snapshot();
  const mutable = new Set(['timetable_entries','timetable_revisions','timetable_schedule_versions','timetable_schedule_version_entries']);
  for (const table of Object.keys(current).filter(t => !mutable.has(t))) assert.deepEqual(cleared[table], current[table], table);
  assert.deepEqual(cleared.timetable_entries, current.timetable_entries.filter(e => e.school_id !== 1 || e.academic_year_id !== 1));
  assert.equal((await call('clear', body)).status, 409);
  preview = await call('clear-preview');
  assert.equal((await call('clear', {...scope, expected_revision: preview.body.data.revision, confirm_clear:true})).body.data.cleared, false);
  assert.deepEqual(await snapshot(), cleared);
  evidence.push('clear and duplicate handling preserve settings, other scopes and all prior archives');
  const restorePreview = await call(`versions/${version.id}/restore-preview`);
  assert.equal(restorePreview.body.data.can_apply, true, JSON.stringify(restorePreview));
  const restored = await call(`versions/${version.id}/restore`, {...scope, expected_revision: restorePreview.body.data.revision, proposal_digest: restorePreview.body.data.proposal_digest, confirm_restore:true});
  assert.equal(restored.status, 200, JSON.stringify(restored));
  const placements = rows => rows.filter(e => e.school_id === 1 && e.academic_year_id === 1).map(e => [e.slot_id,e.teaching_load_id,e.is_locked]).sort();
  assert.deepEqual(placements((await snapshot()).timetable_entries), placements(current.timetable_entries));
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
  evidence.push('archived placements and persisted locks restore successfully');
} finally { await vite.close(); await proxy.dispose(); }
const report = {directory, remote_d1: false, migrations: migrationFiles.length, evidence};
writeFileSync(join(directory, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
