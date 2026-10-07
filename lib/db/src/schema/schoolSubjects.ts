/**
 * schema/schoolSubjects.ts — «درس‌ها»ِ هر مدرسه (ادبیات، ریاضی، ...) به‌صورتِ
 * ردیف‌هایِ واقعیِ دیتابیس، به‌جایِ فهرستِ ثابتِ `SCHOOL_SUBJECTS`.
 * ─────────────────────────────────────────────────────────────────────────
 * طبقِ گزارشِ مستقیمِ کاربر: مدیر باید بتواند درسِ تازه با نامِ دلخواه بسازد
 * و حذف کند، و معلم باید بتواند «انواعِ محتوا» (لغت‌نامه/شعر/فرمول/جزوه/کتاب)
 * را برایِ هر درس (و هر «جلسه‌ی درس») روشن/خاموش کند — مثلاً ادبیاتِ فارسی
 * فرمول ندارد، پس نباید برایِ دانش‌آموز اصلاً نمایش داده شود.
 *
 * ── چرا هنوز با «نام» (متنِ آزاد) به این جدول ارجاع می‌دهیم؟ ───────────────
 * ستون‌هایِ `subject` در school_content_lessons / school_content_items /
 * school_teacher_subjects همچنان TEXT می‌مانند (نه FK به id). دلیلش کم‌ریسک‌ترین
 * مسیر است: هیچ مایگریشنِ سنگینِ بازنویسیِ داده لازم نیست و کدِ موجود (گیتِ
 * موضوعیِ معلم، ...) دست‌نخورده کار می‌کند. هزینه‌اش این است که تغییرِ نامِ یک
 * درس باید هر سه ستون را در *یک تراکنش* هم‌گام کند (routes/schoolSubjects.ts).
 *
 * `enabledTypes` پیش‌فرضِ خودِ درس است؛ هر «جلسه‌ی درس» (school_content_lessons)
 * می‌تواند یک override داشته باشد (NULL = از درس ارث ببرد). مجموعه‌ی مؤثر =
 * `lesson.enabledTypes ?? subject.enabledTypes`.
 */
import { pgTable, text, timestamp, integer, jsonb, unique, primaryKey } from "drizzle-orm/pg-core";
import { SCHOOL_SUBJECTS } from "./schoolContent";

export const SCHOOL_CONTENT_TYPE_KEYS = ["dictionary", "poem", "formula", "note", "book"] as const;
export type SchoolContentTypeKey = (typeof SCHOOL_CONTENT_TYPE_KEYS)[number];

export const schoolSubjectsTable = pgTable("school_subjects", {
  id: text("id").primaryKey(),
  schoolId: text("school_id").notNull(),
  name: text("name").notNull(),
  /** کلیدِ آیکن از فهرستِ کوچکِ منتخب در فرانت (lib/schools-subject-style.ts) — NULL = پیش‌فرض */
  icon: text("icon"),
  /** کلیدِ رنگ از پالتِ منتخب — NULL = پیش‌فرض */
  color: text("color"),
  enabledTypes: jsonb("enabled_types").$type<string[]>().notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => ({
  uniqueName: unique("school_subjects_school_name_unique").on(t.schoolId, t.name),
}));

/**
 * کلاس‌هایی که یک درس در آن‌ها «وجود دارد». قرارداد: درسِ بدونِ هیچ ردیف = برایِ همهٔ کلاس‌ها (پیش‌فرض، پس درس‌هایِ موجود
 * دست‌نخورده‌اند)؛ با ردیف‌ها = فقط همان کلاس‌ها. اعمال سمتِ سرور: lib/schoolContentAccess.ts (subjectVisibleTo).
 */
export const schoolSubjectClassesTable = pgTable("school_subject_classes", {
  subjectId: text("subject_id").notNull(),
  classId: text("class_id").notNull(),
}, (t) => [primaryKey({ columns: [t.subjectId, t.classId] })]);

export type SchoolSubjectRow = typeof schoolSubjectsTable.$inferSelect;

/**
 * پیش‌فرضِ «درس‌هایِ معمولِ دبیرستان» — فقط برایِ seed (مدرسه‌یِ تازه و backfillِ
 * مایگریشن). `types` پیش‌فرضِ معقولِ هر درس است: مثلاً ریاضی/فیزیک/شیمی فرمول
 * دارند ولی لغت‌نامه/شعر نه؛ ادبیات و عربی شعر دارند ولی فرمول نه. مدیر/معلم
 * بعداً هر کدام را عوض می‌کند.
 * (مایگریشنِ api-server/migrate.mjs همین فهرست را با SQL تکرار می‌کند.)
 */
export const DEFAULT_SUBJECT_SEEDS: ReadonlyArray<{
  name: (typeof SCHOOL_SUBJECTS)[number];
  icon: string;
  color: string;
  types: readonly SchoolContentTypeKey[];
}> = [
  { name: "ریاضی", icon: "calculator", color: "blue", types: ["formula", "note", "book"] },
  { name: "فیزیک", icon: "atom", color: "violet", types: ["formula", "note", "book"] },
  { name: "شیمی", icon: "flask", color: "emerald", types: ["formula", "note", "book"] },
  { name: "زیست‌شناسی", icon: "leaf", color: "emerald", types: ["dictionary", "note", "book"] },
  { name: "ادبیاتِ فارسی", icon: "feather", color: "rose", types: ["dictionary", "poem", "note", "book"] },
  { name: "عربی", icon: "languages", color: "amber", types: ["dictionary", "poem", "note", "book"] },
  { name: "زبانِ انگلیسی", icon: "languages", color: "cyan", types: ["dictionary", "note", "book"] },
  { name: "دینی", icon: "scroll", color: "amber", types: ["dictionary", "note", "book"] },
  { name: "تاریخ", icon: "landmark", color: "orange", types: ["note", "book"] },
  { name: "جغرافیا", icon: "globe", color: "cyan", types: ["note", "book"] },
  { name: "ورزش", icon: "dumbbell", color: "orange", types: ["note", "book"] },
  { name: "سایر", icon: "book-open", color: "slate", types: ["dictionary", "poem", "formula", "note", "book"] },
];
