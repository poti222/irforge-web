/**
 * lib/smsForwarder.ts — «ارسال پیامک به تلگرام».
 *
 * برنامه‌ی پیامک‌خوانِ گوشی (MacroDroid و …) هر پیامکی را که کاربر انتخاب کرده به **یک** وبهوکِ هر اکانت
 * می‌فرستد. چون در برنامه فقط یک آدرس جا دارد، «چند مقصد» سمتِ سایت حل می‌شود: هر قانون (rule) می‌گوید
 * پیامکِ چه فرستنده/کلمه‌ای، از کدام مسیر (بات، اکانتِ شخصی یا هر دو) و به کدام چتِ تلگرام برود.
 *
 * متنِ پیام **عیناً** (بدونِ هیچ افزوده‌ای) ارسال می‌شود.
 *
 * این فایل DB-محور است ولی دیتابیس را از طریق `PoolLike` می‌گیرد (مثل lib/paymentChannelAdmin) و ارسالِ تلگرام
 * را از طریق `Senders` تزریق می‌کند؛ پس بدونِ شبکه تست می‌شود.
 */
import crypto from "crypto";
import type { PoolLike } from "./paymentRequests";
import { generateSmsSecret, hashSmsSecret, verifySmsSecret } from "./smsChannelSecret";

export const FORWARD_ID_PREFIX = "smf_";
export const FORWARD_SECRET_PREFIX = "irfsmf_";
export const FORWARD_ID_RE = /^smf_[a-f0-9]{18}$/;

export const MAX_RULES_PER_ACCOUNT = 20;
export const MAX_SMS_TEXT = 4000; // سقفِ یک پیامِ تلگرام ۴۰۹۶ نویسه است
export const DEDUPE_WINDOW_MS = 60_000;

export type Via = "bot" | "userbot" | "both";
export type ForwardStatus = "sent" | "failed" | "no_rule" | "duplicate";

export class ForwardError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

// ── secret ──────────────────────────────────────────────────────────────
export function generateForwardSecret(): string {
  return generateSmsSecret().replace(/^irfsms_/, FORWARD_SECRET_PREFIX);
}
export const hashForwardSecret = hashSmsSecret;
export const verifyForwardSecret = verifySmsSecret;

export function newPublicId(): string {
  return FORWARD_ID_PREFIX + crypto.randomBytes(9).toString("hex");
}

// ── اعتبارسنجیِ ورودیِ قانون ────────────────────────────────────────────
const USERNAME_RE = /^@[A-Za-z][A-Za-z0-9_]{4,31}$/;
const NUMERIC_ID_RE = /^-?\d{5,20}$/;

/**
 * مقصد: `@username` یا شناسه‌ی عددی (گروه/کانال معمولاً `-100…`). `me` (پیام‌های ذخیره‌شده‌ی خودِ اکانت) فقط برای
 * مسیرِ «اکانتِ شخصی» معنا دارد — بات نمی‌تواند به «خودِ کاربر» بدونِ شناسه پیام بدهد.
 */
export function normalizeChatRef(raw: unknown, via: Via): string {
  let v = typeof raw === "string" ? raw.trim() : "";
  if (!v) throw new ForwardError("bad_chat", "مقصد تلگرام لازم است");
  if (v.length > 64) throw new ForwardError("bad_chat", "مقصد خیلی بلند است");
  // لینک t.me/<username> را هم قبول کن
  const link = v.match(/^(?:https?:\/\/)?t\.me\/([A-Za-z][A-Za-z0-9_]{4,31})\/?$/i);
  if (link) v = `@${link[1]}`;
  if (/^me$/i.test(v)) {
    if (via === "bot") throw new ForwardError("bad_chat", "«me» فقط با مسیرِ اکانتِ شخصی کار می‌کند");
    return "me";
  }
  if (USERNAME_RE.test(v) || NUMERIC_ID_RE.test(v)) return v;
  throw new ForwardError("bad_chat", "مقصد باید @username یا شناسه‌ی عددیِ چت باشد");
}

export function normalizeSenderFilter(raw: unknown): string[] {
  if (raw == null || raw === "") return [];
  const arr = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[\n,،]+/) : null;
  if (!arr) throw new ForwardError("bad_sender", "فیلترِ فرستنده نامعتبر است");
  const out = [...new Set(arr.map((s) => (typeof s === "string" ? s.trim() : "")).filter(Boolean))];
  if (out.length > 10) throw new ForwardError("bad_sender", "حداکثر ۱۰ فرستنده");
  if (out.some((s) => s.length > 40)) throw new ForwardError("bad_sender", "نامِ فرستنده خیلی بلند است");
  return out;
}

export interface RuleInput {
  name: string;
  enabled: boolean;
  senderFilter: string[];
  keyword: string | null;
  via: Via;
  chatRef: string;
}

/** `partial` = فیلدهای دریافتی؛ `base` = مقدارِ فعلی برایِ PATCH. */
export function validateRuleInput(partial: Record<string, unknown>, base?: RuleInput): RuleInput {
  const via = (partial.via ?? base?.via ?? "bot") as Via;
  if (via !== "bot" && via !== "userbot" && via !== "both") throw new ForwardError("bad_via", "مسیرِ ارسال نامعتبر است");
  const name = (typeof partial.name === "string" ? partial.name : base?.name ?? "").trim();
  if (!name) throw new ForwardError("bad_name", "نامِ قانون لازم است");
  if (name.length > 60) throw new ForwardError("bad_name", "نامِ قانون حداکثر ۶۰ نویسه");
  const kwRaw = "keyword" in partial ? partial.keyword : base?.keyword ?? null;
  const keyword = typeof kwRaw === "string" && kwRaw.trim() ? kwRaw.trim() : null;
  if (keyword && keyword.length > 100) throw new ForwardError("bad_keyword", "کلمه‌ی کلیدی حداکثر ۱۰۰ نویسه");
  return {
    name,
    enabled: "enabled" in partial ? partial.enabled === true : base?.enabled ?? true,
    senderFilter: "senderFilter" in partial ? normalizeSenderFilter(partial.senderFilter) : base?.senderFilter ?? [],
    keyword,
    via,
    chatRef: normalizeChatRef("chatRef" in partial ? partial.chatRef : base?.chatRef, via),
  };
}

// ── تطبیقِ قانون ────────────────────────────────────────────────────────
export interface RuleRow extends RuleInput {
  id: string;
  sortOrder: number;
}

const norm = (s: string) => s.trim().toLocaleLowerCase("en-US");

/** همه‌ی قانون‌های فعالی که با پیامک می‌خوانند (نه فقط اولی). فیلتر خالی = هر چیز. */
export function matchRules(rules: RuleRow[], sms: { text: string; sender: string | null }): RuleRow[] {
  const sender = sms.sender ? norm(sms.sender) : "";
  const text = norm(sms.text);
  return rules.filter((r) => {
    if (!r.enabled) return false;
    if (r.senderFilter.length > 0 && !r.senderFilter.some((f) => norm(f) === sender)) return false;
    if (r.keyword && !text.includes(norm(r.keyword))) return false;
    return true;
  });
}

export function contentHash(sender: string | null, text: string): string {
  return crypto.createHash("sha256").update(`${sender ?? ""}\n${text}`, "utf8").digest("hex");
}

// ── ارسال ───────────────────────────────────────────────────────────────
export type SendResult = { ok: true } | { ok: false; error: string };

export interface Senders {
  /** null = بات تنظیم نشده */
  bot: ((chatRef: string, text: string) => Promise<SendResult>) | null;
  /** null = اکانتِ شخصی وصل نشده */
  userbot: ((chatRef: string, text: string) => Promise<SendResult>) | null;
}

export interface DispatchOutcome {
  rule: RuleRow;
  ok: boolean;
  /** از کدام مسیر رفت (یا آخرین مسیرِ تلاش‌شده) */
  via: "bot" | "userbot" | null;
  error: string | null;
}

async function safeSend(fn: (c: string, t: string) => Promise<SendResult>, chat: string, text: string): Promise<SendResult> {
  try {
    return await fn(chat, text);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.slice(0, 200) : "send_failed" };
  }
}

/** `both` = failover: اول اکانتِ شخصی (پیام از خودِ کاربر دیده شود)، اگر نشد بات. هرگز دو نسخه نمی‌فرستد. */
export async function dispatchToRule(rule: RuleRow, text: string, senders: Senders): Promise<DispatchOutcome> {
  const order: ("userbot" | "bot")[] = rule.via === "bot" ? ["bot"] : rule.via === "userbot" ? ["userbot"] : ["userbot", "bot"];
  let last: { via: "bot" | "userbot" | null; error: string } = { via: null, error: "no_sender" };
  for (const via of order) {
    const fn = senders[via];
    if (!fn) {
      last = { via, error: via === "bot" ? "bot_not_configured" : "userbot_not_connected" };
      continue;
    }
    const res = await safeSend(fn, rule.chatRef, text);
    if (res.ok) return { rule, ok: true, via, error: null };
    last = { via, error: res.error };
  }
  return { rule, ok: false, via: last.via, error: last.error };
}

export async function dispatchAll(rules: RuleRow[], text: string, senders: Senders): Promise<DispatchOutcome[]> {
  const out: DispatchOutcome[] = [];
  // پشت‌سرهم: ترتیبِ پیام‌ها برایِ گیرنده حفظ شود و به سقفِ نرخِ تلگرام نخوریم.
  for (const r of rules) out.push(await dispatchToRule(r, text, senders));
  return out;
}

// ── دیتابیس ─────────────────────────────────────────────────────────────
async function q<T = any>(pool: PoolLike, sql: string, params: unknown[] = []): Promise<T[]> {
  const c = await pool.connect();
  try {
    return (await c.query(sql, params)).rows as T[];
  } finally {
    c.release();
  }
}

export interface AccountRow {
  userId: string;
  publicId: string;
  secretHash: string;
  enabled: boolean;
  botTokenEnc: string | null;
  botUsername: string | null;
  userbotSessionEnc: string | null;
  userbotLabel: string | null;
  lastReceivedAt: string | null;
  createdAt: string;
}

const ACCOUNT_COLS = `user_id, public_id, secret_hash, enabled, bot_token_enc, bot_username, userbot_session_enc, userbot_label, last_received_at, created_at`;
const toAccount = (r: any): AccountRow => ({
  userId: r.user_id,
  publicId: r.public_id,
  secretHash: r.secret_hash,
  enabled: r.enabled,
  botTokenEnc: r.bot_token_enc,
  botUsername: r.bot_username,
  userbotSessionEnc: r.userbot_session_enc,
  userbotLabel: r.userbot_label,
  lastReceivedAt: r.last_received_at ? new Date(r.last_received_at).toISOString() : null,
  createdAt: new Date(r.created_at).toISOString(),
});

export async function getAccountByUser(pool: PoolLike, userId: string): Promise<AccountRow | null> {
  const rows = await q(pool, `SELECT ${ACCOUNT_COLS} FROM sms_forward_accounts WHERE user_id = $1`, [userId]);
  return rows[0] ? toAccount(rows[0]) : null;
}

export async function getAccountByPublicId(pool: PoolLike, publicId: string): Promise<AccountRow | null> {
  const rows = await q(pool, `SELECT ${ACCOUNT_COLS} FROM sms_forward_accounts WHERE public_id = $1`, [publicId]);
  return rows[0] ? toAccount(rows[0]) : null;
}

/** ساختِ اکانت. secret **فقط همین‌جا** برگردانده می‌شود. هر کاربر فقط یک وبهوک دارد. */
export async function createAccount(pool: PoolLike, userId: string): Promise<{ account: AccountRow; secret: string }> {
  const secret = generateForwardSecret();
  const publicId = newPublicId();
  const rows = await q(
    pool,
    `INSERT INTO sms_forward_accounts (user_id, public_id, secret_hash) VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO NOTHING RETURNING ${ACCOUNT_COLS}`,
    [userId, publicId, hashForwardSecret(secret)],
  );
  if (!rows[0]) throw new ForwardError("exists", "وبهوک این اکانت قبلاً ساخته شده");
  return { account: toAccount(rows[0]), secret };
}

export async function rotateSecret(pool: PoolLike, userId: string): Promise<string> {
  const secret = generateForwardSecret();
  const rows = await q(
    pool,
    `UPDATE sms_forward_accounts SET secret_hash = $2, updated_at = NOW() WHERE user_id = $1 RETURNING user_id`,
    [userId, hashForwardSecret(secret)],
  );
  if (!rows[0]) throw new ForwardError("no_account", "ابتدا وبهوک را بسازید");
  return secret;
}

export async function updateAccountFields(
  pool: PoolLike,
  userId: string,
  fields: Partial<{ enabled: boolean; botTokenEnc: string | null; botUsername: string | null; userbotSessionEnc: string | null; userbotLabel: string | null }>,
): Promise<void> {
  const cols: Record<string, string> = {
    enabled: "enabled",
    botTokenEnc: "bot_token_enc",
    botUsername: "bot_username",
    userbotSessionEnc: "userbot_session_enc",
    userbotLabel: "userbot_label",
  };
  const sets: string[] = [];
  const params: unknown[] = [userId];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    params.push(v);
    sets.push(`${cols[k]} = $${params.length}`);
  }
  if (sets.length === 0) return;
  const rows = await q(pool, `UPDATE sms_forward_accounts SET ${sets.join(", ")}, updated_at = NOW() WHERE user_id = $1 RETURNING user_id`, params);
  if (!rows[0]) throw new ForwardError("no_account", "ابتدا وبهوک را بسازید");
}

export async function touchReceived(pool: PoolLike, userId: string): Promise<void> {
  await q(pool, `UPDATE sms_forward_accounts SET last_received_at = NOW() WHERE user_id = $1`, [userId]);
}

export async function deleteAccount(pool: PoolLike, userId: string): Promise<void> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query(`DELETE FROM sms_forward_log WHERE user_id = $1`, [userId]);
    await c.query(`DELETE FROM sms_forward_rules WHERE user_id = $1`, [userId]);
    await c.query(`DELETE FROM sms_forward_accounts WHERE user_id = $1`, [userId]);
    await c.query("COMMIT");
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}

const toRule = (r: any): RuleRow => ({
  id: r.id,
  name: r.name,
  enabled: r.enabled,
  senderFilter: r.sender_filter ?? [],
  keyword: r.keyword,
  via: r.via,
  chatRef: r.chat_ref,
  sortOrder: r.sort_order,
});
const RULE_COLS = `id, name, enabled, sender_filter, keyword, via, chat_ref, sort_order`;

export async function listRules(pool: PoolLike, userId: string): Promise<RuleRow[]> {
  const rows = await q(pool, `SELECT ${RULE_COLS} FROM sms_forward_rules WHERE user_id = $1 ORDER BY sort_order, created_at, id`, [userId]);
  return rows.map(toRule);
}

export async function getRule(pool: PoolLike, userId: string, id: string): Promise<RuleRow | null> {
  const rows = await q(pool, `SELECT ${RULE_COLS} FROM sms_forward_rules WHERE user_id = $1 AND id = $2`, [userId, id]);
  return rows[0] ? toRule(rows[0]) : null;
}

export async function createRule(pool: PoolLike, userId: string, input: RuleInput): Promise<RuleRow> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    // قفلِ per-user تا سقفِ تعداد با درخواست‌های همزمان دور زده نشود.
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`smsfwd:${userId}`]);
    const cnt = await c.query(`SELECT COUNT(*)::int AS n, COALESCE(MAX(sort_order), -1) + 1 AS next FROM sms_forward_rules WHERE user_id = $1`, [userId]);
    if (cnt.rows[0].n >= MAX_RULES_PER_ACCOUNT) throw new ForwardError("too_many", `حداکثر ${MAX_RULES_PER_ACCOUNT} قانون`);
    const id = `smr_${crypto.randomBytes(9).toString("hex")}`;
    const ins = await c.query(
      `INSERT INTO sms_forward_rules (id, user_id, name, enabled, sender_filter, keyword, via, chat_ref, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${RULE_COLS}`,
      [id, userId, input.name, input.enabled, input.senderFilter, input.keyword, input.via, input.chatRef, cnt.rows[0].next],
    );
    await c.query("COMMIT");
    return toRule(ins.rows[0]);
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}

export async function updateRule(pool: PoolLike, userId: string, id: string, input: RuleInput): Promise<RuleRow | null> {
  const rows = await q(
    pool,
    `UPDATE sms_forward_rules SET name=$3, enabled=$4, sender_filter=$5, keyword=$6, via=$7, chat_ref=$8, updated_at=NOW()
      WHERE user_id=$1 AND id=$2 RETURNING ${RULE_COLS}`,
    [userId, id, input.name, input.enabled, input.senderFilter, input.keyword, input.via, input.chatRef],
  );
  return rows[0] ? toRule(rows[0]) : null;
}

export async function deleteRule(pool: PoolLike, userId: string, id: string): Promise<boolean> {
  const rows = await q(pool, `DELETE FROM sms_forward_rules WHERE user_id=$1 AND id=$2 RETURNING id`, [userId, id]);
  return rows.length > 0;
}

// ── لاگ ─────────────────────────────────────────────────────────────────
export interface LogEntry {
  ruleId: string | null;
  ruleName: string | null;
  sender: string | null;
  contentHash: string;
  textLen: number;
  status: ForwardStatus;
  via: string | null;
  error: string | null;
}

export async function writeLog(pool: PoolLike, userId: string, e: LogEntry): Promise<void> {
  await q(
    pool,
    `INSERT INTO sms_forward_log (id, user_id, rule_id, rule_name, sender, content_hash, text_len, status, via, error)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [`sml_${crypto.randomBytes(9).toString("hex")}`, userId, e.ruleId, e.ruleName, e.sender?.slice(0, 120) ?? null, e.contentHash, e.textLen, e.status, e.via, e.error?.slice(0, 300) ?? null],
  );
}

export async function listLog(pool: PoolLike, userId: string, limit = 50) {
  const rows = await q(
    pool,
    `SELECT id, rule_id, rule_name, received_at, sender, text_len, status, via, error
       FROM sms_forward_log WHERE user_id = $1 ORDER BY received_at DESC, id LIMIT $2`,
    [userId, Math.min(Math.max(limit, 1), 200)],
  );
  return rows.map((r) => ({
    id: r.id as string,
    ruleId: r.rule_id as string | null,
    ruleName: r.rule_name as string | null,
    receivedAt: new Date(r.received_at).toISOString(),
    sender: r.sender as string | null,
    textLen: r.text_len as number,
    status: r.status as ForwardStatus,
    via: r.via as string | null,
    error: r.error as string | null,
  }));
}

/**
 * همین پیامک (همان فرستنده+متن) در ۶۰ ثانیه‌ی اخیر **با موفقیت** ارسال شده؟ (retryِ برنامه‌ی گوشی)
 * فقط `sent` حساب می‌شود: اگر ارسالِ اول شکست خورده، retryِ گوشی باید فرصتِ دوباره داشته باشد.
 */
export async function wasRecentlySent(pool: PoolLike, userId: string, hash: string, windowMs = DEDUPE_WINDOW_MS): Promise<boolean> {
  const rows = await q(
    pool,
    `SELECT 1 FROM sms_forward_log
      WHERE user_id = $1 AND content_hash = $2 AND status = 'sent'
        AND received_at > NOW() - ($3::int * INTERVAL '1 millisecond') LIMIT 1`,
    [userId, hash, windowMs],
  );
  return rows.length > 0;
}
