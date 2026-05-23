export interface TreasuryAccount {
  id: number;
  school_id: number;
  current_balance: number;
  last_closing_balance: number;
  last_closing_date: number;
  created_at: number;
  updated_at: number;
}

export type TransactionType = 'income' | 'expense';
export type TransactionStatus = 'active' | 'cancelled';
export type SourceType = 'fee_payment' | 'manual' | string;

export interface TreasuryTransaction {
  id: number;
  school_id: number;
  transaction_type: TransactionType;
  category: string;
  amount: number;
  currency: string;
  description: string | null;
  source_type: string | null;
  source_id: number | null;
  status: TransactionStatus;
  cancelled_at: number | null;
  cancelled_by: number | null;
  cancel_reason: string | null;
  created_by: number;
  created_at: number;
  updated_at: number;
  created_by_name?: string | null;
}

export interface TreasuryCategory {
  id: number;
  school_id: number;
  type: TransactionType;
  name: string;
  name_ar: string;
  is_system: boolean;
  created_at: number;
}

export interface TreasuryClosing {
  id: number;
  school_id: number;
  closing_date: string;
  opening_balance: number;
  total_income: number;
  total_expense: number;
  closing_balance: number;
  transaction_count: number;
  status: string;
  notes: string | null;
  closed_by: number;
  created_at: number;
  closed_by_name?: string;
}

export interface TreasurySummary {
  school_id: number;
  verified_balance: number;
  cached_balance: number;
  balance_sync: boolean;
  today_income: number;
  today_expense: number;
  today_net: number;
  today_transaction_count: number;
  pending_fees_count: number;
}

export interface DailyReportRow {
  category: string;
  transaction_type: TransactionType;
  count: number;
  total: number;
}

export interface MonthlyReportRow {
  day: string;
  income: number;
  expense: number;
  count: number;
}

export interface CreateTransactionBody {
  school_id?: number;
  transaction_type: TransactionType;
  category: string;
  amount: number;
  currency?: string;
  description?: string;
}

export interface CancelTransactionBody {
  reason: string;
}

export interface CloseDayBody {
  school_id?: number;
  closing_date?: string;
  notes?: string;
}
