/**
 * routes/botUsers.ts — کاربران بات (تب `users`).
 * ─────────────────────────────────────────────────────────────────────────────
 * **صفحه‌بندی اجباری سمت سرور.** خواندن از شیت همیشه کل تب را می‌آورد (چاره‌ای
 * نیست — `readTabRows` یک `A:B` می‌خواند)، ولی آن کل تب هرگز به کلاینت نمی‌رود:
 * برش، جستجو و مرتب‌سازی اینجا انجام می‌شود و فقط یک صفحه برمی‌گردد. یک تب با
 * چند هزار کاربر وگرنه یک پاسخ چندمگابایتی می‌ساخت.
 *
 * روی همین، یک کش ۶۰ ثانیه‌ای درون‌پروسسی هست — هم‌اندازه‌ی `CACHE_TTL` خود بات —
 * تا ورق‌زدن صفحات، هر بار یک فراخوانی کامل به Google Sheets نزند.
 */
import { Router } from "express";
import { requireAuth } from "./auth.js";
import {
  resolveBotSheet,
  listEntity,
  getEntity,
  putEntity,
  assertSheetsAuthoritative,
  sendBotConfigError,
  BotConfigError,
} from "../lib/botConfig.js";
import { BOT_LANGUAGES, nowIso, type BotUser } from "../lib/botTypes.js";

const router = Router();
const USERS_TAB = "users";

function bad(message: string, code?: string): BotConfigError {
  return new BotConfigError(400, message, code);
}

// ─── کش ۶۰ ثانیه‌ای ─────────────────────────────────────────────────────────

const LIST_TTL_MS = 60_000;
const listCache = new Map<string, { at: number; users: BotUser[] }>();

function invalidateUsers(spreadsheetId: string): void {
  listCache.delete(spreadsheetId);
}

async function readUsers(spreadsheetId: string): Promise<BotUser[]> {
  const cached = listCache.get(spreadsheetId);
  if (cached && Date.now() - cached.at < LIST_TTL_MS) return cached.users;

  const rows = await listEntity<BotUser>(spreadsheetId, USERS_TAB);
  const users = rows
    .filter((r) => r.value && typeof r.value === "object")
    .map((r) => ({ ...(r.value as BotUser), user_id: String((r.value as BotUser).user_id ?? r.key) }));

  listCache.set(spreadsheetId, { at: Date.now(), users });
  return users;
}

/**
 * شکل سبکِ ردیف لیست. عمداً `form_data`, `profile_data`, `flood_timestamps` و
 * `orders` را نمی‌فرستد: در یک لیست هزارتایی این‌ها بیشترین حجم و کمترین فایده
 * را دارند و در صفحه‌ی جزئیات در دسترس‌اند.
 */
function toSummary(user: BotUser) {
  return {
    user_id: user.user_id,
    username: user.username ?? "",
    first_name: user.first_name ?? "",
    last_name: user.last_name ?? "",
    language: user.language ?? "",
    is_admin: Boolean(user.is_admin),
    is_banned: Boolean(user.is_banned),
    ban_reason: user.ban_reason ?? "",
    joined_at: user.joined_at ?? "",
    last_seen: user.last_seen ?? "",
    orderCount: Array.isArray(user.orders) ? user.orders.length : 0,
  };
}

// ─── GET /api/bots/:botId/bot-users ─────────────────────────────────────────

router.get("/bots/:botId/bot-users", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    const all = await readUsers(spreadsheetId);

    const search = String(req.query.search ?? "").trim().toLowerCase();
    const status = String(req.query.status ?? "all");
    const page = Math.max(1, Number(req.query.page ?? 1) || 1);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50) || 50));

    let filtered = all;
    if (search) {
      filtered = filtered.filter((u) =>
        [u.user_id, u.username, u.first_name, u.last_name]
          .map((v) => String(v ?? "").toLowerCase())
          .some((v) => v.includes(search))
      );
    }
    if (status === "banned") filtered = filtered.filter((u) => u.is_banned);
    else if (status === "active") filtered = filtered.filter((u) => !u.is_banned);
    else if (status === "admin") filtered = filtered.filter((u) => u.is_admin);

    // تازه‌ترین اول. مقدار غایب ته لیست می‌رود، نه ابتدای آن.
    filtered = [...filtered].sort((a, b) => String(b.last_seen ?? "").localeCompare(String(a.last_seen ?? "")));

    const total = filtered.length;
    const start = (page - 1) * limit;
    const items = filtered.slice(start, start + limit).map(toSummary);

    res.json({
      users: items,
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      totalAll: all.length,
      bannedCount: all.filter((u) => u.is_banned).length,
    });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to list bot users");
  }
});

// ─── GET /api/bots/:botId/bot-users/:userId ─────────────────────────────────

router.get("/bots/:botId/bot-users/:userId", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    const user = await getEntity<BotUser>(spreadsheetId, USERS_TAB, req.params.userId);
    if (!user) throw new BotConfigError(404, "این کاربر پیدا نشد.", "user_not_found");
    res.json({ user: { ...user, user_id: String(user.user_id ?? req.params.userId) } });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to read bot user");
  }
});

// ─── PATCH /api/bots/:botId/bot-users/:userId ───────────────────────────────

/**
 * فقط چهار فیلد قابل ویرایش‌اند. `flood_timestamps`, `form_data`, `joined_at`,
 * `orders`, `profile_data` و `current_panel`/`current_form` عمداً **فقط‌خواندنی**
 * هستند: اولی‌ها حالت runtime بات‌اند و دستکاری‌شان از سایت یعنی خراب‌کردن
 * چیزی که همان لحظه در حال استفاده است.
 */
const EDITABLE = new Set(["is_banned", "ban_reason", "notes", "language"]);

router.patch("/bots/:botId/bot-users/:userId", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await assertSheetsAuthoritative(USERS_TAB);

    const current = await getEntity<BotUser>(spreadsheetId, USERS_TAB, req.params.userId);
    if (!current) throw new BotConfigError(404, "این کاربر پیدا نشد.", "user_not_found");

    const body = req.body ?? {};
    const next: BotUser = { ...current, user_id: String(current.user_id ?? req.params.userId) };

    for (const key of Object.keys(body)) {
      if (!EDITABLE.has(key)) continue; // هر چیز دیگری بی‌سروصدا نادیده گرفته می‌شود
      if (key === "is_banned") next.is_banned = Boolean(body.is_banned);
      if (key === "ban_reason") next.ban_reason = String(body.ban_reason ?? "").slice(0, 500);
      if (key === "notes") next.notes = String(body.notes ?? "").slice(0, 2000);
      if (key === "language") {
        const lang = String(body.language ?? "").trim();
        if (lang && !(BOT_LANGUAGES as readonly string[]).includes(lang))
          throw bad(`زبان «${lang}» پشتیبانی نمی‌شود.`);
        next.language = lang;
      }
    }

    // آنبن کردن، دلیل بن را هم پاک می‌کند؛ وگرنه یک دلیلِ قدیمی روی کاربرِ
    // آزادشده می‌ماند و در گزارش‌ها گمراه‌کننده است.
    if (next.is_banned === false && current.is_banned === true) next.ban_reason = "";
    next.last_seen = current.last_seen ?? nowIso();

    await putEntity(spreadsheetId, USERS_TAB, next.user_id, next);
    invalidateUsers(spreadsheetId);
    res.json({ user: next });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to update bot user");
  }
});

export default router;
