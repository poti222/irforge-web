/**
 * lib/pluginOwners.ts — IRFORGE_PROMPT_V3 Phase 38.
 *
 * «چه کسانی این پلاگین را دارند» — برای اطلاع‌رسانیِ یادداشتِ انتشار
 * (`routes/pluginReleaseNotes.ts`) از `routes/botPlugins.ts`ی/`pluginLicences.ts`
 * جدا شد چون اینجا فقط user_id لازم است، یکتا حتی اگر همان کاربر پلاگین را
 * روی چند بات نصب کرده باشد — وگرنه یک کاربرِ با سه بات، سه اعلانِ یکسان
 * می‌گرفت.
 */
import { db, installedPluginsTable, botsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { marketplaceItemIdFor } from "./marketplaceSync.js";

/** شناسه‌ی یکتای هر کاربری که این پلاگین را روی حداقل یک بات نصب دارد. */
export async function ownerUserIdsForPlugin(pluginId: string): Promise<string[]> {
  const itemId = marketplaceItemIdFor(pluginId);
  const installs = await db
    .select({ botId: installedPluginsTable.botId })
    .from(installedPluginsTable)
    .where(eq(installedPluginsTable.marketplaceItemId, itemId));
  if (installs.length === 0) return [];

  const botIds = [...new Set(installs.map((i) => i.botId))];
  const owners = await db
    .select({ userId: botsTable.userId })
    .from(botsTable)
    .where(inArray(botsTable.id, botIds));
  return [...new Set(owners.map((o) => o.userId))];
}
