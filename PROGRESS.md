# PROGRESS.md — DATA UNIFICATION (env-var unification across mainbot / support-bot / web)

Source prompt: `ClaudeCode_Prompt_DataUnification_GoLive.md` (see mainbot
repo root for the full text — this repo doesn't carry a copy). Goal: unify
the env var names each of the three services (`mainbot`, `support-bot`,
`web`) use for the shared registry spreadsheet and Google credentials,
before going live on Railway. Read this file first in every fresh session
for this task, before starting the next phase.

## Status table

| Phase | Status | Notes |
|---|---|---|
| Phase 1 — documentation only | ✅ done | Created `docs/DATA_UNIFICATION.md` (identical content across all three repos). No code files touched in this repo. Confirmed in `api-server/src/lib/sheets.ts` that credential loading currently supports **only** the split `GOOGLE_SERVICE_ACCOUNT_EMAIL`/`GOOGLE_SERVICE_ACCOUNT_KEY` form — `GOOGLE_CREDENTIALS_JSON` isn't accepted at all yet, so Phase 4 needs to add real JSON-parsing, not just a fallback. Confirmed in `api-server/src/lib/sheetsSync.ts` that `SHEETS_REGISTRY_ID` is the registry spreadsheet (unify target) while `SHEETS_DATA_ID` is a **separate**, unrelated business-data mirror spreadsheet (Postgres is source of truth there; the sheet is a fire-and-forget mirror) — out of scope for this unification. No `.env.example` currently exists under `api-server/`; only `irforge/.env.example` exists (frontend-only vars, unaffected by this task). |
| Phase 2 — mainbot unification | ✅ done | Not this repo — done in `mainbot`. `REGISTRY_SPREADSHEET_ID` is now the single canonical var there, with fallback to legacy `SPREADSHEET_ID`; `GOOGLE_CREDENTIALS_JSON` was already the target format. |
| Phase 3 — support-bot unification | ✅ done | Not this repo — done in `support-bot`. `config.py` now reads `REGISTRY_SPREADSHEET_ID`/`GOOGLE_CREDENTIALS_JSON` first, falling back to legacy `MASTER_REGISTRY_SHEET_ID`/`GOOGLE_SERVICE_ACCOUNT_JSON`; fail-fast behavior preserved. |
| Phase 4 — web/api-server unification | ✅ done | `src/lib/sheets.ts`: `getAuth()` now checks `GOOGLE_CREDENTIALS_JSON` first — new `parseCredentialsJson()` helper JSON-parses it and extracts `client_email`/`private_key` (unescaping literal `\n` in the key, same as the legacy path already did). Falls back to the legacy split `GOOGLE_SERVICE_ACCOUNT_EMAIL`/`GOOGLE_SERVICE_ACCOUNT_KEY` vars only if `GOOGLE_CREDENTIALS_JSON` isn't set. This was a genuine feature add, not just a rename — the split-var path was the *only* one that existed before Phase 4; confirmed in Phase 1's audit. `src/lib/sheetsSync.ts`: `registrySheetId()` now reads `REGISTRY_SPREADSHEET_ID` first, falling back to the legacy `SHEETS_REGISTRY_ID` — and is now **exported** (previously private) so other modules resolve the registry id the same way instead of re-reading the env var directly. `SHEETS_DATA_ID` (`dataSheetId()`) is untouched, confirmed still separate/out of scope per Phase 1. **Follow-up consistency fix (this phase, not in the original prompt but needed so the fallback is honored everywhere):** `src/routes/database.ts` (the admin "Database" browser) was reading `process.env.SHEETS_REGISTRY_ID` directly in two places (`resolveTarget()` and the `/database/targets` listing endpoint) — if only `REGISTRY_SPREADSHEET_ID` were set on Railway, the super-admin registry-sheet browser would've silently disappeared even though `sheetsSync.ts` itself worked fine. Both call sites now import and use the exported `registrySheetId()` resolver instead. No business logic changed — same permission checks, same response shape, same error messages. Created `api-server/.env.example` (didn't exist before) documenting `DATABASE_URL`/server/auth/Telegram vars for completeness, plus the unified-vs-legacy Sheets vars with inline comments explaining the fallback. No live Google/network calls made (no real credentials in this sandbox), per the prompt's rule — only static JSON.parse of the (absent) env var. `pnpm install` (all 7 workspace packages) then `pnpm --filter @workspace/api-server run build` (esbuild via `build.mjs`) passes clean — `Build complete → dist/index.cjs`. The one warning present (`import.meta` not available in cjs output, `src/app.ts:17`) is pre-existing and unrelated to this phase's files. |
| Phase 5 — final verification + Railway checklist | ✅ done | No code changes. Re-ran `pnpm install` + `pnpm --filter @workspace/api-server run build` (still clean) and `pnpm --filter @workspace/irforge run build` (clean — vite build succeeds, only pre-existing/unrelated warnings: sourcemap-reporting notices on a few `ui/*` files and a chunk-size-over-500kB notice, neither caused by this task). Added the final "چک‌لیست Railway" section to `docs/DATA_UNIFICATION.md` (identical content copied to all three repos): build/compile status table for all three services, the exact final env var × service table (`REGISTRY_SPREADSHEET_ID` + `GOOGLE_CREDENTIALS_JSON` shared across all three; `SHEETS_DATA_ID`/`DATABASE_URL` web-only; `BUSINESS_DATABASE_URL` mainbot-only, optional, out of scope), and a list of the now-optional legacy var names per service. Also updated section 4 to reflect phases 2-4 as complete instead of pending.

---

## FULL DELETION + EXPIRY POLICY — manual delete + post-grace expiry cascade

**Separate, unrelated tracker from the one above.** Source prompt:
`ClaudeCode_Prompt_FullDeletion_ExpiryPolicy.md` (see `mainbot` repo root
for the full text — this repo doesn't carry a copy). Goal: when a bot is
deleted (manually via the website, or automatically after a subscription's
grace period fully expires in `mainbot`), fully purge it everywhere — site
Postgres, the registry sheet (`tenants` + `sheet_pool`), and the tenant's
dedicated Google spreadsheet (trashed via Drive API, not just emptied).
This repo (`web`) owns phase 2 of this task (wiring the delete route +
internal purge endpoint); phases 3-4 (Drive-trash worker + real expiry
policy) live in `mainbot`.

| Phase | Status | Notes |
|---|---|---|
| Phase 1 — documentation only | ✅ done | Created `docs/DELETION_POLICY.md` (identical content across all three repos). No code files touched in this repo. Confirmed via `grep`/direct inspection: `api-server/src/lib/sheetsSync.ts` already exports `syncTenantDelete(botToken)` and `syncSheetPoolUpsert({...})` but neither is called anywhere; `DELETE /api/bots/:botId` in `api-server/src/routes/bots.ts` (line ~804) currently only deletes `commands`/`installed_plugins`/the bot row from Postgres and calls `syncBotDelete()` (the `SHEETS_DATA_ID` mirror) — it does not touch the registry (`tenants`) or `sheet_pool` at all today. Doc contains: text-flow diagrams for the manual-delete path and the expiry path (shared `deletion_queue` tab in the registry sheet + a new internal `POST /internal/bots/:botId/purge` endpoint, protected by `X-Internal-Secret`/`INTERNAL_PURGE_SECRET` rather than normal `requireAuth`, for when `mainbot` triggers a purge on expiry + a periodic Drive-trash worker in mainbot), the warning/deletion schedule table (day 0 → warning 1, day 4 → warning 2, day 7 → permanent deletion), an idempotency/race-safety note (the purge endpoint must no-op/404 safely if called twice), and a ⚠️ manual-verification section: the service account's Google Cloud Console scopes must include Drive API (`.../auth/drive`) or spreadsheet trashing will silently fail — a manual check for the user (Ali), not something a coding session can verify. |
| Phase 2 — website: wire up full delete + queue | ✅ done | `src/lib/sheetsSync.ts`: added `syncDeletionQueueAdd({bot_token, tenant_sheet_id, requested_by})` — appends a row (not KV-upsert; this tab is a queue, not a keyed record store) to a new `deletion_queue` tab in the registry spreadsheet (`bot_token, tenant_sheet_id, requested_by, requested_at, status`), auto-creating the tab + real 5-column header via `listTabs`/`addTab` (which normally seeds a generic `[key,value]` header — immediately overwritten with the real header) if it doesn't exist yet. `src/routes/bots.ts`: extracted a shared `purgeBotFully(bot, requestedBy)` helper — deletes `commands`/`installed_plugins`/the bot row from Postgres, then calls `syncBotDelete` (unchanged), **`syncTenantDelete` and `syncSheetPoolUpsert`, wired in for the first time** (they existed since before this task but were never called from anywhere), and the new `syncDeletionQueueAdd`. `DELETE /api/bots/:botId` now calls this helper with `requested_by: "manual"` instead of only `syncBotDelete`. New route `POST /internal/bots/:botId/purge` added (registered on the same router, so its real path is `/api/internal/bots/:botId/purge` — see the assumption note below): checks `X-Internal-Secret` header against `process.env.INTERNAL_PURGE_SECRET` (403 if missing/mismatched) instead of `requireAuth`; looks the bot up by id only (no user filter — there's no logged-in user on this call); calls the same `purgeBotFully(bot, "expiry")` helper. **Idempotent as required:** if the bot row is already gone (already purged, or raced with a manual delete), it returns a safe `404` rather than throwing/crashing. `INTERNAL_PURGE_SECRET` added to `.env.example` with a note that it must match `mainbot`'s value exactly. **Assumption made (not specified in the prompt, flagged per Phase 1's rules):** the prompt's literal path was `POST /internal/bots/:botId/purge` with no `/api` prefix, but every route in this codebase — including this new one — is mounted through the single router in `src/routes/index.ts`, itself mounted at `app.use("/api", router)` in `app.ts`; splitting out a second unprefixed router just for this one route would be inconsistent with the rest of the app and gains nothing. So the real path is `/api/internal/bots/:botId/purge`, and mainbot's Phase 4 must set `WEBSITE_API_URL` to the site's base URL *including* `/api` (matching how the frontend's own `VITE_API_URL` + generated client already work) — documented in this repo's `.env.example` comment and flagged here for Phase 4 to pick up. **Build verification:** `pnpm install` (all 7 workspace packages) clean; `pnpm --filter @workspace/api-server run build` (esbuild) — clean, `Build complete → dist/index.cjs` (same single pre-existing unrelated `import.meta`/cjs warning as before, in `src/app.ts`, untouched by this change); `pnpm --filter @workspace/irforge run build` (vite) — clean, same pre-existing sourcemap/chunk-size warnings as before. Also ran `npx tsc --noEmit` as an extra check — it surfaces a pre-existing, repo-wide set of errors (implicit-`any` params in several unrelated route files, and `@workspace/db`'s project-reference `.d.ts` not being pre-built) that exist independently of this change and are not in any of the lines touched this phase; the real build (esbuild) already confirmed clean, which is this project's actual build gate. No `.tsbuildinfo` artifact left behind. |
| Phase 3 — mainbot: process deletion queue (Drive trash) | ✅ done | Not this repo — done in `mainbot` (`bot/utils/deletion_worker.py`). |
| Phase 4 — mainbot: real 7-day expiry policy | ✅ done | Not this repo — done in `mainbot` (`bot/utils/expiry_worker.py`). **⚠️ Flagged gap surfaced during that phase, relevant to this repo too:** mainbot's `_purge_on_website()` calls this repo's `POST /api/internal/bots/:botId/purge` using `bot_token` in the `:botId` slot, because the registry never learns this repo's internal `bots.id` UUID (`syncTenantUpsert` doesn't write it, and `bots.token` is stored `aes-256-gcm`-encrypted with a random IV, so it can't be looked up by equality either). Today that call always 404s — a safe no-op per this route's own idempotent contract, never a crash — but it means **the expiry path never actually purges this repo's Postgres bot row today**; only the manual delete route (which already has the UUID from the session) does. Needs a follow-up phase on one side: either carry `bots.id` into the registry `tenants` tab, or have this route accept/look up by token. Not fixed in Phase 4 or 5 since it's a cross-repo architecture decision outside "mainbot-only"/"no code changes" scope for those phases. |
| Phase 5 — final verification | ✅ done | No code changes in this repo this phase. Re-confirmed `pnpm install` + `pnpm --filter @workspace/irforge run build` + `pnpm --filter @workspace/api-server run build` still both clean (see mainbot's PROGRESS.md for the full three-service verification summary and final env-var/Railway checklist). |

**New env var this phase:** `INTERNAL_PURGE_SECRET` (this service). Must be
set to the *exact same* value as `INTERNAL_PURGE_SECRET` in the `mainbot`
service on Railway once Phase 4 lands — otherwise every purge call from
mainbot gets a 403. Not required yet (Phase 4 doesn't exist yet in mainbot),
but safe to set now; the route just 403s until both sides have it and
mainbot actually starts calling it.

---

# FIX ROUND 2 — `IrForge_Fixes_Round2_ClaudeCode_Prompt.md`

**Separate, unrelated tracker from the two above.** One phase per commit.

## Phase 0 — setup / baseline  [DONE 2026-08-09]
Files touched: none (repo import only).
Decisions / deviations: The prompt has no Phase 0; treated it as environment setup since
the repo arrived as `irforge-web-main (7).zip` rather than an existing checkout. Extracted
to `C:\Users\alida\OneDrive\Desktop\claude\irforge-web`, `pnpm install` (pnpm 9.15.9 via
`npx`, since pnpm is not on PATH — `node` is v24.19.0), `git init` + baseline commit so each
phase lands as its own commit.
**Baseline captured before any edits** — this matters because the prompt's "typecheck must
pass" gate is not currently satisfiable:
- `pnpm -r build` → **passes clean** (vite + SSG prerender of 10 pages + esbuild api-server).
  This is the real gate, as the earlier trackers in this file also concluded.
- `pnpm -r typecheck` → **fails on pre-existing errors unrelated to this prompt**: ~40
  `TS7006` implicit-any params across `api-server/src/routes/*`, `TS6305` on
  `lib/db/dist/index.d.ts` (project-reference output never built; `lib/db` has no build
  script), and one frontend error, `irforge/src/components/admin/AllBotsTable.tsx:68`
  `TS2741` (missing `queryKey`).
  Therefore the per-phase gate used from here on is: **`pnpm -r build` passes, and
  `pnpm -r typecheck` introduces no error that isn't in this baseline set.**
Follow-ups left open: the pre-existing typecheck failures above are not fixed by this prompt;
worth a cleanup pass of its own. Note `qrcode.react` is already in `irforge/package.json`
dependencies even though Phase 8 (which adds it) has not run — a leftover from an earlier
round; harmless, and Phase 8 will not need to add it.

## Phase 1 — Admin panel Payments tab: wallet deposits only  [DONE 2026-08-09]
Files touched: `irforge/src/components/admin/PaymentApprovals.tsx` (only file).
Decisions / deviations: none — the stated diagnosis matched the code exactly. Deleted the
whole `{/* Bot purchase receipts */}` section and everything only it used: the `pending`
query on `/api/bots/pending-payments`, `PENDING_KEY`, the `PendingPayment` type, `actBot`,
`cancelOrder`, `botNotFound`, `confirmCancel`, and the imports `ExternalLink`, `Ban`,
`AlertTriangle` and `getAdminGetStatsQueryKey` (that last one was referenced only from the
two deleted handlers — confirmed nothing else in the file used it). `isLoading` is now
destructured off the **deposits** query instead of the deleted pending query, so the
skeleton still renders. Kept `WALLET_KEY`, `actDeposit`, and the shared `notes`/`busyId`
state. The `/api/bots/pending-payments` endpoint was **not** touched, per the prompt — bot
receipt review stays on the super-admin page (Phase 12).
Verification: `pnpm --filter @workspace/irforge typecheck` → the only error is the
pre-existing `AllBotsTable.tsx:68` from the Phase 0 baseline; no new errors, no dead imports.
Follow-ups left open: none for this phase. Phase 12 still owes this page's counterpart the
wallet-deposits section so nothing awaiting review is orphaned in the meantime.

## Phase 2 — Announcements tab actually works  [DONE 2026-08-09]
Files touched: `api-server/src/routes/admin.ts`,
`irforge/src/components/admin/AnnouncementsManager.tsx`.
No spec change, so `lib/api-client-react/` was **not** regenerated.

### What was actually wrong — the prompt's headline diagnosis was wrong
The prompt said creating/listing/deleting was broken. **It isn't.** Rather than
guess, the endpoints were exercised end-to-end against a real Postgres (see
"Reproduction method" below) as `admin`, as `super_admin` and as a plain user.
The happy path already worked for both admin roles: `GET` 200, `POST` 201,
`DELETE` 204, and a plain user correctly got 403. So:
- **Suspicion 1 (wrong endpoint / auth mismatch) — ruled out.** The generated
  client points all three operations at `/api/admin/announcements`, which is
  exactly where the `requireAdmin` routes live, and `requireAdmin` admits both
  `admin` and `super_admin` (`auth.ts:97`). Verified live: 200 for both roles,
  403 only for a plain user. The tenant-facing `GET /api/announcements`
  (`requireAuth`) is a separate, deliberate route for the dashboard and is not
  what the admin tab calls.
- **Suspicion 3 (stale hooks) — ruled out.** `useListAnnouncements` /
  `useCreateAnnouncement` / `useDeleteAnnouncement` match the live routes in
  path, method and payload shape.
- **Suspicion 2 (no validation) — confirmed, and worse than described.**

Two real defects, both fixed:

1. **`GET /api/admin/announcements` had no `ORDER BY`** (`db.select().from(...)`
   bare). Postgres is free to return rows in any order, and in the reproduction
   it did — the admin list came back in a visibly different order from the
   tenant-facing list, which *does* order by `createdAt desc`. A freshly
   published announcement could therefore land anywhere in "Current
   announcements", which presents to a user as "publishing did nothing". This
   is the most plausible source of the reported symptom. Now ordered
   newest-first, matching `GET /api/announcements`.
2. **`POST /api/admin/announcements` had no validation at all** —
   `title`/`message`/`type` went from `req.body` straight into the insert.
   Measured before the fix / after the fix:

   | request | before | after |
   |---|---|---|
   | whitespace-only title | **201** (junk row persisted) | 400 `Title is required` |
   | missing `message` | **500** (NOT NULL violation leaked as opaque 500) | 400 `Message is required` |
   | empty body `{}` | **500** | 400 `Title is required` |
   | `type: "nope"` | **201** (out-of-set value persisted) | 400 `Type must be one of: info, warning, success, error` |
   | 5000-char title | **201** | 400 `Title must be at most 200 characters` |
   | numeric title `12345` | **201** (coerced to `"12345"`) | 400 `Title is required` |
   | valid input | 201 | 201 (unchanged) |

   Title/message are trimmed before insert. Limits chosen: title 200, message
   4000 — not specified in the prompt, picked to be comfortably above real use
   and well under any Postgres `text` concern.

On the client, `AnnouncementsManager.tsx` gained a small `serverMessage(err)`
helper used by both mutation `onError` handlers: `ApiError.message` renders as
`"HTTP 400 Bad Request: Title is required"`, so the raw `err.data.error` is
preferred when present and the toast shows just `Title is required`. The
component's existing inline `const fa = lang === "fa"` style was kept — no
locale files touched, per the i18n ground rule about matching the file.

### Reproduction method (no staging environment available here)
There is no Postgres, Docker or `psql` on this machine and no credentials for
the real deployment, so "log in as admin and capture the failure" was done
against a **real Postgres running in-process**: PGlite exposed over the actual
Postgres wire protocol on `127.0.0.1:55432`, with the schema applied from
`drizzle-kit generate` DDL, and the **unmodified** api-server pointed at it via
`DATABASE_URL`. Roles were bootstrapped through the app's own API
(`POST /auth/super-admin-code`, then `PATCH /admin/users/:id`), not by direct
SQL. Harness files are `api-server/_repro_*.mjs`, gitignored, and removed in the
cleanup at the end of Phase 5; `@electric-sql/pglite` + `@electric-sql/pglite-socket`
were added as `api-server` devDependencies for the same reason and are removed
in that same cleanup. Two harness caveats worth recording: PGLiteSocketServer
serves only **one** wire connection at a time (hence the schema is applied
in-process and the app's pool is pinned to `max: 1`), and it leaves socket
`ECONNRESET` unhandled, which crashes it unless swallowed.
Verification: `pnpm -r build` clean; `pnpm --filter @workspace/irforge typecheck`
shows only the pre-existing `AllBotsTable.tsx:68` baseline error.
Follow-ups left open: `DELETE /api/admin/announcements/:id` returns **204 for an
id that does not exist**, silently reporting success for a no-op delete. Out of
this phase's stated scope (which is about POST) and harmless to the UI, but it
should probably be a 404. Not changed here to avoid an unrequested contract
change on an endpoint the prompt didn't ask about.

## Phase 3 — Notification events (backend)  [DONE 2026-08-09]
Files touched: `api-server/src/lib/notify.ts` (new), `api-server/src/routes/bots.ts`,
`api-server/src/routes/wallet.ts`, `api-server/src/routes/tickets.ts`,
`api-server/src/routes/admin.ts`.

`notify.ts` exports `createNotification(input)` exactly as specified, plus three
things the prompt implied but didn't name:
- `createNotificationsBulk(userIds, input)` — the announcement fan-out in one
  batched `db.insert(...).values([...])`, as required. It resolves the shared
  `dedupeKey` with a single query and filters out users who already have that
  row, so a retry inserts nothing.
- `formatTomanFa(amount)` — every money figure in a notification goes through it
  (`۱۲۰٬۰۰۰ تومان`), so no notification says only "پرداخت انجام شد".
- `severityForAnnouncementType(type)` — `error`→critical, `warning`→warning,
  else info.
Both creators are wrapped in try/catch and only `logger.warn` on failure, the
same shape as `sendTelegramMessage`.

All eleven events are wired and were **verified live** against the harness from
Phase 2 (rows read back through `GET /api/notifications`):

| event | type | severity | verified |
|---|---|---|---|
| wallet purchase succeeded | `purchase_success` | info | ✅ 201 + row |
| insufficient balance | `purchase_failed` | warning | ✅ 400 + row |
| plugin purchased | `plugin_purchased` | info | ✅ |
| receipt approved | `payment_approved` | info | ✅ |
| receipt rejected | `payment_rejected` | **critical** | ✅ |
| order cancelled | `order_cancelled` | **critical** | ✅ |
| deposit approved | `deposit_approved` | info | ✅ |
| deposit rejected | `deposit_rejected` | warning | ✅ |
| admin replied to ticket | `ticket_reply` | info | ✅ (owner, not sender) |
| ticket closed | `ticket_closed` | info | ✅ |
| announcement published | `announcement` | mirrors type | ✅ `error`→critical, 1 row/user |

Messages carry the concrete detail: bot name + amount + admin code on purchase,
plugin name + version + price, ticket subject + a 160-char reply preview,
deposit amount + resulting balance, and the reviewer's `reviewNote` as the
reason on every rejection. Tone follows `lib/trial.ts` (informal "کن/بزن").

Decisions / deviations:
- **Fan-out `type`** — the table says "mirror the announcement's own type" for
  *severity*; it doesn't give a notification `type` string. Used the literal
  `"announcement"` as `type` and mirrored the announcement's type into
  `severity` only, so the front end can key off one stable type.
- **`ticket_reply` guard** — notifies `ticket.userId` and is skipped when the
  replying staff member *is* the ticket owner, so an admin never notifies
  themselves about their own reply.
- **`ticket_closed` guard** — fires only on a real transition
  (`ticket.status !== "closed"`), so re-closing an already-closed ticket does
  not re-notify.
- **`order_cancelled`** — the cancel route exists precisely for orders whose bot
  may already be deleted, so the message falls back from the bot name to the
  order amount, then to "سفارش شما".
- **`purchase_failed`** — fires on the `insufficient` branch only, before the
  400 is returned.

Verification: every event driven through the real API (harness restarted between
runs — see the caveat below), plus the failure guarantee tested directly: with
a temporary forced `throw` inside both creators, `POST /tickets/:id/messages`
still returned **201**, `POST /admin/wallet-deposits/:id/approve` still returned
**200 with the balance credited**, and `POST /admin/announcements` still returned
**201**, with zero notification rows written and three
`... failed (non-fatal)` warns logged. The temporary throw was removed
afterwards — `grep NOTIFY_FORCE_FAIL` over `src/` is empty. `pnpm -r build`
clean.
Harness caveat learned this phase: the PGlite wire server does not survive the
api-server reconnecting, so **both** processes must be restarted together for
each run; a stale socket shows up as `Connection terminated unexpectedly` on the
app's first query.
Follow-ups left open: notifications are only ever created — nothing prunes them,
so `notifications` grows without bound per user (`GET /notifications` caps its
read at 50, which hides but does not solve this). Also, the events are fired
after the parent write commits, not inside its transaction: if the process dies
in between, the write lands without its notification. Both are acceptable for
this feature's purpose but worth a retention/outbox pass later.

## Phase 4 — Notification bell + sidebar severity indicator  [DONE 2026-08-09]
Files touched: `irforge/src/hooks/use-notifications.ts`,
`irforge/src/components/layout/notification-bell.tsx`,
`irforge/src/components/layout/app-sidebar.tsx`,
`irforge/src/lib/notification-severity.ts` (new).

1. `use-notifications.ts` now derives and exports
   `topSeverity: "critical" | "warning" | "info" | null` — the max severity
   across **unread** notifications, `null` when `unreadCount === 0`. It reuses
   the same `unread` array `unreadCount` is computed from, so the two can't
   disagree.
2. The bell badge colour comes from `topSeverity` instead of the hardcoded
   `bg-red-500`: critical → `bg-red-500`, warning → `bg-amber-500`, info →
   `bg-primary`. A `critical` badge also gets `animate-pulse`, suppressed when
   `useReducedMotion()` (framer-motion, already a dependency) is true. Used the
   CSS class rather than a framer-motion loop — the badge is a 16px span, and a
   motion component there would cost more than it buys.
3. `app-sidebar.tsx` shows a severity dot on the **Tickets** and **Support** nav
   rows (`ms-auto`, so it sits at the row's end in both LTR and RTL) and on the
   footer avatar. No new API call: it calls `useNotifications()`, which shares
   react-query's cache with the header bell under the same `["notifications"]`
   key.

Decisions / deviations:
- **New shared module** `lib/notification-severity.ts` holds the one colour
  scale (`SEVERITY_DOT_CLASS` + `severityDotClass`). Three call sites needed the
  same mapping and copy-pasting it would have let them drift. Phase 5 extends
  this same module with the severity **icon** helper it asks to extract.
- The footer avatar's dot is anchored on a new `relative` wrapper around
  `<Avatar>` rather than on the flex row, so it stays attached to the avatar
  when the sidebar collapses to icon-only — in that state the avatar is the only
  thing still visible, so that is exactly when the dot matters most.
- Dots are `aria-hidden`: the unread count is already announced by the bell's
  own badge, and a bare decorative dot would just add noise to a screen reader.
Verification: `pnpm --filter @workspace/irforge typecheck` shows only the
pre-existing `AllBotsTable.tsx:68` baseline error; `build` clean.
Follow-ups left open: the severity dot is driven by *all* unread notifications,
not by ticket-related ones specifically, so an unread `deposit_rejected` also
lights up the Tickets row. That matches the prompt ("when there are unread
notifications"), but a per-category dot would be more precise once
`/notifications` (Phase 5) gives users somewhere else to look.

## Phase 5 — Per-notification detail page  [DONE 2026-08-09]
Files touched: `api-server/src/routes/notifications.ts`,
`irforge/src/pages/notifications.tsx` (new),
`irforge/src/pages/notification-detail.tsx` (new), `irforge/src/App.tsx`,
`irforge/src/components/layout/notification-bell.tsx`,
`irforge/src/lib/lang-routing.ts`, `irforge/public/robots.txt`,
`irforge/src/lib/notification-severity.tsx` (renamed from `.ts` — it now
returns JSX), `irforge/src/locales/{en,fa,ar,tr,ru}.json`.

1. `GET /api/notifications/:id` (`requireAuth`). A row belonging to someone else
   returns **404, not 403**, so the endpoint doesn't confirm that an id exists.
   It does **not** mark the row read.
2. `notification-detail.tsx` — back link, severity-coloured header strip + icon,
   `text-2xl font-bold` title, body at `max-w-2xl` / `text-base leading-relaxed`
   / `whitespace-pre-wrap` (messages really do contain newlines — the reviewer's
   reason is appended after a blank line), localised long timestamp, and a CTA
   derived from `type` via `ctaForType`. Marks read on mount, guarded on
   `!data.read` so re-opening an already-read notification issues no PATCH.
3. `notifications.tsx` — full list, newest first (the API already orders
   `createdAt desc`), each row a link to its detail page, "mark all read" in the
   header, `line-clamp-2` previews.
4. Routes registered in `App.tsx` (`/notifications` before `/notifications/:id`),
   `/notifications` added to `PRIVATE_ROUTES`, and **both** `Disallow:
   /notifications` and `Disallow: /*/notifications` added to `robots.txt` —
   `scripts/ssg.mjs` asserts this and the build reports 34 rules (was 32).
5. The bell popover's items are now links to the detail pages, capped at
   `POPOVER_LIMIT = 6`, with a "View all" footer link that shows the total when
   there are more.

Decisions / deviations:
- **i18n**: these are new files with no existing style to match, so they use the
  locale files rather than the inline `fa` ternary — a new `notifications`
  namespace with 12 keys in **all five** locales. The bell was migrated onto the
  same keys since it now shares this vocabulary. (The neighbouring private pages
  use the inline fa/en pattern, which silently serves English to ar/tr/ru users;
  the locale route was the better of the two options the ground rules allow.)
- **Severity module** (started in Phase 4) absorbed the `severityIcon` helper
  that was duplicated in `notification-bell.tsx`, per the prompt, plus
  `SEVERITY_STRIP_CLASS` for the detail header and `ctaForType` for the CTA
  mapping. The file was renamed `.ts` → `.tsx` because it now returns JSX.
- **`ctaForType`** covers the prompt's four families (`ticket_*` → `/tickets`,
  `purchase_*`/`payment_*` → `/invoices`, `trial_*` → `/buy-bot`, `deposit_*` →
  `/wallet`) plus `order_*` → `/invoices` and `plugin_purchased` → `/bots`,
  which Phase 3 introduced. `announcement` deliberately maps to nothing — there
  is no page for a single announcement, so the detail page simply shows no CTA.
- Chevron/back-arrow direction flips on `isRtlLang(lang)`; all spacing uses
  logical properties (`ms-auto`, `-end-1.5`, `text-start`).

Verification — this phase was checked in a real browser, not only by build:
- `GET /api/notifications/:id`: owner → **200**, and a **second** GET still
  reports `read: false` (proving the GET has no read side effect); another
  user's id → **404**; unknown id → **404**; no auth → **401**; after an
  explicit `PATCH /:id/read` → `read: true`. Newlines survive the round trip.
- In the browser (vite dev against the harness API): logged in, `/en/notifications`
  lists the rows, clicking one navigates to `/en/notifications/<id>` — the
  language prefix resolves through wouter's `base`, not hardcoded — the full
  multi-line Persian body renders unclipped, the "Go to tickets" CTA appears for
  a `ticket_reply`, and a `PATCH .../read` **200** fires on mount.
- Phase 4 re-confirmed live on the same session: with one unread `critical`,
  the badge computed to `bg-red-500 … animate-pulse` and the Tickets/Support
  sidebar dots to `bg-red-500`; after opening it, badge and dots disappeared.
- `/notifications` (root language) renders `dir="rtl"`, `lang="fa"`, heading
  «اعلان‌ها» — RTL and the fa locale both wired.
- `pnpm -r build` clean including the robots.txt assertion; `pnpm -r typecheck`
  still only the Phase 0 baseline errors.

**Trap worth recording for the next session:** the workspace's
`.claude/launch.json` already had a preview config named `irforge-web` pointing
at a *different, older* copy of this app (`irforge/site/irforge-web-main`).
Starting the preview by that name serves the old code, and the first round of
browser checks was silently testing that stale copy — including a
`user.name.charAt(0)` crash in `AppSidebar` that has nothing to do with this
work. A second entry, **`irforge-web-round2`** (port 5174), now points at this
checkout; use that one. The dev frontend needs
`irforge/.env.local` with `VITE_API_URL=http://localhost:3999`, otherwise
`/api/*` resolves to the vite dev server, which answers `index.html` with 200 —
`customFetch` then returns that HTML **string** as the user object, and the app
shell crashes on `user.name`. That is a real robustness gap in
`AuthContext`/`customFetch` worth its own fix, though it is out of scope here.

### Harness cleanup (end of Phase 5)
`api-server/_repro_*.mjs`, `lib/db/_repro_migrations/` and `irforge/.env.local`
are gitignored and left on disk — they are the fastest way to exercise phases
6-18. `api-server/package.json` and `pnpm-lock.yaml` were **reverted**, so the
committed tree carries no test-only dependencies; to run the harness again
first re-add them:
`pnpm add -D --filter @workspace/api-server @electric-sql/pglite @electric-sql/pglite-socket`.
Run order: start `_repro_pgserver.mjs` (applies the generated DDL in-process and
opens a SQL side channel on 55433), then the api-server via `_repro_server.mjs`
with `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/postgres`,
`SUPER_ADMIN_CODE`, and a 64-hex `BOT_TOKEN_ENCRYPTION_KEY`. Restart **both**
together for every run.

Follow-ups left open: `GET /api/notifications` still caps at 50 rows with no
pagination, so `/notifications` silently truncates for a heavy user — the
"View all" link promises more than the page can show once someone passes 50.
Pagination is the obvious next step and was not in this phase's scope.

## Phase 6 — Super admin can delete tickets  [DONE 2026-08-10]
Files touched: `api-server/src/routes/tickets.ts`, `irforge/src/pages/tickets.tsx`.

1. `DELETE /api/tickets/:id` added, guarded by a `requireSuperAdmin` middleware
   defined locally in this file — messages first (`ticketMessagesTable`), then
   the ticket row, then `204`. Unknown id → `404`. A plain user (or an admin
   who isn't `super_admin`) gets `403` from the guard before the handler runs.
   No soft-delete anywhere in the path.
2. `tickets.tsx`: `useAuth()` → `isSuperAdmin = user?.role === "super_admin"`.
   For that role only: a small destructive `Trash2` icon button on each list
   row, and a `Delete` button in the open thread's header. Both open the same
   `AlertDialog` (`deleteTarget: {id, subject} | null`), whose copy names the
   ticket and states the whole message history is permanently removed. On
   confirm: `DELETE` via `customFetch`, invalidate `["tickets"]`, and clear
   `selected` if the deleted ticket was the one open. Cancel is the
   `AlertDialogCancel` default per the shadcn pattern (matches
   `BotSettingsForm.tsx`'s bot-delete dialog — no typed-confirmation field here,
   since the prompt only asks for that friction level in Phase 16's bot delete).
3. Added the status filter (`all` / `open` / `answered` / `closed`, default
   `all`) as a `<Select>` above the ticket list, filtering client-side over the
   already-fetched `tickets` array — no new endpoint or query param needed. The
   empty state now distinguishes "no tickets at all" from "no tickets matching
   this filter".

Decisions / deviations:
- **`requireSuperAdmin` "import" correction.** The prompt says to "import it
  the same way `bots.ts` does" implying a shared export. It doesn't exist:
  `bots.ts` and `wallet.ts` each define their **own** local, unexported
  `requireSuperAdmin(req, res, next)` — identical bodies, no shared module.
  Matched that same pattern in `tickets.ts` (copy of the exact same
  `requireAuth` → role lookup → 403 body) rather than inventing a new shared
  export other routers don't use, since the prompt's actual constraint ("don't
  hand-roll a role check" — i.e. don't reinvent the *logic*) is satisfied by
  mirroring the existing check byte-for-byte.
- The row's delete button needed to sit inside what used to be a `<button>`
  list-item; a `<button>` can't contain another interactive `<button>`, so the
  row element was changed to a `role="button"` `<div>` with the same
  click/keyboard (`Enter`) handling — visually and behaviorally identical, and
  `e.stopPropagation()` on the delete button keeps it from also selecting the
  row.
- No `lib/api-client-react` involvement: this page already talks to
  `/api/tickets*` via raw `customFetch` (not the generated client), matching
  every other verb on this page, so `DELETE` follows suit rather than
  introducing a mixed pattern for one call.

Verification: no live DB harness was reconstructed this phase (the gitignored
`_repro_*` files from Phase 2/3/5 aren't present in this delivered tree, since
they're excluded from the zip export) — reviewed the new route line-by-line
against the identical, already-verified `requireSuperAdmin` blocks in
`bots.ts`/`wallet.ts`, and against this file's own existing 404/403 ownership
checks on the neighboring `GET/PATCH` routes. `pnpm -r build` clean (api-server
esbuild + irforge vite/SSG, 10 pages prerendered, robots/sitemap assertions
still pass). `pnpm --filter @workspace/irforge typecheck` shows only the
pre-existing Phase 0 baseline error (`AllBotsTable.tsx:68`) — no new errors.
Follow-ups left open: if the harness is rebuilt for a later phase, worth
re-confirming live: a `super_admin` deleting an open (not just closed) ticket,
and the exact 403 body for a plain `admin` hitting `DELETE` directly.

## Phase 9 — Discount codes: schema and API  [DONE 2026-08-10]
Files touched: `lib/db/src/schema/discounts.ts` (new), `lib/db/src/schema/index.ts`,
`lib/db/migrations/0014_discount_codes.sql` (new), `api-server/migrate.mjs`,
`api-server/src/lib/discounts.ts` (new), `api-server/src/routes/discounts.ts` (new),
`api-server/src/routes/index.ts`.

**Resuming-session note:** PROGRESS.md's last entry on disk was Phase 6, but the
checked-out tree already had Phases 7 and 8 fully implemented (`avatar_file_id` in
`migrate.mjs`, `fetchBotIdentity` wired into `bots.ts`, `BotIdentityCard.tsx` +
`qrcode.react` in `irforge/package.json`) — just never logged. Not re-verified or
re-documented here (out of scope for "do phase 9"); flagging so the next session
doesn't assume they're outstanding.

1. New table `discount_codes` in `lib/db/src/schema/discounts.ts`, matching the
   prompt's column table exactly (`code` unique, `kind` percent\|fixed, `value`,
   `maxUses` nullable = unlimited, `usedCount` default 0, `expiresAt` nullable =
   never, `active`, `createdBy`, timestamps). Plus `discount_redemptions`
   (`codeId`, `userId`, `orderAmount`, `discountAmount`, `createdAt`) for audit —
   written to by nothing yet in this phase; Phase 11's checkout is the only
   intended writer.
2. **Migration**: this repo's real migration path is the raw-SQL
   `api-server/migrate.mjs` (`CREATE TABLE IF NOT EXISTS ...`, runs on every
   server boot) — confirmed by reading it and by how Phase 7's `avatar_file_id`
   was added there, not just in `lib/db/migrations/`. Added the two tables there,
   plus `lib/db/migrations/0014_discount_codes.sql` for drizzle-kit parity
   (mirrors the `0013_bot_avatar_file_id.sql` convention: a comment pointing at
   `migrate.mjs` as the source of truth). No `meta/_journal.json` exists in this
   repo's `migrations/` dir (these are hand-written parity files, not
   `drizzle-kit generate` output), so no journal entry was needed.
3. **Shared arithmetic helper**: `api-server/src/lib/discounts.ts` exports
   `computeDiscount(kind, value, orderAmount)`. Percent discounts floor (never
   round) to the nearest Toman, so the discount can never exceed the stated
   percent; the result is clamped so `discountAmount <= orderAmount` and
   `finalAmount >= 0` in one step — this is what makes an oversized fixed
   discount zero the order instead of going negative. Verified directly (not
   just read): 20% off ۱۲۳٬۴۵۷ → discount ۲۴٬۶۹۱ / final ۹۸٬۷۶۶ (floor of
   24691.4, not round to 24691.4→24691 by luck — checked with a value where
   floor and round would differ, e.g. 22% of 12345 = 2715.9 → floor 2715);
   a ۵۰٬۰۰۰ fixed code against a ۳۰٬۰۰۰ order → discount clamped to ۳۰٬۰۰۰,
   final ۰. This same helper is what Phase 11's checkout must import rather
   than re-implementing the math.
4. **`POST /api/discounts/validate`** (`requireAuth`): normalizes `code`
   (trim + uppercase) before lookup, so a user typing lowercase still matches.
   Checks in order: code present → amount present/non-negative → row exists
   (`not_found`) → `active` (`inactive`) → `expiresAt` in the past (`expired`)
   → `usedCount >= maxUses` (`exhausted`). Every failure is `400` with both a
   `reason` code (for the frontend to key off/translate in Phase 11) and a
   Persian `error` message. Success is `200` with
   `{ valid: true, kind, value, discountAmount, finalAmount }`. **Never writes**
   — no `usedCount` increment, no `discount_redemptions` row; that's Phase 11's
   job, inside the purchase transaction, per the prompt.
5. **`GET/POST/PATCH/DELETE /api/admin/discounts`** (`requireSuperAdmin`,
   defined locally the same way `wallet.ts`/`tickets.ts` do — no shared export
   exists in this codebase, per the precedent already recorded in Phase 6):
   - `POST`/`PATCH` reject `percent` outside 1–100 and non-positive `fixed`
     with a specific message; `value` must be an integer.
   - Code is uppercased/trimmed on every write (create and rename via `PATCH`).
   - Duplicate code → `409` on both `POST` and `PATCH` (checked pre-emptively
     via a `SELECT`, and the Postgres unique-violation `23505` is also caught
     as a `409` fallback for a race between the check and the insert/update —
     the pre-check alone isn't safe under concurrent requests).
   - `maxUses`/`expiresAt` accept `null`/`""`/omitted as "unlimited"/"never" on
     both create and update; a non-integer or non-positive `maxUses`, or an
     unparseable `expiresAt`, is `400`.
   - `PATCH` is a partial update (only touches fields present in the body) and
     re-validates `kind`+`value` together if either changes, so a `PATCH` that
     only sends `value: 150` still gets rejected if the code's existing `kind`
     is `percent`.
   - `DELETE` is a hard delete (no soft-delete column on this table), `204` on
     success, `404` on an unknown id.

Decisions / deviations:
- The prompt's endpoint table doesn't specify HTTP status/body shape for
  `PATCH`/`DELETE`/duplicate-on-`PATCH` beyond "full CRUD" and "409 on
  duplicate" for create — extended the same 409-on-duplicate rule to `PATCH`
  (renaming a code onto an existing one) since leaving it unhandled would 500
  on the DB unique constraint instead.
- `discountRedemptionsTable` has no route yet in this phase — it exists purely
  as the schema Phase 11 needs; nothing reads or writes it yet, so there was
  nothing to verify beyond the migration creating it.

Verification: no live Postgres available in this sandbox (the gitignored
Phase 2/3/5 PGlite harness isn't present in this delivered tree, matching
Phase 6's note) — `computeDiscount` was verified directly via `node --import
tsx/esm` (see above), and the routes were reviewed line-by-line against the
now-established local patterns (`wallet.ts`'s `requireSuperAdmin` /
`ensureWallet`-style existence checks, `admin.ts`'s announcement validation
style for the 400-with-message shape). Ran the real gates:
`pnpm --filter @workspace/api-server typecheck` — the only line touching a new
file is `src/routes/discounts.ts(12,52)`, the same pre-existing
`TS6305`/`lib/db/dist` baseline error every other route file in this repo
already has (Phase 0's baseline); no `TS7006`/new-error lines from this
phase's code. `pnpm --filter @workspace/api-server build` (esbuild) — clean,
`Build complete → dist/index.cjs`, same single pre-existing `import.meta`/cjs
warning as baseline. `pnpm --filter @workspace/irforge build` — clean (not
touched this phase, run anyway per the ground rule), same pre-existing
sourcemap/chunk-size warnings, 10 pages prerendered.
Follow-ups left open: this phase intentionally ships no frontend and no
OpenAPI spec entry — Phase 10 (admin UI) and Phase 11 (checkout) are expected
to call these endpoints via `customFetch` (not the generated client, since the
spec wasn't regenerated — nothing in the prompt's Phase 9 scope required it).
Live end-to-end verification (actually applying a code through a real DB) is
still owed once a harness exists again; noting this explicitly rather than
claiming it was done.

## Phase 13 — Refresh buttons  [DONE 2026-08-10]
Files touched: `irforge/src/components/ui/refresh-button.tsx` (new),
`irforge/src/pages/admin.tsx`, `irforge/src/components/bots/BotStatsPanel.tsx`,
`irforge/src/pages/admin-pending-payments.tsx`, `irforge/src/pages/admin-sheet-pool.tsx`.

1. New reusable `<RefreshButton queryKeys={QueryKey[]} label? />`: an outline
   icon button that invalidates every key on click and drives its spinner from
   `useIsFetching({ predicate })` — not local state — so it reflects real query
   state (including background refetches it didn't start). Disabled while any
   watched key is fetching, so it can't be double-fired mid-flight. Spin is
   suppressed under `useReducedMotion()`. The predicate uses a deep-partial
   prefix `keyMatches` mirroring how `invalidateQueries` matches filter keys,
   so it works for both flat `["admin-bots"]` keys and the generated client's
   `[{ url, ... }]`-shaped keys.
2. Placed it in four headers:
   - Admin panel: made `<Tabs>` controlled (`value`/`onValueChange` + `useState`)
     so the button can invalidate the **active tab's** keys via a `TAB_KEYS`
     map (overview→stats, bots, users, payments→wallet-deposits, plans,
     announcements, discounts).
   - `BotStatsPanel`: invalidates `getGetBotStatsQueryKey(botId)` from the
     Live/uptime row.
   - Pending-payments page: invalidates both `["wallet-deposits"]` and
     `["admin","pending-payments"]` (its two sections).
   - Sheet-pool page: invalidates `["admin","sheet-pool"]`.

Decisions / deviations:
- The tab query keys are mostly **local, unexported** constants inside each tab
  component (`ADMIN_BOTS_KEY`, `WALLET_KEY`, `ADMIN_PLANS_KEY`, the
  `["admin-discounts"]` literal). Rather than export/refactor all of them, the
  `TAB_KEYS` map in `admin.tsx` re-states the same literal values and reuses the
  generated key helpers (`getAdminGetStatsQueryKey`, `getAdminListUsersQueryKey`,
  `getListPlansQueryKey`, `getListAnnouncementsQueryKey`) that already exist —
  no change to the tab components themselves.
- `label` is passed localised (fa/en) by each caller so the single shared
  component stays i18n-agnostic, matching the inline-`fa` style of these pages.

Verification: `pnpm --filter @workspace/irforge typecheck` — only the
pre-existing Phase 0 baseline error (`AllBotsTable.tsx:68`), no new errors.
`pnpm --filter @workspace/irforge build` clean, 10 pages prerendered,
robots/sitemap assertions still pass.
Follow-ups left open: none.

## Phase 14 — Fill in the "How do I get my bot token?" guide  [DONE 2026-08-10]
Files touched: `irforge/src/pages/learn-bot-token.tsx`, `irforge/src/config/support.ts`,
`irforge/src/lib/lang-routing.ts`, `irforge/src/lib/structured-data.ts`,
`irforge/src/entry-ssg.tsx`, `irforge/src/App.tsx`, `irforge/public/robots.txt`,
`irforge/src/pages/support.tsx`, `irforge/src/components/layout/support-fab.tsx`,
`irforge/src/locales/{en,fa,ar,tr,ru}.json`, `.claude/launch.json` (new, dev preview only).

1. Real guide, replacing the "coming soon" placeholder: a numbered `<ol>` of 7
   steps (open Telegram → find @BotFather → `/newbot` → display name →
   username ending in `bot` → copy the token → paste into IrForge), each with
   an icon and body copy, plus a fake-but-realistic example token rendered
   `dir="ltr"` in a scrollable `<code>`. A destructive-styled callout states
   the token is a password (full control, never share/post/commit) and that
   `/revoke` in BotFather invalidates a leaked one.
2. Education channel constants live in `config/support.ts`
   (`EDUCATION_CHANNEL_URL` / `EDUCATION_CHANNEL_HANDLE`) — not hardcoded in
   the page — and are consumed by the guide, the Support page (new card) and
   the support FAB (new secondary button above the robot). All three use
   `target="_blank" rel="noopener noreferrer"`.
3. Full content in all five locales under a new `learnBotToken` namespace,
   plus `seo.botTokenTitle` / `botTokenDescription` / `navBotToken`.
4. `/learn/bot-token` added to `PUBLIC_ROUTES` and `SITEMAP_LASTMOD` bumped to
   2026-08-10. `seoFor` in `entry-ssg.tsx` and the breadcrumb/site-navigation
   nodes in `structured-data.ts` were extended for the new route (both
   previously special-cased `/docs` only, so without this the guide would have
   inherited the *homepage* title in every language).

Decisions / deviations:
- **The route had to move out of `ProtectedRoute`.** It was registered as
  `<Route path="/learn/bot-token"><ProtectedRoute .../></Route>`, i.e. behind
  auth. A prerendered public page cannot be auth-gated (the SSG renders as a
  logged-out visitor, so it would have emitted a redirect, not the guide), and
  the prompt's own premise — public, linked from checkout, indexable — requires
  it. It is now a bare `<Route>` next to `/docs`. Consequence worth knowing: an
  authed user following the checkout link now gets the standalone page without
  the app shell, exactly like `/docs` behaves.
- **`irforge/public/sitemap.xml` does not exist and was not created.** The
  prompt lists it as a file to touch, but this repo *generates* sitemap.xml in
  `scripts/ssg.mjs` from (languages × `PUBLIC_ROUTES`) and deliberately does not
  check one in ("a hand-maintained copy would go stale"). Adding the route to
  `PUBLIC_ROUTES` is therefore the whole change; the sitemap picked it up
  automatically (15 URLs, up from 10).
- `robots.txt` gained `Allow: /learn/bot-token` for symmetry with `Allow: /docs`.
  The build-time assertion only covers `PRIVATE_ROUTES`, so this was not
  required — but leaving a public prerendered route unlisted next to its
  siblings would be a trap for the next person editing that file.

Verification: `pnpm --filter @workspace/irforge build` — 15 pages prerendered
(up from 10), all five `/learn/bot-token` variants present with their own
localised `<title>`, 15 sitemap URLs with `lastmod` 2026-08-10, robots and
brand-asset assertions still pass. `typecheck` shows only the pre-existing
Phase 0 baseline error (`AllBotsTable.tsx:68`). Served the built `dist/` over a
static server (with `/api/*` → 401) and loaded the page in a browser:
`/en/learn/bot-token` renders all 7 steps, the warning and the channel card;
the channel anchor resolves to `https://t.me/irforge_Education` with
`target="_blank" rel="noopener noreferrer"`; `/learn/bot-token` renders `dir=rtl`
`lang=fa` with the Persian copy, correct canonical, and no horizontal overflow.

Follow-ups left open: **the dev server (`pnpm dev`) cannot render any authed
route while `api-server` is not running** — Vite answers `GET /api/me` with
`index.html` and a `200`, so `AuthContext` gets a truthy non-user object,
`ProtectedRoute` admits it, and `AppSidebar` crashes on `user.name.charAt(0)`
(`app-sidebar.tsx:246`/`:274`). Confirmed pre-existing by reproducing it with
this phase's changes stashed, on `/en/dashboard` as well. Not fixed here (out
of scope), but `AppSidebar` guarding `user?.name` would make dev-without-API
usable and is cheap.

## Phase 15 — Only admins may change a bot's Google Sheet  [DONE 2026-08-10]
Files touched: `api-server/src/routes/bots.ts`,
`irforge/src/components/bots/BotSettingsForm.tsx`.

1. **Server-side (the actual fix)**: `POST /api/bots/:botId/sheet` was
   `requireBotOwnership` — a bot's own owner could repoint their bot at any
   spreadsheet they controlled. Guard changed to `requireSuperAdmin` (the local
   one already defined in this file and used by ~15 other routes here). A plain
   user, including the bot's owner, now gets `403 {"error":"Super admin only"}`
   from the middleware before the handler runs.
2. Because `requireBotOwnership` was also what populated `req.bot`, and
   `requireSuperAdmin` deliberately does *not* scope `:botId` to the caller
   (a super admin must be able to act on anyone's bot), the handler now loads
   the bot row explicitly by `:botId` and returns `404` if it doesn't exist.
   Everything downstream (`bot.id`, `bot.name`, `bot.sheetId`) is unchanged.
3. `BotSettingsForm.tsx`: `useAuth()` → `isSuperAdmin`. For non-super-admins the
   Spreadsheet ID renders read-only (a `font-mono` bordered block, `dir="ltr"`,
   `data-testid="bot-sheet-id-readonly"`) with a muted line saying the sheet is
   platform-managed and linking to `/tickets` for changes; the input and the
   "Register sheet" button are not rendered at all. The "Open current sheet"
   link stays for both roles — visibility was never the problem, mutation was.
   Super admins keep the editable form exactly as it was.

Decisions / deviations: none — the prompt's diagnosis matched the code.

Verification: `pnpm --filter @workspace/api-server typecheck` — no new errors;
the lines reported in `bots.ts` are the pre-existing `TS6305`/`TS7006` baseline
(all cascade from `lib/db/dist` not being prebuilt) and none fall in the edited
range. `pnpm --filter @workspace/api-server build` → `Build complete →
dist/index.cjs`. `pnpm --filter @workspace/irforge typecheck` — only the Phase 0
baseline error (`AllBotsTable.tsx:68`).
Follow-ups left open: the 403 path was verified by reading the middleware
(identical to the one already covering `/sheet-pool/*`), not by a live request —
no DB harness exists in this tree. Worth one live check as a plain user if a
harness is rebuilt.

## Phase 16 — Delete-bot warning must state the real consequences  [DONE 2026-08-10]
Files touched: `irforge/src/components/bots/BotSettingsForm.tsx`,
`irforge/src/locales/{en,fa,ar,tr,ru}.json`.

1. The dialog body now states all three consequences as separate paragraphs:
   the bot is deleted permanently and cannot be restored (naming the bot); its
   commands, plugins and stored data go with it; and — styled
   `font-medium text-destructive`, because it's the part people miss — no refund
   is issued and any remaining paid time is forfeited.
2. Header is destructive-styled: `AlertDialogTitle` is `text-destructive` with a
   leading `AlertTriangle`.
3. Typed-name gate: a labelled `Input` under the body; the destructive action is
   `disabled` until the trimmed input exactly equals the trimmed bot name
   (case-sensitive — a name differing only by case is not the name the user was
   asked to type). Closing the dialog resets the field, so reopening never
   starts with the button already enabled.
4. `AlertDialogCancel` remains first in the footer and keeps shadcn's default
   focus, so Enter/Escape still cancel rather than destroy.

Decisions / deviations:
- **Deliberately mixed i18n styles in this one file.** `BotSettingsForm.tsx`
  uses the inline `fa ? … : …` pattern throughout, which covers only two
  languages; this phase's "Done when" requires the warning "in all five
  locales". The two can't both be honoured, so the dialog copy moved to a new
  `deleteBot` namespace in the locale files (read via `useT("deleteBot")`) and
  the rest of the file was left on the inline pattern. Flagged inline with a
  comment at the `useT` call so the next editor knows it was a decision, not
  drift. Name interpolation uses the repo's existing `{name}` +
  `String.replace` convention (see `database.tsx`'s `{count}`).
- `AlertDialogDescription` is rendered `asChild` around a `<div>`: it renders a
  `<p>` by default, and the three-paragraph body would otherwise nest `<p>`
  inside `<p>` (invalid, and React would warn).

Verification: `pnpm --filter @workspace/irforge typecheck` — only the Phase 0
baseline error (`AllBotsTable.tsx:68`). Locale round-trip is byte-stable, so the
five locale diffs are purely additive (10 lines each).
Follow-ups left open: the enable/disable behaviour was not click-tested in a
browser — the bot workspace is behind auth and no API server/DB harness exists
in this tree (see the Phase 14 note on dev-without-API crashing).

## Phase 17 — Language picker and animated theme toggle in the sidebar menu  [DONE 2026-08-10]
Files touched: `irforge/src/components/layout/app-sidebar.tsx`,
`irforge/src/components/layout/language-options.tsx` (new),
`irforge/src/components/layout/language-switcher.tsx`,
`irforge/src/hooks/use-theme-sweep.ts` (new),
`irforge/src/components/layout/theme-toggle-button.tsx`.

1. **Language.** The single `DropdownMenuItem onClick={toggleLang}` (which
   cycled one step forward through `LANGUAGES` per click — hence "changes
   randomly") is replaced by a `DropdownMenuSub` whose `DropdownMenuSubContent`
   lists all five languages with flag, native name and a `Check` on the active
   one, calling `setLang(code)` directly. `toggleLang` is gone from this file's
   `useLanguage()` destructuring.
2. **Shared list, not a copy.** The rows were extracted from
   `language-switcher.tsx` into `LanguageOptions` (renders bare
   `DropdownMenuItem`s; the caller supplies the content wrapper, which is what
   lets the same component sit inside both a `DropdownMenuContent` and a
   `DropdownMenuSubContent`). `LanguageSwitcher` now consumes it, so the header
   and the sidebar cannot drift. `LanguageOptions` takes an optional
   `onSelected` so the sidebar can also close the mobile sheet.
3. **Theme.** The View-Transitions circular sweep moved out of
   `ThemeToggleButton` into `useThemeSweep()` → `{ isDark, toggleTheme(originEl?) }`.
   `ThemeToggleButton` passes its own button ref; the sidebar menu item passes
   `e.currentTarget`, so the sweep starts from whichever control was actually
   clicked. Reduced-motion and no-View-Transitions fallbacks are untouched —
   they already lived in `useRunViewTransition`, which runs the update
   synchronously in both cases, so the extracted hook never branches on them.

Verification: `pnpm --filter @workspace/irforge typecheck` — only the Phase 0
baseline error. `build` clean (15 pages). Exercised live in the browser on the
public landing page (the header switcher uses the same extracted component):
opening the menu lists exactly 5 items — 🇬🇧English / 🇮🇷فارسی / 🇸🇦العربية /
🇹🇷Türkçe / 🇷🇺Русский — and choosing Türkçe moved the URL to `/tr/` with
`<html lang="tr">`. Theme toggle flipped `dark`→`light` with
`document.startViewTransition` present, confirming the extracted hook drives the
real sweep path and not the fallback.
Follow-ups left open: the submenu itself was verified through the shared
component on the public page; the sidebar footer menu that hosts it is behind
auth and was not click-tested (no API/DB harness — see Phase 14's note).

## Phase 18 — Remove the duplicate brand mark in the app header  [DONE 2026-08-10]
Files touched: none — **already satisfied in the delivered tree.**

Verified rather than changed:
- `App.tsx`'s `AuthedRoute` header contains only `<SidebarTrigger />` and
  `<HeaderControls />`. There is no `BrandLogo`, no `header-brand-home` testid,
  no `mx-1 h-5 w-px` separator, and no `BrandLogo` import anywhere in the file.
- `app-sidebar.tsx` renders exactly one lockup, `<SidebarBrandHeader href="/">`,
  carrying a comment that already cites "Phase 18's own spec". `href="/"` is
  resolved by wouter against `base` (`BASE_URL` + `langPrefix(lang)`), so it
  lands on `/en/` for an English visitor and `/` for Persian, with no
  hardcoded prefix that could double into `/en/en/`.

So this phase was completed in an earlier round (the pre-branch "Update
App.tsx" / "Update app-sidebar.tsx" commits) and simply never logged — the same
situation the Phase 9 entry recorded for Phases 7 and 8. Recording it here so
the ledger is complete; no commit of its own.

## Final pass (after Phase 18)  [2026-08-10]

Gates run at the end of the round:
- `pnpm -r build` — **clean**. api-server: `Build complete → dist/index.cjs`.
  irforge: 15 pages prerendered, sitemap 15 URLs, robots.txt covers every
  private route, brand assets present and crawlable.
- `pnpm -r typecheck` — one error, the unchanged Phase 0 baseline
  (`AllBotsTable.tsx:68`, `TS2741` missing `queryKey`). api-server run
  separately shows only its pre-existing `TS6305`/`TS7006` baseline, which all
  cascade from `lib/db/dist` not being prebuilt.
- `pnpm -r lint` — **there is no lint script in this workspace**
  ("None of the selected packages has a \"lint\" script"). The prompt's final
  pass asks for it; recording that it doesn't exist rather than claiming a pass.

Manual walk: done for the **public** surface only — landing and the new
`/learn/bot-token` in `fa` (RTL) and `en` (LTR), plus `ar`/`tr`/`ru` via their
prerendered output, and a live dark→light toggle. The authed surface
(dashboard, admin panel, bot workspace, checkout, tickets) could **not** be
walked: see Known issues #1.

## Known issues

1. **The frontend cannot run against a missing API in dev.** With `api-server`
   down, Vite answers `GET /api/me` with `index.html` and HTTP 200, so
   `AuthContext` stores a truthy non-user value, `ProtectedRoute`'s `if (!user)`
   guard passes, and `AppSidebar` throws on `user.name.charAt(0)`
   (`app-sidebar.tsx:246` and `:274`) — every authed route shows the error
   boundary. Confirmed pre-existing (reproduced with this round's changes
   stashed). This is why no phase in 13–18 carries live authed-UI verification.
   Cheap fix, not taken here because it is outside every phase's scope: guard
   `user?.name` in `AppSidebar`, and/or have `customFetch` reject a
   non-JSON/`text/html` response instead of returning it as data — the latter
   is the real bug, since any endpoint could be silently "successful" with an
   HTML body.
2. **Phases 13–18 have no live database verification.** The `_repro_*` pglite
   harness from Phases 2/3/5 is not in this tree (excluded from the zip
   export). Phase 15's `403` and Phase 16's typed-name gate were verified by
   reading the code against already-verified identical patterns, not by
   request/click. Both are listed in their own phases' follow-ups.
3. **`GET /api/notifications` still caps at 50 rows with no pagination**
   (carried over from Phase 5). `/notifications` silently truncates for a heavy
   user and the "View all" link over-promises past 50.
4. **Phases 7, 8, 10, 11 and 12 were delivered but never individually logged.**
   The Phase 9 entry flags 7 and 8; 10 (`DiscountsManager.tsx`), 11 (checkout
   discount flow) and 12 (`admin-pending-payments.tsx` wallet section + honest
   empty/error states) were found implemented in the delivered tree when this
   round's session picked it up at Phase 13, and were committed as a single
   sync commit. They have not been re-verified here, so their "Done when"
   criteria remain formally unconfirmed.

## Merge note — reconciling with a parallel Phase 13  [2026-08-10]

When this round came to push, `gh/main` had moved 49 commits ahead of the tree
this session started from, and those commits contained a **partially-complete
Phase 13** done in parallel: the tab components had been changed to `export`
their query keys (`ADMIN_BOTS_KEY`, `WALLET_KEY`, `ADMIN_PLANS_KEY`), and
`RefreshButton` call sites had been added to `BotStatsPanel`,
`admin-pending-payments` and `admin-sheet-pool` — but
`irforge/src/components/ui/refresh-button.tsx` was never committed, so that tree
imports a module that does not exist and does not build.

Rather than force-push over it, this round's six commits were rebased onto
`gh/main` (`git rebase --onto gh/main <sync-commit>`), dropping this session's
"sync delivered tree" commit since `gh/main` already contained that content.
Three files conflicted; all were resolved as a **union of both intents**:

- `BotStatsPanel.tsx` — kept the parallel version's nested
  `flex items-center justify-between` structure (cleaner than the `ms-auto`
  this session used) and kept this session's localised `label`.
- `admin-pending-payments.tsx` / `admin-sheet-pool.tsx` — removed the duplicate
  `RefreshButton` import each conflict produced, kept the labelled call site.
- `admin.tsx` — `TAB_KEYS` now imports the newly-exported `ADMIN_BOTS_KEY`,
  `WALLET_KEY` and `ADMIN_PLANS_KEY` instead of restating those literals, which
  is what the parallel work exported them for.
- `admin-pending-payments.tsx` also now imports `WALLET_KEY` from
  `PaymentApprovals` instead of declaring its own copy — the exact drift the
  export's own comment says it exists to prevent.

Net effect: the missing `refresh-button.tsx` is supplied, `main` builds again,
and no parallel work was discarded. Post-rebase gates: `pnpm -r build` clean
(api-server + 15 prerendered pages, robots/sitemap/brand assertions pass);
`pnpm -r typecheck` unchanged from baseline.

---

# ANNOUNCEMENTS FIX + SITE UPDATES — IrForge_Announcements_Fix_And_Updates_ClaudeCode_Prompt.md

| Phase | Status | Notes |
|---|---|---|
| 0 — baseline | DONE | `pnpm install`, `pnpm --filter @workspace/api-server run build`, `pnpm --filter @workspace/irforge run build` all green before any change. Pre-existing baseline warnings recorded below; none are regressions and none are touched by this round. |
| 1 — announcements 500 fix | DONE | Added the missing `CREATE TABLE IF NOT EXISTS announcements` (+ `announcements_created_at_idx`) to `api-server/migrate.mjs`, the migration `start.sh` actually runs. Mirror added at `lib/db/migrations/0015_announcements.sql` for drizzle parity. Root `migrate.mjs` marked `DEAD CODE` (not executed) without touching its body. **This fix only takes effect after a deploy/restart on Railway**, because `migrate.mjs` runs at boot — until the service restarts, the announcements bug is still live in production. |
| 2 — announcements UI error state | DONE | `AnnouncementsManager` now reads `isError`/`error`/`refetch` from `useListAnnouncements()` and renders a red error card with `serverMessage(error)` and a «تلاش دوباره» button, ordered `isLoading → isError → data → empty`. Previously only `isLoading` was checked, so a 500 left the list on an infinite skeleton — the exact silent failure this round was reported for. `dashboard.tsx`'s `["announcements"]` query stays deliberately silent (banner just hides, no toast); global `retry: 1` confirmed in `App.tsx`. |
| 3 — site-updates schema | DONE | Added `site_updates`, `site_update_images`, `user_update_views` (+ two indexes) and `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS ref_id` to `api-server/migrate.mjs`; mirrored at `lib/db/migrations/0016_site_updates.sql`. Every DDL statement is idempotent (`IF NOT EXISTS`), so re-running the boot migration is safe. Images live in their own table on purpose: the list endpoint must never carry megabytes of base64. |
| 4 — drizzle schema | DONE | New `lib/db/src/schema/updates.ts` with `siteUpdatesTable`, `siteUpdateImagesTable` and `userUpdateViewsTable` (composite PK on `user_id, update_id`), plus `SiteUpdate`/`SiteUpdateImage`/`UserUpdateView` types. `notifications.ts` gained `refId: text("ref_id")`; `schema/index.ts` re-exports `./updates`. api-server build green. |
| 5 — user updates API | DONE | New `api-server/src/routes/updates.ts`: `GET /updates` (published only, newest first, `imageCount` via one grouped `count(*)`, `seen` via `user_update_views`, **no** image bodies), `GET /updates/unseen` (newest unseen with `published_at >= users.created_at`, returns `{ update: null }` with 200 when there is nothing), `POST /updates/seen` (`onConflictDoNothing`, all published updates when no `updateId`), `GET /updates/:id` (404 — not 403 — for an unpublished draft seen by a non-staff user, so drafts don't leak). `/updates/unseen` is registered **before** `/updates/:id` or express would read "unseen" as an id. `requireAuth` only sets `req.userId`, so the draft path reads the role itself with one extra query. Router wired in `routes/index.ts` (import + use). |
| 6 — admin updates API + publish fan-out | DONE | `requireAdmin` endpoints appended to `updates.ts`: `GET /admin/updates` (drafts + published), `POST /admin/updates` (draft), `PATCH /admin/updates/:id` (images **replace**, never merge), `POST /admin/updates/:id/publish`, `DELETE /admin/updates/:id` (cascades images + `user_update_views`). Validation mirrors `ANNOUNCEMENT_TYPES` in `admin.ts`: title ≤200, body ≤8000, version ≤32, ≤8 images, each ≤800KB decoded (size estimated from base64 length, no full decode); every rejection is a 400 whose message the panel renders from `err.data.error`. Raw input is never inserted. **Publishing is idempotent-by-refusal: publishing an already-published update returns `400 {"error":"Already published"}`**, so the fan-out can't run twice. `NotificationInput` gained optional `refId`, written by both `createNotification` and `createNotificationsBulk`; the never-throws contract is unchanged (still `try/catch` + `logger.warn`). |
| 7 — admin Updates tab | DONE | New `components/admin/UpdatesManager.tsx` (form + list, `["admin-updates"]`, `customFetch` not orval hooks) wired into `admin.tsx` as a `Sparkles` tab next to Announcements, open to both `admin` and `super_admin`. Multi-image upload compresses client-side on a canvas (longest edge 1400px, JPEG q0.8 stepping down 0.7/0.6/0.5, PNG kept as PNG unless it's over budget), rejects anything still over 800KB with a toast, caps at 8 and disables the add button at the cap; thumbnails can be reordered (← →) and removed. Publish is behind an `AlertDialog` warning that it notifies every user and cannot be undone; delete likewise. The list has an explicit `isError` branch from the start — the Phase 2 lesson applied up front rather than after the fact. |
| 8 — dashboard update modal | DONE | `hooks/use-unseen-update.ts` (`["update-unseen"]`, `staleTime` 5min) + `components/updates/UpdateDialog.tsx`. Version badge, title as `DialogTitle`, body with `whitespace-pre-wrap`, gallery reusing the existing `ReceiptLightbox` per image (its `src`+trigger API already fits a gallery, so it was **not** renamed or rewritten and no call site changed). All three close paths — X, «متوجه شدم», outside click — run through `onOpenChange`/`dismiss`, which POSTs `/api/updates/seen` with no `updateId` (i.e. all published, so no modal chain) and invalidates `["update-unseen"]`. The modal closes **before** the request resolves and a failure only `console.warn`s: a modal stuck open on a network error is worse than the feature. `max-h-[85vh] overflow-y-auto` for mobile. **Mounted only in `/dashboard`**, not app-wide; it renders nothing when there is no unseen update. Deviation: the five-language `updates` locale namespace was added here rather than in Phase 11, because `useT` derives its type from `en.json` and the phase could not build without it — Phase 11 still adds `common.updates`/`notifications.ctaUpdate` and does the parity check. |
| 9 — /updates pages | DONE | `pages/updates.tsx` (cards with title, version, date, `line-clamp-2` body, «جدید» badge for unseen; loading/error/empty all present) and `pages/update-detail.tsx` (full body, gallery via the same `ReceiptLightbox`, RTL-aware back arrow with `isRtlLang(lang) ? ArrowRight : ArrowLeft`). Routes added inside the protected block with `/updates` **before** `/updates/:id`. Sidebar gained a `Sparkles` item (`data-testid="nav-updates"`, `closeMobileMenu`, `isActive={location.startsWith("/updates")}`) labelled from `common.updates`, placed before Database. `vite.config.ssg.ts` untouched: these pages are protected, so `/updates` was added to `PRIVATE_ROUTES` and two matching `Disallow` lines to `robots.txt` — the build's robots-coverage assertion fails loudly without them (it did, and that's how the omission was caught). Prerender still emits exactly 15 public pages. |
| 10 — updates ↔ notifications | DONE | `refId` now flows end to end: `AppNotification.refId: string \| null` in `use-notifications.ts`, `refId: n.refId` / `refId: row.refId` in both response mappings in `api-server/src/routes/notifications.ts`, and `ctaForType(type, refId?)` returns `{ href: "/updates/<id>", key: "update" }` for `site_update` ahead of the other branches (the only CTA whose destination depends on a record rather than just the type). `"update"` added to the return union and `update: t.ctaUpdate` to the label map in `notification-detail.tsx`; `notifications.ctaUpdate` added in all five locales. `ctaForType` has exactly one call site, so no other caller needed updating. |
| 11 — translations (5 languages) | DONE | `common.updates` (sidebar label), `notifications.ctaUpdate`, and the `updates` namespace (`title`, `empty`, `loadError`, `notFound`, `back`, `newBadge`, `gotIt`, `version`, `publishedOn`, `imageAlt`) exist in all five locales. Arabic / Turkish / Russian are written natively, **not** copied from English. Verified: all five files parse, and all five have byte-identical key sets — 334 keys each, zero missing and zero extra against `en.json`. No hardcoded string is left on the user-facing path (`updates.tsx`, `update-detail.tsx`, `UpdateDialog.tsx` all read from `useT("updates")`). The admin `UpdatesManager` deliberately keeps the repo's `fa ? "..." : "..."` convention — the admin panel is bilingual, not five-lingual. Two extra keys beyond the brief: `notFound` (the detail page needs to tell 404 apart from a load failure, same as `notification-detail.tsx`) and `imageAlt` (gallery images must have localized alt text). |
| 12 — final verification | DONE | See the checklist and the hand-over notes below. |

**Baseline (pre-existing, not introduced by this round):**

- `api-server` esbuild emits one warning: `"import.meta" is not available with the "cjs" output format` at `src/app.ts:18:33`. The file already guards this at runtime; left alone.
- `irforge` build emits `src/components/ui/command.tsx (2:0): Error when using sourcemap for reporting an error` — a rollup sourcemap notice, not a build failure. Left alone.
- `tsc --noEmit` has pre-existing errors across the repo and is **not** the build gate for this work; esbuild/vite are. Not touched.
- Prerender baseline: 15 pages, sitemap 15 URLs, robots 34 disallow rules — all assertions pass.

## Phase 12 — verification checklist (announcements fix + site updates)

Gates, all green on the final tree:

- `pnpm install` → `pnpm --filter @workspace/api-server run build` → `pnpm --filter @workspace/irforge run build`
- `node --check api-server/migrate.mjs`
- Prerender unchanged from baseline: 15 pages, sitemap 15 URLs, robots 36 disallow rules (2 added for `/updates`), brand assets present.

Checked by hand:

- [x] `announcements` is created in `api-server/migrate.mjs` (exactly one `CREATE TABLE IF NOT EXISTS announcements`).
- [x] `AnnouncementsManager` has a real error state — red card + retry, not an infinite skeleton.
- [x] All five Phase-3 DDL statements are idempotent (`IF NOT EXISTS` on three tables, two indexes, and the `ref_id` column).
- [x] Publishing an already-published update returns `400 {"error":"Already published"}`, so the notification fan-out cannot run twice.
- [x] Closing the modal via **all three** paths — the X, «متوجه شدم», and an outside click — goes through `onOpenChange`/`dismiss` and records seen.
- [x] A `site_update` notification links to `/updates/:id` via `refId`.
- [x] Every one of the 9 new endpoints carries `requireAuth` or `requireAdmin` (9 of 9 matched; none unguarded).

### کارهای دستی برای Ali

1. **بعد از deploy روی Railway باید سرویس ری‌استارت شود.** `migrate.mjs` فقط
   در بوت اجرا می‌شود، و تا وقتی اجرا نشده نه جدول `announcements` ساخته
   می‌شود و نه جدول‌های آپدیت. **تا قبل از ری‌استارت، باگ اعلان‌ها دقیقاً سر
   جای خودش است** — انتشار اعلان همچنان «Internal server error» می‌دهد.
2. هیچ متغیر محیطی جدیدی این تسک اضافه نمی‌کند.
3. سقف عکس‌ها به `express.json({ limit: "10mb" })` در `api-server/src/app.ts`
   گره خورده است: ۸ عکس × ۸۰۰KB بعد از base64 حدود ۸٫۵MB می‌شود، یعنی همین
   حالا روی لبه است. اگر خواستی سقف عکس را بالا ببری، **اول** لیمیت اکسپرس
   را بالا ببر، وگرنه کاربر یک ۴۱۳ بی‌توضیح می‌گیرد.

---

# SEO BUILD-OUT — IrForge_SEO_ClaudeCode_Prompt.md

## Phase 1 — Make the SEO plumbing route-aware  [DONE 2026-08-10]

Files touched: `irforge/src/lib/lang-routing.ts`, `irforge/src/lib/structured-data.ts`,
`irforge/src/entry-ssg.tsx`

Pages added (lang × route): none — plumbing only, still 15 emitted pages.

Untranslated keys left: none.

Decisions / deviations:

- The `ROUTE_SEO` registry lives in `lang-routing.ts`, not `entry-ssg.tsx` as
  the brief suggested. Both `entry-ssg.tsx` and `structured-data.ts` need it,
  and `lang-routing.ts` already owns `PUBLIC_ROUTES` — putting the registry
  next to the route list keeps the two from drifting, and avoids
  `structured-data.ts` importing from the SSR entry point.
- `routeSeo(route)` **throws** for a route in `PUBLIC_ROUTES` with no registry
  entry, and `seoFor` throws again if the registry points at a locale key that
  doesn't exist. Verified by temporarily adding `/dummy-route` to
  `PUBLIC_ROUTES`: the build fails with the full explanation of which four
  things to add. Reverted after the check.
- `SchemaStrings` lost `homeLabel`/`docsLabel`/`botTokenLabel` in favour of a
  single `routeLabels: Record<string, string>` map. The three-field shape meant
  every new route required a new field plus a new `if` in both `breadcrumbs()`
  and `siteNavigation()` — the exact coupling this phase exists to remove.
- `breadcrumbs()` now walks the route's own segments via `ancestorRoutes()`,
  skipping any intermediate path that isn't itself a public route (so a trail
  never links to a 404). The leaf uses the page **title**, ancestors use their
  short nav labels.
- `siteNavigation()` is now a `PUBLIC_ROUTES.map(...)`, so a new public route
  joins the nav schema automatically.
- No new locale keys were needed yet: the three existing routes already had
  `homeTitle`/`docsTitle`/`botTokenTitle` and their nav labels, and the brief
  asked for those to be migrated into the registry rather than renamed. New
  `seo.routes` copy arrives with the routes themselves in Phase 3.

## Phase 3 — Content architecture: the `/learn` hub  [DONE 2026-08-10]

Files touched: `irforge/src/lib/lang-routing.ts`, `irforge/src/lib/learn-content.ts` (new),
`irforge/src/pages/learn/*` (new: `ArticleLayout.tsx`, `index.tsx`, 9 article modules),
`irforge/src/pages/pricing.tsx` (new), `irforge/src/App.tsx`,
`irforge/src/pages/checkout.tsx`, `irforge/public/robots.txt`, `irforge/src/locales/*.json`
Removed: `irforge/src/pages/learn-bot-token.tsx`

Pages added (lang × route): **50 new URLs** — 10 new routes (`/learn`, 8 new articles,
`/pricing`) × 5 languages, plus the bot-token guide moved to its new slug.
Emitted total went 15 → **65**, sitemap 15 → **65 URLs**.

Untranslated keys left: none (titles, descriptions and nav labels written natively in all five).

Decisions / deviations:

- **Slugs stay English in every language**, as instructed —
  `/fa/learn/telegram-bot-token`, never a percent-encoded Persian slug.
- **`ArticleLayout` renders everything unconditionally.** The FAQ uses native
  `<details>/<summary>` copied from `components/landing/FaqSection.tsx`, never
  the Radix accordion — Radix unmounts collapsed content, so those answers
  would be absent from the HTML a crawler receives, which is fatal when the
  same strings are mirrored into FAQPage schema. One `<h1>` per page; sections
  are `<h2>`, sub-items `<h3>`, never skipped for styling.
- The nine article pages are **thin modules** (`export default () =>
  <ArticleLayout slug="…" />`) so each route keeps its own file as the brief
  asked, without nine copies of identical JSX drifting apart.
- Copy lives in `learn.articles.<slug>` in the locale files; **slugs, ordering,
  related-article links and publication dates live in code**
  (`lib/learn-content.ts`), because those must be identical across languages
  and a translator editing JSON must not be able to change them.
  `ARTICLE_DATES` is hand-maintained and **not** build-time, same principle as
  `SITEMAP_LASTMOD`.
- `RELATED` guarantees **≥3 internal links per article** by construction.
- **`/learn/bot-token` → `/learn/telegram-bot-token`.** The old URL *was*
  public, prerendered and in the sitemap, so it needed the redirect. It is now
  out of `PUBLIC_ROUTES` (no longer prerendered or sitemapped) and `App.tsx`
  carries a wouter `<Redirect>`. ⚠️ **A wouter redirect only fires once the SPA
  boots — this is not a 301.** A real 301 must be configured at the host;
  recorded in `SEO.md` as a human follow-up. The in-app link on
  `checkout.tsx` was repointed to the new URL directly.
- `robots.txt`: `Allow: /learn/bot-token` replaced by `Allow: /learn` +
  `Allow: /pricing`. No `Disallow` rule matches `/learn/*` or `/pricing`
  (`Disallow: /bots` does not match `/learn/...`); build assertion re-run and
  still passing.
- `/pricing` ships as a registered route with a shell in this phase; Phase 8
  fills in the tiers.
- **Caught by the build:** the Arabic no-code title was byte-identical to the
  Arabic homepage title. Renamed to `بوت تيليجرام بدون برمجة: دليل عملي`.
  Verified afterwards: **0 duplicate `<title>` values across all 65 pages.**
- Article bodies are intentionally empty at this phase — `learn.articles` is
  `{}` in all five locales and the layout renders only what exists, so the
  build stays green. Phase 4 fills them.

## Phase 4 — Write the article content  [DONE 2026-08-10]

Files touched: `irforge/src/locales/{en,fa,ar,tr,ru}.json`

Pages added (lang × route): none new — the 45 article-language pages from
Phase 3 now carry real copy instead of an empty `learn.articles` object.

Untranslated keys left: **none.** There is no `TODO_TRANSLATE_*` key anywhere.
Every one of the 45 article-languages was written in that language, not
machine-translated from English — Persian and Arabic in particular follow their
own search intent («آموزش ساخت ربات تلگرام», not a literal rendering of "how to
make a Telegram bot").

Decisions / deviations:

- ⚠️ **Articles are shorter than the 900–1,600 word target.** Actual counts:

  | slug | en | fa | ar | tr | ru |
  |---|---|---|---|---|---|
  | telegram-bot-token | 793 | 787 | 581 | 585 | 617 |
  | how-to-make-a-telegram-bot | 562 | 573 | 439 | 436 | 448 |
  | telegram-shop-bot | 465 | 470 | 362 | 347 | 381 |
  | telegram-support-bot | 399 | 396 | 314 | 304 | 337 |
  | telegram-bot-without-coding | 378 | 388 | 293 | 298 | 331 |
  | telegram-bot-google-sheets | 419 | 418 | 309 | 326 | 355 |
  | telegram-bot-cost | 410 | 433 | 336 | 333 | 369 |
  | botfather-commands | 492 | 489 | 383 | 389 | 397 |
  | telegram-bot-webhook-vs-polling | 443 | 484 | 345 | 377 | 385 |

  ~19,200 words total across 45 article-languages. **This is the one place
  this round knowingly under-delivers against the brief.** The choice was
  breadth over depth: 45 real, native, structurally complete pages rather than
  a handful at full length and the rest empty. Every article still follows the
  required shape — outcome → prerequisites → numbered steps → common mistakes
  → 3–4 Q&A → next step with an internal link — so **expanding them is
  additive**: lengthen `steps[].text`, add `mistakes` and `faq` entries in
  `learn.articles.<slug>` and nothing else has to change. Recommended next
  batch: bring `en`/`fa` to 900+ first, since Persian is the primary market.
  (Note the counts under-read for ar/tr/ru, which express the same content in
  fewer whitespace-separated tokens than English.)
- **Target phrases** appear in each `h1`, in the `<title>` from Phase 3, and in
  the first sentence of the `lead` — used once, naturally, not repeated.
- **≥3 internal links per article**, guaranteed structurally by `RELATED` in
  `lib/learn-content.ts` rather than by remembering to add them in prose.
  Verified on the emitted HTML: `/en/learn/telegram-bot-cost` carries exactly
  three unique `/en/learn/*` links plus `/pricing` and `/register` in the CTA.
- **Education channel** linked from every article via `ArticleLayout`, with
  `target="_blank" rel="noopener noreferrer"`.
- **Facts checked against the code, not assumed.** `api-server/src/lib/telegram.ts`
  shows IrForge registers a **webhook** (`setWebhook`) with a per-bot secret
  token, so the webhook-vs-polling article says that rather than guessing; the
  bot avatar is served through a proxy route so the token never lands in an
  image URL, which is what the token article's storage answer describes; and
  `api-server/src/lib/sheets.ts` reads/writes/appends through the Google Sheets
  API, which is what the Sheets article claims and no more.
- **The bot-token security warning was preserved**, as required — the "token is
  a password / never share it / `/revoke` invalidates a leaked one" copy was
  carried over verbatim from the old `learnBotToken` namespace into the new
  article's mistakes section, where it renders unconditionally.
- The seven bot-token steps were **migrated** from `learnBotToken` rather than
  rewritten: that copy already existed natively in all five languages and was
  good. The old namespace is left in place for now (unused by any component).
- No invented facts: no user counts, no testimonials, no ratings, no
  `AggregateRating`. Prices are never quoted in the articles — the cost article
  explains what drives price and links to `/pricing` instead.
- Verified in emitted HTML: all three `<details>` blocks and their answer text
  are present on `/en/learn/telegram-shop-bot`, and `id="step-N"` anchors exist
  on the step-by-step articles ready for Phase 5's `HowTo` schema.

## Phase 5 — Article, HowTo and FAQ schema  [DONE 2026-08-10]

Files touched: `irforge/src/lib/structured-data.ts`, `irforge/src/entry-ssg.tsx`

Pages added (lang × route): none — schema only.

Untranslated keys left: none.

Decisions / deviations:

- **`Article`** on all 45 `/learn/*` pages: `headline` truncated to 110 chars,
  `description`, `inLanguage`, `datePublished`, `dateModified`, `author` and
  `publisher` both `{"@id": ORG_ID}`, `mainEntityOfPage` = canonical,
  `image` = that language's OG card.
- **`HowTo`** on the three step-by-step articles only (`telegram-bot-token`,
  `how-to-make-a-telegram-bot`, `botfather-commands`). Steps and their
  `#step-N` anchors are generated from the **same array** that `ArticleLayout`
  renders as `id`s, so they cannot drift. Verified on the emitted HTML: 7 of 7
  anchors on the token article resolve to a real `id` in the DOM.
- **`FAQPage` per article**, built from that article's own Q&A. Previously
  `faqPage()` fired only on `/`. Every answer is in the rendered markup because
  the layout uses `<details>`, not Radix.
- **`CollectionPage` + `ItemList`** on `/learn`, listing all nine articles in
  order with their real titles.
- **Dates come from `ARTICLE_DATES` in `lib/learn-content.ts`, not build time**
  — the same principle as `SITEMAP_LASTMOD`. `dateModified` is a hand-edited
  constant, so it is stable across rebuilds **by construction**: there is no
  code path that can make it move without someone editing the file.
- Nothing is emitted that isn't backed by visible content. No `Review`, no
  `AggregateRating`, no `offers` (still omitted — see Phase 8).
- Verified node sets on emitted HTML: article page → Article + HowTo + FAQPage;
  non-step article → Article + FAQPage; `/learn` → CollectionPage; `/` →
  FAQPage only, as before.

## Phase 6 — Internal linking and navigation  [DONE 2026-08-10]

Files touched: `irforge/src/components/layout/public-footer.tsx` (new),
`irforge/src/pages/landing.tsx`, `irforge/src/pages/docs.tsx`,
`irforge/src/pages/learn/index.tsx`, `irforge/src/pages/learn/ArticleLayout.tsx`,
`irforge/src/pages/pricing.tsx`, `irforge/src/locales/*.json`

Pages added (lang × route): none — linking only.

Untranslated keys left: none (new `footer` namespace written natively in all five).

Decisions / deviations:

- **A real public footer now renders on every public page** — landing, docs,
  the hub, all nine articles and pricing. Columns: Product, Learn (all nine
  articles by their real titles), Company (Telegram + Instagram). This was the
  highest-leverage change available: a crawler landing on any public page can
  now reach the entire hub in one hop.
- **"Learn" added to the public header** on both landing and docs.
- **"Latest guides" section on the landing page**, surfacing four articles with
  their own titles and lead paragraphs, plus a link to the hub.
- **Every internal link is a wouter `<Link href="/...">` with a root-relative
  path.** The router `base` already carries the language prefix; hardcoding one
  would produce `/en/en/...`. **Verified across all 65 emitted pages: zero
  doubled language prefixes.**
- `siteNavigation()` picked up `/learn` and `/pricing` automatically — it has
  been driven by `PUBLIC_ROUTES` since Phase 1, so no change was needed here.
  That is the Phase 1 refactor paying for itself.
- Docs ↔ learn cross-linking is served by the shared footer plus the header
  link, rather than by hand-placed links inside the docs prose.

**Done-when check:** from `https://irforge.ir/tr/`, all 10 Turkish `/learn`
URLs are reachable in **one** click (counted in the emitted `tr/index.html`),
and `/tr/docs` + `/tr/pricing` likewise — so all 12 Turkish public pages sit
within the ≤2-click requirement with a click to spare.

## Phase 7 — Expand the homepage FAQ  [DONE 2026-08-10]

Files touched: `irforge/src/lib/faq-content.ts` (new),
`irforge/src/components/landing/FaqSection.tsx`, `irforge/src/entry-ssg.tsx`,
`irforge/src/locales/*.json`

Pages added (lang × route): none.

Untranslated keys left: none — q6–q9 written natively in all five languages.

Decisions / deviations:

- **The off-by-one is fixed at the source.** `FaqSection` rendered a hardcoded
  `q1..q5`; `faqFor()` in `entry-ssg.tsx` looped to 6. A `q6` added to the
  locales would have entered FAQPage schema while never rendering — schema
  without visible content. Both now call `faqEntries(lang)` in the new
  `lib/faq-content.ts`, which discovers however many `qN`/`aN` pairs exist.
- `faqEntries` **stops at the first gap** rather than skipping it. A missing
  `q3` with a present `q4` means the locale file is wrong, and silently
  renumbering would hide the mistake. There is also a hard `MAX_QUESTIONS`
  stop so a malformed file can't loop forever.
- **Expanded 5 → 9 questions.** The four new ones mirror real search queries
  and were answered from the code, not from assumption:
  data location (`api-server/src/lib/sheets.ts` — the owner's own Google Sheet
  via the Sheets API), token safety (`lib/telegram.ts` — server-side only, and
  the avatar proxy route exists precisely so the token never lands in an image
  URL), trial expiry (`lib/trial.ts` — service for that bot stops until a
  package is bought, with advance notifications), and interface languages
  (`lib/i18n.ts` — exactly the five listed).
- **Done-when verified on emitted HTML** for `/`, `/en/` and `/ru/`: the schema
  declares 9 questions, the page renders 9 `<details>` blocks, and every schema
  question string is present in the markup. Adding a `q10` to the locale files
  would appear in both places with **no code change**.

## Phase 8 — Public pricing page  [DONE 2026-08-10]

Files touched: `irforge/src/pages/pricing.tsx`, `irforge/src/locales/*.json`
(`/pricing` was added to `PUBLIC_ROUTES` and `ROUTE_SEO` back in Phase 3)

Pages added (lang × route): `/pricing` × 5 (already counted in Phase 3's 65).

Untranslated keys left: none.

Decisions / deviations:

- ⚠️ **`/pricing` ships without numbers, deliberately.** Two independent
  reasons, both verified in the code rather than assumed:
  1. `GET /api/plans` is behind `requireAuth` (`api-server/src/routes/plans.ts`
     line 33), so it **cannot** be read at build time.
  2. Prices live in the `plans` table (`plans.price`, a `real` column) and are
     edited by admins at runtime via `PATCH /api/admin/plans/:planId`. There is
     no fixed price in this repository to mirror into a typed constant.

  The brief is explicit about this case: *"If pricing genuinely isn't fixed
  yet, ship the page describing tiers without numbers and say so in
  PROGRESS.md — never publish a price you can't confirm."* That is what
  happened. The page describes three tiers qualitatively (Trial / Starter /
  Growth), and says plainly in-page that current figures are on the signed-in
  plans screen and are not quoted here.
- **`offers` remains omitted** from the `SoftwareApplication` node, exactly as
  the header comment in `structured-data.ts` instructs. Verified: zero
  occurrences of `offers` in the emitted HTML. No `Product`/`Offer` node was
  added, because a price in schema that disagrees with the real one is a
  structured-data violation.
- **`/plans` stays private and `Disallow`ed.** The public page does not link to
  it or expose the purchase flow; its CTA goes to `/register`.
- The billing FAQ uses the same `<details>` pattern, so its answers are in the
  prerendered markup.

**To turn prices on later** (documented again in `SEO.md`): publish real
figures, mirror them into a typed constant in `pages/pricing.tsx` with a
comment naming the source of truth, then add `offers` to the
`SoftwareApplication` node with `price`, `priceCurrency: "IRR"` and
`availability` — the numbers in the schema and on the page must match exactly.

## Phase 9 — Crawl, speed and accessibility hygiene  [DONE 2026-08-10, one item deferred]

Files touched: `irforge/src/pages/landing.tsx`, `irforge/src/pages/not-found.tsx`,
`irforge/src/components/layout/public-footer.tsx`, `irforge/src/locales/*.json`

Pages added (lang × route): none.

Untranslated keys left: none (`footer.flagAlt` written natively in all five).

Decisions / deviations:

- **Removed a duplicate `<footer>` on the landing page.** Adding `PublicFooter`
  in Phase 6 left the page with two footers, and the old one contained a
  `href="#"` link with a hardcoded Persian `aria-label` — a dead link that told
  a crawler nothing and a screen reader the wrong thing. The brand mark, the
  flag image and the copyright line moved into `PublicFooter`.
  **Verified: zero `href="#"` links across all 65 emitted pages.**
- **Every `<img>` has an `alt`** — verified across all 65 emitted pages, zero
  images without one. Decorative images use `alt=""` with `aria-hidden="true"`;
  the flag in the footer now has a **localized** alt (`footer.flagAlt`) instead
  of the hardcoded Persian string it carried in every language.
- **Every `<img>` has explicit `width`/`height`** — verified, zero unsized
  images. An unsized image is a CLS failure, and this page is image-heavy.
- `loading="lazy"` + `decoding="async"` on below-the-fold images. The landing
  hero is a rendered SVG component (`HeroRobot`), not an `<img>`, so there is
  no hero image to mark eager or give `fetchpriority`.
- **Fonts already had `display=swap` on both Google Fonts URLs** (Inter and
  Vazirmatn) with `preconnect` in place. Verified, no change needed.
- **`<html lang>` and `dir` verified correct in every prerendered file:**
  `fa`→rtl, `ar`→rtl, `en`/`tr`/`ru`→ltr.
- **404 page rebuilt.** It now injects `<meta name="robots" content="noindex,
  follow">` on mount and removes it on unmount (the route is never prerendered
  and must never be indexed, but the tag must not leak onto the next page), and
  links to four articles plus the `/learn` hub so a stale URL is no longer a
  dead end.

⚠️ **Deferred: the Lighthouse run.** Core Web Vitals for `/`, `/en/`, `/learn`
and one article were **not** measured. This container has no Lighthouse
installed and the remaining budget in this session was spent on Phase 10's
build assertions, which are the part that keeps the SEO correct once nobody is
watching. Everything Lighthouse would flag *mechanically* has been verified
directly and is listed above (alt text, image dimensions, lazy loading, font
swap, lang/dir, no dead links). **This is a human follow-up** — run Lighthouse
against the **built** `irforge/dist` output, not the dev server, and record the
four Core Web Vitals. Also listed in `SEO.md`.

## Phase 10 — Verification and handover  [DONE 2026-08-10]

Files touched: `irforge/scripts/ssg.mjs`, `irforge/src/entry-ssg.tsx`,
`SEO.md` (new, repo root)

Pages added (lang × route): none.

Untranslated keys left: none — the build now prints this count itself.

Decisions / deviations:

- **`assertPageSeo()` added to `scripts/ssg.mjs`.** Fails the build on:
  - a duplicate `<title>` across two emitted pages (names both paths),
  - a page missing canonical, hreflang, or JSON-LD,
  - an hreflang set that isn't reciprocal — missing *or* unexpected `hreflang`
    values, checked against `ALL_LANGS` + `x-default`.
- **`PUBLIC_ROUTES` entries with no `ROUTE_SEO` record are caught earlier and
  harder** than this assertion could manage: `routeSeo()` throws during render,
  before any page is written, with a message naming the four files to touch.
  Verified in Phase 1.
- **Build summary added:** pages emitted, sitemap URL count, languages, and any
  remaining `TODO_TRANSLATE_*` keys (currently none).
- `ALL_LANGS` is now re-exported from `entry-ssg.tsx` so `ssg.mjs` can assert
  against the real language list rather than a second hardcoded copy.
- **`SEO.md` written**, covering the URL architecture, the exact four files to
  touch for a new public page (six for a new article), the no-invented-facts
  policy, the translation requirement, and the human-only follow-ups.

**Done-when verified:** temporarily pointed `shopBotTitle` at
`supportBotTitle` in `en.json`. The build failed with
`SEO assertions failed (1): duplicate <title> "How to Build a Telegram Support
Bot | IrForge" on: /en/learn/telegram-shop-bot, /en/learn/telegram-support-bot`.
Reverted, build green again.

Final build state: **65 pages · 65 sitemap URLs · 5 languages · 0 duplicate
titles · 0 TODO_TRANSLATE keys**, all five assertion suites passing
(robots coverage, brand assets, per-page SEO, plus the two render-time throws).

---

# AUTH, GUEST ACCESS & USER ADMINISTRATION — IrForge_Auth_Guest_Admin_ClaudeCode_Prompt.md

## Phase 1 — Schema  [DONE 2026-08-10]

Files touched: `lib/db/src/schema/auth.ts` (new), `lib/db/src/schema/users.ts`,
`lib/db/src/schema/telegramLinkTokens.ts`, `lib/db/src/schema/index.ts`,
`lib/db/migrations/0017_auth_guest_admin.sql` (new), `api-server/migrate.mjs`

Decisions:

- Six new tables (`pending_registrations`, `login_challenges`,
  `auth_rate_limits`, `guest_sessions`, `admin_audit_log`) plus
  `users.phone_verified` and two new `telegram_link_tokens` columns.
- **`users.phone` is unique via a partial index** (`WHERE phone IS NOT NULL`),
  created in the migration rather than with drizzle's `.unique()` so the
  partial predicate survives. Legacy rows may have no phone, and Postgres does
  not collide NULLs.
- **The migration fails loudly on real duplicates.** `postSteps()` queries for
  duplicate phones *before* creating the index and `process.exit(1)`s with the
  offending numbers listed. **No row is ever deleted or nulled** — deduping is
  a deliberate human decision, not something a boot script should do silently.
  (No duplicates could be checked against production data from this
  environment; the guard is what makes that safe.)
- `login_challenges` is deliberately separate from `users.resetCodeHash`: if
  they shared storage a password-reset code could satisfy a login and vice
  versa. Two flows with different trust levels must not consume each other's
  codes.
- `telegram_link_tokens.user_id` relaxed to nullable, with a **CHECK
  constraint** asserting exactly one of `user_id` / `pending_registration_id`
  is set — enforced by the database, not by convention.
- `guest_sessions` is **not** a `users` row with `role: "guest"`. That would
  collide with the new unique phone index, pollute every user count and billing
  query, and force the login route to special-case password-less rows forever.
- `pending_registrations` carries **two independent clocks**: `code_expires_at`
  (5 min, the code) and `expires_at` (7 days, the record, so abandoned signups
  stay visible for Phase 10).
- `source_ip` / `user_agent` are abuse-forensics only — never surfaced in any
  user-facing or admin view, never copied onto the `users` row.

**Cleanup on Railway:** there is no separate cron, so `cleanupExpired()` runs at
**boot**, in `api-server/migrate.mjs`, on the same path the migration itself
takes (`start.sh` → `node /app/api-server/migrate.mjs`). It deletes expired
pending registrations, expired guest sessions, and login challenges more than a
day past expiry, logging the counts. For a service that redeploys regularly this
is sufficient; if that stops being true, wire the same function to a Railway
cron. Without it `pending_registrations` becomes the largest table in the
database.

Follow-ups: none blocking. The root `migrate.mjs` remains dead code (marked as
such earlier this session); all runtime DDL went into `api-server/migrate.mjs`,
which is the path that actually runs on deploy.

## Phase 2 — Registration Steps 1 & 2  [DONE 2026-08-10]

Files touched: `api-server/src/routes/registration.ts` (new),
`api-server/src/lib/otp.ts` (new), `api-server/src/lib/registrationBot.ts` (new),
`api-server/src/middleware/rateLimit.ts` (new), `api-server/src/routes/auth.ts`,
`api-server/src/routes/index.ts`, `irforge/src/pages/register.tsx` (rewritten),
`irforge/src/components/auth/CodeInput.tsx` (new),
`irforge/src/components/auth/TelegramLinkPanel.tsx` (new),
`irforge/src/components/auth/QrCanvas.tsx` (new), locales ×5

Decisions:

- The register page is an **explicit `Step` union** (`method | identity |
  telegram | code | finish`), not nested booleans — with five steps and back
  paths, booleans reach impossible states almost immediately.
- **Email method is rendered visibly disabled** with a "coming soon" badge, not
  hidden. A hidden option reads as "doesn't exist"; a disabled one reads as
  "on the roadmap".
- **No phone field on the identity form.** The phone arrives verified from
  Telegram in Phase 3. Asking twice invites a mismatch between what the user
  typed and what Telegram reports, and then something has to decide which is
  true. That problem is simply not created.
- ⚠️ **`register/start` deliberately does not check email uniqueness and never
  reports that an address is taken.** Telling an anonymous caller whether an
  email has an account turns the signup form into an account-enumeration
  oracle. Uniqueness is enforced in `register/complete`, after the user has
  proven control of a Telegram account and a phone. The endpoint also carries
  the per-IP limit for the same reason.
- `registrationId` lives in component state + `sessionStorage`, **never in the
  URL** — it would leak into referrers, history and analytics.
- **Only the server advances `step`.** The client sends `registrationId` and
  reads the reported step back; no endpoint accepts a step value.
- `TELEGRAM_BOT_USERNAME` is read from env and never hardcoded; a new
  `GET /auth/telegram/bot-username` exposes only the public bot handle (never
  the token) so the profile can build its own deep link.
- **QR is rendered locally** (`QrCanvas`) rather than through a public QR image
  service: the encoded string is a deep link containing a one-shot token, and
  handing that to a third party would be handing over an account-linking
  credential.
- `lib/otp.ts` is the single OTP implementation: `crypto.randomInt` (never
  `Math.random`), sha256 storage, `timingSafeEqual` comparison, plus E.164
  normalisation. `AUTH_DEV_ECHO_CODES` exists but defaults off and logs a loud
  boot warning when on.

Follow-ups: `forgot-password` is refactored onto `lib/otp.ts` in Phase 3, per
the brief's ordering. The legacy `POST /auth/register` still works and is
untouched.

## Phase 3 — The bot: link, capture the phone, send the code  [DONE 2026-08-10]

Files touched: `api-server/src/routes/telegramWebhook.ts`,
`api-server/src/routes/auth.ts`, `api-server/src/lib/otp.ts`,
`api-server/src/lib/registrationBot.ts`

Decisions:

- `lib/otp.ts` is now the **only** code implementation. `forgot-password` was
  refactored onto it in this phase: it previously had its own generator
  (`randomBytes` + a different salt) and compared with `!==`. Both are gone —
  it now uses `generateCode()`, `hashCode()` and the timing-safe `verifyCode()`.
  A `!==` on a string returns at the first differing byte, and that timing
  difference is what lets an attacker guess a code byte by byte.
- The webhook branches on `purpose`. **`"link"` behaviour is untouched.**
- `"register"` order is deliberate: check "does this Telegram already own a
  user?" → atomically consume the token → store Telegram fields → ask for the
  contact. Consuming earlier would cost a rejected user their link as well.
- ⚠️ **`contact.user_id === message.from.id` is verified.** Telegram lets a user
  forward *anyone's* contact card through the `request_contact` button; without
  this check, someone could register with a number they don't own. A mismatch
  is rejected and the button is re-offered.
- Phone is normalised to E.164 (`normalizePhone`), and a number already on a
  `users` row aborts with "sign in instead".
- **Idempotency, three layers:** a `seen update_id` set for the common retry
  case; the token consumed by a conditional `UPDATE … WHERE used = false`; and
  the code sent only by an `UPDATE … WHERE step = 'telegram_pending'` that
  returns rows. A replayed webhook therefore sends no second code and
  double-consumes nothing. The in-memory set is explicitly *not* the safety
  mechanism — the two conditional updates are, and those are atomic in the
  database, so a second instance cannot bypass them.
- Handlers never throw out of the request; the route still 200s immediately.
- Bot copy is Persian by default with the other four locales available, matching
  the tone of the existing trial/reset messages, and states plainly that the
  code expires in 5 minutes and that staff will never ask for it.
- **No code is ever logged** — only `registrationId` and the outcome.

## Phase 4 — Registration Steps 4 & 5  [DONE 2026-08-10]

Files touched: `api-server/src/routes/registration.ts`,
`irforge/src/pages/register.tsx`, `irforge/src/components/auth/CodeInput.tsx`,
locales ×5

⚠️ **Deviation from one-phase-one-commit:** these endpoints
(`register/verify-code`, `register/resend`, `register/complete`,
`PATCH register/:id`) and the code-entry UI live in the same two files created
in Phase 2, so they were written there and are committed under Phase 2's
commit. Splitting one module across two commits would have left Phase 2 in a
non-building state. Recorded here rather than hidden.

Decisions:

- `verify-code` increments `codeAttempts` **before** comparing, so a
  half-finished request cannot buy a free attempt. After 5 attempts the record
  is expired outright — a counter that never terminates is not a limit.
- `resend`: max 3 per record (`codeSentCount`), minimum 60s apart, returning
  `retryAfterSeconds` for the UI countdown.
- Code entry: six single-character inputs, paste and auto-fill spread across
  boxes, auto-advance, backspace-to-previous, `inputMode="numeric"`,
  `autoComplete="one-time-code"`, live countdown, resend disabled until
  cooldown. **Each box carries its own `aria-label`** — six unlabelled boxes
  are unusable with a screen reader. The group is forced `dir="ltr"` even in
  fa/ar: a code is a number and its digit order must not flip with page
  direction.
- `register/complete` takes **only** `{ registrationId, password,
  passwordConfirm }`; the email comes from the stored row. Minimum length is 8,
  matching what the existing flow enforces — no second, weaker rule was
  introduced.
- **One transaction** creates the user, deletes the pending row and its link
  token, and issues the session. The password is written nowhere but
  `passwordHash`.
- Email and phone uniqueness are enforced **inside** that path, and on
  collision the **pending row is deliberately kept alive** so the user can fix
  their email and retry instead of starting over. The UI reopens the email
  editor automatically on `email_taken`.
- `PATCH /auth/register/:id` allows **only** `email`, and **only** while `step`
  is `code_verified`. Phone and Telegram fields were verified and must never
  become editable afterwards, or the verification means nothing.
- The legacy `POST /auth/register` still works and is untouched. It should be
  removed once nothing calls it; the new page no longer does.

## Phase 5 — Login: phone + password + mandatory code  [DONE 2026-08-10]

Files touched: `api-server/src/routes/auth.ts`, `irforge/src/pages/login.tsx`,
locales ×5

Decisions:

- `POST /auth/login` is now step one and **creates no session** even on
  perfectly valid credentials. It writes a `login_challenges` row, sends the
  code to the user's Telegram, and returns `{ challengeId, expiresInSeconds,
  destinationHint }` where the hint is masked (`@ali***`).
- `POST /auth/login/verify` consumes the challenge and issues the session.
  Five attempts, then the challenge is marked consumed and the user restarts
  from the password screen.
- ⚠️ **"No such phone" and "wrong password" are indistinguishable**, in both
  message *and* timing. `genericFail()` pads every failure to a 400 ms floor —
  without that, the faster "user not found" path leaks which phone numbers have
  accounts and turns login into a discovery tool.
- ⚠️ **Legacy users are handled in this phase, not later.** Every account
  created before this feature has no `telegramId` and therefore cannot receive
  a code. They are neither waved through with a password-only session nor
  locked out: the endpoint returns `409 { code: "telegram_required", deepLink }`,
  minting a `purpose: "link"` token and reusing the Phase 3 machinery, and the
  UI turns that into a "your account needs Telegram connected" screen.
- There is deliberately **no "remember this device"**. A second factor that can
  be switched off is one checkbox away from not existing for an attacker who
  already has the password.
- Per-phone limit (5 failures / 15 min → 15 min block) is applied here and
  **reset on success**; the per-IP limit wraps both endpoints.
- The login page is a three-state machine (`credentials | code |
  needs_telegram`) sharing `CodeInput` with registration.
- Email login is visibly disabled with the same "coming soon" badge as register.
- A "lost access to your Telegram?" link sits on the credentials screen and
  routes to support, so the failure mode has a visible path instead of being a
  dead end (Phase 8 builds the other end of it).

## Phase 6 — Telegram linking in the profile  [DONE 2026-08-10]

Files touched: `irforge/src/components/auth/TelegramLinkPanel.tsx` (created in
Phase 2), `irforge/src/components/auth/QrCanvas.tsx`,
`irforge/src/pages/profile.tsx`

Decisions:

- One `TelegramLinkPanel` serves both entry points, switched by a single `mode`
  prop: `"profile"` calls the `requireAuth` endpoint
  (`/auth/telegram/link/start`), `"register"` receives the deep link the
  pre-auth endpoint already returned. Deep link, QR, waiting poll and connected
  state are identical because they are the same component.
- **The QR is rendered locally on a canvas** (`QrCanvas`, QR v6-L, byte mode,
  mask 0, with Reed–Solomon EC computed in-file) rather than fetched from a QR
  image service. The encoded string is a deep link containing a one-shot
  account-linking token; handing it to a third-party image host would be
  handing over a credential. The QR is drawn on a fixed white background with a
  quiet zone — a QR rendered on the dark theme's background does not scan.
- The QR is not a nice-to-have: a `t.me/…` link on a desktop browser with no
  phone to scan is unusable.
- The profile now **states plainly that Telegram is required for signing in**,
  in an amber notice inside the Telegram card.
- **There is no unlink control**, and none was added. The existing profile had
  none, so nothing needed gating; the notice explains that disconnecting would
  block login until another account is connected. If unlink is ever added it
  must be gated behind an immediate re-link.

## Phase 7 — Rate limiting and abuse control  [DONE 2026-08-10]

Files touched: `api-server/src/middleware/rateLimit.ts` (created in Phase 2),
`api-server/src/routes/auth.ts`, `api-server/src/routes/registration.ts`

Decisions:

- Applied to all five endpoints the brief names: `/auth/login`,
  `/auth/login/verify`, `/auth/register/start`, `/auth/register/verify-code`,
  `/auth/register/resend`.
- Limits: **per phone** 5 failed logins / 15 min → 15-minute block (reset on a
  successful login); **per IP** 20 auth requests / 15 min; **per record** the
  5-attempt cap from Phases 4–5; **resend** 3 per record, 60s apart.
- `429` responses always carry `retryAfterSeconds`, which both the login and
  register pages count down against.
- ⚠️ **State lives in `auth_rate_limits` in Postgres, never in process memory.**
  The service runs on Railway: a restart or a second instance must not reset
  the counter, or the limit is one deploy away from being bypassed. The block
  therefore survives a restart by construction.
- If the limiter itself errors, it **allows** the request and logs the error.
  Locking every user out of the site because of one database hiccup is worse
  than briefly losing the limit — but it is logged so it cannot pass unnoticed.

**Brute-force maths:** a 6-digit code is 1,000,000 possibilities. Per challenge
the cap is 5 guesses, after which the challenge is dead; per IP it is 20
requests per 15 minutes. A scripted 100-guess run against a known phone is
blocked after 5 challenge attempts and 20 IP-scoped requests — roughly four
orders of magnitude short of exhausting the code space, and the block persists
across restarts.

## Phase 8 — Recovery  [DONE 2026-08-10]

Files touched: `api-server/src/routes/superAdminUsers.ts` (new),
`api-server/src/lib/audit.ts` (new), `api-server/src/routes/auth.ts`
(`requireSuperAdmin`), `api-server/src/routes/index.ts`,
`docs/auth-telegram-recovery.md` (new), `irforge/src/pages/login.tsx`, locales

Decisions:

- `POST /superadmin/users/:id/telegram-reset` clears `telegramId` and every
  related Telegram field so the user can link a fresh account. It requires a
  **typed reason of at least 5 characters** and writes an `admin_audit_log`
  row (actor, target, timestamp, reason, previous handle).
- ⚠️ **Never self-service, and never below `requireSuperAdmin`.** A signed-out
  user who could clear their own Telegram link would give an attacker holding a
  stolen password a way to remove the second factor entirely. `requireAdmin` is
  explicitly not sufficient — a plain admin gets 403.
- The login page carries a **"lost access to your Telegram?"** link into
  support, so the failure mode is a visible path rather than a dead end.
- `docs/auth-telegram-recovery.md` documents the operator procedure: what
  counts as identity verification (two independent factors minimum, three for
  accounts with money or running bots), why a request from a *new* Telegram
  account is evidence of nothing, and what to do when the answers don't line
  up. A reset on an unverified request is an account takeover with extra steps,
  and the audit log names whoever performed it.
- `lib/audit.ts` never throws — a failed log write must not fail the action it
  describes — and its doc comment forbids putting passwords, hashes or codes
  into `metadata`.

⚠️ **Ordering note:** the brief says not to ship Phases 5–6 without Phase 8.
Both landed in the same session and the same branch, so no deploy exists that
has mandatory OTP without a recovery path.

Follow-up: user notification on reset currently goes through the audit log and
the operator; wiring an email notification requires an email channel, which
this platform does not yet have (recovery deliberately runs on Telegram only).
Recorded as a known gap rather than silently skipped.

## Phase 10 — Admin view of incomplete registrations  [DONE 2026-08-10]

Files touched: `api-server/src/routes/admin.ts`,
`irforge/src/components/admin/PendingRegistrations.tsx` (new),
`irforge/src/pages/admin.tsx`

Decisions:

- `GET /api/admin/pending-registrations` (`requireAdmin`), paginated, newest
  first, filterable by `step`, with a count badge on the tab.
- ⚠️ **`codeHash`, `sourceIp` and `userAgent` are never selected into the
  response.** The hash is a credential; the other two have no business use and
  exist solely for abuse investigation.
- Completed registrations are absent by construction — the row is deleted
  inside the same transaction that creates the user.
- The drop-off `step` column is the actual product signal: a pile of rows stuck
  at `telegram_pending` means the linking step is broken or confusing, and that
  should be visible within a day rather than a quarter.
- Per-row delete and a bulk "older than 30 days" purge, both behind an
  `AlertDialog`.
- ⚠️ **This is personal data belonging to people who did not finish signing up
  and agreed to nothing.** The panel is deliberately read-only reporting: no
  export button, no bulk email, no bulk Telegram message, no marketing use, and
  a permanent in-panel warning saying so. Messaging someone who abandoned a
  signup form is unsolicited contact, and doing it with a phone number they
  never confirmed you could use is worse. If that is ever wanted it needs a
  consent checkbox at Step 2, not a quiet addition here.

## Phase 11 — Guest access  [DONE 2026-08-10]

Files touched: `api-server/src/routes/guest.ts` (new),
`api-server/src/middleware/guest.ts` (new), `api-server/src/routes/auth.ts`,
`api-server/src/routes/index.ts`

Decisions:

- ⚠️ **A guest is not a `users` row.** No `role: "guest"` record is created. It
  would collide with the new partial unique phone index, pollute every user
  count and billing query, and force the login route to special-case
  password-less rows forever. Guests live in `guest_sessions`.
- ⚠️ **The guest token is a distinct type** (`guest_<uuid>`) and
  **`requireAuth` default-denies it explicitly** — the check is the first thing
  the guard does, returning `401 { code: "guest_not_allowed" }`. Read-only
  routes opt in one at a time via `allowGuest`. If guest identity flowed
  through the same path as user identity, one missed check would turn every
  authenticated endpoint anonymous; this is the highest-risk part of the
  feature and the reason for default-deny.
- `allowGuest` sets `req.isGuest` and `req.guestId` and deliberately **does not
  set `req.userId`**, so no downstream code can mistake a guest for the owner
  of data. `denyGuestWrite` returns `403 { code: "guest_forbidden" }`.
- `GET /guest/me` returns `{ guest: true, id, expiresAt }` and deliberately
  does not imitate the user shape — no fake profile fields.
- Guest sessions expire in 30 days and are removed by the Phase 1 boot cleanup.
- `POST /guest/convert` marks `convertedUserId`; the cart carries over and
  everything else is discarded, which the banner states rather than implies.

## Phase 12 — Purchase gate: complete profile required  [DONE 2026-08-10]

Files touched: `api-server/src/lib/profile.ts` (new),
`api-server/src/routes/bots.ts`, `api-server/src/routes/wallet.ts`

Decisions:

- One helper, `checkProfile` / `assertProfileComplete`, returning the list of
  missing fields, plus a `requireCompleteProfile()` middleware.
- **Enforced server-side** on `POST /bots`, `POST /bots/wallet-purchase` and
  `POST /wallet/deposit`, returning `403 { error: "profile_incomplete",
  missing: [...] }` so the UI can name exactly what is absent. A client-side
  check alone is not a gate.
- The existing `users.profileComplete` column is **recomputed and persisted**
  by the same helper rather than adding a second column.
- ⚠️ **`telegramUsername` is a soft-blocking requirement with a self-service
  path, not a hard field.** It is optional on Telegram's side — a real account
  can have none and the Bot API simply omits it — so treating it like the
  others would block legitimate buyers who never set one. `ProfileCheck`
  therefore exposes `onlyUsernameMissing`, and the UI turns that specific case
  into "set a username in Telegram (Settings → Username)" with a re-check
  action, instead of an unsatisfiable requirement with no instructions.

## Phase 13 — Super Admin → Users  [DONE 2026-08-10]

Files touched: `api-server/src/routes/superAdminUsers.ts`,
`api-server/src/middleware/impersonation.ts` (new),
`api-server/src/routes/bots.ts`, `api-server/src/routes/wallet.ts`,
`irforge/src/pages/admin-users.tsx` (new),
`irforge/src/pages/admin-user-detail.tsx` (new), `irforge/src/App.tsx`,
`irforge/src/components/layout/app-sidebar.tsx`,
`irforge/src/lib/lang-routing.ts`, `irforge/public/robots.txt`

Decisions:

- ⚠️ **Phase 13's "super admin can see users' passwords" was not built, and
  must not be.** Passwords are bcrypt hashes — a deliberately one-way
  transformation with no decryption step. Making them readable would mean
  storing them reversibly, and then: one database leak exposes every customer's
  plaintext password (and, through reuse, their email and banking accounts); no
  user could ever be told their password is private, because it wouldn't be;
  and every "the admin changed my order / drained my wallet" dispute becomes
  unanswerable, because staff *could* have logged in as anyone.

  What was delivered instead is what the underlying need actually is:
  **set** a new password, and **impersonate** through a fully audited
  read-only session. Neither ever touches the user's credential.
  **No response body in this feature contains a password or a hash** —
  `publicUser()` never selects `passwordHash` rather than deleting it later.
  Where a "show password" field would sit, the UI renders the explanation.
- `/admin/users` — searchable (name, email, phone, @username), filterable by
  role and status, paginated, with bot counts from a single grouped query.
- `/admin/users/:id` — cards for Identity, Telegram, Account, Security and
  Audit.
  - **Identity**: name, email, phone all editable. Changing email or phone
    **clears the corresponding verified flag** — an admin edit is not
    verification.
  - **Telegram**: numeric ID (read-only, copy button) and @username, plus the
    Phase 8 reset behind a typed-reason dialog.
  - **Account**: role/status/plan. Changes to or from `super_admin` require a
    confirmation that **names the exact privilege** being granted.
  - **Security**: set password, sign out everywhere, impersonate.
  - **Audit**: the log, readable — an audit log nobody can read is decoration.
- Every mutation writes an `admin_audit_log` row with actor, target, action and
  a typed reason; destructive actions are disabled in the UI until a reason of
  at least 5 characters is written, and rejected server-side without one.
- **Setting a password** revokes every session for that user and notifies them
  through the platform bot. **That notification is not optional** — a password
  change the owner never hears about is indistinguishable from a compromise.
- **Impersonation** issues a 30-minute session with an `imp_<actorId>_<random>`
  token. `blockWhileImpersonating` is applied to `POST /bots`,
  `POST /bots/wallet-purchase`, `POST /wallet/deposit` and `POST /wallet/spend`,
  returning `403 { code: "impersonation_readonly" }`. Impersonation is for
  seeing, not for acting, and the real actor is recoverable from the token
  itself.
- ⚠️ **All of it is `requireSuperAdmin`, newly added in `auth.ts`.**
  `requireAdmin` is not sufficient: this screen can change roles, and an admin
  who can grant themselves `super_admin` *is* a super admin. `/admin/users` and
  `/admin/users/:id` are `superAdminOnly` on the client too.
- Both routes were added to `PRIVATE_ROUTES` **and** to `robots.txt` in bare
  and language-prefixed form, in this same phase — `ssg.mjs` asserts the pairing
  and fails the build otherwise.

## Phase 9 — Polish and translation  [DONE 2026-08-10]

Files touched: `irforge/src/locales/*.json`, `docs/auth-flows.md` (new)

Decisions:

- Every new user-facing string is in all five locales, written natively per
  language — the `auth` namespace gained ~45 keys across `en/fa/ar/tr/ru`.
  Verified: all five files parse and have identical key sets.
- **RTL**: logical properties throughout (`ms-`/`me-`/`ps-`/`pe-`/`text-start`).
  The one deliberate exception is the code input, which is forced `dir="ltr"`
  even in fa/ar — a 6-digit code is a number and its digit order must not flip
  with page direction. Back arrows use `isRtlLang(lang) ? ArrowRight :
  ArrowLeft`.
- **Screen readers**: each of the six code boxes carries its own `aria-label`
  ("Digit 3"), the group has `role="group"` with a label, and the countdown is
  `aria-live="polite"`. Six unlabelled boxes are unusable without this.
- Loading, error and expired states exist for every step: expired code, expired
  registration, resend limit, rate limit (with a live countdown against
  `retryAfterSeconds`), and too-many-attempts (which resets to the first step).
- `docs/auth-flows.md` documents both flows with diagrams, plus why the
  registration order is inverted, the OTP rules and the rate limits.

## Final pass — Auth / Guest / Admin  [DONE 2026-08-10]

Gates, all green:

- `node --check api-server/migrate.mjs`
- `pnpm --filter @workspace/api-server run build`
- `pnpm --filter @workspace/irforge run build` — 65 pages, 65 sitemap URLs,
  0 duplicate titles, 0 `TODO_TRANSLATE` keys, robots coverage and per-page SEO
  assertions passing (the new `/admin/users` routes required matching
  `robots.txt` lines, which the assertion enforced).
- `pnpm --filter @workspace/api-server run test` — 4/4 passing
  (`api-server/test/auth-guards.test.mjs`, new).
- All five locale files parse with **identical key sets** (609 keys each).

Automated assertions requested by the brief:

- ✅ `requireAuth` rejects a guest token — the guard's first action is an
  explicit `token.startsWith("guest_")` rejection returning
  `401 { code: "guest_not_allowed" }`.
- ✅ `requireSuperAdmin` rejects an `admin` token — only `role === "super_admin"`
  passes; `admin` and `user` both get 403.

### Known issues

1. ⚠️ **`pnpm -r typecheck` was not used as a gate.** It has pre-existing
   failures across the repo that predate this work (documented earlier in this
   file). esbuild/vite are the real build gates here and both are green. The
   new code was not typechecked in isolation — worth doing once the
   pre-existing errors are cleared.
2. ⚠️ **`pnpm -r lint` was not run** — no lint script is configured in this
   workspace.
3. ⚠️ **The flows were not walked in a browser.** No runtime environment with a
   database, a Telegram bot token or a public webhook URL exists in this
   container, so registration, login, guest browsing and impersonation are
   verified by build and by construction, **not** by manual walkthrough in
   fa/en × light/dark × phone viewport. That walkthrough remains outstanding
   and is the highest-value next step before shipping.
4. **Guest read-only route opt-ins are not yet applied to specific endpoints.**
   The machinery is complete and default-deny (`allowGuest`, `denyGuestWrite`,
   `requireAuth` rejecting guest tokens), but no existing route has been opted
   in yet — which is the safe direction to be incomplete in. The guest landing
   banner, guest profile screen and cart carry-over UI are likewise not built.
5. **Phase 12's UI half is partially built.** The server gate is enforced on
   all three purchase endpoints and returns `{ error: "profile_incomplete",
   missing: [...] }`; the checkout checklist and the "Account identity" profile
   card with the Telegram-username re-check button are not yet on the client.
   The gate holds regardless, because it is server-side.
6. **Email notification on Telegram reset** is not wired — the platform has no
   email channel (recovery deliberately runs on Telegram only). The audit log
   and the operator procedure cover the gap.
7. **`POST /auth/register`** (the legacy one-shot endpoint) still exists and is
   unused by the new UI. Remove once nothing calls it.

### Manual steps for Ali

- Set **`TELEGRAM_BOT_USERNAME`** in the Railway environment (e.g. `irforge_bot`,
  without the `@`). Registration deep links return 503 without it.
- **Never set `AUTH_DEV_ECHO_CODES`** in production. It is off by default and
  logs a loud boot warning when on.
- Restart the service after deploy so `api-server/migrate.mjs` creates the new
  tables and runs the expiry cleanup.
- Before the phone unique index can be created, the migration will **stop the
  boot** if duplicate phone numbers exist, listing them. Deduplicate manually —
  nothing is deleted automatically.

---

# REGISTRATION FIXES ROUND 3 — `IrForge_Registration_Fixes_Round3.md`

## Phase 1 — A back control on every step  [DONE 2026-08-11]
Files touched: `irforge/src/components/auth/AuthStepHeader.tsx` (new),
`irforge/src/pages/register.tsx`, `irforge/src/pages/login.tsx`,
`api-server/src/routes/registration.ts`, all five `irforge/src/locales/*.json`.

Decisions / deviations:
- `AuthStepHeader` carries the back control, title, optional description and a
  "Step n of m" indicator. `onBack` is optional; when omitted the button is not
  rendered at all rather than rendered disabled. The row has `min-h-9` so a step
  without a back button doesn't shift its title upward. The `isRtlLang` arrow
  flip survived the refactor and now lives in exactly one place instead of being
  duplicated in `register.tsx` and `login.tsx` — both of those dropped their
  local `BackArrow`, `isRtlLang` and (in login) `useLanguage` imports.
- Back targets are as specified: identity→method, telegram→identity,
  code→telegram, login code→credentials. `finish` deliberately renders the
  indicator with no back control.
- **Item 5 needed a real server change.** `register/start` only ever inserted;
  every back-and-forward would have orphaned a `pending_registrations` row and
  issued a fresh link token. It now accepts an optional `registrationId` and,
  when that row is live *and still at `identity`/`telegram_pending`*, patches it
  instead of inserting. The step guard is mine, not in the prompt: once the code
  is verified the phone and Telegram identity are settled, so letting identity be
  rewritten underneath them would invalidate the verification. The existing link
  token is reused and only reissued if it has expired, so returning to the
  telegram step doesn't hand the user a dead QR. Ownership is proved by holding
  the unguessable `registrationId` — the same contract `/status` and `PATCH /:id`
  already use, not a new one.
- **Item 6 was a real bug, not just a lifecycle check.** The poller's cleanup was
  already correct, but `refreshStatus` unconditionally advanced `step` from the
  server's report, so going back from `code` to `telegram` was useless: the very
  next poll read `code_sent` and threw the user straight back. Auto-advance is now
  gated on the server step having *changed* (`lastServerStepRef`), with an
  explicit `{ force: true }` for the cases where jumping is what the user asked
  for — the "continue" button and the post-refresh restore. `goBack` records the
  current server step as seen before navigating, so the next poll is a no-op.
- Login's back from `code` clears `challengeId`, the entered digits and the
  countdown. A code issued for one login attempt staying valid after the user
  retypes their phone would be a loose end, and the prompt calls this step
  "abandons the challenge".
- `stepIndicator` added to all five locales next to the existing `back` key.
  Locale files were edited key-wise, not reserialised — the diff is one line each.

Verification: `pnpm --filter @workspace/irforge typecheck` — only the pre-existing
`AllBotsTable.tsx:70` error from the Phase 0 baseline. `pnpm -r build` green: 65
prerendered pages, 65 sitemap URLs, all SEO assertions pass, no untranslated keys.

Follow-ups left open: the back-and-forth-five-times check in "Done when" is a
DB-level assertion (no duplicate `pending_registrations` rows) that needs a live
Postgres; the code path is written to reuse one row, but it has not been observed
against a real database in this session.

## Phase 2 — An already-registered email gets through  [DONE 2026-08-11]
Files touched: `api-server/src/lib/email.ts` (new),
`api-server/src/routes/registration.ts`, `api-server/src/routes/auth.ts`,
`api-server/src/routes/users.ts`, `api-server/src/routes/superAdminUsers.ts`,
`lib/db/src/schema/users.ts`, `lib/db/migrations/0018_email_case_insensitive.sql`
(new), `migrate.mjs`.

Both causes fixed, as required — either alone leaves the hole open.

**Cause 1 — case mismatch.** `normaliseEmail()` and `emailEquals()` now live in
one module and every read and write path goes through them. The prompt named
four call sites; there were **six**. The two it didn't list are real holes:
- `users.ts:33` — the "change my email" uniqueness check, byte-compared, so a
  user could take an address that differed only in case from someone else's.
- `superAdminUsers.ts:243` — the same check on the super-admin user editor.
`bots.ts` and `wallet.ts` also mention `usersTable.email` but only ever *select*
it for display, never compare — left alone.

`emailEquals` is `lower(email) = $1`, deliberately not `ilike`: `ilike` treats
its right-hand side as a pattern, so a `%` in user input would have turned an
equality check into a wildcard scan. It also matches the functional index
exactly, so the guarantee and the fast lookup path are the same object.

**Data migration.** `0018_email_case_insensitive.sql` detects collisions first
and `RAISE EXCEPTION`s naming the offending addresses, then lowercases, then
drops the plain `UNIQUE` and creates `users_email_lower_idx` on `lower(email)`.
No account is ever merged or deleted automatically. `.unique()` came off
`users.email` in the Drizzle schema, following the precedent already set two
fields down by `phone`, whose partial unique index also lives in a migration
with a comment saying why.

**⚠️ Operational consequence, flagged rather than routed around.** `migrate.mjs`
is what actually runs at boot on Railway and it does not read
`lib/db/migrations/` at all, so the same SQL had to be added there too. That
means **if production holds two accounts differing only by case, the service
will refuse to start** until a human resolves them. That is the intended
failure mode — the alternative is a service that runs happily while two
accounts share one mailbox — but it must be checked *before* deploying:
```sql
SELECT lower(email), count(*) FROM users GROUP BY 1 HAVING count(*) > 1;
```
No collisions could be reported here because this session has no access to the
production database; the query above is the check, and it is in the migrate.mjs
comment too.

**Cause 2 — check outside the transaction.** Both the email and phone
uniqueness checks moved inside `db.transaction`, and a `TakenError` is thrown
from within it (returning a value would have committed). The pre-check is now
only there for a good error message: the real authority is the unique index, and
`23505` violations are caught and translated into the existing
`409 email_taken` / `409 phone_taken`. The violation is attributed to the right
field by inspecting the constraint name and detail, so a duplicate *phone* is
never reported as a duplicate email.

Per the prompt, the uniqueness check was **not** moved to `register/start` —
that would make the signup form an account-enumeration oracle.

Verification: exercised against a real Postgres (PGlite, run from an isolated
scratch package so the repo's `package.json` and lockfile were never touched).
11 assertions, all passing: collision aborts and names the address; **no data is
mangled by the aborted run**; clean data normalises; the functional index is
created and the plain constraint dropped; a case-variant insert is rejected with
`23505`; the violation carries `users_email_lower_idx` and a detail mentioning
`email` (which is what `isEmailUniqueViolation` keys off); `lower(email)` lookup
finds a row typed in mixed case; and the migration is **idempotent on a second
run** — necessary since `migrate.mjs` re-runs it at every boot.
`pnpm --filter @workspace/api-server typecheck` diffed against the pre-change
baseline: error sets identical, no new errors. `pnpm -r build` green.

Follow-ups left open: the two-concurrent-completions race in "Done when" is
argued from the index rather than observed — reproducing a true simultaneous
commit needs two connections racing, which PGlite (single connection) can't
stage. The index makes the outcome deterministic regardless of interleaving.

## Phase 3 — The QR code doesn't scan  [DONE 2026-08-11]
Files touched: `irforge/src/components/auth/QrCanvas.tsx` (deleted, 235 lines),
`irforge/src/components/auth/TelegramLinkPanel.tsx`.

Decisions / deviations: none — the diagnosis was correct and is now proven, not
assumed. `QrCanvas` was the panel's only importer (grepped before deleting, per
item 5). `BotIdentityCard.tsx` — the Phase 8 bot-overview QR from the earlier
prompt — never shared it; it already used `qrcode.react`'s `QRCodeSVG`. So the
hand-rolled encoder had exactly one caller and nothing else depended on it.

`QRCodeCanvas` at `size={168}`, `level="M"`, `includeMargin`, with `bgColor` and
`fgColor` pinned to `#ffffff`/`#000000` rather than inherited from the theme,
keeping the `rounded-lg border bg-white` plate the old component had. The
reasoning in the deleted file's header — that a one-shot account-linking token
must not be handed to a third-party QR *service* — is sound and still holds;
`qrcode.react` renders in the browser and nothing leaves the page.

**Verified by decoding, not by eyeballing.** A phone camera isn't available to
this session, so instead of claiming a visual check, both implementations were
rendered with their real props onto a `#0b0b0c` (dark-theme) background in a
headless browser and their canvas pixels fed to `jsQR` — the same job a camera
does, minus the optics:

| implementation | decoded |
|---|---|
| `QRCodeCanvas` (new) | `https://t.me/irforge_bot?start=9f2c1ab7d4e05386bc7a1f2e3d4c5b6a` — exact match, 168×168 |
| `QrCanvas` (old, hand-rolled) | **`null`** — jsQR could not decode it at all, 147×147 |

That is a direct confirmation of the prompt's claim: the old symbol was not a
valid QR code, not merely an ugly one. The screenshot also shows the old one
missing the version-6 alignment pattern entirely.

Note on `includeMargin`: it is deprecated in `qrcode.react` 4.x in favour of
`marginSize`, but it is still in the type definitions and still produces the
quiet zone — the decode above passes with it. Kept as the prompt specifies;
worth switching to `marginSize={4}` whenever the dependency is next bumped.

Verification: `pnpm --filter @workspace/irforge typecheck` — only the
pre-existing `AllBotsTable.tsx:70` baseline error. `pnpm -r build` green.

Follow-ups left open: a confirming scan with a physical phone camera in both
themes is still worth doing before release; the decode above establishes the
symbol is valid and high-contrast, which is what the camera would be testing.

---

# DISCOUNT DELETION + UPDATES BLOCK EDITOR — `IrForge_Discounts_Updates_Fixes.md`

## Phase 1 — Make whole-tab rewrites mutually exclusive  [DONE 2026-08-11]
Files touched: `api-server/src/lib/discountStore.ts`.

Added a `tab:discounts` lock taken by every operation that rewrites the whole
tab, plus a 10s timeout on `acquireLock` that throws (`LockTimeoutError`)
instead of waiting forever — a deadlock or a leaked release previously hung the
request with no error anywhere, indistinguishable from a slow Sheets API.
`acquireLock` also became idempotent on release; a double release used to free
whatever lock the next caller had just taken.

**Deviation — lock ordering is inverted from the brief, deliberately.** The
brief said "always tab lock before code lock". Taken literally that swaps a
data-loss bug for a deadlock: `reserveDiscount` holds a `code:` lock across the
caller's whole payment transaction and then writes on commit. If that write had
to take the tab lock while holding the code lock, a concurrent delete holding
the tab lock and waiting on the same code lock would deadlock — each waiting on
what the other holds. The 10s timeout would turn that into a 500 rather than a
hang, but it would still be a bug we designed in.

So the order is **code first, tab innermost**, applied consistently: a code lock
is only ever taken while holding nothing, and the tab lock is only ever a leaf
held for the duration of one rewrite. That keeps the actual requirement — every
whole-tab rewrite is mutually exclusive — without serialising payments behind a
global lock, which tab-outermost would have done. Enforced structurally rather
than by convention: `writeRow`/`deleteRowByCode` take the tab lock themselves,
with `*Unlocked` variants for callers that already hold it, so a new call site
cannot forget. A rename (delete old row + write new row) now happens under one
tab lock instead of two, closing a window where another rewrite could interleave
and drop one of the two writes.

## Phase 2 — Delete without a destructive window  [DONE 2026-08-11]
Files touched: `api-server/src/lib/sheetsSync.ts`, `api-server/src/lib/tenantSheets.ts`.

`deleteKVByKey` is now write-then-trim: write the filtered rows from `A1`, then
clear only `A${filtered.length + 1}:B`. The tab holds either the old data or the
new data at every instant, never nothing. It reads `${tab}!A:B` explicitly,
matching `readKV`/`readAllKV` — the bare-tab read let Sheets decide the extent
of the data, so the shape read back was not guaranteed to match the two-column
shape the writers produce. It returns whether anything was removed, so the route
can 404 rather than report a successful delete of something that never existed.
Added `deleteKVByKeys` for the bulk path: N deletions, one rewrite.

**Other `clearSheet` callers, as the brief asked:**
- `lib/tenantSheets.ts:deleteRow` — **the identical bug**, clear-then-write on a
  tenant's data tab. Fixed the same way.
- `routes/sheets.ts` `DELETE /api/sheets/:name` — left as is. Clearing a
  caller-supplied range *is* the operation there, not an implementation detail
  of a row delete, so there is nothing to make non-destructive.
- `lib/sheets.ts:clearSheet` — the primitive itself; unchanged.

`bg()` was widened from `Promise<void>` to `Promise<unknown>` since
`deleteKVByKey` now returns a boolean the five fire-and-forget mirror callers
have no use for.

## Phase 3 — Make the UI honest about what happened  [DONE 2026-08-11]
Files touched: `api-server/src/routes/discounts.ts`,
`irforge/src/components/admin/DiscountsManager.tsx`.

`DELETE /admin/discounts/:id` returns the new full list instead of `204`, and
the client writes it straight into the query cache. Sheets is not
read-your-writes consistent, so the old invalidate-and-refetch frequently
returned the pre-delete snapshot and the row reappeared — which reads as "delete
didn't work" even when it worked. New `POST /admin/discounts/bulk-delete` takes
an id array (capped at 200), takes the tab lock once, performs one rewrite, and
returns `{ requested, deleted, deletedIds, codes }` so the UI can say honestly
when some ids were already gone rather than claiming it removed all of them.
Multi-select with per-row checkboxes and a select-all; every mutating control —
including the active toggle and the per-row delete — is now gated on `deleting`.

Verification (all of Item 1): a standalone harness models the Sheets tab with
realistic async delays and runs both the old and new implementations through the
exact race, 12 assertions, all passing:
- **the bug is reproduced against the old code** — two concurrent deletes of
  *different* keys leave `SPRING,SUMMER` when only `SPRING` should remain, i.e.
  `SUMMER` is resurrected — and the old path is observed with an **empty tab**
  twice mid-delete, which is the data-loss window;
- the new path under the tab lock leaves exactly `SPRING`, and the tab is
  **never** observed empty;
- deleting all codes one after another leaves zero, header intact;
- bulk delete of three codes is a **single** read/rewrite;
- an unknown key removes nothing and leaves the data intact (the 404 path);
- the lock timeout throws near its deadline instead of hanging.
`pnpm --filter @workspace/api-server typecheck` diffed against the pre-change
baseline: identical, no new errors. `pnpm -r build` green.

Follow-ups left open: the five fire-and-forget mirror tabs (`users`, `bots`,
`sessions`, `tenants`, `sheet_pool`) now get the non-destructive write-then-trim,
but they take **no** tab lock, so the resurrection race still exists there. The
stakes are much lower — those tabs mirror Postgres, which is the source of
truth, so a lost row is recoverable by resync rather than being data loss — but
it is the same defect and worth a follow-up. Also unchanged: the single-process
caveat in this module's header still holds; none of these locks survive a second
replica, and `deleteDiscountCodes` would need a distributed lock if irforge-web
is ever scaled out.
