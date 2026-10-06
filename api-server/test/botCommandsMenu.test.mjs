/**
 * test/botCommandsMenu.test.mjs — لایوباگ ۲۰۲۶-۱۰-۰۶:
 *   «کامندها رو از بات نمیگیره و تو سایت نشون بده تا حذف/اضافه/ترتیب عوض کنم. بات نوشاذین همه‌ی کامندها رو خودش اضافه
 *    کرده. هیچ کامندی نباید خودکار اضافه بشه توی بات.» و «همه‌ی سوییچ‌های نمایش در تلگرام خاموشه ولی همه در حال نمایشه».
 *
 * روتِ واقعیِ `routes/botCommands.ts` (احرازِ هویتِ واقعی، جدولِ bots روی Postgres) با یک لایه‌ی شیتِ درون‌حافظه‌ای
 * (`sheetLayer`) و یک تلگرامِ جعلی (جایگزینِ `fetch` برایِ `getMyCommands`/`setMyCommands`). تأکید روی:
 *   ۱) هیچ‌وقت ردیفِ خودکار نوشته نمی‌شود؛ ردیف‌هایِ خودکارِ دست‌نخوردهٔ قدیمی پاک می‌شوند و override می‌ماند.
 *   ۲) منو **زنده از تلگرام** خوانده می‌شود (حتی آیتمی که سایت نمی‌شناسد)؛ بدونِ تلگرام → ذخیره‌شده با menuLive:false.
 *   ۳) افزودن/حذف/ترتیبِ منو، سوییچِ «نمایش در تلگرام»، رزرو بودنِ نامِ داخلی‌ها، و «حذفِ» کامندِ داخلی = خاموش‌کردن.
 *
 * بخشِ زنده فقط با `CARD_TEST_PG_URL`. اجرا: pnpm --filter @workspace/api-server run test
 */
process.env.BOT_TOKEN_ENCRYPTION_KEY = "ab".repeat(32);
process.env.REGISTRY_SPREADSHEET_ID ??= "sheet-registry";

import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";

const PG_URL = process.env.CARD_TEST_PG_URL;
const live = { skip: PG_URL ? false : "CARD_TEST_PG_URL تنظیم نشده" };
let pgMod = null;
try { pgMod = await import("pg"); } catch { /* skip */ }
const Pool = pgMod?.default?.Pool ?? pgMod?.Pool;

const schema = `cmd_${Math.random().toString(36).slice(2, 10)}`;
let admin = null;
if (PG_URL && Pool) {
  admin = new Pool({ connectionString: PG_URL, max: 2 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const u = new URL(PG_URL);
  u.searchParams.set("options", `-c search_path=${schema}`);
  process.env.DATABASE_URL = u.toString();
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
const mod = await import("../src/routes/botCommands.ts");
const router = mod.default;
const { __testables } = mod;
const { CORE_COMMANDS } = await import("../src/lib/coreCommandsCatalog.ts");

const SID = "sheet-cmd-test";
const BOT = "bot_cmd";
const TOKEN = "tok_owner";

// ─── شیتِ جعلیِ درون‌حافظه‌ای ────────────────────────────────────────────────
function fakeSheets(tabs) {
  const store = new Map(Object.entries(tabs).map(([k, v]) => [k, new Map(v)]));
  return {
    store,
    async readTabRows(_sid, tab) {
      const rows = store.get(tab);
      if (!rows) return [];
      return [...rows.entries()].map(([key, value]) => ({ key, value, raw: false }));
    },
    async upsertRow(_sid, tab, key, value) {
      if (!store.has(tab)) store.set(tab, new Map());
      const created = !store.get(tab).has(key);
      store.get(tab).set(key, value);
      return { created };
    },
    async deleteRow(_sid, tab, key) {
      return store.get(tab)?.delete(key) ?? false;
    },
    async listTabs() {
      return [...store.keys()];
    },
  };
}

let sheet = null;
function resetSheet({ pluginStates = {}, pluginCatalogRows = [], customRows = [], botCommands } = {}) {
  catalogMod.resetPluginCatalogCacheForTests();
  const settingsRows = [["__plugin_states__", pluginStates]];
  if (botCommands !== undefined) settingsRows.push(["bot_commands", botCommands]);
  sheet = fakeSheets({ bot_settings: settingsRows, custom_commands: customRows, forms: [] });
  Object.assign(botConfigMod.sheetLayer, sheet);
  Object.assign(catalogMod.catalogSheetLayer, fakeSheets({ plugin_catalog: pluginCatalogRows }));
}

// ─── تلگرامِ جعلی (جایگزینِ fetch فقط برایِ api.telegram.org) ───────────────────
const realFetch = globalThis.fetch;
const tg = { menu: [], calls: [], down: false, reject: null };
function resetTelegram(menu = []) {
  tg.menu = menu.map((m) => ({ ...m }));
  tg.calls = [];
  tg.down = false;
  tg.reject = null;
}
globalThis.fetch = async (url, init) => {
  const u = String(url);
  const m = u.match(/^https:\/\/api\.telegram\.org\/bot[^/]+\/(\w+)$/);
  if (!m) return realFetch(url, init);
  const method = m[1];
  const body = init?.body ? JSON.parse(init.body) : {};
  tg.calls.push({ method, body });
  const reply = (obj) => new Response(JSON.stringify(obj), { status: 200, headers: { "content-type": "application/json" } });
  if (tg.down) throw new Error("network down");
  if (method === "getMyCommands") return reply({ ok: true, result: tg.menu });
  if (method === "setMyCommands") {
    if (tg.reject) return reply({ ok: false, description: tg.reject });
    tg.menu = body.commands.map((c) => ({ ...c }));
    return reply({ ok: true, result: true });
  }
  return reply({ ok: false, description: `unexpected ${method}` });
};

// ─── DB + سرور ───────────────────────────────────────────────────────────────
async function setup() {
  const pool = dbm.pool;
  await pool.query(ddlFor(dbm.usersTable, dbm.sessionsTable, dbm.botsTable, dbm.botManagersTable));
  await pool.query(DDL_ALL);
  await pool.query("INSERT INTO users (id, name, email, role) VALUES ('u_owner','مالک','owner@example.com','user')");
  await pool.query(
    "INSERT INTO sessions (token, user_id, expires_at, last_used_at) VALUES ($1,'u_owner', now() + interval '1 day', now())",
    [hashSessionToken(TOKEN)],
  );
  await pool.query(
    "INSERT INTO bots (id, user_id, name, token, sheet_id) VALUES ($1,'u_owner','نوشاذین',$2,$3)",
    [BOT, encryptToken("123456:TESTTOKEN"), SID],
  );
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
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json = null;
    try { json = await res.json(); } catch { /* 204 */ }
    return { status: res.status, json };
  };
  try { await fn(call); } finally { await new Promise((r) => server.close(r)); }
}

const base = `/bots/${BOT}/commands`;
const row = (command, extra = {}) => ({
  command, target: "", description: "", admin_only: false, is_active: true,
  created_at: "2020-01-01T00:00:00.000Z", ...extra,
});
const customRows = () => [...(sheet.store.get("custom_commands")?.entries() ?? [])];
const storedMenu = () => sheet.store.get("bot_settings")?.get("bot_commands");

// ─── خالص (بدونِ DB) ─────────────────────────────────────────────────────────

test("validateMenuList: نامِ نامعتبر/تکراری/توضیحِ خالی/سقف", () => {
  const { validateMenuList } = __testables;
  assert.deepEqual(
    validateMenuList([{ command: "/Start", description: " شروع " }, { command: "start", description: "تکراری" }, { command: "help" }]),
    [{ command: "start", description: "شروع" }, { command: "help", description: "/help" }],
  );
  for (const bad of ["Bad Name", "با-فارسی", "", "x".repeat(33), "a-b"]) {
    assert.throws(() => validateMenuList([{ command: bad }]), (e) => e.code === "bad_menu_command", bad);
  }
  assert.throws(() => validateMenuList("nope"), (e) => e.code === "bad_menu");
  assert.throws(
    () => validateMenuList(Array.from({ length: 101 }, (_, i) => ({ command: `c${i}`, description: "d" }))),
    (e) => e.code === "menu_too_long",
  );
  assert.equal(validateMenuList(Array.from({ length: 100 }, (_, i) => ({ command: `c${i}`, description: "d" }))).length, 100);
});

test("isUntouchedAutoRow: فقط ردیفِ خودکارِ فعال و بدونِ تغییر", () => {
  const { isUntouchedAutoRow } = __testables;
  const catalog = [{ command: "support", description: "پشتیبانی", adminOnly: false, source: "core", locked: false }];
  const auto = row("support", { source: "core", description: "پشتیبانی" });
  assert.equal(isUntouchedAutoRow(auto, catalog), true);
  assert.equal(isUntouchedAutoRow({ ...auto, is_active: false }, catalog), false, "خاموش‌کردنِ مالک = override");
  assert.equal(isUntouchedAutoRow({ ...auto, description: "متنِ من" }, catalog), false, "توضیحِ تغییریافته = override");
  assert.equal(isUntouchedAutoRow({ ...auto, admin_only: true }, catalog), false, "admin_only تغییریافته = override");
  assert.equal(isUntouchedAutoRow({ ...auto, source: "custom" }, catalog), false, "کامندِ سفارشی هرگز پاک نمی‌شود");
  assert.equal(isUntouchedAutoRow({ ...auto, source: undefined }, catalog), false);
  assert.equal(isUntouchedAutoRow(row("ghost", { source: "plugin:x" }), catalog), true, "پلاگینِ خاموش + بدونِ تغییر");
});

test("NEVER_DISABLE_COMMANDS دقیقاً زیرمجموعه‌یِ قفل‌شده‌یِ CORE_COMMANDS است و نامِ تکراری ندارد", async () => {
  const { NEVER_DISABLE_COMMANDS } = await import("../src/lib/coreCommandsCatalog.ts");
  for (const cmd of NEVER_DISABLE_COMMANDS) {
    const entry = CORE_COMMANDS.find((c) => c.command === cmd);
    assert.ok(entry?.locked, `${cmd} is in NEVER_DISABLE_COMMANDS but not locked:true in CORE_COMMANDS`);
  }
  for (const entry of CORE_COMMANDS) {
    if (entry.locked) assert.ok(NEVER_DISABLE_COMMANDS.has(entry.command));
  }
  const names = CORE_COMMANDS.map((c) => c.command);
  assert.equal(new Set(names).size, names.length, `duplicates in: ${names.join(", ")}`);
});

// ─── روتِ واقعی ──────────────────────────────────────────────────────────────

test("GET: هیچ ردیفی نمی‌نویسد؛ فهرستِ داخلی‌ها از کاتالوگ؛ سفارشی‌ها جدا", live, async () => {
  resetSheet({ customRows: [["wallet", row("wallet", { target: "wallet", description: "کیف پول", source: "custom" })]] });
  resetTelegram([]);
  await withServer(async (call) => {
    const before = JSON.stringify(customRows());
    const { status, json } = await call("GET", base);
    assert.equal(status, 200);
    assert.equal(JSON.stringify(customRows()), before, "GET نباید چیزی بنویسد");
    assert.equal(storedMenu(), undefined, "GET منوی ذخیره‌شده را هم نمی‌نویسد");
    assert.deepEqual(json.commands.map((c) => c.command), ["wallet"]);
    assert.equal(json.count, 1);
    assert.equal(json.purged, 0);
    assert.equal(json.menuLive, true);
    assert.deepEqual(json.menu, []);
    for (const c of CORE_COMMANDS) {
      const b = json.builtins.find((x) => x.command === c.command);
      assert.ok(b, `/${c.command} باید در فهرستِ داخلی‌ها باشد`);
      assert.equal(b.inMenu, false, "هیچ کامندی خودکار در منو نیست");
      assert.equal(b.is_active, true);
    }
    assert.ok(!json.commands.some((c) => c.source && c.source !== "custom"), "ردیفِ خودکار در commands نیست");
  });
});

test("GET: منو زنده از تلگرام (حتی آیتمِ ناشناخته برایِ سایت) و سوییچِ inMenu راست‌گو", live, async () => {
  resetSheet({ botCommands: [] }); // ذخیره‌شده خالی؛ ولی روی تلگرام آیتم‌هایِ قدیمی نشسته
  resetTelegram([
    { command: "start", description: "شروع" },
    { command: "support", description: "پشتیبانی" },
    { command: "legacy_thing", description: "از قدیم" },
  ]);
  await withServer(async (call) => {
    const { json } = await call("GET", base);
    assert.equal(json.menuLive, true);
    assert.deepEqual(json.menu, ["start", "support", "legacy_thing"]);
    assert.deepEqual(json.menuEntries.map((m) => m.description), ["شروع", "پشتیبانی", "از قدیم"]);
    assert.equal(json.builtins.find((b) => b.command === "support").inMenu, true);
    assert.equal(json.builtins.find((b) => b.command === "start").inMenu, true);
    assert.equal(json.builtins.find((b) => b.command === "help")?.inMenu ?? false, false);
  });
});

test("GET: تلگرام در دسترس نیست → منوی ذخیره‌شده با menuLive:false (باز شدنِ صفحه خراب نمی‌شود)", live, async () => {
  resetSheet({ botCommands: [{ command: "wallet", description: "کیف پول" }] });
  resetTelegram();
  tg.down = true;
  await withServer(async (call) => {
    const { status, json } = await call("GET", base);
    assert.equal(status, 200);
    assert.equal(json.menuLive, false);
    assert.deepEqual(json.menu, ["wallet"]);
  });
});

test("GET: ردیف‌هایِ خودکارِ دست‌نخوردهٔ قدیمی پاک می‌شوند؛ overrideِ مالک و کامندِ سفارشی می‌مانند", live, async () => {
  const sup = CORE_COMMANDS.find((c) => c.command === "support");
  assert.ok(sup);
  const rows = [
    ["support", row("support", { source: "core", description: sup.description, admin_only: sup.adminOnly })],   // دست‌نخورده → پاک
    ["help", row("help", { source: "core", description: "راهنمایِ خودم" })],                                    // توضیح عوض شده → override
    ["wallet", row("wallet", { target: "wallet", source: "custom" })],                                          // سفارشی
    ["orphan", row("orphan", { source: "plugin:gone" })],                                                       // پلاگینِ خاموش، بدونِ تغییر → پاک
  ];
  const stopRow = CORE_COMMANDS.find((c) => !c.locked && c.command !== "support" && c.command !== "help");
  rows.push([stopRow.command, row(stopRow.command, { source: "core", is_active: false, description: stopRow.description, admin_only: stopRow.adminOnly })]); // خاموش → override
  resetSheet({ customRows: rows });
  resetTelegram([]);
  await withServer(async (call) => {
    const { json } = await call("GET", base);
    assert.equal(json.purged, 2);
    const keys = customRows().map(([k]) => k).sort();
    assert.deepEqual(keys, ["help", stopRow.command, "wallet"].sort());
    assert.deepEqual(json.commands.map((c) => c.command), ["wallet"]);
    const help = json.builtins.find((b) => b.command === "help");
    assert.equal(help.description, "راهنمایِ خودم", "override در فهرستِ داخلی‌ها اعمال می‌شود");
    assert.equal(json.builtins.find((b) => b.command === stopRow.command).is_active, false);
    // دومین GET چیزی برایِ پاک‌کردن ندارد
    assert.equal((await call("GET", base)).json.purged, 0);
  });
});

test("پلاگینِ روشن: menu_commands در فهرستِ داخلی‌ها (بدونِ نوشتن)؛ پلاگینِ خاموش نه", live, async () => {
  resetSheet({
    pluginStates: { ticket: true, shop: false },
    pluginCatalogRows: [
      ["ticket", { id: "ticket", name_fa: "تیکت", menu_commands: [{ command: "newticket", description_fa: "ثبت تیکت" }] }],
      ["shop", { id: "shop", name_fa: "فروشگاه", menu_commands: [{ command: "buy", description_fa: "خرید" }] }],
    ],
  });
  resetTelegram([]);
  await withServer(async (call) => {
    const { json } = await call("GET", base);
    const nt = json.builtins.find((b) => b.command === "newticket");
    assert.ok(nt);
    assert.equal(nt.source, "plugin:ticket");
    assert.equal(nt.description, "ثبت تیکت");
    assert.equal(nt.inMenu, false);
    assert.ok(!json.builtins.some((b) => b.command === "buy"));
    assert.equal(customRows().length, 0);
  });
});

test("PUT /commands/menu: کلِ منو (ترتیب، حذف، آیتمِ فقط‌-تلگرام) روی تلگرام و شیت", live, async () => {
  resetSheet();
  resetTelegram([{ command: "a", description: "A" }, { command: "b", description: "B" }, { command: "c", description: "C" }]);
  await withServer(async (call) => {
    const r = await call("PUT", `${base}/menu`, {
      commands: [{ command: "c", description: "C2" }, { command: "a", description: "A" }, { command: "tg_only", description: "فقط تلگرام" }],
    });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.menu, ["c", "a", "tg_only"]);
    assert.deepEqual(tg.menu.map((m) => m.command), ["c", "a", "tg_only"]);
    assert.deepEqual(storedMenu().map((m) => m.command), ["c", "a", "tg_only"]);
    assert.equal(tg.menu[0].description, "C2");

    // خالی‌کردنِ کلِ منو
    const e = await call("PUT", `${base}/menu`, { commands: [] });
    assert.equal(e.status, 200);
    assert.deepEqual(tg.menu, []);
    assert.deepEqual(storedMenu(), []);
  });
});

test("PUT /commands/menu: نامِ نامعتبر ۴۰۰؛ ردِ تلگرام ۴۰۹ و چیزی در شیت ذخیره نمی‌شود", live, async () => {
  resetSheet({ botCommands: [{ command: "keep", description: "k" }] });
  resetTelegram([{ command: "keep", description: "k" }]);
  await withServer(async (call) => {
    const bad = await call("PUT", `${base}/menu`, { commands: [{ command: "Bad Name", description: "x" }] });
    assert.equal(bad.status, 400);
    assert.equal(bad.json.code, "bad_menu_command");
    assert.equal(tg.calls.filter((c) => c.method === "setMyCommands").length, 0, "قبل از اعتبارسنجی به تلگرام نمی‌رود");

    tg.reject = "Bad Request: wrong description";
    const rej = await call("PUT", `${base}/menu`, { commands: [{ command: "x", description: "y" }] });
    assert.equal(rej.status, 409);
    assert.equal(rej.json.code, "telegram_rejected");
    assert.deepEqual(storedMenu().map((m) => m.command), ["keep"], "شیت چیزی را ادعا نمی‌کند که روی بات نیست");
  });
});

test("PUT /commands/:command/menu: سوییچِ نمایش در تلگرام برایِ داخلی و سفارشی؛ اضافه‌شده ته منو", live, async () => {
  resetSheet({ customRows: [["wallet", row("wallet", { target: "wallet", description: "کیف پول", source: "custom" })]] });
  resetTelegram([{ command: "start", description: "شروع" }]);
  await withServer(async (call) => {
    let r = await call("PUT", `${base}/wallet/menu`, { inMenu: true });
    assert.equal(r.status, 200);
    assert.deepEqual(tg.menu.map((m) => m.command), ["start", "wallet"]);
    assert.equal(tg.menu[1].description, "کیف پول");

    r = await call("PUT", `${base}/support/menu`, { inMenu: true });
    assert.equal(r.status, 200, "کامندِ داخلی هم قابلِ اضافه‌شدن به منو است");
    assert.deepEqual(tg.menu.map((m) => m.command), ["start", "wallet", "support"]);

    r = await call("PUT", `${base}/start/menu`, { inMenu: false });
    assert.deepEqual(tg.menu.map((m) => m.command), ["wallet", "support"], "آیتمِ زنده‌یِ تلگرام با سوییچ حذف می‌شود");

    r = await call("PUT", `${base}/nope_cmd/menu`, { inMenu: true });
    assert.equal(r.status, 404);
    assert.equal(r.json.code, "command_not_found");
    assert.equal(customRows().length, 1, "هیچ ردیفِ تازه‌ای ساخته نمی‌شود");
  });
});

test("POST: نامِ کامندِ داخلیِ بات رزرو است (۴۰۹) و ردیفِ خودکار نمی‌نویسد", live, async () => {
  resetSheet();
  resetTelegram();
  await withServer(async (call) => {
    const dup = await call("POST", base, { command: "support", target: "admin" });
    assert.equal(dup.status, 409);
    assert.equal(dup.json.code, "duplicate_command");
    assert.equal(customRows().length, 0);

    const ok = await call("POST", base, { command: "mycmd", target: "admin", description: "من" });
    assert.equal(ok.status, 201);
    assert.deepEqual(customRows().map(([k]) => k), ["mycmd"], "فقط همان یک ردیف؛ کامندهایِ Core مادی نمی‌شوند");
    assert.equal(tg.menu.length, 0, "ساختنِ کامند خودکار آن را روی منوی تلگرام نمی‌گذارد");
  });
});

test("DELETE کامندِ داخلی = خاموش‌کردن + برداشتن از منو؛ کامندِ قفل ۴۰۹؛ سفارشی واقعاً پاک", live, async () => {
  resetSheet({ customRows: [["wallet", row("wallet", { target: "wallet", source: "custom" })]] });
  resetTelegram([{ command: "support", description: "پشتیبانی" }, { command: "wallet", description: "w" }]);
  await withServer(async (call) => {
    let r = await call("DELETE", `${base}/support`);
    assert.equal(r.status, 200);
    assert.equal(r.json.disabledInstead, true);
    const sup = sheet.store.get("custom_commands").get("support");
    assert.equal(sup.is_active, false, "override با is_active=false ساخته شد (بات همین را می‌خواند)");
    assert.equal(sup.source, "core");
    assert.deepEqual(tg.menu.map((m) => m.command), ["wallet"], "از منویِ تلگرام برداشته شد");

    const locked = CORE_COMMANDS.find((c) => c.locked);
    if (locked) {
      r = await call("DELETE", `${base}/${locked.command}`);
      assert.equal(r.status, 409);
      assert.equal(r.json.code, "command_locked");
    }

    r = await call("DELETE", `${base}/wallet`);
    assert.equal(r.status, 200);
    assert.equal(sheet.store.get("custom_commands").has("wallet"), false);
    assert.deepEqual(tg.menu, [], "کامندِ سفارشیِ حذف‌شده از منو هم می‌رود");

    r = await call("DELETE", `${base}/ghost`);
    assert.equal(r.status, 404);
  });
});

test("PATCH کامندِ داخلی: خاموش/روشن، توضیح؛ تغییرِ مقصد/نام ممنوع؛ روشن‌کردن همان override را حفظ می‌کند", live, async () => {
  resetSheet();
  resetTelegram();
  await withServer(async (call) => {
    let r = await call("PATCH", `${base}/help`, { description: "راهنما" });
    assert.equal(r.status, 200);
    assert.equal(sheet.store.get("custom_commands").get("help").description, "راهنما");

    r = await call("PATCH", `${base}/help`, { target: "admin" });
    assert.equal(r.status, 409);
    assert.equal(r.json.code, "builtin_command_target_fixed");

    r = await call("PATCH", `${base}/help`, { command: "other" });
    assert.equal(r.status, 409);
    assert.equal(r.json.code, "builtin_command_rename_blocked");

    r = await call("PATCH", `${base}/support`, { is_active: false });
    assert.equal(r.status, 200);
    assert.equal(sheet.store.get("custom_commands").get("support").is_active, false);
    r = await call("PATCH", `${base}/support`, { is_active: true });
    assert.equal(sheet.store.get("custom_commands").get("support").is_active, true);

    r = await call("PATCH", `${base}/ghost`, { is_active: false });
    assert.equal(r.status, 404);
  });
});

test("reorder: فقط میانِ کامندهایِ سفارشی؛ ردیفِ override دخالت نمی‌کند", live, async () => {
  resetSheet({
    customRows: [
      ["a", row("a", { target: "admin", source: "custom", order: 1 })],
      ["help", row("help", { source: "core", description: "راهنمایِ من", order: 2 })],
      ["b", row("b", { target: "admin", source: "custom", order: 3 })],
    ],
  });
  resetTelegram();
  await withServer(async (call) => {
    const r = await call("POST", `${base}/b/reorder`, { direction: "up" });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.commands.map((c) => c.command), ["b", "a"]);
    assert.equal(sheet.store.get("custom_commands").get("help").order, 2, "override دست نمی‌خورد");
    const bad = await call("POST", `${base}/b/reorder`, { direction: "sideways" });
    assert.equal(bad.status, 400);
  });
});

test.after(async () => {
  globalThis.fetch = realFetch;
  if (admin) {
    try { await dbm.pool.end(); } catch { /* ignore */ }
    try { await admin.query(`DROP SCHEMA ${schema} CASCADE`); } catch { /* ignore */ }
    await admin.end();
  }
});
