import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  buildStudentPromotionRequest,
  isPromotionPreviewCurrent,
  promotionSelectionFingerprint,
} from '../src/lib/studentPromotionUi.ts';

const testDir = dirname(fileURLToPath(import.meta.url));
const rootDir = join(testDir, '..');
const source = (path) => readFileSync(join(rootDir, path), 'utf8');
const pageSource = source('src/modules/studentPromotion/StudentPromotionPage.tsx');
const appSource = source('src/App.tsx');
const sidebarSource = source('src/components/Sidebar.tsx');
const profileSource = source('src/modules/students/StudentProfilePage.tsx');

function baseSelection(overrides = {}) {
  return {
    schoolId: 2,
    sourceEnrollmentId: 28,
    action: 'promoted',
    targetAcademicYearId: 4,
    targetClassId: 4,
    targetSectionId: 6,
    ...overrides,
  };
}

test('changing any promotion selection invalidates the successful preview fingerprint', () => {
  const selection = baseSelection();
  const fingerprint = promotionSelectionFingerprint(selection);
  assert.equal(isPromotionPreviewCurrent(fingerprint, selection), true);
  for (const changed of [
    { schoolId: 1 },
    { sourceEnrollmentId: 29 },
    { action: 'repeated' },
    { targetAcademicYearId: 5 },
    { targetClassId: 3 },
    { targetSectionId: 5 },
  ]) {
    assert.equal(isPromotionPreviewCurrent(fingerprint, baseSelection(changed)), false);
  }
  assert.equal(isPromotionPreviewCurrent(null, selection), false);
});

test('graduation payload omits every target placement field', () => {
  const request = buildStudentPromotionRequest(baseSelection({ action: 'graduated' }));
  assert.deepEqual(request, {
    school_id: 2,
    source_enrollment_id: 28,
    action: 'graduated',
  });
  assert.equal(Object.hasOwn(request, 'target_academic_year_id'), false);
  assert.equal(Object.hasOwn(request, 'target_class_id'), false);
  assert.equal(Object.hasOwn(request, 'target_section_id'), false);
});

test('promotion and repetition payloads require explicit year and class and preserve explicit section', () => {
  assert.equal(buildStudentPromotionRequest(baseSelection({ targetAcademicYearId: null })), null);
  assert.equal(buildStudentPromotionRequest(baseSelection({ targetClassId: null })), null);
  assert.deepEqual(buildStudentPromotionRequest(baseSelection({ action: 'repeated' })), {
    school_id: 2,
    source_enrollment_id: 28,
    action: 'repeated',
    target_academic_year_id: 4,
    target_class_id: 4,
    target_section_id: 6,
  });
});

test('promotion page uses explicit tenant selection, clears school-dependent state, and guards stale responses', () => {
  assert.match(pageSource, /<SystemAdminSchoolSelector \{\.\.\.schoolScope\} \/>/);
  assert.match(pageSource, /if \(schoolId == null\)[\s\S]*لا يمكن معاينة أو تنفيذ الترفيع/);
  assert.match(pageSource, /useSchoolRequestGuard\(schoolId\)/);
  assert.match(pageSource, /if \(!isCurrentRequest\(\)\) return/);
  assert.match(pageSource, /sectionRequestIdRef\.current/);
  assert.match(pageSource, /setStudentId\(null\)[\s\S]*setAction\(null\)[\s\S]*setTargetAcademicYearId\(null\)[\s\S]*setTargetClassId\(null\)[\s\S]*setTargetSectionId\(null\)/);
  assert.match(pageSource, /setPreview\(null\)[\s\S]*setPreviewFingerprint\(null\)/);
  assert.doesNotMatch(pageSource, /school_id\s*[:=]\s*1|schoolId\s*\?\?\s*1|schoolId\s*\|\|\s*1/);
});

test('execute stays disabled until a current preview and selection changes invalidate it', () => {
  assert.match(pageSource, /const previewCurrent = preview != null && isPromotionPreviewCurrent/);
  assert.match(pageSource, /disabled=\{!previewCurrent \|\| executing\}/);
  assert.match(pageSource, /useEffect\(\(\) => \{[\s\S]*setPreview\(null\)[\s\S]*setConfirmOpen\(false\)[\s\S]*\}, \[selectionFingerprint\]\)/);
  assert.match(pageSource, /currentFingerprintRef\.current !== requestedFingerprint/);
  assert.match(pageSource, /previewStudentPromotion\(payload\)/);
  assert.match(pageSource, /promoteStudent\(payload\)/);
});

test('route, sidebar, and Student Profile entry point use academic management RBAC', () => {
  assert.match(appSource, /path="\/student-promotion"[\s\S]*allowedRoles=\{ACADEMIC_MANAGEMENT_ROLES\}/);
  assert.match(sidebarSource, /label: 'ترفيع الطلاب'[\s\S]*allowedRoles: ACADEMIC_MANAGEMENT_ROLES/);
  assert.match(profileSource, /canManagePromotion = hasRole\(user\?\.role_key, ACADEMIC_MANAGEMENT_ROLES\)/);
  assert.match(profileSource, /navigate\(`\/student-promotion\?student_id=\$\{student\.id\}`\)/);
  assert.match(profileSource, />\s*إدارة الترفيع\s*<\/button>/);
});

test('the UI presents separate current, decision, target, preview, and execute steps in Arabic RTL', () => {
  assert.match(pageSource, /dir="rtl"/);
  for (const heading of ['أ) الوضع الحالي', 'ب) القرار', 'ج) الوضع المستهدف', 'د) المعاينة', 'هـ) التنفيذ']) {
    assert.match(pageSource, new RegExp(heading.replace(/[()]/g, '\\$&')));
  }
  assert.match(pageSource, /معاينة الترفيع/);
  assert.match(pageSource, /تنفيذ الترفيع/);
  assert.match(pageSource, /تأكيد إعادة السنة/);
  assert.match(pageSource, /تأكيد التخرج/);
});
