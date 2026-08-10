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

**Baseline (pre-existing, not introduced by this round):**

- `api-server` esbuild emits one warning: `"import.meta" is not available with the "cjs" output format` at `src/app.ts:18:33`. The file already guards this at runtime; left alone.
- `irforge` build emits `src/components/ui/command.tsx (2:0): Error when using sourcemap for reporting an error` — a rollup sourcemap notice, not a build failure. Left alone.
- `tsc --noEmit` has pre-existing errors across the repo and is **not** the build gate for this work; esbuild/vite are. Not touched.
- Prerender baseline: 15 pages, sitemap 15 URLs, robots 34 disallow rules — all assertions pass.
