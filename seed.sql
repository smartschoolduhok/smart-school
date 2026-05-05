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

-- Users
INSERT INTO users (id, school_id, full_name, email, password_hash, role_id, status, created_at, updated_at) VALUES
  (1, NULL, 'أحمد عبدالله', 'admin@smart-school.iq', NULL, 1, 'active', unixepoch(), unixepoch()),
  (2, 1, 'سارة محمود', 'principal@nukhba.iq', NULL, 3, 'active', unixepoch(), unixepoch()),
  (3, 1, 'خالد العامري', 'teacher@nukhba.iq', NULL, 5, 'active', unixepoch(), unixepoch()),
  (4, 2, 'فاطمة الزهراء', 'owner@rafidain.iq', NULL, 2, 'active', unixepoch(), unixepoch()),
  (5, 2, 'محمد حسين', 'accountant@rafidain.iq', NULL, 6, 'active', unixepoch(), unixepoch()),
  (6, 3, 'نور الدين', 'registrar@eman.iq', NULL, 7, 'inactive', unixepoch(), unixepoch())
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
