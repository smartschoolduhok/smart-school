import { fetchApi } from './api';
import type { StudentStudyStatus, StudentStudyStatusWrite, StudentStudyStatusList } from './studentStudyStatus';

export interface StudentStudyScope { school_id: number; academic_year_id: number; }
const query = (scope: StudentStudyScope) => new URLSearchParams({ school_id: String(scope.school_id), academic_year_id: String(scope.academic_year_id) });
export function getStudentStudyStatus(studentId: number, scope: StudentStudyScope) {
  return fetchApi<StudentStudyStatus>(`/api/students/${studentId}/study-status?${query(scope)}`);
}
export function saveStudentStudyStatus(studentId: number, input: StudentStudyStatusWrite & { school_id: number }) {
  return fetchApi<StudentStudyStatus>(`/api/students/${studentId}/study-status`, { method: 'PUT', body: JSON.stringify(input) });
}
export function getStudentStudyRoster(scope: StudentStudyScope) {
  return fetchApi<StudentStudyStatusList>(`/api/student-study-status?${query(scope)}`);
}
