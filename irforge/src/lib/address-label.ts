/**
 * Display label for a business address in lists and pickers.
 *
 * An address has no required field: its `title` is only an internal label the
 * admin may leave blank (the end user never sees it). When it is blank the
 * label is built from what the address actually contains — text, then phone,
 * then the first contact entry — and finally a neutral placeholder.
 *
 * Mirror of `addressLabel` in api-server/src/lib/addressStore.ts and of
 * `display_label` in irforge-app plugins/address/domain.py; keep the three in step.
 */
export interface AddressLabelSource {
  title?: string | null;
  text?: string | null;
  phone?: string | null;
  contact_entries?: Array<{ value?: string | null }> | null;
}

const clip = (v: unknown): string => {
  const t = String(v ?? "").replace(/\s+/g, " ").trim();
  return t.length > 40 ? `${t.slice(0, 40)}…` : t;
};

export function addressLabel(addr: AddressLabelSource, fallback: string): string {
  return (
    clip(addr.title) ||
    clip(addr.text) ||
    clip(addr.phone) ||
    clip((addr.contact_entries ?? []).find((e) => e?.value)?.value) ||
    fallback
  );
}
