/**
 * e2e/emoji-e2e.mjs — ایموجیِ سفارشی: API وب (در یک پروسه، Sheets جعلی + تلگرام جعلی) → کدِ پایتونِ اپ.
 * اجرا: DATABASE_URL=... node --import tsx/esm e2e/emoji-e2e.mjs   (بعد از migrate.mjs)
 */
import http from "http";
import crypto from "crypto";
import { spawnSync } from "child_process";

process.env.DATABASE_URL ||= "postgres://postgres@localhost:5433/mm?host=/tmp";
process.env.TELEGRAM_API_BASE = "http://localhost:9998";
process.env.NODE_ENV = "development";
process.env.SESSION_SECRET ||= "e2e";
process.env.BOT_TOKEN_ENCRYPTION_KEY ||= crypto.randomBytes(32).toString("hex");

const PACKS = {
  FirePack: { sticker_type: "custom_emoji", stickers: [
    { custom_emoji_id: "5368324170671202286", emoji: "🔥", is_animated: true },
    { custom_emoji_id: "5368324170671202287", emoji: "🎉", is_video: true },
    { custom_emoji_id: "5368324170671202288", emoji: "❤️" },
  ] },
  RegularStickers: { sticker_type: "regular", stickers: [{ emoji: "😀" }] },
};
const stub = http.createServer((req, res) => {
  let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => {
    const method = req.url.split("/").pop(); const body = JSON.parse(b || "{}");
    res.setHeader("content-type", "application/json");
    if (method === "getStickerSet") {
      const p = PACKS[body.name];
      return res.end(JSON.stringify(p ? { ok: true, result: p } : { ok: false, description: "Bad Request: STICKERSET_INVALID" }));
    }
    if (method === "getCustomEmojiStickers") {
      return res.end(JSON.stringify({ ok: true, result: body.custom_emoji_ids.map((id) => ({ custom_emoji_id: id, emoji: "✨", is_animated: true, set_name: "SomeSet" })) }));
    }
    res.end(JSON.stringify({ ok: true, result: true }));
  });
}).listen(9998);

const { db, usersTable, botsTable, sessionsTable } = await import("@workspace/db");
const { sheetLayer } = await import("./../src/lib/botConfig.ts");
const { hashSessionToken } = await import("./../src/lib/sessionToken.ts");
const { encryptToken } = await import("./../src/lib/tokenCrypto.ts");

// Sheets جعلی (حافظه‌ای) روی همان seam تستیِ رسمی
const store = new Map();
Object.assign(sheetLayer, {
  readTabRows: async (sid, tab) => [...(store.get(`${sid}|${tab}`) ?? new Map()).entries()].map(([key, value]) => ({ key, value })),
  upsertRow: async (sid, tab, key, value) => { const m = store.get(`${sid}|${tab}`) ?? new Map(); const created = !m.has(key); m.set(key, value); store.set(`${sid}|${tab}`, m); return { created }; },
  deleteRow: async () => true, listTabs: async () => [],
});

const app = (await import("./../src/app.ts")).default;
const server = app.listen(3066);
const BASE = "http://localhost:3066/api";

const mkUser = async (tag) => {
  const id = crypto.randomUUID(); const token = `${id}.${crypto.randomBytes(16).toString("hex")}`;
  await db.insert(usersTable).values({ id, name: tag, email: `${tag}-${id.slice(0, 6)}@e2e.test`, passwordHash: "x", role: "user", plan: "free", status: "active" });
  await db.insert(sessionsTable).values({ token: hashSessionToken(token), userId: id, expiresAt: new Date(Date.now() + 3600e3) });
  return { id, token };
};
const owner = await mkUser("owner"), other = await mkUser("other");
const botId = crypto.randomUUID();
await db.insert(botsTable).values({ id: botId, name: "E2E bot", token: encryptToken("123456:E2E-TOKEN"), userId: owner.id, sheetId: "sheet_emoji_e2e", status: "active" });

const call = async (path, method = "GET", body, tok = owner.token) => {
  const r = await fetch(BASE + path, { method, headers: { "content-type": "application/json", authorization: `Bearer ${tok}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
};
let pass = 0, fail = 0;
const check = (n, c, x = "") => { c ? (pass++, console.log("  ✓", n)) : (fail++, console.log("  ✗", n, x)); };
const P = `/bots/${botId}/custom-emojis`;

try {
  console.log("Web API");
  let r = await call(P);
  check("GET empty catalog", r.status === 200 && Array.isArray(r.body.emojis) && r.body.emojis.length === 0, JSON.stringify(r));
  r = await call(P, "PUT", { emojis: [{ name: "Fire", id: "5368324170671202286", fallback: "🔥" }] });
  check("PUT saves + normalises (lowercase name, animated default true)", r.status === 200 && r.body.emojis[0].name === "fire" && r.body.emojis[0].animated === true, JSON.stringify(r));
  r = await call(P);
  check("GET returns what was saved (persisted through bot settings)", r.body.emojis.length === 1 && r.body.emojis[0].id === "5368324170671202286", JSON.stringify(r));
  check("PUT rejects bad name", (await call(P, "PUT", { emojis: [{ name: "1bad", id: "5368324170671202286" }] })).status === 400);
  check("PUT rejects bad id", (await call(P, "PUT", { emojis: [{ name: "ok_name", id: "12" }] })).status === 400);
  check("PUT rejects duplicate names", (await call(P, "PUT", { emojis: [{ name: "dup", id: "11111" }, { name: "dup", id: "22222" }] })).status === 400);
  check("PUT rejects non-array", (await call(P, "PUT", { emojis: "x" })).status === 400);
  r = await call(P, "POST".replace("POST", "POST"), undefined);
  r = await call(`${P}/import-pack`, "POST", { pack: "https://t.me/addemoji/FirePack" });
  check("import-pack: custom-emoji pack imported (fire already exists ⇒ 2 new, id-dedupe)", r.status === 200 && r.body.report[0].added === 2 && r.body.emojis.length === 3, JSON.stringify(r).slice(0, 400));
  check("import-pack: names are unique + valid", new Set(r.body.emojis.map((e) => e.name)).size === 3 && r.body.emojis.every((e) => /^[a-z][a-z0-9_]{1,31}$/.test(e.name)), JSON.stringify(r.body.emojis.map((e) => e.name)));
  check("import-pack: video sticker ⇒ animated, plain ⇒ static", r.body.emojis.find((e) => e.id.endsWith("287"))?.animated === true && r.body.emojis.find((e) => e.id.endsWith("288"))?.animated === false);
  r = await call(`${P}/import-pack`, "POST", { pack: "FirePack" });
  check("import-pack again adds nothing (idempotent)", r.body.report[0].added === 0 && r.body.emojis.length === 3);
  r = await call(`${P}/import-pack`, "POST", { packs: ["RegularStickers", "Nope"] });
  check("import-pack: regular-sticker pack + unknown pack ⇒ reported errors, catalog untouched", r.status === 200 && r.body.report.every((x) => x.error) && r.body.emojis.length === 3, JSON.stringify(r).slice(0, 300));
  check("import-pack: garbage input ⇒ 400", (await call(`${P}/import-pack`, "POST", { pack: "!!!" })).status === 400);
  r = await call(`${P}/import-ids`, "POST", { ids: ["7000000000001", "7000000000002", "abc"] });
  check("import-ids: valid ids added, invalid dropped", r.status === 200 && r.body.emojis.length === 5, JSON.stringify(r).slice(0, 300));
  check("import-ids: nothing valid ⇒ 400", (await call(`${P}/import-ids`, "POST", { ids: ["x"] })).status === 400);
  check("another user cannot read/write this bot's emojis", [(await call(P, "GET", undefined, other.token)).status, (await call(P, "PUT", { emojis: [] }, other.token)).status].every((s) => s === 403 || s === 404));
  check("unauthenticated ⇒ 401", (await fetch(BASE + P)).status === 401);
  // یکی را غیرفعال کنیم و به اپ بدهیم
  const cur = (await call(P)).body.emojis.map((e, i) => (i === 1 ? { ...e, enabled: false } : e));
  await call(P, "PUT", { emojis: cur });
  const final = (await call(P)).body.emojis;
  check("disabled flag round-trips", final[1].enabled === false);

  console.log("Web → App (Python) contract");
  const py = `
import json, sys
sys.path.insert(0, ".")
sys.path.insert(0, "${"/home/claude/m/emoji/irforge-app-main"}")
from utils.custom_emoji import catalog_from_settings, render_custom_emoji
from plugins._common.html_whitelist import sanitize_telegram_html
data = json.loads(sys.stdin.read())
cat = catalog_from_settings({"custom_emojis": data})
names = [e["name"] for e in cat]
enabled = [e for e in cat if e["enabled"]]
out = {"n_in": len(data), "n_cat": len(cat), "same_names": names == [e["name"] for e in data]}
t = "سلام :%s: ساعت 10:30:45 و :%s: و :nope: <code>:%s:</code>" % (enabled[0]["name"], cat[1]["name"], enabled[0]["name"])
r = render_custom_emoji(t, cat)
out["rendered"] = r
out["sanitized_equal"] = sanitize_telegram_html(r) == r
print(json.dumps(out, ensure_ascii=False))
`;
  const p = spawnSync("python3", ["-c", py], { input: JSON.stringify(final), encoding: "utf8" });
  if (p.status !== 0) { fail++; console.log("  ✗ python crashed:", p.stderr.slice(0, 400)); }
  else {
    const o = JSON.parse(p.stdout);
    check("app reads every entry the web wrote (no entry dropped/renamed)", o.n_cat === o.n_in && o.same_names, p.stdout);
    const e0 = final.find((e) => e.enabled);
    check("enabled :name: ⇒ <tg-emoji emoji-id=…>fallback</tg-emoji>", o.rendered.includes(`<tg-emoji emoji-id="${e0.id}">${e0.fallback}</tg-emoji> ساعت`), o.rendered);
    check("clock 10:30:45 untouched", o.rendered.includes("10:30:45"));
    check("disabled emoji and unknown tokens untouched", o.rendered.includes(`:${final[1].name}:`) && o.rendered.includes(":nope:"), o.rendered);
    check("inside <code> untouched", o.rendered.includes(`<code>:${e0.name}:</code>`), o.rendered);
    check("rendered text survives the app's HTML whitelist unchanged", o.sanitized_equal === true, o.rendered);
  }
} catch (e) {
  fail++; console.log("crashed:", e);
} finally {
  console.log(`\n${pass} passed, ${fail} failed`);
  server.close(); stub.close(); setTimeout(() => process.exit(fail ? 1 : 0), 200);
}
