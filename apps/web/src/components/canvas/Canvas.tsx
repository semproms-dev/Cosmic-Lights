import { useEffect, useRef } from 'react'
import { useEditor } from '../../editor/editorContext'

/**
 * Central editor canvas. Draws the decoded image scaled to fit its container
 * (letterboxed, aspect preserved) and redraws on image change or resize. Reads
 * the current image from the shared editor store.
 */
export function Canvas() {
  const { image } = useEditor()
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) {
      return
    }
    const ctx = canvas.getContext('2d')
    if (ctx === null) {
      return
    }

    const draw = () => {
      const rect = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr

      ctx.clearRect(0, 0, canvas.width, canvas.height)
      if (image === null) {
        return
      }

      // Fit: scale to fit while preserving aspect ratio, then centre.
      const scale = Math.min(canvas.width / image.width, canvas.height / image.height)
      const drawW = image.width * scale
      const drawH = image.height * scale
      const offX = (canvas.width - drawW) / 2
      const offY = (canvas.height - drawH) / 2
      ctx.drawImage(image.bitmap, offX, offY, drawW, drawH)
    }

    draw()

    const observer = new ResizeObserver(draw)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [image])

  return <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
}
