/**
 * lib/platformSettings.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * خواندن/نوشتن تنظیمات سطح پلتفرم از جدول `platform_settings`.
 *
 * امروز فقط یک کلید دارد: `payment_methods` — اطلاعاتی که کاربر برای واریز
 * لازم دارد ببیند (آدرس کیف پول تتر، شماره کارت). تا پیش از این، صفحه‌ی کیف
 * پول از کاربر «هش تراکنش» می‌خواست ولی هیچ‌وقت نمی‌گفت پول را **کجا** بفرستد.
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
