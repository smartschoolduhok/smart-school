-- Existing credentials and school data are preserved. New/reset credentials are temporary.
ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1));
ALTER TABLE users ADD COLUMN temporary_password_expires_at INTEGER;
ALTER TABLE users ADD COLUMN account_revision INTEGER NOT NULL DEFAULT 1 CHECK (account_revision > 0);

CREATE TABLE user_account_write_guards (
  operation_id TEXT PRIMARY KEY,
  valid INTEGER NOT NULL CHECK (valid = 1)
);

CREATE TABLE user_account_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_id TEXT NOT NULL UNIQUE,
  school_id INTEGER REFERENCES schools(id),
  actor_user_id INTEGER NOT NULL REFERENCES users(id),
  target_user_id INTEGER NOT NULL REFERENCES users(id),
  action TEXT NOT NULL CHECK (action IN ('create', 'update', 'status', 'reset_password', 'change_password')),
  changed_fields_json TEXT NOT NULL CHECK (json_valid(changed_fields_json)),
  before_json TEXT CHECK (before_json IS NULL OR json_valid(before_json)),
  after_json TEXT NOT NULL CHECK (json_valid(after_json)),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_user_account_audit_scope ON user_account_audit(school_id, target_user_id, id);
CREATE TRIGGER trg_user_account_audit_no_update BEFORE UPDATE ON user_account_audit
BEGIN SELECT RAISE(ABORT, 'user account audit is immutable'); END;
CREATE TRIGGER trg_user_account_audit_no_delete BEFORE DELETE ON user_account_audit
BEGIN SELECT RAISE(ABORT, 'user account audit is immutable'); END;

CREATE TRIGGER trg_teacher_link_revocation_identity
BEFORE UPDATE OF school_id, teacher_user_id, employee_id ON teacher_employee_links
WHEN NEW.status='inactive' AND (NEW.school_id IS NOT OLD.school_id OR NEW.teacher_user_id IS NOT OLD.teacher_user_id OR NEW.employee_id IS NOT OLD.employee_id)
BEGIN SELECT RAISE(ABORT, 'revocation cannot change teacher link identity'); END;
CREATE TRIGGER trg_parent_link_revocation_identity
BEFORE UPDATE OF school_id, parent_user_id, student_id ON parent_student_links
WHEN NEW.status='inactive' AND (NEW.school_id IS NOT OLD.school_id OR NEW.parent_user_id IS NOT OLD.parent_user_id OR NEW.student_id IS NOT OLD.student_id)
BEGIN SELECT RAISE(ABORT, 'revocation cannot change parent link identity'); END;

-- Revocation must remain possible after a user/employee has already been disabled.
-- Activation still passes the original tenant, role and resource checks.
DROP TRIGGER trg_teacher_employee_links_validate_update;
CREATE TRIGGER trg_teacher_employee_links_validate_update
BEFORE UPDATE OF school_id, teacher_user_id, employee_id, status ON teacher_employee_links
WHEN NEW.status = 'active'
BEGIN
  SELECT RAISE(ABORT, 'teacher access user invalid') WHERE NOT EXISTS (
    SELECT 1 FROM users u JOIN roles r ON r.id=u.role_id
    WHERE u.id=NEW.teacher_user_id AND u.school_id=NEW.school_id AND u.status='active' AND r.key='teacher'
  );
  SELECT RAISE(ABORT, 'teacher access employee invalid') WHERE NOT EXISTS (
    SELECT 1 FROM employees WHERE id=NEW.employee_id AND school_id=NEW.school_id AND status='active' AND role='teacher'
  );
END;
DROP TRIGGER trg_parent_student_links_validate_update;
CREATE TRIGGER trg_parent_student_links_validate_update
BEFORE UPDATE OF school_id, parent_user_id, student_id, status ON parent_student_links
WHEN NEW.status = 'active'
BEGIN
  SELECT RAISE(ABORT, 'parent access user invalid') WHERE NOT EXISTS (
    SELECT 1 FROM users u JOIN roles r ON r.id=u.role_id
    WHERE u.id=NEW.parent_user_id AND u.school_id=NEW.school_id AND u.status='active' AND r.key='parent'
  );
  SELECT RAISE(ABORT, 'parent access student invalid') WHERE NOT EXISTS (
    SELECT 1 FROM students WHERE id=NEW.student_id AND school_id=NEW.school_id
  );
END;
