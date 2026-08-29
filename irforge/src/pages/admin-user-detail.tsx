import { useRef, useState } from "react";
import { Link, useParams } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { AmountInput } from "@/components/ui/amount-input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PasswordInput } from "@/components/ui/password-input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  ArrowLeft, ArrowRight, Copy, ShieldAlert, Loader2, KeyRound, Send, Info,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/hooks/use-language";
import { isRtlLang } from "@/lib/i18n";
import { auditActionLabel, describeAuditDetail } from "@/lib/auditLog";
import { useAuth } from "@/contexts/AuthContext";

/**
 * جزئیات کاربر برای super_admin.
 *
 * ⚠️ **هیچ‌جای این صفحه رمز کاربر را نشان نمی‌دهد و هیچ اندپوینتی رمز یا هش
 * برنمی‌گرداند.** رمزها هش bcrypt هستند — یک تبدیل عمداً یک‌طرفه. جایی که یک
 * فیلد «نمایش رمز» انتظار می‌رفت، توضیح نشسته است. اگر روزی چنین کنترلی اینجا
 * ظاهر شد، پیاده‌سازی غلط است.
 */

interface AdminUser {
  id: string; name: string; email: string; phone: string | null;
  phoneVerified: boolean; role: string; status: string; plan: string;
  telegramId: string | null; telegramUsername: string | null;
  profileComplete: boolean; createdAt: string; lastLogin: string | null;
  // ─── Mandatory Profile Completion & Identity System ─────────────
  gender: "male" | "female" | null; platformUsername: string | null;
  flaggedForReview: boolean; flagReason: string | null; flaggedAt: string | null;
}

interface AdminUserBilling {
  walletBalance: number;
  planId: string;
  planName: string;
  planStatus: string;
  planExpiresAt: string | null;
}

interface AdminPlan {
  id: string; name: string; price: number; interval: string;
}

export default function AdminUserDetail() {
  const { id } = useParams<{ id: string }>();
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user: viewer } = useAuth();
  const isSelf = Boolean(viewer && viewer.id === id);
  const BackArrow = isRtlLang(lang) ? ArrowRight : ArrowLeft;

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [gender, setGender] = useState<"male" | "female" | "">("");
  const [platformUsername, setPlatformUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [reason, setReason] = useState("");
  const [selectedPlanId, setSelectedPlanId] = useState<string>("__free__");
  const [durationDays, setDurationDays] = useState("");
  const [walletDirection, setWalletDirection] = useState<"credit" | "debit">("credit");
  const [walletAmount, setWalletAmount] = useState("");
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  // دکمه‌های غیرفعال کلیک نمی‌فرستند (disabled:pointer-events-none در
  // Button)، پس کلیک از رویشان مستقیم به همین دیوِ اطراف‌شان می‌رسد —
  // این تابع همان‌جا صدا زده می‌شود تا کاربر مجبور نباشد خودش بفهمد چرا
  // دکمه کار نمی‌کند.
  function focusReason() {
    reasonRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    reasonRef.current?.focus();
  }

  const key = ["admin-user", id];
  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: async () => {
      const r = await customFetch<{ user: AdminUser; activity: any; billing: AdminUserBilling }>(
        `/api/superadmin/users/${id}`,
      );
      setName(r.user.name); setEmail(r.user.email); setPhone(r.user.phone ?? "");
      setGender(r.user.gender ?? ""); setPlatformUsername(r.user.platformUsername ?? "");
      setSelectedPlanId(r.billing.planId === "free" ? "__free__" : r.billing.planId);
      return r;
    },
    enabled: Boolean(id),
  });

  const { data: plans } = useQuery({
    queryKey: ["admin-plans"],
    queryFn: () => customFetch<AdminPlan[]>("/api/admin/plans"),
  });

  const { data: audit } = useQuery({
    queryKey: ["admin-user-audit", id],
    queryFn: () => customFetch<any[]>(`/api/superadmin/users/${id}/audit`),
    enabled: Boolean(id),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: key });
    queryClient.invalidateQueries({ queryKey: ["admin-user-audit", id] });
  };

  function onError(err: any) {
    toast({ variant: "destructive", title: fa ? "خطا" : "Error", description: err?.data?.error });
  }

  const saveIdentity = useMutation({
    mutationFn: () =>
      customFetch(`/api/superadmin/users/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ name, email, phone, gender: gender || undefined, platformUsername, reason }),
      }),
    onSuccess: () => { invalidate(); toast({ title: fa ? "ذخیره شد" : "Saved" }); },
    onError,
  });

  const setPassword = useMutation({
    mutationFn: () =>
      customFetch(`/api/superadmin/users/${id}/password`, {
        method: "POST",
        body: JSON.stringify({ password: newPassword, reason }),
      }),
    onSuccess: () => {
      invalidate(); setNewPassword("");
      toast({
        title: fa ? "رمز تغییر کرد" : "Password changed",
        description: fa
          ? "همه‌ی نشست‌ها بسته شدند و کاربر در تلگرام مطلع شد."
          : "All sessions were revoked and the user was notified on Telegram.",
      });
    },
    onError,
  });

  const resetTelegram = useMutation({
    mutationFn: () =>
      customFetch(`/api/superadmin/users/${id}/telegram-reset`, {
        method: "POST", body: JSON.stringify({ reason }),
      }),
    onSuccess: () => { invalidate(); toast({ title: fa ? "اتصال تلگرام پاک شد" : "Telegram link cleared" }); },
    onError,
  });

  const changeRole = useMutation({
    mutationFn: (role: string) =>
      customFetch(`/api/superadmin/users/${id}/role`, {
        method: "POST", body: JSON.stringify({ role, reason }),
      }),
    onSuccess: () => { invalidate(); toast({ title: fa ? "نقش تغییر کرد" : "Role changed" }); },
    onError,
  });

  const revokeSessions = useMutation({
    mutationFn: () =>
      customFetch(`/api/superadmin/users/${id}/revoke-sessions`, {
        method: "POST", body: JSON.stringify({ reason }),
      }),
    onSuccess: () => { invalidate(); toast({ title: fa ? "نشست‌ها بسته شدند" : "Sessions revoked" }); },
    onError,
  });

  const impersonate = useMutation({
    mutationFn: () =>
      customFetch<{ token: string }>(`/api/superadmin/users/${id}/impersonate`, {
        method: "POST", body: JSON.stringify({ reason }),
      }),
    onSuccess: (res: any) => {
      sessionStorage.setItem("impersonation_token", res.token);
      toast({
        title: fa ? "نشست جعل هویت ساخته شد" : "Impersonation session created",
        description: fa
          ? "فقط خواندنی، حداکثر ۳۰ دقیقه. اقدامات مخرب مسدودند."
          : "Read-only, 30 minutes max. Destructive actions are blocked.",
      });
    },
    onError,
  });

  const changePlan = useMutation({
    mutationFn: () =>
      customFetch(`/api/superadmin/users/${id}/plan`, {
        method: "POST",
        body: JSON.stringify({
          planId: selectedPlanId === "__free__" ? null : selectedPlanId,
          durationDays: durationDays.trim() ? Number(durationDays) : null,
          reason,
        }),
      }),
    onSuccess: () => { invalidate(); toast({ title: fa ? "پلن تغییر کرد" : "Plan changed" }); },
    onError,
  });

  const adjustWallet = useMutation({
    mutationFn: () =>
      customFetch(`/api/superadmin/users/${id}/wallet-adjust`, {
        method: "POST",
        body: JSON.stringify({ direction: walletDirection, amount: Number(walletAmount), reason }),
      }),
    onSuccess: () => {
      invalidate();
      setWalletAmount("");
      toast({ title: fa ? "کیف پول به‌روزرسانی شد" : "Wallet updated" });
    },
    onError,
  });

  const reasonTooShort = reason.trim().length < 5;
  const u = data?.user;
  const billing = data?.billing;

  if (isLoading || !u) {
    return <div className="mx-auto max-w-3xl p-6"><div className="h-40 animate-pulse rounded-md bg-muted" /></div>;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 md:p-6">
      <Button variant="ghost" size="sm" asChild className="-ms-2">
        <Link href="/admin/users"><BackArrow className="me-2 size-4" /> {fa ? "همه‌ی کاربران" : "All users"}</Link>
      </Button>

      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">{u.name}</h1>
        <p className="text-sm text-muted-foreground" dir="ltr">{u.email}</p>
      </div>

      {/* دلیل مشترک همه‌ی اقدامات — بدون آن، اقدامات مخرب اجرا نمی‌شوند. */}
      <Card className={reasonTooShort ? "border-amber-500/50" : undefined}>
        <CardContent className="space-y-2 p-4">
          <Label htmlFor="reason">{fa ? "دلیل (برای لاگ ممیزی)" : "Reason (for the audit log)"}</Label>
          <Textarea
            id="reason" ref={reasonRef} rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder={fa ? "چه چیزی را تأیید کردید و چرا؟" : "What did you verify, and why?"}
          />
          {reasonTooShort && (
            <p className="text-xs font-medium text-amber-500">
              {fa
                ? "تا این‌جا را پر نکنی، تغییر نقش، تغییر پلن، شارژ/کسر کیف پول، تنظیم رمز و پاک‌کردن اتصال تلگرام — همه در پایین همین صفحه غیرفعال می‌مانند."
                : "Until this is filled in, changing the role, changing the plan, crediting/debiting the wallet, setting a password, and resetting the Telegram link — all further down this page — stay disabled."}
            </p>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="identity">
        <TabsList className="flex-wrap">
          <TabsTrigger value="identity">{fa ? "هویت" : "Identity"}</TabsTrigger>
          <TabsTrigger value="telegram">Telegram</TabsTrigger>
          <TabsTrigger value="account">{fa ? "حساب" : "Account"}</TabsTrigger>
          <TabsTrigger value="billing">{fa ? "پلن و کیف پول" : "Plan & Wallet"}</TabsTrigger>
          <TabsTrigger value="security">{fa ? "امنیت" : "Security"}</TabsTrigger>
          <TabsTrigger value="audit">{fa ? "ممیزی" : "Audit"}</TabsTrigger>
        </TabsList>

        <TabsContent value="identity">
          <Card>
            <CardContent className="space-y-3 p-5">
              <div className="space-y-1.5">
                <Label htmlFor="u-name">{fa ? "نام کامل" : "Full name"}</Label>
                <Input id="u-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="u-email">{fa ? "ایمیل" : "Email"}</Label>
                <Input id="u-email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="u-phone">{fa ? "شماره" : "Phone"}</Label>
                <Input id="u-phone" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} />
                <p className="text-xs text-muted-foreground">
                  {fa
                    ? "تغییر ایمیل یا شماره، فلگ تأیید متناظر را پاک می‌کند — ویرایش ادمین تأیید نیست."
                    : "Changing the email or phone clears its verified flag — an admin edit is not verification."}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="u-gender">{fa ? "جنسیت" : "Gender"}</Label>
                <Select value={gender || "__none__"} onValueChange={(v) => setGender(v === "__none__" ? "" : (v as "male" | "female"))}>
                  <SelectTrigger id="u-gender" className="w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">{fa ? "تعیین‌نشده" : "Not set"}</SelectItem>
                    <SelectItem value="male">{fa ? "آقا" : "Male"}</SelectItem>
                    <SelectItem value="female">{fa ? "خانم" : "Female"}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="u-username">{fa ? "یوزرنیم پلتفرم" : "Platform username"}</Label>
                <Input
                  id="u-username" dir="ltr" value={platformUsername}
                  onChange={(e) => setPlatformUsername(e.target.value.toLowerCase())}
                />
              </div>
              {u.flaggedForReview && (
                <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
                  <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden="true" />
                  <span>
                    {fa ? "این حساب برای بازبینی علامت خورده — دلیل: " : "This account is flagged for review — reason: "}
                    <span className="font-medium">{u.flagReason ?? "manual_report"}</span>
                    {fa ? ". برای پاک کردن فلگ به «صفِ بازبینی» بروید." : ". Clear it from the Review Queue."}
                  </span>
                </div>
              )}
              <Button onClick={() => saveIdentity.mutate()} disabled={saveIdentity.isPending}>
                {saveIdentity.isPending && <Loader2 className="me-2 size-4 animate-spin" />}
                {fa ? "ذخیره" : "Save"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="telegram">
          <Card>
            <CardContent className="space-y-3 p-5 text-sm" onClick={() => reasonTooShort && focusReason()}>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">{fa ? "شناسه عددی" : "Numeric ID"}</span>
                <span className="flex items-center gap-2">
                  <code dir="ltr">{u.telegramId ?? "—"}</code>
                  {u.telegramId && (
                    <Button
                      size="icon" variant="ghost" className="size-7"
                      aria-label={fa ? "کپی" : "Copy"}
                      onClick={() => navigator.clipboard.writeText(u.telegramId!)}
                    >
                      <Copy className="size-3.5" />
                    </Button>
                  )}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">@username</span>
                <code dir="ltr">{u.telegramUsername ? `@${u.telegramUsername}` : "—"}</code>
              </div>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="sm" disabled={reasonTooShort}>
                    <ShieldAlert className="me-2 size-4" />
                    {fa ? "پاک کردن اتصال تلگرام" : "Reset Telegram link"}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{fa ? "اتصال تلگرام پاک شود؟" : "Reset Telegram link?"}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {fa
                        ? "کاربر می‌تواند حساب تلگرام تازه‌ای وصل کند. قبل از این کار حتماً هویت او را تأیید کنید — ریست روی درخواست تأییدنشده یعنی تصرف حساب."
                        : "The user can then link a fresh Telegram account. Verify their identity first — a reset on an unverified request is an account takeover."}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{fa ? "انصراف" : "Cancel"}</AlertDialogCancel>
                    <AlertDialogAction onClick={() => resetTelegram.mutate()}>
                      {fa ? "پاک کن" : "Reset"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              {reasonTooShort && (
                <p className="text-xs text-muted-foreground">
                  {fa ? "برای این کار باید دلیل بنویسید." : "A written reason is required for this action."}
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="account">
          <Card>
            <CardContent className="space-y-4 p-5" onClick={() => reasonTooShort && focusReason()}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{u.role}</Badge>
                <Badge variant="secondary">{u.status}</Badge>
                <Badge variant="secondary">{u.plan}</Badge>
              </div>
              <div className="space-y-1.5">
                <Label>{fa ? "نقش" : "Role"}</Label>
                <Select
                  value={u.role}
                  onValueChange={(role) => {
                    if (
                      (role === "super_admin" || u.role === "super_admin") &&
                      !window.confirm(
                        fa
                          ? `این تغییر دسترسی «سوپر ادمین» را می‌دهد یا می‌گیرد — یعنی توانایی تغییر نقش‌ها، تنظیم رمز کاربران و جعل هویت. مطمئنید؟`
                          : `This grants or removes "super admin" — the ability to change roles, set user passwords and impersonate. Are you sure?`,
                      )
                    ) return;
                    changeRole.mutate(role);
                  }}
                  disabled={reasonTooShort || isSelf}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">user</SelectItem>
                    <SelectItem value="admin">admin</SelectItem>
                    <SelectItem value="super_admin">super_admin</SelectItem>
                  </SelectContent>
                </Select>
                {isSelf ? (
                  <p className="text-xs text-muted-foreground">
                    {fa
                      ? "نقشِ خودتان را از همین‌جا نمی‌توانید عوض کنید — از یک حساب super_admin دیگر این کار را انجام دهید."
                      : "You can't change your own role from here — do it from another super_admin's account."}
                  </p>
                ) : reasonTooShort && (
                  <p className="text-xs text-muted-foreground">
                    {fa ? "برای این کار باید دلیل بنویسید (بالای صفحه)." : "A written reason is required for this action (top of the page)."}
                  </p>
                )}
              </div>
              <div className="text-sm text-muted-foreground">
                {fa ? "ربات‌ها" : "Bots"}: {data.activity.botCount} ·{" "}
                {fa ? "تیکت‌ها" : "Tickets"}: {data.activity.ticketCount} ·{" "}
                {fa ? "نشست‌ها" : "Sessions"}: {data.activity.sessionCount}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="billing" className="space-y-4">
          {/*
            هر دو اقدام اینجا — override پلن و شارژ/کسرِ دستیِ کیف‌پول — کاملاً
            جدا از مسیرِ خودِ کاربر است (`routes/plans.ts`، `routes/wallet.ts`):
            بدون کسرِ کیف‌پول، بدون تأیید فیش. برای اصلاحِ اشتباه یا
            حسن‌نیتِ پشتیبانی است، نه یک خرید.
          */}
          <Card>
            <CardHeader><CardTitle className="text-base">{fa ? "پلن" : "Plan"}</CardTitle></CardHeader>
            <CardContent className="space-y-3" onClick={() => reasonTooShort && focusReason()}>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted-foreground">{fa ? "پلن فعلی:" : "Current plan:"}</span>
                <Badge variant="secondary">{billing?.planName}</Badge>
                <Badge variant={billing?.planStatus === "active" ? "default" : "outline"}>{billing?.planStatus}</Badge>
                {billing?.planExpiresAt && (
                  <span className="text-xs text-muted-foreground">
                    {fa ? "تا " : "Until "}{new Date(billing.planExpiresAt).toLocaleDateString(fa ? "fa-IR" : "en-US")}
                  </span>
                )}
              </div>

              <div className="space-y-1.5">
                <Label>{fa ? "پلن جدید" : "New plan"}</Label>
                <Select value={selectedPlanId} onValueChange={setSelectedPlanId} disabled={reasonTooShort}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__free__">{fa ? "رایگان (بدون پلن)" : "Free (no plan)"}</SelectItem>
                    {(plans ?? []).map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedPlanId !== "__free__" && (
                <div className="space-y-1.5">
                  <Label>{fa ? "مدت (روز، اختیاری — خالی یعنی بدون انقضا)" : "Duration (days, optional — empty means no expiry)"}</Label>
                  <Input
                    type="number" dir="ltr" min="1" value={durationDays}
                    onChange={(e) => setDurationDays(e.target.value)}
                  />
                </div>
              )}

              <Button onClick={() => changePlan.mutate()} disabled={reasonTooShort || changePlan.isPending}>
                {changePlan.isPending && <Loader2 className="me-2 size-4 animate-spin" />}
                {fa ? "اعمالِ پلن" : "Apply plan"}
              </Button>
              <p className="text-xs text-muted-foreground">
                {fa
                  ? "این کار هیچ پولی از کیف پول کم نمی‌کند — یک override اداری است."
                  : "This never charges the wallet — it's an administrative override."}
              </p>
              {reasonTooShort && (
                <p className="text-xs text-muted-foreground">
                  {fa ? "برای این کار باید دلیل بنویسید (بالای صفحه)." : "A written reason is required for this action (top of the page)."}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">{fa ? "کیف پول" : "Wallet"}</CardTitle></CardHeader>
            <CardContent className="space-y-3" onClick={() => reasonTooShort && focusReason()}>
              <div className="text-sm">
                <span className="text-muted-foreground">{fa ? "موجودی فعلی:" : "Current balance:"}</span>{" "}
                <span className="font-semibold">{billing?.walletBalance?.toLocaleString(fa ? "fa-IR" : "en-US")}</span>
              </div>

              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1.5">
                  <Label>{fa ? "نوع" : "Direction"}</Label>
                  <Select value={walletDirection} onValueChange={(v) => setWalletDirection(v as "credit" | "debit")} disabled={reasonTooShort}>
                    <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="credit">{fa ? "شارژ" : "Credit"}</SelectItem>
                      <SelectItem value="debit">{fa ? "کسر" : "Debit"}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>{fa ? "مبلغ (تومان)" : "Amount (Toman)"}</Label>
                  <AmountInput
                    value={walletAmount}
                    onChange={(e) => setWalletAmount(e.target.value)}
                    className="w-40"
                  />
                </div>
                <Button
                  onClick={() => adjustWallet.mutate()}
                  disabled={reasonTooShort || adjustWallet.isPending || !walletAmount || Number(walletAmount) <= 0}
                >
                  {adjustWallet.isPending && <Loader2 className="me-2 size-4 animate-spin" />}
                  {fa ? "اعمال" : "Apply"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {fa
                  ? "کسر نمی‌تواند موجودی را منفی کند — اگر ناکافی باشد رد می‌شود."
                  : "A debit can never take the balance negative — it's rejected if insufficient."}
              </p>
              {reasonTooShort && (
                <p className="text-xs text-muted-foreground">
                  {fa ? "برای این کار باید دلیل بنویسید (بالای صفحه)." : "A written reason is required for this action (top of the page)."}
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="security">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <KeyRound className="size-4" /> {fa ? "امنیت" : "Security"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 p-5 pt-0" onClick={() => reasonTooShort && focusReason()}>
              {/* جایی که یک فیلد «نمایش رمز» انتظار می‌رفت. */}
              <div className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-sm">
                <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <p className="text-muted-foreground">
                  {fa
                    ? "رمز کاربران قابل نمایش نیست. رمزها به‌صورت یک‌طرفه (bcrypt) ذخیره می‌شوند و هیچ مرحله‌ی رمزگشایی وجود ندارد — می‌شود رمز تازه گذاشت، ولی هرگز رمز فعلی را خواند. برای «می‌خواهم ببینم کاربر چه می‌بیند» از جعل هویت استفاده کنید."
                    : "A user's password cannot be shown. Passwords are stored one-way (bcrypt) and there is no decryption step — a new one can be set, but the existing one can never be read. For “I need to see what this user sees”, use impersonation."}
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="u-newpass">{fa ? "رمز جدید" : "New password"}</Label>
                <PasswordInput
                  id="u-newpass" value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  {fa
                    ? "همه‌ی نشست‌های کاربر بسته می‌شوند و در تلگرام به او اطلاع داده می‌شود."
                    : "Every session is revoked and the user is notified on Telegram."}
                </p>
              </div>
              <Button
                onClick={() => setPassword.mutate()}
                disabled={setPassword.isPending || newPassword.length < 8 || reasonTooShort}
              >
                {setPassword.isPending && <Loader2 className="me-2 size-4 animate-spin" />}
                {fa ? "تنظیم رمز جدید" : "Set new password"}
              </Button>

              <div className="flex flex-wrap gap-2 border-t pt-4">
                <Button variant="outline" size="sm" disabled={reasonTooShort} onClick={() => revokeSessions.mutate()}>
                  {fa ? "بستن همه‌ی نشست‌ها" : "Sign out everywhere"}
                </Button>
                <Button variant="outline" size="sm" disabled={reasonTooShort} onClick={() => impersonate.mutate()}>
                  <Send className="me-2 size-4" />
                  {fa ? "جعل هویت (فقط خواندنی)" : "Impersonate (read-only)"}
                </Button>
              </div>
              {reasonTooShort && (
                <p className="text-xs text-muted-foreground">
                  {fa ? "برای این اقدامات باید دلیل بنویسید (بالای صفحه)." : "A written reason is required for these actions (top of the page)."}
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="audit">
          <Card>
            <CardContent className="space-y-2 p-5">
              {audit && audit.length > 0 ? (
                audit.map((a) => {
                  const detail = describeAuditDetail(a.action, a.metadata, fa);
                  return (
                    <div key={a.id} className="rounded-md border p-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{auditActionLabel(a.action, fa)}</Badge>
                        <span className="text-xs text-muted-foreground">
                          {new Date(a.createdAt).toLocaleString(fa ? "fa-IR" : "en-US")}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {fa ? "توسط" : "by"} {a.actor?.name ?? a.actor?.id}
                      </p>
                      {detail && <p className="mt-1 font-medium">{detail}</p>}
                      {a.reason && <p className="mt-1 text-muted-foreground">{a.reason}</p>}
                    </div>
                  );
                })
              ) : (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {fa ? "هنوز اقدامی ثبت نشده." : "No actions recorded yet."}
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
