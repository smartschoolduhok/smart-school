import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  resolveRequiredWriteSchoolId,
  resolveTenantSchoolId,
} from '../src/lib/tenantSchool.ts';
import { createRequestGeneration } from '../src/lib/requestGeneration.ts';
import {
  createSystemAdminSchoolSessionStore,
  SYSTEM_ADMIN_SCHOOL_SESSION_KEY,
} from '../src/lib/systemAdminSchoolSession.ts';

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

function memorySessionStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
}

test('system_admin target persists across remounts in the same browser session', () => {
  const storage = memorySessionStorage();
  const firstMount = createSystemAdminSchoolSessionStore(storage);
  firstMount.setSchoolId(27);

  const nextMount = createSystemAdminSchoolSessionStore(storage);
  assert.equal(nextMount.getSnapshot(), 27);
  assert.equal(storage.getItem(SYSTEM_ADMIN_SCHOOL_SESSION_KEY), '27');
});

test('fresh system_admin sessions do not auto-select a school', () => {
  const store = createSystemAdminSchoolSessionStore(memorySessionStorage());
  assert.equal(store.getSnapshot(), null);
  const implementation = source('src/lib/systemAdminSchoolSession.ts');
  assert.match(implementation, /window\.sessionStorage/);
  assert.doesNotMatch(implementation, /localStorage/);
});

test('invalid or inactive persisted schools are cleared after active-school validation', () => {
  for (const storedValue of ['not-a-school', '19']) {
    const storage = memorySessionStorage({ [SYSTEM_ADMIN_SCHOOL_SESSION_KEY]: storedValue });
    const store = createSystemAdminSchoolSessionStore(storage);
    store.validateActiveSchools([27, 31]);
    assert.equal(store.getSnapshot(), null);
    assert.equal(storage.getItem(SYSTEM_ADMIN_SCHOOL_SESSION_KEY), null);
  }
});

test('tenant-bound users ignore a persisted system_admin target', () => {
  const storage = memorySessionStorage({ [SYSTEM_ADMIN_SCHOOL_SESSION_KEY]: '27' });
  const store = createSystemAdminSchoolSessionStore(storage);
  assert.equal(store.getSnapshot(), 27);
  assert.equal(resolveTenantSchoolId('school_owner', 9, store.getSnapshot()), 9);
  assert.equal(resolveTenantSchoolId('registrar', 9, store.getSnapshot()), 9);
});

test('school request generations prevent a stale school-A response replacing school-B state', () => {
  const requests = createRequestGeneration();
  const schoolARequest = requests.capture();
  requests.invalidate();
  const schoolBRequest = requests.capture();
  let state = [];

  if (schoolBRequest()) state = ['school-b'];
  if (schoolARequest()) state = ['school-a'];

  assert.deepEqual(state, ['school-b']);
});

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

test('school-dependent pages guard async loads and reset actionable school state', () => {
  const guardedPages = [
    'src/modules/students/StudentsPage.tsx',
    'src/modules/subjects/SubjectsPage.tsx',
    'src/modules/studentSubjects/StudentSubjectsPage.tsx',
    'src/modules/grades/GradesPage.tsx',
    'src/modules/resultCards/ResultCardsPage.tsx',
    'src/modules/fees/FeesPage.tsx',
    'src/modules/treasury/TreasuryPage.tsx',
    'src/modules/employees/EmployeesPage.tsx',
    'src/modules/officialBooks/OfficialBooksPage.tsx',
    'src/modules/settings/SettingsPage.tsx',
    'src/modules/analytics/AnalyticsPage.tsx',
    'src/modules/printRecords/PrintRecordsPage.tsx',
    'src/modules/importExport/ImportExportPage.tsx',
  ];
  for (const page of guardedPages) {
    const text = source(page);
    assert.match(text, /useSchoolRequestGuard/, `${page} must reject stale school responses`);
    assert.match(text, /captureSchoolRequest\(\)/, `${page} must capture request identity`);
    assert.match(text, /isCurrent(?:[A-Z]\w*)?\(\)/, `${page} must check request identity`);
  }

  const students = source('src/modules/students/StudentsPage.tsx');
  assert.match(students, /setStudents\(\[\]\)/);
  assert.match(students, /setModalOpen\(false\)/);
  const subjects = source('src/modules/subjects/SubjectsPage.tsx');
  assert.match(subjects, /setSubjects\(\[\]\)/);
  assert.match(subjects, /setModalOpen\(false\)/);
  const employees = source('src/modules/employees/EmployeesPage.tsx');
  assert.match(employees, /setEmployees\(\[\]\)/);
  assert.match(employees, /setEditEmployee\(null\)/);
  const officialBooks = source('src/modules/officialBooks/OfficialBooksPage.tsx');
  assert.match(officialBooks, /setPreviewBook\(null\)/);
  assert.match(officialBooks, /setGenerated\(null\)/);

  const resetExpectations = new Map([
    ['src/modules/classes/ClassesPage.tsx', [/setClassModal\(false\)/, /setSectionModal\(false\)/]],
    ['src/modules/studentSubjects/StudentSubjectsPage.tsx', [/setSelectedIds\(\[\]\)/, /setConfirmBulkOpen\(false\)/]],
    ['src/modules/grades/GradesPage.tsx', [/setSelectedStudentId\(''\)/, /setShowConfirm\(false\)/]],
    ['src/modules/resultCards/ResultCardsPage.tsx', [/setSelectedStudentId\(''\)/, /setResult\(null\)/]],
    ['src/modules/fees/FeesPage.tsx', [/setSelectedPayments\(\[\]\)/, /setEditingFee\(null\)/]],
    ['src/modules/treasury/TreasuryPage.tsx', [/setTransactions\(\[\]\)/, /setClosings\(\[\]\)/]],
    ['src/modules/settings/SettingsPage.tsx', [/setLoadedSchoolId\(null\)/, /setActiveTab\('profile'\)/]],
    ['src/modules/analytics/AnalyticsPage.tsx', [/setStudentSummaryData\(null\)/, /setStudents\(\[\]\)/]],
    ['src/modules/printRecords/PrintRecordsPage.tsx', [/setRecords\(\[\]\)/, /setFilterType\('all'\)/]],
    ['src/modules/importExport/ImportExportPage.tsx', [/setSelectedClassId\(null\)/, /setPreview\(null\)/]],
  ]);
  for (const [page, patterns] of resetExpectations) {
    const text = source(page);
    for (const pattern of patterns) assert.match(text, pattern, `${page} must reset school-dependent state`);
  }
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
