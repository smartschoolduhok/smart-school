-- ============================================================
-- نظام المدرسة الذكي - Smart School System
-- Phase 2: Academic Data Foundation
-- Tables: classes, sections, students, subjects
-- Compatible with Cloudflare D1 (SQLite)
-- ============================================================

-- TABLE: classes
-- Represents grade levels (e.g., الصف الأول, الصف الثاني)
CREATE TABLE IF NOT EXISTS classes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id     INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  stage         TEXT NOT NULL, -- روضة, ابتدائي, متوسط, إعدادي, ثانوي
  order_index   INTEGER DEFAULT 0,
  status        TEXT DEFAULT 'active',
  created_at    INTEGER DEFAULT (unixepoch()),
  updated_at    INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_classes_school_id ON classes(school_id);
CREATE INDEX IF NOT EXISTS idx_classes_status ON classes(status);

-- TABLE: sections
-- Represents class divisions (e.g., شعبة أ, شعبة ب)
CREATE TABLE IF NOT EXISTS sections (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id     INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  class_id      INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  capacity      INTEGER DEFAULT 30,
  status        TEXT DEFAULT 'active',
  created_at    INTEGER DEFAULT (unixepoch()),
  updated_at    INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_sections_school_id ON sections(school_id);
CREATE INDEX IF NOT EXISTS idx_sections_class_id ON sections(class_id);
CREATE INDEX IF NOT EXISTS idx_sections_status ON sections(status);

-- TABLE: students
-- Student records per school
CREATE TABLE IF NOT EXISTS students (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id       INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_number  TEXT NOT NULL,
  full_name       TEXT NOT NULL,
  father_name     TEXT,
  mother_name     TEXT,
  gender          TEXT NOT NULL, -- ذكر, أنثى
  birth_date      TEXT,
  phone           TEXT,
  guardian_name   TEXT,
  guardian_phone  TEXT,
  address         TEXT,
  class_id        INTEGER REFERENCES classes(id) ON DELETE SET NULL,
  section_id      INTEGER REFERENCES sections(id) ON DELETE SET NULL,
  status          TEXT DEFAULT 'active',
  photo_url       TEXT,
  notes           TEXT,
  created_at      INTEGER DEFAULT (unixepoch()),
  updated_at      INTEGER DEFAULT (unixepoch()),
  UNIQUE(school_id, student_number)
);

CREATE INDEX IF NOT EXISTS idx_students_school_id ON students(school_id);
CREATE INDEX IF NOT EXISTS idx_students_class_id ON students(class_id);
CREATE INDEX IF NOT EXISTS idx_students_section_id ON students(section_id);
CREATE INDEX IF NOT EXISTS idx_students_status ON students(status);
CREATE INDEX IF NOT EXISTS idx_students_student_number ON students(student_number);

-- TABLE: subjects
-- Subjects linked to classes and optionally sections
CREATE TABLE IF NOT EXISTS subjects (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id               INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  class_id                INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  section_id              INTEGER REFERENCES sections(id) ON DELETE SET NULL,
  name                    TEXT NOT NULL,
  subject_type            TEXT DEFAULT 'أساسية', -- أساسية, اختيارية
  counts_in_average       INTEGER DEFAULT 1, -- 1 = yes, 0 = no
  appears_in_report_card  INTEGER DEFAULT 1, -- 1 = yes, 0 = no
  passing_grade           REAL DEFAULT 50,
  exemption_grade         REAL DEFAULT 25,
  order_index             INTEGER DEFAULT 0,
  status                  TEXT DEFAULT 'active',
  created_at              INTEGER DEFAULT (unixepoch()),
  updated_at              INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_subjects_school_id ON subjects(school_id);
CREATE INDEX IF NOT EXISTS idx_subjects_class_id ON subjects(class_id);
CREATE INDEX IF NOT EXISTS idx_subjects_section_id ON subjects(section_id);
CREATE INDEX IF NOT EXISTS idx_subjects_status ON subjects(status);

-- ============================================================
-- Seed Data for Phase 2 (linked to existing schools)
-- ============================================================

-- Seed: classes for school_id = 1 (مدرسة النخبة الأهلية)
INSERT OR IGNORE INTO classes (id, school_id, name, stage, order_index, status) VALUES
  (1, 1, 'الصف الأول الابتدائي', 'ابتدائي', 1, 'active'),
  (2, 1, 'الصف الثاني الابتدائي', 'ابتدائي', 2, 'active'),
  (3, 1, 'الصف الثالث الابتدائي', 'ابتدائي', 3, 'active'),
  (4, 1, 'الصف الرابع الابتدائي', 'ابتدائي', 4, 'active'),
  (5, 1, 'الصف الأول المتوسط', 'متوسط', 5, 'active'),
  (6, 1, 'الصف الثاني المتوسط', 'متوسط', 6, 'active'),
  (7, 1, 'الصف الثالث المتوسط', 'متوسط', 7, 'active');

-- Seed: sections for school_id = 1
INSERT OR IGNORE INTO sections (id, school_id, class_id, name, capacity, status) VALUES
  (1, 1, 1, 'أ', 30, 'active'),
  (2, 1, 1, 'ب', 30, 'active'),
  (3, 1, 2, 'أ', 30, 'active'),
  (4, 1, 2, 'ب', 30, 'active'),
  (5, 1, 3, 'أ', 30, 'active'),
  (6, 1, 3, 'ب', 30, 'active'),
  (7, 1, 4, 'أ', 30, 'active'),
  (8, 1, 4, 'ب', 30, 'active'),
  (9, 1, 5, 'أ', 35, 'active'),
  (10, 1, 5, 'ب', 35, 'active'),
  (11, 1, 6, 'أ', 35, 'active'),
  (12, 1, 6, 'ب', 35, 'active'),
  (13, 1, 7, 'أ', 35, 'active'),
  (14, 1, 7, 'ب', 35, 'active');

-- Seed: students for school_id = 1 (sample data)
INSERT OR IGNORE INTO students (id, school_id, student_number, full_name, father_name, mother_name, gender, birth_date, phone, guardian_name, guardian_phone, address, class_id, section_id, status, notes) VALUES
  (1, 1, '2024-001', 'محمد أحمد علي', 'أحمد علي حسن', 'سارة محمود', 'ذكر', '2016-03-15', '', 'أحمد علي حسن', '07701234567', 'بغداد - المنصور', 1, 1, 'active', ''),
  (2, 1, '2024-002', 'فاطمة خالد محمود', 'خالد محمود عبدالله', 'نور حسين', 'أنثى', '2016-07-22', '', 'خالد محمود عبدالله', '07701234568', 'بغداد - كرادة', 1, 1, 'active', ''),
  (3, 1, '2024-003', 'علي حسن نور', 'حسن نور الدين', 'فاطمة عباس', 'ذكر', '2016-01-10', '', 'حسن نور الدين', '07701234569', 'بغداد - اليرموك', 1, 2, 'active', ''),
  (4, 1, '2024-004', 'سارة محمود كريم', 'محمود كريم فؤاد', 'هناء جمال', 'أنثى', '2016-09-05', '', 'محمود كريم فؤاد', '07701234570', 'بغداد - العدل', 1, 2, 'active', ''),
  (5, 1, '2024-005', 'يوسف عباس رحمن', 'عباس رحمن سليم', 'ليلى فؤاد', 'ذكر', '2015-05-18', '', 'عباس رحمن سليم', '07701234571', 'بغداد - الدورة', 2, 3, 'active', ''),
  (6, 1, '2024-006', 'مريم كريم فؤاد', 'كريم فؤاد صالح', 'سعاد محمود', 'أنثى', '2015-11-30', '', 'كريم فؤاد صالح', '07701234572', 'بغداد - الغزالية', 2, 3, 'active', ''),
  (7, 1, '2024-007', 'عمر سليم ناصر', 'سليم ناصر عبدالرحمن', 'وداد كريم', 'ذكر', '2015-08-14', '', 'سليم ناصر عبدالرحمن', '07701234573', 'بغداد - الحارثية', 2, 4, 'active', ''),
  (8, 1, '2024-008', 'ليلى فؤاد صالح', 'فؤاد صالح محسن', 'مريم عباس', 'أنثى', '2015-02-28', '', 'فؤاد صالح محسن', '07701234574', 'بغداد - الجادرية', 2, 4, 'active', ''),
  (9, 1, '2024-009', 'أحمد محسن عبدالله', 'محسن عبدالله كريم', 'سهى نور', 'ذكر', '2014-06-12', '', 'محسن عبدالله كريم', '07701234575', 'بغداد - البياع', 3, 5, 'active', ''),
  (10, 1, '2024-010', 'نور الدين كريم فؤاد', 'كريم فؤاد رحمن', 'هند سليم', 'ذكر', '2014-12-01', '', 'كريم فؤاد رحمن', '07701234576', 'بغداد - اليرموك', 3, 5, 'active', '');

-- Seed: subjects for school_id = 1 (linked to classes)
INSERT OR IGNORE INTO subjects (id, school_id, class_id, section_id, name, subject_type, counts_in_average, appears_in_report_card, passing_grade, exemption_grade, order_index, status) VALUES
  -- Class 1: الصف الأول الابتدائي
  (1, 1, 1, NULL, 'اللغة العربية', 'أساسية', 1, 1, 50, 25, 1, 'active'),
  (2, 1, 1, NULL, 'الرياضيات', 'أساسية', 1, 1, 50, 25, 2, 'active'),
  (3, 1, 1, NULL, 'اللغة الإنجليزية', 'أساسية', 1, 1, 50, 25, 3, 'active'),
  (4, 1, 1, NULL, 'التربية الإسلامية', 'أساسية', 1, 1, 50, 25, 4, 'active'),
  (5, 1, 1, NULL, 'العلوم', 'أساسية', 1, 1, 50, 25, 5, 'active'),
  (6, 1, 1, NULL, 'التربية الفنية', 'اختيارية', 0, 1, 50, 25, 6, 'active'),
  -- Class 2: الصف الثاني الابتدائي
  (7, 1, 2, NULL, 'اللغة العربية', 'أساسية', 1, 1, 50, 25, 1, 'active'),
  (8, 1, 2, NULL, 'الرياضيات', 'أساسية', 1, 1, 50, 25, 2, 'active'),
  (9, 1, 2, NULL, 'اللغة الإنجليزية', 'أساسية', 1, 1, 50, 25, 3, 'active'),
  (10, 1, 2, NULL, 'التربية الإسلامية', 'أساسية', 1, 1, 50, 25, 4, 'active'),
  (11, 1, 2, NULL, 'العلوم', 'أساسية', 1, 1, 50, 25, 5, 'active'),
  -- Class 5: الصف الأول المتوسط
  (12, 1, 5, NULL, 'اللغة العربية', 'أساسية', 1, 1, 50, 25, 1, 'active'),
  (13, 1, 5, NULL, 'الرياضيات', 'أساسية', 1, 1, 50, 25, 2, 'active'),
  (14, 1, 5, NULL, 'اللغة الإنجليزية', 'أساسية', 1, 1, 50, 25, 3, 'active'),
  (15, 1, 5, NULL, 'الفيزياء', 'أساسية', 1, 1, 50, 25, 4, 'active'),
  (16, 1, 5, NULL, 'الكيمياء', 'أساسية', 1, 1, 50, 25, 5, 'active'),
  (17, 1, 5, NULL, 'الأحياء', 'أساسية', 1, 1, 50, 25, 6, 'active'),
  (18, 1, 5, NULL, 'التربية الإسلامية', 'أساسية', 1, 1, 50, 25, 7, 'active'),
  (19, 1, 5, NULL, 'التاريخ', 'أساسية', 1, 1, 50, 25, 8, 'active'),
  (20, 1, 5, NULL, 'الجغرافيا', 'أساسية', 1, 1, 50, 25, 9, 'active');

-- Seed: classes for school_id = 2 (مدرسة الرافدين الدولية)
INSERT OR IGNORE INTO classes (id, school_id, name, stage, order_index, status) VALUES
  (8, 2, 'Grade 1', 'Primary', 1, 'active'),
  (9, 2, 'Grade 2', 'Primary', 2, 'active'),
  (10, 2, 'Grade 6', 'Primary', 3, 'active');

-- Seed: sections for school_id = 2
INSERT OR IGNORE INTO sections (id, school_id, class_id, name, capacity, status) VALUES
  (15, 2, 8, 'A', 25, 'active'),
  (16, 2, 8, 'B', 25, 'active'),
  (17, 2, 9, 'A', 25, 'active'),
  (18, 2, 10, 'A', 25, 'active');

-- Seed: students for school_id = 2
INSERT OR IGNORE INTO students (id, school_id, student_number, full_name, father_name, mother_name, gender, birth_date, phone, guardian_name, guardian_phone, address, class_id, section_id, status) VALUES
  (11, 2, 'RI-001', 'John Smith', 'Michael Smith', 'Sarah Smith', 'ذكر', '2016-04-10', '', 'Michael Smith', '07711223344', 'Basra - Al-Jamhoria', 8, 15, 'active'),
  (12, 2, 'RI-002', 'Emma Johnson', 'David Johnson', 'Lisa Johnson', 'أنثى', '2016-08-15', '', 'David Johnson', '07711223345', 'Basra - Al-Ashar', 8, 15, 'active');

-- Seed: subjects for school_id = 2
INSERT OR IGNORE INTO subjects (id, school_id, class_id, section_id, name, subject_type, counts_in_average, appears_in_report_card, passing_grade, exemption_grade, order_index, status) VALUES
  (21, 2, 8, NULL, 'Mathematics', 'أساسية', 1, 1, 50, 25, 1, 'active'),
  (22, 2, 8, NULL, 'English Language', 'أساسية', 1, 1, 50, 25, 2, 'active'),
  (23, 2, 8, NULL, 'Science', 'أساسية', 1, 1, 50, 25, 3, 'active'),
  (24, 2, 8, NULL, 'Social Studies', 'أساسية', 1, 1, 50, 25, 4, 'active');
