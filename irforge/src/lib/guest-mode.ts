/**
 * حالت مهمان — هر کسی بدون ثبت‌نام/ورود وارد داشبورد می‌شود و همه‌چیز را (به‌صورت دمو/خالی) می‌بیند؛
 * به‌محض اینکه بخواهد کاری انجام دهد (هر درخواستِ غیر-GET)، به فرم ثبت‌نام می‌رود و بعد از ثبت‌نام
 * به همان صفحه برمی‌گردد.
 *
 * طراحی (کاملاً سمتِ کلاینت، هیچ endpointِ احراز‌هویت‌شده‌ای برای بیرون باز نمی‌شود):
 *  - `customFetch` برای درخواستِ بدونِ توکن این handler را صدا می‌زند (فقط وقتی `guestBrowsing` روشن است،
 *    یعنی صفحه‌ی داشبورد در حالت مهمان رندر شده).
 *  - GETِ داده‌ی کاربر (آمار، بات‌ها، کیف پول، تیکت…) → داده‌ی خالیِ هم‌شکل با پاسخ واقعی، بدونِ تماس با سرور.
 *  - GETِ عمومی (محصولات، اعلان‌های عمومی، آپدیت‌ها…) → به سرور می‌رود، همان داده‌ی واقعی.
 *  - هر درخواستِ غیر-GET (به‌جز ورود/ثبت‌نام) → ارسال نمی‌شود، رویداد «نیازمند حساب» پخش می‌شود و خطای
 *    `guest_forbidden` (همان قراردادِ `denyGuestWrite` سرور) پرتاب می‌شود.
 */
import { ApiError, setGuestRequestHandler } from "@workspace/api-client-react";

/** صفحه‌هایی که مهمان می‌تواند ببیند. بقیه (پروفایل، ادمین، …) مثل قبل به ورود می‌روند. */
const GUEST_VIEWABLE = [
  /^\/dashboard(\/|$)/,
  /^\/bots(\/?$)/,
  /^\/discord-bots(\/|$)/,
  /^\/products(\/|$)/,
  /^\/wallet(\/|$)/,
  /^\/invoices(\/|$)/,
  /^\/tickets(\/|$)/,
  /^\/support(\/|$)/,
  /^\/updates(\/|$)/,
];

export function isGuestViewablePath(path: string): boolean {
  const clean = path.split(/[?#]/)[0] ?? path;
  return GUEST_VIEWABLE.some((re) => re.test(clean));
}

let guestBrowsing = false;
export function setGuestBrowsing(on: boolean): void {
  guestBrowsing = on;
}
export function isGuestBrowsing(): boolean {
  return guestBrowsing;
}

export const GUEST_ACTION_EVENT = "irforge:guest-action";

/** درخواستِ نیازمندِ حساب: UI (GuestActionListener) به فرم ثبت‌نام می‌برد. */
export function requireAccount(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(GUEST_ACTION_EVENT));
}

/** مسیرهایی که حتی در حالت مهمان باید واقعاً به سرور بروند (ورود/ثبت‌نام/کپچا/نشست مهمان). */
const PASS_THROUGH = [/^\/api\/auth\//, /^\/api\/guest\//, /^\/api\/captcha/, /^\/api\/oauth\//, /^\/api\/registration\//];

/** داده‌ی کاربر → پاسخِ خالیِ هم‌شکل با پاسخِ واقعی. */
const DEMO_GET: Array<[RegExp, () => unknown]> = [
  [
    /^\/api\/dashboard\/stats$/,
    () => ({
      totalBots: 0, activeBots: 0, totalUsers: 0, totalMessages: 0, activeUsersToday: 0,
      totalRevenue: null, botsChange: 0, usersChange: null, messagesChange: 0,
    }),
  ],
  [/^\/api\/dashboard\/activity$/, () => []],
  [/^\/api\/bots$/, () => []],
  [/^\/api\/my-purchases$/, () => []],
  [/^\/api\/wallet$/, () => ({ balance: 0 })],
  [/^\/api\/wallet\/transactions$/, () => []],
  [/^\/api\/payments\/me$/, () => []],
  [/^\/api\/tickets$/, () => []],
  [/^\/api\/notifications$/, () => []],
  [/^\/api\/updates\/unseen$/, () => ({ update: null })],
  [/^\/api\/discord-bots(\/.*)?$/, () => []],
];

function pathnameOf(url: string): string {
  try {
    return new URL(url, typeof location !== "undefined" ? location.origin : "http://localhost").pathname;
  } catch {
    return url.split("?")[0] ?? url;
  }
}

function guestError(req: { method: string; url: string }): ApiError {
  const body = { error: "برای انجام این کار ثبت‌نام کنید / Create an account to do this", code: "guest_forbidden" };
  const response = new Response(JSON.stringify(body), {
    status: 403,
    headers: { "content-type": "application/json" },
  });
  return new ApiError(response, body, req);
}

export function installGuestMode(): void {
  setGuestRequestHandler((req) => {
    if (!guestBrowsing) return undefined;
    const path = pathnameOf(req.url);
    if (!path.startsWith("/api/")) return undefined;
    if (PASS_THROUGH.some((re) => re.test(path))) return undefined;

    if (req.method !== "GET" && req.method !== "HEAD") {
      requireAccount();
      return { error: guestError(req) };
    }
    for (const [re, make] of DEMO_GET) if (re.test(path)) return { data: make() };
    return undefined; // GETِ عمومی → سرور
  });
}
