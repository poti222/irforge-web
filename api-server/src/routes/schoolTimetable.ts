/**
 * routes/schoolTimetable.ts — برنامه‌یِ هفتگیِ هر کلاس (زنگ‌هایِ هر روز).
 * ─────────────────────────────────────────────────────────────────────────
 * نوشتن: admin / deputy / deputy_discipline. خواندن: اعضایِ همان مدرسه — دانش‌آموز فقط کلاسِ خودش، والد فقط کلاسِ
 * فرزندِ پیوندخورده (school_guardianships)، معلم کلاس‌هایِ خودش + زنگ‌هایی که خودش معلمِ آن‌هاست.
 * نوشتنِ هر روز = «جایگزینیِ کاملِ مجموعه» در یک تراکنش: یا کلِ روز عوض می‌شود یا (با هر خطا) روزِ قبلی دست‌نخورده می‌ماند.
 */
import { logger } from "../lib/logger";
import { Router } from "express";
import {
  db, schoolTimetableSlotsTable, schoolClassesTable, schoolClassMembersTable, schoolMembersTable,
  schoolGuardianshipsTable, usersTable,
} from "@workspace/db";
import { eq, and, inArray, ne, sql } from "drizzle-orm";
import crypto from "crypto";
import { requireAuth } from "./auth";
import { canAccessSchool, SCHOOL_ADMIN_DEPUTY_DISCIPLINE, classBelongsToSchool } from "../lib/schoolAuth";
import { logSchoolAudit } from "../lib/schoolAuditLog";
import { toLatinDigits } from "../lib/persianDigits";

const router = Router();

const MAX_SLOTS_PER_DAY = 20;
const STAFF_READ_ROLES = ["admin", "deputy", "deputy_discipline", "counselor"] as const;

/** «۸:۰۰» / "8:00" / "0800" / «۰۸.۳۰» → "08:00"؛ نامعتبر → null. */
export function normalizeTime(raw: unknown): string | null {
  const s = toLatinDigits(raw).trim().replace(/[٫.،]/g, ":");
  let h: string, m: string;
  let match = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (match) [, h, m] = match;
  else if ((match = /^(\d{2})(\d{2})$/.exec(s))) [, h, m] = match;
  else return null;
  const hh = Number(h), mm = Number(m);
  if (hh > 23 || mm > 59) return null;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

const parseDay = (raw: unknown): number | null => {
  const n = Number(toLatinDigits(raw));
  return Number.isInteger(n) && n >= 0 && n <= 6 ? n : null;
};

interface RowError { index: number; field?: string; code: string; message: string; conflictsWith?: number }
class TimetableError extends Error {
  constructor(public status: number, public code: string, public rowErrors: RowError[]) { super(code); }
}

interface CleanRow { startTime: string; endTime: string; subject: string; teacherUserId: string | null; note: string | null }

const label = (r: { subject: string; startTime: string; endTime: string }) => `«${r.subject}» (${r.startTime}–${r.endTime})`;

/** اعتبارسنجیِ فیلدها + تداخلِ داخلِ همین روز؛ بدونِ دسترسی به دیتابیس. */
function cleanRows(input: unknown): CleanRow[] {
  if (!Array.isArray(input)) throw new TimetableError(400, "validation", [{ index: -1, code: "slots_required", message: "slots باید آرایه باشد" }]);
  if (input.length > MAX_SLOTS_PER_DAY) throw new TimetableError(400, "validation", [{ index: -1, code: "too_many", message: `حداکثر ${MAX_SLOTS_PER_DAY} زنگ در هر روز` }]);
  const errs: RowError[] = [];
  const rows: CleanRow[] = input.map((raw: any, index) => {
    const startTime = normalizeTime(raw?.startTime);
    const endTime = normalizeTime(raw?.endTime);
    const subject = typeof raw?.subject === "string" ? raw.subject.trim() : "";
    const note = typeof raw?.note === "string" && raw.note.trim() ? raw.note.trim().slice(0, 200) : null;
    const teacherUserId = typeof raw?.teacherUserId === "string" && raw.teacherUserId.trim() ? raw.teacherUserId.trim() : null;
    if (!startTime) errs.push({ index, field: "startTime", code: "bad_time", message: "ساعتِ شروع نامعتبر است" });
    if (!endTime) errs.push({ index, field: "endTime", code: "bad_time", message: "ساعتِ پایان نامعتبر است" });
    if (startTime && endTime && endTime <= startTime) errs.push({ index, field: "endTime", code: "end_before_start", message: "ساعتِ پایان باید بعد از شروع باشد" });
    if (!subject || subject.length > 60) errs.push({ index, field: "subject", code: "subject_required", message: "نامِ درس لازم است (حداکثر ۶۰ نویسه)" });
    return { startTime: startTime ?? "", endTime: endTime ?? "", subject, teacherUserId, note };
  });
  if (errs.length) throw new TimetableError(400, "validation", errs);
  const overlaps: RowError[] = [];
  for (let i = 0; i < rows.length; i++) {
    for (let j = 0; j < i; j++) {
      // بازه‌هایِ نیمه‌باز: پایانِ یک زنگ = شروعِ بعدی تداخل نیست.
      if (rows[i].startTime < rows[j].endTime && rows[j].startTime < rows[i].endTime) {
        overlaps.push({ index: i, code: "overlap", conflictsWith: j, message: `با زنگِ ${label(rows[j])} تداخل دارد` });
        break;
      }
    }
  }
  if (overlaps.length) throw new TimetableError(409, "overlap", overlaps);
  return rows;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** معلمِ هر زنگ باید معلمِ همین کلاس باشد (school_class_members) و همزمان در دو کلاس نباشد. */
async function checkTeachers(tx: Tx, schoolId: string, classId: string, day: number, rows: CleanRow[]) {
  const ids = [...new Set(rows.map((r) => r.teacherUserId).filter(Boolean))] as string[];
  if (!ids.length) return;
  const classTeachers = await tx.select({ userId: schoolMembersTable.userId }).from(schoolClassMembersTable)
    .innerJoin(schoolMembersTable, eq(schoolMembersTable.id, schoolClassMembersTable.schoolMemberId))
    .where(and(eq(schoolClassMembersTable.classId, classId), eq(schoolClassMembersTable.roleInClass, "teacher"),
      eq(schoolMembersTable.schoolId, schoolId), inArray(schoolMembersTable.userId, ids)));
  const ok = new Set(classTeachers.map((t) => t.userId));
  const errs: RowError[] = [];
  rows.forEach((r, index) => {
    if (r.teacherUserId && !ok.has(r.teacherUserId)) errs.push({ index, field: "teacherUserId", code: "teacher_not_in_class", message: "این معلم در این کلاس نیست" });
  });
  if (errs.length) throw new TimetableError(400, "validation", errs);
  const others = await tx.select({ s: schoolTimetableSlotsTable, className: schoolClassesTable.name }).from(schoolTimetableSlotsTable)
    .innerJoin(schoolClassesTable, eq(schoolClassesTable.id, schoolTimetableSlotsTable.classId))
    .where(and(eq(schoolTimetableSlotsTable.schoolId, schoolId), eq(schoolTimetableSlotsTable.dayOfWeek, day),
      ne(schoolTimetableSlotsTable.classId, classId), inArray(schoolTimetableSlotsTable.teacherUserId, ids)));
  const busy: RowError[] = [];
  rows.forEach((r, index) => {
    if (!r.teacherUserId) return;
    const hit = others.find((o) => o.s.teacherUserId === r.teacherUserId && r.startTime < o.s.endTime && o.s.startTime < r.endTime);
    if (hit) busy.push({ index, field: "teacherUserId", code: "teacher_busy", message: `این معلم همان ساعت در کلاسِ ${hit.className} زنگِ ${label(hit.s)} دارد` });
  });
  if (busy.length) throw new TimetableError(409, "teacher_busy", busy);
}

/** قفلِ مشورتیِ هر (کلاس، روز) تا دو ذخیره‌یِ هم‌زمان هم‌دیگر را دوبل/تداخل نکنند. */
async function replaceDay(tx: Tx, schoolId: string, classId: string, day: number, rows: CleanRow[]) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"tt:" + classId + ":" + day}))`);
  await checkTeachers(tx, schoolId, classId, day, rows);
  await tx.delete(schoolTimetableSlotsTable).where(and(eq(schoolTimetableSlotsTable.classId, classId), eq(schoolTimetableSlotsTable.dayOfWeek, day)));
  const sorted = rows.map((r, i) => ({ r, i })).sort((a, b) => a.r.startTime.localeCompare(b.r.startTime));
  if (sorted.length) {
    await tx.insert(schoolTimetableSlotsTable).values(sorted.map(({ r }, order) => ({
      id: crypto.randomUUID(), schoolId, classId, dayOfWeek: day,
      startTime: r.startTime, endTime: r.endTime, subject: r.subject,
      teacherUserId: r.teacherUserId, note: r.note, sortOrder: order,
    })));
  }
}

async function formatSlots(rows: (typeof schoolTimetableSlotsTable.$inferSelect)[]) {
  const classIds = [...new Set(rows.map((r) => r.classId))];
  const teacherIds = [...new Set(rows.map((r) => r.teacherUserId).filter(Boolean))] as string[];
  const classes = classIds.length ? await db.select({ id: schoolClassesTable.id, name: schoolClassesTable.name }).from(schoolClassesTable).where(inArray(schoolClassesTable.id, classIds)) : [];
  const users = teacherIds.length ? await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(inArray(usersTable.id, teacherIds)) : [];
  const cn = new Map(classes.map((c) => [c.id, c.name])), tn = new Map(users.map((u) => [u.id, u.name]));
  return rows
    .slice().sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime))
    .map((r) => ({
      id: r.id, classId: r.classId, className: cn.get(r.classId) ?? "", dayOfWeek: r.dayOfWeek,
      startTime: r.startTime, endTime: r.endTime, subject: r.subject,
      teacherUserId: r.teacherUserId, teacherName: r.teacherUserId ? tn.get(r.teacherUserId) ?? null : null, note: r.note,
    }));
}

function sendError(res: any, err: unknown, what: string) {
  if (err instanceof TimetableError) {
    res.status(err.status).json({ error: err.code, code: err.code, rowErrors: err.rowErrors });
    return;
  }
  logger.error({ err }, what);
  res.status(500).json({ error: "Internal server error" });
}

/** کلاس‌هایِ یک عضو (به‌عنوانِ دانش‌آموز/معلم). */
async function classIdsOfMember(memberId: string, role: "student" | "teacher"): Promise<string[]> {
  const rows = await db.select({ classId: schoolClassMembersTable.classId }).from(schoolClassMembersTable)
    .where(and(eq(schoolClassMembersTable.schoolMemberId, memberId), eq(schoolClassMembersTable.roleInClass, role)));
  return rows.map((r) => r.classId);
}

/** فرزندانِ پیوندخوردهیِ این والد در همین مدرسه. */
async function childrenInSchool(parentUserId: string, schoolId: string) {
  const links = await db.select({ sid: schoolGuardianshipsTable.studentMemberId }).from(schoolGuardianshipsTable)
    .where(eq(schoolGuardianshipsTable.parentUserId, parentUserId));
  if (!links.length) return [];
  return db.select({ memberId: schoolMembersTable.id, userId: schoolMembersTable.userId }).from(schoolMembersTable)
    .where(and(inArray(schoolMembersTable.id, links.map((l) => l.sid)), eq(schoolMembersTable.schoolId, schoolId)));
}

/** آیا userId حق دارد برنامه‌یِ این کلاس را ببیند؟ (کلاس از قبل عضوِ همین مدرسه تأیید شده) */
async function canReadClass(userId: string, schoolId: string, classId: string): Promise<boolean> {
  const { ok, member } = await canAccessSchool(userId, schoolId, STAFF_READ_ROLES);
  if (ok) return true;
  if (!member || member.schoolId !== schoolId) return false;
  if (member.role === "student") return (await classIdsOfMember(member.id, "student")).includes(classId);
  if (member.role === "teacher") {
    if ((await classIdsOfMember(member.id, "teacher")).includes(classId)) return true;
    const [own] = await db.select({ id: schoolTimetableSlotsTable.id }).from(schoolTimetableSlotsTable)
      .where(and(eq(schoolTimetableSlotsTable.classId, classId), eq(schoolTimetableSlotsTable.teacherUserId, userId))).limit(1);
    return !!own;
  }
  if (member.role === "parent") {
    for (const c of await childrenInSchool(userId, schoolId)) {
      if ((await classIdsOfMember(c.memberId, "student")).includes(classId)) return true;
    }
  }
  return false;
}

// GET /api/schools/:schoolId/timetable?classId= — برنامه‌یِ هفتگیِ یک کلاس.
router.get("/schools/:schoolId/timetable", requireAuth, async (req: any, res) => {
  try {
    const { schoolId } = req.params;
    const classId = typeof req.query.classId === "string" ? req.query.classId : "";
    if (!classId) { res.status(400).json({ error: "classId is required" }); return; }
    if (!(await classBelongsToSchool(classId, schoolId)) || !(await canReadClass(req.userId, schoolId, classId))) {
      // برایِ غیرِ مجاز و کلاسِ ناموجود/مدرسه‌یِ دیگر یک پاسخِ یکسان (۴۰۳) تا وجودِ کلاس لو نرود.
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const rows = await db.select().from(schoolTimetableSlotsTable).where(and(eq(schoolTimetableSlotsTable.schoolId, schoolId), eq(schoolTimetableSlotsTable.classId, classId)));
    res.json({ slots: await formatSlots(rows) });
  } catch (err) { sendError(res, err, "Get timetable error"); }
});

// GET /api/schools/:schoolId/timetable/mine — برنامه‌یِ «من» بر اساسِ نقش (دانش‌آموز/والد/معلم).
router.get("/schools/:schoolId/timetable/mine", requireAuth, async (req: any, res) => {
  try {
    const { schoolId } = req.params;
    const { ok, member } = await canAccessSchool(req.userId, schoolId, ["admin", "deputy", "deputy_discipline", "counselor", "teacher", "student", "parent"]);
    if (!ok) { res.status(403).json({ error: "Forbidden" }); return; }
    const role = member && member.schoolId === schoolId ? member.role : "admin";
    if (role === "student" && member) {
      const cids = await classIdsOfMember(member.id, "student");
      const rows = cids.length ? await db.select().from(schoolTimetableSlotsTable).where(and(eq(schoolTimetableSlotsTable.schoolId, schoolId), inArray(schoolTimetableSlotsTable.classId, cids))) : [];
      res.json({ role, slots: await formatSlots(rows) });
      return;
    }
    if (role === "teacher" && member) {
      const cids = await classIdsOfMember(member.id, "teacher");
      const cond = cids.length
        ? sql`(${schoolTimetableSlotsTable.teacherUserId} = ${req.userId} OR ${inArray(schoolTimetableSlotsTable.classId, cids)})`
        : eq(schoolTimetableSlotsTable.teacherUserId, req.userId);
      const rows = await db.select().from(schoolTimetableSlotsTable).where(and(eq(schoolTimetableSlotsTable.schoolId, schoolId), cond));
      const slots = (await formatSlots(rows)).map((s) => ({ ...s, mine: s.teacherUserId === req.userId }));
      res.json({ role, slots });
      return;
    }
    if (role === "parent") {
      const kids = await childrenInSchool(req.userId, schoolId);
      const out: any[] = [];
      for (const k of kids) {
        const cids = await classIdsOfMember(k.memberId, "student");
        const rows = cids.length ? await db.select().from(schoolTimetableSlotsTable).where(and(eq(schoolTimetableSlotsTable.schoolId, schoolId), inArray(schoolTimetableSlotsTable.classId, cids))) : [];
        const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, k.userId)).limit(1);
        out.push({ childMemberId: k.memberId, childName: u?.name ?? "", slots: await formatSlots(rows) });
      }
      res.json({ role, children: out, slots: out.flatMap((c) => c.slots) });
      return;
    }
    // کادرِ مدرسه: برنامه‌یِ شخصی ندارند؛ ویرایشگر/نمای کلاس را استفاده می‌کنند.
    res.json({ role, slots: [] });
  } catch (err) { sendError(res, err, "Get my timetable error"); }
});

// PUT /api/schools/:schoolId/timetable/classes/:classId/days/:day — جایگزینیِ کاملِ زنگ‌هایِ یک روز (اتمیک).
router.put("/schools/:schoolId/timetable/classes/:classId/days/:day", requireAuth, async (req: any, res) => {
  try {
    const { schoolId, classId } = req.params;
    const { ok } = await canAccessSchool(req.userId, schoolId, SCHOOL_ADMIN_DEPUTY_DISCIPLINE);
    if (!ok) { res.status(403).json({ error: "Forbidden" }); return; }
    const day = parseDay(req.params.day);
    if (day === null) { res.status(400).json({ error: "day must be 0..6" }); return; }
    if (!(await classBelongsToSchool(classId, schoolId))) { res.status(404).json({ error: "Class not found" }); return; }
    const rows = cleanRows(req.body?.slots);
    await db.transaction(async (tx) => { await replaceDay(tx, schoolId, classId, day, rows); });
    const saved = await db.select().from(schoolTimetableSlotsTable).where(and(eq(schoolTimetableSlotsTable.classId, classId), eq(schoolTimetableSlotsTable.dayOfWeek, day)));
    await logSchoolAudit(schoolId, req.userId, "timetable.day_set", `class ${classId} day ${day}: ${rows.length} slots`);
    res.json({ slots: await formatSlots(saved) });
  } catch (err) { sendError(res, err, "Replace timetable day error"); }
});

// POST /api/schools/:schoolId/timetable/classes/:classId/copy — { fromDay, toDays[] }؛ همه‌یِ روزهایِ مقصد در یک تراکنش.
router.post("/schools/:schoolId/timetable/classes/:classId/copy", requireAuth, async (req: any, res) => {
  try {
    const { schoolId, classId } = req.params;
    const { ok } = await canAccessSchool(req.userId, schoolId, SCHOOL_ADMIN_DEPUTY_DISCIPLINE);
    if (!ok) { res.status(403).json({ error: "Forbidden" }); return; }
    const from = parseDay(req.body?.fromDay);
    const toDays = Array.isArray(req.body?.toDays) ? [...new Set((req.body.toDays as unknown[]).map(parseDay))] : [];
    if (from === null || !toDays.length || toDays.some((d) => d === null)) { res.status(400).json({ error: "fromDay and toDays (0..6) are required" }); return; }
    if (!(await classBelongsToSchool(classId, schoolId))) { res.status(404).json({ error: "Class not found" }); return; }
    const targets = (toDays as number[]).filter((d) => d !== from);
    await db.transaction(async (tx) => {
      const src = await tx.select().from(schoolTimetableSlotsTable).where(and(eq(schoolTimetableSlotsTable.classId, classId), eq(schoolTimetableSlotsTable.dayOfWeek, from)));
      const rows: CleanRow[] = src.map((s) => ({ startTime: s.startTime, endTime: s.endTime, subject: s.subject, teacherUserId: s.teacherUserId, note: s.note }));
      for (const d of targets) await replaceDay(tx, schoolId, classId, d, rows);
    });
    await logSchoolAudit(schoolId, req.userId, "timetable.day_copied", `class ${classId}: day ${from} -> ${targets.join(",")}`);
    const saved = await db.select().from(schoolTimetableSlotsTable).where(and(eq(schoolTimetableSlotsTable.schoolId, schoolId), eq(schoolTimetableSlotsTable.classId, classId)));
    res.json({ slots: await formatSlots(saved) });
  } catch (err) { sendError(res, err, "Copy timetable day error"); }
});

export default router;
