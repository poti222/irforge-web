/**
 * panel-buttons.ts — تبدیل دوطرفه‌ی «ردیف‌های UI» ↔ «لیست تختِ دکمه‌ها».
 * ─────────────────────────────────────────────────────────────────────────────
 * باگ B9: در بات، `row`/`row_start` با یک migration ضمنی
 * (`_migrate_row_starts` + `_apply_row_starts` در `handlers/panel_builder.py`)
 * مدیریت می‌شود و راحت خراب می‌شود — مثلاً یک دکمه با `row` دستکاری‌شده کل
 * چیدمان بعدی را جابه‌جا می‌کند.
 *
 * راه‌حل سایت: مدل UI **آرایه‌ای از ردیف‌هاست**، نه یک لیست تخت با عددِ ردیف.
 * ساختن ردیف خالی، جابه‌جایی دکمه بین ردیف‌ها و حذف ردیف، همگی روی همان مدل
 * انجام می‌شوند و فقط در لحظه‌ی ذخیره به شکل تختِ نرمال‌شده صاف می‌شوند.
 *
 * ⚠️ این ماژول آینه‌ی `api-server/src/lib/botTypes.ts` است
 * (`normalizeButtonLayout`/`buttonsToRows`/`rowsToButtons`). سرور مستقلاً همین
 * نرمال‌سازی را روی هر نوشتن اعمال می‌کند، پس حتی اگر کلاینت اشتباه کند دیتای
 * روی شیت سالم می‌ماند. هر تغییری اینجا باید آنجا هم اعمال شود.
 *
 * قرارداد رندر بات (`handlers/user.py:865`): دکمه‌ها بر اساس `row` گروه می‌شوند
 * و ردیف‌ها بر اساس عدد `row` مرتب. پس `row` باید همیشه با `row_start` بخواند.
 */

export type PanelButton = {
  label: string;
  action: string;
  value: string;
  row: number;
  col: number;
  /** آیا این دکمه سر یک ردیف جدید است — منبع حقیقتِ چیدمان. */
  row_start: boolean;
  style: string;
  icon_custom_emoji_id?: string;
};

/**
 * حداکثر دکمه در یک ردیف — همان سقفی که سرور enforce می‌کند
 * (`api-server/src/lib/botTypes.ts`). هر دو باید با هم عوض شوند.
 *
 * از حدود ۵ دکمه به بعد، تلگرام برچسب‌ها را روی موبایل می‌بُرد و ردیف عملاً
 * ناخوانا می‌شود — چیزی که کاربر فقط بعد از انتشار پنل می‌فهمید.
 */
export const MAX_BUTTONS_PER_ROW = 4;

/** آیا می‌شود به این ردیف دکمه‌ی دیگری اضافه کرد؟ */
export function canAddToRow(rows: PanelButton[][], rowIndex: number): boolean {
  return (rows[rowIndex]?.length ?? 0) < MAX_BUTTONS_PER_ROW;
}

export function emptyButton(partial: Partial<PanelButton> = {}): PanelButton {
  return {
    label: partial.label ?? "",
    action: partial.action ?? "panel",
    value: partial.value ?? "",
    row: partial.row ?? 0,
    col: partial.col ?? 0,
    row_start: partial.row_start ?? true,
    style: partial.style ?? "",
    ...(partial.icon_custom_emoji_id ? { icon_custom_emoji_id: partial.icon_custom_emoji_id } : {}),
  };
}

/**
 * معادل دقیق `_migrate_row_starts` + `_apply_row_starts`:
 * هر دکمه صاحب `row_start` صریح می‌شود (دکمه‌های قدیمی از روی `row` قبلی‌شان
 * استنتاج می‌شوند)، بعد `row`/`col` از روی همان بازسازی می‌شوند.
 */
export function normalizeButtonLayout(buttons: PanelButton[]): PanelButton[] {
  const migrated = buttons.map((b, i) => ({
    ...b,
    row_start:
      b.row_start === undefined
        ? i === 0
          ? true
          : (b.row ?? 0) !== (buttons[i - 1]?.row ?? 0)
        : Boolean(b.row_start),
  }));
  let row = -1;
  let col = 0;
  return migrated.map((b, i) => {
    const starts = i === 0 ? true : Boolean(b.row_start);
    if (starts) {
      row += 1;
      col = 0;
    }
    const out = { ...b, row_start: starts, row, col };
    col += 1;
    return out;
  });
}

/** لیست تخت (شکل روی شیت) → ردیف‌ها (شکل UI). */
export function buttonsToRows(buttons: PanelButton[]): PanelButton[][] {
  const rows: PanelButton[][] = [];
  for (const b of normalizeButtonLayout(buttons)) {
    if (b.row_start || rows.length === 0) rows.push([]);
    rows[rows.length - 1].push(b);
  }
  return rows;
}

/** ردیف‌ها (شکل UI) → لیست تختِ نرمال‌شده (شکل روی شیت). ردیف خالی حذف می‌شود. */
export function rowsToButtons(rows: PanelButton[][]): PanelButton[] {
  const flat: PanelButton[] = [];
  for (const row of rows) {
    if (row.length === 0) continue;
    row.forEach((b, i) => flat.push({ ...b, row_start: i === 0 }));
  }
  return normalizeButtonLayout(flat);
}

// ─── عملیات چیدمان (همه روی مدل ردیف‌ها، همه immutable) ─────────────────────

export function addRow(rows: PanelButton[][]): PanelButton[][] {
  return [...rows, []];
}

export function removeRow(rows: PanelButton[][], rowIndex: number): PanelButton[][] {
  return rows.filter((_, i) => i !== rowIndex);
}

export function moveRow(rows: PanelButton[][], from: number, to: number): PanelButton[][] {
  if (to < 0 || to >= rows.length || from === to) return rows;
  const next = [...rows];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * دکمه را به ردیف اضافه می‌کند. ردیفِ پر بی‌صدا نادیده گرفته می‌شود (no-op) —
 * UI دکمه‌ی افزودن را از قبل غیرفعال کرده، ولی این تضمین می‌کند حتی یک مسیر
 * فراموش‌شده هم نتواند ردیفی بسازد که سرور بعداً ذخیره‌اش را رد می‌کند.
 */
export function addButton(rows: PanelButton[][], rowIndex: number, button: PanelButton): PanelButton[][] {
  if (!canAddToRow(rows, rowIndex)) return rows;
  return rows.map((row, i) => (i === rowIndex ? [...row, button] : row));
}

export function updateButton(
  rows: PanelButton[][],
  rowIndex: number,
  colIndex: number,
  patch: Partial<PanelButton>
): PanelButton[][] {
  return rows.map((row, i) =>
    i === rowIndex ? row.map((b, j) => (j === colIndex ? { ...b, ...patch } : b)) : row
  );
}

export function removeButton(rows: PanelButton[][], rowIndex: number, colIndex: number): PanelButton[][] {
  return rows.map((row, i) => (i === rowIndex ? row.filter((_, j) => j !== colIndex) : row));
}

/** جابه‌جایی افقی داخل همان ردیف. */
export function moveButtonHorizontally(
  rows: PanelButton[][],
  rowIndex: number,
  colIndex: number,
  delta: -1 | 1
): PanelButton[][] {
  const row = rows[rowIndex];
  const target = colIndex + delta;
  if (!row || target < 0 || target >= row.length) return rows;
  const next = [...row];
  [next[colIndex], next[target]] = [next[target], next[colIndex]];
  return rows.map((r, i) => (i === rowIndex ? next : r));
}

/**
 * جابه‌جایی عمودی: دکمه به ته ردیف بالا/پایین می‌رود. اگر ردیف مقصدی نباشد،
 * یک ردیف جدید ساخته می‌شود — یعنی «↑» روی اولین ردیف یک ردیف بالای آن می‌سازد.
 * ردیفی که خالی می‌ماند حذف می‌شود تا چیدمان سوراخ نشود.
 */
export function moveButtonVertically(
  rows: PanelButton[][],
  rowIndex: number,
  colIndex: number,
  delta: -1 | 1
): PanelButton[][] {
  const button = rows[rowIndex]?.[colIndex];
  if (!button) return rows;

  let next = rows.map((row, i) => (i === rowIndex ? row.filter((_, j) => j !== colIndex) : [...row]));
  let targetIndex = rowIndex + delta;

  if (targetIndex < 0) {
    next = [[], ...next];
    targetIndex = 0;
  } else if (targetIndex >= next.length) {
    next = [...next, []];
    targetIndex = next.length - 1;
  }

  // ردیف مقصدِ پر، دکمه را نمی‌پذیرد — وگرنه جابه‌جایی عمودی راهی می‌شد برای
  // ساختن ردیفی که ذخیره‌اش سمت سرور رد می‌شود.
  if (next[targetIndex].length >= MAX_BUTTONS_PER_ROW) return rows;

  next[targetIndex] = [...next[targetIndex], button];
  return next.filter((row) => row.length > 0);
}

/** ردیف‌هایی که از سقف تلگرام رد شده‌اند (برای هشدار در UI). */
export function overfullRows(rows: PanelButton[][]): number[] {
  return rows.map((row, i) => (row.length > MAX_BUTTONS_PER_ROW ? i : -1)).filter((i) => i >= 0);
}
