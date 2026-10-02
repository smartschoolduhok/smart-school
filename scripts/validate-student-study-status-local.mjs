// Disposable genuine workerd D1. No remote bindings, school data or credentials.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getPlatformProxy, unstable_splitSqlQuery } from 'wrangler';
import { createServer } from 'vite';
import { root, migrationFiles, baseFixtureSQL, schoolWorkflowFixtureSQL, request } from '../test/helpers/school-workflow-fixture.mjs';
import { contentSnapshot } from './lib/local-d1-restore.mjs';
import { copyRegulationTemplate, REGULATION_TEMPLATES } from '../src/lib/policyTemplates.ts';

const directory = mkdtempSync(join(tmpdir(), 'smart-school-study-status-local-'));
const configPath = join(directory, 'wrangler.json'), state = join(directory, 'state');
const name = 'student-study-status-local-only';
mkdirSync(join(directory, 'migrations'));
writeFileSync(configPath, JSON.stringify({ name, compatibility_date: '2026-04-13', d1_databases: [{ binding: 'DB', database_name: name, database_id: '00000000-0000-0000-0000-000000000055', migrations_dir: 'migrations' }] }));
async function migrate(db, files) {
  for (const file of files) {
    const statements = unstable_splitSqlQuery(readFileSync(join(root, 'migrations', file), 'utf8'));
    await db.batch([...statements.map(sql => db.prepare(sql)), db.prepare('INSERT INTO d1_migrations(name) VALUES(?)').bind(file)]);
  }
}
const open = () => getPlatformProxy({ configPath, persist: { path: join(state, 'v3') }, remoteBindings: false, envFiles: [] });
const snapshot = db => contentSnapshot(async sql => (await db.prepare(sql).all()).results);
console.log('LOCAL study status artifacts: ' + directory);
const proxy = await open();
let vite;
const checks = [];
try {
  const db = proxy.env.DB;
  await db.prepare('CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL UNIQUE,applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)').run();
  await migrate(db, migrationFiles.filter(file => file.slice(0,4) <= '0054'));
  await proxy.env.DB.batch(unstable_splitSqlQuery(baseFixtureSQL + schoolWorkflowFixtureSQL + `
    UPDATE students SET birth_date='2000-01-01' WHERE id=101;
    INSERT INTO grades(school_id,student_subject_id,first_month) SELECT school_id,id,82 FROM student_subjects;
  `).map(sql => proxy.env.DB.prepare(sql)));
  const before = await snapshot(db);
  await migrate(db, ['0055_student_study_status.sql']);
  const after = await snapshot(db);
  vite = await createServer({ root, appType: 'custom', server: { middlewareMode: true, hmr: false } });
  for (const [name, value] of Object.entries(before.tables)) if (!['sqlite_sequence','d1_migrations'].includes(name)) assert.deepEqual(after.tables[name], value, name + ' preserved');
  for (const schema of before.schema) assert.deepEqual(after.schema.find(item => item.type === schema.type && item.name === schema.name), schema, schema.name + ' unchanged');
  for (const name of ['student_study_status','student_study_status_audit']) assert.equal(after.tables[name].count, 0);
  assert.deepEqual(after.foreignKeys, []);
  checks.push('0055 preserves every existing table value, SQLite type and schema definition');
  const { default: app } = await vite.ssrLoadModule('/src/worker.ts');
  const call = async (role, method, path, body, expected = 200) => {
    const result = await request(app, { d1: db }, role, method, path, body);
    assert.equal(result.status, expected, method + ' ' + path + ': ' + JSON.stringify(result));
    return result.data;
  };
  const path = '/api/students/101/study-status?school_id=1&academic_year_id=1';
  const initial = await call('owner','GET',path);
  assert.equal(initial.revision, 0); assert.equal(initial.grades_visible, true); assert.equal(initial.study_status, 'regular');
  const body = { school_id: 1, academic_year_id: 1, revision: 0, study_status: 'hosted', grades_visible: false, age_exception: { reference: 'LOCAL ONLY exception 55', document_date: '2026-09-01', authority: 'LOCAL TEST authority', reason: 'LOCAL synthetic older student', class_id: 1 }, change_reason: 'LOCAL annual classification', confirm_age_exception_verified: true };
  const saved = await call('owner','PUT',path,body);
  assert.equal(saved.revision, 1); assert.equal(saved.age_exception.birth_date, '2000-01-01');
  await call('registrar','GET',path);
  await call('teacher','GET',path,undefined,403);
  await call('parent','GET',path,undefined,403);
  await call('owner','GET','/api/students/103/study-status?school_id=2&academic_year_id=3',undefined,403);
  await call('owner','PUT',path,body,409);
  const roster = await call('registrar','GET','/api/student-study-status?school_id=1&academic_year_id=1');
  assert.equal(roster.roster.find(row => row.student_id === 101).study_status, 'hosted');
  assert.equal(roster.roster.find(row => row.student_id === 101).grades_visible, false);
  const previousYear = await call('owner','GET','/api/students/101/study-status?school_id=1&academic_year_id=2');
  assert.equal(previousYear.study_status, 'regular'); assert.equal(previousYear.grades_visible, true); assert.equal(previousYear.age_exception, null);
  checks.push('annual isolation, hosted roster retention, school/role denial and stale-write conflict');
  const hidden = await call('owner','GET','/api/students/101/grades');
  assert.equal(hidden.grades_visible, false); assert.deepEqual(hidden.grades, []);
  const storedScore = await db.prepare('SELECT first_month FROM grades g JOIN student_subjects ss ON ss.id=g.student_subject_id WHERE ss.student_id=101').first();
  assert.equal(storedScore.first_month, 82);
  const rule = copyRegulationTemplate(REGULATION_TEMPLATES[0].id).rules;
  const key = crypto.randomUUID();
  await call('registrar','POST','/api/regulations',{ school_id: 1, regulation_key: key, academic_year_id: 1, class_id: 1, process: 'admission', title: 'LOCAL ONLY age rule', jurisdiction: 'LOCAL TEST', source_reference: 'LOCAL TEST source', source_url: 'https://example.test/local-age', effective_from: '2026-01-01', effective_to: '2099-12-31', rules: rule },201);
  await call('owner','POST',`/api/regulations/${key}/approve`,{ revision: 1, confirm_source_verified: true, reason: 'LOCAL synthetic source only' });
  const ages = await call('owner','GET','/api/student-age-review?school_id=1&academic_year_id=1');
  assert.equal(ages.rows.find(row => row.student_id === 101).age_check.status, 'documented_exception');
  checks.push('documented age exception and hidden grades preserve actual stored scores');
  await db.prepare("CREATE TRIGGER local_fail_status_audit BEFORE INSERT ON student_study_status_audit BEGIN SELECT RAISE(ABORT,'local audit failure'); END").run();
  await call('owner','PUT',path,{ ...body, revision: 1, study_status: 'affiliated', grades_visible: true },503);
  const rolledBack = await call('owner','GET',path);
  assert.equal(rolledBack.revision, 1); assert.equal(rolledBack.study_status, 'hosted'); assert.equal(rolledBack.grades_visible, false);
  await db.prepare('DROP TRIGGER local_fail_status_audit').run();
  await call('owner','PUT',path,{ ...body, revision: 1, study_status: 'affiliated', grades_visible: true });
  const visible = await call('owner','GET','/api/students/101/grades');
  assert.equal(visible.grades[0].first_month, 82);
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
  checks.push('D1 transaction rolls back metadata and visibility when its audit fails; showing grades restores unchanged values');
  const evidence = { local_only: true, checks, existing_tables_preserved: Object.keys(before.tables).filter(name => !['sqlite_sequence','d1_migrations'].includes(name)).length, migrations: after.tables.d1_migrations.count, foreign_key_check: [] };
  writeFileSync(join(directory, 'evidence.json'), JSON.stringify(evidence,null,2));
  console.log(JSON.stringify(evidence,null,2));
} finally { await vite?.close(); await proxy.dispose(); }
