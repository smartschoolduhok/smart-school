/**
 * Canonical analytics scope: a grade is academically applicable only through
 * an active same-school student_subject assignment to an active subject.
 * Personal religion and subject religious metadata are deliberately absent.
 */
export const ANALYTICS_APPLICABLE_GRADE_JOINS = `
  FROM grades g
  INNER JOIN student_subjects ss
    ON g.student_subject_id = ss.id
   AND ss.is_active = 1
   AND ss.school_id = g.school_id
  INNER JOIN students st
    ON ss.student_id = st.id
   AND st.school_id = ss.school_id
   AND st.status = 'active'
  INNER JOIN subjects su
    ON ss.subject_id = su.id
   AND su.school_id = ss.school_id
   AND su.status = 'active'
`;
