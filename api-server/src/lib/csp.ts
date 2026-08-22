/**
 * lib/csp.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * IRFORGE_PROMPT_V3 Phase 6 — Content-Security-Policy allow-list for the
 * frontend's inline scripts.
 *
 * The frontend is a prerendered static build (irforge/dist), served with
 * `res.sendFile` — there is no per-request render step to hand a nonce to.
 * Its inline `<script>` bodies are therefore fixed at build time, which
 * makes a CSP *hash* source the right tool, not a nonce: `'sha256-<hash>'`
 * allows exactly this script body and nothing else, with no request-scoped
 * wiring needed.
 *
 * Two of the three scripts below are hand-authored in irforge/index.html
 * (the lang/dir setter and the anti-FOUC theme setter). The third is
 * `next-themes`' own anti-flash script, injected into the DOM (and captured
 * by the SSG snapshot) by its ThemeProvider — not something this repo's
 * source controls directly, so it's copied here verbatim from a build
 * output instead of authored by hand.
 *
 * The literal text below is the single source of truth; hashes are always
 * *derived* from it, never hand-computed, so a hash can never silently
 * drift from the text it is supposed to describe. What CAN drift is this
 * copy vs. the frontend's actual output (someone edits the inline script in
 * irforge/index.html, or bumps next-themes and its injected script changes)
 * — test/csp.test.mjs checks this copy against a real `irforge/dist` build
 * when one is present, and fails loudly if they no longer match.
 */
import crypto from "crypto";

export const INLINE_SCRIPTS = {
  /** irforge/index.html — sets <html lang>/[dir] from the URL before paint. */
  langDir: `
      (function () {
        var VALID = ["en", "fa", "ar", "tr", "ru"];
        var RTL = ["fa", "ar"];
        var DEFAULT = "fa";

        // ترتیب دقیقاً همون readInitialLang() در src/hooks/use-language.ts:
        // پیشوند زبان در URL هست → همون، نیست → زبان ریشه. عمداً اینجا
        // localStorage خونده نمی‌شه: URL تعیین‌کننده‌ست، و اگه کاربر زبان
        // دیگه‌ای ذخیره کرده باشه، خودِ اپ (useCanonicalLangPath) اونو به URL
        // زبان خودش ریدایرکت می‌کنه. اگه اینجا localStorage رو می‌خوندیم،
        // \`/\` یه فریم با lang/dir انگلیسی ولی محتوای فارسی رنگ می‌شد.
        var seg = (location.pathname.split("/")[1] || "").toLowerCase();
        var lang = VALID.indexOf(seg) !== -1 ? seg : DEFAULT;

        var html = document.documentElement;
        html.setAttribute("lang", lang);
        html.setAttribute("dir", RTL.indexOf(lang) !== -1 ? "rtl" : "ltr");
      })();
    `,
  /** irforge/index.html — sets the .dark class before paint (no white flash). */
  themeFlash: `
      (function () {
        try {
          var stored = localStorage.getItem("theme");
          var theme = stored || "dark"; // defaultTheme="dark" مثل App.tsx
          if (theme === "dark") {
            document.documentElement.classList.add("dark");
          } else if (theme === "system") {
            if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
              document.documentElement.classList.add("dark");
            }
          }
          // "light" → کلاس اضافه نمی‌کنیم، پیش‌فرض سفیده
        } catch (e) {
          // localStorage بلاک شده — dark پیش‌فرض
          document.documentElement.classList.add("dark");
        }
      })();
    `,
  /**
   * next-themes' own injected anti-flash script (minified by its own build,
   * not by ours) — captured verbatim from a production build's output.
   * Its argument list encodes this app's ThemeProvider props: attribute
   * "class", storageKey "theme", defaultTheme "dark", forcedTheme null,
   * themes ["light","dark"], value-mapping null, enableSystem true,
   * enableColorScheme true. Changing any of those props changes this text
   * (and therefore its hash) — test/csp.test.mjs catches the drift.
   */
  nextThemesInjected: `((e,i,s,u,m,a,l,h)=>{let d=document.documentElement,w=["light","dark"];function p(n){(Array.isArray(e)?e:[e]).forEach(y=>{let k=y==="class",S=k&&a?m.map(f=>a[f]||f):m;k?(d.classList.remove(...S),d.classList.add(a&&a[n]?a[n]:n)):d.setAttribute(y,n)}),R(n)}function R(n){h&&w.includes(n)&&(d.style.colorScheme=n)}function c(){return window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}if(u)p(u);else try{let n=localStorage.getItem(i)||s,y=l&&n==="system"?c():n;p(y)}catch(n){}})("class","theme","dark",null,["light","dark"],null,true,true)`,
} as const;

export function scriptHash(source: string): string {
  return "sha256-" + crypto.createHash("sha256").update(source, "utf8").digest("base64");
}

export const INLINE_SCRIPT_HASHES: string[] = Object.values(INLINE_SCRIPTS).map(scriptHash);
