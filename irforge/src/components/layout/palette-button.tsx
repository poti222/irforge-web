import { useEffect, useState } from "react";
import { Check, Palette } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useLanguage } from "@/hooks/use-language";
import { PALETTES, getStoredPalette, savePalette, type PaletteId } from "@/lib/palette";

/**
 * Colour-palette picker that sits next to the sun/moon toggle. The palette
 * (accent colour + tinted surfaces) is independent of light/dark, so every
 * swatch works in both modes — e.g. blue + dark, or green + light.
 */
export function PaletteButton({ className = "" }: { className?: string }) {
  const { lang } = useLanguage();
  const [current, setCurrent] = useState<PaletteId>("orange");

  // read after mount so SSG output and first client render match
  useEffect(() => setCurrent(getStoredPalette()), []);

  const fa = lang === "fa" || lang === "ar";
  const title = lang === "fa" ? "رنگ تم" : lang === "ar" ? "لون المظهر" : lang === "ru" ? "Цвет темы" : lang === "tr" ? "Tema rengi" : "Theme color";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={title}
          data-testid="button-palette"
          className={`relative inline-flex size-9 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:border-primary hover:text-primary ${className}`}
        >
          <Palette className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-3">
        <p className="mb-2 text-xs font-semibold text-muted-foreground">{title}</p>
        <div className="grid grid-cols-5 gap-2">
          {PALETTES.map((p) => {
            const label = fa && p.fa ? p.fa : p.en;
            const active = p.id === current;
            return (
              <button
                key={p.id}
                type="button"
                title={label}
                aria-label={label}
                aria-pressed={active}
                data-testid={`palette-${p.id}`}
                onClick={() => {
                  savePalette(p.id);
                  setCurrent(p.id);
                }}
                className={`flex size-9 items-center justify-center rounded-full border-2 transition-transform hover:scale-110 ${
                  active ? "border-foreground" : "border-transparent"
                }`}
                style={{ backgroundColor: p.swatch }}
              >
                {active && <Check className="size-4 text-white drop-shadow" />}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
