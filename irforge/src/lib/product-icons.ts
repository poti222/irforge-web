/**
 * product-icons.ts — نگاشتِ نامِ آیکونِ ذخیره‌شده در `products`/`product_categories`
 * به کامپوننتِ Lucide واقعی.
 *
 * دیتابیس فقط یک رشته نگه می‌دارد (`icon: "Bot"`) نه خودِ کامپوننت — این
 * فایل تنها جایی است که آن رشته را به یک آیکونِ واقعی برمی‌گرداند، تا این
 * نگاشت یک‌بار نوشته شود، نه در هر جزئی که محصول را نشان می‌دهد.
 */
import {
  Bot, CreditCard, Wallet, Code, Calculator, School, Medal, Trophy, Settings2,
  type LucideIcon,
} from "lucide-react";

const PRODUCT_ICONS: Record<string, LucideIcon> = {
  Bot, CreditCard, Wallet, Code, Calculator, School, Medal, Trophy, Settings2,
};

export function productIcon(name: string | null | undefined): LucideIcon {
  return (name && PRODUCT_ICONS[name]) || Bot;
}
