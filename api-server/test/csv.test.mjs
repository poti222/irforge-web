/**
 * test/csv.test.mjs — IRFORGE_PROMPT_V3 Phase 4.3
 *
 * safeCsvCell() must neutralize the leading `=`/`+`/`-`/`@`/tab/CR that
 * Excel and Google Sheets treat as the start of a formula, and correctly
 * quote any value containing a comma, quote or newline. The second test
 * here is the actual enforcement mechanism the roadmap asks for: no route
 * may set a text/csv response any way other than through this module, so
 * a future CSV export (order responses, survey results, sales ledgers,
 * ...) cannot reintroduce this by hand-rolling its own CSV writer.
 *
 * اجرا: pnpm --filter @workspace/api-server run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const csv = await import("../src/lib/csv.ts");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROUTES_DIR = path.join(__dirname, "..", "src", "routes");

test("safeCsvCell: prefixes a leading = + - @ tab CR with an apostrophe", () => {
  assert.equal(csv.safeCsvCell("=cmd|'/c calc'!A1"), "'=cmd|'/c calc'!A1");
  assert.equal(csv.safeCsvCell("+1234"), "'+1234");
  assert.equal(csv.safeCsvCell("-1234"), "'-1234");
  assert.equal(csv.safeCsvCell("@SUM(A1)"), "'@SUM(A1)");
  assert.equal(csv.safeCsvCell("\tx"), "'\tx");
  // a raw CR also needs CSV quoting on top of the apostrophe prefix, since
  // an unquoted CR could otherwise be misread as a row separator
  assert.equal(csv.safeCsvCell("\rx"), '"\'\rx"');
});

test("safeCsvCell: ordinary values pass through unchanged", () => {
  assert.equal(csv.safeCsvCell("سلام دنیا"), "سلام دنیا");
  assert.equal(csv.safeCsvCell("hello"), "hello");
  assert.equal(csv.safeCsvCell(1500000), "1500000");
  assert.equal(csv.safeCsvCell(null), "");
  assert.equal(csv.safeCsvCell(undefined), "");
});

test("safeCsvCell: quotes values containing a comma, quote or newline", () => {
  assert.equal(csv.safeCsvCell("a,b"), '"a,b"');
  assert.equal(csv.safeCsvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csv.safeCsvCell("line1\nline2"), '"line1\nline2"');
});

test("safeCsvCell: the apostrophe prefix survives quoting when both apply", () => {
  assert.equal(csv.safeCsvCell("=a,b"), '"\'=a,b"');
});

test("toCsv joins rows with CRLF and cells with a comma", () => {
  assert.equal(csv.toCsv([["a", "b"], ["=evil", "ok"]]), 'a,b\r\n\'=evil,ok');
});

test("sendCsv: sets the correct headers and prepends a UTF-8 BOM", () => {
  const calls = { headers: {}, status: null, body: null };
  const fakeRes = {
    status(code) { calls.status = code; return this; },
    setHeader(name, value) { calls.headers[name] = value; },
    send(body) { calls.body = body; },
  };
  csv.sendCsv(fakeRes, 'orders "weird".csv', [["id", "amount"], ["1", "=SUM(A1)"]]);

  assert.equal(calls.status, 200);
  assert.equal(calls.headers["Content-Type"], "text/csv; charset=utf-8");
  assert.equal(calls.headers["Content-Disposition"], 'attachment; filename="orders weird.csv"');
  assert.ok(calls.body.startsWith("﻿"));
  assert.ok(calls.body.includes("'=SUM(A1)"));
});

test("no route builds a CSV response any way other than lib/csv.ts", () => {
  const offenders = [];
  if (!fs.existsSync(ROUTES_DIR)) return;
  for (const file of fs.readdirSync(ROUTES_DIR)) {
    if (!file.endsWith(".ts")) continue;
    const fullPath = path.join(ROUTES_DIR, file);
    const text = fs.readFileSync(fullPath, "utf8");
    const mentionsCsv = /text\/csv/i.test(text) || /\.csv["'`]/.test(text);
    if (!mentionsCsv) continue;
    const usesHelper = /from ["'].*lib\/csv(\.js)?["']/.test(text);
    if (!usesHelper) offenders.push(file);
  }
  assert.deepEqual(offenders, [], `routes mentioning CSV without importing lib/csv.ts: ${offenders.join(", ")}`);
});
