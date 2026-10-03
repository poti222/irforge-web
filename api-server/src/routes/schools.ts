/**
 * routes/schools.ts — بخش "/schools" فاز ۱: پروفایلِ مدرسه‌ایِ کاربر، کدهای
 * معرف، و مدیریتِ خودِ مدرسه (نام/آدرس/مجوزها).
 *
 * این دروازه کاملاً جدا از `completeProfile.ts` (ویزارد هویتِ سراسری) است:
 * آن یکی کل سایت را می‌بندد، این یکی فقط ورود به `/schools/*` را.
 *
 * **باگِ «ثبتِ اطلاعات با خطا مواجه شد» (تستِ زنده‌ی کاربر):** همه‌ی مسیرهای
 * این فایل با پیشوندِ کاملِ `"/api/schools/…"` نوشته شده بودند، در حالی که
 * این روتر با `router.use(schoolsRouter)` داخلِ `routes/index.ts` جمع می‌شود
 * و آن روترِ ترکیبی خودش با `app.use("/api", router)` در app.ts مانت
 * می‌شود — یعنی مسیرِ نهایی `"/api" + "/api/schools/onboarding"` می‌شد،
 * یعنی `/api/api/schools/onboarding`. فرانت همیشه `/api/schools/onboarding`
 * (بدونِ تکرار) صدا می‌زد، پس همیشه ۴۰۴ می‌گرفت و پیامِ عمومیِ خطا نشان داده
 * می‌شد. الگوی درست همان چیزی است که بقیه‌ی فایل‌های این خانواده (مثلاً
 * routes/auth.ts با `"/auth/…"`) از اول رعایت کرده‌اند: مسیرها اینجا باید
 * *بدونِ* `/api` نوشته شوند، چون آن پیشوند را همان یک app.use بالا اضافه
 * می‌کند.
 */
import { logger } from "../lib/logger";
import { Router } from "express";
import {
  db,
  schoolsTable,
  schoolInviteCodesTable,
  schoolMembersTable,
  schoolAdminsTable,
  usersTable,
  SCHOOL_MEMBER_ROLES,
  computeSchoolProfileComplete,
  type SchoolMemberRole,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import crypto from "crypto";
import { requireAuth } from "./auth";
import { canAccessSchool, SCHOOL_ADMIN_ONLY, SCHOOL_MEMBERS_READ_ROLES } from "../lib/schoolAuth";
import { logSchoolAudit } from "../lib/schoolAuditLog";

const router = Router();

function formatMember(m: typeof schoolMembersTable.$inferSelect) {
  return {
    id: m.id,
    userId: m.userId,
    schoolId: m.schoolId,
    role: m.role,
    grade: m.grade,
    nationalId: m.nationalId,
    birthDate: m.birthDate ? m.birthDate.toISOString() : null,
    city: m.city,
    schoolNameFreeText: m.schoolNameFreeText,
    profileComplete: m.profileComplete,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

function formatSchool(s: typeof schoolsTable.$inferSelect) {
  return {
    id: s.id,
    name: s.name,
    slug: s.slug,
    address: s.address,
    photoUrl: s.photoUrl,
    city: s.city,
    licenseInfo: s.licenseInfo,
    /** فازِ ۱۰ (بندِ ۱.۳) */
    consecutiveAbsenceAlertThreshold: s.consecutiveAbsenceAlertThreshold,
    createdByUserId: s.createdByUserId,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

async function getMember(userId: string) {
  const [row] = await db.select().from(schoolMembersTable).where(eq(schoolMembersTable.userId, userId)).limit(1);
  return row ?? null;
}

/**
 * مدیرِ این مدرسه (فاز ۳: عضویتِ اصلی *یا* چندمدرسه‌ایِ `school_admins` —
 * ببینید lib/schoolAuth.ts).
 */
async function requireSchoolAdmin(req: any, res: any, schoolId: string): Promise<boolean> {
  const { ok } = await canAccessSchool(req.userId, schoolId, SCHOOL_ADMIN_ONLY);
  if (!ok) {
    res.status(403).json({ error: "Forbidden" });
    return false;
  }
  return true;
}

// GET /api/schools/me — پروفایلِ مدرسه‌ایِ کاربرِ جاری (یا null)
router.get("/schools/me", requireAuth, async (req: any, res) => {
  try {
    const member = await getMember(req.userId);
    if (!member) {
      res.json(null);
      return;
    }
    let school = null;
    if (member.schoolId) {
      const [s] = await db.select().from(schoolsTable).where(eq(schoolsTable.id, member.schoolId)).limit(1);
      school = s ? formatSchool(s) : null;
    }
    res.json({ ...formatMember(member), school });
  } catch (err) {
    logger.error({ err }, "Get school member error");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * کدِ ملیِ ایران دقیقاً ۱۰ رقم است — همان چیزی که کاربر گزارش کرد
 * («کد ملی باید 10 رقمی باشد»). هیچ اعتبارسنجیِ کدِ‌ملیِ دیگری در این کدبیس
 * پیدا نشد تا از آن استفاده شود (مثلاً schema/users.ts فیلدِ کدِ‌ملی ندارد)،
 * پس فقط همین قاعده‌ی صریحِ کاربر پیاده شده، بدونِ الگوریتمِ رقمِ کنترلی —
 * چک‌سام واقعی یک الگوریتمِ تازه می‌خواست که خارج از دامنه‌ی این باگ‌فیکس است.
 * سمتِ کلاینت هم دقیقاً همین regex را دارد (onboarding.tsx) تا هیچ‌وقت این دو
 * جفت نشوند؛ ولی اعتبارسنجیِ سمتِ سرور اینجا تنها منبعِ قابلِ‌اعتماد است.
 */
const NATIONAL_ID_RE = /^\d{10}$/;

// POST /api/schools/onboarding — upsert فیلدهای پروفایلِ مدرسه‌ای، با پیوستنِ
// اختیاری به یک مدرسه از طریقِ کدِ معرف.
router.post("/schools/onboarding", requireAuth, async (req: any, res) => {
  try {
    const { role, grade, nationalId, birthDate, city, schoolNameFreeText, inviteCode } = req.body ?? {};

    if (role !== undefined && role !== null && !(SCHOOL_MEMBER_ROLES as readonly string[]).includes(role)) {
      res.status(400).json({ error: "Invalid role" });
      return;
    }

    if (nationalId !== undefined && nationalId !== null && nationalId !== "" && !NATIONAL_ID_RE.test(nationalId)) {
      res.status(400).json({ error: "کد ملی باید دقیقاً ۱۰ رقم باشد", code: "invalid_national_id" });
      return;
    }

    if (birthDate !== undefined && birthDate !== null && birthDate !== "" && Number.isNaN(new Date(birthDate).getTime())) {
      res.status(400).json({ error: "تاریخ تولد نامعتبر است", code: "invalid_birth_date" });
      return;
    }

    const existing = await getMember(req.userId);

    /** ساختِ patch نهایی — بعد از resolvedSchoolId/resolvedRole (شاید از کدِ معرف). */
    function buildPatch(resolvedSchoolId: string | null | undefined, resolvedRole: string | undefined) {
      const patch: Record<string, unknown> = {
        role: resolvedRole ?? existing?.role ?? null,
        grade: grade ?? existing?.grade ?? null,
        nationalId: nationalId ?? existing?.nationalId ?? null,
        birthDate: birthDate ? new Date(birthDate) : (existing?.birthDate ?? null),
        city: city ?? existing?.city ?? null,
        schoolNameFreeText: schoolNameFreeText ?? existing?.schoolNameFreeText ?? null,
      };
      if (resolvedSchoolId !== undefined) patch.schoolId = resolvedSchoolId;
      patch.profileComplete = computeSchoolProfileComplete({
        role: patch.role as SchoolMemberRole | null | undefined,
        grade: patch.grade as string | null,
        nationalId: patch.nationalId as string | null,
        birthDate: patch.birthDate as Date | null,
        city: patch.city as string | null,
      });
      return patch;
    }

    async function saveMember(executor: typeof db, patch: Record<string, unknown>) {
      if (existing) {
        const [row] = await executor.update(schoolMembersTable).set(patch).where(eq(schoolMembersTable.id, existing.id)).returning();
        return row;
      }
      const [row] = await executor.insert(schoolMembersTable).values({ id: crypto.randomUUID(), userId: req.userId, ...patch }).returning();
      return row;
    }

    let saved;

    if (inviteCode && typeof inviteCode === "string" && inviteCode.trim()) {
      const trimmedCode = inviteCode.trim();
      // فازِ ۹ (بندِ ۲): مصرفِ کدِ معرف + ذخیره‌ی پروفایل در **یک تراکنش** با
      // قفلِ ردیفِ کد (FOR UPDATE) — دقیقاً همان دلیلِ claimFreeSchoolBotToken
      // در schoolBots.ts: دو کاربرِ هم‌زمان نباید آخرین usesِ مجاز را دوبار
      // مصرف کنند. اگر منقضی/تمام‌شده باشد، کل تراکنش rollback می‌شود —
      // usesCount هرگز افزایش نمی‌یابد و پروفایل هم ذخیره نمی‌شود.
      let failure: { status: number; body: Record<string, unknown> } | undefined;
      await db.transaction(async (tx: any) => {
        const [invite] = await tx.select().from(schoolInviteCodesTable)
          .where(and(eq(schoolInviteCodesTable.code, trimmedCode), eq(schoolInviteCodesTable.active, true)))
          .for("update")
          .limit(1);
        if (!invite) {
          failure = { status: 400, body: { error: "Invalid invite code", code: "invalid_invite_code" } };
          return;
        }
        if (invite.expiresAt && invite.expiresAt.getTime() < Date.now()) {
          failure = { status: 400, body: { error: "این کد معرف منقضی شده است.", code: "invite_code_expired" } };
          return;
        }
        if (invite.maxUses != null && invite.usesCount >= invite.maxUses) {
          failure = { status: 400, body: { error: "ظرفیتِ این کد معرف تمام شده است.", code: "invite_code_exhausted" } };
          return;
        }

        await tx.update(schoolInviteCodesTable).set({ usesCount: invite.usesCount + 1 }).where(eq(schoolInviteCodesTable.id, invite.id));

        // کدِ نقش‌دار همیشه نقش را دیکته می‌کند؛ کدِ عمومی نقشِ انتخابیِ خودِ فرم را می‌پذیرد.
        const patch = buildPatch(invite.schoolId, invite.role ?? role);
        saved = await saveMember(tx, patch);
      });
      if (failure) {
        res.status(failure.status).json(failure.body);
        return;
      }
    } else {
      const patch = buildPatch(undefined, role);
      saved = await saveMember(db, patch);
    }

    res.status(existing ? 200 : 201).json(formatMember(saved));
  } catch (err) {
    logger.error({ err }, "School onboarding error");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * فازِ ۹ (بندِ ۲): آیا این کدِ معرف (که از قبل `active` بودنش چک شده) هنوز
 * واقعاً قابلِ‌استفاده است؟ منقضی‌شده/تمام‌شده یعنی «نه»، حتی اگر active
 * هنوز true باشد (مدیر مجبور نیست دستی خاموشش کند).
 */
function inviteCodeUsable(invite: typeof schoolInviteCodesTable.$inferSelect): { ok: true } | { ok: false; code: string; error: string } {
  if (invite.expiresAt && invite.expiresAt.getTime() < Date.now()) {
    return { ok: false, code: "invite_code_expired", error: "این کد معرف منقضی شده است." };
  }
  if (invite.maxUses != null && invite.usesCount >= invite.maxUses) {
    return { ok: false, code: "invite_code_exhausted", error: "ظرفیتِ این کد معرف تمام شده است." };
  }
  return { ok: true };
}

// GET /api/schools/invite-codes/:code — پیداکردنِ مدرسه از رویِ کدِ معرف
// (برای ویجتِ «پیدا کردن مدرسه» کنارِ سایدبار و داخلِ فرمِ اولیه).
router.get("/schools/invite-codes/:code", requireAuth, async (req: any, res) => {
  try {
    const code = req.params.code?.trim();
    if (!code) {
      res.status(400).json({ error: "code is required" });
      return;
    }
    const [invite] = await db.select().from(schoolInviteCodesTable)
      .where(and(eq(schoolInviteCodesTable.code, code), eq(schoolInviteCodesTable.active, true)))
      .limit(1);
    if (!invite) {
      res.status(404).json({ error: "Invite code not found" });
      return;
    }
    const usable = inviteCodeUsable(invite);
    if (!usable.ok) {
      res.status(404).json({ error: usable.error, code: usable.code });
      return;
    }
    const [school] = await db.select().from(schoolsTable).where(eq(schoolsTable.id, invite.schoolId)).limit(1);
    if (!school) {
      res.status(404).json({ error: "School not found" });
      return;
    }
    res.json({ school: formatSchool(school), role: invite.role ?? null });
  } catch (err) {
    logger.error({ err }, "Lookup invite code error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/schools — ساختِ یک مدرسه‌ی تازه؛ سازنده به‌طور خودکار مدیرِ آن می‌شود.
router.post("/schools", requireAuth, async (req: any, res) => {
  try {
    const { name, address, city, licenseInfo } = req.body ?? {};
    if (!name?.trim()) {
      res.status(400).json({ error: "name is required" });
      return;
    }
    const [school] = await db.insert(schoolsTable).values({
      id: crypto.randomUUID(),
      name: name.trim(),
      address: address ?? null,
      city: city ?? null,
      licenseInfo: licenseInfo ?? null,
      createdByUserId: req.userId,
    }).returning();

    // سازنده را همان لحظه مدیرِ همین مدرسه کن — بدون این کار «مدرسه‌ی من»ِ
    // خالی می‌ماند و هیچ راهی برای مدیریتش نداشت.
    const existing = await getMember(req.userId);
    if (existing) {
      await db.update(schoolMembersTable).set({ schoolId: school.id, role: "admin", profileComplete: true })
        .where(eq(schoolMembersTable.id, existing.id));
    } else {
      await db.insert(schoolMembersTable).values({
        id: crypto.randomUUID(),
        userId: req.userId,
        schoolId: school.id,
        role: "admin",
        profileComplete: false,
      });
    }

    res.status(201).json(formatSchool(school));
  } catch (err) {
    logger.error({ err }, "Create school error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/schools/:id — ویرایشِ نام/آدرس/مجوزها؛ فقط مدیرِ همان مدرسه.
router.patch("/schools/:id", requireAuth, async (req: any, res) => {
  try {
    const allowed = await requireSchoolAdmin(req, res, req.params.id);
    if (!allowed) return;
    const { name, address, city, licenseInfo, consecutiveAbsenceAlertThreshold } = req.body ?? {};
    const patch: Record<string, unknown> = {};
    if (name !== undefined) patch.name = name;
    if (address !== undefined) patch.address = address;
    if (city !== undefined) patch.city = city;
    if (licenseInfo !== undefined) patch.licenseInfo = licenseInfo;
    // فازِ ۱۰ (بندِ ۱.۳): آستانه‌یِ اخطارِ غیبتِ پیاپی — فقط عددِ صحیحِ مثبت یا
    // null (یعنی «پیش‌فرضِ ۳ در لایه‌ی اپلیکیشن») پذیرفته می‌شود.
    if (consecutiveAbsenceAlertThreshold !== undefined) {
      patch.consecutiveAbsenceAlertThreshold = consecutiveAbsenceAlertThreshold === null
        ? null
        : Math.max(1, Math.trunc(Number(consecutiveAbsenceAlertThreshold)) || 3);
    }
    const [updated] = await db.update(schoolsTable).set(patch).where(eq(schoolsTable.id, req.params.id)).returning();
    if (!updated) {
      res.status(404).json({ error: "School not found" });
      return;
    }
    res.json(formatSchool(updated));
  } catch (err) {
    logger.error({ err }, "Update school error");
    res.status(500).json({ error: "Internal server error" });
  }
});

function formatInviteCode(invite: typeof schoolInviteCodesTable.$inferSelect) {
  return {
    id: invite.id,
    schoolId: invite.schoolId,
    code: invite.code,
    role: invite.role,
    active: invite.active,
    /** فازِ ۹ (بندِ ۲) */
    expiresAt: invite.expiresAt ? invite.expiresAt.toISOString() : null,
    maxUses: invite.maxUses,
    usesCount: invite.usesCount,
    createdAt: invite.createdAt.toISOString(),
  };
}

// POST /api/schools/:id/invite-codes — تولید کدِ معرفِ جدید؛ فقط مدیرِ همان مدرسه.
router.post("/schools/:id/invite-codes", requireAuth, async (req: any, res) => {
  try {
    const allowed = await requireSchoolAdmin(req, res, req.params.id);
    if (!allowed) return;
    const { role, expiresAt, maxUses } = req.body ?? {};
    if (role !== undefined && role !== null && !(SCHOOL_MEMBER_ROLES as readonly string[]).includes(role)) {
      res.status(400).json({ error: "Invalid role" });
      return;
    }
    // فازِ ۹ (بندِ ۲): هردو اختیاری — نبودشان یعنی دقیقاً رفتارِ قدیمی (بدونِ سقف/انقضا).
    let parsedExpiresAt: Date | null = null;
    if (expiresAt !== undefined && expiresAt !== null && expiresAt !== "") {
      const d = new Date(expiresAt);
      if (Number.isNaN(d.getTime())) {
        res.status(400).json({ error: "Invalid expiresAt" });
        return;
      }
      parsedExpiresAt = d;
    }
    let parsedMaxUses: number | null = null;
    if (maxUses !== undefined && maxUses !== null && maxUses !== "") {
      const n = Number(maxUses);
      if (!Number.isInteger(n) || n <= 0) {
        res.status(400).json({ error: "Invalid maxUses" });
        return;
      }
      parsedMaxUses = n;
    }
    const code = crypto.randomBytes(4).toString("hex").toUpperCase();
    const [invite] = await db.insert(schoolInviteCodesTable).values({
      id: crypto.randomUUID(),
      schoolId: req.params.id,
      code,
      role: role ?? null,
      createdByUserId: req.userId,
      expiresAt: parsedExpiresAt,
      maxUses: parsedMaxUses,
    }).returning();
    await logSchoolAudit(req.params.id, req.userId, "invite_code.created", `کدِ «${code}»${role ? ` (نقش: ${role})` : ""}`);
    res.status(201).json(formatInviteCode(invite));
  } catch (err) {
    logger.error({ err }, "Create invite code error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/schools/:id/invite-codes — لیستِ کدهای معرفِ یک مدرسه؛ فقط مدیرِ همان مدرسه.
router.get("/schools/:id/invite-codes", requireAuth, async (req: any, res) => {
  try {
    const allowed = await requireSchoolAdmin(req, res, req.params.id);
    if (!allowed) return;
    const rows = await db.select().from(schoolInviteCodesTable).where(eq(schoolInviteCodesTable.schoolId, req.params.id));
    res.json(rows.map((invite: typeof rows[number]) => formatInviteCode(invite)));
  } catch (err) {
    logger.error({ err }, "List invite codes error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/schools/:id/invite-codes/:codeId — فعال/غیرفعال‌کردنِ یک کد؛ فقط مدیرِ همان مدرسه.
router.patch("/schools/:id/invite-codes/:codeId", requireAuth, async (req: any, res) => {
  try {
    const allowed = await requireSchoolAdmin(req, res, req.params.id);
    if (!allowed) return;
    const { active } = req.body ?? {};
    if (typeof active !== "boolean") {
      res.status(400).json({ error: "active must be boolean" });
      return;
    }
    const [updated] = await db.update(schoolInviteCodesTable).set({ active })
      .where(and(eq(schoolInviteCodesTable.id, req.params.codeId), eq(schoolInviteCodesTable.schoolId, req.params.id)))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    await logSchoolAudit(req.params.id, req.userId, "invite_code.toggled", `کدِ «${updated.code}» ${active ? "فعال" : "غیرفعال"} شد`);
    res.json(formatInviteCode(updated));
  } catch (err) {
    logger.error({ err }, "Toggle invite code error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/schools/:id/members — لیستِ اعضایِ یک مدرسه.
// مدیر/معاون/معاون‌انضباطی/مشاور می‌توانند بخوانند (طبقِ اسپکِ فاز ۲: معاون/
// انضباطی حداقل به همین لیست دسترسیِ خواندن دارند)؛ نوشتن (تغییرِ نقش/حذف)
// فقط مدیر.
router.get("/schools/:id/members", requireAuth, async (req: any, res) => {
  try {
    const { ok: canRead } = await canAccessSchool(req.userId, req.params.id, SCHOOL_MEMBERS_READ_ROLES);
    if (!canRead) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const rows = await db.select().from(schoolMembersTable).where(eq(schoolMembersTable.schoolId, req.params.id));
    // برایِ نمایشِ نام/ایمیل به‌جایِ userId خام روی UI مدیریتِ اعضا — یک
    // کوئریِ جدا رویِ users، چون schoolMembers هیچ FKِ سختی به users ندارد
    // (طبقِ همان قراردادِ فاز ۱، مثلِ products.createdBy).
    const userIds = rows.map((m: typeof rows[number]) => m.userId);
    const users = userIds.length ? await db.select().from(usersTable).where(inArray(usersTable.id, userIds)) : [];
    const userMap = new Map(users.map((u: typeof users[number]) => [u.id, u]));
    res.json(rows.map((m: typeof rows[number]) => ({
      ...formatMember(m),
      userName: userMap.get(m.userId)?.name ?? null,
      userEmail: userMap.get(m.userId)?.email ?? null,
      // `/super` بخشِ C: برچسبِ «حسابِ آزمایشیِ پلتفرم» — همین یک جایِ مشترکی
      // است که این صفحه (admin/members.tsx) نام/ایمیلِ کاربر را از users جوین
      // می‌کند، پس همان‌جا این فلگ هم اضافه می‌شود، نه یک کوئریِ جدا.
      isPlatformTestAccount: userMap.get(m.userId)?.isPlatformTestAccount ?? false,
    })));
  } catch (err) {
    logger.error({ err }, "List school members error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/schools/:id/members/:memberId — تغییرِ نقشِ یک عضو؛ فقط مدیر.
router.patch("/schools/:id/members/:memberId", requireAuth, async (req: any, res) => {
  try {
    const allowed = await requireSchoolAdmin(req, res, req.params.id);
    if (!allowed) return;
    const { role, grade } = req.body ?? {};
    if (role !== undefined && role !== null && !(SCHOOL_MEMBER_ROLES as readonly string[]).includes(role)) {
      res.status(400).json({ error: "Invalid role" });
      return;
    }
    const [before] = await db.select().from(schoolMembersTable)
      .where(and(eq(schoolMembersTable.id, req.params.memberId), eq(schoolMembersTable.schoolId, req.params.id))).limit(1);
    const patch: Record<string, unknown> = {};
    if (role !== undefined) patch.role = role;
    if (grade !== undefined) patch.grade = grade;
    const [updated] = await db.update(schoolMembersTable).set(patch)
      .where(and(eq(schoolMembersTable.id, req.params.memberId), eq(schoolMembersTable.schoolId, req.params.id)))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (role !== undefined && before && before.role !== updated.role) {
      const [targetUser] = await db.select().from(usersTable).where(eq(usersTable.id, updated.userId)).limit(1);
      const who = targetUser?.name ?? targetUser?.email ?? updated.userId;
      await logSchoolAudit(req.params.id, req.userId, "member.role_changed", `${who}: ${before.role ?? "—"} → ${updated.role ?? "—"}`);
    }
    res.json(formatMember(updated));
  } catch (err) {
    logger.error({ err }, "Update school member error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/schools/:id/members/:memberId — خارج‌کردنِ یک عضو از مدرسه؛ فقط مدیر.
// ردیفِ `school_members` حذف نمی‌شود (پروفایلِ سراسریِ کاربر است)، فقط
// `schoolId`/`role` پاک می‌شوند — دقیقاً همان کاری که خودِ کاربر با «آنبوردینگِ
// دوباره» می‌توانست انجام دهد.
router.delete("/schools/:id/members/:memberId", requireAuth, async (req: any, res) => {
  try {
    const allowed = await requireSchoolAdmin(req, res, req.params.id);
    if (!allowed) return;
    const [before] = await db.select().from(schoolMembersTable)
      .where(and(eq(schoolMembersTable.id, req.params.memberId), eq(schoolMembersTable.schoolId, req.params.id))).limit(1);
    const [updated] = await db.update(schoolMembersTable).set({ schoolId: null, role: null, profileComplete: false })
      .where(and(eq(schoolMembersTable.id, req.params.memberId), eq(schoolMembersTable.schoolId, req.params.id)))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const [targetUser] = await db.select().from(usersTable).where(eq(usersTable.id, updated.userId)).limit(1);
    const who = targetUser?.name ?? targetUser?.email ?? updated.userId;
    await logSchoolAudit(req.params.id, req.userId, "member.removed", `${who} (نقشِ قبلی: ${before?.role ?? "—"})`);
    res.status(204).end();
  } catch (err) {
    logger.error({ err }, "Remove school member error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/schools/my-schools — همه‌یِ مدارسی که کاربرِ جاری مدیرشان است
// (چندمدرسه‌ایِ فاز ۲: عضویتِ اصلی از `school_members` + مدرسه‌های اضافیِ
// `school_admins`، یکتا بر اساسِ id).
router.get("/schools/my-schools", requireAuth, async (req: any, res) => {
  try {
    const member = await getMember(req.userId);
    const schoolIds = new Set<string>();
    if (member?.role === "admin" && member.schoolId) schoolIds.add(member.schoolId);
    const extra = await db.select().from(schoolAdminsTable).where(eq(schoolAdminsTable.userId, req.userId));
    for (const row of extra) schoolIds.add(row.schoolId);
    if (schoolIds.size === 0) {
      res.json([]);
      return;
    }
    const rows = await db.select().from(schoolsTable);
    const filtered = rows.filter((s: typeof rows[number]) => schoolIds.has(s.id));
    res.json(filtered.map(formatSchool));
  } catch (err) {
    logger.error({ err }, "List my schools error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/schools/:id/admins — افزودنِ یک مدیرِ دیگر به یک مدرسه (چندمدرسه‌ایِ فاز ۲)؛ فقط مدیرِ همان مدرسه.
router.post("/schools/:id/admins", requireAuth, async (req: any, res) => {
  try {
    const allowed = await requireSchoolAdmin(req, res, req.params.id);
    if (!allowed) return;
    const { userId } = req.body ?? {};
    if (!userId?.trim()) {
      res.status(400).json({ error: "userId is required" });
      return;
    }
    const [row] = await db.insert(schoolAdminsTable).values({
      id: crypto.randomUUID(),
      userId: userId.trim(),
      schoolId: req.params.id,
    }).onConflictDoNothing().returning();
    if (row) {
      const [targetUser] = await db.select().from(usersTable).where(eq(usersTable.id, userId.trim())).limit(1);
      const who = targetUser?.name ?? targetUser?.email ?? userId.trim();
      await logSchoolAudit(req.params.id, req.userId, "admin.granted", who);
    }
    res.status(201).json(row ?? { userId: userId.trim(), schoolId: req.params.id, alreadyAdmin: true });
  } catch (err) {
    logger.error({ err }, "Add school admin error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
