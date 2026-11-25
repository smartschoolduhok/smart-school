import assert from 'node:assert/strict';
import test, {after} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {createServer} from 'vite';
import {fixture, request, root} from './helpers/school-workflow-fixture.mjs';
import {arabicNameKey, arabicNameKeySql, compareRoster, rosterOrderSql} from '../src/lib/rosterOrder.ts';

const vite = await createServer({root, appType: 'custom', server: {middlewareMode: true, hmr: false}});
const {default: app} = await vite.ssrLoadModule('/src/worker.ts');
after(() => vite.close());

const NAMES = ['ألين عمار', 'افين فارس', 'إسراء علي', 'آمنة حسن', 'بشرى', 'عبد الله عمر', 'عبدالباسط', 'ره نج احمد', 'رهف وليد', 'گلاویژ', 'كرم', 'زهراء', 'هنا', 'يحيى', 'مؤمن'];

test('the Arabic sort key folds hamza seats, final forms, Kurdish letters and spaces the same in SQL and JS', () => {
  assert.equal(arabicNameKey('ألين'), arabicNameKey('الين'));
  assert.equal(arabicNameKey('عبد الله'), arabicNameKey('عبدالله'));
  assert.equal(arabicNameKey(' فاطمة '), 'فاطمه');
  assert.equal(arabicNameKey('گلاویژ'), 'كلاويز');
  const db = new DatabaseSync(':memory:');
  for (const name of NAMES) assert.equal(db.prepare(`SELECT ${arabicNameKeySql('?')} AS key`).get(name).key, arabicNameKey(name), name);
  db.close();
  // «ألين» and «افين» are both alif names and sort together, before «بشرى».
  const sorted = NAMES.map((full_name, id) => ({full_name, id})).sort(compareRoster('alphabetical')).map(s => s.full_name);
  assert.ok(sorted.indexOf('افين فارس') < sorted.indexOf('بشرى') && sorted.indexOf('ألين عمار') < sorted.indexOf('بشرى'));
  assert.ok(sorted.indexOf('افين فارس') < sorted.indexOf('آمنة حسن'), 'افين before آمنة (امنه): ف comes before م');
  assert.equal(sorted.at(-1), 'يحيى');
});

test('girls-first and boys-first group by gender, then alphabetical, with a stable id tie-break', () => {
  const rows = [{id: 1, full_name: 'يوسف', gender: 'male'}, {id: 2, full_name: 'زهراء', gender: 'female'}, {id: 3, full_name: 'احمد', gender: 'male'}, {id: 4, full_name: 'ألين', gender: 'female'}];
  assert.deepEqual([...rows].sort(compareRoster('girls_first')).map(r => r.id), [4, 2, 3, 1]);
  assert.deepEqual([...rows].sort(compareRoster('boys_first')).map(r => r.id), [3, 1, 4, 2]);
  assert.deepEqual([...rows].sort(compareRoster('alphabetical')).map(r => r.id), [3, 4, 2, 1]);
  assert.match(rosterOrderSql('st', 'st.class_id'), /roster_class\.id = st\.class_id/);
});

test('classes save a roster order, reject unknown values and keep it when an edit omits it', async t => {
  const f = fixture(t);
  const created = await request(app, f, 'owner', 'POST', '/api/classes', {school_id: 1, name: 'السادس', stage: 'إعدادي', roster_order: 'girls_first'});
  assert.equal(created.status, 201, JSON.stringify(created)); assert.equal(created.data.roster_order, 'girls_first');
  assert.equal((await request(app, f, 'owner', 'POST', '/api/classes', {school_id: 1, name: 'x', stage: 'إعدادي', roster_order: 'random'})).status, 400);
  const edited = await request(app, f, 'owner', 'PUT', `/api/classes/${created.data.id}`, {school_id: 1, name: 'السادس العلمي', stage: 'إعدادي', order_index: 6});
  assert.equal(edited.status, 200, JSON.stringify(edited));
  assert.equal(f.db.prepare('SELECT roster_order FROM classes WHERE id = ?').get(created.data.id).roster_order, 'girls_first');
  assert.equal(f.db.prepare('SELECT roster_order FROM classes WHERE id = 1').get().roster_order, 'alphabetical', 'existing classes default to alphabetical');
});

test('student lists and grade sheets follow the class roster order', async t => {
  const f = fixture(t);
  // Class 1 / section 2 already holds 101 (Student A, male) and 102 (Student B, female).
  const insert = f.db.prepare("INSERT INTO students(id,school_id,student_number,full_name,gender,class_id,section_id,status) VALUES (?,1,?,?,?,1,2,'active')");
  insert.run(201, 'R1', 'يوسف سامح', 'male'); insert.run(202, 'R2', 'ألينا خالد', 'female');
  insert.run(203, 'R3', 'احمد خيري', 'male'); insert.run(204, 'R4', 'زمزم سالم', 'female');
  const enroll = f.db.prepare("INSERT INTO student_enrollments(school_id,student_id,academic_year_id,class_id,section_id,status,promotion_status,created_by_user_id) VALUES (1,?,1,1,2,'active','pending',1)");
  for (const id of [201, 202, 203, 204]) enroll.run(id);
  const names = async () => {
    const response = await request(app, f, 'owner', 'GET', '/api/students?school_id=1');
    assert.equal(response.status, 200, JSON.stringify(response));
    return response.data.filter(s => Number(s.class_id) === 1).map(s => s.full_name);
  };

  assert.deepEqual(await names(), ['Student A', 'Student B', 'احمد خيري', 'ألينا خالد', 'زمزم سالم', 'يوسف سامح'], 'alphabetical folds أ with ا (Latin fixture names sort first)');
  f.db.prepare("UPDATE classes SET roster_order = 'girls_first' WHERE id = 1").run();
  assert.deepEqual(await names(), ['Student B', 'ألينا خالد', 'زمزم سالم', 'Student A', 'احمد خيري', 'يوسف سامح']);

  const assignment = f.db.prepare("INSERT INTO student_subjects(school_id,student_id,subject_id,class_id,section_id,is_active,assigned_by_user_id) VALUES (1,?,2,1,2,1,1) RETURNING id");
  for (const id of [201, 202, 203, 204]) f.db.prepare('INSERT INTO grades(school_id, student_subject_id) VALUES (1, ?)').run(assignment.get(id).id);
  const grades = await request(app, f, 'owner', 'GET', '/api/grades?school_id=1&class_id=1&subject_id=2');
  assert.equal(grades.status, 200, JSON.stringify(grades));
  assert.deepEqual(grades.data.map(g => g.student_name), ['ألينا خالد', 'زمزم سالم', 'احمد خيري', 'يوسف سامح']);
});
