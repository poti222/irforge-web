/**
 * test/catalogHtml.test.mjs — IRFORGE catalog rich editor, web side (Part B).
 *
 * `lib/catalogHtml.ts::sanitizeTelegramHtml()` is a JS port of
 * `plugins/_common/html_whitelist.py::sanitize_telegram_html()`
 * (irforge-app) — both sides write into the same shared
 * `catalog_items.body_html` field, so this must stay behaviorally
 * identical. Cross-language parity for a representative sample is checked
 * separately (see the parity script referenced in PROGRESS.md); this file
 * covers the TS port's own behavior in isolation.
 *
 * اجرا: pnpm --filter @workspace/api-server run test
 */
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";

import { test } from "node:test";
import assert from "node:assert/strict";

const { sanitizeTelegramHtml, CANONICAL_TAGS } = await import("../src/lib/catalogHtml.ts");

test("canonical tags pass through unchanged", () => {
  assert.equal(sanitizeTelegramHtml("<b>bold</b>"), "<b>bold</b>");
  assert.equal(sanitizeTelegramHtml("<i>x</i><u>y</u><s>z</s>"), "<i>x</i><u>y</u><s>z</s>");
  assert.equal(sanitizeTelegramHtml("<code>x = 1</code>"), "<code>x = 1</code>");
  assert.equal(sanitizeTelegramHtml("<pre>line1\nline2</pre>"), "<pre>line1\nline2</pre>");
  assert.equal(sanitizeTelegramHtml("<blockquote>quoted</blockquote>"), "<blockquote>quoted</blockquote>");
});

test("CANONICAL_TAGS is exactly Telegram's whitelist", () => {
  assert.deepEqual(
    [...CANONICAL_TAGS].sort(),
    ["a", "b", "blockquote", "code", "i", "pre", "s", "tg-spoiler", "u"].sort(),
  );
});

test("common synonyms are normalized to Telegram's canonical spelling", () => {
  assert.equal(sanitizeTelegramHtml("<strong>x</strong>"), "<b>x</b>");
  assert.equal(sanitizeTelegramHtml("<em>x</em>"), "<i>x</i>");
  assert.equal(sanitizeTelegramHtml("<ins>x</ins>"), "<u>x</u>");
  assert.equal(sanitizeTelegramHtml("<strike>x</strike>"), "<s>x</s>");
  assert.equal(sanitizeTelegramHtml("<del>x</del>"), "<s>x</s>");
});

test("span.tg-spoiler is recognized as Telegram's alternate spoiler spelling", () => {
  assert.equal(sanitizeTelegramHtml('<span class="tg-spoiler">hidden</span>'), "<tg-spoiler>hidden</tg-spoiler>");
  assert.equal(sanitizeTelegramHtml('<span class="tg-spoiler other-class">x</span>'), "<tg-spoiler>x</tg-spoiler>");
});

test("a plain span (no tg-spoiler class) is stripped, text kept", () => {
  assert.equal(sanitizeTelegramHtml('<span class="foo">x</span>'), "x");
  assert.equal(sanitizeTelegramHtml("<span>x</span>"), "x");
});

test("disallowed tags are stripped but their text content survives", () => {
  assert.equal(sanitizeTelegramHtml("<div>hello</div>"), "hello");
  assert.equal(sanitizeTelegramHtml("<p>one</p><p>two</p>"), "onetwo");
  assert.equal(sanitizeTelegramHtml("<script>alert(1)</script>"), "alert(1)");
});

test("a[href] with a safe scheme is kept with only href preserved", () => {
  assert.equal(
    sanitizeTelegramHtml('<a href="https://example.com" onclick="x()" class="y">link</a>'),
    '<a href="https://example.com">link</a>',
  );
  assert.equal(sanitizeTelegramHtml('<a href="tg://user?id=1">x</a>'), '<a href="tg://user?id=1">x</a>');
});

test("a[href] with an unsafe/unrecognized scheme is stripped, link text kept", () => {
  assert.equal(sanitizeTelegramHtml('<a href="javascript:alert(1)">click</a>'), "click");
  assert.equal(sanitizeTelegramHtml('<a href="data:text/html,x">click</a>'), "click");
  assert.equal(sanitizeTelegramHtml("<a>no href</a>"), "no href");
});

test("a malformed quote-breakout attempt in href never produces a live tag boundary from attacker data", () => {
  // The tokenizer's tag boundary is the first bare `>` regardless of quotes
  // (a deliberate simplification, not a full HTML5 parser) -- so this
  // malformed input's own `">` prematurely closes the <a> tag earlier than
  // the attacker intended, and everything after becomes inert escaped text.
  // The security property that actually matters holds either way: no
  // unescaped `<`/`>` from user data ever reaches the output as real markup.
  const out = sanitizeTelegramHtml('<a href="https://example.com/?x="><script>1</script>">t</a>');
  assert.equal(out, '<a href="https://example.com/?x=">1"&gt;t</a>');
  assert.doesNotMatch(out, /<script/);
});

test("every text run is HTML-escaped, so a smuggled tag in text never re-parses as markup", () => {
  assert.equal(sanitizeTelegramHtml("plain <b>&<>\" text</b>"), "plain <b>&amp;&lt;&gt;\" text</b>");
  assert.equal(sanitizeTelegramHtml("5 < 10 and 10 > 5"), "5 &lt; 10 and 10 &gt; 5");
});

test("common named/numeric entities decode then re-escape to a normalized form (no double-escaping)", () => {
  assert.equal(sanitizeTelegramHtml("Tom &amp; Jerry"), "Tom &amp; Jerry");
  assert.equal(sanitizeTelegramHtml("&#65;&#x42;"), "AB");
});

test("an unclosed tag is auto-closed rather than producing malformed output", () => {
  assert.equal(sanitizeTelegramHtml("<b>bold text"), "<b>bold text</b>");
  assert.equal(sanitizeTelegramHtml("<b><i>both open"), "<b><i>both open</i></b>");
});

test("a stray unmatched closing tag is dropped without crashing or emitting an orphan", () => {
  assert.equal(sanitizeTelegramHtml("text</b>more"), "textmore");
});

test("nested/mismatched close order still closes back to (and including) the matched tag", () => {
  // </b> while <i> is innermost: closes <i> too, matching Python's own
  // documented "close back to and including this tag" behavior.
  assert.equal(sanitizeTelegramHtml("<b><i>x</b>y"), "<b><i>x</i></b>y");
});

test("comments are dropped entirely, not even their text", () => {
  assert.equal(sanitizeTelegramHtml("a<!-- secret -->b"), "ab");
});

test("empty/falsy input returns an empty string", () => {
  assert.equal(sanitizeTelegramHtml(""), "");
});

test("a self-closing tag never leaves an open-stack entry behind", () => {
  // Not a real Telegram tag, but exercises the self-closing branch: text
  // after it must not end up wrapped in a spurious closing tag.
  assert.equal(sanitizeTelegramHtml("<br/>after"), "after");
});

test("plain text with no markup at all passes through only HTML-escaped", () => {
  assert.equal(sanitizeTelegramHtml("just plain text"), "just plain text");
});
