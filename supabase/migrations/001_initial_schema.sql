-- Migration: 001_initial_schema
-- Description: Initial schema for نظام المدرسة الذكي (Smart School System)
-- Phase: 1 - SaaS Foundation
-- Date: 2024-01-01
-- Author: Development Team
-- ============================================================
-- This migration creates the foundational tables for a multi-school
-- SaaS platform with complete tenant isolation via school_id.
--
-- NOTE: SQLite syntax (Cloudflare D1 compatible).
-- Previous PostgreSQL syntax was converted to SQLite for edge deployment.
-- ============================================================

-- ---------------------------------------------------------
-- TABLE: schools
-- Root tenant table. Every school-related table references this.
-- school_id provides row-level data isolation between schools.
--
-- Why school_id matters:
--   - Every school-related table MUST contain school_id
--   - This ensures queries like "WHERE school_id = ?" prevent
--     any user from accessing another school's data.
--   - school_id = NULL is reserved for system-level users only.
-- ---------------------------------------------------------
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

-- ---------------------------------------------------------
-- TABLE: roles
-- Global role definitions shared across the platform.
-- Core system roles cannot be deleted (is_system = 1).
--
-- Why roles are global (not per-school):
--   - System roles (مدير النظام, المدير, المدرس...) are universal
--   - Future expansion: Add school_id column here for custom per-school roles.
--   - is_system = 1 prevents accidental deletion of core roles.
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  key           TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT,
  is_system     INTEGER DEFAULT 0,
  created_at    INTEGER DEFAULT (unixepoch())
);

-- ---------------------------------------------------------
-- TABLE: permissions
-- Granular permission definitions organized by resource and action.
--
-- Why permissions use resource.action format:
--   - Easy to check in code: "if (user.has('schools.create'))"
--   - Resource groups related actions (schools, users, settings)
--   - Action is the verb (view, create, edit, delete, manage)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS permissions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  key           TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT,
  resource      TEXT NOT NULL,
  action        TEXT NOT NULL,
  created_at    INTEGER DEFAULT (unixepoch())
);

-- ---------------------------------------------------------
-- TABLE: role_permissions
-- Many-to-many junction: assigns permissions to roles.
-- This controls what each role can do in the system.
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
-- CRITICAL: school_id enforces multi-school data isolation.
-- NULL school_id = system admin (cross-tenant access).
-- Non-NULL school_id = scoped to that school only.
--
-- This design prevents any user from seeing another school's data.
-- Every API query MUST include: WHERE school_id = ?
-- ---------------------------------------------------------
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

-- ---------------------------------------------------------
-- TABLE: academic_years
-- Per-school academic calendar. school_id isolates data.
--
-- Why every school-related table must contain school_id:
--   - Without school_id, School A could see School B's academic years.
--   - school_id acts as a "tenant filter" on every query.
--   - This applies to ALL future tables: students, classes, fees, etc.
-- ---------------------------------------------------------
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

-- ---------------------------------------------------------
-- TABLE: modules
-- Global feature registry. Each module can be enabled per school.
-- is_core = 1 means the module cannot be disabled (essential).
--
-- Why modules are separated from school_modules:
--   - modules table = catalog of ALL available features in the system
--   - school_modules table = which features THIS school subscribes to
--   - This supports tiered pricing (Basic → Standard → Premium)
--   - New modules can be added to the catalog without affecting existing schools
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS modules (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  key           TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT,
  status        TEXT DEFAULT 'active',
  is_core       INTEGER DEFAULT 0,
  created_at    INTEGER DEFAULT (unixepoch())
);

-- ---------------------------------------------------------
-- TABLE: school_modules
-- KEY TABLE for modular SaaS design.
-- Controls which features each school can access.
-- Supports tiered pricing: Basic (core only) → Premium (all modules).
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
  is_enabled    INTEGER DEFAULT 1,
  enabled_at    INTEGER,
  disabled_at   INTEGER,
  notes         TEXT,
  UNIQUE(school_id, module_id)
);

CREATE INDEX IF NOT EXISTS idx_school_modules_school_id ON school_modules(school_id);
CREATE INDEX IF NOT EXISTS idx_school_modules_module_id ON school_modules(module_id);

-- ---------------------------------------------------------
-- SEED DATA: System roles (required for system operation)
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
-- ---------------------------------------------------------
-- system_admin → all permissions
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p WHERE r.key = 'system_admin';

-- school_owner → subset
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.key = 'school_owner' AND p.key IN ('users.view','users.create','users.edit','settings.view','settings.edit','modules.manage');

-- principal → subset
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.key = 'principal' AND p.key IN ('users.view','users.create','users.edit','settings.view','settings.edit');

-- vice_principal, teacher, accountant, registrar → minimal
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.key IN ('vice_principal','teacher','accountant','registrar') AND p.key IN ('users.view','settings.view');

-- parent → settings.view only
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.key = 'parent' AND p.key = 'settings.view';

-- ---------------------------------------------------------
-- SEED DATA: Core + future modules
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
