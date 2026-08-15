/**
 * panelOps.ts — منطق دامنه‌ی پنل‌ها (درخت، ارجاعات، حذف امن، خانه، سلامت).
 * ─────────────────────────────────────────────────────────────────────────────
 * جدا از `routes/botPanels.ts` نگه داشته شده تا بشود بدون HTTP و بدون Google
 * تستش کرد (تست‌ها لایه‌ی شیت را در `botConfig.sheetLayer` جعل می‌کنند).
 *
 * چهار باگ بات که اینجا حل می‌شوند:
 *   B6 — حذف پنل، فرزندان را یتیم می‌کند و `parent_id`شان به یک پنل ناموجود
 *        اشاره می‌ماند. اینجا `strategy` اجباری است و هیچ ارجاع معلقی نمی‌ماند.
 *   B7 — حذف پنل، دکمه‌های `action="panel"` بقیه‌ی پنل‌ها را دست‌نخورده می‌گذارد
 *        → دکمه‌ی مرده. اینجا یا غیرفعال می‌شوند یا حذف.
 *   B8 — دو منبع حقیقت برای خانه (`panels[*].is_home` و
 *        `bot_settings.home_panel_id`). اینجا هر دو با هم و اتمیک آپدیت
 *        می‌شوند، و `/health` ناهماهنگی را گزارش می‌دهد.
 *   B9 — چیدمان دکمه‌ها همیشه از `normalizeButtonLayout` رد می‌شود.
 */
import {
  listEntity,
  getEntity,
  putEntity,
  putEntities,
  removeEntity,
  readSettings,
  patchSettings,
  BotConfigError,
} from "./botConfig.js";
import {
  normalizeButtonLayout,
  disabledButton,
  findOverfullRow,
  nowIso,
  MAX_BUTTONS_PER_ROW,
  type Panel,
  type PanelButton,
} from "./botTypes.js";
import { logger } from "./logger.js";

export const PANELS_TAB = "panels";
export const COMMANDS_TAB = "custom_commands";

// ─── خواندن ─────────────────────────────────────────────────────────────────

/** همه‌ی پنل‌ها. سطرهایی که شکل پنل ندارند (سلول خراب) رد می‌شوند. */
export async function listPanels(spreadsheetId: string): Promise<Panel[]> {
  const rows = await listEntity<Panel>(spreadsheetId, PANELS_TAB);
  const out: Panel[] = [];
  for (const row of rows) {
    const value = row.value;
    if (!value || typeof value !== "object") continue;
    // کلیدِ سطر همیشه بر id داخل مقدار مقدم است — کلید همان چیزی است که بات
    // با آن پنل را پیدا می‌کند.
    out.push({ ...(value as Panel), id: row.key });
  }
  return out;
}

export async function getPanel(spreadsheetId: string, panelId: string): Promise<Panel | null> {
  const value = await getEntity<Panel>(spreadsheetId, PANELS_TAB, panelId);
  if (!value || typeof value !== "object") return null;
  return { ...value, id: panelId };
}

export type PanelNode = Panel & { childNodes: PanelNode[]; depth: number };

/**
 * درخت پنل‌ها از روی `parent_id` (نه از روی `children`، که می‌تواند کهنه باشد).
 * پنلی که `parent_id`ش به پنل ناموجود اشاره می‌کند به‌عنوان ریشه نمایش داده
 * می‌شود، وگرنه اصلاً در درخت دیده نمی‌شد و کاربر فکر می‌کرد حذف شده.
 * حلقه‌های احتمالی (A→B→A) هم بریده می‌شوند تا رندر بی‌نهایت نشود.
 */
export function buildTree(panels: Panel[]): PanelNode[] {
  const byId = new Map(panels.map((p) => [p.id, p]));
  const nodes = new Map<string, PanelNode>(
    panels.map((p) => [p.id, { ...p, childNodes: [], depth: 0 }])
  );

  // حلقه‌ها (A→B→A) باید **قبل از** ساختن گراف بریده شوند. اگر فقط موقع پیمایش
  // مراقبشان باشیم، خروجی خودش یک ساختار حلقه‌ای است و اولین مصرف‌کننده‌ای که
  // ساده پیمایشش کند — از جمله `JSON.stringify` در پاسخ HTTP — می‌ایستد.
  // هر گرهی که زنجیره‌ی والدهایش به خودش برگردد، ریشه در نظر گرفته می‌شود.
  const inCycle = new Set<string>();
  for (const panel of panels) {
    const seen = new Set<string>();
    let cursor: string | null = panel.id;
    while (cursor && byId.has(cursor)) {
      if (seen.has(cursor)) {
        inCycle.add(cursor);
        break;
      }
      seen.add(cursor);
      cursor = byId.get(cursor)!.parent_id ?? null;
    }
  }

  const roots: PanelNode[] = [];
  for (const panel of panels) {
    const node = nodes.get(panel.id)!;
    const parentId = panel.parent_id;
    const parent = parentId ? nodes.get(parentId) : undefined;
    // پنلی که والدش وجود ندارد هم ریشه می‌شود — وگرنه اصلاً در درخت دیده
    // نمی‌شد و کاربر فکر می‌کرد حذف شده.
    if (!parentId || !parent || parentId === panel.id || inCycle.has(panel.id)) {
      roots.push(node);
      continue;
    }
    parent.childNodes.push(node);
  }

  const assign = (node: PanelNode, depth: number) => {
    node.depth = depth;
    for (const child of node.childNodes) assign(child, depth + 1);
  };
  for (const root of roots) assign(root, 0);
  return roots;
}

/** همه‌ی نوادگان یک پنل (بدون خودش)، امن در برابر حلقه. */
export function collectSubtree(panels: Panel[], rootId: string): string[] {
  const childrenOf = new Map<string, string[]>();
  for (const p of panels) {
    if (!p.parent_id) continue;
    const list = childrenOf.get(p.parent_id) ?? [];
    list.push(p.id);
    childrenOf.set(p.parent_id, list);
  }
  const out: string[] = [];
  const seen = new Set<string>([rootId]);
  const stack = [...(childrenOf.get(rootId) ?? [])];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    stack.push(...(childrenOf.get(id) ?? []));
  }
  return out;
}

// ─── ارجاعات ────────────────────────────────────────────────────────────────

export type PanelReferences = {
  parent: { id: string; title: string } | null;
  children: Array<{ id: string; title: string }>;
  /** دکمه‌های پنل‌های دیگر که به این پنل لینک داده‌اند. */
  buttons: Array<{ panelId: string; panelTitle: string; index: number; label: string }>;
  /** کامندهای سفارشی با `target = "panel:<id>"`. */
  commands: Array<{ command: string; description: string }>;
  /** آیا این پنل خانه است. */
  isHome: boolean;
};

export async function findReferences(
  spreadsheetId: string,
  panelId: string,
  panelsCache?: Panel[]
): Promise<PanelReferences> {
  const panels = panelsCache ?? (await listPanels(spreadsheetId));
  const self = panels.find((p) => p.id === panelId) ?? null;

  const parentPanel = self?.parent_id ? panels.find((p) => p.id === self.parent_id) : undefined;

  const buttons: PanelReferences["buttons"] = [];
  for (const panel of panels) {
    if (panel.id === panelId) continue;
    (panel.buttons ?? []).forEach((b, index) => {
      if (b?.action === "panel" && b?.value === panelId) {
        buttons.push({ panelId: panel.id, panelTitle: panel.title, index, label: b.label });
      }
    });
  }

  let commands: PanelReferences["commands"] = [];
  try {
    const rows = await listEntity<{ command?: string; target?: string; description?: string }>(
      spreadsheetId,
      COMMANDS_TAB
    );
    commands = rows
      .filter((r) => r.value && typeof r.value === "object" && r.value.target === `panel:${panelId}`)
      .map((r) => ({ command: r.value.command ?? r.key, description: r.value.description ?? "" }));
  } catch (err) {
    // تب `custom_commands` ممکن است هنوز روی این شیت ساخته نشده باشد — این
    // حالت عادی است، نه خطا.
    logger.debug({ err }, "findReferences: custom_commands tab unavailable");
  }

  return {
    parent: parentPanel ? { id: parentPanel.id, title: parentPanel.title } : null,
    children: panels.filter((p) => p.parent_id === panelId).map((p) => ({ id: p.id, title: p.title })),
    buttons,
    commands,
    isHome: Boolean(self?.is_home),
  };
}

// ─── نوشتن ──────────────────────────────────────────────────────────────────

async function savePanel(spreadsheetId: string, panel: Panel): Promise<void> {
  const buttons = normalizeButtonLayout(panel.buttons ?? []);

  // سقف دکمه در هر ردیف اینجا هم چک می‌شود، نه فقط در UI: هر چهار مسیر
  // نوشتن پنل (ساخت، ویرایش، ویرایش دکمه‌ها، جابه‌جایی) از همین تابع رد
  // می‌شوند، پس یک چک اینجا معادل چهار چک در route هاست — و صدازدن مستقیم
  // API هم نمی‌تواند دورش بزند.
  const overfull = findOverfullRow(buttons);
  if (overfull) {
    throw new BotConfigError(
      400,
      `ردیف ${overfull.row} پنل «${panel.title || panel.id}» ${overfull.count} دکمه دارد؛ حداکثر مجاز ${MAX_BUTTONS_PER_ROW} دکمه در هر ردیف است. دکمه‌های اضافه را به یک ردیف جدید ببرید.`,
      "row_too_full",
    );
  }

  await putEntity(spreadsheetId, PANELS_TAB, panel.id, {
    ...panel,
    buttons,
    updated_at: nowIso(),
  });
}

/** `children` والدها را از روی `parent_id`ها بازمی‌سازد (منبع حقیقت `parent_id` است). */
export function recomputeChildren(panels: Panel[]): Panel[] {
  const childrenOf = new Map<string, string[]>();
  for (const p of panels) {
    if (!p.parent_id) continue;
    const list = childrenOf.get(p.parent_id) ?? [];
    list.push(p.id);
    childrenOf.set(p.parent_id, list);
  }
  return panels.map((p) => {
    const next = childrenOf.get(p.id) ?? [];
    const current = p.children ?? [];
    const same = current.length === next.length && current.every((id, i) => id === next[i]);
    return same ? p : { ...p, children: next };
  });
}

// ─── حذف ────────────────────────────────────────────────────────────────────

export type DeleteStrategy = "cascade" | "reparent" | "orphan";
export type ButtonStrategy = "disable" | "remove";

export type DeleteReport = {
  deleted: string[];
  reparented: string[];
  orphaned: string[];
  buttonsChanged: number;
  homeCleared: boolean;
  danglingCommands: Array<{ command: string; description: string }>;
};

/**
 * حذف امنِ یک پنل. `strategy` اجباری است چون هر سه انتخاب معنای متفاوتی برای
 * کاربر دارند و پیش‌فرضِ ضمنی همان کاری است که بات می‌کند (یتیم‌کردن بی‌خبر).
 *
 * در هر سه حالت:
 *   - `children` همه‌ی والدها بازسازی می‌شود،
 *   - دکمه‌های `action="panel"` که به پنل‌های حذف‌شده اشاره دارند غیرفعال یا حذف می‌شوند،
 *   - اگر پنل حذف‌شده خانه بود، `bot_settings.home_panel_id` هم پاک می‌شود.
 */
export async function deletePanel(
  spreadsheetId: string,
  panelId: string,
  strategy: DeleteStrategy,
  buttonStrategy: ButtonStrategy = "disable"
): Promise<DeleteReport> {
  const panels = await listPanels(spreadsheetId);
  const target = panels.find((p) => p.id === panelId);
  if (!target) throw new Error("panel_not_found");

  const descendants = collectSubtree(panels, panelId);
  const directChildren = panels.filter((p) => p.parent_id === panelId);

  const toDelete = new Set<string>([panelId]);
  const report: DeleteReport = {
    deleted: [],
    reparented: [],
    orphaned: [],
    buttonsChanged: 0,
    homeCleared: false,
    danglingCommands: [],
  };

  if (strategy === "cascade") {
    for (const id of descendants) toDelete.add(id);
  }

  // پنل‌های باقی‌مانده، با parent_id اصلاح‌شده.
  let survivors = panels
    .filter((p) => !toDelete.has(p.id))
    .map((p) => {
      if (p.parent_id !== panelId) return p;
      if (strategy === "reparent") {
        report.reparented.push(p.id);
        return { ...p, parent_id: target.parent_id ?? null };
      }
      report.orphaned.push(p.id);
      return { ...p, parent_id: null };
    });

  // دکمه‌های ارجاع‌دهنده به هر پنلِ حذف‌شده (باگ B7).
  survivors = survivors.map((panel) => {
    const buttons = panel.buttons ?? [];
    if (!buttons.some((b) => b?.action === "panel" && toDelete.has(b?.value))) return panel;

    let next: PanelButton[];
    if (buttonStrategy === "remove") {
      next = buttons.filter((b) => !(b?.action === "panel" && toDelete.has(b?.value)));
      report.buttonsChanged += buttons.length - next.length;
    } else {
      next = buttons.map((b) => {
        if (b?.action === "panel" && toDelete.has(b?.value)) {
          report.buttonsChanged += 1;
          return disabledButton(b);
        }
        return b;
      });
    }
    return { ...panel, buttons: normalizeButtonLayout(next) };
  });

  survivors = recomputeChildren(survivors);

  // نوشتن: اول بازمانده‌های تغییرکرده، بعد حذف‌ها. اگر وسط کار چیزی بخورد
  // زمین، بدترین حالت یک پنلِ هنوز-موجود است که کسی به آن لینک نمی‌دهد —
  // نه یک دکمه‌ی زنده به پنل ناموجود.
  const before = new Map(panels.map((p) => [p.id, JSON.stringify(p)]));
  const changed = survivors.filter((p) => before.get(p.id) !== JSON.stringify(p));
  if (changed.length) {
    await putEntities(
      spreadsheetId,
      PANELS_TAB,
      changed.map((p) => ({ key: p.id, value: { ...p, updated_at: nowIso() } }))
    );
  }

  for (const id of toDelete) {
    if (await removeEntity(spreadsheetId, PANELS_TAB, id)) report.deleted.push(id);
  }

  // خانه (باگ B8): اگر پنلِ خانه حذف شد، ارجاع تنظیمات هم باید برود.
  const settings = await readSettings(spreadsheetId);
  if (settings.home_panel_id && toDelete.has(settings.home_panel_id)) {
    await patchSettings(spreadsheetId, { home_panel_id: null });
    report.homeCleared = true;
  }

  // کامندهایی که حالا به پنل ناموجود اشاره می‌کنند فقط **گزارش** می‌شوند:
  // اصلاحشان انتخاب کاربر است (فاز ۱۲ ویرایشگرشان را دارد)، نه چیزی که یک
  // حذفِ پنل باید بی‌خبر انجام دهد.
  for (const id of toDelete) {
    const refs = await findReferences(spreadsheetId, id, panels);
    report.danglingCommands.push(...refs.commands);
  }

  return report;
}

// ─── خانه (باگ B8) ──────────────────────────────────────────────────────────

/**
 * خانه‌کردن یک پنل: `is_home=false` روی بقیه، `is_home=true` روی این، و
 * `bot_settings.home_panel_id` — هر سه با هم. اگر وسط کار شکست بخورد،
 * best-effort به حالت قبل برمی‌گردد و لاگ می‌کند.
 */
export async function setHomePanel(spreadsheetId: string, panelId: string): Promise<Panel[]> {
  const panels = await listPanels(spreadsheetId);
  if (!panels.some((p) => p.id === panelId)) throw new Error("panel_not_found");

  const previousHome = panels.filter((p) => p.is_home).map((p) => p.id);
  const changed = panels
    .filter((p) => (p.id === panelId) !== Boolean(p.is_home))
    .map((p) => ({ ...p, is_home: p.id === panelId, updated_at: nowIso() }));

  try {
    if (changed.length) {
      await putEntities(spreadsheetId, PANELS_TAB, changed.map((p) => ({ key: p.id, value: p })));
    }
    await patchSettings(spreadsheetId, { home_panel_id: panelId });
  } catch (err) {
    logger.error({ err, panelId }, "setHomePanel failed, rolling back is_home flags");
    try {
      await putEntities(
        spreadsheetId,
        PANELS_TAB,
        changed.map((p) => ({ key: p.id, value: { ...p, is_home: previousHome.includes(p.id) } }))
      );
    } catch (rollbackErr) {
      logger.error({ rollbackErr }, "setHomePanel rollback also failed");
    }
    throw err;
  }
  return listPanels(spreadsheetId);
}

// ─── سلامت ──────────────────────────────────────────────────────────────────

export type HealthIssue = {
  code:
    | "home_mismatch"
    | "multiple_home"
    | "no_home"
    | "dangling_parent"
    | "stale_children"
    | "button_to_missing_panel"
    | "command_to_missing_panel";
  panelId?: string;
  detail: string;
  /** آیا `/panels/repair` می‌تواند خودکار درستش کند. */
  repairable: boolean;
};

export async function panelHealth(spreadsheetId: string): Promise<HealthIssue[]> {
  const panels = await listPanels(spreadsheetId);
  const settings = await readSettings(spreadsheetId);
  const ids = new Set(panels.map((p) => p.id));
  const issues: HealthIssue[] = [];

  const homes = panels.filter((p) => p.is_home).map((p) => p.id);
  if (homes.length > 1) {
    issues.push({
      code: "multiple_home",
      detail: `${homes.length} پنل هم‌زمان به‌عنوان خانه علامت خورده‌اند: ${homes.join("، ")}`,
      repairable: true,
    });
  }
  if (homes.length === 0 && !settings.home_panel_id && panels.length > 0) {
    issues.push({ code: "no_home", detail: "هیچ پنلی به‌عنوان صفحه‌ی خانه تعیین نشده است.", repairable: false });
  }
  if (settings.home_panel_id && !ids.has(settings.home_panel_id)) {
    issues.push({
      code: "home_mismatch",
      detail: `تنظیمات به پنل «${settings.home_panel_id}» به‌عنوان خانه اشاره می‌کند ولی چنین پنلی وجود ندارد.`,
      repairable: true,
    });
  } else if (settings.home_panel_id && homes.length === 1 && homes[0] !== settings.home_panel_id) {
    issues.push({
      code: "home_mismatch",
      detail: `تنظیمات پنل «${settings.home_panel_id}» را خانه می‌داند ولی پرچم is_home روی «${homes[0]}» است.`,
      repairable: true,
    });
  } else if (!settings.home_panel_id && homes.length === 1) {
    issues.push({
      code: "home_mismatch",
      detail: `پنل «${homes[0]}» پرچم is_home دارد ولی در تنظیمات ثبت نشده است.`,
      repairable: true,
    });
  }

  for (const panel of panels) {
    if (panel.parent_id && !ids.has(panel.parent_id)) {
      issues.push({
        code: "dangling_parent",
        panelId: panel.id,
        detail: `پنل «${panel.title || panel.id}» به والدِ ناموجود «${panel.parent_id}» اشاره می‌کند.`,
        repairable: true,
      });
    }
    const expected = panels.filter((p) => p.parent_id === panel.id).map((p) => p.id);
    const actual = panel.children ?? [];
    if (expected.length !== actual.length || expected.some((id, i) => id !== actual[i])) {
      issues.push({
        code: "stale_children",
        panelId: panel.id,
        detail: `فهرست فرزندان پنل «${panel.title || panel.id}» با واقعیت نمی‌خواند.`,
        repairable: true,
      });
    }
    (panel.buttons ?? []).forEach((b) => {
      if (b?.action === "panel" && b?.value && !ids.has(b.value)) {
        issues.push({
          code: "button_to_missing_panel",
          panelId: panel.id,
          detail: `دکمه‌ی «${b.label}» در پنل «${panel.title || panel.id}» به پنل ناموجود «${b.value}» لینک داده است.`,
          repairable: true,
        });
      }
    });
  }

  try {
    const rows = await listEntity<{ target?: string; command?: string }>(spreadsheetId, COMMANDS_TAB);
    for (const row of rows) {
      const target = row.value?.target;
      if (typeof target === "string" && target.startsWith("panel:") && !ids.has(target.slice(6))) {
        issues.push({
          code: "command_to_missing_panel",
          detail: `کامند «/${row.value?.command ?? row.key}» به پنل ناموجود «${target.slice(6)}» اشاره می‌کند.`,
          repairable: false,
        });
      }
    }
  } catch {
    /* تب کامندها ممکن است وجود نداشته باشد — حالت عادی. */
  }

  return issues;
}

/**
 * رفع خودکار مواردی که `repairable` هستند: هماهنگ‌کردن خانه، بریدن
 * `parent_id`های معلق، بازسازی `children`، و غیرفعال‌کردن دکمه‌های مرده.
 */
export async function repairPanels(spreadsheetId: string): Promise<{ fixed: number; issues: HealthIssue[] }> {
  const panels = await listPanels(spreadsheetId);
  const settings = await readSettings(spreadsheetId);
  const ids = new Set(panels.map((p) => p.id));

  const homes = panels.filter((p) => p.is_home).map((p) => p.id);
  // ترجیح: چیزی که در تنظیمات ثبت شده و واقعاً وجود دارد؛ وگرنه اولین is_home.
  const home =
    settings.home_panel_id && ids.has(settings.home_panel_id)
      ? settings.home_panel_id
      : homes.find((id) => ids.has(id)) ?? null;

  let next = panels.map((panel) => {
    let out = panel;
    if (panel.parent_id && !ids.has(panel.parent_id)) out = { ...out, parent_id: null };
    if (Boolean(panel.is_home) !== (home !== null && panel.id === home)) {
      out = { ...out, is_home: home !== null && panel.id === home };
    }
    const buttons = panel.buttons ?? [];
    if (buttons.some((b) => b?.action === "panel" && b?.value && !ids.has(b.value))) {
      out = {
        ...out,
        buttons: normalizeButtonLayout(
          buttons.map((b) => (b?.action === "panel" && b?.value && !ids.has(b.value) ? disabledButton(b) : b))
        ),
      };
    }
    return out;
  });
  next = recomputeChildren(next);

  const before = new Map(panels.map((p) => [p.id, JSON.stringify(p)]));
  const changed = next.filter((p) => before.get(p.id) !== JSON.stringify(p));
  if (changed.length) {
    await putEntities(
      spreadsheetId,
      PANELS_TAB,
      changed.map((p) => ({ key: p.id, value: { ...p, updated_at: nowIso() } }))
    );
  }
  if ((settings.home_panel_id ?? null) !== home) {
    await patchSettings(spreadsheetId, { home_panel_id: home });
  }

  return { fixed: changed.length, issues: await panelHealth(spreadsheetId) };
}

export { savePanel };
