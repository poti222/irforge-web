/**
 * lib/schoolBot/handler.ts — مغزِ باتِ مدرسه: آپدیتِ تلگرام (message / callback_query) → پاسخ.
 * ─────────────────────────────────────────────────────────────────────────
 * امنیت: فقط chat.id از ورودی اعتماد می‌شود و آن هم فقط برایِ پیدا کردنِ مشترکِ لینک‌شده؛ نقش از DB می‌آید.
 * داده‌ها از endpointهایِ سایت به‌نامِ همان کاربر (views.ts/internalApi.ts) — callback_dataِ جعلی همان ۴۰۳/۴۰۴ سایت را می‌گیرد.
 * سیاستِ «Start»: /start همیشه جواب می‌دهد (خوش‌آمد + منوی نقش). ناشناس‌ها فقط انتخابگر/ثبتِ والد را می‌بینند.
 */
import { and, eq, sql } from "drizzle-orm";
import { db, schoolBotLinkTokensTable, usersTable, schoolMembersTable, schoolAdminsTable, schoolsTable } from "@workspace/db";
import { logger } from "../logger";
import type { SchoolBotRow } from "../schoolBotCore";
import { siteBaseUrl } from "../schoolBotCore";
import { BotSender, esc, type Screen, type Kb } from "./tg";
import { actorForChat, actorForUser, ROLE_FA, ADMIN_LIKE, type Actor } from "./actor";
import { b, fa, getState, setState, clearState, tehranDateStr, withNav, HOME_BTN } from "./util";
import { apiAs } from "./internalApi";
import * as V from "./views";
import { registerTelegramParent, upsertSubscriber, parentSubmitPhone } from "./parentReg";
import { adminGuideHtml, inviteText, connectionsHtml } from "./adminInfo";
import { decideGuardianRequest } from "../schoolGuardianCore";

type Env = { bot: SchoolBotRow; sender: BotSender; schoolId: string; schoolName: string };
type Kid = { memberId: string; name: string };

// ─── صفحه‌هایِ ثابت ───
function chooserScreen(env: Env): Screen {
  return {
    text: `سلام 👋\nبه بات «${esc(env.schoolName)}» خوش آمدید.\n\nلطفاً بگویید کدام هستید:`,
    kb: [
      [{ text: "👪 من والد هستم", callback_data: "u:parent" }],
      [{ text: "🎓 دانش‌آموز", callback_data: "u:o:student" }, { text: "👩‍🏫 معلم", callback_data: "u:o:teacher" }],
      [{ text: "🧭 مدیر / معاون", callback_data: "u:o:admin" }, { text: "💬 مشاور", callback_data: "u:o:counselor" }],
    ],
  };
}
function otherRoleScreen(env: Env, role: string): Screen {
  const site = siteBaseUrl();
  const kb: Kb = [];
  if (site && /^https:/.test(site)) kb.push([{ text: "🌐 باز کردن سایت", url: `${site}/schools` }]);
  kb.push([{ text: "🔙 بازگشت", callback_data: "u:back" }]);
  return {
    text: [
      `${b(ROLE_FA[role] ?? "کاربر")} عزیز،`,
      "برای استفاده از بات باید ابتدا در سایتِ مدرسه ثبت‌نام کنید.",
      "",
      "۱) در سایت ثبت‌نام کنید و به مدرسه بپیوندید.",
      "۲) در سایت دکمهٔ «اتصال به بات» را بزنید و اینجا Start کنید.",
      "اگر تلگرامتان قبلاً به حسابِ سایت وصل است، کافی است همین‌جا دوباره /start بزنید.",
    ].join("\n"),
    kb,
  };
}
const STUDENT_KB: Kb = [
  [{ text: "📅 برنامهٔ امروز", callback_data: "s:tt:today" }, { text: "📆 برنامهٔ هفته", callback_data: "s:tt:week" }],
  [{ text: "📝 تکالیف باز", callback_data: "s:asg:0" }, { text: "🧪 امتحان‌ها", callback_data: "s:ex:0" }],
  [{ text: "📊 نمرات", callback_data: "s:gr:0" }, { text: "🗓 حضور و غیاب", callback_data: "s:at:0" }],
  [{ text: "⚠️ اخطارها", callback_data: "s:al:0" }, { text: "📢 اعلامیه‌ها", callback_data: "g:an:0" }],
  [{ text: "👪 درخواست‌هایِ والد", callback_data: "s:gq" }, { text: "📚 درس‌ها", callback_data: "s:sb:0" }],
];
const TEACHER_KB: Kb = [
  [{ text: "🏫 کلاس‌هایِ من", callback_data: "t:cls" }, { text: "📅 برنامهٔ امروز", callback_data: "t:tt:today" }],
  [{ text: "📆 برنامهٔ هفته", callback_data: "t:tt:week" }, { text: "📢 اعلامیه‌ها", callback_data: "g:an:0" }],
  [{ text: "✅ ثبتِ سریعِ حضور و غیاب", callback_data: "t:att" }],
];
const ADMIN_KB: Kb = [
  [{ text: "📋 خلاصهٔ امروز", callback_data: "a:sum" }, { text: "🔎 حضورِ ثبت‌نشده", callback_data: "a:unm" }],
  [{ text: "📢 اعلامیه‌ها", callback_data: "g:an:0" }, { text: "✉️ پیامِ همگانی", callback_data: "a:bc" }],
  [{ text: "🔗 وضعیتِ اتصالِ اعضا", callback_data: "a:conn" }, { text: "📖 راهنمای مدیر", callback_data: "a:guide" }],
  [{ text: "📨 متنِ دعوت", callback_data: "a:inv" }],
];
const COUNSELOR_KB: Kb = [
  [{ text: "🗓 برنامهٔ من", callback_data: "c:sc" }, { text: "🔔 اعلان‌ها", callback_data: "c:un" }],
  [{ text: "📢 اعلامیه‌ها", callback_data: "g:an:0" }],
];
const CHILD_KB: Kb = [
  [{ text: "📅 برنامه", callback_data: "p:tt:today" }, { text: "🗓 حضور و غیاب", callback_data: "p:at:0" }],
  [{ text: "📊 نمرات", callback_data: "p:gr:0" }, { text: "⚠️ اخطارها", callback_data: "p:al:0" }],
  [{ text: "📝 تکالیف", callback_data: "p:asg:0" }, { text: "🧪 امتحان‌ها", callback_data: "p:ex:0" }],
  [{ text: "📢 اعلامیه‌ها", callback_data: "g:an:0" }, { text: "🔄 فرزندانِ من", callback_data: "p:kids" }],
  [{ text: "➕ اتصال به فرزندِ دیگر", callback_data: "p:link" }],
];

async function getKids(actor: Actor, schoolId: string): Promise<Kid[]> {
  const r = await apiAs(actor.userId, "GET", `/schools/${schoolId}/timetable/mine`);
  if (r.status !== 200) return [];
  return (r.json?.children ?? []).map((k: any) => ({ memberId: k.childMemberId, name: k.childName || "فرزند" }));
}

function linkScreen(): Screen {
  return {
    text: [b("اتصال به فرزند"), "", "برایِ دیدنِ اطلاعاتِ فرزندتان، باید دانش‌آموز درخواستِ شما را تأیید کند.", "شمارهٔ موبایلی را بفرستید که فرزندتان در سایتِ مدرسه ثبت کرده است (مثلاً ۰۹۱۲۱۲۳۴۵۶۷)."].join("\n"),
    kb: [[{ text: "❌ انصراف", callback_data: "p:linkx" }]],
  };
}

async function parentHome(env: Env, actor: Actor, chatId: string, forcePick = false): Promise<Screen> {
  const kids = await getKids(actor, env.schoolId);
  if (!kids.length) {
    return { text: `سلام ${esc(actor.name)} 👋\nهنوز به هیچ دانش‌آموزی وصل نشده‌اید.\n\nبرایِ شروع، با شمارهٔ فرزندتان درخواستِ اتصال بدهید.`, kb: [[{ text: "➕ اتصال به فرزند", callback_data: "p:link" }]] };
  }
  const st = await getState(env.bot.id, chatId);
  let cur = !forcePick ? kids.find((k) => k.memberId === st?.data?.child) : undefined;
  if (!cur && kids.length === 1 && !forcePick) cur = kids[0];
  if (!cur) {
    return {
      text: `${b("فرزندانِ شما")}\nیکی را انتخاب کنید:`,
      kb: [...kids.map((k) => [{ text: `👤 ${k.name}`, callback_data: `p:k:${k.memberId}` }]), [{ text: "➕ اتصال به فرزندِ دیگر", callback_data: "p:link" }]],
    };
  }
  await setState(env.bot.id, chatId, "ctx", { child: cur.memberId });
  return { text: `${b("منویِ والد")}\nفرزند: ${b(cur.name)}`, kb: CHILD_KB };
}

export async function homeScreen(env: Env, actor: Actor, chatId: string, forcePick = false): Promise<Screen> {
  if (actor.role === "parent") return parentHome(env, actor, chatId, forcePick);
  if (actor.role === "student") return { text: `${b("منویِ دانش‌آموز")}\nچه چیزی را ببینیم؟`, kb: STUDENT_KB };
  if (actor.role === "teacher") return { text: `${b("منویِ معلم")}\nچه چیزی را ببینیم؟`, kb: TEACHER_KB };
  if (actor.role === "counselor") return { text: `${b("منویِ مشاور")}`, kb: COUNSELOR_KB };
  return { text: `${b("منویِ مدیریت")}\nچه چیزی را ببینیم؟`, kb: ADMIN_KB };
}

function welcomeText(env: Env, actor: Actor): string {
  return [
    `سلام ${b(actor.name)} 👋`,
    `به بات «${esc(env.schoolName)}» خوش آمدید.`,
    `✅ اتصالِ شما به‌عنوان ${b(ROLE_FA[actor.role] ?? actor.role)} برقرار شد؛ از این پس اعلان‌هایِ مدرسه همین‌جا می‌رسد.`,
    "با دکمه‌هایِ زیر هر بخش را ببینید. هر وقت خواستید /menu را بفرستید.",
  ].join("\n");
}

async function sendHome(env: Env, actor: Actor, chatId: string, first?: string) {
  const s = await homeScreen(env, actor, chatId);
  await env.sender.send(chatId, (first ? first + "\n\n" : "") + s.text, s.kb);
}

// ─── /start ───
async function consumeLinkToken(env: Env, linkToken: string): Promise<string | null> {
  const [row] = await db.select().from(schoolBotLinkTokensTable)
    .where(and(eq(schoolBotLinkTokensTable.token, linkToken), eq(schoolBotLinkTokensTable.schoolBotId, env.bot.id))).limit(1);
  if (!row || row.used || row.expiresAt < new Date()) return null;
  const [consumed] = await db.update(schoolBotLinkTokensTable).set({ used: true })
    .where(and(eq(schoolBotLinkTokensTable.token, linkToken), eq(schoolBotLinkTokensTable.used, false))).returning();
  return consumed ? row.userId : null;
}

async function handleStart(env: Env, msg: any, payload: string) {
  const chatId = String(msg.chat.id);
  const tgUserId = String(msg.from?.id ?? msg.chat.id);
  let userId: string | null = null;
  let firstTime = false;

  if (payload) {
    const uid = await consumeLinkToken(env, payload);
    if (uid && (await actorForUser(uid, env.schoolId))) {
      const r = await upsertSubscriber(env.bot.id, uid, chatId, tgUserId);
      userId = uid; firstTime = r.created || r.wasUnreachable;
    } else {
      await env.sender.send(chatId, "⚠️ این لینکِ اتصال منقضی یا نامعتبر است. از داخلِ سایت دوباره «اتصال به بات» را بزنید. (در همین حال می‌توانید ادامه دهید.)");
    }
  }
  if (!userId) {
    const known = await actorForChat(env.bot.id, env.schoolId, chatId);
    if (known) { const r = await upsertSubscriber(env.bot.id, known.userId, chatId, tgUserId); userId = known.userId; firstTime = r.wasUnreachable; }
  }
  if (!userId) {
    // خودکار: تلگرامِ فرستنده به حسابِ سایتی وصل است که عضوِ همین مدرسه است.
    const [u] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.telegramId, tgUserId)).limit(1);
    if (u && (await actorForUser(u.id, env.schoolId))) {
      const r = await upsertSubscriber(env.bot.id, u.id, chatId, tgUserId);
      userId = u.id; firstTime = r.created || r.wasUnreachable;
    }
  }
  const actor = userId ? await actorForUser(userId, env.schoolId) : null;
  if (!actor) {
    const s = chooserScreen(env);
    await env.sender.send(chatId, s.text, s.kb);
    return;
  }
  await clearState(env.bot.id, chatId);
  await sendHome(env, actor, chatId, welcomeText(env, actor));
  if (ADMIN_LIKE.includes(actor.role) && (firstTime || payload)) await sendAdminGuide(env, chatId);
}

async function sendAdminGuide(env: Env, chatId: string) {
  const uname = env.bot.telegramUsername;
  await env.sender.send(chatId, adminGuideHtml(env.schoolName, uname));
  await env.sender.send(chatId, `📨 ${b("پیامِ دعوتِ آمادهٔ فوروارد")} (این پیام را برایِ همه بفرستید):`);
  await env.sender.send(chatId, esc(inviteText(env.schoolName, uname)), [[HOME_BTN]]);
}

// ─── پیام‌هایِ متنی ───
async function onMessage(env: Env, msg: any) {
  if (msg.chat?.type !== "private" || !msg.from || msg.from.is_bot) return;
  const chatId = String(msg.chat.id);
  const text: string = typeof msg.text === "string" ? msg.text.trim() : "";
  const m = /^\/(\w+)(?:@\w+)?(?:\s+([\s\S]*))?$/.exec(text);
  const cmd = m?.[1]?.toLowerCase();
  if (cmd === "start") return handleStart(env, msg, (m?.[2] ?? "").trim());

  const actor = await actorForChat(env.bot.id, env.schoolId, chatId);
  if (!actor) {
    // ناشناس: فقط انتخابگر — هیچ دادهٔ مدرسه‌ای/فهرستی.
    const s = chooserScreen(env);
    await env.sender.send(chatId, "ابتدا مشخص کنید کدام هستید 👇\n\n" + s.text, s.kb);
    return;
  }
  if (cmd === "menu") { await clearState(env.bot.id, chatId); return sendHome(env, actor, chatId); }
  if (cmd === "help") {
    await env.sender.send(chatId, `${b("راهنما")}\n• /menu منوی شما\n• /start شروع دوباره\nهمهٔ بخش‌ها با دکمه‌ها باز می‌شود.${ADMIN_LIKE.includes(actor.role) ? "\n• مدیر: دکمهٔ «راهنمای مدیر» را بزنید." : ""}`, [[HOME_BTN]]);
    return;
  }
  const st = await getState(env.bot.id, chatId);
  if (st?.state === "await_phone" && actor.role === "parent") {
    const r = await parentSubmitPhone(env.schoolId, actor.userId, text);
    if (r.done) await setState(env.bot.id, chatId, "ctx", { child: st.data.child });
    await env.sender.send(chatId, r.text, [[HOME_BTN]]);
    return;
  }
  if (st?.state === "await_broadcast" && ADMIN_LIKE.includes(actor.role)) {
    if (!text || text.length > 2000) { await env.sender.send(chatId, "متن باید بینِ ۱ تا ۲۰۰۰ نویسه باشد. دوباره بفرستید یا انصراف دهید.", [[{ text: "❌ انصراف", callback_data: "a:bcno" }]]); return; }
    await setState(env.bot.id, chatId, "confirm_broadcast", { text });
    await env.sender.send(chatId, `${b("پیش‌نمایشِ پیامِ همگانی")}\n\n${esc(text)}\n\nبرایِ همهٔ اعضایِ مدرسه ارسال شود؟`, [[{ text: "✅ ارسال", callback_data: "a:bcok" }, { text: "❌ انصراف", callback_data: "a:bcno" }]]);
    return;
  }
  await sendHome(env, actor, chatId);
}

// ─── دکمه‌ها ───
async function onCallback(env: Env, cq: any) {
  const msg = cq.message;
  const ans = (t?: string, alert = false) => env.sender.answer(cq.id, t, alert);
  if (!msg || msg.chat?.type !== "private" || typeof cq.data !== "string" || cq.data.length > 64) { await ans(); return; }
  const chatId = String(msg.chat.id);
  const mid: number = msg.message_id;
  const data: string = cq.data;
  const show = async (s: Screen) => { await env.sender.edit(chatId, mid, s.text, s.kb); };

  const actor = await actorForChat(env.bot.id, env.schoolId, chatId);
  const [pre, a1, a2, a3] = data.split(":");

  // ناشناس‌ها
  if (!actor) {
    if (data === "u:parent") {
      const reg = await registerTelegramParent(env.schoolId, { id: Number(cq.from.id), first_name: cq.from.first_name, last_name: cq.from.last_name, username: cq.from.username });
      if (!reg.ok) {
        await ans();
        await show({ text: reg.reason === "error" ? "⚠️ ثبتِ نام ممکن نشد. کمی بعد دوباره /start بزنید." : "حسابِ تلگرامِ شما در سایت با نقش/مدرسهٔ دیگری ثبت شده است؛ با همان حساب وارد شوید یا به مدیر مدرسه بگویید شما را ثبت کند.", kb: [[{ text: "🔙 بازگشت", callback_data: "u:back" }]] });
        return;
      }
      await upsertSubscriber(env.bot.id, reg.userId, chatId, String(cq.from.id));
      const act = await actorForUser(reg.userId, env.schoolId);
      await ans("ثبت شد ✅");
      if (act) { const s = await homeScreen(env, act, chatId); await show({ text: welcomeText(env, act) + "\n\n" + s.text, kb: s.kb }); }
      return;
    }
    await ans();
    if (data.startsWith("u:o:")) return show(otherRoleScreen(env, a2));
    return show(chooserScreen(env));
  }

  try {
    await routeCallback(env, actor, chatId, mid, data, [pre, a1, a2, a3], ans, show);
  } catch (err) {
    logger.error({ err, data }, "school bot callback error");
    await ans("خطایی رخ داد", true);
  }
}

async function routeCallback(env: Env, actor: Actor, chatId: string, mid: number, data: string, p: string[], ans: (t?: string, a?: boolean) => Promise<void>, show: (s: Screen) => Promise<void>) {
  const [pre, a1, a2, a3] = p;
  const page = (x?: string) => Math.max(0, parseInt(x ?? "0", 10) || 0);
  const roleOk = (...roles: string[]) => roles.includes(actor.role);
  const deny = async () => { await ans("⛔️ دسترسی ندارید", true); };

  if (data === "m:home" || data === "u:back") { await ans(); await clearState(env.bot.id, chatId).catch(() => {}); const s = await homeScreen(env, actor, chatId); return show(s); }
  const vc = async (): Promise<V.VCtx | null> => {
    let child: Kid | null = null;
    if (actor.role === "parent") {
      const kids = await getKids(actor, env.schoolId);
      const st = await getState(env.bot.id, chatId);
      child = kids.find((k) => k.memberId === st?.data?.child) ?? (kids.length === 1 ? kids[0] : null);
      if (!child) return null;
    }
    return { actor, schoolId: env.schoolId, schoolName: env.schoolName, child };
  };
  const guardParentChild = async (): Promise<V.VCtx | null> => { const c = await vc(); if (!c) { const s = await homeScreen(env, actor, chatId, true); await ans(); await show(s); } return c; };

  // مشترک: اعلامیه‌ها
  if (pre === "g" && a1 === "an") { await ans(); const c = await vc(); if (!c && actor.role === "parent") { const s = await homeScreen(env, actor, chatId, true); return show(s); } return show(await V.viewAnnouncements(c!, page(a2))); }

  // دانش‌آموز
  if (pre === "s") {
    if (!roleOk("student")) return deny();
    await ans();
    const c = (await vc())!;
    switch (a1) {
      case "tt": return show(await V.viewTimetable(c, a2 === "week" ? "week" : "today"));
      case "asg": return show(await V.viewAssignments(c, page(a2)));
      case "ex": return show(await V.viewExams(c, page(a2)));
      case "gr": return show(await V.viewGrades(c, page(a2)));
      case "at": return show(await V.viewAttendance(c, page(a2)));
      case "al": return show(await V.viewAlerts(c, page(a2)));
      case "gq": return show(await V.viewGuardianIncoming(c));
      case "sb": return show(await V.viewSubjects(c, page(a2)));
      case "sj": return show(await V.viewSubjectLessons(c, a2, page(a3)));
      case "ls": return show(await V.viewLesson(c, a2, a3 ?? "-"));
    }
    return;
  }
  // درخواستِ اتصالِ والد (دانش‌آموز)
  if (pre === "gr" && (a1 === "a" || a1 === "r")) {
    if (!roleOk("student") || !actor.memberId) return deny();
    const r = await decideGuardianRequest(env.schoolId, { id: actor.memberId, userId: actor.userId }, a2, a1 === "a" ? "approve" : "reject");
    if (r.status === 404) { await ans("این درخواست معتبر نیست", true); return; }
    if (r.status === 409) { await ans("قبلاً تصمیم گرفته شده است", true); return; }
    await ans(a1 === "a" ? "تأیید شد ✅" : "رد شد");
    const s = await V.viewGuardianIncoming({ actor, schoolId: env.schoolId, schoolName: env.schoolName });
    return show({ text: (a1 === "a" ? "✅ والد تأیید شد.\n\n" : "❌ درخواست رد شد.\n\n") + s.text, kb: s.kb });
  }

  // والد
  if (pre === "p") {
    if (!roleOk("parent")) return deny();
    await ans();
    if (a1 === "kids") return show(await homeScreen(env, actor, chatId, true));
    if (a1 === "k") {
      const kids = await getKids(actor, env.schoolId);
      const k = kids.find((x) => x.memberId === a2);
      if (!k) return show({ text: "⛔️ این فرزند به حسابِ شما وصل نیست.", kb: withNav() }); // idِ جعلی
      await setState(env.bot.id, chatId, "ctx", { child: k.memberId });
      return show(await homeScreen(env, actor, chatId));
    }
    if (a1 === "link") { const st = await getState(env.bot.id, chatId); await setState(env.bot.id, chatId, "await_phone", { child: st?.data?.child }); return show(linkScreen()); }
    if (a1 === "linkx") { const st = await getState(env.bot.id, chatId); await setState(env.bot.id, chatId, "ctx", { child: st?.data?.child }); return show(await homeScreen(env, actor, chatId)); }
    const c = await guardParentChild(); if (!c) return;
    const back = "m:home";
    switch (a1) {
      case "tt": return show(await V.viewTimetable(c, a2 === "week" ? "week" : "today", back));
      case "at": return show(await V.viewAttendance(c, page(a2), back));
      case "gr": return show(await V.viewGrades(c, page(a2), back));
      case "al": return show(await V.viewAlerts(c, page(a2), back));
      case "asg": return show(await V.viewAssignments(c, page(a2), back));
      case "ex": return show(await V.viewExams(c, page(a2), back));
    }
    return;
  }

  // معلم
  if (pre === "t") {
    if (!roleOk("teacher")) return deny();
    await ans();
    const c = (await vc())!;
    switch (a1) {
      case "cls": return show(await V.viewTeacherClasses(c));
      case "tt": return show(await V.viewTimetable(c, a2 === "week" ? "week" : "today"));
      case "att": case "ac": case "tg": case "pg": case "sv": return show(await teacherAttendance(env, actor, chatId, a1, a2));
    }
    return;
  }

  // مشاور
  if (pre === "c") {
    if (!roleOk("counselor")) return deny();
    await ans();
    const c = (await vc())!;
    if (a1 === "sc") return show(await V.viewCounselorSchedule(c));
    if (a1 === "un") return show(await V.viewUnreadCounts(c));
    return;
  }

  // مدیر/معاون
  if (pre === "a") {
    if (!roleOk(...ADMIN_LIKE)) return deny();
    await ans();
    return show(await adminScreens(env, actor, chatId, a1));
  }
  await ans();
}

async function adminScreens(env: Env, actor: Actor, chatId: string, act: string): Promise<Screen> {
  const back: Kb = withNav();
  const sid = `/schools/${env.schoolId}`;
  if (act === "sum") {
    const r = await apiAs(actor.userId, "GET", `${sid}/admin/absence-summary`);
    if (r.status !== 200) return { text: "⚠️ دریافتِ اطلاعات ممکن نشد.", kb: back };
    return { text: [b("خلاصهٔ امروز"), `📅 ${r.json.date}`, `❌ غایب: ${b(fa(r.json.absent))}`, `⏰ تأخیر: ${b(fa(r.json.late))}`, `🏫 تعدادِ کلاس‌ها: ${fa(r.json.classesTotal)}`].join("\n"), kb: withNav([[{ text: "🔎 کلاس‌هایِ بدونِ حضور و غیابِ امروز", callback_data: "a:unm" }]]) };
  }
  if (act === "unm") {
    // همان بررسیِ دکمهٔ سایت (به مدیرانِ مدرسه هم اعلان می‌دهد).
    const r = await apiAs(actor.userId, "POST", `${sid}/admin/check-unmarked-attendance`, {});
    if (r.status !== 200) return { text: "⚠️ بررسی ممکن نشد.", kb: back };
    const list: any[] = r.json?.unmarkedClasses ?? [];
    return { text: list.length ? `${b("کلاس‌هایِ بدونِ حضور و غیابِ امروز")}\n${list.map((c) => "• " + esc(c.name)).join("\n")}` : "✅ حضور و غیابِ همهٔ کلاس‌ها ثبت شده است.", kb: back };
  }
  if (act === "conn") return { text: await connectionsHtml(env.schoolId), kb: back };
  if (act === "guide") { await sendAdminGuide(env, chatId); return { text: "📖 راهنما و متنِ دعوت در پیام‌هایِ بالا ارسال شد.", kb: back }; }
  if (act === "inv") { await env.sender.send(chatId, esc(inviteText(env.schoolName, env.bot.telegramUsername))); return { text: "📨 متنِ دعوت ارسال شد؛ آن را فوروارد کنید.", kb: back }; }
  if (act === "bc") { await setState(env.bot.id, chatId, "await_broadcast", {}); return { text: `${b("پیامِ همگانی")}\nمتنِ پیام را بفرستید (تا ۲۰۰۰ نویسه). پیش از ارسال تأیید می‌گیریم.`, kb: [[{ text: "❌ انصراف", callback_data: "a:bcno" }]] }; }
  if (act === "bcno") { await clearState(env.bot.id, chatId); return { text: "انصراف داده شد.", kb: back }; }
  if (act === "bcok") {
    const st = await getState(env.bot.id, chatId);
    if (st?.state !== "confirm_broadcast" || !st.data.text) return { text: "پیامی برایِ ارسال نیست.", kb: back };
    await clearState(env.bot.id, chatId);
    const text: string = st.data.text;
    // همان ساختِ اعلامیهٔ سایت (مجوز + اعلانِ سایت/تلگرام آن‌جا انجام می‌شود).
    const r = await apiAs(actor.userId, "POST", `${sid}/announcements`, { kind: "broadcast", title: text.split("\n")[0].slice(0, 80), body: text });
    if (r.status === 403) return { text: "⛔️ نقشِ شما اجازهٔ ارسالِ پیامِ همگانی ندارد.", kb: back };
    if (r.status >= 300) return { text: "⚠️ ارسال ممکن نشد.", kb: back };
    return { text: "✅ پیامِ همگانی ثبت و برایِ اعضا ارسال شد.", kb: back };
  }
  return { text: "؟", kb: back };
}

// ─── ثبتِ سریعِ حضور و غیابِ معلم ───
async function teacherAttendance(env: Env, actor: Actor, chatId: string, act: string, arg?: string): Promise<Screen> {
  const sid = `/schools/${env.schoolId}`;
  if (act === "att") {
    const r = await apiAs(actor.userId, "GET", `${sid}/classes?mine=true`);
    const rows: any[] = r.status === 200 ? r.json : [];
    if (!rows.length) return { text: "هنوز به کلاسی اختصاص داده نشده‌اید.", kb: withNav() };
    return { text: `${b("ثبتِ سریعِ حضور و غیاب")}\nکلاس را انتخاب کنید:`, kb: withNav(rows.map((k) => [{ text: k.name, callback_data: `t:ac:${k.id}` }])) };
  }
  let st = await getState(env.bot.id, chatId);
  if (act === "ac") {
    // دسترسی را خودِ endpointِ سایت می‌سنجد (فقط معلمِ همان کلاس/مدیر ۲۰۰ می‌گیرد).
    const date = tehranDateStr();
    const gate = await apiAs(actor.userId, "GET", `${sid}/attendance?classId=${arg}&date=${date}`);
    if (gate.status !== 200) return { text: "⛔️ به این کلاس دسترسی ندارید.", kb: withNav([], "t:att") };
    const rows = await db.execute(
      // نامِ دانش‌آموزانِ روسترِ همین کلاس (پس از تأییدِ مجوز بالا)
      sql`select m.id as id, u.name as name from school_class_members cm join school_members m on m.id = cm.school_member_id join users u on u.id = m.user_id where cm.class_id = ${arg} and cm.role_in_class = 'student' and m.school_id = ${env.schoolId} order by u.name`,
    );
    const roster = ((rows as any).rows ?? rows).map((r: any) => ({ id: r.id, name: r.name || "—" }));
    if (!roster.length) return { text: "این کلاس دانش‌آموزی ندارد.", kb: withNav([], "t:att") };
    const marks: Record<string, string> = {};
    for (const a of gate.json ?? []) marks[a.studentMemberId] = a.status;
    await setState(env.bot.id, chatId, "att", { classId: arg, roster, marks, page: 0 });
    st = await getState(env.bot.id, chatId);
  }
  if (!st || st.state !== "att") return { text: "نشستِ حضور و غیاب منقضی شده؛ دوباره شروع کنید.", kb: withNav([], "t:att") };
  const d = st.data as { classId: string; roster: { id: string; name: string }[]; marks: Record<string, string>; page: number };
  if (act === "tg") {
    const i = parseInt(arg ?? "-1", 10);
    const s = d.roster[i];
    if (s) { d.marks[s.id] = (d.marks[s.id] ?? "present") === "present" ? "absent" : "present"; await setState(env.bot.id, chatId, "att", d); }
  }
  if (act === "pg") { d.page = Math.max(0, parseInt(arg ?? "0", 10) || 0); await setState(env.bot.id, chatId, "att", d); }
  if (act === "sv") {
    const entries = d.roster.map((s) => ({ studentMemberId: s.id, status: d.marks[s.id] ?? "present" }));
    const r = await apiAs(actor.userId, "POST", `${sid}/attendance`, { classId: d.classId, date: tehranDateStr(), entries });
    await clearState(env.bot.id, chatId);
    if (r.status >= 300) return { text: "⛔️ ثبت ممکن نشد (دسترسی یا خطا).", kb: withNav([], "t:att") };
    const ab = entries.filter((e) => e.status === "absent").length;
    return { text: `✅ حضور و غیابِ امروز ثبت شد.\nغایب: ${fa(ab)} • حاضر: ${fa(entries.length - ab)}`, kb: withNav() };
  }
  const per = 10;
  const pages = Math.max(1, Math.ceil(d.roster.length / per));
  const pg = Math.min(d.page, pages - 1);
  const kb: Kb = d.roster.slice(pg * per, pg * per + per).map((s, k) => {
    const i = pg * per + k;
    return [{ text: `${(d.marks[s.id] ?? "present") === "present" ? "✅" : "❌"} ${s.name}`.slice(0, 40), callback_data: `t:tg:${i}` }];
  });
  const nav: any[] = [];
  if (pg > 0) nav.push({ text: "◀️", callback_data: `t:pg:${pg - 1}` });
  if (pg < pages - 1) nav.push({ text: "▶️", callback_data: `t:pg:${pg + 1}` });
  if (nav.length) kb.push(nav);
  kb.push([{ text: "💾 ثبت", callback_data: "t:sv" }]);
  return { text: `${b("حضور و غیابِ امروز")}\nروی نامِ هر دانش‌آموز بزنید تا حاضر/غایب شود، سپس «ثبت».`, kb: withNav(kb, "t:att") };
}

// ─── ورودیِ اصلی ───
export async function handleUpdate(bot: SchoolBotRow, token: string, upd: any): Promise<void> {
  const [school] = await db.select({ name: schoolsTable.name }).from(schoolsTable).where(eq(schoolsTable.id, bot.schoolId)).limit(1);
  const env: Env = { bot, sender: new BotSender(bot.id, token), schoolId: bot.schoolId, schoolName: school?.name ?? "مدرسه" };
  if (upd?.message) return onMessage(env, upd.message);
  if (upd?.callback_query) return onCallback(env, upd.callback_query);
}
