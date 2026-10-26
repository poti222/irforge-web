/**
 * lib/smsForwardUserbot.ts — مسیرِ «اکانتِ شخصی» در «ارسال پیامک به تلگرام».
 *
 * پیام از خودِ اکانتِ تلگرامِ کاربر (MTProto، کتابخانه‌ی gramjs) فرستاده می‌شود. ورود با شماره + کدِ تلگرام
 * (+ رمزِ دومرحله‌ای اگر داشت). فقط `StringSession` ذخیره می‌شود (AES-256-GCM، lib/tokenCrypto) — رمز و کد
 * هرگز ذخیره نمی‌شوند.
 *
 * ⚠️ ریسک‌ها (در UI هم گفته شده): ارسالِ خودکار از اکانتِ شخصی خلافِ ToSِ تلگرام نیست مادام که اسپم نباشد، ولی
 * اکانت‌هایی که پشت‌سرهم و انبوه پیام می‌فرستند محدود/بن می‌شوند؛ سشن هم معادلِ دسترسیِ کاملِ اکانت است.
 * کلیدِ `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` (از my.telegram.org) باید روی سرور تنظیم شود، وگرنه این مسیر
 * «در دسترس نیست» گزارش می‌شود و بقیه‌ی سیستم (بات) بی‌تأثیر کار می‌کند.
 *
 * gramjs سنگین است و فقط وقتی لازم شد import می‌شود (dynamic import) — بوتِ سرور و تست‌ها را کند نمی‌کند.
 */
import type { SendResult } from "./smsForwarder";
import { logger } from "./logger";

export class UserbotError extends Error {
  constructor(public code: "unavailable" | "bad_phone" | "no_pending" | "bad_code" | "code_expired" | "password_needed" | "bad_password" | "flood" | "failed", message: string) {
    super(message);
  }
}

export interface UserbotDriver {
  available(): boolean;
  startLogin(userId: string, phone: string): Promise<{ codeViaApp: boolean }>;
  completeLogin(userId: string, code: string, password?: string): Promise<{ session: string; label: string }>;
  cancelLogin(userId: string): Promise<void>;
  send(userId: string, session: string, chatRef: string, text: string): Promise<SendResult>;
  logout(session: string): Promise<void>;
}

function credentials(): { apiId: number; apiHash: string } | null {
  const apiId = Number(process.env.TELEGRAM_API_ID);
  const apiHash = process.env.TELEGRAM_API_HASH?.trim();
  return Number.isInteger(apiId) && apiId > 0 && apiHash ? { apiId, apiHash } : null;
}

const PENDING_TTL_MS = 10 * 60_000;
const SEND_TIMEOUT_MS = 25_000;

interface Pending {
  client: any;
  phone: string;
  phoneCodeHash: string;
  expires: number;
}
const pending = new Map<string, Pending>();

export function normalizePhone(raw: unknown): string {
  const v = typeof raw === "string" ? raw.replace(/[\s\-()]/g, "") : "";
  if (!/^\+?\d{8,15}$/.test(v)) throw new UserbotError("bad_phone", "شماره را با کدِ کشور وارد کنید (مثل +98912…)");
  return v.startsWith("+") ? v : `+${v}`;
}

async function loadGram() {
  const gram = await import("telegram");
  const sessions = await import("telegram/sessions/index.js");
  return { TelegramClient: gram.TelegramClient, Api: gram.Api, StringSession: sessions.StringSession };
}

async function newClient(session: string) {
  const creds = credentials();
  if (!creds) throw new UserbotError("unavailable", "ورود با اکانتِ شخصی روی این سرور فعال نیست");
  const { TelegramClient, StringSession } = await loadGram();
  const client = new TelegramClient(new StringSession(session), creds.apiId, creds.apiHash, { connectionRetries: 2 });
  client.setLogLevel("none" as any);
  return { client, creds };
}

async function dispose(client: any): Promise<void> {
  try { await client.disconnect(); } catch { /* ignore */ }
  try { await client.destroy(); } catch { /* ignore */ }
}

function gramMessage(err: unknown): string {
  const e = err as { errorMessage?: string; message?: string };
  return String(e?.errorMessage ?? e?.message ?? "error");
}

function dropExpired(): void {
  const now = Date.now();
  for (const [k, p] of pending) {
    if (p.expires < now) {
      pending.delete(k);
      void dispose(p.client);
    }
  }
}

// ارسال‌های هر کاربر پشت‌سرهم (یک اتصالِ همزمان به ازای هر اکانت)
const queues = new Map<string, Promise<unknown>>();
function enqueue<T>(key: string, job: () => Promise<T>): Promise<T> {
  const prev = queues.get(key) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(job);
  queues.set(key, next);
  void next.finally(() => { if (queues.get(key) === next) queues.delete(key); }).catch(() => {});
  return next;
}

export const gramUserbot: UserbotDriver = {
  available: () => credentials() !== null,

  async startLogin(userId, phone) {
    dropExpired();
    const number = normalizePhone(phone);
    const old = pending.get(userId);
    if (old) { pending.delete(userId); await dispose(old.client); }
    const { client, creds } = await newClient("");
    try {
      await client.connect();
      const sent = await client.sendCode(creds, number);
      pending.set(userId, { client, phone: number, phoneCodeHash: sent.phoneCodeHash, expires: Date.now() + PENDING_TTL_MS });
      return { codeViaApp: Boolean(sent.isCodeViaApp) };
    } catch (err) {
      await dispose(client);
      const m = gramMessage(err);
      if (/PHONE_NUMBER_INVALID/.test(m)) throw new UserbotError("bad_phone", "شماره نامعتبر است");
      if (/FLOOD/.test(m)) throw new UserbotError("flood", "تلگرام موقتاً محدود کرده؛ بعداً دوباره تلاش کنید");
      logger.warn({ err: m }, "userbot sendCode failed");
      throw new UserbotError("failed", "ارسالِ کد ناموفق بود");
    }
  },

  async completeLogin(userId, code, password) {
    dropExpired();
    const p = pending.get(userId);
    if (!p) throw new UserbotError("no_pending", "درخواستِ ورود منقضی شده؛ دوباره شماره را وارد کنید");
    const { Api } = await loadGram();
    const creds = credentials()!;
    const client = p.client;
    try {
      try {
        await client.invoke(new Api.auth.SignIn({ phoneNumber: p.phone, phoneCodeHash: p.phoneCodeHash, phoneCode: String(code).replace(/\s+/g, "") }));
      } catch (err) {
        if (!/SESSION_PASSWORD_NEEDED/.test(gramMessage(err))) throw err;
        if (!password) throw new UserbotError("password_needed", "این اکانت رمزِ دومرحله‌ای دارد");
        await client.signInWithPassword(creds, {
          password: async () => password,
          onError: async (e: Error) => { throw e; },
        });
      }
      const me = (await client.getMe()) as { username?: string; firstName?: string; lastName?: string };
      const label = me.username ? `@${me.username}` : [me.firstName, me.lastName].filter(Boolean).join(" ") || p.phone;
      const session = String(client.session.save());
      pending.delete(userId);
      await dispose(client);
      return { session, label };
    } catch (err) {
      if (err instanceof UserbotError) throw err; // password_needed: pending می‌ماند
      const m = gramMessage(err);
      if (/PHONE_CODE_INVALID/.test(m)) throw new UserbotError("bad_code", "کد اشتباه است");
      if (/PHONE_CODE_EXPIRED/.test(m)) { pending.delete(userId); await dispose(client); throw new UserbotError("code_expired", "کد منقضی شد؛ دوباره شماره را وارد کنید"); }
      if (/PASSWORD_HASH_INVALID/.test(m)) throw new UserbotError("bad_password", "رمزِ دومرحله‌ای اشتباه است");
      if (/FLOOD/.test(m)) throw new UserbotError("flood", "تلگرام موقتاً محدود کرده؛ بعداً دوباره تلاش کنید");
      logger.warn({ err: m }, "userbot sign-in failed");
      throw new UserbotError("failed", "ورود ناموفق بود");
    }
  },

  async cancelLogin(userId) {
    const p = pending.get(userId);
    pending.delete(userId);
    if (p) await dispose(p.client);
  },

  send(userId, session, chatRef, text) {
    return enqueue(userId, async (): Promise<SendResult> => {
      let client: any = null;
      const work = (async (): Promise<SendResult> => {
        ({ client } = await newClient(session));
        await client.connect();
        if (!(await client.checkAuthorization())) return { ok: false, error: "نشستِ اکانت منقضی شده؛ دوباره وصل کنید" };
        const entity: string | number = chatRef === "me" ? "me" : /^-?\d{5,20}$/.test(chatRef) ? Number(chatRef) : chatRef;
        const msg = { message: text, linkPreview: false };
        try {
          await client.sendMessage(entity, msg);
        } catch (err) {
          // شناسه‌ی عددیِ کاربر/گروه تا وقتی در کشِ دیالوگ‌ها نیست پیدا نمی‌شود؛ یک‌بار کش را پر کن و دوباره.
          if (!/Could not find the input entity|PEER_ID_INVALID/i.test(gramMessage(err))) throw err;
          await client.getDialogs({ limit: 300 });
          await client.sendMessage(entity, msg);
        }
        return { ok: true };
      })();
      let timer: NodeJS.Timeout | undefined;
      try {
        return await Promise.race([
          work,
          new Promise<SendResult>((resolve) => { timer = setTimeout(() => resolve({ ok: false, error: "timeout" }), SEND_TIMEOUT_MS); }),
        ]);
      } catch (err) {
        const m = gramMessage(err);
        if (/AUTH_KEY|SESSION_REVOKED|USER_DEACTIVATED/.test(m)) return { ok: false, error: "نشستِ اکانت منقضی شده؛ دوباره وصل کنید" };
        if (/FLOOD/.test(m)) return { ok: false, error: "محدودیتِ موقتِ تلگرام (flood)" };
        return { ok: false, error: m.slice(0, 200) };
      } finally {
        if (timer) clearTimeout(timer);
        if (client) await dispose(client);
      }
    });
  },

  async logout(session) {
    // بهترین‌تلاش: نشست را سمتِ تلگرام هم ببند تا رشته‌ی ذخیره‌شده‌ی قبلی بی‌اثر شود.
    let client: any = null;
    try {
      const { Api } = await loadGram();
      ({ client } = await newClient(session));
      await client.connect();
      await client.invoke(new Api.auth.LogOut());
    } catch { /* ignore */ } finally {
      if (client) await dispose(client);
    }
  },
};
