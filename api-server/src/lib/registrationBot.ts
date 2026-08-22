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
import { sendSms } from "./smsSender";
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

/**
 * IRFORGE_PROMPT_V3 Phase 13 — "Telegram + SMS together": every OTP this
 * file sends now also goes out over SMS to the phone already collected
 * for this account (Telegram's own request_contact still verifies phone
 * *ownership* at registration time — SMS can't replace that, a bot can't
 * initiate a DM to a phone number — but once we have it, texting the same
 * code alongside the Telegram message means a slow/blocked Telegram
 * delivery doesn't strand the user mid-flow). sendSms itself never throws
 * and silently no-ops when SMS_GATEWAY_URL isn't configured, so callers
 * that don't pass a phone (or don't have SMS set up) behave exactly as
 * before.
 */
type CodeKind = "register" | "login" | "reset";

const SMS_CODE_TEMPLATES: Record<CodeKind, Record<string, (code: string) => string>> = {
  register: {
    fa: (c) => `کد تأیید IrForge: ${c}\nتا ۵ دقیقه معتبر است.`,
    en: (c) => `Your IrForge verification code: ${c}\nValid for 5 minutes.`,
    ar: (c) => `رمز تحقّق IrForge: ${c}\nصالح لمدة 5 دقائق.`,
    tr: (c) => `IrForge doğrulama kodu: ${c}\n5 dakika geçerlidir.`,
    ru: (c) => `Код подтверждения IrForge: ${c}\nДействителен 5 минут.`,
  },
  login: {
    fa: (c) => `کد ورود IrForge: ${c}\nتا ۵ دقیقه معتبر است.`,
    en: (c) => `Your IrForge sign-in code: ${c}\nValid for 5 minutes.`,
    ar: (c) => `رمز دخول IrForge: ${c}\nصالح لمدة 5 دقائق.`,
    tr: (c) => `IrForge giriş kodu: ${c}\n5 dakika geçerlidir.`,
    ru: (c) => `Код входа IrForge: ${c}\nДействителен 5 минут.`,
  },
  reset: {
    fa: (c) => `کد بازیابی رمز IrForge: ${c}\nتا ۱۵ دقیقه معتبر است.`,
    en: (c) => `Your IrForge password reset code: ${c}\nValid for 15 minutes.`,
    ar: (c) => `رمز استعادة كلمة المرور IrForge: ${c}\nصالح لمدة 15 دقيقة.`,
    tr: (c) => `IrForge şifre sıfırlama kodu: ${c}\n15 dakika geçerlidir.`,
    ru: (c) => `Код сброса пароля IrForge: ${c}\nДействителен 15 минут.`,
  },
};

function smsCodeText(code: string, locale: Locale, kind: CodeKind): string {
  return pick(locale, SMS_CODE_TEMPLATES[kind])(code);
}

async function sendCodeSms(phone: string | undefined, code: string, locale: Locale, kind: CodeKind): Promise<void> {
  if (!phone) return;
  await sendSms({ to: phone, text: smsCodeText(code, locale, kind) });
}

/** Password-reset code over SMS — the Telegram half of this message is
 * sent inline in routes/auth.ts (its wording differs enough from the
 * registration/login texts above that it isn't worth forcing through a
 * shared wrapper), so this is exported standalone for that call site. */
export async function sendResetCodeSms(phone: string | undefined, code: string, locale?: Locale): Promise<void> {
  await sendCodeSms(phone, code, locale, "reset");
}

/** کد ثبت‌نام + برداشتن کیبورد. */
export async function sendRegistrationCode(
  chatId: string,
  code: string,
  locale?: Locale,
  phone?: string,
): Promise<void> {
  const smsPromise = sendCodeSms(phone, code, locale, "register");
  const token = platformToken();
  if (!token) {
    await smsPromise;
    return;
  }

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

  await Promise.all([
    tgApi(token, "sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      reply_markup: { remove_keyboard: true },
    }).catch((err) => logger.warn({ err }, "sendRegistrationCode failed (non-fatal)")),
    smsPromise,
  ]);
}

/** کد ورود. */
export async function sendLoginCode(
  chatId: string,
  code: string,
  locale?: Locale,
  phone?: string,
): Promise<void> {
  const smsPromise = sendCodeSms(phone, code, locale, "login");
  const token = platformToken();
  if (!token) {
    await smsPromise;
    return;
  }

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

  await Promise.all([sendTelegramMessage(token, chatId, text), smsPromise]);
}

/** پیام ساده‌ی متنی به کاربر بات، با زبان انتخابی. */
export async function sendPlain(chatId: string, map: Record<string, string>, locale?: Locale) {
  const token = platformToken();
  if (!token) return;
  await sendTelegramMessage(token, chatId, pick(locale, map));
}

/**
 * «وارد شدی» — تأیید ورود یک‌کلیکی، با دکمه‌ی داشبورد زیرش.
 *
 * دکمه یک `inline_keyboard` است و نه یک لینک داخل متن: کاربری که بات را روی
 * گوشی باز کرده باید بتواند با یک لمس به داشبورد برود، نه اینکه یک URL بلند
 * را از میان متن پیدا کند.
 *
 * `dashboardUrl` یک لینکِ **یک‌بارمصرف** است (تیکت ورود)، پس اگر ساخته نشده
 * باشد — یعنی `PUBLIC_SITE_URL` تنظیم نیست — دکمه اصلاً رندر نمی‌شود. یک دکمه‌ی
 * داشبورد که به جای درستی نمی‌رود بدتر از نبودنش است.
 *
 * جمله‌ی هشدار عمداً هست: این جریان با یک لمس نشست می‌دهد، پس کسی که لینک
 * ورود را برای کاربر فرستاده باشد هم می‌تواند نشست بگیرد. کاربر باید بداند
 * که اگر خودش دکمه‌ای نزده، این پیام یعنی یک نفر دیگر تلاش کرده.
 */
export async function sendLoginApproved(
  chatId: string,
  displayName: string | null,
  dashboardUrl: string | null,
  locale?: Locale,
): Promise<void> {
  const token = platformToken();
  if (!token) return;

  const hi = displayName ? ` ${displayName}` : "";
  const text = pick(locale, {
    fa:
      `✅ <b>وارد شدید${hi}</b>\n\n` +
      "حساب شما از همین تلگرام شناسایی شد و ورود در مرورگرتان کامل شد.\n\n" +
      "⚠️ اگر شما روی سایت دکمه‌ی ورود را نزده‌اید، این پیام را نادیده بگیرید و رمز حسابتان را عوض کنید.",
    en:
      `✅ <b>You're signed in${hi}</b>\n\n` +
      "We recognised your account from this Telegram and completed the sign-in in your browser.\n\n" +
      "⚠️ If you did not tap sign in on the site, ignore this message and change your password.",
    ar:
      `✅ <b>تم تسجيل دخولك${hi}</b>\n\n` +
      "تعرّفنا على حسابك من تيليجرام وأكملنا الدخول في متصفحك.\n\n" +
      "⚠️ إن لم تضغط زر الدخول على الموقع، فتجاهل هذه الرسالة وغيّر كلمة مرورك.",
    tr:
      `✅ <b>Giriş yaptınız${hi}</b>\n\n` +
      "Hesabınızı bu Telegram üzerinden tanıdık ve tarayıcınızdaki girişi tamamladık.\n\n" +
      "⚠️ Sitede giriş düğmesine siz basmadıysanız bu mesajı yok sayın ve şifrenizi değiştirin.",
    ru:
      `✅ <b>Вы вошли${hi}</b>\n\n` +
      "Мы узнали ваш аккаунт по этому Telegram и завершили вход в браузере.\n\n" +
      "⚠️ Если вы не нажимали кнопку входа на сайте — проигнорируйте это сообщение и смените пароль.",
  });

  const buttonText = pick(locale, {
    fa: "🚀 رفتن به داشبورد",
    en: "🚀 Open dashboard",
    ar: "🚀 فتح لوحة التحكم",
    tr: "🚀 Panoyu aç",
    ru: "🚀 Открыть панель",
  });

  await tgApi(token, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    ...(dashboardUrl
      ? { reply_markup: { inline_keyboard: [[{ text: buttonText, url: dashboardUrl }]] } }
      : {}),
  }).catch((err) => logger.warn({ err }, "sendLoginApproved failed (non-fatal)"));
}

/**
 * ورود ممکن نشد.
 *
 * `no_account` تنها حالتی است که پیام راهنما دارد و نه فقط خطا: کاربری که
 * حسابش هنوز به تلگرام وصل نشده باید بداند دقیقاً چه کار کند، وگرنه همین‌جا
 * گیر می‌کند.
 */
export async function sendLoginRejected(
  chatId: string,
  reason: "no_account" | "expired" | "suspended",
  locale?: Locale,
): Promise<void> {
  const token = platformToken();
  if (!token) return;

  const map: Record<typeof reason, Record<string, string>> = {
    no_account: {
      fa:
        "❌ <b>حسابی با این تلگرام پیدا نشد</b>\n\n" +
        "اگر قبلاً در IrForge حساب دارید، یک‌بار از سایت با شماره و رمز وارد شوید و " +
        "حسابتان را به تلگرام وصل کنید؛ بعد از آن همین دکمه کافی است.\n\n" +
        "اگر حساب ندارید، از صفحه‌ی ثبت‌نام شروع کنید.",
      en:
        "❌ <b>No account matches this Telegram</b>\n\n" +
        "If you already have an IrForge account, sign in once on the site with your phone and " +
        "password and connect Telegram; after that this button is all you need.\n\n" +
        "If you don't have an account yet, start from the sign-up page.",
      ar:
        "❌ <b>لا يوجد حساب مرتبط بهذا التيليجرام</b>\n\n" +
        "إن كان لديك حساب في IrForge، سجّل الدخول مرة من الموقع برقمك وكلمة مرورك واربط تيليجرام؛ " +
        "بعدها يكفي هذا الزر.\n\nوإن لم يكن لديك حساب فابدأ من صفحة التسجيل.",
      tr:
        "❌ <b>Bu Telegram'a bağlı hesap yok</b>\n\n" +
        "IrForge hesabınız varsa siteden bir kez telefon ve şifrenizle girip Telegram'ı bağlayın; " +
        "sonrasında bu düğme yeterli.\n\nHesabınız yoksa kayıt sayfasından başlayın.",
      ru:
        "❌ <b>Аккаунт с этим Telegram не найден</b>\n\n" +
        "Если у вас уже есть аккаунт IrForge, войдите один раз на сайте по номеру и паролю и " +
        "привяжите Telegram — дальше хватит одной кнопки.\n\nЕсли аккаунта нет, начните с регистрации.",
    },
    expired: {
      fa: "⌛️ این لینک ورود منقضی شده است. از سایت دوباره روی «ورود با تلگرام» بزنید.",
      en: "⌛️ This sign-in link has expired. Tap “Sign in with Telegram” on the site again.",
      ar: "⌛️ انتهت صلاحية رابط الدخول. اضغط «تسجيل الدخول عبر تيليجرام» من الموقع مجددًا.",
      tr: "⌛️ Bu giriş bağlantısının süresi doldu. Sitede “Telegram ile giriş”e tekrar dokunun.",
      ru: "⌛️ Срок действия ссылки истёк. Нажмите «Войти через Telegram» на сайте ещё раз.",
    },
    suspended: {
      fa: "⛔️ این حساب موقتاً غیرفعال است. لطفاً با پشتیبانی تماس بگیرید.",
      en: "⛔️ This account is suspended. Please contact support.",
      ar: "⛔️ هذا الحساب موقوف. يرجى التواصل مع الدعم.",
      tr: "⛔️ Bu hesap askıya alınmış. Lütfen destek ile iletişime geçin.",
      ru: "⛔️ Этот аккаунт приостановлен. Свяжитесь с поддержкой.",
    },
  };

  await sendTelegramMessage(token, chatId, pick(locale, map[reason]));
}
