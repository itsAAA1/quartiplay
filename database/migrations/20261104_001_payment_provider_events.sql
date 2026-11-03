-- Migration 20261104_001_payment_provider_events
--
-- Durable receipt / reconciliation / manual-review records for signed payment
-- provider (Stripe) webhook events.
--
-- SAFETY
--   * ADDITIVE ONLY: creates two new tables if they do not exist. It does not
--     ALTER, UPDATE, DELETE or DROP anything that already exists.
--   * NEVER run automatically. An operator applies it deliberately, e.g.
--       psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/migrations/20261104_001_payment_provider_events.sql
--     against staging first. Nothing in the application runs migrations.
--   * Requires the existing `transactions` table (FK).
--   * Re-running is a no-op (IF NOT EXISTS / ON CONFLICT DO NOTHING).
--   * The webhook code fails closed (HTTP 503, event NOT acknowledged) until
--     this version row exists in schema_migrations AND the rollout flag
--     PAYMENT_WEBHOOK_RECONCILIATION=enabled is set.
--   * Rollback = unset the rollout flag. Do not drop payment_provider_events
--     once it contains records; it is a financial audit trail.
BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version     VARCHAR(100) PRIMARY KEY,
  applied_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS payment_provider_events (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider               VARCHAR(30)  NOT NULL CHECK (provider IN ('stripe')),
  event_id               VARCHAR(255) NOT NULL,
  event_type             VARCHAR(100) NOT NULL,
  livemode               BOOLEAN,
  payment_intent_id      VARCHAR(255),
  provider_object_id     VARCHAR(255),
  transaction_id         UUID REFERENCES transactions(id) ON DELETE RESTRICT,
  -- settled / already_settled: ledger settlement committed in the same DB transaction.
  -- manual_review: NO automatic money movement was performed; a human must decide.
  outcome                VARCHAR(30)  NOT NULL CHECK (outcome IN ('settled', 'already_settled', 'manual_review')),
  review_status          VARCHAR(30)  CHECK (review_status IN ('pending_review', 'resolved')),
  review_reason          VARCHAR(100),
  -- Hard guarantee that this table never represents an automatic refund/debit.
  automatic_action_taken BOOLEAN      NOT NULL DEFAULT FALSE CHECK (automatic_action_taken = FALSE),
  amount_minor           BIGINT,
  currency               VARCHAR(10),
  payload_sha256         CHAR(64)     NOT NULL,
  summary                JSONB        NOT NULL DEFAULT '{}'::jsonb,
  received_at            TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT payment_provider_events_unique_event UNIQUE (provider, event_id),
  CONSTRAINT payment_provider_events_review_consistency CHECK (
    (outcome = 'manual_review' AND review_status IS NOT NULL AND review_reason IS NOT NULL)
    OR (outcome <> 'manual_review' AND review_status IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_payment_provider_events_intent ON payment_provider_events(payment_intent_id);
CREATE INDEX IF NOT EXISTS idx_payment_provider_events_tx ON payment_provider_events(transaction_id);
CREATE INDEX IF NOT EXISTS idx_payment_provider_events_review ON payment_provider_events(review_status)
  WHERE review_status = 'pending_review';

INSERT INTO schema_migrations (version) VALUES ('20261104_001_payment_provider_events')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
