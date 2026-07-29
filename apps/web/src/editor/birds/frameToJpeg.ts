import { logger } from '../../logger'

const log = logger.forContext('birds.frame')

/** Longest side, in pixels, of the frame sent to the service. */
export const DEFAULT_LONG_EDGE = 1024

/** JPEG quality of that frame. */
export const DEFAULT_QUALITY = 0.85

/**
 * Fits `width`×`height` inside a box of `longEdge` on its longest side,
 * preserving the aspect ratio. Images already smaller are left alone — upscaling
 * invents no detail for the classifier and only inflates the upload.
 *
 * @param width - Source width in pixels.
 * @param height - Source height in pixels.
 * @param longEdge - Target for the longest side.
 * @returns Integer dimensions, never below 1×1.
 */
export function fitLongEdge(
  width: number,
  height: number,
  longEdge: number = DEFAULT_LONG_EDGE,
): { width: number; height: number } {
  const largest = Math.max(width, height)
  if (largest <= 0) return { width: 1, height: 1 }
  const scale = Math.min(1, longEdge / largest)
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/**
 * Encodes an image bitmap as a downscaled JPEG, ready to upload.
 *
 * It takes the **undeveloped** bitmap rather than the canvas' output on purpose:
 * that one does not change while sliders move, so the same photo always produces
 * the same request and the answer can be cached per image instead of being
 * re-fetched on every edit. A classifier reads plumage, not the grade.
 *
 * The bitmap is only drawn from, never consumed, so the caller keeps using it.
 *
 * @param bitmap - The decoded image.
 * @param longEdge - Longest side of the encoded frame.
 * @param quality - JPEG quality, 0..1.
 * @returns The encoded JPEG.
 */
export async function frameToJpeg(
  bitmap: ImageBitmap,
  longEdge: number = DEFAULT_LONG_EDGE,
  quality: number = DEFAULT_QUALITY,
): Promise<Blob> {
  try {
    const size = fitLongEdge(bitmap.width, bitmap.height, longEdge)
    const canvas = new OffscreenCanvas(size.width, size.height)
    const context = canvas.getContext('2d')
    if (context === null) throw new Error('Could not get a 2D context to encode the frame')
    context.drawImage(bitmap, 0, 0, size.width, size.height)
    return await canvas.convertToBlob({ type: 'image/jpeg', quality })
  } catch (error) {
    log.error('Could not encode the frame for the bird service', error)
    throw error
  }
}
