/**
 * routes/botRelations.ts — روابط بین آبجکت‌ها.
 * ─────────────────────────────────────────────────────────────────────────────
 * شکل دقیق از `mainbot/utils/relation_engine.py` استخراج شده:
 *
 *   تعریف (تب `relation_definitions`، کلید = `id`):
 *     { id, name, slug, type, source_object_id, source_label, target_object_id,
 *       target_label, inverse_slug, cascade_delete, required, config,
 *       is_active, created_by, created_at, updated_at }
 *   لینک (تب `relation_links`، کلید = `id`):
 *     { id, relation_def_id, source_record_id, target_record_id, created_by, created_at }
 *
 * ⚠️ نام‌ها `source_object_id`/`target_object_id` هستند، نه `from_object`/
 * `to_object`. و انواع فقط سه‌تای پرامپت نیستند: موتور
 * `one_to_one`, `one_to_many`, `many_to_many`, `parent_child`, `recursive`
 * را ذخیره می‌کند (`STORED_TYPES`) به‌علاوه‌ی انواع محاسبه‌شده‌ای که لینک ذخیره
 * نمی‌کنند. سایت فقط انواع ذخیره‌شونده را می‌سازد؛ ساختن یک نوع محاسبه‌شده از
 * اینجا یعنی رابطه‌ای که هیچ‌وقت لینکی نخواهد داشت.
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
import { nowIso, newUuid } from "../lib/botTypes.js";
import { recordTab, type ObjectSchema } from "./botObjects.js";

const router = Router();
const DEFS_TAB = "relation_definitions";
const LINKS_TAB = "relation_links";
const SCHEMAS_TAB = "object_schemas";

/** فقط انواعی که واقعاً لینک ذخیره می‌کنند — `STORED_TYPES` در موتور. */
export const STORED_RELATION_TYPES = [
  "one_to_one", "one_to_many", "many_to_many", "parent_child", "recursive",
] as const;

type RelationDef = {
  id: string;
  name: string;
  slug: string;
  type: string;
  source_object_id: string;
  source_label: string;
  target_object_id: string;
  target_label: string;
  inverse_slug: string;
  cascade_delete: boolean;
  required: boolean;
  config: Record<string, unknown>;
  is_active: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
};

type RelationLink = {
  id: string;
  relation_def_id: string;
  source_record_id: string;
  target_record_id: string;
  created_by: string;
  created_at: string;
};

function bad(message: string, code?: string): BotConfigError {
  return new BotConfigError(400, message, code);
}

async function readDefs(spreadsheetId: string): Promise<RelationDef[]> {
  const rows = await listEntity<RelationDef>(spreadsheetId, DEFS_TAB);
  return rows
    .filter((r) => r.value && typeof r.value === "object")
    .map((r) => ({ ...(r.value as RelationDef), id: r.key }));
}

async function readLinks(spreadsheetId: string, defId?: string): Promise<RelationLink[]> {
  let rows: Array<{ key: string; value: RelationLink }>;
  try {
    rows = await listEntity<RelationLink>(spreadsheetId, LINKS_TAB);
  } catch {
    return [];
  }
  return rows
    .filter((r) => r.value && typeof r.value === "object")
    .map((r) => ({ ...(r.value as RelationLink), id: r.key }))
    .filter((l) => !defId || l.relation_def_id === defId);
}

async function readObjects(spreadsheetId: string): Promise<ObjectSchema[]> {
  const rows = await listEntity<ObjectSchema>(spreadsheetId, SCHEMAS_TAB);
  return rows
    .filter((r) => r.value && typeof r.value === "object")
    .map((r) => ({ ...(r.value as ObjectSchema), id: r.key }));
}

// ─── تعریف روابط ────────────────────────────────────────────────────────────

router.get("/bots/:botId/relations", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    const [defs, links, objects] = await Promise.all([
      readDefs(spreadsheetId),
      readLinks(spreadsheetId),
      readObjects(spreadsheetId),
    ]);
    const byObject = new Map(objects.map((o) => [o.id, o]));

    res.json({
      relations: defs.map((def) => ({
        ...def,
        linkCount: links.filter((l) => l.relation_def_id === def.id).length,
        sourceObjectName: byObject.get(def.source_object_id)?.name ?? null,
        targetObjectName: byObject.get(def.target_object_id)?.name ?? null,
        // آبجکتی که وجود ندارد یعنی رابطه عملاً مرده است — UI باید بگویدش.
        broken: !byObject.has(def.source_object_id) || !byObject.has(def.target_object_id),
      })),
      objects: objects.map((o) => ({ id: o.id, name: o.name, slug: o.slug })),
      types: STORED_RELATION_TYPES,
    });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to list relations");
  }
});

router.post("/bots/:botId/relations", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await assertSheetsAuthoritative(DEFS_TAB);

    const body = req.body ?? {};
    const name = String(body.name ?? "").trim();
    if (!name) throw bad("رابطه باید نام داشته باشد.");

    const slug = String(body.slug ?? "").toLowerCase().trim();
    if (!/^[a-z][a-z0-9_]{0,29}$/.test(slug))
      throw bad("شناسه‌ی رابطه فقط می‌تواند حروف کوچک انگلیسی، عدد و زیرخط باشد.", "bad_slug");

    const type = String(body.type ?? "many_to_many");
    if (!(STORED_RELATION_TYPES as readonly string[]).includes(type))
      throw bad(`نوع رابطه «${type}» پشتیبانی نمی‌شود.`, "bad_type");

    const objects = await readObjects(spreadsheetId);
    const source = objects.find((o) => o.id === String(body.source_object_id ?? ""));
    const target = objects.find((o) => o.id === String(body.target_object_id ?? ""));
    if (!source) throw bad("آبجکت مبدأ وجود ندارد.", "source_not_found");
    if (!target) throw bad("آبجکت مقصد وجود ندارد.", "target_not_found");

    const defs = await readDefs(spreadsheetId);
    if (defs.some((d) => d.slug === slug))
      throw new BotConfigError(409, `رابطه‌ای با شناسه‌ی «${slug}» از قبل وجود دارد.`, "duplicate_slug");

    const definition: RelationDef = {
      id: newUuid(),
      name,
      slug,
      type,
      source_object_id: source.id,
      source_label: String(body.source_label ?? source.name),
      target_object_id: target.id,
      target_label: String(body.target_label ?? target.name),
      // همان پیش‌فرض موتور: `<slug>__inverse`.
      inverse_slug: String(body.inverse_slug ?? `${slug}__inverse`).toLowerCase(),
      cascade_delete: Boolean(body.cascade_delete),
      required: Boolean(body.required),
      config: body.config && typeof body.config === "object" ? body.config : {},
      is_active: body.is_active === undefined ? true : Boolean(body.is_active),
      created_by: String(req.userId),
      created_at: nowIso(),
      updated_at: nowIso(),
    };

    await putEntity(spreadsheetId, DEFS_TAB, definition.id, definition);
    res.status(201).json({ relation: definition });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to create relation");
  }
});

router.patch("/bots/:botId/relations/:relationId", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await assertSheetsAuthoritative(DEFS_TAB);

    const current = await getEntity<RelationDef>(spreadsheetId, DEFS_TAB, req.params.relationId);
    if (!current) throw new BotConfigError(404, "این رابطه پیدا نشد.", "relation_not_found");

    // همان whitelist دقیقِ `update_relation` بات (خط ۱۹۵) — نه بیشتر. تغییر
    // نوع یا آبجکت‌های دو سر، لینک‌های موجود را بی‌معنا می‌کند.
    const body = req.body ?? {};
    const next: RelationDef = { ...current, id: req.params.relationId };
    if ("name" in body) next.name = String(body.name ?? "").trim() || current.name;
    if ("source_label" in body) next.source_label = String(body.source_label ?? "");
    if ("target_label" in body) next.target_label = String(body.target_label ?? "");
    if ("cascade_delete" in body) next.cascade_delete = Boolean(body.cascade_delete);
    if ("required" in body) next.required = Boolean(body.required);
    if ("is_active" in body) next.is_active = Boolean(body.is_active);
    if ("config" in body && body.config && typeof body.config === "object") next.config = body.config;
    next.updated_at = nowIso();

    await putEntity(spreadsheetId, DEFS_TAB, next.id, next);
    res.json({ relation: next });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to update relation");
  }
});

router.delete("/bots/:botId/relations/:relationId", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await assertSheetsAuthoritative(DEFS_TAB);

    const definition = await getEntity<RelationDef>(spreadsheetId, DEFS_TAB, req.params.relationId);
    if (!definition) throw new BotConfigError(404, "این رابطه پیدا نشد.", "relation_not_found");

    // لینک‌های این رابطه بدون تعریفش زباله‌ی معلق‌اند — با هم می‌روند.
    const links = await readLinks(spreadsheetId, req.params.relationId);
    for (const link of links) await removeEntity(spreadsheetId, LINKS_TAB, link.id);
    await removeEntity(spreadsheetId, DEFS_TAB, req.params.relationId);

    res.json({ deleted: req.params.relationId, linksRemoved: links.length });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to delete relation");
  }
});

// ─── لینک‌ها ────────────────────────────────────────────────────────────────

router.get("/bots/:botId/relations/:relationId/links", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    const definition = await getEntity<RelationDef>(spreadsheetId, DEFS_TAB, req.params.relationId);
    if (!definition) throw new BotConfigError(404, "این رابطه پیدا نشد.", "relation_not_found");

    const links = await readLinks(spreadsheetId, req.params.relationId);
    const objects = await readObjects(spreadsheetId);
    const source = objects.find((o) => o.id === definition.source_object_id);
    const target = objects.find((o) => o.id === definition.target_object_id);

    /** رکوردهای یک آبجکت، به شکل سبکِ «شناسه + یک برچسب خواندنی». */
    async function options(schema: ObjectSchema | undefined) {
      if (!schema) return [];
      try {
        const rows = await listEntity<Record<string, unknown>>(spreadsheetId, recordTab(schema.slug));
        const labelField = schema.fields?.[0]?.name;
        return rows.map((r) => ({
          id: r.key,
          label: labelField ? String((r.value as any)?.[labelField] ?? r.key) : r.key,
        }));
      } catch {
        return [];
      }
    }

    res.json({
      relation: definition,
      links,
      sourceRecords: await options(source),
      targetRecords: await options(target),
    });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to list relation links");
  }
});

router.post("/bots/:botId/relations/:relationId/links", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await assertSheetsAuthoritative(LINKS_TAB);

    const definition = await getEntity<RelationDef>(spreadsheetId, DEFS_TAB, req.params.relationId);
    if (!definition) throw new BotConfigError(404, "این رابطه پیدا نشد.", "relation_not_found");

    const sourceRecordId = String(req.body?.source_record_id ?? "").trim();
    const targetRecordId = String(req.body?.target_record_id ?? "").trim();
    if (!sourceRecordId || !targetRecordId) throw bad("هر دو رکورد مبدأ و مقصد لازم‌اند.");

    const links = await readLinks(spreadsheetId, definition.id);
    if (links.some((l) => l.source_record_id === sourceRecordId && l.target_record_id === targetRecordId))
      throw new BotConfigError(409, "این دو رکورد از قبل به هم لینک شده‌اند.", "duplicate_link");

    // همان محدودیت‌های `_check_cardinality` موتور، برای همان انواع.
    if (definition.type === "one_to_one") {
      if (links.some((l) => l.source_record_id === sourceRecordId || l.target_record_id === targetRecordId))
        throw new BotConfigError(409, "این رابطه یک‌به‌یک است و هر رکورد فقط می‌تواند یک لینک داشته باشد.", "cardinality");
    } else if (definition.type === "one_to_many") {
      if (links.some((l) => l.target_record_id === targetRecordId))
        throw new BotConfigError(409, "در رابطه‌ی یک‌به‌چند، هر رکورد مقصد فقط می‌تواند به یک مبدأ وصل باشد.", "cardinality");
    }
    if (definition.type === "parent_child" && sourceRecordId === targetRecordId)
      throw new BotConfigError(409, "یک رکورد نمی‌تواند والد خودش باشد.", "cycle");

    const link: RelationLink = {
      id: newUuid(),
      relation_def_id: definition.id,
      source_record_id: sourceRecordId,
      target_record_id: targetRecordId,
      created_by: String(req.userId),
      created_at: nowIso(),
    };

    await putEntity(spreadsheetId, LINKS_TAB, link.id, link);
    res.status(201).json({ link });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to create relation link");
  }
});

router.delete("/bots/:botId/relations/:relationId/links/:linkId", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await assertSheetsAuthoritative(LINKS_TAB);
    const removed = await removeEntity(spreadsheetId, LINKS_TAB, req.params.linkId);
    if (!removed) throw new BotConfigError(404, "این لینک پیدا نشد.", "link_not_found");
    res.json({ deleted: req.params.linkId });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to delete relation link");
  }
});

export default router;
