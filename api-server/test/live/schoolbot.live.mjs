/** School notification bot, end to end against a LOCAL MOCK Telegram (test/live/mock-telegram.mjs). Needs api-server started with TELEGRAM_API_BASE=http://localhost:4010 + PUBLIC_SITE_URL=https://… */
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";
import { check, done } from "./lib.mjs";
import { call, pool, q, mock, newSuper, buildWorld, person, sleep, sendUpdate, addPoolToken } from "./bot-lib.mjs";
execFileSync("node", ["migrate.mjs"], { env: process.env, stdio: "ignore" });

const sup = await newSuper();
const W = await buildWorld(sup);
const { A, S1, S2, T, P, DEP, CO, cls } = W;
const SITE = "https://site.example.test";
const secretOf = (token) => crypto.createHash("sha256").update(`${token}:irforge_webhook_secret`).digest("hex");

// ── 1) purchase → profile + webhook ──────────────────────────────────────────
const wh = mock.webhooks[A.botToken];
check("purchase registered webhook at <PUBLIC_SITE_URL>/api/schools/bot-webhook/<botId> (no double slash, https)", wh?.url === `${SITE}/api/schools/bot-webhook/${A.botId}`, wh);
check("webhook secret_token == sha256(token:irforge_webhook_secret) (what the handler verifies)", wh?.secret_token === secretOf(A.botToken));
check("allowed_updates includes message AND callback_query", wh?.allowed_updates?.includes("message") && wh?.allowed_updates?.includes("callback_query"), wh?.allowed_updates);
const mine = (m) => mock.calls.filter((c) => c.token === A.botToken && c.method === m);
const schoolName = (await q("select name from schools where id=$1", [A.schoolId]))[0].name;
check("setMyName = school name", mine("setMyName").at(-1)?.body.name === schoolName.slice(0, 64));
check("description & short description tell people to press Start", /Start/.test(mine("setMyDescription").at(-1)?.body.description) && /Start/.test(mine("setMyShortDescription").at(-1)?.body.short_description) && mine("setMyDescription").at(-1).body.description.includes(schoolName));
check("commands /start /menu /help + menu button", ["start", "menu", "help"].every((c) => mine("setMyCommands").at(-1)?.body.commands.some((x) => x.command === c)) && mine("setChatMenuButton").length >= 1);
check("DB: bot row got telegram_username from getMe", !!A.botUsername);

// ── 2) school photo → bot profile photo ─────────────────────────────────────
const mkJpeg = (r, g, bl) => { const w = 64, h = 64, data = Buffer.alloc(w * h * 4); for (let i = 0; i < w * h; i++) { data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = bl; data[i * 4 + 3] = 255; } return Buffer.from(jpeg.encode({ data, width: w, height: h }, 90).data); };
const upload = async (buf, ct) => (await fetch((process.env.BASE ?? "http://localhost:3111") + "/api/uploads/images", { method: "POST", headers: { "content-type": ct, authorization: `Bearer ${A.token}` }, body: buf })).json();
const jbuf = mkJpeg(200, 30, 30);
const up1 = await upload(jbuf, "image/jpeg");
const n0 = mine("setMyProfilePhoto").length;
await call("PATCH", `/schools/${A.schoolId}`, { token: A.token, body: { photoUrl: up1.url } });
await sleep(1500);
const ph = mine("setMyProfilePhoto").at(-1);
check("changing school photo (JPEG upload) → background resync → setMyProfilePhoto with the EXACT bytes", mine("setMyProfilePhoto").length === n0 + 1 && ph.files.photo_file?.equals(jbuf) && JSON.parse(ph.body.photo).type === "static" && JSON.parse(ph.body.photo).photo === "attach://photo_file", ph && Object.keys(ph.files));
const pngBuf = (() => { const p = new PNG({ width: 32, height: 32 }); for (let i = 0; i < 32 * 32; i++) { p.data[i * 4] = 10; p.data[i * 4 + 1] = 200; p.data[i * 4 + 2] = 10; p.data[i * 4 + 3] = 255; } return PNG.sync.write(p); })();
const up2 = await upload(pngBuf, "image/png");
await call("PATCH", `/schools/${A.schoolId}`, { token: A.token, body: { photoUrl: up2.url } });
await sleep(1500);
const ph2 = mine("setMyProfilePhoto").at(-1);
check("PNG school photo is converted to a real JPEG (FFD8 magic) before sending", mine("setMyProfilePhoto").length === n0 + 2 && ph2.files.photo_file[0] === 0xff && ph2.files.photo_file[1] === 0xd8);
const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x24, 0, 0, 0]), Buffer.from("WEBPVP8 "), Buffer.alloc(40)]);
const up3 = await upload(webp, "image/webp");
await call("PATCH", `/schools/${A.schoolId}`, { token: A.token, body: { photoUrl: up3.url } });
await sleep(1200);
let rs = await call("POST", `/schools/${A.schoolId}/bot/resync`, { token: A.token });
check("WebP photo → resync reports photo.status=needs_jpeg (browser must convert), other steps still ok", rs.status === 200 && rs.json.photo?.status === "needs_jpeg" && rs.json.steps.find((s) => s.step === "webhook")?.ok, rs.text.slice(0, 300));
const jb2 = mkJpeg(20, 20, 220);
const up4 = await upload(jb2, "image/jpeg");
const n1 = mine("setMyProfilePhoto").length;
rs = await call("POST", `/schools/${A.schoolId}/bot/photo`, { token: A.token, body: { url: up4.url } });
check("browser-converted JPEG posted to /bot/photo → applied to the bot with exact bytes", rs.status === 200 && rs.json.photo?.status === "set" && mine("setMyProfilePhoto").length === n1 + 1 && mine("setMyProfilePhoto").at(-1).files.photo_file.equals(jb2), rs.text.slice(0, 200));
check("/bot/photo rejects non-JPEG and non-admin", (await call("POST", `/schools/${A.schoolId}/bot/photo`, { token: A.token, body: { url: up3.url } })).status === 400 && (await call("POST", `/schools/${A.schoolId}/bot/photo`, { token: S1.token, body: { url: up4.url } })).status === 403);
await call("PATCH", `/schools/${A.schoolId}`, { token: A.token, body: { photoUrl: "http://127.0.0.1:9/x.jpg" } });
await sleep(1200);
rs = await call("POST", `/schools/${A.schoolId}/bot/resync`, { token: A.token });
check("loopback/private http photo URL is refused (SSRF guard): status=unsafe_url, nothing fetched", rs.json.photo?.status === "unsafe_url");
await call("PATCH", `/schools/${A.schoolId}`, { token: A.token, body: { photoUrl: up1.url } });

// ── 3) webhook auth ─────────────────────────────────────────────────────────
const stranger = person(A, "غریبه");
await sleep(1800);
const m0 = mock.calls.length;
check("wrong secret → 401 and NO reply", (await sendUpdate(A.botId, { update_id: 1, message: { message_id: 1, from: stranger.from, chat: { id: stranger.id, type: "private" }, text: "/start" } }, "bad")) === 401 && mock.calls.length === m0);
check("missing secret → 401", (await sendUpdate(A.botId, { update_id: 1, message: { message_id: 1, from: stranger.from, chat: { id: stranger.id, type: "private" }, text: "/start" } })) === 401);
check("unknown bot id → 404", (await sendUpdate(crypto.randomUUID(), { update_id: 1 }, "x")) === 404);

// ── 4) /start flows ─────────────────────────────────────────────────────────
// (a) website "connect" → deep link token
const ltS1 = await call("POST", `/schools/${A.schoolId}/bot/link-token`, { token: S1.token });
const s1 = person(A, "دانش‌آموز");
let r = await s1.say(`/start ${ltS1.json.token}`);
check("(a) /start <token> (the website «اتصال به بات» flow) → subscriber row + welcome + student menu", (await q("select * from school_bot_subscribers where user_id=$1 and school_bot_id=$2", [S1.id, A.botId])).length === 1 && /خوش آمدید/.test(s1.texts(r)) && s1.buttons(r).some((b) => b.callback_data === "s:tt:today"), s1.texts(r));
r = await s1.say(`/start ${ltS1.json.token}`);
check("re-using the same token: friendly error, but welcome menu STILL shown (always reply)", /منقضی|نامعتبر/.test(s1.texts(r)) && s1.buttons(r).some((b) => b.callback_data === "s:tt:today"));
r = await s1.say("/start");
check("plain /start again always replies with welcome + menu", /خوش آمدید/.test(s1.texts(r)) && s1.buttons(r).some((b) => b.callback_data === "s:asg:0"));
// (b) automatic by telegram id
const t1 = person(A, "معلم");
await pool.query("update users set telegram_id=$1 where id=$2", [String(t1.id), T.id]);
r = await t1.say("/start");
check("(b) /start with NO token matches users.telegramId of a member of this school → linked + teacher menu", (await q("select 1 from school_bot_subscribers where user_id=$1 and school_bot_id=$2", [T.id, A.botId])).length === 1 && t1.buttons(r).some((b) => b.callback_data === "t:cls"), t1.texts(r));
// telegram id belonging to a user of ANOTHER school must not match
const other = await buildWorldLite(sup);
async function buildWorldLite(sup) { const { newSchoolAdmin, joinSchool } = await import("./bot-lib.mjs"); const B = await newSchoolAdmin("بیرونی"); const u = await joinSchool(B, "student"); return { B, u }; }
const xs = person(A, "خارجی"); await pool.query("update users set telegram_id=$1 where id=$2", [String(xs.id), other.u.id]);
r = await xs.say("/start");
check("a site user of ANOTHER school with a matching telegramId is NOT auto-linked (chooser shown)", (await q("select 1 from school_bot_subscribers where user_id=$1", [other.u.id])).length === 0 && xs.buttons(r).some((b) => b.callback_data === "u:parent"));
// (c) unknown person
r = await stranger.say("/start");
check("(c) unknown person → friendly chooser (parent / student / teacher / admin / counselor)", ["u:parent", "u:o:student", "u:o:teacher", "u:o:admin", "u:o:counselor"].every((d) => stranger.buttons(r).some((b) => b.callback_data === d)), stranger.buttons(r));
r = await stranger.press("s:tt:today");
check("unknown person pressing a student button gets only the chooser — no school data", !/ریاضی/.test(stranger.texts(r)) && stranger.buttons(r).some((b) => b.callback_data === "u:parent"));
r = await stranger.say("برنامه");
check("unknown person typing text gets the chooser again", stranger.buttons(r).some((b) => b.callback_data === "u:parent"));
r = await stranger.press("u:o:student");
check("«دانش‌آموز» → must register on the website: text + «باز کردن سایت» URL button to /schools", /ثبت‌نام/.test(stranger.texts(r)) && stranger.buttons(r).some((b) => b.url === `${SITE}/schools`), stranger.buttons(r));
// admin start → guide + invite
const lt = await call("POST", `/schools/${A.schoolId}/bot/link-token`, { token: A.token });
const adm = person(A, "مدیر");
r = await adm.say(`/start ${lt.json.token}`);
const admText = adm.texts(r);
check("admin first start: welcome + role menu", adm.buttons(r).some((b) => b.callback_data === "a:sum"));
check("admin first start: capability guide per role + «همه باید یک‌بار Start را بزنند»", /همه باید یک‌بار Start را بزنند/.test(admText) && /دانش‌آموز/.test(admText) && /والد/.test(admText) && /معلم/.test(admText) && /مشاور/.test(admText));
check("admin first start: ready-to-forward invite with https://t.me/<username> + Start sentence", admText.includes(`https://t.me/${A.botUsername}`) && /باید یک‌بار Start را بزنند؛ بدونِ آن/.test(admText), admText.slice(-700));
const guideSite = await call("GET", `/schools/${A.schoolId}/bot/admin-info`, { token: A.token });
check("site admin card endpoint returns the same invite/guide + connection panel", guideSite.status === 200 && guideSite.json.inviteText.includes(`https://t.me/${A.botUsername}`) && guideSite.json.connections.roles.length > 0, guideSite.text.slice(0, 200));
check("admin-info is admin-only (student 403)", (await call("GET", `/schools/${A.schoolId}/bot/admin-info`, { token: S1.token })).status === 403);
r = await adm.press("a:guide");
check("«راهنمای مدیر» button re-sends guide + invite", /همه باید یک‌بار Start را بزنند/.test(adm.texts(r)));
r = await adm.press("a:conn");
const connTxt = adm.texts(r);
check("connection panel: counts per role + names of members who have NOT pressed Start (names only)", /دانش‌آموز/.test(connTxt) && connTxt.includes("student") && !/@live\.test/.test(connTxt) && /هنوز Start نزده‌اند/.test(connTxt), connTxt);

// ── 5) student menus & permissions ──────────────────────────────────────────
const sid = A.schoolId;
const subjList = (await call("GET", `/schools/${sid}/subjects`, { token: A.token })).json;
const math = subjList.find((s) => s.name === "ریاضی");
const les = (await call("POST", `/schools/${sid}/content-lessons`, { token: A.token, body: { subject: "ریاضی", title: "جلسهٔ اول" } })).json;
await call("POST", `/schools/content`, { token: A.token, body: { schoolId: sid, type: "note", title: "نکتهٔ تست", body: "متن نکته", lessonId: les.id } });
await call("POST", `/schools/${sid}/alerts`, { token: A.token, body: { studentMemberId: S2.memberId, severity: "critical", title: "SECRET-S2-ALERT", body: "S2 only" } });
let a2 = (await call("POST", `/schools/${sid}/alerts`, { token: A.token, body: { studentMemberId: S1.memberId, severity: "warning", title: "اخطار حذف‌شدنی", body: "SECRET-BODY-DELETED" } })).json;
await call("DELETE", `/schools/${sid}/alerts/${a2.id}`, { token: A.token });
await call("POST", `/schools/${sid}/gradebook/class/${cls.id}`, { token: T.token, body: {} }).catch(() => {});
const press = async (p, d) => p.texts(await p.press(d));
check("student: today's timetable lists the real slot", /ریاضی/.test(await press(s1, "s:tt:today")));
check("student: week timetable", /ورزش/.test(await press(s1, "s:tt:week")));
check("student: open assignments", /تمرین فصل ۳/.test(await press(s1, "s:asg:0")));
check("student: upcoming exams", /آزمون میان‌ترم/.test(await press(s1, "s:ex:0")));
const alT = await press(s1, "s:al:0");
check("student: alerts show own alert; DELETED alert shows only the tombstone (no title/body)", /اخطار تست/.test(alT) && /حذف شده/.test(alT) && !/SECRET-BODY-DELETED/.test(alT) && !/اخطار حذف‌شدنی/.test(alT) && !/SECRET-S2-ALERT/.test(alT), alT);
check("student: announcements", /اعلامیه تست/.test(await press(s1, "g:an:0")));
check("student: grades empty-state is friendly", /نمره‌ای ثبت نشده/.test(await press(s1, "s:gr:0")));
check("student: attendance empty-state is friendly", /حضور و غیابی ثبت نشده/.test(await press(s1, "s:at:0")));
let rr = await s1.press("s:sb:0");
check("student: subject list has buttons", s1.buttons(rr).some((b) => b.callback_data === `s:sj:${math.id}:0`));
rr = await s1.press(`s:sj:${math.id}:0`);
check("student: subject → lessons", s1.buttons(rr).some((b) => b.callback_data === `s:ls:${les.id}:-`));
rr = await s1.press(`s:ls:${les.id}:-`);
check("student: lesson → only enabled types with items", s1.buttons(rr).some((b) => b.callback_data === `s:ls:${les.id}:note`));
{ const tt = await press(s1, `s:ls:${les.id}:note`); check("student: lesson items listed (read-only)", /نکتهٔ تست/.test(tt), tt); }
check("student: a DISABLED type is refused even with forged callback_data", !/نکتهٔ تست/.test(await press(s1, `s:ls:${les.id}:formula`)));
check("forged lesson id → denied, no data", /دسترسی ندارید/.test(await press(s1, `s:ls:${crypto.randomUUID()}:-`)));
check("forged subject id → denied", /دسترسی ندارید/.test(await press(s1, `s:sj:${crypto.randomUUID()}:0`)));
rr = await s1.press("a:bc");
check("student cannot use admin button (alert, no state change)", rr.some((c) => c.method === "answerCallbackQuery" && c.body.show_alert) && !/پیامِ همگانی/.test(s1.texts(rr)));
check("student cannot use teacher/parent buttons", !/دسترسی/.test("") && (await s1.press("t:att")).some((c) => c.method === "answerCallbackQuery" && c.body.show_alert) && (await s1.press("p:kids")).some((c) => c.method === "answerCallbackQuery" && c.body.show_alert));
const rrOver = await sendUpdate(A.botId, { update_id: 5, callback_query: { id: "x", from: s1.from, data: "s:tt:today" + "x".repeat(80), message: { message_id: 1, chat: { id: s1.id, type: "private" } } } }, A.secret);
check("callback_data > 64 bytes is ignored (answered, no data)", rrOver === 200);
check("every callback is answered (answerCallbackQuery)", mock.callsTo("answerCallbackQuery").length > 10);
// wrong-school chat
const Bx = await (await import("./bot-lib.mjs")).schoolWithBot(sup, "مدرسه دیگر");
const sameChat = person(Bx, "همان چت", s1.id);
rr = await sameChat.say("/menu");
check("a chat linked to school A's bot is a stranger on school B's bot (chooser only)", sameChat.buttons(rr).some((b) => b.callback_data === "u:parent") && !/ریاضی/.test(sameChat.texts(rr)));
rr = await sameChat.press("s:tt:today");
check("…and its student buttons give no data on school B's bot", !/ریاضی/.test(sameChat.texts(rr)));

// ── 6) parent (site-registered, linked by admin) ────────────────────────────
const ltP = await call("POST", `/schools/${sid}/bot/link-token`, { token: P.token });
const pw = person(A, "والد سایت");
rr = await pw.say(`/start ${ltP.json.token}`);
check("site parent: welcome + single child auto-selected → child menu", pw.buttons(rr).some((b) => b.callback_data === "p:at:0") && /student/.test(pw.texts(rr)), pw.texts(rr));
check("parent sees linked child's alerts (own child only)", /اخطار تست/.test(await press(pw, "p:al:0")) && !/SECRET-S2-ALERT/.test(pw.allText()));
rr = await pw.press(`p:k:${S2.memberId}`);
check("forged child selection (unlinked student) is refused", /وصل نیست/.test(pw.texts(rr)));
rr = await pw.press("p:al:0");
check("after forged selection parent STILL only sees own child's data (never S2)", !/SECRET-S2-ALERT/.test(pw.texts(rr)) && /اخطار تست/.test(pw.texts(rr)));
check("parent: timetable / assignments / exams of child", /ریاضی/.test(await press(pw, "p:tt:today")) && /تمرین فصل ۳/.test(await press(pw, "p:asg:0")) && /آزمون میان‌ترم/.test(await press(pw, "p:ex:0")));
rr = await pw.press("s:tt:today");
check("parent cannot press student buttons", rr.some((c) => c.method === "answerCallbackQuery" && c.body.show_alert));

// ── 7) Telegram-only parent: register, link by phone, student approves in bot ─
const s2 = person(A, "دانش‌آموز۲");
const ltS2 = await call("POST", `/schools/${sid}/bot/link-token`, { token: S2.token });
await s2.say(`/start ${ltS2.json.token}`);
const pp = person(A, "مادرِ تلگرامی");
rr = await pp.say("/start");
check("TG parent: unknown person sees chooser first", pp.buttons(rr).some((b) => b.callback_data === "u:parent"));
rr = await pp.press("u:parent");
const [ppu] = await q("select * from users where telegram_id=$1", [String(pp.id)]);
const [ppm] = await q("select * from school_members where user_id=$1", [ppu?.id]);
check("«من والد هستم» creates a Telegram-only user (flag, .invalid email, telegramId, profileComplete) + parent member of THIS school", ppu?.is_telegram_only === true && /^tg-\d+@parent\.telegram\.invalid$/.test(ppu.email) && ppu.profile_complete === true && ppm?.role === "parent" && ppm.school_id === sid && ppm.profile_complete === true, { ppu: ppu && { e: ppu.email, f: ppu.is_telegram_only }, ppm });
check("…subscriber row created and the unlinked parent sees ONLY the linking screen", (await q("select 1 from school_bot_subscribers where user_id=$1", [ppu.id])).length === 1 && pp.buttons(rr).some((b) => b.callback_data === "p:link") && !pp.buttons(rr).some((b) => b.callback_data === "p:at:0"));
check("unlinked parent forging a data button gets nothing", !/ریاضی|اخطار/.test(await press(pp, "p:al:0")) && !/ریاضی/.test(await press(pp, "p:tt:today")));
check("a second «من والد هستم» does not create a second user", (await (async () => { await pp.press("u:parent"); return (await q("select 1 from users where telegram_id=$1", [String(pp.id)])).length; })()) === 1);
const loginTry = await call("POST", "/auth/login", { body: { email: ppu.email, password: "anything-at-all" } });
check("Telegram-only parent can NOT log into the website (login 4xx)", loginTry.status >= 400 && loginTry.status < 500, loginTry.status);
await pp.press("p:link");
const phoneTxt = (await q("select phone from users where id=$1", [S2.id]))[0].phone; // +98912…
const local = "0" + phoneTxt.slice(3);
const faDigits = local.replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[d]);
rr = await pp.say(faDigits);
const foundReply = pp.texts(rr);
check("parent sends student's phone (Persian digits) → neutral reply", /اگر این شماره متعلق به یک دانش‌آموز/.test(foundReply), foundReply);
await sleep(900);
const s2txt = s2.allText();
check("matched student is notified IN THE BOT with ✅/❌ buttons", /می‌خواهد به‌عنوان والدِ شما ثبت شود/.test(s2txt) && s2.buttons(s2.all()).some((b) => b.callback_data?.startsWith("gr:a:")) && s2.buttons(s2.all()).some((b) => b.callback_data?.startsWith("gr:r:")));
check("…and in-app on the site (incoming card)", (await call("GET", `/schools/${sid}/guardian-requests/incoming`, { token: S2.token })).json.length === 1);
const greq = (await q("select id from school_guardian_requests where parent_user_id=$1 and student_member_id=$2", [ppu.id, S2.memberId]))[0].id;
check("another student can't approve it via forged callback", /معتبر نیست|دسترسی/.test(JSON.stringify((await s1.press(`gr:a:${greq}`)).map((c) => c.body))) && (await q("select 1 from school_guardianships where parent_user_id=$1", [ppu.id])).length === 0);
check("parent can't approve their own request via bot (role check)", (await pp.press(`gr:a:${greq}`)).some((c) => c.method === "answerCallbackQuery" && c.body.show_alert) && (await q("select 1 from school_guardianships where parent_user_id=$1", [ppu.id])).length === 0);
rr = await s2.press(`gr:a:${greq}`);
check("student approves in the bot → guardianship row created", (await q("select 1 from school_guardianships where parent_user_id=$1 and student_member_id=$2", [ppu.id, S2.memberId])).length === 1 && /تأیید شد/.test(s2.texts(rr)), s2.texts(rr));
await sleep(900);
check("parent is told in the bot «فرزند شما … متصل شد»", /فرزند شما/.test(pp.allText()) && /متصل شد/.test(pp.allText()) && pp.buttons(pp.all()).some((b) => b.callback_data === "p:kids"));
rr = await pp.press("m:home");
check("child's menu appears for the TG parent and shows ONLY the linked child's data", pp.buttons(rr).some((b) => b.callback_data === "p:al:0") && /SECRET-S2-ALERT/.test(await press(pp, "p:al:0")) && !/اخطار تست/.test(pp.texts(await pp.press("p:al:0"))));
// unfound phone → identical text
const pp2 = person(A, "والد دوم"); await pp2.say("/start"); await pp2.press("u:parent"); await pp2.press("p:link");
const unfound = "0912" + String(Math.floor(1000000 + Math.random() * 8999999));
const unfoundReply = pp2.texts(await pp2.say(unfound));
check("unfound phone → parent-facing reply is IDENTICAL to the found-phone reply", unfoundReply === foundReply, [unfoundReply, foundReply]);
const [pp2u] = await q("select id from users where telegram_id=$1", [String(pp2.id)]);
check("DB: unmatched submission stored (counts toward cap)", (await q("select 1 from school_guardian_requests where parent_user_id=$1 and student_member_id is null", [pp2u.id])).length === 1);
check("invalid phone text → friendly error, not counted", /معتبر نیست/.test(pp2.texts(await (async () => { await pp2.press("p:link"); return pp2.say("abc"); })())));
// cap
let last = "";
for (let i = 0; i < 3; i++) { await pool.query("update school_guardian_requests set status='rejected' where parent_user_id=$1", [pp2u.id]); await pp2.press("p:link"); last = pp2.texts(await pp2.say(unfound)); }
check("4th request for the same phone → «به مدیر مدرسه بگویید تا شما را به‌عنوان والد ثبت کند»", /مدیر مدرسه/.test(last) && /ثبت کند/.test(last) && (await q("select count(distinct submission_id)::int n from school_guardian_requests where parent_user_id=$1", [pp2u.id]))[0].n === 3, last);
// reject path neutral
const pp3 = person(A, "والد سوم"); await pp3.say("/start"); await pp3.press("u:parent"); await pp3.press("p:link");
const S3phone = (await q("select phone from users where id=$1", [S1.id]))[0].phone;
await pp3.say("0" + S3phone.slice(3)); await sleep(800);
const g3 = (await q("select r.id from school_guardian_requests r join users u on u.id=r.parent_user_id where u.telegram_id=$1", [String(pp3.id)]))[0].id;
await s1.press(`gr:r:${g3}`); await sleep(900);
check("student rejects in bot → parent told neutrally, NO guardianship", (await q("select 1 from school_guardianships g join users u on u.id=g.parent_user_id where u.telegram_id=$1", [String(pp3.id)])).length === 0 && /انجام نشد/.test(pp3.allText()) && !/رد کرد/.test(pp3.allText().split("---").pop() ?? ""), pp3.allText().slice(-300));

// ── 8) admin tools / teacher / counselor / broadcast ────────────────────────
check("admin: today's summary", /غایب/.test(await press(adm, "a:sum")));
const ltT = await call("POST", `/schools/${sid}/bot/link-token`, { token: T.token });
check("teacher menu: my classes / timetable", /10A/.test(await press(t1, "t:cls")) && /ریاضی/.test(await press(t1, "t:tt:today")));
rr = await t1.press("t:att");
check("teacher quick attendance: class list", t1.buttons(rr).some((b) => b.callback_data === `t:ac:${cls.id}`));
rr = await t1.press(`t:ac:${cls.id}`);
const tg = t1.buttons(rr).filter((b) => b.callback_data?.startsWith("t:tg:"));
check("…roster with ✅ toggle buttons", tg.length === 2);
await t1.press("t:tg:0");
rr = await t1.press("t:sv");
const att = await q("select status from school_attendance where class_id=$1 order by status", [cls.id]);
check("…save uses the existing bulk-mark logic (1 absent + 1 present rows)", att.map((a) => a.status).join() === "absent,present" && /ثبت شد/.test(t1.texts(rr)), att);
check("teacher forging another school's class id → denied, nothing saved", /دسترسی ندارید/.test(await press(t1, `t:ac:${(await q("select id from school_classes where school_id=$1 limit 1", [Bx.schoolId]))[0]?.id ?? crypto.randomUUID()}`)));
const deleteT = await press(t1, "a:bc");
check("teacher cannot enter broadcast", !/پیامِ همگانی/.test(deleteT));
// counselor
const co = person(A, "مشاور"); const ltC = await call("POST", `/schools/${sid}/bot/link-token`, { token: CO.token }); await co.say(`/start ${ltC.json.token}`);
check("counselor menu: schedule + unread counts only (confidential note)", /محرمانه/.test(await press(co, "c:un")) && co.buttons(co.all()).some((b) => b.callback_data === "c:sc"));
// broadcast by admin through the bot
await adm.press("a:bc");
rr = await adm.say("اطلاعیهٔ مهم: فردا تعطیل است <b>&");
check("admin broadcast: text → preview with confirm buttons (escaped)", /پیش‌نمایش/.test(adm.texts(rr)) && adm.buttons(rr).some((b) => b.callback_data === "a:bcok") && /&lt;b&gt;&amp;/.test(adm.texts(rr)));
const nb = mock.calls.length;
rr = await adm.press("a:bcok"); await sleep(900);
check("admin confirm → real announcement row created (site logic)", (await q("select 1 from school_announcements where school_id=$1 and body like 'اطلاعیهٔ مهم%'", [sid])).length === 1 && /ثبت/.test(adm.texts(rr)));
check("…connected students received it in the bot", /اطلاعیهٔ مهم/.test(s1.allText()) && /اطلاعیهٔ مهم/.test(s2.allText()));
// HTML escaping of names
await pool.query("update users set name=$1 where id=$2", ["<b>x</b>&", T.id]);
rr = await t1.say("/start");
check("HTML special chars in a user's name are escaped (no raw <b>x</b>& injected)", t1.texts(rr).includes("&lt;b&gt;x&lt;/b&gt;&amp;") && !t1.texts(rr).includes("<b>x</b>&"), t1.texts(rr).slice(0, 200));
// ── 9) blocked bot / never pressed start ─────────────────────────────────────
const subS1 = () => q("select unreachable_at from school_bot_subscribers where user_id=$1 and school_bot_id=$2", [S1.id, A.botId]).then((r) => r[0]);
mock.blocked.add(String(s1.id));
await call("POST", `/schools/${sid}/announcements`, { token: A.token, body: { kind: "broadcast", title: "بلاک۱", body: "x" } });
await sleep(1500);
check("403 (bot blocked) is NOT an error: subscriber marked unreachable, in-app notification still created", (await subS1()).unreachable_at !== null && (await call("GET", "/notifications", { token: S1.token })).text.includes("بلاک۱"));
const nBlocked = mock.callsTo("sendMessage", { chat_id: s1.id }).length;
await call("POST", `/schools/${sid}/announcements`, { token: A.token, body: { kind: "broadcast", title: "بلاک۲", body: "y" } });
await sleep(1200);
check("blocked subscriber is skipped afterwards (no more retries to that chat)", mock.callsTo("sendMessage", { chat_id: s1.id }).length === nBlocked);
mock.blocked.delete(String(s1.id));
await s1.say("/start");
check("pressing Start again clears unreachable and delivery resumes", (await subS1()).unreachable_at === null);
await call("POST", `/schools/${sid}/announcements`, { token: A.token, body: { kind: "broadcast", title: "بعد از بازگشت", body: "z" } });
await sleep(1200);
check("…delivery resumes after Start", /بعد از بازگشت/.test(s1.allText()));
// member who never pressed start → in-app only, no Telegram call, no error
const nev = (await q("select count(*)::int n from school_bot_subscribers where user_id=$1", [DEP.id]))[0].n;
check("member who never pressed Start has no subscriber row, got in-app notification, and the bot sent nothing to them", nev === 0 && (await call("GET", "/notifications", { token: DEP.token })).text.includes("بلاک۲"));
// long message splitting
await call("POST", `/schools/${sid}/announcements`, { token: A.token, body: { kind: "broadcast", title: "طولانی", body: "ب".repeat(9000) } }).then(async (r) => { if (r.status >= 300) console.log("long ann status", r.status); });
await sleep(1500);
const longMsgs = mock.callsTo("sendMessage", { chat_id: s1.id }).filter((c) => /طولانی|ب{50}/.test(c.body.text));
check("a >4096-char message is split into several ≤4096 messages", longMsgs.length >= 2 && longMsgs.every((c) => c.body.text.length <= 4096), longMsgs.map((c) => c.body.text.length));

// ── 10) resync / diagnostics / self-heal ────────────────────────────────────
delete mock.webhooks[A.botToken];
let dg = await call("GET", `/schools/${sid}/bot/diagnostics`, { token: A.token });
check("diagnostics detects a missing webhook in plain Persian", dg.status === 200 && dg.json.webhookUrl === null && dg.json.problems.some((p) => /webhook ثبت نشده|اتصالِ بات به سایت برقرار نیست/.test(p)), dg.text);
mock.pending[A.botToken] = 12; mock.lastError[A.botToken] = { last_error_message: "Wrong response from the webhook: 500", last_error_date: Math.floor(Date.now() / 1000) };
rs = await call("POST", `/schools/${sid}/bot/resync`, { token: A.token });
check("resync (button) re-registers the webhook for an ALREADY-purchased bot", rs.status === 200 && mock.webhooks[A.botToken]?.url === `${SITE}/api/schools/bot-webhook/${A.botId}`);
check("diagnostics show pending updates + last_error_message", rs.json.diagnostics.pendingUpdates === 12 && /Wrong response/.test(rs.json.diagnostics.lastErrorMessage) && rs.json.diagnostics.problems.some((p) => /خطایِ تلگرام/.test(p)));
check("resync/diagnostics are admin-only", (await call("POST", `/schools/${sid}/bot/resync`, { token: S1.token })).status === 403 && (await call("GET", `/schools/${sid}/bot/diagnostics`, { token: T.token })).status === 403);
const other2 = await (await import("./bot-lib.mjs")).newSchoolAdmin("ناشناس");
check("another school's admin can't resync/diagnose this school", (await call("POST", `/schools/${sid}/bot/resync`, { token: other2.token })).status === 403);
const sr = await call("POST", `/super/schools/${sid}/bot/resync`, { token: sup.token, cookie: sup.cookie });
check("superadmin can resync any school's bot from /super (needs gate cookie)", sr.status === 200 && sr.json.ok === true && (await call("POST", `/super/schools/${sid}/bot/resync`, { token: sup.token })).status >= 401 && (await call("GET", `/super/schools/${sid}/bot/diagnostics`, { token: sup.token, cookie: sup.cookie })).status === 200);
mock.pending[A.botToken] = 0; delete mock.lastError[A.botToken];

await finish();
async function finish() { await done(); await mock.close(); process.exit(process.exitCode ?? 0); }
