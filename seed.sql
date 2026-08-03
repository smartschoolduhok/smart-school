-- ============================================
-- Seed data for Smart School System
-- Compatible with Cloudflare D1 (SQLite)
-- ============================================

-- Schools
INSERT INTO schools (id, name, school_type, city, status, created_at, updated_at) VALUES
  (1, 'مدرسة النخبة الأهلية', 'خاص', 'بغداد', 'active', unixepoch(), unixepoch()),
  (2, 'مدرسة الرافدين الدولية', 'دولي', 'البصرة', 'active', unixepoch(), unixepoch()),
  (3, 'مدرسة الإيمان المختلطة', 'مختلط', 'النجف', 'active', unixepoch(), unixepoch()),
  (4, 'مدرسة البراءة الخاصة', 'خاص', 'أربيل', 'inactive', unixepoch(), unixepoch())
ON CONFLICT(id) DO NOTHING;

-- Academic Years
INSERT INTO academic_years (id, school_id, name, starts_at, ends_at, is_active, created_at) VALUES
  (1, 1, '٢٠٢٤-٢٠٢٥', '2024-09-01', '2025-06-30', 1, unixepoch()),
  (2, 2, '٢٠٢٤-٢٠٢٥', '2024-09-01', '2025-06-30', 1, unixepoch()),
  (3, 3, '٢٠٢٤-٢٠٢٥', '2024-09-01', '2025-06-30', 1, unixepoch())
ON CONFLICT(id) DO NOTHING;

-- Users (passwords: admin123, school123, teacher123, owner123, accountant123, registrar123, vp123)
INSERT INTO users (id, school_id, full_name, email, password_hash, role_id, status, created_at, updated_at) VALUES
  (1, NULL, 'أحمد عبدالله', 'admin@smart-school.iq', 'fec40b1064ee33fb17ea5d6741ff7a1f73c56fc789e2ce5dca8a246f934eb0c3', 1, 'active', unixepoch(), unixepoch()),
  (2, 1, 'سارة محمود', 'principal@nukhba.iq', '89ff5406d1bdd9a60014f2fd79e4397897d9bb17c692c48a6164f114fd97a281', 3, 'active', unixepoch(), unixepoch()),
  (3, 1, 'خالد العامري', 'teacher@nukhba.iq', '0cd4dc8d9533d88450058f4afdf147dce7f7d1ec0b5daf83c703935ec3ff22ee', 5, 'active', unixepoch(), unixepoch()),
  (4, 2, 'فاطمة الزهراء', 'owner@rafidain.iq', '2856c1e528be93bb2c261755eb71bb3e1c1ef9f4c9f4f65031ba28a52de7563a', 2, 'active', unixepoch(), unixepoch()),
  (5, 2, 'محمد حسين', 'accountant@rafidain.iq', '80d02588132ccedfc7f6b15e1b162e512a2164fe50e8873fe85039376dd65e17', 6, 'active', unixepoch(), unixepoch()),
  (6, 3, 'نور الدين', 'registrar@eman.iq', '6fec04712803c852f0a7cae4ea971a31f24fb0305623894edef5c2b27db30045', 7, 'inactive', unixepoch(), unixepoch()),
  (7, 1, 'المعاون المدير', 'vp@nukhba.iq', '84d05686b79e958a7c661df33c4b13268ac6525b031af6a9e3a5521128bfe165', 4, 'active', unixepoch(), unixepoch()),
  (8, 1, 'مسؤول التسجيل', 'registrar@nukhba.iq', 'a48481aea9d231128e5f5d7d2966d55150fda1879fe2b51c4fa4b891bbefb933', 7, 'active', unixepoch(), unixepoch())
ON CONFLICT(id) DO NOTHING;

-- School Modules
INSERT INTO school_modules (id, school_id, module_id, is_enabled, enabled_at, disabled_at) VALUES
  (1, 1, 1, 1, unixepoch(), NULL),
  (2, 1, 2, 1, unixepoch(), NULL),
  (3, 1, 3, 1, unixepoch(), NULL),
  (4, 1, 4, 1, unixepoch(), NULL),
  (5, 1, 5, 1, unixepoch(), NULL),
  (6, 1, 6, 1, unixepoch(), NULL),
  (7, 1, 7, 1, unixepoch(), NULL),
  (8, 1, 8, 1, unixepoch(), NULL),
  (9, 1, 9, 1, unixepoch(), NULL),
  (10, 1, 10, 1, unixepoch(), NULL),
  (11, 1, 11, 1, unixepoch(), NULL),
  (12, 1, 12, 1, unixepoch(), NULL),
  (13, 1, 13, 1, unixepoch(), NULL),
  (14, 1, 14, 1, unixepoch(), NULL),
  (15, 1, 15, 1, unixepoch(), NULL),
  (16, 1, 16, 1, unixepoch(), NULL),
  (17, 1, 17, 1, unixepoch(), NULL),
  (18, 1, 18, 1, unixepoch(), NULL),
  (19, 1, 19, 1, unixepoch(), NULL),
  (101, 2, 1, 1, unixepoch(), NULL),
  (102, 2, 2, 1, unixepoch(), NULL),
  (103, 2, 3, 1, unixepoch(), NULL),
  (104, 2, 4, 1, unixepoch(), NULL),
  (105, 2, 5, 1, unixepoch(), NULL),
  (106, 2, 6, 1, unixepoch(), NULL),
  (107, 2, 7, 1, unixepoch(), NULL),
  (108, 2, 8, 1, unixepoch(), NULL),
  (109, 2, 9, 1, unixepoch(), NULL),
  (110, 2, 10, 1, unixepoch(), NULL),
  (111, 2, 11, 1, unixepoch(), NULL),
  (112, 2, 12, 1, unixepoch(), NULL)
ON CONFLICT(id) DO NOTHING;
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

-- Seed: student_subjects for school_id=1 (student 1 in class 1 section 1)
INSERT OR IGNORE INTO student_subjects (id, school_id, student_id, subject_id, class_id, section_id, is_active, assigned_by_user_id, assigned_at, removed_at, notes, created_at, updated_at) VALUES
  (1, 1, 1, 1, 1, 1, 1, 1, unixepoch(), NULL, '', unixepoch(), unixepoch()),
  (2, 1, 1, 2, 1, 1, 1, 1, unixepoch(), NULL, '', unixepoch(), unixepoch()),
  (3, 1, 1, 3, 1, 1, 1, 1, unixepoch(), NULL, '', unixepoch(), unixepoch()),
  (4, 1, 1, 4, 1, 1, 1, 1, unixepoch(), NULL, '', unixepoch(), unixepoch()),
  (5, 1, 1, 5, 1, 1, 1, 1, unixepoch(), NULL, '', unixepoch(), unixepoch()),
  (6, 1, 1, 6, 1, 1, 1, 1, unixepoch(), NULL, '', unixepoch(), unixepoch());

-- Seed: grades for student 1 (high scores to pass general exemption)
INSERT OR IGNORE INTO grades (id, school_id, student_subject_id, first_month, second_month, third_month, fourth_month, first_term_average, second_term_average, mid_year_exam, final_exam, completion_exam, annual_effort, final_grade, grade_after_completion, effective_grade, result_status, exemption_status, notes, is_active, created_at, updated_at, updated_by_user_id) VALUES
  (1, 1, 1, 92, 94, 90, 88, 93, 89, 85, 90, NULL, 91, 90, 90, 90, 'ناجح', 0, '', 1, unixepoch(), unixepoch(), 1),
  (2, 1, 2, 88, 90, 92, 91, 89, 91, 88, 90, NULL, 90, 89, 89, 89, 'ناجح', 0, '', 1, unixepoch(), unixepoch(), 1),
  (3, 1, 3, 95, 96, 94, 93, 95, 93, 92, 94, NULL, 94, 94, 94, 94, 'ناجح', 0, '', 1, unixepoch(), unixepoch(), 1),
  (4, 1, 4, 90, 88, 91, 92, 89, 91, 87, 89, NULL, 89, 88, 88, 88, 'ناجح', 0, '', 1, unixepoch(), unixepoch(), 1),
  (5, 1, 5, 93, 94, 92, 91, 93, 91, 90, 92, NULL, 92, 92, 92, 92, 'ناجح', 0, '', 1, unixepoch(), unixepoch(), 1),
  (6, 1, 6, 85, 87, 86, 88, 86, 87, 84, 85, NULL, 85, 84, 84, 84, 'ناجح', 0, '', 1, unixepoch(), unixepoch(), 1);

-- Seed: student_subjects for student 2 (class 1 section 1)
INSERT OR IGNORE INTO student_subjects (id, school_id, student_id, subject_id, class_id, section_id, is_active, assigned_by_user_id, assigned_at, removed_at, notes, created_at, updated_at) VALUES
  (7, 1, 2, 1, 1, 1, 1, 1, unixepoch(), NULL, '', unixepoch(), unixepoch()),
  (8, 1, 2, 2, 1, 1, 1, 1, unixepoch(), NULL, '', unixepoch(), unixepoch()),
  (9, 1, 2, 3, 1, 1, 1, 1, unixepoch(), NULL, '', unixepoch(), unixepoch()),
  (10, 1, 2, 4, 1, 1, 1, 1, unixepoch(), NULL, '', unixepoch(), unixepoch()),
  (11, 1, 2, 5, 1, 1, 1, 1, unixepoch(), NULL, '', unixepoch(), unixepoch()),
  (12, 1, 2, 6, 1, 1, 1, 1, unixepoch(), NULL, '', unixepoch(), unixepoch());

-- Student 2: mixed grades (some fail)
INSERT OR IGNORE INTO grades (id, school_id, student_subject_id, first_month, second_month, third_month, fourth_month, first_term_average, second_term_average, mid_year_exam, final_exam, completion_exam, annual_effort, final_grade, grade_after_completion, effective_grade, result_status, exemption_status, notes, is_active, created_at, updated_at, updated_by_user_id) VALUES
  (7, 1, 7, 40, 42, 38, 35, 41, 36, 30, 32, 45, 33, 32, 45, 45, 'مكمل', 0, '', 1, unixepoch(), unixepoch(), 1),
  (8, 1, 8, 92, 88, 90, 91, 90, 90, 88, 89, NULL, 89, 89, 89, 89, 'ناجح', 0, '', 1, unixepoch(), unixepoch(), 1),
  (9, 1, 9, 88, 82, 85, 87, 85, 86, 84, 85, NULL, 85, 84, 84, 84, 'ناجح', 0, '', 1, unixepoch(), unixepoch(), 1),
  (10, 1, 10, 95, 90, 93, 94, 92, 93, 91, 92, NULL, 92, 92, 92, 92, 'ناجح', 0, '', 1, unixepoch(), unixepoch(), 1),
  (11, 1, 11, 91, 87, 89, 90, 89, 89, 88, 89, NULL, 89, 88, 88, 88, 'ناجح', 0, '', 1, unixepoch(), unixepoch(), 1),
  (12, 1, 12, 80, 75, 78, 82, 77, 80, 76, 78, NULL, 77, 77, 77, 77, 'ناجح', 0, '', 1, unixepoch(), unixepoch(), 1);

-- ============================================
-- Phase 10: Enhanced Demo Data for مدرسة النخبة الأهلية (School 1)
-- ============================================

-- Subjects for Class 3 (الصف الثالث الابتدائي) — students 9-10
INSERT OR IGNORE INTO subjects (id, school_id, class_id, section_id, name, subject_type, counts_in_average, appears_in_report_card, passing_grade, exemption_grade, order_index, status) VALUES
  (25, 1, 3, NULL, 'اللغة العربية', 'أساسية', 1, 1, 50, 25, 1, 'active'),
  (26, 1, 3, NULL, 'الرياضيات', 'أساسية', 1, 1, 50, 25, 2, 'active'),
  (27, 1, 3, NULL, 'اللغة الإنجليزية', 'أساسية', 1, 1, 50, 25, 3, 'active'),
  (28, 1, 3, NULL, 'التربية الإسلامية', 'أساسية', 1, 1, 50, 25, 4, 'active'),
  (29, 1, 3, NULL, 'العلوم', 'أساسية', 1, 1, 50, 25, 5, 'active'),
  (30, 1, 3, NULL, 'التربية الفنية', 'اختيارية', 0, 1, 50, 25, 6, 'active');

-- Student subjects for students 3-4 (Class 1, subjects 1-6)
INSERT OR IGNORE INTO student_subjects (id, school_id, student_id, subject_id, class_id, section_id, is_active, assigned_by_user_id, assigned_at, removed_at, notes, created_at, updated_at) VALUES
  (13, 1, 3, 1, 1, 2, 1, 1, unixepoch(), NULL, '', unixepoch(), unixepoch()),
  (14, 1, 3, 2, 1, 2, 1, 1, unixepoch(), NULL, '', unixepoch(), unixepoch()),
  (15, 1, 3, 3, 1, 2, 1, 1, unixepoch(), NULL, '', unixepoch(), unixepoch()),
  (16, 1, 3, 4, 1, 2, 1, 1, unixepoch(), NULL, '', unixepoch(), unixepoch()),
  (17, 1, 3, 5, 1, 2, 1, 1, unixepoch(), NULL, '', unixepoch(), unixepoch()),
  (18, 1, 3, 6, 1, 2, 1, 1, unixepoch(), NULL, '', unixepoch(), unixepoch()),
  (19, 1, 4, 1, 1, 2, 1, 1, unixepoch(), NULL, '', unixepoch(), unixepoch()),
  (20, 1, 4, 2, 1, 2, 1, 1, unixepoch(), NULL, '', unixepoch(), unixepoch()),
  (21, 1, 4, 3, 1, 2, 1, 1, unixepoch(), NULL, '', unixepoch(), unixepoch()),
  (22, 1, 4, 4, 1, 2, 1, 1, unixepoch(), NULL, '', unixepoch(), unixepoch()),
  (23, 1, 4, 5, 1, 2, 1, 1, unixepoch(), NULL, '', unixepoch(), unixepoch()),
  (24, 1, 4, 6, 1, 2, 1, 1, unixepoch(), NULL, '', unixepoch(), unixepoch());

-- Student subjects for students 5-8 (Class 2, subjects 7-11)
INSERT OR IGNORE INTO student_subjects (id, school_id, student_id, subject_id, class_id, section_id, is_active, assigned_by_user_id, assigned_at, removed_at, notes, created_at, updated_at) VALUES
  (25, 1, 5, 7, 2, 3, 1, 1, unixepoch(), NULL, '', unixepoch(), unixepoch()),
  (26, 1, 5, 8, 2, 3, 1, 1, unixepoch(), NULL, '', unixepoch(), unixepoch()),
  (27, 1, 5, 9, 2, 3, 1, 1, unixepoch(), NULL, '', unixepoch(), unixepoch()),
  (28, 1, 5, 10, 2, 3, 1, 1, unixepoch(), NULL, '', unixepoch(), unixepoch()),
  (29, 1, 5, 11, 2, 3, 1, 1, unixepoch(), NULL, '', unixepoch(), unixepoch()),
  (30, 1, 6, 7, 2, 3, 1, 1, unixepoch(), NULL, '', unixepoch(), unixepoch()),
  (31, 1, 6, 8, 2, 3, 1, 1, unixepoch(), NULL, '', unixepoch(), unixepoch()),
  (32, 1, 6, 9, 2, 3, 1, 1, unixepoch(), NULL, '', unixepoch(), unixepoch()),
  (33, 1, 6, 10, 2, 3, 1, 1, unixepoch(), NULL, '', unixepoch(), unixepoch()),
  (34, 1, 6, 11, 2, 3, 1, 1, unixepoch(), NULL, '', unixepoch(), unixepoch()),
  (35, 1, 7, 7, 2, 4, 1, 1, unixepoch(), NULL, '', unixepoch(), unixepoch()),
  (36, 1, 7, 8, 2, 4, 1, 1, unixepoch(), NULL, '', unixepoch(), unixepoch()),
  (37, 1, 7, 9, 2, 4, 1, 1, unixepoch(), NULL, '', unixepoch(), unixepoch()),
  (38, 1, 7, 10, 2, 4, 1, 1, unixepoch(), NULL, '', unixepoch(), unixepoch()),
  (39, 1, 7, 11, 2, 4, 1, 1, unixepoch(), NULL, '', unixepoch(), unixepoch()),
  (40, 1, 8, 7, 2, 4, 1, 1, unixepoch(), NULL, '', unixepoch(), unixepoch()),
  (41, 1, 8, 8, 2, 4, 1, 1, unixepoch(), NULL, '', unixepoch(), unixepoch()),
  (42, 1, 8, 9, 2, 4, 1, 1, unixepoch(), NULL, '', unixepoch(), unixepoch()),
  (43, 1, 8, 10, 2, 4, 1, 1, unixepoch(), NULL, '', unixepoch(), unixepoch()),
  (44, 1, 8, 11, 2, 4, 1, 1, unixepoch(), NULL, '', unixepoch(), unixepoch());

-- Student subjects for students 9-10 (Class 3, subjects 25-30)
INSERT OR IGNORE INTO student_subjects (id, school_id, student_id, subject_id, class_id, section_id, is_active, assigned_by_user_id, assigned_at, removed_at, notes, created_at, updated_at) VALUES
  (45, 1, 9, 25, 3, 5, 1, 1, unixepoch(), NULL, '', unixepoch(), unixepoch()),
  (46, 1, 9, 26, 3, 5, 1, 1, unixepoch(), NULL, '', unixepoch(), unixepoch()),
  (47, 1, 9, 27, 3, 5, 1, 1, unixepoch(), NULL, '', unixepoch(), unixepoch()),
  (48, 1, 9, 28, 3, 5, 1, 1, unixepoch(), NULL, '', unixepoch(), unixepoch()),
  (49, 1, 9, 29, 3, 5, 1, 1, unixepoch(), NULL, '', unixepoch(), unixepoch()),
  (50, 1, 9, 30, 3, 5, 1, 1, unixepoch(), NULL, '', unixepoch(), unixepoch()),
  (51, 1, 10, 25, 3, 5, 1, 1, unixepoch(), NULL, '', unixepoch(), unixepoch()),
  (52, 1, 10, 26, 3, 5, 1, 1, unixepoch(), NULL, '', unixepoch(), unixepoch()),
  (53, 1, 10, 27, 3, 5, 1, 1, unixepoch(), NULL, '', unixepoch(), unixepoch()),
  (54, 1, 10, 28, 3, 5, 1, 1, unixepoch(), NULL, '', unixepoch(), unixepoch()),
  (55, 1, 10, 29, 3, 5, 1, 1, unixepoch(), NULL, '', unixepoch(), unixepoch()),
  (56, 1, 10, 30, 3, 5, 1, 1, unixepoch(), NULL, '', unixepoch(), unixepoch());

-- Grades for student 3 (excellent student, Class 1)
INSERT OR IGNORE INTO grades (id, school_id, student_subject_id, first_month, second_month, third_month, fourth_month, first_term_average, second_term_average, mid_year_exam, final_exam, completion_exam, annual_effort, final_grade, grade_after_completion, effective_grade, result_status, exemption_status, notes, is_active, created_at, updated_at, updated_by_user_id) VALUES
  (13, 1, 13, 90, 92, 91, 93, 91, 92, 89, 91, NULL, 91, 91, 91, 91, 'ناجح', 0, '', 1, unixepoch(), unixepoch(), 1),
  (14, 1, 14, 88, 90, 89, 91, 89, 90, 87, 89, NULL, 89, 89, 89, 89, 'ناجح', 0, '', 1, unixepoch(), unixepoch(), 1),
  (15, 1, 15, 94, 95, 93, 96, 94, 94, 92, 94, NULL, 94, 94, 94, 94, 'ناجح', 0, '', 1, unixepoch(), unixepoch(), 1),
  (16, 1, 16, 91, 89, 92, 90, 90, 91, 88, 90, NULL, 90, 90, 90, 90, 'ناجح', 0, '', 1, unixepoch(), unixepoch(), 1),
  (17, 1, 17, 93, 94, 92, 95, 93, 93, 91, 93, NULL, 93, 93, 93, 93, 'ناجح', 0, '', 1, unixepoch(), unixepoch(), 1),
  (18, 1, 18, 85, 87, 86, 88, 86, 87, 84, 86, NULL, 86, 86, 86, 86, 'ناجح', 0, '', 1, unixepoch(), unixepoch(), 1);

-- Grades for student 4 (average student, Class 1)
INSERT OR IGNORE INTO grades (id, school_id, student_subject_id, first_month, second_month, third_month, fourth_month, first_term_average, second_term_average, mid_year_exam, final_exam, completion_exam, annual_effort, final_grade, grade_after_completion, effective_grade, result_status, exemption_status, notes, is_active, created_at, updated_at, updated_by_user_id) VALUES
  (19, 1, 19, 75, 78, 72, 76, 76, 74, 70, 74, NULL, 74, 73, 73, 73, 'ناجح', 0, '', 1, unixepoch(), unixepoch(), 1),
  (20, 1, 20, 68, 70, 65, 72, 69, 68, 64, 67, NULL, 67, 66, 66, 66, 'ناجح', 0, '', 1, unixepoch(), unixepoch(), 1),
  (21, 1, 21, 82, 85, 80, 84, 83, 82, 80, 82, NULL, 82, 82, 82, 82, 'ناجح', 0, '', 1, unixepoch(), unixepoch(), 1),
  (22, 1, 22, 88, 87, 89, 90, 87, 89, 86, 88, NULL, 88, 88, 88, 88, 'ناجح', 0, '', 1, unixepoch(), unixepoch(), 1),
  (23, 1, 23, 70, 72, 68, 74, 71, 71, 66, 69, NULL, 69, 68, 68, 68, 'ناجح', 0, '', 1, unixepoch(), unixepoch(), 1),
  (24, 1, 24, 92, 90, 91, 93, 91, 92, 89, 91, NULL, 91, 91, 91, 91, 'ناجح', 0, '', 1, unixepoch(), unixepoch(), 1);

-- Grades for student 5 (strong student, Class 2)
INSERT OR IGNORE INTO grades (id, school_id, student_subject_id, first_month, second_month, third_month, fourth_month, first_term_average, second_term_average, mid_year_exam, final_exam, completion_exam, annual_effort, final_grade, grade_after_completion, effective_grade, result_status, exemption_status, notes, is_active, created_at, updated_at, updated_by_user_id) VALUES
  (25, 1, 25, 85, 88, 86, 89, 86, 87, 84, 86, NULL, 86, 86, 86, 86, 'ناجح', 0, '', 1, unixepoch(), unixepoch(), 1),
  (26, 1, 26, 90, 92, 89, 91, 91, 90, 88, 90, NULL, 90, 90, 90, 90, 'ناجح', 0, '', 1, unixepoch(), unixepoch(), 1),
  (27, 1, 27, 78, 80, 76, 82, 79, 79, 75, 78, NULL, 78, 78, 78, 78, 'ناجح', 0, '', 1, unixepoch(), unixepoch(), 1),
  (28, 1, 28, 92, 94, 91, 93, 93, 92, 90, 92, NULL, 92, 92, 92, 92, 'ناجح', 0, '', 1, unixepoch(), unixepoch(), 1),
  (29, 1, 29, 88, 86, 87, 89, 87, 88, 85, 87, NULL, 87, 87, 87, 87, 'ناجح', 0, '', 1, unixepoch(), unixepoch(), 1);

-- Grades for student 6 (struggling student, one completion exam needed, Class 2)
INSERT OR IGNORE INTO grades (id, school_id, student_subject_id, first_month, second_month, third_month, fourth_month, first_term_average, second_term_average, mid_year_exam, final_exam, completion_exam, annual_effort, final_grade, grade_after_completion, effective_grade, result_status, exemption_status, notes, is_active, created_at, updated_at, updated_by_user_id) VALUES
  (30, 1, 30, 55, 58, 52, 60, 56, 56, 48, 52, 65, 51, 52, 58, 58, 'ناجح', 0, '', 1, unixepoch(), unixepoch(), 1),
  (31, 1, 31, 42, 45, 40, 48, 43, 44, 38, 41, 55, 40, 41, 48, 48, 'مكمل', 0, '', 1, unixepoch(), unixepoch(), 1),
  (32, 1, 32, 70, 72, 68, 74, 71, 71, 66, 69, NULL, 69, 68, 68, 68, 'ناجح', 0, '', 1, unixepoch(), unixepoch(), 1),
  (33, 1, 33, 80, 82, 78, 84, 81, 81, 77, 80, NULL, 80, 80, 80, 80, 'ناجح', 0, '', 1, unixepoch(), unixepoch(), 1),
  (34, 1, 34, 65, 68, 62, 70, 66, 66, 60, 64, 72, 63, 64, 66, 66, 'ناجح', 0, '', 1, unixepoch(), unixepoch(), 1);

-- Grades for student 7 (good student, Class 2)
INSERT OR IGNORE INTO grades (id, school_id, student_subject_id, first_month, second_month, third_month, fourth_month, first_term_average, second_term_average, mid_year_exam, final_exam, completion_exam, annual_effort, final_grade, grade_after_completion, effective_grade, result_status, exemption_status, notes, is_active, created_at, updated_at, updated_by_user_id) VALUES
  (35, 1, 35, 82, 84, 80, 86, 83, 83, 79, 82, NULL, 82, 82, 82, 82, 'ناجح', 0, '', 1, unixepoch(), unixepoch(), 1),
  (36, 1, 36, 76, 78, 74, 80, 77, 77, 73, 76, NULL, 76, 76, 76, 76, 'ناجح', 0, '', 1, unixepoch(), unixepoch(), 1),
  (37, 1, 37, 90, 92, 88, 94, 91, 91, 87, 90, NULL, 90, 90, 90, 90, 'ناجح', 0, '', 1, unixepoch(), unixepoch(), 1),
  (38, 1, 38, 85, 87, 83, 89, 86, 86, 82, 85, NULL, 85, 85, 85, 85, 'ناجح', 0, '', 1, unixepoch(), unixepoch(), 1),
  (39, 1, 39, 72, 74, 70, 76, 73, 73, 69, 72, NULL, 72, 72, 72, 72, 'ناجح', 0, '', 1, unixepoch(), unixepoch(), 1);

-- Grades for student 8 (average, Class 2)
INSERT OR IGNORE INTO grades (id, school_id, student_subject_id, first_month, second_month, third_month, fourth_month, first_term_average, second_term_average, mid_year_exam, final_exam, completion_exam, annual_effort, final_grade, grade_after_completion, effective_grade, result_status, exemption_status, notes, is_active, created_at, updated_at, updated_by_user_id) VALUES
  (40, 1, 40, 68, 70, 66, 72, 69, 69, 65, 68, NULL, 68, 68, 68, 68, 'ناجح', 0, '', 1, unixepoch(), unixepoch(), 1),
  (41, 1, 41, 74, 76, 72, 78, 75, 75, 71, 74, NULL, 74, 74, 74, 74, 'ناجح', 0, '', 1, unixepoch(), unixepoch(), 1),
  (42, 1, 42, 80, 82, 78, 84, 81, 81, 77, 80, NULL, 80, 80, 80, 80, 'ناجح', 0, '', 1, unixepoch(), unixepoch(), 1),
  (43, 1, 43, 62, 64, 60, 66, 63, 63, 58, 62, 70, 61, 62, 65, 65, 'ناجح', 0, '', 1, unixepoch(), unixepoch(), 1),
  (44, 1, 44, 88, 90, 86, 92, 89, 89, 85, 88, NULL, 88, 88, 88, 88, 'ناجح', 0, '', 1, unixepoch(), unixepoch(), 1);

-- Grades for student 9 (strong student, Class 3)
INSERT OR IGNORE INTO grades (id, school_id, student_subject_id, first_month, second_month, third_month, fourth_month, first_term_average, second_term_average, mid_year_exam, final_exam, completion_exam, annual_effort, final_grade, grade_after_completion, effective_grade, result_status, exemption_status, notes, is_active, created_at, updated_at, updated_by_user_id) VALUES
  (45, 1, 45, 88, 90, 87, 91, 89, 89, 86, 88, NULL, 88, 88, 88, 88, 'ناجح', 0, '', 1, unixepoch(), unixepoch(), 1),
  (46, 1, 46, 92, 94, 91, 93, 93, 92, 90, 92, NULL, 92, 92, 92, 92, 'ناجح', 0, '', 1, unixepoch(), unixepoch(), 1),
  (47, 1, 47, 85, 87, 84, 88, 86, 86, 83, 85, NULL, 85, 85, 85, 85, 'ناجح', 0, '', 1, unixepoch(), unixepoch(), 1),
  (48, 1, 48, 90, 92, 89, 93, 91, 91, 88, 90, NULL, 90, 90, 90, 90, 'ناجح', 0, '', 1, unixepoch(), unixepoch(), 1),
  (49, 1, 49, 78, 80, 76, 82, 79, 79, 75, 78, NULL, 78, 78, 78, 78, 'ناجح', 0, '', 1, unixepoch(), unixepoch(), 1),
  (50, 1, 50, 95, 96, 94, 97, 95, 95, 93, 95, NULL, 95, 95, 95, 95, 'ناجح', 0, '', 1, unixepoch(), unixepoch(), 1);

-- Grades for student 10 (mixed, one low grade, Class 3)
INSERT OR IGNORE INTO grades (id, school_id, student_subject_id, first_month, second_month, third_month, fourth_month, first_term_average, second_term_average, mid_year_exam, final_exam, completion_exam, annual_effort, final_grade, grade_after_completion, effective_grade, result_status, exemption_status, notes, is_active, created_at, updated_at, updated_by_user_id) VALUES
  (51, 1, 51, 72, 74, 70, 76, 73, 73, 69, 72, NULL, 72, 72, 72, 72, 'ناجح', 0, '', 1, unixepoch(), unixepoch(), 1),
  (52, 1, 52, 65, 68, 62, 70, 66, 66, 60, 64, 75, 63, 64, 69, 69, 'ناجح', 0, '', 1, unixepoch(), unixepoch(), 1),
  (53, 1, 53, 80, 82, 78, 84, 81, 81, 77, 80, NULL, 80, 80, 80, 80, 'ناجح', 0, '', 1, unixepoch(), unixepoch(), 1),
  (54, 1, 54, 88, 90, 86, 92, 89, 89, 85, 88, NULL, 88, 88, 88, 88, 'ناجح', 0, '', 1, unixepoch(), unixepoch(), 1),
  (55, 1, 55, 55, 58, 52, 60, 56, 56, 48, 53, 62, 52, 53, 56, 56, 'ناجح', 0, '', 1, unixepoch(), unixepoch(), 1),
  (56, 1, 56, 90, 92, 88, 94, 91, 91, 87, 90, NULL, 90, 90, 90, 90, 'ناجح', 0, '', 1, unixepoch(), unixepoch(), 1);

-- ============================================
-- Demo: Student Fees (School 1)
-- ============================================
INSERT OR IGNORE INTO student_fees (id, school_id, student_id, academic_year_id, fee_type, amount, currency, due_date, paid_amount, status, notes) VALUES
  (1, 1, 1, 1, 'رسوم دراسية', 500000, 'IQD', unixepoch(), 500000, 'paid', 'تم السداد بالكامل'),
  (2, 1, 2, 1, 'رسوم دراسية', 500000, 'IQD', unixepoch(), 300000, 'pending', 'متبقي ٢٠٠٠٠٠ دينار'),
  (3, 1, 3, 1, 'رسوم دراسية', 500000, 'IQD', unixepoch(), 500000, 'paid', 'تم السداد بالكامل'),
  (4, 1, 4, 1, 'رسوم دراسية', 500000, 'IQD', unixepoch(), 0, 'overdue', 'لم يتم السداد بعد'),
  (5, 1, 5, 1, 'رسوم دراسية', 500000, 'IQD', unixepoch(), 500000, 'paid', 'تم السداد بالكامل'),
  (6, 1, 6, 1, 'رسوم دراسية', 500000, 'IQD', unixepoch(), 250000, 'pending', 'متبقي ٢٥٠٠٠٠ دينار'),
  (7, 1, 7, 1, 'رسوم دراسية', 500000, 'IQD', unixepoch(), 500000, 'paid', 'تم السداد بالكامل'),
  (8, 1, 8, 1, 'رسوم دراسية', 500000, 'IQD', unixepoch(), 150000, 'pending', 'متبقي ٣٥٠٠٠٠ دينار');

-- Demo: Fee Payments
INSERT OR IGNORE INTO fee_payments (id, school_id, student_fee_id, student_id, amount, payment_method, payment_date, receipt_number, notes, created_by_user_id) VALUES
  (1, 1, 1, 1, 500000, 'cash', unixepoch(), 'REC-2025-001', 'دفعة كاملة', 2),
  (2, 1, 2, 2, 200000, 'cash', unixepoch(), 'REC-2025-002', 'دفعة أولى', 2),
  (3, 1, 2, 2, 100000, 'bank_transfer', unixepoch(), 'REC-2025-003', 'دفعة ثانية', 2),
  (4, 1, 3, 3, 500000, 'cash', unixepoch(), 'REC-2025-004', 'دفعة كاملة', 2),
  (5, 1, 5, 5, 500000, 'cash', unixepoch(), 'REC-2025-005', 'دفعة كاملة', 2),
  (6, 1, 6, 6, 250000, 'cash', unixepoch(), 'REC-2025-006', 'دفعة جزئية', 2),
  (7, 1, 7, 7, 500000, 'cash', unixepoch(), 'REC-2025-007', 'دفعة كاملة', 2),
  (8, 1, 8, 8, 150000, 'cash', unixepoch(), 'REC-2025-008', 'دفعة جزئية', 2);

-- ============================================
-- Demo: Treasury Account & Transactions (School 1)
-- ============================================
INSERT OR IGNORE INTO treasury_accounts (id, school_id, current_balance, last_closing_balance, last_closing_date) VALUES
  (1, 1, 850000, 0, NULL);

INSERT OR IGNORE INTO treasury_transactions (id, school_id, transaction_type, category, amount, currency, description, source_type, source_id, status, created_by, created_at) VALUES
  (1, 1, 'income', 'tuition_fee', 1500000, 'IQD', 'قسط دراسي - الفصل الأول', 'manual', 1, 'active', 2, unixepoch()),
  (2, 1, 'income', 'other_income', 500000, 'IQD', 'تبرع أولياء الأمور', 'manual', 2, 'active', 2, unixepoch()),
  (3, 1, 'expense', 'rent', 600000, 'IQD', 'إيجار المبنى - شهر', 'manual', 3, 'active', 2, unixepoch()),
  (4, 1, 'expense', 'salary', 1200000, 'IQD', 'رواتب الموظفين - شهر', 'manual', 4, 'active', 2, unixepoch()),
  (5, 1, 'expense', 'supplies', 200000, 'IQD', 'مستلزمات مدرسية وقرطاسية', 'manual', 5, 'active', 2, unixepoch()),
  (6, 1, 'expense', 'bills', 150000, 'IQD', 'فاتورة كهرباء وإنترنت', 'manual', 6, 'active', 2, unixepoch());

-- ============================================
-- Demo: Employees (School 1)
-- ============================================
INSERT OR IGNORE INTO employees (id, school_id, full_name, employee_number, phone, email, role, job_title, salary_amount, hire_date, status, notes, created_by_user_id) VALUES
  (1, 1, 'محمد عبدالله العاني', 'EMP-001', '07701111111', 'principal@nukhba.iq', 'staff', 'المدير العام', 1500000, '2022-09-01', 'active', 'مدير المدرسة منذ عام ٢٠٢٢', 2),
  (2, 1, 'سارة محمود الكريم', 'EMP-002', '07702222222', 'teacher.arabic@nukhba.iq', 'staff', 'معلمة اللغة العربية', 900000, '2023-09-01', 'active', 'معلمة متميزة', 2),
  (3, 1, 'أحمد كريم فؤاد', 'EMP-003', '07703333333', 'teacher.math@nukhba.iq', 'staff', 'معلم الرياضيات', 850000, '2023-09-01', 'active', 'معلم رياضيات متخصص', 2),
  (4, 1, 'ليلى فؤاد صالح', 'EMP-004', '07704444444', 'accountant@nukhba.iq', 'staff', 'المحاسبة', 800000, '2022-01-15', 'active', 'محاسبة المدرسة', 2),
  (5, 1, 'نور الدين محسن', 'EMP-005', '07705555555', 'registrar@nukhba.iq', 'staff', 'شؤون الطلاب', 700000, '2024-01-10', 'active', 'مسؤول القبول والتسجيل', 2),
  (6, 1, 'فاطمة الزهراء كريم', 'EMP-006', '07706666666', 'cleaner@nukhba.iq', 'staff', 'الموظفة الإدارية', 500000, '2024-03-01', 'active', 'موظفة إدارية', 2);

-- ============================================
-- Demo: Employee Salaries (May 2025)
-- ============================================
INSERT OR IGNORE INTO employee_salaries (id, school_id, employee_id, month, year, base_salary, bonus_amount, deduction_amount, net_salary, status, paid_at, paid_by_user_id, treasury_transaction_id, created_by_user_id) VALUES
  (1, 1, 1, 5, 2025, 1500000, 100000, 0, 1600000, 'paid', unixepoch(), 2, NULL, 2),
  (2, 1, 2, 5, 2025, 900000, 50000, 0, 950000, 'paid', unixepoch(), 2, NULL, 2),
  (3, 1, 3, 5, 2025, 850000, 50000, 0, 900000, 'paid', unixepoch(), 2, NULL, 2),
  (4, 1, 4, 5, 2025, 800000, 0, 0, 800000, 'paid', unixepoch(), 2, NULL, 2),
  (5, 1, 5, 5, 2025, 700000, 0, 0, 700000, 'paid', unixepoch(), 2, NULL, 2),
  (6, 1, 6, 5, 2025, 500000, 0, 0, 500000, 'paid', unixepoch(), 2, NULL, 2);
