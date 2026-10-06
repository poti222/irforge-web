/**
 * lib/schoolAuth.ts — بخش "/schools" فاز ۳: چکِ مجوزِ مشترک بین همه‌یِ
 * روت‌های مدرسه‌ای.
 * ─────────────────────────────────────────────────────────────────────────
 * تا قبل از این فاز، هر روت جدا `requester.schoolId !== req.params.schoolId`
 * را چک می‌کرد — یعنی فقط عضویتِ *اصلیِ* کاربر (`school_members.school_id`)
 * را می‌پذیرفت. این با چندمدرسه‌ایِ مدیر (فاز ۲، جدولِ `school_admins`) در
 * تناقض بود: مدیری که از سوییچرِ «مدرسه‌های من» یک مدرسه‌یِ *غیرِ اصلی* را
 * انتخاب می‌کرد، روی هر endpoint نوشتنی (اعضا/کلاس‌ها/برنامه‌ها/اعلامیه‌ها) با
 * ۴۰۳ مواجه می‌شد، با این‌که واقعاً مدیرِ همان مدرسه بود. این فایل آن دو منبع
 * را یک‌جا چک می‌کند.
 */
import { db, schoolMembersTable, schoolAdminsTable, usersTable, schoolClassesTable, schoolExamsTable, schoolAssignmentsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

/**
 * سوپرادمینِ پلتفرم (`users.role = 'super_admin'`). فقط برایِ دروازه‌ی مدیریتیِ `canAccessSchool` و
 * `/schools/me` / `/schools/my-schools` استفاده می‌شود؛ خودِ نقش را `requireSuperAdmin` در `routes/auth.ts` می‌سنجد.
 */
export async function isSuperAdminUser(userId: string): Promise<boolean> {
  const [u] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  return u?.role === "super_admin";
}

export async function getSchoolMember(userId: string) {
  const [row] = await db.select().from(schoolMembersTable).where(eq(schoolMembersTable.userId, userId)).limit(1);
  return row ?? null;
}

/**
 * آیا `userId` روی `schoolId` یکی از نقش‌های `allowedRoles` را دارد؟
 * عضویتِ اصلی (`school_members`) *یا*، فقط وقتی "admin" جزوِ نقش‌های مجاز
 * باشد، یک ردیفِ اضافه در `school_admins` برایِ همین مدرسه.
 *
 * سوپرادمینِ پلتفرم (`/super`) هم فقط روی endpointهایی رد می‌شود که «admin» جزوِ نقش‌هایِ مجازشان است (= مدیریتِ مدرسه)،
 * نه روی endpointهایِ ویژه‌یِ دانش‌آموز/معلم/والد که هویتِ عضویتِ خودِ کاربر را لازم دارند؛ پس بدونِ اینکه عضوِ
 * مدرسه‌ای باشد هر مدرسه را مثلِ مدیرِ همان مدرسه مدیریت می‌کند. (او از قبل می‌تواند هر کاربری را impersonate کند؛ این
 * فقط همان توان را بدونِ جعلِ هویت و با ردپایِ واقعیِ خودش می‌دهد.)
 */
export async function canAccessSchool(
  userId: string,
  schoolId: string,
  allowedRoles: readonly string[],
): Promise<{ ok: boolean; member: Awaited<ReturnType<typeof getSchoolMember>> }> {
  const member = await getSchoolMember(userId);
  if (member && member.schoolId === schoolId && allowedRoles.includes(member.role ?? "")) {
    return { ok: true, member };
  }
  if (allowedRoles.includes("admin")) {
    const [extra] = await db.select().from(schoolAdminsTable)
      .where(and(eq(schoolAdminsTable.userId, userId), eq(schoolAdminsTable.schoolId, schoolId)))
      .limit(1);
    if (extra) return { ok: true, member };
    if (await isSuperAdminUser(userId)) return { ok: true, member };
  }
  return { ok: false, member };
}

export const SCHOOL_ADMIN_ONLY = ["admin"] as const;
export const SCHOOL_ADMIN_DEPUTY = ["admin", "deputy"] as const;
/** خواندنِ اعضا/برنامه‌ها + نوشتنِ برنامه‌ها (فاز ۳، بخشِ ۵): معاون‌انضباطی هم اضافه شد. */
export const SCHOOL_ADMIN_DEPUTY_DISCIPLINE = ["admin", "deputy", "deputy_discipline"] as const;
export const SCHOOL_MEMBERS_READ_ROLES = ["admin", "deputy", "deputy_discipline", "counselor"] as const;


// ─── مرزِ مدرسه برایِ منابعی که فقط classId دارند (آزمون/تکلیف) ─────────────────
// school_exams/school_assignments ستونِ schoolId ندارند؛ فقط از راهِ کلاس به مدرسه وصل‌اند. بدونِ این چک‌ها
// یک عضو/مدیرِ مدرسه‌یِ A با دادنِ classId/idِ مدرسه‌یِ B به دادهٔ B دسترسی می‌گرفت.
export async function classBelongsToSchool(classId: string, schoolId: string): Promise<boolean> {
  const [c] = await db.select({ id: schoolClassesTable.id }).from(schoolClassesTable)
    .where(and(eq(schoolClassesTable.id, classId), eq(schoolClassesTable.schoolId, schoolId))).limit(1);
  return !!c;
}

export async function findExamInSchool(examId: string, schoolId: string) {
  const [row] = await db.select({ exam: schoolExamsTable }).from(schoolExamsTable)
    .innerJoin(schoolClassesTable, eq(schoolClassesTable.id, schoolExamsTable.classId))
    .where(and(eq(schoolExamsTable.id, examId), eq(schoolClassesTable.schoolId, schoolId))).limit(1);
  return row?.exam;
}

export async function findAssignmentInSchool(assignmentId: string, schoolId: string) {
  const [row] = await db.select({ a: schoolAssignmentsTable }).from(schoolAssignmentsTable)
    .innerJoin(schoolClassesTable, eq(schoolClassesTable.id, schoolAssignmentsTable.classId))
    .where(and(eq(schoolAssignmentsTable.id, assignmentId), eq(schoolClassesTable.schoolId, schoolId))).limit(1);
  return row?.a;
}
