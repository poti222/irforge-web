import { ThemeToggleButton } from "@/components/layout/theme-toggle-button";
import { CartButton } from "@/components/layout/cart-button";
import { NotificationBell } from "@/components/layout/notification-bell";
import { LanguageSwitcher } from "@/components/layout/language-switcher";

/**
 * Top-of-page controls (Z7): animated theme toggle next to the 5-language
 * switcher, rendered in the app header for signed-in users. The language
 * dropdown (LanguageSwitcher) already handles its own click feedback and
 * triggers the page-wide fade+scale View Transition via useLanguage().
 */
export function HeaderControls() {
  return (
    <div className="ms-auto flex items-center gap-2">
      <LanguageSwitcher />
      <NotificationBell />
      <CartButton />
      <ThemeToggleButton />
    </div>
  );
}
