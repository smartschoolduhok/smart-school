// Disposable genuine workerd D1. Only synthetic fixtures and local test credentials;
// no remote bindings, production data, environment secrets or network services.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getPlatformProxy, unstable_splitSqlQuery } from 'wrangler';
import { createServer } from 'vite';
import { root, migrationFiles, baseFixtureSQL, schoolWorkflowFixtureSQL, request } from '../test/helpers/school-workflow-fixture.mjs';
import { contentSnapshot } from './lib/local-d1-restore.mjs';

const directory = mkdtempSync(join(tmpdir(), 'smart-school-transport-local-'));
const configPath = join(directory, 'wrangler.json');
const name = 'student-transport-local-only';
const transportMigration = '0056_student_transport.sql';
mkdirSync(join(directory, 'migrations'));
writeFileSync(configPath, JSON.stringify({
  name, compatibility_date: '2026-04-13',
  d1_databases: [{ binding: 'DB', database_name: name, database_id: '00000000-0000-0000-0000-000000000056', migrations_dir: 'migrations' }],
}));
async function migrate(db, files) {
  for (const file of files) {
    const statements = unstable_splitSqlQuery(readFileSync(join(root, 'migrations', file), 'utf8'));
    await db.batch([...statements.map(sql => db.prepare(sql)), db.prepare('INSERT INTO d1_migrations(name) VALUES(?)').bind(file)]);
  }
}
const snapshot = db => contentSnapshot(async sql => (await db.prepare(sql).all()).results);
const quote = value => '"' + value.replaceAll('"', '""') + '"';
const rowIds = rows => rows.map(row => row.id).sort((a, b) => a - b);
const checks = [];
console.log('LOCAL transport artifacts: ' + directory);
const proxy = await getPlatformProxy({ configPath, persist: { path: join(directory, 'state', 'v3') }, remoteBindings: false, envFiles: [] });
let vite;
try {
  const db = proxy.env.DB;
  const sql = text => db.batch(unstable_splitSqlQuery(text).map(statement => db.prepare(statement)));
  await db.prepare('CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL UNIQUE,applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)').run();
  assert.ok(migrationFiles.includes(transportMigration), 'transport migration exists');
  await migrate(db, migrationFiles.filter(file => file < transportMigration));
  await sql(baseFixtureSQL + schoolWorkflowFixtureSQL + `
    UPDATE students SET birth_date='2000-01-01', father_name='LOCAL father', mother_name='LOCAL mother',
      guardian_name='LOCAL guardian', notes='LOCAL legacy note', class_id=2, section_id=NULL WHERE id=101;
    INSERT INTO students(id,school_id,student_number,full_name,gender,class_id,section_id,status) VALUES
      (104,1,'S104','LOCAL previous year','male',1,2,'active'),
      (105,1,'S105','LOCAL withdrawn','female',1,2,'active'),
      (106,1,'S106','LOCAL archived','male',1,2,'archived'),
      (107,1,'S107','LOCAL unplaced','female',NULL,NULL,'active');
    INSERT INTO student_enrollments(school_id,student_id,academic_year_id,class_id,section_id,status,promotion_status,created_by_user_id) VALUES
      (1,104,2,1,2,'active','pending',1),(1,105,1,1,2,'withdrawn','pending',1),(1,106,1,1,2,'active','pending',1);
    INSERT INTO grades(school_id,student_subject_id,first_month) SELECT school_id,id,82 FROM student_subjects;
  `);
  const ageException = { reference: 'LOCAL transport exception', document_date: '2026-09-01', authority: 'LOCAL authority', reason: 'LOCAL synthetic age exception', class_id: 1, birth_date: '2000-01-01', gender: 'male', verified_by_user_id: 1, verified_at: 1780000000 };
  await db.prepare(`INSERT INTO student_study_status(school_id,student_id,academic_year_id,study_status,grades_visible,age_exception_json,updated_by_user_id,change_reason)
    VALUES (1,101,1,'hosted',0,?,1,'LOCAL before transport migration')`).bind(JSON.stringify(ageException)).run();
  await db.prepare(`INSERT INTO student_study_status(school_id,student_id,academic_year_id,study_status,grades_visible,updated_by_user_id,change_reason)
    VALUES (1,102,1,'affiliated',1,1,'LOCAL before transport migration')`).run();
  const beforeMigration = await snapshot(db);
  await migrate(db, [transportMigration]);
  const afterMigration = await snapshot(db);
  for (const [table, before] of Object.entries(beforeMigration.tables)) {
    if (['sqlite_sequence', 'd1_migrations'].includes(table)) continue;
    const after = afterMigration.tables[table];
    if (table !== 'students') {
      assert.deepEqual(after, before, table + ' values and SQLite types preserved');
      continue;
    }
    assert.deepEqual(after.columns.slice(0, before.columns.length), before.columns, 'existing student column definitions preserved');
    assert.equal(after.count, before.count, 'existing student row count preserved');
    const oldValues = after.content.map(row => JSON.stringify(JSON.parse(row).slice(0, before.columns.length))).sort();
    assert.deepEqual(oldValues, before.content, 'every old student value and SQLite type preserved');
  }
  for (const schema of beforeMigration.schema) {
    if (schema.type === 'table' && schema.name === 'students') continue;
    assert.deepEqual(afterMigration.schema.find(item => item.type === schema.type && item.name === schema.name), schema, schema.name + ' schema unchanged');
  }
  assert.equal(afterMigration.tables.residential_areas.count, 0);
  assert.equal(afterMigration.tables.transport_lines.count, 0);
  assert.deepEqual(afterMigration.foreignKeys, []);
  const defaultRows = (await db.prepare('SELECT residential_area_id,transport_to_school,transport_from_school,transport_to_school_line_id,transport_from_school_line_id FROM students').all()).results;
  assert.ok(defaultRows.every(row => row.residential_area_id === null && row.transport_to_school === 'unspecified' && row.transport_from_school === 'unspecified' && row.transport_to_school_line_id === null && row.transport_from_school_line_id === null));
  checks.push('0056 preserves all old student values/types, other tables and existing schema objects; legacy transport defaults and foreign keys are valid');
  // Include future migrations too, while keeping the migration-preservation assertion specific to 0056.
  await migrate(db, migrationFiles.filter(file => file > transportMigration));
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM d1_migrations').first()).count, migrationFiles.length);

  vite = await createServer({ root, appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false } });
  const { default: app } = await vite.ssrLoadModule('/src/worker.ts');
  const call = async (role, method, path, body, expected = 200) => {
    const response = await request(app, { d1: db }, role, method, path, body);
    assert.equal(response.status, expected, method + ' ' + path + ': ' + JSON.stringify(response));
    return response.data;
  };
  const area = await call('owner', 'POST', '/api/transport/areas', { school_id: 1, name: '  حي   النور  ' }, 201);
  assert.equal(area.name, 'حي النور');
  await call('owner', 'POST', '/api/transport/areas', { school_id: 1, name: 'حي الـنُور' }, 409);
  const foreignArea = await call('admin', 'POST', '/api/transport/areas', { school_id: 2, name: 'LOCAL foreign area' }, 201);
  const firstLine = await call('owner', 'POST', '/api/transport/lines', { school_id: 1, name: 'LOCAL first line', driver_name: 'LOCAL driver A', driver_phone: '00000000001' }, 201);
  const secondLine = await call('registrar', 'POST', '/api/transport/lines', { school_id: 1, name: 'LOCAL second line', driver_name: 'LOCAL driver B', driver_phone: '00000000002' }, 201);
  const foreignLine = await call('admin', 'POST', '/api/transport/lines', { school_id: 2, name: 'LOCAL foreign line' }, 201);
  await call('owner', 'PUT', `/api/transport/areas/${area.id}`, { school_id: 1, name: 'حي النور الجديد' });
  await call('owner', 'PUT', `/api/transport/lines/${firstLine.id}`, { school_id: 1, name: 'LOCAL renamed line', driver_name: 'LOCAL renamed driver', driver_phone: '00000000003' });
  assert.ok((await call('owner', 'GET', '/api/transport/areas?school_id=1')).every(row => row.school_id === 1));
  assert.equal((await call('owner', 'GET', '/api/transport/lines?school_id=1')).length, 2);
  checks.push('normalized area and line CRUD runs on workerd D1 with duplicate and tenant isolation');

  const ruleKey = crypto.randomUUID();
  await call('registrar', 'POST', '/api/regulations', {
    school_id: 1, regulation_key: ruleKey, academic_year_id: 1, class_id: 1, process: 'admission',
    title: 'LOCAL transport age preservation', jurisdiction: 'LOCAL TEST', source_reference: 'LOCAL TEST only', source_url: 'https://example.test/local-transport-age',
    effective_from: '2026-01-01', effective_to: '2099-12-31',
    rules: { age_reference_date: '2026-09-01', age_rule: 'bounded', age_scope: 'continuing', min_age_months: 120, max_age_months: 240, repeat_rule: 'not_applicable', max_previous_repeats: null, acceleration: 'prohibited', required_documents: [] },
  }, 201);
  await call('owner', 'POST', `/api/regulations/${ruleKey}/approve`, { revision: 1, confirm_source_verified: true, reason: 'LOCAL synthetic rule' });
  const statusPath = '/api/students/101/study-status?school_id=1&academic_year_id=1';
  const statusBefore = await call('owner', 'GET', statusPath);
  assert.equal(statusBefore.study_status, 'hosted');
  assert.equal(statusBefore.grades_visible, false);
  assert.deepEqual(statusBefore.age_exception, ageException);
  const ageBefore = (await call('owner', 'GET', '/api/student-age-review?school_id=1&academic_year_id=1')).rows.find(row => row.student_id === 101).age_check;
  assert.equal(ageBefore.status, 'documented_exception');
  const protectedBefore = await snapshot(db);
  const protectedStudentColumns = beforeMigration.tables.students.columns.map(column => column.name).filter(column => !['guardian_phone', 'address', 'updated_at'].includes(column));
  const protectedStudentQuery = `SELECT ${protectedStudentColumns.map(quote).join(',')} FROM students ORDER BY id`;
  const protectedStudents = (await db.prepare(protectedStudentQuery).all()).results;

  const initialRoster = await call('registrar', 'GET', '/api/transport/roster?school_id=1');
  assert.equal(initialRoster.academic_year.id, 1);
  assert.equal(initialRoster.school_name, 'A');
  assert.deepEqual(rowIds(initialRoster.students), [101, 102]);
  assert.equal(initialRoster.students.find(student => student.id === 101).class_name, 'Class A', 'roster follows current-year enrollment rather than stale legacy class');
  await call('owner', 'PUT', '/api/students/101', {
    school_id: 1, residential_area_id: area.id, guardian_phone: '00000000101', address: 'LOCAL street 101',
    transport_to_school: 'private', transport_from_school: 'family', private_driver_name: 'LOCAL private driver', private_driver_phone: '00000000999',
    guardian_phone_secondary: '00000000102', pickup_landmark: 'LOCAL meeting point',
  });
  const privateProfile = await call('owner', 'GET', '/api/students/101');
  assert.equal(privateProfile.residential_area_name, 'حي النور الجديد');
  assert.equal(privateProfile.transport_to_school, 'private');
  assert.equal(privateProfile.transport_from_school, 'family');
  assert.equal(privateProfile.private_driver_name, 'LOCAL private driver');
  assert.equal(privateProfile.guardian_phone_secondary, '00000000102');
  const assigned = await call('registrar', 'PUT', '/api/transport/assign', { school_id: 1, student_ids: [101, 102], line_id: firstLine.id, direction: 'to_school' });
  assert.equal(assigned.updated, 2);
  let profile = await call('owner', 'GET', '/api/students/101');
  assert.equal(profile.transport_to_school_line_name, 'LOCAL renamed line');
  assert.equal(profile.transport_from_school, 'family');
  assert.equal(profile.private_driver_phone, '00000000999');
  await call('owner', 'PUT', '/api/transport/assign', { school_id: 1, student_ids: [101], line_id: secondLine.id, direction: 'from_school' });
  profile = await call('owner', 'GET', '/api/students/101');
  assert.equal(profile.transport_to_school_line_id, firstLine.id);
  assert.equal(profile.transport_from_school_line_id, secondLine.id);
  await call('owner', 'PUT', '/api/students/101', { school_id: 1, transport_to_school: 'private', transport_from_school: 'family' });
  profile = await call('owner', 'GET', '/api/students/101');
  assert.equal(profile.transport_to_school_line_id, null);
  assert.equal(profile.transport_from_school_line_id, null);
  assert.equal(profile.private_driver_phone, '00000000999');
  checks.push('private/family journeys remain independent; line assignment preserves the opposite journey and changing mode clears stale line references');

  for (const role of ['teacher', 'parent', 'accountant']) {
    await call(role, 'GET', '/api/transport/roster?school_id=1', undefined, 403);
    await call(role, 'POST', '/api/transport/areas', { school_id: 1, name: 'LOCAL denied area' }, 403);
    await call(role, 'PUT', '/api/transport/assign', { school_id: 1, student_ids: [101], line_id: firstLine.id, direction: 'both' }, 403);
  }
  await call('owner', 'GET', '/api/transport/roster?school_id=2', undefined, 403);
  await call('admin', 'GET', '/api/transport/roster', undefined, 400);
  assert.deepEqual(rowIds((await call('admin', 'GET', '/api/transport/roster?school_id=2')).students), [103]);
  await call('owner', 'PUT', '/api/students/101', { school_id: 1, residential_area_id: foreignArea.id }, 400);
  await call('owner', 'PUT', '/api/students/101', { school_id: 1, transport_to_school: 'school', transport_to_school_line_id: foreignLine.id }, 400);
  await assert.rejects(db.prepare('UPDATE students SET residential_area_id=? WHERE id=101').bind(foreignArea.id).run(), /transport_area_school_mismatch/);
  await assert.rejects(db.prepare("UPDATE students SET transport_to_school='school',transport_to_school_line_id=? WHERE id=101").bind(foreignLine.id).run(), /transport_to_line_school_mismatch/);
  const transportRows = async () => (await db.prepare('SELECT id,transport_to_school,transport_from_school,transport_to_school_line_id,transport_from_school_line_id FROM students ORDER BY id').all()).results;
  const beforeRejected = await transportRows();
  for (const rejectedId of [103, 104, 105, 106, 107, 999]) {
    await call('owner', 'PUT', '/api/transport/assign', { school_id: 1, student_ids: [101, rejectedId], line_id: secondLine.id, direction: 'both' }, 409);
    assert.deepEqual(await transportRows(), beforeRejected, 'mixed batch rejection leaves every student unchanged');
  }
  await db.prepare("CREATE TRIGGER local_transport_failure BEFORE UPDATE OF transport_to_school_line_id ON students WHEN NEW.id=102 BEGIN SELECT RAISE(ABORT,'LOCAL transport injected failure'); END").run();
  await call('owner', 'PUT', '/api/transport/assign', { school_id: 1, student_ids: [101, 102], line_id: secondLine.id, direction: 'both' }, 500);
  assert.deepEqual(await transportRows(), beforeRejected, 'genuine D1 statement failure rolls back all selected students');
  await db.prepare('DROP TRIGGER local_transport_failure').run();
  checks.push('role/tenant denial, database scope triggers and mixed/ineligible selection rejection; genuine D1 failure rolls back the complete assignment');

  await db.prepare('UPDATE academic_years SET is_active=0 WHERE id=1').run();
  const legacyRoster = await call('owner', 'GET', '/api/transport/roster?school_id=1');
  assert.equal(legacyRoster.academic_year, null);
  assert.deepEqual(rowIds(legacyRoster.students), [101, 102, 104, 105, 107]);
  await db.prepare('UPDATE academic_years SET is_active=1 WHERE id=1').run();
  assert.deepEqual(rowIds((await call('owner', 'GET', '/api/transport/roster?school_id=1')).students), [101, 102]);
  checks.push('current-year roster excludes historic, withdrawn, archived and unplaced rows; no-active-year fallback is explicit and school-scoped');

  assert.deepEqual(await call('owner', 'GET', statusPath), statusBefore);
  assert.equal((await call('owner', 'GET', '/api/students/102/study-status?school_id=1&academic_year_id=1')).study_status, 'affiliated');
  const ageAfter = (await call('owner', 'GET', '/api/student-age-review?school_id=1&academic_year_id=1')).rows.find(row => row.student_id === 101).age_check;
  assert.deepEqual(ageAfter, ageBefore, 'transport changes do not alter age evaluation or the documented exception');
  assert.deepEqual((await db.prepare(protectedStudentQuery).all()).results, protectedStudents, 'transport edits preserve every unrelated original student field');
  const protectedAfter = await snapshot(db);
  for (const table of ['student_enrollments', 'student_subjects', 'grades', 'result_cards', 'student_study_status', 'student_study_status_audit', 'academic_years']) {
    assert.deepEqual(protectedAfter.tables[table], protectedBefore.tables[table], table + ' unchanged by transport');
  }
  const hiddenGrades = await call('owner', 'GET', '/api/students/101/grades');
  assert.equal(hiddenGrades.grades_visible, false);
  assert.deepEqual(hiddenGrades.grades, []);
  assert.equal((await db.prepare('SELECT first_month FROM grades g JOIN student_subjects ss ON ss.id=g.student_subject_id WHERE ss.student_id=101').first()).first_month, 82);
  checks.push('birth identity, age exception/evaluation, hosted/affiliated status, hidden grades, enrollment and stored scores are untouched');

  const bulkIds = Array.from({ length: 100 }, (_, index) => index + 2000);
  await db.batch(bulkIds.map(id => db.prepare("INSERT INTO students(id,school_id,student_number,full_name,gender,status) VALUES (?,1,?,?,'male','active')").bind(id, `LOCAL-B${id}`, `LOCAL bulk ${id}`)));
  await db.batch(bulkIds.map(id => db.prepare("INSERT INTO student_enrollments(school_id,student_id,academic_year_id,class_id,section_id,status,promotion_status,created_by_user_id) VALUES (1,?,1,1,2,'active','pending',1)").bind(id)));
  const maximumBatch = await call('registrar', 'PUT', '/api/transport/assign', { school_id: 1, student_ids: bulkIds, line_id: firstLine.id, direction: 'both' });
  assert.equal(maximumBatch.updated, 100);
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM students WHERE id>=2000 AND transport_to_school_line_id=? AND transport_from_school_line_id=?').bind(firstLine.id, firstLine.id).first()).count, 100);
  await call('owner', 'PUT', '/api/transport/assign', { school_id: 1, student_ids: [...bulkIds, 101], line_id: secondLine.id, direction: 'both' }, 400);
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM students WHERE id>=2000 AND transport_to_school_line_id=? AND transport_from_school_line_id=?').bind(firstLine.id, firstLine.id).first()).count, 100);
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
  checks.push('maximum 100-student assignment succeeds on genuine D1; 101-student request fails without partial writes');
  const evidence = { local_only: true, runtime: 'workerd D1', checks, migrations: migrationFiles.length, old_student_columns_preserved: beforeMigration.tables.students.columns.length, old_student_rows_preserved: beforeMigration.tables.students.count, foreign_key_check: [] };
  writeFileSync(join(directory, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await vite?.close();
  await proxy.dispose();
}
