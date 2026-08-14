import { describe, expect, it } from 'vitest'
import { autoAdjustSliders } from './autoAdjust'
import type { LumaHistogram } from './histogram'

/**
 * A histogram built by hand, so each test states only the percentiles that
 * shape the slider it cares about. The defaults read as a well-exposed frame.
 */
function makeHist(
  overrides: Partial<Pick<LumaHistogram, 'p0_1' | 'p10' | 'p50' | 'p90' | 'p99_9'>>,
): LumaHistogram {
  return {
    bins: [],
    total: 0,
    p0_1: overrides.p0_1 ?? 0.02,
    p10: overrides.p10 ?? 0.25,
    p50: overrides.p50 ?? 0.5,
    p90: overrides.p90 ?? 0.75,
    p99_9: overrides.p99_9 ?? 0.98,
  }
}

describe('autoAdjustSliders — exposure', () => {
  it('exposes a bright frame down, toward mid grey', () => {
    const result = autoAdjustSliders(makeHist({ p50: 0.7 }))
    expect(result.exposure).toBeCloseTo(-0.85, 4)
  })

  it('exposes a dark frame up, toward mid grey', () => {
    const result = autoAdjustSliders(makeHist({ p50: 0.2 }))
    expect(result.exposure).toBe(1)
  })

  it('rounds to the exposure slider’s 0.05 step', () => {
    const result = autoAdjustSliders(makeHist({ p50: 0.46 }))
    expect(result.exposure).toBeCloseTo(0.2, 10)
  })

  it('clamps to the exposure slider’s range', () => {
    // A near-black frame wants many more stops than the slider has to give.
    expect(autoAdjustSliders(makeHist({ p50: 0.01 })).exposure).toBe(1)
    expect(autoAdjustSliders(makeHist({ p50: 0.9 })).exposure).toBe(-1)
  })

  it('rests at 0 on a median that is already mid grey', () => {
    expect(autoAdjustSliders(makeHist({ p50: 0.5 })).exposure).toBe(0)
  })
})

describe('autoAdjustSliders — the zones after the exposure shift', () => {
  it('places a well-exposed frame with only a nudge', () => {
    const result = autoAdjustSliders(makeHist({}))
    expect(result).toEqual({ exposure: 0, contrast: -7, highlights: 15, shadows: 0, whites: 0, blacks: 0 })
  })

  it('recovers a lifted top by pulling whites up', () => {
    // p99.9 at 0.6: nothing near white, so Auto pushes the top out.
    expect(autoAdjustSliders(makeHist({ p99_9: 0.6 })).whites).toBe(100)
  })

  it('deepens blacks that arrive lifted', () => {
    // p0.1 at 0.4: the dark end is already grey, so Auto pushes it down.
    expect(autoAdjustSliders(makeHist({ p0_1: 0.4 })).blacks).toBe(-100)
  })

  it('computes the zones on the *shifted* percentiles, after exposure', () => {
    // A dark frame is exposed +1 stop first (median 0.2); the zone offsets then
    // place the quartertones of the picture as it will be, not as it was.
    const result = autoAdjustSliders(makeHist({ p50: 0.2, p10: 0.1 }))
    expect(result.exposure).toBe(1)
    expect(result.shadows).toBe(34)
    expect(result.highlights).toBe(-68)
    expect(result.whites).toBe(-100)
    expect(result.contrast).toBe(-66)
  })
})

describe('autoAdjustSliders — contrast', () => {
  it('adds contrast to a flat frame', () => {
    const result = autoAdjustSliders(makeHist({ p90: 0.6, p10: 0.4, p99_9: 0.7, p0_1: 0.3 }))
    expect(result.contrast).toBe(38)
  })

  it('takes contrast from an already-contrasty frame', () => {
    const result = autoAdjustSliders(makeHist({ p90: 0.95, p10: 0.05 }))
    expect(result.contrast).toBe(-67)
  })
})

describe('autoAdjustSliders — guard rails', () => {
  it('treats non-finite percentiles as “no signal” and rests on the neutral', () => {
    expect(autoAdjustSliders(makeHist({ p50: Number.NaN })).exposure).toBe(0)
    expect(autoAdjustSliders(makeHist({ p90: Number.NaN })).highlights).toBe(0)
    expect(autoAdjustSliders(makeHist({ p10: Number.NaN })).shadows).toBe(0)
  })

  it('keeps every zone within the slider range', () => {
    const result = autoAdjustSliders(makeHist({ p0_1: 0.9, p10: 0.9, p90: 0.1, p99_9: 0.1 }))
    for (const key of ['contrast', 'highlights', 'shadows', 'whites', 'blacks'] as const) {
      expect(result[key]).toBeGreaterThanOrEqual(-100)
      expect(result[key]).toBeLessThanOrEqual(100)
    }
  })
})
