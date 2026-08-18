import { createRoot } from "react-dom/client";
import { setBaseUrl, setAuthTokenGetter } from "@workspace/api-client-react";
import App from "./App";
import { readInitialLang } from "./hooks/use-language";
import { getAuthToken } from "./lib/auth-token";
import { ensureLocales } from "./locales/registry";
import "./index.css";

setBaseUrl(import.meta.env.VITE_API_URL ?? "");
setAuthTokenGetter(() => getAuthToken());

/**
 * NOTE [perf]: locale JSON is no longer bundled into the entry chunk (all five
 * languages together were 744 kB — see locales/registry.ts). The language in
 * the URL plus the English fallback are fetched here before the first render.
 *
 * This is NOT a waterfall: scripts/ssg.mjs writes a <link rel="modulepreload">
 * for both chunks into every prerendered page, so the browser has them in
 * flight alongside the entry chunk itself. Until this resolves the visitor is
 * still looking at the prerendered markup, not a blank screen.
 */
const root = createRoot(document.getElementById("root")!);

ensureLocales(readInitialLang())
  .catch((err) => {
    // A failed locale chunk must not leave the site permanently on the static
    // markup: render anyway. useT() falls back to `{}` and the page comes up
    // with missing strings rather than nothing at all.
    console.error("[i18n] locale load failed, rendering with fallbacks", err);
  })
  .finally(() => {
    root.render(<App />);
  });
