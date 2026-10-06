import { fetchApi } from './api';
import type { StaffDossierData, StaffDossierResponse } from './staffDossier';
export function getStaffDossier(employeeId: number, schoolId: number) {
  return fetchApi<StaffDossierResponse>(`/api/employees/${employeeId}/dossier?school_id=${schoolId}`);
}
export function saveStaffDossier(employeeId: number, schoolId: number, version: number, data: StaffDossierData) {
  return fetchApi<StaffDossierResponse>(`/api/employees/${employeeId}/dossier`, { method: 'PUT', body: JSON.stringify({ school_id: schoolId, version, data }) });
}
