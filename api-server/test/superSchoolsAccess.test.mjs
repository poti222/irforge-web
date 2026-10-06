/**
 * test/superSchoolsAccess.test.mjs — `/super`: سوپرادمین هر مدرسه را مثلِ مدیرِ همان مدرسه مدیریت می‌کند (بدونِ عضویت)،
 * و APIِ تازه‌یِ /super (فهرستِ غنی‌شده، ساختِ مدرسه، افزودنِ عضو، نمایِ کلی، ردپایِ سراسری).
 *
 * سرتاسر روی Postgres و routeهای واقعی (`routes/schools.ts`، `schoolClasses.ts`، `schoolAnnouncements.ts`،
 * `schoolAuditLog.ts`، `superDashboard.ts`) — احرازِ هویت هم واقعی است (نشستِ هش‌شده در جدولِ sessions)، فقط جدول‌ها
 * از روی تعریفِ drizzle ساخته می‌شوند. فقط با `CARD_TEST_PG_URL`.
 */
process.env.BOT_TOKEN_ENCRYPTION_KEY ??= "ab".repeat(32);
process.env.PUBLIC_SITE_URL ??= "https://irforge.example";

import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";
import express from "express";
import cookieParser from "cookie-parser";

const PG_URL = process.env.CARD_TEST_PG_URL;
const live = { skip: PG_URL ? false : "CARD_TEST_PG_URL تنظیم نشده" };
let pgMod = null;
try { pgMod = await import("pg"); } catch { /* skip */ }
const Pool = pgMod?.default?.Pool ?? pgMod?.Pool;

// DATABASE_URL باید قبل از import شدنِ @workspace/db ست شود (pool همان لحظه ساخته می‌شود).
const schema = `sup_${Math.random().toString(36).slice(2, 10)}`;
let admin = null;
if (PG_URL && Pool) {
  admin = new Pool({ connectionString: PG_URL, max: 2 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const u = new URL(PG_URL);
  u.searchParams.set("options", `-c search_path=${schema}`);
  process.env.DATABASE_URL = u.toString();
} else {
  process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";
}

const dbm = await import("@workspace/db");
const { ddlFor } = await import("./helpers/drizzleDdl.mjs");
const { DDL_ALL } = await import("./helpers/cardPayDdl.mjs");
const { hashSessionToken } = await import("../src/lib/sessionToken.ts");
const { issueSuperGateCookieValue, SUPER_GATE_COOKIE } = await import("../src/middleware/superGate.ts");
const schoolsRouter = (await import("../src/routes/schools.ts")).default;
const classesRouter = (await import("../src/routes/schoolClasses.ts")).default;
const announcementsRouter = (await import("../src/routes/schoolAnnouncements.ts")).default;
const auditRouter = (await import("../src/routes/schoolAuditLog.ts")).default;
const superRouter = (await import("../src/routes/superDashboard.ts")).default;
const { canAccessSchool, SCHOOL_ADMIN_ONLY } = await import("../src/lib/schoolAuth.ts");
const { SCHOOL_MEMBER_ROLES } = dbm;

const TOKENS = { root: "tok_root", adminA: "tok_adminA", studentA: "tok_studentA", plain: "tok_plain" };

async function setup() {
  const pool = dbm.pool;
  await pool.query(ddlFor(
    dbm.usersTable, dbm.sessionsTable, dbm.schoolsTable, dbm.schoolMembersTable, dbm.schoolAdminsTable,
    dbm.schoolClassesTable, dbm.schoolClassMembersTable, dbm.schoolAuditLogTable, dbm.schoolInviteCodesTable,
    dbm.schoolBotTokenPoolTable, dbm.schoolBotsTable, dbm.adminAuditLogTable, dbm.botsTable, dbm.ticketsTable,
    dbm.walletTransactionsTable, dbm.pendingRegistrationsTable, dbm.schoolAnnouncementsTable, dbm.notificationsTable, dbm.schoolSubjectsTable,
  ));
  await pool.query(DDL_ALL);

  const user = (id, name, email, role = "user") =>
    pool.query("INSERT INTO users (id, name, email, role) VALUES ($1,$2,$3,$4)", [id, name, email, role]);
  await user("u_root", "سوپر", "root@example.com", "super_admin");
  await user("u_adminA", "مدیر الف", "admin.a@example.com");
  await user("u_studentA", "دانش‌آموز الف", "stud.a@example.com");
  await user("u_plain", "کاربر ساده", "plain@example.com");
  await user("u_free", "کاربر آزاد", "free@example.com");
  await user("u_other", "عضوِ مدرسه‌یِ ب", "other@example.com");
  for (const [uid, tok] of [["u_root", TOKENS.root], ["u_adminA", TOKENS.adminA], ["u_studentA", TOKENS.studentA], ["u_plain", TOKENS.plain]]) {
    await pool.query("INSERT INTO sessions (token, user_id, expires_at, last_used_at) VALUES ($1,$2, now() + interval '1 day', now())", [hashSessionToken(tok), uid]);
  }
  await pool.query("INSERT INTO schools (id, name, city, created_by_user_id) VALUES ('sch_A','دبیرستان الف','تهران','u_adminA'),('sch_B','دبیرستان ب','شیراز','u_adminA')");
  const member = (id, uid, sid, role) =>
    pool.query("INSERT INTO school_members (id, user_id, school_id, role, profile_complete) VALUES ($1,$2,$3,$4,true)", [id, uid, sid, role]);
  await member("m_adminA", "u_adminA", "sch_A", "admin");
  await member("m_studentA", "u_studentA", "sch_A", "student");
  await member("m_other", "u_other", "sch_B", "teacher");
  await pool.query("INSERT INTO school_classes (id, school_id, name, academic_year) VALUES ('c_A1','sch_A','پایه‌یِ دهم','1405')");
}

function appFor() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api", schoolsRouter, classesRouter, announcementsRouter, auditRouter, superRouter);
  return app;
}

async function withServer(fn) {
  const server = http.createServer(appFor());
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${server.address().port}/api`;
  const gate = `${SUPER_GATE_COOKIE}=${issueSuperGateCookieValue().value}`;
  const call = async (method, path, { as = "root", body, gated = true } = {}) => {
    const headers = { "content-type": "application/json" };
    if (as) headers.authorization = `Bearer ${TOKENS[as]}`;
    if (gated) headers.cookie = gate;
    const res = await fetch(`${origin}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null;
    try { json = await res.json(); } catch { /* 204 */ }
    return { status: res.status, json };
  };
  try { await fn(call); } finally { await new Promise((r) => server.close(r)); }
}

let ready = null;
const once = () => (ready ??= setup());

test("canAccessSchool: سوپرادمین فقط روی endpointهایِ دارایِ «admin» رد می‌شود؛ بقیه‌ی کاربران دقیقاً مثلِ قبل", live, async () => {
  await once();
  assert.equal((await canAccessSchool("u_root", "sch_A", SCHOOL_ADMIN_ONLY)).ok, true, "سوپرادمین بدونِ عضویت");
  assert.equal((await canAccessSchool("u_root", "sch_B", SCHOOL_MEMBER_ROLES)).ok, true);
  assert.equal((await canAccessSchool("u_root", "sch_A", ["student"])).ok, false, "endpointِ ویژه‌یِ دانش‌آموز بدونِ admin: بسته می‌ماند");
  assert.equal((await canAccessSchool("u_root", "sch_A", ["counselor"])).ok, false, "گفتگویِ مشاوره (بدونِ admin) هنوز بسته است");
  assert.equal((await canAccessSchool("u_adminA", "sch_A", SCHOOL_ADMIN_ONLY)).ok, true);
  assert.equal((await canAccessSchool("u_adminA", "sch_B", SCHOOL_ADMIN_ONLY)).ok, false, "مدیرِ مدرسه‌یِ الف مدرسه‌یِ ب را نمی‌بیند");
  assert.equal((await canAccessSchool("u_plain", "sch_A", SCHOOL_ADMIN_ONLY)).ok, false);
  assert.equal((await canAccessSchool("u_studentA", "sch_A", SCHOOL_ADMIN_ONLY)).ok, false);
});

test("/schools/me و /schools/my-schools: هویتِ «مدیرِ همه‌یِ مدارس» برایِ سوپرادمین؛ بقیه بدونِ تغییر", live, async () => {
  await once();
  await withServer(async (call) => {
    const me = await call("GET", "/schools/me", { gated: false });
    assert.equal(me.status, 200);
    assert.deepEqual([me.json.role, me.json.profileComplete, me.json.isSuperAdmin, me.json.schoolId, me.json.school], ["admin", true, true, null, null]);
    assert.equal((await dbm.pool.query("SELECT count(*)::int n FROM school_members WHERE user_id='u_root'")).rows[0].n, 0, "هیچ ردیفِ عضویتی ساخته نمی‌شود");

    const mine = await call("GET", "/schools/my-schools", { gated: false });
    assert.deepEqual(mine.json.map((s) => s.id).sort(), ["sch_A", "sch_B"], "همه‌یِ مدارس");

    const adminMe = await call("GET", "/schools/me", { as: "adminA", gated: false });
    assert.deepEqual([adminMe.json.role, adminMe.json.schoolId, adminMe.json.isSuperAdmin], ["admin", "sch_A", undefined]);
    assert.deepEqual((await call("GET", "/schools/my-schools", { as: "adminA", gated: false })).json.map((s) => s.id), ["sch_A"]);
    assert.equal((await call("GET", "/schools/me", { as: "plain", gated: false })).json, null, "کاربرِ بی‌عضویت هنوز null می‌گیرد");
    assert.deepEqual((await call("GET", "/schools/my-schools", { as: "plain", gated: false })).json, []);
  });
});

test("مدیریتِ هر مدرسه از طریقِ همان routeهایِ /schools/:id/...: اعضا، نقش، کلاس‌ها، اعلامیه، کدِ معرف، ردپا", live, async () => {
  await once();
  await withServer(async (call) => {
    const members = await call("GET", "/schools/sch_A/members", { gated: false });
    assert.equal(members.status, 200);
    assert.deepEqual(members.json.map((m) => m.role).sort(), ["admin", "student"]);
    assert.equal((await call("GET", "/schools/sch_B/members", { gated: false })).status, 200, "مدرسه‌یِ ب هم");

    const roleChange = await call("PATCH", "/schools/sch_A/members/m_studentA", { body: { role: "teacher" }, gated: false });
    assert.equal(roleChange.status, 200);
    assert.equal(roleChange.json.role, "teacher");
    const classes = await call("GET", "/schools/sch_A/classes", { gated: false });
    assert.equal(classes.status, 200);
    assert.equal(classes.json.length, 1);
    const newClass = await call("POST", "/schools/sch_A/classes", { body: { name: "کلاسِ سوپر", academicYear: "1405" }, gated: false });
    assert.equal(newClass.status, 201, JSON.stringify(newClass.json));
    // اعلامیه: سوپرادمینِ بدونِ عضویت هم می‌تواند پخش کند (requester = null)
    const ann = await call("POST", "/schools/sch_A/announcements", { body: { kind: "broadcast", title: "اطلاعیه از /super", body: "سلام" }, gated: false });
    assert.equal(ann.status, 201, JSON.stringify(ann.json));
    const code = await call("POST", "/schools/sch_A/invite-codes", { body: { role: "teacher" }, gated: false });
    assert.equal(code.status, 201, JSON.stringify(code.json));
    // مدیر اضافه
    const grant = await call("POST", "/schools/sch_B/admins", { body: { userId: "u_free" }, gated: false });
    assert.ok([200, 201].includes(grant.status), JSON.stringify(grant.json));
    // ردپایِ مدرسه: کارِ سوپرادمین با شناسه‌ی خودش ثبت شده
    const audit = await call("GET", "/schools/sch_A/audit-log", { gated: false });
    assert.equal(audit.status, 200);
    assert.ok(audit.json.some((e) => e.action === "member.role_changed"), "تغییرِ نقش در ردپا");
    assert.ok(audit.json.every((e) => !e.actorUserId || e.actorUserId === "u_root" || e.actorUserId === "u_adminA"));

    // مرزها: مدیرِ الف مدرسه‌یِ ب را نمی‌بیند؛ کاربرِ ساده هیچ‌کدام
    assert.equal((await call("GET", "/schools/sch_B/members", { as: "adminA", gated: false })).status, 403);
    assert.equal((await call("GET", "/schools/sch_A/members", { as: "plain", gated: false })).status, 403);
    assert.equal((await call("PATCH", "/schools/sch_A/members/m_adminA", { as: "studentA", body: { role: "student" }, gated: false })).status, 403);
  });
});

test("ساختنِ مدرسه توسطِ سوپرادمین: عضویتِ خودش جابه‌جا نمی‌شود؛ مدیرِ عادی همان رفتارِ قبلی (عضوِ admin می‌شود)", live, async () => {
  await once();
  await withServer(async (call) => {
    const r = await call("POST", "/schools", { body: { name: "مدرسه‌یِ ساخته‌شده با روتِ عمومی" }, gated: false });
    assert.equal(r.status, 201);
    assert.equal((await dbm.pool.query("SELECT count(*)::int n FROM school_members WHERE user_id='u_root'")).rows[0].n, 0);
    assert.ok((await call("GET", "/schools/my-schools", { gated: false })).json.some((s) => s.id === r.json.id), "در سوییچرِ او هست");
    // کاربرِ بی‌عضویت که مدرسه می‌سازد → عضوِ admin همان مدرسه (رفتارِ قدیمی)
    const p = await call("POST", "/schools", { as: "plain", body: { name: "مدرسه‌یِ کاربر" }, gated: false });
    assert.equal(p.status, 201);
    const row = (await dbm.pool.query("SELECT school_id, role FROM school_members WHERE user_id='u_plain'")).rows[0];
    assert.deepEqual([row.school_id, row.role], [p.json.id, "admin"]);
  });
});

test("GET /super/schools: آمارِ هر مدرسه (نقش‌ها، کلاس‌ها، مدیران)؛ بدونِ گیت/نقش ۴۰۱/۴۰۳", live, async () => {
  await once();
  await withServer(async (call) => {
    const r = await call("GET", "/super/schools");
    assert.equal(r.status, 200);
    const A = r.json.find((s) => s.id === "sch_A");
    assert.equal(A.classCount >= 1, true);
    assert.equal(A.roles.admin, 1);
    assert.ok(A.memberCount >= 2);
    assert.deepEqual(A.admins.map((a) => a.userId), ["u_adminA"]);
    assert.equal(A.bot, null);
    assert.equal(typeof A.createdAt, "string");

    assert.equal((await call("GET", "/super/schools", { as: null })).status, 401);
    assert.equal((await call("GET", "/super/schools", { as: "adminA" })).status, 403, "مدیرِ مدرسه سوپرادمین نیست");
    // سوپرادمینِ واقعی ولی بدونِ رمزِ دومِ /super
    const locked = await call("GET", "/super/schools", { gated: false });
    assert.deepEqual([locked.status, locked.json.code], [401, "super_gate_locked"]);
  });
});

test("POST /super/schools: ساخت با مدیرِ اختیاری (کاربرِ بی‌مدرسه/عضوِ مدرسه‌یِ دیگر)، خطاها", live, async () => {
  await once();
  await withServer(async (call) => {
    assert.equal((await call("POST", "/super/schools", { body: { name: "  " } })).json.code, "name_required");
    assert.equal((await call("POST", "/super/schools", { body: { name: "x", adminEmail: "nobody@example.com" } })).json.code, "admin_user_not_found");
    assert.equal((await dbm.pool.query("SELECT count(*)::int n FROM schools WHERE name='x'")).rows[0].n, 0, "با مدیرِ نامعتبر چیزی ساخته نمی‌شود");

    const plainSchool = await call("POST", "/super/schools", { body: { name: "مدرسه‌یِ تازه", city: "اهواز", isTestSchool: true } });
    assert.equal(plainSchool.status, 201);
    assert.equal(plainSchool.json.isTestSchool, true);
    assert.equal(plainSchool.json.adminAssigned, null);

    const withFree = await call("POST", "/super/schools", { body: { name: "مدرسه با مدیر", adminEmail: "FREE@example.com" } });   // email case-insensitive
    assert.equal(withFree.status, 201, JSON.stringify(withFree.json));
    assert.equal(withFree.json.adminAssigned, "member_created");
    const m = (await dbm.pool.query("SELECT school_id, role FROM school_members WHERE user_id='u_free'")).rows[0];
    assert.deepEqual([m.school_id, m.role], [withFree.json.id, "admin"]);

    const withOther = await call("POST", "/super/schools", { body: { name: "مدرسه با مدیرِ عضوِ جایِ دیگر", adminUserId: "u_other" } });
    assert.equal(withOther.json.adminAssigned, "extra_admin", "عضویتِ اصلیِ او دست نمی‌خورد؛ مدیرِ اضافه می‌شود");
    assert.equal((await dbm.pool.query("SELECT school_id FROM school_members WHERE user_id='u_other'")).rows[0].school_id, "sch_B");
    assert.equal((await dbm.pool.query("SELECT count(*)::int n FROM school_admins WHERE user_id='u_other' AND school_id=$1", [withOther.json.id])).rows[0].n, 1);
    assert.ok((await dbm.pool.query("SELECT 1 FROM school_audit_log WHERE school_id=$1 AND action='school.created_by_super'", [withFree.json.id])).rowCount === 1);
  });
});

test("PATCH /super/schools/:id و POST /super/schools/:id/members", live, async () => {
  await once();
  await withServer(async (call) => {
    const p = await call("PATCH", "/super/schools/sch_A", { body: { city: "کرج", address: "خیابان ۱", isTestSchool: true } });
    assert.equal(p.status, 200);
    assert.deepEqual([p.json.city, p.json.address, p.json.isTestSchool], ["کرج", "خیابان ۱", true]);
    assert.equal((await call("PATCH", "/super/schools/sch_A", { body: { name: "" } })).json.code, "name_required");
    assert.equal((await call("PATCH", "/super/schools/nope", { body: { city: "x" } })).status, 404);
    assert.equal((await call("PATCH", "/super/schools/sch_A", { body: {} })).status, 400);

    // افزودنِ کاربرِ بی‌عضویت
    await dbm.pool.query("INSERT INTO users (id, name, email) VALUES ('u_new','کاربرِ تازه','new@example.com')");
    const add = await call("POST", "/super/schools/sch_A/members", { body: { email: "new@example.com", role: "parent" } });
    assert.equal(add.status, 201, JSON.stringify(add.json));
    assert.equal(add.json.result, "created");
    const row = (await dbm.pool.query("SELECT school_id, role, profile_complete FROM school_members WHERE user_id='u_new'")).rows[0];
    assert.deepEqual([row.school_id, row.role, row.profile_complete], ["sch_A", "parent", false], "ردیف ساخته شد؛ پروفایل را خودِ کاربر کامل می‌کند");
    // همان کاربر با نقشِ دیگر در همان مدرسه: به‌روزرسانی
    const upd = await call("POST", "/super/schools/sch_A/members", { body: { userId: "u_new", role: "student" } });
    assert.deepEqual([upd.status, upd.json.result], [200, "updated"]);
    // نقشِ نامعتبر / کاربرِ ناموجود / مدرسه‌یِ ناموجود
    assert.equal((await call("POST", "/super/schools/sch_A/members", { body: { email: "new@example.com", role: "king" } })).json.code, "invalid_role");
    assert.equal((await call("POST", "/super/schools/sch_A/members", { body: { email: "ghost@example.com", role: "student" } })).json.code, "user_not_found");
    assert.equal((await call("POST", "/super/schools/nope/members", { body: { email: "new@example.com", role: "student" } })).status, 404);
    // عضوِ مدرسه‌یِ دیگر: بدونِ move ۴۰۹، با move منتقل می‌شود
    const conflict = await call("POST", "/super/schools/sch_A/members", { body: { userId: "u_other", role: "teacher" } });
    assert.deepEqual([conflict.status, conflict.json.code, conflict.json.currentSchool?.id], [409, "already_member_elsewhere", "sch_B"]);
    assert.equal((await dbm.pool.query("SELECT school_id FROM school_members WHERE user_id='u_other'")).rows[0].school_id, "sch_B", "جابه‌جا نشد");
    const moved = await call("POST", "/super/schools/sch_A/members", { body: { userId: "u_other", role: "teacher", move: true } });
    assert.deepEqual([moved.status, moved.json.result], [200, "moved"]);
    assert.equal((await dbm.pool.query("SELECT school_id FROM school_members WHERE user_id='u_other'")).rows[0].school_id, "sch_A");
    // ردپا
    const log = (await dbm.pool.query("SELECT action FROM school_audit_log WHERE school_id='sch_A' ORDER BY created_at")).rows.map((r) => r.action);
    assert.ok(log.includes("member.added_by_super") && log.includes("member.moved_by_super") && log.includes("school.updated_by_super"), log.join(","));
  });
});

test("GET /super/overview: شمارش‌هایِ واقعی و «نیازمندِ توجه»", live, async () => {
  await once();
  await dbm.pool.query("INSERT INTO wallet_transactions (id, user_id, type, amount, status) VALUES ('wt1','u_plain','deposit_card',1000000,'pending'),('wt2','u_plain','deposit_card',1,'approved')");
  await dbm.pool.query("INSERT INTO tickets (id, user_id, subject, status) VALUES ('t1','u_plain','x','open'),('t2','u_plain','y','closed')");
  await withServer(async (call) => {
    const r = await call("GET", "/super/overview");
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.users.total, 7, "۶ کاربرِ اولیه + کاربرِ تازه‌ی تستِ اعضا");
    assert.equal(r.json.users.byRole.super_admin, 1);
    assert.ok(r.json.schools.total >= 2 && r.json.schools.members >= 3);
    assert.equal(r.json.attention.pendingWalletReceipts, 1);
    assert.equal(r.json.attention.openTickets, 1);
    assert.equal(r.json.attention.cardPaymentsAwaitingReview, 0);
    assert.equal(typeof r.json.attention.silentPaymentChannels, "number");
    assert.equal((await call("GET", "/super/overview", { as: "plain" })).status, 403);
  });
});

test("GET /super/audit: ردپایِ ادمین و مدارس، فیلتر و صفحه‌بندی", live, async () => {
  await once();
  await dbm.pool.query(`INSERT INTO admin_audit_log (id, actor_user_id, action, target_user_id, reason, metadata) VALUES
    ('a1','u_root','role_changed','u_plain','تست','{"from":"user"}'), ('a2','u_root','password_set','u_free',NULL,NULL), ('a3','u_root','role_changed','u_free',NULL,NULL)`);
  await withServer(async (call) => {
    const all = await call("GET", "/super/audit");
    assert.equal(all.status, 200);
    assert.equal(all.json.total, 3);
    assert.deepEqual(all.json.actions.sort(), ["password_set", "role_changed"]);
    assert.equal(all.json.items[0].actor, "سوپر");
    const f = await call("GET", "/super/audit?action=role_changed&limit=1&offset=1");
    assert.deepEqual([f.json.total, f.json.items.length], [2, 1]);
    const q = await call("GET", "/super/audit?q=" + encodeURIComponent("تست"));
    assert.deepEqual(q.json.items.map((i) => i.id), ["a1"]);
    assert.equal(q.json.items[0].target, "کاربر ساده");
    const school = await call("GET", "/super/audit?source=school");
    assert.equal(school.status, 200);
    assert.ok(school.json.total > 0 && school.json.items.every((i) => i.schoolName), "نامِ مدرسه همراه است");
    assert.equal((await call("GET", "/super/audit", { as: "adminA" })).status, 403);
  });
});

test("پاک‌سازی", live, async () => {
  await dbm.pool.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
});
