import { describe, expect, it } from 'vitest'
import {
  estimateNoise,
  fillCurveGaps,
  lumaBinIndex,
  mergeNoiseEstimates,
  NOISE_LUMA_BINS,
  NOISE_PERCENTILE,
  NOISE_WINDOW,
  smoothCurve,
  type NoiseEstimate,
} from './noiseEstimate'

/**
 * A tiny seeded PRNG so the "noise" in these tests is exactly reproducible:
 * the estimator is statistical, and a flaky random seed could turn a passing
 * assertion into an intermittent failure.
 */
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Standard normal via Box–Muller over the seeded uniforms. */
function nextGaussian(random: () => number): number {
  const u1 = Math.max(random(), 1e-12)
  const u2 = random()
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

/** Builds an RGBA buffer from a per-pixel RGB callback. */
function buildBuffer(
  width: number,
  height: number,
  fill: (x: number, y: number) => [red: number, green: number, blue: number],
): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [red, green, blue] = fill(x, y)
      const i = (y * width + x) * 4
      rgba[i] = red
      rgba[i + 1] = green
      rgba[i + 2] = blue
      rgba[i + 3] = 255
    }
  }
  return rgba
}

/** A uniform mid-grey field: every window's variance is exactly 0. */
function flatGray(width: number, height: number, gray = 128): Uint8ClampedArray {
  return buildBuffer(width, height, () => [gray, gray, gray])
}

/**
 * Achromatic noise: every channel moves by the same amount, so all the noise is
 * luminance and the chroma opponents stay exactly at 0.
 */
function noisyGray(width: number, height: number, sigma: number, random: () => number): Uint8ClampedArray {
  return buildBuffer(width, height, () => {
    const n = Math.round(sigma * nextGaussian(random))
    const clamped = 128 + n
    return [clamped, clamped, clamped]
  })
}

/**
 * Chroma-only noise: red and blue move in luma-cancelling amounts (Cb gets the
 * blue swing, Cr the red swing) while luma stays exactly 128. The expected
 * chroma magnitude is `sqrt(((0.2126/0.0722)^2 + 1)/2) * sigma ≈ 2.2σ`.
 */
function noisyChroma(width: number, height: number, sigma: number, random: () => number): Uint8ClampedArray {
  const blueGain = 0.2126 / 0.0722
  return buildBuffer(width, height, () => {
    const n = Math.round(sigma * nextGaussian(random))
    return [128 + n, 128, 128 - Math.round(blueGain * n)]
  })
}

const SIZE = 128
const SIGMA = 12.8

describe('estimateNoise', () => {
  it('returns null for a frame smaller than one window', () => {
    expect(estimateNoise(flatGray(4, 4), 4, 4)).toBeNull()
    expect(estimateNoise(flatGray(10, 10), 10, 10)).toBeNull()
  })

  it('returns null when the buffer does not match the dimensions', () => {
    expect(estimateNoise(flatGray(SIZE, SIZE), SIZE, SIZE + 1)).toBeNull()
    expect(estimateNoise(new Uint8ClampedArray(16), 2, 2)).toBeNull()
  })

  it('reads a perfectly flat image as zero noise', () => {
    const estimate = estimateNoise(flatGray(SIZE, SIZE), SIZE, SIZE)
    expect(estimate?.lumaSigma).toBe(0)
    expect(estimate?.chromaSigma).toBe(0)
  })

  it('recovers the injected luminance noise σ', () => {
    const estimate = estimateNoise(noisyGray(SIZE, SIZE, SIGMA, mulberry32(1)), SIZE, SIZE)
    // The window sample-σ estimates the injected σ (Bessel factor ~0.94, and
    // the low percentile sits just above it), so a generous band around σ.
    expect(estimate?.lumaSigma).toBeGreaterThan((0.7 * SIGMA) / 255)
    expect(estimate?.lumaSigma).toBeLessThan((1.3 * SIGMA) / 255)
    // Achromatic noise cannot move Cb or Cr: the chroma reading must stay ~0.
    expect(estimate?.chromaSigma).toBeLessThan(0.002)
  })

  it('separates chroma noise from luma noise', () => {
    const estimate = estimateNoise(noisyChroma(SIZE, SIZE, SIGMA, mulberry32(2)), SIZE, SIZE)
    const expected = (Math.sqrt(((0.2126 / 0.0722) ** 2 + 1) / 2) * SIGMA) / 255
    expect(estimate?.chromaSigma).toBeGreaterThan(0.8 * expected)
    expect(estimate?.chromaSigma).toBeLessThan(1.3 * expected)
    expect(estimate?.lumaSigma).toBeLessThan(0.01)
  })

  it('ignores edges: only the flat half of the image counts', () => {
    // Left half hard black, right half hard white — real edges everywhere along
    // the seam, zero variance anywhere else. The low percentile must pick 0.
    const estimate = estimateNoise(buildBuffer(SIZE, SIZE, (x) => (x < SIZE / 2 ? [0, 0, 0] : [255, 255, 255])), SIZE, SIZE)
    expect(estimate?.lumaSigma).toBe(0)
  })

  it('reports the quiet half of a half-noisy image', () => {
    // Top half clean, bottom half genuinely noisy: the flattest quarter lives
    // in the clean half, so the reading must reflect the noise floor, not the
    // noisy region.
    const random = mulberry32(3)
    const estimate = estimateNoise(
      buildBuffer(SIZE, SIZE, (_x, y) => {
        if (y < SIZE / 2) return [128, 128, 128]
        const n = Math.round((SIGMA * 2) * nextGaussian(random))
        const clamped = 128 + n
        return [clamped, clamped, clamped]
      }),
      SIZE,
      SIZE,
    )
    expect(estimate?.lumaSigma).toBeLessThan(0.01)
  })

  it('is deterministic: the same pixels give the same numbers', () => {
    const rgba = noisyGray(SIZE, SIZE, SIGMA, mulberry32(4))
    expect(estimateNoise(rgba, SIZE, SIZE)).toEqual(estimateNoise(rgba, SIZE, SIZE))
  })
})

describe('lumaBinIndex', () => {
  it('spreads 0..1 over the bands and clamps outside it', () => {
    expect(lumaBinIndex(0)).toBe(0)
    expect(lumaBinIndex(0.125)).toBe(1)
    expect(lumaBinIndex(0.999)).toBe(NOISE_LUMA_BINS - 1)
    expect(lumaBinIndex(1)).toBe(NOISE_LUMA_BINS - 1)
    expect(lumaBinIndex(4)).toBe(NOISE_LUMA_BINS - 1)
    expect(lumaBinIndex(-1)).toBe(0)
    expect(lumaBinIndex(Number.NaN)).toBe(0)
  })
})

describe('fillCurveGaps', () => {
  it('gives up when nothing at all was measured', () => {
    expect(fillCurveGaps([null, null, null])).toBeNull()
    expect(fillCurveGaps([])).toEqual([])
  })

  it('holds the nearest measured band on both sides', () => {
    // Leading gaps have nothing to the left, so they take from the right.
    expect(fillCurveGaps([null, null, 3, null, 5, null])).toEqual([3, 3, 3, 3, 5, 5])
  })

  it('spreads a single measurement over the whole curve', () => {
    expect(fillCurveGaps([null, 2, null])).toEqual([2, 2, 2])
  })
})

describe('smoothCurve', () => {
  it('leaves a flat curve alone', () => {
    expect(smoothCurve([2, 2, 2, 2])).toEqual([2, 2, 2, 2])
  })

  it('spreads a spike into its neighbours without moving the total', () => {
    expect(smoothCurve([0, 0, 4, 0, 0])).toEqual([0, 1, 2, 1, 0])
  })

  it('clamps at the ends rather than pulling them toward zero', () => {
    // The first entry's missing left neighbour is itself, so a curve that only
    // rises does not get a false dip at the edge.
    expect(smoothCurve([4, 4, 0])).toEqual([4, 3, 1])
  })
})

describe('estimateNoise brightness curve', () => {
  it('reports no shape for a frame with no noise to shape', () => {
    expect(estimateNoise(flatGray(SIZE, SIZE), SIZE, SIZE)?.lumaShape).toBeUndefined()
  })

  it('reports no shape when a small frame spreads its windows too thin', () => {
    // Enough windows overall to estimate the σs, but a brightness ramp scatters
    // them so no single band clears its own minimum — so there is a noise
    // reading and no curve, and the two answers are independent.
    const random = mulberry32(7)
    const small = 12
    const rgba = buildBuffer(small, small, (x) => {
      const value = Math.round((255 * x) / (small - 1) + 4 * nextGaussian(random))
      return [value, value, value]
    })
    const estimate = estimateNoise(rgba, small, small)
    expect(estimate).not.toBeNull()
    expect(estimate?.lumaShape).toBeUndefined()
  })

  it('reads uniform noise at one brightness as a flat curve', () => {
    const shape = estimateNoise(noisyGray(SIZE, SIZE, SIGMA, mulberry32(5)), SIZE, SIZE)?.lumaShape
    expect(shape).toHaveLength(NOISE_LUMA_BINS)
    // Only the bands around 128 are measured; the rest are held from them, so
    // every entry should land on the normalisation's own mean of 1.
    for (const value of shape ?? []) {
      expect(value).toBeGreaterThan(0.85)
      expect(value).toBeLessThan(1.2)
    }
  })

  it('finds noise that is worse in the shadows than in the highlights', () => {
    // A gentle horizontal ramp from dark to bright, with the noise falling as
    // the brightness rises — the shape a gamma-encoded sensor actually has. The
    // ramp is slow enough (1.5 per pixel) that its own contribution to a 5-px
    // window is under one level, so what the bands see is the injected noise.
    const random = mulberry32(6)
    const rgba = buildBuffer(SIZE, SIZE, (x) => {
      const base = 48 + 1.5 * x
      const sigma = 12 - (11 * x) / (SIZE - 1)
      const value = Math.round(base + sigma * nextGaussian(random))
      return [value, value, value]
    })
    const shape = estimateNoise(rgba, SIZE, SIZE)?.lumaShape
    expect(shape).toHaveLength(NOISE_LUMA_BINS)
    const dark = shape?.[1] ?? 0
    const bright = shape?.[NOISE_LUMA_BINS - 1] ?? 0
    expect(dark).toBeGreaterThan(2 * bright)
    // Normalised, so it says nothing about the overall dose: the curve has to
    // straddle 1 rather than sit above or below it.
    expect(Math.min(...(shape ?? []))).toBeLessThan(1)
    expect(Math.max(...(shape ?? []))).toBeGreaterThan(1)
  })
})

describe('mergeNoiseEstimates', () => {
  const estimate = (lumaSigma: number, chromaSigma: number): NoiseEstimate => ({ lumaSigma, chromaSigma })
  const shaped = (lumaSigma: number, lumaShape: number[]): NoiseEstimate => ({
    lumaSigma,
    chromaSigma: 0.01,
    lumaShape,
  })
  const curve = (value: number): number[] => Array.from({ length: NOISE_LUMA_BINS }, () => value)

  it('returns null for nothing to combine', () => {
    expect(mergeNoiseEstimates([])).toBeNull()
    expect(mergeNoiseEstimates([null, null])).toBeNull()
    expect(mergeNoiseEstimates([estimate(Number.NaN, 0.01)])).toBeNull()
  })

  it('drops null and non-finite tiles', () => {
    const merged = mergeNoiseEstimates([null, estimate(0.01, 0.02), estimate(0.03, 0.04)])
    expect(merged).toEqual(estimate(0.03, 0.04))
  })

  it('passes a single estimate through', () => {
    expect(mergeNoiseEstimates([estimate(0.02, 0.04)])).toEqual(estimate(0.02, 0.04))
  })

  it('combines by median, so one noisy tile cannot drag the rest up', () => {
    // Three clean tiles and one foliage tile: the median stays on the clean
    // side, which is the whole point of the merge.
    const merged = mergeNoiseEstimates([
      estimate(0.01, 0.02),
      estimate(0.02, 0.03),
      estimate(0.06, 0.09),
      estimate(0.015, 0.025),
    ])
    expect(merged?.lumaSigma).toBeLessThan(0.03)
    expect(merged?.chromaSigma).toBeLessThan(0.04)
  })

  it('leaves the shape off when no tile measured one', () => {
    expect(mergeNoiseEstimates([estimate(0.02, 0.04)])?.lumaShape).toBeUndefined()
  })

  it('takes the shape band by band, so one odd tile cannot bend the curve', () => {
    const merged = mergeNoiseEstimates([
      shaped(0.02, curve(1)),
      shaped(0.02, curve(9)),
      shaped(0.02, curve(1.2)),
    ])
    expect(merged?.lumaShape).toEqual(curve(1.2))
  })

  it('only counts the tiles that have a shape, and only well-formed ones', () => {
    const merged = mergeNoiseEstimates([
      estimate(0.02, 0.04),
      shaped(0.02, [1, 2]),
      shaped(0.02, curve(3)),
    ])
    expect(merged?.lumaShape).toEqual(curve(3))
  })
})

describe('estimator calibration', () => {
  it('keeps the window and percentile sane for the filter it feeds', () => {
    // The window has to fit real sensor noise (σ~1-3% of range), and the
    // percentile has to pick the flattest quarter, not the flattest point.
    expect(NOISE_WINDOW).toBeGreaterThanOrEqual(3)
    expect(NOISE_WINDOW % 2).toBe(1)
    expect(NOISE_PERCENTILE).toBeGreaterThan(0.1)
    expect(NOISE_PERCENTILE).toBeLessThan(0.5)
  })
})
