/**
 * routes/schools.ts — بخش "/schools" فاز ۱: پروفایلِ مدرسه‌ایِ کاربر، کدهای
 * معرف، و مدیریتِ خودِ مدرسه (نام/آدرس/مجوزها).
 *
 * این دروازه کاملاً جدا از `completeProfile.ts` (ویزارد هویتِ سراسری) است:
 * آن یکی کل سایت را می‌بندد، این یکی فقط ورود به `/schools/*` را.
 */
import { logger } from "../lib/logger";
import { Router } from "express";
import {
  db,
  schoolsTable,
  schoolInviteCodesTable,
  schoolMembersTable,
  SCHOOL_MEMBER_ROLES,
  computeSchoolProfileComplete,
  type SchoolMemberRole,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import crypto from "crypto";
import { requireAuth } from "./auth";

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
    createdByUserId: s.createdByUserId,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

async function getMember(userId: string) {
  const [row] = await db.select().from(schoolMembersTable).where(eq(schoolMembersTable.userId, userId)).limit(1);
  return row ?? null;
}

/** مدیر (نقشِ مدرسه‌ایِ "admin") روی مدرسه‌ای که خودش مالکش است — فاز ۱ اجازه‌ی مدیریت را فقط به همین می‌دهد. */
async function requireSchoolAdmin(req: any, res: any, schoolId: string): Promise<boolean> {
  const member = await getMember(req.userId);
  if (!member || member.role !== "admin" || member.schoolId !== schoolId) {
    res.status(403).json({ error: "Forbidden" });
    return false;
  }
  return true;
}

// GET /api/schools/me — پروفایلِ مدرسه‌ایِ کاربرِ جاری (یا null)
router.get("/api/schools/me", requireAuth, async (req: any, res) => {
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

// POST /api/schools/onboarding — upsert فیلدهای پروفایلِ مدرسه‌ای، با پیوستنِ
// اختیاری به یک مدرسه از طریقِ کدِ معرف.
router.post("/api/schools/onboarding", requireAuth, async (req: any, res) => {
  try {
    const { role, grade, nationalId, birthDate, city, schoolNameFreeText, inviteCode } = req.body ?? {};

    if (role !== undefined && role !== null && !(SCHOOL_MEMBER_ROLES as readonly string[]).includes(role)) {
      res.status(400).json({ error: "Invalid role" });
      return;
    }

    let resolvedSchoolId: string | null | undefined = undefined;
    let resolvedRole: string | undefined = role;
    if (inviteCode && typeof inviteCode === "string" && inviteCode.trim()) {
      const [invite] = await db.select().from(schoolInviteCodesTable)
        .where(and(eq(schoolInviteCodesTable.code, inviteCode.trim()), eq(schoolInviteCodesTable.active, true)))
        .limit(1);
      if (!invite) {
        res.status(400).json({ error: "Invalid invite code", code: "invalid_invite_code" });
        return;
      }
      resolvedSchoolId = invite.schoolId;
      // کدِ نقش‌دار همیشه نقش را دیکته می‌کند؛ کدِ عمومی نقشِ انتخابیِ خودِ فرم را می‌پذیرد.
      if (invite.role) resolvedRole = invite.role;
    }

    const existing = await getMember(req.userId);
    const patch: Record<string, unknown> = {
      role: resolvedRole ?? existing?.role ?? null,
      grade: grade ?? existing?.grade ?? null,
      nationalId: nationalId ?? existing?.nationalId ?? null,
      birthDate: birthDate ? new Date(birthDate) : (existing?.birthDate ?? null),
      city: city ?? existing?.city ?? null,
      schoolNameFreeText: schoolNameFreeText ?? existing?.schoolNameFreeText ?? null,
    };
    if (resolvedSchoolId !== undefined) patch.schoolId = resolvedSchoolId;

    const complete = computeSchoolProfileComplete({
      role: patch.role as SchoolMemberRole | null | undefined,
      grade: patch.grade as string | null,
      nationalId: patch.nationalId as string | null,
      birthDate: patch.birthDate as Date | null,
      city: patch.city as string | null,
    });
    patch.profileComplete = complete;

    let saved;
    if (existing) {
      [saved] = await db.update(schoolMembersTable).set(patch).where(eq(schoolMembersTable.id, existing.id)).returning();
    } else {
      [saved] = await db.insert(schoolMembersTable).values({
        id: crypto.randomUUID(),
        userId: req.userId,
        ...patch,
      }).returning();
    }

    res.status(existing ? 200 : 201).json(formatMember(saved));
  } catch (err) {
    logger.error({ err }, "School onboarding error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/schools/invite-codes/:code — پیداکردنِ مدرسه از رویِ کدِ معرف
// (برای ویجتِ «پیدا کردن مدرسه» کنارِ سایدبار و داخلِ فرمِ اولیه).
router.get("/api/schools/invite-codes/:code", requireAuth, async (req: any, res) => {
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
router.post("/api/schools", requireAuth, async (req: any, res) => {
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
router.patch("/api/schools/:id", requireAuth, async (req: any, res) => {
  try {
    const allowed = await requireSchoolAdmin(req, res, req.params.id);
    if (!allowed) return;
    const { name, address, city, licenseInfo } = req.body ?? {};
    const patch: Record<string, unknown> = {};
    if (name !== undefined) patch.name = name;
    if (address !== undefined) patch.address = address;
    if (city !== undefined) patch.city = city;
    if (licenseInfo !== undefined) patch.licenseInfo = licenseInfo;
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

// POST /api/schools/:id/invite-codes — تولید کدِ معرفِ جدید؛ فقط مدیرِ همان مدرسه.
router.post("/api/schools/:id/invite-codes", requireAuth, async (req: any, res) => {
  try {
    const allowed = await requireSchoolAdmin(req, res, req.params.id);
    if (!allowed) return;
    const { role } = req.body ?? {};
    if (role !== undefined && role !== null && !(SCHOOL_MEMBER_ROLES as readonly string[]).includes(role)) {
      res.status(400).json({ error: "Invalid role" });
      return;
    }
    const code = crypto.randomBytes(4).toString("hex").toUpperCase();
    const [invite] = await db.insert(schoolInviteCodesTable).values({
      id: crypto.randomUUID(),
      schoolId: req.params.id,
      code,
      role: role ?? null,
      createdByUserId: req.userId,
    }).returning();
    res.status(201).json({
      id: invite.id,
      schoolId: invite.schoolId,
      code: invite.code,
      role: invite.role,
      active: invite.active,
      createdAt: invite.createdAt.toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "Create invite code error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
