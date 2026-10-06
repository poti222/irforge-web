/**
 * components/super/superApi.ts — فراخوانی‌هایِ APIِ `/api/super/*` (api-server/src/routes/superDashboard.ts).
 * همه کوکیِ گیتِ رمزِ دومِ /super را می‌فرستند (`credentials: include`)؛ بدونِ آن سرور ۴۰۱ `super_gate_locked` می‌دهد.
 */
import { customFetch } from "@workspace/api-client-react";

export const SUPER_QUERY_ROOT = "super" as const;
const opts = { credentials: "include" as any };

export interface SuperSchool {
  id: string;
  name: string;
  slug: string | null;
  city: string | null;
  address: string | null;
  photoUrl: string | null;
  licenseInfo: string | null;
  isTestSchool: boolean;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  memberCount: number;
  /** تعدادِ اعضا به‌تفکیکِ نقش (admin/deputy/…/student/parent). */
  roles: Record<string, number>;
  classCount: number;
  adminCount: number;
  admins: { userId: string; name: string; email: string | null }[];
  bot: { telegramUsername: string | null } | null;
}

export interface SuperOverviewData {
  generatedAt: string;
  users: { total: number; newLast7d: number; byRole: Record<string, number> };
  bots: { total: number; byStatus: Record<string, number> };
  schools: { total: number; test: number; members: number };
  attention: {
    pendingWalletReceipts: number;
    cardPaymentsAwaitingReview: number;
    openTickets: number;
    pendingSignups: number;
    silentPaymentChannels: number;
  };
}

export interface SuperAuditItem {
  id: string;
  at: string;
  action: string;
  actor: string;
  actorUserId: string;
  target: string | null;
  targetUserId?: string | null;
  reason?: string | null;
  metadata?: unknown;
  schoolId?: string;
  schoolName?: string | null;
}

export interface SuperAuditPage {
  source: "admin" | "school";
  total: number;
  limit: number;
  offset: number;
  actions: string[];
  items: SuperAuditItem[];
}

export const listSuperSchools = () => customFetch<SuperSchool[]>("/api/super/schools", opts);
export const getSuperOverview = () => customFetch<SuperOverviewData>("/api/super/overview", opts);

export interface CreateSuperSchoolInput {
  name: string;
  city?: string;
  address?: string;
  licenseInfo?: string;
  isTestSchool?: boolean;
  adminEmail?: string;
}
export const createSuperSchool = (body: CreateSuperSchoolInput) =>
  customFetch<SuperSchool & { adminAssigned: string | null }>("/api/super/schools", { ...opts, method: "POST", body: JSON.stringify(body) });

export const updateSuperSchool = (id: string, body: Partial<Pick<SuperSchool, "name" | "city" | "address" | "licenseInfo" | "isTestSchool">>) =>
  customFetch<SuperSchool>(`/api/super/schools/${id}`, { ...opts, method: "PATCH", body: JSON.stringify(body) });

export const addSuperSchoolMember = (id: string, body: { email?: string; userId?: string; role: string; move?: boolean }) =>
  customFetch<{ ok: true; result: "created" | "updated" | "moved"; userId: string; role: string; schoolId: string }>(
    `/api/super/schools/${id}/members`, { ...opts, method: "POST", body: JSON.stringify(body) });

export function getSuperAudit(params: { source: "admin" | "school"; action?: string; q?: string; limit?: number; offset?: number }) {
  const qs = new URLSearchParams();
  qs.set("source", params.source);
  if (params.action) qs.set("action", params.action);
  if (params.q) qs.set("q", params.q);
  qs.set("limit", String(params.limit ?? 50));
  qs.set("offset", String(params.offset ?? 0));
  return customFetch<SuperAuditPage>(`/api/super/audit?${qs}`, opts);
}

/** نقش‌هایِ مدرسه‌ای (همان SCHOOL_MEMBER_ROLES سرور) با برچسبِ فارسی/انگلیسی. */
export const SCHOOL_ROLE_LABELS: Record<string, { fa: string; en: string }> = {
  admin: { fa: "مدیر", en: "Admin" },
  deputy: { fa: "معاون", en: "Deputy" },
  deputy_discipline: { fa: "معاون انضباطی", en: "Discipline deputy" },
  counselor: { fa: "مشاور", en: "Counselor" },
  teacher: { fa: "معلم", en: "Teacher" },
  student: { fa: "دانش‌آموز", en: "Student" },
  parent: { fa: "والد", en: "Parent" },
};
export const SCHOOL_ROLE_ORDER = ["admin", "deputy", "deputy_discipline", "counselor", "teacher", "student", "parent"] as const;

/** صفحاتِ مدیریتِ یک مدرسه (همان /schools/admin/* که برایِ سوپرادمین باز است). */
export const SCHOOL_ADMIN_LINKS: { path: string; fa: string; en: string }[] = [
  { path: "/schools/admin", fa: "مشخصات، کدهای معرف، باتِ مدرسه", en: "Details, invite codes, school bot" },
  { path: "/schools/admin/members", fa: "اعضا و نقش‌ها", en: "Members & roles" },
  { path: "/schools/admin/classes", fa: "کلاس‌ها", en: "Classes" },
  { path: "/schools/admin/programs", fa: "برنامه‌ها", en: "Programs" },
  { path: "/schools/announcements", fa: "اعلامیه‌ها", en: "Announcements" },
  { path: "/schools/admin/messages", fa: "پیام‌ها", en: "Messages" },
  { path: "/schools/admin/alerts", fa: "هشدارهای دانش‌آموز", en: "Student alerts" },
  { path: "/schools/admin/audit-log", fa: "تاریخچه‌یِ رخدادها", en: "Audit log" },
];
