import { useEffect, useRef, useState } from "react"
import { useEditor } from "./editorContext"
import type { CropOverlayType } from "./editorContext"
import type { CropRegion } from "./image"
import {
  anchorForHandle,
  clampCropRegion,
  constrainAspectRatio,
  cropRegionToViewRect,
  effectiveAspect,
  pointerToImagePoint,
  refitCrop,
  IDENTITY_VIEW,
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
const guidesFor = (overlay: CropOverlayType, rx: number, ry: number, rw: number, rh: number) => {
  switch (overlay) {
    case 'thirds':
      return [
        <line key="tv1" x1={rx + rw / 3} y1={ry} x2={rx + rw / 3} y2={ry + rh} stroke="white" strokeWidth={1} opacity={1} />,
        <line key="tv2" x1={rx + 2 * rw / 3} y1={ry} x2={rx + 2 * rw / 3} y2={ry + rh} stroke="white" strokeWidth={1} opacity={1} />,
        <line key="th1" x1={rx} y1={ry + rh / 3} x2={rx + rw} y2={ry + rh / 3} stroke="white" strokeWidth={1} opacity={1} />,
        <line key="th2" x1={rx} y1={ry + 2 * rh / 3} x2={rx + rw} y2={ry + 2 * rh / 3} stroke="white" strokeWidth={1} opacity={1} />,
      ]
    case 'diagonal': {
      const x = rx, y = ry, w = rw, h = rh;

      // Puntos de división por tercios (Rejilla de fondo)
      const x13 = x + w / 3;
      const x23 = x + (2 * w) / 3;
      const y13 = y + h / 3;
      const y23 = y + (2 * h) / 3;

      return (
        <g key="harmonic-armature-grid">
          {/* 1. Recuadro contenedor exterior */}
          <rect
            x={x}
            y={y}
            width={w}
            height={h}
            fill="none"
            stroke="white"
            strokeWidth={1}
            opacity={0.4}
          />

          {/* 2. Rejilla de tercios discontinua (Dashed Lines) */}
          <line x1={x13} y1={y} x2={x13} y2={y + h} stroke="white" strokeWidth={1} strokeDasharray="4 4" opacity={0.4} />
          <line x1={x23} y1={y} x2={x23} y2={y + h} stroke="white" strokeWidth={1} strokeDasharray="4 4" opacity={0.4} />
          <line x1={x} y1={y13} x2={x + w} y2={y13} stroke="white" strokeWidth={1} strokeDasharray="4 4" opacity={0.4} />
          <line x1={x} y1={y23} x2={x + w} y2={y23} stroke="white" strokeWidth={1} strokeDasharray="4 4" opacity={0.4} />

          {/* 3. Diagonales principales de esquina a esquina */}
          <line x1={x} y1={y} x2={x + w} y2={y + h} stroke="white" strokeWidth={1.5} />
          <line x1={x} y1={y + h} x2={x + w} y2={y} stroke="white" strokeWidth={1.5} />

          {/* 4. Diagonales armónicas desde esquinas a tercios opuestos */}
          <line x1={x} y1={y + h} x2={x13} y2={y} stroke="white" strokeWidth={1.5} />
          <line x1={x} y1={y} x2={x23} y2={y + h} stroke="white" strokeWidth={1.5} />
          <line x1={x + w} y1={y} x2={x13} y2={y + h} stroke="white" strokeWidth={1.5} />
          <line x1={x + w} y1={y + h} x2={x23} y2={y} stroke="white" strokeWidth={1.5} />

          {/* 5. Diagonales cruzadas centrales entre tercios */}
          <line x1={x13} y1={y} x2={x23} y2={y + h} stroke="white" strokeWidth={1.5} />
          <line x1={x23} y1={y} x2={x13} y2={y + h} stroke="white" strokeWidth={1.5} />
        </g>
      );
    }
    
    case 'spiral': {
      const phi = (1 + Math.sqrt(5)) / 2;
      const b = Math.log(phi) / (Math.PI / 2);

      // Centro focal de la espiral
      const cx = rx + rw * 0.7236;
      const cy = ry + rh * 0.618;

      const startX = rx;
      const startY = ry + rh;

      const r0 = Math.hypot(startX - cx, startY - cy);
      const angle0 = Math.atan2(startY - cy, startX - cx);

      const totalTurns = 4;
      const steps = 400;

      // 1. Generar puntos base y detectar los extremos que la curva alcanza.
      const rawPoints: { x: number; y: number }[] = [];
      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;

      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const theta = t * (totalTurns * 2 * Math.PI);
        const r = r0 * Math.exp(-b * theta);
        const angle = angle0 + theta;

        const px = cx + r * Math.cos(angle);
        const py = cy + r * Math.sin(angle);

        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
        rawPoints.push({ x: px, y: py });
      }

      // 2. Scale and centre the spiral's natural bounding box so it fills the
      //    crop rectangle as much as the golden shape allows. A uniform contain
      //    fit (which may grow when the curve is naturally smaller) always uses
      //    the limiting dimension and centres the other — the golden spiral's
      //    aspect (~φ) never matches a 16:9 or 3:2 frame exactly, so a shrink-only
      //    fit about the focal centre would leave a small, off-centre curve.
      const bboxW = maxX - minX;
      const bboxH = maxY - minY;
      const scale = Math.min(rw / bboxW, rh / bboxH);

      // Centre the scaled bounding box on the crop frame.
      const offsetX = rx + (rw - bboxW * scale) / 2 - minX * scale;
      const offsetY = ry + (rh - bboxH * scale) / 2 - minY * scale;

      const points = rawPoints.map((pt, i) => {
        const px = pt.x * scale + offsetX;
        const py = pt.y * scale + offsetY;
        return `${i === 0 ? 'M' : 'L'} ${px.toFixed(2)} ${py.toFixed(2)}`;
      });

      return (
        <g key="golden-spiral-bounded">
          <rect
            x={rx}
            y={ry}
            width={rw}
            height={rh}
            fill="none"
            stroke="white"
            strokeWidth={1}
            opacity={0.3}
          />
          <path
            d={points.join(' ')}
            fill="none"
            stroke="white"
            strokeWidth={2}
          />
        </g>
      );
    }
    default: // 'square' — not implemented, draw nothing
      return null
  }
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
  const { image, cropRegion, setCrop, cropRatio, cropOrientation, commit, view, setView, cropOverlay, setCropOverlay, orientation, geometry } = useEditor();
  const overlay = cropOverlay || 'thirds';
  setCropOverlay(overlay);
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

  // Re-impose the aspect ratio on the current draft the moment a new ratio or
  // orientation is selected (same "adjust state during render" pattern). The key
  // is the pair — a swap changes the orientation without touching the ratio, and
  // must re-fit the draft just the same. `refitCrop` keeps the draft's area, so
  // flipping back and forth never shrinks the frame; 'Free' (null aspect) leaves
  // the draft as-is. Picking a ratio with no crop yet starts from the full
  // frame, so a centered box of that ratio appears instead of no overlay at all.
  const constraintKey = `${cropRatio}|${cropOrientation}`
  const [prevConstraint, setPrevConstraint] = useState(constraintKey)
  if (prevConstraint !== constraintKey) {
    setPrevConstraint(constraintKey)
    if (image !== null) {
      const aspectRatio = effectiveAspect(cropRatio, cropOrientation, image.width, image.height)
      if (aspectRatio !== null) {
        const base: CropRegion = draft ?? { x: 0, y: 0, width: image.width, height: image.height }
        setDraft(refitCrop(base, aspectRatio, image.width, image.height))
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

  // Numeric aspect for the selected label and orientation, or null for a free crop.
  const aspect = effectiveAspect(cropRatio, cropOrientation, image.width, image.height)

  // The draft, defaulting to the full frame when no crop is set yet.
  const region: CropRegion = draft ?? { x: 0, y: 0, width: image.width, height: image.height }

  /** Current pointer position in image px, honouring the crop letterbox and orientation. */
  const toImage = (e: React.PointerEvent) => {
    const box = ref.current!.getBoundingClientRect()
    // The canvas shows the full frame while the crop tool is open (crop = null),
    // exactly what `pointerToImagePoint` needs to mirror the renderer.
    return pointerToImagePoint(
      { x: e.clientX - box.left, y: e.clientY - box.top },
      size.w, size.h, image.width, image.height, null, view, orientation, geometry,
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

  // Where the crop frame sits on screen once the canvas' zoom/pan, letterbox,
  // turns, flips and straighten are applied — the frame must track the image.
  const rect = cropRegionToViewRect(
    region, size.w, size.h, image.width, image.height, view, orientation, geometry,
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

          {guidesFor(overlay, rx, ry, rw, rh)}

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
