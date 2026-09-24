/**
 * lib/orderGroup.ts — بررسیِ «گروه سفارش‌ها» و تست ارسالِ رسید/سفارش.
 * ─────────────────────────────────────────────────────────────────────────────
 * ارسالِ واقعیِ رسید و آی‌دی سفارش به گروه و ادمین‌ها کارِ خودِ بات است
 * (`irforge-app/handlers/payment.py::fsm_upload_receipt`)؛ سایت فقط `order_group`
 * را روی شیت می‌نویسد. قبلاً همان مقداری که ادمین تایپ می‌کرد **خام** ذخیره
 * می‌شد و هیچ‌کس نمی‌فهمید تلگرام آن را قبول می‌کند یا نه — بات موقع ارسال
 * «chat not found» می‌گرفت و رسید بی‌صدا گم می‌شد (همان الگوی کانال‌های عضویت
 * اجباری، باگ B10).
 *
 * علت‌های واقعیِ «به گروه نمی‌رسد» که اینجا قابل تشخیص‌اند:
 *   ۱. آی‌دی بدونِ `-100` (سوپرگروه‌ها همیشه با `-100` شروع می‌شوند).
 *   ۲. بات داخل گروه نیست / kick شده.
 *   ۳. بات اجازه‌ی ارسال پیام ندارد (گروهِ محدود، یا کانالی که بات ادمین نیست).
 *   ۴. گروه به سوپرگروه ارتقا یافته و آی‌دی‌اش عوض شده (`migrate_to_chat_id`).
 * و علتِ «به ادمین نمی‌رسد»: ادمین هیچ‌وقت بات را استارت نکرده، یا بلاکش کرده.
 *
 * منطقِ خالص (بدونِ I/O) جدا و export شده تا بدونِ mock کردنِ تلگرام تست شود.
 */
import { tgApi } from "./telegram.js";

const TG_TIMEOUT_MS = 8_000;

type TgResponse = {
  ok: boolean;
  result?: any;
  description?: string;
  parameters?: { migrate_to_chat_id?: number };
};

/** فراخوانیِ تلگرام با سقف زمان؛ هرگز throw نمی‌کند (شکست = `ok:false`). */
async function tg(token: string, method: string, body?: Record<string, unknown>): Promise<TgResponse> {
  try {
    return (await Promise.race([
      tgApi(token, method, body),
      new Promise<TgResponse>((resolve) =>
        setTimeout(() => resolve({ ok: false, description: "timeout" }), TG_TIMEOUT_MS),
      ),
    ])) as TgResponse;
  } catch (err: any) {
    return { ok: false, description: String(err?.message ?? "network error") };
  }
}

// ─── منطقِ خالص ─────────────────────────────────────────────────────────────

/**
 * آی‌دی‌هایی که باید به‌ترتیب امتحان شوند. ورودیِ کاربر همیشه اول می‌آید؛
 * بعد شکل‌های رایجِ «خراب‌کپی‌شده»:
 *   `1234567890`   (منفی و 100 افتاده)  → `-1001234567890`
 *   `-1234567890`  (فقط 100 افتاده)     → `-1001234567890`
 */
export function orderGroupCandidates(raw: string): string[] {
  const s = String(raw ?? "").trim();
  if (!s) return [];
  const out = [s];
  if (/^\d{9,}$/.test(s)) out.push(`-100${s}`, `-${s}`);
  else if (/^-\d{9,}$/.test(s) && !s.startsWith("-100")) out.push(`-100${s.slice(1)}`);
  return [...new Set(out)];
}

export type SendFailureCode =
  | "chat_not_found"
  | "bot_kicked"
  | "no_rights"
  | "migrated"
  | "user_not_started"
  | "user_deactivated"
  | "rate_limited"
  | "timeout"
  | "unknown";

export type SendFailure = {
  code: SendFailureCode;
  /** پیامِ فارسیِ قابل‌اقدام برای ادمین. */
  message: string;
  /** اگر گروه ارتقا یافته باشد، آی‌دیِ جدید. */
  suggestedChatId?: string;
};

/** خطای خامِ تلگرام → علتِ قابل‌فهم + کاری که ادمین باید بکند. */
export function explainSendFailure(
  description: string | undefined,
  target: "group" | "admin",
  migrateTo?: number | string,
): SendFailure {
  const d = String(description ?? "").toLowerCase();

  if (migrateTo || d.includes("upgraded to a supergroup"))
    return {
      code: "migrated",
      message: "این گروه به سوپرگروه ارتقا یافته و آی‌دی‌اش عوض شده است.",
      suggestedChatId: migrateTo ? String(migrateTo) : undefined,
    };
  if (d === "timeout")
    return { code: "timeout", message: "تلگرام به‌موقع جواب نداد؛ چند لحظه بعد دوباره تست کنید." };
  if (d.includes("too many requests"))
    return { code: "rate_limited", message: "تلگرام موقتاً محدود کرده؛ کمی بعد دوباره تست کنید." };
  if (d.includes("kicked") || d.includes("not a member"))
    return { code: "bot_kicked", message: "بات داخل این گروه عضو نیست (یا از آن حذف شده). بات را دوباره به گروه اضافه کنید." };
  if (d.includes("can't initiate conversation") || d.includes("blocked by the user"))
    return {
      code: "user_not_started",
      message: "این ادمین هنوز بات را استارت نکرده (یا بلاکش کرده). باید یک‌بار در تلگرام /start بزند.",
    };
  if (d.includes("deactivated"))
    return { code: "user_deactivated", message: "حساب تلگرامِ این ادمین غیرفعال یا حذف شده است." };
  if (d.includes("no rights") || d.includes("not enough rights") || d.includes("write_forbidden") || d.includes("can't send"))
    return {
      code: "no_rights",
      message: "بات اجازه‌ی ارسال پیام در این گروه را ندارد. بات را ادمین کنید یا محدودیتِ ارسال را بردارید.",
    };
  if (d.includes("chat not found") || d.includes("user not found") || d.includes("peer_id_invalid"))
    return {
      code: "chat_not_found",
      message:
        target === "group"
          ? "تلگرام این گروه را پیدا نکرد: آی‌دی اشتباه است یا بات داخل گروه نیست. آی‌دیِ سوپرگروه با -100 شروع می‌شود."
          : "تلگرام این کاربر را پیدا نکرد: آی‌دی اشتباه است یا هنوز بات را استارت نکرده.",
    };
  return { code: "unknown", message: `تلگرام پیام را نپذیرفت${description ? ` (${description})` : ""}.` };
}

// ─── بررسیِ گروه (موقعِ ذخیره) ──────────────────────────────────────────────

export type OrderGroupProbe = {
  /** `ok` = بات گروه را می‌بیند و می‌تواند پیام بفرستد؛ `problem` = قطعاً کار نمی‌کند؛ `unknown` = نشد بررسی کرد. */
  status: "ok" | "problem" | "unknown";
  /** آی‌دیِ عددیِ تأییدشده (ممکن است با ورودیِ کاربر فرق کند: `-100` اضافه شده). */
  chatId: string | null;
  title: string;
  type: string;
  message: string;
  code?: SendFailureCode | "not_admin" | "no_token" | "bad_status";
};

export async function probeOrderGroup(token: string, raw: string): Promise<OrderGroupProbe> {
  const candidates = orderGroupCandidates(raw);
  if (!candidates.length) return { status: "unknown", chatId: null, title: "", type: "", message: "" };
  if (!token)
    return {
      status: "unknown",
      chatId: null,
      title: "",
      type: "",
      message: "توکن بات روی سرور در دسترس نیست، پس نمی‌توان گروه را بررسی کرد.",
      code: "no_token",
    };

  let chat: { id: number; title?: string; type?: string } | null = null;
  let firstFailure: SendFailure | null = null;
  let sawTimeout = false;
  for (const cand of candidates) {
    const res = await tg(token, "getChat", { chat_id: cand });
    if (res.ok && res.result?.id) {
      chat = res.result;
      break;
    }
    if (res.description === "timeout") sawTimeout = true;
    firstFailure ??= explainSendFailure(res.description, "group", res.parameters?.migrate_to_chat_id);
  }

  if (!chat) {
    if (sawTimeout && firstFailure?.code === "timeout")
      return { status: "unknown", chatId: null, title: "", type: "", message: firstFailure.message, code: "timeout" };
    return {
      status: "problem",
      chatId: null,
      title: "",
      type: "",
      message: firstFailure?.message ?? "گروه پیدا نشد.",
      code: firstFailure?.code ?? "chat_not_found",
    };
  }

  const chatId = String(chat.id);
  const base = { chatId, title: chat.title ?? "", type: chat.type ?? "" };

  const me = await tg(token, "getMe");
  if (!me.ok || !me.result?.id)
    return { status: "unknown", ...base, message: "گروه پیدا شد ولی وضعیتِ عضویتِ بات قابل بررسی نبود." };

  const member = await tg(token, "getChatMember", { chat_id: chatId, user_id: me.result.id });
  if (!member.ok)
    return {
      status: "problem",
      ...base,
      message: "بات داخل این گروه عضو نیست. بات را به گروه اضافه کنید (و بهتر است ادمین کنید).",
      code: "bot_kicked",
    };

  const st = String(member.result?.status ?? "");
  if (st === "left" || st === "kicked")
    return {
      status: "problem",
      ...base,
      message: "بات از این گروه خارج یا حذف شده است. دوباره اضافه‌اش کنید.",
      code: "bot_kicked",
    };
  if (base.type === "channel" && !(st === "administrator" || st === "creator"))
    return {
      status: "problem",
      ...base,
      message: "این یک کانال است و بات باید در آن ادمین (با اجازه‌ی ارسال پیام) باشد.",
      code: "not_admin",
    };
  if (st === "restricted" && member.result?.can_send_messages === false)
    return {
      status: "problem",
      ...base,
      message: "بات در این گروه محدود شده و نمی‌تواند پیام بفرستد.",
      code: "no_rights",
    };
  if (st === "administrator" && base.type === "channel" && member.result?.can_post_messages === false)
    return {
      status: "problem",
      ...base,
      message: "بات در این کانال ادمین است ولی اجازه‌ی ارسال پیام ندارد.",
      code: "no_rights",
    };

  return { status: "ok", ...base, message: "بات در این گروه هست و می‌تواند پیام بفرستد." };
}

// ─── تستِ ارسال (دکمه‌ی «پیام آزمایشی») ─────────────────────────────────────

export type DeliveryTarget = {
  target: "group" | "admin";
  /** chat_id گروه یا user_id ادمین. */
  id: string;
  label: string;
  ok: boolean;
  code?: SendFailureCode | "not_configured";
  message?: string;
  suggestedChatId?: string;
};

const TEST_TEXT_GROUP =
  "✅ پیام آزمایشی / Test message\n\nاگر این پیام را در این گروه می‌بینید، رسید و مشخصاتِ سفارش‌ها به همین‌جا ارسال می‌شود.";
const TEST_TEXT_ADMIN =
  "✅ پیام آزمایشی / Test message\n\nاگر این پیام را می‌بینید، اعلانِ رسید و سفارش‌های جدید برای شما ارسال می‌شود.";

export async function sendDeliveryTest(token: string, target: "group" | "admin", id: string, label: string): Promise<DeliveryTarget> {
  const res = await tg(token, "sendMessage", {
    chat_id: id,
    text: target === "group" ? TEST_TEXT_GROUP : TEST_TEXT_ADMIN,
  });
  if (res.ok) return { target, id, label, ok: true };
  const f = explainSendFailure(res.description, target, res.parameters?.migrate_to_chat_id);
  return { target, id, label, ok: false, code: f.code, message: f.message, suggestedChatId: f.suggestedChatId };
}
