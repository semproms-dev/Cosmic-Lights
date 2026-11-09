import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useEditor } from '../../editor/editorContext'
import { buildDefaultCurves } from '../../editor/curves'
import { compileCurveTexture } from '../../editor/curvesMath'
import { buildInitialAdjustments } from '../../editor/editorReducer'
import { WebGLRenderer } from '../../editor/gl/renderer'
import { toRenderAdjustments } from '../../editor/renderAdjustments'
import { logger } from '../../logger'
import { useComputedColorScheme } from '@mantine/core'
import { useContextMenu } from 'mantine-contextmenu'
import { IconZoomReset } from '@tabler/icons-react'
import { ConfirmDialog } from '../window/ConfirmDialog'
import { clampZoom } from '../../utils'
import { displayScale, IDENTITY_VIEW, pointerToImagePoint } from '../../editor/crop'
import { IDENTITY_GEOMETRY } from '../../editor/geometry'
import {
  brushRadiusPx,
  EMPTY_OBJECT_PROMPT,
  promptBoxFromCorners,
  withPromptPoint,
} from '../../editor/masks'
import type { BrushMode, Mask, MaskPoint, NormalizedPoint, ObjectPrompt } from '../../editor/masks'
import { DropOverlay } from './DropOverlay'
import { isSupportedFile } from './rawFormats'

/** Per wheel notch, the fitted image grows/shrinks by this factor. */
const ZOOM_STEP = 1.1

// Stable empty mask list for the before/after preview. A fresh `[]` each render
// would be a new reference and re-fire the draw effect on every render.
const NO_MASKS: Mask[] = []

interface CanvasProps {
  /**
   * True while the Crop tool is active. The image is then rendered UNcropped so
   * the crop overlay — which maps its frame and handles against the full-image
   * coordinates — stays aligned and lets an existing crop be re-adjusted. The
   * committed crop is reapplied as soon as the tool is left.
   */
  cropping?: boolean
  /**
   * Id of the brush mask to paint into, or `null`/absent when not painting. When
   * set, a pointer drag paints the mask instead of panning the view. Coordinates
   * assume the fitted (non-zoomed) view, matching the crop overlay.
   */
  brushMaskId?: string | null
  /**
   * Id of the linear-gradient mask to define by dragging, or `null`/absent
   * otherwise. When set, a pointer drag sets that mask's ramp (anchor → release)
   * instead of panning. Like the brush, coordinates assume the fitted view.
   */
  gradientMaskId?: string | null
  /**
   * Id of the radial-gradient mask to define by dragging, or `null`/absent
   * otherwise. When set, a pointer drag sets that mask's ellipse: the press point
   * is the centre and the drag delta the semi-axes. Like the linear gradient,
   * coordinates assume the fitted view.
   */
  radialMaskId?: string | null
  /**
   * Id of the mask to show as a red editing overlay (the selected mask while the
   * Masks tool is open), or `null` to render normally.
   */
  overlayMaskId?: string | null
  /**
   * Id of the promptable object mask being pointed at, or `null`/absent
   * otherwise. When set, a click adds a foreground point (shift-click a
   * background one) and a drag encloses the object in a box, instead of panning.
   * Like the other tools, coordinates assume the fitted view.
   */
  objectMaskId?: string | null
}

/**
 * A drag with the object tool armed: where it started (normalised [0,1]) and
 * whether it has travelled far enough to count as a box rather than a click.
 */
interface ObjectDrag {
  anchor: NormalizedPoint
  /** Press position in CSS pixels — the click/drag threshold is a screen distance. */
  screen: { x: number; y: number }
  moved: boolean
}

/**
 * How far (CSS px) the pointer must travel before a press counts as a box drag
 * rather than a click. Small enough to feel deliberate, large enough to survive
 * the wobble of a click on a trackpad.
 */
const OBJECT_DRAG_THRESHOLD = 6

/**
 * How long the noise sliders must sit still before the slow denoise runs (ms).
 *
 * Long enough to sit out the gap between two deliberate nudges of a slider —
 * starting a pass the user is about to invalidate wastes a second of GPU and
 * makes the app feel like it is fighting them — and short enough that letting go
 * feels like it finished rather than like it forgot.
 */
const DENOISE_SETTLE_MS = 400

/**
 * Central editor canvas. Renders the decoded image through the WebGL pipeline,
 * applying the live adjustments from the shared editor store. Redraws on image
 * change, adjustment change or resize, batching each into a single animation
 * frame. The image keeps its aspect ratio (letterboxed) inside the container.
 */
export function Canvas({ cropping = false, brushMaskId = null, gradientMaskId = null, radialMaskId = null, overlayMaskId = null, objectMaskId = null }: CanvasProps) {
  const { t } = useTranslation(['common'])
  const { 
    image, 
    adjustments, 
    curves, 
    masks, 
    maskAlphas, 
    resetAdjustements, 
    resetCurves, 
    loadImage, 
    cropRegion,
    clearCrop,
    setCropRatio,
    resetDialogOpen, 
    openResetDialog, 
    closeResetDialog, 
    addBrushStroke,
    brush,
    setMaskGradient,
    setMaskRadial,
    setObjectPrompt,
    commit,
    view,
    setView,
    orientation,
    rotationSpin,
    resetOrientation,
    showOriginal,
    commitToken,
    geometry,
    resetGeometry,
  } = useEditor()

  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Wrapper that plays the quarter-turn spin. Rotated only during the animation.
  const spinRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<WebGLRenderer | null>(null)
  const { showContextMenu } = useContextMenu()
  // 'auto' resolved to what is actually on screen, which is what the backdrop
  // has to match. Falls back to the provider's own default scheme.
  const colorScheme = useComputedColorScheme('dark')
  // Holds the last pointer position while panning; null when not dragging.
  const panRef = useRef<{ x: number; y: number } | null>(null)
  // Set to true by the pan/zoom handlers to signal that the next draw only
  // changes the view transform (pan/zoom) and can skip the full GPU pipeline
  // (denoise, develop, mask stacking, blurs) — only the composite pass needs
  // to re-run with the new view matrix.
  const viewOnlyRef = useRef(false)
  // Redraws the scene on demand (set by the render effect). Live brush painting
  // calls this after each stamp, since it changes no React state to react to.
  const drawRef = useRef<() => void>(() => {})
  // Active brush stroke while painting: the accumulated points (image px), the
  // last one, and the brush it was started with — frozen at pointer-down so
  // resizing mid-drag can't make the committed stroke differ from the strokes
  // that were live-painted. Null when not painting.
  const strokeRef = useRef<
    { points: MaskPoint[]; last: MaskPoint; radius: number; hardness: number; mode: BrushMode } | null
  >(null)
  // Anchor (full-effect point, image px) of the gradient being dragged, or null
  // when not dragging one.
  const gradientAnchorRef = useRef<MaskPoint | null>(null)
  // Anchor (ellipse centre, image px) of the radial mask being dragged, or null
  // when not dragging one.
  const radialAnchorRef = useRef<MaskPoint | null>(null)
  // The object-prompt gesture in progress (click or box drag), or null.
  const objectDragRef = useRef<ObjectDrag | null>(null)
  // Brush cursor ring position/size in CSS px, or null when the pointer is off
  // the canvas or not in brush mode.
  const [brushCursor, setBrushCursor] = useState<{ x: number; y: number; d: number } | null>(null)
  // Rubber band for the object box being dragged, in CSS px, or null. Kept local
  // (and in screen space) on purpose: the store only hears about the box once, on
  // release, so a drag costs no bitmap clones and needs no debouncing. Quarter
  // turns map an axis-aligned rectangle to an axis-aligned one, so what the band
  // encloses on screen is exactly what the box encloses in the image.
  const [objectBand, setObjectBand] = useState<{ x: number; y: number; w: number; h: number } | null>(null)

  // A file dropped or picked via the DropOverlay; ignore anything the app cannot
  // open (a RAW it does not know, or any non-photo).
  const handleDropFile = (file: File) => {
    if (!isSupportedFile(file)) return
    void loadImage(file)
  }

  // Create the renderer once, bound to the canvas's WebGL2 context.
  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) {
      return
    }
    const gl = canvas.getContext('webgl2')
    if (gl === null) {
      logger.error('Canvas: WebGL2 is not available in this browser')
      return
    }
    rendererRef.current = new WebGLRenderer(gl)
    return () => {
      rendererRef.current?.dispose()
      rendererRef.current = null
    }
  }, [])

  // Upload the decoded frame to the GPU only when the image itself changes.
  useEffect(() => {
    if (image === null) {
      return
    }
    rendererRef.current?.uploadImage(image.bitmap, image.noise)
  }, [image])

  // Recompile and upload the tone-curve LUTs only when the curves change. Runs
  // before the redraw effect below (both depend on `curves`) so the texture is
  // current by the time the frame draws. While showing the original, the LUT is
  // the identity line so the shader applies no tonal curve.
  useEffect(() => {
    rendererRef.current?.uploadCurves(compileCurveTexture(showOriginal ? buildDefaultCurves() : curves))
  }, [curves, showOriginal])

  // Redraw on image/adjustment change or resize, coalesced into one frame.
  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) {
      return
    }
    let frame = 0

    const draw = () => {
      frame = 0
      const renderer = rendererRef.current
      if (renderer === null) {
        return
      }
      // Size the buffer from the *layout* box (`offset*`), not
      // `getBoundingClientRect()`: during the rotation spin the canvas sits inside
      // a transformed wrapper, and the client rect would report the rotated box —
      // swapping width/height and baking a wrong aspect into the buffer.
      const dpr = window.devicePixelRatio || 1
      const width = Math.round(canvas.offsetWidth * dpr)
      const height = Math.round(canvas.offsetHeight * dpr)
      canvas.width = width
      canvas.height = height
      // Consume and reset the view-only flag. When the pan/zoom handler set it,
      // passes 0-3 (denoise, develop, mask stacking, blurs) are skipped and only
      // the composite re-runs with the updated view transform — cutting the GPU
      // work by ~80 % during interactive navigation.
      const viewOnly = viewOnlyRef.current
      viewOnlyRef.current = false
      if(image != null) {
        // While cropping, show the full frame so the overlay stays aligned. Same
        // in the before/after preview, where the original has no crop either.
        renderer.setCrop(cropping || showOriginal ? null : cropRegion, image.width, image.height)
        renderer.setOrientation(orientation);
        // The before/after preview shows the photo as it opened, so it must not
        // carry the geometry either — same rule as the adjustments and masks
        // below. The crop tool DOES keep it: the overlay is placed through the
        // very same transform, so the two stay glued together.
        renderer.setGeometry(showOriginal ? IDENTITY_GEOMETRY : geometry);
      }
      renderer.setView(view.scale, view.offsetX, view.offsetY)
      renderer.render(
        toRenderAdjustments(showOriginal ? buildInitialAdjustments() : adjustments),
        showOriginal ? NO_MASKS : masks,
        maskAlphas.current,
        showOriginal ? null : overlayMaskId,
        width,
        height,
        viewOnly,
      )
      // The quality denoise hands back a slice of itself per frame rather than
      // locking the tab for a second, so keep the frames coming until it is
      // done. Each one shows the interactive filter's result; the last one swaps
      // in the finished pass. `schedule` is idempotent, so this cannot stack up.
      if (renderer.isDenoisePending()) {
        schedule()
      }
    }
    // Expose the latest draw so live brush painting can force a redraw (painting
    // changes no React state, so the effect alone wouldn't re-run).
    drawRef.current = draw

    const schedule = () => {
      if (frame === 0) {
        frame = requestAnimationFrame(draw)
      }
    }

    schedule()
    const observer = new ResizeObserver(schedule)
    observer.observe(canvas)
    return () => {
      observer.disconnect()
      if (frame !== 0) {
        cancelAnimationFrame(frame)
      }
    }
    // `maskAlphas` is a stable ref-backed Map, so it never fires this effect on
    // its own: `masks` (via each mask's `version`) is what signals a new alpha.
  }, [image, adjustments, curves, masks, maskAlphas, cropRegion, view, cropping, overlayMaskId, orientation, showOriginal, geometry])

  // Backdrop for the corners a free-angle rotation uncovers: whatever is painted
  // behind the canvas (the Mantine body colour) so the letterbox reads as a mat,
  // not a hole. Read from the DOM rather than hardcoded, so it tracks whatever
  // the theme says the page is.
  //
  // Keyed on the colour scheme, and it has to be: read it once at startup and
  // the mat keeps the colour of the theme the canvas mounted under, so switching
  // to light leaves dark corners (and back). Placed after the redraw effect so
  // `drawRef` is already set on mount — a colour is not React state the renderer
  // watches, so the frame has to be asked for.
  useEffect(() => {
    // `rgb(26, 27, 30)` → 0..255 per channel, and setBackdrop takes 0..1: pass
    // them raw and every channel saturates, painting the corners white.
    const channels = getComputedStyle(document.body).backgroundColor.match(/\d+/g)?.map(Number)
    if (channels === undefined || channels.length < 3) {
      return
    }
    rendererRef.current?.setBackdrop(channels[0] / 255, channels[1] / 255, channels[2] / 255)
    drawRef.current()
  }, [colorScheme])

  // Promote the denoise to its slow, much better filter once the noise controls
  // stop moving.
  //
  // Keyed on the noise sliders alone, and that is the whole design. The denoise
  // depends on nothing else, and the renderer caches its result — so panning,
  // zooming or moving any other slider keeps whatever quality pass was last
  // computed instead of throwing it away and paying for it again. Only touching
  // noise drops back to the interactive filter, and only until the user lets go.
  const noiseSettings = `${adjustments.colorNoise}|${adjustments.luminanceNoise}|${adjustments.luminanceDetail}`
  const lastCommit = useRef(commitToken)
  useEffect(() => {
    const renderer = rendererRef.current
    if (renderer === null) {
      return
    }
    // A commit means the gesture is over — the slider was released, or Auto was
    // pressed, which has no gesture at all. There is no pause left to wait out,
    // so skip straight to the good filter. This is most of the perceived wait
    // after Auto: the pass itself takes about a second, and sitting out a
    // debounce that exists for dragging added nearly half of that again.
    const settled = commitToken !== lastCommit.current
    lastCommit.current = commitToken
    if (settled) {
      renderer.setDenoiseQuality('quality')
      return
    }

    // Mid-gesture: show the interactive filter and wait for the dragging to
    // stop. The timer is the fallback for every path that changes these sliders
    // without committing — a preset, a reset, an arrow key on a control that
    // does not report gesture end.
    renderer.setDenoiseQuality('preview')
    const settle = window.setTimeout(() => {
      rendererRef.current?.setDenoiseQuality('quality')
      drawRef.current()
    }, DENOISE_SETTLE_MS)
    return () => {
      window.clearTimeout(settle)
    }
  }, [noiseSettings, commitToken, image])

  // Zoom toward a point (in clip space, −1..1) by a scale factor, keeping the
  // content under that point fixed. Clip space matches the renderer's view
  // transform, so the cursor stays locked to the same pixel as the image scales.
  const zoomAtPoint = useCallback((cursorX: number, cursorY: number, factor: number) => {
    viewOnlyRef.current = true
    setView(v => {
      const newScale = clampZoom(v.scale * factor)
      // World (content) coordinate currently under the cursor.
      const worldX = (cursorX - v.offsetX) / v.scale
      const worldY = (cursorY - v.offsetY) / v.scale
      return {
        scale: newScale,
        offsetX: cursorX - worldX * newScale,
        offsetY: cursorY - worldY * newScale,
      }
    })
    // `setView` is a `useState` setter reached through the context, so its
    // identity is stable; it is declared only to satisfy the exhaustive-deps rule.
  }, [setView])

  // Wheel-to-zoom. Registered natively (not via onWheel) so the listener can be
  // non-passive and preventDefault the page scroll while zooming.
  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) {
      return
    }
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = canvas.getBoundingClientRect()
      // Cursor → clip space (origin at centre, Y up).
      const cursorX = ((e.clientX - rect.left) / rect.width) * 2 - 1
      const cursorY = 1 - ((e.clientY - rect.top) / rect.height) * 2
      const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP
      zoomAtPoint(cursorX, cursorY, factor)
    }
    canvas.addEventListener('wheel', handleWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', handleWheel)
  }, [zoomAtPoint])

  // Quarter-turn spin. The WebGL orientation has already flipped, so the canvas
  // is showing the *final* frame upright. We fake the motion by starting the
  // wrapper a quarter turn back — where the old frame sat — and gliding it to 0.
  // A CW turn moved the image forward, so it starts a quarter CCW, and vice
  // versa. The resting state is always a plain `rotate(0)`, i.e. pixel-exact.
  //
  // The wrapper is container-shaped (not image-shaped), so a bare 90° turn would
  // stand its long side across the short side and spill out — which the clip then
  // eats unevenly, reading as a squash. A *uniform* down-scale to the fit factor
  // (short/long side) keeps the turned frame inside the box; being uniform, it
  // preserves the aspect, so the image spins and zooms but never distorts.
  useEffect(() => {
    const el = spinRef.current
    if (el === null || rotationSpin === null) {
      return
    }
    // `offset*` are the layout box, unaffected by any transform still on `el`.
    const fit = Math.min(el.offsetWidth, el.offsetHeight) / Math.max(el.offsetWidth, el.offsetHeight)
    const from = rotationSpin.direction === 'cw' ? -90 : 90
    el.style.transition = 'none'
    el.style.transform = `rotate(${from}deg) scale(${fit})`
    // Flush the start transform so the browser animates FROM it, not straight to 0.
    el.getBoundingClientRect()
    const frame = requestAnimationFrame(() => {
      el.style.transition = 'transform 220ms ease'
      el.style.transform = 'rotate(0deg) scale(1)'
    })
    return () => cancelAnimationFrame(frame)
  }, [rotationSpin])

  /**
   * What the canvas is currently showing: the full frame while the crop tool is
   * open (the overlay needs it), the committed crop otherwise. Mirrors the
   * `setCrop` call in the draw effect — the two must agree or the pointer maps
   * to a different pixel than the one under it.
   */
  const shownCrop = cropping ? null : cropRegion

  // Pointer position → image pixels, undoing the zoom/pan, the crop letterbox
  // and the orientation.
  const toImagePoint = (e: React.PointerEvent<HTMLCanvasElement>): MaskPoint | null => {
    if (image === null) return null
    const rect = e.currentTarget.getBoundingClientRect()
    return pointerToImagePoint(
      { x: e.clientX - rect.left, y: e.clientY - rect.top },
      rect.width, rect.height,
      image.width, image.height,
      shownCrop, view, orientation, geometry,
    )
  }

  // Pointer position → normalised [0,1] image coordinates, the units the object
  // prompt speaks (see `ObjectPrompt`). This is the *only* place the main thread
  // divides by the image size; the worker rescales from [0,1] on its side. A press
  // on the letterbox lands outside [0,1] and is left that way here — see below.
  const toPromptPointRaw = (e: React.PointerEvent<HTMLCanvasElement>): NormalizedPoint | null => {
    const point = toImagePoint(e);
    if (point === null || image === null) return null;
    return {
      x: point.x / image.width,
      y: point.y / image.height
    }
  }

  // The same, but rejecting anything outside the image: a click on the black bar
  // is not a click on the object's edge, so it adds no point. A box instead uses
  // the raw value and clamps — a drag that overshoots the frame still means
  // "enclose everything up to the edge".
  const toPromptPoint = (e: React.PointerEvent<HTMLCanvasElement>): NormalizedPoint | null => {
    const result = toPromptPointRaw(e)
    if (result === null) return null

    if((result.x < 0 || result.x > 1) || (result.y < 0 || result.y > 1))
      return null; // click outside the image

    return result;
  }

  /** The prompt the active object mask carries right now, never null. */
  const currentPrompt = (): ObjectPrompt =>
    masks.find((m) => m.id === objectMaskId)?.prompt ?? EMPTY_OBJECT_PROMPT

  /** Brush radius in image pixels, from the live tool size. */
  const brushRadius = (): number =>
    image === null ? 0 : brushRadiusPx(brush.size, image.width, image.height)

  // Updates the brush cursor ring: converts the image-space radius to CSS px via
  // the same display scale the painting uses, so the ring matches what it paints.
  const updateBrushCursor = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    if (image === null) return
    const rect = e.currentTarget.getBoundingClientRect()
    const scale = displayScale(image.width, image.height, rect.width, rect.height, shownCrop, view)
    setBrushCursor({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      d: brushRadius() * 2 * scale,
    })
  }

  // Drag paints the active brush mask, defines the active gradient, or pans.
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (brushMaskId !== null && image !== null) {
      const p = toImagePoint(e)
      if (p === null) return
      const started = { radius: brushRadius(), hardness: brush.hardness, mode: brush.mode }
      strokeRef.current = { points: [p], last: p, ...started }
      updateBrushCursor(e)
      // Stamp a dot on press so a plain click still marks the mask.
      rendererRef.current?.paintSegment(brushMaskId, p, p, started.radius, started.hardness, started.mode)
      drawRef.current()
      e.currentTarget.setPointerCapture(e.pointerId)
      return
    }
    if (gradientMaskId !== null && image !== null) {
      const p = toImagePoint(e)
      if (p === null) return
      // Anchor = full-effect point (p1); the release point becomes p2.
      gradientAnchorRef.current = p
      e.currentTarget.setPointerCapture(e.pointerId)
      return
    }
    if (radialMaskId !== null && image !== null) {
      const p = toImagePoint(e)
      if (p === null) return
      // Anchor = ellipse centre; the drag delta becomes the semi-axes.
      radialAnchorRef.current = p
      e.currentTarget.setPointerCapture(e.pointerId)
      return
    }
    if (objectMaskId !== null && image !== null) {
      const n = toPromptPoint(e)
      // A press on the letterbox arms nothing — and deliberately does not pan
      // either, so the gesture stays predictable while the tool is open.
      if (n === null) return
      const rect = e.currentTarget.getBoundingClientRect()
      objectDragRef.current = {
        anchor: n,
        screen: { x: e.clientX - rect.left, y: e.clientY - rect.top },
        moved: false,
      }
      e.currentTarget.setPointerCapture(e.pointerId)
      return
    }
    panRef.current = { x: e.clientX, y: e.clientY }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // Keep the brush cursor ring under the pointer whenever painting is armed.
    if (brushMaskId !== null) updateBrushCursor(e)
    const stroke = strokeRef.current
    if (stroke !== null && brushMaskId !== null) {
      const p = toImagePoint(e)
      if (p === null) return
      rendererRef.current?.paintSegment(brushMaskId, stroke.last, p, stroke.radius, stroke.hardness, stroke.mode)
      stroke.points.push(p)
      stroke.last = p
      drawRef.current()
      return
    }
    const anchor = gradientAnchorRef.current
    if (anchor !== null && gradientMaskId !== null) {
      const p = toImagePoint(e)
      if (p === null) return
      // Live update through the store; no commit yet (still dragging). `masks` is
      // a draw-effect dependency, so this repaints for free.
      setMaskGradient(gradientMaskId, { x1: anchor.x, y1: anchor.y, x2: p.x, y2: p.y })
      return
    }
    const radialAnchor = radialAnchorRef.current
    if (radialAnchor !== null && radialMaskId !== null) {
      const p = toImagePoint(e)
      if (p === null) return
      // Semi-axes grow symmetrically about the anchored centre; start axis-aligned
      // with a mid feather (the overlay handles rotation/feather afterwards).
      setMaskRadial(radialMaskId, {
        cx: radialAnchor.x, cy: radialAnchor.y,
        rx: Math.max(1, Math.abs(p.x - radialAnchor.x)),
        ry: Math.max(1, Math.abs(p.y - radialAnchor.y)),
        rotation: 0,
        feather: 0.5,
      })
      return
    }
    const objectDrag = objectDragRef.current
    if (objectDrag !== null && objectMaskId !== null) {
      const rect = e.currentTarget.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      // Below the threshold the press is still a click-in-progress: no band yet,
      // or every click would flash a one-pixel rectangle.
      if (!objectDrag.moved && Math.hypot(x - objectDrag.screen.x, y - objectDrag.screen.y) < OBJECT_DRAG_THRESHOLD) {
        return
      }
      objectDrag.moved = true
      setObjectBand({
        x: Math.min(x, objectDrag.screen.x),
        y: Math.min(y, objectDrag.screen.y),
        w: Math.abs(x - objectDrag.screen.x),
        h: Math.abs(y - objectDrag.screen.y),
      })
      return
    }
    const start = panRef.current
    if (start === null) {
      return
    }
    const rect = e.currentTarget.getBoundingClientRect()
    const dx = ((e.clientX - start.x) / rect.width) * 2
    const dy = -((e.clientY - start.y) / rect.height) * 2
    panRef.current = { x: e.clientX, y: e.clientY }
    viewOnlyRef.current = true
    setView(v => ({ ...v, offsetX: v.offsetX + dx, offsetY: v.offsetY + dy }))
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const stroke = strokeRef.current
    if (stroke !== null && brushMaskId !== null) {
      // Commit the whole stroke as one undo step; the renderer rebuilds the mask
      // from it on the next frame (reproducing exactly what was live-painted).
      addBrushStroke(brushMaskId, {
        points: stroke.points,
        radius: stroke.radius,
        hardness: stroke.hardness,
        mode: stroke.mode,
      })
      commit()
      strokeRef.current = null
      e.currentTarget.releasePointerCapture(e.pointerId)
      return
    }
    if (gradientAnchorRef.current !== null) {
      // One undo step per drag. The store already holds the final ramp from the
      // last pointermove; just checkpoint it.
      commit()
      gradientAnchorRef.current = null
      e.currentTarget.releasePointerCapture(e.pointerId)
      return
    }
    if (radialAnchorRef.current !== null) {
      // One undo step per drag; the store already holds the final ellipse.
      commit()
      radialAnchorRef.current = null
      e.currentTarget.releasePointerCapture(e.pointerId)
      return
    }
    const objectDrag = objectDragRef.current
    if (objectDrag !== null && objectMaskId !== null) {
      objectDragRef.current = null
      setObjectBand(null)
      e.currentTarget.releasePointerCapture(e.pointerId)
      // One store call per gesture, then one undo step: the prompt is always sent
      // whole, and `setObjectPrompt` re-segments and discards stale answers.
      if (objectDrag.moved) {
        const end = toPromptPointRaw(e)
        if (end === null) return
        const box = promptBoxFromCorners(objectDrag.anchor, end)
        // A degenerate box selects nothing; drop it rather than confuse the model.
        if (box.x0 === box.x1 || box.y0 === box.y1) return
        setObjectPrompt(objectMaskId, { ...currentPrompt(), box })
      } else {
        const n = toPromptPoint(e)
        if (n === null) return
        // Shift-click carves the selection back: this pixel is *not* the object.
        setObjectPrompt(objectMaskId, withPromptPoint(currentPrompt(), n, e.shiftKey ? 0 : 1))
      }
      commit()
      return
    }
    panRef.current = null
    e.currentTarget.releasePointerCapture(e.pointerId)
  }

  // Back to how the photo opened: sliders, curves, crop, orientation, geometry
  // and the fitted view. The ratio goes with the crop — leave it behind and the next
  // crop the user drags is still locked to a 16:9 they thought they had undone.
  const resetSettings = () => {
    resetAdjustements();
    resetCurves();
    clearCrop();
    setCropRatio('Original');
    closeResetDialog();
    setView(IDENTITY_VIEW);
    resetOrientation();
    resetGeometry();
    // Last, and it has to be last: COMMIT snapshots whatever the dispatches
    // above left behind. Without it the history's checkpoint stays on the
    // pre-reset photo, so the reset is not undoable and the next commit files
    // the stale checkpoint as if it were the state the user came from.
    commit();
  }

  return <>
  {/* Outer box clips the quarter-turn overshoot so the spin never spills over
      the surrounding panels; the inner wrapper is what actually rotates. */}
  <div style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
      <div ref={spinRef} style={{ width: '100%', height: '100%' }}>
     <canvas onContextMenu={showContextMenu([
      {
        key: 'reset',
        icon: <IconZoomReset size="1.5rem" />,
        title: 'Reset changes',
        onClick: () => openResetDialog()
      },
    ])}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={() => setBrushCursor(null)}
      onDoubleClick={() => setView(IDENTITY_VIEW)}
      ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block', cursor: brushMaskId !== null ? 'none' : gradientMaskId !== null || radialMaskId !== null || objectMaskId !== null ? 'crosshair' : 'default' }} />

    </div>
  </div>
   
    <DropOverlay imageLoaded={image !== null} onDropFile={handleDropFile} />


    {brushMaskId !== null && brushCursor !== null && (
      <div
        aria-hidden
        style={{
          position: 'absolute',
          left: brushCursor.x,
          top: brushCursor.y,
          width: brushCursor.d,
          height: brushCursor.d,
          transform: 'translate(-50%, -50%)',
          borderRadius: '50%',
          // Erasing is the one gesture that destroys work, so the ring says which
          // mode is armed before the drag rather than after it: dashed and red.
          border:
            brush.mode === 'erase'
              ? '1px dashed rgba(255,120,120,0.95)'
              : '1px solid rgba(255,255,255,0.9)',
          boxShadow: '0 0 0 1px rgba(0,0,0,0.5)',
          pointerEvents: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span style={{ color: 'black', fontSize: 25, lineHeight: 1 }}>
          {brush.mode === 'add' ? '+' : '-'}
        </span>
      </div>
    )}
    {objectBand !== null && (
      <div
        aria-hidden
        style={{
          position: 'absolute',
          left: objectBand.x,
          top: objectBand.y,
          width: objectBand.w,
          height: objectBand.h,
          border: '1px dashed rgba(255,255,255,0.95)',
          boxShadow: '0 0 0 1px rgba(0,0,0,0.5)',
          pointerEvents: 'none',
        }}
      />
    )}
    <ConfirmDialog
      opened={resetDialogOpen}
      onClose={closeResetDialog}
      onConfirm={() => resetSettings()}
      title={t('confirm.resetTitle')}
      message={t('confirm.resetMessage')}
      confirmLabel={t('confirm.reset')}
      cancelLabel={t('confirm.cancel')}
      confirmColor="red"
    />
  </>
}

