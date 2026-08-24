/**
 * lib/botSubscriptions.ts — IRFORGE_PROMPT_V3 Phase 22
 * ─────────────────────────────────────────────────────────────────────────────
 * A read-only mirror of the bot's own `utils/subscriptions.py` (its "PHASE 31"
 * platform plan/feature-gating module) — just enough to let the website reflect
 * the SAME entitlement the bot itself enforces, e.g. so `LanguageSection.tsx`
 * can show a locked/upsell state instead of letting an operator pick a
 * language the bot will then refuse.
 *
 * This does NOT replace the bot-side gate. `handlers/language.py`'s
 * `cb_set_language` re-checks `plan_has_feature` itself before ever writing a
 * user's language — a website bug or a stale cache here can, at worst, show
 * the wrong lock icon, never actually grant an unpaid feature. Both `PUT`
 * routes here that touch a gated value ALSO re-check via this module before
 * writing, for the same "don't trust the client" reason `cb_set_language`
 * re-checks a tap on its own keyboard.
 *
 * Storage: identical tabs/keys the bot writes via `plugin_db(...)` (Sheets-
 * backed today, Postgres-ready — see migrations/sql/0025_subscriptions.sql),
 * read here with the exact same `botConfig.ts` primitives every other
 * bot-config route already uses for `text_keys`/`text_values`/`bot_settings`.
 */
import { getEntity } from "./botConfig.js";

const SUBSCRIPTION_PLANS_TAB = "subscription_plans";
const PLAN_FEATURES_TAB = "plan_features";
const TENANT_SUBSCRIPTIONS_TAB = "tenant_subscriptions";

const GRACE_DAYS = 3;
const FREE_PLAN = "bronze";

// Mirrors utils/subscriptions.py's DEFAULT_PLANS — the fallback used when a
// tenant's plan_features rows haven't been seeded yet (the bot seeds lazily,
// on first read, same as here).
const DEFAULT_PLAN_FEATURES: Record<string, string[]> = {
  bronze: ["panel_builder"],
  silver: ["panel_builder", "custom_theme", "referral_system", "multi_language"],
  gold: [
    "panel_builder", "custom_theme", "referral_system", "workflow_engine",
    "relation_engine", "loyalty_tiers", "multi_language",
  ],
  diamond: ["*"],
};

type TenantSubscriptionRow = {
  tenant_id: string;
  plan_id: string;
  status: string;
  current_period_end?: string;
};

type PlanFeatureRow = {
  plan_id: string;
  feature_key: string;
  enabled: boolean;
};

function inGrace(sub: TenantSubscriptionRow): boolean {
  if (sub.status !== "past_due" && sub.status !== "canceled") return false;
  if (!sub.current_period_end) return false;
  const end = new Date(sub.current_period_end).getTime();
  if (Number.isNaN(end)) return false;
  return Date.now() <= end + GRACE_DAYS * 24 * 60 * 60 * 1000;
}

/** Mirrors `utils/subscriptions.py::effective_plan_id()`. */
export async function effectivePlanId(spreadsheetId: string): Promise<string> {
  let sub: TenantSubscriptionRow | null = null;
  try {
    sub = await getEntity<TenantSubscriptionRow>(spreadsheetId, TENANT_SUBSCRIPTIONS_TAB, spreadsheetId);
  } catch {
    // Tab not created yet (lazy, like every plugin_db sheet) — free plan.
    sub = null;
  }
  if (!sub) return FREE_PLAN;
  if (sub.status === "active" || inGrace(sub)) return sub.plan_id || FREE_PLAN;
  return FREE_PLAN;
}

/** Mirrors `utils/subscriptions.py::plan_has_feature()`. */
export async function planHasFeature(spreadsheetId: string, featureKey: string, planId?: string): Promise<boolean> {
  const pid = planId || (await effectivePlanId(spreadsheetId));
  try {
    const wildcard = await getEntity<PlanFeatureRow>(spreadsheetId, PLAN_FEATURES_TAB, `${pid}:*`);
    if (wildcard) return true;
    const row = await getEntity<PlanFeatureRow>(spreadsheetId, PLAN_FEATURES_TAB, `${pid}:${featureKey}`);
    if (row) return Boolean(row.enabled);
  } catch {
    // plan_features tab not created yet — fall through to the code default.
  }
  const defaults = DEFAULT_PLAN_FEATURES[pid];
  if (!defaults) return false;
  return defaults.includes("*") || defaults.includes(featureKey);
}

// `subscription_plans` isn't read anywhere yet (nothing here needs a plan's
// display name/price), but the tab constant is exported so a future caller
// doesn't have to re-derive the bot's exact tab name.
export { SUBSCRIPTION_PLANS_TAB };

// ─── IRFORGE_PROMPT_V3 Phase 32 — dashboard plan card ────────────────────────
// The overview section's cards (BotIdentityCard, BotHealthCard, ...) had
// nothing showing an operator their own plan, price, or renewal date --
// display-only, since actually changing plans is a separate flow. Mirrors
// `utils/subscriptions.py::DEFAULT_PLANS`'s name/price fields (that module's
// FEATURE lists are already mirrored above as DEFAULT_PLAN_FEATURES).

type PlanRow = { plan_id: string; name?: string; price_monthly?: number };

const DEFAULT_PLAN_META: Record<string, { name: string; priceMonthly: number }> = {
  bronze: { name: "برنزی", priceMonthly: 0 },
  silver: { name: "نقره‌ای", priceMonthly: 99 },
  gold: { name: "طلایی", priceMonthly: 199 },
  diamond: { name: "الماسی", priceMonthly: 399 },
};

export type SubscriptionSummary = {
  planId: string;
  planName: string;
  priceMonthly: number;
  status: string;
  currentPeriodEnd: string | null;
  inGrace: boolean;
  /** null when the plan has no expiry to count down to (e.g. the free plan,
   * or a paid plan whose period end was never set). */
  daysRemaining: number | null;
};

/** Read-only summary for the dashboard plan card -- distinct from
 * `effectivePlanId`/`planHasFeature` above, which answer "is X unlocked
 * right now" for a gate, not "what should the operator see". */
export async function getSubscriptionSummary(spreadsheetId: string): Promise<SubscriptionSummary> {
  let sub: TenantSubscriptionRow | null = null;
  try {
    sub = await getEntity<TenantSubscriptionRow>(spreadsheetId, TENANT_SUBSCRIPTIONS_TAB, spreadsheetId);
  } catch {
    sub = null;
  }

  const planId = sub?.plan_id || FREE_PLAN;
  const status = sub?.status || "active";
  const currentPeriodEnd = sub?.current_period_end || null;
  const grace = sub ? inGrace(sub) : false;

  let planMeta = DEFAULT_PLAN_META[planId] ?? { name: planId, priceMonthly: 0 };
  try {
    const row = await getEntity<PlanRow>(spreadsheetId, SUBSCRIPTION_PLANS_TAB, planId);
    if (row) {
      planMeta = {
        name: row.name || planMeta.name,
        priceMonthly: typeof row.price_monthly === "number" ? row.price_monthly : planMeta.priceMonthly,
      };
    }
  } catch {
    // subscription_plans tab not seeded yet (lazy, like every plugin_db
    // sheet) -- the code defaults above stand in until the bot's own
    // `_ensure_seeded()` runs on its next read.
  }

  let daysRemaining: number | null = null;
  if (currentPeriodEnd) {
    const end = new Date(currentPeriodEnd).getTime();
    if (!Number.isNaN(end)) daysRemaining = Math.ceil((end - Date.now()) / (24 * 60 * 60 * 1000));
  }

  return {
    planId,
    planName: planMeta.name,
    priceMonthly: planMeta.priceMonthly,
    status,
    currentPeriodEnd,
    inGrace: grace,
    daysRemaining,
  };
}
