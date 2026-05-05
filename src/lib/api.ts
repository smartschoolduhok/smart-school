// ===========================================
// API Client - Phase 2 (Security Hardening)
// Connects React frontend to Hono backend
// Automatically injects x-user-email header from auth context
// ===========================================

const API_BASE = import.meta.env.PROD ? '' : '';
// In both dev and prod, the API is served from the same origin (Pages + Worker)

function getAuthEmail(): string | null {
  try {
    const raw = localStorage.getItem('smart_school_auth');
    if (!raw) return null;
    const user = JSON.parse(raw);
    return user?.email || null;
  } catch {
    return null;
  }
}

async function fetchApi<T>(path: string, options?: RequestInit): Promise<{ data?: T; error?: string }> {
  try {
    const email = getAuthEmail();
    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    };
    if (email) {
      headers['x-user-email'] = email;
    }
    const res = await fetch(`${API_BASE}${path}`, {
      headers,
      ...options,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { error: body.error || `خطأ ${res.status}` };
    }
    const body = await res.json();
    return { data: body.data ?? body };
  } catch (err: any) {
    return { error: err.message || 'خطأ في الاتصال بالخادم' };
  }
}

// Dashboard
export function getDashboardStats() {
  return fetchApi<{ active_schools: number; active_users: number; total_users: number; current_academic_year: string; total_modules: number; core_modules: number }>('/api/dashboard/stats');
}

// Schools
export function getSchools() {
  return fetchApi<Array<Record<string, any>>>('/api/schools');
}

export function getSchool(id: number | string) {
  return fetchApi<Record<string, any>>(`/api/schools/${id}`);
}

// Users
export function getUsers(schoolId?: number | null) {
  const qs = schoolId != null ? `?school_id=${schoolId}` : '';
  return fetchApi<Array<Record<string, any>>>(`/api/users${qs}`);
}

export function getUser(id: number | string) {
  return fetchApi<Record<string, any>>(`/api/users/${id}`);
}

// Roles
export function getRoles() {
  return fetchApi<Array<Record<string, any>>>('/api/roles');
}

export function getRole(id: number | string) {
  return fetchApi<Record<string, any>>(`/api/roles/${id}`);
}

export function getRolePermissions() {
  return fetchApi<Array<Record<string, any>>>('/api/role-permissions');
}

// Modules
export function getModules() {
  return fetchApi<Array<Record<string, any>>>('/api/modules');
}

export function getSchoolModules(schoolId?: number | null) {
  const qs = schoolId != null ? `?school_id=${schoolId}` : '';
  return fetchApi<Array<Record<string, any>>>(`/api/school-modules${qs}`);
}

// Academic Years
export function getAcademicYears(schoolId?: number | null) {
  const qs = schoolId != null ? `?school_id=${schoolId}` : '';
  return fetchApi<Array<Record<string, any>>>(`/api/academic-years${qs}`);
}

// ===========================================
// Phase 2: Classes
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

export function archiveClass(id: number | string) {
  return fetchApi<Record<string, any>>(`/api/classes/${id}/archive`, { method: 'PUT', body: '{}' });
}

// ===========================================
// Phase 2: Sections
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

export function archiveSection(id: number | string) {
  return fetchApi<Record<string, any>>(`/api/sections/${id}/archive`, { method: 'PUT', body: '{}' });
}

// ===========================================
// Phase 2: Students
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
  return fetchApi<Record<string, any>>(`/api/students/${id}`);
}

export function createStudent(data: Record<string, any>) {
  return fetchApi<Record<string, any>>('/api/students', { method: 'POST', body: JSON.stringify(data) });
}

export function updateStudent(id: number | string, data: Record<string, any>) {
  return fetchApi<Record<string, any>>(`/api/students/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export function archiveStudent(id: number | string) {
  return fetchApi<Record<string, any>>(`/api/students/${id}/archive`, { method: 'PUT', body: '{}' });
}

// ===========================================
// Phase 2: Subjects
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

export function archiveSubject(id: number | string) {
  return fetchApi<Record<string, any>>(`/api/subjects/${id}/archive`, { method: 'PUT', body: '{}' });
}
