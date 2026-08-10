import { Link } from "wouter";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  KeyRound,
  ShieldAlert,
  Youtube,
  Send,
  MessageSquare,
  Search,
  Terminal,
  Type,
  AtSign,
  Copy,
  CheckCircle2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/hooks/use-language";
import { useT } from "@/hooks/use-translation";
import { useSEO } from "@/hooks/use-seo";
import { EDUCATION_CHANNEL_URL, EDUCATION_CHANNEL_HANDLE } from "@/config/support";

/**
 * Public, prerendered guide to getting a bot token from @BotFather.
 * Linked from the checkout page's bot-token field, and indexable in all five
 * languages (see PUBLIC_ROUTES in lib/lang-routing.ts).
 */

/** A realistic-shaped but entirely fake token — the digits are not a real bot. */
const EXAMPLE_TOKEN = "123456789:AAHk9pQ2rTxV-ExampleTokenDoNotUse_0000";

export default function LearnBotToken() {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const t = useT("learnBotToken");
  const seo = useT("seo");
  const BackArrow = fa ? ArrowRight : ArrowLeft;

  useSEO({
    title: seo.botTokenTitle,
    description: seo.botTokenDescription,
    route: "/learn/bot-token",
  });

  const steps = [
    { icon: MessageSquare, title: t.step1Title, body: t.step1Body },
    { icon: Search, title: t.step2Title, body: t.step2Body },
    { icon: Terminal, title: t.step3Title, body: t.step3Body },
    { icon: Type, title: t.step4Title, body: t.step4Body },
    { icon: AtSign, title: t.step5Title, body: t.step5Body },
    { icon: Copy, title: t.step6Title, body: t.step6Body, showToken: true },
    { icon: CheckCircle2, title: t.step7Title, body: t.step7Body },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-8 py-8">
      <Button variant="ghost" size="sm" asChild className="-ms-2">
        <Link href="/bots/cart">
          <BackArrow className="me-2 h-4 w-4" /> {t.back}
        </Link>
      </Button>

      {/* Header */}
      <div className="space-y-3">
        <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
          <KeyRound className="size-3.5" />
          {t.badge}
        </div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{t.title}</h1>
        <p className="max-w-2xl text-base leading-relaxed text-muted-foreground">{t.subtitle}</p>
      </div>

      {/* Steps */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">{t.stepsTitle}</h2>
        {/* An ordered list, so the sequence survives without CSS and reads
            correctly to a screen reader. The visible number comes from the
            counter rather than a list marker so it can be styled as a chip. */}
        <ol className="space-y-3">
          {steps.map((step, i) => (
            <motion.li
              key={step.title}
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.3, delay: Math.min(i, 5) * 0.04 }}
            >
              <Card>
                <CardContent className="flex gap-4 p-5">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                    {(i + 1).toLocaleString(fa ? "fa-IR" : "en-US")}
                  </div>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <h3 className="flex items-center gap-2 font-semibold">
                      <step.icon className="size-4 shrink-0 text-muted-foreground" />
                      {step.title}
                    </h3>
                    <p className="text-sm leading-relaxed text-muted-foreground">{step.body}</p>
                    {step.showToken && (
                      <div className="space-y-1.5 pt-1">
                        <p className="text-xs text-muted-foreground">{t.tokenExampleLabel}</p>
                        <code
                          dir="ltr"
                          className="block overflow-x-auto whitespace-nowrap rounded-md border bg-muted/50 px-3 py-2 font-mono text-xs"
                        >
                          {EXAMPLE_TOKEN}
                        </code>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </motion.li>
          ))}
        </ol>
      </section>

      {/* Security warning — the token is a password */}
      <Card className="border-destructive/40 bg-destructive/5">
        <CardContent className="flex gap-4 p-5">
          <ShieldAlert className="size-6 shrink-0 text-destructive" />
          <div className="min-w-0 space-y-2">
            <h2 className="font-semibold text-destructive">{t.warningTitle}</h2>
            <p className="text-sm leading-relaxed">{t.warningBody}</p>
            <p className="text-sm leading-relaxed text-muted-foreground">{t.warningRevoke}</p>
          </div>
        </CardContent>
      </Card>

      {/* Education channel */}
      <Card className="border-primary/30">
        <CardContent className="flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Youtube className="size-6" />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <h2 className="font-semibold">{t.channelTitle}</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">{t.channelBody}</p>
            <p className="font-mono text-xs text-muted-foreground" dir="ltr">
              {EDUCATION_CHANNEL_HANDLE}
            </p>
          </div>
          <Button asChild className="shrink-0 gap-2" data-testid="education-channel">
            <a href={EDUCATION_CHANNEL_URL} target="_blank" rel="noopener noreferrer">
              <Send className="size-4" />
              {t.channelCta}
            </a>
          </Button>
        </CardContent>
      </Card>

      {/* Back to checkout */}
      <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-semibold">{t.nextTitle}</p>
          <p className="text-sm text-muted-foreground">{t.nextBody}</p>
        </div>
        <Button asChild variant="outline" className="shrink-0">
          <Link href="/bots/cart">{t.nextCta}</Link>
        </Button>
      </div>
    </div>
  );
}
