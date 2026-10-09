import assert from 'node:assert/strict';
import test from 'node:test';
import {buildTimetablePrintSheets, buildTimetablePrintWeek, timetablePrintSheetEntries, timetablePrintTeacherOptions} from '../src/lib/timetablePrint.ts';
import {printFixture} from './helpers/timetable-print-fixture.mjs';

const choice = overrides => ({mode: 'master', grouping: 'combined', stage: '', classId: null, placementKey: '', teacherId: null, ...overrides});

test('print stage/class scope excludes other stages and archived classes; unknown selection never prints all', () => {
  const data = printFixture();
  assert.deepEqual(buildTimetablePrintSheets(data, choice({stage: 'ابتدائي'}))[0].placements.map(p => p.class_id), [1, 1]);
  assert.deepEqual(buildTimetablePrintSheets(data, choice({classId: 2}))[0].placements.map(p => p.class_id), [2]);
  assert.deepEqual(buildTimetablePrintSheets(data, choice({stage: 'ابتدائي', classId: 2})), []);
  assert.deepEqual(buildTimetablePrintSheets(data, choice({classId: 999})), []);
});

test('separate print sheets group by stage, class or canonical section and include standalone classes', () => {
  const data = printFixture();
  assert.deepEqual(buildTimetablePrintSheets(data, choice({grouping: 'stage'})).map(p => p.key), ['stage:ابتدائي', 'stage:متوسط']);
  assert.deepEqual(buildTimetablePrintSheets(data, choice({grouping: 'class'})).map(p => p.key), ['class:1', 'class:2']);
  assert.deepEqual(buildTimetablePrintSheets(data, choice({grouping: 'placement'})).map(p => p.key), ['placement:1:11', 'placement:1:12', 'placement:2:none']);
});

test('class-wide entry and legend appear in each section sheet exactly once', () => {
  const data = printFixture();
  const sheets = buildTimetablePrintSheets(data, choice({classId: 1, grouping: 'placement'}));
  for (const sheet of sheets) assert.deepEqual(timetablePrintSheetEntries(data.entries, sheet).map(e => e.subject_name), ['رياضيات مشتركة']);
  assert.equal(buildTimetablePrintSheets(data, choice({mode: 'placement', placementKey: '1:12'}))[0].placements[0].section_id, 12);
});

test('weekly grid preserves every slot once, each time/break and unequal day end without padding fake lessons', () => {
  const data = printFixture();
  const week = buildTimetablePrintWeek(data);
  const rendered = week.rows.flatMap(row => row.slots.filter(Boolean));
  assert.deepEqual(rendered.map(s => s.id).sort((a, b) => a - b), data.slots.map(s => s.id));
  assert.equal(rendered.filter(s => s.slot_type === 'break').length, 5);
  assert.equal(week.rows.length, 8);
  assert.equal(week.rows.at(-1).slots[1], null);
  assert.equal(week.rows.at(-1).slots[3], null);
  assert.equal(week.rows[0].slots[0].start_time, '08:00');
});

test('inactive days/periods never leak into focused grid and tenant filtering excludes foreign placements', () => {
  const data = printFixture();
  data.days[4].is_active = 0;
  data.slots[0].is_active = 0;
  data.classes.push({id: 99, school_id: 2, name: 'foreign', stage: 'ابتدائي', status: 'active', order_index: 0});
  assert.equal(buildTimetablePrintWeek(data).days.length, 4);
  assert.equal(buildTimetablePrintWeek(data).rows[0].slots[0], null);
  assert.equal(buildTimetablePrintSheets(data, choice())[0].placements.some(p => p.class_id === 99), false);
});

test('teacher sheets retain simultaneous collisions visibly instead of selecting the first entry', () => {
  const data = printFixture();
  const sheet = buildTimetablePrintSheets(data, choice({mode: 'teacher', teacherId: 7}))[0];
  assert.equal(timetablePrintSheetEntries(data.entries, sheet).length, 2);
  assert.deepEqual(buildTimetablePrintSheets(data, choice({mode: 'teacher', teacherId: 999})), []);
});

test('named placeholder teacher sheets combine shared subjects without fake employees or foreign scope', () => {
  const data = printFixture();
  const base = {school_id: 1, academic_year_id: 1, employee_id: null, status: 'active', teacher_placeholder: 'مدرس العربي والإسلامية'};
  data.loads.push({...base, id: 11}, {...base, id: 12}, {...base, id: 13, teacher_placeholder: 'مدرس الإنكليزي'},
    {...base, id: 14, school_id: 2, teacher_placeholder: 'سري'}, {...base, id: 15, academic_year_id: 2, teacher_placeholder: 'قديم'},
    {...base, id: 16, status: 'inactive', teacher_placeholder: 'غير فعال'});
  data.entries.push({...data.entries[0], ...base, id: 11, teaching_load_id: 11, subject_name: 'العربي'},
    {...data.entries[1], ...base, id: 12, teaching_load_id: 12, subject_name: 'الإسلامية'},
    {...data.entries[1], ...base, id: 13, teaching_load_id: 13, teacher_placeholder: 'مدرس الإنكليزي'});
  const options = timetablePrintTeacherOptions(data);
  assert.deepEqual(options.map(o => o.full_name), ['سارة', 'مدرس العربي والإسلامية', 'مدرس الإنكليزي']);
  assert.equal(typeof options[1].id, 'string');
  assert.equal(data.teachers.length, 1);
  const sheet = buildTimetablePrintSheets(data, choice({mode: 'teacher', teacherId: options[1].id}))[0];
  assert.equal(sheet.title, 'جدول المدرس: مدرس العربي والإسلامية');
  assert.deepEqual(timetablePrintSheetEntries(data.entries, sheet).map(e => e.id), [11, 12]);
  assert.deepEqual(buildTimetablePrintSheets(data, choice({mode: 'teacher', teacherId: '2:1:placeholder:سري'})), []);
});
