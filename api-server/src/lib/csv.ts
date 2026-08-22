/**
 * lib/csv.ts — IRFORGE_PROMPT_V3 Phase 4.3
 *
 * CSV formula injection: a cell beginning with `=`, `+`, `-`, `@`, a tab or
 * a carriage return is executed as a formula when the file is opened in
 * Excel or Google Sheets. A user types `=cmd|'/c calc'!A1` into a form
 * field; an admin exports the responses; it runs on the admin's machine.
 *
 * Every CSV export this codebase adds (order responses, survey results,
 * discount usage, wallet/sales ledgers, ...) MUST build its cells through
 * `safeCsvCell()` and send the response through `sendCsv()` — never
 * construct a CSV string or set the CSV response headers by hand.
 * test/csv.test.mjs asserts no route sets a text/csv content type any other
 * way.
 */
import type { Response } from "express";

const DANGEROUS_LEADING = new Set(["=", "+", "-", "@", "\t", "\r"]);

/** Escape one value for a single CSV cell: formula-injection-safe and
 * correctly quoted if it contains a comma, quote, or newline. */
export function safeCsvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (s.length > 0 && DANGEROUS_LEADING.has(s[0])) {
    // A leading apostrophe forces Excel/Sheets to treat the cell as text —
    // applied before the quoting check below, because Excel's formula
    // detection looks at the parsed cell content, not the raw CSV framing,
    // so quoting alone would not neutralize it.
    s = "'" + s;
  }
  const needsQuoting = /[",\r\n]/.test(s);
  const escaped = s.replace(/"/g, '""');
  return needsQuoting ? `"${escaped}"` : escaped;
}

export function toCsvRow(cells: unknown[]): string {
  return cells.map(safeCsvCell).join(",");
}

export function toCsv(rows: unknown[][]): string {
  return rows.map(toCsvRow).join("\r\n");
}

// A UTF-8 BOM so Excel (which otherwise guesses the legacy system codepage)
// renders Persian text correctly instead of mojibake.
const UTF8_BOM = "\uFEFF";

/** Send `rows` (each an array of raw, unescaped values) as a downloadable
 * CSV file with the correct headers and BOM. */
export function sendCsv(res: Response, filename: string, rows: unknown[][]): void {
  const body = UTF8_BOM + toCsv(rows);
  const safeFilename = filename.replace(/["\r\n]/g, "");
  res.status(200);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${safeFilename}"`);
  res.send(body);
}
