import type { TeacherWorkloadSummary } from '../lib/teacherWorkloadSummary';

export type EmployeeType = 'teacher' | 'administrator' | 'accountant' | 'registrar' | 'principal' | 'worker' | 'driver' | 'other';
export type EmployeeSalaryType = 'monthly' | 'hourly' | 'daily' | 'weekly' | 'contract' | 'other';
export interface EmployeeQualificationInput {
  degree: string;
  general_specialization?: string | null;
  specific_specialization?: string | null;
  institution?: string | null;
  college?: string | null;
  graduation_date?: string | null;
  is_primary: boolean;
}
export interface EmployeeQualification extends EmployeeQualificationInput { id: number; }
export interface Employee {
  id: number;
  school_id: number;
  full_name: string;
  employee_number: string | null;
  phone?: string | null;
  email?: string | null;
  role: string;
  job_title: string | null;
  salary_amount: number;
  hire_date: string | null;
  commencement_date?: string | null;
  gender?: 'male' | 'female' | 'other' | null;
  address?: string | null;
  employee_type?: EmployeeType;
  salary_type?: EmployeeSalaryType;
  status: 'active' | 'archived' | string;
  notes?: string | null;
  has_photo?: boolean;
  photo_updated_at?: number | null;
  qualifications?: EmployeeQualification[];
  primary_qualification?: EmployeeQualification | null;
  created_by_user_id?: number | null;
  created_at: number;
  updated_at: number;
}
export interface EmployeeSalary {
  id: number;
  school_id: number;
  employee_id: number;
  employee_name?: string;
  employee_number?: string | null;
  job_title?: string | null;
  employee_status?: string;
  payment_business_date?: string | null;
  month: number;
  year: number;
  base_salary: number;
  bonus_amount: number;
  deduction_amount: number;
  net_salary: number;
  status: 'unpaid' | 'paid' | 'cancelled' | string;
  cancel_reason: string | null;
  paid_at: number | null;
  paid_by_user_id: number | null;
  treasury_transaction_id: number | null;
  created_by_user_id: number | null;
  created_at: number;
  updated_at: number;
}
export interface CreateEmployeeBody {
  school_id?: number;
  full_name: string;
  employee_number?: string | null;
  phone?: string | null;
  email?: string | null;
  role?: string;
  job_title?: string | null;
  salary_amount?: number;
  hire_date?: string | null;
  commencement_date?: string | null;
  gender?: 'male' | 'female' | 'other' | null;
  address?: string | null;
  employee_type?: EmployeeType;
  salary_type?: EmployeeSalaryType;
  notes?: string | null;
  qualifications?: EmployeeQualificationInput[];
}
export type UpdateEmployeeBody = Partial<CreateEmployeeBody>;
export interface EmployeeTeachingAssignment {
  teaching_load_id: number;
  subject_id: number;
  subject_name: string;
  class_id: number;
  class_name: string;
  section_id: number | null;
  section_name: string | null;
  planned_weekly_periods: number;
  saved_weekly_periods: number;
}
export interface EmployeeAdvisoryAssignment {
  class_id: number;
  class_name: string;
  section_id: number | null;
  section_name: string | null;
  attendance_confirmed: boolean;
  notes: string;
}
export interface EmployeeProfile {
  document_settings: StaffDocumentMetadata['document_settings'];
  employee: Employee;
  qualifications: EmployeeQualification[];
  academic_years: Array<{id: number; name: string; is_active: number}>;
  academic_year: {id: number; name: string} | null;
  teaching_assignments: EmployeeTeachingAssignment[];
  total_saved_weekly_periods: number;
  advisory_assignments: EmployeeAdvisoryAssignment[];
  salary_history: EmployeeSalary[];
  can_manage: boolean;
  can_view_private: boolean;
}
export interface StaffDocumentMetadata extends Pick<TeacherWorkloadSummary, 'school'> {
  document_settings: TeacherWorkloadSummary['document_settings'] & { currency: string; date_format: string };
  prepared_at: number;
}
export interface StaffRegisterResponse extends StaffDocumentMetadata {
  employees: Employee[];
  filters: {q: string; role: string; status: 'active' | 'archived' | 'all'};
  can_view_private: boolean;
}
export interface SalaryReceiptsResponse extends StaffDocumentMetadata {
  month: number;
  year: number;
  status: 'unpaid' | 'paid' | 'cancelled' | 'all';
  rows: EmployeeSalary[];
  totals: {base_salary: number; bonus_amount: number; deduction_amount: number; net_salary: number; payable_count: number};
  period_record_count: number;
  missing_employee_count: number;
  missing_employees: Array<{id: number; full_name: string; employee_number: string | null}>;
  status_counts: {unpaid: number; paid: number; cancelled: number};
}
export interface GenerateSalaryBody { employee_id: number; month: number; year: number; base_salary?: number; bonus_amount?: number; deduction_amount?: number; }
export interface GenerateAllSalariesBody { school_id?: number; month: number; year: number; bonus_amount?: number; deduction_amount?: number; }
export interface PaySalaryBody { paid_at?: string; }
export interface CancelSalaryBody { cancel_reason: string; }
export interface SalaryReportRow { month: number; year: number; total_base: number; total_bonus: number; total_deduction: number; total_net: number; paid_count: number; unpaid_count: number; cancelled_count: number; }
