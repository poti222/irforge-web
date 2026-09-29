/**
 * lib/paymentEvents.ts — لاگِ تفصیلیِ ماژولِ کارت‌به‌کارت برایِ سوپرادمین
 * (IRFORGE_CARD_AUTOCONFIRM_PROMPT، فاز ۹).
 *
 * چه ثبت می‌شود: ورودِ پیامک، نتیجه‌ی parse، match/ابهام/بدونِ کاندید، تأیید (خودکار/دستی)، رد، انقضا،
 * ارتقایِ صف، خطای effect، sweeper، مهاجرت، تغییراتِ کانال.
 *
 * قواعدِ امنیتی (اجباری، نه سلیقه‌ای):
 *  - **هرگز متنِ خامِ پیامک** در این جدول نیست — فقط جهت/مبلغ/وضعیت/فرستنده‌ی نرمال‌شده. (متنِ پیامکِ
 *    فرستنده‌ی مجاز در `sms_inbox` است و فقط با ماسکِ ارقامِ بلند به ادمین نشان داده می‌شود.)
 *  - **هرگز شماره‌کارتِ کامل** — کلیدهای حساس حذف و هر رشته‌ی ۱۳–۱۹ رقمی به `6037-****-****-1234` ماسک می‌شود.
 *  - secret/token هرگز.
 *  - ثبت **best-effort** است: خطای دیتابیس فقط لاگ می‌شود و هرگز جریانِ پرداخت را نمی‌شکند؛ و
 *    **هرگز داخلِ تراکنشِ باز** صدا زده نمی‌شود (روی pool، بعد از commit).
 */
import crypto from "crypto";
import { logger } from "./logger";
import { digitsOnly, maskCardNumber } from "./cardMask";
import type { PoolLike } from "./paymentRequests";

export type EventLevel = "info" | "warn" | "error";

export interface PaymentEventInput {
  level?: EventLevel;
  kind: string;
  scope?: "platform" | "bot" | null;
  botId?: string | null;
  channelId?: string | null;
  requestId?: string | null;
  smsId?: string | null;
  /** system | sms | admin:<id> | user:<id> */
  actor?: string | null;
  message?: string;
  data?: Record<string, unknown>;
  /** زمانِ رویداد؛ پیش‌فرض ساعتِ دیتابیس. (sweeper `now`ِ خودش را می‌دهد تا dedupe با همان ساعت سنجیده شود.) */
  at?: Date;
}

export interface PaymentEventRow {
  id: string;
  at: Date;
  level: EventLevel;
  kind: string;
  scope: string | null;
  botId: string | null;
  channelId: string | null;
  requestId: string | null;
  smsId: string | null;
  actor: string | null;
  message: string;
  data: Record<string, unknown>;
}

/** روزهایی که لاگ نگه داشته می‌شود (sweeper بعدش پاک می‌کند). */
export const EVENT_RETENTION_DAYS = 90;
export const MAX_EVENT_MESSAGE = 300;
const MAX_DATA_JSON = 2000;

const FORBIDDEN_KEYS = /^(text|rawtext|raw_text|raw|body|sms|content|card|cardnumber|card_number|pan|secret|smssecret|sms_secret|token|password|authorization)$/i;

/** هر رشته‌ی ۱۳–۱۹ رقمیِ پیوسته (با یا بدونِ فاصله/خط‌تیره) شبیهِ شماره‌کارت است → ماسک. */
export function maskCardLike(text: string): string {
  return String(text).replace(/(?:\d[ -]?){12,18}\d/g, (m) => {
    const d = digitsOnly(m);
    return d.length === 16 ? maskCardNumber(d) : `${d.slice(0, 2)}${"*".repeat(Math.max(0, d.length - 4))}${d.slice(-2)}`;
  });
}

function sanitizeValue(v: unknown, depth: number): unknown {
  if (v === null || v === undefined) return v ?? null;
  if (typeof v === "string") return maskCardLike(v).slice(0, 300);
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (v instanceof Date) return v.toISOString();
  if (depth >= 3) return "[…]";
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => sanitizeValue(x, depth + 1));
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (FORBIDDEN_KEYS.test(k)) continue;
      out[k] = sanitizeValue(val, depth + 1);
    }
    return out;
  }
  return String(v).slice(0, 100);
}

export function sanitizeEventData(data: Record<string, unknown> | undefined): Record<string, unknown> {
  const clean = sanitizeValue(data ?? {}, 0) as Record<string, unknown>;
  const json = JSON.stringify(clean);
  return json.length > MAX_DATA_JSON ? { truncated: true } : clean;
}

/** ثبتِ یک رویداد. **هرگز throw نمی‌کند.** */
export async function logPaymentEvent(pool: PoolLike, ev: PaymentEventInput): Promise<void> {
  try {
    const c = await pool.connect();
    try {
      await c.query(
        `INSERT INTO payment_events (id, level, kind, scope, bot_id, channel_id, request_id, sms_id, actor, message, data, at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb, COALESCE($12::timestamptz, NOW()))`,
        [
          `pev_${crypto.randomBytes(9).toString("hex")}`, ev.level ?? "info", ev.kind.slice(0, 60), ev.scope ?? null,
          ev.botId ?? null, ev.channelId ?? null, ev.requestId ?? null, ev.smsId ?? null, ev.actor ?? null,
          maskCardLike(ev.message ?? "").slice(0, MAX_EVENT_MESSAGE), JSON.stringify(sanitizeEventData(ev.data)),
          ev.at ?? null,
        ],
      );
    } finally {
      c.release();
    }
  } catch (err) {
    logger.warn({ err, kind: ev.kind }, "payment event log failed (non-fatal)");
  }
}

export interface EventFilter {
  level?: EventLevel | "problems";
  kind?: string;
  scope?: "platform" | "bot";
  botId?: string;
  channelId?: string;
  requestId?: string;
  before?: Date;
  limit?: number;
}

const rowToEvent = (r: any): PaymentEventRow => ({
  id: r.id, at: r.at, level: r.level, kind: r.kind, scope: r.scope, botId: r.bot_id, channelId: r.channel_id,
  requestId: r.request_id, smsId: r.sms_id, actor: r.actor, message: r.message, data: r.data ?? {},
});

export async function listPaymentEvents(pool: PoolLike, f: EventFilter = {}): Promise<PaymentEventRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, v: unknown) => { params.push(v); where.push(sql.replace("?", `$${params.length}`)); };
  if (f.level === "problems") where.push("level <> 'info'");
  else if (f.level) add("level = ?", f.level);
  if (f.kind) add("kind = ?", f.kind);
  if (f.scope) add("scope = ?", f.scope);
  if (f.botId) add("bot_id = ?", f.botId);
  if (f.channelId) add("channel_id = ?", f.channelId);
  if (f.requestId) add("request_id = ?", f.requestId);
  if (f.before) add("at < ?", f.before);
  params.push(Math.min(Math.max(Math.trunc(f.limit ?? 100), 1), 500));
  const c = await pool.connect();
  try {
    const { rows } = await c.query(
      `SELECT * FROM payment_events ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY at DESC, id DESC LIMIT $${params.length}`,
      params,
    );
    return rows.map(rowToEvent);
  } finally {
    c.release();
  }
}

export async function purgeOldEvents(pool: PoolLike, now = new Date(), days = EVENT_RETENTION_DAYS): Promise<number> {
  const c = await pool.connect();
  try {
    const { rowCount } = await c.query("DELETE FROM payment_events WHERE at < $1", [new Date(now.getTime() - days * 86_400_000)]);
    return rowCount ?? 0;
  } finally {
    c.release();
  }
}

/** آخرین رویدادِ یک نوع برایِ یک کانال — برایِ dedupe اعلان‌ها (مثلاً «گوشی ساکت است»). */
export async function lastEventAt(pool: PoolLike, kind: string, channelId: string): Promise<Date | null> {
  const c = await pool.connect();
  try {
    const { rows } = await c.query(
      "SELECT MAX(at) AS at FROM payment_events WHERE kind = $1 AND channel_id = $2", [kind, channelId]);
    return rows[0]?.at ?? null;
  } finally {
    c.release();
  }
}
