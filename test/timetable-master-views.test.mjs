import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  buildTimetableMasterPlacements,
  normalizeTimetableSubjectVisualKey,
  timetableEntryForPlacement,
  timetablePlacementKey,
  timetableSubjectColor,
  timetableSubjectColorForSubject,
  timetableSubjectVisualKey,
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

test('logical subject colors are deterministic across different subject row ids', () => {
  const gradeOne = entry({ subject_id: 7, subject_name: 'رياضيات' });
  const gradeTwo = entry({ subject_id: 81, subject_name: '  رِيَـاضِيَّات  ' });
  assert.equal(normalizeTimetableSubjectVisualKey(gradeOne.subject_name), 'رياضيات');
  assert.equal(normalizeTimetableSubjectVisualKey(gradeTwo.subject_name), 'رياضيات');
  assert.equal(
    timetableSubjectVisualKey(gradeOne.school_id, gradeOne.subject_name),
    timetableSubjectVisualKey(gradeTwo.school_id, gradeTwo.subject_name),
  );
  assert.deepEqual(
    timetableSubjectColorForSubject(gradeOne.school_id, gradeOne.subject_name),
    timetableSubjectColorForSubject(gradeTwo.school_id, gradeTwo.subject_name),
  );
  assert.equal(timetableSubjectVisualKey(1, 'Math'), timetableSubjectVisualKey(1, 'ｍＡＴＨ'));
  assert.notEqual(timetableSubjectVisualKey(1, 'Math'), timetableSubjectVisualKey(2, 'Math'));
  assert.match(viewSource, /timetableSubjectColorForSubject\(entry\.school_id, entry\.subject_name\)/);
  assert.match(viewSource, /timetableSubjectVisualKey\(entry\.school_id, entry\.subject_name\)/);
  assert.match(viewSource, /data-subject-id=\{entry\.subject_id\}/);
  assert.match(viewSource, /data-subject-visual-key=\{subjectVisualKey\}/);
  assert.ok((viewSource.match(/<SubjectCell/g) || []).length >= 3);
});

test('subject palette maintains readable text contrast for representative visual keys', () => {
  function luminance(hex) {
    const channels = hex.match(/[a-f\d]{2}/gi).map((value) => Number.parseInt(value, 16) / 255)
      .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  }
  function contrast(left, right) {
    const [lighter, darker] = [luminance(left), luminance(right)].sort((a, b) => b - a);
    return (lighter + 0.05) / (darker + 0.05);
  }
  const colors = new Map();
  for (let index = 0; index < 200; index += 1) {
    const color = timetableSubjectColor(`1:subject-${index}`);
    colors.set(color.background, color);
  }
  assert.equal(colors.size, 12);
  for (const color of colors.values()) {
    assert.ok(contrast(color.background, color.foreground) >= 4.5, JSON.stringify(color));
  }
});

test('subject legend deduplicates by normalized school-scoped visual key', () => {
  assert.match(viewSource, /const seen = new Set<string>\(\)/);
  assert.match(viewSource, /key=\{subjectVisualKey\}/);
  assert.doesNotMatch(viewSource, /key=\{entry\.subject_id\} style=\{\{ '--legend-color'/);
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
  assert.match(cssSource, /body\.timetable-print-mode \*/);
  assert.match(cssSource, /print-color-adjust: exact/);
  assert.match(cssSource, /position: sticky/);
  assert.match(cssSource, /overflow: auto/);
  assert.match(cssSource, /margin: 0 !important/);
  assert.ok(viewSource.includes('تنسيق مضغوط للطباعة'));
  assert.ok(viewSource.includes('قد يوزّع المتصفح الجدول على أكثر من ورقة'));
  assert.equal(viewSource.includes('ملاءمة مضغوطة لورقة واحدة'), false);
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

test('school and academic-year response generations reject stale A to B to A repainting', () => {
  assert.match(viewSource, /const generation = \+\+requestGenerationRef\.current/);
  assert.match(viewSource, /const isCurrentSchool = captureSchoolRequest\(\)/);
  assert.match(viewSource, /generation !== requestGenerationRef\.current \|\| !isCurrentSchool\(\)/);
  assert.match(viewSource, /return \(\) => \{ requestGenerationRef\.current \+= 1; \}/);
  assert.match(viewSource, /\[academicYearId, captureSchoolRequest, dataVersion, schoolId\]/);
  for (const reset of ["setData(null)", "setPlacementKey('')", 'setTeacherId(null)', "setError('')"]) {
    assert.ok(viewSource.includes(reset), reset);
  }
});

test('all master columns share canonical school-year slots and breaks render once', () => {
  assert.match(viewSource, /data\.days\.map\(\(day\) =>/);
  assert.match(viewSource, /data\.slots\.filter\(\(slot\) => Number\(slot\.day_of_week\) === Number\(day\.day_of_week\)\)/);
  assert.match(viewSource, /YearValue value=\{`\$\{slot\.start_time\}–\$\{slot\.end_time\}`\}/);
  assert.match(viewSource, /colSpan=\{Math\.max\(1, placements\.length \+ 1\)\}/);
});

test('master endpoint is set-based and contains no row-loop database query', () => {
  const route = workerSource.slice(workerSource.indexOf("app.get('/api/timetable/master-grid'"), workerSource.indexOf("app.get('/api/timetable/grid'"));
  assert.match(route, /Promise\.all\(/);
  assert.doesNotMatch(route, /for\s*\([^)]*\)\s*\{[^}]*\.prepare\(/s);
  assert.doesNotMatch(route, /\.map\([^)]*=>[^)]*\.prepare\(/s);
});
