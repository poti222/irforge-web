export type Lang = "en" | "fa" | "ar" | "tr" | "ru";

// زبان پیش‌فرض سایت — فارسی.
//
// این مقدار «زبانِ ریشه» هم هست: irforge.ir/ بدون پیشوند فارسی سِرو می‌شه و
// بقیه‌ی زبان‌ها زیر پیشوند خودشون میان (/en/, /tr/, /ru/, /ar/). دلیلش
// محتوا و رتبه‌ی فعلی سایت روی عبارت‌های فارسیه.
//
// هر جایی که این مقدار عوض بشه، این‌ها هم باید هم‌زمان عوض بشن:
//   - تگ استاتیک <html lang dir> در irforge/index.html
//   - مقدار DEFAULT در اسکریپت تشخیص زبانِ همون فایل
//   - og:locale و title/description پیش‌فرض در همون فایل
export const DEFAULT_LANG: Lang = "fa";

// زبان‌هایی که راست‌به‌چپ (RTL) هستن
export const RTL_LANGS: readonly Lang[] = ["fa", "ar"];

export function isRtlLang(lang: Lang): boolean {
  return RTL_LANGS.includes(lang);
}

// متادیتای هر زبان — برای منوی انتخاب زبان استفاده می‌شه
export interface LanguageMeta {
  code: Lang;
  nativeName: string;
  englishName: string;
  flag: string;
}

export const LANGUAGES: readonly LanguageMeta[] = [
  { code: "en", nativeName: "English", englishName: "English", flag: "🇬🇧" },
  { code: "fa", nativeName: "فارسی", englishName: "Persian", flag: "🇮🇷" },
  { code: "ar", nativeName: "العربية", englishName: "Arabic", flag: "🇸🇦" },
  { code: "tr", nativeName: "Türkçe", englishName: "Turkish", flag: "🇹🇷" },
  { code: "ru", nativeName: "Русский", englishName: "Russian", flag: "🇷🇺" },
];

export function isValidLang(value: string | null): value is Lang {
  return value === "en" || value === "fa" || value === "ar" || value === "tr" || value === "ru";
}

export const t = {
  en: {
    // Landing
    signIn: "Sign In",
    getStarted: "Get Started",
    dashboard: "Dashboard",
    startBuilding: "Start Building Now",
    viewDocs: "View Documentation",
    tagline: "The professional Telegram Bot Platform",
    taglineSub: "Build, deploy, and scale advanced Telegram bots and Mini Apps. The power of code, the speed of no-code, wrapped in a developer-first experience.",
    engineeredForScale: "Engineered for Scale",
    engineeredSub: "Everything you need to run production bots, right out of the box.",
    readyToForge: "Ready to forge your bots?",
    readyToForgeSub: "Join thousands of Iranian developers building the next generation of Telegram experiences.",
    createFreeAccount: "Create Free Account",
    madeWith: "Made with pride for Iranian developers.",
    toggleTheme: "Toggle Theme",
    toggleLang: "Language",
    language: "Language",
    // Features
    advancedCommands: "Advanced Commands",
    advancedCommandsDesc: "Visual builder meets code. Define complex logic, argument parsing, and permissions with ease.",
    pluginMarketplace: "Plugin Marketplace",
    pluginMarketplaceDesc: "One-click install plugins. Analytics, moderation, payments, AI integrations, and more.",
    instantDeploy: "Instant Deploy",
    instantDeployDesc: "Push changes instantly without downtime. Real-time logging and performance monitoring.",
    enterpriseSecurity: "Enterprise Security",
    enterpriseSecurityDesc: "Role-based permissions, token management, and full audit logs for your team.",
    analyticsDashboard: "Analytics Dashboard",
    analyticsDashboardDesc: "Track users, messages, uptime, and revenue with beautiful real-time charts.",
    multiBotManagement: "Multi-Bot Management",
    multiBotManagementDesc: "Control unlimited bots from one dashboard. Switch contexts in seconds.",
    // Login
    signInAccount: "Sign in to your account",
    noAccount: "Don't have an account?",
    registerNow: "Register now",
    emailAddress: "Email address",
    password: "Password",
    forgotPassword: "Forgot password?",
    signingIn: "Signing in...",
    backToHome: "Back to home",
    // Admin code
    adminCode: "Admin Code (optional)",
    adminCodePlaceholder: "Enter admin invite code",
    adminCodeHint: "Have an admin code? Enter it to get admin access.",
  },
  fa: {
    // Landing
    signIn: "ورود",
    getStarted: "شروع کنید",
    dashboard: "داشبورد",
    startBuilding: "همین الان بسازید",
    viewDocs: "مشاهده مستندات",
    tagline: "پلتفرم حرفه‌ای ربات تلگرام",
    taglineSub: "ربات‌های پیشرفته تلگرام و مینی‌اپ‌ها را بسازید، مستقر کنید و مقیاس دهید. قدرت کد، سرعت no-code، در یک تجربه developer-first.",
    engineeredForScale: "طراحی‌شده برای مقیاس بزرگ",
    engineeredSub: "همه چیزی که برای اجرای ربات‌های production نیاز دارید، آماده و out-of-the-box.",
    readyToForge: "آماده ساخت ربات‌هایتان هستید؟",
    readyToForgeSub: "به هزاران توسعه‌دهنده ایرانی بپیوندید که نسل بعدی تجربه‌های تلگرام را می‌سازند.",
    createFreeAccount: "ایجاد حساب رایگان",
    madeWith: "ساخته‌شده با افتخار برای توسعه‌دهندگان ایرانی.",
    toggleTheme: "تغییر پوسته",
    toggleLang: "زبان",
    language: "زبان",
    // Features
    advancedCommands: "دستورات پیشرفته",
    advancedCommandsDesc: "سازنده بصری با کد ترکیب می‌شود. منطق پیچیده، پارس آرگومان و مجوزها را به راحتی تعریف کنید.",
    pluginMarketplace: "بازار پلاگین",
    pluginMarketplaceDesc: "نصب پلاگین با یک کلیک. آنالیتیکس، مدیریت، پرداخت، یکپارچه‌سازی هوش مصنوعی و موارد دیگر.",
    instantDeploy: "استقرار فوری",
    instantDeployDesc: "تغییرات را بدون downtime فوری اعمال کنید. لاگ‌گیری real-time و نظارت بر عملکرد.",
    enterpriseSecurity: "امنیت سازمانی",
    enterpriseSecurityDesc: "مجوزهای نقش‌محور، مدیریت توکن و لاگ‌های کامل حسابرسی برای تیم شما.",
    analyticsDashboard: "داشبورد آنالیتیکس",
    analyticsDashboardDesc: "کاربران، پیام‌ها، uptime و درآمد را با نمودارهای زیبای real-time دنبال کنید.",
    multiBotManagement: "مدیریت چند ربات",
    multiBotManagementDesc: "ربات‌های نامحدود را از یک داشبورد کنترل کنید. در ثانیه بین context‌ها جابجا شوید.",
    // Login
    signInAccount: "ورود به حساب کاربری",
    noAccount: "حساب ندارید؟",
    registerNow: "ثبت‌نام کنید",
    emailAddress: "آدرس ایمیل",
    password: "رمز عبور",
    forgotPassword: "رمز را فراموش کردید؟",
    signingIn: "در حال ورود...",
    backToHome: "بازگشت به خانه",
    // Admin code
    adminCode: "کد ادمین (اختیاری)",
    adminCodePlaceholder: "کد دعوت ادمین را وارد کنید",
    adminCodeHint: "کد ادمین دارید؟ برای دسترسی ادمین وارد کنید.",
  },
  ar: {
    // Landing
    signIn: "تسجيل الدخول",
    getStarted: "ابدأ الآن",
    dashboard: "لوحة التحكم",
    startBuilding: "ابدأ البناء الآن",
    viewDocs: "عرض التوثيق",
    tagline: "منصة احترافية لبناء بوتات تيليجرام",
    taglineSub: "أنشئ وانشر وطوّر بوتات تيليجرام وتطبيقات Mini App المتقدمة. قوة الكود، وسرعة no-code، في تجربة مصمّمة للمطورين.",
    engineeredForScale: "مُصمّمة للتوسع",
    engineeredSub: "كل ما تحتاجه لتشغيل بوتات الإنتاج، جاهز مباشرة.",
    readyToForge: "هل أنت مستعد لبناء بوتاتك؟",
    readyToForgeSub: "انضم إلى آلاف المطورين الإيرانيين الذين يبنون الجيل القادم من تجارب تيليجرام.",
    createFreeAccount: "إنشاء حساب مجاني",
    madeWith: "صُنع بفخر للمطورين الإيرانيين.",
    toggleTheme: "تبديل المظهر",
    toggleLang: "اللغة",
    language: "اللغة",
    // Features
    advancedCommands: "أوامر متقدمة",
    advancedCommandsDesc: "أداة بناء مرئية تلتقي بالكود. عرّف المنطق المعقد وتحليل المعطيات والصلاحيات بسهولة.",
    pluginMarketplace: "سوق الإضافات",
    pluginMarketplaceDesc: "تثبيت الإضافات بنقرة واحدة. تحليلات، إشراف، مدفوعات، تكاملات ذكاء اصطناعي، والمزيد.",
    instantDeploy: "نشر فوري",
    instantDeployDesc: "انشر التغييرات فورًا دون توقف. تسجيل الأحداث ومراقبة الأداء في الوقت الفعلي.",
    enterpriseSecurity: "أمان على مستوى المؤسسات",
    enterpriseSecurityDesc: "صلاحيات قائمة على الأدوار، وإدارة الرموز، وسجلات تدقيق كاملة لفريقك.",
    analyticsDashboard: "لوحة التحليلات",
    analyticsDashboardDesc: "تتبّع المستخدمين والرسائل ووقت التشغيل والإيرادات برسوم بيانية جميلة في الوقت الفعلي.",
    multiBotManagement: "إدارة بوتات متعددة",
    multiBotManagementDesc: "تحكّم في عدد غير محدود من البوتات من لوحة تحكم واحدة. بدّل بين السياقات في ثوانٍ.",
    // Login
    signInAccount: "سجّل الدخول إلى حسابك",
    noAccount: "ليس لديك حساب؟",
    registerNow: "سجّل الآن",
    emailAddress: "البريد الإلكتروني",
    password: "كلمة المرور",
    forgotPassword: "هل نسيت كلمة المرور؟",
    signingIn: "جارٍ تسجيل الدخول...",
    backToHome: "العودة إلى الصفحة الرئيسية",
    // Admin code
    adminCode: "رمز المسؤول (اختياري)",
    adminCodePlaceholder: "أدخل رمز دعوة المسؤول",
    adminCodeHint: "هل لديك رمز مسؤول؟ أدخله للحصول على صلاحيات الإدارة.",
  },
  tr: {
    // Landing
    signIn: "Giriş Yap",
    getStarted: "Başlayın",
    dashboard: "Panel",
    startBuilding: "Hemen Oluşturmaya Başlayın",
    viewDocs: "Dokümantasyonu Görüntüle",
    tagline: "Profesyonel Telegram Bot Platformu",
    taglineSub: "Gelişmiş Telegram botları ve Mini Uygulamaları oluşturun, dağıtın ve ölçeklendirin. Kodun gücü, no-code'un hızı, geliştirici odaklı bir deneyimde.",
    engineeredForScale: "Ölçek İçin Tasarlandı",
    engineeredSub: "Production botlarınızı çalıştırmak için ihtiyacınız olan her şey, kutudan çıktığı gibi hazır.",
    readyToForge: "Botlarınızı oluşturmaya hazır mısınız?",
    readyToForgeSub: "Telegram deneyimlerinin yeni neslini inşa eden binlerce İranlı geliştiriciye katılın.",
    createFreeAccount: "Ücretsiz Hesap Oluştur",
    madeWith: "İranlı geliştiriciler için gururla üretildi.",
    toggleTheme: "Temayı Değiştir",
    toggleLang: "Dil",
    language: "Dil",
    // Features
    advancedCommands: "Gelişmiş Komutlar",
    advancedCommandsDesc: "Görsel oluşturucu kodla buluşuyor. Karmaşık mantığı, argüman ayrıştırmayı ve izinleri kolayca tanımlayın.",
    pluginMarketplace: "Eklenti Mağazası",
    pluginMarketplaceDesc: "Tek tıkla eklenti kurulumu. Analitik, moderasyon, ödemeler, yapay zeka entegrasyonları ve daha fazlası.",
    instantDeploy: "Anında Dağıtım",
    instantDeployDesc: "Kesinti olmadan değişiklikleri anında yayınlayın. Gerçek zamanlı günlükleme ve performans izleme.",
    enterpriseSecurity: "Kurumsal Güvenlik",
    enterpriseSecurityDesc: "Rol tabanlı izinler, token yönetimi ve ekibiniz için tam denetim günlükleri.",
    analyticsDashboard: "Analitik Paneli",
    analyticsDashboardDesc: "Kullanıcıları, mesajları, çalışma süresini ve geliri güzel gerçek zamanlı grafiklerle takip edin.",
    multiBotManagement: "Çoklu Bot Yönetimi",
    multiBotManagementDesc: "Sınırsız botu tek bir panelden kontrol edin. Bağlamlar arasında saniyeler içinde geçiş yapın.",
    // Login
    signInAccount: "Hesabınıza giriş yapın",
    noAccount: "Hesabınız yok mu?",
    registerNow: "Şimdi kayıt olun",
    emailAddress: "E-posta adresi",
    password: "Şifre",
    forgotPassword: "Şifrenizi mi unuttunuz?",
    signingIn: "Giriş yapılıyor...",
    backToHome: "Ana sayfaya dön",
    // Admin code
    adminCode: "Yönetici Kodu (isteğe bağlı)",
    adminCodePlaceholder: "Yönetici davet kodunu girin",
    adminCodeHint: "Yönetici kodunuz mu var? Yönetici erişimi için girin.",
  },
  ru: {
    // Landing
    signIn: "Войти",
    getStarted: "Начать",
    dashboard: "Панель управления",
    startBuilding: "Начать создание",
    viewDocs: "Смотреть документацию",
    tagline: "Профессиональная платформа для Telegram-ботов",
    taglineSub: "Создавайте, развёртывайте и масштабируйте продвинутых Telegram-ботов и Mini Apps. Мощь кода, скорость no-code — в удобном для разработчиков формате.",
    engineeredForScale: "Создано для масштаба",
    engineeredSub: "Всё необходимое для запуска production-ботов, сразу из коробки.",
    readyToForge: "Готовы создать своих ботов?",
    readyToForgeSub: "Присоединяйтесь к тысячам иранских разработчиков, создающих новое поколение Telegram-решений.",
    createFreeAccount: "Создать бесплатный аккаунт",
    madeWith: "Создано с гордостью для иранских разработчиков.",
    toggleTheme: "Сменить тему",
    toggleLang: "Язык",
    language: "Язык",
    // Features
    advancedCommands: "Продвинутые команды",
    advancedCommandsDesc: "Визуальный конструктор сочетается с кодом. Легко определяйте сложную логику, разбор аргументов и права доступа.",
    pluginMarketplace: "Магазин плагинов",
    pluginMarketplaceDesc: "Установка плагинов в один клик. Аналитика, модерация, платежи, интеграции с ИИ и многое другое.",
    instantDeploy: "Мгновенное развёртывание",
    instantDeployDesc: "Публикуйте изменения мгновенно, без простоя. Журналирование и мониторинг производительности в реальном времени.",
    enterpriseSecurity: "Корпоративная безопасность",
    enterpriseSecurityDesc: "Права на основе ролей, управление токенами и полные журналы аудита для вашей команды.",
    analyticsDashboard: "Панель аналитики",
    analyticsDashboardDesc: "Отслеживайте пользователей, сообщения, аптайм и доход с помощью красивых графиков в реальном времени.",
    multiBotManagement: "Управление несколькими ботами",
    multiBotManagementDesc: "Управляйте неограниченным числом ботов с одной панели. Переключайтесь между контекстами за секунды.",
    // Login
    signInAccount: "Войдите в свой аккаунт",
    noAccount: "Нет аккаунта?",
    registerNow: "Зарегистрироваться",
    emailAddress: "Адрес электронной почты",
    password: "Пароль",
    forgotPassword: "Забыли пароль?",
    signingIn: "Выполняется вход...",
    backToHome: "Вернуться на главную",
    // Admin code
    adminCode: "Код администратора (необязательно)",
    adminCodePlaceholder: "Введите код приглашения администратора",
    adminCodeHint: "Есть код администратора? Введите его, чтобы получить доступ администратора.",
  },
} as const;

export type TKeys = keyof typeof t.en;
