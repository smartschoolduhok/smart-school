import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const window = new Window({ url: 'http://localhost', width: 375, height: 812 });
for (const key of ['window', 'document', 'HTMLElement', 'Node', 'Event', 'MouseEvent']) {
  globalThis[key] = key === 'window' ? window : window[key];
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const vite = await createServer({ root, appType: 'custom', server: { middlewareMode: true, hmr: false } });
const { WeekArchivesPanel } = await vite.ssrLoadModule('/src/modules/timetable/WeekArchivesPanel.tsx');
const { TimetableVersionsTab } = await vite.ssrLoadModule('/src/modules/timetable/TimetableVersionsTab.tsx');
after(async () => { await vite.close(); await window.happyDOM.close(); });

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
function summary(id = 1, patch = {}) {
  return { id, school_id: 1, academic_year_id: 1, source_revision: 7, created_by_user_id: 1,
    created_at: 1780000000, day_numbers: [0], period_count: 2, entry_count: 1, ...patch };
}
function detail(id = 1, subject = 'الرياضيات') {
  return { ...summary(id), snapshot: {
    days: [{ id: 1, day_of_week: 0, is_active: 1, order_index: 0 }],
    slots: [{ id: 11, day_of_week: 0, slot_index: 1, slot_type: 'lesson', lesson_number: 1,
      label: 'الدرس الأول', start_time: '08:00', end_time: '08:40', is_active: 1 },
    { id: 12, day_of_week: 0, slot_index: 2, slot_type: 'break', lesson_number: null,
      label: 'استراحة الصباح', start_time: '08:40', end_time: '08:50', is_active: 1 }],
    entries: [{ id: 100, slot_id: 11, teaching_load_id: 20, is_locked: 1 }],
    loads: [{ id: 20, class_id: 2, class_name: 'الأول المتوسط', section_id: 3, section_name: 'أ',
      subject_name: subject, employee_name: 'مدرس الرياضيات' }],
    availability: [],
  } };
}
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function mount(t, fetchResponse, Component = WeekArchivesPanel) {
  const previousFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const parsed = new URL(String(url), 'http://localhost');
    calls.push({ url: parsed, method: options.method || 'GET' });
    return fetchResponse(parsed, options);
  };
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const props = { schoolId: 1, academicYearId: 1, dataVersion: 0, onRestored: async () => {} };
  await act(async () => root.render(createElement(Component, props)));
  t.after(async () => { await act(async () => root.unmount()); container.remove(); globalThis.fetch = previousFetch; });
  return { container, calls, render: async patch => {
    Object.assign(props, patch);
    await act(async () => root.render(createElement(Component, props)));
  } };
}
function button(u, label) {
  const element = [...u.container.querySelectorAll('button')].find(item => item.getAttribute('aria-label') === label || item.textContent === label);
  assert.ok(element, `button ${label}`);
  return element;
}
const click = async element => { await act(async () => element.click()); };
async function waitFor(check, message) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (check()) return;
    await act(async () => new Promise(resolve => setTimeout(resolve, 10)));
  }
  assert.fail(`Timed out: ${message}`);
}

test('archive is read-only and shows the old periods, class, subject and teacher with accessible details', async t => {
  const u = await mount(t, url => response({ data: url.pathname.endsWith('/1') ? detail() : [summary()] }));
  await waitFor(() => u.container.querySelector('table'), 'archive list');
  assert.match(u.container.textContent, /الأحد/);
  assert.match(u.container.textContent, /الجدول الجديد هو المعروض/);
  const open = button(u, 'عرض أرشيف الجدول رقم 1');
  await click(open);
  await waitFor(() => u.container.textContent.includes('الرياضيات'), 'archive content');
  assert.equal(open.getAttribute('aria-expanded'), 'true');
  assert.equal(document.activeElement.textContent, 'الجدول السابق قبل الاستبدال');
  for (const text of ['08:00', '08:40', '08:50', 'الأول المتوسط — أ', 'مدرس الرياضيات', 'درس مثبت', 'استراحة الصباح']) assert.ok(u.container.textContent.includes(text), text);
  assert.ok(u.container.querySelector('[aria-label="الجدول المؤرشف ليوم الأحد"]'));
  assert.ok(u.container.querySelector('.overflow-x-auto'));
  assert.ok([...u.container.querySelectorAll('th')].every(item => item.getAttribute('scope') === 'col'));
  assert.ok(!u.container.textContent.includes('استعادة'));
  assert.deepEqual(u.calls.map(call => call.method), ['GET', 'GET']);
  assert.ok(u.calls.every(call => call.url.searchParams.get('school_id') === '1' && call.url.searchParams.get('academic_year_id') === '1'));
  await click(button(u, 'إغلاق الأرشيف'));
  assert.equal(document.activeElement, open);
  assert.equal(open.getAttribute('aria-expanded'), 'false');
  assert.ok(!u.container.textContent.includes('الرياضيات'));
});

test('newer detail selection wins over a late response and closing prevents reopening', async t => {
  const first = deferred(), second = deferred();
  const u = await mount(t, url => url.pathname.endsWith('/1') ? first.promise : url.pathname.endsWith('/2') ? second.promise : response({ data: [summary(1), summary(2)] }));
  await click(button(u, 'عرض أرشيف الجدول رقم 1'));
  await click(button(u, 'عرض أرشيف الجدول رقم 2'));
  await act(async () => second.resolve(response({ data: detail(2, 'العلوم') })));
  await act(async () => first.resolve(response({ data: detail(1, 'مادة قديمة') })));
  assert.match(u.container.textContent, /العلوم/);
  assert.ok(!u.container.textContent.includes('مادة قديمة'));
  await click(button(u, 'إغلاق الأرشيف'));
  const pending = deferred();
  globalThis.fetch = async () => pending.promise;
  await click(button(u, 'عرض أرشيف الجدول رقم 1'));
  await click(button(u, 'إغلاق الأرشيف'));
  await act(async () => pending.resolve(response({ data: detail() })));
  assert.ok(!u.container.textContent.includes('الرياضيات'));
});

test('school, year and data refresh changes discard pending archive details', async t => {
  for (const change of [{ schoolId: 2 }, { academicYearId: 2 }, { dataVersion: 1 }]) {
    await t.test(Object.keys(change)[0], async subtest => {
      const pending = deferred();
      const u = await mount(subtest, url => url.pathname.endsWith('/1') ? pending.promise : response({ data: [summary()] }));
      await click(button(u, 'عرض أرشيف الجدول رقم 1'));
      await u.render(change);
      await act(async () => pending.resolve(response({ data: detail(1, 'تفاصيل من نطاق سابق') })));
      assert.ok(!u.container.textContent.includes('تفاصيل من نطاق سابق'));
      assert.ok(!u.container.querySelector('[aria-label="تفاصيل أرشيف الجدول رقم 1"]'));
    });
  }
});

test('late archive list responses cannot overwrite a returned school/year scope', async t => {
  const first = deferred(), second = deferred(), latest = deferred();
  let calls = 0;
  const u = await mount(t, () => [first, second, latest][calls++].promise);
  await u.render({ academicYearId: 2 });
  await u.render({ academicYearId: 1 });
  await act(async () => latest.resolve(response({ data: [summary(8)] })));
  await act(async () => first.resolve(response({ data: [summary(1)] })));
  await act(async () => second.resolve(response({ error: 'خطأ من طلب سابق' }, 500)));
  assert.ok(button(u, 'عرض أرشيف الجدول رقم 8'));
  assert.ok(!u.container.querySelector('[aria-label="عرض أرشيف الجدول رقم 1"]'));
  assert.ok(!u.container.textContent.includes('خطأ من طلب سابق'));
});

test('archive list errors are retryable and do not hide existing timetable versions', async t => {
  let failed = true;
  const u = await mount(t, url => {
    if (url.pathname === '/api/timetable/versions') return response({ data: [{ id: 12, created_at: 1780000000, created_by_name: 'مسؤول الجدول', source: 'automatic_adoption', old_entry_count: 20 }] });
    return failed ? response({ error: 'تعذر تحميل الأرشيف' }, 500) : response({ data: [] });
  }, TimetableVersionsTab);
  await waitFor(() => u.container.textContent.includes('تعذر تحميل الأرشيف'), 'independent archive error');
  assert.match(u.container.textContent, /مسؤول الجدول/);
  assert.ok(button(u, 'معاينة الاستعادة'));
  assert.equal(u.container.querySelector('[role="alert"]').textContent, 'تعذر تحميل الأرشيفإعادة تحميل الأرشيف');
  failed = false;
  await click(button(u, 'إعادة تحميل الأرشيف'));
  await waitFor(() => u.container.textContent.includes('لا توجد جداول مستبدلة مؤرشفة بعد.'), 'empty archive');
  assert.match(u.container.textContent, /مسؤول الجدول/);
});

test('archive detail failure keeps the archive list usable', async t => {
  const u = await mount(t, url => url.pathname.endsWith('/1') ? response({ error: 'الأرشيف غير متاح' }, 404) : response({ data: [summary()] }));
  await click(button(u, 'عرض أرشيف الجدول رقم 1'));
  assert.match(u.container.querySelector('[role="alert"]').textContent, /الأرشيف غير متاح/);
  assert.ok(button(u, 'عرض أرشيف الجدول رقم 1'));
  await click(button(u, 'إغلاق الأرشيف'));
  assert.equal(u.container.querySelector('[role="alert"]'), null);
});
