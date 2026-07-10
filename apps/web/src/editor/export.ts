import type { CropRegion } from './image'
import type { ExportFormat } from './exportFormats'

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
 * Output pixel dimensions for an export: the full frame when there is no crop,
 * otherwise the crop size rounded to whole pixels (a drag leaves sub-pixel
 * sizes). Sizing the export canvas to these values makes its aspect match the
 * crop's, so the renderer's letterbox collapses to identity — the crop fills
 * the frame, at its native resolution, with no bars.
 *
 * @param crop - The active crop region, or null for the full frame.
 * @param imageWidth - Full image width in pixels.
 * @param imageHeight - Full image height in pixels.
 */
export function exportDimensions(
  crop: CropRegion | null,
  imageWidth: number,
  imageHeight: number,
): ExportSize {
  if (!crop) return { width: imageWidth, height: imageHeight }
  return { width: Math.round(crop.width), height: Math.round(crop.height) }
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
