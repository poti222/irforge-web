/**
 * routes/captcha.ts — IRFORGE_PROMPT_V3 Phase 42.
 * ─────────────────────────────────────────────────────────────────────────────
 * Same three-route shape as routes/currencyDisplay.ts: a public read (the
 * signup/trial forms need the site key to render the Turnstile widget before
 * the visitor is authenticated at all) and an admin read/write pair. There is
 * deliberately no field here for the Turnstile *secret* key — see
 * lib/platformSettings.ts's captcha section for why it's env-only.
 */
import { Router } from "express";
import { requireSuperAdmin } from "./auth.js";
import { blockWhileImpersonating } from "../middleware/impersonation.js";
import { getCaptchaSettings, setCaptchaSettings } from "../lib/platformSettings.js";
import { logger } from "../lib/logger.js";

const router = Router();

// GET /api/captcha-config — public: any page rendering the Turnstile widget.
router.get("/captcha-config", async (_req, res) => {
  try {
    res.json(await getCaptchaSettings());
  } catch (err) {
    logger.error({ err }, "Get captcha config error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/admin/captcha — same values, for the admin settings form.
router.get("/admin/captcha", requireSuperAdmin, async (_req: any, res) => {
  try {
    res.json(await getCaptchaSettings());
  } catch (err) {
    logger.error({ err }, "Get admin captcha config error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /api/admin/captcha — save (enabled + siteKey only; the secret is env-only).
router.put("/admin/captcha", requireSuperAdmin, blockWhileImpersonating, async (req: any, res) => {
  try {
    const saved = await setCaptchaSettings(req.body, req.userId);
    logger.info({ userId: req.userId }, "captcha settings updated");
    res.json(saved);
  } catch (err) {
    logger.error({ err }, "Update captcha config error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
