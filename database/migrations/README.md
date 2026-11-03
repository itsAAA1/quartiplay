# Database migrations (manual, versioned)

Files here are applied **by an operator, deliberately, never automatically** and never
by application start-up, CI, or Vercel. Apply to staging first, then production only
after review. Each file is additive and records itself in `schema_migrations`.

| Version | Purpose | Gate |
|---|---|---|
| `20261104_001_payment_provider_events` | Durable Stripe webhook receipts, ledger reconciliation and manual-review records | Webhook handling stays disabled (HTTP 503, events not acknowledged) until this row exists in `schema_migrations` **and** `PAYMENT_WEBHOOK_RECONCILIATION=enabled` |

Refund and dispute events are stored as `manual_review` / `pending_review` records only.
No automatic refund, debit, reversal or provider call exists; the business rule for those
has not been established.
