/**
 * routes/superDashboard.ts — بخش "/super": APIِ مدیریتِ سراسریِ سوپرادمین.
 * ─────────────────────────────────────────────────────────────────────────────
 * بیشترِ تب‌هایِ `/super` کامپوننت‌هایِ موجود (`AllBotsTable`، `ProductsManager`، پرداخت‌ها، پلن‌ها، …) را با همان
 * APIهایِ خودشان دوباره استفاده می‌کنند. این فایل فقط تکه‌هایی را اضافه می‌کند که قبلاً هیچ‌جایِ دیگری نبود:
 *
 *   GET   /super/overview                نمایِ کلی + «نیازمندِ توجه» (شمارش‌هایِ زنده، همه از DB)
 *   GET   /super/schools                 همه‌یِ مدارس با تعدادِ اعضا به‌تفکیکِ نقش، کلاس‌ها، مدیران و باتِ مدرسه
 *   POST  /super/schools                 ساختِ مدرسه (بدونِ دست‌زدن به عضویتِ خودِ سوپرادمین) + مدیرِ اختیاری
 *   PATCH /super/schools/:id             نام/شهر/آدرس/مجوز/«مدرسه‌یِ آزمایشی»
 *   POST  /super/schools/:id/members     افزودنِ یک کاربرِ موجودِ پلتفرم به مدرسه با نقش (جابه‌جایی فقط با move:true)
 *   GET   /super/audit                   ردپایِ سراسری: `admin_audit_log` (source=admin) یا `school_audit_log` (source=school)
 *
 * مدیریتِ داخلِ هر مدرسه (اعضا، کلاس‌ها، برنامه‌ها، کدهایِ معرف، اعلامیه‌ها، هشدارها، پیام‌ها، باتِ مدرسه…) همان APIهایِ
 * `/schools/:id/...` است که برایِ سوپرادمین از `lib/schoolAuth.ts` (`canAccessSchool`) باز می‌شود — کپیِ دومی نیست.
 * همه‌یِ این‌ها پشتِ `requireSuperAdmin` + `requireSuperGate` (رمزِ دومِ /super) هستند.
 */
import { Router } from "express";
import crypto from "crypto";
import {
  db, schoolsTable, schoolMembersTable, schoolAdminsTable, schoolClassesTable, schoolBotsTable, schoolAuditLogTable,
  usersTable, botsTable, ticketsTable, walletTransactionsTable, paymentRequestsTable, pendingRegistrationsTable,
  adminAuditLogTable, SCHOOL_MEMBER_ROLES,
} from "@workspace/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { requireSuperAdmin } from "./auth";
import { requireSuperGate } from "../middleware/superGate";
import { logger } from "../lib/logger";
import { logSchoolAudit } from "../lib/schoolAuditLog";
import { emailEquals } from "../lib/email";

const router = Router();

const guard = [requireSuperAdmin, requireSuperGate] as const;

interface RoleCounts { [role: string]: number }

function baseSchool(s: typeof schoolsTable.$inferSelect) {
  return {
    id: s.id,
    name: s.name,
    slug: s.slug,
    city: s.city,
    address: s.address,
    photoUrl: s.photoUrl,
    licenseInfo: s.licenseInfo,
    isTestSchool: s.isTestSchool,
    createdByUserId: s.createdByUserId,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

const num = (v: unknown) => Number(v ?? 0);
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** نامِ نمایشی: name، وگرنه email. */
function who(u: { name?: string | null; email?: string | null } | undefined, fallback: string): string {
  return (u?.name || u?.email || fallback) as string;
}

// ─── مدارس ─────────────────────────────────────────────────────────────────

// GET /api/super/schools — همه‌یِ مدارس (واقعی + آزمایشی) با آمارِ هر مدرسه.
router.get("/super/schools", ...guard, async (_req, res) => {
  try {
    const rows = await db.select().from(schoolsTable).orderBy(schoolsTable.createdAt);
    const [roleRows, classRows, extraAdmins, bots, primaryAdmins] = await Promise.all([
      db.select({ schoolId: schoolMembersTable.schoolId, role: schoolMembersTable.role, count: sql<number>`count(*)` })
        .from(schoolMembersTable).where(sql`${schoolMembersTable.schoolId} IS NOT NULL`)
        .groupBy(schoolMembersTable.schoolId, schoolMembersTable.role),
      db.select({ schoolId: schoolClassesTable.schoolId, count: sql<number>`count(*)` })
        .from(schoolClassesTable).groupBy(schoolClassesTable.schoolId),
      db.select().from(schoolAdminsTable),
      db.select().from(schoolBotsTable),
      db.select().from(schoolMembersTable).where(eq(schoolMembersTable.role, "admin")),
    ]);

    const roles = new Map<string, RoleCounts>();
    for (const r of roleRows) {
      if (!r.schoolId) continue;
      const m = roles.get(r.schoolId) ?? {};
      m[r.role ?? "none"] = num(r.count);
      roles.set(r.schoolId, m);
    }
    const classes = new Map<string, number>(classRows.map((c: typeof classRows[number]) => [c.schoolId, num(c.count)]));
    const botBySchool = new Map<string, typeof bots[number]>(bots.map((b: typeof bots[number]) => [b.schoolId, b]));

    // مدیرانِ هر مدرسه: عضویتِ اصلی با نقشِ admin + مدیرانِ اضافه (`school_admins`)، یکتا بر اساسِ userId.
    const adminIds = new Map<string, Set<string>>();
    const add = (schoolId: string | null, userId: string) => {
      if (!schoolId) return;
      const set = adminIds.get(schoolId) ?? new Set<string>();
      set.add(userId);
      adminIds.set(schoolId, set);
    };
    for (const m of primaryAdmins) add(m.schoolId, m.userId);
    for (const a of extraAdmins) add(a.schoolId, a.userId);
    const allAdminUserIds = [...new Set([...adminIds.values()].flatMap((x) => [...x]))];
    const users = allAdminUserIds.length ? await db.select().from(usersTable).where(inArray(usersTable.id, allAdminUserIds)) : [];
    const userMap = new Map<string, typeof users[number]>(users.map((u: typeof users[number]) => [u.id, u]));

    res.json(rows.map((s: typeof rows[number]) => {
      const r = roles.get(s.id) ?? {};
      const admins = [...(adminIds.get(s.id) ?? [])].slice(0, 6).map((uid) => ({
        userId: uid, name: who(userMap.get(uid), uid), email: userMap.get(uid)?.email ?? null,
      }));
      return {
        ...baseSchool(s),
        memberCount: Object.values(r).reduce((a, b) => a + b, 0),
        roles: r,
        classCount: classes.get(s.id) ?? 0,
        adminCount: adminIds.get(s.id)?.size ?? 0,
        admins,
        bot: botBySchool.has(s.id) ? { telegramUsername: botBySchool.get(s.id)!.telegramUsername ?? null } : null,
      };
    }));
  } catch (err) {
    logger.error({ err }, "super list schools error");
    res.status(500).json({ error: "Internal server error" });
  }
});

/** کاربرِ مدیر را به مدرسه وصل می‌کند: بدونِ عضویت → عضوِ admin؛ عضوِ بی‌مدرسه → همان ردیف؛ عضوِ مدرسه‌یِ دیگر → مدیرِ اضافه. */
async function assignSchoolAdmin(schoolId: string, userId: string): Promise<"member_created" | "member_updated" | "extra_admin" | "already"> {
  const [member] = await db.select().from(schoolMembersTable).where(eq(schoolMembersTable.userId, userId)).limit(1);
  if (!member) {
    await db.insert(schoolMembersTable).values({ id: crypto.randomUUID(), userId, schoolId, role: "admin", profileComplete: false });
    return "member_created";
  }
  if (member.schoolId === schoolId) {
    if (member.role === "admin") return "already";
    await db.update(schoolMembersTable).set({ role: "admin" }).where(eq(schoolMembersTable.id, member.id));
    return "member_updated";
  }
  if (!member.schoolId) {
    await db.update(schoolMembersTable).set({ schoolId, role: "admin" }).where(eq(schoolMembersTable.id, member.id));
    return "member_updated";
  }
  const [extra] = await db.select().from(schoolAdminsTable)
    .where(and(eq(schoolAdminsTable.userId, userId), eq(schoolAdminsTable.schoolId, schoolId))).limit(1);
  if (extra) return "already";
  await db.insert(schoolAdminsTable).values({ id: crypto.randomUUID(), userId, schoolId });
  return "extra_admin";
}

async function findUser(userId: unknown, email: unknown) {
  if (typeof userId === "string" && userId.trim()) {
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, userId.trim())).limit(1);
    return u ?? null;
  }
  if (typeof email === "string" && email.trim()) {
    const [u] = await db.select().from(usersTable).where(emailEquals(email)).limit(1);
    return u ?? null;
  }
  return null;
}

// POST /api/super/schools — ساختِ مدرسه. عضویتِ مدرسه‌ایِ خودِ سوپرادمین دست نمی‌خورد؛ مدیرِ اولیه اختیاری است (userId یا email).
router.post("/super/schools", ...guard, async (req: any, res) => {
  try {
    const name = str(req.body?.name, 200);
    if (!name) {
      res.status(400).json({ error: "name is required", code: "name_required" });
      return;
    }
    const wantsAdmin = Boolean(str(req.body?.adminUserId, 100) || str(req.body?.adminEmail, 200));
    let adminUser: Awaited<ReturnType<typeof findUser>> = null;
    if (wantsAdmin) {
      adminUser = await findUser(req.body?.adminUserId, req.body?.adminEmail);
      if (!adminUser) {
        res.status(404).json({ error: "کاربری با این شناسه/ایمیل پیدا نشد.", code: "admin_user_not_found" });
        return;
      }
    }
    const [school] = await db.insert(schoolsTable).values({
      id: crypto.randomUUID(),
      name,
      address: str(req.body?.address, 300) || null,
      city: str(req.body?.city, 100) || null,
      licenseInfo: str(req.body?.licenseInfo, 500) || null,
      isTestSchool: req.body?.isTestSchool === true,
      createdByUserId: req.userId,
    }).returning();
    await logSchoolAudit(school.id, req.userId, "school.created_by_super", `/super: ${name}`);
    let adminResult: string | null = null;
    if (adminUser) {
      adminResult = await assignSchoolAdmin(school.id, adminUser.id);
      await logSchoolAudit(school.id, req.userId, "admin.granted", `${who(adminUser, adminUser.id)} (/super)`);
    }
    res.status(201).json({ ...baseSchool(school), memberCount: adminUser && adminResult !== "extra_admin" ? 1 : 0, adminAssigned: adminResult });
  } catch (err) {
    logger.error({ err }, "super create school error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/super/schools/:id — ویرایشِ نام/شهر/آدرس/مجوز و پرچمِ مدرسه‌یِ آزمایشی از نمایِ سراسری.
router.patch("/super/schools/:id", ...guard, async (req: any, res) => {
  try {
    const { name, city, address, licenseInfo, isTestSchool } = req.body ?? {};
    const patch: Record<string, unknown> = {};
    if (name !== undefined) {
      const n = str(name, 200);
      if (!n) {
        res.status(400).json({ error: "name can't be empty", code: "name_required" });
        return;
      }
      patch.name = n;
    }
    if (city !== undefined) patch.city = city === null ? null : str(city, 100) || null;
    if (address !== undefined) patch.address = address === null ? null : str(address, 300) || null;
    if (licenseInfo !== undefined) patch.licenseInfo = licenseInfo === null ? null : str(licenseInfo, 500) || null;
    if (isTestSchool !== undefined) patch.isTestSchool = isTestSchool === true;
    if (Object.keys(patch).length === 0) {
      res.status(400).json({ error: "Nothing to update" });
      return;
    }
    const [updated] = await db.update(schoolsTable).set(patch).where(eq(schoolsTable.id, req.params.id)).returning();
    if (!updated) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    await logSchoolAudit(updated.id, req.userId, "school.updated_by_super", `/super: ${Object.keys(patch).join(", ")}`);
    res.json(baseSchool(updated));
  } catch (err) {
    logger.error({ err }, "super update school error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/super/schools/:id/members — {userId|email, role, move?}: یک کاربرِ موجودِ پلتفرم را با نقش به مدرسه اضافه می‌کند.
// هر کاربر فقط یک عضویتِ اصلی دارد؛ اگر عضوِ مدرسه‌یِ دیگری است بدونِ `move: true` ۴۰۹ می‌دهد (نه جابه‌جاییِ بی‌صدا).
router.post("/super/schools/:id/members", ...guard, async (req: any, res) => {
  try {
    const role = req.body?.role;
    if (typeof role !== "string" || !(SCHOOL_MEMBER_ROLES as readonly string[]).includes(role)) {
      res.status(400).json({ error: "Invalid role", code: "invalid_role" });
      return;
    }
    const [school] = await db.select().from(schoolsTable).where(eq(schoolsTable.id, req.params.id)).limit(1);
    if (!school) {
      res.status(404).json({ error: "School not found" });
      return;
    }
    const user = await findUser(req.body?.userId, req.body?.email);
    if (!user) {
      res.status(404).json({ error: "کاربری با این شناسه/ایمیل پیدا نشد.", code: "user_not_found" });
      return;
    }
    const [member] = await db.select().from(schoolMembersTable).where(eq(schoolMembersTable.userId, user.id)).limit(1);
    let result: "created" | "updated" | "moved" = "created";
    if (!member) {
      await db.insert(schoolMembersTable).values({ id: crypto.randomUUID(), userId: user.id, schoolId: school.id, role, profileComplete: false });
    } else if (member.schoolId && member.schoolId !== school.id && req.body?.move !== true) {
      const [other] = await db.select().from(schoolsTable).where(eq(schoolsTable.id, member.schoolId)).limit(1);
      res.status(409).json({
        error: `این کاربر عضوِ مدرسه‌یِ «${other?.name ?? member.schoolId}» است؛ برایِ جابه‌جایی «انتقال» را تأیید کنید.`,
        code: "already_member_elsewhere", currentSchool: other ? { id: other.id, name: other.name } : null,
      });
      return;
    } else {
      result = member.schoolId && member.schoolId !== school.id ? "moved" : "updated";
      // نقشِ تازه = اعتبارِ پروفایل دوباره باید توسطِ خودِ کاربر کامل شود (کدملی/پایه…)
      await db.update(schoolMembersTable).set({ schoolId: school.id, role, ...(result === "moved" ? { profileComplete: false } : {}) })
        .where(eq(schoolMembersTable.id, member.id));
    }
    await logSchoolAudit(school.id, req.userId, result === "moved" ? "member.moved_by_super" : "member.added_by_super",
      `${who(user, user.id)}: ${role} (/super)`);
    res.status(result === "created" ? 201 : 200).json({ ok: true, result, userId: user.id, role, schoolId: school.id });
  } catch (err) {
    logger.error({ err }, "super add school member error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── نمایِ کلی ──────────────────────────────────────────────────────────────

// GET /api/super/overview — شمارش‌هایِ زنده + «نیازمندِ توجه». هر شمارش جدا و بدونِ حدس از DB می‌آید.
router.get("/super/overview", ...guard, async (_req, res) => {
  try {
    const weekAgo = new Date(Date.now() - 7 * 86_400_000);
    const one = async <T,>(q: Promise<T[]>): Promise<T | undefined> => (await q)[0];
    const [users, usersWeek, usersByRole, bots, botsByStatus, schools, testSchools, members, pendingWallet, reviewCard, openTickets, pendingSignups, activeChannels] = await Promise.all([
      one(db.select({ n: sql<number>`count(*)` }).from(usersTable)),
      one(db.select({ n: sql<number>`count(*)` }).from(usersTable).where(sql`${usersTable.createdAt} >= ${weekAgo}`)),
      db.select({ role: usersTable.role, n: sql<number>`count(*)` }).from(usersTable).groupBy(usersTable.role),
      one(db.select({ n: sql<number>`count(*)` }).from(botsTable)),
      db.select({ status: botsTable.status, n: sql<number>`count(*)` }).from(botsTable).groupBy(botsTable.status),
      one(db.select({ n: sql<number>`count(*)` }).from(schoolsTable)),
      one(db.select({ n: sql<number>`count(*)` }).from(schoolsTable).where(eq(schoolsTable.isTestSchool, true))),
      one(db.select({ n: sql<number>`count(*)` }).from(schoolMembersTable).where(sql`${schoolMembersTable.schoolId} IS NOT NULL`)),
      one(db.select({ n: sql<number>`count(*)` }).from(walletTransactionsTable).where(eq(walletTransactionsTable.status, "pending"))),
      one(db.select({ n: sql<number>`count(*)` }).from(paymentRequestsTable).where(eq(paymentRequestsTable.status, "awaiting_review"))),
      one(db.select({ n: sql<number>`count(*)` }).from(ticketsTable).where(eq(ticketsTable.status, "open"))),
      one(db.select({ n: sql<number>`count(*)` }).from(pendingRegistrationsTable)),
      // کانالِ پرداختِ خودکارِ فعالی که بیش از ۱۲ ساعت پیامکی نگرفته (گوشی قطع؟) — همان آستانه‌یِ پنلِ کارت‌به‌کارت.
      one(db.execute(sql`SELECT count(*)::int AS n FROM payment_channels WHERE active AND (last_sms_at IS NULL OR last_sms_at < now() - interval '12 hours')`)
        .then((r: any) => (r.rows ?? r) as { n: number }[])),
    ]);
    res.json({
      generatedAt: new Date().toISOString(),
      users: { total: num(users?.n), newLast7d: num(usersWeek?.n), byRole: Object.fromEntries(usersByRole.map((r: any) => [r.role ?? "none", num(r.n)])) },
      bots: { total: num(bots?.n), byStatus: Object.fromEntries(botsByStatus.map((r: any) => [r.status ?? "none", num(r.n)])) },
      schools: { total: num(schools?.n), test: num(testSchools?.n), members: num(members?.n) },
      attention: {
        pendingWalletReceipts: num(pendingWallet?.n),
        cardPaymentsAwaitingReview: num(reviewCard?.n),
        openTickets: num(openTickets?.n),
        pendingSignups: num(pendingSignups?.n),
        silentPaymentChannels: num(activeChannels?.n),
      },
    });
  } catch (err) {
    logger.error({ err }, "super overview error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── ردپایِ سراسری ──────────────────────────────────────────────────────────

// GET /api/super/audit?source=admin|school&action=&q=&limit=&offset=
router.get("/super/audit", ...guard, async (req: any, res) => {
  try {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const action = str(req.query.action, 80);
    const q = str(req.query.q, 100);
    const source = req.query.source === "school" ? "school" : "admin";

    if (source === "school") {
      const conds = [] as ReturnType<typeof sql>[];
      if (action) conds.push(sql`${schoolAuditLogTable.action} = ${action}`);
      if (q) conds.push(sql`(${schoolAuditLogTable.targetDescription} ILIKE ${"%" + q + "%"} OR ${schoolAuditLogTable.action} ILIKE ${"%" + q + "%"})`);
      const where = conds.length ? sql.join(conds, sql` AND `) : undefined;
      const rows = await db.select().from(schoolAuditLogTable).where(where).orderBy(desc(schoolAuditLogTable.createdAt)).limit(limit).offset(offset);
      const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(schoolAuditLogTable).where(where);
      const actions = await db.selectDistinct({ a: schoolAuditLogTable.action }).from(schoolAuditLogTable).orderBy(schoolAuditLogTable.action);
      const ids = [...new Set(rows.flatMap((r: typeof rows[number]) => [r.actorUserId]))];
      const schoolIds = [...new Set(rows.map((r: typeof rows[number]) => r.schoolId))];
      const users = ids.length ? await db.select().from(usersTable).where(inArray(usersTable.id, ids)) : [];
      const schools = schoolIds.length ? await db.select().from(schoolsTable).where(inArray(schoolsTable.id, schoolIds)) : [];
      const um = new Map<string, typeof users[number]>(users.map((u: typeof users[number]) => [u.id, u]));
      const sm = new Map<string, typeof schools[number]>(schools.map((x: typeof schools[number]) => [x.id, x]));
      res.json({
        source, total: num(n), limit, offset, actions: actions.map((a: any) => a.a),
        items: rows.map((r: typeof rows[number]) => ({
          id: r.id, at: r.createdAt.toISOString(), action: r.action, actor: who(um.get(r.actorUserId), r.actorUserId),
          actorUserId: r.actorUserId, target: r.targetDescription, schoolId: r.schoolId, schoolName: sm.get(r.schoolId)?.name ?? null,
        })),
      });
      return;
    }

    const conds = [] as ReturnType<typeof sql>[];
    if (action) conds.push(sql`${adminAuditLogTable.action} = ${action}`);
    if (q) conds.push(sql`(${adminAuditLogTable.action} ILIKE ${"%" + q + "%"} OR ${adminAuditLogTable.reason} ILIKE ${"%" + q + "%"})`);
    const where = conds.length ? sql.join(conds, sql` AND `) : undefined;
    const rows = await db.select().from(adminAuditLogTable).where(where).orderBy(desc(adminAuditLogTable.createdAt)).limit(limit).offset(offset);
    const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(adminAuditLogTable).where(where);
    const actions = await db.selectDistinct({ a: adminAuditLogTable.action }).from(adminAuditLogTable).orderBy(adminAuditLogTable.action);
    const ids = [...new Set(rows.flatMap((r: typeof rows[number]) => [r.actorUserId, r.targetUserId].filter(Boolean) as string[]))];
    const users = ids.length ? await db.select().from(usersTable).where(inArray(usersTable.id, ids)) : [];
    const um = new Map<string, typeof users[number]>(users.map((u: typeof users[number]) => [u.id, u]));
    res.json({
      source, total: num(n), limit, offset, actions: actions.map((a: any) => a.a),
      items: rows.map((r: typeof rows[number]) => ({
        id: r.id, at: r.createdAt.toISOString(), action: r.action, actor: who(um.get(r.actorUserId), r.actorUserId), actorUserId: r.actorUserId,
        target: r.targetUserId ? who(um.get(r.targetUserId), r.targetUserId) : null, targetUserId: r.targetUserId ?? null,
        reason: r.reason ?? null,
        // metadata فقط شناسه‌ها/برچسب‌هاست (lib/audit.ts: هرگز راز/شماره‌کارتِ کامل) — برایِ نمایش قطع می‌شود.
        metadata: r.metadata ?? null,
      })),
    });
  } catch (err) {
    logger.error({ err }, "super audit error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
