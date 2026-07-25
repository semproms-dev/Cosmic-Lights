import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useEditor } from './editorContext'
import type { MaskPoint } from './masks'
import { imagePointToPointer, pointerToImagePoint } from './crop'

/**
 * What the pointer grabbed on the radial overlay. `move` translates the whole
 * ellipse (remembering where the drag began and the centre at that moment);
 * `resize` drags one axis endpoint to change `rx` or `ry`; `rotate` spins the
 * ellipse; `feather` drags the inner ring to soften or harden the falloff.
 */
type Drag =
  | { kind: 'move'; start: MaskPoint; origin: MaskPoint }
  | { kind: 'resize'; axis: 'x' | 'y' }
  | { kind: 'rotate' }
  | { kind: 'feather' }

interface RadialOverlayProps {
  /** Id of the selected radial-gradient mask to edit. */
  maskId: string
}

/**
 * Rotates a vector by `deg` degrees in image space (y-down, so positive is
 * clockwise on screen). This is the inverse of the shader's normalisation
 * matrix: it maps a point given in the ellipse's own axes back into image
 * pixels, so handles laid out on the local axes land where the shader draws them.
 */
function rotate(v: MaskPoint, deg: number): MaskPoint {
  const a = (deg * Math.PI) / 180
  const c = Math.cos(a)
  const s = Math.sin(a)
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c }
}

/** Inverse of {@link rotate}: image-space vector → the ellipse's own axes. */
function unrotate(v: MaskPoint, deg: number): MaskPoint {
  return rotate(v, -deg)
}

/**
 * Editable overlay for a radial-gradient mask: the ellipse outline plus a centre
 * pin (move), four axis handles (resize `rx`/`ry`), a rotation handle on a short
 * stem, and an inner dotted ring whose handle sets the feather (solid-core
 * fraction). Geometry lives in image pixels and is mapped to/from screen with
 * {@link imagePointToPointer}/{@link pointerToImagePoint}, so it tracks the image
 * through zoom, pan, crop and orientation — matching {@link GradientOverlay}.
 *
 * As with the gradient overlay, the root div is `pointer-events: none` and only
 * the handles capture, so dragging empty canvas still falls through to the Canvas
 * (which creates the ellipse). The measuring div renders unconditionally so the
 * ResizeObserver can mount; only its `<svg>` content is gated on a shape + size.
 */
export function RadialOverlay({ maskId }: RadialOverlayProps) {
  const { image, masks, cropRegion, setMaskRadial, commit, view, orientation } = useEditor()
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
  const radial = mask?.radial ?? null

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
    // For a translate, anchor on where the pointer actually grabbed so grabbing
    // the pin slightly off-centre doesn't jump the ellipse.
    dragRef.current = drag.kind === 'move' ? { ...drag, start: toImage(e) } : drag
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current
    if (drag === null || radial === null) return
    const p = toImage(e)
    if (drag.kind === 'move') {
      setMaskRadial(maskId, {
        ...radial,
        cx: drag.origin.x + (p.x - drag.start.x),
        cy: drag.origin.y + (p.y - drag.start.y),
      })
    } else if (drag.kind === 'resize') {
      // Distance from centre along the ellipse's own axis → the new semi-axis.
      const local = unrotate({ x: p.x - radial.cx, y: p.y - radial.cy }, radial.rotation)
      if (drag.axis === 'x') setMaskRadial(maskId, { ...radial, rx: Math.max(1, Math.abs(local.x)) })
      else setMaskRadial(maskId, { ...radial, ry: Math.max(1, Math.abs(local.y)) })
    } else if (drag.kind === 'rotate') {
      // The stem points along local -y, i.e. image angle (rotation - 90°); aim it
      // at the pointer so the handle follows the cursor.
      const angle = (Math.atan2(p.y - radial.cy, p.x - radial.cx) * 180) / Math.PI
      setMaskRadial(maskId, { ...radial, rotation: angle + 90 })
    } else {
      // Feather = 1 - (inner-ring fraction). Dragging the ring toward the centre
      // softens (feather → 1); toward the edge hardens (feather → 0).
      const local = unrotate({ x: p.x - radial.cx, y: p.y - radial.cy }, radial.rotation)
      const frac = radial.rx > 0 ? Math.abs(local.x) / radial.rx : 1
      setMaskRadial(maskId, { ...radial, feather: 1 - Math.min(1, Math.max(0, frac)) })
    }
  }

  // One undo step per drag: the store already holds the final shape; checkpoint it.
  const endDrag = (e: React.PointerEvent) => {
    if (dragRef.current === null) return
    dragRef.current = null
    commit()
    e.currentTarget.releasePointerCapture(e.pointerId)
  }

  // The ellipse outline is solid; the inner feather ring is dotted, signalling it
  // can be dragged. A dark halo under each keeps the white strokes legible over
  // both bright and dark photos — same technique as the gradient overlay.
  const ellipsePath = (scale: number): string => {
    if (radial === null) return ''
    const SEGMENTS = 72
    let d = ''
    for (let i = 0; i <= SEGMENTS; i++) {
      const t = (i / SEGMENTS) * Math.PI * 2
      const local = { x: Math.cos(t) * radial.rx * scale, y: Math.sin(t) * radial.ry * scale }
      const img = rotate(local, radial.rotation)
      const s = toScreen({ x: radial.cx + img.x, y: radial.cy + img.y })
      d += `${i === 0 ? 'M' : 'L'}${s.x} ${s.y} `
    }
    return `${d}Z`
  }

  const outline = (d: string, style: 'solid' | 'dotted', key: string): ReactNode => {
    const dash = style === 'dotted' ? '1 7' : undefined
    return (
      <g key={key}>
        <path d={d} fill="none" stroke="black" strokeOpacity={0.35} strokeWidth={3}
          strokeDasharray={dash} strokeLinecap="round" />
        <path d={d} fill="none" stroke="white" strokeOpacity={0.95} strokeWidth={1.5}
          strokeDasharray={dash} strokeLinecap="round" />
      </g>
    )
  }

  const seg = (a: MaskPoint, b: MaskPoint, key: string): ReactNode => (
    <g key={key}>
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="black" strokeOpacity={0.35} strokeWidth={3} strokeLinecap="round" />
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="white" strokeOpacity={0.95} strokeWidth={1.5} strokeLinecap="round" />
    </g>
  )

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

  // Build the overlay only once we have both a shape and a measured container;
  // the div itself always renders so the ResizeObserver can measure.
  let content: ReactNode = null
  if (radial !== null && size.w > 0 && size.h > 0) {
    const center: MaskPoint = { x: radial.cx, y: radial.cy }
    // Axis endpoints (image space), on the ellipse in its own rotated frame.
    const axisXImg = rotate({ x: radial.rx, y: 0 }, radial.rotation)
    const axisYImg = rotate({ x: 0, y: radial.ry }, radial.rotation)
    const xPos: MaskPoint = { x: center.x + axisXImg.x, y: center.y + axisXImg.y }
    const xNeg: MaskPoint = { x: center.x - axisXImg.x, y: center.y - axisXImg.y }
    const yPos: MaskPoint = { x: center.x + axisYImg.x, y: center.y + axisYImg.y }
    const yNeg: MaskPoint = { x: center.x - axisYImg.x, y: center.y - axisYImg.y }
    // Rotation handle on a short stem past the top (local -y). The stem length is
    // a fraction of the image so it stays visible relative to the photo.
    const stem = Math.max(image.width, image.height) * 0.06
    const rotImg = rotate({ x: 0, y: -(radial.ry + stem) }, radial.rotation)
    const rotPt: MaskPoint = { x: center.x + rotImg.x, y: center.y + rotImg.y }
    // Feather handle on the inner (solid-core) ring's +x axis.
    const featherImg = rotate({ x: radial.rx * (1 - radial.feather), y: 0 }, radial.rotation)
    const featherPt: MaskPoint = { x: center.x + featherImg.x, y: center.y + featherImg.y }

    content = (
      <svg width="100%" height="100%" style={{ display: 'block', pointerEvents: 'none' }}>
        {outline(ellipsePath(1), 'solid', 'ellipse')}
        {radial.feather > 0 && outline(ellipsePath(1 - radial.feather), 'dotted', 'core')}
        {seg(toScreen(center), toScreen(rotPt), 'stem')}
        {handle(toScreen(center), { kind: 'move', start: center, origin: center }, 'move', 'center')}
        {handle(toScreen(xPos), { kind: 'resize', axis: 'x' }, 'grab', 'xPos')}
        {handle(toScreen(xNeg), { kind: 'resize', axis: 'x' }, 'grab', 'xNeg')}
        {handle(toScreen(yPos), { kind: 'resize', axis: 'y' }, 'grab', 'yPos')}
        {handle(toScreen(yNeg), { kind: 'resize', axis: 'y' }, 'grab', 'yNeg')}
        {handle(toScreen(rotPt), { kind: 'rotate' }, 'grab', 'rotate')}
        {handle(toScreen(featherPt), { kind: 'feather' }, 'grab', 'feather')}
      </svg>
    )
  }

  return (
    <div ref={ref} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {content}
    </div>
  )
}
