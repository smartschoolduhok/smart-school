import assert from 'node:assert/strict';
import test, {after} from 'node:test';
import {fileURLToPath} from 'node:url';
import {Window} from 'happy-dom';
import {createServer} from 'vite';

const window = new Window({url: 'http://localhost'});
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'HTMLTextAreaElement', 'HTMLImageElement', 'Node', 'Event', 'MouseEvent', 'localStorage', 'sessionStorage']) {
  Object.defineProperty(globalThis, key, {configurable: true, value: key === 'window' ? window : window[key]});
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const {createElement, act} = await import('react');
const {createRoot} = await import('react-dom/client');
const vite = await createServer({
  root: fileURLToPath(new URL('..', import.meta.url)), configFile: false, appType: 'custom',
  optimizeDeps: {noDiscovery: true, include: []}, esbuild: {jsx: 'automatic'},
  ssr: {noExternal: ['react-router-dom', 'react-router'], resolve: {conditions: ['module', 'browser', 'development']}},
  server: {middlewareMode: true, hmr: false},
});
const {default: OfficialBooksPage} = await vite.ssrLoadModule('/src/modules/officialBooks/OfficialBooksPage.tsx');
const {AuthProvider} = await vite.ssrLoadModule('/src/hooks/useAuth.tsx');
const {todayOfficialBookDate, formatOfficialBookDisplayDate} = await vite.ssrLoadModule('/src/lib/officialBookDates.ts');
const {systemAdminSchoolSessionStore} = await vite.ssrLoadModule('/src/lib/systemAdminSchoolSession.ts');
after(async () => {await vite.close(); await window.happyDOM.close();});

const template = {title: 'كتاب إداري', body_text: 'التاريخ {{date}}', paper_size: 'A4', requires_student: false, requires_employee: false, status: 'active', fields: []};
const createdAt = Date.UTC(2026, 9, 9, 12) / 1_000;
const record = (documentDate = '2026-09-15') => ({id: 12, school_id: 1, title: 'كتاب صادر', body_text: 'نص', paper_size: 'A4', status: 'active', document_number: 'مدرسة/١٢', document_date: documentDate, created_at: createdAt, verification_token: 'test-token'});
const response = body => new Response(JSON.stringify(body), {headers: {'Content-Type': 'application/json'}});

async function mount(t, {admin = false, issue = async body => record(body.document_date)} = {}) {
  localStorage.clear(); sessionStorage.clear(); systemAdminSchoolSessionStore.setSchoolId(null);
  const writes = [];
  globalThis.fetch = async (url, options = {}) => {
    const path = String(url).split('?')[0];
    if (path === '/api/auth/me') return response({data: {id: 1, school_id: admin ? null : 1, role_key: admin ? 'system_admin' : 'school_owner', full_name: 'اختبار'}, csrf_token: 'a'.repeat(64)});
    if (path === '/api/schools') return response({data: [1, 2].map(id => ({id, name: `مدرسة ${id}`, status: 'active'}))});
    if (path === '/api/official-book-templates') return response({data: [{...template, id: 8}], meta: {presets: [{...template, source: 'builtin', preset_key: 'administrative'}, {...template, source: 'builtin', preset_key: 'student-acceptance-no-objection', title: 'عدم ممانعة'}]}});
    if (path === '/api/students' || path === '/api/employees') return response({data: []});
    if (path === '/api/official-books') {
      if (options.method === 'POST') {
        const body = JSON.parse(options.body); writes.push(body);
        return response({data: await issue(body)});
      }
      return response({data: [record()]});
    }
    if (path === '/api/verify/official-book/test-token') {
      const {created_at, ...verified} = record();
      return response({data: {...verified, generated_at: created_at, valid: true, school_name: 'مدرسة الاختبار'}});
    }
    throw new Error(`Unexpected request: ${path}`);
  };
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(createElement(AuthProvider, null, createElement(OfficialBooksPage))));
  t.after(async () => {await act(async () => root.unmount()); container.remove();});
  return {container, writes};
}
const button = (ui, label) => {
  const element = [...ui.container.querySelectorAll('button')].find(node => node.textContent === label);
  assert.ok(element, label); return element;
};
const dateInput = ui => ui.container.querySelector('[aria-label="تاريخ الكتاب"]');
const numberInput = ui => ui.container.querySelector('[aria-label="العدد (رقم الكتاب)"]');
const templateInput = ui => [...ui.container.querySelectorAll('select')].find(node => node.querySelector('optgroup'));
async function click(element) {await act(async () => element.click());}
async function input(element, value) {
  assert.ok(element);
  await act(async () => {
    const prototype = element.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
    element.dispatchEvent(new window.Event(element.tagName === 'SELECT' ? 'change' : 'input', {bubbles: true}));
  });
}
async function generateTab(ui, key = 'preset:administrative') {
  await click(button(ui, 'إنشاء كتاب رسمي'));
  await input(templateInput(ui), key);
}

test('all template types send the school-selected issue date and preserve school numbering independently of system creation time', async t => {
  const ui = await mount(t);
  await generateTab(ui);
  assert.equal(dateInput(ui).value, todayOfficialBookDate());
  for (const key of ['preset:administrative', 'preset:student-acceptance-no-objection', 'school:8']) {
    await input(templateInput(ui), key);
    await input(dateInput(ui), '2026-09-15');
    await input(numberInput(ui), '  مدرسة/١٢  ');
    await click(button(ui, 'إنشاء الكتاب'));
    assert.equal(ui.writes.at(-1).document_date, '2026-09-15');
    assert.equal(ui.writes.at(-1).document_number, 'مدرسة/١٢');
    assert.equal(ui.writes.at(-1).school_id, 1);
    assert.ok(ui.container.textContent.includes(`تاريخ الكتاب: ${formatOfficialBookDisplayDate(record())}`));
    assert.ok(ui.container.textContent.includes(`وقت الإنشاء في النظام: ${new Date(createdAt * 1_000).toLocaleString('ar-IQ', {timeZone: 'Asia/Baghdad'})}`));
  }
  assert.equal(ui.writes.length, 3);
});

test('blank issue date blocks issuance and changing templates resets the date and prior issue result', async t => {
  const ui = await mount(t); await generateTab(ui);
  await input(dateInput(ui), ''); await click(button(ui, 'إنشاء الكتاب'));
  assert.equal(ui.writes.length, 0);
  assert.ok(ui.container.querySelector('[role="alert"]'));
  await input(dateInput(ui), '2026-09-15'); await click(button(ui, 'إنشاء الكتاب'));
  assert.match(ui.container.textContent, /تم إنشاء الكتاب بنجاح/);
  await input(templateInput(ui), 'school:8');
  assert.equal(dateInput(ui).value, todayOfficialBookDate());
  assert.doesNotMatch(ui.container.textContent, /تم إنشاء الكتاب بنجاح/);
});

test('school change clears the chosen date and ignores a late issue response from the previous school', async t => {
  let resolveIssue;
  const pendingIssue = new Promise(resolve => {resolveIssue = resolve;});
  const ui = await mount(t, {admin: true, issue: () => pendingIssue});
  await input(ui.container.querySelector('#system-admin-target-school'), '1');
  await generateTab(ui); await input(dateInput(ui), '2026-09-15');
  await click(button(ui, 'إنشاء الكتاب'));
  await input(ui.container.querySelector('#system-admin-target-school'), '2');
  assert.equal(dateInput(ui), null);
  await input(templateInput(ui), 'school:8');
  assert.equal(dateInput(ui).value, todayOfficialBookDate());
  await act(async () => resolveIssue(record()));
  assert.doesNotMatch(ui.container.textContent, /تم إنشاء الكتاب بنجاح/);
});

test('history and verification distinguish the immutable issue date from the recorded system timestamp', async t => {
  const ui = await mount(t);
  const dateText = `تاريخ الكتاب: ${formatOfficialBookDisplayDate(record())}`;
  const createdText = `وقت الإنشاء في النظام: ${new Date(createdAt * 1_000).toLocaleString('ar-IQ', {timeZone: 'Asia/Baghdad'})}`;
  assert.ok(ui.container.textContent.includes(dateText));
  assert.ok(ui.container.textContent.includes(createdText));
  await click(button(ui, 'التحقق من كتاب'));
  await input(ui.container.querySelector('input'), 'test-token');
  await click(button(ui, 'تحقق'));
  assert.ok(ui.container.textContent.includes(dateText));
  assert.ok(ui.container.textContent.includes(createdText));
});
