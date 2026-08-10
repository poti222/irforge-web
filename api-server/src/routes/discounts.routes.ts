/**
 * routes/discounts.ts
 * Phase 9 — کدهای تخفیف: schema و API.
 *
 * POST /api/discounts/validate فقط استعلام (quote) می‌کند — هرگز usedCount
 * را افزایش نمی‌دهد و هرگز discount_redemptions نمی‌نویسد. افزایش واقعیِ
 * usedCount و نوشتن ردیف redemption فقط داخل تراکنش خرید (Phase 11،
 * POST /bots/wallet-purchase) اتفاق می‌افتد.
 */
import { logger } from "../lib/logger";
import { Router } from "express";
import { db, discountCodesTable, usersTable } from "@workspace/db";
import { eq, and, ne, desc } from "drizzle-orm";
import crypto from "crypto";
import { requireAuth } from "./auth";
import { computeDiscount, type DiscountKind } from "../lib/discounts";

const router = Router();

function requireSuperAdmin(req: any, res: any, next: any) {
  requireAuth(req, res, async () => {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId)).limit(1);
    if (!user || user.role !== "super_admin") {
      res.status(403).json({ error: "Super admin only" });
      return;
    }
    next();
  });
}

const DISCOUNT_KINDS = ["percent", "fixed"] as const;

function normalizeCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toUpperCase();
  return trimmed === "" ? null : trimmed;
}

/** برمی‌گرداند: پیام خطا اگر kind/value نامعتبر باشد، وگرنه null. */
function validateKindValue(kind: unknown, value: unknown): string | null {
  if (kind !== "percent" && kind !== "fixed") {
    return `Kind must be one of: ${DISCOUNT_KINDS.join(", ")}`;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    return "Value must be an integer";
  }
  if (kind === "percent" && (value < 1 || value > 100)) {
    return "Percent value must be between 1 and 100";
  }
  if (kind === "fixed" && value <= 0) {
    return "Fixed value must be a positive amount";
  }
  return null;
}

function formatCode(c: typeof discountCodesTable.$inferSelect) {
  return {
    id: c.id,
    code: c.code,
    kind: c.kind,
    value: c.value,
    maxUses: c.maxUses,
    usedCount: c.usedCount,
    expiresAt: c.expiresAt ? c.expiresAt.toISOString() : null,
    active: c.active,
    createdBy: c.createdBy,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

// ─── POST /api/discounts/validate — quote only, never mutates ──────────────
router.post("/discounts/validate", requireAuth, async (req: any, res) => {
  try {
    const code = normalizeCode(req.body?.code);
    const amount = Number(req.body?.amount);

    if (!code) {
      res.status(400).json({ valid: false, reason: "not_found", error: "A discount code is required" });
      return;
    }
    if (!Number.isFinite(amount) || amount < 0) {
      res.status(400).json({ valid: false, reason: "not_found", error: "A valid order amount is required" });
      return;
    }

    const [row] = await db.select().from(discountCodesTable).where(eq(discountCodesTable.code, code)).limit(1);
    if (!row) {
      res.status(400).json({ valid: false, reason: "not_found", error: "کد تخفیف پیدا نشد" });
      return;
    }
    if (!row.active) {
      res.status(400).json({ valid: false, reason: "inactive", error: "این کد تخفیف غیرفعال است" });
      return;
    }
    if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
      res.status(400).json({ valid: false, reason: "expired", error: "این کد تخفیف منقضی شده است" });
      return;
    }
    if (row.maxUses != null && row.usedCount >= row.maxUses) {
      res.status(400).json({ valid: false, reason: "exhausted", error: "سقف استفاده از این کد تخفیف پر شده است" });
      return;
    }

    const { discountAmount, finalAmount } = computeDiscount(row.kind as DiscountKind, row.value, amount);

    res.json({
      valid: true,
      kind: row.kind,
      value: row.value,
      discountAmount,
      finalAmount,
    });
  } catch (err) {
    logger.error({ err }, "Validate discount error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── super-admin CRUD ────────────────────────────────────────────────────────

// GET /api/admin/discounts
router.get("/admin/discounts", requireSuperAdmin, async (_req: any, res) => {
  try {
    const rows = await db.select().from(discountCodesTable).orderBy(desc(discountCodesTable.createdAt));
    res.json(rows.map(formatCode));
  } catch (err) {
    logger.error({ err }, "List discount codes error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/admin/discounts
router.post("/admin/discounts", requireSuperAdmin, async (req: any, res) => {
  try {
    const code = normalizeCode(req.body?.code);
    if (!code) {
      res.status(400).json({ error: "A discount code is required" });
      return;
    }
    const { kind, value } = req.body ?? {};
    const kindValueError = validateKindValue(kind, value);
    if (kindValueError) {
      res.status(400).json({ error: kindValueError });
      return;
    }

    let maxUses: number | null = null;
    if (req.body?.maxUses != null && req.body?.maxUses !== "") {
      const n = Number(req.body.maxUses);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
        res.status(400).json({ error: "Max uses must be a positive integer, or omitted for unlimited" });
        return;
      }
      maxUses = n;
    }

    let expiresAt: Date | null = null;
    if (req.body?.expiresAt != null && req.body?.expiresAt !== "") {
      const d = new Date(req.body.expiresAt);
      if (isNaN(d.getTime())) {
        res.status(400).json({ error: "Expiry date is invalid" });
        return;
      }
      expiresAt = d;
    }

    const [existing] = await db.select().from(discountCodesTable).where(eq(discountCodesTable.code, code)).limit(1);
    if (existing) {
      res.status(409).json({ error: "This discount code already exists" });
      return;
    }

    const [created] = await db.insert(discountCodesTable).values({
      id: crypto.randomUUID(),
      code,
      kind,
      value,
      maxUses,
      usedCount: 0,
      expiresAt,
      active: req.body?.active === false ? false : true,
      createdBy: req.userId,
    }).returning();

    res.status(201).json(formatCode(created));
  } catch (err: any) {
    if (err?.code === "23505") {
      res.status(409).json({ error: "This discount code already exists" });
      return;
    }
    logger.error({ err }, "Create discount code error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/admin/discounts/:id
router.patch("/admin/discounts/:id", requireSuperAdmin, async (req: any, res) => {
  try {
    const [existing] = await db.select().from(discountCodesTable).where(eq(discountCodesTable.id, req.params.id)).limit(1);
    if (!existing) {
      res.status(404).json({ error: "Discount code not found" });
      return;
    }

    const patch: Partial<typeof discountCodesTable.$inferInsert> = {};

    if (req.body?.code !== undefined) {
      const code = normalizeCode(req.body.code);
      if (!code) {
        res.status(400).json({ error: "A discount code is required" });
        return;
      }
      const [dupe] = await db.select().from(discountCodesTable)
        .where(and(eq(discountCodesTable.code, code), ne(discountCodesTable.id, existing.id))).limit(1);
      if (dupe) {
        res.status(409).json({ error: "This discount code already exists" });
        return;
      }
      patch.code = code;
    }

    const kind = req.body?.kind !== undefined ? req.body.kind : existing.kind;
    const value = req.body?.value !== undefined ? req.body.value : existing.value;
    if (req.body?.kind !== undefined || req.body?.value !== undefined) {
      const kindValueError = validateKindValue(kind, value);
      if (kindValueError) {
        res.status(400).json({ error: kindValueError });
        return;
      }
      patch.kind = kind;
      patch.value = value;
    }

    if (req.body?.maxUses !== undefined) {
      if (req.body.maxUses === null || req.body.maxUses === "") {
        patch.maxUses = null;
      } else {
        const n = Number(req.body.maxUses);
        if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
          res.status(400).json({ error: "Max uses must be a positive integer, or omitted for unlimited" });
          return;
        }
        patch.maxUses = n;
      }
    }

    if (req.body?.expiresAt !== undefined) {
      if (req.body.expiresAt === null || req.body.expiresAt === "") {
        patch.expiresAt = null;
      } else {
        const d = new Date(req.body.expiresAt);
        if (isNaN(d.getTime())) {
          res.status(400).json({ error: "Expiry date is invalid" });
          return;
        }
        patch.expiresAt = d;
      }
    }

    if (req.body?.active !== undefined) {
      patch.active = !!req.body.active;
    }

    const [updated] = await db.update(discountCodesTable)
      .set(patch)
      .where(eq(discountCodesTable.id, existing.id))
      .returning();

    res.json(formatCode(updated));
  } catch (err: any) {
    if (err?.code === "23505") {
      res.status(409).json({ error: "This discount code already exists" });
      return;
    }
    logger.error({ err }, "Update discount code error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/admin/discounts/:id
router.delete("/admin/discounts/:id", requireSuperAdmin, async (req: any, res) => {
  try {
    const [existing] = await db.select().from(discountCodesTable).where(eq(discountCodesTable.id, req.params.id)).limit(1);
    if (!existing) {
      res.status(404).json({ error: "Discount code not found" });
      return;
    }
    await db.delete(discountCodesTable).where(eq(discountCodesTable.id, req.params.id));
    res.status(204).end();
  } catch (err) {
    logger.error({ err }, "Delete discount code error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
