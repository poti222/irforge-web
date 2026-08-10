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
  EDUCATION_CHANNEL_URL,
  EDUCATION_CHANNEL_HANDLE,
} from "@/config/support";

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
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const { aiBotUsername, ownerUsername, ownerLabel } = SUPPORT_CONTACTS;

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
            ? "اول از ربات پشتیبانی هوش مصنوعی بپرس — سریع و شبانه‌روزی جواب می‌ده. اگه به آدم واقعی نیاز داشتی، پایین‌تر مستقیم با ما در ارتباط باش."
            : "Ask the AI support bot first — it answers instantly, around the clock. If you need a human, reach us directly below."}
        </p>
      </motion.div>

      {/* AI auto-support — the star */}
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
              <OrangeRobot className="size-12" />
            </motion.div>

            <div className="flex-1 space-y-3">
              <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                <h2 className="text-xl font-bold">
                  {fa ? "پشتیبانی خودکار هوش مصنوعی" : "AI Auto-Support"}
                </h2>
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary">
                  <Sparkles className="size-3" />
                  {fa ? "پیشنهادی" : "Recommended"}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                {fa
                  ? "رباتی که بیشتر سؤال‌ها رو همون لحظه جواب می‌ده — راه‌اندازی بات، پرداخت، پلاگین‌ها و بیشتر."
                  : "A bot that answers most questions on the spot — bot setup, payments, plugins and more."}
              </p>
              <div className="flex flex-wrap items-center justify-center gap-3 sm:justify-start">
                <HandleChip username={aiBotUsername} />
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="size-3.5" />
                  {fa ? "۲۴ ساعته" : "24/7"}
                </span>
              </div>
              <div className="pt-1">
                <Button asChild size="lg" className="gap-2" data-testid="start-ai-chat">
                  <a href={telegramUrl(aiBotUsername)} target="_blank" rel="noopener noreferrer">
                    <Send className="size-4" />
                    {fa ? "شروع گفتگو با ربات" : "Start chat with the bot"}
                  </a>
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
                  {EDUCATION_CHANNEL_HANDLE}
                </p>
              </div>
            </div>
            <Button asChild variant="outline" size="sm" className="shrink-0 gap-2" data-testid="education-channel">
              <a href={EDUCATION_CHANNEL_URL} target="_blank" rel="noopener noreferrer">
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
                    ? `اگه ربات نتونست کمکت کنه، مستقیم به ${ownerLabel} پیام بده.`
                    : `If the bot can't help, message ${ownerLabel} directly.`}
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

      {/* Reassurance + link to tickets */}
      <motion.div
        variants={fadeUp}
        initial="hidden"
        animate="show"
        custom={4}
        className="flex flex-col items-center justify-between gap-3 rounded-xl border border-dashed p-4 text-sm text-muted-foreground sm:flex-row"
      >
        <span className="inline-flex items-center gap-2">
          <ShieldCheck className="size-4 text-primary" />
          {fa ? "پاسخ‌ها معمولاً کمتر از چند ساعت طول می‌کشه." : "We usually reply in under a few hours."}
        </span>
        <Link href="/tickets" className="font-medium text-primary hover:underline" data-testid="link-tickets">
          {fa ? "یا یک تیکت ثبت کن ←" : "Or open a ticket →"}
        </Link>
      </motion.div>
    </div>
  );
}
