/**
 * lib/schoolContentAccess.ts — منطقِ مشترکِ «درس‌ها» (school_subjects) و
 * روشن/خاموشِ انواعِ محتوا، برایِ routes/schoolSubjects.ts،
 * routes/schoolContentLessons.ts و routes/schoolContent.ts.
 *
 * مهم‌ترین قاعده (طبقِ خواسته‌یِ کاربر): یک typeِ *خاموش* باید برایِ دانش‌آموز
 * اصلاً وجود نداشته باشد — نه فقط دکمه‌اش پنهان شود. پس همین‌جا، سمتِ سرور،
 * `itemVisibleTo()` تعیین می‌کند هر آیتم برایِ این کاربر دیده شود یا نه، و
 * لیست/جزئیاتِ آیتم‌ها از همین تابع رد می‌شوند (routes/schoolContent.ts).
 * «نویسنده» (admin، یا معلمِ تخصیص‌داده‌شده به همان درس) انواعِ خاموش را هم
 * می‌بیند تا بتواند دوباره روشنشان کند.
 */
import { randomUUID } from "crypto";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import {
  db,
  schoolsTable,
  schoolSubjectsTable,
  schoolContentLessonsTable,
  schoolContentItemsTable,
  schoolContentProgressTable,
  schoolTeacherSubjectsTable,
  schoolSubjectClassesTable,
  schoolClassesTable,
  schoolClassMembersTable,
  schoolTimetableSlotsTable,
  SCHOOL_CONTENT_TYPE_KEYS,
  SCHOOL_MEMBER_ROLES,
  DEFAULT_SUBJECT_SEEDS,
} from "@workspace/db";
import { canAccessSchool } from "./schoolAuth";

/** انواعِ قابلِ‌مطالعه با فلش‌کارت — پایه‌یِ «درصدِ تسلط». */
export const STUDY_TYPES = ["dictionary", "poem"] as const;

/**
 * ورودیِ enabledTypes را به آرایه‌یِ یکتا و به ترتیبِ استانداردِ انواع تبدیل
 * می‌کند؛ نامعتبر (غیرِ آرایه یا typeِ ناشناس) → null. آرایه‌یِ خالی معتبر است
 * (همه خاموش — UI یک empty-stateِ روشن نشان می‌دهد، نه خطا).
 */
export function normalizeEnabledTypes(input: unknown): string[] | null {
  if (!Array.isArray(input)) return null;
  const valid = SCHOOL_CONTENT_TYPE_KEYS as readonly string[];
  if (!input.every((x) => typeof x === "string" && valid.includes(x))) return null;
  const set = new Set(input as string[]);
  return SCHOOL_CONTENT_TYPE_KEYS.filter((t) => set.has(t));
}

/** مجموعه‌یِ مؤثر = override جلسه ?? پیش‌فرضِ درس. null یعنی «بدونِ محدودیت» (درسِ ناشناس). */
export function effectiveTypes(
  lessonOverride: string[] | null | undefined,
  subjectTypes: string[] | null | undefined,
): string[] | null {
  return lessonOverride ?? subjectTypes ?? null;
}

/**
 * seedِ «درس‌هایِ پیش‌فرض» برایِ یک مدرسه — دقیقاً یک‌بار. claim با
 * `UPDATE ... WHERE NOT subjects_seeded` انجام می‌شود (ردیف‌قفل): درخواستِ
 * هم‌زمانِ دوم تا commitِ اولی منتظر می‌ماند و بعد هیچ ردیفی claim نمی‌کند، پس
 * هم تکراری نمی‌سازد، هم درسی را که مدیر بعد از seed حذف کرده زنده نمی‌کند.
 */
export async function ensureSchoolSubjectsSeeded(schoolId: string): Promise<void> {
  await db.transaction(async (tx: any) => {
    const claimed = await tx.update(schoolsTable).set({ subjectsSeeded: true })
      .where(and(eq(schoolsTable.id, schoolId), eq(schoolsTable.subjectsSeeded, false)))
      .returning({ id: schoolsTable.id });
    if (claimed.length === 0) return;
    await tx.insert(schoolSubjectsTable).values(
      DEFAULT_SUBJECT_SEEDS.map((d, i) => ({
        id: randomUUID(),
        schoolId,
        name: d.name,
        icon: d.icon,
        color: d.color,
        enabledTypes: [...d.types],
        sortOrder: i,
      })),
    ).onConflictDoNothing();
  });
}

export interface ContentScope {
  isMember: boolean;
  isAdmin: boolean;
  role: string | null;
  memberId: string | null;
  /** نامِ درس‌هایی که این کاربر (معلم) به آن‌ها تخصیص دارد. */
  assigned: Set<string>;
  /** فقط برایِ دانش‌آموز/معلم پر می‌شود: کلاس‌هایی که در آن‌ها عضو/مدرس است (برایِ فیلترِ «درس در کدام کلاس‌ها»). */
  classIds: Set<string>;
  /** آیا فیلترِ کلاس اعمال می‌شود؟ (دانش‌آموز/معلم بله؛ مدیر، معاون، مشاور، والد خیر) */
  classScoped: boolean;
}

export async function getContentScope(userId: string, schoolId: string): Promise<ContentScope> {
  const access = await canAccessSchool(userId, schoolId, SCHOOL_MEMBER_ROLES);
  if (!access.ok) return { isMember: false, isAdmin: false, role: null, memberId: null, assigned: new Set(), classIds: new Set(), classScoped: false };
  const adminCheck = await canAccessSchool(userId, schoolId, ["admin"]);
  const assigned = new Set<string>();
  if (access.member?.role === "teacher") {
    const rows = await db.select().from(schoolTeacherSubjectsTable)
      .where(and(eq(schoolTeacherSubjectsTable.teacherUserId, userId), eq(schoolTeacherSubjectsTable.schoolId, schoolId)));
    for (const r of rows) assigned.add(r.subject);
  }
  const role = access.member?.role ?? null;
  const classScoped = !adminCheck.ok && (role === "student" || role === "teacher");
  const classIds = new Set<string>();
  if (classScoped && access.member) {
    const mem = await db.select({ classId: schoolClassMembersTable.classId }).from(schoolClassMembersTable)
      .where(and(eq(schoolClassMembersTable.schoolMemberId, access.member.id), eq(schoolClassMembersTable.roleInClass, role === "teacher" ? "teacher" : "student")));
    for (const m of mem) classIds.add(m.classId);
    if (role === "teacher") {
      // کلاس‌هایی که در برنامهٔ هفتگی مدرسِ آن‌اند هم «کلاسِ قابل‌دسترسِ معلم» حساب می‌شوند.
      const slots = await db.select({ classId: schoolTimetableSlotsTable.classId }).from(schoolTimetableSlotsTable)
        .where(and(eq(schoolTimetableSlotsTable.schoolId, schoolId), eq(schoolTimetableSlotsTable.teacherUserId, userId)));
      for (const sl of slots) classIds.add(sl.classId);
    }
  }
  return {
    isMember: true,
    isAdmin: adminCheck.ok,
    role,
    memberId: access.member?.id ?? null,
    assigned,
    classIds,
    classScoped,
  };
}

/** admin، یا معلمِ تخصیص‌داده‌شده به همین درس — همان گیتِ موضوعیِ همیشگی. */
export function canManageSubjectName(scope: ContentScope, subjectName: string | null | undefined): boolean {
  if (scope.isAdmin) return true;
  return !!subjectName && scope.assigned.has(subjectName);
}

export interface ContentContext {
  subjectsByName: Map<string, typeof schoolSubjectsTable.$inferSelect>;
  /** نامِ درس → کلاس‌هایِ مجاز (فقط کلاس‌هایِ *موجود*). نبودنِ کلید = همهٔ کلاس‌ها. */
  subjectClassesByName: Map<string, Set<string>>;
  lessonsById: Map<string, typeof schoolContentLessonsTable.$inferSelect>;
}

export async function loadContentContext(schoolId: string): Promise<ContentContext> {
  await ensureSchoolSubjectsSeeded(schoolId);
  const [subjects, lessons, links] = await Promise.all([
    db.select().from(schoolSubjectsTable).where(eq(schoolSubjectsTable.schoolId, schoolId)),
    db.select().from(schoolContentLessonsTable).where(eq(schoolContentLessonsTable.schoolId, schoolId)),
    // فقط کلاس‌هایِ موجودِ همین مدرسه (ردیفِ کلاسِ حذف‌شده نباید درس را برایِ همه پنهان کند).
    db.select({ subjectId: schoolSubjectClassesTable.subjectId, classId: schoolSubjectClassesTable.classId })
      .from(schoolSubjectClassesTable)
      .innerJoin(schoolClassesTable, eq(schoolClassesTable.id, schoolSubjectClassesTable.classId))
      .where(eq(schoolClassesTable.schoolId, schoolId)),
  ]);
  const nameById = new Map<string, string>(subjects.map((s: any) => [s.id, s.name]));
  const subjectClassesByName = new Map<string, Set<string>>();
  for (const l of links as any[]) {
    const n = nameById.get(l.subjectId);
    if (!n) continue;
    (subjectClassesByName.get(n) ?? subjectClassesByName.set(n, new Set()).get(n)!).add(l.classId);
  }
  return {
    subjectClassesByName,
    subjectsByName: new Map(subjects.map((s: any) => [s.name, s])),
    lessonsById: new Map(lessons.map((l: any) => [l.id, l])),
  };
}

export function effectiveTypesForLesson(lesson: { subject: string; enabledTypes: string[] | null }, ctx: ContentContext): string[] | null {
  return effectiveTypes(lesson.enabledTypes, ctx.subjectsByName.get(lesson.subject)?.enabledTypes);
}

/**
 * آیا این درس برایِ این کاربر «وجود دارد»؟ درسِ بدونِ محدودیتِ کلاس = برایِ همه. با محدودیت: دانش‌آموز/معلم فقط اگر در یکی
 * از کلاس‌هایِ مجازِ درس باشند؛ معلمِ تخصیص‌داده‌شده به همان درس همیشه می‌بیند (تا بتواند مدیریتش کند). مدیر/معاون/مشاور/والد: بی‌قید.
 */
export function subjectVisibleTo(subjectName: string | null | undefined, ctx: ContentContext, scope: ContentScope): boolean {
  if (!subjectName || scope.isAdmin || !scope.classScoped) return true;
  const allowed = ctx.subjectClassesByName.get(subjectName);
  if (!allowed || allowed.size === 0) return true;
  if (scope.assigned.has(subjectName)) return true;
  for (const c of scope.classIds) if (allowed.has(c)) return true;
  return false;
}

export function itemVisibleTo(
  item: { type: string; lessonId: string | null; subject: string | null },
  ctx: ContentContext,
  scope: ContentScope,
): boolean {
  if (scope.isAdmin) return true;
  const lesson = item.lessonId ? ctx.lessonsById.get(item.lessonId) : undefined;
  const subjectName = lesson?.subject ?? item.subject;
  if (!subjectVisibleTo(subjectName, ctx, scope)) return false;
  if (canManageSubjectName(scope, subjectName)) return true;
  const eff = lesson
    ? effectiveTypesForLesson(lesson, ctx)
    : subjectName
      ? effectiveTypes(null, ctx.subjectsByName.get(subjectName)?.enabledTypes)
      : null;
  return eff === null || eff.includes(item.type);
}

export interface LessonStat {
  typeCounts: Record<string, number>;
  /** تسلطِ دانش‌آموز: آیتم‌هایِ قابلِ‌مطالعه‌ای که آخرین رتبه‌اش «بلدم» است. */
  mastered: Record<string, number>;
}

/**
 * یک query تجمیعی (بدونِ N+1) برایِ شمارشِ آیتم‌ها به‌ازایِ (درس، type) و
 * تعدادِ «بلدم»هایِ همین کاربر.
 */
export async function loadLessonStats(schoolId: string, memberId: string | null): Promise<Map<string, LessonStat>> {
  const rows = await db.select({
    lessonId: schoolContentItemsTable.lessonId,
    type: schoolContentItemsTable.type,
    total: sql<number>`count(*)::int`,
    mastered: sql<number>`count(${schoolContentProgressTable.id}) filter (where ${schoolContentProgressTable.lastRating} = 'know')::int`,
  })
    .from(schoolContentItemsTable)
    .leftJoin(schoolContentProgressTable, and(
      eq(schoolContentProgressTable.contentItemId, schoolContentItemsTable.id),
      eq(schoolContentProgressTable.studentMemberId, memberId ?? "-"),
    ))
    .where(and(eq(schoolContentItemsTable.schoolId, schoolId), isNotNull(schoolContentItemsTable.lessonId)))
    .groupBy(schoolContentItemsTable.lessonId, schoolContentItemsTable.type);
  const out = new Map<string, LessonStat>();
  for (const r of rows as any[]) {
    const st = out.get(r.lessonId) ?? { typeCounts: {}, mastered: {} };
    st.typeCounts[r.type] = r.total;
    st.mastered[r.type] = r.mastered;
    out.set(r.lessonId, st);
  }
  return out;
}

/** شکلِ پاسخِ یک جلسه‌یِ درس با فیلدهایِ مؤثر/شمارش/پیشرفت — مشترکِ لیست و جزئیات. */
export function describeLesson(
  l: typeof schoolContentLessonsTable.$inferSelect,
  ctx: ContentContext,
  scope: ContentScope,
  stats: Map<string, LessonStat>,
) {
  const canManage = canManageSubjectName(scope, l.subject);
  const eff = effectiveTypesForLesson(l, ctx) ?? [...SCHOOL_CONTENT_TYPE_KEYS];
  const st = stats.get(l.id);
  // نویسنده همه‌یِ typeها را (حتی خاموش) با شمارش می‌بیند؛ بقیه فقط typeهایِ روشن را.
  const visibleTypes = canManage ? [...SCHOOL_CONTENT_TYPE_KEYS] : eff;
  const typeCounts: Record<string, number> = {};
  for (const t of visibleTypes) typeCounts[t] = st?.typeCounts[t] ?? 0;
  let studyTotal = 0;
  let studyMastered = 0;
  for (const t of STUDY_TYPES) {
    if (!eff.includes(t)) continue;
    studyTotal += st?.typeCounts[t] ?? 0;
    studyMastered += st?.mastered[t] ?? 0;
  }
  return {
    id: l.id,
    schoolId: l.schoolId,
    subject: l.subject,
    title: l.title,
    sortOrder: l.sortOrder,
    enabledTypes: l.enabledTypes ?? null,
    effectiveEnabledTypes: eff,
    typeCounts,
    itemCount: Object.entries(typeCounts).reduce((n, [t, c]) => n + (eff.includes(t) ? c : 0), 0),
    progress: { mastered: studyMastered, total: studyTotal },
    canManage,
    createdByUserId: l.createdByUserId,
    createdAt: l.createdAt.toISOString(),
    updatedAt: l.updatedAt.toISOString(),
  };
}
