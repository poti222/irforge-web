/**
 * test/smsParsers.test.mjs — فاز ۳ کارت‌به‌کارتِ خودکار: پارسرهای پیامکِ بانک
 * (`lib/smsParsers/*`) + احرازِ secret (`lib/smsChannelSecret.ts`).
 *
 * اصلِ حاکم: هر ابهامی → `unknown`/`parsedOk=false` (هرگز match نمی‌شود).
 * مبلغ همیشه «ریالِ صحیح» است و هرگز از عددِ «موجودی» گرفته نمی‌شود.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const { parseBlubankSms, parseGenericSms, getSmsParser, normalizeSmsText, KNOWN_SMS_PARSERS } =
  await import("../src/lib/smsParsers/index.ts");
const { generateSmsSecret, hashSmsSecret, verifySmsSecret, SMS_SECRET_PREFIX } =
  await import("../src/lib/smsChannelSecret.ts");

const bluDeposit = (amount, balance = "9,999,999", name = "فاطمه") =>
  `بلو\nواریز پول\n ${name} عزیز، ${amount} ریال به حساب شما نشست.\n موجودی: ${balance} ریال\n۲۱:۱۱\n۱۴۰۵.۰۶.۰۸`;

// ───────────── normalize ─────────────

test("normalize: ارقامِ فارسی/عربی، ٬، ي/ك و نویسه‌های نامرئی", () => {
  assert.equal(normalizeSmsText("۱٬۰۰۰٬۰۰۰"), "1,000,000");
  assert.equal(normalizeSmsText("٢٥٠٫٥"), "250.5");
  assert.equal(normalizeSmsText("مبلغ‌ ‎۱۲۳"), "مبلغ 123");
  assert.equal(normalizeSmsText("كاربري"), "کاربری");
  assert.equal(normalizeSmsText(undefined), "");
});

// ───────────── Blubank (≥ ۸ نمونه) ─────────────

test("blubank ۱: نمونه‌ی واقعیِ واریز", () => {
  const p = parseBlubankSms(bluDeposit("1,000,000", "1,068,654"));
  assert.deepEqual(p, { direction: "deposit", amountRial: 1_000_000, balanceRial: 1_068_654, parsedOk: true });
});

test("blubank ۲: مبلغِ غیرگرد ۲٬۷۶۸٬۶۵۴ — دقیقاً همان عدد (بدونِ ÷۱۰)", () => {
  const p = parseBlubankSms(bluDeposit("2,768,654"));
  assert.equal(p.amountRial, 2_768_654);
  assert.equal(p.parsedOk, true);
});

test("blubank ۳: مبلغ هرگز از «موجودی» گرفته نمی‌شود (موجودی بزرگ‌تر/برابر/کوچک‌تر)", () => {
  for (const balance of ["2,768,654", "9,000,000,000", "10"]) {
    const p = parseBlubankSms(bluDeposit("1,230,010", balance));
    assert.equal(p.amountRial, 1_230_010, `balance=${balance}`);
    assert.equal(p.balanceRial, Number(balance.replace(/,/g, "")));
  }
});

test("blubank ۴: ارقامِ فارسی و جداکننده‌ی «٬»", () => {
  const p = parseBlubankSms("بلو\nواریز پول\n علی عزیز، ۱٬۲۳۴٬۵۶۰ ریال به حساب شما نشست.\n موجودی: ۵٬۰۰۰٬۰۰۰ ریال");
  assert.equal(p.direction, "deposit");
  assert.equal(p.amountRial, 1_234_560);
  assert.equal(p.balanceRial, 5_000_000);
});

test("blubank ۵: ارقامِ عربی-هندی، نیم‌فاصله و ي/ك عربی", () => {
  const p = parseBlubankSms("بلو\nواريز پول\n مریم‌ عزیز، ٢٥٠٬٠٠٠ ريال به حساب شما نشست.\n موجودي: ٩٠٠٬٠٠٠ ريال");
  assert.equal(p.direction, "deposit");
  assert.equal(p.amountRial, 250_000);
  assert.equal(p.balanceRial, 900_000);
});

test("blubank ۶: عددِ بدونِ جداکننده", () => {
  const p = parseBlubankSms("بلو\nواریز پول\n رضا عزیز، 1500000 ریال به حساب شما نشست.");
  assert.equal(p.amountRial, 1_500_000);
  assert.equal(p.balanceRial, null);
  assert.equal(p.parsedOk, true);
});

test("blubank ۷: برداشت → withdraw (و parsedOk با مبلغ)", () => {
  const p = parseBlubankSms("بلو\nبرداشت پول\n فاطمه عزیز، 500,000 ریال از حساب شما برداشت شد.\n موجودی: 568,654 ریال");
  assert.equal(p.direction, "withdraw");
  assert.equal(p.amountRial, 500_000);
});

test("blubank ۸: پیامکِ نامربوط (تبلیغ/کدِ ورود) → unknown و parsedOk=false", () => {
  for (const t of [
    "بلو\nکد ورود شما: 123456",
    "به بلو خوش آمدید! برای دریافتِ جایزه ۵۰۰٬۰۰۰ ریالی وارد اپ شوید.",
    "",
    "   ",
  ]) {
    const p = parseBlubankSms(t);
    assert.equal(p.parsedOk, false, t);
    assert.equal(p.direction === "deposit", false, t);
  }
});

test("blubank ۹: نامِ صاحبِ حساب در الگو قفل نیست (نامِ چندکلمه‌ای و بدونِ نام)", () => {
  assert.equal(parseBlubankSms(bluDeposit("300,000", "1,000", "محمد رضا")).amountRial, 300_000);
  assert.equal(parseBlubankSms("واریز پول\n 700,000 ریال به حساب شما نشست.").amountRial, 700_000);
});

test("blubank ۱۰: هر دو علامتِ واریز و برداشت → مبهم (unknown، هرگز match)", () => {
  const p = parseBlubankSms("واریز پول\n 100,000 ریال به حساب شما نشست. 50,000 ریال از حساب شما برداشت شد.");
  assert.equal(p.direction, "unknown");
  assert.equal(p.parsedOk, false);
});

test("blubank ۱۱: «به حساب شما نشست» بدونِ کلمه‌ی «واریز» → deposit نیست", () => {
  const p = parseBlubankSms("یک پیامِ دیگر: 100,000 ریال به حساب شما نشست.");
  assert.equal(p.parsedOk, false);
});

test("blubank ۱۲: مبلغِ صفر یا غیرِ عددی → parsedOk=false", () => {
  assert.equal(parseBlubankSms("واریز پول\n 0 ریال به حساب شما نشست.").parsedOk, false);
  assert.equal(parseBlubankSms("واریز پول\n ریال به حساب شما نشست.").parsedOk, false);
});

// ───────────── Generic (≥ ۸ نمونه) ─────────────

test("generic ۱: واریز با «ریال»", () => {
  const p = parseGenericSms("واریز 1,250,000 ریال به حساب شما. مانده: 3,000,000 ریال");
  assert.deepEqual(p, { direction: "deposit", amountRial: 1_250_000, balanceRial: 3_000_000, parsedOk: true });
});

test("generic ۲: «تومان» ×۱۰ به ریال", () => {
  const p = parseGenericSms("واریز 125,000 تومان به حساب شما");
  assert.equal(p.amountRial, 1_250_000);
  assert.equal(p.parsedOk, true);
});

test("generic ۳: برداشت", () => {
  const p = parseGenericSms("برداشت 200,000 ریال از حساب شما. مانده: 800,000 ریال");
  assert.equal(p.direction, "withdraw");
  assert.equal(p.amountRial, 200_000);
});

test("generic ۴: عددِ بی‌واحد هرگز حدس زده نمی‌شود", () => {
  const p = parseGenericSms("واریز 1250000 به حساب شما");
  assert.equal(p.amountRial, null);
  assert.equal(p.parsedOk, false);
});

test("generic ۵: دو مبلغِ متمایز → مبهم (amount=null)", () => {
  const p = parseGenericSms("واریز 100,000 ریال و کارمزد 5,000 ریال");
  assert.equal(p.amountRial, null);
  assert.equal(p.parsedOk, false);
});

test("generic ۶: هم واریز هم برداشت → unknown", () => {
  const p = parseGenericSms("واریز 100,000 ریال؛ برداشت 100,000 ریال");
  assert.equal(p.direction, "unknown");
  assert.equal(p.parsedOk, false);
});

test("generic ۷: «موجودی» مبلغ نیست (حتی وقتی تنها عددِ واحددار است)", () => {
  const p = parseGenericSms("واریز به حساب شما انجام شد. موجودی: 5,000,000 ریال");
  assert.equal(p.amountRial, null);
  assert.equal(p.balanceRial, 5_000_000);
  assert.equal(p.parsedOk, false);
});

test("generic ۸: ساعت بعد از «ریال» مبلغ حساب نمی‌شود", () => {
  const p = parseGenericSms("واریز 400,000 ریال ساعت 21:11");
  assert.equal(p.amountRial, 400_000);
  const q = parseGenericSms("واریز 400,000 ریال 21:11");
  assert.equal(q.amountRial, 400_000);
});

test("generic ۹: برچسب‌وار «مبلغ: ۵۰۰٬۰۰۰ ریال» و ارقامِ فارسی", () => {
  const p = parseGenericSms("واریز به حساب\nمبلغ: ۵۰۰٬۰۰۰ ریال\nمانده: ۲٬۰۰۰٬۰۰۰ ریال");
  assert.equal(p.amountRial, 500_000);
  assert.equal(p.balanceRial, 2_000_000);
  assert.equal(p.parsedOk, true);
});

test("generic ۱۰: انگلیسی (credited IRR) و متنِ بی‌ربط", () => {
  assert.equal(parseGenericSms("Your account was credited 750000 IRR").amountRial, 750_000);
  assert.equal(parseGenericSms("Your account was credited 750000 IRR").direction, "deposit");
  for (const t of ["سلام، جلسه فردا ساعت 10", "کد تایید: 445566", ""]) {
    assert.equal(parseGenericSms(t).parsedOk, false, t);
  }
});

// ───────────── registry ─────────────

test("getSmsParser: نامِ ناشناخته به generic برمی‌گردد و همه‌ی نام‌های شناخته‌شده تابع‌اند", () => {
  assert.equal(getSmsParser("blubank"), parseBlubankSms);
  assert.equal(getSmsParser("generic"), parseGenericSms);
  assert.equal(getSmsParser("no-such-bank"), parseGenericSms);
  for (const n of KNOWN_SMS_PARSERS) assert.equal(typeof getSmsParser(n), "function");
});

test("parsedOk فقط وقتی true است که جهت و مبلغ هر دو مشخص باشند (هم‌راستا با CHECKِ sms_inbox_parsed_chk)", () => {
  const samples = [
    bluDeposit("1,000,000"), "برداشت 1 ریال", "واریز", "hello", "", bluDeposit("0"),
    "واریز 100 ریال برداشت 100 ریال", "واریز 5 تومان",
  ];
  for (const parser of [parseBlubankSms, parseGenericSms]) {
    for (const s of samples) {
      const p = parser(s);
      assert.equal(p.parsedOk, p.direction !== "unknown" && p.amountRial !== null, s);
      if (p.amountRial !== null) assert.ok(Number.isSafeInteger(p.amountRial) && p.amountRial > 0);
    }
  }
});

// ───────────── secret ─────────────

test("secret: تولید، هش و مقایسه‌ی constant-time", () => {
  const s = generateSmsSecret();
  assert.ok(s.startsWith(SMS_SECRET_PREFIX));
  assert.ok(s.length >= 40);
  assert.notEqual(s, generateSmsSecret());
  const h = hashSmsSecret(s);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.ok(!h.includes(s));
  assert.equal(verifySmsSecret(s, h), true);
  assert.equal(verifySmsSecret(s + "x", h), false);
  assert.equal(verifySmsSecret("", h), false);
});

test("secret: کانالِ ناموجود (hash=null) هرگز موفق نمی‌شود، حتی با ورودیِ ساختگی", () => {
  assert.equal(verifySmsSecret("dummy-secret-for-constant-time-compare", null), false);
  assert.equal(verifySmsSecret("dummy-secret-for-constant-time-compare", undefined), false);
  assert.equal(verifySmsSecret("anything", "not-a-hex-hash"), false);
});
