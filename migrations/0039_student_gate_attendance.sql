-- Phase 21B: student school-gate attendance and parent notifications.
--
-- Cards use an opaque public id plus an application HMAC signature. The
-- signature is never stored in D1, so a database export cannot mint new cards.
-- Gate events are append-only; mistakes are voided with a mandatory audited
-- reason instead of deleting or rewriting history.

CREATE TABLE IF NOT EXISTS gate_attendance_settings (
  school_id                     INTEGER PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
  school_start_time             TEXT NOT NULL DEFAULT '08:00' CHECK (
    length(school_start_time) = 5
    AND school_start_time GLOB '[0-2][0-9]:[0-5][0-9]'
    AND substr(school_start_time, 1, 2) BETWEEN '00' AND '23'
  ),
  late_grace_minutes            INTEGER NOT NULL DEFAULT 10 CHECK (late_grace_minutes BETWEEN 0 AND 120),
  school_end_time               TEXT NOT NULL DEFAULT '14:00' CHECK (
    length(school_end_time) = 5
    AND school_end_time GLOB '[0-2][0-9]:[0-5][0-9]'
    AND substr(school_end_time, 1, 2) BETWEEN '00' AND '23'
  ),
  early_exit_grace_minutes      INTEGER NOT NULL DEFAULT 0 CHECK (early_exit_grace_minutes BETWEEN 0 AND 120),
  duplicate_window_seconds      INTEGER NOT NULL DEFAULT 60 CHECK (duplicate_window_seconds BETWEEN 5 AND 300),
  parent_notifications_enabled  INTEGER NOT NULL DEFAULT 1 CHECK (parent_notifications_enabled IN (0, 1)),
  updated_by_user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at                    INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at                    INTEGER NOT NULL DEFAULT (unixepoch()),
  CHECK (school_end_time > school_start_time)
);

CREATE TABLE IF NOT EXISTS student_gate_cards (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id             TEXT NOT NULL UNIQUE CHECK (length(public_id) BETWEEN 32 AND 64),
  school_id             INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id            INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  status                TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  issued_by_user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  issued_at             INTEGER NOT NULL DEFAULT (unixepoch()),
  revoked_by_user_id    INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  revoked_at            INTEGER,
  revocation_reason     TEXT CHECK (revocation_reason IS NULL OR length(revocation_reason) <= 500),
  created_at            INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at            INTEGER NOT NULL DEFAULT (unixepoch()),
  CHECK (
    (status = 'active' AND revoked_by_user_id IS NULL AND revoked_at IS NULL AND revocation_reason IS NULL)
    OR
    (status = 'revoked' AND revoked_by_user_id IS NOT NULL AND revoked_at IS NOT NULL AND length(trim(revocation_reason)) > 0)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_student_gate_cards_active_student
ON student_gate_cards(school_id, student_id) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_student_gate_cards_school_status
ON student_gate_cards(school_id, status, student_id);

CREATE TABLE IF NOT EXISTS student_gate_events (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key                TEXT NOT NULL UNIQUE CHECK (length(event_key) BETWEEN 32 AND 64),
  school_id                INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id               INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  academic_year_id         INTEGER NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
  class_id                 INTEGER NOT NULL REFERENCES classes(id) ON DELETE RESTRICT,
  section_id               INTEGER REFERENCES sections(id) ON DELETE RESTRICT,
  student_name_snapshot    TEXT NOT NULL,
  student_number_snapshot  TEXT NOT NULL,
  class_name_snapshot      TEXT NOT NULL,
  section_name_snapshot    TEXT,
  card_id                  INTEGER REFERENCES student_gate_cards(id) ON DELETE RESTRICT,
  event_type               TEXT NOT NULL CHECK (event_type IN ('entry', 'exit')),
  occurred_at              INTEGER NOT NULL CHECK (occurred_at > 0),
  attendance_date          TEXT NOT NULL CHECK (
    length(attendance_date) = 10
    AND attendance_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  ),
  attendance_status        TEXT NOT NULL CHECK (attendance_status IN ('on_time', 'late', 'normal', 'early_exit')),
  late_minutes             INTEGER NOT NULL DEFAULT 0 CHECK (late_minutes BETWEEN 0 AND 1439),
  school_start_snapshot    TEXT NOT NULL,
  school_end_snapshot      TEXT NOT NULL,
  source                   TEXT NOT NULL CHECK (source IN ('card', 'manual')),
  gate_label               TEXT CHECK (gate_label IS NULL OR length(gate_label) <= 100),
  note                     TEXT CHECK (note IS NULL OR length(note) <= 500),
  manual_reason            TEXT CHECK (manual_reason IS NULL OR length(manual_reason) <= 500),
  record_status            TEXT NOT NULL DEFAULT 'active' CHECK (record_status IN ('active', 'voided')),
  recorded_by_user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  voided_by_user_id        INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  voided_at                INTEGER,
  void_reason              TEXT CHECK (void_reason IS NULL OR length(void_reason) <= 500),
  created_at               INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at               INTEGER NOT NULL DEFAULT (unixepoch()),
  CHECK (
    (source = 'card' AND card_id IS NOT NULL AND manual_reason IS NULL)
    OR
    (source = 'manual' AND card_id IS NULL AND length(trim(manual_reason)) > 0)
  ),
  CHECK (
    (event_type = 'entry' AND attendance_status IN ('on_time', 'late'))
    OR
    (event_type = 'exit' AND attendance_status IN ('normal', 'early_exit'))
  ),
  CHECK (
    (attendance_status = 'late' AND late_minutes > 0)
    OR
    (attendance_status <> 'late' AND late_minutes = 0)
  ),
  CHECK (
    (record_status = 'active' AND voided_by_user_id IS NULL AND voided_at IS NULL AND void_reason IS NULL)
    OR
    (record_status = 'voided' AND voided_by_user_id IS NOT NULL AND voided_at IS NOT NULL AND length(trim(void_reason)) > 0)
  )
);

CREATE INDEX IF NOT EXISTS idx_student_gate_events_school_date
ON student_gate_events(school_id, attendance_date, occurred_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_student_gate_events_student_date
ON student_gate_events(school_id, student_id, attendance_date, occurred_at DESC);

CREATE TABLE IF NOT EXISTS student_gate_event_audit (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id             INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  gate_event_id         INTEGER NOT NULL REFERENCES student_gate_events(id) ON DELETE RESTRICT,
  student_id            INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  old_record_status     TEXT NOT NULL,
  new_record_status     TEXT NOT NULL,
  reason                TEXT NOT NULL CHECK (length(trim(reason)) > 0 AND length(reason) <= 500),
  changed_by_user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  changed_at            INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (gate_event_id)
);

CREATE TABLE IF NOT EXISTS gate_attendance_write_guards (
  token       TEXT PRIMARY KEY,
  valid       INTEGER NOT NULL CHECK (valid = 1),
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_student_gate_event_audit_event
ON student_gate_event_audit(gate_event_id, changed_at, id);

-- Generic notification storage is intentionally introduced here because the
-- same delivery boundary will be reused by homework and parent communication.
CREATE TABLE IF NOT EXISTS school_notifications (
  notification_key    TEXT PRIMARY KEY CHECK (length(notification_key) BETWEEN 32 AND 64),
  school_id           INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  notification_type   TEXT NOT NULL CHECK (length(notification_type) BETWEEN 1 AND 80),
  title               TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  body                TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 1000),
  student_id          INTEGER REFERENCES students(id) ON DELETE RESTRICT,
  reference_type      TEXT CHECK (reference_type IS NULL OR length(reference_type) <= 80),
  reference_key       TEXT CHECK (reference_key IS NULL OR length(reference_key) <= 100),
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'withdrawn')),
  created_by_user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at          INTEGER NOT NULL DEFAULT (unixepoch()),
  withdrawn_at        INTEGER,
  CHECK (
    (status = 'active' AND withdrawn_at IS NULL)
    OR (status = 'withdrawn' AND withdrawn_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_school_notifications_reference
ON school_notifications(school_id, reference_type, reference_key, status);

CREATE TABLE IF NOT EXISTS notification_recipients (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id          INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  notification_key   TEXT NOT NULL REFERENCES school_notifications(notification_key) ON DELETE CASCADE,
  user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at            INTEGER,
  created_at         INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (notification_key, user_id)
);

CREATE INDEX IF NOT EXISTS idx_notification_recipients_user
ON notification_recipients(school_id, user_id, read_at, created_at DESC);

CREATE TRIGGER IF NOT EXISTS trg_gate_settings_validate_insert
BEFORE INSERT ON gate_attendance_settings
BEGIN
  SELECT RAISE(ABORT, 'gate settings school invalid')
  WHERE NOT EXISTS (SELECT 1 FROM schools WHERE id = NEW.school_id AND status = 'active');
  SELECT RAISE(ABORT, 'gate actor invalid')
  WHERE NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = NEW.updated_by_user_id AND status = 'active'
      AND (school_id = NEW.school_id OR school_id IS NULL)
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_gate_settings_validate_update
BEFORE UPDATE ON gate_attendance_settings
BEGIN
  SELECT RAISE(ABORT, 'gate settings identity immutable')
  WHERE NEW.school_id != OLD.school_id OR NEW.created_at != OLD.created_at;
  SELECT RAISE(ABORT, 'gate actor invalid')
  WHERE NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = NEW.updated_by_user_id AND status = 'active'
      AND (school_id = NEW.school_id OR school_id IS NULL)
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_student_gate_cards_validate_insert
BEFORE INSERT ON student_gate_cards
BEGIN
  SELECT RAISE(ABORT, 'gate card student invalid')
  WHERE NOT EXISTS (
    SELECT 1 FROM students
    WHERE id = NEW.student_id AND school_id = NEW.school_id AND status = 'active'
  );
  SELECT RAISE(ABORT, 'gate actor invalid')
  WHERE NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = NEW.issued_by_user_id AND status = 'active'
      AND (school_id = NEW.school_id OR school_id IS NULL)
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_student_gate_cards_validate_update
BEFORE UPDATE ON student_gate_cards
BEGIN
  SELECT RAISE(ABORT, 'gate card identity immutable')
  WHERE NEW.id != OLD.id OR NEW.public_id != OLD.public_id OR NEW.school_id != OLD.school_id
     OR NEW.student_id != OLD.student_id OR NEW.issued_by_user_id != OLD.issued_by_user_id
     OR NEW.issued_at != OLD.issued_at OR NEW.created_at != OLD.created_at;
  SELECT RAISE(ABORT, 'gate card cannot reactivate')
  WHERE OLD.status = 'revoked' AND NEW.status != 'revoked';
  SELECT RAISE(ABORT, 'gate card revocation immutable')
  WHERE OLD.status = 'revoked' AND (
    NEW.revoked_by_user_id IS NOT OLD.revoked_by_user_id
    OR NEW.revoked_at IS NOT OLD.revoked_at
    OR NEW.revocation_reason IS NOT OLD.revocation_reason
    OR NEW.updated_at != OLD.updated_at
  );
  SELECT RAISE(ABORT, 'gate actor invalid')
  WHERE NEW.revoked_by_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = NEW.revoked_by_user_id AND status = 'active'
      AND (school_id = NEW.school_id OR school_id IS NULL)
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_student_gate_cards_no_delete
BEFORE DELETE ON student_gate_cards
BEGIN
  SELECT RAISE(ABORT, 'gate card history immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_student_gate_events_validate_insert
BEFORE INSERT ON student_gate_events
BEGIN
  SELECT RAISE(ABORT, 'gate event student invalid')
  WHERE NOT EXISTS (
    SELECT 1
    FROM students student
    JOIN student_enrollments enrollment
      ON enrollment.student_id = student.id
     AND enrollment.school_id = student.school_id
     AND enrollment.status = 'active'
    JOIN academic_years year
      ON year.id = enrollment.academic_year_id
     AND year.school_id = enrollment.school_id
     AND year.is_active = 1
    JOIN classes class
      ON class.id = enrollment.class_id
     AND class.school_id = enrollment.school_id
     AND class.status = 'active'
    LEFT JOIN sections section
      ON section.id = enrollment.section_id
     AND section.school_id = enrollment.school_id
     AND section.class_id = enrollment.class_id
     AND section.status = 'active'
    WHERE student.id = NEW.student_id
      AND student.school_id = NEW.school_id
      AND student.status = 'active'
      AND enrollment.academic_year_id = NEW.academic_year_id
      AND enrollment.class_id = NEW.class_id
      AND enrollment.section_id IS NEW.section_id
      AND student.full_name = NEW.student_name_snapshot
      AND student.student_number = NEW.student_number_snapshot
      AND class.name = NEW.class_name_snapshot
      AND section.name IS NEW.section_name_snapshot
      AND NEW.attendance_date BETWEEN year.starts_at AND year.ends_at
  );
  SELECT RAISE(ABORT, 'gate card invalid')
  WHERE NEW.source = 'card' AND NOT EXISTS (
    SELECT 1 FROM student_gate_cards card
    WHERE card.id = NEW.card_id AND card.school_id = NEW.school_id
      AND card.student_id = NEW.student_id AND card.status = 'active'
  );
  SELECT RAISE(ABORT, 'gate actor invalid')
  WHERE NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = NEW.recorded_by_user_id AND status = 'active'
      AND (school_id = NEW.school_id OR school_id IS NULL)
  );
  SELECT RAISE(ABORT, 'gate scan duplicate')
  WHERE EXISTS (
    SELECT 1
    FROM student_gate_events existing
    LEFT JOIN gate_attendance_settings settings ON settings.school_id = NEW.school_id
    WHERE existing.school_id = NEW.school_id
      AND existing.student_id = NEW.student_id
      AND existing.event_type = NEW.event_type
      AND existing.record_status = 'active'
      AND abs(NEW.occurred_at - existing.occurred_at) < coalesce(settings.duplicate_window_seconds, 60)
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_student_gate_events_validate_update
BEFORE UPDATE ON student_gate_events
BEGIN
  SELECT RAISE(ABORT, 'gate event identity immutable')
  WHERE NEW.id != OLD.id OR NEW.event_key != OLD.event_key OR NEW.school_id != OLD.school_id
     OR NEW.student_id != OLD.student_id OR NEW.academic_year_id != OLD.academic_year_id
     OR NEW.class_id != OLD.class_id OR NEW.section_id IS NOT OLD.section_id
     OR NEW.student_name_snapshot != OLD.student_name_snapshot
     OR NEW.student_number_snapshot != OLD.student_number_snapshot
     OR NEW.class_name_snapshot != OLD.class_name_snapshot
     OR NEW.section_name_snapshot IS NOT OLD.section_name_snapshot
     OR NEW.card_id IS NOT OLD.card_id
     OR NEW.event_type != OLD.event_type OR NEW.occurred_at != OLD.occurred_at
     OR NEW.attendance_date != OLD.attendance_date OR NEW.attendance_status != OLD.attendance_status
     OR NEW.late_minutes != OLD.late_minutes OR NEW.school_start_snapshot != OLD.school_start_snapshot
     OR NEW.school_end_snapshot != OLD.school_end_snapshot OR NEW.source != OLD.source
     OR NEW.gate_label IS NOT OLD.gate_label OR NEW.note IS NOT OLD.note
     OR NEW.manual_reason IS NOT OLD.manual_reason OR NEW.recorded_by_user_id != OLD.recorded_by_user_id
     OR NEW.created_at != OLD.created_at;
  SELECT RAISE(ABORT, 'gate event cannot reactivate')
  WHERE OLD.record_status = 'voided' AND NEW.record_status != 'voided';
  SELECT RAISE(ABORT, 'gate event void immutable')
  WHERE OLD.record_status = 'voided' AND (
    NEW.voided_by_user_id IS NOT OLD.voided_by_user_id
    OR NEW.voided_at IS NOT OLD.voided_at
    OR NEW.void_reason IS NOT OLD.void_reason
    OR NEW.updated_at != OLD.updated_at
  );
  SELECT RAISE(ABORT, 'gate event void transition invalid')
  WHERE OLD.record_status = 'active' AND NEW.record_status != 'voided';
  SELECT RAISE(ABORT, 'gate actor invalid')
  WHERE NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = NEW.voided_by_user_id AND status = 'active'
      AND (school_id = NEW.school_id OR school_id IS NULL)
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_student_gate_events_audit_void
AFTER UPDATE OF record_status ON student_gate_events
WHEN OLD.record_status != NEW.record_status
BEGIN
  INSERT INTO student_gate_event_audit (
    school_id, gate_event_id, student_id, old_record_status, new_record_status,
    reason, changed_by_user_id, changed_at
  ) VALUES (
    NEW.school_id, NEW.id, NEW.student_id, OLD.record_status, NEW.record_status,
    NEW.void_reason, NEW.voided_by_user_id, NEW.voided_at
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_student_gate_events_no_delete
BEFORE DELETE ON student_gate_events
BEGIN
  SELECT RAISE(ABORT, 'gate event history immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_student_gate_event_audit_immutable_update
BEFORE UPDATE ON student_gate_event_audit
BEGIN
  SELECT RAISE(ABORT, 'gate event audit immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_student_gate_event_audit_validate_insert
BEFORE INSERT ON student_gate_event_audit
BEGIN
  SELECT RAISE(ABORT, 'gate event audit invalid')
  WHERE NOT EXISTS (
    SELECT 1
    FROM student_gate_events event
    WHERE event.id = NEW.gate_event_id
      AND event.school_id = NEW.school_id
      AND event.student_id = NEW.student_id
      AND NEW.old_record_status = 'active'
      AND NEW.new_record_status = 'voided'
      AND event.record_status = 'voided'
      AND event.void_reason = NEW.reason
      AND event.voided_by_user_id = NEW.changed_by_user_id
      AND event.voided_at = NEW.changed_at
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_student_gate_event_audit_immutable_delete
BEFORE DELETE ON student_gate_event_audit
BEGIN
  SELECT RAISE(ABORT, 'gate event audit immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_school_notifications_validate_insert
BEFORE INSERT ON school_notifications
BEGIN
  SELECT RAISE(ABORT, 'notification actor invalid')
  WHERE NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = NEW.created_by_user_id AND status = 'active'
      AND (school_id = NEW.school_id OR school_id IS NULL)
  );
  SELECT RAISE(ABORT, 'notification student invalid')
  WHERE NEW.student_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM students WHERE id = NEW.student_id AND school_id = NEW.school_id
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_school_notifications_validate_update
BEFORE UPDATE ON school_notifications
BEGIN
  SELECT RAISE(ABORT, 'notification identity immutable')
  WHERE NEW.notification_key != OLD.notification_key OR NEW.school_id != OLD.school_id
     OR NEW.notification_type != OLD.notification_type OR NEW.title != OLD.title
     OR NEW.body != OLD.body OR NEW.student_id IS NOT OLD.student_id
     OR NEW.reference_type IS NOT OLD.reference_type OR NEW.reference_key IS NOT OLD.reference_key
     OR NEW.created_by_user_id != OLD.created_by_user_id OR NEW.created_at != OLD.created_at;
  SELECT RAISE(ABORT, 'notification cannot reactivate')
  WHERE OLD.status = 'withdrawn' AND NEW.status != 'withdrawn';
  SELECT RAISE(ABORT, 'notification withdrawal immutable')
  WHERE OLD.status = 'withdrawn' AND NEW.withdrawn_at IS NOT OLD.withdrawn_at;
END;

CREATE TRIGGER IF NOT EXISTS trg_school_notifications_no_delete
BEFORE DELETE ON school_notifications
BEGIN
  SELECT RAISE(ABORT, 'notification history immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_notification_recipients_validate_insert
BEFORE INSERT ON notification_recipients
BEGIN
  SELECT RAISE(ABORT, 'notification scope invalid')
  WHERE NOT EXISTS (
    SELECT 1 FROM school_notifications notification
    WHERE notification.notification_key = NEW.notification_key
      AND notification.school_id = NEW.school_id
  );
  SELECT RAISE(ABORT, 'notification recipient invalid')
  WHERE NOT EXISTS (
    SELECT 1 FROM users user_record
    WHERE user_record.id = NEW.user_id AND user_record.school_id = NEW.school_id
      AND user_record.status = 'active'
  );
  SELECT RAISE(ABORT, 'notification parent link invalid')
  WHERE EXISTS (
    SELECT 1
    FROM users user_record
    JOIN roles role_record ON role_record.id = user_record.role_id
    JOIN school_notifications notification ON notification.notification_key = NEW.notification_key
    WHERE user_record.id = NEW.user_id AND role_record.key = 'parent'
      AND notification.student_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM parent_student_links link
        WHERE link.school_id = NEW.school_id AND link.parent_user_id = NEW.user_id
          AND link.student_id = notification.student_id AND link.status = 'active'
      )
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_notification_recipients_validate_update
BEFORE UPDATE ON notification_recipients
BEGIN
  SELECT RAISE(ABORT, 'notification recipient identity immutable')
  WHERE NEW.id != OLD.id OR NEW.school_id != OLD.school_id
     OR NEW.notification_key != OLD.notification_key OR NEW.user_id != OLD.user_id
     OR NEW.created_at != OLD.created_at;
  SELECT RAISE(ABORT, 'notification cannot become unread')
  WHERE OLD.read_at IS NOT NULL AND NEW.read_at IS NULL;
  SELECT RAISE(ABORT, 'notification read time immutable')
  WHERE OLD.read_at IS NOT NULL AND NEW.read_at IS NOT OLD.read_at;
END;
