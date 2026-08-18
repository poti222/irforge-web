import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";

const app: Express = express();

// Works in both the esbuild CJS bundle (where __dirname is defined natively)
// and `tsx` ESM dev mode (where it isn't). `typeof` is safe on an undeclared
// identifier, so this never throws in ESM.
const currentDir =
  typeof __dirname !== "undefined"
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));

app.use(pinoHttp({ logger }));
app.use(cors({
  origin: process.env.CORS_ORIGIN || true,
  credentials: true,
}));
// FIX: default express.json() body limit is 100kb, which silently 413s any
// base64 data-URL upload (bot profile photos, wallet deposit receipts) once
// the encoded payload — image bytes * ~1.33 for base64, plus JSON overhead —
// crosses that. Raised to accommodate the largest such upload (bot profile
// photo, capped at 5MB raw server-side in bots.ts) with headroom.
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.use("/api", router);

// dist/index.cjs lives at api-server/dist/, frontend is at irforge/dist
const frontendDist = path.resolve(currentDir, "../../irforge/dist");

// Language prefixes that the frontend build prerenders into their own folders
// (fa is the root language and has no prefix).
const LANG_PREFIXES = new Set(["en", "ar", "tr", "ru"]);

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

app.get("/{*splat}", (req, res) => {
  // 1. an exact prerendered page for this URL (/, /docs, /en, /en/docs, ...)
  const exact = prerenderedFor(req.path);
  if (exact) return res.sendFile(exact);

  // 2. an app route under a language prefix (/en/dashboard): serve that
  //    language's shell so the SPA boots in the right language and direction
  const first = req.path.split("/").filter(Boolean)[0];
  if (first && LANG_PREFIXES.has(first)) {
    const shell = path.join(frontendDist, first, "index.html");
    if (existsSync(shell)) return res.sendFile(shell);
  }

  // 3. everything else: the root-language shell
  res.sendFile(path.join(frontendDist, "index.html"));
});

export default app;
