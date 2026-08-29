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
import { Medal, Trophy } from "lucide-react";

export type BotTierId = "standard" | "pro" | "custom";

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
  /** Guaranteed RAM in GB. */
  ramGb: number;
  /** Guaranteed CPU cores. */
  cpuCores: number;
  /** Ceiling on simultaneous bot users the tier is sized for. */
  maxConcurrentUsers: number;
  popular?: boolean;
  features: BotTierFeature[];
}

/** Ceiling on the self-serve custom builder. Admins are not bound by this. */
export const CUSTOM_MAX_RAM_GB = 8;
export const CUSTOM_MAX_CPU_CORES = 8;

export const BOT_TIERS: BotTier[] = [
  {
    id: "standard",
    icon: Medal,
    accent: "from-slate-400 to-slate-300",
    name: { fa: "استاندارد", en: "Standard" },
    tagline: { fa: "برای شروع سریع و پروژه‌های کوچک", en: "A fast start for small projects" },
    price: 500000,
    maxBots: 1,
    maxPlugins: 3,
    ramGb: 1,
    cpuCores: 1,
    maxConcurrentUsers: 50,
    features: [
      { fa: "۱ ربات فعال", en: "1 active bot" },
      { fa: "تا ۵۰ کاربر همزمان", en: "Up to 50 concurrent users" },
      { fa: "تا ۳ پلاگین", en: "Up to 3 plugins" },
      { fa: "پشتیبانی از طریق تیکت", en: "Ticket-based support" },
      { fa: "به‌روزرسانی‌های عمومی", en: "General updates" },
    ],
  },
  {
    id: "pro",
    icon: Trophy,
    accent: "from-amber-400 to-yellow-300",
    name: { fa: "پرو", en: "Pro" },
    tagline: { fa: "حداکثر امکانات برای کسب‌وکارهای جدی", en: "Maximum power for serious businesses" },
    price: 1100000,
    maxBots: 3,
    maxPlugins: 10,
    ramGb: 3,
    cpuCores: 3,
    maxConcurrentUsers: 250,
    popular: true,
    features: [
      { fa: "تا ۳ ربات فعال", en: "Up to 3 active bots" },
      { fa: "تا ۲۵۰ کاربر همزمان", en: "Up to 250 concurrent users" },
      { fa: "تا ۱۰ پلاگین", en: "Up to 10 plugins" },
      { fa: "پشتیبانی اولویت‌دار", en: "Priority support" },
      { fa: "دسترسی به قالب‌های اختصاصی", en: "Access to premium themes" },
      { fa: "گزارش‌گیری پیشرفته", en: "Advanced analytics" },
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
