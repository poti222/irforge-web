/**
 * lib/addressStore.ts — IRFORGE_PROMPT_V3 Phase 18
 * ─────────────────────────────────────────────────────────────────────────────
 * Website-side data layer for the new `address` plugin's `addresses` tab —
 * the TypeScript sibling of `plugins/address/domain.py`. A dedicated store
 * (not the generic `pluginCollections.ts` system) because the editor needs
 * a map picker for latitude/longitude that the generic field types
 * (text/number/boolean/select/textarea/datetime/readonly) don't cover.
 *
 * Coordinates are rounded to 5 decimal places on every write — about a
 * metre of precision, more than any business needs — mirroring the same
 * rounding the bot itself applies when it receives a location
 * (`plugins/address/domain.py`'s own note on this).
 */
import {
  getEntity, putEntity, listEntity, removeEntity, assertSheetsAuthoritative, BotConfigError,
} from "./botConfig.js";
import type { PanelButton, PanelMediaItem } from "./botTypes.js";
import { validateButtons } from "./buttonValidation.js";
// لایوباگ ۲۰۲۶-۰۹-۲۳: «ویرایشی که توی سایت می‌کنم توی بات اصلاح نمی‌شه» —
// createAddress/updateAddress/deleteAddress هر سه بی‌قیدوشرط
// assertSheetsAuthoritative(ADDRESSES_TAB) صدا می‌زدند، که به محضِ
// روشن‌شدنِ پرچمِ cutoverِ «addresses» یک تننت با ۴۰۹ رد می‌شد — چون
// lib/businessPg.ts هنوز «addresses» را نمی‌شناخت. حالا که می‌شناسد،
// listEntity/putEntity/removeEntity خودشان برای تننتِ cutover‌شده به
// Postgres می‌روند و دیگر نیازی به این قفل نیست — دقیقاً همان اصلاحی که
// «forms»/«panels» قبلاً گرفتند (`routes/botForms.ts`ی همین حس را ببین).
// `setAddressConfig` جدا مانده: آن روی تبِ «bot_settings» می‌نویسد که هنوز
// در businessPg.ts ثبت نشده (دامنه‌ی این باگ فقط addresses بود، نه هر چیزی
// که آن تب را می‌نویسد)، پس قفلش عمداً دست‌نخورده ماند.
import { nowIso } from "./botTypes.js";
import { newRecordId } from "./pluginCollections.js";

const ADDRESSES_TAB = "addresses";

/**
 * IRFORGE_BOOKING_FORM_CONTACT_REFERRAL_PROMPT پیگیری — کاربر خواست یک
 * قابلیتِ رایگانِ جداگانه («contact_info» panel type) داخلِ همین پلاگینِ
 * پولیِ address ادغام شود: هر آدرس، علاوه بر عنوان/متن/عکس/پینِ نقشه/ساعتِ
 * کاری/پلاس‌کدِ موجود، یک لیستِ آزادِ موارد هم دارد — شماره‌هایِ اضافی،
 * ایمیل، لینک (واتساپ/تلگرام/سایت)، یا یادداشت. `kind === "link"` تنها
 * حالتی‌ست که مقدار به دکمه تبدیل می‌شود (باید https:// باشد) — همان قاعده‌ی
 * `plugins/address/handlers.py::_contact_entry_lines_and_buttons` سمتِ بات.
 */
export const CONTACT_ENTRY_KINDS = ["phone", "address", "email", "link", "text"] as const;
export type ContactEntryKind = (typeof CONTACT_ENTRY_KINDS)[number];
export type ContactEntry = { id: string; kind: ContactEntryKind; label: string; value: string };

export interface Address {
  id: string;
  /** تنها فیلدِ اجباری — برچسبِ داخلیِ ادمین برای شناساییِ رکورد (لیستِ
   * آدرس‌ها، انتخاب‌گرِ نوعِ پنل/دکمه). هرگز به کاربرِ نهایی فرستاده نمی‌شود
   * (`plugins/address/handlers.py::send_address`، سمتِ بات). */
  title: string;
  text?: string;
  latitude?: number | null;
  longitude?: number | null;
  photo_file_id?: string;
  /** میراث — فقط عکس، فقط برای رکوردهای قدیمی نگه داشته شده. نوشتن‌هایِ تازه
   * `media_items` را پر می‌کنند (لایوباگ ۲۰۲۶-۰۹-۲۳: «نمی‌شه چند تا عکس یا
   * ویدیو یا ... اضافه کرد»)؛ خواندن هنوز اینجا هم پشتیبانی می‌شود
   * (`withPhotoFallback` پایین). */
  photo_file_ids?: string[];
  /** عکس/ویدیو/صوت/فایل — دقیقاً همان شکلِ `Panel.settings.media_items`
   * (`PanelMediaItem`، `botTypes.ts`)، تا سایت و بات یک منبعِ حقیقتِ واحد
   * برایِ نوعِ مدیا داشته باشند. */
  media_items?: PanelMediaItem[];
  phone?: string;
  plus_code?: string;
  map_url?: string;
  hours_note?: string;
  is_default?: boolean;
  is_active?: boolean;
  /** دقیقاً همان شکلِ `Panel.buttons` — `ButtonBuilder.tsx`ی سایت بدونِ هیچ
   * تغییری اینجا هم استفاده می‌شود (لایوباگ ۲۰۲۶-۰۹-۲۳: «قابلیتِ دکمه‌زدن
   * مثلِ پنل‌ها رو نداره»). */
  buttons?: PanelButton[];
  contact_entries?: ContactEntry[];
  created_at?: string;
  updated_at?: string;
}

function round5(n: number): number {
  return Math.round(n * 1e5) / 1e5;
}

function bad(message: string, code?: string): BotConfigError {
  return new BotConfigError(400, message, code);
}

const MAX_PHOTOS = 10;

/** User report: "همه‌ی فیلدها اجباریه" — `title` تنها فیلدِ اجباری است، یک
 * برچسبِ داخلیِ ادمین برای شناساییِ رکورد که هرگز به کاربرِ نهایی فرستاده
 * نمی‌شود. ادمین می‌تواند آدرسی بسازد که فقط شماره‌تماس باشد، فقط متن، یا
 * فقط یک پینِ نقشه — هر فیلدِ دیگری کاملاً اختیاری است. عرض/طولِ جغرافیایی
 * یک‌جفتی هستند: یا هر دو ست می‌شوند یا (برای پاک‌کردنِ موقعیت) هر دو
 * صریحاً `null`. */
export function parseAddressInput(body: any, { partial }: { partial: boolean }): Partial<Address> {
  const out: Partial<Address> = {};

  if (!partial || body.title !== undefined) {
    const title = String(body.title ?? "").trim();
    if (!title) throw bad("عنوان آدرس نمی‌تواند خالی باشد.", "bad_title");
    out.title = title.slice(0, 120);
  }
  if (body.text !== undefined) out.text = String(body.text || "").trim().slice(0, 500);

  const touchesLocation = body.latitude !== undefined || body.longitude !== undefined;
  if (touchesLocation) {
    const latRaw = body.latitude, lngRaw = body.longitude;
    if (latRaw === null && lngRaw === null) {
      out.latitude = null;
      out.longitude = null;
    } else {
      const lat = Number(latRaw), lng = Number(lngRaw);
      if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw bad("عرض جغرافیایی نامعتبر است.", "bad_latitude");
      if (!Number.isFinite(lng) || lng < -180 || lng > 180) throw bad("طول جغرافیایی نامعتبر است.", "bad_longitude");
      out.latitude = round5(lat);
      out.longitude = round5(lng);
    }
  }

  if (body.photo_file_ids !== undefined) {
    if (!Array.isArray(body.photo_file_ids)) throw bad("فهرستِ عکس‌ها باید آرایه باشد.", "bad_photos");
    if (body.photo_file_ids.length > MAX_PHOTOS) throw bad(`حداکثر ${MAX_PHOTOS} عکس مجاز است.`, "bad_photos");
    out.photo_file_ids = body.photo_file_ids.map((v: unknown) => String(v || "").slice(0, 200)).filter(Boolean);
  }
  if (body.photo_file_id !== undefined) out.photo_file_id = String(body.photo_file_id || "").slice(0, 200);
  if (body.media_items !== undefined) out.media_items = parseMediaItems(body.media_items);
  if (body.buttons !== undefined) out.buttons = validateButtons(body.buttons);
  if (body.phone !== undefined) out.phone = String(body.phone || "").slice(0, 32);
  if (body.plus_code !== undefined) out.plus_code = String(body.plus_code || "").slice(0, 32);
  if (body.map_url !== undefined) out.map_url = String(body.map_url || "").slice(0, 500);
  if (body.hours_note !== undefined) out.hours_note = String(body.hours_note || "").slice(0, 300);
  if (body.is_active !== undefined) out.is_active = Boolean(body.is_active);
  if (body.is_default !== undefined) out.is_default = Boolean(body.is_default);
  if (body.contact_entries !== undefined) out.contact_entries = parseContactEntries(body.contact_entries);

  return out;
}

/** آینه‌ی دقیقِ `routes/botPanels.ts`ی اعتبارسنجیِ `settings.media_items` —
 * همان محدودیتِ ۱۰تاییِ MAX_PHOTOسِ قدیمی هم برایِ اینجا نگه داشته شد. */
function parseMediaItems(value: unknown): PanelMediaItem[] {
  if (!Array.isArray(value)) throw bad("فهرستِ مدیا باید آرایه باشد.", "bad_media");
  if (value.length > MAX_PHOTOS) throw bad(`حداکثر ${MAX_PHOTOS} آیتمِ مدیا مجاز است.`, "bad_media");
  return value.map((raw: any, i: number) => {
    if (!raw || typeof raw !== "object") throw bad(`آیتمِ مدیایِ شماره ${i + 1} معتبر نیست.`, "bad_media");
    const itemType = String(raw.type ?? "");
    if (!["photo", "video", "audio", "document"].includes(itemType))
      throw bad(`نوعِ آیتمِ مدیایِ شماره ${i + 1} معتبر نیست.`, "bad_media");
    const fileId = String(raw.file_id ?? "").trim();
    if (!fileId) throw bad(`آیتمِ مدیایِ شماره ${i + 1} file_id ندارد.`, "bad_media");
    return { type: itemType as PanelMediaItem["type"], file_id: fileId };
  });
}

const MAX_CONTACT_ENTRIES = 20;

/** آینه‌ی دقیقِ `routes/botPanels.ts::validateContactEntries` که برای نوعِ
 * پنلِ core `contact_info` نوشته شده بود — همان قاعده، حالا اینجا. */
function parseContactEntries(value: unknown): ContactEntry[] {
  if (!Array.isArray(value)) throw bad("فهرستِ موارد باید آرایه باشد.", "bad_contact_entries");
  if (value.length > MAX_CONTACT_ENTRIES) throw bad(`حداکثر ${MAX_CONTACT_ENTRIES} مورد مجاز است.`, "bad_contact_entries");
  return value.map((raw: any, i: number) => {
    if (!raw || typeof raw !== "object") throw bad(`موردِ شماره ${i + 1} معتبر نیست.`, "bad_contact_entries");
    const kind = String(raw.kind ?? "text");
    if (!(CONTACT_ENTRY_KINDS as readonly string[]).includes(kind))
      throw bad(`نوعِ موردِ شماره ${i + 1} معتبر نیست.`, "bad_contact_entries");
    const label = String(raw.label ?? "").trim();
    if (!label) throw bad(`برچسبِ موردِ شماره ${i + 1} خالی است.`, "bad_contact_entries");
    if (label.length > 80) throw bad(`برچسبِ موردِ شماره ${i + 1} بیش از ۸۰ کاراکتر است.`, "bad_contact_entries");
    const entryValue = String(raw.value ?? "").trim();
    if (!entryValue) throw bad(`مقدارِ موردِ «${label}» خالی است.`, "bad_contact_entries");
    if (entryValue.length > 300) throw bad(`مقدارِ موردِ «${label}» بیش از ۳۰۰ کاراکتر است.`, "bad_contact_entries");
    if (kind === "link" && !/^https:\/\//i.test(entryValue))
      throw bad(`لینکِ موردِ «${label}» باید با https:// شروع شود — برایِ شماره‌تلفن نوعِ «شماره تماس» را انتخاب کنید.`, "bad_contact_entries");
    return { id: String(raw.id ?? `ce${i + 1}`), kind: kind as ContactEntryKind, label, value: entryValue };
  });
}

/**
 * رکوردهای قدیمی هنوز `media_items` ندارند — یا فقط `photo_file_ids`ی
 * چندعکسیِ قبلی دارند، یا حتی قدیمی‌تر فقط `photo_file_id` تکی. هر دو حالت
 * به همان شکلی که `plugins/address/domain.py::media_items_of` سمتِ بات
 * می‌خواند بازسازی می‌شوند — همان منبعِ حقیقتِ واحد، همان اولویت
 * (media_items > photo_file_ids > photo_file_id) — بدونِ نیازِ مهاجرتِ دیتا.
 */
function withMediaFallback(addr: Address): Address {
  const withPhotos = addr.photo_file_ids && addr.photo_file_ids.length > 0
    ? addr
    : addr.photo_file_id ? { ...addr, photo_file_ids: [addr.photo_file_id] } : addr;
  if (withPhotos.media_items && withPhotos.media_items.length > 0) return withPhotos;
  const legacyIds = withPhotos.photo_file_ids ?? [];
  if (legacyIds.length === 0) return withPhotos;
  return { ...withPhotos, media_items: legacyIds.map((file_id) => ({ type: "photo" as const, file_id })) };
}

export async function listAddresses(spreadsheetId: string): Promise<Address[]> {
  const rows = await listEntity<Address>(spreadsheetId, ADDRESSES_TAB);
  return rows
    .filter((r) => r.value && typeof r.value === "object")
    .map((r) => withMediaFallback({ ...(r.value as Address), id: r.key }))
    .sort((a, b) => String(a.title || "").localeCompare(String(b.title || "")));
}

export async function getAddress(spreadsheetId: string, id: string): Promise<Address | null> {
  const value = await getEntity<Address>(spreadsheetId, ADDRESSES_TAB, id);
  return value ? withMediaFallback({ ...value, id }) : null;
}

/** یک آدرسِ پیش‌فرض بیشتر معنا ندارد — ست‌کردن یکی، بقیه را خودکار خاموش می‌کند. */
async function clearOtherDefaults(spreadsheetId: string, exceptId: string): Promise<void> {
  const all = await listAddresses(spreadsheetId);
  for (const addr of all) {
    if (addr.id !== exceptId && addr.is_default) {
      await putEntity(spreadsheetId, ADDRESSES_TAB, addr.id, { ...addr, is_default: false, updated_at: nowIso() });
    }
  }
}

export async function createAddress(spreadsheetId: string, body: any): Promise<Address> {
  const parsed = parseAddressInput(body, { partial: false });
  const id = newRecordId("addr");
  const record: Address = {
    id,
    title: parsed.title!,
    text: parsed.text ?? "",
    latitude: parsed.latitude ?? null,
    longitude: parsed.longitude ?? null,
    photo_file_id: parsed.photo_file_id ?? "",
    photo_file_ids: parsed.photo_file_ids ?? [],
    media_items: parsed.media_items ?? [],
    buttons: parsed.buttons ?? [],
    phone: parsed.phone ?? "",
    plus_code: parsed.plus_code ?? "",
    map_url: parsed.map_url ?? "",
    hours_note: parsed.hours_note ?? "",
    is_active: parsed.is_active ?? true,
    is_default: parsed.is_default ?? false,
    contact_entries: parsed.contact_entries ?? [],
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  await putEntity(spreadsheetId, ADDRESSES_TAB, id, record);
  if (record.is_default) await clearOtherDefaults(spreadsheetId, id);
  return record;
}

export async function updateAddress(spreadsheetId: string, id: string, body: any): Promise<Address> {
  const existing = await getAddress(spreadsheetId, id);
  if (!existing) throw new BotConfigError(404, "این آدرس پیدا نشد.", "address_not_found");

  const parsed = parseAddressInput(body, { partial: true });
  const next: Address = { ...existing, ...parsed, id, updated_at: nowIso() };
  await putEntity(spreadsheetId, ADDRESSES_TAB, id, next);
  if (next.is_default) await clearOtherDefaults(spreadsheetId, id);
  return next;
}

export async function deleteAddress(spreadsheetId: string, id: string): Promise<boolean> {
  return removeEntity(spreadsheetId, ADDRESSES_TAB, id);
}

// ── تنظیمِ ارائه‌دهنده‌ی نقشه ─────────────────────────────────────────────
//
// یک ردیفِ اختصاصی (`address_cfg`) روی همان تبِ `bot_settings` که بات خودش
// با `settings_db.read()["address_cfg"]` می‌خواند — همان قراردادِ
// `payment_cfg`/`referral_cfg`ی از قبل موجود در بات، نه یک تبِ تازه. چون
// نوشتن اینجا هم از همان `putEntity` (upsert تک‌کلیدی) عبور می‌کند، هیچ ردیفِ
// دیگه‌ی این تب (مثل `reply_keyboard`) دست‌نخورده می‌ماند.

const SETTINGS_TAB = "bot_settings";
const ADDRESS_CFG_KEY = "address_cfg";

export const MAP_PROVIDERS = ["google", "neshan", "balad"] as const;
export type MapProvider = (typeof MAP_PROVIDERS)[number];

export interface AddressConfig {
  map_provider: MapProvider;
}

export async function getAddressConfig(spreadsheetId: string): Promise<AddressConfig> {
  const raw = await getEntity<Partial<AddressConfig>>(spreadsheetId, SETTINGS_TAB, ADDRESS_CFG_KEY);
  const provider = raw?.map_provider;
  return { map_provider: (MAP_PROVIDERS as readonly string[]).includes(provider ?? "") ? (provider as MapProvider) : "google" };
}

export async function setAddressConfig(spreadsheetId: string, mapProvider: string): Promise<AddressConfig> {
  if (!(MAP_PROVIDERS as readonly string[]).includes(mapProvider)) {
    throw new BotConfigError(400, "این ارائه‌دهنده‌ی نقشه پشتیبانی نمی‌شود.", "bad_provider");
  }
  await assertSheetsAuthoritative(SETTINGS_TAB);
  const cfg: AddressConfig = { map_provider: mapProvider as MapProvider };
  await putEntity(spreadsheetId, SETTINGS_TAB, ADDRESS_CFG_KEY, cfg);
  return cfg;
}
