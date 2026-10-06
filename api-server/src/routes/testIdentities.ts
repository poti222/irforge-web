/**
 * routes/testIdentities.ts — بخش "/super" (بخشِ C): «هویت‌های آزمایشی».
 * ─────────────────────────────────────────────────────────────────────────────
 * چرا این فایل وجود دارد، به‌جایِ نوشتنیُ‌کردنِ جعلِ هویتِ موجود:
 * middleware/impersonation.ts عمداً read-only است (نگاه کن توضیحِ آن فایل) —
 * ضعیف‌کردنش برایِ تستِ تعاملی یعنی هر اقدامِ مخرب از آن لحظه با actor واقعی
 * قابلِ‌ردگیری نیست، برایِ کلِ پلتفرم، نه فقط مدارس. این فایل آن سیستم را
 * اصلاً لمس نمی‌کند.
 *
 * به‌جایش: یک **حسابِ کاملاً واقعیِ تازه** می‌سازد (فقط با یک پرچمِ
 * `isPlatformTestAccount=true`) و یک `school_members` معمولی برایش می‌سازد —
 * دقیقاً همان دو insertی که `POST /api/schools` (routes/schools.ts) برایِ هر
 * کاربرِ تازه انجام می‌دهد، نه یک مسیرِ موازیِ جدید. بعد «ورود به این هویت»
 * یک نشستِ کاملاً معمولیِ همان کاربر می‌سازد (دقیقاً همان insert در
 * sessionsTable که routes/auth.ts برایِ لاگین/ثبت‌نام می‌کند) — پس هر روتِ
 * موجودِ "/schools/*" بدونِ هیچ کدِ خاصِ جدیدی رویِ آن کار می‌کند: کاملاً
 * خواندن و نوشتن، چون این یک نشستِ عادی است، نه جعلِ هویت.
 *
 * «بازگشت به حسابِ من»: سمتِ کلاینت توکنِ سوپرادمینِ واقعی را قبل از سوییچ
 * جداگانه نگه می‌دارد (localStorage، نه کوکی — چونِ خودِ نشست‌هایِ این
 * کدبیس هم Bearer tokenِ ساده‌اند، نه کوکی؛ نگاه کن irforge/src/lib/
 * auth-token.ts) و با یک کلیک همان توکنِ قدیمی را برمی‌گرداند. سروری که
 * اینجا لازم است فقط «یک نشستِ تازه برایِ شناسه‌ی داده‌شده بساز» است —
 * همان‌چیزی که enter-session پایین انجام می‌دهد.
 */
import { Router } from "express";
import crypto from "crypto";
import {
  db,
  usersTable,
  schoolsTable,
  schoolMembersTable,
  schoolTeacherSubjectsTable,
  schoolSubjectsTable,
  schoolContentLessonsTable,
  schoolContentItemsTable,
  sessionsTable,
  SCHOOL_MEMBER_ROLES,
  SCHOOL_SUBJECTS,
  computeSchoolProfileComplete,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { requireSuperAdmin } from "./auth";
import { requireSuperGate } from "../middleware/superGate";
import { hashPassword } from "../lib/password";
import { hashSessionToken } from "../lib/sessionToken";
import { logger } from "../lib/logger";
import { writeAudit } from "../lib/audit";
import { ensureSchoolSubjectsSeeded } from "../lib/schoolContentAccess";

const router = Router();

function sessionExpiresAt(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d;
}

function generateToken(userId: string): string {
  return Buffer.from(`${userId}:${Date.now()}:${crypto.randomBytes(16).toString("hex")}`).toString("base64");
}

function formatIdentity(
  user: typeof usersTable.$inferSelect,
  member: typeof schoolMembersTable.$inferSelect | null,
  schoolName: string | null,
) {
  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    schoolId: member?.schoolId ?? null,
    schoolName,
    role: member?.role ?? null,
    grade: member?.grade ?? null,
    createdAt: user.createdAt.toISOString(),
  };
}

// GET /api/super/test-identities — فهرستِ همه‌یِ حساب‌هایِ آزمایشی که تا الان ساخته شده.
router.get("/super/test-identities", requireSuperAdmin, requireSuperGate, async (_req, res) => {
  try {
    const users = await db.select().from(usersTable).where(eq(usersTable.isPlatformTestAccount, true));
    if (users.length === 0) {
      res.json([]);
      return;
    }
    const userIds = users.map((u: typeof users[number]) => u.id);
    const members: Array<typeof schoolMembersTable.$inferSelect> = await db.select().from(schoolMembersTable).where(inArray(schoolMembersTable.userId, userIds));
    const memberByUser = new Map(members.map((m) => [m.userId, m]));
    const schoolIds = [...new Set(members.map((m) => m.schoolId).filter((v): v is string => Boolean(v)))];
    const schools = schoolIds.length ? await db.select().from(schoolsTable).where(inArray(schoolsTable.id, schoolIds)) : [];
    const schoolNameById = new Map(schools.map((s: typeof schools[number]) => [s.id, s.name]));
    res.json(
      users.map((u: typeof users[number]) => {
        const member = memberByUser.get(u.id) ?? null;
        const schoolName = member?.schoolId ? schoolNameById.get(member.schoolId) ?? null : null;
        return formatIdentity(u, member, schoolName);
      }),
    );
  } catch (err) {
    logger.error({ err }, "list test identities error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/super/test-identities/schools — برایِ فرمِ ساخت: مدارسِ واقعیِ قابلِ‌انتخاب.
router.get("/super/test-identities/schools", requireSuperAdmin, requireSuperGate, async (_req, res) => {
  try {
    const rows = await db.select({ id: schoolsTable.id, name: schoolsTable.name, isTestSchool: schoolsTable.isTestSchool }).from(schoolsTable);
    res.json(rows);
  } catch (err) {
    logger.error({ err }, "list schools for test identity error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/super/test-identities/schools/:schoolId/subjects — درس‌هایِ *واقعیِ* همان مدرسه
// برایِ پیکرِ «درسِ معلمِ آزمایشی» (قبلاً فهرستِ ثابت بود؛ حالا مدیرِ هر مدرسه درس‌ها را عوض می‌کند).
router.get("/super/test-identities/schools/:schoolId/subjects", requireSuperAdmin, requireSuperGate, async (req: any, res) => {
  try {
    const [school] = await db.select({ id: schoolsTable.id }).from(schoolsTable).where(eq(schoolsTable.id, req.params.schoolId)).limit(1);
    if (!school) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    await ensureSchoolSubjectsSeeded(school.id);
    const rows = await db.select({ name: schoolSubjectsTable.name }).from(schoolSubjectsTable)
      .where(eq(schoolSubjectsTable.schoolId, school.id)).orderBy(schoolSubjectsTable.sortOrder);
    res.json(rows.map((r: { name: string }) => r.name));
  } catch (err) {
    logger.error({ err }, "list test-identity school subjects error");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/super/test-identities
 * body: { role, grade?, schoolId? , newSchoolName?, subject? }
 * یکی از `schoolId` (مدرسه‌یِ واقعیِ موجود) یا `newSchoolName` (ساختِ یک
 * مدرسه‌یِ تازه‌یِ `isTestSchool=true`) باید بیاید.
 *
 * `subject` فقط برایِ role="teacher" و اجباری است — قبل از این، یک معلمِ
 * آزمایشیِ تازه هیچ ردیفی در `school_teacher_subjects` نداشت (آن جدول در
 * فازِ قبل اضافه شد، این فرم هیچ‌وقت به‌روز نشده بود)، پس فرمِ افزودنِ محتوا
 * بازمی‌شد ولی دکمه‌ی ذخیره همیشه غیرفعال بود — دقیقاً همان مشکلی که کاربر
 * با آن روبرو شد. اینجا همان کاری را می‌کنیم که مدیر در «مدیریت اعضا» برایِ
 * یک معلمِ واقعی می‌کند (POST /api/schools/:schoolId/teacher-subjects)، فقط
 * در همان درخواستِ ساختِ هویت.
 */
router.post("/super/test-identities", requireSuperAdmin, requireSuperGate, async (req: any, res) => {
  try {
    const { role, grade, schoolId, newSchoolName, subject } = req.body ?? {};
    if (!role || !(SCHOOL_MEMBER_ROLES as readonly string[]).includes(role)) {
      res.status(400).json({ error: "نقش نامعتبر است", code: "invalid_role" });
      return;
    }
    if (role === "student" && !grade) {
      res.status(400).json({ error: "پایه برایِ دانش‌آموز لازم است", code: "grade_required" });
      return;
    }
    if (role === "teacher" && (!subject || typeof subject !== "string")) {
      res.status(400).json({ error: "درس برایِ معلم لازم است", code: "subject_required" });
      return;
    }
    if (!schoolId && !newSchoolName?.trim()) {
      res.status(400).json({ error: "یک مدرسه‌یِ واقعی انتخاب کن یا نامِ یک مدرسه‌یِ آزمایشیِ تازه بده", code: "school_required" });
      return;
    }

    let targetSchoolId: string;
    if (schoolId) {
      const [school] = await db.select().from(schoolsTable).where(eq(schoolsTable.id, schoolId)).limit(1);
      if (!school) {
        res.status(404).json({ error: "مدرسه پیدا نشد" });
        return;
      }
      targetSchoolId = school.id;
      // نامِ درس باید یکی از درس‌هایِ *واقعیِ همین مدرسه* باشد (school_subjects).
      if (role === "teacher") {
        await ensureSchoolSubjectsSeeded(school.id);
        const [subjectRow] = await db.select({ id: schoolSubjectsTable.id }).from(schoolSubjectsTable)
          .where(and(eq(schoolSubjectsTable.schoolId, school.id), eq(schoolSubjectsTable.name, subject))).limit(1);
        if (!subjectRow) {
          res.status(400).json({ error: "درس برایِ معلم لازم است", code: "subject_required" });
          return;
        }
      }
    } else {
      // مدرسه‌یِ آزمایشیِ تازه هنوز ساخته نشده — اول با فهرستِ پیش‌فرض (همان که seed می‌شود) اعتبارسنجی کن.
      if (role === "teacher" && !(SCHOOL_SUBJECTS as readonly string[]).includes(subject)) {
        res.status(400).json({ error: "درس برایِ معلم لازم است", code: "subject_required" });
        return;
      }
      // دقیقاً همان دو فیلدِ ساختِ مدرسه در routes/schools.ts (POST /api/schools)،
      // به‌علاوه‌یِ پرچمِ isTestSchool.
      const [school] = await db
        .insert(schoolsTable)
        .values({
          id: crypto.randomUUID(),
          name: newSchoolName.trim(),
          createdByUserId: req.userId,
          isTestSchool: true,
        })
        .returning();
      targetSchoolId = school.id;
      // مدرسه‌یِ تازه هم باید «درس‌هایِ پیش‌فرض» را داشته باشد (وگرنه subject بی‌مرجع می‌ماند).
      await ensureSchoolSubjectsSeeded(school.id);
    }

    const random = crypto.randomBytes(8).toString("hex");
    const email = `test-${role}-${random}@platform.test`;
    const randomPasswordHash = await hashPassword(crypto.randomBytes(32).toString("hex"));
    const userId = crypto.randomUUID();
    const [user] = await db
      .insert(usersTable)
      .values({
        id: userId,
        name: `تست ${role} ${random.slice(0, 4)}`,
        email,
        passwordHash: randomPasswordHash,
        role: "user",
        plan: "free",
        status: "active",
        profileComplete: true, // این حساب هرگز از ویزاردِ هویتِ سراسری رد نمی‌شود — این دروازه را هم عبور می‌دهد.
        isPlatformTestAccount: true,
        createdByUserId: req.userId,
      })
      .returning();

    const memberPatch = {
      role: role as string,
      grade: role === "student" ? (grade as string) : null,
      schoolId: targetSchoolId,
      profileComplete: true,
    };
    const [member] = await db
      .insert(schoolMembersTable)
      .values({
        id: crypto.randomUUID(),
        userId,
        ...memberPatch,
        profileComplete: computeSchoolProfileComplete({
          role: memberPatch.role as any,
          grade: memberPatch.grade,
          nationalId: "0000000000",
          birthDate: new Date("2000-01-01"),
          city: "—",
        }),
        nationalId: "0000000000",
        birthDate: new Date("2000-01-01"),
        city: "—",
      })
      .returning();

    if (role === "teacher") {
      // همان ردیفی که مدیر برایِ یک معلمِ واقعی در «مدیریت اعضا» می‌سازد
      // (classId=null یعنی این درس را در همه‌یِ کلاس‌هایش تدریس می‌کند) —
      // بدونِ این، معلمِ آزمایشی هیچ درسی برایِ انتخاب در فرمِ محتوا نمی‌بیند.
      await db.insert(schoolTeacherSubjectsTable).values({
        id: crypto.randomUUID(),
        schoolId: targetSchoolId,
        teacherUserId: userId,
        subject,
        classId: null,
      });
    }

    const [school] = await db.select().from(schoolsTable).where(eq(schoolsTable.id, targetSchoolId)).limit(1);

    await writeAudit({
      actorUserId: req.userId,
      action: "test_identity_created",
      targetUserId: userId,
      metadata: { schoolId: targetSchoolId, role, subject: role === "teacher" ? subject : undefined },
    });

    res.status(201).json(formatIdentity(user, member, school?.name ?? null));
  } catch (err) {
    logger.error({ err }, "create test identity error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/super/test-identities/:userId/enter — یک نشستِ کاملاً معمولی برایِ
// این کاربرِ آزمایشی می‌سازد (نه جعلِ هویت — توکنِ عادی، بدونِ پیشوندِ `imp_`).
router.post("/super/test-identities/:userId/enter", requireSuperAdmin, requireSuperGate, async (req: any, res) => {
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.params.userId)).limit(1);
    if (!user || !user.isPlatformTestAccount) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const token = generateToken(user.id);
    const tokenHash = hashSessionToken(token);
    await db.insert(sessionsTable).values({ token: tokenHash, userId: user.id, expiresAt: sessionExpiresAt() });
    await writeAudit({
      actorUserId: req.userId,
      action: "test_identity_entered",
      targetUserId: user.id,
    });
    logger.warn({ actor: req.userId, target: user.id }, "/super: entered test identity");
    res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
  } catch (err) {
    logger.error({ err }, "enter test identity error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/super/test-identities/:userId — حذفِ حسابِ آزمایشی + عضویتش.
// تریدآفِ عمدی: فقط ردیف‌هایِ هسته‌ای (کاربر + school_members) حذف می‌شوند؛
// رکوردهایِ تاریخی‌ای که به این userId اشاره دارند (مثلاً یک پیامِ چتِ قدیمی)
// عمداً دست‌نخورده می‌مانند — cascade-deleteِ کاملِ همه‌یِ جدول‌هایِ احتمالیِ
// "/schools" برایِ یک حسابِ آزمایشیِ یک‌بارمصرف ارزشِ ریسکِ خطا را ندارد.
router.delete("/super/test-identities/:userId", requireSuperAdmin, requireSuperGate, async (req: any, res) => {
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.params.userId)).limit(1);
    if (!user || !user.isPlatformTestAccount) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    await db.delete(schoolMembersTable).where(eq(schoolMembersTable.userId, user.id));
    await db.delete(sessionsTable).where(eq(sessionsTable.userId, user.id));
    await db.delete(usersTable).where(eq(usersTable.id, user.id));
    await writeAudit({
      actorUserId: req.userId,
      action: "test_identity_deleted",
      targetUserId: user.id,
    });
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "delete test identity error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/super/test-schools/cleanup — حذفِ دسته‌جمعیِ همه‌یِ مدارسِ
// isTestSchool + هویت‌های آزمایشیِ متعلق به آن‌ها (همان تریدآفِ بالا).
router.post("/super/test-schools/cleanup", requireSuperAdmin, requireSuperGate, async (req: any, res) => {
  try {
    const testSchools = await db.select().from(schoolsTable).where(eq(schoolsTable.isTestSchool, true));
    if (testSchools.length === 0) {
      res.json({ ok: true, deletedSchools: 0, deletedUsers: 0 });
      return;
    }
    const schoolIds = testSchools.map((s: typeof testSchools[number]) => s.id);
    const members = await db.select().from(schoolMembersTable).where(inArray(schoolMembersTable.schoolId, schoolIds));
    const memberUserIds = members.map((m: typeof members[number]) => m.userId);
    // فقط حساب‌هایِ *آزمایشی* این مدارس حذف می‌شوند — اگر یک کاربرِ واقعی به
    // اشتباه عضوِ یک مدرسه‌یِ تست شده باشد، حسابش دست‌نخورده می‌ماند و فقط
    // عضویتش پاک می‌شود.
    const testUsers = memberUserIds.length
      ? await db.select().from(usersTable).where(and(inArray(usersTable.id, memberUserIds), eq(usersTable.isPlatformTestAccount, true)))
      : [];
    const testUserIds = testUsers.map((u: typeof testUsers[number]) => u.id);

    await db.delete(schoolMembersTable).where(inArray(schoolMembersTable.schoolId, schoolIds));
    // محتوایِ کتابخانه/درس‌ها/تخصیصِ معلم‌هایِ این مدارس هم پاک شود (school_content_lessons و
    // school_teacher_subjects به schools(id) FK دارند — وگرنه حذفِ مدرسه در پایین شکست می‌خورد).
    await db.delete(schoolContentItemsTable).where(inArray(schoolContentItemsTable.schoolId, schoolIds));
    await db.delete(schoolContentLessonsTable).where(inArray(schoolContentLessonsTable.schoolId, schoolIds));
    await db.delete(schoolTeacherSubjectsTable).where(inArray(schoolTeacherSubjectsTable.schoolId, schoolIds));
    await db.delete(schoolSubjectsTable).where(inArray(schoolSubjectsTable.schoolId, schoolIds));
    if (testUserIds.length) {
      await db.delete(sessionsTable).where(inArray(sessionsTable.userId, testUserIds));
      await db.delete(usersTable).where(inArray(usersTable.id, testUserIds));
    }
    await db.delete(schoolsTable).where(inArray(schoolsTable.id, schoolIds));

    await writeAudit({
      actorUserId: req.userId,
      action: "test_school_cleaned_up",
      metadata: { deletedSchools: schoolIds.length, deletedUsers: testUserIds.length },
    });

    res.json({ ok: true, deletedSchools: schoolIds.length, deletedUsers: testUserIds.length });
  } catch (err) {
    logger.error({ err }, "test school cleanup error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
