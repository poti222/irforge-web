/**
 * lib/audit.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * نوشتن در `admin_audit_log`.
 *
 * هر اقدام حساسِ ادمین روی حساب یک کاربر دیگر باید از اینجا رد شود: ریست
 * تلگرام، تغییر رمز، تغییر نقش، جعل هویت. بدون این، هر ادعای «ادمین سفارش من
 * را عوض کرد» بی‌پاسخ می‌ماند.
 *
 * مثل `notify.ts`، این تابع **هرگز throw نمی‌کند** — شکست در نوشتن لاگ نباید
 * خودِ اقدام را با خطا مواجه کند؛ فقط warn می‌شود.
 */
import crypto from "crypto";
import { db, adminAuditLogTable } from "@workspace/db";
import { logger } from "./logger";

export type AuditAction =
  | "telegram_reset"
  | "password_set"
  | "identity_updated"
  | "role_changed"
  | "status_changed"
  | "sessions_revoked"
  | "impersonation_started"
  | "bot_purged"
  // IRFORGE_PROMPT_V3 Phase 16 — mainbot's ticket-created/escalated call.
  | "ticket_created_notified"
  | "ticket_escalated_notified"
  // IRFORGE_PROMPT_V3 Phase 36 — super admin directly adjusting a user's
  // account-level plan or wallet balance (routes/superAdminUsers.ts).
  | "plan_changed"
  | "wallet_adjusted";

export async function writeAudit(input: {
  actorUserId: string;
  action: AuditAction;
  targetUserId?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    await db.insert(adminAuditLogTable).values({
      id: crypto.randomUUID(),
      actorUserId: input.actorUserId,
      action: input.action,
      targetUserId: input.targetUserId ?? null,
      reason: input.reason ?? null,
      // ⚠️ هرگز رمز، هش رمز یا کد یک‌بارمصرف داخل metadata نگذارید.
      metadata: input.metadata ?? null,
    });
  } catch (err) {
    logger.warn({ err, action: input.action }, "writeAudit failed (non-fatal)");
  }
}
