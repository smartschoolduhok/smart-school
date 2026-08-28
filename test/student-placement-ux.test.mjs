import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  FINALIZED_STUDENT_PLACEMENT_MESSAGE,
  isStudentPlacementFinalized,
} from '../src/lib/studentPlacementUx.ts';

const rootDir = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const studentsPage = readFileSync(join(rootDir, 'src', 'modules', 'students', 'StudentsPage.tsx'), 'utf8');
const workerSource = readFileSync(join(rootDir, 'src', 'worker.ts'), 'utf8');

test('active pending enrollment keeps Student class and section placement editable', () => {
  assert.equal(isStudentPlacementFinalized('active', 'pending'), false);
  assert.equal((studentsPage.match(/disabled=\{placementFinalized\}/g) || []).length, 2);
});

test('promoted, graduated and repeated finalized enrollments lock Student placement', () => {
  assert.equal(isStudentPlacementFinalized('completed', 'promoted'), true);
  assert.equal(isStudentPlacementFinalized('completed', 'graduated'), true);
  assert.equal(isStudentPlacementFinalized('completed', 'repeated'), true);
  assert.equal(isStudentPlacementFinalized('active', 'promoted'), true);
});

test('student without a current enrollment keeps the existing placement behavior', () => {
  assert.equal(isStudentPlacementFinalized(null, null), false);
  assert.equal(isStudentPlacementFinalized(undefined, undefined), false);
});

test('finalized placement explanation is explicit and rendered near the selectors', () => {
  assert.equal(
    FINALIZED_STUDENT_PLACEMENT_MESSAGE,
    'تم إغلاق تسجيل هذه السنة الدراسية بعد الترفيع/الإعادة/التخرج، لذلك لا يمكن تعديل الصف أو الشعبة من صفحة الطالب. لتصحيح قرار الانتقال يجب استخدام إجراء مخصص لإدارة الترفيع.',
  );
  assert.match(studentsPage, /modalMode === 'edit' && placementFinalized/);
  assert.match(studentsPage, /FINALIZED_STUDENT_PLACEMENT_MESSAGE/);
});

test('placement lock is limited to class and section while identity fields stay editable', () => {
  assert.equal((studentsPage.match(/disabled=\{placementFinalized\}/g) || []).length, 2);
  for (const field of ['student_number', 'full_name', 'phone', 'guardian_name', 'guardian_phone', 'address']) {
    const fieldControl = new RegExp(`value=\\{form\\.${field}\\}[\\s\\S]{0,220}?className=`);
    assert.match(studentsPage, fieldControl);
  }
});

test('specific updateStudent backend errors remain visible without closing the modal', () => {
  assert.match(studentsPage, /const res = await updateStudent\([\s\S]*?if \(res\.error\) setFormError\(res\.error\);[\s\S]*?else \{ setModalOpen\(false\); loadData\(\); \}/);
  assert.match(studentsPage, /role="alert"/);
  assert.match(studentsPage, /aria-live="assertive"/);
  assert.match(studentsPage, /\{formError\}/);
  assert.match(workerSource, /FINALIZED_ENROLLMENT_PLACEMENT_ERROR[\s\S]*?409/);
});

test('normal active pending placement save still calls updateStudent with class and section', () => {
  assert.match(studentsPage, /class_id: form\.class_id \? Number\(form\.class_id\) : null/);
  assert.match(studentsPage, /section_id: form\.section_id \? Number\(form\.section_id\) : null/);
  assert.match(studentsPage, /await updateStudent\(editingId, \{ \.\.\.payload, status: 'active' \}\)/);
});

test('Student UX patch does not replace backend enrollment lifecycle protection', () => {
  assert.match(workerSource, /buildStudentPlacementUpdatePlan/);
  assert.match(workerSource, /placementPlan\.code === 'finalized_enrollment'/);
});
