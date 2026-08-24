/**
 * routes/botWallet.ts — IRFORGE_PROMPT_V3 Phase 24
 * ─────────────────────────────────────────────────────────────────────────────
 * Balance lookup, admin credit/debit, freeze/unfreeze, charge/refund an
 * order, and notification-template settings for the bot's `wallet` plugin —
 * see `lib/walletStore.ts`'s header for the full rationale (this was
 * Telegram-command-only before this phase) and its correctness note on the
 * cross-process advisory lock every mutation here takes.
 *
 * Named `botWallet.ts` (not `wallet.ts` — that file already exists and is a
 * completely different thing: the platform's own Postgres-backed SaaS
 * balance customers use to buy bots/plugins on irforge itself).
 *
 * The user-facing receipt DM is sent the same way `botOrders.ts`'s status
 * endpoint sends its order-status message: best-effort, *after* the sheet
 * write, plain text (no parse_mode — matching the website's only other
 * wallet-adjacent notification precedent; the bot's own MarkdownV2 templates
 * are fully re-escaped before sending anyway, so the rendered result is the
 * same literal-asterisks appearance either way). A failed DM never undoes a
 * successful mutation.
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
  assertSheetsAuthoritative,
  sendBotConfigError,
  BotConfigError,
} from "../lib/botConfig.js";
import { requirePluginEnabled } from "../lib/pluginGate.js";
import {
  OWNER_TYPE_USER, DEFAULT_CURRENCY,
  getOrCreateWallet, listTransactions,
  adminCredit, adminDebit, freezeWallet, unfreezeWallet,
  chargeOrder, refundOrder,
  getWalletNotifySettings, setWalletNotifySettings,
  buildUserReceiptText,
  type WalletRecord,
} from "../lib/walletStore.js";

const router = Router();
const PLUGIN_ID = "wallet";

async function botToken(botId: string): Promise<string | null> {
  const [bot] = await db.select({ token: botsTable.token }).from(botsTable).where(eq(botsTable.id, botId)).limit(1);
  try {
    return decryptToken(bot?.token ?? "") || null;
  } catch {
    return null;
  }
}

/** ارسالِ best-effort رسیدِ کاربر — شکستش هرگز جهش موفقِ کیف‌پول را برنمی‌گرداند. */
async function notifyUser(
  botId: string, spreadsheetId: string, wallet: WalletRecord, text: string | null,
): Promise<{ notified: "sent" | "skipped" | "failed"; notifyError: string | null }> {
  if (!text) return { notified: "skipped", notifyError: null };
  const token = await botToken(botId);
  if (!token) return { notified: "failed", notifyError: "توکن بات روی سرور در دسترس نیست." };
  try {
    const sent = await tgApi(token, "sendMessage", { chat_id: String(wallet.owner_id), text });
    if (sent.ok) return { notified: "sent", notifyError: null };
    logger.warn({ walletId: wallet.id, description: sent.description }, "wallet notify failed");
    return { notified: "failed", notifyError: sent.description ?? "تلگرام پیام را نپذیرفت." };
  } catch (err) {
    logger.warn({ err, walletId: wallet.id }, "wallet notify threw");
    return { notified: "failed", notifyError: "ارسال پیام با خطا مواجه شد." };
  }
}

function actorFor(req: any): string {
  return `web:${req.userId}`;
}

// ─── جست‌وجو / نمایش کیف‌پول یک کاربر ─────────────────────────────────────────

router.get("/bots/:botId/wallet/users/:userId", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    const userId = String(req.params.userId).trim();
    if (!userId) throw new BotConfigError(400, "شناسه‌ی کاربر الزامی است.", "bad_user_id");
    const wallet = await getOrCreateWallet(spreadsheetId, OWNER_TYPE_USER, userId, DEFAULT_CURRENCY);
    const transactions = await listTransactions(spreadsheetId, wallet.id, 50);
    res.json({ wallet, transactions });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to load wallet");
  }
});

// ─── واریز / برداشتِ دستی ────────────────────────────────────────────────────

router.post("/bots/:botId/wallet/users/:userId/credit", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    await assertSheetsAuthoritative("wallet");
    const amount = Number(req.body?.amount);
    const reason = String(req.body?.reason ?? "").slice(0, 500) || "manual admin credit";
    const { wallet, entry } = await adminCredit(spreadsheetId, req.params.userId, amount, reason, actorFor(req));
    const settings = await getWalletNotifySettings(spreadsheetId);
    const notify = await notifyUser(req.params.botId, spreadsheetId, wallet, buildUserReceiptText(wallet, entry, settings));
    res.json({ wallet, entry, ...notify });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to credit wallet");
  }
});

router.post("/bots/:botId/wallet/users/:userId/debit", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    await assertSheetsAuthoritative("wallet");
    const amount = Number(req.body?.amount);
    const reason = String(req.body?.reason ?? "").slice(0, 500) || "manual admin debit";
    const { wallet, entry } = await adminDebit(spreadsheetId, req.params.userId, amount, reason, actorFor(req));
    const settings = await getWalletNotifySettings(spreadsheetId);
    const notify = await notifyUser(req.params.botId, spreadsheetId, wallet, buildUserReceiptText(wallet, entry, settings));
    res.json({ wallet, entry, ...notify });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to debit wallet");
  }
});

// ─── مسدود / رفعِ مسدودی ─────────────────────────────────────────────────────

router.post("/bots/:botId/wallet/users/:userId/freeze", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    await assertSheetsAuthoritative("wallet");
    const reason = String(req.body?.reason ?? "").slice(0, 500);
    const wallet = await freezeWallet(spreadsheetId, req.params.userId, actorFor(req), reason);
    const settings = await getWalletNotifySettings(spreadsheetId);
    const notify = await notifyUser(req.params.botId, spreadsheetId, wallet, buildUserReceiptText(wallet, null, settings, "freeze"));
    res.json({ wallet, ...notify });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to freeze wallet");
  }
});

router.post("/bots/:botId/wallet/users/:userId/unfreeze", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    await assertSheetsAuthoritative("wallet");
    const reason = String(req.body?.reason ?? "").slice(0, 500);
    const wallet = await unfreezeWallet(spreadsheetId, req.params.userId, actorFor(req), reason);
    const settings = await getWalletNotifySettings(spreadsheetId);
    const notify = await notifyUser(req.params.botId, spreadsheetId, wallet, buildUserReceiptText(wallet, null, settings, "unfreeze"));
    res.json({ wallet, ...notify });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to unfreeze wallet");
  }
});

// ─── شارژ/بازگشتِ وجه یک سفارش ───────────────────────────────────────────────

router.post("/bots/:botId/wallet/charge-order", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    await assertSheetsAuthoritative("wallet");
    const orderCode = String(req.body?.orderCode ?? "").trim();
    if (!orderCode) throw new BotConfigError(400, "کد سفارش الزامی است.", "bad_order_code");
    const amount = Number(req.body?.amount);
    const reason = String(req.body?.reason ?? "").slice(0, 500);
    const { wallet, entry } = await chargeOrder(spreadsheetId, orderCode, amount, reason, actorFor(req));
    const settings = await getWalletNotifySettings(spreadsheetId);
    const notify = await notifyUser(req.params.botId, spreadsheetId, wallet, buildUserReceiptText(wallet, entry, settings));
    res.json({ wallet, entry, ...notify });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to charge order");
  }
});

router.post("/bots/:botId/wallet/refund-order", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    await assertSheetsAuthoritative("wallet");
    const orderCode = String(req.body?.orderCode ?? "").trim();
    if (!orderCode) throw new BotConfigError(400, "کد سفارش الزامی است.", "bad_order_code");
    const amount = Number(req.body?.amount);
    const reason = String(req.body?.reason ?? "").slice(0, 500);
    const { wallet, entry } = await refundOrder(spreadsheetId, orderCode, amount, reason, actorFor(req));
    const settings = await getWalletNotifySettings(spreadsheetId);
    const notify = await notifyUser(req.params.botId, spreadsheetId, wallet, buildUserReceiptText(wallet, entry, settings));
    res.json({ wallet, entry, ...notify });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to refund order");
  }
});

// ─── تنظیمات اعلان ────────────────────────────────────────────────────────────

router.get("/bots/:botId/wallet-notify-settings", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    res.json(await getWalletNotifySettings(spreadsheetId));
  } catch (err) {
    sendBotConfigError(res, err, "Failed to read wallet notify settings");
  }
});

router.put("/bots/:botId/wallet-notify-settings", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, PLUGIN_ID);
    await assertSheetsAuthoritative("bot_settings");
    res.json(await setWalletNotifySettings(spreadsheetId, req.body ?? {}));
  } catch (err) {
    sendBotConfigError(res, err, "Failed to update wallet notify settings");
  }
});

export default router;
