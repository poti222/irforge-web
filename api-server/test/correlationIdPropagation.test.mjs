/**
 * test/correlationIdPropagation.test.mjs
 * IRFORGE_POSTGRES_FULL_MIGRATION_PROMPT, pg-migration checkpoint — item 3.
 *
 * A live incident showed the correlationId sendBotConfigError mints on an
 * "unexpected" error appeared in ZERO of 156 real error-log entries for the
 * exact Sheets quota/permission failures it exists to make greppable —
 * every bot-section route's catch block genuinely does call
 * sendBotConfigError, and static analysis of the branching logic, of
 * pino's handling of a circular GaxiosError-shaped object, and of the real
 * GaxiosError class all showed the correlationId branch SHOULD fire. Root
 * cause could not be reproduced from a sandbox with no access to the
 * deployed build artifact.
 *
 * Rather than leave this as an unfalsifiable mystery, the fix makes the id
 * survive regardless of which layer's log line the deployed build actually
 * executes: sheets.ts now mints it AT THE MOMENT the Sheets call first
 * fails (readSheet/writeSheet/listTabs/etc.) and stamps it onto the error
 * object; sendBotConfigError reuses that id instead of minting a second,
 * disconnected one. This test proves that hand-off actually happens, end
 * to end, through the exact two functions every real bot-section route
 * calls — using a REAL network call to Google (with syntactically valid
 * but fake credentials) so the error shape is the genuine GaxiosError
 * class, not a hand-rolled stand-in that might not match production.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";

// A throwaway RSA key generated locally -- never a real Google credential.
// This lets GoogleAuth build a real signed JWT and make a real network call
// to Google, which rejects it with a genuine GaxiosError (invalid_grant) --
// the same error *class* and property shape every quota/permission error
// in production actually has (verified separately: same constructor,
// same `status`/`response`/`config` shape, `.error` undefined not a string).
const fakeKey = execSync("openssl genrsa 2048 2>/dev/null").toString();
process.env.GOOGLE_CREDENTIALS_JSON = JSON.stringify({
  client_email: "test-fake@fake-project.iam.gserviceaccount.com",
  private_key: fakeKey,
});
// botConfig.ts imports @workspace/db, which requires DATABASE_URL to exist
// at module load -- never actually queried here, same placeholder pattern
// sheetsSyncRegistry.test.mjs already uses.
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";

const { readSheet } = await import("../src/lib/sheets.ts");
const { sendBotConfigError } = await import("../src/lib/botConfig.ts");

function fakeRes() {
  const res = {
    statusCode: undefined,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  return res;
}

test(
  "a real Sheets failure surfaces the SAME correlation id sheets.ts logged, through sendBotConfigError, to the client response",
  { timeout: 20_000 },
  async () => {
    let caughtErr;
    try {
      // Real network call, real rejection -- not a mock.
      await readSheet("1tGXNhTpImPKm7_57RpdRokUTJLBarp0KGhVqMRByKg8", "Sheet1!A:B");
      assert.fail("expected readSheet to reject against fake credentials");
    } catch (err) {
      caughtErr = err;
    }

    // sheets.ts must have stamped an id onto the error the moment it failed.
    assert.equal(typeof caughtErr.correlationId, "string");
    assert.ok(caughtErr.correlationId.length > 0);
    const idFromSheetsLayer = caughtErr.correlationId;

    // This is exactly what every real bot-section route's catch block does.
    const res = fakeRes();
    sendBotConfigError(res, caughtErr, "Failed to read bot settings");

    assert.equal(res.statusCode, 500);
    assert.equal(typeof res.body.correlationId, "string");
    // The critical assertion: the id the client sees is the SAME one
    // sheets.ts already logged at the point of failure -- not a second,
    // disconnected id that leaves the low-level diagnostic line orphaned.
    assert.equal(res.body.correlationId, idFromSheetsLayer);
  }
);

test("sendBotConfigError still mints a fresh id for an error with no correlationId of its own", () => {
  const res = fakeRes();
  sendBotConfigError(res, new Error("some other kind of failure"), "Failed to do something");
  assert.equal(res.statusCode, 500);
  assert.equal(typeof res.body.correlationId, "string");
  assert.ok(res.body.correlationId.length > 0);
});
