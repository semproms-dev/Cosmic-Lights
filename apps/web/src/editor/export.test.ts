import { describe, expect, it } from 'vitest'
import type { CropRegion } from './image'
import { IDENTITY_ORIENTATION, uvTransform, type Orientation, type QuarterTurns } from './rotation'
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
//   exportDimensions(crop, imgW, imgH, orientation) → { width, height }
//       full frame when crop is null; rounded crop size otherwise; axes swapped
//       on an odd quarter turn, so the output matches what the user sees.
//   normalizeQuality(quality) → clamp 0..100, then / 100.
//   exportExtension(format)   → 'jpeg' → 'jpg', otherwise the format key.
//   exportFileName(original, format) → swap the last extension segment.
// ─────────────────────────────────────────────────────────────────────────────

const turned = (quarterTurns: QuarterTurns, flips: Partial<Orientation> = {}): Orientation => ({
  ...IDENTITY_ORIENTATION,
  ...flips,
  quarterTurns,
})

describe('exportDimensions', () => {
  it('returns the full image size when there is no crop', () => {
    expect(exportDimensions(null, 6000, 4000, IDENTITY_ORIENTATION)).toEqual({
      width: 6000,
      height: 4000,
    })
  })

  it('returns the crop size when a crop is active', () => {
    const crop: CropRegion = { x: 100, y: 50, width: 800, height: 600 }

    expect(exportDimensions(crop, 6000, 4000, IDENTITY_ORIENTATION)).toEqual({
      width: 800,
      height: 600,
    })
  })

  it('rounds fractional crop dimensions (a drag leaves sub-pixel sizes)', () => {
    const crop: CropRegion = { x: 5.2, y: 10.9, width: 40.6, height: 30.4 }

    expect(exportDimensions(crop, 6000, 4000, IDENTITY_ORIENTATION)).toEqual({
      width: 41,
      height: 30,
    })
  })

  it('stands the full frame on its end on an odd turn', () => {
    // A landscape photo turned 90° is a portrait file. Without this the canvas
    // stays landscape, the letterbox stops collapsing, and the JPG comes out
    // with bars instead of matching the screen.
    expect(exportDimensions(null, 6000, 4000, turned(1))).toEqual({ width: 4000, height: 6000 })
    expect(exportDimensions(null, 6000, 4000, turned(3))).toEqual({ width: 4000, height: 6000 })
  })

  it('leaves the frame alone on an even turn', () => {
    expect(exportDimensions(null, 6000, 4000, turned(0))).toEqual({ width: 6000, height: 4000 })
    expect(exportDimensions(null, 6000, 4000, turned(2))).toEqual({ width: 6000, height: 4000 })
  })

  it('swaps the crop, not the image, when both a crop and an odd turn are active', () => {
    // The bug this guards: swapping the *image* dimensions here would export a
    // 4000×6000 file for an 800×600 crop.
    const crop: CropRegion = { x: 100, y: 50, width: 800, height: 600 }

    expect(exportDimensions(crop, 6000, 4000, turned(1))).toEqual({ width: 600, height: 800 })
  })

  it('rounds before swapping, so an odd turn cannot leak a fractional size', () => {
    const crop: CropRegion = { x: 5.2, y: 10.9, width: 40.6, height: 30.4 }

    expect(exportDimensions(crop, 6000, 4000, turned(1))).toEqual({ width: 30, height: 41 })
  })

  it('ignores the flips: a mirror moves pixels, not the frame', () => {
    const crop: CropRegion = { x: 100, y: 50, width: 800, height: 600 }

    expect(exportDimensions(crop, 6000, 4000, turned(0, { flipH: true, flipV: true }))).toEqual({
      width: 800,
      height: 600,
    })
    // …and a mirror must not cancel the swap an odd turn calls for.
    expect(exportDimensions(crop, 6000, 4000, turned(1, { flipH: true }))).toEqual({
      width: 600,
      height: 800,
    })
  })

  it('matches the aspect the renderer will letterbox to', () => {
    // The contract that ties this to rotation.ts: the export canvas aspect must
    // equal uvTransform's `displayedAspect`, or the bars come back.
    const crop: CropRegion = { x: 0, y: 0, width: 800, height: 600 }

    for (const quarterTurns of [0, 1, 2, 3] as QuarterTurns[]) {
      const size = exportDimensions(crop, 6000, 4000, turned(quarterTurns))
      const displayedAspect =
        quarterTurns % 2 === 1 ? crop.height / crop.width : crop.width / crop.height

      expect(size.width / size.height).toBeCloseTo(displayedAspect)
    }
  })

  it('expands to the rotated bounding box on a free angle', () => {
    // At 45° a 6000×4000 frame's corners sweep out a ~7071×7071 box; exporting
    // at the unrotated size would clip them.
    const angleDeg = 45
    const rad = (angleDeg * Math.PI) / 180
    const c = Math.abs(Math.cos(rad))
    const s = Math.abs(Math.sin(rad))

    const size = exportDimensions(null, 6000, 4000, turned(0, { angleDeg }))

    expect(size).toEqual({
      width: Math.round(6000 * c + 4000 * s),
      height: Math.round(6000 * s + 4000 * c),
    })
  })

  it('matches the ROTATED aspect the renderer letterboxes to', () => {
    // Same contract as above, but with a free angle: the export canvas must
    // equal the rotated bounding box's aspect, or the free angle reintroduces
    // the bars (and clips the corners) that the even-turn case removed.
    const crop: CropRegion = { x: 0, y: 0, width: 800, height: 600 }
    const angleDeg = 15

    const size = exportDimensions(crop, 6000, 4000, turned(1, { angleDeg }))
    const displayedAspect = uvTransform(turned(1, { angleDeg }), crop, 6000, 4000).displayedAspect

    // Rounded to whole pixels on the export side, so the aspect agrees to
    // within a fraction of a percent rather than exactly.
    expect(size.width / size.height).toBeCloseTo(displayedAspect, 2)
  })

  it('a 90° free angle exports as the quarter-turn swap', () => {
    // cos(90°) ≈ 6.1e-17 washes out of the rounding; the frame comes out as if
    // it had been turned the long way round, with no floating-point smearing.
    expect(exportDimensions(null, 6000, 4000, turned(0, { angleDeg: 90 }))).toEqual({
      width: 4000,
      height: 6000,
    })
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
