import type { CropRegion } from './image'
import type { ExportFormat } from './exportFormats'
import { rotatedBoundingBox, type Orientation } from './rotation'

/**
 * File extension per export format. JPEG collapses to the conventional 'jpg';
 * the rest reuse their format key.
 */
const FORMAT_EXTENSION: Record<ExportFormat, string> = {
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
  avif: 'avif',
  jxl: 'jxl',
  tiff: 'tiff',
  cube: 'cube',
}

export interface ExportSize {
  width: number
  height: number
}

/**
 * Output pixel dimensions for an export: the size of the frame **as the user
 * sees it**. That is the crop (rounded to whole pixels — a drag leaves
 * sub-pixel sizes), or the full frame when there is no crop, with the two axes
 * **swapped on an odd quarter turn**, because a quarter turn stands the frame on
 * its end. A free straighten angle then expands the result to the rotated
 * bounding box, or the exported corners would be clipped.
 *
 * Sizing the export canvas to these values makes its aspect match the displayed
 * aspect, so the renderer's letterbox collapses to identity — the frame fills
 * the output, at its native resolution, with no bars. Get the swap wrong and the
 * letterbox does *not* collapse: a turned photo exports with bars instead of
 * matching what is on screen.
 *
 * The flips are deliberately ignored: a mirror moves pixels, never the frame.
 *
 * @param crop - The active crop region, or null for the full frame.
 * @param imageWidth - Full image width in pixels.
 * @param imageHeight - Full image height in pixels.
 * @param orientation - The turns and mirroring the user has applied.
 */
export function exportDimensions(
  crop: CropRegion | null,
  imageWidth: number,
  imageHeight: number,
  orientation: Orientation,
): ExportSize {
  const width = crop ? Math.round(crop.width) : imageWidth
  const height = crop ? Math.round(crop.height) : imageHeight
  const frame = orientation.quarterTurns % 2 === 1
    ? { width: height, height: width }
    : { width, height }
  // With a free angle the exported canvas must fit the ROTATED frame, or the
  // corners get clipped. Same bounding box `uvTransform` letterboxes to, so the
  // letterbox still collapses: no bars, and the preview and export agree.
  const bbox = rotatedBoundingBox(frame.width, frame.height, orientation.angleDeg)
  return { width: Math.round(bbox.width), height: Math.round(bbox.height) }
}

/**
 * Map the 0-100 quality slider onto the 0-1 range `canvas.toBlob` expects,
 * clamping input that falls outside 0-100.
 *
 * @param quality - Slider value, nominally 0-100.
 */
export function normalizeQuality(quality: number): number {
  return Math.max(0, Math.min(100, quality)) / 100
}

/**
 * The file extension for an export format (e.g. 'jpeg' → 'jpg').
 *
 * @param format - The export format key.
 */
export function exportExtension(format: ExportFormat): string {
  return FORMAT_EXTENSION[format]
}

/**
 * Build the output filename by swapping the original's last extension for the
 * export format's, appending one when the original has none. Only the final
 * `.segment` is replaced, so dotted names ('holiday.2024.raf') keep their stem.
 *
 * @param original - The source filename, with or without an extension.
 * @param format - The export format key.
 */
export function exportFileName(original: string, format: ExportFormat): string {
  const dot = original.lastIndexOf('.')
  const base = dot === -1 ? original : original.slice(0, dot)
  return `${base}.${exportExtension(format)}`
}
