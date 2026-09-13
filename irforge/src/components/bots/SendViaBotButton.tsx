/**
 * SendViaBotButton.tsx — «با بات بفرست».
 * ─────────────────────────────────────────────────────────────────────────────
 * بعضی محتواها را نمی‌شود در یک فرم وب ساخت: یک پیام تلگرامی با فرمت کامل،
 * یک ویس، یا پیامی که کاربر می‌خواهد از جای دیگری فوروارد کند. این کامپوننت
 * یک جلسه‌ی کوتاه‌عمر می‌سازد، لینک عمیق بات پلتفرم را باز می‌کند، و تا وقتی
 * کاربر تمام کند وضعیت را می‌پرسد.
 *
 * عمداً یک کامپوننت **عمومی** است (نه چیزی داخل سکشن پیام همگانی): همان
 * الگو برای مدیای پنل، کامندها، و آیتم‌هایِ pool هم لازم می‌شود.
 *
 * IRFORGE_TELEGRAM_UPLOAD_PANELTYPES_VPNDELIVERY_PROMPT بخش A — قبلاً یک
 * جلسه فقط یک پیام می‌گرفت. حالا `broadcast`/`command_media`/`drip_media`/
 * `pool_item` (که ذاتاً یک‌آیتمی‌اند) همان رفتار را دارند — اولین پیام یعنی
 * تمام. `panel_media` چند-آیتمی است: کاربر هرچه خواست می‌فرستد و با دکمه‌ی
 * «✅ پایان»یِ خودِ تلگرام تمام می‌کند؛ اینجا فقط تعدادِ فعلی نشان داده
 * می‌شود.
 *
 * محتوایِ خام (که هنوز file_idِ بات پلتفرم است، نه چیزی قابلِ‌نمایش) هرگز
 * از این کامپوننت بیرون نمی‌رود — `onCaptured` وقتی جلسه `filled` شد صدا
 * زده می‌شود، و مصرف‌کننده باید `materialize()`ی همین فایل را صدا بزند تا
 * آیتم‌ها را برایِ باتِ واقعی تبدیل کند.
 */
import { useEffect, useRef, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Send, Loader2, Check, ExternalLink, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/use-translation";
import { useToast } from "@/hooks/use-toast";

export type SessionItemSummary = { type: string; content: string | null };

export type CapturedContent = {
  id: string;
  status: string;
  items: SessionItemSummary[];
  multi: boolean;
  deepLink: string | null;
};

/** آیتمِ واقعاً قابلِ‌فرستادن با یک بات — خروجیِ `materialize()`. */
export type MaterializedItem =
  | { type: "text"; content: string }
  | { type: "photo" | "voice" | "audio" | "video" | "document" | "animation"; fileId: string; caption: string };

export type SessionKind = "broadcast" | "panel_media" | "command_media" | "drip_media" | "pool_item";

/** آیتم‌هایِ یک جلسه‌ی `filled` را برایِ باتِ `botId` واقعاً قابلِ‌فرستادن
 * می‌کند (دانلود با توکنِ بات پلتفرم، دوباره‌آپلود با توکنِ همین بات). */
export async function materializeSession(sessionId: string): Promise<{ items: MaterializedItem[]; failed: number }> {
  return customFetch(`/api/upload-sessions/${sessionId}/materialize`, { method: "POST" });
}

/** هر ۲ ثانیه — یک تعامل زنده است، کاربر جلوی صفحه منتظر ایستاده. */
const POLL_MS = 2000;

export function useBotUploadSession(kind: SessionKind, botId?: string) {
  const [session, setSession] = useState<CapturedContent | null>(null);
  const [starting, setStarting] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  function stopPolling() {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }

  // پاک‌سازی موقع unmount — بدون این، رفتن به سکشن دیگر یک تایمر زنده جا
  // می‌گذارد که تا ابد به سرور درخواست می‌زند.
  useEffect(() => stopPolling, []);

  async function start(): Promise<string | null> {
    setStarting(true);
    try {
      const created = await customFetch<CapturedContent>("/api/upload-sessions", {
        method: "POST",
        body: JSON.stringify({ kind, botId }),
      });
      setSession(created);

      stopPolling();
      timer.current = setInterval(async () => {
        try {
          const next = await customFetch<CapturedContent>(`/api/upload-sessions/${created.id}`);
          setSession(next);
          // `filled` و `expired` هر دو پایان کارند — ادامه‌ی polling روی یک
          // جلسه‌ی مرده فقط بار بی‌خود است.
          if (next.status === "filled" || next.status === "expired") stopPolling();
        } catch {
          stopPolling();
        }
      }, POLL_MS);

      return created.deepLink;
    } finally {
      setStarting(false);
    }
  }

  function reset() {
    stopPolling();
    setSession(null);
  }

  return { session, starting, start, reset };
}

export function SendViaBotButton({
  kind,
  botId,
  onCaptured,
  label,
}: {
  kind: SessionKind;
  botId?: string;
  onCaptured: (captured: CapturedContent) => void;
  label?: string;
}) {
  const t = useT("botBroadcast");
  const { toast } = useToast();
  const { session, starting, start, reset } = useBotUploadSession(kind, botId);
  const delivered = useRef(false);

  // محتوا فقط **یک‌بار** به بالادست داده می‌شود. بدون این نگهبان، هر بار که
  // polling همان جلسه‌ی `filled` را برگرداند فرم دوباره پر می‌شد و ویرایش
  // کاربر را پاک می‌کرد.
  useEffect(() => {
    if (session?.status === "filled" && !delivered.current) {
      delivered.current = true;
      onCaptured(session);
      toast({ title: t.sendViaBotCaptured });
    }
  }, [session, onCaptured, toast, t]);

  async function begin() {
    delivered.current = false;
    try {
      const link = await start();
      if (link) window.open(link, "_blank", "noopener,noreferrer");
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: t.sendViaBotFailed,
        description: err?.data?.error ?? err?.message,
      });
      reset();
    }
  }

  const waiting = session?.status === "pending" || session?.status === "waiting";

  if (waiting) {
    const count = session?.items.length ?? 0;
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
        <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
        <span className="min-w-0 flex-1">
          {session?.multi && count > 0 ? t.sendViaBotWaitingMulti.replace("{n}", String(count)) : t.sendViaBotWaiting}
        </span>
        {session?.deepLink && (
          <Button variant="outline" size="sm" asChild>
            <a href={session.deepLink} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="me-1.5 size-3.5" /> {t.sendViaBotReopen}
            </a>
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={reset}>
          <X className="me-1.5 size-3.5" /> {t.sendViaBotCancel}
        </Button>
      </div>
    );
  }

  if (session?.status === "filled") {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm">
        <Check className="size-4 shrink-0 text-emerald-500" />
        <span className="min-w-0 flex-1">
          {session.items.length > 1 ? t.sendViaBotCapturedMulti.replace("{n}", String(session.items.length)) : t.sendViaBotCaptured}
        </span>
        <Button variant="ghost" size="sm" onClick={reset}>
          {t.sendViaBotAgain}
        </Button>
      </div>
    );
  }

  return (
    <Button type="button" variant="outline" disabled={starting} onClick={begin}>
      {starting ? <Loader2 className="me-1.5 size-4 animate-spin" /> : <Send className="me-1.5 size-4" />}
      {label ?? t.sendViaBotCta}
    </Button>
  );
}
