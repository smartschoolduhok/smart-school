-- ============================================================
-- نظام المدرسة الذكي - Smart School System
-- Phase 1.5: Database Schema for Multi-School SaaS Foundation
-- Compatible with Cloudflare D1 (SQLite)
-- ============================================================

-- TABLE: schools
CREATE TABLE IF NOT EXISTS schools (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  logo_url      TEXT,
  school_type   TEXT NOT NULL,
  city          TEXT NOT NULL,
  status        TEXT DEFAULT 'active',
  created_at    INTEGER DEFAULT (unixepoch()),
  updated_at    INTEGER DEFAULT (unixepoch())
);

-- TABLE: roles
CREATE TABLE IF NOT EXISTS roles (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  key           TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT,
  is_system     INTEGER DEFAULT 0,
  created_at    INTEGER DEFAULT (unixepoch())
);

-- TABLE: permissions
CREATE TABLE IF NOT EXISTS permissions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  key           TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT,
  resource      TEXT NOT NULL,
  action        TEXT NOT NULL,
  created_at    INTEGER DEFAULT (unixepoch())
);

-- TABLE: role_permissions
CREATE TABLE IF NOT EXISTS role_permissions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  role_id       INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  UNIQUE(role_id, permission_id)
);

-- TABLE: users
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id     INTEGER REFERENCES schools(id) ON DELETE SET NULL,
  full_name     TEXT NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  role_id       INTEGER NOT NULL REFERENCES roles(id),
  status        TEXT DEFAULT 'active',
  created_at    INTEGER DEFAULT (unixepoch()),
  updated_at    INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_users_school_id ON users(school_id);
CREATE INDEX IF NOT EXISTS idx_users_role_id ON users(role_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- TABLE: academic_years
CREATE TABLE IF NOT EXISTS academic_years (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id     INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  starts_at     TEXT NOT NULL,
  ends_at       TEXT NOT NULL,
  is_active     INTEGER DEFAULT 0,
  created_at    INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_academic_years_school_id ON academic_years(school_id);

-- TABLE: modules
CREATE TABLE IF NOT EXISTS modules (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  key           TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT,
  status        TEXT DEFAULT 'active',
  is_core       INTEGER DEFAULT 0,
  created_at    INTEGER DEFAULT (unixepoch())
);

-- TABLE: school_modules
CREATE TABLE IF NOT EXISTS school_modules (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id     INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  module_id     INTEGER NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  is_enabled    INTEGER DEFAULT 1,
  enabled_at    INTEGER,
  disabled_at   INTEGER,
  notes         TEXT,
  UNIQUE(school_id, module_id)
);

CREATE INDEX IF NOT EXISTS idx_school_modules_school_id ON school_modules(school_id);
CREATE INDEX IF NOT EXISTS idx_school_modules_module_id ON school_modules(module_id);
-- TABLE: token_blacklist
-- Stores revoked JWT tokens for logout invalidation
CREATE TABLE IF NOT EXISTS token_blacklist (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  token         TEXT NOT NULL,
  expires_at    INTEGER,
  created_at    INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_token_blacklist_token ON token_blacklist(token);


-- Seed: roles
INSERT OR IGNORE INTO roles (id, key, name, description, is_system) VALUES
  (1, 'system_admin', 'مدير النظام', 'صلاحيات كاملة على كل المدارس والمستخدمين', 1),
  (2, 'school_owner', 'صاحب المدرسة', 'إدارة مدرسته وكل بياناتها', 1),
  (3, 'principal', 'المدير', 'إدارة شؤون المدرسة اليومية', 1),
  (4, 'vice_principal', 'المعاون', 'مساعد المدير في الإدارة', 1),
  (5, 'teacher', 'المدرس', 'إدخال الدرجات ومتابعة الطلاب', 1),
  (6, 'accountant', 'المحاسب', 'إدارة الأقساط والخزنة', 1),
  (7, 'registrar', 'التسجيل', 'تسجيل الطلاب وإدارة البيانات', 1),
  (8, 'parent', 'ولي الأمر', 'متابعة ابنه وبياناته', 1);

-- Seed: permissions
INSERT OR IGNORE INTO permissions (id, key, name, description, resource, action) VALUES
  (1, 'schools.view', 'عرض المدارس', 'عرض قائمة المدارس', 'schools', 'view'),
  (2, 'schools.create', 'إنشاء مدرسة', 'إضافة مدرسة جديدة', 'schools', 'create'),
  (3, 'schools.edit', 'تعديل مدرسة', 'تعديل بيانات المدرسة', 'schools', 'edit'),
  (4, 'schools.delete', 'حذف مدرسة', 'حذف مدرسة من النظام', 'schools', 'delete'),
  (5, 'users.view', 'عرض المستخدمين', 'عرض قائمة المستخدمين', 'users', 'view'),
  (6, 'users.create', 'إنشاء مستخدم', 'إضافة مستخدم جديد', 'users', 'create'),
  (7, 'users.edit', 'تعديل مستخدم', 'تعديل بيانات المستخدم', 'users', 'edit'),
  (8, 'users.delete', 'حذف مستخدم', 'حذف مستخدم من النظام', 'users', 'delete'),
  (9, 'roles.manage', 'إدارة الأدوار', 'إدارة الأدوار والصلاحيات', 'roles', 'manage'),
  (10, 'settings.view', 'عرض الإعدادات', 'عرض إعدادات النظام', 'settings', 'view'),
  (11, 'settings.edit', 'تعديل الإعدادات', 'تعديل إعدادات النظام', 'settings', 'edit'),
  (12, 'modules.manage', 'إدارة الموديلات', 'تفعيل/تعطيل موديلات المدرسة', 'modules', 'manage');

-- Seed: role_permissions
-- system_admin -> all
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p WHERE r.key = 'system_admin';

-- school_owner -> users.view, users.create, users.edit, settings.view, settings.edit, modules.manage
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.key = 'school_owner' AND p.key IN ('users.view','users.create','users.edit','settings.view','settings.edit','modules.manage');

-- principal -> users.view, users.create, users.edit, settings.view, settings.edit
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.key = 'principal' AND p.key IN ('users.view','users.create','users.edit','settings.view','settings.edit');

-- vice_principal, teacher, accountant, registrar -> users.view, settings.view
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.key IN ('vice_principal','teacher','accountant','registrar') AND p.key IN ('users.view','settings.view');

-- parent -> settings.view only
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.key = 'parent' AND p.key = 'settings.view';

-- Seed: modules
INSERT OR IGNORE INTO modules (id, key, name, description, is_core) VALUES
  (1, 'dashboard', 'لوحة التحكم', 'الصفحة الرئيسية والإحصائيات', 1),
  (2, 'schools', 'المدارس', 'إدارة المدارس', 1),
  (3, 'users', 'المستخدمون', 'إدارة المستخدمين', 1),
  (4, 'roles', 'الأدوار والصلاحيات', 'إدارة الأدوار والصلاحيات', 1),
  (5, 'settings', 'إعدادات النظام', 'إعدادات النظام العامة', 1),
  (6, 'students', 'الطلاب', 'إدارة بيانات الطلاب', 0),
  (7, 'classes', 'الصفوف والشعب', 'إدارة الصفوف والشعب', 0),
  (8, 'subjects', 'المواد', 'إدارة المواد الدراسية', 0),
  (9, 'grades', 'الدرجات', 'إدخال وإدارة الدرجات', 0),
  (10, 'result_cards', 'كارتات النتائج', 'طباعة كارتات النتائج', 0),
  (11, 'fees', 'الأقساط', 'إدارة الأقساط والدفع', 0),
  (12, 'treasury', 'الخزنة', 'إدارة الخزينة والماليات', 0),
  (13, 'official_books', 'الكتب الرسمية', 'إصدار الكتب الرسمية', 0),
  (14, 'print_records', 'السجلات المطبوعة', 'طباعة السجلات والكشوفات', 0),
  (15, 'employees', 'الموظفون', 'إدارة الموظفين', 0),
  (16, 'transport', 'النقل المدرسي', 'إدارة النقل المدرسي', 0),
  (17, 'teacher_portal', 'بوابة المدرس', 'بوابة المدرس الإلكترونية', 0),
  (18, 'parent_portal', 'بوابة ولي الأمر', 'بوابة ولي الأمر الإلكترونية', 0),
  (19, 'ai_assistant', 'المساعد الذكي', 'مساعد الذكاء الاصطناعي', 0);
