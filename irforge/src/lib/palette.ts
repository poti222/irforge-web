export const PALETTES = [
  { id: "orange", fa: "نارنجی", en: "Orange", swatch: "hsl(25 95% 50%)" },
  { id: "red", fa: "قرمز", en: "Red", swatch: "hsl(0 78% 50%)" },
  { id: "rose", fa: "رز", en: "Rose", swatch: "hsl(345 80% 50%)" },
  { id: "pink", fa: "صورتی", en: "Pink", swatch: "hsl(322 75% 50%)" },
  { id: "purple", fa: "بنفش", en: "Purple", swatch: "hsl(272 68% 54%)" },
  { id: "indigo", fa: "نیلی", en: "Indigo", swatch: "hsl(245 72% 56%)" },
  { id: "blue", fa: "آبی", en: "Blue", swatch: "hsl(217 90% 50%)" },
  { id: "sky", fa: "آبی آسمانی", en: "Sky", swatch: "hsl(199 92% 45%)" },
  { id: "cyan", fa: "فیروزه‌ای", en: "Cyan", swatch: "hsl(181 90% 45%)" },
  { id: "teal", fa: "سبز آبی", en: "Teal", swatch: "hsl(168 80% 45%)" },
  { id: "green", fa: "سبز", en: "Green", swatch: "hsl(142 70% 45%)" },
  { id: "lime", fa: "لیمویی", en: "Lime", swatch: "hsl(84 75% 45%)" },
  { id: "yellow", fa: "زرد", en: "Yellow", swatch: "hsl(45 95% 45%)" },
  { id: "brown", fa: "قهوه‌ای", en: "Brown", swatch: "hsl(25 45% 45%)" },
  { id: "graphite", fa: "گرافیتی", en: "Graphite", swatch: "hsl(220 10% 45%)" },
] as const;

export type PaletteId = (typeof PALETTES)[number]["id"];

const KEY = "irforge_palette";
const DEFAULT: PaletteId = "orange";

export function getStoredPalette(): PaletteId {
  try {
    const v = localStorage.getItem(KEY);
    if (v && PALETTES.some((p) => p.id === v)) return v as PaletteId;
  } catch {
    /* storage blocked */
  }
  return DEFAULT;
}

export function applyPalette(id: PaletteId): void {
  const el = document.documentElement;
  if (id === DEFAULT) el.removeAttribute("data-palette");
  else el.setAttribute("data-palette", id);
}

export function savePalette(id: PaletteId): void {
  applyPalette(id);
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* ignore */
  }
}
