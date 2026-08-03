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
import { NOISE_LUMA_BINS, type NoiseEstimate } from './noiseEstimate'

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
 * `luminanceDetail` every Auto mapping proposes: the slider's own neutral.
 *
 * Zero, and deliberately so. `luminanceDetail` mixes back toward the *original*
 * luminance, which still carries all of its noise — so a value of n% hands n% of
 * the noise straight back and caps the luminance denoiser's reduction at
 * `100 − n`%. A "50 is neutral" reading of the slider is the intuitive one and
 * costs half the filter; see the note on the slider in `adjustments.ts`.
 */
const AUTO_LUMA_DETAIL = 0

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

/**
 * Floor and ceiling on the brightness shape multiplier
 * ({@link NoiseEstimate.lumaShape}) before it reaches the filter.
 *
 * The measurement is robust, not infallible: a frame whose only flat areas are
 * three near-black bands can report a shadow σ many times the mean, and letting
 * that through unbounded would smear the shadows into mud. The clamp keeps the
 * redistribution meaningful (a 4:1 spread between the shadows and the highlights
 * is already most of what the gamma produces) while bounding what a bad reading
 * can do to the picture.
 */
export const LUMA_SHAPE_MIN = 0.5
/** @see LUMA_SHAPE_MIN */
export const LUMA_SHAPE_MAX = 4

/** The shape of a frame with no measurement: the same strength everywhere. */
const FLAT_LUMA_SHAPE = Array.from({ length: NOISE_LUMA_BINS }, () => 1)

/**
 * Blur radius, in that level's own texels, used at every pyramid level.
 *
 * Constant across levels on purpose: each level is a quarter of the one above,
 * so the same 8 texels reach 32 image pixels at the first level and 128 at the
 * second. The reach grows geometrically while the cost per level *falls*
 * geometrically, which is the whole reason the pyramid exists — the full-
 * resolution pass would need 128 taps per side to match the second level, and
 * the second level needs 8.
 */
export const COLOR_PYRAMID_RADIUS = 8

/** Linear downscale between one pyramid level and the next. */
export const COLOR_PYRAMID_FACTOR = 4

/** `colorNoise` above which the first (¼) pyramid level joins in. */
export const COLOR_PYRAMID_LEVEL_1_AT = 30
/** `colorNoise` above which the second (1⁄16) level joins in. */
export const COLOR_PYRAMID_LEVEL_2_AT = 60

/** Most levels the pyramid ever builds. */
export const COLOR_PYRAMID_MAX_LEVELS = 2

/**
 * How many pyramid levels a given `colorNoise` earns.
 *
 * Gated rather than always-on because the levels answer a different question
 * from the full-resolution pass. Fine chroma speckle is gone by the time the
 * slider reaches a third of its travel; what survives past that is *mottle* —
 * slow blotches tens of pixels across that the 16-texel pass cannot even see. So
 * a gentle setting pays for one pass, and only a user who has asked for real
 * cleaning pays for three.
 *
 * @param colorNoise - Slider value in [0, 100].
 * @returns 0, 1 or 2 levels.
 */
export function colorPyramidLevels(colorNoise: number): number {
  const value = clampSlider(colorNoise)
  if (value > COLOR_PYRAMID_LEVEL_2_AT) {
    return 2
  }
  return value > COLOR_PYRAMID_LEVEL_1_AT ? 1 : 0
}

/**
 * Size of a pyramid level, in pixels along one axis.
 *
 * Rounds **up**, so a level never loses the last partial block of the level
 * above it, and never reaches zero — a 1-pixel level is degenerate but harmless,
 * whereas a 0-pixel one is an invalid texture.
 *
 * @param size - The full-resolution size along this axis.
 * @param level - 1 for the first level below full resolution, 2 for the next.
 * @returns The level's size, at least 1.
 */
export function pyramidSize(size: number, level: number): number {
  return Math.max(1, Math.ceil(size / COLOR_PYRAMID_FACTOR ** level))
}

/**
 * Reads the brightness shape a frame's measurement calls for, clamped and
 * guarded, ready to hand to the shader.
 *
 * Everything that can be missing is missing here at some point — no image, an
 * image the estimator could not read, a curve of the wrong length from a stale
 * cache — and all of it means the same thing: filter every brightness the same,
 * which is exactly what the feature did before the curve existed.
 *
 * @param estimate - The frame's measured noise, or `null` when there is none.
 * @returns One multiplier per {@link NOISE_LUMA_BINS} band, all 1 when unknown.
 */
export function lumaShapeCurve(estimate: NoiseEstimate | null | undefined): number[] {
  const shape = estimate?.lumaShape
  if (shape === undefined || shape.length !== NOISE_LUMA_BINS) {
    return FLAT_LUMA_SHAPE.slice()
  }
  return shape.map((value) =>
    Number.isFinite(value) ? Math.min(Math.max(value, LUMA_SHAPE_MIN), LUMA_SHAPE_MAX) : 1,
  )
}

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
  /**
   * Extra chroma pyramid levels to run below full resolution, 0..2. See
   * {@link colorPyramidLevels}; the renderer may build fewer if the image is too
   * small to halve twice.
   */
  pyramidLevels: number
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
    pyramidLevels: colorPyramidLevels(sliders.colorNoise),
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
    // Detail stays at its neutral 0: it is the *shape* of the luminance filter,
    // and how much grit a given photo wants back is a look, not something the
    // ISO reading knows. Auto sets the strength; the user shapes it from there.
    //
    // Emphatically not 50. The slider mixes back toward the original luminance,
    // so any non-zero value returns that fraction of the NOISE — an Auto button
    // that suggested 50 would cap its own suggestion at half a job.
    luminanceDetail: AUTO_LUMA_DETAIL,
  }
}

/**
 * How many σ of measured noise the luminance filter's range term should span.
 *
 * The bilateral averages neighbours whose luma lies within its range sigma. To
 * actually smooth a noise of σ, that range has to reach ~1.5σ — covering a
 * noise-dominated neighbourhood — while staying far short of real detail,
 * which is many σ away. This factor is the bridge from a *measured* noise σ
 * (see `estimateNoise`) to the *filter* range sigma the slider really controls.
 */
export const NOISE_SIGMA_OVERLAP = 1.5

/** Measured luma noise σ (0..1) that `luminanceNoise` maps to 0. */
export const LUMA_NOISE_SIGMA_AT_0 = LUMINANCE_SIGMA_RANGE_MIN / NOISE_SIGMA_OVERLAP

/** Measured luma noise σ (0..1) that `luminanceNoise` maps to 100. */
export const LUMA_NOISE_SIGMA_AT_100 = LUMINANCE_SIGMA_RANGE_MAX / NOISE_SIGMA_OVERLAP

/**
 * Measured chroma noise magnitude σ (0..1) that `colorNoise` maps to 100.
 *
 * Deliberately a little wider than the luma top: chroma tolerates a heavier
 * hand (the eye resolves colour worse than brightness), so the slider is
 * allowed to reach full strength on noise the luma mapping would still hold
 * back from.
 */
export const CHROMA_NOISE_SIGMA_AT_100 = 0.07

/**
 * Stops above base ISO at which the measured noise is trusted fully over the
 * ISO prior (3 stops = ISO 800).
 *
 * The measurement can be fooled *upwards* by fine texture, and the only way to
 * tell "ISO 100 but textured" from "genuinely noisy" is the ISO itself: if the
 * sensor should have been clean, a high reading is probably texture and the
 * prior gets to keep its conservative dose. From ISO 800 up the sensor is
 * provably noisy, so the measurement — which knows the *actual* noise — wins.
 */
export const AUTO_NOISE_TRUST_STOPS = 3

/** Trust granted to the measurement when the file carries no ISO at all. */
export const AUTO_NOISE_MISSING_ISO_TRUST = 0.5

/**
 * Maps a measured luma noise σ to the `luminanceNoise` slider.
 *
 * The inverse of {@link luminanceSigmaRange} scaled by {@link NOISE_SIGMA_OVERLAP}:
 * the slider that would set the range sigma to `1.5 × σ`. Below
 * {@link LUMA_NOISE_SIGMA_AT_0} the noise is below the filter's resolution and
 * maps to 0 (off), which is exactly the right dose for a clean image.
 *
 * @param sigma - Measured luma noise σ in 0..1 units.
 * @returns A slider value in [0, 100], rounded to the slider's step of 1.
 */
export function luminanceSliderFromSigma(sigma: number): number {
  const slider = ((sigma - LUMA_NOISE_SIGMA_AT_0) / (LUMA_NOISE_SIGMA_AT_100 - LUMA_NOISE_SIGMA_AT_0)) * 100
  return Math.round(clampSlider(slider))
}

/**
 * Maps a measured chroma noise magnitude σ to the `colorNoise` slider.
 *
 * Linear against {@link CHROMA_NOISE_SIGMA_AT_100}: a σ that reaches the top of
 * the calibration gets the full chroma blur radius, anything smaller a
 * proportional share, and sub-resolution noise maps to 0 (off).
 *
 * @param sigma - Measured chroma noise σ in 0..1 units.
 * @returns A slider value in [0, 100], rounded to the slider's step of 1.
 */
export function colorSliderFromSigma(sigma: number): number {
  return Math.round(clampSlider((sigma / CHROMA_NOISE_SIGMA_AT_100) * 100))
}

/**
 * Turns a measured noise estimate into the three sliders it calls for.
 *
 * The measured σs already know what the camera did (a clean JPEG reads clean),
 * so unlike the ISO mapping this makes no distinction between `raw` and
 * `developed` — the *measurement* is the dose. Detail stays at its neutral 50,
 * for the same reason as in {@link autoDenoiseSliders}.
 *
 * @param estimate - The frame's measured noise, from `estimateNoise`.
 * @returns The three slider values, rounded to the sliders' step of 1.
 */
export function slidersFromNoise(estimate: NoiseEstimate): NoiseSliders {
  return {
    colorNoise: colorSliderFromSigma(estimate.chromaSigma),
    luminanceNoise: luminanceSliderFromSigma(estimate.lumaSigma),
    luminanceDetail: AUTO_LUMA_DETAIL,
  }
}

/**
 * Proposes the three noise sliders from the *measured* noise, ISO included.
 *
 * This is the button's closed-loop mapping: the measurement says how noisy the
 * image actually is, the ISO prior (`autoDenoiseSliders`) says how noisy the
 * sensor should have been, and the result is a blend of the two in which the
 * measurement is trusted in proportion to {@link AUTO_NOISE_TRUST_STOPS} — the
 * higher the ISO, the more certain it is that a high reading is noise rather
 * than texture. A file with no ISO falls back to a fixed middle trust, since
 * the measurement is then all there is.
 *
 * @param estimate - The frame's measured noise, or the measurement half when it
 *   is unavailable.
 * @param iso - ISO from the shot's metadata; zero, missing or non-finite means
 *   "no ISO signal", and the measurement stands mostly alone.
 * @param source - Which decoder produced the image; shapes only the prior.
 * @returns The three slider values, rounded to the sliders' step of 1.
 */
export function denoiseSlidersFromNoise(
  estimate: NoiseEstimate,
  iso: number,
  source: ImageSource,
): NoiseSliders {
  const measured = slidersFromNoise(estimate)
  const prior = autoDenoiseSliders(iso, source)
  const hasIso = Number.isFinite(iso) && iso > 0
  const trust = hasIso
    ? Math.min(Math.log2(Math.max(iso, AUTO_BASE_ISO) / AUTO_BASE_ISO) / AUTO_NOISE_TRUST_STOPS, 1)
    : AUTO_NOISE_MISSING_ISO_TRUST
  return {
    colorNoise: Math.round(prior.colorNoise + (measured.colorNoise - prior.colorNoise) * trust),
    luminanceNoise: Math.round(prior.luminanceNoise + (measured.luminanceNoise - prior.luminanceNoise) * trust),
    luminanceDetail: AUTO_LUMA_DETAIL,
  }
}
