import type { RoleKey } from '../types';

function normalizeSchoolId(value: number | null | undefined): number | null {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : null;
}

export function resolveTenantSchoolId(
  roleKey: RoleKey | undefined,
  authenticatedSchoolId: number | null | undefined,
  selectedSchoolId: number | null | undefined,
): number | null {
  if (roleKey === 'system_admin') {
    return normalizeSchoolId(selectedSchoolId);
  }

  return normalizeSchoolId(authenticatedSchoolId);
}

export function resolveRequiredWriteSchoolId(
  roleKey: RoleKey | undefined,
  authenticatedSchoolId: number | null | undefined,
  requestedSchoolId: number | null | undefined,
): { ok: true; schoolId: number } | { ok: false; status: 400 | 403 } {
  const authenticated = normalizeSchoolId(authenticatedSchoolId);
  const requested = normalizeSchoolId(requestedSchoolId);

  if (roleKey === 'system_admin') {
    return requested == null
      ? { ok: false, status: 400 }
      : { ok: true, schoolId: requested };
  }

  if (authenticated == null) {
    return { ok: false, status: 403 };
  }

  if (requested != null && requested !== authenticated) {
    return { ok: false, status: 403 };
  }

  return { ok: true, schoolId: authenticated };
}
