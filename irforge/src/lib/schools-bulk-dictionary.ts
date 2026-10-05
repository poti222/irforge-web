/**
 * lib/schools-bulk-dictionary.ts — پارسِ متنِ چندخطیِ افزودنِ دسته‌ایِ لغت‌نامه
 * (pages/schools/content-lesson.tsx). طبقِ گزارشِ مستقیمِ کاربر: «هر خط یک
 * واژه و معنی» و باید با جداکننده‌هایِ واقعیِ دیتایِ پیست‌شده (از اسپردشیت یا
 * سند) کار کند، نه فقط یک فرمتِ دقیق.
 *
 * ── چرا این اولویتِ جداکننده (خط‌فاصله > دونقطه > تب)؟ ──────────────────
 * خط‌فاصله رایج‌ترین حالتِ تایپِ دستی است («واژه - معنی»)؛ دونقطه دومین حالتِ
 * رایجِ تایپِ دستی («واژه: معنی»)؛ تب معمولاً فقط وقتی پدیدار می‌شود که متن از
 * یک اسپردشیت (دو ستونه) کپی شده باشد. برایِ هر خط فقط *یکی* از این سه چک
 * می‌شود — به ترتیبِ بالا، اولین موردی که در خودِ خط حضور دارد. این یعنی اگر
 * معنی خودش حاویِ دونقطه باشد اما خط از خط‌فاصله جدا شده، خط‌فاصله برنده است؛
 * یک محدودیتِ شناخته‌شده‌ی این heuristic، نه باگ — ترجیح داده شد به‌جایِ یک
 * پارسرِ کاملِ CSV/TSV که بیش‌ازحد برایِ این مقیاس پیچیده می‌شد.
 */

export interface ParsedBulkDictionaryLine {
  lineNumber: number;
  raw: string;
  word: string | null;
  meaning: string | null;
  ok: boolean;
}

function splitBySeparator(raw: string): { word: string; meaning: string } | null {
  // خط‌فاصله: نیم‌فاصله/خط‌فاصله‌ی انگلیسی/اروپاییِ بلند یا کوتاه هر سه پذیرفته می‌شوند.
  const dashIdx = raw.search(/[-–—]/);
  if (dashIdx !== -1) {
    const word = raw.slice(0, dashIdx).trim();
    const meaning = raw.slice(dashIdx + 1).trim();
    if (word && meaning) return { word, meaning };
  }
  const colonIdx = raw.indexOf(":");
  if (colonIdx !== -1) {
    const word = raw.slice(0, colonIdx).trim();
    const meaning = raw.slice(colonIdx + 1).trim();
    if (word && meaning) return { word, meaning };
  }
  const tabIdx = raw.indexOf("\t");
  if (tabIdx !== -1) {
    const word = raw.slice(0, tabIdx).trim();
    const meaning = raw.slice(tabIdx + 1).trim();
    if (word && meaning) return { word, meaning };
  }
  return null;
}

/** خطوطِ خالی بی‌صدا نادیده گرفته می‌شوند (نه خطا، نه حتی یک ردیف در پیش‌نمایش) — طبقِ اسپک. */
export function parseBulkDictionaryText(text: string): ParsedBulkDictionaryLine[] {
  const rawLines = text.split(/\r?\n/);
  const result: ParsedBulkDictionaryLine[] = [];
  rawLines.forEach((raw, idx) => {
    if (!raw.trim()) return;
    const split = splitBySeparator(raw);
    result.push({
      lineNumber: idx + 1,
      raw,
      word: split?.word ?? null,
      meaning: split?.meaning ?? null,
      ok: !!split,
    });
  });
  return result;
}
