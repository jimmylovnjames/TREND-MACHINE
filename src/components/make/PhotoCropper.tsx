"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { centeredCrop, clampCrop, coverScale, type CropState, type LoadedPhoto } from "@/client/image";

/**
 * 9:16 crop frame with drag-to-position, pinch / slider / keyboard zoom.
 * Reports the crop in frame coordinates plus the frame size.
 */
export function PhotoCropper({
  photo,
  initial,
  onChange,
}: {
  photo: LoadedPhoto;
  initial?: { crop: CropState; frame: { w: number; h: number } } | null;
  onChange: (crop: CropState, frame: { w: number; h: number }) => void;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState({ w: 0, h: 0 });
  const [crop, setCrop] = useState<CropState>({ zoom: 1, x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ dist: number; zoom: number; cx: number; cy: number } | null>(null);

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setFrame({ w: r.width, h: r.height });
      const keep =
        initial && Math.abs(initial.frame.w - r.width) < 1 && Math.abs(initial.frame.h - r.height) < 1;
      setCrop(keep ? initial.crop : centeredCrop(r.width, r.height, photo.width, photo.height));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
    // `initial` is only read on (re)measure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo]);

  const apply = useCallback(
    (next: CropState) => {
      if (!frame.w) return;
      const c = clampCrop(next, frame.w, frame.h, photo.width, photo.height);
      setCrop(c);
      onChange(c, frame);
    },
    [frame, photo, onChange],
  );

  useEffect(() => {
    if (frame.w) onChange(crop, frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame.w, frame.h]);

  /** Zoom keeping the point (px, py) in frame coordinates fixed. */
  const zoomAround = (c: CropState, nextZoom: number, px: number, py: number): CropState => {
    const z = Math.min(4, Math.max(1, nextZoom));
    const ratio = z / c.zoom;
    return { zoom: z, x: px - (px - c.x) * ratio, y: py - (py - c.y) * ratio };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const rect = frameRef.current!.getBoundingClientRect();
      gesture.current = {
        dist: Math.hypot(a!.x - b!.x, a!.y - b!.y),
        zoom: crop.zoom,
        cx: (a!.x + b!.x) / 2 - rect.left,
        cy: (a!.y + b!.y) / 2 - rect.top,
      };
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && gesture.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      const g = gesture.current;
      apply(zoomAround(crop, (g.zoom * dist) / g.dist, g.cx, g.cy));
    } else if (pointers.current.size === 1) {
      apply({ ...crop, x: crop.x + (e.clientX - prev.x), y: crop.y + (e.clientY - prev.y) });
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) gesture.current = null;
  };
  const onWheel = (e: React.WheelEvent) => {
    const rect = frameRef.current!.getBoundingClientRect();
    apply(
      zoomAround(
        crop,
        crop.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08),
        e.clientX - rect.left,
        e.clientY - rect.top,
      ),
    );
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 40 : 12;
    const moves: Record<string, Partial<CropState>> = {
      ArrowLeft: { x: crop.x + step },
      ArrowRight: { x: crop.x - step },
      ArrowUp: { y: crop.y + step },
      ArrowDown: { y: crop.y - step },
    };
    if (moves[e.key]) {
      e.preventDefault();
      apply({ ...crop, ...moves[e.key] });
    } else if (e.key === "+" || e.key === "=")
      apply(zoomAround(crop, crop.zoom * 1.1, frame.w / 2, frame.h / 2));
    else if (e.key === "-") apply(zoomAround(crop, crop.zoom / 1.1, frame.w / 2, frame.h / 2));
  };

  const s = frame.w ? coverScale(frame.w, frame.h, photo.width, photo.height) * crop.zoom : 0;

  return (
    <div className="flex flex-col items-center gap-4">
      <div
        ref={frameRef}
        role="application"
        aria-label="Photo position. Drag to move, pinch or use the slider to zoom, arrow keys to nudge."
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
        className="relative aspect-[9/16] w-full max-w-[min(100%,calc(62dvh*9/16))] cursor-grab touch-none select-none overflow-hidden rounded-[var(--radius-card)] bg-surface active:cursor-grabbing"
      >
        {s > 0 && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo.previewUrl}
            alt="Your photo"
            draggable={false}
            className="pointer-events-none absolute left-0 top-0 max-w-none origin-top-left"
            style={{
              width: photo.width,
              height: photo.height,
              transform: `translate(${crop.x}px, ${crop.y}px) scale(${s})`,
            }}
          />
        )}
        {/* Framing guide: head room + feet line */}
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          <div className="absolute inset-x-6 top-[6%] border-t border-dashed border-white/40" />
          <div className="absolute inset-x-6 bottom-[5%] border-t border-dashed border-white/40" />
          <span className="absolute left-1/2 top-[6%] -translate-x-1/2 -translate-y-full pb-1 text-[10px] font-semibold uppercase tracking-wider text-white/70">
            head
          </span>
          <span
            className="absolute bottom-[5%] left-1/2 -translate-x-1/2 pt-1 text-[10px] font-semibold uppercase tracking-wider text-white/70"
            style={{ transform: "translate(-50%, 100%)" }}
          >
            feet
          </span>
        </div>
      </div>
      <label className="flex w-full max-w-xs items-center gap-3 text-sm text-muted">
        <span aria-hidden="true">−</span>
        <input
          type="range"
          min={1}
          max={4}
          step={0.01}
          value={crop.zoom}
          onChange={(e) => apply(zoomAround(crop, Number(e.target.value), frame.w / 2, frame.h / 2))}
          aria-label="Zoom"
          className="h-11 flex-1 accent-[var(--color-acid)]"
        />
        <span aria-hidden="true">+</span>
      </label>
    </div>
  );
}
