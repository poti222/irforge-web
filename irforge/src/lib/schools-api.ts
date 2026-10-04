import { customFetch } from "@workspace/api-client-react";

/**
 * lib/schools-api.ts — انواع و هِلپرهای فراخوانیِ API بخش "/schools" (فاز ۱).
 * مطابقِ قراردادِ همین کدبیس (مثلاً pages/tickets.tsx)، مستقیم با `customFetch`
 * کار می‌کند، نه از طریقِ کلاینتِ تولیدشده‌ی orval — چون این یک دامنه‌ی تازه و
 * جدا از openapi.yaml موجود است، دقیقاً همان‌طور که تیکت‌ها هم هرگز به آن
 * اسپک اضافه نشدند.
 */

export const SCHOOL_MEMBER_ROLES = [
  "admin",
  "deputy",
  "deputy_discipline",
  "counselor",
  "teacher",
  "student",
  "parent",
] as const;
export type SchoolMemberRole = (typeof SCHOOL_MEMBER_ROLES)[number];

export interface SchoolSummary {
  id: string;
  name: string;
  slug: string | null;
  address: string | null;
  photoUrl: string | null;
  city: string | null;
  licenseInfo: string | null;
  /** فازِ ۱۰ (بندِ ۱.۳) — null یعنی پیش‌فرضِ ۳ در سرور. */
  consecutiveAbsenceAlertThreshold: number | null;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface SchoolMemberMe {
  id: string;
  userId: string;
  schoolId: string | null;
  role: SchoolMemberRole | null;
  grade: string | null;
  nationalId: string | null;
  birthDate: string | null;
  city: string | null;
  schoolNameFreeText: string | null;
  profileComplete: boolean;
  createdAt: string;
  updatedAt: string;
  school: SchoolSummary | null;
}

export interface SchoolOnboardingInput {
  role: SchoolMemberRole;
  grade?: string | null;
  nationalId?: string | null;
  birthDate?: string | null;
  city?: string | null;
  schoolNameFreeText?: string | null;
  inviteCode?: string | null;
}

export function getSchoolMe() {
  return customFetch<SchoolMemberMe | null>("/api/schools/me");
}

export function submitSchoolOnboarding(input: SchoolOnboardingInput) {
  return customFetch<SchoolMemberMe>("/api/schools/onboarding", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function lookupInviteCode(code: string) {
  return customFetch<{ school: SchoolSummary; role: SchoolMemberRole | null }>(
    `/api/schools/invite-codes/${encodeURIComponent(code)}`,
  );
}

export function createSchool(input: { name: string; address?: string; city?: string; licenseInfo?: string }) {
  return customFetch<SchoolSummary>("/api/schools", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateSchool(id: string, patch: Partial<{ name: string; address: string; city: string; licenseInfo: string; photoUrl: string | null; consecutiveAbsenceAlertThreshold: number | null }>) {
  return customFetch<SchoolSummary>(`/api/schools/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function createInviteCode(schoolId: string, role?: SchoolMemberRole | null, options?: { expiresAt?: string | null; maxUses?: number | null }) {
  return customFetch<InviteCode>(
    `/api/schools/${schoolId}/invite-codes`,
    { method: "POST", body: JSON.stringify({ role: role ?? null, expiresAt: options?.expiresAt ?? null, maxUses: options?.maxUses ?? null }) },
  );
}

/** "poem" اضافه شد طبقِ گزارشِ کاربر («شعر یا لغت») — کپیِ SCHOOL_CONTENT_TYPES در schema/schoolContent.ts */
export const SCHOOL_CONTENT_TYPES = ["dictionary", "note", "book", "formula", "poem"] as const;
export type SchoolContentType = (typeof SCHOOL_CONTENT_TYPES)[number];

/**
 * درس‌هایِ معمولِ دبیرستانِ ایران — کپیِ همان فهرستِ ثابتِ
 * `SCHOOL_SUBJECTS` در lib/db/src/schema/schoolContent.ts (این فایل طبقِ
 * قراردادِ خودش هیچ نوعی از بک‌اند import نمی‌کند، مثلِ SCHOOL_MEMBER_ROLES
 * بالا). فقط برایِ پیکرِ UI؛ ستونِ واقعی متنِ آزاد است.
 */
export const SCHOOL_SUBJECTS = [
  "ریاضی",
  "فیزیک",
  "شیمی",
  "زیست‌شناسی",
  "ادبیاتِ فارسی",
  "عربی",
  "زبانِ انگلیسی",
  "دینی",
  "تاریخ",
  "جغرافیا",
  "ورزش",
  "سایر",
] as const;
export type SchoolSubject = (typeof SCHOOL_SUBJECTS)[number];

export interface SchoolContentItem {
  id: string;
  schoolId: string | null;
  type: SchoolContentType;
  title: string;
  body: string;
  language: string | null;
  /** null = بدونِ‌درس (محتوایِ قدیمی یا عمداً عمومی) — فقط admin آن را می‌نویسد. */
  subject: string | null;
  /** فاز ۳ — فیلدِ URLِ عکس (نه آپلودِ واقعی، ببینید توضیحِ imageUrl در schema/schoolContent.ts) */
  imageUrl: string | null;
  /** فازِ «درس» — null یعنی بدونِ‌درس (پسودوگروهِ «بدون درس» در UI) */
  lessonId: string | null;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * `lessonId`: "none" یعنی فقط آیتم‌هایِ بدونِ‌درس؛ یک idِ واقعی یعنی فقط
 * آیتم‌هایِ همان درس (در این حالت می‌تواند هر typeی داشته باشد — صفحه‌ی
 * لایه‌ی درس خودش با type فیلتر نمی‌کند، ببینید pages/schools/content-lesson.tsx).
 */
export function listSchoolContent(type: SchoolContentType | undefined, schoolId?: string | null, subject?: string | null, lessonId?: string | null) {
  const params = new URLSearchParams();
  if (type) params.set("type", type);
  if (schoolId) params.set("schoolId", schoolId);
  if (subject) params.set("subject", subject);
  if (lessonId) params.set("lessonId", lessonId);
  return customFetch<SchoolContentItem[]>(`/api/schools/content?${params.toString()}`);
}

export function getSchoolContentItem(id: string) {
  return customFetch<SchoolContentItem>(`/api/schools/content/${id}`);
}

export function createSchoolContentItem(input: { type: SchoolContentType; title: string; body: string; language?: string | null; subject?: string | null; schoolId?: string | null; imageUrl?: string | null; lessonId?: string | null }) {
  return customFetch<SchoolContentItem>("/api/schools/content", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateSchoolContentItem(id: string, patch: Partial<{ title: string; body: string; language: string | null; subject: string | null; imageUrl: string | null; lessonId: string | null }>) {
  return customFetch<SchoolContentItem>(`/api/schools/content/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteSchoolContentItem(id: string) {
  return customFetch<void>(`/api/schools/content/${id}`, { method: "DELETE" });
}

/**
 * لایه‌یِ «درس» — گروه‌بندیِ آیتم‌هایِ کتابخانه‌ی محتوا (بالا) داخلِ یک درسِ
 * واحد، مستقل از typeِ هر آیتم (ببینید توضیحِ طراحی در
 * schema/schoolContentLessons.ts). خواندن برایِ هر عضوِ مدرسه؛ نوشتن
 * admin/teacherِ گیت‌شده با همان گیتِ موضوعیِ بالا.
 */
export interface SchoolContentLesson {
  id: string;
  schoolId: string;
  subject: string;
  title: string;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export function listContentLessons(schoolId: string, subject?: string | null) {
  const qs = subject ? `?subject=${encodeURIComponent(subject)}` : "";
  return customFetch<SchoolContentLesson[]>(`/api/schools/${schoolId}/content-lessons${qs}`);
}

export function getContentLesson(schoolId: string, lessonId: string) {
  return customFetch<SchoolContentLesson>(`/api/schools/${schoolId}/content-lessons/${lessonId}`);
}

export function createContentLesson(schoolId: string, input: { subject: string; title: string }) {
  return customFetch<SchoolContentLesson>(`/api/schools/${schoolId}/content-lessons`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/**
 * افزودنِ دسته‌ای — طبقِ گزارشِ مستقیمِ کاربر («به‌جایِ یکی‌یکی، چند خط با هم»).
 * فقط برایِ یک درسِ واقعی (subject از خودِ درس می‌آید، همان قاعده‌ی POSTِ تکی).
 */
export function bulkCreateSchoolContentItems(schoolId: string, input: { lessonId: string; type: SchoolContentType; entries: { title: string; body: string }[] }) {
  return customFetch<SchoolContentItem[]>(`/api/schools/${schoolId}/content/bulk`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateContentLesson(schoolId: string, lessonId: string, patch: Partial<{ title: string; subject: string }>) {
  return customFetch<SchoolContentLesson>(`/api/schools/${schoolId}/content-lessons/${lessonId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteContentLesson(schoolId: string, lessonId: string) {
  return customFetch<void>(`/api/schools/${schoolId}/content-lessons/${lessonId}`, { method: "DELETE" });
}

/**
 * حالتِ مطالعه/فلش‌کارت — پیشرفتِ سرور-محورِ هر کاربر رویِ آیتم‌هایِ یک درس
 * (ببینید schema/schoolContentProgress.ts در بک‌اند برایِ توضیحِ کاملِ طراحی:
 * این همان جایی است که نسخه‌ی قدیمیِ dars فقط localStorage داشت).
 */
export const SCHOOL_CONTENT_RATINGS = ["know", "practice"] as const;
export type SchoolContentRating = (typeof SCHOOL_CONTENT_RATINGS)[number];

export interface SchoolContentProgress {
  id: string;
  contentItemId: string;
  lastRating: SchoolContentRating;
  reviewCount: number;
  intervalDays: number;
  nextReviewAt: string;
  updatedAt: string;
}

export function listMyContentProgress(schoolId: string, lessonId: string) {
  return customFetch<SchoolContentProgress[]>(`/api/schools/${schoolId}/content-progress/my?lessonId=${encodeURIComponent(lessonId)}`);
}

export function rateContentProgress(schoolId: string, contentItemId: string, rating: SchoolContentRating) {
  return customFetch<SchoolContentProgress>(`/api/schools/${schoolId}/content-progress/rate`, {
    method: "POST",
    body: JSON.stringify({ contentItemId, rating }),
  });
}

/**
 * تخصیصِ معلم↔درس — کنترلِ دسترسیِ موضوعی به کتابخانه‌یِ محتوا (بخشِ بالا).
 * خواندن برایِ هر عضوِ مدرسه (پیکرِ انتخابِ درسِ فرمِ محتوا)؛ نوشتن فقط admin.
 */
export interface SchoolTeacherSubject {
  id: string;
  schoolId: string;
  teacherUserId: string;
  subject: string;
  classId: string | null;
  createdAt: string;
}

export function listTeacherSubjects(schoolId: string, teacherUserId?: string) {
  const qs = teacherUserId ? `?teacherUserId=${encodeURIComponent(teacherUserId)}` : "";
  return customFetch<SchoolTeacherSubject[]>(`/api/schools/${schoolId}/teacher-subjects${qs}`);
}

export function assignTeacherSubject(schoolId: string, input: { teacherUserId: string; subject: string; classId?: string | null }) {
  return customFetch<SchoolTeacherSubject>(`/api/schools/${schoolId}/teacher-subjects`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function revokeTeacherSubject(schoolId: string, id: string) {
  return customFetch<void>(`/api/schools/${schoolId}/teacher-subjects/${id}`, { method: "DELETE" });
}

/**
 * ─── فاز ۲ ──────────────────────────────────────────────────────────────
 * مدیریتِ اعضا، کلاس‌ها، برنامه‌ها، اعلامیه‌ها، مشاور، والد، چندمدرسه‌ایِ مدیر.
 */

export interface InviteCode {
  id: string;
  schoolId: string;
  code: string;
  role: SchoolMemberRole | null;
  active: boolean;
  /** فازِ ۹ (بندِ ۲) */
  expiresAt: string | null;
  maxUses: number | null;
  usesCount: number;
  createdAt: string;
}

export function listInviteCodes(schoolId: string) {
  return customFetch<InviteCode[]>(`/api/schools/${schoolId}/invite-codes`);
}

export function toggleInviteCode(schoolId: string, codeId: string, active: boolean) {
  return customFetch<InviteCode>(`/api/schools/${schoolId}/invite-codes/${codeId}`, {
    method: "PATCH",
    body: JSON.stringify({ active }),
  });
}

export interface SchoolMemberWithUser extends Omit<SchoolMemberMe, "school"> {
  userName: string | null;
  userEmail: string | null;
  /** `/super` بخشِ C — true فقط برایِ حساب‌هایِ آزمایشیِ ساخته‌شده از پنلِ سوپرادمین. */
  isPlatformTestAccount?: boolean;
}

export function listSchoolMembers(schoolId: string) {
  return customFetch<SchoolMemberWithUser[]>(`/api/schools/${schoolId}/members`);
}

export function updateSchoolMember(schoolId: string, memberId: string, patch: { role?: SchoolMemberRole | null; grade?: string | null }) {
  return customFetch<SchoolMemberMe>(`/api/schools/${schoolId}/members/${memberId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function removeSchoolMember(schoolId: string, memberId: string) {
  return customFetch<void>(`/api/schools/${schoolId}/members/${memberId}`, { method: "DELETE" });
}

export function listMySchools() {
  return customFetch<SchoolSummary[]>("/api/schools/my-schools");
}

export function addSchoolAdmin(schoolId: string, userId: string) {
  return customFetch<unknown>(`/api/schools/${schoolId}/admins`, {
    method: "POST",
    body: JSON.stringify({ userId }),
  });
}

export interface SchoolClass {
  id: string;
  schoolId: string;
  name: string;
  grade: string | null;
  academicYear: string | null;
  createdAt: string;
}

export interface SchoolClassMember {
  id: string;
  classId: string;
  schoolMemberId: string;
  roleInClass: "student" | "teacher";
  addedAt: string;
}

export function listSchoolClasses(schoolId: string, mine?: boolean) {
  return customFetch<SchoolClass[]>(`/api/schools/${schoolId}/classes${mine ? "?mine=true" : ""}`);
}

export function createSchoolClass(schoolId: string, input: { name: string; grade?: string | null; academicYear?: string | null }) {
  return customFetch<SchoolClass>(`/api/schools/${schoolId}/classes`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateSchoolClass(schoolId: string, classId: string, patch: Partial<{ name: string; grade: string | null; academicYear: string | null }>) {
  return customFetch<SchoolClass>(`/api/schools/${schoolId}/classes/${classId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteSchoolClass(schoolId: string, classId: string) {
  return customFetch<void>(`/api/schools/${schoolId}/classes/${classId}`, { method: "DELETE" });
}

export function listClassMembers(schoolId: string, classId: string) {
  return customFetch<SchoolClassMember[]>(`/api/schools/${schoolId}/classes/${classId}/members`);
}

export function addClassMember(schoolId: string, classId: string, input: { schoolMemberId: string; roleInClass?: "student" | "teacher" }) {
  return customFetch<SchoolClassMember>(`/api/schools/${schoolId}/classes/${classId}/members`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function removeClassMember(schoolId: string, classId: string, memberId: string) {
  return customFetch<void>(`/api/schools/${schoolId}/classes/${classId}/members/${memberId}`, { method: "DELETE" });
}

export interface SchoolProgram {
  id: string;
  schoolId: string;
  classId: string | null;
  title: string;
  description: string | null;
  dayOfWeek: string | null;
  startTime: string | null;
  endTime: string | null;
  createdByUserId: string;
  createdAt: string;
}

export function listSchoolPrograms(schoolId: string) {
  return customFetch<SchoolProgram[]>(`/api/schools/${schoolId}/programs`);
}

export function createSchoolProgram(schoolId: string, input: { title: string; description?: string | null; classId?: string | null; dayOfWeek?: string | null; startTime?: string | null; endTime?: string | null }) {
  return customFetch<SchoolProgram>(`/api/schools/${schoolId}/programs`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function deleteSchoolProgram(schoolId: string, programId: string) {
  return customFetch<void>(`/api/schools/${schoolId}/programs/${programId}`, { method: "DELETE" });
}

export const SCHOOL_ANNOUNCEMENT_KINDS = ["broadcast", "closure", "class"] as const;
export type SchoolAnnouncementKind = (typeof SCHOOL_ANNOUNCEMENT_KINDS)[number];

export interface SchoolAnnouncement {
  id: string;
  schoolId: string;
  classId: string | null;
  authorUserId: string;
  kind: SchoolAnnouncementKind;
  title: string;
  body: string;
  createdAt: string;
}

export function listSchoolAnnouncements(schoolId: string, classId?: string) {
  const params = classId ? `?classId=${encodeURIComponent(classId)}` : "";
  return customFetch<SchoolAnnouncement[]>(`/api/schools/${schoolId}/announcements${params}`);
}

export function createSchoolAnnouncement(schoolId: string, input: { kind: SchoolAnnouncementKind; title: string; body?: string; classId?: string }) {
  return customFetch<SchoolAnnouncement>(`/api/schools/${schoolId}/announcements`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export interface CounselorStudent {
  id: string;
  userId: string;
  grade: string | null;
  city: string | null;
  /** فازِ ۹ (بندِ ۱) */
  unread: boolean;
}

export interface CounselorNote {
  id: string;
  counselorUserId: string;
  studentMemberId: string;
  note: string;
  createdAt: string;
}

export function listCounselorStudents(schoolId: string) {
  return customFetch<CounselorStudent[]>(`/api/schools/${schoolId}/counselor/students`);
}

export function listCounselorNotes(schoolId: string, studentMemberId: string) {
  return customFetch<CounselorNote[]>(`/api/schools/${schoolId}/counselor/students/${studentMemberId}/notes`);
}

export function createCounselorNote(schoolId: string, studentMemberId: string, note: string) {
  return customFetch<CounselorNote>(`/api/schools/${schoolId}/counselor/students/${studentMemberId}/notes`, {
    method: "POST",
    body: JSON.stringify({ note }),
  });
}

export function createGuardianship(schoolId: string, input: { parentUserId: string; studentMemberId: string }) {
  return customFetch<unknown>(`/api/schools/${schoolId}/guardianships`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/**
 * ─── فاز ۳ ──────────────────────────────────────────────────────────────
 * تکالیفِ معلم + ارسالِ دانش‌آموز.
 */

export interface SchoolAssignment {
  id: string;
  classId: string;
  teacherUserId: string;
  title: string;
  description: string | null;
  dueDate: string | null;
  createdAt: string;
}

export interface SchoolAssignmentSubmission {
  id: string;
  assignmentId: string;
  studentMemberId: string;
  content: string;
  submittedAt: string | null;
  grade: string | null;
  feedback: string | null;
  createdAt: string;
}

export function listSchoolAssignments(schoolId: string, classId?: string) {
  const params = classId ? `?classId=${encodeURIComponent(classId)}` : "";
  return customFetch<SchoolAssignment[]>(`/api/schools/${schoolId}/assignments${params}`);
}

export function createSchoolAssignment(schoolId: string, input: { classId: string; title: string; description?: string | null; dueDate?: string | null }) {
  return customFetch<SchoolAssignment>(`/api/schools/${schoolId}/assignments`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function listAssignmentSubmissions(schoolId: string, assignmentId: string) {
  return customFetch<SchoolAssignmentSubmission[]>(`/api/schools/${schoolId}/assignments/${assignmentId}/submissions`);
}

export function getMyAssignmentSubmission(schoolId: string, assignmentId: string) {
  return customFetch<SchoolAssignmentSubmission | null>(`/api/schools/${schoolId}/assignments/${assignmentId}/my-submission`);
}

export function submitAssignment(schoolId: string, assignmentId: string, content: string) {
  return customFetch<SchoolAssignmentSubmission>(`/api/schools/${schoolId}/assignments/${assignmentId}/submissions`, {
    method: "POST",
    body: JSON.stringify({ content }),
  });
}

export function gradeAssignmentSubmission(schoolId: string, assignmentId: string, submissionId: string, patch: { grade?: string | null; feedback?: string | null }) {
  return customFetch<SchoolAssignmentSubmission>(`/api/schools/${schoolId}/assignments/${assignmentId}/submissions/${submissionId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

/**
 * ─── فاز ۴ ──────────────────────────────────────────────────────────────
 * گزارش/برنامه/چتِ مشاور + بانکِ سؤال و آزمون.
 */

export interface CounselorReport {
  id: string;
  schoolId: string;
  counselorUserId: string;
  studentMemberId: string | null;
  title: string;
  body: string;
  createdAt: string;
}

export function listCounselorReports(schoolId: string) {
  return customFetch<CounselorReport[]>(`/api/schools/${schoolId}/counselor/reports`);
}

export function createCounselorReport(schoolId: string, input: { title: string; body: string; studentMemberId?: string | null }) {
  return customFetch<CounselorReport>(`/api/schools/${schoolId}/counselor/reports`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export interface CounselorScheduleSlot {
  id: string;
  schoolId: string;
  counselorUserId: string | null;
  title: string;
  description: string | null;
  dayOfWeek: string | null;
  startTime: string | null;
  endTime: string | null;
  createdAt: string;
}

export function listCounselorSchedule(schoolId: string, counselorUserId?: string) {
  const params = counselorUserId ? `?counselorUserId=${encodeURIComponent(counselorUserId)}` : "";
  return customFetch<CounselorScheduleSlot[]>(`/api/schools/${schoolId}/counselor/schedule${params}`);
}

export function createCounselorScheduleSlot(schoolId: string, input: { dayOfWeek: string; startTime: string; endTime: string; note?: string | null }) {
  return customFetch<CounselorScheduleSlot>(`/api/schools/${schoolId}/counselor/schedule`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function deleteCounselorScheduleSlot(schoolId: string, id: string) {
  return customFetch<void>(`/api/schools/${schoolId}/counselor/schedule/${id}`, { method: "DELETE" });
}

export interface SchoolCounselor {
  userId: string;
}

export function listSchoolCounselors(schoolId: string) {
  return customFetch<SchoolCounselor[]>(`/api/schools/${schoolId}/counselor/list`);
}

export interface CounselorMessage {
  id: string;
  schoolId: string;
  counselorUserId: string;
  studentMemberId: string;
  senderUserId: string;
  body: string;
  createdAt: string;
}

export function listCounselorMessages(schoolId: string, counselorUserId: string, studentMemberId: string) {
  const params = new URLSearchParams({ counselorUserId, studentMemberId });
  return customFetch<CounselorMessage[]>(`/api/schools/${schoolId}/counselor/messages?${params.toString()}`);
}

export function sendCounselorMessage(schoolId: string, input: { counselorUserId: string; studentMemberId: string; body: string }) {
  return customFetch<CounselorMessage>(`/api/schools/${schoolId}/counselor/messages`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export interface SchoolQuestion {
  id: string;
  schoolId: string;
  teacherUserId: string;
  questionText: string;
  choices: string[] | null;
  correctAnswer: string | null;
  createdAt: string;
}

export function listSchoolQuestions(schoolId: string) {
  return customFetch<SchoolQuestion[]>(`/api/schools/${schoolId}/questions`);
}

export function createSchoolQuestion(schoolId: string, input: { questionText: string; choices?: string[] | null; correctAnswer?: string | null }) {
  return customFetch<SchoolQuestion>(`/api/schools/${schoolId}/questions`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function deleteSchoolQuestion(schoolId: string, id: string) {
  return customFetch<void>(`/api/schools/${schoolId}/questions/${id}`, { method: "DELETE" });
}

export interface SchoolExam {
  id: string;
  classId: string;
  teacherUserId: string;
  title: string;
  questionIds: string[];
  scheduledAt: string | null;
  durationMinutes: number | null;
  /** فازِ ۱۰ (بندِ ۲.۲) */
  randomizeOrder: boolean;
  createdAt: string;
}

export interface ExamQuestion {
  id: string;
  questionText: string;
  choices: string[] | null;
  correctAnswer?: string | null;
}

/** فازِ ۱۰ (بندِ ۲.۱) — یک سؤال از دیدِ نتیجه؛ correct/pointsAwarded هر دو null یعنی «هنوز نمره‌دهی نشده (تشریحی)». */
export interface ExamAnswerBreakdownEntry {
  questionId: string;
  correct: boolean | null;
  pointsAwarded: number | null;
}

export interface ExamAttempt {
  id: string;
  examId: string;
  studentMemberId: string;
  answers: Record<string, string>;
  score: string | null;
  /** فازِ ۱۰ (بندِ ۲.۱) */
  answerBreakdown: ExamAnswerBreakdownEntry[] | null;
  /** فازِ ۱۰ (بندِ ۲.۲) — فقط وقتی exam.randomizeOrder باشد پر می‌شود. */
  questionOrder: string[] | null;
  startedAt: string;
  submittedAt: string | null;
  /** فازِ ۶ (بندِ ۳): ارسال بعد از پایانِ durationMinutes بوده؟ */
  lateSubmission: boolean;
}

export function listSchoolExams(schoolId: string, classId: string) {
  return customFetch<SchoolExam[]>(`/api/schools/${schoolId}/exams?classId=${encodeURIComponent(classId)}`);
}

export function createSchoolExam(schoolId: string, input: { classId: string; title: string; questionIds: string[]; scheduledAt?: string | null; durationMinutes?: number | null; randomizeOrder?: boolean }) {
  return customFetch<SchoolExam>(`/api/schools/${schoolId}/exams`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export interface ExamAnalytics {
  submittedCount: number;
  gradedCount: number;
  average: number | null;
  highest: number | null;
  lowest: number | null;
  distribution: { range: string; count: number }[];
}

export function getExamAnalytics(schoolId: string, examId: string) {
  return customFetch<ExamAnalytics>(`/api/schools/${schoolId}/exams/${examId}/analytics`);
}

export function listExamQuestions(schoolId: string, examId: string) {
  return customFetch<ExamQuestion[]>(`/api/schools/${schoolId}/exams/${examId}/questions`);
}

export function listExamAttempts(schoolId: string, examId: string) {
  return customFetch<ExamAttempt[]>(`/api/schools/${schoolId}/exams/${examId}/attempts`);
}

export function getMyExamAttempt(schoolId: string, examId: string) {
  return customFetch<ExamAttempt | null>(`/api/schools/${schoolId}/exams/${examId}/my-attempt`);
}

export function startExamAttempt(schoolId: string, examId: string) {
  return customFetch<ExamAttempt>(`/api/schools/${schoolId}/exams/${examId}/attempts/start`, { method: "POST" });
}

export function submitExamAttempt(schoolId: string, examId: string, answers: Record<string, string>) {
  return customFetch<ExamAttempt>(`/api/schools/${schoolId}/exams/${examId}/attempts/submit`, {
    method: "POST",
    body: JSON.stringify({ answers }),
  });
}

/** نمره‌دهیِ خامِ قدیمی — فقط برایِ fallback (وقتی آزمون اصلاً سؤالِ ثبت‌شده‌ای ندارد). ترجیحاً gradeExamQuestions را بزنید. */
export function gradeExamAttempt(schoolId: string, examId: string, attemptId: string, score: string | null) {
  return customFetch<ExamAttempt>(`/api/schools/${schoolId}/exams/${examId}/attempts/${attemptId}`, {
    method: "PATCH",
    body: JSON.stringify({ score }),
  });
}

/** فازِ ۱۰ (بندِ ۲.۱): نمره‌ی هر سؤالِ تشریحی به‌تنهایی — نمره‌ی تجمیعی (score) خودکار از این‌ها بازساخته می‌شود. */
export function gradeExamQuestions(schoolId: string, examId: string, attemptId: string, questionPoints: Record<string, number>) {
  return customFetch<ExamAttempt>(`/api/schools/${schoolId}/exams/${examId}/attempts/${attemptId}`, {
    method: "PATCH",
    body: JSON.stringify({ questionPoints }),
  });
}

/** فازِ ۵ (بندِ ۳): بازنشانیِ تلاشِ دانش‌آموز تا دوباره بتواند آزمون را شروع کند. */
export function resetExamAttempt(schoolId: string, examId: string, attemptId: string) {
  return customFetch<void>(`/api/schools/${schoolId}/exams/${examId}/attempts/${attemptId}`, { method: "DELETE" });
}

/**
 * ─── فاز ۵ ──────────────────────────────────────────────────────────────
 * ارتباط با مدیر (رشته‌ی مشترک به‌ازایِ هر دانش‌آموز) + ارتباط با معلم (۱:۱،
 * فقط معلم‌هایِ واقعیِ کلاس‌هایِ دانش‌آموز).
 */

export interface AdminMessage {
  id: string;
  schoolId: string;
  studentMemberId: string;
  senderUserId: string;
  body: string;
  createdAt: string;
}

export interface AdminMessageThread {
  studentMemberId: string;
  studentUserName: string | null;
  studentUserEmail: string | null;
  lastMessage: AdminMessage;
  messageCount: number;
  /** فازِ ۹ (بندِ ۱) */
  unread: boolean;
}

export function listAdminMessages(schoolId: string, studentMemberId: string) {
  return customFetch<AdminMessage[]>(`/api/schools/${schoolId}/admin-messages/${studentMemberId}`);
}

export function sendAdminMessage(schoolId: string, studentMemberId: string, body: string) {
  return customFetch<AdminMessage>(`/api/schools/${schoolId}/admin-messages/${studentMemberId}`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

export function listAdminMessageThreads(schoolId: string) {
  return customFetch<AdminMessageThread[]>(`/api/schools/${schoolId}/admin-messages`);
}

export interface TeacherMessage {
  id: string;
  schoolId: string;
  teacherUserId: string;
  studentMemberId: string;
  senderUserId: string;
  body: string;
  createdAt: string;
}

export interface MyTeacherContact {
  teacherUserId: string;
  userName: string | null;
  userEmail: string | null;
}

export interface TeacherMessageThread {
  studentMemberId: string;
  studentUserName: string | null;
  studentUserEmail: string | null;
  lastMessage: TeacherMessage;
  messageCount: number;
  /** فازِ ۹ (بندِ ۱) */
  unread: boolean;
}

export function listMyTeachers(schoolId: string) {
  return customFetch<MyTeacherContact[]>(`/api/schools/${schoolId}/teacher-messages/my-teachers`);
}

export function listTeacherMessageThreads(schoolId: string) {
  return customFetch<TeacherMessageThread[]>(`/api/schools/${schoolId}/teacher-messages/inbox`);
}

export function listTeacherMessages(schoolId: string, teacherUserId: string, studentMemberId: string) {
  const params = new URLSearchParams({ teacherUserId, studentMemberId });
  return customFetch<TeacherMessage[]>(`/api/schools/${schoolId}/teacher-messages?${params.toString()}`);
}

export function sendTeacherMessage(schoolId: string, input: { teacherUserId: string; studentMemberId: string; body: string }) {
  return customFetch<TeacherMessage>(`/api/schools/${schoolId}/teacher-messages`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/**
 * ─── فاز ۹ (بندِ ۱) ─────────────────────────────────────────────────────
 * وضعیتِ خوانده‌شدنِ رشته‌ها. سازنده‌هایِ threadKey باید عیناً با
 * api-server/src/lib/schoolMessageReadState.ts یکی بمانند.
 */
export function adminThreadKey(schoolId: string, studentMemberId: string): string {
  return `admin:${schoolId}:${studentMemberId}`;
}
export function teacherThreadKey(schoolId: string, teacherUserId: string, studentMemberId: string): string {
  return `teacher:${schoolId}:${teacherUserId}:${studentMemberId}`;
}
export function counselorThreadKey(schoolId: string, counselorUserId: string, studentMemberId: string): string {
  return `counselor:${schoolId}:${counselorUserId}:${studentMemberId}`;
}

export function markThreadRead(schoolId: string, threadKey: string) {
  return customFetch<void>(`/api/schools/${schoolId}/message-read-state`, {
    method: "POST",
    body: JSON.stringify({ threadKey }),
  });
}

/** ─── فاز ۹ (بندِ ۳): لاگِ رخدادهایِ مدیریتی ────────────────────────────── */
export interface SchoolAuditLogEntry {
  id: string;
  schoolId: string;
  actorUserId: string;
  actorName: string | null;
  action: string;
  targetDescription: string;
  createdAt: string;
}

export function listSchoolAuditLog(schoolId: string) {
  return customFetch<SchoolAuditLogEntry[]>(`/api/schools/${schoolId}/audit-log`);
}

export interface MyChild {
  id: string;
  grade: string | null;
  city: string | null;
  school: { id: string; name: string } | null;
}

export function listMyChildren() {
  return customFetch<MyChild[]>("/api/schools/my-children");
}

/**
 * ─── فاز ۶ ──────────────────────────────────────────────────────────────
 * حضور و غیاب، نمره‌نامه‌ی ترکیبی، پنجره‌ی زمانیِ آزمون، اخطار/هشدارِ
 * دانش‌آموز، و داشبوردِ ترکیبیِ والد.
 */

export const ATTENDANCE_STATUSES = ["present", "absent", "late", "excused"] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export interface AttendanceRecord {
  id: string;
  classId: string;
  studentMemberId: string;
  date: string;
  status: AttendanceStatus;
  markedByUserId: string;
  note: string | null;
  createdAt: string;
}

export function markAttendance(schoolId: string, input: { classId: string; date: string; entries: { studentMemberId: string; status: AttendanceStatus; note?: string | null }[] }) {
  return customFetch<AttendanceRecord[]>(`/api/schools/${schoolId}/attendance`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function listClassAttendance(schoolId: string, classId: string, params?: { date?: string; from?: string; to?: string }) {
  const qs = new URLSearchParams({ classId, ...(params?.date ? { date: params.date } : {}), ...(params?.from ? { from: params.from } : {}), ...(params?.to ? { to: params.to } : {}) });
  return customFetch<AttendanceRecord[]>(`/api/schools/${schoolId}/attendance?${qs.toString()}`);
}

export function listMyAttendance(schoolId: string, params?: { from?: string; to?: string }) {
  const qs = new URLSearchParams({ ...(params?.from ? { from: params.from } : {}), ...(params?.to ? { to: params.to } : {}) });
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return customFetch<AttendanceRecord[]>(`/api/schools/${schoolId}/attendance/my${suffix}`);
}

export function listChildAttendance(schoolId: string, studentMemberId: string, params?: { from?: string; to?: string }) {
  const qs = new URLSearchParams({ ...(params?.from ? { from: params.from } : {}), ...(params?.to ? { to: params.to } : {}) });
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return customFetch<AttendanceRecord[]>(`/api/schools/${schoolId}/attendance/child/${studentMemberId}${suffix}`);
}

/**
 * فازِ ۱۰ (بندِ ۱.۱): دکمه‌ی «کپی از روز قبل» — اول نزدیک‌ترین تاریخِ ثبت‌شده‌ی
 * قبل از `before` را پیدا می‌کند، بعد خودِ فرانت با listClassAttendance همان
 * تاریخ را می‌خواند و پیش‌نویسِ امروز را از آن پر می‌کند (ارسالِ خودکار نیست).
 */
export function getPreviousAttendanceDate(schoolId: string, classId: string, before: string) {
  return customFetch<{ date: string } | null>(
    `/api/schools/${schoolId}/attendance/previous-date?classId=${encodeURIComponent(classId)}&before=${encodeURIComponent(before)}`,
  );
}

/** فازِ ۱۰ (بندِ ۱.۴): لینکِ دانلودِ CSV. */
export function attendanceExportUrl(schoolId: string, classId: string, params?: { from?: string; to?: string }) {
  const qs = new URLSearchParams({ classId, ...(params?.from ? { from: params.from } : {}), ...(params?.to ? { to: params.to } : {}) });
  return `/api/schools/${schoolId}/attendance/export?${qs.toString()}`;
}

/**
 * دانلودِ یک فایلِ پشتِ‌auth (CSV/…) — دقیقاً همان باگی که قبلاً در
 * use-authed-media.ts پیدا و رفع شد («زنده دیده شد … روی همین مسیر»):
 * این اندپوینت‌ها پشتِ requireAuth‌اند که فقط هدرِ `Authorization: Bearer`
 * قبول می‌کند (توکن در localStorage، نه کوکی — ببینید lib/auth-token.ts)،
 * ولی `window.open(url)`/`<a href=url>` یک ناوبریِ خامِ مرورگر است و هیچ‌وقت
 * هدرِ دلخواه نمی‌فرستد. دکمه‌ی «دانلودِ CSV» حضور و غیاب دقیقاً همین‌جا
 * می‌شکست: کلیک یک تبِ تازه با متنِ خامِ `{"error":"Unauthorized"}` باز
 * می‌کرد، نه فایلِ CSV — با curl بدونِ هدر روی سروِر واقعی تأیید شد (۴۰۱).
 * این هِلپر بایت‌ها را با customFetch (که توکن را خودش اضافه می‌کند) می‌گیرد
 * و خودش دانلود را با یک <a download> موقت می‌سازد.
 */
export async function downloadAuthedCsv(apiUrl: string, filename: string): Promise<void> {
  const blob = await customFetch<Blob>(apiUrl, { responseType: "blob" });
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
}

export interface GradeItem {
  itemType: "assignment" | "exam";
  itemId: string;
  itemTitle: string;
  classId: string;
  value: string | null;
}

export interface GradebookResult {
  items: GradeItem[];
  average: number | null;
}

export interface ClassGradebookRow {
  studentMemberId: string;
  items: GradeItem[];
  average: number | null;
}

export function getClassGradebook(schoolId: string, classId: string) {
  return customFetch<ClassGradebookRow[]>(`/api/schools/${schoolId}/gradebook/class/${classId}`);
}

export function getMyGradebook(schoolId: string) {
  return customFetch<GradebookResult>(`/api/schools/${schoolId}/gradebook/my`);
}

export function getChildGradebook(schoolId: string, studentMemberId: string) {
  return customFetch<GradebookResult>(`/api/schools/${schoolId}/gradebook/child/${studentMemberId}`);
}

/** کارنامه‌ی CSV — دانش‌آموز/والد، همان الگویِ attendanceExportUrl + downloadAuthedCsv بالا. */
export function myGradebookExportUrl(schoolId: string) {
  return `/api/schools/${schoolId}/gradebook/my/export`;
}

export function childGradebookExportUrl(schoolId: string, studentMemberId: string) {
  return `/api/schools/${schoolId}/gradebook/child/${studentMemberId}/export`;
}

export const ALERT_SEVERITIES = ["notice", "warning", "serious"] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export interface StudentAlert {
  id: string;
  schoolId: string;
  studentMemberId: string;
  issuedByUserId: string;
  severity: AlertSeverity;
  title: string;
  body: string;
  createdAt: string;
}

export function createStudentAlert(schoolId: string, input: { studentMemberId: string; severity: AlertSeverity; title: string; body: string }) {
  return customFetch<StudentAlert>(`/api/schools/${schoolId}/alerts`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function listSchoolAlerts(schoolId: string, studentMemberId?: string) {
  const suffix = studentMemberId ? `?studentMemberId=${encodeURIComponent(studentMemberId)}` : "";
  return customFetch<StudentAlert[]>(`/api/schools/${schoolId}/alerts${suffix}`);
}

export function listMyAlerts(schoolId: string) {
  return customFetch<StudentAlert[]>(`/api/schools/${schoolId}/alerts/my`);
}

export function listChildAlerts(schoolId: string, studentMemberId: string) {
  return customFetch<StudentAlert[]>(`/api/schools/${schoolId}/alerts/child/${studentMemberId}`);
}

/**
 * ─── فاز ۷ ──────────────────────────────────────────────────────────────
 * باتِ اطلاع‌رسانیِ مدرسه (خرید از کیف‌پول + رمزینه‌ی اختصاصی) و اتصالِ
 * تلگرام هر عضو به همان بات، بعلاوه‌ی دو تریگرِ درخواستیِ داشبوردِ مدیر.
 */

export interface SchoolBotStatus {
  purchased: boolean;
  telegramUsername: string | null;
  botId: string | null;
  /** قیمتِ محصول به تومان (null اگر محصول در حالِ حاضر فعال نیست). */
  priceToman: number | null;
}

export function getSchoolBotStatus(schoolId: string) {
  return customFetch<SchoolBotStatus>(`/api/schools/${schoolId}/bot`);
}

export function purchaseSchoolBot(schoolId: string) {
  return customFetch<SchoolBotStatus>(`/api/schools/${schoolId}/bot/purchase`, { method: "POST" });
}

export function createSchoolBotLinkToken(schoolId: string) {
  return customFetch<{ token: string; deepLink: string }>(`/api/schools/${schoolId}/bot/link-token`, { method: "POST" });
}

export function getSchoolBotSubscribed(schoolId: string) {
  return customFetch<{ subscribed: boolean }>(`/api/schools/${schoolId}/bot/subscribed`);
}

export interface SchoolAbsenceSummary {
  date: string;
  absent: number;
  late: number;
  classesTotal: number;
}

export function getSchoolAbsenceSummary(schoolId: string) {
  return customFetch<SchoolAbsenceSummary>(`/api/schools/${schoolId}/admin/absence-summary`);
}

export function checkUnmarkedAttendance(schoolId: string) {
  return customFetch<{ date: string; unmarkedClasses: { id: string; name: string }[] }>(
    `/api/schools/${schoolId}/admin/check-unmarked-attendance`,
    { method: "POST" },
  );
}

// ─── استخرِ توکنِ بات (سوپرادمینِ پلتفرم، نه پنلِ مدیرِ مدرسه) ─────────────

export interface SchoolBotPoolEntry {
  id: string;
  status: string;
  fingerprint: string | null;
  assignedSchoolId: string | null;
  assignedSchoolName: string | null;
  createdAt: string;
}

export function listSchoolBotPool() {
  return customFetch<SchoolBotPoolEntry[]>("/api/school-bot-pool");
}

export function addSchoolBotPoolToken(botToken: string) {
  return customFetch<SchoolBotPoolEntry>("/api/school-bot-pool", { method: "POST", body: JSON.stringify({ botToken }) });
}

export function deleteSchoolBotPoolToken(id: string) {
  return customFetch<void>(`/api/school-bot-pool/${id}`, { method: "DELETE" });
}

/** فازِ ۹ (بندِ ۴): آزادسازیِ دستیِ یک توکنِ گیرکرده/نامعتبر. */
export function releaseSchoolBotPoolToken(id: string) {
  return customFetch<SchoolBotPoolEntry & { releasedSchoolBotId: string | null }>(`/api/school-bot-pool/${id}/release`, { method: "POST" });
}

/** فازِ ۹ (بندِ ۴): جایگزینیِ توکنِ یک ردیف با توکنِ تازه، بدونِ از دست‌دادنِ هویتِ باتِ مدرسه. */
export function replaceSchoolBotPoolToken(id: string, botToken: string) {
  return customFetch<SchoolBotPoolEntry>(`/api/school-bot-pool/${id}/replace`, {
    method: "POST",
    body: JSON.stringify({ botToken }),
  });
}
