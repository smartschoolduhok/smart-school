-- ================================================================
-- Migration 0031: Treasury/payroll integrity and Iraq business date
-- ================================================================
-- Financial posting uses Asia/Baghdad (UTC+03:00) as the product's
-- authoritative business timezone. Historical rows are classified without
-- changing their amounts, status, source links, or timestamps.

ALTER TABLE treasury_transactions ADD COLUMN business_date TEXT;
ALTER TABLE treasury_transactions ADD COLUMN client_request_id TEXT;
ALTER TABLE treasury_transactions ADD COLUMN request_fingerprint TEXT;

UPDATE treasury_transactions
SET business_date = CASE
  WHEN source_type = 'fee_payment' AND source_id IS NOT NULL
    THEN coalesce(
      (SELECT date(p.payment_date, 'unixepoch', '+3 hours') FROM fee_payments p WHERE p.id = treasury_transactions.source_id),
      date(coalesce(created_at, unixepoch()), 'unixepoch', '+3 hours')
    )
  ELSE date(coalesce(created_at, unixepoch()), 'unixepoch', '+3 hours')
END
WHERE business_date IS NULL;

CREATE INDEX IF NOT EXISTS idx_treasury_tx_school_business_date
  ON treasury_transactions(school_id, business_date, status);
CREATE UNIQUE INDEX IF NOT EXISTS ux_treasury_tx_school_client_request
  ON treasury_transactions(school_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

DROP VIEW IF EXISTS finance_payroll_readiness;
CREATE VIEW finance_payroll_readiness AS
SELECT
  s.id AS salary_id,
  s.school_id,
  s.status,
  CASE
    WHEN s.month NOT BETWEEN 1 AND 12
      OR s.year NOT BETWEEN 2000 AND 2200
      OR s.base_salary < 0 OR s.base_salary != CAST(s.base_salary AS INTEGER)
      OR s.bonus_amount < 0 OR s.bonus_amount != CAST(s.bonus_amount AS INTEGER)
      OR s.deduction_amount < 0 OR s.deduction_amount != CAST(s.deduction_amount AS INTEGER)
      OR s.net_salary < 0 OR s.net_salary != CAST(s.net_salary AS INTEGER)
      OR s.net_salary != s.base_salary + s.bonus_amount - s.deduction_amount
      OR s.net_salary > 9007199254740991
    THEN 0
    WHEN s.status = 'unpaid'
      AND s.paid_at IS NULL
      AND s.paid_by_user_id IS NULL
      AND s.treasury_transaction_id IS NULL
      AND NOT EXISTS(
        SELECT 1 FROM treasury_transactions t
        WHERE t.school_id = s.school_id AND t.source_type = 'salary_payment' AND t.source_id = s.id
      )
    THEN 1
    WHEN s.status = 'paid'
      AND s.paid_at IS NOT NULL
      AND s.paid_by_user_id IS NOT NULL
      AND s.treasury_transaction_id IS NOT NULL
      AND (SELECT COUNT(*) FROM treasury_transactions t WHERE t.school_id = s.school_id AND t.source_type = 'salary_payment' AND t.source_id = s.id) = 1
      AND EXISTS(
        SELECT 1 FROM treasury_transactions t
        WHERE t.id = s.treasury_transaction_id
          AND t.school_id = s.school_id
          AND t.source_type = 'salary_payment'
          AND t.source_id = s.id
          AND t.transaction_type = 'expense'
          AND t.category = 'salary'
          AND t.amount = s.net_salary
          AND t.currency = 'IQD'
          AND t.status = 'active'
      )
    THEN 1
    WHEN s.status = 'cancelled'
      AND length(trim(coalesce(s.cancel_reason, ''))) BETWEEN 1 AND 1000
      AND (
        (s.treasury_transaction_id IS NULL AND s.paid_at IS NULL AND s.paid_by_user_id IS NULL
          AND NOT EXISTS(
            SELECT 1 FROM treasury_transactions t
            WHERE t.school_id = s.school_id AND t.source_type = 'salary_payment' AND t.source_id = s.id
          ))
        OR
        (s.treasury_transaction_id IS NOT NULL AND s.paid_at IS NOT NULL AND s.paid_by_user_id IS NOT NULL
          AND (SELECT COUNT(*) FROM treasury_transactions t WHERE t.school_id = s.school_id AND t.source_type = 'salary_payment' AND t.source_id = s.id) = 1
          AND EXISTS(
            SELECT 1 FROM treasury_transactions t
            WHERE t.id = s.treasury_transaction_id
              AND t.school_id = s.school_id
              AND t.source_type = 'salary_payment'
              AND t.source_id = s.id
              AND t.transaction_type = 'expense'
              AND t.category = 'salary'
              AND t.amount = s.net_salary
              AND t.currency = 'IQD'
              AND t.status = 'cancelled'
          ))
      )
    THEN 1
    ELSE 0
  END AS healthy
FROM employee_salaries s;

DROP VIEW IF EXISTS finance_payroll_school_readiness;
CREATE VIEW finance_payroll_school_readiness AS
SELECT sch.id AS school_id,
  CASE WHEN EXISTS(
    SELECT 1 FROM finance_payroll_readiness r
    WHERE r.school_id = sch.id AND r.healthy != 1
  ) THEN 0 ELSE 1 END AS healthy
FROM schools sch;

-- All newly generated salaries start unpaid and financially inert.
CREATE TRIGGER trg_employee_salaries_integrity_insert
BEFORE INSERT ON employee_salaries BEGIN
  SELECT RAISE(ABORT, 'invalid_salary_request')
  WHERE NEW.status != 'unpaid'
    OR NEW.cancel_reason IS NOT NULL
    OR NEW.paid_at IS NOT NULL
    OR NEW.paid_by_user_id IS NOT NULL
    OR NEW.treasury_transaction_id IS NOT NULL
    OR NEW.month NOT BETWEEN 1 AND 12
    OR NEW.month != CAST(NEW.month AS INTEGER)
    OR NEW.year NOT BETWEEN 2000 AND 2200
    OR NEW.year != CAST(NEW.year AS INTEGER)
    OR NEW.base_salary < 0 OR NEW.base_salary != CAST(NEW.base_salary AS INTEGER)
    OR NEW.bonus_amount < 0 OR NEW.bonus_amount != CAST(NEW.bonus_amount AS INTEGER)
    OR NEW.deduction_amount < 0 OR NEW.deduction_amount != CAST(NEW.deduction_amount AS INTEGER)
    OR NEW.net_salary < 0 OR NEW.net_salary != CAST(NEW.net_salary AS INTEGER)
    OR NEW.net_salary != NEW.base_salary + NEW.bonus_amount - NEW.deduction_amount
    OR NEW.net_salary > 9007199254740991;
  SELECT RAISE(ABORT, 'salary_employee_mismatch')
  WHERE NOT EXISTS(
    SELECT 1 FROM employees e
    WHERE e.id = NEW.employee_id AND e.school_id = NEW.school_id AND e.status = 'active'
  );
END;

-- Salary state changes are accepted only when the matching ledger state exists.
CREATE TRIGGER trg_employee_salaries_integrity_update
BEFORE UPDATE ON employee_salaries BEGIN
  SELECT RAISE(ABORT, 'salary_finance_integrity_error')
  WHERE NEW.id != OLD.id
    OR NEW.school_id != OLD.school_id
    OR NEW.employee_id != OLD.employee_id
    OR NEW.month != OLD.month
    OR NEW.year != OLD.year
    OR NEW.base_salary != OLD.base_salary
    OR NEW.bonus_amount != OLD.bonus_amount
    OR NEW.deduction_amount != OLD.deduction_amount
    OR NEW.net_salary != OLD.net_salary
    OR NEW.created_by_user_id IS NOT OLD.created_by_user_id
    OR NEW.created_at IS NOT OLD.created_at
    OR NOT (
      (OLD.status = 'unpaid' AND NEW.status = 'paid'
        AND NEW.cancel_reason IS NULL
        AND NEW.paid_at IS NOT NULL
        AND NEW.paid_by_user_id IS NOT NULL
        AND NEW.treasury_transaction_id IS NOT NULL
        AND EXISTS(
          SELECT 1 FROM treasury_transactions t
          WHERE t.id = NEW.treasury_transaction_id
            AND t.school_id = NEW.school_id
            AND t.source_type = 'salary_payment'
            AND t.source_id = NEW.id
            AND t.transaction_type = 'expense'
            AND t.category = 'salary'
            AND t.amount = NEW.net_salary
            AND t.currency = 'IQD'
            AND t.status = 'active'
        ))
      OR
      (OLD.status = 'unpaid' AND NEW.status = 'cancelled'
        AND length(trim(coalesce(NEW.cancel_reason, ''))) BETWEEN 1 AND 1000
        AND NEW.paid_at IS NULL
        AND NEW.paid_by_user_id IS NULL
        AND NEW.treasury_transaction_id IS NULL
        AND NOT EXISTS(
          SELECT 1 FROM treasury_transactions t
          WHERE t.school_id = NEW.school_id AND t.source_type = 'salary_payment' AND t.source_id = NEW.id
        ))
      OR
      (OLD.status = 'paid' AND NEW.status = 'cancelled'
        AND length(trim(coalesce(NEW.cancel_reason, ''))) BETWEEN 1 AND 1000
        AND NEW.paid_at IS OLD.paid_at
        AND NEW.paid_by_user_id IS OLD.paid_by_user_id
        AND NEW.treasury_transaction_id IS OLD.treasury_transaction_id
        AND EXISTS(
          SELECT 1 FROM treasury_transactions t
          WHERE t.id = NEW.treasury_transaction_id
            AND t.school_id = NEW.school_id
            AND t.source_type = 'salary_payment'
            AND t.source_id = NEW.id
            AND t.status = 'cancelled'
        ))
    );
END;

-- Resolve the effective date before any insert and freeze closed periods.
CREATE TRIGGER trg_treasury_business_period_insert
BEFORE INSERT ON treasury_transactions BEGIN
  SELECT RAISE(ABORT, 'invalid_business_date')
  WHERE coalesce(
      NEW.business_date,
      CASE WHEN NEW.source_type = 'fee_payment' THEN
        (SELECT date(p.payment_date, 'unixepoch', '+3 hours') FROM fee_payments p WHERE p.id = NEW.source_id)
      ELSE date(coalesce(NEW.created_at, unixepoch()), 'unixepoch', '+3 hours') END
    ) IS NULL
    OR length(coalesce(
        NEW.business_date,
        CASE WHEN NEW.source_type = 'fee_payment' THEN
          (SELECT date(p.payment_date, 'unixepoch', '+3 hours') FROM fee_payments p WHERE p.id = NEW.source_id)
        ELSE date(coalesce(NEW.created_at, unixepoch()), 'unixepoch', '+3 hours') END
      )) != 10
    OR date(coalesce(
        NEW.business_date,
        CASE WHEN NEW.source_type = 'fee_payment' THEN
          (SELECT date(p.payment_date, 'unixepoch', '+3 hours') FROM fee_payments p WHERE p.id = NEW.source_id)
        ELSE date(coalesce(NEW.created_at, unixepoch()), 'unixepoch', '+3 hours') END
      )) != coalesce(
        NEW.business_date,
        CASE WHEN NEW.source_type = 'fee_payment' THEN
          (SELECT date(p.payment_date, 'unixepoch', '+3 hours') FROM fee_payments p WHERE p.id = NEW.source_id)
        ELSE date(coalesce(NEW.created_at, unixepoch()), 'unixepoch', '+3 hours') END
      );
  SELECT RAISE(ABORT, 'future_business_date')
  WHERE coalesce(
      NEW.business_date,
      CASE WHEN NEW.source_type = 'fee_payment' THEN
        (SELECT date(p.payment_date, 'unixepoch', '+3 hours') FROM fee_payments p WHERE p.id = NEW.source_id)
      ELSE date(coalesce(NEW.created_at, unixepoch()), 'unixepoch', '+3 hours') END
    ) > date('now', '+3 hours');
  SELECT RAISE(ABORT, 'treasury_day_closed')
  WHERE EXISTS(
    SELECT 1 FROM treasury_closings c
    WHERE c.school_id = NEW.school_id
      AND c.closing_date >= coalesce(
        NEW.business_date,
        CASE WHEN NEW.source_type = 'fee_payment' THEN
          (SELECT date(p.payment_date, 'unixepoch', '+3 hours') FROM fee_payments p WHERE p.id = NEW.source_id)
        ELSE date(coalesce(NEW.created_at, unixepoch()), 'unixepoch', '+3 hours') END
      )
  );
END;

CREATE TRIGGER trg_treasury_manual_salary_insert
BEFORE INSERT ON treasury_transactions
WHEN NEW.source_type IN ('manual', 'salary_payment') BEGIN
  SELECT RAISE(ABORT, 'invalid_finance_request')
  WHERE NEW.status != 'active'
    OR NEW.cancelled_at IS NOT NULL
    OR NEW.cancelled_by IS NOT NULL
    OR NEW.cancel_reason IS NOT NULL
    OR NEW.business_date IS NULL
    OR length(NEW.business_date) != 10;
  SELECT RAISE(ABORT, 'invalid_finance_amount')
  WHERE NEW.amount <= 0
    OR NEW.amount > 9007199254740991
    OR NEW.amount != CAST(NEW.amount AS INTEGER);
  SELECT RAISE(ABORT, 'unsupported_finance_currency')
  WHERE NEW.currency != 'IQD';
  SELECT RAISE(ABORT, 'finance_not_found')
  WHERE NOT EXISTS(SELECT 1 FROM schools sch WHERE sch.id = NEW.school_id AND sch.status = 'active');
  SELECT RAISE(ABORT, 'finance_reconciliation_required')
  WHERE (SELECT healthy FROM finance_treasury_readiness WHERE school_id = NEW.school_id) != 1;
  SELECT RAISE(ABORT, 'invalid_finance_amount')
  WHERE abs(
    (SELECT coalesce(SUM( CASE WHEN transaction_type = 'income' THEN CAST(amount AS INTEGER) ELSE -CAST(amount AS INTEGER) END ), 0)
     FROM treasury_transactions WHERE school_id = NEW.school_id AND status = 'active')
    + CASE WHEN NEW.transaction_type = 'income' THEN CAST(NEW.amount AS INTEGER) ELSE -CAST(NEW.amount AS INTEGER) END
  ) > 9007199254740991;
  SELECT RAISE(ABORT, 'invalid_finance_request')
  WHERE NEW.source_type = 'manual' AND (
    NEW.source_id IS NOT NULL
    OR NEW.client_request_id IS NULL
    OR length(NEW.client_request_id) NOT BETWEEN 16 AND 100
    OR NEW.request_fingerprint IS NULL
    OR length(NEW.request_fingerprint) != 64
  );
  SELECT RAISE(ABORT, 'invalid_treasury_category')
  WHERE NEW.source_type = 'manual' AND NOT EXISTS(
    SELECT 1 FROM treasury_categories c
    WHERE c.name = NEW.category
      AND c.type = NEW.transaction_type
      AND (c.school_id IS NULL OR c.school_id = NEW.school_id)
  );
  SELECT RAISE(ABORT, 'invalid_salary_request')
  WHERE NEW.source_type = 'salary_payment' AND (
    NEW.transaction_type != 'expense'
    OR NEW.category != 'salary'
    OR NEW.source_id IS NULL
    OR NEW.client_request_id IS NOT NULL
    OR NEW.request_fingerprint IS NOT NULL
    OR NOT EXISTS(
      SELECT 1 FROM employee_salaries s
      WHERE s.id = NEW.source_id
        AND s.school_id = NEW.school_id
        AND s.status = 'unpaid'
        AND s.net_salary = NEW.amount
        AND s.net_salary > 0
        AND s.treasury_transaction_id IS NULL
        AND s.paid_at IS NULL
        AND s.paid_by_user_id IS NULL
    )
  );
END;

-- Fee payment postings do not carry the new column, so classify them from
-- the immutable payment date. Other legacy callers fall back to created_at.
CREATE TRIGGER trg_treasury_business_date_fill
AFTER INSERT ON treasury_transactions
WHEN NEW.business_date IS NULL BEGIN
  UPDATE treasury_transactions
  SET business_date = coalesce(
    CASE WHEN NEW.source_type = 'fee_payment' THEN
      (SELECT date(p.payment_date, 'unixepoch', '+3 hours') FROM fee_payments p WHERE p.id = NEW.source_id)
    END,
    date(coalesce(NEW.created_at, unixepoch()), 'unixepoch', '+3 hours')
  )
  WHERE id = NEW.id AND business_date IS NULL;
END;

-- Posting a manual transaction or salary is one SQLite statement. Any salary
-- state or cache failure aborts the originating ledger insert atomically.
CREATE TRIGGER trg_treasury_manual_salary_post
AFTER INSERT ON treasury_transactions
WHEN NEW.source_type IN ('manual', 'salary_payment') BEGIN
  UPDATE employee_salaries
  SET status = 'paid',
      paid_at = unixepoch(NEW.business_date || ' 00:00:00', '-3 hours'),
      paid_by_user_id = NEW.created_by,
      treasury_transaction_id = NEW.id,
      updated_at = unixepoch()
  WHERE NEW.source_type = 'salary_payment'
    AND id = NEW.source_id
    AND school_id = NEW.school_id
    AND status = 'unpaid';
  SELECT RAISE(ABORT, 'salary_not_payable')
  WHERE NEW.source_type = 'salary_payment' AND changes() != 1;
  INSERT INTO treasury_accounts(school_id, current_balance, updated_at)
    SELECT NEW.school_id,
      coalesce(SUM( CASE WHEN transaction_type = 'income' THEN CAST(amount AS INTEGER) ELSE -CAST(amount AS INTEGER) END ), 0),
      unixepoch()
    FROM treasury_transactions
    WHERE school_id = NEW.school_id AND status = 'active'
    ON CONFLICT(school_id) DO UPDATE SET
      current_balance = excluded.current_balance,
      updated_at = excluded.updated_at;
END;

-- Exactly one active -> cancelled transition is permitted, and closed periods
-- remain immutable. The cache is always recomputed from the ledger, never by
-- applying a second delta.
CREATE TRIGGER trg_treasury_cancel_validate
BEFORE UPDATE OF status ON treasury_transactions BEGIN
  SELECT RAISE(ABORT, 'finance_operation_stale')
  WHERE OLD.status != 'active' OR NEW.status != 'cancelled';
  SELECT RAISE(ABORT, 'invalid_finance_request')
  WHERE NEW.cancelled_at IS NULL
    OR NEW.cancelled_at <= 0
    OR NEW.cancelled_by IS NULL
    OR length(trim(coalesce(NEW.cancel_reason, ''))) NOT BETWEEN 1 AND 1000;
  SELECT RAISE(ABORT, 'treasury_day_closed')
  WHERE EXISTS(
    SELECT 1 FROM treasury_closings c
    WHERE c.school_id = OLD.school_id AND c.closing_date >= OLD.business_date
  );
END;

CREATE TRIGGER trg_treasury_cancel_post
AFTER UPDATE OF status ON treasury_transactions
WHEN OLD.status = 'active' AND NEW.status = 'cancelled' BEGIN
  UPDATE employee_salaries
  SET status = 'cancelled', cancel_reason = NEW.cancel_reason, updated_at = unixepoch()
  WHERE NEW.source_type = 'salary_payment'
    AND id = NEW.source_id
    AND school_id = NEW.school_id
    AND treasury_transaction_id = NEW.id
    AND status = 'paid';
  SELECT RAISE(ABORT, 'salary_finance_integrity_error')
  WHERE NEW.source_type = 'salary_payment' AND changes() != 1;
  INSERT INTO treasury_accounts(school_id, current_balance, updated_at)
    SELECT NEW.school_id,
      coalesce(SUM( CASE WHEN transaction_type = 'income' THEN CAST(amount AS INTEGER) ELSE -CAST(amount AS INTEGER) END ), 0),
      unixepoch()
    FROM treasury_transactions
    WHERE school_id = NEW.school_id AND status = 'active'
    ON CONFLICT(school_id) DO UPDATE SET
      current_balance = excluded.current_balance,
      updated_at = excluded.updated_at;
END;

-- Closing figures must be an exact ledger snapshot. Closings are chronological
-- and may not be edited or deleted after they are recorded.
CREATE TRIGGER trg_treasury_closing_validate
BEFORE INSERT ON treasury_closings BEGIN
  SELECT RAISE(ABORT, 'invalid_business_date')
  WHERE length(NEW.closing_date) != 10
    OR substr(NEW.closing_date, 5, 1) != '-'
    OR substr(NEW.closing_date, 8, 1) != '-'
    OR date(NEW.closing_date) IS NULL
    OR date(NEW.closing_date) != NEW.closing_date;
  SELECT RAISE(ABORT, 'future_business_date')
  WHERE NEW.closing_date > date('now', '+3 hours');
  SELECT RAISE(ABORT, 'treasury_day_already_closed')
  WHERE EXISTS(
    SELECT 1 FROM treasury_closings c
    WHERE c.school_id = NEW.school_id AND c.closing_date >= NEW.closing_date
  );
  SELECT RAISE(ABORT, 'finance_reconciliation_required')
  WHERE (SELECT healthy FROM finance_treasury_readiness WHERE school_id = NEW.school_id) != 1
    OR EXISTS(
      SELECT 1 FROM treasury_transactions t
      WHERE t.school_id = NEW.school_id AND t.business_date IS NULL
    );
  SELECT RAISE(ABORT, 'treasury_closing_mismatch')
  WHERE NEW.opening_balance != (
      SELECT coalesce(SUM( CASE WHEN transaction_type = 'income' THEN CAST(amount AS INTEGER) ELSE -CAST(amount AS INTEGER) END ), 0)
      FROM treasury_transactions
      WHERE school_id = NEW.school_id AND status = 'active' AND business_date < NEW.closing_date
    )
    OR NEW.total_income != (
      SELECT coalesce(SUM(CAST(amount AS INTEGER)), 0) FROM treasury_transactions
      WHERE school_id = NEW.school_id AND status = 'active' AND business_date = NEW.closing_date AND transaction_type = 'income'
    )
    OR NEW.total_expense != (
      SELECT coalesce(SUM(CAST(amount AS INTEGER)), 0) FROM treasury_transactions
      WHERE school_id = NEW.school_id AND status = 'active' AND business_date = NEW.closing_date AND transaction_type = 'expense'
    )
    OR NEW.transaction_count != (
      SELECT COUNT(*) FROM treasury_transactions
      WHERE school_id = NEW.school_id AND status = 'active' AND business_date = NEW.closing_date
    )
    OR NEW.closing_balance != NEW.opening_balance + NEW.total_income - NEW.total_expense;
END;

CREATE TRIGGER trg_treasury_closing_post
AFTER INSERT ON treasury_closings BEGIN
  INSERT INTO treasury_accounts(
    school_id, current_balance, last_closing_balance, last_closing_date, updated_at
  )
  SELECT NEW.school_id,
    coalesce(SUM( CASE WHEN transaction_type = 'income' THEN CAST(amount AS INTEGER) ELSE -CAST(amount AS INTEGER) END ), 0),
    NEW.closing_balance,
    unixepoch(NEW.closing_date || ' 00:00:00', '-3 hours'),
    unixepoch()
  FROM treasury_transactions
  WHERE school_id = NEW.school_id AND status = 'active'
  ON CONFLICT(school_id) DO UPDATE SET
    current_balance = excluded.current_balance,
    last_closing_balance = excluded.last_closing_balance,
    last_closing_date = excluded.last_closing_date,
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER trg_treasury_closing_preserve_update
BEFORE UPDATE ON treasury_closings BEGIN
  SELECT RAISE(ABORT, 'finance_operation_stale');
END;

CREATE TRIGGER trg_treasury_closing_preserve_delete
BEFORE DELETE ON treasury_closings BEGIN
  SELECT RAISE(ABORT, 'finance_operation_stale');
END;
