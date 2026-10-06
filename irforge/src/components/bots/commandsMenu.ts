/**
 * commandsMenu.ts — منطقِ خالصِ ویرایشگرِ منوی «/»ِ تلگرام (بدونِ React؛ قابلِ تست).
 *
 * منو یک **پیش‌نویسِ محلی** است که از منوی زنده‌یِ تلگرام شروع می‌شود؛ مالک اضافه/حذف/جابه‌جا/توضیح را روی همین
 * پیش‌نویس می‌زند و با «ذخیره» کلِ لیست یک‌جا روی بات اعمال می‌شود (`PUT /bots/:botId/commands/menu`).
 * قواعد با `api-server/src/routes/botCommands.ts::validateMenuList` یکی است.
 */
export type MenuEntry = { command: string; description: string };

/** نامِ مجازِ آیتمِ منوی تلگرام. */
export const MENU_NAME_RE = /^[a-z0-9_]{1,32}$/;
export const MENU_MAX = 100;
export const MENU_DESC_MAX = 256;

export function sameMenu(a: readonly MenuEntry[], b: readonly MenuEntry[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => x.command === b[i].command && x.description === b[i].description);
}

export function hasEntry(list: readonly MenuEntry[], command: string): boolean {
  return list.some((m) => m.command === command);
}

/** افزودن به **ته** منو؛ تکراری/نامِ نامعتبر/سقفِ ۱۰۰ → بدونِ تغییر. توضیحِ خالی با `/نام` پر می‌شود (تلگرام رد می‌کند). */
export function addEntry(list: readonly MenuEntry[], command: string, description: string): MenuEntry[] {
  if (!MENU_NAME_RE.test(command) || hasEntry(list, command) || list.length >= MENU_MAX) return [...list];
  return [...list, { command, description: description.trim().slice(0, MENU_DESC_MAX) || `/${command}` }];
}

export function removeEntry(list: readonly MenuEntry[], command: string): MenuEntry[] {
  return list.filter((m) => m.command !== command);
}

/** یک خانه بالا/پایین؛ در لبه‌ها بدونِ تغییر. */
export function moveEntry(list: readonly MenuEntry[], command: string, direction: "up" | "down"): MenuEntry[] {
  const i = list.findIndex((m) => m.command === command);
  if (i === -1) return [...list];
  const j = direction === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= list.length) return [...list];
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

export function setEntryDescription(list: readonly MenuEntry[], command: string, description: string): MenuEntry[] {
  return list.map((m) => (m.command === command ? { ...m, description: description.slice(0, MENU_DESC_MAX) } : m));
}

/** درخواستِ ذخیره: توضیحِ خالی با `/نام` پر می‌شود (همان کاری که سرور هم می‌کند). */
export function toPayload(list: readonly MenuEntry[]): MenuEntry[] {
  return list.map((m) => ({ command: m.command, description: m.description.trim() || `/${m.command}` }));
}
