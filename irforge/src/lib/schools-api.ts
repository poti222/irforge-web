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

export function updateSchool(id: string, patch: Partial<{ name: string; address: string; city: string; licenseInfo: string; photoUrl: string | null }>) {
  return customFetch<SchoolSummary>(`/api/schools/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function createInviteCode(schoolId: string, role?: SchoolMemberRole | null) {
  return customFetch<{ id: string; schoolId: string; code: string; role: string | null; active: boolean; createdAt: string }>(
    `/api/schools/${schoolId}/invite-codes`,
    { method: "POST", body: JSON.stringify({ role: role ?? null }) },
  );
}

export const SCHOOL_CONTENT_TYPES = ["dictionary", "note", "book", "formula"] as const;
export type SchoolContentType = (typeof SCHOOL_CONTENT_TYPES)[number];

export interface SchoolContentItem {
  id: string;
  schoolId: string | null;
  type: SchoolContentType;
  title: string;
  body: string;
  language: string | null;
  /** فاز ۳ — فیلدِ URLِ عکس (نه آپلودِ واقعی، ببینید توضیحِ imageUrl در schema/schoolContent.ts) */
  imageUrl: string | null;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export function listSchoolContent(type: SchoolContentType, schoolId?: string | null) {
  const params = new URLSearchParams({ type });
  if (schoolId) params.set("schoolId", schoolId);
  return customFetch<SchoolContentItem[]>(`/api/schools/content?${params.toString()}`);
}

export function getSchoolContentItem(id: string) {
  return customFetch<SchoolContentItem>(`/api/schools/content/${id}`);
}

export function createSchoolContentItem(input: { type: SchoolContentType; title: string; body: string; language?: string | null; schoolId?: string | null; imageUrl?: string | null }) {
  return customFetch<SchoolContentItem>("/api/schools/content", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateSchoolContentItem(id: string, patch: Partial<{ title: string; body: string; language: string | null; imageUrl: string | null }>) {
  return customFetch<SchoolContentItem>(`/api/schools/content/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteSchoolContentItem(id: string) {
  return customFetch<void>(`/api/schools/content/${id}`, { method: "DELETE" });
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

export interface MyChild {
  id: string;
  grade: string | null;
  city: string | null;
  school: { id: string; name: string } | null;
}

export function listMyChildren() {
  return customFetch<MyChild[]>("/api/schools/my-children");
}
