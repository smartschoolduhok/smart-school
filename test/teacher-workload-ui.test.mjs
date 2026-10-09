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
const {TeacherWorkloadExtrasEditor} = await vite.ssrLoadModule('/src/modules/print/TeacherWorkloadExtrasEditor.tsx');
const {TeacherWorkloadPrintButton} = await vite.ssrLoadModule('/src/modules/timetable/TeacherWorkloadPrintButton.tsx');
const {paginateWorkloadDetails} = await vite.ssrLoadModule('/src/components/officialBooks/TeacherWorkloadDocument.tsx');
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
    teachers: rows.map(row => ({...row, breakdown: row.breakdown ?? (row.weekly_periods ? [{class_id: 1, class_name: 'الأول المتوسط', section_id: 2, section_name: 'أ', subject_id: 3, subject_name: 'الرياضيات', weekly_periods: row.weekly_periods}] : [])})), total_weekly_periods: rows.reduce((total, row) => total + row.weekly_periods, 0),
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

test('separate detailed action preserves the selected school and year and chooses the detailed preview', async t => {
  const u = await mount(t, TeacherWorkloadPrintButton, {schoolId: 3, academicYearId: 5, enabled: true, detailed: true});
  const link = u.container.querySelector('a');
  assert.match(link.textContent, /بالتفصيل/);
  assert.deepEqual([...new URL(link.href).searchParams], [['school_id', '3'], ['academic_year_id', '5'], ['mode', 'detailed']]);
  assert.equal(link.target, '_blank');
  await u.render({academicYearId: null});
  assert.equal(u.container.querySelector('a'), null);
  assert.equal(button(u, 'بالتفصيل').disabled, true);
});

test('detailed preview shows each class, section and subject, reconciled teacher subtotals and one grand total including zero teachers', async t => {
  const summary = fixture({teachers: [
    {employee_id: 3, employee_name: 'ابراهيم ناهض', weekly_periods: 9, breakdown: [
      {class_id: 1, class_name: 'الأول المتوسط', section_id: 2, section_name: 'أ', subject_id: 3, subject_name: 'الرياضيات', weekly_periods: 4},
      {class_id: 2, class_name: 'الثاني المتوسط', section_id: 3, section_name: 'ب', subject_id: 4, subject_name: 'الفيزياء', weekly_periods: 5},
    ]},
    {employee_id: 18, employee_name: 'امنة امجد', weekly_periods: 0, breakdown: []},
  ]});
  const u = await mount(t, TeacherWorkloadPreview, {initialMode: 'detailed', loadSummary: async () => ({data: summary})});
  assert.equal(report(u).dataset.mode, 'detailed');
  const assignments = [...u.container.querySelectorAll('.teacher-workload-assignment')];
  assert.deepEqual(assignments.map(row => [...row.cells].map(cell => cell.textContent)), [
    ['الأول المتوسط', 'أ', 'الرياضيات', '4'], ['الثاني المتوسط', 'ب', 'الفيزياء', '5'],
  ]);
  assert.deepEqual([...u.container.querySelectorAll('.teacher-workload-subtotal td')].map(cell => cell.textContent), ['9', '0']);
  assert.equal(u.container.querySelectorAll('.teacher-workload-total').length, 1);
  assert.equal(u.container.querySelector('.teacher-workload-total td').textContent, '9');
  assert.match(report(u).textContent, /لا توجد حصص/);
  await click(button(u, 'ملخّص الحصص'));
  assert.equal(report(u).dataset.mode, 'summary');
  assert.equal(teacherRow(u, 'ابراهيم ناهض').querySelector('td:last-child').textContent, '9');
  await click(button(u, 'بالتفصيل حسب'));
  assert.equal(u.container.querySelectorAll('.teacher-workload-assignment').length, 2);
});

test('many assignments retain every detail, repeat teacher identity on continuation and keep final assignment with subtotal', async t => {
  const breakdown = Array.from({length: 80}, (_, index) => ({class_id: index + 1, class_name: `الصف ${index + 1}`, section_id: index + 1, section_name: 'أ', subject_id: 1, subject_name: 'الرياضيات', weekly_periods: index % 3 + 1}));
  const count = breakdown.reduce((total, row) => total + row.weekly_periods, 0);
  const u = await mount(t, TeacherWorkloadPreview, {initialMode: 'detailed', loadSummary: async () => ({data: fixture({teachers: [{employee_id: 3, employee_name: 'مدرس متعدد الصفوف', weekly_periods: count, breakdown}]})})});
  const pages = [...u.container.querySelectorAll('.teacher-workload-page')];
  assert.ok(pages.length > 2);
  assert.equal(u.container.querySelectorAll('.teacher-workload-assignment').length, 80);
  assert.equal(u.container.querySelectorAll('.teacher-workload-subtotal').length, 1);
  assert.equal(u.container.querySelectorAll('.teacher-workload-total').length, 1);
  for (const [index, page] of pages.entries()) {
    assert.match(page.querySelector('tbody tr:first-child').textContent, /مدرس متعدد الصفوف/);
    if (index) assert.match(page.querySelector('tbody tr:first-child').textContent, /تابع/);
  }
  const subtotal = u.container.querySelector('.teacher-workload-subtotal');
  assert.ok(subtotal.previousElementSibling.classList.contains('teacher-workload-assignment'));
  assert.equal(subtotal.querySelector('td').textContent, String(count));
  assert.equal(u.container.querySelector('.teacher-workload-total td').textContent, String(count));
  assert.equal(u.container.querySelector('[rowspan]'), null);
});

test('pagination uses measured row heights and preserves compact groups and subtotal adjacency', () => {
  const first = {heading: {key: 'a', kind: 'teacher'}, assignments: [{key: 'a1', kind: 'assignment'}], tail: [{key: 'at', kind: 'subtotal'}]};
  const long = {heading: {key: 'b', kind: 'teacher'}, assignments: [{key: 'b1', kind: 'assignment'}, {key: 'b2', kind: 'assignment'}, {key: 'b3', kind: 'assignment'}], tail: [{key: 'bt', kind: 'subtotal'}, {key: 'total', kind: 'total'}]};
  const heights = new Map([['a', 20], ['a1', 45], ['at', 20], ['b', 25], ['b1', 110], ['b2', 90], ['b3', 60], ['bt', 20], ['total', 20]]);
  const pages = paginateWorkloadDetails([first, long], heights, 180);
  assert.deepEqual(pages.map(page => page.map(row => row.key)), [['a', 'a1', 'at'], ['b', 'b1'], ['b', 'b2'], ['b', 'b3', 'bt', 'total']]);
  assert.ok(pages.every(page => page.reduce((total, row) => total + heights.get(row.key), 0) <= 180));
  assert.ok(pages[2][0].continued && pages[3][0].continued);
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

test('changing print mode while fonts load cancels the original request even when switched back', async t => {
  const fonts = deferred(), calls = observePrint(t);
  const errors = t.mock.method(console, 'error', () => {});
  const descriptor = Object.getOwnPropertyDescriptor(document, 'fonts');
  Object.defineProperty(document, 'fonts', {configurable: true, value: {ready: fonts.promise}});
  t.after(() => {if (descriptor) Object.defineProperty(document, 'fonts', descriptor); else delete document.fonts;});
  const u = await mount(t);
  await click(button(u, 'طباعة / حفظ PDF'));
  await click(button(u, 'بالتفصيل حسب'));
  await click(button(u, 'ملخّص الحصص'));
  await act(async () => fonts.resolve());
  assert.equal(calls.length, 0);
  assert.equal(errors.mock.callCount(), 1);
  assert.match(u.container.querySelector('[role="alert"]').textContent, /تغير الكشف/);
  await click(button(u, 'بالتفصيل حسب'));
  await click(button(u, 'طباعة / حفظ PDF'));
  assert.equal(calls.length, 1);
  assert.match(calls[0].title, /بالتفصيل/);
  assert.match(calls[0].text, /الأول المتوسط.*الرياضيات/);
});

test('missing or inconsistent detail data cannot print a misleading detailed report and summary remains available', async t => {
  const summary = fixture();
  delete summary.teachers[0].breakdown;
  const u = await mount(t, TeacherWorkloadPreview, {initialMode: 'detailed', loadSummary: async () => ({data: summary})});
  assert.match(u.container.querySelector('[role="alert"]').textContent, /تفاصيل الحصص غير مكتملة/);
  assert.equal(report(u), null);
  assert.equal(button(u, 'طباعة / حفظ PDF'), undefined);
  await click(button(u, 'ملخّص الحصص'));
  assert.equal(report(u).dataset.mode, 'summary');
  assert.ok(button(u, 'طباعة / حفظ PDF'));
});


test('reports separate scheduled and report-only totals and detailed extras never invent a class or section',async t=>{
 const extra={id:8,school_id:3,academic_year_id:5,employee_id:9,subject_name:'التربية المسيحية',weekly_periods:5,version:2};
 const summary=fixture({teachers:[{employee_id:9,employee_name:'مريم',weekly_periods:18,extra_weekly_periods:5,report_weekly_periods:23,extras:[extra]},
  {employee_id:null,teacher_key:'placeholder:English',employee_name:'مدرس الإنكليزي',weekly_periods:19},
  {employee_id:null,teacher_key:'placeholder:Arabic',employee_name:'مدرس العربي والإسلامية',weekly_periods:30}]});
 Object.assign(summary,{total_scheduled_weekly_periods:67,total_extra_weekly_periods:5,total_report_weekly_periods:72});
 const u=await mount(t,TeacherWorkloadPreview,{loadSummary:async()=>({data:summary})});
 assert.equal(teacherRow(u,'مريم').querySelector('td:last-child').textContent,'23');
 assert.deepEqual([...teacherRow(u,'مريم').querySelectorAll('td')].map(e=>e.textContent),['1','18','5','23']);
 assert.match(report(u).textContent,/خارج الجدول/);
 const options=[...u.container.querySelectorAll('select[aria-label="مدرس النصاب الإضافي"] option')];assert.equal(options.length,2);assert.equal(options[1].value,'9');
 await click(button(u,'بالتفصيل حسب'));
 const extraRow=u.container.querySelector('.teacher-workload-extra');assert.deepEqual([...extraRow.cells].map(e=>e.textContent),['خارج الجدول','التربية المسيحية','5']);assert.equal(extraRow.cells[0].colSpan,2);
 assert.match(u.container.querySelector('.teacher-workload-subtotal').textContent,/مجدول: 18.*خارج الجدول: 5/);
 assert.equal(u.container.querySelector('.teacher-workload-total td').textContent,'72');
 assert.equal(u.container.querySelectorAll('.teacher-workload-teacher').length,3);
});

test('extras editor sends scoped CAS updates/deletes, blocks placeholders, and refreshes only after successful mutation',async t=>{
 const extra={id:8,school_id:3,academic_year_id:5,employee_id:9,subject_name:'التربية المسيحية',weekly_periods:5,version:7};
 const summary=fixture({teachers:[{employee_id:9,employee_name:'مريم',weekly_periods:18,extras:[extra]},{employee_id:null,teacher_key:'placeholder:English',employee_name:'مدرس الإنكليزي',weekly_periods:19}]});
 const calls=[],busy=[];let refreshed=0,saveResult={data:{...extra,version:8}};
 const u=await mount(t,TeacherWorkloadExtrasEditor,{summary,onChanged:()=>{refreshed++},onBusyChange:b=>busy.push(b),save:async(...args)=>{calls.push(args);return saveResult;},remove:async(...args)=>{calls.push(args);return {data:{...extra,deleted_at:1,version:8}};}});
 await click(button(u,'تعديل'));
 assert.equal(u.container.querySelector('select').disabled,true);
 await act(async()=>u.container.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 assert.deepEqual(calls[0],[{school_id:3,academic_year_id:5,employee_id:9,subject_name:'التربية المسيحية',weekly_periods:5,expected_version:7},8]);assert.equal(refreshed,1);assert.deepEqual(busy,[true,false]);
 saveResult={error:'تغير النصاب. حدّث الكشف'};await click(button(u,'تعديل'));
 await act(async()=>u.container.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 assert.equal(refreshed,1);assert.match(u.container.querySelector('[role="alert"]').textContent,/تغير النصاب/);
 await click(button(u,'حذف'));assert.deepEqual(calls.at(-1),[8,{school_id:3,academic_year_id:5,expected_version:7}]);assert.equal(refreshed,2);
});
