import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(rootDir, ...parts), 'utf8');
const automaticSource = read('src', 'modules', 'timetable', 'AutomaticTimetableTab.tsx');
const gridSource = read('src', 'modules', 'timetable', 'TimetableGridTab.tsx');
const masterSource = read('src', 'modules', 'timetable', 'MasterTimetableTab.tsx');
const versionsSource = read('src', 'modules', 'timetable', 'TimetableVersionsTab.tsx');
const pageSource = read('src', 'modules', 'timetable', 'TimetablePage.tsx');
const apiSource = read('src', 'lib', 'api.ts');

test('automatic workflow exposes proposal locks and re-solves only unlocked lessons', () => {
  for (const label of ['تثبيت الحصة', 'إلغاء التثبيت', 'إعادة توليد غير المثبت']) assert.ok(automaticSource.includes(label), label);
  assert.match(automaticSource, /fixed_entries: result\.entries\.filter\(\(entry\) => entry\.is_locked === 1\)/);
});

test('automatic workflow supports re-optimizing around persisted official locks', () => {
  assert.match(automaticSource, /إعادة تحسين الجدول الحالي/);
  assert.match(automaticSource, /use_current_locked_entries: true/);
});

test('adoption remains preview-first and requires a strong explicit confirmation', () => {
  assert.match(automaticSource, /معاينة الاعتماد/);
  assert.match(automaticSource, /سيصبح هذا المقترح هو الجدول الرسمي للسنة الدراسية/);
  assert.match(automaticSource, /سيتم حفظ نسخة من الجدول الحالي قبل الاستبدال/);
  assert.match(apiSource, /confirm_apply: true/);
});

test('current versus proposal multiset comparison is visible before apply', () => {
  for (const label of ['مقارنة مع الجدول الحالي', 'بلا تغيير', 'منقولة', 'مضافة', 'محذوفة', 'مثبتة محفوظة']) assert.ok(automaticSource.includes(label), label);
});

test('successful adoption clears proposal state and reloads authoritative timetable data', () => {
  assert.match(automaticSource, /تم اعتماد الجدول بنجاح/);
  assert.match(automaticSource, /setResult\(null\)/);
  assert.match(automaticSource, /setAdoptionPreview\(null\)/);
  assert.match(automaticSource, /await onAdopted\(\)/);
  assert.match(pageSource, /onAdopted=\{reloadYearData\}/);
});

test('stale automatic responses cannot repaint a changed school, year or revision generation', () => {
  assert.match(automaticSource, /requestGenerationRef/);
  assert.match(automaticSource, /generation !== requestGenerationRef\.current/);
  assert.match(automaticSource, /scopeRef\.current\.schoolId !== expectedScope\.schoolId/);
  assert.match(automaticSource, /scopeRef\.current\.academicYearId !== expectedScope\.academicYearId/);
  assert.match(automaticSource, /setAdoptionPreview\(null\)/);
});

test('weekly grid displays persisted locks and confirms locked move or delete', () => {
  assert.match(gridSource, /entry\.is_locked === 1/);
  assert.match(gridSource, /setTimetableEntryLock/);
  assert.match(gridSource, /confirm_unlock_locked_entry/);
  assert.match(gridSource, /هذه الحصة مثبتة/);
});

test('master timetable indicates locks on screen without overcrowding print', () => {
  assert.match(masterSource, /entry\.is_locked === 1/);
  assert.match(masterSource, /مثبتة/);
  assert.match(masterSource, /no-print/);
});

test('compact version-history tab exposes safe view and restore preview actions', () => {
  assert.match(pageSource, /\['versions', 'إصدارات الجدول', History\]/);
  assert.match(pageSource, /<TimetableVersionsTab/);
  for (const label of ['إصدارات الجدول', 'عرض', 'معاينة الاستعادة', 'استعادة هذا الإصدار']) assert.ok(versionsSource.includes(label), label);
});

test('version restore uses stale request protection, preview and confirmation before mutation', () => {
  assert.match(versionsSource, /useSchoolRequestGuard\(schoolId\)/);
  assert.match(versionsSource, /generationRef/);
  assert.match(versionsSource, /previewTimetableVersionRestore/);
  assert.match(versionsSource, /window\.confirm/);
  assert.match(versionsSource, /confirm_restore: true/);
  assert.match(pageSource, /onRestored=\{reloadYearData\}/);
});

test('restore preview separates structural blockers from current weekly-demand warnings', () => {
  assert.match(versionsSource, /تغطية الأنصبة الحالية/);
  assert.match(versionsSource, /restorePreview\.weekly_demand\.scheduled_periods/);
  assert.match(versionsSource, /restorePreview\.weekly_demand\.required_periods/);
  assert.match(versionsSource, /restorePreview\.warnings\.map/);
  assert.match(versionsSource, /restorePreview\.blockers\.map/);
});
