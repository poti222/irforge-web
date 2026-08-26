/**
 * routes/botObjects.ts — آبجکت‌های دینامیک (تب `object_schemas` + `obj_<slug>`).
 * ─────────────────────────────────────────────────────────────────────────────
 * شکل دقیق از `mainbot/utils/object_engine.py` استخراج شده، نه حدس زده:
 *
 *   schema (تب `object_schemas`، کلید = `object_id`):
 *     { id, name, slug, icon, color, fields[], permissions{}, is_active,
 *       created_at, updated_at }
 *   field:
 *     { id, name, label, type, required, options[], relation_object_id, order }
 *   record (تب `obj_<slug>`، کلید = `_id`):
 *     { _id, _created_at, _updated_at, _created_by, _metadata, ...fieldValues }
 *
 * دو نکته‌ی حیاتی که از کد آمده‌اند:
 *   - نام شیت رکوردها `obj_{slug}` است (خط ۱۰۶) — نه `slug` خالی.
 *   - رکورد **فقط** فیلدهای تعریف‌شده در schema را نگه می‌دارد (خط ۶۱۰)؛ هر
 *     کلید اضافه‌ی کلاینت دور ریخته می‌شود، دقیقاً مثل خود موتور.
 */
import { Router } from "express";
import { requireAuth } from "./auth.js";
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
import { logger } from "../lib/logger.js";
import { nowIso, newUuid } from "../lib/botTypes.js";

const router = Router();
const SCHEMAS_TAB = "object_schemas";

/** انواع فیلد آبجکت. `relation` به یک آبجکت دیگر اشاره می‌کند. */
export const OBJECT_FIELD_TYPES = [
  "text", "number", "boolean", "date", "select", "relation", "textarea", "url", "email",
] as const;

export type ObjectField = {
  id: string;
  name: string;
  label: string;
  type: string;
  required: boolean;
  options: string[];
  relation_object_id: string;
  order: number;
};

export type ObjectSchema = {
  id: string;
  name: string;
  slug: string;
  icon: string;
  color: string;
  fields: ObjectField[];
  permissions: Record<string, string[]>;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

function bad(message: string, code?: string): BotConfigError {
  return new BotConfigError(400, message, code);
}

/** نام تب رکوردها — عیناً `_object_sheet_name` بات (خط ۱۰۶). */
export function recordTab(slug: string): string {
  return `obj_${slug}`;
}

const RELATION_DEFS_TAB = "relation_definitions";
const RELATION_LINKS_TAB = "relation_links";

/**
 * لینک‌هایی که شرط را برآورده می‌کنند حذف می‌کند و تعدادشان را برمی‌گرداند.
 *
 * چرا لازم است: حذف یک رکورد یا یک آبجکت، لینک‌هایی را که به آن اشاره
 * می‌کردند جا می‌گذاشت. آن لینک‌ها به هیچ‌چیز اشاره نمی‌کنند ولی در سکشن
 * روابط شمرده و نشان داده می‌شوند — یک شکست بی‌صدای تمام‌عیار.
 *
 * **هرگز throw نمی‌کند**: تب لینک‌ها ممکن است اصلاً وجود نداشته باشد، و
 * شکستِ پاک‌سازی نباید خودِ حذف را — که موفق شده — به خطا تبدیل کند.
 */
async function removeLinksOf(
  spreadsheetId: string,
  matches: (link: { id: string; relation_def_id?: string; source_record_id?: string; target_record_id?: string }) => boolean,
): Promise<number> {
  try {
    const rows = await listEntity<{
      relation_def_id?: string;
      source_record_id?: string;
      target_record_id?: string;
    }>(spreadsheetId, RELATION_LINKS_TAB);

    let removed = 0;
    for (const row of rows) {
      if (!row.value || typeof row.value !== "object") continue;
      if (!matches({ id: row.key, ...row.value })) continue;
      if (await removeEntity(spreadsheetId, RELATION_LINKS_TAB, row.key)) removed += 1;
    }
    return removed;
  } catch (err) {
    logger.warn({ err, spreadsheetId }, "removeLinksOf failed (ignored)");
    return 0;
  }
}

/** همان `_validate_slug`: فقط a-z0-9_ و حداکثر ۳۰ کاراکتر. */
function validateSlug(value: unknown): string {
  const slug = String(value ?? "").toLowerCase().trim();
  if (!/^[a-z][a-z0-9_]{0,29}$/.test(slug))
    throw bad("شناسه (slug) نامعتبر است: فقط حروف کوچک انگلیسی، عدد و زیرخط، حداکثر ۳۰ کاراکتر.", "bad_slug");
  return slug;
}

function validateFields(value: unknown): ObjectField[] {
  if (!Array.isArray(value)) throw bad("فهرست فیلدها باید آرایه باشد.");
  if (value.length > 60) throw bad("حداکثر ۶۰ فیلد برای یک آبجکت مجاز است.");

  const seen = new Set<string>();
  return value.map((raw: any, i: number) => {
    const name = String(raw?.name ?? "").trim();
    if (!name) throw bad(`نام فیلد شماره ${i + 1} خالی است.`);
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name))
      throw bad(`نام فیلد «${name}» باید با حرف انگلیسی شروع شود و فقط حرف، عدد و زیرخط داشته باشد.`);
    // نام فیلد کلیدِ ستون رکورد است؛ برخورد با فیلدهای سیستمی رکورد را خراب می‌کند.
    if (name.startsWith("_")) throw bad(`نام فیلد نمی‌تواند با زیرخط شروع شود («${name}») — این‌ها برای فیلدهای سیستمی رزرو شده‌اند.`);
    if (seen.has(name)) throw bad(`نام فیلد «${name}» تکراری است.`, "duplicate_field");
    seen.add(name);

    const type = String(raw?.type ?? "text");
    if (!(OBJECT_FIELD_TYPES as readonly string[]).includes(type))
      throw bad(`نوع فیلد «${name}» معتبر نیست.`);

    const options = Array.isArray(raw?.options) ? raw.options.map((o: unknown) => String(o)).filter(Boolean) : [];
    if (type === "select" && options.length === 0)
      throw bad(`فیلد «${name}» از نوع انتخابی است و باید حداقل یک گزینه داشته باشد.`);

    const relationObjectId = String(raw?.relation_object_id ?? "");
    if (type === "relation" && !relationObjectId)
      throw bad(`فیلد «${name}» از نوع رابطه است و باید آبجکت مقصد داشته باشد.`);

    return {
      id: String(raw?.id ?? newUuid().slice(0, 8)),
      name,
      label: String(raw?.label ?? name),
      type,
      required: Boolean(raw?.required),
      options,
      relation_object_id: relationObjectId,
      order: Number.isInteger(raw?.order) ? Number(raw.order) : i,
    };
  }).sort((a, b) => a.order - b.order).map((f, i) => ({ ...f, order: i }));
}

/** Exported for routes/botWorkflows.ts's condition-field catalog — the object schemas are the only source of truth for what an `event.object.*` payload's `record` actually contains. */
export async function readSchemas(spreadsheetId: string): Promise<ObjectSchema[]> {
  const rows = await listEntity<ObjectSchema>(spreadsheetId, SCHEMAS_TAB);
  return rows
    .filter((r) => r.value && typeof r.value === "object")
    .map((r) => ({ ...(r.value as ObjectSchema), id: r.key }));
}

async function requireSchema(spreadsheetId: string, objectId: string): Promise<ObjectSchema> {
  const schema = await getEntity<ObjectSchema>(spreadsheetId, SCHEMAS_TAB, objectId);
  if (!schema) throw new BotConfigError(404, "این آبجکت پیدا نشد.", "object_not_found");
  return { ...schema, id: objectId };
}

// ─── schemaها ───────────────────────────────────────────────────────────────

router.get("/bots/:botId/objects", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    const objects = await readSchemas(spreadsheetId);

    // تعداد رکوردها برای هر آبجکت — تا حذف بتواند صادقانه هشدار بدهد.
    const withCounts = await Promise.all(
      objects.map(async (schema) => {
        let recordCount = 0;
        try {
          recordCount = (await listEntity(spreadsheetId, recordTab(schema.slug))).length;
        } catch {
          // تب رکوردها ممکن است هنوز ساخته نشده باشد — یعنی صفر، نه خطا.
        }
        return { ...schema, recordCount };
      })
    );

    res.json({ objects: withCounts, fieldTypes: OBJECT_FIELD_TYPES });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to list objects");
  }
});

router.get("/bots/:botId/objects/:objectId", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    res.json({ object: await requireSchema(spreadsheetId, req.params.objectId) });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to read object");
  }
});

router.post("/bots/:botId/objects", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await assertSheetsAuthoritative(SCHEMAS_TAB);

    const body = req.body ?? {};
    const name = String(body.name ?? "").trim();
    if (!name) throw bad("آبجکت باید نام داشته باشد.");
    const slug = validateSlug(body.slug);

    const existing = await readSchemas(spreadsheetId);
    if (existing.some((o) => o.slug === slug))
      throw new BotConfigError(409, `آبجکتی با شناسه‌ی «${slug}» از قبل وجود دارد.`, "duplicate_slug");

    const schema: ObjectSchema = {
      id: newUuid(),
      name,
      slug,
      icon: String(body.icon ?? "📦"),
      color: String(body.color ?? "#3498db"),
      fields: validateFields(body.fields ?? []),
      // همان پیش‌فرض‌های `create_object` بات.
      permissions:
        body.permissions && typeof body.permissions === "object"
          ? body.permissions
          : { create: ["admin", "user"], read: ["admin", "user"], update: ["admin"], delete: ["admin"] },
      is_active: body.is_active === undefined ? true : Boolean(body.is_active),
      created_at: nowIso(),
      updated_at: nowIso(),
    };

    await putEntity(spreadsheetId, SCHEMAS_TAB, schema.id, schema);
    res.status(201).json({ object: schema });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to create object");
  }
});

router.patch("/bots/:botId/objects/:objectId", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await assertSheetsAuthoritative(SCHEMAS_TAB);

    const current = await requireSchema(spreadsheetId, req.params.objectId);
    const body = req.body ?? {};
    const next: ObjectSchema = { ...current };

    if ("name" in body) {
      const name = String(body.name ?? "").trim();
      if (!name) throw bad("آبجکت باید نام داشته باشد.");
      next.name = name;
    }
    if ("icon" in body) next.icon = String(body.icon ?? "📦");
    if ("color" in body) next.color = String(body.color ?? "#3498db");
    if ("is_active" in body) next.is_active = Boolean(body.is_active);
    if ("fields" in body) next.fields = validateFields(body.fields);
    // `slug` عمداً قابل تغییر نیست: نام تب رکوردها از آن ساخته می‌شود
    // (`obj_<slug>`) و تغییرش یعنی همه‌ی رکوردهای موجود ناپدید شوند.
    if ("slug" in body && String(body.slug).toLowerCase().trim() !== current.slug)
      throw bad(
        "شناسه (slug) آبجکت قابل تغییر نیست، چون نام تب رکوردها از روی آن ساخته شده و تغییرش همه‌ی رکوردهای فعلی را از دسترس خارج می‌کند.",
        "slug_immutable"
      );

    next.updated_at = nowIso();
    await putEntity(spreadsheetId, SCHEMAS_TAB, next.id, next);
    res.json({ object: next });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to update object");
  }
});

router.delete("/bots/:botId/objects/:objectId", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await assertSheetsAuthoritative(SCHEMAS_TAB);

    const schema = await requireSchema(spreadsheetId, req.params.objectId);

    // رابطه‌های تعریف‌شده روی این آبجکت قبل از حذف باید دیده شوند.
    //
    // ⚠️ این چک تا امروز **هیچ‌وقت کار نمی‌کرد**: روی `from_object`/`to_object`
    // فیلتر می‌شد، در حالی که `botRelations.ts` این فیلدها را
    // `source_object_id`/`target_object_id` می‌نویسد (همان واگرایی‌ای که در
    // هدر همان فایل هشدار داده شده). نتیجه: فیلتر همیشه خالی برمی‌گشت، هشدار
    // هرگز نشان داده نمی‌شد، و آبجکت بی‌صدا حذف می‌شد در حالی که روابطی به آن
    // اشاره می‌کردند.
    let relations: Array<{ id: string; name: string }> = [];
    try {
      const rows = await listEntity<{
        name?: string;
        source_object_id?: string;
        target_object_id?: string;
      }>(spreadsheetId, RELATION_DEFS_TAB);
      relations = rows
        .filter(
          (r) =>
            r.value &&
            typeof r.value === "object" &&
            (r.value.source_object_id === schema.id || r.value.target_object_id === schema.id)
        )
        .map((r) => ({ id: r.key, name: r.value.name ?? r.key }));
    } catch {
      /* تب روابط ممکن است وجود نداشته باشد. */
    }

    if (relations.length > 0 && req.query.force !== "true")
      throw new BotConfigError(
        409,
        `این آبجکت در ${relations.length} رابطه استفاده شده است (${relations
          .map((r) => `«${r.name}»`)
          .join("، ")}). اول آن روابط را حذف کنید یا با تأیید صریح ادامه دهید.`,
        "object_in_relations"
      );

    await removeEntity(spreadsheetId, SCHEMAS_TAB, schema.id);

    // با تأیید صریح، رابطه‌هایی که به این آبجکت اشاره می‌کردند هم می‌روند —
    // به‌همراه لینک‌هایشان. رابطه‌ای که یک سرش وجود ندارد هرگز کار نمی‌کند و
    // فقط سکشن روابط را با ردیف‌های شکسته پر می‌کند.
    let removedRelations = 0;
    let removedLinks = 0;
    for (const relation of relations) {
      removedLinks += await removeLinksOf(spreadsheetId, (link) => link.relation_def_id === relation.id);
      if (await removeEntity(spreadsheetId, RELATION_DEFS_TAB, relation.id)) removedRelations += 1;
    }

    // تب رکوردها عمداً حذف نمی‌شود: پاک‌کردن یک worksheet کامل از یک عملیات
    // حذفِ schema برگشت‌ناپذیرتر از چیزی است که کاربر انتظار دارد. schema رفته،
    // داده‌ی خام سر جایش می‌ماند و از منوی دیتابیس قابل بازیابی است.
    res.json({
      deleted: schema.id,
      recordTabKept: recordTab(schema.slug),
      removedRelations,
      removedLinks,
    });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to delete object");
  }
});

// ─── رکوردها ────────────────────────────────────────────────────────────────

router.get("/bots/:botId/objects/:objectId/records", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    const schema = await requireSchema(spreadsheetId, req.params.objectId);

    let records: Array<Record<string, unknown>> = [];
    try {
      const rows = await listEntity<Record<string, unknown>>(spreadsheetId, recordTab(schema.slug));
      records = rows
        .filter((r) => r.value && typeof r.value === "object")
        .map((r) => ({ ...(r.value as Record<string, unknown>), _id: r.key }));
    } catch {
      records = [];
    }

    const search = String(req.query.search ?? "").trim().toLowerCase();
    if (search) {
      records = records.filter((rec) =>
        Object.values(rec).some((v) => String(v ?? "").toLowerCase().includes(search))
      );
    }

    const page = Math.max(1, Number(req.query.page ?? 1) || 1);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50) || 50));
    const start = (page - 1) * limit;

    res.json({
      records: records.slice(start, start + limit),
      total: records.length,
      page,
      totalPages: Math.max(1, Math.ceil(records.length / limit)),
      schema,
    });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to list records");
  }
});

/** فقط فیلدهای schema نگه داشته می‌شوند — عیناً `create_record` بات (خط ۶۱۰). */
function projectRecord(schema: ObjectSchema, data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of schema.fields ?? []) {
    const value = data[field.name];
    if (field.required && (value === undefined || value === null || value === ""))
      throw bad(`فیلد «${field.label || field.name}» اجباری است.`, "required_field");
    out[field.name] = value ?? "";
  }
  return out;
}

router.post("/bots/:botId/objects/:objectId/records", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    const schema = await requireSchema(spreadsheetId, req.params.objectId);
    await assertSheetsAuthoritative(recordTab(schema.slug));

    const recordId = newUuid();
    const record = {
      _id: recordId,
      _created_at: nowIso(),
      _updated_at: nowIso(),
      _created_by: String(req.userId),
      _metadata: {},
      ...projectRecord(schema, req.body ?? {}),
    };

    await putEntity(spreadsheetId, recordTab(schema.slug), recordId, record);
    res.status(201).json({ record });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to create record");
  }
});

router.patch("/bots/:botId/objects/:objectId/records/:recordId", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    const schema = await requireSchema(spreadsheetId, req.params.objectId);
    await assertSheetsAuthoritative(recordTab(schema.slug));

    const current = await getEntity<Record<string, unknown>>(
      spreadsheetId,
      recordTab(schema.slug),
      req.params.recordId
    );
    if (!current) throw new BotConfigError(404, "این رکورد پیدا نشد.", "record_not_found");

    // فیلدهای سیستمی از رکورد فعلی می‌آیند، نه از body — کلاینت نباید بتواند
    // `_created_by` یا `_created_at` را بازنویسی کند.
    const next = {
      ...current,
      ...projectRecord(schema, { ...current, ...(req.body ?? {}) }),
      _id: req.params.recordId,
      _created_at: current._created_at ?? nowIso(),
      _created_by: current._created_by ?? "",
      _updated_at: nowIso(),
    };

    await putEntity(spreadsheetId, recordTab(schema.slug), req.params.recordId, next);
    res.json({ record: next });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to update record");
  }
});

router.delete("/bots/:botId/objects/:objectId/records/:recordId", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    const schema = await requireSchema(spreadsheetId, req.params.objectId);
    await assertSheetsAuthoritative(recordTab(schema.slug));

    const removed = await removeEntity(spreadsheetId, recordTab(schema.slug), req.params.recordId);
    if (!removed) throw new BotConfigError(404, "این رکورد پیدا نشد.", "record_not_found");

    // لینک‌های رابطه‌ای که به این رکورد اشاره می‌کردند هم می‌روند. بدون این،
    // سکشن روابط لینک‌هایی را نشان می‌داد که یک سرشان دیگر وجود ندارد.
    const removedLinks = await removeLinksOf(
      spreadsheetId,
      (link) =>
        link.source_record_id === req.params.recordId || link.target_record_id === req.params.recordId,
    );

    res.json({ deleted: req.params.recordId, removedLinks });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to delete record");
  }
});

export default router;
