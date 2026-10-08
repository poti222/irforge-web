/**
 * routes/products.ts — IRFORGE_PRODUCTS_SECTION_PROMPT Phase 2.
 * ─────────────────────────────────────────────────────────────────────────────
 * Public read (`GET /products`, `GET /products/:id`, `GET /product-categories`)
 * plus admin CRUD for the platform's real product catalog — replacing
 * `irforge/src/lib/bot-tiers.ts`'s hardcoded packages as the source of truth
 * (see PROGRESS.md's `[products-section]` Phase 1/2 entries). Same shape as
 * `routes/plans.ts`: `requireAdmin` for admin reads, `requireSuperAdmin` for
 * writes — this data directly controls what customers are charged.
 */
import { logger } from "../lib/logger";
import { Router } from "express";
import { db, productsTable, productCategoriesTable, productPurchasesTable, botsTable } from "@workspace/db";
import { eq, and, ne, desc, count } from "drizzle-orm";
import crypto from "crypto";
import { requireAdmin, requireSuperAdmin, requireAuth } from "./auth";
import { rialToToman, tomanToRial } from "../lib/currency.js";

const router = Router();

function slugify(s: string): string {
  const slug = String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return slug || crypto.randomUUID();
}

/**
 * Toman (admin-facing form) — throws with a clean message on anything not a
 * finite non-negative number. Shared by POST/PATCH so both reject the exact
 * same shape of bad input.
 *
 * `null`/`""` are rejected explicitly, not coerced: `Number(null) === 0` and
 * `Number("") === 0`, so without this check a missing/blanked price field
 * would silently become a free product instead of a 400 — exactly the class
 * of quiet money mistake this whole file exists to avoid on the money-facing
 * field.
 */
function parsePriceToman(value: unknown): number {
  if (value === null || value === "") throw new Error("price must be a non-negative number");
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error("price must be a non-negative number");
  return n;
}

/** Best-effort coercion of a free-form `metadata` field — anything but a plain object collapses to `{}` rather than throwing, since it's advisory per-category data, not a validated contract. */
function coerceMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

const BOT_CATEGORY_ID = "bot";

/** دو پکیجِ اصلیِ دسته‌ی «بات» که `upgrade-tier`، seed و خریدهای قدیمی به‌طورِ ثابت به آن‌ها تکیه دارند. */
const CORE_BOT_PRODUCT_IDS = new Set(["standard", "pro"]);

function isBotCategoryId(categoryId: unknown): boolean {
  return categoryId === BOT_CATEGORY_ID;
}

/**
 * PATCH guard. 2026-10-08: ادمین می‌تواند در دسته‌ی «بات» پلنِ تازه بسازد (خرید، ساختِ بات، انقضا و تمدیدِ ماهانه
 * برای هر محصولِ این دسته کار می‌کند)، پس فقط Standard/Pro محافظت می‌شوند: غیرفعال نشوند و از دسته خارج نشوند؛ و هیچ
 * محصولِ دیگری هم نباید با تغییرِ `categoryId` وارد «بات» شود (محصولِ بدونِ متادیتای منابع قابل‌خرید نمی‌شود —
 * برایِ پلنِ بات آن را مستقیم در دسته‌ی «بات» بساز). `productId` ندادن = محصولِ اصلی (سازگاریِ تست‌ها).
 */
function botCategoryPatchViolation(existingCategoryId: string, body: Record<string, unknown>, productId?: string): string[] {
  const out: string[] = [];
  if (existingCategoryId !== BOT_CATEGORY_ID) {
    if (isBotCategoryId(body.categoryId)) out.push("categoryId");
    return out;
  }
  if (body.categoryId !== undefined && !isBotCategoryId(body.categoryId)) out.push("categoryId");
  const core = productId === undefined || CORE_BOT_PRODUCT_IDS.has(productId);
  if (core && body.isActive === false) out.push("isActive");
  return out;
}

function formatCategory(c: typeof productCategoriesTable.$inferSelect) {
  return {
    id: c.id,
    labelFa: c.labelFa,
    labelEn: c.labelEn,
    icon: c.icon,
    sortOrder: c.sortOrder,
    isActive: c.isActive,
  };
}

/** `price` is Rial at the DB layer (IRFORGE_RIAL_MIGRATION Phase 2) — converted to Toman here, same boundary convention as `formatPlan()` in routes/plans.ts. */
function formatProduct(p: typeof productsTable.$inferSelect) {
  return {
    id: p.id,
    categoryId: p.categoryId,
    name: p.name,
    nameFa: p.nameFa,
    description: p.description,
    descriptionFa: p.descriptionFa,
    price: rialToToman(p.price),
    isActive: p.isActive,
    icon: p.icon,
    sortOrder: p.sortOrder,
    metadata: p.metadata,
  };
}

// ─── خواندنِ عمومی ────────────────────────────────────────────────────────────

// GET /api/product-categories — فقط دسته‌های فعال، برای صفحه‌ی عمومیِ /products.
router.get("/product-categories", async (req: any, res) => {
  try {
    const rows = await db.select().from(productCategoriesTable).where(eq(productCategoriesTable.isActive, true));
    res.json(rows.sort((a, b) => a.sortOrder - b.sortOrder).map(formatCategory));
  } catch (err) {
    logger.error({ err }, "List product categories error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/products?category=bot — فقط محصولاتِ فعال.
router.get("/products", async (req: any, res) => {
  try {
    const category = typeof req.query?.category === "string" ? req.query.category : undefined;
    const rows = category
      ? await db.select().from(productsTable).where(and(eq(productsTable.isActive, true), eq(productsTable.categoryId, category)))
      : await db.select().from(productsTable).where(eq(productsTable.isActive, true));
    res.json(rows.sort((a, b) => a.sortOrder - b.sortOrder).map(formatProduct));
  } catch (err) {
    logger.error({ err }, "List products error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/products/:id — فقط اگر فعال باشد (یک محصولِ غیرفعال برای مشتری وجود ندارد).
router.get("/products/:id", async (req: any, res) => {
  try {
    const [row] = await db.select().from(productsTable)
      .where(and(eq(productsTable.id, req.params.id), eq(productsTable.isActive, true)))
      .limit(1);
    if (!row) { res.status(404).json({ error: "Product not found" }); return; }
    res.json(formatProduct(row));
  } catch (err) {
    logger.error({ err }, "Get product error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── خریدهایِ من (کاربر) ────────────────────────────────────────────────────

/**
 * GET /api/my-purchases — IRFORGE_MY_PRODUCTS_SEO_PLANS_PROMPT Section A.
 * غیرِبات‌یِ فعالِ کاربرِ لاگین‌کرده، برایِ صفحه‌ی «محصولاتِ من». دسته‌ی «بات»
 * عمداً کنار گذاشته می‌شود — بات‌ها رکوردِ خریدِ خودشان (خودِ جدولِ `bots`) را
 * دارند، این جدول برایِ همان پنج دسته‌یِ دیگر است. رکوردِ `cancelled`/`expired`
 * نشان داده نمی‌شود؛ فقط `active`.
 */
router.get("/my-purchases", requireAuth, async (req: any, res) => {
  try {
    const rows = await db
      .select({
        id: productPurchasesTable.id,
        status: productPurchasesTable.status,
        metadata: productPurchasesTable.metadata,
        purchasedAt: productPurchasesTable.purchasedAt,
        product: productsTable,
        category: productCategoriesTable,
      })
      .from(productPurchasesTable)
      .innerJoin(productsTable, eq(productPurchasesTable.productId, productsTable.id))
      .innerJoin(productCategoriesTable, eq(productsTable.categoryId, productCategoriesTable.id))
      .where(and(
        eq(productPurchasesTable.userId, req.userId),
        eq(productPurchasesTable.status, "active"),
        ne(productsTable.categoryId, BOT_CATEGORY_ID),
      ))
      .orderBy(desc(productPurchasesTable.purchasedAt));

    res.json(rows.map((r) => ({
      id: r.id,
      status: r.status,
      metadata: r.metadata,
      purchasedAt: r.purchasedAt,
      product: formatProduct(r.product),
      category: formatCategory(r.category),
    })));
  } catch (err) {
    logger.error({ err }, "List my purchases error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── مدیریتِ دسته‌بندی (ادمین) ─────────────────────────────────────────────────

// GET /api/admin/product-categories — فهرستِ کامل، شاملِ غیرفعال‌ها.
router.get("/admin/product-categories", requireAdmin, async (req: any, res) => {
  try {
    const rows = await db.select().from(productCategoriesTable);
    res.json(rows.sort((a, b) => a.sortOrder - b.sortOrder).map(formatCategory));
  } catch (err) {
    logger.error({ err }, "Admin list product categories error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/admin/product-categories
router.post("/admin/product-categories", requireSuperAdmin, async (req: any, res) => {
  try {
    const { id, labelFa, labelEn, icon, sortOrder, isActive } = req.body ?? {};
    if (!labelFa || !labelEn) {
      res.status(400).json({ error: "labelFa and labelEn are required" });
      return;
    }
    const [category] = await db.insert(productCategoriesTable).values({
      id: id?.trim() || slugify(labelEn),
      labelFa,
      labelEn,
      icon: icon ?? null,
      sortOrder: Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : 0,
      isActive: isActive !== false,
    }).returning();
    res.status(201).json(formatCategory(category));
  } catch (err: any) {
    if (err?.code === "23505") {
      res.status(409).json({ error: "A category with this id already exists" });
      return;
    }
    logger.error({ err }, "Create product category error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/admin/product-categories/:id
router.patch("/admin/product-categories/:id", requireSuperAdmin, async (req: any, res) => {
  try {
    const update: Record<string, any> = {};
    const { labelFa, labelEn, icon, sortOrder, isActive } = req.body ?? {};
    if (labelFa !== undefined) update.labelFa = labelFa;
    if (labelEn !== undefined) update.labelEn = labelEn;
    if (icon !== undefined) update.icon = icon;
    if (sortOrder !== undefined) update.sortOrder = Number(sortOrder) || 0;
    if (isActive !== undefined) update.isActive = !!isActive;
    if (Object.keys(update).length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }
    const [category] = await db.update(productCategoriesTable).set(update)
      .where(eq(productCategoriesTable.id, req.params.id)).returning();
    if (!category) { res.status(404).json({ error: "Category not found" }); return; }
    res.json(formatCategory(category));
  } catch (err) {
    logger.error({ err }, "Update product category error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/admin/product-categories/:id
router.delete("/admin/product-categories/:id", requireSuperAdmin, async (req: any, res) => {
  try {
    const [category] = await db.select({ id: productCategoriesTable.id }).from(productCategoriesTable)
      .where(eq(productCategoriesTable.id, req.params.id)).limit(1);
    if (!category) { res.status(404).json({ error: "Category not found" }); return; }

    /**
     * دسته‌ای که محصولِ فعال دارد حذف نمی‌شود — همان تصمیمِ فازِ ۱
     * (PROGRESS.md): بی‌قید حذف یعنی محصول‌های همان دسته یتیم می‌مانند و
     * جایی دیده نمی‌شوند. ادمینی که واقعاً می‌خواهد دسته را بردارد، اول
     * محصول‌هایش را غیرفعال/منتقل می‌کند — دو قدمِ آگاهانه، نه یک
     * cascade-deleteِ خاموش.
     */
    const [{ activeProducts }] = await db.select({ activeProducts: count() }).from(productsTable)
      .where(and(eq(productsTable.categoryId, req.params.id), eq(productsTable.isActive, true)));
    if (activeProducts > 0) {
      res.status(409).json({
        error: `این دسته ${activeProducts} محصولِ فعال دارد و حذف نمی‌شود. اول محصولات را غیرفعال یا به دسته‌ی دیگری منتقل کنید.`,
        code: "category_in_use",
        activeProducts,
      });
      return;
    }

    await db.delete(productCategoriesTable).where(eq(productCategoriesTable.id, req.params.id));
    res.status(204).end();
  } catch (err) {
    logger.error({ err }, "Delete product category error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── مدیریتِ محصول (ادمین) ─────────────────────────────────────────────────────

// GET /api/admin/products — فهرستِ کامل، شاملِ غیرفعال‌ها.
router.get("/admin/products", requireAdmin, async (req: any, res) => {
  try {
    const category = typeof req.query?.category === "string" ? req.query.category : undefined;
    const rows = category
      ? await db.select().from(productsTable).where(eq(productsTable.categoryId, category))
      : await db.select().from(productsTable);
    res.json(rows.sort((a, b) => a.sortOrder - b.sortOrder).map(formatProduct));
  } catch (err) {
    logger.error({ err }, "Admin list products error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/admin/products — `price` (Toman، همان فرمِ ادمین) به ریال تبدیل و ذخیره می‌شود.
router.post("/admin/products", requireSuperAdmin, async (req: any, res) => {
  try {
    const { id, categoryId, name, nameFa, description, descriptionFa, price, isActive, icon, sortOrder, metadata } = req.body ?? {};
    if (!name || !categoryId) {
      res.status(400).json({ error: "name and categoryId are required" });
      return;
    }
    // شناسه‌ی پلنِ بات همان `bots.tier` و `buildSpec.tierId` می‌شود: slug ساده، یکتا و غیرِ رزروشده.
    let botProductId: string | null = null;
    if (isBotCategoryId(categoryId)) {
      const candidate = String(id ?? "").trim() || slugify(String(name));
      if (!/^[a-z0-9][a-z0-9_-]{1,39}$/.test(candidate) || ["custom", "trial", "free"].includes(candidate)) {
        res.status(400).json({ error: "شناسه‌ی پلنِ بات باید ۲ تا ۴۰ حرفِ انگلیسیِ کوچک/عدد/خط‌تیره باشد (و custom/trial/free نباشد).", code: "bad_bot_product_id" });
        return;
      }
      botProductId = candidate;
    }
    let priceToman: number;
    try {
      priceToman = parsePriceToman(price);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
      return;
    }
    const [category] = await db.select({ id: productCategoriesTable.id }).from(productCategoriesTable)
      .where(eq(productCategoriesTable.id, categoryId)).limit(1);
    if (!category) {
      res.status(400).json({ error: "categoryId does not reference an existing category" });
      return;
    }
    const [product] = await db.insert(productsTable).values({
      id: botProductId ?? (id?.trim() || crypto.randomUUID()),
      categoryId,
      name,
      nameFa: nameFa ?? "",
      description: description ?? "",
      descriptionFa: descriptionFa ?? "",
      price: tomanToRial(priceToman),
      isActive: isActive !== false,
      icon: icon ?? null,
      sortOrder: Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : 0,
      metadata: coerceMetadata(metadata),
      createdBy: req.userId,
    }).returning();
    res.status(201).json(formatProduct(product));
  } catch (err: any) {
    if (err?.code === "23505") {
      res.status(409).json({ error: "A product with this id already exists" });
      return;
    }
    logger.error({ err }, "Create product error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/admin/products/:id
router.patch("/admin/products/:id", requireSuperAdmin, async (req: any, res) => {
  try {
    const [existing] = await db.select({ categoryId: productsTable.categoryId }).from(productsTable)
      .where(eq(productsTable.id, req.params.id)).limit(1);
    if (!existing) { res.status(404).json({ error: "Product not found" }); return; }

    const body = req.body ?? {};
    if (botCategoryPatchViolation(existing.categoryId, body, req.params.id).length > 0) {
      res.status(403).json({
        error: "Standard/Pro را می‌شود ویرایش کرد، ولی غیرفعال‌کردن یا جابه‌جاییِ دسته‌شان مجاز نیست (پلنِ سوم/حذفِ پلن ممکن نیست).",
        code: "bot_category_locked",
      });
      return;
    }

    const update: Record<string, any> = {};
    const { categoryId, name, nameFa, description, descriptionFa, price, isActive, icon, sortOrder, metadata } = body;
    if (categoryId !== undefined) {
      const [category] = await db.select({ id: productCategoriesTable.id }).from(productCategoriesTable)
        .where(eq(productCategoriesTable.id, categoryId)).limit(1);
      if (!category) { res.status(400).json({ error: "categoryId does not reference an existing category" }); return; }
      update.categoryId = categoryId;
    }
    if (name !== undefined) update.name = name;
    if (nameFa !== undefined) update.nameFa = nameFa;
    if (description !== undefined) update.description = description;
    if (descriptionFa !== undefined) update.descriptionFa = descriptionFa;
    if (price !== undefined) {
      try {
        update.price = tomanToRial(parsePriceToman(price));
      } catch (e: any) {
        res.status(400).json({ error: e.message });
        return;
      }
    }
    if (isActive !== undefined) update.isActive = !!isActive;
    if (icon !== undefined) update.icon = icon;
    if (sortOrder !== undefined) update.sortOrder = Number(sortOrder) || 0;
    if (metadata !== undefined) update.metadata = coerceMetadata(metadata);
    if (Object.keys(update).length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }
    const [product] = await db.update(productsTable).set(update)
      .where(eq(productsTable.id, req.params.id)).returning();
    if (!product) { res.status(404).json({ error: "Product not found" }); return; }
    res.json(formatProduct(product));
  } catch (err) {
    logger.error({ err }, "Update product error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/admin/products/:id
router.delete("/admin/products/:id", requireSuperAdmin, async (req: any, res) => {
  try {
    const [product] = await db.select({ id: productsTable.id, categoryId: productsTable.categoryId }).from(productsTable)
      .where(eq(productsTable.id, req.params.id)).limit(1);
    if (!product) { res.status(404).json({ error: "Product not found" }); return; }
    if (isBotCategoryId(product.categoryId)) {
      if (CORE_BOT_PRODUCT_IDS.has(product.id)) {
        res.status(403).json({ error: "Standard و Pro حذف نمی‌شوند.", code: "bot_category_locked" });
        return;
      }
      const [inUse] = await db.select({ n: count() }).from(botsTable).where(eq(botsTable.tier, product.id));
      if ((inUse?.n ?? 0) > 0) {
        res.status(409).json({ error: `${inUse.n} بات با این پلن فعال/ثبت است؛ ابتدا آن‌ها را به پلنِ دیگری منتقل کنید یا فقط پلن را غیرفعال کنید.`, code: "bot_product_in_use" });
        return;
      }
    }
    await db.delete(productsTable).where(eq(productsTable.id, req.params.id));
    res.status(204).end();
  } catch (err) {
    logger.error({ err }, "Delete product error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export const __testables = {
  slugify, parsePriceToman, coerceMetadata, formatProduct, formatCategory,
  isBotCategoryId, botCategoryPatchViolation,
};

export default router;
