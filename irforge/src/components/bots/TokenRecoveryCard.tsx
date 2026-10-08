/**
 * TokenRecoveryCard — باتی که توکنش از نظرِ تلگرام نامعتبر شده (`bot.status === "token_invalid"`) خاموش است و همه‌ی
 * بخش‌هایش قفل؛ این کارت بالایِ «نمای کلی» توکنِ جدید را می‌گیرد. سرور (PATCH /bots/:id) توکن را با getMe می‌سنجد و
 * فقط با توکنِ معتبر بات را دوباره `active` می‌کند.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { customFetch, getGetBotQueryKey, getListBotsQueryKey, type Bot } from "@workspace/api-client-react";
import { KeyRound, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/hooks/use-translation";
import { useToast } from "@/hooks/use-toast";

export function TokenRecoveryCard({ bot }: { bot: Bot }) {
  const t = useT("botWorkspace");
  const { toast } = useToast();
  const qc = useQueryClient();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = token.trim();
    if (!value) return;
    setBusy(true);
    setError(null);
    try {
      await customFetch(`/api/bots/${bot.id}`, { method: "PATCH", body: JSON.stringify({ token: value }) });
      setToken("");
      toast({ title: t.tokenInvalidFixed });
      await Promise.all([
        qc.invalidateQueries({ queryKey: getGetBotQueryKey(bot.id) }),
        qc.invalidateQueries({ queryKey: getListBotsQueryKey() }),
        qc.invalidateQueries({ queryKey: ["notifications"] }),
      ]);
    } catch (err: any) {
      setError(err?.data?.error ?? err?.message ?? t.tokenInvalidFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      role="alert"
      data-testid="token-recovery"
      className="mb-5 rounded-2xl border border-destructive/50 bg-destructive/10 p-4 sm:p-5"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-destructive/15 text-destructive">
          <TriangleAlert className="size-5" />
        </span>
        <div className="min-w-0 flex-1 space-y-3">
          <div className="space-y-1">
            <h3 className="text-base font-bold" dir="auto">{t.tokenInvalidTitle}</h3>
            <p className="text-sm text-muted-foreground" dir="auto">{t.tokenInvalidDesc}</p>
          </div>
          <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <KeyRound className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                dir="ltr"
                value={token}
                onChange={(e) => { setToken(e.target.value); setError(null); }}
                placeholder="123456789:AA…"
                autoComplete="off"
                spellCheck={false}
                className="ps-9 font-mono"
                data-testid="token-recovery-input"
              />
            </div>
            <Button type="submit" disabled={busy || !token.trim()} data-testid="token-recovery-submit">
              {busy && <Loader2 className="me-1.5 size-4 animate-spin" />} {t.tokenInvalidCta}
            </Button>
          </form>
          {error && <p className="text-sm font-medium text-destructive" dir="auto">{error}</p>}
        </div>
      </div>
    </section>
  );
}
