import { describe, expect, it } from 'vitest'
import {
  computeHistogram,
  HISTOGRAM_BINS,
  histogramStride,
} from './histogram'

/**
 * Builds an RGBA buffer from a per-pixel luma callback (achromatic: r = g = b).
 */
function buildBuffer(
  width: number,
  height: number,
  luma: (x: number, y: number) => number,
): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const value = luma(x, y)
      const i = (y * width + x) * 4
      rgba[i] = value
      rgba[i + 1] = value
      rgba[i + 2] = value
      rgba[i + 3] = 255
    }
  }
  return rgba
}

describe('histogramStride', () => {
  it('samples every pixel while the frame stays under the cap', () => {
    // 100×100 = 10 000 pixels, far below the 16M cap → full pass.
    expect(histogramStride(100, 100)).toBe(1)
  })

  it('spreads the samples once the cap would be exceeded', () => {
    // 8192² ≈ 67M pixels, ~4× the cap → one in two each axis.
    expect(histogramStride(8192, 8192)).toBe(2)
  })

  it('grows the stride to keep huge frames bounded', () => {
    expect(histogramStride(16000, 16000)).toBe(4)
  })
})

describe('computeHistogram', () => {
  it('measures the percentiles of a linear ramp', () => {
    // One pixel per luma level, 0..255. The histogram's float luma (a weighted
    // sum of the three channels) scatters each level by a hair across its
    // nearest bins, so the readings land within one bin (≈0.004) of the ideal
    // straight line — close enough to pin the interpolation convention.
    const histogram = computeHistogram(buildBuffer(256, 1, (x) => x), 256, 1)
    expect(histogram).not.toBeNull()
    expect(histogram?.p0_1).toBeCloseTo(0.001, 2)
    expect(histogram?.p10).toBeCloseTo(0.1, 2)
    expect(histogram?.p50).toBeCloseTo(0.5, 2)
    expect(histogram?.p90).toBeCloseTo(0.9, 2)
    expect(histogram?.p99_9).toBeCloseTo(0.999, 2)
  })

  it('reports every percentile inside the single bin of a uniform field', () => {
    const histogram = computeHistogram(buildBuffer(16, 16, () => 200), 16, 16)
    expect(histogram).not.toBeNull()
    // All five read the same occupied bin; only the interpolation inside it
    // differs, so they agree once rounded back to a luma level.
    const bin = Math.floor((histogram?.p50 ?? 0) * 255)
    for (const percentile of [histogram?.p0_1 ?? 0, histogram?.p10 ?? 0, histogram?.p90 ?? 0, histogram?.p99_9 ?? 0]) {
      expect(Math.floor(percentile * 255)).toBe(bin)
    }
    expect(histogram?.p50).toBeCloseTo(200 / 255, 2)
  })

  it('fills every one of the 256 bins', () => {
    const histogram = computeHistogram(buildBuffer(16, 16, (x, y) => (x + y * 16) % 256), 16, 16)
    expect(histogram?.bins).toHaveLength(HISTOGRAM_BINS)
    expect(histogram?.total).toBe(256)
  })

  it('returns null for an empty frame', () => {
    expect(computeHistogram(new Uint8ClampedArray(0), 0, 0)).toBeNull()
  })

  it('returns null when the buffer does not match the dimensions', () => {
    // 5×5 needs 100 bytes; hand it 10.
    expect(computeHistogram(new Uint8ClampedArray(10), 5, 5)).toBeNull()
  })
})
