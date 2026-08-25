/**
 * CreateBotDialog.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * دیالوگ ساخت بات — فلوی کامل:
 *   ۱. چک پروفایل (تلگرام وصل، شماره، یوزرنیم، آواتار)
 *   ۲. فرم: نام بات، توکن، توضیح، آپلود فیش + توضیح پرداخت
 *   ۳. ارسال به API → رکورد با وضعیت pending_payment
 *
 * نکته: این کامپوننت فقط UI است. بعد از تکمیل migration های گروه ۲،
 * endpoint بک‌اند هم باید آپدیت بشه تا فیلدهای جدید رو بپذیره.
 */

import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation } from "wouter";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AmountInput } from "@/components/ui/amount-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertTriangle,
  Upload,
  Loader2,
  CheckCircle2,
  ExternalLink,
  X,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { customFetch } from "@workspace/api-client-react";
import { toWebpDataUrl } from "@/lib/image";

// ─── نوع کاربر پروفایل (با فیلدهای تلگرام) ─────────────────────────────────

type FullUser = {
  id: string;
  name: string;
  email: string;
  avatar?: string | null;
  telegramId?: string | null;
  telegramUsername?: string | null;
  telegramPhotoUrl?: string | null;
  // بعد از migration گروه ۲:
  phone?: string | null;
  username?: string | null; // یوزرنیم اختصاصی پلتفرم
};

// ─── چک پروفایل ─────────────────────────────────────────────────────────────

type ProfileIssue = {
  field: string;
  label: string;
};

function checkProfileComplete(user: FullUser): ProfileIssue[] {
  const issues: ProfileIssue[] = [];
  if (!user.telegramId) issues.push({ field: "telegram", label: "اتصال به تلگرام" });
  // بعد از migration گروه ۲ این فیلدها اضافه میشن:
  // if (!user.phone) issues.push({ field: "phone", label: "شماره موبایل" });
  // if (!user.username) issues.push({ field: "username", label: "یوزرنیم اختصاصی" });
  return issues;
}

// ─── Props ───────────────────────────────────────────────────────────────────

interface CreateBotDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function CreateBotDialog({ open, onOpenChange, onSuccess }: CreateBotDialogProps) {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [step, setStep] = useState<"profile_check" | "form" | "success">("profile_check");
  const [submitting, setSubmitting] = useState(false);

  // فرم
  const [name, setName] = useState("");
  const [token, setToken] = useState("");
  const [description, setDescription] = useState("");
  const [paymentDescription, setPaymentDescription] = useState("");
  const [paymentAmount, setPaymentAmount] = useState(""); // Z3: مبلغ برای فاکتور
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // اگه کاربر لود نشده
  if (!user) return null;

  const fullUser = user;
  const profileIssues = checkProfileComplete(fullUser);

  // FIX: باز شدن دیالوگ همیشه از بیرون (parent) کنترل می‌شه — چه با کلیک روی
  // دکمه‌ی "Create New Bot" چه با ?create=1 — که مستقیم prop `open` رو true
  // می‌کنه بدون عبور از handleOpenChange. قبلاً محاسبه‌ی step فقط داخل
  // handleOpenChange بود، پس در اون حالت‌ها هیچوقت اجرا نمی‌شد و step روی
  // مقدار پیش‌فرض "profile_check" گیر می‌کرد حتی وقتی پروفایل کامل بود.
  // با useEffect روی خودِ `open` این محاسبه هر بار که دیالوگ باز می‌شه
  // (فارغ از اینکه از کجا trigger شده) دوباره انجام می‌شه.
  useEffect(() => {
    if (open) {
      setStep(profileIssues.length > 0 ? "profile_check" : "form");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function handleOpenChange(val: boolean) {
    if (!val) {
      resetForm();
    }
    onOpenChange(val);
  }

  function resetForm() {
    setStep("profile_check");
    setName("");
    setToken("");
    setDescription("");
    setPaymentDescription("");
    setPaymentAmount("");
    setReceiptFile(null);
    setReceiptPreview(null);
  }

  // آپلود فیش
  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ variant: "destructive", title: "فقط تصویر آپلود کنید (JPG, PNG, ...)" });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({ variant: "destructive", title: "حجم فایل نباید بیشتر از ۵ مگابایت باشد" });
      return;
    }
    setReceiptFile(file);
    // همان data-URL که پیش‌نمایش می‌شود، بعداً به سرور هم می‌رود — پس تبدیل به
    // WebP همین‌جا انجام می‌شود، نه دو بار.
    setReceiptPreview(await toWebpDataUrl(file));
  }

  // ارسال فرم
  async function handleSubmit() {
    if (!name.trim()) {
      toast({ variant: "destructive", title: "نام بات الزامی است" });
      return;
    }
    if (!token.trim()) {
      toast({ variant: "destructive", title: "توکن بات الزامی است" });
      return;
    }
    if (!receiptFile) {
      toast({ variant: "destructive", title: "لطفاً فیش واریزی را آپلود کنید" });
      return;
    }

    setSubmitting(true);
    try {
      // فیش به صورت data-URL می‌رود (MVP — بعداً به S3 وصل میشه). همان نسخه‌ی
      // WebP ای که برای پیش‌نمایش ساخته شد استفاده می‌شود؛ خواندن دوباره‌ی فایل
      // خام یعنی فرستادن یک JPEG چندمگابایتی به‌جای معادل فشرده‌اش.
      const receiptBase64 = receiptPreview ?? (await toWebpDataUrl(receiptFile));

      // ارسال به API
      // نکته: بعد از migration گروه ۲، endpoint /api/bots آپدیت میشه تا
      // paymentDescription و receiptUrl رو هم بپذیره.
      // فعلاً با همین ساختار موجود کار می‌کنیم.
      await customFetch("/api/bots", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          token: token.trim(),
          description: description.trim() || null,
          // فیلدهای پرداخت — بعد از migration فعال میشن:
          paymentDescription: paymentDescription.trim() || null,
          amount: paymentAmount ? Number(paymentAmount) : null, // Z3
          receiptUrl: receiptBase64, // موقت — بعداً URL واقعی
          // وضعیت pending_payment — بعد از migration بک‌اند ست میشه
        }),
      });

      setStep("success");
      onSuccess?.();
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "خطا در ایجاد بات",
        description: err?.message || "لطفاً دوباره تلاش کنید",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">

        {/* ─── مرحله ۱: چک پروفایل ─────────────────────────────── */}
        {step === "profile_check" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="size-5 text-amber-500" />
                پروفایل ناقص است
              </DialogTitle>
              <DialogDescription>
                برای ساخت بات باید موارد زیر را تکمیل کنی:
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-2">
              {profileIssues.map((issue) => (
                <Alert key={issue.field} variant="destructive" className="py-2">
                  <AlertDescription className="flex items-center gap-2">
                    <X className="size-4 shrink-0" />
                    {issue.label} تنظیم نشده
                  </AlertDescription>
                </Alert>
              ))}
            </div>

            <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end sm:gap-3">
              <Button variant="outline" className="w-full sm:w-auto" onClick={() => onOpenChange(false)}>
                بعداً
              </Button>
              <Button
                className="w-full sm:w-auto"
                onClick={() => {
                  onOpenChange(false);
                  setLocation("/profile");
                }}
              >
                <ExternalLink className="size-4 me-2" />
                رفتن به پروفایل
              </Button>
            </div>
          </>
        )}

        {/* ─── مرحله ۲: فرم ─────────────────────────────────────── */}
        {step === "form" && (
          <>
            <DialogHeader>
              <DialogTitle>ساخت بات جدید</DialogTitle>
              <DialogDescription>
                اطلاعات بات و فیش واریزی را وارد کن. بعد از تأیید توسط ادمین، بات فعال می‌شود.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              {/* نام بات */}
              <div className="space-y-1.5">
                <Label htmlFor="bot-name">نام بات *</Label>
                <Input
                  id="bot-name"
                  placeholder="مثلاً: فروشگاه من"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={submitting}
                />
              </div>

              {/* توکن */}
              <div className="space-y-1.5">
                <Label htmlFor="bot-token">توکن بات *</Label>
                <Input
                  id="bot-token"
                  placeholder="123456:ABCdef..."
                  dir="ltr"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  disabled={submitting}
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  توکن رو از @BotFather دریافت کن
                </p>
              </div>

              {/* توضیح بات */}
              <div className="space-y-1.5">
                <Label htmlFor="bot-description">توضیح بات (اختیاری)</Label>
                <Textarea
                  id="bot-description"
                  placeholder="این بات چه کاری انجام می‌دهد؟"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={submitting}
                  rows={2}
                />
              </div>

              {/* فیش پرداخت */}
              <div className="space-y-1.5">
                <Label>فیش واریزی *</Label>
                {receiptPreview ? (
                  <div className="relative rounded-lg border overflow-hidden">
                    <img
                      src={receiptPreview}
                      alt="فیش"
                      className="w-full max-h-40 object-contain bg-muted"
                    />
                    <button
                      type="button"
                      onClick={() => { setReceiptFile(null); setReceiptPreview(null); }}
                      className="absolute top-2 right-2 rounded-full bg-background/80 p-1 hover:bg-background"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={submitting}
                    className="flex w-full flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                  >
                    <Upload className="size-6" />
                    <span className="text-sm">کلیک کن یا فایل را اینجا رها کن</span>
                    <span className="text-xs">JPG, PNG — حداکثر ۵ مگابایت</span>
                  </button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleFileChange}
                />
              </div>

              {/* مبلغ واریزی */}
              <div className="space-y-1.5">
                <Label htmlFor="payment-amount">مبلغ واریزی (تومان)</Label>
                <AmountInput
                  id="payment-amount"
                  placeholder="مثلاً: ۱۵۰۰۰۰"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  disabled={submitting}
                />
              </div>

              {/* توضیح پرداخت */}
              <div className="space-y-1.5">
                <Label htmlFor="payment-desc">توضیح پرداخت (اختیاری)</Label>
                <Input
                  id="payment-desc"
                  placeholder="مثلاً: واریز به کارت ۶۲۱۴... تاریخ ۱۴۰۳/..."
                  value={paymentDescription}
                  onChange={(e) => setPaymentDescription(e.target.value)}
                  disabled={submitting}
                />
              </div>
            </div>

            <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end sm:gap-3">
              <Button variant="outline" className="w-full sm:w-auto" onClick={() => onOpenChange(false)} disabled={submitting}>
                انصراف
              </Button>
              <Button className="w-full sm:w-auto" onClick={handleSubmit} disabled={submitting}>
                {submitting ? (
                  <><Loader2 className="size-4 me-2 animate-spin" /> در حال ارسال...</>
                ) : (
                  "ارسال برای بررسی"
                )}
              </Button>
            </div>
          </>
        )}

        {/* ─── مرحله ۳: موفق ────────────────────────────────────── */}
        {step === "success" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CheckCircle2 className="size-5 text-green-500" />
                درخواست ثبت شد
              </DialogTitle>
            </DialogHeader>
            <div className="py-4 text-sm text-muted-foreground space-y-2">
              <p>درخواست ساخت بات با موفقیت ارسال شد.</p>
              <p>
                بعد از بررسی و تأیید فیش توسط ادمین، یک شیت اختصاصی به بات اختصاص داده می‌شود
                و یک <strong>کد ادمین</strong> از طریق تلگرام برایت ارسال می‌شود.
              </p>
              <p>
                پس از دریافت کد ادمین، آن را در صفحه پروفایل وارد کن تا پنل بات فعال شود.
              </p>
              <p>از طریق پنل بات‌ها وضعیت رو دنبال کن.</p>
            </div>
            <div className="flex justify-end">
              <Button
                className="w-full sm:w-auto"
                onClick={() => {
                  onOpenChange(false);
                  resetForm();
                }}
              >
                بستن
              </Button>
            </div>
          </>
        )}

      </DialogContent>
    </Dialog>
  );
}
