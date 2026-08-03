import type { RoleKey } from '../types';

export const SYSTEM_ADMIN_ROLES: readonly RoleKey[] = ['system_admin'];

export const USER_DIRECTORY_ROLES: readonly RoleKey[] = [
  'system_admin',
  'school_owner',
  'registrar',
];

export const SCHOOL_MANAGEMENT_ROLES: readonly RoleKey[] = [
  'system_admin',
  'school_owner',
  'principal',
  'vice_principal',
];

export const ACADEMIC_ACCESS_ROLES: readonly RoleKey[] = [
  ...SCHOOL_MANAGEMENT_ROLES,
  'teacher',
  'registrar',
];

export const ACADEMIC_MANAGEMENT_ROLES: readonly RoleKey[] = [
  ...SCHOOL_MANAGEMENT_ROLES,
  'registrar',
];

// Teachers and registrars can enter grades, but cannot manage academic structure.
export const GRADE_MANAGEMENT_ROLES: readonly RoleKey[] = [
  ...SCHOOL_MANAGEMENT_ROLES,
  'teacher',
  'registrar',
];

export const FINANCE_ACCESS_ROLES: readonly RoleKey[] = [
  ...SCHOOL_MANAGEMENT_ROLES,
  'accountant',
];

export const ANALYTICS_ACCESS_ROLES: readonly RoleKey[] = [
  ...ACADEMIC_ACCESS_ROLES,
  'accountant',
];

export const EMPLOYEE_VIEW_ROLES: readonly RoleKey[] = [
  ...SCHOOL_MANAGEMENT_ROLES,
  'accountant',
];

export const OFFICIAL_BOOK_ACCESS_ROLES: readonly RoleKey[] = [
  ...SCHOOL_MANAGEMENT_ROLES,
  'registrar',
];

export const OFFICIAL_BOOK_VIEW_ROLES: readonly RoleKey[] = [
  ...OFFICIAL_BOOK_ACCESS_ROLES,
  'teacher',
];

export const IMPORT_EXPORT_ROLES: readonly RoleKey[] = SCHOOL_MANAGEMENT_ROLES;

export function hasRole(
  roleKey: RoleKey | null | undefined,
  allowedRoles: readonly RoleKey[],
): boolean {
  return roleKey != null && allowedRoles.includes(roleKey);
}
