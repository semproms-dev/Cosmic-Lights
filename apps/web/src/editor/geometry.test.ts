import { describe, expect, it } from 'vitest'
import {
  applyMat3,
  distort,
  geometryEquals,
  geometryMatrix,
  IDENTITY_GEOMETRY,
  IDENTITY_MAT3,
  inverseGeometryMatrix,
  isIdentityGeometry,
  lensK1,
  lensScale,
  undistort,
  type Geometry,
} from './geometry'

const geometry = (overrides: Partial<Geometry> = {}): Geometry => ({
  ...IDENTITY_GEOMETRY,
  ...overrides,
})

/** A grid of points on the drawn quad, in frame coordinates (`vUv − 0.5`). */
const framePoints = (): { x: number; y: number }[] => {
  const points: { x: number; y: number }[] = []
  for (let i = 0; i <= 4; i += 1) {
    for (let j = 0; j <= 4; j += 1) {
      points.push({ x: -0.5 + i / 4, y: -0.5 + j / 4 })
    }
  }
  return points
}

describe('geometryMatrix', () => {
  // The regression test the whole feature rests on: an untouched panel must
  // leave the sampling coordinates *exactly* where they were, not merely close.
  // Anything else is a photo that changes the moment the panel is opened.
  it('is the exact identity when every slider is at zero', () => {
    expect(geometryMatrix(IDENTITY_GEOMETRY)).toEqual(IDENTITY_MAT3)
  })

  it('leaves the frame centre alone whatever the sliders say', () => {
    // The centre is the fixed point of the scale and the keystone — only the
    // offset may move it. If a slider drifts the centre, the image swims under
    // the crop as the user drags.
    const m = geometryMatrix(geometry({ perspectiveV: 80, perspectiveH: -60, scaleX: 40, scaleY: -25 }))

    const centre = applyMat3(m, { x: 0, y: 0 })

    expect(centre.x).toBeCloseTo(0, 12)
    expect(centre.y).toBeCloseTo(0, 12)
  })

  it('samples further out when the image is scaled up', () => {
    // scaleX = +100 is ×2 on screen, so a point half way to the right edge must
    // now read from a quarter of the way out — the sampling matrix is the
    // *inverse* of what the user sees, and getting that backwards is a zoom
    // that runs the wrong way.
    const m = geometryMatrix(geometry({ scaleX: 100 }))

    expect(applyMat3(m, { x: 0.5, y: 0 }).x).toBeCloseTo(0.25, 12)
  })

  it('makes ±100 on a scale slider exact reciprocals', () => {
    // Powers of two, so the slider is symmetric about its middle: the same
    // distance either way must undo the other exactly.
    const up = applyMat3(geometryMatrix(geometry({ scaleY: 100 })), { x: 0, y: 0.5 }).y
    const down = applyMat3(geometryMatrix(geometry({ scaleY: -100 })), { x: 0, y: 0.5 }).y

    expect(up * down).toBeCloseTo(0.25, 12)
  })

  it('slides the whole frame by a plain offset', () => {
    // +100 is half a frame. Sampling moves the opposite way to the picture.
    const m = geometryMatrix(geometry({ offsetX: 100 }))

    expect(applyMat3(m, { x: 0, y: 0 }).x).toBeCloseTo(-0.5, 12)
    expect(applyMat3(m, { x: 0.25, y: 0 }).x).toBeCloseTo(-0.25, 12)
  })

  it('keeps straight lines straight under a keystone', () => {
    // The defining property of a homography, and the only reason perspective
    // needs a mat3 at all: an affine approximation would bow the verticals of a
    // building, which is exactly what the user opened the panel to fix.
    const m = geometryMatrix(geometry({ perspectiveV: 100 }))
    const mapped = [-0.5, -0.25, 0, 0.25, 0.5].map((y) => applyMat3(m, { x: 0.3, y }))

    // Collinear ⇒ every consecutive triple has zero cross product.
    for (let i = 2; i < mapped.length; i += 1) {
      const a = mapped[i - 2]
      const b = mapped[i - 1]
      const c = mapped[i]
      const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
      expect(cross).toBeCloseTo(0, 12)
    }
  })

  it('keeps w safely positive across the frame at full keystone', () => {
    // A homogeneous w that reaches zero tears the image apart (points behind
    // the camera). The slider range exists to make that unreachable, so assert
    // the bound rather than trusting the arithmetic.
    for (const p of framePoints()) {
      for (const g of [100, -100]) {
        const m = geometryMatrix(geometry({ perspectiveV: g, perspectiveH: g }))
        const w = m[2] * p.x + m[5] * p.y + m[8]
        expect(w).toBeGreaterThan(0.4)
      }
    }
  })

  it('scales the two axes differently, which is what makes it an aspect control', () => {
    const m = geometryMatrix(geometry({ scaleX: 50, scaleY: -50 }))

    expect(applyMat3(m, { x: 0.5, y: 0 }).x).toBeLessThan(0.5)
    expect(applyMat3(m, { x: 0, y: 0.5 }).y).toBeGreaterThan(0.5)
  })
})

describe('inverseGeometryMatrix', () => {
  it('is the exact identity when every slider is at zero', () => {
    expect(inverseGeometryMatrix(IDENTITY_GEOMETRY)).toEqual(IDENTITY_MAT3)
  })

  it('undoes geometryMatrix over the whole frame', () => {
    // The pointer path: a handle authored in image space has to come back to
    // the pixel it was grabbed at. If these two drift, overlays peel away from
    // their masks the moment a geometry slider moves.
    const cases: Geometry[] = [
      geometry({ perspectiveV: 70 }),
      geometry({ perspectiveH: -40 }),
      geometry({ scaleX: 60, scaleY: -30 }),
      geometry({ offsetX: 35, offsetY: -80 }),
      geometry({ perspectiveV: -55, perspectiveH: 25, scaleX: -20, scaleY: 45, offsetX: 30, offsetY: 15 }),
    ]

    for (const g of cases) {
      const forward = geometryMatrix(g)
      const back = inverseGeometryMatrix(g)
      for (const p of framePoints()) {
        const round = applyMat3(back, applyMat3(forward, p))
        expect(round.x).toBeCloseTo(p.x, 10)
        expect(round.y).toBeCloseTo(p.y, 10)
      }
    }
  })
})

describe('lensScale', () => {
  it('puts the corner at radius 1 whatever the image shape', () => {
    for (const [w, h] of [[6000, 4000], [4000, 6000], [1000, 1000]] as const) {
      const [sx, sy] = lensScale(w, h)
      // The corner of the image is uv = (1,1), i.e. an offset of (0.5, 0.5).
      const r = Math.hypot(0.5 * sx, 0.5 * sy)
      expect(r).toBeCloseTo(1, 12)
    }
  })

  it('makes the radius round on a non-square image', () => {
    // The trap this exists for: measuring the radius in raw UV would make it
    // anisotropic on a 3:2 frame, and the "correction" would come out oval.
    const [sx, sy] = lensScale(6000, 4000)
    // A point one image-half to the right and one image-half down is the corner
    // in both cases; equal pixel distances must give equal radii.
    const rightPixels = { x: 0.5, y: 0 }
    const downSameDistance = { x: 0, y: (0.5 * 6000) / 4000 }
    expect(Math.hypot(rightPixels.x * sx, rightPixels.y * sy)).toBeCloseTo(
      Math.hypot(downSameDistance.x * sx, downSameDistance.y * sy),
      12,
    )
  })
})

describe('distort / undistort', () => {
  const scale = lensScale(6000, 4000)

  it('is the exact identity at k1 = 0', () => {
    const uv = { x: 0.137, y: 0.891 }
    expect(distort(uv, 0, scale)).toEqual(uv)
    expect(undistort(uv, 0, scale)).toEqual(uv)
  })

  it('leaves the optical centre fixed', () => {
    const centre = distort({ x: 0.5, y: 0.5 }, 0.3, scale)
    expect(centre.x).toBeCloseTo(0.5, 12)
    expect(centre.y).toBeCloseTo(0.5, 12)
  })

  it('pushes samples outward for a positive k1 and inward for a negative one', () => {
    // Positive corrects barrel: it reads further out, dragging the picture in.
    expect(distort({ x: 0.9, y: 0.5 }, 0.3, scale).x).toBeGreaterThan(0.9)
    expect(distort({ x: 0.9, y: 0.5 }, -0.3, scale).x).toBeLessThan(0.9)
  })

  it('grows with the square of the radius, not linearly', () => {
    // A radial term that grew linearly would move the centre of the frame too,
    // which is not what a lens does.
    const near = distort({ x: 0.6, y: 0.5 }, 0.3, scale).x - 0.6
    const far = distort({ x: 0.7, y: 0.5 }, 0.3, scale).x - 0.7
    // Offsets of 0.1 and 0.2 from the centre: the displacement is d·k1·|q|², so
    // twice the distance is eight times the shift.
    expect(far / near).toBeCloseTo(8, 6)
  })

  it('round-trips through the numeric inverse across the frame', () => {
    // There is no closed-form inverse of a cubic worth writing, so the pointer
    // iterates. Assert it actually lands: on a 6000px image, 1e-6 in UV is a
    // hundredth of a pixel. k1 = −0.3 is the hard case — the cubic's turning
    // point is just past the corner, so Newton crawls before it sprints.
    for (const k1 of [-0.3, -0.12, 0.12, 0.3]) {
      for (const p of framePoints()) {
        const uv = { x: p.x + 0.5, y: p.y + 0.5 }
        const round = undistort(distort(uv, k1, scale), k1, scale)
        expect(round.x).toBeCloseTo(uv.x, 6)
        expect(round.y).toBeCloseTo(uv.y, 6)
      }
    }
  })
})

describe('lensK1', () => {
  it('maps the slider onto a range any real lens fits inside', () => {
    expect(lensK1(IDENTITY_GEOMETRY)).toBe(0)
    expect(lensK1(geometry({ distortion: 100 }))).toBeCloseTo(0.3, 12)
    expect(lensK1(geometry({ distortion: -100 }))).toBeCloseTo(-0.3, 12)
  })
})

describe('isIdentityGeometry', () => {
  it('is true only with every slider at zero', () => {
    expect(isIdentityGeometry(IDENTITY_GEOMETRY)).toBe(true)
    const keys: (keyof Geometry)[] = [
      'distortion', 'perspectiveV', 'perspectiveH', 'scaleX', 'scaleY', 'offsetX', 'offsetY',
    ]
    for (const key of keys) {
      expect(isIdentityGeometry(geometry({ [key]: 1 }))).toBe(false)
    }
  })
})

describe('geometryEquals', () => {
  it('compares by value, so a drag that ends where it began is no change', () => {
    expect(geometryEquals(IDENTITY_GEOMETRY, geometry())).toBe(true)
  })

  it('notices a change in any single slider', () => {
    const keys: (keyof Geometry)[] = [
      'distortion', 'perspectiveV', 'perspectiveH', 'scaleX', 'scaleY', 'offsetX', 'offsetY',
    ]
    for (const key of keys) {
      expect(geometryEquals(IDENTITY_GEOMETRY, geometry({ [key]: 3 }))).toBe(false)
    }
  })
})
