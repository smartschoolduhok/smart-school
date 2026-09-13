import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  summarizePublishedAcademicOutcomes,
} from '../src/lib/publishedAcademicAnalytics.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function row(id, studentId, summary, overrides = {}) {
  return {
    id,
    student_id: studentId,
    student_name_snapshot: `Student ${studentId}`,
    student_number: `S-${studentId}`,
    class_id: 1,
    class_name_snapshot: 'Class A',
    section_id: 1,
    section_name_snapshot: 'Section A',
    academic_year_id: 1,
    academic_year_snapshot: '2026-2027',
    card_number: `RC-${id}`,
    publication_revision: 1,
    published_at: 1000 + id,
    card_data_json: JSON.stringify({
      schema_version: 6,
      exam_round: 'الدور الأول',
      academic_policy: { version: 3 },
      summary,
    }),
    ...overrides,
  };
}

test('published analytics separates result, exemption, ministerial entry and annual transition', () => {
  const summary = summarizePublishedAcademicOutcomes([
    row(1, 10, {
      academic_status_code: 'pass', exemption_status: 'general',
      ministerial_eligibility_code: 'not_applicable', decision_points_used: 0,
    }),
    row(2, 11, {
      academic_status_code: 'completion', exemption_status: 'none',
      ministerial_eligibility_code: 'eligible', adjusted_failed_subjects: 2,
      decision_points_used: 10, completion_subject_names: ['English', 'Physics'],
    }),
    row(3, 12, {
      academic_status_code: 'fail', exemption_status: 'not_applicable',
      ministerial_eligibility_code: 'not_eligible', adjusted_failed_subjects: 4,
    }),
    row(4, 13, {
      academic_status_code: 'pass', exemption_status: 'individual',
      ministerial_eligibility_code: 'comprehensive',
    }),
    row(5, 14, {
      academic_status_code: 'incomplete', exemption_status: 'none',
      ministerial_eligibility_code: 'pending',
    }),
  ], [
    { result_card_id: 1, decision_action: 'promoted', created_at: 2000 },
    { result_card_id: 3, decision_action: 'repeated', created_at: 2001 },
    { result_card_id: 4, decision_action: 'graduated', created_at: 2002 },
  ]);

  assert.deepEqual({
    published: summary.published_students,
    pass: summary.pass_count,
    completion: summary.completion_count,
    fail: summary.fail_count,
    incomplete: summary.incomplete_count,
    general: summary.general_exemption_count,
    individual: summary.individual_exemption_count,
    comprehensive: summary.ministerial_comprehensive_count,
    eligible: summary.ministerial_eligible_count,
    notEligible: summary.ministerial_not_eligible_count,
    pending: summary.ministerial_pending_count,
    promoted: summary.promoted_count,
    repeated: summary.repeated_count,
    graduated: summary.graduated_count,
    awaiting: summary.awaiting_transition_count,
  }, {
    published: 5,
    pass: 2,
    completion: 1,
    fail: 1,
    incomplete: 1,
    general: 1,
    individual: 1,
    comprehensive: 1,
    eligible: 1,
    notEligible: 1,
    pending: 1,
    promoted: 1,
    repeated: 1,
    graduated: 1,
    awaiting: 0,
  });
  assert.equal(summary.students[1].academic_status_label, 'مكمل');
  assert.equal(summary.students[1].ministerial_eligibility_label, 'مؤهل للدخول الوزاري');
  assert.equal(summary.students[1].transition_action_label, 'غير قابل للترحيل حاليًا');
  assert.deepEqual(summary.students[1].completion_subject_names, ['English', 'Physics']);
});

test('published analytics keeps one newest official card per student and fails old malformed snapshots closed', () => {
  const result = summarizePublishedAcademicOutcomes([
    row(2, 10, { academic_status_code: 'pass', exemption_status: 'none' }),
    row(1, 10, { academic_status_code: 'fail', exemption_status: 'none' }),
    row(3, 11, {}, { card_data_json: '{broken' }),
  ], []);
  assert.equal(result.published_students, 2);
  assert.equal(result.pass_count, 1);
  assert.equal(result.fail_count, 0);
  assert.equal(result.incomplete_count, 1);
  assert.equal(result.awaiting_transition_count, 1);
  assert.deepEqual(result.students.map(student => student.result_card_id), [2, 3]);
});

test('analytics UI distinguishes published snapshots from live calculations and exposes all decision filters', () => {
  const source = readFileSync(join(root, 'src/modules/analytics/AnalyticsPage.tsx'), 'utf8');
  for (const text of [
    'النتائج الرسمية المنشورة',
    'المعاينة المحسوبة حاليًا',
    'إعفاء فردي',
    'دخول شامل',
    'بانتظار القرار السنوي',
    'تصفية حسب النتيجة',
    'تصفية حسب الإعفاء',
    'تصفية حسب الدخول الوزاري',
    'تصفية حسب القرار السنوي',
  ]) assert.match(source, new RegExp(text));
  assert.match(source, /officialOutcomesData\?\.published/);
  assert.match(source, /officialOutcomesData\?\.live/);
});
