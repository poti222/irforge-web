/** درس‌ها به‌تفکیکِ کلاس: پیش‌فرض همه‌ی کلاس‌ها؛ با انتخاب، دانش‌آموز/معلمِ کلاس‌هایِ دیگر درس را (و جلسه/آیتم‌هایش را) نمی‌بینند. */
import { execFileSync } from "node:child_process";
import { call, newSchoolAdmin, joinSchool, pool, done, check, newSuper } from "./lib.mjs";
execFileSync("node", ["migrate.mjs"], { env: process.env, stdio: "ignore" });
execFileSync("node", ["migrate.mjs"], { env: process.env, stdio: "ignore" }); // idempotent re-run

const A = await newSchoolAdmin("الف"), B = await newSchoolAdmin("ب");
const mk = async (adm, name) => (await call("POST", `/schools/${adm.schoolId}/classes`, { token: adm.token, body: { name, grade: "10", academicYear: "1404-1405" } })).json;
const c1 = await mk(A, "10A"), c2 = await mk(A, "10B"), c3 = await mk(A, "10C"), cB = await mk(B, "X");
const add = (u, cid, role) => call("POST", `/schools/${A.schoolId}/classes/${cid}/members`, { token: A.token, body: { schoolMemberId: u.memberId, roleInClass: role } });
const s1 = await joinSchool(A, "student"), s2 = await joinSchool(A, "student"), sNo = await joinSchool(A, "student");
const t1 = await joinSchool(A, "teacher"), t2 = await joinSchool(A, "teacher"), t3 = await joinSchool(A, "teacher");
const par = await joinSchool(A, "parent"), dep = await joinSchool(A, "deputy");
await add(s1, c1.id, "student"); await add(s2, c2.id, "student"); await add(t1, c1.id, "teacher"); await add(t2, c2.id, "teacher"); await add(t3, c2.id, "teacher");
const list = (u, sid = A.schoolId) => call("GET", `/schools/${sid}/subjects`, { token: u.token });
const names = (r) => (r.json ?? []).map((s) => s.name);
const adminAll = await list(A);
const math = adminAll.json.find((s) => s.name === "ریاضی"), phys = adminAll.json.find((s) => s.name === "فیزیک");
const les = (await call("POST", `/schools/${A.schoolId}/content-lessons`, { token: A.token, body: { subject: "ریاضی", title: "جلسه ریاضی" } })).json;
const item = (await call("POST", `/schools/content`, { token: A.token, body: { schoolId: A.schoolId, type: "note", title: "آیتم ریاضی", body: "x", lessonId: les.id } })).json;
const lessonsOf = (u) => call("GET", `/schools/${A.schoolId}/content-lessons?subject=${encodeURIComponent("ریاضی")}`, { token: u.token });
const itemsOf = (u) => call("GET", `/schools/content?schoolId=${A.schoolId}&lessonId=${les.id}`, { token: u.token });

// ── پیش‌فرض: همه‌ی کلاس‌ها (رفتارِ قبلی دست‌نخورده)
check("default: every existing subject visible to students of any class (same set as admin)", names(await list(s1)).length === adminAll.json.length && names(await list(s2)).length === adminAll.json.length && names(await list(sNo)).length === adminAll.json.length);
check("admin sees classIds=null (all classes) by default", adminAll.json.every((s) => s.classIds === null));
check("non-admin responses don't carry classIds", (await list(s1)).json.every((s) => !("classIds" in s)));

// ── انتخاب: فقط کلاس ۱
let r = await call("PATCH", `/schools/${A.schoolId}/subjects/${math.id}`, { token: A.token, body: { classIds: [c1.id] } });
check("admin restricts «ریاضی» to class 10A → 200 with classIds", r.status === 200 && JSON.stringify(r.json.classIds) === JSON.stringify([c1.id]), r.text);
check("student of 10A sees it; student of 10B does NOT; other subjects unaffected", names(await list(s1)).includes("ریاضی") && !names(await list(s2)).includes("ریاضی") && names(await list(s2)).includes("فیزیک"));
check("student in NO class doesn't see the restricted subject", !names(await list(sNo)).includes("ریاضی"));
check("GET subject by id: 10B student → 404, 10A student → 200", (await call("GET", `/schools/${A.schoolId}/subjects/${math.id}`, { token: s2.token })).status === 404 && (await call("GET", `/schools/${A.schoolId}/subjects/${math.id}`, { token: s1.token })).status === 200);
check("lessons of hidden subject: not listed / detail 404 for 10B student; visible for 10A", (await lessonsOf(s2)).json.length === 0 && (await call("GET", `/schools/${A.schoolId}/content-lessons/${les.id}`, { token: s2.token })).status === 404 && (await lessonsOf(s1)).json.length === 1);
check("items of hidden subject not listed (even by direct lessonId) for 10B student; visible for 10A", (await itemsOf(s2)).json.length === 0 && (await itemsOf(s1)).json.length === 1 && (await call("GET", `/schools/content/${item.id}`, { token: s2.token })).status >= 403);
check("teachers: 10A teacher sees it, 10B teacher doesn't", names(await list(t1)).includes("ریاضی") && !names(await list(t2)).includes("ریاضی"));
check("deputy / parent / admin are unrestricted", names(await list(dep)).includes("ریاضی") && names(await list(par)).includes("ریاضی") && names(await list(A)).includes("ریاضی"));
await call("POST", `/schools/${A.schoolId}/teacher-subjects`, { token: A.token, body: { teacherUserId: t3.id, subject: "ریاضی" } });
check("teacher explicitly ASSIGNED to the subject still sees it (can manage) even if not in its class", names(await list(t3)).includes("ریاضی"));
// چند کلاس
r = await call("PATCH", `/schools/${A.schoolId}/subjects/${math.id}`, { token: A.token, body: { classIds: [c1.id, c2.id] } });
check("multi-select: 10A+10B → both students see, 10C empty class student doesn't", names(await list(s2)).includes("ریاضی") && names(await list(s1)).includes("ریاضی") && !names(await list(sNo)).includes("ریاضی") && r.json.classIds.length === 2);
// اعتبارسنجی/مجوز
check("classIds from ANOTHER school → 400", (await call("PATCH", `/schools/${A.schoolId}/subjects/${math.id}`, { token: A.token, body: { classIds: [cB.id] } })).status === 400);
check("garbage classIds → 400", (await call("PATCH", `/schools/${A.schoolId}/subjects/${math.id}`, { token: A.token, body: { classIds: "x" } })).status === 400);
check("teacher/student can't change classIds (403)", (await call("PATCH", `/schools/${A.schoolId}/subjects/${math.id}`, { token: t3.token, body: { classIds: [] } })).status === 403 && (await call("PATCH", `/schools/${A.schoolId}/subjects/${math.id}`, { token: s1.token, body: { classIds: [] } })).status === 403);
check("admin of ANOTHER school can't touch it (403)", (await call("PATCH", `/schools/${A.schoolId}/subjects/${math.id}`, { token: B.token, body: { classIds: [] } })).status === 403);
// برگشت به همه
r = await call("PATCH", `/schools/${A.schoolId}/subjects/${math.id}`, { token: A.token, body: { classIds: [] } });
check("empty list (or null) = back to ALL classes; rows removed", r.json.classIds === null && names(await list(sNo)).includes("ریاضی") && (await pool.query("select 1 from school_subject_classes where subject_id=$1", [math.id])).rowCount === 0);
// ساخت با کلاس
r = await call("POST", `/schools/${A.schoolId}/subjects`, { token: A.token, body: { name: "درسِ اختصاصیِ ۱۰C", classIds: [c3.id] } });
check("create subject with classIds → hidden from 10A/10B students", r.status === 201 && JSON.stringify(r.json.classIds) === JSON.stringify([c3.id]) && !names(await list(s1)).includes("درسِ اختصاصیِ ۱۰C") && names(await list(A)).includes("درسِ اختصاصیِ ۱۰C"));
// حذف کلاس → درس برای همه برمی‌گردد (ردیف‌ها پاک)
await call("DELETE", `/schools/${A.schoolId}/classes/${c3.id}`, { token: A.token });
check("deleting the only allowed class doesn't hide the subject from everyone (rows cleaned → visible to all)", names(await list(s1)).includes("درسِ اختصاصیِ ۱۰C") && (await pool.query("select 1 from school_subject_classes where class_id=$1", [c3.id])).rowCount === 0);
// امنیتِ حذفِ کلاسِ مدرسهٔ دیگر (ریشه‌ی باگِ همجوار)
await call("DELETE", `/schools/${B.schoolId}/classes/${c1.id}`, { token: B.token });
check("admin of school B can't wipe school A's class roster through B's path", (await pool.query("select 1 from school_class_members where class_id=$1", [c1.id])).rowCount === 2);
// دوباره: اعمال روی فیزیک + تغییرِ نامِ درس نگه می‌دارد
await call("PATCH", `/schools/${A.schoolId}/subjects/${phys.id}`, { token: A.token, body: { classIds: [c2.id] } });
await call("PATCH", `/schools/${A.schoolId}/subjects/${phys.id}`, { token: A.token, body: { name: "فیزیکِ پیشرفته" } });
check("renaming a restricted subject keeps its class restriction", !names(await list(s1)).includes("فیزیکِ پیشرفته") && names(await list(s2)).includes("فیزیکِ پیشرفته"));
check("deleting a subject removes its class rows", (await call("DELETE", `/schools/${A.schoolId}/subjects/${phys.id}?force=true`, { token: A.token })).status < 300 && (await pool.query("select 1 from school_subject_classes where subject_id=$1", [phys.id])).rowCount === 0);
await done();
