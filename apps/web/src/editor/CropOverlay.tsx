import { useEffect, useRef, useState } from "react"
import { useEditor } from "./editorContext"
import type { CropRegion } from "./image"
import {
  anchorForHandle,
  canvasToImageCoords,
  clampCropRegion,
  constrainAspectRatio,
  imageToCanvasCoords,
  baseToViewRect,
  viewToBasePoint,
  IDENTITY_VIEW,
  parseAspectRatio,
} from "./crop"

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
  const { image, cropRegion, setCrop, cropRatio, commit, view, setView } = useEditor()
  const ref = useRef<HTMLDivElement>(null)
  const dragRef = useRef<Drag | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [draft, setDraft] = useState<CropRegion | null>(cropRegion)

  // Latest draft/image/setCrop/commit, kept in refs so the unmount committer below
  // can read them without re-subscribing (setCrop/commit get a fresh identity each render).
  const draftRef = useRef(draft)
  const imageRef = useRef(image)
  const setCropRef = useRef(setCrop)
  const commitRef = useRef(commit)
  useEffect(() => {
    draftRef.current = draft
    imageRef.current = image
    setCropRef.current = setCrop
    commitRef.current = commit
  })
  // True once Enter has already committed, so the unmount committer doesn't re-apply.
  const settledRef = useRef(false)

  // Re-sync the draft when the crop changes from outside (panel, reset, …).
  // React's "adjust state during render" pattern — no effect needed.
  const [prevCrop, setPrevCrop] = useState(cropRegion)
  if (prevCrop !== cropRegion) {
    setPrevCrop(cropRegion)
    setDraft(cropRegion)
  }

  // Re-impose the aspect ratio on the current draft the moment a new ratio is
  // selected (same "adjust state during render" pattern). Anchored center so the
  // shrink is symmetric; 'Free' (null aspect) leaves the draft as-is.
  const [prevRatio, setPrevRatio] = useState(cropRatio)
  if (prevRatio !== cropRatio) {
    setPrevRatio(cropRatio)
    if (image !== null && draft !== null) {
      const a = parseAspectRatio(cropRatio, image.width, image.height)
      if (a !== null) {
        setDraft(clampCropRegion(
          constrainAspectRatio(draft, a, 'center'),
          image.width, image.height,
        ))
      }
    }
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

  // Fit the image on entering the tool. The crop frame spans the whole image, so
  // under any zoom its edges sit outside the viewport and the overlay is simply
  // not there to grab — and it cannot be recovered, because this overlay covers
  // the canvas that listens for wheel/drag, freezing the view while it is up.
  // Lightroom fits on entering Crop for the same reason.
  useEffect(() => { setView(IDENTITY_VIEW) }, [setView])

  // Commit the pending draft when the overlay unmounts — i.e. when the user
  // leaves the Crop tool. The draft is otherwise local and would be discarded on
  // unmount, so without this the crop only applies via Enter (and never at all
  // once the aspect panel has stolen keyboard focus). Enter sets `settledRef` so
  // it isn't committed twice.
  useEffect(() => {
    return () => {
      if (settledRef.current) return
      const d = draftRef.current
      const img = imageRef.current
      if (d === null || img === null) return
      setCropRef.current(clampCropRegion(d, img.width, img.height))
      // Checkpoint the applied crop as one undo step.
      commitRef.current()
    }
  }, [])

  if (image === null) return null

  // Numeric aspect for the selected label, or null for a free crop.
  const aspect = parseAspectRatio(cropRatio, image.width, image.height)

  // The draft, defaulting to the full frame when no crop is set yet.
  const region: CropRegion = draft ?? { x: 0, y: 0, width: image.width, height: image.height }

  /** Current pointer position in image px. */
  const toImage = (e: React.PointerEvent) => {
    const box = ref.current!.getBoundingClientRect()
    // Undo the canvas' zoom/pan first: everything below assumes the fitted
    // layout, so without this the mapping is off by exactly the zoom factor.
    const base = viewToBasePoint(
      { x: e.clientX - box.left, y: e.clientY - box.top },
      size.w, size.h, view,
    )
    return canvasToImageCoords(base, image.width, image.height, size.w, size.h)
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

    if (drag.kind === 'move') {
      // A translation never changes the aspect, so no constrain is needed.
      const next: CropRegion = {
        ...drag.origin,
        x: drag.origin.x + (p.x - drag.startX),
        y: drag.origin.y + (p.y - drag.startY),
      }
      setDraft(clampCropRegion(next, image.width, image.height))
      return
    }

    // Resize: move only the edge(s) the grabbed handle controls; keep the rest fixed.
    const left = drag.fx === 0 ? p.x : region.x
    const right = drag.fx === 1 ? p.x : region.x + region.width
    const top = drag.fy === 0 ? p.y : region.y
    const bottom = drag.fy === 1 ? p.y : region.y + region.height
    const next: CropRegion = {
      x: Math.min(left, right),
      y: Math.min(top, bottom),
      width: Math.abs(right - left),
      height: Math.abs(bottom - top),
    }
    // Clamp FIRST (may break the ratio by pinning one edge to the image bound),
    // then constrain (re-imposes the ratio by shrinking inside the clamped box).
    let result = clampCropRegion(next, image.width, image.height)
    if (aspect !== null) {
      result = constrainAspectRatio(result, aspect, anchorForHandle(drag.fx, drag.fy))
    }
    setDraft(result)
  }

  // Releasing the pointer ends the drag but does NOT commit: the draft stays
  // local until Enter. Escape discards, Enter commits (see onKeyDown).
  const endDrag = (e: React.PointerEvent) => {
    if (dragRef.current === null) return
    dragRef.current = null
    ref.current?.releasePointerCapture(e.pointerId)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    // While the overlay has focus it is modal: swallow every key so global
    // shortcuts (tool switch, etc.) stay suspended during cropping.
    e.stopPropagation()
    if (e.key === 'Enter') {
      settledRef.current = true                       // don't re-commit on unmount
      setCrop(clampCropRegion(region, image.width, image.height))
      commit()                                        // checkpoint the applied crop
      onDone()                                       // commit, then leave the tool
    }
    if (e.key === 'Escape') setDraft(cropRegion)
  }

  // Where the crop sits in the fitted layout, then where that actually lands on
  // screen once the canvas' zoom/pan is applied — the frame must track the image.
  const rect = baseToViewRect(
    imageToCanvasCoords(region, image.width, image.height, size.w, size.h),
    size.w, size.h, view,
  )
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
          {/* Dark mask outside the crop — 4 rects (simplest to reason about).
              Sizes are clamped at 0: when the frame overflows the container a
              band can compute negative, and SVG silently drops such a rect —
              i.e. the dimming would vanish rather than degrade. */}
          <rect x={0}       y={0}       width={size.w}                        height={Math.max(0, ry)}               fill="black" opacity={0.5} />
          <rect x={0}       y={ry + rh} width={size.w}                        height={Math.max(0, size.h - ry - rh)} fill="black" opacity={0.5} />
          <rect x={0}       y={ry}      width={Math.max(0, rx)}               height={rh}                            fill="black" opacity={0.5} />
          <rect x={rx + rw} y={ry}      width={Math.max(0, size.w - rx - rw)} height={rh}                            fill="black" opacity={0.5} />

          {/* Frame body — transparent fill so the interior is draggable to move. */}
          <rect
            x={rx} y={ry} width={rw} height={rh}
            fill="transparent" stroke="white" strokeWidth={1}
            style={{ cursor: 'move' }}
            onPointerDown={startMove}
          />

          {/* Handles. With a locked ratio, only corners are shown: edge handles
              feel wrong under fit-inside (shrink-only) constraining. */}
          {HANDLES.filter(({ fx, fy }) => aspect === null || (fx !== 0.5 && fy !== 0.5)).map(({ fx, fy }) => (
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
