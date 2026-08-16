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

/**
 * آیا این خطا یعنی «کردنشیال گوگل روی این سرور تنظیم نشده»؟
 *
 * محتمل‌ترین خطای پیکربندیِ کل این سامانه است، و تا امروز به‌شکل یک ۵۰۰ با
 * پیام «خطای غیرمنتظره روی سرور» بیرون می‌آمد — یعنی اپراتور هیچ سرنخی
 * نداشت که فقط یک متغیر محیطی جا افتاده. `getAuth()` این را با یک `Error`
 * ساده throw می‌کند، پس تنها راه تشخیصش متن پیام است.
 */
export function isSheetsNotConfiguredError(err: unknown): boolean {
  const message = String((err as { message?: string } | null)?.message ?? "");
  return message.includes("Google Sheets not configured") || message.includes("GOOGLE_CREDENTIALS_JSON");
}

/**
 * آیا این خطا یعنی «تبِ خواسته‌شده روی این اسپردشیت وجود ندارد»؟
 *
 * وقتی range به تبی اشاره کند که ساخته نشده، Sheets API یک **۴۰۰** با پیام
 * `Unable to parse range: 'forms'!A:B` برمی‌گرداند — نه ۴۰۴. از بیرون این با
 * «درخواستت بدشکل بود» فرق ندارد، برای همین تا امروز به‌عنوان یک خطای
 * غیرمنتظره بالا می‌رفت و کل سکشن سایت را با «خطای نامشخص سرور» می‌ترکاند
 * (فرم‌ها، آبجکت‌ها، ریلیشن‌ها — همه یک ریشه داشتند).
 *
 * تشخیص عمداً هم روی کد وضعیت و هم روی متن انجام می‌شود: یک ۴۰۰ـِ واقعی
 * (مثلاً range بدشکل به دلیل باگ خودمان) نباید بی‌صدا به «تب خالی» ترجمه شود.
 */
export function isMissingTabError(err: unknown): boolean {
  const anyErr = err as { code?: number; status?: number; message?: string } | null;
  if (!anyErr) return false;
  const status = anyErr.code ?? anyErr.status;
  if (status !== 400) return false;
  const message = String(anyErr.message ?? "");
  return message.includes("Unable to parse range");
}

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
    // تبِ ناموجود یک خطا نیست، یک «هنوز چیزی ننوشته‌ایم» است — و در سطح
    // خودِ readSheet هم لاگِ error نمی‌خواهد، وگرنه لاگ پر می‌شود از چیزی
    // که صداکننده‌اش (readTabRows) قرار است عادی مدیریتش کند.
    if (isMissingTabError(err)) {
      logger.debug({ spreadsheetId, range }, "readSheet: tab does not exist");
      throw err;
    }
    logger.error({ err, spreadsheetId, range }, "readSheet error");
    throw err;
  }
}

/**
 * چرا `RAW` و نه `USER_ENTERED` — ریشه‌ی چند باگ گزارش‌شده.
 * ─────────────────────────────────────────────────────────────────────────────
 * `USER_ENTERED` یعنی «این را طوری تفسیر کن که انگار کاربر در سلول تایپش
 * کرده». قرارداد شیت تننت اما این است که هر سلول **دقیقاً** خروجی
 * `JSON.stringify(value)` باشد و طرف مقابل با `JSON.parse` بخواندش. این دو
 * با هم نمی‌سازند:
 *
 *   - `JSON.stringify(false)` = `false` → گوگل آن را یک سلول **بولی** واقعی
 *     می‌کند. موقع خواندن `FALSE` برمی‌گردد، `JSON.parse("FALSE")` می‌شکند و
 *     مقدار به‌صورت رشته‌ی `"FALSE"` می‌ماند. در پایتون `bool("FALSE")` برابر
 *     `True` است — یعنی هر تنظیم بولی که از سایت خاموش شود، **در بات روشن
 *     می‌ماند**. پیام خوش‌آمدی که خاموش نمی‌شد دقیقاً همین بود.
 *   - همان رشته‌ی `"TRUE"` بعداً از سایت هم خوانده می‌شود و ولیدیشن با
 *     «مقدار watermark_enabled باید true یا false باشد» ذخیره را رد می‌کند —
 *     بدون اینکه کاربر اصلاً آن فیلد را لمس کرده باشد.
 *   - و سلولی که با `=` شروع شود به یک **فرمول** تبدیل می‌شد؛ یعنی متنی که
 *     کاربر در پیام بات نوشته، در شیت اجرا می‌شد.
 *
 * `RAW` سلول را همان‌طور که فرستاده شده می‌نویسد — همان کاری که خودِ بات با
 * gspread می‌کند (پیش‌فرضش `RAW` است). این تنها حالتی است که رفت‌وبرگشتِ
 * JSON را سالم نگه می‌دارد.
 */
const VALUE_INPUT_OPTION = "RAW";

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
      valueInputOption: VALUE_INPUT_OPTION,
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
      valueInputOption: VALUE_INPUT_OPTION,
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

    // شیت آزادشده باید همون لحظه، قبل از برگشتن به Pool، کامل تب‌بندی بشه —
    // نه موقع assign به بات بعدی. اگه اینجا نسازیمشون، بات بعدی که این شیت رو
    // می‌گیره یه شیت خالیِ فقط-Sheet1 تحویل می‌گیره و اولین درخواستی که یه تب
    // (مثل «panels») رو می‌خونه با خطای «تب پیدا نشد» گوگل‌شیت می‌ترکه.
    await ensureAllTenantTabs(spreadsheetId);
  } catch (err) {
    logger.error({ err, spreadsheetId }, "resetSpreadsheet error");
    throw err;
  }
}

// ─── Tenant-tab provisioning ────────────────────────────────────────────────

/**
 * هر تبی که یک بخش از سایت یا بات به‌عنوان یک entity-tab می‌خواند/می‌نویسد.
 * وقتی شیتی تازه (خالی، فقط با «Sheet1») به بات جدیدی می‌رسد — چه از Pool، چه
 * با پیست دستی ID توسط سوپرادمین — این تب‌ها هنوز رویش نیستند، و اولین
 * درخواستی که یکی از آن‌ها را می‌خواند (مثلاً پنل‌ها) روی خطای «تب پیدا نشد»ِ
 * گوگل‌شیت می‌ترکد چون `readTabRows` مستقیم از یک range با نام تب ناموجود
 * می‌خواند.
 *
 * این لیست باید با تمام ثابت‌های `*_TAB` پخش‌شده در routes/*.ts و lib/*.ts
 * همگام بماند: panelOps.ts (panels, custom_commands), botConfig.ts
 * (bot_settings), botAdmins.ts (admins), botForms.ts (forms),
 * botLanguage.ts (text_keys, text_values), botObjects.ts (object_schemas),
 * botOrders.ts (payments), botRelations.ts (relation_definitions,
 * relation_links), botSupportTickets.ts (tickets, ticket_messages),
 * botUsers.ts (users), botWorkflows.ts (workflows, workflow_runs),
 * discountStore.ts (discounts, discount_redemptions).
 */
export const ALL_TENANT_TABS: readonly string[] = [
  "bot_settings",
  "panels",
  "custom_commands",
  "admins",
  "forms",
  "text_keys",
  "text_values",
  "object_schemas",
  "payments",
  "relation_definitions",
  "relation_links",
  "tickets",
  "ticket_messages",
  "users",
  "workflows",
  "workflow_runs",
  "discounts",
  "discount_redemptions",
];

/**
 * هر تبی از `titles` که هنوز روی شیت نیست را می‌سازد — همه با هم در یک
 * batchUpdate (نه یکی‌یکی مثل `addTab`، که برای این تعداد تب کند و پرخطا
 * می‌شود)، بعد هدر `[key, value]` هرکدام را می‌نویسد. برای تب‌های موجود کاری
 * نمی‌کند، پس صدا زدنش همیشه امن است (idempotent).
 */
export async function ensureTabsExist(spreadsheetId: string, titles: readonly string[]): Promise<void> {
  const existing = await listTabs(spreadsheetId);
  const missing = titles.filter((t) => !existing.includes(t));
  if (missing.length === 0) return;

  const sheets = getSheetsClient();
  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: missing.map((title) => ({ addSheet: { properties: { title } } })),
      },
    });
  } catch (err) {
    logger.error({ err, spreadsheetId, missing }, "ensureTabsExist: batch addSheet failed");
    throw err;
  }

  // هدرها را جدا می‌نویسیم (values.update بچ نمی‌گیرد) — خطای هدر یک تب نباید
  // جلوی ساخته‌شدن/هدرگیریِ بقیه را بگیرد، تب بی‌هدر هم به مراتب بهتر از
  // تبِ اصلاً‌ناموجود است.
  for (const title of missing) {
    try {
      await writeSheet(spreadsheetId, `${quoteTab(title)}!A1`, [["key", "value"]]);
    } catch (err) {
      logger.error({ err, spreadsheetId, title }, "ensureTabsExist: header write failed");
    }
  }
}

/** میان‌بر: همه‌ی تب‌های ثابت شناخته‌شده‌ی تننت را می‌سازد (`ALL_TENANT_TABS`). */
export async function ensureAllTenantTabs(spreadsheetId: string): Promise<void> {
  await ensureTabsExist(spreadsheetId, ALL_TENANT_TABS);
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
