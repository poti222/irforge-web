/**
 * lib/walletStore.ts — IRFORGE_PROMPT_V3 Phase 24
 * ─────────────────────────────────────────────────────────────────────────────
 * Website-side data layer for the bot's per-owner `wallet` plugin — balance
 * lookup, admin credit/debit, freeze/unfreeze, and charge/refund against an
 * order, mirroring `plugins/wallet/{domain,service,ledger,order_integration}.py`
 * field-for-field. Before this, every one of these was Telegram-command-only
 * (`/wallet_of`, `/wallet_credit`, `/wallet_debit`, `/wallet_freeze`,
 * `/wallet_unfreeze`, `/wallet_charge_order`, `/wallet_refund_order`) — an
 * admin who does everything else from the website had to switch to Telegram
 * for this one plugin.
 *
 * ── Correctness: the lock ──────────────────────────────────────────────────
 * Google Sheets has no atomic conditional write. `service.py`'s `_apply()`
 * (Phase 18.0.4) wraps every balance mutation in a `pg_advisory_lock` keyed
 * by wallet id so two concurrent movements on the same wallet can't race on
 * `balance` (read-then-write with no lock used to silently drop one side).
 * Every mutating function below takes the *same* lock, on the *same*
 * Postgres database, with the *same* key derivation
 * (`lib/botAdvisoryLock.ts`) — so a website credit and a bot-side debit on
 * the same wallet genuinely serialize, not just each side serializing with
 * itself. `freeze`/`unfreeze` take the lock here even though the bot's own
 * versions don't (status flips aren't arithmetic, so the bot accepts a
 * redundant-write race there) — locking is strictly safer and costs nothing.
 *
 * ── Scope ───────────────────────────────────────────────────────────────────
 * All admin actions target `owner_type="user"` wallets only, exactly like
 * every bot-side command in `admin_actions.py`/`order_integration.py` — the
 * wallet plugin supports other owner types in principle, but nothing
 * anywhere (bot or website) has ever exposed an admin action for one.
 *
 * Notification-template settings (`wallet_notify_cfg`) are fully readable/
 * editable here, and a website-initiated credit/debit/freeze/unfreeze does
 * send the configured user-facing receipt (best-effort, via the route layer
 * — see `routes/botWallet.ts`), reusing the bot's own template strings and
 * `{placeholder}` substitution. The bot's *admin/group/channel* log fan-out
 * (`_send_admin_log`, which also re-derives "every admin with a wallet
 * permission" from the `admins` sheet) is deliberately NOT reimplemented
 * here — it only ever fires for actions that go through the bot's own
 * event engine, which a website-initiated mutation never touches. This is a
 * scope reduction, not an oversight: the settings editor still lets an
 * admin manage those templates for when the *bot* fires them.
 */
import { getEntity, putEntity, listEntity, BotConfigError } from "./botConfig.js";
import { newRecordId } from "./pluginCollections.js";
import { advisoryLock } from "./botAdvisoryLock.js";

const WALLET_TAB = "wallet";
const TRANSACTIONS_TAB = "transactions";
const PAYMENTS_TAB = "payments";
const SETTINGS_TAB = "bot_settings";
const NOTIFY_SETTINGS_KEY = "wallet_notify_cfg";

export const OWNER_TYPE_USER = "user";
export const DEFAULT_CURRENCY = "IRT";

export const STATUS_ACTIVE = "active";
export const STATUS_FROZEN = "frozen";
export const STATUS_CLOSED = "closed";

export interface WalletRecord {
  id: string;
  owner_type: string;
  owner_id: string;
  currency: string;
  balance: number;
  status: string;
  created_at?: string;
  updated_at?: string;
}

export interface LedgerEntry {
  id: string;
  wallet_id: string;
  action: string;
  amount_before: number;
  amount_changed: number;
  amount_after: number;
  reason: string;
  actor: string;
  reference_type: string;
  reference_id: string;
  meta: Record<string, unknown>;
  at: string;
}

interface Order {
  order_id: string;
  user_id?: string;
  wallet_ledger_entry?: string;
  wallet_refund_entry?: string;
  [key: string]: unknown;
}

export interface WalletTemplates {
  credit: string;
  debit: string;
  freeze: string;
  unfreeze: string;
  admin_log: string;
}

export interface WalletNotifySettings {
  user_notify_enabled: boolean;
  admin_notify_enabled: boolean;
  log_targets: string[];
  templates: WalletTemplates;
}

/** آینه‌ی `plugins/wallet/notifications.py::DEFAULT_TEMPLATES`. */
export const DEFAULT_TEMPLATES: WalletTemplates = {
  credit: "💰 واریز به کیف پول\n\nمبلغ: {sign}{amount} {currency}\nموجودی جدید: {after} {currency}\nعلت: {reason}\n🕐 {at}",
  debit: "💸 برداشت از کیف پول\n\nمبلغ: {sign}{amount} {currency}\nموجودی جدید: {after} {currency}\nعلت: {reason}\n🕐 {at}",
  freeze: "🧊 کیف پول شما مسدود شد.\nعلت: {reason}",
  unfreeze: "🟢 کیف پول شما فعال شد.\nعلت: {reason}",
  admin_log:
    "🏦 رویداد کیف پول\n\nصاحب: {owner_type}:{owner_id}\nنوع: {action}\nمبلغ: {sign}{amount} {currency}\n" +
    "قبل: {before} | بعد: {after}\nعلت: {reason}\nعامل: {actor}\nمرجع: {reference_type}:{reference_id}\n🕐 {at}",
};

/** آینه‌ی `plugins/wallet/notifications.py::_ACTION_TO_TEMPLATE`. */
const ACTION_TO_TEMPLATE: Record<string, keyof WalletTemplates> = {
  admin_credit: "credit",
  payment_credit: "credit",
  credit: "credit",
  admin_debit: "debit",
  purchase_debit: "debit",
  usage_debit: "debit",
  debit: "debit",
};

export const DEFAULT_NOTIFY_SETTINGS: WalletNotifySettings = {
  user_notify_enabled: true,
  admin_notify_enabled: false,
  log_targets: [],
  templates: { ...DEFAULT_TEMPLATES },
};

// ─── errors ──────────────────────────────────────────────────────────────────

function bad(message: string, code?: string): BotConfigError {
  return new BotConfigError(400, message, code);
}

// ─── wallet id / read helpers ────────────────────────────────────────────────

/** آینه‌ی `plugins/wallet/domain.py::wallet_id_for`. */
export function walletIdFor(ownerType: string, ownerId: string, currency: string = DEFAULT_CURRENCY): string {
  return `${ownerType}:${ownerId}:${currency}`.toLowerCase();
}

/** آینه‌ی `plugins/wallet/domain.py::get_or_create_wallet` — idempotent، بدون لاک (race احتمالی بی‌ضرر است: هر دو نوشتن، همان ولت صفرمانده‌ی اولیه است). */
export async function getOrCreateWallet(
  spreadsheetId: string,
  ownerType: string,
  ownerId: string,
  currency: string = DEFAULT_CURRENCY,
): Promise<WalletRecord> {
  const id = walletIdFor(ownerType, ownerId, currency);
  const existing = await getEntity<WalletRecord>(spreadsheetId, WALLET_TAB, id);
  if (existing) return existing;
  const now = new Date().toISOString();
  const wallet: WalletRecord = {
    id, owner_type: ownerType, owner_id: String(ownerId), currency,
    balance: 0, status: STATUS_ACTIVE, created_at: now, updated_at: now,
  };
  await putEntity(spreadsheetId, WALLET_TAB, id, wallet);
  return wallet;
}

async function saveWallet(spreadsheetId: string, wallet: WalletRecord): Promise<void> {
  wallet.updated_at = new Date().toISOString();
  await putEntity(spreadsheetId, WALLET_TAB, wallet.id, wallet);
}

/** آینه‌ی `plugins/wallet/ledger.py::list_entries`، به‌جز ترتیب: اینجا جدیدترین اول برمی‌گردد (نمایش وب). */
export async function listTransactions(
  spreadsheetId: string,
  walletId: string,
  limit = 50,
): Promise<LedgerEntry[]> {
  const rows = await listEntity<LedgerEntry>(spreadsheetId, TRANSACTIONS_TAB);
  const entries = rows
    .filter((r) => r.value && typeof r.value === "object" && (r.value as LedgerEntry).wallet_id === walletId)
    .map((r) => r.value as LedgerEntry)
    .sort((a, b) => (a.at || "").localeCompare(b.at || ""));
  const tail = limit ? entries.slice(-limit) : entries;
  return tail.reverse();
}

async function recordEntry(
  spreadsheetId: string,
  walletId: string,
  before: number,
  changed: number,
  after: number,
  reason: string,
  actor: string,
  opts: { action: string; referenceType?: string; referenceId?: string; meta?: Record<string, unknown> },
): Promise<LedgerEntry> {
  const id = newRecordId("txn");
  const entry: LedgerEntry = {
    id, wallet_id: walletId, action: opts.action,
    amount_before: Math.round(before * 100) / 100,
    amount_changed: Math.round(changed * 100) / 100,
    amount_after: Math.round(after * 100) / 100,
    reason: reason || "", actor: String(actor || ""),
    reference_type: opts.referenceType || "", reference_id: String(opts.referenceId || ""),
    meta: opts.meta || {}, at: new Date().toISOString(),
  };
  await putEntity(spreadsheetId, TRANSACTIONS_TAB, id, entry);
  return entry;
}

// ─── the locked engine (mirrors service.py::_apply) ─────────────────────────

async function applyDelta(
  spreadsheetId: string,
  ownerType: string,
  ownerId: string,
  delta: number,
  reason: string,
  actor: string,
  opts: { action: string; currency?: string; referenceType?: string; referenceId?: string },
): Promise<{ wallet: WalletRecord; entry: LedgerEntry }> {
  const currency = opts.currency || DEFAULT_CURRENCY;
  const walletId = walletIdFor(ownerType, ownerId, currency);
  return advisoryLock.withLock(`wallet:apply:${walletId}`, async () => {
    const wallet = await getOrCreateWallet(spreadsheetId, ownerType, ownerId, currency);
    if (wallet.status === STATUS_FROZEN) throw bad(`کیف‌پول '${wallet.id}' مسدود است — تغییر موجودی مجاز نیست.`, "wallet_frozen");
    if (wallet.status === STATUS_CLOSED) throw bad(`کیف‌پول '${wallet.id}' بسته شده است.`, "wallet_closed");

    const before = wallet.balance || 0;
    const after = Math.round((before + delta) * 100) / 100;
    if (after < 0) throw bad(`موجودی کیف‌پول '${wallet.id}' (${before}) برای تغییر ${delta} کافی نیست.`, "insufficient_balance");

    wallet.balance = after;
    await saveWallet(spreadsheetId, wallet);
    const entry = await recordEntry(spreadsheetId, wallet.id, before, delta, after, reason, actor, opts);
    return { wallet, entry };
  });
}

// ─── manual admin actions (mirrors service.py::admin_credit/admin_debit) ────

export async function adminCredit(
  spreadsheetId: string, userId: string, amount: number, reason: string, actor: string,
): Promise<{ wallet: WalletRecord; entry: LedgerEntry }> {
  if (!(amount > 0)) throw bad("مبلغ واریز باید بزرگ‌تر از صفر باشد.", "bad_amount");
  return applyDelta(spreadsheetId, OWNER_TYPE_USER, userId, amount, reason, actor, {
    action: "admin_credit", referenceType: "manual", referenceId: actor,
  });
}

export async function adminDebit(
  spreadsheetId: string, userId: string, amount: number, reason: string, actor: string,
): Promise<{ wallet: WalletRecord; entry: LedgerEntry }> {
  if (!(amount > 0)) throw bad("مبلغ برداشت باید بزرگ‌تر از صفر باشد.", "bad_amount");
  return applyDelta(spreadsheetId, OWNER_TYPE_USER, userId, -amount, reason, actor, {
    action: "admin_debit", referenceType: "manual", referenceId: actor,
  });
}

// ─── freeze / unfreeze (mirrors service.py::freeze/unfreeze, but locked) ────

export async function freezeWallet(
  spreadsheetId: string, userId: string, actor: string, reason = "",
): Promise<WalletRecord> {
  const walletId = walletIdFor(OWNER_TYPE_USER, userId, DEFAULT_CURRENCY);
  return advisoryLock.withLock(`wallet:apply:${walletId}`, async () => {
    const wallet = await getOrCreateWallet(spreadsheetId, OWNER_TYPE_USER, userId, DEFAULT_CURRENCY);
    if (wallet.status === STATUS_FROZEN) return wallet;
    wallet.status = STATUS_FROZEN;
    await saveWallet(spreadsheetId, wallet);
    await recordEntry(spreadsheetId, wallet.id, wallet.balance, 0, wallet.balance,
      reason || "wallet frozen by admin", actor, { action: "freeze" });
    return wallet;
  });
}

export async function unfreezeWallet(
  spreadsheetId: string, userId: string, actor: string, reason = "",
): Promise<WalletRecord> {
  const walletId = walletIdFor(OWNER_TYPE_USER, userId, DEFAULT_CURRENCY);
  return advisoryLock.withLock(`wallet:apply:${walletId}`, async () => {
    const wallet = await getOrCreateWallet(spreadsheetId, OWNER_TYPE_USER, userId, DEFAULT_CURRENCY);
    if (wallet.status !== STATUS_FROZEN) return wallet;
    wallet.status = STATUS_ACTIVE;
    await saveWallet(spreadsheetId, wallet);
    await recordEntry(spreadsheetId, wallet.id, wallet.balance, 0, wallet.balance,
      reason || "wallet unfrozen by admin", actor, { action: "unfreeze" });
    return wallet;
  });
}

// ─── charge / refund an order (mirrors order_integration.py) ───────────────

async function loadOrder(spreadsheetId: string, orderCode: string): Promise<Order | null> {
  const trimmed = orderCode.trim();
  return (
    (await getEntity<Order>(spreadsheetId, PAYMENTS_TAB, trimmed.toUpperCase())) ||
    (await getEntity<Order>(spreadsheetId, PAYMENTS_TAB, trimmed))
  );
}

export async function chargeOrder(
  spreadsheetId: string, orderCode: string, amount: number, reason: string, actor: string,
): Promise<{ wallet: WalletRecord; entry: LedgerEntry; order: Order }> {
  if (!(amount > 0)) throw bad("مبلغ باید بزرگ‌تر از صفر باشد.", "bad_amount");
  const order = await loadOrder(spreadsheetId, orderCode);
  if (!order || !order.user_id) throw new BotConfigError(404, "سفارش پیدا نشد یا مالک نامشخص است.", "order_not_found");

  const { wallet, entry } = await applyDelta(spreadsheetId, OWNER_TYPE_USER, String(order.user_id), -amount,
    reason || `charge for order ${orderCode}`, actor,
    { action: "purchase_debit", referenceType: "order", referenceId: orderCode });

  const nextOrder: Order = { ...order, wallet_ledger_entry: entry.id };
  await putEntity(spreadsheetId, PAYMENTS_TAB, String(order.order_id ?? orderCode), nextOrder);
  return { wallet, entry, order: nextOrder };
}

export async function refundOrder(
  spreadsheetId: string, orderCode: string, amount: number, reason: string, actor: string,
): Promise<{ wallet: WalletRecord; entry: LedgerEntry; order: Order }> {
  if (!(amount > 0)) throw bad("مبلغ باید بزرگ‌تر از صفر باشد.", "bad_amount");
  const order = await loadOrder(spreadsheetId, orderCode);
  if (!order || !order.user_id) throw new BotConfigError(404, "سفارش پیدا نشد یا مالک نامشخص است.", "order_not_found");

  // service.credit(...) بات هم اینجا اکشن "credit" عمومی می‌نویسد، نه "admin_credit".
  const { wallet, entry } = await applyDelta(spreadsheetId, OWNER_TYPE_USER, String(order.user_id), amount,
    reason || `refund for order ${orderCode}`, actor,
    { action: "credit", referenceType: "order_refund", referenceId: orderCode });

  const nextOrder: Order = { ...order, wallet_refund_entry: entry.id };
  await putEntity(spreadsheetId, PAYMENTS_TAB, String(order.order_id ?? orderCode), nextOrder);
  return { wallet, entry, order: nextOrder };
}

// ─── notify settings (bot_settings / wallet_notify_cfg) ─────────────────────

export async function getWalletNotifySettings(spreadsheetId: string): Promise<WalletNotifySettings> {
  try {
    const raw = await getEntity<Partial<WalletNotifySettings>>(spreadsheetId, SETTINGS_TAB, NOTIFY_SETTINGS_KEY);
    if (!raw || typeof raw !== "object") return { ...DEFAULT_NOTIFY_SETTINGS, templates: { ...DEFAULT_TEMPLATES } };
    return {
      user_notify_enabled: raw.user_notify_enabled !== false,
      admin_notify_enabled: raw.admin_notify_enabled === true,
      log_targets: Array.isArray(raw.log_targets) ? raw.log_targets.map(String) : [],
      templates: { ...DEFAULT_TEMPLATES, ...(raw.templates || {}) },
    };
  } catch {
    return { ...DEFAULT_NOTIFY_SETTINGS, templates: { ...DEFAULT_TEMPLATES } };
  }
}

export async function setWalletNotifySettings(
  spreadsheetId: string, input: unknown,
): Promise<WalletNotifySettings> {
  const raw = (input && typeof input === "object" ? input : {}) as Partial<WalletNotifySettings>;
  const merged: WalletNotifySettings = {
    user_notify_enabled: raw.user_notify_enabled !== false,
    admin_notify_enabled: raw.admin_notify_enabled === true,
    log_targets: Array.isArray(raw.log_targets) ? raw.log_targets.map((v) => String(v).trim()).filter(Boolean) : [],
    templates: { ...DEFAULT_TEMPLATES, ...(raw.templates && typeof raw.templates === "object" ? raw.templates : {}) },
  };
  await putEntity(spreadsheetId, SETTINGS_TAB, NOTIFY_SETTINGS_KEY, merged);
  return merged;
}

// ─── receipt formatting (mirrors notifications.py::_fmt_template/_context_for) ─

/** آینه‌ی `notifications.py::_fmt_amount`. */
function fmtAmount(amount: number): string {
  let s = amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  return s;
}

/** آینه‌ی `notifications.py::_fmt_template` — جایگذاری امنِ `{key}`، کلید ناشناخته دست‌نخورده می‌ماند. */
export function formatWalletTemplate(template: string, ctx: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key) => (key in ctx ? String(ctx[key]) : whole));
}

/** آینه‌ی `notifications.py::_context_for`. */
function contextFor(wallet: WalletRecord, entry: LedgerEntry | null): Record<string, unknown> {
  const changed = entry?.amount_changed ?? 0;
  return {
    owner_type: wallet.owner_type, owner_id: wallet.owner_id, currency: wallet.currency, status: wallet.status,
    action: entry?.action ?? "",
    amount: fmtAmount(Math.abs(changed)),
    sign: changed > 0 ? "+" : changed < 0 ? "-" : "",
    before: fmtAmount(entry?.amount_before ?? wallet.balance),
    after: fmtAmount(entry?.amount_after ?? wallet.balance),
    reason: entry?.reason || "-",
    actor: entry?.actor ?? "",
    reference_type: entry?.reference_type ?? "",
    reference_id: entry?.reference_id ?? "",
    at: entry?.at ?? "",
    entry_id: entry?.id ?? "",
  };
}

/**
 * متن رسیدِ کاربر برای یک تراکنش (credit/debit) یا رویداد وضعیت
 * (freeze/unfreeze، با entry=null) — یا null اگر تنظیمات فعلاً غیرفعالش کرده
 * یا برای این اکشن قالبی تعریف نشده (`_ACTION_TO_TEMPLATE`، مثل freeze/unfreeze
 * که مستقیم با tmplKey صدا زده می‌شوند).
 */
export function buildUserReceiptText(
  wallet: WalletRecord, entry: LedgerEntry | null, settings: WalletNotifySettings, tmplKey?: keyof WalletTemplates,
): string | null {
  if (!settings.user_notify_enabled || wallet.owner_type !== OWNER_TYPE_USER) return null;
  const key = tmplKey ?? (entry ? ACTION_TO_TEMPLATE[entry.action] : undefined);
  if (!key) return null;
  return formatWalletTemplate(settings.templates[key], contextFor(wallet, entry));
}
