-- Phase 21D: homework drafts, immutable publication snapshots, protected
-- attachment metadata and parent-notification delivery.

CREATE TABLE IF NOT EXISTS homework_assignments (
  id                         INTEGER PRIMARY KEY AUTOINCREMENT,
  homework_key               TEXT NOT NULL UNIQUE CHECK (length(homework_key) BETWEEN 32 AND 64),
  school_id                  INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  academic_year_id           INTEGER NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
  teaching_load_id           INTEGER NOT NULL REFERENCES timetable_teaching_loads(id) ON DELETE RESTRICT,
  class_id                   INTEGER NOT NULL REFERENCES classes(id) ON DELETE RESTRICT,
  section_id                 INTEGER REFERENCES sections(id) ON DELETE RESTRICT,
  subject_id                 INTEGER NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
  teacher_employee_id        INTEGER NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  academic_year_name_snapshot TEXT NOT NULL CHECK (length(trim(academic_year_name_snapshot)) > 0),
  class_name_snapshot        TEXT NOT NULL CHECK (length(trim(class_name_snapshot)) > 0),
  section_name_snapshot      TEXT,
  subject_name_snapshot      TEXT NOT NULL CHECK (length(trim(subject_name_snapshot)) > 0),
  teacher_name_snapshot      TEXT NOT NULL CHECK (length(trim(teacher_name_snapshot)) > 0),
  title                      TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  instructions               TEXT NOT NULL CHECK (length(trim(instructions)) BETWEEN 1 AND 5000),
  assigned_date              TEXT NOT NULL CHECK (
    length(assigned_date) = 10
    AND assigned_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  ),
  due_at                     INTEGER CHECK (due_at IS NULL OR due_at > 0),
  status                     TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'withdrawn')),
  revision                   INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  replaces_homework_id       INTEGER REFERENCES homework_assignments(id) ON DELETE RESTRICT,
  created_by_user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by_user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  published_by_user_id       INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  published_at               INTEGER,
  withdrawn_by_user_id       INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  withdrawn_at               INTEGER,
  withdrawal_reason          TEXT CHECK (
    withdrawal_reason IS NULL OR length(trim(withdrawal_reason)) BETWEEN 1 AND 500
  ),
  created_at                 INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at                 INTEGER NOT NULL DEFAULT (unixepoch()),
  CHECK (section_name_snapshot IS NULL OR length(trim(section_name_snapshot)) > 0),
  CHECK (due_at IS NULL OR due_at >= unixepoch(assigned_date || 'T00:00:00+03:00')),
  CHECK (
    (status = 'draft'
      AND published_by_user_id IS NULL AND published_at IS NULL
      AND withdrawn_by_user_id IS NULL AND withdrawn_at IS NULL AND withdrawal_reason IS NULL)
    OR
    (status = 'published'
      AND published_by_user_id IS NOT NULL AND published_at IS NOT NULL
      AND withdrawn_by_user_id IS NULL AND withdrawn_at IS NULL AND withdrawal_reason IS NULL)
    OR
    (status = 'withdrawn'
      AND published_by_user_id IS NOT NULL AND published_at IS NOT NULL
      AND withdrawn_by_user_id IS NOT NULL AND withdrawn_at IS NOT NULL
      AND withdrawal_reason IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_homework_assignments_school_status
ON homework_assignments(school_id, status, assigned_date DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_homework_assignments_load
ON homework_assignments(school_id, academic_year_id, teaching_load_id, status);

CREATE INDEX IF NOT EXISTS idx_homework_assignments_teacher
ON homework_assignments(school_id, teacher_employee_id, status, assigned_date DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_homework_replacement
ON homework_assignments(replaces_homework_id)
WHERE replaces_homework_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS homework_attachments (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  attachment_key      TEXT NOT NULL UNIQUE CHECK (length(attachment_key) BETWEEN 32 AND 64),
  school_id           INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  homework_id         INTEGER NOT NULL REFERENCES homework_assignments(id) ON DELETE RESTRICT,
  object_key          TEXT NOT NULL UNIQUE CHECK (length(object_key) BETWEEN 1 AND 500),
  original_name       TEXT NOT NULL CHECK (length(trim(original_name)) BETWEEN 1 AND 255),
  mime_type           TEXT NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  size_bytes          INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
  sha256              TEXT NOT NULL CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  created_by_user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  removed_by_user_id  INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  removed_at          INTEGER,
  created_at          INTEGER NOT NULL DEFAULT (unixepoch()),
  CHECK (
    (status = 'active' AND removed_by_user_id IS NULL AND removed_at IS NULL)
    OR (status = 'removed' AND removed_by_user_id IS NOT NULL AND removed_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_homework_attachments_homework
ON homework_attachments(homework_id, status, id);

CREATE TABLE IF NOT EXISTS homework_audience (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id                INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  homework_id              INTEGER NOT NULL REFERENCES homework_assignments(id) ON DELETE RESTRICT,
  student_id               INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  student_name_snapshot    TEXT NOT NULL CHECK (length(trim(student_name_snapshot)) > 0),
  student_number_snapshot  TEXT NOT NULL CHECK (length(trim(student_number_snapshot)) > 0),
  notification_key         TEXT NOT NULL UNIQUE CHECK (length(notification_key) BETWEEN 32 AND 64),
  created_at               INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (homework_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_homework_audience_student
ON homework_audience(school_id, student_id, homework_id);

CREATE TABLE IF NOT EXISTS homework_audit (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id             INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  homework_id           INTEGER NOT NULL REFERENCES homework_assignments(id) ON DELETE RESTRICT,
  action                TEXT NOT NULL CHECK (action IN ('created', 'updated', 'published', 'withdrawn', 'replaced')),
  old_status            TEXT,
  new_status            TEXT NOT NULL,
  old_title             TEXT,
  new_title             TEXT NOT NULL,
  old_instructions      TEXT,
  new_instructions      TEXT NOT NULL,
  old_due_at            INTEGER,
  new_due_at            INTEGER,
  old_revision          INTEGER,
  new_revision          INTEGER NOT NULL,
  reason                TEXT,
  changed_by_user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  changed_at            INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_homework_audit_homework
ON homework_audit(homework_id, changed_at, id);

CREATE TABLE IF NOT EXISTS homework_write_guards (
  token       TEXT PRIMARY KEY,
  valid       INTEGER NOT NULL CHECK (valid = 1),
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TRIGGER IF NOT EXISTS trg_homework_assignments_validate_insert
BEFORE INSERT ON homework_assignments
BEGIN
  SELECT RAISE(ABORT, 'homework actor invalid')
  WHERE NEW.updated_by_user_id != NEW.created_by_user_id;
  SELECT RAISE(ABORT, 'homework load invalid')
  WHERE NOT EXISTS (
    SELECT 1
    FROM timetable_teaching_loads load
    JOIN schools school ON school.id = load.school_id AND school.status = 'active'
    JOIN academic_years year
      ON year.id = load.academic_year_id AND year.school_id = load.school_id AND year.is_active = 1
    JOIN classes class
      ON class.id = load.class_id AND class.school_id = load.school_id AND class.status = 'active'
    LEFT JOIN sections section
      ON section.id = load.section_id AND section.school_id = load.school_id
     AND section.class_id = load.class_id AND section.status = 'active'
    JOIN subjects subject
      ON subject.id = load.subject_id AND subject.school_id = load.school_id AND subject.status = 'active'
    JOIN employees employee
      ON employee.id = load.employee_id AND employee.school_id = load.school_id
     AND employee.status = 'active' AND employee.role = 'teacher'
    WHERE load.id = NEW.teaching_load_id
      AND load.school_id = NEW.school_id
      AND load.academic_year_id = NEW.academic_year_id
      AND load.class_id = NEW.class_id
      AND load.section_id IS NEW.section_id
      AND load.subject_id = NEW.subject_id
      AND load.employee_id = NEW.teacher_employee_id
      AND load.status = 'active'
      AND (load.section_id IS NULL OR section.id IS NOT NULL)
      AND year.name = NEW.academic_year_name_snapshot
      AND class.name = NEW.class_name_snapshot
      AND section.name IS NEW.section_name_snapshot
      AND subject.name = NEW.subject_name_snapshot
      AND employee.full_name = NEW.teacher_name_snapshot
      AND NEW.assigned_date BETWEEN year.starts_at AND year.ends_at
  );
  SELECT RAISE(ABORT, 'homework actor invalid')
  WHERE NOT EXISTS (
    SELECT 1
    FROM users actor
    JOIN roles role ON role.id = actor.role_id
    WHERE actor.id = NEW.created_by_user_id AND actor.status = 'active'
      AND (actor.school_id = NEW.school_id OR (actor.school_id IS NULL AND role.key = 'system_admin'))
      AND role.key IN ('system_admin', 'school_owner', 'principal', 'vice_principal', 'teacher')
  );
  SELECT RAISE(ABORT, 'homework teacher forbidden')
  WHERE EXISTS (
    SELECT 1 FROM users actor JOIN roles role ON role.id = actor.role_id
    WHERE actor.id = NEW.created_by_user_id AND role.key = 'teacher'
  ) AND NOT EXISTS (
    SELECT 1
    FROM teacher_employee_links link
    WHERE link.school_id = NEW.school_id
      AND link.teacher_user_id = NEW.created_by_user_id
      AND link.employee_id = NEW.teacher_employee_id
      AND link.status = 'active'
  );
  SELECT RAISE(ABORT, 'homework replacement invalid')
  WHERE NEW.replaces_homework_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM homework_assignments original
    WHERE original.id = NEW.replaces_homework_id
      AND original.school_id = NEW.school_id
      AND original.teaching_load_id = NEW.teaching_load_id
      AND original.status = 'withdrawn'
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_homework_assignments_validate_update
BEFORE UPDATE ON homework_assignments
BEGIN
  SELECT RAISE(ABORT, 'homework identity immutable')
  WHERE NEW.id != OLD.id OR NEW.homework_key != OLD.homework_key
     OR NEW.school_id != OLD.school_id OR NEW.academic_year_id != OLD.academic_year_id
     OR NEW.teaching_load_id != OLD.teaching_load_id OR NEW.class_id != OLD.class_id
     OR NEW.section_id IS NOT OLD.section_id OR NEW.subject_id != OLD.subject_id
     OR NEW.teacher_employee_id != OLD.teacher_employee_id
     OR NEW.academic_year_name_snapshot != OLD.academic_year_name_snapshot
     OR NEW.class_name_snapshot != OLD.class_name_snapshot
     OR NEW.section_name_snapshot IS NOT OLD.section_name_snapshot
     OR NEW.subject_name_snapshot != OLD.subject_name_snapshot
     OR NEW.teacher_name_snapshot != OLD.teacher_name_snapshot
     OR NEW.replaces_homework_id IS NOT OLD.replaces_homework_id
     OR NEW.created_by_user_id != OLD.created_by_user_id OR NEW.created_at != OLD.created_at;
  SELECT RAISE(ABORT, 'homework published immutable')
  WHERE OLD.status != 'draft' AND (
    NEW.title != OLD.title OR NEW.instructions != OLD.instructions
    OR NEW.assigned_date != OLD.assigned_date OR NEW.due_at IS NOT OLD.due_at
  );
  SELECT RAISE(ABORT, 'homework transition invalid')
  WHERE NOT (
    (OLD.status = 'draft' AND NEW.status IN ('draft', 'published'))
    OR (OLD.status = 'published' AND NEW.status = 'withdrawn')
  );
  SELECT RAISE(ABORT, 'homework revision invalid')
  WHERE NEW.revision != OLD.revision + 1;
  SELECT RAISE(ABORT, 'homework date invalid')
  WHERE NOT EXISTS (
    SELECT 1 FROM academic_years year
    WHERE year.id = NEW.academic_year_id AND year.school_id = NEW.school_id
      AND NEW.assigned_date BETWEEN year.starts_at AND year.ends_at
  );
  SELECT RAISE(ABORT, 'homework write guard missing')
  WHERE NEW.status != OLD.status
    AND NOT EXISTS (SELECT 1 FROM homework_write_guards WHERE valid = 1);
  SELECT RAISE(ABORT, 'homework transition actor mismatch')
  WHERE (OLD.status = 'draft' AND NEW.status = 'published' AND NEW.published_by_user_id != NEW.updated_by_user_id)
     OR (OLD.status = 'published' AND NEW.status = 'withdrawn' AND NEW.withdrawn_by_user_id != NEW.updated_by_user_id);
  SELECT RAISE(ABORT, 'homework actor invalid')
  WHERE NOT EXISTS (
    SELECT 1
    FROM users actor
    JOIN roles role ON role.id = actor.role_id
    WHERE actor.id = NEW.updated_by_user_id AND actor.status = 'active'
      AND (actor.school_id = NEW.school_id OR (actor.school_id IS NULL AND role.key = 'system_admin'))
      AND role.key IN ('system_admin', 'school_owner', 'principal', 'vice_principal', 'teacher')
  );
  SELECT RAISE(ABORT, 'homework teacher forbidden')
  WHERE EXISTS (
    SELECT 1 FROM users actor JOIN roles role ON role.id = actor.role_id
    WHERE actor.id = NEW.updated_by_user_id AND role.key = 'teacher'
  ) AND (
    NEW.created_by_user_id != NEW.updated_by_user_id OR NOT EXISTS (
      SELECT 1
      FROM teacher_employee_links link
      WHERE link.school_id = NEW.school_id
        AND link.teacher_user_id = NEW.updated_by_user_id
        AND link.employee_id = NEW.teacher_employee_id
        AND link.status = 'active'
    )
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_homework_assignments_audit_insert
AFTER INSERT ON homework_assignments
BEGIN
  INSERT INTO homework_audit (
    school_id, homework_id, action, old_status, new_status,
    old_title, new_title, old_instructions, new_instructions,
    old_due_at, new_due_at, old_revision, new_revision,
    reason, changed_by_user_id, changed_at
  ) VALUES (
    NEW.school_id, NEW.id,
    CASE WHEN NEW.replaces_homework_id IS NULL THEN 'created' ELSE 'replaced' END,
    NULL, NEW.status,
    NULL, NEW.title, NULL, NEW.instructions,
    NULL, NEW.due_at, NULL, NEW.revision,
    NULL, NEW.created_by_user_id, NEW.created_at
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_homework_assignments_audit_update
AFTER UPDATE ON homework_assignments
BEGIN
  INSERT INTO homework_audit (
    school_id, homework_id, action, old_status, new_status,
    old_title, new_title, old_instructions, new_instructions,
    old_due_at, new_due_at, old_revision, new_revision,
    reason, changed_by_user_id, changed_at
  ) VALUES (
    NEW.school_id, NEW.id,
    CASE
      WHEN NEW.status = 'published' AND OLD.status = 'draft' THEN 'published'
      WHEN NEW.status = 'withdrawn' AND OLD.status = 'published' THEN 'withdrawn'
      ELSE 'updated'
    END,
    OLD.status, NEW.status, OLD.title, NEW.title,
    OLD.instructions, NEW.instructions, OLD.due_at, NEW.due_at,
    OLD.revision, NEW.revision,
    CASE WHEN NEW.status = 'withdrawn' THEN NEW.withdrawal_reason ELSE NULL END,
    NEW.updated_by_user_id, NEW.updated_at
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_homework_assignments_no_delete
BEFORE DELETE ON homework_assignments
BEGIN
  SELECT RAISE(ABORT, 'homework history immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_homework_attachments_validate_insert
BEFORE INSERT ON homework_attachments
BEGIN
  SELECT RAISE(ABORT, 'homework attachment draft required')
  WHERE NOT EXISTS (
    SELECT 1 FROM homework_assignments homework
    WHERE homework.id = NEW.homework_id AND homework.school_id = NEW.school_id
      AND homework.status = 'draft'
  );
  SELECT RAISE(ABORT, 'homework attachment actor invalid')
  WHERE NOT EXISTS (
    SELECT 1
    FROM homework_assignments homework
    JOIN users actor ON actor.id = NEW.created_by_user_id AND actor.status = 'active'
    JOIN roles role ON role.id = actor.role_id
    WHERE homework.id = NEW.homework_id AND homework.school_id = NEW.school_id
      AND (actor.school_id = NEW.school_id OR (actor.school_id IS NULL AND role.key = 'system_admin'))
      AND role.key IN ('system_admin', 'school_owner', 'principal', 'vice_principal', 'teacher')
      AND (
        role.key != 'teacher'
        OR (
          homework.created_by_user_id = actor.id
          AND EXISTS (
            SELECT 1 FROM teacher_employee_links link
            WHERE link.school_id = homework.school_id AND link.teacher_user_id = actor.id
              AND link.employee_id = homework.teacher_employee_id AND link.status = 'active'
          )
        )
      )
  );
  SELECT RAISE(ABORT, 'homework attachment limit exceeded')
  WHERE (SELECT COUNT(*) FROM homework_attachments existing
         WHERE existing.homework_id = NEW.homework_id AND existing.status = 'active') >= 5;
  SELECT RAISE(ABORT, 'homework attachment total exceeded')
  WHERE coalesce((SELECT SUM(existing.size_bytes) FROM homework_attachments existing
                  WHERE existing.homework_id = NEW.homework_id AND existing.status = 'active'), 0)
        + NEW.size_bytes > 20971520;
END;

CREATE TRIGGER IF NOT EXISTS trg_homework_attachments_validate_update
BEFORE UPDATE ON homework_attachments
BEGIN
  SELECT RAISE(ABORT, 'homework attachment identity immutable')
  WHERE NEW.id != OLD.id OR NEW.attachment_key != OLD.attachment_key
     OR NEW.school_id != OLD.school_id OR NEW.homework_id != OLD.homework_id
     OR NEW.object_key != OLD.object_key OR NEW.original_name != OLD.original_name
     OR NEW.mime_type != OLD.mime_type OR NEW.size_bytes != OLD.size_bytes
     OR NEW.sha256 != OLD.sha256 OR NEW.created_by_user_id != OLD.created_by_user_id
     OR NEW.created_at != OLD.created_at;
  SELECT RAISE(ABORT, 'homework attachment draft required')
  WHERE NOT EXISTS (
    SELECT 1 FROM homework_assignments homework
    WHERE homework.id = NEW.homework_id AND homework.school_id = NEW.school_id
      AND homework.status = 'draft'
  );
  SELECT RAISE(ABORT, 'homework attachment transition invalid')
  WHERE OLD.status != 'active' OR NEW.status != 'removed';
  SELECT RAISE(ABORT, 'homework attachment actor invalid')
  WHERE NOT EXISTS (
    SELECT 1
    FROM homework_assignments homework
    JOIN users actor ON actor.id = NEW.removed_by_user_id AND actor.status = 'active'
    JOIN roles role ON role.id = actor.role_id
    WHERE homework.id = NEW.homework_id AND homework.school_id = NEW.school_id
      AND (actor.school_id = NEW.school_id OR (actor.school_id IS NULL AND role.key = 'system_admin'))
      AND role.key IN ('system_admin', 'school_owner', 'principal', 'vice_principal', 'teacher')
      AND (
        role.key != 'teacher'
        OR (
          homework.created_by_user_id = actor.id
          AND EXISTS (
            SELECT 1 FROM teacher_employee_links link
            WHERE link.school_id = homework.school_id AND link.teacher_user_id = actor.id
              AND link.employee_id = homework.teacher_employee_id AND link.status = 'active'
          )
        )
      )
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_homework_attachments_no_delete
BEFORE DELETE ON homework_attachments
BEGIN
  SELECT RAISE(ABORT, 'homework attachment history immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_homework_audience_validate_insert
BEFORE INSERT ON homework_audience
BEGIN
  SELECT RAISE(ABORT, 'homework audience write guard missing')
  WHERE NOT EXISTS (SELECT 1 FROM homework_write_guards WHERE valid = 1);
  SELECT RAISE(ABORT, 'homework audience invalid')
  WHERE NOT EXISTS (
    SELECT 1
    FROM homework_assignments homework
    JOIN student_enrollments enrollment
      ON enrollment.school_id = homework.school_id
     AND enrollment.academic_year_id = homework.academic_year_id
     AND enrollment.class_id = homework.class_id
     AND enrollment.section_id IS homework.section_id
     AND enrollment.student_id = NEW.student_id
     AND enrollment.status = 'active'
    JOIN students student
      ON student.id = enrollment.student_id AND student.school_id = enrollment.school_id
     AND student.status = 'active'
    WHERE homework.id = NEW.homework_id AND homework.school_id = NEW.school_id
      AND homework.status = 'published'
      AND student.full_name = NEW.student_name_snapshot
      AND student.student_number = NEW.student_number_snapshot
      AND (
        NOT EXISTS (
          SELECT 1 FROM student_subjects any_assignment
          WHERE any_assignment.school_id = enrollment.school_id
            AND any_assignment.student_id = enrollment.student_id
            AND any_assignment.is_active = 1
        )
        OR EXISTS (
          SELECT 1 FROM student_subjects subject_assignment
          WHERE subject_assignment.school_id = enrollment.school_id
            AND subject_assignment.student_id = enrollment.student_id
            AND subject_assignment.subject_id = homework.subject_id
            AND subject_assignment.is_active = 1
        )
      )
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_homework_audience_immutable_update
BEFORE UPDATE ON homework_audience
BEGIN
  SELECT RAISE(ABORT, 'homework audience immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_homework_audience_immutable_delete
BEFORE DELETE ON homework_audience
BEGIN
  SELECT RAISE(ABORT, 'homework audience immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_homework_audit_validate_insert
BEFORE INSERT ON homework_audit
BEGIN
  SELECT RAISE(ABORT, 'homework audit invalid')
  WHERE NOT EXISTS (
    SELECT 1 FROM homework_assignments homework
    WHERE homework.id = NEW.homework_id AND homework.school_id = NEW.school_id
      AND homework.status = NEW.new_status
      AND homework.title = NEW.new_title
      AND homework.instructions = NEW.new_instructions
      AND homework.due_at IS NEW.new_due_at
      AND homework.revision = NEW.new_revision
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_homework_audit_immutable_update
BEFORE UPDATE ON homework_audit
BEGIN
  SELECT RAISE(ABORT, 'homework audit immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_homework_audit_immutable_delete
BEFORE DELETE ON homework_audit
BEGIN
  SELECT RAISE(ABORT, 'homework audit immutable');
END;
