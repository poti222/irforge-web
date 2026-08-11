import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import {
  GripVertical, ChevronUp, ChevronDown, Trash2, Undo2,
  Type as TypeIcon, ImagePlus, Loader2, AlertTriangle,
} from "lucide-react";
import { useT } from "@/hooks/use-translation";
import type { UpdateBlock } from "@/components/updates/UpdateBlocks";

/**
 * ادیتور بلوک‌های یک آپدیت: پشته‌ای عمودی از کارت‌ها، هر کدام یک بند متن یا
 * یک عکس، با هر ترتیبی.
 *
 * جابه‌جایی **هم** با کشیدن و **هم** با دکمه‌های بالا/پایین: فقط drag-and-drop
 * با کیبورد اصلاً کار نمی‌کند و روی لمسی هم بد است.
 *
 * حذف با «برگردان» درجا انجام می‌شود، نه دیالوگ تأیید — یک بلوک ارزان است و
 * یک مودال به‌ازای هر بند حذف‌شده خسته‌کننده می‌شود.
 */

export const BLOCK_TEXT_MAX = 8000;
export const MAX_BLOCKS = 50;

export function newTextBlock(content = ""): UpdateBlock {
  return { type: "text", id: crypto.randomUUID(), content };
}
export function newImageBlock(url: string): UpdateBlock {
  return { type: "image", id: crypto.randomUUID(), url, alt: "" };
}

export function UpdateBlockEditor({
  blocks,
  onChange,
  onPickImages,
  busyImages,
  disabled,
}: {
  blocks: UpdateBlock[];
  onChange: (next: UpdateBlock[]) => void;
  /** برمی‌گرداند: data-URLهای فشرده‌شده. آپلود در والد است تا فشرده‌سازی یکی بماند. */
  onPickImages: () => void;
  busyImages?: boolean;
  disabled?: boolean;
}) {
  const t = useT("updates") as Record<string, string>;
  const [dragId, setDragId] = useState<string | null>(null);
  /** آخرین بلوک حذف‌شده و جایش، برای «برگردان». */
  const [undo, setUndo] = useState<{ block: UpdateBlock; index: number } | null>(null);
  const undoTimer = useRef<number | null>(null);

  useEffect(() => () => { if (undoTimer.current) window.clearTimeout(undoTimer.current); }, []);

  function patch(id: string, changes: Partial<UpdateBlock>) {
    onChange(blocks.map((b) => (b.id === id ? ({ ...b, ...changes } as UpdateBlock) : b)));
  }

  function move(index: number, delta: number) {
    const to = index + delta;
    if (to < 0 || to >= blocks.length) return;
    const next = [...blocks];
    const [item] = next.splice(index, 1);
    next.splice(to, 0, item);
    onChange(next);
  }

  function remove(index: number) {
    const block = blocks[index];
    onChange(blocks.filter((_, i) => i !== index));
    setUndo({ block, index });
    if (undoTimer.current) window.clearTimeout(undoTimer.current);
    undoTimer.current = window.setTimeout(() => setUndo(null), 8000);
  }

  function restore() {
    if (!undo) return;
    const next = [...blocks];
    next.splice(Math.min(undo.index, next.length), 0, undo.block);
    onChange(next);
    setUndo(null);
  }

  function dropOn(targetId: string) {
    if (!dragId || dragId === targetId) return;
    const from = blocks.findIndex((b) => b.id === dragId);
    const to = blocks.findIndex((b) => b.id === targetId);
    if (from < 0 || to < 0) return;
    const next = [...blocks];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onChange(next);
    setDragId(null);
  }

  const atLimit = blocks.length >= MAX_BLOCKS;

  return (
    <div className="space-y-3">
      {blocks.map((block, i) => (
        <Card
          key={block.id}
          draggable={!disabled}
          onDragStart={() => setDragId(block.id)}
          onDragEnd={() => setDragId(null)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => dropOn(block.id)}
          className={dragId === block.id ? "opacity-50" : undefined}
        >
          <CardContent className="space-y-2 p-3">
            <div className="flex items-center gap-1">
              <GripVertical className="size-4 cursor-grab text-muted-foreground" aria-hidden="true" />
              <span className="text-xs font-medium text-muted-foreground">
                {block.type === "text" ? t.blockText : t.blockImage} · {i + 1}
              </span>
              <div className="ms-auto flex items-center gap-0.5">
                {/* دکمه‌های بالا/پایین در کنار drag: تنها راهِ کیبورد. */}
                <Button
                  type="button" variant="ghost" size="icon" className="size-8"
                  disabled={disabled || i === 0}
                  aria-label={t.moveUp}
                  onClick={() => move(i, -1)}
                >
                  <ChevronUp className="size-4" />
                </Button>
                <Button
                  type="button" variant="ghost" size="icon" className="size-8"
                  disabled={disabled || i === blocks.length - 1}
                  aria-label={t.moveDown}
                  onClick={() => move(i, 1)}
                >
                  <ChevronDown className="size-4" />
                </Button>
                <Button
                  type="button" variant="ghost" size="icon" className="size-8"
                  disabled={disabled}
                  aria-label={t.removeBlock}
                  onClick={() => remove(i)}
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </div>
            </div>

            {block.type === "text" ? (
              <div className="space-y-1">
                <AutoTextarea
                  value={block.content}
                  disabled={disabled}
                  placeholder={t.textPlaceholder}
                  onChange={(v) => patch(block.id, { content: v.slice(0, BLOCK_TEXT_MAX) } as Partial<UpdateBlock>)}
                />
                <p className="text-end text-xs tabular-nums text-muted-foreground">
                  {block.content.length} / {BLOCK_TEXT_MAX}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {/* پیش‌نمایش در همان نسبتی که واقعاً رندر می‌شود. */}
                <img
                  src={block.url}
                  alt={block.alt || ""}
                  className="w-full rounded-md border bg-muted object-contain"
                  style={{ aspectRatio: "16 / 10" }}
                />
                <div className="space-y-1">
                  <Label htmlFor={`alt-${block.id}`} className="text-xs">
                    {t.altLabel} <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id={`alt-${block.id}`}
                    value={block.alt}
                    disabled={disabled}
                    placeholder={t.altPlaceholder}
                    onChange={(e) => patch(block.id, { alt: e.target.value } as Partial<UpdateBlock>)}
                    aria-invalid={block.alt.trim() === ""}
                  />
                  {block.alt.trim() === "" && (
                    <p className="flex items-center gap-1.5 text-xs text-destructive">
                      <AlertTriangle className="size-3.5" aria-hidden="true" />
                      {t.altRequired}
                    </p>
                  )}
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`cap-${block.id}`} className="text-xs">{t.captionLabel}</Label>
                  <Input
                    id={`cap-${block.id}`}
                    value={block.caption ?? ""}
                    disabled={disabled}
                    placeholder={t.captionPlaceholder}
                    onChange={(e) => patch(block.id, { caption: e.target.value } as Partial<UpdateBlock>)}
                  />
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ))}

      {undo && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-dashed p-2">
          <span className="text-xs text-muted-foreground">{t.blockRemoved}</span>
          <Button type="button" variant="ghost" size="sm" onClick={restore}>
            <Undo2 className="me-1.5 size-3.5" /> {t.undo}
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button" variant="outline" size="sm"
          disabled={disabled || atLimit}
          onClick={() => onChange([...blocks, newTextBlock()])}
        >
          <TypeIcon className="me-1.5 size-4" /> {t.addText}
        </Button>
        <Button
          type="button" variant="outline" size="sm"
          disabled={disabled || atLimit || busyImages}
          onClick={onPickImages}
        >
          {busyImages ? <Loader2 className="me-1.5 size-4 animate-spin" /> : <ImagePlus className="me-1.5 size-4" />}
          {t.addImage}
        </Button>
        {atLimit && (
          <span className="text-xs text-muted-foreground">
            {(t.blockLimit ?? "").replace("{n}", String(MAX_BLOCKS))}
          </span>
        )}
      </div>
    </div>
  );
}

/** textarea که با محتوا قد می‌کشد — اسکرول داخل یک باکس کوتاه آزاردهنده است. */
function AutoTextarea({
  value, onChange, disabled, placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 600)}px`;
  }, [value]);
  return (
    <Textarea
      ref={ref}
      rows={3}
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="resize-none overflow-hidden"
    />
  );
}
