/**
 * Parameters for the non-local means luminance denoiser — the quality-pass
 * filter, and the one that closes the distance to a desktop raw developer.
 *
 * ## Why a second luminance filter at all
 *
 * The bilateral in `noise.ts` asks one question of each neighbour: *is your
 * brightness close to mine?* That is all it can ask, and it is not enough. On a
 * noisy photo the answer is yes for half the noise and no for the other half, so
 * the filter either leaves grain behind or starts averaging across the very
 * detail it was meant to protect. There is no setting that avoids both, which is
 * why turning it up produces wax and turning it down produces grain.
 *
 * Non-local means asks a much better question: *does the little patch around you
 * look like the little patch around me?* Noise is uncorrelated between patches
 * and cancels out of that comparison, while real structure — a feather barb, a
 * fabric weave — matches strongly wherever it repeats. So the filter can average
 * a dozen genuinely similar neighbourhoods and remove far more noise than a
 * bilateral, while leaving the structure sharper than the bilateral leaves it.
 *
 * ## Why it is not the preview filter
 *
 * It costs roughly two orders of magnitude more work, because every neighbour
 * needs a patch comparison rather than a subtraction. That is a bad trade at
 * 60 fps and an excellent one when the user has stopped moving the slider — the
 * same trade a desktop developer makes when its denoise takes a few seconds.
 * See `WebGLRenderer.setDenoiseQuality`.
 *
 * @see NOISE_SIGMA_OVERLAP in `noise.ts` for how the slider's range sigma
 *   relates to the noise sigma this module works in.
 */

import { NOISE_SIGMA_OVERLAP, type DenoiseParams } from './noise'

/**
 * Half-width of the patch that is compared, in texels: 1 gives a 3×3 patch.
 *
 * Small on purpose. The patch has to be big enough for noise to average out of
 * the comparison (9 samples already cuts its influence to a third) and small
 * enough that a patch still describes *one* piece of structure — widen it and
 * every patch starts containing a bit of everything, similarity collapses toward
 * uniform, and the filter degenerates into a plain blur. It also multiplies the
 * cost of every single comparison, and there are dozens per pixel.
 */
export const NLM_PATCH_RADIUS = 1

/**
 * Half-width of the region searched for similar patches, in texels: 3 gives a
 * 7×7 search, i.e. 49 candidate neighbours per pixel.
 *
 * This is the parameter that buys quality and costs time, in direct proportion —
 * the pass count is the candidate count, and it grows with the square of the
 * radius. Measured against a synthetic photo (flat half plus hard stripes, noise
 * σ = 10/255), scoring RMSE against the noise-free ground truth:
 *
 * | radius | passes  | RMSE | residual σ | structure kept |
 * |--------|---------|------|------------|----------------|
 * | 2      | 50      | 3.20 | 2.70       | 98%            |
 * | 3      | 98      | 2.72 | 2.18       | 98%            |
 * | **5**  | **242** | 2.39 | 1.85       | 97%            |
 *
 * (the bilateral, for scale: RMSE 3.18, residual σ 2.80, 97% kept)
 *
 * Five costs two and a half times what three does and is worth it here, because
 * this pass no longer has to finish inside one frame — see
 * {@link NLM_FRAGMENT_BUDGET}. Without that, 242 full-resolution passes
 * submitted in one go hold the main thread long enough to feel like a hang, and
 * three was the responsible ceiling.
 */
export const NLM_SEARCH_RADIUS = 5

/**
 * Fragments of work one frame of the quality pass is allowed to queue.
 *
 * The pass is spread over frames rather than run in one go, and this is what
 * decides how thin the slices are. It is expressed in *fragments* rather than in
 * candidates because a candidate is not a fixed amount of work: one costs two
 * passes over the whole image, so on a 45 MP frame a single one is more than a
 * 6 MP frame's entire job. Budgeting the work instead of the count is what keeps
 * a big photo from stalling the tab and a small one from taking pointlessly many
 * frames to finish.
 *
 * 120M is about 10-25 ms on a mid-range GPU for shaders this simple. Erring low
 * costs a few more frames of waiting; erring high costs responsiveness, which is
 * the whole reason for slicing at all.
 */
export const NLM_FRAGMENT_BUDGET = 120_000_000

/**
 * How many candidates to process in one frame at a given image size.
 *
 * @param width - Image width in pixels.
 * @param height - Image height in pixels.
 * @returns At least 1 — a frame always makes progress, however large the image,
 *   because a chunk of zero would spread the job over infinitely many frames.
 */
export function nlmChunkSize(width: number, height: number): number {
  // `Math.max` propagates a NaN rather than rejecting it, and a NaN chunk means
  // the loop that consumes it does nothing at all — the job would never finish.
  const side = (value: number): number => (Number.isFinite(value) && value > 1 ? value : 1)
  const perCandidate = 2 * side(width) * side(height)
  return Math.max(1, Math.floor(NLM_FRAGMENT_BUDGET / perCandidate))
}

/** Pixels in one patch, the divisor that turns a patch distance into a mean. */
export const NLM_PATCH_PIXELS = (2 * NLM_PATCH_RADIUS + 1) ** 2

/**
 * Filter strength, as a multiple of the measured noise σ.
 *
 * The weight is `exp(−max(d² − 2σ², 0) / h²)`, where `d²` is the mean squared
 * difference between two patches. The `2σ²` is not a fudge: two patches of the
 * *same* signal seen through independent noise differ by exactly that much on
 * average, so subtracting it makes a genuine match score zero and earn a weight
 * of 1 — which is what lets the filter average aggressively without a threshold.
 *
 * What is left after the subtraction is real difference, and `h` says how much
 * of it still counts as "the same thing". At `h = σ`, a neighbourhood differing
 * by a visible 2σ step keeps a weight of `e⁻⁴ ≈ 0.02`, i.e. it is rejected, while
 * one differing by half a σ keeps 0.78.
 *
 * Swept against ground truth on the synthetic photo described in
 * {@link NLM_SEARCH_RADIUS}, at that radius:
 *
 * | h    | RMSE | residual σ | structure kept |
 * |------|------|------------|----------------|
 * | 0.8  | 3.01 | 2.64       | 100%           |
 * | 1.0  | 2.77 | 2.37       | 99%            |
 * | **1.2** | ~2.73 | ~2.25   | 98%            |
 * | 1.6  | 2.92 | 2.10       | 95%            |
 * | 2.0  | 3.43 | 2.08       | 90%            |
 *
 * The error is flat between 1.0 and 1.3 and climbs sharply on both sides, so the
 * choice inside that basin is a taste one: 1.2 leans toward the clean end of it,
 * because residual grain is what the eye complains about first and the structure
 * given up to get there is under two percent. This is the first number to reach
 * for if a result looks too soft (lower it) or too noisy (raise it).
 */
export const NLM_H = 1.2

/**
 * Pyramid levels the luminance pass folds in below full resolution.
 *
 * **Why a filter this good still needs them.** A search of radius R can only
 * average over R pixels, so noise whose wavelength exceeds that is invisible to
 * it — not weakly attenuated, *invisible*. Measured on a smooth patch, the
 * full-resolution pass removes 82% of the total noise but only 23% of the part
 * slower than 9 px, and that untouched remainder is what reads as faint
 * mottling on an out-of-focus background.
 *
 * No search radius fixes it: widening to 11×11 costs two and a half times the
 * passes and still cannot see a 30-pixel blotch. Shrinking the picture can — at
 * a quarter size that blotch is 7 pixels across, exactly what this filter is
 * good at. Two levels reach ~120 image pixels for about 7% on top of the
 * full-resolution pass, since they hold 1/16 and 1/256 of the pixels.
 *
 * **Keep the size of the prize in mind.** The slow part is about half the
 * *amplitude* of what is left but only a quarter of its energy, so even removing
 * all of it takes the total residual down by roughly a tenth. Measured, the
 * levels cut the slow component by ~25% and the total by ~10%, for no loss of
 * structure. That is a real improvement and it is not the thing that closes the
 * distance to a desktop developer; the search radius is a bigger lever and costs
 * accordingly. See {@link NLM_PYRAMID_SIGMA_SCALE} for what limits this.
 */
export const NLM_PYRAMID_LEVELS = 2

/**
 * How the noise σ shrinks from one pyramid level to the next.
 *
 * A 4×4 box average of white noise divides its σ by exactly 4, and the sweep
 * says to trust that arithmetic rather than to second-guess it. Measured on a
 * synthetic photo whose smooth half carries real slow structure, varying how far
 * that structure stands above the noise:
 *
 * | scale | SNR 1.2 (grain / kept) | SNR 3 | SNR 6 |
 * |-------|------------------------|-------|-------|
 * | none  | 2.11 / 91%             | 3.56 / 95% | 4.25 / 99% |
 * | 0.15  | **1.86** / 90%         | 3.27 / 95% | 4.01 / 100% |
 * | 0.25  | 2.04 / 89%             | **3.15** / 95% | **3.88** / 99% |
 * | 0.35  | 2.67 / 78%             | 3.25 / 95% | 3.87 / 99% |
 * | 0.50  | 4.57 / 56%             | 3.65 / 93% | 3.87 / 99% |
 *
 * **This is the dangerous constant of the whole feature.** Above ~0.35 the
 * coarse level stops being able to tell slow noise from slow *subject* — at a
 * quarter size they are the same thing — and the correction starts subtracting
 * the photograph. The SNR 1.2 column is where that shows first, and it is not a
 * hypothetical: it is any softly-lit surface at high ISO. Chroma tolerates a
 * heavy hand here and luminance does not, because slow luminance structure *is*
 * the shading that gives a subject its form.
 *
 * 0.25 is both the arithmetic answer and the best of the safe values on real
 * signal-to-noise ratios. Do not raise it without re-running that sweep.
 */
export const NLM_PYRAMID_SIGMA_SCALE = 0.25

/**
 * The σ a pyramid level should be told about.
 *
 * @param sigma - The full-resolution noise σ, in luma units.
 * @param level - 1 for the first level below full resolution, 2 for the next.
 * @returns The level's own σ, in the same units.
 */
export function nlmLevelSigma(sigma: number, level: number): number {
  return sigma * NLM_PYRAMID_SIGMA_SCALE ** level
}

/** Where in a frame the accumulator should look for its neighbours. */
export interface NlmOffset {
  /** Horizontal shift in texels. */
  dx: number
  /** Vertical shift in texels. */
  dy: number
}

/** Finished, shader-ready parameters for one frame's non-local means pass. */
export interface NlmParams {
  /**
   * The noise σ the filter should assume, in luma units (0..1), before the
   * per-brightness curve scales it. Taken from the same slider the bilateral
   * reads, so the two filters agree about how noisy the photo is and the slider
   * means one thing in both.
   */
  sigma: number
  /** Filter strength as a multiple of σ; see {@link NLM_H}. */
  h: number
  /** How much original luminance detail is mixed back, 0..1. */
  detail: number
  /** False when the pass would change nothing, so it can be skipped entirely. */
  enabled: boolean
}

/**
 * Every neighbour position the search visits, the centre included.
 *
 * The centre (0, 0) is deliberately in the list rather than special-cased: its
 * patch distance to itself is zero, so it earns a weight of exactly 1 through
 * the ordinary formula. One less branch in the shader, one less thing to get
 * wrong in the accumulator's bookkeeping.
 *
 * Order is row-major and fixed, which makes a render deterministic — the
 * accumulation is floating point, so a different visiting order would give
 * bit-different results and turn any pixel comparison into a flaky one.
 *
 * @param radius - Search half-width in texels; values below 0 are treated as 0.
 * @returns The `(2r+1)²` offsets, centre included.
 */
export function nlmOffsets(radius: number): NlmOffset[] {
  const limit = Number.isFinite(radius) && radius > 0 ? Math.floor(radius) : 0
  const offsets: NlmOffset[] = []
  for (let dy = -limit; dy <= limit; dy++) {
    for (let dx = -limit; dx <= limit; dx++) {
      // `-limit` is negative zero when the radius is 0, and a negative zero that
      // escapes into a data structure quietly breaks every equality check that
      // ever looks at it. The shader would not care; the next reader would.
      offsets.push({ dx: dx === 0 ? 0 : dx, dy: dy === 0 ? 0 : dy })
    }
  }
  return offsets
}

/**
 * Turns the frame's denoise parameters into the non-local means pass's own.
 *
 * The σ is recovered from the bilateral's range sigma rather than measured
 * again, so both filters are driven by one slider and switching between preview
 * and quality changes how well the noise is removed, never how much of it the
 * app thinks there is.
 *
 * @param params - The frame's denoise parameters, from `denoiseParams`.
 * @returns Shader-ready parameters; `enabled` is false when the luminance half
 *   of the denoise is off, or when detail hands the original straight back.
 */
export function nlmParams(params: DenoiseParams): NlmParams {
  const sigma = params.lumaSigmaRange / NOISE_SIGMA_OVERLAP
  return {
    sigma,
    h: NLM_H,
    detail: params.detail,
    // lumaRadius is the bilateral's own reach, but it is also the one flag that
    // already accounts for both ways the luminance filter can be switched off
    // (slider at 0, or detail at 100). Reusing it keeps the two filters from
    // disagreeing about whether there is luminance work to do.
    enabled: params.lumaRadius > 0 && sigma > 0,
  }
}
