/** رگرسیونِ حذفِ نرمِ اخطار (سنگِ قبر) — سرورِ واقعی. */
import { execFileSync } from "node:child_process";
import { call, newSchoolAdmin, newUser, joinSchool, pool, done, check } from "./lib.mjs";
execFileSync("node", ["migrate.mjs"], { env: process.env, stdio: "ignore" });
const a = await newSchoolAdmin();
const stu = await joinSchool(a, "student");
const stu2 = await joinSchool(a, "student");
const parent = await newUser("parent");
const par2 = await newUser("parent");
const dd = await joinSchool(a, "deputy_discipline");
const dep = await joinSchool(a, "deputy");
const dep2 = await joinSchool(a, "deputy");
const teacher = await joinSchool(a, "teacher");
const b = await newSchoolAdmin("دیگر");
await call("POST", `/schools/${a.schoolId}/guardianships`, { token: a.token, body: { parentUserId: parent.id, studentMemberId: stu.memberId } });
const SECRET = "متن-محرمانه-" + Math.random().toString(36).slice(2);
const mk = async (u, title = "T-" + SECRET) => (await call("POST", `/schools/${a.schoolId}/alerts`, { token: u.token, body: { studentMemberId: stu.memberId, severity: "warning", title, body: title.startsWith("LIVE") ? "live body" : "B-" + SECRET } }));
const c1 = await mk(a); const c2 = await mk(dep); const c3 = await mk(dep2); const c4 = await mk(dd, "LIVE-" + SECRET.slice(-4)); // اخطارِ زنده: متنِ دیگر
check("issue by admin/deputy/deputy/discipline", [c1, c2, c3, c4].every((c) => c.status === 201), [c1.status, c2.status, c3.status, c4.status]);
const notif = async (u) => (await call("GET", "/notifications", { token: u.token })).text;
check("before delete: student/parent bell has the text", (await notif(stu)).includes(SECRET) && (await notif(parent)).includes(SECRET));
const del = (u, id, sid = a.schoolId) => call("DELETE", `/schools/${sid}/alerts/${id}`, { token: u.token });
check("student cannot delete (403)", (await del(stu, c1.json.id)).status === 403);
check("teacher cannot delete (403)", (await del(teacher, c1.json.id)).status === 403);
check("parent cannot delete (403)", (await del(parent, c1.json.id)).status === 403);
check("other school's admin cannot delete (403)", (await del(b, c1.json.id)).status === 403);
check("deputy cannot delete another deputy's alert (403)", (await del(dep, c3.json.id)).status === 403);
check("unknown id → 404", (await del(a, "nope")).status === 404);
check("issuer deputy deletes own (200)", (await del(dep, c2.json.id)).status === 200);
check("deputy_discipline deletes someone else's (200)", (await del(dd, c3.json.id)).status === 200);
check("admin deletes (200)", (await del(a, c1.json.id)).status === 200);
check("second delete is idempotent", (await del(a, c1.json.id)).json?.alreadyDeleted === true);
const lists = {
  admin: await call("GET", `/schools/${a.schoolId}/alerts`, { token: a.token }),
  student: await call("GET", `/schools/${a.schoolId}/alerts/my`, { token: stu.token }),
  parent: await call("GET", `/schools/${a.schoolId}/alerts/child/${stu.memberId}`, { token: parent.token }),
};
for (const [who, r] of Object.entries(lists)) {
  check(`${who}: 200, secret absent from raw response`, r.status === 200 && !r.text.includes(SECRET), r.status);
  const del3 = r.json.filter((x) => x.deleted);
  check(`${who}: 3 tombstones + 1 live`, del3.length === 3 && r.json.length === 4, r.text.slice(0, 300));
  check(`${who}: tombstone keys are only id/deleted/deletedAt${who === "admin" ? "/studentMemberId" : ""}`, del3.every((x) => Object.keys(x).sort().join() === (who === "admin" ? "deleted,deletedAt,id,studentMemberId" : "deleted,deletedAt,id")), del3[0]);
}
check("the one live alert (discipline's) still shows its text to student", lists.student.json.find((x) => !x.deleted)?.title.startsWith("LIVE-"));
check("unrelated parent still 403", (await call("GET", `/schools/${a.schoolId}/alerts/child/${stu.memberId}`, { token: par2.token })).status === 403);
check("other student's /my has none", (await call("GET", `/schools/${a.schoolId}/alerts/my`, { token: stu2.token })).json.length === 0);
const n1 = await notif(stu), n2 = await notif(parent);
check("deleted alerts' bell notifications gone for student+parent (live one remains)", !n1.includes(SECRET) && !n2.includes(SECRET) && n1.includes("LIVE-") && n2.includes("LIVE-"));
const audit = await call("GET", `/schools/${a.schoolId}/audit-log`, { token: a.token });
check("audit log has alert.deleted entries without the alert text", audit.status === 200 && audit.json.filter((e) => e.action === "alert.deleted").length === 3 && !audit.json.filter((e) => e.action === "alert.deleted").some((e) => JSON.stringify(e).includes(SECRET)), audit.text.slice(0, 200));
const row = (await pool.query("select title, deleted_by_user_id from school_student_alerts where id=$1", [c1.json.id])).rows[0];
check("DB row kept (soft delete) with deleted_by", row && row.deleted_by_user_id === a.id);
await done();
