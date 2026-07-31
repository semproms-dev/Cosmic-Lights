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
    // Noise reduction is neutral at 0 on purpose, unlike Lightroom's colour NR
    // at 25: this map also feeds presets and export, so a non-zero default would
    // restyle edits saved before the slider existed.
    expect(result.colorNoise).toBe(0)
    expect(result.luminanceNoise).toBe(0)
    // Detail is the shape of the luminance filter, not its amount — same reason
    // grainSize sits at 50. What turns it off is luminanceNoise = 0.
    expect(result.luminanceDetail).toBe(50)
    // Grading: what turns a zone off is its saturation, and blending is the
    // shape of the split rather than its amount — hence 50, like the vignette's
    // midpoint. At 0 the three zones would cut into each other at a knife edge.
    expect(result.gradeShadowSat).toBe(0)
    expect(result.gradeMidSat).toBe(0)
    expect(result.gradeHighSat).toBe(0)
    expect(result.gradeBlending).toBe(50)
    expect(result.gradeBalance).toBe(0)
    // The zone luminances are their own controls, neutral at 0 in the middle of
    // a symmetric range.
    expect(result.gradeShadowLum).toBe(0)
    expect(result.gradeMidLum).toBe(0)
    expect(result.gradeHighLum).toBe(0)
  })

  it('carries a zone luminance through with no tint on it', () => {
    // Darkening a zone without colouring it is an ordinary edit, so the
    // luminance has to survive the trip on its own.
    const result = toRenderAdjustments({ gradeShadowLum: -40 })
    expect(result.gradeShadowLum).toBe(-40)
    expect(result.gradeShadowSat).toBe(0)
  })

  it('carries a wheel through as the two scalars the shader reads', () => {
    // The wheel is one control in the panel but a hue and a saturation here, and
    // it is these keys — not a colour object — that presets and the export walk.
    const result = toRenderAdjustments({ gradeShadowHue: 210, gradeShadowSat: 35 })
    expect(result.gradeShadowHue).toBe(210)
    expect(result.gradeShadowSat).toBe(35)
    // Untouched zones stay off.
    expect(result.gradeHighSat).toBe(0)
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
