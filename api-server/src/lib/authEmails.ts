/**
 * lib/authEmails.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * IRFORGE_PROMPT_V3 Phase 14 — the emails the email-registration/login flow
 * sends, mirroring lib/registrationBot.ts's role for the Telegram flow:
 * one place for this flow's message copy, built on lib/mailSender.ts the
 * same way registrationBot.ts is built on lib/telegram.ts.
 *
 * IRFORGE_PROMPT_V3 Phase 44 — branded HTML instead of a bare `<p>`. Built as
 * a table layout with every rule inlined: Gmail/Outlook/Apple Mail strip
 * `<style>` blocks and flexbox/grid unpredictably, but a `<table>` with
 * `style="..."` on every cell survives all three. No external image for the
 * badge (a hosted logo means a dead image the moment that URL changes, and
 * most clients block remote images by default anyway) — the mark is redrawn
 * with inline CSS instead, same orange as `--primary` in irforge/src/index.css
 * (`hsl(25 95% 38%)` → `#c2410c`).
 */
import { sendEmail, type DeliveryResult } from "./mailSender";

type Locale = string | null | undefined;

function pick<T>(locale: Locale, map: Record<string, T>): T {
  const key = (locale ?? "fa").slice(0, 2);
  return map[key] ?? map.fa;
}

function isRtl(locale: Locale): boolean {
  const key = (locale ?? "fa").slice(0, 2);
  return key === "fa" || key === "ar";
}

/** رنگ برند — همان `--primary` در حالت روشن (`irforge/src/index.css`). */
const BRAND = "#c2410c";
const BRAND_DARK = "#9a3412";
const INK = "#1c1917";
const MUTED = "#78716c";
const BORDER = "#e7e5e4";
const SURFACE = "#fafaf9";

export interface BuiltEmail {
  subject: string;
  html: string;
  text: string;
}

interface LayoutCopy {
  preheader: string;
  eyebrow: string;
  heading: string;
  intro: string;
  codeLabel: string;
  expiry: string;
  notice: string;
  footer: string;
}

/**
 * پوسته‌ی مشترکِ هر دو ایمیل: بنر برند بالا، متن، جعبه‌ی کد بزرگ، پانوشت.
 * جهت (`rtl`/`ltr`) و تراز متن با locale عوض می‌شود؛ خودِ جدول و اسپیسینگ در
 * هر دو حالت یکسان می‌ماند.
 */
function renderLayout(code: string, locale: Locale, copy: LayoutCopy): string {
  const rtl = isRtl(locale);
  const dir = rtl ? "rtl" : "ltr";
  const align = rtl ? "right" : "left";
  const codeLetterSpacing = "6px";

  return `<!doctype html>
<html dir="${dir}" lang="${(locale ?? "fa").slice(0, 2)}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <title>${copy.heading}</title>
  </head>
  <body style="margin:0;padding:0;background-color:${SURFACE};direction:${dir};">
    <!-- پیش‌نمایشِ مخفی که اینباکس‌ها زیرِ موضوع نشان می‌دهند -->
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${copy.preheader}</div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${SURFACE};padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#ffffff;border:1px solid ${BORDER};border-radius:16px;overflow:hidden;">
            <!-- بنر برند -->
            <tr>
              <td style="background-color:${BRAND};background-image:linear-gradient(135deg, ${BRAND} 0%, ${BRAND_DARK} 100%);padding:28px 32px;text-align:${align};">
                <table role="presentation" cellpadding="0" cellspacing="0" ${rtl ? 'align="right"' : 'align="left"'}>
                  <tr>
                    <td style="width:36px;height:36px;background-color:rgba(255,255,255,0.16);border-radius:10px;text-align:center;vertical-align:middle;font-size:18px;line-height:36px;">
                      🤖
                    </td>
                    <td style="padding-${rtl ? "right" : "left"}:10px;">
                      <span style="font-family:Tahoma,Arial,sans-serif;font-size:19px;font-weight:700;color:#ffffff;letter-spacing:0.2px;">IrForge</span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- بدنه -->
            <tr>
              <td style="padding:32px 32px 8px 32px;text-align:${align};">
                <p style="margin:0 0 6px 0;font-family:Tahoma,Arial,sans-serif;font-size:12px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;color:${BRAND};">
                  ${copy.eyebrow}
                </p>
                <h1 style="margin:0 0 14px 0;font-family:Tahoma,Arial,sans-serif;font-size:21px;line-height:1.4;color:${INK};">
                  ${copy.heading}
                </h1>
                <p style="margin:0 0 24px 0;font-family:Tahoma,Arial,sans-serif;font-size:14.5px;line-height:1.8;color:${MUTED};">
                  ${copy.intro}
                </p>
              </td>
            </tr>

            <!-- جعبه‌ی کد -->
            <tr>
              <td style="padding:0 32px 8px 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${SURFACE};border:1px solid ${BORDER};border-radius:12px;">
                  <tr>
                    <td style="padding:22px 16px;text-align:center;">
                      <p style="margin:0 0 10px 0;font-family:Tahoma,Arial,sans-serif;font-size:12px;color:${MUTED};">
                        ${copy.codeLabel}
                      </p>
                      <div style="font-family:'Courier New',Courier,monospace;font-size:34px;font-weight:700;color:${INK};letter-spacing:${codeLetterSpacing};direction:ltr;unicode-bidi:plaintext;">
                        ${code}
                      </div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- انقضا و هشدار امنیتی -->
            <tr>
              <td style="padding:20px 32px 4px 32px;text-align:${align};">
                <p style="margin:0 0 10px 0;font-family:Tahoma,Arial,sans-serif;font-size:13.5px;line-height:1.8;color:${MUTED};">
                  ⏱ ${copy.expiry}
                </p>
                <p style="margin:0;font-family:Tahoma,Arial,sans-serif;font-size:13.5px;line-height:1.8;color:${MUTED};">
                  ⚠️ ${copy.notice}
                </p>
              </td>
            </tr>

            <!-- جداکننده -->
            <tr>
              <td style="padding:24px 32px 0 32px;">
                <div style="border-top:1px solid ${BORDER};"></div>
              </td>
            </tr>

            <!-- پانوشت -->
            <tr>
              <td style="padding:16px 32px 28px 32px;text-align:${align};">
                <p style="margin:0;font-family:Tahoma,Arial,sans-serif;font-size:12px;line-height:1.7;color:#a8a29e;">
                  ${copy.footer}
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
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

  const copy = pick<LayoutCopy>(locale, {
    fa: {
      preheader: `کد تأیید ثبت‌نام شما: ${code}`,
      eyebrow: "ثبت‌نام",
      heading: "تکمیل ثبت‌نام در IrForge",
      intro: "برای تکمیل ثبت‌نام، کد زیر را در صفحه‌ای که باز گذاشته‌اید وارد کنید.",
      codeLabel: "کد تأیید",
      expiry: "این کد تا ۵ دقیقه دیگر معتبر است.",
      notice: "همکاران ما هیچ‌وقت این کد را از شما نمی‌پرسند. آن را با کسی در میان نگذارید.",
      footer: "این ایمیل به‌صورت خودکار از سامانه‌ی IrForge ارسال شده. اگر درخواست ثبت‌نام نداده‌اید، این پیام را نادیده بگیرید.",
    },
    en: {
      preheader: `Your IrForge verification code: ${code}`,
      eyebrow: "Sign up",
      heading: "Finish creating your IrForge account",
      intro: "Enter the code below on the page you left open to finish signing up.",
      codeLabel: "Verification code",
      expiry: "This code expires in 5 minutes.",
      notice: "Our staff will never ask you for this code. Don't share it with anyone.",
      footer: "This is an automated email from IrForge. If you didn't request this, you can safely ignore it.",
    },
    ar: {
      preheader: `رمز التحقّق الخاص بك: ${code}`,
      eyebrow: "التسجيل",
      heading: "أكمل إنشاء حسابك في IrForge",
      intro: "أدخل الرمز أدناه في الصفحة التي تركتها مفتوحة لإكمال التسجيل.",
      codeLabel: "رمز التحقّق",
      expiry: "صالح لمدة 5 دقائق.",
      notice: "لن يطلب منك فريقنا هذا الرمز أبدًا. لا تشاركه مع أحد.",
      footer: "هذه رسالة تلقائية من IrForge. إذا لم تطلب ذلك، يمكنك تجاهل هذه الرسالة.",
    },
    tr: {
      preheader: `IrForge doğrulama kodunuz: ${code}`,
      eyebrow: "Kayıt",
      heading: "IrForge hesabınızı tamamlayın",
      intro: "Kaydı tamamlamak için açık bıraktığınız sayfaya aşağıdaki kodu girin.",
      codeLabel: "Doğrulama kodu",
      expiry: "Bu kod 5 dakika içinde sona erer.",
      notice: "Ekibimiz bu kodu sizden asla istemez. Kimseyle paylaşmayın.",
      footer: "Bu, IrForge tarafından gönderilen otomatik bir e-postadır. Bunu siz talep etmediyseniz göz ardı edebilirsiniz.",
    },
    ru: {
      preheader: `Ваш код подтверждения IrForge: ${code}`,
      eyebrow: "Регистрация",
      heading: "Завершите регистрацию в IrForge",
      intro: "Введите код ниже на открытой странице, чтобы завершить регистрацию.",
      codeLabel: "Код подтверждения",
      expiry: "Код действителен 5 минут.",
      notice: "Наши сотрудники никогда не спросят у вас этот код. Никому его не сообщайте.",
      footer: "Это автоматическое письмо от IrForge. Если вы не запрашивали его, просто проигнорируйте это сообщение.",
    },
  });

  const html = renderLayout(code, locale, copy);
  const text = `${copy.heading}\n\n${copy.codeLabel}: ${code}\n${copy.expiry}\n${copy.notice}`;
  return { subject, html, text };
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

  const copy = pick<LayoutCopy>(locale, {
    fa: {
      preheader: `کد ورود شما: ${code}`,
      eyebrow: "ورود",
      heading: "ورود به حساب IrForge",
      intro: "برای تکمیل ورود، کد زیر را در صفحه‌ای که باز گذاشته‌اید وارد کنید.",
      codeLabel: "کد ورود",
      expiry: "این کد تا ۵ دقیقه دیگر معتبر است.",
      notice: "اگر شما درخواست ورود نداده‌اید، هرچه سریع‌تر رمز حسابتان را عوض کنید.",
      footer: "این ایمیل به‌صورت خودکار از سامانه‌ی IrForge ارسال شده.",
    },
    en: {
      preheader: `Your sign-in code: ${code}`,
      eyebrow: "Sign in",
      heading: "Sign in to your IrForge account",
      intro: "Enter the code below on the page you left open to finish signing in.",
      codeLabel: "Sign-in code",
      expiry: "This code expires in 5 minutes.",
      notice: "If you didn't try to sign in, change your password as soon as possible.",
      footer: "This is an automated email from IrForge.",
    },
    ar: {
      preheader: `رمز الدخول: ${code}`,
      eyebrow: "تسجيل الدخول",
      heading: "تسجيل الدخول إلى حساب IrForge",
      intro: "أدخل الرمز أدناه في الصفحة التي تركتها مفتوحة لإكمال تسجيل الدخول.",
      codeLabel: "رمز الدخول",
      expiry: "صالح لمدة 5 دقائق.",
      notice: "إن لم تكن أنت من حاول الدخول، فغيّر كلمة مرورك في أقرب وقت.",
      footer: "هذه رسالة تلقائية من IrForge.",
    },
    tr: {
      preheader: `Giriş kodunuz: ${code}`,
      eyebrow: "Giriş",
      heading: "IrForge hesabınıza giriş yapın",
      intro: "Girişi tamamlamak için açık bıraktığınız sayfaya aşağıdaki kodu girin.",
      codeLabel: "Giriş kodu",
      expiry: "Bu kod 5 dakika içinde sona erer.",
      notice: "Giriş denemesi size ait değilse şifrenizi en kısa sürede değiştirin.",
      footer: "Bu, IrForge tarafından gönderilen otomatik bir e-postadır.",
    },
    ru: {
      preheader: `Ваш код входа: ${code}`,
      eyebrow: "Вход",
      heading: "Вход в аккаунт IrForge",
      intro: "Введите код ниже на открытой странице, чтобы завершить вход.",
      codeLabel: "Код входа",
      expiry: "Код действителен 5 минут.",
      notice: "Если вход пытались выполнить не вы, как можно скорее смените пароль.",
      footer: "Это автоматическое письмо от IrForge.",
    },
  });

  const html = renderLayout(code, locale, copy);
  const text = `${copy.heading}\n\n${copy.codeLabel}: ${code}\n${copy.expiry}\n${copy.notice}`;
  return { subject, html, text };
}

/**
 * کد تأیید ثبت‌نام با ایمیل.
 * نتیجه‌ی sendEmail را برمی‌گرداند (قبلاً await می‌شد و دور ریخته می‌شد، یعنی
 * چه ایمیل واقعاً برود چه SMTP تنظیم نباشد چه رد شود، کالر هیچ‌وقت نمی‌فهمید).
 */
export async function sendEmailRegistrationCode(to: string, code: string, locale?: Locale): Promise<DeliveryResult> {
  const { subject, html, text } = buildRegistrationCodeEmail(code, locale);
  return sendEmail({ to, subject, html, text });
}

/** کد ورود دومرحله‌ای برای حساب‌های فقط-ایمیل (بدون تلگرام). */
export async function sendEmailLoginCode(to: string, code: string, locale?: Locale): Promise<DeliveryResult> {
  const { subject, html, text } = buildLoginCodeEmail(code, locale);
  return sendEmail({ to, subject, html, text });
}
