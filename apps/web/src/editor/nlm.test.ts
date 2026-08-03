import { describe, expect, it } from 'vitest'
import {
  NLM_H,
  NLM_PATCH_PIXELS,
  NLM_PATCH_RADIUS,
  NLM_FRAGMENT_BUDGET,
  NLM_PYRAMID_LEVELS,
  NLM_PYRAMID_SIGMA_SCALE,
  NLM_SEARCH_RADIUS,
  nlmChunkSize,
  nlmLevelSigma,
  nlmOffsets,
  nlmParams,
} from './nlm'
import { NOISE_SIGMA_OVERLAP, denoiseParams } from './noise'

/** The three sliders at rest, so each test only states what it changes. */
const REST = { colorNoise: 0, luminanceNoise: 0, luminanceDetail: 0 }

describe('nlmOffsets', () => {
  it('covers the whole square window, centre included', () => {
    expect(nlmOffsets(1)).toHaveLength(9)
    expect(nlmOffsets(3)).toHaveLength(49)
    expect(nlmOffsets(1)).toContainEqual({ dx: 0, dy: 0 })
  })

  it('is symmetric: every offset has its opposite', () => {
    const offsets = nlmOffsets(3)
    for (const { dx, dy } of offsets) {
      expect(offsets).toContainEqual({ dx: dx === 0 ? 0 : -dx, dy: dy === 0 ? 0 : -dy })
    }
  })

  it('never leaves the requested radius', () => {
    for (const { dx, dy } of nlmOffsets(2)) {
      expect(Math.abs(dx)).toBeLessThanOrEqual(2)
      expect(Math.abs(dy)).toBeLessThanOrEqual(2)
    }
  })

  it('degenerates to the centre alone rather than to nothing', () => {
    // An empty list would divide by a zero weight in the resolve pass; the
    // centre on its own is simply an identity filter, which is a safe floor.
    expect(nlmOffsets(0)).toEqual([{ dx: 0, dy: 0 }])
    expect(nlmOffsets(-4)).toEqual([{ dx: 0, dy: 0 }])
    expect(nlmOffsets(Number.NaN)).toEqual([{ dx: 0, dy: 0 }])
  })

  it('is deterministic, which is what makes a render reproducible', () => {
    // The accumulation is floating point, so a different visiting order would
    // give bit-different pixels.
    expect(nlmOffsets(2)).toEqual(nlmOffsets(2))
    expect(nlmOffsets(1)[0]).toEqual({ dx: -1, dy: -1 })
  })
})

describe('nlmParams', () => {
  it('is off when the luminance half of the denoise is off', () => {
    expect(nlmParams(denoiseParams(REST)).enabled).toBe(false)
    expect(nlmParams(denoiseParams({ ...REST, colorNoise: 80 })).enabled).toBe(false)
  })

  it('is on as soon as there is luminance work to do', () => {
    expect(nlmParams(denoiseParams({ ...REST, luminanceNoise: 40 })).enabled).toBe(true)
  })

  it('stays off when detail hands the original luminance straight back', () => {
    // Same rule the bilateral follows: at detail 100 the filtered result is
    // discarded, so computing it is pure cost.
    const params = denoiseParams({ colorNoise: 0, luminanceNoise: 80, luminanceDetail: 100 })
    expect(nlmParams(params).enabled).toBe(false)
  })

  it('recovers the noise sigma the slider implies', () => {
    // The bilateral's range term spans NOISE_SIGMA_OVERLAP sigmas, so undoing
    // that factor is what makes both filters agree about how noisy the photo is.
    const params = denoiseParams({ ...REST, luminanceNoise: 60 })
    expect(nlmParams(params).sigma).toBeCloseTo(params.lumaSigmaRange / NOISE_SIGMA_OVERLAP, 10)
  })

  it('grows the sigma with the slider, and only with the slider', () => {
    const gentle = nlmParams(denoiseParams({ ...REST, luminanceNoise: 20 }))
    const strong = nlmParams(denoiseParams({ ...REST, luminanceNoise: 90 }))
    expect(strong.sigma).toBeGreaterThan(gentle.sigma)
    // Chroma is a different filter entirely and must not move the luma sigma.
    const withColour = nlmParams(denoiseParams({ colorNoise: 100, luminanceNoise: 20, luminanceDetail: 0 }))
    expect(withColour.sigma).toBe(gentle.sigma)
  })

  it('passes the detail mix through unchanged', () => {
    const params = denoiseParams({ colorNoise: 0, luminanceNoise: 50, luminanceDetail: 25 })
    expect(nlmParams(params).detail).toBeCloseTo(0.25, 10)
  })

  it('never emits a non-finite uniform, whatever the sliders say', () => {
    // A NaN sigma makes every weight NaN and paints the frame black.
    const params = denoiseParams({
      colorNoise: Number.NaN,
      luminanceNoise: Number.POSITIVE_INFINITY,
      luminanceDetail: Number.NaN,
    })
    const nlm = nlmParams(params)
    expect(Number.isFinite(nlm.sigma)).toBe(true)
    expect(Number.isFinite(nlm.h)).toBe(true)
    expect(Number.isFinite(nlm.detail)).toBe(true)
  })
})

describe('nlm calibration', () => {
  it('keeps the patch small enough to describe one thing', () => {
    // A wide patch contains a bit of everything, every patch starts looking
    // alike, and the filter collapses into a plain blur.
    expect(NLM_PATCH_RADIUS).toBeGreaterThanOrEqual(1)
    expect(NLM_PATCH_RADIUS).toBeLessThanOrEqual(2)
    expect(NLM_PATCH_PIXELS).toBe((2 * NLM_PATCH_RADIUS + 1) ** 2)
  })

  it('searches wider than it compares', () => {
    // A search no bigger than the patch has nowhere non-local to look, which
    // would leave an expensive filter doing a bilateral's job.
    expect(NLM_SEARCH_RADIUS).toBeGreaterThan(NLM_PATCH_RADIUS)
  })

  it('stays inside the basin the ground-truth sweep found', () => {
    // Measured: the error is flat between 1.0 and 1.3 and climbs sharply either
    // side. Outside this band the filter is provably worse, not merely a taste.
    expect(NLM_H).toBeGreaterThanOrEqual(0.9)
    expect(NLM_H).toBeLessThanOrEqual(1.4)
  })

  it('shrinks the sigma one downsample at a time', () => {
    expect(nlmLevelSigma(0.04, 1)).toBeCloseTo(0.04 * NLM_PYRAMID_SIGMA_SCALE, 12)
    expect(nlmLevelSigma(0.04, 2)).toBeCloseTo(0.04 * NLM_PYRAMID_SIGMA_SCALE ** 2, 12)
    // Level 0 is full resolution, where the sigma is used as measured.
    expect(nlmLevelSigma(0.04, 0)).toBe(0.04)
  })

  it('never tells a coarse level there is MORE noise than at full resolution', () => {
    // The one direction that damages photographs: a coarse level that believes
    // the noise is large cannot tell it from slow shading, and the correction
    // then subtracts the subject. Measured, it starts showing above ~0.35.
    expect(NLM_PYRAMID_SIGMA_SCALE).toBeGreaterThan(0)
    expect(NLM_PYRAMID_SIGMA_SCALE).toBeLessThanOrEqual(0.35)
    for (let level = 1; level <= NLM_PYRAMID_LEVELS; level++) {
      expect(nlmLevelSigma(0.04, level)).toBeLessThan(nlmLevelSigma(0.04, level - 1))
    }
  })

  it('costs what the renderer thinks it costs', () => {
    // Two passes per candidate; the doc tables and the radius must not drift.
    expect(2 * nlmOffsets(NLM_SEARCH_RADIUS).length).toBe(242)
  })
})

describe('nlmChunkSize', () => {
  it('budgets work rather than candidates, so a big frame takes more frames', () => {
    // A candidate is not a fixed amount of work — it is two passes over the
    // whole image — so a fixed count would stall a 45 MP photo and dawdle on a
    // small one.
    // Four times the pixels, a quarter of the candidates per frame. (Sizes
    // picked so the rounding down to whole candidates does not blur the ratio.)
    const small = nlmChunkSize(1000, 1000)
    const large = nlmChunkSize(2000, 2000)
    expect(small).toBeGreaterThan(large)
    expect(small / large).toBeCloseTo(4, 5)
  })

  it('spends about the budget on each frame', () => {
    const [width, height] = [4000, 3000]
    const spent = nlmChunkSize(width, height) * 2 * width * height
    expect(spent).toBeLessThanOrEqual(NLM_FRAGMENT_BUDGET)
    expect(spent).toBeGreaterThan(NLM_FRAGMENT_BUDGET / 2)
  })

  it('always makes progress, however large the image', () => {
    // A chunk of 0 would spread the job over infinitely many frames, which is
    // the one outcome worse than a stall: it never finishes at all.
    expect(nlmChunkSize(20000, 20000)).toBeGreaterThanOrEqual(1)
    expect(nlmChunkSize(0, 0)).toBeGreaterThanOrEqual(1)
    expect(nlmChunkSize(Number.NaN, Number.NaN)).toBeGreaterThanOrEqual(1)
  })

  it('does the whole job in one frame when the image is small enough', () => {
    // A thumbnail-sized frame should not be dragged out over 121 frames.
    expect(nlmChunkSize(400, 300)).toBeGreaterThanOrEqual(nlmOffsets(NLM_SEARCH_RADIUS).length)
  })
})
