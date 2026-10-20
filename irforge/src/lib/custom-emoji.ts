import { customFetch } from "@workspace/api-client-react";

/** آینه‌یِ `CustomEmojiEntry` در api-server (و `utils/custom_emoji.py` در بات). */
export interface CustomEmoji {
  name: string;
  id: string;
  fallback: string;
  animated: boolean;
  enabled: boolean;
  pack: string;
}

export const EMOJI_NAME_RE = /^[a-z][a-z0-9_]{1,31}$/;

export const emojiToken = (name: string) => `:${name}:`;

/** تصویرِ پیش‌نمایشِ ایموجی؛ تلگرام پیش‌نمایشِ عمومی ندارد، پس fallback نشان داده می‌شود. */
export const emojiLabel = (e: CustomEmoji) => `${e.fallback} ${emojiToken(e.name)}`;

export const listCustomEmojis = (botId: string) =>
  customFetch<{ emojis: CustomEmoji[] }>(`/api/bots/${botId}/custom-emojis`, { method: "GET" });

export const saveCustomEmojis = (botId: string, emojis: CustomEmoji[]) =>
  customFetch<{ emojis: CustomEmoji[] }>(`/api/bots/${botId}/custom-emojis`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ emojis }),
  });

export interface ImportReportRow { pack: string; added: number; error?: string }

export const importEmojiPacks = (botId: string, packs: string[]) =>
  customFetch<{ emojis: CustomEmoji[]; report: ImportReportRow[] }>(`/api/bots/${botId}/custom-emojis/import-pack`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ packs }),
  });

export const importEmojiIds = (botId: string, ids: string[]) =>
  customFetch<{ emojis: CustomEmoji[] }>(`/api/bots/${botId}/custom-emojis/import-ids`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });

export interface LibraryPack {
  slug: string; title: string; count: number; priceToman: number; free: boolean; animated: boolean;
  preview: { name: string; emoji: string; id: string }[];
}

/** کتابخانه‌یِ پک‌هایِ آمادهِ پلتفرم (برایِ همه‌یِ کاربران). */
export const listEmojiLibrary = () => customFetch<{ packs: LibraryPack[] }>("/api/emoji-packs", { method: "GET" });

export const addLibraryPack = (botId: string, slug: string) =>
  customFetch<{ emojis: CustomEmoji[]; added: number }>(`/api/bots/${botId}/custom-emojis/add-library-pack`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug }),
  });

/** متنِ `value` را با `token` در محلِ مکان‌نما (یا انتها) پر می‌کند؛ مکانِ جدیدِ مکان‌نما را هم برمی‌گرداند. */
export function insertAtCursor(value: string, token: string, start: number | null, end: number | null) {
  const s = start ?? value.length;
  const e = end ?? s;
  return { next: value.slice(0, s) + token + value.slice(e), caret: s + token.length };
}
