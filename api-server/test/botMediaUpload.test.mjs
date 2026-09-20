/**
 * test/botMediaUpload.test.mjs
 *
 * User report: "تلگرام فایل را نمی‌پذیرد ... عکس یا فیلم یا گیف یا وویس یا
 * آهنگ رو باید ساپورت کنه ... باید سریع آپلود بشه روی تلگرام و آیدی بگیره ...
 * نباید سیو بشه روی دیتابیس‌ها فقط آیدی باید سیو بشه" -- panels' media
 * upload (routes/botMedia.ts) had video/* hard-rejected before it ever
 * reached Telegram (ALLOWED_PREFIXES was only image/+audio/), and even
 * image/gif fell through to sendDocument instead of sendAnimation, losing
 * its animated preview. Fixed by widening ALLOWED_PREFIXES to include
 * video/, giving gif its own sendAnimation branch, and giving video/* a
 * sendVideo branch -- plus a dedicated, wider request-body-size tier
 * (app.ts's MEDIA_BODY_LIMIT) scoped to just this one route, so real
 * video/audio files aren't squeezed by the 10mb cap every other /api/bots
 * route shares.
 *
 * The route never stores the uploaded bytes anywhere itself (no schema
 * change here at all) -- it streams straight through to Telegram's API and
 * returns only the resulting file_id, which is the caller's job to persist.
 * That part was already correct; nothing here touches it.
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

const { __testables, uploadBufferToBotChat } = await import("../src/routes/botMedia.ts");
const { telegramTarget, ALLOWED_PREFIXES, MAX_UPLOAD_BYTES } = __testables;

function withFetchSpy(responses, run) {
  const calls = [];
  const original = global.fetch;
  let i = 0;
  global.fetch = async (url) => {
    calls.push(String(url));
    const body = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return { json: async () => body };
  };
  return run(calls).finally(() => {
    global.fetch = original;
  });
}

const __dirname = dirname(fileURLToPath(import.meta.url));

test("ALLOWED_PREFIXES now accepts video, not just image and audio", () => {
  assert.deepEqual([...ALLOWED_PREFIXES].sort(), ["audio/", "image/", "video/"]);
});

test("MAX_UPLOAD_BYTES was raised well past the old 7MB cap", () => {
  assert.ok(MAX_UPLOAD_BYTES > 20 * 1024 * 1024, `expected a real jump from 7MB, got ${MAX_UPLOAD_BYTES}`);
});

test("telegramTarget: image/gif goes to sendAnimation (keeps it animated), not sendPhoto or sendDocument", () => {
  const target = telegramTarget("image/gif");
  assert.equal(target.method, "sendAnimation");
  assert.equal(target.field, "animation");
  assert.equal(target.resultKey, "animation");
});

test("telegramTarget: every other image/* goes to sendPhoto", () => {
  for (const mime of ["image/jpeg", "image/png", "image/webp"]) {
    const target = telegramTarget(mime);
    assert.equal(target.method, "sendPhoto", mime);
    assert.equal(target.field, "photo", mime);
  }
});

test("telegramTarget: video/* goes to sendVideo -- the actual fix for 'Telegram doesn't accept the file'", () => {
  for (const mime of ["video/mp4", "video/quicktime", "video/webm"]) {
    const target = telegramTarget(mime);
    assert.equal(target.method, "sendVideo", mime);
    assert.equal(target.field, "video", mime);
    assert.equal(target.resultKey, "video", mime);
  }
});

test("telegramTarget: audio/ogg and audio/opus go to sendVoice (the panel voice-message bubble)", () => {
  for (const mime of ["audio/ogg", "audio/opus"]) {
    const target = telegramTarget(mime);
    assert.equal(target.method, "sendVoice", mime);
    assert.equal(target.field, "voice", mime);
  }
});

test("telegramTarget: other audio/* (music) goes to sendAudio, distinct from voice", () => {
  for (const mime of ["audio/mpeg", "audio/mp4", "audio/wav"]) {
    const target = telegramTarget(mime);
    assert.equal(target.method, "sendAudio", mime);
    assert.equal(target.field, "audio", mime);
  }
});

test("telegramTarget: an unrecognized type still falls back to sendDocument, not a crash", () => {
  const target = telegramTarget("application/pdf");
  assert.equal(target.method, "sendDocument");
});

// User report: "همچنان موقعِ ارسالِ این عکس میگه تلگرام نپذیرفت ... اگه فرمتِ
// اشتباهی داره یه کاری کن که با این فرمت هم بشه" — a specific oversized/odd-
// shaped photo (a marketing collage) is rejected by sendPhoto's stricter
// dimension/size limits. uploadBufferToBotChat now retries as sendDocument
// instead of failing the whole upload.

test("uploadBufferToBotChat: when sendPhoto rejects the file, it retries as sendDocument and succeeds", async () => {
  await withFetchSpy(
    [
      { ok: false, description: "PHOTO_INVALID_DIMENSIONS" },
      { ok: true, result: { document: { file_id: "doc_fallback_123" } } },
    ],
    async (calls) => {
      const result = await uploadBufferToBotChat(
        "TEST_TOKEN", "123456", Buffer.from("fake-image-bytes"), "image/jpeg", "collage.jpg"
      );
      assert.equal(result.fileId, "doc_fallback_123");
      assert.equal(result.type, "document", "must report the actual outcome (document), not the original resultKey (photo)");
      assert.equal(calls.length, 2);
      assert.match(calls[0], /sendPhoto/);
      assert.match(calls[1], /sendDocument/);
    }
  );
});

test("uploadBufferToBotChat: a successful first attempt never triggers the sendDocument fallback", async () => {
  await withFetchSpy(
    [{ ok: true, result: { photo: [{ file_id: "photo_ok_1" }, { file_id: "photo_ok_2" }] } }],
    async (calls) => {
      const result = await uploadBufferToBotChat(
        "TEST_TOKEN", "123456", Buffer.from("fake-image-bytes"), "image/jpeg", "normal.jpg"
      );
      assert.equal(result.fileId, "photo_ok_2");
      assert.equal(result.type, "photo");
      assert.equal(calls.length, 1);
    }
  );
});

test("uploadBufferToBotChat: if sendDocument itself also rejects (the fallback's own attempt), it throws instead of retrying forever", async () => {
  await withFetchSpy(
    [
      { ok: false, description: "PHOTO_INVALID_DIMENSIONS" },
      { ok: false, description: "FILE_TOO_BIG" },
    ],
    async (calls) => {
      await assert.rejects(
        () => uploadBufferToBotChat("TEST_TOKEN", "123456", Buffer.from("x"), "image/jpeg", "huge.jpg"),
        (err) => {
          assert.match(err.message, /تلگرام فایل را نپذیرفت/);
          return true;
        }
      );
      assert.equal(calls.length, 2, "must attempt the sendDocument fallback exactly once, then stop");
    }
  );
});

test("uploadBufferToBotChat: a sendDocument rejection is never retried again as sendDocument (no infinite loop)", async () => {
  await withFetchSpy([{ ok: false, description: "FILE_TOO_BIG" }], async (calls) => {
    await assert.rejects(() =>
      uploadBufferToBotChat("TEST_TOKEN", "123456", Buffer.from("x"), "application/pdf", "doc.pdf")
    );
    assert.equal(calls.length, 1, "method was already sendDocument, so there is no distinct fallback to retry with");
  });
});

// Live incident (golazin): the sendDocument-fallback fix above did NOT fix
// this report — Railway logs showed sendPhoto rejected with description
// "Not Found", not a dimension/size error. That's Telegram's own signature
// for "this bot token is invalid", completely unrelated to the file, and
// retrying as sendDocument only wastes a call before failing identically.
// uploadBufferToBotChat must recognize this and say so, instead of the
// generic (and here actively misleading) "تلگرام فایل را نپذیرفت".

test("uploadBufferToBotChat: a 404 'Not Found' (invalid bot token) is reported as a token problem, not a file problem, and skips the sendDocument retry", async () => {
  await withFetchSpy(
    [{ ok: false, error_code: 404, description: "Not Found" }],
    async (calls) => {
      await assert.rejects(
        () => uploadBufferToBotChat("BAD_TOKEN", "123456", Buffer.from("fake-image-bytes"), "image/jpeg", "collage.jpg"),
        (err) => {
          assert.match(err.message, /توکن/);
          assert.doesNotMatch(err.message, /تلگرام فایل را نپذیرفت/);
          assert.equal(err.code, "invalid_token");
          return true;
        }
      );
      assert.equal(calls.length, 1, "an invalid-token response must not trigger the sendDocument retry -- it would just fail the same way again");
    }
  );
});

test("uploadBufferToBotChat: a 401 'Unauthorized' (revoked bot token) is also reported as a token problem", async () => {
  await withFetchSpy(
    [{ ok: false, error_code: 401, description: "Unauthorized" }],
    async (calls) => {
      await assert.rejects(
        () => uploadBufferToBotChat("REVOKED_TOKEN", "123456", Buffer.from("x"), "image/jpeg", "photo.jpg"),
        (err) => {
          assert.equal(err.code, "invalid_token");
          return true;
        }
      );
      assert.equal(calls.length, 1);
    }
  );
});

test("uploadBufferToBotChat: a real file rejection (not a token problem) still falls through to the sendDocument retry", async () => {
  await withFetchSpy(
    [
      { ok: false, description: "PHOTO_INVALID_DIMENSIONS" },
      { ok: true, result: { document: { file_id: "doc_ok" } } },
    ],
    async (calls) => {
      const result = await uploadBufferToBotChat(
        "TEST_TOKEN", "123456", Buffer.from("x"), "image/jpeg", "collage.jpg"
      );
      assert.equal(result.fileId, "doc_ok");
      assert.equal(calls.length, 2, "a genuine file rejection must still get the sendDocument retry -- only the token-invalid case skips it");
    }
  );
});

test("route rejects an unsupported type (e.g. application/pdf) with a 400 before ever calling Telegram", () => {
  const source = readFileSync(join(__dirname, "../src/routes/botMedia.ts"), "utf-8");
  const idx = source.indexOf("ALLOWED_PREFIXES.some");
  assert.ok(idx > 0, "the type gate must still exist");
  const nearby = source.slice(idx, idx + 200);
  assert.match(nearby, /BotConfigError\(\s*400/s, "must still reject unsupported types with 400, before any Telegram call");
});

test("app.ts gives POST /bots/:botId/media its own larger body-size tier, scoped to that one path", () => {
  const appSource = readFileSync(join(__dirname, "../src/app.ts"), "utf-8");
  assert.match(appSource, /MEDIA_BODY_LIMIT/, "a dedicated media body-limit tier must exist");
  assert.match(
    appSource,
    /MEDIA_UPLOAD_PATH\s*=\s*\/[^\n]*bots[^\n]*media[^\n]*\//,
    "the tier must be scoped to the media upload path specifically, not the whole /api/bots prefix"
  );
  // Must not just widen the shared LARGE_BODY_LIMIT itself -- that would
  // reopen the body-size attack surface for every other /api/bots/* route,
  // exactly what the original 10mb-cap comment was written to avoid.
  assert.match(appSource, /LARGE_BODY_LIMIT\s*=\s*"10mb"/, "the general large-body tier must stay at its original, tighter cap");
});
