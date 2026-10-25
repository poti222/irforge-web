/**
 * lib/emojiPackPurchase.ts — خریدِ پکِ ایموجیِ پولی از کیف‌پول.
 * ─────────────────────────────────────────────────────────────────────────────
 * «خرید» = یک ردیف در `emoji_pack_purchases` (کلیدِ bot_id+pack_slug) + کسرِ اتمیِ کیف‌پول، هر دو در **یک**
 * `db.transaction`: یا هر دو انجام می‌شوند یا هیچ‌کدام (موجودی کافی نبود ⇒ ردیفِ خرید هم rollback می‌شود).
 * دو کلیکِ هم‌زمان هم دوبار پول نمی‌گیرند: insert با ON CONFLICT DO NOTHING است و درخواستِ دوم تا commitِ اولی منتظر
 * می‌ماند، بعد ردیفی برنمی‌گرداند و بدونِ کسر رد می‌شود.
 * خریدِ ثبت‌شده یعنی حقِ افزودن؛ اگر افزودنِ بعدیِ ایموجی‌ها به بات خطا بخورد، کاربر دوباره «افزودن» را می‌زند و
 * پولِ دوباره کم نمی‌شود.
 */
import { db, emojiPackPurchasesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { deductWallet, InsufficientBalanceError } from "./wallet.js";
import { tomanToRial } from "./currency.js";
import { BotConfigError } from "./botConfig.js";
import { canAddWithoutPaying } from "./emojiPackPricing.js";

export async function ownedPackSlugs(botId: string): Promise<Set<string>> {
  const rows = await db
    .select({ slug: emojiPackPurchasesTable.packSlug })
    .from(emojiPackPurchasesTable)
    .where(eq(emojiPackPurchasesTable.botId, botId));
  return new Set(rows.map((r: { slug: string }) => r.slug));
}

/** مبلغِ کم‌شده (تومان) را برمی‌گرداند؛ ۰ یعنی چیزی کسر نشد. موجودیِ ناکافی ⇒ BotConfigError 402. */
export async function chargeForPack(i: {
  userId: string;
  botId: string;
  packSlug: string;
  priceToman: number;
  isSuperAdmin: boolean;
}): Promise<number> {
  if (i.priceToman <= 0 || i.isSuperAdmin) return 0;
  const owned = (await ownedPackSlugs(i.botId)).has(i.packSlug);
  if (canAddWithoutPaying({ priceToman: i.priceToman, owned, isSuperAdmin: false })) return 0;

  try {
    return await db.transaction(async (tx: any) => {
      const inserted = await tx
        .insert(emojiPackPurchasesTable)
        .values({ botId: i.botId, packSlug: i.packSlug, userId: i.userId, priceToman: i.priceToman })
        .onConflictDoNothing()
        .returning();
      if (inserted.length === 0) return 0; // هم‌زمان خریده شد — دوباره کسر نمی‌کنیم
      const ok = await deductWallet(i.userId, tomanToRial(i.priceToman), `Emoji pack: ${i.packSlug}`, tx);
      if (!ok) throw new InsufficientBalanceError();
      return i.priceToman;
    });
  } catch (err) {
    if (err instanceof InsufficientBalanceError) {
      throw new BotConfigError(
        402,
        `موجودیِ کیف پول برایِ خریدِ این پک (${i.priceToman.toLocaleString("en-US")} تومان) کافی نیست؛ ابتدا کیف پول را شارژ کنید.`,
        "insufficient_balance",
      );
    }
    throw err;
  }
}
