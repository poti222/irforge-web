/**
 * routes/uploadSessions.ts — API جلسه‌های «با بات بفرست».
 *
 * دو روت و بس: یکی جلسه می‌سازد و لینک عمیق می‌دهد، یکی وضعیتش را می‌گوید.
 * ضبط واقعی در وبهوک بات پلتفرم اتفاق می‌افتد (`routes/telegramWebhook.ts`).
 */
import { Router } from "express";
import { requireAuth } from "./auth.js";
import { logger } from "../lib/logger.js";
import {
  createSession,
  getSession,
  deepLinkFor,
  type UploadSessionKind,
} from "../lib/uploadSessions.js";

const router = Router();

const KINDS: UploadSessionKind[] = ["broadcast", "panel_media", "command_media"];

/** شکل امنِ پاسخ — `userId` و شناسه‌های داخلی به کلاینت نمی‌روند. */
function present(session: Awaited<ReturnType<typeof getSession>>) {
  if (!session) return null;
  return {
    id: session.id,
    kind: session.kind,
    status: session.status,
    mediaType: session.mediaType,
    fileId: session.fileId,
    content: session.content,
    entities: session.entities,
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

export default router;
