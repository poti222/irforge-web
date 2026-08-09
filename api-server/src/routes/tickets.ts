import { logger } from "../lib/logger";
import { Router } from "express";
import { db, ticketsTable, ticketMessagesTable, usersTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import crypto from "crypto";
import { requireAuth } from "./auth";
import { notifyBotTicketReply } from "../lib/supportBot";
import { createNotification } from "../lib/notify";

const router = Router();

async function getRole(userId: string): Promise<string> {
  const [u] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  return u?.role ?? "user";
}

function formatTicket(t: any) {
  return {
    id: t.id,
    userId: t.userId,
    subject: t.subject,
    status: t.status,
    // G7: expose support-bot context so operators know where a ticket came from
    source: t.source ?? "web",
    telegramId: t.telegramId ?? null,
    tenant: t.tenant ?? null,
    issueType: t.issueType ?? null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

// GET /api/tickets — own tickets; super_admin sees all
router.get("/tickets", requireAuth, async (req: any, res) => {
  try {
    const role = await getRole(req.userId);
    const rows = role === "super_admin"
      ? await db.select().from(ticketsTable).orderBy(desc(ticketsTable.updatedAt))
      : await db.select().from(ticketsTable).where(eq(ticketsTable.userId, req.userId)).orderBy(desc(ticketsTable.updatedAt));

    // attach owner info for super_admin
    const enriched = await Promise.all(rows.map(async (t) => {
      if (role !== "super_admin") return formatTicket(t);
      const [owner] = await db.select({ name: usersTable.name, email: usersTable.email }).from(usersTable).where(eq(usersTable.id, t.userId)).limit(1);
      return { ...formatTicket(t), owner: owner ?? null };
    }));
    res.json(enriched);
  } catch (err) {
    logger.error({ err }, "List tickets error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/tickets — create with an opening message
router.post("/tickets", requireAuth, async (req: any, res) => {
  try {
    const { subject, body } = req.body;
    if (!subject?.trim() || !body?.trim()) {
      res.status(400).json({ error: "subject and body are required" });
      return;
    }
    const ticketId = crypto.randomUUID();
    const [ticket] = await db.insert(ticketsTable).values({
      id: ticketId, userId: req.userId, subject: subject.trim(), status: "open",
    }).returning();
    await db.insert(ticketMessagesTable).values({
      id: crypto.randomUUID(), ticketId, senderId: req.userId, senderRole: "user", body: body.trim(),
    });
    res.status(201).json(formatTicket(ticket));
  } catch (err) {
    logger.error({ err }, "Create ticket error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/tickets/:id — ticket + message thread
router.get("/tickets/:id", requireAuth, async (req: any, res) => {
  try {
    const role = await getRole(req.userId);
    const [ticket] = await db.select().from(ticketsTable).where(eq(ticketsTable.id, req.params.id)).limit(1);
    if (!ticket || (ticket.userId !== req.userId && role !== "super_admin")) {
      res.status(404).json({ error: "Ticket not found" });
      return;
    }
    const messages = await db.select().from(ticketMessagesTable)
      .where(eq(ticketMessagesTable.ticketId, ticket.id))
      .orderBy(ticketMessagesTable.createdAt);
    res.json({
      ...formatTicket(ticket),
      messages: messages.map((m) => ({
        id: m.id, senderId: m.senderId, senderRole: m.senderRole, body: m.body,
        createdAt: m.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    logger.error({ err }, "Get ticket error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/tickets/:id/messages — reply
router.post("/tickets/:id/messages", requireAuth, async (req: any, res) => {
  try {
    const { body } = req.body;
    if (!body?.trim()) {
      res.status(400).json({ error: "body is required" });
      return;
    }
    const role = await getRole(req.userId);
    const [ticket] = await db.select().from(ticketsTable).where(eq(ticketsTable.id, req.params.id)).limit(1);
    if (!ticket || (ticket.userId !== req.userId && role !== "super_admin")) {
      res.status(404).json({ error: "Ticket not found" });
      return;
    }
    const isStaff = role === "admin" || role === "super_admin";
    const [msg] = await db.insert(ticketMessagesTable).values({
      id: crypto.randomUUID(), ticketId: ticket.id, senderId: req.userId,
      senderRole: isStaff ? "admin" : "user", body: body.trim(),
    }).returning();
    // staff reply → answered; user reply on a closed/answered ticket → reopen
    const newStatus = isStaff ? "answered" : "open";
    await db.update(ticketsTable)
      .set({ status: newStatus })
      .where(eq(ticketsTable.id, ticket.id));
    // G7: relay an operator reply back to the support bot so it DMs the user.
    if (isStaff && ticket.source === "bot") {
      notifyBotTicketReply({ ticketId: ticket.id, status: "answered", replyPreview: body.trim(), tenant: ticket.tenant });
    }
    // اعلانِ «پاسخ پشتیبانی» فقط برای صاحب تیکت — نه برای خود پاسخ‌دهنده
    // (اپراتور می‌تونه صاحب تیکت خودش هم نباشه).
    if (isStaff && ticket.userId !== req.userId) {
      const preview = body.trim().length > 160 ? `${body.trim().slice(0, 159)}…` : body.trim();
      await createNotification({
        userId: ticket.userId,
        type: "ticket_reply",
        severity: "info",
        title: "پشتیبانی به تیکت شما پاسخ داد",
        message: `تیکت «${ticket.subject}» پاسخ گرفت:\n\n${preview}`,
      });
    }

    res.status(201).json({
      id: msg.id, senderId: msg.senderId, senderRole: msg.senderRole, body: msg.body,
      createdAt: msg.createdAt.toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "Reply ticket error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/tickets/:id — change status (e.g. close)
router.patch("/tickets/:id", requireAuth, async (req: any, res) => {
  try {
    const { status } = req.body;
    if (!["open", "answered", "closed"].includes(status)) {
      res.status(400).json({ error: "Invalid status" });
      return;
    }
    const role = await getRole(req.userId);
    const [ticket] = await db.select().from(ticketsTable).where(eq(ticketsTable.id, req.params.id)).limit(1);
    if (!ticket || (ticket.userId !== req.userId && role !== "super_admin")) {
      res.status(404).json({ error: "Ticket not found" });
      return;
    }
    const [updated] = await db.update(ticketsTable).set({ status })
      .where(eq(ticketsTable.id, ticket.id)).returning();
    // G7: keep the support bot's copy in sync (e.g. operator closes the ticket).
    if (ticket.source === "bot") {
      notifyBotTicketReply({ ticketId: ticket.id, status, tenant: ticket.tenant });
    }
    // فقط وقتی وضعیت واقعاً به closed تغییر کرده (نه بستنِ دوباره‌ی یک تیکت
    // که از قبل بسته بوده) و بستن کارِ خودِ صاحب تیکت نبوده.
    if (status === "closed" && ticket.status !== "closed" && ticket.userId !== req.userId) {
      await createNotification({
        userId: ticket.userId,
        type: "ticket_closed",
        severity: "info",
        title: "تیکت شما بسته شد",
        message: `تیکت «${ticket.subject}» توسط پشتیبانی بسته شد. اگر مشکل هنوز حل نشده، با ارسال پیام جدید در همان تیکت دوباره بازش کن.`,
      });
    }

    res.json(formatTicket(updated));
  } catch (err) {
    logger.error({ err }, "Update ticket error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
