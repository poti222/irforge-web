/**
 * test/seoRouting.test.mjs — what the server answers for a URL, as a crawler sees it (lib/seoRouting.ts).
 *
 * Found by auditing the live site: unknown URLs returned 200 (soft 404) with a shell that claimed to be the
 * homepage and asked to be indexed; /dashboard & co. did the same; `/learn/bot-token` relied on a client redirect;
 * `/en` + `/en/`, `/docs` + `/docs/` + `/docs/index.html`, `/fa/learn` + `/learn` were separate 200 URLs.
 *
 * Pure rules first; then a real express server over a temp dist; then the guards that stop the lists drifting from
 * App.tsx / lang-routing.ts / robots.txt (the way `/schools` and `/tutorials` silently did).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import express from "express";

const seo = await import("../src/lib/seoRouting.ts");
const { canonicalRedirect, classifyAppPath, APP_SEGMENTS, createSeoRedirects, createSpaFallback, NOINDEX_HEADER } = seo;

// ─── pure rules ───────────────────────────────────────────────────────────────

test("canonicalRedirect: only duplicate/legacy forms redirect; canonical URLs return null", () => {
  for (const ok of ["/", "/en/", "/ar/", "/docs", "/en/docs", "/learn", "/ru/learn/telegram-bot-token", "/pricing",
    "/robots.txt", "/sitemap.xml", "/favicon.ico", "/assets/index-abc.js", "/og/og-fa.png", "/dashboard", "/bots/b1", "/en/dashboard"]) {
    assert.equal(canonicalRedirect(ok), null, ok);
  }
  const cases = {
    "/en": "/en/",
    "/ar": "/ar/",
    "/docs/": "/docs",
    "/en/docs/": "/en/docs",
    "/learn/telegram-shop-bot/": "/learn/telegram-shop-bot",
    "/docs/index.html": "/docs",
    "/index.html": "/",
    "/en/index.html": "/en/",
    "/fa": "/",
    "/fa/": "/",
    "/fa/learn": "/learn",
    "/fa/learn/telegram-bot-token": "/learn/telegram-bot-token",
    "/fa/docs/": "/docs",
    "//docs": "/docs",
    "/learn/bot-token": "/learn/telegram-bot-token",
    "/en/learn/bot-token": "/en/learn/telegram-bot-token",
    "/fa/learn/bot-token": "/learn/telegram-bot-token",
    "/ru/learn/bot-token/": "/ru/learn/telegram-bot-token",
  };
  for (const [from, to] of Object.entries(cases)) assert.equal(canonicalRedirect(from), to, from);
  // a path that merely STARTS with "fa" is not the fa prefix
  assert.equal(canonicalRedirect("/faq"), null);
  assert.equal(canonicalRedirect("/fa-x/y"), null);
});

test("canonicalRedirect is idempotent: following it once reaches a fixed point", () => {
  for (const from of ["/en", "/docs/", "/fa/learn/", "/learn/bot-token/", "/index.html", "//en//docs//", "/fa/learn/bot-token"]) {
    const once = canonicalRedirect(from);
    assert.ok(once, from);
    assert.equal(canonicalRedirect(once), null, `${from} → ${once}`);
  }
});

test("classifyAppPath: real app routes (any language prefix) → app; everything else → notfound", () => {
  for (const p of ["/dashboard", "/en/dashboard", "/bots/abc", "/ar/bots/abc/x", "/admin/users", "/schools/student/exams", "/login",
    "/products/tier1", "/tutorials/cardpay", "/auth/google/callback", "/complete-profile", "/super"]) {
    assert.equal(classifyAppPath(p), "app", p);
  }
  for (const p of ["/", "/en/", "/nonexistent", "/en/zzz", "/learn/unknown-slug", "/docs/x", "/pricing/x", "/dashboard-old", "/dash",
    "/.env", "/wp-admin", "/admin.php", "/xx/dashboard"]) {
    assert.equal(classifyAppPath(p), "notfound", p);
  }
  assert.ok(APP_SEGMENTS.has("dashboard") && !APP_SEGMENTS.has("docs") && !APP_SEGMENTS.has("learn"));
});

// ─── real express over a temp dist ────────────────────────────────────────────

function makeDist() {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), "seo-dist-"));
  const w = (rel, body) => { fs.mkdirSync(path.dirname(path.join(dist, rel)), { recursive: true }); fs.writeFileSync(path.join(dist, rel), body); };
  w("index.html", "<html><title>HOME-FA</title></html>");
  w("en/index.html", "<html><title>HOME-EN</title></html>");
  w("docs/index.html", "<html><title>DOCS-FA</title></html>");
  w("en/docs/index.html", "<html><title>DOCS-EN</title></html>");
  w("learn/telegram-bot-token/index.html", "<html><title>TOKEN-FA</title></html>");
  w("app-shell.html", '<html><meta name="robots" content="noindex, follow"><title>IrForge</title><div id="root"></div></html>');
  w("robots.txt", "User-agent: *\nAllow: /\n");
  w("assets/app-abc12345.js", "console.log(1)");
  w("tutorials/cardpay/01.png", "png");
  return dist;
}

async function withServer(fn) {
  const dist = makeDist();
  const app = express();
  app.use(createSeoRedirects());
  app.use(express.static(dist, { redirect: false }));
  app.get("/{*splat}", createSpaFallback(dist));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async (p, init = {}) => {
    const res = await fetch(base + p, { redirect: "manual", ...init });
    return { status: res.status, loc: res.headers.get("location"), robots: res.headers.get("x-robots-tag"), body: await res.text() };
  };
  try { await fn({ get }); } finally { await new Promise((r) => server.close(r)); fs.rmSync(dist, { recursive: true, force: true }); }
}

test("HTTP: canonical public pages are 200, indexable (no X-Robots-Tag) and are the prerendered files", () => withServer(async ({ get }) => {
  for (const [p, title] of [["/", "HOME-FA"], ["/en/", "HOME-EN"], ["/docs", "DOCS-FA"], ["/en/docs", "DOCS-EN"], ["/learn/telegram-bot-token", "TOKEN-FA"]]) {
    const r = await get(p);
    assert.equal(r.status, 200, p);
    assert.match(r.body, new RegExp(title), p);
    assert.equal(r.robots, null, `${p} must not carry noindex`);
  }
}));

test("HTTP: duplicate and legacy forms are 301 to the single canonical URL (query string kept)", () => withServer(async ({ get }) => {
  const cases = [["/en", "/en/"], ["/docs/", "/docs"], ["/docs/index.html", "/docs"], ["/fa/learn/telegram-bot-token", "/learn/telegram-bot-token"],
    ["/fa", "/"], ["/learn/bot-token", "/learn/telegram-bot-token"], ["/en/learn/bot-token", "/en/learn/telegram-bot-token"]];
  for (const [from, to] of cases) {
    const r = await get(from);
    assert.equal(r.status, 301, from);
    assert.equal(r.loc, to, from);
  }
  const q = await get("/docs/?utm_source=x");
  assert.equal(q.status, 301);
  assert.equal(q.loc, "/docs?utm_source=x");
}));

test("HTTP: real app routes → neutral shell, 200, X-Robots-Tag noindex", () => withServer(async ({ get }) => {
  for (const p of ["/dashboard", "/en/dashboard", "/bots/b1", "/login", "/schools/admin", "/tutorials/cardpay", "/ar/admin/users"]) {
    const r = await get(p);
    assert.equal(r.status, 200, p);
    assert.equal(r.robots, NOINDEX_HEADER, p);
    assert.match(r.body, /noindex, follow/, p);
    assert.doesNotMatch(r.body, /HOME-FA|canonical/, p);
  }
}));

test("HTTP: unknown URLs → a REAL 404 (still the shell, so the SPA can show its not-found page) with noindex", () => withServer(async ({ get }) => {
  for (const p of ["/nonexistent-page-xyz", "/en/zzz", "/learn/not-an-article", "/wp-login.php", "/.git/config", "/dashboard-old"]) {
    const r = await get(p);
    assert.equal(r.status, 404, p);
    assert.equal(r.robots, NOINDEX_HEADER, p);
  }
}));

test("HTTP: unknown /api paths are JSON 404s, never the HTML shell; app-shell.html isn't served as a page; assets are untouched", () => withServer(async ({ get }) => {
  const api = await get("/api/nope");
  assert.equal(api.status, 404);
  assert.deepEqual(JSON.parse(api.body), { error: "Not found" });
  assert.equal((await get("/app-shell.html")).status, 404);
  assert.equal((await get("/en/app-shell.html")).status, 404);
  assert.equal((await get("/assets/app-abc12345.js")).status, 200);
  assert.equal((await get("/robots.txt")).status, 200);
  assert.equal((await get("/tutorials/cardpay/01.png")).status, 200);
}));

// ─── drift guards ─────────────────────────────────────────────────────────────

const irforge = (rel) => fs.readFileSync(new URL(`../../irforge/${rel}`, import.meta.url), "utf8");
const arrayOf = (src, name) => {
  const m = new RegExp(`export const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*(?:as const)?;`).exec(src);
  assert.ok(m, `${name} not found`);
  return [...m[1].replace(/\/\/.*$/gm, "").matchAll(/"([^"]+)"/g)].map((x) => x[1]);
};

test("drift guard: server APP_SEGMENTS === irforge lang-routing APP_SEGMENTS", () => {
  const client = arrayOf(irforge("src/lib/lang-routing.ts"), "APP_SEGMENTS");
  assert.deepEqual([...APP_SEGMENTS].sort(), [...client].sort());
});

test("drift guard: every top-level <Route> in App.tsx is either a public page or a known app segment", () => {
  const app = irforge("src/App.tsx");
  const publicRoutes = arrayOf(irforge("src/lib/lang-routing.ts"), "PUBLIC_ROUTES");
  const publicFirst = new Set(publicRoutes.map((r) => r.split("/").filter(Boolean)[0]).filter(Boolean));
  const firsts = new Set([...app.matchAll(/<Route\s+path="(\/[^"]*)"/g)].map((m) => m[1].split("/").filter(Boolean)[0]).filter(Boolean));
  assert.ok(firsts.size > 15, "failed to read routes from App.tsx");
  const unknown = [...firsts].filter((f) => !APP_SEGMENTS.has(f) && !publicFirst.has(f));
  assert.deepEqual(unknown, [], `App.tsx renders routes the server would answer with a 404: ${unknown.join(", ")} — add them to APP_SEGMENTS (api-server/src/lib/seoRouting.ts AND irforge/src/lib/lang-routing.ts) and to PRIVATE_ROUTES + robots.txt`);
});

test("drift guard: every private app segment is covered by robots.txt (Disallow) or is a deliberate CRAWLABLE_NOINDEX route", () => {
  const lr = irforge("src/lib/lang-routing.ts");
  const priv = arrayOf(lr, "PRIVATE_ROUTES");
  const crawlable = new Set(arrayOf(lr, "CRAWLABLE_NOINDEX_ROUTES"));
  const robots = irforge("public/robots.txt");
  const dis = new Set(robots.split(/\r?\n/).filter((l) => /^Disallow:/i.test(l.trim())).map((l) => l.replace(/^Disallow:\s*/i, "").trim()));
  for (const seg of APP_SEGMENTS) {
    const route = `/${seg}`;
    // `/bots/…`, `/admin/…` are covered by their prefix; the segment itself must be in PRIVATE_ROUTES
    assert.ok(priv.includes(route), `/${seg} missing from PRIVATE_ROUTES`);
    if (crawlable.has(route)) {
      assert.ok(!dis.has(route) && !dis.has(`/*${route}`), `${route} must stay crawlable so its noindex is visible`);
    } else {
      assert.ok(dis.has(route) && dis.has(`/*${route}`), `robots.txt must Disallow ${route} and /*${route}`);
    }
  }
});
