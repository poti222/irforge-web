/**
 * routes/botPanels.ts — CRUD پنل‌ها روی تب `panels` شیت تننت.
 * منطق دامنه در `lib/panelOps.ts` است؛ اینجا فقط ولیدیشن ورودی و HTTP.
 */
import { Router } from "express";
import { requireAuth } from "./auth.js";
import {
  resolveBotSheet,
  putEntity,
  assertSheetsAuthoritative,
  sendBotConfigError,
  BotConfigError,
} from "../lib/botConfig.js";
import {
  listPanels,
  getPanel,
  buildTree,
  findReferences,
  deletePanel,
  setHomePanel,
  panelHealth,
  repairPanels,
  recomputeChildren,
  collectSubtree,
  savePanel,
  PANELS_TAB,
  type DeleteStrategy,
  type ButtonStrategy,
} from "../lib/panelOps.js";
import {
  CORE_PANEL_TYPES,
  CORE_BTN_ACTIONS,
  BUTTON_STYLES,
  MULTI_MEDIA_PANEL_TYPES,
  TEXT_ONLY_PANEL_TYPES,
  newPanel,
  newButton,
  normalizeButtonLayout,
  nowIso,
  TELEGRAM_TEXT_LIMIT,
  type Panel,
  type PanelButton,
} from "../lib/botTypes.js";
import { putEntities } from "../lib/botConfig.js";
import { isPluginEnabled } from "../lib/pluginGate.js";
import { PLUGIN_BUTTON_ACTIONS, CATALOG_ORDER_ACTION } from "../lib/pluginButtonActions.js";
import { PLUGIN_PANEL_TYPES } from "../lib/pluginPanelTypes.js";

const router = Router();

function bad(message: string, code?: string): BotConfigError {
  return new BotConfigError(400, message, code);
}

/** حداکثر دکمه در یک ردیف — محدودیت عملی تلگرام. */
const MAX_BUTTONS_PER_ROW = 8;

// ─── ولیدیشن ────────────────────────────────────────────────────────────────

function validateTitle(value: unknown): string {
  if (typeof value !== "string") throw bad("عنوان پنل باید متن باشد.");
  const title = value.trim();
  if (!title) throw bad("عنوان پنل نمی‌تواند خالی باشد.");
  if (title.length > 200) throw bad("عنوان پنل نباید بیشتر از ۲۰۰ کاراکتر باشد.");
  return title;
}

/**
 * نوع پنل: انواع هسته + هر نوعی که یک پلاگین ثبت کرده. چون سایت لیست پلاگین‌های
 * فعال را قطعی نمی‌داند، نوعِ ناشناخته رد نمی‌شود بلکه فقط شکلش چک می‌شود —
 * وگرنه سایت جلوی نوع پلاگینیِ کاملاً معتبر را می‌گرفت.
 */
function validateType(value: unknown): string {
  if (typeof value !== "string") throw bad("نوع پنل باید متن باشد.");
  const type = value.trim();
  if (!/^[a-z][a-z0-9_]{0,31}$/.test(type))
    throw bad("نوع پنل معتبر نیست (فقط حروف کوچک انگلیسی، عدد و زیرخط).");
  return type;
}

function validateContent(value: unknown): string {
  if (typeof value !== "string") throw bad("محتوای پنل باید متن باشد.");
  if (value.length > TELEGRAM_TEXT_LIMIT)
    throw bad(`محتوای پنل از ${TELEGRAM_TEXT_LIMIT} کاراکتر بیشتر است (سقف تلگرام).`);
  return value;
}

function validateButtons(value: unknown): PanelButton[] {
  if (!Array.isArray(value)) throw bad("فهرست دکمه‌ها باید آرایه باشد.");
  if (value.length > 100) throw bad("حداکثر ۱۰۰ دکمه برای یک پنل مجاز است.");

  const buttons = value.map((raw: any, i: number) => {
    if (!raw || typeof raw !== "object") throw bad(`دکمه‌ی شماره ${i + 1} معتبر نیست.`);
    const label = String(raw.label ?? "").trim();
    if (!label) throw bad(`متن دکمه‌ی شماره ${i + 1} خالی است.`);
    if (label.length > 64) throw bad(`متن دکمه‌ی «${label.slice(0, 20)}…» بیش از ۶۴ کاراکتر است.`);

    const action = String(raw.action ?? "").trim();
    if (!/^[a-z][a-z0-9_]{0,31}$/.test(action))
      throw bad(`اکشن دکمه‌ی «${label}» معتبر نیست.`);

    const rawValue = String(raw.value ?? "");
    if ((action === "url" || action === "mini_app") && rawValue && !/^https:\/\//i.test(rawValue))
      throw bad(`آدرس دکمه‌ی «${label}» باید با https:// شروع شود.`);

    const style = String(raw.style ?? "");
    if (style && !(BUTTON_STYLES as readonly string[]).includes(style))
      throw bad(`استایل دکمه‌ی «${label}» معتبر نیست.`);

    return newButton({
      label,
      action,
      value: rawValue,
      row: Number(raw.row ?? 0),
      col: Number(raw.col ?? 0),
      row_start: raw.row_start === undefined ? undefined : Boolean(raw.row_start),
      style,
      ...(raw.icon_custom_emoji_id ? { icon_custom_emoji_id: String(raw.icon_custom_emoji_id) } : {}),
    });
  });

  const normalized = normalizeButtonLayout(buttons);
  const perRow = new Map<number, number>();
  for (const b of normalized) perRow.set(b.row, (perRow.get(b.row) ?? 0) + 1);
  for (const [row, count] of perRow) {
    if (count > MAX_BUTTONS_PER_ROW)
      throw bad(`ردیف ${row + 1} بیش از ${MAX_BUTTONS_PER_ROW} دکمه دارد؛ تلگرام آن را درست نشان نمی‌دهد.`);
  }
  return normalized;
}

function validateSettings(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw bad("تنظیمات پنل باید یک آبجکت باشد.");
  const s = value as Record<string, unknown>;
  const out: Record<string, unknown> = { ...s };

  if (s.timer_seconds !== undefined && s.timer_seconds !== null && s.timer_seconds !== "") {
    const n = Number(s.timer_seconds);
    if (!Number.isInteger(n) || n < 0 || n > 86_400)
      throw bad("تایمر حذف پیام باید عددی بین ۰ تا ۸۶۴۰۰ ثانیه باشد.");
    out.timer_seconds = n;
  }
  if (s.capacity !== undefined && s.capacity !== null && s.capacity !== "") {
    const n = Number(s.capacity);
    if (!Number.isInteger(n) || n < 0) throw bad("ظرفیت باید عددی بزرگ‌تر یا مساوی صفر باشد.");
    out.capacity = n;
  }
  if (s.forward_groups !== undefined) {
    if (!Array.isArray(s.forward_groups)) throw bad("فهرست گروه‌های فوروارد باید آرایه باشد.");
    out.forward_groups = s.forward_groups.map((g: unknown) => String(g).trim()).filter(Boolean);
  }
  if (s.carousel_ids !== undefined) {
    if (!Array.isArray(s.carousel_ids)) throw bad("فهرست مدیای کاروسل باید آرایه باشد.");
    out.carousel_ids = s.carousel_ids.map((g: unknown) => String(g).trim()).filter(Boolean);
  }
  if (s.password !== undefined && s.password !== null) out.password = String(s.password);
  return out;
}

/** والد: باید موجود باشد، خودش نباشد، و حلقه نسازد. */
function validateParent(panels: Panel[], panelId: string | null, parentId: unknown): string | null {
  if (parentId === null || parentId === undefined || parentId === "") return null;
  const id = String(parentId);
  if (!panels.some((p) => p.id === id)) throw bad("پنل والدی که انتخاب کردید وجود ندارد.", "parent_not_found");
  if (panelId && id === panelId) throw bad("یک پنل نمی‌تواند والد خودش باشد.");
  if (panelId) {
    // انتخاب یکی از نوادگان به‌عنوان والد یعنی حلقه.
    if (collectSubtree(panels, panelId).includes(id))
      throw bad("این پنل زیرمجموعه‌ی همین پنل است؛ انتخابش به‌عنوان والد یک حلقه می‌سازد.", "cycle");
  }
  return id;
}

// ─── لیست و درخت ────────────────────────────────────────────────────────────

router.get("/bots/:botId/panels", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    const panels = await listPanels(spreadsheetId);
    res.json({ panels, tree: buildTree(panels), count: panels.length });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to list panels");
  }
});

/** قبل از `/:panelId` ثبت شده وگرنه «health» به‌عنوان یک panelId خوانده می‌شود. */
router.get("/bots/:botId/panels/health", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    const issues = await panelHealth(spreadsheetId);
    res.json({ issues, healthy: issues.length === 0 });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to check panel health");
  }
});

router.post("/bots/:botId/panels/repair", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await assertSheetsAuthoritative(PANELS_TAB);
    res.json(await repairPanels(spreadsheetId));
  } catch (err) {
    sendBotConfigError(res, err, "Failed to repair panels");
  }
});

router.get("/bots/:botId/panels/:panelId", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    const panel = await getPanel(spreadsheetId, req.params.panelId);
    if (!panel) throw new BotConfigError(404, "این پنل پیدا نشد.", "panel_not_found");
    res.json({ panel });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to read panel");
  }
});

router.get("/bots/:botId/panels/:panelId/references", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    const panels = await listPanels(spreadsheetId);
    if (!panels.some((p) => p.id === req.params.panelId))
      throw new BotConfigError(404, "این پنل پیدا نشد.", "panel_not_found");
    res.json(await findReferences(spreadsheetId, req.params.panelId, panels));
  } catch (err) {
    sendBotConfigError(res, err, "Failed to read panel references");
  }
});

// ─── ساخت ───────────────────────────────────────────────────────────────────

router.post("/bots/:botId/panels", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await assertSheetsAuthoritative(PANELS_TAB);

    const body = req.body ?? {};
    const panels = await listPanels(spreadsheetId);

    const panel = newPanel({
      title: validateTitle(body.title),
      type: validateType(body.type ?? "text"),
      content: validateContent(body.content ?? ""),
      media_file_id: String(body.media_file_id ?? ""),
      buttons: validateButtons(body.buttons ?? []),
      settings: validateSettings(body.settings),
      parent_id: validateParent(panels, null, body.parent_id),
      is_active: body.is_active === undefined ? true : Boolean(body.is_active),
    });

    await savePanel(spreadsheetId, panel);

    // `children` والد باید بلافاصله درست شود، وگرنه تا اولین repair کهنه است.
    const withNew = recomputeChildren([...panels, panel]);
    const parent = withNew.find((p) => p.id === panel.parent_id);
    if (parent) await putEntity(spreadsheetId, PANELS_TAB, parent.id, { ...parent, updated_at: nowIso() });

    res.status(201).json({ panel });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to create panel");
  }
});

// ─── ویرایش ─────────────────────────────────────────────────────────────────

router.patch("/bots/:botId/panels/:panelId", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await assertSheetsAuthoritative(PANELS_TAB);

    const panels = await listPanels(spreadsheetId);
    const current = panels.find((p) => p.id === req.params.panelId);
    if (!current) throw new BotConfigError(404, "این پنل پیدا نشد.", "panel_not_found");

    const body = req.body ?? {};
    // merge روی whitelist: هر فیلدی که در body نیست **دست‌نخورده می‌ماند**،
    // هرگز پاک نمی‌شود.
    const next: Panel = { ...current };
    if ("title" in body) next.title = validateTitle(body.title);
    if ("type" in body) next.type = validateType(body.type);
    if ("content" in body) next.content = validateContent(body.content);
    if ("media_file_id" in body) next.media_file_id = String(body.media_file_id ?? "");
    if ("buttons" in body) next.buttons = validateButtons(body.buttons);
    if ("settings" in body) next.settings = validateSettings(body.settings);
    if ("is_active" in body) next.is_active = Boolean(body.is_active);
    if ("parent_id" in body) next.parent_id = validateParent(panels, current.id, body.parent_id);

    // تغییر نوع (باگ B5 — در بات اصلاً ممکن نیست): وقتی نوع جدید مدیا نمی‌گیرد،
    // مدیای قبلی پاک می‌شود؛ وقتی چندتایی نیست، فقط اولی می‌ماند. هر دو حالت
    // در پاسخ گزارش می‌شوند تا UI بتواند بگوید دقیقاً چه چیزی رفت.
    const dropped: string[] = [];
    if (next.type !== current.type) {
      const carousel = Array.isArray(next.settings.carousel_ids) ? (next.settings.carousel_ids as string[]) : [];
      if (TEXT_ONLY_PANEL_TYPES.includes(next.type)) {
        if (next.media_file_id || carousel.length) dropped.push("media");
        next.media_file_id = "";
        next.settings = { ...next.settings, carousel_ids: [] };
      } else if (!MULTI_MEDIA_PANEL_TYPES.includes(next.type) && carousel.length > 1) {
        dropped.push("carousel");
        next.media_file_id = next.media_file_id || carousel[0];
        next.settings = { ...next.settings, carousel_ids: [] };
      }
    }

    await savePanel(spreadsheetId, next);

    if (next.parent_id !== current.parent_id) {
      const rebuilt = recomputeChildren(panels.map((p) => (p.id === next.id ? next : p)));
      const touched = rebuilt.filter(
        (p) => p.id === current.parent_id || p.id === next.parent_id
      );
      if (touched.length)
        await putEntities(
          spreadsheetId,
          PANELS_TAB,
          touched.map((p) => ({ key: p.id, value: { ...p, updated_at: nowIso() } }))
        );
    }

    res.json({ panel: await getPanel(spreadsheetId, next.id), dropped });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to update panel");
  }
});

// ─── حذف (باگ‌های B6/B7) ────────────────────────────────────────────────────

router.delete("/bots/:botId/panels/:panelId", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await assertSheetsAuthoritative(PANELS_TAB);

    const strategy = String(req.query.strategy ?? "");
    if (!["cascade", "reparent", "orphan"].includes(strategy))
      throw bad(
        "برای حذف باید مشخص کنید با فرزندان چه کنیم: strategy یکی از cascade (حذف کل زیردرخت)، reparent (انتقال به والد بالاتر) یا orphan (بدون والد شدن).",
        "strategy_required"
      );

    const buttonStrategy = String(req.query.buttonStrategy ?? "disable");
    if (!["disable", "remove"].includes(buttonStrategy))
      throw bad("buttonStrategy باید disable یا remove باشد.");

    const report = await deletePanel(
      spreadsheetId,
      req.params.panelId,
      strategy as DeleteStrategy,
      buttonStrategy as ButtonStrategy
    );
    res.json(report);
  } catch (err: any) {
    if (err?.message === "panel_not_found") {
      res.status(404).json({ error: "این پنل پیدا نشد.", code: "panel_not_found" });
      return;
    }
    sendBotConfigError(res, err, "Failed to delete panel");
  }
});

// ─── خانه / فعال‌سازی / والد ────────────────────────────────────────────────

router.post("/bots/:botId/panels/:panelId/home", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await assertSheetsAuthoritative(PANELS_TAB);
    const panels = await setHomePanel(spreadsheetId, req.params.panelId);
    res.json({ panels, homePanelId: req.params.panelId });
  } catch (err: any) {
    if (err?.message === "panel_not_found") {
      res.status(404).json({ error: "این پنل پیدا نشد.", code: "panel_not_found" });
      return;
    }
    sendBotConfigError(res, err, "Failed to set home panel");
  }
});

router.post("/bots/:botId/panels/:panelId/toggle", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await assertSheetsAuthoritative(PANELS_TAB);
    const panel = await getPanel(spreadsheetId, req.params.panelId);
    if (!panel) throw new BotConfigError(404, "این پنل پیدا نشد.", "panel_not_found");
    const next = { ...panel, is_active: !panel.is_active };
    await savePanel(spreadsheetId, next);
    res.json({ panel: next });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to toggle panel");
  }
});

router.post("/bots/:botId/panels/:panelId/link", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await assertSheetsAuthoritative(PANELS_TAB);

    const panels = await listPanels(spreadsheetId);
    const panel = panels.find((p) => p.id === req.params.panelId);
    if (!panel) throw new BotConfigError(404, "این پنل پیدا نشد.", "panel_not_found");

    const parentId = validateParent(panels, panel.id, req.body?.parentId ?? null);
    const next = { ...panel, parent_id: parentId };
    await savePanel(spreadsheetId, next);

    const rebuilt = recomputeChildren(panels.map((p) => (p.id === next.id ? next : p)));
    const touched = rebuilt.filter((p) => p.id === panel.parent_id || p.id === parentId);
    if (touched.length)
      await putEntities(
        spreadsheetId,
        PANELS_TAB,
        touched.map((p) => ({ key: p.id, value: { ...p, updated_at: nowIso() } }))
      );

    res.json({ panel: next });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to link panel");
  }
});

/**
 * انواع پنل و اکشن دکمه که UI باید نشان دهد.
 *
 * `panelTypes`/`buttonActions` دیگر فقط `CORE_PANEL_TYPES`/`CORE_BTN_ACTIONS`
 * نیستند — نوع پنل و اکشن هر پلاگینی که *روی همین بات* فعال است هم اضافه
 * می‌شود (بات خودش این‌ها را در پیکرِ تلگرامی‌اش از قبل نشان می‌داد؛ اینجا
 * همان چیز به سایت هم می‌رسد — `handlers/panel_builder.py::PANEL_TYPES()`ی
 * بات دقیقاً همین merge را با `extension_points.py`ی خودش انجام می‌دهد).
 * `panelTypeLabels` فقط برای انواعِ پلاگینی برگردانده می‌شود؛ انواعِ هسته از
 * قبل کلید locale ثابتِ خودشان را دارند (`labels.ts::panelTypeLabel`) —
 * برچسبِ فارسیِ اینجا باید عیناً همان چیزی بماند که خودِ پلاگین به
 * `register_panel_type(label=...)` داده، دقیقاً مثلِ `buttonFixedValues`
 * پایین‌تر که همان الگو را برای اکشن‌های دکمه دنبال می‌کند. اگر خواندنِ
 * وضعیتِ فعال/غیرفعالِ یک پلاگین شکست بخورد، `isPluginEnabled` هرگز throw
 * نمی‌کند (پیش‌فرضِ امن از کاتالوگِ پلاگین برمی‌گرداند) — پس این مسیر هم
 * خودبه‌خود به همان fallback امن می‌رسد، نه خطا.
 *
 * `buttonActions` فقط برای همین ۸ تا که یک مقصدِ ثابت دارند،
 * `buttonFixedValues` هم برمی‌گردد تا `ButtonBuilder.tsx` بتواند «مقداری
 * لازم نیست» را همان‌طور که برای «درخواست شماره» نشان می‌دهد، نشان دهد و
 * خودش مقدار را پر کند — بدون این نگاشت، فرانت نمی‌دانست هر اکشن پلاگینی
 * دقیقاً چه callback_dataای باید بگیرد.
 */
router.get("/bots/:botId/panel-catalog", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);

    const enabledPanelTypes = (
      await Promise.all(
        PLUGIN_PANEL_TYPES.map(async (p) => ((await isPluginEnabled(spreadsheetId, p.pluginId)) ? p : null)),
      )
    ).filter((p): p is (typeof PLUGIN_PANEL_TYPES)[number] => p !== null);

    const enabledPluginActions = (
      await Promise.all(
        PLUGIN_BUTTON_ACTIONS.map(async (a) => ((await isPluginEnabled(spreadsheetId, a.pluginId)) ? a : null)),
      )
    ).filter((a): a is (typeof PLUGIN_BUTTON_ACTIONS)[number] => a !== null);
    const catalogOrderEnabled = await isPluginEnabled(spreadsheetId, CATALOG_ORDER_ACTION.pluginId);

    res.json({
      panelTypes: [...CORE_PANEL_TYPES, ...enabledPanelTypes.map((p) => p.key)],
      panelTypeLabels: Object.fromEntries(enabledPanelTypes.map((p) => [p.key, p.label])),
      buttonActions: [
        ...CORE_BTN_ACTIONS,
        ...enabledPluginActions.map((a) => a.key),
        ...(catalogOrderEnabled ? [CATALOG_ORDER_ACTION.key] : []),
      ],
      buttonFixedValues: Object.fromEntries(enabledPluginActions.map((a) => [a.key, a.fixedValue])),
      buttonStyles: BUTTON_STYLES,
      multiMediaTypes: MULTI_MEDIA_PANEL_TYPES,
      textOnlyTypes: TEXT_ONLY_PANEL_TYPES,
      maxButtonsPerRow: MAX_BUTTONS_PER_ROW,
    });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to read panel catalog");
  }
});

export default router;
