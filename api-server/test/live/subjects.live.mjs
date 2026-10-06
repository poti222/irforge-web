/**
 * test/live/subjects.live.mjs — رگرسیونِ باگِ «درسی که ساختم هیچ‌جا نمایش داده نمی‌شود، ولی ساخت دوباره ۴۰۹ می‌دهد».
 * ریشه: جدولِ school_content_progress هرگز در migrate.mjs ساخته نمی‌شد و GET /subjects (loadLessonStats) ۵۰۰ می‌داد.
 * اجرا: DATABASE_URL=... BASE=http://localhost:3111 node test/live/subjects.live.mjs  (سرورِ واقعی + Postgresِ واقعی)
 */
import { execFileSync } from "node:child_process";
import { call, newSchoolAdmin, newSuper, joinSchool, pool, done, check } from "./lib.mjs";

const a = await newSchoolAdmin();
const b = await newSchoolAdmin("مدرسهِ دیگر");
const t = await joinSchool(a, "teacher");
const s = await joinSchool(a, "student");
const list = (u, sid = a.schoolId) => call("GET", `/schools/${sid}/subjects`, u.cookie ? { token: u.token, cookie: u.cookie } : { token: u.token });

// ۱) ریشه: بدونِ جدولِ progress، فهرست ۵۰۰ است؛ migrate آن را برمی‌گرداند.
await pool.query("drop table school_content_progress");
let r = await list(a);
check("without school_content_progress the list 500s (the original bug)", r.status === 500, r.status);
const c0 = await call("POST", `/schools/${a.schoolId}/subjects`, { token: a.token, body: { name: "نمونه‌یِ ریشه" } });
check("…while create still succeeds (so the user saw 201 then an empty list)", c0.status === 201, c0.status);
const c1 = await call("POST", `/schools/${a.schoolId}/subjects`, { token: a.token, body: { name: "نمونه‌یِ ریشه" } });
check("…and re-create says 409 (matches the report)", c1.status === 409, c1.status);
execFileSync("node", ["migrate.mjs"], { env: process.env, stdio: "ignore" });
r = await list(a);
check("after migrate.mjs the list is 200 and shows the subject", r.status === 200 && r.json.some((x) => x.name === "نمونه‌یِ ریشه"), r.status);

// ۲) ساخت → بلافاصله برایِ admin/teacher/student دیده می‌شود
const n0 = (await list(a)).json.length;
const c = await call("POST", `/schools/${a.schoolId}/subjects`, { token: a.token, body: { name: "جبر و احتمال" } });
check("admin create 201", c.status === 201, c.text);
for (const [who, u] of [["admin", a], ["teacher", t], ["student", s]]) {
  const l = await list(u);
  check(`${who} sees it immediately`, l.status === 200 && l.json.length === n0 + 1 && l.json.some((x) => x.id === c.json.id), l.status);
}
check("teacher cannot create (403)", (await call("POST", `/schools/${a.schoolId}/subjects`, { token: t.token, body: { name: "ممنوع" } })).status === 403);
check("student cannot create (403)", (await call("POST", `/schools/${a.schoolId}/subjects`, { token: s.token, body: { name: "ممنوع" } })).status === 403);

// ۳) تکراری: پیامِ روشن + نامِ درسِ موجود؛ واریانتِ املایی/نیم‌فاصله هم همان‌را می‌گیرد
for (const nm of ["جبر و احتمال", " جبر  و احتمال ", "جبر‌و‌احتمال", "ادبيات فارسي", "ادبیات‌فارسی", "ریاضی"]) {
  const d = await call("POST", `/schools/${a.schoolId}/subjects`, { token: a.token, body: { name: nm } });
  check(`duplicate ${JSON.stringify(nm)} → 409 naming the existing subject`, d.status === 409 && d.json.code === "duplicate_name" && !!d.json.existing?.name && d.json.existing.schoolId === a.schoolId, d.text);
}
const seeded = (await list(a)).json.find((x) => x.name === "ریاضی");
const rn = await call("PATCH", `/schools/${a.schoolId}/subjects/${c.json.id}`, { token: a.token, body: { name: "ریاضی" } });
check("rename onto another subject → 409 with existing", rn.status === 409 && rn.json.existing?.id === seeded.id, rn.text);
const rn2 = await call("PATCH", `/schools/${a.schoolId}/subjects/${c.json.id}`, { token: a.token, body: { name: "جبر و احتمالِ ۲" } });
check("legit rename works", rn2.status === 200, rn2.text);

// ۴) نامِ درسِ حذف‌شده قابلِ استفاده‌یِ مجدد است (حتی نامِ یک پیش‌فرضِ حذف‌شده)؛ seed دوباره زنده‌اش نمی‌کند
const del = await call("DELETE", `/schools/${a.schoolId}/subjects/${seeded.id}`, { token: a.token });
check("delete seeded subject", del.status === 200, del.text);
check("deleted default is not resurrected by lazy seed", !(await list(a)).json.some((x) => x.name === "ریاضی"));
const re = await call("POST", `/schools/${a.schoolId}/subjects`, { token: a.token, body: { name: "ریاضی" } });
check("deleted name can be reused (201)", re.status === 201, re.text);
check("…and is listed once", (await list(s)).json.filter((x) => x.name === "ریاضی").length === 1);

// ۵) مدرسه‌یِ دیگر: همان نام آزاد است و دیده نمی‌شود/۴۰۹ نمی‌دهد
const other = await call("POST", `/schools/${b.schoolId}/subjects`, { token: b.token, body: { name: "جبر و احتمالِ ۲" } });
check("same name in another school is fine (201)", other.status === 201, other.text);
check("other school's admin can't read/create in school A", (await list(b, a.schoolId)).status === 403 && (await call("POST", `/schools/${a.schoolId}/subjects`, { token: b.token, body: { name: "x" } })).status === 403);
check("student can't read school B", (await list(s, b.schoolId)).status === 403);

// ۶) سوپرادمین بدونِ عضویت: هر مدرسه را مثلِ مدیرِ آن می‌بیند و می‌سازد
const sup = await newSuper();
const sc = await call("POST", `/schools/${b.schoolId}/subjects`, { token: sup.token, cookie: sup.cookie, body: { name: "ساخته‌یِ سوپر" } });
check("super-admin creates in school B", sc.status === 201, sc.text);
check("school B admin sees it", (await list(b, b.schoolId)).json.some((x) => x.name === "ساخته‌یِ سوپر"));
await done();
