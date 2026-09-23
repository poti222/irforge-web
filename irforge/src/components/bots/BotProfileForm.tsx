import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import type { Bot } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, Save, ImageUp, Film, Trash2, IdCard } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/hooks/use-language";
import { useDraft } from "@/components/bots/settings/useDraft";

interface TelegramProfile {
  name: string | null;
  description: string | null;
  shortDescription: string | null;
  /**
   * URL پروکسیِ عکس فعلی بات (`/api/bots/:id/avatar?v=…`) یا null.
   *
   * سرور عمداً file_id خام نمی‌دهد: تبدیل file_id به URL قابل دانلود نیازمند
   * توکن خودِ بات است و آن URL توکن را داخل خودش دارد، پس هرگز نباید به
   * مرورگر برسد.
   */
  photoUrl: string | null;
}

const NAME_MAX = 64;
const DESC_MAX = 512;
const SHORT_DESC_MAX = 120;

/**
 * کدهای ISO 639-1 — همان ۵ زبونی که خودِ سایت پشتیبانی می‌کنه. `null` یعنی
 * «پیش‌فرض»: بدونِ language_code، همان متنی که تلگرام به هر کاربری که
 * زبونش یکی از این ۵ تا (یا هر زبونِ دیگه‌ای) نباشه و برایِ آن اختصاصاً
 * چیزی تنظیم نشده باشه نشون می‌ده.
 */
const PROFILE_LANG_CODES: Array<string | null> = [null, "fa", "en", "ar", "ru", "tr"];

const NATIVE_LANG_NAME: Record<string, string> = {
  fa: "فارسی",
  en: "English",
  ar: "العربية",
  ru: "Русский",
  tr: "Türkçe",
};

type ProfileDraftValue = { name: string; description: string; shortDescription: string };

function pickDraft(p: TelegramProfile): ProfileDraftValue {
  return { name: p.name ?? "", description: p.description ?? "", shortDescription: p.shortDescription ?? "" };
}

/**
 * Editor for the bot's *actual* Telegram profile (setMyName / setMyDescription /
 * setMyShortDescription / setMyProfilePhoto), fetched live from Telegram —
 * deliberately separate from the site's own bots.name/description fields
 * (BotSettingsForm), which are internal metadata and never reach Telegram.
 *
 * نام/توضیحات/توضیحِ کوتاه به تفکیکِ زبان: خودِ این سه متد یک `language_code`
 * اختیاری دارند — بدونش همان متنِ «پیش‌فرض» که این فایل تا الان فقط همان را
 * می‌خواند/می‌نویسد. با انتخابِ یکی از ۵ زبونِ سایت، override اختصاصیِ همان
 * زبان خوانده/نوشته می‌شود؛ خالی‌گذاشتن و ذخیره یعنی حذفِ همان override
 * (تلگرام خودش این‌طور تعریفش کرده — نگاه کن docstring پارامترهای بک‌اند).
 */
export function BotProfileForm({ bot }: { bot: Bot }) {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);

  const [activeLang, setActiveLang] = useState<string | null>(null);
  /** زبونِ مقصدی که منتظرِ تأییدِ «دور ریختنِ تغییرات» است. */
  const [pendingLang, setPendingLang] = useState<{ code: string | null } | null>(null);

  const profileQueryKey = ["bot-telegram-profile", bot.id, activeLang ?? "__default__"];
  const { data: loaded, isLoading } = useQuery({
    queryKey: profileQueryKey,
    queryFn: () =>
      customFetch<TelegramProfile>(
        `/api/bots/${bot.id}/telegram-profile${activeLang ? `?lang=${encodeURIComponent(activeLang)}` : ""}`
      ),
  });

  const draft = useDraft<ProfileDraftValue>(
    `botProfile:${bot.id}:${activeLang ?? "default"}`,
    loaded ? pickDraft(loaded) : undefined
  );

  function requestLang(next: string | null) {
    if (next === activeLang) return;
    if (draft.dirty) {
      setPendingLang({ code: next });
      return;
    }
    setActiveLang(next);
  }

  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [removingPhoto, setRemovingPhoto] = useState(false);
  /** عکسِ نمایش‌داده‌شده — عکس مالِ زبان نیست، هر تبی همون یکی رو می‌بینه؛
   *  سوییچِ زبان هم (کوئریِ تازه) هم یک invalidate بعدِ آپلود/حذف این را
   *  دوباره از `loaded.photoUrl` پر می‌کند. */
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  useEffect(() => {
    if (loaded) setPhotoPreview(loaded.photoUrl);
  }, [loaded]);

  /** بعدِ آپلود/حذفِ عکس، همه‌ی تب‌هایِ زبانِ کش‌شده هم باید عکسِ تازه رو ببینن — عکس مشترکه، مالِ یک زبون نیست. */
  function invalidateAllProfileTabs() {
    queryClient.invalidateQueries({ queryKey: ["bot-telegram-profile", bot.id] });
  }

  async function handleSave() {
    setSaving(true);
    try {
      await customFetch(`/api/bots/${bot.id}/telegram-profile`, {
        method: "PATCH",
        body: JSON.stringify({
          name: draft.value.name.trim(),
          description: draft.value.description.trim(),
          shortDescription: draft.value.shortDescription.trim(),
          ...(activeLang ? { language: activeLang } : {}),
        }),
      });
      draft.markSaved();
      queryClient.invalidateQueries({ queryKey: profileQueryKey });
      toast({ title: fa ? "پروفایل بات به‌روزرسانی شد" : "Bot profile updated" });
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: fa ? "خطا در ذخیره پروفایل" : "Failed to save profile",
        description: err?.data?.error ?? err?.message,
      });
    } finally {
      setSaving(false);
    }
  }

  function handlePhotoPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ variant: "destructive", title: fa ? "فقط تصویر" : "Image only" });
      return;
    }
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUrl = ev.target?.result as string;
      setPhotoPreview(dataUrl);
      setUploadingPhoto(true);
      try {
        const saved = await customFetch<{ photoUrl: string | null }>(
          `/api/bots/${bot.id}/telegram-profile/photo`,
          { method: "POST", body: JSON.stringify({ photo: dataUrl, type: "static" }) }
        );
        // پیش‌نمایش محلی با نسخه‌ی واقعیِ روی تلگرام جایگزین می‌شود — اگر
        // تلگرام تصویر را برش داده باشد، کاربر همان چیزی را می‌بیند که واقعاً
        // روی پروفایل بات نشسته، نه فایلی که خودش انتخاب کرد.
        if (saved.photoUrl) setPhotoPreview(saved.photoUrl);
        invalidateAllProfileTabs();
        toast({ title: fa ? "عکس پروفایل تغییر کرد" : "Profile photo updated" });
      } catch (err: any) {
        // برگشت به عکس قبلی، نه به خالی: یک آپلود ناموفق نباید باعث شود کاربر
        // فکر کند عکس فعلی بات هم پاک شده.
        setPhotoPreview(loaded?.photoUrl ?? null);
        toast({
          variant: "destructive",
          title: fa ? "خطا در آپلود عکس" : "Failed to upload photo",
          description: err?.data?.error ?? err?.message,
        });
      } finally {
        setUploadingPhoto(false);
      }
    };
    reader.readAsDataURL(file);
  }

  /**
   * عکسِ متحرک (ویدیوییِ MPEG4) — همان چیزی که خودِ کاربرهایِ معمولیِ
   * تلگرام برایِ آواتارِ متحرک استفاده می‌کنند، حالا برایِ بات هم موجوده
   * (`InputProfilePhotoAnimated`). برخلافِ عکسِ ثابت، اینجا پیش‌نمایشِ محلی
   * نمی‌سازیم — یک data-URLِ ویدیویی در `<img>` رندر نمی‌شود؛ بعدِ آپلود،
   * فریمِ ایستایی که خودِ تلگرام از ویدیو می‌سازد را از همان مسیرِ همیشگیِ
   * عکس (`photoUrl`) می‌خوانیم.
   */
  function handleVideoPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("video/")) {
      toast({ variant: "destructive", title: fa ? "فقط ویدیو" : "Video only" });
      return;
    }
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUrl = ev.target?.result as string;
      setUploadingVideo(true);
      try {
        const saved = await customFetch<{ photoUrl: string | null }>(
          `/api/bots/${bot.id}/telegram-profile/photo`,
          { method: "POST", body: JSON.stringify({ photo: dataUrl, type: "animated" }) }
        );
        if (saved.photoUrl) setPhotoPreview(saved.photoUrl);
        invalidateAllProfileTabs();
        toast({ title: fa ? "عکسِ متحرکِ پروفایل تنظیم شد" : "Animated profile photo set" });
      } catch (err: any) {
        toast({
          variant: "destructive",
          title: fa ? "خطا در آپلودِ ویدیو" : "Failed to upload video",
          description: err?.data?.error ?? err?.message,
        });
      } finally {
        setUploadingVideo(false);
      }
    };
    reader.readAsDataURL(file);
  }

  async function handleRemovePhoto() {
    setRemovingPhoto(true);
    try {
      await customFetch(`/api/bots/${bot.id}/telegram-profile/photo`, { method: "DELETE" });
      setPhotoPreview(null);
      invalidateAllProfileTabs();
      toast({ title: fa ? "عکس پروفایل حذف شد" : "Profile photo removed" });
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: fa ? "خطا در حذف عکس" : "Failed to remove photo",
        description: err?.data?.error ?? err?.message,
      });
    } finally {
      setRemovingPhoto(false);
    }
  }

  /** روی زبونِ غیرِپیش‌فرض، هر سه فیلد خالی یعنی هنوز override ای برایِ همین زبون ست نشده. */
  const noDedicatedOverride =
    !isLoading && activeLang !== null && !draft.value.name && !draft.value.description && !draft.value.shortDescription;

  return (
    <div className="max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <IdCard className="h-4 w-4" /> {fa ? "پروفایل بات" : "Bot profile"}
          </CardTitle>
          <CardDescription>
            {fa
              ? "این اطلاعات مستقیماً روی پروفایل واقعی بات در تلگرام تنظیم می‌شود."
              : "This information is set directly on the bot's real Telegram profile."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>{fa ? "زبان" : "Language"}</Label>
            {/* نوارِ زبان همیشه رندر می‌شود، حتی وسطِ لودِ یک زبونِ تازه‌بازدیدشده —
                وگرنه هر سوییچِ زبان کلِ کارت را یک لحظه به اسکلتون می‌برد. */}
            <Tabs
              value={activeLang ?? "__default__"}
              onValueChange={(v) => requestLang(v === "__default__" ? null : v)}
            >
              <div className="-mx-1 overflow-x-auto px-1 pb-1">
                <TabsList className="w-max">
                  {PROFILE_LANG_CODES.map((code) => (
                    <TabsTrigger key={code ?? "__default__"} value={code ?? "__default__"}>
                      {code === null ? (fa ? "پیش‌فرض" : "Default") : NATIVE_LANG_NAME[code]}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </div>
            </Tabs>
            <p className="text-xs text-muted-foreground">
              {activeLang === null
                ? fa
                  ? "همان متنی که به کاربرانی نشان داده می‌شود که برای زبان تلگرامشان اختصاصاً چیزی تنظیم نکرده‌ای."
                  : "Shown to any user whose Telegram language has no dedicated text of its own set below."
                : fa
                  ? "فقط برای کاربرانی که زبان تلگرامشان همین است. خالی بگذار تا برای همین زبان از متن پیش‌فرض استفاده شود."
                  : "Only for users whose Telegram language is this one. Leave empty to fall back to the default text for this language."}
            </p>
            {noDedicatedOverride && (
              <p className="rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                {fa
                  ? "هنوز برای این زبان متنِ اختصاصی تنظیم نشده — الان همان متنِ پیش‌فرض نشان داده می‌شود."
                  : "No dedicated text set for this language yet — the default text is currently shown."}
              </p>
            )}
          </div>

          {isLoading ? (
            <div className="space-y-4">
              <div className="h-20 animate-pulse rounded-md bg-muted" />
              <div className="h-24 animate-pulse rounded-md bg-muted" />
              <div className="h-16 animate-pulse rounded-md bg-muted" />
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="tg-name">{fa ? "نام بات" : "Bot name"}</Label>
                <Input
                  id="tg-name"
                  value={draft.value.name}
                  maxLength={NAME_MAX}
                  onChange={(e) => draft.set("name", e.target.value)}
                />
                <p className="text-xs text-muted-foreground">{draft.value.name.length}/{NAME_MAX}</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tg-desc">{fa ? "توضیحات کامل" : "Full description"}</Label>
                <Textarea
                  id="tg-desc"
                  rows={3}
                  value={draft.value.description}
                  maxLength={DESC_MAX}
                  onChange={(e) => draft.set("description", e.target.value)}
                  placeholder={
                    fa
                      ? "همان متنی که قبل از /start در چت خالی نشان داده می‌شود."
                      : "Shown in the empty chat before the user taps /start."
                  }
                />
                <p className="text-xs text-muted-foreground">{draft.value.description.length}/{DESC_MAX}</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tg-short-desc">{fa ? "توضیح کوتاه" : "Short description"}</Label>
                <Input
                  id="tg-short-desc"
                  value={draft.value.shortDescription}
                  maxLength={SHORT_DESC_MAX}
                  onChange={(e) => draft.set("shortDescription", e.target.value)}
                  placeholder={
                    fa
                      ? "همان متنی که در پروفایل بات و پیام‌های فوروارد شده نشان داده می‌شود."
                      : "Shown in the bot's profile and on forwarded messages."
                  }
                />
                <p className="text-xs text-muted-foreground">
                  {draft.value.shortDescription.length}/{SHORT_DESC_MAX}
                </p>
              </div>
              <Button onClick={handleSave} disabled={saving || !draft.dirty}>
                {saving ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <Save className="me-2 h-4 w-4" />}
                {fa ? "ذخیره پروفایل" : "Save profile"}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{fa ? "عکس پروفایل" : "Profile photo"}</CardTitle>
          <CardDescription>
            {fa
              ? "عکس یا ویدیوی پروفایلِ فعلیِ بات در تلگرام را تغییر بده یا حذف کن."
              : "Change or remove the bot's current Telegram profile photo or video."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-4">
          <Avatar className="h-16 w-16">
            {photoPreview && <AvatarImage src={photoPreview} alt={draft.value.name || bot.name} />}
            <AvatarFallback>{(draft.value.name || bot.name || "?").slice(0, 1).toUpperCase()}</AvatarFallback>
          </Avatar>
          <div className="flex flex-wrap items-center gap-2">
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoPick} />
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploadingPhoto}>
              {uploadingPhoto ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <ImageUp className="me-2 h-4 w-4" />}
              {fa ? "آپلود عکس جدید" : "Upload new photo"}
            </Button>
            <input ref={videoRef} type="file" accept="video/*" className="hidden" onChange={handleVideoPick} />
            <Button variant="outline" size="sm" onClick={() => videoRef.current?.click()} disabled={uploadingVideo}>
              {uploadingVideo ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <Film className="me-2 h-4 w-4" />}
              {fa ? "آپلود عکس متحرک" : "Upload animated photo"}
            </Button>
            <Button variant="ghost" size="sm" onClick={handleRemovePhoto} disabled={removingPhoto}>
              {removingPhoto ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <Trash2 className="me-2 h-4 w-4" />}
              {fa ? "حذف عکس" : "Remove photo"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={pendingLang !== null} onOpenChange={(open) => !open && setPendingLang(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{fa ? "تغییراتِ ذخیره‌نشده" : "Unsaved changes"}</AlertDialogTitle>
            <AlertDialogDescription>
              {fa
                ? "اگر زبانِ دیگری را انتخاب کنی، تغییراتِ ذخیره‌نشده‌ی این فرم از بین می‌روند."
                : "Switching language will discard this form's unsaved changes."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{fa ? "همین‌جا بمان" : "Stay"}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                const next = pendingLang;
                setPendingLang(null);
                if (next) setActiveLang(next.code);
              }}
            >
              {fa ? "نادیده بگیر و برو" : "Discard and switch"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
