export interface Employee {
  id: number;
  school_id: number;
  full_name: string;
  employee_number: string | null;
  phone: string | null;
  email: string | null;
  role: string;
  job_title: string | null;
  salary_amount: number;
  hire_date: string | null;
  status: 'active' | 'archived' | string;
  notes: string | null;
  created_by_user_id: number | null;
  created_at: number;
  updated_at: number;
}

export interface EmployeeSalary {
  id: number;
  school_id: number;
  employee_id: number;
  employee_name?: string;
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
  employee_number?: string;
  phone?: string;
  email?: string;
  role?: string;
  job_title?: string;
  salary_amount?: number;
  hire_date?: string;
  notes?: string;
}

export interface UpdateEmployeeBody {
  full_name?: string;
  employee_number?: string;
  phone?: string;
  email?: string;
  role?: string;
  job_title?: string;
  salary_amount?: number;
  hire_date?: string;
  notes?: string;
}

export interface GenerateSalaryBody {
  employee_id: number;
  month: number;
  year: number;
  base_salary?: number;
  bonus_amount?: number;
  deduction_amount?: number;
}

export interface GenerateAllSalariesBody {
  school_id?: number;
  month: number;
  year: number;
  bonus_amount?: number;
  deduction_amount?: number;
}

export interface PaySalaryBody {
  paid_at?: string;
}

export interface CancelSalaryBody {
  cancel_reason: string;
}

export interface SalaryReportRow {
  month: number;
  year: number;
  total_base: number;
  total_bonus: number;
  total_deduction: number;
  total_net: number;
  paid_count: number;
  unpaid_count: number;
  cancelled_count: number;
}
