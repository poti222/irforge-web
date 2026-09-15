/**
 * routes/uploadSessions.ts — API جلسه‌های «با بات بفرست».
 *
 * سه روت: یکی جلسه می‌سازد و لینک عمیق می‌دهد، یکی وضعیتش را می‌گوید، یکی
 * (`materialize`) بعد از `filled` شدن، هر آیتم را برایِ همان بات واقعاً
 * قابلِ‌استفاده می‌کند. ضبطِ واقعی در وبهوک بات پلتفرم اتفاق می‌افتد
 * (`routes/telegramWebhook.ts`).
 */
import { Router } from "express";
import { requireAuth } from "./auth.js";
import { logger } from "../lib/logger.js";
import {
  createSession,
  getSession,
  deepLinkFor,
  convertItemForBot,
  SINGLE_ITEM_KINDS,
  type UploadSessionKind,
  type ConvertedItem,
} from "../lib/uploadSessions.js";
import type { UploadedItem } from "@workspace/db";

const router = Router();

const KINDS: UploadSessionKind[] = ["broadcast", "panel_media", "command_media", "drip_media", "pool_item"];

/** شکل امنِ پاسخ — `userId` و `fileId`ِ خامِ هر آیتم (که هنوز مالِ بات
 * پلتفرم است، نه چیزی که کلاینت مستقیم به کارش بیاید — نگاه کن
 * `materialize`) به کلاینت نمی‌رود. `content` (متن یا کپشن) بی‌خطر است و
 * برمی‌گردد تا فرمی مثلِ ترکیب‌کننده‌ی پیامِ همگانی بتواند پیش‌نمایشش بدهد. */
function present(session: Awaited<ReturnType<typeof getSession>>) {
  if (!session) return null;
  return {
    id: session.id,
    kind: session.kind,
    status: session.status,
    items: (session.items as UploadedItem[]).map((i) => ({ type: i.type, content: i.content })),
    multi: !SINGLE_ITEM_KINDS.has(session.kind as UploadSessionKind),
    expiresAt: session.expiresAt.toISOString(),
  };
}

// POST /api/upload-sessions — جلسه‌ی تازه + لینک عمیق.
router.post("/upload-sessions", requireAuth, async (req: any, res) => {
  try {
    const kind = String(req.body?.kind ?? "");
    if (!KINDS.includes(kind as UploadSessionKind)) {
      res.status(400).json({ error: "Unsupported session kind" });
      return;
    }

    const link = deepLinkFor("probe");
    if (!link) {
      // بدون یوزرنیم بات، لینک عمیق ساخته نمی‌شود. ۵۰۰ دادن اینجا گمراه‌کننده
      // است — این یک پیکربندی نداشته است، نه خرابی.
      res.status(503).json({
        error:
          "یوزرنیم بات پلتفرم روی سرور تنظیم نشده (TELEGRAM_BOT_USERNAME)، پس «ارسال با بات» در دسترس نیست.",
        code: "no_bot_username",
      });
      return;
    }

    const session = await createSession({
      userId: req.userId,
      botId: req.body?.botId ? String(req.body.botId) : null,
      kind: kind as UploadSessionKind,
    });

    res.status(201).json({ ...present(session), deepLink: deepLinkFor(session.id) });
  } catch (err) {
    logger.error({ err }, "Create upload session error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/upload-sessions/:id — وضعیت (کلاینت هر چند ثانیه می‌پرسد).
router.get("/upload-sessions/:id", requireAuth, async (req: any, res) => {
  try {
    const session = await getSession(req.params.id, req.userId);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    res.json({ ...present(session), deepLink: deepLinkFor(session.id) });
  } catch (err) {
    logger.error({ err }, "Get upload session error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/upload-sessions/:id/materialize — تبدیلِ هر آیتم به چیزی
// واقعاً قابلِ‌فرستادن با بات (متن دست‌نخورده می‌ماند؛ مدیا با توکنِ همین
// بات دوباره آپلود می‌شود — نگاه کن lib/uploadSessions.ts::convertItemForBot).
// فقط یک‌بار معنا دارد (بعد از filled شدن)؛ کلاینت این را همان لحظه‌ای که
// وضعیت را filled می‌بیند صدا می‌زند.
router.post("/upload-sessions/:id/materialize", requireAuth, async (req: any, res) => {
  try {
    const session = await getSession(req.params.id, req.userId);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    if (session.status !== "filled") {
      res.status(409).json({ error: "این جلسه هنوز تکمیل نشده است.", code: "not_filled" });
      return;
    }
    if (!session.botId) {
      res.status(400).json({ error: "این جلسه به هیچ باتی وصل نیست.", code: "no_bot" });
      return;
    }

    const results = await Promise.all(
      (session.items as UploadedItem[]).map((item) => convertItemForBot(item, session.botId!, req.userId)),
    );
    const items = results.filter((r: ConvertedItem | null): r is ConvertedItem => r !== null);
    const failed = results.length - items.length;

    res.json({ items, failed });
  } catch (err) {
    logger.error({ err }, "Materialize upload session error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
