import assert from 'node:assert/strict';
import test, {after} from 'node:test';
import {fileURLToPath} from 'node:url';
import {Window} from 'happy-dom';
import {createServer} from 'vite';
import {solvePreparedTimetable} from '../src/lib/timetableSolverPrepared.ts';
import {computeTimetableProposalDigest} from '../src/lib/timetableAdoption.ts';
import {solveTimetableInWorker} from '../src/lib/timetableSolverClient.ts';

const window = new Window({url: 'http://localhost'});
for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'Node', 'Event', 'MouseEvent', 'localStorage', 'sessionStorage']) globalThis[key] = key === 'window' ? window : window[key];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const {createElement, act} = await import('react');
const {createRoot} = await import('react-dom/client');
const {renderToStaticMarkup} = await import('react-dom/server');
const vite = await createServer({root: fileURLToPath(new URL('..', import.meta.url)), configFile: false, appType: 'custom', optimizeDeps: {noDiscovery: true, include: []}, esbuild: {jsx: 'automatic'}, server: {middlewareMode: true, hmr: false}});
const {default: TimetablePage, TimetableReadinessStatus} = await vite.ssrLoadModule('/src/modules/timetable/TimetablePage.tsx');
const {AuthProvider} = await vite.ssrLoadModule('/src/hooks/useAuth.tsx');
const {ParallelLoadField} = await vite.ssrLoadModule('/src/modules/timetable/ParallelLoadField.tsx');
const {AutomaticTimetableTab} = await vite.ssrLoadModule('/src/modules/timetable/AutomaticTimetableTab.tsx');
const {TimetableLoadDiagnostics} = await vite.ssrLoadModule('/src/modules/timetable/TimetableLoadDiagnostics.tsx');
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
function prepared(loads = [load(101)], patch = {}) {
  return {input: {schoolId: 1, academicYearId: 1, days, slots, loads,
    placements: [{class_id: 1, class_name: 'الأول', section_id: 11, section_name: 'أ'}], teacherAvailability: [], teacherConstraints: [], currentEntries: [], fixedEntries: []},
    timetable_revision: 1, generation_scope: {kind: 'school'}, ...patch};
}
function installWorker(t, pending = false) {
  const previous = globalThis.Worker, workers = [];
  globalThis.Worker = class {
    onmessage = null; onerror = null; onmessageerror = null; terminated = false;
    constructor(url, options) {this.url = url;this.options = options;workers.push(this);}
    postMessage(value) {
      this.input = value;
      if (!pending) void solvePreparedTimetable(value).then(data => {if (!this.terminated) this.onmessage?.({data: {ok: true, data}});});
    }
    terminate() {this.terminated = true;}
  };
  t.after(() => {globalThis.Worker = previous;});
  return workers;
}
const button = (container, label) => {const element = [...container.querySelectorAll('button')].find(item => item.textContent === label);assert.ok(element, label);return element;};
const select = async (container, label, value) => {
  const element = container.querySelector(`[aria-label="${label}"]`);assert.ok(element, label);
  await act(async () => {element.value = value; element.dispatchEvent(new Event('change', {bubbles: true}));});
};
async function waitFor(check) {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (check()) return;
    await act(async () => new Promise(resolve => setTimeout(resolve, 5)));
  }
  assert.fail('Timed out waiting for the worker result');
}
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
  const workers = installWorker(t);
  const calls = [], previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);calls.push({url: String(url), body});
    return String(url).endsWith('/solver/prepare') ? response({data: prepared(loads)}) : response({error: 'معاينة الاختبار فقط'}, 400);
  };
  t.after(() => {globalThis.fetch = previousFetch;});
  const container = await mount(t, createElement(AutomaticTimetableTab, {schoolId: 1, academicYearId: 1, dataVersion: 1, readiness: null, classes, sections, onAdopted: async () => {}}));
  await act(async () => button(container, 'إنشاء جدول تلقائي').click());
  await waitFor(() => container.querySelector('[data-proposal-entry]'));
  const cards = [...container.querySelectorAll('[data-proposal-entry]')];assert.equal(cards.length, 4);
  assert.equal(workers.length, 1);assert.equal(workers[0].terminated, true);assert.equal(workers[0].options.type, 'module');
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

test('generation explains teaching preferences and separates weighted penalties from remaining lesson counts', async t => {
  const workers = installWorker(t, true), previousFetch = globalThis.fetch;
  globalThis.fetch = async () => response({data: prepared()});t.after(() => {globalThis.fetch = previousFetch;});
  const container = await mount(t, createElement(AutomaticTimetableTab, {schoolId: 1, academicYearId: 1, dataVersion: 1, readiness: null, classes, sections, onAdopted: async () => {}}));
  for (const text of ['الأخلاقية والفنية والرياضة والكردية والفرنسية والحاسوب', 'عن أول درسين', 'مثل أ ثم ب', 'أوقات توفر المدرسين ومنع التعارض والدروس المثبتة', 'قد تبقى استثناءات']) assert.ok(container.textContent.includes(text), text);
  await act(async () => button(container, 'إنشاء جدول تلقائي').click());
  const proposal = await solvePreparedTimetable(prepared());
  proposal.scoring = {...proposal.scoring, penalties: {...proposal.scoring.penalties, early_light_subjects: 40, consecutive_heavy_subjects: 24, missed_section_continuity: 6},
    pedagogy: {early_light_lessons: 1, heavy_run_excess: 2, consecutive_section_pairs: 3, possible_section_pairs: 4}};
  await act(async () => workers[0].onmessage({data: {ok: true, data: proposal}}));
  for (const [key, label, value] of [['early_light_subjects', 'المواد الخفيفة في بداية اليوم', '40'], ['consecutive_heavy_subjects', 'تتابع زائد للدروس الثقيلة', '24'], ['missed_section_continuity', 'فرص تتابع الشعب غير المتحققة', '6']]) {
    const metric = container.querySelector(`[data-timetable-penalty="${key}"]`);assert.ok(metric);
    assert.ok(metric.textContent.includes(label));assert.equal(metric.querySelector('bdi').textContent, value);
  }
  assert.match(container.textContent, /نقاط للتفضيلات غير المتحققة بحسب أهميتها/);
  const counts = container.querySelector('[aria-label="نتيجة تفضيلات ترتيب الدروس"]');
  assert.match(counts.textContent, /دروس خفيفة باقية في أول درسين: 1/);
  assert.match(counts.textContent, /دروس ثقيلة متتابعة فوق الحد المفضّل: 2/);
  assert.match(counts.textContent, /3 من 4 فرصة/);
});

test('readiness distinguishes matching capacity from unstarted, partial and completed distribution', () => {
  const base = {class_id: 1, section_id: 11, available_capacity: 33, required_periods: 33, scheduled_periods: 0, remaining_periods: 33,
    difference: 0, status: 'exact', ready: true, invalid_load_ids: [], missing_teacher_load_ids: [], missing_subjects: []};
  const render = patch => renderToStaticMarkup(createElement('table', null, createElement('tbody', null, createElement('tr', null,
    createElement(TimetableReadinessStatus, {placement: {...base, ...patch}})))));
  let html = render({});
  assert.match(html, /النصاب مطابق للسعة/);assert.match(html, /لم يبدأ التوزيع/);assert.doesNotMatch(html, /مكتمل التوزيع|text-emerald/);
  html = render({scheduled_periods: 20, remaining_periods: 13});
  assert.match(html, /توزيع جزئي/);assert.doesNotMatch(html, /مكتمل التوزيع/);
  html = render({scheduled_periods: 33, remaining_periods: 0});
  assert.match(html, /مكتمل التوزيع/);assert.match(html, /text-emerald/);
  for (const patch of [{ready: false}, {invalid_load_ids: [19]}, {missing_teacher_load_ids: [19]}, {missing_subjects: [{id: 19, name: 'مادة ناقصة'}]}]) {
    html = render({scheduled_periods: 33, remaining_periods: 0, ...patch});
    assert.match(html, /تحتاج البيانات إلى مراجعة/);assert.doesNotMatch(html, /مكتمل التوزيع/);
  }
  html = render({status: 'unallocated', required_periods: 31, scheduled_periods: 31, remaining_periods: 0, difference: 2});
  assert.match(html, /النصاب أقل من السعة/);assert.match(html, /مكتمل التوزيع/);
});

test('unexplained HTTP 503 offers a smaller scope and manual retry while preserving specific server errors', async t => {
  installWorker(t);
  const calls = [], previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({url: String(url), body: JSON.parse(init.body)});
    if (calls.length === 1) return new Response('Service unavailable', {status: 503, headers: {'Content-Type': 'text/plain'}});
    if (calls.length === 2) return response({error: 'تعذر إكمال الحساب ضمن المهلة المحددة', code: 'specific_solver_error'}, 503);
    return response({data: prepared()});
  };
  t.after(() => {globalThis.fetch = previousFetch;});
  const container = await mount(t, createElement(AutomaticTimetableTab, {schoolId: 1, academicYearId: 1, dataVersion: 1, readiness: null, classes, sections, onAdopted: async () => {}}));
  await select(container, 'نطاق التوليد', 'class:1');
  await act(async () => button(container, 'إنشاء جدول تلقائي').click());
  assert.match(container.querySelector('[role="alert"]').textContent, /تعذر إكمال توليد الجدول الآن/);
  assert.match(container.querySelector('[role="alert"]').textContent, /اختر صفًا أو شعبة لتوليد نطاق أصغر/);
  assert.equal(button(container, 'إنشاء جدول تلقائي').disabled, false);assert.equal(calls.length, 1);
  await act(async () => button(container, 'إنشاء جدول تلقائي').click());
  assert.equal(container.querySelector('[role="alert"]').textContent, 'تعذر إكمال الحساب ضمن المهلة المحددة');
  await act(async () => button(container, 'إنشاء جدول تلقائي').click());
  await waitFor(() => container.querySelector('[data-proposal-entry]'));
  assert.equal(container.querySelector('[role="alert"]'), null);assert.ok(container.querySelector('[data-proposal-entry]'));
  assert.equal(calls.length, 3);
  assert.ok(calls.every(call => call.url === '/api/timetable/solver/prepare'));
  assert.ok(calls.every(call => call.body.generation_scope.kind === 'class' && call.body.generation_scope.class_id === 1));
});

test('worker proposal preserves server scope token, official locks, outside scope entries and canonical digest', async () => {
  const first = load(101, {weekly_periods: 1});
  const other = load(103, {class_id: 2, class_name: 'الثاني', section_id: null, section_name: null, section_status: null, active_section_count: 0,
    section_class_id: 2, subject_id: 203, subject_name: 'العلوم', subject_class_id: 2, employee_id: 303, employee_name: 'سارة', weekly_periods: 1});
  const source = prepared([first, other], {generation_scope: {kind: 'class', class_id: 1}, scope_load_ids: [101], scope_token: 'a'.repeat(64)});
  source.input.placements.push({class_id: 2, class_name: 'الثاني', section_id: null, section_name: null});
  source.input.currentEntries = [{id: 1, slot_id: 1, teaching_load_id: 101, is_locked: 1}, {id: 2, slot_id: 2, teaching_load_id: 103, is_locked: 0}]
    .map(entry => ({...entry, school_id: 1, academic_year_id: 1}));
  source.input.fixedEntries = source.input.currentEntries.map(({slot_id, teaching_load_id, is_locked}) => ({slot_id, teaching_load_id, is_locked}));
  const result = await solvePreparedTimetable(source);
  assert.equal(result.status, 'complete', JSON.stringify(result.fixed_conflicts));assert.equal(result.entries.length, 2);
  assert.ok(result.entries.every(entry => entry.is_preserved));
  assert.equal(result.entries.find(entry => entry.teaching_load_id === 103).is_locked, 0);
  assert.deepEqual(result.scope_load_ids, [101]);assert.equal(result.scope_token, source.scope_token);
  assert.equal(result.proposal_digest, await computeTimetableProposalDigest({schoolId: 1, academicYearId: 1, revision: 1, entries: result.entries,
    generationScope: source.generation_scope, scopeLoadIds: source.scope_load_ids}));
});

test('worker client terminates on success, errors, timeout and cancellation without a synchronous fallback', async () => {
  const source = prepared(), data = await solvePreparedTimetable(source);
  const stub = () => ({onmessage: null, onerror: null, onmessageerror: null, terminateCount: 0, postMessage() {}, terminate() {this.terminateCount++;}});
  for (const mode of ['success', 'reported-error', 'error', 'messageerror', 'post-error', 'abort', 'timeout']) {
    const worker = stub(), controller = new AbortController();
    if (mode === 'post-error') worker.postMessage = () => {throw new Error('structured clone failed');};
    const promise = solveTimetableInWorker(source, {createWorker: () => worker, signal: controller.signal, timeoutMs: 5});
    if (mode === 'success') worker.onmessage({data: {ok: true, data}});
    if (mode === 'reported-error') worker.onmessage({data: {ok: false, error: 'تعذر التوليد التجريبي'}});
    if (mode === 'error') worker.onerror({});
    if (mode === 'messageerror') worker.onmessageerror({});
    if (mode === 'abort') controller.abort();
    if (mode === 'success') assert.equal(await promise, data);
    else await assert.rejects(promise);
    assert.equal(worker.terminateCount, 1, mode);assert.equal(worker.onmessage, null);
  }
  await assert.rejects(solveTimetableInWorker(source, {createWorker() {throw new Error('unavailable');}}), /تعذر بدء التوليد/);
  const aborted = new AbortController();aborted.abort();let starts = 0;
  await assert.rejects(solveTimetableInWorker(source, {signal: aborted.signal, createWorker() {starts++;return stub();}}), {name: 'AbortError'});
  assert.equal(starts, 0);
});

test('dedicated worker entry point emits a proposal and a useful failure response', async t => {
  const previousSelf = globalThis.self, messages = [];
  const worker = {onmessage: null, postMessage(message) {messages.push(message);}};
  globalThis.self = worker;t.after(() => {globalThis.self = previousSelf;});
  await vite.ssrLoadModule('/src/lib/timetableSolverWorker.ts');
  await worker.onmessage({data: prepared()});
  assert.equal(messages[0].ok, true);assert.equal(messages[0].data.entries.length, 2);assert.match(messages[0].data.proposal_digest, /^[a-f0-9]{64}$/);
  await worker.onmessage({data: {input: null}});
  assert.equal(messages[1].ok, false);assert.match(messages[1].error, /تعذر بناء اقتراح الجدول/);
});

test('readiness diagnostics distinguish dormant archived loads from actionable invalid references without mutation controls', () => {
  const invalid = {teaching_load_id: 15, subject_name: 'الكيمياء', class_name: 'الأول', section_name: 'أ', employee_name: 'مدرس مؤرشف', scheduled_entry_count: 0,
    reasons: [{code: 'teacher_archived', message: 'المدرس مؤرشف', action: 'اختر مدرسًا فعالًا لهذا النصاب.'}]};
  const archived = {teaching_load_id: 16, subject_name: 'الرياضيات', class_name: 'الثاني', section_name: 'ب', employee_name: 'أحمد', scheduled_entry_count: 0,
    reasons: [{code: 'section_archived', message: 'الشعبة مؤرشفة', action: 'راجع الشعبة'}]};
  const readiness = {invalid_reference_count: 1, invalid_load_details: [invalid], archived_load_count: 1, archived_load_details: [archived]};
  const html = renderToStaticMarkup(createElement(TimetableLoadDiagnostics, {readiness}));
  const container = document.createElement('div');container.innerHTML = html;
  const details = container.querySelectorAll('details');assert.equal(details.length, 2);
  assert.equal(details[0].open, true);assert.equal(details[1].open, false);
  for (const text of ['الكيمياء', 'اختر مدرسًا فعالًا لهذا النصاب.', 'الرياضيات', 'الثاني / ب', 'لا تدخل هذه الأنصبة في التوليد', 'تُراجع']) {
    if (text === 'تُراجع') assert.match(container.textContent, /يُراجع هذا النصاب مجددًا عند إعادة تفعيل/);
    else assert.ok(container.textContent.includes(text), text);
  }
  assert.equal(container.querySelector('button, input, select'), null);
  const automatic = renderToStaticMarkup(createElement(AutomaticTimetableTab, {schoolId: 1, academicYearId: 1, dataVersion: 1, readiness, classes, sections, onAdopted: async () => {}}));
  assert.ok(automatic.includes(html));
});

test('cancel, changed school and unmount terminate pending solving and ignore late worker output', async t => {
  const workers = installWorker(t, true), previousFetch = globalThis.fetch;
  globalThis.fetch = async () => response({data: prepared()});t.after(() => {globalThis.fetch = previousFetch;});
  const container = document.createElement('div');document.body.append(container);const root = createRoot(container);
  let mounted = true;
  t.after(async () => {if (mounted) await act(async () => root.unmount());container.remove();});
  const props = {schoolId: 1, academicYearId: 1, dataVersion: 1, readiness: null, classes, sections, onAdopted: async () => {}};
  const render = async () => {await act(async () => root.render(createElement(AutomaticTimetableTab, props)));};
  await render();await act(async () => button(container, 'إنشاء جدول تلقائي').click());
  const late = workers[0].onmessage;
  await act(async () => button(container, 'إلغاء التوليد').click());assert.equal(workers[0].terminated, true);
  const data = await solvePreparedTimetable(prepared());
  await act(async () => late({data: {ok: true, data}}));assert.equal(container.querySelector('[data-proposal-entry]'), null);
  await act(async () => button(container, 'إنشاء جدول تلقائي').click());
  props.schoolId = 2;await render();assert.equal(workers[1].terminated, true);
  props.schoolId = 1;await render();await act(async () => button(container, 'إنشاء جدول تلقائي').click());
  await act(async () => root.unmount());mounted = false;assert.equal(workers[2].terminated, true);
});
