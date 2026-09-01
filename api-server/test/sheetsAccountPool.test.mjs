/**
 * test/sheetsAccountPool.test.mjs
 * IRFORGE_POSTGRES_FULL_MIGRATION_PROMPT, pg-migration checkpoint — item 1.
 *
 * See irforge-app's tests/test_sheets_account_pool.py for the full
 * writeup of the actual architecture problem (one shared Google service
 * account caps the whole platform at 60 Sheets reads/minute, not the
 * 300/minute a project would otherwise allow) and the fix (a pool of
 * accounts, one tenant spreadsheet pinned to exactly one account via a
 * deterministic hash of its sheet ID). That Python file also shells out to
 * THIS repo's real TypeScript implementation to prove the two languages
 * agree on every sheet ID they're given -- this file only needs to prove
 * this implementation's own behavior is correct in isolation.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.GOOGLE_CREDENTIALS_JSON = JSON.stringify({
  client_email: "default@fake-project.iam.gserviceaccount.com",
  private_key: "-----BEGIN PRIVATE KEY-----\\nfakedefault\\n-----END PRIVATE KEY-----\\n",
});

const { accountIndexForSheet, getSheetsClientForAccount, getServiceAccountEmailForSheet } = await import(
  "../src/lib/sheets.ts"
);

const FAKE_POOL = [
  { client_email: "acct0@fake-project.iam.gserviceaccount.com", private_key: "-----BEGIN PRIVATE KEY-----\\nfake0\\n-----END PRIVATE KEY-----\\n" },
  { client_email: "acct1@fake-project.iam.gserviceaccount.com", private_key: "-----BEGIN PRIVATE KEY-----\\nfake1\\n-----END PRIVATE KEY-----\\n" },
  { client_email: "acct2@fake-project.iam.gserviceaccount.com", private_key: "-----BEGIN PRIVATE KEY-----\\nfake2\\n-----END PRIVATE KEY-----\\n" },
];

test("a pool of size 1 always returns index 0, for any sheet id", () => {
  assert.equal(accountIndexForSheet("any-sheet-id", 1), 0);
  assert.equal(accountIndexForSheet("a-totally-different-one", 1), 0);
});

test("the index is deterministic for the same sheet id", () => {
  assert.equal(accountIndexForSheet("sheet-abc", 5), accountIndexForSheet("sheet-abc", 5));
});

test("the index is always within [0, poolSize)", () => {
  for (let i = 0; i < 200; i++) {
    const idx = accountIndexForSheet(`sheet-${i}`, 7);
    assert.ok(idx >= 0 && idx < 7);
  }
});

test("zero or negative pool size is rejected", () => {
  assert.throws(() => accountIndexForSheet("x", 0));
  assert.throws(() => accountIndexForSheet("x", -1));
});

test("getSheetsClientForAccount caches per index and out-of-range indices throw", () => {
  process.env.GOOGLE_CREDENTIALS_JSON_POOL = JSON.stringify(FAKE_POOL);
  try {
    const a = getSheetsClientForAccount(1);
    const b = getSheetsClientForAccount(1);
    assert.equal(a, b);
    const c = getSheetsClientForAccount(2);
    assert.notEqual(a, c);
    assert.throws(() => getSheetsClientForAccount(99));
  } finally {
    delete process.env.GOOGLE_CREDENTIALS_JSON_POOL;
  }
});

test("getServiceAccountEmailForSheet resolves to the hashed account's email", () => {
  process.env.GOOGLE_CREDENTIALS_JSON_POOL = JSON.stringify(FAKE_POOL);
  try {
    const sheetId = "some-real-looking-spreadsheet-id";
    const expectedIndex = accountIndexForSheet(sheetId, FAKE_POOL.length);
    assert.equal(getServiceAccountEmailForSheet(sheetId), FAKE_POOL[expectedIndex].client_email);
  } finally {
    delete process.env.GOOGLE_CREDENTIALS_JSON_POOL;
  }
});

test("malformed GOOGLE_CREDENTIALS_JSON_POOL raises a clear error", () => {
  process.env.GOOGLE_CREDENTIALS_JSON_POOL = "not json";
  try {
    assert.throws(() => accountIndexForSheet("x", 2) && getServiceAccountEmailForSheet("x"), /valid JSON/);
  } finally {
    delete process.env.GOOGLE_CREDENTIALS_JSON_POOL;
  }
});

test("a pool entry missing a required field raises a clear error naming the index", () => {
  process.env.GOOGLE_CREDENTIALS_JSON_POOL = JSON.stringify([FAKE_POOL[0], { client_email: "only-email@example.com" }]);
  try {
    assert.throws(() => getServiceAccountEmailForSheet("x"), /\[1\]/);
  } finally {
    delete process.env.GOOGLE_CREDENTIALS_JSON_POOL;
  }
});
