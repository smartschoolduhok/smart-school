// ===========================================
// Core Types for نظام المدرسة الذكي
// Multi-school SaaS Foundation
// ===========================================

export type SchoolType = 'خاص' | 'حكومي' | 'دولي' | 'مختلط';
export type UserStatus = 'active' | 'inactive';
export type RoleKey = 'system_admin' | 'school_owner' | 'principal' | 'vice_principal' | 'teacher' | 'accountant' | 'registrar' | 'parent';

export interface School {
  id: number;
  name: string;
  logo_url: string | null;
  school_type: SchoolType;
  city: string;
  status: UserStatus;
  created_at: string;
}

export interface Role {
  id: number;
  name: string;
  description: string;
  key: RoleKey;
}

export interface Permission {
  id: number;
  key: string;
  name: string;
  description: string;
}

export interface RolePermission {
  id: number;
  role_id: number;
  permission_id: number;
}

export interface User {
  id: number;
  school_id: number | null; // null for system_admin
  full_name: string;
  email: string;
  role_id: number;
  status: UserStatus;
  created_at: string;
}

export interface AcademicYear {
  id: number;
  school_id: number;
  name: string;
  starts_at: string;
  ends_at: string;
  is_active: boolean;
}

export interface Module {
  id: number;
  key: string;
  name: string;
  description: string;
  status: UserStatus;
}

export interface SchoolModule {
  id: number;
  school_id: number;
  module_id: number;
  is_enabled: boolean;
}

// Extended types for UI
export interface UserWithSchoolAndRole extends User {
  school_name?: string;
  role_name?: string;
}

export interface RoleWithPermissions extends Role {
  permissions: Permission[];
}

export interface SchoolWithModules extends School {
  modules: { name: string; is_enabled: boolean }[];
}

// Auth types
export interface AuthUser {
  id: number;
  full_name: string;
  email: string;
  role_id: number;
  role_key: RoleKey;
  role_name: string;
  school_id: number | null;
  school_name: string | null;
}

export interface AuthState {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

// Navigation
export interface NavItem {
  label: string;
  path: string;
  icon: string; // Lucide icon name
  active: boolean;
  disabled?: boolean;
  badge?: string;
  section?: string;
}
