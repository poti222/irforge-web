import { BarChart3, Bot, CreditCard, ShieldCheck, type LucideIcon } from "lucide-react";
import { useT } from "@/hooks/use-translation";

/**
 * Mini-visual for the marketplace bento tile: a short rail of installable
 * plugin rows. Static markup — hover only changes colour, nothing animates on
 * its own.
 */
export function PluginRail() {
  const tr = useT("landing");

  const plugins: { icon: LucideIcon; name: string; installed?: boolean }[] = [
    { icon: BarChart3, name: tr.pluginNameAnalytics, installed: true },
    { icon: CreditCard, name: tr.pluginNamePayments },
    { icon: Bot, name: tr.pluginNameAi },
    { icon: ShieldCheck, name: tr.pluginNameModeration },
  ];

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {plugins.map((plugin) => (
        <div
          key={plugin.name}
          className="flex items-center gap-2.5 rounded-lg border border-border bg-background/60 px-3 py-2"
        >
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <plugin.icon className="size-3.5" />
          </span>
          {/* wraps rather than truncates — "Yapay zeka yanıtları" / "Ответы ИИ"
              and the Arabic names don't fit a half-width chip on one line */}
          <span className="min-w-0 flex-1 text-xs font-medium leading-tight">{plugin.name}</span>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
              plugin.installed
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : "border border-border text-muted-foreground"
            }`}
          >
            {plugin.installed ? tr.pluginInstalled : tr.pluginInstall}
          </span>
        </div>
      ))}
    </div>
  );
}
