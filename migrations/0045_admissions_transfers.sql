-- Applications carry evidence and approval snapshots; execution preserves
-- business history and never moves a student identity across school tenants.
CREATE TABLE admission_applications (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 application_key TEXT NOT NULL UNIQUE CHECK(length(application_key)=36),
 school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
 student_id INTEGER REFERENCES students(id) ON DELETE RESTRICT,
 applicant_json TEXT CHECK(applicant_json IS NULL OR json_valid(applicant_json)),
 academic_year_id INTEGER NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
 class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE RESTRICT,
 section_id INTEGER REFERENCES sections(id) ON DELETE RESTRICT,
 process TEXT NOT NULL CHECK(process IN ('admission','transfer_in','transfer_out')),
 external_school TEXT, document_reference TEXT,
 facts_json TEXT NOT NULL CHECK(json_valid(facts_json)),
 status TEXT NOT NULL DEFAULT 'submitted' CHECK(status IN ('submitted','approved','rejected','cancelled','executed')),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
 regulation_id INTEGER REFERENCES admission_regulations(id) ON DELETE RESTRICT,
 approved_digest TEXT CHECK(approved_digest IS NULL OR length(approved_digest)=64),
 approval_snapshot TEXT CHECK(approval_snapshot IS NULL OR json_valid(approval_snapshot)),
 created_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 updated_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 action_reason TEXT,
 created_at INTEGER NOT NULL DEFAULT(unixepoch()),
 updated_at INTEGER NOT NULL DEFAULT(unixepoch()),
 CHECK(student_id IS NOT NULL OR applicant_json IS NOT NULL),
 CHECK(process<>'transfer_out' OR student_id IS NOT NULL),
 CHECK(process='admission' OR (length(trim(external_school))>0 AND length(trim(document_reference))>0)),
 CHECK(status NOT IN ('approved','executed') OR (regulation_id IS NOT NULL AND approved_digest IS NOT NULL AND approval_snapshot IS NOT NULL))
);
CREATE INDEX idx_admission_application_scope ON admission_applications(school_id,status,id);
CREATE UNIQUE INDEX idx_admission_active_request ON admission_applications(school_id,student_id,academic_year_id,process) WHERE student_id IS NOT NULL AND status IN ('submitted','approved');
CREATE TABLE admission_application_audit (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 application_id INTEGER NOT NULL REFERENCES admission_applications(id) ON DELETE RESTRICT,
 actor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 old_status TEXT, new_status TEXT NOT NULL,
 revision INTEGER NOT NULL,
 reason TEXT, facts_json TEXT NOT NULL, approval_snapshot TEXT,
 created_at INTEGER NOT NULL DEFAULT(unixepoch())
);
CREATE TRIGGER admission_application_insert BEFORE INSERT ON admission_applications BEGIN
 SELECT RAISE(ABORT,'admission_scope_invalid') WHERE NOT EXISTS(SELECT 1 FROM academic_years y JOIN classes c ON c.school_id=y.school_id WHERE y.id=NEW.academic_year_id AND c.id=NEW.class_id AND y.school_id=NEW.school_id AND c.status='active')
 OR (NEW.student_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM students s WHERE s.id=NEW.student_id AND s.school_id=NEW.school_id))
 OR (NEW.section_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM sections s WHERE s.id=NEW.section_id AND s.class_id=NEW.class_id AND s.school_id=NEW.school_id AND s.status='active'))
 OR NEW.status<>'submitted' OR NEW.revision<>1;
END;
CREATE TRIGGER admission_application_update BEFORE UPDATE ON admission_applications BEGIN
 SELECT RAISE(ABORT,'admission_history_or_transition_invalid') WHERE NEW.id<>OLD.id OR NEW.application_key<>OLD.application_key OR NEW.school_id<>OLD.school_id OR NEW.academic_year_id<>OLD.academic_year_id
 OR NEW.class_id<>OLD.class_id OR NEW.section_id IS NOT OLD.section_id OR NEW.process<>OLD.process OR NEW.applicant_json IS NOT OLD.applicant_json
 OR NEW.external_school IS NOT OLD.external_school OR NEW.document_reference IS NOT OLD.document_reference
 OR NEW.created_by_user_id<>OLD.created_by_user_id OR NEW.created_at<>OLD.created_at OR NEW.revision<>OLD.revision+1
 OR (NEW.student_id IS NOT OLD.student_id AND NOT (OLD.student_id IS NULL AND OLD.status='approved' AND NEW.status='executed' AND EXISTS(SELECT 1 FROM students s WHERE s.id=NEW.student_id AND s.school_id=NEW.school_id AND s.student_number=json_extract(OLD.applicant_json,'$.student_number'))))
 OR NOT ((OLD.status='submitted' AND NEW.status IN ('submitted','approved','rejected','cancelled')) OR (OLD.status='approved' AND NEW.status IN ('submitted','executed','cancelled')))
 OR (OLD.status<>'submitted' AND NEW.facts_json<>OLD.facts_json)
 OR NEW.action_reason IS NULL OR length(trim(NEW.action_reason))=0;
END;
CREATE TRIGGER admission_application_created AFTER INSERT ON admission_applications BEGIN
 INSERT INTO admission_application_audit(application_id,actor_user_id,new_status,revision,facts_json) VALUES(NEW.id,NEW.created_by_user_id,NEW.status,NEW.revision,NEW.facts_json);
END;
CREATE TRIGGER admission_application_changed AFTER UPDATE ON admission_applications BEGIN
 INSERT INTO admission_application_audit(application_id,actor_user_id,old_status,new_status,revision,reason,facts_json,approval_snapshot)
 VALUES(NEW.id,NEW.updated_by_user_id,OLD.status,NEW.status,NEW.revision,NEW.action_reason,NEW.facts_json,NEW.approval_snapshot);
END;
CREATE TRIGGER admission_application_no_delete BEFORE DELETE ON admission_applications BEGIN SELECT RAISE(ABORT,'admission_history_immutable'); END;
CREATE TRIGGER admission_audit_no_delete BEFORE DELETE ON admission_application_audit BEGIN SELECT RAISE(ABORT,'admission_history_immutable'); END;
CREATE TRIGGER admission_audit_no_update BEFORE UPDATE ON admission_application_audit BEGIN SELECT RAISE(ABORT,'admission_history_immutable'); END;
