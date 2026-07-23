/**
 * bot-tiers.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * پکیج‌های «خرید بات» — یک مفهوم کاملاً جدا از سیستم اشتراک/Plan فعلی
 * (lib/db/schema/plans.ts). این‌ها سطوح ثابتی هستند که کاربر موقع ساخت
 * بات جدید از بین‌شان انتخاب می‌کند (نقره‌ای / طلایی / الماسی / سفارشی).
 *
 * فعلاً همه‌چیز استاتیک و فقط سمت فرانت است؛ بعداً اگر لازم شد می‌شود از
 * یک endpoint واقعی خواند بدون این‌که ساختار صفحات عوض شود.
 */

import type { LucideIcon } from "lucide-react";
import { Medal, Trophy, Gem } from "lucide-react";

export type BotTierId = "silver" | "gold" | "diamond" | "custom";

export interface BotTierFeature {
  fa: string;
  en: string;
}

export interface BotTier {
  id: BotTierId;
  icon: LucideIcon;
  /** Tailwind classes for the tier's accent (badge/icon background, header gradient). */
  accent: string; // e.g. "from-slate-400 to-slate-500"
  name: { fa: string; en: string };
  tagline: { fa: string; en: string };
  price: number; // Toman, 0 for custom (contact / configure)
  maxBots: number;
  maxPlugins: number;
  popular?: boolean;
  features: BotTierFeature[];
}

export const BOT_TIERS: BotTier[] = [
  {
    id: "silver",
    icon: Medal,
    accent: "from-slate-400 to-slate-300",
    name: { fa: "نقره‌ای", en: "Silver" },
    tagline: { fa: "برای شروع سریع و پروژه‌های کوچک", en: "A fast start for small projects" },
    price: 150000,
    maxBots: 1,
    maxPlugins: 3,
    features: [
      { fa: "۱ ربات فعال", en: "1 active bot" },
      { fa: "تا ۳ پلاگین", en: "Up to 3 plugins" },
      { fa: "پشتیبانی از طریق تیکت", en: "Ticket-based support" },
      { fa: "به‌روزرسانی‌های عمومی", en: "General updates" },
    ],
  },
  {
    id: "gold",
    icon: Trophy,
    accent: "from-amber-400 to-yellow-300",
    name: { fa: "طلایی", en: "Gold" },
    tagline: { fa: "تعادل بین امکانات و قیمت", en: "The best balance of features and price" },
    price: 350000,
    maxBots: 3,
    maxPlugins: 10,
    popular: true,
    features: [
      { fa: "تا ۳ ربات فعال", en: "Up to 3 active bots" },
      { fa: "تا ۱۰ پلاگین", en: "Up to 10 plugins" },
      { fa: "پشتیبانی اولویت‌دار", en: "Priority support" },
      { fa: "دسترسی به قالب‌های اختصاصی", en: "Access to premium themes" },
      { fa: "گزارش‌گیری پیشرفته", en: "Advanced analytics" },
    ],
  },
  {
    id: "diamond",
    icon: Gem,
    accent: "from-sky-400 to-cyan-300",
    name: { fa: "الماسی", en: "Diamond" },
    tagline: { fa: "حداکثر امکانات برای کسب‌وکارهای جدی", en: "Maximum power for serious businesses" },
    price: 750000,
    maxBots: 10,
    maxPlugins: 999,
    features: [
      { fa: "تا ۱۰ ربات فعال", en: "Up to 10 active bots" },
      { fa: "پلاگین نامحدود", en: "Unlimited plugins" },
      { fa: "پشتیبانی اختصاصی ۲۴/۷", en: "Dedicated 24/7 support" },
      { fa: "دسترسی زودهنگام به امکانات جدید", en: "Early access to new features" },
      { fa: "گزارش‌گیری و آنالیتیکس کامل", en: "Full analytics suite" },
      { fa: "برندینگ اختصاصی (بدون لوگوی ما)", en: "White-label branding" },
    ],
  },
];

export function getBotTier(id: string | undefined): BotTier | undefined {
  return BOT_TIERS.find((t) => t.id === id);
}

/**
 * چک‌لیست ماژول‌های بات برای کارت «سفارشی» — فعلاً کاملاً نمایشی (بدون منطق
 * قیمت‌گذاری یا اتصال به بک‌اند). بخشی که "mandatory: true" باشد به‌صورت
 * تیک‌خورده و غیرقابل تغییر نمایش داده می‌شود.
 */
export interface CustomModule {
  id: string;
  name: { fa: string; en: string };
  mandatory: boolean;
}

export const CUSTOM_MODULES: CustomModule[] = [
  { id: "core", name: { fa: "هسته‌ی اصلی ربات", en: "Bot core engine" }, mandatory: true },
  { id: "dashboard", name: { fa: "پنل مدیریت", en: "Admin dashboard" }, mandatory: true },
  { id: "wallet", name: { fa: "اتصال به کیف پول", en: "Wallet integration" }, mandatory: true },
  { id: "broadcast", name: { fa: "پیام همگانی (Broadcast)", en: "Broadcast messaging" }, mandatory: false },
  { id: "payments", name: { fa: "درگاه پرداخت اختصاصی", en: "Custom payment gateway" }, mandatory: false },
  { id: "analytics", name: { fa: "آنالیتیکس پیشرفته", en: "Advanced analytics" }, mandatory: false },
  { id: "multi-admin", name: { fa: "چند ادمینی", en: "Multi-admin access" }, mandatory: false },
  { id: "custom-theme", name: { fa: "قالب اختصاصی", en: "Custom theme" }, mandatory: false },
  { id: "api-access", name: { fa: "دسترسی API", en: "API access" }, mandatory: false },
  { id: "webhooks", name: { fa: "وب‌هوک‌ها", en: "Webhooks" }, mandatory: false },
];
