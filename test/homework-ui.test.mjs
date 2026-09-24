import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  HOMEWORK_ACCEPTED_MIME_TYPES,
  HOMEWORK_MAX_ATTACHMENTS,
  HOMEWORK_MAX_FILE_BYTES,
  HOMEWORK_MAX_TOTAL_BYTES,
  validateHomeworkAttachmentBytes,
} from '../src/lib/homework.ts';
import {
  HOMEWORK_AUTHOR_ROLES,
  HOMEWORK_MANAGEMENT_ROLES,
  HOMEWORK_STAFF_VIEW_ROLES,
  HOMEWORK_VIEW_ROLES,
  hasRole,
} from '../src/lib/rbac.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = path => readFileSync(join(root, path), 'utf8');
const page = source('src/modules/homework/HomeworkPage.tsx');
const app = source('src/App.tsx');
const sidebar = source('src/components/Sidebar.tsx');
const api = source('src/lib/api.ts');
const worker = source('src/lib/homeworkDb.ts');
const platformWorker = source('src/worker.ts');
const migration = source('migrations/0041_homework.sql');

test('homework role boundaries separate authors, staff readers and linked parents', () => {
  for (const role of ['system_admin', 'school_owner', 'principal', 'vice_principal']) {
    assert.equal(hasRole(role, HOMEWORK_MANAGEMENT_ROLES), true, role);
    assert.equal(hasRole(role, HOMEWORK_AUTHOR_ROLES), true, role);
  }
  assert.equal(hasRole('teacher', HOMEWORK_AUTHOR_ROLES), true);
  assert.equal(hasRole('teacher', HOMEWORK_MANAGEMENT_ROLES), false);
  assert.equal(hasRole('registrar', HOMEWORK_STAFF_VIEW_ROLES), true);
  assert.equal(hasRole('registrar', HOMEWORK_AUTHOR_ROLES), false);
  assert.equal(hasRole('parent', HOMEWORK_VIEW_ROLES), true);
  assert.equal(hasRole('parent', HOMEWORK_STAFF_VIEW_ROLES), false);
  assert.equal(hasRole('accountant', HOMEWORK_VIEW_ROLES), false);
  assert.match(app, /path="\/homework"[\s\S]*?allowedRoles=\{HOMEWORK_VIEW_ROLES\}/);
  assert.match(sidebar, /label: 'الواجبات المنزلية'[\s\S]*?allowedRoles: HOMEWORK_VIEW_ROLES/);
});

test('attachment policy validates declared MIME and file signatures', () => {
  assert.equal(HOMEWORK_MAX_ATTACHMENTS, 5);
  assert.equal(HOMEWORK_MAX_FILE_BYTES, 5 * 1024 * 1024);
  assert.equal(HOMEWORK_MAX_TOTAL_BYTES, 20 * 1024 * 1024);
  assert.deepEqual([...HOMEWORK_ACCEPTED_MIME_TYPES].sort(), [
    'application/pdf', 'image/jpeg', 'image/png', 'image/webp',
  ].sort());

  assert.equal(validateHomeworkAttachmentBytes('image/jpeg', new Uint8Array([0xff, 0xd8, 0xff, 0x00])), true);
  assert.equal(validateHomeworkAttachmentBytes('image/png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), true);
  assert.equal(validateHomeworkAttachmentBytes('image/webp', new TextEncoder().encode('RIFF1234WEBP')), true);
  assert.equal(validateHomeworkAttachmentBytes('application/pdf', new TextEncoder().encode('%PDF-1.7')), true);
  assert.equal(validateHomeworkAttachmentBytes('application/pdf', new TextEncoder().encode('<script>')), false);
  assert.equal(validateHomeworkAttachmentBytes('image/png', new Uint8Array([0xff, 0xd8, 0xff])), false);
});

test('homework page is Arabic, role-aware and safe at 390px', () => {
  for (const label of [
    'الواجبات المنزلية',
    'واجب جديد',
    'حفظ كمسودة',
    'نشر الواجب',
    'سحب الواجب',
    'إنشاء نسخة مصححة',
    'واجبات أبنائي',
    'كل الأبناء',
    'القادمة',
    'المتأخرة',
    'بلا موعد',
    'كل الصفوف والمواد',
    'تاريخ التكليف',
    'للقراءة فقط',
    'JPEG أو PNG أو WebP أو PDF',
    'بانتظار تنظيف التخزين',
    'إعادة محاولة تنظيف المرفق',
  ]) assert.ok(page.includes(label), label);
  assert.match(page, /dir="rtl"/);
  assert.match(page, /className="min-w-0 space-y-5"/);
  assert.match(page, /grid min-w-0 gap-/);
  assert.doesNotMatch(page, /min-w-\[[4-9][0-9]{2}px\]/);
  assert.match(page, /user\?\.role_key === 'parent'/);
  assert.match(page, /user\?\.role_key === 'registrar'/);
});

test('API client and route module expose the complete protected workflow', () => {
  for (const route of [
    '/api/homework/scopes',
    '/api/homework/parent',
    '/api/homework/attachments/',
    '/api/homework',
  ]) assert.ok(api.includes(route), route);
  for (const suffix of [
    '/attachments',
    '/publish',
    '/withdraw',
    '/replacement',
  ]) assert.ok(api.includes(suffix), suffix);
  assert.match(worker, /HOMEWORK_FILES/);
  assert.match(worker, /teacher_employee_links/);
  assert.match(worker, /parent_student_links/);
  assert.match(worker, /json_each/);
  assert.match(worker, /school_notifications/);
  assert.match(worker, /notification_recipients/);
  assert.match(platformWorker, /Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS'/);
});

test('migration makes published homework, audience and audit non-destructive', () => {
  for (const table of [
    'homework_assignments',
    'homework_attachments',
    'homework_audience',
    'homework_audit',
    'homework_write_guards',
  ]) assert.ok(migration.includes(`CREATE TABLE IF NOT EXISTS ${table}`), table);
  assert.match(migration, /draft.*published.*withdrawn/s);
  assert.match(migration, /homework published immutable/);
  assert.match(migration, /homework history immutable/);
  assert.match(migration, /homework audience immutable/);
  assert.match(migration, /homework audit immutable/);
  assert.match(migration, /homework attachment limit exceeded/);
  assert.match(migration, /homework attachment total exceeded/);
  assert.match(migration, /removal_pending/);
  assert.match(migration, /homework attachment cleanup pending/);
  assert.match(migration, /trg_homework_assignments_audit_insert/);
  assert.match(migration, /trg_homework_assignments_audit_update/);
  assert.match(migration, /'replaced'/);
  assert.doesNotMatch(migration, /CREATE TABLE[^;]*(submission|grade|chat)/i);
});
