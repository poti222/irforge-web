/**
 * test/notifyTelegram.test.mjs — تحویل اعلان‌های سایت در تلگرام.
 *
 * دو چیز اینجا محافظت می‌شوند، چون هر دو بی‌صدا خراب می‌شوند:
 *
 *   ۱. **لینک «مشاهده در سایت»**. اگر مسیر اشتباه ساخته شود، پیام تلگرامی
 *      همچنان می‌رسد و هیچ خطایی هم نمی‌دهد — کاربر فقط روی دکمه می‌زند و به
 *      صفحه‌ی اشتباه می‌رود. تنها راه فهمیدنش، تست است.
 *
 *   ۲. **escape کردن HTML**. متن اعلان از ورودی ادمین می‌آید و با
 *      `parse_mode=HTML` فرستاده می‌شود؛ یک `<` رهاشده کل پیام را از طرف
 *      تلگرام رد می‌کند (خطای «can't parse entities») و اعلان اصلاً تحویل
 *      نمی‌شود.
 *
 * `deliverToTelegram` خودش اینجا تست نمی‌شود چون به دیتابیس و شبکه نیاز دارد؛
 * رفتار بدون-توکنش (no-op و بدون هیچ درخواست شبکه) و فیلتر گیرنده‌ها روی یک
 * Postgres واقعی دستی راستی‌آزمایی شده — نگاه کنید به PROGRESS.md.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";

const { deepLink, renderMessage } = await import("../src/lib/notifyTelegram.ts");

const SITE = "https://irforge.ir";
const link = (type, extra = {}) =>
  deepLink(SITE, { type, severity: "info", title: "t", message: "m", ...extra });

test("هر نوع اعلان به صفحه‌ی مربوط به خودش لینک می‌شود", () => {
  assert.equal(link("site_update", { refId: "u1" }), `${SITE}/updates/u1`);
  assert.equal(link("ticket_reply", { refId: "t1" }), `${SITE}/tickets/t1`);
  assert.equal(link("ticket_closed", { refId: "t2" }), `${SITE}/tickets/t2`);
  assert.equal(link("deposit_approved"), `${SITE}/wallet`);
  assert.equal(link("payment_rejected"), `${SITE}/wallet`);
  assert.equal(link("purchase_success"), `${SITE}/invoices`);
  assert.equal(link("order_cancelled"), `${SITE}/invoices`);
  assert.equal(link("trial_expired", { botId: "b1" }), `${SITE}/bots/b1`);
  assert.equal(link("bot_deployed", { botId: "b2" }), `${SITE}/bots/b2`);
});

test("نوع ناشناخته لینک شکسته نمی‌سازد، به صفحه‌ی اعلان‌ها می‌رود", () => {
  assert.equal(link("something_we_added_later"), `${SITE}/notifications`);
});

test("refId/botId نبود → مقصد عمومی، نه مسیر با undefined", () => {
  assert.equal(link("ticket_reply"), `${SITE}/tickets`);
  assert.equal(link("trial_warning"), `${SITE}/bots`);
  // site_update بدون refId نباید به /updates/undefined برود
  assert.equal(link("site_update"), `${SITE}/notifications`);
});

test("اسلش انتهایی PUBLIC_SITE_URL باعث // در مسیر نمی‌شود", () => {
  assert.equal(
    deepLink("https://irforge.ir///", { type: "deposit_approved", severity: "info", title: "t", message: "m" }),
    `${SITE}/wallet`,
  );
});

test("عنوان و متن برای parse_mode=HTML امن می‌شوند", () => {
  const text = renderMessage({
    type: "announcement",
    severity: "info",
    title: "<b>تخفیف</b> & جشنواره",
    message: "کد را در <input> بزنید",
  });
  assert.ok(text.includes("&lt;b&gt;تخفیف&lt;/b&gt; &amp; جشنواره"));
  assert.ok(text.includes("&lt;input&gt;"));
  // تنها تگ HTML باقی‌مانده باید همان <b> ای باشد که خودمان دور عنوان گذاشته‌ایم
  assert.equal(text.match(/<b>/g).length, 1);
});

test("آیکن پیام با نتیجه‌ی رویداد می‌خواند", () => {
  const icon = (type, severity = "info") =>
    renderMessage({ type, severity, title: "t", message: "m" }).slice(0, 2).trim();
  assert.equal(icon("deposit_approved"), "✅");
  assert.equal(icon("payment_rejected"), "❌");
  assert.equal(icon("purchase_failed"), "❌");
  assert.equal(icon("order_cancelled"), "❌");
  assert.equal(icon("trial_expired", "critical"), "🚨");
  assert.equal(icon("trial_warning", "warning"), "⚠️");
  assert.equal(icon("announcement"), "🔔");
});
