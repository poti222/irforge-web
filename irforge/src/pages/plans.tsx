import { useState } from "react";
import {
  useListPlans,
  useGetCurrentPlan,
  useSubscribeToPlan,
  getGetCurrentPlanQueryKey,
  getGetMeQueryKey,
} from "@workspace/api-client-react";
import type { Plan } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { MotionCard } from "@/components/ui/motion-card";
import { Button } from "@/components/ui/button";
import { GlowButton } from "@/components/ui/glow-button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Check, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/hooks/use-language";
import { formatToman } from "@/lib/format";

export default function Plans() {
  const { lang } = useLanguage();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: plans, isLoading } = useListPlans();
  const { data: currentPlan } = useGetCurrentPlan();
  const subscribe = useSubscribeToPlan();

  // Plan awaiting confirmation (opens the confirm dialog).
  const [pendingPlan, setPendingPlan] = useState<Plan | null>(null);

  const currentPlanPrice =
    plans?.find((p) => p.id === currentPlan?.planId)?.price ?? 0;

  function requestUpgrade(plan: Plan) {
    // A cheaper/free switch or first subscription applies straight away; a paid
    // upgrade shows a confirmation step first (P2b: v1 switches immediately via
    // the existing /plans/subscribe — no separate payment gate yet).
    if (plan.price > currentPlanPrice) {
      setPendingPlan(plan);
    } else {
      applyPlan(plan);
    }
  }

  function applyPlan(plan: Plan) {
    subscribe.mutate(
      { data: { planId: plan.id } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetCurrentPlanQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
          toast({
            title: lang === "fa" ? "پلن تغییر کرد" : "Plan updated",
            description:
              lang === "fa"
                ? `پلن شما به «${plan.name}» تغییر یافت.`
                : `Your plan is now “${plan.name}”.`,
          });
          setPendingPlan(null);
        },
        onError: (err: any) => {
          toast({
            variant: "destructive",
            title: lang === "fa" ? "خطا در تغییر پلن" : "Could not change plan",
            description: err?.message ?? (lang === "fa" ? "دوباره تلاش کنید" : "Please try again"),
          });
          setPendingPlan(null);
        },
      }
    );
  }

  const busyPlanId = subscribe.isPending ? subscribe.variables?.data.planId : null;

  return (
    <div className="space-y-6">
      <div className="flex justify-center items-center flex-col text-center mb-10">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
          {lang === "fa" ? "پلن‌ها و صورتحساب" : "Plans & Billing"}
        </h1>
        <p className="text-muted-foreground mt-2">
          {lang === "fa"
            ? "پلن مناسب ربات‌های خود را انتخاب کنید."
            : "Choose the right plan for your bots."}
        </p>
      </div>

      {isLoading ? (
        <div className="grid gap-6 md:grid-cols-3 max-w-6xl mx-auto"><div className="animate-pulse h-96 bg-card rounded-lg" /><div className="animate-pulse h-96 bg-card rounded-lg" /><div className="animate-pulse h-96 bg-card rounded-lg" /></div>
      ) : plans ? (
        <div className="grid gap-6 md:grid-cols-3 max-w-6xl mx-auto">
          {plans.map((plan) => {
            const isCurrent = currentPlan?.planId === plan.id;
            const isBusy = busyPlanId === plan.id;
            const intervalLabel =
              lang === "fa"
                ? plan.interval === "yearly" ? "سالانه" : "ماهانه"
                : plan.interval;
            return (
              <MotionCard key={plan.id} className={`flex flex-col ${plan.popular ? 'border-primary shadow-md relative' : ''}`}>
                {plan.popular && <div className="absolute top-0 right-0 transform translate-x-1/4 -translate-y-1/2 bg-primary text-primary-foreground text-xs font-bold px-3 py-1 rounded-full">{lang === "fa" ? "محبوب" : "POPULAR"}</div>}
                <CardHeader>
                  <CardTitle className="text-2xl">{plan.name}</CardTitle>
                  <div className="mt-4 flex items-baseline gap-2 text-3xl font-extrabold">
                    {plan.price === 0 ? (lang === "fa" ? "رایگان" : "Free") : formatToman(plan.price, lang)}
                    {plan.price > 0 && (
                      <span className="text-base font-medium text-muted-foreground">/{intervalLabel}</span>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="flex-1">
                  <ul className="space-y-3 text-sm">
                    <li className="flex items-center gap-2"><Check className="h-4 w-4 text-primary shrink-0" /> {plan.maxBots} {lang === "fa" ? "ربات" : "Bots"}</li>
                    <li className="flex items-center gap-2"><Check className="h-4 w-4 text-primary shrink-0" /> {plan.maxPlugins} {lang === "fa" ? "پلاگین" : "Plugins"}</li>
                    {plan.features.map((f, i) => (
                      <li key={i} className="flex items-center gap-2">
                        <Check className="h-4 w-4 text-primary shrink-0" /> {f}
                      </li>
                    ))}
                  </ul>
                </CardContent>
                <CardFooter>
                  {isCurrent ? (
                    <Button className="w-full" variant="outline" disabled>
                      {lang === "fa" ? "پلن فعلی" : "Current Plan"}
                    </Button>
                  ) : (
                    // W1: glow border on the actual Upgrade action only, not the disabled Current-Plan state
                    <GlowButton
                      className="w-full"
                      wrapperClassName="w-full"
                      variant={plan.popular ? "default" : "secondary"}
                      disabled={isBusy}
                      onClick={() => requestUpgrade(plan)}
                    >
                      {isBusy && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
                      {lang === "fa" ? "ارتقا" : "Upgrade"}
                    </GlowButton>
                  )}
                </CardFooter>
              </MotionCard>
            );
          })}
        </div>
      ) : null}

      <AlertDialog open={!!pendingPlan} onOpenChange={(o) => !o && setPendingPlan(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {lang === "fa" ? "تأیید ارتقای پلن" : "Confirm plan upgrade"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingPlan &&
                (lang === "fa"
                  ? `پلن «${pendingPlan.name}» با هزینه ${formatToman(pendingPlan.price, lang)} برای هر دوره. ادامه می‌دهید؟`
                  : `The “${pendingPlan.name}” plan costs ${formatToman(pendingPlan.price, lang)} per period. Continue?`)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={subscribe.isPending}>
              {lang === "fa" ? "انصراف" : "Cancel"}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (pendingPlan) applyPlan(pendingPlan);
              }}
              disabled={subscribe.isPending}
            >
              {subscribe.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
              {lang === "fa" ? "تأیید و ارتقا" : "Confirm upgrade"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
