import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useEditor } from './editorContext'
import type { MaskPoint } from './masks'
import { imagePointToPointer, pointerToImagePoint } from './crop'

/**
 * What the pointer grabbed. `p1`/`p2` drag one endpoint (rotating and widening
 * the ramp); `move` translates the whole ramp, remembering where the drag began
 * (image px) and both endpoints at that moment.
 */
type Drag =
  | { kind: 'p1' }
  | { kind: 'p2' }
  | { kind: 'move'; start: MaskPoint; origin1: MaskPoint; origin2: MaskPoint }

interface GradientOverlayProps {
  /** Id of the selected linear-gradient mask to edit. */
  maskId: string
}

/**
 * Editable overlay for a linear-gradient mask: the central axis (solid, with a
 * move pin) plus the two falloff bounds (dotted, each with a handle to shorten or
 * widen the ramp). Geometry lives in image pixels and is mapped to/from screen
 * with {@link imagePointToPointer}/{@link pointerToImagePoint}, so it tracks the
 * image through zoom, pan, crop and orientation.
 *
 * The root div is `pointer-events: none` and only the handles capture: dragging
 * empty canvas still falls through to the Canvas, which creates or redraws the
 * ramp. The measuring div is rendered *unconditionally* (only its `<svg>` content
 * is gated) — gating the div itself on `size > 0` would deadlock, since the ref
 * would never mount for the ResizeObserver to measure.
 */
export function GradientOverlay({ maskId }: GradientOverlayProps) {
  const { image, masks, cropRegion, setMaskGradient, commit, view, orientation } = useEditor()
  const ref = useRef<HTMLDivElement>(null)
  const dragRef = useRef<Drag | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

  // Measure the container so the mapping matches the canvas underneath.
  useEffect(() => {
    const el = ref.current
    if (el === null) return
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  if (image === null) return null

  const mask = masks.find((m) => m.id === maskId) ?? null
  const gradient = mask?.gradient ?? null

  const toImage = (e: React.PointerEvent): MaskPoint => {
    const box = ref.current!.getBoundingClientRect()
    return pointerToImagePoint(
      { x: e.clientX - box.left, y: e.clientY - box.top },
      size.w, size.h, image.width, image.height, cropRegion, view, orientation,
    )
  }
  const toScreen = (p: MaskPoint): MaskPoint =>
    imagePointToPointer(p, size.w, size.h, image.width, image.height, cropRegion, view, orientation)

  const startDrag = (drag: Drag) => (e: React.PointerEvent) => {
    e.stopPropagation()
    // For a translate, anchor on where the pointer actually grabbed, so grabbing
    // the pin slightly off-centre doesn't jump the ramp.
    dragRef.current = drag.kind === 'move' ? { ...drag, start: toImage(e) } : drag
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current
    if (drag === null || gradient === null) return
    const p = toImage(e)
    if (drag.kind === 'p1') {
      setMaskGradient(maskId, { x1: p.x, y1: p.y, x2: gradient.x2, y2: gradient.y2 })
    } else if (drag.kind === 'p2') {
      setMaskGradient(maskId, { x1: gradient.x1, y1: gradient.y1, x2: p.x, y2: p.y })
    } else {
      const mdx = p.x - drag.start.x
      const mdy = p.y - drag.start.y
      setMaskGradient(maskId, {
        x1: drag.origin1.x + mdx, y1: drag.origin1.y + mdy,
        x2: drag.origin2.x + mdx, y2: drag.origin2.y + mdy,
      })
    }
  }

  // One undo step per drag: the store already holds the final ramp; checkpoint it.
  const endDrag = (e: React.PointerEvent) => {
    if (dragRef.current === null) return
    dragRef.current = null
    commit()
    e.currentTarget.releasePointerCapture(e.pointerId)
  }

  // The central axis is solid; the two bound lines are dotted, signalling they
  // can be dragged to shorten or widen the falloff. A dark halo under each keeps
  // the white lines legible over both bright and dark photos.
  const line = (a: MaskPoint, b: MaskPoint, style: 'solid' | 'dotted', key: string): ReactNode => {
    const dash = style === 'dotted' ? '1 7' : undefined
    return (
      <g key={key}>
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="black" strokeOpacity={0.35} strokeWidth={3}
          strokeDasharray={dash} strokeLinecap="round" />
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="white" strokeOpacity={0.95} strokeWidth={1.5}
          strokeDasharray={dash} strokeLinecap="round" />
      </g>
    )
  }

  // A grabbable handle: a visible dot plus a fat invisible hit ring around it.
  // `pointer-events: all` (not `auto`) so the transparent ring still catches the
  // pointer — under SVG's default `visiblePainted`, a transparent fill does not.
  const handle = (c: MaskPoint, drag: Drag, cursor: string, key: string): ReactNode => (
    <g
      key={key}
      style={{ cursor, pointerEvents: 'all' }}
      onPointerDown={startDrag(drag)}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
    >
      <circle cx={c.x} cy={c.y} r={14} fill="transparent" />
      <circle cx={c.x} cy={c.y} r={6} fill="white" stroke="black" strokeWidth={1.5} />
    </g>
  )

  // Build the overlay content only once we have both a ramp and a measured
  // container; the div itself always renders so the ResizeObserver can measure.
  let content: ReactNode = null
  if (gradient !== null && size.w > 0 && size.h > 0) {
    const p1: MaskPoint = { x: gradient.x1, y: gradient.y1 }
    const p2: MaskPoint = { x: gradient.x2, y: gradient.y2 }
    const mid: MaskPoint = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }

    // Perpendicular unit vector (image space) — the direction the iso-lines run.
    const dx = p2.x - p1.x
    const dy = p2.y - p1.y
    const len = Math.hypot(dx, dy) || 1
    const perp: MaskPoint = { x: -dy / len, y: dx / len }
    // Long enough to cross the frame at any orientation; the map is affine, so a
    // straight image-space line stays straight on screen.
    const L = (image.width + image.height) * 2
    const lineThrough = (a: MaskPoint): [MaskPoint, MaskPoint] => [
      toScreen({ x: a.x + perp.x * L, y: a.y + perp.y * L }),
      toScreen({ x: a.x - perp.x * L, y: a.y - perp.y * L }),
    ]

    const [f1, f2] = lineThrough(p1)   // full-effect bound
    const [c1, c2] = lineThrough(mid)  // central axis
    const [z1, z2] = lineThrough(p2)   // zero-effect bound

    content = (
      <svg width="100%" height="100%" style={{ display: 'block', pointerEvents: 'none' }}>
        {line(f1, f2, 'dotted', 'full')}
        {line(c1, c2, 'solid', 'axis')}
        {line(z1, z2, 'dotted', 'zero')}
        {handle(toScreen(mid), { kind: 'move', start: mid, origin1: p1, origin2: p2 }, 'move', 'mid')}
        {handle(toScreen(p1), { kind: 'p1' }, 'grab', 'p1')}
        {handle(toScreen(p2), { kind: 'p2' }, 'grab', 'p2')}
      </svg>
    )
  }

  return (
    <div ref={ref} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {content}
    </div>
  )
}
