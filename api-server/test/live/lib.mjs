/**
 * test/live/lib.mjs — کمکی‌هایِ اسکریپت‌هایِ «زنده»: HTTPِ واقعی روی api-serverِ در حالِ اجرا + Postgresِ واقعی.
 * (با `node --test test/*.test.mjs` اجرا نمی‌شوند؛ دستی: `BASE=http://localhost:3111 DATABASE_URL=... node test/live/X.live.mjs`.)
 */
import pg from "pg";
import assert from "node:assert/strict";

export const BASE = process.env.BASE ?? "http://localhost:3111";
export const GATE = process.env.SUPER_GATE_PASSWORD ?? "gatepass";
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

let n = 0;
const run = Math.random().toString(36).slice(2, 8);

export async function call(method, path, { token, body, raw, headers = {}, cookie } = {}) {
  const h = { ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  if (cookie) h.cookie = cookie;
  let payload;
  if (raw !== undefined) payload = raw;
  else if (body !== undefined) { h["content-type"] = "application/json"; payload = JSON.stringify(body); }
  const r = await fetch(BASE + "/api" + path, { method, headers: h, body: payload, redirect: "manual" });
  const buf = Buffer.from(await r.arrayBuffer());
  let json = null;
  try { json = JSON.parse(buf.toString("utf8")); } catch { /* binary */ }
  return { status: r.status, json, buf, headers: r.headers, text: buf.toString("utf8") };
}

export async function newUser(label = "u") {
  const email = `${label}${++n}-${run}@live.test`;
  const r = await call("POST", "/auth/register", { body: { name: label, email, password: "Passw0rd!!x" } });
  assert.equal(r.status, 201, "register " + r.text);
  return { id: r.json.user.id, token: r.json.token, email };
}

export async function newSuper() {
  const u = await newUser("super");
  await pool.query("update users set role='super_admin' where id=$1", [u.id]);
  const r = await call("POST", "/super-gate/unlock", { token: u.token, body: { password: GATE } });
  assert.equal(r.status, 200, "gate " + r.text);
  const sc = r.headers.getSetCookie?.() ?? [r.headers.get("set-cookie")];
  u.cookie = sc.map((c) => c.split(";")[0]).join("; ");
  return u;
}

/** مدیرِ یک مدرسه‌یِ تازه (ثبت‌نام واقعی + POST /schools). */
export async function newSchoolAdmin(name = "مدرسه") {
  const u = await newUser("admin");
  const r = await call("POST", "/schools", { token: u.token, body: { name: `${name} ${run}${++n}` } });
  assert.equal(r.status, 201, "school " + r.text);
  u.schoolId = r.json.id;
  return u;
}

/** عضو با نقش (کدِ معرفِ واقعی از مدیر + onboarding). */
export async function joinSchool(admin, role, extra = {}) {
  const u = await newUser(role);
  const c = await call("POST", `/schools/${admin.schoolId}/invite-codes`, { token: admin.token, body: { role } });
  assert.ok(c.status < 300, "invite " + c.text);
  const ob = await call("POST", "/schools/onboarding", { token: u.token, body: { role, inviteCode: c.json.code, grade: "10", nationalId: "1234567890", birthDate: "2008-01-01", city: "تهران", ...extra } });
  assert.ok(ob.status < 300, "onboard " + ob.text);
  u.schoolId = admin.schoolId;
  u.memberId = ob.json.id;
  return u;
}

let pass = 0;
export function check(name, cond, detail) {
  if (cond) { pass++; console.log("  ok  " + name); }
  else { console.log("  FAIL " + name + (detail !== undefined ? "  -> " + JSON.stringify(detail) : "")); process.exitCode = 1; }
}
export async function done() { await pool.end(); console.log(process.exitCode ? "FAILED" : `ALL ${pass} CHECKS PASSED`); }
