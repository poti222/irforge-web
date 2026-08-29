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
    const rate = await setManualExchangeRate(rialPerUsd, req.userId);
    logger.info({ userId: req.userId, rialPerUsd }, "exchange rate manually overridden");
    res.json(rate);
  } catch (err) {
    logger.error({ err }, "Set exchange rate error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
