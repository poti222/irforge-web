/**
 * lib/planChange.ts — IRFORGE_PROMPT_V3 Phase 34.
 * ─────────────────────────────────────────────────────────────────────────────
 * تصمیمِ خالصِ «چه اتفاقی می‌افتد وقتی کاربر پلن X را انتخاب می‌کند» — جدا از
 * دیتابیس و کیف‌پول تا بدون هیچ mock ای تست شود. `routes/plans.ts` این را
 * صدا می‌زند و فقط نتیجه‌اش را روی `db`/کیف‌پول اجرا می‌کند.
 *
 * این محصول پرداختِ تکرارشونده/خودکار ندارد — هر تغییرِ پلن یک اقدامِ صریحِ
 * کاربر است، پس نیازی به صف‌بندی یا زمان‌بندیِ جداگانه نیست:
 *
 *   - **پلنِ رایگان** (`price <= 0`): بدون کسر، بدون انقضا — معادلِ لغوِ اشتراک.
 *   - **تمدید** (همان پلنِ فعلیِ فعال): کسر می‌شود؛ اگر مهلتِ فعلی هنوز
 *     نگذشته، دوره‌ی جدید از *همان تاریخِ انقضا* جلو می‌رود، نه از الان —
 *     وگرنه تمدیدِ زودهنگام روزهای پرداخت‌شده را دور می‌ریخت.
 *   - **تنزل** (پلنِ فعلی فعال و پلنِ جدید ارزان‌تر یا هم‌قیمت): بدون کسر،
 *     فوری، ولی تاریخِ انقضا/تمدیدِ فعلی دست‌نخورده می‌ماند.
 *   - **اشتراکِ تازه** (پلنِ فعلی وجود ندارد/منقضی شده): کسرِ کاملِ قیمتِ
 *     پلنِ جدید، دوره‌ای تازه از الان.
 *   - **ارتقا** (پلنِ فعلی فعال و پلنِ جدید گران‌تر است — identityverificationspec.md
 *     فاز ۱۳): فقط تفاوتِ قیمت کسر می‌شود، نه قیمتِ کاملِ پلنِ جدید — و
 *     تاریخِ انقضا/تمدید دست‌نخورده می‌ماند، نه یک دوره‌ی تازه از الان. سقفِ
 *     پلنِ جدید (رم/CPU/maxUsers/maxBots) بلافاصله اعمال می‌شود چون
 *     `userPlansTable.planId` همین الان عوض می‌شود؛ فقط پولش تا پایانِ همان
 *     دوره‌ای که قبلاً خریده بود یک بارِ اضافه است، نه یک اشتراکِ کاملاً تازه.
 */

export type PlanChangeAction = "subscribe" | "upgrade" | "downgrade" | "renew";

export type PlanChangeDecision = {
  action: PlanChangeAction;
  charge: number;
  nextExpiresAt: Date | null;
  nextRenewsAt: Date | null;
};

export type TargetPlan = { id: string; price: number; interval: string };
export type ExistingUserPlan = { planId: string; status: string; expiresAt: Date | null; renewsAt: Date | null };

/** «ماهانه» ۱ ماه جلو می‌رود، هرچیز دیگری (فعلاً فقط «سالانه») ۱۲ ماه. */
export function addInterval(from: Date, interval: string): Date {
  const next = new Date(from);
  next.setMonth(next.getMonth() + (interval === "yearly" ? 12 : 1));
  return next;
}

export function decidePlanChange(
  targetPlan: TargetPlan,
  existing: ExistingUserPlan | null,
  currentPlanPrice: number,
  now: Date = new Date(),
): PlanChangeDecision {
  const currentActive = Boolean(
    existing && existing.status === "active" && (!existing.expiresAt || existing.expiresAt > now),
  );
  // همان پلنِ قبلی را دوباره انتخاب کردن همیشه «تمدید» است، حتی اگر مهلتش
  // قبلاً تمام شده یا لغو شده باشد — کاربری که پلنِ منقضی‌شده‌اش را دوباره
  // می‌خرد دارد آن را تمدید می‌کند، نه اینکه یک اشتراکِ کاملاً تازه بگیرد؛ فرمولِ
  // پایین (از تاریخِ انقضای فعلی اگر هنوز نگذشته، وگرنه از الان) هر دو حالت را
  // درست حساب می‌کند.
  const isRenewal = Boolean(existing) && existing!.planId === targetPlan.id;

  if (targetPlan.price <= 0) {
    return { action: "downgrade", charge: 0, nextExpiresAt: null, nextRenewsAt: null };
  }

  if (isRenewal) {
    const base = existing!.expiresAt && existing!.expiresAt > now ? existing!.expiresAt : now;
    const nextExpiresAt = addInterval(base, targetPlan.interval);
    return { action: "renew", charge: targetPlan.price, nextExpiresAt, nextRenewsAt: nextExpiresAt };
  }

  if (currentActive && targetPlan.price <= currentPlanPrice) {
    return {
      action: "downgrade",
      charge: 0,
      nextExpiresAt: existing!.expiresAt,
      nextRenewsAt: existing!.renewsAt,
    };
  }

  if (currentActive) {
    // ارتقا: فقط تفاوت، همان دوره‌ی فعلی — نه قیمتِ کامل، نه دوره‌ی تازه.
    return {
      action: "upgrade",
      charge: targetPlan.price - currentPlanPrice,
      nextExpiresAt: existing!.expiresAt,
      nextRenewsAt: existing!.renewsAt,
    };
  }

  const nextExpiresAt = addInterval(now, targetPlan.interval);
  return { action: "subscribe", charge: targetPlan.price, nextExpiresAt, nextRenewsAt: nextExpiresAt };
}
