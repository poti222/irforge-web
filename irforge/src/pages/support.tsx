import { useState } from "react";
import { motion } from "framer-motion";
import {
  Sparkles,
  Send,
  Copy,
  Check,
  Clock,
  ShieldCheck,
  MessageCircle,
  LifeBuoy,
  Youtube,
  Ticket,
} from "lucide-react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/hooks/use-language";
import { useToast } from "@/hooks/use-toast";
import { OrangeRobot } from "@/components/layout/brand-home";
import {
  SUPPORT_CONTACTS,
  telegramUrl,
  atHandle,
  useSupportLinks,
} from "@/config/support";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import { useT } from "@/hooks/use-translation";

/** A small "@handle + copy" chip. */
function HandleChip({ username }: { username: string }) {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const handle = atHandle(username);

  function copy() {
    navigator.clipboard.writeText(handle);
    setCopied(true);
    toast({ title: fa ? "کپی شد" : "Copied", description: handle });
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button
      type="button"
      onClick={copy}
      data-testid={`copy-${username}`}
      className="inline-flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-1.5 font-mono text-sm transition-colors hover:bg-muted"
    >
      <span dir="ltr">{handle}</span>
      {copied ? <Check className="size-3.5 text-primary" /> : <Copy className="size-3.5 text-muted-foreground" />}
    </button>
  );
}

const fadeUp = {
  hidden: { opacity: 0, y: 18 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.4, ease: "easeOut" as const },
  }),
};

export default function Support() {
  usePrivatePageTitle(useT("pageTitles").support);
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const { ownerUsername, ownerLabel } = SUPPORT_CONTACTS;
  const { educationChannelUrl, educationChannelHandle } = useSupportLinks();

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      {/* Header */}
      <motion.div variants={fadeUp} initial="hidden" animate="show" custom={0} className="space-y-2">
        <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
          <LifeBuoy className="size-3.5" />
          {fa ? "پشتیبانی" : "Support"}
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
          {fa ? "چطور می‌تونیم کمکت کنیم؟" : "How can we help?"}
        </h1>
        <p className="max-w-xl text-muted-foreground">
          {fa
            ? "سریع‌ترین راه، ثبت یک تیکت است — تیمِ پشتیبانی شخصاً جوابش را می‌دهد."
            : "The fastest way is opening a ticket — our support team answers it personally."}
        </p>
      </motion.div>

      {/* Ticket support — the star */}
      <motion.div variants={fadeUp} initial="hidden" animate="show" custom={1}>
        <Card className="relative overflow-hidden border-primary/30">
          {/* soft orange glow */}
          <div className="pointer-events-none absolute -end-16 -top-16 size-64 rounded-full bg-primary/10 blur-3xl" />
          <CardContent className="relative flex flex-col items-center gap-5 p-8 text-center sm:flex-row sm:items-center sm:text-start">
            <motion.div
              className="flex size-20 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg"
              animate={{ y: [0, -5, 0] }}
              transition={{ duration: 3, ease: "easeInOut", repeat: Infinity }}
            >
              <Ticket className="size-10" />
            </motion.div>

            <div className="flex-1 space-y-3">
              <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                <h2 className="text-xl font-bold">
                  {fa ? "پشتیبانی با تیکت" : "Ticket support"}
                </h2>
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary">
                  <Sparkles className="size-3" />
                  {fa ? "پیشنهادی" : "Recommended"}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                {fa
                  ? "یک تیکت باز کن و توضیح بده چه کمکی لازم داری — یک انسان از تیم پشتیبانی شخصاً جواب می‌دهد."
                  : "Open a ticket and describe what you need — a real person on our support team answers it personally."}
              </p>
              <div className="flex flex-wrap items-center justify-center gap-3 sm:justify-start">
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <ShieldCheck className="size-3.5" />
                  {fa ? "پاسخ‌گویی توسط انسان" : "Answered by a human"}
                </span>
              </div>
              <div className="pt-1">
                <Button asChild size="lg" className="gap-2" data-testid="open-ticket">
                  <Link href="/tickets">
                    <Send className="size-4" />
                    {fa ? "ثبت تیکت" : "Open a ticket"}
                  </Link>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Education channel — video walkthroughs */}
      <motion.div variants={fadeUp} initial="hidden" animate="show" custom={2}>
        <Card className="border-primary/25">
          <CardContent className="flex flex-col items-center gap-4 p-6 text-center sm:flex-row sm:justify-between sm:text-start">
            <div className="flex items-center gap-4">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Youtube className="size-6" />
              </div>
              <div>
                <h3 className="font-semibold">
                  {fa ? "کانال آموزشی" : "Education channel"}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {fa
                    ? "ویدیوهای گام‌به‌گام: گرفتن توکن، ساخت اولین بات، پلاگین‌ها و پرداخت."
                    : "Video walkthroughs: getting a token, your first bot, plugins and payments."}
                </p>
                <p className="mt-1 font-mono text-xs text-muted-foreground" dir="ltr">
                  {educationChannelHandle}
                </p>
              </div>
            </div>
            <Button asChild variant="outline" size="sm" className="shrink-0 gap-2" data-testid="education-channel">
              <a href={educationChannelUrl} target="_blank" rel="noopener noreferrer">
                <Send className="size-4" />
                {fa ? "باز کردن کانال" : "Open the channel"}
              </a>
            </Button>
          </CardContent>
        </Card>
      </motion.div>

      {/* Direct contact with the owner — at the bottom, as requested */}
      <motion.div variants={fadeUp} initial="hidden" animate="show" custom={3}>
        <Card>
          <CardContent className="flex flex-col items-center gap-4 p-6 text-center sm:flex-row sm:justify-between sm:text-start">
            <div className="flex items-center gap-4">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground">
                <MessageCircle className="size-6" />
              </div>
              <div>
                <h3 className="font-semibold">
                  {fa ? "ارتباط مستقیم با ما" : "Talk to us directly"}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {fa
                    ? `برای هر چیزی که تیکت زمان‌بر است، مستقیم به ${ownerLabel} پیام بده.`
                    : `For anything a ticket would be too slow for, message ${ownerLabel} directly.`}
                </p>
              </div>
            </div>
            <div className="flex flex-col items-center gap-2 sm:items-end">
              <HandleChip username={ownerUsername} />
              <Button asChild variant="outline" size="sm" className="gap-2" data-testid="contact-owner">
                <a href={telegramUrl(ownerUsername)} target="_blank" rel="noopener noreferrer">
                  <Send className="size-4" />
                  {fa ? "پیام در تلگرام" : "Message on Telegram"}
                </a>
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* AI auto-support — temporarily disabled, kept visible so it's clearly
          "coming back" rather than gone; no longer the recommended path. */}
      <motion.div variants={fadeUp} initial="hidden" animate="show" custom={4}>
        <Card className="border-dashed opacity-60">
          <CardContent className="flex flex-col items-center gap-4 p-6 text-center sm:flex-row sm:justify-between sm:text-start">
            <div className="flex items-center gap-4">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                <OrangeRobot className="size-7" />
              </div>
              <div>
                <h3 className="font-semibold">
                  {fa ? "پشتیبانی خودکار هوش مصنوعی" : "AI Auto-Support"}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {fa ? "فعلاً موقتاً غیرفعال است — به‌جایش یک تیکت ثبت کن." : "Temporarily unavailable for now — open a ticket instead."}
                </p>
              </div>
            </div>
            <Button disabled variant="outline" size="sm" className="shrink-0 gap-2">
              <Clock className="size-4" />
              {fa ? "به‌زودی" : "Coming back soon"}
            </Button>
          </CardContent>
        </Card>
      </motion.div>

      {/* Reassurance */}
      <motion.div
        variants={fadeUp}
        initial="hidden"
        animate="show"
        custom={5}
        className="flex items-center justify-center gap-2 rounded-xl border border-dashed p-4 text-sm text-muted-foreground"
      >
        <ShieldCheck className="size-4 text-primary" />
        {fa ? "پاسخ‌ها معمولاً کمتر از چند ساعت طول می‌کشه." : "We usually reply in under a few hours."}
      </motion.div>
    </div>
  );
}
