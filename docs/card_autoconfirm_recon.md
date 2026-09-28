# Card-to-card auto-confirm — Phase 0 recon (read-only)

Source: IRFORGE_CARD_AUTOCONFIRM_PROMPT.md, Phase 0. No code was changed by this phase.

## What already exists

### irforge-web
- **Platform-level Blubank open-link + SMS auto-confirm already works** for the platform's own wallet top-up.
  - Tables: `wallet_topups`, `sms_logs` (`lib/db/src/schema/wallet.ts`; runtime DDL in `api-server/migrate.mjs`; mirror `lib/db/migrations/0028_wallet_topups.sql`).
  - Unique suffix per request: `final_amount = requested_amount + suffix`; partial unique index `wallet_topups_pending_final_amount_uk` on `final_amount WHERE status='pending'`; service retries on Postgres `23505` (`api-server/src/lib/walletTopupService.ts`).
  - SMS webhook: `POST /internal/wallet-topup/sms-webhook` (`routes/walletTopupSmsWebhook.ts`), header `X-Sms-Webhook-Secret` vs single global env `SMS_WEBHOOK_SECRET` (timingSafeEqual), atomic conditional `UPDATE ... WHERE final_amount=? AND status='pending'`.
  - Parser: `parseBlubankDepositSms` (Blubank only). Expiry sweeper via `setInterval` in `index.ts`.
  - User/admin routes: `routes/walletTopup.ts`; manual confirm `POST /admin/wallet-topups/:id/manual-confirm`.
  - Wallet credit: `creditWallet` (`lib/wallet.ts`) — credits `requestedAmount`, not `finalAmount`.
- Older receipt/approval models: `payments`, `wallet_transactions` (deposit_card etc.).
- Per-bot `payment_cfg` (`lib/botTypes.ts`): single card, owner, gateway, order_group — stored **plaintext in the bot's Google Sheet**.
- Encryption: `lib/tokenCrypto.ts`, AES-256-GCM, `iv:tag:ct` hex, key `BOT_TOKEN_ENCRYPTION_KEY` (shared with the bot). Plaintext passthrough on decrypt.
- Money: integer **Rial** in DB, Toman at API/UI boundary (`lib/currency.ts`, migration `2026_toman_to_rial_v1` done). `lib/money.ts` does not exist; `currency.ts` is the equivalent. `exchange_rates.rial_per_usd` is `real` (float) — unrelated to this module.
- Migrations: `api-server/migrate.mjs` (idempotent raw SQL, runtime source of truth) + hand-written mirrors in `lib/db/migrations/*.sql` (latest `0028`) + Drizzle schema in `lib/db/src/schema`. All three must be kept in sync (past drift caused 500s).
- Tenant isolation on the site: `resolveBotSheet(userId, botId)` (owner / manager / super_admin). Rate limit: `middleware/rateLimit.ts` (`authRateLimit`, `perUserRateLimit`).
- Site-side notifications: `lib/notify.ts` (`createNotification`, `notifySuperAdmins`). No `notify_admins`, `credit_from_payment`, `account_id`, or IBAN on the site.

### irforge-app
- Nothing for SMS, bank-SMS parsing, unique-amount/suffix, IBAN, or Blubank. The bot is polling-only with **no inbound HTTP server**.
- `handlers/payment.py`: one card (`payment_cfg`), receipt upload (`fsm_upload_receipt`), single approval choke point `finalize_order_approval` (idempotent only via a non-atomic read-then-write), `/ACPT` `/RJCT`. Orders have no `account_id`.
- `plugins/wallet`: bot-side `wallet_topups` (RecordStore in tenant data, statuses pending/approved/rejected/expired, 48h expiry), `credit_from_payment` (`service.py`, serialised by `postgres_store.lock`, no idempotency by reference; idempotency only via `credit_ref` on the top-up row, written *after* the credit — crash window = possible double credit).
- `resolve_receiving_accounts` already probes a not-yet-existing `plugins.payment_accounts.domain.list_active_accounts()` (multi-account was anticipated, never built).
- `notify_admins(bot, text, permission)` — plain text, tenant scoping implicit via contextvar.
- Money: Python `float`, display currency string only, no rial/toman conversion; wallet `DEFAULT_CURRENCY="IRT"`.
- Encryption: `utils/registry_token_crypto.py` (same key/format as the site).
- DB: optional real Postgres (`db_business`, RLS via `SET LOCAL app.tenant_id`, one transaction per call); most tenant data is Sheets or generic `tenant_records`. No cross-call `FOR UPDATE`, no unique constraints on Sheets-backed data. Latest bot migration `0039`.
- Sweepers: `ext.register_scheduled_task(...)` (60s tick, per-tenant).

## Decisions

1. **The module lives in the irforge-web app database** (relational Postgres, real partial unique indexes and `FOR UPDATE`), with the SMS webhook in `api-server`. The bot cannot host an inbound endpoint and cannot give DB-level uniqueness for Sheets-backed tenants, so it talks to the site over an internal authenticated API (added in later phases).
2. **New unified tables** `payment_channels`, `payment_requests`, `sms_inbox` (with `purpose`), rather than extending `wallet_topups`. Reason: existing `wallet_topups` is platform-only, keyed by a single global amount space; the new module needs per-channel uniqueness, `scope/bot_id`, `queued` state, and order purpose. Old rows migrate in Phase 8 (idempotent script); the old path is then disabled, not left parallel.
3. All money = **integer Rial**, `bigint` columns (`lib/currency.ts` conventions; Toman only at the API/UI edge).
4. Card numbers and channel secrets: card number AES-256-GCM via `tokenCrypto`; SMS secret stored as hash only. Card numbers masked in logs.
5. Bot-side wallet crediting and order approval keep their existing entry points; auto-confirm must call them through a single claim (DB-level unique claim on the confirmed request/SMS) to avoid the double-credit windows above.

## Risks / conflicts
- `/internal/wallet-topup/sms-webhook` and `SMS_WEBHOOK_SECRET` are global and already in use; the new per-channel endpoint must not collide with or weaken it.
- Two sources of truth for top-ups (site `wallet_topups`, bot `wallet_topups`) — the new module must not add a third without retiring one.
- Unit convention: bank SMS is Rial; bot orders are float Toman. Conversion must be explicit at the bot↔site boundary.
- `payment_cfg.card_number` is plaintext in Sheets today.
- Three places to change per new table (Drizzle schema, `migrate.mjs`, mirror `.sql`).
