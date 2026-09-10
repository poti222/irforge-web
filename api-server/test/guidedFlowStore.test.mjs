/**
 * test/guidedFlowStore.test.mjs — IRFORGE_GUIDED_FLOW_INVITE_CARD_PROMPT فازِ B1
 *
 * همان الگویِ test/bookingStore.test.mjs — یک لایه‌ی جعلیِ درون‌حافظه‌ای روی
 * `botConfig.sheetLayer`، بدونِ Sheets/Postgresِ واقعی. lib/guidedFlowStore.ts
 * را مستقیم می‌آزماید (نه از طریقِ HTTP)، دقیقاً همان تقسیمِ کاری که
 * routes/guidedFlow.ts's own header comment توضیح می‌دهد.
 *
 * اجرا: pnpm --filter @workspace/api-server run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";
delete process.env.BOT_CACHE_DATABASE_URL;
delete process.env.BUSINESS_DATABASE_URL;

const botConfig = await import("../src/lib/botConfig.ts");
const store = await import("../src/lib/guidedFlowStore.ts");

const SID = "SHEET_TEST_GUIDED_FLOW";

/** همان فیک شیتِ test/bookingStore.test.mjs. */
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

// ── گفت‌وگوها ────────────────────────────────────────────────────────────

test("createFlow rejects an empty title", async () => {
  installSheet();
  await assert.rejects(() => store.createFlow(SID, "  "), (err) => err.code === "bad_title");
});

test("createFlow then getFlow round-trips, starts inactive with no start step", async () => {
  installSheet();
  const flow = await store.createFlow(SID, "ایده‌ای دارم");
  assert.equal(flow.is_active, false);
  assert.equal(flow.start_step_id, "");
  const fetched = await store.getFlow(SID, flow.id);
  assert.deepEqual(fetched, flow);
});

test("updateFlow rejects activating without a start step", async () => {
  installSheet();
  const flow = await store.createFlow(SID, "تست");
  await assert.rejects(() => store.updateFlow(SID, flow.id, { is_active: true }), (err) => err.code === "no_start_step");
});

test("updateFlow rejects a start_step_id from a different flow", async () => {
  installSheet();
  const flowA = await store.createFlow(SID, "الف");
  const flowB = await store.createFlow(SID, "ب");
  const stepB = await store.createStep(SID, { flow_id: flowB.id, step_type: "question", question_text: "س" });
  await assert.rejects(() => store.updateFlow(SID, flowA.id, { start_step_id: stepB.id }), (err) => err.code === "bad_start_step");
});

test("listFlows returns newest first", async () => {
  installSheet();
  const first = await store.createFlow(SID, "اول");
  await new Promise((r) => setTimeout(r, 2));
  const second = await store.createFlow(SID, "دوم");
  const flows = await store.listFlows(SID);
  assert.deepEqual(flows.map((f) => f.id), [second.id, first.id]);
});

// ── گام‌ها ───────────────────────────────────────────────────────────────

test("createStep rejects an unknown flow", async () => {
  installSheet();
  await assert.rejects(
    () => store.createStep(SID, { flow_id: "no-such-flow", step_type: "question" }),
    (err) => err.code === "flow_not_found",
  );
});

test("createStep cleans out options missing a label or value", async () => {
  installSheet();
  const flow = await store.createFlow(SID, "تست");
  const step = await store.createStep(SID, {
    flow_id: flow.id, step_type: "question", question_text: "مناسبت شما چیست؟",
    options: [
      { label: "رمانتیک", value: "romantic" },
      { label: "", value: "dropped" },
      { label: "دراپ", value: "" },
      { label: "پرانرژی", value: "energetic" },
    ],
  });
  assert.deepEqual(step.options, [
    { label: "رمانتیک", value: "romantic" },
    { label: "پرانرژی", value: "energetic" },
  ]);
});

test("createStep of type result carries media/body_html/buttons, ignores options", async () => {
  installSheet();
  const flow = await store.createFlow(SID, "تست");
  const step = await store.createStep(SID, {
    flow_id: flow.id, step_type: "result",
    body_html: "<b>سلام</b>", buttons: [{ label: "برو", action: "url", value: "https://x.test", row: 0, col: 0 }],
    options: [{ label: "نادیده", value: "x" }],
  });
  assert.equal(step.body_html, "<b>سلام</b>");
  assert.equal(step.buttons.length, 1);
  assert.deepEqual(step.options, []);
});

test("deleteStep cascades: removes transitions in/out, clears flow.start_step_id", async () => {
  installSheet();
  const flow = await store.createFlow(SID, "تست");
  const stepA = await store.createStep(SID, { flow_id: flow.id, step_type: "question", question_text: "س۱" });
  const stepB = await store.createStep(SID, { flow_id: flow.id, step_type: "result", body_html: "نتیجه" });
  await store.updateFlow(SID, flow.id, { start_step_id: stepA.id });
  const transition = await store.createTransition(SID, stepA.id, stepB.id);

  assert.equal(await store.deleteStep(SID, stepA.id), true);

  assert.equal(await store.getTransition(SID, transition.id), null);
  const flowAfter = await store.getFlow(SID, flow.id);
  assert.equal(flowAfter.start_step_id, "");
  assert.equal(flowAfter.is_active, false);
});

// ── یال‌ها (transitions) ─────────────────────────────────────────────────

test("createTransition rejects steps from different flows", async () => {
  installSheet();
  const flowA = await store.createFlow(SID, "الف");
  const flowB = await store.createFlow(SID, "ب");
  const stepA = await store.createStep(SID, { flow_id: flowA.id, step_type: "question", question_text: "س" });
  const stepB = await store.createStep(SID, { flow_id: flowB.id, step_type: "result", body_html: "ن" });
  await assert.rejects(() => store.createTransition(SID, stepA.id, stepB.id), (err) => err.code === "cross_flow_transition");
});

test("listTransitions orders by priority ascending, then created_at ascending", async () => {
  installSheet();
  const flow = await store.createFlow(SID, "تست");
  const q = await store.createStep(SID, { flow_id: flow.id, step_type: "question", question_text: "س" });
  const r1 = await store.createStep(SID, { flow_id: flow.id, step_type: "result", body_html: "۱" });
  const r2 = await store.createStep(SID, { flow_id: flow.id, step_type: "result", body_html: "۲" });
  const r3 = await store.createStep(SID, { flow_id: flow.id, step_type: "result", body_html: "۳" });

  const high = await store.createTransition(SID, q.id, r1.id, {}, 5);
  const low = await store.createTransition(SID, q.id, r2.id, {}, 1);
  const alsoLow = await store.createTransition(SID, q.id, r3.id, {}, 1);

  const ordered = await store.listTransitions(SID, q.id);
  assert.deepEqual(ordered.map((t) => t.id), [low.id, alsoLow.id, high.id]);
});

test("updateTransition can change condition/priority/to_step_id", async () => {
  installSheet();
  const flow = await store.createFlow(SID, "تست");
  const q = await store.createStep(SID, { flow_id: flow.id, step_type: "question", question_text: "س" });
  const r1 = await store.createStep(SID, { flow_id: flow.id, step_type: "result", body_html: "۱" });
  const r2 = await store.createStep(SID, { flow_id: flow.id, step_type: "result", body_html: "۲" });
  const t = await store.createTransition(SID, q.id, r1.id, { field: q.id, operator: "eq", value: "a" }, 0);

  const updated = await store.updateTransition(SID, t.id, {
    to_step_id: r2.id, priority: 9,
    condition: { logic: "or", conditions: [{ field: q.id, operator: "eq", value: "a" }, { field: q.id, operator: "eq", value: "b" }] },
  });
  assert.equal(updated.to_step_id, r2.id);
  assert.equal(updated.priority, 9);
  assert.equal(updated.condition.logic, "or");
});

test("deleteTransition removes it", async () => {
  installSheet();
  const flow = await store.createFlow(SID, "تست");
  const q = await store.createStep(SID, { flow_id: flow.id, step_type: "question", question_text: "س" });
  const r = await store.createStep(SID, { flow_id: flow.id, step_type: "result", body_html: "ن" });
  const t = await store.createTransition(SID, q.id, r.id);
  assert.equal(await store.deleteTransition(SID, t.id), true);
  assert.equal(await store.getTransition(SID, t.id), null);
});

// ── حذفِ کامل و آمار ─────────────────────────────────────────────────────

test("deleteFlow removes all of its steps too", async () => {
  installSheet();
  const flow = await store.createFlow(SID, "تست");
  const stepA = await store.createStep(SID, { flow_id: flow.id, step_type: "question", question_text: "س" });
  const stepB = await store.createStep(SID, { flow_id: flow.id, step_type: "result", body_html: "ن" });

  await store.deleteFlow(SID, flow.id);

  assert.equal(await store.getStep(SID, stepA.id), null);
  assert.equal(await store.getStep(SID, stepB.id), null);
});

test("flowStats counts sessions written by the bot side directly into the same tab", async () => {
  const tabs = installSheet();
  const flow = await store.createFlow(SID, "تست");
  tabs.set("guided_flow_sessions", new Map([
    ["gs1", { id: "gs1", flow_id: flow.id, user_id: "1", current_step_id: "x", answers: {}, completed_at: "2026-01-01T00:00:00Z" }],
    ["gs2", { id: "gs2", flow_id: flow.id, user_id: "2", current_step_id: "x", answers: {}, completed_at: "" }],
    ["gs3", { id: "gs3", flow_id: "some-other-flow", user_id: "3", current_step_id: "x", answers: {}, completed_at: "" }],
  ]));
  const stats = await store.flowStats(SID, flow.id);
  assert.deepEqual(stats, { sessions: 2, completed: 1 });
});
