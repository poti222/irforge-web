# Rial Migration Audit (Phase 1 — Read-Only Investigation)

**Scope:** `irforge-web` monorepo (`api-server/src`, `irforge/src`, `lib/db/src/schema`).
**Purpose:** Pre-work audit for migrating the canonical money unit from Toman (current) to Rial (integer, canonical), converting to Toman only for display. **No code was changed.** This document is input for a human-reviewed Phase 2.
**Date:** 2026-09-06.

> Where I was not fully certain, I've said so explicitly rather than guessing. Anything marked "NEEDS HUMAN VERIFICATION" should be checked by a human/DB access before Phase 2 proceeds.

---

## 0. Schema ground-truth (read first, before grepping)

Read directly from `lib/db/src/schema/*.ts`:

| # | Requested as | Actual table | Actual TS field / DB column | Type | File:line |
|---|---|---|---|---|---|
| 1 | `wallet.ts:16 balance` | `wallets` (`walletsTable`) | `balance` / `balance` | `integer` | `lib/db/src/schema/wallet.ts:16` |
| 2 | `wallet.ts:27 amount` | `wallet_transactions` (`walletTransactionsTable`) | `amount` / `amount` | `integer` | `lib/db/src/schema/wallet.ts:27` |
| 3 | `wallet.ts:65 requested_amount` | `wallet_topups` (`walletTopupsTable`) | `requestedAmount` / `requested_amount` | `integer` | `lib/db/src/schema/wallet.ts:65` |
| 4 | `wallet.ts:67 suffix` | `wallet_topups` | `suffix` / `suffix` | `integer` | `lib/db/src/schema/wallet.ts:67` |
| 5 | `wallet.ts:69 final_amount` | `wallet_topups` | `finalAmount` / `final_amount` | `integer` | `lib/db/src/schema/wallet.ts:69` |
| 6 | `wallet.ts:88 parsed_amount` | `sms_logs` (`smsLogsTable`) | `parsedAmount` / `parsed_amount` | `integer`, nullable | `lib/db/src/schema/wallet.ts:88` |
| 7 | `payments.ts:17 amount` | `payments` (`paymentsTable`) | `amount` / `amount` | `integer`, nullable | `lib/db/src/schema/payments.ts:17` |
| 8 | `discounts.ts:42 order_amount` | `discount_redemptions` (`discountRedemptionsTable`) | `orderAmount` / `order_amount` | `integer` | `lib/db/src/schema/discounts.ts:42` |
| 9 | `discounts.ts:44 discount_amount` | `discount_redemptions` | `discountAmount` / `discount_amount` | `integer` | `lib/db/src/schema/discounts.ts:44` |
| 10 | `plans.ts:8 price` | `plans` (`plansTable`) | `price` / `price` | **`real`** (float — confirmed bug per prompt) | `lib/db/src/schema/plans.ts:8` |
| 11 | `marketplace.ts:15 price` | `marketplace_items` (`marketplaceItemsTable`) | `price` / `price` | **`real`** (float) | `lib/db/src/schema/marketplace.ts:15` |

**Critical scope-boundary finding, confirmed by direct code inspection — the schema files' own comments say so:**

- **`discount_codes` and `discount_redemptions` are DEAD TABLES.** `api-server/migrate.mjs:648-649` runs `DROP TABLE IF EXISTS discount_redemptions;` / `DROP TABLE IF EXISTS discount_codes;`. The real discount-code system was moved entirely to Google Sheets (`api-server/src/lib/discountStore.ts:1-9`: *"Discount codes — moved off Postgres entirely... Postgres has zero tables for this data"*). Columns #8 and #9 above (`discounts.ts:42`/`:44`) therefore have **zero live consumers in Postgres** — no code anywhere selects, inserts, or updates `discountRedemptionsTable`/`discountCodesTable` (`grep` for `discountRedemptionsTable`/`discountCodesTable` usage in `api-server/src` returns nothing). The *concept* of `orderAmount`/`discountAmount` is very much alive, just entirely in the Sheets-backed system (`lib/discountStore.ts`) and in an ephemeral (never-persisted) computation (`lib/discounts.ts`). See §1.8/1.9 below for where the live equivalents actually are.
- A second, unrelated "wallet" system exists: `api-server/src/lib/walletStore.ts` (bot-plugin wallet, Google-Sheets-backed, `owner_type="user"`) and `irforge/src/components/bots/wallet/WalletSection.tsx` / `.../orders/OrdersSection.tsx`. These have their own `balance`, `amount`, `final_amount` *fields* that are **not** the Postgres columns audited here — they belong to the per-bot "wallet" and "catalog/orders" plugins, are Sheets/`BOT_CACHE_DATABASE_URL`-backed, and (per `WalletSection.tsx:29` `currency: string`) are not even guaranteed to be Toman-denominated. I did not include these as consumers of the 11 columns, but flag them because the naming collision is exactly the kind of thing that could cause a Phase-2 patch to touch the wrong file. **NEEDS HUMAN CONFIRMATION** that Phase 2 should explicitly exclude `lib/walletStore.ts`, `routes/botWallet.ts`, and the bot-order-plugin frontend components.

---

## 1. Consumers of the 11 columns

### 1.1 `wallets.balance` (`wallet.ts:16`)

**api-server/src:**
| File:line | R/W | Context |
|---|---|---|
| `lib/wallet.ts:23` | type decl | `WalletRow = { id, userId, balance: number }` |
| `lib/wallet.ts:27,30,34` | R/W | `ensureWallet()`: reads existing row; `.insert(walletsTable).values({ balance: 0 })` on first creation |
| `lib/wallet.ts:65-67` | R/W | `deductWallet()`: atomic `.set({ balance: sql`${walletsTable.balance} - ${amt}` })` guarded by `gte(walletsTable.balance, amt)` in the `WHERE` |
| `lib/wallet.ts:94-96,102` | R/W | `creditWallet()`: atomic `.set({ balance: sql`${walletsTable.balance} + ${amt}` })`, returns new `balance` |
| `routes/wallet.ts:38` | R | `GET /api/wallet` → `{ balance: wallet?.balance ?? 0 }` |
| `routes/wallet.ts:155-160` | W | `POST /api/wallet/spend` — atomic decrement, same guarded pattern |
| `routes/wallet.ts:167` | R | response `{ balance: updated.balance, ... }` |
| `routes/wallet.ts:223-225` | W | `POST /api/admin/wallet-deposits/:txId/approve` — atomic increment by `tx.amount` |
| `routes/wallet.ts:232,236` | R | admin approval notification text + response |
| `routes/superAdminUsers.ts:215` | R | account-detail "billing" tab: `walletBalance: wallet?.balance ?? 0` |
| `routes/superAdminUsers.ts:830-861` (esp. 840, 848, 857-858, 861) | R/W (via `creditWallet`/`deductWallet`/`ensureWallet`) | `POST /superadmin/users/:id/wallet-adjust` — admin manual credit/debit, writes `wallet_adjusted` audit row with `balance`, notifies user with `formatTomanFa(balance)` |

**irforge/src:**
| File:line | Context |
|---|---|
| `pages/marketplace.tsx:32,53` | fetches `/api/wallet`, displays `formatToman(wallet?.balance ?? 0, lang)` |
| `pages/plans.tsx:65,113` | same pattern, `t.walletBalance.replace("{amount}", formatToman(wallet.balance, lang))` |
| `pages/checkout.tsx:85-87,160,364-365` | reads balance, compares `balance < payableTotal` to gate checkout button, displays via `formatToman` |
| `pages/wallet.tsx:259,283,338-339` | main wallet page — fetch, display, "your balance was credited" toast copy |
| `pages/admin-user-detail.tsx:672,706` | admin-facing "current balance" display + copy about debits never going negative |

### 1.2 `wallet_transactions.amount` (`wallet.ts:27`)

**api-server/src:**
| File:line | R/W | Context |
|---|---|---|
| `lib/wallet.ts:71-72` | W | `deductWallet()` inserts a `type` row (default `"spend"`) with `amount: amt` |
| `lib/wallet.ts:99-100` | W | `creditWallet()` inserts a row with `amount: amt`, default `type: "admin_credit"` |
| `routes/wallet.ts:28` | R | `formatTx()` formatter includes `amount: t.amount` |
| `routes/wallet.ts:48-51` | R | `GET /api/wallet/transactions` — own transaction history |
| `routes/wallet.ts:124-126` | W | `POST /api/wallet/deposit` inserts `amount: Math.round(amt)`, status `pending` |
| `routes/wallet.ts:163-166` | W | `POST /api/wallet/spend` inserts an already-`approved` spend row |
| `routes/wallet.ts:179-186` | R | `GET /api/admin/wallet-deposits` — pending queue |
| `routes/wallet.ts:224` | R | reads `tx.amount` to credit `wallets.balance` on approval |
| `routes/wallet.ts:232,259` | R | notification copy via `formatTomanFa(tx.amount)` |
| `lib/adminRevenue.ts:49,75,92-94` | R | `getRevenueEntries()`/`sumRevenue()` — revenue dashboard reads `amount` from `type='spend', status='approved'` rows only |
| `routes/admin.ts:245-266,370` | R (indirect, via `adminRevenue.ts`) | `GET /admin/stats` totals/breakdown/by-month; `GET /admin/revenue-details` per-row `amount: e.amount` |

**irforge/src:**
| File:line | Context |
|---|---|
| `pages/wallet.tsx:471` | own transaction list: `{isSpend?"−":"+"}{formatToman(t.amount, lang)}` |
| `pages/invoices.tsx:55,61,102` | merges `payments.amount` (as `p.amount`) and `wallet_transactions.amount` (as `t.amount`) into one invoice list |
| `components/admin/PaymentApprovals.tsx:85` | pending wallet-deposit queue row: `formatToman(d.amount, lang)` |
| `pages/admin-pending-payments.tsx:233` | same, superadmin pending-approvals page |
| `components/admin/RevenueDrilldown.tsx:116` | admin revenue drill-down table |
| `lib/auditLog.ts:165-174` | renders the `wallet_adjusted` audit-log entry text ("Credited/Debited N Toman") from `m.amount`, sourced from `superAdminUsers.ts:848`'s `metadata: { direction, amount, balance }` |

### 1.3 `wallet_topups.requestedAmount` (`wallet.ts:65`)

| File:line | R/W | Context |
|---|---|---|
| `lib/walletTopupService.ts:40-41,57` | W | `requestTopup()` — validates against `MIN/MAX_TOPUP_AMOUNT`, stores rounded value |
| `routes/walletTopup.ts:49` | R | `formatTopup()` response field |
| `routes/walletTopup.ts:199-201,211` | R | `POST /admin/wallet-topups/:id/manual-confirm` — credits wallet with this exact value (not `finalAmount`), notification text |
| `routes/walletTopup.ts:219` | R | audit metadata |
| `routes/walletTopupSmsWebhook.ts:21` (comment), `:92,102,112` | R | SMS-webhook auto-confirm path — credits wallet with `requestedAmount`, notification + audit metadata |
| `irforge/src/pages/wallet.tsx:46,212` | R | type decl + "Top-up of X confirmed" copy |
| `irforge/src/components/admin/WalletTopupMonitor.tsx:22,119` | R | admin monitoring table |

### 1.4 `wallet_topups.suffix` (`wallet.ts:67`)

| File:line | R/W | Context |
|---|---|---|
| `lib/walletTopupService.ts:35-36,51-52,58` | W | `randomSuffix()` (100-999) generated per attempt, combined into `finalAmount = amt + suffix` |
| `routes/walletTopup.ts:50` | R | `formatTopup()` response field |
| `irforge/src/pages/wallet.tsx:46` | R | type decl only (not separately displayed — only `finalAmount` is shown to the user) |
| `irforge/src/components/admin/WalletTopupMonitor.tsx:23` | R | admin monitoring table type decl/column |

*(Note: this column is a matching nonce, not itself a money amount that needs unit conversion — but it is added to `requestedAmount` to produce `finalAmount`, which does, so it's structurally load-bearing for the migration.)*

### 1.5 `wallet_topups.finalAmount` (`wallet.ts:69`)

| File:line | R/W | Context |
|---|---|---|
| `lib/walletTopupService.ts:52,59,66` | W | computed as `requestedAmount + suffix`; unique (partial index on `pending`) |
| `routes/walletTopup.ts:51` | R | API response |
| `routes/walletTopup.ts:219` | R | audit metadata (manual-confirm path) |
| `routes/walletTopupSmsWebhook.ts:72` | **R (critical)** | `WHERE finalAmount = parsed.amountToman AND status='pending'` — **this is the exact equality match that the lossy `Math.round(amountRial/10)` conversion (walletTopupService.ts:129) can break** for non-round amounts; a mismatch here means the SMS auto-confirm silently fails to match and the topup sits `pending` until it expires |
| `routes/walletTopupSmsWebhook.ts:113` | R | audit metadata |
| `irforge/src/pages/wallet.tsx:46,190-191` | R | **user-facing instruction**: *"دقیقاً همین مبلغ را در بلوبانک وارد کنید (تومان)" / "Type exactly this amount into BluBank (Toman)"* — the raw `finalAmount` integer is shown to the user to type into Blubank's payment field. This string explicitly says "Toman" while (per the migration's own stated background) Blubank's field and the resulting SMS are Rial-denominated. **This UI copy itself is a Phase-2 concern, not just the arithmetic** — flagging for human review since I cannot verify from code alone whether Blubank's input field silently multiplies-by-10 for display or takes the raw digits as Rial. |
| `irforge/src/components/admin/WalletTopupMonitor.tsx:24,120` | R | admin monitoring table |

### 1.6 `sms_logs.parsedAmount` (`wallet.ts:88`)

| File:line | R/W | Context |
|---|---|---|
| `lib/walletTopupService.ts:111,122-130` | (produces the value) | `parseBlubankDepositSms()` returns `{ amountRial, amountToman: Math.round(amountRial / 10) }` — **the known lossy conversion**, line 129 |
| `routes/walletTopupSmsWebhook.ts:84` | W | `parsedAmount: parsed?.amountToman ?? null` |
| `routes/walletTopupSmsWebhook.ts:119` | R | warn-log on no-match |
| `routes/walletTopup.ts:148` | R | `formatSmsLog()` — admin SMS-log listing |
| `irforge/src/components/admin/WalletTopupMonitor.tsx:36,174` | R | admin SMS-log table, `formatToman(l.parsedAmount, lang)` |

### 1.7 `payments.amount` (`payments.ts:17`)

| File:line | R/W | Context |
|---|---|---|
| `routes/bots.ts:634` | W | bot-purchase-by-receipt flow: `amount: typeof amount === "number" ? amount : (amount ? Number(amount) : null)` — **note: this is still a raw client-supplied number at creation time**, used only for display/invoicing (per schema comment `payments.ts:16`: "for display in invoices"); it does not gate the actual bot approval logic |
| `routes/bots.ts:657` | W (sync only) | `syncPaymentUpsert({ ..., amount: 0, ... })` — Sheets mirror always writes `0` here regardless of real amount (pre-existing quirk, not Rial/Toman-related, but worth a human's eye since a real amount is being deliberately zeroed for the sheet mirror) |
| `routes/bots.ts:849` | R | `GET /payments/me` — `amount: p.amount ?? null` |
| `routes/bots.ts:1367-1368` | R | cancellation notification: `formatTomanFa(payment.amount)` |
| `lib/adminRevenue.ts:38-39,60-69` | R | counted as revenue only when `status='approved'` |
| `routes/admin.ts:370` | R | admin revenue-details listing |

**irforge/src:**
| File:line | Context |
|---|---|
| `pages/invoices.tsx:55,102` | invoice list merges `payments` rows (`p.amount`) with wallet spends |

### 1.8 `discount_redemptions.orderAmount` (`discounts.ts:42`) — **dead column; live equivalent is elsewhere**

The Postgres column itself has no consumers (table dropped — see §0). The *live* `orderAmount` concept exists in two parallel, non-persisted-to-Postgres places:

| File:line | R/W | Context |
|---|---|---|
| `lib/discounts.ts:19,33,35,50` | (ephemeral, never persisted) | `computeDiscount()` — pure function; `routes/discounts.ts:93,99-100,122` calls it for `POST /discounts/validate`, which **by schema-comment design (`discounts.ts:9-12`) never writes any row** — it's quote-only |
| `lib/discountStore.ts:55,302,464,494,512` | W (to Google Sheets, not Postgres) | `reserveDiscount()`'s `commit()` appends a redemption row to the Sheets `discount_redemptions` tab via `appendRedemption()`; this is the actual, currently-live persistence of "orderAmount" |
| `routes/bots.ts:921` | (caller) | `reserveDiscount(discountCode, req.userId, price)` — `price` here is the resolved bot-purchase amount from `resolvePurchasePrice()` (pluginPricing.ts), i.e. a Toman figure today |
| `irforge/src/pages/checkout.tsx:120,133-142` | R | checkout applies a discount quote from `POST /discounts/validate`, compares `discountAmount + finalAmount !== total` |

### 1.9 `discount_redemptions.discountAmount` (`discounts.ts:44`) — same dead-column caveat as §1.8

| File:line | R/W | Context |
|---|---|---|
| `lib/discounts.ts:20-21,36,40,42,47-48,50` | compute | percent: `Math.floor((amount*value)/100)`; fixed: `Math.round(value)`; clamped to `[0, amount]` |
| `lib/discountStore.ts:56,302,454,499,513` | W (Sheets) | same `reserveDiscount().commit()` flow as §1.8 |
| `routes/discounts.ts:122,128` | R | `POST /discounts/validate` response |
| `routes/bots.ts:915,930,1060-1061` | R | bot-purchase flow: reduces the wallet debit by this amount, shown in the purchase-success notification |
| `irforge/src/pages/checkout.tsx:40,120,133,141,379` | R | checkout UI — shown as a line-item deduction |

### 1.10 `plans.price` (`plans.ts:8`, `real`/float)

**api-server/src:**
| File:line | R/W | Context |
|---|---|---|
| `routes/plans.ts:25-27` | R | `effectivePrice()` — falls back to flat `price` only when the plan has no `priceUsd` or no exchange rate is available |
| `routes/plans.ts:33` | R | `formatPlan()` — the value actually returned to clients is `effectivePrice()`, not the raw column, whenever `priceUsd` is set |
| `routes/plans.ts:60,95,137,152,237` | R | various `SELECT * FROM plans` call sites (public list, current plan, subscribe, admin list) |
| `routes/plans.ts:150-165` | R | `POST /plans/subscribe` — `currentPrice`/new price both computed via `effectivePrice()`, fed into `decidePlanChange()` to determine `charge` |
| `routes/plans.ts:167-168` | (consumes) | `charge` (derived from `price`) is passed to `deductWallet()` — **this is a direct real-money debit path driven by a `real`/float column** |
| `routes/plans.ts:256-269,287,302-308` | W | admin create/update — `price: hasPrice ? Number(price) : 0` / `update.price = Number(price)` — **no integer coercion (`Math.round`) anywhere in this file**, unlike almost every other money-write path in the codebase (`Math.round` is used for wallet/topup/discount writes) |
| `routes/admin.ts:281,291` | R | plan-distribution breakdown on the admin dashboard |
| `routes/superAdminUsers.ts:746` | R | (plan lookup, need to confirm exact use — plan fetched by id for a user's billing context) |
| `lib/planLimits.ts:35` | R (adjacent) | reads `plansTable` row but only for `maxBots`/`maxPlugins`/etc., not `price` itself |

**irforge/src** (all via `formatToman`, which just rounds for display — see §2/§3 note): `components/admin/AdminOverview.tsx:168`, `components/admin/PlansManager.tsx:36,102` (form state, `Number(form.price) || 0`), `components/landing/LandingPlans.tsx:88`, `pages/buy-bot.tsx:64,69,152,234-235,296`, `pages/pricing.tsx:42,94-99`, `pages/plans.tsx:46-47,137-142`.

**Bug reconfirmed:** `plansTable.price` is declared `real` (`lib/db/src/schema/plans.ts:8`), and **no write path coerces it to an integer** the way every wallet/discount write path does — a plan price of e.g. `499999.99` is representable and would pass straight through `effectivePrice()` into a real wallet debit at `routes/plans.ts:168`. This is a pre-existing float-money bug independent of the Rial/Toman question, and the prompt is correct to flag it — it should become `integer` in the migration regardless of unit.

### 1.11 `marketplace_items.price` (`marketplace.ts:15`, `real`/float)

**api-server/src:**
| File:line | R/W | Context |
|---|---|---|
| `routes/marketplace.ts:31` | R | `formatItem()` — `price: item.price` |
| `routes/marketplace.ts:49,68,84` | R | `GET /marketplace/items`, `/items/:itemId`, `/featured` |
| `lib/marketplaceSync.ts:93,103,121,137` | W | `syncPluginMarketplaceItems()` — `price = pluginPrice(manifest.id)` (from `lib/pluginPricing.ts`'s `PLUGIN_PRICES`, already integer Toman), written via `.update()`/`.insert()` |

**Important finding — likely dead/unused on the frontend:** I searched all of `irforge/src` for any call to `/api/marketplace/items`, `/api/marketplace/items/:id`, or `/api/marketplace/featured` (`grep -rn "marketplace/items\|marketplace/featured"`) and found **zero matches**. Every frontend page that shows a plugin price (`PluginLibrary.tsx`, `buy-bot-detail.tsx`, `plugin-detail.tsx`, `PluginsManager.tsx`, `cart-button.tsx`, `CartContext.tsx`, `use-plugin-pricing.ts`) instead calls `GET /api/marketplace/pricing` (`hooks/use-plugin-pricing.ts:50`), which reads `PLUGIN_PRICES`/`quoteCustomBuild()`/`resolvePurchasePrice()` directly from `lib/pluginPricing.ts` and **never touches the `marketplace_items` table at all**. So:
- The `marketplaceItemsTable.price` column is written (via sync) and has three GET routes that read it, but — as far as I can find — **no current frontend consumer actually renders it**.
- The real, live, charged plugin price always comes from `lib/pluginPricing.ts`'s hardcoded `PLUGIN_PRICES`/`CUSTOM_BUILD`/`BOT_TIER_PRICES` tables (already integer Toman — see §2), not from this DB column.
- **This still needs migrating** (real→integer, Toman→Rial) for correctness/consistency and because `routes/marketplace.ts`'s three GET routes are still live server code that a future frontend (or an external API consumer) could call — but it is lower risk than the other 10 columns since no known money actually changes hands through it today. **Flagging for human confirmation** that this route group is indeed unused before deprioritizing it.

---

## 2. Hardcoded money constants

| Constant | Value(s) | File:line |
|---|---|---|
| `MIN_TOPUP_AMOUNT` | `10_000` | `api-server/src/lib/walletTopupService.ts:24` |
| `MAX_TOPUP_AMOUNT` | `50_000_000` | `api-server/src/lib/walletTopupService.ts:25` |
| `PRESET_TOPUP_AMOUNTS` | `[50_000, 100_000, 200_000, 500_000, 1_000_000]` | `api-server/src/lib/walletTopupService.ts:27` |
| `TOPUP_EXPIRY_MS` | `20 * 60 * 1000` (not money, but gates the above) | `api-server/src/lib/walletTopupService.ts:23` |
| `PLUGIN_PRICES` (18 entries, `150_000` down to `25_000`) | see full table below | `api-server/src/lib/pluginPricing.ts:35-73` |
| `CUSTOM_BUILD.basePrice` | `500_000` | `api-server/src/lib/pluginPricing.ts:96` |
| `CUSTOM_BUILD.pricePerRamGb` | `60_000` | `api-server/src/lib/pluginPricing.ts:100` |
| `CUSTOM_BUILD.pricePerCpuCore` | `50_000` | `api-server/src/lib/pluginPricing.ts:101` |
| `BOT_TIER_PRICES` | `{ standard: 500_000, pro: 1_100_000 }` | `api-server/src/lib/pluginPricing.ts:242-245` |
| `BOT_TIERS[].price` (frontend mirror of `BOT_TIER_PRICES`, drift-tested) | `standard: 500000`, `pro: 1100000` | `irforge/src/lib/bot-tiers.ts:53,73` |
| Test fixture `rialPerUsd` | `900000` | `api-server/test/exchangeRate.test.mjs:20-24` (see §4 — key empirical evidence) |

**`PLUGIN_PRICES` full table** (`api-server/src/lib/pluginPricing.ts:35-73`, all Toman, all plausibly need /10-style rescaling to Rial or an explicit "still Toman, multiply by 10" migration step):
```
catalog: 150_000        subscription: 130_000   booking: 130_000
membership: 120_000     wallet: 120_000         invoice: 110_000
ai_assist: 140_000      ticket: 90_000          affiliate: 90_000
analytics: 85_000       loyalty: 80_000         translate_post: 75_000
autoposter: 65_000      crm: 70_000             drip: 70_000
inventory: 70_000       events: 70_000          group_tools: 55_000
address: 50_000         gamification: 40_000    forms_pro: 40_000
discount: 35_000        referral: 35_000        files: 30_000
waitlist: 30_000        giveaway: 25_000        survey: 25_000
feedback: 25_000
```
This file is explicitly self-documented as "the only source of price" (`pluginPricing.ts:4-5`) and has its own drift-test against `bot-tiers.ts` (mentioned in the file's own comment at line ~239-240; I did not locate/open the actual `pluginPricing.test.mjs` file in this pass — **worth a follow-up grep in Phase 2** to confirm its exact location and assertions).

**Adjacent (not one of the 11 columns, but a hardcoded money-adjacent config surface worth Phase-2 attention):**
- `platformSettings.ts:42,78,116` — `tomanPerUsdt` (admin-editable "Toman per 1 USDT" display hint on the deposit page), env default via `USDT_TOMAN_RATE`. Explicitly Toman-denominated by name and by its own comment (`تومان`), separate from `exchange_rates.rial_per_usd` (see §4). Not itself charged against, purely informational.
- `platformSettings.ts:341-342` — derives a `tomanPerUnit` display rate from `tomanPerUsdt` for the "≈ X USD" convenience label (Phase 39 `currency_display`), consumed by `irforge/src/config/currency.ts:20` (`CurrencyRate.tomanPerUnit`) and `irforge/src/lib/format.ts:30-33` (`convertFromToman`). This is explicitly documented as **display-only, never billed** (`config/currency.ts:8-11`, `format.ts:26-28`).

**Numeric literals I considered and excluded** as not money-related (percentage/rounding math, listed here per your instruction to note ambiguous exclusions rather than silently dropping them):
- `api-server/src/routes/dashboard.ts:42` — `Math.round(((current - prior) / prior) * 1000) / 10` — a percent-change calculation (one-decimal rounding trick), not a currency conversion.
- `irforge/src/pages/dashboard.tsx:45` — `Math.round(change * 10) / 10` — same percent-rounding pattern, frontend mirror.
- `api-server/src/lib/surveyStore.ts:289` — `Math.round((hits * 1000) / given.length) / 10` — survey response percentage, not money.
- `api-server/src/routes/auth.ts:658` — `10 * 60 * 1000` — a token TTL in milliseconds (10 minutes), not money.

---

## 3. `* 10` / `/ 10` occurrences touching money

I grepped both `api-server/src` and `irforge/src` for `* 10`, `/ 10`, `*10`, `/10` (and spacing variants). Excluding the percentage/TTL matches already listed in §2, **there are exactly two money-related occurrences in the entire codebase**, both already known to the requester:

1. **`api-server/src/lib/walletTopupService.ts:129`** — `Math.round(amountRial / 10)` inside `parseBlubankDepositSms()`. This is the lossy Rial→Toman conversion at SMS-ingestion time — the one explicitly named in the prompt background.
2. **`api-server/src/lib/exchangeRate.ts:54`** (and its doc comment at lines 47-48) — `Math.ceil((usdPrice * rialPerUsd / 10) / 10000) * 10000` inside `priceInToman()`. The `/10` here is the same Rial→Toman conversion, applied to a *computed* Rial amount (`usdPrice * rialPerUsd`) rather than a parsed SMS string. This is analyzed in depth in §4 below.

**No other `*10`/`/10` money arithmetic exists anywhere in `api-server/src` or `irforge/src`.** Every other match in the grep results was either a Tailwind opacity class (`bg-primary/10`, `hover:bg-destructive/10`, etc. — dozens of false positives in `irforge/src`, purely CSS), an `aspect-ratio: "16 / 10"` value, or the percentage/TTL cases already excluded in §2. I did not find any additional silent Toman↔Rial conversion hiding under different-looking arithmetic (e.g. `* 0.1`, `>> 1` tricks, or a `RIAL_PER_TOMAN` constant) — a targeted search for `0.1` and for a constant named anything like `RIAL_PER_TOMAN`/`TOMAN_TO_RIAL` also came up empty.

---

## 4. What `exchange_rates.rial_per_usd` actually stores

### 4.1 How it's populated

Read `api-server/src/lib/exchangeRate.ts` in full. Two write paths, both inserting new rows (append-only history, `lib/db/src/schema/exchangeRates.ts:15-19`):

- **Automatic (`source: "api"`)** — `refreshExchangeRateFromApi()` (`exchangeRate.ts:103-122`) calls Nobitex's public, keyless endpoint `https://api.nobitex.ir/market/stats?srcCurrency=usdt&dstCurrency=rls` (line 30) and stores `body.stats["usdt-rls"].latest` verbatim as `rialPerUsd` (line 108-114). The `-rls` market-pair suffix is Nobitex's own Rial market code (as opposed to e.g. a Toman-denominated pair, if Nobitex exposed one) — Nobitex is well known for quoting its own markets in Rial. Called once at boot and hourly via `setInterval` from `index.ts` (comment at lines 18-23); never called mid-request.
- **Manual (`source: "manual"`)** — `setManualExchangeRate(rialPerUsd, updatedBy)` (`exchangeRate.ts:87-95`), invoked from `routes/exchangeRate.ts:32-38` (`POST /api/admin/exchange-rate`), which is driven by the admin UI at `irforge/src/components/admin/ExchangeRateSettings.tsx`.

### 4.2 How it's consumed

`getCurrentExchangeRate()` (`exchangeRate.ts:63-81`) reads the single newest row (`orderBy(desc(fetchedAt)).limit(1)`) and is called from `routes/plans.ts:60,146,237,270,308` to compute `effectivePrice()` (`routes/plans.ts:25-27`) for any plan with `priceUsd` set — i.e., this rate is billing-authoritative for live-USD-priced plans, feeding directly into a real wallet debit (`routes/plans.ts:167-168`).

### 4.3 The formula and its own internal logic

```
priceInToman(usdPrice, rialPerUsd) = Math.ceil((usdPrice * rialPerUsd / 10) / 10000) * 10000
```
(`exchangeRate.ts:53-54`, comment at 47-51: *"`/10` converts Rial to Toman"*)

Read literally: `usdPrice (USD) × rialPerUsd (?/USD) = intermediate`. If `rialPerUsd` is genuinely Rial-per-USD, `intermediate` is in Rial, and `/10` correctly converts it to Toman before the "round up to nearest 10,000 Toman" step. **This is only correct if `rialPerUsd` truly holds a Rial-scaled number.** If it actually held a Toman-scaled number (i.e., someone populated it with "the exchange rate" as Iranians colloquially quote it, in Toman, not Rial), the `/10` would silently produce a result 10× too small — structurally the exact same class of bug as `walletTopupService.ts:129`.

### 4.4 Evidence gathered, and why it points to self-consistency (not a contradiction)

I could not query a live database (see §5 — no DB access in this environment), so I looked for every other piece of evidence in the code and cross-checked them against each other and against real-world plausibility:

1. **Schema comment** (`lib/db/src/schema/exchangeRates.ts:23`): *"Iranian Rial per 1 USD — not Toman (1 Toman = 10 Rial)."* — unambiguous, explicit.
2. **Code comment** (`exchangeRate.ts:47-51`): explicitly says `/10` converts Rial→Toman, i.e. the author believed the pre-division value was Rial.
3. **Admin UI label** (`ExchangeRateSettings.tsx:113`, both languages): *"نرخ دستی (ریال به ازای هر دلار)"* / *"Manual rate (Rial per USD)"* — the human input form explicitly asks for a **Rial**-denominated number, not Toman.
4. **Data-source semantics**: the Nobitex market pair used is `usdt-rls` — `rls` is Nobitex's Rial market code; Nobitex is a well-known Iranian exchange that quotes its markets in Rial (large numbers), not Toman.
5. **Test fixture** (`api-server/test/exchangeRate.test.mjs:18-24`): uses `rialPerUsd = 900000` in its own worked example, with the comment *"2.13 USD * 900,000 rial/usd = 1,917,000 rial = 191,700 Toman."* — i.e. the test author's own mental model treats `900000` as Rial, implying ≈`90,000` Toman/USD.

**Real-world sanity check (my own reasoning, not sourced from a live rate feed — I did not fetch any external API in this read-only audit):** Iran's open-market Toman/USD rate has been on a multi-year depreciation trend — roughly 45,000-50,000 Toman/USD in 2023, 55,000-70,000 in 2024, and continuing to climb through 2025. A rate on the order of `~80,000-150,000 Toman/USD` (i.e. `rialPerUsd` on the order of `800,000-1,500,000`) is a plausible range for 2026. The test fixture's `900,000` (⇒ 90,000 Toman/USD) sits comfortably inside that plausible range **when interpreted as Rial**. The prompt's two example magnitudes — `~120,000` and `~1,200,000` — read the same way: `120,000` interpreted as Rial/USD (⇒ 12,000 Toman/USD) would be a rate last seen years ago and implausible for 2026, whereas `1,200,000` interpreted as Rial/USD (⇒ 120,000 Toman/USD) is squarely plausible for 2026. So *if* a real stored value turns out to be in the low hundred-thousands (e.g. `~120,000`), that would be a strong signal that whoever/whatever populated it actually put in a **Toman**-scale number by mistake (mentally converting "the rate people quote in Toman" without re-scaling to Rial) — reproducing the exact Toman/Rial confusion this whole migration exists to fix. I found no such value in the repository (no seed script, no `.env.example` default, no migration data for `exchange_rates` — I checked `api-server/migrate.mjs` and found no INSERT into `exchange_rates`).

### 4.5 Conclusion

**HIGH CONFIDENCE, from code evidence alone:** the codebase's own formula, schema comment, admin-UI copy, data-source semantics, and test fixture are **all mutually self-consistent** — they all agree that `rial_per_usd` is *intended* to hold, and (via the Nobitex `usdt-rls` market) *should* actually receive, a genuine Rial-denominated number, and that the formula's `/10` is the correct Rial→Toman step. **I did not find an internal contradiction in the code's own logic** — the column name and the `/10` agree with each other, unlike the wallet-topup SMS path where the underlying source (bank SMS) is unambiguously Rial and the destination (stored `parsed_amount`) is unambiguously Toman-after-lossy-division.

**What I could NOT verify (needs human/DB verification before Phase 2 relies on this):**
- Whether the *actual* rows currently in the production `exchange_rates` table are in fact Rial-scaled (i.e., whether Nobitex's live API response and/or any admin manual overrides that were actually typed in practice match this model), since I have no DB access (§5) and did not make any live network call to Nobitex's API as part of this read-only audit.
- Whether any admin, in practice, misread the "Rial per USD" label and typed a Toman-scale number anyway — the form has no validation/sanity bound (`routes/exchangeRate.ts:32-34` only checks `> 0` and finite) that would catch an off-by-10× human entry.
- This conclusion applies specifically to `exchange_rates.rial_per_usd`; it does **not** change the separate, already-confirmed finding that `wallet.ts:88 parsed_amount` (via `walletTopupService.ts:129`) is a genuine, already-identified lossy-conversion bug.

---

## 5. `wallet_topups` rows with `status='pending'`

**No DB access is available in this environment.** I checked explicitly:
- No `DATABASE_URL` (or `BOT_CACHE_DATABASE_URL`/`BUSINESS_DATABASE_URL`) environment variable is set in this session (`env | grep -i database` → empty).
- Only `.env.example` template files exist (`irforge/.env.example`, `api-server/.env.example`) with placeholder credentials (`postgresql://user:password@localhost:5432/irforge`) — no real credentials anywhere in the repo.
- A `psql` client binary is present, but there is no running Postgres process in this environment (`pgrep postgres` → none) and a connection attempt to `127.0.0.1:5432` was refused.
- I have no MCP database tool attached to this session that could reach the production or a dev database.

**This count could not be determined and needs to be pulled separately**, by someone with actual credentials, e.g.:
```sql
SELECT count(*) FROM wallet_topups WHERE status = 'pending';
```
against whichever environment (production Railway Postgres, presumably, per `railway.toml` in the repo root) is authoritative. I did not guess a number.

---

## Appendix: files read in full during this audit

- `lib/db/src/schema/wallet.ts`, `payments.ts`, `discounts.ts`, `plans.ts`, `marketplace.ts`, `exchangeRates.ts`
- `api-server/src/lib/walletTopupService.ts`, `exchangeRate.ts`, `wallet.ts`, `platformSettings.ts` (partial), `adminRevenue.ts`, `pluginPricing.ts`, `discountStore.ts` (partial), `discounts.ts`
- `api-server/src/routes/wallet.ts`, `walletTopup.ts`, `walletTopupSmsWebhook.ts`, `plans.ts`, `marketplace.ts`, `discounts.ts`, `admin.ts` (partial), `superAdminUsers.ts` (partial), `bots.ts` (partial), `exchangeRate.ts`
- `api-server/test/exchangeRate.test.mjs`
- `irforge/src/lib/format.ts`, `bot-tiers.ts`; `irforge/src/config/currency.ts`; `irforge/src/components/admin/ExchangeRateSettings.tsx`; `irforge/src/pages/wallet.tsx` (partial)
- `api-server/migrate.mjs` (grepped for `DROP TABLE`/discount tables only, not read in full)
