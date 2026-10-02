-- Preserve hire_date as appointment date; never infer a commencement date.
ALTER TABLE employees ADD COLUMN commencement_date TEXT;
ALTER TABLE employees ADD COLUMN photo_object_key TEXT;
ALTER TABLE employees ADD COLUMN photo_content_type TEXT;
ALTER TABLE employees ADD COLUMN photo_updated_at INTEGER;
CREATE TABLE employee_qualifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  degree TEXT NOT NULL CHECK(length(trim(degree)) BETWEEN 1 AND 200),
  general_specialization TEXT, specific_specialization TEXT,
  institution TEXT, college TEXT, graduation_date TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK(is_primary IN (0,1))
);
CREATE INDEX idx_employee_qualifications_scope ON employee_qualifications(school_id,employee_id);
CREATE UNIQUE INDEX idx_employee_qualifications_primary ON employee_qualifications(employee_id) WHERE is_primary=1;
CREATE TRIGGER employee_qualifications_scope_insert BEFORE INSERT ON employee_qualifications BEGIN
 SELECT RAISE(ABORT,'employee_qualification_invalid_scope') WHERE NOT EXISTS (SELECT 1 FROM employees WHERE id=NEW.employee_id AND school_id=NEW.school_id);
END;
CREATE TRIGGER employee_qualifications_scope_update BEFORE UPDATE ON employee_qualifications BEGIN
 SELECT RAISE(ABORT,'employee_qualification_invalid_scope') WHERE NOT EXISTS (SELECT 1 FROM employees WHERE id=NEW.employee_id AND school_id=NEW.school_id);
END;
CREATE TABLE employee_record_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  actor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK(action IN ('created','updated','archived','photo_uploaded','photo_deleted','imported')),
  before_json TEXT, after_json TEXT,
  changed_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_employee_record_audit_scope ON employee_record_audit(school_id,employee_id,id);
CREATE TRIGGER employee_record_audit_scope BEFORE INSERT ON employee_record_audit BEGIN
 SELECT RAISE(ABORT,'employee_audit_invalid_scope') WHERE
 NOT EXISTS (SELECT 1 FROM employees WHERE id=NEW.employee_id AND school_id=NEW.school_id)
 OR NOT EXISTS (SELECT 1 FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=NEW.actor_user_id AND (u.school_id=NEW.school_id OR r.key='system_admin'));
END;
CREATE TRIGGER employee_record_audit_immutable_update BEFORE UPDATE ON employee_record_audit BEGIN SELECT RAISE(ABORT,'employee_record_audit_immutable'); END;
CREATE TRIGGER employee_record_audit_immutable_delete BEFORE DELETE ON employee_record_audit BEGIN SELECT RAISE(ABORT,'employee_record_audit_immutable'); END;
