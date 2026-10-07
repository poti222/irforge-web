/**
 * lib/schoolNotify.ts — بخش "/schools" فاز ۷ (بخش C): تکه‌یِ مرکزیِ سیستمِ
 * اعلان "برای همه‌چیز" که کاربر خواسته بود (آزمون/تکلیف/غیبت/اخطار/اعلامیه/…).
 * ─────────────────────────────────────────────────────────────────────────
 * دو تحویل، مستقل از هم:
 *   ۱) سایت — یک ردیف در همان جدولِ سراسریِ `notifications` (با `schoolId`
 *      پر، فازِ ۷ روی آن اضافه شد) به‌ازایِ هر کاربر؛ زنگوله/صفحه‌ی اعلان‌هایِ
 *      موجود بدونِ هیچ تغییری همین‌ها را هم نشان می‌دهد.
 *   ۲) تلگرام — فقط اگر مدرسه باتِ فعال دارد (`school_bots`)، برایِ هر
 *      کاربری از `userIds` که واقعاً به همان بات وصل شده (`school_bot_
 *      subscribers`، chat_id واقعی). با باتِ **پلتفرم** (`lib/notifyTelegram
 *      .ts`) فرق دارد — آن یکی برایِ اعلان‌هایِ سراسریِ سایت است و به بات
 *      مدرسه هیچ ربطی ندارد؛ دوباره‌کاری نکردیم، فقط توکن/گیرنده فرق دارد.
 *
 * قراردادِ بقیه‌ی این بخش: **هرگز throw نمی‌کند**. شکستِ تحویلِ تلگرام
 * (بات بلاک شده، chat پیدا نشد) نباید عملیاتِ اصلی (ثبتِ غیبت، صدورِ اخطار،
 * ساختنِ آزمون) را با خطا مواجه کند — دقیقاً همان قراردادِ notify.ts.
 */
import crypto from "crypto";
import { eq, and, inArray } from "drizzle-orm";
import { db, notificationsTable, schoolBotsTable, schoolBotSubscribersTable } from "@workspace/db";
import { logger } from "./logger";
import { getSchoolBotToken } from "./schoolBotCore";
import { tgApi } from "./telegram";

export type SchoolNotifyInput = {
  userIds: string[];
  schoolId: string;
  /** نوعِ اعلان — برایِ فرانت/فیلتر آینده (مثلاً "school_exam" | "school_attendance_absent" | ...) */
  kind: string;
  title: string;
  body: string;
  severity?: "info" | "warning" | "critical";
  /** ارجاعِ اختیاری به رکوردِ مبدأ (مثلاً id اخطار) تا بعداً بشود اعلانِ سایتِ مربوط را پاک کرد. */
  refId?: string;
};

/** ایموجیِ ابتدایِ پیامِ تلگرامی — همان الگویِ notifyTelegram.ts، ساده‌تر چون kind های مدرسه‌ای همه اطلاع‌رسانی‌اند نه موفق/ناموفق. */
function iconFor(severity: string): string {
  if (severity === "critical") return "🚨";
  if (severity === "warning") return "⚠️";
  return "🔔";
}

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** یک ردیف در `notifications` به‌ازایِ هر userId — بدونِ dedupe (هر رویدادِ مدرسه‌ای طبیعتاً یکتاست). */
async function deliverSiteNotifications(input: SchoolNotifyInput): Promise<void> {
  if (input.userIds.length === 0) return;
  try {
    await db.insert(notificationsTable).values(
      input.userIds.map((userId) => ({
        id: crypto.randomUUID(),
        userId,
        schoolId: input.schoolId,
        type: input.kind,
        severity: input.severity ?? "info",
        title: input.title,
        message: input.body,
        refId: input.refId ?? null,
        read: false,
      })),
    );
  } catch (err) {
    logger.warn({ err, kind: input.kind }, "schoolNotify: site notification insert failed (non-fatal)");
  }
}

/** تحویلِ تلگرامی از طریقِ باتِ **همان مدرسه** — فقط اگر مدرسه بات دارد و کاربر واقعاً به آن وصل شده. */
async function deliverTelegramNotifications(input: SchoolNotifyInput): Promise<void> {
  try {
    if (input.userIds.length === 0) return;
    const [bot] = await db.select().from(schoolBotsTable).where(eq(schoolBotsTable.schoolId, input.schoolId)).limit(1);
    if (!bot) return; // مدرسه بات ندارد — فقط تحویلِ سایت کافی است.

    const subscribers = await db.select().from(schoolBotSubscribersTable)
      .where(and(eq(schoolBotSubscribersTable.schoolBotId, bot.id), inArray(schoolBotSubscribersTable.userId, input.userIds)));
    if (subscribers.length === 0) return;

    const token = await getSchoolBotToken(bot);
    if (!token) return;

    const text = `${iconFor(input.severity ?? "info")} <b>${esc(input.title)}</b>\n\n${esc(input.body)}`;
    // پشت‌سرهم، نه Promise.all — همان دلیلِ notifyTelegram.ts (سقفِ نرخِ تلگرام).
    for (const sub of subscribers) {
      const result = await tgApi(token, "sendMessage", {
        chat_id: sub.telegramChatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      });
      if (!result.ok) {
        logger.debug({ userId: sub.userId, description: result.description }, "schoolNotify: telegram delivery not ok");
      }
      if (subscribers.length > 1) await new Promise((r) => setTimeout(r, 40));
    }
  } catch (err) {
    logger.warn({ err, kind: input.kind }, "schoolNotify: telegram delivery failed (non-fatal)");
  }
}

/**
 * تابعِ مرکزیِ فراخوانی از هر تریگر — سایت **همیشه** نوشته می‌شود؛ تلگرام
 * best-effort و بعد از آن، بدونِ انتظارِ صداکننده (fire-and-forget) تا
 * تأخیرِ رفت‌وبرگشتِ تلگرام هیچ درخواستی (ثبتِ غیبت، ساختنِ آزمون، …) را کند
 * نکند — دقیقاً همان الگویِ deliverToTelegramInBackground.
 */
export async function notifySchoolUsers(input: SchoolNotifyInput): Promise<void> {
  await deliverSiteNotifications(input);
  void deliverTelegramNotifications(input).catch((err) =>
    logger.warn({ err }, "notifySchoolUsers: telegram background delivery failed (non-fatal)"),
  );
}
