/**
 * routes/supportLinks.ts — IRFORGE_PROMPT_V3 Phase 21
 * ─────────────────────────────────────────────────────────────────────────────
 * The education-channel/Instagram links and the admin-managed tutorial-link
 * list, backed by `lib/platformSettings.ts`'s `support_links` key. Same
 * three-route shape as `routes/wallet.ts`'s deposit-info/payment-settings
 * pair, except the public read here has NO `requireAuth`: these links are
 * shown on public marketing pages (the footer, learn articles) that a
 * logged-out visitor sees, unlike a deposit address which is only ever
 * shown to a signed-in user.
 */
import { Router } from "express";
import { requireSuperAdmin } from "./auth.js";
import { blockWhileImpersonating } from "../middleware/impersonation.js";
import { getSupportLinks, setSupportLinks } from "../lib/platformSettings.js";
import { logger } from "../lib/logger.js";

const router = Router();

// GET /api/support-links — public: footer, learn articles, the support FAB.
router.get("/support-links", async (_req, res) => {
  try {
    res.json(await getSupportLinks());
  } catch (err) {
    logger.error({ err }, "Get support links error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/admin/support-links — same values, for the admin settings form.
router.get("/admin/support-links", requireSuperAdmin, async (_req: any, res) => {
  try {
    res.json(await getSupportLinks());
  } catch (err) {
    logger.error({ err }, "Get admin support links error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /api/admin/support-links — save.
router.put("/admin/support-links", requireSuperAdmin, blockWhileImpersonating, async (req: any, res) => {
  try {
    const saved = await setSupportLinks(req.body, req.userId);
    logger.info({ userId: req.userId }, "support links updated");
    res.json(saved);
  } catch (err) {
    logger.error({ err }, "Update support links error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
