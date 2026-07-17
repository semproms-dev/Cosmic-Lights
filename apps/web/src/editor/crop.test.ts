import { describe, expect, it } from 'vitest'
import type { CropRegion } from './image'
import {
  anchorForHandle,
  baseToViewPoint,
  baseToViewRect,
  canvasToImageCoords,
  clampCropRegion,
  constrainAspectRatio,
  displayScale,
  IDENTITY_VIEW,
  pointerToImagePoint,
  imagePointToPointer,
  viewToBasePoint,
  getImageDisplayRect,
  imageToCanvasCoords,
  parseAspectRatio,
} from './crop'
import {MIN_CROP_SIZE} from '../utils'
import { cropToUvTransform, IDENTITY_ORIENTATION, type Orientation, type QuarterTurns } from './rotation'

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

describe('view transforms', () => {
  const zoomedIn = { scale: 2, offsetX: 0, offsetY: 0 }

  it('changes nothing at the identity view', () => {
    expect(viewToBasePoint({ x: 750, y: 250 }, 1000, 1000, IDENTITY_VIEW)).toEqual({ x: 750, y: 250 })
  })

  it('halves the distance from the centre at 2x zoom', () => {
    // The centre is fixed: it is the one point the zoom does not move.
    expect(viewToBasePoint({ x: 500, y: 500 }, 1000, 1000, zoomedIn)).toEqual({ x: 500, y: 500 })
    // 750 is 250 right of centre on screen; at 2x that is 125 in the image.
    expect(viewToBasePoint({ x: 750, y: 500 }, 1000, 1000, zoomedIn)).toEqual({ x: 625, y: 500 })
  })

  it('accounts for a pan', () => {
    // offsetX 0.5 shifts the content a quarter of the width to the right, so
    // the content under screen-centre is a quarter-width left of the middle.
    const panned = { scale: 1, offsetX: 0.5, offsetY: 0 }
    expect(viewToBasePoint({ x: 500, y: 500 }, 1000, 1000, panned)).toEqual({ x: 250, y: 500 })
  })

  it('round-trips back to the screen point it came from', () => {
    const view = { scale: 3.7, offsetX: -0.4, offsetY: 0.25 }
    const screen = { x: 321, y: 654 }
    const base = viewToBasePoint(screen, 800, 1000, view)
    const back = baseToViewPoint(base, 800, 1000, view)
    expect(back.x).toBeCloseTo(screen.x, 6)
    expect(back.y).toBeCloseTo(screen.y, 6)
  })

  it('scales a rectangle uniformly and moves its origin', () => {
    const rect = baseToViewRect({ x: 500, y: 500, width: 100, height: 50 }, 1000, 1000, zoomedIn)
    expect(rect.width).toBe(200)
    expect(rect.height).toBe(100)
    // The origin was at the centre, the one point the zoom leaves alone.
    expect(rect.x).toBeCloseTo(500, 6)
    expect(rect.y).toBeCloseTo(500, 6)
  })

  it('regression: a zoomed crop selects what is under the box, not more', () => {
    // The bug: the overlay mapped the pointer straight through the fitted
    // letterbox, ignoring the zoom, so the region came out `scale` times too
    // big and the crop kept more of the image than the box showed.
    const image = { width: 1000, height: 1000 }
    const withoutView = canvasToImageCoords({ x: 750, y: 500 }, image.width, image.height, 1000, 1000)
    const withView = canvasToImageCoords(
      viewToBasePoint({ x: 750, y: 500 }, 1000, 1000, zoomedIn),
      image.width, image.height, 1000, 1000,
    )
    expect(withoutView.x).toBe(750) // what the old code selected
    expect(withView.x).toBe(625)    // the pixel actually under the pointer
  })
})

describe('pointerToImagePoint', () => {
  // 4000x3000 image in a 1000x750 container: same aspect, so no letterbox bars.
  const image = { width: 4000, height: 3000 }
  const container = { w: 1000, h: 750 }
  const centredCrop = { x: 1000, y: 750, width: 2000, height: 1500 }

  it('matches the plain letterbox mapping when nothing is cropped or zoomed', () => {
    const p = pointerToImagePoint(
      { x: 500, y: 375 }, container.w, container.h,
      image.width, image.height, null, IDENTITY_VIEW, IDENTITY_ORIENTATION,
    )
    expect(p).toEqual({ x: 2000, y: 1500 })
  })

  it('regression: honours the crop the canvas is actually showing', () => {
    // The bug: the brush mapped through the FULL image while the renderer was
    // displaying only the crop, so every mark landed off by the crop's origin.
    const p = pointerToImagePoint(
      { x: 0, y: 0 }, container.w, container.h,
      image.width, image.height, centredCrop, IDENTITY_VIEW, IDENTITY_ORIENTATION,
    )
    // The canvas' top-left corner shows the crop's top-left corner.
    expect(p).toEqual({ x: 1000, y: 750 })
  })

  it('maps the far corner of a crop to the crop far corner', () => {
    const p = pointerToImagePoint(
      { x: 1000, y: 750 }, container.w, container.h,
      image.width, image.height, centredCrop, IDENTITY_VIEW, IDENTITY_ORIENTATION,
    )
    expect(p.x).toBeCloseTo(3000, 6)
    expect(p.y).toBeCloseTo(2250, 6)
  })

  it('composes the crop with the zoom', () => {
    const zoomed = { scale: 2, offsetX: 0, offsetY: 0 }
    // Screen centre is fixed by the zoom, and is the crop centre.
    const centre = pointerToImagePoint(
      { x: 500, y: 375 }, container.w, container.h,
      image.width, image.height, centredCrop, zoomed, IDENTITY_ORIENTATION,
    )
    expect(centre.x).toBeCloseTo(2000, 6)
    expect(centre.y).toBeCloseTo(1500, 6)
    // A quarter-width right of centre on screen is an eighth of the crop at 2x.
    const off = pointerToImagePoint(
      { x: 750, y: 375 }, container.w, container.h,
      image.width, image.height, centredCrop, zoomed, IDENTITY_ORIENTATION,
    )
    expect(off.x).toBeCloseTo(2000 + centredCrop.width / 8, 6)
  })

  it('letterboxes a crop whose aspect differs from the container', () => {
    // A square crop in a 4:3 container gets bars left and right.
    const square = { x: 0, y: 0, width: 1500, height: 1500 }
    const p = pointerToImagePoint(
      { x: 500, y: 375 }, container.w, container.h,
      image.width, image.height, square, IDENTITY_VIEW, IDENTITY_ORIENTATION,
    )
    expect(p.x).toBeCloseTo(750, 6)
    expect(p.y).toBeCloseTo(750, 6)
  })

  describe('with the image turned or mirrored', () => {
    const oriented = (o: Partial<Orientation>): Orientation => ({ ...IDENTITY_ORIENTATION, ...o })

    // Turned 90°, the 4000x3000 image displays as a 3:4 portrait frame, which
    // letterboxes to 562.5x750 inside the 1000x750 container: bars left/right.
    const turnedRect = { x: (1000 - 562.5) / 2, width: 562.5, y: 0, height: 750 }

    it('sends the top-left of a 90° turned display to the image bottom-left', () => {
      // Turning the photo clockwise carries its bottom-left corner to the top
      // left, so that is the pixel under the corner of the displayed frame.
      const p = pointerToImagePoint(
        { x: turnedRect.x, y: 0 }, container.w, container.h,
        image.width, image.height, null, IDENTITY_VIEW, oriented({ quarterTurns: 1 }),
      )
      expect(p.x).toBeCloseTo(0, 6)
      expect(p.y).toBeCloseTo(3000, 6)
    })

    it('mirrors left↔right on flipH: the screen left edge is the image right edge', () => {
      const p = pointerToImagePoint(
        { x: 0, y: 375 }, container.w, container.h,
        image.width, image.height, null, IDENTITY_VIEW, oriented({ flipH: true }),
      )
      expect(p.x).toBeCloseTo(4000, 6)
      expect(p.y).toBeCloseTo(1500, 6)
    })

    it('walks the top-left of the display round the image, one corner per turn', () => {
      // Which corner is under the display's top-left, per turn. Turning the
      // photo clockwise carries its bottom-left corner up to the top-left, so
      // the corners walk backwards round the image as the turns go forwards.
      const expected: Record<QuarterTurns, { x: number; y: number }> = {
        0: { x: 0, y: 0 },
        1: { x: 0, y: 3000 },
        2: { x: 4000, y: 3000 },
        3: { x: 4000, y: 0 },
      }

      for (const quarterTurns of [0, 1, 2, 3] as QuarterTurns[]) {
        const turned = quarterTurns % 2 === 1
        const rect = turned ? turnedRect : { x: 0, y: 0, width: 1000, height: 750 }

        const p = pointerToImagePoint(
          { x: rect.x, y: rect.y }, container.w, container.h,
          image.width, image.height, null, IDENTITY_VIEW, oriented({ quarterTurns }),
        )

        expect({ x: Math.round(p.x), y: Math.round(p.y) }, `turn ${quarterTurns}`)
          .toEqual(expected[quarterTurns])
      }
    })

    it('turns the screen axes: moving right on a 90° display moves up the image', () => {
      // The property the corner tests cannot see: on an odd turn the screen's x
      // axis runs along the image's y. 100px right of centre is 100/562.5 of the
      // displayed width, which spans the image's 3000px height.
      const p = pointerToImagePoint(
        { x: 600, y: 375 }, container.w, container.h,
        image.width, image.height, null, IDENTITY_VIEW, oriented({ quarterTurns: 1 }),
      )
      expect(p.x).toBeCloseTo(2000, 6)
      expect(p.y).toBeCloseTo(1500 - (100 / 562.5) * 3000, 6)
    })

    it('composes the turn with a crop and a zoom', () => {
      const zoomed = { scale: 2, offsetX: 0, offsetY: 0 }
      const o = oriented({ quarterTurns: 3, flipV: true })

      // Screen centre is fixed by every one of these transforms, so it pins the
      // stack down: crop offset, zoom and turn all have to cancel exactly.
      const centre = pointerToImagePoint(
        { x: 500, y: 375 }, container.w, container.h,
        image.width, image.height, centredCrop, zoomed, o,
      )
      expect(centre.x).toBeCloseTo(2000, 6)
      expect(centre.y).toBeCloseTo(1500, 6)

      // …and an off-centre point, which the centre alone cannot catch: at 2x the
      // crop's 1500px height spans twice the display, and a 3-quarter turn with
      // flipV sends screen-right to image-down.
      const off = pointerToImagePoint(
        { x: 600, y: 375 }, container.w, container.h,
        image.width, image.height, centredCrop, zoomed, o,
      )
      expect(off.x).toBeCloseTo(2000, 6)
      expect(off.y).toBeCloseTo(1500 + (100 / 2 / 562.5) * 1500, 6)
    })
  })
})

describe('imagePointToPointer (inverse of pointerToImagePoint)', () => {
  const image = { width: 4000, height: 3000 }
  const container = { w: 1000, h: 750 }
  const centredCrop = { x: 1000, y: 750, width: 2000, height: 1500 }
  const square = { x: 0, y: 0, width: 1500, height: 1500 }
  const oriented = (o: Partial<Orientation>): Orientation => ({ ...IDENTITY_ORIENTATION, ...o })

  const crops: (CropRegion | null)[] = [null, centredCrop, square]
  const views = [IDENTITY_VIEW, { scale: 2, offsetX: 0.1, offsetY: -0.2 }]
  const orientations: Orientation[] = [
    oriented({}),
    oriented({ quarterTurns: 1 }),
    oriented({ quarterTurns: 2 }),
    oriented({ quarterTurns: 3 }),
    oriented({ flipH: true }),
    oriented({ flipV: true }),
    oriented({ quarterTurns: 3, flipV: true }),
    oriented({ quarterTurns: 1, flipH: true }),
  ]
  const pointers = [
    { x: 500, y: 375 }, { x: 123, y: 456 }, { x: 900, y: 100 }, { x: 250, y: 700 },
  ]

  it('round-trips a pointer through image space for every crop/view/orientation', () => {
    for (const crop of crops) {
      for (const view of views) {
        for (const orientation of orientations) {
          for (const pt of pointers) {
            const img = pointerToImagePoint(
              pt, container.w, container.h,
              image.width, image.height, crop, view, orientation,
            )
            const back = imagePointToPointer(
              img, container.w, container.h,
              image.width, image.height, crop, view, orientation,
            )
            const label = `crop=${crop ? 'c' : 'null'} scale=${view.scale} q=${orientation.quarterTurns} fh=${orientation.flipH} fv=${orientation.flipV} pt=${pt.x},${pt.y}`
            expect(back.x, label).toBeCloseTo(pt.x, 6)
            expect(back.y, label).toBeCloseTo(pt.y, 6)
          }
        }
      }
    }
  })
})

describe('displayScale', () => {
  it('is the fit-to-container scale with no crop and no zoom', () => {
    expect(displayScale(4000, 3000, 1000, 750, null, IDENTITY_VIEW)).toBeCloseTo(0.25, 6)
  })

  it('grows when a crop fills the container', () => {
    // Half-size crop => it is displayed twice as large as the full frame was.
    const crop = { x: 1000, y: 750, width: 2000, height: 1500 }
    expect(displayScale(4000, 3000, 1000, 750, crop, IDENTITY_VIEW)).toBeCloseTo(0.5, 6)
  })

  it('multiplies by the zoom', () => {
    const view = { scale: 3, offsetX: 0, offsetY: 0 }
    expect(displayScale(4000, 3000, 1000, 750, null, view)).toBeCloseTo(0.75, 6)
  })
})
