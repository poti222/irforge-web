import { useMemo } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

/**
 * FormulaBody.tsx — رندرِ متنِ فرمول با KaTeX (پورتِ *ایده*‌ی فرمول‌های
 * ریپوی dars، نه کدِ Google Sheetsش). قرارداد: هر بخشِ بینِ `$...$` (اینلاین)
 * یا `$$...$$` (بلوک) به‌عنوانِ LaTeX رندر می‌شود؛ بقیه‌ی متن عادی می‌ماند.
 * اگر KaTeX نتواند پارس کند، متنِ خام (نه یک صفحه‌ی خراب) نمایش داده می‌شود.
 */
function renderSegment(segment: string, display: boolean): string {
  try {
    return katex.renderToString(segment, { throwOnError: false, displayMode: display });
  } catch {
    return segment;
  }
}

export function FormulaBody({ text }: { text: string }) {
  const html = useMemo(() => {
    const parts = text.split(/(\$\$[^$]+\$\$|\$[^$]+\$)/g);
    return parts
      .map((part) => {
        if (part.startsWith("$$") && part.endsWith("$$")) {
          return renderSegment(part.slice(2, -2), true);
        }
        if (part.startsWith("$") && part.endsWith("$")) {
          return renderSegment(part.slice(1, -1), false);
        }
        return `<span>${escapeHtml(part)}</span>`;
      })
      .join("");
  }, [text]);

  return <div className="whitespace-pre-wrap text-sm leading-8" dir="auto" dangerouslySetInnerHTML={{ __html: html }} />;
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
