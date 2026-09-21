import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  calculateGateStatus,
  createGateCardPayload,
  parseGateSettingsInput,
  reconcileIssuedGateCard,
  verifyGateCardPayload,
} from '../src/lib/gateAttendance.ts';
import {
  GATE_ATTENDANCE_MANAGEMENT_ROLES,
  GATE_ATTENDANCE_VIEW_ROLES,
  hasRole,
} from '../src/lib/rbac.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = path => readFileSync(join(root, path), 'utf8');
const page = source('src/modules/attendance/GateAttendancePage.tsx');
const parentPage = source('src/modules/attendance/AttendancePage.tsx');
const header = source('src/components/Header.tsx');
const app = source('src/App.tsx');
const sidebar = source('src/components/Sidebar.tsx');
const api = source('src/lib/api.ts');
const worker = source('src/lib/gateAttendanceDb.ts');
const migration = source('migrations/0039_student_gate_attendance.sql');

test('gate operation is restricted to management while parents keep a scoped feed', () => {
  for (const role of ['system_admin', 'school_owner', 'principal', 'vice_principal', 'registrar']) {
    assert.equal(hasRole(role, GATE_ATTENDANCE_MANAGEMENT_ROLES), true, role);
    assert.equal(hasRole(role, GATE_ATTENDANCE_VIEW_ROLES), true, role);
  }
  for (const role of ['teacher', 'accountant', 'parent']) {
    assert.equal(hasRole(role, GATE_ATTENDANCE_VIEW_ROLES), false, role);
  }
  assert.match(app, /path="\/gate-attendance"[\s\S]*?allowedRoles=\{GATE_ATTENDANCE_VIEW_ROLES\}/);
  assert.match(sidebar, /label: 'بوابة المدرسة'[\s\S]*?allowedRoles: GATE_ATTENDANCE_VIEW_ROLES/);
  assert.match(worker, /hasRole\(user\.role_key, GATE_ATTENDANCE_MANAGEMENT_ROLES\)/);
  assert.match(worker, /user\?\.role_key === 'parent'/);
});

test('scanner UI supports USB input, progressive camera QR, manual reason and 390px-safe layouts', () => {
  for (const label of [
    'حضور بوابة المدرسة',
    'المسح والتسجيل',
    'مسح بالكاميرا',
    'تسجيل يدوي بسبب موثق',
    'سبب التسجيل اليدوي (إلزامي)',
    'إبطال بسبب موثق',
  ]) assert.ok(page.includes(label), label);
  assert.match(page, /BarcodeDetector/);
  assert.match(page, /getUserMedia/);
  assert.match(page, /onSubmit=\{\(event\).*submitScan/);
  assert.match(page, /Date\.parse\(`\$\{value\}:00\+03:00`\)/);
  assert.match(page, /className="min-w-0 space-y-5"/);
  assert.match(page, /grid min-w-0 gap-5/);
  assert.doesNotMatch(page, /min-w-\[[4-9][0-9]{2}px\]/);
});

test('cards are printable only while active, revocable and never expose a stored signature', () => {
  for (const label of ['إصدار بطاقة طالب', 'بطاقة حضور الطالب', 'طباعة البطاقة', 'بطاقة ملغاة — غير صالحة للمسح أو الطباعة', 'إلغاء']) {
    assert.ok(page.includes(label), label);
  }
  assert.match(page, /issuedCard\.status === 'active' && <button/);
  assert.match(page, /QRCodeSVG value=\{issuedCard\.qr_value\}/);
  assert.match(page, /window\.print\(\)/);
  assert.match(worker, /crypto\.randomUUID\(\)/);
  assert.doesNotMatch(migration, /signature\s+TEXT|qr_value\s+TEXT/i);
});

test('a refreshed card list cannot leave a stale printable active-card preview', () => {
  const active = { id: 41, status: 'active', qr_value: 'active-value' };
  const revoked = { id: 41, status: 'revoked', qr_value: 'revoked-value' };
  assert.equal(reconcileIssuedGateCard(null, [revoked]), null);
  assert.equal(reconcileIssuedGateCard(active, []), null);
  assert.equal(reconcileIssuedGateCard(active, [revoked]), revoked);
  assert.match(page, /setIssuedCard\(\(current\) => reconcileIssuedGateCard\(current, refreshedCards\)\)/);
});

test('signed QR payload validates exactly and rejects a changed signature', async () => {
  const secret = 'generated-local-gate-attendance-secret-only';
  const publicId = 'bb47e30b-4bc9-4b5d-9ae8-c35a9de40c22';
  const payload = await createGateCardPayload(publicId, secret);
  assert.equal(await verifyGateCardPayload(payload, secret), publicId);
  assert.equal(await verifyGateCardPayload(`${payload}x`, secret), null);
  assert.equal(await verifyGateCardPayload(payload, `${secret}-other`), null);
});

test('time classification respects grace periods without hiding actual late minutes', () => {
  const settings = {
    school_start_time: '08:00', late_grace_minutes: 10,
    school_end_time: '14:00', early_exit_grace_minutes: 5,
  };
  assert.deepEqual(calculateGateStatus('entry', '08:10', settings), { status: 'on_time', lateMinutes: 0 });
  assert.deepEqual(calculateGateStatus('entry', '08:11', settings), { status: 'late', lateMinutes: 11 });
  assert.deepEqual(calculateGateStatus('exit', '13:54', settings), { status: 'early_exit', lateMinutes: 0 });
  assert.deepEqual(calculateGateStatus('exit', '13:55', settings), { status: 'normal', lateMinutes: 0 });
  assert.throws(() => parseGateSettingsInput({
    school_id: 1, school_start_time: '14:00', late_grace_minutes: 10,
    school_end_time: '08:00', early_exit_grace_minutes: 0,
    duplicate_window_seconds: 60, parent_notifications_enabled: true,
  }), error => error.code === 'invalid_gate_time');
});

test('parents receive linked gate movements and real header notifications without internal notes', () => {
  assert.match(parentPage, /getParentGateAttendance\(from, to\)/);
  assert.ok(parentPage.includes('دخول وخروج المدرسة'));
  assert.match(worker, /parent_student_links link/);
  assert.match(worker, /publicEvent\(row, false\)/);
  assert.match(header, /getNotifications\(20\)/);
  assert.match(header, /markNotificationRead\(notificationKey\)/);
  assert.match(header, /notificationFeed\.unread_count/);
  assert.match(api, /\/api\/gate-attendance\/parent\?\$\{params\}/);
  assert.match(api, /\/api\/notifications\/\$\{notificationKey\}\/read/);
});

test('migration preserves immutable events, atomic dedupe, audit and resource-scoped notification delivery', () => {
  for (const table of [
    'gate_attendance_settings',
    'student_gate_cards',
    'student_gate_events',
    'student_gate_event_audit',
    'gate_attendance_write_guards',
    'school_notifications',
    'notification_recipients',
  ]) assert.ok(migration.includes(`CREATE TABLE IF NOT EXISTS ${table}`), table);
  assert.match(migration, /gate scan duplicate/);
  assert.match(migration, /gate event identity immutable/);
  assert.match(migration, /gate event history immutable/);
  assert.match(migration, /trg_student_gate_events_audit_void/);
  assert.match(migration, /notification parent link invalid/);
  assert.match(migration, /uq_student_gate_cards_active_student/);
});
