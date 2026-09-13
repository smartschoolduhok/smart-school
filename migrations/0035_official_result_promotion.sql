-- Phase 20D.2: bind annual enrollment transitions to one exact published
-- result-card revision. The published snapshot remains the source of truth;
-- completion/incomplete outcomes never finalize an enrollment.

CREATE TABLE student_promotion_result_decisions (
  id                                INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id                         INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  source_enrollment_id              INTEGER NOT NULL REFERENCES student_enrollments(id) ON DELETE RESTRICT,
  result_card_id                    INTEGER NOT NULL REFERENCES result_cards(id) ON DELETE RESTRICT,
  result_card_publication_revision  INTEGER NOT NULL CHECK(result_card_publication_revision > 0),
  result_card_number                TEXT NOT NULL,
  policy_kind                       TEXT NOT NULL CHECK(policy_kind IN ('terminal','non_terminal')),
  academic_status_code              TEXT NOT NULL CHECK(academic_status_code IN ('pass','fail')),
  decision_action                   TEXT NOT NULL CHECK(decision_action IN ('promoted','repeated','graduated')),
  target_academic_year_id           INTEGER REFERENCES academic_years(id) ON DELETE RESTRICT,
  target_class_id                   INTEGER REFERENCES classes(id) ON DELETE RESTRICT,
  target_section_id                 INTEGER REFERENCES sections(id) ON DELETE RESTRICT,
  actor_user_id                     INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at                        INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(source_enrollment_id),
  UNIQUE(result_card_id)
);

CREATE INDEX idx_student_promotion_result_decisions_school
ON student_promotion_result_decisions(school_id, created_at DESC, id DESC);

CREATE TRIGGER trg_student_promotion_result_decisions_validate
BEFORE INSERT ON student_promotion_result_decisions
BEGIN
  SELECT RAISE(ABORT, 'official_result_source_invalid')
  WHERE NOT EXISTS (
    SELECT 1
    FROM student_enrollments source
    INNER JOIN students student
      ON student.id=source.student_id
     AND student.school_id=source.school_id
     AND student.status='active'
    INNER JOIN academic_years source_year
      ON source_year.id=source.academic_year_id
     AND source_year.school_id=source.school_id
     AND source_year.is_active=1
    WHERE source.id=NEW.source_enrollment_id
      AND source.school_id=NEW.school_id
      AND source.status='active'
      AND source.promotion_status='pending'
  );

  -- Re-check the enrollment timeline inside the same transaction that records
  -- the official decision. A later enrollment may have been created after the
  -- HTTP preview and must make the whole transition fail atomically.
  SELECT RAISE(ABORT, 'official_result_target_conflict')
  WHERE EXISTS (
    SELECT 1
    FROM student_enrollments source
    INNER JOIN academic_years source_year
      ON source_year.id=source.academic_year_id
     AND source_year.school_id=source.school_id
    INNER JOIN student_enrollments later_enrollment
      ON later_enrollment.school_id=source.school_id
     AND later_enrollment.student_id=source.student_id
    INNER JOIN academic_years later_year
      ON later_year.id=later_enrollment.academic_year_id
     AND later_year.school_id=later_enrollment.school_id
     AND later_year.starts_at>source_year.starts_at
    WHERE source.id=NEW.source_enrollment_id
  );

  SELECT RAISE(ABORT, 'official_result_target_conflict')
  WHERE NEW.decision_action IN ('promoted','repeated')
    AND EXISTS (
      SELECT 1
      FROM student_enrollments source
      INNER JOIN student_enrollments target
        ON target.school_id=source.school_id
       AND target.student_id=source.student_id
       AND target.academic_year_id=NEW.target_academic_year_id
      WHERE source.id=NEW.source_enrollment_id
    );

  SELECT RAISE(ABORT, 'official_result_actor_invalid')
  WHERE NOT EXISTS (
    SELECT 1 FROM users actor
    WHERE actor.id=NEW.actor_user_id
      AND actor.status='active'
      AND (actor.school_id=NEW.school_id OR actor.school_id IS NULL)
  );

  SELECT RAISE(ABORT, 'official_result_stale')
  WHERE NOT EXISTS (
    SELECT 1
    FROM result_cards card
    INNER JOIN student_enrollments source
      ON source.id=NEW.source_enrollment_id
     AND source.school_id=card.school_id
     AND source.student_id=card.student_id
     AND source.academic_year_id=card.academic_year_id
     AND source.class_id=card.class_id
     AND source.section_id IS card.section_id
    WHERE card.id=NEW.result_card_id
      AND card.school_id=NEW.school_id
      AND card.status='active'
      AND card.publication_status='published'
      AND card.publication_revision=NEW.result_card_publication_revision
      AND card.card_number=NEW.result_card_number
      AND json_valid(card.card_data_json)
      AND json_extract(card.card_data_json,'$.card_mode')='complete'
      AND json_extract(card.card_data_json,'$.academic_policy.status') IN ('approved','locked')
      AND json_extract(card.card_data_json,'$.academic_policy.policy_kind')=NEW.policy_kind
      AND length(trim(COALESCE(json_extract(card.card_data_json,'$.academic_policy.source_reference'),'')))>0
      AND json_extract(card.card_data_json,'$.summary.academic_status_code')=NEW.academic_status_code
  );

  SELECT RAISE(ABORT, 'official_result_action_mismatch')
  WHERE NOT (
    (NEW.policy_kind='non_terminal' AND NEW.academic_status_code='pass' AND NEW.decision_action='promoted')
    OR (NEW.policy_kind='terminal' AND NEW.academic_status_code='pass' AND NEW.decision_action='graduated')
    OR (NEW.academic_status_code='fail' AND NEW.decision_action='repeated')
  );

  SELECT RAISE(ABORT, 'official_result_target_invalid')
  WHERE (
    NEW.decision_action='graduated'
    AND (NEW.target_academic_year_id IS NOT NULL OR NEW.target_class_id IS NOT NULL OR NEW.target_section_id IS NOT NULL)
  ) OR (
    NEW.decision_action IN ('promoted','repeated')
    AND (NEW.target_academic_year_id IS NULL OR NEW.target_class_id IS NULL)
  ) OR (
    NEW.decision_action='repeated'
    AND NEW.target_class_id!=(SELECT class_id FROM student_enrollments WHERE id=NEW.source_enrollment_id)
  ) OR (
    NEW.decision_action='promoted'
    AND NEW.target_class_id=(SELECT class_id FROM student_enrollments WHERE id=NEW.source_enrollment_id)
  );

  SELECT RAISE(ABORT, 'official_result_target_invalid')
  WHERE NEW.decision_action IN ('promoted','repeated')
    AND (
      NOT EXISTS (
        SELECT 1
        FROM academic_years target_year
        INNER JOIN student_enrollments source ON source.id=NEW.source_enrollment_id
        INNER JOIN academic_years source_year ON source_year.id=source.academic_year_id
        WHERE target_year.id=NEW.target_academic_year_id
          AND target_year.school_id=NEW.school_id
          AND target_year.is_active=0
          AND target_year.starts_at>source_year.starts_at
      )
      OR NOT EXISTS (
        SELECT 1 FROM classes target_class
        WHERE target_class.id=NEW.target_class_id
          AND target_class.school_id=NEW.school_id
          AND target_class.status='active'
      )
      OR (
        NEW.target_section_id IS NULL
        AND EXISTS (
          SELECT 1 FROM sections active_section
          WHERE active_section.school_id=NEW.school_id
            AND active_section.class_id=NEW.target_class_id
            AND active_section.status='active'
        )
      )
      OR (
        NEW.target_section_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM sections target_section
          WHERE target_section.id=NEW.target_section_id
            AND target_section.school_id=NEW.school_id
            AND target_section.class_id=NEW.target_class_id
            AND target_section.status='active'
        )
      )
    );
END;

CREATE TRIGGER trg_student_promotion_requires_official_result
BEFORE UPDATE OF status, promotion_status ON student_enrollments
WHEN OLD.status='active'
 AND OLD.promotion_status='pending'
 AND NEW.status='completed'
 AND NEW.promotion_status IN ('promoted','repeated','graduated')
BEGIN
  SELECT RAISE(ABORT, 'official_result_required')
  WHERE NOT EXISTS (
    SELECT 1 FROM student_promotion_result_decisions decision
    WHERE decision.source_enrollment_id=OLD.id
      AND decision.school_id=OLD.school_id
      AND decision.decision_action=NEW.promotion_status
  );
END;

CREATE TRIGGER trg_student_promotion_result_decisions_immutable_update
BEFORE UPDATE ON student_promotion_result_decisions
BEGIN
  SELECT RAISE(ABORT, 'official_result_decision_immutable');
END;

CREATE TRIGGER trg_student_promotion_result_decisions_immutable_delete
BEFORE DELETE ON student_promotion_result_decisions
BEGIN
  SELECT RAISE(ABORT, 'official_result_decision_immutable');
END;

CREATE TRIGGER trg_student_promotion_finalized_source_immutable
BEFORE UPDATE OF school_id, student_id, academic_year_id, class_id, section_id,
  status, promotion_status, completed_at, updated_by_user_id
ON student_enrollments
WHEN OLD.status='completed'
 AND EXISTS (
   SELECT 1 FROM student_promotion_result_decisions decision
   WHERE decision.source_enrollment_id=OLD.id
 )
BEGIN
  SELECT RAISE(ABORT, 'official_result_decision_immutable')
  WHERE NOT (
    OLD.completed_at<0
    AND NEW.completed_at>0
    AND NEW.school_id=OLD.school_id
    AND NEW.student_id=OLD.student_id
    AND NEW.academic_year_id=OLD.academic_year_id
    AND NEW.class_id=OLD.class_id
    AND NEW.section_id IS OLD.section_id
    AND NEW.status=OLD.status
    AND NEW.promotion_status=OLD.promotion_status
    AND NEW.updated_by_user_id IS OLD.updated_by_user_id
  ) AND (
    NEW.school_id!=OLD.school_id
    OR NEW.student_id!=OLD.student_id
    OR NEW.academic_year_id!=OLD.academic_year_id
    OR NEW.class_id!=OLD.class_id
    OR NEW.section_id IS NOT OLD.section_id
    OR NEW.status!=OLD.status
    OR NEW.promotion_status!=OLD.promotion_status
    OR NEW.completed_at IS NOT OLD.completed_at
    OR NEW.updated_by_user_id IS NOT OLD.updated_by_user_id
  );
END;

CREATE TRIGGER trg_result_card_used_for_promotion_withdraw_guard
BEFORE UPDATE OF publication_status ON result_cards
WHEN OLD.publication_status='published'
 AND NEW.publication_status='withdrawn'
 AND EXISTS (
   SELECT 1 FROM student_promotion_result_decisions decision
   WHERE decision.result_card_id=OLD.id
 )
BEGIN
  SELECT RAISE(ABORT, 'official_result_already_applied');
END;

CREATE TRIGGER trg_result_card_used_for_promotion_evidence_immutable
BEFORE UPDATE OF school_id, student_id, class_id, section_id, academic_year_id,
  card_number, card_data_json
ON result_cards
WHEN EXISTS (
  SELECT 1 FROM student_promotion_result_decisions decision
  WHERE decision.result_card_id=OLD.id
)
BEGIN
  SELECT RAISE(ABORT, 'official_result_evidence_immutable');
END;

CREATE VIEW student_promotion_result_readiness AS
SELECT
  school.id AS school_id,
  COUNT(decision.id) AS total_decisions,
  COALESCE(SUM(CASE WHEN decision.id IS NOT NULL AND (
    source.id IS NULL
    OR source.status!='completed'
    OR source.promotion_status!=decision.decision_action
    OR source.completed_at IS NULL
    OR source.completed_at<=0
    OR source.updated_by_user_id IS NOT decision.actor_user_id
    OR card.id IS NULL
    OR card.status!='active'
    OR card.publication_status!='published'
    OR card.publication_revision!=decision.result_card_publication_revision
    OR card.card_number!=decision.result_card_number
    OR card.school_id!=decision.school_id
    OR card.student_id!=source.student_id
    OR card.academic_year_id!=source.academic_year_id
    OR card.class_id!=source.class_id
    OR card.section_id IS NOT source.section_id
    OR NOT json_valid(card.card_data_json)
    OR json_extract(card.card_data_json,'$.card_mode')!='complete'
    OR json_extract(card.card_data_json,'$.academic_policy.status') NOT IN ('approved','locked')
    OR length(trim(COALESCE(json_extract(card.card_data_json,'$.academic_policy.source_reference'),'')))=0
    OR json_extract(card.card_data_json,'$.academic_policy.policy_kind')!=decision.policy_kind
    OR json_extract(card.card_data_json,'$.summary.academic_status_code')!=decision.academic_status_code
    OR (
      decision.decision_action IN ('promoted','repeated')
      AND (
        target.id IS NULL
        OR target.class_id!=decision.target_class_id
        OR target.section_id IS NOT decision.target_section_id
        OR target.status!='active'
        OR target.promotion_status!='pending'
      )
    )
  ) THEN 1 ELSE 0 END),0) AS inconsistent_decisions,
  CASE
    WHEN COALESCE(SUM(CASE WHEN decision.id IS NOT NULL AND (
      source.id IS NULL
      OR source.status!='completed'
      OR source.promotion_status!=decision.decision_action
      OR source.completed_at IS NULL
      OR source.completed_at<=0
      OR source.updated_by_user_id IS NOT decision.actor_user_id
      OR card.id IS NULL
      OR card.status!='active'
      OR card.publication_status!='published'
      OR card.publication_revision!=decision.result_card_publication_revision
      OR card.card_number!=decision.result_card_number
      OR card.school_id!=decision.school_id
      OR card.student_id!=source.student_id
      OR card.academic_year_id!=source.academic_year_id
      OR card.class_id!=source.class_id
      OR card.section_id IS NOT source.section_id
      OR NOT json_valid(card.card_data_json)
      OR json_extract(card.card_data_json,'$.card_mode')!='complete'
      OR json_extract(card.card_data_json,'$.academic_policy.status') NOT IN ('approved','locked')
      OR length(trim(COALESCE(json_extract(card.card_data_json,'$.academic_policy.source_reference'),'')))=0
      OR json_extract(card.card_data_json,'$.academic_policy.policy_kind')!=decision.policy_kind
      OR json_extract(card.card_data_json,'$.summary.academic_status_code')!=decision.academic_status_code
      OR (
        decision.decision_action IN ('promoted','repeated')
        AND (
          target.id IS NULL
          OR target.class_id!=decision.target_class_id
          OR target.section_id IS NOT decision.target_section_id
          OR target.status!='active'
          OR target.promotion_status!='pending'
        )
      )
    ) THEN 1 ELSE 0 END),0)=0 THEN 'healthy'
    ELSE 'inconsistent'
  END AS status
FROM schools school
LEFT JOIN student_promotion_result_decisions decision ON decision.school_id=school.id
LEFT JOIN student_enrollments source ON source.id=decision.source_enrollment_id
LEFT JOIN result_cards card ON card.id=decision.result_card_id
LEFT JOIN student_enrollments target
  ON target.school_id=decision.school_id
 AND target.student_id=source.student_id
 AND target.academic_year_id=decision.target_academic_year_id
GROUP BY school.id;
