/**
 * marketplace.tsx — صفحه‌ی مارکت‌پلیس داشبورد.
 *
 * قبلاً یک شبکه‌ی تختِ کارت بود که خریده و نخریده را قاطی نشان می‌داد و نصب را
 * داخل یک دیالوگ انجام می‌داد؛ نه معلوم بود چه داری، نه اینکه هر پلاگین روی کدام
 * بات نشسته. حالا همان دو بخشِ «داری / نداری» (`PluginLibrary`) که در سکشن
 * پلاگین‌های هر بات هم استفاده می‌شود، و جزئیات هر پلاگین صفحه‌ی خودش را دارد
 * (`/marketplace/:pluginId`) تا قابل لینک‌دادن باشد.
 *
 * متن‌های این صفحه قبلاً `fa ? … : …` بودند — یعنی برای عربی/ترکی/روسی انگلیسی
 * درمی‌آمد. حالا از فایل‌های ترجمه می‌آیند.
 */
import { Link } from "wouter";
import { Wallet as WalletIcon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { PluginLibrary } from "@/components/plugins/PluginLibrary";
import { useT } from "@/hooks/use-translation";
import { useLanguage } from "@/hooks/use-language";
import { formatToman } from "@/lib/format";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";

export default function Marketplace() {
  const t = useT("marketplace");
  const { lang } = useLanguage();
  usePrivatePageTitle(useT("pageTitles").marketplace);

  // همان کلیدِ کوئریِ صفحه‌ی کیف پول: یک ورودی کش مشترک، پس به‌محض تأیید شارژ
  // در آن صفحه این چیپ هم به‌روز می‌شود.
  const { data: wallet } = useQuery({
    queryKey: ["wallet"],
    queryFn: () => customFetch<{ balance: number }>("/api/wallet"),
    refetchInterval: 10000,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{t.title}</h1>
          <p className="max-w-2xl text-muted-foreground">{t.subtitle}</p>
        </div>

        {/* موجودی همان چیزی است که قبل از خرید لازم داری بدانی، پس همین‌جاست. */}
        <Link
          href="/wallet"
          title={t.walletBalance}
          className="inline-flex shrink-0 items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-sm transition-colors hover:border-primary/50 hover:text-primary"
          data-testid="marketplace-wallet-chip"
        >
          <WalletIcon className="size-4 text-primary" />
          <span className="text-muted-foreground">{t.walletBalance}</span>
          <span className="font-semibold">{formatToman(wallet?.balance ?? 0, lang)}</span>
        </Link>
      </div>

      <PluginLibrary />
    </div>
  );
}
