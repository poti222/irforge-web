/**
 * routes/botPluginData.ts — CRUD داده‌ی پلاگین‌ها روی شیت تننت.
 * ─────────────────────────────────────────────────────────────────────────────
 * یک لایه‌ی عمومی روی اسکیمای اعلامیِ `lib/pluginCollections.ts`، به‌جای هفده
 * فایل روتِ تقریباً یکسان. مسیرها:
 *
 *   GET    /bots/:botId/plugin-collections              فهرست اسکیماها (UI از این ساخته می‌شود)
 *   GET    /bots/:botId/plugin-data/:collection         فهرست رکوردها
 *   POST   /bots/:botId/plugin-data/:collection         ساخت
 *   PATCH  /bots/:botId/plugin-data/:collection/:id     ویرایش
 *   DELETE /bots/:botId/plugin-data/:collection/:id     حذف
 *
 * سه قاعده‌ی غیرقابل‌مذاکره که همه‌جا اجرا می‌شوند:
 *   ۱. **گیت سمت سرور.** هر درخواست از `requirePluginEnabled` می‌گذرد. پنهان
 *      کردن تب در UI هیچ چیزی را محافظت نمی‌کند.
 *   ۲. **هیچ‌وقت بازنویسی کل تب.** فقط `putEntity`/`removeEntity` تک‌کلیدی —
 *      همان دلیل باگ B11 (نوشتن کل تب، کلیدهای ناشناخته را می‌کشد).
 *   ۳. **فیلد ناشناخته کنار گذاشته می‌شود، نه ذخیره.** فقط کلیدهای اسکیما
 *      نوشته می‌شوند، وگرنه کلاینت می‌توانست هر چیزی را روی رکورد بکارد.
 *
 * ⚠️ فیلدهایی که در اسکیما `readonly`اند و کلیدهایی که در اسکیما نیستند، در
 * ویرایش **حفظ** می‌شوند (merge روی رکورد موجود) نه پاک. یک شمارنده مثل
 * `booked_count` یا فیلدی که فقط بات می‌شناسد نباید با یک ویرایش از سایت
 * ناپدید شود.
 */
import { Router } from "express";
import { requireAuth } from "./auth.js";
import { requirePluginEnabled, isPluginEnabled } from "../lib/pluginGate.js";
import {
  COLLECTIONS,
  getCollection,
  newRecordId,
  type CollectionSpec,
  type FieldSpec,
} from "../lib/pluginCollections.js";
import {
  resolveBotSheet,
  listEntity,
  getEntity,
  putEntity,
  removeEntity,
  assertSheetsAuthoritative,
  sendBotConfigError,
  BotConfigError,
} from "../lib/botConfig.js";

const router = Router();

function bad(message: string, code?: string): BotConfigError {
  return new BotConfigError(400, message, code);
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * یک مقدار خام از کلاینت → مقدار ذخیره‌شدنی، بر اساس نوع فیلد.
 *
 * `undefined` برمی‌گرداند اگر فیلد در ورودی نبود (یعنی «دست نزن»)، که با
 * «مقدار خالی بفرست» (یعنی «پاک کن») تفاوت دارد.
 */
function coerce(field: FieldSpec, raw: unknown): unknown {
  if (raw === undefined) return undefined;

  switch (field.type) {
    case "boolean":
      // چک‌باکس HTML ممکن است "true"/"on" بفرستد، نه بولی واقعی.
      if (typeof raw === "boolean") return raw;
      if (typeof raw === "string") return raw === "true" || raw === "on" || raw === "1";
      return Boolean(raw);

    case "number": {
      if (raw === "" || raw === null) return 0;
      const value = Number(raw);
      if (!Number.isFinite(value))
        throw bad(`مقدار «${field.label.fa}» باید یک عدد باشد.`, "bad_number");
      if (field.min !== undefined && value < field.min)
        throw bad(`«${field.label.fa}» نباید کمتر از ${field.min} باشد.`, "out_of_range");
      if (field.max !== undefined && value > field.max)
        throw bad(`«${field.label.fa}» نباید بیشتر از ${field.max} باشد.`, "out_of_range");
      // عددهای گِرد به int تبدیل می‌شوند تا روی شیت "5" بنشیند نه "5.0" —
      // همان کاری که `RecordStore.increment` در بات می‌کند.
      return Number.isInteger(value) ? value : value;
    }

    case "select": {
      const value = String(raw ?? "");
      const allowed = (field.options ?? []).map((o) => o.value);
      if (value && allowed.length > 0 && !allowed.includes(value))
        throw bad(`مقدار «${field.label.fa}» معتبر نیست.`, "bad_option");
      return value;
    }

    case "datetime": {
      const value = String(raw ?? "").trim();
      if (!value) return "";
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime()))
        throw bad(`تاریخ «${field.label.fa}» معتبر نیست.`, "bad_datetime");
      // ISO با timezone صریح — بات با `parse_iso` می‌خواند و تاریخ بدون
      // timezone را UTC فرض می‌کند؛ صریح نوشتن، ابهام را حذف می‌کند.
      return parsed.toISOString();
    }

    case "readonly":
      return undefined; // هرگز از کلاینت پذیرفته نمی‌شود

    default: {
      const value = String(raw ?? "");
      const limit = field.maxLength ?? 2000;
      if (value.length > limit)
        throw bad(`طول «${field.label.fa}» از ${limit} کاراکتر بیشتر است.`, "too_long");
      return value;
    }
  }
}

/**
 * ورودی کلاینت → تکه‌ی قابل نوشتن.
 *
 * `creating=true` یعنی فیلدهای اجباری باید حاضر باشند و پیش‌فرض‌ها اعمال شوند.
 * در ویرایش، فیلدِ نفرستاده دست‌نخورده می‌ماند (PATCH، نه PUT).
 */
function buildPayload(spec: CollectionSpec, body: any, creating: boolean): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw bad("بدنه‌ی درخواست باید یک آبجکت باشد.");

  const out: Record<string, unknown> = {};

  for (const field of spec.fields) {
    if (field.type === "readonly") continue;

    let value = coerce(field, body[field.key]);

    if (value === undefined && creating && field.default !== undefined) {
      value = field.default;
    }

    if (creating && field.required) {
      const empty = value === undefined || value === "" || value === null;
      if (empty) throw bad(`«${field.label.fa}» الزامی است.`, "field_required");
    }

    if (value !== undefined) out[field.key] = value;
  }

  return out;
}

/** رکوردهای یک تب، مرتب‌شده. تبِ ناموجود = خالی، نه خطا. */
async function readCollection(spreadsheetId: string, spec: CollectionSpec) {
  let rows: Array<{ key: string; value: any }>;
  try {
    rows = await listEntity<any>(spreadsheetId, spec.tab);
  } catch {
    // تب‌های پلاگین lazy ساخته می‌شوند؛ نبودشان روی باتی که تازه پلاگین را
    // روشن کرده **حالت عادی** است.
    return [];
  }

  const records = rows
    .filter((row) => row.value && typeof row.value === "object" && !Array.isArray(row.value))
    .map((row) => ({ id: row.key, ...row.value, id_key: row.key }));

  const sortBy = spec.sortBy ?? "created_at";
  records.sort((a: any, b: any) => {
    const left = a[sortBy] ?? "";
    const right = b[sortBy] ?? "";
    if (typeof left === "number" && typeof right === "number") return right - left;
    return String(right).localeCompare(String(left));
  });
  return records;
}

// ─── اسکیماها ───────────────────────────────────────────────────────────────

/**
 * اسکیمای مجموعه‌هایی که پلاگینشان روی این بات فعال است.
 *
 * فقط فعال‌ها برگردانده می‌شوند تا UI مجبور نباشد خودش گیت را دوباره پیاده
 * کند — و دقیقاً همان چیزی را ببیند که سرور اجازه می‌دهد.
 */
router.get("/bots/:botId/plugin-collections", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);

    const plugins = [...new Set(COLLECTIONS.map((c) => c.plugin))];
    const enabled = new Set<string>();
    await Promise.all(
      plugins.map(async (pluginId) => {
        if (await isPluginEnabled(spreadsheetId, pluginId)) enabled.add(pluginId);
      }),
    );

    res.json({
      collections: COLLECTIONS.filter((c) => enabled.has(c.plugin)),
      enabledPlugins: [...enabled],
    });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to list plugin collections");
  }
});

// ─── فهرست ──────────────────────────────────────────────────────────────────

router.get("/bots/:botId/plugin-data/:collection", requireAuth, async (req: any, res) => {
  try {
    const spec = getCollection(String(req.params.collection));
    if (!spec) throw new BotConfigError(404, "این مجموعه شناخته‌شده نیست.", "collection_not_found");

    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, spec.plugin);

    res.json({
      collection: spec.key,
      spec,
      records: await readCollection(spreadsheetId, spec),
    });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to list plugin records");
  }
});

// ─── ساخت ───────────────────────────────────────────────────────────────────

router.post("/bots/:botId/plugin-data/:collection", requireAuth, async (req: any, res) => {
  try {
    const spec = getCollection(String(req.params.collection));
    if (!spec) throw new BotConfigError(404, "این مجموعه شناخته‌شده نیست.", "collection_not_found");
    if (spec.readonly || spec.noCreate)
      throw new BotConfigError(
        405,
        `«${spec.title.fa}» از سایت ساخته نمی‌شود — این رکوردها را خودِ بات می‌سازد.`,
        "create_not_allowed",
      );

    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, spec.plugin);
    await assertSheetsAuthoritative(spec.tab);

    const payload = buildPayload(spec, req.body, true);
    const id = newRecordId(spec.idPrefix);
    const record = { ...payload, id, created_at: nowIso() };

    await putEntity(spreadsheetId, spec.tab, id, record);
    res.status(201).json({ record: { ...record, id_key: id } });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to create plugin record");
  }
});

// ─── ویرایش ─────────────────────────────────────────────────────────────────

router.patch("/bots/:botId/plugin-data/:collection/:id", requireAuth, async (req: any, res) => {
  try {
    const spec = getCollection(String(req.params.collection));
    if (!spec) throw new BotConfigError(404, "این مجموعه شناخته‌شده نیست.", "collection_not_found");
    if (spec.readonly)
      throw new BotConfigError(
        405,
        `«${spec.title.fa}» از سایت قابل ویرایش نیست.`,
        "update_not_allowed",
      );

    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, spec.plugin);
    await assertSheetsAuthoritative(spec.tab);

    const id = String(req.params.id);
    const existing = await getEntity<Record<string, unknown>>(spreadsheetId, spec.tab, id);
    if (!existing || typeof existing !== "object" || Array.isArray(existing))
      throw new BotConfigError(404, "این رکورد پیدا نشد.", "record_not_found");

    // merge روی رکورد موجود — نه جایگزینی. فیلدهای readonly، شمارنده‌ها، و هر
    // کلیدی که فقط بات می‌شناسد باید سرِ جایشان بمانند.
    const payload = buildPayload(spec, req.body, false);
    const record = { ...existing, ...payload, id, updated_at: nowIso() };

    await putEntity(spreadsheetId, spec.tab, id, record);
    res.json({ record: { ...record, id_key: id } });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to update plugin record");
  }
});

// ─── حذف ────────────────────────────────────────────────────────────────────

router.delete("/bots/:botId/plugin-data/:collection/:id", requireAuth, async (req: any, res) => {
  try {
    const spec = getCollection(String(req.params.collection));
    if (!spec) throw new BotConfigError(404, "این مجموعه شناخته‌شده نیست.", "collection_not_found");
    if (spec.readonly)
      throw new BotConfigError(405, `«${spec.title.fa}» از سایت حذف نمی‌شود.`, "delete_not_allowed");

    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await requirePluginEnabled(spreadsheetId, spec.plugin);
    await assertSheetsAuthoritative(spec.tab);

    const id = String(req.params.id);
    const removed = await removeEntity(spreadsheetId, spec.tab, id);
    // حذفِ شناسه‌ی ناموجود ۴۰۴ می‌دهد، نه ۲۰۴ — وگرنه کلاینت فکر می‌کرد چیزی
    // پاک شد که هرگز وجود نداشت (همان اشتباهی که در پنل ادمین اصلاح شد).
    if (!removed) throw new BotConfigError(404, "این رکورد پیدا نشد.", "record_not_found");

    res.status(204).end();
  } catch (err) {
    sendBotConfigError(res, err, "Failed to delete plugin record");
  }
});

export default router;
