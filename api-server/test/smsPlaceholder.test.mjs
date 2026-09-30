import test from "node:test";
import assert from "node:assert/strict";
import { isPlaceholderText, unwrapAngle, canonSender, senderAllowed } from "../src/lib/smsIngest.ts";

test("placeholder texts are detected, real SMS is not", () => {
  for (const t of ["<SMS text>", "{sms_message}", "[sms_message]", " <متن پیامک> "]) assert.equal(isPlaceholderText(t), true, t);
  assert.equal(isPlaceholderText("بلو\nواریز پول\n علی عزیز، 1,000,000 ریال به حساب شما نشست."), false);
});

test("sender wrapped in angle brackets matches the allowlist", () => {
  assert.equal(unwrapAngle("<بلو>"), "بلو");
  assert.equal(canonSender("<بلو>"), canonSender("بلو"));
  assert.equal(senderAllowed(["بلو"], "<بلو>"), true);
  assert.equal(senderAllowed(["بلو"], "other"), false);
});

const { unwrapWholeAngle } = await import("../src/lib/smsIngest.ts");
const { parseBlubankSms } = await import("../src/lib/smsParsers/index.ts");
const PURCHASE = "بلو آنلاین شدی\nفاطمه عزیز، 229,460 ریال بابت خرید بسته اینترنت از حساب شما پرید .\nموجودی: 372,080 ریال\n۱۵:۵۴\n۱۴۰۵.۰۷.۰۷";

test("whole-text angle wrapping is removed", () => {
  const w = unwrapWholeAngle(`<${PURCHASE}>`);
  assert.equal(w, PURCHASE);
});

test("internet purchase is a withdrawal, never a deposit", () => {
  const p = parseBlubankSms(PURCHASE);
  assert.equal(p.direction, "withdraw");
  assert.equal(p.amountRial, 229_460);
  assert.equal(p.balanceRial, 372_080);
});

test("real deposit still parses", () => {
  const p = parseBlubankSms("بلو\nواریز پول\n علی عزیز، 1,000,000 ریال به حساب شما نشست.\n موجودی: 5,000,000 ریال");
  assert.equal(p.direction, "deposit");
  assert.equal(p.amountRial, 1_000_000);
});
