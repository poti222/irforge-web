/**
 * lib/authEmails.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * IRFORGE_PROMPT_V3 Phase 14 — the emails the email-registration/login flow
 * sends, mirroring lib/registrationBot.ts's role for the Telegram flow:
 * one place for this flow's message copy, built on lib/mailSender.ts the
 * same way registrationBot.ts is built on lib/telegram.ts.
 */
import { sendEmail } from "./mailSender";

type Locale = string | null | undefined;

function pick<T>(locale: Locale, map: Record<string, T>): T {
  const key = (locale ?? "fa").slice(0, 2);
  return map[key] ?? map.fa;
}

function wrap(bodyHtml: string): string {
  return `<div style="font-family:sans-serif;font-size:15px;line-height:1.6;color:#111">${bodyHtml}</div>`;
}

export interface BuiltEmail {
  subject: string;
  html: string;
  text: string;
}

/** خروجی خالص، بدون ارسال — برای تست و برای خودِ sendEmailRegistrationCode. */
export function buildRegistrationCodeEmail(code: string, locale?: Locale): BuiltEmail {
  const subject = pick(locale, {
    fa: "کد تأیید IrForge",
    en: "Your IrForge verification code",
    ar: "رمز تحقّق IrForge",
    tr: "IrForge doğrulama kodu",
    ru: "Код подтверждения IrForge",
  });
  const html = pick(locale, {
    fa: `<p>کد تأیید شما: <b>${code}</b></p><p>این کد تا ۵ دقیقه معتبر است.</p><p>⚠️ همکاران ما هیچ‌وقت این کد را از شما نمی‌پرسند.</p>`,
    en: `<p>Your verification code: <b>${code}</b></p><p>It is valid for 5 minutes.</p><p>⚠️ Our staff will never ask you for this code.</p>`,
    ar: `<p>رمز التحقّق: <b>${code}</b></p><p>صالح لمدة 5 دقائق.</p><p>⚠️ لن يطلب منك فريقنا هذا الرمز أبدًا.</p>`,
    tr: `<p>Doğrulama kodunuz: <b>${code}</b></p><p>5 dakika geçerlidir.</p><p>⚠️ Ekibimiz bu kodu sizden asla istemez.</p>`,
    ru: `<p>Ваш код подтверждения: <b>${code}</b></p><p>Действителен 5 минут.</p><p>⚠️ Наши сотрудники никогда не спросят у вас этот код.</p>`,
  });
  return { subject, html: wrap(html), text: `${subject}: ${code}` };
}

/** خروجی خالص، بدون ارسال — برای تست و برای خودِ sendEmailLoginCode. */
export function buildLoginCodeEmail(code: string, locale?: Locale): BuiltEmail {
  const subject = pick(locale, {
    fa: "کد ورود IrForge",
    en: "Your IrForge sign-in code",
    ar: "رمز دخول IrForge",
    tr: "IrForge giriş kodu",
    ru: "Код входа IrForge",
  });
  const html = pick(locale, {
    fa: `<p>کد ورود شما: <b>${code}</b></p><p>این کد تا ۵ دقیقه معتبر است. اگر شما درخواست ورود نداده‌اید، رمز حسابتان را عوض کنید.</p>`,
    en: `<p>Your sign-in code: <b>${code}</b></p><p>Valid for 5 minutes. If you did not try to sign in, change your password.</p>`,
    ar: `<p>رمز الدخول: <b>${code}</b></p><p>صالح لمدة 5 دقائق. إن لم تكن أنت من حاول الدخول فغيّر كلمة مرورك.</p>`,
    tr: `<p>Giriş kodunuz: <b>${code}</b></p><p>5 dakika geçerlidir. Giriş denemesi size ait değilse şifrenizi değiştirin.</p>`,
    ru: `<p>Ваш код входа: <b>${code}</b></p><p>Действителен 5 минут. Если вход пытались выполнить не вы — смените пароль.</p>`,
  });
  return { subject, html: wrap(html), text: `${subject}: ${code}` };
}

/** کد تأیید ثبت‌نام با ایمیل. */
export async function sendEmailRegistrationCode(to: string, code: string, locale?: Locale): Promise<void> {
  const { subject, html, text } = buildRegistrationCodeEmail(code, locale);
  await sendEmail({ to, subject, html, text });
}

/** کد ورود دومرحله‌ای برای حساب‌های فقط-ایمیل (بدون تلگرام). */
export async function sendEmailLoginCode(to: string, code: string, locale?: Locale): Promise<void> {
  const { subject, html, text } = buildLoginCodeEmail(code, locale);
  await sendEmail({ to, subject, html, text });
}
