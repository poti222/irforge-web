/**
 * routes/cutoverFlags.ts — IRFORGE_POSTGRES_PRIMARY_SHEETS_BACKUP_PROMPT فاز ۱.
 *
 * دکمه‌ی سوپرادمین به‌جایِ SQLِ دستی: تا امروز، فعال‌کردنِ یک entity روی
 * Postgres یعنی کسی مستقیم می‌رفت Railway/psql و ردیفِ `entity_cutover_flags`
 * را دستی UPDATE می‌کرد — بدونِ گیت دسترسی، بدونِ لاگ، بدونِ ردِ پا. این فایل
 * همان کار را از پشتِ همان گیتِ نقشی‌یی که «Sheet Pool»/«Pending Payments» را
 * محافظت می‌کند (`requireSuperAdmin`) انجام می‌دهد، هر تغییر را در
 * `admin_audit_log` ثبت می‌کند (`writeAudit`)، و مقدارِ `enabled` را جز
 * `true`/`false` قبول نمی‌کند.
 *
 * فقط پرچمِ **سراسری** (tenant_id IS NULL) — override تک‌تننتی (کاناری) از
 * قبل با `/cutovercanary`ی خودِ بات پوشش داده شده و عمداً اینجا تکرار نشده.
 */
import { Router } from "express";
import { requireSuperAdmin } from "./auth.js";
import { cutoverAdminSummary, setEntityUseDb } from "../lib/botConfig.js";
import { isKnownCutoverEntity } from "../lib/cutoverEntities.js";
import { writeAudit } from "../lib/audit.js";
import { logger } from "../lib/logger";

const router = Router();

router.get("/superadmin/cutover-flags", requireSuperAdmin, async (_req, res) => {
  try {
    const rows = await cutoverAdminSummary();
    res.json(rows);
  } catch (err) {
    logger.error({ err }, "GET /superadmin/cutover-flags failed");
    res.status(500).json({ error: "خواندنِ فهرستِ cutover flags ممکن نشد." });
  }
});

router.patch("/superadmin/cutover-flags/:entity", requireSuperAdmin, async (req: any, res) => {
  const { entity } = req.params;
  const { enabled } = req.body ?? {};

  if (!isKnownCutoverEntity(entity)) {
    res.status(404).json({ error: `entity ناشناخته: «${entity}»` });
    return;
  }
  if (typeof enabled !== "boolean") {
    res.status(400).json({ error: "بدنه باید { enabled: boolean } باشد." });
    return;
  }

  try {
    await setEntityUseDb(entity, enabled);
    await writeAudit({
      actorUserId: req.userId,
      action: "cutover_flag_changed",
      metadata: { entity, enabled },
    });
    const rows = await cutoverAdminSummary();
    const row = rows.find((r) => r.entity === entity) ?? null;
    res.json(row);
  } catch (err) {
    logger.error({ err, entity, enabled }, "PATCH /superadmin/cutover-flags/:entity failed");
    res.status(500).json({ error: "تغییرِ cutover flag ممکن نشد." });
  }
});

export default router;
