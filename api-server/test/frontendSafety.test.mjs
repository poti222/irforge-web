/**
 * test/frontendSafety.test.mjs — IRFORGE_PROMPT_V3 Phase 4.5
 *
 * The only `dangerouslySetInnerHTML` in the frontend today
 * (components/ui/chart.tsx) generates a CSS variable block from a
 * developer-authored theme config object, not user input — verified by
 * hand when this test was written. This is the guard against the next one:
 * the roadmap explicitly calls out the broadcast-preview and any future
 * markdown/HTML preview as "exactly the place someone will reach for
 * innerHTML" — any new `dangerouslySetInnerHTML` must go through DOMPurify
 * with an explicit allow-list, reviewed by hand, and added to
 * ALLOWED_FILES below deliberately — never silently.
 *
 * There is no frontend unit-test runner configured in this repo (the
 * verification gate for irforge-web is api-server's tests + build +
 * irforge's typecheck) — this lives in api-server/test because Node's test
 * runner can read any file in the repo regardless of which workspace it's
 * associated with, and this is cheap enough not to warrant standing up a
 * whole second test toolchain just for it.
 *
 * اجرا: pnpm --filter @workspace/api-server run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_SRC = path.join(__dirname, "..", "..", "irforge", "src");

const ALLOWED_FILES = new Set(["components/ui/chart.tsx"]);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      walk(full, out);
    } else if (/\.(tsx?|jsx?)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

test("dangerouslySetInnerHTML appears only in the one reviewed, known-safe file", () => {
  if (!fs.existsSync(FRONTEND_SRC)) return; // frontend workspace not present in this checkout
  const offenders = [];
  for (const file of walk(FRONTEND_SRC)) {
    const text = fs.readFileSync(file, "utf8");
    if (!text.includes("dangerouslySetInnerHTML")) continue;
    const rel = path.relative(FRONTEND_SRC, file).split(path.sep).join("/");
    if (!ALLOWED_FILES.has(rel)) offenders.push(rel);
  }
  assert.deepEqual(
    offenders, [],
    `new dangerouslySetInnerHTML usage outside the reviewed allow-list — sanitize with DOMPurify ` +
    `and an explicit tag allow-list, then add the file to ALLOWED_FILES deliberately: ${offenders.join(", ")}`,
  );
});

test("the one allowed file still exists and still uses dangerouslySetInnerHTML (allow-list isn't stale)", () => {
  if (!fs.existsSync(FRONTEND_SRC)) return;
  for (const rel of ALLOWED_FILES) {
    const full = path.join(FRONTEND_SRC, rel);
    assert.ok(fs.existsSync(full), `${rel} no longer exists — remove it from ALLOWED_FILES`);
    const text = fs.readFileSync(full, "utf8");
    assert.ok(
      text.includes("dangerouslySetInnerHTML"),
      `${rel} no longer uses dangerouslySetInnerHTML — remove it from ALLOWED_FILES`,
    );
  }
});
