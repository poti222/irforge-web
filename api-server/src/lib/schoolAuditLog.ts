/**
 * lib/schoolAuditLog.ts — بخش "/schools" فاز ۹ (بندِ ۳): نوشتنِ یک ردیف در
 * school_audit_log. best-effort و **هرگز throw نمی‌کند** — دقیقاً همان
 * قراردادِ notifySchoolUsers در schoolNotify.ts: لاگ‌نشدنِ یک رخداد نباید
 * خودِ عملیاتِ اصلی (تغییرِ نقش، حذفِ عضو، صدورِ اخطار، …) را با خطا مواجه کند.
 */
import crypto from "crypto";
import { db, schoolAuditLogTable } from "@workspace/db";
import { logger } from "./logger";

export async function logSchoolAudit(
  schoolId: string,
  actorUserId: string,
  action: string,
  targetDescription: string,
): Promise<void> {
  try {
    await db.insert(schoolAuditLogTable).values({
      id: crypto.randomUUID(),
      schoolId,
      actorUserId,
      action,
      targetDescription,
    });
  } catch (err) {
    logger.warn({ err, schoolId, action }, "logSchoolAudit: insert failed (non-fatal)");
  }
}
