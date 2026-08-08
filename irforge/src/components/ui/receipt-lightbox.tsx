import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ExternalLink, Minus, Plus, RotateCcw } from "lucide-react";
import { useT } from "@/hooks/use-translation";

/**
 * Shared viewer for payment receipts.
 *
 * Replaces the two patterns that were in use: a raw <img> inside a dialog
 * (no way to read small print on a photographed bank slip) and an
 * <a target="_blank"> to the file (which lands on a bare image tab, or is
 * swallowed entirely by a popup blocker).
 *
 * Zoom works with the buttons, the wheel, and double-click; once zoomed the
 * image can be dragged. Pointer events cover mouse and touch alike, so there
 * is no separate mobile path.
 */

const MIN_SCALE = 1;
const MAX_SCALE = 5;
const STEP = 0.5;

export function ReceiptLightbox({
  src,
  alt,
  children,
}: {
  src: string;
  alt?: string;
  /** the trigger — usually a Button */
  children: ReactNode;
}) {
  const t = useT("common");
  const [open, setOpen] = useState(false);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  const reset = useCallback(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  // Always reopen at 1x — carrying the previous zoom over to a different
  // receipt just looks broken.
  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  const zoomBy = useCallback((delta: number) => {
    setScale((s) => {
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, +(s + delta).toFixed(2)));
      if (next === MIN_SCALE) setOffset({ x: 0, y: 0 });
      return next;
    });
  }, []);

  function onPointerDown(e: React.PointerEvent<HTMLImageElement>) {
    if (scale === MIN_SCALE) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  }
  function onPointerMove(e: React.PointerEvent<HTMLImageElement>) {
    const d = drag.current;
    if (!d) return;
    setOffset({ x: d.ox + (e.clientX - d.x), y: d.oy + (e.clientY - d.y) });
  }
  function onPointerUp(e: React.PointerEvent<HTMLImageElement>) {
    drag.current = null;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-4xl gap-3">
        <DialogTitle className="text-base">{t.receiptViewerTitle}</DialogTitle>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-8"
            onClick={() => zoomBy(-STEP)}
            disabled={scale <= MIN_SCALE}
            aria-label={t.zoomOut}
          >
            <Minus className="size-4" />
          </Button>
          <span className="min-w-12 text-center text-xs tabular-nums text-muted-foreground" dir="ltr">
            {Math.round(scale * 100)}%
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-8"
            onClick={() => zoomBy(STEP)}
            disabled={scale >= MAX_SCALE}
            aria-label={t.zoomIn}
          >
            <Plus className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={reset}
            disabled={scale === MIN_SCALE && offset.x === 0 && offset.y === 0}
          >
            <RotateCcw className="me-1.5 size-3.5" />
            {t.resetZoom}
          </Button>
          <Button type="button" variant="ghost" size="sm" className="ms-auto" asChild>
            <a href={src} target="_blank" rel="noreferrer">
              <ExternalLink className="me-1.5 size-3.5" />
              {t.openOriginal}
            </a>
          </Button>
        </div>

        <div
          className="relative flex max-h-[72vh] items-center justify-center overflow-hidden rounded-md bg-muted"
          onWheel={(e) => {
            // only hijack the wheel while the pointer is over the image area
            e.preventDefault();
            zoomBy(e.deltaY < 0 ? STEP / 2 : -STEP / 2);
          }}
        >
          <img
            src={src}
            alt={alt ?? t.receiptViewerTitle}
            draggable={false}
            onDoubleClick={() => (scale === MIN_SCALE ? setScale(2) : reset())}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            style={{
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
              cursor: scale > MIN_SCALE ? (drag.current ? "grabbing" : "grab") : "zoom-in",
              touchAction: "none",
            }}
            className="max-h-[72vh] w-auto max-w-full select-none object-contain transition-transform duration-100"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
