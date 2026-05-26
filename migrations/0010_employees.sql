-- ===========================================
-- Phase 9: الموظفون والرواتب (Employees & Salaries)
-- ===========================================

-- Employees table
CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id INTEGER NOT NULL,
  full_name TEXT NOT NULL,
  employee_number TEXT,
  phone TEXT,
  email TEXT,
  role TEXT NOT NULL DEFAULT 'staff',
  job_title TEXT,
  salary_amount INTEGER NOT NULL DEFAULT 0,
  hire_date TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT,
  created_by_user_id INTEGER,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch()),
  FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_employees_school_id ON employees(school_id);
CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(status);
CREATE INDEX IF NOT EXISTS idx_employees_school_status ON employees(school_id, status);

-- Employee salaries (monthly salary records)
CREATE TABLE IF NOT EXISTS employee_salaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id INTEGER NOT NULL,
  employee_id INTEGER NOT NULL,
  month INTEGER NOT NULL,
  year INTEGER NOT NULL,
  base_salary INTEGER NOT NULL DEFAULT 0,
  bonus_amount INTEGER NOT NULL DEFAULT 0,
  deduction_amount INTEGER NOT NULL DEFAULT 0,
  net_salary INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'unpaid',
  cancel_reason TEXT,
  paid_at INTEGER,
  paid_by_user_id INTEGER,
  treasury_transaction_id INTEGER,
  created_by_user_id INTEGER,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch()),
  FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (paid_by_user_id) REFERENCES users(id),
  FOREIGN KEY (created_by_user_id) REFERENCES users(id),
  UNIQUE(employee_id, month, year)
);

CREATE INDEX IF NOT EXISTS idx_employee_salaries_school ON employee_salaries(school_id);
CREATE INDEX IF NOT EXISTS idx_employee_salaries_employee ON employee_salaries(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_salaries_month_year ON employee_salaries(month, year);
CREATE INDEX IF NOT EXISTS idx_employee_salaries_status ON employee_salaries(status);
