import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { listCustomEmojis, type CustomEmoji } from "@/lib/custom-emoji";

type Ctx = { botId: string; emojis: CustomEmoji[]; isLoading: boolean } | null;
const EmojiCtx = createContext<Ctx>(null);

export const customEmojiQueryKey = (botId: string) => ["custom-emojis", botId] as const;

/** هر صفحه‌یِ مدیریتِ بات این را می‌پوشاند؛ همه‌یِ `Textarea`/`Input`ها زیرش خودکار دکمه‌یِ ایموجی می‌گیرند. */
export function EmojiProvider({ botId, children }: { botId: string; children: ReactNode }) {
  const { data, isLoading } = useQuery({
    queryKey: customEmojiQueryKey(botId),
    queryFn: () => listCustomEmojis(botId),
    staleTime: 30_000,
  });
  const value = useMemo<Ctx>(() => ({ botId, emojis: data?.emojis ?? [], isLoading }), [botId, data, isLoading]);
  return <EmojiCtx.Provider value={value}>{children}</EmojiCtx.Provider>;
}

export const useEmojiContext = () => useContext(EmojiCtx);
