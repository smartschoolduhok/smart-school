import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  resolveRequiredWriteSchoolId,
  resolveTenantSchoolId,
} from '../src/lib/tenantSchool.ts';

const testDir = dirname(fileURLToPath(import.meta.url));
const rootDir = join(testDir, '..');

function source(path) {
  return readFileSync(join(rootDir, path), 'utf8');
}

function runtimeSources(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const fullPath = join(directory, entry);
    if (statSync(fullPath).isDirectory()) {
      files.push(...runtimeSources(fullPath));
    } else if (/\.(?:ts|tsx)$/.test(entry) && !entry.endsWith('.bak')) {
      files.push(fullPath);
    }
  }
  return files;
}

test('system_admin has no implicit school and writes require an explicit target', () => {
  assert.equal(resolveTenantSchoolId('system_admin', null, null), null);
  assert.deepEqual(resolveRequiredWriteSchoolId('system_admin', null, null), { ok: false, status: 400 });
  assert.deepEqual(resolveRequiredWriteSchoolId('system_admin', null, 0), { ok: false, status: 400 });
});

test('system_admin selection uses the selected school instead of school 1', () => {
  assert.equal(resolveTenantSchoolId('system_admin', null, 27), 27);
  assert.deepEqual(resolveRequiredWriteSchoolId('system_admin', null, 27), { ok: true, schoolId: 27 });
});

test('tenant-bound roles remain fixed to their authenticated school', () => {
  for (const role of ['school_owner', 'principal', 'vice_principal', 'registrar']) {
    assert.equal(resolveTenantSchoolId(role, 9, 27), 9);
    assert.deepEqual(resolveRequiredWriteSchoolId(role, 9, undefined), { ok: true, schoolId: 9 });
    assert.deepEqual(resolveRequiredWriteSchoolId(role, 9, 27), { ok: false, status: 403 });
  }
});

test('classes and sections load only the selected school and discard stale school loads', () => {
  const classesPage = source('src/modules/classes/ClassesPage.tsx');
  assert.match(classesPage, /getClasses\(targetSchoolId\)/);
  assert.match(classesPage, /getSections\(targetSchoolId\)/);
  assert.match(classesPage, /requestId !== loadRequestId\.current/);
  assert.match(classesPage, /setClasses\(\[\]\)/);
  assert.match(classesPage, /setSections\(\[\]\)/);
  assert.match(classesPage, /canManageSelectedSchool = canManage && schoolId != null/);
  assert.match(classesPage, /school_id: schoolId/);
});

test('runtime frontend contains no fallback or hardcoded tenant school 1', () => {
  const srcDir = join(rootDir, 'src');
  const fixturePath = join('src', 'data', 'demoData.ts');
  const unsafePatterns = [
    /(?:user\?\.)?school_id\s*(?:\?\?|\|\|)\s*1\b/,
    /(?:user\?\.)?schoolId\s*(?:\?\?|\|\|)\s*1\b/,
    /school_id\s*:\s*1\b/,
    /\bschoolId\s*=\s*1\b/,
  ];

  const violations = [];
  for (const file of runtimeSources(srcDir)) {
    const relativePath = relative(rootDir, file);
    if (relativePath === fixturePath) continue;
    const text = readFileSync(file, 'utf8');
    for (const pattern of unsafePatterns) {
      if (pattern.test(text)) violations.push(`${relativePath}: ${pattern}`);
    }
  }

  assert.deepEqual(violations, []);
});

test('backend write-school authority rejects missing targets and validates active schools', () => {
  const worker = source('src/worker.ts');
  assert.match(worker, /resolveRequiredWriteSchoolId\(user\.role_key, user\.school_id, requested\)/);
  assert.match(worker, /SELECT id, status FROM schools WHERE id = \?/);
  assert.match(worker, /!school \|\| school\.status !== 'active'/);

  for (const route of [
    "app.post('/api/classes'",
    "app.post('/api/sections'",
    "app.post('/api/students'",
    "app.post('/api/subjects'",
    "app.post('/api/student-subjects/assign-class'",
    "app.post('/api/grades/initialize-section'",
    "app.put('/api/grade-settings'",
    "app.put('/api/settings/school'",
    "app.post('/api/import-export/:type/preview'",
    "app.post('/api/import-export/:type/confirm'",
  ]) {
    const routeIndex = worker.indexOf(route);
    assert.notEqual(routeIndex, -1, `missing audited route ${route}`);
    const routeBlock = worker.slice(routeIndex, routeIndex + 6000);
    assert.match(routeBlock, /resolveActiveWriteSchool\(db, user, (?:body\.)?school_id\)/, route);
  }
});
