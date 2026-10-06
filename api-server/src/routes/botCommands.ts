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
 *
 * لایوباگ ۲۰۲۶-۰۹-۲۳: «توی بات نه پنل اومد نه کامند» — دقیقاً همان باگِ
 * forms (این فایل، پایین‌تر): همه‌ی روت‌های نوشتن اینجا بی‌قیدوشرط
 * `assertSheetsAuthoritative(COMMANDS_TAB)` صدا می‌زدند، که به محضِ
 * روشن‌شدنِ پرچمِ cutoverِ «custom_commands» یک تننت با ۴۰۹ رد می‌شد —
 * `lib/businessPg.ts` هنوز «custom_commands» را نمی‌شناخت. حالا که آن فایل
 * می‌شناسد، این قفل از هر پنج روتِ نوشتن (migrate/create/patch/reorder/
 * delete) برداشته شده — `listEntity`/`putEntity`/`removeEntity` خودشان
 * برای تننتِ cutover‌شده به Postgres می‌روند.
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
  sendBotConfigError,
  BotConfigError,
} from "../lib/botConfig.js";
import { listPanels, COMMANDS_TAB } from "../lib/panelOps.js";
import { FORMS_TAB } from "./botForms.js";
import { nowIso, type CustomCommand, type Form } from "../lib/botTypes.js";
import { isPluginEnabled } from "../lib/pluginGate.js";
import { PLUGIN_COMMAND_TARGETS } from "../lib/pluginCommandTargets.js";
import { CORE_COMMANDS, NEVER_DISABLE_COMMANDS } from "../lib/coreCommandsCatalog.js";
import { getPluginCatalog } from "../lib/pluginCatalog.js";

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
    // فاصله‌ها حذف می‌شوند: کاربر معمولاً آدرس را پیست می‌کند و یک فاصله‌ی
    // ابتدایی/انتهایی یا وسطیِ ناشی از کیبورد موبایل، تنها دلیل رد شدن بود.
    const url = target.slice(4).replace(/\s+/g, "");
    if (!url) throw bad("آدرس مقصد خالی است.");
    if (!/^https:\/\/\S+$/i.test(url))
      throw bad(
        `آدرس مقصد باید با https:// شروع شود. چیزی که فرستادید: «${target.slice(4)}»`,
        "bad_url"
      );
    return `url:${url}`;
  }
  // targetهای built-in و پلاگینی: شکلشان چک می‌شود، ولی لیست پلاگین‌های فعال
  // سمت سایت قطعی نیست، پس یک شناسه‌ی ناشناخته رد نمی‌شود.
  if (!/^[a-z][a-z0-9_]{0,31}$/.test(target)) throw bad("مقصد کامند معتبر نیست.");
  return target;
}

// ─── منوی دستورات تلگرام (دکمه‌ی «/» کنار کادر پیام) ─────────────────────────

/**
 * ⚠️ قاعده (لایوباگ ۲۰۲۶-۱۰-۰۶ — «هیچ کامندی نباید خودکار اضافه بشه توی بات»؛ «همه‌یِ سوییچ‌هایِ نمایش در تلگرام خاموش
 * است ولی همه نمایش داده می‌شوند»): هیچ کامندی خودبه‌خود به بات/منو اضافه نمی‌شود.
 *
 *  - منوی «/»ِ تلگرام = فقط چیزی که صاحبِ بات همین‌جا گذاشته (`bot_settings.bot_commands`). بات هم موقعِ بوت همین
 *    لیست را دقیقاً push می‌کند (`utils/telegram_capabilities.py::apply_bot_commands`)، نه چیزِ دیگری.
 *  - وضعیتِ نمایش‌داده‌شده **زنده از تلگرام** (`getMyCommands`) خوانده می‌شود، نه از لیستِ ذخیره‌شده: هر کامندی که واقعاً
 *    روی منو هست دیده و قابلِ حذف است (حتی اگر از قدیم خودکار نشسته باشد). اگر تلگرام جواب نداد، لیستِ ذخیره‌شده با
 *    `menuLive: false` نشان داده می‌شود (UI هشدار می‌دهد).
 *  - کامندهایِ داخلیِ بات (Core و پلاگین‌هایِ روشن) دیگر **ردیفِ خودکار** در شیت نمی‌سازند؛ فقط یک «فهرستِ در دسترس»
 *    (`builtins`) هستند که صاحبِ بات از آن به منو اضافه می‌کند یا اجرایش را خاموش می‌کند (ردیفِ override فقط با
 *    اقدامِ صریحِ همان کاربر ساخته می‌شود).
 */
type MenuEntry = { command: string; description: string };

/** نامِ مجازِ یک آیتمِ منوی تلگرام (https://core.telegram.org/bots/api#botcommand). */
const MENU_NAME_RE = /^[a-z0-9_]{1,32}$/;
const MENU_MAX = 100;

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
 * ورودیِ منو را تمیز و اعتبارسنجی می‌کند: نامِ نامعتبر → خطایِ ۴۰۰ با نامِ همان مورد؛ تکراری حذف (اولی می‌ماند)؛
 * توضیحِ خالی (که تلگرام رد می‌کند) با `/نام` پر می‌شود؛ بیش از ۱۰۰ مورد → ۴۰۰.
 */
function validateMenuList(input: unknown): MenuEntry[] {
  if (!Array.isArray(input)) throw bad("فهرستِ منو باید یک آرایه باشد.", "bad_menu");
  const out: MenuEntry[] = [];
  const seen = new Set<string>();
  for (const item of input) {
    const row = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const name = String(row.command ?? "").trim().replace(/^\//, "").toLowerCase();
    if (!MENU_NAME_RE.test(name))
      throw bad(`نامِ «${String(row.command ?? "")}» برایِ منوی تلگرام معتبر نیست (فقط a-z، عدد و زیرخط، حداکثر ۳۲ کاراکتر).`, "bad_menu_command");
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ command: name, description: String(row.description ?? "").trim().slice(0, 256) || `/${name}` });
  }
  if (out.length > MENU_MAX) throw bad(`تلگرام حداکثر ${MENU_MAX} آیتم برایِ منو می‌پذیرد.`, "menu_too_long");
  return out;
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

const TG_TIMEOUT_MS = 5000;

/**
 * منوی **واقعیِ** تلگرام (`getMyCommands`)؛ در هر خطا/تایم‌اوت → `null` (هرگز throw نمی‌کند: باز کردنِ این بخش نباید
 * به خاطرِ تلگرام خراب شود).
 */
async function fetchLiveMenu(botId: string): Promise<MenuEntry[] | null> {
  try {
    const token = await botToken(botId);
    const res = await Promise.race([
      tgApi<MenuEntry[]>(token, "getMyCommands"),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), TG_TIMEOUT_MS)),
    ]);
    if (!res || !res.ok || !Array.isArray(res.result)) return null;
    return res.result
      .map((c) => ({ command: String(c?.command ?? "").replace(/^\//, ""), description: String(c?.description ?? "") }))
      .filter((c) => c.command);
  } catch (err) {
    logger.debug({ err, botId }, "getMyCommands failed; falling back to the stored menu");
    return null;
  }
}

/** منویِ جاری: زنده از تلگرام، وگرنه لیستِ ذخیره‌شده (با `live:false`). */
async function currentMenu(spreadsheetId: string, botId: string): Promise<{ entries: MenuEntry[]; live: boolean }> {
  const live = await fetchLiveMenu(botId);
  if (live) return { entries: live, live: true };
  let stored: MenuEntry[] = [];
  try {
    stored = readMenu((await readSettings(spreadsheetId)) as unknown as Record<string, unknown>);
  } catch (err) {
    logger.debug({ err }, "reading bot_commands menu failed (ignored)");
  }
  return { entries: stored, live: false };
}

/**
 * منو را روی تلگرام **و** در `bot_settings.bot_commands` می‌نویسد (بات هم موقعِ بوت همین را دوباره push می‌کند).
 * اول تلگرام: اگر رد کرد چیزی ذخیره نمی‌شود، وگرنه شیت چیزی را ادعا می‌کرد که روی بات نیست.
 */
async function applyMenu(spreadsheetId: string, botId: string, entries: MenuEntry[]): Promise<MenuEntry[]> {
  const token = await botToken(botId);
  const applied = await tgApi(token, "setMyCommands", { commands: entries });
  if (!applied.ok)
    throw new BotConfigError(409, `تلگرام منو را نپذیرفت: ${applied.description ?? "خطای نامشخص"}`, "telegram_rejected");
  await patchSettings(spreadsheetId, { bot_commands: entries } as Record<string, unknown>);
  return entries;
}

/**
 * کامندِ حذف/تغییرنام‌داده‌شده/غیرفعال‌شده را از منوی تلگرام برمی‌دارد.
 * **غیرقطعی و بی‌صدا**: نبودنِ تلگرام نباید یک حذفِ موفق را شکست بدهد.
 */
async function dropFromMenu(spreadsheetId: string, botId: string, commandName: string): Promise<void> {
  try {
    const { entries } = await currentMenu(spreadsheetId, botId);
    if (!entries.some((m) => m.command === commandName)) return;
    await applyMenu(spreadsheetId, botId, entries.filter((m) => m.command !== commandName));
  } catch (err) {
    logger.warn({ err, botId, commandName }, "dropFromMenu failed (ignored)");
  }
}

// ─── کامندهایِ داخلیِ بات (فهرستِ در دسترس؛ هرگز خودکار به شیت نمی‌نویسد) ─────

export type BuiltinCommand = {
  command: string;
  description: string;
  adminOnly: boolean;
  /** `"core"` یا `"plugin:<id>"` */
  source: string;
  locked: boolean;
};

/** Core + کامندهایِ `menu_commands`ِ پلاگین‌هایِ **روشنِ** این تننت. فقط می‌خواند؛ هیچ ردیفی نمی‌سازد. */
async function builtinCatalog(spreadsheetId: string): Promise<{ list: BuiltinCommand[]; published: boolean }> {
  const list: BuiltinCommand[] = CORE_COMMANDS.map((c) => ({
    command: c.command, description: c.description, adminOnly: c.adminOnly, source: "core", locked: NEVER_DISABLE_COMMANDS.has(c.command),
  }));
  const have = new Set(list.map((c) => c.command));
  const { plugins, published } = await getPluginCatalog();
  for (const plugin of plugins) {
    if (!plugin.menu_commands?.length) continue;
    if (!(await isPluginEnabled(spreadsheetId, plugin.id))) continue;
    for (const mc of plugin.menu_commands) {
      const name = mc.command.replace(/^\//, "");
      if (!name || have.has(name)) continue;
      have.add(name);
      list.push({ command: name, description: mc.description_fa || mc.description || "", adminOnly: false, source: `plugin:${plugin.id}`, locked: false });
    }
  }
  return { list, published };
}

const isAutoRow = (c: CustomCommand): boolean => Boolean(c.source) && c.source !== "custom";

/**
 * ردیفِ «خودکارِ دست‌نخورده»: مادی‌شده توسطِ نسخه‌هایِ قبلیِ همین فایل (که روی هر GET برایِ هر کامندِ Core/پلاگین یک
 * ردیف می‌نوشت) و بعد هیچ‌وقت تغییر نکرده — فعال، همان `admin_only`/توضیحِ کاتالوگ. چنین ردیفی هیچ اطلاعاتی ندارد و
 * همان چیزی بود که کامندها را «خودش اضافه‌شده» نشان می‌داد؛ پاک می‌شود. ردیفی که صاحبِ بات دست زده (خاموش کرده/
 * توضیح یا admin_only را عوض کرده) override است و می‌ماند.
 */
function isUntouchedAutoRow(c: CustomCommand, catalog: BuiltinCommand[]): boolean {
  if (!isAutoRow(c)) return false;
  if (c.is_active === false) return false;
  const entry = catalog.find((b) => b.command === c.command && b.source === c.source);
  // پلاگینی که الان خاموش/ناشناخته است: چیزی برایِ مقایسه نیست؛ ردیفِ فعالِ بی‌admin_only اطلاعاتی ندارد.
  if (!entry) return !c.admin_only;
  return Boolean(c.admin_only) === entry.adminOnly && (c.description ?? "") === entry.description;
}

/**
 * لایوباگ ۲۰۲۶-۰۹-۲۸ می‌خواست «تمامی کامندها نمایش داده شوند»؛ پیاده‌سازی‌اش برایِ هر کامندِ Core/پلاگین یک ردیفِ
 * خودکار در تبِ `custom_commands` می‌نوشت (و بات همه را روی منو می‌گذاشت). حالا نمایش از `builtinCatalog` می‌آید (بدونِ
 * نوشتن). این تابع ردیف‌هایِ خودکارِ دست‌نخورده‌ی قدیمی را یک‌بار پاک می‌کند و `{kept, purged}` برمی‌گرداند.
 */
async function purgeUntouchedAutoRows(
  spreadsheetId: string, rows: CustomCommand[], catalog: BuiltinCommand[],
): Promise<{ kept: CustomCommand[]; purged: string[] }> {
  const kept: CustomCommand[] = [];
  const purged: string[] = [];
  for (const c of rows) {
    if (isUntouchedAutoRow(c, catalog)) {
      try {
        await removeEntity(spreadsheetId, COMMANDS_TAB, c.command);
        purged.push(c.command);
        continue;
      } catch (err) {
        logger.warn({ err, command: c.command }, "purging an auto-added command row failed (kept)");
      }
    }
    kept.push(c);
  }
  return { kept, purged };
}

// ─── ترتیب ──────────────────────────────────────────────────────────────────

/**
 * ترتیبِ مؤثر یک کامند — یا مقدارِ صریحِ `order` (که هنگامِ ساخت با
 * `Date.now()` پر می‌شود)، یا برای کامندهای قدیمی‌تر که این فیلد را ندارند،
 * همان لحظه‌ی ساختش (`created_at`). هر دو روی یک مقیاس‌اند (میلی‌ثانیه از
 * epoch)، پس کنار هم قابل مقایسه‌اند بدون نیاز به یک migration جدا — اولین
 * جابه‌جاییِ یک کامندِ قدیمی همین مقدارِ محاسبه‌شده را صریح ذخیره می‌کند.
 */
function effectiveOrder(c: CustomCommand): number {
  return typeof c.order === "number" ? c.order : Date.parse(c.created_at) || 0;
}

function sortCommands(commands: CustomCommand[]): CustomCommand[] {
  return [...commands].sort((a, b) => effectiveOrder(a) - effectiveOrder(b));
}

/** ردیف‌هایِ تب (بدونِ هیچ مادی‌سازی)، مرتب. شاملِ کامندهای سفارشی و overrideهایِ صریحِ داخلی‌ها. */
async function readRows(spreadsheetId: string): Promise<CustomCommand[]> {
  const rows = await listEntity<CustomCommand>(spreadsheetId, COMMANDS_TAB);
  return sortCommands(
    rows
      .filter((r) => r.value && typeof r.value === "object")
      .map((r) => ({ ...(r.value as CustomCommand), command: (r.value as CustomCommand).command ?? r.key })),
  );
}

/** فقط کامندهایِ سفارشیِ ساخته‌شده توسطِ صاحبِ بات (نه overrideهایِ داخلی)، مرتب. */
async function readCustomCommands(spreadsheetId: string): Promise<CustomCommand[]> {
  return (await readRows(spreadsheetId)).filter((c) => !isAutoRow(c));
}

/** `bots.commandCount` را از روی تب شیت به‌روز می‌کند (فقط کامندهایِ سفارشی). */
async function syncCommandCount(botId: string, count: number): Promise<void> {
  try {
    await db.update(botsTable).set({ commandCount: count }).where(eq(botsTable.id, botId));
  } catch (err) {
    // شمارنده فقط نمایشی است؛ شکستش نباید یک نوشتنِ موفق روی شیت را خراب کند.
    logger.warn({ err, botId }, "syncCommandCount failed (ignored)");
  }
}

/** نامی که نمی‌شود برایِ کامندِ سفارشی گرفت: ردیف‌هایِ موجود + همه‌یِ کامندهایِ داخلیِ بات (هندلرِ Core صاحبِ آن نام است). */
async function reservedNames(spreadsheetId: string, rows: CustomCommand[]): Promise<Set<string>> {
  const names = new Set(rows.map((c) => c.command));
  for (const b of (await builtinCatalog(spreadsheetId)).list) names.add(b.command);
  return names;
}

// ─── مسیرها ─────────────────────────────────────────────────────────────────

router.get("/bots/:botId/commands", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);

    const [{ list: catalog, published }, rows] = await Promise.all([builtinCatalog(spreadsheetId), readRows(spreadsheetId)]);
    // ردیف‌هایِ خودکارِ دست‌نخوردهٔ قدیمی (نوشته‌شده توسطِ نسخه‌هایِ قبلی) یک‌بار پاک می‌شوند.
    const { kept, purged } = await purgeUntouchedAutoRows(spreadsheetId, rows, catalog);
    const custom = kept.filter((c) => !isAutoRow(c));
    const overrides = new Map(kept.filter(isAutoRow).map((c) => [c.command, c]));
    await syncCommandCount(req.params.botId, custom.length);

    // منوی «/» — زنده از تلگرام (وگرنه ذخیره‌شده با menuLive:false).
    const { entries: menuEntries, live: menuLive } = await currentMenu(spreadsheetId, req.params.botId);
    const inMenu = new Set(menuEntries.map((m) => m.command));

    const customNames = new Set(custom.map((c) => c.command));
    const builtins = catalog
      .filter((b) => !customNames.has(b.command))
      .map((b) => {
        const o = overrides.get(b.command);
        return {
          command: b.command,
          source: b.source,
          description: o?.description ?? b.description,
          admin_only: o ? Boolean(o.admin_only) : b.adminOnly,
          is_active: o ? o.is_active !== false : true,
          locked: b.locked,
          // کامندی با حروفِ بزرگ (ACPT…) یا نامِ نامعتبر را تلگرام در منو نمی‌پذیرد.
          menuEligible: MENU_NAME_RE.test(b.command),
          inMenu: inMenu.has(b.command),
        };
      });

    res.json({
      // ردیف‌هایِ سفارشی؛ `locked` فقط برایِ سازگاری با کلاینتِ قدیمی (سفارشی هرگز قفل نیست).
      commands: custom.map((c) => ({ ...c, locked: false })),
      count: custom.length,
      menu: menuEntries.map((m) => m.command),
      menuEntries,
      menuLive,
      builtins,
      builtinsPublished: published,
      purged: purged.length,
    });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to list commands");
  }
});

/**
 * PUT /bots/:botId/commands/menu — کلِ منوی «/» را با همین لیست (به همین ترتیب) جایگزین می‌کند: اضافه/حذف/جابه‌جایی
 * هر آیتم (از جمله آیتم‌هایی که فقط روی تلگرام هستند و کامندِ سایت ندارند). `{ commands: [{command, description}] }`.
 */
router.put("/bots/:botId/commands/menu", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    const entries = validateMenuList(req.body?.commands);
    const menu = await applyMenu(spreadsheetId, req.params.botId, entries);
    res.json({ menu: menu.map((m) => m.command), menuEntries: menu });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to update the Telegram command menu");
  }
});

/**
 * PUT /bots/:botId/commands/:command/menu — این کامند روی منوی «/» باشد یا نباشد (سوییچِ «نمایش در تلگرام»).
 * کامندِ سفارشی یا داخلی (Core/پلاگین) هر دو مجازند. اضافه‌شده همیشه ته منو می‌نشیند؛ ترتیب را ویرایشگرِ منو عوض می‌کند.
 */
router.put("/bots/:botId/commands/:command/menu", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    const key = String(req.params.command).replace(/^\//, "");
    const inMenu = Boolean(req.body?.inMenu);

    const { entries } = await currentMenu(spreadsheetId, req.params.botId);
    const next = entries.filter((m) => m.command !== key);
    if (inMenu) {
      if (!MENU_NAME_RE.test(key))
        throw bad("این نام را تلگرام در منو نمی‌پذیرد (فقط حروفِ کوچکِ انگلیسی، عدد و زیرخط).", "bad_menu_command");
      const row = await getEntity<CustomCommand>(spreadsheetId, COMMANDS_TAB, key);
      const builtin = (await builtinCatalog(spreadsheetId)).list.find((b) => b.command === key);
      if (!row && !builtin) throw new BotConfigError(404, "این کامند پیدا نشد.", "command_not_found");
      // تلگرام توضیحِ خالی را رد می‌کند، پس اگر چیزی نیست خودِ نامِ کامند گذاشته می‌شود.
      next.push({ command: key, description: (row?.description || builtin?.description || `/${key}`).slice(0, 256) });
    }
    if (next.length > MENU_MAX) throw bad(`تلگرام حداکثر ${MENU_MAX} آیتم برایِ منو می‌پذیرد.`, "menu_too_long");

    const menu = await applyMenu(spreadsheetId, req.params.botId, next);
    res.json({ menu: menu.map((m) => m.command), menuEntries: menu });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to update the Telegram command menu");
  }
});

/**
 * مقصدهای قابل انتخاب — تا UI مجبور نباشد uuid دستی بگیرد.
 *
 * `builtin` تا امروز فقط چهار مقصدِ هسته بود (`BUILTIN_TARGETS`)، در حالی
 * که همان مفهومِ «مقصد» برای انواعِ پنل (`lib/pluginPanelTypes.ts`) و اکشنِ
 * دکمه (`lib/pluginButtonActions.ts`) از قبل کاملِ فهرستِ پلاگینی را نشان
 * می‌داد — این شکاف را `PLUGIN_COMMAND_TARGETS` می‌بندد، با همان گیتِ
 * per-tenant (`isPluginEnabled`) که آن دو مسیر هم دارند.
 */
router.get("/bots/:botId/commands/targets", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    const [panels, forms, enabledPluginTargets] = await Promise.all([
      listPanels(spreadsheetId),
      listEntity<Form>(spreadsheetId, FORMS_TAB),
      Promise.all(
        PLUGIN_COMMAND_TARGETS.map(async (t) => ((await isPluginEnabled(spreadsheetId, t.pluginId)) ? t : null))
      ).then((rows) => rows.filter((t): t is (typeof PLUGIN_COMMAND_TARGETS)[number] => t !== null)),
    ]);
    res.json({
      builtin: [...BUILTIN_TARGETS, ...enabledPluginTargets.map((t) => ({ value: t.key, label: t.label }))],
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

    const legacy = await db.select().from(commandsTable).where(eq(commandsTable.botId, req.params.botId));
    const existing = new Set((await readRows(spreadsheetId)).map((c) => c.command));

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
        source: "custom",
      };
      await putEntity(spreadsheetId, COMMANDS_TAB, name, command);
      existing.add(name);
      migrated += 1;
    }

    const total = (await readCustomCommands(spreadsheetId)).length;
    await syncCommandCount(req.params.botId, total);
    res.json({ migrated, skipped, invalid, total });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to migrate commands");
  }
});

router.post("/bots/:botId/commands", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);

    const body = req.body ?? {};
    const name = validateCommandName(body.command);
    // نامِ کامندِ داخلیِ بات (Core/پلاگین) رزرو است: هندلرِ آن از قبل صاحبِ آن نام است و
    // `dispatch_custom_command` هیچ‌وقت به آن نمی‌رسد — بدونِ این چک، کامندی به نامِ «support» بی‌صدا هرگز اجرا نمی‌شد.
    // (فقط می‌خواند؛ برخلافِ نسخه‌هایِ قبلی دیگر ردیفی نمی‌نویسد.)
    if ((await reservedNames(spreadsheetId, await readRows(spreadsheetId))).has(name))
      throw new BotConfigError(409, `کامند /${name} از قبل وجود دارد.`, "duplicate_command");

    const command: CustomCommand = {
      command: name,
      target: await validateTarget(spreadsheetId, body.target),
      description: String(body.description ?? "").slice(0, 500),
      admin_only: Boolean(body.admin_only),
      is_active: body.is_active === undefined ? true : Boolean(body.is_active),
      created_at: nowIso(),
      source: "custom",
      // تازه‌ترین همیشه ته لیست — Date.now() از effectiveOrder هر کامندِ
      // قبلی (چه صریح، چه برگرفته از created_at) همیشه بزرگ‌تر است.
      order: Date.now(),
    };

    await putEntity(spreadsheetId, COMMANDS_TAB, name, command);
    await syncCommandCount(req.params.botId, (await readCustomCommands(spreadsheetId)).length);
    res.status(201).json({ command });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to create command");
  }
});

/**
 * ردیفِ فعلیِ یک کامند؛ برایِ کامندِ داخلیِ بدونِ ردیف (دیگر خودکار ساخته نمی‌شود) یک **override** از کاتالوگ می‌سازد —
 * فقط وقتی صاحبِ بات صریحاً چیزی را عوض می‌کند (خاموش‌کردن/توضیح/admin_only).
 */
async function rowOrBuiltinOverride(spreadsheetId: string, key: string): Promise<CustomCommand | null> {
  const current = await getEntity<CustomCommand>(spreadsheetId, COMMANDS_TAB, key);
  if (current) return current;
  const builtin = (await builtinCatalog(spreadsheetId)).list.find((b) => b.command === key);
  if (!builtin) return null;
  return {
    command: builtin.command,
    target: "",
    description: builtin.description,
    admin_only: builtin.adminOnly,
    is_active: true,
    created_at: nowIso(),
    order: Date.now(),
    source: builtin.source,
  };
}

router.patch("/bots/:botId/commands/:command", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);

    const key = String(req.params.command).replace(/^\//, "");
    const current = await rowOrBuiltinOverride(spreadsheetId, key);
    if (!current) throw new BotConfigError(404, "این کامند پیدا نشد.", "command_not_found");

    // ردیفِ source!="custom" فقط نمایانگرِ یک کامندِ از قبل هاردکدشده در کدِ بات است: `target`ش بی‌معناست (رفتارِ
    // واقعی از کد می‌آید) و نامش باید عیناً همان بماند که `Command("...")` در پایتون منتظرش است.
    const source = current.source ?? "custom";
    const body = req.body ?? {};
    const next: CustomCommand = { ...current, command: current.command ?? key };
    if ("target" in body) {
      if (source !== "custom")
        throw new BotConfigError(409, "مقصدِ این کامند در کدِ بات ثابت است و از سایت قابل تغییر نیست.", "builtin_command_target_fixed");
      next.target = await validateTarget(spreadsheetId, body.target);
    }
    if ("description" in body) next.description = String(body.description ?? "").slice(0, 500);
    if ("admin_only" in body) next.admin_only = Boolean(body.admin_only);
    if ("is_active" in body) {
      const nextActive = Boolean(body.is_active);
      if (!nextActive && NEVER_DISABLE_COMMANDS.has(key))
        throw new BotConfigError(409, "این کامند برای عملکرد صحیح بات ضروری است و قابل غیرفعال‌سازی نیست.", "command_locked");
      next.is_active = nextActive;
    }

    // تغییر نام کامند = تغییر **کلید سطر**، پس سطر قدیمی باید برود. اول جدید
    // نوشته می‌شود تا اگر وسط کار چیزی بخورد زمین، کامند اصلاً گم نشود.
    if ("command" in body) {
      if (source !== "custom")
        throw new BotConfigError(409, "نامِ این کامند در کدِ بات ثابت است و از سایت قابل تغییر نیست.", "builtin_command_rename_blocked");
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

/**
 * جابه‌جاییِ یک کامندِ **سفارشی** در فهرستِ سایت — با **دکمه**، نه drag (دقیقاً همان دلیلِ `ButtonBuilder.tsx`: روی
 * موبایل کشیدن داخل یک جدولِ اسکرول‌شونده عملاً کار نمی‌کند). فقط با همسایه‌ی بالا/پایینِ خودش `order` را عوض می‌کند.
 * (ترتیبِ منوی «/»ِ تلگرام جداست: `PUT /commands/menu`.)
 */
router.post("/bots/:botId/commands/:command/reorder", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);

    const key = String(req.params.command).replace(/^\//, "");
    const direction = req.body?.direction;
    if (direction !== "up" && direction !== "down")
      throw bad("جهت جابه‌جایی نامعتبر است.", "bad_direction");

    const commands = await readCustomCommands(spreadsheetId);
    const index = commands.findIndex((c) => c.command === key);
    if (index === -1) throw new BotConfigError(404, "این کامند پیدا نشد.", "command_not_found");

    const swapIndex = direction === "up" ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= commands.length) {
      // از قبل بالاترین/پایین‌ترین است — نه خطا، فقط بدونِ تغییر برمی‌گردد.
      res.json({ commands });
      return;
    }

    const a = commands[index];
    const b = commands[swapIndex];
    const orderA = effectiveOrder(a);
    const orderB = effectiveOrder(b);
    await putEntity(spreadsheetId, COMMANDS_TAB, a.command, { ...a, order: orderB });
    await putEntity(spreadsheetId, COMMANDS_TAB, b.command, { ...b, order: orderA });

    res.json({ commands: await readCustomCommands(spreadsheetId) });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to reorder command");
  }
});

/**
 * «حذف» یک کامندِ داخلیِ بات (Core/پلاگین) معنایِ واقعیِ حذف ندارد: هندلرش در کدِ بات ثابت است. به‌جایش اجرایش را
 * خاموش می‌کند (`is_active=false` — `utils/command_gate_middleware.py` سمتِ بات همین را می‌خواند) و از منو برمی‌دارد.
 * کامندِ سفارشی واقعاً پاک می‌شود.
 */
router.delete("/bots/:botId/commands/:command", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);

    const key = String(req.params.command).replace(/^\//, "");
    const current = await rowOrBuiltinOverride(spreadsheetId, key);
    if (!current) throw new BotConfigError(404, "این کامند پیدا نشد.", "command_not_found");

    if ((current.source ?? "custom") !== "custom") {
      if (NEVER_DISABLE_COMMANDS.has(key))
        throw new BotConfigError(409, "این کامند برای عملکرد صحیح بات ضروری است و قابل غیرفعال‌سازی نیست.", "command_locked");
      await putEntity(spreadsheetId, COMMANDS_TAB, key, { ...current, is_active: false });
      await dropFromMenu(spreadsheetId, req.params.botId, key);
      res.json({ deleted: key, disabledInstead: true });
      return;
    }

    const removed = await removeEntity(spreadsheetId, COMMANDS_TAB, key);
    if (!removed) throw new BotConfigError(404, "این کامند پیدا نشد.", "command_not_found");
    await dropFromMenu(spreadsheetId, req.params.botId, key);
    await syncCommandCount(req.params.botId, (await readCustomCommands(spreadsheetId)).length);
    res.json({ deleted: key });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to delete command");
  }
});

/** خالص و بدون DB — برای تست مستقیم بدون راه‌انداختن روت/شیت کامل. */
export const __testables = {
  effectiveOrder, sortCommands, validateCommandName, validateMenuList, builtinCatalog, isUntouchedAutoRow,
  purgeUntouchedAutoRows, rowOrBuiltinOverride, readRows, MENU_NAME_RE,
};

export default router;
