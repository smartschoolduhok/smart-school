import type { AuthUser } from '../types';

export const AUTH_TOKEN_KEY = 'smart_school_token';
export const AUTH_USER_KEY = 'smart_school_user';
export const AUTH_LEGACY_KEY = 'smart_school_auth';
export const AUTH_STORAGE_CLEARED_EVENT = 'smart-school-auth-storage-cleared';

function removeAuthKeys(storage: Storage) {
  storage.removeItem(AUTH_TOKEN_KEY);
  storage.removeItem(AUTH_USER_KEY);
  storage.removeItem(AUTH_LEGACY_KEY);
}

export function getStoredAuthToken(): string | null {
  return localStorage.getItem(AUTH_TOKEN_KEY) || sessionStorage.getItem(AUTH_TOKEN_KEY);
}

export function getStoredAuthUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(AUTH_USER_KEY) || sessionStorage.getItem(AUTH_USER_KEY);
    return raw ? JSON.parse(raw) as AuthUser : null;
  } catch {
    return null;
  }
}

export function getCurrentAuthStorage(): Storage | null {
  if (localStorage.getItem(AUTH_TOKEN_KEY)) return localStorage;
  if (sessionStorage.getItem(AUTH_TOKEN_KEY)) return sessionStorage;
  return null;
}

export function storeAuthentication(token: string, user: AuthUser, rememberMe: boolean) {
  removeAuthKeys(localStorage);
  removeAuthKeys(sessionStorage);
  const storage = rememberMe ? localStorage : sessionStorage;
  storage.setItem(AUTH_TOKEN_KEY, token);
  storage.setItem(AUTH_USER_KEY, JSON.stringify(user));
}

export function updateStoredAuthUser(user: AuthUser) {
  getCurrentAuthStorage()?.setItem(AUTH_USER_KEY, JSON.stringify(user));
}

export function clearAuthentication() {
  removeAuthKeys(localStorage);
  removeAuthKeys(sessionStorage);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(AUTH_STORAGE_CLEARED_EVENT));
  }
}
