-- Per-school subscription: plan (which modules), validity dates with a grace
-- period, manual suspension and an optional cap on active students.
-- Existing schools start on the full plan with no end date, so nothing changes
-- for them until the system admin edits their subscription.
CREATE TABLE school_subscriptions (
  school_id INTEGER PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
  plan_key TEXT NOT NULL DEFAULT 'full' CHECK(plan_key IN ('basic','standard','full')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),
  starts_on TEXT CHECK(starts_on IS NULL OR (length(starts_on)=10 AND date(starts_on)=starts_on)),
  ends_on TEXT CHECK(ends_on IS NULL OR (length(ends_on)=10 AND date(ends_on)=ends_on)),
  grace_days INTEGER NOT NULL DEFAULT 14 CHECK(typeof(grace_days)='integer' AND grace_days BETWEEN 0 AND 90),
  max_students INTEGER CHECK(max_students IS NULL OR (typeof(max_students)='integer' AND max_students BETWEEN 1 AND 100000)),
  notes TEXT CHECK(notes IS NULL OR length(notes)<=1000),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(typeof(revision)='integer' AND revision>0),
  updated_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  CHECK(starts_on IS NULL OR ends_on IS NULL OR ends_on>=starts_on)
);

-- Explicit per-school exceptions to the plan's module list.
CREATE TABLE school_module_overrides (
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  module_key TEXT NOT NULL CHECK(module_key IN (
    'grades','official_documents','timetable','attendance','homework','communication',
    'admissions','finance','staff_payroll','transport','school_registers'
  )),
  is_enabled INTEGER NOT NULL CHECK(is_enabled IN (0,1)),
  PRIMARY KEY(school_id, module_key)
);

CREATE TABLE school_subscription_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  before_json TEXT,
  after_json TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_school_subscription_audit_school ON school_subscription_audit(school_id, id);

CREATE TRIGGER trg_school_subscription_audit_immutable BEFORE UPDATE ON school_subscription_audit BEGIN
  SELECT RAISE(ABORT,'school_subscription_audit_immutable');
END;

INSERT INTO school_subscriptions(school_id) SELECT id FROM schools;

CREATE TRIGGER trg_school_subscription_default AFTER INSERT ON schools BEGIN
  INSERT OR IGNORE INTO school_subscriptions(school_id) VALUES (NEW.id);
END;

-- The cap counts active students only and applies to every write path
-- (manual entry, Excel import, admissions, reactivation, school transfer).
CREATE TRIGGER trg_students_subscription_cap_insert BEFORE INSERT ON students
WHEN NEW.status='active' BEGIN
  SELECT RAISE(ABORT,'school_student_limit_reached') WHERE EXISTS (
    SELECT 1 FROM school_subscriptions sub
    WHERE sub.school_id=NEW.school_id AND sub.max_students IS NOT NULL
      AND (SELECT COUNT(*) FROM students st WHERE st.school_id=NEW.school_id AND st.status='active')>=sub.max_students);
END;

CREATE TRIGGER trg_students_subscription_cap_update BEFORE UPDATE OF status, school_id ON students
WHEN NEW.status='active' AND (OLD.status IS NOT 'active' OR NEW.school_id!=OLD.school_id) BEGIN
  SELECT RAISE(ABORT,'school_student_limit_reached') WHERE EXISTS (
    SELECT 1 FROM school_subscriptions sub
    WHERE sub.school_id=NEW.school_id AND sub.max_students IS NOT NULL
      AND (SELECT COUNT(*) FROM students st WHERE st.school_id=NEW.school_id AND st.status='active')>=sub.max_students);
END;
