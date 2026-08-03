import type { Metadata } from 'libraw-wasm'
import { isFileJpg, isRawFile } from '../components/canvas/rawFormats'
import { logger } from '../logger'
import { decodeRaw } from './decodeRaw'
import { rgbToRgba } from './image'
import { readJpegMetadata } from './jpegMetadata'
import { estimateNoise, mergeNoiseEstimates, NOISE_WINDOW, type NoiseEstimate } from './noiseEstimate'

/**
 * Which decoder produced the pixels.
 *
 * Decided by what actually worked, not by what the file is called: an extension
 * is a claim the user's disk makes, a successful LibRaw decode is proof. Anything
 * downstream that needs to know whether it is holding camera data — the Auto
 * denoise button, the Info panel — asks this rather than parsing the name again.
 */
export type ImageSource = 'raw' | 'developed'

/** One decoded frame, whichever of the two decoders produced it. */
export interface DecodedImage {
  bitmap: ImageBitmap
  /** Camera metadata, or null when the file genuinely carries none. */
  metadata: Metadata | null
  source: ImageSource
  /**
   * Noise measured from the decoded pixels, or `null` when the decoder could
   * not read pixels for it (no canvas, or a frame too small to estimate from).
   * Read once here — at load, where the pixels already exist in memory — so the
   * Auto denoise button later costs nothing to run.
   */
  noise: NoiseEstimate | null
}

/**
 * Decodes through LibRaw.
 *
 * Rejects when the file is not a RAW it understands, and that rejection is load
 * bearing: it is the signal {@link decodeImage} uses to try the other branch.
 *
 * @param file - The file to decode.
 * @returns The decoded frame and the camera metadata LibRaw parsed with it.
 * @throws Whatever LibRaw raised, so the caller can fall back on it.
 */
async function decodeAsRaw(file: File): Promise<DecodedImage> {
  try {
    const decoded = await decodeRaw(await file.arrayBuffer())
    const rgba = rgbToRgba(decoded.data, decoded.width, decoded.height)
    const imageData = new ImageData(rgba, decoded.width, decoded.height)
    return {
      bitmap: await createImageBitmap(imageData),
      metadata: decoded.metadata,
      source: 'raw',
      // The pixels are already in memory here, and they are exactly what the
      // denoise pass will filter — so the estimate is free and correct by
      // construction.
      noise: estimateNoise(rgba, decoded.width, decoded.height),
    }
  } catch (error) {
    // Debug, not error: a rejection here is an ordinary step of the fallback, and
    // `decodeImage` reports it once with the context that explains it.
    logger.debug(`libraw declined ${file.name}: ${String(error)}`)
    throw error
  }
}

/**
 * Decodes with the browser and reads the EXIF separately.
 *
 * `from-image` applies the file's EXIF orientation here, at decode time, so a
 * portrait shot does not come in lying on its side. It must be consumed here and
 * never reach `orientation`: that one is the user's own rotation, and folding
 * both in would turn the photo twice.
 *
 * @param file - The file to decode.
 * @returns The decoded frame and its EXIF, which is null when it carries none.
 * @throws Whatever the browser raised when it cannot decode the file.
 */
async function decodeAsDeveloped(file: File): Promise<DecodedImage> {
  try {
    // Decode and EXIF run together: neither needs the other's answer, and the
    // metadata read is pure parsing over a slice of the same file.
    const [bitmap, metadata] = await Promise.all([
      createImageBitmap(file, { imageOrientation: 'from-image' }),
      readJpegMetadata(file),
    ])
    return { bitmap, metadata, source: 'developed', noise: readNoiseFromBitmap(bitmap) }
  } catch (error) {
    logger.debug(`the browser declined ${file.name}: ${String(error)}`)
    throw error
  }
}

/**
 * Estimates the noise of a browser-decoded frame by sampling it 1:1.
 *
 * The estimator must never run on a *downscaled* copy: the browser's filter
 * averages neighbouring pixels, and averaged noise stops being noise — the
 * measurement would come back systematically too clean. So instead of scaling
 * the frame, a handful of full-resolution tiles are copied from it, reading
 * only a bounded region rather than materialising the whole (possibly 45 MP)
 * image in a canvas.
 *
 * Tiles are spread across the frame (centre + quadrants) because a single tile
 * can land on one texture — fabric, foliage — and overestimate; the median
 * across tiles throws such outliers away (see `mergeNoiseEstimates`).
 *
 * @param bitmap - The frame to measure.
 * @returns The estimated noise, or `null` when no canvas is available, the
 *   frame is too small, or no tile yields a usable estimate.
 */
function readNoiseFromBitmap(bitmap: ImageBitmap): NoiseEstimate | null {
  try {
    const canvas =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(1, 1)
        : document.createElement('canvas')
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (context === null) {
      return null
    }
    // `getContext`'s return type is the union of every context kind; this branch
    // only ever asks for a 2D one, which is what drawImage/getImageData need.
    const ctx = context as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
    const tile = 512
    const estimates: NoiseEstimate[] = []
    for (const fraction of [0.5, 0.25, 0.75]) {
      for (const other of [0.5, 0.25, 0.75]) {
        const x = Math.max(0, Math.round((bitmap.width - tile) * fraction))
        const y = Math.max(0, Math.round((bitmap.height - tile) * other))
        const width = Math.min(tile, bitmap.width - x)
        const height = Math.min(tile, bitmap.height - y)
        if (width < NOISE_WINDOW || height < NOISE_WINDOW) {
          continue
        }
        canvas.width = width
        canvas.height = height
        ctx.drawImage(bitmap, x, y, width, height, 0, 0, width, height)
        const estimate = estimateNoise(ctx.getImageData(0, 0, width, height).data, width, height)
        if (estimate !== null) {
          estimates.push(estimate)
        }
      }
    }
    return mergeNoiseEstimates(estimates)
  } catch {
    logger.warn(`could not measure the noise of ${bitmap.width}×${bitmap.height} frame`)
    return null
  }
}

/**
 * Decodes any supported file, picking the decoder by content rather than by name.
 *
 * The extension only *orders* the two attempts — it is right for essentially
 * every real file, so the common path still costs exactly one decode. What
 * decides is the bytes: a JPEG signature overrules a RAW extension outright, and
 * anything else that lied about itself is caught by falling through to the other
 * decoder. Only a file both decoders refuse is genuinely unopenable.
 *
 * Two ways in, one result: both branches return 8-bit sRGB pixels with metadata
 * in the same shape, which is why nothing downstream — pipeline, Info panel,
 * export — needs to know which one produced the image.
 *
 * @param file - The file the user opened or dropped.
 * @returns The decoded frame, its metadata and which decoder produced it.
 * @throws The second decoder's error when both refuse the file.
 */
export async function decodeImage(file: File): Promise<DecodedImage> {
  try {
    const rawFirst = isRawFile(file) && !(await isFileJpg(file))
    const [preferred, fallback] = rawFirst
      ? [decodeAsRaw, decodeAsDeveloped]
      : [decodeAsDeveloped, decodeAsRaw]
    try {
      return await preferred(file)
    } catch {
      logger.warn(
        `${file.name} is not the ${rawFirst ? 'RAW' : 'image'} its name claims; retrying with the other decoder`,
      )
      return await fallback(file)
    }
  } catch (error) {
    logger.error(`no decoder could open ${file.name}`, error)
    throw error
  }
}
