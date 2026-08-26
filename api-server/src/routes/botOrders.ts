/**
 * routes/botOrders.ts — سفارش‌ها و رسیدها (تب `payments`).
 *
 * چهار وضعیتی که خود بات می‌شناسد (`handlers/payment.py:672`):
 *   `pending` ⏳ · `verified` ✅ · `rejected` ❌ · `postponed` 🕓
 * و دقیقاً همان سه‌تایی هستند که `order_confirm_msg` / `order_reject_msg` /
 * `order_track_msg` را مصرف می‌کنند. سایت وضعیت جدیدی اختراع نمی‌کند.
 *
 * تصویر رسید از پروکسی `GET /api/bots/:botId/media/:fileId` (در `botMedia.ts`)
 * می‌آید تا توکن بات هیچ‌وقت به کلاینت نرود.
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
  readSettings,
  assertSheetsAuthoritative,
  sendBotConfigError,
  BotConfigError,
} from "../lib/botConfig.js";
import { requirePluginEnabled } from "../lib/pluginGate.js";
import { nowIso } from "../lib/botTypes.js";

const router = Router();
const PAYMENTS_TAB = "payments";

export const ORDER_STATUSES = ["pending", "verified", "rejected", "postponed"] as const;
type OrderStatus = (typeof ORDER_STATUSES)[number];

type Order = {
  order_id: string;
  user_id: string;
  username: string;
  amount: unknown;
  final_amount?: unknown;
  method?: string;
  receipt_file_id?: string;
  receipt_text?: string;
  duplicate_of?: string;
  description?: string;
  status: string;
  created_at?: string;
  [key: string]: unknown;
};

async function readOrders(spreadsheetId: string): Promise<Order[]> {
  const rows = await listEntity<Order>(spreadsheetId, PAYMENTS_TAB);
  return rows
    .filter((r) => r.value && typeof r.value === "object")
    .map((r) => ({ ...(r.value as Order), order_id: String((r.value as Order).order_id ?? r.key) }));
}

/** پیام مربوط به هر وضعیت، با همان placeholderهایی که بات جایگزین می‌کند. */
function renderStatusMessage(
  template: string,
  order: Order,
  reason: string,
  currency: string
): string {
  const amount = order.final_amount ?? order.amount ?? "";
  return template
    .replaceAll("{order_id}", String(order.order_id ?? ""))
    .replaceAll("{amount}", `${amount} ${currency}`.trim())
    .replaceAll("{reason}", reason);
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

router.get("/bots/:botId/orders", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    // سفارش‌ها پشت پلاگین کیف پول‌اند. گیت اینجاست نه فقط در UI، چون این
    // روت مستقیم هم قابل صدا زدن است.
    await requirePluginEnabled(spreadsheetId, "wallet");
    const all = await readOrders(spreadsheetId);
    // P51: amounts on an order are whatever the bot's own settings currency
    // is (see renderStatusMessage below, which already stamps this same
    // value onto the Telegram notification text) — a bot configured for USD
    // has USD amounts here, not Toman. The web UI had no way to label them
    // until now, so a number just sat there with no unit.
    const { currency } = await readSettings(spreadsheetId);

    const search = String(req.query.search ?? "").trim().toLowerCase();
    const status = String(req.query.status ?? "all");
    const page = Math.max(1, Number(req.query.page ?? 1) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 30) || 30));

    let filtered = all;
    if (status !== "all") filtered = filtered.filter((o) => (o.status ?? "pending") === status);
    if (search) {
      filtered = filtered.filter((o) =>
        [o.order_id, o.user_id, o.username, o.description]
          .map((v) => String(v ?? "").toLowerCase())
          .some((v) => v.includes(search))
      );
    }
    filtered = [...filtered].sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));

    const counts: Record<string, number> = { all: all.length };
    for (const s of ORDER_STATUSES) counts[s] = all.filter((o) => (o.status ?? "pending") === s).length;

    const start = (page - 1) * limit;
    res.json({
      orders: filtered.slice(start, start + limit),
      page,
      limit,
      total: filtered.length,
      totalPages: Math.max(1, Math.ceil(filtered.length / limit)),
      counts,
      statuses: ORDER_STATUSES,
      currency,
    });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to list orders");
  }
});

router.get("/bots/:botId/orders/:orderId", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    // سفارش‌ها پشت پلاگین کیف پول‌اند. گیت اینجاست نه فقط در UI، چون این
    // روت مستقیم هم قابل صدا زدن است.
    await requirePluginEnabled(spreadsheetId, "wallet");
    const order = await getEntity<Order>(spreadsheetId, PAYMENTS_TAB, req.params.orderId);
    if (!order) throw new BotConfigError(404, "این سفارش پیدا نشد.", "order_not_found");
    res.json({ order: { ...order, order_id: String(order.order_id ?? req.params.orderId) } });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to read order");
  }
});

// ─── تغییر وضعیت ────────────────────────────────────────────────────────────

/**
 * تغییر وضعیت + ارسال پیام مربوطه به کاربر.
 *
 * ارسال پیام **بعد از** نوشتن روی شیت انجام می‌شود و شکستش وضعیت را برنمی‌گرداند:
 * یک سفارشِ تأییدشده که پیامش نرسیده، بهتر از سفارشی است که ادمین فکر می‌کند
 * تأیید نشده ولی پیامش رفته. نتیجه‌ی ارسال صریح در پاسخ گزارش می‌شود.
 */
router.post("/bots/:botId/orders/:orderId/status", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    // سفارش‌ها پشت پلاگین کیف پول‌اند. گیت اینجاست نه فقط در UI، چون این
    // روت مستقیم هم قابل صدا زدن است.
    await requirePluginEnabled(spreadsheetId, "wallet");
    await assertSheetsAuthoritative(PAYMENTS_TAB);

    const status = String(req.body?.status ?? "") as OrderStatus;
    if (!(ORDER_STATUSES as readonly string[]).includes(status))
      throw new BotConfigError(400, `وضعیت «${status}» معتبر نیست.`, "bad_status");

    const reason = String(req.body?.reason ?? "").slice(0, 500);
    if (status === "rejected" && !reason.trim())
      throw new BotConfigError(400, "برای رد کردن سفارش باید دلیل بنویسید.", "reason_required");

    const order = await getEntity<Order>(spreadsheetId, PAYMENTS_TAB, req.params.orderId);
    if (!order) throw new BotConfigError(404, "این سفارش پیدا نشد.", "order_not_found");

    const next: Order = {
      ...order,
      order_id: String(order.order_id ?? req.params.orderId),
      status,
      status_reason: reason,
      reviewed_at: nowIso(),
    };
    await putEntity(spreadsheetId, PAYMENTS_TAB, next.order_id, next);

    // پیام کاربر — best-effort.
    let notified: "sent" | "skipped" | "failed" = "skipped";
    let notifyError: string | null = null;
    if (status !== "pending") {
      const settings = await readSettings(spreadsheetId);
      const template =
        status === "verified" ? settings.order_confirm_msg
        : status === "rejected" ? settings.order_reject_msg
        : settings.order_track_msg;
      const token = await botToken(req.params.botId);

      if (!token) {
        notifyError = "توکن بات روی سرور در دسترس نیست.";
        notified = "failed";
      } else if (!order.user_id) {
        notifyError = "این سفارش آی‌دی کاربر ندارد.";
        notified = "failed";
      } else {
        const text = renderStatusMessage(template, next, reason, settings.currency);
        const sent = await tgApi(token, "sendMessage", { chat_id: String(order.user_id), text });
        if (sent.ok) {
          notified = "sent";
        } else {
          notified = "failed";
          notifyError = sent.description ?? "تلگرام پیام را نپذیرفت.";
          logger.warn({ orderId: next.order_id, description: sent.description }, "order status message failed");
        }
      }
    }

    res.json({ order: next, notified, notifyError });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to update order status");
  }
});

// ─── دکمه‌های سفارش (معادل `pay:btns_menu`) ─────────────────────────────────

/**
 * `handlers/payment.py:441-449` سه مجموعه دکمه دارد که در تنظیمات بات ذخیره
 * می‌شوند. اینجا فقط خوانده/نوشته می‌شوند — معنایشان کار بات است.
 */
const BUTTON_SETS = ["receipt_buttons", "approved_buttons", "rejected_buttons"] as const;

router.get("/bots/:botId/orders-config", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    // سفارش‌ها پشت پلاگین کیف پول‌اند. گیت اینجاست نه فقط در UI، چون این
    // روت مستقیم هم قابل صدا زدن است.
    await requirePluginEnabled(spreadsheetId, "wallet");
    const out: Record<string, unknown> = {};
    for (const key of BUTTON_SETS) {
      out[key] = (await getEntity<unknown>(spreadsheetId, "bot_settings", key)) ?? [];
    }
    res.json({ config: out, keys: BUTTON_SETS });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to read order config");
  }
});

router.patch("/bots/:botId/orders-config", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    // سفارش‌ها پشت پلاگین کیف پول‌اند. گیت اینجاست نه فقط در UI، چون این
    // روت مستقیم هم قابل صدا زدن است.
    await requirePluginEnabled(spreadsheetId, "wallet");
    await assertSheetsAuthoritative("bot_settings");

    const body = req.body ?? {};
    const out: Record<string, unknown> = {};
    for (const key of BUTTON_SETS) {
      if (!(key in body)) continue;
      if (!Array.isArray(body[key])) throw new BotConfigError(400, `«${key}» باید آرایه باشد.`);
      const buttons = body[key].map((raw: any, i: number) => {
        const label = String(raw?.label ?? "").trim();
        if (!label) throw new BotConfigError(400, `متن دکمه‌ی شماره ${i + 1} خالی است.`);
        const url = String(raw?.url ?? "").trim();
        if (url && !/^https:\/\//i.test(url))
          throw new BotConfigError(400, `آدرس دکمه‌ی «${label}» باید با https:// شروع شود.`);
        return { label, url };
      });
      // کلیدبه‌کلید روی همان تب تنظیمات (باگ B11) — از طریق putEntity، نه write.
      await putEntity(spreadsheetId, "bot_settings", key, buttons);
      out[key] = buttons;
    }
    res.json({ config: out });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to save order config");
  }
});

export default router;
