import { google } from "googleapis";
import { logger } from "./logger.js";

// ─── Setup ─────────────────────────────────────────────────────────────────
// In Railway, set these env vars:
//   GOOGLE_CREDENTIALS_JSON       → (preferred, unified across all three
//     services) full service-account JSON as a single-line string. Parsed
//     for `client_email` / `private_key`.
//   GOOGLE_SERVICE_ACCOUNT_EMAIL  → (legacy fallback) service account email
//   GOOGLE_SERVICE_ACCOUNT_KEY    → (legacy fallback) private key (with \n
//     as literal \n) — only read if GOOGLE_CREDENTIALS_JSON isn't set.
//   SHEETS_<NAME>_ID              → sheet ID for each named spreadsheet.
//     This project uses exactly two: SHEETS_DATA_ID and SHEETS_REGISTRY_ID
//     (see sheetsSync.ts for how entities map to tabs within SHEETS_DATA_ID,
//     and for the REGISTRY_SPREADSHEET_ID unified-name fallback).
//     getSheetId() below is generic and works for any SHEETS_<NAME>_ID you add.

/**
 * Parse `client_email` / `private_key` out of a full service-account JSON
 * string (the `GOOGLE_CREDENTIALS_JSON` unified format shared with
 * mainbot/support-bot). Handles both a real downloaded key file (private_key
 * already contains literal newlines) and a minified single-line env var
 * (private_key contains the two-character escape `\n`).
 */
function parseCredentialsJson(raw: string): { email: string; key: string } {
  let parsed: { client_email?: string; private_key?: string };
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      "GOOGLE_CREDENTIALS_JSON is set but is not valid JSON. It must be the full service-account key file contents as a single string."
    );
  }
  const { client_email, private_key } = parsed;
  if (!client_email || !private_key) {
    throw new Error(
      "GOOGLE_CREDENTIALS_JSON is missing client_email or private_key."
    );
  }
  return { email: client_email, key: private_key.replace(/\\n/g, "\n") };
}

function getAuth() {
  const credentialsJson = process.env.GOOGLE_CREDENTIALS_JSON;

  let email: string | undefined;
  let key: string | undefined;

  if (credentialsJson) {
    // Preferred path: unified GOOGLE_CREDENTIALS_JSON (same var name used
    // by mainbot and support-bot).
    ({ email, key } = parseCredentialsJson(credentialsJson));
  } else {
    // Legacy fallback: split email/key vars.
    email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    key = process.env.GOOGLE_SERVICE_ACCOUNT_KEY?.replace(/\\n/g, "\n");
  }

  if (!email || !key) {
    throw new Error(
      "Google Sheets not configured. Set GOOGLE_CREDENTIALS_JSON (preferred), or GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_SERVICE_ACCOUNT_KEY (legacy)."
    );
  }

  return new google.auth.GoogleAuth({
    credentials: {
      client_email: email,
      private_key: key,
    },
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

export function getSheetsClient() {
  return google.sheets({ version: "v4", auth: getAuth() });
}

/** List every tab (worksheet) title in a spreadsheet. */
export async function listTabs(spreadsheetId: string): Promise<string[]> {
  try {
    const sheets = getSheetsClient();
    const res = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: "sheets.properties.title",
    });
    return (res.data.sheets ?? [])
      .map((s) => s.properties?.title)
      .filter((t): t is string => Boolean(t));
  } catch (err) {
    logger.error({ err, spreadsheetId }, "listTabs error");
    throw err;
  }
}

/** Create a new tab; seeds the [key, value] header. No-op if it already exists. */
export async function addTab(spreadsheetId: string, title: string): Promise<void> {
  const existing = await listTabs(spreadsheetId);
  if (existing.includes(title)) return;
  const sheets = getSheetsClient();
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ addSheet: { properties: { title } } }] },
  });
  await writeSheet(spreadsheetId, `${quoteTab(title)}!A1`, [["key", "value"]]);
}

/** Quote a tab name for A1 notation (handles spaces / specials). */
export function quoteTab(tab: string): string {
  return `'${tab.replace(/'/g, "''")}'`;
}

/**
 * Rename a spreadsheet's title (mirrors the bot's `rename_spreadsheet` →
 * "IrForge — <name>"). Uses the Sheets API's updateSpreadsheetProperties, which
 * only needs the spreadsheets scope (no Drive scope required).
 */
export async function renameSpreadsheet(spreadsheetId: string, title: string): Promise<void> {
  const sheets = getSheetsClient();
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ updateSpreadsheetProperties: { properties: { title }, fields: "title" } }],
    },
  });
}

/** Whether the service account can open a spreadsheet (used to validate a pasted ID). */
export async function sheetIsAccessible(spreadsheetId: string): Promise<boolean> {
  try {
    const sheets = getSheetsClient();
    await sheets.spreadsheets.get({ spreadsheetId, fields: "spreadsheetId" });
    return true;
  } catch {
    return false;
  }
}

// ─── Sheet ID helpers ───────────────────────────────────────────────────────
// Returns the sheet ID for a named sheet.
// Usage: getSheetId("USERS") → reads env SHEETS_USERS_ID
export function getSheetId(name: string): string {
  const id = process.env[`SHEETS_${name.toUpperCase()}_ID`];
  if (!id) throw new Error(`Env var SHEETS_${name.toUpperCase()}_ID is not set`);
  return id;
}

// ─── Core operations ────────────────────────────────────────────────────────

/** Read all rows from a sheet. Returns string[][] */
export async function readSheet(
  spreadsheetId: string,
  range: string = "Sheet1"
): Promise<string[][]> {
  try {
    const sheets = getSheetsClient();
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    return (res.data.values as string[][]) ?? [];
  } catch (err) {
    logger.error({ err, spreadsheetId, range }, "readSheet error");
    throw err;
  }
}

/** Overwrite a range with new values */
export async function writeSheet(
  spreadsheetId: string,
  range: string,
  values: (string | number | boolean | null)[][]
): Promise<void> {
  try {
    const sheets = getSheetsClient();
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: "USER_ENTERED",
      requestBody: { values },
    });
  } catch (err) {
    logger.error({ err, spreadsheetId, range }, "writeSheet error");
    throw err;
  }
}

/** Append rows to a sheet */
export async function appendSheet(
  spreadsheetId: string,
  range: string,
  values: (string | number | boolean | null)[][]
): Promise<void> {
  try {
    const sheets = getSheetsClient();
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values },
    });
  } catch (err) {
    logger.error({ err, spreadsheetId, range }, "appendSheet error");
    throw err;
  }
}

/** Clear a range */
export async function clearSheet(
  spreadsheetId: string,
  range: string
): Promise<void> {
  try {
    const sheets = getSheetsClient();
    await sheets.spreadsheets.values.clear({ spreadsheetId, range });
  } catch (err) {
    logger.error({ err, spreadsheetId, range }, "clearSheet error");
    throw err;
  }
}

/**
 * یک اسپردشیت رو کاملاً ریست می‌کنه: همه‌ی تب‌های موجود رو حذف می‌کنه و
 * فقط یه تب خالی به اسم "Sheet1" جاش می‌ذاره — دقیقاً مثل حالتی که یه
 * اسپردشیت تازه ساخته شده. برای جلوگیری از نشت دیتای بات قبلی به بات
 * بعدی، هر جا شیتی از یه بات آزاد می‌شه (حذف بات یا release دستی توسط
 * سوپرادمین) باید این تابع صدا زده بشه.
 */
export async function resetSpreadsheet(spreadsheetId: string): Promise<void> {
  try {
    const sheets = getSheetsClient();
    const current = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: "sheets.properties(sheetId,title)",
    });
    const existingSheets = current.data.sheets ?? [];
    const tempTitle = `_reset_${Date.now()}`;

    // اول یه تب موقت خالی اضافه می‌کنیم، بعد همه‌ی تب‌های قبلی رو حذف
    // می‌کنیم — این ترتیب لازمه چون گوگل‌شیت نمی‌ذاره آخرین تب حذف بشه.
    const addResult = await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          { addSheet: { properties: { title: tempTitle } } },
          ...existingSheets
            .filter((s) => s.properties?.sheetId != null)
            .map((s) => ({ deleteSheet: { sheetId: s.properties!.sheetId! } })),
        ],
      },
    });

    const newSheetId = addResult.data.replies?.[0]?.addSheet?.properties?.sheetId;
    if (newSheetId != null) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              updateSheetProperties: {
                properties: { sheetId: newSheetId, title: "Sheet1" },
                fields: "title",
              },
            },
          ],
        },
      });
    }
  } catch (err) {
    logger.error({ err, spreadsheetId }, "resetSpreadsheet error");
    throw err;
  }
}

/** Read sheet as array of objects using first row as headers */
export async function readSheetAsObjects(
  spreadsheetId: string,
  range: string = "Sheet1"
): Promise<Record<string, string>[]> {
  const rows = await readSheet(spreadsheetId, range);
  if (rows.length < 1) return [];
  const [headers, ...data] = rows;
  return data.map((row) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = row[i] ?? "";
    });
    return obj;
  });
}

/** Write array of objects back to sheet (headers from first object's keys) */
export async function writeSheetFromObjects(
  spreadsheetId: string,
  range: string,
  objects: Record<string, unknown>[]
): Promise<void> {
  if (objects.length === 0) return;
  const headers = Object.keys(objects[0]);
  const rows = objects.map((o) => headers.map((h) => String(o[h] ?? "")));
  await writeSheet(spreadsheetId, range, [headers, ...rows]);
}
