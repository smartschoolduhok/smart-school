import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { Window } from 'happy-dom';
import { createServer } from 'vite';
import { root } from './helpers/finance-fixture.mjs';

const window = new Window({ url: 'http://localhost', width: 1280, height: 900 });
for (const key of [
  'window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement',
  'Node', 'Event', 'MouseEvent', 'localStorage', 'sessionStorage',
]) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: key === 'window' ? window : window[key],
  });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.alert = () => {};
const { createElement, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const vite = await createServer({ root, appType: 'custom', server: { middlewareMode: true, hmr: false } });
const { TimetableGridTab } = await vite.ssrLoadModule('/src/modules/timetable/TimetableGridTab.tsx');
after(async () => { await vite.close(); await window.happyDOM.close(); });

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function gridFixture({ occupiedTarget = false, lockedSource = false, lockedTarget = false } = {}) {
  const baseEntry = {
    school_id: 1,
    academic_year_id: 1,
    created_by_user_id: 1,
    updated_by_user_id: 1,
    created_at: 100,
    updated_at: 100,
    class_id: 1,
    class_name: 'الأول المتوسط',
    section_id: null,
    section_name: null,
    weekly_periods: 4,
    load_status: 'active',
    hard_conflicts: [],
    warnings: [],
  };
  const entries = [{
    ...baseEntry,
    id: 501,
    slot_id: 11,
    teaching_load_id: 101,
    subject_id: 201,
    subject_name: 'الرياضيات',
    employee_id: 301,
    employee_name: 'مدرس الرياضيات',
    is_locked: lockedSource ? 1 : 0,
  }];
  if (occupiedTarget) entries.push({
    ...baseEntry,
    id: 502,
    slot_id: 12,
    teaching_load_id: 102,
    subject_id: 202,
    subject_name: 'اللغة العربية',
    employee_id: 302,
    employee_name: 'مدرس اللغة العربية',
    is_locked: lockedTarget ? 1 : 0,
  });
  return {
    school_id: 1,
    academic_year_id: 1,
    revision: 17,
    class_id: 1,
    section_id: null,
    days: [{
      id: 1, school_id: 1, academic_year_id: 1, day_of_week: 0,
      is_active: 1, order_index: 0, created_at: 1, updated_at: 1,
    }],
    slots: [
      {
        id: 11, school_id: 1, academic_year_id: 1, day_of_week: 0,
        slot_index: 1, slot_type: 'lesson', lesson_number: 1, label: 'الحصة الأولى',
        start_time: '08:00', end_time: '08:40', is_active: 1, created_at: 1, updated_at: 1,
      },
      {
        id: 12, school_id: 1, academic_year_id: 1, day_of_week: 0,
        slot_index: 2, slot_type: 'lesson', lesson_number: 2, label: 'الحصة الثانية',
        start_time: '08:40', end_time: '09:20', is_active: 1, created_at: 1, updated_at: 1,
      },
    ],
    entries,
    historical_entries: [],
    loads: [
      {
        id: 101, school_id: 1, academic_year_id: 1, class_id: 1, section_id: null,
        subject_id: 201, subject_name: 'الرياضيات', employee_id: 301,
        employee_name: 'مدرس الرياضيات', weekly_periods: 4, status: 'active',
        created_at: 1, updated_at: 1, total_placements: 1, scheduled_periods: 1,
        invalid_placements: 0, remaining_periods: 3,
      },
      ...(occupiedTarget ? [{
        id: 102, school_id: 1, academic_year_id: 1, class_id: 1, section_id: null,
        subject_id: 202, subject_name: 'اللغة العربية', employee_id: 302,
        employee_name: 'مدرس اللغة العربية', weekly_periods: 4, status: 'active',
        created_at: 1, updated_at: 1, total_placements: 1, scheduled_periods: 1,
        invalid_placements: 0, remaining_periods: 3,
      }] : []),
    ],
  };
}

async function waitFor(check, message) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (check()) return;
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
  }
  assert.fail(`Timed out waiting for ${message}`);
}

async function changeSelect(select, value) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, value);
    select.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
}

function makeDataTransfer() {
  const values = new Map();
  return {
    effectAllowed: 'none',
    dropEffect: 'none',
    setData(type, value) { values.set(type, value); },
    getData(type) { return values.get(type) || ''; },
  };
}

function dragEvent(type, dataTransfer) {
  const event = new window.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { configurable: true, value: dataTransfer });
  return event;
}

async function mount(t, options = {}) {
  let grid = gridFixture(options);
  const calls = [];
  let changed = 0;
  const previousFetch = globalThis.fetch;
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('smart_school_token', 'local-timetable-ui-token');
  globalThis.fetch = async (url, init = {}) => {
    const path = String(url);
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ path, method, body });
    if (path.startsWith('/api/timetable/grid?')) return response({ data: structuredClone(grid) });
    const match = path.match(/^\/api\/timetable\/entries\/(\d+)\/drop$/);
    if (match && method === 'PUT') {
      if (options.dropFailure) return response(options.dropFailure.body, options.dropFailure.status);
      const source = grid.entries.find((entry) => entry.id === Number(match[1]));
      const target = body.target_entry_id == null
        ? null
        : grid.entries.find((entry) => entry.id === body.target_entry_id);
      const sourceSlot = source.slot_id;
      source.slot_id = body.target_slot_id;
      if (target) target.slot_id = sourceSlot;
      if (options.teacherConflictAfterDrop) {
        source.hard_conflicts = [{
          code: 'teacher_collision',
          message: 'المدرس مرتبط بحصة أخرى في الفترة نفسها',
        }];
      }
      grid.revision += target ? 3 : 1;
      return response({
        data: {
          operation: target ? 'swap' : 'move',
          entries: structuredClone(target ? [source, target] : [source]),
          revision: grid.revision,
        },
        meta: {
          warnings: [],
          conflicts: options.teacherConflictAfterDrop ? [{
            code: 'teacher_collision',
            message: 'المدرس مرتبط بحصة أخرى في الفترة نفسها',
          }] : [],
        },
      });
    }
    throw new Error(`Unexpected request ${method} ${path}`);
  };
  const container = document.createElement('div');
  document.body.append(container);
  const rootElement = createRoot(container);
  await act(async () => rootElement.render(createElement(TimetableGridTab, {
    schoolId: 1,
    academicYearId: 1,
    classes: [{ id: 1, school_id: 1, name: 'الأول المتوسط', status: 'active' }],
    sections: [],
    onChanged: async () => { changed += 1; },
  })));
  await changeSelect(container.querySelector('select'), '1');
  await waitFor(() => container.textContent.includes('تغيير مكان الحصة بالسحب والإفلات'), 'weekly grid');
  t.after(async () => {
    globalThis.fetch = previousFetch;
    localStorage.clear();
    sessionStorage.clear();
    await act(async () => rootElement.unmount());
    container.remove();
  });
  return { container, calls, get changed() { return changed; } };
}

async function drag(handle, target) {
  const dataTransfer = makeDataTransfer();
  await act(async () => handle.dispatchEvent(dragEvent('dragstart', dataTransfer)));
  await act(async () => target.dispatchEvent(dragEvent('dragover', dataTransfer)));
  assert.match(target.className, /ring-emerald-400/);
  await act(async () => target.dispatchEvent(dragEvent('drop', dataTransfer)));
}

test('mouse drag to an empty cell sends revision-fenced move and refreshes the grid', async (t) => {
  const ui = await mount(t);
  const handle = ui.container.querySelector('[data-timetable-drag-entry="501"]');
  const target = ui.container.querySelector('[data-timetable-drop-slot="12"]');
  assert.equal(handle.getAttribute('draggable'), 'true');
  await drag(handle, target);
  await waitFor(() => ui.calls.some((call) => call.path.endsWith('/501/drop')), 'drop request');
  const request = ui.calls.find((call) => call.path.endsWith('/501/drop'));
  assert.deepEqual(request.body, {
    school_id: 1,
    academic_year_id: 1,
    source_slot_id: 11,
    target_slot_id: 12,
    target_entry_id: null,
    expected_revision: 17,
  });
  await waitFor(() => ui.changed === 1, 'parent refresh');
  assert.match(target.textContent, /الرياضيات/);
  assert.match(ui.container.querySelector('[role="status"]').textContent, /تم نقل حصة الرياضيات/);
});

test('mouse drop on another subject requests an atomic swap and renders both new positions', async (t) => {
  const ui = await mount(t, { occupiedTarget: true });
  const sourceHandle = ui.container.querySelector('[data-timetable-drag-entry="501"]');
  const targetCell = ui.container.querySelector('[data-timetable-drop-slot="12"]');
  await drag(sourceHandle, targetCell);
  await waitFor(() => ui.changed === 1, 'swap refresh');
  const request = ui.calls.find((call) => call.path.endsWith('/501/drop'));
  assert.equal(request.body.target_entry_id, 502);
  assert.equal(request.body.expected_revision, 17);
  assert.match(ui.container.querySelector('[data-timetable-drop-slot="11"]').textContent, /اللغة العربية/);
  assert.match(ui.container.querySelector('[data-timetable-drop-slot="12"]').textContent, /الرياضيات/);
  assert.match(ui.container.querySelector('[role="status"]').textContent, /تم تبديل حصة الرياضيات مع حصة اللغة العربية/);
});

test('accepted teacher collision is colored rose and announced as a visible conflict', async (t) => {
  const ui = await mount(t, { teacherConflictAfterDrop: true });
  await drag(
    ui.container.querySelector('[data-timetable-drag-entry="501"]'),
    ui.container.querySelector('[data-timetable-drop-slot="12"]'),
  );
  await waitFor(() => ui.changed === 1, 'teacher-conflict refresh');
  const card = ui.container.querySelector('[data-timetable-entry="501"]');
  assert.equal(card.getAttribute('data-timetable-teacher-conflict'), 'true');
  assert.match(card.className, /border-rose-400/);
  assert.match(card.className, /bg-rose-100/);
  assert.match(card.textContent, /تعارض المدرّس/);
  assert.match(ui.container.querySelector('[role="alert"]').textContent, /تعارض المدرّس/);
  assert.match(ui.container.querySelector('[role="status"]').textContent, /يوجد تعارض للمدرّس/);
});

test('failed non-collision drop keeps the visible timetable unchanged and reports that nothing changed', async (t) => {
  const ui = await mount(t, {
    dropFailure: {
      status: 409,
      body: { error: 'المدرس غير متاح في هذه الفترة', code: 'teacher_unavailable' },
    },
  });
  await drag(
    ui.container.querySelector('[data-timetable-drag-entry="501"]'),
    ui.container.querySelector('[data-timetable-drop-slot="12"]'),
  );
  await waitFor(() => ui.container.textContent.includes('المدرس غير متاح في هذه الفترة'), 'drop error');
  assert.equal(ui.changed, 0);
  assert.match(ui.container.querySelector('[data-timetable-drop-slot="11"]').textContent, /الرياضيات/);
  assert.doesNotMatch(ui.container.querySelector('[data-timetable-drop-slot="12"]').textContent, /الرياضيات/);
  assert.match(ui.container.querySelector('[role="status"]').textContent, /لم يتغير الجدول/);
});

test('locked lesson cannot be dragged while its click opens the keyboard-accessible move dialog', async (t) => {
  const ui = await mount(t, { lockedSource: true });
  const handle = ui.container.querySelector('[data-timetable-drag-entry="501"]');
  assert.equal(handle.getAttribute('draggable'), 'false');
  assert.equal(handle.getAttribute('aria-describedby'), 'timetable-drag-help');
  await act(async () => handle.click());
  const dialog = ui.container.querySelector('[role="dialog"][aria-label="نقل الحصة"]');
  assert.ok(dialog);
  assert.match(dialog.textContent, /اختر فترة فعالة أخرى/);
  assert.match(dialog.textContent, /خانة فارغة — نقل/);
  assert.equal(ui.calls.some((call) => call.path.endsWith('/501/drop')), false);
});
