import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const testDir = dirname(fileURLToPath(import.meta.url));
const rootDir = join(testDir, '..');
const pageSource = readFileSync(join(rootDir, 'src', 'modules', 'timetable', 'TimetablePage.tsx'), 'utf8');
const availabilitySource = readFileSync(join(rootDir, 'src', 'modules', 'timetable', 'TeacherAvailabilityTab.tsx'), 'utf8');
const gridSource = readFileSync(join(rootDir, 'src', 'modules', 'timetable', 'TimetableGridTab.tsx'), 'utf8');
const timetableSource = readFileSync(join(rootDir, 'src', 'lib', 'timetable.ts'), 'utf8');
const apiSource = readFileSync(join(rootDir, 'src', 'lib', 'api.ts'), 'utf8');
const appSource = readFileSync(join(rootDir, 'src', 'App.tsx'), 'utf8');
const sidebarSource = readFileSync(join(rootDir, 'src', 'components', 'Sidebar.tsx'), 'utf8');

test('timetable module is Arabic RTL and exposes the weekly grid with all foundation tabs', () => {
  assert.match(pageSource, /dir="rtl"/);
  for (const label of ['الجدول الدراسي', 'الجدول الأسبوعي', 'إعداد الأسبوع', 'نصاب المواد والمدرسين', 'توفر المدرسين والقيود', 'التحقق من الجاهزية']) {
    assert.ok(pageSource.includes(label), label);
  }
});

test('weekly grid exposes explicit class/section flow, breaks and missing-teacher demand', () => {
  assert.match(gridSource, /dir="rtl"/);
  for (const label of ['اختر الصف', 'اختر الشعبة', 'جدولة حصة', 'استراحة', 'بدون مدرس', 'المطلوب', 'المجدول', 'المتبقي', 'تنبيه تفضيل', 'تعارض صلب']) {
    assert.ok(gridSource.includes(label), label);
  }
  assert.match(gridSource, /slot\.slot_type === 'break'/);
  assert.match(gridSource, /entry\.hard_conflicts\.length > 0/);
  assert.match(gridSource, /entry\.warnings\.length > 0/);
  assert.doesNotMatch(gridSource, /draggable|onDragStart|onDrop/);
});

test('each day cell renders its own slot identity without a representative-row substitution', () => {
  assert.match(gridSource, /function SlotIdentity/);
  assert.match(gridSource, /\{slot\.label\}/);
  assert.match(gridSource, /\{slot\.start_time\}–\{slot\.end_time\}/);
  assert.ok((gridSource.match(/<SlotIdentity slot=\{slot\} \/>/g) || []).length >= 2);
  assert.doesNotMatch(gridSource, /representative/);
});

test('hard conflicts and preference warnings remain visually and semantically separate', () => {
  assert.match(gridSource, /border-red-300 bg-red-50/);
  assert.match(gridSource, /function HardConflictNotice/);
  assert.match(gridSource, /conflicts\.map\(\(conflict\)/);
  assert.match(gridSource, /border-amber-200 bg-amber-50/);
  assert.match(gridSource, /entry\.warnings\.map\(\(warning\)/);
  assert.match(gridSource, /setMoveDialog\(\{ entry \}\)/);
  assert.match(gridSource, /removeEntry\(entry\)/);
});

test('historical invalid placements render in a dedicated repair section without becoming schedule targets', () => {
  for (const label of ['حصص تحتاج إصلاح', 'لا تُحتسب ضمن الحصص المجدولة الصحيحة', 'نقل إلى فترة فعالة']) {
    assert.ok(gridSource.includes(label), label);
  }
  assert.match(timetableSource, /historical_entries: TimetableHistoricalGridEntry\[\]/);
  assert.match(gridSource, /grid\.historical_entries\.map/);
  assert.match(gridSource, /entry\.slot\.start_time.*entry\.slot\.end_time/);
  const historicalSection = gridSource.slice(gridSource.indexOf('grid.historical_entries.length'), gridSource.indexOf('{scheduleDialog && grid'));
  assert.match(historicalSection, /setMoveDialog\(\{ entry \}\)/);
  assert.match(historicalSection, /removeEntry\(entry\)/);
  assert.doesNotMatch(historicalSection, /setScheduleDialog/);
});

test('grid progress distinguishes total, valid, invalid and remaining placements', () => {
  for (const field of ['total_placements', 'scheduled_periods', 'invalid_placements', 'remaining_periods']) {
    assert.ok(timetableSource.includes(field), field);
    assert.ok(gridSource.includes(`load.${field}`), field);
  }
  assert.ok(gridSource.includes('المجدول الصحيح'));
});

test('weekly grid uses explicit move/delete controls and server APIs', () => {
  assert.match(gridSource, /moveTimetableEntry/);
  assert.match(gridSource, /deleteTimetableEntry/);
  assert.match(gridSource, /window\.confirm/);
  assert.match(apiSource, /\/api\/timetable\/grid/);
  assert.match(apiSource, /\/api\/timetable\/entries/);
});

test('weekly grid ignores stale school, year, class and section responses', () => {
  assert.match(gridSource, /requestGenerationRef\.current \+= 1/);
  assert.match(gridSource, /requestGeneration !== requestGenerationRef\.current/);
  assert.match(gridSource, /mutationScopeIsCurrent\(expectedScope, expectedGeneration\)/);
  assert.match(gridSource, /requestGenerationRef\.current === expectedGeneration/);
  for (const reset of [/setGrid\(null\)/, /setScheduleDialog\(null\)/, /setMoveDialog\(null\)/, /setSelectedSectionId\(null\)/]) assert.match(gridSource, reset);
  const classChange = gridSource.slice(gridSource.indexOf('function changeClass'), gridSource.indexOf('function changeSection'));
  const sectionChange = gridSource.slice(gridSource.indexOf('function changeSection'), gridSource.indexOf('function mutationScopeIsCurrent'));
  assert.match(classChange, /setSaving\(false\)/);
  assert.match(sectionChange, /setSaving\(false\)/);
});

test('inactive historical loads remain visible for repair but are never new schedule choices', () => {
  assert.match(gridSource, /load\.status === 'active'/);
  assert.match(gridSource, /const schedulableLoads/);
  const scheduleDialog = gridSource.slice(gridSource.indexOf('{scheduleDialog && grid'));
  assert.match(scheduleDialog, /schedulableLoads\.map/);
  assert.doesNotMatch(scheduleDialog, /grid\.loads\.map/);
});

test('readiness presents scheduled, remaining and hard-conflict totals separately', () => {
  for (const field of ['schedule_ready', 'total_scheduled_periods', 'total_unscheduled_periods', 'hard_constraint_violation_count']) {
    assert.ok(pageSource.includes(field), field);
  }
});

test('teacher availability UI exposes hard, soft, bulk-day, reset and constraint controls', () => {
  for (const label of [
    'متاح',
    'غير متاح',
    'مفضل',
    'يفضل تجنبه',
    'جعل اليوم متاحاً',
    'جعل اليوم غير متاح',
    'إعادة ضبط التوفر',
    'الحد الأقصى للحصص يومياً',
    'الحد الأقصى للحصص المتتالية',
    'الحد الأقصى لأيام العمل أسبوعياً',
    'يفضل تجميع الحصص',
  ]) assert.ok(availabilitySource.includes(label), label);
  assert.match(availabilitySource, /slot\.slot_type === 'break'/);
  assert.match(availabilitySource, /استراحة — غير قابلة للتعديل/);
  assert.match(availabilitySource, /السعة القصوى بعد القيود/);
  assert.match(availabilitySource, /ممكن.*غير ممكن/s);
});

test('teacher availability requests are protected across school, year and teacher changes', () => {
  assert.match(availabilitySource, /requestGenerationRef\.current \+= 1/);
  assert.match(availabilitySource, /requestGeneration !== requestGenerationRef\.current/);
  assert.match(availabilitySource, /currentScopeRef\.current\.selectedTeacherId === expectedTeacherId/);
  assert.match(availabilitySource, /setSelectedTeacherId\(null\)/);
  assert.match(availabilitySource, /setMatrix\(null\)/);
  assert.match(availabilitySource, /scopeIsCurrent\(requestSchoolId, requestYearId, requestTeacherId\)/);
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
  assert.match(pageSource, /employee\.role === 'teacher'/);
  assert.doesNotMatch(pageSource, /employee_type/);
});

test('route and sidebar share academic-management policy', () => {
  assert.match(appSource, /path="\/timetable"[\s\S]*?allowedRoles=\{ACADEMIC_MANAGEMENT_ROLES\}/);
  assert.match(sidebarSource, /label: 'الجدول الدراسي'[\s\S]*?allowedRoles: ACADEMIC_MANAGEMENT_ROLES/);
});
