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
import { Loader2, Save, ImageUp, Trash2, IdCard } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/hooks/use-language";

interface TelegramProfile {
  name: string | null;
  description: string | null;
  shortDescription: string | null;
}

const SHORT_DESC_MAX = 120;

/**
 * Editor for the bot's *actual* Telegram profile (setMyName / setMyDescription /
 * setMyShortDescription / setMyProfilePhoto), fetched live from Telegram —
 * deliberately separate from the site's own bots.name/description fields
 * (BotSettingsForm), which are internal metadata and never reach Telegram.
 */
export function BotProfileForm({ bot }: { bot: Bot }) {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const profileQueryKey = ["bot-telegram-profile", bot.id];
  const { data: loaded, isLoading } = useQuery({
    queryKey: profileQueryKey,
    queryFn: () => customFetch<TelegramProfile>(`/api/bots/${bot.id}/telegram-profile`),
  });

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [shortDescription, setShortDescription] = useState("");
  useEffect(() => {
    if (loaded) {
      setName(loaded.name ?? "");
      setDescription(loaded.description ?? "");
      setShortDescription(loaded.shortDescription ?? "");
    }
  }, [loaded]);

  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [removingPhoto, setRemovingPhoto] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    try {
      await customFetch(`/api/bots/${bot.id}/telegram-profile`, {
        method: "PATCH",
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          shortDescription: shortDescription.trim(),
        }),
      });
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
        await customFetch(`/api/bots/${bot.id}/telegram-profile/photo`, {
          method: "POST",
          body: JSON.stringify({ photo: dataUrl }),
        });
        toast({ title: fa ? "عکس پروفایل تغییر کرد" : "Profile photo updated" });
      } catch (err: any) {
        setPhotoPreview(null);
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

  async function handleRemovePhoto() {
    setRemovingPhoto(true);
    try {
      await customFetch(`/api/bots/${bot.id}/telegram-profile/photo`, { method: "DELETE" });
      setPhotoPreview(null);
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

  if (isLoading) {
    return (
      <div className="max-w-2xl space-y-6">
        <div className="h-40 animate-pulse rounded-md bg-muted" />
        <div className="h-32 animate-pulse rounded-md bg-muted" />
      </div>
    );
  }

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
            <Label htmlFor="tg-name">{fa ? "نام بات" : "Bot name"}</Label>
            <Input id="tg-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tg-desc">{fa ? "توضیحات کامل" : "Full description"}</Label>
            <Textarea
              id="tg-desc"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={
                fa
                  ? "همان متنی که قبل از /start در چت خالی نشان داده می‌شود."
                  : "Shown in the empty chat before the user taps /start."
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tg-short-desc">{fa ? "توضیح کوتاه" : "Short description"}</Label>
            <Input
              id="tg-short-desc"
              value={shortDescription}
              maxLength={SHORT_DESC_MAX}
              onChange={(e) => setShortDescription(e.target.value)}
              placeholder={
                fa
                  ? "همان متنی که در پروفایل بات و پیام‌های فوروارد شده نشان داده می‌شود."
                  : "Shown in the bot's profile and on forwarded messages."
              }
            />
            <p className="text-xs text-muted-foreground">
              {shortDescription.length}/{SHORT_DESC_MAX}
            </p>
          </div>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <Save className="me-2 h-4 w-4" />}
            {fa ? "ذخیره پروفایل" : "Save profile"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{fa ? "عکس پروفایل" : "Profile photo"}</CardTitle>
          <CardDescription>
            {fa ? "عکس فعلی پروفایل بات در تلگرام را تغییر بده یا حذف کن." : "Change or remove the bot's current Telegram profile photo."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-4">
          <Avatar className="h-16 w-16">
            {photoPreview && <AvatarImage src={photoPreview} alt={name || bot.name} />}
            <AvatarFallback>{(name || bot.name || "?").slice(0, 1).toUpperCase()}</AvatarFallback>
          </Avatar>
          <div className="flex flex-wrap items-center gap-2">
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoPick} />
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploadingPhoto}>
              {uploadingPhoto ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <ImageUp className="me-2 h-4 w-4" />}
              {fa ? "آپلود عکس جدید" : "Upload new photo"}
            </Button>
            <Button variant="ghost" size="sm" onClick={handleRemovePhoto} disabled={removingPhoto}>
              {removingPhoto ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <Trash2 className="me-2 h-4 w-4" />}
              {fa ? "حذف عکس" : "Remove photo"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
