import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import { createServer } from 'vite';

const window = new Window({ url: 'http://localhost', width: 390, height: 844 });
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'HTMLImageElement', 'Node', 'Event', 'MouseEvent', 'localStorage', 'sessionStorage']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? window : window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const vite = await createServer({
  root: fileURLToPath(new URL('..', import.meta.url)), configFile: false, appType: 'custom',
  optimizeDeps: { noDiscovery: true, include: [] }, esbuild: { jsx: 'automatic' },
  ssr: { noExternal: ['react-router-dom', 'react-router'], resolve: { conditions: ['module', 'browser', 'development'] } },
  server: { middlewareMode: true, hmr: false },
});
const { EmployeeProfile, default: EmployeeProfilePage } = await vite.ssrLoadModule('/src/modules/employees/EmployeeProfilePage.tsx');
const { default: EmployeesPage } = await vite.ssrLoadModule('/src/modules/employees/EmployeesPage.tsx');
const { AuthProvider } = await vite.ssrLoadModule('/src/hooks/useAuth.tsx');
const { MemoryRouter, Routes, Route } = await vite.ssrLoadModule('react-router-dom');
after(async () => { await vite.close(); await window.happyDOM.close(); });

const qualification = (id = 1, primary = true) => ({ id, degree: id === 1 ? 'بكالوريوس' : 'ماجستير', general_specialization: 'علوم', specific_specialization: 'فيزياء', institution: 'جامعة الاختبار', college: 'كلية العلوم', graduation_date: '2018-06-20', is_primary: primary });
function fixture({ schoolId = 1, employeeId = 11, yearId = 3, privateFields = true, hasPhoto = false } = {}) {
  return {
    document_settings: { use_arabic_indic_digits: false, date_format: 'dd/MM/yyyy', currency: 'IQD' },
    employee: { id: employeeId, school_id: schoolId, full_name: `موظف المدرسة ${schoolId}`, employee_number: 'EMP-11', phone: '07001234567', email: 'staff@example.test', address: 'عنوان خاص', gender: 'male', role: 'teacher', job_title: 'مدرس الفيزياء', employee_type: 'teacher', salary_type: 'monthly', salary_amount: 850000, hire_date: '2020-09-01', commencement_date: null, status: 'active', notes: 'ملاحظة إدارية سرية', has_photo: hasPhoto, photo_updated_at: hasPhoto ? 17 : null },
    qualifications: [qualification(1), qualification(2, false)],
    academic_years: [{ id: 3, name: '2026-2027', is_active: 1 }, { id: 2, name: '2025-2026', is_active: 0 }],
    academic_year: { id: yearId, name: yearId === 3 ? '2026-2027' : '2025-2026' },
    teaching_assignments: [{ teaching_load_id: yearId, subject_id: 1, subject_name: yearId === 3 ? 'فيزياء السنة الحالية' : 'فيزياء السنة السابقة', class_id: 2, class_name: 'الثالث المتوسط', section_id: 8, section_name: 'أ', planned_weekly_periods: 5, saved_weekly_periods: yearId === 3 ? 4 : 2 }],
    total_saved_weekly_periods: yearId === 3 ? 4 : 2,
    advisory_assignments: [{ class_id: 2, class_name: 'الثالث المتوسط', section_id: 8, section_name: 'أ', attendance_confirmed: false, notes: '' }],
    salary_history: [{ id: 1, employee_id: employeeId, school_id: schoolId, month: 6, year: 2025, base_salary: 500000, bonus_amount: 20000, deduction_amount: 10000, net_salary: 510000, status: 'paid', payment_business_date: '2025-06-30' }],
    can_manage: privateFields, can_view_private: privateFields,
  };
}
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

async function mount(t, overrides = {}) {
  const container = document.createElement('div'); document.body.append(container);
  const app = createRoot(container);
  const props = { schoolId: 1, employeeId: 11, role: 'school_owner', loadProfile: async (id, scope) => ({ data: fixture({ schoolId: scope.school_id, employeeId: id, yearId: scope.academic_year_id || 3 }) }), ...overrides };
  await act(async () => app.render(createElement(EmployeeProfile, props)));
  t.after(async () => { await act(async () => app.unmount()); container.remove(); });
  return { container, async render(next) { Object.assign(props, next); await act(async () => app.render(createElement(EmployeeProfile, props))); } };
}
async function mountPage(t, { role = 'school_owner', overrides = {}, route = '/employees', profilePage = false } = {}) {
  localStorage.clear(); sessionStorage.clear();
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const pathname = String(url).split('?')[0], method = init.method || 'GET';
    const call = { url: String(url), pathname, method, input: typeof init.body === 'string' ? JSON.parse(init.body) : init.body };
    calls.push(call);
    if (overrides[pathname]) return overrides[pathname](call);
    if (pathname === '/api/auth/me') return response({ data: { id: 1, role_key: role, school_id: 1, full_name: 'Owner' }, csrf_token: 'a'.repeat(64) });
    if (pathname === '/api/employees') return response({ data: method === 'GET' ? [fixture().employee] : { id: 12 } });
    if (pathname === '/api/employees/11/profile') return response({ data: fixture() });
    if (pathname === '/api/employees/11') return response({ data: fixture().employee });
    throw new Error(`Unexpected request ${url}`);
  };
  const container = document.createElement('div'); document.body.append(container);
  const app = createRoot(container);
  const component = profilePage ? createElement(Routes, null, createElement(Route, { path: '/employees/:id', element: createElement(EmployeeProfilePage) })) : createElement(EmployeesPage);
  await act(async () => app.render(createElement(AuthProvider, null, createElement(MemoryRouter, { initialEntries: [route] }, component))));
  t.after(async () => { await act(async () => app.unmount()); container.remove(); });
  return { container, calls };
}
const button = (ui, text) => { const found = [...ui.container.querySelectorAll('button')].find(node => node.textContent.trim() === text); assert.ok(found, `Expected button: ${text}`); return found; };
async function click(element) { assert.ok(element); await act(async () => element.click()); }
async function input(element, value) {
  assert.ok(element, 'expected form field');
  await act(async () => {
    const prototype = element.tagName === 'SELECT' ? HTMLSelectElement.prototype : element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
    element.dispatchEvent(new window.Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  });
}
async function submit(form) { await act(async () => form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))); }
async function selectFile(element, file) {
  Object.defineProperty(element, 'files', { configurable: true, value: [file] });
  await act(async () => element.dispatchEvent(new window.Event('change', { bubbles: true })));
}

test('profile displays saved academic assignments, qualifications, independent dates and historical salaries', async t => {
  const ui = await mount(t);
  assert.match(ui.container.textContent, /بكالوريوس/);
  assert.match(ui.container.textContent, /ماجستير/);
  assert.match(ui.container.textContent, /فيزياء السنة الحالية/);
  assert.match(ui.container.textContent, /الحضور غير مؤكد/);
  assert.match(ui.container.textContent, /01\/09\/2020/);
  const commencement = [...ui.container.querySelectorAll('dt')].find(node => node.textContent === 'تاريخ المباشرة');
  assert.equal(commencement.nextElementSibling.textContent, 'غير مسجل');
  assert.match(ui.container.textContent, /850,000 د.ع \(IQD\)/);
  assert.match(ui.container.textContent, /500,000 د.ع \(IQD\)/);
  assert.match(ui.container.textContent, /510,000 د.ع \(IQD\)/);
  assert.match(ui.container.textContent, /30\/06\/2025/);
  assert.equal(ui.container.querySelector('img'), null);
});

test('year selection requests the selected saved year with explicit school and updates URL callback', async t => {
  const calls = [], years = [];
  const ui = await mount(t, { onYearChange: id => years.push(id), loadProfile: async (id, scope) => { calls.push({ id, ...scope }); return { data: fixture({ yearId: scope.academic_year_id || 3 }) }; } });
  await input(ui.container.querySelector('select[aria-label="السنة الدراسية"]'), '2');
  assert.deepEqual(calls.at(-1), { id: 11, school_id: 1, academic_year_id: 2 });
  assert.deepEqual(years, [2]);
  assert.match(ui.container.textContent, /فيزياء السنة السابقة/);
  assert.doesNotMatch(ui.container.textContent, /فيزياء السنة الحالية/);
});

test('school and employee changes discard pending profiles and never show previous tenant content', async t => {
  const pending = deferred();
  const ui = await mount(t, { loadProfile: async (id, scope) => scope.school_id === 1 ? pending.promise : { data: fixture({ schoolId: scope.school_id, employeeId: id }) } });
  await ui.render({ schoolId: 2, employeeId: 25 });
  assert.match(ui.container.textContent, /موظف المدرسة 2/);
  await act(async () => pending.resolve({ data: fixture() }));
  assert.doesNotMatch(ui.container.textContent, /موظف المدرسة 1/);
  assert.match(ui.container.textContent, /موظف المدرسة 2/);
});

test('a late academic year response cannot overwrite a newly selected year', async t => {
  const pending = deferred();
  const ui = await mount(t, { requestedAcademicYearId: 2, loadProfile: async (id, scope) => scope.academic_year_id === 2 ? pending.promise : { data: fixture() } });
  await ui.render({ requestedAcademicYearId: 3 });
  assert.match(ui.container.textContent, /فيزياء السنة الحالية/);
  await act(async () => pending.resolve({ data: fixture({ yearId: 2 }) }));
  assert.doesNotMatch(ui.container.textContent, /فيزياء السنة السابقة/);
});

test('accountant receives a payroll view without editing, contact, photos, qualifications or academic details', async t => {
  const ui = await mount(t, { role: 'accountant', loadProfile: async () => ({ data: fixture({ privateFields: false, hasPhoto: true }) }) });
  for (const secret of ['عنوان خاص', 'ملاحظة إدارية سرية', 'staff@example.test', '07001234567', 'بكالوريوس', 'فيزياء السنة الحالية']) assert.ok(!ui.container.textContent.includes(secret));
  assert.equal(ui.container.querySelector('img'), null);
  assert.equal(ui.container.querySelector('input[type="file"]'), null);
  assert.equal([...ui.container.querySelectorAll('button')].some(node => node.textContent.includes('تعديل')), false);
  assert.match(ui.container.textContent, /500,000/);
});

test('missing school and unauthorized role do not query employee records', async t => {
  let calls = 0;
  const ui = await mount(t, { schoolId: null, loadProfile: async () => { calls++; return { data: fixture() }; } });
  assert.equal(calls, 0);
  await ui.render({ schoolId: 1, role: 'teacher' });
  assert.equal(calls, 0);
  assert.match(ui.container.textContent, /ليس لديك صلاحية/);
});

test('profile editor preserves multiple qualifications and independent dates and blocks duplicate saves', async t => {
  const pending = deferred(), writes = [];
  const ui = await mount(t, { saveEmployee: async (id, body) => { writes.push({ id, body }); return pending.promise; } });
  await click(button(ui, 'تعديل البيانات'));
  const form = ui.container.querySelector('form');
  assert.equal(form.querySelector('[name="commencement_date"]').value, '');
  assert.equal(form.querySelectorAll('[name="primary_qualification"]').length, 2);
  await input(form.querySelector('[name="address"]'), 'عنوان محدث');
  await input(form.querySelector('[name="commencement_date"]'), '2020-09-20');
  await input(form.querySelector('[name="salary_amount"]'), '900000');
  await click(form.querySelectorAll('[name="primary_qualification"]')[1]);
  await submit(form); await submit(form);
  assert.equal(writes.length, 1);
  assert.equal(form.querySelector('fieldset').disabled, true);
  assert.equal(writes[0].body.school_id, 1);
  assert.equal(writes[0].body.hire_date, '2020-09-01');
  assert.equal(writes[0].body.commencement_date, '2020-09-20');
  assert.equal(writes[0].body.qualifications.length, 2);
  assert.equal(writes[0].body.qualifications[0].specific_specialization, 'فيزياء');
  assert.deepEqual(writes[0].body.qualifications.map(q => q.is_primary), [false, true]);
  assert.equal(writes[0].body.salary_amount, 900000);
  await act(async () => pending.resolve({ data: { id: 11 } }));
  assert.match(ui.container.textContent, /500,000 د.ع \(IQD\)/);
});

test('protected photo uses tenant URL; invalid uploads are rejected and successful uploads and deletes stay scoped', async t => {
  const writes = [], deletes = [];
  const ui = await mount(t, { loadProfile: async () => ({ data: fixture({ hasPhoto: true }) }), uploadPhoto: async (id, school, file) => { writes.push({ id, school, file }); return { data: { has_photo: true, photo_updated_at: 25 } }; }, removePhoto: async (id, school) => { deletes.push({ id, school }); return { data: { has_photo: false, photo_updated_at: null } }; } });
  assert.equal(ui.container.querySelector('img').getAttribute('src'), '/api/employees/11/photo?school_id=1&v=17');
  await selectFile(ui.container.querySelector('input[type="file"]'), new File(['<svg/>'], 'bad.svg', { type: 'image/svg+xml' }));
  assert.equal(writes.length, 0);
  assert.match(ui.container.querySelector('[role="alert"]').textContent, /JPEG/);
  await selectFile(ui.container.querySelector('input[type="file"]'), new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' }));
  assert.equal(writes.length, 0);
  await selectFile(ui.container.querySelector('input[type="file"]'), new File(['test bytes'], 'photo.png', { type: 'image/png' }));
  assert.equal(writes.length, 1); assert.equal(writes[0].school, 1); assert.equal(writes[0].id, 11);
  assert.match(ui.container.querySelector('img').getAttribute('src'), /v=25/);
  await click(button(ui, 'حذف الصورة'));
  assert.deepEqual(deletes, [{ id: 11, school: 1 }]);
  assert.equal(ui.container.querySelector('img'), null);
});

test('failed profile load gives a retry and stale save completion cannot affect a new employee', async t => {
  let reads = 0;
  const pending = deferred();
  const ui = await mount(t, { loadProfile: async (id, scope) => ++reads === 1 ? { error: 'تعذر الاتصال' } : { data: fixture({ employeeId: id, schoolId: scope.school_id }) }, saveEmployee: async () => pending.promise });
  assert.match(ui.container.querySelector('[role="alert"]').textContent, /تعذر الاتصال/);
  await click(button(ui, 'إعادة المحاولة'));
  await click(button(ui, 'تعديل البيانات')); await submit(ui.container.querySelector('form'));
  await ui.render({ schoolId: 2, employeeId: 22 });
  await act(async () => pending.resolve({ error: 'خطأ الحفظ القديم' }));
  assert.match(ui.container.textContent, /موظف المدرسة 2/);
  assert.doesNotMatch(ui.container.textContent, /خطأ الحفظ القديم/);
});

test('employee list links to full profile, register and receipts and expanded create preserves all entered fields', async t => {
  const ui = await mountPage(t);
  assert.equal(ui.container.querySelector('a[href^="/employees/11"]').getAttribute('href'), '/employees/11?school_id=1');
  assert.ok(ui.container.querySelector('a[href="/staff-register?school_id=1"]'));
  assert.ok(ui.container.querySelector('a[href="/salary-receipts?school_id=1"]'));
  await click(button(ui, 'إضافة موظف'));
  const form = ui.container.querySelector('form');
  await input(form.querySelector('[name="full_name"]'), 'موظف جديد');
  await input(form.querySelector('[name="address"]'), 'بغداد');
  await input(form.querySelector('[name="gender"]'), 'female');
  await input(form.querySelector('[name="employee_type"]'), 'administrator');
  await input(form.querySelector('[name="salary_type"]'), 'contract');
  await input(form.querySelector('[name="hire_date"]'), '2026-09-01');
  await input(form.querySelector('[name="commencement_date"]'), '2026-09-15');
  await click(button(ui, 'إضافة مؤهل'));
  await input(form.querySelector('[name="qualifications.0.degree"]'), 'دبلوم');
  await submit(form);
  const write = ui.calls.find(call => call.method === 'POST');
  assert.ok(write);
  assert.equal(write.input.school_id, 1); assert.equal(write.input.address, 'بغداد');
  assert.equal(write.input.gender, 'female'); assert.equal(write.input.employee_type, 'administrator');
  assert.equal(write.input.salary_type, 'contract'); assert.equal(write.input.commencement_date, '2026-09-15');
  assert.equal(write.input.qualifications[0].degree, 'دبلوم');
  assert.equal(write.input.qualifications[0].is_primary, true);
});

test('list edit fetches full profile before editing so existing qualifications are preserved', async t => {
  const ui = await mountPage(t);
  await click(ui.container.querySelector('button[title="تعديل"]'));
  assert.equal(ui.container.querySelectorAll('[name="primary_qualification"]').length, 2);
  assert.ok(ui.calls.some(call => call.url === '/api/employees/11/profile?school_id=1'));
  await input(ui.container.querySelector('[name="job_title"]'), 'مدرس أقدم');
  await submit(ui.container.querySelector('form'));
  const write = ui.calls.find(call => call.method === 'PUT');
  assert.equal(write.input.qualifications.length, 2);
  assert.equal(write.input.qualifications[1].degree, 'ماجستير');
});

test('profile route cannot use a URL school to bypass the authenticated tenant scope', async t => {
  const ui = await mountPage(t, { profilePage: true, route: '/employees/11?school_id=2' });
  assert.match(ui.container.textContent, /مدرسة مختلفة/);
  assert.equal(ui.calls.some(call => call.pathname.endsWith('/profile')), false);
});

test('accountant can open a profile link containing a private academic year without requesting or matching that year', async t => {
  const payrollProfile = {
    ...fixture({ privateFields: false }),
    academic_year: null, academic_years: [], qualifications: [],
    teaching_assignments: [], advisory_assignments: [], total_saved_weekly_periods: 0,
  };
  const ui = await mountPage(t, {
    role: 'accountant', profilePage: true,
    route: '/employees/11?school_id=1&academic_year_id=2',
    overrides: { '/api/employees/11/profile': () => response({ data: payrollProfile }) },
  });
  assert.equal(ui.calls.find(call => call.pathname.endsWith('/profile'))?.url, '/api/employees/11/profile?school_id=1');
  assert.equal(ui.container.querySelector('[role="alert"]'), null);
  assert.match(ui.container.textContent, /موظف المدرسة 1/);
  assert.match(ui.container.textContent, /500,000/);
  assert.equal(ui.container.querySelector('select[aria-label="السنة الدراسية"]'), null);
});

test('salary generation query opens the requested form after authentication resolves the school', async t => {
  const pending = deferred();
  const ui = await mountPage(t, {
    route: '/employees?tab=generate&school_id=1',
    overrides: { '/api/auth/me': () => pending.promise, '/api/salaries': () => response({ data: [] }) },
  });
  assert.doesNotMatch(ui.container.textContent, /توليد راتب فردي/);
  await act(async () => pending.resolve(response({ data: { id: 1, role_key: 'school_owner', school_id: 1, full_name: 'Owner' }, csrf_token: 'a'.repeat(64) })));
  assert.match(ui.container.textContent, /توليد راتب فردي/);
  assert.match(ui.container.textContent, /توليد رواتب جميع الموظفين/);
  assert.equal(ui.calls.some(call => call.method !== 'GET'), false, 'opening the query does not generate salaries');
  await click(button(ui, 'العودة إلى الرواتب'));
  assert.doesNotMatch(ui.container.textContent, /توليد راتب فردي/);
  assert.ok(ui.calls.some(call => call.pathname === '/api/salaries'));
  await click(button(ui, 'توليد الرواتب'));
  assert.match(ui.container.textContent, /توليد راتب فردي/);
});

test('query-selected tabs honor employee and payroll permissions and survive system-admin school selection', async t => {
  const payroll = await mountPage(t, { role: 'accountant', route: '/employees?tab=generate' });
  assert.match(payroll.container.textContent, /توليد راتب فردي/);
  const forbidden = await mountPage(t, { role: 'accountant', route: '/employees?tab=add' });
  assert.equal(forbidden.container.querySelector('form'), null);
  assert.match(forbidden.container.textContent, /موظف المدرسة 1/);
  const invalid = await mountPage(t, { route: '/employees?tab=unknown' });
  assert.match(invalid.container.textContent, /موظف المدرسة 1/);
  const admin = await mountPage(t, {
    role: 'system_admin', route: '/employees?tab=generate',
    overrides: { '/api/schools': () => response({ data: [{ id: 1, name: 'School One', status: 'active' }, { id: 2, name: 'School Two', status: 'active' }] }) },
  });
  await input(admin.container.querySelector('#system-admin-target-school'), '1');
  assert.match(admin.container.textContent, /توليد راتب فردي/);
  await input(admin.container.querySelector('#system-admin-target-school'), '2');
  assert.match(admin.container.textContent, /توليد راتب فردي/);
  assert.equal(admin.calls.some(call => call.method !== 'GET'), false);
});
