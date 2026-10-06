/** صفر نشتِ بین‌مدرسه‌ای: تکلیف/آزمون/سؤال/اعلامیه/برنامه — دو مدرسه، کاربرانِ مدرسه‌یِ A نباید چیزی از B ببینند/تغییر دهند. */
import { execFileSync } from "node:child_process";
import { call, newSchoolAdmin, joinSchool, done, check } from "./lib.mjs";
execFileSync("node", ["migrate.mjs"], { env: process.env, stdio: "ignore" });

const A = await newSchoolAdmin("الف"), B = await newSchoolAdmin("ب");
const mkClass = async (adm, name) => (await call("POST", `/schools/${adm.schoolId}/classes`, { token: adm.token, body: { name, grade: "10", academicYear: "1404-1405" } })).json;
const cA = await mkClass(A, "A1"), cB = await mkClass(B, "B1");
const tB = await joinSchool(B, "teacher"), sB = await joinSchool(B, "student");
await call("POST", `/schools/${B.schoolId}/classes/${cB.id}/members`, { token: B.token, body: { schoolMemberId: tB.memberId, roleInClass: "teacher" } });
await call("POST", `/schools/${B.schoolId}/classes/${cB.id}/members`, { token: B.token, body: { schoolMemberId: sB.memberId, roleInClass: "student" } });
const qB = await call("POST", `/schools/${B.schoolId}/questions`, { token: tB.token, body: { questionText: "سؤالِ مخفیِ B", choices: ["a", "b"], correctAnswer: "a" } });
check("setup: B question", qB.status === 201, qB.text);
const asgB = await call("POST", `/schools/${B.schoolId}/assignments`, { token: tB.token, body: { classId: cB.id, title: "تکلیفِ سرّیِ B" } });
const exB = await call("POST", `/schools/${B.schoolId}/exams`, { token: tB.token, body: { classId: cB.id, title: "آزمونِ سرّیِ B", questionIds: [qB.json.id] } });
check("setup: B assignment+exam", asgB.status === 201 && exB.status === 201, [asgB.text, exB.text]);
const subB = await call("POST", `/schools/${B.schoolId}/assignments/${asgB.json.id}/submissions`, { token: sB.token, body: { content: "پاسخِ B" } });
check("setup: B submission", subB.status === 201, subB.text);

// کاربرانِ A
const tA = await joinSchool(A, "teacher"), sA = await joinSchool(A, "student");
await call("POST", `/schools/${A.schoolId}/classes/${cA.id}/members`, { token: A.token, body: { schoolMemberId: tA.memberId, roleInClass: "teacher" } });
await call("POST", `/schools/${A.schoolId}/classes/${cA.id}/members`, { token: A.token, body: { schoolMemberId: sA.memberId, roleInClass: "student" } });
const asgA = await call("POST", `/schools/${A.schoolId}/assignments`, { token: tA.token, body: { classId: cA.id, title: "تکلیفِ A" } });
check("setup: A assignment", asgA.status === 201);

for (const [label, u] of [["student", sA], ["teacher", tA], ["admin", A]]) {
  const l = await call("GET", `/schools/${A.schoolId}/assignments`, { token: u.token });
  check(`${label}(A): GET /assignments (no classId) has ONLY A's assignment`, l.status === 200 && l.json.length === 1 && l.json[0].id === asgA.json.id && !l.text.includes("سرّیِ B"), l.text);
  const l2 = await call("GET", `/schools/${A.schoolId}/assignments?classId=${cB.id}`, { token: u.token });
  check(`${label}(A): GET /assignments?classId=<B class> → empty`, l2.status === 200 && l2.json.length === 0, l2.text);
}
check("student(A): exams?classId=<B class> → 404, no data", await (async () => { const r = await call("GET", `/schools/${A.schoolId}/exams?classId=${cB.id}`, { token: sA.token }); return r.status === 404 && !r.text.includes("سرّی"); })());
for (const [label, u] of [["teacher", tA], ["admin", A], ["student", sA]]) {
  const r = await call("GET", `/schools/${A.schoolId}/exams/${exB.json.id}/questions`, { token: u.token });
  check(`${label}(A): B exam questions via A path → 404 (no question/answer leak)`, r.status === 404 && !r.text.includes("مخفی") && !r.text.includes("correctAnswer"), r.text);
}
check("admin(A): B exam attempts → 404", (await call("GET", `/schools/${A.schoolId}/exams/${exB.json.id}/attempts`, { token: A.token })).status === 404);
check("admin(A): B exam analytics → 404", (await call("GET", `/schools/${A.schoolId}/exams/${exB.json.id}/analytics`, { token: A.token })).status === 404);
const sub = await call("GET", `/schools/${A.schoolId}/assignments/${asgB.json.id}/submissions`, { token: A.token });
check("admin(A): B assignment submissions → 404, no content", sub.status === 404 && !sub.text.includes("پاسخِ B"), sub.text);
check("admin(A): grade B submission → 404 and grade unchanged", (await call("PATCH", `/schools/${A.schoolId}/assignments/${asgB.json.id}/submissions/${subB.json.id}`, { token: A.token, body: { grade: "0" } })).status === 404);
check("admin(A): create assignment in B class → 404", (await call("POST", `/schools/${A.schoolId}/assignments`, { token: A.token, body: { classId: cB.id, title: "x" } })).status === 404);
check("admin(A): create exam in B class → 404", (await call("POST", `/schools/${A.schoolId}/exams`, { token: A.token, body: { classId: cB.id, title: "x", questionIds: [qB.json.id] } })).status === 404);
const qA = await call("POST", `/schools/${A.schoolId}/questions`, { token: tA.token, body: { questionText: "q", choices: ["a", "b"], correctAnswer: "a" } });
check("teacher(A): exam in own class using B's question id → 400", (await call("POST", `/schools/${A.schoolId}/exams`, { token: tA.token, body: { classId: cA.id, title: "x", questionIds: [qB.json.id] } })).status === 400);
check("teacher(A): exam with own question → 201", (await call("POST", `/schools/${A.schoolId}/exams`, { token: tA.token, body: { classId: cA.id, title: "ok", questionIds: [qA.json.id] } })).status === 201);
check("admin(A): class announcement into B class → 404; no notification to B student", (await call("POST", `/schools/${A.schoolId}/announcements`, { token: A.token, body: { kind: "class", classId: cB.id, title: "نفوذ", body: "x" } })).status === 404 && !(await call("GET", "/notifications", { token: sB.token })).text.includes("نفوذ"));
check("admin(A): program in B class → 404", (await call("POST", `/schools/${A.schoolId}/programs`, { token: A.token, body: { title: "x", classId: cB.id } })).status === 404);
check("questions list (A teacher) has no B question", !(await call("GET", `/schools/${A.schoolId}/questions`, { token: tA.token })).text.includes("مخفیِ B"));
check("announcements list (A) has no B data", !(await call("GET", `/schools/${A.schoolId}/announcements?classId=${cB.id}`, { token: sA.token })).text.includes("نفوذ"));
check("A user listing B's schoolId directly → 403", (await call("GET", `/schools/${B.schoolId}/assignments`, { token: sA.token })).status === 403);
// منفیِ مثبت: B خودش همه را درست می‌بیند
check("B teacher still sees own assignment/exam/questions", (await call("GET", `/schools/${B.schoolId}/assignments`, { token: tB.token })).json.length === 1 && (await call("GET", `/schools/${B.schoolId}/exams?classId=${cB.id}`, { token: tB.token })).json.length === 1 && (await call("GET", `/schools/${B.schoolId}/exams/${exB.json.id}/questions`, { token: tB.token })).json.length === 1);
await done();
