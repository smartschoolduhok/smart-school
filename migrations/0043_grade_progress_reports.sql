-- Interim progress publications never update official grades/result cards.
CREATE TABLE grade_progress_reports (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 report_key TEXT NOT NULL UNIQUE CHECK(length(report_key)=36),
 school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
 student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
 academic_year_id INTEGER NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
 period TEXT NOT NULL CHECK(period IN ('first_month','second_month','first_term','mid_year_exam','third_month','fourth_month','second_term')),
 snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
 source_json TEXT NOT NULL CHECK(json_valid(source_json)),
 source_digest TEXT NOT NULL CHECK(length(source_digest)=64),
 status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('published','withdrawn')),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
 delivered_to_student INTEGER NOT NULL CHECK(delivered_to_student=1),
 created_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 updated_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 withdrawal_reason TEXT,
 created_at INTEGER NOT NULL DEFAULT(unixepoch()),
 CHECK((status='published' AND withdrawal_reason IS NULL) OR (status='withdrawn' AND length(trim(withdrawal_reason)) BETWEEN 1 AND 500))
);
CREATE INDEX idx_grade_progress_student ON grade_progress_reports(school_id,student_id,academic_year_id,created_at);
CREATE TABLE grade_progress_audit (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 report_id INTEGER NOT NULL REFERENCES grade_progress_reports(id) ON DELETE RESTRICT,
 actor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 action TEXT NOT NULL CHECK(action IN ('published','withdrawn')), reason TEXT,
 created_at INTEGER NOT NULL DEFAULT(unixepoch())
);
CREATE TABLE workflow_write_guards(token TEXT PRIMARY KEY,valid INTEGER NOT NULL CONSTRAINT workflow_write_guard CHECK(valid=1));
CREATE TRIGGER grade_progress_valid_insert BEFORE INSERT ON grade_progress_reports BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM students s JOIN academic_years y ON y.school_id=s.school_id
 WHERE s.id=NEW.student_id AND s.school_id=NEW.school_id AND y.id=NEW.academic_year_id)
 THEN RAISE(ABORT,'grade_progress_tenant_invalid') END;
END;
CREATE TRIGGER grade_progress_immutable BEFORE UPDATE ON grade_progress_reports BEGIN
 SELECT CASE WHEN NEW.id<>OLD.id OR NEW.report_key<>OLD.report_key OR NEW.school_id<>OLD.school_id OR NEW.student_id<>OLD.student_id
 OR NEW.academic_year_id<>OLD.academic_year_id OR NEW.period<>OLD.period OR NEW.snapshot_json<>OLD.snapshot_json OR NEW.source_json<>OLD.source_json
 OR NEW.source_digest<>OLD.source_digest OR NEW.created_by_user_id<>OLD.created_by_user_id OR NEW.created_at<>OLD.created_at
 OR NEW.delivered_to_student<>OLD.delivered_to_student OR OLD.status<>'published' OR NEW.status<>'withdrawn' OR NEW.revision<>OLD.revision+1
 THEN RAISE(ABORT,'grade_progress_immutable') END;
END;
CREATE TRIGGER grade_progress_publish_audit AFTER INSERT ON grade_progress_reports BEGIN
 INSERT INTO grade_progress_audit(report_id,actor_user_id,action) VALUES(NEW.id,NEW.created_by_user_id,'published');
END;
CREATE TRIGGER grade_progress_withdraw_audit AFTER UPDATE ON grade_progress_reports BEGIN
 INSERT INTO grade_progress_audit(report_id,actor_user_id,action,reason) VALUES(NEW.id,NEW.updated_by_user_id,'withdrawn',NEW.withdrawal_reason);
 UPDATE school_notifications SET status='withdrawn',withdrawn_at=unixepoch() WHERE notification_key=NEW.report_key;
END;
CREATE TRIGGER grade_progress_no_delete BEFORE DELETE ON grade_progress_reports BEGIN SELECT RAISE(ABORT,'grade_progress_immutable'); END;
CREATE TRIGGER grade_progress_audit_no_update BEFORE UPDATE ON grade_progress_audit BEGIN SELECT RAISE(ABORT,'grade_progress_immutable'); END;
CREATE TRIGGER grade_progress_audit_no_delete BEFORE DELETE ON grade_progress_audit BEGIN SELECT RAISE(ABORT,'grade_progress_immutable'); END;
