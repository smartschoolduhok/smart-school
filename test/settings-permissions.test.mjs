import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  SETTINGS_MANAGEMENT_ROLES,
  SETTINGS_VIEW_ROLES,
  canEditSchoolSettings,
  hasRole,
} from '../src/lib/rbac.ts';

const testDir = dirname(fileURLToPath(import.meta.url));
const rootDir = join(testDir, '..');

function source(path) {
  return readFileSync(join(rootDir, path), 'utf8');
}

test('authenticated role_key is preserved from login and /api/auth/me through useAuth', () => {
  const worker = source('src/worker.ts');
  const useAuth = source('src/hooks/useAuth.tsx');

  assert.match(worker, /role_key:\s*row\.role_key/);
  assert.match(worker, /app\.get\('\/api\/auth\/me'[\s\S]*?return c\.json\(\{ data: user \}\)/);
  assert.match(useAuth, /const \{ token, user \} = body\.data/);
  assert.match(useAuth, /user:\s*body\.data/);
});

test('settings management roles are editable only with a resolved school target', () => {
  for (const role of ['system_admin', 'school_owner', 'principal', 'vice_principal']) {
    assert.equal(hasRole(role, SETTINGS_MANAGEMENT_ROLES), true, role);
    assert.equal(canEditSchoolSettings(role, 27), true, role);
  }
  assert.equal(canEditSchoolSettings('system_admin', null), false);
});

test('non-management school roles may view settings but remain read-only', () => {
  for (const role of ['teacher', 'accountant', 'registrar', 'parent']) {
    assert.equal(hasRole(role, SETTINGS_VIEW_ROLES), true, role);
    assert.equal(hasRole(role, SETTINGS_MANAGEMENT_ROLES), false, role);
    assert.equal(canEditSchoolSettings(role, 27), false, role);
  }
});

test('SettingsPage uses the resolved tenant school and the already-unwrapped API payload', () => {
  const page = source('src/modules/settings/SettingsPage.tsx');
  const profile = source('src/modules/settings/SchoolProfileTab.tsx');

  assert.match(page, /canEditSchoolSettings\(user\?\.role_key, effectiveSchoolId\)/);
  assert.match(page, /setSchoolData\(schoolRes\.data \|\| \{\}\)/);
  assert.match(page, /setDocumentData\(docRes\.data \|\| \{\}\)/);
  assert.match(page, /setSystemData\(sysRes\.data \|\| \{\}\)/);
  assert.doesNotMatch(page, /\.data\?\.data/);
  assert.match(profile, /const EMPTY_SCHOOL_PROFILE/);
  assert.match(profile, /disabled=\{!canEdit\}/);
});

test('settings routes align read and mutation roles while keeping backend school authority', () => {
  const worker = source('src/worker.ts');

  for (const path of ['school', 'document', 'system']) {
    assert.match(
      worker,
      new RegExp(`app\\.get\\('\\/api\\/settings\\/${path}', requireSameSchoolOrAdmin\\(\\), requireRoles\\(SETTINGS_VIEW_ROLES\\)`),
      `${path} read policy`,
    );
    assert.match(
      worker,
      new RegExp(`app\\.put\\('\\/api\\/settings\\/${path}', requireSameSchoolOrAdmin\\(\\), requireRoles\\(SETTINGS_MANAGEMENT_ROLES\\)`),
      `${path} mutation policy`,
    );
  }

  assert.match(worker, /app\.get\('\/api\/academic-years', requireSameSchoolOrAdmin\(\), requireRoles\(SETTINGS_VIEW_ROLES\)/);
  assert.match(worker, /app\.post\('\/api\/academic-years', requireSameSchoolOrAdmin\(\), requireRoles\(SETTINGS_MANAGEMENT_ROLES\)/);
  assert.match(worker, /app\.put\('\/api\/grade-settings', requireSameSchoolOrAdmin\(\), requireRoles\(SETTINGS_MANAGEMENT_ROLES\)/);

  const settingsRoutes = worker.slice(worker.indexOf("app.put('/api/settings/school'"), worker.indexOf('// PHASE 12: OFFICIAL BOOKS MODULE'));
  assert.equal((settingsRoutes.match(/resolveActiveWriteSchool\(db, user, body\.school_id\)/g) || []).length, 3);
});

