/**
 * test/profile.test.mjs
 *
 * checkProfile() is the single rule shared by the purchase gate
 * (requireCompleteProfile) and the mandatory identity-completion gate —
 * see the header comment in src/lib/profile.ts for why these must never
 * diverge. These tests cover the superset behavior added for identity
 * completion (gender, platformUsername, password/OAuth exemption)
 * alongside the pre-existing purchase-gate fields, since a regression in
 * either would silently corrupt users.profile_complete for the other.
 */
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";

import { test } from "node:test";
import assert from "node:assert/strict";

const { checkProfile } = await import("../src/lib/profile.ts");

const COMPLETE_USER = {
  name: "Ali Rezaei",
  email: "ali@example.com",
  phone: "+989120000000",
  phoneVerified: true,
  telegramId: "123456",
  telegramUsername: "alirezaei",
  gender: "male",
  platformUsername: "ali_r",
  passwordHash: "hashed",
  oauthProvider: null,
};

test("checkProfile: a fully-filled non-OAuth user is complete", () => {
  const result = checkProfile(COMPLETE_USER);
  assert.equal(result.complete, true);
  assert.deepEqual(result.missing, []);
});

test("checkProfile: missing gender is reported and blocks completion", () => {
  const result = checkProfile({ ...COMPLETE_USER, gender: null });
  assert.equal(result.complete, false);
  assert.ok(result.missing.includes("gender"));
});

test("checkProfile: missing platformUsername is reported and blocks completion", () => {
  const result = checkProfile({ ...COMPLETE_USER, platformUsername: null });
  assert.equal(result.complete, false);
  assert.ok(result.missing.includes("platformUsername"));
});

test("checkProfile: a non-OAuth user with no passwordHash is missing password", () => {
  const result = checkProfile({ ...COMPLETE_USER, passwordHash: null, oauthProvider: null });
  assert.equal(result.complete, false);
  assert.ok(result.missing.includes("password"));
});

test("checkProfile: an OAuth user is exempt from the password requirement even with no real passwordHash set", () => {
  // In practice OAuth accounts always get a random passwordHash (see the
  // google/github callbacks), but the exemption must hold regardless —
  // oauthProvider is what actually proves the user never typed a password.
  const result = checkProfile({ ...COMPLETE_USER, passwordHash: null, oauthProvider: "google" });
  assert.equal(result.complete, true);
  assert.ok(!result.missing.includes("password"));
});

test("checkProfile: telegramUsername missing is the sole self-service case (onlyUsernameMissing)", () => {
  const result = checkProfile({ ...COMPLETE_USER, telegramUsername: null });
  assert.equal(result.complete, false);
  assert.deepEqual(result.missing, ["telegramUsername"]);
  assert.equal(result.onlyUsernameMissing, true);
});

test("checkProfile: telegramUsername missing alongside another gap is not the self-service case", () => {
  const result = checkProfile({ ...COMPLETE_USER, telegramUsername: null, gender: null });
  assert.equal(result.onlyUsernameMissing, false);
});

test("checkProfile: pre-existing purchase-gate fields still block completion on their own (name split, phoneVerified, telegramId)", () => {
  assert.ok(!checkProfile({ ...COMPLETE_USER, name: "Ali" }).complete, "single-word name is incomplete");
  assert.ok(
    !checkProfile({ ...COMPLETE_USER, phone: "+98912", phoneVerified: false }).complete,
    "unverified phone is incomplete",
  );
  assert.ok(!checkProfile({ ...COMPLETE_USER, telegramId: null }).complete, "no telegramId is incomplete");
});
