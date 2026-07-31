import { describe, expect, it } from 'vitest'
import { GRADE_BLEND_MAX, GRADE_BLEND_MIN, zoneWeights } from './colorGrading'

/** A sweep of lumas, extremes included. */
const LUMAS = [0, 0.05, 0.2, 0.35, 0.5, 0.65, 0.8, 0.95, 1]

/** Neutral shape: the defaults the renderer seeds when nothing drives them. */
const NEUTRAL = { blending: 50, balance: 0 }

describe('zoneWeights', () => {
  it('always accounts for the whole pixel', () => {
    // The midtone weight is 1 minus the other two, so the three summing to one
    // is what says no light was invented or lost. Nothing normalises afterwards.
    for (const blending of [0, 25, 50, 75, 100]) {
      for (const luma of LUMAS) {
        const w = zoneWeights(luma, blending, 0)
        expect(w.shadow + w.midtone + w.highlight).toBeCloseTo(1, 6)
      }
    }
  })

  it('never gives a zone a negative weight', () => {
    // A negative midtone weight would not fade the tint, it would invert it —
    // the `max(…, 0)` in both the shader and its twin is the only thing between
    // a low blending and a green cast where the user asked for magenta.
    for (const blending of [0, 10, 50, 100]) {
      for (const balance of [-100, 0, 100]) {
        for (const luma of LUMAS) {
          const w = zoneWeights(luma, blending, balance)
          expect(Math.min(w.shadow, w.midtone, w.highlight)).toBeGreaterThanOrEqual(0)
        }
      }
    }
  })

  it('gives black to the shadows and white to the highlights', () => {
    expect(zoneWeights(0, NEUTRAL.blending, NEUTRAL.balance)).toEqual({
      shadow: 1,
      midtone: 0,
      highlight: 0,
    })
    expect(zoneWeights(1, NEUTRAL.blending, NEUTRAL.balance)).toEqual({
      shadow: 0,
      midtone: 0,
      highlight: 1,
    })
  })

  it('is symmetric while the balance is centred', () => {
    // What the shadows do at luma L, the highlights do at 1 - L.
    for (const luma of LUMAS) {
      const low = zoneWeights(luma, NEUTRAL.blending, 0)
      const high = zoneWeights(1 - luma, NEUTRAL.blending, 0)
      expect(low.shadow).toBeCloseTo(high.highlight, 6)
      expect(low.midtone).toBeCloseTo(high.midtone, 6)
    }
  })

  it('leaves the midtone wheel something to do even at blending 0', () => {
    // The floor is 1.2 and not 1.0 for exactly this reason: at an exponent of 1
    // the two extremes add up to 1 across the whole range and the middle wheel
    // is dead.
    expect(GRADE_BLEND_MIN).toBeGreaterThan(1)
    expect(zoneWeights(0.5, 0, 0).midtone).toBeGreaterThan(0)
  })

  it('widens the midtones as the blending rises', () => {
    const narrow = zoneWeights(0.5, 0, 0).midtone
    const wide = zoneWeights(0.5, 100, 0).midtone
    expect(wide).toBeGreaterThan(narrow)
    expect(GRADE_BLEND_MAX).toBeGreaterThan(GRADE_BLEND_MIN)
  })

  it('hands more of the frame to the highlights as the balance rises', () => {
    // Positive balance shifts the midpoint towards the highlights: a midtone
    // pixel starts counting as a highlight before it counts as a shadow.
    const centred = zoneWeights(0.5, NEUTRAL.blending, 0)
    const towardsHighlights = zoneWeights(0.5, NEUTRAL.blending, 100)
    const towardsShadows = zoneWeights(0.5, NEUTRAL.blending, -100)

    expect(towardsHighlights.highlight).toBeGreaterThan(centred.highlight)
    expect(towardsShadows.shadow).toBeGreaterThan(centred.shadow)
  })

  it('clamps an over-exposed luma instead of returning NaN', () => {
    // Exposure can push a luma past 1, and `pow` of a negative base is NaN — one
    // NaN paints the entire frame black without a single GL error.
    const blown = zoneWeights(4, NEUTRAL.blending, NEUTRAL.balance)
    expect(Number.isNaN(blown.shadow + blown.midtone + blown.highlight)).toBe(false)
    expect(blown).toEqual(zoneWeights(1, NEUTRAL.blending, NEUTRAL.balance))

    const negative = zoneWeights(-2, NEUTRAL.blending, NEUTRAL.balance)
    expect(negative).toEqual(zoneWeights(0, NEUTRAL.blending, NEUTRAL.balance))
  })
})
