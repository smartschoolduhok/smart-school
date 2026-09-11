import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Window } from 'happy-dom';
import { createServer } from 'vite';
import { root } from './helpers/finance-fixture.mjs';

const window = new Window({ url: 'http://localhost', width: 390, height: 844 });
for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'HTMLFormElement', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'InputEvent', 'localStorage', 'sessionStorage']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? window : window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const vite = await createServer({
  root,
  appType: 'custom',
  ssr: { noExternal: ['react-router-dom', 'react-router'], resolve: { conditions: ['module', 'browser', 'development'] } },
  server: { middlewareMode: true, hmr: false },
});
const { default: SchoolProfileTab } = await vite.ssrLoadModule('/src/modules/settings/SchoolProfileTab.tsx');
const { default: LoginPage } = await vite.ssrLoadModule('/src/modules/auth/LoginPage.tsx');
const { default: StudentsPage } = await vite.ssrLoadModule('/src/modules/students/StudentsPage.tsx');
const { default: GradesPage } = await vite.ssrLoadModule('/src/modules/grades/GradesPage.tsx');
const { AuthProvider, useAuth } = await vite.ssrLoadModule('/src/hooks/useAuth.tsx');
const { fetchApi, getDashboardStats } = await vite.ssrLoadModule('/src/lib/api.ts');
const { NAVIGATION_GROUPS, getVisibleNavigationItems } = await vite.ssrLoadModule('/src/components/Sidebar.tsx');
const { MemoryRouter } = await vite.ssrLoadModule('react-router-dom');

after(async () => {
  await vite.close();
  await window.happyDOM.close();
});

async function render(t, element) {
  const container = document.createElement('div');
  document.body.append(container);
  const rootElement = createRoot(container);
  await act(async () => rootElement.render(element));
  t.after(async () => {
    await act(async () => rootElement.unmount());
    container.remove();
  });
  return container;
}

async function input(element, value) {
  await act(async () => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    descriptor.set.call(element, value);
    element.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
}

async function select(element, value) {
  await act(async () => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    descriptor.set.call(element, value);
    element.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
}

async function waitForContent(container, content) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (container.textContent.includes(content)) return;
    await act(async () => new Promise(resolve => setTimeout(resolve, 10)));
  }
  assert.fail(`Timed out waiting for ${content}`);
}

test('school profile fields retain focus while typing', async t => {
  const container = await render(t, createElement(SchoolProfileTab, {
    data: { school: { name: 'مدرسة الاختبار', city: 'دهوك' } },
    canEdit: true,
    schoolId: 1,
    onSuccess() {},
    onError() {},
  }));
  const field = container.querySelector('#school-profile-name');
  assert.ok(field);
  field.focus();
  await input(field, 'مدرسة الاختبار الجديدة');
  assert.equal(document.activeElement, field);
  assert.equal(field.value, 'مدرسة الاختبار الجديدة');
  assert.ok(container.textContent.includes('حفظ التغييرات'));
});

test('navigation is grouped, hides future placeholders, and scopes parent destinations', () => {
  assert.equal(NAVIGATION_GROUPS.length, 6, 'six groups plus the dashboard produce seven top-level choices');
  const groupLabels = NAVIGATION_GROUPS.map(group => group.label);
  assert.deepEqual(groupLabels, ['شؤون الطلاب', 'التعليم والجدول', 'المالية والموظفون', 'التقارير والوثائق', 'البيانات', 'الإدارة والإعدادات']);
  const allLabels = NAVIGATION_GROUPS.flatMap(group => group.items.map(item => item.label));
  for (const unavailable of ['النقل المدرسي', 'بوابة المدرس', 'بوابة ولي الأمر', 'المساعد الذكي']) {
    assert.equal(allLabels.includes(unavailable), false);
  }
  const parentPaths = getVisibleNavigationItems('parent').map(item => item.path);
  assert.ok(parentPaths.includes('/students'));
  assert.ok(parentPaths.includes('/grades'));
  assert.ok(!parentPaths.includes('/analytics'));
  assert.ok(!parentPaths.includes('/fees'));
});

test('login uses session storage by default, remember-me uses local storage, and help is honest', async t => {
  const user = { id: 1, role_key: 'school_owner', role_id: 2, school_id: 1, full_name: 'مالك المدرسة', email: 'owner@example.test', role_name: 'مالك المدرسة', school_name: 'مدرسة الاختبار' };
  const apiAuthorizations = [];
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith('/api/auth/login')) return new Response(JSON.stringify({ data: { token: 'generated-token', user } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (String(url).endsWith('/api/dashboard/stats')) {
      apiAuthorizations.push(new Headers(options?.headers).get('Authorization'));
      return new Response(JSON.stringify({ data: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error(`Unexpected request ${url}`);
  };

  async function login(remember) {
    localStorage.clear();
    sessionStorage.clear();
    const container = await render(t, createElement(MemoryRouter, null, createElement(AuthProvider, null, createElement(LoginPage))));
    const help = [...container.querySelectorAll('button')].find(button => button.textContent.trim() === 'نسيت كلمة المرور؟');
    await act(async () => help.click());
    assert.match(container.textContent, /تواصل مع مدير النظام أو إدارة المدرسة/);
    await input(container.querySelector('#login-email'), 'owner@example.test');
    await input(container.querySelector('#login-password'), 'generated-password');
    if (remember) await act(async () => container.querySelector('input[type="checkbox"]').click());
    await act(async () => container.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
    const apiResult = await getDashboardStats();
    assert.equal(apiResult.error, undefined);
    return {
      local: localStorage.getItem('smart_school_token'),
      session: sessionStorage.getItem('smart_school_token'),
      authorization: apiAuthorizations.at(-1),
    };
  }

  assert.deepEqual(await login(false), { local: null, session: 'generated-token', authorization: 'Bearer generated-token' });
  assert.deepEqual(await login(true), { local: 'generated-token', session: null, authorization: 'Bearer generated-token' });
});

test('API option headers merge without removing stored authorization', async t => {
  const previousFetch = globalThis.fetch;
  let receivedHeaders;
  localStorage.clear();
  sessionStorage.clear();
  sessionStorage.setItem('smart_school_token', 'session-api-token');
  globalThis.fetch = async (_url, options) => {
    receivedHeaders = new Headers(options?.headers);
    return new Response(JSON.stringify({ data: { ok: true } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  t.after(() => {
    globalThis.fetch = previousFetch;
    localStorage.clear();
    sessionStorage.clear();
  });

  const result = await fetchApi('/api/header-merge-check', {
    headers: { Authorization: '', 'X-QA-Header': 'preserved' },
  });

  assert.deepEqual(result.data, { ok: true });
  assert.equal(receivedHeaders.get('Authorization'), 'Bearer session-api-token');
  assert.equal(receivedHeaders.get('X-QA-Header'), 'preserved');
  assert.equal(receivedHeaders.get('Accept'), 'application/json');
  assert.equal(receivedHeaders.get('Content-Type'), 'application/json');
});

test('401 clears both auth stores and removes the authenticated UI state immediately', async t => {
  function AuthStateProbe() {
    const { user, isAuthenticated } = useAuth();
    return createElement('div', null, isAuthenticated && user ? user.full_name : 'SIGNED_OUT');
  }

  const previousFetch = globalThis.fetch;
  const previousAlert = globalThis.alert;
  const user = { id: 2, role_key: 'system_admin', role_id: 1, school_id: null, full_name: 'Staging System Admin', email: 'admin@example.test', role_name: 'مدير النظام', school_name: null };
  for (const storage of [localStorage, sessionStorage]) {
    storage.setItem('smart_school_token', `${storage === localStorage ? 'local' : 'session'}-expired-token`);
    storage.setItem('smart_school_user', JSON.stringify(user));
    storage.setItem('smart_school_auth', 'legacy-auth-state');
  }
  globalThis.alert = () => {};
  globalThis.fetch = async url => {
    if (String(url).endsWith('/api/auth/me')) {
      return new Response(JSON.stringify({ data: user }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (String(url).endsWith('/api/dashboard/stats')) {
      return new Response(JSON.stringify({ error: 'expired' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error(`Unexpected request ${url}`);
  };
  t.after(() => {
    globalThis.fetch = previousFetch;
    if (previousAlert === undefined) delete globalThis.alert;
    else globalThis.alert = previousAlert;
    localStorage.clear();
    sessionStorage.clear();
  });

  const container = await render(t, createElement(AuthProvider, null, createElement(AuthStateProbe)));
  await waitForContent(container, 'Staging System Admin');
  await act(async () => {
    const result = await getDashboardStats();
    assert.match(result.error, /غير مسموح/);
  });
  await waitForContent(container, 'SIGNED_OUT');

  for (const storage of [localStorage, sessionStorage]) {
    assert.equal(storage.getItem('smart_school_token'), null);
    assert.equal(storage.getItem('smart_school_user'), null);
    assert.equal(storage.getItem('smart_school_auth'), null);
  }
  assert.equal(container.textContent.includes('Staging System Admin'), false);
});

test('daily workflows keep rare actions out of the primary tab rows', () => {
  const fees = readFileSync(join(root, 'src/modules/fees/FeesPage.tsx'), 'utf8');
  const grades = readFileSync(join(root, 'src/modules/grades/GradesPage.tsx'), 'utf8');
  const timetable = readFileSync(join(root, 'src/modules/timetable/TimetablePage.tsx'), 'utf8');
  const settings = readFileSync(join(root, 'src/modules/settings/SettingsPage.tsx'), 'utf8');

  const feePrimaryTabs = fees.slice(fees.indexOf('const tabs:'), fees.indexOf('function openPaymentForFee'));
  for (const label of ['قائمة الأقساط', 'المدفوعات', 'الإيصالات']) assert.ok(feePrimaryTabs.includes(label), label);
  for (const contextual of ['إضافة قسط', 'اختبار التحقق']) assert.equal(feePrimaryTabs.includes(contextual), false, contextual);
  assert.match(fees, /<FeeAccountPanel[\s\S]*?onCollect=\{openPaymentForFee\}/);
  assert.match(fees, /setAccountFee\(fee\)/);
  assert.match(fees, /وسيصبح المتبقي/);

  assert.match(grades, /entryTabs = visibleTabs\.filter/);
  assert.match(grades, /<details className="relative">[\s\S]*?أدوات الدرجات/);
  for (const stage of ['الجدول الحالي', 'إعداد وتوليد', 'السجل والإصدارات']) assert.ok(timetable.includes(stage), stage);
  assert.match(timetable, /aria-label="مراحل عمل الجدول"/);
  assert.doesNotMatch(settings, /BackupTab|النسخ الاحتياطي/);
  assert.match(settings, /إعدادات متقدمة/);
});

test('application pages are route-lazy-loaded instead of entering the initial bundle', () => {
  const app = readFileSync(join(root, 'src/App.tsx'), 'utf8');
  assert.ok((app.match(/lazy\(\(\) => import\(/g) || []).length >= 25);
  assert.match(app, /<Suspense fallback=\{<RouteLoading \/>\}>/);
  assert.doesNotMatch(app, /import FeesPage from|import TimetablePage from|import ImportExportPage from/);
});

test('accountant navigation keeps finance and salaries without academic analysis',()=>{
  const paths=getVisibleNavigationItems('accountant').map(item=>item.path);
  assert.ok(!paths.includes('/analytics'));
  assert.ok(!paths.includes('/grades'));
  for(const path of ['/students','/fees','/treasury','/employees'])assert.ok(paths.includes(path),path);
});

test('teacher section-grade selectors use only scoped student-subject assignments', async t => {
  const previousFetch = globalThis.fetch;
  const requests = [];
  const teacher = {
    id: 73,
    role_key: 'teacher',
    role_id: 5,
    school_id: 41,
    full_name: 'مدرس الاختبار',
    email: 'teacher@example.test',
    role_name: 'مدرس',
    school_name: 'مدرسة الاختبار',
  };
  const scopedAssignments = [
    { id: 1, class_id: 10, class_name: 'الصف الأول', section_id: 101, section_name: 'أ', subject_id: 1001, subject_name: 'الحاسوب', is_active: 1 },
    { id: 2, class_id: 10, class_name: 'الصف الأول', section_id: 102, section_name: 'ب', subject_id: 1002, subject_name: 'الرياضيات', is_active: 1 },
  ];

  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('smart_school_token', 'teacher-test-token');
  localStorage.setItem('smart_school_user', JSON.stringify(teacher));
  globalThis.fetch = async url => {
    const path = String(url);
    requests.push(path);
    if (path === '/api/auth/me') return new Response(JSON.stringify({ data: teacher }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (path === '/api/students?school_id=41') return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (path === '/api/student-subjects?school_id=41&is_active=1') return new Response(JSON.stringify({ data: scopedAssignments }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (path === '/api/grade-settings?school_id=41') return new Response(JSON.stringify({ data: null }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    throw new Error(`Unexpected request ${path}`);
  };
  t.after(() => {
    globalThis.fetch = previousFetch;
    localStorage.clear();
    sessionStorage.clear();
  });

  const container = await render(t, createElement(AuthProvider, null, createElement(GradesPage)));
  await waitForContent(container, 'إدخال درجات شعبة');
  const sectionTab = [...container.querySelectorAll('button')].find(button => button.textContent.includes('إدخال درجات شعبة'));
  await act(async () => sectionTab.click());
  for (let attempt = 0; attempt < 50 && !requests.includes('/api/student-subjects?school_id=41&is_active=1'); attempt += 1) {
    await act(async () => new Promise(resolve => setTimeout(resolve, 10)));
  }

  let filters = [...container.querySelectorAll('select')];
  assert.deepEqual([...filters[0].options].map(option => option.textContent.trim()), ['— اختر —', 'الصف الأول']);
  assert.equal(filters[1].disabled, true);
  assert.equal(filters[2].disabled, true);

  await select(filters[0], '10');
  filters = [...container.querySelectorAll('select')];
  assert.deepEqual([...filters[1].options].map(option => option.textContent.trim()), ['— اختر —', 'أ', 'ب']);
  await select(filters[1], '101');
  filters = [...container.querySelectorAll('select')];
  assert.deepEqual([...filters[2].options].map(option => option.textContent.trim()), ['— اختر —', 'الحاسوب']);
  assert.equal(filters[2].disabled, false);

  assert.equal(requests.some(path => path.startsWith('/api/classes')), false);
  assert.equal(requests.some(path => path.startsWith('/api/sections')), false);
  assert.equal(requests.some(path => path.startsWith('/api/subjects')), false);
});

test('accountant student directory exposes only finance fields and builds filters from directory rows', async t => {
  const previousFetch = globalThis.fetch;
  const requests = [];
  const accountant = {
    id: 72,
    role_key: 'accountant',
    role_id: 6,
    school_id: 41,
    full_name: 'محاسب الاختبار',
    email: 'accountant@example.test',
    role_name: 'محاسب',
    school_name: 'مدرسة الاختبار',
  };
  const directoryRows = [
    { id: 1, school_id: 41, student_number: 'FIN-001', full_name: 'الطالب الأول', class_id: 10, class_name: 'الصف الأول', section_id: 101, section_name: 'أ', status: 'active' },
    { id: 2, school_id: 41, student_number: 'FIN-002', full_name: 'الطالب الثاني', class_id: 10, class_name: 'الصف الأول', section_id: 102, section_name: 'ب', status: 'active' },
    { id: 3, school_id: 41, student_number: 'FIN-003', full_name: 'الطالب الثالث', class_id: 20, class_name: 'الصف الثاني', section_id: 201, section_name: 'ج', status: 'active' },
  ];

  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('smart_school_token', 'accountant-test-token');
  localStorage.setItem('smart_school_user', JSON.stringify(accountant));
  globalThis.fetch = async url => {
    const path = String(url);
    requests.push(path);
    if (path === '/api/auth/me') {
      return new Response(JSON.stringify({ data: accountant }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (path === '/api/students?school_id=41') {
      return new Response(JSON.stringify({ data: directoryRows }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error(`Unexpected request ${path}`);
  };
  t.after(() => {
    globalThis.fetch = previousFetch;
    localStorage.clear();
    sessionStorage.clear();
  });

  const container = await render(t, createElement(
    MemoryRouter,
    null,
    createElement(AuthProvider, null, createElement(StudentsPage)),
  ));
  await waitForContent(container, 'FIN-003');

  assert.ok(container.textContent.includes('دليل الطلاب المالي'));
  assert.deepEqual(
    [...container.querySelectorAll('thead th')].map(cell => cell.textContent.trim()),
    ['رقم الطالب', 'الاسم', 'الصف', 'الشعبة', 'الحالة'],
  );
  assert.equal(container.textContent.includes('أنثى'), false, 'missing gender must not render as female');
  assert.equal(container.textContent.includes('ولي الأمر'), false);
  assert.equal(container.querySelectorAll('a[href^="/students/"]').length, 0);
  assert.equal(container.querySelectorAll('[title="عرض الملف"]').length, 0);
  assert.deepEqual(requests.sort(), ['/api/auth/me', '/api/students?school_id=41']);

  const filterButton = [...container.querySelectorAll('button')].find(button => button.textContent.trim() === 'التصفية');
  await act(async () => filterButton.click());
  const filters = [...container.querySelectorAll('select')];
  assert.equal(filters.length, 3, 'accountant has status, class, and section filters only');
  assert.deepEqual([...filters[1].options].map(option => option.textContent), ['كل الصفوف', 'الصف الأول', 'الصف الثاني']);

  await select(filters[1], '10');
  assert.ok(container.textContent.includes('FIN-001'));
  assert.ok(container.textContent.includes('FIN-002'));
  assert.equal(container.textContent.includes('FIN-003'), false);
  assert.deepEqual([...filters[2].options].map(option => option.textContent), ['كل الشعب', 'أ', 'ب']);

  await select(filters[2], '102');
  assert.equal(container.textContent.includes('FIN-001'), false);
  assert.ok(container.textContent.includes('FIN-002'));
});
