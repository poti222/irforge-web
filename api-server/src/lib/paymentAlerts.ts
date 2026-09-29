/**
 * lib/paymentAlerts.ts — گزارشِ رویدادهای مهمِ تطبیقِ پرداخت
 * (IRFORGE_CARD_AUTOCONFIRM_PROMPT، فاز ۴؛ قاعده‌ی سراسری: خطا و رویدادِ مهم
 * هم به ادمین‌ها می‌رسد هم در لاگ).
 *
 * این ماژول عمداً به `@workspace/db` وابسته نیست: کانال‌های ارسال (`notifyAdmins`،
 * `notifyBotOwner`) تزریق می‌شوند و route آن‌ها را به `lib/notify.ts` وصل می‌کند.
 * هر hook بعد از commit صدا زده می‌شود و **هرگز** نتیجه‌ی تطبیق را عوض نمی‌کند
 * (throw قورت داده می‌شود).
 *
 * در هیچ پیامی شماره‌کارت یا متنِ پیامک نمی‌آید — فقط شناسه‌ها و مبلغ.
 */
import { logger } from "./logger";
import type { PaymentRequestRow } from "./paymentRequests";

export interface AlertMessage {
  severity: "info" | "warning" | "critical";
  type: string;
  title: string;
  message: string;
  scope: "platform" | "bot";
  botId: string | null;
  /** برای جلوگیریِ اعلانِ تکراری روی retry. */
  dedupeKey: string;
  refId?: string;
}

export interface AlertNotifiers {
  /** super_adminها (سایت + تلگرام). */
  notifyAdmins?(msg: AlertMessage): Promise<void>;
  /** صاحبِ بات — فقط برایِ scope=bot صدا زده می‌شود. */
  notifyBotOwner?(botId: string, msg: AlertMessage): Promise<void>;
}

export interface ConfirmedEvent {
  request: PaymentRequestRow;
  smsId: string | null;
  promoted: PaymentRequestRow[];
}
export interface AmbiguousEvent {
  channelId: string;
  scope: "platform" | "bot";
  botId: string | null;
  smsId: string;
  amountRial: number;
  requestIds: string[];
}
export interface ProblemEvent {
  kind: "no_effect" | "effect_failed";
  channelId: string;
  scope: "platform" | "bot";
  botId: string | null;
  smsId: string;
  requestId: string;
  message: string;
}

export interface MatchAlerts {
  onConfirmed?(e: ConfirmedEvent): void | Promise<void>;
  onAmbiguous?(e: AmbiguousEvent): void | Promise<void>;
  onProblem?(e: ProblemEvent): void | Promise<void>;
}

/** شکلِ نمایشیِ مبلغ: ریال با جداکننده‌ی هزارگان. */
const rial = (n: number) => `${n.toLocaleString("en-US")} ریال`;

async function fanOut(n: AlertNotifiers, botId: string | null, msg: AlertMessage): Promise<void> {
  const jobs: Promise<void>[] = [];
  if (n.notifyAdmins) jobs.push(n.notifyAdmins(msg));
  if (botId && n.notifyBotOwner) jobs.push(n.notifyBotOwner(botId, msg));
  const results = await Promise.allSettled(jobs);
  for (const r of results) {
    if (r.status === "rejected") logger.warn({ err: r.reason, type: msg.type }, "payment alert delivery failed (non-fatal)");
  }
}

export function createPaymentAlerts(notifiers: AlertNotifiers = {}): Required<MatchAlerts> {
  return {
    onConfirmed(e) {
      logger.info(
        { requestId: e.request.id, channelId: e.request.channelId, scope: e.request.scope, botId: e.request.botId,
          purpose: e.request.purpose, finalAmountRial: e.request.finalAmountRial, smsId: e.smsId,
          by: e.request.confirmedBy, promoted: e.promoted.map((p) => p.id) },
        "payment request confirmed",
      );
    },
    async onAmbiguous(e) {
      logger.warn(
        { channelId: e.channelId, smsId: e.smsId, amountRial: e.amountRial, requestIds: e.requestIds },
        "payment SMS matched more than one request — left ambiguous for manual review",
      );
      await fanOut(notifiers, e.botId, {
        severity: "critical",
        type: "payment_sms_ambiguous",
        title: "پیامکِ واریز با چند درخواست هم‌خوان است",
        message: `واریز ${rial(e.amountRial)} با ${e.requestIds.length} درخواستِ فعال هم‌خوان شد و خودکار تأیید نشد. لطفاً دستی بررسی کنید.`,
        scope: e.scope,
        botId: e.botId,
        dedupeKey: `payment_sms_ambiguous:${e.smsId}`,
        refId: e.smsId,
      });
    },
    async onProblem(e) {
      logger.error(
        { kind: e.kind, channelId: e.channelId, smsId: e.smsId, requestId: e.requestId, err: e.message },
        "payment auto-confirm blocked",
      );
      await fanOut(notifiers, e.botId, {
        severity: "critical",
        type: "payment_confirm_failed",
        title: "تأییدِ خودکارِ پرداخت انجام نشد",
        message: e.kind === "no_effect"
          ? `پیامکِ واریز با درخواست ${e.requestId} هم‌خوان بود ولی برای این نوعِ پرداخت هنوز مسیرِ تأیید تنظیم نشده. دستی تأیید کنید.`
          : `پیامکِ واریز با درخواست ${e.requestId} هم‌خوان بود ولی اجرای اثرِ تأیید خطا داد و چیزی تغییر نکرد. دستی بررسی کنید.`,
        scope: e.scope,
        botId: e.botId,
        dedupeKey: `payment_confirm_failed:${e.requestId}:${e.kind}`,
        refId: e.requestId,
      });
    },
  };
}
