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

// ===========================================
// Phase 2: Academic Data Types
// ===========================================
export type ClassStage = 'رياض' | 'ابتدائي' | 'متوسط' | 'إعدادي' | 'ثانوي' | 'جامعي';
export type Gender = 'male' | 'female';
export type SubjectType = 'أساسية' | 'اختيارية';

export interface Class {
  id: number;
  school_id: number;
  name: string;
  stage: ClassStage;
  order_index: number;
  status: UserStatus;
  created_at: string;
  updated_at: string;
  sections_count?: number;
  students_count?: number;
}

export interface Section {
  id: number;
  school_id: number;
  class_id: number;
  name: string;
  capacity: number;
  status: UserStatus;
  created_at: string;
  updated_at: string;
  class_name?: string;
  students_count?: number;
}

export interface Student {
  id: number;
  school_id: number;
  student_number: string;
  full_name: string;
  father_name: string | null;
  mother_name: string | null;
  gender: Gender;
  birth_date: string | null;
  phone: string | null;
  guardian_name: string | null;
  guardian_phone: string | null;
  address: string | null;
  class_id: number | null;
  section_id: number | null;
  photo_url: string | null;
  notes: string | null;
  status: UserStatus;
  created_at: string;
  updated_at: string;
  class_name?: string;
  section_name?: string;
}

export interface Subject {
  id: number;
  school_id: number;
  class_id: number;
  section_id: number | null;
  name: string;
  subject_type: SubjectType;
  counts_in_average: boolean;
  appears_in_report_card: boolean;
  passing_grade: number;
  exemption_grade: number;
  order_index: number;
  status: UserStatus;
  created_at: string;
  updated_at: string;
  class_name?: string;
  section_name?: string;
}

// ===========================================
// Phase 7: Fees & Receipts Types
// ===========================================
export type FeeStatus = 'pending' | 'partial' | 'paid' | 'overpaid';
export type PaymentMethod = 'cash' | 'bank_transfer' | 'cheque' | 'credit_card' | 'debit_card' | 'mobile_payment' | 'other';
export type ReceiptStatus = 'active' | 'cancelled';

export interface StudentFee {
  id: number;
  school_id: number;
  student_id: number;
  academic_year_id: number | null;
  fee_type: string;
  amount: number;
  currency: string;
  due_date: number | null;
  paid_amount: number;
  status: FeeStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
  student_name?: string;
  student_number?: string;
  class_name?: string;
  section_name?: string;
}

export interface FeePayment {
  id: number;
  school_id: number;
  student_fee_id: number;
  student_id: number;
  amount: number;
  payment_method: string;
  payment_date: number;
  receipt_number: string | null;
  notes: string | null;
  created_by_user_id: number | null;
  created_at: string;
  student_name?: string;
  student_number?: string;
  created_by_name?: string;
}

export interface FeeReceipt {
  id: number;
  school_id: number;
  student_id: number;
  receipt_number: string;
  total_amount: number;
  payment_ids_json: string;
  payments_snapshot_json: string | null;
  student_name_snapshot: string;
  class_name_snapshot: string | null;
  section_name_snapshot: string | null;
  school_name_snapshot: string | null;
  academic_year_snapshot: string | null;
  verification_token: string;
  verification_hash: string;
  status: ReceiptStatus;
  created_by_user_id: number | null;
  created_at: string;
  updated_at: string;
  created_by_name?: string;
}
