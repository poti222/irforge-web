/**
 * routes/internalTicketNotify.ts — IRFORGE_PROMPT_V3 Phase 16.
 * ─────────────────────────────────────────────────────────────────────────────
 * mainbot calls this whenever a user opens (or an SLA sweep escalates) a
 * ticket in a tenant bot, so the bot's *owner* — a website user who is not
 * necessarily a Telegram admin of their own bot — actually finds out.
 * `notify_admins` inside the bot only reaches Telegram admins of that one
 * bot; nothing before this phase ever reached the owner through the
 * platform/website side at all.
 *
 * Same internal-service-call shape as `POST /internal/bots/:botId/purge`
 * (routes/bots.ts) — shared secret header, constant-time compare, per-IP
 * rate limit, audited — but a **separate** secret (`TICKET_NOTIFY_SECRET`):
 * one leaked secret must not double as capability for an unrelated
 * endpoint.
 *
 * Identified by `spreadsheetId`, not the website's `bots.id` UUID: mainbot
 * only ever knows its own tenant sheet id, never the site's internal UUID
 * (see the documented gap in the bot's own `expiry_worker.py` for the
 * purge call, which hits exactly this wall). `bots.sheetId` already holds
 * the same value, so `resolveBotBySpreadsheetId` looks it up directly.
 */
import { Router } from "express";
import crypto from "crypto";
import { logger } from "../lib/logger.js";
import { authRateLimit, clientIp } from "../middleware/rateLimit.js";
import { writeAudit } from "../lib/audit.js";
import { resolveBotBySpreadsheetId, getBotOwnerAndManagerIds } from "../lib/botConfig.js";
import { createNotificationsBulk } from "../lib/notify.js";

const router = Router();

function secretOk(req: any): boolean {
  const provided = req.header("X-Ticket-Notify-Secret") ?? "";
  const expected = process.env.TICKET_NOTIFY_SECRET ?? "";
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  return (
    expected.length > 0 &&
    providedBuf.length === expectedBuf.length &&
    crypto.timingSafeEqual(providedBuf, expectedBuf)
  );
}

router.post("/internal/tickets/notify-new", authRateLimit("internal_ticket_notify"), async (req: any, res) => {
  if (!secretOk(req)) {
    logger.warn({ ip: clientIp(req) }, "Internal ticket-notify: bad or missing secret");
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  try {
    const spreadsheetId = String(req.body?.spreadsheetId ?? "").trim();
    const ticketId = String(req.body?.ticketId ?? "").trim();
    const kind = req.body?.kind === "escalated" ? "escalated" : "new";
    const subject = String(req.body?.subject ?? "").slice(0, 200) || "—";
    const customerLabel = String(req.body?.customerLabel ?? "").slice(0, 100);

    if (!spreadsheetId || !ticketId) {
      res.status(400).json({ error: "spreadsheetId و ticketId لازم‌اند." });
      return;
    }

    const bot = await resolveBotBySpreadsheetId(spreadsheetId);
    if (!bot) {
      // Idempotent, matches the purge route's own convention: mainbot has
      // no way to distinguish "not provisioned yet" from "already gone",
      // and retrying costs nothing.
      res.status(404).json({ error: "Bot not found for this spreadsheetId" });
      return;
    }

    const recipients = await getBotOwnerAndManagerIds(bot.botId, bot.ownerUserId);
    const isEscalated = kind === "escalated";
    const type = isEscalated ? "bot_ticket_escalated" : "bot_new_ticket";
    const title = isEscalated ? "تیکت بی‌پاسخ مانده" : "تیکت جدید";
    const who = customerLabel ? ` از ${customerLabel}` : "";
    const message = isEscalated
      ? `تیکت «${subject}»${who} مدتی است بی‌پاسخ مانده.`
      : `تیکت جدید «${subject}»${who} باز شد.`;

    await createNotificationsBulk(recipients, {
      type,
      severity: "warning",
      title,
      message,
      botId: bot.botId,
      // یک تیکت هرگز دوبار برای همین رویداد اعلان نمی‌سازد — مهم چون مسیر
      // زنگ‌زدنِ بات (aiohttp، بدون تراکنش) ممکن است retry کند.
      dedupeKey: `${type}:${ticketId}`,
      refId: ticketId,
    });

    await writeAudit({
      actorUserId: "system:mainbot",
      action: isEscalated ? "ticket_escalated_notified" : "ticket_created_notified",
      targetUserId: bot.ownerUserId,
      metadata: { botId: bot.botId, ticketId, sourceIp: clientIp(req) },
    });

    res.status(201).json({ ok: true, notified: recipients.length });
  } catch (err) {
    logger.error({ err }, "Internal ticket-notify error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
