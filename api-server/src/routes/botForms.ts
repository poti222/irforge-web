/**
 * routes/botForms.ts — CRUD فرم‌ها روی تب `forms` شیت تننت.
 *
 * باگ B12 در بات: مقصد فرم (`destination_group`) فقط از یک منوی جدا
 * (`ap:formdests`) قابل ویرایش است و با ویرایش خود فرم یکی نیست. اینجا هر فیلد
 * فرم — از عنوان تا مقصد تا فیلدهایش — در یک منبع واحد ذخیره و در یک صفحه
 * ویرایش می‌شود.
 *
 * لایوباگ: «نمی‌شه فرم رو ادیت کرد» — تا امروز POST/PATCH/DELETE هر سه
 * بی‌قیدوشرط `assertSheetsAuthoritative(FORMS_TAB)` را صدا می‌زدند، که به
 * محض روشن‌شدنِ پرچمِ cutoverِ «forms» یک تننت (از خریدِ خودسرویسِ دیتابیسِ
 * SQL یا ابزار Sheets Import سوپرادمین) با ۴۰۹ رد می‌شد — چون
 * `lib/businessPg.ts` هنوز نمی‌دانست «forms» چیست. حالا که آن فایل «forms»
 * را هم می‌شناسد، `listEntity`/`putEntity`/`removeEntity` خودشان برای
 * تننتِ cutover‌شده به Postgres می‌روند و دیگر نیازی به این قفل نیست —
 * دقیقاً همان چیزی که برای «panels» قبلاً اصلاح شد.
 */
import { Router } from "express";
import { requireAuth } from "./auth.js";
import {
  resolveBotSheet,
  listEntity,
  getEntity,
  putEntity,
  removeEntity,
  sendBotConfigError,
  BotConfigError,
} from "../lib/botConfig.js";
import { listPanels, COMMANDS_TAB } from "../lib/panelOps.js";
import {
  FORM_FIELD_TYPES,
  TELEGRAM_TEXT_LIMIT,
  newForm,
  nowIso,
  type Form,
  type FormField,
  type Panel,
  type PanelButton,
} from "../lib/botTypes.js";
import { validateButtons } from "./botPanels.js";

/** انواعِ مدیایِ مجاز برایِ پیامِ تشکر — عیناً چهارتایی که handlers/user.py
 * برایِ نوعِ پنلِ «media» تک‌آیتمی می‌شناسد (photo/video/audio/document). */
const THANK_YOU_MEDIA_TYPES = ["photo", "video", "audio", "document"] as const;

const router = Router();
export const FORMS_TAB = "forms";

function bad(message: string, code?: string): BotConfigError {
  return new BotConfigError(400, message, code);
}

// ─── ولیدیشن ────────────────────────────────────────────────────────────────

/**
 * فیلدهای فرم. سه قاعده‌ای که نبودشان بعداً به‌شکل خطای بی‌ربط در بات ظاهر می‌شود:
 *   - `name` باید یکتا و `^[a-zA-Z0-9_]+$` باشد (کلید داده‌ی کاربر است).
 *   - `validation_regex` باید **واقعاً کامپایل شود**، وگرنه بات موقع اعتبارسنجی
 *     پاسخ کاربر خطا می‌دهد و کسی نمی‌فهمد چرا.
 *   - نوع `select` بدون گزینه یعنی کاربر به یک بن‌بست می‌خورد.
 */
function validateFields(value: unknown): FormField[] {
  if (!Array.isArray(value)) throw bad("فهرست فیلدهای فرم باید آرایه باشد.");
  if (value.length > 50) throw bad("حداکثر ۵۰ فیلد برای یک فرم مجاز است.");

  const seen = new Set<string>();
  const fields = value.map((raw: any, i: number) => {
    if (!raw || typeof raw !== "object") throw bad(`فیلد شماره ${i + 1} معتبر نیست.`);

    const name = String(raw.name ?? "").trim();
    if (!name) throw bad(`نام فیلد شماره ${i + 1} خالی است.`);
    if (!/^[a-zA-Z0-9_]+$/.test(name))
      throw bad(`نام فیلد «${name}» فقط می‌تواند حروف انگلیسی، عدد و زیرخط باشد.`, "bad_field_name");
    if (seen.has(name)) throw bad(`نام فیلد «${name}» تکراری است.`, "duplicate_field_name");
    seen.add(name);

    const label = String(raw.label ?? "").trim();
    if (!label) throw bad(`عنوان نمایشی فیلد «${name}» خالی است.`);

    const type = String(raw.type ?? "text");
    if (!(FORM_FIELD_TYPES as readonly string[]).includes(type))
      throw bad(`نوع فیلد «${name}» معتبر نیست.`);

    const options = Array.isArray(raw.options)
      ? raw.options.map((o: unknown) => String(o).trim()).filter(Boolean)
      : [];
    if (type === "select" && options.length === 0)
      throw bad(`فیلد «${name}» از نوع «انتخابی» است و باید حداقل یک گزینه داشته باشد.`, "select_needs_options");

    const validation_regex = String(raw.validation_regex ?? "");
    if (validation_regex) {
      try {
        // فقط برای اعتبارسنجی کامپایل می‌شود؛ خودِ رشته ذخیره می‌شود تا پایتون
        // همان را بگیرد.
        new RegExp(validation_regex);
      } catch {
        throw bad(`الگوی اعتبارسنجی فیلد «${name}» یک regex معتبر نیست.`, "bad_regex");
      }
      if (validation_regex.length > 500)
        throw bad(`الگوی اعتبارسنجی فیلد «${name}» بیش از حد طولانی است.`);
    }

    return {
      name,
      label,
      type,
      required: raw.required === undefined ? true : Boolean(raw.required),
      options,
      validation_regex,
      error_message: String(raw.error_message ?? ""),
      order: Number.isInteger(raw.order) ? Number(raw.order) : i,
    } satisfies FormField;
  });

  // ترتیب سمت سرور نرمال می‌شود: ۰..n-1 بدون شکاف و بدون تکرار.
  return fields
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((f, i) => ({ ...f, order: i }));
}

function validateText(value: unknown, field: string, max = TELEGRAM_TEXT_LIMIT): string {
  if (typeof value !== "string") throw bad(`مقدار «${field}» باید متن باشد.`);
  if (value.length > max) throw bad(`طول «${field}» از ${max} کاراکتر بیشتر است.`);
  return value;
}

/** مقصد فرم: آی‌دی عددی چت (معمولاً منفی برای گروه) یا @یوزرنیم، یا خالی. */
function validateDestination(value: unknown): string {
  const s = String(value ?? "").trim();
  if (!s) return "";
  if (/^-?\d{5,}$/.test(s) || /^@[A-Za-z][A-Za-z0-9_]{4,31}$/.test(s)) return s;
  throw bad("گروه مقصد باید یک آی‌دی عددی چت باشد (مثل -1001234567890) یا یوزرنیم با @.");
}

function validateAdminIds(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw bad("فهرست ادمین‌های مقصد باید آرایه باشد.");
  return value.map((v) => String(v).trim()).filter(Boolean);
}

/** نوعِ مدیایِ پیامِ تشکر — خالی یعنی «بدون مدیا». */
function validateThankYouMediaType(value: unknown): string {
  const t = String(value ?? "").trim();
  if (!t) return "";
  if (!(THANK_YOU_MEDIA_TYPES as readonly string[]).includes(t))
    throw bad("نوع مدیای پیام تشکر معتبر نیست.");
  return t;
}

/** `file_id`ی تلگرام — همان سقفِ طولِ بقیه‌ی فیلدهای `file_id`‌مانندِ این کدبیس. */
function validateThankYouMediaFileId(value: unknown): string {
  const s = String(value ?? "").trim();
  if (s.length > 500) throw bad("شناسه‌ی مدیای پیام تشکر خیلی طولانی است.");
  return s;
}

/** دکمه‌های پیامِ تشکر — دقیقاً همان اعتبارسنجیِ دکمه‌های پنل
 * (`routes/botPanels.ts::validateButtons`)، عمداً reuse شده نه کپی. */
function validateThankYouButtons(value: unknown): PanelButton[] {
  return validateButtons(value);
}

async function readForms(spreadsheetId: string): Promise<Form[]> {
  const rows = await listEntity<Form>(spreadsheetId, FORMS_TAB);
  return rows
    .filter((r) => r.value && typeof r.value === "object")
    .map((r) => ({ ...(r.value as Form), id: r.key }));
}

// ─── مسیرها ─────────────────────────────────────────────────────────────────

router.get("/bots/:botId/forms", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    const forms = await readForms(spreadsheetId);
    res.json({ forms, count: forms.length, fieldTypes: FORM_FIELD_TYPES });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to list forms");
  }
});

router.get("/bots/:botId/forms/:formId", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    const form = await getEntity<Form>(spreadsheetId, FORMS_TAB, req.params.formId);
    if (!form) throw new BotConfigError(404, "این فرم پیدا نشد.", "form_not_found");
    res.json({ form: { ...form, id: req.params.formId } });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to read form");
  }
});

/** چه کسی به این فرم لینک داده — قبل از حذف باید نشان داده شود. */
router.get("/bots/:botId/forms/:formId/references", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    const formId = req.params.formId;
    const panels = await listPanels(spreadsheetId);

    const formPanels = panels
      .filter((p: Panel) => p.type === "form" && p.content === formId)
      .map((p) => ({ id: p.id, title: p.title }));

    const buttons: Array<{ panelId: string; panelTitle: string; label: string }> = [];
    for (const panel of panels) {
      for (const b of panel.buttons ?? []) {
        if (b?.action === "form" && b?.value === formId)
          buttons.push({ panelId: panel.id, panelTitle: panel.title, label: b.label });
      }
    }

    let commands: Array<{ command: string }> = [];
    try {
      const rows = await listEntity<{ command?: string; target?: string }>(spreadsheetId, COMMANDS_TAB);
      commands = rows
        .filter((r) => r.value && typeof r.value === "object" && r.value.target === `form:${formId}`)
        .map((r) => ({ command: r.value.command ?? r.key }));
    } catch {
      /* تب کامندها ممکن است هنوز ساخته نشده باشد. */
    }

    res.json({ panels: formPanels, buttons, commands });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to read form references");
  }
});

router.post("/bots/:botId/forms", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    // "forms" روی businessPg.ts ثبت شده — listEntity/putEntity/removeEntity
    // خودشان برای تننتِ cutover‌شده به Postgres می‌روند، پس اینجا دیگر
    // نیازی به assertSheetsAuthoritative نیست (همان چیزی که routes/botPanels.ts
    // برای panels از وقتی همین اتفاق برایش افتاد دیگر انجام نمی‌دهد).

    const body = req.body ?? {};
    const title = validateText(body.title ?? "", "عنوان فرم", 200).trim();
    if (!title) throw bad("فرم باید عنوان داشته باشد.");

    const form = newForm({
      title,
      fields: validateFields(body.fields ?? []),
      destination_group: validateDestination(body.destination_group),
      destination_admin_ids: validateAdminIds(body.destination_admin_ids),
      thank_you_message: body.thank_you_message
        ? validateText(body.thank_you_message, "پیام تشکر")
        : undefined,
      thank_you_media_file_id: validateThankYouMediaFileId(body.thank_you_media_file_id),
      thank_you_media_type: validateThankYouMediaType(body.thank_you_media_type),
      thank_you_buttons: validateThankYouButtons(body.thank_you_buttons ?? []),
      is_active: body.is_active === undefined ? true : Boolean(body.is_active),
      notify_admin: body.notify_admin === undefined ? true : Boolean(body.notify_admin),
      allow_edit: Boolean(body.allow_edit),
    });

    await putEntity(spreadsheetId, FORMS_TAB, form.id, form);
    res.status(201).json({ form });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to create form");
  }
});

router.patch("/bots/:botId/forms/:formId", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);

    const current = await getEntity<Form>(spreadsheetId, FORMS_TAB, req.params.formId);
    if (!current) throw new BotConfigError(404, "این فرم پیدا نشد.", "form_not_found");

    const body = req.body ?? {};
    // merge روی whitelist — فیلد غایب هرگز پاک نمی‌شود.
    const next: Form = { ...current, id: req.params.formId };
    if ("title" in body) {
      const title = validateText(body.title, "عنوان فرم", 200).trim();
      if (!title) throw bad("فرم باید عنوان داشته باشد.");
      next.title = title;
    }
    if ("fields" in body) next.fields = validateFields(body.fields);
    if ("destination_group" in body) next.destination_group = validateDestination(body.destination_group);
    if ("destination_admin_ids" in body) next.destination_admin_ids = validateAdminIds(body.destination_admin_ids);
    if ("thank_you_message" in body) next.thank_you_message = validateText(body.thank_you_message, "پیام تشکر");
    if ("thank_you_media_file_id" in body)
      next.thank_you_media_file_id = validateThankYouMediaFileId(body.thank_you_media_file_id);
    if ("thank_you_media_type" in body)
      next.thank_you_media_type = validateThankYouMediaType(body.thank_you_media_type);
    if ("thank_you_buttons" in body) next.thank_you_buttons = validateThankYouButtons(body.thank_you_buttons);
    if ("is_active" in body) next.is_active = Boolean(body.is_active);
    if ("notify_admin" in body) next.notify_admin = Boolean(body.notify_admin);
    if ("allow_edit" in body) next.allow_edit = Boolean(body.allow_edit);

    await putEntity(spreadsheetId, FORMS_TAB, next.id, next);
    res.json({ form: next });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to update form");
  }
});

router.delete("/bots/:botId/forms/:formId", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    const removed = await removeEntity(spreadsheetId, FORMS_TAB, req.params.formId);
    if (!removed) throw new BotConfigError(404, "این فرم پیدا نشد.", "form_not_found");
    // برخلاف پنل‌ها، ارجاع‌دهنده‌ها اینجا خودکار اصلاح نمی‌شوند: یک دکمه‌ی
    // `form` بدون مقصد در بات فقط پیام «پیدا نشد» می‌دهد، و اصلاحش انتخاب
    // کاربر است. برای همین UI موظف است اول `/references` را نشان بدهد.
    res.json({ deleted: req.params.formId, updatedAt: nowIso() });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to delete form");
  }
});

/** خالص و بدون DB — برای تست مستقیم بدون راه‌انداختن روت/شیت کامل. */
export const __testables = {
  validateThankYouMediaType,
  validateThankYouMediaFileId,
  validateThankYouButtons,
  validateDestination,
  validateAdminIds,
};

export default router;
