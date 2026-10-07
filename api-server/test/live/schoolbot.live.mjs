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

// @@PART2@@
await finish();
async function finish() { await done(); await mock.close(); process.exit(process.exitCode ?? 0); }
