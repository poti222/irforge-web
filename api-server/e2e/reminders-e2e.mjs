/**
 * e2e/reminders-e2e.mjs — «یادآورهایِ دانش‌آموزی»: روت‌هایِ واقعی روی Postgres واقعی + جاروبِ زمان‌بند با BotSender واقعی و تلگرامِ جعلی.
 * اجرا: DATABASE_URL=... node --import tsx/esm e2e/reminders-e2e.mjs   (بعد از migrate.mjs)
 */
import crypto from "crypto";
import http from "http";

process.env.DATABASE_URL ||= "postgres://postgres@localhost:5433/mm?host=/tmp";
process.env.NODE_ENV = "development";
process.env.SESSION_SECRET ||= "e2e";
process.env.BOT_TOKEN_ENCRYPTION_KEY ||= crypto.randomBytes(32).toString("hex");
process.env.TELEGRAM_API_BASE = "http://localhost:9997";
process.env.DISABLE_BACKGROUND_JOBS = "1";

const tgSent = [];
const tgStub = http.createServer((req, res) => {
  let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => {
    const method = req.url.split("/").pop(); let body = {}; try { body = JSON.parse(b || "{}"); } catch {}
    res.setHeader("content-type", "application/json");
    if (method === "sendMessage") {
      tgSent.push(body);
      if (String(body.chat_id) === "777") return res.end(JSON.stringify({ ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" }));
      if (String(body.chat_id) === "-101") return res.end(JSON.stringify({ ok: false, error_code: 403, description: "Forbidden: bot was kicked from the supergroup chat" }));
    }
    res.end(JSON.stringify({ ok: true, result: { message_id: tgSent.length, date: 0, chat: { id: body.chat_id ?? 1, type: "private" } } }));
  });
}).listen(9997);

const { db, usersTable, sessionsTable } = await import("@workspace/db");
const pg = (await import("pg")).default;
const dbPool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const { hashSessionToken } = await import("./../src/lib/sessionToken.ts");
const app = (await import("./../src/app.ts")).default;
const { runReminderSweep, runReminderSweepLocked } = await import("./../src/lib/schoolReminderScheduler.ts");
const server = app.listen(3068);
const BASE = "http://localhost:3068/api";
const q = (text, params) => dbPool.query(text, params);
const uid = () => crypto.randomUUID();

const mkUser = async (name) => {
  const id = uid(); const token = `${id}.${crypto.randomBytes(16).toString("hex")}`;
  await db.insert(usersTable).values({ id, name, email: `${name}-${id.slice(0, 6)}@e2e.test`, passwordHash: "x", role: "user", plan: "free", status: "active" });
  await db.insert(sessionsTable).values({ token: hashSessionToken(token), userId: id, expiresAt: new Date(Date.now() + 3600e3) });
  return { id, token, name };
};
const call = async (u, path, method = "GET", body) => {
  const r = await fetch(BASE + path, { method, headers: { "content-type": "application/json", ...(u ? { authorization: `Bearer ${u.token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
};
let pass = 0, fail = 0;
const check = (n, c, x = "") => { c ? (pass++, console.log("  ✓", n)) : (fail++, console.log("  ✗", n, x)); };
// «۰۶:۰۰ تهران» روزِ d  ⇒ UTC (تهران = UTC+3:30، بدونِ DST)
const tehran = (isoDate, hh, mm = 0) => new Date(Date.parse(`${isoDate}T00:00:00Z`) + (hh * 60 + mm - 210) * 60_000);
const sentTo = (chat) => tgSent.filter((m) => String(m.chat_id) === String(chat));

try {
  await q("TRUNCATE schools, school_bot_token_pool CASCADE");
  const admin = await mkUser("admin"), teacher = await mkUser("teacher"), teacher2 = await mkUser("teacher2"), outsider = await mkUser("outsider"), adminX = await mkUser("adminx");
  const rep = await mkUser("rep"), s2 = await mkUser("s2"), s3 = await mkUser("s3"), s4 = await mkUser("s4"), s5 = await mkUser("s5"), plain = await mkUser("plain"), xstu = await mkUser("xstu");
  const school = uid(), schoolX = uid(), c1 = uid(), c2 = uid();
  await q("INSERT INTO schools (id,name,created_by_user_id) VALUES ($1,'S',$2),($3,'SX',$2)", [school, admin.id, schoolX]);
  const mem = {}; const addMember = async (u, role, sid = school) => { const id = uid(); await q("INSERT INTO school_members (id,user_id,school_id,role,grade) VALUES ($1,$2,$3,$4,'9')", [id, u.id, sid, role]); mem[u.id] = id; };
  await addMember(admin, "admin"); await addMember(teacher, "teacher"); await addMember(teacher2, "teacher"); await addMember(adminX, "admin", schoolX);
  for (const s of [rep, s2, s3, s4, s5, plain, xstu]) await addMember(s, "student");
  await q("INSERT INTO school_classes (id,school_id,name) VALUES ($1,$2,'هفتم الف'),($3,$2,'هشتم ب')", [c1, school, c2]);
  const cm = (classId, u, role) => q("INSERT INTO school_class_members (id,class_id,school_member_id,role_in_class) VALUES ($1,$2,$3,$4)", [uid(), classId, mem[u.id], role]);
  await cm(c1, teacher, "teacher"); await cm(c2, teacher2, "teacher");
  for (const s of [rep, s2, s3, s4, s5, plain]) await cm(c1, s, "student");
  await cm(c2, xstu, "student");
  await q("INSERT INTO school_class_reps (id,school_id,class_id,student_member_id,teacher_user_id) VALUES ($1,$2,$3,$4,$5)", [uid(), school, c1, mem[rep.id], teacher.id]);
  const pool = uid(), bot = uid();
  await q("INSERT INTO school_bot_token_pool (id, bot_token) VALUES ($1,'x')", [pool]);
  await q("INSERT INTO school_bots (id,school_id,bot_token_pool_id) VALUES ($1,$2,$3)", [bot, school, pool]);
  const sub = (u, chat, unreachable = false) => q("INSERT INTO school_bot_subscribers (id,school_bot_id,user_id,telegram_chat_id,unreachable_at) VALUES ($1,$2,$3,$4,$5)", [uid(), bot, u.id, chat, unreachable ? new Date() : null]);
  await sub(rep, "101"); await sub(s2, "102"); await sub(s4, "104", true); await sub(s5, "777"); await sub(xstu, "199"); await sub(teacher, "900");
  const g1 = uid(), g2 = uid();
  await q("INSERT INTO school_bot_groups (id,school_bot_id,telegram_chat_id,title,chat_type,bot_status,can_post) VALUES ($1,$2,'-100','گروه هفتم','supergroup','administrator',true),($3,$2,'-101','گروه بسته','group','member',true)", [g1, bot, g2]);
  const S = `/schools/${school}/reminders`;

  console.log("Access");
  let r = await call(admin, S);
  check("admin: role=admin, canSchoolWide, sees both classes + groups + limits", r.status === 200 && r.body.role === "admin" && r.body.canSchoolWide === true && r.body.classes.length === 2 && r.body.groups.length === 2 && r.body.limits.maxPerClass === 40, JSON.stringify(r).slice(0, 300));
  r = await call(teacher, S);
  check("teacher: only own class, cannot do school-wide", r.status === 200 && r.body.role === "teacher" && r.body.canSchoolWide === false && r.body.classes.length === 1 && r.body.classes[0].id === c1);
  r = await call(rep, S);
  check("rep (elected student): role=rep, only own class", r.status === 200 && r.body.role === "rep" && r.body.classes.length === 1 && r.body.classes[0].id === c1);
  check("teacher of another class sees only own class", (await call(teacher2, S)).body.classes.map((c) => c.id).join() === c2);
  check("plain student ⇒ 403", (await call(plain, S)).status === 403);
  check("outsider ⇒ 403", (await call(outsider, S)).status === 403);
  check("admin of ANOTHER school ⇒ 403", (await call(adminX, S)).status === 403);
  check("unauthenticated ⇒ 401", (await call(null, S)).status === 401);

  console.log("Validation");
  const bad = async (body, rx) => { const x = await call(teacher, S, "POST", { classId: c1, ...body }); return x.status === 400 && rx.test(JSON.stringify(x.body)); };
  check("empty message", await bad({ message: "", weekdays: [0], times: ["06:00"] }, /متنِ پیام/));
  check("no weekdays", await bad({ message: "x", weekdays: [], times: ["06:00"] }, /روزِ هفته/));
  check("no times / bad time / too close", (await bad({ message: "x", weekdays: [0], times: [] }, /ساعت/)) && (await bad({ message: "x", weekdays: [0], times: ["25:00"] }, /HH:MM/)) && (await bad({ message: "x", weekdays: [0], times: ["06:00", "06:02"] }, /فاصله/)));
  check("end before start", await bad({ message: "x", weekdays: [0], times: ["06:00"], startDate: "2026-10-10", endDate: "2026-10-01" }, /پایان/));

  console.log("Create (the three examples from the brief)");
  // ۱) هر روز به‌جز پنجشنبه و جمعه، ساعت ۰۶:۰۰ و ۰۸:۰۰
  r = await call(teacher, S, "POST", { classId: c1, message: "خودکار بزن", title: "ورزش صبحگاهی", weekdays: [0, 1, 2, 3, 4], times: ["06:00", "08:00"], groupIds: [g1] });
  check("teacher creates «every day except Thu+Fri 06:00 & 08:00» ⇒ 201", r.status === 201 && r.body.reminder.scheduleText === "هر روز به‌جز پنجشنبه و جمعه — ساعت ۰۶:۰۰ و ۰۸:۰۰" && r.body.reminder.createdByRole === "teacher" && r.body.reminder.groupIds[0] === g1 && r.body.reminder.nextRuns.length === 3, JSON.stringify(r).slice(0, 400));
  const R1 = r.body.reminder.id;
  // ۲) هر شب ۲۱:۰۰ گزارش کار — ساخته‌شده توسطِ دانش‌آموزِ منتخب
  r = await call(rep, S, "POST", { classId: c1, message: "گزارشِ کار بفرست", weekdays: [0, 1, 2, 3, 4, 5, 6], times: ["21:00"] });
  check("rep creates «every day 21:00» ⇒ 201, createdByRole=rep", r.status === 201 && r.body.reminder.createdByRole === "rep" && r.body.reminder.scheduleText.startsWith("هر روز —"), JSON.stringify(r).slice(0, 300));
  const R2 = r.body.reminder.id;
  // ۳) هر جمعه ۴ بار — با <> در متن (باید escape شود)
  r = await call(admin, S, "POST", { classId: c1, message: "امتحان <b>بده</b> & برو", weekdays: [6], times: ["09:00", "12:00", "16:00", "20:00"] });
  check("admin creates «Fridays ×4» ⇒ 201", r.status === 201 && r.body.reminder.scheduleText === "هر جمعه — ساعت ۰۹:۰۰، ۱۲:۰۰، ۱۶:۰۰ و ۲۰:۰۰", JSON.stringify(r).slice(0, 300));
  const R3 = r.body.reminder.id;
  check("teacher cannot create for ANOTHER class ⇒ 403", (await call(teacher, S, "POST", { classId: c2, message: "x", weekdays: [0], times: ["06:00"] })).status === 403);
  check("rep cannot create a school-wide reminder ⇒ 403", (await call(rep, S, "POST", { classId: null, message: "x", weekdays: [0], times: ["06:00"] })).status === 403);
  check("teacher cannot create school-wide ⇒ 403", (await call(teacher, S, "POST", { message: "x", weekdays: [0], times: ["06:00"] })).status === 403);
  r = await call(admin, S, "POST", { classId: null, message: "اطلاعیهٔ کلِ مدرسه", weekdays: [0], times: ["07:00"], sendDm: true });
  check("admin creates a school-wide reminder ⇒ 201 (className null)", r.status === 201 && r.body.reminder.classId === null && r.body.reminder.className === null);
  const RW = r.body.reminder.id;
  check("a group of ANOTHER bot/school is ignored (no 500)", (await call(teacher, S, "POST", { classId: c1, message: "g", weekdays: [0], times: ["10:00"], groupIds: [uid()] })).status === 201);

  console.log("Edit by the three roles");
  r = await call(rep, `${S}/${R1}`, "PATCH", { times: ["06:30", "08:30"], weekdays: [0, 1, 2, 3, 4, 5] });
  check("rep (top student) edits the TEACHER's reminder ⇒ 200 + new schedule text", r.status === 200 && r.body.reminder.scheduleText === "هر روز به‌جز جمعه — ساعت ۰۶:۳۰ و ۰۸:۳۰", JSON.stringify(r).slice(0, 300));
  r = await call(teacher, `${S}/${R2}`, "PATCH", { message: "گزارشِ کار را بفرستید 📝", active: false });
  check("teacher edits the rep's reminder + pauses it", r.status === 200 && r.body.reminder.active === false && r.body.reminder.nextRuns.length === 0);
  check("admin re-enables it", (await call(admin, `${S}/${R2}`, "PATCH", { active: true })).body.reminder.active === true);
  check("teacher of ANOTHER class cannot edit ⇒ 403", (await call(teacher2, `${S}/${R1}`, "PATCH", { active: false })).status === 403);
  check("unknown id ⇒ 404", (await call(admin, `${S}/${uid()}`, "PATCH", { active: false })).status === 404);
  check("empty patch ⇒ 400", (await call(admin, `${S}/${R1}`, "PATCH", {})).status === 400);
  check("invalid patch ⇒ 400 (weekdays [])", (await call(admin, `${S}/${R1}`, "PATCH", { weekdays: [] })).status === 400);
  await call(admin, `${S}/${R1}`, "PATCH", { times: ["06:00", "08:00"], weekdays: [0, 1, 2, 3, 4] }); // برگردان به حالتِ اصلی برای ادامه

  console.log("Recipients");
  r = await call(rep, `${S}/recipients?classId=${c1}`);
  check("class c1: 6 students, 2 connected (s4 unreachable, s5 blocked-later is 'connected' now, rep+s2+s5 = 3)", r.status === 200 && r.body.students === 6 && r.body.connected === 3, JSON.stringify(r.body));
  check("rep asking about another class ⇒ 403", (await call(rep, `${S}/recipients?classId=${c2}`)).status === 403);

  console.log("Scheduler");
  const SUN = "2026-10-25", THU = "2026-10-29", FRI = "2026-10-30"; // یکشنبه / پنجشنبه / جمعه
  tgSent.length = 0;
  let rep1 = await runReminderSweep(tehran(SUN, 6, 0));
  const at06 = tgSent.filter((m) => /خودکار بزن/.test(m.text));
  check("Sunday 06:00 ⇒ R1 reaches rep+s2 DMs (not s4-unreachable, not s3-unlinked) + group g1 (+ s5 blocked)", ["101", "102", "-100", "777"].every((c) => at06.some((m) => String(m.chat_id) === c)) && !at06.some((m) => ["103", "104"].includes(String(m.chat_id))), JSON.stringify(at06.map((m) => m.chat_id)));
  check("report counts: sent=3 (101,102,-100), blocked=1 (777)", rep1.sent === 3 && rep1.blocked === 1 && rep1.remindersFired === 1, JSON.stringify(rep1));
  check("message is HTML with class name and header", at06[0].parse_mode === "HTML" && /🔔 <b>یادآوری<\/b> — هفتم الف/.test(at06[0].text));
  const before = tgSent.length;
  const rep1b = await runReminderSweep(tehran(SUN, 6, 1));
  const rep1c = await runReminderSweep(tehran(SUN, 6, 20)); // هنوز در پنجرهٔ جبران
  check("re-running the sweep (same slot, even 20 min later) sends NOTHING again (idempotent)", tgSent.length === before && rep1b.sent === 0 && rep1c.sent === 0);
  const rep2 = await runReminderSweep(tehran(SUN, 8, 2));
  check("08:00 slot fires (2nd time of the day) for the same targets", tgSent.slice(before).filter((m) => /خودکار بزن/.test(m.text)).length >= 3 && rep2.sent === 3, JSON.stringify(rep2));
  const blockedAgain = tgSent.filter((m) => String(m.chat_id) === "777").length;
  check("blocked user is marked unreachable and not retried", (await q("SELECT unreachable_at FROM school_bot_subscribers WHERE telegram_chat_id='777'")).rows[0].unreachable_at !== null && blockedAgain === 1);
  const n21 = tgSent.length;
  await runReminderSweep(tehran(SUN, 21, 0));
  const at21 = tgSent.slice(n21);
  check("21:00 ⇒ R2 (rep's «گزارشِ کار») goes to rep+s2 only (s5 now unreachable)", at21.length === 2 && at21.every((m) => /گزارشِ کار را بفرستید/.test(m.text)), JSON.stringify(at21.map((m) => [m.chat_id])));
  check("no school-wide reminder at 07:00 Sunday? (Saturday-only ⇒ nothing on Sunday)", !tgSent.some((m) => /اطلاعیهٔ کلِ مدرسه/.test(m.text)));
  // پنجشنبه: R1 (به‌جز پنجشنبه/جمعه) نباید برود
  const nThu = tgSent.length;
  await runReminderSweep(tehran(THU, 6, 0)); await runReminderSweep(tehran(THU, 8, 0));
  check("Thursday: R1 does NOT fire (excluded day)", !tgSent.slice(nThu).some((m) => /خودکار بزن/.test(m.text)));
  // جمعه: ۴ بار R3 (و R2 در ۲۱)
  const nFri = tgSent.length;
  for (const [h, m] of [[9, 0], [12, 0], [16, 0], [20, 0]]) await runReminderSweep(tehran(FRI, h, m));
  const fri = tgSent.slice(nFri).filter((m) => /امتحان/.test(m.text));
  check("Friday: R3 fires 4 times × (rep, s2) = 8 DMs (no group selected), HTML escaped", fri.length === 8 && fri.every((m) => m.text.includes("&lt;b&gt;بده&lt;/b&gt; &amp; برو") && !m.text.includes("<b>بده")), String(fri.length));
  // پنجرهٔ جبران: سرور ساعت ۰۹:۵۰ آمد؛ ساعتِ ۰۹:۰۰ قدیمی‌تر از ۴۵ دقیقه است و دیگر نمی‌رود
  await q("DELETE FROM school_reminder_log"); // ← شبیه‌سازیِ «هیچ‌چیز تا حالا نرفته»
  const nLate = tgSent.length;
  await runReminderSweep(tehran(FRI, 9, 50));
  check("server down until 09:50 ⇒ the 09:00 slot is NOT sent late (outside the 45-min window)", tgSent.length === nLate);
  await runReminderSweep(tehran(FRI, 9, 40));
  check("…but at 09:40 (inside the window) it IS sent", tgSent.length > nLate);
  // Saturday school-wide (dow 0): ۲۰۲۶-۱۰-۳۱
  const nSat = tgSent.length;
  await runReminderSweep(tehran("2026-10-31", 7, 0));
  const sat = tgSent.slice(nSat).filter((m) => /اطلاعیهٔ کلِ مدرسه/.test(m.text));
  check("Saturday 07:00: school-wide reminder reaches all connected students of the school (rep, s2, xstu of class 2)", ["101", "102", "199"].every((c) => sat.some((m) => String(m.chat_id) === c)) && !sat.some((m) => String(m.chat_id) === "900"), JSON.stringify(sat.map((m) => m.chat_id)));
  check("school-wide message has no class name", /🔔 <b>یادآوری<\/b>\n/.test(sat[0].text));

  console.log("Pause / range / skip dates");
  await call(admin, `${S}/${R3}`, "PATCH", { active: false });
  const nP = tgSent.length; await runReminderSweep(tehran("2026-11-06", 9, 0));
  check("paused reminder does not fire (Friday 2026-11-06)", !tgSent.slice(nP).some((m) => /امتحان/.test(m.text)));
  await call(admin, `${S}/${R3}`, "PATCH", { active: true, skipDates: ["2026-11-06"] });
  const nS = tgSent.length; await runReminderSweep(tehran("2026-11-06", 9, 0));
  check("skip date honoured", !tgSent.slice(nS).some((m) => /امتحان/.test(m.text)));
  await call(admin, `${S}/${R3}`, "PATCH", { skipDates: [], endDate: "2026-11-05" });
  const nE = tgSent.length; await runReminderSweep(tehran("2026-11-06", 9, 0));
  check("end date honoured (after endDate nothing)", !tgSent.slice(nE).some((m) => /امتحان/.test(m.text)));

  console.log("Failure handling");
  await q("DELETE FROM school_reminder_log"); tgSent.length = 0;
  await call(admin, `${S}/${R3}`, "PATCH", { endDate: null });
  await call(teacher, S, "POST", { classId: c1, message: "گروهِ بسته", weekdays: [0, 1, 2, 3, 4, 5, 6], times: ["10:00"], sendDm: false, groupIds: [g2] });
  const rep3 = await runReminderSweep(tehran("2026-11-07", 10, 0));
  check("group send rejected (bot kicked) ⇒ group.can_post=false + creator warned in DM", (await q("SELECT can_post FROM school_bot_groups WHERE id=$1", [g2])).rows[0].can_post === false && tgSent.some((m) => String(m.chat_id) === "900" && /نتوانستم در گروهِ/.test(m.text)), JSON.stringify(rep3));
  const nG = tgSent.length; await runReminderSweep(tehran("2026-11-07", 10, 5));
  check("…and it is not retried", !tgSent.slice(nG).some((m) => /گروهِ بسته/.test(m.text)));
  process.env.SCHOOL_REMINDERS_ENABLED = "0";
  check("SCHOOL_REMINDERS_ENABLED=0 ⇒ disabled", (await runReminderSweep(tehran("2026-11-07", 10, 6))).skipped === "disabled");
  delete process.env.SCHOOL_REMINDERS_ENABLED;
  const lockedA = await runReminderSweepLocked(dbPool, tehran("2026-11-07", 10, 7));
  const hold = await dbPool.connect(); await hold.query("SELECT pg_advisory_lock(hashtextextended('school_reminder_scheduler', 0))");
  const lockedB = await runReminderSweepLocked(dbPool, tehran("2026-11-07", 10, 8));
  await hold.query("SELECT pg_advisory_unlock(hashtextextended('school_reminder_scheduler', 0))"); hold.release();
  check("advisory lock: second instance skips while the first holds it", !lockedA.skipped && lockedB.skipped === "lock_held");

  console.log("Test-send, audit, limits, delete");
  tgSent.length = 0;
  r = await call(teacher, `${S}/${R1}/test`, "POST");
  check("test-send goes only to the caller's own DM, marked as sample", r.status === 200 && tgSent.length === 1 && String(tgSent[0].chat_id) === "900" && /🧪/.test(tgSent[0].text));
  check("test-send is rate limited (429)", (await call(teacher, `${S}/${R1}/test`, "POST")).status === 429);
  check("test-send for a user not linked to the bot ⇒ 409", (await call(admin, `${S}/${R1}/test`, "POST")).status === 409);
  const aud = (await q("SELECT action FROM school_audit_log WHERE school_id=$1", [school])).rows.map((x) => x.action);
  check("audit log has create/update entries", aud.includes("reminder.create") && aud.includes("reminder.update"));
  for (let i = 0; i < 40; i++) await q("INSERT INTO school_reminders (id,school_id,class_id,message,weekdays,times,created_by_user_id,created_by_role) VALUES ($1,$2,$3,'fill','{0}','{06:00}',$4,'admin') ON CONFLICT DO NOTHING", [uid(), school, c2, admin.id]);
  check("class cap (40) ⇒ 409", (await call(admin, S, "POST", { classId: c2, message: "x", weekdays: [0], times: ["06:00"] })).status === 409);
  check("rep deletes the teacher's reminder ⇒ 200 and it is gone (cascade log)", (await call(rep, `${S}/${R1}`, "DELETE")).status === 200 && (await q("SELECT 1 FROM school_reminders WHERE id=$1", [R1])).rowCount === 0 && (await q("SELECT 1 FROM school_reminder_log WHERE reminder_id=$1", [R1])).rowCount === 0);
  check("teacher2 cannot delete c1's reminder ⇒ 403", (await call(teacher2, `${S}/${R2}`, "DELETE")).status === 403);
} catch (err) {
  console.error("E2E CRASH", err); fail++;
} finally {
  console.log(`\n${pass} passed, ${fail} failed`);
  server.close(); tgStub.close(); await dbPool.end();
  process.exit(fail ? 1 : 0);
}
