# IrForge SEO

How the public, indexable part of this site is put together, how to add to it,
and what only a human can do.

---

## 1. URL architecture

Persian is `DEFAULT_LANG` and lives at the root with **no** prefix. The other
four languages each live under their own prefix.

```
irforge.ir/                              fa   (root language, no prefix)
irforge.ir/en/                           en
irforge.ir/ar/  /tr/  /ru/               ar, tr, ru
irforge.ir/en/learn/telegram-bot-token   an article, in English
irforge.ir/learn/telegram-bot-token      the same article, in Persian
```

**The prefix is authoritative.** Whatever language segment the URL carries is
the language the page renders in, regardless of what `localStorage` remembers.
That is what makes each URL independently indexable: a crawler (which has no
`localStorage`) and a returning visitor must see the same content at the same
URL, or canonical and hreflang would be lying.

**Article slugs stay English in every language.** `/fa/learn/telegram-bot-token`,
never `/fa/آموزش/توکن-ربات`. Percent-encoded non-Latin slugs are legal but
fragile once they pass through sitemaps, analytics and shared links, and Google
handles an English slug with translated content perfectly well.

Currently **13 public routes × 5 languages = 65 indexable URLs**: `/`, `/docs`,
`/learn`, nine `/learn/*` articles, and `/pricing`.

Everything else is behind auth, listed in `PRIVATE_ROUTES`, and `Disallow`ed in
`robots.txt` twice — bare (`/dashboard`) and prefixed (`/*/dashboard`).

---

## 2. How to add a new public page

Exactly four files. The build fails loudly if you miss any of them.

1. **`irforge/src/lib/lang-routing.ts`** — add the route to `PUBLIC_ROUTES`,
   and add a `ROUTE_SEO` entry with `titleKey`, `descKey`, `navKey` (and
   optionally `keywordsKey`).
2. **`irforge/src/locales/{en,fa,ar,tr,ru}.json`** — add the keys the registry
   points at, under `seo`. **All five languages.**
3. **`irforge/src/pages/…`** — the page component.
4. **`irforge/src/App.tsx`** — the `<Route>`.

For a new `/learn` article there are two more:

5. **`irforge/src/lib/learn-content.ts`** — add the slug to `ARTICLE_SLUGS`, an
   entry in `ARTICLE_DATES`, and an entry in `RELATED` (≥3 links). Add it to
   `HOWTO_SLUGS` only if it is genuinely step-by-step.
6. **`irforge/src/locales/*.json`** — the article body under
   `learn.articles.<slug>`, in all five languages.

A new article needs no new component logic: create
`irforge/src/pages/learn/<slug>.tsx` returning `<ArticleLayout slug="<slug>" />`.

### What stops you getting this wrong

- `routeSeo()` **throws during the build** if a `PUBLIC_ROUTES` entry has no
  `ROUTE_SEO` record, and names the four files to touch.
- `seoFor()` throws if the registry points at a locale key that doesn't exist.
- `assertPageSeo()` in `scripts/ssg.mjs` fails the build on: a duplicate
  `<title>` across two pages, a page missing canonical / hreflang / JSON-LD, or
  an hreflang set that isn't reciprocal.
- `assertRobotsCoverage()` fails the build if a `PRIVATE_ROUTES` entry isn't
  disallowed in `robots.txt` in both forms.
- `assertBrandAssets()` fails the build if a favicon or OG card is missing or
  accidentally blocked by a `Disallow` rule.

Run `pnpm --filter @workspace/irforge run build` — all of this runs there.

---

## 3. The no-invented-facts policy

This is not a style preference. Invented `Review`/`AggregateRating` markup is a
manual-action risk, and a wrong number in schema is worse than no number.

- **No** user counts, "trusted by X companies", testimonials, or review ratings.
- **No** `AggregateRating` or `Review` nodes. Ever.
- `Organization.sameAs` lists only profiles that actually load.
- `offers` on `SoftwareApplication` stays omitted until real prices are
  published — see §5.
- `SITE_SEARCH_URL` stays `null` until the site actually has search. A
  `SearchAction` pointing at a non-existent endpoint is a broken promise.
- When an article describes IrForge's own behaviour, **read the code first**
  (`api-server/src/routes/bots.ts`, `lib/sheets.ts`, `lib/telegram.ts`). Do not
  describe features that don't exist.
- `datePublished`/`dateModified` come from `ARTICLE_DATES`, hand-maintained,
  **never** from build time. A `dateModified` that moves on every deploy
  without the content changing trains the crawler to ignore the field.

---

## 4. The translation requirement

**A page that exists in one language must exist in all five.**

`entry-ssg.tsx` falls back to English per key, so a half-translated page ships
English fragments into a Persian page and looks broken rather than failing
loudly. Never leave a key unfilled.

**Never machine-translate blindly.** Persian is the primary market and the copy
must read as native Persian, not translated English — Persian readers search
«آموزش ساخت ربات تلگرام», English readers search "how to make a telegram bot".
Same topic, different framing. Same for Arabic.

If you cannot write natural copy in a language, write it in English, prefix the
key with `TODO_TRANSLATE_<lang>`, and list it in `PROGRESS.md`. The build prints
a count of any remaining `TODO_TRANSLATE_*` keys in its summary. **Do not ship
fake fluency.**

RTL: `fa` and `ar`. Use logical properties (`ms-`/`me-`/`ps-`/`pe-`/`text-start`/
`text-end`) exclusively, and `isRtlLang(lang)` for directional icons.

Internal links: always wouter `<Link href="/learn/...">` with a **root-relative**
path. The router `base` already carries the language prefix — hardcoding one
produces `/en/en/...`.

---

## 5. Human-only follow-ups

No amount of code substitutes for these.

### Do first

- [ ] **Verify the two social profiles load**, then keep or remove them in
      `SOCIAL_PROFILES` (`irforge/src/lib/structured-data.ts`):
      `https://t.me/irforge_Education` and `https://instagram.com/ir_forge`.
      They were added on the strength of the brief and an existing in-repo
      comment, but **could not be checked automatically** — both domains are
      blocked by this build environment's network egress proxy. A `sameAs`
      pointing at a dead account is worse than an omitted one.
- [ ] **Add a real 301 for `/learn/bot-token` → `/learn/telegram-bot-token`** at
      the host. The old URL was public, prerendered and in the sitemap. `App.tsx`
      carries a wouter `<Redirect>`, but that only fires **after the SPA boots**
      — it is not a 301 and a crawler will not read it as one.
- [ ] **Run Lighthouse against the built output** (`irforge/dist`, not the dev
      server) for `/`, `/en/`, `/learn` and one article. Record the four Core
      Web Vitals in `PROGRESS.md`. Fix anything below 90 on SEO or
      Accessibility; note but don't chase Performance below 90 if the cause is
      the animation budget.

### Search engines

- [ ] Verify the domain in **Google Search Console** and **Bing Webmaster
      Tools**; submit `https://irforge.ir/sitemap.xml`.
- [ ] Set international targeting and confirm hreflang is being read without
      errors.

### Links — the part that actually moves competitive terms

- [ ] **Publish each new article to the Telegram channel and Instagram, linking
      back.** This is the only backlink source currently under the owner's
      control, and links are what move head terms. Shipping 65 URLs does not
      substitute for it.

### Ongoing

- [ ] Expect **3–6 months** before long-tail pages settle, longer for head
      terms. Nothing here promises rankings; rankings follow content and links
      over months.
- [ ] Re-check Search Console query data **monthly**, and write the *next* batch
      of articles from the queries already earning impressions — that data beats
      any keyword guess made up front.
- [ ] **Lengthen the existing articles.** They currently run ~300–790 words
      against a 900–1,600 word target (exact counts per article per language are
      tabulated in `PROGRESS.md` under Phase 4). Expanding is additive: lengthen
      `steps[].text` and add `mistakes`/`faq` entries in `learn.articles.<slug>`.
      Do `fa` and `en` first — Persian is the primary market.

### When prices become fixed

- [ ] Publish real figures, mirror them into a typed constant in
      `irforge/src/pages/pricing.tsx` with a comment naming the source of truth,
      then add `offers` to the `SoftwareApplication` node (`price`,
      `priceCurrency: "IRR"`, `availability`). The schema and the visible page
      must match **exactly**. Until then `offers` stays omitted, as the header
      comment in `structured-data.ts` instructs.
