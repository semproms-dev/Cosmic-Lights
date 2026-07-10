import { describe, expect, it } from 'vitest'
import type { CropRegion } from './image'
import {
  exportDimensions,
  exportExtension,
  exportFileName,
  normalizeQuality,
} from './export'

// ─────────────────────────────────────────────────────────────────────────────
// Contract for the pure helpers in `editor/export.ts`. The render/encode path
// (WebGL + canvas.toBlob) lives in ExportPanel and is exercised in the browser;
// these tests cover the framing/quality/naming logic that can be verified
// without a GL context. MIME lives in `FORMAT_CAPS` (exportFormats.ts), so it is
// not duplicated here.
//
//   exportDimensions(crop, imgW, imgH) → { width, height }
//       full frame when crop is null; rounded crop size otherwise.
//   normalizeQuality(quality) → clamp 0..100, then / 100.
//   exportExtension(format)   → 'jpeg' → 'jpg', otherwise the format key.
//   exportFileName(original, format) → swap the last extension segment.
// ─────────────────────────────────────────────────────────────────────────────

describe('exportDimensions', () => {
  it('returns the full image size when there is no crop', () => {
    expect(exportDimensions(null, 6000, 4000)).toEqual({ width: 6000, height: 4000 })
  })

  it('returns the crop size when a crop is active', () => {
    const crop: CropRegion = { x: 100, y: 50, width: 800, height: 600 }

    expect(exportDimensions(crop, 6000, 4000)).toEqual({ width: 800, height: 600 })
  })

  it('rounds fractional crop dimensions (a drag leaves sub-pixel sizes)', () => {
    const crop: CropRegion = { x: 5.2, y: 10.9, width: 40.6, height: 30.4 }

    expect(exportDimensions(crop, 6000, 4000)).toEqual({ width: 41, height: 30 })
  })
})

describe('normalizeQuality', () => {
  it('maps the 0-100 slider onto the 0-1 range toBlob expects', () => {
    expect(normalizeQuality(90)).toBeCloseTo(0.9)
    expect(normalizeQuality(0)).toBe(0)
    expect(normalizeQuality(100)).toBe(1)
  })

  it('clamps values outside 0-100', () => {
    expect(normalizeQuality(-20)).toBe(0)
    expect(normalizeQuality(150)).toBe(1)
  })
})

describe('exportExtension', () => {
  it('uses "jpg" (not "jpeg") as the JPEG extension', () => {
    expect(exportExtension('jpeg')).toBe('jpg')
  })

  it('reuses the format key for other formats', () => {
    expect(exportExtension('png')).toBe('png')
    expect(exportExtension('webp')).toBe('webp')
  })
})

describe('exportFileName', () => {
  it('replaces the RAW extension with the output format extension', () => {
    expect(exportFileName('IMG_1234.CR2', 'jpeg')).toBe('IMG_1234.jpg')
    expect(exportFileName('photo.arw', 'png')).toBe('photo.png')
    expect(exportFileName('shot.NEF', 'webp')).toBe('shot.webp')
  })

  it('only replaces the last extension segment', () => {
    expect(exportFileName('holiday.2024.raf', 'jpeg')).toBe('holiday.2024.jpg')
  })

  it('appends an extension when the original has none', () => {
    expect(exportFileName('noext', 'png')).toBe('noext.png')
  })
})
