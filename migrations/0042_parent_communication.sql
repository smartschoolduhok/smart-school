-- Private student/parent/staff conversations. Authorization is derived from
-- current links and teaching loads, never from a historical membership alone.
CREATE VIEW communication_contacts AS
SELECT DISTINCT s.school_id, s.id AS student_id, s.full_name AS student_name,
 e.academic_year_id, p.id AS parent_user_id, p.full_name AS parent_name,
 staff.id AS staff_user_id, staff.full_name AS staff_name, role.key AS staff_role
FROM students s
JOIN schools school ON school.id=s.school_id AND school.status='active'
JOIN student_enrollments e ON e.student_id=s.id AND e.school_id=s.school_id AND e.status='active'
JOIN academic_years y ON y.id=e.academic_year_id AND y.school_id=s.school_id AND y.is_active=1
JOIN classes cl ON cl.id=e.class_id AND cl.school_id=s.school_id AND cl.status='active'
JOIN parent_student_links link ON link.student_id=s.id AND link.school_id=s.school_id AND link.status='active'
JOIN users p ON p.id=link.parent_user_id AND p.school_id=s.school_id AND p.status='active'
JOIN roles pr ON pr.id=p.role_id AND pr.key='parent'
JOIN users staff ON staff.school_id=s.school_id AND staff.status='active'
JOIN roles role ON role.id=staff.role_id
WHERE s.status='active' AND (
 role.key IN ('school_owner','principal','vice_principal','registrar') OR
 (role.key='teacher' AND EXISTS (
  SELECT 1 FROM teacher_employee_links tl
  JOIN employees employee ON employee.id=tl.employee_id AND employee.school_id=tl.school_id
   AND employee.status='active' AND employee.role='teacher'
  JOIN timetable_teaching_loads load ON load.employee_id=employee.id AND load.school_id=s.school_id
   AND load.academic_year_id=y.id AND load.class_id=e.class_id AND load.section_id IS e.section_id AND load.status='active'
  JOIN subjects subject ON subject.id=load.subject_id AND subject.school_id=s.school_id AND subject.class_id=e.class_id
   AND (subject.section_id IS NULL OR subject.section_id=e.section_id) AND subject.status='active'
  JOIN student_subjects assignment ON assignment.student_id=s.id AND assignment.school_id=s.school_id
   AND assignment.subject_id=subject.id AND assignment.class_id=e.class_id
   AND assignment.section_id IS e.section_id AND assignment.is_active=1
  WHERE tl.teacher_user_id=staff.id AND tl.school_id=s.school_id AND tl.status='active'
   AND (e.section_id IS NULL OR EXISTS (SELECT 1 FROM sections sec WHERE sec.id=e.section_id AND sec.school_id=s.school_id AND sec.class_id=e.class_id AND sec.status='active'))
 )));

CREATE TABLE parent_conversations (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 conversation_key TEXT NOT NULL UNIQUE CHECK(length(conversation_key)=36),
 school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
 student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
 academic_year_id INTEGER NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
 parent_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 staff_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 student_name TEXT NOT NULL, parent_name TEXT NOT NULL, staff_name TEXT NOT NULL,
 title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 160),
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
 created_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 updated_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 status_reason TEXT CHECK(status_reason IS NULL OR length(trim(status_reason)) BETWEEN 1 AND 500),
 created_at INTEGER NOT NULL DEFAULT(unixepoch()),
 updated_at INTEGER NOT NULL DEFAULT(unixepoch())
);
CREATE INDEX idx_parent_conversations_scope ON parent_conversations(school_id,student_id,parent_user_id,staff_user_id,updated_at);
CREATE TABLE parent_messages (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 message_key TEXT NOT NULL UNIQUE CHECK(length(message_key)=36),
 conversation_id INTEGER NOT NULL REFERENCES parent_conversations(id) ON DELETE RESTRICT,
 school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
 sender_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 sender_name TEXT NOT NULL,
 body TEXT NOT NULL CHECK(length(trim(body)) BETWEEN 1 AND 4000),
 thread_revision INTEGER NOT NULL CHECK(thread_revision>0),
 created_at INTEGER NOT NULL DEFAULT(unixepoch()),
 UNIQUE(conversation_id,thread_revision)
);
CREATE INDEX idx_parent_messages_thread ON parent_messages(conversation_id,id);
CREATE TABLE parent_conversation_reads (
 conversation_id INTEGER NOT NULL REFERENCES parent_conversations(id) ON DELETE RESTRICT,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 last_message_id INTEGER NOT NULL REFERENCES parent_messages(id) ON DELETE RESTRICT,
 read_at INTEGER NOT NULL DEFAULT(unixepoch()),
 PRIMARY KEY(conversation_id,user_id)
);
CREATE TABLE parent_conversation_audit (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 conversation_id INTEGER NOT NULL REFERENCES parent_conversations(id) ON DELETE RESTRICT,
 actor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 action TEXT NOT NULL CHECK(action IN ('created','message','closed','reopened')),
 revision INTEGER NOT NULL,
 reason TEXT,
 created_at INTEGER NOT NULL DEFAULT(unixepoch())
);
CREATE TABLE communication_write_guards(token TEXT PRIMARY KEY, valid INTEGER NOT NULL CONSTRAINT communication_guard CHECK(valid=1));

CREATE TRIGGER communication_thread_insert BEFORE INSERT ON parent_conversations BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM communication_contacts c WHERE c.school_id=NEW.school_id
  AND c.student_id=NEW.student_id AND c.academic_year_id=NEW.academic_year_id
  AND c.parent_user_id=NEW.parent_user_id AND c.staff_user_id=NEW.staff_user_id)
 THEN RAISE(ABORT,'communication_access_changed') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=NEW.created_by_user_id AND u.status='active'
  AND (r.key='system_admin' OR (u.school_id=NEW.school_id AND (u.id IN (NEW.parent_user_id,NEW.staff_user_id) OR r.key IN ('school_owner','principal','vice_principal')))))
 THEN RAISE(ABORT,'communication_access_changed') END;
END;
CREATE TRIGGER communication_thread_created AFTER INSERT ON parent_conversations BEGIN
 INSERT INTO parent_conversation_audit(conversation_id,actor_user_id,action,revision) VALUES(NEW.id,NEW.created_by_user_id,'created',NEW.revision);
END;
CREATE TRIGGER communication_thread_update BEFORE UPDATE ON parent_conversations BEGIN
 SELECT CASE WHEN NEW.id<>OLD.id OR NEW.conversation_key<>OLD.conversation_key OR NEW.school_id<>OLD.school_id
  OR NEW.student_id<>OLD.student_id OR NEW.academic_year_id<>OLD.academic_year_id OR NEW.parent_user_id<>OLD.parent_user_id
  OR NEW.staff_user_id<>OLD.staff_user_id OR NEW.title<>OLD.title OR NEW.student_name<>OLD.student_name
  OR NEW.parent_name<>OLD.parent_name OR NEW.staff_name<>OLD.staff_name OR NEW.created_by_user_id<>OLD.created_by_user_id
  OR NEW.created_at<>OLD.created_at OR NEW.revision<>OLD.revision+1
 THEN RAISE(ABORT,'communication_history_immutable') END;
 SELECT CASE WHEN NEW.status<>OLD.status AND (NEW.status_reason IS NULL OR length(trim(NEW.status_reason))=0)
 THEN RAISE(ABORT,'communication_reason_required') END;
END;
CREATE TRIGGER communication_status_audit AFTER UPDATE OF status ON parent_conversations WHEN NEW.status<>OLD.status BEGIN
 INSERT INTO parent_conversation_audit(conversation_id,actor_user_id,action,revision,reason)
 VALUES(NEW.id,NEW.updated_by_user_id, CASE NEW.status WHEN 'closed' THEN 'closed' ELSE 'reopened' END ,NEW.revision,NEW.status_reason);
END;
CREATE TRIGGER communication_message_insert BEFORE INSERT ON parent_messages BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM parent_conversations t
 JOIN communication_contacts c ON c.school_id=t.school_id AND c.student_id=t.student_id AND c.academic_year_id=t.academic_year_id
  AND c.parent_user_id=t.parent_user_id AND c.staff_user_id=t.staff_user_id
 JOIN users u ON u.id=NEW.sender_user_id AND u.status='active' JOIN roles r ON r.id=u.role_id
 WHERE t.id=NEW.conversation_id AND t.school_id=NEW.school_id AND t.status='open' AND t.revision=NEW.thread_revision
  AND (r.key='system_admin' OR (u.school_id=t.school_id AND (u.id IN (t.parent_user_id,t.staff_user_id) OR r.key IN ('school_owner','principal','vice_principal')))))
 THEN RAISE(ABORT,'communication_access_or_revision_changed') END;
END;
CREATE TRIGGER communication_message_created AFTER INSERT ON parent_messages BEGIN
 UPDATE parent_conversations SET revision=revision+1,updated_by_user_id=NEW.sender_user_id,updated_at=unixepoch() WHERE id=NEW.conversation_id;
 INSERT INTO parent_conversation_audit(conversation_id,actor_user_id,action,revision)
 VALUES(NEW.conversation_id,NEW.sender_user_id,'message',NEW.thread_revision+1);
 INSERT INTO school_notifications(notification_key,school_id,student_id,notification_type,title,body,reference_type,reference_key,created_by_user_id)
 SELECT NEW.message_key,t.school_id,t.student_id,'parent_message','رسالة جديدة','لديك رسالة جديدة في تواصل ولي الأمر','parent_conversation',t.conversation_key,NEW.sender_user_id
 FROM parent_conversations t WHERE t.id=NEW.conversation_id;
 INSERT INTO notification_recipients(notification_key,school_id,user_id)
 SELECT NEW.message_key,t.school_id, CASE WHEN NEW.sender_user_id=t.parent_user_id THEN t.staff_user_id ELSE t.parent_user_id END
 FROM parent_conversations t WHERE t.id=NEW.conversation_id;
END;
CREATE TRIGGER communication_message_no_update BEFORE UPDATE ON parent_messages BEGIN SELECT RAISE(ABORT,'communication_history_immutable'); END;
CREATE TRIGGER communication_message_no_delete BEFORE DELETE ON parent_messages BEGIN SELECT RAISE(ABORT,'communication_history_immutable'); END;
CREATE TRIGGER communication_thread_no_delete BEFORE DELETE ON parent_conversations BEGIN SELECT RAISE(ABORT,'communication_history_immutable'); END;
CREATE TRIGGER communication_audit_no_update BEFORE UPDATE ON parent_conversation_audit BEGIN SELECT RAISE(ABORT,'communication_history_immutable'); END;
CREATE TRIGGER communication_audit_no_delete BEFORE DELETE ON parent_conversation_audit BEGIN SELECT RAISE(ABORT,'communication_history_immutable'); END;
CREATE TRIGGER communication_read_insert BEFORE INSERT ON parent_conversation_reads BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM parent_messages m WHERE m.id=NEW.last_message_id AND m.conversation_id=NEW.conversation_id)
 THEN RAISE(ABORT,'communication_read_invalid') END;
END;
CREATE TRIGGER communication_read_update BEFORE UPDATE ON parent_conversation_reads BEGIN
 SELECT CASE WHEN NEW.conversation_id<>OLD.conversation_id OR NEW.user_id<>OLD.user_id OR NEW.last_message_id<OLD.last_message_id
  OR NOT EXISTS(SELECT 1 FROM parent_messages m WHERE m.id=NEW.last_message_id AND m.conversation_id=NEW.conversation_id)
 THEN RAISE(ABORT,'communication_read_invalid') END;
END;
