#!/usr/bin/env node
/**
 * scripts/seedGolazinPanels.mjs — یک‌بار-اجراست، نه بخشی از اپ.
 *
 * ── چرا این اسکریپت به‌جایِ ساختنِ دستیِ ۲۰ پنل ──────────────────────────
 * کاربر متنِ کاملِ نقشه‌یِ باتِ «گل‌آذین» (یک باتِ نمایشگاهی: صفحه‌یِ شروع،
 * ویدئو، ۶ زیرصفحه‌یِ «تجربه‌ها»، ۸ زیرصفحه‌یِ «امکانات»، گالری، تماس — ۲۰
 * پنل با دکمه‌هایِ متقابل) را پیوست کرد و خواست واقعاً ساخته شود. این
 * Claude Code، بدونِ داشتنِ توکنِ بیرر یا botId واقعیِ کاربر (این سندباکس
 * اصلاً به production دسترسی ندارد)، نمی‌تواند مستقیماً آن را بسازد — پس
 * به‌جایِ یک اسکریپتِ نوشتنِ خام رویِ Google Sheets (که کلِ ولیدیشن/
 * پدر-فرزندی/بازسازیِ children را که routes/botPanels.ts دارد باید از نو
 * پیاده کند، با خطرِ واقعیِ ناهماهنگی)، همینِ REST API واقعی را که پنلِ
 * وب هم استفاده می‌کند صدا می‌زند — یعنی همان ولیدیشن، همان قانونِ
 * «دکمه‌ی url فقط https://» (IRFORGE_BOOKING_FORM_CONTACT_REFERRAL_PROMPT)،
 * همان بازسازیِ children، بدونِ هیچ کدِ دوم.
 *
 * ── محدودیتِ صادقانه‌ای که باید بدانید ──────────────────────────────────
 * صفحه‌ی ۶ی متنِ اصلیِ کاربر یک دکمه‌ی «📞 تماس با گل‌آذین → لینکِ شماره
 * تلفن» می‌خواست. تلگرام دکمه‌ی inline با لینکِ tel: قبول نمی‌کند — کلِ
 * پیام fail می‌شود (دقیقاً همان چیزی که همین پرامپت، بخشِ ۴، برایِ پلاگینِ
 * booking گزارش و رفع کرد). اینجا هم همان قاعده اعمال شده: شماره‌تلفن در
 * *متنِ* صفحه‌ی تماس نوشته می‌شود (تلگرام خودش آن را رویِ موبایل قابل‌تماس
 * می‌کند)، نه یک دکمه؛ فقط لینکِ پیام (واتساپ/تلگرام، https://) دکمه است.
 * ولی این اسکریپت شماره/لینکِ *واقعیِ* گل‌آذین را ندارد — پایین همین فایل
 * (GOLAZIN_PHONE_PLACEHOLDER/GOLAZIN_WHATSAPP_PLACEHOLDER) دو placeholder
 * گذاشته شده که باید قبل از اجرا با مقدارِ واقعی جایگزین شوند.
 *
 * ویدئوی صفحه‌ی ۲ («ویدئوی معرفیِ ۳۵ ثانیه‌ای») هم همین‌طور: بات فقط با
 * file_idِ واقعاً آپلودشده در تلگرام کار می‌کند، نه یک URL — این اسکریپت
 * فقط متنِ توضیحی برایِ آن پنل می‌گذارد؛ خودِ ویدئو باید بعداً از پنلِ وب
 * (بخشِ پنل‌ها → همان پنل → آپلودِ مدیا) اضافه شود.
 *
 * ── نحوه‌ی اجرا ──────────────────────────────────────────────────────────
 *   1. از سایتِ واقعیِ IRFORGE با اکانتِ صاحبِ باتِ گل‌آذین لاگین کن.
 *   2. توکن را از DevTools → Application → Local Storage → کلیدِ
 *      "irforge_token" کپی کن (همان چیزی که lib/auth-token.ts ذخیره می‌کند).
 *   3. آیدیِ بات را از URLِ همان بات در داشبورد بردار (.../bots/<botId>).
 *   4. GOLAZIN_PHONE_PLACEHOLDER و GOLAZIN_WHATSAPP_PLACEHOLDER پایین را با
 *      مقدارِ واقعی عوض کن.
 *   5. اجرا:
 *        IRFORGE_BASE_URL=https://your-real-domain \
 *        IRFORGE_TOKEN=<your bearer token> \
 *        IRFORGE_BOT_ID=<your bot id> \
 *        node scripts/seedGolazinPanels.mjs
 *   اسکریپت idempotent نیست — روی یک بات که از قبل این پنل‌ها را دارد
 *   دوباره اجرا نکنید (پنل‌هایِ تکراری می‌سازد).
 */

const BASE_URL = process.env.IRFORGE_BASE_URL;
const TOKEN = process.env.IRFORGE_TOKEN;
const BOT_ID = process.env.IRFORGE_BOT_ID;

if (!BASE_URL || !TOKEN || !BOT_ID) {
  console.error(
    "لازم است IRFORGE_BASE_URL و IRFORGE_TOKEN و IRFORGE_BOT_ID را به‌عنوانِ متغیرِ محیطی بدهید — بالایِ همین فایل توضیح داده شده.",
  );
  process.exit(1);
}

// ── placeholderهایِ شماره‌تماس/لینکِ پیامِ واقعیِ گل‌آذین — قبل از اجرا عوض کنید ──
const GOLAZIN_PHONE_PLACEHOLDER = "+98912xxxxxxx";
const GOLAZIN_WHATSAPP_PLACEHOLDER = "https://wa.me/98912xxxxxxx";

async function api(path, options = {}) {
  const res = await fetch(`${BASE_URL}/api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
      ...(options.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${options.method ?? "GET"} ${path} → ${res.status}: ${body.error ?? JSON.stringify(body)}`);
  }
  return body;
}

/**
 * هر پنل با یک کلیدِ محلی (مثلاً "home") مشخص می‌شود، نه یک id واقعی —
 * id واقعی را فقط بعدِ ساختنِ خودِ پنل از سرور می‌گیریم. دکمه‌ها در قدمِ اول
 * با همین کلیدها نوشته می‌شوند و در قدمِ دوم (بعدِ ساختنِ همه‌ی پنل‌ها) به
 * id واقعی ترجمه و با PATCH ذخیره می‌شوند — چون یک پنل می‌تواند به پنلی
 * لینک بدهد که هنوز ساخته نشده (مثلاً همه به "۶ تماس" لینک می‌دهند).
 */
const PANELS = [
  {
    key: "home",
    title: "🏠 خانه",
    isHome: true,
    content:
      "🌿 به گل‌آذین خوش آمدید\n\nگل‌آذین فضایی خصوصی در دل طبیعت است؛\nجایی برای ساختن تجربه‌هایی متفاوت برای مناسبت‌های خاص.\n\nاینجا می‌توانید با فضای گل‌آذین، نمونه تجربه‌ها و امکانات آن آشنا شوید.",
    buttons: [
      { label: "🎬 گل‌آذین را ببینید", target: "video" },
      { label: "✨ تجربه‌های گل‌آذین", target: "experiences" },
      { label: "🎨 امکانات گل‌آذین", target: "amenities" },
      { label: "📸 گالری", target: "gallery" },
      { label: "📞 تماس با گل‌آذین", target: "contact" },
    ],
  },
  {
    key: "video",
    title: "🎬 گل‌آذین را ببینید",
    content:
      "(ویدئوی معرفیِ ۳۵ ثانیه‌ایِ گل‌آذین را از همین پنل، تبِ «رسانه»، آپلود کنید — تلگرام فقط با فایلِ واقعاً آپلودشده کار می‌کند.)\n\nگل‌آذین را می‌توان برای مناسبت‌های مختلف، متناسب با نوع برنامه و سلیقه شما آماده کرد.",
    buttons: [
      { label: "✨ تجربه‌های گل‌آذین", target: "experiences" },
      { label: "🎨 امکانات گل‌آذین", target: "amenities" },
      { label: "📞 می‌خواهم بیشتر بدانم", target: "contact" },
      { label: "🏠 صفحه اصلی", target: "home" },
    ],
  },
  {
    key: "experiences",
    title: "✨ تجربه‌های گل‌آذین",
    content: "در گل‌آذین می‌توان تجربه‌های مختلفی طراحی کرد؛ از یک دورهمی ساده تا یک مناسبت کاملاً اختصاصی.",
    buttons: [
      { label: "🎂 تولد و سالگرد", target: "exp_birthday" },
      { label: "❤️ قرار و تجربه دونفره", target: "exp_couple" },
      { label: "🎁 سورپرایز", target: "exp_surprise" },
      { label: "👨‍👩‍👧 دورهمی و مهمانی خصوصی", target: "exp_gathering" },
      { label: "💼 جلسه و ورک‌شاپ", target: "exp_workshop" },
      { label: "📸 عکاسی و تولید محتوا", target: "exp_photo" },
      { label: "🌿 یک ایده متفاوت دارم", target: "contact" },
      { label: "🏠 صفحه اصلی", target: "home" },
    ],
  },
  {
    key: "exp_birthday",
    title: "🎂 تولد و سالگرد",
    content:
      "تولد، سالگرد و مناسبت‌های شخصی را می‌توان در گل‌آذین به شکل اختصاصی طراحی کرد.\n\nاز چیدمان و فضای مناسب گرفته تا کیک، گل‌آرایی، شمع، موسیقی و پذیرایی.\n\nهر مناسبت می‌تواند شکل خودش را داشته باشد.",
    buttons: [
      { label: "📸 دیدن نمونه‌ها", target: "gallery" },
      { label: "🎨 امکانات قابل اجرا", target: "amenities" },
      { label: "📞 مشاوره و اطلاعات بیشتر", target: "contact" },
      { label: "⬅️ بازگشت", target: "experiences" },
    ],
  },
  {
    key: "exp_couple",
    title: "❤️ قرار و تجربه دونفره",
    content:
      "یک فضای خصوصی و آرام برای یک قرار متفاوت؛\nبا امکان طراحی فضا، نور، گل، شمع، نوشیدنی و جزئیات متناسب با مناسبت.",
    buttons: [
      { label: "📸 دیدن نمونه‌ها", target: "gallery" },
      { label: "📞 اطلاعات بیشتر", target: "contact" },
      { label: "⬅️ بازگشت", target: "experiences" },
    ],
  },
  {
    key: "exp_surprise",
    title: "🎁 سورپرایز",
    content:
      "گاهی مهم‌ترین قسمت یک مناسبت، لحظه‌ای است که قرار است اتفاق بیفتد.\n\nدر گل‌آذین می‌توان مسیر ورود، فضا، موسیقی، گل، شمع، کیک و جزئیات دیگر را برای ساختن یک سورپرایز متفاوت هماهنگ کرد.",
    buttons: [
      { label: "📸 دیدن نمونه‌ها", target: "gallery" },
      { label: "🎨 امکانات", target: "amenities" },
      { label: "📞 صحبت با گل‌آذین", target: "contact" },
      { label: "⬅️ بازگشت", target: "experiences" },
    ],
  },
  {
    key: "exp_gathering",
    title: "👨‍👩‍👧 دورهمی و مهمانی خصوصی",
    content:
      "گل‌آذین می‌تواند برای دورهمی‌های خانوادگی، دوستانه و مهمانی‌های خصوصی آماده شود.\n\nچیدمان فضا، پذیرایی، موسیقی و استفاده از محیط باغ و گلخانه می‌تواند متناسب با برنامه تغییر کند.",
    buttons: [
      { label: "📸 گالری", target: "gallery" },
      { label: "🎨 امکانات", target: "amenities" },
      { label: "📞 اطلاعات بیشتر", target: "contact" },
      { label: "⬅️ بازگشت", target: "experiences" },
    ],
  },
  {
    key: "exp_workshop",
    title: "💼 جلسه و ورک‌شاپ",
    content:
      "فضایی متفاوت برای جلسات کوچک، نشست‌های خصوصی، ورک‌شاپ‌ها و برنامه‌های گروهی.\n\nامکان استفاده از فضای کافه، گلخانه، باغ و چیدمان متناسب با نوع برنامه وجود دارد.",
    buttons: [
      { label: "📸 گالری", target: "gallery" },
      { label: "📞 اطلاعات بیشتر", target: "contact" },
      { label: "⬅️ بازگشت", target: "experiences" },
    ],
  },
  {
    key: "exp_photo",
    title: "📸 عکاسی و تولید محتوا",
    content: "فضای طبیعی، گلخانه، باغ و کافه می‌توانند برای عکاسی، تولید محتوا و پروژه‌های تصویری مورد استفاده قرار بگیرند.",
    buttons: [
      { label: "📸 دیدن فضا", target: "gallery" },
      { label: "📞 هماهنگی", target: "contact" },
      { label: "⬅️ بازگشت", target: "experiences" },
    ],
  },
  {
    key: "amenities",
    title: "🎨 امکانات گل‌آذین",
    content: "گل‌آذین فقط یک فضا نیست.\n\nبسته به نوع برنامه، امکانات مختلفی می‌توانند در کنار هم قرار بگیرند:",
    buttons: [
      { label: "☕ قهوه و نوشیدنی", target: "am_coffee" },
      { label: "🎂 کیک اختصاصی", target: "am_cake" },
      { label: "🌸 گل‌آرایی", target: "am_flowers" },
      { label: "🕯️ شمع دست‌ساز", target: "am_candle" },
      { label: "🪴 فضای سبز و گلخانه", target: "am_greenery" },
      { label: "🪑 چیدمان اختصاصی", target: "am_layout" },
      { label: "🚪 طراحی مسیر ورود", target: "am_entrance" },
      { label: "🎵 موسیقی و فضای مراسم", target: "am_music" },
      { label: "📞 درباره برنامه شما صحبت کنیم", target: "contact" },
      { label: "🏠 صفحه اصلی", target: "home" },
    ],
  },
  {
    key: "am_coffee",
    title: "☕ قهوه و نوشیدنی",
    content: "پذیرایی می‌تواند متناسب با نوع برنامه شامل قهوه، نوشیدنی‌های گرم، دمنوش‌های گیاهی و میوه‌ای و سایر گزینه‌های مناسب باشد.",
    buttons: [{ label: "📞 اطلاعات بیشتر", target: "contact" }],
  },
  {
    key: "am_cake",
    title: "🎂 کیک اختصاصی",
    content: "کیک می‌تواند متناسب با مناسبت و فضای طراحی‌شده، اختصاصی آماده شود.\n\nاز یک طراحی ساده و ظریف تا یک کیک کاملاً متناسب با ایده شما.",
    buttons: [{ label: "📞 سفارش و هماهنگی", target: "contact" }],
  },
  {
    key: "am_flowers",
    title: "🌸 گل‌آرایی",
    content: "گل‌آرایی می‌تواند بخشی از میز، فضای مراسم، مسیر ورود یا محل عکاسی باشد.\n\nامکان استفاده از گل‌های تازه، خشک و عناصر طبیعی وجود دارد.",
    buttons: [{ label: "📞 هماهنگی", target: "contact" }],
  },
  {
    key: "am_candle",
    title: "🕯️ شمع دست‌ساز",
    content: "شمع‌های دست‌ساز می‌توانند برای تزئین فضا، میز یا یک مناسبت خاص طراحی شوند و حتی به عنوان یادگاری مورد استفاده قرار گیرند.",
    buttons: [{ label: "📞 اطلاعات بیشتر", target: "contact" }],
  },
  {
    key: "am_greenery",
    title: "🪴 فضای سبز و گلخانه",
    content: "یکی از ویژگی‌های اصلی گل‌آذین، ترکیب فضای کافه با باغ، گلخانه و طبیعت است.\n\nاین فضاها بسته به نوع برنامه می‌توانند بخشی از تجربه شما باشند.",
    buttons: [
      { label: "📸 دیدن فضا", target: "gallery" },
      { label: "📞 اطلاعات بیشتر", target: "contact" },
    ],
  },
  {
    key: "am_layout",
    title: "🪑 چیدمان اختصاصی",
    content: "چیدمان میز و صندلی‌ها می‌تواند متناسب با نوع برنامه تغییر کند؛\n\nاز یک فضای دونفره و صمیمی تا دورهمی، مهمانی، جلسه یا ورک‌شاپ.",
    buttons: [
      { label: "📸 دیدن نمونه‌ها", target: "gallery" },
      { label: "📞 هماهنگی", target: "contact" },
    ],
  },
  {
    key: "am_entrance",
    title: "🚪 طراحی مسیر ورود",
    content: "تجربه می‌تواند از همان لحظه ورود آغاز شود.\n\nمسیر ورودی می‌تواند با گیاه، گل، نور، شمع و عناصر طبیعی متناسب با مناسبت آماده شود.",
    buttons: [
      { label: "📸 دیدن نمونه‌ها", target: "gallery" },
      { label: "📞 اطلاعات بیشتر", target: "contact" },
    ],
  },
  {
    key: "am_music",
    title: "🎵 موسیقی و فضای مراسم",
    content: "موسیقی، نور و چیدمان می‌توانند متناسب با حال‌وهوای برنامه تنظیم شوند تا فضای مناسبت با تجربه‌ای که طراحی شده هماهنگ باشد.",
    buttons: [{ label: "📞 هماهنگی", target: "contact" }],
  },
  {
    key: "gallery",
    title: "📸 گالری",
    content:
      "📸 گل‌آذین را در تصاویر ببینید\n\n" +
      "🌿 فضای گل‌آذین — عکس‌های باغ، گلخانه و کافه\n" +
      "🎂 مناسبت‌ها — تولد، سالگرد و مهمانی\n" +
      "🌸 گل‌آرایی و چیدمان — نمونه‌های تزئین\n" +
      "🕯️ شمع و جزئیات — نمونه شمع و دکور\n" +
      "☕ پذیرایی — قهوه، دمنوش و میز پذیرایی\n\n" +
      "(تصاویرِ واقعیِ هر دسته را از همین پنل، تبِ «رسانه»، آپلود کنید.)",
    buttons: [
      { label: "📞 این فضا را می‌خواهم", target: "contact" },
      { label: "🏠 صفحه اصلی", target: "home" },
    ],
  },
  {
    key: "contact",
    title: "📞 تماس با گل‌آذین",
    // شماره در متن، نه دکمه — تلگرام دکمه‌ی inline با لینکِ tel: را رد
    // می‌کند (بالایِ فایل، بخشِ «محدودیتِ صادقانه» را ببینید).
    content:
      "🌿 اگر برای مناسبت خودتان ایده‌ای دارید، با ما صحبت کنید.\n\n" +
      "لازم نیست همه جزئیات را از قبل بدانید.\n\n" +
      "در یک گفت‌وگو، درباره مناسبت، تعداد مهمانان، زمان، امکانات موردنظر و ایده شما صحبت می‌کنیم و پیشنهاد مناسب را ارائه می‌دهیم.\n\n" +
      `📞 تماس مستقیم: ${GOLAZIN_PHONE_PLACEHOLDER}`,
    buttons: [
      { label: "💬 پیام به گل‌آذین", url: GOLAZIN_WHATSAPP_PLACEHOLDER },
      { label: "🏠 صفحه اصلی", target: "home" },
    ],
  },
];

async function main() {
  const idByKey = {};

  console.log(`ساختنِ ${PANELS.length} پنل برایِ بات ${BOT_ID}...`);
  for (const spec of PANELS) {
    const { panel } = await api(`/bots/${BOT_ID}/panels`, {
      method: "POST",
      body: JSON.stringify({ title: spec.title, type: "media", content: spec.content, buttons: [] }),
    });
    idByKey[spec.key] = panel.id;
    console.log(`  ✓ ${spec.key} → ${panel.id}`);
  }

  console.log("وصل‌کردنِ دکمه‌ها...");
  for (const spec of PANELS) {
    const buttons = spec.buttons.map((b, i) => {
      if (b.url) return { label: b.label, action: "url", value: b.url, row: i, col: 0 };
      const targetId = idByKey[b.target];
      if (!targetId) throw new Error(`کلیدِ ناشناخته در دکمه: ${b.target}`);
      return { label: b.label, action: "panel", value: targetId, row: i, col: 0 };
    });
    await api(`/bots/${BOT_ID}/panels/${idByKey[spec.key]}`, {
      method: "PATCH",
      body: JSON.stringify({ buttons }),
    });
    console.log(`  ✓ ${spec.key}`);
  }

  console.log(`تنظیمِ صفحه‌ی خانه (${idByKey.home})...`);
  await api(`/bots/${BOT_ID}/panels/${idByKey.home}/home`, { method: "POST" });

  console.log("\nتمام شد. ۲۰ پنل ساخته و به هم وصل شدند.");
  console.log(
    "باقی‌مانده برایِ شما: (۱) ویدئوی صفحه‌ی «گل‌آذین را ببینید» و تصاویرِ گالری را از پنلِ وب آپلود کنید، " +
    "(۲) GOLAZIN_PHONE_PLACEHOLDER/GOLAZIN_WHATSAPP_PLACEHOLDER را — اگر قبل از اجرا عوض نکرده‌اید — از صفحه‌ی «تماس» ویرایش کنید.",
  );
}

main().catch((err) => {
  console.error("اسکریپت با خطا متوقف شد:", err.message);
  process.exit(1);
});
