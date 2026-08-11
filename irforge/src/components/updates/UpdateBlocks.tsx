import { useT } from "@/hooks/use-translation";

/**
 * رندرِ واحدِ بدنه‌ی یک آپدیت.
 *
 * مودالِ داشبورد، صفحه‌ی جزئیات و پیش‌نمایشِ ادیتور **هر سه** از همین کامپوننت
 * استفاده می‌کنند. سه رندر جدا خیلی زود از هم فاصله می‌گیرند و آن‌وقت
 * «پیش‌نمایش» دیگر پیش‌نمایش نیست؛ یکی نمی‌تواند.
 */

export type UpdateBlock =
  | { type: "text"; id: string; content: string }
  | { type: "image"; id: string; url: string; alt: string; caption?: string };

/** اندازه‌ها با `size` عوض می‌شوند تا مودال و صفحه‌ی کامل یکی به نظر نرسند. */
export function UpdateBlocks({
  blocks,
  size = "comfortable",
}: {
  blocks: UpdateBlock[];
  size?: "compact" | "comfortable";
}) {
  const t = useT("updates") as Record<string, string>;
  const compact = size === "compact";

  if (blocks.length === 0) {
    return <p className="text-sm text-muted-foreground">{t.emptyBody ?? ""}</p>;
  }

  return (
    <div className={compact ? "space-y-3" : "space-y-5"}>
      {blocks.map((block, i) => {
        if (block.type === "text") {
          return (
            <p
              key={block.id}
              // متن **ساده** رندر می‌شود، نه HTML و نه Markdown. این محتوا به
              // داشبورد همه‌ی کاربرها می‌رسد و یک حساب ادمین زمینه‌ی رندرِ
              // مورد اعتماد نیست؛ متن غنی به یک sanitiser و فاز خودش نیاز دارد.
              className={
                compact
                  ? "whitespace-pre-wrap text-sm leading-7"
                  : "whitespace-pre-wrap text-base leading-relaxed"
              }
            >
              {block.content}
            </p>
          );
        }

        return (
          <figure key={block.id} className="space-y-1.5">
            <img
              src={block.url}
              alt={block.alt}
              // بدون نسبت ابعاد، هر عکس که لود می‌شود ارتفاع را عوض می‌کند و
              // مودال زیر دست کاربر می‌پرد.
              className="w-full rounded-lg border bg-muted object-contain"
              style={{ aspectRatio: "16 / 10" }}
              // اولی معمولاً بالای تاست و باید فوراً بیاید؛ بقیه نه.
              loading={i === 0 ? "eager" : "lazy"}
              decoding="async"
            />
            {block.caption && (
              // `text-start` نه `text-left`: در fa/ar باید آینه شود.
              <figcaption className="text-start text-xs text-muted-foreground">
                {block.caption}
              </figcaption>
            )}
          </figure>
        );
      })}
    </div>
  );
}
