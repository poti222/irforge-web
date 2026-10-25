/**
 * routes/discordBots.ts — بات‌ساز دیسکورد (کنار بات‌ساز تلگرام).
 * ─────────────────────────────────────────────────────────────────────────────
 * سایت فقط «ردیف‌های جدول discord_bots» را عوض می‌کند؛ سرویس پایتونِ `irforge-dis` هر چند ثانیه آن‌ها را
 * می‌خواند و همگرا می‌شود (روشن/خاموش، هات‌ریلودِ بلوپرینت، ری‌استارت). هیچ ارتباط مستقیمی بین Node و پایتون نیست.
 *
 *   desired_state   : "running" | "stopped"      ← سایت می‌نویسد
 *   restart_nonce   : +۱ → اتصال از نو ساخته شود  ← سایت می‌نویسد (تغییر توکن / ری‌استارت)
 *   blueprint(+ver) : تغییرِ ver → هات‌ریلودِ بی‌قطع ← سایت می‌نویسد
 *   runtime_*       : وضعیتِ واقعی                 ← فقط پایتون می‌نویسد
 */
import { Router } from "express";
import crypto from "node:crypto";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { db, usersTable, discordBotsTable, discordBotLogsTable, discordBotKvTable } from "@workspace/db";
import { requireAuth, requireAdmin } from "./auth.js";
import { perUserRateLimit } from "../middleware/rateLimit.js";
import { blockWhileImpersonating } from "../middleware/impersonation.js";
import { logger } from "../lib/logger.js";
import { encryptToken } from "../lib/tokenCrypto.js";
import { catalog, defaultBlueprint, requiredIntents, validateBlueprint } from "../lib/discordBlueprint.js";

const router = Router();

const MAX_BOTS_PER_USER = Math.max(1, Number(process.env.DISCORD_MAX_BOTS_PER_USER ?? 3) || 3);
/** اگر سرویس پایتون این‌قدر ضربان نزند، «اجراکننده خاموش است» حساب می‌شود. */
const HEARTBEAT_STALE_MS = 60_000;

// بیت‌های دسترسیِ دیسکورد برای لینک دعوت
const PERM_BITS: Record<string, bigint> = {
  view_channel: 1n << 10n, send_messages: 1n << 11n, embed_links: 1n << 14n, read_message_history: 1n << 16n,
  add_reactions: 1n << 6n, manage_messages: 1n << 13n, kick_members: 1n << 1n, ban_members: 1n << 2n,
  manage_roles: 1n << 28n, manage_nicknames: 1n << 27n, moderate_members: 1n << 40n,
};

function walkActions(actions: any[], out: any[] = []): any[] {
  for (const a of actions ?? []) {
    out.push(a);
    for (const k of ["then", "else", "actions"]) if (Array.isArray(a[k])) walkActions(a[k], out);
    for (const b of a.buttons ?? []) walkActions(b.actions ?? [], out);
    for (const sel of a.selects ?? []) walkActions(sel.actions ?? [], out);
  }
  return out;
}

export function invitePermissions(bp: any): string {
  let bits = PERM_BITS.view_channel | PERM_BITS.send_messages | PERM_BITS.embed_links;
  const types = new Map<string, string[]>((catalog.actions as any[]).map((a) => [a.type, a.botPermissions as string[]]));
  const roots = [...(bp?.commands ?? []).map((c: any) => c.actions), ...(bp?.events ?? []).map((e: any) => e.actions)];
  for (const list of roots) for (const a of walkActions(list)) for (const p of types.get(a.type) ?? []) if (PERM_BITS[p]) bits |= PERM_BITS[p];
  return bits.toString();
}

function inviteUrl(row: { applicationId: string | null; blueprint: unknown }): string | null {
  if (!row.applicationId) return null;
  const q = new URLSearchParams({ client_id: row.applicationId, scope: "bot applications.commands", permissions: invitePermissions(row.blueprint) });
  return `https://discord.com/oauth2/authorize?${q.toString()}`;
}

function serialize(row: typeof discordBotsTable.$inferSelect, withBlueprint: boolean) {
  const hb = row.runtimeHeartbeatAt ? row.runtimeHeartbeatAt.getTime() : 0;
  const runnerStale = row.desiredState === "running" && Date.now() - Math.max(hb, row.updatedAt.getTime()) > HEARTBEAT_STALE_MS;
  const bp: any = row.blueprint ?? {};
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    tokenSet: !!row.tokenEnc,
    botUserId: row.botUserId,
    botUsername: row.botUsername,
    applicationId: row.applicationId,
    inviteUrl: inviteUrl(row),
    desiredState: row.desiredState,
    status: row.status,
    runtimeState: row.runtimeState,
    runtimeErrorCode: row.runtimeErrorCode,
    runtimeError: row.runtimeError,
    guildCount: row.guildCount,
    latencyMs: row.latencyMs,
    runtimeHeartbeatAt: row.runtimeHeartbeatAt,
    runnerStale,
    blueprintVersion: row.blueprintVersion,
    counts: { commands: (bp.commands ?? []).length, events: (bp.events ?? []).length },
    privilegedIntents: requiredIntents({ ...defaultBlueprint(), ...bp }),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(withBlueprint ? { blueprint: row.blueprint } : {}),
  };
}

async function loadOwned(req: any, res: any) {
  const [row] = await db.select().from(discordBotsTable)
    .where(and(eq(discordBotsTable.id, String(req.params.id)), eq(discordBotsTable.userId, req.userId))).limit(1);
  if (!row) { res.status(404).json({ error: "not_found" }); return null; }
  if (row.status === "suspended") { res.status(403).json({ error: "bot_suspended" }); return null; }
  return row;
}

/** توکن را از خودِ دیسکورد می‌پرسد: هم اعتبارسنجی، هم گرفتنِ آیدی/نام. (آیدی بات = application id) */
async function fetchDiscordIdentity(token: string): Promise<{ ok: true; id: string; username: string } | { ok: false; reason: "invalid" | "unreachable" }> {
  try {
    const r = await fetch("https://discord.com/api/v10/users/@me", {
      headers: { Authorization: `Bot ${token}`, "User-Agent": "IrForge (https://irforge, 1.0)" },
      signal: AbortSignal.timeout(8000),
    });
    if (r.status === 401 || r.status === 403) return { ok: false, reason: "invalid" };
    if (!r.ok) return { ok: false, reason: "unreachable" };
    const j = (await r.json()) as { id?: string; username?: string; bot?: boolean };
    if (!j.id || j.bot === false) return { ok: false, reason: "invalid" };
    return { ok: true, id: j.id, username: j.username ?? "bot" };
  } catch (err) {
    logger.warn({ err }, "discord identity check failed");
    return { ok: false, reason: "unreachable" };
  }
}

const TOKEN_RE = /^[\w-]{20,}\.[\w-]{4,}\.[\w-]{20,}$/;
function cleanToken(raw: unknown): string | null {
  const t = String(raw ?? "").trim().replace(/^Bot\s+/i, "");
  return TOKEN_RE.test(t) && t.length < 200 ? t : null;
}

const writeLimit = perUserRateLimit("discord_bot_write", 120, 60 * 60 * 1000);
const controlLimit = perUserRateLimit("discord_bot_control", 60, 10 * 60 * 1000);

// ─── GET /api/discord-bots/meta ──────────────────────────────────────────────
router.get("/discord-bots/meta", requireAuth, (_req, res) => {
  res.json({ catalog, defaultBlueprint: defaultBlueprint(), maxBotsPerUser: MAX_BOTS_PER_USER });
});

// ─── GET /api/discord-bots ───────────────────────────────────────────────────
router.get("/discord-bots", requireAuth, async (req: any, res) => {
  try {
    const rows = await db.select().from(discordBotsTable).where(eq(discordBotsTable.userId, req.userId)).orderBy(desc(discordBotsTable.createdAt));
    res.json({ bots: rows.map((r) => serialize(r, false)), maxBotsPerUser: MAX_BOTS_PER_USER });
  } catch (err) {
    logger.error({ err }, "list discord bots failed");
    res.status(500).json({ error: "internal" });
  }
});

// ─── POST /api/discord-bots ──────────────────────────────────────────────────
router.post("/discord-bots", requireAuth, perUserRateLimit("discord_bot_create", 15, 60 * 60 * 1000), blockWhileImpersonating, async (req: any, res) => {
  try {
    const name = String(req.body?.name ?? "").trim().slice(0, 60);
    if (!name) { res.status(400).json({ error: "name_required" }); return; }
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(discordBotsTable).where(eq(discordBotsTable.userId, req.userId));
    const [me] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, req.userId)).limit(1);
    if (me?.role !== "super_admin" && n >= MAX_BOTS_PER_USER) {
      res.status(409).json({ error: "bot_limit_reached", limit: MAX_BOTS_PER_USER });
      return;
    }

    let tokenEnc: string | null = null;
    let identity: { id: string; username: string } | null = null;
    if (req.body?.token) {
      const token = cleanToken(req.body.token);
      if (!token) { res.status(400).json({ error: "token_format" }); return; }
      const who = await fetchDiscordIdentity(token);
      if (!who.ok) { res.status(who.reason === "invalid" ? 400 : 502).json({ error: who.reason === "invalid" ? "token_invalid" : "discord_unreachable" }); return; }
      const [dup] = await db.select({ id: discordBotsTable.id }).from(discordBotsTable).where(eq(discordBotsTable.botUserId, who.id)).limit(1);
      if (dup) { res.status(409).json({ error: "token_in_use" }); return; }
      tokenEnc = encryptToken(token);
      identity = who;
    }

    const id = crypto.randomUUID();
    const [row] = await db.insert(discordBotsTable).values({
      id, userId: req.userId, name, description: req.body?.description ? String(req.body.description).slice(0, 300) : null,
      tokenEnc, applicationId: identity?.id ?? null, botUserId: identity?.id ?? null, botUsername: identity?.username ?? null,
      blueprint: defaultBlueprint() as any,
    }).returning();
    res.status(201).json({ bot: serialize(row, true) });
  } catch (err) {
    logger.error({ err }, "create discord bot failed");
    res.status(500).json({ error: "internal" });
  }
});

// ─── GET /api/discord-bots/:id ───────────────────────────────────────────────
router.get("/discord-bots/:id", requireAuth, async (req: any, res) => {
  try {
    const row = await loadOwned(req, res);
    if (row) res.json({ bot: serialize(row, true) });
  } catch (err) {
    logger.error({ err }, "get discord bot failed");
    res.status(500).json({ error: "internal" });
  }
});

// ─── PATCH /api/discord-bots/:id ─────────────────────────────────────────────
router.patch("/discord-bots/:id", requireAuth, writeLimit, blockWhileImpersonating, async (req: any, res) => {
  try {
    const row = await loadOwned(req, res);
    if (!row) return;
    const patch: Partial<typeof discordBotsTable.$inferInsert> = {};
    if (req.body?.name !== undefined) {
      const name = String(req.body.name).trim().slice(0, 60);
      if (!name) { res.status(400).json({ error: "name_required" }); return; }
      patch.name = name;
    }
    if (req.body?.description !== undefined) patch.description = req.body.description ? String(req.body.description).slice(0, 300) : null;
    const [upd] = await db.update(discordBotsTable).set(patch).where(eq(discordBotsTable.id, row.id)).returning();
    res.json({ bot: serialize(upd, false) });
  } catch (err) {
    logger.error({ err }, "patch discord bot failed");
    res.status(500).json({ error: "internal" });
  }
});

// ─── PUT /api/discord-bots/:id/blueprint ─────────────────────────────────────
router.put("/discord-bots/:id/blueprint", requireAuth, writeLimit, blockWhileImpersonating, async (req: any, res) => {
  try {
    const row = await loadOwned(req, res);
    if (!row) return;
    const { blueprint, errors } = validateBlueprint(req.body?.blueprint);
    if (errors.length) { res.status(400).json({ error: "blueprint_invalid", errors }); return; }
    // ذخیره‌ی بلاپرینت بدون تغییر نسخه‌ی بی‌مورد: اگر محتوا یکی است کاری نکن.
    if (JSON.stringify(blueprint) === JSON.stringify(row.blueprint)) { res.json({ bot: serialize(row, true), unchanged: true }); return; }
    const [upd] = await db.update(discordBotsTable)
      .set({ blueprint: blueprint as any, blueprintVersion: sql`${discordBotsTable.blueprintVersion} + 1` })
      .where(eq(discordBotsTable.id, row.id)).returning();
    res.json({ bot: serialize(upd, true) });
  } catch (err) {
    logger.error({ err }, "save discord blueprint failed");
    res.status(500).json({ error: "internal" });
  }
});

// ─── PUT /api/discord-bots/:id/token ─────────────────────────────────────────
router.put("/discord-bots/:id/token", requireAuth, perUserRateLimit("discord_bot_token", 20, 60 * 60 * 1000), blockWhileImpersonating, async (req: any, res) => {
  try {
    const row = await loadOwned(req, res);
    if (!row) return;
    const token = cleanToken(req.body?.token);
    if (!token) { res.status(400).json({ error: "token_format" }); return; }
    const who = await fetchDiscordIdentity(token);
    if (!who.ok) { res.status(who.reason === "invalid" ? 400 : 502).json({ error: who.reason === "invalid" ? "token_invalid" : "discord_unreachable" }); return; }
    const [dup] = await db.select({ id: discordBotsTable.id }).from(discordBotsTable).where(eq(discordBotsTable.botUserId, who.id)).limit(1);
    if (dup && dup.id !== row.id) { res.status(409).json({ error: "token_in_use" }); return; }
    const [upd] = await db.update(discordBotsTable).set({
      tokenEnc: encryptToken(token), applicationId: who.id, botUserId: who.id, botUsername: who.username,
      restartNonce: sql`${discordBotsTable.restartNonce} + 1`, syncedHash: null, runtimeErrorCode: null, runtimeError: null,
    }).where(eq(discordBotsTable.id, row.id)).returning();
    res.json({ bot: serialize(upd, false) });
  } catch (err) {
    logger.error({ err }, "set discord token failed");
    res.status(500).json({ error: "internal" });
  }
});

// ─── start / stop / restart ──────────────────────────────────────────────────
router.post("/discord-bots/:id/start", requireAuth, controlLimit, blockWhileImpersonating, async (req: any, res) => {
  try {
    const row = await loadOwned(req, res);
    if (!row) return;
    if (!row.tokenEnc) { res.status(400).json({ error: "token_missing" }); return; }
    const { errors } = validateBlueprint(row.blueprint);
    if (errors.length) { res.status(400).json({ error: "blueprint_invalid", errors }); return; }
    const [upd] = await db.update(discordBotsTable)
      .set({ desiredState: "running", runtimeState: row.runtimeState === "online" ? "online" : "starting", runtimeErrorCode: null, runtimeError: null })
      .where(eq(discordBotsTable.id, row.id)).returning();
    res.json({ bot: serialize(upd, false) });
  } catch (err) {
    logger.error({ err }, "start discord bot failed");
    res.status(500).json({ error: "internal" });
  }
});

router.post("/discord-bots/:id/stop", requireAuth, controlLimit, blockWhileImpersonating, async (req: any, res) => {
  try {
    const row = await loadOwned(req, res);
    if (!row) return;
    const [upd] = await db.update(discordBotsTable).set({ desiredState: "stopped" }).where(eq(discordBotsTable.id, row.id)).returning();
    res.json({ bot: serialize(upd, false) });
  } catch (err) {
    logger.error({ err }, "stop discord bot failed");
    res.status(500).json({ error: "internal" });
  }
});

router.post("/discord-bots/:id/restart", requireAuth, controlLimit, blockWhileImpersonating, async (req: any, res) => {
  try {
    const row = await loadOwned(req, res);
    if (!row) return;
    if (!row.tokenEnc) { res.status(400).json({ error: "token_missing" }); return; }
    const [upd] = await db.update(discordBotsTable)
      .set({ desiredState: "running", restartNonce: sql`${discordBotsTable.restartNonce} + 1`, runtimeState: "starting", runtimeErrorCode: null, runtimeError: null })
      .where(eq(discordBotsTable.id, row.id)).returning();
    res.json({ bot: serialize(upd, false) });
  } catch (err) {
    logger.error({ err }, "restart discord bot failed");
    res.status(500).json({ error: "internal" });
  }
});

// ─── DELETE /api/discord-bots/:id ────────────────────────────────────────────
router.delete("/discord-bots/:id", requireAuth, writeLimit, blockWhileImpersonating, async (req: any, res) => {
  try {
    const row = await loadOwned(req, res);
    if (!row) return;
    // اول متوقف می‌کنیم تا سرویس پایتون بات را ببندد؛ بعد داده‌ها پاک می‌شوند. اگر هنوز روشن بود، ردیف را نگه می‌داریم.
    if (row.runnerId && row.leaseUntil && row.leaseUntil.getTime() > Date.now()) {
      await db.update(discordBotsTable).set({ desiredState: "stopped" }).where(eq(discordBotsTable.id, row.id));
      res.status(409).json({ error: "still_running", hint: "stop_first" });
      return;
    }
    await db.delete(discordBotLogsTable).where(eq(discordBotLogsTable.botId, row.id));
    await db.delete(discordBotKvTable).where(eq(discordBotKvTable.botId, row.id));
    await db.delete(discordBotsTable).where(eq(discordBotsTable.id, row.id));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "delete discord bot failed");
    res.status(500).json({ error: "internal" });
  }
});

// ─── GET /api/discord-bots/:id/logs?after=<id> ───────────────────────────────
router.get("/discord-bots/:id/logs", requireAuth, async (req: any, res) => {
  try {
    const row = await loadOwned(req, res);
    if (!row) return;
    const after = Number(req.query.after ?? 0) || 0;
    const rows = await db.select().from(discordBotLogsTable)
      .where(and(eq(discordBotLogsTable.botId, row.id), gt(discordBotLogsTable.id, after)))
      .orderBy(desc(discordBotLogsTable.id)).limit(200);
    res.json({ logs: rows.reverse().map((l) => ({ id: l.id, level: l.level, message: l.message, at: l.createdAt })) });
  } catch (err) {
    logger.error({ err }, "discord logs failed");
    res.status(500).json({ error: "internal" });
  }
});

// ─── GET /api/discord-bots/:id/kv — دیتابیس ساده‌ی بات (فقط‌خواندنی) ────────
router.get("/discord-bots/:id/kv", requireAuth, async (req: any, res) => {
  try {
    const row = await loadOwned(req, res);
    if (!row) return;
    const rows = await db.select().from(discordBotKvTable).where(eq(discordBotKvTable.botId, row.id)).orderBy(discordBotKvTable.k).limit(200);
    res.json({ items: rows.map((r) => ({ key: r.k, value: r.v, updatedAt: r.updatedAt })) });
  } catch (err) {
    logger.error({ err }, "discord kv failed");
    res.status(500).json({ error: "internal" });
  }
});

// ─── ادمین ───────────────────────────────────────────────────────────────────
router.get("/admin/discord-bots", requireAdmin, async (_req, res) => {
  try {
    const rows = await db.select({ bot: discordBotsTable, owner: usersTable.username })
      .from(discordBotsTable).leftJoin(usersTable, eq(usersTable.id, discordBotsTable.userId))
      .orderBy(desc(discordBotsTable.createdAt)).limit(500);
    res.json({ bots: rows.map((r) => ({ ...serialize(r.bot, false), userId: r.bot.userId, ownerUsername: r.owner })) });
  } catch (err) {
    logger.error({ err }, "admin discord bots failed");
    res.status(500).json({ error: "internal" });
  }
});

router.post("/admin/discord-bots/:id/suspend", requireAdmin, async (req: any, res) => {
  try {
    const suspend = req.body?.suspended !== false;
    const [upd] = await db.update(discordBotsTable)
      .set(suspend ? { status: "suspended", desiredState: "stopped" } : { status: "active" })
      .where(eq(discordBotsTable.id, String(req.params.id))).returning();
    if (!upd) { res.status(404).json({ error: "not_found" }); return; }
    logger.info({ botId: upd.id, actor: req.userId, suspend }, "discord bot suspension changed");
    res.json({ bot: serialize(upd, false) });
  } catch (err) {
    logger.error({ err }, "admin suspend discord bot failed");
    res.status(500).json({ error: "internal" });
  }
});

export default router;
