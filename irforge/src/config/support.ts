/**
 * Support / contact configuration.
 *
 * `SUPPORT_CONTACTS` below is still a PLACEHOLDER (see its own TODO) — direct
 * contact handles are a separate concern, deferred to a later stage.
 *
 * The education-channel/Instagram links, however, are now editable from the
 * admin "Site settings" panel (IRFORGE_PROMPT_V3 Phase 21) and persisted in
 * `platform_settings` on the server (see api-server/src/lib/platformSettings.ts,
 * key `support_links`). `useSupportLinks()` below fetches the live value;
 * the constants stay exported as the fallback/default AND for the handful of
 * non-component call sites (structured-data.ts's `Organization.sameAs`) that
 * run outside React and need a value synchronously.
 */
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";

export interface SupportContacts {
  /** @username of the AI auto-support bot (handles tickets automatically). */
  aiBotUsername: string;
  /** @username for direct human contact with the platform owner. */
  ownerUsername: string;
  /** Friendly display name for the owner/brand. */
  ownerLabel: string;
}

/**
 * Public education channel — video walkthroughs (getting a bot token, first
 * bot, plugins). Unlike the handles above this is a confirmed, real channel,
 * so it is a full URL rather than a placeholder @username. Kept here so the
 * learn page, the support page and the support FAB all read one source.
 */
export const EDUCATION_CHANNEL_URL = "https://t.me/irforge_Education";

/** Display form of the education channel, e.g. for a handle chip. */
export const EDUCATION_CHANNEL_HANDLE = "@irforge_Education";

/**
 * Public Instagram account. Like the education channel this is a real brand
 * profile, not a placeholder, so it is safe to publish in Organization.sameAs
 * (see src/lib/structured-data.ts).
 */
export const INSTAGRAM_URL = "https://instagram.com/ir_forge";

/** Display form of the Instagram account. */
export const INSTAGRAM_HANDLE = "@ir_forge";

// TODO [settings stage]: override these from the values stored in the owner's
// Google Sheet (read via the settings endpoint) instead of the hardcoded
// defaults below.
export const SUPPORT_CONTACTS: SupportContacts = {
  aiBotUsername: "irforge_support_bot",
  ownerUsername: "irforge_admin",
  ownerLabel: "IrForge",
};

/** Build a t.me deep link from a @username (tolerates a leading @). */
export function telegramUrl(username: string): string {
  return `https://t.me/${username.replace(/^@/, "")}`;
}

/** Normalise a handle for display, always with a single leading @. */
export function atHandle(username: string): string {
  return `@${username.replace(/^@/, "")}`;
}

// ─── Editable tutorial links (IRFORGE_PROMPT_V3 Phase 21) ──────────────────

/** One named link in the super-admin's tutorial-link list. */
export interface TutorialLink {
  id: string;
  label: string;
  url: string;
}

export interface SupportLinksSettings {
  educationChannelUrl: string;
  educationChannelHandle: string;
  instagramUrl: string;
  instagramHandle: string;
  tutorialLinks: TutorialLink[];
}

/**
 * Built from the constants above, so a visitor who loads the page before the
 * fetch resolves — or before the super-admin has ever saved anything — sees
 * exactly the same links this file always shipped.
 */
export const DEFAULT_SUPPORT_LINKS: SupportLinksSettings = {
  educationChannelUrl: EDUCATION_CHANNEL_URL,
  educationChannelHandle: EDUCATION_CHANNEL_HANDLE,
  instagramUrl: INSTAGRAM_URL,
  instagramHandle: INSTAGRAM_HANDLE,
  tutorialLinks: [
    { id: "education-channel", label: "ویدیوهای آموزشی", url: EDUCATION_CHANNEL_URL },
  ],
};

export const SUPPORT_LINKS_QUERY_KEY = ["support-links"] as const;

/**
 * The live, super-admin-editable support links. `initialData` means every
 * caller — including the prerendered marketing pages, rendered synchronously
 * with `renderToString` and no network — gets the correct fallback content on
 * first paint; a real visitor's browser then quietly refetches and picks up
 * whatever the super-admin has since changed.
 */
export function useSupportLinks(): SupportLinksSettings {
  const { data } = useQuery({
    queryKey: SUPPORT_LINKS_QUERY_KEY,
    queryFn: () => customFetch<SupportLinksSettings>("/api/support-links"),
    initialData: DEFAULT_SUPPORT_LINKS,
    staleTime: 5 * 60 * 1000,
  });
  return data;
}
