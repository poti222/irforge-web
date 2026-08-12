/**
 * test/botPanels.test.mjs — منطق پنل‌ها (فاز ۶).
 *
 * معیار پایان فاز: «تست node که با fake sheet نشان دهد هر سه استراتژی حذف درست
 * کار می‌کنند و هیچ ارجاع معلقی باقی نمی‌ماند».
 *
 * اجرا: pnpm --filter @workspace/api-server run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";
delete process.env.BOT_CACHE_DATABASE_URL;
delete process.env.BUSINESS_DATABASE_URL;

const botConfig = await import("../src/lib/botConfig.ts");
const panelOps = await import("../src/lib/panelOps.ts");
const botTypes = await import("../src/lib/botTypes.ts");

const SID = "SHEET_TEST";

/** شیت جعلی در حافظه با قرارداد key/value تب‌های بات. */
function installSheet(initial = {}) {
  const tabs = new Map();
  for (const [tab, rows] of Object.entries(initial)) tabs.set(tab, new Map(Object.entries(rows)));

  Object.assign(botConfig.sheetLayer, {
    async readTabRows(_sid, tab) {
      const rows = tabs.get(tab);
      if (!rows) return [];
      return [...rows.entries()].map(([key, value]) => ({ key, value, raw: false }));
    },
    async upsertRow(_sid, tab, key, value) {
      if (!tabs.has(tab)) tabs.set(tab, new Map());
      const rows = tabs.get(tab);
      const created = !rows.has(key);
      rows.set(key, JSON.parse(JSON.stringify(value)));
      return { created };
    },
    async deleteRow(_sid, tab, key) {
      const rows = tabs.get(tab);
      if (!rows || !rows.has(key)) return false;
      rows.delete(key);
      return true;
    },
    async listTabs() {
      return [...tabs.keys()];
    },
  });
  return tabs;
}

function panel(id, extra = {}) {
  return botTypes.newPanel({ id, title: id, ...extra });
}

function btn(label, action, value) {
  return botTypes.newButton({ label, action, value });
}

/**
 * درخت نمونه‌ی همه‌ی تست‌های حذف:
 *
 *   root
 *   └── mid            ← پنلی که حذف می‌شود
 *       ├── leafA
 *       └── leafB
 *   other  (دو دکمه: یکی به mid، یکی به leafA)
 */
function fixture() {
  const panels = {
    root: panel("root"),
    mid: panel("mid", { parent_id: "root" }),
    leafA: panel("leafA", { parent_id: "mid" }),
    leafB: panel("leafB", { parent_id: "mid" }),
    other: panel("other", {
      buttons: botTypes.normalizeButtonLayout([
        btn("برو به mid", "panel", "mid"),
        btn("برو به leafA", "panel", "leafA"),
        btn("سایت", "url", "https://example.com"),
      ]),
    }),
  };
  panels.root.children = ["mid"];
  panels.mid.children = ["leafA", "leafB"];
  return installSheet({
    panels,
    bot_settings: { home_panel_id: "mid" },
    custom_commands: {
      shop: { command: "shop", target: "panel:mid", description: "فروشگاه", is_active: true },
    },
  });
}

/** هیچ پنلی نباید به پنلِ ناموجود اشاره کند — نه با parent_id، نه با دکمه. */
async function assertNoDanglingRefs(tabs) {
  const panels = await panelOps.listPanels(SID);
  const ids = new Set(panels.map((p) => p.id));
  for (const p of panels) {
    assert.ok(
      p.parent_id === null || ids.has(p.parent_id),
      `پنل ${p.id} به والد ناموجود ${p.parent_id} اشاره می‌کند`
    );
    for (const b of p.buttons ?? []) {
      if (b.action === "panel") {
        assert.ok(ids.has(b.value), `دکمه‌ی «${b.label}» در ${p.id} به پنل ناموجود ${b.value} لینک دارد`);
      }
    }
    const expected = panels.filter((x) => x.parent_id === p.id).map((x) => x.id);
    assert.deepEqual(p.children ?? [], expected, `children پنل ${p.id} کهنه است`);
  }
  const home = tabs.get("bot_settings")?.get("home_panel_id") ?? null;
  assert.ok(home === null || ids.has(home), `home_panel_id به پنل ناموجود ${home} اشاره می‌کند`);
}

test("حذف cascade: کل زیردرخت می‌رود و هیچ ارجاع معلقی نمی‌ماند", async () => {
  const tabs = fixture();
  const report = await panelOps.deletePanel(SID, "mid", "cascade");

  assert.deepEqual(report.deleted.sort(), ["leafA", "leafB", "mid"]);
  const remaining = (await panelOps.listPanels(SID)).map((p) => p.id).sort();
  assert.deepEqual(remaining, ["other", "root"]);

  // هر دو دکمه‌ی ارجاع‌دهنده باید خنثی شده باشند (mid و leafA هر دو رفته‌اند).
  assert.equal(report.buttonsChanged, 2);
  const other = await panelOps.getPanel(SID, "other");
  assert.deepEqual(
    other.buttons.map((b) => [b.action, b.value]),
    [["callback", "noop"], ["callback", "noop"], ["url", "https://example.com"]],
    "دکمه‌های مرده باید به callback/noop تبدیل شوند، نه اینکه دست‌نخورده بمانند (باگ B7)"
  );

  assert.equal(report.homeCleared, true, "خانه‌ی حذف‌شده باید از تنظیمات هم پاک شود (باگ B8)");
  assert.deepEqual(report.danglingCommands.map((c) => c.command), ["shop"], "کامند معلق باید گزارش شود");

  await assertNoDanglingRefs(tabs);
});

test("حذف reparent: بچه‌ها به والدِ پنل حذف‌شده وصل می‌شوند", async () => {
  const tabs = fixture();
  const report = await panelOps.deletePanel(SID, "mid", "reparent");

  assert.deepEqual(report.deleted, ["mid"]);
  assert.deepEqual(report.reparented.sort(), ["leafA", "leafB"]);

  const leafA = await panelOps.getPanel(SID, "leafA");
  const leafB = await panelOps.getPanel(SID, "leafB");
  assert.equal(leafA.parent_id, "root");
  assert.equal(leafB.parent_id, "root");

  const root = await panelOps.getPanel(SID, "root");
  assert.deepEqual(root.children.sort(), ["leafA", "leafB"], "children والد باید بازسازی شود");

  // فقط دکمه‌ی mid باید خنثی شود؛ دکمه‌ی leafA هنوز معتبر است.
  assert.equal(report.buttonsChanged, 1);
  const other = await panelOps.getPanel(SID, "other");
  assert.deepEqual(other.buttons.map((b) => b.value), ["noop", "leafA", "https://example.com"]);

  await assertNoDanglingRefs(tabs);
});

test("حذف orphan: بچه‌ها بدون والد می‌شوند ولی معلق نمی‌مانند", async () => {
  const tabs = fixture();
  const report = await panelOps.deletePanel(SID, "mid", "orphan");

  assert.deepEqual(report.orphaned.sort(), ["leafA", "leafB"]);
  const leafA = await panelOps.getPanel(SID, "leafA");
  assert.equal(leafA.parent_id, null, "باگ B6: parent_id نباید به پنل حذف‌شده اشاره بماند");

  const root = await panelOps.getPanel(SID, "root");
  assert.deepEqual(root.children, [], "mid از children ریشه حذف شده");

  await assertNoDanglingRefs(tabs);
});

test("buttonStrategy=remove دکمه‌ی مرده را حذف می‌کند و چیدمان را نرمال نگه می‌دارد", async () => {
  const tabs = fixture();
  const report = await panelOps.deletePanel(SID, "mid", "cascade", "remove");

  assert.equal(report.buttonsChanged, 2);
  const other = await panelOps.getPanel(SID, "other");
  assert.equal(other.buttons.length, 1);
  assert.equal(other.buttons[0].value, "https://example.com");
  assert.deepEqual(
    [other.buttons[0].row, other.buttons[0].col, other.buttons[0].row_start],
    [0, 0, true],
    "بعد از حذف، ردیف/ستون باید دوباره از صفر نرمال شود"
  );

  await assertNoDanglingRefs(tabs);
});

test("ست‌کردن خانه هر دو منبع حقیقت را با هم آپدیت می‌کند (باگ B8)", async () => {
  const tabs = installSheet({
    panels: {
      a: panel("a", { is_home: true }),
      b: panel("b"),
    },
    bot_settings: { home_panel_id: "a" },
  });

  await panelOps.setHomePanel(SID, "b");

  const a = await panelOps.getPanel(SID, "a");
  const b = await panelOps.getPanel(SID, "b");
  assert.equal(a.is_home, false);
  assert.equal(b.is_home, true);
  assert.equal(tabs.get("bot_settings").get("home_panel_id"), "b");
  assert.deepEqual(await panelOps.panelHealth(SID), [], "بعد از ست‌کردن خانه هیچ ناهماهنگی نباید بماند");
});

test("panelHealth ناهماهنگی خانه و ارجاع معلق را پیدا می‌کند و repair درستشان می‌کند", async () => {
  const tabs = installSheet({
    panels: {
      // ناهماهنگی عمدی: is_home روی a ولی تنظیمات می‌گوید b؛ b وجود ندارد.
      a: panel("a", { is_home: true, parent_id: "ghost", children: ["nope"] }),
      c: panel("c", { buttons: botTypes.normalizeButtonLayout([btn("مرده", "panel", "ghost")]) }),
    },
    bot_settings: { home_panel_id: "b" },
  });

  const issues = await panelOps.panelHealth(SID);
  const codes = issues.map((i) => i.code).sort();
  assert.deepEqual(
    codes,
    ["button_to_missing_panel", "dangling_parent", "home_mismatch", "stale_children"],
    "هر چهار ناهماهنگی باید گزارش شوند"
  );

  const { fixed } = await panelOps.repairPanels(SID);
  assert.ok(fixed >= 2);
  assert.deepEqual(await panelOps.panelHealth(SID), [], "بعد از repair هیچ ایرادی نباید بماند");

  const a = await panelOps.getPanel(SID, "a");
  assert.equal(a.parent_id, null, "والد معلق باید بریده شود");
  assert.equal(a.is_home, true);
  assert.equal(tabs.get("bot_settings").get("home_panel_id"), "a", "تنظیمات باید با پرچم هماهنگ شود");

  const c = await panelOps.getPanel(SID, "c");
  assert.deepEqual([c.buttons[0].action, c.buttons[0].value], ["callback", "noop"]);
});

test("buildTree حلقه را می‌برد و پنلِ با والدِ ناموجود را گم نمی‌کند", () => {
  const cyclic = [
    panel("x", { parent_id: "y" }),
    panel("y", { parent_id: "x" }),
    panel("lost", { parent_id: "ghost" }),
  ];
  const roots = panelOps.buildTree(cyclic);
  const flat = [];
  const walk = (n) => { flat.push(n.id); n.childNodes.forEach(walk); };
  roots.forEach(walk);
  assert.deepEqual(flat.sort(), ["lost", "x", "y"], "هیچ پنلی نباید از درخت بیفتد");
});

test("collectSubtree همه‌ی نوادگان را می‌دهد و روی حلقه گیر نمی‌کند", () => {
  const panels = [
    panel("r"),
    panel("a", { parent_id: "r" }),
    panel("b", { parent_id: "a" }),
    panel("loop1", { parent_id: "loop2" }),
    panel("loop2", { parent_id: "loop1" }),
  ];
  assert.deepEqual(panelOps.collectSubtree(panels, "r").sort(), ["a", "b"]);
  assert.deepEqual(panelOps.collectSubtree(panels, "loop1").sort(), ["loop2"]);
});
