-- ============================================================
-- نظام المدرسة الذكي - Smart School System
-- Phase 1: Database Schema for Multi-School SaaS Foundation
-- ============================================================
-- This schema implements a multi-tenant SaaS architecture where
-- each school is a separate tenant with complete data isolation.
-- All school-related tables include school_id for row-level isolation.
--
-- NOTE: This schema uses SQLite syntax (compatible with Cloudflare D1).
-- PostgreSQL features (SERIAL, TIMESTAMPTZ, COMMENT ON) were replaced
-- with SQLite equivalents for edge deployment.
-- ============================================================

-- ---------------------------------------------------------
-- TABLE: schools
-- Purpose: Master table for all schools in the SaaS platform.
-- Multi-school design: This is the root tenant table.
-- Every other school-related table references this table
-- via school_id to ensure complete data separation.
--
-- Why school_id matters:
--   - Every school-related table MUST contain school_id
--   - This ensures queries like "WHERE school_id = ?" prevent
--     any user from accessing another school's data.
--   - school_id = NULL is reserved for system-level users only.
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS schools (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,                -- اسم المدرسة
  logo_url      TEXT,                          -- شعار المدرسة (URL)
  school_type   TEXT NOT NULL,                -- نوع المدرسة: خاص | حكومي | دولي | مختلط
  city          TEXT NOT NULL,                -- المحافظة / المدينة
  status        TEXT DEFAULT 'active',        -- الحالة: active | inactive
  created_at    INTEGER DEFAULT (unixepoch()), -- تاريخ الإنشاء (Unix timestamp)
  updated_at    INTEGER DEFAULT (unixepoch())  -- تاريخ التحديث (Unix timestamp)
);

-- ---------------------------------------------------------
-- TABLE: roles
-- Purpose: Global role definitions for the entire SaaS platform.
-- These roles are shared across all schools.
--
-- Why roles are global (not per-school):
--   - System roles (مدير النظام, المدير, المدرس...) are universal
--   - Future expansion: Add school_id column here for custom per-school roles.
--   - is_system = TRUE prevents accidental deletion of core roles.
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  key           TEXT UNIQUE NOT NULL,         -- معرف فريد: system_admin | school_owner | principal | ...
  name          TEXT NOT NULL,               -- اسم الدور بالعربية
  description   TEXT,                        -- وصف الدور والصلاحيات
  is_system     INTEGER DEFAULT 0,           -- 1 للأدوار المدمجة التي لا يمكن حذفها
  created_at    INTEGER DEFAULT (unixepoch())
);

-- ---------------------------------------------------------
-- TABLE: permissions
-- Purpose: Global permission definitions.
-- Permissions are grouped by resource (schools.*, users.*, etc.)
-- and assigned to roles via role_permissions junction table.
--
-- Why permissions use resource.action format:
--   - Easy to check in code: "if (user.has('schools.create'))"
--   - Resource groups related actions (schools, users, settings)
--   - Action is the verb (view, create, edit, delete, manage)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS permissions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  key           TEXT UNIQUE NOT NULL,        -- معرف الصلاحية: resource.action
  name          TEXT NOT NULL,               -- اسم الصلاحية بالعربية
  description   TEXT,                        -- وصف تفصيلي للصلاحية
  resource      TEXT NOT NULL,               -- المورد: schools | users | roles | settings | ...
  action        TEXT NOT NULL,               -- الفعل: view | create | edit | delete | manage
  created_at    INTEGER DEFAULT (unixepoch())
);

-- ---------------------------------------------------------
-- TABLE: role_permissions
-- Purpose: Many-to-many junction between roles and permissions.
-- Allows flexible permission assignment per role.
--
-- Future expansion:
--   - Add school_id here to allow school-specific overrides.
--   - Example: A principal in School A might have 'modules.manage'
--     but a principal in School B might not.
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS role_permissions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  role_id       INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  UNIQUE(role_id, permission_id)
);

-- ---------------------------------------------------------
-- TABLE: users
-- Purpose: System users across all schools.
--
-- CRITICAL: school_id enforces multi-school data isolation.
--   - Users with school_id = NULL are system-level (e.g., مدير النظام)
--   - Users with school_id = X belong to and can only access school X
--
-- This design prevents any user from seeing another school's data.
-- Every API query MUST include: WHERE school_id = ?
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id     INTEGER REFERENCES schools(id) ON DELETE SET NULL,
                                                -- NULL لمدير النظام (يرى كل المدارس)
                                                -- رقم المدرسة لبقية المستخدمين (عزل تام)
  full_name     TEXT NOT NULL,                -- الاسم الكامل
  email         TEXT UNIQUE NOT NULL,         -- البريد الإلكتروني (فريد عبر النظام)
  password_hash TEXT,                          -- hash لكلمة المرور (Phase 2: Supabase Auth)
  role_id       INTEGER NOT NULL REFERENCES roles(id), -- الدور المرتبط
  status        TEXT DEFAULT 'active',          -- الحالة: active | inactive
  created_at    INTEGER DEFAULT (unixepoch()),
  updated_at    INTEGER DEFAULT (unixepoch())
);

-- Index for fast school-scoped queries (essential for SaaS performance)
CREATE INDEX IF NOT EXISTS idx_users_school_id ON users(school_id);
CREATE INDEX IF NOT EXISTS idx_users_role_id ON users(role_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ---------------------------------------------------------
-- TABLE: academic_years
-- Purpose: School academic years (e.g., 2024-2025).
-- Each school has its own academic year schedule.
-- school_id ensures isolation between schools.
--
-- Why every school-related table must contain school_id:
--   - Without school_id, School A could see School B's academic years.
--   - school_id acts as a "tenant filter" on every query.
--   - This applies to ALL future tables: students, classes, fees, etc.
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS academic_years (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id     INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
                                                -- كل مدرسة لها سنواتها الدراسية الخاصة
  name          TEXT NOT NULL,                 -- اسم السنة: ٢٠٢٤-٢٠٢٥
  starts_at     TEXT NOT NULL,                -- تاريخ البداية (ISO 8601)
  ends_at       TEXT NOT NULL,                -- تاريخ النهاية (ISO 8601)
  is_active     INTEGER DEFAULT 0,            -- 1 = السنة الدراسية الحالية
  created_at    INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_academic_years_school_id ON academic_years(school_id);

-- ---------------------------------------------------------
-- TABLE: modules
-- Purpose: Global module registry for the SaaS platform.
-- Each module represents a feature set (students, fees, etc.)
-- Modules can be enabled/disabled per school via school_modules.
--
-- Why modules are separated from school_modules:
--   - modules table = catalog of ALL available features in the system
--   - school_modules table = which features THIS school subscribes to
--   - This supports tiered pricing (Basic → Standard → Premium)
--   - New modules can be added to the catalog without affecting existing schools
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS modules (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  key           TEXT UNIQUE NOT NULL,        -- معرف الموديل: students | fees | transport | ...
  name          TEXT NOT NULL,                 -- اسم الموديل بالعربية
  description   TEXT,                          -- وصف الموديل
  status        TEXT DEFAULT 'active',         -- الحالة العامة للموديل في النظام
  is_core       INTEGER DEFAULT 0,           -- 1 للموديلات الأساسية التي لا يمكن تعطيلها
  created_at    INTEGER DEFAULT (unixepoch())
);

-- ---------------------------------------------------------
-- TABLE: school_modules
-- Purpose: Per-school module enablement configuration.
-- This is the KEY table for the modular SaaS design:
--   - Each school subscribes to specific modules
--   - is_enabled controls whether the module is active for that school
--   - This allows different pricing tiers per school
--   - Unused modules remain in the database but are hidden in UI
--
-- How modules are enabled/disabled per school:
--   1. Query school_modules WHERE school_id = ?
--   2. For each module, check is_enabled = 1
--   3. If disabled: hide from sidebar, block route access, show lock icon
--   4. Core modules (is_core = 1 in modules table) are ALWAYS enabled
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS school_modules (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id     INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  module_id     INTEGER NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  is_enabled    INTEGER DEFAULT 1,           -- 1 = مفعل، 0 = معطل
  enabled_at    INTEGER,                     -- تاريخ التفعيل (Unix timestamp)
  disabled_at   INTEGER,                     -- تاريخ التعطيل (Unix timestamp)
  notes         TEXT,                        -- ملاحظات (سبب التعطيل مثلاً)
  UNIQUE(school_id, module_id)
);

CREATE INDEX IF NOT EXISTS idx_school_modules_school_id ON school_modules(school_id);
CREATE INDEX IF NOT EXISTS idx_school_modules_module_id ON school_modules(module_id);

-- ============================================================
-- SaaS ARCHITECTURE EXPLANATION
-- ============================================================
-- 1. MULTI-SCHOOL DATA ISOLATION:
--    Every table that stores school-specific data contains
--    school_id (users, academic_years, school_modules).
--    API queries MUST include "WHERE school_id = ?" to ensure
--    users only see their own school's data.
--
-- 2. SYSTEM-LEVEL vs SCHOOL-LEVEL USERS:
--    - school_id IS NULL → System admin (sees ALL schools)
--    - school_id = X     → School user (sees only school X)
--    This is enforced in the application layer AND via query scoping.
--
-- 3. MODULE ENABLEMENT PER SCHOOL:
--    - modules table lists all available features globally
--    - school_modules table configures which features each school gets
--    - UI queries school_modules to show/hide sidebar items
--    - This supports tiered pricing (Basic → Standard → Premium)
--
-- 4. ROLES & PERMISSIONS:
--    - roles table defines job roles (مدير النظام, المدير, ...)
--    - permissions table defines granular actions (view, create, edit, delete)
--    - role_permissions assigns permissions to each role
--    - Future Phase: Add school_id to role_permissions for custom per-school overrides
--
-- 5. PHASE 2+ TABLES (not created now, will extend this schema):
--    - students (school_id, class_id, ...)
--    - classes (school_id, grade_id, ...)
--    - subjects (school_id, ...)
--    - grades_entries (school_id, student_id, subject_id, ...)
--    - fees (school_id, student_id, ...)
--    - treasury_transactions (school_id, ...)
--    All will include school_id for data isolation.
-- ============================================================

-- ---------------------------------------------------------
-- SEED DATA: Essential system roles
-- These roles are required for the system to function.
-- ---------------------------------------------------------
INSERT OR IGNORE INTO roles (key, name, description, is_system) VALUES
  ('system_admin', 'مدير النظام', 'صلاحيات كاملة على كل المدارس والمستخدمين', 1),
  ('school_owner', 'صاحب المدرسة', 'إدارة مدرسته وكل بياناتها', 1),
  ('principal', 'المدير', 'إدارة شؤون المدرسة اليومية', 1),
  ('vice_principal', 'المعاون', 'مساعد المدير في الإدارة', 1),
  ('teacher', 'المدرس', 'إدخال الدرجات ومتابعة الطلاب', 1),
  ('accountant', 'المحاسب', 'إدارة الأقساط والخزنة', 1),
  ('registrar', 'التسجيل', 'تسجيل الطلاب وإدارة البيانات', 1),
  ('parent', 'ولي الأمر', 'متابعة ابنه وبياناته', 1);

-- ---------------------------------------------------------
-- SEED DATA: Core permissions
-- Organized by resource (schools, users, roles, settings, modules)
-- ---------------------------------------------------------
INSERT OR IGNORE INTO permissions (key, name, description, resource, action) VALUES
  ('schools.view', 'عرض المدارس', 'عرض قائمة المدارس', 'schools', 'view'),
  ('schools.create', 'إنشاء مدرسة', 'إضافة مدرسة جديدة', 'schools', 'create'),
  ('schools.edit', 'تعديل مدرسة', 'تعديل بيانات المدرسة', 'schools', 'edit'),
  ('schools.delete', 'حذف مدرسة', 'حذف مدرسة من النظام', 'schools', 'delete'),
  ('users.view', 'عرض المستخدمين', 'عرض قائمة المستخدمين', 'users', 'view'),
  ('users.create', 'إنشاء مستخدم', 'إضافة مستخدم جديد', 'users', 'create'),
  ('users.edit', 'تعديل مستخدم', 'تعديل بيانات المستخدم', 'users', 'edit'),
  ('users.delete', 'حذف مستخدم', 'حذف مستخدم من النظام', 'users', 'delete'),
  ('roles.manage', 'إدارة الأدوار', 'إدارة الأدوار والصلاحيات', 'roles', 'manage'),
  ('settings.view', 'عرض الإعدادات', 'عرض إعدادات النظام', 'settings', 'view'),
  ('settings.edit', 'تعديل الإعدادات', 'تعديل إعدادات النظام', 'settings', 'edit'),
  ('modules.manage', 'إدارة الموديلات', 'تفعيل/تعطيل موديلات المدرسة', 'modules', 'manage');

-- ---------------------------------------------------------
-- SEED DATA: Role-Permission mappings
-- Defines which permissions each role receives.
-- system_admin gets everything; other roles get subsets.
-- ---------------------------------------------------------
-- system_admin → all permissions
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p WHERE r.key = 'system_admin';

-- school_owner → users.view, users.create, users.edit, settings.view, settings.edit, modules.manage
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.key = 'school_owner' AND p.key IN ('users.view','users.create','users.edit','settings.view','settings.edit','modules.manage');

-- principal → users.view, users.create, users.edit, settings.view, settings.edit
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.key = 'principal' AND p.key IN ('users.view','users.create','users.edit','settings.view','settings.edit');

-- vice_principal, teacher, accountant, registrar → users.view, settings.view
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.key IN ('vice_principal','teacher','accountant','registrar') AND p.key IN ('users.view','settings.view');

-- parent → settings.view only
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.key = 'parent' AND p.key = 'settings.view';

-- ---------------------------------------------------------
-- SEED DATA: Core modules (Phase 1 + reserved for future phases)
-- All modules are registered; enablement per school is controlled
-- via school_modules table.
-- ---------------------------------------------------------
INSERT OR IGNORE INTO modules (key, name, description, is_core) VALUES
  ('dashboard', 'لوحة التحكم', 'الصفحة الرئيسية والإحصائيات', 1),
  ('schools', 'المدارس', 'إدارة المدارس', 1),
  ('users', 'المستخدمون', 'إدارة المستخدمين', 1),
  ('roles', 'الأدوار والصلاحيات', 'إدارة الأدوار والصلاحيات', 1),
  ('settings', 'إعدادات النظام', 'إعدادات النظام العامة', 1),
  ('students', 'الطلاب', 'إدارة بيانات الطلاب', 0),
  ('classes', 'الصفوف والشعب', 'إدارة الصفوف والشعب', 0),
  ('subjects', 'المواد', 'إدارة المواد الدراسية', 0),
  ('grades', 'الدرجات', 'إدخال وإدارة الدرجات', 0),
  ('result_cards', 'كارتات النتائج', 'طباعة كارتات النتائج', 0),
  ('fees', 'الأقساط', 'إدارة الأقساط والدفع', 0),
  ('treasury', 'الخزنة', 'إدارة الخزينة والماليات', 0),
  ('official_books', 'الكتب الرسمية', 'إصدار الكتب الرسمية', 0),
  ('print_records', 'السجلات المطبوعة', 'طباعة السجلات والكشوفات', 0),
  ('employees', 'الموظفون', 'إدارة الموظفين', 0),
  ('transport', 'النقل المدرسي', 'إدارة النقل المدرسي', 0),
  ('teacher_portal', 'بوابة المدرس', 'بوابة المدرس الإلكترونية', 0),
  ('parent_portal', 'بوابة ولي الأمر', 'بوابة ولي الأمر الإلكترونية', 0),
  ('ai_assistant', 'المساعد الذكي', 'مساعد الذكاء الاصطناعي', 0);
