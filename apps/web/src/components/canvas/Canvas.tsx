import { useCallback, useEffect, useRef, useState } from 'react'
import { useEditor } from '../../editor/editorContext'
import { compileCurveTexture } from '../../editor/curvesMath'
import { WebGLRenderer } from '../../editor/gl/renderer'
import { logger } from '../../logger'
import { useContextMenu } from 'mantine-contextmenu'
import { IconZoomReset } from '@tabler/icons-react'
import { ConfirmDialog } from '../window/ConfirmDialog'
import { clampZoom } from '../../utils'
import { displayScale, IDENTITY_VIEW, pointerToImagePoint } from '../../editor/crop'
import type { MaskPoint } from '../../editor/masks'
import { DropOverlay } from './DropOverlay'
import { isRawFile } from './rawFormats'

/** Default brush geometry (radius as a fraction of the image's short side). */
const BRUSH_RADIUS_FRACTION = 0.04
const BRUSH_HARDNESS = 0.5

/** Per wheel notch, the fitted image grows/shrinks by this factor. */
const ZOOM_STEP = 1.1

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
   * Id of the mask to show as a red editing overlay (the selected mask while the
   * Masks tool is open), or `null` to render normally.
   */
  overlayMaskId?: string | null
}

/**
 * Central editor canvas. Renders the decoded image through the WebGL pipeline,
 * applying the live adjustments from the shared editor store. Redraws on image
 * change, adjustment change or resize, batching each into a single animation
 * frame. The image keeps its aspect ratio (letterboxed) inside the container.
 */
export function Canvas({ cropping = false, brushMaskId = null, overlayMaskId = null }: CanvasProps) {
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
    resetDialogOpen, 
    openResetDialog, 
    closeResetDialog, 
    addBrushStroke, 
    commit, 
    view,
    setView,
    orientation,
    rotationSpin,
    resetOrientation
  } = useEditor()

  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Wrapper that plays the quarter-turn spin. Rotated only during the animation.
  const spinRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<WebGLRenderer | null>(null)
  const { showContextMenu } = useContextMenu()
  // Holds the last pointer position while panning; null when not dragging.
  const panRef = useRef<{ x: number; y: number } | null>(null)
  // Redraws the scene on demand (set by the render effect). Live brush painting
  // calls this after each stamp, since it changes no React state to react to.
  const drawRef = useRef<() => void>(() => {})
  // Active brush stroke while painting: the accumulated points (image px) and
  // the last one, or null when not painting.
  const strokeRef = useRef<{ points: MaskPoint[]; last: MaskPoint } | null>(null)
  // Brush cursor ring position/size in CSS px, or null when the pointer is off
  // the canvas or not in brush mode.
  const [brushCursor, setBrushCursor] = useState<{ x: number; y: number; d: number } | null>(null)

  // A file dropped or picked via the DropOverlay; ignore anything that is not a
  // recognised RAW photo.
  const handleDropFile = (file: File) => {
    if (!isRawFile(file)) return
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
    rendererRef.current?.uploadImage(image.bitmap)
  }, [image])

  // Recompile and upload the tone-curve LUTs only when the curves change. Runs
  // before the redraw effect below (both depend on `curves`) so the texture is
  // current by the time the frame draws.
  useEffect(() => {
    rendererRef.current?.uploadCurves(compileCurveTexture(curves))
  }, [curves])

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
      if(image != null) {
        // While cropping, show the full frame so the overlay stays aligned.
        renderer.setCrop(cropping ? null : cropRegion, image.width, image.height)
        renderer.setOrientation(orientation);
      }
      renderer.setView(view.scale, view.offsetX, view.offsetY)
      renderer.render({
        exposure: adjustments.exposure ?? 0,
        contrast: adjustments.contrast ?? 0,
        highlights: adjustments.highlights ?? 0,
        shadows: adjustments.shadows ?? 0,
        whites: adjustments.whites ?? 0,
        blacks: adjustments.blacks ?? 0,
        temperature: adjustments.temperature ?? 0,
        tint: adjustments.tint ?? 0,
        vibrance: adjustments.vibrance ?? 0,
        saturation: adjustments.saturation ?? 0,
        sharpness: adjustments.sharpness ?? 0,
        threshold: adjustments.threshold ?? 0,
        clarity: adjustments.clarity ?? 0,
        dehaze: adjustments.dehaze ?? 0,
        texture: adjustments.texture ?? 0,
      }, masks, maskAlphas.current, overlayMaskId, width, height)
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
  }, [image, adjustments, curves, masks, maskAlphas, cropRegion, view, cropping, overlayMaskId, orientation])

  // Zoom toward a point (in clip space, −1..1) by a scale factor, keeping the
  // content under that point fixed. Clip space matches the renderer's view
  // transform, so the cursor stays locked to the same pixel as the image scales.
  const zoomAtPoint = useCallback((cursorX: number, cursorY: number, factor: number) => {
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
      shownCrop, view, orientation,
    )
  }

  /** Brush radius in image pixels, scaled to the image's short side. */
  const brushRadius = (): number =>
    image === null ? 0 : BRUSH_RADIUS_FRACTION * Math.min(image.width, image.height)

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

  // Drag either paints the active brush mask (when brushMaskId is set) or pans.
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (brushMaskId !== null && image !== null) {
      const p = toImagePoint(e)
      if (p === null) return
      strokeRef.current = { points: [p], last: p }
      updateBrushCursor(e)
      // Stamp a dot on press so a plain click still marks the mask.
      rendererRef.current?.paintSegment(brushMaskId, p, p, brushRadius(), BRUSH_HARDNESS, 'add')
      drawRef.current()
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
      rendererRef.current?.paintSegment(brushMaskId, stroke.last, p, brushRadius(), BRUSH_HARDNESS, 'add')
      stroke.points.push(p)
      stroke.last = p
      drawRef.current()
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
    setView(v => ({ ...v, offsetX: v.offsetX + dx, offsetY: v.offsetY + dy }))
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const stroke = strokeRef.current
    if (stroke !== null && brushMaskId !== null) {
      // Commit the whole stroke as one undo step; the renderer rebuilds the mask
      // from it on the next frame (reproducing exactly what was live-painted).
      addBrushStroke(brushMaskId, {
        points: stroke.points,
        radius: brushRadius(),
        hardness: BRUSH_HARDNESS,
        mode: 'add',
      })
      commit()
      strokeRef.current = null
      e.currentTarget.releasePointerCapture(e.pointerId)
      return
    }
    panRef.current = null
    e.currentTarget.releasePointerCapture(e.pointerId)
  }

  const resetSettings = () => {
    resetAdjustements();
    resetCurves();
    clearCrop();
    closeResetDialog();
    setView(IDENTITY_VIEW);
    resetOrientation();
  }

  return <>
  {/* Outer box clips the quarter-turn overshoot so the spin never spills over
      the surrounding panels; the inner wrapper is what actually rotates. */}
  <div style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
    <div ref={spinRef} style={{ width: '100%', height: '100%' }}>
     <canvas onContextMenu={showContextMenu([
      {
        key: 'reset',
        icon: <IconZoomReset/>,
        title: 'Reset changes',
        onClick: () => openResetDialog()
      },
    ])}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={() => setBrushCursor(null)}
      onDoubleClick={() => setView(IDENTITY_VIEW)}
      ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block', cursor: brushMaskId !== null ? 'none' : 'default' }} />

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
          border: '1px solid rgba(255,255,255,0.9)',
          boxShadow: '0 0 0 1px rgba(0,0,0,0.5)',
          pointerEvents: 'none',
        }}
      />
    )}
    <ConfirmDialog
      opened={resetDialogOpen}
      onClose={closeResetDialog}
      onConfirm={() => resetSettings()}
      title="Reset changes"
      message="This will reset all adjustment sliders, the crop area and tone curves to their default values."
      confirmLabel="Reset"
      confirmColor="red"
    />
  </>
}

