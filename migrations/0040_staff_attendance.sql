-- Phase 21C: employee and teacher attendance.
--
-- Staff attendance is intentionally separate from student lesson and gate
-- attendance. Cards contain only an opaque public id plus an application HMAC
-- signature. Events are immutable snapshots; mistakes are voided with a
-- mandatory reason and an immutable audit row.

CREATE TABLE IF NOT EXISTS staff_attendance_settings (
  school_id                  INTEGER PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
  work_start_time            TEXT NOT NULL DEFAULT '08:00' CHECK (
    length(work_start_time) = 5
    AND work_start_time GLOB '[0-2][0-9]:[0-5][0-9]'
    AND substr(work_start_time, 1, 2) BETWEEN '00' AND '23'
  ),
  late_grace_minutes         INTEGER NOT NULL DEFAULT 10 CHECK (late_grace_minutes BETWEEN 0 AND 120),
  work_end_time              TEXT NOT NULL DEFAULT '14:00' CHECK (
    length(work_end_time) = 5
    AND work_end_time GLOB '[0-2][0-9]:[0-5][0-9]'
    AND substr(work_end_time, 1, 2) BETWEEN '00' AND '23'
  ),
  early_exit_grace_minutes   INTEGER NOT NULL DEFAULT 0 CHECK (early_exit_grace_minutes BETWEEN 0 AND 120),
  duplicate_window_seconds   INTEGER NOT NULL DEFAULT 60 CHECK (duplicate_window_seconds BETWEEN 5 AND 300),
  updated_by_user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at                 INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at                 INTEGER NOT NULL DEFAULT (unixepoch()),
  CHECK (work_end_time > work_start_time)
);

CREATE TABLE IF NOT EXISTS employee_attendance_cards (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id             TEXT NOT NULL UNIQUE CHECK (length(public_id) BETWEEN 32 AND 64),
  school_id             INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  employee_id           INTEGER NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
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

CREATE UNIQUE INDEX IF NOT EXISTS uq_employee_attendance_cards_active_employee
ON employee_attendance_cards(school_id, employee_id) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_employee_attendance_cards_school_status
ON employee_attendance_cards(school_id, status, employee_id);

CREATE TABLE IF NOT EXISTS employee_attendance_events (
  id                         INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key                  TEXT NOT NULL UNIQUE CHECK (length(event_key) BETWEEN 32 AND 64),
  school_id                  INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  employee_id                INTEGER NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  academic_year_id           INTEGER NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
  employee_name_snapshot     TEXT NOT NULL,
  employee_number_snapshot   TEXT,
  employee_role_snapshot     TEXT NOT NULL,
  job_title_snapshot         TEXT,
  card_id                    INTEGER REFERENCES employee_attendance_cards(id) ON DELETE RESTRICT,
  event_type                 TEXT NOT NULL CHECK (event_type IN ('entry', 'exit')),
  occurred_at                INTEGER NOT NULL CHECK (occurred_at > 0),
  attendance_date            TEXT NOT NULL CHECK (
    length(attendance_date) = 10
    AND attendance_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  ),
  attendance_status          TEXT NOT NULL CHECK (attendance_status IN ('on_time', 'late', 'normal', 'early_exit')),
  late_minutes               INTEGER NOT NULL DEFAULT 0 CHECK (late_minutes BETWEEN 0 AND 1439),
  work_start_snapshot        TEXT NOT NULL CHECK (
    length(work_start_snapshot) = 5
    AND work_start_snapshot GLOB '[0-2][0-9]:[0-5][0-9]'
    AND substr(work_start_snapshot, 1, 2) BETWEEN '00' AND '23'
  ),
  late_grace_minutes_snapshot INTEGER NOT NULL CHECK (late_grace_minutes_snapshot BETWEEN 0 AND 120),
  work_end_snapshot          TEXT NOT NULL CHECK (
    length(work_end_snapshot) = 5
    AND work_end_snapshot GLOB '[0-2][0-9]:[0-5][0-9]'
    AND substr(work_end_snapshot, 1, 2) BETWEEN '00' AND '23'
  ),
  early_exit_grace_minutes_snapshot INTEGER NOT NULL CHECK (early_exit_grace_minutes_snapshot BETWEEN 0 AND 120),
  source                     TEXT NOT NULL CHECK (source IN ('card', 'manual')),
  gate_label                 TEXT CHECK (gate_label IS NULL OR length(gate_label) <= 100),
  note                       TEXT CHECK (note IS NULL OR length(note) <= 500),
  manual_reason              TEXT CHECK (manual_reason IS NULL OR length(manual_reason) <= 500),
  record_status              TEXT NOT NULL DEFAULT 'active' CHECK (record_status IN ('active', 'voided')),
  recorded_by_user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  voided_by_user_id          INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  voided_at                  INTEGER,
  void_reason                TEXT CHECK (void_reason IS NULL OR length(void_reason) <= 500),
  created_at                 INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at                 INTEGER NOT NULL DEFAULT (unixepoch()),
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
  ),
  CHECK (work_end_snapshot > work_start_snapshot)
);

CREATE INDEX IF NOT EXISTS idx_employee_attendance_events_school_date
ON employee_attendance_events(school_id, attendance_date, occurred_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_employee_attendance_events_employee_date
ON employee_attendance_events(school_id, employee_id, attendance_date, occurred_at DESC);

CREATE TABLE IF NOT EXISTS employee_attendance_event_audit (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id             INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  attendance_event_id   INTEGER NOT NULL REFERENCES employee_attendance_events(id) ON DELETE RESTRICT,
  employee_id           INTEGER NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  old_record_status     TEXT NOT NULL,
  new_record_status     TEXT NOT NULL,
  reason                TEXT NOT NULL CHECK (length(trim(reason)) > 0 AND length(reason) <= 500),
  changed_by_user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  changed_at            INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (attendance_event_id)
);

CREATE INDEX IF NOT EXISTS idx_employee_attendance_audit_event
ON employee_attendance_event_audit(attendance_event_id, changed_at, id);

CREATE TABLE IF NOT EXISTS employee_attendance_write_guards (
  token       TEXT PRIMARY KEY,
  valid       INTEGER NOT NULL CHECK (valid = 1),
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TRIGGER IF NOT EXISTS trg_staff_attendance_settings_validate_insert
BEFORE INSERT ON staff_attendance_settings
BEGIN
  SELECT RAISE(ABORT, 'staff attendance school invalid')
  WHERE NOT EXISTS (SELECT 1 FROM schools WHERE id = NEW.school_id AND status = 'active');
  SELECT RAISE(ABORT, 'staff attendance actor invalid')
  WHERE NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = NEW.updated_by_user_id AND status = 'active'
      AND (school_id = NEW.school_id OR school_id IS NULL)
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_staff_attendance_settings_validate_update
BEFORE UPDATE ON staff_attendance_settings
BEGIN
  SELECT RAISE(ABORT, 'staff attendance settings identity immutable')
  WHERE NEW.school_id != OLD.school_id OR NEW.created_at != OLD.created_at;
  SELECT RAISE(ABORT, 'staff attendance actor invalid')
  WHERE NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = NEW.updated_by_user_id AND status = 'active'
      AND (school_id = NEW.school_id OR school_id IS NULL)
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_employee_attendance_cards_validate_insert
BEFORE INSERT ON employee_attendance_cards
BEGIN
  SELECT RAISE(ABORT, 'staff attendance employee invalid')
  WHERE NOT EXISTS (
    SELECT 1 FROM employees
    WHERE id = NEW.employee_id AND school_id = NEW.school_id AND status = 'active'
  );
  SELECT RAISE(ABORT, 'staff attendance actor invalid')
  WHERE NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = NEW.issued_by_user_id AND status = 'active'
      AND (school_id = NEW.school_id OR school_id IS NULL)
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_employee_attendance_cards_validate_update
BEFORE UPDATE ON employee_attendance_cards
BEGIN
  SELECT RAISE(ABORT, 'staff attendance card identity immutable')
  WHERE NEW.id != OLD.id OR NEW.public_id != OLD.public_id OR NEW.school_id != OLD.school_id
     OR NEW.employee_id != OLD.employee_id OR NEW.issued_by_user_id != OLD.issued_by_user_id
     OR NEW.issued_at != OLD.issued_at OR NEW.created_at != OLD.created_at;
  SELECT RAISE(ABORT, 'staff attendance card cannot reactivate')
  WHERE OLD.status = 'revoked' AND NEW.status != 'revoked';
  SELECT RAISE(ABORT, 'staff attendance card revocation immutable')
  WHERE OLD.status = 'revoked' AND (
    NEW.revoked_by_user_id IS NOT OLD.revoked_by_user_id
    OR NEW.revoked_at IS NOT OLD.revoked_at
    OR NEW.revocation_reason IS NOT OLD.revocation_reason
    OR NEW.updated_at != OLD.updated_at
  );
  SELECT RAISE(ABORT, 'staff attendance actor invalid')
  WHERE NEW.revoked_by_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = NEW.revoked_by_user_id AND status = 'active'
      AND (school_id = NEW.school_id OR school_id IS NULL)
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_employee_attendance_cards_no_delete
BEFORE DELETE ON employee_attendance_cards
BEGIN
  SELECT RAISE(ABORT, 'staff attendance card history immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_employee_attendance_events_validate_insert
BEFORE INSERT ON employee_attendance_events
BEGIN
  SELECT RAISE(ABORT, 'staff attendance employee invalid')
  WHERE NOT EXISTS (
    SELECT 1
    FROM employees employee
    JOIN academic_years year
      ON year.id = NEW.academic_year_id
     AND year.school_id = employee.school_id
     AND year.is_active = 1
    WHERE employee.id = NEW.employee_id
      AND employee.school_id = NEW.school_id
      AND employee.status = 'active'
      AND employee.full_name = NEW.employee_name_snapshot
      AND employee.employee_number IS NEW.employee_number_snapshot
      AND employee.role = NEW.employee_role_snapshot
      AND employee.job_title IS NEW.job_title_snapshot
      AND NEW.attendance_date BETWEEN year.starts_at AND year.ends_at
      AND (employee.hire_date IS NULL OR NEW.attendance_date >= employee.hire_date)
  );
  SELECT RAISE(ABORT, 'staff attendance card invalid')
  WHERE NEW.source = 'card' AND NOT EXISTS (
    SELECT 1 FROM employee_attendance_cards card
    WHERE card.id = NEW.card_id AND card.school_id = NEW.school_id
      AND card.employee_id = NEW.employee_id AND card.status = 'active'
  );
  SELECT RAISE(ABORT, 'staff attendance actor invalid')
  WHERE NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = NEW.recorded_by_user_id AND status = 'active'
      AND (school_id = NEW.school_id OR school_id IS NULL)
  );
  SELECT RAISE(ABORT, 'staff attendance scan duplicate')
  WHERE EXISTS (
    SELECT 1
    FROM employee_attendance_events existing
    LEFT JOIN staff_attendance_settings settings ON settings.school_id = NEW.school_id
    WHERE existing.school_id = NEW.school_id
      AND existing.employee_id = NEW.employee_id
      AND existing.event_type = NEW.event_type
      AND existing.record_status = 'active'
      AND abs(NEW.occurred_at - existing.occurred_at) < coalesce(settings.duplicate_window_seconds, 60)
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_employee_attendance_events_validate_update
BEFORE UPDATE ON employee_attendance_events
BEGIN
  SELECT RAISE(ABORT, 'staff attendance event identity immutable')
  WHERE NEW.id != OLD.id OR NEW.event_key != OLD.event_key OR NEW.school_id != OLD.school_id
     OR NEW.employee_id != OLD.employee_id OR NEW.academic_year_id != OLD.academic_year_id
     OR NEW.employee_name_snapshot != OLD.employee_name_snapshot
     OR NEW.employee_number_snapshot IS NOT OLD.employee_number_snapshot
     OR NEW.employee_role_snapshot != OLD.employee_role_snapshot
     OR NEW.job_title_snapshot IS NOT OLD.job_title_snapshot
     OR NEW.card_id IS NOT OLD.card_id OR NEW.event_type != OLD.event_type
     OR NEW.occurred_at != OLD.occurred_at OR NEW.attendance_date != OLD.attendance_date
     OR NEW.attendance_status != OLD.attendance_status OR NEW.late_minutes != OLD.late_minutes
     OR NEW.work_start_snapshot != OLD.work_start_snapshot
     OR NEW.late_grace_minutes_snapshot != OLD.late_grace_minutes_snapshot
     OR NEW.work_end_snapshot != OLD.work_end_snapshot
     OR NEW.early_exit_grace_minutes_snapshot != OLD.early_exit_grace_minutes_snapshot
     OR NEW.source != OLD.source OR NEW.gate_label IS NOT OLD.gate_label
     OR NEW.note IS NOT OLD.note OR NEW.manual_reason IS NOT OLD.manual_reason
     OR NEW.recorded_by_user_id != OLD.recorded_by_user_id OR NEW.created_at != OLD.created_at;
  SELECT RAISE(ABORT, 'staff attendance event cannot reactivate')
  WHERE OLD.record_status = 'voided' AND NEW.record_status != 'voided';
  SELECT RAISE(ABORT, 'staff attendance event void immutable')
  WHERE OLD.record_status = 'voided' AND (
    NEW.voided_by_user_id IS NOT OLD.voided_by_user_id
    OR NEW.voided_at IS NOT OLD.voided_at
    OR NEW.void_reason IS NOT OLD.void_reason
    OR NEW.updated_at != OLD.updated_at
  );
  SELECT RAISE(ABORT, 'staff attendance event void transition invalid')
  WHERE OLD.record_status = 'active' AND NEW.record_status != 'voided';
  SELECT RAISE(ABORT, 'staff attendance actor invalid')
  WHERE NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = NEW.voided_by_user_id AND status = 'active'
      AND (school_id = NEW.school_id OR school_id IS NULL)
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_employee_attendance_events_audit_void
AFTER UPDATE OF record_status ON employee_attendance_events
WHEN OLD.record_status != NEW.record_status
BEGIN
  INSERT INTO employee_attendance_event_audit (
    school_id, attendance_event_id, employee_id, old_record_status, new_record_status,
    reason, changed_by_user_id, changed_at
  ) VALUES (
    NEW.school_id, NEW.id, NEW.employee_id, OLD.record_status, NEW.record_status,
    NEW.void_reason, NEW.voided_by_user_id, NEW.voided_at
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_employee_attendance_events_no_delete
BEFORE DELETE ON employee_attendance_events
BEGIN
  SELECT RAISE(ABORT, 'staff attendance event history immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_employee_attendance_audit_validate_insert
BEFORE INSERT ON employee_attendance_event_audit
BEGIN
  SELECT RAISE(ABORT, 'staff attendance audit invalid')
  WHERE NOT EXISTS (
    SELECT 1
    FROM employee_attendance_events event
    WHERE event.id = NEW.attendance_event_id
      AND event.school_id = NEW.school_id
      AND event.employee_id = NEW.employee_id
      AND NEW.old_record_status = 'active'
      AND NEW.new_record_status = 'voided'
      AND event.record_status = 'voided'
      AND event.void_reason = NEW.reason
      AND event.voided_by_user_id = NEW.changed_by_user_id
      AND event.voided_at = NEW.changed_at
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_employee_attendance_audit_immutable_update
BEFORE UPDATE ON employee_attendance_event_audit
BEGIN
  SELECT RAISE(ABORT, 'staff attendance audit immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_employee_attendance_audit_immutable_delete
BEFORE DELETE ON employee_attendance_event_audit
BEGIN
  SELECT RAISE(ABORT, 'staff attendance audit immutable');
END;
