/**
 * supportBot.ts — the site→support-bot reply webhook (parity group G7).
 *
 * When an operator answers or closes a support-bot-originated ticket on the site,
 * we POST a notification to the support bot's webhook endpoint so it DMs the
 * Telegram user. This is the mirror of `support-bot/bot/webhook_server.py`:
 *
 *     POST {SUPPORT_BOT_WEBHOOK_URL}
 *       headers: X-Ticket-Webhook-Secret: <SUPPORT_BOT_WEBHOOK_SECRET>
 *       body:    { ticket_id, status, reply_preview, tenant? }
 *
 * Best-effort: failures are logged, never thrown (the reply already persisted on
 * the site; the bot's reconciliation poll is the safety net for a missed hook).
 */
import { logger } from "./logger";

export function supportBotConfigured(): boolean {
  return Boolean(process.env.SUPPORT_BOT_WEBHOOK_URL && process.env.SUPPORT_BOT_WEBHOOK_SECRET);
}

/** The shared API key the support bot must present on inbound ticket calls. */
export function ticketApiKey(): string | null {
  return process.env.SUPPORT_TICKET_API_KEY || null;
}

export function notifyBotTicketReply(args: {
  ticketId: string;
  status: string; // answered | closed | open
  replyPreview?: string;
  tenant?: string | null;
}): void {
  const url = process.env.SUPPORT_BOT_WEBHOOK_URL;
  const secret = process.env.SUPPORT_BOT_WEBHOOK_SECRET;
  if (!url || !secret) return; // not configured — silently skip

  const body = JSON.stringify({
    ticket_id: args.ticketId,
    status: args.status,
    reply_preview: (args.replyPreview ?? "").slice(0, 400),
    tenant: args.tenant ?? undefined,
  });

  // Fire-and-forget with a short timeout; never block the request.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Ticket-Webhook-Secret": secret },
    body,
    signal: controller.signal,
  })
    .then((r) => {
      if (!r.ok) logger.warn({ status: r.status, ticketId: args.ticketId }, "support-bot webhook non-2xx");
    })
    .catch((err) => logger.warn({ err, ticketId: args.ticketId }, "support-bot webhook failed (non-fatal)"))
    .finally(() => clearTimeout(timer));
}
