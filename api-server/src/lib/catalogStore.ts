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
import {
  nowIso, newButton, normalizeButtonLayout, BUTTON_STYLES, MAX_BUTTONS_PER_ROW, type PanelButton,
} from "./botTypes.js";
import { newRecordId } from "./pluginCollections.js";
import { sanitizeTelegramHtml } from "./catalogHtml.js";

const CATEGORIES_TAB = "catalog_categories";
const ITEMS_TAB = "catalog_items";
const OPTIONS_TAB = "catalog_item_options";

export const STATUS_ACTIVE = "active";
export const STATUS_DRAFT = "draft";
export const STATUS_ARCHIVED = "archived";
export const VALID_STATUSES = [STATUS_ACTIVE, STATUS_DRAFT, STATUS_ARCHIVED] as const;

export const FULFILLMENT_TYPES = ["manual", "template", "file", "api", "webhook", "wallet_credit", "pool"] as const;

/**
 * IRFORGE_CATALOG_RICH_EDITOR_PROMPT Part B — mirrors
 * `plugins/catalog/domain.py::MEDIA_TYPES` field-for-field: both repos
 * write into the exact same `catalog_items.media` Sheet field, so the
 * shape (and the type strings) must match exactly for interop.
 */
export const MEDIA_TYPES = ["photo", "video", "animation", "document"] as const;

export interface CatalogMedia {
  type: (typeof MEDIA_TYPES)[number];
  file_id: string;
  caption: string;
}

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
  /** Legacy single-image field — kept for back-compat; `media` is the current one. */
  image_file_id: string;
  /** IRFORGE_CATALOG_RICH_EDITOR_PROMPT Part B — multi-media (photo/video/animation/document). */
  media: CatalogMedia[];
  /** Telegram-HTML-formatted description, sanitized on every write (see sanitizeTelegramHtml()). Empty = fall back to plain `description`, same as delivery.py's own `_resolve_body_html()`. */
  body_html: string;
  /**
   * IRFORGE_FULFILLMENT_FORMS_BUTTONS_PROMPT Phase B4 — mirrors
   * `plugins/catalog/domain.py`'s own `buttons` field (irforge-app), which
   * already exists there but was never wired up on this side. Independent
   * of `fulfillment_type`: these are the product's own generic call-to-action
   * buttons, sent alongside `media`/`body_html` every time the buyer gets
   * the product's content (see `send_catalog_item_to_buyer`). Deliberately
   * the exact same `PanelButton` shape panels already use (`action`/`value`/
   * `style`/`row`/`col`/`row_start`) so `ButtonBuilder.tsx` and
   * `buttonsToRows`/`rowsToButtons` work unmodified — restricted at write
   * time (see `validateProductButtons` below) to `url`/`panel`/`mini_app`,
   * since a product has no destination for the other core/plugin actions.
   */
  buttons: PanelButton[];
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

/**
 * `rawMedia` is the caller's un-coerced input (or `undefined` if the field
 * wasn't sent at all) — checked separately from `data.media` because
 * `parseMediaInput()` always returns an array (its job is best-effort shape
 * coercion, not validation), so validating `data.media` itself can never
 * see a non-array input. Mirrors `plugins/catalog/domain.py::validate_item_data`,
 * which validates the raw `data.get("media")` directly for the same reason.
 */
function validateItemFields(data: Partial<CatalogItem>, rawMedia?: unknown): string[] {
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

  if (rawMedia !== undefined) {
    if (!Array.isArray(rawMedia)) errors.push("رسانه‌ها باید یک لیست باشند.");
    else {
      for (const m of rawMedia) {
        if (!m || typeof m !== "object" || !String((m as CatalogMedia).file_id || "").trim()) {
          errors.push("هر آیتمِ رسانه باید file_id داشته باشد.");
          break;
        }
        if (!(MEDIA_TYPES as readonly string[]).includes((m as CatalogMedia).type)) {
          errors.push(`نوعِ رسانه باید یکی از ${MEDIA_TYPES.join("/")} باشد.`);
          break;
        }
      }
    }
  }
  return errors;
}

/**
 * IRFORGE_FULFILLMENT_FORMS_BUTTONS_PROMPT Phase B4 — a product's own
 * generic buttons. Same shape/normalization as a panel's buttons
 * (`botPanels.ts::validateButtons`), but the action whitelist is narrower:
 * a product has no destination for `form`/`sell` or any plugin action,
 * only `url`/`panel`/`mini_app` (the ButtonBuilder UI is restricted to the
 * same three, but this is the actual enforcement point).
 */
const PRODUCT_BUTTON_ACTIONS = ["url", "panel", "mini_app"] as const;

function validateProductButtons(value: unknown): PanelButton[] {
  if (!Array.isArray(value)) throw bad("فهرست دکمه‌ها باید آرایه باشد.", "bad_buttons");
  if (value.length > 20) throw bad("حداکثر ۲۰ دکمه برای یک محصول مجاز است.", "bad_buttons");

  const buttons = value.map((raw: any, i: number) => {
    if (!raw || typeof raw !== "object") throw bad(`دکمه‌ی شماره ${i + 1} معتبر نیست.`, "bad_buttons");
    const label = String(raw.label ?? "").trim();
    if (!label) throw bad(`متنِ دکمه‌ی شماره ${i + 1} خالی است.`, "bad_buttons");
    if (label.length > 64) throw bad(`متنِ دکمه‌ی «${label.slice(0, 20)}…» بیش از ۶۴ کاراکتر است.`, "bad_buttons");

    const action = String(raw.action ?? "").trim();
    if (!(PRODUCT_BUTTON_ACTIONS as readonly string[]).includes(action))
      throw bad(`اکشنِ دکمه‌ی «${label}» باید یکی از ${PRODUCT_BUTTON_ACTIONS.join("/")} باشد.`, "bad_buttons");

    const rawValue = String(raw.value ?? "");
    if ((action === "url" || action === "mini_app") && rawValue && !/^https:\/\//i.test(rawValue))
      throw bad(`آدرسِ دکمه‌ی «${label}» باید با https:// شروع شود.`, "bad_buttons");

    const style = String(raw.style ?? "");
    if (style && !(BUTTON_STYLES as readonly string[]).includes(style))
      throw bad(`استایلِ دکمه‌ی «${label}» معتبر نیست.`, "bad_buttons");

    return newButton({
      label,
      action,
      value: rawValue,
      row: Number(raw.row ?? 0),
      col: Number(raw.col ?? 0),
      row_start: raw.row_start === undefined ? undefined : Boolean(raw.row_start),
      style,
    });
  });

  const normalized = normalizeButtonLayout(buttons);
  const perRow = new Map<number, number>();
  for (const b of normalized) perRow.set(b.row, (perRow.get(b.row) ?? 0) + 1);
  for (const [row, count] of perRow) {
    if (count > MAX_BUTTONS_PER_ROW)
      throw bad(`ردیفِ ${row + 1} بیش از ${MAX_BUTTONS_PER_ROW} دکمه دارد؛ تلگرام آن را درست نشان نمی‌دهد.`, "bad_buttons");
  }
  return normalized;
}

/** Best-effort shape coercion — actual type/file_id validation happens in validateItemFields() so the error message is a proper 400, not a thrown TypeError. */
function parseMediaInput(raw: any): CatalogMedia[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((m) => ({
    type: String(m?.type ?? "photo") as CatalogMedia["type"],
    file_id: String(m?.file_id ?? "").trim(),
    caption: String(m?.caption ?? ""),
  }));
}

/**
 * یک آیتمِ قدیمی که فقط image_file_id داشت (media خالی) باید همچنان یک
 * تصویر در ویرایشگرِ media نشان دهد — دقیقاً همان fallbackِ
 * `plugins/catalog/domain.py::_normalize_item()` سمتِ بات، اینجا هم روی
 * خواندن اعمال می‌شود تا ادمین چیزِ ازدست‌رفته‌ای نبیند.
 */
function normalizeItem(item: CatalogItem): CatalogItem {
  const bodyHtml = item.body_html ?? "";
  const buttons = item.buttons ?? [];
  if ((item.media?.length ?? 0) > 0) return { ...item, body_html: bodyHtml, buttons };
  if (!item.image_file_id) return { ...item, media: item.media ?? [], body_html: bodyHtml, buttons };
  return { ...item, media: [{ type: "photo", file_id: item.image_file_id, caption: "" }], body_html: bodyHtml, buttons };
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
    media: "media" in body ? parseMediaInput(body.media) : (base.media ?? []),
    // هرگز HTML خام از کلاینت ذخیره نمی‌شود — دقیقاً همان‌جایی که
    // plugins/catalog/domain.py هم روی نوشتن sanitize می‌کند، اینجا هم قبل
    // از رسیدن به Sheet.
    body_html: "body_html" in body ? sanitizeTelegramHtml(String(body.body_html ?? "")) : (base.body_html ?? ""),
    buttons: "buttons" in body ? validateProductButtons(body.buttons) : (base.buttons ?? []),
    // fulfillment config لایه‌ی جدا دارد (setFulfillmentConfig) تا یک ویرایشِ
    // فیلدهای اصلیِ کالا metadata.fulfillment را بی‌خبر پاک نکند.
    metadata: base.metadata ?? {},
  };
  // media جایگزینِ image_file_id شد؛ ولی هر کدی که هنوز مستقیم
  // image_file_id می‌خواند (مثلاً یک integration قدیمی) باید همچنان چیزِ
  // معناداری ببیند — همیشه از رویِ اولین تصویرِ media مشتق می‌شود، نه یک
  // فیلدِ جداگانه که می‌تواند از media عقب بیفتد.
  if ("media" in body) {
    const firstPhoto = data.media!.find((m) => m.type === "photo");
    data.image_file_id = firstPhoto?.file_id ?? data.image_file_id ?? "";
  }
  if (!(FULFILLMENT_TYPES as readonly string[]).includes(data.fulfillment_type as string))
    throw bad(`نوع تحویلِ «${data.fulfillment_type}» پشتیبانی نمی‌شود.`, "bad_fulfillment_type");
  const errors = validateItemFields(data, "media" in body ? body.media : undefined);
  if (errors.length) throw bad(errors.join(" "));
  return data as Omit<CatalogItem, "id" | "created_at" | "updated_at">;
}

export async function listItems(spreadsheetId: string, opts: { includeArchived?: boolean } = {}): Promise<CatalogItem[]> {
  const rows = await listEntity<CatalogItem>(spreadsheetId, ITEMS_TAB);
  let items = rows.filter((r) => r.value && typeof r.value === "object").map((r) => normalizeItem({ ...(r.value as CatalogItem), id: r.key }));
  if (!opts.includeArchived) items = items.filter((i) => i.status !== STATUS_ARCHIVED);
  return items.sort((a, b) => (a.name || "").toLowerCase().localeCompare((b.name || "").toLowerCase()));
}

export async function getItem(spreadsheetId: string, id: string): Promise<CatalogItem | null> {
  const row = await getEntity<CatalogItem>(spreadsheetId, ITEMS_TAB, id);
  return row ? normalizeItem({ ...row, id }) : null;
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

// ─── fulfillment config (metadata.fulfillment) ─────────────────────────────
//
// IRFORGE_FULFILLMENT_FORMS_BUTTONS_PROMPT Phase B3 — this used to accept any
// object at all (a raw JSON textarea on the frontend, unchecked here). Now
// each `fulfillment_type` gets its own shape check, mirroring exactly what
// each executor in `plugins/catalog/fulfillment.py` (irforge-app) actually
// reads out of `config` — a value this validator lets through but the bot
// doesn't understand would just silently no-op there instead of failing
// loudly here. `manual` and `pool` are deliberately untouched: `manual`'s
// executor never reads `config` at all (Phase A1), and `pool`'s real
// configuration lives in `metadata['pool']`, not here — this endpoint is a
// no-op JSON bucket for it either way (see `fulfillmentHelpPool` on the
// frontend, which says so).

const FILE_KINDS = ["document", "photo", "video", "audio"] as const;
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function validateConfigUrl(value: unknown, label: string): string {
  const url = String(value ?? "").trim();
  if (!url) throw bad(`${label} اجباری است.`, "bad_fulfillment_config");
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("bad protocol");
  } catch {
    throw bad(`${label} یک آدرسِ معتبر نیست.`, "bad_fulfillment_config");
  }
  return url;
}

function validateConfigHeaders(value: unknown): void {
  if (value === undefined) return;
  if (!isPlainObject(value)) throw bad("هدرها باید یک آبجکت باشند.", "bad_fulfillment_config");
  for (const v of Object.values(value)) {
    if (typeof v !== "string") throw bad("مقدارِ هر هدر باید متن باشد.", "bad_fulfillment_config");
  }
}

function validateConfigPayload(value: unknown): void {
  if (value === undefined) return;
  if (!isPlainObject(value)) throw bad("بدنه (payload) باید یک آبجکت باشد.", "bad_fulfillment_config");
}

function validateConfigTimeout(value: unknown): void {
  if (value === undefined) return;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw bad("مهلتِ زمانی باید عددی بزرگ‌تر از صفر باشد.", "bad_fulfillment_config");
}

/** هر تایپ فقط شکلِ خودش را چک می‌کند؛ کلیدهای اضافیِ ناشناخته دست‌نخورده رد می‌شوند. */
function validateFulfillmentConfig(fulfillmentType: string, config: Record<string, unknown>): Record<string, unknown> {
  switch (fulfillmentType) {
    case "template": {
      const raw = String(config.template ?? "").trim();
      if (!raw) throw bad("متنِ پیام برایِ نوعِ «متن» اجباری است.", "bad_fulfillment_config");
      // `_exec_template` این متن را با parse_mode=HTML پیشِ‌فرضِ بات می‌فرستد
      // (`_dm` هیچ parse_mode صریحی نمی‌دهد) — دقیقاً همان دلیلی که
      // body_html محصول قبل از ذخیره sanitize می‌شود. جای‌گذاری‌های
      // {buyer_name}/{order_id}/... متنِ ساده‌اند، پس دست‌نخورده رد می‌شوند.
      return { ...config, template: sanitizeTelegramHtml(raw) };
    }
    case "file": {
      const fileId = String(config.file_id ?? "").trim();
      if (!fileId) throw bad("فایل برایِ نوعِ «فایل» اجباری است.", "bad_fulfillment_config");
      const fileKind = String(config.file_kind ?? "document");
      if (!(FILE_KINDS as readonly string[]).includes(fileKind))
        throw bad(`نوعِ فایل باید یکی از ${FILE_KINDS.join("/")} باشد.`, "bad_fulfillment_config");
      return { ...config, file_id: fileId, file_kind: fileKind };
    }
    case "api": {
      const url = validateConfigUrl(config.url, "آدرسِ API");
      const method = String(config.method ?? "POST").toUpperCase();
      if (!(HTTP_METHODS as readonly string[]).includes(method))
        throw bad(`متد باید یکی از ${HTTP_METHODS.join("/")} باشد.`, "bad_fulfillment_config");
      validateConfigHeaders(config.headers);
      validateConfigPayload(config.payload);
      validateConfigTimeout(config.timeout);
      return { ...config, url, method };
    }
    case "webhook": {
      const url = validateConfigUrl(config.url, "آدرسِ وبهوک");
      validateConfigHeaders(config.headers);
      validateConfigPayload(config.payload);
      validateConfigTimeout(config.timeout);
      return { ...config, url };
    }
    case "wallet_credit": {
      const amount = Number(config.amount_per_unit);
      if (!Number.isFinite(amount) || amount <= 0)
        throw bad("مبلغِ شارژ باید عددی بزرگ‌تر از صفر باشد.", "bad_fulfillment_config");
      return { ...config, amount_per_unit: amount };
    }
    case "manual":
    case "pool":
    default:
      return config;
  }
}

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
  const validated = validateFulfillmentConfig(existing.fulfillment_type, (config ?? {}) as Record<string, unknown>);
  const metadata = { ...(existing.metadata || {}), fulfillment: validated };
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
