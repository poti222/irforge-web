/** Shared setup for school-bot live suites: mock Telegram + real API + real Postgres. */
import crypto from "node:crypto";
import { call, pool, newSuper, newSchoolAdmin, joinSchool } from "./lib.mjs";
import { startMock } from "./mock-telegram.mjs";

export const TG_PORT = Number(process.env.TG_PORT ?? 4010);
export { call, pool, newSuper, newSchoolAdmin, joinSchool };
export const q = async (sql, p) => (await pool.query(sql, p)).rows;
export const mock = await startMock(TG_PORT).catch(async () => { throw new Error("mock port busy; run with TG_PORT free or reuse"); });

let tokSeq = 0;
export const fakeToken = () => `${7000000 + Math.floor(Math.random() * 900000) * 10 + (++tokSeq % 10)}:AA${crypto.randomBytes(12).toString("hex")}`;

/** super adds a pool token through the REAL endpoint (getMe goes to the mock). */
export async function addPoolToken(sup, token = fakeToken()) {
  const r = await call("POST", "/school-bot-pool", { token: sup.token, cookie: sup.cookie, body: { botToken: token } });
  if (r.status !== 201) throw new Error("pool add " + r.text);
  return { token, poolId: r.json.id };
}
/** Fresh school, funded wallet, purchased bot. Returns {admin, token, botId, username}. */
export async function schoolWithBot(sup, name = "مدرسه بات") {
  const admin = await newSchoolAdmin(name);
  // make sure THIS purchase claims our token: drain others is impossible, so add one and accept FIFO-ish; tests read the token back from the bot row.
  const { token } = await addPoolToken(sup);
  await pool.query("insert into school_wallets (school_id,balance) values ($1,100000000) on conflict (school_id) do update set balance=100000000", [admin.schoolId]).catch(async () => {
    await pool.query("update school_wallets set balance=100000000 where school_id=$1", [admin.schoolId]);
  });
  const r = await call("POST", `/schools/${admin.schoolId}/bot/purchase`, { token: admin.token });
  if (r.status !== 201) throw new Error("purchase " + r.text);
  const [row] = await q("select b.id, b.telegram_username from school_bots b where b.school_id=$1", [admin.schoolId]);
  admin.botId = row.id; admin.botUsername = row.telegram_username;
  return admin;
}
/** POST a simulated Telegram update to the school's webhook with a given secret header. */
export async function sendUpdate(botId, update, secret) {
  const r = await fetch(`${process.env.BASE ?? "http://localhost:3111"}/api/schools/bot-webhook/${botId}`, {
    method: "POST", headers: { "content-type": "application/json", ...(secret ? { "x-telegram-bot-api-secret-token": secret } : {}) }, body: JSON.stringify(update),
  });
  return r.status;
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Full school world: bot, class, teacher, 2 students (phones), parent linked to s1, subject, timetable today, assignment, exam, alert, announcement, attendance. */
export async function buildWorld(sup) {
  const A = await schoolWithBot(sup);
  const mkc = await call("POST", `/schools/${A.schoolId}/classes`, { token: A.token, body: { name: "10A", grade: "10", academicYear: "1404-1405" } });
  const cls = mkc.json;
  const add = (u, role) => call("POST", `/schools/${A.schoolId}/classes/${cls.id}/members`, { token: A.token, body: { schoolMemberId: u.memberId, roleInClass: role } });
  const T = await joinSchool(A, "teacher"), S1 = await joinSchool(A, "student"), S2 = await joinSchool(A, "student");
  const P = await joinSchool(A, "parent"), DEP = await joinSchool(A, "deputy"), CO = await joinSchool(A, "counselor");
  await add(T, "teacher"); await add(S1, "student"); await add(S2, "student");
  const ph = () => "0912" + String(Math.floor(1000000 + Math.random() * 8999999));
  for (const s of [S1, S2]) { s.phone = ph(); await pool.query("update users set phone=$1 where id=$2", ["+98" + s.phone.slice(1), s.id]); }
  await call("POST", `/schools/${A.schoolId}/guardianships`, { token: A.token, body: { parentUserId: P.id, studentMemberId: S1.memberId } });
  const dow = (new Date().getDay() + 1) % 7; // Saturday=0 as in the site's convention
  await call("PUT", `/schools/${A.schoolId}/timetable/classes/${cls.id}/days/${dow}`, { token: A.token, body: { slots: [{ startTime: "08:00", endTime: "09:10", subject: "ریاضی", teacherUserId: T.id }, { startTime: "09:30", endTime: "10:50", subject: "ورزش" }] } });
  const asg = await call("POST", `/schools/${A.schoolId}/assignments`, { token: T.token, body: { classId: cls.id, title: "تمرین فصل ۳", description: "صفحه ۱۰", dueDate: new Date(Date.now() + 3 * 864e5).toISOString() } });
  const q = await call("POST", `/schools/${A.schoolId}/questions`, { token: T.token, body: { questionText: "۲+۲؟", choices: ["۳", "۴"], correctAnswer: "۴" } });
  const ex = await call("POST", `/schools/${A.schoolId}/exams`, { token: T.token, body: { classId: cls.id, title: "آزمون میان‌ترم", questionIds: [q.json.id], scheduledAt: new Date(Date.now() + 5 * 864e5).toISOString(), durationMinutes: 30 } });
  const al = await call("POST", `/schools/${A.schoolId}/alerts`, { token: A.token, body: { studentMemberId: S1.memberId, severity: "warning", title: "اخطار تست", body: "متن اخطار" } });
  const an = await call("POST", `/schools/${A.schoolId}/announcements`, { token: A.token, body: { kind: "school", title: "اعلامیه تست", body: "همه بیایند" } });
  return { A, cls, T, S1, S2, P, DEP, CO, asg: asg.json, ex: ex.json, al: al.json, an: an.json, dow };
}
