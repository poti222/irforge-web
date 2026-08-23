/**
 * test/bookingAvailability.test.mjs — IRFORGE_PROMPT_V3 Phase 17
 *
 * Runs the exact same shared fixture (test/fixtures/booking_availability_cases.json)
 * that bot/tests/test_booking_availability.py runs against the Python
 * implementation — the whole point of computeAvailableSlots() being a
 * pure, dependency-free function is that both ports can be independently
 * checked against one source of truth. See lib/bookingAvailability.ts's
 * module docstring.
 *
 * اجرا: pnpm --filter @workspace/api-server run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { computeAvailableSlots } = await import("../src/lib/bookingAvailability.ts");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, "fixtures", "booking_availability_cases.json");
const { cases } = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

assert.ok(cases.length >= 12, "fixture should not silently lose cases");

for (const testCase of cases) {
  test(`computeAvailableSlots: ${testCase.name}`, () => {
    const result = computeAvailableSlots(testCase.input);
    const starts = result.map((row) => row.start);
    assert.deepEqual(starts, testCase.expected_starts, testCase.name);

    if (testCase.expected_free) {
      const freeByStart = Object.fromEntries(result.map((row) => [row.start, row.free]));
      for (const [start, expected] of Object.entries(testCase.expected_free)) {
        assert.equal(freeByStart[start], expected, `${testCase.name}: free count for ${start}`);
      }
    }
  });
}
