/**
 * lib/updateTeaser.ts — خلاصه‌ی کوتاهِ متنِ یک «آپدیت سایت» برای تلگرام و زنگوله.
 *
 * قبلاً پیامِ تلگرام ۵۰۰ نویسه‌ی اولِ متن را **وسطِ جمله** می‌برید («متن نصفه»).
 * حالا فقط **پاراگرافِ اول** می‌آید؛ اگر آن هم از سقف بلندتر بود، در آخرین پایانِ
 * جمله (و اگر نبود، آخرین فاصله) قطع و با «…» تمام می‌شود. ادامه‌ی متن در سایت
 * است (دکمه‌ی «مشاهده‌ی آپدیت کامل از سایت»).
 */
export const UPDATE_TEASER_MAX = 400;

/** نشانه‌گذاریِ مارک‌داون که در پیامِ متنی معنایی ندارد. */
function stripMarkdown(s: string): string {
  return s
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/`+/g, "");
}

const SENTENCE_END = /[.!?؟۔…!]/;

export function updateTeaser(body: string, max: number = UPDATE_TEASER_MAX): { text: string; truncated: boolean } {
  const normalized = stripMarkdown(String(body ?? "").replace(/\r\n?/g, "\n")).trim();
  if (!normalized) return { text: "", truncated: false };

  const paragraphs = normalized.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const first = paragraphs[0] ?? "";
  const hasMore = paragraphs.length > 1;

  // به‌جای code unit با code point می‌بریم تا یک ایموجی دو نیم نشود.
  const chars = Array.from(first);
  if (chars.length <= max) return { text: first, truncated: hasMore };

  const head = chars.slice(0, max);
  let cut = -1;
  for (let i = head.length - 1; i >= Math.floor(max * 0.4); i--) {
    if (SENTENCE_END.test(head[i])) { cut = i + 1; break; }
  }
  if (cut === -1) {
    for (let i = head.length - 1; i >= Math.floor(max * 0.4); i--) {
      if (/\s/.test(head[i])) { cut = i; break; }
    }
  }
  const kept = (cut === -1 ? head : head.slice(0, cut)).join("").trimEnd();
  // اگر در پایانِ جمله بریده‌ایم، «…» لازم نیست؛ وگرنه نشان می‌دهیم متن ادامه دارد.
  const endsClean = SENTENCE_END.test(kept.slice(-1));
  return { text: endsClean ? kept : `${kept}…`, truncated: true };
}
