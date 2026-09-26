-- Versioned, sourced school regulations. No statutory numbers are seeded.
CREATE TABLE admission_regulations (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 regulation_key TEXT NOT NULL UNIQUE CHECK(length(regulation_key)=36),
 school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
 academic_year_id INTEGER NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
 class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE RESTRICT,
 process TEXT NOT NULL CHECK(process IN ('admission','transfer_in','transfer_out')),
 version INTEGER NOT NULL CHECK(version>0),
 title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 200),
 jurisdiction TEXT NOT NULL CHECK(length(trim(jurisdiction)) BETWEEN 1 AND 120),
 source_reference TEXT NOT NULL CHECK(length(trim(source_reference)) BETWEEN 1 AND 250),
 source_url TEXT NOT NULL CHECK(length(source_url) BETWEEN 8 AND 1000),
 effective_from TEXT NOT NULL, effective_to TEXT NOT NULL CHECK(effective_to>=effective_from),
 rules_json TEXT NOT NULL CHECK(json_valid(rules_json)),
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','retired')),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
 created_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 updated_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 change_reason TEXT,
 created_at INTEGER NOT NULL DEFAULT(unixepoch()),
 UNIQUE(school_id,academic_year_id,class_id,process,version)
);
CREATE UNIQUE INDEX idx_one_approved_admission_regulation ON admission_regulations(school_id,academic_year_id,class_id,process) WHERE status='approved';
CREATE TABLE admission_regulation_audit (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 regulation_id INTEGER NOT NULL REFERENCES admission_regulations(id) ON DELETE RESTRICT,
 actor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 action TEXT NOT NULL CHECK(action IN ('draft','approved','retired')),
 reason TEXT, created_at INTEGER NOT NULL DEFAULT(unixepoch())
);
CREATE TRIGGER regulation_validate_insert BEFORE INSERT ON admission_regulations BEGIN
 SELECT RAISE(ABORT,'regulation_scope_invalid') WHERE NOT EXISTS(SELECT 1 FROM academic_years y JOIN classes c ON c.school_id=y.school_id
 WHERE y.id=NEW.academic_year_id AND c.id=NEW.class_id AND y.school_id=NEW.school_id AND c.status='active');
 SELECT RAISE(ABORT,'regulation_draft_required') WHERE NEW.status<>'draft' OR NEW.revision<>1;
END;
CREATE TRIGGER regulation_identity_immutable BEFORE UPDATE ON admission_regulations BEGIN
 SELECT RAISE(ABORT,'regulation_immutable_or_transition_invalid') WHERE NEW.id<>OLD.id OR NEW.regulation_key<>OLD.regulation_key OR NEW.school_id<>OLD.school_id
 OR NEW.academic_year_id<>OLD.academic_year_id OR NEW.class_id<>OLD.class_id OR NEW.process<>OLD.process OR NEW.version<>OLD.version
 OR NEW.title<>OLD.title OR NEW.jurisdiction<>OLD.jurisdiction OR NEW.source_reference<>OLD.source_reference OR NEW.source_url<>OLD.source_url
 OR NEW.effective_from<>OLD.effective_from OR NEW.effective_to<>OLD.effective_to OR NEW.rules_json<>OLD.rules_json
 OR NEW.created_by_user_id<>OLD.created_by_user_id OR NEW.created_at<>OLD.created_at OR NEW.revision<>OLD.revision+1
 OR NOT ((OLD.status='draft' AND NEW.status='approved') OR (OLD.status='approved' AND NEW.status='retired'))
 OR NEW.change_reason IS NULL OR length(trim(NEW.change_reason))=0;
END;
CREATE TRIGGER regulation_created_audit AFTER INSERT ON admission_regulations BEGIN
 INSERT INTO admission_regulation_audit(regulation_id,actor_user_id,action) VALUES(NEW.id,NEW.created_by_user_id,'draft');
END;
CREATE TRIGGER regulation_updated_audit AFTER UPDATE ON admission_regulations BEGIN
 INSERT INTO admission_regulation_audit(regulation_id,actor_user_id,action,reason) VALUES(NEW.id,NEW.updated_by_user_id,NEW.status,NEW.change_reason);
END;
CREATE TRIGGER regulation_no_delete BEFORE DELETE ON admission_regulations BEGIN SELECT RAISE(ABORT,'regulation_immutable'); END;
CREATE TRIGGER regulation_audit_no_update BEFORE UPDATE ON admission_regulation_audit BEGIN SELECT RAISE(ABORT,'regulation_immutable'); END;
CREATE TRIGGER regulation_audit_no_delete BEFORE DELETE ON admission_regulation_audit BEGIN SELECT RAISE(ABORT,'regulation_immutable'); END;
