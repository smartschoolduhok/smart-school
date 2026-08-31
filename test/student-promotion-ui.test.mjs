import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  buildStudentPromotionRequest,
  isPromotionPreviewCurrent,
  isTargetSectionSelectionReady,
  promotionSelectionFingerprint,
} from '../src/lib/studentPromotionUi.ts';
import {
  buildBulkPromotionRequest,
  bulkPromotionSelectionFingerprint,
  isBulkPromotionPreviewCurrent,
} from '../src/lib/studentBulkPromotionUi.ts';

const testDir = dirname(fileURLToPath(import.meta.url));
const rootDir = join(testDir, '..');
const source = (path) => readFileSync(join(rootDir, path), 'utf8');
const pageSource = source('src/modules/studentPromotion/StudentPromotionPage.tsx');
const appSource = source('src/App.tsx');
const sidebarSource = source('src/components/Sidebar.tsx');
const profileSource = source('src/modules/students/StudentProfilePage.tsx');
const bulkPageSource = source('src/modules/studentPromotion/BulkStudentPromotionPanel.tsx');

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

test('target section readiness fails closed on loading errors and requires a section when active options exist', () => {
  const base = {
    action: 'promoted',
    targetClassId: 4,
    targetSectionId: null,
    sectionsLoading: false,
    sectionsError: '',
    activeSectionCount: 1,
  };
  assert.equal(isTargetSectionSelectionReady(base), false);
  assert.equal(isTargetSectionSelectionReady({ ...base, targetSectionId: 6 }), true);
  assert.equal(isTargetSectionSelectionReady({ ...base, sectionsLoading: true }), false);
  assert.equal(isTargetSectionSelectionReady({ ...base, sectionsError: 'تعذر تحميل الشعب' }), false);
});

test('a successful empty active-section response permits preview without a target section', () => {
  assert.equal(isTargetSectionSelectionReady({
    action: 'repeated',
    targetClassId: 4,
    targetSectionId: null,
    sectionsLoading: false,
    sectionsError: '',
    activeSectionCount: 0,
  }), true);
});

test('promotion page uses explicit tenant selection, clears school-dependent state, and guards stale responses', () => {
  assert.match(pageSource, /<SystemAdminSchoolSelector \{\.\.\.schoolScope\} \/>/);
  assert.match(pageSource, /if \(schoolId == null\)[\s\S]*لا يمكن معاينة أو تنفيذ الترفيع/);
  assert.match(pageSource, /useSchoolRequestGuard\(schoolId\)/);
  assert.match(pageSource, /if \(!isCurrentRequest\(\)\) return/);
  assert.match(pageSource, /sectionRequestIdRef\.current/);
  assert.match(pageSource, /requestId !== sectionRequestIdRef\.current/);
  assert.match(pageSource, /setSectionsError\(`تعذر تحميل شعب الصف المستهدف: \$\{response\.error\}`\)/);
  assert.match(pageSource, /sectionsError !== ''/);
  assert.match(pageSource, /setStudentId\(null\)[\s\S]*setAction\(null\)[\s\S]*setTargetAcademicYearId\(null\)[\s\S]*setTargetClassId\(null\)[\s\S]*setTargetSectionId\(null\)/);
  assert.match(pageSource, /setPreview\(null\)[\s\S]*setPreviewFingerprint\(null\)/);
  assert.doesNotMatch(pageSource, /school_id\s*[:=]\s*1|schoolId\s*\?\?\s*1|schoolId\s*\|\|\s*1/);
});

test('execute stays disabled until a current preview and selection changes invalidate it', () => {
  assert.match(pageSource, /const previewCurrent = preview != null[\s\S]*&& sectionSelectionReady[\s\S]*&& isPromotionPreviewCurrent/);
  assert.match(pageSource, /disabled=\{!previewCurrent \|\| executing\}/);
  assert.match(pageSource, /useEffect\(\(\) => \{[\s\S]*setPreview\(null\)[\s\S]*setConfirmOpen\(false\)[\s\S]*\}, \[selectionFingerprint\]\)/);
  assert.match(pageSource, /currentFingerprintRef\.current !== requestedFingerprint/);
  assert.match(pageSource, /previewStudentPromotion\(payload\)/);
  assert.match(pageSource, /promoteStudent\(payload\)/);
});

test('confirmation text distinguishes preserved historical placement from finalized source lifecycle', () => {
  assert.match(pageSource, /لن يُحذف تسجيل السنة الحالية ولن يتغير صفه أو شعبته التاريخية/);
  assert.match(pageSource, /سيُقفل تسجيل المصدر وفق القرار، ويُنشأ تسجيل السنة المستهدفة عند الحاجة/);
  assert.doesNotMatch(pageSource, /لن يُعدّل التسجيل التاريخي/);
});

test('academic-year values use an explicit LTR bidi isolate throughout the promotion UI', () => {
  assert.match(pageSource, /function AcademicYearValue[\s\S]*<bdi dir="ltr"[^>]*>\{value\}<\/bdi>/);
  assert.match(pageSource, /ValueCard label="السنة الحالية"[^>]*valueDirection="ltr"/);
  assert.match(pageSource, /ValueCard label="سنة المصدر"[^>]*valueDirection="ltr"/);
  assert.match(pageSource, /ValueCard label="السنة المستهدفة"[^>]*valueDirection="ltr"/);
  assert.match(pageSource, /<AcademicYearValue value=\{preview\.source\.academic_year_name\} \/>/);
  assert.match(pageSource, /<AcademicYearValue value=\{preview\.target\.academic_year_name\} \/>/);
  assert.match(pageSource, /<select dir="ltr" value=\{sourceAcademicYearId/);
  assert.match(pageSource, /<select dir="ltr" value=\{targetAcademicYearId/);
  assert.doesNotMatch(pageSource, /academic_year_name\.(?:split|reverse)|(?:split|reverse)\([^)]*academic_year_name/);
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

function bulkSelection(overrides = {}) {
  return {
    schoolId: 2,
    sourceAcademicYearId: 3,
    sourceClassId: 3,
    sourceSectionId: 3,
    targetAcademicYearId: 4,
    rows: [
      { sourceEnrollmentId: 28, action: 'promoted', targetClassId: 4, targetSectionId: 6 },
      { sourceEnrollmentId: 29, action: 'graduated', targetClassId: null, targetSectionId: null },
    ],
    ...overrides,
  };
}

test('bulk payload has one explicit target year and keeps per-student decisions and placement overrides', () => {
  assert.deepEqual(buildBulkPromotionRequest(bulkSelection()), {
    school_id: 2,
    source_academic_year_id: 3,
    source_class_id: 3,
    source_section_id: 3,
    target_academic_year_id: 4,
    rows: [
      { source_enrollment_id: 28, action: 'promoted', target_class_id: 4, target_section_id: 6 },
      { source_enrollment_id: 29, action: 'graduated' },
    ],
  });
  assert.equal(buildBulkPromotionRequest(bulkSelection({ targetAcademicYearId: null })), null);
});

test('bulk preview fingerprint is invalidated by source, target, or any row decision change', () => {
  const selection = bulkSelection();
  const fingerprint = bulkPromotionSelectionFingerprint(selection);
  assert.equal(isBulkPromotionPreviewCurrent(fingerprint, selection), true);
  for (const changed of [
    { schoolId: 1 },
    { sourceAcademicYearId: 2 },
    { sourceClassId: 9 },
    { sourceSectionId: null },
    { targetAcademicYearId: 5 },
    { rows: [{ ...selection.rows[0], action: 'repeated' }, selection.rows[1]] },
    { rows: [{ ...selection.rows[0], targetClassId: 10 }, selection.rows[1]] },
  ]) {
    assert.equal(isBulkPromotionPreviewCurrent(fingerprint, bulkSelection(changed)), false);
  }
});

test('bulk UI provides explicit source cohort, common year, row decisions, preview, and atomic confirmation', () => {
  assert.match(pageSource, /ترفيع فردي/);
  assert.match(pageSource, /ترفيع جماعي/);
  assert.match(pageSource, /<BulkStudentPromotionPanel/);
  for (const text of [
    'أ) تحديد مجموعة المصدر',
    'الصف المصدر',
    'الشعبة المصدر (اختياري)',
    'السنة المستهدفة',
    'تعيين الكل مترفعين',
    'تعيين الكل معيدين',
    'مسح القرارات',
    'بحث بالاسم أو الرقم',
    'معاينة إلزامية',
    'تأكيد تنفيذ الترفيع الجماعي',
  ]) {
    assert.match(bulkPageSource, new RegExp(text.replace(/[()]/g, '\\$&')));
  }
  assert.match(bulkPageSource, /option value="promoted">مترفع/);
  assert.match(bulkPageSource, /option value="repeated">معيد/);
  assert.match(bulkPageSource, /option value="graduated">متخرج/);
  assert.match(bulkPageSource, /option value="skipped">تخطي/);
  assert.match(bulkPageSource, /لن تُحفظ أي كتابة جزئية/);
});

test('bulk UI fails closed for limits and stale school or selection responses', () => {
  assert.match(bulkPageSource, /MAX_BULK_PROMOTION_ROWS/);
  assert.match(bulkPageSource, /الحد الآمن للعملية الواحدة/);
  assert.match(bulkPageSource, /sectionRequestIdRef\.current/);
  assert.match(bulkPageSource, /requestId !== sectionRequestIdRef\.current/);
  assert.match(bulkPageSource, /currentFingerprintRef\.current !== requestedFingerprint/);
  assert.match(bulkPageSource, /disabled=\{!canPreview \|\| previewing\}/);
  assert.match(bulkPageSource, /disabled=\{!canExecute \|\| executing\}/);
  assert.match(bulkPageSource, /setPreview\(null\)[\s\S]*setPreviewFingerprint\(null\)[\s\S]*\}, \[fingerprint\]\)/);
  assert.match(bulkPageSource, /setDecisions\(cohort\.map[\s\S]*\}, \[cohort\]\)/);
  assert.match(bulkPageSource, /setSourceClassId[\s\S]*setSourceSectionId\(null\)/);
  assert.match(bulkPageSource, /current_enrollment_status === 'active'/);
  assert.match(bulkPageSource, /current_promotion_status === 'pending'/);
});

test('bulk UI preserves RTL while isolating academic years and student numbers as LTR', () => {
  assert.match(pageSource, /<div className="space-y-6" dir="rtl">/);
  assert.match(bulkPageSource, /<bdi dir="ltr" className="inline-block isolate">\{value\}<\/bdi>/);
  assert.match(bulkPageSource, /<bdi dir="ltr" className="text-xs text-gray-500">\{row\.studentNumber\}<\/bdi>/);
  assert.doesNotMatch(bulkPageSource, /(?:split|reverse)\([^)]*(?:year|studentNumber)/);
});
