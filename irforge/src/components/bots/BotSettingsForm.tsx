import { useState } from "react";
import {
  useUpdateBot,
  useDeleteBot,
  customFetch,
  getGetBotQueryKey,
  getListBotsQueryKey,
} from "@workspace/api-client-react";
import type { Bot } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, Save, Trash2, Eye, EyeOff, KeyRound, RefreshCw, Database, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/hooks/use-language";

export function BotSettingsForm({ bot }: { bot: Bot }) {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  const [name, setName] = useState(bot.name);
  const [description, setDescription] = useState(bot.description ?? "");
  const [token, setToken] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [adminCode, setAdminCode] = useState(bot.adminCode ?? null);

  const currentSheetId = (bot as { sheetId?: string | null }).sheetId ?? null;
  const [sheetId, setSheetId] = useState(currentSheetId ?? "");
  const [savingSheet, setSavingSheet] = useState(false);

  const updateBot = useUpdateBot();
  const deleteBot = useDeleteBot();

  function handleSave() {
    if (!name.trim()) {
      toast({ variant: "destructive", title: fa ? "نام ربات الزامی است" : "Bot name is required" });
      return;
    }
    const data: { name?: string; description?: string; token?: string } = {
      name: name.trim(),
      description: description.trim(),
    };
    if (token.trim()) data.token = token.trim();
    updateBot.mutate(
      { botId: bot.id, data },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetBotQueryKey(bot.id) });
          queryClient.invalidateQueries({ queryKey: getListBotsQueryKey() });
          setToken("");
          toast({ title: fa ? "تنظیمات ذخیره شد" : "Settings saved" });
        },
        onError: (err: any) =>
          toast({ variant: "destructive", title: fa ? "خطا در ذخیره" : "Save failed", description: err?.message }),
      }
    );
  }

  function handleDelete() {
    deleteBot.mutate(
      { botId: bot.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListBotsQueryKey() });
          toast({ title: fa ? "ربات حذف شد" : "Bot deleted" });
          setLocation("/bots");
        },
        onError: (err: any) =>
          toast({ variant: "destructive", title: fa ? "خطا در حذف" : "Delete failed", description: err?.message }),
      }
    );
  }

  // V3: regenerate the per-bot admin code (new backend endpoint).
  async function regenerateAdminCode() {
    setRegenerating(true);
    try {
      const res = await customFetch<{ adminCode: string }>(`/api/bots/${bot.id}/regenerate-admin-code`, {
        method: "POST",
      });
      setAdminCode(res.adminCode);
      setShowCode(true);
      queryClient.invalidateQueries({ queryKey: getGetBotQueryKey(bot.id) });
      toast({
        title: fa ? "کد ادمین جدید ساخته شد" : "New admin code generated",
        description: fa ? "کد جدید از طریق تلگرام هم ارسال شد." : "The new code was also sent via Telegram.",
      });
    } catch (err: any) {
      toast({ variant: "destructive", title: fa ? "خطا" : "Error", description: err?.message });
    } finally {
      setRegenerating(false);
    }
  }

  // G2: register/replace this bot's Google Sheet — the auto-purchase bot then
  // picks it up (renames the file + registers token→sheet in the registry).
  async function saveSheet() {
    const id = sheetId.trim();
    if (!id) {
      toast({ variant: "destructive", title: fa ? "شناسه شیت لازم است" : "Sheet ID is required" });
      return;
    }
    setSavingSheet(true);
    try {
      await customFetch(`/api/bots/${bot.id}/sheet`, { method: "POST", body: JSON.stringify({ sheetId: id }) });
      queryClient.invalidateQueries({ queryKey: getGetBotQueryKey(bot.id) });
      queryClient.invalidateQueries({ queryKey: getListBotsQueryKey() });
      toast({
        title: fa ? "شیت ثبت شد" : "Sheet registered",
        description: fa ? "بات از این شیت استفاده می‌کند و در رجیستری ثبت شد." : "The bot now uses this sheet and it's registered.",
      });
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: fa ? "خطا" : "Error",
        description: err?.data?.error ?? err?.message,
      });
    } finally {
      setSavingSheet(false);
    }
  }

  const saving = updateBot.isPending;

  return (
    <div className="max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{fa ? "تنظیمات ربات" : "Bot settings"}</CardTitle>
          <CardDescription>{fa ? "اطلاعات پایه ربات را ویرایش کنید." : "Edit your bot's basic information."}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="set-name">{fa ? "نام ربات" : "Bot name"}</Label>
            <Input id="set-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="set-desc">{fa ? "توضیح" : "Description"}</Label>
            <Textarea id="set-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="set-token">{fa ? "توکن جدید (اختیاری)" : "New token (optional)"}</Label>
            <Input
              id="set-token" dir="ltr" className="font-mono text-sm"
              placeholder={fa ? "برای تغییر توکن وارد کنید" : "Enter to replace the token"}
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {fa ? "توکن فعلی به دلایل امنیتی نمایش داده نمی‌شود." : "The current token is hidden for security."}
            </p>
          </div>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <Save className="me-2 h-4 w-4" />}
            {fa ? "ذخیره تغییرات" : "Save changes"}
          </Button>
        </CardContent>
      </Card>

      {/* V3: admin code — reveal + regenerate */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><KeyRound className="h-4 w-4" /> {fa ? "کد ادمین بات" : "Bot admin code"}</CardTitle>
          <CardDescription>
            {fa
              ? "این کد برای فعال‌سازی پنل مدیریت ربات در تلگرام استفاده می‌شود."
              : "This code activates the bot's admin panel inside Telegram."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {adminCode ? (
            <div className="flex items-center gap-2">
              <code dir="ltr" className="rounded-md border bg-muted px-3 py-1.5 font-mono tracking-widest">
                {showCode ? adminCode : "••••••••"}
              </code>
              <Button variant="ghost" size="icon" onClick={() => setShowCode((s) => !s)} aria-label="toggle code">
                {showCode ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {fa ? "هنوز کد ادمینی صادر نشده است (بعد از تأیید پرداخت صادر می‌شود)." : "No admin code yet (issued after payment approval)."}
            </p>
          )}
          <Button variant="outline" size="sm" onClick={regenerateAdminCode} disabled={regenerating}>
            {regenerating ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <RefreshCw className="me-2 h-4 w-4" />}
            {fa ? "تولید کد جدید" : "Generate new code"}
          </Button>
        </CardContent>
      </Card>

      {/* G2: Google Sheet — register/replace the bot's database sheet */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Database className="h-4 w-4" /> {fa ? "گوگل‌شیت بات (دیتابیس)" : "Bot Google Sheet (database)"}</CardTitle>
          <CardDescription>
            {fa
              ? "شناسه شیت اختصاصی این بات را وارد کن؛ بات خرید خودکار از همین شیت می‌خواند و می‌نویسد. اول شیت را با ایمیل سرویس‌اکانت به‌عنوان Editor به اشتراک بگذار."
              : "Set this bot's own spreadsheet ID; the auto-purchase bot reads/writes it. Share the sheet with the service-account email as Editor first."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="set-sheet">{fa ? "Google Spreadsheet ID" : "Google Spreadsheet ID"}</Label>
            <Input
              id="set-sheet" dir="ltr" className="font-mono text-sm"
              placeholder={fa ? "مثلاً 1AbC…XyZ" : "e.g. 1AbC…XyZ"}
              value={sheetId}
              onChange={(e) => setSheetId(e.target.value)}
              data-testid="bot-sheet-id"
            />
            <p className="text-xs text-muted-foreground">
              {fa ? "فقط ID خودِ شیت (بخش وسط لینک)، نه کل آدرس." : "Just the ID (the middle part of the URL), not the whole link."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={saveSheet} disabled={savingSheet} data-testid="save-bot-sheet">
              {savingSheet ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <Save className="me-2 h-4 w-4" />}
              {fa ? "ثبت شیت" : "Register sheet"}
            </Button>
            {currentSheetId && (
              <a href={`https://docs.google.com/spreadsheets/d/${currentSheetId}`} target="_blank" rel="noopener noreferrer">
                <Button variant="outline" size="sm">
                  <ExternalLink className="me-1.5 h-4 w-4" />
                  {fa ? "باز کردن شیت فعلی" : "Open current sheet"}
                </Button>
              </a>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Danger zone — delete */}
      <Card className="border-red-500/40">
        <CardHeader>
          <CardTitle className="text-red-500">{fa ? "حذف ربات" : "Delete bot"}</CardTitle>
          <CardDescription>
            {fa ? "این عمل قابل بازگشت نیست. تمام دستورات و پلاگین‌ها حذف می‌شوند." : "This cannot be undone. All commands and plugins are removed."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="me-2 h-4 w-4" /> {fa ? "حذف این ربات" : "Delete this bot"}
          </Button>
        </CardContent>
      </Card>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{fa ? "حذف ربات؟" : "Delete bot?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {fa
                ? `ربات «${bot.name}» و همه داده‌های آن برای همیشه حذف می‌شوند.`
                : `“${bot.name}” and all of its data will be permanently deleted.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteBot.isPending}>{fa ? "انصراف" : "Cancel"}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleDelete(); }}
              disabled={deleteBot.isPending}
              className="bg-red-600 hover:bg-red-700"
            >
              {deleteBot.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
              {fa ? "حذف دائمی" : "Delete permanently"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
