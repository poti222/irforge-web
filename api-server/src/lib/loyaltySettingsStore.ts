/**
 * lib/loyaltySettingsStore.ts — تنظیمات اقتصادِ باشگاه مشتریان (فاز ۲۴).
 * ─────────────────────────────────────────────────────────────────────────────
 * تا امروز این چهار عدد فقط از داخل بات، با دکمه‌های اینلاین
 * (`plugins/loyalty/handlers.py::cb_settings`/`cb_setting_edit`) قابل تنظیم
 * بودند. سکشنِ باشگاه مشتریان روی سایت فقط `loyalty-tiers`/`loyalty-accounts`
 * را نشان می‌داد (`pluginCollections.ts`) — اپراتوری که همه‌چیز را از سایت
 * انجام می‌دهد، هیچ‌جا نمی‌دید «هر چند تومان یک امتیاز» را کجا عوض کند.
 *
 * ذخیره: یک ردیفِ تکی روی تب `loyalty_settings`، کلید `"config"` — دقیقاً
 * همان شکلِ `plugins/loyalty/domain.py`'s `RecordStore("loyalty_settings")`ی
 * بات: `{ id: "config", value: {...چهار عدد...}, updated_at }`.
 */
import { getEntity, putEntity } from "./botConfig.js";

export const SETTINGS_TAB = "loyalty_settings";
export const SETTINGS_KEY = "config";

export type LoyaltySettings = {
  currencyPerPoint: number;
  signupBonus: number;
  redeemValue: number;
  redeemMinPoints: number;
};

/** آینه‌ی `plugins/loyalty/domain.py::DEFAULT_SETTINGS`. */
export const DEFAULT_LOYALTY_SETTINGS: LoyaltySettings = {
  currencyPerPoint: 10000,
  signupBonus: 0,
  redeemValue: 500,
  redeemMinPoints: 100,
};

type StoredRow = { id?: string; value?: Record<string, unknown>; updated_at?: string };

// آینه‌ی نام فیلدهای پایتون (snake_case روی خودِ شیت) — کلیدهای TS خودمان
// camelCase‌اند تا با بقیه‌ی روت‌های سایت هماهنگ بمانند.
const FIELD_MAP: Record<keyof LoyaltySettings, string> = {
  currencyPerPoint: "currency_per_point",
  signupBonus: "signup_bonus",
  redeemValue: "redeem_value",
  redeemMinPoints: "redeem_min_points",
};

function toNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** خواندن از ردیفِ ذخیره‌شده روی شیت — کلیدها snake_case‌اند (شکلِ بات). */
function mergeFromStoredRow(stored: unknown): LoyaltySettings {
  const raw = (stored && typeof stored === "object" ? stored : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_LOYALTY_SETTINGS };
  for (const key of Object.keys(FIELD_MAP) as (keyof LoyaltySettings)[]) {
    const snakeKey = FIELD_MAP[key];
    if (snakeKey in raw) out[key] = toNumber(raw[snakeKey], DEFAULT_LOYALTY_SETTINGS[key]);
  }
  return out;
}

/** خواندن از بدنه‌ی درخواستِ سایت — کلیدها camelCase‌اند (قراردادِ API). */
function mergeFromInput(input: unknown): LoyaltySettings {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_LOYALTY_SETTINGS };
  for (const key of Object.keys(FIELD_MAP) as (keyof LoyaltySettings)[]) {
    if (key in raw) out[key] = toNumber(raw[key], DEFAULT_LOYALTY_SETTINGS[key]);
  }
  return out;
}

/** هرگز throw نمی‌کند — تب lazy ساخته می‌شود، نبودنش یعنی «هنوز تنظیم نشده». */
export async function getLoyaltySettings(spreadsheetId: string): Promise<LoyaltySettings> {
  try {
    const row = await getEntity<StoredRow>(spreadsheetId, SETTINGS_TAB, SETTINGS_KEY);
    if (!row) return { ...DEFAULT_LOYALTY_SETTINGS };
    return mergeFromStoredRow(row.value);
  } catch {
    return { ...DEFAULT_LOYALTY_SETTINGS };
  }
}

export async function setLoyaltySettings(
  spreadsheetId: string,
  input: unknown,
): Promise<LoyaltySettings> {
  const merged = mergeFromInput(input);
  const value: Record<string, unknown> = {};
  for (const key of Object.keys(FIELD_MAP) as (keyof LoyaltySettings)[]) {
    value[FIELD_MAP[key]] = merged[key];
  }
  await putEntity(spreadsheetId, SETTINGS_TAB, SETTINGS_KEY, {
    id: SETTINGS_KEY,
    value,
    updated_at: new Date().toISOString(),
  });
  return merged;
}
