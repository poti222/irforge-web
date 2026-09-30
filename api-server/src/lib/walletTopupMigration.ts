/**
 * lib/walletTopupMigration.ts — مهاجرتِ مسیرِ قدیمیِ شارژِ کیف‌پولِ پلتفرم به ماژولِ مشترکِ کارت‌به‌کارت
 * (IRFORGE_CARD_AUTOCONFIRM_PROMPT، فاز ۸).
 *
 * `wallet_topups` → `payment_requests` و `sms_logs` → `sms_inbox` (scope=platform). قواعد:
 *
 *  - **idempotent**: هر ردیفِ مهاجرت‌شده `legacy_ref` («wallet_topups:<id>» / «sms_logs:<id>») یکتا دارد؛ اجرای دوباره
 *    هیچ ردیفی نمی‌سازد. کلِ کار در **یک تراکنش** زیرِ advisory lock است (چندنمونه‌ای امن)؛ `dryRun` همان کار را انجام می‌دهد
 *    و آخرش rollback می‌کند (گزارشِ واقعی بدونِ نوشتن).
 *  - **هیچ اعتباری دوباره داده نمی‌شود**: ردیف‌های `confirmed` با علامتِ «اثر انجام شده» می‌آیند (`effect_done_at`)؛ کیف‌پول
 *    اینجا دست نمی‌خورد. برعکس، اگر تأییدشده‌ای در ledger اثری از شارژش نبود (مسیرِ قدیمی وضعیت را جدا از credit می‌نوشت
 *    و می‌توانست بینِ دو مرحله بمیرد) **خودکار جبران نمی‌شود** — در گزارش (`ledger.confirmedWithoutCredit`) می‌آید تا انسان تصمیم بگیرد.
 *  - **pending‌های در حال پرداخت**: اگر هنوز مهلت دارند pending می‌مانند (همان مبلغِ نهایی، پیامکِ در راه هنوز match می‌شود)؛
 *    مهلت‌گذشته‌ها expired. برخوردِ یکتاییِ مبلغ با یک درخواستِ جدید → آن ردیف expired و در گزارش می‌آید.
 *  - پسوندِ قدیمی (۱۰۰۰..۹۹۹۹ ریال، نه لزوماً مضربِ ۱۰) با قیدِ معافِ legacy (migration 0041) ذخیره می‌شود؛ مبلغِ نهایی عیناً حفظ می‌شود.
 *  - **بدونِ یتیم**: پایانِ کار شمارِ ردیف‌های قدیمیِ بدونِ همتا در جدولِ جدید (`orphans`) گزارش می‌شود؛ `ok` فقط با صفر بودنش true است.
 *    جدول‌های قدیمی حذف نمی‌شوند (آرشیوِ فقط‌خواندنی؛ هیچ کدی دیگر به آن‌ها نمی‌نویسد).
 *  - کانالِ platform اگر نبود از تنظیماتِ قدیمیِ `payment_methods.blubank` ساخته می‌شود (لینکِ باز)، با **secretِ ناشناخته**
 *    (هش‌شده‌ی یک مقدارِ تصادفی که هیچ‌جا نمی‌ماند) — وبهوکِ جدید تا وقتی سوپرادمین «چرخشِ کلید» نزند بی‌مصرف است؛ گوشیِ فعلی از
 *    aliasِ قدیمیِ `/internal/wallet-topup/sms-webhook` کار می‌کند.
 */
import crypto from "crypto";
import { logger } from "./logger";
import { generateSmsSecret, hashSmsSecret } from "./smsChannelSecret";
import { logPaymentEvent } from "./paymentEvents";
import type { ClientLike, PoolLike } from "./paymentRequests";

export const TOPUP_LEGACY_PREFIX = "wallet_topups:";
export const SMS_LEGACY_PREFIX = "sms_logs:";
const MIN_AMOUNT_RIAL = 1_000_000; // ۱۰۰٬۰۰۰ تومان
const MAX_LISTED = 200;

export interface MigrationReport {
  startedAt: string;
  finishedAt: string;
  dryRun: boolean;
  skipped?: "no_legacy_tables";
  channel: { id: string | null; created: boolean; kind: string | null; active: boolean | null; note: string };
  topups: {
    total: number; migrated: number; alreadyMigrated: number;
    byLegacyStatus: Record<string, number>;
    stayedPending: number; closedExpired: number; movedToReview: number;
    nonMultipleOf10Suffix: number; collisionsExpired: number;
    unmigratable: { id: string; reason: string }[];
  };
  sms: { total: number; migrated: number; alreadyMigrated: number; linkedToRequest: number; deposits: number; ignored: number };
  ledger: { confirmed: number; withCredit: number; confirmedWithoutCredit: { topupId: string; userId: string; amountRial: number }[] };
  orphans: { topups: number; sms: number };
  attention: string[];
  ok: boolean;
}

const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const requestIdFor = (topupId: string) => `pr_lg_${sha(topupId).slice(0, 18)}`;
const smsIdFor = (logId: string) => `sms_lg_${sha(logId).slice(0, 18)}`;

const exists = async (c: ClientLike, table: string) =>
  (await c.query("SELECT to_regclass($1) AS t", [table])).rows[0]?.t !== null;

async function ensurePlatformChannel(
  c: ClientLike, now: Date, hasLegacyRows: boolean, report: MigrationReport,
): Promise<{ id: string; kind: string } | null> {
  const found = await c.query(
    "SELECT id, kind, active FROM payment_channels WHERE scope = 'platform' AND bot_id IS NULL ORDER BY created_at, id LIMIT 1");
  if (found.rows[0]) {
    report.channel = { id: found.rows[0].id, created: false, kind: found.rows[0].kind, active: found.rows[0].active, note: "کانالِ platform از قبل بود؛ دست‌نخورده ماند." };
    return { id: found.rows[0].id, kind: found.rows[0].kind };
  }
  // تنظیماتِ قدیمی (payment_methods.blubank) — دقیقاً همان معناییِ `getPaymentMethods()` در platformSettings.ts:
  // ردیفِ DB روی پیش‌فرضِ env سوار می‌شود (لینکِ پیش‌فرض/enabled=true وقتی هیچ‌چیز ذخیره نشده). باید با `fromEnv()` هماهنگ بماند.
  let link = (process.env.BLUBANK_TOPUP_LINK ?? "https://blubiz.sb24.ir/s/skCuUhkl").trim();
  let enabled = true;
  if (await exists(c, "platform_settings")) {
    const s = await c.query("SELECT value FROM platform_settings WHERE key = 'payment_methods'");
    if (s.rows[0]) {
      try {
        const v = JSON.parse(s.rows[0].value ?? "{}");
        if (typeof v?.blubank?.link === "string" && v.blubank.link.trim()) link = v.blubank.link.trim();
        if (typeof v?.blubank?.enabled === "boolean") enabled = v.blubank.enabled;
      } catch { /* JSON خراب = همان پیش‌فرض */ }
    }
  }
  let httpsLink = "";
  try { const u = new URL(link); if (u.protocol === "https:" && u.hostname) httpsLink = u.toString(); } catch { /* لینکِ نامعتبر */ }
  if (!httpsLink && !hasLegacyRows) {
    report.channel = { id: null, created: false, kind: null, active: null, note: "نه کانالِ platform بود و نه داده‌ی قدیمی/لینکِ بلوبانک؛ چیزی ساخته نشد. از پنلِ ادمین کانال بسازید." };
    return null;
  }
  const id = `pch_${crypto.randomBytes(9).toString("hex")}`;
  const active = Boolean(httpsLink) && enabled;
  await c.query(
    `INSERT INTO payment_channels
       (id, scope, bot_id, kind, payment_url, bank_name, sms_secret_hash, sender_allowlist, bank_parser, min_amount_rial, active, created_at)
     VALUES ($1,'platform',NULL,'open_link',$2,'بلوبانک',$3,'{}','blubank',$4::bigint,$5,$6)`,
    [id, httpsLink || "https://legacy.invalid/not-configured", hashSmsSecret(generateSmsSecret()), MIN_AMOUNT_RIAL, active, now]);
  report.channel = {
    id, created: true, kind: "open_link", active,
    note: httpsLink
      ? `کانالِ platform از لینکِ بلوبانکِ تنظیماتِ قدیمی ساخته شد (${active ? "فعال" : "غیرفعال — در تنظیماتِ قدیمی خاموش بود"}). برایِ وبهوکِ جدید در پنلِ ادمین «چرخشِ کلید» بزنید.`
      : "لینکِ بلوبانک در تنظیماتِ قدیمی نبود؛ یک کانالِ غیرفعالِ جانگه‌دار ساخته شد تا ردیف‌های قدیمی جایی داشته باشند. کانالِ واقعی بسازید و این را غیرفعال نگه دارید.",
  };
  if (!httpsLink) report.attention.push("کانالِ platform جانگه‌دار (غیرفعال) ساخته شد؛ یک کانالِ واقعی بسازید.");
  return { id, kind: "open_link" };
}

/** همه‌ی کار روی `c` (داخلِ یک تراکنشِ باز). */
async function migrateInTx(c: ClientLike, now: Date, report: MigrationReport): Promise<void> {
  const hasTopups = await exists(c, "wallet_topups");
  const hasSms = await exists(c, "sms_logs");
  if (!hasTopups && !hasSms) { report.skipped = "no_legacy_tables"; return; }

  const topups = hasTopups ? (await c.query("SELECT * FROM wallet_topups ORDER BY created_at, id")).rows : [];
  const smsRows = hasSms ? (await c.query("SELECT * FROM sms_logs ORDER BY received_at, id")).rows : [];
  const channel = await ensurePlatformChannel(c, now, topups.length + smsRows.length > 0, report);
  if (!channel) return;

  report.topups.total = topups.length;
  report.sms.total = smsRows.length;

  const doneTopups = new Set<string>(
    (await c.query("SELECT legacy_ref FROM payment_requests WHERE legacy_ref LIKE $1", [`${TOPUP_LEGACY_PREFIX}%`])).rows.map((r) => r.legacy_ref));
  const doneSms = new Set<string>(
    (await c.query("SELECT legacy_ref FROM sms_inbox WHERE legacy_ref LIKE $1", [`${SMS_LEGACY_PREFIX}%`])).rows.map((r) => r.legacy_ref));

  const migratedRequestIdByTopup = new Map<string, string>();
  for (const t of topups) {
    report.topups.byLegacyStatus[t.status] = (report.topups.byLegacyStatus[t.status] ?? 0) + 1;
    const ref = `${TOPUP_LEGACY_PREFIX}${t.id}`;
    if (doneTopups.has(ref)) {
      report.topups.alreadyMigrated++;
      migratedRequestIdByTopup.set(t.id, requestIdFor(t.id));
      continue;
    }
    const base = Number(t.requested_amount), suffix = Number(t.suffix), final = Number(t.final_amount);
    if (!(base > 0) || suffix < 0 || final !== base + suffix) {
      report.topups.unmigratable.push({ id: t.id, reason: `مبلغ‌های ناسازگار (requested=${base}, suffix=${suffix}, final=${final})` });
      continue;
    }
    const created = new Date(t.created_at);
    const expiresAt: Date | null = t.expires_at ? new Date(t.expires_at) : null;
    let status: string;
    switch (t.status) {
      case "pending":
        status = expiresAt && expiresAt.getTime() > now.getTime() ? (t.receipt_image_url ? "awaiting_review" : "pending") : "expired";
        break;
      case "confirmed": status = "confirmed"; break;
      case "expired": status = "expired"; break;
      case "canceled": status = "canceled"; break;
      default:
        status = "canceled";
        report.attention.push(`وضعیتِ ناشناسِ «${t.status}» برایِ ${t.id}؛ canceled ثبت شد.`);
    }
    const confirmedAt = status === "confirmed" ? new Date(t.confirmed_at ?? t.created_at) : null;
    const confirmedBy = status === "confirmed" ? (t.matched_sms_id ? "sms" : "admin") : null;
    const insert = (st: string) => c.query(
      `INSERT INTO payment_requests
         (id, channel_id, channel_kind, scope, bot_id, user_id, purpose, base_amount_rial, suffix_rial, final_amount_rial,
          status, expires_at, receipt_file_id, receipt_uploaded_at, confirmed_by, confirmed_by_admin_id, confirmed_at,
          account_id_snapshot, effect_claimed_at, effect_done_at, legacy_ref, created_at)
       VALUES ($1,$2,$3,'platform',NULL,$4,'wallet_topup',$5::bigint,$6::bigint,$7::bigint,
               $8,$9,$10,$11,$12,$13,$14,$2,$15,$15,$16,$17)`,
      [requestIdFor(t.id), channel.id, channel.kind, t.user_id, base, suffix, final,
        st, expiresAt, st === "awaiting_review" ? t.receipt_image_url : null, st === "awaiting_review" ? (t.receipt_uploaded_at ?? created) : null,
        confirmedBy, confirmedBy === "admin" ? "legacy-manual-confirm" : null, confirmedAt,
        confirmedAt, ref, created]);
    await c.query("SAVEPOINT topup_row");
    try {
      await insert(status);
      await c.query("RELEASE SAVEPOINT topup_row");
    } catch (err: any) {
      await c.query("ROLLBACK TO SAVEPOINT topup_row");
      if (err?.code === "23505" && (status === "pending" || status === "awaiting_review")) {
        // مبلغِ نهایی با یک درخواستِ جدیدِ همان کانال برخورد کرد: ردیفِ قدیمی را منقضی ثبت می‌کنیم، نه گم‌شده.
        await c.query("SAVEPOINT topup_row2");
        try {
          await insert("expired");
          await c.query("RELEASE SAVEPOINT topup_row2");
        } catch (err2: any) {
          await c.query("ROLLBACK TO SAVEPOINT topup_row2");
          report.topups.unmigratable.push({ id: t.id, reason: String(err2?.message ?? err2).slice(0, 160) });
          continue;
        }
        report.topups.collisionsExpired++;
        report.attention.push(`درخواستِ قدیمیِ ${t.id} (مبلغِ نهایی ${final}) با درخواستِ جدید برخورد کرد و expired ثبت شد.`);
        status = "expired";
      } else {
        report.topups.unmigratable.push({ id: t.id, reason: String(err?.message ?? err).slice(0, 160) });
        continue;
      }
    }
    report.topups.migrated++;
    migratedRequestIdByTopup.set(t.id, requestIdFor(t.id));
    if (status === "pending") report.topups.stayedPending++;
    else if (status === "awaiting_review") report.topups.movedToReview++;
    else if (t.status === "pending") report.topups.closedExpired++;
    if (suffix % 10 !== 0 || suffix > 9990) report.topups.nonMultipleOf10Suffix++;
  }

  // پیامک‌ها
  let lastSms: Date | null = null;
  for (const s of smsRows) {
    const ref = `${SMS_LEGACY_PREFIX}${s.id}`;
    const received = new Date(s.received_at);
    if (!lastSms || received > lastSms) lastSms = received;
    if (doneSms.has(ref)) { report.sms.alreadyMigrated++; continue; }
    const amount = s.parsed_amount === null ? null : Number(s.parsed_amount);
    const parsedOk = amount !== null && amount > 0;
    const matchedReq = s.matched_payment_id ? migratedRequestIdByTopup.get(s.matched_payment_id) : undefined;
    const matched = Boolean(parsedOk && matchedReq);
    const status = matched ? "matched" : parsedOk ? "unmatched" : "ignored";
    await c.query(
      `INSERT INTO sms_inbox
         (id, channel_id, raw_text, sender, received_at, ingested_at, content_hash, direction, amount_rial, parsed_ok,
          matched_request_id, status, legacy_ref)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::bigint,$10,$11,$12,$13)`,
      [smsIdFor(s.id), channel.id, s.raw_text, s.sender, received, s.created_at ?? received, sha(`legacy:${s.id}`),
        parsedOk ? "deposit" : "unknown", parsedOk ? amount : null, parsedOk, matched ? matchedReq : null, status, ref]);
    report.sms.migrated++;
    if (parsedOk) report.sms.deposits++;
    if (status === "ignored") report.sms.ignored++;
    if (matched) {
      report.sms.linkedToRequest++;
      await c.query("UPDATE payment_requests SET matched_sms_id = $2 WHERE id = $1 AND matched_sms_id IS NULL", [matchedReq, smsIdFor(s.id)]);
    }
  }
  if (lastSms) {
    await c.query(
      "UPDATE payment_channels SET last_sms_at = GREATEST(COALESCE(last_sms_at, $2), $2) WHERE id = $1", [channel.id, lastSms]);
  }

  // ledger: تأییدشده‌ی قدیمی بدونِ ردیفِ شارژ؟ (فقط گزارش؛ هرگز خودکار جبران نمی‌شود)
  const confirmed = topups.filter((t) => t.status === "confirmed");
  report.ledger.confirmed = confirmed.length;
  if (confirmed.length && await exists(c, "wallet_transactions")) {
    for (const t of confirmed) {
      const { rows } = await c.query(
        "SELECT 1 FROM wallet_transactions WHERE type = 'deposit_blubank' AND status = 'approved' AND position($1 IN COALESCE(review_note, '')) > 0 LIMIT 1",
        [t.id]);
      if (rows[0]) report.ledger.withCredit++;
      else if (report.ledger.confirmedWithoutCredit.length < MAX_LISTED) {
        report.ledger.confirmedWithoutCredit.push({ topupId: t.id, userId: t.user_id, amountRial: Number(t.requested_amount) });
      }
    }
    if (report.ledger.confirmedWithoutCredit.length) {
      report.attention.push(
        `${report.ledger.confirmedWithoutCredit.length} شارژِ «تأییدشده»ی قدیمی در ledger اثری ندارد (احتمالاً قطعیِ پروسه بینِ تأیید و credit). خودکار جبران نشد؛ فهرستِ کامل در گزارش است — پیش از هر کاری موجودیِ کاربر را دستی بررسی کنید.`);
    }
  }

  // یتیم‌ها
  if (hasTopups) {
    report.orphans.topups = Number((await c.query(
      `SELECT COUNT(*) AS n FROM wallet_topups t
        WHERE NOT EXISTS (SELECT 1 FROM payment_requests r WHERE r.legacy_ref = 'wallet_topups:' || t.id)`)).rows[0].n);
  }
  if (hasSms) {
    report.orphans.sms = Number((await c.query(
      `SELECT COUNT(*) AS n FROM sms_logs s
        WHERE NOT EXISTS (SELECT 1 FROM sms_inbox r WHERE r.legacy_ref = 'sms_logs:' || s.id)`)).rows[0].n);
  }
  if (report.topups.nonMultipleOf10Suffix) {
    report.attention.push(`${report.topups.nonMultipleOf10Suffix} ردیفِ قدیمی پسوندِ غیرمضربِ ۱۰ دارند؛ با قیدِ معافِ legacy ذخیره شدند و مبلغِ نهایی‌شان عیناً حفظ شد.`);
  }
}

export async function migrateLegacyWalletTopups(
  pool: PoolLike, opts: { now?: Date; dryRun?: boolean } = {},
): Promise<MigrationReport> {
  const now = opts.now ?? new Date();
  const report: MigrationReport = {
    startedAt: now.toISOString(), finishedAt: now.toISOString(), dryRun: Boolean(opts.dryRun),
    channel: { id: null, created: false, kind: null, active: null, note: "" },
    topups: {
      total: 0, migrated: 0, alreadyMigrated: 0, byLegacyStatus: {}, stayedPending: 0, closedExpired: 0, movedToReview: 0,
      nonMultipleOf10Suffix: 0, collisionsExpired: 0, unmigratable: [],
    },
    sms: { total: 0, migrated: 0, alreadyMigrated: 0, linkedToRequest: 0, deposits: 0, ignored: 0 },
    ledger: { confirmed: 0, withCredit: 0, confirmedWithoutCredit: [] },
    orphans: { topups: 0, sms: 0 },
    attention: [],
    ok: false,
  };
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    try {
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", ["card_autoconfirm_p8_migration"]);
      await migrateInTx(c, now, report);
      report.finishedAt = new Date().toISOString();
      report.ok = report.orphans.topups === 0 && report.orphans.sms === 0 && report.topups.unmigratable.length === 0;
      if (!report.ok && !report.skipped) {
        report.attention.push("مهاجرت کامل نیست: ردیفِ یتیم/غیرقابل‌مهاجرت باقی مانده — بخشِ «unmigratable» و «orphans» را ببینید.");
      }
      await c.query(opts.dryRun || report.skipped ? "ROLLBACK" : "COMMIT");
    } catch (err) {
      try { await c.query("ROLLBACK"); } catch { /* اتصال افتاد */ }
      throw err;
    }
  } finally {
    c.release();
  }
  if (!opts.dryRun && !report.skipped) {
    const changed = report.topups.migrated + report.sms.migrated > 0 || report.channel.created || !report.ok;
    if (changed) {
      await logPaymentEvent(pool, {
        level: report.ok ? "info" : "error", kind: "legacy_migration", scope: "platform", channelId: report.channel.id, actor: "system",
        message: `مهاجرتِ شارژِ قدیمی: ${report.topups.migrated} درخواست، ${report.sms.migrated} پیامک، یتیم: ${report.orphans.topups + report.orphans.sms}`,
        data: { ...report, ledger: { ...report.ledger, confirmedWithoutCredit: report.ledger.confirmedWithoutCredit.length } },
      });
      logger.info({ topups: report.topups.migrated, sms: report.sms.migrated, ok: report.ok }, "legacy wallet top-up migration finished");
    }
  }
  return report;
}

/** گزارشِ خوانا (Markdown) برایِ اسکریپتِ CLI و پنلِ ادمین. */
export function formatMigrationReport(r: MigrationReport): string {
  const L: string[] = [];
  L.push(`# گزارشِ مهاجرتِ شارژِ کیف‌پولِ پلتفرم → ماژولِ کارت‌به‌کارتِ خودکار`);
  L.push("");
  L.push(`- زمان: ${r.startedAt} — ${r.dryRun ? "**dry-run (چیزی نوشته نشد)**" : "اجرای واقعی"}`);
  L.push(`- نتیجه: ${r.skipped ? "رد شد (جدول‌های قدیمی وجود ندارند)" : r.ok ? "✅ کامل — هیچ ردیفِ یتیم نمانده" : "❌ ناقص — بخشِ توجه را ببینید"}`);
  L.push("");
  L.push("## کانالِ platform");
  L.push(`- شناسه: ${r.channel.id ?? "—"} | ساخته شد: ${r.channel.created ? "بله" : "خیر"} | نوع: ${r.channel.kind ?? "—"} | فعال: ${r.channel.active ?? "—"}`);
  L.push(`- ${r.channel.note}`);
  L.push("");
  L.push("## درخواست‌های شارژ (wallet_topups → payment_requests)");
  L.push(`- کل: ${r.topups.total} | مهاجرت شد: ${r.topups.migrated} | از قبل مهاجرت‌شده: ${r.topups.alreadyMigrated}`);
  L.push(`- به تفکیکِ وضعیتِ قدیمی: ${Object.entries(r.topups.byLegacyStatus).map(([k, v]) => `${k}=${v}`).join("، ") || "—"}`);
  L.push(`- pending که pending ماند: ${r.topups.stayedPending} | به بررسیِ فیش رفت: ${r.topups.movedToReview} | مهلت‌گذشته → expired: ${r.topups.closedExpired} | برخوردِ مبلغ → expired: ${r.topups.collisionsExpired}`);
  L.push(`- پسوندِ غیرمضربِ ۱۰ (با قیدِ legacy نگه داشته شد): ${r.topups.nonMultipleOf10Suffix}`);
  if (r.topups.unmigratable.length) {
    L.push("- ❌ غیرقابل‌مهاجرت:");
    for (const u of r.topups.unmigratable.slice(0, 50)) L.push(`  - ${u.id}: ${u.reason}`);
  }
  L.push("");
  L.push("## پیامک‌ها (sms_logs → sms_inbox)");
  L.push(`- کل: ${r.sms.total} | مهاجرت شد: ${r.sms.migrated} | از قبل: ${r.sms.alreadyMigrated} | واریزِ قابل‌فهم: ${r.sms.deposits} | ignored: ${r.sms.ignored} | وصل‌شده به درخواست: ${r.sms.linkedToRequest}`);
  L.push("");
  L.push("## تطبیقِ ledger (بدونِ هیچ اعتبارِ تازه)");
  L.push(`- تأییدشده‌های قدیمی: ${r.ledger.confirmed} | با ردیفِ شارژ در ledger: ${r.ledger.withCredit} | **بدونِ ردیفِ شارژ: ${r.ledger.confirmedWithoutCredit.length}**`);
  for (const x of r.ledger.confirmedWithoutCredit.slice(0, 50)) L.push(`  - topup ${x.topupId} | کاربر ${x.userId} | ${x.amountRial.toLocaleString("en-US")} ریال`);
  L.push("");
  L.push("## ردیف‌های یتیم (باید صفر باشد)");
  L.push(`- wallet_topups بدونِ همتا: ${r.orphans.topups} | sms_logs بدونِ همتا: ${r.orphans.sms}`);
  if (r.attention.length) {
    L.push("");
    L.push("## نیازمندِ توجه");
    for (const a of r.attention) L.push(`- ${a}`);
  }
  L.push("");
  return L.join("\n");
}
