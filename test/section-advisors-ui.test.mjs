import assert from 'node:assert/strict';
import test, {after} from 'node:test';
import {fileURLToPath} from 'node:url';
import {Window} from 'happy-dom';
import {createServer} from 'vite';

const window = new Window({url: 'http://localhost'});
for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'HTMLImageElement', 'Node', 'Event', 'MouseEvent', 'localStorage', 'sessionStorage']) {
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
const {SectionAdvisorsManager} = await vite.ssrLoadModule('/src/modules/advisors/SectionAdvisorsPage.tsx');
const {SectionAdvisorsPreview} = await vite.ssrLoadModule('/src/modules/print/PrintSectionAdvisorsPage.tsx');
const {getVisibleNavigationItems} = await vite.ssrLoadModule('/src/components/Sidebar.tsx');
after(async () => {await vite.close(); await window.happyDOM.close();});

function year(schoolId = 1, id = 1) {
  return {id, school_id: schoolId, name: '2026-2027', starts_at: '2026-09-01', ends_at: '2027-06-01', is_active: 1, created_at: 0};
}
function fixture({schoolId = 1, yearId = 1, count = 2, assigned = true, confirmed = false} = {}) {
  return {
    school: {id: schoolId, name: `مدرسة الاختبار ${schoolId}`, name_en: null, province: null, logo_url: null, principal_name: `مدير الاختبار ${schoolId}`},
    academic_year: {id: yearId, name: '2026-2027'},
    document_settings: {official_book_layout: null, use_arabic_indic_digits: false, header_text: '', footer_text: ''},
    school_days: [0, 1, 2, 3, 4],
    placements: Array.from({length: count}, (_, i) => ({
      class_id: i + 1, class_name: `الصف ${i + 1}`, stage_name: 'متوسط', section_id: 100 + i, section_name: 'أ',
      assignment: assigned ? {employee_id: 10 + i, employee_name: `المدرس ${i + 1}`, attendance_confirmed: confirmed, notes: 'ملاحظة إدارية خاصة لا تطبع', version: 1} : null,
      candidates: [{employee_id: 10 + i, employee_name: `المدرس ${i + 1}`, subjects: ['الرياضيات'], section_weekly_periods: 4, total_weekly_periods: 16, scheduled_days: i === 0 ? [0, 1, 2, 3, 4] : [0, 1, 2, 4]}],
    })),
  };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
}
async function mount(t, Component = SectionAdvisorsPreview, overrides = {}) {
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  const props = Component === SectionAdvisorsPreview
    ? {schoolId: 1, academicYearId: 1, loadAdvisors: async () => ({data: fixture()}), ...overrides}
    : {schoolId: 1, loadYears: async school => ({data: [year(school)]}), loadAdvisors: async () => ({data: fixture()}), ...overrides};
  await act(async () => root.render(createElement(Component, props)));
  t.after(async () => {await act(async () => root.unmount()); container.remove();});
  return {container, async render(patch) {Object.assign(props, patch); await act(async () => root.render(createElement(Component, props)));}};
}
const button = (u, text) => [...u.container.querySelectorAll('button')].find(el => el.textContent.includes(text));
const row = (u, index = 0) => u.container.querySelector(`[data-testid="advisor-row-${index + 1}-${100 + index}"]`);
const printLink = u => u.container.querySelector('a[href*="/print/section-advisors"]');
const report = u => u.container.querySelector('.section-advisors-document');
async function click(el) {assert.ok(el, 'expected action'); await act(async () => el.click());}
async function setValue(el, value) {
  assert.ok(el, 'expected input');
  await act(async () => {
    const prototype = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(el, value);
    el.dispatchEvent(new window.Event(el.tagName === 'SELECT' ? 'change' : 'input', {bubbles: true}));
  });
}
function observePrint(t) {
  const old = window.print, calls = [];
  window.print = () => calls.push({title: document.title, text: document.querySelector('.section-advisors-document')?.textContent});
  t.after(() => {window.print = old;}); return calls;
}

test('advisor navigation is restricted to academic management roles', () => {
  for (const role of ['system_admin', 'school_owner', 'principal', 'vice_principal', 'registrar']) assert.ok(getVisibleNavigationItems(role).some(item => item.path === '/section-advisors'));
  for (const role of ['teacher', 'accountant', 'parent', null]) assert.equal(getVisibleNavigationItems(role).some(item => item.path === '/section-advisors'), false);
});

test('manager lists only each placement actual teaching candidates and never infers confirmed attendance', async t => {
  const u = await mount(t, SectionAdvisorsManager);
  assert.ok(row(u));
  assert.deepEqual([...row(u).querySelectorAll('select option')].filter(el => el.value).map(el => el.value), ['10']);
  assert.equal(row(u).querySelector('input[type="checkbox"]').checked, false);
  assert.match(row(u).textContent, /الرياضيات/);
  assert.ok(printLink(u), 'unconfirmed attendance warns but does not invalidate explicitly selected advisors');
});

test('manager missing school never queries the roster', async t => {
  let calls = 0;
  const u = await mount(t, SectionAdvisorsManager, {schoolId: null, loadYears: async () => {calls++; return {data: []};}, loadAdvisors: async () => {calls++; return {data: fixture()};}});
  assert.equal(calls, 0); assert.equal(row(u), null); assert.equal(printLink(u), null);
});

test('manager saves chosen assignment with scope and revision and leaves other row drafts untouched', async t => {
  const data = fixture({assigned: false}), calls = [];
  const saveAdvisor = async body => {
    calls.push(body);
    return {data: {...body, assignment: {employee_id: body.employee_id, employee_name: `المدرس ${body.class_id}`, attendance_confirmed: body.attendance_confirmed, notes: body.notes, version: 1}}};
  };
  const u = await mount(t, SectionAdvisorsManager, {loadAdvisors: async () => ({data}), saveAdvisor});
  assert.equal(printLink(u), null);
  await setValue(row(u).querySelector('select'), '10');
  await setValue(row(u, 1).querySelector('select'), '11');
  await setValue(row(u).querySelector('textarea'), 'تمت المراجعة');
  await click(row(u).querySelector('input[type="checkbox"]'));
  await click(row(u).querySelector('button'));
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {school_id: 1, academic_year_id: 1, class_id: 1, section_id: 100, employee_id: 10, attendance_confirmed: true, notes: 'تمت المراجعة', expected_version: 0});
  assert.equal(row(u, 1).querySelector('select').value, '11');
  assert.equal(printLink(u), null, 'remaining unsaved row must not be represented as printable');
});

test('unsaved changes disable the book action and failed save preserves the user draft', async t => {
  const u = await mount(t, SectionAdvisorsManager, {saveAdvisor: async () => ({error: 'تعارض تعديل؛ أعد تحميل البيانات'})});
  assert.ok(printLink(u));
  await setValue(row(u).querySelector('textarea'), 'مسودة مهمة');
  assert.equal(printLink(u), null);
  await click(row(u).querySelector('button'));
  assert.match(u.container.textContent, /تعارض تعديل/);
  assert.equal(row(u).querySelector('textarea').value, 'مسودة مهمة');
  assert.equal(printLink(u), null);
});

test('manager does not display a late response from the previous school', async t => {
  const old = deferred();
  const u = await mount(t, SectionAdvisorsManager, {loadAdvisors: school => school === 1 ? old.promise : Promise.resolve({data: fixture({schoolId: 2})})});
  await u.render({schoolId: 2});
  await act(async () => old.resolve({data: fixture()}));
  assert.ok(printLink(u));
  assert.equal(new URL(printLink(u).href).searchParams.get('school_id'), '2');
});

test('preview renders a complete roster and school-specific branding without administrative notes', async t => {
  const u = await mount(t), calls = observePrint(t);
  assert.ok(report(u));
  assert.match(report(u).textContent, /مدرسة الاختبار 1/);
  assert.match(report(u).textContent, /مدير الاختبار 1/);
  assert.match(report(u).textContent, /المدرس 1/);
  assert.match(report(u).textContent, /المدرس 2/);
  assert.doesNotMatch(report(u).textContent, /ملاحظة إدارية خاصة|QR|رمز التحقق/);
  assert.equal(calls.length, 0);
  await click(button(u, 'طباعة / حفظ PDF'));
  assert.equal(calls.length, 1); assert.match(calls[0].text, /المدرس 2/);
});

for (const [name, mutate] of [
  ['missing assignment', data => {data.placements[0].assignment = null;}],
  ['teacher no longer teaches', data => {data.placements[0].candidates = [];}],
  ['empty roster', data => {data.placements = [];}],
]) test(`preview rejects ${name} instead of printing an incomplete official order`, async t => {
  const data = fixture(); mutate(data);
  const u = await mount(t, SectionAdvisorsPreview, {loadAdvisors: async () => ({data})});
  assert.equal(report(u), null); assert.equal(button(u, 'طباعة / حفظ PDF'), undefined);
});

for (const [name, loadAdvisors] of [
  ['other school', async () => ({data: fixture({schoolId: 2})})],
  ['other year', async () => ({data: fixture({yearId: 2})})],
  ['request error', async () => ({error: 'تعذر قراءة بيانات المرشدين'})],
]) test(`preview protects against ${name}`, async t => {
  const u = await mount(t, SectionAdvisorsPreview, {loadAdvisors});
  assert.equal(report(u), null); assert.ok(u.container.querySelector('[role="alert"]'));
  assert.equal(button(u, 'طباعة / حفظ PDF'), undefined);
});

test('preview school switch discards superseded response', async t => {
  const old = deferred();
  const u = await mount(t, SectionAdvisorsPreview, {loadAdvisors: school => school === 1 ? old.promise : Promise.resolve({data: fixture({schoolId: 2})})});
  await u.render({schoolId: 2});
  await act(async () => old.resolve({data: fixture()}));
  assert.match(report(u).textContent, /مدرسة الاختبار 2/);
  assert.doesNotMatch(report(u).textContent, /مدرسة الاختبار 1/);
});

test('preview retains all names across multipage rosters with continuous numbering', async t => {
  const data = fixture({count: 43});
  const u = await mount(t, SectionAdvisorsPreview, {loadAdvisors: async () => ({data})});
  const tables = report(u).querySelectorAll('table');
  assert.ok(tables.length > 1);
  const rows = [...report(u).querySelectorAll('tbody tr')];
  assert.equal(rows.length, 43);
  for (const [i, r] of rows.entries()) {
    assert.equal(r.querySelector('td').textContent.trim(), String(i + 1));
    assert.ok(r.textContent.includes(`المدرس ${i + 1}`));
  }
});

test('print waiting for fonts is cancelled when the school changes', async t => {
  const pending = deferred(), calls = observePrint(t);
  t.mock.method(console, 'error', () => {});
  const descriptor = Object.getOwnPropertyDescriptor(document, 'fonts');
  Object.defineProperty(document, 'fonts', {configurable: true, value: {ready: pending.promise}});
  t.after(() => {if (descriptor) Object.defineProperty(document, 'fonts', descriptor); else delete document.fonts;});
  const u = await mount(t);
  await click(button(u, 'طباعة / حفظ PDF'));
  await u.render({schoolId: 2, loadAdvisors: async () => ({data: fixture({schoolId: 2})})});
  await act(async () => pending.resolve());
  assert.equal(calls.length, 0);
});

test('date and optional number update the letter and survive a data refresh', async t => {
  const u = await mount(t);
  await setValue(u.container.querySelector('input[type="date"]'), '2026-10-04');
  await setValue(u.container.querySelector('input[aria-label="رقم الكتاب"]'), '123/أ');
  assert.match(report(u).textContent, /04\/10\/2026/);
  assert.match(report(u).textContent, /123\/أ/);
  await click(button(u, 'تحديث الكتاب'));
  assert.match(report(u).textContent, /04\/10\/2026/);
  assert.match(report(u).textContent, /123\/أ/);
});

test('print waiting for fonts is cancelled when the document date changes', async t => {
  const pending = deferred(), calls = observePrint(t);
  t.mock.method(console, 'error', () => {});
  const descriptor = Object.getOwnPropertyDescriptor(document, 'fonts');
  Object.defineProperty(document, 'fonts', {configurable: true, value: {ready: pending.promise}});
  t.after(() => {if (descriptor) Object.defineProperty(document, 'fonts', descriptor); else delete document.fonts;});
  const u = await mount(t);
  await click(button(u, 'طباعة / حفظ PDF'));
  await setValue(u.container.querySelector('input[type="date"]'), '2026-10-04');
  await act(async () => pending.resolve());
  assert.equal(calls.length, 0);
  assert.match(u.container.textContent, /تغير الكتاب أثناء تجهيز الطباعة/);
});
