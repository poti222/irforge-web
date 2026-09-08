/**
 * lib/catalogFulfillment.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * باگ: تاییدِ سفارش از پنلِ وب (`routes/botOrders.ts`) فقط وضعیت را
 * `verified` می‌کرد و پیامِ عمومیِ «پرداخت تایید شد» را می‌فرستاد — بدونِ
 * اینکه واقعاً محصول/سرویس را برای مشتری ارسال کند. تحویلِ خودکار فقط توی
 * خودِ ربات (`plugins/catalog/fulfillment.py::on_order_approved`, صداشده از
 * `handlers/payment.py::finalize_order_approval`) پیاده‌سازی شده بود؛ وقتی
 * ادمین از سایت تایید می‌کرد، آن مسیر اصلاً اجرا نمی‌شد.
 *
 * این فایل همان منطق را — تا حدی که بدونِ دسترسی به فرآیندِ زنده‌ی پایتون
 * ممکن است — روی همان دیتای شیتِ مشترک (`catalog_items`,
 * `catalog_item_options`, `catalog_pool_items`) بازپیاده‌سازی می‌کند، تا
 * تاییدِ سفارش از سایت هم دقیقاً همان نتیجه‌ی تاییدِ سفارش از توی ربات را
 * بدهد: قالبِ متنی/فایل/API/وبهوک/شارژِ کیف‌پول/استخرِ آیتمِ یکتا،
 * به‌ازای تعدادِ خریداری‌شده (qty)، خودکار برای خریدار ارسال می‌شود.
 * `manual` (تحویلِ دستی) عمداً دست‌نخورده می‌ماند — طبقِ طراحیِ خودِ
 * fulfillment.py، برای آن نوع هرگز چیزِ خودکاری «تحویل‌شده» حساب نمی‌شود،
 * فقط توضیح/رسانه‌ی خودِ کالا (اگر تنظیم شده باشد) می‌رود و بقیه‌اش صفِ
 * ادمین است.
 *
 * فقط وقتی صدا زده شود که سفارش واقعاً از پلاگین کاتالوگ باشد
 * (`form_data._catalog_cart` وجود داشته باشد) — دقیقاً همان چکِ
 * `on_order_approved` پایتون.
 */
import { getEntity, putEntity, assertSheetsAuthoritative } from "./botConfig.js";
import { tgApi } from "./telegram.js";
import * as catalogStore from "./catalogStore.js";
import { adminCredit } from "./walletStore.js";
import { logger } from "./logger.js";

const POOL_TAB = "catalog_pool_items";
const ITEMS_TAB = "catalog_items";
const OPTIONS_TAB = "catalog_item_options";

type CartLine = {
  item_id: string;
  option_id?: string | null;
  qty: number;
  unit_price?: number;
  _pool_reservation_id?: string;
  _pool_item_ids?: string[];
};

export type FulfillOrder = {
  order_id: string;
  user_id: string;
  username?: string;
  // عمداً `unknown` نه شکلِ دقیق — این تایپ روی هر آبجکتِ سفارشی که از
  // شیت خوانده شده (`routes/botOrders.ts`'s own `Order`) هم باید بدونِ
  // کست اضافه صدق کند؛ استخراجِ واقعیِ سبد داخلِ `cartFromOrder()` است.
  form_data?: unknown;
  [key: string]: unknown;
};

function cartFromOrder(order: FulfillOrder): CartLine[] {
  const fd = order.form_data as { _catalog_cart?: unknown } | undefined;
  const cart = fd?._catalog_cart;
  return Array.isArray(cart) ? (cart as CartLine[]) : [];
}

type PoolItem = {
  id: string;
  item_id: string;
  option_id: string;
  payload_type: string;
  payload: string;
  caption: string;
  status: string;
  order_id: string;
  buyer_id: string;
  reserved_until: string;
  sold_at?: string;
  delivered_at?: string;
  delivery_error?: string;
};

type FulfillmentResult = {
  status: "delivered" | "awaiting_manual" | "pending_webhook" | "failed" | "partial";
  detail?: string;
  error?: string;
};

export type FulfillSummary = {
  ran: boolean;
  delivered: number;
  pendingManual: number;
  failed: number;
  pendingWebhook: number;
};

// ─── کمکی‌ها ────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** آینه‌ی fulfillment.py::_render — پلیس‌هولدرِ ناشناخته دست‌نخورده می‌ماند. */
function renderTemplate(template: string, ctx: Record<string, string>): string {
  return String(template ?? "").replace(/\{(\w+)\}/g, (m, key) => (key in ctx ? ctx[key] : m));
}

function placeholderCtx(
  order: FulfillOrder,
  item: catalogStore.CatalogItem,
  option: catalogStore.ItemOption | null,
  qty: number,
): Record<string, string> {
  return {
    order_id: String(order.order_id ?? ""),
    buyer_name: String(order.username || order.user_id || ""),
    user_id: String(order.user_id ?? ""),
    item_name: item.name_fa || item.name || "",
    plan_name: option?.label || "",
    qty: String(qty),
  };
}

function dig(data: unknown, path: string): unknown {
  let cur: unknown = data;
  for (const part of (path || "").split(".")) {
    if (!part) continue;
    if (cur && typeof cur === "object") cur = (cur as Record<string, unknown>)[part];
    else return undefined;
  }
  return cur;
}

async function dm(token: string, userId: string, text: string): Promise<boolean> {
  if (!text || !userId) return false;
  try {
    const res = await tgApi(token, "sendMessage", { chat_id: userId, text, parse_mode: "HTML" });
    return !!res.ok;
  } catch (e) {
    logger.warn({ err: e, userId }, "catalog fulfillment: dm failed");
    return false;
  }
}

const SEND_METHOD: Record<string, { method: string; field: string }> = {
  photo: { method: "sendPhoto", field: "photo" },
  video: { method: "sendVideo", field: "video" },
  animation: { method: "sendAnimation", field: "animation" },
  document: { method: "sendDocument", field: "document" },
  audio: { method: "sendAudio", field: "audio" },
};

function buildButtonMarkup(buttons: catalogStore.CatalogItem["buttons"] | undefined): Record<string, unknown> | undefined {
  if (!buttons || !buttons.length) return undefined;
  const rows = new Map<number, Array<{ col: number; btn: Record<string, unknown> }>>();
  for (const b of buttons) {
    if (!["url", "panel", "mini_app"].includes(b.action)) continue;
    const value = String(b.value || "").trim();
    if (!value) continue;
    const label = String(b.label || "—").slice(0, 64);
    let btn: Record<string, unknown>;
    if (b.action === "url") btn = { text: label, url: value };
    else if (b.action === "mini_app") btn = { text: label, web_app: { url: value } };
    else btn = { text: label, callback_data: `nav:${value}` };
    const row = Number(b.row || 0);
    if (!rows.has(row)) rows.set(row, []);
    rows.get(row)!.push({ col: Number(b.col || 0), btn });
  }
  if (!rows.size) return undefined;
  const inline_keyboard = [...rows.keys()]
    .sort((a, b) => a - b)
    .map((k) => rows.get(k)!.sort((a, b) => a.col - b.col).map((x) => x.btn));
  return { inline_keyboard };
}

/** آینه‌ی plugins/catalog/delivery.py::send_catalog_item_to_buyer (بدونِ تقسیمِ overflow کپشن — متن‌های خیلی بلند به‌ندرت پیش می‌آید و تلگرام خودش خطا برمی‌گرداند که در لاگ می‌افتد). */
async function sendCatalogItemToBuyer(token: string, chatId: string, item: catalogStore.CatalogItem): Promise<void> {
  const media = item.media || [];
  const bodyHtml = (item.body_html && item.body_html.trim()) || esc(item.description || "");
  const markup = buildButtonMarkup(item.buttons);

  if (media.length === 0) {
    await tgApi(token, "sendMessage", { chat_id: chatId, text: bodyHtml || "—", parse_mode: "HTML", reply_markup: markup });
    return;
  }
  if (media.length === 1) {
    const m = media[0];
    const send = SEND_METHOD[m.type] || SEND_METHOD.photo;
    await tgApi(token, send.method, {
      chat_id: chatId,
      [send.field]: m.file_id,
      caption: bodyHtml || undefined,
      parse_mode: "HTML",
      reply_markup: markup,
    });
    return;
  }
  const items = media.slice(0, 10);
  const inputMedia = items.map((m, i) => ({
    type: m.type,
    media: m.file_id,
    ...(i === items.length - 1 && bodyHtml ? { caption: bodyHtml, parse_mode: "HTML" } : {}),
  }));
  try {
    await tgApi(token, "sendMediaGroup", { chat_id: chatId, media: inputMedia });
  } catch (e) {
    logger.warn({ err: e, item: item.id }, "catalog fulfillment: sendMediaGroup failed");
  }
  if (markup) {
    await tgApi(token, "sendMessage", { chat_id: chatId, text: "⬆️", reply_markup: markup });
  }
}

// ─── موجودی (غیرِ استخر) — آینه‌ی domain.py::reserve_stock ─────────────────

async function reserveStock(
  spreadsheetId: string,
  item: catalogStore.CatalogItem,
  option: catalogStore.ItemOption | null,
  qty: number,
): Promise<boolean> {
  if (option) {
    if (!option.track_stock) return true;
    if ((option.stock_qty || 0) < qty) return false;
    await assertSheetsAuthoritative(OPTIONS_TAB);
    await putEntity(spreadsheetId, OPTIONS_TAB, option.id, {
      ...option,
      stock_qty: option.stock_qty - qty,
      updated_at: new Date().toISOString(),
    });
    return true;
  }
  if (!item.track_stock) return true;
  if ((item.stock_qty || 0) < qty) return false;
  await assertSheetsAuthoritative(ITEMS_TAB);
  await putEntity(spreadsheetId, ITEMS_TAB, item.id, {
    ...item,
    stock_qty: item.stock_qty - qty,
    updated_at: new Date().toISOString(),
  });
  return true;
}

// ─── اجراکننده‌های تحویل — آینه‌ی fulfillment.py ───────────────────────────

async function execManual(token: string, order: FulfillOrder, item: catalogStore.CatalogItem): Promise<FulfillmentResult> {
  if ((item.media && item.media.length) || item.body_html) {
    try {
      await sendCatalogItemToBuyer(token, String(order.user_id), item);
    } catch (e) {
      logger.warn({ err: e, item: item.id }, "catalog fulfillment: manual media send failed");
    }
  }
  return { status: "awaiting_manual" };
}

async function execTemplate(
  token: string,
  order: FulfillOrder,
  item: catalogStore.CatalogItem,
  option: catalogStore.ItemOption | null,
  qty: number,
  config: Record<string, unknown>,
): Promise<FulfillmentResult> {
  const template = String(config.template ?? "");
  if (!template) return { status: "awaiting_manual", error: "نوعِ تحویل «متن» است ولی متن تنظیم نشده" };
  const text = renderTemplate(template, placeholderCtx(order, item, option, qty));
  const ok = await dm(token, String(order.user_id), text);
  return ok
    ? { status: "delivered", detail: text.slice(0, 500) }
    : { status: "awaiting_manual", error: "ارسال پیام به خریدار ناموفق بود" };
}

async function execFile(
  token: string,
  order: FulfillOrder,
  item: catalogStore.CatalogItem,
  option: catalogStore.ItemOption | null,
  qty: number,
  config: Record<string, unknown>,
): Promise<FulfillmentResult> {
  const ctx = placeholderCtx(order, item, option, qty);
  const fileId = String(config.file_id ?? "");
  const fileKind = String(config.file_kind ?? "document");
  const caption = config.caption ? renderTemplate(String(config.caption), ctx) : undefined;
  const text = config.text ? renderTemplate(String(config.text), ctx) : "";
  const uid = String(order.user_id);
  try {
    let sentAny = false;
    if (fileId) {
      const send = SEND_METHOD[fileKind] || SEND_METHOD.document;
      await tgApi(token, send.method, { chat_id: uid, [send.field]: fileId, caption, parse_mode: "HTML" });
      sentAny = true;
    }
    if (text) {
      await tgApi(token, "sendMessage", { chat_id: uid, text, parse_mode: "HTML" });
      sentAny = true;
    }
    if (!sentAny) return { status: "awaiting_manual", error: "نوعِ تحویل «فایل» است ولی نه فایل نه متن تنظیم شده" };
    return { status: "delivered", detail: (caption || text || fileId).slice(0, 500) };
  } catch (e: any) {
    return { status: "awaiting_manual", error: `ارسال فایل ناموفق: ${e?.message || e}` };
  }
}

async function execApi(
  token: string,
  order: FulfillOrder,
  item: catalogStore.CatalogItem,
  option: catalogStore.ItemOption | null,
  qty: number,
  config: Record<string, unknown>,
): Promise<FulfillmentResult> {
  const url = String(config.url ?? "");
  if (!url) return { status: "awaiting_manual", error: "نوعِ تحویل «API» است ولی آدرس تنظیم نشده" };

  const ctx = placeholderCtx(order, item, option, qty);
  const method = String(config.method ?? "POST").toUpperCase();
  const headers = (config.headers as Record<string, string>) || {};
  const rawPayload = (config.payload as Record<string, unknown>) || {};
  const payload: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rawPayload)) payload[k] = typeof v === "string" ? renderTemplate(v, ctx) : v;
  const timeoutMs = Number(config.timeout ?? 15) * 1000;

  let bodyText = "";
  let data: any = {};
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      body: method === "GET" ? undefined : JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timer);
    bodyText = await res.text();
    if (res.status >= 400) {
      return { status: "awaiting_manual", error: `API وضعیت ${res.status} برگرداند: ${bodyText.slice(0, 300)}` };
    }
    try {
      data = JSON.parse(bodyText);
    } catch {
      data = {};
    }
  } catch (e: any) {
    return { status: "awaiting_manual", error: `فراخوانی API ناموفق: ${e?.message || e}` };
  }

  const deliverField = String(config.response_field ?? "");
  const deliveredValue = deliverField ? dig(data, deliverField) : undefined;
  const messageTemplate = String(config.deliver_message ?? "");
  let text = "";
  if (messageTemplate) text = renderTemplate(messageTemplate, { ...ctx, result: String(deliveredValue ?? "") });
  else if (deliveredValue !== undefined && deliveredValue !== null) text = String(deliveredValue);

  if (text) await dm(token, String(order.user_id), text);
  return { status: "delivered", detail: (text || bodyText).slice(0, 500) };
}

async function execWebhook(
  order: FulfillOrder,
  item: catalogStore.CatalogItem,
  option: catalogStore.ItemOption | null,
  qty: number,
  config: Record<string, unknown>,
): Promise<FulfillmentResult> {
  const url = String(config.url ?? "");
  if (!url) return { status: "awaiting_manual", error: "نوعِ تحویل «وبهوک» است ولی آدرس تنظیم نشده" };

  const ctx = placeholderCtx(order, item, option, qty);
  const headers = (config.headers as Record<string, string>) || {};
  const rawPayload = (config.payload as Record<string, unknown>) || {};
  const payload: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rawPayload)) payload[k] = typeof v === "string" ? renderTemplate(v, ctx) : v;
  payload.order_id ??= ctx.order_id;
  payload.item_id ??= item.id;
  payload.user_id ??= ctx.user_id;
  payload.qty ??= qty;
  const timeoutMs = Number(config.timeout ?? 15) * 1000;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.status >= 400) {
      const bodyText = await res.text();
      return { status: "awaiting_manual", error: `وبهوک وضعیت ${res.status} برگرداند: ${bodyText.slice(0, 300)}` };
    }
  } catch (e: any) {
    return { status: "awaiting_manual", error: `ارسال وبهوک ناموفق: ${e?.message || e}` };
  }
  // موفقیتِ خودِ ارسال ≠ تحویل — سیستمِ بیرونی مسئولِ تحویلِ واقعی است.
  return { status: "pending_webhook", detail: `POST به ${url} ارسال شد` };
}

async function execWalletCredit(
  token: string,
  spreadsheetId: string,
  order: FulfillOrder,
  item: catalogStore.CatalogItem,
  option: catalogStore.ItemOption | null,
  qty: number,
  config: Record<string, unknown>,
): Promise<FulfillmentResult> {
  const amountPerUnit = Number(config.amount_per_unit ?? 0);
  if (!(amountPerUnit > 0)) {
    return { status: "awaiting_manual", error: "نوعِ تحویل «شارژِ کیف‌پول» است ولی مبلغ تنظیم نشده" };
  }
  const currency = String(config.currency ?? "IRT");
  const amount = Math.round(amountPerUnit * qty * 100) / 100;
  const uid = String(order.user_id);
  const ctx = placeholderCtx(order, item, option, qty);
  const reasonTemplate = String(config.reason ?? "خرید {item_name} — سفارش {order_id}");
  const reason = renderTemplate(reasonTemplate, ctx);

  try {
    const { wallet } = await adminCredit(spreadsheetId, uid, amount, reason, "system:catalog_fulfillment");
    const deliverTemplate = String(
      config.deliver_message ??
        "✅ مبلغ {amount} {currency} به کیف پول شما اضافه شد.\n💰 موجودی جدید: {new_balance} {currency}",
    );
    const text = renderTemplate(deliverTemplate, { ...ctx, amount: String(amount), currency, new_balance: String(wallet.balance) });
    await dm(token, uid, text);
    return { status: "delivered", detail: `${amount} ${currency} به کیف‌پول اضافه شد` };
  } catch (e: any) {
    // پول از خریدار قبلاً گرفته شده (سفارش verified شده) — هیچ‌وقت نباید
    // بی‌صدا گم شود، پس می‌افتد رو صفِ ادمین، نه یک خطای بی‌اثر.
    return { status: "awaiting_manual", error: `شارژِ کیف‌پول ناموفق: ${e?.message || e}` };
  }
}

async function sendPoolPayload(token: string, buyerId: string, payloadType: string, payload: string, caption: string): Promise<void> {
  if (payloadType === "photo") {
    await tgApi(token, "sendPhoto", { chat_id: buyerId, photo: payload, caption: caption || undefined, parse_mode: "HTML" });
  } else if (payloadType === "document") {
    await tgApi(token, "sendDocument", { chat_id: buyerId, document: payload, caption: caption || undefined, parse_mode: "HTML" });
  } else if (payloadType === "video") {
    await tgApi(token, "sendVideo", { chat_id: buyerId, video: payload, caption: caption || undefined, parse_mode: "HTML" });
  } else {
    const text = caption ? `${caption}\n\n${payload}` : payload;
    await tgApi(token, "sendMessage", { chat_id: buyerId, text });
  }
}

/** آینه‌ی pool.py::deliver_from_pool — آیتم‌های دقیقاً رزروشده‌ی همین سفارش (نه item_id عمومی) را از استخر می‌فرستد. */
async function execPool(
  spreadsheetId: string,
  token: string,
  order: FulfillOrder,
  line: CartLine,
  qty: number,
): Promise<FulfillmentResult> {
  const itemIds = line._pool_item_ids || [];
  if (!itemIds.length || itemIds.length < qty) {
    return {
      status: "awaiting_manual",
      error: "هیچ آیتمِ رزروشده‌ای برای این سفارش پیدا نشد (احتمالاً نوعِ تحویل بعد از رزرو عوض شده).",
    };
  }

  const delivered: string[] = [];
  const failed: Array<[string, string]> = [];
  const now = new Date().toISOString();

  await assertSheetsAuthoritative(POOL_TAB);
  for (const poolId of itemIds) {
    const row = await getEntity<PoolItem>(spreadsheetId, POOL_TAB, poolId);
    if (!row) {
      failed.push([poolId, "رکورد آیتم پیدا نشد"]);
      continue;
    }
    try {
      await sendPoolPayload(token, String(order.user_id), row.payload_type, row.payload, row.caption);
      await putEntity(spreadsheetId, POOL_TAB, poolId, {
        ...row,
        status: "delivered",
        delivered_at: now,
        sold_at: row.sold_at || now,
      });
      delivered.push(poolId);
    } catch (e: any) {
      await putEntity(spreadsheetId, POOL_TAB, poolId, {
        ...row,
        status: "failed",
        delivery_error: String(e?.message || e),
        sold_at: row.sold_at || now,
      });
      failed.push([poolId, String(e?.message || e)]);
      logger.warn({ err: e, poolId, userId: order.user_id }, "catalog fulfillment: pool item send failed");
    }
  }

  if (failed.length && !delivered.length) {
    return { status: "failed", error: failed.map(([id, err]) => `${id}: ${err}`).join("؛ ").slice(0, 500) };
  }
  if (failed.length) {
    return { status: "partial", detail: `${delivered.length}/${itemIds.length} تحویل شد` };
  }
  return { status: "delivered", detail: `${delivered.length} آیتم تحویل شد` };
}

// ─── نقطه‌ی ورود — آینه‌ی fulfillment.py::on_order_approved ────────────────

/**
 * سفارشِ تاییدشده را fulfill می‌کند: به‌ازای هر ردیفِ سبد (`qty` واحد)،
 * بسته به `fulfillment_type` کالا، محتوا را خودکار برای خریدار می‌فرستد.
 * اگر سفارش اصلاً از کاتالوگ نباشد (`_catalog_cart` ندارد)، بی‌اثر است
 * (`ran: false`) — دقیقاً همان چکِ اولِ `on_order_approved` پایتون.
 */
export async function runOrderFulfillment(
  spreadsheetId: string,
  botToken: string,
  order: FulfillOrder,
  orderGroupId?: string,
): Promise<FulfillSummary> {
  const cart = cartFromOrder(order);
  if (!cart.length) {
    return { ran: false, delivered: 0, pendingManual: 0, failed: 0, pendingWebhook: 0 };
  }

  const summary: FulfillSummary = { ran: true, delivered: 0, pendingManual: 0, failed: 0, pendingWebhook: 0 };
  const pendingNotes: string[] = [];

  for (const line of cart) {
    try {
      const itemId = String(line.item_id || "");
      const optionId = line.option_id || null;
      const qty = Math.max(1, Number(line.qty || 1));
      const item = await catalogStore.getItem(spreadsheetId, itemId);
      if (!item) {
        summary.failed++;
        pendingNotes.push(`سفارش ${order.order_id}: کالا/سرویسِ «${itemId}» پیدا نشد (احتمالاً حذف شده).`);
        continue;
      }
      const option = optionId ? await catalogStore.getOption(spreadsheetId, optionId) : null;
      const ftype = item.fulfillment_type || "manual";
      const config = catalogStore.getFulfillmentConfig(item);

      const stockOk = await reserveStock(spreadsheetId, item, option, qty);
      if (!stockOk) {
        summary.failed++;
        pendingNotes.push(`سفارش ${order.order_id}: موجودیِ «${item.name_fa || item.name}» برای ${qty} عدد کافی نیست.`);
        continue;
      }

      let result: FulfillmentResult;
      switch (ftype) {
        case "template":
          result = await execTemplate(botToken, order, item, option, qty, config);
          break;
        case "file":
          result = await execFile(botToken, order, item, option, qty, config);
          break;
        case "api":
          result = await execApi(botToken, order, item, option, qty, config);
          break;
        case "webhook":
          result = await execWebhook(order, item, option, qty, config);
          break;
        case "wallet_credit":
          result = await execWalletCredit(botToken, spreadsheetId, order, item, option, qty, config);
          break;
        case "pool":
          result = await execPool(spreadsheetId, botToken, order, line, qty);
          break;
        case "manual":
        default:
          result = await execManual(botToken, order, item);
          break;
      }

      // توضیح/رسانه‌ی خودِ کالا (مستقل از fulfillment_type) — فقط وقتی
      // واقعاً چیزی تحویل داده شده؛ manual خودش این را داخلِ execManual
      // فرستاده، دوباره اینجا نمی‌فرستیم.
      if (result.status === "delivered" && ftype !== "manual" && ((item.media && item.media.length) || item.body_html)) {
        try {
          await sendCatalogItemToBuyer(botToken, String(order.user_id), item);
        } catch (e) {
          logger.warn({ err: e, item: item.id }, "catalog fulfillment: item media send failed");
        }
      }

      if (result.status === "delivered") summary.delivered++;
      else if (result.status === "pending_webhook") summary.pendingWebhook++;
      else if (result.status === "partial") {
        summary.delivered++;
        summary.pendingManual++;
      } else {
        summary.pendingManual++;
        if (result.error) pendingNotes.push(`سفارش ${order.order_id} — «${item.name_fa || item.name}»: ${result.error}`);
      }
    } catch (e: any) {
      logger.error({ err: e, orderId: order.order_id }, "catalog fulfillment: line failed unexpectedly");
      summary.failed++;
    }
  }

  if (pendingNotes.length && orderGroupId) {
    try {
      await tgApi(botToken, "sendMessage", {
        chat_id: orderGroupId,
        text: `📦 تحویل دستی لازم است\n\n${pendingNotes.join("\n")}\n\nبرای علامت‌زدن به‌عنوان تحویل‌شده از پنلِ «تحویل‌های در انتظار» در خودِ ربات استفاده کنید.`,
      });
    } catch (e) {
      logger.warn({ err: e }, "catalog fulfillment: admin pending notify failed");
    }
  }

  return summary;
}
