import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight, KeyRound } from "lucide-react";
import { useLanguage } from "@/hooks/use-language";

// Placeholder page — content to be filled in later (screenshots / step-by-step
// guide for getting a bot token from @BotFather). Linked from the checkout
// page's "bot token" field.
export default function LearnBotToken() {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const BackArrow = fa ? ArrowRight : ArrowLeft;

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-10 text-center">
      <Button variant="ghost" size="sm" asChild className="-ms-2 float-start">
        <Link href="/bots/cart"><BackArrow className="me-2 h-4 w-4" /> {fa ? "بازگشت" : "Back"}</Link>
      </Button>

      <div className="flex flex-col items-center gap-3 pt-16">
        <div className="flex size-14 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <KeyRound className="size-7" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight">
          {fa ? "چطور توکن بات را بگیرم؟" : "How do I get my bot token?"}
        </h1>
        <p className="max-w-md text-muted-foreground">
          {fa
            ? "این صفحه به‌زودی با راهنمای گام‌به‌گام و اسکرین‌شات از BotFather تکمیل می‌شود."
            : "This page will soon be filled in with a step-by-step guide and screenshots from BotFather."}
        </p>
      </div>
    </div>
  );
}
