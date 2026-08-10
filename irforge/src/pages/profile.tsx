import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PasswordInput } from "@/components/ui/password-input";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/hooks/use-language";
import { customFetch } from "@workspace/api-client-react";
import { TelegramLoginButton, type TelegramWidgetUser } from "@/components/telegram-login-button";
import { TelegramLinkPanel } from "@/components/auth/TelegramLinkPanel";
import { useTelegramWebApp } from "@/hooks/use-telegram-webapp";
import { Send, Info, Loader2, Save, KeyRound, LogOut, ShieldCheck} from "lucide-react";

type ProfileUser = {
  id: string;
  name: string;
  email: string;
  avatar?: string | null;
  role?: string;
  telegramId?: string | null;
  telegramUsername?: string | null;
  telegramFirstName?: string | null;
  telegramLastName?: string | null;
  telegramPhotoUrl?: string | null;
};

const TELEGRAM_BOT_USERNAME = import.meta.env.VITE_TELEGRAM_BOT_USERNAME as string | undefined;

export default function Profile() {
  const { user, refreshUser, logout } = useAuth();
  const { toast } = useToast();
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const [linking, setLinking] = useState(false);
  const [waitingForBot, setWaitingForBot] = useState(false);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);
  const { isInsideTelegram, user: tgUser, initData, ready, expand } = useTelegramWebApp();

  // Z8: edit-profile + change-password state
  const [name, setName] = useState((user as any)?.name ?? "");
  const [email, setEmail] = useState((user as any)?.email ?? "");
  const [bio, setBio] = useState((user as any)?.bio ?? "");
  const [savingProfile, setSavingProfile] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  // BUG FIX: بک‌اند از قبل POST /api/auth/super-admin-code رو داشت (routes/superAdmin.ts)
  // ولی هیچ‌جای سایت فراخوانیش نمی‌کرد — یعنی حتی با داشتن کد هم راهی برای
  // واردکردنش نبود. این بخش همون فرم گمشده رو اضافه می‌کنه.
  const [superAdminCode, setSuperAdminCode] = useState("");
  const [submittingSuperAdminCode, setSubmittingSuperAdminCode] = useState(false);

  async function submitSuperAdminCode() {
    if (!superAdminCode.trim()) {
      toast({ variant: "destructive", title: fa ? "کد را وارد کنید" : "Enter a code" });
      return;
    }
    setSubmittingSuperAdminCode(true);
    try {
      await customFetch("/api/auth/super-admin-code", {
        method: "POST",
        body: JSON.stringify({ code: superAdminCode.trim() }),
      });
      setSuperAdminCode("");
      await refreshUser();
      toast({ title: fa ? "شما مدیر کل شدید" : "You are now a super admin" });
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: fa ? "کد نامعتبر است" : "Invalid code",
        description: err?.data?.error || err?.message,
      });
    } finally {
      setSubmittingSuperAdminCode(false);
    }
  }

  async function saveProfile() {
    if (!name.trim()) {
      toast({ variant: "destructive", title: fa ? "نام الزامی است" : "Name is required" });
      return;
    }
    if (!email.trim()) {
      toast({ variant: "destructive", title: fa ? "ایمیل الزامی است" : "Email is required" });
      return;
    }
    setSavingProfile(true);
    try {
      await customFetch("/api/users/profile", {
        method: "PATCH",
        body: JSON.stringify({ name: name.trim(), email: email.trim(), bio: bio.trim() || null }),
      });
      await refreshUser();
      toast({ title: fa ? "پروفایل ذخیره شد" : "Profile saved" });
    } catch (err: any) {
      toast({ variant: "destructive", title: fa ? "خطا در ذخیره پروفایل" : "Could not save profile", description: err?.data?.error || err?.message });
    } finally {
      setSavingProfile(false);
    }
  }

  async function changePassword() {
    if (!currentPassword || !newPassword) {
      toast({ variant: "destructive", title: fa ? "هر دو رمز الزامی است" : "Both passwords are required" });
      return;
    }
    if (newPassword.length < 6) {
      toast({ variant: "destructive", title: fa ? "رمز جدید حداقل ۶ کاراکتر" : "New password must be at least 6 characters" });
      return;
    }
    setSavingPassword(true);
    try {
      await customFetch("/api/users/password", {
        method: "PATCH",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setCurrentPassword("");
      setNewPassword("");
      toast({ title: fa ? "رمز عبور تغییر کرد" : "Password changed" });
    } catch (err: any) {
      toast({ variant: "destructive", title: fa ? "خطا در تغییر رمز" : "Password change failed", description: err?.data?.error || err?.message });
    } finally {
      setSavingPassword(false);
    }
  }

  // اگه داخل Mini App هست، WebApp رو آماده کن
  useEffect(() => {
    if (isInsideTelegram) {
      ready();
      expand();
    }
  }, [isInsideTelegram]);

  if (!user) return null;
  const u = user;

  const isTelegramLinked = Boolean(u.telegramId);
  const displayAvatar = u.telegramPhotoUrl || u.avatar || "";
  const telegramFullName = [u.telegramFirstName, u.telegramLastName].filter(Boolean).join(" ");

  // لینک کردن از طریق Mini App (initData)
  async function handleMiniAppLink() {
    if (!initData) return;
    setLinking(true);
    try {
      await customFetch("/api/auth/telegram/miniapp", {
        method: "POST",
        body: JSON.stringify({ initData }),
      });
      await refreshUser();
      toast({
        title: fa ? "تلگرام متصل شد" : "Telegram connected",
        description: fa ? "حساب تلگرام شما وصل شد." : "Your Telegram profile is now linked.",
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: fa ? "اتصال تلگرام ناموفق بود" : "Couldn't connect Telegram",
        description: error?.message || (fa ? "دوباره تلاش کنید." : "Please try again."),
      });
    } finally {
      setLinking(false);
    }
  }

  // لینک کردن از طریق Login Widget (خارج از تلگرام)
  async function handleTelegramAuth(tgWidgetUser: TelegramWidgetUser) {
    setLinking(true);
    try {
      await customFetch("/api/auth/telegram", {
        method: "POST",
        body: JSON.stringify(tgWidgetUser),
      });
      await refreshUser();
      toast({
        title: fa ? "تلگرام متصل شد" : "Telegram connected",
        description: fa ? "عکس پروفایل و یوزرنیم تلگرام شما وصل شد." : "Your Telegram profile photo and username are now linked.",
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: fa ? "اتصال تلگرام ناموفق بود" : "Couldn't connect Telegram",
        description: error?.message || (fa ? "دوباره تلاش کنید." : "Please try again."),
      });
    } finally {
      setLinking(false);
    }
  }

  // G8: اتصال با ربات — لینک عمیق t.me/<bot>?start=<token>، بدون تایپ کد
  async function handleBotConnect() {
    setLinking(true);
    try {
      const { token } = await customFetch<{ token: string; expiresAt: string }>(
        "/api/auth/telegram/link/start",
        { method: "POST" }
      );
      window.open(`https://t.me/${TELEGRAM_BOT_USERNAME}?start=${token}`, "_blank");
      setWaitingForBot(true);

      const startedAt = Date.now();
      const POLL_INTERVAL_MS = 2500;
      const POLL_TIMEOUT_MS = 2 * 60 * 1000;

      const poll = async () => {
        if (!mountedRef.current) return;
        if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
          setWaitingForBot(false);
          return;
        }
        const fresh = await customFetch<ProfileUser>("/api/auth/me").catch(() => null);
        if (!mountedRef.current) return;
        if (fresh?.telegramId) {
          setWaitingForBot(false);
          await refreshUser();
          toast({
            title: fa ? "تلگرام متصل شد" : "Telegram connected",
            description: fa ? "حساب تلگرام شما وصل شد." : "Your Telegram account is now linked.",
          });
          return;
        }
        setTimeout(poll, POLL_INTERVAL_MS);
      };
      setTimeout(poll, POLL_INTERVAL_MS);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: fa ? "اتصال تلگرام ناموفق بود" : "Couldn't connect Telegram",
        description: error?.data?.error || error?.message || (fa ? "دوباره تلاش کنید." : "Please try again."),
      });
    } finally {
      setLinking(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{fa ? "تنظیمات پروفایل" : "Profile Settings"}</h1>

      <Card>
        <CardHeader>
          <CardTitle>{fa ? "اطلاعات شخصی" : "Personal Information"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center gap-4 sm:gap-6">
            <Avatar className="h-16 w-16 shrink-0 sm:h-20 sm:w-20">
              <AvatarImage src={displayAvatar} />
              <AvatarFallback className="text-2xl">{user.name.charAt(0)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <h3 className="font-medium text-lg truncate">{user.name}</h3>
              <p className="text-muted-foreground truncate">{user.email}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Z8: edit profile */}
      <Card>
        <CardHeader>
          <CardTitle>{fa ? "ویرایش پروفایل" : "Edit Profile"}</CardTitle>
          <CardDescription>{fa ? "نام، ایمیل و بیوگرافی خود را ویرایش کنید." : "Update your name, email and bio."}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="pf-name">{fa ? "نام" : "Name"}</Label>
            <Input id="pf-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pf-email">{fa ? "ایمیل" : "Email"}</Label>
            <Input id="pf-email" type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pf-bio">{fa ? "بیوگرافی" : "Bio"}</Label>
            <Textarea id="pf-bio" rows={2} value={bio} onChange={(e) => setBio(e.target.value)} />
          </div>
          <Button onClick={saveProfile} disabled={savingProfile}>
            {savingProfile ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <Save className="me-2 h-4 w-4" />}
            {fa ? "ذخیره" : "Save"}
          </Button>
        </CardContent>
      </Card>

      {/* Z8: change password (works after X1 fix) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><KeyRound className="size-4" /> {fa ? "تغییر رمز عبور" : "Change Password"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="pf-cur">{fa ? "رمز فعلی" : "Current password"}</Label>
            <PasswordInput id="pf-cur" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pf-new">{fa ? "رمز جدید" : "New password"}</Label>
            <PasswordInput id="pf-new" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </div>
          <Button onClick={changePassword} disabled={savingPassword}>
            {savingPassword ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <KeyRound className="me-2 h-4 w-4" />}
            {fa ? "تغییر رمز" : "Change password"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Send className="size-4 text-primary" />
            Telegram
          </CardTitle>
          <CardDescription>
            {isTelegramLinked
              ? (fa ? "حساب تلگرام شما متصل است و در زیر نمایش داده می‌شود." : "Your Telegram identity is linked and shown automatically below.")
              : (fa ? "حساب تلگرام خود را وصل کنید تا عکس پروفایل و یوزرنیم به‌طور خودکار وارد شود." : "Connect your Telegram account to automatically pull in your profile photo and username.")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* تلگرام حالا برای **ورود** لازم است، نه فقط یک تزئین پروفایل.
              این را صریح می‌گوییم تا کسی به‌اشتباه فکر نکند اختیاری است.
              قطع اتصال در این صفحه وجود ندارد و عمداً اضافه نشده: قطع‌کردنش
              کاربر را تا وصل‌کردن یک حساب تازه از ورود محروم می‌کند. */}
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
            <p>
              {fa
                ? "ورود به حساب از این پس به کدی نیاز دارد که در تلگرام فرستاده می‌شود. تا وقتی حساب تلگرام دیگری وصل نکرده‌اید، قطع این اتصال ورود شما را مسدود می‌کند."
                : "Signing in now requires a code sent to Telegram. Disconnecting would block your login until another Telegram account is connected."}
            </p>
          </div>
          {isTelegramLinked ? (
            // حساب لینک شده — نمایش اطلاعات
            <div className="flex items-center gap-4">
              <Avatar className="h-14 w-14">
                <AvatarImage src={u.telegramPhotoUrl || ""} />
                <AvatarFallback>{(u.telegramFirstName ?? "T").charAt(0)}</AvatarFallback>
              </Avatar>
              <div className="space-y-1">
                {telegramFullName && <p className="font-medium">{telegramFullName}</p>}
                {u.telegramUsername && (
                  <Badge variant="secondary" className="font-mono">@{u.telegramUsername}</Badge>
                )}
              </div>
            </div>
          ) : isInsideTelegram && tgUser ? (
            // داخل Mini App — دکمه اتصال خودکار
            <div className="space-y-3">
              <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
                <Avatar className="h-10 w-10">
                  <AvatarImage src={tgUser.photo_url || ""} />
                  <AvatarFallback>{tgUser.first_name.charAt(0)}</AvatarFallback>
                </Avatar>
                <div>
                  <p className="font-medium text-sm">
                    {[tgUser.first_name, tgUser.last_name].filter(Boolean).join(" ")}
                  </p>
                  {tgUser.username && (
                    <p className="text-xs text-muted-foreground">@{tgUser.username}</p>
                  )}
                </div>
              </div>
              <Button
                onClick={handleMiniAppLink}
                disabled={linking}
                className="w-full"
              >
                {linking ? (
                  <><Loader2 className="size-4 me-2 animate-spin" /> {fa ? "در حال اتصال…" : "Connecting…"}</>
                ) : (
                  <><Send className="size-4 me-2" /> {fa ? "اتصال این حساب تلگرام" : "Connect this Telegram account"}</>
                )}
              </Button>
            </div>
          ) : TELEGRAM_BOT_USERNAME ? (
            // خارج از تلگرام — گزینه‌ی اصلی: اتصال با ربات (لینک عمیق، بدون تایپ کد)
            <div className="space-y-4">
              {waitingForBot ? (
                <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3 text-sm">
                  <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
                  <span>
                    {fa
                      ? "منتظر تایید در تلگرام هستیم — بات را باز کرده و روی Start بزنید."
                      : "Waiting for confirmation in Telegram — open the bot and tap Start."}
                  </span>
                </div>
              ) : (
                <Button onClick={handleBotConnect} disabled={linking} className="w-full">
                  {linking ? (
                    <><Loader2 className="size-4 me-2 animate-spin" /> {fa ? "در حال آماده‌سازی…" : "Preparing…"}</>
                  ) : (
                    <><Send className="size-4 me-2" /> {fa ? "اتصال با ربات" : "Connect via bot"}</>
                  )}
                </Button>
              )}
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <div className="h-px flex-1 bg-border" />
                {fa ? "یا با ویجت تلگرام" : "or with the Telegram widget"}
                <div className="h-px flex-1 bg-border" />
              </div>
              <TelegramLoginButton botUsername={TELEGRAM_BOT_USERNAME} onAuth={handleTelegramAuth} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {fa
                ? "ورود با تلگرام هنوز پیکربندی نشده — برای فعال‌سازی، VITE_TELEGRAM_BOT_USERNAME و TELEGRAM_BOT_TOKEN را تنظیم کنید."
                : "Telegram login isn't configured yet — set VITE_TELEGRAM_BOT_USERNAME and TELEGRAM_BOT_TOKEN to enable this."}
            </p>
          )}

          {linking && <p className="text-sm text-muted-foreground">{fa ? "در حال اتصال حساب…" : "Linking your account…"}</p>}

          <div className="flex items-start gap-2 rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
            <Info className="size-4 shrink-0 mt-0.5" />
            <span>
              {fa
                ? "تلگرام فقط نام، یوزرنیم و عکس پروفایل شما را از طریق این ورود به اشتراک می‌گذارد — شماره تلفن شما اینجا به اشتراک گذاشته نمی‌شود."
                : "Telegram only shares your name, username, and profile photo through this login — it never shares your phone number here. To collect a phone number you'd need a separate \"share contact\" step inside an actual chat with a bot."}
            </span>
          </div>
        </CardContent>
      </Card>

      {u.role !== "super_admin" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><KeyRound className="size-4" /> {fa ? "کد مدیر کل" : "Super Admin Code"}</CardTitle>
            <CardDescription>
              {fa
                ? "اگر کد مدیر کل (SUPER_ADMIN_CODE) پلتفرم را دارید، اینجا وارد کنید تا به بخش‌های مدیر کل — از جمله «پرداخت‌های در انتظار تأیید» و «استخر شیت‌ها» — دسترسی پیدا کنید."
                : "If you have the platform's Super Admin Code, enter it here to unlock the super-admin sections — including pending payment approvals and the sheet pool."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="pf-sa-code">{fa ? "کد" : "Code"}</Label>
              <Input
                id="pf-sa-code"
                value={superAdminCode}
                onChange={(e) => setSuperAdminCode(e.target.value)}
                placeholder={fa ? "کد را اینجا وارد کنید" : "Enter the code"}
              />
            </div>
            <Button onClick={submitSuperAdminCode} disabled={submittingSuperAdminCode}>
              {submittingSuperAdminCode ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <KeyRound className="me-2 h-4 w-4" />}
              {fa ? "فعال‌سازی" : "Activate"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Z8: logout on the page itself (in addition to the sidebar dropdown) */}
      <div className="flex justify-end">
        <Button variant="outline" onClick={logout} className="text-destructive hover:text-destructive">
          <LogOut className="me-2 size-4" /> {fa ? "خروج از حساب" : "Log out"}
        </Button>
      </div>
    </div>
  );
}
