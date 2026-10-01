import assert from 'node:assert/strict';
import test, {after} from 'node:test';
import {fileURLToPath} from 'node:url';
import {Window} from 'happy-dom';
import {createServer} from 'vite';

const window = new Window({url: 'http://localhost'});
for (const key of ['window', 'document', 'HTMLElement', 'HTMLImageElement', 'Node', 'Event', 'MouseEvent']) {
  globalThis[key] = key === 'window' ? window : window[key];
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
const {TeacherWorkloadPreview} = await vite.ssrLoadModule('/src/modules/print/PrintTeacherWorkloadsPage.tsx');
const {TeacherWorkloadPrintButton} = await vite.ssrLoadModule('/src/modules/timetable/TeacherWorkloadPrintButton.tsx');
after(async () => {await vite.close(); await window.happyDOM.close();});

function fixture({schoolId = 3, yearId = 5, schoolName = 'ثانوية المنار ثنائية اللغة', principal = 'انور يونس عيدان', teachers} = {}) {
  const rows = teachers || [
    {employee_id: 3, employee_name: 'ابراهيم ناهض', weekly_periods: 23},
    {employee_id: 18, employee_name: 'امنة امجد', weekly_periods: 0},
    {employee_id: 19, employee_name: 'خديجة جلال', weekly_periods: 14},
  ];
  return {
    school: {id: schoolId, name: schoolName, name_en: null, province: null, logo_url: null, principal_name: principal},
    academic_year: {id: yearId, name: yearId === 5 ? '2026-2027' : '2027-2028'},
    document_settings: {official_book_layout: null, use_arabic_indic_digits: false, header_text: '', footer_text: ''},
    teachers: rows, total_weekly_periods: rows.reduce((total, row) => total + row.weekly_periods, 0),
  };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
}

async function mount(t, Component = TeacherWorkloadPreview, initialProps = {}) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const props = Component === TeacherWorkloadPreview
    ? {schoolId: 3, academicYearId: 5, loadSummary: async () => ({data: fixture()}), ...initialProps}
    : {...initialProps};
  await act(async () => root.render(createElement(Component, props)));
  t.after(async () => {await act(async () => root.unmount()); container.remove();});
  return {container, async render(patch) {
    Object.assign(props, patch);
    await act(async () => root.render(createElement(Component, props)));
  }};
}

const button = (u, text) => [...u.container.querySelectorAll('button')].find(node => node.textContent.includes(text));
const report = u => u.container.querySelector('.teacher-workload-document');
const teacherRow = (u, name) => [...u.container.querySelectorAll('.teacher-workload-table tbody tr')]
  .find(row => row.querySelector('th[scope="row"]')?.textContent === name);
const click = async element => {assert.ok(element, 'expected an available action'); await act(async () => element.click());};
function observePrint(t) {
  const oldPrint = window.print;
  const calls = [];
  window.print = () => calls.push({title: document.title, text: document.querySelector('.teacher-workload-document')?.textContent});
  t.after(() => {window.print = oldPrint;});
  return calls;
}

test('workload action opens the selected school and year in an isolated new tab and disables missing scope', async t => {
  const u = await mount(t, TeacherWorkloadPrintButton, {schoolId: 3, academicYearId: 5, enabled: true});
  const link = u.container.querySelector('a');
  const url = new URL(link.href);
  assert.equal(url.pathname, '/print/teacher-workloads');
  assert.deepEqual([...url.searchParams], [['school_id', '3'], ['academic_year_id', '5']]);
  assert.equal(link.target, '_blank');
  assert.ok(link.relList.contains('noopener'));
  assert.ok(link.relList.contains('noreferrer'));
  await u.render({academicYearId: null});
  assert.equal(u.container.querySelector('a'), null);
  assert.equal(button(u, 'كتاب أنصبة المدرّسين').disabled, true);
  await u.render({academicYearId: 5, enabled: false});
  assert.equal(u.container.querySelector('a'), null);
  assert.equal(button(u, 'كتاب أنصبة المدرّسين').disabled, true);
});

test('preview shows saved teacher counts including zero, total, and a real principal without fabricated verification identifiers', async t => {
  const calls = [];
  const summary = fixture();
  const u = await mount(t, TeacherWorkloadPreview, {loadSummary: async (...scope) => {calls.push(scope); return {data: summary};}});
  assert.deepEqual(calls, [[3, 5]]);
  assert.ok(report(u));
  for (const teacher of summary.teachers) {
    const row = teacherRow(u, teacher.employee_name);
    assert.ok(row, teacher.employee_name);
    assert.equal(row.querySelector('td:last-child').textContent, String(teacher.weekly_periods));
  }
  assert.equal(u.container.querySelector('.teacher-workload-total td').textContent, '37');
  assert.match(report(u).textContent, /2026-2027/);
  assert.match(u.container.querySelector('.teacher-workload-signature').textContent, /مدير المدرسة.*انور يونس عيدان/);
  assert.doesNotMatch(report(u).textContent, /مدير الثانوية|رمز التحقق|رقم التحقق|QR|OB-\d/i);
  assert.equal(report(u).querySelector('svg, canvas, a[href*="verify"]'), null);
  assert.match(u.container.querySelector('.teacher-workload-blank-number').textContent, /^[.\u2026\s]+$/u);
});

test('actual browser print is unavailable while loading and uses the loaded scope and title only', async t => {
  const pending = deferred(), calls = observePrint(t);
  const oldTitle = document.title;
  const u = await mount(t, TeacherWorkloadPreview, {loadSummary: () => pending.promise});
  assert.match(u.container.querySelector('[role="status"]').textContent, /جاري تحميل/);
  assert.equal(report(u), null);
  assert.equal(button(u, 'طباعة / حفظ PDF'), undefined);
  assert.equal(calls.length, 0);
  await act(async () => pending.resolve({data: fixture()}));
  assert.equal(calls.length, 0, 'loading a report must not print automatically');
  await click(button(u, 'طباعة / حفظ PDF'));
  assert.equal(calls.length, 1);
  assert.match(calls[0].title, /ثانوية المنار ثنائية اللغة.*2026-2027/);
  assert.match(calls[0].text, /ابراهيم ناهض/);
  assert.equal(document.title, oldTitle);
});

test('missing year does not fetch or expose a printable empty report', async t => {
  let calls = 0;
  const u = await mount(t, TeacherWorkloadPreview, {academicYearId: null, loadSummary: async () => {calls++; return {data: fixture()};}});
  assert.equal(calls, 0);
  assert.match(u.container.querySelector('[role="alert"]').textContent, /السنة الدراسية/);
  assert.equal(report(u), null);
  assert.equal(button(u, 'طباعة / حفظ PDF'), undefined);
});

for (const [label, loadSummary, error] of [
  ['API error', async () => ({error: 'لا يمكن قراءة الجدول الآن'}), /لا يمكن قراءة الجدول الآن/],
  ['rejected request', async () => {throw new Error('انقطع الاتصال');}, /انقطع الاتصال/],
  ['wrong school response', async () => ({data: fixture({schoolId: 9, schoolName: 'مدرسة لا تخص الطلب'})}), /تعذر مطابقة/],
  ['wrong year response', async () => ({data: fixture({yearId: 6})}), /تعذر مطابقة/],
]) {
  test(`${label} leaves an error and no valid print action`, async t => {
    const calls = observePrint(t);
    const u = await mount(t, TeacherWorkloadPreview, {loadSummary});
    assert.match(u.container.querySelector('[role="alert"]').textContent, error);
    assert.equal(report(u), null);
    assert.equal(button(u, 'طباعة / حفظ PDF'), undefined);
    assert.equal(calls.length, 0);
    assert.ok(button(u, 'إعادة المحاولة'));
  });
}

test('an empty active roster is an empty state, while a roster with zero lessons remains printable', async t => {
  const calls = observePrint(t);
  const u = await mount(t, TeacherWorkloadPreview, {loadSummary: async () => ({data: fixture({teachers: []})})});
  assert.match(u.container.querySelector('[role="status"]').textContent, /لا يوجد مدرسون/);
  assert.equal(report(u), null);
  assert.equal(button(u, 'طباعة / حفظ PDF'), undefined);
  assert.equal(calls.length, 0);
  await u.render({loadSummary: async () => ({data: fixture({teachers: [{employee_id: 18, employee_name: 'امنة امجد', weekly_periods: 0}]})})});
  assert.equal(teacherRow(u, 'امنة امجد').querySelector('td:last-child').textContent, '0');
  assert.equal(u.container.querySelector('.teacher-workload-total td').textContent, '0');
  await click(button(u, 'طباعة / حفظ PDF'));
  assert.equal(calls.length, 1);
});

for (const [label, newScope] of [
  ['school', {schoolId: 9, academicYearId: 5}],
  ['academic year', {schoolId: 3, academicYearId: 6}],
]) {
  test(`late response from the previous ${label} cannot replace or print the selected scope`, async t => {
    const stale = deferred(), fresh = deferred(), calls = observePrint(t);
    let requests = 0;
    const u = await mount(t, TeacherWorkloadPreview, {loadSummary: () => (++requests === 1 ? stale.promise : fresh.promise)});
    await u.render(newScope);
    assert.equal(report(u), null);
    const summary = fixture({schoolId: newScope.schoolId, yearId: newScope.academicYearId, schoolName: 'مدرسة النطاق الحالي', principal: 'مدير النطاق الحالي'});
    await act(async () => fresh.resolve({data: summary}));
    await act(async () => stale.resolve({data: fixture({schoolName: 'مدرسة الاستجابة القديمة', principal: 'مدير الاستجابة القديمة'})}));
    assert.match(report(u).textContent, /مدرسة النطاق الحالي/);
    assert.doesNotMatch(report(u).textContent, /مدرسة الاستجابة القديمة|مدير الاستجابة القديمة/);
    assert.match(u.container.querySelector('.teacher-workload-signature').textContent, /مدير النطاق الحالي/);
    await click(button(u, 'طباعة / حفظ PDF'));
    assert.equal(calls.length, 1);
    assert.match(calls[0].title, /مدرسة النطاق الحالي/);
    assert.ok(calls[0].title.includes(summary.academic_year.name));
  });
}

test('refresh clears the old report and print action immediately, then replaces counts from the new response', async t => {
  const refresh = deferred(), calls = observePrint(t);
  let requests = 0;
  const u = await mount(t, TeacherWorkloadPreview, {loadSummary: async () => (++requests === 1 ? {data: fixture()} : refresh.promise)});
  assert.ok(teacherRow(u, 'ابراهيم ناهض'));
  await click(button(u, 'تحديث الكشف'));
  assert.equal(requests, 2);
  assert.equal(report(u), null);
  assert.equal(button(u, 'طباعة / حفظ PDF'), undefined);
  assert.doesNotMatch(u.container.textContent, /ابراهيم ناهض/);
  assert.match(u.container.querySelector('[role="status"]').textContent, /جاري تحميل/);
  await act(async () => refresh.resolve({data: fixture({teachers: [{employee_id: 19, employee_name: 'خديجة جلال', weekly_periods: 9}]})}));
  assert.equal(teacherRow(u, 'ابراهيم ناهض'), undefined);
  assert.equal(u.container.querySelector('.teacher-workload-total td').textContent, '9');
  assert.equal(calls.length, 0);
});

test('a refresh failure cannot leave the previously loaded document available to print', async t => {
  let requests = 0;
  const u = await mount(t, TeacherWorkloadPreview, {loadSummary: async () => (++requests === 1 ? {data: fixture()} : {error: 'تعذر تحديث الكشف'})});
  await click(button(u, 'تحديث الكشف'));
  assert.match(u.container.querySelector('[role="alert"]').textContent, /تعذر تحديث الكشف/);
  assert.equal(report(u), null);
  assert.equal(button(u, 'طباعة / حفظ PDF'), undefined);
});

test('26 teachers fit one document page; longer rosters retain every row, numbering and one grand total', async t => {
  const teachers = Array.from({length: 26}, (_, index) => ({employee_id: index + 1, employee_name: `مدرس الاختبار ${index + 1}`, weekly_periods: index}));
  const u = await mount(t, TeacherWorkloadPreview, {loadSummary: async () => ({data: fixture({teachers})})});
  assert.equal(u.container.querySelectorAll('.teacher-workload-page').length, 1);
  const extended = [...teachers, ...Array.from({length: 4}, (_, index) => ({employee_id: index + 27, employee_name: `مدرس الاختبار ${index + 27}`, weekly_periods: 2}))];
  const summary = fixture({teachers: extended});
  await u.render({loadSummary: async () => ({data: summary})});
  assert.equal(u.container.querySelectorAll('.teacher-workload-page').length, 2);
  assert.equal(u.container.querySelectorAll('.teacher-workload-total').length, 1);
  assert.equal(u.container.querySelectorAll('.teacher-workload-table tbody tr:not(.teacher-workload-total)').length, 30);
  for (const [index, teacher] of extended.entries()) {
    const row = teacherRow(u, teacher.employee_name);
    assert.ok(row, teacher.employee_name);
    assert.equal(row.querySelector('td:first-child').textContent, String(index + 1));
  }
  assert.equal(u.container.querySelector('.teacher-workload-total td').textContent, String(summary.total_weekly_periods));
});

test('changing scope while a print waits for fonts cancels that old print request', async t => {
  const fonts = deferred(), calls = observePrint(t);
  const errors = t.mock.method(console, 'error', () => {});
  const descriptor = Object.getOwnPropertyDescriptor(document, 'fonts');
  Object.defineProperty(document, 'fonts', {configurable: true, value: {ready: fonts.promise}});
  t.after(() => {if (descriptor) Object.defineProperty(document, 'fonts', descriptor); else delete document.fonts;});
  const u = await mount(t);
  await click(button(u, 'طباعة / حفظ PDF'));
  assert.equal(calls.length, 0);
  await u.render({schoolId: 9, loadSummary: async () => ({data: fixture({schoolId: 9, schoolName: 'مدرسة جديدة'})})});
  await act(async () => fonts.resolve());
  assert.equal(calls.length, 0, 'the old request must not print a different school after asset loading');
  assert.equal(errors.mock.callCount(), 1);
  assert.match(u.container.querySelector('[role="alert"]').textContent, /تغير الكشف/);
});

test('refreshing the same school while print waits for fonts cancels the superseded document', async t => {
  const fonts = deferred(), calls = observePrint(t);
  const errors = t.mock.method(console, 'error', () => {});
  const descriptor = Object.getOwnPropertyDescriptor(document, 'fonts');
  Object.defineProperty(document, 'fonts', {configurable: true, value: {ready: fonts.promise}});
  t.after(() => {if (descriptor) Object.defineProperty(document, 'fonts', descriptor); else delete document.fonts;});
  let requests = 0;
  const u = await mount(t, TeacherWorkloadPreview, {loadSummary: async () => ({data: ++requests === 1 ? fixture() : fixture({principal: 'مدير محدث', teachers: [{employee_id: 19, employee_name: 'خديجة جلال', weekly_periods: 9}]})})});
  await click(button(u, 'طباعة / حفظ PDF'));
  assert.equal(calls.length, 0);
  await click(button(u, 'تحديث الكشف'));
  assert.equal(u.container.querySelector('.teacher-workload-total td').textContent, '9');
  await act(async () => fonts.resolve());
  assert.equal(calls.length, 0);
  assert.equal(errors.mock.callCount(), 1);
  assert.match(u.container.querySelector('[role="alert"]').textContent, /تغير الكشف/);
  await click(button(u, 'طباعة / حفظ PDF'));
  assert.equal(calls.length, 1, 'a fresh click prints the refreshed document');
  assert.match(calls[0].text, /مدير محدث/);
  assert.doesNotMatch(calls[0].text, /انور يونس عيدان/);
});
