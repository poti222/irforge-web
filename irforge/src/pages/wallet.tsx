import { useRef, useState, useEffect } from "react";
import { customFetch } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Wallet as WalletIcon, CreditCard, Landmark, Bitcoin, Upload, Loader2, X, Copy, Check, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/hooks/use-language";
import { formatToman } from "@/lib/format";
import { toWebpDataUrl } from "@/lib/image";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import { useT } from "@/hooks/use-translation";

type WalletTx = {
  id: string; type: string; amount: number; status: string;
  receiptUrl: string | null; txHash: string | null; reviewNote: string | null; createdAt: string;
};

const TX_LABEL: Record<string, { fa: string; en: string }> = {
  deposit_card: { fa: "کارت به کارت", en: "Card deposit" },
  deposit_gateway: { fa: "درگاه بانکی", en: "Bank gateway" },
  deposit_usdt: { fa: "تتر (USDT)", en: "USDT" },
  spend: { fa: "خرید", en: "Spend" },
  referral_credit: { fa: "پاداش", en: "Referral" },
};
const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  pending: "outline", approved: "default", rejected: "destructive",
};

/** شکل پاسخ GET /api/wallet/deposit-info — آینه‌ی PaymentMethodsSettings سرور. */
type DepositInfo = {
  usdt: { address: string; network: string; memo: string; tomanPerUsdt: number; note: string; enabled: boolean };
  card: { number: string; holder: string; bank: string; note: string; enabled: boolean };
};

/**
 * یک مقدارِ قابل کپی (آدرس کیف پول، شماره کارت).
 *
 * دکمه‌ی کپی اینجا تزئین نیست: تایپ‌کردن دستیِ یک آدرس TRC20 راهی مطمئن برای
 * از دست دادن پول است. `dir="ltr"` و فونت mono هم به همین دلیل‌اند — آدرس در
 * صفحه‌ی راست‌به‌چپ نباید تکه‌تکه یا جابه‌جا دیده شود.
 */
function CopyField({ label, value, fa }: { label: string; value: string; fa: boolean }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // مرورگرهای قدیمی/بدون HTTPS اجازه‌ی clipboard نمی‌دهند — کاربر باید
      // بداند چرا کلیک اثری نکرد، وگرنه فکر می‌کند کپی شده و آدرس خالی می‌چسباند.
      toast({ variant: "destructive", title: fa ? "کپی نشد — دستی انتخاب کنید" : "Copy failed — select manually" });
    }
  }

  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-2">
        <code dir="ltr" className="min-w-0 flex-1 select-all break-all font-mono text-xs">{value}</code>
        <Button type="button" variant="ghost" size="icon" className="size-7 shrink-0" onClick={copy}
          aria-label={fa ? "کپی" : "Copy"}>
          {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
        </Button>
      </div>
    </div>
  );
}

/** وقتی سوپرادمین هنوز آدرس/شماره‌ای وارد نکرده. */
function NotConfigured({ fa }: { fa: boolean }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
      <span>
        {fa
          ? "اطلاعات این روش واریز هنوز توسط پشتیبانی وارد نشده. لطفاً از روش دیگری استفاده کنید یا با پشتیبانی تماس بگیرید."
          : "This deposit method hasn't been configured yet. Please use another method or contact support."}
      </span>
    </div>
  );
}

export default function Wallet() {
  usePrivatePageTitle(useT("pageTitles").wallet);
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: wallet } = useQuery({
    queryKey: ["wallet"],
    queryFn: () => customFetch<{ balance: number }>("/api/wallet"),
    refetchInterval: 10000,
  });
  const { data: txs } = useQuery({
    queryKey: ["wallet-tx"],
    queryFn: () => customFetch<WalletTx[]>("/api/wallet/transactions"),
    refetchInterval: 10000,
  });
  // «پول را کجا بفرستم؟» — آدرس تتر و شماره کارت مقصد، از تنظیمات پلتفرم.
  // این‌ها ثابت‌اند، پس برخلاف موجودی و تراکنش‌ها هر ۱۰ ثانیه دوباره خوانده
  // نمی‌شوند.
  const { data: depositInfo } = useQuery({
    queryKey: ["wallet-deposit-info"],
    queryFn: () => customFetch<DepositInfo>("/api/wallet/deposit-info"),
    staleTime: 5 * 60 * 1000,
  });

  // Detect a tracked pending deposit flipping to approved → toast (Z5 auto-return).
  const prevPending = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!txs) return;
    const nowApproved = txs.filter((t) => t.status === "approved").map((t) => t.id);
    for (const id of nowApproved) {
      if (prevPending.current.has(id)) {
        toast({ title: fa ? "واریز تأیید شد" : "Deposit approved", description: fa ? "موجودی شما به‌روزرسانی شد." : "Your balance has been updated." });
        queryClient.invalidateQueries({ queryKey: ["wallet"] });
      }
    }
    prevPending.current = new Set(txs.filter((t) => t.status === "pending").map((t) => t.id));
  }, [txs]);

  const [amount, setAmount] = useState("");
  const [txHash, setTxHash] = useState("");
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // فیش واریزی به WebP تبدیل می‌شود: همین data-URL عیناً در دیتابیس ذخیره و
  // بعداً به ادمین سرو می‌شود، پس هر بایتی که اینجا کم شود هم در حجم دیتابیس
  // و هم در زمان بارگذاری صفحه‌ی تأییدها صرفه‌جویی است.
  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast({ variant: "destructive", title: fa ? "فقط تصویر" : "Image only" }); return; }
    setReceiptPreview(await toWebpDataUrl(file));
  }

  async function deposit(method: "card" | "usdt") {
    const amt = Number(amount);
    if (!amt || amt <= 0) { toast({ variant: "destructive", title: fa ? "مبلغ نامعتبر" : "Invalid amount" }); return; }
    if (method === "card" && !receiptPreview) { toast({ variant: "destructive", title: fa ? "فیش را آپلود کنید" : "Upload a receipt" }); return; }
    if (method === "usdt" && !txHash.trim()) { toast({ variant: "destructive", title: fa ? "هش تراکنش الزامی است" : "Transaction hash required" }); return; }
    setBusy(true);
    try {
      await customFetch("/api/wallet/deposit", {
        method: "POST",
        body: JSON.stringify({ method, amount: amt, receiptUrl: method === "card" ? receiptPreview : null, txHash: method === "usdt" ? txHash.trim() : null }),
      });
      setAmount(""); setTxHash(""); setReceiptPreview(null);
      queryClient.invalidateQueries({ queryKey: ["wallet-tx"] });
      toast({ title: fa ? "درخواست واریز ثبت شد" : "Deposit submitted", description: fa ? "پس از تأیید، موجودی شما اضافه می‌شود." : "Your balance updates after approval." });
    } catch (err: any) {
      toast({ variant: "destructive", title: fa ? "خطا" : "Error", description: err?.message });
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{fa ? "کیف پول من" : "My Wallet"}</h1>
        <p className="text-muted-foreground">{fa ? "شارژ حساب و مدیریت موجودی." : "Top up and manage your balance."}</p>
      </div>

      <Card className="bg-primary/5 border-primary/30">
        <CardContent className="flex items-center gap-4 py-6">
          <div className="flex size-12 items-center justify-center rounded-full bg-primary/15 text-primary">
            <WalletIcon className="h-6 w-6" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">{fa ? "موجودی فعلی" : "Current balance"}</p>
            <p className="text-3xl font-bold">{formatToman(wallet?.balance ?? 0, lang)}</p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">{fa ? "افزایش موجودی" : "Top up"}</CardTitle></CardHeader>
          <CardContent>
            <Tabs defaultValue="card">
              <TabsList className="grid w-full grid-cols-3">
                {/* روشی که سوپرادمین خاموش کرده اصلاً قابل انتخاب نیست — سرور هم
                    همین را جدا چک می‌کند (POST /api/wallet/deposit). */}
                <TabsTrigger value="card" disabled={depositInfo?.card.enabled === false}><CreditCard className="me-1 h-4 w-4" /> {fa ? "کارت" : "Card"}</TabsTrigger>
                <TabsTrigger value="gateway" disabled><Landmark className="me-1 h-4 w-4" /> {fa ? "درگاه" : "Gateway"}</TabsTrigger>
                <TabsTrigger value="usdt" disabled={depositInfo?.usdt.enabled === false}><Bitcoin className="me-1 h-4 w-4" /> USDT</TabsTrigger>
              </TabsList>

              <TabsContent value="card" className="space-y-3 pt-3">
                <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
                  {fa ? "ممکن است تأیید این روش تا ۱ ساعت طول بکشد." : "This method may take up to 1 hour to confirm."}
                </p>

                {/* مقصد واریز — اول کاربر باید بداند پول را کجا بفرستد، بعد فیش را آپلود کند. */}
                {depositInfo && (depositInfo.card.number ? (
                  <div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-3">
                    <CopyField label={fa ? "شماره کارت مقصد" : "Destination card number"} value={depositInfo.card.number} fa={fa} />
                    {depositInfo.card.holder && (
                      <p className="text-xs text-muted-foreground">
                        {fa ? "به نام: " : "Card holder: "}<span className="font-medium text-foreground">{depositInfo.card.holder}</span>
                        {depositInfo.card.bank ? ` · ${depositInfo.card.bank}` : ""}
                      </p>
                    )}
                    {depositInfo.card.note && <p className="text-xs text-muted-foreground">{depositInfo.card.note}</p>}
                  </div>
                ) : <NotConfigured fa={fa} />)}

                <div className="space-y-1.5">
                  <Label>{fa ? "مبلغ (تومان)" : "Amount (Toman)"}</Label>
                  <Input type="number" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>{fa ? "فیش واریزی" : "Receipt"}</Label>
                  {receiptPreview ? (
                    <div className="relative overflow-hidden rounded-md border">
                      <img src={receiptPreview} alt="receipt" className="max-h-36 w-full object-contain bg-muted" />
                      <button onClick={() => setReceiptPreview(null)} className="absolute end-2 top-2 rounded-full bg-background/80 p-1"><X className="size-4" /></button>
                    </div>
                  ) : (
                    <button onClick={() => fileRef.current?.click()} className="flex w-full flex-col items-center gap-1 rounded-md border border-dashed p-4 text-muted-foreground hover:border-primary hover:text-primary">
                      <Upload className="size-5" /><span className="text-xs">{fa ? "آپلود تصویر فیش" : "Upload receipt image"}</span>
                    </button>
                  )}
                  <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
                </div>
                <Button onClick={() => deposit("card")} disabled={busy || !depositInfo?.card.number} className="w-full">
                  {busy && <Loader2 className="me-2 h-4 w-4 animate-spin" />}{fa ? "ثبت واریز" : "Submit deposit"}
                </Button>
              </TabsContent>

              <TabsContent value="gateway" className="pt-3">
                <div className="flex flex-col items-center gap-2 py-8 text-center">
                  <Landmark className="h-8 w-8 text-muted-foreground" />
                  <Badge variant="secondary">{fa ? "به‌زودی" : "Coming soon"}</Badge>
                </div>
              </TabsContent>

              <TabsContent value="usdt" className="space-y-3 pt-3">
                {/* آدرس مقصد + شبکه. شبکه با تأکید نمایش داده می‌شود چون واریز
                    روی شبکه‌ی اشتباه یعنی پولِ برنگشتنی. */}
                {depositInfo && (depositInfo.usdt.address ? (
                  <div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-3">
                    <CopyField
                      label={fa ? `آدرس کیف پول مقصد (${depositInfo.usdt.network})` : `Destination wallet address (${depositInfo.usdt.network})`}
                      value={depositInfo.usdt.address}
                      fa={fa}
                    />
                    {depositInfo.usdt.memo && (
                      <CopyField label={fa ? "Memo / Tag (الزامی)" : "Memo / Tag (required)"} value={depositInfo.usdt.memo} fa={fa} />
                    )}
                    <p className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                      {fa
                        ? `فقط از شبکه‌ی ${depositInfo.usdt.network} استفاده کنید؛ ارسال روی شبکه‌ی دیگر قابل بازگشت نیست.`
                        : `Send only over the ${depositInfo.usdt.network} network — transfers on any other network cannot be recovered.`}
                    </p>
                    {depositInfo.usdt.tomanPerUsdt > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {fa
                          ? `نرخ فعلی: هر ۱ تتر ≈ ${formatToman(depositInfo.usdt.tomanPerUsdt, lang)}`
                          : `Current rate: 1 USDT ≈ ${formatToman(depositInfo.usdt.tomanPerUsdt, lang)}`}
                      </p>
                    )}
                    {depositInfo.usdt.note && <p className="text-xs text-muted-foreground">{depositInfo.usdt.note}</p>}
                  </div>
                ) : <NotConfigured fa={fa} />)}

                <div className="space-y-1.5">
                  <Label>{fa ? "مبلغ (تومان)" : "Amount (Toman)"}</Label>
                  <Input type="number" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>{fa ? "هش تراکنش / آدرس کیف پول مبدأ" : "Transaction hash / sending address"}</Label>
                  <Input dir="ltr" className="font-mono text-xs" value={txHash} onChange={(e) => setTxHash(e.target.value)} />
                </div>
                <Button onClick={() => deposit("usdt")} disabled={busy || !depositInfo?.usdt.address} className="w-full">
                  {busy && <Loader2 className="me-2 h-4 w-4 animate-spin" />}{fa ? "ثبت واریز" : "Submit deposit"}
                </Button>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">{fa ? "تراکنش‌های اخیر" : "Recent transactions"}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {txs && txs.length > 0 ? txs.map((t) => {
              const label = TX_LABEL[t.type] ?? { fa: t.type, en: t.type };
              const isSpend = t.type === "spend";
              return (
                <div key={t.id} className="flex items-center justify-between rounded-md border p-2.5">
                  <div>
                    <p className="text-sm font-medium">{fa ? label.fa : label.en}</p>
                    <p className="text-xs text-muted-foreground">{new Date(t.createdAt).toLocaleString(fa ? "fa-IR" : "en-US")}</p>
                  </div>
                  <div className="text-end">
                    <p className={`text-sm font-semibold ${isSpend ? "text-red-500" : "text-emerald-600 dark:text-emerald-400"}`}>
                      {isSpend ? "−" : "+"}{formatToman(t.amount, lang)}
                    </p>
                    <Badge variant={STATUS_VARIANT[t.status] ?? "outline"} className="mt-0.5">{t.status}</Badge>
                  </div>
                </div>
              );
            }) : (
              <p className="py-8 text-center text-sm text-muted-foreground">{fa ? "تراکنشی وجود ندارد." : "No transactions yet."}</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
