import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { Window } from 'happy-dom';
import { createServer } from 'vite';

const browser = new Window({ url: 'http://localhost' });
for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'Node', 'Event', 'MouseEvent', 'InputEvent', 'localStorage', 'sessionStorage']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? browser : browser[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const vite = await createServer({ root: process.cwd(), appType: 'custom', ssr: { noExternal: ['react-router-dom', 'react-router'], resolve: { conditions: ['module', 'browser', 'development'] } }, server: { middlewareMode: true, hmr: false } });
const { default: GradesPage } = await vite.ssrLoadModule('/src/modules/grades/GradesPage.tsx');
const { AuthProvider } = await vite.ssrLoadModule('/src/hooks/useAuth.tsx');
const { MemoryRouter } = await vite.ssrLoadModule('react-router-dom');
after(async () => { await vite.close(); await browser.happyDOM.close(); });

const user = { id: 73, role_key: 'teacher', role_id: 5, school_id: 41, full_name: 'Teacher', email: 'teacher@example.test', role_name: 'Teacher', school_name: 'School' };
const settings = { school_id: 41, max_grade: 100, passing_grade: 50, first_term_input_mode: 'monthly', second_term_input_mode: 'monthly', mid_year_exam_enabled: 1, final_exam_enabled: 1, completion_exam_enabled: 1 };
const grades = [{ id: 101, school_id: 41, student_id: 50, student_name: 'Student', subject_id: 1001, subject_name: 'Subject', first_month: 51, second_month: 82, annual_effort: 70, result_status: 'pending', revision: 1 }];

function change(element, value) {
  const prototype = element.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
  element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
}

test('section grade switch preserves pending edits on cancel and renders the new field after discard', async t => {
  const previousFetch = globalThis.fetch;
  const previousConfirm = browser.confirm;
  let confirmations = 0;
  let allowDiscard = false;
  browser.confirm = () => { confirmations++; return allowDiscard; };
  globalThis.fetch = async url => {
    const path = String(url);
    const json = data => new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (path === '/api/auth/me') return json(user);
    if (path.startsWith('/api/students?')) return json([]);
    if (path.startsWith('/api/student-subjects?')) return json([{ id: 1, class_id: 10, class_name: 'Class', section_id: 101, section_name: 'A', subject_id: 1001, subject_name: 'Subject', is_active: 1 }]);
    if (path.startsWith('/api/grade-settings?')) return json(settings);
    if (path.startsWith('/api/grades?')) return json(grades);
    throw Error('Unexpected request ' + path);
  };
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  t.after(async () => {
    await act(async () => root.unmount());
    host.remove();
    globalThis.fetch = previousFetch;
    browser.confirm = previousConfirm;
  });
  const button = label => [...host.querySelectorAll('button')].find(item => item.textContent.includes(label));
  const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); });

  await act(async () => root.render(createElement(MemoryRouter, null, createElement(AuthProvider, null, createElement(GradesPage)))));
  await settle();
  await act(async () => button('إدخال درجات شعبة').click());
  await settle();
  await act(async () => change(host.querySelectorAll('select')[0], '10'));
  await act(async () => change(host.querySelectorAll('select')[1], '101'));
  await act(async () => change(host.querySelectorAll('select')[2], '1001'));
  await act(async () => button('عرض الدرجات').click());
  await settle();
  const input = host.querySelector('tbody input');
  assert.equal(input.value, '٥١');
  assert.equal(host.querySelector('tbody a')?.getAttribute('href'), '/students/50');
  await act(async () => change(input, '61'));
  assert.equal(button('حفظ الجميع').disabled, false);

  await act(async () => change(host.querySelectorAll('select')[3], 'second_month'));
  assert.equal(confirmations, 1);
  assert.equal(host.querySelectorAll('select')[3].value, 'first_month');
  assert.equal(host.querySelector('tbody input').value, '61');
  assert.equal(button('حفظ الجميع').disabled, false);

  allowDiscard = true;
  await act(async () => change(host.querySelectorAll('select')[3], 'second_month'));
  assert.equal(confirmations, 2);
  assert.equal(host.querySelectorAll('select')[3].value, 'second_month');
  assert.equal(host.querySelector('tbody input').value, '٨٢');
  assert.equal(button('حفظ الجميع').disabled, true);
});

test('student dossier displays active subject grades using the configured scheme', async t => {
  const previousFetch = globalThis.fetch;
  const { default: StudentGradesSection } = await vite.ssrLoadModule('/src/modules/students/StudentGradesSection.tsx');
  const requests = [];
  globalThis.fetch = async url => {
    requests.push(String(url));
    return new Response(JSON.stringify({ data: { settings, grades } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  t.after(async () => {
    await act(async () => root.unmount());
    host.remove();
    globalThis.fetch = previousFetch;
  });
  await act(async () => root.render(createElement(StudentGradesSection, { studentId: 50 })));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  assert.deepEqual(requests, ['/api/students/50/grades']);
  assert.match(host.textContent, /Subject/);
  assert.match(host.textContent, /الشهر الأول/);
  assert.match(host.textContent, /٥١/);
  assert.match(host.textContent, /السعي السنوي/);
});

test('student dossier reloads visibility after an annual setting save without exposing cached scores', async t => {
  const previousFetch = globalThis.fetch;
  const { default: StudentGradesSection } = await vite.ssrLoadModule('/src/modules/students/StudentGradesSection.tsx');
  let visible = true;
  globalThis.fetch = async () => new Response(JSON.stringify({ data: { grades_visible: visible, settings, grades: visible ? grades : [] } }), { headers: { 'content-type': 'application/json' } });
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  t.after(async () => { await act(async () => root.unmount()); host.remove(); globalThis.fetch = previousFetch; });
  await act(async () => root.render(createElement(StudentGradesSection, { studentId: 50, refreshKey: 0 })));
  assert.ok(host.querySelector('table'));
  visible = false;
  await act(async () => root.render(createElement(StudentGradesSection, { studentId: 50, refreshKey: 1 })));
  assert.equal(host.querySelector('table'), null);
  assert.match(host.textContent, /درجات الطالب مخفية/);
  assert.doesNotMatch(host.textContent, /لا توجد درجات نشطة/);
});

test('hidden student stays selectable but cannot initialize grades and a late visible response cannot replace it', async t => {
  const previousFetch = globalThis.fetch;
  const json = data => new Response(JSON.stringify({ data }), { headers: { 'content-type': 'application/json' } });
  let resolveVisible;
  const visibleResponse = new Promise(resolve => { resolveVisible = resolve; });
  const requests = [];
  globalThis.fetch = async (url, options) => {
    const path = String(url); requests.push([path, options?.method || 'GET']);
    if (path === '/api/auth/me') return json({ ...user, role_key: 'school_owner', role_id: 2 });
    if (path.startsWith('/api/students?')) return json([{ id: 50, full_name: 'Visible student', student_number: '50' }, { id: 51, full_name: 'Hidden hosted student', student_number: '51' }]);
    if (path === '/api/students/50/grades') return visibleResponse;
    if (path === '/api/students/51/grades') return json({ student_name: 'Hidden hosted student', grades_visible: false, grades: [], academic_outcome: null });
    throw Error('Unexpected request ' + path);
  };
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  t.after(async () => { await act(async () => root.unmount()); host.remove(); globalThis.fetch = previousFetch; });
  await act(async () => root.render(createElement(MemoryRouter, null, createElement(AuthProvider, null, createElement(GradesPage)))));
  const select = host.querySelector('select');
  await act(async () => change(select, '50'));
  await act(async () => change(select, '51'));
  const initialize = [...host.querySelectorAll('button')].find(item => item.textContent.includes('تهيئة درجات الطالب'));
  assert.equal(initialize.disabled, true);
  assert.match(host.textContent, /درجات الطالب مخفية/);
  assert.ok([...select.options].some(option => option.value === '51'));
  await act(async () => resolveVisible(json({ student_name: 'Visible student', settings, grades })));
  assert.equal(select.value, '51');
  assert.equal(host.querySelector('tbody'), null);
  assert.match(host.textContent, /درجات الطالب مخفية/);
  await act(async () => initialize.click());
  assert.equal(requests.some(([,method]) => method === 'POST'), false);
  await act(async () => change(select, ''));
  assert.equal(host.querySelector('[role="status"]'), null);
});
