/**
 * routes/botCommands.ts — کامندهای سفارشی، با منبع حقیقتِ **تب `custom_commands`**.
 * ─────────────────────────────────────────────────────────────────────────────
 * باگ B13: تا امروز `/bots/:botId/commands` روی جدول `commands` در Postgres
 * سایت کار می‌کرد، با شکلی که هیچ ربطی به بات نداشت:
 *
 *   سایت:  { id, name, description, permission, arguments[], workflow, enabled }
 *   بات:   key = command, value = { command, target, description, admin_only,
 *                                   is_active, created_at }
 *
 * هیچ فیلد مشترکی جز `description` نبود. یعنی کاربر در سایت کامند می‌ساخت و بات
 * هرگز نمی‌دیدش. این فایل جای آن روت‌ها را می‌گیرد (نسخه‌های قدیمی از
 * `routes/bots.ts` حذف شده‌اند) و **جدول `commands` را پاک نمی‌کند** — فقط دیگر
 * منبع حقیقت نیست و `POST /commands/migrate` محتوایش را یک‌بار به شیت می‌برد.
 */
import { Router } from "express";
import { db, botsTable, commandsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "./auth.js";
import { logger } from "../lib/logger.js";
import { decryptToken } from "../lib/tokenCrypto.js";
import { tgApi } from "../lib/telegram.js";
import {
  resolveBotSheet,
  listEntity,
  getEntity,
  putEntity,
  removeEntity,
  readSettings,
  patchSettings,
  assertSheetsAuthoritative,
  sendBotConfigError,
  BotConfigError,
} from "../lib/botConfig.js";
import { listPanels, COMMANDS_TAB } from "../lib/panelOps.js";
import { FORMS_TAB } from "./botForms.js";
import { nowIso, type CustomCommand, type Form } from "../lib/botTypes.js";

const router = Router();

function bad(message: string, code?: string): BotConfigError {
  return new BotConfigError(400, message, code);
}

/** targetهای داخلیِ خود بات — آینه‌ی `_BUILTIN_TARGETS` در `handlers/custom_commands.py:69`. */
const BUILTIN_TARGETS: Array<{ value: string; label: string }> = [
  { value: "admin", label: "🎛 پنل ادمین" },
  { value: "broadcast", label: "📣 پیام همگانی" },
  { value: "stats", label: "📊 آمار" },
  { value: "backup", label: "💾 بک‌آپ" },
];

/** `^[a-z0-9_]{1,32}$` و بدون `/` — همان چیزی که بات موقع dispatch می‌بیند. */
function validateCommandName(value: unknown): string {
  const raw = String(value ?? "").trim().replace(/^\//, "").toLowerCase();
  if (!raw) throw bad("نام کامند خالی است.");
  if (!/^[a-z0-9_]{1,32}$/.test(raw))
    throw bad("نام کامند فقط می‌تواند حروف کوچک انگلیسی، عدد و زیرخط باشد (حداکثر ۳۲ کاراکتر) و نباید با / شروع شود.", "bad_command_name");
  return raw;
}

/**
 * مقصد کامند. شکل‌های مجاز: `panel:<id>`، `form:<id>`، `url:<https…>`، یا یکی از
 * targetهای built-in/پلاگینی. وجودِ پنل/فرم واقعاً چک می‌شود، وگرنه کاربر یک
 * کامند می‌سازد که در بات فقط پیام «پیدا نشد» می‌دهد.
 */
async function validateTarget(spreadsheetId: string, value: unknown): Promise<string> {
  const target = String(value ?? "").trim();
  if (!target) throw bad("مقصد کامند تعیین نشده است.");

  if (target.startsWith("panel:")) {
    const panelId = target.slice(6);
    const panels = await listPanels(spreadsheetId);
    if (!panels.some((p) => p.id === panelId))
      throw bad("پنلی که به‌عنوان مقصد انتخاب کردید وجود ندارد.", "panel_not_found");
    return target;
  }
  if (target.startsWith("form:")) {
    const formId = target.slice(5);
    const forms = await listEntity<Form>(spreadsheetId, FORMS_TAB);
    if (!forms.some((f) => f.key === formId))
      throw bad("فرمی که به‌عنوان مقصد انتخاب کردید وجود ندارد.", "form_not_found");
    return target;
  }
  if (target.startsWith("url:")) {
    const url = target.slice(4);
    if (!/^https:\/\/\S+$/i.test(url)) throw bad("آدرس مقصد باید با https:// شروع شود.");
    return target;
  }
  // targetهای built-in و پلاگینی: شکلشان چک می‌شود، ولی لیست پلاگین‌های فعال
  // سمت سایت قطعی نیست، پس یک شناسه‌ی ناشناخته رد نمی‌شود.
  if (!/^[a-z][a-z0-9_]{0,31}$/.test(target)) throw bad("مقصد کامند معتبر نیست.");
  return target;
}

// ─── منوی دستورات تلگرام (دکمه‌ی «/» کنار کادر پیام) ─────────────────────────

/**
 * منبع حقیقتِ منو، `bot_settings.bot_commands` است — **نه یک جای تازه**.
 *
 * خودِ بات از قبل همین کلید را می‌خواند و در بوت `set_my_commands` می‌زند
 * (`utils/telegram_capabilities.py::apply_bot_commands`)، به شکل
 * `[{command, description}]`. پس سایت در همان کلید می‌نویسد، و علاوه بر آن
 * `setMyCommands` را همان لحظه هم صدا می‌زند تا کاربر برای دیدن نتیجه مجبور
 * به ری‌استارت بات نباشد.
 */
type MenuEntry = { command: string; description: string };

function readMenu(settings: Record<string, unknown>): MenuEntry[] {
  const raw = settings.bot_commands;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c): c is Record<string, unknown> => Boolean(c) && typeof c === "object")
    .map((c) => ({
      command: String(c.command ?? "").replace(/^\//, "").slice(0, 32),
      description: String(c.description ?? "").slice(0, 256),
    }))
    .filter((c) => c.command);
}

/**
 * منوی ذخیره‌شده را با منوی **زنده‌ی** تلگرام ادغام می‌کند.
 *
 * صریحاً بدون overwrite: ممکن است کسی قبلاً با BotFather یا از جای دیگری
 * کامندی روی منو گذاشته باشد که در شیت ما نیست؛ پاک‌کردنش یعنی خرابکاری در
 * چیزی که مالِ ما نبوده. `getMyCommands` هرگز باعث شکست نمی‌شود — اگر جواب
 * نداد، فقط با لیست ذخیره‌شده جلو می‌رویم.
 */
async function mergedMenu(token: string, stored: MenuEntry[]): Promise<MenuEntry[]> {
  const byName = new Map<string, MenuEntry>();
  try {
    const live = await tgApi<MenuEntry[]>(token, "getMyCommands");
    if (live.ok && Array.isArray(live.result)) {
      for (const c of live.result) {
        const command = String(c?.command ?? "").replace(/^\//, "");
        if (command) byName.set(command, { command, description: String(c?.description ?? "") });
      }
    }
  } catch (err) {
    logger.debug({ err }, "getMyCommands failed; merging against stored list only");
  }
  // مقدارِ ما برنده است: توضیحی که کاربر همین الان در سایت نوشته باید جایگزین
  // نسخه‌ی قدیمیِ روی تلگرام شود.
  for (const entry of stored) byName.set(entry.command, entry);
  return [...byName.values()];
}

/** توکنِ رمزگشایی‌شده‌ی بات، یا ۴۰۹ با پیام روشن. */
async function botToken(botId: string): Promise<string> {
  const [bot] = await db.select({ token: botsTable.token }).from(botsTable).where(eq(botsTable.id, botId)).limit(1);
  try {
    const token = decryptToken(bot?.token ?? "");
    if (token) return token;
  } catch {
    /* افتاد پایین */
  }
  throw new BotConfigError(
    409,
    "توکن این بات روی سرور در دسترس نیست، پس تغییر منوی دستورات تلگرام ممکن نیست.",
    "no_token"
  );
}

/**
 * کامند حذف/تغییرنام‌داده‌شده را از منوی تلگرام برمی‌دارد.
 *
 * **غیرقطعی و بی‌صدا**: حذف یک کامند نباید به‌خاطر در دسترس نبودن تلگرام
 * شکست بخورد. ولی نکردنش یعنی روی منوی «/» کاربر یک دستور می‌ماند که دیگر
 * هیچ کاری نمی‌کند — دقیقاً همان دسته‌ی «خرابیِ بی‌صدا» که این دور رفع‌باگ
 * درباره‌اش است.
 */
async function dropFromMenu(spreadsheetId: string, botId: string, commandName: string): Promise<void> {
  try {
    const settings = (await readSettings(spreadsheetId)) as unknown as Record<string, unknown>;
    const stored = readMenu(settings);
    if (!stored.some((m) => m.command === commandName)) return;

    const next = stored.filter((m) => m.command !== commandName);
    await patchSettings(spreadsheetId, { bot_commands: next } as Record<string, unknown>);

    const token = await botToken(botId);
    await tgApi(token, "setMyCommands", { commands: next });
  } catch (err) {
    logger.warn({ err, botId, commandName }, "dropFromMenu failed (ignored)");
  }
}

async function readCommands(spreadsheetId: string): Promise<CustomCommand[]> {
  const rows = await listEntity<CustomCommand>(spreadsheetId, COMMANDS_TAB);
  return rows
    .filter((r) => r.value && typeof r.value === "object")
    .map((r) => ({ ...(r.value as CustomCommand), command: (r.value as CustomCommand).command ?? r.key }));
}

/** `bots.commandCount` را از روی تب شیت به‌روز می‌کند (نه از روی جدول Postgres). */
async function syncCommandCount(botId: string, count: number): Promise<void> {
  try {
    await db.update(botsTable).set({ commandCount: count }).where(eq(botsTable.id, botId));
  } catch (err) {
    // شمارنده فقط نمایشی است؛ شکستش نباید یک نوشتنِ موفق روی شیت را خراب کند.
    logger.warn({ err, botId }, "syncCommandCount failed (ignored)");
  }
}

// ─── مسیرها ─────────────────────────────────────────────────────────────────

router.get("/bots/:botId/commands", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    const commands = await readCommands(spreadsheetId);
    await syncCommandCount(req.params.botId, commands.length);

    // کدام‌ها روی منوی «/» تلگرام هم هستند. از تنظیمات خوانده می‌شود نه از
    // تلگرام: یک درخواست شبکه به‌ازای هر بار باز کردن این سکشن، به‌خاطر یک
    // چک‌باکس، ارزشش را ندارد.
    let menu: string[] = [];
    try {
      menu = readMenu((await readSettings(spreadsheetId)) as unknown as Record<string, unknown>).map((m) => m.command);
    } catch (err) {
      logger.debug({ err }, "reading bot_commands menu failed (ignored)");
    }

    res.json({ commands, count: commands.length, menu });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to list commands");
  }
});

/**
 * PUT /bots/:botId/commands/:command/menu — این کامند روی منوی «/» تلگرام
 * باشد یا نباشد.
 *
 * دو نوشتن انجام می‌شود و هر دو لازم‌اند: `bot_settings.bot_commands` تا
 * بعد از ری‌استارت هم بماند (بات خودش موقع بوت از همین می‌خواند)، و
 * `setMyCommands` تا همین حالا اثر کند.
 */
router.put("/bots/:botId/commands/:command/menu", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    const key = String(req.params.command).replace(/^\//, "");
    const inMenu = Boolean(req.body?.inMenu);

    const command = await getEntity<CustomCommand>(spreadsheetId, COMMANDS_TAB, key);
    if (!command) throw new BotConfigError(404, "این کامند پیدا نشد.", "command_not_found");

    const settings = (await readSettings(spreadsheetId)) as unknown as Record<string, unknown>;
    const stored = readMenu(settings).filter((m) => m.command !== key);
    if (inMenu) {
      // تلگرام توضیح خالی را برای یک آیتم منو رد می‌کند، پس اگر کاربر چیزی
      // ننوشته خودِ نام کامند گذاشته می‌شود.
      stored.push({ command: key, description: (command.description || `/${key}`).slice(0, 256) });
    }

    const token = await botToken(req.params.botId);
    const merged = await mergedMenu(token, stored);
    // آیتمی که کاربر همین الان برداشت نباید از راه ادغام برگردد.
    const finalMenu = inMenu ? merged : merged.filter((m) => m.command !== key);

    const applied = await tgApi(token, "setMyCommands", { commands: finalMenu });
    if (!applied.ok)
      throw new BotConfigError(
        409,
        `تلگرام منو را نپذیرفت: ${applied.description ?? "خطای نامشخص"}`,
        "telegram_rejected"
      );

    // فقط بعد از موفقیت تلگرام ذخیره می‌شود، وگرنه شیت چیزی را ادعا می‌کرد
    // که روی بات نیست.
    await patchSettings(spreadsheetId, { bot_commands: finalMenu } as Record<string, unknown>);

    res.json({ menu: finalMenu.map((m) => m.command) });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to update the Telegram command menu");
  }
});

/** مقصدهای قابل انتخاب — تا UI مجبور نباشد uuid دستی بگیرد. */
router.get("/bots/:botId/commands/targets", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    const [panels, forms] = await Promise.all([
      listPanels(spreadsheetId),
      listEntity<Form>(spreadsheetId, FORMS_TAB),
    ]);
    res.json({
      builtin: BUILTIN_TARGETS,
      panels: panels.map((p) => ({ id: p.id, title: p.title })),
      forms: forms
        .filter((f) => f.value && typeof f.value === "object")
        .map((f) => ({ id: f.key, title: (f.value as Form).title ?? f.key })),
    });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to read command targets");
  }
});

/**
 * مهاجرت یک‌باره‌ی جدول `commands` سایت به تب `custom_commands`.
 * idempotent: اجرای دوباره چیزی تکراری نمی‌سازد و گزارش می‌دهد چند تا منتقل شد
 * و چند تا از قبل بود. جدول Postgres **حذف نمی‌شود**.
 */
router.post("/bots/:botId/commands/migrate", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await assertSheetsAuthoritative(COMMANDS_TAB);

    const legacy = await db.select().from(commandsTable).where(eq(commandsTable.botId, req.params.botId));
    const existing = new Set((await readCommands(spreadsheetId)).map((c) => c.command));

    let migrated = 0;
    let skipped = 0;
    const invalid: string[] = [];

    for (const row of legacy) {
      let name: string;
      try {
        name = validateCommandName(row.name);
      } catch {
        // نامی که در سایت مجاز بوده ممکن است برای بات نباشد (مثلاً حروف بزرگ
        // یا فاصله). گزارش می‌شود تا کاربر دستی درستش کند.
        invalid.push(row.name);
        continue;
      }
      if (existing.has(name)) {
        skipped += 1;
        continue;
      }
      const command: CustomCommand = {
        command: name,
        // جدول سایت هیچ معادلی برای `target` ندارد؛ `admin` امن‌ترین پیش‌فرض
        // است (فقط ادمین می‌بیندش) تا کامند مهاجرت‌کرده به کاربر عادی چیز
        // اشتباهی نشان ندهد. کاربر بعداً مقصد واقعی را انتخاب می‌کند.
        target: "admin",
        description: row.description ?? "",
        admin_only: true,
        is_active: Boolean(row.enabled),
        created_at: row.createdAt ? new Date(row.createdAt).toISOString() : nowIso(),
      };
      await putEntity(spreadsheetId, COMMANDS_TAB, name, command);
      existing.add(name);
      migrated += 1;
    }

    const total = (await readCommands(spreadsheetId)).length;
    await syncCommandCount(req.params.botId, total);
    res.json({ migrated, skipped, invalid, total });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to migrate commands");
  }
});

router.post("/bots/:botId/commands", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await assertSheetsAuthoritative(COMMANDS_TAB);

    const body = req.body ?? {};
    const name = validateCommandName(body.command);
    if (await getEntity(spreadsheetId, COMMANDS_TAB, name))
      throw new BotConfigError(409, `کامند /${name} از قبل وجود دارد.`, "duplicate_command");

    const command: CustomCommand = {
      command: name,
      target: await validateTarget(spreadsheetId, body.target),
      description: String(body.description ?? "").slice(0, 500),
      admin_only: Boolean(body.admin_only),
      is_active: body.is_active === undefined ? true : Boolean(body.is_active),
      created_at: nowIso(),
    };

    await putEntity(spreadsheetId, COMMANDS_TAB, name, command);
    await syncCommandCount(req.params.botId, (await readCommands(spreadsheetId)).length);
    res.status(201).json({ command });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to create command");
  }
});

router.patch("/bots/:botId/commands/:command", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await assertSheetsAuthoritative(COMMANDS_TAB);

    const key = String(req.params.command).replace(/^\//, "");
    const current = await getEntity<CustomCommand>(spreadsheetId, COMMANDS_TAB, key);
    if (!current) throw new BotConfigError(404, "این کامند پیدا نشد.", "command_not_found");

    const body = req.body ?? {};
    const next: CustomCommand = { ...current, command: current.command ?? key };
    if ("target" in body) next.target = await validateTarget(spreadsheetId, body.target);
    if ("description" in body) next.description = String(body.description ?? "").slice(0, 500);
    if ("admin_only" in body) next.admin_only = Boolean(body.admin_only);
    if ("is_active" in body) next.is_active = Boolean(body.is_active);

    // تغییر نام کامند = تغییر **کلید سطر**، پس سطر قدیمی باید برود. اول جدید
    // نوشته می‌شود تا اگر وسط کار چیزی بخورد زمین، کامند اصلاً گم نشود.
    if ("command" in body) {
      const renamed = validateCommandName(body.command);
      if (renamed !== key) {
        if (await getEntity(spreadsheetId, COMMANDS_TAB, renamed))
          throw new BotConfigError(409, `کامند /${renamed} از قبل وجود دارد.`, "duplicate_command");
        next.command = renamed;
        await putEntity(spreadsheetId, COMMANDS_TAB, renamed, next);
        await removeEntity(spreadsheetId, COMMANDS_TAB, key);
        // نام قدیمی اگر روی منو بود باید برود؛ نام جدید را کاربر دوباره
        // خودش به منو اضافه می‌کند (بی‌صدا اضافه‌کردنش یعنی تصمیمی که
        // نگرفته را برایش گرفته‌ایم).
        await dropFromMenu(spreadsheetId, req.params.botId, key);
        res.json({ command: next });
        return;
      }
    }

    await putEntity(spreadsheetId, COMMANDS_TAB, key, next);
    res.json({ command: next });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to update command");
  }
});

router.delete("/bots/:botId/commands/:command", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await assertSheetsAuthoritative(COMMANDS_TAB);

    const key = String(req.params.command).replace(/^\//, "");
    const removed = await removeEntity(spreadsheetId, COMMANDS_TAB, key);
    if (!removed) throw new BotConfigError(404, "این کامند پیدا نشد.", "command_not_found");
    await dropFromMenu(spreadsheetId, req.params.botId, key);
    await syncCommandCount(req.params.botId, (await readCommands(spreadsheetId)).length);
    res.json({ deleted: key });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to delete command");
  }
});

export default router;
