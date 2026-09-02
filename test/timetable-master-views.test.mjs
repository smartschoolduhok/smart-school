import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  buildTimetableMasterPlacements,
  timetableEntryForPlacement,
  timetablePlacementKey,
  timetableSubjectColor,
} from '../src/lib/timetable.ts';

const testDir = dirname(fileURLToPath(import.meta.url));
const rootDir = join(testDir, '..');
const viewSource = readFileSync(join(rootDir, 'src', 'modules', 'timetable', 'MasterTimetableTab.tsx'), 'utf8');
const pageSource = readFileSync(join(rootDir, 'src', 'modules', 'timetable', 'TimetablePage.tsx'), 'utf8');
const cssSource = readFileSync(join(rootDir, 'src', 'modules', 'timetable', 'timetablePrint.css'), 'utf8');
const workerSource = readFileSync(join(rootDir, 'src', 'worker.ts'), 'utf8');

const classes = [
  { id: 3, school_id: 1, name: 'الثالث', stage: 'ابتدائي', order_index: 3, status: 'active' },
  { id: 1, school_id: 1, name: 'الأول', stage: 'ابتدائي', order_index: 1, status: 'active' },
  { id: 2, school_id: 1, name: 'مؤرشف', stage: 'ابتدائي', order_index: 2, status: 'archived' },
];
const sections = [
  { id: 12, school_id: 1, class_id: 1, name: 'ب', status: 'active' },
  { id: 11, school_id: 1, class_id: 1, name: 'أ', status: 'active' },
  { id: 13, school_id: 1, class_id: 1, name: 'مؤرشفة', status: 'archived' },
];

function entry(overrides = {}) {
  return {
    id: 1,
    school_id: 1,
    academic_year_id: 1,
    slot_id: 9,
    teaching_load_id: 1,
    subject_id: 7,
    subject_name: 'رياضيات',
    class_id: 1,
    class_name: 'الأول',
    section_id: 11,
    section_name: 'أ',
    employee_id: 4,
    employee_name: 'مدرس الرياضيات',
    weekly_periods: 4,
    load_status: 'active',
    hard_conflicts: [],
    warnings: [],
    created_by_user_id: 1,
    updated_by_user_id: 1,
    created_at: 1,
    updated_at: 1,
    ...overrides,
  };
}

test('master placements use canonical class order and section order', () => {
  const placements = buildTimetableMasterPlacements(classes, sections);
  assert.deepEqual(placements.map(timetablePlacementKey), ['1:11', '1:12', '3:none']);
});

test('active class without sections remains a standalone timetable column', () => {
  const placements = buildTimetableMasterPlacements(classes, sections);
  assert.deepEqual(placements.at(-1), { class_id: 3, class_name: 'الثالث', section_id: null, section_name: null });
});

test('inactive classes and inactive sections never become master columns', () => {
  const placements = buildTimetableMasterPlacements(classes, sections);
  assert.equal(placements.some((item) => item.class_id === 2 || item.section_id === 13), false);
});

test('exact section entry maps only to its canonical section cell', () => {
  assert.equal(timetableEntryForPlacement([entry()], 9, { class_id: 1, section_id: 11 })?.id, 1);
  assert.equal(timetableEntryForPlacement([entry()], 9, { class_id: 1, section_id: 12 }), null);
});

test('class-wide entry maps to every section column of that class', () => {
  const classWide = entry({ section_id: null, section_name: null });
  assert.equal(timetableEntryForPlacement([classWide], 9, { class_id: 1, section_id: 11 })?.id, 1);
  assert.equal(timetableEntryForPlacement([classWide], 9, { class_id: 1, section_id: 12 })?.id, 1);
});

test('exact section placement takes precedence over a class-wide candidate', () => {
  const classWide = entry({ id: 1, section_id: null, section_name: null });
  const exact = entry({ id: 2, section_id: 11, section_name: 'أ' });
  assert.equal(timetableEntryForPlacement([classWide, exact], 9, { class_id: 1, section_id: 11 })?.id, 2);
});

test('empty slot and unrelated class resolve to an empty cell', () => {
  assert.equal(timetableEntryForPlacement([entry()], 10, { class_id: 1, section_id: 11 }), null);
  assert.equal(timetableEntryForPlacement([entry()], 9, { class_id: 3, section_id: null }), null);
});

test('subject colors are deterministic and reused across views', () => {
  assert.deepEqual(timetableSubjectColor(7), timetableSubjectColor(7));
  assert.notDeepEqual(timetableSubjectColor(7), timetableSubjectColor(8));
  assert.match(viewSource, /timetableSubjectColor\(entry\.subject_id\)/);
  assert.match(viewSource, /data-subject-id=\{entry\.subject_id\}/);
  assert.ok((viewSource.match(/<SubjectCell/g) || []).length >= 3);
});

test('full schedule tab exposes master, class-section and teacher views in RTL', () => {
  assert.ok(pageSource.includes("['master', 'الجدول الكامل'"));
  for (const label of ['الجدول الكامل', 'جدول صف / شعبة', 'جدول مدرس']) assert.ok(viewSource.includes(label), label);
  assert.match(viewSource, /dir="rtl"/);
  assert.match(viewSource, /<bdi dir="ltr"/);
});

test('break rows span the complete table instead of repeating per class cell', () => {
  assert.match(viewSource, /slot\.slot_type === 'break'/);
  assert.match(viewSource, /className="timetable-break-row"/);
  assert.match(viewSource, /colSpan=\{Math\.max\(1, placements\.length \+ 1\)\}/);
});

test('teacher and placement views are scoped to the selected canonical ids', () => {
  assert.match(viewSource, /Number\(entry\.employee_id\) === teacherId/);
  assert.match(viewSource, /Number\(entry\.class_id\) === selectedPlacement\.class_id/);
  assert.match(viewSource, /timetableEntryForPlacement\(data\.entries, slot\.id, placement\)/);
});

test('invalid placements are visible as an alert and link back to repair without becoming cells', () => {
  assert.match(workerSource, /item\.entry\.hard_conflicts\.length === 0/);
  assert.match(workerSource, /invalid_entry_count: invalidEntries\.length/);
  assert.ok(viewSource.includes('حصة تحتاج إصلاح'));
  assert.ok(viewSource.includes('لن تظهر كخلايا صحيحة في الجدول'));
  assert.ok(viewSource.includes('العودة إلى شبكة التحرير للإصلاح'));
  assert.match(viewSource, /onClick=\{onOpenRepair\}/);
});

test('print mode supports large master sizes, A4 focused views and exact colors', () => {
  for (const size of ['A3', 'A2', 'A1']) assert.ok(viewSource.includes(size), size);
  assert.match(viewSource, /mode === 'master' \? pageSize : 'A4'/);
  assert.match(viewSource, /ملاءمة مضغوطة لورقة واحدة/);
  assert.match(cssSource, /body\.timetable-print-mode \*/);
  assert.match(cssSource, /print-color-adjust: exact/);
  assert.match(cssSource, /position: sticky/);
  assert.match(cssSource, /overflow: auto/);
});

test('printed header includes school identity, logo, year and a subject legend', () => {
  assert.match(viewSource, /data\.school\.logo_url/);
  assert.match(viewSource, /data\.school\.name/);
  assert.match(viewSource, /data\.academic_year\.name/);
  assert.ok(viewSource.includes('مفتاح الألوان'));
  assert.ok(viewSource.includes('الجدول الدراسي الأسبوعي'));
});

test('master timetable component is read-only and imports no mutation endpoint', () => {
  for (const mutation of ['createTimetableEntry', 'moveTimetableEntry', 'deleteTimetableEntry', 'updateTimetableSlot']) {
    assert.equal(viewSource.includes(mutation), false, mutation);
  }
  assert.match(viewSource, /getTimetableMasterGrid/);
});

test('master endpoint is set-based and contains no row-loop database query', () => {
  const route = workerSource.slice(workerSource.indexOf("app.get('/api/timetable/master-grid'"), workerSource.indexOf("app.get('/api/timetable/grid'"));
  assert.match(route, /Promise\.all\(/);
  assert.doesNotMatch(route, /for\s*\([^)]*\)\s*\{[^}]*\.prepare\(/s);
  assert.doesNotMatch(route, /\.map\([^)]*=>[^)]*\.prepare\(/s);
});
