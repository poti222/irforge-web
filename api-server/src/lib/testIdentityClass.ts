/**
 * lib/testIdentityClass.ts — هویت‌هایِ آزمایشیِ /super هرگز نباید اطلاعاتِ اضافه بخواهند؛ پس انتخابِ کلاسِ
 * دانش‌آموز/معلم (routes/schoolEnrollment.ts) برایِ آن‌ها خودکار انجام می‌شود: کلاسِ انتخابی، وگرنه اولین کلاسِ
 * مدرسه، وگرنه ساختِ «کلاس تست». idempotent است (اگر از قبل کلاس دارد کاری نمی‌کند) — هم هنگامِ ساخت و هم برایِ
 * هویت‌هایِ قدیمیِ بدونِ کلاس (از GET /enrollment/me) صدا زده می‌شود.
 */
import crypto from "crypto";
import { and, asc, eq } from "drizzle-orm";
import { db, schoolClassesTable, schoolClassMembersTable } from "@workspace/db";

export async function ensureTestIdentityClass(params: {
  schoolId: string;
  memberId: string;
  role: "student" | "teacher";
  grade?: string | null;
  preferredClassId?: string | null;
}): Promise<string> {
  const { schoolId, memberId, role, grade, preferredClassId } = params;
  const mine = await db.select().from(schoolClassMembersTable)
    .where(and(eq(schoolClassMembersTable.schoolMemberId, memberId), eq(schoolClassMembersTable.roleInClass, role)));
  if (mine.length > 0) return mine[0].classId;

  let classId: string | null = null;
  if (preferredClassId) {
    const [c] = await db.select({ id: schoolClassesTable.id }).from(schoolClassesTable)
      .where(and(eq(schoolClassesTable.id, preferredClassId), eq(schoolClassesTable.schoolId, schoolId))).limit(1);
    classId = c?.id ?? null;
  }
  if (!classId) {
    const [first] = await db.select({ id: schoolClassesTable.id }).from(schoolClassesTable)
      .where(eq(schoolClassesTable.schoolId, schoolId)).orderBy(asc(schoolClassesTable.createdAt)).limit(1);
    classId = first?.id ?? null;
  }
  if (!classId) {
    classId = crypto.randomUUID();
    await db.insert(schoolClassesTable).values({ id: classId, schoolId, name: "کلاس تست", grade: grade ?? null, academicYear: null });
  }
  await db.insert(schoolClassMembersTable).values({ id: crypto.randomUUID(), classId, schoolMemberId: memberId, roleInClass: role });
  return classId;
}
