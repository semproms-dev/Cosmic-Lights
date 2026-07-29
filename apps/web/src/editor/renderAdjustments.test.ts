import { describe, expect, it } from 'vitest'
import { toRenderAdjustments } from './renderAdjustments'

describe('toRenderAdjustments', () => {
  it('fills every uniform with its neutral value when nothing is set', () => {
    const result = toRenderAdjustments({})
    expect(Object.values(result).every((value) => Number.isFinite(value))).toBe(true)
    expect(result.exposure).toBe(0)
    expect(result.saturation).toBe(0)
    // The vignette's midpoint and feather are neutral at 50, not at 0: zeroing
    // them would paint a hard vignette nobody asked for.
    expect(result.vignetteMidpoint).toBe(50)
    expect(result.vignetteFeather).toBe(50)
    // Grain size and roughness are the *shape* of the grain, not its amount:
    // they sit at 50 and it is `grain = 0` that turns the effect off.
    expect(result.grain).toBe(0)
    expect(result.grainSize).toBe(50)
    expect(result.grainRoughness).toBe(50)
  })

  it('carries the values that are set through', () => {
    const result = toRenderAdjustments({ exposure: 1.5, vignette: -30, vignetteMidpoint: 20, grain: 40, grainSize: 70 })
    expect(result.exposure).toBe(1.5)
    expect(result.vignette).toBe(-30)
    expect(result.vignetteMidpoint).toBe(20)
    expect(result.grain).toBe(40)
    expect(result.grainSize).toBe(70)
  })

  it('ignores keys the shader has no uniform for', () => {
    const result = toRenderAdjustments({ contrast: 10, notAUniform: 42 })
    expect(result.contrast).toBe(10)
    expect('notAUniform' in result).toBe(false)
  })

  it('falls back to the neutral value on a non-finite input', () => {
    const result = toRenderAdjustments({ exposure: Number.NaN, contrast: Number.POSITIVE_INFINITY })
    expect(result.exposure).toBe(0)
    expect(result.contrast).toBe(0)
  })
})
