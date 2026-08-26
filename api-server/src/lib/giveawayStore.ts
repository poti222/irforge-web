/**
 * lib/giveawayStore.ts — IRFORGE_PROMPT_V3 Phase 20
 * ─────────────────────────────────────────────────────────────────────────────
 * Website-side data layer for the `giveaway` plugin, mirroring
 * `plugins/giveaway/domain.py` field-for-field. A dedicated store — not the
 * generic `pluginCollections.ts` system — because the old generic
 * `giveaway-entries` collection was a flat, unfiltered list of every
 * entrant across every campaign with no way to see which giveaway a given
 * entry belonged to in context, and `winner_ids`/`drawn_at`/`announced_at`
 * weren't even in the old `giveaways` field list at all, so a drawn
 * winner was invisible on the site.
 *
 * The actual draw stays bot-only, unchanged from the old collection's own
 * documented policy ("the draw itself runs from inside the bot, so the
 * result is recorded once and for good") — reimplementing
 * `random.sample()` here would risk a second, independent RNG picking a
 * *different* winner if it were ever triggered from both sides, for zero
 * benefit. This store only reads the campaign + its entrants/winners and
 * edits the pre-draw fields (title, prize, description, winner_count,
 * ends_at, require_channel, min_points) plus cancellation.
 */
import {
  getEntity, putEntity, listEntity, removeEntity, assertSheetsAuthoritative, BotConfigError,
} from "./botConfig.js";
import { nowIso } from "./botTypes.js";
import { newRecordId } from "./pluginCollections.js";

const GIVEAWAYS_TAB = "giveaways";
const ENTRIES_TAB = "giveaway_entries";

export const STATUS_DRAFT = "draft";
export const STATUS_RUNNING = "running";
export const STATUS_DRAWN = "drawn";
export const STATUS_CANCELED = "canceled";

export interface Giveaway {
  id: string;
  title: string;
  prize: string;
  description: string;
  winner_count: number;
  status: string;
  ends_at: string;
  require_channel: string;
  min_points: number;
  winner_ids: string[];
  entry_count: number;
  drawn_at?: string;
  announced_at?: string;
  created_at?: string;
  updated_at?: string;
}

export interface GiveawayEntry {
  id: string;
  giveaway_id: string;
  user_id: string;
  username: string;
  created_at?: string;
}

function bad(message: string, code?: string): BotConfigError {
  return new BotConfigError(400, message, code);
}

export async function listGiveaways(spreadsheetId: string): Promise<Giveaway[]> {
  const rows = await listEntity<Giveaway>(spreadsheetId, GIVEAWAYS_TAB);
  return rows
    .filter((r) => r.value && typeof r.value === "object")
    .map((r) => ({ ...(r.value as Giveaway), id: r.key }))
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
}

export async function getGiveaway(spreadsheetId: string, id: string): Promise<Giveaway | null> {
  const value = await getEntity<Giveaway>(spreadsheetId, GIVEAWAYS_TAB, id);
  return value ? { ...value, id } : null;
}

export async function createGiveaway(spreadsheetId: string, body: any): Promise<Giveaway> {
  await assertSheetsAuthoritative(GIVEAWAYS_TAB);
  const title = String(body?.title ?? "").trim();
  if (!title) throw bad("عنوان قرعه‌کشی نمی‌تواند خالی باشد.", "bad_title");
  const prize = String(body?.prize ?? "").trim();
  if (!prize) throw bad("جایزه نمی‌تواند خالی باشد.", "bad_prize");

  const winnerCount = Math.max(1, Math.round(Number(body?.winner_count ?? 1)) || 1);
  const minPoints = Math.max(0, Math.round(Number(body?.min_points ?? 0)) || 0);
  const endsAt = String(body?.ends_at ?? "").trim();
  if (endsAt && Number.isNaN(new Date(endsAt).getTime())) throw bad("زمان پایان معتبر نیست.", "bad_ends_at");

  const id = newRecordId("gw");
  const giveaway: Giveaway = {
    id,
    title: title.slice(0, 120),
    prize: prize.slice(0, 120),
    description: String(body?.description ?? "").trim().slice(0, 500),
    winner_count: winnerCount,
    status: STATUS_RUNNING,
    ends_at: endsAt ? new Date(endsAt).toISOString() : "",
    require_channel: String(body?.require_channel ?? "").trim().slice(0, 80),
    min_points: minPoints,
    winner_ids: [],
    entry_count: 0,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  await putEntity(spreadsheetId, GIVEAWAYS_TAB, id, giveaway);
  return giveaway;
}

/** فقط فیلدهای پیش‌از-قرعه‌کشی قابل‌ویرایش‌اند — status/winner_ids/entry_count/
 * drawn_at/announced_at مالِ خودِ فرآیندِ بات‌اند و اینجا دست‌نخورده می‌مانند. */
export async function updateGiveaway(spreadsheetId: string, id: string, body: any): Promise<Giveaway> {
  await assertSheetsAuthoritative(GIVEAWAYS_TAB);
  const existing = await getGiveaway(spreadsheetId, id);
  if (!existing) throw new BotConfigError(404, "این قرعه‌کشی پیدا نشد.", "giveaway_not_found");

  const next: Giveaway = { ...existing, updated_at: nowIso() };
  if (body?.title !== undefined) {
    const title = String(body.title).trim();
    if (!title) throw bad("عنوان قرعه‌کشی نمی‌تواند خالی باشد.", "bad_title");
    next.title = title.slice(0, 120);
  }
  if (body?.prize !== undefined) {
    const prize = String(body.prize).trim();
    if (!prize) throw bad("جایزه نمی‌تواند خالی باشد.", "bad_prize");
    next.prize = prize.slice(0, 120);
  }
  if (body?.description !== undefined) next.description = String(body.description).trim().slice(0, 500);
  if (body?.winner_count !== undefined) next.winner_count = Math.max(1, Math.round(Number(body.winner_count)) || 1);
  if (body?.min_points !== undefined) next.min_points = Math.max(0, Math.round(Number(body.min_points)) || 0);
  if (body?.require_channel !== undefined) next.require_channel = String(body.require_channel).trim().slice(0, 80);
  if (body?.ends_at !== undefined) {
    const endsAt = String(body.ends_at ?? "").trim();
    if (endsAt && Number.isNaN(new Date(endsAt).getTime())) throw bad("زمان پایان معتبر نیست.", "bad_ends_at");
    next.ends_at = endsAt ? new Date(endsAt).toISOString() : "";
  }

  await putEntity(spreadsheetId, GIVEAWAYS_TAB, id, next);
  return next;
}

export async function cancelGiveaway(spreadsheetId: string, id: string): Promise<Giveaway> {
  await assertSheetsAuthoritative(GIVEAWAYS_TAB);
  const existing = await getGiveaway(spreadsheetId, id);
  if (!existing) throw new BotConfigError(404, "این قرعه‌کشی پیدا نشد.", "giveaway_not_found");
  const next: Giveaway = { ...existing, status: STATUS_CANCELED, updated_at: nowIso() };
  await putEntity(spreadsheetId, GIVEAWAYS_TAB, id, next);
  return next;
}

export async function deleteGiveaway(spreadsheetId: string, id: string): Promise<boolean> {
  await assertSheetsAuthoritative(GIVEAWAYS_TAB);
  const rows = await listEntity<GiveawayEntry>(spreadsheetId, ENTRIES_TAB);
  for (const row of rows) {
    if (row.value && (row.value as GiveawayEntry).giveaway_id === id) {
      await removeEntity(spreadsheetId, ENTRIES_TAB, row.key);
    }
  }
  return removeEntity(spreadsheetId, GIVEAWAYS_TAB, id);
}

// ══════════════════════════════════════════════════════════════════════════
//  شرکت‌کننده و برنده
// ══════════════════════════════════════════════════════════════════════════

export async function listEntrants(spreadsheetId: string, giveawayId: string): Promise<GiveawayEntry[]> {
  const rows = await listEntity<GiveawayEntry>(spreadsheetId, ENTRIES_TAB);
  return rows
    .filter((r) => r.value && typeof r.value === "object" && (r.value as GiveawayEntry).giveaway_id === giveawayId)
    .map((r) => ({ ...(r.value as GiveawayEntry), id: r.key }))
    .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
}

/** آینه‌ی `plugins/giveaway/domain.py::_winner_records` — winner_ids را به
 * رکوردِ کاملِ شرکت‌کننده (با username) ترجمه می‌کند. */
export async function getWinners(spreadsheetId: string, giveawayId: string): Promise<GiveawayEntry[]> {
  const giveaway = await getGiveaway(spreadsheetId, giveawayId);
  if (!giveaway || !Array.isArray(giveaway.winner_ids) || giveaway.winner_ids.length === 0) return [];
  const entrants = await listEntrants(spreadsheetId, giveawayId);
  const byUserId = new Map(entrants.map((e) => [e.user_id, e]));
  return giveaway.winner_ids.map((uid) => byUserId.get(String(uid))).filter((e): e is GiveawayEntry => Boolean(e));
}

export interface GiveawayStats {
  total: number;
  running: number;
  drawn: number;
  entries: number;
}

export async function getStats(spreadsheetId: string): Promise<GiveawayStats> {
  const giveaways = await listGiveaways(spreadsheetId);
  const entries = await listEntity<GiveawayEntry>(spreadsheetId, ENTRIES_TAB);
  const now = Date.now();
  const running = giveaways.filter((g) => {
    if (g.status !== STATUS_RUNNING) return false;
    if (!g.ends_at) return true;
    return new Date(g.ends_at).getTime() > now;
  });
  return {
    total: giveaways.length,
    running: running.length,
    drawn: giveaways.filter((g) => g.status === STATUS_DRAWN).length,
    entries: entries.filter((r) => r.value && typeof r.value === "object").length,
  };
}
