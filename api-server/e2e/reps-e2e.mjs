/**
 * e2e/reps-e2e.mjs — «دانش‌آموزِ منتخب»: روت‌های واقعیِ API روی Postgres واقعی + بررسیِ هم‌شکلی با تایپ‌های فرانت.
 * اجرا: DATABASE_URL=... node --import tsx/esm e2e/reps-e2e.mjs   (بعد از migrate.mjs)
 */
import crypto from "crypto";
import http from "http";

process.env.DATABASE_URL ||= "postgres://postgres@localhost:5433/mm?host=/tmp";
process.env.NODE_ENV = "development";
process.env.SESSION_SECRET ||= "e2e";
process.env.BOT_TOKEN_ENCRYPTION_KEY ||= crypto.randomBytes(32).toString("hex");
process.env.TELEGRAM_API_BASE = "http://localhost:9998";
// تلگرامِ جعلی: همه‌ی پیام‌های خروجی ثبت می‌شود
const tgSent = [];
const tgStub = http.createServer((req, res) => {
  let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => {
    const method = req.url.split("/").pop(); let body = {}; try { body = JSON.parse(b || "{}"); } catch {}
    if (method === "sendMessage" || method === "editMessageText") tgSent.push({ ...body, _method: method });
    res.setHeader("content-type", "application/json");
    if (method === "getChatMember") return res.end(JSON.stringify({ ok: true, result: { status: "member", user: { id: Number(body.user_id) } } }));
    res.end(JSON.stringify({ ok: true, result: { message_id: tgSent.length, date: 0, chat: { id: body.chat_id ?? 1, type: "private" } } }));
  });
}).listen(9998);

const { db, usersTable, sessionsTable } = await import("@workspace/db");
const pg = (await import("pg")).default;
const dbPool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const { hashSessionToken } = await import("./../src/lib/sessionToken.ts");
const app = (await import("./../src/app.ts")).default;
const server = app.listen(3067);
const BASE = "http://localhost:3067/api";
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
const hasKeys = (o, keys) => keys.every((k) => k in o);

try {
  // ── seed ────────────────────────────────────────────────────────────────
  // ایزولاسیون: مدرسه‌هایِ اجراهای قبلی نباید در شمارشِ sweep (promptsSent و …) بیایند.
  await q("TRUNCATE schools, school_bot_token_pool CASCADE");
  const admin = await mkUser("admin"), teacher = await mkUser("teacher"), teacher2 = await mkUser("teacher2"), outsider = await mkUser("outsider"), adminX = await mkUser("adminx");
  const students = []; for (let i = 1; i <= 7; i++) students.push(await mkUser(`stu${i}`));
  const school = uid(), schoolX = uid(), cls = uid(), cls2 = uid(), clsX = uid();
  await q("INSERT INTO schools (id,name,created_by_user_id) VALUES ($1,'S',$2),($3,'SX',$2)", [school, admin.id, schoolX]);
  const mem = {}; const addMember = async (u, role, sid = school, grade = null) => { const id = uid(); await q("INSERT INTO school_members (id,user_id,school_id,role,grade) VALUES ($1,$2,$3,$4,$5)", [id, u.id, sid, role, grade]); mem[u.id] = id; return id; };
  await addMember(admin, "admin"); await addMember(teacher, "teacher"); await addMember(teacher2, "teacher"); await addMember(adminX, "admin", schoolX);
  for (const s of students) await addMember(s, "student", school, "9");
  await q("INSERT INTO school_classes (id,school_id,name) VALUES ($1,$2,'کلاس ۹ الف'),($3,$2,'کلاس ۹ ب'),($4,$5,'X')", [cls, school, cls2, clsX, schoolX]);
  const cm = async (classId, u, role) => q("INSERT INTO school_class_members (id,class_id,school_member_id,role_in_class) VALUES ($1,$2,$3,$4)", [uid(), classId, mem[u.id], role]);
  await cm(cls, teacher, "teacher"); await cm(cls2, teacher2, "teacher");
  for (const s of students) await cm(cls, s, "student");
  await cm(cls2, students[0], "student");
  // بات + مشترک + گروه‌ها
  const pool = uid(), bot = uid();
  await q("INSERT INTO school_bot_token_pool (id, bot_token) VALUES ($1,'x')", [pool]);
  await q("INSERT INTO school_bots (id,school_id,bot_token_pool_id) VALUES ($1,$2,$3)", [bot, school, pool]);
  await q("INSERT INTO school_bot_subscribers (id,school_bot_id,user_id,telegram_chat_id) VALUES ($1,$2,$3,'555')", [uid(), bot, students[0].id]);
  const g1 = uid(), g2 = uid();
  await q("INSERT INTO school_bot_groups (id,school_bot_id,telegram_chat_id,title,chat_type,bot_status,can_post) VALUES ($1,$2,'-100',  'گروه کلاس','supergroup','admin',true),($3,$2,'-101','گروه قدیمی','group','left',false)", [g1, bot, g2]);
  // یک تکلیف ثبت‌شده توسط منتخب (برای لیست/لغو)
  const item = uid(); const due = new Date(Date.now() + 5 * 86400e3).toISOString().slice(0, 10);
  await q("INSERT INTO school_rep_items (id,school_id,class_id,created_by_member_id,created_by_user_id,kind,title,due_date,remind_days) VALUES ($1,$2,$3,$4,$5,'assignment','ریاضی فصل ۳',$6,'{3,1}')", [item, school, cls, mem[students[0].id], students[0].id, due]);
  await q("INSERT INTO school_rep_item_groups (item_id,group_id) VALUES ($1,$2)", [item, g1]);

  const S = `/schools/${school}`;
  console.log("Candidates");
  let r = await call(teacher, `${S}/classes/${cls}/rep-candidates`);
  check("teacher of the class lists candidates (shape matches the frontend RepCandidatesResponse)", r.status === 200 && hasKeys(r.body, ["botActive", "maxPerTeacher", "students"]) && r.body.students.length === 7 && hasKeys(r.body.students[0], ["memberId", "userId", "name", "grade", "repId", "repCount", "botLinked"]), JSON.stringify(r).slice(0, 300));
  check("botActive=true, maxPerTeacher=5, only the subscribed student is botLinked", r.body.botActive === true && r.body.maxPerTeacher === 5 && r.body.students.filter((s) => s.botLinked).length === 1);
  check("teacher of ANOTHER class ⇒ 403", (await call(teacher2, `${S}/classes/${cls}/rep-candidates`)).status === 403);
  check("student / outsider ⇒ 403", [(await call(students[1], `${S}/classes/${cls}/rep-candidates`)).status, (await call(outsider, `${S}/classes/${cls}/rep-candidates`)).status].every((s) => s === 403));
  check("admin of the school sees any class", (await call(admin, `${S}/classes/${cls2}/rep-candidates`)).status === 200);
  check("class of another school ⇒ 404 (boundary)", (await call(admin, `${S}/classes/${clsX}/rep-candidates`)).status === 404);
  check("admin of ANOTHER school ⇒ 403", (await call(adminX, `${S}/classes/${cls}/rep-candidates`)).status === 403);
  check("unauthenticated ⇒ 401", (await call(null, `${S}/classes/${cls}/rep-candidates`)).status === 401);

  console.log("Elect / remove");
  r = await call(teacher, `${S}/classes/${cls}/reps`, "POST", { studentMemberId: mem[students[0].id] });
  check("elect ⇒ 201 + id", r.status === 201 && typeof r.body.id === "string", JSON.stringify(r));
  const repId = r.body.id;
  check("electing the same student again ⇒ 409", (await call(teacher, `${S}/classes/${cls}/reps`, "POST", { studentMemberId: mem[students[0].id] })).status === 409);
  check("electing a non-member / teacher id ⇒ 400", (await call(teacher, `${S}/classes/${cls}/reps`, "POST", { studentMemberId: mem[teacher2.id] })).status === 400);
  check("missing studentMemberId ⇒ 400", (await call(teacher, `${S}/classes/${cls}/reps`, "POST", {})).status === 400);
  check("student from another class (cls2 only) cannot be elected in cls", (await call(teacher, `${S}/classes/${cls}/reps`, "POST", { studentMemberId: mem[teacher.id] })).status === 400);
  for (let i = 1; i < 5; i++) await call(teacher, `${S}/classes/${cls}/reps`, "POST", { studentMemberId: mem[students[i].id] });
  r = await call(teacher, `${S}/classes/${cls}/reps`, "POST", { studentMemberId: mem[students[5].id] });
  check("6th rep for the same teacher+class ⇒ 400 (cap 5)", r.status === 400, JSON.stringify(r));
  r = await call(teacher, `${S}/classes/${cls}/rep-candidates`);
  check("candidates now show 5 elected with repId", r.body.students.filter((s) => s.repId).length === 5);
  check("a second teacher (admin acting) can also elect the same student (repCount=2)", (await call(admin, `${S}/classes/${cls}/reps`, "POST", { studentMemberId: mem[students[0].id] })).status === 201 && (await call(teacher, `${S}/classes/${cls}/rep-candidates`)).body.students.find((s) => s.memberId === mem[students[0].id]).repCount === 2);

  console.log("Lists");
  r = await call(teacher, `${S}/reps`);
  check("GET /reps (shape matches SchoolRep) + mine flag", r.status === 200 && r.body.length >= 5 && hasKeys(r.body[0], ["id", "classId", "className", "studentMemberId", "studentName", "teacherUserId", "teacherName", "mine", "createdAt"]) && r.body.some((x) => x.mine), JSON.stringify(r.body[0]));
  check("teacher2 (other class) sees no reps of cls", (await call(teacher2, `${S}/reps`)).body.every((x) => x.classId !== cls));
  r = await call(teacher, `${S}/rep-items`);
  check("rep-items lists the active item (shape matches RepItem) with group titles", r.status === 200 && r.body.length === 1 && hasKeys(r.body[0], ["id", "classId", "className", "kind", "title", "dueDate", "remindDays", "status", "createdAt", "createdByName", "groups"]) && r.body[0].groups[0] === "گروه کلاس" && r.body[0].remindDays.join() === "3,1", JSON.stringify(r.body));
  check("rep-items filtered to another class ⇒ empty for this teacher", (await call(teacher, `${S}/rep-items?classId=${cls2}`)).body.length === 0);
  r = await call(teacher, `${S}/bot-groups`);
  check("bot-groups: active group listed, 'left' group hidden, no chat_id leaked", r.status === 200 && r.body.groups.length === 1 && r.body.groups[0].title === "گروه کلاس" && !JSON.stringify(r.body).includes("-100"), JSON.stringify(r.body));
  check("bot-groups for a student ⇒ 403", (await call(students[1], `${S}/bot-groups`)).status === 403);

  console.log("Cancel / remove");
  check("PATCH with anything but cancelled ⇒ 400", (await call(teacher, `${S}/rep-items/${item}`, "PATCH", { status: "done" })).status === 400);
  check("teacher2 cannot cancel an item of another class ⇒ 403", (await call(teacher2, `${S}/rep-items/${item}`, "PATCH", { status: "cancelled" })).status === 403);
  check("teacher cancels the item ⇒ 200", (await call(teacher, `${S}/rep-items/${item}`, "PATCH", { status: "cancelled" })).status === 200);
  check("cancelled item leaves the active list", (await call(teacher, `${S}/rep-items`)).body.length === 0 && (await call(teacher, `${S}/rep-items?status=cancelled`)).body.length === 1);
  // ردیفِ منتخبِ ثبت‌شده توسطِ ادمین (معلمِ دیگر) را از دیدِ ادمین پیدا می‌کنیم؛ معلمِ ساده نباید بتواند آن را بردارد.
  const adminRep = (await call(admin, `${S}/reps`)).body.find((x) => x.teacherUserId === admin.id);
  check("DELETE a rep elected by someone else as a plain teacher ⇒ 403", adminRep && (await call(teacher, `${S}/reps/${adminRep.id}`, "DELETE")).status === 403, JSON.stringify(adminRep));
  r = await call(teacher, `${S}/reps/${repId}`, "DELETE");
  check("teacher removes own rep ⇒ 200", r.status === 200 && r.body.ok === true, JSON.stringify(r));
  check("removing again ⇒ 404", (await call(teacher, `${S}/reps/${repId}`, "DELETE")).status === 404);
  check("rep id from another school ⇒ 404", (await call(adminX, `/schools/${schoolX}/reps/${repId}`, "DELETE")).status === 404);
  // cancelItems: ثبت یک مورد فعال جدید برای منتخبی که فقط یک معلم دارد
  const only = students[3]; const it2 = uid();
  await q("INSERT INTO school_rep_items (id,school_id,class_id,created_by_member_id,created_by_user_id,kind,title,due_date,remind_days) VALUES ($1,$2,$3,$4,$5,'exam','آزمون',$6,'{1}')", [it2, school, cls, mem[only.id], only.id, due]);
  const onlyRep = (await call(teacher, `${S}/reps`)).body.find((x) => x.studentMemberId === mem[only.id]);
  r = await call(teacher, `${S}/reps/${onlyRep.id}?cancelItems=true`, "DELETE");
  check("DELETE ?cancelItems=true cancels that student's active items", r.status === 200 && r.body.cancelledItems === 1, JSON.stringify(r));

  console.log("Scheduler (reminders / prompts / expiry) with a fake Telegram");
  const { runSchoolRepSweep } = await import("./../src/lib/schoolRepScheduler.ts");
  const sch = uid(), cl = uid(), pool2 = uid(), bot2 = uid(), grp = uid();
  const tch = await mkUser("sweep_teacher"), rep = await mkUser("sweep_rep");
  await q("INSERT INTO schools (id,name,created_by_user_id) VALUES ($1,'SW',$2)", [sch, tch.id]);
  const m2 = {}; for (const [u, role] of [[tch, "teacher"], [rep, "student"]]) { const id = uid(); await q("INSERT INTO school_members (id,user_id,school_id,role,grade) VALUES ($1,$2,$3,$4,'9')", [id, u.id, sch, role]); m2[u.id] = id; }
  await q("INSERT INTO school_classes (id,school_id,name) VALUES ($1,$2,'ششم ب')", [cl, sch]);
  await q("INSERT INTO school_class_members (id,class_id,school_member_id,role_in_class) VALUES ($1,$2,$3,'teacher'),($4,$2,$5,'student')", [uid(), cl, m2[tch.id], uid(), m2[rep.id]]);
  await q("INSERT INTO school_bot_token_pool (id, bot_token) VALUES ($1,'111:SWEEP')", [pool2]);
  await q("INSERT INTO school_bots (id,school_id,bot_token_pool_id) VALUES ($1,$2,$3)", [bot2, sch, pool2]);
  await q("INSERT INTO school_bot_subscribers (id,school_bot_id,user_id,telegram_chat_id) VALUES ($1,$2,$3,'777')", [uid(), bot2, rep.id]);
  await q("INSERT INTO school_bot_groups (id,school_bot_id,telegram_chat_id,title,chat_type,bot_status,can_post) VALUES ($1,$2,'-200','گروه ششم','supergroup','administrator',true)", [grp, bot2]);
  await q("INSERT INTO school_class_reps (id,school_id,class_id,student_member_id,teacher_user_id) VALUES ($1,$2,$3,$4,$5)", [uid(), sch, cl, m2[rep.id], tch.id]);
  const mkItem = async (kind, title, due, remind, group) => { const id = uid(); await q("INSERT INTO school_rep_items (id,school_id,class_id,created_by_member_id,created_by_user_id,kind,title,due_date,remind_days) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [id, sch, cl, m2[rep.id], rep.id, kind, title, due, remind]); if (group) await q("INSERT INTO school_rep_item_groups (item_id,group_id) VALUES ($1,$2)", [id, group]); return id; };
  // «امروز» = چهارشنبه ۱۴ اکتبر ۲۰۲۶ (به وقتِ تهران)
  const NOW_REMIND = new Date("2026-10-14T12:30:00Z");   // ۱۶:۰۰ تهران
  const NOW_PROMPT = new Date("2026-10-14T15:30:00Z");   // ۱۹:۰۰ تهران
  const inGroup = await mkItem("exam", "آزمونِ فیزیک", "2026-10-17", [3, 1], grp);   // ۳ روز مانده ⇒ باید یادآوری برود
  const noGroup = await mkItem("assignment", "تمرینِ ریاضی", "2026-10-15", [1], null); // ۱ روز مانده، بدونِ گروه ⇒ پیوی به منتخب
  const notToday = await mkItem("assignment", "فردا نیست", "2026-10-20", [3, 1], grp);  // ۶ روز مانده ⇒ نه
  const past = await mkItem("assignment", "گذشته", "2026-10-10", [1], grp);             // موعدِ گذشته ⇒ done
  // آیتم‌ها دیروز ثبت شده‌اند (وگرنه «امروز خودش موردی ثبت کرده» و پرسشِ عصر عمداً رد می‌شود)
  await q("UPDATE school_rep_items SET created_at='2026-10-12T10:00:00Z' WHERE school_id=$1", [sch]);
  let rep1 = await runSchoolRepSweep(NOW_REMIND);
  const toGroup = tgSent.filter((m) => String(m.chat_id) === "-200");
  check("sweep #1: reminder sent to the selected group for the item due in 3 days", toGroup.length === 1 && toGroup[0].text.includes("آزمونِ فیزیک"), JSON.stringify({ rep1, toGroup }).slice(0, 400));
  check("sweep #1: item with no group ⇒ DM to the rep (chat 777)", tgSent.some((m) => String(m.chat_id) === "777" && m.text.includes("تمرینِ ریاضی")) && rep1.dmFallbacks === 1, JSON.stringify(rep1));
  check("sweep #1: an item whose reminder day is not today gets nothing", !tgSent.some((m) => (m.text || "").includes("فردا نیست")));
  check("sweep #1: past-due item moved to done", (await q("SELECT status FROM school_rep_items WHERE id=$1", [past])).rows[0].status === "done" && rep1.expired >= 1);
  const before = tgSent.length;
  const rep2 = await runSchoolRepSweep(NOW_REMIND);
  check("sweep #2 (same day): nothing is re-sent (log-claim makes it idempotent)", tgSent.length === before && rep2.remindersSent === 0, JSON.stringify({ rep2, extra: tgSent.slice(before).map((m) => m.text) }));
  const sendsBeforePrompt = tgSent.length;
  const rep3 = await runSchoolRepSweep(NOW_PROMPT);
  // (مدرسه‌یِ بخشِ API هم یک منتخبِ متصل دارد ⇒ promptsSent کلاً ۲ است؛ برای این دانش‌آموز باید دقیقاً ۱ باشد)
  check("evening sweep: THIS connected rep gets the daily prompt exactly once", tgSent.slice(sendsBeforePrompt).filter((m) => String(m.chat_id) === "777").length === 1 && rep3.promptsSent >= 1, JSON.stringify(rep3));
  const afterPrompt = tgSent.length;
  const rep4 = await runSchoolRepSweep(new Date(NOW_PROMPT.getTime() + 10 * 60e3));
  check("a second evening sweep does not prompt again the same day", rep4.promptsSent === 0 && tgSent.length === afterPrompt, JSON.stringify(rep4));
  const FRIDAY_PROMPT = new Date("2026-10-16T15:30:00Z"); // جمعه
  const rep5 = await runSchoolRepSweep(FRIDAY_PROMPT);
  check("no prompt on Friday", rep5.promptsSent === 0, JSON.stringify(rep5));

  console.log("Bot wizard: the rep logs an assignment inside the school bot");
  const secret = crypto.createHash("sha256").update("111:SWEEP:irforge_webhook_secret").digest("hex");
  const hook = async (update) => fetch(`${BASE}/schools/bot-webhook/${bot2}`, { method: "POST", headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": secret }, body: JSON.stringify(update) });
  const cb = (data) => hook({ update_id: Math.floor(Math.random() * 1e9), callback_query: { id: String(Math.random()), from: { id: 777, first_name: "rep" }, data, message: { message_id: 50, chat: { id: 777, type: "private" } } } });
  const txt = (text) => hook({ update_id: Math.floor(Math.random() * 1e9), message: { message_id: 51, from: { id: 777, first_name: "rep" }, chat: { id: 777, type: "private" }, text } });
  const lastText = async (ms = 700) => { await new Promise((r) => setTimeout(r, ms)); return tgSent.filter((m) => String(m.chat_id) === "777").at(-1)?.text ?? ""; };
  const kbOf = () => JSON.stringify(tgSent.filter((m) => String(m.chat_id) === "777").at(-1)?.reply_markup ?? {});
  check("a wrong secret is rejected (401)", (await fetch(`${BASE}/schools/bot-webhook/${bot2}`, { method: "POST", headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": "nope" }, body: "{}" })).status === 401);

  tgSent.length = 0;
  await cb("r:home"); let t = await lastText();
  check("r:home shows the rep home screen with 'new assignment' buttons", t.length > 0 && kbOf().includes("r:n:assignment"), t.slice(0, 200) + " | " + kbOf().slice(0, 200));
  await cb("r:n:assignment"); t = await lastText();
  check("asks for a title", /عنوان|تکلیف/.test(t), t.slice(0, 200));
  await txt("حلِ تمرینِ ۵۰ صفحهٔ ۴۵"); t = await lastText();
  check("after the title it asks for the due date (with quick-pick buttons)", kbOf().includes("r:d:3"), t.slice(0, 200) + " | " + kbOf().slice(0, 300));
  await txt("blah blah"); t = await lastText();
  check("garbage date ⇒ polite re-ask, wizard stays", /نفهمیدم|تاریخ/.test(t), t.slice(0, 200));
  await cb("r:d:3"); t = await lastText();
  check("quick date ⇒ reminder-days screen", kbOf().includes("r:z:go"), kbOf().slice(0, 300));
  await cb("r:z:go"); t = await lastText();
  check("reminder days confirmed ⇒ group picker lists the bot's group the rep belongs to", /گروه ششم/.test(JSON.stringify(tgSent.filter((m) => String(m.chat_id) === "777").at(-1))), t.slice(0, 300) + " | " + kbOf().slice(0, 300));
  // فقط یک گروه هست ⇒ کد خودش پیش‌انتخابش می‌کند («ثبت (۱ گروه)»)؛ کلیک = خاموش، کلیکِ دوم = روشن.
  const lastKb = () => JSON.stringify(tgSent.filter((m) => String(m.chat_id) === "777").at(-1)?.reply_markup ?? {});
  check("a single group is preselected (button says 'register (1 group)')", /ثبت \(۱ گروه\)/.test(lastKb()), lastKb().slice(0, 500));
  await cb("r:g:0"); await lastText(600);
  check("clicking it deselects (button says 'register without group')", /ثبت بدونِ گروه/.test(lastKb()), lastKb().slice(0, 500));
  await cb("r:g:0"); await lastText(600);
  check("clicking again selects it back", /ثبت \(۱ گروه\)/.test(lastKb()), lastKb().slice(0, 500));
  await cb("r:ok"); t = await lastText(900);
  const saved = (await q("SELECT i.id,i.title,i.kind,i.status,i.due_date::text AS due,i.remind_days,i.created_by_user_id, (SELECT count(*) FROM school_rep_item_groups g WHERE g.item_id=i.id) AS ngroups FROM school_rep_items i WHERE i.school_id=$1 AND i.title LIKE 'حلِ تمرین%'", [sch])).rows;
  const expectedDue = new Date(Date.now() + 3 * 86400e3).toLocaleDateString("en-CA", { timeZone: "Asia/Tehran" });
  console.log("    saved row:", JSON.stringify(saved));
  check("the item is saved in the DB: kind=assignment, active, due = Tehran today + 3, reminders {3,1}, linked to exactly the chosen group",
    saved.length === 1 && saved[0].kind === "assignment" && saved[0].status === "active" && saved[0].due === expectedDue && [...saved[0].remind_days].sort().join() === "1,3" && Number(saved[0].ngroups) === 1,
    JSON.stringify({ saved, expectedDue }));
  check("saved by the rep himself", saved[0]?.created_by_user_id === rep.id);
  tgSent.length = 0; await cb("r:ls:0"); t = await lastText();
  check("'my items' list shows the new item", /حلِ تمرین/.test(JSON.stringify(tgSent.at(-1))), t.slice(0, 200));
  const itemId = saved[0]?.id;
  await cb(`r:rm:${itemId}`); await lastText(500);
  check("rep can cancel his own item from the bot", (await q("SELECT status FROM school_rep_items WHERE id=$1", [itemId])).rows[0].status === "cancelled");
  // امنیت: کسی که منتخب نیست (معلم/والد/دانش‌آموزِ عادی) نمی‌تواند وارد این بخش شود
  const stranger = await mkUser("not_rep"); const sm = uid();
  await q("INSERT INTO school_members (id,user_id,school_id,role,grade) VALUES ($1,$2,$3,'student','9')", [sm, stranger.id, sch]);
  await q("INSERT INTO school_class_members (id,class_id,school_member_id,role_in_class) VALUES ($1,$2,$3,'student')", [uid(), cl, sm]);
  await q("INSERT INTO school_bot_subscribers (id,school_bot_id,user_id,telegram_chat_id,telegram_user_id) VALUES ($1,$2,$3,'888','888')", [uid(), bot2, stranger.id]);
  tgSent.length = 0;
  await hook({ update_id: 1, callback_query: { id: "x", from: { id: 888, first_name: "n" }, data: "r:n:assignment", message: { message_id: 5, chat: { id: 888, type: "private" } } } });
  await new Promise((r) => setTimeout(r, 700));
  const after = (await q("SELECT count(*)::int AS n FROM school_rep_items WHERE created_by_user_id=$1", [stranger.id])).rows[0].n;
  check("a non-rep student pressing r:n:assignment cannot create anything (answers 'only for reps')", after === 0 && (tgSent.length === 0 || !/عنوان/.test(tgSent.map((m) => m.text).join(" "))), JSON.stringify(tgSent.slice(0, 2)));
} catch (e) {
  fail++; console.log("crashed:", e);
} finally {
  console.log(`\n${pass} passed, ${fail} failed`);
  server.close(); tgStub.close(); await dbPool.end().catch(() => {}); setTimeout(() => process.exit(fail ? 1 : 0), 200);
}
