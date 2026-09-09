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
const { AuthProvider } = await vite.ssrLoadModule('/src/hooks/useAuth.tsx');
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
  globalThis.fetch = async url => {
    if (String(url).endsWith('/api/auth/login')) return new Response(JSON.stringify({ data: { token: 'generated-token', user } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
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
    return { local: localStorage.getItem('smart_school_token'), session: sessionStorage.getItem('smart_school_token') };
  }

  assert.deepEqual(await login(false), { local: null, session: 'generated-token' });
  assert.deepEqual(await login(true), { local: 'generated-token', session: null });
});

test('daily workflows keep rare actions out of the primary tab rows', () => {
  const fees = readFileSync(join(root, 'src/modules/fees/FeesPage.tsx'), 'utf8');
  const grades = readFileSync(join(root, 'src/modules/grades/GradesPage.tsx'), 'utf8');
  const timetable = readFileSync(join(root, 'src/modules/timetable/TimetablePage.tsx'), 'utf8');
  const settings = readFileSync(join(root, 'src/modules/settings/SettingsPage.tsx'), 'utf8');

  const feePrimaryTabs = fees.slice(fees.indexOf('const tabs:'), fees.indexOf('function openPaymentForFee'));
  for (const label of ['قائمة الأقساط', 'المدفوعات', 'الإيصالات']) assert.ok(feePrimaryTabs.includes(label), label);
  for (const contextual of ['إضافة قسط', 'اختبار التحقق']) assert.equal(feePrimaryTabs.includes(contextual), false, contextual);
  assert.match(fees, /openPaymentForFee\(fee\)/);
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
