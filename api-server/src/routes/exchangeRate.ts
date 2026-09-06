/**
 * routes/exchangeRate.ts — Phase 10 of identityverificationspec.md.
 * ─────────────────────────────────────────────────────────────────────────────
 * Admin-only: the current USD→Rial billing rate, its staleness, and a
 * manual-override endpoint. Not public — unlike `currency-display`
 * (Phase 39), nothing on a logged-out page needs this directly; a
 * live-priced plan's Toman amount already comes pre-converted from
 * `GET /plans` (see routes/plans.ts's `formatPlan()`).
 */
import { Router } from "express";
import { requireSuperAdmin } from "./auth.js";
import { blockWhileImpersonating } from "../middleware/impersonation.js";
import { getCurrentExchangeRate, setManualExchangeRate } from "../lib/exchangeRate.js";
import { isPlausibleRialPerUsd, MIN_PLAUSIBLE_RIAL_PER_USD, MAX_PLAUSIBLE_RIAL_PER_USD } from "../lib/currency.js";
import { logger } from "../lib/logger.js";

const router = Router();

// GET /api/admin/exchange-rate
router.get("/admin/exchange-rate", requireSuperAdmin, async (_req: any, res) => {
  try {
    const rate = await getCurrentExchangeRate();
    res.json(rate);
  } catch (err) {
    logger.error({ err }, "Get exchange rate error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/admin/exchange-rate — manual override.
router.post("/admin/exchange-rate", requireSuperAdmin, blockWhileImpersonating, async (req: any, res) => {
  try {
    const rialPerUsd = Number(req.body?.rialPerUsd);
    if (!Number.isFinite(rialPerUsd) || rialPerUsd <= 0) {
      res.status(400).json({ error: "rialPerUsd must be a positive number" });
      return;
    }
    // This field is Rial, not Toman — trusting the label alone let an admin
    // silently enter a colloquial Toman-scale rate (or a value with stray
    // extra zeros), which `priceInRial()` would then use as-is, mispricing
    // every live-USD plan by 10x (or 1/10th). Reject it before it's stored.
    if (!isPlausibleRialPerUsd(rialPerUsd)) {
      res.status(400).json({
        error:
          `rialPerUsd باید بین ${MIN_PLAUSIBLE_RIAL_PER_USD.toLocaleString("fa-IR")} و ` +
          `${MAX_PLAUSIBLE_RIAL_PER_USD.toLocaleString("fa-IR")} باشد. این فیلد ریال است، نه تومان — ` +
          `اگر نرخ را به تومان دارید، در ۱۰ ضرب کنید.`,
        code: "implausible_scale",
      });
      return;
    }
    const rate = await setManualExchangeRate(rialPerUsd, req.userId);
    logger.info({ userId: req.userId, rialPerUsd }, "exchange rate manually overridden");
    res.json(rate);
  } catch (err) {
    logger.error({ err }, "Set exchange rate error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
