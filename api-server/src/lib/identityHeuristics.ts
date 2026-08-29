/**
 * lib/identityHeuristics.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Mandatory Profile Completion & Identity System — best-effort gender/name
 * checks for PATCH /auth/complete-profile.
 *
 * Two separate, differently-consequential checks:
 *
 *  - `isFakeName()`: garbage input (all digits, a single character, or one
 *    character repeated) is rejected at submit time with a 400 — there is
 *    nothing for an admin to review, it just isn't a name.
 *
 *  - `nameGenderMismatch()`: a *soft*, best-effort signal. It only ever
 *    flags an account for admin review (flaggedForReview/flagReason) — it
 *    never blocks registration or login, and an unknown first name is
 *    silently skipped rather than treated as a mismatch. This is not (and
 *    isn't meant to be) a real gender classifier: it's a small, static,
 *    deliberately conservative lookup of unambiguous common names, seeded
 *    with Persian and English first names since those are this platform's
 *    two audiences. It will miss plenty of real names and that's fine — a
 *    missed mismatch costs nothing, a false accusation costs user trust.
 *    Expand the two sets below as real cases show up; nothing else in this
 *    file needs to change to support that.
 */

const MALE_FIRST_NAMES = new Set(
  [
    // Persian
    "علی", "محمد", "حسین", "رضا", "حسن", "امیر", "مهدی", "احمد", "جواد", "عباس",
    "کریم", "ابراهیم", "یوسف", "داود", "سعید", "بهروز", "کامران", "فرهاد", "بهزاد", "آرش",
    "سینا", "پویا", "نیما", "کیوان", "شاهین", "بابک", "فرید", "مسعود", "وحید", "هومن",
    "کاوه", "رامین", "پیمان", "سامان", "میلاد", "امین", "حامد", "ایمان", "پدرام", "آرمین",
    "علیرضا", "محمدرضا", "حمید", "فرزاد", "آرمان", "کوروش", "دانیال", "پارسا", "آرین", "شایان",
    // English
    "john", "michael", "david", "james", "robert", "william", "richard", "joseph", "thomas", "charles",
    "daniel", "matthew", "anthony", "mark", "paul", "steven", "andrew", "kenneth", "joshua", "kevin",
  ].map((n) => n.trim()),
);

const FEMALE_FIRST_NAMES = new Set(
  [
    // Persian
    "زهرا", "فاطمه", "مریم", "نرگس", "سارا", "نگار", "شیرین", "لیلا", "پریسا", "الهام",
    "نازنین", "ندا", "آزاده", "شادی", "مهسا", "یاسمن", "ترانه", "هانیه", "نیلوفر", "رویا",
    "مینا", "سپیده", "آیدا", "پگاه", "رها", "دلارام", "بهاره", "فرزانه", "شبنم", "مینو",
    "پریناز", "نیوشا", "رومینا", "درسا", "باران", "ستاره", "سمیرا", "الناز", "پرستو", "کیانا",
    // English
    "mary", "patricia", "jennifer", "linda", "elizabeth", "barbara", "susan", "jessica", "sarah", "karen",
    "nancy", "lisa", "betty", "margaret", "sandra", "ashley", "kimberly", "emily", "donna", "michelle",
  ].map((n) => n.trim()),
);

function firstNameOf(fullName: string): string {
  return fullName.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
}

/**
 * True only when the first name appears in **exactly one** of the two sets
 * and it disagrees with the declared gender. A name absent from both sets
 * (the common case — this lookup is intentionally small) returns false,
 * never a mismatch.
 */
export function nameGenderMismatch(fullName: string, declaredGender: "male" | "female"): boolean {
  const first = firstNameOf(fullName);
  if (!first) return false;
  const isMale = MALE_FIRST_NAMES.has(first);
  const isFemale = FEMALE_FIRST_NAMES.has(first);
  if (isMale === isFemale) return false; // unknown (neither), or absurdly in both — skip either way
  if (declaredGender === "male" && isFemale) return true;
  if (declaredGender === "female" && isMale) return true;
  return false;
}

/**
 * Garbage, not a mismatch: all-digits, a single character, or one character
 * repeated (spaces ignored, so "a a a" is caught too). Rejected outright —
 * no admin review needed for input that was never trying to be a name.
 */
export function isFakeName(fullName: string): boolean {
  const collapsed = fullName.trim().replace(/\s+/g, "");
  if (collapsed.length < 2) return true;
  if (/^\d+$/.test(collapsed)) return true;
  if (new Set([...collapsed.toLowerCase()]).size === 1) return true;
  return false;
}
