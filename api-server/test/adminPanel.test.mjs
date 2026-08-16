/**
 * test/adminPanel.test.mjs — قواعدی که پنل ادمین روی آن‌ها ایستاده.
 *
 * این‌ها همه از یک دور دیباگ روی پنل سوپرادمین آمده‌اند و وجه مشترکشان این
 * است که **هیچ‌کدام خطا نمی‌دادند** — یک عدد اشتباه، یک دسترسی باز، یا یک
 * پول دوباره‌شمرده‌شده، هیچ‌کدام لاگ نمی‌سازند.
 */
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, p), "utf8");

const adminSrc = read("../src/routes/admin.ts");
const plansSrc = read("../src/routes/plans.ts");
const walletSrc = read("../src/routes/wallet.ts");
const botsSrc = read("../src/routes/bots.ts");

// ─── درآمد ──────────────────────────────────────────────────────────────────

test("درآمد از پرداخت‌های واقعی می‌آید، نه از اشتراک‌های ثبت‌شده", () => {
  // `POST /plans/subscribe` هیچ پولی نمی‌گیرد، پس جمع‌زدن `plans.price` روی
  // `user_plans` درآمدی می‌ساخت که هرگز دریافت نشده — و فروش بات را که در
  // `payments` و `wallet_transactions` است اصلاً نمی‌دید.
  assert.match(adminSrc, /paymentsTable/, "فیش‌های تأییدشده باید شمرده شوند");
  assert.match(adminSrc, /walletTransactionsTable/, "خرج کیف پول باید شمرده شود");
  assert.match(adminSrc, /revenueBreakdown/, "تفکیک بات/پلاگین باید برگردد");

  // فقط پولِ تأییدشده
  assert.match(adminSrc, /eq\(paymentsTable\.status, "approved"\)/);
  assert.match(adminSrc, /eq\(walletTransactionsTable\.status, "approved"\)/);
  // و فقط خرج، نه شارژ — وگرنه شارژ و خرجِ همان پول دو بار شمرده می‌شد.
  assert.match(adminSrc, /eq\(walletTransactionsTable\.type, "spend"\)/);
});

test("«کل پیام‌ها» دیگر برنمی‌گردد", () => {
  // منبعش `bots.message_count` بود که هیچ‌جای این استک نوشته نمی‌شود.
  assert.equal(/totalMessages/.test(adminSrc), false);
});

test("توزیع پلن‌ها از جدول plans می‌آید، نه از یک فهرست ثابت", () => {
  // فهرست ثابت یعنی پلنِ تازه هرگز ظاهر نمی‌شود؛ و مقایسه با `users.plan`
  // غلط بود چون آن ستون **شناسه‌ی** پلن را نگه می‌دارد نه نامش.
  assert.equal(/"free", "starter", "pro", "enterprise"/.test(adminSrc), false);
  assert.match(adminSrc, /from\(plansTable\)/);
});

// ─── دسترسی ────────────────────────────────────────────────────────────────

test("ادمین عادی نمی‌تواند حساب سوپرادمین را تغییر دهد یا حذف کند", () => {
  // گارد قبلی فقط جلوی «ارتقا به سوپرادمین» را می‌گرفت، ولی ادمین عادی
  // می‌توانست سوپرادمین را به user تنزل دهد یا بن کند یا کلاً حذفش کند —
  // یعنی بدون ارتقای خودش، همه‌ی سوپرادمین‌ها را خنثی کند.
  assert.match(adminSrc, /Only a super admin can modify a super admin account/);
  assert.match(adminSrc, /Only a super admin can delete a super admin account/);
  assert.match(adminSrc, /Only a super admin can grant the super_admin role/);
});

test("نوشتن روی پلن‌ها فقط سوپرادمین", () => {
  // پنل ادمین تب پلن‌ها را فقط به سوپرادمین نشان می‌داد و در کامنتش نوشته بود
  // «سرور requireSuperAdmin است» — ولی هر چهار روت `requireAdmin` بودند، پس
  // یک ادمین عادی می‌توانست مستقیم با API قیمت‌ها را عوض کند.
  for (const verb of ["post", "patch", "delete"]) {
    const re = new RegExp(`router\\.${verb}\\("/admin/plans[^"]*", requireSuperAdmin`);
    assert.match(plansSrc, re, `${verb} /admin/plans باید سوپرادمین باشد`);
  }
  // خواندن برای ادمین عادی باز می‌ماند (نمای کلی به نام پلن‌ها نیاز دارد).
  assert.match(plansSrc, /router\.get\("\/admin\/plans", requireAdmin/);
});

test("پلنِ دارای مشترک فعال حذف نمی‌شود", () => {
  // وگرنه ردیف‌های `user_plans` به پلنی اشاره می‌کردند که دیگر وجود ندارد.
  assert.match(plansSrc, /plan_in_use/);
  assert.match(plansSrc, /Plan not found/);
});

// ─── پول: مسابقه‌ها ────────────────────────────────────────────────────────

test("تأیید واریز اتمیک است، نه «بخوان، چک کن، بنویس»", () => {
  // دو تأیید هم‌زمان روی یک واریز، کیف پول را دو بار شارژ می‌کرد.
  // شرط `status = 'pending'` باید داخل همان UPDATE باشد تا دیتابیس داور شود.
  const approve = walletSrc.slice(walletSrc.indexOf("/approve"));
  assert.match(
    approve,
    /update\(walletTransactionsTable\)[\s\S]{0,400}?eq\(walletTransactionsTable\.status, "pending"\)/,
    "گذار وضعیت باید در WHERE همان UPDATE باشد",
  );
  // و افزایش موجودی در SQL، نه `مقدارِ خوانده‌شده + مبلغ`.
  assert.match(approve, /balance: sql`\$\{walletsTable\.balance\} \+/);
});

test("کسر از کیف پول مشروط است و موجودی را منفی نمی‌کند", () => {
  // دو خرید هم‌زمان هر دو از چکِ موجودی رد می‌شدند و کاربر بیش از موجودی‌اش
  // خرج می‌کرد. شرط باید در WHERE باشد.
  for (const [name, src] of [["bots.ts", botsSrc], ["wallet.ts", walletSrc]]) {
    assert.match(
      src,
      /balance: sql`\$\{walletsTable\.balance\} - /,
      `${name}: کسر باید در SQL انجام شود`,
    );
    assert.match(
      src,
      /gte\(walletsTable\.balance, /,
      `${name}: شرط موجودی کافی باید در WHERE باشد`,
    );
  }
});
