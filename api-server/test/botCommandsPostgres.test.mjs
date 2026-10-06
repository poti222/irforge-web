/**
 * test/botCommandsPostgres.test.mjs — لایوباگ ۲۰۲۶-۱۰-۰۶ (بات نوشاذین، تننتِ cut-over‌شده به Postgres):
 *   «Couldn't update the Telegram menu — خطای غیرمنتظره روی سرور» + «تمامی اطلاعات باید از روی SQL خونده بشه، اگه از
 *   sheet میخونه یه ایرادی هست».
 *
 * علت: بات برایِ این تننت `bot_settings` و `custom_commands` را از Postgres می‌خواند (لاگِ بات: "cutover:
 * 'bot_settings' now routing to Postgres"), ولی سایت `bot_settings` را اصلاً نمی‌شناخت و `custom_commands` را بدونِ
 * ستونِ `source` می‌نوشت → همه‌چیز روی Google Sheets می‌رفت: سهمیه‌یِ خواندن (۶۰/دقیقه) می‌سوخت (HTTP 429 → ۵۰۰)، و
 * حتی وقتی موفق می‌شد بات چیزی نمی‌دید.
 *
 * اینجا روتِ واقعیِ `routes/botCommands.ts` روی دو Postgres واقعی (دیتابیسِ اپ + دیتابیسِ business با migrationهایِ
 * خودِ بات) اجرا می‌شود، با شیتِ جعلی که **هر دسترسی به آن شکست می‌دهد** — اثبات می‌کند هیچ چیز از Sheets نمی‌آید/
 * نمی‌رود. فقط با CARD_TEST_PG_URL و BUSINESS_DATABASE_URL.
 */
process.env.BOT_TOKEN_ENCRYPTION_KEY = "ab".repeat(32);
process.env.REGISTRY_SPREADSHEET_ID ??= "sheet-registry";

import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";

const PG_URL = process.env.CARD_TEST_PG_URL;
const BIZ_URL = process.env.BUSINESS_DATABASE_URL;
const live = { skip: PG_URL && BIZ_URL ? false : "CARD_TEST_PG_URL / BUSINESS_DATABASE_URL تنظیم نشده" };
let pgMod = null;
try { pgMod = await import("pg"); } catch { /* skip */ }
const Pool = pgMod?.default?.Pool ?? pgMod?.Pool;

const schema = `cpg_${Math.random().toString(36).slice(2, 10)}`;
let admin = null;
let biz = null;
if (PG_URL && BIZ_URL && Pool) {
  admin = new Pool({ connectionString: PG_URL, max: 2 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const u = new URL(PG_URL);
  u.searchParams.set("options", `-c search_path=${schema}`);
  process.env.DATABASE_URL = u.toString();
  biz = new Pool({ connectionString: BIZ_URL, max: 2 });
} else {
  process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";
}

const dbm = await import("@workspace/db");
const { ddlFor } = await import("./helpers/drizzleDdl.mjs");
const { DDL_ALL } = await import("./helpers/cardPayDdl.mjs");
const { hashSessionToken } = await import("../src/lib/sessionToken.ts");
const { encryptToken } = await import("../src/lib/tokenCrypto.ts");
const botConfigMod = await import("../src/lib/botConfig.ts");
const catalogMod = await import("../src/lib/pluginCatalog.ts");
const { pgSetEntity, pgGetEntity, pgListEntity, pgDeleteEntity } = await import("../src/lib/businessPg.ts");
const router = (await import("../src/routes/botCommands.ts")).default;
const { CORE_COMMANDS } = await import("../src/lib/coreCommandsCatalog.ts");

const SID = `sheet-pg-${Date.now()}`;
const BOT = "bot_pg";
const TOKEN = "tok_owner_pg";

// شیتِ «منفجر شونده»: هر دسترسی به Google Sheets برایِ این تننت یعنی باگ.
let sheetTouches = [];
const boom = (what) => async (...args) => { sheetTouches.push(`${what}:${args[1] ?? ""}:${args[2] ?? ""} @ ${new Error().stack.split("\n").slice(2, 6).join(" <- ")}`); throw new Error(`Sheets must not be touched (${what})`); };
Object.assign(botConfigMod.sheetLayer, { readTabRows: boom("read"), upsertRow: boom("upsert"), deleteRow: boom("delete"), listTabs: boom("tabs") });
catalogMod.resetPluginCatalogCacheForTests();
// کاتالوگِ پلاگین‌ها از شیتِ «رجیستری»ی پلتفرم می‌آید (نه شیتِ تننت) — اینجا جعلی و جدا.
Object.assign(catalogMod.catalogSheetLayer, {
  async readTabRows() {
    return [["ticket", { id: "ticket", name_fa: "تیکت", menu_commands: [{ command: "newticket", description_fa: "ثبت تیکت" }] }]]
      .map(([key, value]) => ({ key, value, raw: false }));
  },
});

const realFetch = globalThis.fetch;
const tg = { menu: [], calls: [] };
globalThis.fetch = async (url, init) => {
  const m = String(url).match(/^https:\/\/api\.telegram\.org\/bot[^/]+\/(\w+)$/);
  if (!m) return realFetch(url, init);
  const body = init?.body ? JSON.parse(init.body) : {};
  tg.calls.push(m[1]);
  const reply = (o) => new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/json" } });
  if (m[1] === "getMyCommands") return reply({ ok: true, result: tg.menu });
  if (m[1] === "setMyCommands") { tg.menu = body.commands.map((c) => ({ ...c })); return reply({ ok: true, result: true }); }
  return reply({ ok: false, description: "unexpected" });
};

async function setup() {
  const pool = dbm.pool;
  await pool.query(ddlFor(dbm.usersTable, dbm.sessionsTable, dbm.botsTable, dbm.botManagersTable));
  await pool.query(DDL_ALL);
  await pool.query("INSERT INTO users (id, name, email, role) VALUES ('u_owner','مالک','owner@example.com','user')");
  await pool.query("INSERT INTO sessions (token, user_id, expires_at, last_used_at) VALUES ($1,'u_owner', now() + interval '1 day', now())", [hashSessionToken(TOKEN)]);
  await pool.query("INSERT INTO bots (id, user_id, name, token, sheet_id) VALUES ($1,'u_owner','نوشاذین',$2,$3)", [BOT, encryptToken("123456:TESTTOKEN"), SID]);
  for (const entity of ["bot_settings", "custom_commands"]) {
    await biz.query("INSERT INTO entity_cutover_flags (entity_name, tenant_id, use_db) VALUES ($1, $2, true)", [entity, SID]);
  }
  botConfigMod.invalidateCutoverCache();
}
let ready = null;
const once = () => (ready ??= setup());

async function withServer(fn) {
  await once();
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (method, path, body) => {
    const res = await fetch(`${origin}${path}`, {
      method, headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json = null;
    try { json = await res.json(); } catch { /* 204 */ }
    return { status: res.status, json };
  };
  try { await fn(call); } finally { await new Promise((r) => server.close(r)); }
}

const base = `/bots/${BOT}/commands`;
const cmdRows = async () => Object.fromEntries((await pgListEntity(SID, "custom_commands")).map((r) => [r.key, r.value]));
// RLS: بدونِ app.tenant_id هیچ ردیفی دیده/پاک نمی‌شود — همان مسیرِ تراکنشیِ خودِ businessPg.
const clearCmds = async () => {
  for (const r of await pgListEntity(SID, "custom_commands")) await pgDeleteEntity(SID, "custom_commands", r.key);
};

test("منوی تلگرام: ذخیره روی Postgres می‌نشیند (همان جایی که بات می‌خواند)، هیچ دسترسی‌ای به Sheets نیست", live, async () => {
  await clearCmds();
  sheetTouches = [];
  tg.menu = [{ command: "start", description: "شروع" }, { command: "help", description: "راهنما" }];
  await withServer(async (call) => {
    const g = await call("GET", base);
    assert.equal(g.status, 200, JSON.stringify(g.json));
    assert.deepEqual(g.json.menu, ["start", "help"]);

    // سوییچ‌های قدیمیِ تکی (که قبلاً 500 می‌دادند)
    for (const [cmd, inMenu] of [["support", true], ["profile", true], ["help", false]]) {
      const r = await call("PUT", `${base}/${cmd}/menu`, { inMenu });
      assert.equal(r.status, 200, `${cmd}: ${JSON.stringify(r.json)}`);
    }
    assert.deepEqual(tg.menu.map((m) => m.command), ["start", "support", "profile"]);

    const put = await call("PUT", `${base}/menu`, { commands: [{ command: "profile", description: "پروفایل" }, { command: "start", description: "شروع" }] });
    assert.equal(put.status, 200, JSON.stringify(put.json));
    assert.deepEqual(tg.menu.map((m) => m.command), ["profile", "start"]);
  });
  const stored = await pgGetEntity(SID, "bot_settings", "bot_commands");
  assert.deepEqual(stored.map((m) => m.command), ["profile", "start"], "bot_settings.bot_commands در Postgres نوشته شده");
  assert.ok(await pgGetEntity(SID, "bot_settings", "updated_at"), "updated_at هم مثلِ _save_settings بات ثبت می‌شود");
  assert.deepEqual(sheetTouches, [], "هیچ دسترسی‌ای به Google Sheets نباید رخ دهد");
});

test("تلگرام قطع: منوی ذخیره‌شده از Postgres خوانده می‌شود، نه Sheets", live, async () => {
  sheetTouches = [];
  const saved = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith("https://api.telegram.org/")) throw new Error("down");
    return saved(url, init);
  };
  try {
    await withServer(async (call) => {
      const g = await call("GET", base);
      assert.equal(g.status, 200);
      assert.equal(g.json.menuLive, false);
      assert.deepEqual(g.json.menu, ["profile", "start"]);
    });
  } finally { globalThis.fetch = saved; }
  assert.deepEqual(sheetTouches, []);
});

test("بقایایِ مادی‌سازیِ قدیمی روی Postgres (source گم‌شده): بی‌اطلاع‌ها پاک، override ترمیم و گیتِ بات دوباره کار می‌کند", live, async () => {
  await clearCmds();
  sheetTouches = [];
  const sup = CORE_COMMANDS.find((c) => c.command === "support");
  const prof = CORE_COMMANDS.find((c) => c.command === "profile");
  const junk = (command, extra = {}) => pgSetEntity(SID, "custom_commands", command,
    { command, target: "", description: "", admin_only: false, is_active: true, created_at: "2026-09-28T00:00:00.000Z", ...extra });
  // نسخه‌ی قدیمیِ سایت `source` را نمی‌نوشت ⇒ ستون پیش‌فرضِ 'custom' می‌گرفت
  await junk("support", { description: sup.description, admin_only: sup.adminOnly });                          // بی‌اطلاع ⇒ پاک
  await junk("profile", { description: prof.description, admin_only: prof.adminOnly, is_active: false });     // مالک خاموش کرده ⇒ ترمیم
  await junk("newticket", { description: "ثبت تیکت", is_active: false });                                      // پلاگین (روشن/خاموش فرقی ندارد) ⇒ ترمیم
  await junk("ghost_cmd");                                                                                      // صاحب‌ندار و بی‌target ⇒ پاک
  await pgSetEntity(SID, "custom_commands", "wallet", { command: "wallet", target: "wallet", description: "کیف پول", admin_only: false, is_active: true, created_at: "2026-10-01T00:00:00.000Z", source: "custom" });

  await withServer(async (call) => {
    const g = await call("GET", base);
    assert.equal(g.status, 200, JSON.stringify(g.json));
    assert.equal(g.json.purged, 2);
    assert.deepEqual(g.json.commands.map((c) => c.command), ["wallet"]);
    assert.equal(g.json.builtins.find((b) => b.command === "profile").is_active, false, "خاموش‌کردنِ مالک حفظ شد");
  });
  const rows = await cmdRows();
  assert.deepEqual(Object.keys(rows).sort(), ["newticket", "profile", "wallet"]);
  assert.equal(rows.profile.source, "core", "source روی Postgres ماندگار شد (ستونِ source)");
  assert.equal(rows.newticket.source, "plugin:ticket");
  assert.equal(rows.profile.is_active, false);
  assert.equal(rows.wallet.source, "custom");
  assert.deepEqual(sheetTouches, []);
});

test("DELETE کامندِ داخلی روی Postgres: ردیفِ override با source='core' و is_active=false (همان چیزی که گیتِ بات می‌خواند)", live, async () => {
  await clearCmds();
  sheetTouches = [];
  tg.menu = [{ command: "support", description: "پشتیبانی" }];
  await withServer(async (call) => {
    const r = await call("DELETE", `${base}/support`);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.disabledInstead, true);
  });
  const rows = await cmdRows();
  assert.equal(rows.support.source, "core");
  assert.equal(rows.support.is_active, false);
  assert.deepEqual(tg.menu, [], "از منوی تلگرام هم برداشته شد");
  assert.deepEqual(sheetTouches, []);
});

test("reorder روی Postgres ماندگار است (ستونِ `order` وجود ندارد؛ ترتیب با created_at می‌ماند)", live, async () => {
  await clearCmds();
  sheetTouches = [];
  const mk = (command, n) => ({ command, target: "admin", description: command, admin_only: false, is_active: true, created_at: new Date(1_700_000_000_000 + n * 1000).toISOString(), source: "custom" });
  await pgSetEntity(SID, "custom_commands", "a", mk("a", 1));
  await pgSetEntity(SID, "custom_commands", "b", mk("b", 2));
  await pgSetEntity(SID, "custom_commands", "c", mk("c", 3));
  await withServer(async (call) => {
    assert.deepEqual((await call("GET", base)).json.commands.map((c) => c.command), ["a", "b", "c"]);
    let r = await call("POST", `${base}/c/reorder`, { direction: "up" });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    // یک GET تازه (نه پاسخِ همان درخواست) ترتیبِ ذخیره‌شده در Postgres را می‌بیند
    assert.deepEqual((await call("GET", base)).json.commands.map((c) => c.command), ["a", "c", "b"]);
    r = await call("POST", `${base}/a/reorder`, { direction: "down" });
    assert.deepEqual((await call("GET", base)).json.commands.map((c) => c.command), ["c", "a", "b"]);
  });
  assert.deepEqual(sheetTouches, []);
});

test("ساختِ کامندِ سفارشی روی Postgres: source='custom' و order بدونِ خطا؛ نامِ داخلی رزرو", live, async () => {
  await clearCmds();
  sheetTouches = [];
  await withServer(async (call) => {
    const dup = await call("POST", base, { command: "support", target: "admin" });
    assert.equal(dup.status, 409);
    const ok = await call("POST", base, { command: "mycmd", target: "admin", description: "من" });
    assert.equal(ok.status, 201, JSON.stringify(ok.json));
  });
  const rows = await cmdRows();
  assert.deepEqual(Object.keys(rows), ["mycmd"]);
  assert.equal(rows.mycmd.source, "custom");
  assert.deepEqual(sheetTouches, []);
});

test.after(async () => {
  globalThis.fetch = realFetch;
  if (biz) {
    try { await biz.query("DELETE FROM entity_cutover_flags WHERE tenant_id = $1", [SID]); } catch { /* ignore */ }
    try { for (const r of await pgListEntity(SID, "custom_commands")) await pgDeleteEntity(SID, "custom_commands", r.key); } catch { /* ignore */ }
    try { for (const r of await pgListEntity(SID, "bot_settings")) await pgDeleteEntity(SID, "bot_settings", r.key); } catch { /* ignore */ }
    await biz.end();
  }
  if (admin) {
    try { await dbm.pool.end(); } catch { /* ignore */ }
    try { await admin.query(`DROP SCHEMA ${schema} CASCADE`); } catch { /* ignore */ }
    await admin.end();
  }
});
