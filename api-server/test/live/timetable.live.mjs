/** برنامه‌یِ هفتگی: ثبتِ روز، تداخل، جایگزینیِ اتمیک، رقمِ فارسی، کپیِ روز، دسترسی‌ها. */
import { execFileSync } from "node:child_process";
import { call, newSchoolAdmin, joinSchool, pool, done, check } from "./lib.mjs";
execFileSync("node", ["migrate.mjs"], { env: process.env, stdio: "ignore" });

const A = await newSchoolAdmin("الف"), B = await newSchoolAdmin("ب");
const mk = async (adm, name) => (await call("POST", `/schools/${adm.schoolId}/classes`, { token: adm.token, body: { name, grade: "10", academicYear: "1404-1405" } })).json;
const c1 = await mk(A, "10A"), c2 = await mk(A, "10B"), cB = await mk(B, "X");
const add = (adm, cid, u, role) => call("POST", `/schools/${adm.schoolId}/classes/${cid}/members`, { token: adm.token, body: { schoolMemberId: u.memberId, roleInClass: role } });
const t1 = await joinSchool(A, "teacher"), t2 = await joinSchool(A, "teacher"), tOut = await joinSchool(A, "teacher");
const s1 = await joinSchool(A, "student"), s2 = await joinSchool(A, "student"), sB = await joinSchool(B, "student");
const dep = await joinSchool(A, "deputy"), par = await joinSchool(A, "parent"), par2 = await joinSchool(A, "parent");
await add(A, c1.id, t1, "teacher"); await add(A, c2.id, t1, "teacher"); await add(A, c1.id, t2, "teacher");
await add(A, c1.id, s1, "student"); await add(A, c2.id, s2, "student");
await call("POST", `/schools/${A.schoolId}/guardianships`, { token: A.token, body: { parentUserId: par.id, studentMemberId: s1.memberId } });
const put = (u, cid, day, slots, sid = A.schoolId) => call("PUT", `/schools/${sid}/timetable/classes/${cid}/days/${day}`, { token: u.token, body: { slots } });
const get = (u, cid, sid = A.schoolId) => call("GET", `/schools/${sid}/timetable?classId=${cid}`, { token: u.token });
const dbDay = async (cid, d) => (await pool.query("select start_time,end_time,subject from school_timetable_slots where class_id=$1 and day_of_week=$2 order by start_time", [cid, d])).rows;

// ── مثالِ کاربر: ۸:۰۰–۹:۱۰ ریاضی، ۹:۳۰–۱۰:۵۰ ورزش
let r = await put(A, c1.id, 0, [{ startTime: "9:30", endTime: "10:50", subject: "ورزش" }, { startTime: "8:00", endTime: "9:10", subject: "ریاضی", teacherUserId: t1.id }]);
check("admin saves Saturday (8:00 Math–9:10, 9:30 PE–10:50), unsorted input → 200, sorted+padded", r.status === 200 && r.json.slots.length === 2 && r.json.slots[0].startTime === "08:00" && r.json.slots[0].subject === "ریاضی" && r.json.slots[1].startTime === "09:30" && r.json.slots[0].teacherName, r.text);
check("deputy (write role) can save another day", (await put(dep, c1.id, 1, [{ startTime: "08:00", endTime: "09:00", subject: "فیزیک" }])).status === 200);
// ── تداخل
const before = await dbDay(c1.id, 0);
r = await put(A, c1.id, 0, [{ startTime: "08:00", endTime: "09:10", subject: "ریاضی" }, { startTime: "09:00", endTime: "10:00", subject: "ادبیات" }]);
check("overlap → 409 naming conflicting slot + row index", r.status === 409 && r.json.code === "overlap" && r.json.rowErrors[0].index === 1 && r.json.rowErrors[0].conflictsWith === 0 && r.json.rowErrors[0].message.includes("ریاضی"), r.text);
check("atomic: old day intact after rejected overlap", JSON.stringify(await dbDay(c1.id, 0)) === JSON.stringify(before));
r = await put(A, c1.id, 0, [{ startTime: "08:00", endTime: "09:10", subject: "ریاضی" }, { startTime: "09:10", endTime: "10:00", subject: "ادبیات" }]);
check("touching slots (end == next start) are allowed", r.status === 200 && r.json.slots.length === 2);
// ── اعتبارسنجی + اتمیک (ردیفِ دوم بد)
const before2 = await dbDay(c1.id, 0);
r = await put(A, c1.id, 0, [{ startTime: "07:00", endTime: "07:45", subject: "جدید" }, { startTime: "10:00", endTime: "09:00", subject: "بد" }]);
check("end<=start → 400 with row index 1; day unchanged", r.status === 400 && r.json.rowErrors.some((e) => e.index === 1 && e.code === "end_before_start") && JSON.stringify(await dbDay(c1.id, 0)) === JSON.stringify(before2), r.text);
r = await put(A, c1.id, 0, [{ startTime: "25:00", endTime: "26:00", subject: "x" }, { startTime: "08:00", endTime: "09:00", subject: "" }]);
check("bad time + empty subject reported per row", r.status === 400 && r.json.rowErrors.some((e) => e.index === 0 && e.field === "startTime") && r.json.rowErrors.some((e) => e.index === 1 && e.field === "subject"), r.text);
r = await put(A, c1.id, 2, [{ startTime: "۰۸:۳۰", endTime: "٩:٤٥", subject: "شیمی" }]);
check("Persian/Arabic digits accepted and normalized (08:30–09:45)", r.status === 200 && r.json.slots[0].startTime === "08:30" && r.json.slots[0].endTime === "09:45", r.text);
r = await put(A, c1.id, 3, [{ startTime: "10:00", endTime: "10:20", subject: "تفریح" }, { startTime: "10:20", endTime: "10:40", subject: "نماز" }]);
check("free labels (تفریح/نماز) accepted", r.status === 200);
check("day 7 → 400, day 'x' → 400", (await put(A, c1.id, 7, [])).status === 400 && (await put(A, c1.id, "x", [])).status === 400);
check("non-array slots → 400", (await call("PUT", `/schools/${A.schoolId}/timetable/classes/${c1.id}/days/4`, { token: A.token, body: {} })).status === 400);
check("21 slots → 400", (await put(A, c1.id, 4, Array.from({ length: 21 }, (_, i) => ({ startTime: `${String(i).padStart(2, "0")}:00`, endTime: `${String(i).padStart(2, "0")}:30`, subject: "x" })))).status === 400);
// ── معلم
r = await put(A, c1.id, 5, [{ startTime: "08:00", endTime: "09:00", subject: "ریاضی", teacherUserId: tOut.id }]);
check("teacher not in class → 400 teacher_not_in_class", r.status === 400 && r.json.rowErrors[0].code === "teacher_not_in_class", r.text);
await put(A, c1.id, 5, [{ startTime: "08:00", endTime: "09:00", subject: "ریاضی", teacherUserId: t1.id }]);
r = await put(A, c2.id, 5, [{ startTime: "08:30", endTime: "09:30", subject: "ریاضی", teacherUserId: t1.id }]);
check("same teacher double-booked in 2 classes → 409 teacher_busy naming class", r.status === 409 && r.json.code === "teacher_busy" && r.json.rowErrors[0].message.includes("10A"), r.text);
// ── دسترسی
check("student(A) cannot write (403)", (await put(s1, c1.id, 0, [])).status === 403);
check("teacher/parent cannot write (403)", (await put(t1, c1.id, 0, [])).status === 403 && (await put(par, c1.id, 0, [])).status === 403);
check("admin of B writing A's class via B path → 404; via A path → 403", (await put(B, c1.id, 0, [], B.schoolId)).status === 404 && (await put(B, c1.id, 0, [])).status === 403);
check("admin(A) writing B's class → 404", (await put(A, cB.id, 0, [])).status === 404);
check("student of B can't read A's class timetable (403)", (await get(sB, c1.id)).status === 403);
check("read: own-class student 200 with 9 slots? (day0:2, day1:1, day2:1, day3:2, day5:1 = 7)", (await get(s1, c1.id)).json.slots.length === 7, (await get(s1, c1.id)).text);
check("read: student of OTHER class in same school → 403", (await get(s2, c1.id)).status === 403);
check("read: class teacher → 200; teacher outside class → 403", (await get(t1, c1.id)).status === 200 && (await get(tOut, c1.id)).status === 403);
check("read: linked parent → 200; unlinked parent → 403", (await get(par, c1.id)).status === 200 && (await get(par2, c1.id)).status === 403);
check("read: deputy 200", (await get(dep, c1.id)).status === 200);
check("read: class of another school via my school path → 403", (await get(A, cB.id)).status === 403);
// ── mine
let m = await call("GET", `/schools/${A.schoolId}/timetable/mine`, { token: s1.token });
check("mine(student) = own class week (7)", m.status === 200 && m.json.role === "student" && m.json.slots.length === 7, m.text);
m = await call("GET", `/schools/${A.schoolId}/timetable/mine`, { token: s2.token });
check("mine(student 10B) = 0 slots (class empty)", m.json.slots.length === 0);
m = await call("GET", `/schools/${A.schoolId}/timetable/mine`, { token: t1.token });
check("mine(teacher t1) = slots of his classes (10A:7 + 10B:0)", m.status === 200 && m.json.slots.length === 7 && m.json.slots.filter((s) => s.mine).length === 1, m.text);
m = await call("GET", `/schools/${A.schoolId}/timetable/mine`, { token: t2.token });
check("mine(teacher t2: in 10A) sees 10A", m.json.slots.length === 7);
m = await call("GET", `/schools/${A.schoolId}/timetable/mine`, { token: tOut.token });
check("mine(teacher in no class, no slots) = []", m.status === 200 && m.json.slots.length === 0);
m = await call("GET", `/schools/${A.schoolId}/timetable/mine`, { token: par.token });
check("mine(parent) = linked child's class only", m.status === 200 && m.json.children.length === 1 && m.json.children[0].slots.length === 7, m.text);
check("mine(parent2 unlinked) = no children", (await call("GET", `/schools/${A.schoolId}/timetable/mine`, { token: par2.token })).json.slots.length === 0);
check("mine(student of B) on A path → 403", (await call("GET", `/schools/${A.schoolId}/timetable/mine`, { token: sB.token })).status === 403);
// ── کپی
r = await call("POST", `/schools/${A.schoolId}/timetable/classes/${c1.id}/copy`, { token: A.token, body: { fromDay: 0, toDays: [1, 3, 0] } });
check("copy Saturday → Sun & Tue (replaces them), source untouched", r.status === 200 && JSON.stringify((await dbDay(c1.id, 1)).map((x) => x.subject)) === JSON.stringify(["ریاضی", "ادبیات"]) && (await dbDay(c1.id, 3)).length === 2 && (await dbDay(c1.id, 0)).length === 2, r.text);
// کپیِ روزی که معلمِ همان‌ساعتش در کلاسِ دیگر مشغول است: همه یا هیچ
await put(A, c2.id, 6, [{ startTime: "08:00", endTime: "09:00", subject: "زیست", teacherUserId: t1.id }]);
await put(A, c1.id, 4, [{ startTime: "08:00", endTime: "09:00", subject: "ریاضی", teacherUserId: t1.id }]);
const snap = JSON.stringify([await dbDay(c1.id, 2), await dbDay(c1.id, 6)]);
r = await call("POST", `/schools/${A.schoolId}/timetable/classes/${c1.id}/copy`, { token: A.token, body: { fromDay: 4, toDays: [2, 6] } });
check("copy with a teacher clash on 2nd target → 409 and NO target changed (atomic)", r.status === 409 && JSON.stringify([await dbDay(c1.id, 2), await dbDay(c1.id, 6)]) === snap, r.text);
check("copy by student → 403", (await call("POST", `/schools/${A.schoolId}/timetable/classes/${c1.id}/copy`, { token: s1.token, body: { fromDay: 0, toDays: [1] } })).status === 403);
// ── پاک‌کردنِ روز + هم‌زمانی
check("clear day = PUT [] → empty", (await put(A, c1.id, 1, [])).json.slots.filter((s) => s.dayOfWeek === 1).length === 0 && (await dbDay(c1.id, 1)).length === 0);
const par3 = await Promise.all([1, 2, 3, 4].map((i) => put(A, c2.id, 3, [{ startTime: "08:00", endTime: "09:00", subject: "هم‌زمان" + i }])));
check("4 concurrent saves of one day → all 200, exactly 1 row remains (no dupes)", par3.every((x) => x.status === 200) && (await dbDay(c2.id, 3)).length === 1);
// ── برنامه‌یِ قدیمی (school_programs) هنوز کار می‌کند
const p = await call("POST", `/schools/${A.schoolId}/programs`, { token: A.token, body: { title: "برنامه‌یِ قدیمی", dayOfWeek: "0", startTime: "08:00", endTime: "09:00" } });
check("legacy school_programs API still works (create+list)", p.status === 201 && (await call("GET", `/schools/${A.schoolId}/programs`, { token: s1.token })).json.length === 1);
await done();
