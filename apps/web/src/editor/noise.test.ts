import { describe, expect, it } from 'vitest'
import {
  AUTO_BASE_ISO,
  AUTO_DEVELOPED_SCALE,
  AUTO_MAX_STOPS,
  CHROMA_EDGE_SIGMA,
  COLOR_NOISE_MAX_RADIUS,
  LUMINANCE_NOISE_MAX_RADIUS,
  autoDenoiseSliders,
  colorNoiseRadius,
  denoiseParams,
  luminanceDetailAmount,
  luminanceNoiseRadius,
  luminanceSigmaRange,
} from './noise'

/** The three sliders at rest, so each test only states what it changes. */
const REST = { colorNoise: 0, luminanceNoise: 0, luminanceDetail: 50 }

describe('colorNoiseRadius', () => {
  it('returns 0 at rest, which is what skips the pass entirely', () => {
    expect(colorNoiseRadius(0)).toBe(0)
  })

  it('reaches the maximum radius at the top of the slider', () => {
    expect(colorNoiseRadius(100)).toBe(COLOR_NOISE_MAX_RADIUS)
  })

  it('grows monotonically across the slider', () => {
    let previous = colorNoiseRadius(0)
    for (let value = 1; value <= 100; value++) {
      const radius = colorNoiseRadius(value)
      expect(radius).toBeGreaterThan(previous)
      previous = radius
    }
  })

  it('treats negative values as off rather than as an inverse effect', () => {
    expect(colorNoiseRadius(-20)).toBe(0)
  })

  it('clamps above the slider maximum', () => {
    expect(colorNoiseRadius(500)).toBe(COLOR_NOISE_MAX_RADIUS)
  })

  it('falls back to off on a non-finite value', () => {
    expect(colorNoiseRadius(Number.NaN)).toBe(0)
    expect(colorNoiseRadius(Number.POSITIVE_INFINITY)).toBe(0)
  })
})

describe('luminanceNoiseRadius', () => {
  it('is off at 0', () => {
    expect(luminanceNoiseRadius(0)).toBe(0)
  })

  it('jumps straight to a usable radius, never a degenerate one', () => {
    // A bilateral with radius 0 has no neighbours to average, so the first few
    // percent of the slider would look broken without this floor.
    expect(luminanceNoiseRadius(1)).toBeGreaterThanOrEqual(1)
  })

  it('reaches the maximum radius at the top of the slider', () => {
    expect(luminanceNoiseRadius(100)).toBe(LUMINANCE_NOISE_MAX_RADIUS)
  })

  it('stays far below the chroma radius, which is the whole asymmetry', () => {
    expect(LUMINANCE_NOISE_MAX_RADIUS).toBeLessThan(COLOR_NOISE_MAX_RADIUS)
  })

  it('falls back to off on a non-finite value', () => {
    expect(luminanceNoiseRadius(Number.NaN)).toBe(0)
  })
})

describe('luminanceSigmaRange', () => {
  it('grows monotonically: this, not the radius, is what removes noise', () => {
    let previous = luminanceSigmaRange(0)
    for (let value = 1; value <= 100; value++) {
      const sigma = luminanceSigmaRange(value)
      expect(sigma).toBeGreaterThan(previous)
      previous = sigma
    }
  })

  it('never reaches zero, which would make every neighbour weigh nothing', () => {
    expect(luminanceSigmaRange(0)).toBeGreaterThan(0)
  })

  it('stays below the chroma edge guard, or the bilateral would cross edges', () => {
    // The chroma guard is deliberately loose so noise does not trip it; the
    // bilateral's range term is the opposite — it has to bite before an edge.
    expect(luminanceSigmaRange(100)).toBeLessThan(CHROMA_EDGE_SIGMA)
  })
})

describe('luminanceDetailAmount', () => {
  it('maps the slider onto a 0..1 mix', () => {
    expect(luminanceDetailAmount(0)).toBe(0)
    expect(luminanceDetailAmount(50)).toBe(0.5)
    expect(luminanceDetailAmount(100)).toBe(1)
  })
})

describe('denoiseParams', () => {
  it('is disabled with every slider at rest', () => {
    expect(denoiseParams(REST).enabled).toBe(false)
  })

  it('enables on either filter alone', () => {
    expect(denoiseParams({ ...REST, colorNoise: 25 }).enabled).toBe(true)
    expect(denoiseParams({ ...REST, luminanceNoise: 25 }).enabled).toBe(true)
  })

  it('reports the widest radius, since that is how far the shader loops', () => {
    const params = denoiseParams({ ...REST, colorNoise: 100, luminanceNoise: 100 })
    expect(params.maxRadius).toBe(COLOR_NOISE_MAX_RADIUS)
  })

  it('keeps the loop within the shader bound', () => {
    // MAX_TAPS in DENOISE_FRAGMENT_SHADER is 24; a wider radius would be
    // silently truncated by the shader instead of erroring.
    const widest = denoiseParams({ colorNoise: 100, luminanceNoise: 100, luminanceDetail: 0 })
    expect(widest.maxRadius).toBeLessThanOrEqual(24)
  })

  it('drops the luminance filter when detail hands all of it back', () => {
    // detail = 100 mixes the original luma in at full strength, so filtering it
    // first is work whose result is discarded.
    const params = denoiseParams({ ...REST, luminanceNoise: 80, luminanceDetail: 100 })
    expect(params.lumaRadius).toBe(0)
    expect(params.enabled).toBe(false)
  })

  it('still runs for chroma when only the luminance half is cancelled', () => {
    const params = denoiseParams({ colorNoise: 40, luminanceNoise: 80, luminanceDetail: 100 })
    expect(params.lumaRadius).toBe(0)
    expect(params.colorRadius).toBeGreaterThan(0)
    expect(params.enabled).toBe(true)
  })

  it('survives a slider map full of rubbish rather than emitting NaN uniforms', () => {
    // A NaN uniform paints the whole frame black without raising anything.
    const params = denoiseParams({
      colorNoise: Number.NaN,
      luminanceNoise: Number.POSITIVE_INFINITY,
      luminanceDetail: Number.NaN,
    })
    expect(Number.isFinite(params.colorRadius)).toBe(true)
    expect(Number.isFinite(params.lumaRadius)).toBe(true)
    expect(Number.isFinite(params.lumaSigmaRange)).toBe(true)
    expect(Number.isFinite(params.detail)).toBe(true)
    expect(params.enabled).toBe(false)
  })
})

describe('autoDenoiseSliders', () => {
  it('barely touches a base-ISO shot: there is nothing there to clean', () => {
    const auto = autoDenoiseSliders(AUTO_BASE_ISO, 'raw')
    expect(auto.colorNoise).toBeLessThan(20)
    expect(auto.luminanceNoise).toBe(0)
  })

  it('leaves the luminance filter alone until the noise is worth its detail cost', () => {
    // Chroma noise shows up long before luminance noise is worth touching, and
    // only the luminance filter takes real detail with it.
    expect(autoDenoiseSliders(200, 'raw').luminanceNoise).toBe(0)
    expect(autoDenoiseSliders(400, 'raw').luminanceNoise).toBe(0)
    expect(autoDenoiseSliders(1600, 'raw').luminanceNoise).toBeGreaterThan(0)
  })

  it('cleans chroma from the first stop up, since it costs no detail', () => {
    expect(autoDenoiseSliders(400, 'raw').colorNoise).toBeGreaterThan(autoDenoiseSliders(100, 'raw').colorNoise)
  })

  it('grows with ISO, but on stops rather than on the raw number', () => {
    // Noise doubles per stop, so 100 -> 200 has to move the sliders as much as
    // 3200 -> 6400 does; a linear-in-ISO mapping would do nothing at the bottom
    // and slam into the stops at the top.
    const lowStep = autoDenoiseSliders(200, 'raw').colorNoise - autoDenoiseSliders(100, 'raw').colorNoise
    const highStep = autoDenoiseSliders(6400, 'raw').colorNoise - autoDenoiseSliders(3200, 'raw').colorNoise
    expect(lowStep).toBe(highStep)
  })

  it('flattens out above the top of the curve instead of running away', () => {
    const topOfCurve = autoDenoiseSliders(AUTO_BASE_ISO * 2 ** AUTO_MAX_STOPS, 'raw')
    expect(autoDenoiseSliders(102400, 'raw')).toEqual(topOfCurve)
    expect(autoDenoiseSliders(409600, 'raw')).toEqual(topOfCurve)
  })

  it('never proposes a value outside the sliders own range', () => {
    for (const iso of [50, 100, 400, 1600, 6400, 25600, 409600]) {
      const auto = autoDenoiseSliders(iso, 'raw')
      expect(auto.colorNoise).toBeGreaterThanOrEqual(0)
      expect(auto.colorNoise).toBeLessThanOrEqual(100)
      expect(auto.luminanceNoise).toBeGreaterThanOrEqual(0)
      expect(auto.luminanceNoise).toBeLessThanOrEqual(100)
    }
  })

  it('lands on whole numbers, which is the sliders step', () => {
    const auto = autoDenoiseSliders(1250, 'raw')
    expect(Number.isInteger(auto.colorNoise)).toBe(true)
    expect(Number.isInteger(auto.luminanceNoise)).toBe(true)
  })

  it('leaves detail at its neutral 50: how much texture to spare is a look', () => {
    expect(autoDenoiseSliders(100, 'raw').luminanceDetail).toBe(50)
    expect(autoDenoiseSliders(25600, 'raw').luminanceDetail).toBe(50)
  })

  it('treats a missing or nonsense ISO as base ISO rather than failing', () => {
    // EXIF that says nothing is common enough that the button must still do
    // something sane; the mildest setting is that something.
    const base = autoDenoiseSliders(AUTO_BASE_ISO, 'raw')
    expect(autoDenoiseSliders(0, 'raw')).toEqual(base)
    expect(autoDenoiseSliders(-400, 'raw')).toEqual(base)
    expect(autoDenoiseSliders(Number.NaN, 'raw')).toEqual(base)
    // Below base ISO is not "cleaner than clean" — it is still just clean.
    expect(autoDenoiseSliders(50, 'raw')).toEqual(base)
  })

  it('produces sliders the render pass will actually run', () => {
    const params = denoiseParams(autoDenoiseSliders(6400, 'raw'))
    expect(params.enabled).toBe(true)
    expect(params.maxRadius).toBeLessThanOrEqual(24)
  })

  it('goes easier on a file the camera has already denoised', () => {
    // Same ISO, same sensor noise — but a camera JPEG arrives cleaned once
    // already, so the full RAW dose on top is denoise over denoise.
    const raw = autoDenoiseSliders(6400, 'raw')
    const developed = autoDenoiseSliders(6400, 'developed')

    expect(developed.colorNoise).toBeLessThan(raw.colorNoise)
    expect(developed.luminanceNoise).toBeLessThan(raw.luminanceNoise)
    expect(developed.colorNoise).toBe(Math.round(raw.colorNoise * AUTO_DEVELOPED_SCALE))
  })

  it('never proposes more for a developed file than for the RAW it came from', () => {
    for (const iso of [100, 400, 1600, 6400, 25600]) {
      const raw = autoDenoiseSliders(iso, 'raw')
      const developed = autoDenoiseSliders(iso, 'developed')
      expect(developed.colorNoise).toBeLessThanOrEqual(raw.colorNoise)
      expect(developed.luminanceNoise).toBeLessThanOrEqual(raw.luminanceNoise)
    }
  })

  it('still proposes something worth rendering for a noisy JPEG', () => {
    // Erring short must not mean erring into a no-op: at ISO 6400 a camera JPEG
    // still has visible noise left, and the button has to do something.
    expect(denoiseParams(autoDenoiseSliders(6400, 'developed')).enabled).toBe(true)
  })

  it('keeps the shape of the curve for a developed file, only quieter', () => {
    // Attenuation is a dose, not a different mapping: it must still grow with
    // ISO and still hold luminance back at the bottom of the range.
    expect(autoDenoiseSliders(100, 'developed').luminanceNoise).toBe(0)
    expect(autoDenoiseSliders(6400, 'developed').colorNoise).toBeGreaterThan(
      autoDenoiseSliders(400, 'developed').colorNoise,
    )
  })
})

describe('CHROMA_EDGE_SIGMA', () => {
  it('is loose enough that sensor noise does not trip the edge guard', () => {
    // The guard weighs neighbours by luma difference. Chroma noise lives in the
    // shadows, where neighbouring luma already differs by ~0.01-0.03 from the
    // noise itself; a tight sigma would read that as an edge and disable the
    // smoothing exactly where it is needed.
    expect(CHROMA_EDGE_SIGMA).toBeGreaterThan(0.03)
    // But still tight enough to stop colour bleeding across a real edge.
    expect(CHROMA_EDGE_SIGMA).toBeLessThan(0.25)
  })
})
