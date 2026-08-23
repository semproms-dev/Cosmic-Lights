import { logger } from '../logger'
import { createId } from './createId'
import { readJpegMetadata } from './jpegMetadata'
import type { Photo } from './library'

/** Longest edge of a generated library thumbnail, in pixels. */
export const THUMBNAIL_MAX_EDGE = 320

/**
 * Creates the library record for an imported file.
 *
 * Deliberately cheap and synchronous: `thumbUrl`/`captureTime` start as `null`
 * and fill in later — thumbnails need pixels, EXIF needs parsing, and neither
 * may delay registering the file (RAW decode especially). See
 * {@link enrichPhoto}.
 *
 * @param file - The imported file.
 * @returns A fresh {@link Photo} with a unique id.
 */
export function createPhoto(file: File): Photo {
  return {
    id: createId(),
    fileName: file.name,
    thumbUrl: null,
    captureTime: null,
  }
}

/**
 * Downscales a decoded frame to a JPEG data URL usable as a grid thumbnail.
 *
 * @param bitmap - The frame to shrink. Not closed here — ownership stays with
 *   the caller, who may still be drawing with it.
 * @returns The data URL, or `null` when no 2D canvas is available (jsdom,
 *   hardened browsers).
 */
export function thumbnailFromBitmap(bitmap: ImageBitmap): string | null {
  try {
    const scale = Math.min(1, THUMBNAIL_MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (context === null) return null
    context.drawImage(bitmap, 0, 0, width, height)
    return canvas.toDataURL('image/jpeg', 0.8)
  } catch (error) {
    logger.warn(`thumbnail generation failed: ${String(error)}`)
    return null
  }
}

/**
 * Generates a thumbnail for an imported file.
 *
 * Only formats the browser can decode natively produce one (JPEG, PNG, WebP…).
 * A RAW file has no browser decoder, so this is expected to fail for them and
 * that outcome is ordinary, not an error: the photo keeps its placeholder until
 * a pass with real pixels fills it in.
 *
 * @param file - The imported file.
 * @returns A data URL, or `null` when no thumbnail could be produced.
 */
export async function generateThumbnail(file: File): Promise<string | null> {
  try {
    if (typeof createImageBitmap === 'undefined') return null
    const bitmap = await createImageBitmap(file)
    try {
      return thumbnailFromBitmap(bitmap)
    } finally {
      bitmap.close()
    }
  } catch (error) {
    // Debug, not warn: for RAW files this is the normal course of events.
    logger.debug(`no thumbnail for ${file.name}: ${String(error)}`)
    return null
  }
}

/**
 * Reads the EXIF capture time of an imported file, in epoch milliseconds.
 *
 * Reuses the JPEG EXIF reader, which fails soft on anything that is not a JPEG
 * (RAW metadata arrives later, from LibRaw's decode). Never rejects.
 *
 * @param file - The imported file.
 * @returns Epoch milliseconds, or `null` when the file carries no usable time.
 */
export async function readCaptureTime(file: File): Promise<number | null> {
  try {
    const timestamp = (await readJpegMetadata(file))?.timestamp
    if (!(timestamp instanceof Date)) return null
    const time = timestamp.getTime()
    return Number.isFinite(time) ? time : null
  } catch (error) {
    logger.warn(`no capture time for ${file.name}: ${String(error)}`)
    return null
  }
}

/** Enrichment fields a photo may gain after its initial registration. */
export interface PhotoEnrichment {
  /** Generated thumbnail, or `null` when none could be produced. */
  thumbUrl: string | null
  /** Capture time in epoch milliseconds, or `null` when unknown. */
  captureTime: number | null
}

/**
 * Computes everything a freshly registered photo is missing, off the import
 * path so the library grid appears instantly.
 *
 * Both reads fail soft, so this resolves to nulls rather than rejecting — a
 * file that yields nothing is simply a placeholder in the grid, never an error
 * dialog.
 *
 * @param file - The imported file.
 * @returns Whatever could be read for it.
 */
export async function enrichPhoto(file: File): Promise<PhotoEnrichment> {
  try {
    const [thumbUrl, captureTime] = await Promise.all([
      generateThumbnail(file),
      readCaptureTime(file),
    ])
    return { thumbUrl, captureTime }
  } catch (error) {
    logger.error(`enrichment failed for ${file.name}`, error)
    return { thumbUrl: null, captureTime: null }
  }
}
