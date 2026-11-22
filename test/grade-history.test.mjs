import assert from 'node:assert/strict';
import test, {after} from 'node:test';
import {Window} from 'happy-dom';
import {createServer} from 'vite';
import {fixture, request, root} from './helpers/school-workflow-fixture.mjs';

const window = new Window({url: 'http://localhost'});
for (const key of ['window','document','navigator','HTMLElement','HTMLSelectElement','Element','Node','Event'])
  Object.defineProperty(globalThis, key, {configurable: true, value: key === 'window' ? window : window[key]});
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const {createElement, act} = await import('react'), {createRoot} = await import('react-dom/client');
const vite = await createServer({root, appType: 'custom', server: {middlewareMode: true, hmr: false}});
const {default: app} = await vite.ssrLoadModule('/src/worker.ts');
const {default: StudentGradesSection} = await vite.ssrLoadModule('/src/modules/students/StudentGradesSection.tsx');
after(async () => { await vite.close(); await window.happyDOM.close(); });

// Fixture: school 1 years 1 (active) and 2; student 101 takes Math (subject 1) in year 1.
function closeYearOne(f) {
  const assignment = f.db.prepare('SELECT id FROM student_subjects WHERE student_id = 101').get().id;
  f.db.prepare('INSERT INTO grades(school_id, student_subject_id, final_exam, effective_grade) VALUES (1, ?, 41, 41)').run(assignment);
  f.db.prepare("INSERT INTO student_enrollments(school_id,student_id,academic_year_id,class_id,section_id,status,promotion_status,created_by_user_id) VALUES (1,101,2,1,2,'active','pending',1)").run();
  return assignment;
}

test('a closed year stays readable by management with its saved grades and year list', async t => {
  const f = fixture(t); closeYearOne(f);
  assert.equal((await request(app, f, 'owner', 'PUT', '/api/academic-years/2/activate', {school_id: 1})).status, 200);

  const current = await request(app, f, 'owner', 'GET', '/api/students/101/grades?years=1');
  assert.equal(current.status, 200, JSON.stringify(current));
  assert.equal(current.data.archived, false); assert.equal(current.data.academic_year_id, 2);
  assert.deepEqual(current.data.grades, []);
  assert.deepEqual(current.data.years.map(year => [year.id, year.is_active, year.grade_count]), [[1, 0, 1]]);

  const past = await request(app, f, 'owner', 'GET', '/api/students/101/grades?academic_year_id=1');
  assert.equal(past.status, 200, JSON.stringify(past));
  assert.equal(past.data.archived, true); assert.equal(past.data.academic_year_name, '2026-2027');
  assert.equal(past.data.grades_visible, true);
  assert.deepEqual(past.data.grades.map(grade => [grade.subject_name, grade.final_exam, grade.effective_grade]), [['Math', 41, 41]]);
});

test('archived years are management-only, school-scoped and validated', async t => {
  const f = fixture(t); closeYearOne(f);
  await request(app, f, 'owner', 'PUT', '/api/academic-years/2/activate', {school_id: 1});
  assert.equal((await request(app, f, 'teacher', 'GET', '/api/students/101/grades?academic_year_id=1')).status, 403);
  const teacherYears = await request(app, f, 'teacher', 'GET', '/api/students/101/grades?years=1');
  assert.equal(teacherYears.data?.years, undefined, 'teachers are not offered the year archive');
  assert.equal((await request(app, f, 'owner', 'GET', '/api/students/101/grades?academic_year_id=3')).status, 404, 'another school year');
  assert.equal((await request(app, f, 'owner', 'GET', '/api/students/101/grades?academic_year_id=abc')).status, 400);
  assert.equal((await request(app, f, 'foreignParent', 'GET', '/api/students/101/grades?academic_year_id=1')).status, 403);
});

test('without the new parameters the response keeps its previous shape', async t => {
  const f = fixture(t); closeYearOne(f);
  const plain = await request(app, f, 'owner', 'GET', '/api/students/101/grades');
  assert.equal(plain.status, 200);
  for (const key of ['years', 'archived', 'academic_year_id']) assert.equal(key in plain.data, false, key);
  assert.equal(plain.data.grades[0].final_exam, 41);
  // Asking for the active year explicitly is the normal current view.
  const active = await request(app, f, 'owner', 'GET', '/api/students/101/grades?academic_year_id=1&years=1');
  assert.equal(active.data.archived, false); assert.equal(active.data.grades.length, 1);
});

test('the dossier grades section offers past years and shows an archived year read-only', async t => {
  const requests = [], previousFetch = globalThis.fetch;
  const years = [{id: 2, name: '2027-2028', is_active: 1, grade_count: 0}, {id: 1, name: '2026-2027', is_active: 0, grade_count: 1}];
  globalThis.fetch = async url => {
    const path = String(url); requests.push(path);
    const data = path.includes('academic_year_id=1')
      ? {archived: true, academic_year_id: 1, academic_year_name: '2026-2027', years, grades_visible: true, settings: null, grades: [{id: 9, subject_name: 'رياضيات', final_exam: 41, effective_grade: 41, result_status: null}]}
      : {archived: false, academic_year_id: 2, years, grades_visible: true, settings: null, grades: []};
    return new Response(JSON.stringify({data}), {status: 200, headers: {'content-type': 'application/json'}});
  };
  const host = document.createElement('div'); document.body.append(host);
  const reactRoot = createRoot(host);
  t.after(async () => { await act(async () => reactRoot.unmount()); host.remove(); globalThis.fetch = previousFetch; });
  await act(async () => reactRoot.render(createElement(StudentGradesSection, {studentId: 101})));
  await act(async () => { await new Promise(r => setTimeout(r, 20)); });
  assert.deepEqual(requests, ['/api/students/101/grades?years=1']);
  const select = host.querySelector('select[aria-label="السنة الدراسية للدرجات"]');
  assert.ok(select, 'a year selector appears when the student has past years');
  assert.deepEqual([...select.options].map(option => option.textContent), ['2027-2028 — الحالية', '2026-2027 — مؤرشفة']);
  await act(async () => { select.value = '1'; select.dispatchEvent(new window.Event('change', {bubbles: true})); });
  await act(async () => { await new Promise(r => setTimeout(r, 20)); });
  assert.equal(requests.at(-1), '/api/students/101/grades?years=1&academic_year_id=1');
  assert.match(host.textContent, /مؤرشفة: لا يمكن تعديل هذه الدرجات/);
  assert.match(host.textContent, /رياضيات/); assert.match(host.textContent, /٤١/);
});
