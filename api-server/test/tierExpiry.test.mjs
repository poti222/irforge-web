/**
 * test/tierExpiry.test.mjs — IRFORGE_MONTHLY_TIER_EXPIRY_PROMPT
 *
 * دو چیز را قفل می‌کند:
 *   - `addOneMonth()`: جمعِ ماهانه‌ی تقویمی (اورفلوی روزهای کوتاه‌تر مثلِ
 *     ۳۱ ژانویه، سال کبیسه).
 *   - `sweepTierExpiry()`: فقط مسیرهایِ «کاری لازم نیست» — بات هنوز خیلی
 *     مانده، بات با tierِ سفارشی/نامعلوم حتی اگر تاریخش گذشته باشد، آرایه‌ی
 *     خالی، خطای db.select — چون این‌ها هیچ‌کدام به createNotification/
 *     deductWallet/getBotTierProduct (ماژول‌هایِ دیگر) دست نمی‌زنند.
 *
 * مسیرهای handleExpiredBot/warnUpcomingExpiry عمداً اینجا تست نشده‌اند: دقیقاً
 * مثلِ lib/trial.ts (که این فایل از رویش الگو گرفته و هیچ‌وقت test فایلِ
 * خودش را نداشته) چون آن مسیرها چند ماژولِ دیگر را هم صدا می‌زنند
 * (wallet.ts، pluginPricing.ts، notify.ts، sheetsSync.ts) که هرکدام خودشان
 * db.select/db.update واقعی می‌زنند — یک fake سراسریِ db برای همه‌شان با هم
 * قابلِ اعتماد نیست؛ همان ترکِ همیشگیِ این مجموعه‌تست.
 *
 * اجرا: pnpm --filter @workspace/api-server run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";

const { db } = await import("@workspace/db");
const mod = await import("../src/lib/tierExpiry.ts");

// ─── addOneMonth ─────────────────────────────────────────────────────────────

test("addOneMonth: حالتِ عادی → همان روز، ماهِ بعد", () => {
  const d = mod.addOneMonth(new Date("2026-03-15T10:00:00Z"));
  assert.equal(d.getUTCFullYear(), 2026);
  assert.equal(d.getUTCMonth(), 3); // April (0-indexed)
  assert.equal(d.getUTCDate(), 15);
});

test("addOneMonth: ۳۱ ژانویه + ۱ ماه → اورفلو به ۳ مارس (فوریه ۲۸ روزه)", () => {
  const d = mod.addOneMonth(new Date("2026-01-31T00:00:00Z"));
  assert.equal(d.getUTCMonth(), 2); // March
  assert.equal(d.getUTCDate(), 3);
});

test("addOneMonth: ۳۱ ژانویه در سالِ کبیسه + ۱ ماه → اورفلو به ۲ مارس (فوریه ۲۹ روزه)", () => {
  const d = mod.addOneMonth(new Date("2024-01-31T00:00:00Z"));
  assert.equal(d.getUTCMonth(), 2); // March
  assert.equal(d.getUTCDate(), 2);
});

test("addOneMonth: دسامبر + ۱ ماه → سالِ بعد، ژانویه", () => {
  const d = mod.addOneMonth(new Date("2026-12-10T00:00:00Z"));
  assert.equal(d.getUTCFullYear(), 2027);
  assert.equal(d.getUTCMonth(), 0);
  assert.equal(d.getUTCDate(), 10);
});

// ─── sweepTierExpiry — فقط مسیرهایِ «کاری لازم نیست» ────────────────────────

function fakeSelect(rows) {
  return () => ({ from: () => ({ where: async () => rows }) });
}

test("sweepTierExpiry: باتِ استاندارد که هنوز خیلی مانده تا انقضا → هیچ update ای نمی‌زند", async () => {
  const farFuture = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000); // ۶۰ روزِ دیگر
  db.select = fakeSelect([{ id: "b1", tier: "standard", tierExpiresAt: farFuture, status: "active" }]);
  let updateCalled = false;
  db.update = () => { updateCalled = true; return { set: () => ({ where: () => ({ returning: async () => [] }) }) }; };

  await mod.sweepTierExpiry();
  assert.equal(updateCalled, false);
});

test("sweepTierExpiry: باتِ tier=custom با تاریخِ گذشته → رد می‌شود (شارژِ خودکار برایِ سفارشی معنا ندارد)", async () => {
  const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
  db.select = fakeSelect([{ id: "b2", tier: "custom", tierExpiresAt: past, status: "active" }]);
  let updateCalled = false;
  db.update = () => { updateCalled = true; return { set: () => ({ where: () => ({ returning: async () => [] }) }) }; };

  await mod.sweepTierExpiry();
  assert.equal(updateCalled, false);
});

test("sweepTierExpiry: آرایه‌ی خالی → بدونِ خطا برمی‌گردد", async () => {
  db.select = fakeSelect([]);
  await assert.doesNotReject(() => mod.sweepTierExpiry());
});

test("sweepTierExpiry: شکستِ db.select → بی‌صدا catch می‌شود، throw نمی‌کند", async () => {
  db.select = () => ({ from: () => ({ where: async () => { throw new Error("connection lost"); } }) });
  await assert.doesNotReject(() => mod.sweepTierExpiry());
});
