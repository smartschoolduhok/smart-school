/**
 * Recalculates every derived grade value for one school in a single set-based
 * statement. Keep this in parity with calculateGrades(); focused tests execute
 * this SQL in SQLite and compare its output with the TypeScript calculator.
 *
 * Bind parameters: school_id, school_id.
 */
export const RECALCULATE_SCHOOL_GRADES_SQL = `
  WITH term_values AS (
    SELECT
      g.id,
      g.mid_year_exam,
      g.final_exam,
      g.completion_exam,
      COALESCE(policy.pass_mark, gs.passing_grade) AS passing_grade,
      COALESCE(policy.individual_exemption_grade, gs.exemption_grade) AS exemption_grade,
      CASE
        WHEN policy.policy_kind='terminal' THEN 0
        WHEN policy.id IS NOT NULL THEN policy.exemption_enabled
        ELSE 1
      END AS exemption_enabled,
      COALESCE(policy.minimum_monthly_exams_per_term, 2) AS minimum_monthly_exams_per_term,
      gs.first_term_input_mode,
      gs.second_term_input_mode,
      gs.mid_year_exam_enabled,
      gs.final_exam_enabled,
      gs.completion_exam_enabled,
      CASE
        WHEN gs.first_term_input_mode = 'monthly'
          AND ((COALESCE(policy.minimum_monthly_exams_per_term, 2)=1
                AND (g.first_month IS NOT NULL OR g.second_month IS NOT NULL))
               OR (g.first_month IS NOT NULL AND g.second_month IS NOT NULL))
          THEN ROUND((COALESCE(g.first_month,0) + COALESCE(g.second_month,0)) /
            CAST((CASE WHEN g.first_month IS NOT NULL THEN 1 ELSE 0 END
                + CASE WHEN g.second_month IS NOT NULL THEN 1 ELSE 0 END) AS REAL))
        WHEN gs.first_term_input_mode = 'direct'
          AND g.first_term_grade IS NOT NULL
          THEN ROUND(g.first_term_grade)
        ELSE NULL
      END AS first_term_average,
      CASE
        WHEN gs.second_term_input_mode = 'monthly'
          AND ((COALESCE(policy.minimum_monthly_exams_per_term, 2)=1
                AND (g.third_month IS NOT NULL OR g.fourth_month IS NOT NULL))
               OR (g.third_month IS NOT NULL AND g.fourth_month IS NOT NULL))
          THEN ROUND((COALESCE(g.third_month,0) + COALESCE(g.fourth_month,0)) /
            CAST((CASE WHEN g.third_month IS NOT NULL THEN 1 ELSE 0 END
                + CASE WHEN g.fourth_month IS NOT NULL THEN 1 ELSE 0 END) AS REAL))
        WHEN gs.second_term_input_mode = 'direct'
          AND g.second_term_grade IS NOT NULL
          THEN ROUND(g.second_term_grade)
        ELSE NULL
      END AS second_term_average
    FROM grades AS g
    JOIN grade_settings AS gs ON gs.school_id = g.school_id
    JOIN student_subjects AS assignment
      ON assignment.id=g.student_subject_id AND assignment.school_id=g.school_id
    LEFT JOIN academic_years AS active_year
      ON active_year.school_id=g.school_id AND active_year.is_active=1
    LEFT JOIN academic_grade_policies AS policy
      ON policy.school_id=g.school_id
     AND policy.academic_year_id=active_year.id
     AND policy.class_id=assignment.class_id
     AND policy.is_current=1 AND policy.status IN ('approved','locked')
    WHERE g.school_id = ? AND g.is_active = 1
  ),
  annual_values AS (
    SELECT
      *,
      CASE
        WHEN
          (first_term_input_mode = 'disabled' OR first_term_average IS NOT NULL)
          AND (mid_year_exam_enabled = 0 OR mid_year_exam IS NOT NULL)
          AND (second_term_input_mode = 'disabled' OR second_term_average IS NOT NULL)
          AND (
            CASE WHEN first_term_input_mode != 'disabled' THEN 1 ELSE 0 END
            + mid_year_exam_enabled
            + CASE WHEN second_term_input_mode != 'disabled' THEN 1 ELSE 0 END
          ) > 0
          THEN ROUND((
            CASE WHEN first_term_input_mode != 'disabled' THEN first_term_average ELSE 0 END
            + CASE WHEN mid_year_exam_enabled = 1 THEN mid_year_exam ELSE 0 END
            + CASE WHEN second_term_input_mode != 'disabled' THEN second_term_average ELSE 0 END
          ) / CAST((
            CASE WHEN first_term_input_mode != 'disabled' THEN 1 ELSE 0 END
            + mid_year_exam_enabled
            + CASE WHEN second_term_input_mode != 'disabled' THEN 1 ELSE 0 END
          ) AS REAL))
        ELSE NULL
      END AS annual_effort
    FROM term_values
  ),
  final_values AS (
    SELECT
      *,
      CASE
        WHEN exemption_enabled = 1
          AND final_exam_enabled = 1
          AND annual_effort IS NOT NULL
          AND annual_effort >= exemption_grade
          THEN 1
        ELSE 0
      END AS exemption_status,
      CASE
        WHEN annual_effort IS NULL THEN NULL
        WHEN final_exam_enabled = 0 THEN annual_effort
        WHEN exemption_enabled = 1 AND annual_effort >= exemption_grade THEN annual_effort
        WHEN final_exam IS NULL THEN NULL
        ELSE ROUND((annual_effort + final_exam) / 2.0)
      END AS final_grade
    FROM annual_values
  ),
  result_values AS (
    SELECT
      *,
      CASE
        WHEN final_grade IS NULL THEN NULL
        WHEN exemption_status = 1 OR final_grade >= passing_grade THEN NULL
        WHEN completion_exam_enabled = 1 AND completion_exam IS NOT NULL
          THEN MAX(final_grade, completion_exam)
        ELSE NULL
      END AS grade_after_completion,
      CASE
        WHEN final_grade IS NULL THEN NULL
        WHEN exemption_status = 1 OR final_grade >= passing_grade THEN final_grade
        WHEN completion_exam_enabled = 0 OR completion_exam IS NULL THEN final_grade
        ELSE MAX(final_grade, completion_exam)
      END AS effective_grade,
      CASE
        WHEN final_grade IS NULL THEN NULL
        WHEN exemption_status = 1 OR final_grade >= passing_grade THEN 'ناجح'
        WHEN completion_exam_enabled = 0 THEN 'راسب'
        WHEN completion_exam IS NULL THEN 'مكمل'
        WHEN MAX(final_grade, completion_exam) >= passing_grade THEN 'ناجح'
        ELSE 'راسب'
      END AS result_status
    FROM final_values
  )
  UPDATE grades AS g
  SET
    first_term_average = calculated.first_term_average,
    second_term_average = calculated.second_term_average,
    annual_effort = calculated.annual_effort,
    final_grade = calculated.final_grade,
    grade_after_completion = calculated.grade_after_completion,
    effective_grade = calculated.effective_grade,
    result_status = calculated.result_status,
    exemption_status = calculated.exemption_status
  FROM result_values AS calculated
  WHERE g.id = calculated.id AND g.school_id = ? AND g.is_active = 1
`;
