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
const { AutomaticTimetableTab } = await vite.ssrLoadModule('/src/modules/timetable/AutomaticTimetableTab.tsx');
after(async () => { await vite.close(); await window.happyDOM.close(); });

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function gridFixture({ occupiedTarget = false, lockedSource = false, lockedTarget = false, parallelSource = false, parallelTarget = false } = {}) {
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
  const grid = {
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
        slot_index: 1, slot_type: 'lesson', lesson_number: 1, label: 'الدرس الأول',
        start_time: '08:00', end_time: '08:40', is_active: 1, created_at: 1, updated_at: 1,
      },
      {
        id: 12, school_id: 1, academic_year_id: 1, day_of_week: 0,
        slot_index: 2, slot_type: 'lesson', lesson_number: 2, label: 'الدرس الثاني',
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
  for (const [enabled, id, primaryId, subjectName, employeeName] of [
    [parallelSource, 103, 101, 'التربية المسيحية', 'مدرس التربية المسيحية'],
    [parallelTarget, 104, 102, 'اللغة الإنكليزية', 'مدرس اللغة الإنكليزية'],
  ]) {
    if (!enabled) continue;
    const primary = grid.loads.find(load => load.id === primaryId);
    const entry = entries.find(item => item.teaching_load_id === primaryId);
    grid.loads.push({...primary, id, parallel_with_load_id: primaryId, subject_id: id + 100, subject_name: subjectName, employee_id: id + 200, employee_name: employeeName});
    entries.push({...entry, id: id + 400, teaching_load_id: id, subject_id: id + 100, subject_name: subjectName, employee_id: id + 200, employee_name: employeeName, is_locked: 0});
  }
  return grid;
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
    if (path === '/api/timetable/entries/lock-scope' && method === 'PUT') {
      grid.entries.forEach(entry => { entry.is_locked = body.is_locked; });
      grid.revision += 1;
      return response({ data: { affected_count: grid.entries.length, is_locked: body.is_locked, revision: grid.revision } });
    }
    const match = path.match(/^\/api\/timetable\/entries\/(\d+)\/drop$/);
    if (match && method === 'PUT') {
      if (options.dropFailure) return response(options.dropFailure.body, options.dropFailure.status);
      const source = grid.entries.find((entry) => entry.id === Number(match[1]));
      const target = body.target_entry_id == null
        ? null
        : grid.entries.find((entry) => entry.id === body.target_entry_id);
      const sourceSlot = source.slot_id;
      const members = entry => {
        const load = grid.loads.find(load => load.id === entry.teaching_load_id);
        const primaryId = load.parallel_with_load_id || load.id;
        const ids = grid.loads.filter(load => load.id === primaryId || load.parallel_with_load_id === primaryId).map(load => load.id);
        return grid.entries.filter(item => item.slot_id === entry.slot_id && ids.includes(item.teaching_load_id));
      };
      const sourceGroup = members(source), targetGroup = target ? members(target) : [];
      sourceGroup.forEach(entry => {entry.slot_id = body.target_slot_id;});
      targetGroup.forEach(entry => {entry.slot_id = sourceSlot;});
      if (options.teacherConflictAfterDrop) {
        source.hard_conflicts = [{
          code: 'teacher_collision',
          message: 'المدرس مرتبط بدرس آخر في الفترة نفسها',
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
            message: 'المدرس مرتبط بدرس آخر في الفترة نفسها',
          }] : [],
        },
      });
    }
    const editMatch = path.match(/^\/api\/timetable\/entries\/(\d+)$/);
    if (editMatch && method === 'PUT') {
      const entry = grid.entries.find((candidate) => candidate.id === Number(editMatch[1]));
      const load = grid.loads.find((candidate) => candidate.id === body.teaching_load_id);
      entry.teaching_load_id = load.id;
      entry.subject_id = load.subject_id;
      entry.subject_name = load.subject_name;
      entry.employee_id = load.employee_id;
      entry.employee_name = load.employee_name;
      grid.revision += 1;
      return response({ data: structuredClone(entry), meta: { warnings: [] } });
    }
    throw new Error(`Unexpected request ${method} ${path}`);
  };
  const container = document.createElement('div');
  document.body.append(container);
  const rootElement = createRoot(container);
  await act(async () => rootElement.render(createElement(TimetableGridTab, {
    schoolId: 1,
    academicYearId: 1,
    classes: [{ id: 1, school_id: 1, name: 'الأول المتوسط', stage: 'متوسط', status: 'active' }],
    sections: [],
    onChanged: async () => { changed += 1; },
  })));
  await changeSelect(container.querySelector('select[aria-label="صف الجدول اليدوي"]'), '1');
  await waitFor(() => container.textContent.includes('تغيير مكان الدرس بالسحب والإفلات'), 'weekly grid');
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
  assert.match(ui.container.querySelector('[role="status"]').textContent, /تم نقل درس الرياضيات/);
});

test('an existing lesson offers a direct subject change and refreshes the same cell', async (t) => {
  const ui = await mount(t, { occupiedTarget: true });
  const originalCell = ui.container.querySelector('[data-timetable-drop-slot="11"]');
  const editButton = [...originalCell.querySelectorAll('button')].find((button) => button.textContent === 'تغيير المادة');
  await act(async () => editButton.click());
  const dialog = ui.container.querySelector('[role="dialog"][aria-label="تغيير مادة الدرس"]');
  assert.ok(dialog);
  const alternative = [...dialog.querySelectorAll('button')].find((button) => button.textContent.includes('اللغة العربية'));
  await act(async () => alternative.click());
  await waitFor(() => ui.changed === 1, 'lesson replacement refresh');
  const request = ui.calls.find((call) => call.path === '/api/timetable/entries/501' && call.method === 'PUT');
  assert.deepEqual(request.body, {
    school_id: 1, academic_year_id: 1, slot_id: 11,
    teaching_load_id: 102, expected_revision: 17,
  });
  assert.match(originalCell.textContent, /اللغة العربية/);
  assert.doesNotMatch(originalCell.textContent, /الرياضيات/);
});

test('manual stage pin action sends its exact scope with current revision and reloads locks', async t => {
  const ui = await mount(t);
  const previousConfirm = window.confirm;
  window.confirm = () => true; t.after(() => { window.confirm = previousConfirm; });
  await changeSelect(ui.container.querySelector('select[aria-label="نطاق التثبيت"]'), 'stage');
  const button = [...ui.container.querySelectorAll('button')].find(item => item.textContent === 'تثبيت دروس النطاق');
  await act(async () => button.click());
  await waitFor(() => ui.changed === 1, 'bulk lock refresh');
  assert.deepEqual(ui.calls.find(call => call.path.endsWith('/lock-scope')).body, {
    school_id: 1, academic_year_id: 1, expected_revision: 17, scope: { kind: 'stage', stage: 'متوسط' }, is_locked: 1,
  });
  assert.equal(ui.container.querySelector('[data-timetable-drag-entry="501"]')?.getAttribute('draggable'), 'false');
  assert.match(ui.container.textContent, /الدرس المثبت/);
});

test('automatic scope controls request the selected stage, class and section rather than only filtering display', async t => {
  const calls = [], previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ path: String(url), body: JSON.parse(init.body) });
    return response({ error: 'معاينة الاختبار' }, 400);
  };
  const container = document.createElement('div'); document.body.append(container);
  const element = createRoot(container);
  t.after(async () => { globalThis.fetch = previousFetch; await act(async () => element.unmount()); container.remove(); });
  await act(async () => element.render(createElement(AutomaticTimetableTab, {
    schoolId: 1, academicYearId: 1, dataVersion: 1, readiness: null, onAdopted: async () => {},
    classes: [{ id: 1, school_id: 1, name: 'الأول', stage: 'ابتدائي', status: 'active' }],
    sections: [{ id: 21, school_id: 1, class_id: 1, name: 'أ', status: 'active' }],
  })));
  for (const [value, expected] of [['stage:ابتدائي', { kind: 'stage', stage: 'ابتدائي' }], ['class:1', { kind: 'class', class_id: 1 }],
    ['section:21', { kind: 'section', class_id: 1, section_id: 21 }]]) {
    await changeSelect(container.querySelector('select[aria-label="نطاق التوليد"]'), value);
    await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === 'إنشاء جدول تلقائي').click());
    assert.deepEqual(calls.at(-1).body.generation_scope, expected);
    assert.equal(calls.at(-1).path, '/api/timetable/solver/prepare');
  }
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
  assert.match(ui.container.querySelector('[role="status"]').textContent, /تم تبديل درس الرياضيات مع درس اللغة العربية/);
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

test('parallel source and target are visible and drop treats the target pair as one swappable group', async t => {
  const ui = await mount(t, {occupiedTarget: true, parallelSource: true, parallelTarget: true});
  const sourceCell = ui.container.querySelector('[data-timetable-drop-slot="11"]');
  const targetCell = ui.container.querySelector('[data-timetable-drop-slot="12"]');
  assert.equal(sourceCell.querySelectorAll('[data-timetable-entry]').length, 2);
  assert.equal(targetCell.querySelectorAll('[data-timetable-entry]').length, 2);
  await drag(ui.container.querySelector('[data-timetable-drag-entry="503"]'), targetCell);
  await waitFor(() => ui.changed === 1, 'paired swap refresh');
  assert.equal(ui.calls.find(call => call.path.endsWith('/503/drop')).body.target_entry_id, 502);
  assert.match(sourceCell.textContent, /اللغة العربية/);assert.match(sourceCell.textContent, /اللغة الإنكليزية/);
  assert.match(targetCell.textContent, /الرياضيات/);assert.match(targetCell.textContent, /التربية المسيحية/);
});

test('a locked partner prevents dragging either member even when the selected member itself is unlocked', async t => {
  const ui = await mount(t, {parallelSource: true, lockedSource: true});
  for (const id of [501, 503]) assert.equal(ui.container.querySelector(`[data-timetable-drag-entry="${id}"]`).getAttribute('draggable'), 'false');
  assert.equal(ui.calls.some(call => call.path.endsWith('/drop')), false);
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
  const dialog = ui.container.querySelector('[role="dialog"][aria-label="نقل الدرس"]');
  assert.ok(dialog);
  assert.match(dialog.textContent, /اختر فترة فعالة أخرى/);
  assert.match(dialog.textContent, /خانة فارغة — نقل/);
  assert.equal(ui.calls.some((call) => call.path.endsWith('/501/drop')), false);
});
