/** انتخابِ کلاس/درسِ دانش‌آموز و معلم + هویت‌هایِ آزمایشیِ /super — سرورِ واقعی + Postgresِ واقعی. */
import { execFileSync } from "node:child_process";
import { call, newSchoolAdmin, newSuper, joinSchool, pool, done, check } from "./lib.mjs";
execFileSync("node", ["migrate.mjs"], { env: process.env, stdio: "ignore" });

const a = await newSchoolAdmin();
const other = await newSchoolAdmin("دیگر");
const mkClass = async (adm, name, grade) => (await call("POST", `/schools/${adm.schoolId}/classes`, { token: adm.token, body: { name, grade, academicYear: "1404-1405" } })).json;
const cA = await mkClass(a, "11A", "11"), cB = await mkClass(a, "11B", "11"), cC = await mkClass(a, "10C", "10");
const cOther = await mkClass(other, "X1", "11");
const status = (u, sid = a.schoolId) => call("GET", `/schools/${sid}/enrollment/me`, { token: u.token });
const dbRows = async (memberId, role) => (await pool.query("select class_id from school_class_members where school_member_id=$1 and role_in_class=$2", [memberId, role])).rows;

// ── دانش‌آموز
const s = await joinSchool(a, "student", { grade: "11" });
let st = await status(s);
check("student status: needsSelection + class list (3 classes)", st.status === 200 && st.json.needsSelection === true && st.json.classes.length === 3 && st.json.studentClassId === null, st.text);
check("pick class of another school → 404, nothing written", (await call("POST", `/schools/${a.schoolId}/enrollment/student`, { token: s.token, body: { classId: cOther.id } })).status === 404 && (await dbRows(s.memberId, "student")).length === 0);
check("pick with no classId → 400", (await call("POST", `/schools/${a.schoolId}/enrollment/student`, { token: s.token, body: {} })).status === 400);
// دو انتخابِ هم‌زمان
const [r1, r2] = await Promise.all([
  call("POST", `/schools/${a.schoolId}/enrollment/student`, { token: s.token, body: { classId: cA.id } }),
  call("POST", `/schools/${a.schoolId}/enrollment/student`, { token: s.token, body: { classId: cB.id } }),
]);
check("two concurrent picks → exactly one 201 and one 409", [r1.status, r2.status].sort().join() === "201,409", [r1.status, r2.status]);
check("exactly ONE class_members row", (await dbRows(s.memberId, "student")).length === 1);
const chosen = (await dbRows(s.memberId, "student"))[0].class_id;
const again = await call("POST", `/schools/${a.schoolId}/enrollment/student`, { token: s.token, body: { classId: cC.id } });
check("later attempt to change → 409 already_enrolled", again.status === 409 && again.json.code === "already_enrolled");
st = await status(s);
check("status now needsSelection=false, studentClassId set", st.json.needsSelection === false && st.json.studentClassId === chosen);
const mine = await call("GET", `/schools/${a.schoolId}/classes?mine=true`, { token: s.token });
check("/classes?mine=true returns only the chosen class", mine.json.length === 1 && mine.json[0].id === chosen);
const other2 = chosen === cA.id ? cB : cA;
const adm1 = await call("POST", `/schools/${a.schoolId}/classes/${other2.id}/members`, { token: a.token, body: { schoolMemberId: s.memberId, roleInClass: "student" } });
check("admin adding the same student to a 2nd class → 409 student_already_in_class", adm1.status === 409 && adm1.json.code === "student_already_in_class");
const cm = (await call("GET", `/schools/${a.schoolId}/classes/${chosen}/members`, { token: a.token })).json.find((m) => m.schoolMemberId === s.memberId);
check("admin removes from old class then adds to new (admin-only change)", (await call("DELETE", `/schools/${a.schoolId}/classes/${chosen}/members/${cm.id}`, { token: a.token })).status === 204 && (await call("POST", `/schools/${a.schoolId}/classes/${other2.id}/members`, { token: a.token, body: { schoolMemberId: s.memberId, roleInClass: "student" } })).status === 201 && (await dbRows(s.memberId, "student")).length === 1);
const t0 = await joinSchool(a, "teacher");
check("teacher can't use the student endpoint (403)", (await call("POST", `/schools/${a.schoolId}/enrollment/student`, { token: t0.token, body: { classId: cA.id } })).status === 403);
const s3 = await joinSchool(other, "student");
check("student of ANOTHER school can't pick in school A (403)", (await call("POST", `/schools/${a.schoolId}/enrollment/student`, { token: s3.token, body: { classId: cA.id } })).status === 403);
check("admin cross-school class member add → 404", (await call("POST", `/schools/${a.schoolId}/classes/${cOther.id}/members`, { token: a.token, body: { schoolMemberId: s.memberId, roleInClass: "student" } })).status === 404);

// ── معلم
const t = await joinSchool(a, "teacher");
st = await status(t);
check("teacher status: needsSelection + real subjects list", st.json.needsSelection === true && st.json.subjects.includes("ریاضی") && st.json.subjects.includes("فیزیک"), st.text.slice(0, 200));
const put = (body, u = t, sid = a.schoolId) => call("PUT", `/schools/${sid}/enrollment/teacher`, { token: u.token, body });
check("empty assignments → 400", (await put({ assignments: [] })).status === 400);
check("other school's class → 404", (await put({ assignments: [{ classId: cOther.id, subjects: ["ریاضی"] }] })).status === 404);
check("invented subject → 400", (await put({ assignments: [{ classId: cA.id, subjects: ["نجوم"] }] })).status === 400);
check("student can't use teacher endpoint (403)", (await put({ assignments: [{ classId: cA.id, subjects: ["ریاضی"] }] }, s)).status === 403);
let w = await put({ assignments: [{ classId: cA.id, subjects: ["ریاضی", "فیزیک"] }, { classId: cB.id, subjects: ["ریاضی"] }] });
check("3 class×subject combos over 2 classes → 200", w.status === 200 && w.json.classes === 2 && w.json.combos === 3, w.text);
const ts = async () => (await pool.query("select class_id, subject from school_teacher_subjects where teacher_user_id=$1 order by class_id, subject", [t.id])).rows;
check("DB: 2 teacher class memberships + 3 class-scoped subject rows", (await dbRows(t.memberId, "teacher")).length === 2 && (await ts()).length === 3 && (await ts()).every((r) => r.class_id));
await call("POST", `/schools/${a.schoolId}/teacher-subjects`, { token: a.token, body: { teacherUserId: t.id, subject: "تاریخ", classId: null } });
const wr = (subject) => call("POST", "/schools/content", { token: t.token, body: { schoolId: a.schoolId, type: "note", title: "n", body: "b", subject } });
check("write-gate: teacher may write in Math (class-scoped assignment)", (await wr("ریاضی")).status === 201);
check("write-gate: teacher may NOT write in a subject never assigned (شیمی) → 403", (await wr("شیمی")).status === 403);
check("status: needsSelection=false", (await status(t)).json.needsSelection === false);
w = await put({ assignments: [{ classId: cB.id, subjects: ["فیزیک"] }] });
check("edit later: set replaced (1 class, 1 combo), admin-assigned all-classes row (تاریخ) preserved", w.status === 200 && (await dbRows(t.memberId, "teacher")).length === 1 && (await ts()).length === 2 && (await ts()).some((r) => r.subject === "تاریخ" && r.class_id === null) && (await ts()).some((r) => r.subject === "فیزیک" && r.class_id === cB.id), await ts());
check("write-gate after edit: Math now 403, Physics 201, تاریخ (admin) 201", (await wr("ریاضی")).status === 403 && (await wr("فیزیک")).status === 201 && (await wr("تاریخ")).status === 201);
const aud = await call("GET", `/schools/${a.schoolId}/audit-log`, { token: a.token });
check("audit log has member.class_selected + teacher.assignments_set", ["member.class_selected", "teacher.assignments_set"].every((x) => aud.json.some((e) => e.action === x)));

// ── هویتِ آزمایشیِ /super: هرگز انتخابگر
const sup = await newSuper();
const sc = { token: sup.token, cookie: sup.cookie };
const enter = async (userId) => (await call("POST", `/super/test-identities/${userId}/enter`, sc)).json;
const tid = (body) => call("POST", "/super/test-identities", { ...sc, body });
// ۱) مدرسه‌یِ تازه
let r = await tid({ role: "student", grade: "10", newSchoolName: "مدرسه تست " + Math.random().toString(36).slice(2, 6) });
check("test student (new test school) → 201", r.status === 201, r.text);
let ent = await enter(r.json.userId);
st = await status({ token: ent.token }, r.json.schoolId);
check("…lands with a class («کلاس تست») and NO picker", st.json.needsSelection === false && st.json.classes.length === 1 && st.json.classes[0].name === "کلاس تست" && !!st.json.studentClassId, st.text);
// ۲) مدرسه‌یِ واقعی با کلاس: اولین کلاس
r = await tid({ role: "student", grade: "11", schoolId: a.schoolId });
ent = await enter(r.json.userId); st = await status({ token: ent.token }, a.schoolId);
check("test student in school with classes → first class (11A), no picker", r.status === 201 && st.json.needsSelection === false && st.json.studentClassId === cA.id, st.text.slice(0, 200));
// ۳) کلاسِ انتخابی
r = await tid({ role: "student", grade: "10", schoolId: a.schoolId, classId: cC.id });
ent = await enter(r.json.userId); st = await status({ token: ent.token }, a.schoolId);
check("explicit classId honoured", st.json.studentClassId === cC.id);
check("classId from another school → 400", (await tid({ role: "student", grade: "10", schoolId: a.schoolId, classId: cOther.id })).status === 400);
// ۴) معلمِ آزمایشی
r = await tid({ role: "teacher", schoolId: a.schoolId, subject: "ریاضی", classId: cB.id });
ent = await enter(r.json.userId); st = await status({ token: ent.token }, a.schoolId);
check("test teacher: in class, no picker, content write works", st.json.needsSelection === false && st.json.teacherClassIds.join() === cB.id && (await call("POST", "/schools/content", { token: ent.token, body: { schoolId: a.schoolId, type: "note", title: "t", subject: "ریاضی" } })).status === 201, st.text.slice(0, 200));
// ۵) هویتِ قدیمیِ بدونِ کلاس → همان لحظه خودکار می‌گیرد
r = await tid({ role: "student", grade: "11", schoolId: a.schoolId });
const m = (await pool.query("select id from school_members where user_id=$1", [r.json.userId])).rows[0];
await pool.query("delete from school_class_members where school_member_id=$1", [m.id]);
ent = await enter(r.json.userId); st = await status({ token: ent.token }, a.schoolId);
check("legacy classless test identity is auto-assigned on first status call (no picker)", st.json.needsSelection === false && !!st.json.studentClassId);
// ۶) پاک‌سازی
const del = await call("DELETE", `/super/test-identities/${r.json.userId}`, sc);
check("test identity delete removes its class membership", del.status === 200 && (await pool.query("select 1 from school_class_members where school_member_id=$1", [m.id])).rowCount === 0);
const cl = await call("POST", "/super/test-schools/cleanup", sc);
check("test-school cleanup works with auto-created classes", cl.status === 200 && cl.json.deletedSchools >= 1, cl.text);
await done();
