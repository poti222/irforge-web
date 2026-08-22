/**
 * TabDanger.tsx — کارهای برگشت‌ناپذیر یا حساس: توکن، کد ادمین، شیت، حذف بات.
 *
 * محتوای این تب از `BotSettingsForm.tsx` قدیمی منتقل شده. تنها تفاوت رفتاری:
 * رشته‌ها از locale خوانده می‌شوند نه از الگوی `fa ? "..." : "..."` (که فقط دو
 * زبان از پنج زبان را پوشش می‌داد). گیتِ تأیید حذف با تایپ نام بات، و
 * سوپرادمین-بودنِ ویرایش شیت، عیناً حفظ شده‌اند.
 */
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
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Loader2, Save, Trash2, Eye, EyeOff, KeyRound, RefreshCw, Database, ExternalLink, AlertTriangle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useT } from "@/hooks/use-translation";
import { useAuth } from "@/contexts/AuthContext";

export function TabDanger({ bot }: { bot: Bot }) {
  const t = useT("botSettings");
  const td = useT("deleteBot");
  const { user } = useAuth();
  // Phase 15: the sheet is platform-managed. The server enforces this
  // (POST /bots/:botId/sheet is requireSuperAdmin), so this flag only decides
  // whether to render a form that would 403 anyway.
  const isSuperAdmin = user?.role === "super_admin";
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  const [token, setToken] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [showCode, setShowCode] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [adminCode, setAdminCode] = useState(bot.adminCode ?? null);
  const [customCode, setCustomCode] = useState("");

  const currentSheetId = (bot as { sheetId?: string | null }).sheetId ?? null;
  const [sheetId, setSheetId] = useState(currentSheetId ?? "");
  const [savingSheet, setSavingSheet] = useState(false);

  const updateBot = useUpdateBot();
  const deleteBot = useDeleteBot();

  // Exact match, only trimmed — a name differing by case or by a stray
  // character is not the name the user was asked to type.
  const deleteNameMatches = deleteConfirmText.trim() === bot.name.trim();

  function saveToken() {
    if (!token.trim()) return;
    updateBot.mutate(
      { botId: bot.id, data: { token: token.trim() } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetBotQueryKey(bot.id) });
          setToken("");
          toast({ title: t.tokenSaved });
        },
        onError: (err: any) =>
          toast({ variant: "destructive", title: t.errorGeneric, description: err?.data?.error ?? err?.message }),
      }
    );
  }

  function handleDelete() {
    deleteBot.mutate(
      { botId: bot.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListBotsQueryKey() });
          toast({ title: t.botDeleted });
          setLocation("/bots");
        },
        onError: (err: any) =>
          toast({ variant: "destructive", title: t.errorGeneric, description: err?.data?.error ?? err?.message }),
      }
    );
  }

  /**
   * همان endpoint هم کد تصادفی می‌سازد و هم کد دلخواه را می‌پذیرد — تفاوتشان
   * فقط فرستادن یا نفرستادن `adminCode` در بدنه است.
   */
  async function setAdminCodeTo(next: string | null) {
    setRegenerating(true);
    try {
      const res = await customFetch<{ adminCode: string }>(`/api/bots/${bot.id}/regenerate-admin-code`, {
        method: "POST",
        body: JSON.stringify(next ? { adminCode: next } : {}),
      });
      setAdminCode(res.adminCode);
      setShowCode(true);
      setCustomCode("");
      queryClient.invalidateQueries({ queryKey: getGetBotQueryKey(bot.id) });
      toast({ title: t.adminCodeGenerated, description: t.adminCodeSentTelegram });
    } catch (err: any) {
      toast({ variant: "destructive", title: t.errorGeneric, description: err?.data?.error ?? err?.message });
    } finally {
      setRegenerating(false);
    }
  }

  const regenerateAdminCode = () => setAdminCodeTo(null);
  const applyCustomCode = () => setAdminCodeTo(customCode.trim());

  async function saveSheet() {
    const id = sheetId.trim();
    if (!id) {
      toast({ variant: "destructive", title: t.sheetIdRequired });
      return;
    }
    setSavingSheet(true);
    try {
      await customFetch(`/api/bots/${bot.id}/sheet`, { method: "POST", body: JSON.stringify({ sheetId: id }) });
      queryClient.invalidateQueries({ queryKey: getGetBotQueryKey(bot.id) });
      queryClient.invalidateQueries({ queryKey: getListBotsQueryKey() });
      toast({ title: t.sheetRegistered, description: t.sheetRegisteredDesc });
    } catch (err: any) {
      toast({ variant: "destructive", title: t.errorGeneric, description: err?.data?.error ?? err?.message });
    } finally {
      setSavingSheet(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><KeyRound className="h-4 w-4" /> {t.tokenTitle}</CardTitle>
          <CardDescription>{t.tokenDesc}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="danger-token">{t.newToken}</Label>
            <Input
              id="danger-token" dir="ltr" className="font-mono text-sm"
              placeholder={t.newTokenPlaceholder}
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{t.tokenHidden}</p>
          </div>
          <Button onClick={saveToken} disabled={!token.trim() || updateBot.isPending}>
            {updateBot.isPending ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <Save className="me-2 h-4 w-4" />}
            {t.replaceToken}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><KeyRound className="h-4 w-4" /> {t.adminCodeTitle}</CardTitle>
          <CardDescription>{t.adminCodeDesc}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {adminCode ? (
            <div className="flex items-center gap-2">
              <code dir="ltr" className="rounded-md border bg-muted px-3 py-1.5 font-mono tracking-widest">
                {showCode ? adminCode : "•".repeat(adminCode.length)}
              </code>
              <Button variant="ghost" size="icon" onClick={() => setShowCode((s) => !s)} aria-label={t.toggleCodeVisibility}>
                {showCode ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t.adminCodeNone}</p>
          )}
          <Button variant="outline" size="sm" onClick={regenerateAdminCode} disabled={regenerating}>
            {regenerating ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <RefreshCw className="me-2 h-4 w-4" />}
            {t.adminCodeRegenerate}
          </Button>

          {/*
            کد دلخواه. کد تصادفی امن‌تر است ولی هیچ‌کس یادش نمی‌ماند، و کدی که
            یادت نمی‌ماند یعنی هر بار باید در تلگرام دنبال پیامش بگردی.
          */}
          <div className="space-y-1.5 border-t pt-3">
            <Label htmlFor="danger-custom-code">{t.adminCodeCustomLabel}</Label>
            <p className="text-xs text-muted-foreground">{t.adminCodeCustomHint}</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="danger-custom-code"
                dir="ltr"
                className="font-mono"
                autoComplete="off"
                value={customCode}
                minLength={6}
                maxLength={64}
                placeholder={t.adminCodeCustomPlaceholder}
                onChange={(e) => setCustomCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && customCode.trim().length >= 6) applyCustomCode();
                }}
              />
              <Button
                variant="outline"
                className="shrink-0"
                disabled={customCode.trim().length < 6 || regenerating}
                onClick={() => applyCustomCode()}
              >
                {regenerating ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <KeyRound className="me-2 h-4 w-4" />}
                {t.adminCodeCustomApply}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Database className="h-4 w-4" /> {t.sheetTitle}</CardTitle>
          <CardDescription>{isSuperAdmin ? t.sheetDescSuper : t.sheetDescOwner}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {isSuperAdmin ? (
            <div className="space-y-1.5">
              <Label htmlFor="danger-sheet">{t.sheetIdLabel}</Label>
              <Input
                id="danger-sheet" dir="ltr" className="font-mono text-sm"
                placeholder={t.sheetIdPlaceholder}
                value={sheetId}
                onChange={(e) => setSheetId(e.target.value)}
                data-testid="bot-sheet-id"
              />
              <p className="text-xs text-muted-foreground">{t.sheetIdHint}</p>
            </div>
          ) : (
            // Visibility was never the problem — mutation was. The owner still
            // sees which sheet backs their bot, and can open it, but the input
            // and the register button are gone.
            <div className="space-y-1.5">
              <Label>{t.sheetIdLabel}</Label>
              <p
                dir="ltr"
                className="break-all rounded-md border bg-muted/50 px-3 py-2 font-mono text-sm text-muted-foreground"
                data-testid="bot-sheet-id-readonly"
              >
                {currentSheetId ?? "—"}
              </p>
              <p className="text-xs text-muted-foreground">
                {t.sheetChangeAsk}{" "}
                <Link href="/tickets" className="font-medium text-primary hover:underline">
                  {t.sheetChangeTicket}
                </Link>
              </p>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {isSuperAdmin && (
              <Button onClick={saveSheet} disabled={savingSheet} data-testid="save-bot-sheet">
                {savingSheet ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <Save className="me-2 h-4 w-4" />}
                {t.sheetRegister}
              </Button>
            )}
            {currentSheetId && (
              <a href={`https://docs.google.com/spreadsheets/d/${currentSheetId}`} target="_blank" rel="noopener noreferrer">
                <Button variant="outline" size="sm">
                  <ExternalLink className="me-1.5 h-4 w-4" />
                  {t.sheetOpen}
                </Button>
              </a>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="border-red-500/40">
        <CardHeader>
          <CardTitle className="text-red-500">{t.deleteTitle}</CardTitle>
          <CardDescription>{t.deleteDesc}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="me-2 h-4 w-4" /> {t.deleteCta}
          </Button>
        </CardContent>
      </Card>

      <AlertDialog
        open={confirmDelete}
        onOpenChange={(open) => {
          setConfirmDelete(open);
          // Reset the typed confirmation whenever the dialog closes, so
          // reopening it never starts with the button already enabled.
          if (!open) setDeleteConfirmText("");
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="size-5 shrink-0" />
              {td.title}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-start">
                <p>{td.permanent.replace("{name}", bot.name)}</p>
                <p>{td.dataLoss}</p>
                <p className="font-medium text-destructive">{td.noRefund}</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>

          {/* Typed-name gate: this is irreversible AND unrefundable, so a
              single click is not enough friction. */}
          <div className="space-y-1.5">
            <Label htmlFor="confirm-bot-name">{td.confirmLabel}</Label>
            <Input
              id="confirm-bot-name"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder={td.confirmPlaceholder.replace("{name}", bot.name)}
              autoComplete="off"
              data-testid="confirm-bot-name"
            />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteBot.isPending}>{td.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleDelete(); }}
              disabled={deleteBot.isPending || !deleteNameMatches}
              className="bg-red-600 hover:bg-red-700"
              data-testid="confirm-delete-bot"
            >
              {deleteBot.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
              {td.confirmCta}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
