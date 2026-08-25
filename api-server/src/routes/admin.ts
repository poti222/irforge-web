import { logger } from "../lib/logger";
import { Router } from "express";
import {
  db, usersTable, botsTable, announcementsTable, userPlansTable, plansTable,
  pendingRegistrationsTable,
} from "@workspace/db";
import { eq, and, gte, sql, desc, count, lt, inArray } from "drizzle-orm";
import crypto from "crypto";
import { requireAdmin, requireAuth, requireSuperAdmin } from "./auth";
import { syncUserUpsert, syncUserDelete } from "../lib/sheetsSync";
import { createNotificationsBulk, severityForAnnouncementType } from "../lib/notify";
import { getRevenueEntries, sumRevenue, type RevenueKind } from "../lib/adminRevenue.js";

const router = Router();

// GET /api/announcements — R5b: tenant-facing list so announcements created in
// the admin panel are actually visible on the user dashboard (requireAuth, not
// requireAdmin, since every signed-in user should see platform notices).
router.get("/announcements", requireAuth, async (req: any, res) => {
  try {
    const items = await db
      .select()
      .from(announcementsTable)
      .orderBy(desc(announcementsTable.createdAt));
    res.json(items.map(a => ({
      id: a.id,
      title: a.title,
      message: a.message,
      type: a.type,
      createdAt: a.createdAt.toISOString(),
    })));
  } catch (err) {
    logger.error({ err }, "List public announcements error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/admin/users
router.get("/admin/users", requireAdmin, async (req: any, res) => {
  try {
    const users = await db.select().from(usersTable);
    const usersWithBotCount = await Promise.all(users.map(async (u) => {
      const bots = await db.select().from(botsTable).where(eq(botsTable.userId, u.id));
      return {
        id: u.id,
        name: u.name,
        email: u.email,
        avatar: u.avatar,
        role: u.role,
        plan: u.plan,
        status: u.status,
        botCount: bots.length,
        lastLogin: u.lastLogin?.toISOString() ?? null,
        createdAt: u.createdAt.toISOString(),
      };
    }));
    res.json(usersWithBotCount);
  } catch (err) {
    logger.error({ err }, "Admin list users error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/admin/users/:userId
router.patch("/admin/users/:userId", requireAdmin, async (req: any, res) => {
  try {
    // FIX [Critical]: prevent admin from modifying their own account
    if (req.params.userId === req.userId) {
      res.status(400).json({ error: "Admin cannot modify their own account" });
      return;
    }
    const { role, status, plan } = req.body;

    const [requester, target] = await Promise.all([
      db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, req.userId)).limit(1),
      db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, req.params.userId)).limit(1),
    ]);
    const requesterIsSuper = requester[0]?.role === "super_admin";

    // FIX [X3]: requireAdmin lets both `admin` and `super_admin` through, but
    // granting the `super_admin` role must be reserved for existing super_admins.
    // Otherwise a plain admin could self-escalate the platform via any account,
    // bypassing the env-secret-gated /auth/super-admin-code flow.
    if (role === "super_admin" && !requesterIsSuper) {
      res.status(403).json({ error: "Only a super admin can grant the super_admin role" });
      return;
    }

    /**
     * و نیمه‌ی دوم که جا افتاده بود: **هدف** هم مهم است، نه فقط نقش تازه.
     *
     * گارد بالا فقط جلوی «ارتقا به سوپرادمین» را می‌گرفت. ولی یک ادمین عادی
     * می‌توانست حساب یک سوپرادمین را بردارد و نقشش را `user` کند یا
     * وضعیتش را `banned` — یعنی بدون اینکه خودش ارتقا بگیرد، همه‌ی
     * سوپرادمین‌ها را خنثی کند و عملاً کنترل پلتفرم را بگیرد.
     */
    if (target[0]?.role === "super_admin" && !requesterIsSuper) {
      res.status(403).json({ error: "Only a super admin can modify a super admin account" });
      return;
    }
    const update: Record<string, any> = {};
    if (role !== undefined) update.role = role;
    if (status !== undefined) update.status = status;
    if (plan !== undefined) update.plan = plan;
    const [user] = await db.update(usersTable).set(update)
      .where(eq(usersTable.id, req.params.userId))
      .returning();
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const bots = await db.select().from(botsTable).where(eq(botsTable.userId, user.id));
    syncUserUpsert({ id: user.id, name: user.name, email: user.email, role: user.role, plan: user.plan, status: user.status, bio: user.bio, telegramUsername: user.telegramUsername, createdAt: user.createdAt, updatedAt: user.updatedAt });
    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      avatar: user.avatar,
      role: user.role,
      plan: user.plan,
      status: user.status,
      botCount: bots.length,
      lastLogin: user.lastLogin?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "Admin update user error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/admin/users/:userId
router.delete("/admin/users/:userId", requireAdmin, async (req: any, res) => {
  try {
    // FIX [Critical]: prevent admin from deleting their own account
    if (req.params.userId === req.userId) {
      res.status(400).json({ error: "Admin cannot delete their own account" });
      return;
    }

    const [requester, target] = await Promise.all([
      db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, req.userId)).limit(1),
      db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, req.params.userId)).limit(1),
    ]);

    // بدون این، حذف یک شناسه‌ی ناموجود هم ۲۰۴ می‌داد و موفق به‌نظر می‌رسید.
    if (!target[0]) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // همان شکافِ PATCH، اینجا شدیدتر: یک ادمین عادی می‌توانست حساب سوپرادمین
    // را کاملاً **حذف** کند.
    if (target[0].role === "super_admin" && requester[0]?.role !== "super_admin") {
      res.status(403).json({ error: "Only a super admin can delete a super admin account" });
      return;
    }

    await db.delete(usersTable).where(eq(usersTable.id, req.params.userId));
    syncUserDelete(req.params.userId);
    res.status(204).end();
  } catch (err) {
    logger.error({ err }, "Admin delete user error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/admin/stats
router.get("/admin/stats", requireAdmin, async (req: any, res) => {
  try {
    const users = await db.select().from(usersTable);
    const bots = await db.select().from(botsTable);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const newUsersToday = users.filter(u => u.createdAt >= today).length;

    /**
     * درآمد — از **حرکت واقعی پول**، نه از اشتراک‌های ثبت‌شده.
     *
     * قبلاً `totalRevenue` جمعِ `userPlans × plans.price` بود. دو ایراد داشت،
     * و هر دو باعث می‌شدند فروش بات اصلاً دیده نشود:
     *
     *   ۱. **فروش بات را نمی‌شمرد.** بات یا با فیش کارت‌به‌کارت خریده می‌شود
     *      (ردیف `payments`) یا از موجودی کیف پول (`wallet_transactions` با
     *      `type='spend'`). هیچ‌کدام به `user_plans` ربطی ندارند.
     *   ۲. **پولی را می‌شمرد که هرگز گرفته نشده.** `POST /plans/subscribe`
     *      هیچ کسری از کیف پول انجام نمی‌دهد و هیچ رکورد پرداختی نمی‌سازد —
     *      فقط پلن کاربر را ست می‌کند. پس قیمتِ پلن یک عدد اسمی بود، نه
     *      درآمد.
     *
     * حالا فقط دو منبعی شمرده می‌شوند که واقعاً پول جابه‌جا کرده‌اند، و با هم
     * دوباره‌شماری ندارند: فیش تأییدشده، و خرجِ تأییدشده از کیف پول.
     * (شارژ کیف پول عمداً شمرده نمی‌شود — پولی که هنوز خرج نشده فروش نیست، و
     * با خرجش دوباره شمرده می‌شد.)
     */
    const earnings = await getRevenueEntries();

    const totalRevenue = sumRevenue(earnings);
    const revenueBreakdown = {
      bots: sumRevenue(earnings.filter(e => e.kind === "bot")),
      plugins: sumRevenue(earnings.filter(e => e.kind === "plugin")),
      other: sumRevenue(earnings.filter(e => e.kind === "other")),
    };

    const now = new Date();
    // Phase 35: هر ماه یک `key` (`YYYY-MM`) هم می‌گیرد — برچسبِ نمایشی («Jan»)
    // برای دوازده ماهِ متفاوت یکتا نیست، پس کلیک روی یک ستون نمی‌تواند فقط از
    // روی برچسب بفهمد کدام ماه را از سرور بخواهد.
    const revenueByMonth = Array.from({ length: 6 }, (_, i) => {
      const from = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      const to = new Date(now.getFullYear(), now.getMonth() - (5 - i) + 1, 1);
      return {
        month: from.toLocaleString("default", { month: "short" }),
        key: `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, "0")}`,
        revenue: sumRevenue(earnings.filter(e => e.at >= from && e.at < to)),
      };
    });

    /**
     * توزیع پلن‌ها — از جدول `plans`، نه از یک فهرست ثابت.
     *
     * قبلاً روی `["free","starter","pro","enterprise"]` حلقه می‌زد و با
     * `users.plan` مقایسه می‌کرد. دو ایراد: پلنی که سوپرادمین تازه می‌سازد
     * هیچ‌وقت ظاهر نمی‌شد، و `users.plan` **شناسه‌ی** پلن را نگه می‌دارد
     * (`routes/plans.ts` آن را `planId` ست می‌کند) نه نامش — پس آن چهار
     * اسم تقریباً همیشه صفر بودند.
     *
     * شمارش از `user_plans` می‌آید که رکورد واقعی اشتراک است، و نام از خودِ
     * `plans` — پس هر پلن تازه‌ای خودبه‌خود اینجا می‌آید.
     */
    const [allPlans, activeUserPlans] = await Promise.all([
      db.select({ id: plansTable.id, name: plansTable.name, price: plansTable.price }).from(plansTable),
      db.select({ planId: userPlansTable.planId }).from(userPlansTable).where(eq(userPlansTable.status, "active")),
    ]);

    const perPlan = new Map<string, number>();
    for (const up of activeUserPlans) {
      if (up.planId) perPlan.set(up.planId, (perPlan.get(up.planId) ?? 0) + 1);
    }

    const planBreakdown = allPlans
      .map(p => ({ planId: p.id, plan: p.name, price: p.price ?? 0, count: perPlan.get(p.id) ?? 0 }))
      .sort((a, b) => b.count - a.count || a.plan.localeCompare(b.plan));

    res.json({
      totalUsers: users.length,
      totalBots: bots.length,
      totalRevenue,
      revenueBreakdown,
      activeUsers: users.filter(u => u.status === "active").length,
      newUsersToday,
      revenueByMonth,
      planBreakdown,
    });
  } catch (err) {
    logger.error({ err }, "Admin stats error");
    res.status(500).json({ error: "Internal server error" });
  }
});

const REVENUE_KINDS: RevenueKind[] = ["bot", "plugin", "other"];

/**
 * GET /api/admin/revenue-details — Phase 35: the number on a revenue card
 * ("Bot sales: 4,200,000 Toman") used to be a dead end — an admin who wanted
 * to know *which* sales made up that figure had no way to find out short of
 * a database query. This is the itemized list behind any of the aggregate
 * numbers in `GET /admin/stats`: the whole thing (`kind` and `month` both
 * omitted), one category (`?kind=bot|plugin|other`), one month
 * (`?month=YYYY-MM`, matching the `key` field `revenueByMonth` now carries),
 * or both together.
 *
 * `requireSuperAdmin`, not `requireAdmin`: the aggregate cards are already
 * withheld from plain admins on the frontend (`AdminOverview`'s
 * `showRevenue`) because revenue is super-admin information — an itemized
 * list naming which user paid how much is strictly more sensitive than the
 * sum, so it gets at least the same gate.
 */
router.get("/admin/revenue-details", requireSuperAdmin, async (req: any, res) => {
  try {
    const kindParam = typeof req.query.kind === "string" ? req.query.kind : undefined;
    const kind = REVENUE_KINDS.includes(kindParam as RevenueKind) ? (kindParam as RevenueKind) : undefined;
    const monthParam = typeof req.query.month === "string" ? req.query.month : undefined;
    const monthMatch = monthParam && /^(\d{4})-(\d{2})$/.exec(monthParam);

    let entries = await getRevenueEntries();
    if (kind) entries = entries.filter((e) => e.kind === kind);
    if (monthMatch) {
      const year = Number(monthMatch[1]);
      const monthIndex = Number(monthMatch[2]) - 1;
      const from = new Date(year, monthIndex, 1);
      const to = new Date(year, monthIndex + 1, 1);
      entries = entries.filter((e) => e.at >= from && e.at < to);
    }
    entries.sort((a, b) => b.at.getTime() - a.at.getTime());

    const total = sumRevenue(entries);
    // یک صفحه‌ی ثابت کافی است — این یک دیالوگِ توضیحی است، نه یک صفحه‌ی
    // حسابداری با صفحه‌بندی؛ لیست‌های بزرگ‌تر همچنان در جمعِ کارت درست‌اند.
    const page = entries.slice(0, 200);

    const userIds = [...new Set(page.map((e) => e.userId))];
    const botIds = [...new Set(page.map((e) => e.botId).filter((id): id is string => !!id))];
    const [users, bots] = await Promise.all([
      userIds.length
        ? db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email }).from(usersTable).where(inArray(usersTable.id, userIds))
        : Promise.resolve([]),
      botIds.length
        ? db.select({ id: botsTable.id, name: botsTable.name }).from(botsTable).where(inArray(botsTable.id, botIds))
        : Promise.resolve([]),
    ]);
    const userMap = new Map(users.map((u) => [u.id, u]));
    const botMap = new Map(bots.map((b) => [b.id, b]));

    res.json({
      total,
      count: entries.length,
      truncated: entries.length > page.length,
      entries: page.map((e) => ({
        id: e.id,
        amount: e.amount,
        at: e.at.toISOString(),
        kind: e.kind,
        source: e.source,
        userName: userMap.get(e.userId)?.name ?? null,
        userEmail: userMap.get(e.userId)?.email ?? null,
        botName: e.botId ? (botMap.get(e.botId)?.name ?? null) : null,
        note: e.note,
      })),
    });
  } catch (err) {
    logger.error({ err }, "Admin revenue details error");
    res.status(500).json({ error: "Internal server error" });
  }
});

/** Allowed values of `announcements.type` — mirrors AnnouncementInputType in the OpenAPI spec. */
const ANNOUNCEMENT_TYPES = ["info", "warning", "success", "error"] as const;
const ANNOUNCEMENT_TITLE_MAX = 200;
const ANNOUNCEMENT_MESSAGE_MAX = 4000;

// GET /api/admin/announcements
// FIX: this listing had no ORDER BY, so Postgres returned rows in whatever
// order it pleased — a freshly published announcement could land anywhere in
// the list, which reads as "publishing did nothing". Ordered newest-first, to
// match the tenant-facing GET /api/announcements above.
router.get("/admin/announcements", requireAdmin, async (req: any, res) => {
  try {
    const items = await db
      .select()
      .from(announcementsTable)
      .orderBy(desc(announcementsTable.createdAt));
    res.json(items.map(a => ({
      id: a.id,
      title: a.title,
      message: a.message,
      type: a.type,
      createdAt: a.createdAt.toISOString(),
    })));
  } catch (err) {
    logger.error({ err }, "List announcements error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/admin/announcements
router.post("/admin/announcements", requireAdmin, async (req: any, res) => {
  try {
    // FIX: title/message/type went into the insert straight from req.body with
    // no validation. A missing `message` hit the NOT NULL constraint and came
    // back as an opaque 500; a whitespace-only title, a 5000-character title, a
    // numeric title and a `type` outside the allowed set were all accepted and
    // persisted. Validate up front and answer 400 with a message the admin
    // panel can show.
    const { title, message, type } = req.body ?? {};

    if (typeof title !== "string" || title.trim() === "") {
      res.status(400).json({ error: "Title is required" });
      return;
    }
    if (typeof message !== "string" || message.trim() === "") {
      res.status(400).json({ error: "Message is required" });
      return;
    }
    const trimmedTitle = title.trim();
    const trimmedMessage = message.trim();
    if (trimmedTitle.length > ANNOUNCEMENT_TITLE_MAX) {
      res.status(400).json({ error: `Title must be at most ${ANNOUNCEMENT_TITLE_MAX} characters` });
      return;
    }
    if (trimmedMessage.length > ANNOUNCEMENT_MESSAGE_MAX) {
      res.status(400).json({ error: `Message must be at most ${ANNOUNCEMENT_MESSAGE_MAX} characters` });
      return;
    }
    if (type != null && !ANNOUNCEMENT_TYPES.includes(type)) {
      res.status(400).json({ error: `Type must be one of: ${ANNOUNCEMENT_TYPES.join(", ")}` });
      return;
    }

    const [announcement] = await db.insert(announcementsTable).values({
      id: crypto.randomUUID(),
      title: trimmedTitle,
      message: trimmedMessage,
      type: type ?? "info",
    }).returning();

    // fan-out: هر اعلان سراسری برای همه‌ی کاربران یک ردیف notification می‌سازد،
    // در یک insert دسته‌ای (نه یک رفت‌وبرگشت به‌ازای هر کاربر). dedupeKey مشترک
    // است تا retry نتواند دوباره پست کند.
    const recipients = await db.select({ id: usersTable.id }).from(usersTable);
    await createNotificationsBulk(recipients.map((u) => u.id), {
      type: "announcement",
      severity: severityForAnnouncementType(announcement.type),
      title: announcement.title,
      message: announcement.message,
      dedupeKey: "announcement:" + announcement.id,
    });

    res.status(201).json({
      id: announcement.id,
      title: announcement.title,
      message: announcement.message,
      type: announcement.type,
      createdAt: announcement.createdAt.toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "Create announcement error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/admin/announcements/:announcementId
router.delete("/admin/announcements/:announcementId", requireAdmin, async (req: any, res) => {
  try {
    await db.delete(announcementsTable).where(eq(announcementsTable.id, req.params.announcementId));
    res.status(204).end();
  } catch (err) {
    logger.error({ err }, "Delete announcement error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

// ─── GET /api/admin/pending-registrations ────────────────────────────────────
// ثبت‌نام‌های نیمه‌کاره، برای دیدن اینکه مردم کجا رها می‌کنند.
//
// ⚠️ این داده‌ی شخصی است: نام، شماره و ایمیل واقعیِ کسانی که ثبت‌نامشان را
// **تمام نکرده‌اند** و با هیچ چیزی موافقت نکرده‌اند. این یک نمای گزارشیِ
// فقط-خواندنی است: نه دکمه‌ی خروجی، نه ایمیل گروهی، نه پیام گروهی تلگرام، نه
// استفاده‌ی بازاریابی. پیام‌دادن به کسی که فرم ثبت‌نام را رها کرده تماسِ
// ناخواسته است، و انجامش با شماره‌ای که هرگز تأیید نکرده می‌شود از آن بدتر.
// اگر روزی چنین چیزی لازم شد، به یک چک‌باکس رضایت در گام ۲ نیاز دارد.
//
// `codeHash` یک اعتبارنامه است و `sourceIp`/`userAgent` کاربرد تجاری ندارند —
// هیچ‌کدام از سرور بیرون نمی‌روند.
router.get("/admin/pending-registrations", requireAdmin, async (req: any, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const perPage = Math.min(100, Math.max(1, Number(req.query.perPage) || 25));
    const stepFilter = typeof req.query.step === "string" ? req.query.step : "";

    const where = stepFilter ? eq(pendingRegistrationsTable.step, stepFilter) : undefined;

    const rows = await db
      .select()
      .from(pendingRegistrationsTable)
      .where(where)
      .orderBy(desc(pendingRegistrationsTable.createdAt))
      .limit(perPage)
      .offset((page - 1) * perPage);

    const [{ value: total }] = await db
      .select({ value: count() })
      .from(pendingRegistrationsTable)
      .where(where);

    res.json({
      items: rows.map((r) => ({
        id: r.id,
        firstName: r.firstName,
        lastName: r.lastName,
        email: r.email,
        phone: r.phone,
        telegramUsername: r.telegramUsername,
        step: r.step,
        createdAt: r.createdAt.toISOString(),
        lastActivityAt: r.lastActivityAt.toISOString(),
      })),
      page,
      perPage,
      total,
    });
  } catch (err) {
    logger.error({ err }, "List pending registrations error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/admin/pending-registrations/:id
router.delete("/admin/pending-registrations/:id", requireAdmin, async (req: any, res) => {
  try {
    const deleted = await db
      .delete(pendingRegistrationsTable)
      .where(eq(pendingRegistrationsTable.id, req.params.id))
      .returning({ id: pendingRegistrationsTable.id });
    if (deleted.length === 0) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "Delete pending registration error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/admin/pending-registrations/purge — حذف گروهی قدیمی‌تر از N روز
router.post("/admin/pending-registrations/purge", requireAdmin, async (req: any, res) => {
  try {
    const days = Math.min(365, Math.max(1, Number(req.body?.olderThanDays) || 30));
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const deleted = await db
      .delete(pendingRegistrationsTable)
      .where(lt(pendingRegistrationsTable.createdAt, cutoff))
      .returning({ id: pendingRegistrationsTable.id });
    logger.info({ actor: req.userId, count: deleted.length, days }, "Purged pending registrations");
    res.json({ success: true, deleted: deleted.length });
  } catch (err) {
    logger.error({ err }, "Purge pending registrations error");
    res.status(500).json({ error: "Internal server error" });
  }
});
