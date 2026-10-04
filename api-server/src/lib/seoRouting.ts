/**
 * lib/seoRouting.ts — what the server answers for a URL, from a crawler's point of view.
 *
 * SEO audit (2026-10), measured against the live site:
 *
 *  - an unknown URL (`/anything`) returned HTTP 200 with the app shell — a "soft 404" — and the shell's
 *    static <head> was the homepage's (`canonical` → `/`, `index, follow`);
 *  - `/dashboard`, `/bots/:id`, … returned that same indexable-looking shell;
 *  - `/learn/bot-token` (an old, once-indexed URL) returned 200 and relied on a client-side redirect
 *    (SEO.md listed "add a real 301" as a human follow-up);
 *  - `/en` and `/en/`, `/docs` and `/docs/` and `/docs/index.html`, `/fa/learn` and `/learn` were all
 *    separate 200 URLs for the same page.
 *
 * So: ONE place decides, as pure functions that are unit-tested, and an Express handler built from them.
 *
 *   canonicalRedirect(path)  → the single canonical URL if `path` is a duplicate form of one (301), else null
 *   classifyAppPath(path)    → "app" (a real client-side route → shell, 200) | "notfound" (→ shell, 404)
 *   createSeoRedirects()     → middleware, mounted BEFORE express.static
 *   createSpaFallback(dist)  → the catch-all
 *
 * Every response served from the app shell carries `X-Robots-Tag: noindex, follow`, 404s included.
 */
import path from "path";
import { existsSync } from "fs";
import type { NextFunction, Request, RequestHandler, Response } from "express";

/** Root language has no URL prefix; the others do. `fa` as a prefix is a duplicate form (→ 301). */
export const PREFIXED_LANGS = ["en", "ar", "tr", "ru"] as const;
const ROOT_LANG = "fa";

/**
 * Top-level path segments that are real client-side app routes (NOT public marketing pages).
 * MUST equal `APP_SEGMENTS` in irforge/src/lib/lang-routing.ts — test/seoRouting.test.mjs compares
 * both with each other and with the `<Route>`s in irforge/src/App.tsx.
 */
export const APP_SEGMENTS: ReadonlySet<string> = new Set([
  "login",
  "register",
  "forgot-password",
  "reset-password",
  "complete-profile",
  "auth",
  "dashboard",
  "bots",
  "products",
  "buy-bot",
  "tutorials",
  "marketplace",
  "invoices",
  "tickets",
  "wallet",
  "plans",
  "support",
  "notifications",
  "updates",
  "database",
  "profile",
  "schools",
  "admin",
  "super",
]);

/** Old public URLs that moved for good. Keys are language-less paths. */
export const LEGACY_REDIRECTS: Readonly<Record<string, string>> = {
  "/learn/bot-token": "/learn/telegram-bot-token",
};

export const NOINDEX_HEADER = "noindex, follow";

interface Split {
  /** "", "/en", "/ar" … ("" for the root language) */
  prefix: string;
  /** language-less path, always starting with "/" */
  rest: string;
  /** the URL carried the redundant `/fa` prefix */
  hadFaPrefix: boolean;
}

function splitLang(pathname: string): Split {
  const m = /^\/([^/]+)(\/.*)?$/.exec(pathname);
  if (m) {
    const seg = m[1];
    if ((PREFIXED_LANGS as readonly string[]).includes(seg)) return { prefix: `/${seg}`, rest: m[2] || "/", hadFaPrefix: false };
    if (seg === ROOT_LANG) return { prefix: "", rest: m[2] || "/", hadFaPrefix: true };
  }
  return { prefix: "", rest: pathname || "/", hadFaPrefix: false };
}

/**
 * The canonical URL for `pathname` if it is a duplicate/legacy form, else null.
 *
 * Canonical forms (they match `absoluteUrl()` in irforge/src/lib/lang-routing.ts):
 *   `/`, `/en/`, `/ar/` …  (language roots KEEP their trailing slash)
 *   `/docs`, `/en/learn/telegram-bot-token` …  (everything else has none)
 */
export function canonicalRedirect(pathname: string): string | null {
  let p = pathname || "/";
  // `/index.html` and `/x/index.html` are the same document as `/` and `/x`
  p = p.replace(/\/index\.html$/i, "/") || "/";
  // collapse accidental double slashes
  p = p.replace(/\/{2,}/g, "/");

  const { prefix, rest, hadFaPrefix } = splitLang(p);
  let restOut = rest;

  // trailing slash: removed everywhere except on a (language) root
  if (restOut.length > 1) restOut = restOut.replace(/\/+$/, "");
  const legacy = LEGACY_REDIRECTS[restOut];
  if (legacy) restOut = legacy;

  const target = restOut === "/" ? `${prefix}/` : `${prefix}${restOut}`;
  void hadFaPrefix; // the prefix is dropped simply by not re-adding it
  return target !== pathname ? target : null;
}

/** Is this (already canonical) path a real client-side app route? */
export function classifyAppPath(pathname: string): "app" | "notfound" {
  const { rest } = splitLang(pathname);
  const first = rest.split("/").filter(Boolean)[0];
  return first && APP_SEGMENTS.has(first) ? "app" : "notfound";
}

/** Resolve a request path to a prerendered file inside `dist`, or null. */
export function prerenderedFor(frontendDist: string, urlPath: string): string | null {
  const rel = urlPath.replace(/^\/+|\/+$/g, "");
  const candidate = path.resolve(frontendDist, rel, "index.html");
  // path.resolve + prefix check keeps a crafted path from escaping dist
  if (!candidate.startsWith(frontendDist)) return null;
  return existsSync(candidate) ? candidate : null;
}

/** 301 duplicate/legacy URLs to their canonical form, keeping the query string. Mount before express.static. */
export function createSeoRedirects(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    // the neutral shell is an implementation detail, not a page
    if (/\/app-shell\.html$/i.test(req.path)) {
      res.setHeader("X-Robots-Tag", NOINDEX_HEADER);
      res.status(404).type("text/plain").send("Not found");
      return;
    }
    // API requests are not pages
    if (req.path.startsWith("/api/") || req.path === "/api") return next();
    const to = canonicalRedirect(req.path);
    if (!to) return next();
    const qIndex = req.originalUrl.indexOf("?");
    const query = qIndex >= 0 ? req.originalUrl.slice(qIndex) : "";
    res.redirect(301, to + query);
  };
}

/**
 * The catch-all: a prerendered page (200), a real app route → the neutral shell (200, noindex), or an
 * unknown URL → the same shell with a real 404 (+ noindex) so the SPA can still show its own "not found"
 * screen to a person while crawlers see the truth.
 */
export function createSpaFallback(frontendDist: string): RequestHandler {
  const shell = path.join(frontendDist, "app-shell.html");
  return (req: Request, res: Response) => {
    if (req.path.startsWith("/api/") || req.path === "/api") {
      res.status(404).json({ error: "Not found" });
      return;
    }
    // 1. an exact prerendered page for this URL (/, /docs, /en/, /en/learn/…)
    const exact = prerenderedFor(frontendDist, req.path);
    if (exact) {
      res.sendFile(exact);
      return;
    }
    // 2. everything else comes from the shell, which must never be indexed
    res.setHeader("X-Robots-Tag", NOINDEX_HEADER);
    res.status(classifyAppPath(req.path) === "app" ? 200 : 404).sendFile(shell);
  };
}
