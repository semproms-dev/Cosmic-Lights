import { describe, expect, it } from 'vitest'
import type { CropRegion } from './image'
import {
  FORMAT_MIME,
  exportDimensions,
  exportFileName,
  flipRowsVertically,
  normalizeQuality,
} from './export'

// ─────────────────────────────────────────────────────────────────────────────
// TDD contract for `editor/export.ts` (docs/export.technical.md §9/§10). These
// tests define the expected pure-helper signatures; implement `export.ts` to
// satisfy them:
//
//   exportDimensions(crop: CropRegion | null, imgW: number, imgH: number)
//       → { width: number; height: number }   // full frame when crop is null;
//                                                 rounded crop size otherwise.
//   FORMAT_MIME: Record<string, string>        // 'JPG'|'PNG'|'WEBP' → mime.
//   normalizeQuality(quality: number): number  // clamp 0..100, then / 100.
//   exportFileName(original: string, format: string): string
//                                              // swap the extension; JPG → 'jpg'.
//   flipRowsVertically(pixels: Uint8ClampedArray, width: number, height: number)
//       → Uint8ClampedArray                    // row y ↔ row (height-1-y).
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

describe('FORMAT_MIME', () => {
  it('maps each panel format to its MIME type', () => {
    expect(FORMAT_MIME.JPG).toBe('image/jpeg')
    expect(FORMAT_MIME.PNG).toBe('image/png')
    expect(FORMAT_MIME.WEBP).toBe('image/webp')
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

describe('exportFileName', () => {
  it('replaces the RAW extension with the output format extension', () => {
    expect(exportFileName('IMG_1234.CR2', 'JPG')).toBe('IMG_1234.jpg')
    expect(exportFileName('photo.arw', 'PNG')).toBe('photo.png')
    expect(exportFileName('shot.NEF', 'WEBP')).toBe('shot.webp')
  })

  it('uses "jpg" (not "jpeg") as the JPG extension', () => {
    expect(exportFileName('a.dng', 'JPG')).toBe('a.jpg')
  })

  it('only replaces the last extension segment', () => {
    expect(exportFileName('holiday.2024.raf', 'JPG')).toBe('holiday.2024.jpg')
  })

  it('appends an extension when the original has none', () => {
    expect(exportFileName('noext', 'PNG')).toBe('noext.png')
  })
})

describe('flipRowsVertically', () => {
  it('swaps the top and bottom rows, leaving the middle in place', () => {
    // 1 px wide, 3 px tall RGBA: three rows of 4 bytes each.
    const pixels = new Uint8ClampedArray([
      1, 2, 3, 4, // row 0
      5, 6, 7, 8, // row 1
      9, 10, 11, 12, // row 2
    ])

    const flipped = flipRowsVertically(pixels, 1, 3)

    expect(Array.from(flipped)).toEqual([
      9, 10, 11, 12, // was row 2
      5, 6, 7, 8, // row 1 unchanged
      1, 2, 3, 4, // was row 0
    ])
  })

  it('flips a multi-pixel-wide image row by row (whole rows move together)', () => {
    // 2 px wide, 2 px tall: each row is 8 bytes (two RGBA pixels).
    const pixels = new Uint8ClampedArray([
      10, 10, 10, 255, 20, 20, 20, 255, // row 0
      30, 30, 30, 255, 40, 40, 40, 255, // row 1
    ])

    const flipped = flipRowsVertically(pixels, 2, 2)

    expect(Array.from(flipped)).toEqual([
      30, 30, 30, 255, 40, 40, 40, 255, // was row 1
      10, 10, 10, 255, 20, 20, 20, 255, // was row 0
    ])
  })

  it('does not mutate the input array', () => {
    const pixels = new Uint8ClampedArray([1, 2, 3, 4, 5, 6, 7, 8])
    const copy = Uint8ClampedArray.from(pixels)

    flipRowsVertically(pixels, 1, 2)

    expect(Array.from(pixels)).toEqual(Array.from(copy))
  })
})
