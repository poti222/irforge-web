/**
 * lib/gameServerStore.ts — IRFORGE_CS2_RCON_PLUGIN_PROMPT Phase 3
 * ─────────────────────────────────────────────────────────────────────────────
 * Website-side data layer for the `gameserver_cs2` plugin's `servers` list —
 * the TypeScript sibling of `plugins/gameserver_cs2/domain.py`. Reads/writes
 * the exact same Sheets tab the bot's own `RecordStore` uses
 * (`gameserver_cs2_servers`, id prefix `gs`), so a server added from the
 * website is immediately usable from the bot's admin menu and vice versa.
 *
 * rcon_password is write-only, mirroring `domain.py::_without_password()`
 * exactly: the `GameServer` type below simply has no password field at all,
 * so there is no accidental code path that could leak it back to the
 * frontend. Encryption reuses `tokenCrypto.ts::encryptToken` — the same
 * AES-256-GCM scheme, same `BOT_TOKEN_ENCRYPTION_KEY`, same
 * `iv:tag:ciphertext` hex format as `registry_token_crypto.py` on the bot
 * side (either side can decrypt what the other encrypted). This module only
 * ever calls `encryptToken()` — never `decryptToken()` — since the raw
 * password is never read back once stored.
 */
import {
  getEntity, putEntity, listEntity, removeEntity, assertSheetsAuthoritative, BotConfigError,
} from "./botConfig.js";
import { nowIso } from "./botTypes.js";
import { newRecordId } from "./pluginCollections.js";
import { encryptToken } from "./tokenCrypto.js";

const SERVERS_TAB = "gameserver_cs2_servers";

export interface GameServer {
  id: string;
  label: string;
  host: string;
  port: number;
  /** True once an RCON password has been set. The raw value is never
   * exposed here — see the module docstring. */
  hasRconPassword: boolean;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

/** Shape actually stored on the Sheets row — includes the encrypted
 * password, which is why this type must never be returned from a route. */
interface StoredGameServer {
  id: string;
  label: string;
  host: string;
  port: number;
  rcon_password?: string;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

function bad(message: string, code?: string): BotConfigError {
  return new BotConfigError(400, message, code);
}

function toPublic(row: StoredGameServer): GameServer {
  return {
    id: row.id,
    label: row.label,
    host: row.host,
    port: row.port,
    hasRconPassword: Boolean(row.rcon_password),
    is_active: row.is_active ?? true,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Mirrors `domain.py`'s `_validate_label`/`_validate_host`/`_validate_port`/
 * `_validate_password` field-by-field, including the same limits, so a
 * record either side creates passes the other side's own validation too.
 * `rconPassword` is optional on a partial (update) parse -- omitted means
 * "leave the current password alone", not "clear it" (see updateServer). */
export function parseServerInput(
  body: any, { partial }: { partial: boolean },
): { label?: string; host?: string; port?: number; rconPassword?: string } {
  const out: { label?: string; host?: string; port?: number; rconPassword?: string } = {};

  if (!partial || body.label !== undefined) {
    const label = String(body.label ?? "").trim();
    if (!label) throw bad("نامِ سرور نمی‌تواند خالی باشد.", "bad_label");
    if (label.length > 80) throw bad("نامِ سرور حداکثر ۸۰ کاراکتر می‌تواند باشد.", "bad_label");
    out.label = label;
  }
  if (!partial || body.host !== undefined) {
    const host = String(body.host ?? "").trim();
    if (!host) throw bad("آدرسِ سرور نمی‌تواند خالی باشد.", "bad_host");
    if (host.length > 255) throw bad("آدرسِ سرور خیلی طولانی است.", "bad_host");
    out.host = host;
  }
  if (!partial || body.port !== undefined) {
    const port = Number(body.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw bad("پورت باید یک عددِ صحیح بینِ ۱ تا ۶۵۵۳۵ باشد.", "bad_port");
    }
    out.port = port;
  }
  // Only touch the password if the client actually sent a non-empty one --
  // an empty/omitted value on an update means "keep the current password",
  // never accidentally overwrite it with an empty string.
  if (body.rconPassword !== undefined && String(body.rconPassword).length > 0) {
    const password = String(body.rconPassword);
    if (password.length > 200) throw bad("رمزِ RCON خیلی طولانی است.", "bad_password");
    out.rconPassword = password;
  } else if (!partial) {
    throw bad("رمزِ RCON نمی‌تواند خالی باشد.", "bad_password");
  }

  return out;
}

export async function listServers(spreadsheetId: string): Promise<GameServer[]> {
  const rows = await listEntity<StoredGameServer>(spreadsheetId, SERVERS_TAB);
  return rows
    .filter((r) => r.value && typeof r.value === "object")
    .map((r) => toPublic({ ...(r.value as StoredGameServer), id: r.key }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

async function getStoredServer(spreadsheetId: string, id: string): Promise<StoredGameServer | null> {
  const value = await getEntity<StoredGameServer>(spreadsheetId, SERVERS_TAB, id);
  return value ? { ...value, id } : null;
}

export async function createServer(spreadsheetId: string, body: any): Promise<GameServer> {
  await assertSheetsAuthoritative(SERVERS_TAB);
  const parsed = parseServerInput(body, { partial: false });
  const id = newRecordId("gs");
  const record: StoredGameServer = {
    id,
    label: parsed.label!,
    host: parsed.host!,
    port: parsed.port!,
    rcon_password: encryptToken(parsed.rconPassword!),
    is_active: true,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  await putEntity(spreadsheetId, SERVERS_TAB, id, record);
  return toPublic(record);
}

export async function updateServer(spreadsheetId: string, id: string, body: any): Promise<GameServer> {
  await assertSheetsAuthoritative(SERVERS_TAB);
  const existing = await getStoredServer(spreadsheetId, id);
  if (!existing) throw new BotConfigError(404, "این سرور پیدا نشد.", "server_not_found");

  const parsed = parseServerInput(body, { partial: true });
  const next: StoredGameServer = {
    ...existing,
    ...(parsed.label !== undefined ? { label: parsed.label } : {}),
    ...(parsed.host !== undefined ? { host: parsed.host } : {}),
    ...(parsed.port !== undefined ? { port: parsed.port } : {}),
    ...(parsed.rconPassword !== undefined ? { rcon_password: encryptToken(parsed.rconPassword) } : {}),
    ...(body.is_active !== undefined ? { is_active: Boolean(body.is_active) } : {}),
    id,
    updated_at: nowIso(),
  };
  await putEntity(spreadsheetId, SERVERS_TAB, id, next);
  return toPublic(next);
}

export async function deleteServer(spreadsheetId: string, id: string): Promise<boolean> {
  await assertSheetsAuthoritative(SERVERS_TAB);
  return removeEntity(spreadsheetId, SERVERS_TAB, id);
}
