import { useCallback, useEffect, useRef, useState } from 'react'
import { useEditor } from '../../editor/editorContext'
import { compileCurveTexture } from '../../editor/curvesMath'
import { WebGLRenderer } from '../../editor/gl/renderer'
import { logger } from '../../logger'
import { useDisclosure } from '@mantine/hooks'
import { useContextMenu } from 'mantine-contextmenu'
import { IconZoomReset } from '@tabler/icons-react'
import { ConfirmDialog } from '../window/ConfirmDialog'
import { clampZoom } from '../../utils'

/** Per wheel notch, the fitted image grows/shrinks by this factor. */
const ZOOM_STEP = 1.1

/** Identity view: the whole image fitted to the canvas, centred. */
const DEFAULT_VIEW = { scale: 1, offsetX: 0, offsetY: 0 }

/**
 * Central editor canvas. Renders the decoded image through the WebGL pipeline,
 * applying the live adjustments from the shared editor store. Redraws on image
 * change, adjustment change or resize, batching each into a single animation
 * frame. The image keeps its aspect ratio (letterboxed) inside the container.
 */
export function Canvas() {
  const { image, adjustments, curves, resetAdjustements, resetCurves, loadImage, cropRegion, clearCrop } = useEditor()
  const [resetOpened, { open: openReset, close: closeReset }] = useDisclosure(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<WebGLRenderer | null>(null)
  const { showContextMenu } = useContextMenu()
  const [view, setView] = useState(DEFAULT_VIEW)
  // Holds the last pointer position while panning; null when not dragging.
  const panRef = useRef<{ x: number; y: number } | null>(null)

  const handleDrop = (e: React.DragEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0];
    if(!file) return;
    loadImage(file)
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
      const rect = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      const width = Math.round(rect.width * dpr)
      const height = Math.round(rect.height * dpr)
      canvas.width = width
      canvas.height = height
      if(image != null) {
        renderer.setCrop(cropRegion, image.width, image.height)
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
      }, width, height)
    }

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
  }, [image, adjustments, curves, cropRegion, view])

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
  }, [])

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

  // Drag-to-pan: translate the view by the cursor delta, converted to clip space.
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    panRef.current = { x: e.clientX, y: e.clientY }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
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
    panRef.current = null
    e.currentTarget.releasePointerCapture(e.pointerId)
  }

  return <>
    <canvas onContextMenu={showContextMenu([
      {
        key: 'reset',
        icon: <IconZoomReset/>,
        title: 'Reset changes',
        onClick: () => openReset()
      },
    ])}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onDoubleClick={() => setView(DEFAULT_VIEW)}
      onDragOver={(e) => {e.preventDefault()}} onDrop={handleDrop} ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
    <ConfirmDialog
      opened={resetOpened}
      onClose={closeReset}
      onConfirm={() => { resetAdjustements(); resetCurves(); clearCrop(); closeReset() }}
      title="Reset changes"
      message="This will reset all adjustment sliders, the crop area and tone curves to their default values."
      confirmLabel="Reset"
      confirmColor="red"
    />
  </>
}

