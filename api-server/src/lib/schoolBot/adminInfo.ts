/** راهنمایِ مدیر، متنِ دعوت، و وضعیتِ اتصالِ اعضا — مشترک بینِ باتِ تلگرام و کارتِ مدیر در سایت. */
import { and, eq, isNotNull } from "drizzle-orm";
import { db, schoolMembersTable, usersTable, schoolBotSubscribersTable, schoolBotsTable } from "@workspace/db";
import { esc } from "./tg";
import { fa, b } from "./util";
import { ROLE_FA } from "./actor";
import { siteBaseUrl } from "../schoolBotCore";

export function botLink(username: string | null): string | null { return username ? `https://t.me/${username}` : null; }

/** متنِ ساده (بدونِ HTML) آماده برایِ فوروارد — کپیِ سایت هم همین را نشان می‌دهد. */
export function inviteText(schoolName: string, username: string | null): string {
  const link = botLink(username) ?? "(لینکِ بات پس از اتصال ساخته می‌شود)";
  const site = siteBaseUrl();
  return [
    `📣 بات رسمیِ «${schoolName}»`,
    "",
    "برنامهٔ کلاسی، تکالیف، امتحان‌ها، نمرات، حضور و غیاب، اخطارها و اعلامیه‌ها را مستقیم در تلگرام ببینید و اعلان بگیرید.",
    "",
    `1) این لینک را باز کنید: ${link}`,
    "2) دکمهٔ Start را بزنید.",
    "⚠️ همه (دانش‌آموز، والد، معلم، …) باید یک‌بار Start را بزنند؛ بدونِ آن، بات نمی‌تواند برایتان پیام بفرستد.",
    "",
    `• دانش‌آموز/معلم/مشاور: ابتدا در سایت ثبت‌نام کنید${site ? ` (${site}/schools)` : ""} و در پروفایل «اتصال به بات» را بزنید.`,
    "• والدین: نیازی به ثبت‌نام در سایت نیست؛ در بات «من والد هستم» را بزنید و با شمارهٔ فرزندتان به او وصل شوید.",
  ].join("\n");
}

export function adminGuideHtml(schoolName: string, username: string | null): string {
  return [
    `${b("راهنمای مدیر")} — بات «${esc(schoolName)}»`,
    "",
    "⚠️ " + b("مهم: همه باید یک‌بار Start را بزنند") + " تا بات بتواند برایشان پیام بفرستد (قانونِ تلگرام). تا آن موقع اعلان‌ها فقط در سایت می‌رسد.",
    "",
    b("هر نقش در بات چه می‌بیند؟"),
    "🎓 " + b("دانش‌آموز") + ": برنامهٔ امروز/هفته، تکالیفِ باز، امتحان‌هایِ پیشِ‌رو، نمرات، حضور و غیاب، اخطارها، اعلامیه‌ها، درخواست‌هایِ اتصالِ والد (تأیید/رد) و فهرستِ درس‌ها.",
    "👪 " + b("والد") + ": انتخابِ فرزند و دیدنِ برنامه، حضور و غیاب، نمرات، اخطارها، تکالیف/امتحان و اعلامیه‌ها. والد لازم نیست در سایت ثبت‌نام کند؛ در بات «من والد هستم» را می‌زند و با شمارهٔ دانش‌آموز درخواستِ اتصال می‌دهد.",
    "👩‍🏫 " + b("معلم") + ": کلاس‌هایِ من، برنامهٔ امروز، اعلامیه‌ها و ثبتِ سریعِ حضور و غیاب.",
    "🧭 " + b("مدیر/معاون") + ": خلاصهٔ امروز (غایبین، کلاس‌هایِ بدونِ حضور و غیاب)، اعلامیه‌ها، ارسالِ پیامِ همگانی، وضعیتِ اتصالِ اعضا و همین راهنما.",
    "💬 " + b("مشاور") + ": برنامهٔ من و تعدادِ اعلان‌هایِ خوانده‌نشده (محتوایِ محرمانه فقط در سایت).",
    "",
    b("چه کنید؟"),
    "۱) پیامِ دعوتِ زیر را در گروه‌هایِ مدرسه/والدین بفرستید.",
    "۲) از «وضعیتِ اتصالِ اعضا» ببینید چه کسانی هنوز Start نزده‌اند و یادآوری کنید.",
    `۳) لینکِ بات: ${username ? esc("https://t.me/" + username) : "—"}`,
  ].join("\n");
}

export type ConnectionRole = { role: string; roleFa: string; total: number; connected: number; blocked: number; notStarted: string[] };

/** شمارش و فهرستِ نامِ اعضایِ Start‌نزده به‌تفکیکِ نقش (فقط نام؛ بدونِ شماره/ایمیل). */
export async function getConnections(schoolId: string): Promise<{ botId: string | null; roles: ConnectionRole[]; totals: { total: number; connected: number } }> {
  const [bot] = await db.select().from(schoolBotsTable).where(eq(schoolBotsTable.schoolId, schoolId)).limit(1);
  const members = await db.select({ userId: schoolMembersTable.userId, role: schoolMembersTable.role, name: usersTable.name, email: usersTable.email })
    .from(schoolMembersTable).innerJoin(usersTable, eq(usersTable.id, schoolMembersTable.userId))
    .where(and(eq(schoolMembersTable.schoolId, schoolId), isNotNull(schoolMembersTable.role)));
  const subs = bot ? await db.select().from(schoolBotSubscribersTable).where(eq(schoolBotSubscribersTable.schoolBotId, bot.id)) : [];
  const byUser = new Map<string, any>(subs.map((s: any) => [s.userId, s]));
  const order = ["admin", "deputy", "deputy_discipline", "teacher", "counselor", "student", "parent"];
  const roles: ConnectionRole[] = order.map((role) => {
    const ms = members.filter((m) => m.role === role);
    let connected = 0, blocked = 0; const notStarted: string[] = [];
    for (const m of ms) {
      const s = byUser.get(m.userId);
      if (s && !s.unreachableAt) connected++;
      else { if (s) blocked++; notStarted.push(m.name || (m.email ?? "").split("@")[0] || "—"); }
    }
    return { role, roleFa: ROLE_FA[role] ?? role, total: ms.length, connected, blocked, notStarted };
  }).filter((r) => r.total > 0);
  return { botId: bot?.id ?? null, roles, totals: { total: roles.reduce((a, r) => a + r.total, 0), connected: roles.reduce((a, r) => a + r.connected, 0) } };
}

export async function connectionsHtml(schoolId: string, limit = 15): Promise<string> {
  const c = await getConnections(schoolId);
  if (!c.roles.length) return `${b("وضعیتِ اتصالِ اعضا")}\nهنوز عضوی ثبت نشده است.`;
  const lines = [b("وضعیتِ اتصالِ اعضا"), `${fa(c.totals.connected)} از ${fa(c.totals.total)} نفر Start زده‌اند.`, ""];
  for (const r of c.roles) {
    lines.push(`${b(r.roleFa)}: ${fa(r.connected)}/${fa(r.total)}${r.blocked ? ` (⛔️ ${fa(r.blocked)} بلاک‌کرده)` : ""}`);
    if (r.notStarted.length) lines.push(`   هنوز Start نزده‌اند: ${r.notStarted.slice(0, limit).map(esc).join("، ")}${r.notStarted.length > limit ? ` و ${fa(r.notStarted.length - limit)} نفر دیگر` : ""}`);
  }
  return lines.join("\n");
}

/** HTMLِ تلگرام → متنِ ساده برایِ نمایش در سایت. */
export function stripHtmlGuide(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}
