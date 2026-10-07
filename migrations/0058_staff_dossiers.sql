-- Additional teacher dossier data only: employee identity, photo, salary and degrees keep their existing source.
CREATE TABLE staff_dossiers (
  employee_id INTEGER PRIMARY KEY REFERENCES employees(id) ON DELETE RESTRICT,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  data_json TEXT NOT NULL CHECK(json_valid(data_json) AND json_type(data_json)='object' AND length(data_json)<=180000),
  version INTEGER NOT NULL CHECK(version>0),
  updated_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_at INTEGER NOT NULL DEFAULT(unixepoch())
);
CREATE INDEX idx_staff_dossiers_school ON staff_dossiers(school_id,employee_id);
CREATE TABLE staff_dossier_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  actor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL,
  before_json TEXT,
  after_json TEXT NOT NULL,
  changed_at INTEGER NOT NULL DEFAULT(unixepoch()),
  UNIQUE(employee_id,version)
);
CREATE INDEX idx_staff_dossier_audit_scope ON staff_dossier_audit(school_id,employee_id,id);
CREATE TRIGGER staff_dossier_scope_insert BEFORE INSERT ON staff_dossiers BEGIN
  SELECT RAISE(ABORT,'staff_dossier_invalid_scope') WHERE NOT EXISTS(SELECT 1 FROM employees e JOIN schools s ON s.id=e.school_id WHERE e.id=NEW.employee_id AND e.school_id=NEW.school_id AND s.status='active');
  SELECT RAISE(ABORT,'staff_dossier_forbidden') WHERE NOT EXISTS(SELECT 1 FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=NEW.updated_by_user_id AND u.status='active' AND (r.key='system_admin' OR (u.school_id=NEW.school_id AND r.key IN ('school_owner','principal','vice_principal'))));
END;
CREATE TRIGGER staff_dossier_scope_update BEFORE UPDATE ON staff_dossiers BEGIN
  SELECT RAISE(ABORT,'staff_dossier_invalid_scope') WHERE NEW.employee_id!=OLD.employee_id OR NEW.school_id!=OLD.school_id OR NOT EXISTS(SELECT 1 FROM employees e JOIN schools s ON s.id=e.school_id WHERE e.id=NEW.employee_id AND e.school_id=NEW.school_id AND s.status='active');
  SELECT RAISE(ABORT,'staff_dossier_invalid_version') WHERE NEW.version!=OLD.version+1;
  SELECT RAISE(ABORT,'staff_dossier_forbidden') WHERE NOT EXISTS(SELECT 1 FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=NEW.updated_by_user_id AND u.status='active' AND (r.key='system_admin' OR (u.school_id=NEW.school_id AND r.key IN ('school_owner','principal','vice_principal'))));
END;
CREATE TRIGGER staff_dossier_audit_insert AFTER INSERT ON staff_dossiers BEGIN
  INSERT INTO staff_dossier_audit(school_id,employee_id,actor_user_id,version,before_json,after_json) VALUES(NEW.school_id,NEW.employee_id,NEW.updated_by_user_id,NEW.version,NULL,NEW.data_json);
END;
CREATE TRIGGER staff_dossier_audit_update AFTER UPDATE ON staff_dossiers BEGIN
  INSERT INTO staff_dossier_audit(school_id,employee_id,actor_user_id,version,before_json,after_json) VALUES(NEW.school_id,NEW.employee_id,NEW.updated_by_user_id,NEW.version,OLD.data_json,NEW.data_json);
END;
CREATE TRIGGER staff_dossier_no_delete BEFORE DELETE ON staff_dossiers BEGIN SELECT RAISE(ABORT,'staff_dossier_history_immutable'); END;
CREATE TRIGGER staff_dossier_audit_no_update BEFORE UPDATE ON staff_dossier_audit BEGIN SELECT RAISE(ABORT,'staff_dossier_audit_immutable'); END;
CREATE TRIGGER staff_dossier_audit_no_delete BEFORE DELETE ON staff_dossier_audit BEGIN SELECT RAISE(ABORT,'staff_dossier_audit_immutable'); END;
