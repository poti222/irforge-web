/**
 * lib/catalogStore.ts — IRFORGE_PROMPT_V3 Phase 24
 * ─────────────────────────────────────────────────────────────────────────────
 * Website-side data layer for the `catalog` plugin, mirroring
 * `plugins/catalog/domain.py` field-for-field. Before this store, catalog had
 * **no admin surface anywhere** — not on the website, not even in the bot
 * itself (`plugins/catalog/handlers.py`'s own docstring: "no admin UI or
 * storefront yet"). An operator enabling "Catalog" got a working buy-flow
 * (`purchase.py`) and a fully-built fulfillment queue (`fulfillment.py`) with
 * nothing to ever populate a single item into either.
 *
 * A dedicated store rather than the generic `pluginCollections.ts` system,
 * for the same reasons booking/address/drip/crm/survey/giveaway all needed
 * one: three linked entities (category → item → option), a soft-delete
 * convention (archive, not remove — past orders still reference an item by
 * id), and a free-form nested `fulfillment` config object under
 * `item.metadata` that the generic field-list editor has no way to express.
 *
 * IDs use the site's own `newRecordId()` (12 hex chars) rather than the
 * bot's own shorter `item_<10 hex>` / `cat_<8 hex>` / `opt_<8 hex>` — both
 * are opaque unique strings and nothing anywhere parses their length, so
 * this is safe (same convention every other dedicated store already uses).
 */
import {
  getEntity, putEntity, listEntity, removeEntity, assertSheetsAuthoritative, BotConfigError,
} from "./botConfig.js";
import { nowIso } from "./botTypes.js";
import { newRecordId } from "./pluginCollections.js";

const CATEGORIES_TAB = "catalog_categories";
const ITEMS_TAB = "catalog_items";
const OPTIONS_TAB = "catalog_item_options";

export const STATUS_ACTIVE = "active";
export const STATUS_DRAFT = "draft";
export const STATUS_ARCHIVED = "archived";
export const VALID_STATUSES = [STATUS_ACTIVE, STATUS_DRAFT, STATUS_ARCHIVED] as const;

export const FULFILLMENT_TYPES = ["manual", "template", "file", "api", "webhook", "wallet_credit"] as const;

export interface Category {
  id: string;
  name: string;
  name_fa: string;
  parent_id: string;
  sort_order: number;
  is_active: boolean;
  created_by?: string;
  created_at?: string;
  updated_at?: string;
}

export interface CatalogItem {
  id: string;
  name: string;
  name_fa: string;
  description: string;
  category_id: string;
  price: number;
  currency: string;
  compare_at_price: number | null;
  item_type: string;
  fulfillment_type: string;
  track_stock: boolean;
  stock_qty: number;
  status: string;
  image_file_id: string;
  metadata: Record<string, unknown>;
  created_by?: string;
  created_at?: string;
  updated_at?: string;
}

export interface ItemOption {
  id: string;
  item_id: string;
  label: string;
  price: number;
  track_stock: boolean;
  stock_qty: number;
  is_active: boolean;
  sort_order: number;
  created_at?: string;
  updated_at?: string;
}

function bad(message: string, code?: string): BotConfigError {
  return new BotConfigError(400, message, code);
}

// ─── دسته‌بندی ───────────────────────────────────────────────────────────────

export async function listCategories(spreadsheetId: string): Promise<Category[]> {
  const rows = await listEntity<Category>(spreadsheetId, CATEGORIES_TAB);
  return rows
    .filter((r) => r.value && typeof r.value === "object")
    .map((r) => ({ ...(r.value as Category), id: r.key }))
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name));
}

export async function getCategory(spreadsheetId: string, id: string): Promise<Category | null> {
  const row = await getEntity<Category>(spreadsheetId, CATEGORIES_TAB, id);
  return row ? { ...row, id } : null;
}

function parseCategoryInput(body: any): Omit<Category, "id" | "created_at" | "updated_at"> {
  const name = String(body?.name ?? "").trim();
  if (!name) throw bad("نام دسته‌بندی اجباری است.");
  if (name.length > 200) throw bad("نام دسته‌بندی حداکثر ۲۰۰ کاراکتر می‌تواند باشد.");
  return {
    name,
    name_fa: String(body?.name_fa ?? "").trim() || name,
    parent_id: String(body?.parent_id ?? "").trim(),
    sort_order: Number.isFinite(Number(body?.sort_order)) ? Number(body.sort_order) : 0,
    is_active: body?.is_active !== false,
  };
}

export async function createCategory(spreadsheetId: string, body: any, createdBy: string): Promise<Category> {
  await assertSheetsAuthoritative(CATEGORIES_TAB);
  const id = newRecordId("cat");
  const category: Category = { id, ...parseCategoryInput(body), created_by: createdBy, created_at: nowIso(), updated_at: nowIso() };
  await putEntity(spreadsheetId, CATEGORIES_TAB, id, category);
  return category;
}

export async function updateCategory(spreadsheetId: string, id: string, body: any): Promise<Category> {
  await assertSheetsAuthoritative(CATEGORIES_TAB);
  const existing = await getCategory(spreadsheetId, id);
  if (!existing) throw new BotConfigError(404, "این دسته‌بندی پیدا نشد.", "category_not_found");
  const merged: Category = { ...existing, ...parseCategoryInput({ ...existing, ...body }), id, updated_at: nowIso() };
  await putEntity(spreadsheetId, CATEGORIES_TAB, id, merged);
  return merged;
}

/** فقط رکورد دسته حذف می‌شود؛ کالاهایی که به این id اشاره می‌کنند دست‌نخورده می‌مانند (بی‌دسته‌بندی نمایش داده می‌شوند). */
export async function deleteCategory(spreadsheetId: string, id: string): Promise<boolean> {
  await assertSheetsAuthoritative(CATEGORIES_TAB);
  return removeEntity(spreadsheetId, CATEGORIES_TAB, id);
}

// ─── کالا/سرویس ──────────────────────────────────────────────────────────────

function validateItemFields(data: Partial<CatalogItem>): string[] {
  const errors: string[] = [];
  const name = String(data.name ?? "").trim();
  if (!name) errors.push("نام کالا/سرویس اجباری است.");
  else if (name.length > 200) errors.push("نام کالا/سرویس حداکثر ۲۰۰ کاراکتر می‌تواند باشد.");

  const price = Number(data.price);
  if (!Number.isFinite(price) || price < 0) errors.push("قیمت باید عددی صفر یا بزرگ‌تر باشد.");

  if (data.compare_at_price !== null && data.compare_at_price !== undefined) {
    const cap = Number(data.compare_at_price);
    if (!Number.isFinite(cap) || cap < 0) errors.push("قیمت قبل از تخفیف نمی‌تواند منفی باشد.");
  }

  if (data.status && !(VALID_STATUSES as readonly string[]).includes(data.status))
    errors.push(`وضعیت باید یکی از ${VALID_STATUSES.join("/")} باشد.`);

  if (data.track_stock) {
    const qty = Number(data.stock_qty);
    if (!Number.isInteger(qty) || qty < 0) errors.push("موجودی انبار باید یک عدد صحیح صفر یا بزرگ‌تر باشد.");
  }
  return errors;
}

function parseItemInput(body: any, base: Partial<CatalogItem> = {}): Omit<CatalogItem, "id" | "created_at" | "updated_at"> {
  const data: Partial<CatalogItem> = {
    name: "name" in body ? String(body.name ?? "").trim() : base.name,
    name_fa: "name_fa" in body ? String(body.name_fa ?? "").trim() : base.name_fa,
    description: "description" in body ? String(body.description ?? "") : (base.description ?? ""),
    category_id: "category_id" in body ? String(body.category_id ?? "").trim() : (base.category_id ?? ""),
    price: "price" in body ? Number(body.price) : base.price,
    currency: "currency" in body ? String(body.currency ?? "IRT").trim() || "IRT" : (base.currency ?? "IRT"),
    compare_at_price: "compare_at_price" in body
      ? (body.compare_at_price === null || body.compare_at_price === "" ? null : Number(body.compare_at_price))
      : (base.compare_at_price ?? null),
    item_type: "item_type" in body ? String(body.item_type ?? "service").trim() || "service" : (base.item_type ?? "service"),
    fulfillment_type: "fulfillment_type" in body
      ? (String(body.fulfillment_type ?? "manual").trim() || "manual")
      : (base.fulfillment_type ?? "manual"),
    track_stock: "track_stock" in body ? Boolean(body.track_stock) : (base.track_stock ?? false),
    stock_qty: "stock_qty" in body ? Number(body.stock_qty) || 0 : (base.stock_qty ?? 0),
    status: "status" in body ? String(body.status ?? STATUS_ACTIVE) : (base.status ?? STATUS_ACTIVE),
    image_file_id: "image_file_id" in body ? String(body.image_file_id ?? "").trim() : (base.image_file_id ?? ""),
    // fulfillment config لایه‌ی جدا دارد (setFulfillmentConfig) تا یک ویرایشِ
    // فیلدهای اصلیِ کالا metadata.fulfillment را بی‌خبر پاک نکند.
    metadata: base.metadata ?? {},
  };
  if (!(FULFILLMENT_TYPES as readonly string[]).includes(data.fulfillment_type as string))
    throw bad(`نوع تحویلِ «${data.fulfillment_type}» پشتیبانی نمی‌شود.`, "bad_fulfillment_type");
  const errors = validateItemFields(data);
  if (errors.length) throw bad(errors.join(" "));
  return data as Omit<CatalogItem, "id" | "created_at" | "updated_at">;
}

export async function listItems(spreadsheetId: string, opts: { includeArchived?: boolean } = {}): Promise<CatalogItem[]> {
  const rows = await listEntity<CatalogItem>(spreadsheetId, ITEMS_TAB);
  let items = rows.filter((r) => r.value && typeof r.value === "object").map((r) => ({ ...(r.value as CatalogItem), id: r.key }));
  if (!opts.includeArchived) items = items.filter((i) => i.status !== STATUS_ARCHIVED);
  return items.sort((a, b) => (a.name || "").toLowerCase().localeCompare((b.name || "").toLowerCase()));
}

export async function getItem(spreadsheetId: string, id: string): Promise<CatalogItem | null> {
  const row = await getEntity<CatalogItem>(spreadsheetId, ITEMS_TAB, id);
  return row ? { ...row, id } : null;
}

export async function createItem(spreadsheetId: string, body: any, createdBy: string): Promise<CatalogItem> {
  await assertSheetsAuthoritative(ITEMS_TAB);
  if (body?.category_id) {
    const cat = await getCategory(spreadsheetId, String(body.category_id));
    if (!cat) throw bad("دسته‌بندی انتخاب‌شده یافت نشد.", "category_not_found");
  }
  const id = newRecordId("item");
  const item: CatalogItem = {
    id, ...parseItemInput(body), created_by: createdBy, created_at: nowIso(), updated_at: nowIso(),
  };
  await putEntity(spreadsheetId, ITEMS_TAB, id, item);
  return item;
}

export async function updateItem(spreadsheetId: string, id: string, body: any): Promise<CatalogItem> {
  await assertSheetsAuthoritative(ITEMS_TAB);
  const existing = await getItem(spreadsheetId, id);
  if (!existing) throw new BotConfigError(404, "این کالا/سرویس پیدا نشد.", "item_not_found");
  if ("category_id" in body && body.category_id) {
    const cat = await getCategory(spreadsheetId, String(body.category_id));
    if (!cat) throw bad("دسته‌بندی انتخاب‌شده یافت نشد.", "category_not_found");
  }
  const merged: CatalogItem = { ...existing, ...parseItemInput(body, existing), id, updated_at: nowIso() };
  await putEntity(spreadsheetId, ITEMS_TAB, id, merged);
  return merged;
}

/** پیش‌فرض soft-delete (status=archived) — سفارش‌های قدیمی که به این id اشاره می‌کنند هنوز resolve می‌شوند. */
export async function archiveItem(spreadsheetId: string, id: string): Promise<CatalogItem> {
  return updateItem(spreadsheetId, id, { status: STATUS_ARCHIVED });
}

export async function deleteItemHard(spreadsheetId: string, id: string): Promise<boolean> {
  await assertSheetsAuthoritative(ITEMS_TAB);
  return removeEntity(spreadsheetId, ITEMS_TAB, id);
}

// ─── fulfillment config (metadata.fulfillment، آزاد و بدون کلید اجباری) ────

export function getFulfillmentConfig(item: CatalogItem): Record<string, unknown> {
  const meta = (item.metadata || {}) as Record<string, unknown>;
  const cfg = meta.fulfillment;
  return cfg && typeof cfg === "object" ? (cfg as Record<string, unknown>) : {};
}

export async function setFulfillmentConfig(
  spreadsheetId: string,
  itemId: string,
  config: unknown,
): Promise<CatalogItem> {
  await assertSheetsAuthoritative(ITEMS_TAB);
  const existing = await getItem(spreadsheetId, itemId);
  if (!existing) throw new BotConfigError(404, "این کالا/سرویس پیدا نشد.", "item_not_found");
  if (config !== null && (typeof config !== "object" || Array.isArray(config)))
    throw bad("پیکربندیِ تحویل باید یک آبجکت باشد.", "bad_fulfillment_config");
  const metadata = { ...(existing.metadata || {}), fulfillment: config ?? {} };
  const merged: CatalogItem = { ...existing, metadata, updated_at: nowIso() };
  await putEntity(spreadsheetId, ITEMS_TAB, itemId, merged);
  return merged;
}

// ─── پلن/گزینه ───────────────────────────────────────────────────────────────

function validateOptionFields(data: Partial<ItemOption>): string[] {
  const errors: string[] = [];
  const label = String(data.label ?? "").trim();
  if (!label) errors.push("عنوان پلن/گزینه اجباری است.");
  else if (label.length > 100) errors.push("عنوان پلن/گزینه حداکثر ۱۰۰ کاراکتر می‌تواند باشد.");

  const price = Number(data.price);
  if (!Number.isFinite(price) || price < 0) errors.push("قیمت پلن باید عددی صفر یا بزرگ‌تر باشد.");

  if (data.track_stock) {
    const qty = Number(data.stock_qty);
    if (!Number.isInteger(qty) || qty < 0) errors.push("موجودی پلن باید یک عدد صحیح صفر یا بزرگ‌تر باشد.");
  }
  return errors;
}

function parseOptionInput(body: any, base: Partial<ItemOption> = {}): Omit<ItemOption, "id" | "item_id" | "created_at" | "updated_at"> {
  const data: Partial<ItemOption> = {
    label: "label" in body ? String(body.label ?? "").trim() : base.label,
    price: "price" in body ? Number(body.price) : base.price,
    track_stock: "track_stock" in body ? Boolean(body.track_stock) : (base.track_stock ?? false),
    stock_qty: "stock_qty" in body ? Number(body.stock_qty) || 0 : (base.stock_qty ?? 0),
    is_active: "is_active" in body ? body.is_active !== false : (base.is_active ?? true),
    sort_order: "sort_order" in body ? Number(body.sort_order) || 0 : (base.sort_order ?? 0),
  };
  const errors = validateOptionFields(data);
  if (errors.length) throw bad(errors.join(" "));
  return data as Omit<ItemOption, "id" | "item_id" | "created_at" | "updated_at">;
}

export async function listOptions(spreadsheetId: string, itemId: string, opts: { includeInactive?: boolean } = {}): Promise<ItemOption[]> {
  const rows = await listEntity<ItemOption>(spreadsheetId, OPTIONS_TAB);
  let options = rows
    .filter((r) => r.value && typeof r.value === "object" && (r.value as ItemOption).item_id === itemId)
    .map((r) => ({ ...(r.value as ItemOption), id: r.key }));
  if (!opts.includeInactive) options = options.filter((o) => o.is_active !== false);
  return options.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.label.localeCompare(b.label));
}

export async function getOption(spreadsheetId: string, id: string): Promise<ItemOption | null> {
  const row = await getEntity<ItemOption>(spreadsheetId, OPTIONS_TAB, id);
  return row ? { ...row, id } : null;
}

export async function createOption(spreadsheetId: string, itemId: string, body: any): Promise<ItemOption> {
  await assertSheetsAuthoritative(OPTIONS_TAB);
  const item = await getItem(spreadsheetId, itemId);
  if (!item) throw new BotConfigError(404, "کالا/سرویس یافت نشد.", "item_not_found");
  const id = newRecordId("opt");
  const option: ItemOption = { id, item_id: itemId, ...parseOptionInput(body), created_at: nowIso(), updated_at: nowIso() };
  await putEntity(spreadsheetId, OPTIONS_TAB, id, option);
  return option;
}

export async function updateOption(spreadsheetId: string, id: string, body: any): Promise<ItemOption> {
  await assertSheetsAuthoritative(OPTIONS_TAB);
  const existing = await getOption(spreadsheetId, id);
  if (!existing) throw new BotConfigError(404, "این پلن/گزینه پیدا نشد.", "option_not_found");
  const merged: ItemOption = { ...existing, ...parseOptionInput(body, existing), id, item_id: existing.item_id, updated_at: nowIso() };
  await putEntity(spreadsheetId, OPTIONS_TAB, id, merged);
  return merged;
}

/** پیش‌فرض soft-delete (is_active=false) — سفارش‌های قدیمی که در سبدشان به این id اشاره کرده‌اند هنوز resolve می‌شوند. */
export async function deactivateOption(spreadsheetId: string, id: string): Promise<ItemOption> {
  return updateOption(spreadsheetId, id, { is_active: false });
}

export async function deleteOptionHard(spreadsheetId: string, id: string): Promise<boolean> {
  await assertSheetsAuthoritative(OPTIONS_TAB);
  return removeEntity(spreadsheetId, OPTIONS_TAB, id);
}
