import { describe, expect, it } from 'vitest'
import type { CropRegion } from './image'
import {
  applyUvTransform,
  cropToUvTransform,
  IDENTITY_ORIENTATION,
  turn,
  uvTransform,
  type Orientation,
  type QuarterTurns,
} from './rotation'

/** A deliberately non-square image and crop: a square one hides axis-swap bugs. */
const W = 200
const H = 100
const CROP: CropRegion = { x: 0, y: 0, width: 100, height: 50 }

const orientation = (o: Partial<Orientation>): Orientation => ({ ...IDENTITY_ORIENTATION, ...o })

/** The four corners of the output quad, in vUv (y-down from the screen top). */
const OUTPUT_CORNERS = {
  topLeft: { x: 0, y: 0 },
  topRight: { x: 1, y: 0 },
  bottomRight: { x: 1, y: 1 },
  bottomLeft: { x: 0, y: 1 },
}

/** Image UV → image pixels, rounded, so expectations read as real coordinates. */
const toPixels = (uv: { x: number; y: number }) => ({
  x: Math.round(uv.x * W * 1e6) / 1e6,
  y: Math.round(uv.y * H * 1e6) / 1e6,
})

/** Which source pixel each output corner samples, for one orientation. */
const cornerSamples = (o: Orientation, crop: CropRegion | null = CROP) => {
  const t = uvTransform(o, crop, W, H)
  return {
    topLeft: toPixels(applyUvTransform(t, OUTPUT_CORNERS.topLeft)),
    topRight: toPixels(applyUvTransform(t, OUTPUT_CORNERS.topRight)),
    bottomRight: toPixels(applyUvTransform(t, OUTPUT_CORNERS.bottomRight)),
    bottomLeft: toPixels(applyUvTransform(t, OUTPUT_CORNERS.bottomLeft)),
  }
}

describe('uvTransform — identity', () => {
  it('reduces to the plain crop remap it replaces', () => {
    // The composite used to do `uv = cropOffset + vUv * cropScale`. Unrotated,
    // the matrix form must agree with it exactly, or every existing image moves.
    const { offsetX, offsetY, scaleX, scaleY } = cropToUvTransform(CROP, W, H)
    const t = uvTransform(IDENTITY_ORIENTATION, CROP, W, H)

    for (const vUv of Object.values(OUTPUT_CORNERS)) {
      const old = { x: offsetX + vUv.x * scaleX, y: offsetY + vUv.y * scaleY }
      const next = applyUvTransform(t, vUv)
      expect(next.x).toBeCloseTo(old.x, 10)
      expect(next.y).toBeCloseTo(old.y, 10)
    }
  })

  it('is the identity matrix with no crop and no rotation', () => {
    const t = uvTransform(IDENTITY_ORIENTATION, null, W, H)

    expect(t.matrix).toEqual([1, 0, 0, 1])
    expect(t.center).toEqual([0.5, 0.5])
    expect(t.displayedAspect).toBeCloseTo(W / H)
  })

  it('keeps the crop centre as the pivot', () => {
    const crop: CropRegion = { x: 40, y: 20, width: 40, height: 20 }

    const t = uvTransform(IDENTITY_ORIENTATION, crop, W, H)

    // Centre of that crop = (60, 30) px → (0.3, 0.3) in UV.
    expect(t.center[0]).toBeCloseTo(0.3)
    expect(t.center[1]).toBeCloseTo(0.3)
  })
})

describe('uvTransform — quarter turns', () => {
  it('turns the image clockwise: the crop corners walk one step round', () => {
    // Turning a photo 90° CW carries its bottom-left corner up to the top-left.
    expect(cornerSamples(orientation({ quarterTurns: 1 }))).toEqual({
      topLeft: { x: 0, y: 50 },      // crop bottom-left
      topRight: { x: 0, y: 0 },      // crop top-left
      bottomRight: { x: 100, y: 0 }, // crop top-right
      bottomLeft: { x: 100, y: 50 }, // crop bottom-right
    })
  })

  it('turns anticlockwise on three quarters — the inverse of one', () => {
    expect(cornerSamples(orientation({ quarterTurns: 3 }))).toEqual({
      topLeft: { x: 100, y: 0 },
      topRight: { x: 100, y: 50 },
      bottomRight: { x: 0, y: 50 },
      bottomLeft: { x: 0, y: 0 },
    })
  })

  it('turns the image upside down on two quarters', () => {
    expect(cornerSamples(orientation({ quarterTurns: 2 }))).toEqual({
      topLeft: { x: 100, y: 50 },
      topRight: { x: 0, y: 50 },
      bottomRight: { x: 0, y: 0 },
      bottomLeft: { x: 100, y: 0 },
    })
  })

  it('never samples outside the crop, whatever the turn', () => {
    // The regression this file exists for: scaling the output offset by the
    // crop's own (width, height) instead of the *displayed* frame's overshoots
    // one axis and falls short on the other as soon as the crop is not square.
    for (const quarterTurns of [0, 1, 2, 3] as QuarterTurns[]) {
      const samples = Object.values(cornerSamples(orientation({ quarterTurns })))
      for (const p of samples) {
        expect(p.x).toBeGreaterThanOrEqual(CROP.x)
        expect(p.x).toBeLessThanOrEqual(CROP.x + CROP.width)
        expect(p.y).toBeGreaterThanOrEqual(CROP.y)
        expect(p.y).toBeLessThanOrEqual(CROP.y + CROP.height)
      }
      // …and it must cover the crop, not a sliver of it.
      expect(new Set(samples.map((p) => `${p.x},${p.y}`)).size).toBe(4)
    }
  })

  it('swaps the displayed aspect on odd turns only', () => {
    const cropAspect = CROP.width / CROP.height

    expect(uvTransform(orientation({ quarterTurns: 0 }), CROP, W, H).displayedAspect).toBeCloseTo(cropAspect)
    expect(uvTransform(orientation({ quarterTurns: 1 }), CROP, W, H).displayedAspect).toBeCloseTo(1 / cropAspect)
    expect(uvTransform(orientation({ quarterTurns: 2 }), CROP, W, H).displayedAspect).toBeCloseTo(cropAspect)
    expect(uvTransform(orientation({ quarterTurns: 3 }), CROP, W, H).displayedAspect).toBeCloseTo(1 / cropAspect)
  })

  it('uses exact zeros, not floating-point noise, for the turned axes', () => {
    // cos(π/2) is 6.1e-17; a lossless turn must not carry that into the sample.
    const t = uvTransform(orientation({ quarterTurns: 1 }), CROP, W, H)

    expect(t.matrix[0]).toBe(0)
    expect(t.matrix[3]).toBe(0)
  })
})

describe('uvTransform — flips', () => {
  it('mirrors left↔right on flipH', () => {
    expect(cornerSamples(orientation({ flipH: true }))).toEqual({
      topLeft: { x: 100, y: 0 },
      topRight: { x: 0, y: 0 },
      bottomRight: { x: 0, y: 50 },
      bottomLeft: { x: 100, y: 50 },
    })
  })

  it('mirrors top↔bottom on flipV', () => {
    expect(cornerSamples(orientation({ flipV: true }))).toEqual({
      topLeft: { x: 0, y: 50 },
      topRight: { x: 100, y: 50 },
      bottomRight: { x: 100, y: 0 },
      bottomLeft: { x: 0, y: 0 },
    })
  })

  it('leaves the displayed aspect alone — a mirror is not a turn', () => {
    const t = uvTransform(orientation({ flipH: true, flipV: true }), CROP, W, H)

    expect(t.displayedAspect).toBeCloseTo(CROP.width / CROP.height)
  })

  it('flips in DISPLAY space: flipH still mirrors left↔right when turned', () => {
    // This is what lets the store keep `FLIP_H → flipH = !flipH`. Source-space
    // flips would show a *vertical* mirror here, on an odd turn.
    const turned = cornerSamples(orientation({ quarterTurns: 1 }))
    const flipped = cornerSamples(orientation({ quarterTurns: 1, flipH: true }))

    expect(flipped.topLeft).toEqual(turned.topRight)
    expect(flipped.topRight).toEqual(turned.topLeft)
    expect(flipped.bottomLeft).toEqual(turned.bottomRight)
    expect(flipped.bottomRight).toEqual(turned.bottomLeft)
  })

  it('flipH + flipV is a half turn', () => {
    expect(cornerSamples(orientation({ flipH: true, flipV: true })))
      .toEqual(cornerSamples(orientation({ quarterTurns: 2 })))
  })
})

describe('turn — the button matches what the user sees', () => {
  /** The four mirror states: none, one each way, and both. */
  const MIRRORS: Orientation[] = [
    orientation({}),
    orientation({ flipH: true }),
    orientation({ flipV: true }),
    orientation({ flipH: true, flipV: true }),
  ]

  const describeMirror = (o: Orientation) => `flipH=${o.flipH} flipV=${o.flipV}`

  it('turns the DISPLAY clockwise on cw, whatever the mirrors', () => {
    // A clockwise turn on screen carries the content at the top-left corner
    // round to the top-right one. Asserted against the real transform rather
    // than against `quarterTurns`, because the number is exactly the thing that
    // does not answer this question when a mirror is on.
    for (const start of MIRRORS) {
      for (const quarterTurns of [0, 1, 2, 3] as QuarterTurns[]) {
        const before = { ...start, quarterTurns }
        const after = turn(before, 'cw')

        expect(cornerSamples(after).topRight, describeMirror(start)).toEqual(cornerSamples(before).topLeft)
        expect(cornerSamples(after).bottomRight, describeMirror(start)).toEqual(cornerSamples(before).topRight)
      }
    }
  })

  it('turns the DISPLAY anticlockwise on ccw, whatever the mirrors', () => {
    for (const start of MIRRORS) {
      for (const quarterTurns of [0, 1, 2, 3] as QuarterTurns[]) {
        const before = { ...start, quarterTurns }
        const after = turn(before, 'ccw')

        expect(cornerSamples(after).topLeft, describeMirror(start)).toEqual(cornerSamples(before).topRight)
      }
    }
  })

  it('takes the mirrors into account: one flip reverses the step', () => {
    // The regression guard for the XOR. A plain `(q+1)%4` passes every test
    // above except this one's odd rows, which is why they exist separately.
    expect(turn(orientation({}), 'cw').quarterTurns).toBe(1)
    expect(turn(orientation({ flipH: true }), 'cw').quarterTurns).toBe(3)
    expect(turn(orientation({ flipV: true }), 'cw').quarterTurns).toBe(3)
    // Two mirrors are a half turn, not a mirror: the plain step is right again.
    expect(turn(orientation({ flipH: true, flipV: true }), 'cw').quarterTurns).toBe(1)
  })

  it('cw and ccw undo each other, mirrors or not', () => {
    for (const start of MIRRORS) {
      expect(turn(turn(start, 'cw'), 'ccw')).toEqual(start)
      expect(turn(turn(start, 'ccw'), 'cw')).toEqual(start)
    }
  })

  it('comes full circle in four turns and never leaves 0..3', () => {
    for (const start of MIRRORS) {
      let o = start
      for (let i = 0; i < 4; i++) {
        o = turn(o, 'cw')
        expect([0, 1, 2, 3]).toContain(o.quarterTurns)
      }
      expect(o).toEqual(start)
    }
  })

  it('leaves the flips alone and does not mutate its input', () => {
    const before = orientation({ flipH: true, quarterTurns: 2 })

    const after = turn(before, 'cw')

    expect(after.flipH).toBe(true)
    expect(after.flipV).toBe(false)
    expect(before.quarterTurns).toBe(2)
  })
})

describe('uvTransform — crop and orientation together', () => {
  it('turns around the crop centre, not the image centre', () => {
    const crop: CropRegion = { x: 100, y: 50, width: 100, height: 50 }

    const samples = cornerSamples(orientation({ quarterTurns: 1 }), crop)

    // Every sample stays inside the bottom-right crop, mirroring the k=1 walk.
    expect(samples).toEqual({
      topLeft: { x: 100, y: 100 },
      topRight: { x: 100, y: 50 },
      bottomRight: { x: 200, y: 50 },
      bottomLeft: { x: 200, y: 100 },
    })
  })
})
