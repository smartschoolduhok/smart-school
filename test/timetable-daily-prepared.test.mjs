import assert from 'node:assert/strict';
import test from 'node:test';
import { solvePreparedTimetable } from '../src/lib/timetableSolverPrepared.ts';
import { hasBetterTimetableScore, solveTimetable, validateTimetableSolverProposal, TimetableSolverSafetyLimitError } from '../src/lib/timetableSolver.ts';
import { createTimetableDailySubjectPolicy } from '../src/lib/timetableDailySubjects.ts';
import { DEFAULT_TIMETABLE_PREFERENCES, timetableSearchBudget } from '../src/lib/timetablePreferences.ts';

function week(dayCount = 3, lessonCount = 3) {
  const days = [], slots = [];
  for (let day = 0; day < dayCount; day += 1) {
    days.push({ id: day + 1, school_id: 1, academic_year_id: 1, day_of_week: day, is_active: 1, order_index: day });
    for (let lesson = 1; lesson <= lessonCount; lesson += 1) slots.push({
      id: day * lessonCount + lesson, school_id: 1, academic_year_id: 1, day_of_week: day,
      slot_index: lesson, slot_type: 'lesson', lesson_number: lesson, label: `Lesson ${lesson}`,
      start_time: `${String(7 + lesson).padStart(2, '0')}:00`, end_time: `${String(7 + lesson).padStart(2, '0')}:40`,
      is_active: 1, created_at: 0, updated_at: 0,
    });
  }
  return { days, slots };
}

function load(id = 1, overrides = {}) {
  return {
    id, school_id: 1, academic_year_id: 1, class_id: 1, class_name: 'الثالث المتوسط', class_stage: 'متوسط',
    class_status: 'active', class_school_id: 1, active_section_count: 1,
    section_id: 11, section_name: 'أ', section_status: 'active', section_school_id: 1, section_class_id: 1,
    subject_id: id, subject_name: 'الرياضيات', subject_status: 'active', subject_school_id: 1, subject_class_id: 1,
    subject_section_id: null, employee_id: id, employee_name: 'Teacher', employee_status: 'active',
    employee_school_id: 1, employee_role: 'teacher', weekly_periods: 3, parallel_with_load_id: null,
    status: 'active', created_at: 0, updated_at: 0, ...overrides,
  };
}

function prepared(loads = [load()], options = {}) {
  const { dayCount = 3, lessonCount = 3, ...overrides } = options;
  return {
    input: {
      schoolId: 1, academicYearId: 1, ...week(dayCount, lessonCount), loads,
      placements: [...new Map(loads.map(item => [`${item.class_id}:${item.section_id}`, {
        class_id: item.class_id, class_name: item.class_name, section_id: item.section_id, section_name: item.section_name,
      }])).values()],
      teacherAvailability: [], teacherConstraints: [], currentEntries: [], fixedEntries: [],
      limits: { time_budget_ms: 4000, max_attempts: 100000, max_backtracks: 10000, max_local_improvement_attempts: 500 },
      ...overrides,
    },
    timetable_revision: 7, generation_scope: { kind: 'school' },
  };
}

function entry(teaching_load_id, slot_id, id = slot_id) {
  return { id, teaching_load_id, slot_id, school_id: 1, academic_year_id: 1,
    created_by_user_id: null, updated_by_user_id: null, created_at: 0, updated_at: 0 };
}

const entriesOf = result => result.entries.map((item, index) => ({ ...entry(item.teaching_load_id, item.slot_id, index + 1), is_locked: item.is_locked }));

function assertValid(source, result, allowDouble = true) {
  assert.deepEqual(validateTimetableSolverProposal({ ...source.input, allowConsecutiveSubjectDouble: allowDouble }, entriesOf(result)), []);
}

test('prepared search keeps a complete daily spread even when the saved full schedule contains an adjacent double', async () => {
  const source = prepared([load()], { currentEntries: [entry(1, 1), entry(1, 2), entry(1, 4)] });
  const progress = [];
  const result = await solvePreparedTimetable(source, { maxRuns: 4, onProgress: value => progress.push(value) });
  assert.equal(result.status, 'complete');
  assert.equal(result.scoring.penalties.daily_subject_doubles, 0);
  assert.equal(new Set(result.entries.map(item => item.day_of_week)).size, 3);
  assert.ok(!result.warnings.some(message => message.includes('استخدم المقترح')));
  assert.equal(result.timetable_revision, 7);
  assert.ok(result.proposal_digest);
  assert.ok(progress.length >= 1 && progress.length <= 4);
  assertValid(source, result, false);
});

test('prepared search uses a minimal adjacent double only after the strict phase cannot meet weekly demand', async () => {
  const source = prepared([load()], { dayCount: 2, lessonCount: 2 });
  const progress = [];
  const result = await solvePreparedTimetable(source, { maxRuns: 4, onProgress: value => progress.push(value) });
  assert.equal(result.status, 'complete');
  assert.equal(result.scheduled_periods, 3);
  assert.equal(result.scoring.penalties.daily_subject_doubles, 100);
  assert.ok(result.warnings.some(message => message.includes('درسين متتاليين')));
  assert.equal(progress[1].best_scheduled, 2, 'the first run tries without daily repetition');
  assert.equal(progress[2].best_scheduled, 3, 'quota exceeding available days proves the strict phase cannot finish and permits an early fallback');
  assertValid(source, result);
});

test('a fixed valid adjacent double can pass the fallback phase without moving either fixed lesson', async () => {
  const fixedEntries = [entry(1, 1), entry(1, 2)].map(item => ({ ...item, is_locked: 1 }));
  const source = prepared([load(1, { weekly_periods: 2 })], { dayCount: 1, lessonCount: 2, fixedEntries });
  const result = await solvePreparedTimetable(source, { maxRuns: 4 });
  assert.equal(result.status, 'complete');
  assert.equal(result.scoring.penalties.daily_subject_doubles, 100);
  assert.deepEqual(result.entries.map(item => item.slot_id).sort(), [1, 2]);
  assert.ok(result.entries.every(item => item.is_locked === 1));
  assertValid(source, result);
});

test('fallback never accepts separated fixed repeats or three fixed lessons of the same material', async () => {
  for (const fixedSlots of [[1, 3], [1, 2, 3]]) {
    const source = prepared([load(1, { weekly_periods: fixedSlots.length })], {
      dayCount: 1, lessonCount: 3, fixedEntries: fixedSlots.map(slotId => ({ ...entry(1, slotId), is_locked: 1 })),
    });
    const result = await solvePreparedTimetable(source, { maxRuns: 4 });
    assert.equal(result.status, 'fixed_conflict');
    assert.ok(result.fixed_conflicts.some(item => item.code === 'fixed_subject_daily_repetition'));
    assert.equal(result.entries.length, 0);
  }
});

test('logical subject identity spans split teaching loads during the prepared fallback search', async () => {
  const source = prepared([
    load(1, { subject_name: 'الرِّياضيّات', weekly_periods: 1 }),
    load(2, { subject_name: 'الرياضيات', weekly_periods: 1 }),
  ], { dayCount: 1, lessonCount: 3 });
  const result = await solvePreparedTimetable(source, { maxRuns: 4 });
  assert.equal(result.status, 'complete');
  const lessons = result.entries.map(item => item.lesson_number).sort();
  assert.equal(lessons[1] - lessons[0], 1);
  assert.equal(result.scoring.penalties.daily_subject_doubles, 100);
  assertValid(source, result);
});

test('religious parallel groups remain atomic while each material follows the adjacent-double fallback rule', async () => {
  const source = prepared([
    load(1, { subject_name: 'التربية الإسلامية' }),
    load(2, { subject_name: 'التربية المسيحية', parallel_with_load_id: 1 }),
  ], { dayCount: 2, lessonCount: 2 });
  const result = await solvePreparedTimetable(source, { maxRuns: 4 });
  assert.equal(result.status, 'complete');
  assert.equal(result.scheduled_periods, 3);
  assert.equal(result.entries.length, 6);
  assert.deepEqual(result.entries.filter(item => item.teaching_load_id === 1).map(item => item.slot_id),
    result.entries.filter(item => item.teaching_load_id === 2).map(item => item.slot_id));
  assertValid(source, result);
});

test('linked section days and emergency doubles are validated together', async () => {
  const source = prepared([
    load(1), load(2, { section_id: 12, section_name: 'ب', employee_id: 1 }),
  ], { dayCount: 2, lessonCount: 4, linkSameTeacherSectionDays: true });
  const result = await solvePreparedTimetable(source, { maxRuns: 4 });
  assert.equal(result.status, 'complete');
  assert.equal(result.scheduled_periods, 6);
  assert.equal(result.scoring.penalties.daily_subject_doubles, 200);
  assertValid(source, result);
});

test('score comparison minimizes emergency doubles before light openings, then preserves the light-opening preference', () => {
  const score = (doubles, early, total) => ({ penalties: { daily_subject_doubles: doubles, early_light_subjects: early }, total_penalty: total });
  assert.equal(hasBetterTimetableScore(score(0, 40, 1000), score(100, 0, 100)), true);
  assert.equal(hasBetterTimetableScore(score(100, 0, 100), score(0, 40, 1000)), false);
  assert.equal(hasBetterTimetableScore(score(100, 20, 1000), score(100, 40, 200)), true);
  assert.equal(hasBetterTimetableScore(score(100, 20, 200), score(100, 20, 300)), true);
});

test('a prepared search never invents a third daily lesson to hide an impossible demand', async () => {
  const source = prepared([load(1, { weekly_periods: 3 })], { dayCount: 1, lessonCount: 3 });
  const result = await solvePreparedTimetable(source, { maxRuns: 4 });
  assert.equal(result.status, 'partial');
  assert.equal(result.scheduled_periods, 2);
  assert.equal(result.unscheduled_periods, 1);
  assertValid(source, result);
  assert.deepEqual(createTimetableDailySubjectPolicy(source.input.loads, source.input.slots).validate(result.entries), []);
});

test('partial generation preserves an older outside-scope repeat without relaxing the selected section rule', async () => {
  const outside = load(2, { class_id: 2, class_name: 'الثاني المتوسط', section_id: 22, section_class_id: 2,
    subject_class_id: 2, weekly_periods: 2 });
  const outsideEntries = [entry(2, 1), entry(2, 3)];
  const source = prepared([load(1, { weekly_periods: 2 }), outside], {
    dayCount: 2, lessonCount: 3, currentEntries: outsideEntries, fixedEntries: outsideEntries,
    dailySubjectLoadIds: [1],
  });
  source.generation_scope = { kind: 'section', class_id: 1, section_id: 11 };
  const result = await solvePreparedTimetable(source, { maxRuns: 4 });
  assert.equal(result.status, 'complete');
  assert.equal(result.scoring.penalties.daily_subject_doubles, 0);
  assert.deepEqual(result.entries.filter(item => item.teaching_load_id === 2).map(item => item.slot_id), [1, 3]);
  assert.ok(result.entries.filter(item => item.teaching_load_id === 2).every(item => item.is_preserved));
  assert.equal(new Set(result.entries.filter(item => item.teaching_load_id === 1).map(item => item.day_of_week)).size, 2);
  assertValid(source, result, false);
});

test('the single-run wrapper must not exceed a one-attempt budget when trying its emergency fallback', () => {
  const source = prepared([load()], { dayCount: 1, lessonCount: 3,
    limits: { time_budget_ms: 4000, max_attempts: 1, max_backtracks: 10, max_local_improvement_attempts: 0 },
  });
  const result = solveTimetable(source.input);
  assert.ok(result.statistics.attempts <= 1, `actual attempts: ${result.statistics.attempts}`);
  assert.equal(result.statistics.attempt_budget, 1);
});

test('completing linked sections can move an entire saved subject pair to another day while preserving fixed teacher commitments', () => {
  const pair = (firstId, subject_name, employee_id) => [11, 12].map((section_id, index) => load(firstId + index, {
    section_id, section_name: index === 0 ? 'أ' : 'ب', subject_name, employee_id, weekly_periods: 1,
  }));
  const loads = [
    ...pair(1, 'المطالعة', 2), ...pair(3, 'التاريخ', 3), ...pair(5, 'الجغرافية', 1),
    ...[7, 8].map(id => load(id, { subject_name: `مادة أخرى ${id}`, weekly_periods: 1, employee_id: 1,
      class_id: 2, section_id: 22, section_class_id: 2, subject_class_id: 2 })),
  ];
  const fixedEntries = [{ ...entry(7, 3), is_locked: 1 }, { ...entry(8, 4), is_locked: 1 }];
  // Both first-day section timetables are full; the missing teacher is already
  // committed elsewhere all of day two. A whole linked pair must change day.
  const currentEntries = [entry(1, 1, 11), entry(2, 2, 12), entry(3, 2, 13), entry(4, 1, 14), ...fixedEntries];
  const source = prepared(loads, { dayCount: 2, lessonCount: 2, currentEntries, fixedEntries,
    linkSameTeacherSectionDays: true, allowConsecutiveSubjectDouble: false,
    teacherConstraints: [2, 3].map(employee_id => ({ school_id: 1, academic_year_id: 1, employee_id,
      max_periods_per_day: 2, max_working_days: 2, max_consecutive_periods: 2,
      prefer_compact_schedule: 0, avoid_first_period: 0, avoid_last_period: 0 })),
    teacherAvailability: [2, 3].flatMap(employee_id => [1, 2].map(slot_id => ({
      school_id: 1, academic_year_id: 1, employee_id, slot_id, status: 'preferred',
    }))),
  });
  const before = structuredClone(source);
  const result = solveTimetable(source.input);
  assert.equal(result.status, 'complete');
  assert.equal(result.scheduled_periods, 8);
  assert.ok(result.entries.filter(item => [5, 6].includes(item.teaching_load_id)).every(item => item.day_of_week === 0));
  assert.ok([[1, 2], [3, 4]].some(pairIds => result.entries.filter(item => pairIds.includes(item.teaching_load_id))
    .every(item => item.day_of_week === 1)), 'a complete linked subject pair moves to the other day');
  for (const fixed of fixedEntries) assert.ok(result.entries.some(item => item.teaching_load_id === fixed.teaching_load_id
    && item.slot_id === fixed.slot_id && item.is_locked === 1));
  assert.equal(result.scoring.penalties.daily_subject_doubles, 0);
  assert.deepEqual(source, before, 'generation leaves the saved timetable untouched');
  assertValid(source, result, false);
});

test('extended search can run more than eight diverse starts and reports the chosen budget', async () => {
  const source = prepared([load()], {fixedEntries: [3, 6, 9].map(slot => ({...entry(1, slot), is_locked: 1}))});
  const progress = [];
  const result = await solvePreparedTimetable(source, {maxRuns: 12, timeBudgetMs: 300000, onProgress: value => progress.push(value)});
  assert.equal(result.statistics.search_runs, 12);
  assert.equal(progress.length, 12);
  assert.equal(result.statistics.time_budget_ms, 300000);
  assert.equal(timetableSearchBudget('deep').maxRuns, 1000);
  assert.equal(timetableSearchBudget('deep').timeBudgetMs, 900000);
  assertValid(source, result);
});

test('a time deadline returns the earlier verified result without spending all requested starts', async () => {
  const originalNow = Date.now;
  let now = originalNow();
  const start = now;
  Date.now = () => now;
  try {
    const source = prepared([load()], {fixedEntries: [3, 6, 9].map(slot => ({...entry(1, slot), is_locked: 1}))});
    const result = await solvePreparedTimetable(source, {maxRuns: 50, timeBudgetMs: 300000,
      onProgress: progress => {if (progress.run === 2) now = start + 299000;}});
    assert.equal(result.statistics.search_runs, 1);
    assert.equal(result.statistics.stopped_by_limit, true);
    assert.ok(result.warnings.some(warning => warning.includes('انتهت مهلة البحث')));
    assert.equal(result.status, 'complete');
    assertValid(source, result);
  } finally {Date.now = originalNow;}
});

test('the total deadline stops retries even when no start produced a verified proposal', async () => {
  const originalNow = Date.now;
  let now = originalNow();
  const deadline = now + 30000;
  Date.now = () => now;
  try {
    const progress = [];
    await assert.rejects(solvePreparedTimetable(prepared([load()]), {maxRuns: 50, timeBudgetMs: 30000,
      onProgress: value => {progress.push(value); now = deadline;}}), TimetableSolverSafetyLimitError);
    assert.ok(progress.length < 50, 'the deadline ends search before exhausting all requested starts');
  } finally {Date.now = originalNow;}
});

test('reoptimization retains an already better proposal, recomputes its score, and produces a fresh valid digest', async () => {
  const source = prepared([load(1, {weekly_periods: 2})], {dayCount: 2, lessonCount: 2});
  source.baseline_revision = 7;
  source.baseline_entries = [2, 4].map(slot_id => ({slot_id, teaching_load_id: 1, is_locked: 0}));
  const before = structuredClone(source);
  const result = await solvePreparedTimetable(source, {maxRuns: 4});
  assert.deepEqual(result.entries.map(item => item.slot_id), [2, 4]);
  assert.equal(result.status, 'complete');
  assert.equal(result.quality_score, 100);
  assert.ok(result.warnings.some(item => item.includes('احتفظنا بالجدول السابق')));
  assert.ok(result.proposal_digest);
  assert.deepEqual(source, before);
  assertValid(source, result);
});

test('a saved full timetable seeds improvement and can be replaced only by a better valid result', async () => {
  const source = prepared([load()], {currentEntries: [3, 6, 9].map(slot => entry(1, slot))});
  source.keep_current = true;
  const result = await solvePreparedTimetable(source, {maxRuns: 4});
  assert.equal(result.status, 'complete');
  assert.equal(result.scoring.penalties.late_science_subjects, 0);
  assert.equal(result.scoring.penalties.daily_subject_doubles, 0);
  assert.deepEqual(source.input.currentEntries.map(item => item.slot_id), [3, 6, 9]);
  assertValid(source, result);
});

test('invalid or stale baselines never bypass a changed teacher constraint or fresh revision', async () => {
  for (const stale of [false, true]) {
    const source = prepared([load(1, {weekly_periods: 2})], {dayCount: 2, lessonCount: 2,
      teacherAvailability: [{school_id: 1, academic_year_id: 1, employee_id: 1, slot_id: 2, status: 'unavailable'}]});
    source.baseline_revision = stale ? 6 : 7;
    source.baseline_entries = [2, 4].map(slot_id => ({slot_id, teaching_load_id: 1, is_locked: 0}));
    const result = await solvePreparedTimetable(source, {maxRuns: 4});
    assert.equal(result.status, 'complete');
    assert.ok(result.entries.every(item => item.slot_id !== 2));
    assert.ok(result.warnings.some(item => item.includes(stale ? 'تغيرت بيانات الجدول' : 'لا يحقق القيود الحالية')));
    assertValid(source, result);
  }
});

test('disabling every soft preference cannot weaken the teacher limits or daily subject rule', async () => {
  const source = prepared([load(1, {weekly_periods: 3})], {dayCount: 1, lessonCount: 3,
    preferences: Object.fromEntries(Object.keys(DEFAULT_TIMETABLE_PREFERENCES).map(key => [key, 0]))});
  const result = await solvePreparedTimetable(source, {maxRuns: 4});
  assert.equal(result.scheduled_periods, 2);
  assert.equal(result.scoring.penalties.daily_subject_doubles, 100);
  assertValid(source, result);
});
