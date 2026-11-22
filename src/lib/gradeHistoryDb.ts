// Read-only grade history by academic year (migration 0063 tags assignments
// with their year and archives them when another year is activated).

export interface StudentGradeYear {
  id: number;
  name: string;
  is_active: 0 | 1;
  grade_count: number;
}

/** Years in which the student has (current or archived) grade rows, newest first. */
export async function loadStudentGradeYears(db: D1Database, schoolId: number, studentId: number): Promise<StudentGradeYear[]> {
  try {
    const rows = await db.prepare(`
      SELECT year.id, year.name, year.is_active, COUNT(grade.id) AS grade_count
      FROM student_subjects AS assignment
      JOIN academic_years AS year ON year.id = assignment.academic_year_id AND year.school_id = assignment.school_id
      JOIN grades AS grade ON grade.student_subject_id = assignment.id AND grade.school_id = assignment.school_id
      WHERE assignment.school_id = ? AND assignment.student_id = ?
        AND (assignment.is_active = 1 OR assignment.year_archived_at IS NOT NULL)
        AND (grade.is_active = 1 OR grade.year_archived_at IS NOT NULL)
      GROUP BY year.id, year.name, year.is_active, year.starts_at
      ORDER BY year.starts_at DESC, year.id DESC
    `).bind(schoolId, studentId).all<StudentGradeYear>();
    return (rows.results || []).map(row => ({ ...row, is_active: Number(row.is_active) === 1 ? 1 : 0, grade_count: Number(row.grade_count) }));
  } catch (error) {
    // A database without migration 0063 has no year history to offer.
    if (/no such column/i.test(String((error as Error)?.message))) return [];
    throw error;
  }
}

/**
 * Grade rows of one archived year as they stood when the year was closed.
 * Subjects archived since then are still listed under their saved name.
 */
export async function loadArchivedYearGrades(db: D1Database, schoolId: number, studentId: number, academicYearId: number) {
  const rows = await db.prepare(`
    SELECT grade.*, assignment.student_id, assignment.class_id AS assignment_class_id,
           assignment.section_id AS assignment_section_id,
           subject.name AS subject_name, subject.id AS subject_id
    FROM grades AS grade
    JOIN student_subjects AS assignment ON assignment.id = grade.student_subject_id AND assignment.school_id = grade.school_id
    JOIN subjects AS subject ON subject.id = assignment.subject_id AND subject.school_id = grade.school_id
    WHERE grade.school_id = ? AND assignment.student_id = ? AND assignment.academic_year_id = ?
      AND assignment.year_archived_at IS NOT NULL AND grade.year_archived_at IS NOT NULL
    ORDER BY subject.order_index, subject.id
  `).bind(schoolId, studentId, academicYearId).all<Record<string, unknown>>();
  return rows.results || [];
}
