/**
 * botLanguageStore.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Per-bot language configuration, stored in the bot's Google Sheet so the
 * external bot runtime (the Railway worker) can read it. When Google Sheets
 * credentials are not configured (e.g. local dev / CI), it transparently falls
 * back to an in-memory map + a JSON file on disk, so the dashboard still works.
 *
 * Sheet location (documented for the runtime):
 *   SHEETS_DATA_ID → tab "bot_settings" → key = botId → value JSON:
 *     { "botId": "...", "language": { mode, primary, enabled[], promptOnStart } }
 */
import fs from "node:fs";
import path from "node:path";
import { readKV, syncBotSettingsUpsert } from "./sheetsSync.js";
import { logger } from "./logger.js";

export const SUPPORTED_LANGUAGES = ["en", "fa", "ar", "tr", "ru"] as const;
export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number];

export interface BotLanguageConfig {
  /** "single" → whole bot speaks one language; "multi" → user picks on /start. */
  mode: "single" | "multi";
  /** The bot admin's chosen main language. */
  primary: LanguageCode;
  /** Languages offered in multi mode (always includes `primary`). */
  enabled: LanguageCode[];
  /** Show the language picker on the user's first /start. When false, only the
   *  /language command opens it. */
  promptOnStart: boolean;
}

const DEFAULT_CONFIG: BotLanguageConfig = {
  mode: "single",
  primary: "fa",
  enabled: ["fa"],
  promptOnStart: true,
};

const DATA_SHEET = process.env.SHEETS_DATA_ID ?? null;
const DEV_FILE = path.join(process.cwd(), ".dev-bot-language.json");

// In-memory cache so reads-after-writes are consistent within a process even
// when neither the sheet nor the disk file is writable.
const mem = new Map<string, BotLanguageConfig>();

function coerce(raw: unknown): BotLanguageConfig {
  const r = (raw ?? {}) as Partial<BotLanguageConfig>;
  const mode = r.mode === "multi" ? "multi" : "single";
  const primary = (SUPPORTED_LANGUAGES as readonly string[]).includes(r.primary as string)
    ? (r.primary as LanguageCode)
    : DEFAULT_CONFIG.primary;
  let enabled = Array.isArray(r.enabled)
    ? r.enabled.filter((l): l is LanguageCode => (SUPPORTED_LANGUAGES as readonly string[]).includes(l))
    : [];
  if (mode === "single") enabled = [primary];
  else if (!enabled.includes(primary)) enabled = [primary, ...enabled];
  if (enabled.length === 0) enabled = [primary];
  return { mode, primary, enabled, promptOnStart: r.promptOnStart !== false };
}

function readDevFile(): Record<string, BotLanguageConfig> {
  try {
    return JSON.parse(fs.readFileSync(DEV_FILE, "utf8")) as Record<string, BotLanguageConfig>;
  } catch {
    return {};
  }
}

function writeDevFile(obj: Record<string, BotLanguageConfig>) {
  try {
    fs.writeFileSync(DEV_FILE, JSON.stringify(obj, null, 2));
  } catch {
    /* read-only fs in some envs — the in-memory cache still serves this run */
  }
}

/** Validate an untrusted request body into a well-formed config (or null). */
export function parseBotLanguageConfig(body: unknown): BotLanguageConfig | null {
  const b = (body ?? {}) as Record<string, unknown>;
  if (b.mode !== "single" && b.mode !== "multi") return null;
  if (!(SUPPORTED_LANGUAGES as readonly string[]).includes(b.primary as string)) return null;
  return coerce(b);
}

export async function getBotLanguage(botId: string): Promise<BotLanguageConfig> {
  if (DATA_SHEET) {
    try {
      const rec = await readKV<{ language?: unknown }>(DATA_SHEET, "bot_settings", botId);
      if (rec && rec.language) return coerce(rec.language);
    } catch (err) {
      logger.warn({ err, botId }, "getBotLanguage: sheet read failed, using fallback");
    }
  }
  if (mem.has(botId)) return mem.get(botId)!;
  const file = readDevFile();
  if (file[botId]) {
    const cfg = coerce(file[botId]);
    mem.set(botId, cfg);
    return cfg;
  }
  return { ...DEFAULT_CONFIG };
}

export async function setBotLanguage(botId: string, config: BotLanguageConfig): Promise<void> {
  const cfg = coerce(config);
  mem.set(botId, cfg);
  // Push to the bot's sheet for the runtime (fire-and-forget; no-ops without creds).
  syncBotSettingsUpsert({ botId, language: cfg });
  // Always keep a local copy so dev reads work without Google credentials.
  const file = readDevFile();
  file[botId] = cfg;
  writeDevFile(file);
}
