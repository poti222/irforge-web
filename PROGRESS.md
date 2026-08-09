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
