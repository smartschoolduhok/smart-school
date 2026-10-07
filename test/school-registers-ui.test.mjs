import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import { createServer } from 'vite';

const window = new Window({ url: 'http://localhost', width: 1100, height: 900 });
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'HTMLImageElement', 'Node', 'Event', 'MouseEvent', 'localStorage', 'sessionStorage']) Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? window : window[key] });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const vite = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), configFile: false, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] }, esbuild: { jsx: 'automatic' }, ssr: { noExternal: ['react-router-dom', 'react-router'], resolve: { conditions: ['module', 'browser', 'development'] } }, server: { middlewareMode: true, hmr: false } });
const { SchoolRegistersWorkspace, SchoolRegisterIndex } = await vite.ssrLoadModule('/src/modules/schoolRegisters/SchoolRegistersPage.tsx');
const { evaluationSummary, emptyEvaluation } = await vite.ssrLoadModule('/src/modules/schoolRegisters/TeacherEvaluationTable.tsx');
const { splitPrintValue } = await vite.ssrLoadModule('/src/modules/schoolRegisters/RegisterPrintPreview.tsx');
const { MemoryRouter } = await vite.ssrLoadModule('react-router-dom');
after(async () => { await vite.close(); await window.happyDOM.close(); });

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const entry = (overrides = {}) => ({ id: 1, school_id: 1, academic_year_id: 3, register_key: 'school-orders', entry_date: '2026-10-07', title: 'أمر مدرسي محفوظ', data: { order_number: 'ORD-1', responsible_person: 'موظف تجريبي', subject: 'تنظيم العمل', extra_fields: [] }, status: 'active', version: 1, created_at: 1700000000, updated_at: 1700000000, void_reason: null, ...overrides });
function services(overrides = {}) {
  return {
    years: async schoolId => ({ data: [{ id: 3, school_id: schoolId, name: '2026–2027', is_active: 1 }, { id: 2, school_id: schoolId, name: '2025–2026', is_active: 0 }] }),
    school: async schoolId => ({ data: { school: { id: schoolId, name: `مدرسة الاختبار ${schoolId}`, logo_url: `/logo-${schoolId}.png` }, settings: {} } }),
    employees: async schoolId => ({ data: [{ id: 11, school_id: schoolId, full_name: 'مدرس الاختبار', role: 'teacher', status: 'active' }] }),
    list: async scope => ({ data: { entries: [entry(scope)], total: 1, active_total: 1, voided_total: 0 } }),
    create: async (scope, input) => ({ data: entry({ ...scope, ...input }) }),
    update: async (id, scope, version, input) => ({ data: entry({ ...scope, ...input, id, version: version + 1 }) }),
    void: async (id, scope, version, reason) => ({ data: entry({ ...scope, id, version: version + 1, status: 'voided', void_reason: reason }) }),
    history: async () => ({ data: { history: [], total: 0 } }),
    ...overrides,
  };
}
async function mount(t, overrides = {}, serviceOverrides = {}) {
  const container = document.createElement('div'); document.body.append(container); const app = createRoot(container);
  const props = { schoolId: 1, registerKey: 'school-orders', services: services(serviceOverrides), ...overrides };
  const render = async next => { Object.assign(props, next); await act(async () => app.render(createElement(MemoryRouter, null, createElement(SchoolRegistersWorkspace, props)))); };
  await render({});
  t.after(async () => { await act(async () => app.unmount()); container.remove(); });
  return { container, render, props };
}
const button = (ui, label) => { const found = [...ui.container.querySelectorAll('button')].find(node => node.textContent.trim() === label); assert.ok(found, `Missing button ${label}`); return found; };
async function click(element) { assert.ok(element); await act(async () => element.click()); }
async function input(element, value) { assert.ok(element, 'Missing input'); await act(async () => { const prototype = element.tagName === 'SELECT' ? HTMLSelectElement.prototype : element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value); element.dispatchEvent(new window.Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }); }
async function submit(form) { assert.ok(form); await act(async () => form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))); }
async function key(element, value, options = {}) { await act(async () => element.dispatchEvent(new window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...options }))); }

test('register index includes all 29 links and offers meaningful category and Arabic search filtering', async t => {
  const ui = await mount(t, { registerKey: undefined });
  assert.equal(ui.container.querySelectorAll('.sr-register-card').length, 29);
  assert.ok(ui.container.querySelector('a[href="/staff-register"]'));
  assert.ok(ui.container.querySelector('a[href="/print/staff-attendance"]'));
  await input(ui.container.querySelector('[aria-label="البحث في فهرس السجلات"]'), 'الاوامر');
  assert.equal(ui.container.querySelectorAll('.sr-register-card').length, 1);
  assert.match(ui.container.querySelector('.sr-register-card').textContent, /الأوامر المدرسية/);
  await input(ui.container.querySelector('[aria-label="البحث في فهرس السجلات"]'), '');
  await click(button(ui, 'الإشراف والتقويم'));
  assert.equal(ui.container.querySelectorAll('.sr-register-card').length, 7);
});

test('late metadata and entry results never reappear after switching schools', async t => {
  const pending = deferred();
  const ui = await mount(t, {}, { list: async scope => scope.school_id === 1 ? pending.promise : { data: { entries: [entry({ ...scope, title: 'قيد المدرسة الثانية' })], total: 1 } } });
  await ui.render({ schoolId: 2 });
  assert.match(ui.container.textContent, /قيد المدرسة الثانية/);
  await act(async () => pending.resolve({ data: { entries: [entry({ title: 'بيانات المدرسة القديمة' })], total: 1 } }));
  assert.doesNotMatch(ui.container.textContent, /بيانات المدرسة القديمة/);
  assert.equal(ui.container.querySelector('img')?.getAttribute('src'), '/logo-2.png');
});

test('year and register navigation unmount drafts and discard old requests', async t => {
  const pending = deferred();
  const ui = await mount(t, {}, { list: async scope => scope.academic_year_id === 3 ? pending.promise : { data: { entries: [entry({ ...scope, title: 'قيد السنة السابقة' })], total: 1 } } });
  await click(button(ui, 'إضافة قيد'));
  await input(ui.container.querySelector('[aria-label="عنوان القيد"]'), 'مسودة لا تنتقل');
  await input(ui.container.querySelector('[aria-label="سنة السجلات الدراسية"]'), '2');
  assert.equal(ui.container.querySelector('[role="dialog"]'), null);
  assert.match(ui.container.textContent, /قيد السنة السابقة/);
  await act(async () => pending.resolve({ data: { entries: [entry({ title: 'قيد السنة القديمة المتأخر' })], total: 1 } }));
  assert.doesNotMatch(ui.container.textContent, /قيد السنة القديمة المتأخر|مسودة لا تنتقل/);
  await ui.render({ registerKey: 'meetings' });
  assert.match(ui.container.textContent, /سجل الاجتماعات/);
});

test('server rows outside the requested school/year/register are rejected before display', async t => {
  const ui = await mount(t, {}, { list: async () => ({ data: { entries: [entry({ school_id: 2, title: 'بيانات خارج المدرسة' })], total: 1 } }) });
  assert.match(ui.container.querySelector('[role="alert"]').textContent, /لم تتطابق/);
  assert.doesNotMatch(ui.container.textContent, /بيانات خارج المدرسة/);
});

test('creates and edits scoped entries with exact extra fields and version conflict leaves draft intact', async t => {
  const calls = []; let rows = [];
  const ui = await mount(t, {}, {
    list: async () => ({ data: { entries: rows, total: rows.length } }),
    create: async (scope, value) => { calls.push({ scope, value }); rows = [entry({ ...scope, ...value })]; return { data: rows[0] }; },
    update: async (id, scope, version, value) => { calls.push({ id, scope, version, value }); return { error: 'تغير القيد. أعد تحميله.', status: 409 }; },
  });
  await click(button(ui, 'إضافة قيد'));
  await input(ui.container.querySelector('[aria-label="عنوان القيد"]'), 'أمر تنظيم اللجنة');
  await input(ui.container.querySelector('[aria-label="تاريخ القيد"]'), '2026-10-08');
  await input(ui.container.querySelector('[aria-label="موضوع الأمر"]'), 'النص الكامل للأمر');
  await click(button(ui, 'إضافة حقل'));
  await input(ui.container.querySelector('[aria-label="عنوان الحقل الإضافي 1"]'), 'مرجع المتابعة');
  await input(ui.container.querySelector('[aria-label="قيمة الحقل الإضافي 1"]'), 'كتاب 44');
  await submit(ui.container.querySelector('.sr-editor'));
  assert.deepEqual(calls[0].scope, { school_id: 1, academic_year_id: 3, register_key: 'school-orders' });
  assert.deepEqual(calls[0].value.data.extra_fields, [{ label: 'مرجع المتابعة', value: 'كتاب 44' }]);
  assert.equal(calls[0].value.entry_date, '2026-10-08');
  assert.match(ui.container.textContent, /حُفظ القيد بنجاح/);
  await click(button(ui, 'تعديل'));
  await input(ui.container.querySelector('[aria-label="عنوان القيد"]'), 'التعديل المحتفظ به');
  await submit(ui.container.querySelector('.sr-editor'));
  assert.equal(calls[1].version, 1);
  assert.equal(ui.container.querySelector('[aria-label="عنوان القيد"]').value, 'التعديل المحتفظ به');
  assert.match(ui.container.querySelector('[role="alert"]').textContent, /تغير القيد/);
});

test('void requires a reason, preserves a clear audit message, and sends original version and scope', async t => {
  const calls = [];
  const ui = await mount(t, {}, { void: async (id, scope, version, reason) => { calls.push({ id, scope, version, reason }); return { data: entry({ ...scope, status: 'voided', version: 2, void_reason: reason }) }; } });
  await click(button(ui, 'إبطال'));
  assert.equal(button(ui, 'تأكيد الإبطال').disabled, true);
  await input(ui.container.querySelector('[aria-label="سبب إبطال القيد"]'), 'قيد مكرر');
  await submit(ui.container.querySelector('.sr-editor'));
  assert.deepEqual(calls, [{ id: 1, scope: { school_id: 1, academic_year_id: 3, register_key: 'school-orders' }, version: 1, reason: 'قيد مكرر' }]);
  assert.match(ui.container.textContent, /أُبطل القيد مع حفظ تاريخه/);
});

test('evaluation keeps null distinct from zero and shows total only for all twenty scores', async t => {
  const evaluation = emptyEvaluation(); evaluation.visits[0] = { date: '2026-10-01', scores: [...Array(19).fill(5), null] };
  assert.deepEqual(evaluationSummary(evaluation.visits[0].scores), { completed: 19, missing: 1, total: null });
  const calls = [];
  const ui = await mount(t, { registerKey: 'teacher-evaluation' }, {
    list: async scope => ({ data: { entries: [entry({ ...scope, data: { employee_id: 11, teacher_name: 'مدرس الاختبار', evaluation } })], total: 1 } }),
    update: async (id, scope, version, value) => { calls.push(value); return { data: entry({ ...scope, ...value, id, version: 2 }) }; },
  });
  await click(button(ui, 'تعديل'));
  const table = ui.container.querySelector('.sr-evaluation-table');
  assert.equal(table.querySelectorAll('tbody select').length, 80);
  assert.equal(table.querySelector('tfoot bdi[dir="ltr"]').textContent, '19 / 20');
  assert.match(table.textContent, /1 خانة متبقية/);
  assert.doesNotMatch(table.textContent, /95 \/ 100/);
  await input(ui.container.querySelector('[aria-label="درجة المعيار 20 — الزيارة الأولى"]'), '5');
  assert.match(table.textContent, /100 \/ 100/);
  assert.ok([...table.querySelectorAll('tfoot bdi[dir="ltr"]')].some(value => value.textContent === '100 / 100'));
  await submit(ui.container.querySelector('.sr-editor'));
  assert.equal(calls[0].data.employee_id, 11);
  assert.equal(calls[0].data.evaluation.visits[1].scores.every(score => score === null), true);
  assert.equal(calls[0].data.evaluation.visits[1].date, null);
});

test('blank preview uses the selected school logo/year and closes immediately when school changes', async t => {
  const ui = await mount(t);
  await click(button(ui, 'نموذج فارغ'));
  const preview = document.querySelector('.school-register-print-preview');
  assert.ok(preview);
  assert.match(preview.textContent, /مدرسة الاختبار 1|2026–2027/);
  assert.equal(preview.querySelector('.sr-print-page img').getAttribute('src'), '/logo-1.png');
  assert.match(preview.textContent, /قالب مقترح للمراجعة/);
  assert.match(preview.textContent, /اسم وتوقيع مدير المدرسة/);
  await ui.render({ schoolId: 2 });
  assert.equal(document.querySelector('.school-register-print-preview'), null);
});

test('whole-register printing loads every result with filters and rejects a late response after scope changes', async t => {
  const calls = [], pending = deferred();
  const ui = await mount(t, {}, { list: async (scope, filters) => { calls.push({ scope, filters }); if (filters.page_size === 100) return pending.promise; return { data: { entries: [entry(scope)], total: 25 } }; } });
  await click(button(ui, 'طباعة السجل'));
  assert.equal(calls.at(-1).filters.page_size, 100);
  await ui.render({ registerKey: 'meetings' });
  await act(async () => pending.resolve({ data: { entries: Array.from({ length: 25 }, (_, index) => entry({ id: index + 1 })), total: 25 } }));
  assert.equal(document.querySelector('.school-register-print-preview'), null);
});

test('register printing includes all pages of matching entries rather than only the visible twelve', async t => {
  const calls = [], all = Array.from({ length: 101 }, (_, index) => entry({ id: index + 1, title: `القيد المتسلسل ${index + 1}` }));
  const ui = await mount(t, {}, { list: async (scope, filters) => { calls.push(filters); const start = ((filters.page || 1) - 1) * filters.page_size; return { data: { entries: all.slice(start, start + filters.page_size), total: all.length } }; } });
  assert.equal(ui.container.querySelectorAll('.sr-entry-card').length, 12);
  await click(button(ui, 'طباعة السجل'));
  const printed = document.querySelector('.school-register-document');
  assert.ok(printed);
  assert.match(printed.textContent, /القيد المتسلسل 101/);
  assert.equal(calls.filter(call => call.page_size === 100).length, 2);
  assert.equal(printed.querySelectorAll('.sr-print-header').length, 101);
  assert.equal(printed.querySelectorAll('img[alt="شعار مدرسة الاختبار 1"]').length, 101);
});

test('a failed school logo falls back cleanly without leaving a broken image', async t => {
  const ui = await mount(t);
  const logo = ui.container.querySelector('img');
  await act(async () => logo.dispatchEvent(new window.Event('error')));
  assert.equal(ui.container.querySelector('img'), null);
  assert.ok(ui.container.querySelector('[aria-label="تعذر تحميل شعار المدرسة"]'));
});

test('history rejects another entry or school instead of displaying the audit payload', async t => {
  const ui = await mount(t, {}, { history: async () => ({ data: { history: [{ id: 1, entry_id: 1, action: 'created', version: 1, actor_name: 'اسم حساس', after: entry({ school_id: 2 }) }], total: 1 } }) });
  await click(button(ui, 'التعديلات'));
  assert.match(ui.container.textContent, /تعذر التحقق من نطاق/);
  assert.doesNotMatch(ui.container.textContent, /اسم حساس/);
});

test('pagination splitting preserves Arabic, line breaks and supplementary characters without loss', () => {
  const original = 'نص عربي طويل\n'.repeat(200) + '🔬خاتمة';
  assert.equal(splitPrintValue(original).join(''), original);
  assert.ok(splitPrintValue(original).length > 1);
});

test('Arabic register numbers and a reset button recover an empty catalogue search', async t => {
  const ui = await mount(t, { registerKey: undefined });
  await input(ui.container.querySelector('[aria-label="البحث في فهرس السجلات"]'), '٢٩');
  assert.equal(ui.container.querySelectorAll('.sr-register-card').length, 1);
  assert.match(ui.container.querySelector('.sr-register-number').textContent, /29/);
  await input(ui.container.querySelector('[aria-label="البحث في فهرس السجلات"]'), 'لا يوجد هذا السجل');
  await click(button(ui, 'عرض جميع السجلات'));
  assert.equal(ui.container.querySelectorAll('.sr-register-card').length, 29);
});

test('clearing an applied search resets pagination while preserving the chosen status', async t => {
  const calls = [];
  const ui = await mount(t, {}, { list: async (scope, filters) => { calls.push(filters); return { data: { entries: [], total: 0 } }; } });
  await input(ui.container.querySelector('[aria-label="حالة قيد السجل"]'), 'voided');
  await input(ui.container.querySelector('[aria-label="البحث في قيود السجل"]'), 'كتاب 44');
  await submit(ui.container.querySelector('.sr-list-filters'));
  assert.match(ui.container.querySelector('.sr-applied-search').textContent, /كتاب 44/);
  await click(button(ui, 'مسح البحث'));
  assert.equal(calls.at(-1).search, '');
  assert.equal(calls.at(-1).status, 'voided');
  assert.equal(calls.at(-1).page, 1);
  assert.equal(ui.container.querySelector('.sr-applied-search'), null);
});

test('preview traps focus, isolates the background and restores its opener with Escape', async t => {
  const ui = await mount(t), opener = button(ui, 'نموذج فارغ');
  opener.focus(); await click(opener);
  const preview = document.querySelector('.school-register-print-preview');
  assert.equal(document.activeElement, preview);
  assert.equal(ui.container.inert, true);
  const first = preview.querySelector('button'), last = [...preview.querySelectorAll('button')].at(-1);
  last.focus(); await key(last, 'Tab'); assert.equal(document.activeElement, first);
  first.focus(); await key(first, 'Tab', { shiftKey: true }); assert.equal(document.activeElement, last);
  await key(last, 'Escape');
  assert.equal(document.querySelector('.school-register-print-preview'), null);
  assert.equal(document.activeElement, opener);
  assert.equal(ui.container.inert, false);
  assert.equal(document.body.style.overflow, '');
});

test('nested preview returns focus to details and scope changes release every dialog lock', async t => {
  const ui = await mount(t), opener = button(ui, 'عرض التفاصيل');
  opener.focus(); await click(opener);
  const detail = ui.container.querySelector('[role="dialog"]'), print = button(ui, 'طباعة القيد');
  print.focus(); await click(print);
  await key(document.activeElement, 'Escape');
  assert.equal(document.querySelector('.school-register-print-preview'), null);
  assert.equal(ui.container.querySelector('[role="dialog"]'), detail);
  assert.equal(document.activeElement, print);
  assert.equal(document.body.style.overflow, 'hidden');
  await click(print);
  await ui.render({ schoolId: 2 });
  assert.equal(document.querySelector('[role="dialog"]'), null);
  assert.equal(document.body.style.overflow, '');
  assert.equal(ui.container.inert, false);
});

test('closing a dirty editor preserves its draft until explicit discard', async t => {
  const ui = await mount(t), opener = button(ui, 'إضافة قيد');
  opener.focus(); await click(opener);
  const title = ui.container.querySelector('[aria-label="عنوان القيد"]');
  await input(title, 'مسودة مهمة');
  await key(title, 'Escape');
  assert.match(ui.container.querySelector('.sr-discard-confirmation').textContent, /تعديلات لم تُحفظ/);
  assert.equal(title.value, 'مسودة مهمة');
  const unloading = new window.Event('beforeunload', { cancelable: true });
  window.dispatchEvent(unloading); assert.equal(unloading.defaultPrevented, true);
  await click(button(ui, 'متابعة التحرير'));
  assert.equal(title.value, 'مسودة مهمة');
  assert.equal(ui.container.querySelector('.sr-discard-confirmation'), null);
  await click(button(ui, 'إلغاء'));
  await click(button(ui, 'تجاهل التعديلات وإغلاق'));
  assert.equal(ui.container.querySelector('[role="dialog"]'), null);
  assert.equal(document.activeElement, opener);
  const cleanUnload = new window.Event('beforeunload', { cancelable: true });
  window.dispatchEvent(cleanUnload); assert.equal(cleanUnload.defaultPrevented, false);
});

test('409 recovery requires explicit draft replacement and saves the newest version', async t => {
  const calls = []; let current = entry();
  const ui = await mount(t, {}, {
    list: async () => ({ data: { entries: [current], total: 1 } }),
    update: async (id, scope, version, value) => {
      calls.push(version);
      if (version === 1) { current = entry({ version: 2, title: 'نسخة مستخدم آخر' }); return { error: 'تغير القيد. أعد تحميله.', status: 409 }; }
      current = entry({ ...scope, ...value, id, version: version + 1 }); return { data: current };
    },
    history: async () => ({ data: { history: [{ entry_id: 1, version: current.version, after: current }], total: 2 } }),
  });
  await click(button(ui, 'تعديل'));
  await input(ui.container.querySelector('[aria-label="عنوان القيد"]'), 'مسودتي المتعارضة');
  await submit(ui.container.querySelector('.sr-editor'));
  assert.equal(ui.container.querySelector('[aria-label="عنوان القيد"]').value, 'مسودتي المتعارضة');
  assert.match(ui.container.querySelector('.sr-conflict-reload').textContent, /سيستبدل تعديلاتك غير المحفوظة/);
  await click(button(ui, 'استبدال مسودتي بأحدث نسخة'));
  assert.equal(ui.container.querySelector('[aria-label="عنوان القيد"]').value, 'نسخة مستخدم آخر');
  await input(ui.container.querySelector('[aria-label="عنوان القيد"]'), 'دمج التعديل على النسخة الأحدث');
  await submit(ui.container.querySelector('.sr-editor'));
  assert.deepEqual(calls, [1, 2]);
  assert.match(ui.container.textContent, /حُفظ القيد بنجاح/);
});

test('conflict reload rejects a different entry and retains the unsaved draft', async t => {
  const ui = await mount(t, {}, {
    update: async () => ({ error: 'تغير القيد', status: 409 }),
    history: async () => ({ data: { history: [{ entry_id: 1, version: 2, after: entry({ id: 99, version: 2, title: 'قيد آخر' }) }], total: 1 } }),
  });
  await click(button(ui, 'تعديل'));
  await input(ui.container.querySelector('[aria-label="عنوان القيد"]'), 'مسودة محفوظة في المحرر');
  await submit(ui.container.querySelector('.sr-editor'));
  await click(button(ui, 'استبدال مسودتي بأحدث نسخة'));
  assert.equal(ui.container.querySelector('[aria-label="عنوان القيد"]').value, 'مسودة محفوظة في المحرر');
  assert.match(ui.container.querySelector('[role="alert"]').textContent, /بقيت مسودتك دون تغيير/);
});

test('saving blocks Escape and every discard action until the request completes', { timeout: 5000 }, async t => {
  const pending = deferred();
  const ui = await mount(t, {}, { create: async () => pending.promise });
  await click(button(ui, 'إضافة قيد'));
  await input(ui.container.querySelector('[aria-label="عنوان القيد"]'), 'قيد قيد الحفظ');
  await click(button(ui, 'إلغاء'));
  await act(async () => ui.container.querySelector('.sr-editor').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
  const dialog = ui.container.querySelector('[role="dialog"]');
  assert.equal(button(ui, 'تجاهل التعديلات وإغلاق').disabled, true);
  dialog.focus(); await key(dialog, 'Tab');
  assert.equal(document.activeElement === dialog, true, 'fieldset descendants must not become focus targets while disabled');
  await key(dialog, 'Escape');
  assert.equal(ui.container.querySelector('[role="dialog"]'), dialog);
  await act(async () => pending.resolve({ data: entry() }));
  assert.equal(ui.container.querySelector('[role="dialog"]'), null);
});
