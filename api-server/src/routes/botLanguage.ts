/**
 * routes/botLanguage.ts — زبان بات و رشته‌های قابل ترجمه.
 * ─────────────────────────────────────────────────────────────────────────────
 * این فایل جای `GET/PUT /bots/:botId/language` قدیمی را می‌گیرد که روی
 * `lib/botLanguageStore.ts` بود و در **شیت DATA سایت** می‌نوشت
 * (`SHEETS_DATA_ID`, تب `bot_settings`, کلید = botId) — یعنی یک منبع سومِ
 * موازی که بات هرگز نمی‌خواندش. (ممیزی فاز ۰، بخش ب، مورد ۳.)
 *
 * دو واقعیتِ کد که با متن پرامپت فرق دارند:
 *
 *  1. **رشته‌ها در تب `languages` نیستند.** `utils/i18n.py` دو تب دارد:
 *       `text_keys`   → key ⇒ { key, category }
 *       `text_values` → "<key>:<lang>" ⇒ { key, lang, value }
 *     تب `languages` در `_SHEET_NAMES` هست ولی `t()` اصلاً نمی‌خواندش.
 *
 *  2. **هسته فقط `fa` و `en` را ثبت می‌کند** (`utils/i18n.py:25` و
 *     `core/builtins/languages.py`)، نه پنج زبان. کدهای دیگر crash نمی‌کنند —
 *     `t()` به انگلیسی و بعد به خودِ کلید fallback می‌کند — ولی عملاً یعنی
 *     کاربر متن انگلیسی می‌بیند. API همین را صریح برمی‌گرداند تا UI بتواند
 *     تفاوت را نشان دهد، به‌جای اینکه پنج زبان را یکسان جا بزند.
 */
import { Router } from "express";
import { requireAuth } from "./auth.js";
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
import { BOT_LANGUAGES } from "../lib/botTypes.js";
import { translateTo, translateAvailable, translateProvider, TranslateError } from "../lib/translate.js";

const router = Router();
const KEYS_TAB = "text_keys";
const VALUES_TAB = "text_values";

/**
 * زبان‌هایی که هسته‌ی بات می‌شناسد — آینه‌ی `i18n.LANGUAGES`.
 *
 * قبلاً فقط `fa`/`en` بود و بات هر انتخاب دیگری را بی‌صدا به فارسی
 * برمی‌گرداند. حالا هر پنج زبان در بات ثبت شده‌اند و زنجیره‌ی fallback
 * (زبان انتخابی → انگلیسی → خود کلید) رشته‌های ترجمه‌نشده را پوشش می‌دهد.
 */
const CORE_LANGUAGES = ["fa", "en", "ar", "tr", "ru"] as const;
const FALLBACK_LANG = "en";

type TextKeyRow = { key: string; category?: string };
type TextValueRow = { key: string; lang: string; value: string };

function valueKey(key: string, lang: string): string {
  return `${key}:${lang}`;
}

router.get("/bots/:botId/language", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    const settings = await readSettings(spreadsheetId);
    res.json({
      language: settings.language,
      coreLanguages: CORE_LANGUAGES,
      // بقیه‌ی کدها قابل ذخیره‌اند ولی بدون پلاگین، متن انگلیسی سرو می‌شود.
      otherLanguages: BOT_LANGUAGES.filter((l) => !(CORE_LANGUAGES as readonly string[]).includes(l)),
      // اگر سرویس ترجمه تنظیم نشده، UI اصلاً دکمه‌اش را نشان نمی‌دهد —
      // بهتر از دکمه‌ای که همیشه خطا می‌دهد.
      translateAvailable: translateAvailable(),
      fallbackLanguage: FALLBACK_LANG,
    });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to read bot language");
  }
});

router.put("/bots/:botId/language", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await assertSheetsAuthoritative("bot_settings");

    const language = String(req.body?.language ?? "").trim().toLowerCase();
    if (!(BOT_LANGUAGES as readonly string[]).includes(language))
      throw new BotConfigError(400, `زبان «${language}» پشتیبانی نمی‌شود.`, "bad_language");

    const settings = await patchSettings(spreadsheetId, { language });
    res.json({
      language: settings.language,
      // اگر زبانی خارج از هسته انتخاب شد، صریح گفته می‌شود چه اتفاقی می‌افتد.
      warning: (CORE_LANGUAGES as readonly string[]).includes(language)
        ? null
        : "این زبان در هسته‌ی بات ثبت نشده است؛ تا وقتی رشته‌هایش را خودتان وارد نکنید، بات متن انگلیسی نشان می‌دهد.",
    });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to set bot language");
  }
});

// ─── رشته‌های قابل ترجمه ────────────────────────────────────────────────────

router.get("/bots/:botId/language/strings", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    const lang = String(req.query.lang ?? "fa").toLowerCase();

    let keys: TextKeyRow[] = [];
    let values: TextValueRow[] = [];
    try {
      keys = (await listEntity<TextKeyRow>(spreadsheetId, KEYS_TAB))
        .filter((r) => r.value && typeof r.value === "object")
        .map((r) => ({ ...(r.value as TextKeyRow), key: r.key }));
    } catch {
      // تب‌های i18n lazy ساخته می‌شوند؛ نبودشان یعنی «هنوز رشته‌ای ثبت نشده».
      keys = [];
    }
    try {
      values = (await listEntity<TextValueRow>(spreadsheetId, VALUES_TAB))
        .filter((r) => r.value && typeof r.value === "object")
        .map((r) => r.value as TextValueRow);
    } catch {
      values = [];
    }

    const byKeyLang = new Map(values.map((v) => [valueKey(v.key, v.lang), v.value]));
    const search = String(req.query.search ?? "").trim().toLowerCase();

    const strings = keys
      .map((k) => ({
        key: k.key,
        category: k.category ?? "general",
        value: byKeyLang.get(valueKey(k.key, lang)) ?? "",
        // همان زنجیره‌ی fallback خود `t()`: زبان درخواستی → انگلیسی → خود کلید.
        fallback: byKeyLang.get(valueKey(k.key, FALLBACK_LANG)) ?? k.key,
      }))
      .filter((s) => !search || s.key.toLowerCase().includes(search) || s.value.toLowerCase().includes(search))
      .sort((a, b) => a.key.localeCompare(b.key));

    res.json({
      strings,
      lang,
      total: keys.length,
      categories: [...new Set(keys.map((k) => k.category ?? "general"))].sort(),
    });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to read bot strings");
  }
});

router.put("/bots/:botId/language/strings/:key", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await assertSheetsAuthoritative(VALUES_TAB);

    const key = String(req.params.key);
    const lang = String(req.body?.lang ?? "").toLowerCase();
    if (!(BOT_LANGUAGES as readonly string[]).includes(lang))
      throw new BotConfigError(400, `زبان «${lang}» پشتیبانی نمی‌شود.`, "bad_language");

    const value = String(req.body?.value ?? "");
    if (value.length > 4000) throw new BotConfigError(400, "طول متن از ۴۰۰۰ کاراکتر بیشتر است.");

    // `set_text` بات هم اول کلید را ثبت می‌کند و بعد مقدار — همان ترتیب.
    const existingKey = await getEntity<TextKeyRow>(spreadsheetId, KEYS_TAB, key);
    if (!existingKey)
      await putEntity(spreadsheetId, KEYS_TAB, key, { key, category: String(req.body?.category ?? "general") });

    await putEntity(spreadsheetId, VALUES_TAB, valueKey(key, lang), { key, lang, value });
    res.json({ key, lang, value });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to save bot string");
  }
});

/** بازگرداندن یک رشته به حالت پیش‌فرض = حذف مقدار سفارشی، نه خالی‌کردنش. */
router.delete("/bots/:botId/language/strings/:key", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await assertSheetsAuthoritative(VALUES_TAB);

    const lang = String(req.query.lang ?? "").toLowerCase();
    if (!(BOT_LANGUAGES as readonly string[]).includes(lang))
      throw new BotConfigError(400, `زبان «${lang}» پشتیبانی نمی‌شود.`, "bad_language");

    // مقدار خالی در `_raw` مثل «تنظیم‌نشده» رفتار می‌کند، ولی حذفِ سطر تمیزتر
    // است: تب رشته‌ها با ردیف‌های خالی پر نمی‌شود.
    const removed = await removeEntity(spreadsheetId, VALUES_TAB, valueKey(String(req.params.key), lang));
    res.json({ reset: removed, key: req.params.key, lang });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to reset bot string");
  }
});

/**
 * POST /bots/:botId/language/translate — ترجمه‌ی خودکار یک رشته.
 *
 * **ذخیره نمی‌کند**، فقط ترجمه را برمی‌گرداند: کاربر باید قبل از ثبت،
 * نتیجه را ببیند و بتواند اصلاحش کند. ترجمه‌ی ماشینی روی متن رابط کاربری
 * — که اغلب کوتاه و بی‌بافت است — به‌قدر کافی خطا می‌کند که ذخیره‌ی مستقیم
 * یعنی گذاشتن متن غلط جلوی کاربر نهایی بدون اینکه کسی دیده باشدش.
 */
router.post("/bots/:botId/language/translate", requireAuth, async (req: any, res) => {
  try {
    // دسترسی به بات هنوز چک می‌شود، هرچند این روت چیزی روی شیت نمی‌نویسد —
    // وگرنه هر کاربر لاگین‌شده‌ای می‌توانست از سهمیه‌ی ترجمه‌ی ما استفاده کند.
    await resolveBotSheet(req.userId, req.params.botId);

    const text = String(req.body?.text ?? "");
    const sourceLang = String(req.body?.sourceLang ?? "").toLowerCase();
    if (!(BOT_LANGUAGES as readonly string[]).includes(sourceLang))
      throw new BotConfigError(400, `زبان مبدأ «${sourceLang}» پشتیبانی نمی‌شود.`, "bad_language");

    const requested = Array.isArray(req.body?.targetLangs) ? req.body.targetLangs : [];
    const targetLangs = requested
      .map((l: unknown) => String(l ?? "").toLowerCase())
      .filter((l: string) => (BOT_LANGUAGES as readonly string[]).includes(l));
    if (targetLangs.length === 0)
      throw new BotConfigError(400, "هیچ زبان مقصد معتبری داده نشده است.", "no_targets");

    const results = await translateTo(text, sourceLang, targetLangs);
    res.json({ results, provider: translateProvider() });
  } catch (err) {
    if (err instanceof TranslateError) {
      res.status(err.status).json({ error: err.message, code: err.code ?? null });
      return;
    }
    sendBotConfigError(res, err, "Failed to translate");
  }
});

export default router;
