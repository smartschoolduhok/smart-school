import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'vite';
import { signJWT } from '../src/lib/jwtSecurity.ts';
import { root, fixture, fixtureSQL, migrationFiles, migrationSQL, entry, revision, snapshot } from './helpers/teaching-load-matrix-fixture.mjs';

const vite = await createServer({ root, appType: 'custom', server: { middlewareMode: true } });
const { default: app } = await vite.ssrLoadModule('/src/worker.ts');
after(() => vite.close());
const secret = 'timetable-clear-generated-test-secret-only-2026';
const scope = { school_id: 1, academic_year_id: 1 };
const token = await signJWT({ id: 1, email: 'owner@matrix.test', auth_version: 1 }, secret);
async function call(f, path, body = scope, auth = token) {
  const r = await app.request('http://localhost/api/timetable/' + path, {
    method: 'POST', headers: { Authorization: 'Bearer ' + auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }, { DB: f.d1, JWT_SECRET: secret, APP_ENV: 'test' });
  return { status: r.status, body: await r.json() };
}
function current() {
  const f = fixture();
  f.db.exec('UPDATE timetable_teaching_loads SET employee_id=1 WHERE id=1');
  entry(f.db, 1, 1, 1); entry(f.db, 2, 2);
  f.db.exec(`INSERT INTO timetable_entries(school_id,academic_year_id,slot_id,teaching_load_id) VALUES(1,2,8,4),(2,3,9,6)`);
  return f;
}
const confirmedBody = f => ({ ...scope, expected_revision: revision(f.db), confirm_clear: true });
function attendance(db) {
  db.exec(`INSERT INTO lesson_attendance_sessions(school_id,academic_year_id,timetable_entry_id,session_date,day_of_week,slot_id,teaching_load_id,teacher_employee_id,class_id,section_id,subject_id,lesson_number,start_time_snapshot,end_time_snapshot,teacher_name_snapshot,class_name_snapshot,section_name_snapshot,subject_name_snapshot,status,created_by_user_id,updated_by_user_id)
    SELECT e.school_id,e.academic_year_id,e.id,'2026-09-06',s.day_of_week,s.id,l.id,l.employee_id,l.class_id,l.section_id,l.subject_id,s.lesson_number,s.start_time,s.end_time,'Teacher','Class','A','Subject','draft',1,1
    FROM timetable_entries e JOIN timetable_slots s ON s.id=e.slot_id JOIN timetable_teaching_loads l ON l.id=e.teaching_load_id WHERE e.school_id=1 AND e.academic_year_id=1 AND l.id=1`);
}

test('clear preview is read-only and includes every entry, lock and scope label', async () => {
  const f = current(), before = snapshot(f.db);
  const r = await call(f, 'clear-preview');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.data, { ...scope, school_name: 'A', academic_year_name: '2026-2027', revision: revision(f.db), entry_count: 2, locked_entry_count: 1, pending_attendance_count: 0 });
  assert.deepEqual(snapshot(f.db), before);
  f.db.close();
});

test('clear archives exact entries and locks, preserves all settings and other schools/years, and restores', async () => {
  const f = current(), before = snapshot(f.db), expected = before.timetable_entries.filter(e => e.school_id === 1 && e.academic_year_id === 1);
  const r = await call(f, 'clear', confirmedBody(f));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.cleared, true);
  const version = r.body.data.previous_version;
  assert.equal(version.source, 'manual_clear'); assert.equal(version.old_entry_count, 2); assert.equal(version.new_entry_count, 0); assert.equal(version.created_by_user_id, 1);
  const after = snapshot(f.db);
  assert.deepEqual(after.timetable_entries, before.timetable_entries.filter(e => e.school_id !== 1 || e.academic_year_id !== 1));
  const mutable = new Set(['timetable_entries', 'timetable_revisions', 'timetable_schedule_versions', 'timetable_schedule_version_entries']);
  for (const table of Object.keys(before).filter(t => !mutable.has(t))) assert.deepEqual(after[table], before[table], table);
  assert.deepEqual(after.timetable_schedule_version_entries.map(e => [e.original_entry_id,e.slot_id,e.teaching_load_id,e.is_locked]), expected.map(e => [e.id,e.slot_id,e.teaching_load_id,e.is_locked]));
  const preview = await call(f, `versions/${version.id}/restore-preview`);
  assert.equal(preview.status, 200); assert.equal(preview.body.data.can_apply, true, JSON.stringify(preview.body));
  const restore = await call(f, `versions/${version.id}/restore`, { ...scope, expected_revision: preview.body.data.revision, proposal_digest: preview.body.data.proposal_digest, confirm_restore: true });
  assert.equal(restore.status, 200, JSON.stringify(restore.body));
  assert.deepEqual(f.db.prepare('SELECT slot_id,teaching_load_id,is_locked FROM timetable_entries WHERE school_id=1 AND academic_year_id=1 ORDER BY teaching_load_id').all().map(e => [e.slot_id,e.teaching_load_id,e.is_locked]), expected.map(e => [e.slot_id,e.teaching_load_id,e.is_locked]));
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
  f.db.close();
});

test('empty schedule is a no-op and duplicate submission cannot clear a subsequent schedule', async () => {
  const f = fixture(), before = snapshot(f.db);
  assert.equal((await call(f, 'clear', confirmedBody(f))).body.data.cleared, false);
  assert.deepEqual(snapshot(f.db), before);
  f.db.exec('UPDATE timetable_teaching_loads SET employee_id=1 WHERE id=1'); entry(f.db, 1, 1);
  const body = confirmedBody(f);
  assert.equal((await call(f, 'clear', body)).status, 200);
  entry(f.db, 1, 2);
  const newSchedule = snapshot(f.db);
  assert.equal((await call(f, 'clear', body)).status, 409);
  assert.deepEqual(snapshot(f.db), newSchedule);
  f.db.close();
});

for (const change of ['entry', 'settings']) test(`clear rejects ${change} changed after preview`, async () => {
  const f = current(), body = confirmedBody(f);
  if (change === 'entry') entry(f.db, 1, 3);
  else f.db.exec("UPDATE timetable_teacher_constraints SET updated_at=unixepoch(); UPDATE timetable_days SET is_active=0 WHERE school_id=1 AND academic_year_id=1 AND day_of_week=2");
  const before = snapshot(f.db), r = await call(f, 'clear', body);
  assert.equal(r.status, 409); assert.equal(r.body.code, 'stale_timetable_proposal'); assert.deepEqual(snapshot(f.db), before);
  f.db.close();
});

test('atomic revision assertion catches a write between preflight and archive', async () => {
  const f = current(), body = confirmedBody(f);
  let raced;
  f.d1.beforeWrite = () => { entry(f.db, 1, 3); raced = snapshot(f.db); };
  const r = await call(f, 'clear', body);
  assert.equal(r.status, 409); assert.equal(r.body.code, 'stale_timetable_proposal'); assert.deepEqual(snapshot(f.db), raced);
  f.db.close();
});

for (const failAt of [2, 5, 7]) test(`failure at batch statement ${failAt} rolls back archive, deletion and revision`, async () => {
  const f = current(), before = snapshot(f.db); f.d1.failAt = failAt;
  assert.equal((await call(f, 'clear', confirmedBody(f))).status, 500);
  assert.deepEqual(snapshot(f.db), before); f.db.close();
});

test('draft attendance is visible and blocks clear, including a draft created during confirmation', async () => {
  const f = current(), body = confirmedBody(f);
  let raced;
  f.d1.beforeWrite = () => { attendance(f.db); raced = snapshot(f.db); };
  const r = await call(f, 'clear', body);
  assert.equal(r.status, 409); assert.equal(r.body.code, 'pending_attendance_drafts'); assert.deepEqual(snapshot(f.db), raced);
  assert.equal((await call(f, 'clear-preview')).body.data.pending_attendance_count, 1);
  assert.equal((await call(f, 'clear', confirmedBody(f))).status, 409);
  f.db.exec("UPDATE lesson_attendance_sessions SET status='confirmed',confirmed_at=unixepoch(),confirmed_by_user_id=1");
  const history = snapshot(f.db).lesson_attendance_sessions;
  assert.equal((await call(f, 'clear', confirmedBody(f))).status, 200);
  assert.deepEqual(snapshot(f.db).lesson_attendance_sessions, history);
  f.db.close();
});

test('invalid lesson references do not prevent archiving and clearing', async () => {
  const f = current(); f.db.exec("UPDATE subjects SET status='archived' WHERE id=1");
  const r = await call(f, 'clear', confirmedBody(f));
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.data.previous_version.old_entry_count, 2);
  f.db.close();
});

for (const id of [1,2,3,4,5,6,7]) test(`clear enforces academic management authorization for user ${id}`, async () => {
  const f = current(), auth = await signJWT({id, email: f.db.prepare('SELECT email FROM users WHERE id=?').get(id).email, auth_version: 1}, secret), allowed = [1,2,5,6,7].includes(id);
  const before = snapshot(f.db);
  assert.equal((await call(f, 'clear-preview', scope, auth)).status, allowed ? 200 : 403);
  assert.equal((await call(f, 'clear', confirmedBody(f), auth)).status, allowed ? 200 : 403);
  if (!allowed) assert.deepEqual(snapshot(f.db), before);
  f.db.close();
});

for (const body of [
  {...scope,confirm_clear:true}, {...scope,expected_revision:null,confirm_clear:true},
  {...scope,expected_revision:0,confirm_clear:'true'}, {...scope,expected_revision:0,confirm_clear:false},
  {...scope,expected_revision:0,confirm_clear:true,entries:[]},
  {school_id:2,academic_year_id:3,expected_revision:0,confirm_clear:true},
  {...scope,academic_year_id:3,expected_revision:0,confirm_clear:true},
]) test('malformed, unconfirmed or foreign scope clear writes nothing: '+JSON.stringify(body), async () => {
  const f = current(), before = snapshot(f.db), r = await call(f, 'clear', body);
  assert.ok([400,403].includes(r.status), JSON.stringify(r)); assert.deepEqual(snapshot(f.db), before); f.db.close();
});

test('archive-source migration preserves populated versions, restore links, IDs and immutability', () => {
  const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=ON');
  for (const file of migrationFiles.filter(f => !f.startsWith('0050'))) db.exec(migrationSQL(file));
  db.exec(fixtureSQL);
  db.exec(`INSERT INTO timetable_schedule_versions(id,version_key,school_id,academic_year_id,source,previous_revision,old_entry_count,new_entry_count,locked_entry_count,proposal_digest,restored_from_version_id) VALUES
    (40,'old',1,1,'automatic_adoption',1,1,1,1,'digest',NULL),(41,'restore',1,1,'manual_restore',2,1,1,1,'digest',40);
    INSERT INTO timetable_schedule_version_entries(version_id,original_entry_id,school_id,academic_year_id,slot_id,teaching_load_id,is_locked) VALUES(40,123,1,1,1,1,1)`);
  const before = snapshot(db);
  db.exec('BEGIN'); db.exec(migrationSQL('0050_timetable_clear_archive.sql')); db.exec('COMMIT');
  assert.deepEqual(snapshot(db), before); assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.throws(() => db.exec('DELETE FROM timetable_schedule_versions WHERE id=40'), /immutable/);
  assert.throws(() => db.exec("UPDATE timetable_schedule_versions SET source='manual_clear' WHERE id=41"), /immutable/);
  assert.throws(() => db.exec('UPDATE timetable_schedule_version_entries SET is_locked=0'), /immutable/);
  db.exec("INSERT INTO timetable_schedule_versions(version_key,school_id,academic_year_id,source,previous_revision,old_entry_count,new_entry_count,locked_entry_count,proposal_digest) VALUES('clear',1,1,'manual_clear',3,1,0,0,'digest')");
  assert.equal(db.prepare("SELECT id FROM timetable_schedule_versions WHERE version_key='clear'").get().id, 42);
  db.close();
});
