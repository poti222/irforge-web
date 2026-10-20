/**
 * test/live/schoolReps.live.mjs — سرتاسریِ «دانش‌آموزِ منتخب» روی Postgres واقعی + تلگرامِ جعلی (TELEGRAM_API_BASE).
 * اجرا: DATABASE_URL=... node migrate.mjs && DATABASE_URL=... node --import tsx/esm --test test/live/schoolReps.live.mjs
 */
import http from "node:http";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

const calls = [];
const srv = http.createServer((req, res) => {
  let body = ""; req.on("data", (c) => (body += c));
  req.on("end", () => {
    const m = /\/bot[^/]+\/(\w+)/.exec(req.url) ?? [];
    const b = body ? JSON.parse(body) : {};
    calls.push({ method: m[1], body: b });
    res.setHeader("content-type", "application/json");
    if (m[1] === "getChatMember") return res.end(JSON.stringify({ ok: true, result: { status: b.user_id === 999 ? "administrator" : "member" } }));
    if (m[1] === "getMe") return res.end(JSON.stringify({ ok: true, result: { id: 999, username: "schoolbot" } }));
    res.end(JSON.stringify({ ok: true, result: { message_id: 1 } }));
  });
});
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
process.env.TELEGRAM_API_BASE = `http://127.0.0.1:${srv.address().port}`;
process.env.BOT_TOKEN_ENCRYPTION_KEY = "ab".repeat(32);
process.env.SCHOOL_BOT_SEND_GAP_MS = "0";
process.env.SCHOOL_REP_REMIND_HOUR = "0";
process.env.SCHOOL_REP_PROMPT_HOUR = "0";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");

const { db, pool } = await import("@workspace/db");
const { encryptToken } = await import("../../src/lib/tokenCrypto.ts");
const { handleUpdate } = await import("../../src/lib/schoolBot/handler.ts");
const { runSchoolRepSweep } = await import("../../src/lib/schoolRepScheduler.ts");
const { addDays } = await import("../../src/lib/schoolRepSchedule.ts");
const { tehranDateStr } = await import("../../src/lib/schoolBot/util.ts");
const { apiAs } = await import("../../src/lib/schoolBot/internalApi.ts");

const q = (s, p) => pool.query(s, p);
const ID = Math.random().toString(36).slice(2, 8);
const T = { school: `sc-${ID}`, cls: `cl-${ID}`, teacher: `ut-${ID}`, stu: `us-${ID}`, mT: `mt-${ID}`, mS: `ms-${ID}`, bot: `bt-${ID}`, pool: `pl-${ID}` };
let botRow;

before(async () => {
  for (const [id, name] of [[T.teacher, "معلم"], [T.stu, "علی"]]) await q("INSERT INTO users(id,name,email,password_hash) VALUES($1,$2,$3,'x')", [id, name, `${id}@t.io`]);
  await q("INSERT INTO schools(id,name,created_by_user_id) VALUES($1,'مدرسه',$2)", [T.school, T.teacher]);
  await q("INSERT INTO school_members(id,user_id,school_id,role) VALUES($1,$2,$3,'teacher'),($4,$5,$3,'student')", [T.mT, T.teacher, T.school, T.mS, T.stu]);
  await q("INSERT INTO school_classes(id,school_id,name) VALUES($1,$2,'هفتم‌الف')", [T.cls, T.school]);
  await q("INSERT INTO school_class_members(id,class_id,school_member_id,role_in_class) VALUES($1,$2,$3,'teacher'),($4,$2,$5,'student')", [`a${ID}`, T.cls, T.mT, `b${ID}`, T.mS]);
  await q("INSERT INTO school_bot_token_pool(id,bot_token,status,assigned_school_id) VALUES($1,$2,'assigned',$3)", [T.pool, encryptToken("123:ABC"), T.school]);
  await q("INSERT INTO school_bots(id,school_id,bot_token_pool_id,telegram_bot_id,telegram_username) VALUES($1,$2,$3,'999','schoolbot')", [T.bot, T.school, T.pool]);
  await q("INSERT INTO school_bot_subscribers(id,school_bot_id,user_id,telegram_chat_id,telegram_user_id) VALUES($1,$2,$3,'5001','5001')", [`s${ID}`, T.bot, T.stu]);
  await q("INSERT INTO school_class_reps(id,school_id,class_id,student_member_id,teacher_user_id) VALUES($1,$2,$3,$4,$5)", [`r${ID}`, T.school, T.cls, T.mS, T.teacher]);
  botRow = (await q("SELECT * FROM school_bots WHERE id=$1", [T.bot])).rows[0];
});
after(async () => { srv.close(); await pool.end(); });

const bot = () => ({ id: botRow.id, schoolId: T.school, botTokenPoolId: T.pool, telegramBotId: "999", telegramUsername: "schoolbot" });
const send = (upd) => handleUpdate(bot(), "123:ABC", upd);
const cb = (data) => send({ callback_query: { id: "q", from: { id: 5001 }, data, message: { message_id: 7, chat: { id: 5001, type: "private" } } } });
const txt = (text) => send({ message: { message_id: 8, from: { id: 5001 }, chat: { id: 5001, type: "private" }, text } });
const sent = (m) => calls.filter((c) => c.method === m);
const lastText = () => { const c = calls.filter((x) => ["sendMessage", "editMessageText"].includes(x.method)).at(-1); return c?.body.text ?? ""; };
const lastKb = () => JSON.stringify(calls.filter((x) => ["sendMessage", "editMessageText"].includes(x.method)).at(-1)?.body.reply_markup ?? {});

test("بات به گروه اضافه شد (my_chat_member) و ثبت می‌شود؛ حذف ← left", async () => {
  await send({ my_chat_member: { chat: { id: -100123, title: "گروهِ هفتم‌الف", type: "supergroup" }, from: { id: 5001 }, old_chat_member: { status: "left" }, new_chat_member: { status: "administrator" } } });
  const r = await q("SELECT * FROM school_bot_groups WHERE school_bot_id=$1", [T.bot]);
  assert.equal(r.rows.length, 1); assert.equal(r.rows[0].bot_status, "administrator"); assert.equal(r.rows[0].can_post, true);
  assert.ok(sent("sendMessage").some((c) => /عضو شد/.test(c.body.text)), "تأییدِ پیوی به اضافه‌کننده");
  await send({ my_chat_member: { chat: { id: -100999, title: "گروهِ دیگر", type: "group" }, from: { id: 5001 }, old_chat_member: { status: "left" }, new_chat_member: { status: "member" } } });
  await send({ my_chat_member: { chat: { id: -100999, title: "گروهِ دیگر", type: "group" }, from: { id: 5001 }, old_chat_member: { status: "member" }, new_chat_member: { status: "kicked" } } });
  assert.equal((await q("SELECT bot_status FROM school_bot_groups WHERE telegram_chat_id='-100999'")).rows[0].bot_status, "kicked");
});

test("/bind در گروه: فقط کاربرِ مجاز؛ ناشناس بی‌صدا", async () => {
  const before = calls.length;
  await send({ message: { message_id: 1, from: { id: 777 }, chat: { id: -100555, type: "group", title: "x" }, text: "/bind" } });
  assert.equal(calls.length, before, "ناشناس: هیچ تماسی");
  await send({ message: { message_id: 2, from: { id: 5001 }, chat: { id: -100555, type: "group", title: "گروهِ دستی" }, text: "/bind@schoolbot" } });
  assert.equal((await q("SELECT source FROM school_bot_groups WHERE telegram_chat_id='-100555'")).rows[0].source, "bind");
  await send({ message: { message_id: 3, from: { id: 5001 }, chat: { id: -100555, type: "group" }, text: "سلام" } }); // پیامِ عادی نادیده
});

test("جریانِ کاملِ منتخب: منو ← تکلیف ← عنوان ← موعد ← روزها ← گروه ← ثبت", async () => {
  await txt("/menu");
  assert.match(lastKb(), /r:home/, "ردیفِ مسئولِ کلاس در منویِ دانش‌آموز");
  await cb("r:home"); assert.match(lastText(), /مسئولِ کلاس/);
  await cb("r:n:assignment"); assert.match(lastText(), /عنوان را بفرستید/);
  await txt("ریاضی — تمرین صفحهٔ ۴۵"); assert.match(lastText(), /موعد/);
  await txt("سلام"); assert.match(lastText(), /نفهمیدم/);
  await cb("r:d:3"); assert.match(lastText(), /چند روز قبل/);
  assert.match(lastKb(), /✅ ۳ روز قبل/); assert.match(lastKb(), /✅ ۱ روز قبل/);
  await cb("r:z:go"); assert.match(lastText(), /کدام گروه/);
  assert.match(lastKb(), /گروهِ هفتم‌الف/); assert.ok(!/گروهِ دیگر/.test(lastKb()), "گروهِ kicked نشان داده نشود");
  await cb("r:g:0");
  await cb("r:ok"); assert.match(lastText(), /ثبت شد/);
  const it = (await q("SELECT * FROM school_rep_items WHERE class_id=$1", [T.cls])).rows;
  assert.equal(it.length, 1); assert.deepEqual(it[0].remind_days, [3, 1]); assert.equal(it[0].status, "active");
  assert.equal((await q("SELECT * FROM school_rep_item_groups WHERE item_id=$1", [it[0].id])).rows.length, 1);
  assert.equal((await q("SELECT 1 FROM notifications WHERE type='school_rep_item' AND user_id=$1", [T.teacher])).rows.length, 1, "به معلم خبر داده شد");
});

test("ثبتِ تکراری رد می‌شود", async () => {
  await cb("r:n:assignment"); await txt("ریاضی — تمرین صفحهٔ ۴۵"); await cb("r:d:3"); await cb("r:z:go"); await cb("r:g:0"); await cb("r:ok");
  assert.match(lastText(), /قبلاً ثبت/);
});

test("زمان‌بند: یادآوریِ ۳ روز قبل دقیقاً یک‌بار؛ روزِ بی‌ربط هیچ", async () => {
  const today = tehranDateStr();
  const it = (await q("SELECT * FROM school_rep_items WHERE class_id=$1", [T.cls])).rows[0];
  const due = String(it.due_date instanceof Date ? it.due_date.toISOString().slice(0, 10) : it.due_date).slice(0, 10);
  const noon = (d) => new Date(`${d}T09:00:00Z`);
  calls.length = 0;
  let r = await runSchoolRepSweep(noon(addDays(due, -3)));
  assert.equal(r.remindersSent, 1);
  assert.match(sent("sendMessage").at(-1).body.text, /یادآوریِ تکلیف/);
  const want = (await q("SELECT g.telegram_chat_id FROM school_rep_item_groups ig JOIN school_bot_groups g ON g.id=ig.group_id WHERE ig.item_id=$1", [it.id])).rows[0].telegram_chat_id;
  assert.equal(String(sent("sendMessage").at(-1).body.chat_id), want, "به گروهِ انتخاب‌شده");
  r = await runSchoolRepSweep(noon(addDays(due, -3)));
  assert.equal(r.remindersSent, 0, "idempotent");
  r = await runSchoolRepSweep(noon(addDays(due, -2)));
  assert.equal(r.remindersSent, 0, "۲ روز قبل انتخاب نشده");
  r = await runSchoolRepSweep(noon(addDays(due, -1)));
  assert.equal(r.remindersSent, 1, "یک روز قبل");
  r = await runSchoolRepSweep(noon(addDays(due, 1)));
  assert.equal(r.expired, 1, "گذشته ← done");
  void today;
});

test("پرسشِ روزانه: یک‌بار در روز؛ جمعه نه", async () => {
  await q("UPDATE school_class_reps SET last_prompt_on=NULL");
  await q("DELETE FROM school_rep_items");
  calls.length = 0;
  const sat = new Date("2026-10-10T09:00:00Z"); // شنبه
  let r = await runSchoolRepSweep(sat);
  assert.equal(r.promptsSent, 1); assert.match(sent("sendMessage").at(-1).body.text, /تکلیف یا امتحانِ جدیدی/);
  r = await runSchoolRepSweep(sat); assert.equal(r.promptsSent, 0);
  await q("UPDATE school_class_reps SET last_prompt_on=NULL");
  r = await runSchoolRepSweep(new Date("2026-10-16T09:00:00Z")); // جمعه
  assert.equal(r.promptsSent, 0);
});

test("امنیت: غیرِ منتخب به r:* دسترسی ندارد", async () => {
  await q("DELETE FROM school_class_reps");
  calls.length = 0;
  await cb("r:home");
  const ans = sent("answerCallbackQuery").at(-1);
  assert.match(ans.body.text, /فقط برایِ دانش‌آموزِ منتخب/);
});

test("REST: معلم منتخب انتخاب/مشاهده/برکنار می‌کند؛ دانش‌آموز و مدرسهٔ دیگر ممنوع", async () => {
  const base = `/schools/${T.school}`;
  let r = await apiAs(T.teacher, "GET", `${base}/classes/${T.cls}/rep-candidates`);
  assert.equal(r.status, 200); assert.equal(r.json.students.length, 1); assert.equal(r.json.students[0].repId, null); assert.equal(r.json.students[0].botLinked, true);
  r = await apiAs(T.teacher, "POST", `${base}/classes/${T.cls}/reps`, { studentMemberId: T.mS });
  assert.equal(r.status, 201); const repId = r.json.id;
  r = await apiAs(T.teacher, "POST", `${base}/classes/${T.cls}/reps`, { studentMemberId: T.mS });
  assert.equal(r.status, 409);
  r = await apiAs(T.teacher, "POST", `${base}/classes/${T.cls}/reps`, { studentMemberId: T.mT });
  assert.equal(r.status, 400, "معلم دانش‌آموزِ کلاس نیست");
  r = await apiAs(T.stu, "POST", `${base}/classes/${T.cls}/reps`, { studentMemberId: T.mS });
  assert.equal(r.status, 403, "دانش‌آموز نمی‌تواند منتخب انتخاب کند");
  r = await apiAs(T.stu, "GET", `${base}/reps`); assert.equal(r.status, 403);
  r = await apiAs(T.teacher, "GET", `${base}/reps`); assert.equal(r.status, 200); assert.equal(r.json.length, 1); assert.equal(r.json[0].mine, true);
  r = await apiAs(T.teacher, "GET", `/schools/other-school/rep-items`); assert.equal(r.status, 403, "مدرسهٔ دیگر");
  r = await apiAs(T.teacher, "GET", `${base}/classes/other-class/rep-candidates`); assert.ok([403, 404].includes(r.status));
  // یک مورد بسازیم و لغو کنیم
  const iid = `i${ID}`;
  await q("INSERT INTO school_rep_items(id,school_id,class_id,created_by_member_id,created_by_user_id,kind,title,due_date,remind_days) VALUES($1,$2,$3,$4,$5,'exam','فصل ۱',CURRENT_DATE+5,'{1}')", [iid, T.school, T.cls, T.mS, T.stu]);
  r = await apiAs(T.teacher, "GET", `${base}/rep-items?classId=${T.cls}`); assert.equal(r.status, 200); assert.equal(r.json.length, 1); assert.equal(r.json[0].createdByName, "علی");
  r = await apiAs(T.stu, "PATCH", `${base}/rep-items/${iid}`, { status: "cancelled" }); assert.equal(r.status, 403);
  r = await apiAs(T.teacher, "PATCH", `${base}/rep-items/${iid}`, { status: "cancelled" }); assert.equal(r.status, 200);
  r = await apiAs(T.teacher, "GET", `${base}/bot-groups`); assert.equal(r.status, 200); assert.equal(r.json.botActive, true); assert.ok(r.json.groups.length >= 1);
  assert.ok(!JSON.stringify(r.json).includes("-100"), "chat_id نشت نکند");
  r = await apiAs(T.teacher, "DELETE", `${base}/reps/${repId}`); assert.equal(r.status, 200);
  r = await apiAs(T.teacher, "DELETE", `${base}/reps/${repId}`); assert.equal(r.status, 404);
});
