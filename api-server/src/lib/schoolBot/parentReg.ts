/**
 * lib/schoolBot/parentReg.ts — والدِ «فقط-تلگرام»: ثبتِ خودکار از داخلِ بات + اتصال به فرزند با شمارهٔ دانش‌آموز.
 * ─────────────────────────────────────────────────────────────────────────
 * ‌• کاربرِ ساخته‌شده: ایمیلِ ساختگیِ `tg-<id>@parent.telegram.invalid`، رمزِ تصادفیِ ناشناخته، `isTelegramOnly=true`
 *   (ورودِ سایت برایِ او همه‌جا بسته است: auth.ts issueSession + ورودِ تلگرامیِ telegramWebhook.ts). فقط نشستِ کوتاه‌عمرِ
 *   باتِ داخلی دارد. اگر بعداً در سایت ثبت‌نام کرد، مدیر باید دستی پیوند بدهد (خارج از این فاز).
 * ‌• اگر کاربرِ واقعیِ سایت با همین telegramId هست از همان استفاده می‌شود.
 * ‌• اتصال به فرزند: *همان* منطقِ سایت (lib/schoolGuardianCore.ts) — سقف‌ها، پاسخِ خنثیِ یکسان، انقضا.
 */
import crypto from "crypto";
import { and, eq } from "drizzle-orm";
import { db, usersTable, schoolMembersTable, schoolBotSubscribersTable } from "@workspace/db";
import { hashPassword } from "../password";
import { logger } from "../logger";
import { submitGuardianRequest, notifyGuardianMatched, GUARDIAN_NEUTRAL_MESSAGE } from "../schoolGuardianCore";

export type TgFrom = { id: number; first_name?: string; last_name?: string; username?: string };

export type RegResult = { ok: true; userId: string; created: boolean } | { ok: false; reason: "other_role" | "other_school" | "error" };

export async function registerTelegramParent(schoolId: string, from: TgFrom): Promise<RegResult> {
  const tgId = String(from.id);
  try {
    let [user] = await db.select().from(usersTable).where(eq(usersTable.telegramId, tgId)).limit(1);
    let created = false;
    if (!user) {
      const name = [from.first_name, from.last_name].filter(Boolean).join(" ").trim() || from.username || "والد";
      try {
        [user] = await db.insert(usersTable).values({
          id: crypto.randomUUID(), name, email: `tg-${tgId}@parent.telegram.invalid`,
          passwordHash: await hashPassword(crypto.randomBytes(32).toString("hex")),
          role: "user", plan: "free", status: "active",
          telegramId: tgId, telegramUsername: from.username ?? null, telegramFirstName: from.first_name ?? null, telegramLastName: from.last_name ?? null,
          profileComplete: true, isTelegramOnly: true,
        }).returning();
        created = true;
      } catch (e) {
        // دو Startِ هم‌زمان: دومی همان ردیف را می‌خواند.
        [user] = await db.select().from(usersTable).where(eq(usersTable.telegramId, tgId)).limit(1);
        if (!user) throw e;
      }
    }
    const [m] = await db.select().from(schoolMembersTable).where(eq(schoolMembersTable.userId, user.id)).limit(1);
    if (m && m.schoolId === schoolId) return m.role === "parent" ? { ok: true, userId: user.id, created } : { ok: false, reason: "other_role" };
    if (m && m.schoolId && m.schoolId !== schoolId) return { ok: false, reason: "other_school" };
    if (m) await db.update(schoolMembersTable).set({ schoolId, role: "parent", profileComplete: true }).where(eq(schoolMembersTable.id, m.id));
    else await db.insert(schoolMembersTable).values({ id: crypto.randomUUID(), userId: user.id, schoolId, role: "parent", profileComplete: true });
    return { ok: true, userId: user.id, created };
  } catch (err) {
    logger.error({ err }, "registerTelegramParent failed");
    return { ok: false, reason: "error" };
  }
}

/** مشترک (chat→user) را upsert می‌کند و «Start زده» را ثبت/بازیابی می‌کند (unreachable پاک می‌شود). */
export async function upsertSubscriber(botId: string, userId: string, chatId: string, telegramUserId?: string): Promise<{ created: boolean; wasUnreachable: boolean }> {
  const [ex] = await db.select().from(schoolBotSubscribersTable).where(and(eq(schoolBotSubscribersTable.schoolBotId, botId), eq(schoolBotSubscribersTable.userId, userId))).limit(1);
  if (ex) {
    await db.update(schoolBotSubscribersTable).set({ telegramChatId: chatId, unreachableAt: null, ...(telegramUserId ? { telegramUserId } : {}) }).where(eq(schoolBotSubscribersTable.id, ex.id));
    return { created: false, wasUnreachable: !!ex.unreachableAt };
  }
  await db.insert(schoolBotSubscribersTable).values({ id: crypto.randomUUID(), schoolBotId: botId, userId, telegramChatId: chatId, telegramUserId: telegramUserId ?? null });
  return { created: true, wasUnreachable: false };
}

export const LIMIT_MESSAGE = "به سقفِ تعدادِ درخواست رسیده‌اید. لطفاً به مدیر مدرسه بگویید تا شما را به‌عنوان والد (و پیوند با فرزندتان) ثبت کند.";
export const INVALID_PHONE_MESSAGE = "شماره معتبر نیست. شمارهٔ موبایلِ دانش‌آموز را مثل ۰۹۱۲۱۲۳۴۵۶۷ بفرستید.";
export const PENDING_MESSAGE = "برایِ این شماره همین الان یک درخواستِ در انتظار دارید. منتظرِ تأییدِ دانش‌آموز بمانید.";

export type LinkOutcome = { text: string; done: boolean };

/** والد شمارهٔ دانش‌آموز را فرستاده. پاسخِ والد برایِ شمارهٔ پیداشده/پیدانشده کاملاً یکسان است. */
export async function parentSubmitPhone(schoolId: string, parentUserId: string, phoneText: string): Promise<LinkOutcome> {
  const r = await submitGuardianRequest(schoolId, parentUserId, phoneText);
  if (r.kind === "invalid_phone") return { text: INVALID_PHONE_MESSAGE, done: false };
  if (r.kind === "pending") return { text: PENDING_MESSAGE, done: true };
  if (r.kind === "limit") return { text: LIMIT_MESSAGE, done: true };
  // اعلان پس از ساختنِ پاسخ (نویسنده‌یِ فراخوان باید پاسخ را بفرستد؛ این‌جا fire-and-forget با تأخیرِ کوتاه).
  setTimeout(() => { void notifyGuardianMatched(schoolId, parentUserId, r.submissionId, r.matched).catch((err) => logger.warn({ err }, "bot guardian notify failed")); }, 300);
  const left = r.remaining > 0 ? `\n(${r.remaining} بارِ دیگر می‌توانید برایِ همین شماره درخواست بدهید.)` : "";
  return { text: `✅ ${GUARDIAN_NEUTRAL_MESSAGE}. پس از تأییدِ دانش‌آموز، همین‌جا به شما خبر می‌دهیم.${left}`, done: true };
}
