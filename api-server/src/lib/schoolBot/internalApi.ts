/**
 * lib/schoolBot/internalApi.ts — باتِ مدرسه دادهٔ هر کاربر را از *همان* endpointهایِ سایت می‌خواند (نه کپیِ کوئری‌ها)،
 * پس همهٔ قواعد (قیمومت، گیتِ درس، مرزِ مدرسه، تومب‌استونِ اخطار، سقفِ نرخِ per-user) عیناً اعمال می‌شود.
 * ─────────────────────────────────────────────────────────────────────────
 * یک اپِ Expressِ داخلی فقط روی 127.0.0.1 (پورتِ تصادفی، بیرون در دسترس نیست) با *همان* routerِ `/api` ولی بدونِ
 * محدودکنندهٔ سراسریِ IP (همهٔ ترافیکِ بات از یک IP می‌آید). برایِ هر فراخوانی یک نشستِ کوتاه‌عمر (۳ دقیقه) برایِ
 * *همان کاربرِ لینک‌شده* ساخته می‌شود — توانی بیش از خودِ کاربر ندارد. فقط ورودیِ تلگرام که قبلاً با «چت→مشترک» به
 * یک userId نگاشت شده به این‌جا می‌رسد؛ callback_data هرگز اعتماد نمی‌شود (همهٔ idها دوباره توسطِ endpoint سنجیده می‌شوند).
 */
import crypto from "crypto";
import http from "http";
import express from "express";
import { db, sessionsTable } from "@workspace/db";
import { hashSessionToken, hashUserAgent } from "../sessionToken";
import { sanitizeBody } from "../../middleware/sanitizeBody";
import { logger } from "../logger";

let baseP: Promise<string> | null = null;
function base(): Promise<string> {
  baseP ??= (async () => {
    const router = (await import("../../routes/index.js")).default;
    const app = express();
    app.use(express.json({ limit: "256kb" }));
    app.use(sanitizeBody);
    app.use("/api", router);
    const srv = http.createServer(app);
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
    srv.unref();
    return `http://127.0.0.1:${(srv.address() as any).port}`;
  })();
  return baseP;
}

const sessions = new Map<string, { token: string; exp: number }>();
const SESSION_MS = 3 * 60 * 1000;

async function tokenFor(userId: string): Promise<string> {
  const cur = sessions.get(userId);
  if (cur && cur.exp - Date.now() > 30_000) return cur.token;
  const token = Buffer.from(`${userId}:${Date.now()}:${crypto.randomBytes(16).toString("hex")}`).toString("base64");
  const exp = Date.now() + SESSION_MS;
  await db.insert(sessionsTable).values({ token: hashSessionToken(token), userId, expiresAt: new Date(exp), userAgentHash: hashUserAgent("irforge-school-bot-internal") });
  sessions.set(userId, { token, exp });
  return token;
}

export type ApiResult<T = any> = { status: number; json: T };

export async function apiAs<T = any>(userId: string, method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<ApiResult<T>> {
  try {
    const [b, token] = await Promise.all([base(), tokenFor(userId)]);
    const r = await fetch(b + "/api" + path, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    let json: any = null as any;
    try { json = await r.json(); } catch { /* no body */ }
    return { status: r.status, json };
  } catch (err) {
    logger.warn({ err, path }, "school bot internal api call failed");
    return { status: 599, json: null as any };
  }
}
