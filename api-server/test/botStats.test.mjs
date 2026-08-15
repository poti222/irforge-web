/**
 * test/botStats.test.mjs — «کاربران فعال امروز» و روزِ تهران.
 *
 * چرا این تست وجود دارد: بازه‌ی روز، تنها بخشی از این محاسبه است که روی
 * ماشین توسعه‌دهنده درست به نظر می‌رسد و روی سرور غلط است. Railway با UTC
 * بالا می‌آید، پس اگر روز با `toISOString().slice(0,10)` گرفته شود، هر شب
 * بین ۰۰:۰۰ تا ۰۳:۳۰ به وقت تهران، فعالیت کاربر در سطل «دیروز» می‌افتد و
 * عدد «فعال امروز» صفر می‌ماند — بدون هیچ خطایی.
 *
 * `TZ` عمداً روی چیزی غیر از تهران و غیر از UTC ست می‌شود تا اگر کسی روزی
 * برگردد به حساب‌کردن با ساعت محلیِ سرور، همین‌جا بیفتد.
 */
process.env.TZ = "America/New_York";
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";

import { test } from "node:test";
import assert from "node:assert/strict";

const { tehranDayKey, tehranToday, tehranLastDays } = await import("../src/lib/tehranTime.ts");
const { __testables } = await import("../src/lib/botStats.ts");
const { compute } = __testables;

test("روزِ تهران از ساعت سرور مستقل است", () => {
  // ۲۰۲۶-۰۳-۱۰ ساعت ۲۱:۰۰ UTC = ۲۰۲۶-۰۳-۱۱ ساعت ۰۰:۳۰ به وقت تهران.
  // روز تهران باید ۱۱ باشد، نه ۱۰ — و نه ۱۰ به وقت نیویورک.
  assert.equal(tehranDayKey("2026-03-10T21:00:00Z"), "2026-03-11");
  // ۲۰:۰۰ UTC هنوز ۲۳:۳۰ همان روز است.
  assert.equal(tehranDayKey("2026-03-10T20:00:00Z"), "2026-03-10");
});

test("ورودی بدشکل به‌جای NaN، رشته‌ی خالی می‌دهد", () => {
  assert.equal(tehranDayKey("not a date"), "");
  assert.equal(tehranDayKey(""), "");
});

test("tehranLastDays هفت روزِ پشت‌سرهم و مرتب می‌دهد", () => {
  const days = tehranLastDays(7);
  assert.equal(days.length, 7);
  assert.equal(days[6], tehranToday(), "آخرین عضو باید امروز باشد");
  assert.deepEqual([...days].sort(), days, "باید صعودی باشد");
  assert.equal(new Set(days).size, 7, "هیچ روزی نباید تکرار شود");
  for (const d of days) assert.match(d, /^\d{4}-\d{2}-\d{2}$/);
});

test("زمانِ بدونِ منطقه‌ی زمانی، UTC خوانده می‌شود نه ساعت محلیِ سرور", () => {
  // بات با `datetime.utcnow().isoformat()` می‌نویسد — بدون `Z`. اگر این
  // رشته ساعت محلی تفسیر شود، روی این ماشین (نیویورک، UTC-4) نتیجه ۴ ساعت
  // جابه‌جا می‌شود و روزِ تهران عوض می‌شود.
  assert.equal(tehranDayKey("2026-03-10T21:00:00.123456"), "2026-03-11");
  assert.equal(
    tehranDayKey("2026-03-10T21:00:00.123456"),
    tehranDayKey("2026-03-10T21:00:00.123456Z"),
    "با و بدون Z باید یکی باشند",
  );
});

test("فعال امروز فقط کاربرانی که last_seen شان امروزِ تهران است", () => {
  // زمان‌ها از «الان» ساخته می‌شوند، نه از رشته‌ی دستی: یک `${today}T23:00`
  // ممکن است در تهران هنوز نرسیده باشد یا قبلاً گذشته باشد.
  const now = new Date();
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const iso = (d) => d.toISOString().replace("Z", ""); // همان شکلی که بات می‌نویسد

  const stats = compute([
    { user_id: "1", last_seen: iso(now) },
    { user_id: "2", last_seen: iso(hourAgo) },
    { user_id: "3", last_seen: "2020-01-01T00:00:00" },
  ]);
  assert.equal(stats.users, 3, "همه‌ی کاربران در شمارش کل هستند");
  // «یک ساعت پیش» فقط در بازه‌ی ۰۰:۰۰–۰۱:۰۰ تهران به دیروز می‌افتد.
  const bothToday = tehranDayKey(now) === tehranDayKey(hourAgo);
  assert.equal(stats.activeUsersToday, bothToday ? 2 : 1);
  assert.ok(stats.activeUsersToday >= 1, "کاربر «همین الان» همیشه فعالِ امروز است");
});

test("last_seen خالی یا بدشکل، کاربر را از شمارش کل حذف نمی‌کند", () => {
  const stats = compute([
    { user_id: "1", last_seen: "" },
    { user_id: "2" },
    { user_id: "3", last_seen: "چرت و پرت" },
  ]);
  assert.equal(stats.users, 3);
  assert.equal(stats.activeUsersToday, 0);
  assert.ok(stats.activeUsersPerDay.every((d) => d.count === 0));
});

test("سری نمودار همیشه ۷ روز دارد، حتی وقتی هیچ کاربری نیست", () => {
  const stats = compute([]);
  assert.equal(stats.activeUsersPerDay.length, 7);
  assert.equal(stats.users, 0);
  assert.equal(stats.activeUsersToday, 0);
});

test("فعالیت خارج از پنجره‌ی ۷ روزه در نمودار نمی‌آید ولی در کل کاربران هست", () => {
  const stats = compute([{ user_id: "1", last_seen: "2019-05-05T10:00:00Z" }]);
  assert.equal(stats.users, 1);
  assert.equal(
    stats.activeUsersPerDay.reduce((sum, d) => sum + d.count, 0),
    0,
  );
});
