export const SYSTEM_ADMIN_SCHOOL_SESSION_KEY = 'smart-school:system-admin-target-school';

export interface SessionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SystemAdminSchoolSessionStore {
  getSnapshot: () => number | null;
  setSchoolId: (schoolId: number | null) => void;
  validateActiveSchools: (activeSchoolIds: readonly number[]) => void;
  subscribe: (listener: () => void) => () => void;
}

function normalizeSchoolId(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function readStoredSchoolId(storage: SessionStorageLike | null): number | null {
  if (!storage) return null;
  try {
    const stored = storage.getItem(SYSTEM_ADMIN_SCHOOL_SESSION_KEY);
    if (stored == null) return null;
    const schoolId = normalizeSchoolId(stored);
    if (schoolId == null) storage.removeItem(SYSTEM_ADMIN_SCHOOL_SESSION_KEY);
    return schoolId;
  } catch {
    return null;
  }
}

export function createSystemAdminSchoolSessionStore(
  storage: SessionStorageLike | null,
): SystemAdminSchoolSessionStore {
  let schoolId = readStoredSchoolId(storage);
  const listeners = new Set<() => void>();

  const setSchoolId = (nextSchoolId: number | null) => {
    const normalized = normalizeSchoolId(nextSchoolId);
    if (normalized === schoolId) return;
    schoolId = normalized;
    if (storage) {
      try {
        if (schoolId == null) storage.removeItem(SYSTEM_ADMIN_SCHOOL_SESSION_KEY);
        else storage.setItem(SYSTEM_ADMIN_SCHOOL_SESSION_KEY, String(schoolId));
      } catch {
        // In-memory synchronization still works when sessionStorage is unavailable.
      }
    }
    listeners.forEach((listener) => listener());
  };

  return {
    getSnapshot: () => schoolId,
    setSchoolId,
    validateActiveSchools: (activeSchoolIds) => {
      if (schoolId != null && !activeSchoolIds.includes(schoolId)) setSchoolId(null);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function getBrowserSessionStorage(): SessionStorageLike | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export const systemAdminSchoolSessionStore = createSystemAdminSchoolSessionStore(getBrowserSessionStorage());
