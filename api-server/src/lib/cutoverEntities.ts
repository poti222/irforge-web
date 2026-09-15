/**
 * lib/cutoverEntities.ts — IRFORGE_POSTGRES_PRIMARY_SHEETS_BACKUP_PROMPT فاز ۱.
 *
 * فهرستِ کاملِ همه‌یِ entityهایی که از طریقِ `_TenantDBProxy`/`plugin_db()` روی
 * mainbot's `utils/db.py`/`utils/object_engine.py` ثبت شده‌اند و بنابراین
 * `is_db_enabled()`/`entity_cutover_flags`ی یکسان را چک می‌کنند — نه لیستِ
 * `required_sheets`ی هر پلاگین، که موقعِ استخراج معلوم شد با کدِ واقعی
 * (مثلاً `loyalty`: manifest می‌گوید `loyalty_accounts`/`loyalty_events`، ولی
 * کدِ واقعی `plugin_db("loyalty_state")`/`plugin_db("loyalty_tiers")`/
 * `plugin_db("loyalty_point_actions")` می‌سازد) دیگر همخوان نیست. این فهرست
 * مستقیماً با یک grep روی هر `_TenantDBProxy("...")` و `plugin_db("...")`ی
 * واقعیِ ریپوی irforge-app استخراج شده (نه از manifest).
 *
 * ⚠️ این drift خودش دقیقاً همان چیزی‌ست که فازِ ۲ی همین پرامپت باید کاملاً
 * حسابرسی کند — این فهرست فعلاً برایِ نمایشِ فازِ ۱ کافی‌ست (فقط سه‌تای
 * bot_settings/custom_commands/events واقعاً در فازِ ۱ فعال می‌شوند)، ولی اگر
 * کدِ irforge-app عوض شد، این فهرست هم باید دستی به‌روز شود تا زمانی که فازِ ۲
 * یک منبعِ حقیقتِ خودکار (مثلاً یک اندپوینتِ تشخیصی از خودِ بات) برایش بسازد.
 */
export const CUTOVER_ENTITIES: readonly string[] = [
  "account_links",
  "addresses",
  "admin_actions",
  "admin_notifications",
  "admin_sessions",
  "admins",
  "ai_assist_config",
  "ai_assist_usage",
  "analytics_daily",
  "analytics_metadata",
  "audit_log",
  "automation_rules",
  "bot_settings",
  "buttons",
  "capability_grants",
  "catalog_categories",
  "catalog_fulfillments",
  "catalog_item_options",
  "catalog_items",
  "connector_configs",
  "custom_commands",
  "discounts",
  "events",
  "feature_access",
  "feedback_entries",
  "files_library",
  "forms",
  "formspro_forms",
  "formspro_submissions",
  "group_tools_groups",
  "group_tools_warnings",
  "inventory_items",
  "inventory_movements",
  "invoice_counters",
  "invoices",
  "languages",
  "loyalty_point_actions",
  "loyalty_state",
  "loyalty_tiers",
  "memberships",
  "notification_types",
  "object_attachments",
  "object_audit",
  "object_history",
  "object_relations",
  "object_schemas",
  "object_tags",
  "object_views",
  "panels",
  "password_attempts",
  "payments",
  "plan_features",
  "plan_tiers",
  "plugin_admin_actions",
  "plugin_events",
  "plugin_object_extensions",
  "plugin_panel_blocks",
  "plugin_workflow_actions",
  "referral_codes",
  "referral_events",
  "referrals",
  "relation_definitions",
  "relation_links",
  "reports",
  "roles",
  "scheduled_notifications",
  "security_events",
  "subscription_plans",
  "tenant_subscriptions",
  "text_keys",
  "text_values",
  "themes",
  "ticket_messages",
  "tickets",
  "transactions",
  "user_notification_prefs",
  "users",
  "waitlist_entries",
  "wallet",
  "wallets",
  "wishlist_items",
  "workflow_runs",
  "workflows",
];

const CUTOVER_ENTITY_SET = new Set(CUTOVER_ENTITIES);

export function isKnownCutoverEntity(entity: string): boolean {
  return CUTOVER_ENTITY_SET.has(entity);
}
