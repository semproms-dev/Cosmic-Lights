import { describe, expect, it } from 'vitest'
import { createCircleAlpha } from './syntheticAlpha'

/** Reads the weight at a pixel of a row-major, one-byte-per-pixel map. */
function weightAt(alpha: ReturnType<typeof createCircleAlpha>, x: number, y: number): number {
  return alpha.data[y * alpha.width + x]
}

describe('createCircleAlpha', () => {
  it('returns one byte per pixel at the requested size', () => {
    const alpha = createCircleAlpha(64, 32)
    expect(alpha.width).toBe(64)
    expect(alpha.height).toBe(32)
    expect(alpha.data.length).toBe(64 * 32)
  })

  it('fills the middle of the circle and leaves the corners empty', () => {
    const alpha = createCircleAlpha(100, 100)
    // The circle is centred horizontally and at 40% of the height.
    expect(weightAt(alpha, 50, 40)).toBe(255)
    expect(weightAt(alpha, 0, 0)).toBe(0)
    expect(weightAt(alpha, 99, 99)).toBe(0)
  })

  it('sits above the vertical centre, so a Y-flip is visible', () => {
    const alpha = createCircleAlpha(100, 100)
    // y=20 and y=79 mirror each other about the midline. The circle (centred at
    // y=40, radius 25) covers only the upper one, so flipping it would swap
    // these two readings — which is exactly what makes the bug visible.
    expect(weightAt(alpha, 50, 20)).toBe(255)
    expect(weightAt(alpha, 50, 79)).toBe(0)
  })

  it('feathers the edge instead of cutting it hard', () => {
    const alpha = createCircleAlpha(200, 200)
    // Radius is 0.25*200 = 50, centred at (100, 80): the rim sits at y ≈ 30.
    const rim = weightAt(alpha, 100, 30)
    expect(rim).toBeGreaterThan(0)
    expect(rim).toBeLessThan(255)
  })

  it('stays within the 0..255 range everywhere', () => {
    const alpha = createCircleAlpha(50, 50)
    for (const weight of alpha.data) {
      expect(weight).toBeGreaterThanOrEqual(0)
      expect(weight).toBeLessThanOrEqual(255)
    }
  })
})
