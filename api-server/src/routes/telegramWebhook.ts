/**
 * routes/telegramWebhook.ts — G8: "اتصال با ربات" + ثبت‌نام از داخل بات
 *
 * تلگرام آپدیت‌های بات پلتفرم (TELEGRAM_BOT_TOKEN) رو اینجا POST می‌کنه.
 * دو نوع توکن `/start <token>` وجود داره و روی `purpose` شاخه می‌خوره:
 *
 *   purpose = "link"      کاربرِ لاگین‌کرده حسابش رو وصل می‌کنه (رفتار قبلی،
 *                          دست‌نخورده).
 *   purpose = "register"  ثبت‌نام تازه: تلگرام وصل می‌شه، شماره با دکمه‌ی
 *                          request_contact گرفته می‌شه و کد فرستاده می‌شه.
 *
 * دو payload دیگه هم با پیشوند شناخته می‌شن و اصلاً به این جدول کاری ندارن:
 *   `upload_<id>`   «با بات بفرست» — ضبط پیام بعدی برای سایت.
 *   `tglogin_<id>`  ورود یک‌کلیکی — کاربر از روی `from.id` شناخته می‌شه و
 *                    نشستِ مرورگری که منتظره تأیید می‌شه (handleLoginStart).
 *
 * امنیت: تلگرام هدر X-Telegram-Bot-Api-Secret-Token رو با مقداری که موقع
 * setWebhook دادیم برمی‌گردونه؛ بدون تطابق این هدر، درخواست نادیده گرفته می‌شه.
 *
 * **ایدمپوتنسی**: تلگرام وبهوک‌های ناموفق رو retry می‌کنه، پس هر `update_id`
 * فقط یک‌بار پردازش می‌شه (جدول processed در حافظه + مصرف اتمیک توکن). بدون
 * این، یک retry می‌تونست کد دوم بفرسته یا توکن رو دوبار مصرف کنه.
 *
 * همیشه سریع 200 برمی‌گردونیم تا تلگرام رو retry-storm نکنیم؛ خطاها فقط لاگ
 * می‌شن و هیچ‌وقت از هندلر بیرون پرتاب نمی‌شن.
 */
import { Router } from "express";
import crypto from "crypto";
import {
  db,
  usersTable,
  telegramLinkTokensTable,
  pendingRegistrationsTable,
  telegramLoginRequestsTable,
} from "@workspace/db";
import { eq, and, ne, desc } from "drizzle-orm";
import { logger } from "../lib/logger";
import {
  sendTelegramMessage,
  telegramWebhookSecret,
  getTelegramUserPhotoFileId,
} from "../lib/telegram";
import {
  askForContact,
  sendRegistrationCode,
  sendPlain,
  sendLoginApproved,
  sendLoginRejected,
} from "../lib/registrationBot";
import {
  markWaiting,
  openSessionForChat,
  extractContent,
  fillSession,
} from "../lib/uploadSessions";
import { codeExpiry, generateCode, hashCode, normalizePhone } from "../lib/otp";

const router = Router();

function timingEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * `update_id`هایی که همین اینستنس تازه پردازش کرده.
 *
 * پوشش کاملِ چند-اینستنسی نیست و لازم هم نیست: عملیات‌های واقعاً حساس
 * (مصرف توکن، ارسال کد) خودشان با یک UPDATE شرطی اتمیک محافظت شده‌اند. این
 * فقط جلوی کار تکراری در حالت رایج retry را می‌گیرد.
 */
const seenUpdates = new Set<number>();
const SEEN_LIMIT = 1000;

function alreadyProcessed(updateId: unknown): boolean {
  if (typeof updateId !== "number") return false;
  if (seenUpdates.has(updateId)) return true;
  seenUpdates.add(updateId);
  if (seenUpdates.size > SEEN_LIMIT) {
    // قدیمی‌ترین‌ها را دور بریز — Set ترتیب درج را نگه می‌دارد.
    const drop = seenUpdates.values().next().value;
    if (drop !== undefined) seenUpdates.delete(drop);
  }
  return false;
}

router.post("/telegram/webhook", async (req, res) => {
  // پاسخ فوری — بقیه‌ی کار async و best-effort انجام می‌شه
  res.status(200).json({ ok: true });

  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) return;

    const expected = telegramWebhookSecret(botToken);
    const provided = req.headers["x-telegram-bot-api-secret-token"];
    if (typeof provided !== "string" || !timingEqual(provided, expected)) {
      logger.warn("Telegram webhook: invalid or missing secret token");
      return;
    }

    if (alreadyProcessed(req.body?.update_id)) return;

    const message = req.body?.message;
    const from = message?.from;
    const chat = message?.chat;
    if (!from || !chat || from.is_bot) return;

    const chatId = String(chat.id);

    // ── اشتراک‌گذاری شماره از دکمه‌ی request_contact ──────────────────────
    if (message.contact) {
      await handleContact(botToken, chatId, from, message.contact);
      return;
    }

    const text: string | undefined = message?.text;

    // ── «با بات بفرست»: پیام بعدی بعد از /start upload_<id> ───────────────
    //
    // قبل از شاخه‌ی `/start` چک می‌شود، چون محتوایی که کاربر می‌فرستد
    // هر شکلی می‌تواند داشته باشد (عکس، ویس، فوروارد، متن ساده) و هیچ‌کدام
    // به بقیه‌ی این هندلر ربطی ندارند. یک پیامِ `/start` عمداً ضبط **نمی‌شود**
    // تا کاربری که دوباره لینک را باز می‌کند، خودِ لینک را به‌عنوان محتوا
    // ثبت نکند.
    if (!text || !text.startsWith("/start")) {
      await tryCaptureUpload(botToken, chatId, message);
      return;
    }

    const token = text.trim().split(/\s+/)[1];
    if (!token) {
      await sendTelegramMessage(
        botToken,
        chatId,
        "سلام! 👋\n\n" +
          "برای <b>ورود</b> به IRForge، در صفحه‌ی ورودِ سایت روی «ورود با تلگرام» بزنید — " +
          "همان دکمه شما را به همین‌جا برمی‌گرداند و ورودتان کامل می‌شود.\n\n" +
          "برای <b>اتصال</b> حساب موجود، از پروفایل سایت روی «اتصال با ربات» بزنید."
      );
      return;
    }

    // ── `/start upload_<id>` — شروع ضبط ──────────────────────────────────
    if (token.startsWith("upload_")) {
      await handleUploadStart(botToken, chatId, token.slice("upload_".length));
      return;
    }

    // ── `/start tglogin_<id>` — ورود یک‌کلیکی ─────────────────────────────
    if (token.startsWith("tglogin_")) {
      await handleLoginStart(chatId, from, token.slice("tglogin_".length));
      return;
    }

    const now = new Date();
    const [row] = await db
      .select()
      .from(telegramLinkTokensTable)
      .where(eq(telegramLinkTokensTable.token, token))
      .limit(1);

    if (!row || row.used || row.expiresAt < now) {
      await sendTelegramMessage(
        botToken,
        chatId,
        "این لینک منقضی یا نامعتبر است. لطفاً از داخل سایت دوباره شروع کنید."
      );
      return;
    }

    if (row.purpose === "register") {
      await handleRegisterStart(botToken, chatId, from, row);
      return;
    }

    // ── purpose = "link": رفتار قبلی، بدون تغییر ─────────────────────────
    const telegramId = String(from.id);
    const existing = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.telegramId, telegramId))
      .limit(1);
    if (existing[0] && existing[0].id !== row.userId) {
      await sendTelegramMessage(
        botToken,
        chatId,
        "این حساب تلگرام قبلاً به یک حساب دیگر در IRForge وصل شده است."
      );
      return;
    }

    // توکن رو قبل از فراخوانی‌های شبکه‌ای مصرف کن (single-use، جلوگیری از
    // مصرف دوباره در صورت retry همزمان تلگرام)
    const consumed = await db
      .update(telegramLinkTokensTable)
      .set({ used: true })
      .where(and(eq(telegramLinkTokensTable.token, token), eq(telegramLinkTokensTable.used, false)))
      .returning();
    if (consumed.length === 0) return; // یه درخواست موازی دیگه قبلاً مصرفش کرده

    const photoFileId = await getTelegramUserPhotoFileId(botToken, from.id);
    const photoProxyUrl = photoFileId ? `/api/users/${row.userId}/telegram-photo` : null;

    const updateData: Record<string, any> = {
      telegramId,
      telegramUsername: from.username ?? null,
      telegramFirstName: from.first_name,
      telegramLastName: from.last_name ?? null,
      telegramPhotoFileId: photoFileId,
      telegramPhotoUrl: photoProxyUrl,
    };
    if (photoProxyUrl) updateData.avatar = photoProxyUrl;

    await db.update(usersTable).set(updateData).where(eq(usersTable.id, row.userId!));

    await sendTelegramMessage(botToken, chatId, "✅ حساب تلگرام شما با موفقیت به IRForge متصل شد.");
  } catch (err) {
    logger.error({ err }, "Telegram webhook error");
  }
});

/**
 * `/start <token>` با `purpose = "register"`.
 *
 * ترتیب عمدی است: اول بررسی «این تلگرام قبلاً کاربر دارد؟»، بعد مصرف اتمیک
 * توکن، بعد ذخیره، بعد درخواست شماره. اگر توکن زودتر مصرف می‌شد، یک کاربرِ
 * ردشده لینکش را هم از دست می‌داد.
 */
async function handleRegisterStart(
  botToken: string,
  chatId: string,
  from: any,
  tokenRow: typeof telegramLinkTokensTable.$inferSelect,
) {
  const pendingId = tokenRow.pendingRegistrationId;
  if (!pendingId) return;

  const [pending] = await db
    .select()
    .from(pendingRegistrationsTable)
    .where(eq(pendingRegistrationsTable.id, pendingId))
    .limit(1);
  if (!pending || pending.expiresAt < new Date()) {
    await sendTelegramMessage(
      botToken,
      chatId,
      "این لینک منقضی شده است. لطفاً دوباره از سایت شروع کنید."
    );
    return;
  }

  const telegramId = String(from.id);

  // یک حساب تلگرام، یک حساب پلتفرم. اگر مشترک باشد، عامل دوم بین دو حساب
  // مشترک می‌شود و دیگر عامل نیست.
  const [owned] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.telegramId, telegramId))
    .limit(1);
  if (owned) {
    await sendTelegramMessage(
      botToken,
      chatId,
      "این حساب تلگرام قبلاً به یک حساب IRForge وصل شده است. لطفاً از سایت وارد شوید."
    );
    return;
  }

  const consumed = await db
    .update(telegramLinkTokensTable)
    .set({ used: true })
    .where(
      and(
        eq(telegramLinkTokensTable.token, tokenRow.token),
        eq(telegramLinkTokensTable.used, false),
      ),
    )
    .returning();
  if (consumed.length === 0) return; // retry موازی — دوباره پیام نده

  const photoFileId = await getTelegramUserPhotoFileId(botToken, from.id);

  // ثبت‌نام‌های قدیمی‌تر همین چت را از آن جدا کن.
  //
  // بدون این، یک کاربر که دوبار ثبت‌نام را شروع کرده باشد چند ردیف با یک
  // `telegram_chat_id` می‌ساخت و `handleContact` نمی‌دانست کدام‌یک زنده است.
  // یک چت در هر لحظه فقط یک ثبت‌نام در جریان دارد.
  await db
    .update(pendingRegistrationsTable)
    .set({ telegramChatId: null })
    .where(
      and(
        eq(pendingRegistrationsTable.telegramChatId, chatId),
        ne(pendingRegistrationsTable.id, pendingId),
      ),
    );

  await db
    .update(pendingRegistrationsTable)
    .set({
      telegramId,
      telegramChatId: chatId,
      telegramUsername: from.username ?? null,
      telegramFirstName: from.first_name ?? null,
      telegramLastName: from.last_name ?? null,
      telegramPhotoFileId: photoFileId,
      step: "telegram_pending",
      lastActivityAt: new Date(),
    })
    .where(eq(pendingRegistrationsTable.id, pendingId));

  logger.info({ registrationId: pendingId }, "Registration: Telegram connected, asking for contact");
  await askForContact(chatId, pending.locale);
}

/**
 * پیام `message.contact` — کاربر دکمه‌ی اشتراک شماره را زده.
 *
 * **بررسی حیاتی:** `contact.user_id` باید با `from.id` یکی باشد. تلگرام اجازه
 * می‌دهد کاربر کارت مخاطبِ **هر کسی** را از همین دکمه بفرستد؛ بدون این بررسی،
 * می‌شد با شماره‌ای که مالکش نیستی ثبت‌نام کرد.
 */
async function handleContact(botToken: string, chatId: string, from: any, contact: any) {
  // **جدیدترین** ردیف را بردار، نه هر ردیفی که دیتابیس اول برگرداند.
  //
  // این همان باگی بود که بات را لال می‌کرد: اگر کاربر قبلاً یک‌بار ثبت‌نام را
  // شروع کرده بود، چند ردیف با همین `chatId` وجود داشت و این کوئری — بدون
  // ORDER BY — معمولاً قدیمی‌ترین را برمی‌داشت. آن ردیف یا منقضی بود یا از
  // قبل روی `code_sent`، پس هر دو شرط پایین `return` می‌کردند و کاربر هیچ
  // پاسخی نمی‌گرفت، در حالی که ثبت‌نام تازه‌اش تا ابد روی `telegram_pending`
  // منتظر می‌ماند.
  const candidates = await db
    .select()
    .from(pendingRegistrationsTable)
    .where(eq(pendingRegistrationsTable.telegramChatId, chatId))
    .orderBy(desc(pendingRegistrationsTable.lastActivityAt))
    .limit(5);

  const now = new Date();
  const pending = candidates.find(
    (row) => row.step === "telegram_pending" && row.expiresAt >= now,
  );

  if (!pending) {
    // چیزی برای پیش بردن نیست — ولی سکوت بدترین جواب است. کاربر همین الان
    // شماره‌اش را فرستاده و منتظر است.
    if (candidates.length === 0) return;
    const stale = candidates[0];
    await sendPlain(
      chatId,
      {
        fa: "این ثبت‌نام دیگر فعال نیست. لطفاً از سایت دوباره شروع کنید و روی «باز کردن تلگرام» بزنید.",
        en: "That registration is no longer active. Please start again on the site and tap “Open Telegram”.",
        ar: "هذا التسجيل لم يعد نشطًا. ابدأ من جديد على الموقع واضغط «فتح تيليجرام».",
        tr: "Bu kayıt artık aktif değil. Siteden yeniden başlayıp “Telegram'ı aç” düğmesine dokunun.",
        ru: "Эта регистрация больше не активна. Начните заново на сайте и нажмите «Открыть Telegram».",
      },
      stale.locale,
    );
    return;
  }

  if (String(contact.user_id ?? "") !== String(from.id)) {
    logger.warn({ registrationId: pending.id }, "Registration: forwarded contact rejected");
    await sendPlain(
      chatId,
      {
        fa: "⚠️ این شماره متعلق به حساب شما نیست. لطفاً با دکمه‌ی «ارسال شماره‌ی من» شماره‌ی خودتان را بفرستید.",
        en: "⚠️ That contact isn't yours. Please use the “Share my number” button to send your own number.",
        ar: "⚠️ هذا الرقم ليس رقمك. استخدم زر «مشاركة رقمي» لإرسال رقمك أنت.",
        tr: "⚠️ Bu numara size ait değil. Kendi numaranızı “Numaramı paylaş” düğmesiyle gönderin.",
        ru: "⚠️ Этот контакт не ваш. Отправьте свой номер кнопкой «Отправить мой номер».",
      },
      pending.locale,
    );
    await askForContact(chatId, pending.locale);
    return;
  }

  const phone = normalizePhone(contact.phone_number);
  if (!phone) {
    await sendPlain(
      chatId,
      {
        fa: "شماره‌ی دریافتی معتبر نبود. لطفاً دوباره تلاش کنید.",
        en: "That number wasn't valid. Please try again.",
        ar: "الرقم غير صالح. حاول مرة أخرى.",
        tr: "Numara geçersizdi. Lütfen tekrar deneyin.",
        ru: "Номер оказался некорректным. Попробуйте ещё раз.",
      },
      pending.locale,
    );
    return;
  }

  const [taken] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.phone, phone))
    .limit(1);
  if (taken) {
    await sendPlain(
      chatId,
      {
        fa: "این شماره قبلاً در IRForge ثبت شده است. لطفاً از سایت وارد شوید.",
        en: "This number is already registered with IRForge. Please sign in on the site.",
        ar: "هذا الرقم مسجّل بالفعل في IRForge. سجّل الدخول من الموقع.",
        tr: "Bu numara IRForge'da zaten kayıtlı. Lütfen siteden giriş yapın.",
        ru: "Этот номер уже зарегистрирован в IRForge. Войдите на сайте.",
      },
      pending.locale,
    );
    return;
  }

  const code = generateCode();

  // ارسال کد فقط اگر همین حالا هنوز در گام telegram_pending باشیم — همان
  // UPDATE شرطی که یک retry موازی را از فرستادن کد دوم بازمی‌دارد.
  const advanced = await db
    .update(pendingRegistrationsTable)
    .set({
      phone,
      codeHash: hashCode(code),
      codeExpiresAt: codeExpiry(),
      codeSentCount: (pending.codeSentCount ?? 0) + 1,
      codeAttempts: 0,
      step: "code_sent",
      lastActivityAt: new Date(),
    })
    .where(
      and(
        eq(pendingRegistrationsTable.id, pending.id),
        eq(pendingRegistrationsTable.step, "telegram_pending"),
      ),
    )
    .returning({ id: pendingRegistrationsTable.id });
  if (advanced.length === 0) return;

  logger.info({ registrationId: pending.id }, "Registration: phone verified, code sent");
  await sendRegistrationCode(chatId, code, pending.locale, phone);
}

/**
 * `/start tglogin_<id>` — ورود یک‌کلیکی.
 *
 * هیچ توکنی از سایت هویت را ثابت نمی‌کند؛ **`from.id` این کار را می‌کند**.
 * آن عدد را تلگرام روی وبهوکِ امضاشده می‌فرستد، نه کاربر — پس اگر ردیفی در
 * `users` با همان `telegram_id` باشد، همان کاربر است. شناسه‌ی داخل لینک فقط
 * می‌گوید «کدام مرورگر منتظر است»، نه «چه کسی هستی».
 *
 * تنها چیزی که «وارد شدید» را یک‌بار نگه می‌دارد، همان UPDATE شرطیِ
 * `status = 'pending'` است: هر مسیری که به پیام می‌رسد اول باید آن گذار را
 * برنده شود. تلگرام وبهوک را retry می‌کند و `alreadyProcessed` فقط داخل یک
 * اینستنس کار می‌کند، پس بدون این گذارِ اتمیک دو نشست و دو پیام ممکن بود.
 */
async function handleLoginStart(chatId: string, from: any, requestId: string) {
  const [row] = await db
    .select()
    .from(telegramLoginRequestsTable)
    .where(eq(telegramLoginRequestsTable.id, requestId))
    .limit(1);

  if (!row) {
    await sendLoginRejected(chatId, "expired");
    return;
  }
  const telegramId = String(from.id);

  if (row.status !== "pending" || row.expiresAt < new Date()) {
    /**
     * سکوت وقتی همین کاربر همین درخواست را قبلاً تأیید کرده.
     *
     * تلگرام وبهوک را retry می‌کند و کاربر هم گاهی دوبار روی «شروع» می‌زند.
     * `alreadyProcessed` فقط داخل یک اینستنس کار می‌کند، پس بدون این، کسی که
     * همین الان «وارد شدید» گرفته بلافاصله یک «لینک منقضی شده» هم می‌گرفت و
     * فکر می‌کرد ورودش خراب شده. برای هر حالت دیگری — لینکِ واقعاً کهنه، یا
     * لینکِ کسِ دیگری — پیام منقضی درست است.
     */
    if (
      (row.status === "approved" || row.status === "consumed") &&
      row.userId &&
      (await isOwnedByTelegramUser(row.userId, telegramId))
    ) {
      return;
    }
    await sendLoginRejected(chatId, "expired", row.locale);
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.telegramId, telegramId))
    .limit(1);

  if (!user) {
    // درخواست را می‌کُشیم تا مرورگر تا ابد نچرخد و پیام درست را نشان بدهد.
    await db
      .update(telegramLoginRequestsTable)
      .set({ status: "rejected", rejectedReason: "no_account" })
      .where(
        and(
          eq(telegramLoginRequestsTable.id, row.id),
          eq(telegramLoginRequestsTable.status, "pending"),
        ),
      );
    await sendLoginRejected(chatId, "no_account", row.locale);
    return;
  }

  if (user.status === "banned" || user.status === "suspended") {
    await db
      .update(telegramLoginRequestsTable)
      .set({ status: "rejected", rejectedReason: "suspended" })
      .where(
        and(
          eq(telegramLoginRequestsTable.id, row.id),
          eq(telegramLoginRequestsTable.status, "pending"),
        ),
      );
    await sendLoginRejected(chatId, "suspended", row.locale);
    return;
  }

  const webTicket = crypto.randomBytes(24).toString("hex");
  const approved = await db
    .update(telegramLoginRequestsTable)
    .set({
      status: "approved",
      userId: user.id,
      webTicket,
      approvedAt: new Date(),
    })
    .where(
      and(
        eq(telegramLoginRequestsTable.id, row.id),
        eq(telegramLoginRequestsTable.status, "pending"),
      ),
    )
    .returning({ id: telegramLoginRequestsTable.id });
  if (approved.length === 0) return; // retry موازی — پیام دوم نده

  /**
   * دکمه‌ی داشبورد یک لینکِ ورود است، نه فقط آدرس صفحه: کسی که بات را روی
   * گوشی باز کرده معمولاً در آن مرورگر لاگین نیست، و فرستادنش به یک صفحه‌ی
   * محافظت‌شده فقط او را به صفحه‌ی ورود می‌اندازد.
   */
  const siteUrl = process.env.PUBLIC_SITE_URL?.trim().replace(/\/+$/, "");
  const dashboardUrl = siteUrl
    ? `${siteUrl}/auth/telegram?ticket=${webTicket}`
    : null;
  if (!siteUrl) {
    logger.warn("PUBLIC_SITE_URL is not set; Telegram login message has no dashboard button");
  }

  const displayName = user.telegramFirstName ?? user.name ?? null;
  logger.info({ userId: user.id }, "Telegram one-tap login approved");
  await sendLoginApproved(chatId, displayName, dashboardUrl, row.locale);
}

/** آیا این کاربرِ سایت همان کسی است که الان دارد با تلگرام حرف می‌زند؟ */
async function isOwnedByTelegramUser(userId: string, telegramId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(eq(usersTable.id, userId), eq(usersTable.telegramId, telegramId)))
    .limit(1);
  return Boolean(row);
}

/**
 * `/start upload_<id>` — جلسه را منتظر پیام بعدی می‌کند.
 *
 * پیام تأیید عمداً می‌گوید **چه چیزهایی** قابل فرستادن است: کاربری که فقط
 * «حالا بفرست» ببیند نمی‌داند می‌تواند یک پیام را فوروارد کند.
 */
async function handleUploadStart(botToken: string, chatId: string, sessionId: string) {
  const session = await markWaiting(sessionId, chatId);
  if (!session) {
    await sendTelegramMessage(
      botToken,
      chatId,
      "این لینک منقضی شده یا قبلاً استفاده شده است. از داخل سایت دوباره روی «ارسال با بات» بزنید."
    );
    return;
  }
  await sendTelegramMessage(
    botToken,
    chatId,
    "📨 <b>منتظر پیام شما هستم.</b>\n\n" +
      "همین حالا پیامی که می‌خواهید در سایت استفاده شود را بفرستید — متن، عکس، ویس، " +
      "یا یک پیام فوروارد‌شده. اولین پیامی که بفرستید ثبت می‌شود."
  );
}

/**
 * ضبط پیام برای جلسه‌ی بازِ این چت.
 *
 * اگر جلسه‌ی بازی نباشد **بی‌صدا رد می‌شود** — این هندلر روی هر پیامی که به
 * بات پلتفرم می‌رسد صدا زده می‌شود و نباید به گپ‌وگفت عادی جواب بدهد.
 */
async function tryCaptureUpload(botToken: string, chatId: string, message: any) {
  const session = await openSessionForChat(chatId);
  if (!session) return;

  const extracted = extractContent(message);
  if (!extracted) {
    await sendTelegramMessage(
      botToken,
      chatId,
      "این نوع پیام پشتیبانی نمی‌شود. متن، عکس، ویس، صوت، ویدیو یا فایل بفرستید."
    );
    return;
  }

  const filled = await fillSession(session.id, extracted);
  if (!filled) return; // یک ضبط موازی زودتر رسیده

  const siteUrl = process.env.PUBLIC_SITE_URL?.trim();
  await sendTelegramMessage(
    botToken,
    chatId,
    "✅ <b>پیام شما ثبت شد.</b>\n\nبه صفحه‌ی سایت برگردید؛ همان‌جا نمایش داده می‌شود." +
      (siteUrl ? `\n\n${siteUrl}` : "")
  );
}

export default router;
