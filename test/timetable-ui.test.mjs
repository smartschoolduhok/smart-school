import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const testDir = dirname(fileURLToPath(import.meta.url));
const rootDir = join(testDir, '..');
const pageSource = readFileSync(join(rootDir, 'src', 'modules', 'timetable', 'TimetablePage.tsx'), 'utf8');
const appSource = readFileSync(join(rootDir, 'src', 'App.tsx'), 'utf8');
const sidebarSource = readFileSync(join(rootDir, 'src', 'components', 'Sidebar.tsx'), 'utf8');

test('timetable module is Arabic RTL and exposes the three foundation tabs', () => {
  assert.match(pageSource, /dir="rtl"/);
  for (const label of ['الجدول الدراسي', 'إعداد الأسبوع', 'نصاب المواد والمدرسين', 'التحقق من الجاهزية']) {
    assert.ok(pageSource.includes(label), label);
  }
});

test('system admin uses the shared explicit tenant-school selector with no school fallback', () => {
  assert.match(pageSource, /useTenantSchool\(\)/);
  assert.match(pageSource, /<SystemAdminSchoolSelector \{\.\.\.schoolScope\} \/>/);
  assert.match(pageSource, /schoolId == null/);
  assert.doesNotMatch(pageSource, /school(?:_id|Id)\s*(?:\?\?|\|\|)\s*1/);
});

test('academic year is isolated for BiDi and defaults only to the active year', () => {
  assert.match(pageSource, /<bdi dir="ltr"/);
  assert.match(pageSource, /\[unicode-bidi:isolate\]/);
  assert.match(pageSource, /find\(\(year\) => Number\(year\.is_active\) === 1\)\?\.id \?\? null/);
  assert.doesNotMatch(pageSource, /scopedYears\[0\]/);
});

test('school/year changes clear dependent state and stale responses are rejected', () => {
  assert.match(pageSource, /requestGenerationRef\.current \+= 1/);
  assert.match(pageSource, /requestGeneration !== requestGenerationRef\.current \|\| !isCurrentSchool\(\)/);
  for (const reset of ['setDays\(\[\]\)', 'setSlots\(\[\]\)', 'setLoads\(\[\]\)', 'setReadiness\(null\)', 'setSelectedClassId\(null\)', 'setSelectedSectionId\(null\)', 'setSlotForm\(null\)']) {
    assert.ok(pageSource.includes(reset), reset);
  }
  assert.match(pageSource, /currentScopeRef\.current\.schoolId === expectedSchoolId/);
  assert.ok((pageSource.match(/scopeIsCurrent\(requestSchoolId, requestAcademicYearId\)/g) || []).length >= 5);
});

test('week, load and readiness operations reload all summaries after mutation', () => {
  assert.match(pageSource, /getTimetableDays\(schoolId, academicYearId\)/);
  assert.match(pageSource, /getTimetableReadiness\(schoolId, academicYearId\)/);
  const reloadCalls = pageSource.match(/await reloadYearData\(\)/g) || [];
  assert.ok(reloadCalls.length >= 5);
  assert.match(pageSource, /employee\.role === 'teacher' \|\| employee\.employee_type === 'teacher'/);
});

test('route and sidebar share academic-management policy', () => {
  assert.match(appSource, /path="\/timetable"[\s\S]*?allowedRoles=\{ACADEMIC_MANAGEMENT_ROLES\}/);
  assert.match(sidebarSource, /label: 'الجدول الدراسي'[\s\S]*?allowedRoles: ACADEMIC_MANAGEMENT_ROLES/);
});
