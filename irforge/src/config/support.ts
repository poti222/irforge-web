/**
 * Support / contact configuration.
 *
 * These are PLACEHOLDER values for now. In a later stage they become editable
 * from the admin "Site settings" panel and are persisted in the owner's own
 * Google Sheet — so the owner can change the AI-support bot and their own
 * contact handle without a redeploy. Keeping them in one module means the
 * support page and the wiring only ever read from a single source.
 */
export interface SupportContacts {
  /** @username of the AI auto-support bot (handles tickets automatically). */
  aiBotUsername: string;
  /** @username for direct human contact with the platform owner. */
  ownerUsername: string;
  /** Friendly display name for the owner/brand. */
  ownerLabel: string;
}

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
