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
import { nowIso } from "./botTypes.js";
import { newRecordId } from "./pluginCollections.js";

const ADDRESSES_TAB = "addresses";

export interface Address {
  id: string;
  title: string;
  text: string;
  latitude: number;
  longitude: number;
  photo_file_id?: string;
  phone?: string;
  plus_code?: string;
  map_url?: string;
  hours_note?: string;
  is_default?: boolean;
  is_active?: boolean;
  created_at?: string;
  updated_at?: string;
}

function round5(n: number): number {
  return Math.round(n * 1e5) / 1e5;
}

function bad(message: string, code?: string): BotConfigError {
  return new BotConfigError(400, message, code);
}

/** Validates a create/update body into a clean partial `Address` — anything
 * malformed is a 400, not a silently-dropped field. */
export function parseAddressInput(body: any, { partial }: { partial: boolean }): Partial<Address> {
  const out: Partial<Address> = {};

  if (!partial || body.title !== undefined) {
    const title = String(body.title ?? "").trim();
    if (!title) throw bad("عنوان آدرس نمی‌تواند خالی باشد.", "bad_title");
    out.title = title.slice(0, 120);
  }
  if (!partial || body.text !== undefined) {
    const text = String(body.text ?? "").trim();
    if (!text) throw bad("متن آدرس نمی‌تواند خالی باشد.", "bad_text");
    out.text = text.slice(0, 500);
  }
  if (!partial || body.latitude !== undefined) {
    const lat = Number(body.latitude);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw bad("عرض جغرافیایی نامعتبر است.", "bad_latitude");
    out.latitude = round5(lat);
  }
  if (!partial || body.longitude !== undefined) {
    const lng = Number(body.longitude);
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) throw bad("طول جغرافیایی نامعتبر است.", "bad_longitude");
    out.longitude = round5(lng);
  }
  if (body.photo_file_id !== undefined) out.photo_file_id = String(body.photo_file_id || "").slice(0, 200);
  if (body.phone !== undefined) out.phone = String(body.phone || "").slice(0, 32);
  if (body.plus_code !== undefined) out.plus_code = String(body.plus_code || "").slice(0, 32);
  if (body.map_url !== undefined) out.map_url = String(body.map_url || "").slice(0, 500);
  if (body.hours_note !== undefined) out.hours_note = String(body.hours_note || "").slice(0, 300);
  if (body.is_active !== undefined) out.is_active = Boolean(body.is_active);
  if (body.is_default !== undefined) out.is_default = Boolean(body.is_default);

  return out;
}

export async function listAddresses(spreadsheetId: string): Promise<Address[]> {
  const rows = await listEntity<Address>(spreadsheetId, ADDRESSES_TAB);
  return rows
    .filter((r) => r.value && typeof r.value === "object")
    .map((r) => ({ ...(r.value as Address), id: r.key }))
    .sort((a, b) => String(a.title || "").localeCompare(String(b.title || "")));
}

export async function getAddress(spreadsheetId: string, id: string): Promise<Address | null> {
  const value = await getEntity<Address>(spreadsheetId, ADDRESSES_TAB, id);
  return value ? { ...value, id } : null;
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
  await assertSheetsAuthoritative(ADDRESSES_TAB);
  const parsed = parseAddressInput(body, { partial: false });
  const id = newRecordId("addr");
  const record: Address = {
    id,
    title: parsed.title!,
    text: parsed.text!,
    latitude: parsed.latitude!,
    longitude: parsed.longitude!,
    photo_file_id: parsed.photo_file_id ?? "",
    phone: parsed.phone ?? "",
    plus_code: parsed.plus_code ?? "",
    map_url: parsed.map_url ?? "",
    hours_note: parsed.hours_note ?? "",
    is_active: parsed.is_active ?? true,
    is_default: parsed.is_default ?? false,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  await putEntity(spreadsheetId, ADDRESSES_TAB, id, record);
  if (record.is_default) await clearOtherDefaults(spreadsheetId, id);
  return record;
}

export async function updateAddress(spreadsheetId: string, id: string, body: any): Promise<Address> {
  await assertSheetsAuthoritative(ADDRESSES_TAB);
  const existing = await getAddress(spreadsheetId, id);
  if (!existing) throw new BotConfigError(404, "این آدرس پیدا نشد.", "address_not_found");

  const parsed = parseAddressInput(body, { partial: true });
  const next: Address = { ...existing, ...parsed, id, updated_at: nowIso() };
  await putEntity(spreadsheetId, ADDRESSES_TAB, id, next);
  if (next.is_default) await clearOtherDefaults(spreadsheetId, id);
  return next;
}

export async function deleteAddress(spreadsheetId: string, id: string): Promise<boolean> {
  await assertSheetsAuthoritative(ADDRESSES_TAB);
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
