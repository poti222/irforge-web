/**
 * routes/botSupportTickets.ts — تیکت‌های داخل بات.
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ این با `routes/botTickets.ts` **یکی نیست** و نباید با آن اشتباه شود.
 * آن فایل قرارداد support-bot پلتفرم است: جداول `tickets`/`ticket_messages`
 * روی Postgres **سایت**، با یک API key مشترک. این فایل تیکت‌هایی است که
 * کاربرِ بات از داخل خودِ بات باز می‌کند و در تب‌های `tickets`/`ticket_messages`
 * شیت **تننت** ذخیره می‌شوند (`handlers/support.py`). دو چیز کاملاً متفاوت با
 * اسم یکسان — همان الگویی که B13/B14 هم داشتند.
 *
 * شکل دقیق از `handlers/support.py:71-101`:
 *   ticket : { id, tenant_id, user_id, status, assigned_admin_id, subject,
 *              message_thread_id, created_at, updated_at }
 *   message: { id, ticket_id, sender_type ("user"|"admin"), sender_id, text, timestamp }
 *
 * تب‌ها lazy از `plugin_db` ساخته می‌شوند، پس نبودشان روی یک بات **حالت عادی**
 * است (لیست خالی)، نه خطا.
 */
import { Router } from "express";
import { db, botsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "./auth.js";
import { decryptToken } from "../lib/tokenCrypto.js";
import { tgApi } from "../lib/telegram.js";
import { logger } from "../lib/logger.js";
import {
  resolveBotSheet,
  listEntity,
  getEntity,
  putEntity,
  assertSheetsAuthoritative,
  sendBotConfigError,
  BotConfigError,
} from "../lib/botConfig.js";
import { requirePluginEnabled } from "../lib/pluginGate.js";
import { nowIso } from "../lib/botTypes.js";

const router = Router();
const TICKETS_TAB = "tickets";
const MESSAGES_TAB = "ticket_messages";

/** همان پنج وضعیت `handlers/support.py:39`. */
export const TICKET_STATUSES = ["open", "assigned", "closed", "reopened", "escalated"] as const;
const ACTIVE_STATUSES = new Set(["open", "assigned", "reopened", "escalated"]);

type Ticket = {
  id: string;
  tenant_id?: string;
  user_id: string;
  status: string;
  assigned_admin_id?: string;
  subject?: string;
  message_thread_id?: number | null;
  created_at?: string;
  updated_at?: string;
  // آینه‌ی plugins/ticket/domain.py::add_message — IRFORGE_PROMPT_V3 Phase 23.
  // این سه فیلد قبلاً اینجا اصلاً نوشته نمی‌شدند، پس پاسخِ ادمین از سایت
  // "last_sender_role" را روی "user" و "last_message_at" را روی قدیمی جا
  // می‌گذاشت — چند ساعت بعد escalate_stale_tickets (بات) با اینکه تیکت
  // واقعاً جواب داده شده بود، آن را «بی‌پاسخ‌مانده» گزارش می‌کرد.
  last_message_at?: string;
  last_sender_role?: string;
  message_count?: number;
  escalation_notified_at?: string;
};

type TicketMessage = {
  id: string;
  ticket_id: string;
  sender_type: string;
  sender_id: string;
  text: string;
  timestamp: string;
};

/** خواندن یک تب lazy: نبودنش یعنی خالی، نه خطا. */
async function readTabSafe<T>(spreadsheetId: string, tab: string): Promise<Array<{ key: string; value: T }>> {
  try {
    const rows = await listEntity<T>(spreadsheetId, tab);
    return rows.filter((r) => r.value && typeof r.value === "object");
  } catch {
    return [];
  }
}

async function botToken(botId: string): Promise<string | null> {
  const [bot] = await db.select({ token: botsTable.token }).from(botsTable).where(eq(botsTable.id, botId)).limit(1);
  try {
    return decryptToken(bot?.token ?? "") || null;
  } catch {
    return null;
  }
}

// ─── لیست ───────────────────────────────────────────────────────────────────

router.get("/bots/:botId/support-tickets", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    // پشت پلاگین تیکت — گیت سمت سرور، چون پنهان‌کردن تب چیزی را محافظت نمی‌کند.
    await requirePluginEnabled(spreadsheetId, "ticket");
    const rows = await readTabSafe<Ticket>(spreadsheetId, TICKETS_TAB);
    const messages = await readTabSafe<TicketMessage>(spreadsheetId, MESSAGES_TAB);

    const countByTicket = new Map<string, number>();
    for (const m of messages) {
      const id = m.value.ticket_id;
      countByTicket.set(id, (countByTicket.get(id) ?? 0) + 1);
    }

    let tickets = rows.map((r) => ({
      ...(r.value as Ticket),
      id: r.key,
      messageCount: countByTicket.get(r.key) ?? 0,
    }));

    const status = String(req.query.status ?? "all");
    if (status === "active") tickets = tickets.filter((t) => ACTIVE_STATUSES.has(t.status));
    else if (status !== "all") tickets = tickets.filter((t) => t.status === status);

    const search = String(req.query.search ?? "").trim().toLowerCase();
    if (search) {
      tickets = tickets.filter((t) =>
        [t.id, t.user_id, t.subject].map((v) => String(v ?? "").toLowerCase()).some((v) => v.includes(search))
      );
    }

    tickets.sort((a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")));

    const counts: Record<string, number> = { all: rows.length };
    for (const s of TICKET_STATUSES) counts[s] = rows.filter((r) => r.value.status === s).length;
    counts.active = rows.filter((r) => ACTIVE_STATUSES.has(r.value.status)).length;

    res.json({ tickets, counts, statuses: TICKET_STATUSES });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to list support tickets");
  }
});

router.get("/bots/:botId/support-tickets/:ticketId", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    // پشت پلاگین تیکت — گیت سمت سرور، چون پنهان‌کردن تب چیزی را محافظت نمی‌کند.
    await requirePluginEnabled(spreadsheetId, "ticket");
    const ticket = await getEntity<Ticket>(spreadsheetId, TICKETS_TAB, req.params.ticketId);
    if (!ticket) throw new BotConfigError(404, "این تیکت پیدا نشد.", "ticket_not_found");

    const messages = (await readTabSafe<TicketMessage>(spreadsheetId, MESSAGES_TAB))
      .map((r) => ({ ...(r.value as TicketMessage), id: r.key }))
      .filter((m) => m.ticket_id === req.params.ticketId)
      // همان مرتب‌سازی `ticket_messages()` بات: بر اساس timestamp.
      .sort((a, b) => String(a.timestamp ?? "").localeCompare(String(b.timestamp ?? "")));

    res.json({ ticket: { ...ticket, id: req.params.ticketId }, messages });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to read support ticket");
  }
});

// ─── پاسخ ادمین ─────────────────────────────────────────────────────────────

/**
 * همان جدول وضعیتِ `plugins/ticket/domain.py::add_message` — IRFORGE_PROMPT_V3
 * Phase 23. پاسخِ ادمین فقط open/reopened را به assigned می‌برد؛ تیکتِ closed
 * با پاسخِ ادمین باز نمی‌شود (فقط پاسخِ *کاربر* یک تیکتِ بسته را reopen
 * می‌کند — که اینجا اصلاً رخ نمی‌دهد، چون کاربر از خودِ بات جواب می‌دهد نه
 * از سایت). قبلاً هر پاسخِ ادمین یک تیکتِ closed را به reopened می‌برد —
 * دقیقاً برعکسِ رفتار بات.
 */
function nextTicketStatusAfterAdminReply(currentStatus: string): string {
  return currentStatus === "open" || currentStatus === "reopened" ? "assigned" : currentStatus;
}

/**
 * فیلدهایی که باید روی تیکت merge شوند — دقیقاً همان چیزی که `add_message`
 * سمت بات بعد از هر پیام به‌روز می‌کند. قبلاً این سه فیلد (`last_message_at`/
 * `last_sender_role`/`message_count`) اینجا اصلاً نوشته نمی‌شدند: پاسخِ ادمین
 * از سایت `last_sender_role` را روی "user" و `last_message_at` را روی
 * قدیمی جا می‌گذاشت، پس `escalate_stale_tickets` (بات) چند ساعت بعد تیکتِ
 * واقعاً جواب‌داده‌شده را غلط «بی‌پاسخ‌مانده» گزارش می‌کرد.
 */
function ticketPatchAfterAdminReply(ticket: Ticket, message: TicketMessage) {
  return {
    status: nextTicketStatusAfterAdminReply(ticket.status),
    last_message_at: message.timestamp,
    last_sender_role: "admin",
    message_count: Number(ticket.message_count ?? 0) + 1,
    escalation_notified_at: "",
    updated_at: nowIso(),
  };
}

/**
 * پیام ادمین را هم در تب ثبت می‌کند و هم با توکن بات به کاربر می‌فرستد.
 * ثبت **اول** انجام می‌شود: تیکتی که پاسخش ثبت شده ولی نرسیده، بهتر از پاسخی
 * است که رفته و هیچ ردی در تاریخچه ندارد.
 */
router.post("/bots/:botId/support-tickets/:ticketId/reply", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    // پشت پلاگین تیکت — گیت سمت سرور، چون پنهان‌کردن تب چیزی را محافظت نمی‌کند.
    await requirePluginEnabled(spreadsheetId, "ticket");
    await assertSheetsAuthoritative(MESSAGES_TAB);

    const ticket = await getEntity<Ticket>(spreadsheetId, TICKETS_TAB, req.params.ticketId);
    if (!ticket) throw new BotConfigError(404, "این تیکت پیدا نشد.", "ticket_not_found");

    const text = String(req.body?.text ?? "").trim();
    if (!text) throw new BotConfigError(400, "متن پاسخ خالی است.");
    if (text.length > 4000) throw new BotConfigError(400, "طول پاسخ از ۴۰۰۰ کاراکتر بیشتر است (سقف تلگرام).");

    // شناسه‌ی پیام: hex ۳۲ کاراکتری بدون خط تیره — همان `uuid.uuid4().hex` بات.
    const messageId = crypto.randomUUID().replace(/-/g, "");
    const message: TicketMessage = {
      id: messageId,
      ticket_id: req.params.ticketId,
      sender_type: "admin",
      sender_id: String(req.userId),
      text,
      timestamp: nowIso(),
    };
    await putEntity(spreadsheetId, MESSAGES_TAB, messageId, message);

    const patch = ticketPatchAfterAdminReply(ticket, message);
    const nextStatus = patch.status;
    await putEntity(spreadsheetId, TICKETS_TAB, req.params.ticketId, {
      ...ticket,
      id: req.params.ticketId,
      ...patch,
    });

    let delivered: "sent" | "failed" = "failed";
    let deliveryError: string | null = null;
    const token = await botToken(req.params.botId);
    if (!token) {
      deliveryError = "توکن بات روی سرور در دسترس نیست.";
    } else {
      const payload: Record<string, unknown> = { chat_id: String(ticket.user_id), text };
      // تننت‌های forum-دار پاسخ را در همان تاپیک می‌خواهند (PHASE 26.8 بات).
      if (ticket.message_thread_id) payload.message_thread_id = ticket.message_thread_id;
      const sent = await tgApi(token, "sendMessage", payload);
      if (sent.ok) delivered = "sent";
      else {
        deliveryError = sent.description ?? "تلگرام پیام را نپذیرفت.";
        logger.warn({ ticketId: req.params.ticketId, description: sent.description }, "ticket reply not delivered");
      }
    }

    res.status(201).json({ message, status: nextStatus, delivered, deliveryError });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to reply to support ticket");
  }
});

// ─── وضعیت و ارجاع ──────────────────────────────────────────────────────────

router.patch("/bots/:botId/support-tickets/:ticketId", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    // پشت پلاگین تیکت — گیت سمت سرور، چون پنهان‌کردن تب چیزی را محافظت نمی‌کند.
    await requirePluginEnabled(spreadsheetId, "ticket");
    await assertSheetsAuthoritative(TICKETS_TAB);

    const ticket = await getEntity<Ticket>(spreadsheetId, TICKETS_TAB, req.params.ticketId);
    if (!ticket) throw new BotConfigError(404, "این تیکت پیدا نشد.", "ticket_not_found");

    const next: Ticket = { ...ticket, id: req.params.ticketId };
    const body = req.body ?? {};

    if ("status" in body) {
      const status = String(body.status);
      if (!(TICKET_STATUSES as readonly string[]).includes(status))
        throw new BotConfigError(400, `وضعیت «${status}» معتبر نیست.`, "bad_status");
      next.status = status;
    }
    if ("assigned_admin_id" in body) {
      const assignee = String(body.assigned_admin_id ?? "").trim();
      // ارجاع به کسی که ادمین این بات نیست، یک ارجاع مرده است.
      if (assignee) {
        const admins = await readTabSafe<{ user_id?: string }>(spreadsheetId, "admins");
        if (!admins.some((a) => String(a.value.user_id ?? a.key) === assignee))
          throw new BotConfigError(400, "این کاربر ادمین این بات نیست.", "not_an_admin");
      }
      next.assigned_admin_id = assignee;
      // ارجاع روی یک تیکت باز، یعنی «assigned» — مگر اینکه وضعیت صریح داده شده باشد.
      if (assignee && !("status" in body) && next.status === "open") next.status = "assigned";
    }

    next.updated_at = nowIso();
    await putEntity(spreadsheetId, TICKETS_TAB, next.id, next);
    res.json({ ticket: next });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to update support ticket");
  }
});

export const __testables = { nextTicketStatusAfterAdminReply, ticketPatchAfterAdminReply };

export default router;
