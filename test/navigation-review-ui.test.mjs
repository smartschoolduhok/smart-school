import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import { createServer } from 'vite';

const window = new Window({ url: 'http://localhost', width: 390, height: 844 });
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLFormElement', 'FormData', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'localStorage', 'sessionStorage']) Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? window : window[key] });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const vite = await createServer({
  root: fileURLToPath(new URL('..', import.meta.url)), configFile: false, appType: 'custom',
  optimizeDeps: { noDiscovery: true, include: [] }, esbuild: { jsx: 'automatic' },
  ssr: { noExternal: ['react-router-dom', 'react-router'], resolve: { conditions: ['module', 'browser', 'development'] } },
  server: { middlewareMode: true, hmr: false },
});
const { default: Header } = await vite.ssrLoadModule('/src/components/Header.tsx');
const { default: DashboardPage } = await vite.ssrLoadModule('/src/modules/dashboard/DashboardPage.tsx');
const { AuthProvider, useAuth } = await vite.ssrLoadModule('/src/hooks/useAuth.tsx');
const { MemoryRouter, useLocation, useNavigate } = await vite.ssrLoadModule('react-router-dom');
const rbac = await vite.ssrLoadModule('/src/lib/rbac.ts');
after(async () => { await vite.close(); await window.happyDOM.close(); });

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const actor = (id = 1, role = 'school_owner', schoolId = 1) => ({ id, role_key: role, school_id: schoolId, full_name: `حساب ${id}`, school_name: `مدرسة ${schoolId}`, role_name: role });
const note = (key, title, type = 'homework') => ({ notification_key: key, notification_type: type, title, body: `تفاصيل ${title}`, student_id: null, reference_type: type, reference_key: key, created_at: 1780000000, read_at: null });
const feed = (...notifications) => ({ unread_count: notifications.filter(item => item.read_at == null).length, notifications });
function TestDriver() {
  const { login } = useAuth();
  const navigate = useNavigate(), { pathname } = useLocation();
  return createElement('div', null,
    createElement('button', { onClick: () => void login('next@example.test', 'test-only') }, 'تبديل الحساب'),
    createElement('button', { onClick: () => navigate('/students') }, 'انتقال يدوي'),
    createElement('output', { 'aria-label': 'المسار الحالي للاختبار' }, pathname));
}
function AuthorizedView({ dashboard }) {
  const { user } = useAuth();
  if (!user) return null;
  return dashboard ? createElement(DashboardPage) : createElement(Header, { onMenuClick() {}, isMenuOpen: false });
}
async function mount(t, { initialActor = actor(), nextActors = [actor(2, 'accountant', 2)], notifications = () => json({ data: feed() }), read = call => json({ data: { notification_key: call.path.split('/')[3], read_at: 1780000001 } }), dashboard = false, path = '/' } = {}) {
  localStorage.clear(); sessionStorage.clear();
  let activeActor = initialActor, loginIndex = 0;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const call = { path: String(url).split('?')[0], url: String(url), method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : undefined, actor: activeActor };
    calls.push(call);
    if (call.path === '/api/auth/me') return json({ data: activeActor, csrf_token: 'a'.repeat(64) });
    if (call.path === '/api/auth/login') { activeActor = nextActors[loginIndex++]; assert.ok(activeActor, 'expected next test actor'); return json({ data: { user: activeActor, csrf_token: 'a'.repeat(64) } }); }
    if (call.path === '/api/notifications') return notifications(call, calls.filter(item => item.path === '/api/notifications').length);
    if (/^\/api\/notifications\/.+\/read$/.test(call.path)) return read(call);
    if (call.path === '/api/dashboard/stats') return json({ data: { active_schools: 2, active_users: 20, total_users: 21, current_academic_year: '2026-2027', total_modules: 31, core_modules: 12 } });
    if (call.path === '/api/students') return json({ data: [{ id: 11, full_name: 'الطالب المرتبط', student_number: 'ST-11', class_name: 'الأول المتوسط', section_name: 'أ' }] });
    throw new Error(`Unexpected request: ${call.path}`);
  };
  const container = document.createElement('div'); document.body.append(container);
  const app = createRoot(container);
  await act(async () => app.render(createElement(AuthProvider, null, createElement(MemoryRouter, { initialEntries: [path] }, createElement(TestDriver), createElement(AuthorizedView, { dashboard })))));
  t.after(async () => { await act(async () => app.unmount()); container.remove(); });
  return { container, calls };
}
const button = (ui, label) => { const found = [...ui.container.querySelectorAll('button')].find(element => element.textContent.trim() === label); assert.ok(found, `button ${label}`); return found; };
const notificationsButton = ui => ui.container.querySelector('#notifications-button');
const route = ui => ui.container.querySelector('[aria-label="المسار الحالي للاختبار"]').textContent;
const search = ui => ui.container.querySelector('[aria-label="البحث في صفحات النظام"]');
const results = ui => [...ui.container.querySelectorAll('#page-search-results button')];
async function click(element) { assert.ok(element); await act(async () => element.click()); }
async function input(element, value) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, value);
    element.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
}

test('notification refresh keeps the latest response when the initial request finishes late', async t => {
  const old = deferred();
  const ui = await mount(t, { notifications: (_call, index) => index === 1 ? old.promise : json({ data: feed(note('new', 'إشعار أحدث')) }) });
  await click(notificationsButton(ui));
  assert.match(ui.container.querySelector('#notifications-menu').textContent, /إشعار أحدث/);
  await act(async () => old.resolve(json({ data: feed(note('old', 'إشعار قديم'), note('old2', 'إشعار قديم ثان')) })));
  assert.match(ui.container.querySelector('#notifications-menu').textContent, /إشعار أحدث/);
  assert.doesNotMatch(ui.container.textContent, /إشعار قديم/);
  assert.equal(notificationsButton(ui).textContent, '1');
});

test('notification identity A to B to A never accepts the original stale A feed', async t => {
  const oldA = deferred(); let aReads = 0;
  const first = actor(), other = actor(2, 'principal', 2);
  const ui = await mount(t, { initialActor: first, nextActors: [other, first], notifications: call => {
    if (call.actor.id === first.id && ++aReads === 1) return oldA.promise;
    return json({ data: feed(note(`current-${call.actor.id}`, call.actor.id === first.id ? 'إشعار الحساب الحالي' : 'إشعار حساب آخر')) });
  } });
  await click(button(ui, 'تبديل الحساب'));
  await click(button(ui, 'تبديل الحساب'));
  await click(notificationsButton(ui));
  await act(async () => oldA.resolve(json({ data: feed(note('stale-A', 'إشعار قديم قبل تبديل الحساب')) })));
  assert.match(ui.container.querySelector('#notifications-menu').textContent, /إشعار الحساب الحالي/);
  assert.doesNotMatch(ui.container.textContent, /إشعار قديم قبل تبديل الحساب|إشعار حساب آخر/);
});

test('stale notification errors cannot replace a different account feed', async t => {
  const old = deferred();
  const ui = await mount(t, { notifications: call => call.actor.id === 1 ? old.promise : json({ data: feed(note('next', 'إشعار المدرسة الثانية')) }) });
  await click(button(ui, 'تبديل الحساب'));
  await click(notificationsButton(ui));
  await act(async () => old.resolve(json({ error: 'خطأ الحساب السابق' }, 500)));
  assert.match(ui.container.querySelector('#notifications-menu').textContent, /إشعار المدرسة الثانية/);
  assert.doesNotMatch(ui.container.textContent, /خطأ الحساب السابق/);
});

test('a pending notification read cannot navigate or change badge after account switch', async t => {
  const pending = deferred();
  const ui = await mount(t, { notifications: call => json({ data: feed(note(`account-${call.actor.id}`, call.actor.id === 1 ? 'رسالة قديمة' : 'رسالة الحساب الجديد')) }), read: () => pending.promise });
  await click(notificationsButton(ui));
  await click(ui.container.querySelector('#notifications-menu button'));
  await click(button(ui, 'تبديل الحساب'));
  await act(async () => pending.resolve(json({ data: { notification_key: 'account-1', read_at: 1780000002 } })));
  assert.equal(route(ui), '/');
  assert.equal(notificationsButton(ui).textContent, '1');
  await click(notificationsButton(ui));
  assert.match(ui.container.querySelector('#notifications-menu').textContent, /رسالة الحساب الجديد/);
  assert.equal(ui.container.querySelector('#notifications-menu button').disabled, false);
});

test('finishing a read after manual navigation does not pull the user back to the notification target', async t => {
  const pending = deferred();
  const ui = await mount(t, { notifications: () => json({ data: feed(note('homework', 'واجب جديد')) }), read: () => pending.promise });
  await click(notificationsButton(ui));
  await click(ui.container.querySelector('#notifications-menu button'));
  await click(button(ui, 'انتقال يدوي'));
  assert.equal(route(ui), '/students');
  await act(async () => pending.resolve(json({ data: { notification_key: 'homework', read_at: 1780000002 } })));
  assert.equal(route(ui), '/students');
});

test('notification read failure stays visible and retry permits a single successful read', async t => {
  const pending = deferred(); let writes = 0;
  const ui = await mount(t, { notifications: () => json({ data: feed(note('report', 'متابعة جاهزة', 'grade_progress')) }), read: () => ++writes === 1 ? pending.promise : json({ data: { notification_key: 'report', read_at: 1780000002 } }) });
  await click(notificationsButton(ui));
  const notification = ui.container.querySelector('#notifications-menu button');
  await click(notification); await click(notification);
  assert.equal(writes, 1);
  await act(async () => pending.resolve(json({ error: 'تعذر تأكيد قراءة الإشعار' }, 500)));
  assert.equal(route(ui), '/');
  assert.match(ui.container.querySelector('[role="alert"]').textContent, /تعذر تأكيد قراءة/);
  await click(button(ui, 'إعادة المحاولة'));
  await click(ui.container.querySelector('#notifications-menu button'));
  assert.equal(writes, 2);
  assert.equal(route(ui), '/grade-progress');
  assert.equal(notificationsButton(ui).textContent, '');
});

test('parent page search normalizes Arabic spelling and offers one grade destination', async t => {
  const ui = await mount(t, { initialActor: actor(1, 'parent') });
  await input(search(ui), 'اَبْنَائِي');
  assert.deepEqual(results(ui).map(element => element.textContent), ['أبنائي']);
  await click(results(ui)[0]);
  assert.equal(route(ui), '/students');
  assert.equal(search(ui).value, '');
  await input(search(ui), 'متابعة');
  assert.deepEqual(results(ui).map(element => element.textContent), ['متابعة الدرجات']);
  await click(results(ui)[0]);
  assert.equal(route(ui), '/grades');
  await input(search(ui), 'سجل الكادر');
  assert.equal(results(ui).length, 0);
  assert.match(ui.container.querySelector('#page-search-results').textContent, /لا توجد صفحة مطابقة/);
});

test('Arabic search ignores hamza variants and kashida; parent legacy route has correct current location', async t => {
  const ui = await mount(t, { initialActor: actor(1, 'parent'), path: '/grade-progress' });
  assert.match(ui.container.querySelector('[aria-label="الموقع الحالي"]').textContent, /متابعة الدرجات/);
  await input(search(ui), 'اِعـدَادَات');
  assert.deepEqual(results(ui).map(element => element.textContent), ['إعدادات النظام']);
  await act(async () => ui.container.querySelector('form[role="search"]').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
  assert.equal(route(ui), '/settings');
});

test('dashboard daily links honor route permissions for all eight roles', async t => {
  const routeRoles = {
    '/schools': rbac.SYSTEM_ADMIN_ROLES, '/users': rbac.USER_DIRECTORY_ROLES, '/settings': rbac.SETTINGS_VIEW_ROLES,
    '/analytics': rbac.ANALYTICS_ACCESS_ROLES, '/students': rbac.STUDENT_DIRECTORY_ROLES, '/timetable': rbac.ACADEMIC_MANAGEMENT_ROLES,
    '/grades': rbac.GRADE_VIEW_ROLES, '/attendance': rbac.ATTENDANCE_VIEW_ROLES, '/employees': rbac.EMPLOYEE_ACCESS_ROLES,
    '/fees': rbac.FEE_MANAGEMENT_ROLES, '/admissions': rbac.ACADEMIC_MANAGEMENT_ROLES, '/section-advisors': rbac.ACADEMIC_MANAGEMENT_ROLES,
    '/gate-attendance': rbac.GATE_ATTENDANCE_VIEW_ROLES, '/student-age-review': rbac.ACADEMIC_MANAGEMENT_ROLES, '/classes': rbac.ACADEMIC_ACCESS_ROLES,
    '/homework': rbac.HOMEWORK_VIEW_ROLES, '/grade-progress': rbac.GRADE_VIEW_ROLES, '/communication': rbac.COMMUNICATION_ROLES,
    '/staff-attendance': rbac.STAFF_ATTENDANCE_VIEW_ROLES, '/treasury': rbac.FINANCE_ACCESS_ROLES, '/salary-receipts': rbac.EMPLOYEE_ACCESS_ROLES,
  };
  for (const role of ['system_admin', 'school_owner', 'principal', 'vice_principal', 'registrar', 'teacher', 'accountant', 'parent']) {
    await t.test(role, async child => {
      const ui = await mount(child, { initialActor: actor(1, role), dashboard: true });
      const paths = [...ui.container.querySelectorAll('section[aria-labelledby="daily-actions-heading"] a')].map(link => link.getAttribute('href'));
      assert.ok(paths.length > 0 && paths.length <= 6);
      assert.equal(paths.length, new Set(paths).size);
      for (const path of paths) assert.ok(routeRoles[path]?.includes(role), `${role} cannot follow ${path}`);
      if (role === 'accountant') { assert.ok(paths.includes('/treasury')); assert.ok(!paths.includes('/grades')); }
      if (role === 'teacher') { assert.ok(paths.includes('/homework')); assert.ok(!paths.includes('/employees')); }
      if (role === 'parent') { assert.ok(paths.includes('/students')); assert.ok(paths.includes('/grades')); assert.ok(!paths.includes('/grade-progress')); }
      await click(ui.container.querySelector('section[aria-labelledby="daily-actions-heading"] a'));
      assert.equal(route(ui), paths[0]);
    });
  }
});
