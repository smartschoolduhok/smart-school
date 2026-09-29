import assert from 'node:assert/strict';
import test, {after} from 'node:test';
import {fileURLToPath} from 'node:url';
import {Window} from 'happy-dom';
import {createServer} from 'vite';
import {solveTimetable} from '../src/lib/timetableSolver.ts';

const window = new Window({url: 'http://localhost'});
for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'Node', 'Event', 'MouseEvent', 'localStorage', 'sessionStorage']) globalThis[key] = key === 'window' ? window : window[key];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const {createElement, act} = await import('react');
const {createRoot} = await import('react-dom/client');
const vite = await createServer({root: fileURLToPath(new URL('..', import.meta.url)), configFile: false, appType: 'custom', optimizeDeps: {noDiscovery: true, include: []}, esbuild: {jsx: 'automatic'}, server: {middlewareMode: true, hmr: false}});
const {default: TimetablePage} = await vite.ssrLoadModule('/src/modules/timetable/TimetablePage.tsx');
const {AuthProvider} = await vite.ssrLoadModule('/src/hooks/useAuth.tsx');
const {ParallelLoadField} = await vite.ssrLoadModule('/src/modules/timetable/ParallelLoadField.tsx');
const {AutomaticTimetableTab} = await vite.ssrLoadModule('/src/modules/timetable/AutomaticTimetableTab.tsx');
after(async () => {await vite.close(); await window.happyDOM.close();});

const response = (data, status = 200) => new Response(JSON.stringify(data), {status, headers: {'Content-Type': 'application/json'}});
const classes = [{id: 1, school_id: 1, name: 'الأول', stage: 'ابتدائي', status: 'active'}];
const sections = [{id: 11, school_id: 1, class_id: 1, name: 'أ', status: 'active'}];
const subjects = [{id: 201, name: 'التربية الإسلامية'}, {id: 202, name: 'التربية المسيحية'}].map(item => ({...item, school_id: 1, class_id: 1, section_id: null, status: 'active', order_index: item.id}));
const teachers = [{id: 301, full_name: 'أحمد'}, {id: 302, full_name: 'مريم'}].map(item => ({...item, school_id: 1, role: 'teacher', status: 'active'}));
const days = [{id: 1, school_id: 1, academic_year_id: 1, day_of_week: 0, is_active: 1, order_index: 0}];
const slots = [1, 2].map(id => ({id, school_id: 1, academic_year_id: 1, day_of_week: 0, slot_index: id, lesson_number: id, slot_type: 'lesson', is_active: 1, label: `الدرس ${id}`, start_time: id === 1 ? '08:00' : '08:40', end_time: id === 1 ? '08:40' : '09:20'}));
function load(id, overrides = {}) {
  const index = id === 101 ? 0 : 1;
  return {id, school_id: 1, academic_year_id: 1, class_id: 1, class_name: 'الأول', class_status: 'active', class_school_id: 1,
    section_id: 11, section_name: 'أ', section_status: 'active', section_school_id: 1, section_class_id: 1, active_section_count: 1,
    subject_id: subjects[index].id, subject_name: subjects[index].name, subject_status: 'active', subject_school_id: 1, subject_class_id: 1, subject_section_id: null,
    employee_id: teachers[index].id, employee_name: teachers[index].full_name, employee_status: 'active', employee_role: 'teacher', employee_school_id: 1,
    weekly_periods: 2, status: 'active', created_at: 1, updated_at: 1, ...overrides};
}
const button = (container, label) => {const element = [...container.querySelectorAll('button')].find(item => item.textContent === label);assert.ok(element, label);return element;};
const select = async (container, label, value) => {
  const element = container.querySelector(`[aria-label="${label}"]`);assert.ok(element, label);
  await act(async () => {element.value = value; element.dispatchEvent(new Event('change', {bubbles: true}));});
};
async function mount(t, element) {
  const container = document.createElement('div');document.body.append(container);const root = createRoot(container);
  await act(async () => root.render(element));
  t.after(async () => {await act(async () => root.unmount());container.remove();});
  return container;
}

test('new subject without a load can link to an existing subject through the matrix advanced form', async t => {
  const loads = [load(101)], calls = [], previousFetch = globalThis.fetch, previousConfirm = window.confirm;
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(String(url), 'http://localhost').pathname, method = init.method || 'GET', body = init.body ? JSON.parse(init.body) : null;
    calls.push({path, method, body});
    if (path === '/api/auth/me') return response({data: {id: 1, school_id: 1, role_key: 'school_owner'}, csrf_token: 'a'.repeat(64)});
    const reads = {
      '/api/academic-years': [{id: 1, school_id: 1, name: '2026–2027', is_active: 1}], '/api/classes': classes, '/api/sections': sections,
      '/api/subjects': subjects, '/api/employees': teachers, '/api/timetable/days': days, '/api/timetable/slots': slots,
      '/api/timetable/readiness': {teacher_workloads: []},
    };
    if (path === '/api/timetable/teaching-loads') {
      if (method === 'POST') loads.push(load(102, body));
      return response({data: method === 'POST' ? loads.at(-1) : loads});
    }
    if (path === '/api/timetable/teaching-loads/101' && method === 'DELETE') {
      if (!body.confirm_deactivate_scheduled) return response({error: 'تأكيد استبعاد الدروس', code: 'parallel_load_deactivation_confirmation_required', data: {scheduled_count: 2, locked_count: 1, revision: 8}}, 409);
      loads[0].status = 'inactive';loads[1].parallel_with_load_id = null;
      return response({data: {id: 101, status: 'inactive'}});
    }
    if (path === '/api/timetable/teaching-load-matrix') return response({data: {school_id: 1, academic_year_id: 1, class: classes[0], sections, subjects, teachers, loads,
      timetable_revision: 1, weekly_capacity: 2, summary: {expected: 2, configured: 1, missing: 1, excluded: 0, without_teacher: 0, invalid_teacher: 0, weekly_periods: 2, completion_percent: 50}}});
    if (path === '/api/timetable/week-setup') return response({error: 'لا نحتاج إعداد الأسبوع في هذا الاختبار'}, 400);
    if (Object.hasOwn(reads, path)) return response({data: reads[path]});
    throw new Error(`Unexpected ${method} ${path}`);
  };
  t.after(() => {globalThis.fetch = previousFetch;window.confirm = previousConfirm;});
  const container = await mount(t, createElement(AuthProvider, null, createElement(TimetablePage)));
  await act(async () => button(container, 'إعداد وتوليد').click());
  const workflow = [...container.querySelectorAll('select')].find(item => [...item.options].some(option => option.value === 'loads'));
  await act(async () => {workflow.value = 'loads';workflow.dispatchEvent(new Event('change', {bubbles: true}));});
  await act(async () => button(container, 'فتح مصفوفة النصاب — الأول').click());
  const missingCell = container.querySelector('[aria-label="دروس التربية المسيحية / أ"]').closest('td');
  await act(async () => button(missingCell, 'إضافة نصاب / تزامن').click());
  assert.equal(container.querySelector('[aria-label="مادة النصاب"]').value, '202');
  assert.equal(container.querySelector('[aria-label="شعبة النصاب"]').value, '11');
  await select(container, 'مدرس النصاب', '302');
  await select(container, 'متزامن مع', '101');
  const periods = container.querySelector('[aria-label="عدد دروس النصاب"]');
  assert.equal(periods.value, '2');assert.equal(periods.readOnly, true);
  assert.match(container.textContent, /تبقى مواد الطلاب والدرجات والبطاقات كما هي/);
  await act(async () => periods.closest('form').dispatchEvent(new Event('submit', {bubbles: true, cancelable: true})));
  const writes = calls.filter(item => item.method !== 'GET');
  assert.deepEqual(writes, [{path: '/api/timetable/teaching-loads', method: 'POST', body: {
    school_id: 1, academic_year_id: 1, class_id: 1, section_id: 11, subject_id: 202, employee_id: 302, weekly_periods: 2, parallel_with_load_id: 101,
  }}]);
  assert.match(container.textContent, /تم حفظ نصاب المادة/);
  const confirmations = [];window.confirm = text => {confirmations.push(text);return confirmations.length === 1;};
  await act(async () => container.querySelector('[aria-label="استبعاد نصاب التربية الإسلامية وحده"]').click());
  assert.equal(calls.filter(item => item.method === 'DELETE').length, 1);
  assert.match(confirmations[1], /2 درس محفوظ، منها 1 مثبت/);assert.match(confirmations[1], /تبقى المادة المتزامنة الأخرى ودروسها كما هي/);
  assert.ok(container.querySelector('[aria-label="استبعاد نصاب التربية الإسلامية وحده"]'));
  window.confirm = () => true;
  await act(async () => container.querySelector('[aria-label="استبعاد نصاب التربية الإسلامية وحده"]').click());
  const deletions = calls.filter(item => item.method === 'DELETE');
  assert.equal(deletions.length, 3);assert.deepEqual(deletions.at(-1).body, {school_id: 1, academic_year_id: 1, confirm_deactivate_scheduled: true, expected_revision: 8});
  assert.equal(container.querySelector('[aria-label="استبعاد نصاب التربية الإسلامية وحده"]'), null);
  assert.ok(container.querySelector('[aria-label="استبعاد نصاب التربية المسيحية وحده"]'));
  assert.match(container.textContent, /تم استبعاد النصاب المحدد وحده من الجدول/);
});

test('parallel selector only offers independent same-scope loads with a different assigned teacher', async t => {
  const loads = [load(101), load(103, {section_id: 12}), load(104, {school_id: 2}), load(105, {academic_year_id: 2}), load(106, {status: 'inactive'}),
    load(107, {subject_id: 203, employee_id: 302}), load(108, {subject_id: 204, employee_id: 304}), load(109, {subject_id: 205, employee_id: 305, parallel_with_load_id: 108})];
  const container = await mount(t, createElement(ParallelLoadField, {loads, schoolId: 1, academicYearId: 1, classId: 1, sectionId: 11, currentLoadId: null, subjectId: 202, employeeId: 302, value: '', onChange() {}}));
  assert.deepEqual([...container.querySelectorAll('option')].map(item => item.value), ['', '101']);
});

test('automatic proposal renders both parallel cards and lock action includes both in adoption preview', async t => {
  const loads = [load(101), load(102, {parallel_with_load_id: 101})];
  const result = solveTimetable({schoolId: 1, academicYearId: 1, days, slots, loads,
    placements: [{class_id: 1, class_name: 'الأول', section_id: 11, section_name: 'أ'}], teacherAvailability: [], teacherConstraints: [], currentEntries: [], fixedEntries: []});
  assert.equal(result.status, 'complete');
  const calls = [], previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);calls.push({url: String(url), body});
    return String(url).endsWith('/solver/preview') ? response({data: {...result, timetable_revision: 1, proposal_digest: 'initial'}}) : response({error: 'معاينة الاختبار فقط'}, 400);
  };
  t.after(() => {globalThis.fetch = previousFetch;});
  const container = await mount(t, createElement(AutomaticTimetableTab, {schoolId: 1, academicYearId: 1, dataVersion: 1, readiness: null, classes, sections, onAdopted: async () => {}}));
  await act(async () => button(container, 'إنشاء جدول تلقائي').click());
  const cards = [...container.querySelectorAll('[data-proposal-entry]')];assert.equal(cards.length, 4);
  const cell = cards[0].closest('td');assert.equal(cell.querySelectorAll('[data-proposal-entry]').length, 2);
  for (const text of ['التربية الإسلامية', 'التربية المسيحية', 'أحمد', 'مريم']) assert.ok(cell.textContent.includes(text), text);
  await act(async () => cards[0].querySelector('button').click());
  assert.equal(cell.querySelectorAll('button[aria-label="إلغاء تثبيت الدرس"]').length, 2);
  await act(async () => button(container, 'مقارنة مع الجدول الحالي / معاينة الاعتماد').click());
  const preview = calls.at(-1).body;
  const locked = preview.entries.filter(entry => entry.is_locked === 1);
  assert.equal(locked.length, 2);assert.equal(locked[0].slot_id, locked[1].slot_id);
  assert.notEqual(preview.proposal_digest, 'initial');
});
