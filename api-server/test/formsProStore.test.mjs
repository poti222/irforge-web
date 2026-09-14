/**
 * test/formsProStore.test.mjs — IRFORGE_BOOKING_FORM_CONTACT_REFERRAL_PROMPT بخشِ ۲.
 *
 * Exercises lib/formsProStore.ts (the website's read-only archive view over
 * the bot's forms_pro plugin — `formspro_forms`/`formspro_submissions`
 * tabs) against the same fake `botConfig.sheetLayer` harness
 * bookingStore.test.mjs uses.
 *
 * اجرا: pnpm --filter @workspace/api-server run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";
delete process.env.BOT_CACHE_DATABASE_URL;
delete process.env.BUSINESS_DATABASE_URL;

const botConfig = await import("../src/lib/botConfig.ts");
const store = await import("../src/lib/formsProStore.ts");

const SID = "SHEET_TEST_FORMS_PRO";

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

const FORM_1 = {
  title: "نظرسنجیِ رضایت",
  is_open: true,
  questions: [
    { id: 1, label: "نامِ شما؟", options: [], allow_custom: false },
    { id: 2, label: "رنگِ موردعلاقه؟", options: ["قرمز", "آبی"], allow_custom: true },
  ],
  created_at: "2026-01-01T00:00:00+00:00",
};

const FORM_2 = {
  title: "فرمِ بسته",
  is_open: false,
  questions: [{ id: 1, label: "س؟", options: [], allow_custom: false }],
  created_at: "2026-01-02T00:00:00+00:00",
};

test("listForms returns forms with question and submission counts", async () => {
  installSheet({
    formspro_forms: { fpf_1: FORM_1, fpf_2: FORM_2 },
    formspro_submissions: {
      fps_1: { form_id: "fpf_1", user_id: "1", username: "ali", answers: ["رضا", "آبی"], created_at: "2026-01-03T00:00:00+00:00" },
      fps_2: { form_id: "fpf_1", user_id: "2", username: "sara", answers: ["سارا", "قرمز"], created_at: "2026-01-04T00:00:00+00:00" },
    },
  });

  const forms = await store.listForms(SID);
  assert.equal(forms.length, 2);

  const form1 = forms.find((f) => f.id === "fpf_1");
  assert.equal(form1.question_count, 2);
  assert.equal(form1.submission_count, 2);

  const form2 = forms.find((f) => f.id === "fpf_2");
  assert.equal(form2.question_count, 1);
  assert.equal(form2.submission_count, 0);
});

test("getForm returns null for an unknown id", async () => {
  installSheet({ formspro_forms: { fpf_1: FORM_1 } });
  assert.equal(await store.getForm(SID, "missing"), null);
});

test("getForm returns the form with its id set from the sheet key", async () => {
  installSheet({ formspro_forms: { fpf_1: FORM_1 } });
  const form = await store.getForm(SID, "fpf_1");
  assert.equal(form.id, "fpf_1");
  assert.equal(form.title, "نظرسنجیِ رضایت");
});

test("listSubmissions returns only submissions for the given form, newest first", async () => {
  installSheet({
    formspro_forms: { fpf_1: FORM_1, fpf_2: FORM_2 },
    formspro_submissions: {
      fps_1: { form_id: "fpf_1", user_id: "1", username: "ali", answers: ["رضا", "آبی"], created_at: "2026-01-03T00:00:00+00:00" },
      fps_2: { form_id: "fpf_2", user_id: "2", username: "sara", answers: ["س"], created_at: "2026-01-04T00:00:00+00:00" },
      fps_3: { form_id: "fpf_1", user_id: "3", username: "reza", answers: ["رضا۲", "قرمز"], created_at: "2026-01-05T00:00:00+00:00" },
    },
  });

  const submissions = await store.listSubmissions(SID, "fpf_1");
  assert.equal(submissions.length, 2);
  assert.equal(submissions[0].id, "fps_3"); // newest first
  assert.equal(submissions[1].id, "fps_1");
});

test("listSubmissions filters by search across username and answers", async () => {
  installSheet({
    formspro_forms: { fpf_1: FORM_1 },
    formspro_submissions: {
      fps_1: { form_id: "fpf_1", user_id: "1", username: "ali", answers: ["رضا", "آبی"], created_at: "2026-01-03T00:00:00+00:00" },
      fps_2: { form_id: "fpf_1", user_id: "2", username: "sara", answers: ["سارا", "قرمز"], created_at: "2026-01-04T00:00:00+00:00" },
    },
  });

  const byUsername = await store.listSubmissions(SID, "fpf_1", "ali");
  assert.equal(byUsername.length, 1);
  assert.equal(byUsername[0].username, "ali");

  const byAnswer = await store.listSubmissions(SID, "fpf_1", "قرمز");
  assert.equal(byAnswer.length, 1);
  assert.equal(byAnswer[0].username, "sara");

  const noMatch = await store.listSubmissions(SID, "fpf_1", "nothing_matches_this");
  assert.equal(noMatch.length, 0);
});

test("listForms returns an empty list when no forms exist yet", async () => {
  installSheet({});
  const forms = await store.listForms(SID);
  assert.deepEqual(forms, []);
});
