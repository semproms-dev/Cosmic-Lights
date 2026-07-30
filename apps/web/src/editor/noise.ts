/**
 * Parameter mapping for the noise-reduction pass.
 *
 * It lives in TypeScript rather than inside the shader on purpose: this is the
 * only part of the feature that can be unit-tested without a GPU, and it is also
 * the part that gets retuned. The shader receives finished numbers and does no
 * slider maths of its own.
 *
 * See `docs/noise-reduction.technical.md` for why chroma and luminance noise are
 * two separate problems with two separate filters.
 */

import type { ImageSource } from './decodeImage'

/**
 * Widest chroma blur, in image texels, reached at `colorNoise = 100`.
 *
 * A radius this large would destroy the picture if it touched luminance. It is
 * safe here because the eye resolves colour far worse than brightness, and the
 * chroma filter only ever averages the two colour channels — which is the whole
 * reason chroma noise is the cheap half of the problem.
 */
export const COLOR_NOISE_MAX_RADIUS = 16

/**
 * Widest luminance blur, in image texels, reached at `luminanceNoise = 100`.
 *
 * An order of magnitude smaller than the chroma radius, and that asymmetry is the
 * point: luminance noise sits right on top of real detail, so the luminance
 * filter buys its strength from the range term below, not from its radius.
 */
export const LUMINANCE_NOISE_MAX_RADIUS = 6

/**
 * Sigma of the chroma pass's edge guard, in luma units (0..1).
 *
 * The guard stops the blur from bleeding colour across a hard edge by weighing
 * each neighbour by its luma difference. It is deliberately **generous**: in the
 * noisy shadows this filter exists to clean, neighbouring luma already differs by
 * the noise itself (~0.01-0.03), and a tight sigma would read that as an edge and
 * switch the smoothing off exactly where it is needed. At 0.1 only a real edge
 * (dY > ~0.2) meaningfully cuts a neighbour's weight.
 */
export const CHROMA_EDGE_SIGMA = 0.1

/** Range sigma of the luminance bilateral at `luminanceNoise` just above 0. */
const LUMINANCE_SIGMA_RANGE_MIN = 0.005
/** Range sigma of the luminance bilateral at `luminanceNoise = 100`. */
const LUMINANCE_SIGMA_RANGE_MAX = 0.08

/**
 * ISO the Auto mapping treats as "clean": at or below it the shot needs no
 * luminance work and only a token amount of chroma cleaning.
 */
export const AUTO_BASE_ISO = 100

/**
 * Stops above {@link AUTO_BASE_ISO} at which the Auto mapping stops growing
 * (7 stops = ISO 12800). Sensors differ far too much above that for a blind
 * ISO reading to say anything useful, so the curve flattens rather than pushing
 * the sliders into the watercolour range on a camera that may not need it.
 */
export const AUTO_MAX_STOPS = 7

/** Chroma noise reduction applied at base ISO, in slider units. */
const AUTO_COLOR_AT_BASE = 10
/** Extra chroma noise reduction per stop above base ISO. */
const AUTO_COLOR_PER_STOP = 11
/**
 * Stops above base ISO before the luminance filter is brought in at all.
 *
 * Chroma noise is visible long before luminance noise is worth touching, and
 * the luminance filter is the one that costs detail — so Auto reaches for it
 * only from ~ISO 400 up.
 */
const AUTO_LUMA_THRESHOLD_STOPS = 2
/** Luminance noise reduction per stop above {@link AUTO_LUMA_THRESHOLD_STOPS}. */
const AUTO_LUMA_PER_STOP = 13

/**
 * Fraction of the Auto strength applied to an already-developed file.
 *
 * A camera JPEG arrives having been denoised in-camera already, and the
 * compression ate much of the fine chroma noise on the way out — so the ISO says
 * how noisy the *sensor* was, not how noisy the file still is. Running the full
 * RAW curve on top of that is denoise over denoise, which is exactly what makes
 * skin look like plastic. How much the camera did is unknowable and swings wildly
 * between makers and settings, so Auto deliberately errs short: the user can
 * always push the sliders further, but cannot get destroyed detail back.
 */
export const AUTO_DEVELOPED_SCALE = 0.5

/** Finished, shader-ready parameters for one frame's noise reduction. */
export interface DenoiseParams {
  /** Chroma blur radius in image texels; 0 leaves colour untouched. */
  colorRadius: number
  /** Luminance bilateral radius in image texels; 0 leaves luma untouched. */
  lumaRadius: number
  /**
   * Range sigma of the luminance bilateral, in luma units (0..1). Neighbours
   * further than this from the centre stop counting, which is what keeps the
   * filter from averaging across an edge — and what makes it a denoiser rather
   * than a blur.
   */
  lumaSigmaRange: number
  /** How much luminance detail is mixed back in, 0..1 (1 undoes the luma filter). */
  detail: number
  /** Widest of the two radii: how far the shader's loop has to reach. */
  maxRadius: number
  /** False when neither filter would change anything, so the pass can be skipped. */
  enabled: boolean
}

/** The slider values the mapping reads. A subset of `RenderAdjustments`. */
export interface NoiseSliders {
  colorNoise: number
  luminanceNoise: number
  luminanceDetail: number
}

/**
 * Clamps a slider to 0..100, treating anything non-finite as 0.
 *
 * @param value - Raw slider value.
 * @returns The value in [0, 100].
 */
function clampSlider(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0
  }
  return Math.min(value, 100)
}

/**
 * Maps the `colorNoise` slider to the chroma blur radius in image texels.
 *
 * The radius is in *image* texels, not frame or canvas pixels: noise is a
 * property of the sensor's pixels, so the filter has to keep the same footprint
 * whatever the zoom or the export size. That falls out for free because the pass
 * runs at image resolution.
 *
 * @param colorNoise - Slider value in [0, 100]; values at or below 0 (and any
 *   non-finite value) disable the chroma filter, values above 100 clamp.
 * @returns Radius in texels, where 0 means "leave chroma alone".
 */
export function colorNoiseRadius(colorNoise: number): number {
  return (clampSlider(colorNoise) / 100) * COLOR_NOISE_MAX_RADIUS
}

/**
 * Maps the `luminanceNoise` slider to the bilateral's spatial radius in texels.
 *
 * Note the floor: any non-zero slider value gets at least a 1-texel radius,
 * because a bilateral with radius 0 has nothing to average and would make the
 * slider look broken over its first few percent.
 *
 * @param luminanceNoise - Slider value in [0, 100].
 * @returns Radius in texels, where 0 means "leave luminance alone".
 */
export function luminanceNoiseRadius(luminanceNoise: number): number {
  const value = clampSlider(luminanceNoise)
  if (value === 0) {
    return 0
  }
  return 1 + (value / 100) * (LUMINANCE_NOISE_MAX_RADIUS - 1)
}

/**
 * Maps the `luminanceNoise` slider to the bilateral's range sigma.
 *
 * **This is the knob that actually removes noise**, not the radius. The range
 * sigma is the luma difference the filter is willing to average over: raise it
 * and more neighbours count as "the same surface". Raising the radius without
 * raising this just costs taps for no extra cleaning — and pushing it too far is
 * what produces the watercolour, plastic-skin look.
 *
 * @param luminanceNoise - Slider value in [0, 100].
 * @returns Range sigma in luma units (0..1).
 */
export function luminanceSigmaRange(luminanceNoise: number): number {
  const value = clampSlider(luminanceNoise)
  return LUMINANCE_SIGMA_RANGE_MIN + (value / 100) * (LUMINANCE_SIGMA_RANGE_MAX - LUMINANCE_SIGMA_RANGE_MIN)
}

/**
 * Maps the `luminanceDetail` slider to the fraction of luminance detail that is
 * mixed back over the filtered result.
 *
 * This is the cheap answer to the plastic look: instead of filtering less, filter
 * fully and then give some of the removed high-frequency content back. At 100 it
 * returns the original luma, i.e. it cancels the luminance filter entirely.
 *
 * @param luminanceDetail - Slider value in [0, 100].
 * @returns Mix amount in [0, 1].
 */
export function luminanceDetailAmount(luminanceDetail: number): number {
  return clampSlider(luminanceDetail) / 100
}

/**
 * Turns the three noise sliders into everything the denoise pass needs, including
 * whether it is worth running at all.
 *
 * @param sliders - Current `colorNoise` / `luminanceNoise` / `luminanceDetail`.
 * @returns Shader-ready parameters; `enabled` is false when both filters are off.
 */
export function denoiseParams(sliders: NoiseSliders): DenoiseParams {
  const colorRadius = colorNoiseRadius(sliders.colorNoise)
  const lumaRadius = luminanceNoiseRadius(sliders.luminanceNoise)
  // Detail at 100 hands the original luma straight back, so the luminance filter
  // is a no-op no matter how wide its radius is. Treating that as "off" saves the
  // taps rather than computing a result that is about to be discarded.
  const detail = luminanceDetailAmount(sliders.luminanceDetail)
  const effectiveLumaRadius = detail >= 1 ? 0 : lumaRadius
  return {
    colorRadius,
    lumaRadius: effectiveLumaRadius,
    lumaSigmaRange: luminanceSigmaRange(sliders.luminanceNoise),
    detail,
    maxRadius: Math.max(colorRadius, effectiveLumaRadius),
    enabled: colorRadius > 0 || effectiveLumaRadius > 0,
  }
}

/**
 * Proposes the three noise sliders for a shot taken at the given ISO.
 *
 * Sensor noise roughly doubles with each stop of gain, so the mapping is
 * logarithmic in ISO rather than linear: what matters is how many stops above
 * base the shot was pushed, not the absolute number. Chroma is dealt with from
 * the very first stop (it is cheap and costs no detail); luminance only joins in
 * from {@link AUTO_LUMA_THRESHOLD_STOPS} stops up, because that filter always
 * takes real detail with it.
 *
 * Where the pixels came from changes the *dose*, never the availability: the
 * denoise pass is the same shader either way, and a JPEG has an ISO to read like
 * anything else — it has simply been cleaned once already. See
 * {@link AUTO_DEVELOPED_SCALE}.
 *
 * This is deliberately a *suggestion*: it writes the sliders as if the user had
 * dragged them, so every value stays visible and adjustable afterwards, and one
 * undo puts them back.
 *
 * @param iso - ISO from the shot's metadata. Zero, missing or non-finite (a file
 *   whose EXIF says nothing) is treated as base ISO, i.e. the mildest setting,
 *   rather than as an error.
 * @param source - Which decoder produced the image, from `LoadedImage.source`.
 * @returns The three slider values, already rounded to the sliders' step of 1.
 */
export function autoDenoiseSliders(iso: number, source: ImageSource): NoiseSliders {
  const usableIso = Number.isFinite(iso) && iso > 0 ? Math.max(iso, AUTO_BASE_ISO) : AUTO_BASE_ISO
  const stops = Math.min(Math.log2(usableIso / AUTO_BASE_ISO), AUTO_MAX_STOPS)
  const lumaStops = Math.max(stops - AUTO_LUMA_THRESHOLD_STOPS, 0)
  const scale = source === 'developed' ? AUTO_DEVELOPED_SCALE : 1
  return {
    colorNoise: Math.round(Math.min(AUTO_COLOR_AT_BASE + stops * AUTO_COLOR_PER_STOP, 100) * scale),
    luminanceNoise: Math.round(Math.min(lumaStops * AUTO_LUMA_PER_STOP, 100) * scale),
    // Detail stays at its neutral 50: it is the *shape* of the luminance filter,
    // and how much texture a given photo can spare is a look, not something the
    // ISO reading knows. Auto sets the strength; the user shapes it from there.
    luminanceDetail: 50,
  }
}
