import { useEffect, useRef } from 'react'
import { useEditor } from '../../editor/editorContext'
import { WebGLRenderer } from '../../editor/gl/renderer'
import { logger } from '../../logger'
import { useDisclosure } from '@mantine/hooks'
import { useContextMenu } from 'mantine-contextmenu'
import { IconZoomReset } from '@tabler/icons-react'
import { ConfirmDialog } from '../window/ConfirmDialog'

/**
 * Central editor canvas. Renders the decoded image through the WebGL pipeline,
 * applying the live adjustments from the shared editor store. Redraws on image
 * change, adjustment change or resize, batching each into a single animation
 * frame. The image keeps its aspect ratio (letterboxed) inside the container.
 */
export function Canvas() {
  const { image, adjustments, resetAdjustements, resetCurves } = useEditor()
  const [resetOpened, { open: openReset, close: closeReset }] = useDisclosure(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<WebGLRenderer | null>(null)
  const { showContextMenu } = useContextMenu()

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
  }, [image, adjustments])

  return <>
    <canvas onContextMenu={showContextMenu([
      {
        key: 'reset',
        icon: <IconZoomReset/>,
        title: 'Reset changes',
        onClick: () => openReset()
      },
    ])} ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
    <ConfirmDialog
      opened={resetOpened}
      onClose={closeReset}
      onConfirm={() => { resetAdjustements(); resetCurves(); closeReset() }}
      title="Reset changes"
      message="This will reset all adjustment sliders and tone curves to their default values."
      confirmLabel="Reset"
      confirmColor="red"
    />
  </>
}

