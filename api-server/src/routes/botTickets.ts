/**
 * routes/botTickets.ts — the bot-facing ticket contract (parity group G7).
 *
 * The support bot (`support-bot/bot/ticket_site_client.py`) calls these with a
 * shared API key. Mount base is `/api/bot`, so configure the bot's registry
 * `global_settings.ticket_site_api_base = https://<site>/api/bot`:
 *
 *   POST /api/bot/tickets           {tenant, telegram_id, issue_type, details}
 *        → 200 {ticket_id, user_url, admin_url}
 *   GET  /api/bot/tickets/:id       → 200 {ticket_id, status, last_reply_at}
 *   POST /api/bot/tickets/:id/replies {by, text}   ("user" | "operator")
 *        → 200 {ok:true}
 *
 * Auth: Authorization: Bearer <SUPPORT_TICKET_API_KEY>.
 */
import { Router } from "express";
import { db, ticketsTable, ticketMessagesTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import crypto from "crypto";
import { logger } from "../lib/logger";
import { ticketApiKey } from "../lib/supportBot";

const router = Router();

function timingEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/** Bearer-API-key guard for the support bot. */
function requireTicketApiKey(req: any, res: any, next: any) {
  const configured = ticketApiKey();
  if (!configured) {
    res.status(503).json({ error: "Ticket API is not configured on this server" });
    return;
  }
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ") || !timingEqual(header.slice(7).trim(), configured)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}

function siteBase(): string {
  return (process.env.PUBLIC_SITE_URL || "").replace(/\/+$/, "");
}

// ─── POST /api/bot/tickets — create a ticket from the support bot ─────────────
router.post("/bot/tickets", requireTicketApiKey, async (req: any, res) => {
  try {
    const { tenant, telegram_id, issue_type, details } = req.body ?? {};
    const issueType = String(issue_type ?? "").trim() || "support";
    const body = String(details ?? "").trim();
    if (!telegram_id || !body) {
      res.status(400).json({ error: "telegram_id and details are required" });
      return;
    }
    const ticketId = crypto.randomUUID();
    const base = siteBase();
    const userUrl = base ? `${base}/tickets` : null;
    const adminUrl = base ? `${base}/tickets` : null;

    await db.insert(ticketsTable).values({
      id: ticketId,
      userId: null,
      subject: issueType,
      status: "open",
      source: "bot",
      telegramId: String(telegram_id),
      tenant: tenant ? String(tenant) : null,
      issueType,
      userUrl,
      adminUrl,
    });
    await db.insert(ticketMessagesTable).values({
      id: crypto.randomUUID(),
      ticketId,
      senderId: `tg:${telegram_id}`,
      senderRole: "user",
      body,
    });

    res.json({ ticket_id: ticketId, user_url: userUrl, admin_url: adminUrl });
  } catch (err) {
    logger.error({ err }, "bot create ticket error");
    res.status(500).json({ error: "internal" });
  }
});

// ─── GET /api/bot/tickets/:id — status for the reconciliation poll ───────────
router.get("/bot/tickets/:id", requireTicketApiKey, async (req: any, res) => {
  try {
    const [ticket] = await db.select().from(ticketsTable).where(eq(ticketsTable.id, req.params.id)).limit(1);
    if (!ticket) {
      res.status(404).json({ error: "not found" });
      return;
    }
    const [last] = await db
      .select({ createdAt: ticketMessagesTable.createdAt })
      .from(ticketMessagesTable)
      .where(eq(ticketMessagesTable.ticketId, ticket.id))
      .orderBy(desc(ticketMessagesTable.createdAt))
      .limit(1);
    res.json({
      ticket_id: ticket.id,
      status: ticket.status,
      last_reply_at: last?.createdAt ? last.createdAt.toISOString() : null,
    });
  } catch (err) {
    logger.error({ err }, "bot get ticket error");
    res.status(500).json({ error: "internal" });
  }
});

// ─── POST /api/bot/tickets/:id/replies — a reply relayed from the bot ────────
router.post("/bot/tickets/:id/replies", requireTicketApiKey, async (req: any, res) => {
  try {
    const { by, text } = req.body ?? {};
    const body = String(text ?? "").trim();
    if (!body) {
      res.status(400).json({ error: "text is required" });
      return;
    }
    const [ticket] = await db.select().from(ticketsTable).where(eq(ticketsTable.id, req.params.id)).limit(1);
    if (!ticket) {
      res.status(404).json({ error: "not found" });
      return;
    }
    const isOperator = String(by ?? "").toLowerCase() === "operator";
    await db.insert(ticketMessagesTable).values({
      id: crypto.randomUUID(),
      ticketId: ticket.id,
      senderId: String(by ?? "user"),
      senderRole: isOperator ? "admin" : "user",
      body,
    });
    await db.update(ticketsTable)
      .set({ status: isOperator ? "answered" : "open" })
      .where(eq(ticketsTable.id, ticket.id));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "bot reply ticket error");
    res.status(500).json({ error: "internal" });
  }
});

export default router;
