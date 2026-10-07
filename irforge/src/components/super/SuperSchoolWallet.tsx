import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Wallet } from "lucide-react";
import { useLanguage } from "@/hooks/use-language";
import { useToast } from "@/hooks/use-toast";
import { formatToman } from "@/lib/format";
import {
  SUPER_QUERY_ROOT, adjustSuperSchoolWallet, getSuperSchoolWallet,
  type SuperSchool,
} from "./superApi";

/**
 * components/super/SuperSchoolWallet.tsx — شارژ/کسرِ دستیِ «کیف‌پولِ مدرسه» (جدا از کیف‌پولِ شخصیِ کاربران). مبلغ را به تومان می‌گیریم و به ریال (×۱۰) می‌فرستیم؛ هر تغییر با دلیل در ledger و ردپایِ مدرسه ثبت می‌شود.
 */
const errText = (e: any, fb: string) => e?.data?.error ?? e?.message ?? fb;
const toRial = (toman: string) => Math.round(Number(toman.replace(/[^\d]/g, "")) * 10);

export function SchoolWalletTab({ school }: { school: SuperSchool }) {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const { toast } = useToast();
  const qc = useQueryClient();
  const key = [SUPER_QUERY_ROOT, "school-wallet", school.id] as const;
  const { data, isLoading } = useQuery({ queryKey: key, queryFn: () => getSuperSchoolWallet(school.id) });
  const [direction, setDirection] = useState<"credit" | "debit">("credit");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  const adjust = useMutation({
    mutationFn: () => adjustSuperSchoolWallet(school.id, { direction, amountRial: toRial(amount), reason: reason.trim() }),
    onSuccess: () => {
      setAmount(""); setReason("");
      qc.invalidateQueries({ queryKey: key });
      toast({ title: fa ? "کیف پول مدرسه به‌روز شد" : "School wallet updated" });
    },
    onError: (e: any) => toast({ variant: "destructive", title: e?.data?.code === "insufficient" ? (fa ? "موجودی کیف پول مدرسه کافی نیست" : "Insufficient school wallet balance") : (fa ? "خطا" : "Error"), description: errText(e, "") }),
  });
  const valid = toRial(amount) > 0 && reason.trim().length >= 3;

  return (
    <div className="space-y-3" data-testid="ss-wallet-tab">
      <p className="text-sm text-muted-foreground">
        {fa ? "کیف پولِ مدرسه کاملاً جدا از کیف پولِ شخصیِ کاربران است و فقط برای خریدِ باتِ مدرسه استفاده می‌شود."
          : "The school wallet is fully separate from users' personal wallets and is only used for the school bot."}
      </p>
      {isLoading ? <Loader2 className="size-5 animate-spin" /> : data && (
        <>
          <div className="flex items-center gap-2 rounded-md border p-3">
            <Wallet className="size-5 text-primary" />
            <span className="text-sm text-muted-foreground">{fa ? "موجودی" : "Balance"}</span>
            <span className="ms-auto text-lg font-semibold" data-testid="ss-wallet-balance">{formatToman(data.balanceRial / 10, lang)}</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-[9rem_1fr_1fr]">
            <div className="space-y-1.5">
              <Label>{fa ? "عملیات" : "Action"}</Label>
              <Select value={direction} onValueChange={(v) => setDirection(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="credit">{fa ? "شارژ" : "Credit"}</SelectItem>
                  <SelectItem value="debit">{fa ? "کسر" : "Debit"}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sw-amount">{fa ? "مبلغ (تومان)" : "Amount (Toman)"}</Label>
              <Input id="sw-amount" dir="ltr" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="sw-amount" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sw-reason">{fa ? "دلیل (ثبت می‌شود)" : "Reason (logged)"}</Label>
              <Input id="sw-reason" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="sw-reason" />
            </div>
          </div>
          <Button disabled={!valid || adjust.isPending} onClick={() => adjust.mutate()} data-testid="sw-submit">
            {adjust.isPending && <Loader2 className="me-1.5 size-4 animate-spin" />}{fa ? "ثبت" : "Apply"}
          </Button>
          <div className="space-y-1">
            <p className="text-sm font-medium">{fa ? "آخرین تراکنش‌ها" : "Recent transactions"}</p>
            {data.transactions.length === 0 ? <p className="text-xs text-muted-foreground">—</p> : (
              <ul className="max-h-56 divide-y overflow-y-auto rounded-md border text-xs">
                {data.transactions.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-2 px-2 py-1.5">
                    <span className="min-w-0 truncate">{t.description}</span>
                    <span className={t.type === "spend" || t.type === "admin_debit" ? "text-destructive" : "text-emerald-600"} dir="ltr">
                      {t.type === "spend" || t.type === "admin_debit" ? "-" : "+"}{formatToman(t.amountRial / 10, lang)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
