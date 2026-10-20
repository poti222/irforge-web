/**
 * schema/emojiPacks.ts — کتابخانه‌ی پک‌های ایموجیِ سفارشیِ پلتفرم (برایِ همه‌ی کاربران).
 * هر ردیف یک پکِ تلگرامیِ `custom_emoji` است که پلتفرم ساخته. `price_toman = 0` یعنی رایگان.
 * `stickers`: [{ name, emoji, id|null, animated }] — `id` همان custom_emoji_id است و بعد از «ساخت در تلگرام» پر می‌شود.
 * مایگریشنِ زمان‌اجرا: api-server/migrate.mjs (آینه: migrations/0060_emoji_packs.sql).
 */
import { pgTable, text, timestamp, boolean, integer, jsonb } from "drizzle-orm/pg-core";

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
