/**
 * routes/botAdmins.ts — ادمین‌های بات و نقش‌ها.
 * ─────────────────────────────────────────────────────────────────────────────
 * دو واقعیتِ کد بات که با متن پرامپت فرق دارند و اینجا رعایت شده‌اند:
 *
 *  1. **نقش‌ها در تب `roles` نیستند.** `utils/permissions.py:203` آن‌ها را در
 *     کلید `__roles__` داخل تب `bot_settings` نگه می‌دارد
 *     (`settings_db.get("__roles__")`). تب `roles` در `_SHEET_NAMES` هست ولی
 *     موتور مجوزها اصلاً نمی‌خواندش. نوشتن روی تب `roles` یعنی نقشی بسازیم که
 *     بات هرگز نمی‌بیند — دقیقاً همان اشتباهی که B13/B14 هستند.
 *
 *  2. **رکورد ادمین دو فرمت دارد.** فرمت قدیمی `{permissions: [...]}` است
 *     (همان `models.Admin`) و فرمت جدید
 *     `{role_id, extra_permissions, denied_permissions, is_super_admin}`.
 *     بات موقع خواندن، قدیمی را به جدید مهاجرت می‌دهد (`_migrate` خط ۱۵۰).
 *     سایت **فرمت جدید** می‌نویسد — چیزی که موتور واقعاً استفاده می‌کند — و
 *     فرمت قدیمی را موقع خواندن می‌فهمد.
 */
import { Router } from "express";
import { requireAuth } from "./auth.js";
import { resolveTelegramUser } from "../lib/telegramResolve.js";
import {
  resolveBotSheet,
  listEntity,
  getEntity,
  putEntity,
  removeEntity,
  readSettings,
  patchSettings,
  assertSheetsAuthoritative,
  sendBotConfigError,
  BotConfigError,
} from "../lib/botConfig.js";
import { nowIso } from "../lib/botTypes.js";

const router = Router();

const ADMINS_TAB = "admins";
const ROLES_KEY = "__roles__";

function bad(message: string, code?: string): BotConfigError {
  return new BotConfigError(400, message, code);
}

/**
 * گروه‌های دسترسی هسته — آینه‌ی `_CORE_MIGRATION_MAP` در
 * `utils/permissions.py:18`. گروه‌های پلاگین‌ها دینامیک‌اند و سایت لیستشان را
 * قطعی نمی‌داند، پس اینجا hardcode نمی‌شوند؛ هر گروهی که روی نقش‌های موجود
 * دیده شود به خروجی اضافه می‌گردد.
 */
const CORE_PERMISSION_GROUPS: Record<string, string[]> = {
  all: ["*"],
  panels: ["panels.view", "panels.create", "panels.edit", "panels.delete"],
  users: ["users.view", "users.ban"],
  forms: ["forms.view", "forms.create"],
  settings: ["settings.view", "settings.edit"],
  broadcast: ["users.broadcast"],
  stats: ["analytics.view"],
};

type StoredAdmin = {
  user_id: string;
  username: string;
  role_id?: string | null;
  extra_permissions?: string[];
  denied_permissions?: string[];
  is_super_admin?: boolean;
  /** فرمت قدیمی — فقط خوانده می‌شود، نوشته نمی‌شود. */
  permissions?: string[];
  added_at: string;
  added_by: string;
};

type BotRole = { id: string; name: string; permissions: string[]; created_at: string };

/** رکورد ادمین را به شکل واحدِ فرمت جدید می‌آورد (مثل `_migrate` بات). */
function normalizeAdmin(userId: string, raw: StoredAdmin): Required<Omit<StoredAdmin, "permissions">> {
  const legacy = Array.isArray(raw.permissions) && raw.extra_permissions === undefined;
  let extra = raw.extra_permissions ?? [];
  let isSuper = Boolean(raw.is_super_admin);

  if (legacy) {
    const expanded: string[] = [];
    for (const p of raw.permissions ?? []) {
      const key = String(p).toLowerCase();
      if (key === "all" || key === "*") {
        isSuper = true;
        expanded.push("*");
      } else {
        expanded.push(...(CORE_PERMISSION_GROUPS[key] ?? [key]));
      }
    }
    extra = [...new Set(expanded)];
  }

  return {
    user_id: String(raw.user_id ?? userId),
    username: raw.username ?? "",
    role_id: raw.role_id ?? null,
    extra_permissions: extra,
    denied_permissions: raw.denied_permissions ?? [],
    is_super_admin: isSuper,
    added_at: raw.added_at ?? nowIso(),
    added_by: raw.added_by ?? "",
  };
}

async function readAdmins(spreadsheetId: string) {
  const rows = await listEntity<StoredAdmin>(spreadsheetId, ADMINS_TAB);
  return rows
    .filter((r) => r.value && typeof r.value === "object")
    .map((r) => normalizeAdmin(r.key, r.value as StoredAdmin));
}

async function readRoles(spreadsheetId: string): Promise<Record<string, BotRole>> {
  // مستقیم از تب می‌خوانیم چون `readSettings` فقط کلیدهای شناخته‌شده‌ی
  // `BotSettings` را برمی‌گرداند و `__roles__` جزوشان نیست.
  const raw = await getEntity<Record<string, BotRole>>(spreadsheetId, "bot_settings", ROLES_KEY);
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
}

async function writeRoles(spreadsheetId: string, roles: Record<string, BotRole>): Promise<void> {
  // کلیدبه‌کلید، مثل هر نوشتن دیگری روی این تب (باگ B11).
  await patchSettings(spreadsheetId, { [ROLES_KEY]: roles } as any);
}

/** آیا این ادمین دسترسی کامل دارد؟ (`is_super_admin` یا `*` یا نقشِ دارای `*`) */
function hasFullAccess(admin: ReturnType<typeof normalizeAdmin>, roles: Record<string, BotRole>): boolean {
  if (admin.is_super_admin) return true;
  if (admin.extra_permissions.includes("*")) return true;
  const role = admin.role_id ? roles[admin.role_id] : undefined;
  return Boolean(role?.permissions.includes("*"));
}

/**
 * آی‌دی عددی تلگرام یک یوزرنیم — یا خطای روشن (باگ B10).
 *
 * منطقش به `lib/telegramResolve.ts` منتقل شد تا کانال‌های عضویت اجباری هم
 * دقیقاً همین رفتار را داشته باشند؛ این فقط یک نام محلی است.
 */
const resolveTelegramId = resolveTelegramUser;

// ─── گروه‌های دسترسی ────────────────────────────────────────────────────────

router.get("/bots/:botId/permission-groups", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    const roles = await readRoles(spreadsheetId);

    // گروه‌های پلاگینی: سایت manifest پلاگین‌ها را نمی‌خواند، ولی هر گروهی که
    // روی نقش‌های موجود استفاده شده واقعی است و باید در UI دیده شود.
    const known = new Set(Object.keys(CORE_PERMISSION_GROUPS));
    const extra = new Set<string>();
    for (const role of Object.values(roles)) {
      for (const p of role.permissions ?? []) {
        const group = String(p).split(".")[0];
        if (group && group !== "*" && !known.has(group)) extra.add(group);
      }
    }

    res.json({
      core: CORE_PERMISSION_GROUPS,
      discovered: [...extra],
    });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to read permission groups");
  }
});

// ─── ادمین‌ها ───────────────────────────────────────────────────────────────

router.get("/bots/:botId/bot-admins", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    const [admins, roles] = await Promise.all([readAdmins(spreadsheetId), readRoles(spreadsheetId)]);
    res.json({
      admins: admins.map((a) => ({ ...a, fullAccess: hasFullAccess(a, roles) })),
      count: admins.length,
    });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to list bot admins");
  }
});

router.post("/bots/:botId/bot-admins", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await assertSheetsAuthoritative(ADMINS_TAB);

    const identifier = String(req.body?.identifier ?? "").trim();
    if (!identifier) throw bad("یوزرنیم یا آی‌دی عددی کاربر را وارد کنید.");

    const { userId, username } = await resolveTelegramId(req.params.botId, identifier);
    if (await getEntity(spreadsheetId, ADMINS_TAB, userId))
      throw new BotConfigError(409, "این کاربر از قبل ادمین است.", "already_admin");

    const roles = await readRoles(spreadsheetId);
    const roleId = req.body?.role_id ? String(req.body.role_id) : null;
    if (roleId && !roles[roleId]) throw bad("نقشی که انتخاب کردید وجود ندارد.", "role_not_found");

    const admin = {
      user_id: userId,
      username: String(req.body?.username ?? username ?? ""),
      role_id: roleId,
      extra_permissions: Array.isArray(req.body?.extra_permissions)
        ? req.body.extra_permissions.map((p: unknown) => String(p).toLowerCase())
        : [],
      denied_permissions: [],
      is_super_admin: Boolean(req.body?.is_super_admin),
      added_at: nowIso(),
      added_by: String(req.userId),
    };

    await putEntity(spreadsheetId, ADMINS_TAB, userId, admin);
    res.status(201).json({ admin });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to add bot admin");
  }
});

router.patch("/bots/:botId/bot-admins/:userId/permissions", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await assertSheetsAuthoritative(ADMINS_TAB);

    const current = await getEntity<StoredAdmin>(spreadsheetId, ADMINS_TAB, req.params.userId);
    if (!current) throw new BotConfigError(404, "این ادمین پیدا نشد.", "admin_not_found");

    const admins = await readAdmins(spreadsheetId);
    const roles = await readRoles(spreadsheetId);
    const next = normalizeAdmin(req.params.userId, current);

    const body = req.body ?? {};
    if ("role_id" in body) {
      const roleId = body.role_id ? String(body.role_id) : null;
      if (roleId && !roles[roleId]) throw bad("نقشی که انتخاب کردید وجود ندارد.", "role_not_found");
      next.role_id = roleId;
    }
    if ("extra_permissions" in body) {
      if (!Array.isArray(body.extra_permissions)) throw bad("فهرست دسترسی‌ها باید آرایه باشد.");
      next.extra_permissions = body.extra_permissions.map((p: unknown) => String(p).toLowerCase());
    }
    if ("denied_permissions" in body) {
      if (!Array.isArray(body.denied_permissions)) throw bad("فهرست دسترسی‌های سلب‌شده باید آرایه باشد.");
      next.denied_permissions = body.denied_permissions.map((p: unknown) => String(p).toLowerCase());
    }
    if ("is_super_admin" in body) next.is_super_admin = Boolean(body.is_super_admin);

    // محافظت: نباید آخرین ادمینِ دارای دسترسی کامل، دسترسی‌اش را از دست بدهد —
    // وگرنه پنل ادمین بات برای همیشه قفل می‌شود.
    const others = admins.filter((a) => a.user_id !== next.user_id);
    if (!hasFullAccess(next, roles) && !others.some((a) => hasFullAccess(a, roles)))
      throw new BotConfigError(
        409,
        "این تنها ادمینِ دارای دسترسی کامل است؛ با سلب دسترسی‌اش، پنل ادمین بات برای همه قفل می‌شود.",
        "last_super_admin"
      );

    await putEntity(spreadsheetId, ADMINS_TAB, next.user_id, next);
    res.json({ admin: next });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to update admin permissions");
  }
});

router.delete("/bots/:botId/bot-admins/:userId", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await assertSheetsAuthoritative(ADMINS_TAB);

    const [admins, roles] = await Promise.all([readAdmins(spreadsheetId), readRoles(spreadsheetId)]);
    const target = admins.find((a) => a.user_id === req.params.userId);
    if (!target) throw new BotConfigError(404, "این ادمین پیدا نشد.", "admin_not_found");

    const others = admins.filter((a) => a.user_id !== target.user_id);
    if (hasFullAccess(target, roles) && !others.some((a) => hasFullAccess(a, roles)))
      throw new BotConfigError(
        409,
        "این تنها ادمینِ دارای دسترسی کامل است و حذفش پنل ادمین بات را برای همه قفل می‌کند. اول یک ادمین کامل دیگر اضافه کنید.",
        "last_super_admin"
      );

    await removeEntity(spreadsheetId, ADMINS_TAB, target.user_id);
    res.json({ deleted: target.user_id });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to remove bot admin");
  }
});

// ─── نقش‌ها ─────────────────────────────────────────────────────────────────

router.get("/bots/:botId/roles", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    const [roles, admins] = await Promise.all([readRoles(spreadsheetId), readAdmins(spreadsheetId)]);
    const usage: Record<string, number> = {};
    for (const admin of admins) {
      if (admin.role_id) usage[admin.role_id] = (usage[admin.role_id] ?? 0) + 1;
    }
    res.json({
      roles: Object.values(roles).map((r) => ({ ...r, assignedCount: usage[r.id] ?? 0 })),
    });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to list roles");
  }
});

function validatePermissions(value: unknown): string[] {
  if (!Array.isArray(value)) throw bad("فهرست دسترسی‌ها باید آرایه باشد.");
  const perms = value.map((p) => String(p).trim().toLowerCase()).filter(Boolean);
  for (const p of perms) {
    if (p !== "*" && !/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_*]*)?$/.test(p))
      throw bad(`دسترسی «${p}» شکل معتبری ندارد.`);
  }
  return [...new Set(perms)];
}

router.post("/bots/:botId/roles", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await assertSheetsAuthoritative("bot_settings");

    const name = String(req.body?.name ?? "").trim();
    if (!name) throw bad("نقش باید نام داشته باشد.");
    if (name.length > 60) throw bad("نام نقش نباید بیشتر از ۶۰ کاراکتر باشد.");

    const roles = await readRoles(spreadsheetId);
    // شناسه دقیقاً مثل بات ساخته می‌شود: `role_` + هشت کاراکتر اول یک uuid4.
    const roleId = `role_${crypto.randomUUID().slice(0, 8)}`;
    const role: BotRole = {
      id: roleId,
      name,
      permissions: validatePermissions(req.body?.permissions ?? []),
      created_at: nowIso(),
    };

    await writeRoles(spreadsheetId, { ...roles, [roleId]: role });
    res.status(201).json({ role });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to create role");
  }
});

router.patch("/bots/:botId/roles/:roleId", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await assertSheetsAuthoritative("bot_settings");

    const roles = await readRoles(spreadsheetId);
    const current = roles[req.params.roleId];
    if (!current) throw new BotConfigError(404, "این نقش پیدا نشد.", "role_not_found");

    const next: BotRole = { ...current };
    if ("name" in (req.body ?? {})) {
      const name = String(req.body.name ?? "").trim();
      if (!name) throw bad("نقش باید نام داشته باشد.");
      next.name = name;
    }
    if ("permissions" in (req.body ?? {})) next.permissions = validatePermissions(req.body.permissions);

    await writeRoles(spreadsheetId, { ...roles, [next.id]: next });
    res.json({ role: next });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to update role");
  }
});

router.delete("/bots/:botId/roles/:roleId", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    await assertSheetsAuthoritative("bot_settings");

    const [roles, admins] = await Promise.all([readRoles(spreadsheetId), readAdmins(spreadsheetId)]);
    const role = roles[req.params.roleId];
    if (!role) throw new BotConfigError(404, "این نقش پیدا نشد.", "role_not_found");

    const assigned = admins.filter((a) => a.role_id === role.id);
    // نقشی که به کسی اختصاص دارد بدون تکلیف روشن حذف نمی‌شود: یا کاربر نقش
    // جایگزین می‌دهد، یا صریح می‌گوید ادمین‌ها بی‌نقش شوند.
    const reassignTo = req.body?.reassignTo === undefined ? undefined : req.body.reassignTo;
    if (assigned.length > 0 && reassignTo === undefined)
      throw new BotConfigError(
        409,
        `این نقش به ${assigned.length} ادمین اختصاص داده شده است. اول تعیین کنید آن‌ها چه نقشی بگیرند.`,
        "role_in_use"
      );

    const target = reassignTo ? String(reassignTo) : null;
    if (target && !roles[target]) throw bad("نقش جایگزین وجود ندارد.", "role_not_found");

    for (const admin of assigned) {
      await putEntity(spreadsheetId, ADMINS_TAB, admin.user_id, { ...admin, role_id: target });
    }

    const nextRoles = { ...roles };
    delete nextRoles[role.id];
    await writeRoles(spreadsheetId, nextRoles);

    res.json({ deleted: role.id, reassigned: assigned.length, reassignedTo: target });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to delete role");
  }
});

export default router;
