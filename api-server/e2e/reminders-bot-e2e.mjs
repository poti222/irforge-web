/**
 * e2e/reminders-bot-e2e.mjs — «🔔 یادآورها» داخلِ باتِ مدرسه: handleUpdate واقعی روی Postgres واقعی + تلگرامِ جعلی.
 * اجرا: DATABASE_URL=... node --import tsx/esm e2e/reminders-bot-e2e.mjs   (بعد از migrate.mjs)
 */
import crypto from "crypto";
import http from "http";

process.env.DATABASE_URL ||= "postgres://postgres@localhost:5433/mm?host=/tmp";
process.env.NODE_ENV = "development";
process.env.BOT_TOKEN_ENCRYPTION_KEY ||= crypto.randomBytes(32).toString("hex");
process.env.TELEGRAM_API_BASE = "http://localhost:9996";
process.env.DISABLE_BACKGROUND_JOBS = "1";

const tg = []; // { method, chat_id, message_id, text, reply_markup, ... }
const stub = http.createServer((req, res) => {
  let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => {
    const method = req.url.split("/").pop(); let body = {}; try { body = JSON.parse(b || "{}"); } catch {}
    tg.push({ method, ...body });
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true, result: { message_id: tg.length, date: 0, chat: { id: body.chat_id ?? 1, type: "private" } } }));
  });
}).listen(9996);

const { db, usersTable, schoolBotsTable } = await import("@workspace/db");
const pg = (await import("pg")).default;
const dbPool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const { handleUpdate } = await import("./../src/lib/schoolBot/handler.ts");
const q = (t, p) => dbPool.query(t, p);
const uid = () => crypto.randomUUID();
let pass = 0, fail = 0;
const check = (n, c, x = "") => { c ? (pass++, console.log("  ✓", n)) : (fail++, console.log("  ✗", n, x)); };

const mkUser = async (name) => { const id = uid(); await db.insert(usersTable).values({ id, name, email: `${name}-${id.slice(0, 6)}@e2e.test`, passwordHash: "x", role: "user", plan: "free", status: "active" }); return id; };
const btns = (m) => (m?.reply_markup?.inline_keyboard ?? m?.reply_markup ? (typeof m.reply_markup === "string" ? JSON.parse(m.reply_markup) : m.reply_markup).inline_keyboard : []).flat();
const last = (chat, methods = ["sendMessage", "editMessageText"]) => [...tg].reverse().find((m) => String(m.chat_id) === String(chat) && methods.includes(m.method));
const cbData = (chat) => btns(last(chat)).map((b) => b.callback_data);
const txt = (chat) => last(chat)?.text ?? "";

try {
  await q("TRUNCATE schools, school_bot_token_pool CASCADE");
  const ids = {}; for (const n of ["admin", "teacher", "teacher2", "rep", "s2", "plain"]) ids[n] = await mkUser(n);
  const school = uid(), c1 = uid(), c2 = uid();
  await q("INSERT INTO schools (id,name,created_by_user_id) VALUES ($1,'مدرسهٔ نمونه',$2)", [school, ids.admin]);
  const mem = {}; const addMember = async (n, role) => { const id = uid(); await q("INSERT INTO school_members (id,user_id,school_id,role,grade) VALUES ($1,$2,$3,$4,'9')", [id, ids[n], school, role]); mem[n] = id; };
  await addMember("admin", "admin"); await addMember("teacher", "teacher"); await addMember("teacher2", "teacher"); await addMember("rep", "student"); await addMember("s2", "student"); await addMember("plain", "student");
  await q("INSERT INTO school_classes (id,school_id,name) VALUES ($1,$2,'هفتم الف'),($3,$2,'هشتم ب')", [c1, school, c2]);
  const cm = (c, n, role) => q("INSERT INTO school_class_members (id,class_id,school_member_id,role_in_class) VALUES ($1,$2,$3,$4)", [uid(), c, mem[n], role]);
  await cm(c1, "teacher", "teacher"); await cm(c2, "teacher2", "teacher"); await cm(c1, "rep", "student"); await cm(c1, "s2", "student"); await cm(c1, "plain", "student");
  await q("INSERT INTO school_class_reps (id,school_id,class_id,student_member_id,teacher_user_id) VALUES ($1,$2,$3,$4,$5)", [uid(), school, c1, mem.rep, ids.teacher]);
  const pool = uid(), botId = uid();
  await q("INSERT INTO school_bot_token_pool (id, bot_token) VALUES ($1,'x')", [pool]);
  await q("INSERT INTO school_bots (id,school_id,bot_token_pool_id) VALUES ($1,$2,$3)", [botId, school, pool]);
  const CHAT = { admin: "800", teacher: "900", teacher2: "901", rep: "101", s2: "102", plain: "103" };
  for (const [n, chat] of Object.entries(CHAT)) await q("INSERT INTO school_bot_subscribers (id,school_bot_id,user_id,telegram_chat_id) VALUES ($1,$2,$3,$4)", [uid(), botId, ids[n], chat]);
  const [bot] = await db.select().from(schoolBotsTable);

  let mid = 1000;
  const say = (n, text) => handleUpdate(bot, "x", { message: { message_id: ++mid, chat: { id: Number(CHAT[n]), type: "private" }, from: { id: Number(CHAT[n]) }, text } });
  const press = (n, data) => handleUpdate(bot, "x", { callback_query: { id: `cq${++mid}`, from: { id: Number(CHAT[n]) }, data, message: { message_id: mid, chat: { id: Number(CHAT[n]), type: "private" } } } });
  const answers = (n) => tg.filter((m) => m.method === "answerCallbackQuery");

  console.log("Menus");
  await say("rep", "/menu");
  check("rep (elected student) sees «🔔 یادآورها»", cbData(CHAT.rep).includes("q:home"), JSON.stringify(cbData(CHAT.rep)));
  await say("s2", "/menu");
  check("ordinary student does NOT", !cbData(CHAT.s2).includes("q:home"));
  await say("teacher", "/menu");
  check("teacher sees it", cbData(CHAT.teacher).includes("q:home"));
  await say("admin", "/menu");
  check("admin sees it", cbData(CHAT.admin).includes("q:home"));

  console.log("Access control in the bot");
  tg.length = 0; await press("s2", "q:home");
  check("ordinary student pressing q:home is refused (alert)", answers().some((a) => a.show_alert === true && /⛔️/.test(a.text ?? "")) && !tg.some((m) => m.method === "editMessageText"));
  await press("rep", "q:home");
  check("rep: class picker lists only own class, no «کلِ مدرسه»", cbData(CHAT.rep).includes(`q:c:${c1}`) && !cbData(CHAT.rep).includes(`q:c:${c2}`) && !cbData(CHAT.rep).includes("q:c:_"), JSON.stringify(cbData(CHAT.rep)));
  await press("admin", "q:home");
  check("admin: both classes + whole school", [`q:c:${c1}`, `q:c:${c2}`, "q:c:_"].every((d) => cbData(CHAT.admin).includes(d)));

  console.log("Create via the bot (rep): «every day except Thu+Fri, 06:00 and 08:00»");
  await press("rep", `q:c:${c1}`);
  check("class screen has «➕ یادآورِ جدید»", cbData(CHAT.rep).includes(`q:n:${c1}`));
  await press("rep", `q:n:${c1}`);
  check("asks for the message text", /متنِ پیام/.test(txt(CHAT.rep)));
  await say("rep", "");
  check("empty text → error, still waiting", /متنِ پیام لازم|دوباره/.test(txt(CHAT.rep)));
  await say("rep", "x".repeat(1001));
  check("too long text → error", /حداکثر/.test(txt(CHAT.rep)));
  await say("rep", "خودکار بزن");
  check("then shows the weekday picker (default Sat–Wed)", /روزهایِ هفته/.test(txt(CHAT.rep)) && cbData(CHAT.rep).includes("q:dn") && cbData(CHAT.rep).includes("q:dt:6"));
  await press("rep", "q:dt:5"); await press("rep", "q:dt:6"); // پنجشنبه و جمعه روشن
  check("toggling Thu+Fri on adds ✅ marks", /✅ پنجشنبه/.test(JSON.stringify(last(CHAT.rep).reply_markup)) && /✅ جمعه/.test(JSON.stringify(last(CHAT.rep).reply_markup)));
  await press("rep", "q:dp:2"); // پیش‌تنظیمِ «جز پنجشنبه و جمعه»
  check("preset «جز پنجشنبه و جمعه» resets the days", /هر روز به‌جز پنجشنبه و جمعه/.test(txt(CHAT.rep)));
  await press("rep", "q:dn");
  check("asks for times", /ساعت‌ها \(به وقتِ تهران\)/.test(txt(CHAT.rep)) && cbData(CHAT.rep).includes("q:tp:0"));
  await say("rep", "25:00");
  check("invalid time → error, stays", /معتبر نیست/.test(txt(CHAT.rep)));
  await say("rep", "۶ و ۸");
  check("«۶ و ۸» accepted → confirm screen with the schedule + audience count", /هر روز به‌جز پنجشنبه و جمعه — ساعت ۰۶:۰۰ و ۰۸:۰۰/.test(txt(CHAT.rep)) && /دانش‌آموز به بات وصل‌اند/.test(txt(CHAT.rep)) && cbData(CHAT.rep).includes("q:sv"), txt(CHAT.rep));
  await press("rep", "q:sv");
  let row = (await q("SELECT * FROM school_reminders WHERE class_id=$1", [c1])).rows[0];
  check("saved: createdByRole=rep, weekdays Sat–Wed, times 06:00/08:00, DM on, no groups", row && row.created_by_role === "rep" && row.weekdays.join() === "0,1,2,3,4" && row.times.join() === "06:00,08:00" && row.send_dm === true && row.message === "خودکار بزن", JSON.stringify(row));
  check("then shows the detail screen with controls", /یادآور ساخته شد/.test(txt(CHAT.rep)) && [`q:tg:${row.id}`, `q:et:${row.id}`, `q:ed:${row.id}`, `q:em:${row.id}`, `q:dl:${row.id}`].every((d) => cbData(CHAT.rep).includes(d)));
  const RID = row.id;

  console.log("Edit via the bot");
  await press("rep", `q:et:${RID}`); await say("rep", "21");
  check("edit times «21» → 21:00", (await q("SELECT times FROM school_reminders WHERE id=$1", [RID])).rows[0].times.join() === "21:00" && /ساعت ۲۱:۰۰/.test(txt(CHAT.rep)));
  await press("rep", `q:et:${RID}`); await press("rep", "q:tp:2");
  check("time preset «چهار بار» → 4 times", (await q("SELECT times FROM school_reminders WHERE id=$1", [RID])).rows[0].times.length === 4);
  await press("rep", `q:ed:${RID}`); await press("rep", "q:dp:3"); await press("rep", "q:ds");
  check("edit days → Fridays only", (await q("SELECT weekdays FROM school_reminders WHERE id=$1", [RID])).rows[0].weekdays.join() === "6" && /هر جمعه/.test(txt(CHAT.rep)));
  await press("rep", `q:em:${RID}`); await say("rep", "امتحان بده");
  check("edit message", (await q("SELECT message FROM school_reminders WHERE id=$1", [RID])).rows[0].message === "امتحان بده");
  await press("rep", `q:tg:${RID}`);
  check("pause toggle", (await q("SELECT active FROM school_reminders WHERE id=$1", [RID])).rows[0].active === false && /▶️ فعال‌سازی/.test(JSON.stringify(last(CHAT.rep).reply_markup)));
  await press("rep", `q:tg:${RID}`);
  tg.length = 0; await press("rep", `q:ts:${RID}`);
  check("sample goes to my own chat with the real format", tg.some((m) => m.method === "sendMessage" && String(m.chat_id) === CHAT.rep && /🧪/.test(m.text) && /🔔 <b>یادآوری<\/b> — هفتم الف/.test(m.text) && /امتحان بده/.test(m.text)));

  console.log("Teacher / admin can edit the rep's reminder; others cannot");
  await press("teacher", `q:d:${RID}`);
  check("teacher of that class opens it", /امتحان بده/.test(txt(CHAT.teacher)));
  await press("teacher", `q:tg:${RID}`);
  check("teacher toggles it", (await q("SELECT active FROM school_reminders WHERE id=$1", [RID])).rows[0].active === false);
  await press("admin", `q:tg:${RID}`);
  tg.length = 0; await press("teacher2", `q:d:${RID}`);
  check("teacher of ANOTHER class is refused and sees nothing", answers().some((a) => a.show_alert === true) && !tg.some((m) => m.method === "editMessageText" && /امتحان بده/.test(m.text ?? "")));
  await press("teacher2", `q:tg:${RID}`);
  check("…cannot toggle either", (await q("SELECT active FROM school_reminders WHERE id=$1", [RID])).rows[0].active === true);
  tg.length = 0; await press("rep", `q:n:${c2}`);
  check("rep cannot start a reminder for another class", answers().some((a) => a.show_alert !== true) || cbData(CHAT.rep).includes("q:home"));
  check("…and no state was created", (await q("SELECT 1 FROM school_bot_chat_state WHERE telegram_chat_id=$1 AND state LIKE 'rm_%'", [CHAT.rep])).rowCount === 0);

  console.log("School-wide (admin only) + delete");
  await press("admin", "q:n:_"); await say("admin", "اطلاعیهٔ مدرسه"); await press("admin", "q:dp:0"); await press("admin", "q:dn"); await say("admin", "07:00"); await press("admin", "q:sv");
  const w = (await q("SELECT * FROM school_reminders WHERE class_id IS NULL")).rows[0];
  check("admin created a school-wide reminder (all 7 days)", w && w.weekdays.length === 7 && w.created_by_role === "admin");
  await press("teacher", "q:n:_");
  check("teacher cannot create school-wide", (await q("SELECT 1 FROM school_reminders WHERE class_id IS NULL")).rowCount === 1);
  await press("rep", `q:dl:${RID}`);
  check("delete asks for confirmation first", cbData(CHAT.rep).includes(`q:dy:${RID}`) && (await q("SELECT 1 FROM school_reminders WHERE id=$1", [RID])).rowCount === 1);
  await press("rep", `q:dy:${RID}`);
  check("confirmed delete removes it", (await q("SELECT 1 FROM school_reminders WHERE id=$1", [RID])).rowCount === 0);

  console.log("Misc");
  tg.length = 0; await say("rep", "سلام این یک پیامِ متفرقه است");
  check("random text outside a wizard just shows the menu", /منویِ دانش‌آموز/.test(txt(CHAT.rep)));
  await press("rep", `q:c:${c1}`); await press("rep", `q:n:${c1}`); await press("rep", "q:x");
  check("cancel clears the wizard state", (await q("SELECT 1 FROM school_bot_chat_state WHERE telegram_chat_id=$1 AND state LIKE 'rm_%'", [CHAT.rep])).rowCount === 0);
  const longId = "q:d:" + uid();
  check("callback_data stays ≤ 64 bytes for every button we generate", [`q:tg:${RID}`, `q:dy:${RID}`, `q:c:${c1}`, longId].every((d) => Buffer.byteLength(d) <= 64));
} catch (err) {
  console.error("E2E CRASH", err); fail++;
} finally {
  console.log(`\n${pass} passed, ${fail} failed`);
  stub.close(); await dbPool.end(); process.exit(fail ? 1 : 0);
}
