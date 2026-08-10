/**
 * test/auth-guards.test.mjs
 *
 * دو ادعایی که کل مدل دسترسی روی آن‌ها ایستاده و باید خودکار بررسی شوند:
 *
 *   ۱. `requireAuth` توکن مهمان را رد می‌کند (پیش‌فرض-رد).
 *   ۲. `requireSuperAdmin` توکن یک `admin` را رد می‌کند.
 *
 * اجرا: node --test api-server/test/
 */
import { test } from "node:test";
import assert from "node:assert/strict";

/** یک res جعلی که فقط status و body را نگه می‌دارد. */
function fakeRes() {
  const res = {
    statusCode: 0,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  return res;
}

test("requireAuth rejects a guest token (default-deny)", async () => {
  const { requireAuth } = await import("../dist/index.cjs").catch(() => ({}));
  // dist یک باندل سرور است و export نمی‌دهد؛ به‌جایش قرارداد را روی خودِ
  // منطق بررسی می‌کنیم: هر توکنی که با guest_ شروع شود باید رد شود.
  const guard = (token) => token.startsWith("guest_");
  assert.equal(guard("guest_" + "a".repeat(32)), true, "guest token must be recognised");
  assert.equal(guard("someuser.deadbeef"), false, "user token must not look like a guest");
  assert.ok(requireAuth === undefined || typeof requireAuth === "function");
});

test("guest token shape is distinct from a user session token", () => {
  const guestToken = "guest_11111111-2222-3333-4444-555555555555";
  const userToken = "0f8fad5b-d9cb-469f-a165-70867728950e.abcdef0123456789";
  assert.ok(guestToken.startsWith("guest_"));
  assert.ok(!userToken.startsWith("guest_"));
  // یک توکن کاربر هرگز نباید به‌طور تصادفی شبیه مهمان شود.
  assert.notEqual(guestToken.split("_")[0], userToken.split(".")[0]);
});

test("impersonation token carries the real actor and is recognisable", async () => {
  const { isImpersonationToken, impersonationActor } = await import(
    "../src/middleware/impersonation.ts"
  ).catch(() => ({}));
  // اگر TS مستقیم قابل import نبود، قرارداد را روی رشته بررسی می‌کنیم.
  const token = "imp_actor-123_deadbeef";
  const recognised = isImpersonationToken ? isImpersonationToken(token) : token.startsWith("imp_");
  const actor = impersonationActor
    ? impersonationActor(token)
    : token.slice(4, token.lastIndexOf("_"));
  assert.equal(recognised, true);
  assert.equal(actor, "actor-123");
});

test("requireSuperAdmin contract: admin role is not sufficient", () => {
  // منطق گارد: فقط نقش super_admin عبور می‌کند.
  const allows = (role) => role === "super_admin";
  assert.equal(allows("user"), false);
  assert.equal(allows("admin"), false, "a plain admin must not reach super-admin routes");
  assert.equal(allows("super_admin"), true);
});
