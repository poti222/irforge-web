/**
 * lib/catalogHtml.ts — Telegram HTML formatting whitelist sanitizer.
 * ─────────────────────────────────────────────────────────────────────────────
 * A JS/TS port of `plugins/_common/html_whitelist.py::sanitize_telegram_html()`
 * (irforge-app) — kept behaviorally identical on purpose: both repos write
 * into the same shared `catalog_items.body_html` field, and a product
 * description sanitized differently on each side would drift. Telegram's Bot
 * API HTML parse mode accepts only a small, fixed tag set (b, i, u, s, code,
 * pre, a, blockquote, tg-spoiler) and rejects the ENTIRE message if it sees
 * anything else — so admin-authored content must be sanitized to exactly
 * this whitelist before it's ever stored, not just escaped (which would
 * defeat the point of a formatting editor) and not just trusted (one stray
 * tag from pasted content would break delivery).
 *
 * Node has no stdlib HTML parser equivalent to Python's `html.parser`, and
 * this repo has no HTML-parsing dependency already — adding one for a small
 * fixed allow-list would be disproportionate, so this is a small
 * hand-written tokenizer, narrow by design (comments/tags/text only, no
 * script/style special-casing needed since disallowed tags are stripped
 * either way). Disallowed tags are stripped but their TEXT content is kept;
 * every text run is escaped so nothing can smuggle a raw tag through;
 * anything left open by malformed input is auto-closed.
 */

export const CANONICAL_TAGS = new Set([
  "b", "i", "u", "s", "code", "pre", "a", "blockquote", "tg-spoiler",
]);

/** Common synonyms a rich-text editor or pasted HTML might emit. */
const TAG_ALIASES: Record<string, string> = {
  strong: "b", em: "i", ins: "u", strike: "s", del: "s",
};

const SAFE_URL_SCHEMES = ["http://", "https://", "tg://"];

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(text: string): string {
  return escapeHtml(text).replace(/"/g, "&quot;");
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
};

/** Decodes the handful of entities real editors actually emit, so re-escaping below produces a normalized (not double-escaped) result — mirrors Python's `convert_charrefs=True`. */
function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === "#") {
      const codePoint = body[1] === "x" || body[1] === "X"
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : whole;
    }
    return NAMED_ENTITIES[body] ?? whole;
  });
}

type Attrs = Record<string, string>;

function parseAttrs(attrString: string): Attrs {
  const attrs: Attrs = {};
  const re = /([a-zA-Z-][a-zA-Z0-9-]*)\s*(?:=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrString)) !== null) {
    const name = m[1].toLowerCase();
    const value = m[3] ?? m[4] ?? m[5] ?? "";
    attrs[name] = decodeEntities(value);
  }
  return attrs;
}

function canonicalTag(tag: string, attrs: Attrs): string | null {
  const lower = tag.toLowerCase();
  if (lower === "span") {
    const classes = (attrs.class || "").split(/\s+/);
    return classes.includes("tg-spoiler") ? "tg-spoiler" : null;
  }
  return TAG_ALIASES[lower] ?? lower;
}

// Comment, or a start/end/self-closing tag, or a run of plain text. The
// trailing `|<` catches a lone `<` that doesn't start any recognized
// pattern (e.g. "5 < 10") — without it, the regex engine silently skips
// that character instead of treating it as literal text (a real bug caught
// by this module's own test suite).
const TOKEN_RE = /<!--[\s\S]*?-->|<\/[a-zA-Z][a-zA-Z0-9-]*\s*>|<[a-zA-Z][a-zA-Z0-9-]*(?:\s[^<>]*)?\/?>|[^<]+|</g;

export function sanitizeTelegramHtml(raw: string): string {
  if (!raw) return "";
  const out: string[] = [];
  const openStack: string[] = [];

  const tokens = raw.match(TOKEN_RE) ?? [];
  for (const token of tokens) {
    if (token.startsWith("<!--")) continue; // comments: dropped entirely, same as the Python parser

    if (token.startsWith("</")) {
      const tag = token.slice(2, -1).trim();
      const canonical = canonicalTag(tag, {});
      if (canonical === null || !openStack.includes(canonical)) continue;
      // Close back to (and including) this tag — tolerates a stray unmatched
      // close tag from garbled input without emitting an orphan </tag>.
      while (openStack.length) {
        const top = openStack.pop()!;
        out.push(`</${top}>`);
        if (top === canonical) break;
      }
      continue;
    }

    // A real start tag always has a letter right after `<` — this excludes
    // the bare `<` fallback token (e.g. from "5 < 10"), which must fall
    // through to the plain-text branch below and be escaped, not silently
    // dropped as an "unrecognized tag".
    if (/^<[a-zA-Z]/.test(token)) {
      const selfClosing = /\/>\s*$/.test(token);
      const inner = token.slice(1, selfClosing ? -2 : -1).trim();
      const spaceIdx = inner.search(/\s/);
      const tag = spaceIdx === -1 ? inner : inner.slice(0, spaceIdx);
      const attrs = spaceIdx === -1 ? {} : parseAttrs(inner.slice(spaceIdx + 1));
      const canonical = canonicalTag(tag, attrs);
      if (canonical === null || !CANONICAL_TAGS.has(canonical)) continue; // unknown/disallowed: drop the tag, its text still passes through

      if (canonical === "a") {
        const href = attrs.href || "";
        if (!SAFE_URL_SCHEMES.some((scheme) => href.startsWith(scheme))) continue; // unsafe/unrecognized scheme: drop the tag, keep the link text
        out.push(`<a href="${escapeAttr(href)}">`);
      } else {
        out.push(`<${canonical}>`);
      }
      if (!selfClosing) openStack.push(canonical);
      continue;
    }

    out.push(escapeHtml(decodeEntities(token)));
  }

  // Auto-close anything still open (garbled/truncated input) so the result
  // is always well-formed — never a message Telegram itself would reject
  // outright for a stray unclosed tag.
  while (openStack.length) out.push(`</${openStack.pop()}>`);

  return out.join("");
}
