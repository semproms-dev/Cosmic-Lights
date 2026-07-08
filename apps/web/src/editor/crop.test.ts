import { describe, expect, it } from 'vitest'
import type { CropRegion } from './image'
import {
  anchorForHandle,
  canvasToImageCoords,
  clampCropRegion,
  constrainAspectRatio,
  cropToUvTransform,
  getImageDisplayRect,
  imageToCanvasCoords,
  parseAspectRatio,
} from './crop'
import {MIN_CROP_SIZE} from '../utils'

describe('cropToUvTransform', () => {
  it('maps a full-image region to the identity transform', () => {
    const region: CropRegion = { x: 0, y: 0, width: 100, height: 80 }

    const uv = cropToUvTransform(region, 100, 80)

    expect(uv).toEqual({ offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 })
  })

  it('converts pixel coordinates to normalized UV offset and scale', () => {
    const region: CropRegion = { x: 10, y: 20, width: 40, height: 30 }

    const uv = cropToUvTransform(region, 100, 80)

    expect(uv.offsetX).toBeCloseTo(0.1)
    expect(uv.offsetY).toBeCloseTo(0.25)
    expect(uv.scaleX).toBeCloseTo(0.4)
    expect(uv.scaleY).toBeCloseTo(0.375)
  })

  it('maps the right half of the image to offsetX 0.5, scaleX 0.5', () => {
    const region: CropRegion = { x: 50, y: 0, width: 50, height: 80 }

    const uv = cropToUvTransform(region, 100, 80)

    expect(uv.offsetX).toBeCloseTo(0.5)
    expect(uv.scaleX).toBeCloseTo(0.5)
    expect(uv.offsetY).toBeCloseTo(0)
    expect(uv.scaleY).toBeCloseTo(1)
  })
})

describe('clampCropRegion', () => {
  it('leaves a region that already fits untouched', () => {
    const region: CropRegion = { x: 10, y: 10, width: 40, height: 30 }

    expect(clampCropRegion(region, 100, 80)).toEqual(region)
  })

  it('pushes a negative origin back to zero, preserving size', () => {
    const region: CropRegion = { x: -5, y: -8, width: 20, height: 20 }

    expect(clampCropRegion(region, 100, 80)).toEqual({ x: 0, y: 0, width: 20, height: 20 })
  })

  it('shifts a region overflowing the right/bottom edge inward, preserving size', () => {
    const region: CropRegion = { x: 90, y: 70, width: 20, height: 20 }

    // 90+20 > 100 → x shifts to 80 (80+20=100); 70+20 > 80 → y shifts to 60.
    expect(clampCropRegion(region, 100, 80)).toEqual({ x: 80, y: 60, width: 20, height: 20 })
  })

  it('clamps a region larger than the image down to the image bounds', () => {
    const region: CropRegion = { x: 0, y: 0, width: 200, height: 200 }

    expect(clampCropRegion(region, 100, 80)).toEqual({ x: 0, y: 0, width: 100, height: 80 })
  })

  it('enforces the minimum crop size', () => {
    const region: CropRegion = { x: 20, y: 20, width: 2, height: 3 }

    const clamped = clampCropRegion(region, 100, 80)

    expect(clamped.width).toBe(MIN_CROP_SIZE)
    expect(clamped.height).toBe(MIN_CROP_SIZE)
  })
})

describe('getImageDisplayRect', () => {
  it('fills the container exactly when the aspects match (no bars)', () => {
    // 100x50 image (2:1) in a 200x100 container (2:1) → fills it, no offset.
    expect(getImageDisplayRect(100, 50, 200, 100)).toEqual({ x: 0, y: 0, width: 200, height: 100 })
  })

  it('letterboxes a wide image (bars top and bottom)', () => {
    // 2:1 image in a 1:1 container → fills width, shrinks height to 100, y bar = 50.
    expect(getImageDisplayRect(200, 100, 100, 100)).toEqual({ x: 0, y: 25, width: 100, height: 50 })
  })

  it('pillarboxes a tall image (bars left and right)', () => {
    // 1:2 image in a 1:1 container → fills height, shrinks width to 50, x bar = 25.
    expect(getImageDisplayRect(100, 200, 100, 100)).toEqual({ x: 25, y: 0, width: 50, height: 100 })
  })
})

describe('imageToCanvasCoords', () => {
  it('maps the full frame onto the letterboxed display rect', () => {
    // Full 200x100 region in a 100x100 container → the whole letterboxed rect.
    const region: CropRegion = { x: 0, y: 0, width: 200, height: 100 }

    expect(imageToCanvasCoords(region, 200, 100, 100, 100)).toEqual({ x: 0, y: 25, width: 100, height: 50 })
  })

  it('maps a sub-region within the letterbox, offset by the bars', () => {
    // Right half of a 200x100 image in a 100x100 container.
    const region: CropRegion = { x: 100, y: 0, width: 100, height: 100 }

    // display rect = {x:0,y:25,w:100,h:50}; x = 0 + 0.5*100 = 50, w = 0.5*100 = 50.
    expect(imageToCanvasCoords(region, 200, 100, 100, 100)).toEqual({ x: 50, y: 25, width: 50, height: 50 })
  })
})

describe('canvasToImageCoords', () => {
  it('inverts a point inside the letterboxed image', () => {
    // Center of the display rect {x:0,y:25,w:100,h:50} → center of the image.
    expect(canvasToImageCoords({ x: 50, y: 50 }, 200, 100, 100, 100)).toEqual({ x: 100, y: 50 })
  })

  it('round-trips with imageToCanvasCoords for an arbitrary corner', () => {
    const region: CropRegion = { x: 37, y: 12, width: 90, height: 55 }
    const rect = imageToCanvasCoords(region, 200, 100, 640, 480)

    const topLeft = canvasToImageCoords({ x: rect.x, y: rect.y }, 200, 100, 640, 480)
    const bottomRight = canvasToImageCoords(
      { x: rect.x + rect.width, y: rect.y + rect.height },
      200, 100, 640, 480,
    )

    expect(topLeft.x).toBeCloseTo(region.x)
    expect(topLeft.y).toBeCloseTo(region.y)
    expect(bottomRight.x).toBeCloseTo(region.x + region.width)
    expect(bottomRight.y).toBeCloseTo(region.y + region.height)
  })
})

describe('constrainAspectRatio (fit-inside)', () => {
  it('shrinks the height when the target ratio is taller than the drawn rect', () => {
    // 40x30 drawn, square ratio → 40x40 would overflow, so height limits to 30 → 30x30.
    const region: CropRegion = { x: 0, y: 0, width: 40, height: 30 }

    expect(constrainAspectRatio(region, 1, 'top-left')).toEqual({ x: 0, y: 0, width: 30, height: 30 })
  })

  it('shrinks the width when the target ratio is wider than the drawn rect', () => {
    // 40x30 drawn, 2:1 ratio → 40x20 fits, width stays.
    const region: CropRegion = { x: 0, y: 0, width: 40, height: 30 }

    expect(constrainAspectRatio(region, 2, 'top-left')).toEqual({ x: 0, y: 0, width: 40, height: 20 })
  })

  it('leaves a region that already matches the ratio untouched', () => {
    const region: CropRegion = { x: 5, y: 5, width: 40, height: 20 }

    expect(constrainAspectRatio(region, 2, 'top-left')).toEqual(region)
  })

  it('keeps the bottom-right corner fixed when anchored there', () => {
    const region: CropRegion = { x: 0, y: 0, width: 40, height: 30 }

    const result = constrainAspectRatio(region, 1, 'bottom-right')

    // Shrinks to 30x30 toward the bottom-right corner (40, 30).
    expect(result).toEqual({ x: 10, y: 0, width: 30, height: 30 })
    expect(result.x + result.width).toBe(40)
    expect(result.y + result.height).toBe(30)
  })

  it('keeps the top-right corner fixed when anchored there', () => {
    const region: CropRegion = { x: 0, y: 0, width: 40, height: 30 }

    const result = constrainAspectRatio(region, 1, 'top-right')

    expect(result).toEqual({ x: 10, y: 0, width: 30, height: 30 })
  })

  it('distributes the shrink evenly around the center when anchored center', () => {
    const region: CropRegion = { x: 0, y: 0, width: 40, height: 30 }

    // 30x30 centered inside 40x30 → x offset (40-30)/2 = 5, y offset 0.
    expect(constrainAspectRatio(region, 1, 'center')).toEqual({ x: 5, y: 0, width: 30, height: 30 })
  })
})

describe('parseAspectRatio', () => {
  it('returns null for a free crop', () => {
    expect(parseAspectRatio('Free', 200, 100)).toBeNull()
  })

  it('derives the ratio from the image dimensions for Original', () => {
    expect(parseAspectRatio('Original', 200, 100)).toBe(2)
    expect(parseAspectRatio('Original', 300, 400)).toBe(0.75)
  })

  it('parses a W:H label as W / H', () => {
    expect(parseAspectRatio('16:9', 200, 100)).toBeCloseTo(16 / 9)
    expect(parseAspectRatio('1:1', 200, 100)).toBe(1)
    expect(parseAspectRatio('3:2', 200, 100)).toBe(1.5)
  })

  it('returns null for an unexpected label', () => {
    expect(parseAspectRatio('nonsense', 200, 100)).toBeNull()
    expect(parseAspectRatio('16:', 200, 100)).toBeNull()
  })
})

describe('anchorForHandle', () => {
  it('maps each corner to the opposite corner', () => {
    expect(anchorForHandle(0, 0)).toBe('bottom-right')
    expect(anchorForHandle(1, 0)).toBe('bottom-left')
    expect(anchorForHandle(0, 1)).toBe('top-right')
    expect(anchorForHandle(1, 1)).toBe('top-left')
  })

  it('maps each edge to the opposite edge', () => {
    expect(anchorForHandle(0.5, 0)).toBe('bottom')
    expect(anchorForHandle(0.5, 1)).toBe('top')
    expect(anchorForHandle(0, 0.5)).toBe('right')
    expect(anchorForHandle(1, 0.5)).toBe('left')
  })
})
