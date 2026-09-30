/**
 * lib/paymentRequests.ts — تخصیصِ مبلغِ یکتا و صفِ رزرو
 * (IRFORGE_CARD_AUTOCONFIRM_PROMPT، فاز ۲).
 * ─────────────────────────────────────────────────────────────────────────────
 * هر درخواستِ فعال یک «کدِ شبه‌OTP» دارد که فقط با **مبلغ** قابلِ‌تشخیص است:
 *
 *  - `card_manual` / `open_link` (پرداخت‌کننده مبلغ را آزاد می‌زند):
 *    `final = base + suffix`، suffix رندومِ مضربِ ۱۰ ریال بینِ ۱۰ تا ۹۹۹۰
 *    (۱ تا ۹۹۹ تومان — ۹۹۹ مقدارِ ممکن). اگر همه‌ی ۹۹۹ مقدار برایِ این base
 *    روی این کانال پُر بود → درخواست `queued`.
 *  - `fixed_link` (مبلغِ لینک ثابت است، suffix ممکن نیست): حداکثر یک `pending`
 *    به‌ازای هر مبلغِ ثابت؛ بقیه `queued` با `queue_position`. وقتی اسلات آزاد شد
 *    (تأیید/انقضا/لغو) نفرِ اولِ صف در **همان تراکنش** به `pending` ارتقا می‌یابد
 *    و فراخواننده (بات) خبرش را می‌گیرد (`promoted` در خروجی).
 *
 * هم‌زمانی: هر عملی که اسلات می‌گیرد یا آزاد می‌کند اول یک advisory lockِ
 * تراکنشیِ **به‌ازای کانال** می‌گیرد (`withChannelLock`)، بعد ردیف‌ها را. یعنی
 * روی یک کانال همه‌چیز ترتیبی است — ترافیکِ کارت‌به‌کارت کم است و درستیِ
 * صف/جایگاه (بدونِ race) ارزشِ این هزینه را دارد. قیدهای یکتای فاز ۱ همچنان
 * پشتیبانِ سطحِ دیتابیس‌اند: حتی اگر کسی lock را دور بزند، دو درخواستِ فعالِ هم‌مبلغ
 * ساخته نمی‌شوند (`23505`). **همه‌ی کدهای آینده (تأییدِ فاز ۴) باید همین ترتیب را
 * رعایت کنند: اول lockِ کانال، بعد قفلِ ردیف — وگرنه deadlock.**
 *
 * `scope`/`bot_id`/`channel_kind` هرگز از ورودیِ کاربر نمی‌آیند: از خودِ ردیفِ
 * کانال خوانده می‌شوند، و فراخواننده باید scope مورد انتظارش را بگوید
 * (`ChannelScope`) تا کانالِ یک tenant برایِ tenant دیگر قابل‌استفاده نباشد.
 *
 * همه‌ی مبالغ عدد صحیحِ **ریال**. این ماژول عمداً به `pg`/`@workspace/db` import
 * نمی‌بندد؛ فقط به یک `PoolLike` ساختاری نیاز دارد (استخرِ `pg` مستقیم قابل‌قبول است).
 */
import crypto from "crypto";

export interface ClientLike {
  query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>;
  release(): void;
}
export interface PoolLike {
  connect(): Promise<ClientLike>;
}

export type ChannelScope = { scope: "platform" } | { scope: "bot"; botId: string };

export const DEFAULT_EXPIRY_MS = 30 * 60 * 1000;
export const MIN_EXPIRY_MINUTES = 5;
export const MAX_EXPIRY_MINUTES = 240;

/**
 * مهلتِ پرداختِ پیش‌فرض (قابل تنظیم بدونِ تغییرِ کد): env `PAYMENT_REQUEST_EXPIRY_MINUTES`، عددِ صحیحِ ۵..۲۴۰؛
 * نبود یا مقدارِ نامعتبر/خارج از بازه → ۳۰ دقیقه (هیچ‌وقت مهلتِ صفر/بی‌نهایت نمی‌شود). هر فراخوانی می‌تواند با `expiryMs` بازنویسی کند.
 * فقط برایِ درخواست‌هایِ *تازه/ارتقاپیدا* اثر دارد؛ درخواست‌هایِ بازِ فعلی `expires_at` خودشان را نگه می‌دارند.
 */
export function resolveDefaultExpiryMs(env: Record<string, string | undefined> = process.env): number {
  const raw = env.PAYMENT_REQUEST_EXPIRY_MINUTES;
  if (raw === undefined || !/^\d+$/.test(raw.trim())) return DEFAULT_EXPIRY_MS;
  const minutes = Number(raw.trim());
  return minutes >= MIN_EXPIRY_MINUTES && minutes <= MAX_EXPIRY_MINUTES ? minutes * 60_000 : DEFAULT_EXPIRY_MS;
}
/** حداکثر انتظار در صف — بعد از آن `expired` می‌شود و دیگر ارتقا نمی‌یابد. */
export const DEFAULT_QUEUE_TTL_MS = 60 * 60 * 1000;
export const SUFFIX_MIN_RIAL = 10;
export const SUFFIX_MAX_RIAL = 9990;
export const SUFFIX_STEP_RIAL = 10;

const UNIQUE_VIOLATION = "23505";
const MAX_INSERT_RETRIES = 5;

export class PaymentRequestError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
  }
}

export interface PaymentRequestRow {
  id: string;
  channelId: string;
  channelKind: "card_manual" | "fixed_link" | "open_link";
  scope: "platform" | "bot";
  botId: string | null;
  userId: string;
  purpose: "wallet_topup" | "order";
  orderId: string | null;
  baseAmountRial: number;
  suffixRial: number;
  finalAmountRial: number;
  status: string;
  expiresAt: Date | null;
  queuePosition: number | null;
  createdAt: Date;
  /** sms | admin — فقط وقتی status=confirmed. */
  confirmedBy: "sms" | "admin" | null;
  /** ادمینِ تأییدکننده — فقط وقتی confirmedBy=admin. */
  confirmedByAdminId: string | null;
  confirmedAt: Date | null;
  matchedSmsId: string | null;
  /** شناسه‌ی حسابِ (کانالِ) مقصد در لحظه‌ی ساخت — snapshot برایِ سفارش/گزارش. */
  accountIdSnapshot: string | null;
}

export function mapRow(r: any): PaymentRequestRow {
  return {
    id: r.id,
    channelId: r.channel_id,
    channelKind: r.channel_kind,
    scope: r.scope,
    botId: r.bot_id,
    userId: r.user_id,
    purpose: r.purpose,
    orderId: r.order_id,
    // BIGINT در node-pg رشته برمی‌گردد؛ مبالغ زیرِ 2^53 هستند.
    baseAmountRial: Number(r.base_amount_rial),
    suffixRial: Number(r.suffix_rial),
    finalAmountRial: Number(r.final_amount_rial),
    status: r.status,
    expiresAt: r.expires_at,
    queuePosition: r.queue_position,
    createdAt: r.created_at,
    confirmedBy: r.confirmed_by ?? null,
    confirmedByAdminId: r.confirmed_by_admin_id ?? null,
    confirmedAt: r.confirmed_at ?? null,
    matchedSmsId: r.matched_sms_id ?? null,
    accountIdSnapshot: r.account_id_snapshot ?? null,
  };
}

// ─── توابعِ خالص (بدونِ I/O) ────────────────────────────────────────────────

/** همه‌ی suffixهایی که `base + suffix` در مجموعه‌ی مبالغِ اشغال‌شده نیست. */
export function freeSuffixes(baseAmountRial: number, takenFinals: ReadonlySet<number>): number[] {
  const out: number[] = [];
  for (let s = SUFFIX_MIN_RIAL; s <= SUFFIX_MAX_RIAL; s += SUFFIX_STEP_RIAL) {
    if (!takenFinals.has(baseAmountRial + s)) out.push(s);
  }
  return out;
}

export function pickRandom<T>(items: readonly T[], randomInt: (n: number) => number = crypto.randomInt): T {
  return items[randomInt(items.length)];
}

// ─── تراکنش و قفل ───────────────────────────────────────────────────────────

export async function inTransaction<T>(pool: PoolLike, fn: (c: ClientLike) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (err) {
    try { await c.query("ROLLBACK"); } catch { /* اتصال افتاده؛ استخر دورش می‌اندازد */ }
    throw err;
  } finally {
    c.release();
  }
}

async function lockChannel(c: ClientLike, channelId: string): Promise<void> {
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`payreq:${channelId}`]);
}

/** `fn` را داخلِ یک تراکنش، با lockِ کانال اجرا می‌کند. */
export function withChannelLock<T>(pool: PoolLike, channelId: string, fn: (c: ClientLike) => Promise<T>): Promise<T> {
  return inTransaction(pool, async (c) => {
    await lockChannel(c, channelId);
    return fn(c);
  });
}

/** INSERT/UPDATE داخل SAVEPOINT — `23505` تراکنشِ اصلی را نمی‌کُشد. */
async function tryUnique<T>(c: ClientLike, fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> {
  await c.query("SAVEPOINT sp_unique");
  try {
    const value = await fn();
    await c.query("RELEASE SAVEPOINT sp_unique");
    return { ok: true, value };
  } catch (err: any) {
    await c.query("ROLLBACK TO SAVEPOINT sp_unique");
    await c.query("RELEASE SAVEPOINT sp_unique");
    if (err?.code === UNIQUE_VIOLATION) return { ok: false };
    throw err;
  }
}

async function takenFinalsNear(c: ClientLike, channelId: string, base: number): Promise<Set<number>> {
  const { rows } = await c.query(
    `SELECT final_amount_rial FROM payment_requests
      WHERE channel_id = $1 AND status IN ('pending', 'awaiting_review')
        AND final_amount_rial BETWEEN $2 AND $3`,
    [channelId, base + SUFFIX_MIN_RIAL, base + SUFFIX_MAX_RIAL],
  );
  return new Set(rows.map((r) => Number(r.final_amount_rial)));
}

// ─── ساختِ درخواست ─────────────────────────────────────────────────────────

export interface CreateRequestInput {
  channelId: string;
  /** scope مورد انتظار — با scope/bot_id خودِ کانال تطبیق داده می‌شود. */
  channelScope: ChannelScope;
  userId: string;
  purpose: "wallet_topup" | "order";
  orderId?: string | null;
  baseAmountRial: number;
  expiryMs?: number;
  queueTtlMs?: number;
  now?: Date;
  /** فقط برایِ تست. */
  randomInt?: (n: number) => number;
}

export interface CreateRequestResult {
  request: PaymentRequestRow;
  /** فقط برایِ `queued`: چند درخواستِ هم‌مبلغ جلوتر از این هستند. */
  queuedAhead: number;
}

export async function createPaymentRequest(pool: PoolLike, input: CreateRequestInput): Promise<CreateRequestResult> {
  const base = input.baseAmountRial;
  if (!Number.isSafeInteger(base) || base <= 0) {
    throw new PaymentRequestError("مبلغ باید یک عدد صحیحِ مثبت (ریال) باشد.", "invalid_amount");
  }
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + (input.expiryMs ?? resolveDefaultExpiryMs()));
  const queueExpiresAt = new Date(now.getTime() + (input.queueTtlMs ?? DEFAULT_QUEUE_TTL_MS));
  const rnd = input.randomInt ?? crypto.randomInt;

  return withChannelLock(pool, input.channelId, async (c) => {
    const { rows: chRows } = await c.query("SELECT * FROM payment_channels WHERE id = $1", [input.channelId]);
    const ch = chRows[0];
    const s = input.channelScope;
    const scopeOk = ch && ch.scope === s.scope && (s.scope === "platform" ? ch.bot_id === null : ch.bot_id === s.botId);
    if (!scopeOk) throw new PaymentRequestError("کانالِ پرداخت پیدا نشد.", "channel_not_found");
    if (!ch.active) throw new PaymentRequestError("این کانالِ پرداخت غیرفعال است.", "channel_inactive");
    if (base < Number(ch.min_amount_rial)) {
      throw new PaymentRequestError(
        `حداقلِ مبلغِ این کانال ${Number(ch.min_amount_rial)} ریال است.`, "amount_below_minimum",
      );
    }
    const kind: PaymentRequestRow["channelKind"] = ch.kind;
    const id = `pr_${crypto.randomBytes(9).toString("hex")}`;

    const insert = (status: "pending" | "queued", suffix: number, exp: Date, queuePosition: number | null) =>
      c.query(
        `INSERT INTO payment_requests
           (id, channel_id, channel_kind, scope, bot_id, user_id, purpose, order_id,
            base_amount_rial, suffix_rial, final_amount_rial, status, expires_at, queue_position, created_at,
            account_id_snapshot)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::bigint,$10::bigint,$9::bigint + $10::bigint,$11,$12,$13,$14,$2)
         RETURNING *`,
        [id, ch.id, kind, ch.scope, ch.bot_id, input.userId, input.purpose, input.orderId ?? null,
          base, suffix, status, exp, queuePosition, now],
      );

    const { rows: qrows } = await c.query(
      `SELECT COALESCE(MAX(queue_position), 0) AS max_pos, COUNT(*) AS n
         FROM payment_requests WHERE channel_id = $1 AND base_amount_rial = $2 AND status = 'queued'`,
      [ch.id, base],
    );
    const queueLen = Number(qrows[0].n);

    const enqueue = async (): Promise<CreateRequestResult> => {
      const pos = Number(qrows[0].max_pos) + 1;
      const { rows } = await insert("queued", 0, queueExpiresAt, pos);
      return { request: mapRow(rows[0]), queuedAhead: queueLen };
    };

    // FIFO: اگر برایِ همین مبلغ صفی هست، درخواستِ تازه هرگز از آن‌ها جلو نمی‌زند.
    if (queueLen > 0) return enqueue();

    if (kind === "fixed_link") {
      const got = await tryUnique(c, () => insert("pending", 0, expiresAt, null));
      return got.ok ? { request: mapRow(got.value.rows[0]), queuedAhead: 0 } : enqueue();
    }

    for (let attempt = 0; attempt < MAX_INSERT_RETRIES; attempt++) {
      const free = freeSuffixes(base, await takenFinalsNear(c, ch.id, base));
      if (free.length === 0) break;
      const got = await tryUnique(c, () => insert("pending", pickRandom(free, rnd), expiresAt, null));
      if (got.ok) return { request: mapRow(got.value.rows[0]), queuedAhead: 0 };
    }
    return enqueue();
  });
}

// ─── ارتقایِ صف ────────────────────────────────────────────────────────────

/**
 * نفرِ اولِ صفِ هر مبلغ را — تا جایی که اسلات هست — به `pending` می‌برد.
 * **باید داخلِ `withChannelLock` صدا زده شود** (تراکنشِ فراخواننده).
 * ردیف‌های صفی که خودشان منقضی شده‌اند ارتقا نمی‌یابند (منتظرِ sweeper‌اند).
 */
export async function promoteQueue(
  c: ClientLike,
  channelId: string,
  opts: { now?: Date; expiryMs?: number; randomInt?: (n: number) => number } = {},
): Promise<PaymentRequestRow[]> {
  const now = opts.now ?? new Date();
  const expiresAt = new Date(now.getTime() + (opts.expiryMs ?? resolveDefaultExpiryMs()));
  const rnd = opts.randomInt ?? crypto.randomInt;
  const promoted: PaymentRequestRow[] = [];

  for (;;) {
    const { rows: queued } = await c.query(
      `SELECT * FROM payment_requests
        WHERE channel_id = $1 AND status = 'queued' AND (expires_at IS NULL OR expires_at > $2)
        ORDER BY created_at, id`,
      [channelId, now],
    );
    const seenBases = new Set<string>();
    let progressed = false;
    for (const q of queued) {
      const baseKey = String(q.base_amount_rial);
      if (seenBases.has(baseKey)) continue; // فقط سرِ صفِ هر مبلغ
      seenBases.add(baseKey);
      const base = Number(q.base_amount_rial);

      let suffix = 0;
      if (q.channel_kind !== "fixed_link") {
        const free = freeSuffixes(base, await takenFinalsNear(c, channelId, base));
        if (free.length === 0) continue;
        suffix = pickRandom(free, rnd);
      }
      const got = await tryUnique(c, () =>
        c.query(
          `UPDATE payment_requests
              SET status = 'pending', queue_position = NULL, suffix_rial = $2::bigint,
                  final_amount_rial = base_amount_rial + $2::bigint, expires_at = $3
            WHERE id = $1 AND status = 'queued' RETURNING *`,
          [q.id, suffix, expiresAt],
        ));
      if (got.ok && got.value.rows[0]) {
        promoted.push(mapRow(got.value.rows[0]));
        progressed = true;
      }
    }
    if (!progressed) break;
  }
  return promoted;
}

// ─── بستنِ درخواست (آزادکردنِ اسلات + ارتقا) ─────────────────────────────────

export interface CloseResult {
  closed: PaymentRequestRow | null;
  promoted: PaymentRequestRow[];
}

/**
 * یک درخواستِ باز را به `canceled`/`expired`/`rejected` می‌برد. اگر اسلاتی آزاد
 * شد (pending/awaiting_review)، نفرِ بعدیِ صف در **همان تراکنش** ارتقا می‌یابد.
 * `expectedUserId` اگر داده شود، فقط صاحبِ درخواست می‌تواند ببندد.
 */
export async function closePaymentRequest(
  pool: PoolLike,
  input: {
    requestId: string;
    to: "canceled" | "expired" | "rejected";
    /** فقط از این وضعیت‌ها بسته می‌شود (پیش‌فرض: queued و pending). */
    from?: string[];
    expectedUserId?: string;
    now?: Date;
    expiryMs?: number;
    randomInt?: (n: number) => number;
  },
): Promise<CloseResult> {
  const pre = await (async () => {
    const c = await pool.connect();
    try {
      const { rows } = await c.query("SELECT channel_id FROM payment_requests WHERE id = $1", [input.requestId]);
      return rows[0]?.channel_id as string | undefined;
    } finally {
      c.release();
    }
  })();
  if (!pre) return { closed: null, promoted: [] };

  return withChannelLock(pool, pre, async (c) => {
    const from = input.from ?? ["queued", "pending"];
    const { rows } = await c.query(
      `UPDATE payment_requests SET status = $2, queue_position = NULL
        WHERE id = $1 AND status = ANY($3::text[]) AND ($4::text IS NULL OR user_id = $4)
        RETURNING *`,
      [input.requestId, input.to, from, input.expectedUserId ?? null],
    );
    if (!rows[0]) return { closed: null, promoted: [] };
    const closed = mapRow(rows[0]);
    // اگر یک queued بسته شد اسلاتی آزاد نشده و promoteQueue بی‌اثر است؛ برایِ
    // pending/awaiting_review اسلات آزاد شده و نفرِ بعدیِ صف همین‌جا ارتقا می‌یابد.
    const promoted = await promoteQueue(c, pre, { now: input.now, expiryMs: input.expiryMs, randomInt: input.randomInt });
    return { closed, promoted };
  });
}

/** پیش‌نمایشِ جایگاه: چند درخواستِ هم‌مبلغ جلوتر از این هستند (۰ = نفرِ اول). */
export async function queueAheadOf(pool: PoolLike, requestId: string): Promise<number | null> {
  const c = await pool.connect();
  try {
    const { rows } = await c.query(
      `SELECT (SELECT COUNT(*) FROM payment_requests o
                WHERE o.channel_id = r.channel_id AND o.base_amount_rial = r.base_amount_rial
                  AND o.status = 'queued' AND o.queue_position < r.queue_position) AS ahead
         FROM payment_requests r WHERE r.id = $1 AND r.status = 'queued'`,
      [requestId],
    );
    return rows[0] ? Number(rows[0].ahead) : null;
  } finally {
    c.release();
  }
}

/**
 * درخواست‌های `pending`/`queued`ِ سررسیدشده را منقضی می‌کند و برایِ هر کانال
 * صف را ارتقا می‌دهد. `awaiting_review` (فیش آپلود شده، منتظرِ ادمین) عمداً
 * خودکار منقضی نمی‌شود — تصمیمش با ادمین است.
 */
export async function expireDueRequests(
  pool: PoolLike,
  opts: { now?: Date; expiryMs?: number; randomInt?: (n: number) => number } = {},
): Promise<{ expired: PaymentRequestRow[]; promoted: PaymentRequestRow[] }> {
  const now = opts.now ?? new Date();
  const c0 = await pool.connect();
  let channelIds: string[];
  try {
    const { rows } = await c0.query(
      `SELECT DISTINCT channel_id FROM payment_requests
        WHERE status IN ('pending', 'queued') AND expires_at IS NOT NULL AND expires_at <= $1`,
      [now],
    );
    channelIds = rows.map((r) => r.channel_id);
  } finally {
    c0.release();
  }

  const expired: PaymentRequestRow[] = [];
  const promoted: PaymentRequestRow[] = [];
  for (const channelId of channelIds) {
    const res = await withChannelLock(pool, channelId, async (c) => {
      const { rows } = await c.query(
        `UPDATE payment_requests SET status = 'expired', queue_position = NULL
          WHERE channel_id = $1 AND status IN ('pending', 'queued') AND expires_at IS NOT NULL AND expires_at <= $2
          RETURNING *`,
        [channelId, now],
      );
      const p = await promoteQueue(c, channelId, { now, expiryMs: opts.expiryMs, randomInt: opts.randomInt });
      return { e: rows.map(mapRow), p };
    });
    expired.push(...res.e);
    promoted.push(...res.p);
  }
  return { expired, promoted };
}
