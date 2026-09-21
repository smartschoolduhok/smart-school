import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  calculateStaffAttendanceStatus,
  createEmployeeAttendanceCardPayload,
  parseStaffAttendanceSettingsInput,
  reconcileEmployeeAttendanceCard,
  verifyEmployeeAttendanceCardPayload,
} from '../src/lib/staffAttendance.ts';
import {
  STAFF_ATTENDANCE_MANAGEMENT_ROLES,
  STAFF_ATTENDANCE_REPORT_ROLES,
  STAFF_ATTENDANCE_VIEW_ROLES,
  hasRole,
} from '../src/lib/rbac.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = path => readFileSync(join(root, path), 'utf8');
const page = source('src/modules/attendance/StaffAttendancePage.tsx');
const app = source('src/App.tsx');
const sidebar = source('src/components/Sidebar.tsx');
const api = source('src/lib/api.ts');
const worker = source('src/lib/staffAttendanceDb.ts');
const migration = source('migrations/0040_staff_attendance.sql');

test('staff attendance role boundaries separate operation, reporting and linked teacher self-view', () => {
  for (const role of ['system_admin', 'school_owner', 'principal', 'vice_principal', 'registrar']) {
    assert.equal(hasRole(role, STAFF_ATTENDANCE_MANAGEMENT_ROLES), true, role);
    assert.equal(hasRole(role, STAFF_ATTENDANCE_REPORT_ROLES), true, role);
    assert.equal(hasRole(role, STAFF_ATTENDANCE_VIEW_ROLES), true, role);
  }
  assert.equal(hasRole('accountant', STAFF_ATTENDANCE_MANAGEMENT_ROLES), false);
  assert.equal(hasRole('accountant', STAFF_ATTENDANCE_REPORT_ROLES), true);
  assert.equal(hasRole('teacher', STAFF_ATTENDANCE_REPORT_ROLES), false);
  assert.equal(hasRole('teacher', STAFF_ATTENDANCE_VIEW_ROLES), true);
  assert.equal(hasRole('parent', STAFF_ATTENDANCE_VIEW_ROLES), false);
  assert.match(app, /path="\/staff-attendance"[\s\S]*?allowedRoles=\{STAFF_ATTENDANCE_VIEW_ROLES\}/);
  assert.match(sidebar, /label: 'حضور الموظفين'[\s\S]*?allowedRoles: STAFF_ATTENDANCE_VIEW_ROLES/);
  assert.match(worker, /STAFF_ATTENDANCE_MANAGEMENT_ROLES/);
  assert.match(worker, /STAFF_ATTENDANCE_REPORT_ROLES/);
  assert.match(worker, /user\?\.role_key === 'teacher'/);
});

test('staff UI supports QR and USB scanning, manual audited entry, daily reporting and 390px-safe cards', () => {
  for (const label of [
    'حضور الموظفين والأساتذة',
    'المسح والتسجيل',
    'التقرير اليومي',
    'تسجيل يدوي بسبب موثق',
    'سبب التسجيل اليدوي (إلزامي)',
    'سبب الإدخال اليدوي:',
    'إبطال بسبب موثق',
    'التقرير للمتابعة والمراجعة فقط؛ لا ينشئ خصمًا أو راتبًا تلقائيًا.',
  ]) assert.ok(page.includes(label), label);
  assert.match(page, /BarcodeDetector/);
  assert.match(page, /getUserMedia/);
  assert.match(page, /onSubmit=\{\(event\).*submitScan/);
  assert.match(page, /Date\.parse\(`\$\{value\}:00\+03:00`\)/);
  assert.match(page, /className="min-w-0 space-y-5"/);
  assert.match(page, /grid min-w-0 gap-5/);
  assert.doesNotMatch(page, /min-w-\[[4-9][0-9]{2}px\]/);
});

test('employee cards print only while active and refreshed data removes stale printable previews', () => {
  for (const label of [
    'إصدار بطاقة موظف',
    'بطاقة حضور الموظف',
    'طباعة البطاقة',
    'بطاقة ملغاة — غير صالحة للمسح أو الطباعة',
  ]) assert.ok(page.includes(label), label);
  assert.match(page, /issuedCard\.status === 'active' && <button/);
  assert.match(page, /QRCodeSVG value=\{issuedCard\.qr_value\}/);
  assert.match(page, /window\.print\(\)/);
  const active = { id: 51, status: 'active', qr_value: 'active-value' };
  const revoked = { id: 51, status: 'revoked', qr_value: 'revoked-value' };
  assert.equal(reconcileEmployeeAttendanceCard(null, [revoked]), null);
  assert.equal(reconcileEmployeeAttendanceCard(active, []), null);
  assert.equal(reconcileEmployeeAttendanceCard(active, [revoked]), revoked);
  assert.match(page, /setIssuedCard\(\(current\) => reconcileEmployeeAttendanceCard\(current, refreshed\)\)/);
});

test('employee QR payload is domain-separated from student cards and rejects tampering', async () => {
  const secret = 'generated-local-staff-attendance-secret-only';
  const publicId = 'e5303204-28f2-4a63-8d98-e18de8875598';
  const payload = await createEmployeeAttendanceCardPayload(publicId, secret);
  assert.ok(payload.startsWith('SSE1.'));
  assert.equal(await verifyEmployeeAttendanceCardPayload(payload, secret), publicId);
  assert.equal(await verifyEmployeeAttendanceCardPayload(`${payload}x`, secret), null);
  assert.equal(await verifyEmployeeAttendanceCardPayload(payload.replace('SSE1.', 'SSG1.')), null);
  assert.equal(await verifyEmployeeAttendanceCardPayload(payload, `${secret}-other`), null);
});

test('staff time classification and settings validation remain independent of student gate settings', () => {
  const settings = {
    work_start_time: '07:30',
    late_grace_minutes: 5,
    work_end_time: '14:30',
    early_exit_grace_minutes: 10,
  };
  assert.deepEqual(calculateStaffAttendanceStatus('entry', '07:35', settings), { status: 'on_time', lateMinutes: 0 });
  assert.deepEqual(calculateStaffAttendanceStatus('entry', '07:36', settings), { status: 'late', lateMinutes: 6 });
  assert.deepEqual(calculateStaffAttendanceStatus('exit', '14:19', settings), { status: 'early_exit', lateMinutes: 0 });
  assert.deepEqual(calculateStaffAttendanceStatus('exit', '14:20', settings), { status: 'normal', lateMinutes: 0 });
  assert.throws(() => parseStaffAttendanceSettingsInput({
    school_id: 1,
    work_start_time: '14:30',
    late_grace_minutes: 5,
    work_end_time: '07:30',
    early_exit_grace_minutes: 10,
    duplicate_window_seconds: 60,
  }), error => error.code === 'invalid_staff_attendance_time');
});

test('API client exposes scoped staff operations, report endpoints and personal teacher feed', () => {
  for (const route of [
    '/api/staff-attendance/settings',
    '/api/staff-attendance/employees',
    '/api/staff-attendance/cards',
    '/api/staff-attendance/scan',
    '/api/staff-attendance/manual',
    '/api/staff-attendance/events',
    '/api/staff-attendance/summary',
    '/api/staff-attendance/self',
  ]) assert.ok(api.includes(route), route);
  assert.match(page, /getMyStaffAttendance\(range\.from, range\.to\)/);
  assert.match(worker, /teacher_employee_links link/);
  assert.match(worker, /publicEvent\(row, false\)/);
});

test('migration keeps employee attendance separate, annual, immutable and auditable', () => {
  for (const table of [
    'staff_attendance_settings',
    'employee_attendance_cards',
    'employee_attendance_events',
    'employee_attendance_event_audit',
    'employee_attendance_write_guards',
  ]) assert.ok(migration.includes(`CREATE TABLE IF NOT EXISTS ${table}`), table);
  assert.match(migration, /academic_year_id[\s\S]*REFERENCES academic_years/);
  assert.match(migration, /late_grace_minutes_snapshot/);
  assert.match(migration, /early_exit_grace_minutes_snapshot/);
  assert.match(migration, /staff attendance scan duplicate/);
  assert.match(migration, /staff attendance event identity immutable/);
  assert.match(migration, /staff attendance event history immutable/);
  assert.match(migration, /trg_employee_attendance_events_audit_void/);
  assert.match(migration, /uq_employee_attendance_cards_active_employee/);
  assert.doesNotMatch(migration, /signature\s+TEXT|qr_value\s+TEXT/i);
  assert.doesNotMatch(migration, /student_gate_events|lesson_attendance_sessions/);
});
