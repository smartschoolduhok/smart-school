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

-- Users (passwords: admin123, school123, teacher123, owner123, accountant123, registrar123)
INSERT INTO users (id, school_id, full_name, email, password_hash, role_id, status, created_at, updated_at) VALUES
  (1, NULL, 'أحمد عبدالله', 'admin@smart-school.iq', 'fec40b1064ee33fb17ea5d6741ff7a1f73c56fc789e2ce5dca8a246f934eb0c3', 1, 'active', unixepoch(), unixepoch()),
  (2, 1, 'سارة محمود', 'principal@nukhba.iq', 'e62d2a514cb6aec21834da21b462512f41d6f22b8c7527b0c80cdbf903fc103b', 3, 'active', unixepoch(), unixepoch()),
  (3, 1, 'خالد العامري', 'teacher@nukhba.iq', '0cd4dc8d9533d88450058f4afdf147dce7f7d1ec0b5daf83c703935ec3ff22ee', 5, 'active', unixepoch(), unixepoch()),
  (4, 2, 'فاطمة الزهراء', 'owner@rafidain.iq', '2856c1e528be93bb2c261755eb71bb3e1c1ef9f4c9f4f65031ba28a52de7563a', 2, 'active', unixepoch(), unixepoch()),
  (5, 2, 'محمد حسين', 'accountant@rafidain.iq', '80d02588132ccedfc7f6b15e1b162e512a2164fe50e8873fe85039376dd65e17', 6, 'active', unixepoch(), unixepoch()),
  (6, 3, 'نور الدين', 'registrar@eman.iq', '6fec04712803c852f0a7cae4ea971a31f24fb0305623894edef5c2b27db30045', 7, 'inactive', unixepoch(), unixepoch())
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
