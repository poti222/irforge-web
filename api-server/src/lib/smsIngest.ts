/**
 * lib/smsIngest.ts — ورودِ یک پیامکِ بانکی به `sms_inbox`
 * (IRFORGE_CARD_AUTOCONFIRM_PROMPT، فاز ۳). تطبیق با درخواست‌ها **فاز ۴** است؛
 * اینجا فقط: احراز هویتِ کانال، فیلترِ فرستنده، پارس، و ذخیره‌ی idempotent.
 *
 *  - فرستنده‌ی غیرمجاز (`sender_allowlist` غیرخالی و فرستنده در آن نیست) → ردیف با
 *    `status='ignored'`؛ **متنِ آن ذخیره نمی‌شود** (گوشیِ صاحبِ کارت ممکن است هر
 *    پیامکِ شخصیِ دیگری را هم forward کند — حریمِ خصوصیِ او را نگه نمی‌داریم).
 *    allowlistِ خالی یعنی «همه‌ی فرستنده‌ها» (و فقط قالبِ پارسر تعیین‌کننده است).
 *  - برداشت → `ignored` (چیزی برایِ تطبیق نیست؛ CHECKِ دیتابیس هم اجازه‌ی matchِ
 *    آن را نمی‌دهد). پیامکِ نامفهوم/مبهم → `unmatched` با `parsed_ok=false` تا
 *    برایِ رسیدگیِ دستی دیده شود، ولی فازِ ۴ فقط `parsed_ok ∧ deposit` را match می‌کند.
 *  - idempotency: `UNIQUE(channel_id, content_hash)`؛ ارسالِ مجددِ همان پیامک
 *    ردیفِ تازه نمی‌سازد. هش شاملِ زمانِ پیامک (اگر فرستاده شده) یا یک سطلِ
 *    ۵دقیقه‌ایِ زمانِ ورود است — تا دو واریزِ واقعاً جدا با متنِ یکسان (بدونِ
 *    زمان/موجودی در متن) هرگز به‌عنوانِ تکراری گم نشوند؛ بدترین حالتِ سطل، یک
 *    ردیفِ اضافه است، نه یک پولِ گم‌شده.
 *
 * هیچ‌وقت متنِ پیامک یا secret در لاگ نمی‌آید (فقط شناسه‌ها/نتیجه).
 */
import crypto from "crypto";
import type { ClientLike, PoolLike } from "./paymentRequests";
import { getSmsParser, normalizeSmsText, UNPARSED, type ParsedSms } from "./smsParsers";
import { verifySmsSecret } from "./smsChannelSecret";

export const MAX_SMS_TEXT = 2000;
export const HASH_BUCKET_MS = 5 * 60 * 1000;
const MAX_PAST_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_FUTURE_MS = 10 * 60 * 1000;
export const IGNORED_TEXT_PLACEHOLDER = "[متنِ پیامک ذخیره نشد — فرستنده مجاز نیست]";

export interface SmsChannelRow {
  id: string;
  scope: "platform" | "bot";
  botId: string | null;
  active: boolean;
  senderAllowlist: string[];
  bankParser: string;
}

export interface SmsPayload {
  text: unknown;
  sender?: unknown;
  time?: unknown;
}

export interface IngestResult {
  inserted: boolean;
  id: string;
  status: "unmatched" | "ignored";
  direction: ParsedSms["direction"];
  parsedOk: boolean;
  amountRial: number | null;
  receivedAt: Date;
}

export class SmsIngestError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
  }
}

/** شماره‌ها را به شکلِ یکسان (بدونِ +98/0098/0 ابتدایی) و نام‌ها را lower-case می‌کند. */
export function canonSender(raw: unknown): string {
  const s = normalizeSmsText(String(raw ?? "")).toLowerCase().replace(/\s+/g, "");
  if (/^\+?\d[\d-]*$/.test(s)) {
    return s.replace(/\D/g, "").replace(/^(0098|98|0)/, "");
  }
  return s;
}

export function senderAllowed(allowlist: readonly string[], sender: unknown): boolean {
  if (allowlist.length === 0) return true;
  const c = canonSender(sender);
  return c !== "" && allowlist.some((a) => canonSender(a) === c);
}

/** زمانِ پیامک: ISO یا epoch (ثانیه/میلی‌ثانیه). خارج از [−۷روز, +۱۰دقیقه] → null (نامعتبر). */
export function parseSmsTime(input: unknown, now: Date): Date | null {
  if (input === undefined || input === null || input === "") return null;
  let ms: number;
  const asNum = typeof input === "number" ? input : /^\d{9,13}$/.test(String(input).trim()) ? Number(String(input).trim()) : NaN;
  if (Number.isFinite(asNum)) ms = asNum >= 1e12 ? asNum : asNum * 1000;
  else ms = Date.parse(String(input));
  if (!Number.isFinite(ms)) return null;
  if (ms < now.getTime() - MAX_PAST_MS || ms > now.getTime() + MAX_FUTURE_MS) return null;
  return new Date(ms);
}

export function smsContentHash(channelId: string, normalizedText: string, sender: unknown, provided: Date | null, now: Date): string {
  const timeKey = provided ? `t:${provided.toISOString()}` : `b:${Math.floor(now.getTime() / HASH_BUCKET_MS)}`;
  return crypto.createHash("sha256")
    .update([channelId, normalizedText, canonSender(sender), timeKey].join("\n"), "utf8")
    .digest("hex");
}

async function withClient<T>(pool: PoolLike, fn: (c: ClientLike) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try { return await fn(c); } finally { c.release(); }
}

/**
 * کانال را می‌خواند و secret را constant-time می‌سنجد. `null` = ناموفق، چه کانال
 * وجود نداشته باشد چه secret غلط باشد (فراخواننده هر دو را با یک پاسخ برمی‌گرداند).
 */
export async function authenticateChannel(pool: PoolLike, channelId: string, secret: string): Promise<SmsChannelRow | null> {
  const row = await withClient(pool, async (c) => {
    const { rows } = await c.query(
      `SELECT id, scope, bot_id, active, sender_allowlist, bank_parser, sms_secret_hash
         FROM payment_channels WHERE id = $1`, [channelId]);
    return rows[0] ?? null;
  });
  const ok = verifySmsSecret(secret, row?.sms_secret_hash);
  if (!row || !ok) return null;
  return {
    id: row.id,
    scope: row.scope,
    botId: row.bot_id,
    active: row.active,
    senderAllowlist: row.sender_allowlist ?? [],
    bankParser: row.bank_parser,
  };
}

export async function ingestSms(
  pool: PoolLike,
  channel: SmsChannelRow,
  payload: SmsPayload,
  now: Date = new Date(),
): Promise<IngestResult> {
  const text = String(payload.text ?? "").slice(0, MAX_SMS_TEXT).trim();
  if (!text) throw new SmsIngestError("text لازم است", "empty_text");
  const sender = payload.sender === undefined || payload.sender === null ? null : String(payload.sender).slice(0, 120);

  const provided = parseSmsTime(payload.time, now);
  const receivedAt = provided ?? now;
  const allowed = senderAllowed(channel.senderAllowlist, sender);
  const hash = smsContentHash(channel.id, normalizeSmsText(text), sender, provided, now);

  const parsed: ParsedSms = allowed ? getSmsParser(channel.bankParser)(text) : UNPARSED;
  const status: IngestResult["status"] = !allowed || parsed.direction === "withdraw" ? "ignored" : "unmatched";
  const id = `sms_${crypto.randomBytes(9).toString("hex")}`;

  return withClient(pool, async (c) => {
    const { rows } = await c.query(
      `INSERT INTO sms_inbox
         (id, channel_id, raw_text, sender, received_at, content_hash, direction, amount_rial, balance_rial, parsed_ok, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::bigint,$9::bigint,$10,$11)
       ON CONFLICT (channel_id, content_hash) DO NOTHING
       RETURNING id`,
      [id, channel.id, allowed ? text : IGNORED_TEXT_PLACEHOLDER, sender, receivedAt, hash,
        parsed.direction, parsed.amountRial, parsed.balanceRial, parsed.parsedOk, status],
    );
    // سلامتِ اتصالِ گوشی: هر پستِ احرازشده (حتی تکراری/ignored) نشانه‌ی زنده‌بودنِ آن است.
    await c.query(
      `UPDATE payment_channels SET last_sms_at = GREATEST(COALESCE(last_sms_at, $2), $2) WHERE id = $1`,
      [channel.id, now],
    );
    return {
      inserted: rows.length === 1,
      id: rows[0]?.id ?? "",
      status,
      direction: parsed.direction,
      parsedOk: parsed.parsedOk,
      amountRial: parsed.amountRial,
      receivedAt,
    };
  });
}
