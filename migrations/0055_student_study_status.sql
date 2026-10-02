-- Annual settings exist independently of enrollment so documented applicants can
-- receive an age exception before their admission creates an enrollment.
CREATE TABLE student_study_status (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
 student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
 academic_year_id INTEGER NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
 study_status TEXT NOT NULL DEFAULT 'regular' CHECK(study_status IN ('regular','hosted','affiliated')),
 grades_visible INTEGER NOT NULL DEFAULT 1 CHECK(grades_visible IN (0,1)),
 age_exception_json TEXT CHECK(age_exception_json IS NULL OR (json_valid(age_exception_json) AND json_type(age_exception_json)='object')),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
 updated_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 change_reason TEXT NOT NULL CHECK(length(trim(change_reason)) BETWEEN 1 AND 500),
 updated_at INTEGER NOT NULL DEFAULT(unixepoch()),
 UNIQUE(school_id,student_id,academic_year_id)
);
CREATE INDEX idx_student_study_status_year ON student_study_status(school_id,academic_year_id,student_id);
CREATE TABLE student_study_status_audit (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 study_status_id INTEGER NOT NULL REFERENCES student_study_status(id) ON DELETE RESTRICT,
 actor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 revision INTEGER NOT NULL,
 reason TEXT NOT NULL,
 before_json TEXT, after_json TEXT NOT NULL,
 changed_at INTEGER NOT NULL DEFAULT(unixepoch())
);
CREATE INDEX idx_student_study_status_audit_record ON student_study_status_audit(study_status_id,id);
CREATE TRIGGER student_study_status_scope_insert BEFORE INSERT ON student_study_status BEGIN
 SELECT RAISE(ABORT,'admission_study_status_scope') WHERE NEW.revision<>1
 OR NOT EXISTS(SELECT 1 FROM students WHERE id=NEW.student_id AND school_id=NEW.school_id)
 OR NOT EXISTS(SELECT 1 FROM academic_years WHERE id=NEW.academic_year_id AND school_id=NEW.school_id)
 OR NOT EXISTS(SELECT 1 FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=NEW.updated_by_user_id AND u.status='active' AND (r.key='system_admin' OR (u.school_id=NEW.school_id AND r.key IN ('school_owner','principal','vice_principal'))));
END;
CREATE TRIGGER student_study_status_scope_update BEFORE UPDATE ON student_study_status BEGIN
 SELECT RAISE(ABORT,'admission_study_status_scope') WHERE NEW.id<>OLD.id OR NEW.school_id<>OLD.school_id OR NEW.student_id<>OLD.student_id OR NEW.academic_year_id<>OLD.academic_year_id OR NEW.revision<>OLD.revision+1
 OR NOT EXISTS(SELECT 1 FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=NEW.updated_by_user_id AND u.status='active' AND (r.key='system_admin' OR (u.school_id=NEW.school_id AND r.key IN ('school_owner','principal','vice_principal'))));
END;
CREATE TRIGGER student_study_status_created AFTER INSERT ON student_study_status BEGIN
 INSERT INTO student_study_status_audit(study_status_id,actor_user_id,revision,reason,before_json,after_json)
 VALUES(NEW.id,NEW.updated_by_user_id,NEW.revision,NEW.change_reason,NULL,json_object('study_status',NEW.study_status,'grades_visible',NEW.grades_visible,'age_exception',json(NEW.age_exception_json),'revision',NEW.revision));
END;
CREATE TRIGGER student_study_status_changed AFTER UPDATE ON student_study_status BEGIN
 INSERT INTO student_study_status_audit(study_status_id,actor_user_id,revision,reason,before_json,after_json)
 VALUES(NEW.id,NEW.updated_by_user_id,NEW.revision,NEW.change_reason,json_object('study_status',OLD.study_status,'grades_visible',OLD.grades_visible,'age_exception',json(OLD.age_exception_json),'revision',OLD.revision),json_object('study_status',NEW.study_status,'grades_visible',NEW.grades_visible,'age_exception',json(NEW.age_exception_json),'revision',NEW.revision));
END;
CREATE TRIGGER student_study_status_no_delete BEFORE DELETE ON student_study_status BEGIN SELECT RAISE(ABORT,'admission_study_status_history_immutable'); END;
CREATE TRIGGER student_study_status_audit_no_update BEFORE UPDATE ON student_study_status_audit BEGIN SELECT RAISE(ABORT,'admission_study_status_history_immutable'); END;
CREATE TRIGGER student_study_status_audit_no_delete BEFORE DELETE ON student_study_status_audit BEGIN SELECT RAISE(ABORT,'admission_study_status_history_immutable'); END;

-- Promotion reads an exact published result first, then commits its decision.
-- A concurrent visibility change must abort that whole transaction.
CREATE TRIGGER student_promotion_visible_grade_source BEFORE INSERT ON student_promotion_result_decisions BEGIN
 SELECT RAISE(ABORT,'official_result_stale') WHERE EXISTS(
   SELECT 1 FROM student_enrollments source JOIN student_study_status visibility
     ON visibility.school_id=source.school_id AND visibility.student_id=source.student_id
    AND visibility.academic_year_id=source.academic_year_id
   WHERE source.id=NEW.source_enrollment_id AND source.school_id=NEW.school_id AND visibility.grades_visible=0
 );
END;
