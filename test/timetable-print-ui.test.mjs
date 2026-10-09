import assert from 'node:assert/strict';
import test, {after} from 'node:test';
import {fileURLToPath} from 'node:url';
import {Window} from 'happy-dom';
import {createServer} from 'vite';
import {printFixture} from './helpers/timetable-print-fixture.mjs';

const window = new Window({url: 'http://localhost'});
for (const key of ['window', 'document', 'HTMLElement', 'HTMLSelectElement', 'Node', 'Event', 'MouseEvent']) globalThis[key] = key === 'window' ? window : window[key];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const {createElement, act} = await import('react');
const {createRoot} = await import('react-dom/client');
const vite = await createServer({root: fileURLToPath(new URL('..', import.meta.url)), configFile: false, appType: 'custom', optimizeDeps: {noDiscovery: true, include: []}, esbuild: {jsx: 'automatic'}, server: {middlewareMode: true, hmr: false}});
const {MasterTimetableTab} = await vite.ssrLoadModule('/src/modules/timetable/MasterTimetableTab.tsx');
after(async () => {await vite.close(); await window.happyDOM.close();});
async function mount(t, data = printFixture()) {
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  const props = {schoolId: 1, academicYearId: 1, dataVersion: 0, onOpenRepair() {}, loadGrid: async () => ({data})};
  await act(async () => root.render(createElement(MasterTimetableTab, props)));
  t.after(async () => {await act(async () => root.unmount()); container.remove();});
  return {container, data, async render(patch) {Object.assign(props, patch); await act(async () => root.render(createElement(MasterTimetableTab, props)));}};
}
const select = async (u, label, value) => {const el = u.container.querySelector(`[aria-label="${label}"]`); assert.ok(el, label); await act(async () => {el.value = value; el.dispatchEvent(new Event('change', {bubbles: true}));});};
const button = (u, label) => [...u.container.querySelectorAll('button')].find(el => el.textContent === label);

test('master and section print show both parallel subjects and their teachers in the same cell', async t => {
  const data = printFixture();
  const base = {...data.entries[0], class_id: 1, section_id: 11, section_name: 'أ'};
  data.entries.push({...base, id: 3, teaching_load_id: 3, subject_id: 3, subject_name: 'التربية الإسلامية', employee_id: 8, employee_name: 'أحمد'},
    {...base, id: 4, teaching_load_id: 4, subject_id: 4, subject_name: 'التربية المسيحية', employee_id: 9, employee_name: 'مريم'});
  const u = await mount(t, data);
  const assertPair = () => {
    const card = [...u.container.querySelectorAll('.timetable-subject-card')].find(el => el.textContent.includes('التربية الإسلامية'));
    assert.ok(card);const cell = card.closest('td');
    assert.equal(cell.querySelectorAll('.timetable-subject-card').length, 2);
    for (const text of ['التربية الإسلامية', 'التربية المسيحية', 'أحمد', 'مريم']) assert.ok(cell.textContent.includes(text), text);
    assert.doesNotMatch(cell.textContent, /رياضيات مشتركة/);
  };
  assertPair();
  await act(async () => button(u, 'جدول صف / شعبة').click());
  await select(u, 'شعبة الطباعة', '1:11');
  assertPair();
});

test('print scope controls render separate section/stage sheets and A4/A3 dimensions follow selection', async t => {
  const u = await mount(t);
  await select(u, 'تقسيم الطباعة', 'placement');
  assert.equal(u.container.querySelectorAll('[data-print-sheet]').length, 3);
  assert.equal(u.container.querySelectorAll('.timetable-week-table').length, 3);
  await select(u, 'مرحلة الطباعة', 'ابتدائي');
  assert.equal(u.container.querySelectorAll('[data-print-sheet]').length, 2);
  assert.equal(u.container.querySelector('.timetable-print-root').textContent.includes('فيزياء'), false);
  for (const sheet of u.container.querySelectorAll('[data-print-sheet]')) assert.ok(sheet.textContent.includes('رياضيات مشتركة'));
  await select(u, 'حجم ورق الطباعة', 'A4');
  assert.match(u.container.querySelector('style').textContent, /297mm 210mm/);
  await select(u, 'حجم ورق الطباعة', 'A3');
  assert.match(u.container.querySelector('style').textContent, /420mm 297mm/);
  await select(u, 'مرحلة الطباعة', '');
  await select(u, 'تقسيم الطباعة', 'stage');
  assert.equal(u.container.querySelectorAll('[data-print-sheet]').length, 2);
  assert.deepEqual([...u.container.querySelectorAll('.timetable-print-school h2')].map(e => e.textContent), ['جدول المرحلة ابتدائي', 'جدول المرحلة متوسط']);
});

test('focused section grid shows unequal day blanks, all breaks and times, with both paper sizes', async t => {
  const u = await mount(t);
  await act(async () => button(u, 'جدول صف / شعبة').click());
  assert.equal(button(u, 'طباعة / حفظ PDF').disabled, true);
  await select(u, 'شعبة الطباعة', '1:11');
  assert.equal(button(u, 'طباعة / حفظ PDF').disabled, false);
  assert.equal(u.container.querySelectorAll('[data-slot-id]').length, u.data.slots.length);
  assert.equal(u.container.querySelectorAll('.timetable-week-break').length, 5);
  assert.equal(u.container.querySelectorAll('.timetable-no-period').length, 4);
  assert.match(u.container.querySelector('.timetable-week-table').textContent, /08:00–08:40/);
  assert.match(u.container.querySelector('.timetable-week-table').textContent, /غير مجدولة/);
  await select(u, 'حجم ورق الطباعة', 'A3');
  assert.match(u.container.querySelector('style').textContent, /420mm 297mm/);
  await select(u, 'مرحلة الطباعة', 'متوسط');
  assert.equal(button(u, 'طباعة / حفظ PDF').disabled, true);
});

test('teacher grid prints simultaneous entries and afterprint cleans global print mode', async t => {
  const u = await mount(t);
  await act(async () => button(u, 'جدول مدرس').click());
  await select(u, 'مدرس الطباعة', '7');
  assert.equal(u.container.querySelector(`[data-slot-id="${u.data.slots[0].id}"]`).querySelectorAll('.timetable-subject-card').length, 2);
  const oldPrint = window.print; let prints = 0; window.print = () => {prints++;};
  t.after(() => {window.print = oldPrint;});
  await act(async () => button(u, 'طباعة / حفظ PDF').click());
  assert.equal(prints, 1); assert.ok(document.body.classList.contains('timetable-print-mode'));
  window.dispatchEvent(new Event('afterprint'));
  assert.equal(document.body.classList.contains('timetable-print-mode'), false);
});

test('named placeholder appears once in teacher selector and renders its lessons for print', async t => {
  const data = printFixture();
  const resource = {school_id: 1, academic_year_id: 1, employee_id: null, teacher_placeholder: 'مدرس الإنكليزي', status: 'active'};
  data.loads = [{...resource, id: 11}, {...resource, id: 12}];
  data.entries.push({...data.entries[0], ...resource, id: 11, teaching_load_id: 11, subject_name: 'English A', employee_name: 'مدرس الإنكليزي'},
    {...data.entries[1], ...resource, id: 12, teaching_load_id: 12, slot_id: data.slots[1].id, subject_name: 'English B', employee_name: 'مدرس الإنكليزي'});
  const u = await mount(t, data);
  await act(async () => button(u, 'جدول مدرس').click());
  const options = [...u.container.querySelector('[aria-label="مدرس الطباعة"]').options].filter(o => o.textContent === 'مدرس الإنكليزي');
  assert.equal(options.length, 1);
  await select(u, 'مدرس الطباعة', options[0].value);
  const cards = [...u.container.querySelectorAll('.timetable-subject-card')];
  assert.equal(cards.length, 2);
  assert.ok(cards.every(c => c.textContent.includes('مدرس الإنكليزي')));
  assert.equal(button(u, 'طباعة / حفظ PDF').disabled, false);
});

test('changing school resets stage, placement and teacher; stale response cannot repaint another school', async t => {
  const u = await mount(t);
  await select(u, 'مرحلة الطباعة', 'ابتدائي');
  let resolve;
  const pending = new Promise(r => {resolve = r;});
  await u.render({schoolId: 2, loadGrid: () => pending});
  await u.render({schoolId: 3, loadGrid: async () => ({data: {...u.data, school: {...u.data.school, id: 3, name: 'المدرسة الثالثة'}}})});
  await act(async () => resolve({data: u.data}));
  assert.equal(u.container.querySelector('[aria-label="مرحلة الطباعة"]').value, '');
  assert.equal(u.container.querySelector('[data-print-sheet]'), null);
});
