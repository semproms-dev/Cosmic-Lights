import { describe, expect, it } from 'vitest'
import {
  AUTO_BASE_ISO,
  AUTO_DEVELOPED_SCALE,
  AUTO_MAX_STOPS,
  CHROMA_EDGE_SIGMA,
  CHROMA_NOISE_SIGMA_AT_100,
  COLOR_NOISE_MAX_RADIUS,
  COLOR_PYRAMID_FACTOR,
  COLOR_PYRAMID_LEVEL_1_AT,
  COLOR_PYRAMID_LEVEL_2_AT,
  COLOR_PYRAMID_MAX_LEVELS,
  COLOR_PYRAMID_RADIUS,
  LUMA_SHAPE_MAX,
  LUMA_SHAPE_MIN,
  LUMINANCE_NOISE_MAX_RADIUS,
  LUMA_NOISE_SIGMA_AT_0,
  LUMA_NOISE_SIGMA_AT_100,
  autoDenoiseSliders,
  colorNoiseRadius,
  colorPyramidLevels,
  colorSliderFromSigma,
  denoiseParams,
  lumaShapeCurve,
  pyramidSize,
  denoiseSlidersFromNoise,
  luminanceDetailAmount,
  luminanceNoiseRadius,
  luminanceSigmaRange,
  luminanceSliderFromSigma,
  slidersFromNoise,
} from './noise'
import { NOISE_LUMA_BINS } from './noiseEstimate'

/** The three sliders at rest, so each test only states what it changes. */
const REST = { colorNoise: 0, luminanceNoise: 0, luminanceDetail: 0 }

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

  it('is a mix back toward the ORIGINAL, so it caps how much noise can go', () => {
    // The one fact that decides this slider's neutral, and the one that is easy
    // to get wrong: the shader computes mix(filtered, original, detail), and the
    // original still carries all of its noise. So a detail of n hands n of the
    // noise straight back — 50 does not mean "keep half the texture", it means
    // no luminance denoiser can ever remove more than half the grain. That is
    // why every default and every Auto suggestion below sits at 0.
    for (const detail of [0, 10, 50, 90]) {
      const remaining = luminanceDetailAmount(detail)
      expect(remaining).toBe(detail / 100)
      expect(1 - remaining).toBe(1 - detail / 100)
    }
  })
})

describe('the neutral of luminanceDetail', () => {
  it('is 0 everywhere it is proposed, never 50', () => {
    // Pinned deliberately. A 50 here is the intuitive reading of a "detail"
    // slider and it silently halves the whole feature; if this test ever has to
    // change, the reasoning in luminanceDetailAmount above has to change first.
    expect(autoDenoiseSliders(6400, 'raw').luminanceDetail).toBe(0)
    expect(autoDenoiseSliders(100, 'developed').luminanceDetail).toBe(0)
    expect(slidersFromNoise({ lumaSigma: 0.03, chromaSigma: 0.03 }).luminanceDetail).toBe(0)
    expect(denoiseSlidersFromNoise({ lumaSigma: 0.03, chromaSigma: 0.03 }, 3200, 'raw').luminanceDetail).toBe(0)
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
    expect(autoDenoiseSliders(100, 'raw').luminanceDetail).toBe(0)
    expect(autoDenoiseSliders(25600, 'raw').luminanceDetail).toBe(0)
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

describe('luminanceSliderFromSigma', () => {
  it("is off below the filter's resolution floor", () => {
    // Noise the bilateral cannot even see maps to 0, i.e. leaves the slider off.
    expect(luminanceSliderFromSigma(0)).toBe(0)
    expect(luminanceSliderFromSigma(LUMA_NOISE_SIGMA_AT_0)).toBe(0)
    expect(luminanceSliderFromSigma(0.001)).toBe(0)
  })

  it('reaches 100 at the top of the calibration', () => {
    expect(luminanceSliderFromSigma(LUMA_NOISE_SIGMA_AT_100)).toBe(100)
  })

  it('maps a typical high-ISO noise σ into the middle of the range', () => {
    // σ = 0.02 (luma units) is a realistic ISO 1600-3200 reading; the filter's
    // range sigma must reach 1.5× that, which lands at ~33.
    expect(luminanceSliderFromSigma(0.02)).toBe(33)
  })

  it('grows monotonically with the measured noise', () => {
    let previous = -1
    for (let sigma = 0; sigma <= 0.1; sigma += 0.001) {
      const slider = luminanceSliderFromSigma(sigma)
      expect(slider).toBeGreaterThanOrEqual(previous)
      previous = slider
    }
  })

  it('clamps above the calibration instead of running away', () => {
    expect(luminanceSliderFromSigma(0.2)).toBe(100)
  })

  it('falls back to off on a non-finite reading', () => {
    // The estimator only produces finite σ, so this is pure robustness — and
    // "off" is the safe direction when the number is nonsense.
    expect(luminanceSliderFromSigma(Number.NaN)).toBe(0)
    expect(luminanceSliderFromSigma(Number.POSITIVE_INFINITY)).toBe(0)
  })
})

describe('colorSliderFromSigma', () => {
  it('is off when there is no chroma noise to clean', () => {
    expect(colorSliderFromSigma(0)).toBe(0)
  })

  it('reaches 100 at the top of the calibration', () => {
    expect(colorSliderFromSigma(CHROMA_NOISE_SIGMA_AT_100)).toBe(100)
  })

  it('maps a typical reading linearly into the range', () => {
    expect(colorSliderFromSigma(0.04)).toBe(57)
  })

  it('grows monotonically with the measured chroma noise', () => {
    let previous = -1
    for (let sigma = 0; sigma <= 0.1; sigma += 0.001) {
      const slider = colorSliderFromSigma(sigma)
      expect(slider).toBeGreaterThanOrEqual(previous)
      previous = slider
    }
  })

  it('clamps above the calibration and falls back off on a non-finite reading', () => {
    expect(colorSliderFromSigma(0.5)).toBe(100)
    expect(colorSliderFromSigma(Number.NaN)).toBe(0)
  })
})

describe('slidersFromNoise', () => {
  it('proposes nothing for a clean image', () => {
    expect(slidersFromNoise({ lumaSigma: 0, chromaSigma: 0 })).toEqual({
      colorNoise: 0,
      luminanceNoise: 0,
      luminanceDetail: 0,
    })
  })

  it('caps at the top of both sliders for overwhelming noise', () => {
    expect(slidersFromNoise({ lumaSigma: 0.2, chromaSigma: 0.5 })).toEqual({
      colorNoise: 100,
      luminanceNoise: 100,
      luminanceDetail: 0,
    })
  })

  it('leaves detail at its neutral 50, like the ISO mapping does', () => {
    expect(slidersFromNoise({ lumaSigma: 0.04, chromaSigma: 0.03 }).luminanceDetail).toBe(0)
  })
})

describe('denoiseSlidersFromNoise', () => {
  // The estimate whose measured proposal is { colorNoise: 57, luminanceNoise: 33 }.
  const NOISY = { lumaSigma: 0.02, chromaSigma: 0.04 }

  it('trusts the measurement fully once the ISO says the sensor is noisy', () => {
    // ISO 800 is 3 stops above base, where AUTO_NOISE_TRUST_STOPS saturates:
    // the result is exactly what the measurement calls for.
    const auto = denoiseSlidersFromNoise(NOISY, 800, 'raw')
    expect(auto.colorNoise).toBe(57)
    expect(auto.luminanceNoise).toBe(33)
  })

  it('stays on the measurement from ISO 800 up', () => {
    expect(denoiseSlidersFromNoise(NOISY, 6400, 'raw')).toEqual(denoiseSlidersFromNoise(NOISY, 800, 'raw'))
  })

  it('mixes in a fraction of the measurement at intermediate ISO', () => {
    // ISO 200 = 1 stop, so one third of the distance from prior to measured.
    const auto = denoiseSlidersFromNoise(NOISY, 200, 'raw')
    expect(auto.colorNoise).toBe(33)
    expect(auto.luminanceNoise).toBe(11)
  })

  it('keeps the conservative prior at base ISO, so texture is not read as noise', () => {
    // A foliage photo at ISO 100 reads very "noisy"; without this guard the
    // button would butcher real texture. At base ISO the ISO prior decides.
    expect(denoiseSlidersFromNoise(NOISY, 100, 'raw')).toEqual({
      colorNoise: 10,
      luminanceNoise: 0,
      luminanceDetail: 0,
    })
  })

  it('lets a clean measurement pull below the ISO curve', () => {
    // ISO 6400 but the pixels say ~clean (a camera that denoised well): the
    // measurement wins and proposes far less than the blind ISO curve would.
    const clean = denoiseSlidersFromNoise({ lumaSigma: 0.005, chromaSigma: 0.005 }, 6400, 'raw')
    expect(clean.colorNoise).toBe(7)
    expect(clean.luminanceNoise).toBe(3)
  })

  it('leans on the measurement alone when the file records no ISO', () => {
    // No ISO signal means the prior has nothing to say; the measurement gets
    // the fixed middle trust and shapes the proposal by itself.
    const auto = denoiseSlidersFromNoise(NOISY, 0, 'developed')
    expect(auto.colorNoise).toBe(31)
    expect(auto.luminanceNoise).toBe(17)
    expect(auto.luminanceDetail).toBe(0)
  })

  it('treats a nonsense ISO the same as a missing one', () => {
    const noIso = denoiseSlidersFromNoise(NOISY, 0, 'raw')
    expect(denoiseSlidersFromNoise(NOISY, Number.NaN, 'raw')).toEqual(noIso)
    expect(denoiseSlidersFromNoise(NOISY, -400, 'raw')).toEqual(noIso)
  })

  it('never proposes a value outside the sliders own range', () => {
    for (const iso of [0, 100, 400, 1600, 6400, Number.NaN]) {
      for (const source of ['raw', 'developed'] as const) {
        const auto = denoiseSlidersFromNoise({ lumaSigma: 0.05, chromaSigma: 0.09 }, iso, source)
        expect(auto.colorNoise).toBeGreaterThanOrEqual(0)
        expect(auto.colorNoise).toBeLessThanOrEqual(100)
        expect(auto.luminanceNoise).toBeGreaterThanOrEqual(0)
        expect(auto.luminanceNoise).toBeLessThanOrEqual(100)
      }
    }
  })
})

describe('CHROMA_EDGE_SIGMA', () => {  it('is loose enough that sensor noise does not trip the edge guard', () => {
    // The guard weighs neighbours by luma difference. Chroma noise lives in the
    // shadows, where neighbouring luma already differs by ~0.01-0.03 from the
    // noise itself; a tight sigma would read that as an edge and disable the
    // smoothing exactly where it is needed.
    expect(CHROMA_EDGE_SIGMA).toBeGreaterThan(0.03)
    // But still tight enough to stop colour bleeding across a real edge.
    expect(CHROMA_EDGE_SIGMA).toBeLessThan(0.25)
  })
})

describe('lumaShapeCurve', () => {
  const flat = Array.from({ length: NOISE_LUMA_BINS }, () => 1)

  it('falls back to a flat curve when there is nothing measured', () => {
    // Three different ways to know nothing, one answer: filter every brightness
    // alike, which is exactly what the feature did before the curve existed.
    expect(lumaShapeCurve(null)).toEqual(flat)
    expect(lumaShapeCurve(undefined)).toEqual(flat)
    expect(lumaShapeCurve({ lumaSigma: 0.02, chromaSigma: 0.03 })).toEqual(flat)
  })

  it('rejects a curve of the wrong length rather than half-using it', () => {
    expect(lumaShapeCurve({ lumaSigma: 0.02, chromaSigma: 0.03, lumaShape: [2, 3] })).toEqual(flat)
  })

  it('passes a measured curve through untouched when it is already in range', () => {
    const shape = [3, 2, 1.5, 1, 0.9, 0.8, 0.7, 0.6]
    expect(lumaShapeCurve({ lumaSigma: 0.02, chromaSigma: 0.03, lumaShape: shape })).toEqual(shape)
  })

  it('clamps what a bad measurement could otherwise do to the picture', () => {
    const shape = [50, 0, -4, 1, 1, 1, 1, 1]
    const curve = lumaShapeCurve({ lumaSigma: 0.02, chromaSigma: 0.03, lumaShape: shape })
    expect(curve[0]).toBe(LUMA_SHAPE_MAX)
    expect(curve[1]).toBe(LUMA_SHAPE_MIN)
    expect(curve[2]).toBe(LUMA_SHAPE_MIN)
  })

  it('replaces a non-finite band with neutral instead of poisoning the shader', () => {
    const shape = [Number.NaN, Number.POSITIVE_INFINITY, 1, 1, 1, 1, 1, 1]
    const curve = lumaShapeCurve({ lumaSigma: 0.02, chromaSigma: 0.03, lumaShape: shape })
    expect(curve[0]).toBe(1)
    expect(curve[1]).toBe(1)
    expect(curve.every((value) => Number.isFinite(value))).toBe(true)
  })

  it('never hands back an array the caller already owns, since the renderer keeps it', () => {
    const shape = [3, 2, 1.5, 1, 0.9, 0.8, 0.7, 0.6]
    const estimate = { lumaSigma: 0.02, chromaSigma: 0.03, lumaShape: shape }
    expect(lumaShapeCurve(estimate)).not.toBe(shape)
    expect(lumaShapeCurve(null)).not.toBe(lumaShapeCurve(null))
  })
})

describe('colorPyramidLevels', () => {
  it('stays off for the gentle settings, where there is no mottle to chase', () => {
    expect(colorPyramidLevels(0)).toBe(0)
    expect(colorPyramidLevels(COLOR_PYRAMID_LEVEL_1_AT)).toBe(0)
  })

  it('adds one level, then the second, as the slider is pushed', () => {
    expect(colorPyramidLevels(COLOR_PYRAMID_LEVEL_1_AT + 1)).toBe(1)
    expect(colorPyramidLevels(COLOR_PYRAMID_LEVEL_2_AT)).toBe(1)
    expect(colorPyramidLevels(COLOR_PYRAMID_LEVEL_2_AT + 1)).toBe(2)
    expect(colorPyramidLevels(100)).toBe(COLOR_PYRAMID_MAX_LEVELS)
  })

  it('treats junk and out-of-range values like the slider ends', () => {
    expect(colorPyramidLevels(-10)).toBe(0)
    expect(colorPyramidLevels(Number.NaN)).toBe(0)
    expect(colorPyramidLevels(1000)).toBe(COLOR_PYRAMID_MAX_LEVELS)
  })

  it('is monotonic: more cleaning never buys fewer levels', () => {
    let previous = 0
    for (let slider = 0; slider <= 100; slider++) {
      const levels = colorPyramidLevels(slider)
      expect(levels).toBeGreaterThanOrEqual(previous)
      previous = levels
    }
  })
})

describe('pyramidSize', () => {
  it('divides by the factor once per level', () => {
    expect(pyramidSize(1024, 1)).toBe(1024 / COLOR_PYRAMID_FACTOR)
    expect(pyramidSize(1024, 2)).toBe(1024 / COLOR_PYRAMID_FACTOR ** 2)
  })

  it('rounds up, so a level never drops the last partial block', () => {
    expect(pyramidSize(6000, 1)).toBe(1500)
    expect(pyramidSize(4001, 1)).toBe(1001)
    expect(pyramidSize(4001, 2)).toBe(251)
  })

  it('never returns a size a texture cannot have', () => {
    expect(pyramidSize(1, 2)).toBe(1)
    expect(pyramidSize(0, 1)).toBe(1)
  })
})

describe('denoiseParams pyramid levels', () => {
  it('carries the level count the chroma slider earns', () => {
    expect(denoiseParams({ ...REST, colorNoise: 10 }).pyramidLevels).toBe(0)
    expect(denoiseParams({ ...REST, colorNoise: 100 }).pyramidLevels).toBe(COLOR_PYRAMID_MAX_LEVELS)
  })

  it('does not build a pyramid for a luminance-only setting', () => {
    // Nothing in the pyramid touches luma, so levels here would be pure cost.
    expect(denoiseParams({ ...REST, luminanceNoise: 100 }).pyramidLevels).toBe(0)
  })
})

describe('pyramid calibration', () => {
  it('reaches far enough to matter, at a radius the shader can run', () => {
    // The point of the levels is reach the full-resolution pass cannot buy: the
    // coarsest one has to see blotches several times wider than that pass's own
    // widest radius, or the whole structure is only paying for itself.
    const reach = COLOR_PYRAMID_RADIUS * COLOR_PYRAMID_FACTOR ** COLOR_PYRAMID_MAX_LEVELS
    expect(reach).toBeGreaterThan(4 * COLOR_NOISE_MAX_RADIUS)
    // And it has to fit the shader's compile-time tap cap (MAX_TAPS = 24).
    expect(COLOR_PYRAMID_RADIUS).toBeLessThanOrEqual(24)
  })
})
