import { customFetch } from "@workspace/api-client-react";

/**
 * lib/schools-reminders-api.ts — هِلپرهایِ API «یادآورهایِ دانش‌آموزی». بک‌اند: api-server/src/routes/schoolReminders.ts.
 * قرارداد: weekdays شنبه=۰ … جمعه=۶ · times «HH:MM» به وقتِ تهران · تاریخ‌ها ISO `YYYY-MM-DD`.
 */
export type ReminderRole = "admin" | "teacher" | "rep";

export interface Reminder {
  id: string;
  classId: string | null;
  className: string | null;
  title: string;
  message: string;
  weekdays: number[];
  times: string[];
  startDate: string | null;
  endDate: string | null;
  skipDates: string[];
  sendDm: boolean;
  active: boolean;
  groupIds: string[];
  createdByUserId: string;
  createdByName: string;
  createdByRole: string;
  lastFiredAt: string | null;
  createdAt: string;
  updatedAt: string;
  scheduleText: string;
  nextRuns: { date: string; time: string; label: string }[];
}

export interface ReminderGroup { id: string; title: string; canPost: boolean; botStatus: string }
export interface RemindersResponse {
  role: ReminderRole;
  canSchoolWide: boolean;
  classes: { id: string; name: string }[];
  groups: ReminderGroup[];
  limits: { maxPerClass: number; maxTimes: number; maxMessage: number; maxTitle: number };
  reminders: Reminder[];
}
export interface ReminderInput {
  classId?: string | null;
  title?: string;
  message?: string;
  weekdays?: number[];
  times?: string[];
  startDate?: string | null;
  endDate?: string | null;
  skipDates?: string[];
  sendDm?: boolean;
  active?: boolean;
  groupIds?: string[];
}

const base = (schoolId: string) => `/api/schools/${schoolId}/reminders`;
export const listReminders = (schoolId: string) => customFetch<RemindersResponse>(base(schoolId));
export const createReminder = (schoolId: string, body: ReminderInput) =>
  customFetch<{ reminder: Reminder }>(base(schoolId), { method: "POST", body: JSON.stringify(body) });
export const updateReminder = (schoolId: string, id: string, body: ReminderInput) =>
  customFetch<{ reminder: Reminder }>(`${base(schoolId)}/${id}`, { method: "PATCH", body: JSON.stringify(body) });
export const deleteReminder = (schoolId: string, id: string) =>
  customFetch<{ deleted: boolean }>(`${base(schoolId)}/${id}`, { method: "DELETE" });
export const testReminder = (schoolId: string, id: string) =>
  customFetch<{ sent: boolean }>(`${base(schoolId)}/${id}/test`, { method: "POST" });
export const reminderRecipients = (schoolId: string, classId: string | null) =>
  customFetch<{ students: number; connected: number }>(`${base(schoolId)}/recipients${classId ? `?classId=${classId}` : ""}`);
