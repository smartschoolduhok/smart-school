import { fetchApi } from './api';
import type { EmployeeProfile, SalaryReceiptsResponse, StaffRegisterResponse } from '../types/employees';

export interface EmployeeProfileScope { school_id: number; academic_year_id?: number | null; }
export interface StaffRegisterFilters { q?: string; role?: string; status?: 'active' | 'archived' | 'all'; }
export interface SalaryReceiptFilters { month: number; year: number; status?: 'unpaid' | 'paid' | 'cancelled' | 'all'; }
export interface EmployeePhotoState { has_photo: boolean; photo_updated_at: number | null; photo_url?: string | null; }

export function getEmployeeProfile(id: number | string, scope: EmployeeProfileScope) {
  const params = new URLSearchParams({ school_id: String(scope.school_id) });
  if (scope.academic_year_id != null) params.set('academic_year_id', String(scope.academic_year_id));
  return fetchApi<EmployeeProfile>(`/api/employees/${encodeURIComponent(String(id))}/profile?${params}`);
}

export function getStaffRegister(schoolId: number, filters: StaffRegisterFilters = {}) {
  const params = new URLSearchParams({ school_id: String(schoolId), status: filters.status || 'active' });
  if (filters.q) params.set('q', filters.q);
  if (filters.role) params.set('role', filters.role);
  return fetchApi<StaffRegisterResponse>(`/api/staff-register?${params}`);
}

export function getSalaryReceipts(schoolId: number, filters: SalaryReceiptFilters) {
  const params = new URLSearchParams({ school_id: String(schoolId), month: String(filters.month), year: String(filters.year), status: filters.status || 'unpaid' });
  return fetchApi<SalaryReceiptsResponse>(`/api/salary-receipts?${params}`);
}

export function getEmployeePhotoUrl(id: number | string, schoolId: number, version?: number | null) {
  const params = new URLSearchParams({ school_id: String(schoolId) });
  if (version != null) params.set('v', String(version));
  return `/api/employees/${encodeURIComponent(String(id))}/photo?${params}`;
}

export function uploadEmployeePhoto(id: number | string, schoolId: number, file: File) {
  return fetchApi<EmployeePhotoState>(getEmployeePhotoUrl(id, schoolId), {
    method: 'POST', headers: { 'Content-Type': file.type }, body: file,
  });
}

export function deleteEmployeePhoto(id: number | string, schoolId: number) {
  return fetchApi<EmployeePhotoState>(getEmployeePhotoUrl(id, schoolId), { method: 'DELETE' });
}

export async function getEmployeePhoto(id: number | string, schoolId: number): Promise<{ data?: Blob; error?: string }> {
  try {
    const response = await fetch(getEmployeePhotoUrl(id, schoolId), { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      return { error: body.error || 'تعذر تحميل صورة الموظف' };
    }
    return { data: await response.blob() };
  } catch {
    return { error: 'تعذر الاتصال لتحميل صورة الموظف' };
  }
}
