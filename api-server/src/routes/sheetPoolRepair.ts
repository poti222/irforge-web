/**
 * routes/sheetPoolRepair.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * دکمه‌ی «بررسی و تعمیر همه» در صفحه‌ی Sheet Pool (فقط سوپرادمین).
 *
 *   POST /api/sheet-pool/repair   { apply?: boolean }  → کار را در پس‌زمینه شروع می‌کند
 *   GET  /api/sheet-pool/repair                       → وضعیت/پیشرفت + آخرین گزارش
 *
 * بدون `apply: true` فقط پیش‌نمایش (dry-run) است و هیچ چیز را تغییر نمی‌دهد.
 * کار در حافظه‌ی همین پروسه اجرا می‌شود (یک ریپلیکا)، چون تست صدها شیت از
 * محدوده‌ی زمانیِ یک درخواست HTTP بیشتر می‌شود؛ همزمانیِ دو اجرا بسته است.
 */
import { Router } from "express";
import { requireSuperAdmin } from "./auth.js";
import { logger } from "../lib/logger.js";
import { writeAudit } from "../lib/audit.js";
import {
  runSheetPoolRepair,
  type RepairMode,
  type RepairProgress,
  type RepairReport,
} from "../lib/sheetPoolRepair.js";

const router = Router();

let running = false;
let progress: RepairProgress = { phase: "idle", done: 0, total: 0 };
let lastReport: RepairReport | null = null;
let lastError: string | null = null;

router.post("/sheet-pool/repair", requireSuperAdmin, async (req: any, res) => {
  if (running) {
    res.status(409).json({ error: "یک بررسی هم‌اکنون در حال اجراست", progress });
    return;
  }
  const mode: RepairMode = req.body?.apply === true ? "apply" : "dry";
  running = true;
  lastError = null;
  progress = { phase: "probing", done: 0, total: 0 };

  const userId: string = req.userId;
  void (async () => {
    try {
      const report = await runSheetPoolRepair(mode, userId, (p) => {
        progress = p;
      });
      lastReport = report;
      progress = { phase: "done", done: progress.total, total: progress.total };
      if (mode === "apply") {
        try {
          await writeAudit({
            actorUserId: userId,
            action: "sheet_pool_repair",
            metadata: {
              sparesRemoved: report.spares.removed,
              botsRepaired: report.bots.repaired,
              botsNoSpare: report.bots.noSpare,
              botsFailed: report.bots.failed,
            },
          });
        } catch (err) {
          logger.warn({ err }, "sheet-pool repair: audit write failed (non-fatal)");
        }
      }
    } catch (err) {
      logger.error({ err }, "sheet-pool repair crashed");
      lastError = (err as Error).message;
      progress = { phase: "error", done: 0, total: 0 };
    } finally {
      running = false;
    }
  })();

  res.status(202).json({ started: true, mode });
});

router.get("/sheet-pool/repair", requireSuperAdmin, (_req, res) => {
  res.json({ running, progress, report: lastReport, error: lastError });
});

export default router;
