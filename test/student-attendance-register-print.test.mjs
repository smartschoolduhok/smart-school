import assert from 'node:assert/strict';
import test, {after} from 'node:test';
import {fileURLToPath} from 'node:url';
import {Window} from 'happy-dom';
import {createServer} from 'vite';

const window = new Window({url: 'http://localhost'});
for (const key of ['window','document','HTMLElement','HTMLInputElement','HTMLSelectElement','HTMLImageElement','Node','Event','MouseEvent','localStorage','sessionStorage']) {
  Object.defineProperty(globalThis, key, {configurable: true, value: key === 'window' ? window : window[key]});
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const {createElement, act} = await import('react');
const {createRoot} = await import('react-dom/client');
const vite = await createServer({root: fileURLToPath(new URL('..', import.meta.url)), configFile: false, appType: 'custom', optimizeDeps: {noDiscovery: true, include: []}, esbuild: {jsx: 'automatic'}, ssr: {noExternal: ['react-router-dom','react-router'], resolve: {conditions: ['module','browser','development']}}, server: {middlewareMode: true, hmr: false}});
const {StudentAttendanceDocument, StudentAttendancePreview} = await vite.ssrLoadModule('/src/modules/print/PrintStudentAttendancePage.tsx');
after(async () => {await vite.close(); await window.happyDOM.close();});

const fixture = (schoolId = 1, count = 55, yearId = 3) => ({
  school: {id: schoolId, name: `مدرسة ${schoolId}`}, academic_year: {id: yearId, name: `سنة ${yearId}`, is_active: 1},
  rows: [{student_id: 1, age_exception: {reference: 'مرجع خاص لا يطبع'}}],
  roster: Array.from({length: count}, (_, index) => ({student_id: index + 1, student_number: `ST-${index + 1}`, full_name: `طالب المدرسة ${schoolId} رقم ${index + 1}`, class_id: 4, class_name: 'الأول المتوسط', section_id: 8, section_name: 'أ', study_status: index % 2 ? 'regular' : 'hosted', grades_visible: index % 2 === 0, phone: '07701234567'})),
});
const years = schoolId => ({data: [{id: 3, school_id: schoolId, name: 'السنة الحالية', is_active: 1}, {id: 2, school_id: schoolId, name: 'السنة السابقة', is_active: 0}]});
const deferred = () => {let resolve; const promise = new Promise(done => {resolve = done;}); return {promise, resolve};};
async function mount(t, Component, props) {
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
  await act(async () => root.render(createElement(Component, props)));
  t.after(async () => {await act(async () => root.unmount()); container.remove();});
  return {container, async render(patch) {props = {...props, ...patch}; await act(async () => root.render(createElement(Component, props)));}};
}
async function select(ui, label, value) {
  const element = ui.container.querySelector(`select[aria-label="${label}"]`); assert.ok(element, label);
  await act(async () => {Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(element, value); element.dispatchEvent(new window.Event('change', {bubbles: true}));});
}

test('paper register retains every selected student with blank attendance, date and teacher fields on every page', async t => {
  const summary = fixture();
  summary.roster.push({...summary.roster[0], student_id: 100, full_name: 'طالب شعبة أخرى', section_id: 9, section_name: 'ب'});
  summary.roster.push({...summary.roster[0], student_id: 101, full_name: 'طالب صف آخر', class_id: 5});
  const ui = await mount(t, StudentAttendanceDocument, {summary, classId: 4, sectionId: 8, lessonCount: 7});
  assert.equal(ui.container.querySelectorAll('.staff-document-page').length, 3);
  assert.equal(ui.container.querySelectorAll('.student-attendance-row').length, 55);
  assert.equal(ui.container.querySelectorAll('.student-attendance-mark').length, 55 * 7);
  assert.deepEqual([...ui.container.querySelectorAll('.student-attendance-row')].map(row => Number(row.cells[0].textContent)), Array.from({length: 55}, (_, i) => i + 1));
  assert.doesNotMatch(ui.container.textContent, /طالب شعبة أخرى|طالب صف آخر|07701234567|مرجع خاص|ST-/);
  for (const page of ui.container.querySelectorAll('.staff-document-page')) {
    assert.equal(page.querySelector('[aria-label="اليوم"]').textContent, '');
    assert.equal(page.querySelector('[aria-label="التاريخ"]').textContent, '');
    assert.equal(page.querySelectorAll('.student-attendance-teacher').length, 7);
    assert.equal(page.querySelectorAll('.student-attendance-signature').length, 7);
    assert.equal(page.querySelector('table').lastElementChild.tagName, 'TFOOT');
  }
  for (const cell of ui.container.querySelectorAll('.student-attendance-mark, .student-attendance-teacher, .student-attendance-signature')) assert.equal(cell.textContent, '');
});

test('preview scopes roster to the selected school/year and changes lesson columns without loading attendance records', async t => {
  const requests = [];
  const summary = fixture(1, 3);
  summary.roster.push({...summary.roster[0], student_id: 10, section_id: null, section_name: null, full_name: 'طالب بلا شعبة'});
  const ui = await mount(t, StudentAttendancePreview, {schoolId: 1, loadYears: async id => years(id), loadRoster: async scope => {requests.push(scope); return {data: summary};}});
  assert.equal(ui.container.querySelector('.student-attendance-document'), null);
  await select(ui, 'الصف', '4'); await select(ui, 'الشعبة', '8');
  assert.equal(ui.container.querySelectorAll('.student-attendance-mark').length, 18);
  await select(ui, 'عدد الدروس', '8');
  assert.equal(ui.container.querySelectorAll('.student-attendance-mark').length, 24);
  assert.deepEqual(requests, [{school_id: 1, academic_year_id: 3}]);
  await select(ui, 'الشعبة', 'unassigned');
  assert.equal(ui.container.querySelectorAll('.student-attendance-row').length, 1);
  assert.match(ui.container.querySelector('.student-attendance-row').textContent, /طالب بلا شعبة/);
  await select(ui, 'السنة الدراسية', '');
  assert.equal(ui.container.querySelector('.student-attendance-document'), null);
  assert.equal(ui.container.querySelector('select[aria-label="السنة الدراسية"]').value, '');
  assert.deepEqual(requests, [{school_id: 1, academic_year_id: 3}]);
});

test('school changes and late responses never print another school roster', async t => {
  const old = deferred();
  const ui = await mount(t, StudentAttendancePreview, {schoolId: 1, initialClassId: 4, initialSectionId: 8, loadYears: async id => years(id), loadRoster: async scope => scope.school_id === 1 ? old.promise : {data: fixture(2, 1)}});
  await ui.render({schoolId: 2});
  assert.match(ui.container.textContent, /طالب المدرسة 2 رقم 1/);
  await act(async () => old.resolve({data: fixture(1, 5)}));
  assert.doesNotMatch(ui.container.textContent, /طالب المدرسة 1/);
  assert.equal(ui.container.querySelectorAll('.student-attendance-row').length, 1);
  await ui.render({schoolId: null});
  assert.equal(ui.container.querySelector('.student-attendance-document'), null);
  assert.doesNotMatch(ui.container.textContent, /طباعة \/ حفظ PDF/);
});

test('year change clears class/section choices and rejects late previous year roster', async t => {
  const old = deferred();
  const ui = await mount(t, StudentAttendancePreview, {schoolId: 1, initialClassId: 4, initialSectionId: 8, loadYears: async id => years(id), loadRoster: async scope => scope.academic_year_id === 3 ? old.promise : {data: fixture(1, 2, 2)}});
  await select(ui, 'السنة الدراسية', '2');
  assert.equal(ui.container.querySelector('.student-attendance-document'), null);
  await select(ui, 'الصف', '4'); await select(ui, 'الشعبة', '8');
  await act(async () => old.resolve({data: fixture(1, 55, 3)}));
  assert.equal(ui.container.querySelectorAll('.student-attendance-row').length, 2);
  assert.match(ui.container.querySelector('.student-attendance-document').textContent, /سنة 2/);
  assert.doesNotMatch(ui.container.querySelector('.student-attendance-document').textContent, /سنة 3/);
});

test('mismatched school/year data and empty rosters offer no print document', async t => {
  const ui = await mount(t, StudentAttendancePreview, {schoolId: 1, initialClassId: 4, initialSectionId: 8, loadYears: async id => years(id), loadRoster: async () => ({data: fixture(2, 1)})});
  assert.match(ui.container.textContent, /تعذر مطابقة/);
  assert.equal(ui.container.querySelector('.student-attendance-document'), null);
  await ui.render({loadRoster: async () => ({data: fixture(1, 1, 2)})});
  assert.match(ui.container.textContent, /تعذر مطابقة/);
  assert.equal(ui.container.querySelector('.student-attendance-document'), null);
  await ui.render({loadRoster: async () => ({data: fixture(1, 0)})});
  assert.match(ui.container.textContent, /لا توجد تسجيلات طلاب نشطة/);
  assert.doesNotMatch(ui.container.textContent, /طباعة \/ حفظ PDF/);
});
