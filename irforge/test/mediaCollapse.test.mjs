/**
 * test/mediaCollapse.test.mjs
 * IRFORGE_TELEGRAM_UPLOAD_PANELTYPES_VPNDELIVERY_PROMPT — بخش B.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const { isMediaLikeType, isWalletLikeType, panelMediaItems, panelWalletMode } = await import(
  "../src/components/bots/panels/mediaCollapse.ts"
);

function panel(overrides = {}) {
  return {
    id: "p1", title: "t", type: "text", content: "", media_file_id: "",
    buttons: [], settings: {}, children: [], parent_id: null,
    is_home: false, is_active: true, created_at: "", updated_at: "",
    ...overrides,
  };
}

test("isMediaLikeType شاملِ نوعِ تازه و هر شش نوعِ قدیمی است", () => {
  for (const t of ["media", "text", "photo", "video", "audio", "document", "carousel"]) {
    assert.equal(isMediaLikeType(t), true, t);
  }
  for (const t of ["form", "sell", "wallet", "catalog_store", "wallet_balance"]) {
    assert.equal(isMediaLikeType(t), false, t);
  }
});

test("isWalletLikeType شاملِ هر دو کلیدِ قدیمی/تازه است", () => {
  assert.equal(isWalletLikeType("wallet"), true);
  assert.equal(isWalletLikeType("wallet_balance"), true);
  assert.equal(isWalletLikeType("media"), false);
});

test("panelMediaItems: media_items تازه اولویت دارد", () => {
  const items = panelMediaItems(panel({
    type: "media",
    settings: { media_items: [{ type: "video", file_id: "v1" }, { type: "photo", file_id: "p1" }] },
  }));
  assert.deepEqual(items, [{ type: "video", file_id: "v1" }, { type: "photo", file_id: "p1" }]);
});

test("panelMediaItems: media_items با type ناشناخته به photo می‌افتد", () => {
  const items = panelMediaItems(panel({
    type: "media",
    settings: { media_items: [{ type: "sticker", file_id: "s1" }] },
  }));
  assert.deepEqual(items, [{ type: "photo", file_id: "s1" }]);
});

test("panelMediaItems: نوعِ قدیمیِ carousel از carousel_ids می‌خواند", () => {
  const items = panelMediaItems(panel({ type: "carousel", settings: { carousel_ids: ["a", "b", "c"] } }));
  assert.deepEqual(items, [
    { type: "photo", file_id: "a" },
    { type: "photo", file_id: "b" },
    { type: "photo", file_id: "c" },
  ]);
});

test("panelMediaItems: نوعِ قدیمیِ تک‌مدیایی از media_file_id می‌خواند و subtype را حفظ می‌کند", () => {
  assert.deepEqual(panelMediaItems(panel({ type: "video", media_file_id: "v1" })), [{ type: "video", file_id: "v1" }]);
  assert.deepEqual(panelMediaItems(panel({ type: "document", media_file_id: "d1" })), [{ type: "document", file_id: "d1" }]);
});

test("panelMediaItems: نوعِ text همیشه خالی است حتی اگر media_file_id مانده باشد", () => {
  assert.deepEqual(panelMediaItems(panel({ type: "text", media_file_id: "leftover" })), []);
});

test("panelMediaItems: پنلِ بدونِ مدیا آرایه‌ی خالی می‌دهد", () => {
  assert.deepEqual(panelMediaItems(panel()), []);
  assert.deepEqual(panelMediaItems(panel({ type: "form" })), []);
});

test("panelWalletMode: wallet_balance همیشه شخصی است", () => {
  assert.equal(panelWalletMode(panel({ type: "wallet_balance" })), "personal");
});

test("panelWalletMode: wallet بدونِ mode پیش‌فرضش مشترک است (رفتارِ قبلی)", () => {
  assert.equal(panelWalletMode(panel({ type: "wallet", settings: {} })), "shared");
});

test("panelWalletMode: wallet با mode صریح همان را برمی‌گرداند", () => {
  assert.equal(panelWalletMode(panel({ type: "wallet", settings: { mode: "personal" } })), "personal");
  assert.equal(panelWalletMode(panel({ type: "wallet", settings: { mode: "shared" } })), "shared");
});
