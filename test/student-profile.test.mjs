import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  EMPTY_STUDENT_PROFILE_VALUE,
  NO_CURRENT_ENROLLMENT_MESSAGE,
  enrollmentYearBadge,
  enrollmentStatusLabel,
  formatStudentProfileUnixSeconds,
  genderLabel,
  hasActiveYearWithoutEnrollment,
  promotionStatusLabel,
  safeStudentProfileValue,
} from '../src/lib/studentProfilePresentation.ts';

const testDir = dirname(fileURLToPath(import.meta.url));
const rootDir = join(testDir, '..');
const source = (path) => readFileSync(join(rootDir, path), 'utf8');
const appSource = source('src/App.tsx');
const profileSource = source('src/modules/students/StudentProfilePage.tsx');
const studentsSource = source('src/modules/students/StudentsPage.tsx');
const apiSource = source('src/lib/api.ts');
const workerSource = source('src/worker.ts');

test('Student Profile route is protected by the existing AcademicRoute', () => {
  assert.match(appSource, /path="\/students\/:id"[\s\S]*?<AcademicRoute><StudentProfilePage \/><\/AcademicRoute>/);
});

test('Students list links the full name and profile action to the canonical student route', () => {
  assert.ok((studentsSource.match(/to=\{`\/students\/\$\{s\.id\}`\}/g) || []).length >= 2);
  assert.match(studentsSource, /title="عرض الملف"/);
});

test('history API helper sends the explicit school_id target', () => {
  assert.match(apiSource, /getStudentEnrollments\(studentId: number \| string, schoolId: number\)/);
  assert.match(apiSource, /new URLSearchParams\(\{ school_id: String\(schoolId\) \}\)/);
  assert.match(apiSource, /`\/api\/students\/\$\{studentId\}\/enrollments\?\$\{params\.toString\(\)\}`/);
});

test('profile current placement uses effective enrollment fields returned by getStudent', () => {
  for (const field of [
    'current_academic_year_id',
    'current_academic_year_name',
    'current_enrollment_status',
    'current_promotion_status',
    'class_name',
    'section_name',
  ]) assert.match(profileSource, new RegExp(`student\\.${field}`));
  assert.match(profileSource, /hasActiveYearWithoutEnrollment\(student\)/);
  assert.match(source('src/lib/studentProfilePresentation.ts'), /current_enrollment_id/);
  assert.doesNotMatch(profileSource, /getClasses|getSections/);
});

test('active academic year without enrollment has an explicit state and no invented placement', () => {
  assert.equal(hasActiveYearWithoutEnrollment({ current_academic_year_id: 4, current_enrollment_id: null }), true);
  assert.equal(hasActiveYearWithoutEnrollment({ current_academic_year_id: 4, current_enrollment_id: 30 }), false);
  assert.equal(NO_CURRENT_ENROLLMENT_MESSAGE, 'غير مسجل في السنة الدراسية الحالية');
  assert.match(profileSource, /NO_CURRENT_ENROLLMENT_MESSAGE/);
});

test('profile history comes from the existing student enrollments endpoint', () => {
  assert.match(profileSource, /getStudentEnrollments\(requestedStudentId, requestedSchoolId\)/);
  const historyRoute = workerSource.slice(
    workerSource.indexOf("app.get('/api/students/:id/enrollments'"),
    workerSource.indexOf("app.post('/api/student-enrollments/promotion'"),
  );
  assert.match(historyRoute, /listStudentEnrollmentHistory/);
  assert.match(source('src/lib/studentEnrollments.ts'), /FROM student_enrollments AS enrollment[\s\S]*?ORDER BY academic_year\.starts_at DESC/);
});

test('enrollment statuses have the required Arabic presentation and safe fallback', () => {
  assert.equal(enrollmentStatusLabel('active'), 'نشط');
  assert.equal(enrollmentStatusLabel('completed'), 'مكتمل');
  assert.equal(enrollmentStatusLabel('transferred'), 'منقول');
  assert.equal(enrollmentStatusLabel('withdrawn'), 'منسحب');
  assert.equal(enrollmentStatusLabel('cancelled'), 'ملغى');
  assert.equal(enrollmentStatusLabel('future_status'), 'future_status');
});

test('promotion statuses have the required Arabic presentation and safe fallback', () => {
  assert.equal(promotionStatusLabel('pending'), 'بانتظار القرار');
  assert.equal(promotionStatusLabel('promoted'), 'مرفّع');
  assert.equal(promotionStatusLabel('repeated'), 'إعادة السنة');
  assert.equal(promotionStatusLabel('graduated'), 'متخرج');
  assert.equal(promotionStatusLabel('not_applicable'), 'غير مطبق');
  assert.equal(promotionStatusLabel('future_status'), 'future_status');
});

test('missing optional profile data and invalid dates render safely', () => {
  assert.equal(safeStudentProfileValue(null), EMPTY_STUDENT_PROFILE_VALUE);
  assert.equal(safeStudentProfileValue('  '), EMPTY_STUDENT_PROFILE_VALUE);
  assert.equal(genderLabel(null), EMPTY_STUDENT_PROFILE_VALUE);
  assert.equal(formatStudentProfileUnixSeconds(null), EMPTY_STUDENT_PROFILE_VALUE);
  assert.equal(formatStudentProfileUnixSeconds('invalid'), EMPTY_STUDENT_PROFILE_VALUE);
});

test('school switching clears profile data and stale responses are rejected', () => {
  assert.match(profileSource, /useSchoolRequestGuard\(schoolId\)/);
  assert.match(profileSource, /captureSchoolRequest\(\)/);
  assert.match(profileSource, /!isCurrentRequest\(\) \|\| requestedStudentIdRef\.current !== requestedStudentId/);
  assert.match(profileSource, /setStudent\(null\)[\s\S]*?setHistory\(\[\]\)/);
  assert.match(profileSource, /\[parsedStudentId, schoolId\]/);
});

test('cross-school student responses are rejected before rendering', () => {
  assert.match(profileSource, /Number\(studentResponse\.data\.school_id\) !== requestedSchoolId/);
  assert.match(profileSource, /الطالب لا ينتمي إلى المدرسة المحددة/);
  assert.match(profileSource, /setStudent\(null\)[\s\S]*?setHistory\(\[\]\)/);
});

test('empty enrollment history has a clear Arabic state', () => {
  assert.match(profileSource, /history\.length === 0/);
  assert.match(profileSource, /لا يوجد سجل تسجيلات دراسية لهذا الطالب/);
});

test('Student Profile introduces no grades or student-subject history assumptions', () => {
  assert.doesNotMatch(profileSource, /getGrades|getStudentSubjects|student_subjects|grade_history|subjects_history/);
});

test('existing Student edit and archive actions remain available', () => {
  assert.match(studentsSource, /onClick=\{\(\) => openEdit\(s\)\}/);
  assert.match(studentsSource, /onClick=\{\(\) => handleArchive\(s\.id\)\}/);
});

test('individual Student backend read is tenant-isolated and limited to academic readers', () => {
  const studentRoute = workerSource.slice(
    workerSource.indexOf("app.get('/api/students/:id'"),
    workerSource.indexOf("app.get('/api/students/:id/enrollments'"),
  );
  assert.match(studentRoute, /requireAuthEnforced\(\), requireRoles\(ACADEMIC_ACCESS_ROLES\)/);
  assert.match(studentRoute, /student\.school_id !== user\.school_id/);
  assert.match(studentRoute, /غير مسموح: لا يمكنك الوصول إلى بيانات هذا الطالب/);
});

test('alphanumeric student numbers are displayed LTR and preserve the stored value', () => {
  assert.ok((profileSource.match(/<bdi dir="ltr">\{student\.student_number\}<\/bdi>/g) || []).length >= 2);
  assert.match(studentsSource, /<bdi dir="ltr">\{s\.student_number\}<\/bdi>/);
});

test('student numbers are never passed through Arabic digit transformation', () => {
  assert.doesNotMatch(profileSource, /toArabicDigits\(student\.student_number\)/);
  assert.doesNotMatch(studentsSource, /toArabicDigits\(s\.student_number\)/);
});

test('the active academic year history row is labeled as current', () => {
  assert.equal(enrollmentYearBadge(
    { academic_year_id: 20, starts_at: '2026-09-01' },
    20,
    '2026-09-01',
  ), 'السنة الحالية');
});

test('a later academic year history row is labeled as upcoming', () => {
  assert.equal(enrollmentYearBadge(
    { academic_year_id: 2, starts_at: '2027-09-01' },
    20,
    '2026-09-01',
  ), 'السنة القادمة');
});

test('upcoming-year detection uses starts_at chronology rather than numeric IDs', () => {
  assert.equal(enrollmentYearBadge(
    { academic_year_id: 1, starts_at: '2027-09-01' },
    500,
    '2026-09-01',
  ), 'السنة القادمة');
  assert.equal(enrollmentYearBadge(
    { academic_year_id: 999, starts_at: '2025-09-01' },
    500,
    '2026-09-01',
  ), null);
  assert.doesNotMatch(source('src/lib/studentProfilePresentation.ts'), /academic_year_id\s*[<>]/);
});

test('student identity badge explicitly identifies Student status', () => {
  assert.match(profileSource, /حالة الطالب: \{studentStatusLabel\(student\.status\)\}/);
});

test('profile refinements do not introduce enrollment lifecycle mutations', () => {
  assert.doesNotMatch(profileSource, /updateStudent|student-enrollments\/promotion|promotion_status\s*=/);
});
