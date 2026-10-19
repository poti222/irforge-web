import test from "node:test";
import assert from "node:assert/strict";
const m = await import("../src/lib/superPg.ts");

const col = (name, udt = "text", over = {}) => ({ name, type: udt, udt, nullable: true, hasDefault: false, isPk: false, isIdentity: false, isGenerated: false, ...over });

test("quoteIdent escapes quotes", () => {
  assert.equal(m.quoteIdent('a"b'), '"a""b"');
  assert.equal(m.quoteIdent("users"), '"users"');
});

test("sensitive columns are detected", () => {
  for (const n of ["bot_token", "password_hash", "api_key", "apiKey", "client_secret", "otp_code", "session_id", "salt"]) assert.ok(m.isSensitiveColumn(n), n);
  for (const n of ["email", "name", "created_at", "role", "title"]) assert.ok(!m.isSensitiveColumn(n), n);
});

test("tables are grouped sensibly", () => {
  assert.equal(m.classifyTable("school_classes").id, "schools");
  assert.equal(m.classifyTable("bots").id, "bots");
  assert.equal(m.classifyTable("users").id, "users");
  assert.equal(m.classifyTable("wallet_transactions").id, "money");
  assert.equal(m.classifyTable("tickets").id, "support");
  assert.equal(m.classifyTable("admin_audit_log").id, "infra");
  assert.equal(m.classifyTable("something_else").id, "other");
});

test("search: skips sensitive/bytea columns, escapes LIKE wildcards, empty -> null", () => {
  const cols = [col("email"), col("password_hash"), col("blob", "bytea"), col("n", "int4")];
  const s = m.buildSearchWhere(cols, "50%_x", 1);
  assert.ok(s.sql.includes('"email"::text ILIKE $1'));
  assert.ok(s.sql.includes('"n"::text ILIKE $1'));
  assert.ok(!s.sql.includes("password_hash") && !s.sql.includes("blob"));
  assert.equal(s.params[0], "%50\\%\\_x%");
  assert.equal(m.buildSearchWhere(cols, "   ", 1), null);
});

test("order by: unknown/sensitive sort column is ignored, falls back to PK", () => {
  const cols = [col("id", "int4", { isPk: true }), col("email"), col("password_hash")];
  assert.equal(m.buildOrderBy(cols, "email", "desc"), 'ORDER BY "email" DESC NULLS LAST');
  assert.equal(m.buildOrderBy(cols, "email; drop table x", "asc"), 'ORDER BY "id"');
  assert.equal(m.buildOrderBy(cols, "password_hash", "asc"), 'ORDER BY "id"');
  assert.equal(m.buildOrderBy([col("a")], undefined, undefined), "");
});

test("coerceValue: json stringified, empty string -> null for non-text types", () => {
  assert.equal(m.coerceValue(col("m", "jsonb"), { a: 1 }), '{"a":1}');
  assert.equal(m.coerceValue(col("n", "int4"), ""), null);
  assert.equal(m.coerceValue(col("t", "text"), ""), "");
  assert.equal(m.coerceValue(col("t", "text"), undefined), null);
});

test("single statement guard", () => {
  assert.deepEqual(m.normalizeSingleStatement("select 1;"), { ok: true, sql: "select 1" });
  assert.equal(m.normalizeSingleStatement("select 1; commit; drop table x").ok, false);
  assert.equal(m.normalizeSingleStatement("  ; ").ok, false);
  assert.equal(m.isReadQuery("  WITH a AS (select 1) select * from a"), true);
  assert.equal(m.isReadQuery("update t set a=1"), false);
});
