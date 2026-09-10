import type { RoleKey } from '../types';

export interface ResourceAccessUser {
  id: number;
  role_key: RoleKey;
  school_id: number | null;
}

interface QueryResult<T> {
  results?: T[];
}

interface BoundStatement {
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<QueryResult<T>>;
}

interface ResourceAccessDb {
  prepare(query: string): {
    bind(...values: unknown[]): BoundStatement;
  };
}

const FULL_ACADEMIC_ROLES: readonly RoleKey[] = [
  'system_admin',
  'school_owner',
  'principal',
  'vice_principal',
  'registrar',
];

function sameSchool(user: ResourceAccessUser, schoolId: number): boolean {
  return user.role_key === 'system_admin' || user.school_id === schoolId;
}

function hasFullAcademicAccess(user: ResourceAccessUser): boolean {
  return FULL_ACADEMIC_ROLES.includes(user.role_key);
}

export function teacherAssignmentAccessSql(alias: 'assignment' | 'ss'): string {
  return `${alias}.is_active = 1 AND EXISTS (
    SELECT 1
    FROM teacher_employee_links access_link
    JOIN employees employee
      ON employee.id = access_link.employee_id
     AND employee.school_id = access_link.school_id
     AND employee.status = 'active'
     AND employee.role = 'teacher'
    JOIN timetable_teaching_loads teaching_load
      ON teaching_load.school_id = employee.school_id
     AND teaching_load.employee_id = employee.id
     AND teaching_load.status = 'active'
    JOIN academic_years academic_year
      ON academic_year.id = teaching_load.academic_year_id
     AND academic_year.school_id = teaching_load.school_id
     AND academic_year.is_active = 1
    WHERE access_link.school_id = ${alias}.school_id
      AND access_link.teacher_user_id = ?
      AND access_link.status = 'active'
      AND teaching_load.subject_id = ${alias}.subject_id
      AND teaching_load.class_id = ${alias}.class_id
      AND (teaching_load.section_id IS NULL OR teaching_load.section_id = ${alias}.section_id)
  )`;
}

async function teacherCanAccessStudent(
  db: ResourceAccessDb,
  userId: number,
  schoolId: number,
  studentId: number,
): Promise<boolean> {
  const row = await db.prepare(`
    SELECT 1 AS allowed FROM student_subjects assignment
    WHERE assignment.student_id = ? AND assignment.school_id = ?
      AND ${teacherAssignmentAccessSql('assignment')}
    LIMIT 1
  `).bind(studentId, schoolId, userId).first<{ allowed: number }>();
  return row?.allowed === 1;
}

async function parentCanAccessStudent(
  db: ResourceAccessDb,
  userId: number,
  schoolId: number,
  studentId: number,
): Promise<boolean> {
  const row = await db.prepare(`
    SELECT 1 AS allowed
    FROM parent_student_links
    WHERE school_id = ?
      AND parent_user_id = ?
      AND student_id = ?
      AND status = 'active'
    LIMIT 1
  `).bind(schoolId, userId, studentId).first<{ allowed: number }>();
  return row?.allowed === 1;
}

export async function canAccessStudentResource(
  db: ResourceAccessDb,
  user: ResourceAccessUser,
  studentId: number,
  options: { allowAccountant?: boolean } = {},
): Promise<boolean> {
  const student = await db.prepare('SELECT school_id FROM students WHERE id = ?')
    .bind(studentId)
    .first<{ school_id: number }>();
  if (!student || !sameSchool(user, student.school_id)) return false;
  if (hasFullAcademicAccess(user)) return true;
  if (user.role_key === 'accountant') return options.allowAccountant === true;
  if (user.role_key === 'parent') {
    return parentCanAccessStudent(db, user.id, student.school_id, studentId);
  }
  if (user.role_key === 'teacher') {
    return teacherCanAccessStudent(db, user.id, student.school_id, studentId);
  }
  return false;
}

export async function canAccessGradeResource(
  db: ResourceAccessDb,
  user: ResourceAccessUser,
  gradeId: number,
): Promise<boolean> {
  const grade = await db.prepare(`
    SELECT grade.school_id, assignment.student_id
    FROM grades grade
    JOIN student_subjects assignment
      ON assignment.id = grade.student_subject_id
     AND assignment.school_id = grade.school_id
    WHERE grade.id = ?
  `).bind(gradeId).first<{ school_id: number; student_id: number }>();
  if (!grade || !sameSchool(user, grade.school_id)) return false;
  if (hasFullAcademicAccess(user)) return true;
  if (user.role_key === 'parent') {
    return parentCanAccessStudent(db, user.id, grade.school_id, grade.student_id);
  }
  if (user.role_key !== 'teacher') return false;

  const row = await db.prepare(`
    SELECT 1 AS allowed FROM grades grade
    JOIN student_subjects assignment
      ON assignment.id = grade.student_subject_id AND assignment.school_id = grade.school_id
    WHERE grade.id = ? AND ${teacherAssignmentAccessSql('assignment')}
    LIMIT 1
  `).bind(gradeId, user.id).first<{ allowed: number }>();
  return row?.allowed === 1;
}

export async function accessibleStudentIds(
  db: ResourceAccessDb,
  user: ResourceAccessUser,
  schoolId: number,
): Promise<Set<number> | null> {
  if (!sameSchool(user, schoolId)) return new Set();
  if (hasFullAcademicAccess(user) || user.role_key === 'accountant') return null;

  if (user.role_key === 'parent') {
    const rows = await db.prepare(`
      SELECT student_id
      FROM parent_student_links
      WHERE school_id = ? AND parent_user_id = ? AND status = 'active'
    `).bind(schoolId, user.id).all<{ student_id: number }>();
    return new Set((rows.results || []).map(row => row.student_id));
  }

  if (user.role_key === 'teacher') {
    const rows = await db.prepare(`
      SELECT DISTINCT assignment.student_id
      FROM student_subjects assignment
      WHERE assignment.school_id = ? AND ${teacherAssignmentAccessSql('assignment')}
    `).bind(schoolId, user.id).all<{ student_id: number }>();
    return new Set((rows.results || []).map(row => row.student_id));
  }

  return new Set();
}

export async function accessibleGradeIds(
  db: ResourceAccessDb,
  user: ResourceAccessUser,
  schoolId: number,
): Promise<Set<number> | null> {
  if (!sameSchool(user, schoolId)) return new Set();
  if (hasFullAcademicAccess(user)) return null;

  if (user.role_key === 'parent') {
    const rows = await db.prepare(`
      SELECT grade.id
      FROM parent_student_links access_link
      JOIN student_subjects assignment
        ON assignment.school_id = access_link.school_id
       AND assignment.student_id = access_link.student_id
       AND assignment.is_active = 1
      JOIN grades grade
        ON grade.school_id = assignment.school_id
       AND grade.student_subject_id = assignment.id
       AND grade.is_active = 1
      WHERE access_link.school_id = ?
        AND access_link.parent_user_id = ?
        AND access_link.status = 'active'
    `).bind(schoolId, user.id).all<{ id: number }>();
    return new Set((rows.results || []).map(row => row.id));
  }

  if (user.role_key === 'teacher') {
    const rows = await db.prepare(`
      SELECT DISTINCT grade.id
      FROM student_subjects assignment
      JOIN grades grade ON grade.student_subject_id = assignment.id AND grade.school_id = assignment.school_id AND grade.is_active = 1
      WHERE assignment.school_id = ? AND ${teacherAssignmentAccessSql('assignment')}
    `).bind(schoolId, user.id).all<{ id: number }>();
    return new Set((rows.results || []).map(row => row.id));
  }

  return new Set();
}
