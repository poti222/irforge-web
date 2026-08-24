/**
 * src/lib/auditLog.ts — IRFORGE_PROMPT_V3 Phase 29
 *
 * The super-admin audit tab (admin-user-detail.tsx) already receives every
 * action's `metadata` from GET /api/superadmin/users/:id/audit -- the backend
 * (api-server/src/lib/audit.ts) captures real detail per action (which
 * identity fields changed, the role's before/after, how many sessions were
 * revoked, the previous Telegram username, an impersonation's expiry, ...).
 * None of it ever reached the screen: the tab rendered only the raw action
 * enum ("role_changed") and the free-text reason, discarding `metadata`
 * entirely. A super admin reviewing a report of "someone changed my role"
 * saw a badge that said `role_changed` and nothing else -- not even what it
 * changed to.
 *
 * This is the missing translation layer: a human label for the action, and
 * a one-line rendering of its metadata, both bilingual (fa/en) to match the
 * rest of the page.
 */

export type AuditAction =
  | "telegram_reset"
  | "password_set"
  | "identity_updated"
  | "role_changed"
  | "status_changed"
  | "sessions_revoked"
  | "impersonation_started"
  | "bot_purged"
  | "ticket_created_notified"
  | "ticket_escalated_notified";

const ACTION_LABELS: Record<AuditAction, { fa: string; en: string }> = {
  telegram_reset:          { fa: "قطع اتصال تلگرام",        en: "Telegram unlinked" },
  password_set:            { fa: "تغییر رمز عبور",          en: "Password changed" },
  identity_updated:        { fa: "ویرایش اطلاعات هویتی",    en: "Identity updated" },
  role_changed:            { fa: "تغییر نقش",                en: "Role changed" },
  status_changed:          { fa: "تغییر وضعیت حساب",         en: "Status changed" },
  sessions_revoked:        { fa: "باطل‌شدن نشست‌ها",          en: "Sessions revoked" },
  impersonation_started:   { fa: "شروع جعل هویت",            en: "Impersonation started" },
  bot_purged:              { fa: "حذف کامل بات",             en: "Bot purged" },
  ticket_created_notified: { fa: "اطلاع‌رسانی تیکت جدید",    en: "New ticket notified" },
  ticket_escalated_notified: { fa: "اطلاع‌رسانی تیکت فوری",  en: "Escalated ticket notified" },
};

const FIELD_LABELS: Record<string, { fa: string; en: string }> = {
  name:  { fa: "نام",     en: "name" },
  email: { fa: "ایمیل",   en: "email" },
  phone: { fa: "شماره",   en: "phone" },
};

/** Unknown/legacy action values fall back to the raw string rather than
 * throwing -- the log must never break just because a new action shipped
 * on the backend before this file's label table caught up. */
export function auditActionLabel(action: string, fa: boolean): string {
  const known = ACTION_LABELS[action as AuditAction];
  if (known) return fa ? known.fa : known.en;
  return action;
}

function fieldLabel(field: string, fa: boolean): string {
  const known = FIELD_LABELS[field];
  return known ? (fa ? known.fa : known.en) : field;
}

function formatDateTime(value: string, fa: boolean): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString(fa ? "fa-IR" : "en-US");
}

/**
 * Renders `metadata` (the shape depends on `action` -- see api-server's
 * writeAudit() call sites) as one human-readable line. Returns null when
 * there is nothing worth adding beyond the action label itself, so the
 * caller can skip an empty detail line instead of showing a blank one.
 */
export function describeAuditDetail(
  action: string,
  metadata: Record<string, unknown> | null | undefined,
  fa: boolean,
): string | null {
  const m = metadata ?? {};

  switch (action as AuditAction) {
    case "identity_updated": {
      const fields = Array.isArray(m.fields) ? (m.fields as string[]) : [];
      if (fields.length === 0) return null;
      const list = fields.map((f) => fieldLabel(f, fa)).join(fa ? "، " : ", ");
      return fa ? `فیلدهای تغییریافته: ${list}` : `Changed fields: ${list}`;
    }

    case "role_changed": {
      const from = typeof m.from === "string" ? m.from : null;
      const to = typeof m.to === "string" ? m.to : null;
      if (!to) return null;
      return from
        ? fa ? `از «${from}» به «${to}»` : `From "${from}" to "${to}"`
        : fa ? `نقش جدید: «${to}»` : `New role: "${to}"`;
    }

    case "status_changed": {
      const from = typeof m.from === "string" ? m.from : null;
      const to = typeof m.to === "string" ? m.to : null;
      if (!to) return null;
      return from
        ? fa ? `از «${from}» به «${to}»` : `From "${from}" to "${to}"`
        : fa ? `وضعیتِ جدید: «${to}»` : `New status: "${to}"`;
    }

    case "password_set": {
      const n = typeof m.sessionsRevoked === "number" ? m.sessionsRevoked : null;
      if (n === null) return null;
      return fa ? `${n} نشست باطل شد` : `${n} session${n === 1 ? "" : "s"} revoked`;
    }

    case "sessions_revoked": {
      const n = typeof m.count === "number" ? m.count : null;
      if (n === null) return null;
      return fa ? `${n} نشست باطل شد` : `${n} session${n === 1 ? "" : "s"} revoked`;
    }

    case "telegram_reset": {
      const prev = typeof m.previousTelegramUsername === "string" ? m.previousTelegramUsername : null;
      if (!prev) return null;
      return fa ? `یوزرنیمِ قبلی: @${prev}` : `Previous username: @${prev}`;
    }

    case "impersonation_started": {
      const expiresAt = typeof m.expiresAt === "string" ? m.expiresAt : null;
      if (!expiresAt) return null;
      const when = formatDateTime(expiresAt, fa);
      return fa ? `تا ${when} معتبر است` : `Valid until ${when}`;
    }

    case "bot_purged": {
      const name = typeof m.botName === "string" ? m.botName : null;
      if (!name) return null;
      return fa ? `بات: ${name}` : `Bot: ${name}`;
    }

    case "ticket_created_notified":
    case "ticket_escalated_notified": {
      const ticketId = m.ticketId != null ? String(m.ticketId) : null;
      if (!ticketId) return null;
      return fa ? `تیکت #${ticketId}` : `Ticket #${ticketId}`;
    }

    default:
      return null;
  }
}
