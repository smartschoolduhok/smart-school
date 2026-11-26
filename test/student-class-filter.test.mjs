import assert from 'node:assert/strict';
import test, {after} from 'node:test';
import {createServer} from 'vite';
import {fixture, request, root} from './helpers/school-workflow-fixture.mjs';

const vite = await createServer({root, appType: 'custom', server: {middlewareMode: true, hmr: false}});
const {default: app} = await vite.ssrLoadModule('/src/worker.ts');
after(() => vite.close());

// Fixture: school 1 students 101 and 102 sit in class 1 / section 2 (active-year enrollments).
test('the students list filters by class and section ids passed in the query string', async t => {
  const f = fixture(t);
  f.db.prepare("INSERT INTO students(id,school_id,student_number,full_name,gender,class_id,section_id,status) VALUES (301,1,'CF1','Other Class','male',2,NULL,'active')").run();
  f.db.prepare("INSERT INTO student_enrollments(school_id,student_id,academic_year_id,class_id,section_id,status,promotion_status,created_by_user_id) VALUES (1,301,1,2,NULL,'active','pending',1)").run();
  const ids = async query => {
    const response = await request(app, f, 'owner', 'GET', `/api/students?school_id=1${query}`);
    assert.equal(response.status, 200, JSON.stringify(response));
    return response.data.map(s => s.id).sort();
  };
  assert.deepEqual(await ids(''), [101, 102, 301]);
  assert.deepEqual(await ids('&class_id=1'), [101, 102]);
  assert.deepEqual(await ids('&class_id=2'), [301]);
  assert.deepEqual(await ids('&class_id=1&section_id=2'), [101, 102]);
  assert.deepEqual(await ids('&section_id=1'), []);
  assert.deepEqual(await ids('&class_id=abc'), [], 'a malformed id matches nobody instead of erroring');
  assert.deepEqual(await ids('&class_id=0'), []);
});
