import assert from 'node:assert/strict';
import test, {after} from 'node:test';
import {fileURLToPath} from 'node:url';
import {Window} from 'happy-dom';
import {createServer} from 'vite';

const window = new Window({url: 'http://localhost'});
for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'HTMLImageElement', 'Node', 'Event', 'MouseEvent', 'localStorage', 'sessionStorage']) {
  Object.defineProperty(globalThis, key, {configurable: true, value: key === 'window' ? window : window[key]});
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const {createElement, act} = await import('react');
const {createRoot} = await import('react-dom/client');
const vite = await createServer({root: fileURLToPath(new URL('..', import.meta.url)), configFile: false, appType: 'custom',
  optimizeDeps: {noDiscovery: true, include: []}, esbuild: {jsx: 'automatic'},
  ssr: {noExternal: ['react-router-dom', 'react-router'], resolve: {conditions: ['module', 'browser', 'development']}}, server: {middlewareMode: true, hmr: false}});
const {StaffRegisterDocument} = await vite.ssrLoadModule('/src/components/staffDocuments/StaffRegisterDocument.tsx');
const {SalaryReceiptsDocument} = await vite.ssrLoadModule('/src/components/staffDocuments/SalaryReceiptsDocument.tsx');
const {StaffRegisterPreview} = await vite.ssrLoadModule('/src/modules/print/PrintStaffRegisterPage.tsx');
const {SalaryReceiptsPreview} = await vite.ssrLoadModule('/src/modules/print/PrintSalaryReceiptsPage.tsx');
const {StaffRegisterManager} = await vite.ssrLoadModule('/src/modules/employees/StaffRegisterPage.tsx');
const {SalaryReceiptsManager} = await vite.ssrLoadModule('/src/modules/employees/SalaryReceiptsPage.tsx');
const {receiptTotals, staffDate} = await vite.ssrLoadModule('/src/components/staffDocuments/documentHelpers.ts');
after(async () => {await vite.close(); await window.happyDOM.close();});

function metadata(schoolId = 1) {
  return {school: {id: schoolId, name: `مدرسة السجل ${schoolId}`, name_en: 'Staff School', logo_url: null, principal_name: 'المدير'}, prepared_at: 1790928000,
    document_settings: {official_book_layout: null, use_arabic_indic_digits: false, date_format: 'dd/MM/yyyy', currency: 'IQD', header_text: 'ترويسة المدرسة', footer_text: 'تذييل المدرسة'}};
}
function register({schoolId = 1, count = 7, status = 'active', role = '', q = ''} = {}) {
  return {...metadata(schoolId), filters: {q, role, status}, can_view_private: true, employees: Array.from({length: count}, (_, i) => ({
    id: i + 1, school_id: schoolId, full_name: `الموظف الفريد ${i + 1}`, employee_number: `E-${i + 1}`, phone: '07501234567', email: 'teacher@example.test',
    role: 'teacher', job_title: 'مدرس الفيزياء', hire_date: '2019-09-10', commencement_date: '2019-09-15', status: status === 'archived' ? 'archived' : 'active',
    notes: 'PRIVATE ADMIN NOTES', salary_amount: 999999999, has_photo: i === 0, photo_updated_at: 123,
    primary_qualification: {id: i + 1, degree: 'بكالوريوس العلوم', general_specialization: 'الفيزياء', specific_specialization: 'الفيزياء النظرية', institution: 'جامعة دهوك', college: 'كلية العلوم', graduation_date: '2018-06-20', is_primary: true},
  }))};
}
function receipts({schoolId = 1, count = 25, month = 10, year = 2026, status = 'all'} = {}) {
  const rows = Array.from({length: count}, (_, i) => ({id: i + 1, school_id: schoolId, employee_id: i + 1, employee_name: `موظف الراتب ${i + 1}`, employee_number: `R-${i + 1}`,
    employee_status: i === 0 ? 'archived' : 'active', month, year, base_salary: 500000, bonus_amount: 25000, deduction_amount: 10000, net_salary: 515000,
    status: status === 'all' ? ['paid', 'unpaid', 'cancelled'][i % 3] : status, paid_at: null, payment_business_date: '2026-10-02'}));
  return {...metadata(schoolId), month, year, status, rows, totals: receiptTotals(rows), period_record_count: count, missing_employee_count: 2,
    missing_employees: [{id: 100, full_name: 'الموظف دون راتب', employee_number: null}, {id: 101, full_name: 'موظف آخر دون راتب', employee_number: null}],
    status_counts: {paid: rows.filter(r => r.status === 'paid').length, unpaid: rows.filter(r => r.status === 'unpaid').length, cancelled: rows.filter(r => r.status === 'cancelled').length}};
}
const deferred = () => {let resolve; const promise = new Promise(yes => {resolve = yes;}); return {resolve, promise};};
async function mount(t, Component, props) {
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container); let unmounted = false;
  await act(async () => root.render(createElement(Component, props)));
  const unmount = async () => {if (!unmounted) {unmounted = true; await act(async () => root.unmount()); container.remove();}};
  t.after(unmount);
  return {container, unmount, async render(patch) {props = {...props, ...patch}; await act(async () => root.render(createElement(Component, props)));}};
}
const button = (u, label) => [...u.container.querySelectorAll('button')].find(element => element.textContent.includes(label));
async function click(element) {assert.ok(element); await act(async () => element.click());}
async function select(element, value) {await act(async () => {Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(element, value); element.dispatchEvent(new window.Event('change', {bubbles: true}));});}
async function flushPrint() {await act(async () => {await new Promise(resolve => setTimeout(resolve, 70));});}

test('staff document preserves every employee and selected qualification over repeated numbered pages', async t => {
  const summary = register(); const u = await mount(t, StaffRegisterDocument, {summary});
  assert.equal(u.container.querySelectorAll('.staff-document-page').length, 3);
  assert.equal(u.container.querySelectorAll('.staff-document-header').length, 3);
  assert.equal(u.container.querySelectorAll('.staff-document-footer').length, 3);
  assert.deepEqual([...u.container.querySelectorAll('[data-employee-id]')].map(row => Number(row.dataset.employeeId)), summary.employees.map(row => row.id));
  for (const card of u.container.querySelectorAll('.staff-register-card')) {
    assert.match(card.textContent, /بكالوريوس العلوم.*الفيزياء النظرية.*جامعة دهوك.*كلية العلوم.*20\/06\/2018/);
    assert.match(card.textContent, /10\/09\/2019.*15\/09\/2019/);
  }
  assert.match(u.container.querySelector('.staff-register-photo').getAttribute('src'), /\/api\/employees\/1\/photo\?school_id=1&v=123/);
  assert.doesNotMatch(u.container.textContent, /PRIVATE ADMIN NOTES|999999999/);
  assert.match(u.container.textContent, /الصفحة 3 من 3/);
});

test('actual tall Arabic cards reflow to extra pages without dropping records or duplicating serials', async t => {
  const original = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function() {
    const height = this.classList.contains('staff-document-header') ? 160 : this.classList.contains('staff-document-footer') ? 30 : this.classList.contains('staff-register-card') ? 380 : 0;
    return {x: 0, y: 0, width: 680, height, top: 0, bottom: height, left: 0, right: 680, toJSON() {return {};}};
  };
  t.after(() => {HTMLElement.prototype.getBoundingClientRect = original;});
  const u = await mount(t, StaffRegisterDocument, {summary: register({count: 4})});
  assert.equal(u.container.querySelectorAll('.staff-document-page').length, 4);
  assert.deepEqual([...u.container.querySelectorAll('.staff-register-card-heading b')].map(el => el.textContent.split('.')[0]), ['1', '2', '3', '4']);
  assert.match(u.container.textContent, /الصفحة 4 من 4/);
});

test('accountant document does not render private photos, contact information or qualifications', async t => {
  const summary = register({count: 1}); summary.can_view_private = false;
  const u = await mount(t, StaffRegisterDocument, {summary});
  assert.equal(u.container.querySelector('.staff-register-photo'), null);
  assert.doesNotMatch(u.container.textContent, /teacher@example.test|07501234567|بكالوريوس العلوم/);
});

test('salary pages use saved amounts, retain archived employees, exclude cancelled totals and leave signatures empty', async t => {
  const summary = receipts(); const before = structuredClone(summary); const u = await mount(t, SalaryReceiptsDocument, {summary});
  assert.equal(u.container.querySelectorAll('.staff-document-page').length, 3);
  assert.equal(u.container.querySelectorAll('thead').length, 3);
  assert.equal(u.container.querySelectorAll('[data-salary-id]').length, 25);
  assert.equal(u.container.querySelectorAll('tfoot').length, 1);
  assert.equal(u.container.querySelectorAll('.salary-receipt-signature').length, 25);
  assert.ok([...u.container.querySelectorAll('.salary-receipt-signature')].every(cell => cell.textContent === ''));
  assert.match(u.container.textContent, /موظف مؤرشف/);
  assert.match(u.container.querySelector('tfoot').textContent, /8,755,000/);
  assert.match(u.container.textContent, /02\/10\/2026/);
  assert.match(u.container.textContent, /رواتب غير مولدة لـ 2/);
  assert.deepEqual(summary, before, 'rendering must not change saved rows or their status');
  assert.equal(receiptTotals(summary.rows.filter(row => row.status === 'cancelled')).net_salary, 0);
});

test('variable salary row heights reflow without losing records, totals or continuous serials', async t => {
  const original = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function() {
    const height = this.classList.contains('staff-document-header') ? 100 : this.classList.contains('staff-document-footer') ? 20 : this.tagName === 'THEAD' ? 35 : this.matches('tbody tr[data-record-id]') ? [80, 170, 160, 200, 100][Number(this.dataset.recordId) - 1] : 0;
    return {x: 0, y: 0, width: 1000, height, top: 0, bottom: height, left: 0, right: 1000, toJSON() {return {};}};
  };
  t.after(() => {HTMLElement.prototype.getBoundingClientRect = original;});
  const u = await mount(t, SalaryReceiptsDocument, {summary: receipts({count: 5})});
  const pages = [...u.container.querySelectorAll('.staff-document-page')];
  assert.deepEqual(pages.map(page => page.querySelectorAll('tbody tr').length), [2, 2, 1]);
  assert.deepEqual([...u.container.querySelectorAll('tbody tr td:first-child')].map(cell => cell.textContent), ['1', '2', '3', '4', '5']);
  assert.equal(u.container.querySelectorAll('tfoot').length, 1);
  assert.ok(pages.at(-1).querySelector('tfoot'));
  assert.match(u.container.textContent, /الصفحة 3 من 3/);
});

test('school date format and digit preference apply to document fields and totals', async t => {
  const summary = receipts({count: 1, status: 'paid'}); summary.document_settings.use_arabic_indic_digits = true; summary.document_settings.date_format = 'yyyy-MM-dd';
  const u = await mount(t, SalaryReceiptsDocument, {summary});
  assert.match(u.container.textContent, /٢٠٢٦-١٠-٠٢/); assert.match(u.container.textContent, /٥١٥,٠٠٠/);
  assert.equal(staffDate(null, summary.document_settings), 'غير مسجل');
});

test('register defaults to active and archived employees require an explicit filter change', async t => {
  const calls = [];
  const u = await mount(t, StaffRegisterManager, {schoolId: 1, loadRegister: async (schoolId, filters) => {calls.push(filters); return {data: register({schoolId, count: 1, ...filters})};}});
  assert.equal(calls[0].status, 'active');
  assert.ok(u.container.querySelector('a[href*="/print/staff-register"]'));
  await select(u.container.querySelector('select[aria-label="حالة الموظف"]'), 'archived');
  assert.equal(calls.at(-1).status, 'archived');
  assert.match(u.container.querySelector('article').textContent, /مؤرشف/);
  assert.match(u.container.querySelector('a[href*="/print/staff-register"]').href, /status=archived/);
});

test('late register responses from another school cannot populate screen or print link', async t => {
  const old = deferred();
  const u = await mount(t, StaffRegisterManager, {schoolId: 1, loadRegister: schoolId => schoolId === 1 ? old.promise : Promise.resolve({data: register({schoolId, count: 1})})});
  assert.equal(u.container.querySelector('article'), null);
  await u.render({schoolId: 2});
  await act(async () => old.resolve({data: register({schoolId: 1})}));
  assert.equal(u.container.querySelectorAll('article').length, 1);
  assert.match(u.container.querySelector('a[href*="/employees/1"]').href, /school_id=2/);
  assert.match(u.container.querySelector('a[href*="/print/staff-register"]').href, /school_id=2/);
});

test('late same-school filter response cannot replace a newer filter', async t => {
  const old = deferred();
  const u = await mount(t, StaffRegisterManager, {schoolId: 1, loadRegister: (schoolId, filters) => filters.status === 'active' ? old.promise : Promise.resolve({data: register({schoolId, count: 1, ...filters})})});
  await select(u.container.querySelector('select[aria-label="حالة الموظف"]'), 'archived');
  await act(async () => old.resolve({data: register({count: 6})}));
  assert.equal(u.container.querySelectorAll('article').length, 1);
  assert.match(u.container.querySelector('article').textContent, /مؤرشف/);
});

test('print rejects mismatched school or monthly scope instead of printing it', async t => {
  const u = await mount(t, SalaryReceiptsPreview, {schoolId: 1, month: 10, year: 2026, status: 'all', loadReceipts: async () => ({data: receipts({month: 9})})});
  assert.equal(u.container.querySelector('.salary-receipts-document'), null);
  assert.match(u.container.textContent, /تعذر مطابقة/);
  assert.equal(button(u, 'حفظ PDF'), undefined);
});

test('invalid or missing print scope performs no API calls and exposes no print control', async t => {
  let calls = 0; const loadReceipts = async () => {calls++; return {data: receipts()};};
  const u = await mount(t, SalaryReceiptsPreview, {schoolId: null, month: 10, year: 2026, loadReceipts});
  await u.render({schoolId: 1, month: 13});
  await u.render({month: 10, year: 1999});
  await u.render({year: 2201});
  assert.equal(calls, 0); assert.equal(button(u, 'حفظ PDF'), undefined);
});

test('missing monthly salaries remain visibly absent with a generation link, without fabricated zero rows', async t => {
  const u = await mount(t, SalaryReceiptsManager, {schoolId: 1, loadReceipts: async (schoolId, filters) => ({data: receipts({schoolId, ...filters, count: 0})})});
  assert.equal(u.container.querySelector('table'), null);
  assert.match(u.container.textContent, /لم تُولّد رواتب لهذا الشهر/);
  assert.ok(u.container.querySelector('a[href="/employees?tab=generate"]'));
  assert.equal(u.container.querySelector('a[href*="/print/salary-receipts"]'), null);
});

test('receipt screen starts unpaid and maintains the status-specific historical amounts', async t => {
  const calls = [];
  const u = await mount(t, SalaryReceiptsManager, {schoolId: 1, loadReceipts: async (schoolId, filters) => {calls.push(filters); return {data: receipts({schoolId, ...filters, count: 1})};}});
  assert.equal(calls[0].status, 'unpaid');
  assert.equal(u.container.querySelector('input[type="month"]').min, '2000-01');
  assert.match(u.container.textContent, /515,000/);
  await select(u.container.querySelector('select[aria-label="حالة الرواتب"]'), 'cancelled');
  assert.equal(calls.at(-1).status, 'cancelled');
  assert.match(u.container.textContent, /إجمالي الصافي دون الرواتب الملغاة: 0 IQD/);
});

test('ready print executes only the read loader and does not change salary states', async t => {
  const summary = receipts({count: 2}); const before = structuredClone(summary); let loads = 0; const prints = [];
  const original = window.print; window.print = () => prints.push(document.title); t.after(() => {window.print = original;});
  const u = await mount(t, SalaryReceiptsPreview, {schoolId: 1, month: 10, year: 2026, status: 'all', loadReceipts: async () => {loads++; return {data: summary};}});
  await click(button(u, 'حفظ PDF')); await flushPrint();
  assert.equal(prints.length, 1); assert.match(prints[0], /كشف استلام الرواتب/); assert.equal(loads, 1); assert.deepEqual(summary, before);
});

test('oversized content prevents opening a print dialog with cropped rows', async t => {
  const originalRect = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function() {
    const height = this.classList.contains('staff-document-page') ? 900 : 0;
    return {x: 0, y: 0, width: 1000, height, top: 0, bottom: height, left: 0, right: 1000, toJSON() {return {};}};
  };
  t.after(() => {HTMLElement.prototype.getBoundingClientRect = originalRect;});
  const originalPrint = window.print; let prints = 0; window.print = () => {prints++;}; t.after(() => {window.print = originalPrint;});
  const u = await mount(t, SalaryReceiptsPreview, {schoolId: 1, month: 10, year: 2026, status: 'all', loadReceipts: async () => ({data: receipts({count: 1})})});
  await click(button(u, 'حفظ PDF')); await flushPrint();
  assert.equal(prints, 0); assert.match(u.container.querySelector('[role="alert"]').textContent, /أطول من الصفحة/);
});

test('switching school while fonts load cancels an old print snapshot', async t => {
  const fonts = deferred(); const descriptor = Object.getOwnPropertyDescriptor(document, 'fonts');
  Object.defineProperty(document, 'fonts', {configurable: true, value: {ready: fonts.promise}});
  t.after(() => {if (descriptor) Object.defineProperty(document, 'fonts', descriptor); else delete document.fonts;});
  const original = window.print; let prints = 0; window.print = () => {prints++;}; t.after(() => {window.print = original;});
  const u = await mount(t, StaffRegisterPreview, {schoolId: 1, loadRegister: async schoolId => ({data: register({schoolId, count: 1})})});
  await click(button(u, 'حفظ PDF')); await u.render({schoolId: 2});
  await act(async () => fonts.resolve()); await flushPrint();
  assert.equal(prints, 0); assert.match(u.container.textContent, /تغيرت المدرسة/);
});

test('unmounting during print preparation cancels the print dialog', async t => {
  const fonts = deferred(); const descriptor = Object.getOwnPropertyDescriptor(document, 'fonts');
  Object.defineProperty(document, 'fonts', {configurable: true, value: {ready: fonts.promise}});
  t.after(() => {if (descriptor) Object.defineProperty(document, 'fonts', descriptor); else delete document.fonts;});
  const original = window.print; let prints = 0; window.print = () => {prints++;}; t.after(() => {window.print = original;});
  const u = await mount(t, SalaryReceiptsPreview, {schoolId: 1, month: 10, year: 2026, status: 'all', loadReceipts: async () => ({data: receipts({count: 1})})});
  await click(button(u, 'حفظ PDF')); await u.unmount(); await act(async () => fonts.resolve()); await flushPrint();
  assert.equal(prints, 0);
});
