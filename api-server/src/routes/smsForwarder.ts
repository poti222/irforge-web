/**
 * routes/smsForwarder.ts — «ارسال پیامک به تلگرام».
 *
 *   POST   /sms-forward/hook/:publicId        وبهوکِ برنامه‌ی پیامک‌خوان (احرازِ secret) ← تطبیقِ قانون‌ها ← ارسال
 *
 *   GET    /sms-forward/overview              وضعیتِ اکانت + مسیرهای ارسال + قانون‌ها + لاگ
 *   POST   /sms-forward/account               ساختِ وبهوکِ اکانت (secret فقط همین‌جا نشان داده می‌شود)
 *   POST   /sms-forward/account/rotate-secret
 *   PATCH  /sms-forward/account               { enabled }
 *   DELETE /sms-forward/account               حذفِ همه‌چیز
 *   PUT|DELETE /sms-forward/bot               مسیرِ «بات» (توکنِ باتِ خودِ کاربر)
 *   POST   /sms-forward/userbot/send-code     مسیرِ «اکانتِ شخصی»: { phone }
 *   POST   /sms-forward/userbot/verify        { code, password? }
 *   DELETE /sms-forward/userbot
 *   POST|PATCH|DELETE /sms-forward/rules[/:id]    قانون‌ها
 *   POST   /sms-forward/rules/:id/test        پیامِ آزمایشی
 *
 * هر اکانت **یک** وبهوک دارد؛ چند مقصد = چند قانون. دسترسی فعلاً فقط سوپرادمین است
 * (`SMS_FORWARD_ACCESS`)؛ برایِ باز کردن برایِ همه فقط همین مقدار را عوض کنید — همه‌چیز per-user است.
 */
import express, { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { pool as defaultPool } from "@workspace/db";
import { requireAuth, requireSuperAdmin } from "./auth.js";
import { blockWhileImpersonating } from "../middleware/impersonation.js";
import { clientIp, hit, perUserRateLimit, send429, type HitFn } from "../middleware/rateLimit.js";
import { logger } from "../lib/logger.js";
import { decodeSmsBody } from "../lib/smsBody.js";
import { SmsIngestError } from "../lib/smsIngest.js";
import { decryptToken, encryptToken } from "../lib/tokenCrypto.js";
import type { PoolLike } from "../lib/paymentRequests.js";
import {
  FORWARD_ID_RE, MAX_SMS_TEXT, ForwardError, contentHash, createAccount, createRule, deleteAccount, deleteRule, dispatchAll,
  dispatchToRule, getAccountByPublicId, getAccountByUser, getRule, listLog, listRules, matchRules, rotateSecret, touchReceived,
  updateAccountFields, updateRule, validateRuleInput, verifyForwardSecret, wasRecentlySent, writeLog,
  type AccountRow, type RuleRow, type SendResult, type Senders,
} from "../lib/smsForwarder.js";
import { isBotTokenShape, sendViaBot, verifyBotToken } from "../lib/smsForwardBot.js";
import { UserbotError, gramUserbot, type UserbotDriver } from "../lib/smsForwardUserbot.js";

/** فعلاً فقط سوپرادمین. برایِ عمومی‌کردن: "all". */
export const SMS_FORWARD_ACCESS: "super_admin" | "all" = "super_admin";

export const HOOK_IP_LIMIT_PER_MIN = 60;
export const HOOK_ACCOUNT_LIMIT_PER_MIN = 120;
const WRITES_PER_HOUR = 120;
const HOUR = 3_600_000;
const MINUTE = 60_000;

function extractSecret(req: Request): string {
  const x = req.header("X-Sms-Secret");
  if (x) return x.trim();
  const auth = req.header("Authorization") ?? "";
  return /^Bearer\s+/i.test(auth) ? auth.replace(/^Bearer\s+/i, "").trim() : "";
}

export interface SmsForwarderDeps {
  pool?: PoolLike;
  gate?: (req: any, res: Response, next: NextFunction) => void;
  hitFn?: HitFn;
  userbot?: UserbotDriver;
  /** فقط برایِ تست: جایگزینِ ارسالِ بات */
  botSend?: (token: string, chatRef: string, text: string) => Promise<SendResult>;
  verifyBot?: typeof verifyBotToken;
}

/** ارسال‌کننده‌ها را از روی تنظیماتِ اکانت می‌سازد (null = آن مسیر تنظیم نشده). توکن/سشن فقط همین‌جا رمزگشایی می‌شوند. */
export function sendersFor(
  account: AccountRow,
  userbot: UserbotDriver,
  botSend: (token: string, chat: string, text: string) => Promise<SendResult> = sendViaBot,
): Senders {
  const decrypt = (v: string | null) => {
    if (!v) return null;
    try { return decryptToken(v); } catch { return null; }
  };
  const token = decrypt(account.botTokenEnc);
  const session = decrypt(account.userbotSessionEnc);
  return {
    bot: token ? (chat, text) => botSend(token, chat, text) : null,
    userbot: session && userbot.available() ? (chat, text) => userbot.send(account.userId, session, chat, text) : null,
  };
}

function view(account: AccountRow | null, userbot: UserbotDriver) {
  if (!account) return null;
  return {
    publicId: account.publicId,
    webhookPath: `/api/sms-forward/hook/${account.publicId}`,
    enabled: account.enabled,
    lastReceivedAt: account.lastReceivedAt,
    createdAt: account.createdAt,
    bot: { configured: Boolean(account.botTokenEnc), username: account.botUsername },
    userbot: { configured: Boolean(account.userbotSessionEnc), label: account.userbotLabel, available: userbot.available() },
  };
}

export function createSmsForwarderRouter(deps: SmsForwarderDeps = {}): Router {
  const pool = deps.pool ?? (defaultPool as unknown as PoolLike);
  const hitFn = deps.hitFn ?? hit;
  const userbot = deps.userbot ?? gramUserbot;
  const botSend = deps.botSend ?? sendViaBot;
  const verifyBot = deps.verifyBot ?? verifyBotToken;
  const gate = deps.gate ?? (SMS_FORWARD_ACCESS === "all" ? requireAuth : requireSuperAdmin);
  const writeLimit = perUserRateLimit("sms-forward-write", WRITES_PER_HOUR, HOUR, hitFn);
  const router = Router();
  const base = "/sms-forward";

  function fail(res: Response, err: unknown, fallback: string): void {
    if (err instanceof ForwardError) {
      const status = err.code === "no_account" || err.code === "not_found" ? 404 : err.code === "exists" ? 409 : 400;
      res.status(status).json({ error: err.message, code: err.code });
      return;
    }
    if (err instanceof UserbotError) {
      const status = err.code === "unavailable" ? 503 : err.code === "flood" ? 429 : err.code === "failed" ? 502 : 400;
      res.status(status).json({ error: err.message, code: err.code });
      return;
    }
    logger.error({ err }, fallback);
    res.status(500).json({ error: "Internal server error" });
  }

  // ── وبهوکِ برنامه‌ی پیامک‌خوان ─────────────────────────────────────────
  router.post(
    `${base}/hook/:publicId`,
    express.text({ type: () => true, limit: "16kb" }),
    async (req: Request, res: Response) => {
      const ip = clientIp(req);
      try {
        const ipVerdict = await hitFn(`smsfwd-ip:${ip}`, HOOK_IP_LIMIT_PER_MIN, 0, MINUTE);
        if (!ipVerdict.allowed) { send429(res, ipVerdict.retryAfterSeconds); return; }

        const publicId = String(req.params.publicId ?? "");
        const secret = extractSecret(req);
        const account = FORWARD_ID_RE.test(publicId) && secret ? await getAccountByPublicId(pool, publicId) : null;
        // اکانتِ ناموجود و secretِ غلط **یک پاسخِ یکسان** می‌گیرند و مقایسه‌ی constant-time انجام می‌شود.
        if (!account || !verifyForwardSecret(secret, account.secretHash)) {
          logger.warn({ ip, publicId: publicId.slice(0, 40) }, "sms-forward hook: auth failed");
          res.status(401).json({ error: "Unauthorized" });
          return;
        }
        if (!account.enabled) { res.status(403).json({ error: "Forwarding disabled" }); return; }

        const accVerdict = await hitFn(`smsfwd-acc:${account.userId}`, HOOK_ACCOUNT_LIMIT_PER_MIN, 0, MINUTE);
        if (!accVerdict.allowed) { send429(res, accVerdict.retryAfterSeconds); return; }

        const decoded = decodeSmsBody({
          body: req.body, contentType: req.header("content-type"), query: req.query as Record<string, unknown>,
          header: (n) => req.header(n),
        });
        const text = String(decoded.text ?? "").replace(/\r\n/g, "\n").slice(0, MAX_SMS_TEXT).trim();
        if (!text) { res.status(400).json({ error: "text لازم است" }); return; }
        const sender = decoded.sender ? String(decoded.sender).slice(0, 120) : null;
        const hash = contentHash(sender, text);

        await touchReceived(pool, account.userId);

        const rules = matchRules(await listRules(pool, account.userId), { text, sender });
        if (rules.length === 0) {
          await writeLog(pool, account.userId, { ruleId: null, ruleName: null, sender, contentHash: hash, textLen: text.length, status: "no_rule", via: null, error: null });
          res.status(200).json({ ok: true, matched: 0 });
          return;
        }
        if (await wasRecentlySent(pool, account.userId, hash)) {
          await writeLog(pool, account.userId, { ruleId: null, ruleName: null, sender, contentHash: hash, textLen: text.length, status: "duplicate", via: null, error: null });
          res.status(200).json({ ok: true, matched: rules.length, duplicate: true });
          return;
        }

        // برنامه‌ی گوشی منتظرِ تلگرام نمی‌ماند؛ نتیجه‌ی هر قانون در لاگ ثبت می‌شود.
        res.status(202).json({ ok: true, matched: rules.length });
        void runDispatch(account, rules, text, sender, hash).catch((err) => logger.error({ err }, "sms-forward dispatch failed"));
      } catch (err) {
        if (err instanceof SmsIngestError) { res.status(400).json({ error: err.message, code: err.code }); return; }
        logger.error({ err }, "sms-forward hook error");
        if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
      }
    },
  );

  async function runDispatch(account: AccountRow, rules: RuleRow[], text: string, sender: string | null, hash: string): Promise<void> {
    const outcomes = await dispatchAll(rules, text, sendersFor(account, userbot, botSend));
    for (const o of outcomes) {
      await writeLog(pool, account.userId, {
        ruleId: o.rule.id, ruleName: o.rule.name, sender, contentHash: hash, textLen: text.length,
        status: o.ok ? "sent" : "failed", via: o.via, error: o.error,
      });
    }
  }

  // ── مدیریت (per-user؛ فعلاً سوپرادمین) ──────────────────────────────────
  const userOf = (req: any): string => String(req.userId);

  router.get(`${base}/overview`, gate, async (req: any, res: Response) => {
    try {
      const uid = userOf(req);
      const account = await getAccountByUser(pool, uid);
      res.json({
        account: view(account, userbot),
        rules: account ? await listRules(pool, uid) : [],
        log: account ? await listLog(pool, uid, 40) : [],
      });
    } catch (err) { fail(res, err, "sms-forward overview error"); }
  });

  router.post(`${base}/account`, gate, blockWhileImpersonating, writeLimit, async (req: any, res: Response) => {
    try {
      const { account, secret } = await createAccount(pool, userOf(req));
      res.status(201).json({ account: view(account, userbot), secret });
    } catch (err) { fail(res, err, "sms-forward create account error"); }
  });

  router.post(`${base}/account/rotate-secret`, gate, blockWhileImpersonating, writeLimit, async (req: any, res: Response) => {
    try { res.json({ secret: await rotateSecret(pool, userOf(req)) }); }
    catch (err) { fail(res, err, "sms-forward rotate error"); }
  });

  router.patch(`${base}/account`, gate, blockWhileImpersonating, writeLimit, express.json({ limit: "4kb" }), async (req: any, res: Response) => {
    try {
      if (typeof req.body?.enabled !== "boolean") throw new ForwardError("bad_input", "enabled باید true/false باشد");
      await updateAccountFields(pool, userOf(req), { enabled: req.body.enabled });
      res.json({ ok: true });
    } catch (err) { fail(res, err, "sms-forward patch account error"); }
  });

  router.delete(`${base}/account`, gate, blockWhileImpersonating, writeLimit, async (req: any, res: Response) => {
    try {
      const uid = userOf(req);
      const account = await getAccountByUser(pool, uid);
      if (account?.userbotSessionEnc) {
        try { await userbot.logout(decryptToken(account.userbotSessionEnc)); } catch { /* best effort */ }
      }
      await userbot.cancelLogin(uid);
      await deleteAccount(pool, uid);
      res.json({ ok: true });
    } catch (err) { fail(res, err, "sms-forward delete account error"); }
  });

  /**
   * مسیرِ ارسال را فقط وقتی می‌شود برداشت که هیچ قانونِ فعالی بی‌صدا از کار نیفتد: قانونِ مخصوصِ همان مسیر،
   * یا قانونِ «هر دو» وقتی مسیرِ دیگر هم وصل نیست. (قانون را غیرفعال/حذف کنید یا مسیر را عوض کنید.)
   */
  async function assertNotLastSender(uid: string, remove: "bot" | "userbot", account: AccountRow): Promise<void> {
    const otherConfigured = remove === "bot" ? Boolean(account.userbotSessionEnc) : Boolean(account.botTokenEnc);
    const needing = (await listRules(pool, uid)).filter((r) => r.enabled && (r.via === remove || (r.via === "both" && !otherConfigured)));
    if (needing.length > 0) {
      throw new ForwardError(
        "last_sender",
        `قانون‌های فعالِ «${needing.map((r) => r.name).join("، ")}» به این مسیر وابسته‌اند؛ اول آن‌ها را غیرفعال/حذف کنید یا مسیرشان را عوض کنید`,
      );
    }
  }

  router.put(`${base}/bot`, gate, blockWhileImpersonating, writeLimit, express.json({ limit: "4kb" }), async (req: any, res: Response) => {
    try {
      const uid = userOf(req);
      if (!(await getAccountByUser(pool, uid))) throw new ForwardError("no_account", "ابتدا وبهوک را بسازید");
      const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
      if (!isBotTokenShape(token)) throw new ForwardError("bad_token", "قالبِ توکنِ بات درست نیست");
      const check = await verifyBot(token);
      if (!check.ok) throw new ForwardError("bad_token", `توکن تأیید نشد: ${check.error}`);
      await updateAccountFields(pool, uid, { botTokenEnc: encryptToken(token), botUsername: check.username });
      res.json({ ok: true, username: check.username });
    } catch (err) { fail(res, err, "sms-forward set bot error"); }
  });

  router.delete(`${base}/bot`, gate, blockWhileImpersonating, writeLimit, async (req: any, res: Response) => {
    try {
      const uid = userOf(req);
      const account = await getAccountByUser(pool, uid);
      if (!account) throw new ForwardError("no_account", "ابتدا وبهوک را بسازید");
      await assertNotLastSender(uid, "bot", account);
      await updateAccountFields(pool, uid, { botTokenEnc: null, botUsername: null });
      res.json({ ok: true });
    } catch (err) { fail(res, err, "sms-forward delete bot error"); }
  });

  // مسیرِ «اکانتِ شخصی»: ورود با شماره + کد (+ رمزِ دومرحله‌ای)
  const loginLimit = perUserRateLimit("sms-forward-userbot-login", 10, HOUR, hitFn);

  router.post(`${base}/userbot/send-code`, gate, blockWhileImpersonating, loginLimit, express.json({ limit: "4kb" }), async (req: any, res: Response) => {
    try {
      const uid = userOf(req);
      if (!(await getAccountByUser(pool, uid))) throw new ForwardError("no_account", "ابتدا وبهوک را بسازید");
      if (!userbot.available()) throw new UserbotError("unavailable", "ورود با اکانتِ شخصی روی این سرور فعال نیست (TELEGRAM_API_ID/HASH تنظیم نشده)");
      res.json({ ok: true, ...(await userbot.startLogin(uid, req.body?.phone)) });
    } catch (err) { fail(res, err, "sms-forward userbot send-code error"); }
  });

  router.post(`${base}/userbot/verify`, gate, blockWhileImpersonating, loginLimit, express.json({ limit: "4kb" }), async (req: any, res: Response) => {
    try {
      const uid = userOf(req);
      if (!(await getAccountByUser(pool, uid))) throw new ForwardError("no_account", "ابتدا وبهوک را بسازید");
      const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
      if (!/^\d{4,8}$/.test(code.replace(/\s+/g, ""))) throw new UserbotError("bad_code", "کد را وارد کنید");
      const password = typeof req.body?.password === "string" && req.body.password ? req.body.password : undefined;
      const { session, label } = await userbot.completeLogin(uid, code, password);
      await updateAccountFields(pool, uid, { userbotSessionEnc: encryptToken(session), userbotLabel: label });
      res.json({ ok: true, label });
    } catch (err) {
      // رمزِ دومرحله‌ای لازم است: خطا نیست، UI فیلدِ رمز را نشان می‌دهد.
      if (err instanceof UserbotError && err.code === "password_needed") { res.status(200).json({ ok: false, passwordNeeded: true }); return; }
      fail(res, err, "sms-forward userbot verify error");
    }
  });

  router.delete(`${base}/userbot`, gate, blockWhileImpersonating, writeLimit, async (req: any, res: Response) => {
    try {
      const uid = userOf(req);
      const account = await getAccountByUser(pool, uid);
      if (!account) throw new ForwardError("no_account", "ابتدا وبهوک را بسازید");
      await userbot.cancelLogin(uid);
      if (account.userbotSessionEnc) {
        await assertNotLastSender(uid, "userbot", account);
        try { await userbot.logout(decryptToken(account.userbotSessionEnc)); } catch { /* best effort */ }
        await updateAccountFields(pool, uid, { userbotSessionEnc: null, userbotLabel: null });
      }
      res.json({ ok: true });
    } catch (err) { fail(res, err, "sms-forward delete userbot error"); }
  });

  // ── قانون‌ها ────────────────────────────────────────────────────────────
  /** قانون فقط با مسیری که واقعاً وصل است معنی دارد (`both` = حداقل یکی). */
  function assertViaConfigured(account: AccountRow, via: RuleRow["via"]): void {
    const bot = Boolean(account.botTokenEnc);
    const ub = Boolean(account.userbotSessionEnc);
    const ok = via === "bot" ? bot : via === "userbot" ? ub : bot || ub;
    if (!ok) {
      throw new ForwardError("sender_missing", via === "bot" ? "ابتدا بات را وصل کنید" : via === "userbot" ? "ابتدا اکانتِ شخصی را وصل کنید" : "حداقل یکی از مسیرهای ارسال (بات یا اکانتِ شخصی) باید وصل باشد");
    }
  }

  router.post(`${base}/rules`, gate, blockWhileImpersonating, writeLimit, express.json({ limit: "8kb" }), async (req: any, res: Response) => {
    try {
      const uid = userOf(req);
      const account = await getAccountByUser(pool, uid);
      if (!account) throw new ForwardError("no_account", "ابتدا وبهوک را بسازید");
      const input = validateRuleInput(req.body ?? {});
      assertViaConfigured(account, input.via);
      res.status(201).json({ rule: await createRule(pool, uid, input) });
    } catch (err) { fail(res, err, "sms-forward create rule error"); }
  });

  router.patch(`${base}/rules/:id`, gate, blockWhileImpersonating, writeLimit, express.json({ limit: "8kb" }), async (req: any, res: Response) => {
    try {
      const uid = userOf(req);
      const account = await getAccountByUser(pool, uid);
      if (!account) throw new ForwardError("no_account", "ابتدا وبهوک را بسازید");
      const current = await getRule(pool, uid, String(req.params.id));
      if (!current) throw new ForwardError("not_found", "قانون پیدا نشد");
      const input = validateRuleInput(req.body ?? {}, current);
      if (input.enabled) assertViaConfigured(account, input.via);
      const rule = await updateRule(pool, uid, current.id, input);
      if (!rule) throw new ForwardError("not_found", "قانون پیدا نشد");
      res.json({ rule });
    } catch (err) { fail(res, err, "sms-forward update rule error"); }
  });

  router.delete(`${base}/rules/:id`, gate, blockWhileImpersonating, writeLimit, async (req: any, res: Response) => {
    try {
      if (!(await deleteRule(pool, userOf(req), String(req.params.id)))) throw new ForwardError("not_found", "قانون پیدا نشد");
      res.json({ ok: true });
    } catch (err) { fail(res, err, "sms-forward delete rule error"); }
  });

  router.post(`${base}/rules/:id/test`, gate, blockWhileImpersonating, perUserRateLimit("sms-forward-test", 30, HOUR, hitFn), async (req: any, res: Response) => {
    try {
      const uid = userOf(req);
      const account = await getAccountByUser(pool, uid);
      if (!account) throw new ForwardError("no_account", "ابتدا وبهوک را بسازید");
      const rule = await getRule(pool, uid, String(req.params.id));
      if (!rule) throw new ForwardError("not_found", "قانون پیدا نشد");
      const text = "✅ تست «ارسال پیامک به تلگرام» — اگر این پیام را می‌بینید، قانونِ «" + rule.name + "» درست کار می‌کند.";
      const out = await dispatchToRule(rule, text, sendersFor(account, userbot, botSend));
      await writeLog(pool, uid, {
        ruleId: rule.id, ruleName: rule.name, sender: "test", contentHash: contentHash("test", text + Date.now()),
        textLen: text.length, status: out.ok ? "sent" : "failed", via: out.via, error: out.error,
      });
      res.json({ ok: out.ok, via: out.via, error: out.error });
    } catch (err) { fail(res, err, "sms-forward test rule error"); }
  });

  router.get(`${base}/log`, gate, async (req: any, res: Response) => {
    try { res.json({ log: await listLog(pool, userOf(req), Number(req.query.limit) || 50) }); }
    catch (err) { fail(res, err, "sms-forward log error"); }
  });

  return router;
}

export default createSmsForwarderRouter();
