import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACADEMIC_ACCESS_ROLES,
  ACADEMIC_MANAGEMENT_ROLES,
  EMPLOYEE_ACCESS_ROLES,
  EMPLOYEE_MANAGEMENT_ROLES,
  EMPLOYEE_SALARY_ROLES,
  FEE_MANAGEMENT_ROLES,
  FINANCE_ACCESS_ROLES,
  GRADE_MANAGEMENT_ROLES,
  IMPORT_EXPORT_ROLES,
  SCHOOL_MANAGEMENT_ROLES,
  USER_DIRECTORY_ROLES,
  hasRole,
} from '../src/lib/rbac.ts';

const schoolManagers = ['system_admin', 'school_owner', 'principal', 'vice_principal'];

test('school_owner has the same school-management entry points as school leadership', () => {
  for (const role of schoolManagers) {
    assert.equal(hasRole(role, SCHOOL_MANAGEMENT_ROLES), true);
    assert.equal(hasRole(role, ACADEMIC_MANAGEMENT_ROLES), true);
    assert.equal(hasRole(role, IMPORT_EXPORT_ROLES), true);
  }
});

test('academic structure management excludes teachers and accountants', () => {
  assert.equal(hasRole('teacher', ACADEMIC_ACCESS_ROLES), true);
  assert.equal(hasRole('teacher', ACADEMIC_MANAGEMENT_ROLES), false);
  assert.equal(hasRole('accountant', ACADEMIC_MANAGEMENT_ROLES), false);
});

test('grade entry permits academic staff but not accountants', () => {
  assert.equal(hasRole('school_owner', GRADE_MANAGEMENT_ROLES), true);
  assert.equal(hasRole('teacher', GRADE_MANAGEMENT_ROLES), true);
  assert.equal(hasRole('registrar', GRADE_MANAGEMENT_ROLES), true);
  assert.equal(hasRole('accountant', GRADE_MANAGEMENT_ROLES), false);
});

test('finance access permits accountants without granting academic management', () => {
  assert.equal(hasRole('accountant', FINANCE_ACCESS_ROLES), true);
  assert.equal(hasRole('accountant', ACADEMIC_MANAGEMENT_ROLES), false);
});

test('accountant can access employee salary workflows', () => {
  assert.equal(hasRole('accountant', EMPLOYEE_ACCESS_ROLES), true);
  assert.equal(hasRole('accountant', EMPLOYEE_SALARY_ROLES), true);
});

test('accountant cannot manage employee records', () => {
  assert.equal(hasRole('accountant', EMPLOYEE_MANAGEMENT_ROLES), false);
  for (const role of schoolManagers) {
    assert.equal(hasRole(role, EMPLOYEE_MANAGEMENT_ROLES), true);
  }
});

test('registrar fee policy matches the finance UI and server policy', () => {
  assert.deepEqual(FEE_MANAGEMENT_ROLES, FINANCE_ACCESS_ROLES);
  assert.equal(hasRole('accountant', FEE_MANAGEMENT_ROLES), true);
  assert.equal(hasRole('registrar', FEE_MANAGEMENT_ROLES), false);
});

test('import/export page is available to the four approved management roles', () => {
  assert.deepEqual(IMPORT_EXPORT_ROLES, schoolManagers);
  assert.equal(hasRole('registrar', IMPORT_EXPORT_ROLES), false);
});

test('user directory remains read-only for the intended administrative roles', () => {
  assert.equal(hasRole('system_admin', USER_DIRECTORY_ROLES), true);
  assert.equal(hasRole('school_owner', USER_DIRECTORY_ROLES), true);
  assert.equal(hasRole('registrar', USER_DIRECTORY_ROLES), true);
  assert.equal(hasRole('principal', USER_DIRECTORY_ROLES), false);
  assert.equal(hasRole('teacher', USER_DIRECTORY_ROLES), false);
});
