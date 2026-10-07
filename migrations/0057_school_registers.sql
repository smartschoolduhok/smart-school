-- School register entries retain their complete change history. No personal
-- data from the photographed examples is seeded by this migration.
CREATE TABLE school_register_entries (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
 academic_year_id INTEGER NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
 register_key TEXT NOT NULL CHECK(length(register_key) BETWEEN 1 AND 100),
 entry_date TEXT NOT NULL CHECK(entry_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
 title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 200),
 data_json TEXT NOT NULL CHECK(json_valid(data_json) AND json_type(data_json)='object' AND length(data_json)<=24000),
 employee_id INTEGER REFERENCES employees(id) ON DELETE RESTRICT,
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','voided')),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 void_reason TEXT CHECK(void_reason IS NULL OR length(trim(void_reason)) BETWEEN 1 AND 1000),
 created_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 updated_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 created_at INTEGER NOT NULL DEFAULT(unixepoch()),
 updated_at INTEGER NOT NULL DEFAULT(unixepoch()),
 CHECK((status='active' AND void_reason IS NULL) OR (status='voided' AND void_reason IS NOT NULL)),
 CHECK((register_key='teacher-evaluation' AND employee_id IS NOT NULL AND json_type(data_json,'$.employee_id') IS 'integer' AND json_extract(data_json,'$.employee_id') IS employee_id)
   OR (register_key<>'teacher-evaluation' AND employee_id IS NULL AND json_type(data_json,'$.employee_id') IS NULL))
);
CREATE INDEX idx_school_register_entries_scope ON school_register_entries(school_id,academic_year_id,register_key,status,entry_date DESC,id DESC);
CREATE TABLE school_register_history (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 entry_id INTEGER NOT NULL REFERENCES school_register_entries(id) ON DELETE RESTRICT,
 actor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 action TEXT NOT NULL CHECK(action IN ('created','updated','voided')),
 version INTEGER NOT NULL,
 before_json TEXT,
 after_json TEXT NOT NULL,
 changed_at INTEGER NOT NULL DEFAULT(unixepoch()),
 UNIQUE(entry_id,version)
);
CREATE INDEX idx_school_register_history_entry ON school_register_history(entry_id,id DESC);

CREATE TRIGGER school_register_entries_validate_insert BEFORE INSERT ON school_register_entries BEGIN
 SELECT RAISE(ABORT,'school_register_scope_conflict') WHERE NEW.version<>1 OR NEW.status<>'active'
 OR NEW.created_by_user_id<>NEW.updated_by_user_id
 OR NOT EXISTS(SELECT 1 FROM schools WHERE id=NEW.school_id AND status='active')
 OR NOT EXISTS(SELECT 1 FROM academic_years WHERE id=NEW.academic_year_id AND school_id=NEW.school_id)
 OR (NEW.employee_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM employees WHERE id=NEW.employee_id AND school_id=NEW.school_id))
 OR NOT EXISTS(SELECT 1 FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=NEW.updated_by_user_id AND u.status='active'
   AND (r.key='system_admin' OR (u.school_id=NEW.school_id AND r.key IN ('school_owner','principal','vice_principal'))));
END;
CREATE TRIGGER school_register_entries_validate_update BEFORE UPDATE ON school_register_entries BEGIN
 SELECT RAISE(ABORT,'school_register_scope_conflict') WHERE NEW.id<>OLD.id OR NEW.school_id<>OLD.school_id
 OR NEW.academic_year_id<>OLD.academic_year_id OR NEW.register_key<>OLD.register_key
 OR NEW.created_at<>OLD.created_at OR NEW.created_by_user_id<>OLD.created_by_user_id
 OR OLD.status<>'active' OR NEW.version<>OLD.version+1
 OR NOT EXISTS(SELECT 1 FROM schools WHERE id=NEW.school_id AND status='active')
 OR NOT EXISTS(SELECT 1 FROM academic_years WHERE id=NEW.academic_year_id AND school_id=NEW.school_id)
 OR (NEW.employee_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM employees WHERE id=NEW.employee_id AND school_id=NEW.school_id))
 OR NOT EXISTS(SELECT 1 FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=NEW.updated_by_user_id AND u.status='active'
   AND (r.key='system_admin' OR (u.school_id=NEW.school_id AND r.key IN ('school_owner','principal','vice_principal'))));
 SELECT RAISE(ABORT,'school_register_void_content_conflict') WHERE NEW.status='voided'
   AND (NEW.entry_date<>OLD.entry_date OR NEW.title<>OLD.title OR NEW.data_json<>OLD.data_json OR NEW.employee_id IS NOT OLD.employee_id);
END;
-- The audit insert is part of the mutating statement, so failure rolls back the
-- entry as well, including writes performed outside the HTTP route.
CREATE TRIGGER school_register_entries_created AFTER INSERT ON school_register_entries BEGIN
 INSERT INTO school_register_history(entry_id,actor_user_id,action,version,before_json,after_json)
 VALUES(NEW.id,NEW.updated_by_user_id,'created',NEW.version,NULL,json_object(
   'id',NEW.id,'school_id',NEW.school_id,'academic_year_id',NEW.academic_year_id,'register_key',NEW.register_key,
   'entry_date',NEW.entry_date,'title',NEW.title,'data',json(NEW.data_json),'status',NEW.status,'version',NEW.version,
   'created_at',NEW.created_at,'updated_at',NEW.updated_at,'void_reason',NEW.void_reason));
END;
CREATE TRIGGER school_register_entries_changed AFTER UPDATE ON school_register_entries BEGIN
 INSERT INTO school_register_history(entry_id,actor_user_id,action,version,before_json,after_json)
 VALUES(NEW.id,NEW.updated_by_user_id,CASE WHEN NEW.status='voided' THEN 'voided' ELSE 'updated' END,NEW.version,
   json_object('id',OLD.id,'school_id',OLD.school_id,'academic_year_id',OLD.academic_year_id,'register_key',OLD.register_key,
     'entry_date',OLD.entry_date,'title',OLD.title,'data',json(OLD.data_json),'status',OLD.status,'version',OLD.version,
     'created_at',OLD.created_at,'updated_at',OLD.updated_at,'void_reason',OLD.void_reason),
   json_object('id',NEW.id,'school_id',NEW.school_id,'academic_year_id',NEW.academic_year_id,'register_key',NEW.register_key,
     'entry_date',NEW.entry_date,'title',NEW.title,'data',json(NEW.data_json),'status',NEW.status,'version',NEW.version,
     'created_at',NEW.created_at,'updated_at',NEW.updated_at,'void_reason',NEW.void_reason));
END;
CREATE TRIGGER school_register_entries_no_delete BEFORE DELETE ON school_register_entries BEGIN
 SELECT RAISE(ABORT,'school_register_history_immutable');
END;
CREATE TRIGGER school_register_history_no_update BEFORE UPDATE ON school_register_history BEGIN
 SELECT RAISE(ABORT,'school_register_history_immutable');
END;
CREATE TRIGGER school_register_history_no_delete BEFORE DELETE ON school_register_history BEGIN
 SELECT RAISE(ABORT,'school_register_history_immutable');
END;
