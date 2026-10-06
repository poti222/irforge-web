/**
 * lib/paymentChannelAdmin.ts — مدیریتِ کانال‌های پرداختِ یک بات توسطِ فروشنده
 * (IRFORGE_CARD_AUTOCONFIRM_PROMPT، فاز ۷).
 *
 * همه‌ی توابع فقط با `botId` ی که **route از روی مالکیتِ بات** (`resolveBotSheet`) داده کار می‌کنند و
 * همه‌ی queryها `scope='bot' AND bot_id=$botId` دارند؛ کانالِ باتِ دیگر «پیدا نشد» است.
 *
 *  - شماره‌کارت AES-256-GCM (`tokenCrypto`)؛ هرگز plaintext ذخیره یا برگردانده نمی‌شود (فقط ماسک).
 *  - secretِ وبهوک `irfsms_…` است، **فقط هشِ آن** ذخیره می‌شود و فقط هنگامِ ساخت/چرخش یک‌بار برگردانده
 *    می‌شود. چرخش، سایرِ تنظیمات را دست نمی‌زند و secretِ قدیمی همان لحظه از کار می‌افتد.
 *  - تغییرِ مقصدِ پرداخت (کارت/لینک/نوع) یا غیرفعال‌کردن/حذف **وقتی درخواستِ فعال هست** ممنوع است
 *    (کاربری که مبلغ/کارت را دیده نباید وسطِ پرداخت مقصدش عوض شود). این چک زیرِ lockِ کانال انجام می‌شود
 *    تا با ساختِ هم‌زمانِ درخواست race نکند.
 *  - «پیامک آزمایشی»: پیامکِ ساختگی از همان پارسرِ کانال رد می‌شود و با status=`ignored` ذخیره می‌شود
 *    (هرگز match نمی‌شود، `last_sms_at` را هم جلو نمی‌برد تا «گوشی متصل است» را جعل نکند).
 */
import crypto from "crypto";
import { decryptToken, encryptToken } from "./tokenCrypto";
import { digitsOnly, isValidCardNumber, maskCardNumber } from "./cardMask";
import { generateSmsSecret, hashSmsSecret } from "./smsChannelSecret";
import { canonSender } from "./smsIngest";
import { getSmsParser, KNOWN_SMS_PARSERS } from "./smsParsers";
import { withChannelLock, type ClientLike, type PoolLike } from "./paymentRequests";

export const CHANNEL_KINDS = ["card_manual", "fixed_link", "open_link"] as const;
export type ChannelKind = (typeof CHANNEL_KINDS)[number];
export const DEFAULT_MIN_TOMAN = 100_000;
export const MIN_MIN_TOMAN = 10_000;
export const MAX_MIN_TOMAN = 100_000_000;
export const MAX_ALLOWLIST = 10;
/** سقفِ «توضیحات» (متنِ آزادِ فروشنده کنارِ کارت). */
export const MAX_DESCRIPTION = 300;
/** بیش از این ساعت بدونِ هیچ پیامکِ احرازشده → «گوشی متصل نیست؟». */
export const SMS_STALE_HOURS = 12;
export const SMS_LOG_LIMIT = 50;

/** مالکِ کانال: یک بات (فروشنده) یا خودِ پلتفرم (سوپرادمین، فاز ۸). فقط route آن را از احرازِ هویت می‌سازد، نه از ورودی. */
export type ChannelOwner = { scope: "platform" } | { scope: "bot"; botId: string };
export const PLATFORM_OWNER: ChannelOwner = { scope: "platform" };
/** سقفِ کانال برایِ پلتفرم (برایِ هر بات از `paymentProGate`). */
export const PLATFORM_MAX_CHANNELS = 5;

const ownerBot = (o: ChannelOwner): string | null => (o.scope === "bot" ? o.botId : null);
const ownerKey = (o: ChannelOwner): string => (o.scope === "bot" ? o.botId : "platform");

export class ChannelAdminError extends Error {
  constructor(message: string, readonly code: string, readonly status = 400) {
    super(message);
  }
}

export interface ChannelInput {
  kind?: unknown;
  cardNumber?: unknown;
  holderName?: unknown;
  bankName?: unknown;
  description?: unknown;
  paymentUrl?: unknown;
  minAmountToman?: unknown;
  senderAllowlist?: unknown;
  bankParser?: unknown;
  active?: unknown;
}

export interface ChannelFields {
  kind: ChannelKind;
  cardNumber: string | null;
  holderName: string | null;
  bankName: string | null;
  description: string | null;
  paymentUrl: string | null;
  minAmountRial: number;
  senderAllowlist: string[];
  bankParser: string;
  active: boolean;
}

export interface ChannelView {
  id: string;
  kind: ChannelKind;
  cardMasked: string | null;
  holderName: string | null;
  bankName: string | null;
  description: string | null;
  paymentUrl: string | null;
  minAmountToman: number;
  senderAllowlist: string[];
  bankParser: string;
  active: boolean;
  lastSmsAt: Date | null;
  health: ChannelHealth;
  activeRequests: number;
  webhookUrl: string;
  createdAt: Date;
}

export type ChannelHealth =
  | { status: "never"; lastSmsAt: null }
  | { status: "ok" | "stale"; lastSmsAt: Date; hoursSince: number };

// ─── اعتبارسنجی ─────────────────────────────────────────────────────────────

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

/**
 * «توضیحات»: متنِ آزادِ فروشنده (چند خط مجاز). نویسه‌های کنترلی (به‌جز خط‌جدید) حذف، خط‌های خالیِ پشت‌سرهم
 * به یکی کاهش و دو سرِ متن تمیز می‌شود؛ خالی = «بدونِ توضیحات» (null). فقط متنِ ساده است — بات آن را escape می‌کند.
 */
export function cleanDescription(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") throw new ChannelAdminError("توضیحات باید متن باشد.", "invalid_description");
  const text = v
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, "")
    .split("\n").map((l) => l.trim()).join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (text.length > MAX_DESCRIPTION) {
    throw new ChannelAdminError(`توضیحات حداکثر ${MAX_DESCRIPTION} نویسه می‌تواند باشد.`, "description_too_long");
  }
  return text || null;
}

function httpsUrl(v: unknown): string {
  const s = str(v, 500);
  try {
    const u = new URL(s);
    if (u.protocol === "https:" && u.hostname) return u.toString();
  } catch { /* fallthrough */ }
  throw new ChannelAdminError("لینکِ پرداخت باید یک آدرسِ معتبر با https باشد.", "invalid_url");
}

function allowlist(v: unknown): string[] {
  if (v === undefined || v === null) return [];
  const arr = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[\n,;]+/) : null;
  if (!arr) throw new ChannelAdminError("فهرستِ فرستنده‌های مجاز نامعتبر است.", "invalid_allowlist");
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of arr) {
    const raw = str(item, 40);
    if (!raw) continue;
    const canon = canonSender(raw);
    if (!canon || seen.has(canon)) continue;
    seen.add(canon);
    out.push(raw);
  }
  if (out.length > MAX_ALLOWLIST) throw new ChannelAdminError(`حداکثر ${MAX_ALLOWLIST} فرستنده‌ی مجاز.`, "invalid_allowlist");
  return out;
}

function minRial(v: unknown): number {
  const n = v === undefined || v === null || v === "" ? DEFAULT_MIN_TOMAN : Number(v);
  if (!Number.isSafeInteger(n) || n < MIN_MIN_TOMAN || n > MAX_MIN_TOMAN) {
    throw new ChannelAdminError(
      `حداقل مبلغ باید عددِ صحیحی بینِ ${MIN_MIN_TOMAN.toLocaleString("en-US")} تا ${MAX_MIN_TOMAN.toLocaleString("en-US")} تومان باشد.`,
      "invalid_min_amount",
    );
  }
  return n * 10;
}

/** ورودیِ کامل (ساخت). */
export function validateNewChannel(input: ChannelInput): ChannelFields {
  const kind = input.kind === undefined ? "card_manual" : input.kind;
  if (!CHANNEL_KINDS.includes(kind as ChannelKind)) throw new ChannelAdminError("نوعِ کانال نامعتبر است.", "invalid_kind");
  const parser = input.bankParser === undefined || input.bankParser === "" ? "blubank" : String(input.bankParser);
  if (!KNOWN_SMS_PARSERS.includes(parser)) throw new ChannelAdminError("قالبِ پیامکِ بانک نامعتبر است.", "invalid_parser");

  let cardNumber: string | null = null;
  let paymentUrl: string | null = null;
  let holderName: string | null = null;
  if (kind === "card_manual") {
    const digits = digitsOnly(String(input.cardNumber ?? ""));
    if (!isValidCardNumber(digits)) throw new ChannelAdminError("شماره‌کارت نامعتبر است (۱۶ رقم و معتبر).", "invalid_card");
    cardNumber = digits;
    holderName = str(input.holderName, 80);
    if (!holderName) throw new ChannelAdminError("نامِ صاحبِ کارت لازم است.", "holder_required");
  } else {
    paymentUrl = httpsUrl(input.paymentUrl);
    holderName = str(input.holderName, 80) || null;
  }
  return {
    kind: kind as ChannelKind,
    cardNumber,
    holderName,
    bankName: str(input.bankName, 60) || null,
    description: cleanDescription(input.description),
    paymentUrl,
    minAmountRial: minRial(input.minAmountToman),
    senderAllowlist: allowlist(input.senderAllowlist),
    bankParser: parser,
    active: input.active === undefined ? true : input.active === true,
  };
}

// ─── تبدیلِ ردیف به نما ─────────────────────────────────────────────────────

export function channelHealth(lastSmsAt: Date | null, now: Date, staleHours = SMS_STALE_HOURS): ChannelHealth {
  if (!lastSmsAt) return { status: "never", lastSmsAt: null };
  const hoursSince = (now.getTime() - new Date(lastSmsAt).getTime()) / 3_600_000;
  return { status: hoursSince > staleHours ? "stale" : "ok", lastSmsAt: new Date(lastSmsAt), hoursSince };
}

function safeMask(enc: string | null): string | null {
  if (!enc) return null;
  try {
    return maskCardNumber(decryptToken(enc));
  } catch {
    return "****";
  }
}

export function webhookUrlFor(channelId: string, siteUrl = process.env.PUBLIC_SITE_URL ?? ""): string {
  const base = siteUrl.trim().replace(/\/+$/, "");
  return `${base}/api/payments/sms/${channelId}`;
}

function toView(r: any, activeRequests: number, now: Date): ChannelView {
  return {
    id: r.id,
    kind: r.kind,
    cardMasked: safeMask(r.card_number_enc),
    holderName: r.holder_name ?? null,
    bankName: r.bank_name ?? null,
    description: r.description ?? null,
    paymentUrl: r.payment_url ?? null,
    minAmountToman: Math.round(Number(r.min_amount_rial) / 10),
    senderAllowlist: r.sender_allowlist ?? [],
    bankParser: r.bank_parser,
    active: Boolean(r.active),
    lastSmsAt: r.last_sms_at ?? null,
    health: channelHealth(r.last_sms_at ?? null, now),
    activeRequests,
    webhookUrl: webhookUrlFor(r.id),
    createdAt: r.created_at,
  };
}

async function withClient<T>(pool: PoolLike, fn: (c: ClientLike) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try { return await fn(c); } finally { c.release(); }
}

const ACTIVE = ["queued", "pending", "awaiting_review"];

async function activeCount(c: ClientLike, channelId: string): Promise<number> {
  const { rows } = await c.query(
    "SELECT COUNT(*)::int AS n FROM payment_requests WHERE channel_id = $1 AND status = ANY($2::text[])",
    [channelId, ACTIVE]);
  return rows[0].n;
}

async function loadOwned(c: ClientLike, owner: ChannelOwner, channelId: string): Promise<any> {
  const { rows } = await c.query(
    "SELECT * FROM payment_channels WHERE id = $1 AND scope = $2 AND bot_id IS NOT DISTINCT FROM $3::text",
    [channelId, owner.scope, ownerBot(owner)]);
  if (!rows[0]) throw new ChannelAdminError("کانال پیدا نشد.", "not_found", 404);
  return rows[0];
}

// ─── عملیات ─────────────────────────────────────────────────────────────────

export async function listChannels(pool: PoolLike, owner: ChannelOwner, now = new Date()): Promise<ChannelView[]> {
  return withClient(pool, async (c) => {
    const { rows } = await c.query(
      "SELECT * FROM payment_channels WHERE scope = $1 AND bot_id IS NOT DISTINCT FROM $2::text ORDER BY created_at, id",
      [owner.scope, ownerBot(owner)]);
    const out: ChannelView[] = [];
    for (const r of rows) out.push(toView(r, await activeCount(c, r.id), now));
    return out;
  });
}

export async function getChannel(pool: PoolLike, owner: ChannelOwner, channelId: string, now = new Date()): Promise<ChannelView> {
  return withClient(pool, async (c) => {
    const r = await loadOwned(c, owner, channelId);
    return toView(r, await activeCount(c, r.id), now);
  });
}

/** ساختِ کانال. secret **فقط همین‌جا** برگردانده می‌شود. */
export async function createChannel(
  pool: PoolLike, input: { owner: ChannelOwner; fields: ChannelFields; maxChannels: number; now?: Date },
): Promise<{ channel: ChannelView; smsSecret: string }> {
  const { owner, fields } = input;
  const now = input.now ?? new Date();
  const id = `pch_${crypto.randomBytes(9).toString("hex")}`;
  const secret = generateSmsSecret();
  return withClient(pool, async (c) => {
    // شمارشِ ظرفیت و درج زیرِ یک قفلِ per-bot تا دو ساختِ هم‌زمان از سقف رد نشوند.
    await c.query("BEGIN");
    try {
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`paychan:${ownerKey(owner)}`]);
      const { rows: cnt } = await c.query(
        "SELECT COUNT(*)::int AS n FROM payment_channels WHERE scope = $1 AND bot_id IS NOT DISTINCT FROM $2::text",
        [owner.scope, ownerBot(owner)]);
      if (cnt[0].n >= input.maxChannels) {
        throw new ChannelAdminError(
          `حداکثر ${input.maxChannels} کانال ${owner.scope === "bot" ? "برایِ هر بات" : "برایِ پلتفرم"} مجاز است.`, "channel_limit", 409);
      }
      const { rows } = await c.query(
        `INSERT INTO payment_channels
           (id, scope, bot_id, kind, card_number_enc, holder_name, bank_name, description, payment_url, sms_secret_hash,
            sender_allowlist, bank_parser, min_amount_rial, active, created_at)
         VALUES ($1,$14,$2,$3,$4,$5,$6,$15,$7,$8,$9::text[],$10,$11::bigint,$12,$13)
         RETURNING *`,
        [id, ownerBot(owner), fields.kind, fields.cardNumber ? encryptToken(fields.cardNumber) : null, fields.holderName,
          fields.bankName, fields.paymentUrl, hashSmsSecret(secret), fields.senderAllowlist, fields.bankParser,
          fields.minAmountRial, fields.active, now, owner.scope, fields.description]);
      await c.query("COMMIT");
      return { channel: toView(rows[0], 0, now), smsSecret: secret };
    } catch (err) {
      try { await c.query("ROLLBACK"); } catch { /* connection lost */ }
      throw err;
    }
  });
}

/** ویرایشِ جزئی. فیلدِ نیامده دست‌نخورده می‌ماند؛ `cardNumber` خالی/نیامده = همان کارتِ قبلی. */
export async function updateChannel(
  pool: PoolLike, input: { owner: ChannelOwner; channelId: string; patch: ChannelInput; now?: Date },
): Promise<ChannelView> {
  const now = input.now ?? new Date();
  const { owner, channelId, patch } = input;
  await withClient(pool, (c) => loadOwned(c, owner, channelId));   // ۴۰۴ زودهنگام؛ تصمیم زیرِ قفل گرفته می‌شود

  return withChannelLock(pool, channelId, async (c) => {
    const cur = (await c.query(
      "SELECT * FROM payment_channels WHERE id = $1 AND scope = $2 AND bot_id IS NOT DISTINCT FROM $3::text FOR UPDATE",
      [channelId, owner.scope, ownerBot(owner)])).rows[0];
    if (!cur) throw new ChannelAdminError("کانال پیدا نشد.", "not_found", 404);
    const active = await activeCount(c, channelId);

    const sets: string[] = [];
    const params: unknown[] = [channelId, ownerBot(owner), owner.scope];
    const set = (col: string, val: unknown, cast = "") => { params.push(val); sets.push(`${col} = $${params.length}${cast}`); };

    const destinationTouched =
      (patch.kind !== undefined && patch.kind !== cur.kind) ||
      (typeof patch.cardNumber === "string" && patch.cardNumber.trim() !== "") ||
      (patch.paymentUrl !== undefined && patch.paymentUrl !== cur.payment_url);
    const deactivating = patch.active === false && cur.active;
    if ((destinationTouched || deactivating) && active > 0) {
      throw new ChannelAdminError(
        `${active} درخواستِ پرداختِ فعال روی این کانال هست؛ تا پایانِ آن‌ها مقصد را عوض یا کانال را غیرفعال نکنید.`,
        "channel_has_active_requests", 409);
    }

    const kind = (patch.kind ?? cur.kind) as ChannelKind;
    if (!CHANNEL_KINDS.includes(kind)) throw new ChannelAdminError("نوعِ کانال نامعتبر است.", "invalid_kind");
    if (kind !== cur.kind) set("kind", kind);

    if (kind === "card_manual") {
      if (typeof patch.cardNumber === "string" && patch.cardNumber.trim() !== "") {
        const digits = digitsOnly(patch.cardNumber);
        if (!isValidCardNumber(digits)) throw new ChannelAdminError("شماره‌کارت نامعتبر است (۱۶ رقم و معتبر).", "invalid_card");
        set("card_number_enc", encryptToken(digits));
      } else if (!cur.card_number_enc) {
        throw new ChannelAdminError("برایِ کانالِ کارت‌به‌کارت شماره‌کارت لازم است.", "invalid_card");
      }
      if (kind !== cur.kind) set("payment_url", null);
    } else {
      const url = patch.paymentUrl !== undefined ? httpsUrl(patch.paymentUrl) : cur.payment_url;
      if (!url) throw new ChannelAdminError("لینکِ پرداخت لازم است.", "invalid_url");
      if (url !== cur.payment_url) set("payment_url", url);
      if (kind !== cur.kind) set("card_number_enc", null);
    }
    if (patch.holderName !== undefined) {
      const h = str(patch.holderName, 80);
      if (kind === "card_manual" && !h) throw new ChannelAdminError("نامِ صاحبِ کارت لازم است.", "holder_required");
      set("holder_name", h || null);
    }
    if (patch.bankName !== undefined) set("bank_name", str(patch.bankName, 60) || null);
    if (patch.description !== undefined) set("description", cleanDescription(patch.description));
    if (patch.minAmountToman !== undefined) set("min_amount_rial", minRial(patch.minAmountToman), "::bigint");
    if (patch.senderAllowlist !== undefined) set("sender_allowlist", allowlist(patch.senderAllowlist), "::text[]");
    if (patch.bankParser !== undefined) {
      const p = String(patch.bankParser);
      if (!KNOWN_SMS_PARSERS.includes(p)) throw new ChannelAdminError("قالبِ پیامکِ بانک نامعتبر است.", "invalid_parser");
      set("bank_parser", p);
    }
    if (patch.active !== undefined) set("active", patch.active === true);

    if (!sets.length) return toView(cur, active, now);
    const { rows } = await c.query(
      `UPDATE payment_channels SET ${sets.join(", ")} WHERE id = $1 AND bot_id IS NOT DISTINCT FROM $2::text AND scope = $3 RETURNING *`, params);
    return toView(rows[0], active, now);
  });
}

/** چرخشِ secret: هشِ جدید، secretِ قدیمی همان لحظه نامعتبر؛ بقیه‌ی تنظیمات دست‌نخورده. */
export async function rotateSecret(pool: PoolLike, input: { owner: ChannelOwner; channelId: string }): Promise<{ smsSecret: string }> {
  const secret = generateSmsSecret();
  return withClient(pool, async (c) => {
    const { rows } = await c.query(
      "UPDATE payment_channels SET sms_secret_hash = $4 WHERE id = $1 AND bot_id IS NOT DISTINCT FROM $2::text AND scope = $3 RETURNING id",
      [input.channelId, ownerBot(input.owner), input.owner.scope, hashSmsSecret(secret)]);
    if (!rows[0]) throw new ChannelAdminError("کانال پیدا نشد.", "not_found", 404);
    return { smsSecret: secret };
  });
}

/** حذف فقط اگر هیچ درخواست/پیامکی ندارد (خطای اولیه)؛ وگرنه غیرفعال‌کردن پیشنهاد می‌شود. */
export async function deleteChannel(pool: PoolLike, input: { owner: ChannelOwner; channelId: string }): Promise<void> {
  await withClient(pool, (c) => loadOwned(c, input.owner, input.channelId));
  await withChannelLock(pool, input.channelId, async (c) => {
    const { rows } = await c.query(
      `SELECT (SELECT COUNT(*) FROM payment_requests WHERE channel_id = $1)::int AS r,
              (SELECT COUNT(*) FROM sms_inbox WHERE channel_id = $1 AND status <> 'ignored')::int AS s`,
      [input.channelId]);
    if (rows[0].r > 0 || rows[0].s > 0) {
      throw new ChannelAdminError("این کانال سابقه‌ی پرداخت دارد و حذف نمی‌شود؛ به‌جایِ آن غیرفعالش کنید.", "channel_has_history", 409);
    }
    await c.query("DELETE FROM sms_inbox WHERE channel_id = $1", [input.channelId]);
    await c.query(
      "DELETE FROM payment_channels WHERE id = $1 AND scope = $2 AND bot_id IS NOT DISTINCT FROM $3::text",
      [input.channelId, input.owner.scope, ownerBot(input.owner)]);
  });
}

// ─── پیامک آزمایشی و لاگ ────────────────────────────────────────────────────

const TEST_SENDER = "IRFORGE-TEST";
/** یک متنِ نمونه‌ی واریز به قالبِ پارسرِ انتخاب‌شده — مبلغِ قابل‌تشخیصِ ۱٬۲۳۴٬۵۶۰ ریال. */
export function sampleDepositText(parser: string): string {
  if (parser === "blubank") {
    return "بلو\nواریز پول\n نمونه عزیز، 1,234,560 ریال به حساب شما نشست.\n موجودی: 9,876,540 ریال\n۱۲:۳۴\n۱۴۰۵.۰۱.۰۱";
  }
  return "واریز 1,234,560 ریال به حساب شما. مانده: 9,876,540 ریال";
}

export interface TestSmsResult {
  text: string;
  direction: string;
  amountRial: number | null;
  parsedOk: boolean;
  expectedAmountRial: number;
  matchesExpected: boolean;
}

/** مسیرِ سروریِ پیامک را می‌آزماید (پارسر + ذخیره)، بدونِ اینکه هرگز قابلِ match باشد. */
export async function runTestSms(pool: PoolLike, input: { owner: ChannelOwner; channelId: string; now?: Date }): Promise<TestSmsResult> {
  const now = input.now ?? new Date();
  const ch = await withClient(pool, (c) => loadOwned(c, input.owner, input.channelId));
  const text = sampleDepositText(ch.bank_parser);
  const parsed = getSmsParser(ch.bank_parser)(text);
  const id = `sms_${crypto.randomBytes(9).toString("hex")}`;
  await withClient(pool, (c) => c.query(
    `INSERT INTO sms_inbox
       (id, channel_id, raw_text, sender, received_at, content_hash, direction, amount_rial, balance_rial, parsed_ok, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::bigint,$9::bigint,$10,'ignored')`,
    [id, ch.id, `[TEST] ${text}`, TEST_SENDER, now, `test:${id}`, parsed.direction, parsed.amountRial, parsed.balanceRial, parsed.parsedOk]));
  return {
    text, direction: parsed.direction, amountRial: parsed.amountRial, parsedOk: parsed.parsedOk,
    expectedAmountRial: 1_234_560, matchesExpected: parsed.parsedOk && parsed.direction === "deposit" && parsed.amountRial === 1_234_560,
  };
}

/** رشته‌رقم‌های بلند (شماره‌کارت/موبایل) را نیمه‌ماسک می‌کند؛ مبلغ‌ها (≤ ۹ رقم) دست‌نخورده می‌مانند. */
export function maskLongDigits(text: string): string {
  return text.replace(/\d{10,}/g, (m) => `${m.slice(0, 2)}${"*".repeat(m.length - 4)}${m.slice(-2)}`);
}

export interface SmsLogEntry {
  id: string;
  receivedAt: Date;
  sender: string | null;
  direction: string;
  amountToman: number | null;
  parsedOk: boolean;
  status: string;
  preview: string;
  isTest: boolean;
}

export async function listSmsLog(
  pool: PoolLike, input: { owner: ChannelOwner; channelId: string; limit?: number },
): Promise<SmsLogEntry[]> {
  return withClient(pool, async (c) => {
    await loadOwned(c, input.owner, input.channelId);
    const { rows } = await c.query(
      `SELECT id, received_at, sender, direction, amount_rial, parsed_ok, status, raw_text
         FROM sms_inbox WHERE channel_id = $1 ORDER BY received_at DESC, id LIMIT $2`,
      [input.channelId, Math.min(input.limit ?? 20, SMS_LOG_LIMIT)]);
    return rows.map((r) => ({
      id: r.id,
      receivedAt: r.received_at,
      sender: r.sender,
      direction: r.direction,
      amountToman: r.amount_rial === null ? null : Math.round(Number(r.amount_rial) / 10),
      parsedOk: r.parsed_ok,
      status: r.status,
      preview: maskLongDigits(String(r.raw_text ?? "")).slice(0, 160),
      isTest: r.sender === TEST_SENDER,
    }));
  });
}
