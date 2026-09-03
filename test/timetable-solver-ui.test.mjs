import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const testDir = dirname(fileURLToPath(import.meta.url));
const rootDir = join(testDir, '..');
const componentSource = readFileSync(join(rootDir, 'src', 'modules', 'timetable', 'AutomaticTimetableTab.tsx'), 'utf8');
const pageSource = readFileSync(join(rootDir, 'src', 'modules', 'timetable', 'TimetablePage.tsx'), 'utf8');
const apiSource = readFileSync(join(rootDir, 'src', 'lib', 'api.ts'), 'utf8');
const solverSource = readFileSync(join(rootDir, 'src', 'lib', 'timetableSolver.ts'), 'utf8');

test('Timetable page exposes the automatic generation tab and button', () => {
  assert.match(pageSource, /\['automatic', 'التوليد التلقائي', Sparkles\]/);
  assert.match(pageSource, /<AutomaticTimetableTab/);
  assert.match(componentSource, /إنشاء جدول تلقائي/);
});

test('proposal is explicitly labelled as an unapproved preview that does not mutate current timetable', () => {
  assert.match(componentSource, /معاينة — غير معتمدة/);
  assert.match(componentSource, /هذا اقتراح جديد ولن يغيّر الجدول الحالي حتى يتم اعتماده/);
  for (const mutation of ['createTimetableEntry', 'moveTimetableEntry', 'deleteTimetableEntry']) {
    assert.doesNotMatch(componentSource, new RegExp(mutation));
  }
  assert.match(apiSource, /previewAutomaticTimetable[\s\S]*\/api\/timetable\/solver\/preview/);
});

test('automatic proposal protects against stale school, year, and data-version responses', () => {
  assert.match(componentSource, /useSchoolRequestGuard\(schoolId\)/);
  assert.match(componentSource, /requestGenerationRef/);
  assert.match(componentSource, /generation !== requestGenerationRef\.current/);
  assert.match(componentSource, /scopeRef\.current\.schoolId !== expectedScope\.schoolId/);
  assert.match(componentSource, /scopeRef\.current\.academicYearId !== expectedScope\.academicYearId/);
  assert.match(componentSource, /scopeRef\.current\.dataVersion !== expectedScope\.dataVersion/);
  assert.match(componentSource, /\[academicYearId, dataVersion, schoolId\]/);
  assert.match(componentSource, /setResult\(null\)/);
});

test('proposal uses the Master Timetable visual concepts including placements, breaks and logical subject colors', () => {
  assert.match(componentSource, /timetablePlacementKey/);
  assert.match(componentSource, /timetableSubjectColorForSubject\(schoolId, entry\.subject_name\)/);
  assert.match(componentSource, /slot\.slot_type === 'break'/);
  assert.match(componentSource, /overflow-x-auto/);
});

test('missing teachers and unresolved demand are visible', () => {
  assert.match(componentSource, /بدون مدرس/);
  assert.match(componentSource, /حصص لم يتمكن النظام من جدولتها/);
  assert.match(solverSource, /reason_codes: codes/);
  assert.match(componentSource, /item\.reasons/);
});

test('quality score, penalties, readiness and solver bounds are presented without a fabricated query metric', () => {
  assert.match(componentSource, /درجة الجودة المقارنة/);
  assert.match(componentSource, /result\.scoring\.penalties/);
  assert.match(componentSource, /ملخص الجاهزية قبل التوليد/);
  assert.match(componentSource, /result\.statistics\.attempts/);
  assert.match(componentSource, /result\.statistics\.backtracks/);
  assert.doesNotMatch(componentSource, /source_query_count|استعلامات المصدر/);
  assert.doesNotMatch(solverSource, /source_query_count|sourceQueryCount/);
});
