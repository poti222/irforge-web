/** اتصالِ والد با شماره‌یِ دانش‌آموز: حریم، سقف، تأیید/رد، idempotent، انقضا، مرزِ مدرسه. */
import { execFileSync } from "node:child_process";
import { call, newSchoolAdmin, joinSchool, pool, done, check } from "./lib.mjs";
execFileSync("node", ["migrate.mjs"], { env: process.env, stdio: "ignore" });

const A = await newSchoolAdmin("الف"), B = await newSchoolAdmin("ب");
const rnd = () => "0912" + String(Math.floor(1000000 + Math.random() * 8999999));
const setPhone = async (u, local) => { await pool.query("update users set phone=$1 where id=$2", ["+98" + local.slice(1), u.id]); u.phone = local; };
const sA = await joinSchool(A, "student"), sA2 = await joinSchool(A, "student"), sB = await joinSchool(B, "student");
const parent = await joinSchool(A, "parent"), parent2 = await joinSchool(A, "parent"), teacherA = await joinSchool(A, "teacher");
await setPhone(sA, rnd()); await setPhone(sA2, rnd()); await setPhone(sB, rnd());
const submit = (u, phone, sid = A.schoolId) => call("POST", `/schools/${sid}/guardian-requests`, { token: u.token, body: { phone } });
const notifs = async (u) => (await call("GET", "/notifications", { token: u.token })).text;
const strip = (r) => JSON.stringify({ http: r.status, ...r.json, requestId: "X" });
const mine = (u) => call("GET", `/schools/${A.schoolId}/guardian-requests/mine`, { token: u.token });
const incoming = (u) => call("GET", `/schools/${A.schoolId}/guardian-requests/incoming`, { token: u.token });
const nonexistent = rnd();

// ── حریم: هم‌شکلیِ پیداشده/پیدانشده
const rFound = await submit(parent, sA.phone);
const rNone = await submit(parent, nonexistent);
check("found vs unfound phone: byte-identical response (apart from requestId)", rFound.status === 201 && strip(rFound) === strip(rNone), [rFound.text, rNone.text]);
check("neutral message text present", rFound.json.message.includes("اگر این شماره متعلق به یک دانش‌آموز این مدرسه باشد"));
await new Promise((r) => setTimeout(r, 400));
check("notification row created for matched student ONLY (found)", (await notifs(sA)).includes("درخواست اتصال والد"));
check("no notification rows for unrelated students", !(await notifs(sA2)).includes("درخواست اتصال والد") && !(await notifs(sB)).includes("درخواست اتصال والد"));
check("DB: unmatched submission stored with NULL student (counts toward cap)", (await pool.query("select count(*)::int n from school_guardian_requests where parent_user_id=$1 and normalized_phone=$2 and student_member_id is null", [parent.id, "+98" + nonexistent.slice(1)])).rows[0].n === 1);
// ── نرمال‌سازی: ارقامِ فارسی، +98، 0098، بدونِ صفر
for (const [label, fmt] of [["Persian digits", (p) => p.replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[d])], ["+98", (p) => "+98" + p.slice(1)], ["0098", (p) => "0098" + p.slice(1)], ["no leading zero + spaces", (p) => p.slice(1, 4) + " " + p.slice(4)]]) {
  const p2 = parent2; const phone = rnd(); const st = await joinSchool(A, "student"); await setPhone(st, phone);
  const r = await submit(p2, fmt(phone));
  await new Promise((x) => setTimeout(x, 250));
  check(`normalization (${label}) matches the stored E.164 phone → student notified`, r.status === 201 && (await incoming(st)).json.length === 1, [r.text]);
}
check("garbage phone → 400 invalid_phone", (await submit(parent, "abc")).json?.code === "invalid_phone" && (await submit(parent, "0912")).status === 400);
// ── دانش‌آموز می‌بیند: فقط نامِ والد
let inc = await incoming(sA);
check("student sees exactly 1 incoming card with ONLY id, parentName, createdAt", inc.json.length === 1 && Object.keys(inc.json[0]).sort().join() === "createdAt,id,parentName" && inc.json[0].parentName === "parent", inc.text);
// ── مرزِ مدرسه
const rx = await submit(parent, sB.phone);
await new Promise((r) => setTimeout(r, 300));
check("cross-school phone: neutral 201 but NO match/notification for the other school's student", rx.status === 201 && !(await notifs(sB)).includes("درخواست اتصال والد") && (await pool.query("select student_member_id from school_guardian_requests where parent_user_id=$1 and normalized_phone=$2", [parent.id, "+98" + sB.phone.slice(1)])).rows.every((r) => r.student_member_id === null));
check("non-parent roles can't submit (student/teacher 403)", (await submit(sA2, sA.phone)).status === 403 && (await submit(teacherA, sA.phone)).status === 403);
check("parent of another school can't submit on school A (403)", (await submit(await joinSchool(B, "parent"), sA.phone)).status === 403);
// ── تصمیم
const reqId = inc.json[0].id;
const dec = (u, id, decision, sid = A.schoolId) => call("POST", `/schools/${sid}/guardian-requests/${id}/decision`, { token: u.token, body: { decision } });
check("another student of A can't decide on it (404)", (await dec(sA2, reqId, "approve")).status === 404);
check("student of school B can't decide (403 on A path, 404 on B path)", (await dec(sB, reqId, "approve")).status === 403 && (await dec(sB, reqId, "approve", B.schoolId)).status === 404);
check("parent/teacher can't decide (403)", (await dec(parent, reqId, "approve")).status === 403 && (await dec(teacherA, reqId, "approve")).status === 403);
check("bad decision value → 400", (await dec(sA, reqId, "maybe")).status === 400);
const [d1, d2] = await Promise.all([dec(sA, reqId, "approve"), dec(sA, reqId, "approve")]);
check("double/concurrent approve → both 200 approved, exactly ONE guardianship row", d1.status === 200 && d2.status === 200 && d1.json.status === "approved" && [d1.json.idempotent, d2.json.idempotent].sort().join() === "false,true" && (await pool.query("select count(*)::int n from school_guardianships where parent_user_id=$1 and student_member_id=$2", [parent.id, sA.memberId])).rows[0].n === 1, [d1.text, d2.text]);
check("reject after approve → 409 already_decided", (await dec(sA, reqId, "reject")).status === 409);
check("incoming now empty", (await incoming(sA)).json.length === 0);
check("parent got a decision notification", (await notifs(parent)).includes("درخواست اتصال تأیید شد"));
// ── دسترسیِ مبتنی بر پیوند
const kids = await call("GET", "/schools/my-children", { token: parent.token });
check("approved child appears in parent's existing /my-children dashboard", kids.json.some((k) => k.id === sA.memberId), kids.text);
const gb = (u) => call("GET", `/schools/${A.schoolId}/gradebook/child/${sA.memberId}`, { token: u.token });
check("linked parent gets guardianship-scoped gradebook (200); mismatched parent 403", (await gb(parent)).status === 200 && (await gb(parent2)).status === 403, [(await gb(parent)).status, (await gb(parent2)).status]);
// ── ردّ شدن شمرده می‌شود + سقفِ ۳
const ph = rnd(); const st3 = await joinSchool(A, "student"); await setPhone(st3, ph);
const outcomes = [];
for (let i = 0; i < 3; i++) {
  const r = await submit(parent2, ph); outcomes.push(r.status + ":" + r.json.remainingForPhone);
  await new Promise((x) => setTimeout(x, 200));
  const id = (await incoming(st3)).json[0]?.id;
  if (i === 0) await dec(st3, id, "reject"); else if (i === 1) { const m = await mine(parent2); await call("POST", `/schools/${A.schoolId}/guardian-requests/${m.json.requests.find((q) => q.status === "pending").id}/cancel`, { token: parent2.token }); } else await dec(st3, id, "reject");
}
check("3 submissions (reject, cancel, reject) allowed with remaining 2,1,0", outcomes.join() === "201:2,201:1,201:0", outcomes);
const r4 = await submit(parent2, ph);
check("4th request for same phone → 429 guardian_request_limit + contactAdmin (UI: tell the admin)", r4.status === 429 && r4.json.code === "guardian_request_limit" && r4.json.contactAdmin === true && r4.json.scope === "per_phone", r4.text);
check("4th creates no row & no notification", (await pool.query("select count(*)::int n from school_guardian_requests where parent_user_id=$1 and normalized_phone=$2", [parent2.id, "+98" + ph.slice(1)])).rows[0].n === 3 && (await incoming(st3)).json.length === 0);
check("same cap applies to formatted variant of that phone (Persian digits)", (await submit(parent2, ph.replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[d]))).status === 429);
let m2 = await mine(parent2);
check("parent status list shows rejected/cancelled/rejected only (no student info) + limits", m2.json.requests.filter((q) => q.phone === "0912***" + ph.slice(-4)).map((q) => q.status).sort().join() === "cancelled,rejected,rejected" && m2.json.limits.perPhone === 3 && !m2.text.includes(st3.id) && !m2.text.includes(st3.memberId), m2.text);
check("another student's id/ids not leaked in mine for found vs unfound entries", Object.keys(m2.json.requests[0]).sort().join() === "createdAt,decidedAt,id,phone,status");
// ── ضدِ شمارش‌گری: ۱۰ شمارهٔ متفاوت در ۲۴ ساعت
const p3 = await joinSchool(A, "parent"); const statuses = [];
for (let i = 0; i < 11; i++) statuses.push((await submit(p3, rnd())).status);
check("anti-enumeration: 10 distinct phones OK, the 11th → 429 (scope daily_phones)", statuses.slice(0, 10).every((s) => s === 201) && statuses[10] === 429, statuses);
// ── انقضا
const ph4 = rnd(); const st4 = await joinSchool(A, "student"); await setPhone(st4, ph4);
await submit(parent, ph4); await new Promise((x) => setTimeout(x, 200));
check("pending visible before expiry", (await incoming(st4)).json.length === 1);
await pool.query("update school_guardian_requests set created_at = now() - interval '8 days' where normalized_phone=$1", ["+98" + ph4.slice(1)]);
check("after 7 days: not in incoming; approve → 404/409-ish (not linked); parent sees 'expired'", (await incoming(st4)).json.length === 0 && (await mine(parent)).json.requests.some((q) => q.status === "expired") && (await pool.query("select count(*)::int n from school_guardianships where student_member_id=$1", [st4.memberId])).rows[0].n === 0);
// ── تکراریِ در حالِ انتظار + هم‌زمانی
const ph5 = rnd(); const st5 = await joinSchool(A, "student"); await setPhone(st5, ph5); const p5 = await joinSchool(A, "parent");
const rs = await Promise.all([1, 2, 3, 4, 5].map(() => submit(p5, ph5)));
check("5 concurrent submissions of one phone → exactly 1×201 and 4×409 pending", rs.filter((r) => r.status === 201).length === 1 && rs.filter((r) => r.status === 409).length === 4, rs.map((r) => r.status));
const csub = await Promise.all([1, 2, 3, 4].map(() => submit(p3 /*capped*/, rnd())));
check("capped parent: concurrent new phones all 429", csub.every((r) => r.status === 429));
// ── پیوندِ از قبل موجود: بدونِ اعلانِ بی‌مورد، همان پاسخِ هم‌شکل
const before = (await notifs(sA)).length;
const rl = await submit(parent, sA.phone); await new Promise((x) => setTimeout(x, 250));
check("already-linked student: same neutral 201 shape, no new card/notification", rl.status === 201 && strip({ status: rl.status, json: { ...rl.json, remainingForPhone: rNone.json.remainingForPhone } }) === strip(rNone) && (await incoming(sA)).json.length === 0 && (await notifs(sA)).length === before);
// ── مسیرِ دستیِ مدیر هنوز کار می‌کند
const st6 = await joinSchool(A, "student");
const adm = await call("POST", `/schools/${A.schoolId}/guardianships`, { token: A.token, body: { parentUserId: parent2.id, studentMemberId: st6.memberId } });
check("admin manual link still works (fallback path) and is idempotent", adm.status === 201 && (await call("POST", `/schools/${A.schoolId}/guardianships`, { token: A.token, body: { parentUserId: parent2.id, studentMemberId: st6.memberId } })).status === 201 && (await pool.query("select count(*)::int n from school_guardianships where parent_user_id=$1 and student_member_id=$2", [parent2.id, st6.memberId])).rows[0].n === 1, adm.text);
check("admin(A) linking a school-B student → 404 (cross-school closed)", (await call("POST", `/schools/${A.schoolId}/guardianships`, { token: A.token, body: { parentUserId: parent2.id, studentMemberId: sB.memberId } })).status === 404);
await done();
