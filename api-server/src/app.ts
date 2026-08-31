import crypto from "crypto";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import pinoHttp from "pino-http";
import path from "path";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";
import { sanitizeBody } from "./middleware/sanitizeBody.js";
import { globalRateLimit } from "./middleware/rateLimit.js";
import { resolveCorsOrigin } from "./lib/corsConfig.js";
import { INLINE_SCRIPT_HASHES } from "./lib/csp.js";

const app: Express = express();

// Works in both the esbuild CJS bundle (where __dirname is defined natively)
// and `tsx` ESM dev mode (where it isn't). `typeof` is safe on an undeclared
// identifier, so this never throws in ESM.
const currentDir =
  typeof __dirname !== "undefined"
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));

app.use(pinoHttp({ logger }));

// IRFORGE_PROMPT_V3 Phase 6.1 — security headers. CSP's script-src is a
// hash allow-list (see lib/csp.ts) rather than a nonce: the frontend is a
// prerendered static build served with res.sendFile, so there's no
// per-request render step to hand a nonce to, and the inline scripts are
// fixed at build time anyway — a hash is the correct, simpler tool for
// content that never changes per request.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // https://telegram.org: the Telegram Login Widget injects its own
        // <script src="https://telegram.org/js/telegram-widget.js"> at
        // runtime (see irforge/src/components/telegram-login-button.tsx).
        scriptSrc: ["'self'", "https://telegram.org", ...INLINE_SCRIPT_HASHES.map((h) => `'${h}'`)],
        // Radix/shadcn (popovers, dropdowns, dialogs) position themselves
        // via inline `style` attributes — style-src has no equivalent to a
        // script hash for that, and CSS injection is a far lower-severity
        // vector than script injection, so 'unsafe-inline' here is the
        // standard, accepted trade-off (it is NOT script-src).
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        fontSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        // The Telegram Login Widget's iframe (oauth.telegram.org).
        frameSrc: ["https://oauth.telegram.org"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        // Nothing in this app embeds it in an iframe; refuse to be framed.
        frameAncestors: ["'none'"],
      },
    },
    // Default (require-corp) would block cross-origin subresources with no
    // CORP header of their own — e.g. bot avatar images fetched straight
    // from Telegram's CDN — for a cross-origin isolation guarantee this app
    // has no use for (no SharedArrayBuffer/high-res timers).
    crossOriginEmbedderPolicy: false,
    hsts: { maxAge: 15552000, includeSubDomains: true, preload: false },
  }),
);

// IRFORGE_PROMPT_V3 Phase 6.1 — CORS_ORIGIN unset in production used to
// silently fall back to reflecting any request Origin (see corsConfigIssue's
// boot-time check in lib/corsConfig.ts, which now refuses to boot instead).
app.use(cors({
  origin: resolveCorsOrigin(),
  credentials: true,
}));

// فقط برای Google OAuth state cookie (`GET /api/auth/google`) لازم است —
// همان httpOnly + path-scoped cookie که CSRF لحظه‌ی redirect را می‌بندد.
app.use(cookieParser());

// IRFORGE_PROMPT_V3 Phase 6.1 — most routes are small JSON bodies; a small
// cap here shrinks the attack surface for a body-based DoS on the many
// endpoints that don't need more. The routes that legitimately carry a
// base64 data-URL (bot profile photos, wallet/receipt images, full-sheet
// backup restore, admin update post images — see botMedia.ts, botBackup.ts,
// bots.ts, updates.ts) get the larger limit back, scoped to just their
// path prefix, so they keep working without widening the cap for everyone
// else.
const SMALL_BODY_LIMIT = "256kb";
const LARGE_BODY_LIMIT = "10mb";
const LARGE_BODY_PREFIXES = ["/api/bots", "/api/admin/updates"];

function needsLargeBody(req: Request): boolean {
  return LARGE_BODY_PREFIXES.some((p) => req.path.startsWith(p));
}

const smallJson = express.json({ limit: SMALL_BODY_LIMIT });
const largeJson = express.json({ limit: LARGE_BODY_LIMIT });
const smallUrlencoded = express.urlencoded({ extended: true, limit: SMALL_BODY_LIMIT });
const largeUrlencoded = express.urlencoded({ extended: true, limit: LARGE_BODY_LIMIT });

app.use((req: Request, res: Response, next: NextFunction) => {
  const large = needsLargeBody(req);
  (large ? largeJson : smallJson)(req, res, (err?: unknown) => {
    if (err) { next(err); return; }
    (large ? largeUrlencoded : smallUrlencoded)(req, res, next);
  });
});
// IRFORGE_PROMPT_V3 Phase 4.5 — prototype-pollution backstop, after body
// parsing and before any route sees req.body. See middleware/sanitizeBody.ts.
app.use(sanitizeBody);

// IRFORGE_PROMPT_V3 Phase 5.2 — a generous per-IP backstop across all of
// /api, so an unauthenticated scan can't walk every route at full speed.
// Route-specific, tighter (and per-user) limits still apply on top of this
// for expensive endpoints (middleware/rateLimit.ts's perUserRateLimit).
app.use("/api", globalRateLimit);
app.use("/api", router);

// IRFORGE_POSTGRES_FULL_MIGRATION_PROMPT Phase 0 — last-resort net for any
// /api route that throws or rejects without going through its own try/catch
// (most do, via sendBotConfigError in botConfig.ts, which already attaches
// its own correlation id — this only fires for the rest). Express 5 forwards
// a rejected async handler here automatically. Must be registered after
// every route it's meant to protect, and before the SPA catch-all below.
app.use("/api", (err: unknown, req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) { next(err); return; }
  const correlationId = crypto.randomUUID();
  logger.error({ err, correlationId, url: req.originalUrl, method: req.method }, "unhandled API error");
  res.status(500).json({ error: "خطای غیرمنتظره روی سرور. لطفاً دوباره تلاش کنید.", correlationId });
});

// dist/index.cjs lives at api-server/dist/, frontend is at irforge/dist
const frontendDist = path.resolve(currentDir, "../../irforge/dist");

// `redirect: false`: without it, a request for /docs — which is now a real
// directory in dist — gets a 301 to /docs/, changing the canonical URL of an
// already-indexed page. We resolve extension-less paths ourselves below
// instead, so /docs and /en/docs keep responding 200 directly.
app.use(
  express.static(frontendDist, {
    redirect: false,
    /**
     * NOTE [perf]: express.static defaults to no Cache-Control at all, which
     * left Cloudflare guessing (it settled on 4h) and PageSpeed reporting
     * ~356 KiB of re-downloads on every repeat visit.
     *
     * Everything vite writes into /assets carries a content hash in its
     * filename — index-DQ_dqTkl.js, the woff2 font subsets, the CSS — so a
     * changed file is a *different URL* by construction. Those can be cached
     * forever; `immutable` additionally stops the browser from sending a
     * revalidation request on reload.
     *
     * The prerendered index.html files (and robots.txt/sitemap.xml, which are
     * regenerated per build) keep a stable URL across deploys and must NOT be
     * pinned, or a visitor would keep booting last week's HTML — which
     * references asset hashes that no longer exist. Those stay `no-cache`:
     * cheap 304s, always correct.
     *
     * Brand images (favicon*, apple-touch-icon, the og:image social-preview
     * PNGs, the lion/sun flag) are a third case: not content-hashed, so they
     * can't be pinned forever like /assets — but they're also not deploy
     * output that changes shape every push, just static files someone
     * occasionally replaces by hand. `no-cache` was making the browser
     * re-fetch the favicon set on every single navigation (Lighthouse:
     * "efficient cache lifetimes"). A week is short enough that a manual swap
     * shows up same-day for anyone who reloads, long enough to stop the
     * constant re-fetching.
     */
    setHeaders(res, filePath) {
      const isHashedAsset = filePath.includes(`${path.sep}assets${path.sep}`);
      const isBrandImage = /\.(?:png|ico|webp|svg)$/i.test(filePath);
      res.setHeader(
        "Cache-Control",
        isHashedAsset
          ? "public, max-age=31536000, immutable"
          : isBrandImage
            ? "public, max-age=604800"
            : "no-cache",
      );
    },
  }),
);

/** Resolve a request path to a prerendered file inside dist, or null. */
function prerenderedFor(urlPath: string): string | null {
  const rel = urlPath.replace(/^\/+|\/+$/g, "");
  const candidate = path.resolve(frontendDist, rel, "index.html");
  // path.resolve + prefix check keeps a crafted path from escaping dist
  if (!candidate.startsWith(frontendDist)) return null;
  return existsSync(candidate) ? candidate : null;
}

// IRFORGE_PROMPT_V3 Phase 47 — a dedicated, never-prerendered shell (built by
// scripts/ssg.mjs) for any URL that isn't one of the pages that script
// actually prerenders. dist/index.html and dist/<lang>/index.html are NOT
// substitutes for this: ssg.mjs overwrites both with the fully rendered
// landing page for that language, so serving either one for, say, a
// refreshed /dashboard painted the landing page's hero and pricing teaser
// for a frame before React hydrated and swapped in the real route. The
// shell needs no per-language variant — index.html's own inline script
// already sets `lang`/`dir` from the current URL before first paint, and
// every app page sets its own <title> client-side via useSEO().
const appShellPath = path.join(frontendDist, "app-shell.html");

app.get("/{*splat}", (req, res) => {
  // 1. an exact prerendered page for this URL (/, /docs, /en, /en/docs, ...)
  const exact = prerenderedFor(req.path);
  if (exact) return res.sendFile(exact);

  // 2. everything else is an app route (/dashboard, /en/bots/:id, ...):
  //    the neutral shell, never the landing page.
  res.sendFile(appShellPath);
});

export default app;
