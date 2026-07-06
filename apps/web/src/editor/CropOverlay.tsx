import { useEffect, useRef, useState } from "react"
import { useEditor } from "./editorContext"
import type { CropRegion } from "./image"
import { canvasToImageCoords, clampCropRegion, imageToCanvasCoords } from "./crop"

/**
 * What the pointer grabbed. `move` drags the whole box (remembering where the
 * drag started, in image px, and the region at that moment); `resize` carries
 * the fractional position of the grabbed handle (fx, fy ∈ {0, 0.5, 1}).
 */
type Drag =
  | { kind: 'move'; startX: number; startY: number; origin: CropRegion }
  | { kind: 'resize'; fx: number; fy: number }

// The 8 handles: every (fx, fy) in {0, 0.5, 1}² except the center.
const HANDLES = [0, 0.5, 1]
  .flatMap((fy) => [0, 0.5, 1].map((fx) => ({ fx, fy })))
  .filter(({ fx, fy }) => !(fx === 0.5 && fy === 0.5))

/** Cursor hint for the handle at (fx, fy): edges resize on one axis, corners on two. */
const handleCursor = (fx: number, fy: number): string => {
  if (fx === 0.5) return 'ns-resize'
  if (fy === 0.5) return 'ew-resize'
  return fx === fy ? 'nwse-resize' : 'nesw-resize'
}

interface CropOverlayProps {
  /** Called after `Enter` commits the crop, so the host can leave the Crop tool. */
  onDone: () => void
}

/**
 * Interactive crop overlay drawn on top of the canvas: a dimming mask, the crop
 * frame and 8 drag handles. Coordinates live in image pixels (the `draft`) and
 * are mapped to/from container/CSS pixels through the letterbox helpers in
 * `crop.ts`. The draft stays local while editing; `Enter` commits it to the
 * store and calls `onDone`, `Escape` discards it.
 */
export function CropOverlay({ onDone }: CropOverlayProps) {
  const { image, cropRegion, setCrop } = useEditor()
  const ref = useRef<HTMLDivElement>(null)
  const dragRef = useRef<Drag | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [draft, setDraft] = useState<CropRegion | null>(cropRegion)

  // Re-sync the draft when the crop changes from outside (panel, reset, …).
  // React's "adjust state during render" pattern — no effect needed.
  const [prevCrop, setPrevCrop] = useState(cropRegion)
  if (prevCrop !== cropRegion) {
    setPrevCrop(cropRegion)
    setDraft(cropRegion)
  }

  // Measure the container so our letterbox math matches the canvas underneath.
  useEffect(() => {
    const el = ref.current
    if (el === null) return
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Grab keyboard focus on mount so Enter/Escape reach onKeyDown right away.
  useEffect(() => { ref.current?.focus() }, [])

  if (image === null) return null

  // The draft, defaulting to the full frame when no crop is set yet.
  const region: CropRegion = draft ?? { x: 0, y: 0, width: image.width, height: image.height }

  /** Current pointer position in image px. */
  const toImage = (e: React.PointerEvent) => {
    const box = ref.current!.getBoundingClientRect()
    return canvasToImageCoords(
      { x: e.clientX - box.left, y: e.clientY - box.top },
      image.width, image.height, size.w, size.h,
    )
  }

  const startMove = (e: React.PointerEvent) => {
    e.stopPropagation()
    ref.current?.focus()                            // keep keys working after a drag
    const p = toImage(e)
    dragRef.current = { kind: 'move', startX: p.x, startY: p.y, origin: region }
    ref.current?.setPointerCapture(e.pointerId)
  }

  const startResize = (fx: number, fy: number) => (e: React.PointerEvent) => {
    e.stopPropagation()
    ref.current?.focus()                            // keep keys working after a drag
    dragRef.current = { kind: 'resize', fx, fy }
    ref.current?.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current
    if (drag === null) return
    const p = toImage(e)

    let next: CropRegion
    if (drag.kind === 'move') {
      next = {
        ...drag.origin,
        x: drag.origin.x + (p.x - drag.startX),
        y: drag.origin.y + (p.y - drag.startY),
      }
    } else {
      // Move only the edge(s) the grabbed handle controls; keep the rest fixed.
      const left = drag.fx === 0 ? p.x : region.x
      const right = drag.fx === 1 ? p.x : region.x + region.width
      const top = drag.fy === 0 ? p.y : region.y
      const bottom = drag.fy === 1 ? p.y : region.y + region.height
      next = {
        x: Math.min(left, right),
        y: Math.min(top, bottom),
        width: Math.abs(right - left),
        height: Math.abs(bottom - top),
      }
    }
    setDraft(clampCropRegion(next, image.width, image.height))
  }

  // Releasing the pointer ends the drag but does NOT commit: the draft stays
  // local until Enter. Escape discards, Enter commits (see onKeyDown).
  const endDrag = (e: React.PointerEvent) => {
    if (dragRef.current === null) return
    dragRef.current = null
    ref.current?.releasePointerCapture(e.pointerId)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      setCrop(clampCropRegion(region, image.width, image.height))
      onDone()                                       // commit, then leave the tool
    }
    if (e.key === 'Escape') setDraft(cropRegion)
  }

  const rect = imageToCanvasCoords(region, image.width, image.height, size.w, size.h)
  const { x: rx, y: ry, width: rw, height: rh } = rect
  const ready = size.w > 0 && size.h > 0

  return (
    <div
      ref={ref}
      tabIndex={0}                                   // focusable so it gets keys
      onKeyDown={onKeyDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      style={{ position: 'absolute', inset: 0, outline: 'none' }}
    >
      {ready && (
        <svg width="100%" height="100%" style={{ display: 'block' }}>
          {/* Dark mask outside the crop — 4 rects (simplest to reason about). */}
          <rect x={0}       y={0}       width={size.w}            height={ry}                fill="black" opacity={0.5} />
          <rect x={0}       y={ry + rh} width={size.w}            height={size.h - ry - rh}  fill="black" opacity={0.5} />
          <rect x={0}       y={ry}      width={rx}                height={rh}                fill="black" opacity={0.5} />
          <rect x={rx + rw} y={ry}      width={size.w - rx - rw}  height={rh}                fill="black" opacity={0.5} />

          {/* Frame body — transparent fill so the interior is draggable to move. */}
          <rect
            x={rx} y={ry} width={rw} height={rh}
            fill="transparent" stroke="white" strokeWidth={1}
            style={{ cursor: 'move' }}
            onPointerDown={startMove}
          />

          {/* 8 handles. */}
          {HANDLES.map(({ fx, fy }) => (
            <rect
              key={`${fx}-${fy}`}
              x={rx + fx * rw - 4} y={ry + fy * rh - 4}
              width={8} height={8} fill="white"
              style={{ cursor: handleCursor(fx, fy) }}
              onPointerDown={startResize(fx, fy)}
            />
          ))}
        </svg>
      )}
    </div>
  )
}
