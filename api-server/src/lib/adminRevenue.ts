/**
 * lib/adminRevenue.ts — IRFORGE_PROMPT_V3 Phase 35.
 * ─────────────────────────────────────────────────────────────────────────────
 * "What actually moved money" was computed inline inside `GET /admin/stats`
 * (the aggregate cards). Phase 35 adds a drill-down endpoint that needs the
 * exact same set of transactions, filtered and itemized instead of summed —
 * so the logic moved here once, rather than growing a second copy that could
 * silently disagree with the card totals it's supposed to explain.
 *
 * Only two sources count, and never both for the same money (see the longer
 * comment this was moved from, still in `routes/admin.ts`): an approved
 * receipt (`payments`), or an approved spend from the wallet
 * (`wallet_transactions`, `type = 'spend'`). A wallet top-up is not revenue —
 * only spending it is, and spending is exactly where the source's own
 * `reviewNote` says what was bought (`routes/bots.ts`'s `deductWallet`
 * always writes one).
 */
import { db, paymentsTable, walletTransactionsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

export type RevenueKind = "bot" | "plugin" | "other";

export type RevenueEntry = {
  id: string;
  amount: number;
  at: Date;
  kind: RevenueKind;
  source: "payment" | "wallet";
  userId: string;
  botId: string | null;
  note: string | null;
};

export async function getRevenueEntries(): Promise<RevenueEntry[]> {
  const [approvedPayments, walletSpends] = await Promise.all([
    db
      .select({
        id: paymentsTable.id,
        amount: paymentsTable.amount,
        botId: paymentsTable.botId,
        userId: paymentsTable.userId,
        createdAt: paymentsTable.createdAt,
      })
      .from(paymentsTable)
      .where(eq(paymentsTable.status, "approved")),
    db
      .select({
        id: walletTransactionsTable.id,
        amount: walletTransactionsTable.amount,
        note: walletTransactionsTable.reviewNote,
        userId: walletTransactionsTable.userId,
        createdAt: walletTransactionsTable.createdAt,
      })
      .from(walletTransactionsTable)
      .where(and(eq(walletTransactionsTable.type, "spend"), eq(walletTransactionsTable.status, "approved"))),
  ]);

  const entries: RevenueEntry[] = [
    // فیشِ دارای bot_id یعنی خرید بات؛ بدون آن یک پرداخت عمومی است.
    ...approvedPayments.map((p) => ({
      id: p.id,
      amount: p.amount ?? 0,
      at: p.createdAt,
      kind: (p.botId ? "bot" : "other") as RevenueKind,
      source: "payment" as const,
      userId: p.userId,
      botId: p.botId,
      note: null,
    })),
    // یادداشتِ خرج همان‌جایی نوشته می‌شود که پول کم می‌شود
    // (`lib/wallet.ts`::deductWallet): «Bot purchase: …» یا «Plugin: …» یا
    // «Plan upgrade/renew/subscribe: …».
    ...walletSpends.map((s) => ({
      id: s.id,
      amount: s.amount ?? 0,
      at: s.createdAt,
      kind: (s.note?.startsWith("Bot purchase:")
        ? "bot"
        : s.note?.startsWith("Plugin:")
          ? "plugin"
          : "other") as RevenueKind,
      source: "wallet" as const,
      userId: s.userId,
      botId: null,
      note: s.note ?? null,
    })),
  ];

  return entries;
}

export function sumRevenue(rows: Array<{ amount: number }>): number {
  return rows.reduce((acc, r) => acc + r.amount, 0);
}
