/**
 * lib/sheetPoolView.ts — IRFORGE_PROMPT_V3 Phase 43.
 * ─────────────────────────────────────────────────────────────────────────────
 * Pure shaping logic for `GET /api/sheet-pool` (routes/bots.ts), split out so
 * it's unit-testable without mocking three sequential Drizzle queries.
 *
 * The admin sheet-pool panel used to show an assigned sheet's owner as their
 * raw user id — a UUID, meaningless to a human trying to recognize who a
 * sheet belongs to. A super admin actually recognizes someone by their
 * Telegram @username (or their display name, if they never linked
 * Telegram), never by the database key, so this resolves that instead of
 * making the frontend guess.
 */

export type SheetPoolEntryRow = {
  id: string;
  sheetId: string;
  status: string;
  assignedBotId: string | null;
  createdAt: Date;
};

export type BotRow = { id: string; name: string; userId: string };
export type OwnerRow = { id: string; name: string; telegramUsername: string | null };

export type SheetPoolEntryView = {
  id: string;
  sheetId: string;
  status: string;
  assignedBotId: string | null;
  assignedBotName: string | null;
  assignedBotOwnerId: string | null;
  assignedBotOwnerName: string | null;
  assignedBotOwnerUsername: string | null;
  createdAt: string;
};

export function buildSheetPoolView(
  entries: SheetPoolEntryRow[],
  bots: BotRow[],
  owners: OwnerRow[],
): SheetPoolEntryView[] {
  const botsById = new Map(bots.map((b) => [b.id, b]));
  const ownersById = new Map(owners.map((o) => [o.id, o]));

  return entries.map((e) => {
    const bot = e.assignedBotId ? botsById.get(e.assignedBotId) : undefined;
    const owner = bot ? ownersById.get(bot.userId) : undefined;
    return {
      id: e.id,
      sheetId: e.sheetId,
      status: e.status,
      assignedBotId: e.assignedBotId,
      assignedBotName: bot?.name ?? null,
      assignedBotOwnerId: bot?.userId ?? null,
      assignedBotOwnerName: owner?.name ?? null,
      assignedBotOwnerUsername: owner?.telegramUsername ?? null,
      createdAt: e.createdAt.toISOString(),
    };
  });
}
