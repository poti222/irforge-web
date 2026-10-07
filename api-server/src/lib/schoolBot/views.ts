/**
 * lib/schoolBot/views.ts — صفحه‌هایِ فهرستیِ باتِ مدرسه. همهٔ داده از endpointهایِ *خودِ سایت* و به‌نامِ همان کاربر
 * (internalApi.apiAs) می‌آید؛ پس مجوزها عیناً مثلِ سایت است و هر idِ جعلیِ callback_data همان ۴۰۳/۴۰۴ را می‌گیرد.
 */
import { apiAs } from "./internalApi";
import { esc, type Screen, type Kb } from "./tg";
import { DAYS, fa, jDate, jDateTime, tehranDow, paginate, pager, withNav, b, trunc } from "./util";
import type { Actor } from "./actor";

export type VCtx = { actor: Actor; schoolId: string; schoolName: string; child?: { memberId: string; name: string } | null };

const EMPTY = (t: string, back?: string): Screen => ({ text: t, kb: withNav([], back) });
const DENIED = (back?: string): Screen => EMPTY("⛔️ به این بخش دسترسی ندارید.", back);
const FAIL = (back?: string): Screen => EMPTY("⚠️ دریافتِ اطلاعات ممکن نشد. کمی بعد دوباره تلاش کنید.", back);
const sid = (c: VCtx) => `/schools/${c.schoolId}`;

type Slot = { dayOfWeek: number; startTime: string; endTime: string; subject: string; teacherName?: string | null; className?: string; classId: string; mine?: boolean };

function renderSlots(title: string, slots: Slot[], mode: "today" | "week", showClass = false): string {
  const dow = tehranDow();
  const days = mode === "today" ? [dow] : [0, 1, 2, 3, 4, 5, 6];
  const lines: string[] = [b(title)];
  let any = false;
  for (const d of days) {
    const ds = slots.filter((s) => s.dayOfWeek === d).sort((a, z) => a.startTime.localeCompare(z.startTime));
    if (!ds.length) continue;
    any = true;
    lines.push("", `📅 ${b(DAYS[d])}${d === dow && mode === "week" ? " (امروز)" : ""}`);
    for (const s of ds) lines.push(`• ${fa(s.startTime)}–${fa(s.endTime)}  ${esc(s.subject)}${s.teacherName ? ` — ${esc(s.teacherName)}` : ""}${showClass && s.className ? ` (${esc(s.className)})` : ""}`);
  }
  if (!any) lines.push("", mode === "today" ? "امروز زنگی ثبت نشده است. 🎉" : "هنوز برنامه‌ای ثبت نشده است.");
  return lines.join("\n");
}

// ─── برنامهٔ هفتگی (دانش‌آموز/معلم؛ والد با child) ───
export async function viewTimetable(c: VCtx, mode: "today" | "week", back = "m:home"): Promise<Screen> {
  const r = await apiAs(c.actor.userId, "GET", `${sid(c)}/timetable/mine`);
  if (r.status === 403) return DENIED(back);
  if (r.status !== 200) return FAIL(back);
  let slots: Slot[] = r.json?.slots ?? [];
  let title = mode === "today" ? "برنامهٔ امروز" : "برنامهٔ هفته";
  if (c.actor.role === "parent") {
    const kid = (r.json?.children ?? []).find((k: any) => k.childMemberId === c.child?.memberId);
    if (!kid) return DENIED(back);
    slots = kid.slots; title += ` — ${kid.childName}`;
  }
  const other = mode === "today" ? "week" : "today";
  const pre = c.actor.role === "parent" ? "p" : c.actor.role === "teacher" ? "t" : "s";
  return {
    text: renderSlots(title, slots, mode, c.actor.role === "teacher"),
    kb: withNav([[{ text: other === "week" ? "📆 کلِ هفته" : "📅 فقط امروز", callback_data: `${pre}:tt:${other}` }]], back),
  };
}

// ─── کلاس‌هایِ فرد (برایِ تکلیف/آزمون) ───
async function classIdsFor(c: VCtx): Promise<{ ids: string[]; names: Map<string, string> } | null> {
  const names = new Map<string, string>();
  if (c.actor.role === "parent") {
    const r = await apiAs(c.actor.userId, "GET", `${sid(c)}/timetable/mine`);
    if (r.status !== 200) return null;
    const kid = (r.json?.children ?? []).find((k: any) => k.childMemberId === c.child?.memberId);
    if (!kid) return null;
    for (const s of kid.slots) names.set(s.classId, s.className);
    return { ids: [...names.keys()], names };
  }
  const r = await apiAs(c.actor.userId, "GET", `${sid(c)}/classes?mine=true`);
  if (r.status !== 200) return null;
  for (const k of r.json ?? []) names.set(k.id, k.name);
  return { ids: [...names.keys()], names };
}

export async function viewAssignments(c: VCtx, page: number, back = "m:home"): Promise<Screen> {
  const cls = await classIdsFor(c);
  if (!cls) return FAIL(back);
  const all: any[] = [];
  for (const id of cls.ids) {
    const r = await apiAs(c.actor.userId, "GET", `${sid(c)}/assignments?classId=${id}`);
    if (r.status === 200) for (const a of r.json) all.push({ ...a, className: cls.names.get(id) });
  }
  const now = Date.now();
  const open = all.filter((a) => !a.dueDate || new Date(a.dueDate).getTime() >= now - 86400_000)
    .sort((x, y) => (x.dueDate ? new Date(x.dueDate).getTime() : Infinity) - (y.dueDate ? new Date(y.dueDate).getTime() : Infinity));
  if (!open.length) return EMPTY("📝 تکلیفِ بازی ندارید. 🎉", back);
  const pg = paginate(open, page);
  const pre = c.actor.role === "parent" ? "p" : "s";
  const lines = [b(`تکالیفِ باز (${fa(open.length)})`), ""];
  for (const a of pg.slice) lines.push(`📝 ${b(a.title)}${a.className ? ` — ${esc(a.className)}` : ""}`, `   مهلت: ${a.dueDate ? jDate(a.dueDate) : "بدونِ مهلت"}${a.description ? `\n   ${esc(trunc(a.description, 120))}` : ""}`, "");
  return { text: lines.join("\n"), kb: withNav([pager(`${pre}:asg`, pg.page, pg.pages)], back) };
}

export async function viewExams(c: VCtx, page: number, back = "m:home"): Promise<Screen> {
  const cls = await classIdsFor(c);
  if (!cls) return FAIL(back);
  const all: any[] = [];
  for (const id of cls.ids) {
    const r = await apiAs(c.actor.userId, "GET", `${sid(c)}/exams?classId=${id}`);
    if (r.status === 200) for (const e of r.json) all.push({ ...e, className: cls.names.get(id) });
  }
  const now = Date.now();
  const up = all.filter((e) => !e.scheduledAt || new Date(e.scheduledAt).getTime() >= now - 3600_000)
    .sort((x, y) => (x.scheduledAt ? new Date(x.scheduledAt).getTime() : Infinity) - (y.scheduledAt ? new Date(y.scheduledAt).getTime() : Infinity));
  if (!up.length) return EMPTY("🧪 امتحانِ پیشِ‌رویی ثبت نشده است.", back);
  const pg = paginate(up, page);
  const pre = c.actor.role === "parent" ? "p" : "s";
  const lines = [b(`امتحان‌هایِ پیشِ‌رو (${fa(up.length)})`), ""];
  for (const e of pg.slice) lines.push(`🧪 ${b(e.title)}${e.className ? ` — ${esc(e.className)}` : ""}`, `   زمان: ${e.scheduledAt ? jDateTime(e.scheduledAt) : "هنوز تعیین نشده"}${e.durationMinutes ? ` • ${fa(e.durationMinutes)} دقیقه` : ""}`, "");
  return { text: lines.join("\n"), kb: withNav([pager(`${pre}:ex`, pg.page, pg.pages)], back) };
}

export async function viewGrades(c: VCtx, page: number, back = "m:home"): Promise<Screen> {
  const path = c.actor.role === "parent" ? `${sid(c)}/gradebook/child/${c.child?.memberId}` : `${sid(c)}/gradebook/my`;
  const r = await apiAs(c.actor.userId, "GET", path);
  if (r.status === 403) return DENIED(back);
  if (r.status !== 200) return FAIL(back);
  const items: any[] = r.json?.items ?? [];
  if (!items.length) return EMPTY("📊 هنوز نمره‌ای ثبت نشده است.", back);
  const pg = paginate(items, page);
  const pre = c.actor.role === "parent" ? "p" : "s";
  const lines = [b("نمرات"), r.json.average !== null && r.json.average !== undefined ? `میانگین: ${b(fa(Number(r.json.average).toFixed(1)))}` : "", ""];
  for (const i of pg.slice) lines.push(`${i.itemType === "exam" ? "🧪" : "📝"} ${esc(i.itemTitle)}: ${b(i.value ? fa(i.value) : "—")}`);
  return { text: lines.join("\n"), kb: withNav([pager(`${pre}:gr`, pg.page, pg.pages)], back) };
}

const ATT: Record<string, string> = { present: "✅ حاضر", absent: "❌ غایب", late: "⏰ تأخیر", excused: "📄 موجه" };
export async function viewAttendance(c: VCtx, page: number, back = "m:home"): Promise<Screen> {
  const path = c.actor.role === "parent" ? `${sid(c)}/attendance/child/${c.child?.memberId}` : `${sid(c)}/attendance/my`;
  const r = await apiAs(c.actor.userId, "GET", path);
  if (r.status === 403) return DENIED(back);
  if (r.status !== 200) return FAIL(back);
  const rows: any[] = r.json ?? [];
  if (!rows.length) return EMPTY("🗓 هنوز حضور و غیابی ثبت نشده است.", back);
  const cnt = (s: string) => rows.filter((x) => x.status === s).length;
  const pg = paginate(rows, page, 10);
  const pre = c.actor.role === "parent" ? "p" : "s";
  const lines = [b("حضور و غیاب"), `✅ ${fa(cnt("present"))}  ❌ ${fa(cnt("absent"))}  ⏰ ${fa(cnt("late"))}`, ""];
  for (const a of pg.slice) lines.push(`${jDate(a.date)} — ${ATT[a.status] ?? esc(a.status)}${a.note ? ` (${esc(trunc(a.note, 60))})` : ""}`);
  return { text: lines.join("\n"), kb: withNav([pager(`${pre}:at`, pg.page, pg.pages)], back) };
}

export async function viewAlerts(c: VCtx, page: number, back = "m:home"): Promise<Screen> {
  const path = c.actor.role === "parent" ? `${sid(c)}/alerts/child/${c.child?.memberId}` : `${sid(c)}/alerts/my`;
  const r = await apiAs(c.actor.userId, "GET", path);
  if (r.status === 403) return DENIED(back);
  if (r.status !== 200) return FAIL(back);
  const rows: any[] = r.json ?? [];
  if (!rows.length) return EMPTY("✅ اخطاری ثبت نشده است.", back);
  const pg = paginate(rows, page, 6);
  const pre = c.actor.role === "parent" ? "p" : "s";
  const lines = [b(`اخطارها (${fa(rows.length)})`), ""];
  for (const a of pg.slice) {
    if (a.deleted) { lines.push("🗑 این اخطار حذف شده است.", ""); continue; } // فقط تومب‌استون — هیچ محتوایی
    lines.push(`${a.severity === "critical" ? "🚨" : a.severity === "warning" ? "⚠️" : "ℹ️"} ${b(a.title)} — ${jDate(a.createdAt)}`, esc(trunc(a.body, 300)), "");
  }
  return { text: lines.join("\n"), kb: withNav([pager(`${pre}:al`, pg.page, pg.pages)], back) };
}

export async function viewAnnouncements(c: VCtx, page: number, back = "m:home"): Promise<Screen> {
  let q = "";
  if (c.actor.role === "student" || c.actor.role === "teacher" || c.actor.role === "parent") {
    const cls = await classIdsFor(c);
    // اعلامیهٔ کلاس فقط برایِ یک کلاس در هر فراخوانی؛ فیدِ مدرسه همیشه.
    q = cls?.ids.length ? `?classId=${cls.ids[0]}` : "";
  }
  const r = await apiAs(c.actor.userId, "GET", `${sid(c)}/announcements${q}`);
  if (r.status === 403) return DENIED(back);
  if (r.status !== 200) return FAIL(back);
  const rows: any[] = r.json ?? [];
  if (!rows.length) return EMPTY("📢 اعلامیه‌ای وجود ندارد.", back);
  const pg = paginate(rows, page, 5);
  const lines = [b("اعلامیه‌ها"), ""];
  for (const a of pg.slice) lines.push(`${a.kind === "closure" ? "🔒" : "📢"} ${b(a.title)} — ${jDate(a.createdAt)}`, esc(trunc(a.body, 400)), "");
  return { text: lines.join("\n"), kb: withNav([pager("g:an", pg.page, pg.pages)], back) };
}

export async function viewGuardianIncoming(c: VCtx, back = "m:home"): Promise<Screen> {
  const r = await apiAs(c.actor.userId, "GET", `${sid(c)}/guardian-requests/incoming`);
  if (r.status === 403) return DENIED(back);
  if (r.status !== 200) return FAIL(back);
  const rows: any[] = r.json ?? [];
  if (!rows.length) return EMPTY("👪 درخواستِ اتصالِ والدِ بازی ندارید.", back);
  const lines = [b("درخواست‌هایِ اتصالِ والد"), "هر کس را که والدِ شماست تأیید کنید؛ ناشناس را رد کنید.", ""];
  const kb: Kb = [];
  for (const q of rows.slice(0, 8)) {
    lines.push(`👤 ${esc(q.parentName)} — ${jDate(q.createdAt)}`);
    kb.push([{ text: `✅ تأیید ${trunc(q.parentName, 14)}`, callback_data: `gr:a:${q.id}` }, { text: "❌ رد", callback_data: `gr:r:${q.id}` }]);
  }
  return { text: lines.join("\n"), kb: withNav(kb, back) };
}

// ─── درس‌ها (فقط خواندنی) ───
export async function viewSubjects(c: VCtx, page: number, back = "m:home"): Promise<Screen> {
  const r = await apiAs(c.actor.userId, "GET", `${sid(c)}/subjects`);
  if (r.status === 403) return DENIED(back);
  if (r.status !== 200) return FAIL(back);
  const rows: any[] = r.json ?? [];
  if (!rows.length) return EMPTY("📚 درسی ثبت نشده است.", back);
  const pg = paginate(rows, page, 8);
  const kb: Kb = pg.slice.map((s) => [{ text: `${s.name}${s.lessonCount ? ` (${fa(s.lessonCount)})` : ""}`, callback_data: `s:sj:${s.id}:0` }]);
  kb.push(pager("s:sb", pg.page, pg.pages));
  return { text: `${b("درس‌ها")}\nیک درس را انتخاب کنید.`, kb: withNav(kb, back) };
}

export async function viewSubjectLessons(c: VCtx, subjectId: string, page: number): Promise<Screen> {
  const back = "s:sb:0";
  const sr = await apiAs(c.actor.userId, "GET", `${sid(c)}/subjects/${subjectId}`);
  if (sr.status === 403 || sr.status === 404) return DENIED(back);
  if (sr.status !== 200) return FAIL(back);
  const lr = await apiAs(c.actor.userId, "GET", `${sid(c)}/content-lessons?subject=${encodeURIComponent(sr.json.name)}`);
  if (lr.status !== 200) return FAIL(back);
  const rows: any[] = lr.json ?? [];
  if (!rows.length) return EMPTY(`📚 ${esc(sr.json.name)}\nهنوز درسی/جلسه‌ای ثبت نشده است.`, back);
  const pg = paginate(rows, page, 8);
  const kb: Kb = pg.slice.map((l) => [{ text: `${trunc(l.title, 40)}${l.itemCount ? ` (${fa(l.itemCount)})` : ""}`, callback_data: `s:ls:${l.id}:-` }]);
  kb.push(pager(`s:sj:${subjectId}`, pg.page, pg.pages));
  return { text: `${b(sr.json.name)}\nجلسه‌ها:`, kb: withNav(kb, back) };
}

const TYPE_FA: Record<string, string> = { formula: "فرمول", note: "نکته", book: "کتاب", word: "لغت", question: "سؤال", quote: "جمله", poem: "شعر", grammar: "گرامر" };
export async function viewLesson(c: VCtx, lessonId: string, type: string): Promise<Screen> {
  const lr = await apiAs(c.actor.userId, "GET", `${sid(c)}/content-lessons/${lessonId}`);
  if (lr.status === 403 || lr.status === 404) return DENIED("s:sb:0");
  if (lr.status !== 200) return FAIL("s:sb:0");
  const lesson = lr.json;
  const back = "s:sb:0";
  const types: string[] = lesson.effectiveEnabledTypes ?? [];
  if (type === "-") {
    const kb: Kb = types.filter((t) => (lesson.typeCounts?.[t] ?? 0) > 0).map((t) => [{ text: `${TYPE_FA[t] ?? t} (${fa(lesson.typeCounts[t])})`, callback_data: `s:ls:${lessonId}:${t}` }]);
    return { text: kb.length ? `${b(lesson.title)}\nیک بخش را انتخاب کنید.` : `${b(lesson.title)}\nهنوز محتوایی ثبت نشده است.`, kb: withNav(kb, back) };
  }
  if (!types.includes(type)) return DENIED(`s:ls:${lessonId}:-`); // فقط typeهایِ روشن
  const ir = await apiAs(c.actor.userId, "GET", `${sid(c)}/content?schoolId=${c.schoolId}&lessonId=${lessonId}&type=${encodeURIComponent(type)}`);
  if (ir.status !== 200) return FAIL(`s:ls:${lessonId}:-`);
  const items: any[] = ir.json ?? [];
  const lines = [`${b(lesson.title)} — ${TYPE_FA[type] ?? esc(type)}`, ""];
  if (!items.length) lines.push("موردی نیست.");
  for (const it of items.slice(0, 25)) lines.push(`• ${b(it.title)}${it.body ? ` — ${esc(trunc(it.body, 140))}` : ""}`);
  if (items.length > 25) lines.push("", `… و ${fa(items.length - 25)} مورد دیگر در سایت`);
  return { text: lines.join("\n"), kb: withNav([], `s:ls:${lessonId}:-`) };
}

export async function viewTeacherClasses(c: VCtx, back = "m:home"): Promise<Screen> {
  const r = await apiAs(c.actor.userId, "GET", `${sid(c)}/classes?mine=true`);
  if (r.status === 403) return DENIED(back);
  if (r.status !== 200) return FAIL(back);
  const rows: any[] = r.json ?? [];
  if (!rows.length) return EMPTY("🏫 هنوز به کلاسی اختصاص داده نشده‌اید.", back);
  return { text: [b("کلاس‌های من"), "", ...rows.map((k) => `🏫 ${b(k.name)} — پایهٔ ${esc(k.grade ?? "—")}`)].join("\n"), kb: withNav([], back) };
}

export async function viewCounselorSchedule(c: VCtx, back = "m:home"): Promise<Screen> {
  const r = await apiAs(c.actor.userId, "GET", `${sid(c)}/counselor/schedule?counselorUserId=${c.actor.userId}`);
  if (r.status === 403) return DENIED(back);
  if (r.status !== 200) return FAIL(back);
  const rows: any[] = r.json ?? [];
  if (!rows.length) return EMPTY("🗓 برنامه‌ای برایِ شما ثبت نشده است.", back);
  const lines = [b("برنامهٔ من"), ""];
  for (const s of rows.slice(0, 20)) lines.push(`• ${esc(s.title ?? s.dayOfWeek ?? "")} ${esc(s.startTime ?? "")}${s.endTime ? "–" + esc(s.endTime) : ""}`);
  return { text: lines.join("\n"), kb: withNav([], back) };
}

export async function viewUnreadCounts(c: VCtx, back = "m:home"): Promise<Screen> {
  const r = await apiAs(c.actor.userId, "GET", `/notifications`);
  const rows: any[] = Array.isArray(r.json) ? r.json : r.json?.notifications ?? [];
  const unread = rows.filter((n) => !n.read && (!n.schoolId || n.schoolId === c.schoolId)).length;
  return { text: `${b("اعلان‌ها")}\n🔔 ${fa(unread)} اعلانِ خوانده‌نشده در سایت دارید.\n\n🔒 گفتگوها و یادداشت‌هایِ محرمانه فقط در سایت قابل‌مشاهده است (برایِ حفظِ حریمِ خصوصی در تلگرام نمایش داده نمی‌شود).`, kb: withNav([], back) };
}
