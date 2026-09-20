import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  attendanceDayOfWeek,
  parseAttendanceSaveRequest,
  validateAttendanceRange,
} from '../src/lib/attendance.ts';
import {
  ATTENDANCE_MANAGEMENT_ROLES,
  ATTENDANCE_STAFF_ROLES,
  ATTENDANCE_VIEW_ROLES,
  hasRole,
} from '../src/lib/rbac.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = (path) => readFileSync(join(root, path), 'utf8');
const page = source('src/modules/attendance/AttendancePage.tsx');
const app = source('src/App.tsx');
const sidebar = source('src/components/Sidebar.tsx');
const api = source('src/lib/api.ts');
const worker = source('src/lib/attendanceDb.ts');
const migration = source('migrations/0038_lesson_attendance.sql');

test('attendance roles align the route, navigation and backend boundaries', () => {
  for (const role of ['system_admin', 'school_owner', 'principal', 'vice_principal', 'teacher', 'registrar']) {
    assert.equal(hasRole(role, ATTENDANCE_STAFF_ROLES), true, role);
  }
  for (const role of ['system_admin', 'school_owner', 'principal', 'vice_principal', 'registrar']) {
    assert.equal(hasRole(role, ATTENDANCE_MANAGEMENT_ROLES), true, role);
  }
  assert.equal(hasRole('teacher', ATTENDANCE_MANAGEMENT_ROLES), false);
  assert.equal(hasRole('parent', ATTENDANCE_VIEW_ROLES), true);
  assert.equal(hasRole('accountant', ATTENDANCE_VIEW_ROLES), false);
  assert.match(app, /path="\/attendance"[\s\S]*?allowedRoles=\{ATTENDANCE_VIEW_ROLES\}/);
  assert.match(sidebar, /label: 'الحضور والغياب'[\s\S]*?allowedRoles: ATTENDANCE_VIEW_ROLES/);
  assert.match(worker, /hasRole\(user\.role_key, ATTENDANCE_STAFF_ROLES\)/);
  assert.match(worker, /user\?\.role_key === 'parent'/);
});

test('teacher workflow is timetable-derived, Arabic RTL, explicit draft then confirm', () => {
  assert.match(page, /dir="rtl"/);
  for (const label of [
    'حضور الحصص',
    'الحصص مأخوذة من الجدول الرسمي',
    'تعيين الجميع حاضرًا',
    'حفظ مسودة',
    'اعتماد وإظهار لولي الأمر',
    'سبب تصحيح السجل المعتمد',
  ]) assert.ok(page.includes(label), label);
  assert.match(page, /getAttendanceLessons\(schoolId, date\)/);
  assert.match(page, /getAttendanceLesson\(schoolId, entryId, date\)/);
  assert.match(page, /expected_revision: detail\.lesson\.revision/);
  assert.match(page, /window\.confirm/);
});

test('student attendance editor exposes every agreed state, delay and note visibility', () => {
  for (const label of ['حاضر', 'غائب', 'غائب بعذر', 'متأخر', 'خرج مبكرًا', 'نشاط مدرسي']) {
    assert.ok(source('src/lib/attendance.ts').includes(label), label);
  }
  assert.ok(page.includes('دقائق التأخير'));
  assert.ok(page.includes('تظهر الملاحظة لولي الأمر'));
  assert.ok(page.includes('ملاحظة داخلية للمدرسة'));
  assert.match(page, /note_visibility: event\.target\.checked \? 'parent' : 'staff'/);
  assert.match(page, /sm:grid-cols-\[minmax\(0,1fr\)_150px\]/);
  assert.match(page, /grid gap-3 lg:grid-cols-2/);
});

test('student attendance cards can shrink inside the 390px single-column grid', () => {
  assert.match(page, /<article className="min-w-0 rounded-2xl border border-gray-200 bg-white p-4">/);
});

test('parent view is a confirmed-only child feed and never requests broad attendance data', () => {
  for (const label of ['حضور أبنائي', 'سجلات الحصص التي اعتمدتها المدرسة فقط', 'ملاحظة المدرسة']) {
    assert.ok(page.includes(label), label);
  }
  assert.match(page, /getParentAttendance\(from, to\)/);
  assert.doesNotMatch(page.slice(page.indexOf('function ParentAttendance')), /getAttendanceLessons\(/);
  assert.match(worker, /session\.status = 'confirmed'/);
  assert.match(worker, /CASE WHEN record\.note_visibility = 'parent' THEN record\.note ELSE NULL END/);
  assert.match(worker, /parent_student_links/);
});

test('API client exposes scoped lesson reads, optimistic writes and the parent feed', () => {
  assert.match(api, /\/api\/attendance\/lessons\?\$\{query\}/);
  assert.match(api, /\/api\/attendance\/lessons\/\$\{timetableEntryId\}/);
  assert.match(api, /\/api\/attendance\/parent\?\$\{query\}/);
  assert.match(api, /method: 'PUT'/);
});

test('attendance validation rejects duplicates, non-late minutes and oversized ranges', () => {
  assert.equal(attendanceDayOfWeek('2026-09-13'), 0);
  assert.throws(() => parseAttendanceSaveRequest({
    school_id: 1, session_date: '2026-09-13', expected_revision: 0, action: 'draft', change_reason: null,
    records: [
      { student_id: 1, status: 'present', late_minutes: 0, note: null, note_visibility: 'staff' },
      { student_id: 1, status: 'absent', late_minutes: 0, note: null, note_visibility: 'staff' },
    ],
  }), (error) => error.code === 'duplicate_attendance_student');
  assert.throws(() => parseAttendanceSaveRequest({
    school_id: 1, session_date: '2026-09-13', expected_revision: 0, action: 'draft', change_reason: null,
    records: [{ student_id: 1, status: 'present', late_minutes: 5, note: null, note_visibility: 'staff' }],
  }), (error) => error.code === 'invalid_late_minutes');
  assert.throws(
    () => validateAttendanceRange('2025-01-01', '2026-09-13'),
    (error) => error.code === 'attendance_range_too_large',
  );
});

test('migration keeps lesson snapshots, immutable identity, revision guards and audit history', () => {
  for (const table of [
    'lesson_attendance_sessions',
    'lesson_attendance_records',
    'lesson_attendance_record_audit',
    'lesson_attendance_write_guards',
  ]) assert.ok(migration.includes(`CREATE TABLE IF NOT EXISTS ${table}`), table);
  assert.match(migration, /attendance session identity immutable/);
  assert.match(migration, /attendance session cannot return to draft/);
  assert.match(migration, /CHECK \(valid = 1\)/);
  assert.match(migration, /trg_lesson_attendance_records_audit_update/);
});
