-- Phase 20C: versioned annual grade policies.
-- Existing raw grades and legacy grade_settings remain unchanged. Policies
-- become authoritative only after explicit approval for a class/year.

CREATE TABLE academic_grade_policies (
  id                                   INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id                            INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  academic_year_id                     INTEGER NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
  class_id                             INTEGER NOT NULL REFERENCES classes(id) ON DELETE RESTRICT,
  version                              INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  is_current                           INTEGER NOT NULL DEFAULT 1 CHECK(is_current IN (0,1)),
  status                               TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','locked')),
  policy_kind                          TEXT NOT NULL CHECK(policy_kind IN ('terminal','non_terminal')),
  pass_mark                            REAL NOT NULL DEFAULT 50 CHECK(pass_mark > 0 AND pass_mark <= 100),
  decision_points                      REAL NOT NULL DEFAULT 0 CHECK(decision_points >= 0 AND decision_points <= 100),
  decision_allocation_mode             TEXT NOT NULL DEFAULT 'optimal' CHECK(decision_allocation_mode IN ('optimal','manual')),
  decision_points_outcome_only         INTEGER NOT NULL DEFAULT 1 CHECK(decision_points_outcome_only IN (0,1)),
  max_completion_subjects              INTEGER NOT NULL DEFAULT 0 CHECK(max_completion_subjects BETWEEN 0 AND 30),
  exemption_enabled                    INTEGER NOT NULL DEFAULT 0 CHECK(exemption_enabled IN (0,1)),
  individual_exemption_grade           REAL NOT NULL DEFAULT 90 CHECK(individual_exemption_grade > 0 AND individual_exemption_grade <= 100),
  general_exemption_average_grade      REAL NOT NULL DEFAULT 85 CHECK(general_exemption_average_grade > 0 AND general_exemption_average_grade <= 100),
  general_exemption_min_subject_grade  REAL NOT NULL DEFAULT 75 CHECK(general_exemption_min_subject_grade > 0 AND general_exemption_min_subject_grade <= 100),
  ministerial_entry_mode               TEXT NOT NULL DEFAULT 'none' CHECK(ministerial_entry_mode IN ('none','all_continuing','pass_only','pass_or_completion')),
  ministerial_max_failed_subjects      INTEGER NOT NULL DEFAULT 0 CHECK(ministerial_max_failed_subjects BETWEEN 0 AND 30),
  minimum_monthly_exams_per_term       INTEGER NOT NULL DEFAULT 2 CHECK(minimum_monthly_exams_per_term IN (1,2)),
  fraction_rounding_mode               TEXT NOT NULL DEFAULT 'nearest' CHECK(fraction_rounding_mode IN ('nearest','ceil','none')),
  source_reference                     TEXT,
  notes                                TEXT,
  revision                             INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
  approved_at                          INTEGER,
  approved_by_user_id                  INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  locked_at                            INTEGER,
  locked_by_user_id                    INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  created_by_user_id                   INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by_user_id                   INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at                           INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at                           INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(school_id, academic_year_id, class_id, version)
);

CREATE UNIQUE INDEX idx_academic_grade_policies_current
ON academic_grade_policies(school_id, academic_year_id, class_id)
WHERE is_current = 1;

CREATE INDEX idx_academic_grade_policies_lookup
ON academic_grade_policies(school_id, academic_year_id, class_id, is_current, status);

CREATE TABLE academic_grade_policy_logs (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id           INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  policy_id           INTEGER NOT NULL REFERENCES academic_grade_policies(id) ON DELETE RESTRICT,
  action              TEXT NOT NULL CHECK(action IN ('created','updated','approved','locked','amended')),
  before_json         TEXT,
  after_json          TEXT NOT NULL CHECK(json_valid(after_json)),
  change_reason       TEXT,
  changed_by_user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at          INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_academic_grade_policy_logs_policy
ON academic_grade_policy_logs(school_id, policy_id, created_at DESC, id DESC);

-- Manual decision-point allocations are append-only versioned sets. Replacing
-- a set only retires its current marker; the previous exact allocation remains
-- available for audit and historical result-card reconstruction.
CREATE TABLE academic_grade_decision_sets (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id         INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  policy_id         INTEGER NOT NULL REFERENCES academic_grade_policies(id) ON DELETE RESTRICT,
  student_id        INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  version           INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  is_current        INTEGER NOT NULL DEFAULT 1 CHECK(is_current IN (0,1)),
  allocations_json  TEXT NOT NULL CHECK(json_valid(allocations_json) AND json_type(allocations_json)='object'),
  reason            TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 500),
  created_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(policy_id, student_id, version)
);

CREATE UNIQUE INDEX idx_academic_grade_decision_sets_current
ON academic_grade_decision_sets(policy_id, student_id)
WHERE is_current=1;

CREATE INDEX idx_academic_grade_decision_sets_lookup
ON academic_grade_decision_sets(school_id, policy_id, student_id, is_current, version DESC);

CREATE TABLE academic_grade_decision_write_assertions (
  request_id       TEXT PRIMARY KEY,
  policy_id        INTEGER NOT NULL,
  student_id       INTEGER NOT NULL,
  expected_version INTEGER NOT NULL,
  validated        INTEGER NOT NULL CHECK(validated=1)
);

CREATE TABLE academic_grade_policy_write_assertions (
  request_id        TEXT PRIMARY KEY,
  policy_id         INTEGER NOT NULL,
  expected_revision INTEGER NOT NULL,
  validated         INTEGER NOT NULL CHECK(validated=1)
);

CREATE TRIGGER trg_academic_grade_policies_validate_insert
BEFORE INSERT ON academic_grade_policies BEGIN
  SELECT RAISE(ABORT,'grade_policy_school_mismatch')
  WHERE NOT EXISTS(
    SELECT 1 FROM academic_years y
    WHERE y.id=NEW.academic_year_id AND y.school_id=NEW.school_id
  ) OR NOT EXISTS(
    SELECT 1 FROM classes c
    WHERE c.id=NEW.class_id AND c.school_id=NEW.school_id
  );
  SELECT RAISE(ABORT,'grade_policy_invalid')
  WHERE (NEW.policy_kind='terminal' AND NEW.exemption_enabled!=0)
    OR (NEW.policy_kind='non_terminal' AND (NEW.ministerial_entry_mode!='none' OR NEW.ministerial_max_failed_subjects!=0))
    OR NEW.individual_exemption_grade<NEW.pass_mark
    OR NEW.general_exemption_average_grade<NEW.pass_mark
    OR NEW.general_exemption_min_subject_grade<NEW.pass_mark
    OR NEW.general_exemption_min_subject_grade>NEW.general_exemption_average_grade
    OR (NEW.status IN ('approved','locked') AND (
      length(trim(coalesce(NEW.source_reference,'')))=0
      OR NEW.approved_at IS NULL OR NEW.approved_by_user_id IS NULL
    ))
    OR (NEW.status='locked' AND (NEW.locked_at IS NULL OR NEW.locked_by_user_id IS NULL))
    OR length(trim(coalesce(NEW.source_reference,'')))>500
    OR length(trim(coalesce(NEW.notes,'')))>2000;
END;

CREATE TRIGGER trg_academic_grade_policies_validate_update
BEFORE UPDATE ON academic_grade_policies BEGIN
  SELECT RAISE(ABORT,'grade_policy_immutable_identity')
  WHERE NEW.id!=OLD.id OR NEW.school_id!=OLD.school_id
    OR NEW.academic_year_id!=OLD.academic_year_id OR NEW.class_id!=OLD.class_id
    OR NEW.version!=OLD.version OR NEW.created_by_user_id!=OLD.created_by_user_id
    OR NEW.created_at!=OLD.created_at;
  SELECT RAISE(ABORT,'grade_policy_invalid_transition')
  WHERE (OLD.status='approved' AND NEW.status NOT IN ('approved','locked'))
    OR (OLD.status='locked' AND NEW.status!='locked')
    OR (OLD.status='locked' AND NEW.is_current=OLD.is_current AND (
      NEW.policy_kind!=OLD.policy_kind OR NEW.pass_mark!=OLD.pass_mark
      OR NEW.decision_points!=OLD.decision_points
      OR NEW.decision_allocation_mode!=OLD.decision_allocation_mode
      OR NEW.decision_points_outcome_only!=OLD.decision_points_outcome_only
      OR NEW.max_completion_subjects!=OLD.max_completion_subjects
      OR NEW.exemption_enabled!=OLD.exemption_enabled
      OR NEW.individual_exemption_grade!=OLD.individual_exemption_grade
      OR NEW.general_exemption_average_grade!=OLD.general_exemption_average_grade
      OR NEW.general_exemption_min_subject_grade!=OLD.general_exemption_min_subject_grade
      OR NEW.ministerial_entry_mode!=OLD.ministerial_entry_mode
      OR NEW.ministerial_max_failed_subjects!=OLD.ministerial_max_failed_subjects
      OR NEW.minimum_monthly_exams_per_term!=OLD.minimum_monthly_exams_per_term
      OR NEW.fraction_rounding_mode!=OLD.fraction_rounding_mode
      OR NEW.source_reference IS NOT OLD.source_reference OR NEW.notes IS NOT OLD.notes
    ));
  SELECT RAISE(ABORT,'grade_policy_school_mismatch')
  WHERE NOT EXISTS(
    SELECT 1 FROM academic_years y
    WHERE y.id=NEW.academic_year_id AND y.school_id=NEW.school_id
  ) OR NOT EXISTS(
    SELECT 1 FROM classes c
    WHERE c.id=NEW.class_id AND c.school_id=NEW.school_id
  );
  SELECT RAISE(ABORT,'grade_policy_invalid')
  WHERE (NEW.policy_kind='terminal' AND NEW.exemption_enabled!=0)
    OR (NEW.policy_kind='non_terminal' AND (NEW.ministerial_entry_mode!='none' OR NEW.ministerial_max_failed_subjects!=0))
    OR NEW.individual_exemption_grade<NEW.pass_mark
    OR NEW.general_exemption_average_grade<NEW.pass_mark
    OR NEW.general_exemption_min_subject_grade<NEW.pass_mark
    OR NEW.general_exemption_min_subject_grade>NEW.general_exemption_average_grade
    OR (NEW.status IN ('approved','locked') AND (
      length(trim(coalesce(NEW.source_reference,'')))=0
      OR NEW.approved_at IS NULL OR NEW.approved_by_user_id IS NULL
    ))
    OR (NEW.status='locked' AND (NEW.locked_at IS NULL OR NEW.locked_by_user_id IS NULL))
    OR length(trim(coalesce(NEW.source_reference,'')))>500
    OR length(trim(coalesce(NEW.notes,'')))>2000;
END;

CREATE TRIGGER trg_academic_grade_policies_preserve_history
BEFORE DELETE ON academic_grade_policies BEGIN
  SELECT RAISE(ABORT,'grade_policy_history_preserved');
END;

CREATE TRIGGER trg_academic_grade_policy_logs_validate_insert
BEFORE INSERT ON academic_grade_policy_logs BEGIN
  SELECT RAISE(ABORT,'grade_policy_school_mismatch')
  WHERE NOT EXISTS(
    SELECT 1 FROM academic_grade_policies p
    WHERE p.id=NEW.policy_id AND p.school_id=NEW.school_id
  );
  SELECT RAISE(ABORT,'grade_policy_invalid')
  WHERE NEW.before_json IS NOT NULL AND NOT json_valid(NEW.before_json);
END;

CREATE TRIGGER trg_academic_grade_policy_logs_immutable_update
BEFORE UPDATE ON academic_grade_policy_logs BEGIN
  SELECT RAISE(ABORT,'grade_policy_history_preserved');
END;

CREATE TRIGGER trg_academic_grade_policy_logs_immutable_delete
BEFORE DELETE ON academic_grade_policy_logs BEGIN
  SELECT RAISE(ABORT,'grade_policy_history_preserved');
END;

CREATE TRIGGER trg_academic_grade_decision_sets_validate_insert
BEFORE INSERT ON academic_grade_decision_sets BEGIN
  SELECT RAISE(ABORT,'grade_decision_scope_mismatch')
  WHERE NOT EXISTS(
    SELECT 1
    FROM academic_grade_policies policy
    JOIN students student ON student.id=NEW.student_id AND student.school_id=policy.school_id
    JOIN student_enrollments enrollment
      ON enrollment.student_id=student.id AND enrollment.school_id=policy.school_id
     AND enrollment.academic_year_id=policy.academic_year_id
     AND enrollment.class_id=policy.class_id
     AND enrollment.status IN ('active','completed')
    WHERE policy.id=NEW.policy_id AND policy.school_id=NEW.school_id
      AND policy.is_current=1 AND policy.status IN ('approved','locked')
      AND policy.decision_allocation_mode='manual'
  );
  SELECT RAISE(ABORT,'grade_decision_invalid')
  WHERE EXISTS(
    SELECT 1 FROM json_each(NEW.allocations_json) item
    WHERE CAST(CAST(item.key AS INTEGER) AS TEXT)!=item.key
       OR CAST(item.key AS INTEGER)<=0
       OR item.type NOT IN ('integer','real')
       OR CAST(item.value AS REAL)<0
       OR NOT EXISTS(
         SELECT 1
         FROM academic_grade_policies policy
         JOIN student_subjects assignment
           ON assignment.school_id=policy.school_id
          AND assignment.student_id=NEW.student_id
          AND assignment.class_id=policy.class_id
          AND assignment.subject_id=CAST(item.key AS INTEGER)
          AND assignment.is_active=1
         WHERE policy.id=NEW.policy_id
       )
  ) OR (
    SELECT COALESCE(SUM(CAST(value AS REAL)),0) FROM json_each(NEW.allocations_json)
  )>(
    SELECT decision_points FROM academic_grade_policies WHERE id=NEW.policy_id
  );
END;

CREATE TRIGGER trg_academic_grade_decision_sets_preserve_update
BEFORE UPDATE ON academic_grade_decision_sets BEGIN
  SELECT RAISE(ABORT,'grade_decision_history_preserved')
  WHERE OLD.is_current!=1 OR NEW.is_current!=0
    OR NEW.id!=OLD.id OR NEW.school_id!=OLD.school_id OR NEW.policy_id!=OLD.policy_id
    OR NEW.student_id!=OLD.student_id OR NEW.version!=OLD.version
    OR NEW.allocations_json!=OLD.allocations_json OR NEW.reason!=OLD.reason
    OR NEW.created_by_user_id!=OLD.created_by_user_id OR NEW.created_at!=OLD.created_at;
END;

CREATE TRIGGER trg_academic_grade_decision_sets_preserve_delete
BEFORE DELETE ON academic_grade_decision_sets BEGIN
  SELECT RAISE(ABORT,'grade_decision_history_preserved');
END;

CREATE VIEW academic_grade_policy_readiness AS
SELECT
  school.id AS school_id,
  active_year.id AS academic_year_id,
  COUNT(active_class.id) AS active_classes,
  COUNT(current_policy.id) AS configured_classes,
  COUNT(official_policy.id) AS approved_classes,
  SUM(CASE WHEN current_policy.status='draft' THEN 1 ELSE 0 END) AS pending_draft_classes,
  CASE
    WHEN active_year.id IS NULL THEN 'no_active_year'
    WHEN COUNT(active_class.id)=0 THEN 'no_active_classes'
    WHEN COUNT(current_policy.id)=0 THEN 'not_configured'
    WHEN COUNT(current_policy.id)<COUNT(active_class.id) THEN 'partial'
    WHEN COUNT(official_policy.id)<COUNT(active_class.id) THEN 'drafts_pending'
    WHEN SUM(CASE WHEN current_policy.status='draft' THEN 1 ELSE 0 END)>0 THEN 'amendments_pending'
    ELSE 'healthy'
  END AS status
FROM schools school
LEFT JOIN academic_years active_year
  ON active_year.school_id=school.id AND active_year.is_active=1
LEFT JOIN classes active_class
  ON active_class.school_id=school.id AND active_class.status='active'
LEFT JOIN academic_grade_policies current_policy
  ON current_policy.school_id=school.id
 AND current_policy.academic_year_id=active_year.id
 AND current_policy.class_id=active_class.id
 AND current_policy.is_current=1
LEFT JOIN academic_grade_policies official_policy
  ON official_policy.school_id=school.id
 AND official_policy.academic_year_id=active_year.id
 AND official_policy.class_id=active_class.id
 AND official_policy.status IN ('approved','locked')
 AND NOT EXISTS(
   SELECT 1 FROM academic_grade_policies newer
   WHERE newer.school_id=official_policy.school_id
     AND newer.academic_year_id=official_policy.academic_year_id
     AND newer.class_id=official_policy.class_id
     AND newer.status IN ('approved','locked')
     AND newer.version>official_policy.version
 )
GROUP BY school.id, active_year.id;
