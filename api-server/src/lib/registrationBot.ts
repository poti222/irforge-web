/**
 * lib/registrationBot.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * پیام‌هایی که بات پلتفرم در جریان ثبت‌نام و ورود می‌فرستد.
 *
 * لحن و ساختار عمداً با پیام‌های موجود (هشدار تریال، بازیابی رمز) یکی است.
 * فارسی پیش‌فرض است؛ زبان‌های دیگر وقتی `locale` روی رکورد ست شده باشد.
 *
 * **هیچ کدی اینجا لاگ نمی‌شود.** فقط شناسه و نتیجه.
 */
import { sendTelegramMessage, tgApi } from "./telegram";
import { logger } from "./logger";

type Locale = string | null | undefined;

function pick<T>(locale: Locale, map: Record<string, T>): T {
  const key = (locale ?? "fa").slice(0, 2);
  return map[key] ?? map.fa;
}

function platformToken(): string | null {
  return process.env.TELEGRAM_BOT_TOKEN ?? null;
}

/** درخواست اشتراک‌گذاری شماره با دکمه‌ی request_contact. */
export async function askForContact(chatId: string, locale?: Locale): Promise<void> {
  const token = platformToken();
  if (!token) return;

  const text = pick(locale, {
    fa:
      "👋 <b>خوش آمدید به IrForge</b>\n\n" +
      "برای ادامه‌ی ثبت‌نام، شماره‌ی موبایلتان را با دکمه‌ی زیر به اشتراک بگذارید.\n\n" +
      "شماره را خودِ تلگرام تأیید و ارسال می‌کند — لازم نیست چیزی تایپ کنید.",
    en:
      "👋 <b>Welcome to IrForge</b>\n\n" +
      "To continue signing up, share your phone number with the button below.\n\n" +
      "Telegram sends the verified number itself — you don't need to type anything.",
    ar:
      "👋 <b>أهلًا بك في IrForge</b>\n\n" +
      "لمتابعة التسجيل، شارك رقم هاتفك عبر الزر أدناه.\n\n" +
      "يرسل تيليجرام الرقم المُوثّق بنفسه، فلا حاجة لكتابة أي شيء.",
    tr:
      "👋 <b>IrForge'a hoş geldiniz</b>\n\n" +
      "Kaydı sürdürmek için aşağıdaki düğmeyle telefon numaranızı paylaşın.\n\n" +
      "Doğrulanmış numarayı Telegram kendisi gönderir; bir şey yazmanıza gerek yok.",
    ru:
      "👋 <b>Добро пожаловать в IrForge</b>\n\n" +
      "Чтобы продолжить регистрацию, поделитесь номером телефона кнопкой ниже.\n\n" +
      "Подтверждённый номер отправляет сам Telegram — набирать ничего не нужно.",
  });

  const buttonText = pick(locale, {
    fa: "📱 ارسال شماره‌ی من",
    en: "📱 Share my number",
    ar: "📱 مشاركة رقمي",
    tr: "📱 Numaramı paylaş",
    ru: "📱 Отправить мой номер",
  });

  await tgApi(token, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_markup: {
      keyboard: [[{ text: buttonText, request_contact: true }]],
      resize_keyboard: true,
      one_time_keyboard: true,
    },
  }).catch((err) => logger.warn({ err }, "askForContact failed (non-fatal)"));
}

/** کد ثبت‌نام + برداشتن کیبورد. */
export async function sendRegistrationCode(
  chatId: string,
  code: string,
  locale?: Locale,
): Promise<void> {
  const token = platformToken();
  if (!token) return;

  const text = pick(locale, {
    fa:
      "🔐 <b>کد تأیید IrForge</b>\n\n" +
      `کد شما: <code>${code}</code>\n\n` +
      "این کد تا ۵ دقیقه معتبر است.\n" +
      "⚠️ همکاران ما هیچ‌وقت این کد را از شما نمی‌پرسند.",
    en:
      "🔐 <b>IrForge verification code</b>\n\n" +
      `Your code: <code>${code}</code>\n\n` +
      "It is valid for 5 minutes.\n" +
      "⚠️ Our staff will never ask you for this code.",
    ar:
      "🔐 <b>رمز تحقّق IrForge</b>\n\n" +
      `رمزك: <code>${code}</code>\n\n` +
      "صالح لمدة ٥ دقائق.\n" +
      "⚠️ لن يطلب منك فريقنا هذا الرمز أبدًا.",
    tr:
      "🔐 <b>IrForge doğrulama kodu</b>\n\n" +
      `Kodunuz: <code>${code}</code>\n\n` +
      "5 dakika geçerlidir.\n" +
      "⚠️ Ekibimiz bu kodu sizden asla istemez.",
    ru:
      "🔐 <b>Код подтверждения IrForge</b>\n\n" +
      `Ваш код: <code>${code}</code>\n\n` +
      "Действителен 5 минут.\n" +
      "⚠️ Наши сотрудники никогда не спросят у вас этот код.",
  });

  await tgApi(token, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_markup: { remove_keyboard: true },
  }).catch((err) => logger.warn({ err }, "sendRegistrationCode failed (non-fatal)"));
}

/** کد ورود. */
export async function sendLoginCode(
  chatId: string,
  code: string,
  locale?: Locale,
): Promise<void> {
  const token = platformToken();
  if (!token) return;

  const text = pick(locale, {
    fa:
      "🔑 <b>کد ورود IrForge</b>\n\n" +
      `کد شما: <code>${code}</code>\n\n` +
      "این کد تا ۵ دقیقه معتبر است.\n" +
      "اگر شما درخواست ورود نداده‌اید، رمز حسابتان را عوض کنید.\n" +
      "⚠️ همکاران ما هیچ‌وقت این کد را از شما نمی‌پرسند.",
    en:
      "🔑 <b>IrForge sign-in code</b>\n\n" +
      `Your code: <code>${code}</code>\n\n` +
      "It is valid for 5 minutes.\n" +
      "If you did not try to sign in, change your password.\n" +
      "⚠️ Our staff will never ask you for this code.",
    ar:
      "🔑 <b>رمز دخول IrForge</b>\n\n" +
      `رمزك: <code>${code}</code>\n\n` +
      "صالح لمدة ٥ دقائق.\n" +
      "إن لم تكن أنت من حاول الدخول فغيّر كلمة مرورك.\n" +
      "⚠️ لن يطلب منك فريقنا هذا الرمز أبدًا.",
    tr:
      "🔑 <b>IrForge giriş kodu</b>\n\n" +
      `Kodunuz: <code>${code}</code>\n\n` +
      "5 dakika geçerlidir.\n" +
      "Giriş denemesi size ait değilse şifrenizi değiştirin.\n" +
      "⚠️ Ekibimiz bu kodu sizden asla istemez.",
    ru:
      "🔑 <b>Код входа IrForge</b>\n\n" +
      `Ваш код: <code>${code}</code>\n\n` +
      "Действителен 5 минут.\n" +
      "Если вход пытались выполнить не вы — смените пароль.\n" +
      "⚠️ Наши сотрудники никогда не спросят у вас этот код.",
  });

  await sendTelegramMessage(token, chatId, text);
}

/** پیام ساده‌ی متنی به کاربر بات، با زبان انتخابی. */
export async function sendPlain(chatId: string, map: Record<string, string>, locale?: Locale) {
  const token = platformToken();
  if (!token) return;
  await sendTelegramMessage(token, chatId, pick(locale, map));
}
