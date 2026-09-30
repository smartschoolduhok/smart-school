import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_TIMETABLE_PREFERENCES } from '../src/lib/timetablePreferences.ts';
import { createTimetablePedagogyScorer } from '../src/lib/timetablePedagogy.ts';
import { solveTimetable, validateTimetableSolverProposal } from '../src/lib/timetableSolver.ts';

function week() {
  const days = [{ id: 1, school_id: 1, academic_year_id: 1, day_of_week: 0, is_active: 1, order_index: 0 }];
  const slots = Array.from({ length: 4 }, (_, index) => ({
    id: index + 1, school_id: 1, academic_year_id: 1, day_of_week: 0,
    slot_index: index + 1, slot_type: 'lesson', lesson_number: index + 1, label: `Lesson ${index + 1}`,
    start_time: `${String(8 + index).padStart(2, '0')}:00`, end_time: `${String(8 + index).padStart(2, '0')}:40`,
    is_active: 1, created_at: 0, updated_at: 0,
  }));
  return { days, slots };
}

function load(id, overrides = {}) {
  return {
    id, school_id: 1, academic_year_id: 1, class_id: 1, class_name: 'الثالث المتوسط', class_stage: 'متوسط',
    class_status: 'active', class_school_id: 1, active_section_count: 2,
    section_id: id, section_name: `Section ${id}`, section_status: 'active', section_school_id: 1, section_class_id: 1,
    subject_id: id, subject_name: 'المطالعة', subject_status: 'active', subject_school_id: 1, subject_class_id: 1,
    subject_section_id: null, employee_id: 1, employee_name: 'Teacher', employee_status: 'active',
    employee_school_id: 1, employee_role: 'teacher', weekly_periods: 1, parallel_with_load_id: null,
    status: 'active', created_at: 0, updated_at: 0, ...overrides,
  };
}

const entry = (teaching_load_id, slot_id) => ({ teaching_load_id, slot_id });
const internalEntries = result => result.entries.map((item, index) => ({
  ...item, id: index + 1, school_id: 1, academic_year_id: 1,
  created_by_user_id: null, updated_by_user_id: null, created_at: 0, updated_at: 0,
}));

test('teacher section continuity has a substantial preference in both candidate ranking and final scoring', () => {
  const loads = [load(1), load(2)];
  const { slots } = week();
  const scorer = createTimetablePedagogyScorer(loads, slots);
  const existing = [entry(1, 1)];
  const consecutive = scorer.score([...existing, entry(2, 2)]);
  const separated = scorer.score([...existing, entry(2, 3)]);
  const candidateBenefit = scorer.candidatePenalty(loads[1], slots[2], existing) - scorer.candidatePenalty(loads[1], slots[1], existing);
  assert.equal(separated.penalties.missed_section_continuity - consecutive.penalties.missed_section_continuity, 48);
  assert.equal(candidateBenefit, 48);
});

test('school preference levels affect candidate ranking and final scoring while keeping actual observations', () => {
  const loads = [load(1, {subject_name: 'الفنية'}), load(2, {subject_name: 'الفنية'})];
  const {slots} = week();
  const normal = createTimetablePedagogyScorer(loads, slots);
  const high = createTimetablePedagogyScorer(loads, slots, {...DEFAULT_TIMETABLE_PREFERENCES, section_continuity: 2});
  const off = createTimetablePedagogyScorer(loads, slots, {...DEFAULT_TIMETABLE_PREFERENCES, early_light_subjects: 0, section_continuity: 0});
  const entries = [entry(1, 1), entry(2, 3)];
  assert.equal(high.score(entries).penalties.missed_section_continuity, 2 * normal.score(entries).penalties.missed_section_continuity);
  assert.equal(off.score(entries).penalties.missed_section_continuity, 0);
  assert.equal(off.score(entries).penalties.early_light_subjects, 0);
  assert.equal(off.score(entries).metrics.early_light_lessons, 1);
  assert.equal(off.candidatePenalty(loads[0], slots[0], []), 0);
  assert.equal(normal.candidatePenalty(loads[0], slots[0], []), 40);
});

test('continuity priority can outweigh a small early-science preference without changing either teaching load', () => {
  const loads = [load(1, { subject_name: 'الفيزياء' }), load(2, { subject_name: 'الفيزياء' })];
  const { slots } = week();
  const scorer = createTimetablePedagogyScorer(loads, slots);
  const existing = [entry(1, 4)];
  const followingTeacher = scorer.candidatePenalty(loads[1], slots[2], existing);
  const earlyButSeparated = scorer.candidatePenalty(loads[1], slots[0], existing);
  assert.ok(followingTeacher < earlyButSeparated);
  const total = score => Object.values(score.penalties).reduce((sum, penalty) => sum + penalty, 0);
  assert.ok(total(scorer.score([...existing, entry(2, 3)])) < total(scorer.score([...existing, entry(2, 1)])));
  assert.equal(loads[1].weekly_periods, 1);
});

test('a candidate gets no extra continuity reward for repeating next to an already paired lesson', () => {
  const loads = [load(1), load(2), load(3)];
  const { slots } = week();
  const scorer = createTimetablePedagogyScorer(loads, slots);
  const paired = [entry(1, 1), entry(2, 2)];
  assert.equal(scorer.candidatePenalty(loads[0], slots[2], paired), 0, 'same-section repetition does not earn another pair');
  assert.equal(scorer.candidatePenalty(loads[2], slots[2], paired), 0, 'the middle lesson cannot be counted twice');
  assert.equal(scorer.score([...paired, entry(3, 3)]).metrics.consecutive_section_pairs, 1);
});

test('candidate pair benefits agree with final pair changes in either insertion direction', () => {
  const loads = [load(1), load(2)];
  const { slots } = week();
  const scorer = createTimetablePedagogyScorer(loads, slots);
  for (const [existing, candidate, slot] of [
    [[entry(1, 2)], loads[1], slots[0]],
    [[entry(1, 2)], loads[1], slots[2]],
    [[entry(1, 1), entry(2, 2), entry(1, 3)], loads[1], slots[3]],
  ]) {
    const before = scorer.score(existing).metrics.consecutive_section_pairs;
    const after = scorer.score([...existing, entry(candidate.id, slot.id)]).metrics.consecutive_section_pairs;
    assert.equal(scorer.candidatePenalty(candidate, slot, existing), -(after - before) * 48);
  }
});

test('teacher identity, class identity and section identity all remain required for continuity', () => {
  for (const overrides of [{ employee_id: 2 }, { class_id: 2 }, { section_id: 1 }, { subject_name: 'اللغة العربية' }]) {
    const loads = [load(1), load(2, overrides)];
    const { slots } = week();
    const scorer = createTimetablePedagogyScorer(loads, slots);
    assert.equal(scorer.candidatePenalty(loads[1], slots[1], [entry(1, 1)]), 0);
    assert.equal(scorer.score([entry(1, 1), entry(2, 2)]).metrics.consecutive_section_pairs, 0);
  }
});

function inputFor(loads, fixedEntries = [], teacherAvailability = []) {
  return {
    schoolId: 1, academicYearId: 1, ...week(), loads,
    placements: loads.map(item => ({ class_id: item.class_id, class_name: item.class_name, section_id: item.section_id, section_name: item.section_name })),
    teacherAvailability, teacherConstraints: [], fixedEntries, currentEntries: [],
    limits: { time_budget_ms: 4000, max_attempts: 200000, max_backtracks: 10000, max_local_improvement_attempts: 500 },
  };
}

test('generation prefers the next section beside a fixed science lesson over an isolated early period', () => {
  const loads = [load(1, { subject_name: 'الفيزياء' }), load(2, { subject_name: 'الفيزياء' })];
  const input = inputFor(loads, [{ ...entry(1, 4), is_locked: 1 }]);
  const result = solveTimetable(input);
  assert.equal(result.status, 'complete');
  assert.equal(result.entries.find(item => item.teaching_load_id === 2).lesson_number, 3);
  assert.equal(result.scoring.pedagogy.consecutive_section_pairs, 1);
  assert.deepEqual(validateTimetableSolverProposal(input, internalEntries(result)), []);
});

test('strong continuity cannot override teacher unavailability', () => {
  const loads = [load(1), load(2)];
  const input = inputFor(loads, [{ ...entry(1, 1), is_locked: 1 }], [
    { school_id: 1, academic_year_id: 1, employee_id: 1, slot_id: 2, status: 'unavailable' },
  ]);
  const result = solveTimetable(input);
  assert.equal(result.status, 'complete');
  assert.notEqual(result.entries.find(item => item.teaching_load_id === 2).lesson_number, 2);
  assert.equal(result.scoring.pedagogy.consecutive_section_pairs, 0);
  assert.deepEqual(validateTimetableSolverProposal(input, internalEntries(result)), []);
});

test('avoiding an additional light opening lesson still takes precedence over continuity', () => {
  const loads = [load(1, { subject_name: 'الفنية' }), load(2, { subject_name: 'الفنية' })];
  const input = inputFor(loads, [{ ...entry(1, 1), is_locked: 1 }]);
  const result = solveTimetable(input);
  assert.equal(result.status, 'complete');
  assert.ok(result.entries.find(item => item.teaching_load_id === 2).lesson_number >= 3);
  assert.equal(result.scoring.pedagogy.early_light_lessons, 1);
  assert.deepEqual(validateTimetableSolverProposal(input, internalEntries(result)), []);
});
