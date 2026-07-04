import { describe, expect, it } from 'vitest'
import type { CurvePoint, Curves } from './curves'
import { buildDefaultCurves } from './curves'
import {
  CURVE_TEXTURE_ROWS,
  clampToNeighbors,
  compileCurveTexture,
  compileLut,
  insertPoint,
  interpolateMonotone,
  removePoint,
  sortByX,
  svgToValueX,
  svgToValueY,
  valueToSvgX,
  valueToSvgY,
} from './curvesMath'

const IDENTITY: CurvePoint[] = [
  { x: 0, y: 0 },
  { x: 255, y: 255 },
]

describe('interpolateMonotone', () => {
  it('returns an evaluator honouring the node values', () => {
    const f = interpolateMonotone(IDENTITY)

    expect(f(0)).toBe(0)
    expect(f(255)).toBe(255)
    expect(f(128)).toBeCloseTo(128, 5)
  })

  it('collapses to a straight line when there are only two points', () => {
    const f = interpolateMonotone([
      { x: 0, y: 0 },
      { x: 100, y: 50 },
    ])

    expect(f(0)).toBeCloseTo(0, 5)
    expect(f(50)).toBeCloseTo(25, 5)
    expect(f(100)).toBeCloseTo(50, 5)
  })

  it('clamps inputs outside the point domain to the endpoints', () => {
    const f = interpolateMonotone(IDENTITY)

    expect(f(-10)).toBe(0)
    expect(f(300)).toBe(255)
  })

  it('passes through every interior node exactly', () => {
    const points: CurvePoint[] = [
      { x: 0, y: 0 },
      { x: 128, y: 200 },
      { x: 255, y: 255 },
    ]
    const f = interpolateMonotone(points)

    expect(f(128)).toBeCloseTo(200, 5)
  })
})

describe('compileLut', () => {
  it('produces a 256-entry integer identity LUT for the identity curve', () => {
    const lut = compileLut(IDENTITY)

    expect(lut).toHaveLength(256)
    for (let i = 0; i < 256; i++) {
      expect(lut[i]).toBe(i)
    }
  })

  it('keeps the LUT within 0..255 and monotonically non-decreasing', () => {
    const lut = compileLut([
      { x: 0, y: 0 },
      { x: 128, y: 200 },
      { x: 255, y: 255 },
    ])

    for (let i = 0; i < 256; i++) {
      expect(lut[i]).toBeGreaterThanOrEqual(0)
      expect(lut[i]).toBeLessThanOrEqual(255)
    }
    for (let i = 1; i < 256; i++) {
      expect(lut[i]).toBeGreaterThanOrEqual(lut[i - 1])
    }
  })

  it('never overshoots above a high interior node before its x', () => {
    // 0 -> 200 rising: monotone interpolation must stay within [0, 200]
    // up to x = 128 (a naive Catmull-Rom would overshoot past 200).
    const lut = compileLut([
      { x: 0, y: 0 },
      { x: 128, y: 200 },
      { x: 255, y: 255 },
    ])

    for (let i = 0; i <= 128; i++) {
      expect(lut[i]).toBeLessThanOrEqual(200)
    }
  })

  it('never under/overshoots outside the node range for a V shape', () => {
    // Down then up: every sample must stay inside the [0, 100] node band.
    const lut = compileLut([
      { x: 0, y: 100 },
      { x: 128, y: 0 },
      { x: 255, y: 100 },
    ])

    for (let i = 0; i < 256; i++) {
      expect(lut[i]).toBeGreaterThanOrEqual(0)
      expect(lut[i]).toBeLessThanOrEqual(100)
    }
  })
})

describe('compileCurveTexture', () => {
  it('packs an identity ramp for default curves (shader passthrough guardian)', () => {
    const data = compileCurveTexture(buildDefaultCurves())

    expect(data).toHaveLength(256 * CURVE_TEXTURE_ROWS.length)
    for (let row = 0; row < CURVE_TEXTURE_ROWS.length; row++) {
      for (let i = 0; i < 256; i++) {
        expect(data[row * 256 + i]).toBe(i)
      }
    }
  })

  it('writes each channel into its own row in CURVE_TEXTURE_ROWS order', () => {
    // Invert only the red channel; every other row must stay an identity ramp.
    const curves: Curves = { ...buildDefaultCurves(), red: [{ x: 0, y: 255 }, { x: 255, y: 0 }] }
    const data = compileCurveTexture(curves)
    const redRow = CURVE_TEXTURE_ROWS.indexOf('red')

    for (let i = 0; i < 256; i++) {
      expect(data[redRow * 256 + i]).toBe(255 - i)
    }
    for (let row = 0; row < CURVE_TEXTURE_ROWS.length; row++) {
      if (row === redRow) {
        continue
      }
      for (let i = 0; i < 256; i++) {
        expect(data[row * 256 + i]).toBe(i)
      }
    }
  })
})

describe('sortByX', () => {
  it('returns a new array sorted ascending by x', () => {
    const points: CurvePoint[] = [
      { x: 255, y: 255 },
      { x: 0, y: 0 },
      { x: 128, y: 64 },
    ]

    expect(sortByX(points)).toEqual([
      { x: 0, y: 0 },
      { x: 128, y: 64 },
      { x: 255, y: 255 },
    ])
  })

  it('does not mutate the input array', () => {
    const points: CurvePoint[] = [
      { x: 255, y: 255 },
      { x: 0, y: 0 },
    ]
    const snapshot = [...points]

    sortByX(points)

    expect(points).toEqual(snapshot)
  })
})

describe('insertPoint', () => {
  it('inserts a point keeping the array sorted by x', () => {
    const result = insertPoint(IDENTITY, { x: 128, y: 200 })

    expect(result).toEqual([
      { x: 0, y: 0 },
      { x: 128, y: 200 },
      { x: 255, y: 255 },
    ])
  })

  it('ignores a point whose x already exists', () => {
    const result = insertPoint(IDENTITY, { x: 0, y: 99 })

    expect(result).toEqual(IDENTITY)
  })

  it('does not mutate the input array', () => {
    const snapshot = IDENTITY.map((p) => ({ ...p }))

    insertPoint(IDENTITY, { x: 128, y: 200 })

    expect(IDENTITY).toEqual(snapshot)
  })
})

describe('clampToNeighbors', () => {
  const POINTS: CurvePoint[] = [
    { x: 0, y: 0 },
    { x: 100, y: 100 },
    { x: 255, y: 255 },
  ]

  it('locks the first point to x = 0 but lets y move', () => {
    const result = clampToNeighbors(POINTS, 0, { x: 50, y: 120 })

    expect(result[0]).toEqual({ x: 0, y: 120 })
  })

  it('locks the last point to x = 255 but lets y move', () => {
    const result = clampToNeighbors(POINTS, 2, { x: 50, y: 120 })

    expect(result[2]).toEqual({ x: 255, y: 120 })
  })

  it('clamps an interior x between its neighbours (with a 1px gap)', () => {
    expect(clampToNeighbors(POINTS, 1, { x: 400, y: 400 })[1]).toEqual({ x: 254, y: 255 })
    expect(clampToNeighbors(POINTS, 1, { x: -50, y: -50 })[1]).toEqual({ x: 1, y: 0 })
  })

  it('clamps y into 0..255', () => {
    expect(clampToNeighbors(POINTS, 1, { x: 100, y: 999 })[1].y).toBe(255)
    expect(clampToNeighbors(POINTS, 1, { x: 100, y: -999 })[1].y).toBe(0)
  })

  it('does not mutate the input array', () => {
    const snapshot = POINTS.map((p) => ({ ...p }))

    clampToNeighbors(POINTS, 1, { x: 400, y: 400 })

    expect(POINTS).toEqual(snapshot)
  })
})

describe('removePoint', () => {
  const POINTS: CurvePoint[] = [
    { x: 0, y: 0 },
    { x: 100, y: 100 },
    { x: 255, y: 255 },
  ]

  it('removes an interior point', () => {
    expect(removePoint(POINTS, 1)).toEqual([
      { x: 0, y: 0 },
      { x: 255, y: 255 },
    ])
  })

  it('refuses to remove the endpoints', () => {
    expect(removePoint(POINTS, 0)).toEqual(POINTS)
    expect(removePoint(POINTS, POINTS.length - 1)).toEqual(POINTS)
  })

  it('does not mutate the input array', () => {
    const snapshot = POINTS.map((p) => ({ ...p }))

    removePoint(POINTS, 1)

    expect(POINTS).toEqual(snapshot)
  })
})

describe('coordinate mapping', () => {
  const SIZE = 400

  it('maps values to SVG x without flipping', () => {
    expect(valueToSvgX(0, SIZE)).toBe(0)
    expect(valueToSvgX(255, SIZE)).toBe(SIZE)
    expect(valueToSvgX(127.5, SIZE)).toBeCloseTo(SIZE / 2, 5)
  })

  it('maps values to SVG y with a flip (255 at the top)', () => {
    expect(valueToSvgY(255, SIZE)).toBe(0)
    expect(valueToSvgY(0, SIZE)).toBe(SIZE)
    expect(valueToSvgY(127.5, SIZE)).toBeCloseTo(SIZE / 2, 5)
  })

  it('inverts x mapping and clamps to 0..255', () => {
    expect(svgToValueX(0, SIZE)).toBeCloseTo(0, 5)
    expect(svgToValueX(SIZE, SIZE)).toBeCloseTo(255, 5)
    expect(svgToValueX(-40, SIZE)).toBe(0)
    expect(svgToValueX(SIZE + 40, SIZE)).toBe(255)
  })

  it('inverts y mapping (flipped) and clamps to 0..255', () => {
    expect(svgToValueY(0, SIZE)).toBeCloseTo(255, 5)
    expect(svgToValueY(SIZE, SIZE)).toBeCloseTo(0, 5)
    expect(svgToValueY(-40, SIZE)).toBe(255)
    expect(svgToValueY(SIZE + 40, SIZE)).toBe(0)
  })

  it('round-trips a value through x and y mappings', () => {
    expect(svgToValueX(valueToSvgX(200, SIZE), SIZE)).toBeCloseTo(200, 5)
    expect(svgToValueY(valueToSvgY(200, SIZE), SIZE)).toBeCloseTo(200, 5)
  })
})
