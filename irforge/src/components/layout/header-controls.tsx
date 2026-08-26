import { ThemeToggleButton } from "@/components/layout/theme-toggle-button";
import { CartButton } from "@/components/layout/cart-button";
import { NotificationBell } from "@/components/layout/notification-bell";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { CurrencySwitcher } from "@/components/layout/currency-switcher";

/**
 * Top-of-page controls (Z7): animated theme toggle next to the 5-language
 * switcher, rendered in the app header for signed-in users. The language
 * dropdown (LanguageSwitcher) already handles its own click feedback and
 * triggers the page-wide fade+scale View Transition via useLanguage().
 *
 * CurrencySwitcher (P39) sits right next to it — same shape, same spot — and
 * renders nothing until a super admin configures at least one display rate.
 */
export function HeaderControls() {
  return (
    <div className="ms-auto flex items-center gap-2">
      <LanguageSwitcher />
      <CurrencySwitcher />
      <NotificationBell />
      <CartButton />
      <ThemeToggleButton />
    </div>
  );
}
