import { clearAuthentication, getSessionCsrfToken } from './authStorage';
import type { SchoolRegisterEntry, SchoolRegisterHistory } from './schoolRegisters';

export interface RegisterScope { school_id: number; academic_year_id: number; register_key: string; }
export interface RegisterFilters { search?: string; status?: 'active' | 'voided' | 'all'; page?: number; page_size?: number; }
export interface RegisterList { entries: SchoolRegisterEntry[]; total: number; page?: number; page_size?: number; active_total?: number; voided_total?: number; }
export interface RegisterHistoryList { history: SchoolRegisterHistory[]; total: number; page?: number; page_size?: number; }
export interface RegisterWrite { entry_date: string; title: string; data: Record<string, unknown>; }
export interface RegisterResponse<T> { data?: T; error?: string; status?: number; code?: string; }

/** Same cookie/CSRF contract as the main client; errors stay in the form. */
async function request<T>(path: string, method = 'GET', input?: unknown): Promise<RegisterResponse<T>> {
  try {
    const headers = new Headers({ Accept: 'application/json', 'Content-Type': 'application/json' });
    const csrf = getSessionCsrfToken();
    if (method !== 'GET' && csrf) headers.set('X-CSRF-Token', csrf);
    const response = await fetch(path, { method, headers, credentials: 'same-origin', cache: 'no-store', ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
    const body = await response.json().catch(() => ({}));
    if (response.status === 401) clearAuthentication();
    if (response.status === 403 && body.code === 'password_change_required') window.location.href = '/change-password';
    if (!response.ok) return { error: body.error || 'تعذر إكمال الطلب. حاول مجددًا.', status: response.status, code: body.code };
    return { data: body.data ?? body };
  } catch { return { error: 'تعذر الاتصال بالخادم. تحقق من الاتصال ثم حاول مجددًا.' }; }
}

function query(scope: RegisterScope, filters: Record<string, unknown> = {}) {
  return new URLSearchParams(Object.entries({ ...scope, ...filters }).filter(([, value]) => value != null && value !== '').map(([key, value]) => [key, String(value)]));
}
export function getSchoolRegisterEntries(scope: RegisterScope, filters: RegisterFilters = {}) {
  return request<RegisterList>(`/api/school-registers?${query(scope, { ...filters })}`);
}
export function createSchoolRegisterEntry(scope: RegisterScope, input: RegisterWrite) {
  return request<SchoolRegisterEntry>('/api/school-registers', 'POST', { ...scope, ...input });
}
export function updateSchoolRegisterEntry(id: number, scope: RegisterScope, version: number, input: RegisterWrite) {
  return request<SchoolRegisterEntry>(`/api/school-registers/${id}`, 'PUT', { ...scope, version, ...input });
}
export function voidSchoolRegisterEntry(id: number, scope: RegisterScope, version: number, reason: string) {
  return request<SchoolRegisterEntry>(`/api/school-registers/${id}/void`, 'POST', { ...scope, version, reason });
}
export function getSchoolRegisterHistory(id: number, scope: RegisterScope, page = 1) {
  return request<RegisterHistoryList>(`/api/school-registers/${id}/history?${query(scope, { page, page_size: 20 })}`);
}
export function matchesRegisterScope(entry: SchoolRegisterEntry, scope: RegisterScope) {
  return entry.school_id === scope.school_id && entry.academic_year_id === scope.academic_year_id && entry.register_key === scope.register_key;
}
