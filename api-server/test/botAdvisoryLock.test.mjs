/**
 * test/botAdvisoryLock.test.mjs — IRFORGE_PROMPT_V3 Phase 24
 *
 * Pins lib/botAdvisoryLock.ts's hand-rolled CRC-32 (used instead of Node's
 * zlib.crc32(), only available on Node 22+) bit-for-bit against Python's
 * zlib.crc32() — verified manually against `python3 -c "import zlib; ..."`
 * for these exact vectors before writing this file. If this ever drifts,
 * a website wallet mutation would take a *different* pg_advisory_lock key
 * than plugins/wallet/service.py::_wallet_lock does for the same wallet,
 * silently defeating the whole point of the lock (see the file's own
 * header comment).
 *
 * اجرا: pnpm --filter @workspace/api-server run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";

const { advisoryLock, __testables } = await import("../src/lib/botAdvisoryLock.ts");

// python3 -c "import zlib; print(zlib.crc32(b'<s>'))" for each of these.
const VECTORS = [
  ["a", 3904355907],
  ["ab", 2659403885],
  ["abc", 891568578],
  ["wallet:apply:tg:987654321:irt", 2623346411],
  ["x".repeat(50), 2892139011],
];

test("crc32 matches Python's zlib.crc32 bit-for-bit", () => {
  for (const [input, expected] of VECTORS) {
    assert.equal(__testables.crc32(input), expected, `crc32(${JSON.stringify(input).slice(0, 20)})`);
  }
});

test("advisoryKeyFor masks to 31 bits, matching utils/postgres_store.py::_advisory_key", () => {
  for (const [input, rawCrc] of VECTORS) {
    assert.equal(__testables.advisoryKeyFor(input), rawCrc & 0x7FFFFFFF);
  }
});

test("isConfigured reflects BOT_CACHE_DATABASE_URL", () => {
  const prev = process.env.BOT_CACHE_DATABASE_URL;
  try {
    delete process.env.BOT_CACHE_DATABASE_URL;
    assert.equal(advisoryLock.isConfigured(), false);
    process.env.BOT_CACHE_DATABASE_URL = "postgresql://x:x@127.0.0.1:1/x";
    assert.equal(advisoryLock.isConfigured(), true);
  } finally {
    if (prev === undefined) delete process.env.BOT_CACHE_DATABASE_URL;
    else process.env.BOT_CACHE_DATABASE_URL = prev;
  }
});

test("withLock throws (never silently proceeds unlocked) when the lock DB isn't configured", async () => {
  const prev = process.env.BOT_CACHE_DATABASE_URL;
  try {
    delete process.env.BOT_CACHE_DATABASE_URL;
    let ran = false;
    await assert.rejects(
      () => advisoryLock.withLock("wallet:apply:user:1:irt", async () => { ran = true; }),
      /BOT_CACHE_DATABASE_URL/,
    );
    assert.equal(ran, false, "fn must never run without the lock actually held");
  } finally {
    if (prev === undefined) delete process.env.BOT_CACHE_DATABASE_URL;
    else process.env.BOT_CACHE_DATABASE_URL = prev;
  }
});
