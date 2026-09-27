// Browser credentials live only in the server's HttpOnly cookie.
// The CSRF value cannot authenticate a request by itself.
export const AUTH_STORAGE_CLEARED_EVENT = 'smart-school-auth-storage-cleared';
let csrfToken: string | null = null;

export function discardLegacyAuthentication(): void {
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    try {
      const storage = window[name];
      for (const key of ['smart_school_token', 'smart_school_user', 'smart_school_auth']) storage.removeItem(key);
    } catch { /* Cookies remain usable when Web Storage is disabled. */ }
  }
}

export function setSessionCsrfToken(value: unknown): void {
  csrfToken = typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : null;
}
export function getSessionCsrfToken(): string | null { return csrfToken; }
export function clearAuthentication(): void {
  csrfToken = null;
  discardLegacyAuthentication();
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(AUTH_STORAGE_CLEARED_EVENT));
}
