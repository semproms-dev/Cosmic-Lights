import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useEditor } from './editorContext'
import { EMPTY_OBJECT_PROMPT, withoutPromptPoint } from './masks'
import type { MaskPoint, NormalizedPoint } from './masks'
import { imagePointToPointer } from './crop'

interface ObjectPromptOverlayProps {
  /** Id of the selected object mask whose prompt is being shown. */
  maskId: string
}

/** Radius (CSS px) of a prompt pin, and of its larger invisible hit target. */
const PIN_RADIUS = 6
const PIN_HIT_RADIUS = 14

/**
 * Shows the prompt driving a promptable object mask: one pin per point (green =
 * the object contains this pixel, red = it does not) and the bounding box, if
 * any. Clicking a pin removes that point.
 *
 * The prompt is stored normalised to [0,1], so each pin is scaled back to image
 * pixels and mapped to the screen with {@link imagePointToPointer} — the exact
 * inverse of the `toPromptPoint` the Canvas uses, which is what keeps the pins
 * under the objects they mark through zoom, pan, crop and orientation.
 *
 * As with {@link GradientOverlay}/{@link RadialOverlay}, the root div is
 * `pointer-events: none` and only the pins capture, so a click on empty canvas
 * still falls through to the Canvas and adds a point. The measuring div renders
 * unconditionally — gating it on `size > 0` would deadlock the ResizeObserver.
 */
export function ObjectPromptOverlay({ maskId }: ObjectPromptOverlayProps) {
  const { image, masks, cropRegion, setObjectPrompt, commit, view, orientation } = useEditor()
  const ref = useRef<HTMLDivElement>(null)
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

  const prompt = masks.find((m) => m.id === maskId)?.prompt ?? EMPTY_OBJECT_PROMPT

  // Normalised [0,1] → image pixels → screen. The multiplication here is the
  // mirror of the Canvas's division; nothing else rescales on the main thread.
  const toScreen = (n: NormalizedPoint): MaskPoint =>
    imagePointToPointer(
      { x: n.x * image.width, y: n.y * image.height },
      size.w, size.h, image.width, image.height, cropRegion, view, orientation,
    )

  // Removing a point re-prompts the model, so it is one undo step like adding
  // one. `withoutPromptPoint` refuses to leave the prompt empty (the uploaded
  // alpha would outlive it), in which case nothing changes and no work is queued.
  const removePoint = (index: number) => (e: React.PointerEvent) => {
    e.stopPropagation()
    const next = withoutPromptPoint(prompt, index)
    if (next === prompt) return
    setObjectPrompt(maskId, next)
    commit()
  }

  // Build the overlay only once the container is measured; the div itself always
  // renders so the ResizeObserver can measure it.
  let content: ReactNode = null
  if (size.w > 0 && size.h > 0) {
    // The box is drawn as a polygon through its four mapped corners, not a
    // <rect>: on a quarter turn or a mirror the mapped corners are still a
    // rectangle, but not the one x/y/width/height would have described.
    let boxPath: ReactNode = null
    if (prompt.box !== null) {
      const { x0, y0, x1, y1 } = prompt.box
      const corners: NormalizedPoint[] = [
        { x: x0, y: y0 },
        { x: x1, y: y0 },
        { x: x1, y: y1 },
        { x: x0, y: y1 },
      ]
      const points = corners.map(toScreen).map((p) => `${p.x},${p.y}`).join(' ')
      boxPath = (
        <g>
          <polygon points={points} fill="none" stroke="black" strokeOpacity={0.35} strokeWidth={3} />
          <polygon points={points} fill="none" stroke="white" strokeOpacity={0.95} strokeWidth={1.5}
            strokeDasharray="6 4" />
        </g>
      )
    }

    content = (
      <svg width="100%" height="100%" style={{ display: 'block', pointerEvents: 'none' }}>
        {boxPath}
        {prompt.points.map((point, index) => {
          const s = toScreen(point)
          return (
            <g
              key={`${point.x},${point.y},${point.label}`}
              style={{ cursor: 'pointer', pointerEvents: 'all' }}
              onPointerDown={removePoint(index)}
            >
              {/* Transparent hit ring: `pointer-events: all` (not `auto`), or
                  SVG's default `visiblePainted` would let the pointer through. */}
              <circle cx={s.x} cy={s.y} r={PIN_HIT_RADIUS} fill="transparent" />
              <circle cx={s.x} cy={s.y} r={PIN_RADIUS}
                fill={point.label === 1 ? '#3ddc84' : '#ff5d5d'}
                stroke="black" strokeOpacity={0.6} strokeWidth={1.5} />
            </g>
          )
        })}
      </svg>
    )
  }

  return (
    <div ref={ref} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {content}
    </div>
  )
}
