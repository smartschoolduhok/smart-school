-- Phase 20A1. Additive, no money movement; never rewrite legacy amounts/currency.
-- Run scripts/preflight-finance.mjs on an authorized LOCAL export before an upgrade.
-- Duplicate fee identities/receipt numbers/tokens or corrupt receipt links abort
-- migration rather than deleting, merging or inventing financial history.
-- Keep whitespace BEFORE nested CASE keywords: Wrangler 4's SQL splitter
-- requires it to recognize compound statements (including inside SUM(...)).
ALTER TABLE student_fees ADD COLUMN fee_type_key TEXT;
ALTER TABLE student_fees ADD COLUMN finance_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE fee_payments ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','cancelled'));
ALTER TABLE fee_payments ADD COLUMN cancelled_at INTEGER;
ALTER TABLE fee_payments ADD COLUMN cancelled_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE fee_payments ADD COLUMN cancel_reason TEXT;
ALTER TABLE fee_payments ADD COLUMN client_request_id TEXT;
ALTER TABLE fee_payments ADD COLUMN request_fingerprint TEXT;
ALTER TABLE fee_receipts ADD COLUMN cancelled_at INTEGER;
ALTER TABLE fee_receipts ADD COLUMN cancelled_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE fee_receipts ADD COLUMN cancel_reason TEXT;

-- Conservative whitespace-only key, preserving the original display fee_type.
WITH RECURSIVE normalized(id, key) AS (
  SELECT id, replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(fee_type,
    char(9),' '),char(10),' '),char(11),' '),char(12),' '),char(13),' '),char(160),' '),
    char(5760),' '),char(8192),' '),char(8193),' '),char(8194),' '),char(8195),' '),char(8196),' '),char(8197),' '),char(8198),' '),char(8199),' '),char(8200),' '),char(8201),' '),char(8202),' '),
    char(8232),' '),char(8233),' '),char(8239),' '),char(8287),' '),char(12288),' '),char(65279),' ')
  FROM student_fees
  UNION ALL SELECT id, replace(key,'  ',' ') FROM normalized WHERE instr(key,'  ')>0
)
UPDATE student_fees SET fee_type_key=(SELECT trim(key,char(65279)||' ') FROM normalized WHERE normalized.id=student_fees.id AND instr(key,'  ')=0);

CREATE UNIQUE INDEX idx_student_fees_identity ON student_fees(school_id,student_id,coalesce(academic_year_id,0),fee_type_key);
CREATE UNIQUE INDEX idx_fee_payments_request ON fee_payments(school_id,client_request_id) WHERE client_request_id IS NOT NULL;
CREATE INDEX idx_fee_payments_active_fee ON fee_payments(school_id,student_fee_id,status);
CREATE UNIQUE INDEX idx_fee_receipts_unique_number ON fee_receipts(school_id,receipt_number);
CREATE UNIQUE INDEX idx_fee_receipts_unique_token ON fee_receipts(verification_token);

CREATE TABLE fee_receipt_payments (
  receipt_id INTEGER NOT NULL REFERENCES fee_receipts(id) ON DELETE RESTRICT,
  payment_id INTEGER NOT NULL REFERENCES fee_payments(id) ON DELETE RESTRICT,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  is_active INTEGER NOT NULL CHECK(is_active IN (0,1)),
  PRIMARY KEY(receipt_id,payment_id)
);
CREATE UNIQUE INDEX idx_fee_receipt_payments_active ON fee_receipt_payments(payment_id) WHERE is_active=1;
CREATE INDEX idx_fee_receipt_payments_school_receipt ON fee_receipt_payments(school_id,receipt_id);

-- Validate ALL historical documents before backfilling. A named CHECK provides
-- an actionable stop on malformed JSON, unresolved IDs, totals or tenant links.
CREATE TABLE _finance_0028_preflight (ok INTEGER CONSTRAINT finance_legacy_receipt_review_required CHECK(ok=1));
INSERT INTO _finance_0028_preflight SELECT 0 FROM fee_receipts r WHERE
  NOT json_valid(r.payment_ids_json) OR json_type(r.payment_ids_json)!='array';
INSERT INTO _finance_0028_preflight SELECT 0 FROM fee_receipts r WHERE
  json_array_length(r.payment_ids_json)=0 OR r.status NOT IN ('active','cancelled')
  OR EXISTS(SELECT 1 FROM json_each(r.payment_ids_json) j LEFT JOIN fee_payments p ON p.id=j.value AND p.school_id=r.school_id AND p.student_id=r.student_id
    WHERE j.type!='integer' OR p.id IS NULL)
  OR (SELECT COUNT(DISTINCT value) FROM json_each(r.payment_ids_json))!=json_array_length(r.payment_ids_json)
  OR r.total_amount!=(SELECT SUM(p.amount) FROM fee_payments p JOIN json_each(r.payment_ids_json) j ON p.id=j.value WHERE p.school_id=r.school_id AND p.student_id=r.student_id);
INSERT INTO fee_receipt_payments(receipt_id,payment_id,school_id,is_active)
  SELECT r.id,j.value,r.school_id, CASE WHEN r.status='active' THEN 1 ELSE 0 END
  FROM fee_receipts r,json_each(r.payment_ids_json) j;
DROP TABLE _finance_0028_preflight;

CREATE TRIGGER trg_student_fees_finance_insert BEFORE INSERT ON student_fees BEGIN
  SELECT CASE WHEN NEW.net_fee IS NULL OR NEW.discount_amount IS NULL OR NEW.discount_type IS NULL OR NEW.discount_value IS NULL
    OR NEW.discount_type NOT IN ('none','fixed','percentage') OR NEW.discount_value<0
    OR (NEW.discount_type='none' AND (NEW.discount_value!=0 OR NEW.discount_amount!=0))
    OR (NEW.discount_type='fixed' AND (NEW.discount_value!=CAST(NEW.discount_value AS INTEGER) OR NEW.discount_value>NEW.amount OR NEW.discount_amount!=NEW.discount_value))
    OR (NEW.discount_type='percentage' AND (NEW.discount_value>100 OR round(NEW.discount_value,2)!=NEW.discount_value
      OR NEW.discount_amount!=(CAST(NEW.amount AS INTEGER)/10000)*CAST(round(NEW.discount_value*100) AS INTEGER)
        +((CAST(NEW.amount AS INTEGER)%10000)*CAST(round(NEW.discount_value*100) AS INTEGER)+5000)/10000))
    THEN RAISE(ABORT,'invalid_discount') END;
  SELECT CASE WHEN NEW.currency!='IQD' THEN RAISE(ABORT,'unsupported_finance_currency') END;
  SELECT CASE WHEN NEW.amount<=0 OR NEW.amount>9007199254740991 OR NEW.amount!=CAST(NEW.amount AS INTEGER)
    OR NEW.net_fee<0 OR NEW.net_fee!=CAST(NEW.net_fee AS INTEGER) OR NEW.net_fee>NEW.amount
    OR NEW.discount_amount!=NEW.amount-NEW.net_fee OR NEW.paid_amount!=0
    THEN RAISE(ABORT,'invalid_finance_amount') END;
  SELECT CASE WHEN NEW.fee_type_key IS NULL OR NEW.fee_type_key!=NEW.fee_type
    OR length(NEW.fee_type_key)=0 OR length(NEW.fee_type_key)>120 OR trim(NEW.fee_type_key)!=NEW.fee_type_key OR instr(NEW.fee_type_key,'  ')>0
    THEN RAISE(ABORT,'invalid_finance_request') END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM students s JOIN schools sch ON sch.id=s.school_id WHERE s.id=NEW.student_id AND s.school_id=NEW.school_id AND s.status='active' AND sch.status='active')
    OR (NEW.academic_year_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM academic_years y WHERE y.id=NEW.academic_year_id AND y.school_id=NEW.school_id))
    THEN RAISE(ABORT,'finance_not_found') END;
  SELECT CASE WHEN NEW.status!= CASE WHEN NEW.net_fee=0 THEN 'paid' ELSE 'pending' END THEN RAISE(ABORT,'invalid_finance_request') END;
END;

CREATE TRIGGER trg_student_fees_finance_update BEFORE UPDATE ON student_fees BEGIN
  SELECT CASE WHEN NEW.net_fee IS NULL OR NEW.discount_amount IS NULL OR NEW.discount_type IS NULL OR NEW.discount_value IS NULL
    OR NEW.discount_type NOT IN ('none','fixed','percentage') OR NEW.discount_value<0
    OR (NEW.discount_type='none' AND (NEW.discount_value!=0 OR NEW.discount_amount!=0))
    OR (NEW.discount_type='fixed' AND (NEW.discount_value!=CAST(NEW.discount_value AS INTEGER) OR NEW.discount_value>NEW.amount OR NEW.discount_amount!=NEW.discount_value))
    OR (NEW.discount_type='percentage' AND (NEW.discount_value>100 OR round(NEW.discount_value,2)!=NEW.discount_value
      OR NEW.discount_amount!=(CAST(NEW.amount AS INTEGER)/10000)*CAST(round(NEW.discount_value*100) AS INTEGER)
        +((CAST(NEW.amount AS INTEGER)%10000)*CAST(round(NEW.discount_value*100) AS INTEGER)+5000)/10000))
    THEN RAISE(ABORT,'invalid_discount') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM fee_payments WHERE student_fee_id=OLD.id AND
    (school_id!=OLD.school_id OR student_id!=OLD.student_id OR amount<=0 OR amount>9007199254740991 OR amount!=CAST(amount AS INTEGER)))
    THEN RAISE(ABORT,'payment_treasury_integrity_error') END;
  SELECT CASE WHEN NEW.school_id!=OLD.school_id OR NEW.student_id!=OLD.student_id OR NEW.academic_year_id IS NOT OLD.academic_year_id
    THEN RAISE(ABORT,'finance_operation_stale') END;
  SELECT CASE WHEN NEW.currency!='IQD' OR OLD.currency!='IQD' THEN RAISE(ABORT,'unsupported_finance_currency') END;
  SELECT CASE WHEN NEW.amount<=0 OR NEW.amount>9007199254740991 OR NEW.amount!=CAST(NEW.amount AS INTEGER)
    OR NEW.net_fee<0 OR NEW.net_fee!=CAST(NEW.net_fee AS INTEGER) OR NEW.net_fee>NEW.amount OR NEW.discount_amount!=NEW.amount-NEW.net_fee
    THEN RAISE(ABORT,'invalid_finance_amount') END;
  SELECT CASE WHEN NEW.net_fee<(SELECT coalesce(SUM(CAST(amount AS INTEGER)),0) FROM fee_payments WHERE school_id=NEW.school_id AND student_fee_id=NEW.id AND status='active')
    THEN RAISE(ABORT,'fee_net_below_paid') END;
  SELECT CASE WHEN NEW.paid_amount!=(SELECT coalesce(SUM(CAST(amount AS INTEGER)),0) FROM fee_payments WHERE school_id=NEW.school_id AND student_fee_id=NEW.id AND status='active')
    OR NEW.status!= CASE WHEN NEW.paid_amount>=NEW.net_fee THEN 'paid' WHEN NEW.paid_amount>0 THEN 'partial' ELSE 'pending' END
    THEN RAISE(ABORT,'finance_operation_stale') END;
  SELECT CASE WHEN NEW.fee_type_key IS NULL OR (NEW.fee_type IS NOT OLD.fee_type AND NEW.fee_type_key!=NEW.fee_type)
    THEN RAISE(ABORT,'invalid_finance_request') END;
END;
CREATE TRIGGER trg_student_fees_preserve_payments BEFORE DELETE ON student_fees
WHEN OLD.paid_amount!=0 OR EXISTS(SELECT 1 FROM fee_payments WHERE student_fee_id=OLD.id) BEGIN
  SELECT RAISE(ABORT,'finance_operation_stale');
END;

CREATE TRIGGER trg_fee_payments_finance_insert BEFORE INSERT ON fee_payments BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM treasury_transactions WHERE school_id=NEW.school_id AND status='active' AND currency!='IQD')
    THEN RAISE(ABORT,'unsupported_finance_currency') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM fee_payments WHERE student_fee_id=NEW.student_fee_id AND
    (school_id!=NEW.school_id OR student_id!=NEW.student_id OR amount<=0 OR amount>9007199254740991 OR amount!=CAST(amount AS INTEGER)))
    THEN RAISE(ABORT,'payment_treasury_integrity_error') END;
  SELECT CASE WHEN NEW.status!='active' OR NEW.cancelled_at IS NOT NULL OR NEW.cancel_reason IS NOT NULL
    OR NEW.client_request_id IS NULL OR length(NEW.client_request_id)<16 OR length(NEW.client_request_id)>100 OR NEW.request_fingerprint IS NULL
    THEN RAISE(ABORT,'invalid_finance_request') END;
  SELECT CASE WHEN NEW.amount<=0 OR NEW.amount>9007199254740991 OR NEW.amount!=CAST(NEW.amount AS INTEGER) THEN RAISE(ABORT,'invalid_finance_amount') END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM student_fees f JOIN students s ON s.id=f.student_id AND s.school_id=f.school_id JOIN schools sch ON sch.id=f.school_id
    WHERE f.id=NEW.student_fee_id AND f.school_id=NEW.school_id AND f.student_id=NEW.student_id AND s.status='active' AND sch.status='active')
    THEN RAISE(ABORT,'finance_not_found') END;
  SELECT CASE WHEN (SELECT currency FROM student_fees WHERE id=NEW.student_fee_id)!='IQD' THEN RAISE(ABORT,'unsupported_finance_currency') END;
  SELECT CASE WHEN (SELECT coalesce(net_fee,amount) FROM student_fees WHERE id=NEW.student_fee_id)<=0 THEN RAISE(ABORT,'fee_not_payable') END;
  -- Runs against current DB state INSIDE the writer transaction, not a JS snapshot.
  SELECT CASE WHEN NEW.amount+(SELECT coalesce(SUM(CAST(amount AS INTEGER)),0) FROM fee_payments WHERE student_fee_id=NEW.student_fee_id AND school_id=NEW.school_id AND status='active')
    >(SELECT coalesce(net_fee,amount) FROM student_fees WHERE id=NEW.student_fee_id)
    THEN RAISE(ABORT,'payment_overpay') END;
END;

CREATE TRIGGER trg_fee_payments_post AFTER INSERT ON fee_payments BEGIN
  UPDATE student_fees SET paid_amount=(SELECT SUM(CAST(amount AS INTEGER)) FROM fee_payments WHERE student_fee_id=NEW.student_fee_id AND school_id=NEW.school_id AND status='active'),
    status= CASE WHEN (SELECT SUM(CAST(amount AS INTEGER)) FROM fee_payments WHERE student_fee_id=NEW.student_fee_id AND school_id=NEW.school_id AND status='active')>=coalesce(net_fee,amount) THEN 'paid' ELSE 'partial' END,
    finance_revision=finance_revision+1,updated_at=unixepoch() WHERE id=NEW.student_fee_id AND school_id=NEW.school_id;
  INSERT INTO treasury_transactions(school_id,transaction_type,category,amount,currency,description,source_type,source_id,status,created_by)
    VALUES(NEW.school_id,'income','tuition_fee',NEW.amount,'IQD','دفعة قسط','fee_payment',NEW.id,'active',NEW.created_by_user_id);
  SELECT CASE WHEN abs((SELECT coalesce(SUM( CASE WHEN transaction_type='income' THEN CAST(amount AS INTEGER) ELSE -CAST(amount AS INTEGER) END),0) FROM treasury_transactions WHERE school_id=NEW.school_id AND status='active'))>9007199254740991
    OR EXISTS(SELECT 1 FROM treasury_transactions WHERE school_id=NEW.school_id AND status='active' AND (amount<=0 OR amount!=CAST(amount AS INTEGER)))
    THEN RAISE(ABORT,'invalid_finance_amount') END;
  INSERT INTO treasury_accounts(school_id,current_balance,updated_at)
    SELECT NEW.school_id,coalesce(SUM( CASE WHEN transaction_type='income' THEN CAST(amount AS INTEGER) ELSE -CAST(amount AS INTEGER) END),0),unixepoch()
    FROM treasury_transactions WHERE school_id=NEW.school_id AND status='active'
    ON CONFLICT(school_id) DO UPDATE SET current_balance=excluded.current_balance,updated_at=excluded.updated_at;
END;

CREATE TRIGGER trg_fee_payments_finance_update BEFORE UPDATE ON fee_payments BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM treasury_transactions WHERE school_id=OLD.school_id AND status='active' AND currency!='IQD')
    THEN RAISE(ABORT,'unsupported_finance_currency') END;
  SELECT CASE WHEN NEW.id!=OLD.id OR NEW.school_id!=OLD.school_id OR NEW.student_id!=OLD.student_id OR NEW.student_fee_id!=OLD.student_fee_id
    OR NEW.amount IS NOT OLD.amount OR NEW.payment_method IS NOT OLD.payment_method OR NEW.payment_date IS NOT OLD.payment_date
    OR NEW.notes IS NOT OLD.notes OR NEW.receipt_number IS NOT OLD.receipt_number OR NEW.created_by_user_id IS NOT OLD.created_by_user_id
    OR NEW.created_at IS NOT OLD.created_at OR NEW.client_request_id IS NOT OLD.client_request_id OR NEW.request_fingerprint IS NOT OLD.request_fingerprint
    OR OLD.status!='active' OR NEW.status!='cancelled'
    THEN RAISE(ABORT,'finance_operation_stale') END;
  SELECT CASE WHEN NEW.cancelled_at IS NULL OR NEW.cancelled_at<=0 OR NEW.cancelled_by_user_id IS NULL OR length(trim(coalesce(NEW.cancel_reason,''))) NOT BETWEEN 1 AND 1000
    THEN RAISE(ABORT,'invalid_finance_request') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM fee_receipt_payments WHERE payment_id=OLD.id AND is_active=1) THEN RAISE(ABORT,'payment_receipt_active') END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM treasury_transactions t JOIN student_fees f ON f.id=OLD.student_fee_id AND f.school_id=OLD.school_id AND f.student_id=OLD.student_id
    WHERE t.school_id=OLD.school_id AND t.source_type='fee_payment' AND t.source_id=OLD.id AND t.status='active' AND t.transaction_type='income'
    AND t.category='tuition_fee' AND t.currency='IQD' AND f.currency='IQD' AND t.amount=OLD.amount)
    OR (SELECT COUNT(*) FROM treasury_transactions WHERE source_type='fee_payment' AND source_id=OLD.id)!=1
    OR NOT EXISTS(SELECT 1 FROM treasury_accounts WHERE school_id=OLD.school_id)
    THEN RAISE(ABORT,'payment_treasury_integrity_error') END;
END;
CREATE TRIGGER trg_fee_payments_cancel AFTER UPDATE OF status ON fee_payments WHEN OLD.status='active' AND NEW.status='cancelled' BEGIN
  UPDATE treasury_transactions SET status='cancelled',cancelled_at=NEW.cancelled_at,cancelled_by=NEW.cancelled_by_user_id,cancel_reason=NEW.cancel_reason,updated_at=unixepoch()
    WHERE school_id=NEW.school_id AND source_type='fee_payment' AND source_id=NEW.id AND status='active';
  SELECT CASE WHEN abs((SELECT coalesce(SUM( CASE WHEN transaction_type='income' THEN CAST(amount AS INTEGER) ELSE -CAST(amount AS INTEGER) END),0) FROM treasury_transactions WHERE school_id=NEW.school_id AND status='active'))>9007199254740991
    OR EXISTS(SELECT 1 FROM treasury_transactions WHERE school_id=NEW.school_id AND status='active' AND (amount<=0 OR amount!=CAST(amount AS INTEGER)))
    THEN RAISE(ABORT,'invalid_finance_amount') END;
  UPDATE student_fees SET paid_amount=(SELECT coalesce(SUM(CAST(amount AS INTEGER)),0) FROM fee_payments WHERE student_fee_id=NEW.student_fee_id AND school_id=NEW.school_id AND status='active'),
    status= CASE WHEN (SELECT coalesce(SUM(CAST(amount AS INTEGER)),0) FROM fee_payments WHERE student_fee_id=NEW.student_fee_id AND school_id=NEW.school_id AND status='active')>=coalesce(net_fee,amount) THEN 'paid'
    WHEN (SELECT coalesce(SUM(CAST(amount AS INTEGER)),0) FROM fee_payments WHERE student_fee_id=NEW.student_fee_id AND school_id=NEW.school_id AND status='active')>0 THEN 'partial' ELSE 'pending' END,
    finance_revision=finance_revision+1,updated_at=unixepoch() WHERE id=NEW.student_fee_id AND school_id=NEW.school_id;
  UPDATE treasury_accounts SET current_balance=(SELECT coalesce(SUM( CASE WHEN transaction_type='income' THEN CAST(amount AS INTEGER) ELSE -CAST(amount AS INTEGER) END),0) FROM treasury_transactions WHERE school_id=NEW.school_id AND status='active'),
    updated_at=unixepoch() WHERE school_id=NEW.school_id;
END;
CREATE TRIGGER trg_fee_payments_preserve_history BEFORE DELETE ON fee_payments BEGIN SELECT RAISE(ABORT,'finance_operation_stale'); END;

CREATE TRIGGER trg_fee_receipts_validate_insert BEFORE INSERT ON fee_receipts BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM students s JOIN schools sch ON sch.id=s.school_id WHERE s.id=NEW.student_id AND s.school_id=NEW.school_id AND s.status='active' AND sch.status='active')
    THEN RAISE(ABORT,'finance_not_found') END;
  SELECT CASE WHEN NEW.status!='active' OR NOT json_valid(NEW.payment_ids_json) THEN RAISE(ABORT,'receipt_payment_invalid') END;
  SELECT CASE WHEN json_type(NEW.payment_ids_json)!='array' OR json_array_length(NEW.payment_ids_json) NOT BETWEEN 1 AND 100
    OR (SELECT COUNT(DISTINCT value) FROM json_each(NEW.payment_ids_json))!=json_array_length(NEW.payment_ids_json)
    OR EXISTS(SELECT 1 FROM json_each(NEW.payment_ids_json) WHERE type!='integer' OR value<=0)
    THEN RAISE(ABORT,'receipt_payment_invalid') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM json_each(NEW.payment_ids_json) j LEFT JOIN fee_payments p ON p.id=j.value AND p.school_id=NEW.school_id AND p.student_id=NEW.student_id
    LEFT JOIN student_fees f ON f.id=p.student_fee_id AND f.school_id=p.school_id AND f.student_id=p.student_id
    WHERE p.id IS NULL OR f.id IS NULL OR p.status!='active' OR f.currency!='IQD' OR p.amount<=0 OR p.amount!=CAST(p.amount AS INTEGER))
    THEN RAISE(ABORT,'receipt_payment_invalid') END;
  SELECT CASE WHEN NEW.total_amount!=(SELECT SUM(p.amount) FROM fee_payments p JOIN json_each(NEW.payment_ids_json) j ON j.value=p.id WHERE p.school_id=NEW.school_id AND p.student_id=NEW.student_id)
    OR NEW.total_amount>9007199254740991 THEN RAISE(ABORT,'invalid_finance_amount') END;
END;
CREATE TRIGGER trg_fee_receipts_reserve_payments AFTER INSERT ON fee_receipts BEGIN
  INSERT INTO fee_receipt_payments(receipt_id,payment_id,school_id,is_active) SELECT NEW.id,value,NEW.school_id,1 FROM json_each(NEW.payment_ids_json);
END;
CREATE TRIGGER trg_fee_receipts_immutable BEFORE UPDATE ON fee_receipts BEGIN
  SELECT CASE WHEN NEW.id!=OLD.id OR NEW.school_id!=OLD.school_id OR NEW.student_id!=OLD.student_id OR NEW.receipt_number IS NOT OLD.receipt_number
    OR NEW.total_amount IS NOT OLD.total_amount OR NEW.payment_ids_json IS NOT OLD.payment_ids_json OR NEW.payments_snapshot_json IS NOT OLD.payments_snapshot_json
    OR NEW.settings_snapshot_json IS NOT OLD.settings_snapshot_json OR NEW.student_name_snapshot IS NOT OLD.student_name_snapshot OR NEW.class_name_snapshot IS NOT OLD.class_name_snapshot
    OR NEW.section_name_snapshot IS NOT OLD.section_name_snapshot OR NEW.school_name_snapshot IS NOT OLD.school_name_snapshot OR NEW.academic_year_snapshot IS NOT OLD.academic_year_snapshot
    OR NEW.verification_token IS NOT OLD.verification_token OR NEW.verification_hash IS NOT OLD.verification_hash OR NEW.created_by_user_id IS NOT OLD.created_by_user_id OR NEW.created_at IS NOT OLD.created_at
    OR OLD.status!='active' OR NEW.status NOT IN ('active','cancelled')
    THEN RAISE(ABORT,'finance_operation_stale') END;
  SELECT CASE WHEN NEW.status='cancelled' AND (NEW.cancelled_at IS NULL OR NEW.cancelled_at<=0 OR NEW.cancelled_by_user_id IS NULL OR length(trim(coalesce(NEW.cancel_reason,''))) NOT BETWEEN 1 AND 1000)
    THEN RAISE(ABORT,'invalid_finance_request') END;
  SELECT CASE WHEN NEW.status='active' AND (NEW.cancelled_at IS NOT OLD.cancelled_at OR NEW.cancelled_by_user_id IS NOT OLD.cancelled_by_user_id OR NEW.cancel_reason IS NOT OLD.cancel_reason)
    THEN RAISE(ABORT,'invalid_finance_request') END;
END;
CREATE TRIGGER trg_fee_receipts_release_payments AFTER UPDATE OF status ON fee_receipts WHEN NEW.status='cancelled' AND OLD.status='active' BEGIN
  UPDATE fee_receipt_payments SET is_active=0 WHERE receipt_id=NEW.id AND school_id=NEW.school_id;
END;
CREATE TRIGGER trg_fee_receipts_preserve_history BEFORE DELETE ON fee_receipts BEGIN SELECT RAISE(ABORT,'finance_operation_stale'); END;
CREATE TRIGGER trg_fee_receipt_links_insert BEFORE INSERT ON fee_receipt_payments BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM fee_receipts r JOIN fee_payments p ON p.id=NEW.payment_id AND p.school_id=r.school_id AND p.student_id=r.student_id
    JOIN json_each(r.payment_ids_json) j ON j.value=p.id WHERE r.id=NEW.receipt_id AND r.school_id=NEW.school_id AND r.status='active' AND p.status='active' AND NEW.is_active=1)
    THEN RAISE(ABORT,'receipt_payment_invalid') END;
END;
CREATE TRIGGER trg_fee_receipt_links_update BEFORE UPDATE ON fee_receipt_payments BEGIN
  SELECT CASE WHEN NEW.receipt_id!=OLD.receipt_id OR NEW.payment_id!=OLD.payment_id OR NEW.school_id!=OLD.school_id OR NEW.is_active!=0 OR OLD.is_active!=1
    OR NOT EXISTS(SELECT 1 FROM fee_receipts WHERE id=OLD.receipt_id AND school_id=OLD.school_id AND status='cancelled')
    THEN RAISE(ABORT,'finance_operation_stale') END;
END;
CREATE TRIGGER trg_fee_receipt_links_delete BEFORE DELETE ON fee_receipt_payments BEGIN SELECT RAISE(ABORT,'finance_operation_stale'); END;
CREATE TRIGGER trg_fee_receipts_print_guard BEFORE INSERT ON print_records WHEN NEW.source_type='fee_receipts' BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM fee_receipts WHERE id=NEW.source_id AND school_id=NEW.school_id AND status='active')
    THEN RAISE(ABORT,'receipt_already_cancelled') END;
END;
