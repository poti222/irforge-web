/**
 * test/botLifetime.test.mjs — برچسبِ عمرِ بات در لیست + دلایلِ «نیازمندِ توجه» (استاندارد/پرو ۳۰ روزه‌اند، تریال ۷ روز،
 * و بعد از انقضا شمارشِ معکوسِ حذفِ نهایی). لایوباگ ۲۰۲۶-۱۰-۰۶.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const { botLifetime } = await import("../src/lib/bot-lifetime.ts");
const { attentionReason, botsNeedingAttention } = await import("../src/lib/dashboard-attention.ts");

test("لیست: تریال با روزِ مانده؛ ≤۳ روز زرد", () => {
  assert.deepEqual(botLifetime({ status: "active", isTrial: true, trialDaysLeft: 5 }, "fa"), { text: "تریال · 5 روز مانده", tone: "ok" });
  assert.equal(botLifetime({ status: "active", isTrial: true, trialDaysLeft: 3 }, "en").tone, "warn");
  assert.equal(botLifetime({ status: "expired", isTrial: true, trialDaysLeft: -1 }, "en").text, "Trial ended");
});

test("لیست: استاندارد/پرو هم زمان دارند (قبلاً فقط تریال نمایش داده می‌شد)", () => {
  const std = { status: "active", isTrial: false, trialDaysLeft: null, tier: "standard", tierExpiresAt: "2026-11-01T00:00:00Z", tierDaysLeft: 30 };
  assert.deepEqual(botLifetime(std, "fa"), { text: "استاندارد · 30 روز مانده", tone: "ok" });
  assert.deepEqual(botLifetime({ ...std, tier: "pro", tierDaysLeft: 2 }, "en"), { text: "Pro · 2d left", tone: "warn" });
  assert.equal(botLifetime({ ...std, status: "tier_expired", tierDaysLeft: -1 }, "en").text, "Package ended");
  assert.equal(botLifetime({ ...std, tier: "custom" }, "en"), null, "سفارشی زمان ندارد");
  assert.equal(botLifetime({ status: "active", isTrial: false, trialDaysLeft: null }, "en"), null);
});

test("لیست: شمارشِ معکوسِ حذفِ نهایی بر همه چیز مقدم است (قرمز) — در هر ۵ زبان", () => {
  const bot = { status: "tier_expired", isTrial: false, trialDaysLeft: null, tier: "pro", tierExpiresAt: "x", tierDaysLeft: -3, purgeDaysLeft: 4 };
  for (const lang of ["fa", "en", "ar", "tr", "ru"]) {
    const b = botLifetime(bot, lang);
    assert.equal(b.tone, "danger", lang);
    assert.ok(b.text.includes("4"), `${lang}: ${b.text}`);
  }
  assert.equal(botLifetime({ status: "expired", isTrial: true, trialDaysLeft: -8, purgeDaysLeft: 0 }, "en").text, "Deleted in 0d");
});

test("داشبورد: پکیجِ تمام‌شده و پکیجِ نزدیک به پایان نیازمندِ توجه‌اند", () => {
  assert.equal(attentionReason({ status: "tier_expired", isTrial: false, trialDaysLeft: null }), "tierExpired");
  assert.equal(attentionReason({ status: "active", isTrial: false, trialDaysLeft: null, tierExpiresAt: "x", tierDaysLeft: 3 }), "tierEndingSoon");
  assert.equal(attentionReason({ status: "active", isTrial: false, trialDaysLeft: null, tierExpiresAt: "x", tierDaysLeft: 4 }), null);
  assert.equal(attentionReason({ status: "active", isTrial: false, trialDaysLeft: null, tierExpiresAt: null, tierDaysLeft: null }), null);
  assert.equal(botsNeedingAttention([{ status: "tier_expired", isTrial: false, trialDaysLeft: null }]).length, 1);
});
