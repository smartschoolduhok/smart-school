// Bulk student-subject assignment in one D1 batch: one INSERT ... SELECT per
// subject over a JSON list of students, so a class of 40 students and 15
// subjects costs 15 statements instead of 1,200 round trips, and a failure
// rolls the whole request back instead of leaving half the class assigned.

export type BulkAssignmentStudent = {
  id: number;
  class_id: number | null;
  section_id: number | null;
};

export type BulkAssignmentGroup = {
  subjectId: number;
  students: BulkAssignmentStudent[];
};

export type BulkAssignmentInput = {
  schoolId: number;
  groups: BulkAssignmentGroup[];
  userId: number | null;
};

export function buildStudentSubjectBulkInsert(db: D1Database, input: BulkAssignmentInput): D1PreparedStatement[] {
  return input.groups.filter(group => group.students.length > 0).map(group => db.prepare(`
    INSERT INTO student_subjects (school_id, student_id, subject_id, class_id, section_id, is_active, assigned_by_user_id, assigned_at, created_at, updated_at)
    SELECT ?1, json_extract(candidate.value, '$.id'), ?2, json_extract(candidate.value, '$.class_id'), json_extract(candidate.value, '$.section_id'), 1, ?3, unixepoch(), unixepoch(), unixepoch()
    FROM json_each(?4) AS candidate
    WHERE NOT EXISTS (
      SELECT 1 FROM student_subjects existing
      WHERE existing.school_id = ?1
        AND existing.student_id = json_extract(candidate.value, '$.id')
        AND existing.subject_id = ?2
        AND existing.is_active = 1
    )
  `).bind(input.schoolId, group.subjectId, input.userId, JSON.stringify(group.students.map(student => ({
    id: student.id,
    class_id: student.class_id ?? null,
    section_id: student.section_id ?? null,
  })))));
}

// Returns how many assignments were inserted; the caller reports the remaining
// requested pairs as skipped (already assigned or not applicable).
export async function insertStudentSubjectsAtomically(db: D1Database, input: BulkAssignmentInput): Promise<number> {
  const statements = buildStudentSubjectBulkInsert(db, input);
  if (statements.length === 0) return 0;
  const results = await db.batch(statements);
  return results.reduce((total, result) => total + Number(result.meta?.changes ?? 0), 0);
}
