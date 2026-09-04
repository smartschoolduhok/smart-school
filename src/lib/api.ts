// ===========================================
// API Client - JWT Bearer Token Authentication
// Connects React frontend to Hono backend
// Automatically injects Authorization: Bearer <token> header
// ===========================================

import type { AcademicYearRecord } from './academicYears';
import type { EffectiveStudentRecord, StudentEnrollmentHistoryRecord } from './studentEnrollments';
import type { StudentReligiousSubjectState } from './religiousSubjects';
import type {
  InvalidStudentPromotionPreviewData,
  StudentPromotionData,
  StudentPromotionPreviewData,
  StudentPromotionRequest,
} from './studentPromotion';
import type {
  BulkStudentPromotionExecutionData,
  BulkStudentPromotionPreviewData,
  BulkStudentPromotionRequest,
} from './studentBulkPromotion';
import type {
  TimetableDay,
  TimetableEntry,
  TimetableEntryNotice,
  TimetableGridData,
  TimetableMasterGridData,
  TimetableReadinessSummary,
  TimetableSlot,
  TimetableTeacherAvailabilityMatrix,
  TimetableTeacherAvailabilityOverride,
  TimetableTeacherAvailabilitySummary,
  TimetableTeacherConstraints,
  TimetableTeacherWorkload,
  TimetableTeachingLoad,
} from './timetable';
import type {
  TimetableAdoptionPreview,
  TimetableProposalPlacement,
  TimetableRestorePreview,
  TimetableScheduleVersion,
  TimetableScheduleVersionDetails,
  TimetableSolverProposalWithIntegrity,
} from './timetableAdoption';

const API_BASE = import.meta.env.PROD ? '' : '';

function getToken(): string | null {
  return localStorage.getItem('smart_school_token');
}

function clearAuthAndRedirect() {
  localStorage.removeItem('smart_school_token');
  localStorage.removeItem('smart_school_user');
  localStorage.removeItem('smart_school_auth');
  window.location.href = '/login';
}

function showError(message: string) {
  // Try to use a toast or alert - fallback to alert for now
  alert(message);
}

async function fetchApi<T>(path: string, options?: RequestInit): Promise<{ data?: T; meta?: any; error?: string; code?: string; status?: number }> {
  try {
    const token = getToken();
    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(`${API_BASE}${path}`, {
      headers,
      ...options,
    });

    if (res.status === 401) {
      clearAuthAndRedirect();
      showError('غير مسموح: يجب تسجيل الدخول أولاً');
      return { error: 'غير مسموح: يجب تسجيل الدخول أولاً' };
    }

    if (res.status === 403) {
      showError('غير مسموح: لا تملك صلاحية الوصول');
      return { error: 'غير مسموح: لا تملك صلاحية الوصول' };
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { data: body.data, error: body.error || `خطأ ${res.status}`, code: body.code, meta: body.meta, status: res.status };
    }

    const body = await res.json();
    return { data: body.data ?? body, meta: body.meta };
  } catch (err: any) {
    return { error: err.message || 'خطأ في الاتصال بالخادم' };
  }
}

// Dashboard
export function getDashboardStats() {
  return fetchApi<{ active_schools: number; active_users: number; total_users: number; current_academic_year: string; total_modules: number; core_modules: number }>('/api/dashboard/stats');
}

// ===========================================
// Schools
// ===========================================
export function getSchools() {
  return fetchApi<Array<Record<string, any>>>('/api/schools');
}

export function getSchool(id: number | string) {
  return fetchApi<Record<string, any>>(`/api/schools/${id}`);
}

export function createSchool(data: Record<string, any>) {
  return fetchApi<Record<string, any>>('/api/schools', { method: 'POST', body: JSON.stringify(data) });
}

export function updateSchool(id: number | string, data: Record<string, any>) {
  return fetchApi<Record<string, any>>(`/api/schools/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export function archiveSchool(id: number | string) {
  return fetchApi<Record<string, any>>(`/api/schools/${id}/archive`, { method: 'PUT', body: '{}' });
}

// ===========================================
// Users
// ===========================================
export function getUsers(schoolId?: number | null) {
  const qs = schoolId != null ? `?school_id=${schoolId}` : '';
  return fetchApi<Array<Record<string, any>>>(`/api/users${qs}`);
}

export function getUser(id: number | string) {
  return fetchApi<Record<string, any>>(`/api/users/${id}`);
}

export function createUser(data: Record<string, any>) {
  return fetchApi<Record<string, any>>('/api/users', { method: 'POST', body: JSON.stringify(data) });
}

export function updateUser(id: number | string, data: Record<string, any>) {
  return fetchApi<Record<string, any>>(`/api/users/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export function updateUserStatus(id: number | string, status: 'active' | 'inactive') {
  return fetchApi<Record<string, any>>(`/api/users/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) });
}

export function resetUserPassword(id: number | string, password: string) {
  return fetchApi<Record<string, any>>(`/api/users/${id}/reset-password`, { method: 'PUT', body: JSON.stringify({ password }) });
}

// ===========================================
// Roles
// ===========================================
export function getRoles() {
  return fetchApi<Array<Record<string, any>>>('/api/roles');
}

export function getRole(id: number | string) {
  return fetchApi<Record<string, any>>(`/api/roles/${id}`);
}

export function getRolePermissions() {
  return fetchApi<Array<Record<string, any>>>('/api/role-permissions');
}

// ===========================================
// Modules
// ===========================================
export function getModules() {
  return fetchApi<Array<Record<string, any>>>('/api/modules');
}

export function getSchoolModules(schoolId?: number | null) {
  const qs = schoolId != null ? `?school_id=${schoolId}` : '';
  return fetchApi<Array<Record<string, any>>>(`/api/school-modules${qs}`);
}

// ===========================================
// Academic Years
// ===========================================
export function getAcademicYears(schoolId?: number | null) {
  const qs = schoolId != null ? `?school_id=${schoolId}` : '';
  return fetchApi<AcademicYearRecord[]>(`/api/academic-years${qs}`);
}

export function createAcademicYear(data: {
  school_id: number;
  name: string;
  starts_at: string;
  ends_at: string;
  activate?: boolean;
}) {
  return fetchApi<AcademicYearRecord>('/api/academic-years', { method: 'POST', body: JSON.stringify(data) });
}

export function updateAcademicYear(id: number, data: {
  school_id: number;
  name: string;
  starts_at: string;
  ends_at: string;
}) {
  return fetchApi<AcademicYearRecord>(`/api/academic-years/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export function activateAcademicYear(id: number, schoolId: number) {
  return fetchApi<AcademicYearRecord>(`/api/academic-years/${id}/activate`, {
    method: 'PUT',
    body: JSON.stringify({ school_id: schoolId }),
  });
}

// ===========================================
// Timetable Foundation
// ===========================================
function timetableQuery(schoolId: number, academicYearId: number) {
  return new URLSearchParams({
    school_id: String(schoolId),
    academic_year_id: String(academicYearId),
  }).toString();
}

export function getTimetableDays(schoolId: number, academicYearId: number) {
  return fetchApi<TimetableDay[]>(`/api/timetable/days?${timetableQuery(schoolId, academicYearId)}`);
}

export function saveTimetableDay(data: {
  school_id: number;
  academic_year_id: number;
  day_of_week: number;
  is_active: 0 | 1;
  order_index: number;
}) {
  return fetchApi<TimetableDay>(`/api/timetable/days/${data.day_of_week}`, {
    method: 'PUT', body: JSON.stringify(data),
  });
}

export function getTimetableSlots(schoolId: number, academicYearId: number) {
  return fetchApi<TimetableSlot[]>(`/api/timetable/slots?${timetableQuery(schoolId, academicYearId)}`);
}

export function createTimetableSlot(data: Record<string, unknown>) {
  return fetchApi<TimetableSlot>('/api/timetable/slots', { method: 'POST', body: JSON.stringify(data) });
}

export function updateTimetableSlot(id: number, data: Record<string, unknown>) {
  return fetchApi<TimetableSlot>(`/api/timetable/slots/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export function deleteTimetableSlot(id: number, schoolId: number, academicYearId: number) {
  return fetchApi<{ id: number }>(`/api/timetable/slots/${id}`, {
    method: 'DELETE', body: JSON.stringify({ school_id: schoolId, academic_year_id: academicYearId }),
  });
}

export function getTimetableTeachingLoads(schoolId: number, academicYearId: number) {
  return fetchApi<TimetableTeachingLoad[]>(`/api/timetable/teaching-loads?${timetableQuery(schoolId, academicYearId)}`);
}

export function createTimetableTeachingLoad(data: Record<string, unknown>) {
  return fetchApi<TimetableTeachingLoad>('/api/timetable/teaching-loads', { method: 'POST', body: JSON.stringify(data) });
}

export function updateTimetableTeachingLoad(id: number, data: Record<string, unknown>) {
  return fetchApi<TimetableTeachingLoad>(`/api/timetable/teaching-loads/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export function deactivateTimetableTeachingLoad(id: number, schoolId: number, academicYearId: number) {
  return fetchApi<{ id: number; status: 'inactive' }>(`/api/timetable/teaching-loads/${id}`, {
    method: 'DELETE', body: JSON.stringify({ school_id: schoolId, academic_year_id: academicYearId }),
  });
}

export function getTimetableReadiness(schoolId: number, academicYearId: number) {
  return fetchApi<TimetableReadinessSummary>(`/api/timetable/readiness?${timetableQuery(schoolId, academicYearId)}`);
}

export function getTimetableTeacherWorkloads(schoolId: number, academicYearId: number) {
  return fetchApi<TimetableTeacherWorkload[]>(`/api/timetable/teacher-workloads?${timetableQuery(schoolId, academicYearId)}`);
}

export function getTimetableGrid(
  schoolId: number,
  academicYearId: number,
  classId: number,
  sectionId: number | null,
) {
  const query = new URLSearchParams({
    school_id: String(schoolId),
    academic_year_id: String(academicYearId),
    class_id: String(classId),
  });
  if (sectionId != null) query.set('section_id', String(sectionId));
  return fetchApi<TimetableGridData>(`/api/timetable/grid?${query.toString()}`);
}

export function getTimetableMasterGrid(schoolId: number, academicYearId: number) {
  return fetchApi<TimetableMasterGridData>(`/api/timetable/master-grid?${timetableQuery(schoolId, academicYearId)}`);
}

export function previewAutomaticTimetable(
  schoolId: number,
  academicYearId: number,
  options?: {
    fixed_entries?: Array<{ slot_id: number; teaching_load_id: number }>;
    use_current_locked_entries?: boolean;
  },
) {
  return fetchApi<TimetableSolverProposalWithIntegrity>('/api/timetable/solver/preview', {
    method: 'POST',
    body: JSON.stringify({ school_id: schoolId, academic_year_id: academicYearId, ...options }),
  });
}

function proposalEntries(entries: TimetableProposalPlacement[]) {
  return entries.map(({ slot_id, teaching_load_id, is_locked }) => ({ slot_id, teaching_load_id, is_locked }));
}

export function previewTimetableAdoption(data: {
  school_id: number;
  academic_year_id: number;
  proposal_revision: number;
  proposal_digest: string;
  entries: TimetableProposalPlacement[];
}) {
  return fetchApi<TimetableAdoptionPreview>('/api/timetable/solver/adoption-preview', {
    method: 'POST', body: JSON.stringify({ ...data, entries: proposalEntries(data.entries) }),
  });
}

export function applyTimetableProposal(data: {
  school_id: number;
  academic_year_id: number;
  expected_revision: number;
  proposal_digest: string;
  entries: TimetableProposalPlacement[];
  confirm_apply: true;
}) {
  return fetchApi<{
    applied: true;
    message: string;
    revision: number;
    previous_version: TimetableScheduleVersion;
    entry_count: number;
  }>('/api/timetable/solver/apply', {
    method: 'POST', body: JSON.stringify({ ...data, entries: proposalEntries(data.entries) }),
  });
}

export function getTimetableVersions(schoolId: number, academicYearId: number) {
  return fetchApi<TimetableScheduleVersion[]>(`/api/timetable/versions?${timetableQuery(schoolId, academicYearId)}`);
}

export function getTimetableVersion(versionId: number, schoolId: number, academicYearId: number) {
  return fetchApi<TimetableScheduleVersionDetails>(
    `/api/timetable/versions/${versionId}?${timetableQuery(schoolId, academicYearId)}`,
  );
}

export function previewTimetableVersionRestore(versionId: number, schoolId: number, academicYearId: number) {
  return fetchApi<TimetableRestorePreview>(`/api/timetable/versions/${versionId}/restore-preview`, {
    method: 'POST', body: JSON.stringify({ school_id: schoolId, academic_year_id: academicYearId }),
  });
}

export function restoreTimetableVersion(versionId: number, data: {
  school_id: number;
  academic_year_id: number;
  expected_revision: number;
  proposal_digest: string;
  confirm_restore: true;
}) {
  return fetchApi<{ restored: true; revision: number; previous_version: TimetableScheduleVersion }>(
    `/api/timetable/versions/${versionId}/restore`,
    { method: 'POST', body: JSON.stringify(data) },
  );
}

export function createTimetableEntry(data: {
  school_id: number;
  academic_year_id: number;
  slot_id: number;
  teaching_load_id: number;
}) {
  return fetchApi<TimetableEntry>('/api/timetable/entries', {
    method: 'POST', body: JSON.stringify(data),
  }) as Promise<{
    data?: TimetableEntry;
    meta?: { warnings?: TimetableEntryNotice[] };
    error?: string;
    code?: string;
    status?: number;
  }>;
}

export function moveTimetableEntry(id: number, data: {
  school_id: number;
  academic_year_id: number;
  slot_id: number;
  confirm_unlock_locked_entry?: true;
}) {
  return fetchApi<TimetableEntry>(`/api/timetable/entries/${id}`, {
    method: 'PUT', body: JSON.stringify(data),
  }) as Promise<{
    data?: TimetableEntry;
    meta?: { warnings?: TimetableEntryNotice[] };
    error?: string;
    code?: string;
    status?: number;
  }>;
}

export function deleteTimetableEntry(
  id: number,
  schoolId: number,
  academicYearId: number,
  confirmUnlockLockedEntry = false,
) {
  return fetchApi<{ id: number }>(`/api/timetable/entries/${id}`, {
    method: 'DELETE', body: JSON.stringify({
      school_id: schoolId,
      academic_year_id: academicYearId,
      ...(confirmUnlockLockedEntry ? { confirm_unlock_locked_entry: true } : {}),
    }),
  });
}

export function setTimetableEntryLock(id: number, data: {
  school_id: number;
  academic_year_id: number;
  is_locked: 0 | 1;
}) {
  return fetchApi<{ entry: TimetableEntry; revision: number }>(`/api/timetable/entries/${id}/lock`, {
    method: 'PUT', body: JSON.stringify(data),
  });
}

function teacherTimetableQuery(schoolId: number, academicYearId: number, employeeId: number) {
  return new URLSearchParams({
    school_id: String(schoolId),
    academic_year_id: String(academicYearId),
    employee_id: String(employeeId),
  }).toString();
}

export function getTeacherTimetableAvailability(schoolId: number, academicYearId: number, employeeId: number) {
  return fetchApi<TimetableTeacherAvailabilityMatrix>(
    `/api/timetable/teacher-availability?${teacherTimetableQuery(schoolId, academicYearId, employeeId)}`,
  );
}

export function saveTeacherTimetableAvailabilityOverride(data: {
  school_id: number;
  academic_year_id: number;
  employee_id: number;
  slot_id: number;
  status: 'unavailable' | 'preferred' | 'avoid';
}) {
  return fetchApi<TimetableTeacherAvailabilityOverride>(`/api/timetable/teacher-availability/${data.slot_id}`, {
    method: 'PUT', body: JSON.stringify(data),
  });
}

export function clearTeacherTimetableAvailabilityOverride(
  schoolId: number,
  academicYearId: number,
  employeeId: number,
  slotId: number,
) {
  return fetchApi<{ slot_id: number; status: 'available' }>(`/api/timetable/teacher-availability/${slotId}`, {
    method: 'DELETE',
    body: JSON.stringify({ school_id: schoolId, academic_year_id: academicYearId, employee_id: employeeId }),
  });
}

export function saveTeacherTimetableAvailabilityDay(data: {
  school_id: number;
  academic_year_id: number;
  employee_id: number;
  day_of_week: number;
  status: 'unavailable' | 'preferred' | 'avoid' | null;
}) {
  return fetchApi<TimetableTeacherAvailabilityMatrix>(`/api/timetable/teacher-availability/day/${data.day_of_week}`, {
    method: 'PUT', body: JSON.stringify(data),
  });
}

export function resetTeacherTimetableAvailability(schoolId: number, academicYearId: number, employeeId: number) {
  return fetchApi<{ employee_id: number; reset: true }>('/api/timetable/teacher-availability', {
    method: 'DELETE',
    body: JSON.stringify({ school_id: schoolId, academic_year_id: academicYearId, employee_id: employeeId }),
  });
}

export function getTeacherTimetableConstraints(schoolId: number, academicYearId: number, employeeId: number) {
  return fetchApi<TimetableTeacherConstraints>(
    `/api/timetable/teacher-constraints?${teacherTimetableQuery(schoolId, academicYearId, employeeId)}`,
  );
}

export function saveTeacherTimetableConstraints(data: Omit<TimetableTeacherConstraints, 'id'> & { id?: number | null }) {
  return fetchApi<TimetableTeacherConstraints>('/api/timetable/teacher-constraints', {
    method: 'PUT', body: JSON.stringify(data),
  });
}

export function getTeacherTimetableAvailabilitySummary(schoolId: number, academicYearId: number, employeeId: number) {
  return fetchApi<TimetableTeacherAvailabilitySummary>(
    `/api/timetable/teacher-availability-summary?${teacherTimetableQuery(schoolId, academicYearId, employeeId)}`,
  );
}

// ===========================================
// Classes
// ===========================================
export function getClasses(schoolId?: number | null) {
  const qs = schoolId != null ? `?school_id=${schoolId}` : '';
  return fetchApi<Array<Record<string, any>>>(`/api/classes${qs}`);
}

export function createClass(data: Record<string, any>) {
  return fetchApi<Record<string, any>>('/api/classes', { method: 'POST', body: JSON.stringify(data) });
}

export function updateClass(id: number | string, data: Record<string, any>) {
  return fetchApi<Record<string, any>>(`/api/classes/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export function archiveClass(id: number | string, schoolId: number) {
  return fetchApi<Record<string, any>>(`/api/classes/${id}/archive`, { method: 'PUT', body: JSON.stringify({ school_id: schoolId }) });
}

// ===========================================
// Sections
// ===========================================
export function getSections(schoolId?: number | null, classId?: number | null) {
  const params = new URLSearchParams();
  if (schoolId != null) params.append('school_id', String(schoolId));
  if (classId != null) params.append('class_id', String(classId));
  const qs = params.toString() ? `?${params.toString()}` : '';
  return fetchApi<Array<Record<string, any>>>(`/api/sections${qs}`);
}

export function createSection(data: Record<string, any>) {
  return fetchApi<Record<string, any>>('/api/sections', { method: 'POST', body: JSON.stringify(data) });
}

export function updateSection(id: number | string, data: Record<string, any>) {
  return fetchApi<Record<string, any>>(`/api/sections/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export function archiveSection(id: number | string, schoolId: number) {
  return fetchApi<Record<string, any>>(`/api/sections/${id}/archive`, { method: 'PUT', body: JSON.stringify({ school_id: schoolId }) });
}

// ===========================================
// Students
// ===========================================
export function getStudents(schoolId?: number | null, classId?: number | null, sectionId?: number | null) {
  const params = new URLSearchParams();
  if (schoolId != null) params.append('school_id', String(schoolId));
  if (classId != null) params.append('class_id', String(classId));
  if (sectionId != null) params.append('section_id', String(sectionId));
  const qs = params.toString() ? `?${params.toString()}` : '';
  return fetchApi<Array<Record<string, any>>>(`/api/students${qs}`);
}

export function getStudent(id: number | string) {
  return fetchApi<EffectiveStudentRecord>(`/api/students/${id}`);
}

export function getStudentEnrollments(studentId: number | string, schoolId: number) {
  const params = new URLSearchParams({ school_id: String(schoolId) });
  return fetchApi<StudentEnrollmentHistoryRecord[]>(`/api/students/${studentId}/enrollments?${params.toString()}`);
}

export function previewStudentPromotion(data: StudentPromotionRequest & { school_id: number }) {
  return fetchApi<StudentPromotionPreviewData | InvalidStudentPromotionPreviewData>('/api/student-enrollments/promotion/preview', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function promoteStudent(data: StudentPromotionRequest & { school_id: number }) {
  return fetchApi<StudentPromotionData>('/api/student-enrollments/promotion', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function previewBulkStudentPromotion(data: BulkStudentPromotionRequest & { school_id: number }) {
  return fetchApi<BulkStudentPromotionPreviewData>('/api/student-enrollments/promotion/bulk-preview', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function promoteStudentsBulk(data: BulkStudentPromotionRequest & { school_id: number }) {
  return fetchApi<BulkStudentPromotionExecutionData>('/api/student-enrollments/promotion/bulk', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function createStudent(data: Record<string, any>) {
  return fetchApi<Record<string, any>>('/api/students', { method: 'POST', body: JSON.stringify(data) });
}

export function updateStudent(id: number | string, data: Record<string, any>) {
  return fetchApi<Record<string, any>>(`/api/students/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export function archiveStudent(id: number | string, schoolId: number) {
  return fetchApi<Record<string, any>>(`/api/students/${id}/archive`, {
    method: 'PUT',
    body: JSON.stringify({ school_id: schoolId }),
  });
}

// ===========================================
// Subjects
// ===========================================
export function getSubjects(schoolId?: number | null, classId?: number | null, sectionId?: number | null) {
  const params = new URLSearchParams();
  if (schoolId != null) params.append('school_id', String(schoolId));
  if (classId != null) params.append('class_id', String(classId));
  if (sectionId != null) params.append('section_id', String(sectionId));
  const qs = params.toString() ? `?${params.toString()}` : '';
  return fetchApi<Array<Record<string, any>>>(`/api/subjects${qs}`);
}

export function createSubject(data: Record<string, any>) {
  return fetchApi<Record<string, any>>('/api/subjects', { method: 'POST', body: JSON.stringify(data) });
}

export function updateSubject(id: number | string, data: Record<string, any>) {
  return fetchApi<Record<string, any>>(`/api/subjects/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export function reorderSubjects(schoolId: number, classId: number, orderedSubjectIds: number[]) {
  return fetchApi<Array<Record<string, any>>>('/api/subjects/reorder', {
    method: 'PUT',
    body: JSON.stringify({
      school_id: schoolId,
      class_id: classId,
      ordered_subject_ids: orderedSubjectIds,
    }),
  });
}

export function archiveSubject(id: number | string, schoolId: number) {
  return fetchApi<Record<string, any>>(`/api/subjects/${id}/archive`, {
    method: 'PUT',
    body: JSON.stringify({ school_id: schoolId }),
  });
}

// ===========================================
// Student Subjects
// ===========================================
export function getStudentSubjects(schoolId?: number | null, studentId?: number | null, classId?: number | null, sectionId?: number | null, subjectId?: number | null, isActive?: boolean | null) {
  const params = new URLSearchParams();
  if (schoolId != null) params.append('school_id', String(schoolId));
  if (studentId != null) params.append('student_id', String(studentId));
  if (classId != null) params.append('class_id', String(classId));
  if (sectionId != null) params.append('section_id', String(sectionId));
  if (subjectId != null) params.append('subject_id', String(subjectId));
  if (isActive != null) params.append('is_active', isActive ? '1' : '0');
  const qs = params.toString() ? `?${params.toString()}` : '';
  return fetchApi<Array<Record<string, any>>>(`/api/student-subjects${qs}`);
}

export function getStudentActiveSubjects(studentId: number | string) {
  return fetchApi<Array<Record<string, any>>>(`/api/students/${studentId}/subjects`);
}

export function getStudentReligiousSubject(studentId: number | string, schoolId: number) {
  const params = new URLSearchParams({ school_id: String(schoolId) });
  return fetchApi<StudentReligiousSubjectState>(`/api/students/${studentId}/religious-subject?${params.toString()}`);
}

export function setStudentReligiousSubject(
  studentId: number | string,
  schoolId: number,
  subjectId: number | null,
  confirmExistingGrades = false,
) {
  return fetchApi<{ current_assignment: StudentReligiousSubjectState['current_assignment']; already_applied: boolean }>(
    `/api/students/${studentId}/religious-subject`,
    {
      method: 'PUT',
      body: JSON.stringify({
        school_id: schoolId,
        subject_id: subjectId,
        confirm_existing_grades: confirmExistingGrades,
      }),
    },
  );
}

export function assignSubjectsToClass(classId: number | string, subjectIds: number[], schoolId: number) {
  return fetchApi<Record<string, any>>('/api/student-subjects/assign-class', { method: 'POST', body: JSON.stringify({ school_id: schoolId, class_id: Number(classId), subject_ids: subjectIds }) });
}

export function assignSubjectsToSection(sectionId: number | string, subjectIds: number[], schoolId: number) {
  return fetchApi<Record<string, any>>('/api/student-subjects/assign-section', { method: 'POST', body: JSON.stringify({ school_id: schoolId, section_id: Number(sectionId), subject_ids: subjectIds }) });
}

export function assignSubjectsToStudents(studentIds: number[], subjectIds: number[], schoolId: number) {
  return fetchApi<Record<string, any>>('/api/student-subjects/assign-students', { method: 'POST', body: JSON.stringify({ school_id: schoolId, student_ids: studentIds, subject_ids: subjectIds }) });
}

export function assignSubjectToOne(studentId: number | string, subjectId: number | string, schoolId: number) {
  return fetchApi<Record<string, any>>('/api/student-subjects/assign-one', { method: 'POST', body: JSON.stringify({ school_id: schoolId, student_id: Number(studentId), subject_id: Number(subjectId) }) });
}

export function deactivateStudentSubject(id: number | string, schoolId: number) {
  return fetchApi<Record<string, any>>(`/api/student-subjects/${id}/deactivate`, { method: 'PUT', body: JSON.stringify({ school_id: schoolId }) });
}

export function reactivateStudentSubject(id: number | string, schoolId: number) {
  return fetchApi<Record<string, any>>(`/api/student-subjects/${id}/reactivate`, { method: 'PUT', body: JSON.stringify({ school_id: schoolId }) });
}

export function bulkDeactivateStudentSubject(ids: number[], schoolId: number) {
  return fetchApi<Record<string, any>>('/api/student-subjects/bulk-deactivate', { method: 'POST', body: JSON.stringify({ school_id: schoolId, ids }) });
}

// ===========================================
// Grades (Phase 4)
// ===========================================
export function getGrades(filters?: {
  school_id?: number | null;
  student_id?: number | null;
  class_id?: number | null;
  section_id?: number | null;
  subject_id?: number | null;
  is_active?: boolean | null;
}) {
  const params = new URLSearchParams();
  if (filters?.school_id != null) params.append('school_id', String(filters.school_id));
  if (filters?.student_id != null) params.append('student_id', String(filters.student_id));
  if (filters?.class_id != null) params.append('class_id', String(filters.class_id));
  if (filters?.section_id != null) params.append('section_id', String(filters.section_id));
  if (filters?.subject_id != null) params.append('subject_id', String(filters.subject_id));
  if (filters?.is_active != null) params.append('is_active', filters.is_active ? '1' : '0');
  const qs = params.toString() ? `?${params.toString()}` : '';
  return fetchApi<Array<Record<string, any>>>(`/api/grades${qs}`);
}

export function getStudentGrades(studentId: number | string) {
  return fetchApi<Record<string, any>>(`/api/students/${studentId}/grades`);
}

export function initializeStudentGrades(studentId: number | string, schoolId: number) {
  return fetchApi<Record<string, any>>(`/api/grades/initialize-student/${studentId}`, { method: 'POST', body: JSON.stringify({ school_id: schoolId }) });
}

export function initializeSectionGrades(data: { school_id: number; section_id: number; subject_ids: number[] }) {
  return fetchApi<Record<string, any>>('/api/grades/initialize-section', { method: 'POST', body: JSON.stringify(data) });
}

export function updateGrade(id: number | string, data: Record<string, any>, schoolId: number) {
  return fetchApi<Record<string, any>>(`/api/grades/${id}`, { method: 'PUT', body: JSON.stringify({ ...data, school_id: schoolId }) });
}

export function bulkUpdateGrades(entries: Array<Record<string, any>>, schoolId: number) {
  return fetchApi<Record<string, any>>('/api/grades/bulk-entry', { method: 'POST', body: JSON.stringify({ school_id: schoolId, entries }) });
}

export function getGradeHistory(id: number | string) {
  return fetchApi<Array<Record<string, any>>>(`/api/grades/${id}/history`);
}

export function getGradeSettings(schoolId?: number | null) {
  const qs = schoolId != null ? '?school_id=' + schoolId : '';
  return fetchApi<Record<string, any>>('/api/grade-settings' + qs);
}

export function updateGradeSettings(data: Record<string, any>, schoolId?: number | null) {
  const payload = schoolId != null ? { ...data, school_id: schoolId } : data;
  return fetchApi<Record<string, any>>('/api/grade-settings', { method: 'PUT', body: JSON.stringify(payload) });
}

// ===========================================
// Analytics (Phase 5)
// ===========================================
export function getAnalyticsOverview(filters?: { school_id?: number | null; class_id?: number | null; section_id?: number | null; subject_id?: number | null }) {
  const params = new URLSearchParams();
  if (filters?.school_id != null) params.append('school_id', String(filters.school_id));
  if (filters?.class_id != null) params.append('class_id', String(filters.class_id));
  if (filters?.section_id != null) params.append('section_id', String(filters.section_id));
  if (filters?.subject_id != null) params.append('subject_id', String(filters.subject_id));
  const qs = params.toString() ? `?${params.toString()}` : '';
  return fetchApi<Record<string, any>>(`/api/analytics/overview${qs}`);
}

export function getAnalyticsByClass(filters?: { school_id?: number | null; class_id?: number | null; section_id?: number | null; subject_id?: number | null }) {
  const params = new URLSearchParams();
  if (filters?.school_id != null) params.append('school_id', String(filters.school_id));
  if (filters?.class_id != null) params.append('class_id', String(filters.class_id));
  if (filters?.section_id != null) params.append('section_id', String(filters.section_id));
  if (filters?.subject_id != null) params.append('subject_id', String(filters.subject_id));
  const qs = params.toString() ? `?${params.toString()}` : '';
  return fetchApi<Array<Record<string, any>>>(`/api/analytics/by-class${qs}`);
}

export function getAnalyticsBySection(filters?: { school_id?: number | null; class_id?: number | null; section_id?: number | null; subject_id?: number | null }) {
  const params = new URLSearchParams();
  if (filters?.school_id != null) params.append('school_id', String(filters.school_id));
  if (filters?.class_id != null) params.append('class_id', String(filters.class_id));
  if (filters?.section_id != null) params.append('section_id', String(filters.section_id));
  if (filters?.subject_id != null) params.append('subject_id', String(filters.subject_id));
  const qs = params.toString() ? `?${params.toString()}` : '';
  return fetchApi<Array<Record<string, any>>>(`/api/analytics/by-section${qs}`);
}

export function getAnalyticsBySubject(filters?: { school_id?: number | null; class_id?: number | null; section_id?: number | null; subject_id?: number | null }) {
  const params = new URLSearchParams();
  if (filters?.school_id != null) params.append('school_id', String(filters.school_id));
  if (filters?.class_id != null) params.append('class_id', String(filters.class_id));
  if (filters?.section_id != null) params.append('section_id', String(filters.section_id));
  if (filters?.subject_id != null) params.append('subject_id', String(filters.subject_id));
  const qs = params.toString() ? `?${params.toString()}` : '';
  return fetchApi<Array<Record<string, any>>>(`/api/analytics/by-subject${qs}`);
}

export function getStudentsCloseToPassing(filters?: { school_id?: number | null; class_id?: number | null; section_id?: number | null; subject_id?: number | null }) {
  const params = new URLSearchParams();
  if (filters?.school_id != null) params.append('school_id', String(filters.school_id));
  if (filters?.class_id != null) params.append('class_id', String(filters.class_id));
  if (filters?.section_id != null) params.append('section_id', String(filters.section_id));
  if (filters?.subject_id != null) params.append('subject_id', String(filters.subject_id));
  const qs = params.toString() ? `?${params.toString()}` : '';
  return fetchApi<Array<Record<string, any>>>(`/api/analytics/students-close-to-passing${qs}`);
}

export function getStudentsCloseToExemption(filters?: { school_id?: number | null; class_id?: number | null; section_id?: number | null; subject_id?: number | null }) {
  const params = new URLSearchParams();
  if (filters?.school_id != null) params.append('school_id', String(filters.school_id));
  if (filters?.class_id != null) params.append('class_id', String(filters.class_id));
  if (filters?.section_id != null) params.append('section_id', String(filters.section_id));
  if (filters?.subject_id != null) params.append('subject_id', String(filters.subject_id));
  const qs = params.toString() ? `?${params.toString()}` : '';
  return fetchApi<Array<Record<string, any>>>(`/api/analytics/students-close-to-exemption${qs}`);
}

export function getExemptionBlockers(filters?: { school_id?: number | null; class_id?: number | null; section_id?: number | null }) {
  const params = new URLSearchParams();
  if (filters?.school_id != null) params.append('school_id', String(filters.school_id));
  if (filters?.class_id != null) params.append('class_id', String(filters.class_id));
  if (filters?.section_id != null) params.append('section_id', String(filters.section_id));
  const qs = params.toString() ? `?${params.toString()}` : '';
  return fetchApi<Array<Record<string, any>>>(`/api/analytics/exemption-blockers${qs}`);
}

export function getStudentSummary(studentId: number | string) {
  return fetchApi<Record<string, any>>(`/api/analytics/student-summary/${studentId}`);
}

// ===========================================
// Result Cards (Phase 6)
// ===========================================
export function getResultCards(filters?: {
  school_id?: number | null;
  class_id?: number | null;
  section_id?: number | null;
  student_id?: number | null;
  status?: string | null;
}) {
  const params = new URLSearchParams();
  if (filters?.school_id != null) params.append('school_id', String(filters.school_id));
  if (filters?.class_id != null) params.append('class_id', String(filters.class_id));
  if (filters?.section_id != null) params.append('section_id', String(filters.section_id));
  if (filters?.student_id != null) params.append('student_id', String(filters.student_id));
  if (filters?.status != null) params.append('status', filters.status);
  const qs = params.toString() ? `?${params.toString()}` : '';
  return fetchApi<Array<Record<string, any>>>(`/api/result-cards${qs}`);
}

export function getResultCard(id: number | string, schoolId?: number | null) {
  const qs = schoolId != null ? `?school_id=${schoolId}` : '';
  return fetchApi<Record<string, any>>(`/api/result-cards/${id}${qs}`);
}

export interface ResultCardIssueOptions {
  decision_note?: string | null;
  exam_round?: string;
}

export function previewStudentResultCard(
  studentId: number | string,
  schoolId: number,
  options: ResultCardIssueOptions = {},
) {
  return fetchApi<Record<string, any>>(`/api/result-cards/preview-student/${studentId}`, {
    method: 'POST',
    body: JSON.stringify({ school_id: schoolId, ...options }),
  });
}

export function generateStudentResultCard(
  studentId: number | string,
  schoolId: number,
  options: ResultCardIssueOptions = {},
) {
  return fetchApi<Record<string, any>>(`/api/result-cards/generate-student/${studentId}`, {
    method: 'POST',
    body: JSON.stringify({ school_id: schoolId, ...options }),
  });
}

export function generateSectionResultCards(data: {
  school_id: number;
  class_id: number;
  section_id: number;
  decision_note?: string | null;
  exam_round?: string;
}) {
  return fetchApi<Record<string, any>>('/api/result-cards/generate-section', { method: 'POST', body: JSON.stringify(data) });
}

export function markResultCardPrinted(id: number | string, schoolId: number) {
  return fetchApi<Record<string, any>>(`/api/result-cards/${id}/mark-printed`, { method: 'PUT', body: JSON.stringify({ school_id: schoolId }) });
}

export function cancelResultCard(id: number | string, schoolId: number) {
  return fetchApi<Record<string, any>>(`/api/result-cards/${id}/cancel`, { method: 'PUT', body: JSON.stringify({ school_id: schoolId }) });
}

export function verifyResultCard(token: string) {
  return fetchApi<Record<string, any>>(`/api/verify/result-card/${token}`);
}

// ===========================================
// Fees & Receipts (Phase 7)
// ===========================================
export function getStudentFees(filters?: {
  school_id?: number | null;
  student_id?: number | null;
  status?: string | null;
}) {
  const params = new URLSearchParams();
  if (filters?.school_id != null) params.append('school_id', String(filters.school_id));
  if (filters?.student_id != null) params.append('student_id', String(filters.student_id));
  if (filters?.status != null) params.append('status', filters.status);
  const qs = params.toString() ? `?${params.toString()}` : '';
  return fetchApi<Array<Record<string, any>>>(`/api/student-fees${qs}`);
}

export function createStudentFee(data: Record<string, any>) {
  return fetchApi<Record<string, any>>('/api/student-fees', { method: 'POST', body: JSON.stringify(data) });
}

export function updateStudentFee(id: number | string, data: Record<string, any>) {
  return fetchApi<Record<string, any>>(`/api/student-fees/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export function deleteStudentFee(id: number | string, schoolId: number) {
  return fetchApi<Record<string, any>>(`/api/student-fees/${id}`, { method: 'DELETE', body: JSON.stringify({ school_id: schoolId }) });
}

export function getFeePayments(filters?: {
  school_id?: number | null;
  student_id?: number | null;
  student_fee_id?: number | null;
}) {
  const params = new URLSearchParams();
  if (filters?.school_id != null) params.append('school_id', String(filters.school_id));
  if (filters?.student_id != null) params.append('student_id', String(filters.student_id));
  if (filters?.student_fee_id != null) params.append('student_fee_id', String(filters.student_fee_id));
  const qs = params.toString() ? `?${params.toString()}` : '';
  return fetchApi<Array<Record<string, any>>>(`/api/fee-payments${qs}`);
}

export function createFeePayment(data: Record<string, any>) {
  return fetchApi<Record<string, any>>('/api/fee-payments', { method: 'POST', body: JSON.stringify(data) });
}

export function getFeeReceipts(filters?: {
  school_id?: number | null;
  student_id?: number | null;
}) {
  const params = new URLSearchParams();
  if (filters?.school_id != null) params.append('school_id', String(filters.school_id));
  if (filters?.student_id != null) params.append('student_id', String(filters.student_id));
  const qs = params.toString() ? `?${params.toString()}` : '';
  return fetchApi<Array<Record<string, any>>>(`/api/fee-receipts${qs}`);
}

export function getFeeReceipt(id: number | string) {
  return fetchApi<Record<string, any>>(`/api/fee-receipts/${id}`);
}

export function generateFeeReceipt(data: { school_id: number; student_id: number; payment_ids: number[] }) {
  return fetchApi<Record<string, any>>('/api/fee-receipts/generate', { method: 'POST', body: JSON.stringify(data) });
}

export function cancelFeeReceipt(id: number | string, schoolId: number) {
  return fetchApi<Record<string, any>>(`/api/fee-receipts/${id}/cancel`, { method: 'PUT', body: JSON.stringify({ school_id: schoolId }) });
}

export function markReceiptPrinted(id: number | string, schoolId: number, copies?: number) {
  return fetchApi<Record<string, any>>(`/api/fee-receipts/${id}/mark-printed`, { method: 'PUT', body: JSON.stringify({ school_id: schoolId, copies: copies ?? 1 }) });
}

export function verifyReceipt(token: string) {
  return fetchApi<Record<string, any>>(`/api/verify/receipt/${token}`);
}

// ===========================================
// Treasury (Phase 8)
// ===========================================
export function getTreasurySummary(schoolId?: number | null) {
  const qs = schoolId != null ? `?school_id=${schoolId}` : '';
  return fetchApi<Record<string, any>>(`/api/treasury/summary${qs}`);
}

export function getTreasuryTransactions(filters?: {
  school_id?: number | null;
  type?: string | null;
  category?: string | null;
  status?: string | null;
  date_from?: number | string | null;
  date_to?: number | string | null;
  from?: string | null;
  to?: string | null;
  limit?: number | string | null;
  offset?: number | string | null;
}) {
  const params = new URLSearchParams();
  if (filters?.school_id != null) params.append('school_id', String(filters.school_id));
  if (filters?.type != null) params.append('type', filters.type);
  if (filters?.category != null) params.append('category', filters.category);
  if (filters?.status != null) params.append('status', filters.status);
  if (filters?.date_from != null) params.append('date_from', String(filters.date_from));
  if (filters?.date_to != null) params.append('date_to', String(filters.date_to));
  if (filters?.from != null) params.append('from', filters.from);
  if (filters?.to != null) params.append('to', filters.to);
  if (filters?.limit != null) params.append('limit', String(filters.limit));
  if (filters?.offset != null) params.append('offset', String(filters.offset));
  const qs = params.toString() ? `?${params.toString()}` : '';
  return fetchApi<Array<Record<string, any>>>(`/api/treasury/transactions${qs}`);
}

export function createTreasuryTransaction(data: Record<string, any>) {
  return fetchApi<Record<string, any>>('/api/treasury/transactions', { method: 'POST', body: JSON.stringify(data) });
}

export function updateTreasuryTransaction(id: number | string, data: Record<string, any>) {
  return fetchApi<Record<string, any>>(`/api/treasury/transactions/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export function cancelTreasuryTransaction(id: number | string, schoolId: number, reason: string) {
  return fetchApi<Record<string, any>>(`/api/treasury/transactions/${id}/cancel`, { method: 'PUT', body: JSON.stringify({ school_id: schoolId, cancel_reason: reason }) });
}

export function getTreasuryBalance(schoolId?: number | null) {
  const qs = schoolId != null ? `?school_id=${schoolId}` : '';
  return fetchApi<Record<string, any>>(`/api/treasury/balance${qs}`);
}

export function getTreasuryCategories(schoolId?: number | null) {
  const qs = schoolId != null ? `?school_id=${schoolId}` : '';
  return fetchApi<Array<Record<string, any>>>(`/api/treasury/categories${qs}`);
}

export function createTreasuryCategory(data: Record<string, any>) {
  return fetchApi<Record<string, any>>('/api/treasury/categories', { method: 'POST', body: JSON.stringify(data) });
}

export function updateTreasuryCategory(id: number | string, data: Record<string, any>) {
  return fetchApi<Record<string, any>>(`/api/treasury/categories/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export function archiveTreasuryCategory(id: number | string) {
  return fetchApi<Record<string, any>>(`/api/treasury/categories/${id}/archive`, { method: 'PUT', body: '{}' });
}

// ===========================================
// Import / Export (Phase 9)
// ===========================================
export function previewImport(type: string, data: { school_id: number; rows?: any[]; mode?: string; file_name?: string; [key: string]: unknown }) {
  return fetchApi<Record<string, any>>(`/api/import-export/${type}/preview`, { method: 'POST', body: JSON.stringify(data) });
}

export function confirmImport(type: string, data: { school_id: number; rows?: any[]; mode?: string; file_name?: string; [key: string]: unknown }) {
  return fetchApi<Record<string, any>>(`/api/import-export/${type}/confirm`, { method: 'POST', body: JSON.stringify(data) });
}

export function getExportData(type: string, schoolId?: number | null) {
  const params = new URLSearchParams();
  if (schoolId != null) params.append('school_id', String(schoolId));
  const qs = params.toString() ? `?${params.toString()}` : '';
  return fetchApi<Record<string, any>>(`/api/import-export/${type}/export${qs}`);
}

export function getImportJobs() {
  return fetchApi<Array<Record<string, any>>>('/api/import-export/jobs');
}

export function getImportJob(id: number | string) {
  return fetchApi<Record<string, any>>(`/api/import-export/jobs/${id}`);
}

// ===========================================
// Employees, salaries, official books, print records, treasury, and settings
// ===========================================
export function getEmployees(schoolId?: number | null) { const qs = schoolId != null ? `?school_id=${schoolId}` : ''; return fetchApi<Array<Record<string, any>>>(`/api/employees${qs}`); }
export function createEmployee(data: Record<string, any>) { return fetchApi<Record<string, any>>('/api/employees', { method: 'POST', body: JSON.stringify(data) }); }
export function updateEmployee(id: number | string, data: Record<string, any>) { return fetchApi<Record<string, any>>(`/api/employees/${id}`, { method: 'PUT', body: JSON.stringify(data) }); }
export function archiveEmployee(id: number | string, schoolId: number) { return fetchApi<Record<string, any>>(`/api/employees/${id}/archive`, { method: 'PUT', body: JSON.stringify({ school_id: schoolId }) }); }
export function getEmployee(id: number | string, schoolId?: number | null) { const qs = schoolId != null ? `?school_id=${schoolId}` : ''; return fetchApi<Record<string, any>>(`/api/employees/${id}${qs}`); }
export function getSalaries(filters?: { school_id?: number | null; limit?: number; offset?: number }) { const params = new URLSearchParams(); if (filters?.school_id != null) params.append('school_id', String(filters.school_id)); if (filters?.limit != null) params.append('limit', String(filters.limit)); if (filters?.offset != null) params.append('offset', String(filters.offset)); const qs = params.toString() ? `?${params.toString()}` : ''; return fetchApi<Array<Record<string, any>>>(`/api/salaries${qs}`); }
export function generateSalary(data: Record<string, any>) { return fetchApi<Record<string, any>>('/api/salaries/generate', { method: 'POST', body: JSON.stringify(data) }); }
export function generateAllSalaries(data: Record<string, any>) { return fetchApi<Record<string, any>>('/api/salaries/generate-all', { method: 'POST', body: JSON.stringify(data) }); }
export function paySalary(id: number | string, schoolId: number, paidAt?: string) { return fetchApi<Record<string, any>>(`/api/salaries/${id}/pay`, { method: 'PUT', body: JSON.stringify({ school_id: schoolId, paid_at: paidAt }) }); }
export function cancelSalary(id: number | string, schoolId: number, reason?: string) { return fetchApi<Record<string, any>>(`/api/salaries/${id}/cancel`, { method: 'PUT', body: JSON.stringify({ school_id: schoolId, cancel_reason: reason }) }); }
export function getSalaryMonthlyReport(schoolId?: number | null, month?: string, year?: string) { const params = new URLSearchParams(); if (schoolId != null) params.append('school_id', String(schoolId)); if (month != null) params.append('month', month); if (year != null) params.append('year', year); const qs = params.toString() ? `?${params.toString()}` : ''; return fetchApi<Record<string, any>>(`/api/salaries/reports/monthly${qs}`); }
export function getOfficialBookTemplates(schoolId?: number | null) { const qs = schoolId != null ? `?school_id=${schoolId}` : ''; return fetchApi<Array<Record<string, any>>>(`/api/official-book-templates${qs}`); }
export function createOfficialBookTemplate(data: Record<string, any>, schoolId?: number | null) { return fetchApi<Record<string, any>>('/api/official-book-templates', { method: 'POST', body: JSON.stringify({ ...data, school_id: schoolId }) }); }
export function updateOfficialBookTemplate(id: number | string, data: Record<string, any>, schoolId?: number | null) { return fetchApi<Record<string, any>>(`/api/official-book-templates/${id}`, { method: 'PUT', body: JSON.stringify({ ...data, school_id: schoolId }) }); }
export function getOfficialBooks(schoolId?: number | null) { const qs = schoolId != null ? `?school_id=${schoolId}` : ''; return fetchApi<Array<Record<string, any>>>(`/api/official-books${qs}`); }
export function createOfficialBook(data: Record<string, any>, schoolId?: number | null) { return fetchApi<Record<string, any>>('/api/official-books', { method: 'POST', body: JSON.stringify({ ...data, school_id: schoolId }) }); }
export function cancelOfficialBook(id: number | string, schoolId?: number | null) { return fetchApi<Record<string, any>>(`/api/official-books/${id}/cancel`, { method: 'PUT', body: JSON.stringify({ school_id: schoolId }) }); }
export function printOfficialBook(id: number | string, schoolId?: number | null) { return fetchApi<Record<string, any>>(`/api/official-books/${id}/print`, { method: 'POST', body: JSON.stringify({ school_id: schoolId }) }); }
export function getOfficialBook(id: number | string) { return fetchApi<Record<string, any>>(`/api/official-books/${id}`); }
export function verifyOfficialBook(token: string) { return fetchApi<Record<string, any>>(`/api/verify/official-book/${encodeURIComponent(token)}`); }
export function getPrintRecords(filters?: Record<string, any>, schoolId?: number | null) { const params = new URLSearchParams(); if (schoolId != null) params.append('school_id', String(schoolId)); Object.entries(filters || {}).forEach(([k, v]) => { if (v != null) params.append(k, String(v)); }); const qs = params.toString() ? `?${params.toString()}` : ''; return fetchApi<Array<Record<string, any>>>(`/api/print-records${qs}`); }
export function getTreasuryClosings(schoolId?: number | null) { const qs = schoolId != null ? `?school_id=${schoolId}` : ''; return fetchApi<Array<Record<string, any>>>(`/api/treasury/daily-closings${qs}`); }
export function closeTreasuryDay(data: Record<string, any>) { return fetchApi<Record<string, any>>('/api/treasury/daily-closings/close-day', { method: 'POST', body: JSON.stringify(data) }); }
export function getTreasuryDailyReport(schoolId?: number | null, date?: string) { const params = new URLSearchParams(); if (schoolId != null) params.append('school_id', String(schoolId)); if (date != null) params.append('date', date); const qs = params.toString() ? `?${params.toString()}` : ''; return fetchApi<Record<string, any>>(`/api/treasury/reports/daily${qs}`); }
export function getTreasuryMonthlyReport(schoolId?: number | null, month?: string) { const params = new URLSearchParams(); if (schoolId != null) params.append('school_id', String(schoolId)); if (month != null) params.append('month', month); const qs = params.toString() ? `?${params.toString()}` : ''; return fetchApi<Record<string, any>>(`/api/treasury/reports/monthly${qs}`); }
export function getSchoolSettings(schoolId?: number | null) { const qs = schoolId != null ? `?school_id=${schoolId}` : ''; return fetchApi<{ school: Record<string, any>; settings: Record<string, any> | null }>(`/api/settings/school${qs}`); }
export function getDocumentSettings(schoolId?: number | null) { const qs = schoolId != null ? `?school_id=${schoolId}` : ''; return fetchApi<Record<string, any>>(`/api/settings/document${qs}`); }
export function getSystemSettings(schoolId?: number | null) { const qs = schoolId != null ? `?school_id=${schoolId}` : ''; return fetchApi<Record<string, any>>(`/api/settings/system${qs}`); }
export function updateSchoolProfile(data: Record<string, any>, schoolId?: number | null) { return fetchApi<{ message: string }>('/api/settings/school', { method: 'PUT', body: JSON.stringify({ ...data, school_id: schoolId }) }); }
export function updateDocumentSettings(data: Record<string, any>, schoolId?: number | null) { return fetchApi<{ message: string }>('/api/settings/document', { method: 'PUT', body: JSON.stringify({ ...data, school_id: schoolId }) }); }
export function updateSystemSettings(data: Record<string, any>, schoolId?: number | null) { return fetchApi<{ message: string }>('/api/settings/system', { method: 'PUT', body: JSON.stringify({ ...data, school_id: schoolId }) }); }
