/**
 * routes/emojiPacks.ts — کتابخانه‌ی پک‌های ایموجیِ سفارشی (همه‌ی کاربران) + مدیریتِ آن در /super.
 *
 *   GET   /emoji-packs                         (کاربر لاگین) پک‌هایِ فعالِ ساخته‌شده + قیمت
 *   GET   /super/emoji-packs                   (سوپرادمین) همه‌ی پک‌ها + وضعیتِ ساخت
 *   POST  /super/emoji-packs/:slug/create      ساخت/همگام‌سازی در تلگرام   { ownerTelegramId? }
 *   POST  /super/emoji-packs/create-all        همین برایِ همه‌ی پک‌هایِ ساخته‌نشده
 *   PATCH /super/emoji-packs/:slug             { priceToman?, active?, titleFa? }
 *
 * اضافه‌کردنِ پک به یک بات: POST /bots/:botId/custom-emojis/add-library-pack (routes/botCustomEmoji.ts).
 */
import { Router } from "express";
import { db, emojiPacksTable, usersTable } from "@workspace/db";
import { asc, eq } from "drizzle-orm";
import { requireAuth, requireSuperAdmin } from "./auth";
import { requireSuperGate } from "../middleware/superGate";
import { createPackInTelegram, ensureSeeded, EmojiPackError } from "../lib/emojiPacks.js";
import { writeAudit } from "../lib/audit.js";
import { logger } from "../lib/logger";

const router = Router();
const guard = [requireSuperAdmin, requireSuperGate] as const;

function fail(res: any, err: unknown, fallback: string) {
  if (err instanceof EmojiPackError) return res.status(err.status).json({ error: err.message });
  logger.error({ err }, fallback);
  return res.status(500).json({ error: fallback });
}

router.get("/emoji-packs", requireAuth, async (_req, res) => {
  try {
    await ensureSeeded();
    const rows = await db.select().from(emojiPacksTable).orderBy(asc(emojiPacksTable.sortOrder));
    res.json({
      packs: rows
        .filter((r) => r.active && r.tgSetName && r.stickers.length > 0 && r.stickers.every((s) => !!s.id))
        .map((r) => ({
          slug: r.slug,
          title: r.titleFa,
          count: r.stickers.length,
          priceToman: r.priceToman,
          free: r.priceToman === 0,
          animated: r.stickers.some((s) => s.animated),
          preview: r.stickers.slice(0, 8).map((s) => ({ name: s.name, emoji: s.emoji, id: s.id })),
        })),
    });
  } catch (err) {
    fail(res, err, "Failed to list emoji packs");
  }
});

router.get("/super/emoji-packs", ...guard, async (_req, res) => {
  try {
    await ensureSeeded();
    const rows = await db.select().from(emojiPacksTable).orderBy(asc(emojiPacksTable.sortOrder));
    res.json({
      packs: rows.map((r) => ({
        slug: r.slug,
        titleFa: r.titleFa,
        titleEn: r.titleEn,
        count: r.stickers.length,
        priceToman: r.priceToman,
        active: r.active,
        tgSetName: r.tgSetName,
        created: !!r.tgSetName && r.stickers.every((s) => !!s.id),
        animated: r.stickers.some((s) => s.animated),
        stickers: r.stickers.map((s) => ({ name: s.name, emoji: s.emoji })),
      })),
    });
  } catch (err) {
    fail(res, err, "Failed to list emoji packs");
  }
});

async function ownerFor(req: any): Promise<string> {
  const given = typeof req.body?.ownerTelegramId === "string" ? req.body.ownerTelegramId.trim() : "";
  if (given) return given;
  const [u] = await db.select({ telegramId: usersTable.telegramId }).from(usersTable).where(eq(usersTable.id, req.userId)).limit(1);
  if (!u?.telegramId) throw new EmojiPackError(400, "تلگرامِ حسابِ خودت به سایت وصل نیست؛ یا ownerTelegramId را بده یا از پروفایل تلگرام را وصل کن");
  return u.telegramId;
}

router.post("/super/emoji-packs/create-all", ...guard, async (req: any, res) => {
  try {
    await ensureSeeded();
    const owner = await ownerFor(req);
    const rows = await db.select().from(emojiPacksTable).orderBy(asc(emojiPacksTable.sortOrder));
    const report: Array<{ slug: string; ok: boolean; message: string }> = [];
    for (const r of rows) {
      if (r.tgSetName && r.stickers.every((s) => !!s.id)) {
        report.push({ slug: r.slug, ok: true, message: "از قبل ساخته شده" });
        continue;
      }
      try {
        const out = await createPackInTelegram(r.slug, owner);
        report.push({ slug: r.slug, ok: true, message: `${out.created ? "ساخته شد" : "همگام شد"} (${out.count} ایموجی)` });
      } catch (err) {
        report.push({ slug: r.slug, ok: false, message: err instanceof Error ? err.message : "خطا" });
      }
    }
    await writeAudit({ actorUserId: req.userId, action: "emoji_pack_admin", metadata: { op: "create-all", report } });
    res.json({ report });
  } catch (err) {
    fail(res, err, "Failed to create emoji packs");
  }
});

router.post("/super/emoji-packs/:slug/create", ...guard, async (req: any, res) => {
  try {
    await ensureSeeded();
    const out = await createPackInTelegram(String(req.params.slug), await ownerFor(req));
    await writeAudit({ actorUserId: req.userId, action: "emoji_pack_admin", metadata: { op: "create", slug: req.params.slug, ...out } });
    res.json(out);
  } catch (err) {
    fail(res, err, "Failed to create emoji pack");
  }
});

router.patch("/super/emoji-packs/:slug", ...guard, async (req: any, res) => {
  try {
    const patch: Partial<typeof emojiPacksTable.$inferInsert> = { updatedAt: new Date() };
    if (req.body?.priceToman !== undefined) {
      const p = Number(req.body.priceToman);
      if (!Number.isInteger(p) || p < 0 || p > 100_000_000) {
        res.status(400).json({ error: "قیمت باید عددِ صحیحِ ۰ یا بیشتر باشد" });
        return;
      }
      patch.priceToman = p;
    }
    if (req.body?.active !== undefined) patch.active = req.body.active === true;
    if (typeof req.body?.titleFa === "string" && req.body.titleFa.trim()) patch.titleFa = req.body.titleFa.trim().slice(0, 80);
    const [row] = await db.update(emojiPacksTable).set(patch).where(eq(emojiPacksTable.slug, String(req.params.slug))).returning();
    if (!row) {
      res.status(404).json({ error: "پک پیدا نشد" });
      return;
    }
    await writeAudit({ actorUserId: req.userId, action: "emoji_pack_admin", metadata: { op: "update", slug: row.slug, priceToman: row.priceToman, active: row.active } });
    res.json({ ok: true });
  } catch (err) {
    fail(res, err, "Failed to update emoji pack");
  }
});

export default router;
