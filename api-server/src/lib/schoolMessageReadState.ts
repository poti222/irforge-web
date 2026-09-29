/**
 * lib/schoolMessageReadState.ts — بخش "/schools" فاز ۹ (بندِ ۱): سازنده‌هایِ
 * threadKey (باید عیناً با نسخه‌ی فرانت در lib/schools-api.ts یکی باشند —
 * چون سرور و کلاینت هردو این رشته را مستقل می‌سازند، نه این‌که سرور آن‌را
 * برگرداند) + خواندن/نوشتنِ جدولِ school_message_read_state.
 */
import { db, schoolMessageReadStateTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import crypto from "crypto";

export function adminThreadKey(schoolId: string, studentMemberId: string): string {
  return `admin:${schoolId}:${studentMemberId}`;
}

export function teacherThreadKey(schoolId: string, teacherUserId: string, studentMemberId: string): string {
  return `teacher:${schoolId}:${teacherUserId}:${studentMemberId}`;
}

export function counselorThreadKey(schoolId: string, counselorUserId: string, studentMemberId: string): string {
  return `counselor:${schoolId}:${counselorUserId}:${studentMemberId}`;
}

/** ثبتِ «همین الان خوانده شد» برایِ (userId, threadKey) — upsert اتمیک. */
export async function markThreadRead(userId: string, threadKey: string): Promise<void> {
  await db.insert(schoolMessageReadStateTable)
    .values({ id: crypto.randomUUID(), userId, threadKey, lastReadAt: new Date() })
    .onConflictDoUpdate({
      target: [schoolMessageReadStateTable.userId, schoolMessageReadStateTable.threadKey],
      set: { lastReadAt: new Date() },
    });
}

/** نگاشتِ threadKey → lastReadAt برایِ یک کاربر، فقط برایِ رشته‌هایِ خواسته‌شده. */
export async function getReadMap(userId: string, threadKeys: string[]): Promise<Map<string, Date>> {
  if (threadKeys.length === 0) return new Map();
  const rows = await db.select().from(schoolMessageReadStateTable)
    .where(and(eq(schoolMessageReadStateTable.userId, userId), inArray(schoolMessageReadStateTable.threadKey, threadKeys)));
  return new Map(rows.map((r: typeof rows[number]) => [r.threadKey, r.lastReadAt]));
}

/** «رشته خوانده‌نشده است؟» — هرگز‌خوانده‌نشده هم خوانده‌نشده حساب می‌شود. */
export function isUnread(latestMessageAt: Date | null | undefined, lastReadAt: Date | undefined): boolean {
  if (!latestMessageAt) return false; // رشته‌ای که هنوز پیامی ندارد، خوانده‌نشده معنا ندارد.
  if (!lastReadAt) return true;
  return latestMessageAt.getTime() > lastReadAt.getTime();
}
