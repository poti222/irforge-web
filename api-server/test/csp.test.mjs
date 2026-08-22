/**
 * test/csp.test.mjs — IRFORGE_PROMPT_V3 Phase 6.1
 *
 * Layer 1 (always runs): the hash constants in lib/csp.ts must actually be
 * sha256(the literal script text stored right next to them) — this is
 * guaranteed by construction (scriptHash() derives them), but a test makes
 * sure nobody "helps" by hand-editing one without the other.
 *
 * Layer 2 (opportunistic): if a real `irforge/dist` build is present, the
 * literal script text in lib/csp.ts must appear verbatim in the built
 * output. This is the check that actually catches drift between this copy
 * and the frontend's real inline scripts — skipped (not failed) when no
 * build is present, since building the frontend isn't part of every test
 * run.
 *
 * Run with:  pnpm --filter @workspace/api-server run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { INLINE_SCRIPTS, INLINE_SCRIPT_HASHES, scriptHash } = await import("../src/lib/csp.ts");

test("every hash is sha256 of its own literal script text", () => {
  const recomputed = Object.values(INLINE_SCRIPTS).map(scriptHash);
  assert.deepEqual(INLINE_SCRIPT_HASHES, recomputed);
});

test("hashes are well-formed CSP sha256 sources", () => {
  for (const h of INLINE_SCRIPT_HASHES) {
    assert.match(h, /^sha256-[A-Za-z0-9+/]{43}=$/);
  }
});

test("changing a script's text changes its hash (sanity check on scriptHash itself)", () => {
  const a = scriptHash("console.log(1)");
  const b = scriptHash("console.log(2)");
  assert.notEqual(a, b);
});

const distRoot = path.resolve(__dirname, "../../irforge/dist");
const sampleIndexHtml = path.join(distRoot, "en", "index.html");

test("lib/csp.ts's literal script text matches a real frontend build, when one exists", { skip: !fs.existsSync(sampleIndexHtml) }, () => {
  const html = fs.readFileSync(sampleIndexHtml, "utf8");
  for (const [name, source] of Object.entries(INLINE_SCRIPTS)) {
    assert.ok(
      html.includes(source),
      `${name}'s literal text in lib/csp.ts was not found verbatim in ${sampleIndexHtml} — ` +
      `the frontend's inline script changed and lib/csp.ts needs updating to match.`,
    );
  }
});

test("langDir and themeFlash hashes match the ones extracted from irforge/index.html's source template, when present", () => {
  const sourceIndexHtml = path.resolve(__dirname, "../../irforge/index.html");
  if (!fs.existsSync(sourceIndexHtml)) return;
  const html = fs.readFileSync(sourceIndexHtml, "utf8");
  const bodies = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(bodies.length, 2, "expected exactly two bare <script> blocks in irforge/index.html");
  assert.equal(scriptHash(bodies[0]), INLINE_SCRIPT_HASHES[0]);
  assert.equal(scriptHash(bodies[1]), INLINE_SCRIPT_HASHES[1]);
});
