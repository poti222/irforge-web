/**
 * lib/platformSettings.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * خواندن/نوشتن تنظیمات سطح پلتفرم از جدول `platform_settings`.
 *
 * دو کلید دارد:
 *   - `payment_methods` — اطلاعاتی که کاربر برای واریز لازم دارد ببیند
 *     (آدرس کیف پول تتر، شماره کارت). تا پیش از این، صفحه‌ی کیف پول از کاربر
 *     «هش تراکنش» می‌خواست ولی هیچ‌وقت نمی‌گفت پول را **کجا** بفرستد.
 *   - `support_links` (فاز ۲۱) — کانال آموزشی/اینستاگرام و لیستِ لینک‌های
 *     آموزشیِ نام‌دار که سوپرادمین مدیریت می‌کند؛ قبلاً در
 *     `irforge/src/config/support.ts` hardcode بودند.
 *
 * هر کلیدِ تازه فقط یعنی یک `type` + سه تابع (`fromEnv*`/`merge*`/`get*`+`set*`)
 * دیگر اینجا، نه یک migration جدید — همان دلیلی که این جدول key/value است.
 *
 * سه لایه‌ی مقدار، به همین ترتیب:
 *   ۱. ردیف دیتابیس (چیزی که سوپرادمین در پنل وارد کرده)
 *   ۲. متغیر محیطی (`USDT_DEPOSIT_ADDRESS`, `CARD_DEPOSIT_NUMBER`, …) — تا
 *      قبل از اولین ورود در پنل هم سایت قابل استفاده باشد
 *   ۳. رشته‌ی خالی — یعنی «تنظیم نشده»، که فرانت به‌جای نمایش یک کادر خالی،
 *      صریح می‌گوید این روش هنوز فعال نیست.
 *
 * ⚠️ این مقادیر به کلاینت فرستاده می‌شوند (باید هم بشوند). هیچ رازی — توکن،
 * کلید خصوصی، seed — اینجا نگذارید.
 */
import { eq } from "drizzle-orm";
import { db, platformSettingsTable } from "@workspace/db";
import { logger } from "./logger";

export const PAYMENT_METHODS_KEY = "payment_methods";

export type PaymentMethodsSettings = {
  usdt: {
    /** آدرس مقصد واریز تتر. */
    address: string;
    /** شبکه — TRC20 / ERC20 / BEP20. فرستادن روی شبکه‌ی اشتباه یعنی پول سوخته. */
    network: string;
    /** memo/tag، فقط برای شبکه‌هایی که لازم دارند. معمولاً خالی. */
    memo: string;
    /** نرخ تبدیل هر دلار تتر به تومان، برای راهنمایی کاربر. صفر یعنی نمایش نده. */
    tomanPerUsdt: number;
    /** توضیح آزاد که زیر آدرس نمایش داده می‌شود. */
    note: string;
    /** اگر false باشد، تب تتر در صفحه‌ی کیف پول غیرفعال می‌شود. */
    enabled: boolean;
  };
  card: {
    /** شماره‌ی کارت مقصد کارت‌به‌کارت. */
    number: string;
    /** نام صاحب کارت — بانک‌ها موقع واریز نشانش می‌دهند و کاربر باید تطبیق دهد. */
    holder: string;
    bank: string;
    note: string;
    enabled: boolean;
  };
};

/** پیش‌فرض‌ها از env — تا سایت قبل از اولین ذخیره در پنل هم کار کند. */
function fromEnv(): PaymentMethodsSettings {
  return {
    usdt: {
      address: process.env.USDT_DEPOSIT_ADDRESS ?? "",
      network: process.env.USDT_DEPOSIT_NETWORK ?? "TRC20",
      memo: process.env.USDT_DEPOSIT_MEMO ?? "",
      tomanPerUsdt: Number(process.env.USDT_TOMAN_RATE ?? 0) || 0,
      note: "",
      enabled: true,
    },
    card: {
      number: process.env.CARD_DEPOSIT_NUMBER ?? "",
      holder: process.env.CARD_DEPOSIT_HOLDER ?? "",
      bank: process.env.CARD_DEPOSIT_BANK ?? "",
      note: "",
      enabled: true,
    },
  };
}

/**
 * مقدار خوانده‌شده را روی پیش‌فرض سوار می‌کند.
 *
 * عمداً کلیدبه‌کلید ادغام می‌شود نه با spread سطح‌بالا: ردیفی که قبل از
 * افزوده‌شدن یک فیلد جدید ذخیره شده نباید باعث شود آن فیلد `undefined` به
 * کلاینت برود.
 */
function merge(stored: unknown): PaymentMethodsSettings {
  const base = fromEnv();
  if (!stored || typeof stored !== "object") return base;
  const raw = stored as Partial<PaymentMethodsSettings>;
  const usdt = (raw.usdt ?? {}) as Partial<PaymentMethodsSettings["usdt"]>;
  const card = (raw.card ?? {}) as Partial<PaymentMethodsSettings["card"]>;
  return {
    usdt: {
      address: typeof usdt.address === "string" ? usdt.address.trim() : base.usdt.address,
      network: typeof usdt.network === "string" && usdt.network.trim() ? usdt.network.trim() : base.usdt.network,
      memo: typeof usdt.memo === "string" ? usdt.memo.trim() : base.usdt.memo,
      tomanPerUsdt: Number.isFinite(Number(usdt.tomanPerUsdt)) ? Number(usdt.tomanPerUsdt) : base.usdt.tomanPerUsdt,
      note: typeof usdt.note === "string" ? usdt.note : base.usdt.note,
      enabled: typeof usdt.enabled === "boolean" ? usdt.enabled : base.usdt.enabled,
    },
    card: {
      number: typeof card.number === "string" ? card.number.trim() : base.card.number,
      holder: typeof card.holder === "string" ? card.holder.trim() : base.card.holder,
      bank: typeof card.bank === "string" ? card.bank.trim() : base.card.bank,
      note: typeof card.note === "string" ? card.note : base.card.note,
      enabled: typeof card.enabled === "boolean" ? card.enabled : base.card.enabled,
    },
  };
}

/**
 * هرگز throw نمی‌کند: اگر جدول هنوز ساخته نشده یا دیتابیس در دسترس نیست،
 * مقدار env برمی‌گردد. صفحه‌ی کیف پول نباید به‌خاطر یک تنظیم، ۵۰۰ بدهد.
 */
export async function getPaymentMethods(): Promise<PaymentMethodsSettings> {
  try {
    const [row] = await db
      .select()
      .from(platformSettingsTable)
      .where(eq(platformSettingsTable.key, PAYMENT_METHODS_KEY))
      .limit(1);
    if (!row) return fromEnv();
    return merge(JSON.parse(row.value));
  } catch (err) {
    logger.warn({ err }, "getPaymentMethods failed — falling back to env defaults");
    return fromEnv();
  }
}

/** ذخیره‌ی کامل تنظیمات پرداخت (upsert روی همان کلید). */
export async function setPaymentMethods(
  input: unknown,
  updatedBy: string,
): Promise<PaymentMethodsSettings> {
  const value = merge(input);
  await db
    .insert(platformSettingsTable)
    .values({ key: PAYMENT_METHODS_KEY, value: JSON.stringify(value), updatedBy })
    .onConflictDoUpdate({
      target: platformSettingsTable.key,
      set: { value: JSON.stringify(value), updatedBy, updatedAt: new Date() },
    });
  return value;
}

// ══════════════════════════════════════════════════════════════════════════
//  لینک‌های آموزشی — IRFORGE_PROMPT_V3 Phase 21
// ══════════════════════════════════════════════════════════════════════════
//
// `irforge/src/config/support.ts` تا امروز این مقادیر را به‌عنوان ثابتِ
// hardcode شده export می‌کرد، با یک کامنت TODO صریح که می‌گفت این‌ها باید از
// یک پنل تنظیماتِ سوپرادمین بیایند. این همان پنل است — دقیقاً همان الگوی
// payment_methods بالا (سه لایه env→دیتابیس→پیش‌فرض، هرگز throw نمی‌کند).
//
// `tutorialLinks` یک آرایه است (نه یک URL ثابت) چون عنوانِ این فاز جمع است:
// سوپرادمین باید بتواند چند لینکِ آموزشیِ نام‌دار (مثلاً «شروع کار»، «اتصال
// درگاه پرداخت») اضافه/حذف کند، نه فقط یک آدرس را عوض کند.
//
// SUPPORT_CONTACTS (آی‌دی ادمین/بات پشتیبانی) عمداً اینجا نیست — آن یک
// نگرانیِ متفاوت است (کانال تماسِ مستقیم، نه محتوای آموزشی) و به فاز دیگری
// واگذار شده.

export const SUPPORT_LINKS_KEY = "support_links";

export type TutorialLink = {
  id: string;
  label: string;
  url: string;
};

export type SupportLinksSettings = {
  educationChannelUrl: string;
  educationChannelHandle: string;
  instagramUrl: string;
  instagramHandle: string;
  tutorialLinks: TutorialLink[];
};

/** همان مقادیرِ hardcode‌شده‌ی قدیمِ `config/support.ts` — پیش‌فرض، نه راز. */
function fromEnvSupportLinks(): SupportLinksSettings {
  const educationChannelUrl = process.env.EDUCATION_CHANNEL_URL ?? "https://t.me/irforge_Education";
  return {
    educationChannelUrl,
    educationChannelHandle: process.env.EDUCATION_CHANNEL_HANDLE ?? "@irforge_Education",
    instagramUrl: process.env.INSTAGRAM_URL ?? "https://instagram.com/ir_forge",
    instagramHandle: process.env.INSTAGRAM_HANDLE ?? "@ir_forge",
    tutorialLinks: [
      { id: "education-channel", label: "ویدیوهای آموزشی", url: educationChannelUrl },
    ],
  };
}

function mergeTutorialLinks(raw: unknown, fallback: TutorialLink[]): TutorialLink[] {
  if (!Array.isArray(raw)) return fallback;
  const out: TutorialLink[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const label = typeof (item as any).label === "string" ? (item as any).label.trim() : "";
    const url = typeof (item as any).url === "string" ? (item as any).url.trim() : "";
    if (!label || !url) continue; // یک ردیفِ نیمه‌پرشده هرگز ذخیره نمی‌شود
    const id = typeof (item as any).id === "string" && (item as any).id ? (item as any).id : `tut_${out.length}_${Date.now()}`;
    out.push({ id, label: label.slice(0, 80), url: url.slice(0, 500) });
  }
  return out;
}

function mergeSupportLinks(stored: unknown): SupportLinksSettings {
  const base = fromEnvSupportLinks();
  if (!stored || typeof stored !== "object") return base;
  const raw = stored as Partial<SupportLinksSettings>;
  return {
    educationChannelUrl: typeof raw.educationChannelUrl === "string" && raw.educationChannelUrl.trim()
      ? raw.educationChannelUrl.trim() : base.educationChannelUrl,
    educationChannelHandle: typeof raw.educationChannelHandle === "string" && raw.educationChannelHandle.trim()
      ? raw.educationChannelHandle.trim() : base.educationChannelHandle,
    instagramUrl: typeof raw.instagramUrl === "string" && raw.instagramUrl.trim()
      ? raw.instagramUrl.trim() : base.instagramUrl,
    instagramHandle: typeof raw.instagramHandle === "string" && raw.instagramHandle.trim()
      ? raw.instagramHandle.trim() : base.instagramHandle,
    tutorialLinks: mergeTutorialLinks(raw.tutorialLinks, base.tutorialLinks),
  };
}

/** هرگز throw نمی‌کند — صفحات عمومی (فوتر، مقاله‌های آموزشی) نباید به‌خاطر
 * این تنظیم ۵۰۰ بدهند. */
export async function getSupportLinks(): Promise<SupportLinksSettings> {
  try {
    const [row] = await db
      .select()
      .from(platformSettingsTable)
      .where(eq(platformSettingsTable.key, SUPPORT_LINKS_KEY))
      .limit(1);
    if (!row) return fromEnvSupportLinks();
    return mergeSupportLinks(JSON.parse(row.value));
  } catch (err) {
    logger.warn({ err }, "getSupportLinks failed — falling back to defaults");
    return fromEnvSupportLinks();
  }
}

export async function setSupportLinks(
  input: unknown,
  updatedBy: string,
): Promise<SupportLinksSettings> {
  const value = mergeSupportLinks(input);
  await db
    .insert(platformSettingsTable)
    .values({ key: SUPPORT_LINKS_KEY, value: JSON.stringify(value), updatedBy })
    .onConflictDoUpdate({
      target: platformSettingsTable.key,
      set: { value: JSON.stringify(value), updatedBy, updatedAt: new Date() },
    });
  return value;
}

// ══════════════════════════════════════════════════════════════════════════
//  نمایشِ چندارزی — IRFORGE_PROMPT_V3 Phase 39
// ══════════════════════════════════════════════════════════════════════════
//
// تومان تنها ارزِ واقعیِ این پلتفرم می‌ماند — هیچ کیف‌پول یا خریدی به ارزِ
// دیگری شارژ/کسر نمی‌شود. این تنظیم فقط می‌گوید «قیمت‌های محصول (پلن‌ها،
// پلاگین‌ها) علاوه بر تومان، تقریبی‌شان به کدام ارزها هم نشان داده شود» —
// یک لایه‌ی نمایشیِ محض، دقیقاً همان‌طور که صفحه‌ی کیف‌پول همین امروز نرخ
// دلاریِ تتر را کنار آدرسِ واریز نشان می‌دهد (`usdt.tomanPerUsdt` بالا).
//
// بدون ردیفِ ذخیره‌شده، پیش‌فرض تهی نیست: اگر همان نرخِ تتر تنظیم شده باشد،
// همان به‌عنوانِ نرخِ دلار پیشنهاد می‌شود — چون تتر روی دلار پگ است و از قبل
// یک عدد واقعی و به‌روز است؛ گفتنِ دوباره‌ی همان عدد در یک تنظیمِ جدا فقط دو
// جا برای هم‌ نبودن می‌ساخت. به‌محضِ اینکه سوپرادمین این تنظیم را صریح ذخیره
// کند (حتی با فهرستِ خالی)، همان مقدارِ ذخیره‌شده حرفِ آخر است.

export const CURRENCY_DISPLAY_KEY = "currency_display";

export type CurrencyRate = {
  /** مثلاً "USD" — فقط حروفِ بزرگِ لاتین، ۲ تا ۵ کاراکتر. */
  code: string;
  /** برچسبِ نمایشی، مثلاً "دلار آمریکا". */
  label: string;
  /** هر ۱ واحدِ این ارز چند تومان است. */
  tomanPerUnit: number;
};

export type CurrencyDisplaySettings = { rates: CurrencyRate[] };

const CODE_RE = /^[A-Z]{2,5}$/;

function mergeCurrencyRates(raw: unknown): CurrencyRate[] {
  if (!Array.isArray(raw)) return [];
  const out: CurrencyRate[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const code = typeof (item as any).code === "string" ? (item as any).code.trim().toUpperCase() : "";
    const label = typeof (item as any).label === "string" ? (item as any).label.trim() : "";
    const tomanPerUnit = Number((item as any).tomanPerUnit);
    // کدِ نامعتبر، برچسبِ خالی، یا نرخِ غیرمثبت — یک ردیفِ نیمه‌پر هرگز ذخیره نمی‌شود.
    if (!CODE_RE.test(code) || !label || !Number.isFinite(tomanPerUnit) || tomanPerUnit <= 0) continue;
    if (seen.has(code)) continue; // یک کد دوبار — اولی می‌ماند
    seen.add(code);
    out.push({ code, label: label.slice(0, 40), tomanPerUnit });
  }
  return out;
}

/** هرگز throw نمی‌کند — صفحاتِ قیمت نباید به‌خاطر این تنظیم ۵۰۰ بدهند. */
export async function getCurrencyDisplay(): Promise<CurrencyDisplaySettings> {
  try {
    const [row] = await db
      .select()
      .from(platformSettingsTable)
      .where(eq(platformSettingsTable.key, CURRENCY_DISPLAY_KEY))
      .limit(1);
    if (row) return { rates: mergeCurrencyRates(JSON.parse(row.value)?.rates) };

    // هیچ‌وقت ذخیره نشده — نرخِ تترِ از قبل تنظیم‌شده را به‌عنوانِ دلار پیشنهاد بده.
    const payment = await getPaymentMethods();
    if (payment.usdt.tomanPerUsdt > 0) {
      return { rates: [{ code: "USD", label: "دلار آمریکا", tomanPerUnit: payment.usdt.tomanPerUsdt }] };
    }
    return { rates: [] };
  } catch (err) {
    logger.warn({ err }, "getCurrencyDisplay failed — falling back to no extra currencies");
    return { rates: [] };
  }
}

export async function setCurrencyDisplay(
  input: unknown,
  updatedBy: string,
): Promise<CurrencyDisplaySettings> {
  const rawRates = input && typeof input === "object" ? (input as any).rates : input;
  const value: CurrencyDisplaySettings = { rates: mergeCurrencyRates(rawRates) };
  await db
    .insert(platformSettingsTable)
    .values({ key: CURRENCY_DISPLAY_KEY, value: JSON.stringify(value), updatedBy })
    .onConflictDoUpdate({
      target: platformSettingsTable.key,
      set: { value: JSON.stringify(value), updatedBy, updatedAt: new Date() },
    });
  return value;
}

// ─── captcha (فاز ۴۲) ────────────────────────────────────────────────────────
//
// ⚠️ برخلاف بقیه‌ی این فایل: اینجا فقط چیزی که واقعاً امن است برای کلاینت
// نگه‌داری می‌شود — `enabled` و `siteKey`ی Cloudflare Turnstile، که خودِ
// Turnstile هم آن‌ها را public طراحی کرده (باید داخل اسکریپت ویجت در مرورگر
// جاسازی شوند). کلید مخفی (`TURNSTILE_SECRET_KEY`) هرگز اینجا نمی‌آید و هرگز
// از پنل ادمین قابل تنظیم/خواندن نیست — طبق هشدار بالای فایل، مثل بقیه‌ی
// رازهای واقعی این پروژه (JWT secret، اعتبارنامه‌ی دیتابیس) فقط env است؛
// نگاه کن lib/captchaVerify.ts.

export const CAPTCHA_KEY = "captcha";

export type CaptchaSettings = {
  enabled: boolean;
  /** Cloudflare Turnstile site key — عمومی به‌طراحی، نه یک راز. */
  siteKey: string;
};

function fromEnvCaptcha(): CaptchaSettings {
  return {
    enabled: process.env.CAPTCHA_ENABLED === "true",
    siteKey: process.env.TURNSTILE_SITE_KEY ?? "",
  };
}

function mergeCaptcha(raw: unknown): CaptchaSettings {
  const fallback = fromEnvCaptcha();
  if (!raw || typeof raw !== "object") return fallback;
  const value = raw as any;
  return {
    enabled: typeof value.enabled === "boolean" ? value.enabled : fallback.enabled,
    siteKey: typeof value.siteKey === "string" ? value.siteKey.trim().slice(0, 200) : fallback.siteKey,
  };
}

/**
 * هیچ‌وقت `enabled: true` بدون یک `siteKey` واقعی برنمی‌گرداند — یک گیت روشن
 * بدون کلید یعنی ویجت هیچ‌وقت رندر نمی‌شود و کاربر واقعی هم گیر می‌کند، دقیقاً
 * همان چیزی که `lib/captchaVerify.ts` با «تنظیم‌نشده یعنی رد نکن» می‌خواهد
 * جلویش را بگیرد.
 */
export async function getCaptchaSettings(): Promise<CaptchaSettings> {
  try {
    const [row] = await db
      .select()
      .from(platformSettingsTable)
      .where(eq(platformSettingsTable.key, CAPTCHA_KEY))
      .limit(1);
    const merged = row ? mergeCaptcha(JSON.parse(row.value)) : fromEnvCaptcha();
    return merged.enabled && merged.siteKey ? merged : { enabled: false, siteKey: merged.siteKey };
  } catch (err) {
    logger.warn({ err }, "getCaptchaSettings failed — falling back to disabled");
    return { enabled: false, siteKey: "" };
  }
}

export async function setCaptchaSettings(
  input: unknown,
  updatedBy: string,
): Promise<CaptchaSettings> {
  const value = mergeCaptcha(input);
  await db
    .insert(platformSettingsTable)
    .values({ key: CAPTCHA_KEY, value: JSON.stringify(value), updatedBy })
    .onConflictDoUpdate({
      target: platformSettingsTable.key,
      set: { value: JSON.stringify(value), updatedBy, updatedAt: new Date() },
    });
  return value;
}
