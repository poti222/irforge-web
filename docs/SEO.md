# SEO — how the multilingual setup works, and what still needs a human

## URL architecture

Persian is the root language and has no prefix; every other language sits under
its own. Each of these is a real HTML file produced at build time, not an empty
SPA shell:

| URL | language | file in `dist/` |
| --- | --- | --- |
| `/` | fa | `index.html` |
| `/docs` | fa | `docs/index.html` |
| `/en/`, `/tr/`, `/ru/`, `/ar/` | that language | `<lang>/index.html` |
| `/en/docs`, `/tr/docs`, … | that language | `<lang>/docs/index.html` |

The URL prefix is authoritative — a crawler (no `localStorage`) and a returning
visitor see the same content at the same URL. `/fa/*` rewrites to the
unprefixed form so each page has exactly one URL.

Source of truth: `irforge/src/lib/lang-routing.ts`.

## Build

```bash
cd irforge && pnpm build
```

That runs three steps: the client build, the render bundle
(`vite.config.ssg.ts`), then `scripts/ssg.mjs`, which renders every language ×
route, injects a per-language `<head>` and JSON-LD, writes `sitemap.xml`, and
runs three build-failing assertions:

- every route in `PRIVATE_ROUTES` is disallowed in robots.txt **twice**, bare
  and language-prefixed (`/dashboard` *and* `/*/dashboard`);
- brand assets exist in `dist/` and no robots rule blocks them;
- the HTML template is pristine before markup is spliced into it.

`pnpm run build:client` alone does **not** produce `sitemap.xml` — it's
generated in the SSG step. Use the full `build`.

## Things kept deliberately silent

These are wired and will start emitting the moment the corresponding constant
is filled in. They're empty because publishing them today would mean asserting
something untrue.

| What | Where | Why it's off |
| --- | --- | --- |
| `Organization.sameAs` | `src/lib/structured-data.ts` → `SOCIAL_PROFILES` | the only handles in the repo (`src/config/support.ts`) are labelled PLACEHOLDER |
| `WebSite.potentialAction` (Sitelinks search box) | same file → `SITE_SEARCH_URL` | the site has no search endpoint; a SearchAction pointing at a 404 is a broken promise to Google |
| `SoftwareApplication.offers` | same file | pricing is behind auth (`/plans` is disallowed), so there is no public price |

Note that without `offers` **and** `aggregateRating`, the SoftwareApplication
node is valid context but is not eligible for a rich result.

## Social cards

Each language has its own 1200×630 card in `irforge/public/og/`, and each
language's pages point `og:image` / `twitter:image` at it with a
language-specific `og:image:alt`. If a language's file is missing the build
falls back to the shared `/og-image.png`, so a partial set is safe to ship —
no page ever points at an image that 404s.

The current cards are generated, not designed. To regenerate or restyle them,
open `irforge/scripts/og-generator.html` in a browser and click **Download
all**, then drop the PNGs back into `public/og/`. Replacing them with proper
artwork needs nothing but the same filenames.

## Manual steps — these cannot be done from code

1. **Request reindexing.** After deploying, open Google Search Console →
   URL Inspection → enter `https://irforge.ir/` → *Request Indexing*. Repeat for
   `/en/`, `/tr/`, `/ru/`, `/ar/`. Then submit `https://irforge.ir/sitemap.xml`
   under Sitemaps.
2. **Expect a delay on the brand icon.** The generic globe in search results is
   replaced at Google's discretion, typically days to weeks after it re-crawls.
   The technical prerequisites are in place (square 1254×1254 logo at an
   absolute URL in `Organization.logo`, favicon links, nothing blocked in
   robots.txt) but the outcome is not guaranteed and no deploy forces it.
3. **Validate the markup** with the Rich Results Test and the Schema Markup
   Validator, and check hreflang with an international-targeting report once
   Search Console has re-crawled.
4. **Fill in `SOCIAL_PROFILES`** once the real IrForge channels are confirmed.

## Known follow-ups

- `public/favicon.png` is 909 kB (1254×1254, opaque RGB). It's only fetched by
  crawlers for the logo, so it isn't on the critical path, but a designer
  re-export at 512×512 would cut it by roughly an order of magnitude.
- `favicon.ico` holds a single small entry. Browsers are fine (the 96px PNG is
  preferred) but a multi-resolution `.ico` would be tidier.
