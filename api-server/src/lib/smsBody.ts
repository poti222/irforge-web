/**
 * lib/smsBody.ts — رمزگشاییِ بدنه‌ی وبهوکِ پیامک (IRFORGE_CARD_AUTOCONFIRM_PROMPT، فاز ۳ — سخت‌گیریِ بعد از استقرار).
 *
 * چرا: پیامکِ بانک **چندخطی** است («بلو⏎واریز پول⏎…⏎۲۱:۱۱⏎۱۴۰۵.۰۷.۰۷»). MacroDroid متنِ پیامک (`{sms_message}`) را
 * عیناً در بدنه می‌گذارد و خط‌جدیدها را escape نمی‌کند؛ اگر بدنه JSON باشد، `express.json()` روی خط‌جدیدِ خام
 * «entity.parse.failed» می‌دهد و پیامک گم می‌شود. پس این‌جا:
 *   ۱. JSONِ دارایِ کاراکترِ کنترلیِ خام داخلِ رشته‌ها **ترمیم** می‌شود (فقط همین یک عیب؛ چیزِ دیگری حدس زده نمی‌شود)؛
 *   ۲. بدنه‌ی `text/plain` (فقط خودِ متنِ پیامک) هم فرستنده و زمان را از هدر/query می‌گیرد
 *      (`X-Sms-Sender`، `X-Sms-Time`، `?sender=`، `?time=`) — ساده‌ترین و بی‌خطاترین تنظیمِ ماکرو؛
 *   ۳. نامِ فیلدهای معادل (text|message|body|sms|content، sender|from|address|number، time|timestamp|received_at|date)
 *      مثل قبل پذیرفته می‌شود.
 * بدنه‌ی نامعتبر که ترمیم هم نشود → خطای صریح `bad_body` (۴۰۰)، نه پذیرشِ ساکتِ چیزِ اشتباه.
 */
import { SmsIngestError } from "./smsIngest";

/** آدرس‌هایی که parserِ سراسریِ JSON/urlencoded نباید رویشان اجرا شود (خودِ route بدنه را می‌خواند). */
const RAW_SMS_PATH = /^\/api\/(?:payments\/sms\/[A-Za-z0-9_-]{1,64}|internal\/wallet-topup\/sms-webhook)\/?$/;
export function isRawSmsPath(method: string, path: string): boolean {
  return method === "POST" && RAW_SMS_PATH.test(path);
}

/** داخلِ رشته‌های JSON، کاراکترهای کنترلیِ خام (خط‌جدید/تب/…) را escape می‌کند؛ بیرونِ رشته‌ها دست‌نخورده. */
export function repairJsonControlChars(raw: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (const ch of raw) {
    if (inString) {
      if (escaped) { out += ch; escaped = false; continue; }
      if (ch === "\\") { out += ch; escaped = true; continue; }
      if (ch === '"') { out += ch; inString = false; continue; }
      const code = ch.codePointAt(0)!;
      if (code < 0x20) {
        out += ch === "\n" ? "\\n" : ch === "\r" ? "\\r" : ch === "\t" ? "\\t" : `\\u${code.toString(16).padStart(4, "0")}`;
        continue;
      }
      out += ch;
    } else {
      if (ch === '"') inString = true;
      out += ch;
    }
  }
  return out;
}

export interface DecodedSmsBody { text: unknown; sender: unknown; time: unknown }

export interface DecodeInput {
  /** `req.body`: رشته (خامِ خوانده‌شده)، یا شیئی که یک parserِ بالادستی قبلاً ساخته. */
  body: unknown;
  contentType?: string;
  query?: Record<string, unknown>;
  header?: (name: string) => string | undefined;
}

const TEXT_KEYS = ["text", "message", "body", "sms", "content"];
const SENDER_KEYS = ["sender", "from", "address", "number"];
const TIME_KEYS = ["time", "timestamp", "received_at", "date"];

function pick(obj: unknown, keys: string[]): unknown {
  if (!obj || typeof obj !== "object") return undefined;
  for (const k of keys) {
    const v = (obj as Record<string, unknown>)[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

const firstString = (v: unknown): string | undefined => {
  const x = Array.isArray(v) ? v[0] : v;
  return typeof x === "string" && x.trim() !== "" ? x : undefined;
};

function parseJsonLenient(raw: string): unknown {
  try { return JSON.parse(raw); } catch { /* ترمیم */ }
  try { return JSON.parse(repairJsonControlChars(raw)); } catch {
    throw new SmsIngestError(
      "بدنه JSON معتبر نیست (احتمالاً متنِ پیامک علامتِ \" دارد). در ماکرو بدنه را text/plain بگذارید و فقط {sms_message} را بفرستید.",
      "bad_body",
    );
  }
}

export function decodeSmsBody(input: DecodeInput): DecodedSmsBody {
  const ct = (input.contentType ?? "").toLowerCase();
  const b = input.body;
  let parsed: unknown;

  if (typeof b === "string") {
    const trimmed = b.trimStart();
    if (ct.includes("json") || trimmed.startsWith("{")) {
      parsed = parseJsonLenient(b);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new SmsIngestError("بدنه‌ی JSON باید یک شیء باشد.", "bad_body");
      }
    } else if (ct.includes("x-www-form-urlencoded")) {
      parsed = Object.fromEntries(new URLSearchParams(b));
    } else {
      parsed = undefined; // text/plain: خودِ بدنه = متنِ پیامک
    }
  } else if (b && typeof b === "object") {
    parsed = b; // parserِ بالادستی (مثلاً تست‌ها یا مسیرهایِ قدیمی) قبلاً ساخته
  }

  const text = typeof b === "string" && parsed === undefined ? b : pick(parsed, TEXT_KEYS);
  const q = input.query ?? {};
  const sender = pick(parsed, SENDER_KEYS) ?? input.header?.("x-sms-sender") ?? firstString(q.sender) ?? firstString(q.from);
  const time = pick(parsed, TIME_KEYS) ?? input.header?.("x-sms-time") ?? firstString(q.time) ?? firstString(q.timestamp);
  return { text, sender, time };
}
