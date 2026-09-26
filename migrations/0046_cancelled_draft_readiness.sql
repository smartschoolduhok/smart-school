-- Cancellation before publication is a valid terminal state (the canonical
-- cancel API deliberately leaves publication_status='draft'). Correct only the
-- diagnostic view; never rewrite card snapshots, publication history or grades.
DROP VIEW result_card_publication_readiness;
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
        (card.publication_status = 'draft' AND NOT (
          card.status = 'active' OR (
            card.status = 'cancelled' AND card.publication_revision = 0
            AND card.published_at IS NULL AND card.published_by_user_id IS NULL
            AND card.withdrawn_at IS NULL AND card.withdrawn_by_user_id IS NULL
            AND card.withdrawal_reason IS NULL
            AND NOT EXISTS (SELECT 1 FROM result_card_publication_logs history WHERE history.result_card_id = card.id)
          )
        ))
        OR (card.publication_status = 'published' AND card.status != 'active')
        OR (card.publication_status = 'withdrawn' AND card.status != 'cancelled')
      ) THEN 1 ELSE 0 END), 0) = 0 THEN 'healthy'
    ELSE 'inconsistent'
  END AS status
FROM schools school
LEFT JOIN result_cards card ON card.school_id = school.id
GROUP BY school.id;
