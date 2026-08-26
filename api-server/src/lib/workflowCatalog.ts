/**
 * lib/workflowCatalog.ts — IRFORGE_PROMPT_V3 Phase 41.
 * ─────────────────────────────────────────────────────────────────────────────
 * Pure pieces of `GET /bots/:id/workflow-catalog` (routes/botWorkflows.ts),
 * split out so they're unit-testable without the Google-Sheets-backed
 * `resolveBotSheet`/`listEntity` stack the rest of that route needs.
 *
 * Before this phase, a workflow condition's `field` was a blind free-text
 * box — the admin had to already know the event payload's dotted-path shape
 * (e.g. "record.status", "wallet.balance") from reading bot source, since
 * nothing in the UI suggested it. `FIELD_SUGGESTIONS` and `objectsForCatalog`
 * are what let the web UI offer a real picker instead: the former is
 * hand-extracted from the exact payloads `event_engine.emit(...)` builds
 * (handlers/payment.py, plugins/wallet/service.py + ledger.py — see each
 * event's comment); the latter turns the bot's *own* dynamic Object schemas
 * into the field list for `event.object.*` conditions, since those payloads'
 * `record` shape depends entirely on what the bot owner defined in
 * ObjectsSection, not on anything this file could hardcode.
 */

export type CatalogObjectField = { name: string; label: string; type: string };
export type CatalogObject = { id: string; name: string; slug: string; fields: CatalogObjectField[] };

/** The subset of routes/botObjects.ts's ObjectSchema this module actually needs. */
export type ObjectSchemaLike = {
  id: string;
  name: string;
  slug: string;
  fields?: Array<{ name: string; label: string; type: string }> | null;
};

export const FIELD_SUGGESTIONS: Record<string, Array<{ path: string; label: string }>> = {
  "event.payment.approved": [
    { path: "payment.status", label: "وضعیت پرداخت" },
    { path: "payment.amount", label: "مبلغ" },
    { path: "payment.final_amount", label: "مبلغ نهایی" },
    { path: "payment.order_id", label: "شناسه سفارش" },
    { path: "payment.method", label: "روش پرداخت" },
    { path: "user_id", label: "شناسه کاربر" },
  ],
  "event.payment.rejected": [
    { path: "payment.status", label: "وضعیت پرداخت" },
    { path: "payment.order_id", label: "شناسه سفارش" },
    { path: "payment.reject_reason", label: "دلیل رد" },
    { path: "user_id", label: "شناسه کاربر" },
  ],
  "event.wallet.transaction": [
    { path: "wallet.balance", label: "موجودی فعلی" },
    { path: "wallet.owner_type", label: "نوع مالک" },
    { path: "wallet.owner_id", label: "شناسه مالک" },
    { path: "wallet.status", label: "وضعیت کیف پول" },
    { path: "wallet.currency", label: "واحد پول" },
    { path: "entry.action", label: "نوع تراکنش" },
    { path: "entry.amount_changed", label: "مبلغ تغییر" },
    { path: "entry.amount_before", label: "موجودی قبل" },
    { path: "entry.amount_after", label: "موجودی بعد" },
    { path: "entry.reason", label: "توضیح تراکنش" },
  ],
  "event.wallet.frozen": [
    { path: "wallet.owner_type", label: "نوع مالک" },
    { path: "wallet.owner_id", label: "شناسه مالک" },
    { path: "wallet.balance", label: "موجودی فعلی" },
  ],
  "event.wallet.unfrozen": [
    { path: "wallet.owner_type", label: "نوع مالک" },
    { path: "wallet.owner_id", label: "شناسه مالک" },
    { path: "wallet.balance", label: "موجودی فعلی" },
  ],
};

/**
 * Projects the bot's real Object schemas down to just what the workflow
 * condition-field picker needs: names/labels/types, no permissions or
 * internal metadata. A field with no `name` is dropped — an in-progress,
 * not-yet-named field in ObjectsSection's editor shouldn't show up as a
 * pickable (and unusable) condition target.
 */
export function objectsForCatalog(schemas: ObjectSchemaLike[]): CatalogObject[] {
  return schemas.map((s) => ({
    id: s.id,
    name: s.name,
    slug: s.slug,
    fields: (s.fields ?? [])
      .filter((f) => f && typeof f.name === "string" && f.name.trim() !== "")
      .map((f) => ({ name: f.name, label: f.label?.trim() || f.name, type: f.type })),
  }));
}
