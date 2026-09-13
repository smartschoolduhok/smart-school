-- Phase 20D.1: controlled result publication and parent visibility.
-- Existing cards keep their historical public behavior. New cards are issued
-- as drafts by the application and require an explicit publication action.

ALTER TABLE result_cards
ADD COLUMN publication_status TEXT NOT NULL DEFAULT 'draft'
  CHECK (publication_status IN ('draft', 'published', 'withdrawn'));

ALTER TABLE result_cards
ADD COLUMN publication_revision INTEGER NOT NULL DEFAULT 0
  CHECK (publication_revision >= 0);

ALTER TABLE result_cards ADD COLUMN published_at INTEGER;
ALTER TABLE result_cards ADD COLUMN published_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE result_cards ADD COLUMN withdrawn_at INTEGER;
ALTER TABLE result_cards ADD COLUMN withdrawn_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE result_cards ADD COLUMN withdrawal_reason TEXT;

-- Preserve the meaning of historical cards: active/printed cards were already
-- publicly verifiable, while cancelled cards were already withdrawn.
UPDATE result_cards
SET publication_status = CASE WHEN status = 'cancelled' THEN 'withdrawn' ELSE 'published' END,
    publication_revision = 1,
    published_at = generated_at,
    withdrawn_at = CASE WHEN status = 'cancelled' THEN updated_at ELSE NULL END,
    withdrawal_reason = CASE WHEN status = 'cancelled' THEN 'سجل تاريخي ملغى قبل دورة النشر' ELSE NULL END;

CREATE TABLE result_card_publication_logs (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id             INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  result_card_id        INTEGER NOT NULL REFERENCES result_cards(id) ON DELETE RESTRICT,
  action                TEXT NOT NULL CHECK (action IN ('published', 'withdrawn')),
  previous_status       TEXT NOT NULL CHECK (previous_status IN ('draft', 'published')),
  new_status            TEXT NOT NULL CHECK (new_status IN ('published', 'withdrawn')),
  previous_revision     INTEGER NOT NULL CHECK (previous_revision >= 0),
  new_revision          INTEGER NOT NULL CHECK (new_revision = previous_revision + 1),
  reason                TEXT,
  actor_user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at            INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (result_card_id, action, new_revision)
);

CREATE TABLE result_card_publication_write_assertions (
  request_id            TEXT PRIMARY KEY,
  result_card_id        INTEGER NOT NULL,
  expected_revision     INTEGER NOT NULL CHECK (expected_revision >= 0),
  expected_status       TEXT NOT NULL CHECK (expected_status IN ('draft', 'published')),
  validated             INTEGER NOT NULL CHECK (validated = 1)
);

CREATE INDEX idx_result_cards_publication_school
ON result_cards(school_id, publication_status, academic_year_id, student_id);

CREATE INDEX idx_result_card_publication_logs_card
ON result_card_publication_logs(school_id, result_card_id, id);

CREATE TRIGGER trg_result_card_publication_transition
BEFORE UPDATE OF publication_status, publication_revision, published_at,
  published_by_user_id, withdrawn_at, withdrawn_by_user_id, withdrawal_reason
ON result_cards
BEGIN
  SELECT RAISE(ABORT, 'result_card_publication_invalid_transition')
  WHERE NOT (
    (OLD.publication_status = 'draft' AND NEW.publication_status = 'published')
    OR (OLD.publication_status = 'published' AND NEW.publication_status = 'withdrawn')
  );

  SELECT RAISE(ABORT, 'result_card_publication_stale')
  WHERE NEW.publication_revision != OLD.publication_revision + 1;

  SELECT RAISE(ABORT, 'result_card_publication_invalid_state')
  WHERE (
    NEW.publication_status = 'published'
    AND (
      NEW.status != 'active'
      OR NEW.published_at IS NULL
      OR NEW.published_by_user_id IS NULL
      OR NEW.withdrawn_at IS NOT NULL
      OR NEW.withdrawn_by_user_id IS NOT NULL
      OR NEW.withdrawal_reason IS NOT NULL
    )
  ) OR (
    NEW.publication_status = 'withdrawn'
    AND (
      NEW.status != 'cancelled'
      OR NEW.published_at IS NULL
      OR NEW.withdrawn_at IS NULL
      OR NEW.withdrawn_by_user_id IS NULL
      OR length(trim(COALESCE(NEW.withdrawal_reason, ''))) = 0
      OR length(NEW.withdrawal_reason) > 1000
    )
  );
END;

CREATE TRIGGER trg_result_card_published_cancel_guard
BEFORE UPDATE OF status ON result_cards
WHEN OLD.publication_status = 'published'
  AND NEW.status = 'cancelled'
  AND NEW.publication_status != 'withdrawn'
BEGIN
  SELECT RAISE(ABORT, 'published_result_card_requires_withdrawal');
END;

CREATE TRIGGER trg_result_card_publication_log_validate
BEFORE INSERT ON result_card_publication_logs
BEGIN
  SELECT RAISE(ABORT, 'result_card_publication_log_invalid')
  WHERE NOT EXISTS (
    SELECT 1 FROM result_cards card
    WHERE card.id = NEW.result_card_id AND card.school_id = NEW.school_id
  );

  SELECT RAISE(ABORT, 'result_card_publication_actor_invalid')
  WHERE NEW.actor_user_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM users actor
      WHERE actor.id = NEW.actor_user_id
        AND actor.status = 'active'
        AND (actor.school_id = NEW.school_id OR actor.school_id IS NULL)
    );
END;

CREATE TRIGGER trg_result_card_publication_log_immutable_update
BEFORE UPDATE ON result_card_publication_logs
BEGIN
  SELECT RAISE(ABORT, 'result_card_publication_log_immutable');
END;

CREATE TRIGGER trg_result_card_publication_log_immutable_delete
BEFORE DELETE ON result_card_publication_logs
BEGIN
  SELECT RAISE(ABORT, 'result_card_publication_log_immutable');
END;

CREATE VIEW result_card_publication_readiness AS
SELECT
  school.id AS school_id,
  COUNT(card.id) AS total_cards,
  COALESCE(SUM(CASE WHEN card.publication_status = 'draft' THEN 1 ELSE 0 END), 0) AS draft_cards,
  COALESCE(SUM(CASE WHEN card.publication_status = 'published' THEN 1 ELSE 0 END), 0) AS published_cards,
  COALESCE(SUM(CASE WHEN card.publication_status = 'withdrawn' THEN 1 ELSE 0 END), 0) AS withdrawn_cards,
  CASE
    WHEN COALESCE(SUM(CASE
      WHEN card.id IS NOT NULL AND (
        (card.publication_status = 'draft' AND card.status != 'active')
        OR (card.publication_status = 'published' AND card.status != 'active')
        OR (card.publication_status = 'withdrawn' AND card.status != 'cancelled')
      ) THEN 1 ELSE 0 END), 0) = 0 THEN 'healthy'
    ELSE 'inconsistent'
  END AS status
FROM schools school
LEFT JOIN result_cards card ON card.school_id = school.id
GROUP BY school.id;
