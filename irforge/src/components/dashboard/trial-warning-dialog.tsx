import { useState } from "react";
import { Link } from "wouter";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AlertTriangle, ShoppingBag } from "lucide-react";
import { useLanguage } from "@/hooks/use-language";
import { useNotifications } from "@/hooks/use-notifications";

/**
 * وقتی کاربر وارد داشبورد می‌شود، اگر اعلان خوانده‌نشده‌ی «هشدار تریال» یا
 * «پایان تریال» داشته باشد، همین‌جا یک مودال باز می‌شود (طبق تصمیم محصولی:
 * صرف بازکردن داشبورد باید این هشدار را نشان دهد، نه فقط بِل بالای صفحه).
 */
export function TrialWarningDialog() {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const { notifications, markRead } = useNotifications();
  const [dismissedThisSession, setDismissedThisSession] = useState<Set<string>>(new Set());

  const pending = notifications.filter(
    (n) => n.type.startsWith("trial_") && !n.read && !dismissedThisSession.has(n.id)
  );
  const current = pending[0] ?? null;

  if (!current) return null;

  function handleClose() {
    if (!current) return;
    setDismissedThisSession((prev) => new Set(prev).add(current.id));
    markRead(current.id);
  }

  const isCritical = current.severity === "critical";

  return (
    <AlertDialog open onOpenChange={(o) => !o && handleClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className={`size-5 ${isCritical ? "text-red-500" : "text-amber-500"}`} />
            {current.title}
          </AlertDialogTitle>
          <AlertDialogDescription>{current.message}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col-reverse gap-2 sm:flex-row">
          <AlertDialogCancel onClick={handleClose} className="w-full sm:w-auto">
            {fa ? "متوجه شدم" : "Got it"}
          </AlertDialogCancel>
          <AlertDialogAction asChild className="w-full sm:w-auto">
            <Link href="/buy-bot" onClick={handleClose}>
              <ShoppingBag className="me-2 h-4 w-4" /> {fa ? "مشاهده پکیج‌ها" : "View packages"}
            </Link>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
