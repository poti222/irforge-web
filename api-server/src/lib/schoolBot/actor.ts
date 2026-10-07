/** هویتِ فرستندهٔ آپدیت: چت → مشترکِ لینک‌شده → کاربر → نقش در *همین* مدرسه. هرگز از ورودیِ تلگرام (جز chat.id) اعتماد نمی‌شود. */
import { and, desc, eq } from "drizzle-orm";
import { db, schoolBotSubscribersTable, schoolMembersTable, schoolAdminsTable, usersTable } from "@workspace/db";

export type Role = "student" | "parent" | "teacher" | "admin" | "deputy" | "deputy_discipline" | "counselor";
export const ADMIN_LIKE: Role[] = ["admin", "deputy", "deputy_discipline"];
export type Actor = { userId: string; name: string; role: Role; memberId: string | null; telegramOnly: boolean };

export const ROLE_FA: Record<string, string> = {
  student: "دانش‌آموز", parent: "والد", teacher: "معلم", admin: "مدیر", deputy: "معاون", deputy_discipline: "معاون انضباطی", counselor: "مشاور",
};

export async function actorForUser(userId: string, schoolId: string): Promise<Actor | null> {
  const [u] = await db.select({ name: usersTable.name, email: usersTable.email, tg: usersTable.isTelegramOnly }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!u) return null;
  const [m] = await db.select().from(schoolMembersTable).where(eq(schoolMembersTable.userId, userId)).limit(1);
  const name = u.name || u.email || "کاربر";
  if (m && m.schoolId === schoolId && m.role) return { userId, name, role: m.role as Role, memberId: m.id, telegramOnly: !!u.tg };
  const [extra] = await db.select().from(schoolAdminsTable).where(and(eq(schoolAdminsTable.userId, userId), eq(schoolAdminsTable.schoolId, schoolId))).limit(1);
  if (extra) return { userId, name, role: "admin", memberId: null, telegramOnly: !!u.tg };
  return null;
}

export async function subscriberForChat(botId: string, chatId: string) {
  const [s] = await db.select().from(schoolBotSubscribersTable)
    .where(and(eq(schoolBotSubscribersTable.schoolBotId, botId), eq(schoolBotSubscribersTable.telegramChatId, chatId)))
    .orderBy(desc(schoolBotSubscribersTable.linkedAt)).limit(1);
  return s ?? null;
}

/** چت → Actor (فقط اگر مشترکِ همین بات و هنوز عضوِ همین مدرسه باشد). */
export async function actorForChat(botId: string, schoolId: string, chatId: string): Promise<Actor | null> {
  const s = await subscriberForChat(botId, chatId);
  return s ? actorForUser(s.userId, schoolId) : null;
}
