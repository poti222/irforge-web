/**
 * lib/crmStore.ts — IRFORGE_PROMPT_V3 Phase 20
 * ─────────────────────────────────────────────────────────────────────────────
 * Website-side data layer for the `crm` plugin's three tabs, mirroring
 * `plugins/crm/domain.py` field-for-field: `crm_tags` (the tag catalog),
 * `crm_user_tags` (the assignment join table), `crm_notes` (admin notes per
 * user). A dedicated store — not the generic `pluginCollections.ts` system —
 * because the join table's id is a deterministic composite key
 * `<user_id>:<tag_id>` (so re-assigning the same tag can never create a
 * duplicate row), and the generic system's `POST` handler only ever
 * generates a random id (`newRecordId`), which would defeat that guarantee
 * entirely. This is the exact reason `crm-user-tags` had to stay `readonly`
 * in the old generic collection — see pluginCollections.ts's own comment
 * where that entry used to live.
 *
 * User lookup reuses the existing `GET /bots/:botId/bot-users` search
 * endpoint (`routes/botUsers.ts`) rather than duplicating it here — CRM
 * only ever needs to resolve a user_id it already has, or let an admin
 * search Core's own user list.
 */
import {
  getEntity, putEntity, listEntity, removeEntity, assertSheetsAuthoritative, BotConfigError,
} from "./botConfig.js";
import { nowIso } from "./botTypes.js";
import { newRecordId } from "./pluginCollections.js";

const TAGS_TAB = "crm_tags";
const USER_TAGS_TAB = "crm_user_tags";
const NOTES_TAB = "crm_notes";

export const MAX_TAGS = 50;

export interface CrmTag {
  id: string;
  name: string;
  emoji: string;
  description: string;
  created_at?: string;
  updated_at?: string;
}

export interface CrmUserTag {
  id: string;
  user_id: string;
  tag_id: string;
  assigned_by: string;
  created_at?: string;
}

export interface CrmNote {
  id: string;
  user_id: string;
  body: string;
  author_id: string;
  created_at?: string;
}

function bad(message: string, code?: string): BotConfigError {
  return new BotConfigError(400, message, code);
}

function linkKey(userId: string, tagId: string): string {
  return `${userId}:${tagId}`;
}

// ══════════════════════════════════════════════════════════════════════════
//  تگ‌ها
// ══════════════════════════════════════════════════════════════════════════

export async function listTags(spreadsheetId: string): Promise<CrmTag[]> {
  const rows = await listEntity<CrmTag>(spreadsheetId, TAGS_TAB);
  return rows
    .filter((r) => r.value && typeof r.value === "object")
    .map((r) => ({ ...(r.value as CrmTag), id: r.key }))
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}

export async function getTag(spreadsheetId: string, id: string): Promise<CrmTag | null> {
  const value = await getEntity<CrmTag>(spreadsheetId, TAGS_TAB, id);
  return value ? { ...value, id } : null;
}

export async function createTag(spreadsheetId: string, body: any): Promise<CrmTag> {
  await assertSheetsAuthoritative(TAGS_TAB);
  const name = String(body?.name ?? "").trim();
  if (!name) throw bad("نام برچسب خالی است.", "bad_name");

  const existing = await listTags(spreadsheetId);
  if (existing.length >= MAX_TAGS) throw bad(`حداکثر ${MAX_TAGS} برچسب مجاز است.`, "max_tags");
  if (existing.some((t) => t.name.toLowerCase() === name.toLowerCase()))
    throw bad("برچسبی با همین نام از قبل وجود دارد.", "duplicate_name");

  const id = newRecordId("tag");
  const tag: CrmTag = {
    id,
    name: name.slice(0, 40),
    emoji: (String(body?.emoji ?? "").trim() || "🏷").slice(0, 4),
    description: String(body?.description ?? "").trim().slice(0, 200),
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  await putEntity(spreadsheetId, TAGS_TAB, id, tag);
  return tag;
}

export async function updateTag(spreadsheetId: string, id: string, body: any): Promise<CrmTag> {
  await assertSheetsAuthoritative(TAGS_TAB);
  const existing = await getTag(spreadsheetId, id);
  if (!existing) throw new BotConfigError(404, "این برچسب پیدا نشد.", "tag_not_found");

  const next: CrmTag = { ...existing, updated_at: nowIso() };
  if (body?.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) throw bad("نام برچسب خالی است.", "bad_name");
    const others = (await listTags(spreadsheetId)).filter((t) => t.id !== id);
    if (others.some((t) => t.name.toLowerCase() === name.toLowerCase()))
      throw bad("برچسبی با همین نام از قبل وجود دارد.", "duplicate_name");
    next.name = name.slice(0, 40);
  }
  if (body?.emoji !== undefined) next.emoji = (String(body.emoji).trim() || "🏷").slice(0, 4);
  if (body?.description !== undefined) next.description = String(body.description).trim().slice(0, 200);

  await putEntity(spreadsheetId, TAGS_TAB, id, next);
  return next;
}

/** برچسب + همه‌ی تخصیص‌هاش — همون قراردادِ `plugins/crm/domain.py::delete_tag`. */
export async function deleteTag(spreadsheetId: string, id: string): Promise<boolean> {
  await assertSheetsAuthoritative(TAGS_TAB);
  const links = await listEntity<CrmUserTag>(spreadsheetId, USER_TAGS_TAB);
  for (const row of links) {
    if (row.value && (row.value as CrmUserTag).tag_id === id) {
      await removeEntity(spreadsheetId, USER_TAGS_TAB, row.key);
    }
  }
  return removeEntity(spreadsheetId, TAGS_TAB, id);
}

// ══════════════════════════════════════════════════════════════════════════
//  تخصیص
// ══════════════════════════════════════════════════════════════════════════

async function allLinks(spreadsheetId: string): Promise<CrmUserTag[]> {
  const rows = await listEntity<CrmUserTag>(spreadsheetId, USER_TAGS_TAB);
  return rows
    .filter((r) => r.value && typeof r.value === "object")
    .map((r) => ({ ...(r.value as CrmUserTag), id: r.key }));
}

export async function tagsOfUser(spreadsheetId: string, userId: string): Promise<CrmTag[]> {
  const [links, tags] = await Promise.all([allLinks(spreadsheetId), listTags(spreadsheetId)]);
  const byId = new Map(tags.map((t) => [t.id, t]));
  return links
    .filter((l) => l.user_id === userId)
    .map((l) => byId.get(l.tag_id))
    .filter((t): t is CrmTag => Boolean(t))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** «کاربرِ X تگِ Y را دارد؟» را برای این تخصیصِ خاص، بی‌درنگ رعایت می‌کند —
 * کلیدِ ترکیبی یعنی تخصیصِ دوباره همان ردیف را جای‌گذاری می‌کند، نه یک ردیفِ دوم. */
export async function assignTag(
  spreadsheetId: string, userId: string, tagId: string, assignedBy: string
): Promise<CrmUserTag> {
  await assertSheetsAuthoritative(USER_TAGS_TAB);
  const tag = await getTag(spreadsheetId, tagId);
  if (!tag) throw new BotConfigError(404, "این برچسب وجود ندارد.", "tag_not_found");

  const id = linkKey(userId, tagId);
  const link: CrmUserTag = { id, user_id: userId, tag_id: tagId, assigned_by: assignedBy, created_at: nowIso() };
  await putEntity(spreadsheetId, USER_TAGS_TAB, id, link);
  return link;
}

export async function unassignTag(spreadsheetId: string, userId: string, tagId: string): Promise<boolean> {
  await assertSheetsAuthoritative(USER_TAGS_TAB);
  return removeEntity(spreadsheetId, USER_TAGS_TAB, linkKey(userId, tagId));
}

export async function usersWithTag(spreadsheetId: string, tagId: string): Promise<string[]> {
  const links = await allLinks(spreadsheetId);
  return links.filter((l) => l.tag_id === tagId).map((l) => l.user_id);
}

export async function tagCounts(spreadsheetId: string): Promise<Record<string, number>> {
  const links = await allLinks(spreadsheetId);
  const out: Record<string, number> = {};
  for (const link of links) out[link.tag_id] = (out[link.tag_id] ?? 0) + 1;
  return out;
}

// ══════════════════════════════════════════════════════════════════════════
//  یادداشت
// ══════════════════════════════════════════════════════════════════════════

export async function notesOfUser(spreadsheetId: string, userId: string): Promise<CrmNote[]> {
  const rows = await listEntity<CrmNote>(spreadsheetId, NOTES_TAB);
  return rows
    .filter((r) => r.value && typeof r.value === "object" && (r.value as CrmNote).user_id === userId)
    .map((r) => ({ ...(r.value as CrmNote), id: r.key }))
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
}

export async function addNote(spreadsheetId: string, userId: string, body: string, authorId: string): Promise<CrmNote> {
  await assertSheetsAuthoritative(NOTES_TAB);
  const text = String(body ?? "").trim();
  if (!text) throw bad("متن یادداشت خالی است.", "bad_body");

  const id = newRecordId("note");
  const note: CrmNote = { id, user_id: userId, body: text.slice(0, 1000), author_id: authorId, created_at: nowIso() };
  await putEntity(spreadsheetId, NOTES_TAB, id, note);
  return note;
}

export async function deleteNote(spreadsheetId: string, id: string): Promise<boolean> {
  await assertSheetsAuthoritative(NOTES_TAB);
  return removeEntity(spreadsheetId, NOTES_TAB, id);
}

// ══════════════════════════════════════════════════════════════════════════
//  آمار
// ══════════════════════════════════════════════════════════════════════════

export interface CrmStats {
  tags: number;
  taggedUsers: number;
  assignments: number;
  notes: number;
}

export async function getStats(spreadsheetId: string): Promise<CrmStats> {
  const [tags, links, notes] = await Promise.all([
    listTags(spreadsheetId),
    allLinks(spreadsheetId),
    listEntity<CrmNote>(spreadsheetId, NOTES_TAB),
  ]);
  return {
    tags: tags.length,
    taggedUsers: new Set(links.map((l) => l.user_id)).size,
    assignments: links.length,
    notes: notes.filter((r) => r.value && typeof r.value === "object").length,
  };
}
