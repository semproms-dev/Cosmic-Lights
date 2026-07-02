import { useEffect, useRef } from 'react'
import { useEditor } from '../../editor/editorContext'
import { WebGLRenderer } from '../../editor/gl/renderer'
import { logger } from '../../logger'

/**
 * Central editor canvas. Renders the decoded image through the WebGL pipeline,
 * applying the live adjustments from the shared editor store. Redraws on image
 * change, adjustment change or resize, batching each into a single animation
 * frame. The image keeps its aspect ratio (letterboxed) inside the container.
 */
export function Canvas() {
  const { image, adjustments } = useEditor()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<WebGLRenderer | null>(null)

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
      renderer.render(adjustments.exposure ?? 0, adjustments.contrast ?? 0, width, height)
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

  return <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
}
