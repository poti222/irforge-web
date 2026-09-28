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

export function updateSchool(id: string, patch: Partial<{ name: string; address: string; city: string; licenseInfo: string }>) {
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

export function createSchoolContentItem(input: { type: SchoolContentType; title: string; body: string; language?: string | null; schoolId?: string | null }) {
  return customFetch<SchoolContentItem>("/api/schools/content", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateSchoolContentItem(id: string, patch: Partial<{ title: string; body: string; language: string | null }>) {
  return customFetch<SchoolContentItem>(`/api/schools/content/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteSchoolContentItem(id: string) {
  return customFetch<void>(`/api/schools/content/${id}`, { method: "DELETE" });
}
