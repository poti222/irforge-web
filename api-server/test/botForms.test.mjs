/**
 * test/botForms.test.mjs
 *
 * Two things landed in routes/botForms.ts together:
 *
 *  - The live "can't edit a form" bug: POST/PATCH/DELETE unconditionally
 *    called assertSheetsAuthoritative(FORMS_TAB), which 409s the instant a
 *    tenant's "forms" cutover flag is on — this file doesn't re-test that
 *    directly (it's a route/DB-integration behavior, covered instead by
 *    businessPg.test.mjs's new forms round-trip + "forms" now being a
 *    known Postgres entity), but the fix depended on lib/businessPg.ts
 *    knowing about "forms" at all.
 *
 *  - Thank-you message media + buttons (Form.thank_you_media_file_id/
 *    thank_you_media_type/thank_you_buttons, the same PanelButton shape
 *    panels.buttons already has). This file covers the new pure
 *    validators: validateThankYouMediaType, validateThankYouMediaFileId,
 *    validateThankYouButtons (a thin reuse of routes/botPanels.ts's own
 *    validateButtons — not re-tested exhaustively here, just proven to be
 *    wired through).
 *
 * اجرا: pnpm --filter @workspace/api-server run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";
process.env.BOT_TOKEN_ENCRYPTION_KEY ??= "g".repeat(64);

const { __testables } = await import("../src/routes/botForms.ts");
const { validateThankYouMediaType, validateThankYouMediaFileId, validateThankYouButtons } = __testables;

// ─── validateThankYouMediaType ─────────────────────────────────────────────

test("validateThankYouMediaType: accepts photo/video/audio/document", () => {
  for (const t of ["photo", "video", "audio", "document"]) {
    assert.equal(validateThankYouMediaType(t), t);
  }
});

test("validateThankYouMediaType: undefined/null/empty/whitespace all mean 'no media'", () => {
  assert.equal(validateThankYouMediaType(undefined), "");
  assert.equal(validateThankYouMediaType(null), "");
  assert.equal(validateThankYouMediaType(""), "");
  assert.equal(validateThankYouMediaType("   "), "");
});

test("validateThankYouMediaType: rejects anything outside the four known kinds", () => {
  assert.throws(() => validateThankYouMediaType("sticker"));
  assert.throws(() => validateThankYouMediaType("carousel"));
});

// ─── validateThankYouMediaFileId ───────────────────────────────────────────

test("validateThankYouMediaFileId: passes a real-looking file_id through untouched", () => {
  const fid = "AgACAgIAAxkBAAIB" + "x".repeat(40);
  assert.equal(validateThankYouMediaFileId(fid), fid);
});

test("validateThankYouMediaFileId: undefined/null become empty string (no media)", () => {
  assert.equal(validateThankYouMediaFileId(undefined), "");
  assert.equal(validateThankYouMediaFileId(null), "");
});

test("validateThankYouMediaFileId: rejects an absurdly long value", () => {
  assert.throws(() => validateThankYouMediaFileId("x".repeat(501)));
});

// ─── validateThankYouButtons (reuses routes/botPanels.ts::validateButtons) ─

test("validateThankYouButtons: a valid single-row button list round-trips with row/row_start normalized", () => {
  const out = validateThankYouButtons([{ label: "سایت ما", action: "url", value: "https://irforge.ir" }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].label, "سایت ما");
  assert.equal(out[0].row, 0);
  assert.equal(out[0].row_start, true);
});

test("validateThankYouButtons: empty array is valid (no buttons)", () => {
  assert.deepEqual(validateThankYouButtons([]), []);
});

test("validateThankYouButtons: rejects a url action without https://", () => {
  assert.throws(() => validateThankYouButtons([{ label: "بد", action: "url", value: "http://insecure.example" }]));
});

test("validateThankYouButtons: rejects a button with no label", () => {
  assert.throws(() => validateThankYouButtons([{ label: "", action: "panel", value: "p1" }]));
});

test("validateThankYouButtons: non-array input is rejected", () => {
  assert.throws(() => validateThankYouButtons("not-an-array"));
});
