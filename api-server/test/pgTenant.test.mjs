/**
 * test/pgTenant.test.mjs — باتِ «بدونِ شیت» (تننتِ pg_…).
 *
 * قرارداد: برای تننتِ pg_ هیچ مسیری نباید به Google Sheets سقوط کند. این تست‌ها نیازی به
 * Postgres یا Google ندارند — اگر کد به شیت دست بزند، چون هیچ credential ای نیست خطا می‌دهد
 * و تست رد می‌شود.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.BOT_TOKEN_ENCRYPTION_KEY ??= "d".repeat(64);
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";
delete process.env.GOOGLE_CREDENTIALS_JSON;
delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

const { newPgTenantId, isPgTenant, PG_TENANT_PREFIX } = await import("../src/lib/pgTenant.ts");
const cfg = await import("../src/lib/botConfig.ts");

test("newPgTenantId: prefix + botId بدونِ خط‌تیره، و شبیهِ sheetId معتبر (۲۰ تا ۶۰ کاراکتر [A-Za-z0-9_-])", () => {
  const id = newPgTenantId("123e4567-e89b-12d3-a456-426614174000");
  assert.equal(id, "pg_123e4567e89b12d3a456426614174000");
  assert.ok(id.startsWith(PG_TENANT_PREFIX));
  assert.match(id, /^[A-Za-z0-9_-]{20,60}$/);
});

test("isPgTenant: فقط شناسه‌های pg_ را می‌شناسد", () => {
  assert.equal(isPgTenant("pg_abc"), true);
  assert.equal(isPgTenant("1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789"), false);
  assert.equal(isPgTenant(null), false);
  assert.equal(isPgTenant(undefined), false);
  assert.equal(isPgTenant(""), false);
});

test("isEntityOnPostgres: تننتِ pg_ بدونِ هیچ پرچم/دیتابیسی همیشه true است", async () => {
  const id = newPgTenantId("11111111-1111-1111-1111-111111111111");
  for (const e of ["users", "bot_settings", "custom_commands", "some_unknown_entity"]) {
    assert.equal(await cfg.isEntityOnPostgres(e, id), true, e);
  }
});

test("listEntity/getEntity: تبِ ناشناخته برای تننتِ pg_ خالی برمی‌گردد و به شیت نمی‌رود", async () => {
  const id = newPgTenantId("22222222-2222-2222-2222-222222222222");
  assert.deepEqual(await cfg.listEntity(id, "not_a_registered_tab"), []);
  assert.equal(await cfg.getEntity(id, "not_a_registered_tab", "k"), null);
});

test("putEntity/putEntities/removeEntity: نوشتن روی تبِ ناشناخته برای تننتِ pg_ ۴۰۹ می‌دهد، نه نوشتن روی شیت", async () => {
  const id = newPgTenantId("33333333-3333-3333-3333-333333333333");
  const expect409 = (p) => assert.rejects(p, (e) => e?.status === 409 && e?.code === "entity_not_on_postgres");
  await expect409(cfg.putEntity(id, "not_a_registered_tab", "k", { a: 1 }));
  await expect409(cfg.putEntities(id, "not_a_registered_tab", [{ key: "k", value: 1 }]));
  await expect409(cfg.removeEntity(id, "not_a_registered_tab", "k"));
});

test("listUsersLight: تننتِ pg_ با users روی Postgres است (نه شیت) — بدونِ دیتابیسِ زنده فقط نباید به شیت برود", async () => {
  const id = newPgTenantId("44444444-4444-4444-4444-444444444444");
  await assert.rejects(cfg.listUsersLight(id), (e) => !/Google Sheets not configured/i.test(String(e?.message)));
});
