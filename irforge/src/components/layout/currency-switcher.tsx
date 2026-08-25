import { Check, Coins } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCurrency } from "@/hooks/use-currency";
import { useT } from "@/hooks/use-translation";
import { cn } from "@/lib/utils";

/**
 * currency-switcher.tsx — IRFORGE_PROMPT_V3 Phase 39.
 * ─────────────────────────────────────────────────────────────────────────────
 * Sibling to LanguageSwitcher in the header: picks which "≈ X" conversion
 * shows next to Toman prices on the pricing/plugin pages. Renders nothing
 * when the super admin hasn't configured any rate — there is nothing to
 * switch to, so an empty dropdown would just be clutter.
 */
export function CurrencySwitcher({ className = "" }: { className?: string }) {
  const t = useT("currency");
  const { rates, code, setCode } = useCurrency();

  if (rates.length === 0) return null;

  const currentLabel = code ?? t.tomanOnly;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground transition-all hover:border-primary hover:text-primary hover:bg-primary/5 data-[state=open]:border-primary data-[state=open]:text-primary",
            className
          )}
          aria-label={t.switchAria}
        >
          <Coins className="size-3.5" />
          <span>{currentLabel}</span>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="min-w-[10rem] p-1">
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            setCode(null);
          }}
          className="flex items-center gap-2.5 rounded-sm px-2 py-1.5 text-sm"
        >
          <span className="flex-1 text-start">{t.tomanOnly}</span>
          {!code && <Check className="size-3.5" />}
        </DropdownMenuItem>
        {rates.map((r) => (
          <DropdownMenuItem
            key={r.code}
            onSelect={(e) => {
              e.preventDefault();
              setCode(r.code);
            }}
            className="flex items-center gap-2.5 rounded-sm px-2 py-1.5 text-sm"
          >
            <span className="flex-1 text-start">{r.label} ({r.code})</span>
            {code === r.code && <Check className="size-3.5" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
