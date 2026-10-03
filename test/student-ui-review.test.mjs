import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import { createServer } from 'vite';

const window = new Window({ url: 'http://localhost', width: 390, height: 844 });
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'Node', 'Event', 'MouseEvent', 'localStorage', 'sessionStorage']) Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? window : window[key] });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const vite = await createServer({
  root: fileURLToPath(new URL('..', import.meta.url)), configFile: false, appType: 'custom',
  optimizeDeps: { noDiscovery: true, include: [] }, esbuild: { jsx: 'automatic' },
  ssr: { noExternal: ['react-router-dom', 'react-router'], resolve: { conditions: ['module', 'browser', 'development'] } },
  server: { middlewareMode: true, hmr: false },
});
const { default: StudentsPage } = await vite.ssrLoadModule('/src/modules/students/StudentsPage.tsx');
const { default: StudentProfilePage } = await vite.ssrLoadModule('/src/modules/students/StudentProfilePage.tsx');
const { AuthProvider } = await vite.ssrLoadModule('/src/hooks/useAuth.tsx');
const { MemoryRouter, Routes, Route, useNavigate } = await vite.ssrLoadModule('react-router-dom');
after(async () => { await vite.close(); await window.happyDOM.close(); });

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const student = (id = 11, fields = {}) => ({ id, school_id: 1, full_name: `طالب ${id}`, student_number: `ST-${id}`, status: 'active', gender: 'male', religion: null, father_name: null, mother_name: null, guardian_name: null, guardian_phone: null, address: null, notes: null, phone: null, birth_date: '2012-05-05', class_id: 4, section_id: 8, class_name: 'الأول المتوسط', section_name: 'أ', current_academic_year_id: 3, current_academic_year_name: '2026-2027', current_enrollment_id: 20 + id, current_enrollment_status: 'active', current_promotion_status: 'pending', ...fields });
function Driver() {
  const navigate = useNavigate();
  return createElement('nav', { 'aria-label': 'Test navigation' },
    createElement('button', { onClick: () => navigate('/students/11') }, 'Student A'),
    createElement('button', { onClick: () => navigate('/students/22') }, 'Student B'));
}
async function mount(t, { role = 'school_owner', rows = [student()], profile = false, overrides = {} } = {}) {
  localStorage.clear(); sessionStorage.clear();
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const call = { url: String(url), path: String(url).split('?')[0], method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    if (overrides[call.path]) return overrides[call.path](call);
    if (call.path === '/api/auth/me') return json({ data: { id: 1, school_id: 1, role_key: role, full_name: 'Test actor' }, csrf_token: 'a'.repeat(64) });
    if (call.path === '/api/students') return json({ data: rows });
    if (call.path === '/api/classes') return json({ data: [{ id: 4, name: 'الأول المتوسط', school_id: 1 }] });
    if (call.path === '/api/sections') return json({ data: [{ id: 8, class_id: 4, name: 'أ', school_id: 1 }] });
    if (call.path === '/api/academic-years') return json({ data: [{ id: 3, school_id: 1, name: '2026-2027', is_active: 1 }] });
    if (call.path === '/api/student-study-status') return json({ data: { school: { id: 1, name: 'مدرسة' }, academic_year: { id: 3, name: '2026-2027' }, rows: [], roster: rows.map(row => ({ student_id: row.id, study_status: 'regular', grades_visible: true })) } });
    const match = /^\/api\/students\/(\d+)(?:\/(.*))?$/.exec(call.path);
    if (match) {
      const id = Number(match[1]);
      if (!match[2]) return json({ data: student(id) });
      if (match[2] === 'enrollments') return json({ data: [] });
      if (match[2] === 'religious-subject') return json({ data: { current_assignment: null, candidates: [], meta: {} } });
      if (match[2] === 'grades') return json({ data: { grades_visible: false, grades: [] } });
    }
    throw new Error(`Unexpected request: ${call.path}`);
  };
  const container = document.createElement('div'); document.body.append(container);
  const app = createRoot(container);
  const component = profile ? createElement(Routes, null, createElement(Route, { path: '/students/:id', element: createElement(StudentProfilePage) })) : createElement(StudentsPage);
  await act(async () => app.render(createElement(AuthProvider, null, createElement(MemoryRouter, { initialEntries: [profile ? '/students/11' : '/students'] }, profile && createElement(Driver), component))));
  t.after(async () => { await act(async () => app.unmount()); container.remove(); });
  return { container, calls };
}
const button = (ui, text) => { const result = [...ui.container.querySelectorAll('button')].find(node => node.textContent.trim() === text); assert.ok(result, text); return result; };
const field = (ui, text) => { const result = [...ui.container.querySelectorAll('label')].find(node => node.textContent.startsWith(text)); assert.ok(result, text); return result.parentElement.querySelector('input,select,textarea'); };
const click = async element => act(async () => element.click());
async function input(element, value) {
  assert.ok(element);
  await act(async () => {
    const prototype = element.tagName === 'SELECT' ? HTMLSelectElement.prototype : element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
    element.dispatchEvent(new window.Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  });
}

test('editing an archived student preserves their archived status and unknown gender', async t => {
  const ui = await mount(t, { rows: [student(11, { status: 'archived', gender: 'unknown' })] });
  await click(button(ui, 'التصفية'));
  await input(ui.container.querySelector('[aria-label="تصفية حالة الطالب"]'), 'archived');
  assert.match(ui.container.querySelector('tbody').textContent, /غير محدد/);
  assert.doesNotMatch(ui.container.querySelector('tbody').textContent, /أنثى/);
  await click(ui.container.querySelector('button[title="تعديل"]'));
  assert.equal(field(ui, 'الجنس').value, 'unknown');
  await input(field(ui, 'الاسم الكامل'), 'اسم مصحح');
  await click(button(ui, 'حفظ التغييرات'));
  const write = ui.calls.find(call => call.method === 'PUT');
  assert.ok(write);
  assert.equal('status' in write.body, false, 'editing identity must not unarchive the student');
  assert.equal(write.body.gender, 'unknown');
  assert.equal(write.body.full_name, 'اسم مصحح');
});

test('pending student save keeps the modal and draft locked until the result arrives', async t => {
  const pending = deferred();
  const ui = await mount(t, { overrides: { '/api/students/11': call => call.method === 'PUT' ? pending.promise : json({ data: student() }) } });
  await click(ui.container.querySelector('button[title="تعديل"]'));
  await input(field(ui, 'الاسم الكامل'), 'اسم جديد');
  await click(button(ui, 'حفظ التغييرات'));
  assert.equal(ui.container.querySelector('[role="dialog"] fieldset').disabled, true);
  assert.equal(button(ui, 'إلغاء').disabled, true);
  assert.equal(ui.container.querySelector('[aria-label="إغلاق نموذج الطالب"]').disabled, true);
  assert.equal(ui.calls.filter(call => call.method === 'PUT').length, 1);
  await act(async () => pending.resolve(json({ error: 'تعذر الحفظ' }, 500)));
  assert.match(ui.container.querySelector('[role="alert"]').textContent, /تعذر الحفظ/);
  assert.equal(field(ui, 'الاسم الكامل').value, 'اسم جديد');
  assert.equal(button(ui, 'إلغاء').disabled, false);
});

test('profile A to B to A rejects the original late A response and preserves hidden grades', async t => {
  const oldA = deferred(); let aReads = 0;
  const ui = await mount(t, { profile: true, role: 'teacher', overrides: {
    '/api/students/11': () => ++aReads === 1 ? oldA.promise : json({ data: student(11, { full_name: 'الملف الحالي' }) }),
  } });
  await click(button(ui, 'Student B'));
  assert.match(ui.container.textContent, /طالب 22/);
  await click(button(ui, 'Student A'));
  assert.match(ui.container.textContent, /الملف الحالي/);
  await act(async () => oldA.resolve(json({ data: student(11, { full_name: 'ملف قديم متأخر' }) })));
  assert.match(ui.container.textContent, /الملف الحالي/);
  assert.doesNotMatch(ui.container.textContent, /ملف قديم متأخر/);
  assert.match(ui.container.textContent, /درجات الطالب مخفية لهذه السنة الدراسية/);
  assert.equal(ui.container.querySelector('[aria-label="درجات الطالب"] table'), null);
  assert.equal(ui.calls.some(call => call.path === '/api/student-study-status'), false);
});

test('a student response for a different resource cannot render under the requested profile', async t => {
  const ui = await mount(t, { profile: true, role: 'teacher', overrides: { '/api/students/11': () => json({ data: student(22, { full_name: 'ملف غير مطابق' }) }) } });
  assert.match(ui.container.textContent, /تعذر مطابقة ملف الطالب المطلوب/);
  assert.doesNotMatch(ui.container.textContent, /ملف غير مطابق/);
});

test('directory tools remain secondary and filters can be reset without clearing search', async t => {
  const ui = await mount(t, { rows: [student(11), student(22, { gender: 'female' })] });
  const tools = ui.container.querySelector('[aria-label="أدوات الطلاب"]');
  assert.ok(tools.querySelector('a[href="/student-age-review"]'));
  assert.ok(tools.querySelector('a[href^="/print/student-roster"]'));
  assert.equal(tools.contains(button(ui, 'إضافة طالب')), false);
  await input(ui.container.querySelector('[aria-label="البحث عن الطلاب"]'), 'ST-11');
  await click(button(ui, 'التصفية'));
  assert.equal(ui.container.querySelector('[aria-controls="student-directory-filters"]').getAttribute('aria-expanded'), 'true');
  await input(ui.container.querySelector('[aria-label="تصفية الجنس"]'), 'female');
  assert.equal(ui.container.querySelector('tbody'), null);
  await click(button(ui, 'مسح التصفية'));
  assert.equal(ui.container.querySelector('[aria-label="البحث عن الطلاب"]').value, 'ST-11');
  assert.equal(ui.container.querySelectorAll('tbody tr').length, 1);
  assert.match(ui.container.querySelector('tbody').textContent, /طالب 11/);
  assert.match(ui.container.textContent, /2026-2027/);
});

test('accountant directory contains only financial actions and no private academic tools', async t => {
  const ui = await mount(t, { role: 'accountant' });
  assert.equal(ui.container.querySelector('[aria-label="أدوات الطلاب"]'), null);
  assert.equal(ui.container.querySelector('[aria-label="تصفية نوع الدراسة"]'), null);
  assert.equal(ui.container.querySelector('button[title="تعديل"]'), null);
  assert.ok(ui.container.querySelector('a[href="/students/11/finance"]'));
  assert.equal(ui.calls.some(call => ['/api/classes', '/api/academic-years', '/api/student-study-status'].includes(call.path)), false);
});
