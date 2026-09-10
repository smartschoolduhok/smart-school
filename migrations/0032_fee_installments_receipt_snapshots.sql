-- Phase 20B: optional fee installment schedules and versioned receipt snapshots.
-- This migration does not move money and does not rewrite historical fees,
-- payments, receipts, or treasury transactions.

CREATE TABLE fee_installment_plans (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_key              TEXT NOT NULL UNIQUE,
  school_id             INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_fee_id        INTEGER NOT NULL REFERENCES student_fees(id) ON DELETE RESTRICT,
  fee_revision_snapshot INTEGER NOT NULL,
  status                TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','superseded','cancelled')),
  notes                 TEXT,
  replaces_plan_id      INTEGER REFERENCES fee_installment_plans(id) ON DELETE RESTRICT,
  created_by_user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  deactivated_at        INTEGER,
  deactivated_by_user_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  created_at            INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at            INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE UNIQUE INDEX idx_fee_installment_plans_active
  ON fee_installment_plans(student_fee_id) WHERE status='active';
CREATE INDEX idx_fee_installment_plans_school_fee
  ON fee_installment_plans(school_id,student_fee_id,status,id);

CREATE TABLE fee_installment_items (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id                 INTEGER NOT NULL REFERENCES fee_installment_plans(id) ON DELETE RESTRICT,
  school_id               INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  sequence_no             INTEGER NOT NULL,
  label                   TEXT NOT NULL,
  amount                  INTEGER NOT NULL,
  percentage_basis_points INTEGER NOT NULL,
  due_date                TEXT NOT NULL,
  created_at              INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(plan_id,sequence_no)
);

CREATE INDEX idx_fee_installment_items_plan
  ON fee_installment_items(school_id,plan_id,sequence_no);

CREATE TRIGGER trg_fee_installment_plans_insert
BEFORE INSERT ON fee_installment_plans BEGIN
  SELECT RAISE(ABORT,'installment_plan_invalid')
  WHERE NEW.status!='draft' OR NEW.fee_revision_snapshot<0
    OR length(NEW.plan_key) NOT BETWEEN 16 AND 100
    OR NEW.deactivated_at IS NOT NULL OR NEW.deactivated_by_user_id IS NOT NULL
    OR length(trim(coalesce(NEW.notes,'')))>1000;
  SELECT RAISE(ABORT,'finance_not_found')
  WHERE NOT EXISTS(
    SELECT 1 FROM student_fees f
    JOIN students s ON s.id=f.student_id AND s.school_id=f.school_id AND s.status='active'
    JOIN schools sch ON sch.id=f.school_id AND sch.status='active'
    WHERE f.id=NEW.student_fee_id AND f.school_id=NEW.school_id
      AND f.currency='IQD' AND f.net_fee>0
      AND f.finance_revision=NEW.fee_revision_snapshot
  );
  SELECT RAISE(ABORT,'installment_plan_invalid')
  WHERE NEW.replaces_plan_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM fee_installment_plans p
    WHERE p.id=NEW.replaces_plan_id AND p.school_id=NEW.school_id
      AND p.student_fee_id=NEW.student_fee_id AND p.status='active'
  );
END;

CREATE TRIGGER trg_fee_installment_items_insert
BEFORE INSERT ON fee_installment_items BEGIN
  SELECT RAISE(ABORT,'installment_plan_invalid')
  WHERE NEW.sequence_no NOT BETWEEN 1 AND 24
    OR NEW.amount<=0 OR NEW.amount>9007199254740991 OR NEW.amount!=CAST(NEW.amount AS INTEGER)
    OR NEW.percentage_basis_points NOT BETWEEN 0 AND 10000
    OR length(trim(NEW.label)) NOT BETWEEN 1 AND 120 OR trim(NEW.label)!=NEW.label
    OR length(NEW.due_date)!=10 OR date(NEW.due_date) IS NULL OR date(NEW.due_date)!=NEW.due_date;
  SELECT RAISE(ABORT,'installment_plan_invalid')
  WHERE NOT EXISTS(
    SELECT 1 FROM fee_installment_plans p
    WHERE p.id=NEW.plan_id AND p.school_id=NEW.school_id AND p.status='draft'
  );
END;

CREATE TRIGGER trg_fee_installment_plans_update
BEFORE UPDATE ON fee_installment_plans BEGIN
  SELECT RAISE(ABORT,'finance_operation_stale')
  WHERE NEW.id!=OLD.id OR NEW.plan_key IS NOT OLD.plan_key OR NEW.school_id!=OLD.school_id
    OR NEW.student_fee_id!=OLD.student_fee_id OR NEW.fee_revision_snapshot!=OLD.fee_revision_snapshot
    OR NEW.notes IS NOT OLD.notes OR NEW.replaces_plan_id IS NOT OLD.replaces_plan_id
    OR NEW.created_by_user_id!=OLD.created_by_user_id OR NEW.created_at!=OLD.created_at
    OR NOT (
      (OLD.status='draft' AND NEW.status='active' AND NEW.deactivated_at IS NULL AND NEW.deactivated_by_user_id IS NULL)
      OR (OLD.status='active' AND NEW.status IN ('superseded','cancelled') AND NEW.deactivated_at>0 AND NEW.deactivated_by_user_id IS NOT NULL)
    );
END;

CREATE TRIGGER trg_fee_installment_plans_activate
BEFORE UPDATE OF status ON fee_installment_plans
WHEN OLD.status='draft' AND NEW.status='active' BEGIN
  SELECT RAISE(ABORT,'finance_operation_stale')
  WHERE NOT EXISTS(
    SELECT 1 FROM student_fees f
    WHERE f.id=NEW.student_fee_id AND f.school_id=NEW.school_id
      AND f.currency='IQD' AND f.net_fee>0
      AND f.finance_revision=NEW.fee_revision_snapshot
  ) OR EXISTS(
    SELECT 1 FROM fee_installment_plans p
    WHERE p.student_fee_id=NEW.student_fee_id AND p.status='active' AND p.id!=NEW.id
  );
  SELECT RAISE(ABORT,'installment_plan_invalid')
  WHERE (SELECT COUNT(*) FROM fee_installment_items i WHERE i.plan_id=NEW.id AND i.school_id=NEW.school_id) NOT BETWEEN 1 AND 24
    OR (SELECT min(sequence_no) FROM fee_installment_items i WHERE i.plan_id=NEW.id)!=1
    OR (SELECT max(sequence_no) FROM fee_installment_items i WHERE i.plan_id=NEW.id)
      !=(SELECT COUNT(*) FROM fee_installment_items i WHERE i.plan_id=NEW.id)
    OR EXISTS(
      SELECT 1 FROM fee_installment_items current_item
      JOIN fee_installment_items previous_item
        ON previous_item.plan_id=current_item.plan_id
       AND previous_item.sequence_no=current_item.sequence_no-1
      WHERE current_item.plan_id=NEW.id AND current_item.due_date<previous_item.due_date
    )
    OR (SELECT coalesce(SUM(percentage_basis_points),0) FROM fee_installment_items i WHERE i.plan_id=NEW.id)!=10000;
  SELECT RAISE(ABORT,'installment_plan_total_mismatch')
  WHERE (SELECT coalesce(SUM(amount),0) FROM fee_installment_items i WHERE i.plan_id=NEW.id)
    !=(SELECT net_fee FROM student_fees f WHERE f.id=NEW.student_fee_id AND f.school_id=NEW.school_id);
  SELECT RAISE(ABORT,'finance_operation_stale')
  WHERE NEW.replaces_plan_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM fee_installment_plans p
    WHERE p.id=NEW.replaces_plan_id AND p.school_id=NEW.school_id
      AND p.student_fee_id=NEW.student_fee_id AND p.status='superseded'
  );
END;

CREATE TRIGGER trg_fee_installment_plans_preserve_history
BEFORE DELETE ON fee_installment_plans BEGIN
  SELECT RAISE(ABORT,'finance_operation_stale');
END;
CREATE TRIGGER trg_fee_installment_items_immutable
BEFORE UPDATE ON fee_installment_items BEGIN
  SELECT RAISE(ABORT,'finance_operation_stale');
END;
CREATE TRIGGER trg_fee_installment_items_preserve_history
BEFORE DELETE ON fee_installment_items BEGIN
  SELECT RAISE(ABORT,'finance_operation_stale');
END;
CREATE TRIGGER trg_student_fees_preserve_installment_plan
BEFORE DELETE ON student_fees
WHEN EXISTS(SELECT 1 FROM fee_installment_plans p WHERE p.student_fee_id=OLD.id) BEGIN
  SELECT RAISE(ABORT,'finance_operation_stale');
END;
CREATE TRIGGER trg_student_fees_guard_installment_total
BEFORE UPDATE OF net_fee ON student_fees
WHEN NEW.net_fee IS NOT OLD.net_fee
  AND EXISTS(SELECT 1 FROM fee_installment_plans p WHERE p.student_fee_id=OLD.id AND p.status='active') BEGIN
  SELECT RAISE(ABORT,'installment_plan_active');
END;

ALTER TABLE fee_receipts ADD COLUMN receipt_schema_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE fee_receipts ADD COLUMN student_number_snapshot TEXT;
ALTER TABLE fee_receipts ADD COLUMN currency_snapshot TEXT;
ALTER TABLE fee_receipts ADD COLUMN received_by_snapshot TEXT;
ALTER TABLE fee_receipts ADD COLUMN financial_summary_snapshot_json TEXT;
ALTER TABLE fee_receipts ADD COLUMN installment_plan_snapshot_json TEXT;
ALTER TABLE fee_receipts ADD COLUMN replaces_receipt_id INTEGER REFERENCES fee_receipts(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX idx_fee_receipts_replacement
  ON fee_receipts(replaces_receipt_id) WHERE replaces_receipt_id IS NOT NULL;

CREATE TRIGGER trg_fee_receipts_snapshot_extension_insert
BEFORE INSERT ON fee_receipts BEGIN
  SELECT RAISE(ABORT,'receipt_payment_invalid')
  WHERE NEW.receipt_schema_version NOT IN (1,2);
  -- Version 1 remains accepted for historical/import compatibility. Every
  -- receipt issued by the Phase 20B application explicitly writes version 2.
  SELECT RAISE(ABORT,'receipt_payment_invalid')
  WHERE NEW.receipt_schema_version=2 AND (
    length(trim(coalesce(NEW.student_number_snapshot,'')))=0
    OR NEW.currency_snapshot!='IQD'
    OR length(trim(coalesce(NEW.received_by_snapshot,'')))=0
    OR NOT json_valid(NEW.financial_summary_snapshot_json)
    OR json_type(NEW.financial_summary_snapshot_json)!='object'
    OR json_extract(NEW.financial_summary_snapshot_json,'$.currency')!='IQD'
    OR json_extract(NEW.financial_summary_snapshot_json,'$.this_payment')!=NEW.total_amount
    OR NOT json_valid(NEW.installment_plan_snapshot_json)
    OR json_type(NEW.installment_plan_snapshot_json)!='array'
  );
  SELECT RAISE(ABORT,'receipt_payment_invalid')
  WHERE NEW.replaces_receipt_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM fee_receipts old
    WHERE old.id=NEW.replaces_receipt_id AND old.school_id=NEW.school_id
      AND old.student_id=NEW.student_id AND old.status='cancelled'
      AND json_array_length(old.payment_ids_json)=json_array_length(NEW.payment_ids_json)
      AND NOT EXISTS(
        SELECT 1 FROM json_each(old.payment_ids_json) old_payment
        WHERE old_payment.value NOT IN(SELECT value FROM json_each(NEW.payment_ids_json))
      )
  );
END;

CREATE TRIGGER trg_fee_receipts_snapshot_extension_immutable
BEFORE UPDATE ON fee_receipts BEGIN
  SELECT RAISE(ABORT,'finance_operation_stale')
  WHERE NEW.receipt_schema_version!=OLD.receipt_schema_version
    OR NEW.student_number_snapshot IS NOT OLD.student_number_snapshot
    OR NEW.currency_snapshot IS NOT OLD.currency_snapshot
    OR NEW.received_by_snapshot IS NOT OLD.received_by_snapshot
    OR NEW.financial_summary_snapshot_json IS NOT OLD.financial_summary_snapshot_json
    OR NEW.installment_plan_snapshot_json IS NOT OLD.installment_plan_snapshot_json
    OR NEW.replaces_receipt_id IS NOT OLD.replaces_receipt_id;
END;
