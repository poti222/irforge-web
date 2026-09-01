/**
 * test/sheetsAccessDiagnosis.test.mjs
 * IRFORGE_POSTGRES_FULL_MIGRATION_PROMPT, pg-migration checkpoint — item 2.
 *
 * The spreadsheet behind 28 consistent "the caller does not have
 * permission" errors needed a real diagnosis, not another blind retry.
 * `describeSheetsError` is the pure piece of that: turning a raw
 * googleapis/gaxios error into "access revoked on a sheet that still
 * exists" (403) vs. "the sheet itself is gone" (404) — two failure modes
 * that need completely different fixes, indistinguishable from the plain
 * error message alone.
 *
 * `getActiveServiceAccountEmail` is exercised for real (it's pure JSON
 * parsing, no network call) with a synthetic GOOGLE_CREDENTIALS_JSON —
 * never a real key.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.GOOGLE_CREDENTIALS_JSON = JSON.stringify({
  client_email: "test-service-account@example-project.iam.gserviceaccount.com",
  private_key: "-----BEGIN PRIVATE KEY-----\\nnotarealkey\\n-----END PRIVATE KEY-----\\n",
});

const { getActiveServiceAccountEmail, describeSheetsError } = await import("../src/lib/sheets.ts");

test("getActiveServiceAccountEmail reads client_email out of GOOGLE_CREDENTIALS_JSON without touching the key", () => {
  assert.equal(getActiveServiceAccountEmail(), "test-service-account@example-project.iam.gserviceaccount.com");
});

test("a 403 PERMISSION_DENIED is described as an access problem, not ok", () => {
  const googleError = {
    code: 403,
    message: "The caller does not have permission",
    response: {
      status: 403,
      data: { error: { status: "PERMISSION_DENIED", errors: [{ reason: "forbidden" }] } },
    },
  };
  const diag = describeSheetsError(googleError, "svc@example.com");
  assert.equal(diag.ok, false);
  assert.equal(diag.httpStatus, 403);
  assert.equal(diag.googleReason, "PERMISSION_DENIED");
  assert.equal(diag.serviceAccountEmail, "svc@example.com");
  assert.equal(diag.message, "The caller does not have permission");
});

test("a 404 is described distinctly from a 403 -- the fix is different (nothing to re-share)", () => {
  const googleError = {
    code: 404,
    message: "Requested entity was not found.",
    response: { status: 404, data: { error: { status: "NOT_FOUND" } } },
  };
  const diag = describeSheetsError(googleError, "svc@example.com");
  assert.equal(diag.httpStatus, 404);
  assert.equal(diag.googleReason, "NOT_FOUND");
  assert.notEqual(diag.googleReason, "PERMISSION_DENIED");
});

test("falls back to errors[].reason when the top-level error.status is absent", () => {
  const googleError = {
    response: { status: 403, data: { error: { errors: [{ reason: "insufficientPermissions" }] } } },
  };
  const diag = describeSheetsError(googleError, "svc@example.com");
  assert.equal(diag.googleReason, "insufficientPermissions");
});

test("a bare Error with no response shape still returns a diagnosis, not a crash", () => {
  const diag = describeSheetsError(new Error("network blip"), "svc@example.com");
  assert.equal(diag.ok, false);
  assert.equal(diag.httpStatus, undefined);
  assert.equal(diag.googleReason, undefined);
  assert.equal(diag.message, "network blip");
});
