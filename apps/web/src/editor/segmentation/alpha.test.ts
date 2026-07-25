import { describe, expect, it } from 'vitest'
import {
  MAX_INFERENCE_SIZE,
  bestMaskIndex,
  chooseMaskIndex,
  extractAlphaChannel,
  fitWithin,
  maskPixelCounts,
  maskToAlpha,
  type ChannelImage,
} from './alpha'

describe('fitWithin', () => {
  it('leaves an image that already fits untouched', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 })
  })

  it('does not upscale a small image', () => {
    expect(fitWithin(64, 32)).toEqual({ width: 64, height: 32 })
  })

  it('scales a landscape image down to the limit on its longest edge', () => {
    expect(fitWithin(6000, 4000)).toEqual({ width: MAX_INFERENCE_SIZE, height: 683 })
  })

  it('scales a portrait image down to the limit on its longest edge', () => {
    expect(fitWithin(4000, 6000)).toEqual({ width: 683, height: MAX_INFERENCE_SIZE })
  })

  it('preserves the aspect ratio within a pixel', () => {
    const { width, height } = fitWithin(3000, 2000)
    expect(width / height).toBeCloseTo(1.5, 2)
  })

  it('honours a custom limit', () => {
    expect(fitWithin(1000, 500, 100)).toEqual({ width: 100, height: 50 })
  })

  it('never returns a zero-sized edge for extreme aspect ratios', () => {
    const { width, height } = fitWithin(10000, 3, 1024)
    expect(width).toBe(1024)
    expect(height).toBe(1)
  })
})

describe('extractAlphaChannel', () => {
  it('takes the alpha channel of an RGBA image', () => {
    // 2×1 px: an opaque red pixel and a fully transparent one.
    const image: ChannelImage = {
      data: new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 0]),
      width: 2,
      height: 1,
      channels: 4,
    }
    const alpha = extractAlphaChannel(image)
    expect(Array.from(alpha.data)).toEqual([255, 0])
    expect(alpha.width).toBe(2)
    expect(alpha.height).toBe(1)
  })

  it('preserves partial weights instead of thresholding them', () => {
    const image: ChannelImage = {
      data: new Uint8ClampedArray([0, 0, 0, 128, 0, 0, 0, 64]),
      width: 2,
      height: 1,
      channels: 4,
    }
    expect(Array.from(extractAlphaChannel(image).data)).toEqual([128, 64])
  })

  it('uses the only channel of a single-channel mask', () => {
    const image: ChannelImage = {
      data: new Uint8Array([10, 20, 30, 40]),
      width: 2,
      height: 2,
      channels: 1,
    }
    expect(Array.from(extractAlphaChannel(image).data)).toEqual([10, 20, 30, 40])
  })

  it('takes the alpha channel of a grey+alpha image', () => {
    const image: ChannelImage = {
      data: new Uint8Array([99, 1, 99, 2]),
      width: 2,
      height: 1,
      channels: 2,
    }
    expect(Array.from(extractAlphaChannel(image).data)).toEqual([1, 2])
  })

  it('returns a Uint8Array of exactly one byte per pixel', () => {
    const image: ChannelImage = {
      data: new Uint8ClampedArray(4 * 4 * 4),
      width: 4,
      height: 4,
      channels: 4,
    }
    const alpha = extractAlphaChannel(image)
    expect(alpha.data).toBeInstanceOf(Uint8Array)
    expect(alpha.data.length).toBe(16)
  })

  it('rejects an RGB image, which carries no weight to extract', () => {
    const image: ChannelImage = {
      data: new Uint8Array([1, 2, 3]),
      width: 1,
      height: 1,
      channels: 3,
    }
    expect(() => extractAlphaChannel(image)).toThrow(/3-channel/)
  })

  it('rejects data shorter than the declared size', () => {
    const image: ChannelImage = {
      data: new Uint8Array([1, 2, 3, 4]),
      width: 10,
      height: 10,
      channels: 4,
    }
    expect(() => extractAlphaChannel(image)).toThrow(/too short/)
  })
})

describe('bestMaskIndex', () => {
  it('picks the highest-scoring candidate', () => {
    expect(bestMaskIndex([0.11, 0.93, 0.42])).toBe(1)
  })

  it('keeps the first on a tie (stable)', () => {
    expect(bestMaskIndex([0.5, 0.5, 0.5])).toBe(0)
  })

  it('reads a Float32Array (SAM returns a typed array)', () => {
    expect(bestMaskIndex(new Float32Array([0.2, 0.1, 0.8]))).toBe(2)
  })

  it('returns 0 for an empty list', () => {
    expect(bestMaskIndex([])).toBe(0)
  })
})

describe('maskToAlpha', () => {
  it('maps a boolean mask to 0/255 at its own resolution', () => {
    const mask = new Uint8Array([1, 0, 0, 1])
    const alpha = maskToAlpha(mask, 0, 2, 2)
    expect(alpha).toEqual({ data: new Uint8Array([255, 0, 0, 255]), width: 2, height: 2 })
    expect(alpha.data).toBeInstanceOf(Uint8Array)
  })

  it('selects the requested candidate from a packed buffer', () => {
    // Two 2x2 masks packed back-to-back: [mask0 | mask1].
    const packed = new Uint8Array([0, 0, 0, 0, 1, 1, 1, 1])
    expect(maskToAlpha(packed, 1, 2, 2).data).toEqual(new Uint8Array([255, 255, 255, 255]))
  })

  it('treats any non-zero value as selected', () => {
    expect(maskToAlpha(new Uint8Array([2, 0]), 0, 2, 1).data).toEqual(new Uint8Array([255, 0]))
  })

  it('throws when the buffer is too short for the requested candidate', () => {
    expect(() => maskToAlpha(new Uint8Array([1, 0, 0, 1]), 1, 2, 2)).toThrow(/too short/)
  })
})

describe('maskPixelCounts', () => {
  it('counts the set pixels of each candidate', () => {
    // Two 2x2 masks: the first covers one pixel, the second all four.
    const packed = new Uint8Array([1, 0, 0, 0, 1, 1, 1, 1])
    expect(maskPixelCounts(packed, 2, 4)).toEqual([1, 4])
  })

  it('counts any non-zero value as covered', () => {
    expect(maskPixelCounts(new Uint8Array([3, 0]), 1, 2)).toEqual([1])
  })
})

describe('chooseMaskIndex', () => {
  it('keeps the eye the user clicked instead of the face around it', () => {
    // Real numbers from a click on an eye (2026-07-26): the face outscores the
    // eye by 0.089 — both are valid readings of the same click, so the smaller
    // one wins. This is the case the whole heuristic exists for.
    const scores = [0.863, 0.874, 0.785]
    const pixels = [129_000, 18_000, 400]
    expect(chooseMaskIndex(scores, pixels, true)).toBe(2)
  })

  it('still trusts a clearly better score over a smaller mask', () => {
    const scores = [0.4, 0.5, 0.95]
    const pixels = [500, 20_000, 300_000]
    expect(chooseMaskIndex(scores, pixels, true)).toBe(2)
  })

  it('rejects the near-empty candidate SAM sometimes returns', () => {
    // Picking it would leave the user with nothing selected, which reads as a
    // broken tool — worse than returning something too big.
    const scores = [0.95, 0.94]
    const pixels = [12, 20_000]
    expect(chooseMaskIndex(scores, pixels, true)).toBe(1)
  })

  it('leaves an unambiguous prompt on the highest score', () => {
    // Several points or a box: the user has already said what they want, and
    // shrinking the answer would fight them.
    const scores = [0.863, 0.874, 0.785]
    const pixels = [129_000, 18_000, 400]
    expect(chooseMaskIndex(scores, pixels, false)).toBe(1)
  })

  it('falls back to the best score when every candidate is near-empty', () => {
    expect(chooseMaskIndex([0.9, 0.95], [3, 8], true)).toBe(1)
  })
})

describe('chooseMaskIndex with an explicit granularity', () => {
  // Real candidates from a click on an eye (2026-07-26): face+hair, face, eye.
  const scores = [0.830, 0.874, 0.717]
  const pixels = [105_061, 18_081, 255]

  it('gives the whole thing when asked for it, however sure the model is', () => {
    expect(chooseMaskIndex(scores, pixels, true, 'whole')).toBe(0)
  })

  it('gives the middle reading for "part"', () => {
    expect(chooseMaskIndex(scores, pixels, true, 'part')).toBe(1)
  })

  it('gives the eye for "detail", which no score-based rule would pick', () => {
    // 0.717 against the face's 0.874 — far outside any sane confidence margin.
    expect(chooseMaskIndex(scores, pixels, true, 'detail')).toBe(2)
  })

  it('ranks by size rather than trusting the model output order', () => {
    expect(chooseMaskIndex([0.5, 0.5, 0.5], [255, 105_061, 18_081], true, 'whole')).toBe(1)
    expect(chooseMaskIndex([0.5, 0.5, 0.5], [255, 105_061, 18_081], true, 'detail')).toBe(0)
  })

  it('overrides the guess even for an unambiguous prompt', () => {
    expect(chooseMaskIndex(scores, pixels, false, 'detail')).toBe(2)
  })

  it('clamps "part" when only one candidate is usable', () => {
    expect(chooseMaskIndex([0.9, 0.8], [5_000, 3], true, 'part')).toBe(0)
  })

  it('falls back to the confident pick when every candidate is near-empty', () => {
    expect(chooseMaskIndex([0.9, 0.95], [3, 8], true, 'detail')).toBe(1)
  })
})
