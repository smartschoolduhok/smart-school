import assert from 'node:assert/strict';
import test, {after} from 'node:test';
import {createServer} from 'vite';
import {fixture, request, root} from './helpers/school-workflow-fixture.mjs';

const vite = await createServer({root,appType:'custom',server:{middlewareMode:true,hmr:false}});
const {default:app} = await vite.ssrLoadModule('/src/worker.ts');
after(()=>vite.close());

// Fixture: school 1 has year 1 (active) and year 2 (inactive); school 2 has year 3 (active).
// Student 101 takes Math (subject 1), 102 takes Arabic (2), foreign 103 takes subject 5.
const assignments = (db, studentId) => db.prepare('SELECT id, academic_year_id, is_active, year_archived_at FROM student_subjects WHERE student_id = ? ORDER BY id').all(studentId);
const gradeFor = (db, assignmentId) => db.prepare('SELECT id, final_exam, is_active, year_archived_at FROM grades WHERE student_subject_id = ?').get(assignmentId);
function addGrade(db, assignmentId, finalExam) {
  db.prepare('INSERT INTO grades(school_id, student_subject_id, final_exam) VALUES (1, ?, ?)').run(assignmentId, finalExam);
}
// Student 101 repeats Class 1 / section 2 in year 2.
const repeatInYear2 = db => db.prepare("INSERT INTO student_enrollments(school_id,student_id,academic_year_id,class_id,section_id,status,promotion_status,created_by_user_id) VALUES (1,101,2,1,2,'active','pending',1)").run();
const activate = (f, yearId, schoolId = 1) => request(app, f, 'owner', 'PUT', `/api/academic-years/${yearId}/activate`, {school_id: schoolId});

test('existing and new assignments are stamped with the school active year', async t => {
  const f = fixture(t);
  assert.equal(assignments(f.db, 101)[0].academic_year_id, 1);
  assert.equal(assignments(f.db, 103)[0].academic_year_id, 3);
  const created = await request(app, f, 'owner', 'POST', '/api/student-subjects/assign-one', {school_id: 1, student_id: 101, subject_id: 2});
  assert.equal(created.status, 201, JSON.stringify(created));
  assert.equal(f.db.prepare('SELECT academic_year_id FROM student_subjects WHERE id = ?').get(created.data.id).academic_year_id, 1);
});

test('activating a new year archives last year grades and a repeating student starts with an empty grade row', async t => {
  const f = fixture(t);
  const oldAssignment = assignments(f.db, 101)[0].id;
  addGrade(f.db, oldAssignment, 41);
  const foreignBefore = JSON.stringify(f.db.prepare('SELECT * FROM student_subjects WHERE school_id = 2').all());

  repeatInYear2(f.db);
  const activated = await activate(f, 2);
  assert.equal(activated.status, 200, JSON.stringify(activated));
  const [archived] = assignments(f.db, 101);
  assert.equal(archived.is_active, 0); assert.ok(archived.year_archived_at);
  const oldGrade = gradeFor(f.db, oldAssignment);
  assert.equal(oldGrade.final_exam, 41); assert.equal(oldGrade.is_active, 0);
  assert.ok(oldGrade.year_archived_at, 'the old grade is archived, not deleted');
  assert.equal(JSON.stringify(f.db.prepare('SELECT * FROM student_subjects WHERE school_id = 2').all()), foreignBefore, 'another school is untouched');

  const listed = await request(app, f, 'owner', 'GET', '/api/grades?school_id=1');
  assert.equal(listed.status, 200); assert.deepEqual(listed.data, [], 'archived grades do not appear in the new year');

  // Same student, same subject in the new year: a new assignment and a fresh grade row.
  const again = await request(app, f, 'owner', 'POST', '/api/student-subjects/assign-one', {school_id: 1, student_id: 101, subject_id: 1});
  assert.equal(again.status, 201, JSON.stringify(again));
  assert.notEqual(again.data.id, oldAssignment);
  assert.equal(f.db.prepare('SELECT academic_year_id FROM student_subjects WHERE id = ?').get(again.data.id).academic_year_id, 2);
  const init = await request(app, f, 'owner', 'POST', '/api/grades/initialize-student/101', {school_id: 1});
  assert.ok(init.status < 300, JSON.stringify(init));
  assert.equal(gradeFor(f.db, again.data.id).final_exam, null);
  assert.equal(gradeFor(f.db, oldAssignment).final_exam, 41);
});

test('last year assignments cannot be reactivated and archived grades cannot be edited', async t => {
  const f = fixture(t);
  const oldAssignment = assignments(f.db, 101)[0].id;
  addGrade(f.db, oldAssignment, 55);
  repeatInYear2(f.db);
  await activate(f, 2);

  const reactivated = await request(app, f, 'owner', 'PUT', `/api/student-subjects/${oldAssignment}/reactivate`, {school_id: 1});
  assert.equal(reactivated.status, 409); assert.equal(reactivated.code, 'student_subject_year_closed');
  assert.throws(() => f.db.prepare('UPDATE student_subjects SET is_active = 1 WHERE id = ?').run(oldAssignment), /student_subject_year_closed/);
  assert.throws(() => f.db.prepare('UPDATE grades SET final_exam = 99 WHERE student_subject_id = ?').run(oldAssignment), /grade_year_archived/);
  assert.equal(gradeFor(f.db, oldAssignment).final_exam, 55);
});

test('switching back to the previous year restores its assignments and grades and archives the other year', async t => {
  const f = fixture(t);
  const oldAssignment = assignments(f.db, 101)[0].id;
  addGrade(f.db, oldAssignment, 77);
  repeatInYear2(f.db);
  await activate(f, 2);
  const newYear = await request(app, f, 'owner', 'POST', '/api/student-subjects/assign-one', {school_id: 1, student_id: 101, subject_id: 1});
  assert.equal(newYear.status, 201);

  const back = await activate(f, 1);
  assert.equal(back.status, 200, JSON.stringify(back));
  const rows = assignments(f.db, 101);
  assert.deepEqual(rows.map(row => [row.id, row.academic_year_id, row.is_active, row.year_archived_at == null]),
    [[oldAssignment, 1, 1, true], [newYear.data.id, 2, 0, false]]);
  assert.deepEqual([gradeFor(f.db, oldAssignment).final_exam, gradeFor(f.db, oldAssignment).is_active, gradeFor(f.db, oldAssignment).year_archived_at], [77, 1, null]);
  const listed = await request(app, f, 'owner', 'GET', '/api/grades?school_id=1');
  assert.deepEqual(listed.data.map(row => row.student_subject_id), [oldAssignment]);
});

test('re-activating the already active year changes nothing', async t => {
  const f = fixture(t);
  const before = JSON.stringify(f.db.prepare('SELECT * FROM student_subjects ORDER BY id').all());
  const same = await activate(f, 1);
  assert.equal(same.status, 200);
  assert.equal(JSON.stringify(f.db.prepare('SELECT * FROM student_subjects ORDER BY id').all()), before);
});

test('activation falls back to the pre-0063 behaviour only for missing year-scope schema', async () => {
  const {isMissingYearScopeSchema} = await vite.ssrLoadModule('/src/lib/yearScopedAssignments.ts');
  assert.equal(isMissingYearScopeSchema(new Error('no such column: academic_year_id')), true);
  assert.equal(isMissingYearScopeSchema(new Error('D1_ERROR: no such column: student_subjects.year_archived_at: SQLITE_ERROR')), true);
  assert.equal(isMissingYearScopeSchema(new Error('no such table: student_subjects')), true);
  assert.equal(isMissingYearScopeSchema(new Error('UNIQUE constraint failed: student_subjects.id')), false);
  assert.equal(isMissingYearScopeSchema(new Error('no such column: grades_visible')), false);
});
