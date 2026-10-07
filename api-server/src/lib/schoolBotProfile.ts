/**
 * lib/schoolBotProfile.ts — همگام‌سازیِ کاملِ پروفایلِ باتِ مدرسه با تلگرام:
 * وب‌هوک، نام، توضیح‌ها، دستورها، دکمهٔ منو (و عکس — schoolBotPhoto.ts).
 * برایِ خریدِ جدید، دکمهٔ «اتصال بات / بروزرسانی بات» (مدیر/سوپرادمین) و تغییرِ نام/عکسِ مدرسه.
 */
import { db, schoolsTable, schoolBotsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
import { tgApi } from "./telegram";
import {
  loadSchoolBotBySchool, registerSchoolBotWebhook, refreshIdentity, siteBaseUrl, getSchoolBotDiagnostics,
  type SyncStep, type BotDiagnostics,
} from "./schoolBotCore";
import { syncSchoolBotPhoto, type PhotoSyncResult } from "./schoolBotPhoto";

export const BOT_COMMANDS = [
  { command: "start", description: "شروع / فعال‌سازیِ بات" },
  { command: "menu", description: "منوی من" },
  { command: "help", description: "راهنما" },
];

export function botShortDescription(schoolName: string): string {
  return `بات رسمیِ «${schoolName}». برای فعال شدن، یک‌بار Start را بزنید.`.slice(0, 120);
}
export function botDescription(schoolName: string): string {
  return (
    `بات اطلاع‌رسانی و خدماتِ «${schoolName}»\n\n` +
    `برنامهٔ کلاسی، تکالیف، امتحان‌ها، نمرات، حضور و غیاب و اعلامیه‌ها را اینجا ببینید.\n\n` +
    `⚠️ برای فعال شدن، یک‌بار دکمهٔ Start را بزنید؛ بدونِ آن پیامی به شما نمی‌رسد.`
  ).slice(0, 512);
}

async function step(name: string, fn: () => Promise<{ ok: boolean; description?: string }>): Promise<SyncStep> {
  try {
    const r = await fn();
    return { step: name, ok: !!r.ok, detail: r.ok ? undefined : r.description };
  } catch (err) {
    return { step: name, ok: false, detail: "ارتباط با تلگرام برقرار نشد." };
  }
}

export type ResyncResult = { ok: boolean; steps: SyncStep[]; photo: PhotoSyncResult | null; diagnostics: BotDiagnostics };

const inflight = new Map<string, Promise<ResyncResult>>();

export function resyncSchoolBot(schoolId: string, req?: { headers: Record<string, any>; protocol?: string }): Promise<ResyncResult> {
  const cur = inflight.get(schoolId);
  if (cur) return cur;
  const p = doResync(schoolId, req).finally(() => inflight.delete(schoolId));
  inflight.set(schoolId, p);
  return p;
}

async function doResync(schoolId: string, req?: { headers: Record<string, any>; protocol?: string }): Promise<ResyncResult> {
  const base = siteBaseUrl(req);
  const steps: SyncStep[] = [];
  const loaded = await loadSchoolBotBySchool(schoolId);
  if (!loaded) {
    return { ok: false, steps: [{ step: "bot", ok: false, detail: "بات یافت نشد یا توکنش خوانده نشد." }], photo: null, diagnostics: await getSchoolBotDiagnostics(schoolId, base) };
  }
  const { bot, token } = loaded;
  const [school] = await db.select().from(schoolsTable).where(eq(schoolsTable.id, schoolId)).limit(1);
  const name = school?.name ?? "مدرسه";

  steps.push(await refreshIdentity(bot, token));
  steps.push(await registerSchoolBotWebhook(bot, token, base));
  steps.push(await step("name", () => tgApi(token, "setMyName", { name: name.slice(0, 64) })));
  steps.push(await step("short_description", () => tgApi(token, "setMyShortDescription", { short_description: botShortDescription(name) })));
  steps.push(await step("description", () => tgApi(token, "setMyDescription", { description: botDescription(name) })));
  steps.push(await step("commands", () => tgApi(token, "setMyCommands", { commands: BOT_COMMANDS })));
  steps.push(await step("menu_button", () => tgApi(token, "setChatMenuButton", { menu_button: { type: "commands" } })));
  let photo: PhotoSyncResult | null = null;
  try {
    const jpegOk = bot.photoJpegImageId && bot.photoJpegSourceUrl && bot.photoJpegSourceUrl === (school?.photoUrl ?? null);
    photo = await syncSchoolBotPhoto(token, school?.photoUrl ?? null, jpegOk ? bot.photoJpegImageId : null);
    await db.update(schoolBotsTable).set({
      photoStatus: photo.status, lastResyncAt: new Date(),
      ...(photo.status === "set" ? { photoSyncedUrl: school?.photoUrl ?? null } : {}),
    }).where(eq(schoolBotsTable.id, bot.id));
    steps.push({ step: "photo", ok: photo.status === "set" || photo.status === "none", detail: photo.message });
  } catch (err) {
    logger.warn({ err, schoolId }, "school bot photo sync threw");
    steps.push({ step: "photo", ok: false, detail: "همگام‌سازیِ عکس ناموفق بود." });
  }
  const diagnostics = await getSchoolBotDiagnostics(schoolId, base);
  const critical = steps.filter((s) => s.step === "identity" || s.step === "webhook");
  return { ok: critical.every((s) => s.ok), steps, photo, diagnostics };
}

/** پس از خرید / تغییرِ نام یا عکسِ مدرسه — بی‌صدا، هرگز درخواستِ کاربر را خراب نمی‌کند. */
export function resyncSchoolBotInBackground(schoolId: string): void {
  void resyncSchoolBot(schoolId).catch((err) => logger.warn({ err, schoolId }, "school bot background resync failed (non-fatal)"));
}
