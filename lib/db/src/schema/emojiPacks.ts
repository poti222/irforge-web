/**
 * schema/emojiPacks.ts — کتابخانه‌ی پک‌های ایموجیِ سفارشیِ پلتفرم (برایِ همه‌ی کاربران).
 * هر ردیف یک پکِ تلگرامیِ `custom_emoji` است که پلتفرم ساخته. `price_toman = 0` یعنی رایگان.
 * `stickers`: [{ name, emoji, id|null, animated }] — `id` همان custom_emoji_id است و بعد از «ساخت در تلگرام» پر می‌شود.
 * مایگریشنِ زمان‌اجرا: api-server/migrate.mjs (آینه: migrations/0060_emoji_packs.sql).
 */
import { pgTable, text, timestamp, boolean, integer, jsonb, primaryKey } from "drizzle-orm/pg-core";

export interface EmojiPackSticker {
  name: string;
  emoji: string;
  id: string | null;
  animated: boolean;
}

export const emojiPacksTable = pgTable("emoji_packs", {
  slug: text("slug").primaryKey(),
  titleFa: text("title_fa").notNull(),
  titleEn: text("title_en").notNull().default(""),
  /** نامِ پک در تلگرام (`…_by_<botusername>`)؛ تا قبل از «ساخت در تلگرام» null. */
  tgSetName: text("tg_set_name"),
  priceToman: integer("price_toman").notNull().default(0),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  stickers: jsonb("stickers").$type<EmojiPackSticker[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * خریدِ پکِ پولی برای یک بات. کلید (bot_id, pack_slug): یک بات هر پک را فقط یک‌بار می‌خرد؛ بعد از آن افزودنِ دوباره
 * (مثلاً بعد از حذفِ ایموجی‌ها) رایگان است. `price_toman` همان قیمتی‌ست که لحظه‌یِ خرید پرداخت شد (نه قیمتِ فعلی).
 * مایگریشنِ زمان‌اجرا: api-server/migrate.mjs (آینه: migrations/0063_emoji_pack_purchases.sql).
 */
export const emojiPackPurchasesTable = pgTable(
  "emoji_pack_purchases",
  {
    botId: text("bot_id").notNull(),
    packSlug: text("pack_slug").notNull(),
    userId: text("user_id").notNull(),
    priceToman: integer("price_toman").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.botId, t.packSlug] })],
);
