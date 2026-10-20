import { customFetch } from "@workspace/api-client-react";

/**
 * lib/schools-reps-api.ts — هِلپرهایِ API «دانش‌آموزِ منتخب» (مسئولِ کلاس). مطابقِ قراردادِ schools-api.ts: مستقیم با customFetch.
 * بک‌اند: api-server/src/routes/schoolReps.ts.
 */

export type RepItemKind = "assignment" | "exam" | "reminder";
export type RepItemStatus = "active" | "cancelled" | "done";

export interface RepCandidate {
  memberId: string;
  userId: string;
  name: string;
  grade: string | null;
  /** id ردیفِ انتخابِ همین معلم (null = توسطِ همین معلم منتخب نیست). */
  repId: string | null;
  /** تعدادِ معلم‌هایی که او را منتخب کرده‌اند. */
  repCount: number;
  /** آیا دانش‌آموز به باتِ مدرسه وصل است (Start زده)؟ */
  botLinked: boolean;
}
export interface RepCandidatesResponse {
  botActive: boolean;
  maxPerTeacher: number;
  students: RepCandidate[];
}
export interface SchoolRep {
  id: string;
  classId: string;
  className: string;
  studentMemberId: string;
  studentName: string;
  teacherUserId: string;
  teacherName: string;
  mine: boolean;
  createdAt: string;
}
export interface RepItem {
  id: string;
  classId: string;
  className: string;
  kind: RepItemKind;
  title: string;
  /** YYYY-MM-DD */
  dueDate: string;
  remindDays: number[];
  status: RepItemStatus;
  createdAt: string;
  createdByName: string;
  groups: string[];
}
export interface BotGroup {
  id: string;
  title: string;
  botStatus: string;
  canPost: boolean;
  chatType: string;
}

export function listRepCandidates(schoolId: string, classId: string) {
  return customFetch<RepCandidatesResponse>(`/api/schools/${schoolId}/classes/${classId}/rep-candidates`);
}
export function electRep(schoolId: string, classId: string, studentMemberId: string) {
  return customFetch<{ id: string }>(`/api/schools/${schoolId}/classes/${classId}/reps`, {
    method: "POST",
    body: JSON.stringify({ studentMemberId }),
  });
}
export function removeRep(schoolId: string, repId: string, cancelItems = false) {
  return customFetch<{ ok: boolean; cancelledItems: number }>(`/api/schools/${schoolId}/reps/${repId}${cancelItems ? "?cancelItems=true" : ""}`, { method: "DELETE" });
}
export function listSchoolReps(schoolId: string) {
  return customFetch<SchoolRep[]>(`/api/schools/${schoolId}/reps`);
}
export function listRepItems(schoolId: string, classId?: string, status: RepItemStatus = "active") {
  const q = new URLSearchParams({ status });
  if (classId) q.set("classId", classId);
  return customFetch<RepItem[]>(`/api/schools/${schoolId}/rep-items?${q.toString()}`);
}
export function cancelRepItem(schoolId: string, itemId: string) {
  return customFetch<{ ok: boolean }>(`/api/schools/${schoolId}/rep-items/${itemId}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "cancelled" }),
  });
}
export function listBotGroups(schoolId: string) {
  return customFetch<{ botActive: boolean; groups: BotGroup[] }>(`/api/schools/${schoolId}/bot-groups`);
}
