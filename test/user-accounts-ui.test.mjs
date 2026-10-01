import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import { createServer } from 'vite';

const window = new Window({ url: 'http://localhost', width: 390, height: 844 });
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'InputEvent', 'localStorage', 'sessionStorage']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? window : window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.alert = () => {};
window.confirm = () => true;
const { createElement, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const vite = await createServer({
  root: fileURLToPath(new URL('..', import.meta.url)), appType: 'custom',
  ssr: { noExternal: ['react-router-dom', 'react-router'], resolve: { conditions: ['module', 'browser', 'development'] } },
  server: { middlewareMode: true, hmr: false },
});
const { default: UsersPage } = await vite.ssrLoadModule('/src/modules/users/UsersPage.tsx');
const { default: ChangePasswordPage } = await vite.ssrLoadModule('/src/modules/auth/ChangePasswordPage.tsx');
const { AuthProvider, useAuth } = await vite.ssrLoadModule('/src/hooks/useAuth.tsx');
const { SessionGate } = await vite.ssrLoadModule('/src/App.tsx');
const { MemoryRouter, Routes, Route, useLocation } = await vite.ssrLoadModule('react-router-dom');
after(async () => { await vite.close(); await window.happyDOM.close(); });

const csrf = 'a'.repeat(64);
const owner = { id: 1, role_key: 'school_owner', school_id: 1, full_name: 'Generated owner', email: 'owner@example.test' };
const teacher = { id: 2, role_key: 'teacher', school_id: 1, full_name: 'Generated teacher', email: 'teacher@example.test', status: 'active', account_revision: 7, can_manage: true, phone: '07000000000' };
const roleKeys = ['system_admin', 'school_owner', 'principal', 'vice_principal', 'teacher', 'accountant', 'registrar', 'parent'];
const roles = roleKeys.map((key, index) => ({ id: index + 1, key, name: key }));
const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const temporary = { id: 7, temporary_password: 'Generated-Test-Temporary-Only', temporary_password_expires_at: 1800000000 };

function AuthDriver() {
  const { login } = useAuth();
  return createElement('button', { onClick: () => void login('new-owner@example.test', 'test-only') }, 'Switch actor');
}
function Location() { const { pathname } = useLocation(); return createElement('output', { 'aria-label': 'current route' }, pathname); }
function PasswordRoutes() {
  return createElement(SessionGate, null, createElement(Routes, null,
    createElement(Route, { path: '/change-password', element: createElement(ChangePasswordPage) }),
    createElement(Route, { path: '/login', element: createElement('p', null, 'Login destination') }),
  ));
}
async function mount(t, { actor = owner, accounts = [teacher], overrides = {}, component = UsersPage, path = '/', withDriver = false } = {}) {
  localStorage.clear(); sessionStorage.clear();
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const raw = String(url), pathname = raw.split('?')[0], method = init.method || 'GET';
    const input = init.body ? JSON.parse(init.body) : undefined;
    const call = { pathname, url: raw, method, input, headers: new Headers(init.headers) };
    calls.push(call);
    if (overrides[pathname]) return overrides[pathname](call);
    if (pathname === '/api/auth/me') return actor ? response({ data: actor, csrf_token: csrf }) : response({ error: 'signed out' }, 401);
    if (pathname === '/api/users') return response({ data: method === 'GET' ? accounts : temporary });
    if (pathname === '/api/roles') return response({ data: roles });
    if (pathname === '/api/schools') return response({ data: [{ id: 1, name: 'School One' }, { id: 3, name: 'School Three' }] });
    if (pathname.endsWith('/reset-password')) return response({ data: temporary });
    return response({ data: { id: 2, changed: true } });
  };
  const container = document.createElement('div'); document.body.append(container);
  const app = createRoot(container);
  await act(async () => app.render(createElement(AuthProvider, null,
    createElement(MemoryRouter, { initialEntries: [path] }, withDriver && createElement(AuthDriver), createElement(Location), createElement(component)),
  )));
  t.after(async () => { await act(async () => app.unmount()); container.remove(); });
  return { container, calls };
}
const button = (target, label) => { const result = [...target.container.querySelectorAll('button')].find(item => item.textContent.trim() === label); assert.ok(result, label); return result; };
const click = async element => act(async () => element.click());
async function input(element, value) {
  assert.ok(element);
  await act(async () => {
    const prototype = element.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
    element.dispatchEvent(new window.Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  });
}
const submit = async form => act(async () => form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
async function createForm(ui) {
  await click(button(ui, 'إضافة مستخدم'));
  const form = ui.container.querySelector('form');
  await input(form.querySelector('[aria-label="الاسم الكامل"]'), 'Generated new account');
  await input(form.querySelector('[aria-label="البريد الإلكتروني"]'), 'new@example.test');
  await input(form.querySelector('[aria-label="الدور"]'), 'teacher');
  return form;
}

test('owner sees six assignable roles and only manageable same-school rows; no school-directory request', async t => {
  const accounts = [teacher, { ...teacher, id: 1, role_key: 'school_owner' }, { ...teacher, id: 3, role_key: 'school_owner' }, { ...teacher, id: 4, role_key: 'system_admin' }, { ...teacher, id: 5, school_id: 3 }, { ...teacher, id: 6, can_manage: false }];
  const ui = await mount(t, { accounts });
  assert.equal(ui.container.querySelectorAll('article button').length, 3);
  assert.equal(ui.calls.some(call => call.pathname === '/api/schools'), false);
  assert.equal(ui.calls.find(call => call.pathname === '/api/users').url, '/api/users?school_id=1');
  await click(button(ui, 'إضافة مستخدم'));
  assert.deepEqual([...ui.container.querySelectorAll('select[aria-label="الدور"] option')].map(option => option.value), ['', ...roleKeys.slice(2)]);
  assert.equal(ui.container.querySelector('[aria-label="المدرسة"]'), null);
  assert.equal(ui.container.querySelector('input[type="password"]'), null);
  assert.equal(ui.container.querySelector('[role="dialog"]').getAttribute('aria-modal'), 'true');
  assert.ok(ui.container.querySelector('[dir="rtl"]'));
});

test('creation uses a server-generated password, guards double submit, copies only on action and removes the secret on close', async t => {
  const pending = deferred(); let writes = 0; const copies = [];
  navigator.clipboard.writeText = async value => { copies.push(value); };
  const ui = await mount(t, { overrides: { '/api/users': call => call.method === 'GET' ? response({ data: [teacher] }) : (++writes, pending.promise) } });
  const form = await createForm(ui);
  await submit(form); await submit(form);
  assert.equal(writes, 1); assert.equal(form.querySelector('fieldset').disabled, true);
  const request = ui.calls.find(call => call.method === 'POST');
  assert.deepEqual(request.input, { full_name: 'Generated new account', email: 'new@example.test', role_key: 'teacher', phone: '' });
  assert.equal(request.headers.get('X-CSRF-Token'), csrf);
  await act(async () => pending.resolve(response({ data: temporary })));
  assert.equal(ui.container.querySelector('input[aria-label="كلمة المرور المؤقتة"]').value, temporary.temporary_password);
  assert.equal(copies.length, 0); assert.equal(localStorage.length, 0); assert.equal(sessionStorage.length, 0);
  await click(button(ui, 'نسخ كلمة المرور')); assert.deepEqual(copies, [temporary.temporary_password]);
  await click(button(ui, 'تم، إغلاق')); assert.equal(ui.container.querySelector('input[aria-label="كلمة المرور المؤقتة"]'), null);
  await click(button(ui, 'إضافة مستخدم')); assert.equal(ui.container.querySelector('input[aria-label="كلمة المرور المؤقتة"]'), null);
});

test('stale edit preserves inputs and error, never resubmits with a fresh revision automatically', async t => {
  const ui = await mount(t, { overrides: { '/api/users/2': () => response({ error: 'Account changed', code: 'account_stale' }, 409) } });
  await click(button(ui, 'تعديل'));
  const form = ui.container.querySelector('form');
  await input(form.querySelector('[aria-label="الاسم الكامل"]'), 'Pending correction');
  await submit(form);
  assert.equal(form.querySelector('[aria-label="الاسم الكامل"]').value, 'Pending correction');
  assert.match(form.textContent, /Account changed/);
  assert.equal(button(ui, 'حفظ التعديلات').disabled, true);
  await submit(form);
  assert.equal(ui.calls.filter(call => call.method === 'PUT').length, 1);
  assert.deepEqual(ui.calls.find(call => call.method === 'PUT').input, { full_name: 'Pending correction', email: teacher.email, role_key: 'teacher', phone: teacher.phone, expected_revision: 7 });
  const refresh = [...form.querySelectorAll('button')].find(element => element.textContent === 'تحديث القائمة');
  await click(refresh);
  assert.equal(form.querySelector('[aria-label="الاسم الكامل"]').value, 'Pending correction');
  assert.equal(button(ui, 'حفظ التعديلات').disabled, true);
});

test('password reset requires explicit confirmation, revision and no supplied password', async t => {
  const ui = await mount(t);
  await click(button(ui, 'إعادة تعيين كلمة المرور'));
  assert.equal(ui.calls.filter(call => call.method === 'PUT').length, 0);
  assert.match(ui.container.querySelector('[role="dialog"]').textContent, /24 ساعة/);
  assert.equal(ui.container.querySelector('input[type="password"]'), null);
  await submit(ui.container.querySelector('form'));
  const request = ui.calls.find(call => call.method === 'PUT');
  assert.equal(request.pathname, '/api/users/2/reset-password');
  assert.deepEqual(request.input, { expected_revision: 7 });
  assert.equal(ui.container.querySelector('input[aria-label="كلمة المرور المؤقتة"]').value, temporary.temporary_password);
});

test('status toggle confirms and sends the listed account revision', async t => {
  let confirmed = false; window.confirm = () => { confirmed = true; return false; };
  const ui = await mount(t);
  await click(button(ui, 'تعطيل')); assert.equal(confirmed, true); assert.equal(ui.calls.some(call => call.method === 'PUT'), false);
  window.confirm = () => true;
  await click(button(ui, 'تعطيل'));
  assert.deepEqual(ui.calls.find(call => call.method === 'PUT').input, { status: 'inactive', expected_revision: 7 });
});

test('duplicate email on create stays editable and can be corrected without discarding the form', async t => {
  const ui = await mount(t, { overrides: { '/api/users': call => call.method === 'GET' ? response({ data: [teacher] }) : response({ error: 'Email already used', code: 'email_in_use' }, 409) } });
  const form = await createForm(ui); await submit(form);
  assert.match(form.textContent, /Email already used/);
  assert.equal(button(ui, 'إنشاء الحساب').disabled, false);
  await input(form.querySelector('[aria-label="البريد الإلكتروني"]'), 'corrected@example.test');
  assert.equal(form.querySelector('[aria-label="الاسم الكامل"]').value, 'Generated new account');
});

test('stale reset never issues another write and retains the target for review', async t => {
  const ui = await mount(t, { overrides: { '/api/users/2/reset-password': () => response({ error: 'Account changed', code: 'account_stale' }, 409) } });
  await click(button(ui, 'إعادة تعيين كلمة المرور'));
  const form = ui.container.querySelector('form'); await submit(form); await submit(form);
  assert.equal(ui.calls.filter(call => call.method === 'PUT').length, 1);
  assert.match(form.textContent, /Generated teacher/); assert.match(form.textContent, /Account changed/);
  assert.equal(button(ui, 'تأكيد إعادة التعيين').disabled, true);
  assert.equal(ui.container.querySelector('input[aria-label="كلمة المرور المؤقتة"]'), null);
});

test('read-only actor never sees management actions even when a row is marked manageable', async t => {
  const ui = await mount(t, { actor: { ...owner, role_key: 'principal' } });
  assert.equal(ui.container.querySelectorAll('article button').length, 0);
  assert.equal([...ui.container.querySelectorAll('button')].some(element => element.textContent === 'إضافة مستخدم'), false);
  assert.equal(ui.calls.some(call => call.pathname === '/api/roles' || call.pathname === '/api/schools'), false);
});

test('system admin creation selects a school and existing account school cannot be reassigned', async t => {
  const ui = await mount(t, { actor: { ...owner, id: 99, role_key: 'system_admin', school_id: null } });
  await createForm(ui);
  const school = ui.container.querySelector('[aria-label="المدرسة"]'); assert.ok(school);
  await input(school, '3'); await submit(ui.container.querySelector('form'));
  assert.equal(ui.calls.find(call => call.method === 'POST').input.school_id, 3);
  await click(button(ui, 'تم، إغلاق')); await click(button(ui, 'تعديل'));
  assert.equal(ui.container.querySelector('[aria-label="المدرسة"]'), null);
  assert.equal([...ui.container.querySelectorAll('[aria-label="الدور"] option')].some(option => option.value === 'system_admin'), false);
});

test('late creation response cannot reveal a password after authenticated actor and school change', async t => {
  const old = deferred();
  const ui = await mount(t, { withDriver: true, overrides: {
    '/api/users': call => call.method === 'POST' ? old.promise : response({ data: call.url.includes('school_id=3') ? [] : [teacher] }),
    '/api/auth/login': () => response({ data: { user: { ...owner, id: 30, school_id: 3 }, csrf_token: csrf } }),
  } });
  const form = await createForm(ui); await submit(form); await click(button(ui, 'Switch actor'));
  await act(async () => old.resolve(response({ data: temporary })));
  assert.equal(ui.container.querySelector('[role="dialog"]'), null);
  assert.equal(ui.container.textContent.includes(teacher.full_name), false);
  assert.ok(ui.calls.some(call => call.url === '/api/users?school_id=3'));
});

test('private print component never mounts before mandatory password change; public verification remains available', async t => {
  let privateMounts = 0;
  function Private() { privateMounts++; return createElement('p', null, 'Private print'); }
  function Gates() { return createElement(SessionGate, null, createElement(Routes, null,
    createElement(Route, { path: '/print/result-card/2', element: createElement(Private) }),
    createElement(Route, { path: '/change-password', element: createElement('p', null, 'Required change') }),
    createElement(Route, { path: '/verify/result-card/test-token', element: createElement('p', null, 'Public verification') }),
    createElement(Route, { path: '/login', element: createElement('p', null, 'Signed out') }),
  )); }
  const ui = await mount(t, { actor: { ...owner, must_change_password: true }, component: Gates, path: '/print/result-card/2' });
  assert.equal(privateMounts, 0); assert.match(ui.container.textContent, /Required change/);
  const publicUI = await mount(t, { actor: null, component: Gates, path: '/verify/result-card/test-token' });
  assert.match(publicUI.container.textContent, /Public verification/); assert.equal(privateMounts, 0);
});

test('private route children do not mount while the initial session request is unresolved', async t => {
  const pending = deferred(); let mounted = 0;
  function Private() { mounted++; return createElement('p', null, 'Private body'); }
  function Page() { return createElement(SessionGate, null, createElement(Private)); }
  const ui = await mount(t, { component: Page, overrides: { '/api/auth/me': () => pending.promise } });
  assert.equal(mounted, 0); assert.ok(ui.container.querySelector('[role="status"]'));
  await act(async () => pending.resolve(response({ data: owner, csrf_token: csrf })));
  assert.equal(mounted, 1); assert.match(ui.container.textContent, /Private body/);
});

test('mandatory password form validates length, difference and confirmation before sending; success clears session and returns to login', async t => {
  const pending = deferred();
  const ui = await mount(t, { actor: { ...owner, must_change_password: true }, component: PasswordRoutes, path: '/change-password', overrides: { '/api/auth/change-password': () => pending.promise } });
  const form = ui.container.querySelector('form'), fields = form.querySelectorAll('input');
  await input(fields[0], 'CurrentTemporary12'); await input(fields[1], 'short'); await input(fields[2], 'short'); await submit(form);
  assert.match(ui.container.textContent, /12 و128/); assert.equal(ui.calls.some(call => call.method === 'POST'), false);
  await input(fields[1], 'CurrentTemporary12'); await input(fields[2], 'CurrentTemporary12'); await submit(form);
  assert.match(ui.container.querySelector('[role="alert"]').textContent, /مختلفة/);
  await input(fields[1], 'NewLongPassword12'); await input(fields[2], 'OtherLongPassword12'); await submit(form);
  assert.match(ui.container.querySelector('[role="alert"]').textContent, /لا يطابق/);
  await input(fields[2], 'NewLongPassword12'); await submit(form); await submit(form);
  assert.equal(ui.calls.filter(call => call.method === 'POST').length, 1);
  const request = ui.calls.find(call => call.method === 'POST');
  assert.deepEqual(request.input, { current_password: 'CurrentTemporary12', new_password: 'NewLongPassword12' });
  assert.equal(request.headers.get('X-CSRF-Token'), csrf);
  await act(async () => pending.resolve(response({ data: { changed: true } })));
  assert.match(ui.container.textContent, /Login destination/);
  assert.equal(ui.container.querySelector('input'), null);
  assert.equal(localStorage.length, 0); assert.equal(sessionStorage.length, 0);
});

test('password change error keeps the form available without displaying the supplied passwords', async t => {
  const ui = await mount(t, { actor: { ...owner, must_change_password: true }, component: PasswordRoutes, path: '/change-password', overrides: { '/api/auth/change-password': () => response({ error: 'Incorrect current password' }, 400) } });
  const form = ui.container.querySelector('form'), fields = form.querySelectorAll('input');
  await input(fields[0], 'GeneratedOld12'); await input(fields[1], 'GeneratedNew12'); await input(fields[2], 'GeneratedNew12'); await submit(form);
  assert.match(ui.container.querySelector('[role="alert"]').textContent, /Incorrect current password/);
  assert.equal(form.querySelector('fieldset').disabled, false);
  assert.equal(ui.container.textContent.includes('GeneratedOld12'), false);
  assert.equal(ui.container.textContent.includes('GeneratedNew12'), false);
});

test('late password-change success does not sign out a newly authenticated different account', async t => {
  const pending = deferred();
  const ui = await mount(t, { actor: { ...owner, must_change_password: true }, component: PasswordRoutes, path: '/change-password', withDriver: true, overrides: {
    '/api/auth/change-password': () => pending.promise,
    '/api/auth/login': () => response({ data: { user: { ...owner, id: 31, school_id: 3, full_name: 'Replacement account' }, csrf_token: csrf } }),
  } });
  const form = ui.container.querySelector('form'), fields = form.querySelectorAll('input');
  await input(fields[0], 'GeneratedOld12'); await input(fields[1], 'GeneratedNew12'); await input(fields[2], 'GeneratedNew12'); await submit(form);
  await click(button(ui, 'Switch actor'));
  await act(async () => pending.resolve(response({ data: { changed: true } })));
  assert.match(ui.container.textContent, /Replacement account/);
  assert.equal(ui.container.querySelector('[aria-label="current route"]').textContent, '/change-password');
  assert.equal(ui.container.querySelector('input').value, '');
});
