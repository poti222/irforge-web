/**
 * test/botTelegramProfile.test.mjs
 *
 * "Bot profile" (routes/bots.ts's `/bots/:botId/telegram-profile*` family)
 * gained two capabilities: per-language name/description/short-description
 * (Telegram's own `language_code` param on setMyName/setMyDescription/
 * setMyShortDescription, and their get* counterparts) and an animated
 * (MPEG4 video) profile photo, alongside the existing static (JPG) one.
 *
 * The routes themselves need a live authenticated request + a real bot row
 * to exercise (same reason `bots.ts`'s other route-level logic isn't
 * unit-tested directly — see registryTokenDoubleEncryption.test.mjs's own
 * docstring on this). This file covers the two *pure* decision functions
 * those routes now delegate to: `telegramLanguageParam` (turns a raw
 * query/body value into the `{language_code}` object Telegram expects, or
 * `undefined` to mean "the default, for everyone") and
 * `resolveProfilePhotoUpload` (decides static vs. animated from the
 * request body's `type`, validates the matching MIME prefix, and picks the
 * size ceiling for each).
 *
 * اجرا: pnpm --filter @workspace/api-server run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";
process.env.BOT_TOKEN_ENCRYPTION_KEY ??= "c".repeat(64);

const { __testables } = await import("../src/routes/bots.ts");
const { telegramLanguageParam, resolveProfilePhotoUpload } = __testables;

const __dirname = dirname(fileURLToPath(import.meta.url));

test("app.ts's media body-size tier now also covers POST /bots/:botId/telegram-profile/photo, not just /media -- the animated (video) upload needs it, same reasoning as botMediaUpload.test.mjs's equivalent check for /media", () => {
  const appSource = readFileSync(join(__dirname, "../src/app.ts"), "utf-8");
  const match = appSource.match(/const MEDIA_UPLOAD_PATH = (\/[^\n]+\/);/);
  assert.ok(match, "MEDIA_UPLOAD_PATH must still be defined as a single regex literal");
  const mediaUploadPath = new RegExp(match[1].slice(1, -1));
  assert.ok(mediaUploadPath.test("/api/bots/abc123/media"), "must still cover the original /media upload route");
  assert.ok(
    mediaUploadPath.test("/api/bots/abc123/telegram-profile/photo"),
    "must now also cover the animated-profile-photo upload route"
  );
  assert.ok(!mediaUploadPath.test("/api/bots/abc123/telegram-profile"), "must not accidentally widen the plain GET/PATCH profile route");
});

test("telegramLanguageParam: a real language code becomes {language_code}", () => {
  assert.deepEqual(telegramLanguageParam("fa"), { language_code: "fa" });
  assert.deepEqual(telegramLanguageParam("en"), { language_code: "en" });
});

test("telegramLanguageParam: surrounding whitespace is trimmed", () => {
  assert.deepEqual(telegramLanguageParam("  ru  "), { language_code: "ru" });
});

test("telegramLanguageParam: undefined/empty/whitespace-only/non-string all mean \"the default, for everyone\"", () => {
  assert.equal(telegramLanguageParam(undefined), undefined);
  assert.equal(telegramLanguageParam(null), undefined);
  assert.equal(telegramLanguageParam(""), undefined);
  assert.equal(telegramLanguageParam("   "), undefined);
  assert.equal(telegramLanguageParam(123), undefined);
});

test("resolveProfilePhotoUpload: no type (or anything other than \"animated\") is static, requires image/*", () => {
  const ok = resolveProfilePhotoUpload(undefined, "image/jpeg");
  assert.equal(ok.kind, "static");
  assert.equal(ok.maxBytes, 5 * 1024 * 1024);

  const bad = resolveProfilePhotoUpload(undefined, "video/mp4");
  assert.equal(bad.error, "photo must be an image");
});

test("resolveProfilePhotoUpload: type \"animated\" requires video/*, gets the larger ceiling", () => {
  const ok = resolveProfilePhotoUpload("animated", "video/mp4");
  assert.equal(ok.kind, "animated");
  assert.equal(ok.maxBytes, 20 * 1024 * 1024);
  assert.ok(ok.maxBytes > 5 * 1024 * 1024, "animated ceiling must be larger than the static one");

  const bad = resolveProfilePhotoUpload("animated", "image/png");
  assert.equal(bad.error, "animated photo must be a video");
});

test("resolveProfilePhotoUpload: a stray non-\"animated\" string in body.type still falls back to static (never silently accepted as animated)", () => {
  const resolved = resolveProfilePhotoUpload("ANIMATED", "image/jpeg");
  assert.equal(resolved.kind, "static", "only the exact literal \"animated\" should switch kinds");
});
