/**
 * test/surveyStore.test.mjs — IRFORGE_PROMPT_V3 Phase 20
 *
 * Exercises lib/surveyStore.ts against the fake `botConfig.sheetLayer` —
 * same in-memory-sheet harness as test/addressStore.test.mjs/dripStore.test.mjs.
 * Cross-checks the aggregation math (results()) and the "never reuse a
 * question id" invariant against plugins/survey/domain.py's own behavior
 * (see tests/test_survey_domain.py on the bot side for the Python twin).
 *
 * اجرا: pnpm --filter @workspace/api-server run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";
delete process.env.BOT_CACHE_DATABASE_URL;
delete process.env.BUSINESS_DATABASE_URL;

const botConfig = await import("../src/lib/botConfig.ts");
const store = await import("../src/lib/surveyStore.ts");

const SID = "SHEET_TEST_SURVEY";

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

// ── create / update / delete ─────────────────────────────────────────────

test("createSurvey starts unpublished with no questions", async () => {
  installSheet();
  const s = await store.createSurvey(SID, { title: "نظرسنجی رضایت" });
  assert.equal(s.questions.length, 0);
  assert.equal(s.is_active, false);
  assert.match(s.id, /^sv_[0-9a-f]{12}$/);
});

test("createSurvey rejects an empty title", async () => {
  installSheet();
  await assert.rejects(() => store.createSurvey(SID, { title: "  " }));
});

test("updateSurvey changes metadata without touching questions", async () => {
  installSheet();
  const s = await store.createSurvey(SID, { title: "x" });
  await store.addQuestion(SID, s.id, { text: "س", type: "rating" });
  const updated = await store.updateSurvey(SID, s.id, { title: "y", is_quiz: true });
  assert.equal(updated.title, "y");
  assert.equal(updated.questions.length, 1);
});

test("deleteSurvey removes the survey and its responses", async () => {
  const tabs = installSheet();
  const s = await store.createSurvey(SID, { title: "x" });
  tabs.set("survey_responses", new Map([
    ["svr_1", { id: "svr_1", survey_id: s.id, answers: {} }],
    ["svr_2", { id: "svr_2", survey_id: "other", answers: {} }],
  ]));
  assert.equal(await store.deleteSurvey(SID, s.id), true);
  assert.equal(await store.getSurvey(SID, s.id), null);
  assert.equal(tabs.get("survey_responses").has("svr_1"), false);
  assert.equal(tabs.get("survey_responses").has("svr_2"), true);
});

// ── questions ────────────────────────────────────────────────────────────

test("addQuestion assigns sequential ids that are never reused", async () => {
  installSheet();
  let s = await store.createSurvey(SID, { title: "x" });
  s = await store.addQuestion(SID, s.id, { text: "اول", type: "rating" });
  s = await store.addQuestion(SID, s.id, { text: "دوم", type: "rating" });
  s = await store.removeQuestion(SID, s.id, 1);
  s = await store.addQuestion(SID, s.id, { text: "سوم", type: "rating" });
  assert.deepEqual(s.questions.map((q) => q.id), [2, 3]);
});

test("addQuestion rejects a choice question with fewer than two options", async () => {
  installSheet();
  const s = await store.createSurvey(SID, { title: "x" });
  await assert.rejects(() => store.addQuestion(SID, s.id, { text: "?", type: "choice", options: ["فقط یکی"] }));
});

test("addQuestion rejects an unknown type", async () => {
  installSheet();
  const s = await store.createSurvey(SID, { title: "x" });
  await assert.rejects(() => store.addQuestion(SID, s.id, { text: "?", type: "matrix" }));
});

test("addQuestion enforces the max questions cap", async () => {
  installSheet();
  let s = await store.createSurvey(SID, { title: "x" });
  for (let i = 0; i < store.MAX_QUESTIONS; i++) {
    s = await store.addQuestion(SID, s.id, { text: `سؤال ${i}`, type: "rating" });
  }
  await assert.rejects(() => store.addQuestion(SID, s.id, { text: "یکی بیشتر", type: "rating" }));
});

test("addQuestion only attaches correct_index for quiz choice questions", async () => {
  const plain = await (async () => {
    installSheet();
    let s = await store.createSurvey(SID, { title: "ساده", is_quiz: false });
    s = await store.addQuestion(SID, s.id, { text: "کدام؟", type: "choice", options: ["الف", "ب"], correct_index: 0 });
    return s;
  })();
  assert.equal(plain.questions[0].correct, undefined);

  installSheet();
  let quiz = await store.createSurvey(SID, { title: "کوییز", is_quiz: true });
  quiz = await store.addQuestion(SID, quiz.id, { text: "کدام؟", type: "choice", options: ["الف", "ب"], correct_index: 1 });
  assert.equal(quiz.questions[0].correct, 1);
});

test("updateQuestion edits text/options in place, keeping the same id", async () => {
  installSheet();
  let s = await store.createSurvey(SID, { title: "x", is_quiz: true });
  s = await store.addQuestion(SID, s.id, { text: "کدام؟", type: "choice", options: ["الف", "ب"], correct_index: 0 });
  const questionId = s.questions[0].id;
  s = await store.updateQuestion(SID, s.id, questionId, { text: "کدام رنگ؟", correct_index: 1 });
  assert.equal(s.questions[0].id, questionId);
  assert.equal(s.questions[0].text, "کدام رنگ؟");
  assert.equal(s.questions[0].correct, 1);
});

test("updateQuestion 404s on an unknown question id", async () => {
  installSheet();
  const s = await store.createSurvey(SID, { title: "x" });
  await assert.rejects(() => store.updateQuestion(SID, s.id, 999, { text: "x" }));
});

test("removeQuestion forces the survey back to unpublished when it was the last one", async () => {
  installSheet();
  let s = await store.createSurvey(SID, { title: "x" });
  s = await store.addQuestion(SID, s.id, { text: "تنها سؤال", type: "rating" });
  s = await store.setActive(SID, s.id, true);
  s = await store.removeQuestion(SID, s.id, s.questions[0].id);
  assert.equal(s.is_active, false);
  assert.equal(s.questions.length, 0);
});

// ── publish gate ─────────────────────────────────────────────────────────

test("setActive rejects publishing with zero questions", async () => {
  installSheet();
  const s = await store.createSurvey(SID, { title: "x" });
  await assert.rejects(() => store.setActive(SID, s.id, true));
});

test("setActive publishes once a question exists", async () => {
  installSheet();
  let s = await store.createSurvey(SID, { title: "x" });
  s = await store.addQuestion(SID, s.id, { text: "س", type: "rating" });
  const updated = await store.setActive(SID, s.id, true);
  assert.equal(updated.is_active, true);
});

// ── results aggregation ──────────────────────────────────────────────────

test("getResults reports choice counts and percentages", async () => {
  installSheet();
  let s = await store.createSurvey(SID, { title: "x" });
  s = await store.addQuestion(SID, s.id, { text: "کدام رنگ؟", type: "choice", options: ["قرمز", "آبی"] });
  const qid = String(s.questions[0].id);
  await botConfig.sheetLayer.upsertRow(SID, "survey_responses", "r1", { survey_id: s.id, answers: { [qid]: "0" } });
  await botConfig.sheetLayer.upsertRow(SID, "survey_responses", "r2", { survey_id: s.id, answers: { [qid]: "0" } });
  await botConfig.sheetLayer.upsertRow(SID, "survey_responses", "r3", { survey_id: s.id, answers: { [qid]: "1" } });

  const [summary] = await store.getResults(SID, s.id);
  assert.equal(summary.answered, 3);
  assert.equal(summary.options[0].count, 2);
  assert.equal(summary.options[0].percent, 66.7);
  assert.equal(summary.options[1].count, 1);
  assert.equal(summary.options[1].percent, 33.3);
});

test("getResults reports the rating average", async () => {
  installSheet();
  let s = await store.createSurvey(SID, { title: "x" });
  s = await store.addQuestion(SID, s.id, { text: "چقدر راضی بودید؟", type: "rating" });
  const qid = String(s.questions[0].id);
  await botConfig.sheetLayer.upsertRow(SID, "survey_responses", "r1", { survey_id: s.id, answers: { [qid]: "4" } });
  await botConfig.sheetLayer.upsertRow(SID, "survey_responses", "r2", { survey_id: s.id, answers: { [qid]: "2" } });

  const [summary] = await store.getResults(SID, s.id);
  assert.equal(summary.average, 3);
});

test("getResults samples at most five text answers", async () => {
  installSheet();
  let s = await store.createSurvey(SID, { title: "x" });
  s = await store.addQuestion(SID, s.id, { text: "نظرتان؟", type: "text" });
  const qid = String(s.questions[0].id);
  for (let i = 0; i < 7; i++) {
    await botConfig.sheetLayer.upsertRow(SID, "survey_responses", `r${i}`, { survey_id: s.id, answers: { [qid]: `نظر ${i}` } });
  }

  const [summary] = await store.getResults(SID, s.id);
  assert.equal(summary.answered, 7);
  assert.equal(summary.samples.length, 5);
});

test("getResults for an unknown survey is empty", async () => {
  installSheet();
  assert.deepEqual(await store.getResults(SID, "sv_missing"), []);
});

// ── stats ────────────────────────────────────────────────────────────────

test("getStats counts total, active (published + has questions), and responses", async () => {
  installSheet();
  let active = await store.createSurvey(SID, { title: "فعال" });
  active = await store.addQuestion(SID, active.id, { text: "س", type: "rating" });
  await store.setActive(SID, active.id, true);
  await store.createSurvey(SID, { title: "پیش‌نویس" });
  await botConfig.sheetLayer.upsertRow(SID, "survey_responses", "r1", { survey_id: active.id, answers: {} });

  const stats = await store.getStats(SID);
  assert.equal(stats.total, 2);
  assert.equal(stats.active, 1);
  assert.equal(stats.responses, 1);
});
