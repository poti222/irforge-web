/**
 * مقصدِ بعد از لاگین/ثبت‌نام: «هر صفحه‌ای که کاربر از آن لاگین/ثبت‌نام را باز کرد، بعدش به همان صفحه برگردد».
 *
 * سه منبع (به ترتیبِ اولویت):
 *  1. مقصدِ صریح — دکمه‌هایی که خودشان مقصد را می‌دانند (`setPostAuthTarget`: «ساخت بات» → /dashboard،
 *     «سامانه‌ی مدرسه» → /schools) و گاردهای مسیر (کاربرِ لاگین‌نکرده مستقیم لینکِ محافظت‌شده را باز کرد).
 *     با اولین بازدید از صفحه‌ی دیگر منقضی می‌شود تا کلیکِ قدیمی بعداً کسی را اشتباهی نبَرَد.
 *  2. آخرین صفحه‌ی عمومی که کاربر دیده (`noteVisit` از <PostAuthTracker/>؛ صفحه‌ی اصلی «/» حساب نمی‌شود).
 *  3. «/dashboard».
 * همه‌ی مسیرها wouter-relative هستند (بدونِ پیشوندِ زبان)، پس `navigate()` خودش پیشوند را اضافه می‌کند.
 * sessionStorage تا ریدایرکتِ OAuth (گوگل/گیت‌هاب/تلگرام) زنده می‌ماند. فقط مسیرِ هم‌مبدأ قبول می‌شود (بدونِ open-redirect).
 */
const KEY = "irforge_post_auth";
const LAST = "irforge_last_page";
const TTL_MS = 30 * 60 * 1000;
const DEFAULT_TARGET = "/dashboard";

/** صفحه‌هایی که هرگز مقصدِ بعد از ورود نیستند (خودِ جریانِ ورود). */
const AUTH_RE = /^\/(login|register|forgot-password|reset-password|complete-profile|auth)(\/|$|\?|#)/;

export function isAuthPath(path: string): boolean {
  return AUTH_RE.test(path);
}

/** فقط مسیرِ داخلی (`/x…`)؛ نه `//host`، نه `\`، نه scheme، نه صفحه‌ی ورود، نه ریشه. */
export function isSafeTarget(path: unknown): path is string {
  if (typeof path !== "string") return false;
  if (path.length < 2 || path.length > 500) return false;
  if (path[0] !== "/" || path[1] === "/" || path[1] === "\\") return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(path)) return false;
  if (/^\/[a-z][a-z0-9+.-]*:/i.test(path)) return false;
  return !isAuthPath(path);
}

interface Explicit { path: string; from: string; at: number }

function store(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

function rawPathname(): string {
  try {
    return typeof window === "undefined" ? "" : window.location.pathname;
  } catch {
    return "";
  }
}

function readExplicit(): Explicit | null {
  const s = store();
  if (!s) return null;
  try {
    const raw = s.getItem(KEY);
    if (!raw) return null;
    // سازگاری با مقدارِ قدیمی (رشته‌ی ساده)
    if (raw[0] === "/") return isSafeTarget(raw) ? { path: raw, from: "", at: Date.now() } : null;
    const v = JSON.parse(raw) as Explicit;
    if (!isSafeTarget(v.path) || typeof v.at !== "number" || Date.now() - v.at > TTL_MS) return null;
    return v;
  } catch {
    return null;
  }
}

export function setPostAuthTarget(path: string): void {
  const s = store();
  if (!s || !isSafeTarget(path)) return;
  try {
    s.setItem(KEY, JSON.stringify({ path, from: rawPathname(), at: Date.now() } satisfies Explicit));
  } catch {
    /* storage may be blocked */
  }
}

/** صفحه‌ی عمومی (یا هر صفحه‌ی غیرِ ورود) که الان دیده شد. «path» = مسیرِ wouter-relative + search. */
export function noteVisit(path: string): void {
  const s = store();
  if (!s || isAuthPath(path)) return;
  try {
    const e = readExplicit();
    const base = (p: string) => p.split(/[?#]/)[0];
    if (e && e.from !== rawPathname() && base(e.path) !== base(path)) s.removeItem(KEY);
    if (base(path) === "/" || !isSafeTarget(path)) s.removeItem(LAST);
    else s.setItem(LAST, path);
  } catch {
    /* ignore */
  }
}

/** `/login?next=/some/page` (لینکِ اشتراکی) — فقط مقصدِ امن را می‌پذیرد. */
export function captureNextParam(path: string, search: string): void {
  if (!isAuthPath(path)) return;
  try {
    const next = new URLSearchParams(search).get("next");
    if (next && isSafeTarget(next)) setPostAuthTarget(next);
  } catch {
    /* ignore */
  }
}

export function peekPostAuthTarget(): string {
  const e = readExplicit();
  if (e) return e.path;
  const s = store();
  try {
    const last = s?.getItem(LAST);
    if (last && isSafeTarget(last)) return last;
  } catch {
    /* ignore */
  }
  return DEFAULT_TARGET;
}

export function consumePostAuthTarget(): string {
  const v = peekPostAuthTarget();
  const s = store();
  try {
    s?.removeItem(KEY);
    s?.removeItem(LAST);
  } catch {
    /* ignore */
  }
  return v;
}
