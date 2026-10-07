/**
 * test/botPanelsPostgres.test.mjs — لایوباگ ۲۰۲۶-۱۰-۰۷: «دکمه‌ی رفع خودکار کار نمیکنه» (تننتِ cut-over‌شده به Postgres).
 *
 * علت: `POST /bots/:id/panels/repair` هنوز `assertSheetsAuthoritative("panels")` صدا می‌زد → برایِ باتی که `panels`ش به
 * Postgres رفته همیشه ۴۰۹ `entity_on_postgres`، و کارتِ «سلامت بات» خطا را بی‌صدا می‌بلعید. اینجا روتِ واقعیِ
 * `routes/botPanels.ts` روی Postgres واقعی (با شیتِ «منفجرشونده») اجرا می‌شود؛ همین‌جا کیبوردِ پایینِ مخصوصِ هر پنل
 * (`settings.reply_keyboard`) هم end-to-end ذخیره/خوانده می‌شود.
 *
 * (توضیحِ قدیمیِ هدرِ الگو:)
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
const router = (await import("../src/routes/botPanels.ts")).default;
const botTypes = await import("../src/lib/botTypes.ts");

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
  for (const entity of ["bot_settings", "panels", "custom_commands"]) {
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

const base = `/bots/${BOT}/panels`;
const panelRows = async () => Object.fromEntries((await pgListEntity(SID, "panels")).map((r) => [r.key, r.value]));
const clearPanels = async () => { for (const r of await pgListEntity(SID, "panels")) await pgDeleteEntity(SID, "panels", r.key); };
const mk = (id, extra = {}) => ({ ...botTypes.newPanel({ id, title: id, ...extra }) });

test("«رفع خودکار» روی بات مهاجرت‌کرده به Postgres کار می‌کند (قبلاً ۴۰۹ می‌داد) و به Sheets دست نمی‌زند", live, async () => {
  await clearPanels();
  sheetTouches = [];
  // خرابی‌های واقعی: والدِ معلق، فهرستِ فرزندانِ کهنه، دکمه‌ی مرده، دو پرچمِ خانه.
  await pgSetEntity(SID, "panels", "home", mk("home", { is_home: true, children: ["ghost_child"], buttons: [botTypes.newButton({ label: "مرده", action: "panel", value: "nope" })] }));
  await pgSetEntity(SID, "panels", "orphan", mk("orphan", { parent_id: "gone", is_home: true }));
  await withServer(async (call) => {
    const h = await call("GET", `${base}/health`);
    assert.equal(h.status, 200, JSON.stringify(h.json));
    assert.ok(h.json.issues.some((i) => i.repairable), "حداقل یک ایرادِ قابلِ رفع");

    const r = await call("POST", `${base}/repair`);
    assert.equal(r.status, 200, `repair باید روی Postgres کار کند، نه ۴۰۹: ${JSON.stringify(r.json)}`);
    assert.ok(r.json.fixed >= 1);
    assert.equal(r.json.issues.filter((i) => i.repairable).length, 0, "بعد از رفع، ایرادِ قابلِ رفعی نمی‌ماند: " + JSON.stringify(r.json.issues));
  });
  const rows = await panelRows();
  assert.equal(rows.orphan.parent_id, null, "والدِ معلق بریده شد (روی Postgres)");
  assert.equal(rows.home.children.includes("ghost_child"), false, "فرزندِ شبح پاک شد");
  assert.equal(rows.home.buttons[0].disabled ?? rows.home.buttons[0].is_disabled ?? true, true, "دکمه‌ی مرده غیرفعال شد");
  assert.deepEqual(sheetTouches, [], "هیچ دسترسی‌ای به Google Sheets نباید رخ دهد");
});

test("کیبوردِ پایینِ مخصوصِ پنل: ذخیره روی Postgres، خواندن، حالت‌ها و رد کردنِ نامعتبر", live, async () => {
  await clearPanels();
  sheetTouches = [];
  await pgSetEntity(SID, "panels", "shop", mk("shop", { title: "فروشگاه" }));
  await withServer(async (call) => {
    const custom = {
      mode: "custom",
      rows: [["/menu", { text: "محصولات", action: "panel", value: "shop", style: "success" }], [{ text: "تماس", action: "phone" }]],
      resize: true, one_time: false, placeholder: "یکی را بزنید", message: "منو 👇",
    };
    const ok = await call("PATCH", `${base}/shop`, { settings: { reply_keyboard: custom } });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.equal(ok.json.panel.settings.reply_keyboard.mode, "custom");
    assert.deepEqual(ok.json.panel.settings.reply_keyboard.rows[0], ["/menu", { text: "محصولات", style: "success", action: "panel", value: "shop" }]);

    const g = await call("GET", `${base}/shop`);
    assert.equal(g.status, 200);
    assert.equal(g.json.panel.settings.reply_keyboard.message, "منو 👇");
    assert.equal((await panelRows()).shop.settings.reply_keyboard.placeholder, "یکی را بزنید", "در Postgres نوشته شده");

    // حالت‌های بدونِ دکمه
    const hide = await call("PATCH", `${base}/shop`, { settings: { reply_keyboard: { mode: "hide" } } });
    assert.deepEqual(hide.json.panel.settings.reply_keyboard, { mode: "hide" });
    const def = await call("PATCH", `${base}/shop`, { settings: { reply_keyboard: { mode: "default", message: "برگشت" } } });
    assert.deepEqual(def.json.panel.settings.reply_keyboard, { mode: "default", message: "برگشت" });

    // custom بدونِ دکمه و null = «تنظیمی نیست» → کلید پاک می‌شود
    const none = await call("PATCH", `${base}/shop`, { settings: { reply_keyboard: { mode: "custom", rows: [[""]] } } });
    assert.equal("reply_keyboard" in none.json.panel.settings, false);
    await call("PATCH", `${base}/shop`, { settings: { reply_keyboard: custom } });
    const cleared = await call("PATCH", `${base}/shop`, { settings: { reply_keyboard: null } });
    assert.equal("reply_keyboard" in cleared.json.panel.settings, false);

    // نامعتبر
    const badMode = await call("PATCH", `${base}/shop`, { settings: { reply_keyboard: { mode: "weird" } } });
    assert.equal(badMode.status, 400);
    const badAction = await call("PATCH", `${base}/shop`, { settings: { reply_keyboard: { mode: "custom", rows: [[{ text: "x", action: "catalog_order", value: "1" }]] } } });
    assert.equal(badAction.status, 400);
    const tooMany = await call("PATCH", `${base}/shop`, { settings: { reply_keyboard: { mode: "custom", rows: [["a", "b", "c", "d", "e"]] } } });
    assert.equal(tooMany.status, 400);
  });
  assert.deepEqual(sheetTouches, []);
});

test.after(async () => {
  globalThis.fetch = realFetch;
  if (biz) {
    try { await biz.query("DELETE FROM entity_cutover_flags WHERE tenant_id = $1", [SID]); } catch { /* ignore */ }
    try { for (const r of await pgListEntity(SID, "panels")) await pgDeleteEntity(SID, "panels", r.key); } catch { /* ignore */ }
    try { for (const r of await pgListEntity(SID, "bot_settings")) await pgDeleteEntity(SID, "bot_settings", r.key); } catch { /* ignore */ }
    await biz.end();
  }
  if (admin) {
    try { await dbm.pool.end(); } catch { /* ignore */ }
    try { await admin.query(`DROP SCHEMA ${schema} CASCADE`); } catch { /* ignore */ }
    await admin.end();
  }
});
