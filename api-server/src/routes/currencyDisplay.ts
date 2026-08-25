/**
 * routes/currencyDisplay.ts — IRFORGE_PROMPT_V3 Phase 39
 * ─────────────────────────────────────────────────────────────────────────────
 * Same three-route shape as `routes/supportLinks.ts`, backed by
 * `lib/platformSettings.ts`'s `currency_display` key. The public read has no
 * `requireAuth`: the pricing page (a logged-out visitor) needs it to show
 * converted amounts, exactly like `support-links` is public for the footer.
 */
import { Router } from "express";
import { requireSuperAdmin } from "./auth.js";
import { blockWhileImpersonating } from "../middleware/impersonation.js";
import { getCurrencyDisplay, setCurrencyDisplay } from "../lib/platformSettings.js";
import { logger } from "../lib/logger.js";

const router = Router();

// GET /api/currency-display — public: any page showing a price.
router.get("/currency-display", async (_req, res) => {
  try {
    res.json(await getCurrencyDisplay());
  } catch (err) {
    logger.error({ err }, "Get currency display error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/admin/currency-display — same values, for the admin settings form.
router.get("/admin/currency-display", requireSuperAdmin, async (_req: any, res) => {
  try {
    res.json(await getCurrencyDisplay());
  } catch (err) {
    logger.error({ err }, "Get admin currency display error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /api/admin/currency-display — save.
router.put("/admin/currency-display", requireSuperAdmin, blockWhileImpersonating, async (req: any, res) => {
  try {
    const saved = await setCurrencyDisplay(req.body, req.userId);
    logger.info({ userId: req.userId }, "currency display settings updated");
    res.json(saved);
  } catch (err) {
    logger.error({ err }, "Update currency display error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
